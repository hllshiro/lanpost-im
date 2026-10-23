import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser'

export interface Feature {
  Major: string
  Minor: string
  Build: string
  App: string
  Msg: string
  FileTran: string
  FolderTran: string
  RemoteAssistance: string
  FileShare: string
  QGroup: string
  QGroupMsg: string
  QGroupFile: string
  QGroupFolder: string
  OfflineMsg: string
  OfflineFile: string
  LanUpdate: string
  HideRecord: string
}

export interface UserFace {
  ID: number
  Data: string
}

export interface UserInfo {
  CorpID: string
  CorpTime: number
  Name: string
  Group: string
  Corporation: string
  Department: string
  Sex: number
  Post: string
  Tel: string
  Mobile: string
  Email: string
  Sign: string
  SysFace: number
  UserFace?: UserFace
  Status: number
  ActiveSend: number
  OnlinePopup: number
  HideIP: number
  ColorName: number
  SortName: number
  DecorateName: number
}

export interface NetPorts {
  FileTranTCPPort: number
  FileTranEnetPort: number
  FolderTranTCPPort: number
  FolderTranEnetPort: number
  FileTranTCPReversePort: number
  FileTranEnetReversePort: number
  FolderTranTCPReversePort: number
  FolderTranEnetReversePort: number
  LanUpdateHTTPPort: number
}

export interface Handshake {
  Docver: number
  Feature: Feature
  Info: UserInfo
  Net: NetPorts
}

export interface ChangeInfo extends UserInfo {
  Docver: number
}

export interface ChangeStatus {
  Docver: number
  Status: number
}

export interface ChangeSign {
  Docver: number
  Sign: string
}

export interface Ready {
  Docver: number
  UserID: string
  Param: number
}

export interface Heartbeat {
  Docver: number
}

export interface Quit {
  Docver: number
}

export interface ChatMsg {
  Docver: number
  MsgID: number
  Receipt: number
  Msg: string
  MsgTime: number
  Offline: number
  HideRecord: number
}

export interface ChatMsgAck {
  Docver: number
  MsgID: number
}

export interface ChatReceipt {
  Docver: number
  MsgID: number
}

export interface XmlTypes {
  X_HANDSHARK: Handshake
  X_CHANGE_INFO: ChangeInfo
  X_CHANGE_STATUS: ChangeStatus
  X_CHANGE_SIGN: ChangeSign
  X_READY: Ready
  X_HEARTBEAT: Heartbeat
  X_QUIT: Quit
  X_SEND_MSG: ChatMsg
  X_SEND_MSG_ACK: ChatMsgAck
  X_SEND_RECEIPT: ChatReceipt
}

export type XmlTag = keyof XmlTypes

type XmlNode = Record<string, unknown>

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false
})

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: false,
  suppressEmptyNode: false,
  suppressBooleanAttributes: false
})

function asNode(value: unknown): XmlNode | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  return value as XmlNode
}

function str(node: XmlNode, key: string): string {
  const value = node[key]
  if (value === undefined || value === null) {
    return ''
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  const inner = asNode(value)
  if (inner !== null) {
    return str(inner, '#text')
  }
  return ''
}

function num(node: XmlNode, key: string): number {
  const value = str(node, key)
  if (value === '') {
    return 0
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`私有消息字段 ${key} 不是数字: ${JSON.stringify(value)}`)
  }
  return parsed
}

export function rootTag(payload: Buffer | string): string {
  const text = (typeof payload === 'string' ? payload : payload.toString('utf8')).trim()
  if (!text.startsWith('<')) {
    return ''
  }
  for (let i = 1; i < text.length; i++) {
    const char = text[i]
    if (
      char === '>' ||
      char === ' ' ||
      char === '/' ||
      char === '\t' ||
      char === '\r' ||
      char === '\n'
    ) {
      return text.slice(1, i).replace(/^\?/, '')
    }
  }
  return ''
}

