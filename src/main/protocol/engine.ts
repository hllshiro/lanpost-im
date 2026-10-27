import { createSocket, type RemoteInfo, type Socket } from 'node:dgram'
import { networkInterfaces } from 'node:os'
import type { PeerInfo, MessageMeta } from '../../shared/domain'
import { buildFileBody, parseOffer, type Attachment } from './attach'
import {
  CMD_ABSENCE,
  CMD_ANSENTRY,
  CMD_ANSREADMSG,
  CMD_ANSLIST,
  CMD_DELMSG,
  CMD_ENTRY,
  CMD_EXIT,
  CMD_GETABSENCEINFO,
  CMD_GETINFO,
  CMD_GETLIST,
  CMD_ISGETLIST,
  CMD_OKGETLIST,
  CMD_READMSG,
  CMD_RECVMSG,
  CMD_NWT_FILE_CANCEL,
  CMD_RELEASEFILES,
  CMD_SENDABSENCEINFO,
  CMD_SENDINFO,
  CMD_SENDMSG,
  OPT_ABSENCE,
  OPT_AUTORET,
  OPT_BROADCAST,
  OPT_CAPUTF8,
  OPT_CLIPBOARD,
  OPT_DIALUP,
  OPT_FILEATTACH,
  OPT_MULTICAST,
  OPT_READCHECK,
  OPT_SECRET,
  OPT_SENDCHECK,
  OPT_UTF8
} from './commands'
import { buildAbsenceInfo, buildInfo, parseInfo } from './info'
import { buildHostList, parseHostList, type HostListEntry } from './host-list'
import { Retransmitter } from './retransmit'
import { decodeMessageText, encodeMessageText } from './text'
import { encodeEntry, parseEntry } from './entry'
import { decodePacket, encodePacket, trimNul, type PacketHeader } from './packet'

const ANNOUNCE_INTERVAL_FALLBACK = 30
const OFFLINE_TIMEOUT_MS = 120_000
const SWEEP_INTERVAL_MS = 5_000
const ANNOUNCE_BURST_MS = [1_000, 3_000]
const MAX_TEXT_BYTES = 60_000

export type MessageStatus = 'delivered' | 'read' | 'failed'

export type { MessageMeta }

export interface ProtocolConfig {
  name: string
  account: string
  host: string
  group: string
  status: number
  port: number
  bindAddr: string
  subnets: string[]
  seeds: string[]
  broadcastInterval: number
  dialup?: boolean
}

export interface ProtocolPeer {
  key: string
  ip: string
  port: number
  user: string
  host: string
  name: string
  group: string
  status: number
  online: boolean
  capUtf8: boolean
  capFile: boolean
  capClipboard: boolean
  dialup: boolean
  versionInfo: string
  absenceInfo: string
  firstSeen: number
  lastSeen: number
}

export interface EngineOptions {
  announceBurstMs?: number[]
  offlineTimeoutMs?: number
  sweepIntervalMs?: number
  random?: () => number
}

export interface ProtocolCallbacks {
  onPeers(peers: ProtocolPeer[]): void
  onMessage(peer: ProtocolPeer, text: string, remoteSeq: number, meta: MessageMeta): void
  onMessageStatus(peerKey: string, seq: number, status: MessageStatus): void
  onMessageDeleted?(peerKey: string, seq: number): void
  onFileOffer?(
    peer: ProtocolPeer,
    packetId: number,
    text: string,
    attachments: Attachment[],
    utf8: boolean
  ): void
  onFileRelease?(peerKey: string, packetId: number, fileIds: number[]): void
  // 内网通 1@shiyeline 的私有 230 载荷没有分隔符，交给上层按已知 packetId 匹配。
  onNwtFileCancel?(peerKey: string, payload: Buffer): void
  onLog(message: string): void
  onError(error: Error): void
}

interface SeedTarget {
  ip: string
  port: number
}

function ipv4ToNumber(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
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
  if (address === null || mask === null) return null
  return numberToIpv4((address | (~mask >>> 0)) >>> 0)
}

function subnetBroadcast(cidr: string): string | null {
  const [address, prefixText] = cidr.split('/')
  const parsed = ipv4ToNumber(address)
  if (parsed === null || !/^\d{1,2}$/.test(prefixText)) return null
  const prefix = Number(prefixText)
  if (prefix > 32) return null
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return numberToIpv4((parsed | (~mask >>> 0)) >>> 0)
}

