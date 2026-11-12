import { randomBytes } from 'node:crypto'
import { DOCVER } from '../packet'
import {
  decodeXml,
  encodeChangeInfo,
  encodeChatMsg,
  encodeChatMsgAck,
  encodeChatReceipt,
  encodeHandshake,
  encodeOperateRecvFile,
  encodeOperateRecvFolder,
  encodeOperateSendFile,
  encodeOperateSendFolder,
  encodeProgressRecvFile,
  encodeReady,
  encodeReverseFolderReq,
  encodeSendFile,
  encodeSendFolder
} from '../xml'
import type { Feature, Handshake, NetPorts, UserInfo, XmlTag, XmlTypes } from '../xml'
import { encodeBeacon } from './beacon'

const CMD = {
  HANDSHAKE: 1000,
  CHANGE_INFO: 1003,
  SEND_MSG: 1004,
  SEND_MSG_ACK: 1005,
  SEND_RECEIPT: 1006,
  SEND_FILE: 1009,
  OPERATE_SEND_FILE: 1010,
  OPERATE_RECV_FILE: 1011,
  PROGRESS_RECV_FILE: 1012,
  HEARTBEAT: 1016,
  QUIT: 1017,
  READY: 1018,
  REVERSE_FILE_REQ: 1019,
  SEND_FOLDER: 1013,
  OPERATE_SEND_FOLDER: 1014,
  OPERATE_RECV_FOLDER: 1015,
  REVERSE_FOLDER_REQ: 1020,
  QGROUP_PUSH_INFO: 3002,
  QGROUP_PUSH_USER: 3003,
  QGROUP_REQ_INFO: 3004,
  QGROUP_REQ_INFO_RSP: 3005,
  QGROUP_DISMISS: 3008,
  QGROUP_EXIT: 3009,
  QGROUP_KICK: 3010,
  QGROUP_SEND_MSG: 3011,
  SHARE_DOWNLOAD: 5004,
  SHARE_DOWNLOAD_RSP: 5005,
  SHARE_DOWNLOAD_FOLDER: 5006,
  SHARE_DOWNLOAD_FOLDER_RSP: 5007,
  REMIND_FILE: 1025
} as const

const HELLO_TYPE = 4
const ENABLED = '1'
const SUPPORTED_MSG = '2:1'

const XML_SPACE = '&nbsp;'
const XML_QUOTE = '&quot;'
// 样本按非空分组校验握手；空分组会被回 DISCONNECT。它自己的默认分组就是 Default
const DEFAULT_GROUP = 'Default'

export interface PrivateProfile {
  name: string
  group: string
  corporation: string
  department: string
  sign: string
  status: number
  avatarId: number
  avatarMd5: string
}

export interface RemoteProfile extends PrivateProfile {
  userId: string
}

export interface PrivateFileOffer {
  taskId: string
  fileId: number
  // 对端发来的是发送端的完整路径，只取文件名与目录
  name: string
  size: number
  lastModify: string
}

export interface PrivateFolderOffer {
  taskId: string
  name: string
  size: number
  maxItemPath: number
  maxItemSize: number
}

// 群资料；闭合标签 `</GROUP_INFO_VER>` 少一个 Q 是线上原样，解析按前缀匹配
export interface PrivateGroupInfo {
  id: string
  name: string
  master: string
  topic: string
  announcement: string
  infoVersion: number
  userVersion: number
  allowOtherAdd: number
  photoMd5: string
}

export interface PrivateGroupMember {
  userId: string
  name: string
}

// 群里的文件走“离线文件”：消息里只带 share id，接收方按它去发送方那里拉
export interface PrivateGroupFileRef {
  shareId: string
  size: number
  name: string
  // 发送方给的完整缓存路径，回执里原样带回去
  path: string
  folder: boolean
}

export type IncomingPrivate =
  | {
      kind: 'text'
      msgId: number
      text: string
      images: PrivateImageRef[]
      segments: PrivateContentSegment[]
    }
  | { kind: 'text-unsupported'; msgId: number }
  | { kind: 'ack'; msgId: number }
  | { kind: 'receipt'; msgId: number }
  | {
      kind: 'handshake'
      profile: RemoteProfile
      filePort: number
      reversePort: number
      folderPort: number
      folderReversePort: number
    }
  | { kind: 'ready'; userId: string }
  | { kind: 'change-info'; profile: RemoteProfile }
  | { kind: 'file-offer'; offer: PrivateFileOffer }
  | { kind: 'file-operate'; cmd: number; taskId: string; op: number }
  | { kind: 'file-progress'; taskId: string; totalSize: number; recvdSize: number }
  | { kind: 'file-reverse'; taskId: string }
  | { kind: 'folder-offer'; offer: PrivateFolderOffer }
  | { kind: 'folder-operate'; cmd: number; taskId: string; op: number }
  | { kind: 'folder-reverse'; taskId: string }
  | { kind: 'group-info'; info: PrivateGroupInfo }
  | { kind: 'group-user'; info: PrivateGroupInfo; members: PrivateGroupMember[] }
  | { kind: 'group-req-info'; groupId: string }
  | { kind: 'group-info-rsp'; ret: number; groupId: string; info: PrivateGroupInfo | null }
  | { kind: 'group-dismiss'; groupId: string }
  | { kind: 'group-exit'; groupId: string }
  | { kind: 'group-kick'; groupId: string }
  | {
      kind: 'group-message'
      groupId: string
      msgId: number
      text: string
      images: PrivateImageRef[]
      files: PrivateGroupFileRef[]
      segments: PrivateContentSegment[]
    }
  | { kind: 'share-download'; reqId: number; shareId: string }
  | { kind: 'share-download-folder'; reqId: number; shareId: string; channelId: string }
  | {
      kind: 'share-download-folder-rsp'
      reqId: number
      err: number
      channelId: string
    }
  | {
      kind: 'share-download-rsp'
      reqId: number
      err: number
      fileId: number
      fileSize: number
      lastModify: string
    }
  | { kind: 'remind-file'; groupId: string; name: string; size: number; folder: boolean }
  | { kind: 'heartbeat' }
  | { kind: 'quit' }
  | { kind: 'other'; cmd: number }