function parseUserInfo(node: XmlNode): UserInfo {
  const faceNode = asNode(node.USER_FACE)
  return {
    CorpID: str(node, 'CORP_ID'),
    CorpTime: num(node, 'CORP_TIME'),
    Name: str(node, 'NAME'),
    Group: str(node, 'GROUP'),
    Corporation: str(node, 'CORPORATION'),
    Department: str(node, 'DEPARTMENT'),
    Sex: num(node, 'SEX'),
    Post: str(node, 'POST'),
    Tel: str(node, 'TEL'),
    Mobile: str(node, 'MOBILE'),
    Email: str(node, 'EMAIL'),
    Sign: str(node, 'SIGN'),
    SysFace: num(node, 'SYS_FACE'),
    UserFace:
      faceNode === null ? undefined : { ID: num(faceNode, '@_id'), Data: str(faceNode, '#text') },
    Status: num(node, 'STATUS'),
    ActiveSend: num(node, 'ACTIVE_SEND'),
    OnlinePopup: num(node, 'ONLINE_POPUP'),
    HideIP: num(node, 'HIDE_IP'),
    ColorName: num(node, 'COLOR_NAME'),
    SortName: num(node, 'SORT_NAME'),
    DecorateName: num(node, 'DECORATE_NAME')
  }
}

function parseFeature(node: XmlNode | null): Feature {
  const root = node ?? {}
  return {
    Major: str(root, 'MAJOR'),
    Minor: str(root, 'MINOR'),
    Build: str(root, 'BUILD'),
    App: str(root, 'APP'),
    Msg: str(root, 'MSG'),
    FileTran: str(root, 'FILE_TRAN'),
    FolderTran: str(root, 'FOLDER_TRAN'),
    RemoteAssistance: str(root, 'REMOTE_ASSISTANCE'),
    FileShare: str(root, 'FILE_SHARE'),
    QGroup: str(root, 'QGROUP'),
    QGroupMsg: str(root, 'QGROUP_MSG'),
    QGroupFile: str(root, 'QGROUP_FILE'),
    QGroupFolder: str(root, 'QGROUP_FOLDER'),
    OfflineMsg: str(root, 'OFFLINE_MSG'),
    OfflineFile: str(root, 'OFFLINE_FILE'),
    LanUpdate: str(root, 'LAN_UPDATE'),
    HideRecord: str(root, 'HIDE_RECORD')
  }
}

function parseNet(node: XmlNode | null): NetPorts {
  const root = node ?? {}
  return {
    FileTranTCPPort: num(root, 'FILE_TRAN_TCP_PORT'),
    FileTranEnetPort: num(root, 'FILE_TRAN_ENET_PORT'),
    FolderTranTCPPort: num(root, 'FOLDER_TRAN_TCP_PORT'),
    FolderTranEnetPort: num(root, 'FOLDER_TRAN_ENET_PORT'),
    FileTranTCPReversePort: num(root, 'FILE_TRAN_TCP_REVERSE_PORT'),
    FileTranEnetReversePort: num(root, 'FILE_TRAN_ENET_REVERSE_PORT'),
    FolderTranTCPReversePort: num(root, 'FOLDER_TRAN_TCP_REVERSE_PORT'),
    FolderTranEnetReversePort: num(root, 'FOLDER_TRAN_ENET_REVERSE_PORT'),
    LanUpdateHTTPPort: num(root, 'LAN_UPDATE_HTTP_PORT')
  }
}

