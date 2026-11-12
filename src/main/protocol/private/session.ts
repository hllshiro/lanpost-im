import { randomBytes } from 'node:crypto'
import { decodeBeacon } from './beacon'
import {
  ENET_CMD_ACK,
  ENET_CMD_CONNECT,
  ENET_CMD_DISCONNECT,
  ENET_CMD_PING,
  ENET_CMD_VERIFY,
  ENET_FLAG_ACK,
  ReliableEnd,
  buildConnectPayload,
  buildVerifyPayload,
  decodeDatagram,
  encodeDatagram,
  parseConnectPayload,
  parseVerifyPayload
} from './enet'
import { decodeFrame, encodeFrame } from './frame'
import {
  handshakeXml,
  heartbeatXml,
  helloFrame,
  operateRecvFileXml,
  operateRecvFolderXml,
  operateSendFileXml,
  operateSendFolderXml,
  parsePrivate,
  progressRecvFileXml,
  quitXml,
  readyXml,
  reverseFileReqXml,
  reverseFolderReqXml,
  groupPushUserXml,
  groupImageXml,
  groupFileXml,
  groupSendXml,
  groupInfoRspXml,
  groupExitXml,
  shareDownloadXml,
  shareDownloadRspXml,
  remindFileXml,
  retrieveImagesXml,
  imageCardXml,
  sendFileXml,
  sendFolderXml,
  sendMsgAckXml,
  sendMsgXml,
  sendReceiptXml
} from './messages'
import type {
  PrivateFileOffer,
  PrivateFolderOffer,
  PrivateGroupFileRef,
  PrivateGroupInfo,
  PrivateGroupMember,
  PrivateImageRef,
  PrivateProfile,
  RemoteProfile
} from './messages'

const CMD_HELLO = 4
const CMD_HANDSHAKE = 1000
const CMD_SEND_MSG = 1004
const CMD_SEND_MSG_ACK = 1005
const CMD_SEND_RECEIPT = 1006
const CMD_SEND_FILE = 1009
const CMD_OPERATE_SEND_FILE = 1010
const CMD_OPERATE_RECV_FILE = 1011
const CMD_PROGRESS_RECV_FILE = 1012
const CMD_SEND_FOLDER = 1013
const CMD_OPERATE_SEND_FOLDER = 1014
const CMD_OPERATE_RECV_FOLDER = 1015
const CMD_HEARTBEAT = 1016
const CMD_QUIT = 1017
const CMD_READY = 1018
const CMD_REVERSE_FILE_REQ = 1019
const CMD_REVERSE_FOLDER_REQ = 1020
const CMD_QGROUP_SEND_MSG = 3011
const CMD_QGROUP_PUSH_USER = 3003
const CMD_QGROUP_REQ_INFO_RSP = 3005
const CMD_QGROUP_EXIT = 3009
const CMD_SHARE_DOWNLOAD = 5004
const CMD_SHARE_DOWNLOAD_RSP = 5005
const CMD_REMIND_FILE = 1025

const COMMAND_MASK = 0x7f
const FRAME_HEADER_SIZE = 8
const ACK_PAYLOAD_SIZE = 4
const CONNECT_HEADER_PEER_ID = 0x0fff
const HANDSHAKE_CHANNEL = 0xff
const HANDSHAKE_SEQ = 1
const ASSIGNED_PEER_ID = 1
// 接收侧（server）自己选定的会话号，写进 VERIFY_CONNECT 载荷第 2、3 字节与出站头部
const SERVER_SESSION_ID = 1

const CONNECT_RETRY_MS = 5000
const CONNECT_MAX_RETRIES = 3
const VERIFY_RETRANSMIT_MS = 500
const VERIFY_MAX_RETRIES = 6
const RETRANSMIT_BACKOFF = 1.5
const HEARTBEAT_INTERVAL_MS = 30_000
const SESSION_TIMEOUT_MS = 120_000

