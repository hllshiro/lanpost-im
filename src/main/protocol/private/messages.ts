import { randomBytes } from 'node:crypto'
import { DOCVER } from '../packet'
import {
  decodeXml,
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
  QGROUP_SEND_MSG: 3011
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

export type IncomingPrivate =
  | { kind: 'text'; msgId: number; text: string; images: PrivateImageRef[] }
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
  | { kind: 'file-offer'; offer: PrivateFileOffer }
  | { kind: 'file-operate'; cmd: number; taskId: string; op: number }
  | { kind: 'file-progress'; taskId: string; totalSize: number; recvdSize: number }
  | { kind: 'file-reverse'; taskId: string }
  | { kind: 'folder-offer'; offer: PrivateFolderOffer }
  | { kind: 'folder-operate'; cmd: number; taskId: string; op: number }
  | { kind: 'folder-reverse'; taskId: string }
  | { kind: 'group-info'; info: PrivateGroupInfo }
  | { kind: 'group-user'; info: PrivateGroupInfo; members: PrivateGroupMember[] }
  | { kind: 'group-message'; groupId: string; msgId: number; text: string }
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

// 发图片时内网通先发 X_SEND_FILE，再发一条 img 卡片；v 是“文件号|md5”
export function imageCardXml(msgId: number, value: string): string {
  const body = [
    '{',
    '   "app" : "shiyeline",',
    '   "dt" : [',
    '      {',
    '         "img" : {',
    '            "t" : "feihu",',
    `            "v" : ${JSON.stringify(value)}`,
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
    `   "id" : "${randomBytes(16).toString('hex')}",`,
    '   "type" : "0",',
    '   "ver" : "6.0"',
    '}'
  ].join('\n')
  const xml = encodeChatMsg({
    Docver: DOCVER,
    MsgID: msgId,
    Receipt: 0,
    Msg: body,
    MsgTime: 0,
    Offline: 0,
    HideRecord: 0
  })
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

export function groupSendXml(groupId: string, msgId: number, text: string): string {
  const body = textJsonBody(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  const xml = `<X_QGROUP_SEND_MSG docver="1"><QGROUP_ID>${escapeXmlText(groupId)}</QGROUP_ID><MSG_ID>${msgId}</MSG_ID><MSG>${body}</MSG><HIDE_RECORD>0</HIDE_RECORD></X_QGROUP_SEND_MSG>`
  return escapeMsgBody(xml)
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
// 编号是发送方缓存里的文件号，收到消息后要按它回一条 retrieve 消息把原图取回来
export interface PrivateImageRef {
  id: number
  type: string
  value: string
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
    const id = Number(record.v.split('|')[0])
    if (!Number.isSafeInteger(id) || id <= 0) continue
    refs.push({
      id,
      type: typeof record.t === 'string' ? record.t : '',
      value: record.v
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

function remoteProfile(handshake: Handshake): RemoteProfile {
  return {
    userId: handshake.Info.CorpID,
    name: handshake.Info.Name,
    group: handshake.Info.Group,
    corporation: handshake.Info.Corporation,
    department: handshake.Info.Department,
    sign: handshake.Info.Sign,
    status: handshake.Info.Status
  }
}

function tagText(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml)
  return match === null ? null : match[1]
}

// 群资料的版本位线上闭合标签少一个 Q，单独按前缀匹配
export function groupInfoFromXml(xml: string): PrivateGroupInfo | null {
  const id = tagText(xml, 'QGROUP_ID')
  if (id === null) return null
  const version = /<QGROUP_INFO_VER>(\d+)<\/GROUP_INFO_VER>/.exec(xml)
  return {
    id,
    name: tagText(xml, 'QGROUP_NAME') ?? '',
    master: tagText(xml, 'QGROUP_MASTER') ?? '',
    topic: tagText(xml, 'QGROUP_INTR') ?? '',
    announcement: tagText(xml, 'QGROUP_ANN') ?? '',
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
    members.push({ name: match[1], userId: match[2] })
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
    case CMD.SEND_MSG: {
      const msg = decodePrivate('X_SEND_MSG', xml)
      if (msg === null) {
        return unrecognized(cmd)
      }
      const text = textFromJson(msg.Msg)
      return text === null
        ? { kind: 'text-unsupported', msgId: msg.MsgID }
        : { kind: 'text', msgId: msg.MsgID, text, images: imageRefsFromJson(msg.Msg) }
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
    case CMD.QGROUP_SEND_MSG: {
      const groupId = tagText(xml, 'QGROUP_ID')
      const msgId = Number(tagText(xml, 'MSG_ID') ?? '0')
      const body = tagText(xml, 'MSG')
      const text = body === null ? null : textFromJson(body)
      if (groupId === null || text === null) return unrecognized(cmd)
      return { kind: 'group-message', groupId, msgId, text }
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
