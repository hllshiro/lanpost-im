import { createHash } from 'node:crypto'
import { createSocket, type RemoteInfo, type Socket } from 'node:dgram'
import { networkInterfaces } from 'node:os'
import type { PeerInfo } from '../../shared/domain'
import {
  CMD_ANSENTRY,
  CMD_CHANGE_INFO,
  CMD_CHANGE_SIGN,
  CMD_CHANGE_STATUS,
  CMD_CHATMSG,
  CMD_CHATMSG_ACK,
  CMD_CHAT_RECEIPT,
  CMD_ENTRY,
  CMD_EXIT,
  CMD_FILEATTACH,
  CMD_HANDSHAKE,
  CMD_HEARTBEAT,
  CMD_QUIT,
  CMD_READY,
  CMD_RECVMSG,
  CMD_SENDCHECK,
  CMD_SENDMSG,
  CMD_UTF8
} from './commands'
import { parseOffer } from './attach'
import { decodeText, encodeText } from './encoding'
import {
  decodeXml,
  encodeChangeSign,
  encodeChangeStatus,
  encodeChatMsg,
  encodeChatMsgAck,
  encodeChatReceipt,
  encodeHandshake,
  encodeHeartbeat,
  encodeQuit,
  encodeReady,
  type Handshake,
  type NetPorts
} from './xml'
import { DOCVER, DecodeCompat, Encode, IsLegacy, SplitNul, TrimNul, type Header } from './packet'

const HEARTBEAT_INTERVAL_MS = 30_000
const OFFLINE_TIMEOUT_MS = 120_000
const ANSENTRY_INTERVAL_MS = 30_000
const HANDSHAKE_INTERVAL_MS = 10_000
const HANDSHAKE_MAX_TRIES = 3
const FEATURE_TEMPLATE = {
  Major: '3',
  Minor: '4',
  Build: '3055',
  App: '1',
  Msg: '1',
  FileTran: '1',
  FolderTran: '1',
  RemoteAssistance: '0',
  FileShare: '0',
  QGroup: '1',
  QGroupMsg: '1',
  QGroupFile: '0',
  QGroupFolder: '0',
  OfflineMsg: '0',
  OfflineFile: '0',
  LanUpdate: '0',
  HideRecord: '0'
}

export interface ProtocolConfig {
  name: string
  account: string
  host: string
  group: string
  corporation: string
  department: string
  sign: string
  status: number
  port: number
  bindAddr: string
  subnets: string[]
  seeds: string[]
  // 广播间隔，单位秒，与设置的 broadcastInterval 一致。
  broadcastInterval: number
  corpId?: string
  userId?: string
}

export interface ProtocolPeer {
  key: string
  ip: string
  port: number
  user: string
  host: string
  name: string
  group: string
  corporation: string
  department: string
  sign: string
  status: number
  corpId: string
  ports: NetPorts
  online: boolean
  ready: boolean
  legacy: boolean
  firstSeen: number
  lastSeen: number
}

export type MessageStatus = 'delivered' | 'read'

export interface ProtocolCallbacks {
  onPeers(peers: ProtocolPeer[]): void
  onMessage(peer: ProtocolPeer, text: string, remoteSeq: number, legacy: boolean): void
  onMessageStatus(peerKey: string, seq: number, status: MessageStatus): void
  onLog(message: string): void
  onError(error: Error): void
}

interface SeedTarget {
  ip: string
  port: number
}

function emptyPorts(): NetPorts {
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

function clonePeer(peer: ProtocolPeer): ProtocolPeer {
  return { ...peer, ports: { ...peer.ports } }
}

export function toPeerInfo(peer: ProtocolPeer): PeerInfo {
  return {
    key: peer.key,
    ip: peer.ip,
    port: peer.port,
    user: peer.user,
    host: peer.host,
    name: peer.name,
    group: peer.group,
    corporation: peer.corporation,
    department: peer.department,
    sign: peer.sign,
    status: peer.status,
    corpId: peer.corpId,
    online: peer.online,
    ready: peer.ready,
    legacy: peer.legacy,
    lastSeen: peer.lastSeen,
    unread: 0,
    alias: ''
  }
}

function ipv4ToNumber(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) {
    return null
  }
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null
    }
    const octet = Number(part)
    if (octet > 255) {
      return null
    }
    value = (value * 256 + octet) >>> 0
  }
  return value
}