export type SessionState = 'idle' | 'connecting' | 'verifying' | 'handshaking' | 'ready' | 'closed'

export interface SessionCallbacks {
  onText(msgId: number, text: string, images: PrivateImageRef[]): void
  onUnsupported(msgId: number): void
  onAck(msgId: number): void
  onReceipt(msgId: number): void
  onProfile(
    profile: RemoteProfile,
    filePort: number,
    reversePort: number,
    folderPort: number,
    folderReversePort: number
  ): void
  onFileOffer(offer: PrivateFileOffer): void
  onFileOperate(cmd: number, taskId: string, op: number): void
  onFileProgress(taskId: string, totalSize: number, recvdSize: number): void
  onFileReverse(taskId: string): void
  onFolderOffer(offer: PrivateFolderOffer): void
  onFolderOperate(cmd: number, taskId: string, op: number): void
  onFolderReverse(taskId: string): void
  onGroupInfo(info: PrivateGroupInfo): void
  onGroupUsers(info: PrivateGroupInfo, members: PrivateGroupMember[]): void
  onGroupMessage(
    groupId: string,
    msgId: number,
    text: string,
    images: PrivateImageRef[],
    files: PrivateGroupFileRef[]
  ): void
  onGroupReqInfo(groupId: string): void
  onGroupInfoRsp(info: PrivateGroupInfo): void
  onGroupDismiss(groupId: string): void
  onGroupExit(groupId: string): void
  onGroupKick(groupId: string): void
  onShareDownload(reqId: number, shareId: string): void
  onShareDownloadRsp(
    reqId: number,
    err: number,
    fileId: number,
    fileSize: number,
    lastModify: string
  ): void
  // 群成员下载完某个群文件后的回执
  onRemindFile(groupId: string, name: string, size: number): void
  // 对端在 X_READY 里公布的 32 位用户号，群消息靠它识别发送者
  onReady(userId: string): void
  // 已经交给 ENet 的消息重传耗尽，本条消息没有送达
  onSendFailed(msgId: number): void
  onState(state: SessionState): void
  onLog(message: string): void
}

interface PrivateSessionOptions {
  role: 'client' | 'server'
  remoteIp: string
  remotePort: number
  localIp: string
  localPort: number
  identity: { userId: string; peerId: Buffer }
  profile: PrivateProfile
  // 本机私有文件通道的 TCP 监听端口，写进 X_HANDSHARK 的 NET 节点
  filePort?: number
  // 本机私有文件夹通道的 TCP 监听端口，写进 X_HANDSHARK 的 NET 节点
  folderPort?: number
  send: (data: Buffer) => void
  now?: () => number
  callbacks: SessionCallbacks
}

// hello 是明文 304 字节发现报文，按可靠载荷发送，头部长度与类型恰好与
// 应用帧的 [u32 总长][u32 命令] 相同（304 与 4），因此要在解密前先识别
function isHelloPayload(payload: Buffer): boolean {
  return (
    payload.length >= FRAME_HEADER_SIZE &&
    payload.readUInt32BE(0) === payload.length &&
    payload.readUInt32BE(4) === CMD_HELLO
  )
}