const DECODERS: { [K in XmlTag]: (root: XmlNode) => XmlTypes[K] } = {
  X_HANDSHARK: (root) => ({
    Docver: num(root, '@_docver'),
    Feature: parseFeature(asNode(root.FEATURE)),
    Info: parseUserInfo(asNode(root.INFO) ?? {}),
    Net: parseNet(asNode(root.NET))
  }),
  X_CHANGE_INFO: (root) => ({ Docver: num(root, '@_docver'), ...parseUserInfo(root) }),
  X_CHANGE_STATUS: (root) => ({
    Docver: num(root, '@_docver'),
    Status: num(root, 'STATUS')
  }),
  X_CHANGE_SIGN: (root) => ({
    Docver: num(root, '@_docver'),
    Sign: str(root, 'SIGN')
  }),
  X_READY: (root) => ({
    Docver: num(root, '@_docver'),
    UserID: str(root, 'USER_ID'),
    Param: num(root, 'PARAM')
  }),
  X_HEARTBEAT: (root) => ({ Docver: num(root, '@_docver') }),
  X_QUIT: (root) => ({ Docver: num(root, '@_docver') }),
  X_SEND_MSG: (root) => ({
    Docver: num(root, '@_docver'),
    MsgID: num(root, 'MSG_ID'),
    Receipt: num(root, 'RECEIPT'),
    Msg: str(root, 'MSG'),
    MsgTime: num(root, 'MSG_TIME'),
    Offline: num(root, 'OFFLINE'),
    HideRecord: num(root, 'HIDE_RECORD')
  }),
  X_SEND_MSG_ACK: (root) => ({
    Docver: num(root, '@_docver'),
    MsgID: num(root, 'MSG_ID')
  }),
  X_SEND_RECEIPT: (root) => ({
    Docver: num(root, '@_docver'),
    MsgID: num(root, 'MSG_ID')
  })
}

export function decodeXml<K extends XmlTag>(payload: Buffer | string, tag: K): XmlTypes[K] | null {
  const text = typeof payload === 'string' ? payload : payload.toString('utf8')
  if (rootTag(text) !== tag) {
    return null
  }
  const validation = XMLValidator.validate(text)
  if (validation !== true) {
    throw new Error(`私有消息 XML 无效: ${validation.err.msg}`)
  }
  const parsed = parser.parse(text)
  const root = asNode(parsed[tag])
  if (root === null) {
    throw new Error(`私有消息缺少根节点 ${tag}`)
  }
  const decoder = DECODERS[tag] as (node: XmlNode) => XmlTypes[K]
  return decoder(root)
}

function userInfoNode(info: UserInfo): XmlNode {
  const node: XmlNode = {
    CORP_ID: info.CorpID,
    CORP_TIME: info.CorpTime,
    NAME: info.Name,
    GROUP: info.Group,
    CORPORATION: info.Corporation,
    DEPARTMENT: info.Department,
    SEX: info.Sex,
    POST: info.Post,
    TEL: info.Tel,
    MOBILE: info.Mobile,
    EMAIL: info.Email,
    SIGN: info.Sign,
    SYS_FACE: info.SysFace
  }
  if (info.UserFace !== undefined) {
    node.USER_FACE = { '@_id': info.UserFace.ID, '#text': info.UserFace.Data }
  }
  node.STATUS = info.Status
  node.ACTIVE_SEND = info.ActiveSend
  node.ONLINE_POPUP = info.OnlinePopup
  node.HIDE_IP = info.HideIP
  node.COLOR_NAME = info.ColorName
  node.SORT_NAME = info.SortName
  node.DECORATE_NAME = info.DecorateName
  return node
}