function numberToIpv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 0xff).join('.')
}

function broadcastOf(ip: string, netmask: string): string | null {
  const address = ipv4ToNumber(ip)
  const mask = ipv4ToNumber(netmask)
  if (address === null || mask === null) {
    return null
  }
  return numberToIpv4((address | (~mask >>> 0)) >>> 0)
}

function subnetBroadcast(cidr: string): string | null {
  const [address, prefixText] = cidr.split('/')
  const parsed = ipv4ToNumber(address)
  if (parsed === null || !/^\d{1,2}$/.test(prefixText)) {
    return null
  }
  const prefix = Number(prefixText)
  if (prefix > 32) {
    return null
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return numberToIpv4((parsed | (~mask >>> 0)) >>> 0)
}

function parseSeed(seed: string, defaultPort: number): SeedTarget | null {
  const trimmed = seed.trim()
  if (trimmed === '') {
    return null
  }
  const colon = trimmed.lastIndexOf(':')
  const ip = colon >= 0 ? trimmed.slice(0, colon) : trimmed
  const port = colon >= 0 ? Number(trimmed.slice(colon + 1)) : defaultPort
  if (ipv4ToNumber(ip) === null || !Number.isInteger(port) || port < 1 || port > 65535) {
    return null
  }
  return { ip, port }
}

function normalizeConfig(config: ProtocolConfig): ProtocolConfig {
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error(`协议端口无效: ${config.port}`)
  }
  return {
    ...config,
    corpId: config.corpId ?? '',
    bindAddr: config.bindAddr === '' ? '0.0.0.0' : config.bindAddr,
    subnets: [...config.subnets],
    seeds: [...config.seeds],
    broadcastInterval: config.broadcastInterval > 0 ? config.broadcastInterval : 30
  }
}

export class ProtocolEngine {
  private config: ProtocolConfig
  private readonly callbacks: ProtocolCallbacks
  private readonly peers = new Map<string, ProtocolPeer>()
  private readonly handshakeAt = new Map<string, number>()
  private readonly handshakeTries = new Map<string, number>()
  private readonly ansEntryAt = new Map<string, number>()
  private readonly pendingSends = new Set<Promise<void>>()
  private socket: Socket | null = null
  private broadcastTargets: string[] = []
  private seq = Math.floor(Date.now() / 1000)
  private announceTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null

  constructor(config: ProtocolConfig, callbacks: ProtocolCallbacks) {
    this.config = normalizeConfig(config)
    this.callbacks = callbacks
  }