function broadcastAddress(ip: string): string {
  const octets = ip.split('.')
  if (octets.length !== 4) {
    throw new Error(`本机地址格式错误: ${ip}`)
  }
  return `${octets[0]}.${octets[1]}.${octets[2]}.255`
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class PrivateSession {
  private readonly role: 'client' | 'server'
  private readonly remoteLabel: string
  private readonly identity: { userId: string; peerId: Buffer }
  private readonly profile: PrivateProfile
  private readonly filePort: number
  private readonly folderPort: number
  private readonly sendRaw: (data: Buffer) => void
  private readonly now: () => number
  private readonly callbacks: SessionCallbacks
  private readonly hello: Buffer
  private currentState: SessionState = 'idle'
  private reliable: ReliableEnd | null = null
  private peerId = 0
  private sessionId = 0
  private connectId = 0
  private verifyDatagram: Buffer | null = null
  private verifySentTime = 0
  private verifySentAt = 0
  private verifyRetries = 0
  private awaitingVerifyAck = false
  private connectSentAt = 0
  private connectRetries = 0
  private lastInboundAt = 0
  private lastHeartbeatAt = 0
  private readySent = false
  // 通道 0 的可靠序号到消息号的映射：确认或丢弃时清理，丢弃时上报发送失败
  private readonly messageSeqs = new Map<number, number>()

  constructor(options: PrivateSessionOptions) {
    this.role = options.role
    this.remoteLabel = `${options.remoteIp}:${options.remotePort}`
    this.identity = options.identity
    this.profile = options.profile
    this.filePort = options.filePort ?? 0
    this.folderPort = options.folderPort ?? 0
    this.sendRaw = options.send
    this.now = options.now ?? Date.now
    this.callbacks = options.callbacks
    this.hello = helloFrame({
      ip: options.localIp,
      broadcast: broadcastAddress(options.localIp),
      userId: options.identity.userId,
      peerId: options.identity.peerId,
      enetPort: options.localPort
    })
    this.lastInboundAt = this.now()
  }

  get state(): SessionState {
    return this.currentState
  }

  // 本次连接使用的 connectID：接收侧取自对端 CONNECT，发送侧取自本端随机值。
  // 服务端用它区分对端重连（新标识）与重复 CONNECT（同标识）。
  get connectIdentifier(): number {
    return this.connectId
  }

  start(): void {
    if (this.role !== 'client' || this.currentState !== 'idle') return
    const now = this.now()
    this.connectId = randomBytes(4).readUInt32BE(0)
    this.lastInboundAt = now
    this.connectSentAt = now
    this.setState('connecting')
    this.sendConnect()
  }

  receive(data: Buffer): void {
    try {
      this.accept(data)
    } catch (error) {
      this.callbacks.onLog(
        `私有会话 ${this.remoteLabel} 丢弃无法解析的数据报: ${describeError(error)}`
      )
    }
  }

  pump(): void {
    if (this.currentState === 'idle' || this.currentState === 'closed') return
    const now = this.now()
    if (now - this.lastInboundAt >= SESSION_TIMEOUT_MS) {
      this.callbacks.onLog(`私有会话 ${this.remoteLabel} 超过 120 秒没有入站报文，关闭`)
      this.shutdown(true)
      return
    }
    this.reliable?.pump()
    if (this.awaitingVerifyAck) {
      this.pumpVerify(now)
    }
    if (this.currentState === 'connecting') {
      this.pumpConnect(now)
      return
    }
    if (this.currentState === 'ready' && now - this.lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
      this.lastHeartbeatAt = now
      this.sendFrame(CMD_HEARTBEAT, heartbeatXml())
    }
  }

  sendText(msgId: number, text: string): boolean {
    if (this.currentState !== 'ready' || this.reliable === null) return false
    const seqs = this.reliable.send(encodeFrame(CMD_SEND_MSG, sendMsgXml(msgId, text)))
    for (const seq of seqs) {
      this.messageSeqs.set(seq, msgId)
    }
    return true
  }

  sendReceipt(msgId: number): void {
    if (this.currentState !== 'ready') {
      this.callbacks.onLog(`私有会话 ${this.remoteLabel} 未就绪，无法发送已读回执 ${msgId}`)
      return
    }
    this.sendFrame(CMD_SEND_RECEIPT, sendReceiptXml(msgId))
  }

  // 文件邀请必须确认已交给 ENet，失败时上层不能进入发送流程
  sendFileOffer(input: {
    taskId: string
    fileId: number
    name: string
    size: number
    lastModify: string
  }): boolean {
    if (this.currentState !== 'ready' || this.reliable === null) return false
    this.reliable.send(encodeFrame(CMD_SEND_FILE, sendFileXml(input)))
    return true
  }

  sendOperateSendFile(taskId: string, op: number): void {
    if (this.currentState !== 'ready') return
    this.sendFrame(CMD_OPERATE_SEND_FILE, operateSendFileXml(taskId, op))
  }

  sendOperateRecvFile(taskId: string, op: number): void {
    if (this.currentState !== 'ready') return
    this.sendFrame(CMD_OPERATE_RECV_FILE, operateRecvFileXml(taskId, op))
  }

  sendFolderOffer(input: {
    taskId: string
    name: string
    size: number
    maxItemPath: number
    maxItemSize: number
  }): boolean {
    if (this.currentState !== 'ready' || this.reliable === null) return false
    this.reliable.send(encodeFrame(CMD_SEND_FOLDER, sendFolderXml(input)))
    return true
  }

  sendOperateSendFolder(taskId: string, op: number): void {
    if (this.currentState !== 'ready') return
    this.sendFrame(CMD_OPERATE_SEND_FOLDER, operateSendFolderXml(taskId, op))
  }

  sendOperateRecvFolder(taskId: string, op: number): void {
    if (this.currentState !== 'ready') return
    this.sendFrame(CMD_OPERATE_RECV_FOLDER, operateRecvFolderXml(taskId, op))
  }

  sendReverseFolderReq(taskId: string): void {
    if (this.currentState !== 'ready') return
    this.sendFrame(CMD_REVERSE_FOLDER_REQ, reverseFolderReqXml(taskId))
  }

  // 群消息与建群推送都走可靠通道；群消息没有 ACK，送达靠 ENet 本身
  sendGroupMessage(groupId: string, msgId: number, text: string): boolean {
    if (this.currentState !== 'ready' || this.reliable === null) return false
    this.reliable.send(encodeFrame(CMD_QGROUP_SEND_MSG, groupSendXml(groupId, msgId, text)))
    return true
  }

  sendGroupPushUser(info: PrivateGroupInfo, members: PrivateGroupMember[]): boolean {
    if (this.currentState !== 'ready' || this.reliable === null) return false
    this.reliable.send(encodeFrame(CMD_QGROUP_PUSH_USER, groupPushUserXml(info, members)))
    return true
  }

  sendGroupImage(groupId: string, msgId: number, value: string): boolean {
    if (this.currentState !== 'ready' || this.reliable === null) return false
    this.reliable.send(encodeFrame(CMD_QGROUP_SEND_MSG, groupImageXml(groupId, msgId, value)))
    return true
  }

  sendGroupFile(input: {
    groupId: string
    msgId: number
    shareId: string
    size: number
    path: string
    folder: boolean
  }): boolean {
    if (this.currentState !== 'ready' || this.reliable === null) return false
    this.reliable.send(encodeFrame(CMD_QGROUP_SEND_MSG, groupFileXml(input)))
    return true
  }

  sendShareDownload(reqId: number, shareId: string): boolean {
    if (this.currentState !== 'ready' || this.reliable === null) return false
    this.reliable.send(encodeFrame(CMD_SHARE_DOWNLOAD, shareDownloadXml(reqId, shareId)))
    return true
  }

  sendShareDownloadRsp(
    reqId: number,
    fileId: number,
    fileSize: number,
    lastModify: string
  ): boolean {
    if (this.currentState !== 'ready' || this.reliable === null) return false
    this.reliable.send(
      encodeFrame(CMD_SHARE_DOWNLOAD_RSP, shareDownloadRspXml(reqId, fileId, fileSize, lastModify))
    )
    return true
  }

  sendRemindFile(groupId: string, size: number, name: string): boolean {
    if (this.currentState !== 'ready' || this.reliable === null) return false
    this.reliable.send(encodeFrame(CMD_REMIND_FILE, remindFileXml(groupId, size, name)))
    return true
  }

  sendGroupInfoRsp(info: PrivateGroupInfo): boolean {
    if (this.currentState !== 'ready' || this.reliable === null) return false
    this.reliable.send(encodeFrame(CMD_QGROUP_REQ_INFO_RSP, groupInfoRspXml(info)))
    return true
  }

  sendGroupExit(groupId: string): boolean {
    if (this.currentState !== 'ready' || this.reliable === null) return false
    this.reliable.send(encodeFrame(CMD_QGROUP_EXIT, groupExitXml(groupId)))
    return true
  }

  // 取图请求：把收到的 img 节点原样回给发送方，请它把原图推过来
  sendRetrieveImages(msgId: number, refs: PrivateImageRef[]): void {
    if (this.currentState !== 'ready' || refs.length === 0) return
    this.sendFrame(CMD_SEND_MSG, retrieveImagesXml(msgId, refs))
  }

  sendProgressRecvFile(taskId: string, totalSize: number, recvdSize: number): void {
    if (this.currentState !== 'ready') return
    this.sendFrame(
      CMD_PROGRESS_RECV_FILE,
      progressRecvFileXml(taskId, totalSize, recvdSize, '未知速度，剩余时间: 未知')
    )
  }

  sendReverseFileReq(taskId: string): void {
    if (this.currentState !== 'ready') return
    this.sendFrame(CMD_REVERSE_FILE_REQ, reverseFileReqXml(taskId))
  }

  sendImageCard(msgId: number, value: string): boolean {
    if (this.currentState !== 'ready' || this.reliable === null) return false
    this.reliable.send(encodeFrame(CMD_SEND_MSG, imageCardXml(msgId, value)))
    return true
  }

  close(): void {
    this.shutdown(true)
  }

  private accept(data: Buffer): void {
    if (this.currentState === 'closed') return
    this.lastInboundAt = this.now()
    if (this.hasDisconnect(data)) {
      this.callbacks.onLog(`私有会话 ${this.remoteLabel} 收到对端 DISCONNECT，关闭`)
      this.shutdown(false)
      return
    }
    if (this.reliable === null) {
      this.acceptHandshake(data)
      return
    }
    if (this.role === 'server' && this.currentState !== 'ready' && this.isRetriedConnect(data)) {
      this.sendVerify()
      return
    }
    const delivered = this.reliable.receive(data)
    if (this.awaitingVerifyAck && (delivered.length > 0 || this.hasVerifyAck(data))) {
      this.openHandshake()
    }
    for (const payload of delivered) {
      this.acceptPayload(payload)
    }
  }

  private acceptHandshake(data: Buffer): void {
    const { commands } = decodeDatagram(data)
    for (const command of commands) {
      const base = command.command & COMMAND_MASK
      if (this.role === 'server' && base === ENET_CMD_CONNECT) {
        this.acceptConnect(command.payload)
        return
      }
      if (this.role === 'client' && base === ENET_CMD_VERIFY) {
        this.acceptVerify(data, command.payload)
        return
      }
    }
    this.callbacks.onLog(`私有会话 ${this.remoteLabel} 在握手完成前收到无关数据报`)
  }

  // 对端重复 CONNECT 说明它还没收到 VERIFY_CONNECT；按原样重发同一条报文，
  // 保持 (序号, sentTime) 不变，这样它对第一份 VERIFY 的 ACK 仍然算数
  private isRetriedConnect(data: Buffer): boolean {
    const { commands } = decodeDatagram(data)
    return commands.some(
      (command) =>
        (command.command & COMMAND_MASK) === ENET_CMD_CONNECT &&
        parseConnectPayload(command.payload).connectId === this.connectId
    )
  }

  private hasVerifyAck(data: Buffer): boolean {
    const { commands } = decodeDatagram(data)
    return commands.some(
      (command) =>
        (command.command & COMMAND_MASK) === ENET_CMD_ACK &&
        command.payload.length >= ACK_PAYLOAD_SIZE &&
        command.payload.readUInt16BE(0) === HANDSHAKE_SEQ &&
        command.payload.readUInt16BE(2) === this.verifySentTime
    )
  }

  private hasDisconnect(data: Buffer): boolean {
    const { commands } = decodeDatagram(data)
    return commands.some((command) => (command.command & COMMAND_MASK) === ENET_CMD_DISCONNECT)
  }

  private acceptConnect(payload: Buffer): void {
    const { connectId } = parseConnectPayload(payload)
    const outgoingPeerId = payload.readUInt16BE(0)
    this.connectId = connectId
    this.peerId = outgoingPeerId
    this.sessionId = SERVER_SESSION_ID
    this.setState('verifying')
    this.awaitingVerifyAck = true
    this.sendVerify()
    this.reliable = this.createReliable(outgoingPeerId, this.sessionId)
  }

  // 对端的 ACK 或任意可靠负载都能证明它收到了 VERIFY_CONNECT；
  // 先发出自己的 hello 与 X_HANDSHARK，再处理触发本次放行的负载
  private openHandshake(): void {
    if (!this.awaitingVerifyAck) return
    this.awaitingVerifyAck = false
    this.setState('handshaking')
    this.sendHello()
    this.sendHandshake()
  }

  private acceptVerify(data: Buffer, payload: Buffer): void {
    const { peerId, connectId, outgoingSessionId } = parseVerifyPayload(payload)
    if (connectId !== this.connectId) {
      this.callbacks.onLog(
        `私有会话 ${this.remoteLabel} 收到连接标识 ${connectId} 的 VERIFY_CONNECT，与本次连接 ${this.connectId} 不一致，忽略`
      )
      return
    }
    this.setState('verifying')
    this.peerId = peerId
    this.sessionId = outgoingSessionId
    this.reliable = this.createReliable(peerId, outgoingSessionId)
    const delivered = this.reliable.receive(data)
    this.sendPing()
    this.setState('handshaking')
    this.sendHello()
    this.sendHandshake()
    for (const item of delivered) {
      this.acceptPayload(item)
    }
  }

  private createReliable(peerId: number, sessionId: number): ReliableEnd {
    return new ReliableEnd({
      peerId,
      sessionId,
      send: this.sendRaw,
      now: this.now,
      onAck: (seq) => this.messageSeqs.delete(seq),
      onDrop: (seq) => this.handleDrop(seq),
      onReject: (seq, error) =>
        this.callbacks.onLog(
          `私有会话 ${this.remoteLabel} 丢弃无法解析的可靠命令 ${seq}: ${describeError(error)}`
        )
    })
  }

  // 重传耗尽说明这条链路已经不可用：把对应消息标记失败，再关闭会话交给上层重连。
  // 已经交给 ENet 的消息不再回落 IPMSG，避免对端界面出现两条内容相同的消息。
  private handleDrop(seq: number): void {
    if (this.currentState === 'closed') return
    const msgId = this.messageSeqs.get(seq)
    this.messageSeqs.delete(seq)
    this.callbacks.onLog(
      msgId === undefined
        ? `私有会话 ${this.remoteLabel} 可靠序号 ${seq} 重传耗尽，关闭会话`
        : `私有会话 ${this.remoteLabel} 消息 ${msgId} 重传耗尽，标记发送失败并关闭会话`
    )
    if (msgId !== undefined) {
      this.callbacks.onSendFailed(msgId)
    }
    this.shutdown(false)
  }

  private sendConnect(): void {
    this.sendRaw(
      encodeDatagram(CONNECT_HEADER_PEER_ID, this.now(), [
        {
          command: ENET_CMD_CONNECT | ENET_FLAG_ACK,
          channelId: HANDSHAKE_CHANNEL,
          reliableSeq: HANDSHAKE_SEQ,
          payload: buildConnectPayload(this.connectId)
        }
      ])
    )
  }

  private sendVerify(): void {
    if (this.verifyDatagram === null) {
      const now = this.now()
      this.verifySentTime = now & 0xffff
      this.verifyDatagram = encodeDatagram(
        this.peerId,
        this.verifySentTime,
        [
          {
            command: ENET_CMD_VERIFY | ENET_FLAG_ACK,
            channelId: HANDSHAKE_CHANNEL,
            reliableSeq: HANDSHAKE_SEQ,
            payload: buildVerifyPayload(ASSIGNED_PEER_ID, this.connectId, this.sessionId)
          }
        ],
        this.sessionId
      )
    }
    this.verifySentAt = this.now()
    this.sendRaw(this.verifyDatagram)
  }

  private sendPing(): void {
    this.sendRaw(
      encodeDatagram(
        this.peerId,
        this.now(),
        [
          {
            command: ENET_CMD_PING | ENET_FLAG_ACK,
            channelId: HANDSHAKE_CHANNEL,
            reliableSeq: HANDSHAKE_SEQ + 1,
            payload: Buffer.alloc(0)
          }
        ],
        this.sessionId
      )
    )
  }

  private sendHello(): void {
    this.reliable?.send(this.hello)
  }

  private sendHandshake(): void {
    this.sendFrame(
      CMD_HANDSHAKE,
      handshakeXml(this.profile, this.identity.userId, this.filePort, this.folderPort)
    )
  }

  private sendFrame(cmd: number, xml: string): void {
    this.reliable?.send(encodeFrame(cmd, xml))
  }

  private acceptPayload(payload: Buffer): void {
    if (isHelloPayload(payload)) {
      const beacon = decodeBeacon(payload)
      this.callbacks.onLog(
        beacon === null
          ? `私有会话 ${this.remoteLabel} 收到无法解析的 hello`
          : `私有会话 ${this.remoteLabel} 收到 hello，对端 ENet 端口 ${beacon.enetPort}`
      )
      return
    }
    const { cmd, xml } = decodeFrame(payload)
    if (cmd === CMD_SEND_FILE) {
      this.callbacks.onLog(`私有文件邀请原文 ${xml}`)
    }
    // 群里的文件走“离线文件”节点，研究阶段先把原文打出来
    if (cmd === 3011 && xml.includes('file2')) {
      this.callbacks.onLog(`私有群文件消息原文 ${xml.slice(0, 4000)}`)
    }
    const incoming = parsePrivate(cmd, xml)
    switch (incoming.kind) {
      case 'text':
        this.sendFrame(CMD_SEND_MSG_ACK, sendMsgAckXml(incoming.msgId))
        this.callbacks.onText(incoming.msgId, incoming.text, incoming.images)
        return
      case 'text-unsupported':
        this.sendFrame(CMD_SEND_MSG_ACK, sendMsgAckXml(incoming.msgId))
        this.callbacks.onUnsupported(incoming.msgId)
        return
      case 'ack':
        this.callbacks.onAck(incoming.msgId)
        return
      case 'receipt':
        this.callbacks.onReceipt(incoming.msgId)
        return
      case 'handshake':
        this.callbacks.onProfile(
          incoming.profile,
          incoming.filePort,
          incoming.reversePort,
          incoming.folderPort,
          incoming.folderReversePort
        )
        if (incoming.filePort > 0 || incoming.reversePort > 0) {
          this.callbacks.onLog(
            `私有会话 ${this.remoteLabel} 对端文件端口 ${incoming.filePort}，反向端口 ${incoming.reversePort}`
          )
        }
        if (incoming.folderPort > 0 || incoming.folderReversePort > 0) {
          this.callbacks.onLog(
            `私有会话 ${this.remoteLabel} 对端文件夹端口 ${incoming.folderPort}，反向端口 ${incoming.folderReversePort}`
          )
        }
        if (!this.readySent) {
          this.readySent = true
          this.sendFrame(CMD_READY, readyXml(this.identity.userId))
        }
        return
      case 'file-offer':
        this.callbacks.onFileOffer(incoming.offer)
        return
      case 'file-operate':
        this.callbacks.onFileOperate(incoming.cmd, incoming.taskId, incoming.op)
        return
      case 'file-progress':
        this.callbacks.onFileProgress(incoming.taskId, incoming.totalSize, incoming.recvdSize)
        return
      case 'file-reverse':
        this.callbacks.onFileReverse(incoming.taskId)
        return
      case 'folder-offer':
        this.callbacks.onFolderOffer(incoming.offer)
        return
      case 'folder-operate':
        this.callbacks.onFolderOperate(incoming.cmd, incoming.taskId, incoming.op)
        return
      case 'folder-reverse':
        this.callbacks.onFolderReverse(incoming.taskId)
        return
      case 'group-info':
        this.callbacks.onGroupInfo(incoming.info)
        return
      case 'group-user':
        this.callbacks.onGroupUsers(incoming.info, incoming.members)
        return
      case 'group-req-info':
        this.callbacks.onGroupReqInfo(incoming.groupId)
        return
      case 'group-info-rsp':
        this.callbacks.onGroupInfoRsp(incoming.info)
        return
      case 'group-dismiss':
        this.callbacks.onGroupDismiss(incoming.groupId)
        return
      case 'group-exit':
        this.callbacks.onGroupExit(incoming.groupId)
        return
      case 'group-kick':
        this.callbacks.onGroupKick(incoming.groupId)
        return
      case 'group-message':
        this.callbacks.onGroupMessage(
          incoming.groupId,
          incoming.msgId,
          incoming.text,
          incoming.images,
          incoming.files
        )
        return
      case 'share-download':
        this.callbacks.onShareDownload(incoming.reqId, incoming.shareId)
        return
      case 'share-download-rsp':
        this.callbacks.onShareDownloadRsp(
          incoming.reqId,
          incoming.err,
          incoming.fileId,
          incoming.fileSize,
          incoming.lastModify
        )
        return
      case 'remind-file':
        this.callbacks.onRemindFile(incoming.groupId, incoming.name, incoming.size)
        return
      case 'ready':
        this.callbacks.onReady(incoming.userId)
        if (this.currentState === 'handshaking') {
          this.enterReady()
        }
        return
      case 'heartbeat':
        return
      case 'quit':
        this.shutdown(false)
        return
      default:
        this.callbacks.onLog(
          `私有会话 ${this.remoteLabel} 忽略命令 ${incoming.cmd}：${xml.slice(0, 4000)}`
        )
    }
  }

  private enterReady(): void {
    this.lastHeartbeatAt = this.now()
    this.setState('ready')
  }

  private pumpConnect(now: number): void {
    if (now - this.connectSentAt < CONNECT_RETRY_MS) return
    if (this.connectRetries >= CONNECT_MAX_RETRIES) {
      this.callbacks.onLog(
        `私有会话 ${this.remoteLabel} 重试 ${CONNECT_MAX_RETRIES} 次仍未收到 VERIFY_CONNECT，关闭`
      )
      this.shutdown(true)
      return
    }
    this.connectRetries += 1
    this.connectSentAt = now
    this.sendConnect()
  }

  // ACK 丢失时按 500ms 起步、1.5 倍退避重发同一条 VERIFY_CONNECT
  private pumpVerify(now: number): void {
    const interval = VERIFY_RETRANSMIT_MS * RETRANSMIT_BACKOFF ** this.verifyRetries
    if (now - this.verifySentAt < interval) return
    if (this.verifyRetries >= VERIFY_MAX_RETRIES) return
    this.verifyRetries += 1
    this.sendVerify()
  }

  // 关闭时放弃重传队列；对端已被判定超时的情况下只改状态，不再发 X_QUIT
  private shutdown(sendQuit: boolean): void {
    if (this.currentState === 'closed') return
    if (sendQuit && this.reliable !== null) {
      this.reliable.send(encodeFrame(CMD_QUIT, quitXml()))
    }
    this.reliable = null
    this.setState('closed')
  }

  private setState(state: SessionState): void {
    if (this.currentState === state) return
    this.currentState = state
    this.callbacks.onState(state)
  }
}