export function helloFrame(input: {
  ip: string
  broadcast: string
  userId: string
  peerId: Buffer
  enetPort: number
}): Buffer {
  return encodeBeacon({ type: HELLO_TYPE, ...input })
}

function featureNode(): Feature {
  return {
    // 与真实客户端 3.4.3055 完全一致；版本或能力位为 0 时对端会降级，
    // 图片只发卡片不发 X_SEND_FILE，本端就收不到原图
    Major: '3',
    Minor: '4',
    Build: '3055',
    App: ENABLED,
    Msg: SUPPORTED_MSG,
    FileTran: ENABLED,
    FolderTran: SUPPORTED_MSG,
    RemoteAssistance: ENABLED,
    FileShare: ENABLED,
    QGroup: SUPPORTED_MSG,
    QGroupMsg: SUPPORTED_MSG,
    QGroupFile: '',
    QGroupFolder: '',
    OfflineMsg: ENABLED,
    OfflineFile: ENABLED,
    LanUpdate: ENABLED,
    HideRecord: ENABLED
  }
}

function netPorts(filePort: number, folderPort: number): NetPorts {
  return {
    FileTranTCPPort: filePort,
    FileTranEnetPort: 0,
    FolderTranTCPPort: folderPort,
    FolderTranEnetPort: 0,
    // 反向端口指回同一个监听端口：对端直连不通时会按这个地址反过来连
    FileTranTCPReversePort: filePort,
    FileTranEnetReversePort: 0,
    FolderTranTCPReversePort: folderPort,
    FolderTranEnetReversePort: 0,
    LanUpdateHTTPPort: 0
  }
}

function userInfo(profile: PrivateProfile, userId: string): UserInfo {
  return {
    CorpID: userId,
    CorpTime: 0,
    Name: profile.name,
    Group: profile.group.trim() === '' ? DEFAULT_GROUP : profile.group,
    Corporation: profile.corporation,
    Department: profile.department,
    Sex: 0,
    Post: '',
    Tel: '',
    Mobile: '',
    Email: '',
    Sign: profile.sign,
    SysFace: 0,
    ...(profile.avatarMd5 === ''
      ? {}
      : { UserFace: { ID: Math.max(0, Math.floor(profile.avatarId)), Data: profile.avatarMd5 } }),
    Status: profile.status,
    ActiveSend: 1,
    OnlinePopup: 0,
    HideIP: 0,
    ColorName: 0,
    SortName: 0,
    DecorateName: 0
  }
}

export function handshakeXml(
  profile: PrivateProfile,
  userId: string,
  filePort = 0,
  folderPort = 0
): string {
  return encodeHandshake({
    Docver: DOCVER,
    Feature: featureNode(),
    Info: userInfo(profile, userId),
    Net: netPorts(filePort, folderPort)
  })
}

export function readyXml(userId: string): string {
  return encodeReady({ Docver: DOCVER, UserID: userId, Param: 0 })
}

// 改头像或资料后广播整份 X_CHANGE_INFO；对端靠 USER_FACE 的 id/md5 来取头像
export function changeInfoXml(profile: PrivateProfile, userId: string): string {
  return encodeChangeInfo({ Docver: DOCVER, ...userInfo(profile, userId) })
}

function textJsonBody(text: string): string {
  const id = randomBytes(16).toString('hex')
  return [
    '{',
    '   "app" : "shiyeline",',
    '   "dt" : [',
    '      {',
    '         "txt" : {',
    '            "t" : "normal",',
    `            "v" : ${JSON.stringify(text)}`,
    '         }',
    '      }',
    '   ],',
    '   "ft" : {',
    '      "b" : "0",',
    '      "c" : "0x000000",',
    '      "i" : "0",',
    '      "n" : "微软雅黑",',
    '      "s" : "9",',
    '      "u" : "0"',
    '   },',
    `   "id" : "${id}",`,
    '   "type" : "0",',
    '   "ver" : "6.0"',
    '}'
  ].join('\n')
}