  async start(): Promise<void> {
    if (this.socket !== null) {
      throw new Error('协议引擎已经启动')
    }
    const socket = createSocket({ type: 'udp4', reuseAddr: true })
    this.socket = socket
    socket.on('message', (data, rinfo) => this.handle(data, rinfo))
    socket.on('error', (error) => this.callbacks.onError(error))
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        socket.removeListener('listening', onListening)
        this.socket = null
        reject(
          new Error(`绑定 UDP ${this.config.bindAddr}:${this.config.port} 失败: ${error.message}`)
        )
      }
      const onListening = (): void => {
        socket.removeListener('error', onError)
        resolve()
      }
      socket.once('error', onError)
      socket.once('listening', onListening)
      socket.bind({ address: this.config.bindAddr, port: this.config.port })
    })
    socket.setBroadcast(true)
    this.refreshBroadcastTargets()
    this.startTimers()
    this.log(`协议引擎启动: ${this.config.account}@${this.config.host} UDP ${this.config.port}`)
    this.announce()
  }

  async stop(): Promise<void> {
    const socket = this.socket
    if (socket === null) {
      return
    }
    this.stopTimers()
    this.broadcast(CMD_EXIT, Buffer.alloc(0))
    const quit = Buffer.from(encodeQuit({ Docver: DOCVER }), 'utf8')
    const online = [...this.peers.values()].filter((peer) => peer.online)
    this.log(`关闭协议引擎，通知 ${online.length} 个在线联系人`)
    for (const peer of online) {
      this.sendPacket(peer, CMD_QUIT, quit, false)
    }
    await Promise.allSettled([...this.pendingSends])
    this.socket = null
    await new Promise<void>((resolve) => {
      socket.close(() => resolve())
    })
  }

  getPeers(): ProtocolPeer[] {
    return [...this.peers.values()].map(clonePeer).sort(comparePeers)
  }

  sendText(peerKey: string, text: string): number {
    const peer = this.peers.get(peerKey)
    if (peer === undefined) {
      throw new Error(`未知联系人: ${peerKey}`)
    }
    if (peer.legacy) {
      const encoded = encodeText(text)
      const cmd = CMD_SENDMSG | CMD_SENDCHECK | (encoded.utf8 ? CMD_UTF8 : 0)
      return this.sendPacket(peer, cmd, encoded.data, true)
    }
    const seq = this.nextSeq()
    const payload = Buffer.from(
      encodeChatMsg({
        Docver: DOCVER,
        MsgID: seq,
        Receipt: 1,
        Msg: text,
        MsgTime: Math.floor(Date.now() / 1000),
        Offline: 0,
        HideRecord: 0
      }),
      'utf8'
    )
    this.sendRaw(
      peer.ip,
      peer.port,
      Encode({
        seq,
        user: this.config.account,
        host: this.config.host,
        cmd: CMD_CHATMSG,
        payload,
        legacy: false
      })
    )
    return seq
  }

  sendReadReceipt(peerKey: string, msgId: number): void {
    const peer = this.peers.get(peerKey)
    if (peer === undefined) {
      throw new Error(`未知联系人: ${peerKey}`)
    }
    const payload = Buffer.from(encodeChatReceipt({ Docver: DOCVER, MsgID: msgId }), 'utf8')
    this.sendPacket(peer, CMD_CHAT_RECEIPT, payload, false)
  }

  updateStatus(status: number): void {
    this.config.status = status
    if (this.socket === null) {
      return
    }
    const payload = Buffer.from(encodeChangeStatus({ Docver: DOCVER, Status: status }), 'utf8')
    for (const peer of this.peers.values()) {
      if (peer.online) {
        this.sendPacket(peer, CMD_CHANGE_STATUS, payload, false)
      }
    }
  }

  updateProfile(patch: Partial<ProtocolConfig>): void {
    const previous = this.config
    const next = normalizeConfig({
      ...previous,
      ...patch,
      subnets: patch.subnets ?? previous.subnets,
      seeds: patch.seeds ?? previous.seeds,
      corpId: patch.corpId ?? previous.corpId
    })
    if (
      this.socket !== null &&
      (next.port !== previous.port || next.bindAddr !== previous.bindAddr)
    ) {
      next.port = previous.port
      next.bindAddr = previous.bindAddr
      this.log('端口与监听地址修改后需要重启协议引擎才能生效')
    }
    this.config = next
    if (this.socket === null) {
      return
    }
    if (patch.subnets !== undefined) {
      this.refreshBroadcastTargets()
    }
    if (next.broadcastInterval !== previous.broadcastInterval) {
      this.restartAnnounceTimer()
    }
    if (next.status !== previous.status) {
      this.updateStatus(next.status)
    }
    if (next.sign !== previous.sign) {
      this.broadcastChangeSign()
    }
    if (
      next.name !== previous.name ||
      next.group !== previous.group ||
      next.corpId !== previous.corpId
    ) {
      this.announce()
      this.broadcastHandshake()
    }
    if (next.corporation !== previous.corporation || next.department !== previous.department) {
      this.broadcastHandshake()
    }
  }

  private nextSeq(): number {
    this.seq = (this.seq + 1) >>> 0
    return this.seq
  }

  private log(message: string): void {
    this.callbacks.onLog(message)
  }

  private startTimers(): void {
    this.restartAnnounceTimer()
    this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_INTERVAL_MS)
    this.heartbeatTimer.unref()
  }

  private restartAnnounceTimer(): void {
    if (this.announceTimer !== null) {
      clearInterval(this.announceTimer)
    }
    this.announceTimer = setInterval(() => this.announce(), this.config.broadcastInterval * 1000)
    this.announceTimer.unref()
  }

  private stopTimers(): void {
    if (this.announceTimer !== null) {
      clearInterval(this.announceTimer)
      this.announceTimer = null
    }
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private refreshBroadcastTargets(): void {
    const targets = new Set<string>(['255.255.255.255'])
    for (const addresses of Object.values(networkInterfaces())) {
      for (const info of addresses ?? []) {
        if (String(info.family) !== 'IPv4' || info.internal) {
          continue
        }
        const broadcast = broadcastOf(info.address, info.netmask)
        if (broadcast !== null) {
          targets.add(broadcast)
        }
      }
    }
    for (const subnet of this.config.subnets) {
      const trimmed = subnet.trim()
      if (trimmed === '') {
        continue
      }
      if (trimmed.includes('/')) {
        const broadcast = subnetBroadcast(trimmed)
        if (broadcast === null) {
          this.log(`无法解析广播网段: ${trimmed}`)
          continue
        }
        targets.add(broadcast)
        continue
      }
      targets.add(trimmed)
    }
    this.broadcastTargets = [...targets]
  }

  private entryPayload(): Buffer {
    const corpId = this.config.corpId ?? ''
    const raw = `${this.config.name}\u0000${this.config.group}\u0000${corpId}\u0000`
    return encodeText(raw).data
  }

  private announce(): void {
    const payload = this.entryPayload()
    this.broadcast(CMD_ENTRY, payload)
    for (const seed of this.config.seeds) {
      const target = parseSeed(seed, this.config.port)
      if (target === null) {
        this.log(`忽略无法解析的种子地址: ${seed}`)
        continue
      }
      const seq = this.nextSeq()
      const data = Encode({
        seq,
        user: this.config.account,
        host: this.config.host,
        cmd: CMD_ENTRY,
        payload,
        legacy: true
      })
      this.sendRaw(target.ip, target.port, data)
    }
  }

  private heartbeat(): void {
    const now = Date.now()
    const payload = Buffer.from(encodeHeartbeat({ Docver: DOCVER }), 'utf8')
    let changed = false
    for (const peer of this.peers.values()) {
      if (peer.online && peer.ready && now - peer.lastSeen < OFFLINE_TIMEOUT_MS) {
        this.sendPacket(peer, CMD_HEARTBEAT, payload, false)
      }
    }
    for (const peer of this.peers.values()) {
      if (peer.online && now - peer.lastSeen >= OFFLINE_TIMEOUT_MS) {
        peer.online = false
        changed = true
      }
    }
    if (changed) {
      this.emitPeers()
    }
  }

  private broadcast(cmd: number, payload: Buffer): void {
    if (this.socket === null) {
      return
    }
    const seq = this.nextSeq()
    const data = Encode({
      seq,
      user: this.config.account,
      host: this.config.host,
      cmd,
      payload,
      legacy: false
    })
    for (const address of this.broadcastTargets) {
      this.sendRaw(address, this.config.port, data, true)
    }
  }

  private sendPacket(
    peer: ProtocolPeer,
    cmd: number,
    payload: Buffer,
    legacy = IsLegacy(cmd)
  ): number {
    const seq = this.nextSeq()
    const data = Encode({
      seq,
      user: this.config.account,
      host: this.config.host,
      cmd,
      payload,
      legacy
    })
    this.sendRaw(peer.ip, peer.port, data)
    return seq
  }

  private sendRaw(ip: string, port: number, data: Buffer, quiet = false): void {
    const socket = this.socket
    if (socket === null) {
      return
    }
    const pending = new Promise<void>((resolve) => {
      socket.send(data, port, ip, (error) => {
        if (error !== null && !quiet) {
          this.log(`发送到 ${ip}:${port} 失败: ${error.message}`)
        }
        resolve()
      })
    })
    this.pendingSends.add(pending)
    void pending.then(() => this.pendingSends.delete(pending))
  }

  private handle(data: Buffer, rinfo: RemoteInfo): void {
    let header: Header
    try {
      header = DecodeCompat(data)
    } catch (error) {
      this.log(`忽略无法解析的报文: ${(error as Error).message}`)
      return
    }
    if (header.user === this.config.account && header.host === this.config.host) {
      return
    }
    const key = `${rinfo.address}|${header.user}`
    const now = Date.now()
    let peer = this.peers.get(key)
    if (peer === undefined) {
      peer = {
        key,
        ip: rinfo.address,
        port: rinfo.port,
        user: header.user,
        host: header.host,
        name: '',
        group: '',
        corporation: '',
        department: '',
        sign: '',
        status: 0,
        corpId: '',
        ports: emptyPorts(),
        online: true,
        ready: false,
        legacy: header.legacy,
        firstSeen: now,
        lastSeen: now
      }
      this.peers.set(key, peer)
    }
    peer.ip = rinfo.address
    peer.port = rinfo.port
    peer.user = header.user
    peer.host = header.host
    peer.legacy = header.legacy
    peer.lastSeen = now
    peer.online = true
    try {
      this.dispatch(peer, header)
    } catch (error) {
      this.log(`处理报文失败: ${(error as Error).message}`)
    }
    this.emitPeers()
  }

  private dispatch(peer: ProtocolPeer, header: Header): void {
    const cmd = header.cmd
    if (cmd === CMD_ENTRY) {
      this.handleEntry(peer, header)
      return
    }
    if (cmd === CMD_ANSENTRY) {
      this.handleAnsEntry(peer, header)
      return
    }
    if (cmd === CMD_EXIT) {
      this.setOffline(peer)
      return
    }
    if (cmd === CMD_HANDSHAKE) {
      this.handleHandshake(peer, header)
      return
    }
    if (cmd === CMD_READY) {
      this.handleReady(peer, header)
      return
    }
    if (cmd === CMD_HEARTBEAT) {
      this.touch(peer)
      return
    }
    if (cmd === CMD_QUIT) {
      this.setOffline(peer)
      return
    }
    if (cmd === CMD_CHATMSG) {
      this.handleChat(peer, header)
      return
    }
    if (cmd === CMD_CHATMSG_ACK) {
      this.handleChatAck(peer, header)
      return
    }
    if (cmd === CMD_CHAT_RECEIPT) {
      this.handleChatReceipt(peer, header)
      return
    }
    if (cmd === CMD_CHANGE_INFO) {
      this.handleChangeInfo(peer, header)
      return
    }
    if (cmd === CMD_CHANGE_STATUS) {
      this.handleChangeStatus(peer, header)
      return
    }
    if (cmd === CMD_CHANGE_SIGN) {
      this.handleChangeSign(peer, header)
      return
    }
    if ((cmd & 0xff) === CMD_SENDMSG) {
      this.handleLegacyMessage(peer, header)
      return
    }
    if ((cmd & 0xff) === CMD_RECVMSG) {
      this.handleLegacyAck(peer, header)
    }
  }

  private handleEntry(peer: ProtocolPeer, header: Header): void {
    this.applyEntryFields(peer, header.payload)
    this.sendAnsEntry(peer)
    if (!peer.legacy) {
      this.sendHandshake(peer, false)
    }
  }

  private handleAnsEntry(peer: ProtocolPeer, header: Header): void {
    this.applyEntryFields(peer, header.payload)
    if (!peer.legacy) {
      this.sendHandshake(peer, true)
    }
  }

  private applyEntryFields(peer: ProtocolPeer, payload: Buffer): void {
    const fields = SplitNul(payload)
    if (fields.length > 0) {
      const name = decodeText(fields[0], false)
      if (name !== '') peer.name = name
    }
    if (fields.length > 1) {
      const group = decodeText(fields[1], false)
      if (group !== '') peer.group = group
    }
    if (fields.length > 2) {
      const corpId = decodeText(fields[2], false)
      if (corpId !== '') peer.corpId = corpId
    }
  }

  private handleHandshake(peer: ProtocolPeer, header: Header): void {
    const hs = decodeXml(header.payload, 'X_HANDSHARK')
    if (hs === null) {
      return
    }
    if (hs.Info.Name !== '') {
      peer.name = hs.Info.Name
    }
    peer.group = hs.Info.Group
    peer.corporation = hs.Info.Corporation
    peer.department = hs.Info.Department
    peer.sign = hs.Info.Sign
    peer.status = hs.Info.Status
    peer.corpId = hs.Info.CorpID
    peer.ports = hs.Net
    peer.ready = true
    this.handshakeTries.set(peer.key, 0)
    this.sendReady(peer)
  }

  private handleReady(peer: ProtocolPeer, header: Header): void {
    if (decodeXml(header.payload, 'X_READY') === null) {
      return
    }
    peer.ready = true
  }

  private handleChangeInfo(peer: ProtocolPeer, header: Header): void {
    const info = decodeXml(header.payload, 'X_CHANGE_INFO')
    if (info === null) {
      return
    }
    if (info.Name !== '') {
      peer.name = info.Name
    }
    peer.group = info.Group
    peer.corporation = info.Corporation
    peer.department = info.Department
    peer.sign = info.Sign
    peer.status = info.Status
  }

  private handleChangeStatus(peer: ProtocolPeer, header: Header): void {
    const status = decodeXml(header.payload, 'X_CHANGE_STATUS')
    if (status === null) {
      return
    }
    peer.status = status.Status
  }

  private handleChangeSign(peer: ProtocolPeer, header: Header): void {
    const sign = decodeXml(header.payload, 'X_CHANGE_SIGN')
    if (sign === null) {
      return
    }
    peer.sign = sign.Sign
  }

  private handleChat(peer: ProtocolPeer, header: Header): void {
    const chat = decodeXml(header.payload, 'X_SEND_MSG')
    if (chat === null) {
      return
    }
    this.callbacks.onMessage(clonePeer(peer), chat.Msg, chat.MsgID, false)
    const ack = Buffer.from(encodeChatMsgAck({ Docver: DOCVER, MsgID: chat.MsgID }), 'utf8')
    this.sendPacket(peer, CMD_CHATMSG_ACK, ack, false)
  }

  private handleChatAck(peer: ProtocolPeer, header: Header): void {
    const ack = decodeXml(header.payload, 'X_SEND_MSG_ACK')
    if (ack === null) {
      return
    }
    this.callbacks.onMessageStatus(peer.key, ack.MsgID, 'delivered')
  }

  private handleChatReceipt(peer: ProtocolPeer, header: Header): void {
    const receipt = decodeXml(header.payload, 'X_SEND_RECEIPT')
    if (receipt === null) {
      return
    }
    this.callbacks.onMessageStatus(peer.key, receipt.MsgID, 'read')
  }

  private handleLegacyMessage(peer: ProtocolPeer, header: Header): void {
    const utf8Body = (header.cmd & CMD_UTF8) !== 0
    let body = TrimNul(header.payload)
    let text: string
    if ((header.cmd & CMD_FILEATTACH) !== 0) {
      text = parseOffer(body, utf8Body).text
    } else {
      const nul = body.indexOf(0)
      if (nul >= 0) {
        body = body.subarray(0, nul)
      }
      text = decodeText(body, utf8Body)
    }
    if (text.trim().startsWith('<X_')) {
      return
    }
    this.callbacks.onMessage(clonePeer(peer), text, header.seq, true)
    if ((header.cmd & CMD_SENDCHECK) !== 0) {
      const payload = Buffer.from(`${header.seq}\u0000`, 'utf8')
      this.sendPacket(peer, CMD_RECVMSG, payload, false)
    }
  }

  private handleLegacyAck(peer: ProtocolPeer, header: Header): void {
    const text = TrimNul(header.payload).toString('ascii').trim()
    if (!/^\d+$/.test(text)) {
      return
    }
    const seq = Number(text)
    if (!Number.isSafeInteger(seq)) {
      return
    }
    this.callbacks.onMessageStatus(peer.key, seq, 'delivered')
  }

  private setOffline(peer: ProtocolPeer): void {
    peer.online = false
    peer.ready = false
  }

  private touch(peer: ProtocolPeer): void {
    peer.online = true
  }

  private sendAnsEntry(peer: ProtocolPeer): void {
    const now = Date.now()
    const last = this.ansEntryAt.get(peer.key)
    if (last !== undefined && now - last < ANSENTRY_INTERVAL_MS) {
      return
    }
    this.ansEntryAt.set(peer.key, now)
    this.sendPacket(peer, CMD_ANSENTRY, this.entryPayload())
  }

  private sendHandshake(peer: ProtocolPeer, force: boolean): void {
    const now = Date.now()
    const last = this.handshakeAt.get(peer.key)
    if (last !== undefined && now - last < HANDSHAKE_INTERVAL_MS) {
      return
    }
    const tries = this.handshakeTries.get(peer.key) ?? 0
    if (!force && tries >= HANDSHAKE_MAX_TRIES) {
      return
    }
    this.handshakeAt.set(peer.key, now)
    this.handshakeTries.set(peer.key, tries + 1)
    const payload = Buffer.from(encodeHandshake(this.handshakeMessage()), 'utf8')
    this.sendPacket(peer, CMD_HANDSHAKE, payload, false)
  }

  private sendReady(peer: ProtocolPeer): void {
    const payload = Buffer.from(
      encodeReady({ Docver: DOCVER, UserID: this.userId(), Param: 0 }),
      'utf8'
    )
    this.sendPacket(peer, CMD_READY, payload, false)
  }

  private broadcastHandshake(): void {
    const payload = Buffer.from(encodeHandshake(this.handshakeMessage()), 'utf8')
    for (const peer of this.peers.values()) {
      this.sendPacket(peer, CMD_HANDSHAKE, payload, false)
    }
  }

  private broadcastChangeSign(): void {
    const payload = Buffer.from(
      encodeChangeSign({ Docver: DOCVER, Sign: this.config.sign }),
      'utf8'
    )
    for (const peer of this.peers.values()) {
      if (peer.online) {
        this.sendPacket(peer, CMD_CHANGE_SIGN, payload, false)
      }
    }
  }

  private userId(): string {
    if (this.config.userId !== undefined && this.config.userId !== '') {
      return this.config.userId
    }
    return createHash('sha256')
      .update(`${this.config.account}@${this.config.host}`)
      .digest('hex')
      .slice(0, 16)
  }

  private handshakeMessage(): Handshake {
    const config = this.config
    return {
      Docver: DOCVER,
      Feature: { ...FEATURE_TEMPLATE },
      Info: {
        CorpID: config.corpId ?? '',
        CorpTime: 0,
        Name: config.name,
        Group: config.group,
        Corporation: config.corporation,
        Department: config.department,
        Sex: 0,
        Post: '',
        Tel: '',
        Mobile: '',
        Email: '',
        Sign: config.sign,
        SysFace: 0,
        Status: config.status,
        ActiveSend: 0,
        OnlinePopup: 0,
        HideIP: 0,
        ColorName: 0,
        SortName: 0,
        DecorateName: 0
      },
      Net: {
        FileTranTCPPort: config.port,
        FileTranEnetPort: config.port,
        FolderTranTCPPort: 0,
        FolderTranEnetPort: 0,
        FileTranTCPReversePort: 0,
        FileTranEnetReversePort: 0,
        FolderTranTCPReversePort: 0,
        FolderTranEnetReversePort: 0,
        LanUpdateHTTPPort: 0
      }
    }
  }

  private emitPeers(): void {
    this.callbacks.onPeers(this.getPeers())
  }
}

function comparePeers(a: ProtocolPeer, b: ProtocolPeer): number {
  if (a.online !== b.online) {
    return a.online ? -1 : 1
  }
  if (a.group !== b.group) {
    return a.group < b.group ? -1 : 1
  }
  if (a.name !== b.name) {
    return a.name < b.name ? -1 : 1
  }
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}