function parseSeed(seed: string, defaultPort: number): SeedTarget | null {
  const trimmed = seed.trim()
  if (trimmed === '') return null
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
    bindAddr: config.bindAddr === '' ? '0.0.0.0' : config.bindAddr,
    subnets: [...config.subnets],
    seeds: [...config.seeds],
    broadcastInterval:
      config.broadcastInterval > 0 ? config.broadcastInterval : ANNOUNCE_INTERVAL_FALLBACK,
    dialup: config.dialup === true
  }
}

function clonePeer(peer: ProtocolPeer): ProtocolPeer {
  return { ...peer }
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
    status: peer.status,
    online: peer.online,
    lastSeen: peer.lastSeen,
    unread: 0,
    alias: '',
    capUtf8: peer.capUtf8,
    capFile: peer.capFile,
    capClipboard: peer.capClipboard,
    dialup: peer.dialup,
    versionInfo: peer.versionInfo,
    absenceInfo: peer.absenceInfo
  }
}

function comparePeers(a: ProtocolPeer, b: ProtocolPeer): number {
  if (a.online !== b.online) return a.online ? -1 : 1
  if (a.group !== b.group) return a.group < b.group ? -1 : 1
  if (a.name !== b.name) return a.name < b.name ? -1 : 1
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

export class ProtocolEngine {
  private config: ProtocolConfig
  private readonly callbacks: ProtocolCallbacks
  private readonly options: Required<
    Pick<EngineOptions, 'announceBurstMs' | 'offlineTimeoutMs' | 'sweepIntervalMs' | 'random'>
  >
  private readonly peers = new Map<string, ProtocolPeer>()
  private readonly hostListAt = new Map<string, number>()
  private readonly hostListBatch = new Map<string, number>()
  private readonly recentMessages = new Map<string, number>()
  private socket: Socket | null = null
  private broadcastTargets: string[] = []
  private localAddresses = new Set<string>(['127.0.0.1', '::1'])
  private seq = Math.floor(Date.now() / 1000) >>> 0
  private announceTimer: ReturnType<typeof setInterval> | null = null
  private sweepTimer: ReturnType<typeof setInterval> | null = null
  private readonly burstTimers = new Set<ReturnType<typeof setTimeout>>()
  private readonly pendingSends = new Set<Promise<void>>()
  private readonly retransmitter: Retransmitter

  constructor(config: ProtocolConfig, callbacks: ProtocolCallbacks, options: EngineOptions = {}) {
    this.config = normalizeConfig(config)
    this.callbacks = callbacks
    this.options = {
      announceBurstMs: options.announceBurstMs ?? ANNOUNCE_BURST_MS,
      offlineTimeoutMs: options.offlineTimeoutMs ?? OFFLINE_TIMEOUT_MS,
      sweepIntervalMs: options.sweepIntervalMs ?? SWEEP_INTERVAL_MS,
      random: options.random ?? Math.random
    }
    this.retransmitter = new Retransmitter({
      onFailed: (peerKey, seq) => this.callbacks.onMessageStatus(peerKey, seq, 'failed')
    })
  }

  async start(): Promise<void> {
    if (this.socket !== null) throw new Error('协议引擎已经启动')
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
    this.refreshLocalAddresses()
    this.log(`协议引擎启动: ${this.config.account}@${this.config.host} UDP ${this.config.port}`)
    this.announce()
    for (const delay of this.options.announceBurstMs) {
      if (delay <= 0) continue
      const timer = setTimeout(() => this.announce(), delay)
      timer.unref()
      this.burstTimers.add(timer)
    }
    this.announceTimer = setInterval(() => this.announce(), this.config.broadcastInterval * 1000)
    this.announceTimer.unref()
    this.sweepTimer = setInterval(() => this.sweep(), this.options.sweepIntervalMs)
    this.sweepTimer.unref()
  }

  async stop(): Promise<void> {
    const socket = this.socket
    if (socket === null) return
    if (this.announceTimer !== null) clearInterval(this.announceTimer)
    if (this.sweepTimer !== null) clearInterval(this.sweepTimer)
    this.announceTimer = null
    this.sweepTimer = null
    for (const timer of this.burstTimers) clearTimeout(timer)
    this.burstTimers.clear()
    this.retransmitter.stop()
    this.broadcast(CMD_EXIT, Buffer.alloc(0))
    await Promise.allSettled([...this.pendingSends])
    this.socket = null
    await new Promise<void>((resolve) => socket.close(() => resolve()))
  }

  getPeers(): ProtocolPeer[] {
    return [...this.peers.values()].map(clonePeer).sort(comparePeers)
  }

  refresh(): number {
    if (this.socket === null) throw new Error('协议引擎尚未启动')
    this.refreshBroadcastTargets()
    this.announce()
    this.log(`手动刷新联系人：已发送上线通知，共 ${this.peers.size} 个联系人`)
    return this.peers.size
  }

  sendText(peerKey: string, text: string, options: { sealed?: boolean } = {}): number {
    const extra = options.sealed === true ? OPT_SECRET : 0
    return this.sendTextPacket(this.requirePeer(peerKey), text, extra)
  }

  sendBroadcast(text: string): Array<{ peerKey: string; seq: number }> {
    const sent: Array<{ peerKey: string; seq: number }> = []
    for (const peer of this.getPeers()) {
      if (!peer.online) continue
      sent.push({ peerKey: peer.key, seq: this.sendTextPacket(peer, text, OPT_BROADCAST) })
    }
    return sent
  }

  sendMulticast(peerKeys: string[], text: string): Array<{ peerKey: string; seq: number }> {
    const sent: Array<{ peerKey: string; seq: number }> = []
    for (const peerKey of [...new Set(peerKeys)]) {
      const peer = this.peers.get(peerKey)
      if (peer === undefined || !peer.online) continue
      sent.push({ peerKey, seq: this.sendTextPacket(peer, text, OPT_MULTICAST) })
    }
    return sent
  }

  private sendTextPacket(peer: ProtocolPeer, text: string, extraFlags: number): number {
    const encoded = encodeMessageText(text, { utf8: peer.capUtf8 })
    if (encoded.lossy) this.log(`${peer.name || peer.user} 不支持 UTF-8，部分字符已替换`)
    const cmd = CMD_SENDMSG | OPT_SENDCHECK | (encoded.utf8 ? OPT_UTF8 : 0) | extraFlags
    return this.sendTracked(peer, cmd, encoded.data)
  }

  sendReadMessage(peerKey: string, seq: number, withCheck: boolean): void {
    const peer = this.requirePeer(peerKey)
    const cmd = CMD_READMSG | (withCheck ? OPT_READCHECK : 0)
    this.sendPacket(peer, cmd, Buffer.from(`${seq}\u0000`, 'utf8'))
  }

  sendFileOffer(peerKey: string, text: string, attachments: Attachment[]): number {
    const peer = this.requirePeer(peerKey)
    if (attachments.length === 0) throw new Error('文件邀请必须包含附件')
    const { body, utf8 } = buildFileBody(text, attachments, peer.capUtf8)
    if (body.length > MAX_TEXT_BYTES) throw new Error(`消息与文件名过长: ${body.length} 字节`)
    const cmd = CMD_SENDMSG | OPT_SENDCHECK | OPT_FILEATTACH | (utf8 ? OPT_UTF8 : 0)
    return this.sendTracked(peer, cmd, body)
  }

  sendFileAccept(peerKey: string, packetId: number): void {
    const peer = this.requirePeer(peerKey)
    this.sendPacket(peer, CMD_RECVMSG, Buffer.from(`${packetId}\u0000`, 'utf8'))
  }

  releaseFiles(peerKey: string, packetId: number, fileIds: number[]): void {
    const peer = this.peers.get(peerKey)
    if (peer === undefined) return
    const payload = [packetId, ...fileIds].map((value) => value.toString(16)).join(':')
    // RELEASEFILES 没有确认机制，单包丢失会让对端一直停在等待态；重发几次提高可靠性。
    for (const delay of [0, 250, 750]) {
      const timer = setTimeout(() => {
        this.burstTimers.delete(timer)
        this.sendPacket(peer, CMD_RELEASEFILES, Buffer.from(payload, 'ascii'))
      }, delay)
      timer.unref()
      this.burstTimers.add(timer)
    }
  }

  updateStatus(status: number): void {
    if (this.config.status === status) return
    this.config.status = status
    if (this.socket !== null) this.announce()
  }

  updateProfile(patch: Partial<ProtocolConfig>): void {
    const previous = this.config
    const next = normalizeConfig({
      ...previous,
      ...patch,
      subnets: patch.subnets ?? previous.subnets,
      seeds: patch.seeds ?? previous.seeds
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
    if (this.socket === null) return
    if (patch.subnets !== undefined) this.refreshBroadcastTargets()
    if (next.broadcastInterval !== previous.broadcastInterval) {
      if (this.announceTimer !== null) clearInterval(this.announceTimer)
      this.announceTimer = setInterval(() => this.announce(), next.broadcastInterval * 1000)
      this.announceTimer.unref()
    }
    if (
      next.name !== previous.name ||
      next.group !== previous.group ||
      next.status !== previous.status
    ) {
      this.announce()
    }
  }

  private requirePeer(peerKey: string): ProtocolPeer {
    const peer = this.peers.get(peerKey)
    if (peer === undefined) throw new Error(`未知联系人: ${peerKey}`)
    return peer
  }

  private nextSeq(): number {
    this.seq = (this.seq + 1) >>> 0
    return this.seq
  }

  private log(message: string): void {
    this.callbacks.onLog(message)
  }

  private refreshLocalAddresses(): void {
    const addresses = new Set<string>(['127.0.0.1', '::1'])
    for (const infos of Object.values(networkInterfaces())) {
      for (const info of infos ?? []) {
        if (info.internal) continue
        addresses.add(info.address)
      }
    }
    this.localAddresses = addresses
  }

  private refreshBroadcastTargets(): void {
    const targets = new Set<string>(['255.255.255.255'])
    for (const addresses of Object.values(networkInterfaces())) {
      for (const info of addresses ?? []) {
        if (String(info.family) !== 'IPv4' || info.internal) continue
        const broadcast = broadcastOf(info.address, info.netmask)
        if (broadcast !== null) targets.add(broadcast)
      }
    }
    for (const subnet of this.config.subnets) {
      const trimmed = subnet.trim()
      if (trimmed === '') continue
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

  private entryCommand(): number {
    let cmd = OPT_CAPUTF8 | OPT_FILEATTACH | OPT_CLIPBOARD
    if (this.config.dialup === true) cmd |= OPT_DIALUP
    if (this.config.status !== 0) cmd |= OPT_ABSENCE
    return cmd
  }

  private entryPayload(): Buffer {
    return encodeEntry({
      name: this.config.name,
      group: this.config.group,
      account: this.config.account,
      host: this.config.host,
      version: 'lanpost-im/0.1.0'
    })
  }

  private announce(): void {
    if (this.socket === null) return
    this.refreshBroadcastTargets()
    const cmd = this.config.status === 0 ? CMD_ENTRY : CMD_ABSENCE | OPT_ABSENCE
    const command = cmd | this.entryCommand()
    const payload = this.entryPayload()
    this.broadcast(command, payload)
    for (const seed of this.config.seeds) {
      const target = parseSeed(seed, this.config.port)
      if (target === null) {
        this.log(`忽略无法解析的种子地址: ${seed}`)
        continue
      }
      this.sendRaw(
        target.ip,
        target.port,
        encodePacket({
          seq: this.nextSeq(),
          user: this.config.account,
          host: this.config.host,
          cmd: command,
          payload
        })
      )
    }
  }

  private broadcast(cmd: number, payload: Buffer): void {
    if (this.socket === null) return
    const data = encodePacket({
      seq: this.nextSeq(),
      user: this.config.account,
      host: this.config.host,
      cmd,
      payload
    })
    for (const address of this.broadcastTargets) this.sendRaw(address, this.config.port, data, true)
  }

  private sendPacket(peer: ProtocolPeer, cmd: number, payload: Buffer): number {
    const seq = this.nextSeq()
    this.sendRaw(
      peer.ip,
      peer.port,
      encodePacket({
        seq,
        user: this.config.account,
        host: this.config.host,
        cmd,
        payload
      })
    )
    return seq
  }

  // 需要确认的 SENDMSG 在未收到 RECVMSG/ANSREADMSG 时重发同一份报文。
  private sendTracked(peer: ProtocolPeer, cmd: number, payload: Buffer): number {
    const seq = this.nextSeq()
    const data = encodePacket({
      seq,
      user: this.config.account,
      host: this.config.host,
      cmd,
      payload
    })
    this.sendRaw(peer.ip, peer.port, data)
    this.retransmitter.add({
      seq,
      peerKey: peer.key,
      send: () => this.sendRaw(peer.ip, peer.port, data)
    })
    return seq
  }

  private sendRaw(ip: string, port: number, data: Buffer, quiet = false): void {
    const socket = this.socket
    if (socket === null) return
    const pending = new Promise<void>((resolve) => {
      socket.send(data, port, ip, (error) => {
        if (error !== null && !quiet) this.log(`发送到 ${ip}:${port} 失败: ${error.message}`)
        resolve()
      })
    })
    this.pendingSends.add(pending)
    void pending.then(() => this.pendingSends.delete(pending))
  }

  private handle(data: Buffer, rinfo: RemoteInfo): void {
    let header: PacketHeader
    try {
      header = decodePacket(data)
    } catch (error) {
      this.log(`忽略无法解析的报文: ${(error as Error).message}`)
      return
    }
    if (
      header.user === this.config.account &&
      header.host === this.config.host &&
      rinfo.port === this.config.port &&
      this.localAddresses.has(rinfo.address)
    ) {
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
        status: 0,
        online: true,
        capUtf8: false,
        capFile: false,
        capClipboard: false,
        dialup: false,
        versionInfo: '',
        absenceInfo: '',
        firstSeen: now,
        lastSeen: now
      }
      this.peers.set(key, peer)
    }
    peer.ip = rinfo.address
    peer.port = rinfo.port
    peer.user = header.user
    peer.host = header.host
    peer.lastSeen = now
    peer.online = true
    try {
      this.dispatch(peer, header)
    } catch (error) {
      this.log(`处理报文失败: ${(error as Error).message}`)
    }
    this.emitPeers()
  }

  private dispatch(peer: ProtocolPeer, header: PacketHeader): void {
    const cmd = header.cmd
    const mode = cmd & 0xff
    if (mode === CMD_ENTRY || mode === CMD_ANSENTRY || mode === CMD_ABSENCE) {
      this.applyEntry(peer, header)
      if (mode === CMD_ENTRY && (cmd & OPT_AUTORET) === 0) this.sendAnsEntry(peer)
      return
    }
    if (mode === CMD_EXIT) {
      peer.online = false
      return
    }
    if (mode === CMD_SENDMSG) {
      this.handleMessage(peer, header)
      return
    }
    if (mode === CMD_RECVMSG) {
      this.handleAck(peer, header, 'delivered')
      return
    }
    if (mode === CMD_READMSG) {
      this.handleRead(peer, header)
      return
    }
    if (mode === CMD_ANSREADMSG) {
      this.handleAck(peer, header, 'read')
      return
    }
    if (mode === CMD_DELMSG) {
      const seq = this.parseSeq(header.payload)
      if (seq !== null) this.callbacks.onMessageDeleted?.(peer.key, seq)
      return
    }
    if (mode === CMD_GETINFO) {
      if ((header.cmd & OPT_AUTORET) === 0) {
        this.sendPacket(peer, CMD_SENDINFO, buildInfo('0.1.0'))
      }
      return
    }
    if (mode === CMD_GETABSENCEINFO) {
      if ((header.cmd & OPT_AUTORET) !== 0) return
      const absent = this.config.status !== 0
      this.sendPacket(
        peer,
        CMD_SENDABSENCEINFO,
        buildAbsenceInfo(absent, this.config.status === 1 ? 'Busy' : 'Away')
      )
      return
    }
    if (mode === CMD_SENDINFO) {
      peer.versionInfo = parseInfo(header.payload)
      return
    }
    if (mode === CMD_SENDABSENCEINFO) {
      peer.absenceInfo = parseInfo(header.payload)
      return
    }
    if (mode === CMD_ISGETLIST) {
      if ((header.cmd & OPT_AUTORET) === 0 && this.getPeers().length > 0) {
        this.sendPacket(peer, CMD_OKGETLIST, Buffer.alloc(0))
      }
      return
    }
    if (mode === CMD_OKGETLIST) {
      const last = this.hostListAt.get(peer.key) ?? 0
      if (Date.now() - last < 5000) return
      this.hostListAt.set(peer.key, Date.now())
      this.sendPacket(peer, CMD_GETLIST, Buffer.from('0'))
      return
    }
    if (mode === CMD_GETLIST) {
      this.sendHostList(peer, header.payload)
      return
    }
    if (mode === CMD_ANSLIST) {
      this.mergeHostList(peer, header.payload)
      return
    }
    if (mode === CMD_NWT_FILE_CANCEL) {
      if (header.version === '5@shiyeline') {
        const field = trimNul(header.payload).toString('ascii').split('\u0000')[0].replace(/:$/, '')
        const packetId = Number.parseInt(field, 16)
        if (Number.isSafeInteger(packetId) && packetId >= 0) {
          this.callbacks.onFileRelease?.(peer.key, packetId, [])
        }
      } else {
        this.callbacks.onNwtFileCancel?.(peer.key, header.payload)
      }
      return
    }
    if (mode === CMD_RELEASEFILES) {
      const parts = trimNul(header.payload).toString('ascii').split(':')
      const packetId = Number.parseInt(parts[0] ?? '', 16)
      const fileIds = parts
        .slice(1)
        .map((part) => Number.parseInt(part, 16))
        .filter((value) => Number.isSafeInteger(value))
      if (Number.isSafeInteger(packetId))
        this.callbacks.onFileRelease?.(peer.key, packetId, fileIds)
      return
    }
    this.log(`忽略未知命令: ${cmd}`)
  }

  private applyEntry(peer: ProtocolPeer, header: PacketHeader): void {
    const parsed = parseEntry(header.payload)
    if (parsed.name !== '') peer.name = parsed.name
    if (parsed.group !== '') peer.group = parsed.group
    if (parsed.account !== '') peer.user = parsed.account
    if (parsed.host !== '') peer.host = parsed.host
    if (parsed.version !== '') peer.versionInfo = parsed.version
    peer.capUtf8 = (header.cmd & OPT_CAPUTF8) !== 0
    peer.capFile = (header.cmd & OPT_FILEATTACH) !== 0
    peer.capClipboard = (header.cmd & OPT_CLIPBOARD) !== 0
    peer.dialup = (header.cmd & OPT_DIALUP) !== 0
    peer.status = (header.cmd & OPT_ABSENCE) !== 0 ? 2 : 0
  }

  private sendAnsEntry(peer: ProtocolPeer): void {
    const delay = Math.floor(this.options.random() * 200)
    const timer = setTimeout(() => {
      this.burstTimers.delete(timer)
      this.sendPacket(peer, CMD_ANSENTRY | this.entryCommand(), this.entryPayload())
    }, delay)
    timer.unref()
    this.burstTimers.add(timer)
  }

  private handleMessage(peer: ProtocolPeer, header: PacketHeader): void {
    const key = `${peer.key}|${header.seq}`
    const now = Date.now()
    if (this.recentMessages.has(key)) {
      this.ackFor(header, peer)
      return
    }
    this.recentMessages.set(key, now)
    for (const [entry, at] of this.recentMessages) {
      if (now - at > 5 * 60_000) this.recentMessages.delete(entry)
    }
    const utf8 = (header.cmd & OPT_UTF8) !== 0
    const isOffer = (header.cmd & OPT_FILEATTACH) !== 0
    const meta: MessageMeta = { channel: 'standard' }
    if ((header.cmd & OPT_SECRET) !== 0) {
      meta.sealed = true
      meta.opened = false
    }
    if ((header.cmd & OPT_READCHECK) !== 0) meta.readCheck = true
    if ((header.cmd & OPT_BROADCAST) !== 0) meta.flags = { broadcast: true }
    if ((header.cmd & OPT_MULTICAST) !== 0) meta.flags = { multicast: true }
    if (isOffer) {
      const offer = parseOffer(trimNul(header.payload), utf8)
      this.callbacks.onFileOffer?.(clonePeer(peer), header.seq, offer.text, offer.attachments, utf8)
    } else {
      const body = trimNul(header.payload)
      const nul = body.indexOf(0)
      const text = decodeMessageText(nul >= 0 ? body.subarray(0, nul) : body, utf8)
      this.callbacks.onMessage(clonePeer(peer), text, header.seq, meta)
    }
    this.ackFor(header, peer)
  }

  private ackFor(header: PacketHeader, peer: ProtocolPeer): void {
    if ((header.cmd & OPT_SENDCHECK) === 0 || (header.cmd & OPT_AUTORET) !== 0) return
    this.sendPacket(peer, CMD_RECVMSG, Buffer.from(`${header.seq}\u0000`, 'utf8'))
  }

  private handleAck(peer: ProtocolPeer, header: PacketHeader, status: MessageStatus): void {
    const seq = this.parseSeq(header.payload)
    if (seq === null) return
    this.retransmitter.ack(seq)
    this.callbacks.onMessageStatus(peer.key, seq, status)
  }

  private handleRead(peer: ProtocolPeer, header: PacketHeader): void {
    const seq = this.parseSeq(header.payload)
    if (seq !== null) {
      this.retransmitter.ack(seq)
      this.callbacks.onMessageStatus(peer.key, seq, 'read')
    }
    if ((header.cmd & OPT_READCHECK) !== 0 && (header.cmd & OPT_AUTORET) === 0) {
      this.sendPacket(peer, CMD_ANSREADMSG, Buffer.from(`${header.seq}\u0000`, 'utf8'))
    }
  }

  private parseSeq(payload: Buffer): number | null {
    const text = trimNul(payload).toString('ascii').trim()
    if (!/^\d+$/.test(text)) return null
    const value = Number(text)
    return Number.isSafeInteger(value) && value <= 0xffffffff ? value : null
  }

  requestInfo(peerKey: string): void {
    const peer = this.requirePeer(peerKey)
    this.sendPacket(peer, CMD_GETINFO, Buffer.alloc(0))
    this.sendPacket(peer, CMD_GETABSENCEINFO, Buffer.alloc(0))
  }

  requestHostList(): void {
    if (this.socket === null) return
    this.broadcast(CMD_ISGETLIST, Buffer.alloc(0))
  }

  getHostList(): HostListEntry[] {
    return this.getPeers()
      .filter((peer) => peer.online)
      .map((peer) => ({
        user: peer.user,
        host: peer.host,
        status: peer.status,
        addr: peer.ip,
        port: peer.port,
        nickname: peer.name,
        group: peer.group
      }))
  }

  private sendHostList(peer: ProtocolPeer, payload: Buffer): void {
    const startText = trimNul(payload).toString('ascii').trim()
    const start = /^\d+$/.test(startText) ? Number(startText) : 0
    const all = this.getHostList()
    const hosts = all.slice(start, start + 50)
    const next = start + hosts.length < all.length ? start + hosts.length : 0
    this.sendPacket(peer, CMD_ANSLIST, buildHostList(next, hosts))
  }

  private mergeHostList(peer: ProtocolPeer, payload: Buffer): void {
    const parsed = parseHostList(payload)
    for (const entry of parsed.hosts) {
      const peer = [...this.peers.values()].find(
        (item) => item.ip === entry.addr && item.user === entry.user
      )
      if (peer === undefined) continue
      if (entry.nickname !== '') peer.name = entry.nickname
      if (entry.group !== '') peer.group = entry.group
    }
    const batch = (this.hostListBatch.get(peer.key) ?? 0) + 1
    this.hostListBatch.set(peer.key, batch)
    if (parsed.next > 0 && batch <= 3) {
      this.sendPacket(peer, CMD_GETLIST, Buffer.from(String(parsed.next)))
    } else {
      this.hostListBatch.delete(peer.key)
    }
  }

  private sweep(): void {
    const now = Date.now()
    let changed = false
    for (const peer of this.peers.values()) {
      if (peer.online && now - peer.lastSeen >= this.options.offlineTimeoutMs) {
        peer.online = false
        changed = true
      }
    }
    if (changed) this.emitPeers()
  }

  private emitPeers(): void {
    this.callbacks.onPeers(this.getPeers())
  }
}