export function messageTextJson(text: string): string {
  return textJsonBody(text).replace(/ /g, XML_SPACE).replace(/"/g, XML_QUOTE)
}

function escapeMsgBody(xml: string): string {
  const open = '<MSG>'
  const close = '</MSG>'
  const start = xml.indexOf(open)
  const end = xml.indexOf(close, start)
  if (start < 0 || end < 0) {
    throw new Error(`私有消息缺少 MSG 元素: ${xml}`)
  }
  const body = xml.slice(start + open.length, end).replace(/ /g, XML_SPACE)
  return `${xml.slice(0, start + open.length)}${body}${xml.slice(end)}`
}

export function sendMsgXml(msgId: number, text: string): string {
  const xml = encodeChatMsg({
    Docver: DOCVER,
    MsgID: msgId,
    Receipt: 0,
    Msg: textJsonBody(text),
    MsgTime: 0,
    Offline: 0,
    HideRecord: 0
  })
  return escapeMsgBody(xml)
}

export function sendMsgAckXml(msgId: number): string {
  return encodeChatMsgAck({ Docver: DOCVER, MsgID: msgId })
}

// 取图请求：dt 里放 retrieve 节点，字段与收到的 img 节点一致
function retrieveJsonBody(refs: PrivateImageRef[]): string {
  const items = refs.map((ref) =>
    [
      '      {',
      '         "retrieve" : {',
      `            "t" : ${JSON.stringify(ref.type)},`,
      `            "v" : ${JSON.stringify(ref.value)}`,
      '         }',
      '      }'
    ].join('\n')
  )
  return [
    '{',
    '   "app" : "shiyeline",',
    '   "dt" : [',
    items.join(',\n'),
    '   ],',
    '   "ft" : {',
    '      "b" : "0",',
    '      "c" : "0x000000",',
    '      "i" : "0",',
    '      "n" : "微软雅黑",',
    '      "s" : "9",',
    '      "u" : "0"',
    '   },',
    `   "id" : "${randomBytes(16).toString('hex')}",`,
    '   "type" : "0",',
    '   "ver" : "6.0"',
    '}'
  ].join('\n')
}

export function retrieveImagesXml(msgId: number, refs: PrivateImageRef[]): string {
  const xml = encodeChatMsg({
    Docver: DOCVER,
    MsgID: msgId,
    Receipt: 0,
    Msg: retrieveJsonBody(refs),
    MsgTime: 0,
    Offline: 0,
    HideRecord: 0
  })
  return escapeMsgBody(xml)
}

// 发图片时内网通先发 X_SEND_FILE，再发一条 img 卡片；v 是“文件号|md5”。
// 一条消息可以带多张图片，dt 里就是多个 img 节点。
export type PrivateCardNode = { kind: 'text'; text: string } | { kind: 'image'; value: string }

function cardNodeJson(node: PrivateCardNode): string {
  if (node.kind === 'text') {
    return [
      '      {',
      '         "txt" : {',
      '            "t" : "normal",',
      `            "v" : ${JSON.stringify(node.text)}`,
      '         }',
      '      }'
    ].join('\n')
  }
  return [
    '      {',
    '         "img" : {',
    '            "t" : "feihu",',
    `            "v" : ${JSON.stringify(node.value)}`,
    '         }',
    '      }'
  ].join('\n')
}

function cardBodyFromNodes(nodes: PrivateCardNode[]): string {
  return [
    '{',
    '   "app" : "shiyeline",',
    '   "dt" : [',
    nodes.map(cardNodeJson).join(',\n'),
    '   ],',
    '   "ft" : {',
    '      "b" : "0",',
    '      "c" : "0x000000",',
    '      "i" : "0",',
    '      "n" : "微软雅黑",',
    '      "s" : "9",',
    '      "u" : "0"',
    '   },',
    `   "id" : "${randomBytes(16).toString('hex')}",`,
    '   "type" : "0",',
    '   "ver" : "6.0"',
    '}'
  ].join('\n')
}

export function imageCardXml(msgId: number, values: string[], text = ''): string {
  return richCardXml(
    msgId,
    values.map((value) => ({ kind: 'image', value })),
    text
  )
}

// 图文混排的消息：dt 里按传入顺序排列文字与图片
export function richCardXml(msgId: number, nodes: PrivateCardNode[], text = ''): string {
  const ordered: PrivateCardNode[] = text === '' ? nodes : [{ kind: 'text', text }, ...nodes]
  const xml = encodeChatMsg({
    Docver: DOCVER,
    MsgID: msgId,
    Receipt: 0,
    Msg: cardBodyFromNodes(ordered),
    MsgTime: 0,
    Offline: 0,
    HideRecord: 0
  })
  return escapeMsgBody(xml)
}

// 群图片：dt 里只放 img 卡片，纯图片的群消息不需要额外的文本占位
export function groupImageXml(groupId: string, msgId: number, values: string[], text = ''): string {
  return groupRichCardXml(
    groupId,
    msgId,
    values.map((value) => ({ kind: 'image', value })),
    text
  )
}

export function groupRichCardXml(
  groupId: string,
  msgId: number,
  nodes: PrivateCardNode[],
  text = ''
): string {
  const ordered: PrivateCardNode[] = text === '' ? nodes : [{ kind: 'text', text }, ...nodes]
  const escaped = cardBodyFromNodes(ordered)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  const xml = `<X_QGROUP_SEND_MSG docver="1"><QGROUP_ID>${escapeXmlText(groupId)}</QGROUP_ID><MSG_ID>${msgId}</MSG_ID><MSG>${escaped}</MSG><HIDE_RECORD>0</HIDE_RECORD></X_QGROUP_SEND_MSG>`
  return escapeMsgBody(xml)
}

export function sendReceiptXml(msgId: number): string {
  return encodeChatReceipt({ Docver: DOCVER, MsgID: msgId })
}

export function sendFileXml(input: {
  taskId: string
  fileId: number
  name: string
  size: number
  lastModify: string
}): string {
  return encodeSendFile({
    Docver: DOCVER,
    TaskID: input.taskId,
    FileID: input.fileId,
    Name: input.name,
    Pwd: '',
    Size: input.size,
    LastModify: input.lastModify,
    Offline: 0
  })
}

export function operateSendFileXml(taskId: string, op: number): string {
  return encodeOperateSendFile({ Docver: DOCVER, TaskID: taskId, Op: op })
}

export function operateRecvFileXml(taskId: string, op: number): string {
  return encodeOperateRecvFile({ Docver: DOCVER, TaskID: taskId, Op: op })
}

export function progressRecvFileXml(
  taskId: string,
  totalSize: number,
  recvdSize: number,
  speed: string
): string {
  return encodeProgressRecvFile({
    Docver: DOCVER,
    TaskID: taskId,
    TotalSize: totalSize,
    RecvdSize: recvdSize,
    Speed: speed
  })
}

// 接收方连不上发送方时用它请对方反过来连自己的反向端口
export function reverseFileReqXml(taskId: string): string {
  return `<X_REVERSE_FILE_REQ docver="1"><TASK_ID>${taskId}</TASK_ID></X_REVERSE_FILE_REQ>`
}

export function operateRecvFolderXml(taskId: string, op: number): string {
  return encodeOperateRecvFolder({ Docver: DOCVER, TaskID: taskId, Op: op })
}

export function operateSendFolderXml(taskId: string, op: number): string {
  return encodeOperateSendFolder({ Docver: DOCVER, TaskID: taskId, Op: op })
}

export function reverseFolderReqXml(taskId: string): string {
  return encodeReverseFolderReq({ Docver: DOCVER, TaskID: taskId })
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// 群资料的字段顺序与真实客户端一致；`</GROUP_INFO_VER>` 少一个 Q 是线上原样
function groupInfoXml(info: PrivateGroupInfo): string {
  return (
    `<QGROUP_ID>${escapeXmlText(info.id)}</QGROUP_ID>` +
    `<QGROUP_NAME>${escapeXmlText(info.name)}</QGROUP_NAME>` +
    `<QGROUP_MASTER>${escapeXmlText(info.master)}</QGROUP_MASTER>` +
    `<QGROUP_INTR>${escapeXmlText(info.topic)}</QGROUP_INTR>` +
    `<QGROUP_ANN>${escapeXmlText(info.announcement)}</QGROUP_ANN>` +
    `<QGROUP_INFO_VER>${info.infoVersion}</GROUP_INFO_VER>` +
    `<QGROUP_USER_VER>${info.userVersion}</QGROUP_USER_VER>` +
    `<QGROUP_ALLOW_OTHER_ADD>${info.allowOtherAdd}</QGROUP_ALLOW_OTHER_ADD>` +
    `<QGROUP_PHOTO_MD5>${escapeXmlText(info.photoMd5)}</QGROUP_PHOTO_MD5>`
  )
}

export function groupPushUserXml(info: PrivateGroupInfo, members: PrivateGroupMember[]): string {
  const user = members
    .map(
      (member) => `<ID name="${escapeXmlText(member.name)}">${escapeXmlText(member.userId)}</ID>`
    )
    .join('')
  return (
    `<X_QGROUP_PUSH_USER docver="1"><INFO>${groupInfoXml(info)}</INFO>` +
    `<USER>${user}</USER></X_QGROUP_PUSH_USER>`
  )
}

export function groupPushInfoXml(info: PrivateGroupInfo): string {
  return `<X_QGROUP_PUSH_INFO docver="1"><INFO>${groupInfoXml(info)}</INFO></X_QGROUP_PUSH_INFO>`
}

// 主动拉群资料：群还在时会收到 3005，群已不存在则不会收到 RET=20
export function groupReqInfoXml(groupId: string): string {
  return `<X_QGROUP_REQ_INFO docver="1"><QGROUP_ID>${escapeXmlText(groupId)}</QGROUP_ID></X_QGROUP_REQ_INFO>`
}

// 成员来拉群资料时的应答；真实客户端的 RET 固定为 20
export function groupInfoRspXml(info: PrivateGroupInfo): string {
  return (
    `<X_QGROUP_REQ_INFO_RSP docver="1"><RET>20</RET>` +
    `<QGROUP_ID>${escapeXmlText(info.id)}</QGROUP_ID>` +
    `<INFO>${groupInfoXml(info)}</INFO></X_QGROUP_REQ_INFO_RSP>`
  )
}

export function groupExitXml(groupId: string): string {
  return `<X_QGROUP_EXIT docver="1"><QGROUP_ID>${escapeXmlText(groupId)}</QGROUP_ID></X_QGROUP_EXIT>`
}

export function groupDismissXml(groupId: string): string {
  return `<X_QGROUP_DISMISS docver="1"><QGROUP_ID>${escapeXmlText(groupId)}</QGROUP_ID></X_QGROUP_DISMISS>`
}

export function groupKickXml(groupId: string): string {
  return `<X_QGROUP_KICK docver="1"><QGROUP_ID>${escapeXmlText(groupId)}</QGROUP_ID></X_QGROUP_KICK>`
}

export function groupSendXml(groupId: string, msgId: number, text: string): string {
  const body = textJsonBody(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  const xml = `<X_QGROUP_SEND_MSG docver="1"><QGROUP_ID>${escapeXmlText(groupId)}</QGROUP_ID><MSG_ID>${msgId}</MSG_ID><MSG>${body}</MSG><HIDE_RECORD>0</HIDE_RECORD></X_QGROUP_SEND_MSG>`
  return escapeMsgBody(xml)
}

// 群文件：消息里只带 share id 和发送方的缓存路径，接收方按 share id 去拉
export function groupFileXml(input: {
  groupId: string
  msgId: number
  shareId: string
  size: number
  path: string
  folder: boolean
}): string {
  const body = [
    '{',
    '   "app" : "shiyeline",',
    '   "dt" : [',
    '      {',
    '         "txt" : {',
    '            "t" : "compatible",',
    '            "v" : "对方给您发送了一个离线文件，当前版本不支持。请升级到最新版本接收此文件。"',
    '         }',
    '      },',
    '      {',
    '         "file2" : {',
    '            "a" : "false",',
    `            "i" : ${JSON.stringify(input.shareId)},`,
    `            "s" : ${JSON.stringify(String(input.size))},`,
    `            "t" : "${input.folder ? 'offline_folder' : 'offline_file'}",`,
    `            "v" : ${JSON.stringify(input.path)}`,
    '         }',
    '      }',
    '   ],',
    '   "ft" : {',
    '      "s" : "10"',
    '   },',
    `   "id" : "${randomBytes(16).toString('hex')}",`,
    '   "type" : "0",',
    '   "ver" : "6.0"',
    '}'
  ].join('\n')
  const escaped = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  const xml = `<X_QGROUP_SEND_MSG docver="1"><QGROUP_ID>${escapeXmlText(input.groupId)}</QGROUP_ID><MSG_ID>${input.msgId}</MSG_ID><MSG>${escaped}</MSG><HIDE_RECORD>0</HIDE_RECORD></X_QGROUP_SEND_MSG>`
  return escapeMsgBody(xml)
}

export function shareDownloadXml(reqId: number, shareId: string): string {
  return (
    `<X_SHARE_DOWNLOAD_FILE docver="1"><REQ_ID>${reqId}</REQ_ID>` +
    `<SHARE_ID>${escapeXmlText(shareId)}</SHARE_ID><SHARE_PATH></SHARE_PATH>` +
    `<SHARE_PWD></SHARE_PWD><CHECK_PWD>0</CHECK_PWD><GO_ON>0</GO_ON></X_SHARE_DOWNLOAD_FILE>`
  )
}

export function shareDownloadRspXml(
  reqId: number,
  fileId: number,
  fileSize: number,
  lastModify: string
): string {
  return (
    `<X_SHARE_DOWNLOAD_FILE_RSP docver="1"><ERR>0</ERR><REQ_ID>${reqId}</REQ_ID>` +
    `<FILE_ID>${fileId}</FILE_ID><FILE_SIZE>${fileSize}</FILE_SIZE>` +
    `<LAST_MODIFY>${escapeXmlText(lastModify)}</LAST_MODIFY></X_SHARE_DOWNLOAD_FILE_RSP>`
  )
}

export function shareDownloadFolderXml(reqId: number, shareId: string, channelId: string): string {
  return (
    `<X_SHARE_DOWNLOAD_FOLDER docver="1"><REQ_ID>${reqId}</REQ_ID>` +
    `<SHARE_ID>${escapeXmlText(shareId)}</SHARE_ID><SHARE_PATH></SHARE_PATH>` +
    `<SHARE_PWD></SHARE_PWD><CHANNEL_ID>${escapeXmlText(channelId)}</CHANNEL_ID>` +
    `<CHECK_PWD>0</CHECK_PWD><GO_ON>0</GO_ON></X_SHARE_DOWNLOAD_FOLDER>`
  )
}

export function shareDownloadFolderRspXml(reqId: number, channelId: string, err = 0): string {
  return (
    `<X_SHARE_DOWNLOAD_FOLDER_RSP docver="1"><ERR>${err}</ERR><REQ_ID>${reqId}</REQ_ID>` +
    `<CHANNEL_ID>${escapeXmlText(channelId)}</CHANNEL_ID></X_SHARE_DOWNLOAD_FOLDER_RSP>`
  )
}

// 群文件下载完的回执：告诉发送方（以及群里）谁已经拿到这个文件；文件夹的 FILE 是 0
export function remindFileXml(
  groupId: string,
  size: number,
  name: string,
  folder: boolean
): string {
  return (
    `<X_REMIND_FILE docver="1"><GROUP_ID>${escapeXmlText(groupId)}</GROUP_ID>` +
    `<FILE>${folder ? 0 : 1}</FILE><FILE_SIZE>${size}</FILE_SIZE>` +
    `<FILE_NAME>${escapeXmlText(name)}</FILE_NAME></X_REMIND_FILE>`
  )
}

export function sendFolderXml(input: {
  taskId: string
  name: string
  size: number
  maxItemPath: number
  maxItemSize: number
}): string {
  return encodeSendFolder({
    Docver: DOCVER,
    TaskID: input.taskId,
    FolderName: input.name,
    FolderSize: input.size,
    MaxItemPath: input.maxItemPath,
    MaxItemSize: input.maxItemSize,
    Offline: 0
  })
}

// Windows FILETIME：100 纳秒为单位，起点 1601-01-01；超过 2^53，必须用字符串
export function fileTimeFromMs(ms: number): string {
  return ((BigInt(Math.trunc(ms)) + 11644473600000n) * 10000n).toString()
}

export function heartbeatXml(): string {
  return '<X_HEARTBEAT docver="1" />'
}

export function quitXml(): string {
  return '<X_QUIT docver="1" />'
}

function decodePrivate<K extends XmlTag>(tag: K, xml: string): XmlTypes[K] | null {
  try {
    return decodeXml(xml, tag)
  } catch {
    return null
  }
}

function unrecognized(cmd: number): IncomingPrivate {
  return { kind: 'other', cmd }
}

// 内网通的富文本按 dt 数组下发，文字、链接、图片、文件各有一种节点；
// 这里把能直接读的节点转成文字，不能读的给出占位，避免整条消息被当成空消息丢掉
function nodeText(item: unknown): string {
  if (typeof item !== 'object' || item === null) {
    return ''
  }
  const record = item as Record<string, unknown>
  const text = record['txt']
  if (typeof text === 'object' && text !== null) {
    const value = (text as { v?: unknown }).v
    if (typeof value === 'string') {
      return value
    }
  }
  const link = record['lnk']
  if (typeof link === 'object' && link !== null) {
    const value = (link as { v?: unknown }).v
    if (typeof value === 'string') {
      return value
    }
  }
  if (record['img'] !== undefined) {
    return '[图片]'
  }
  if (record['file'] !== undefined) {
    return '[文件]'
  }
  return ''
}

// 内网通的图片节点只给编号和摘要，例如 {"img":{"t":"feihu","v":"5723|6825bf..."}}；
// 编号是发送方缓存里的文件号，收到消息后要按它回一条 retrieve 消息把原图取回来。
// 内置表情复用同一个节点：v 是表情表的 Id（1251–1334）或「班车小子」组的文件名（2001.gif），
// 这类节点不需要取图，直接用本机表情表渲染。
export interface PrivateImageRef {
  id: number
  type: string
  value: string
  sticker?: boolean
}

const STICKER_ID_MIN = 1251
const STICKER_ID_MAX = 1334

function isStickerValue(value: string): boolean {
  if (/^\d{4}\.gif$/i.test(value)) return true
  if (!/^\d+$/.test(value)) return false
  const id = Number(value)
  return id >= STICKER_ID_MIN && id <= STICKER_ID_MAX
}

function imageRefsFromJson(raw: string): PrivateImageRef[] {
  const json = raw.replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return []
  }
  const dt = (parsed as { dt?: unknown }).dt
  if (!Array.isArray(dt)) {
    return []
  }
  const refs: PrivateImageRef[] = []
  for (const item of dt) {
    if (typeof item !== 'object' || item === null) continue
    const img = (item as { img?: unknown }).img
    if (typeof img !== 'object' || img === null) continue
    const record = img as { v?: unknown; t?: unknown }
    if (typeof record.v !== 'string') continue
    const sticker = isStickerValue(record.v)
    const id = sticker ? 0 : Number(record.v.split('|')[0])
    if (!sticker && (!Number.isSafeInteger(id) || id <= 0)) continue
    refs.push({
      id,
      type: typeof record.t === 'string' ? record.t : '',
      value: record.v,
      ...(sticker ? { sticker: true } : {})
    })
  }
  return refs
}

function textFromJson(raw: string): string | null {
  const json = raw.replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }
  const dt = (parsed as { dt?: unknown }).dt
  if (!Array.isArray(dt)) {
    return null
  }
  let text = ''
  for (const item of dt) {
    text += nodeText(item)
  }
  return text === '' ? null : text
}

// dt 里文字和图片可以交替出现，按原顺序记下来，气泡按这个顺序排版
export interface PrivateContentSegment {
  kind: 'text' | 'image'
  text?: string
  value?: string
}

function contentSegmentsFromJson(raw: string): PrivateContentSegment[] {
  const json = raw.replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return []
  }
  const dt = (parsed as { dt?: unknown }).dt
  if (!Array.isArray(dt)) {
    return []
  }
  const segments: PrivateContentSegment[] = []
  for (const item of dt) {
    if (typeof item !== 'object' || item === null) continue
    const img = (item as { img?: unknown }).img
    if (typeof img === 'object' && img !== null) {
      const value = (img as { v?: unknown }).v
      if (typeof value === 'string') {
        segments.push({ kind: 'image', value })
      }
      continue
    }
    const txt = (item as { txt?: unknown }).txt
    if (typeof txt === 'object' && txt !== null) {
      const value = (txt as { v?: unknown }).v
      if (typeof value === 'string' && value !== '') {
        segments.push({ kind: 'text', text: value })
      }
    }
  }
  return segments
}