const ENCODERS: { [K in XmlTag]: (value: XmlTypes[K]) => XmlNode } = {
  X_HANDSHARK: (value) => ({
    '@_docver': value.Docver,
    FEATURE: {
      MAJOR: value.Feature.Major,
      MINOR: value.Feature.Minor,
      BUILD: value.Feature.Build,
      APP: value.Feature.App,
      MSG: value.Feature.Msg,
      FILE_TRAN: value.Feature.FileTran,
      FOLDER_TRAN: value.Feature.FolderTran,
      REMOTE_ASSISTANCE: value.Feature.RemoteAssistance,
      FILE_SHARE: value.Feature.FileShare,
      QGROUP: value.Feature.QGroup,
      QGROUP_MSG: value.Feature.QGroupMsg,
      QGROUP_FILE: value.Feature.QGroupFile,
      QGROUP_FOLDER: value.Feature.QGroupFolder,
      OFFLINE_MSG: value.Feature.OfflineMsg,
      OFFLINE_FILE: value.Feature.OfflineFile,
      LAN_UPDATE: value.Feature.LanUpdate,
      HIDE_RECORD: value.Feature.HideRecord
    },
    INFO: userInfoNode(value.Info),
    NET: {
      FILE_TRAN_TCP_PORT: value.Net.FileTranTCPPort,
      FILE_TRAN_ENET_PORT: value.Net.FileTranEnetPort,
      FOLDER_TRAN_TCP_PORT: value.Net.FolderTranTCPPort,
      FOLDER_TRAN_ENET_PORT: value.Net.FolderTranEnetPort,
      FILE_TRAN_TCP_REVERSE_PORT: value.Net.FileTranTCPReversePort,
      FILE_TRAN_ENET_REVERSE_PORT: value.Net.FileTranEnetReversePort,
      FOLDER_TRAN_TCP_REVERSE_PORT: value.Net.FolderTranTCPReversePort,
      FOLDER_TRAN_ENET_REVERSE_PORT: value.Net.FolderTranEnetReversePort,
      LAN_UPDATE_HTTP_PORT: value.Net.LanUpdateHTTPPort
    }
  }),
  X_CHANGE_INFO: (value) => ({ '@_docver': value.Docver, ...userInfoNode(value) }),
  X_CHANGE_STATUS: (value) => ({ '@_docver': value.Docver, STATUS: value.Status }),
  X_CHANGE_SIGN: (value) => ({ '@_docver': value.Docver, SIGN: value.Sign }),
  X_READY: (value) => ({
    '@_docver': value.Docver,
    USER_ID: value.UserID,
    PARAM: value.Param
  }),
  X_HEARTBEAT: (value) => ({ '@_docver': value.Docver }),
  X_QUIT: (value) => ({ '@_docver': value.Docver }),
  X_SEND_MSG: (value) => ({
    '@_docver': value.Docver,
    MSG_ID: value.MsgID,
    RECEIPT: value.Receipt,
    MSG: value.Msg,
    MSG_TIME: value.MsgTime,
    OFFLINE: value.Offline,
    HIDE_RECORD: value.HideRecord
  }),
  X_SEND_MSG_ACK: (value) => ({ '@_docver': value.Docver, MSG_ID: value.MsgID }),
  X_SEND_RECEIPT: (value) => ({ '@_docver': value.Docver, MSG_ID: value.MsgID })
}

export function encodeXml<K extends XmlTag>(tag: K, value: XmlTypes[K]): string {
  const encoder = ENCODERS[tag] as (input: XmlTypes[K]) => XmlNode
  return builder.build({ [tag]: encoder(value) })
}

export function encodeHandshake(value: Handshake): string {
  return encodeXml('X_HANDSHARK', value)
}

export function encodeChangeInfo(value: ChangeInfo): string {
  return encodeXml('X_CHANGE_INFO', value)
}

export function encodeChangeStatus(value: ChangeStatus): string {
  return encodeXml('X_CHANGE_STATUS', value)
}

export function encodeChangeSign(value: ChangeSign): string {
  return encodeXml('X_CHANGE_SIGN', value)
}

export function encodeReady(value: Ready): string {
  return encodeXml('X_READY', value)
}

export function encodeHeartbeat(value: Heartbeat): string {
  return encodeXml('X_HEARTBEAT', value)
}

export function encodeQuit(value: Quit): string {
  return encodeXml('X_QUIT', value)
}

export function encodeChatMsg(value: ChatMsg): string {
  return encodeXml('X_SEND_MSG', value)
}

export function encodeChatMsgAck(value: ChatMsgAck): string {
  return encodeXml('X_SEND_MSG_ACK', value)
}

export function encodeChatReceipt(value: ChatReceipt): string {
  return encodeXml('X_SEND_RECEIPT', value)
}
