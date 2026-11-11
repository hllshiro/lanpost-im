import { randomBytes } from 'node:crypto'
import { decodeBeacon } from './beacon'
import {
  ENET_CMD_ACK,
  ENET_CMD_CONNECT,
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
  parsePrivate,
  quitXml,
  readyXml,
  sendMsgAckXml,
  sendMsgXml,
  sendReceiptXml
} from './messages'
import type { PrivateProfile, RemoteProfile } from './messages'

const CMD_HELLO = 4
const CMD_HANDSHAKE = 1000
const CMD_SEND_MSG = 1004
const CMD_SEND_MSG_ACK = 1005
const CMD_SEND_RECEIPT = 1006
const CMD_HEARTBEAT = 1016
const CMD_QUIT = 1017
const CMD_READY = 1018

const COMMAND_MASK = 0x7f
const FRAME_HEADER_SIZE = 8
const ACK_PAYLOAD_SIZE = 4
const CONNECT_HEADER_PEER_ID = 0x0fff
const HANDSHAKE_CHANNEL = 0xff
const HANDSHAKE_SEQ = 1
const ASSIGNED_PEER_ID = 1

const CONNECT_RETRY_MS = 5000
const CONNECT_MAX_RETRIES = 3
const HEARTBEAT_INTERVAL_MS = 30_000
const SESSION_TIMEOUT_MS = 120_000

export type SessionState = 'idle' | 'connecting' | 'verifying' | 'handshaking' | 'ready' | 'closed'

export interface SessionCallbacks {
  onText(msgId: number, text: string): void
  onUnsupported(msgId: number): void
  onAck(msgId: number): void
  onReceipt(msgId: number): void
  onProfile(profile: RemoteProfile): void
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
  private readonly sendRaw: (data: Buffer) => void
  private readonly now: () => number
  private readonly callbacks: SessionCallbacks
  private readonly hello: Buffer
  private currentState: SessionState = 'idle'
  private reliable: ReliableEnd | null = null
  private peerId = 0
  private connectId = 0
  private verifyDatagram: Buffer | null = null
  private verifySentTime = 0
  private awaitingVerifyAck = false
  private connectSentAt = 0
  private connectRetries = 0
  private lastInboundAt = 0
  private lastHeartbeatAt = 0
  private readySent = false

  constructor(options: PrivateSessionOptions) {
    this.role = options.role
    this.remoteLabel = `${options.remoteIp}:${options.remotePort}`
    this.identity = options.identity
    this.profile = options.profile
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
    this.reliable.send(encodeFrame(CMD_SEND_MSG, sendMsgXml(msgId, text)))
    return true
  }

  sendReceipt(msgId: number): void {
    if (this.currentState !== 'ready') {
      this.callbacks.onLog(`私有会话 ${this.remoteLabel} 未就绪，无法发送已读回执 ${msgId}`)
      return
    }
    this.sendFrame(CMD_SEND_RECEIPT, sendReceiptXml(msgId))
  }

  close(): void {
    this.shutdown(true)
  }

  private accept(data: Buffer): void {
    if (this.currentState === 'closed') return
    this.lastInboundAt = this.now()
    if (this.reliable === null) {
      this.acceptHandshake(data)
      return
    }
    if (this.role === 'server' && this.currentState !== 'ready' && this.isRetriedConnect(data)) {
      this.sendVerify()
      return
    }
    const delivered = this.reliable.receive(data)
    if (this.awaitingVerifyAck && this.hasVerifyAck(data)) {
      this.awaitingVerifyAck = false
      this.setState('handshaking')
      this.sendHello()
      this.sendHandshake()
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

  private acceptConnect(payload: Buffer): void {
    const { connectId } = parseConnectPayload(payload)
    const outgoingPeerId = payload.readUInt16BE(0)
    this.connectId = connectId
    this.peerId = outgoingPeerId
    this.setState('verifying')
    this.sendVerify()
    this.reliable = new ReliableEnd({
      peerId: outgoingPeerId,
      send: this.sendRaw,
      now: this.now
    })
    this.awaitingVerifyAck = true
  }

  private acceptVerify(data: Buffer, payload: Buffer): void {
    const { peerId, connectId } = parseVerifyPayload(payload)
    if (connectId !== this.connectId) {
      this.callbacks.onLog(
        `私有会话 ${this.remoteLabel} 收到连接标识 ${connectId} 的 VERIFY_CONNECT，与本次连接 ${this.connectId} 不一致，忽略`
      )
      return
    }
    this.setState('verifying')
    this.peerId = peerId
    this.reliable = new ReliableEnd({ peerId, send: this.sendRaw, now: this.now })
    const delivered = this.reliable.receive(data)
    this.sendPing()
    this.setState('handshaking')
    this.sendHello()
    this.sendHandshake()
    for (const item of delivered) {
      this.acceptPayload(item)
    }
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
    if (this.verifyDatagram !== null) {
      this.sendRaw(this.verifyDatagram)
      return
    }
    const sentTime = this.now() & 0xffff
    this.verifySentTime = sentTime
    this.verifyDatagram = encodeDatagram(this.peerId, sentTime, [
      {
        command: ENET_CMD_VERIFY | ENET_FLAG_ACK,
        channelId: HANDSHAKE_CHANNEL,
        reliableSeq: HANDSHAKE_SEQ,
        payload: buildVerifyPayload(ASSIGNED_PEER_ID, this.connectId)
      }
    ])
    this.sendRaw(this.verifyDatagram)
  }

  private sendPing(): void {
    this.sendRaw(
      encodeDatagram(this.peerId, this.now(), [
        {
          command: ENET_CMD_PING | ENET_FLAG_ACK,
          channelId: HANDSHAKE_CHANNEL,
          reliableSeq: HANDSHAKE_SEQ + 1,
          payload: Buffer.alloc(0)
        }
      ])
    )
  }

  private sendHello(): void {
    this.reliable?.send(this.hello)
  }

  private sendHandshake(): void {
    this.sendFrame(CMD_HANDSHAKE, handshakeXml(this.profile, this.identity.userId))
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
    const incoming = parsePrivate(cmd, xml)
    switch (incoming.kind) {
      case 'text':
        this.sendFrame(CMD_SEND_MSG_ACK, sendMsgAckXml(incoming.msgId))
        this.callbacks.onText(incoming.msgId, incoming.text)
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
        this.callbacks.onProfile(incoming.profile)
        if (!this.readySent) {
          this.readySent = true
          this.sendFrame(CMD_READY, readyXml(this.identity.userId))
        }
        return
      case 'ready':
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
        this.callbacks.onLog(`私有会话 ${this.remoteLabel} 忽略命令 ${incoming.cmd}`)
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