function remoteProfile(handshake: Handshake): RemoteProfile {
  return profileFromInfo(handshake.Info, handshake.Info.CorpID)
}

function profileFromInfo(info: UserInfo, userId: string): RemoteProfile {
  return {
    userId,
    name: info.Name,
    group: info.Group,
    corporation: info.Corporation,
    department: info.Department,
    sign: info.Sign,
    status: info.Status,
    avatarId: info.UserFace === undefined ? 0 : Number(info.UserFace.ID),
    avatarMd5: info.UserFace === undefined ? '' : info.UserFace.Data
  }
}

function groupFilesFromJson(raw: string): PrivateGroupFileRef[] {
  const json = raw.replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }
  if (typeof parsed !== 'object' || parsed === null) return []
  const dt = (parsed as { dt?: unknown }).dt
  if (!Array.isArray(dt)) return []
  const files: PrivateGroupFileRef[] = []
  for (const item of dt) {
    if (typeof item !== 'object' || item === null) continue
    const file = (item as { file2?: unknown }).file2
    if (typeof file !== 'object' || file === null) continue
    const record = file as { i?: unknown; s?: unknown; t?: unknown; v?: unknown }
    if (typeof record.i !== 'string' || typeof record.v !== 'string') continue
    const path = record.v
    const name = path.split(/[\\/]/).pop() ?? path
    files.push({
      shareId: record.i,
      size: Number(record.s ?? '0') || 0,
      name,
      path,
      folder: record.t === 'offline_folder'
    })
  }
  return files
}

