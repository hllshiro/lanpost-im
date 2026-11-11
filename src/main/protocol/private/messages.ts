import { randomBytes } from 'node:crypto'
import { DOCVER } from '../packet'
import {
  decodeXml,
  encodeChatMsg,
  encodeChatMsgAck,
  encodeChatReceipt,
  encodeHandshake,
  encodeReady
} from '../xml'
import type { Feature, Handshake, NetPorts, UserInfo, XmlTag, XmlTypes } from '../xml'
import { encodeBeacon } from './beacon'

const CMD = {
  HANDSHAKE: 1000,
  SEND_MSG: 1004,
  SEND_MSG_ACK: 1005,
  SEND_RECEIPT: 1006,
  HEARTBEAT: 1016,
  QUIT: 1017,
  READY: 1018
} as const

const HELLO_TYPE = 4
const ENABLED = '1'
const DISABLED = '0'
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

export type IncomingPrivate =
  | { kind: 'text'; msgId: number; text: string }
  | { kind: 'text-unsupported'; msgId: number }
  | { kind: 'ack'; msgId: number }
  | { kind: 'receipt'; msgId: number }
  | { kind: 'handshake'; profile: RemoteProfile }
  | { kind: 'ready'; userId: string }
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
    Major: DISABLED,
    Minor: DISABLED,
    Build: DISABLED,
    App: DISABLED,
    Msg: SUPPORTED_MSG,
    FileTran: DISABLED,
    FolderTran: DISABLED,
    RemoteAssistance: DISABLED,
    FileShare: DISABLED,
    QGroup: DISABLED,
    QGroupMsg: DISABLED,
    QGroupFile: DISABLED,
    QGroupFolder: DISABLED,
    OfflineMsg: DISABLED,
    OfflineFile: DISABLED,
    LanUpdate: DISABLED,
    HideRecord: ENABLED
  }
}

function netPorts(): NetPorts {
  return {
    FileTranTCPPort: 0,
    FileTranEnetPort: 0,
    FolderTranTCPPort: 0,
    FolderTranEnetPort: 0,
    FileTranTCPReversePort: 0,
    FileTranEnetReversePort: 0,
    FolderTranTCPReversePort: 0,
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
    ActiveSend: 0,
    OnlinePopup: 0,
    HideIP: 0,
    ColorName: 0,
    SortName: 0,
    DecorateName: 0
  }
}

export function handshakeXml(profile: PrivateProfile, userId: string): string {
  return encodeHandshake({
    Docver: DOCVER,
    Feature: featureNode(),
    Info: userInfo(profile, userId),
    Net: netPorts()
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

export function sendReceiptXml(msgId: number): string {
  return encodeChatReceipt({ Docver: DOCVER, MsgID: msgId })
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

export function parsePrivate(cmd: number, xml: string): IncomingPrivate {
  switch (cmd) {
    case CMD.HANDSHAKE: {
      const handshake = decodePrivate('X_HANDSHARK', xml)
      return handshake === null
        ? unrecognized(cmd)
        : { kind: 'handshake', profile: remoteProfile(handshake) }
    }
    case CMD.SEND_MSG: {
      const msg = decodePrivate('X_SEND_MSG', xml)
      if (msg === null) {
        return unrecognized(cmd)
      }
      const text = textFromJson(msg.Msg)
      return text === null
        ? { kind: 'text-unsupported', msgId: msg.MsgID }
        : { kind: 'text', msgId: msg.MsgID, text }
    }
    case CMD.SEND_MSG_ACK: {
      const ack = decodePrivate('X_SEND_MSG_ACK', xml)
      return ack === null ? unrecognized(cmd) : { kind: 'ack', msgId: ack.MsgID }
    }
    case CMD.SEND_RECEIPT: {
      const receipt = decodePrivate('X_SEND_RECEIPT', xml)
      return receipt === null ? unrecognized(cmd) : { kind: 'receipt', msgId: receipt.MsgID }
    }
    case CMD.HEARTBEAT:
      return decodePrivate('X_HEARTBEAT', xml) === null ? unrecognized(cmd) : { kind: 'heartbeat' }
    case CMD.QUIT:
      return decodePrivate('X_QUIT', xml) === null ? unrecognized(cmd) : { kind: 'quit' }
    case CMD.READY: {
      const ready = decodePrivate('X_READY', xml)
      return ready === null ? unrecognized(cmd) : { kind: 'ready', userId: ready.UserID }
    }
    default:
      return unrecognized(cmd)
  }
}