function tagText(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml)
  return match === null ? null : match[1]
}

// 真实客户端的群资料把空格写成 &nbsp;，其余实体按标准还原
function unescapeXmlText(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

// 群资料的版本位线上闭合标签少一个 Q，单独按前缀匹配
export function groupInfoFromXml(xml: string): PrivateGroupInfo | null {
  const id = tagText(xml, 'QGROUP_ID')
  if (id === null) return null
  const version = /<QGROUP_INFO_VER>(\d+)<\/GROUP_INFO_VER>/.exec(xml)
  return {
    id,
    name: unescapeXmlText(tagText(xml, 'QGROUP_NAME') ?? ''),
    master: tagText(xml, 'QGROUP_MASTER') ?? '',
    topic: unescapeXmlText(tagText(xml, 'QGROUP_INTR') ?? ''),
    announcement: unescapeXmlText(tagText(xml, 'QGROUP_ANN') ?? ''),
    infoVersion: version === null ? 0 : Number(version[1]),
    userVersion: Number(tagText(xml, 'QGROUP_USER_VER') ?? '0'),
    allowOtherAdd: Number(tagText(xml, 'QGROUP_ALLOW_OTHER_ADD') ?? '0'),
    photoMd5: tagText(xml, 'QGROUP_PHOTO_MD5') ?? ''
  }
}

export function groupMembersFromXml(xml: string): PrivateGroupMember[] {
  const members: PrivateGroupMember[] = []
  const pattern = /<ID name="([^"]*)">([^<]*)<\/ID>/g
  for (;;) {
    const match = pattern.exec(xml)
    if (match === null) break
    members.push({ name: unescapeXmlText(match[1]), userId: match[2] })
  }
  return members
}

export function parsePrivate(cmd: number, xml: string): IncomingPrivate {
  switch (cmd) {
    case CMD.HANDSHAKE: {
      const handshake = decodePrivate('X_HANDSHARK', xml)
      return handshake === null
        ? unrecognized(cmd)
        : {
            kind: 'handshake',
            profile: remoteProfile(handshake),
            filePort: handshake.Net.FileTranTCPPort,
            reversePort: handshake.Net.FileTranTCPReversePort,
            folderPort: handshake.Net.FolderTranTCPPort,
            folderReversePort: handshake.Net.FolderTranTCPReversePort
          }
    }
    case CMD.CHANGE_INFO: {
      const info = decodePrivate('X_CHANGE_INFO', xml)
      return info === null
        ? unrecognized(cmd)
        : { kind: 'change-info', profile: profileFromInfo(info, '') }
    }
    case CMD.SEND_MSG: {
      const msg = decodePrivate('X_SEND_MSG', xml)
      if (msg === null) {
        return unrecognized(cmd)
      }
      const images = imageRefsFromJson(msg.Msg)
      const text = textFromJson(msg.Msg)
      if (text === null && images.length === 0) {
        return { kind: 'text-unsupported', msgId: msg.MsgID }
      }
      const segments = contentSegmentsFromJson(msg.Msg)
      const textOnly = segments
        .filter((segment) => segment.kind === 'text')
        .map((segment) => segment.text ?? '')
        .join('')
      const stickersOnly = images.length > 0 && images.every((ref) => ref.sticker === true)
      return {
        kind: 'text',
        msgId: msg.MsgID,
        // 图文混排时预览只留文字，避免一串 [图片] 占位
        text:
          images.length > 0 && textOnly !== ''
            ? textOnly
            : (text ?? (stickersOnly ? '' : '[图片]')),
        images,
        segments
      }
    }
    case CMD.SEND_MSG_ACK: {
      const ack = decodePrivate('X_SEND_MSG_ACK', xml)
      return ack === null ? unrecognized(cmd) : { kind: 'ack', msgId: ack.MsgID }
    }
    case CMD.SEND_RECEIPT: {
      const receipt = decodePrivate('X_SEND_RECEIPT', xml)
      return receipt === null ? unrecognized(cmd) : { kind: 'receipt', msgId: receipt.MsgID }
    }
    case CMD.SEND_FILE: {
      const offer = decodePrivate('X_SEND_FILE', xml)
      if (offer === null) {
        return unrecognized(cmd)
      }
      return {
        kind: 'file-offer',
        offer: {
          taskId: offer.TaskID,
          fileId: offer.FileID,
          name: offer.Name,
          size: offer.Size,
          lastModify: offer.LastModify
        }
      }
    }
    case CMD.OPERATE_SEND_FILE: {
      const value = decodePrivate('X_OPERATE_SEND_FILE', xml)
      return value === null
        ? unrecognized(cmd)
        : { kind: 'file-operate', cmd, taskId: value.TaskID, op: value.Op }
    }
    case CMD.OPERATE_RECV_FILE: {
      const value = decodePrivate('X_OPERATE_RECV_FILE', xml)
      return value === null
        ? unrecognized(cmd)
        : { kind: 'file-operate', cmd, taskId: value.TaskID, op: value.Op }
    }
    case CMD.PROGRESS_RECV_FILE: {
      const value = decodePrivate('X_PROGRESS_RECV_FILE', xml)
      return value === null
        ? unrecognized(cmd)
        : {
            kind: 'file-progress',
            taskId: value.TaskID,
            totalSize: value.TotalSize,
            recvdSize: value.RecvdSize
          }
    }
    case CMD.SEND_FOLDER: {
      const offer = decodePrivate('X_SEND_FOLDER', xml)
      if (offer === null) {
        return unrecognized(cmd)
      }
      return {
        kind: 'folder-offer',
        offer: {
          taskId: offer.TaskID,
          name: offer.FolderName,
          size: offer.FolderSize,
          maxItemPath: offer.MaxItemPath,
          maxItemSize: offer.MaxItemSize
        }
      }
    }
    case CMD.OPERATE_SEND_FOLDER: {
      const value = decodePrivate('X_OPERATE_SEND_FOLDER', xml)
      return value === null
        ? unrecognized(cmd)
        : { kind: 'folder-operate', cmd, taskId: value.TaskID, op: value.Op }
    }
    case CMD.OPERATE_RECV_FOLDER: {
      const value = decodePrivate('X_OPERATE_RECV_FOLDER', xml)
      return value === null
        ? unrecognized(cmd)
        : { kind: 'folder-operate', cmd, taskId: value.TaskID, op: value.Op }
    }
    case CMD.REVERSE_FOLDER_REQ: {
      const value = decodePrivate('X_REVERSE_FOLDER_REQ', xml)
      return value === null ? unrecognized(cmd) : { kind: 'folder-reverse', taskId: value.TaskID }
    }
    case CMD.QGROUP_PUSH_INFO: {
      const info = groupInfoFromXml(xml)
      return info === null ? unrecognized(cmd) : { kind: 'group-info', info }
    }
    case CMD.QGROUP_PUSH_USER: {
      const info = groupInfoFromXml(xml)
      if (info === null) return unrecognized(cmd)
      return { kind: 'group-user', info, members: groupMembersFromXml(xml) }
    }
    case CMD.QGROUP_REQ_INFO: {
      const groupId = tagText(xml, 'QGROUP_ID')
      return groupId === null ? unrecognized(cmd) : { kind: 'group-req-info', groupId }
    }
    case CMD.QGROUP_REQ_INFO_RSP: {
      const block = /<INFO>([\s\S]*)<\/INFO>/.exec(xml)
      const info = block === null ? null : groupInfoFromXml(block[1])
      const groupId = info?.id ?? tagText(xml, 'QGROUP_ID')
      if (groupId === null) return unrecognized(cmd)
      return {
        kind: 'group-info-rsp',
        ret: Number(tagText(xml, 'RET') ?? '0'),
        groupId,
        info
      }
    }
    case CMD.QGROUP_DISMISS:
    case CMD.QGROUP_EXIT:
    case CMD.QGROUP_KICK: {
      const groupId = tagText(xml, 'QGROUP_ID')
      if (groupId === null) return unrecognized(cmd)
      const kind =
        cmd === CMD.QGROUP_DISMISS
          ? ('group-dismiss' as const)
          : cmd === CMD.QGROUP_EXIT
            ? ('group-exit' as const)
            : ('group-kick' as const)
      return { kind, groupId }
    }
    case CMD.QGROUP_SEND_MSG: {
      const groupId = tagText(xml, 'QGROUP_ID')
      const msgId = Number(tagText(xml, 'MSG_ID') ?? '0')
      const body = tagText(xml, 'MSG')
      const images = body === null ? [] : imageRefsFromJson(body)
      const files = body === null ? [] : groupFilesFromJson(body)
      const text = body === null ? null : textFromJson(body)
      // 纯图片/纯文件的群消息没有可读文本，用占位文字落库
      if (groupId === null || (text === null && images.length === 0 && files.length === 0)) {
        return unrecognized(cmd)
      }
      const stickersOnly = images.length > 0 && images.every((ref) => ref.sticker === true)
      const segments = body === null ? [] : contentSegmentsFromJson(body)
      const textOnly = segments
        .filter((segment) => segment.kind === 'text')
        .map((segment) => segment.text ?? '')
        .join('')
      const fallback = files.length > 0 ? '[文件]' : stickersOnly ? '' : '[图片]'
      return {
        kind: 'group-message',
        groupId,
        msgId,
        // 图文混排时预览只留文字，避免一串 [图片] 占位
        text: images.length > 0 && textOnly !== '' ? textOnly : (text ?? fallback),
        images,
        files,
        segments
      }
    }
    case CMD.SHARE_DOWNLOAD: {
      const reqId = Number(tagText(xml, 'REQ_ID') ?? '0')
      const shareId = tagText(xml, 'SHARE_ID')
      if (shareId === null) return unrecognized(cmd)
      return { kind: 'share-download', reqId, shareId }
    }
    case CMD.SHARE_DOWNLOAD_RSP: {
      const reqId = Number(tagText(xml, 'REQ_ID') ?? '0')
      const err = Number(tagText(xml, 'ERR') ?? '0')
      const fileId = Number(tagText(xml, 'FILE_ID') ?? '0')
      const fileSize = Number(tagText(xml, 'FILE_SIZE') ?? '0')
      const lastModify = tagText(xml, 'LAST_MODIFY') ?? ''
      return { kind: 'share-download-rsp', reqId, err, fileId, fileSize, lastModify }
    }
    case CMD.SHARE_DOWNLOAD_FOLDER: {
      const reqId = Number(tagText(xml, 'REQ_ID') ?? '0')
      const shareId = tagText(xml, 'SHARE_ID')
      const channelId = tagText(xml, 'CHANNEL_ID')
      if (shareId === null || channelId === null) return unrecognized(cmd)
      return { kind: 'share-download-folder', reqId, shareId, channelId }
    }
    case CMD.SHARE_DOWNLOAD_FOLDER_RSP: {
      const reqId = Number(tagText(xml, 'REQ_ID') ?? '0')
      const err = Number(tagText(xml, 'ERR') ?? '0')
      const channelId = tagText(xml, 'CHANNEL_ID')
      if (channelId === null) return unrecognized(cmd)
      return { kind: 'share-download-folder-rsp', reqId, err, channelId }
    }
    case CMD.REMIND_FILE: {
      const groupId = tagText(xml, 'GROUP_ID')
      const name = tagText(xml, 'FILE_NAME')
      if (groupId === null || name === null) return unrecognized(cmd)
      return {
        kind: 'remind-file',
        groupId,
        name,
        size: Number(tagText(xml, 'FILE_SIZE') ?? '0'),
        folder: (tagText(xml, 'FILE') ?? '1') === '0'
      }
    }
    case CMD.HEARTBEAT:
      return decodePrivate('X_HEARTBEAT', xml) === null ? unrecognized(cmd) : { kind: 'heartbeat' }
    case CMD.QUIT:
      return decodePrivate('X_QUIT', xml) === null ? unrecognized(cmd) : { kind: 'quit' }
    case CMD.READY: {
      const ready = decodePrivate('X_READY', xml)
      return ready === null ? unrecognized(cmd) : { kind: 'ready', userId: ready.UserID }
    }
    case CMD.REVERSE_FILE_REQ: {
      const match = /<TASK_ID>(\d+)<\/TASK_ID>/.exec(xml)
      return match === null ? unrecognized(cmd) : { kind: 'file-reverse', taskId: match[1] }
    }
    default:
      return unrecognized(cmd)
  }
}
