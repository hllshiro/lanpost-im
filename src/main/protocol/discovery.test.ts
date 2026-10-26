import { createSocket, type Socket } from 'node:dgram'
import { describe, expect, it } from 'vitest'
import {
  CMD_CHATMSG,
  CMD_CHATMSG_ACK,
  CMD_CHAT_RECEIPT,
  CMD_ENTRY,
  CMD_HANDSHAKE,
  CMD_READY,
  CMD_RECVMSG,
  CMD_SENDCHECK,
  CMD_SENDMSG
} from './commands'
import { decodeGbk, encodeGbk } from './encoding'
import {
  ProtocolEngine,
  type MessageStatus,
  type ProtocolCallbacks,
  type ProtocolConfig,
  type ProtocolPeer
} from './discovery'
import { DecodeCompat, Encode } from './packet'
import { decodeXml, encodeChatMsg, encodeChatMsgAck, encodeChatReceipt, encodeReady } from './xml'

interface MessageRecord {
  peer: ProtocolPeer
  text: string
  seq: number
  legacy: boolean
}

interface StatusRecord {
  key: string
  seq: number
  status: MessageStatus
}

interface Recorder {
  peers: Map<string, ProtocolPeer>
  messages: MessageRecord[]
  statuses: StatusRecord[]
  errors: Error[]
  logs: string[]
  callbacks: ProtocolCallbacks
}

interface RawSocket {
  socket: Socket
  port: number
  packets: Buffer[]
}

function createRecorder(): Recorder {
  const recorder: Recorder = {
    peers: new Map(),
    messages: [],
    statuses: [],
    errors: [],
    logs: [],
    callbacks: {
      onPeers: (peers) => {
        for (const peer of peers) {
          recorder.peers.set(peer.key, peer)
        }
      },
      onMessage: (peer, text, seq, legacy) => {
        recorder.messages.push({ peer, text, seq, legacy })
      },
      onMessageStatus: (key, seq, status) => {
        recorder.statuses.push({ key, seq, status })
      },
      onLog: (message) => {
        recorder.logs.push(message)
      },
      onError: (error) => {
        recorder.errors.push(error)
      }
    }
  }
  return recorder
}

function makeConfig(patch: Partial<ProtocolConfig> & { port: number }): ProtocolConfig {
  return {
    name: '测试用户',
    account: 'tester',
    host: 'test-host',
    group: '分组',
    corporation: '',
    department: '',
    sign: '',
    status: 0,
    bindAddr: '127.0.0.1',
    subnets: [],
    seeds: [],
    broadcastInterval: 3600,
    ...patch
  }
}

function entryPayload(name: string, group: string, corpId: string): Buffer {
  return Buffer.concat([
    encodeGbk(name),
    Buffer.from([0]),
    encodeGbk(group),
    Buffer.from([0]),
    encodeGbk(corpId),
    Buffer.from([0])
  ])
}

async function freeUdpPort(): Promise<number> {
  const socket = createSocket('udp4')
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject)
    socket.bind(0, '127.0.0.1', () => resolve())
  })
  const port = socket.address().port
  await new Promise<void>((resolve) => {
    socket.close(() => resolve())
  })
  return port
}

async function twoFreePorts(): Promise<[number, number]> {
  for (;;) {
    const first = await freeUdpPort()
    const second = await freeUdpPort()
    if (first !== second) {
      return [first, second]
    }
  }
}

async function openRawSocket(): Promise<RawSocket> {
  const socket = createSocket('udp4')
  const packets: Buffer[] = []
  socket.on('message', (data) => {
    packets.push(data)
  })
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject)
    socket.bind(0, '127.0.0.1', () => resolve())
  })
  return { socket, port: socket.address().port, packets }
}

async function waitFor<T>(probe: () => T | null, timeout = 5000): Promise<T> {
  const started = Date.now()
  for (;;) {
    const value = probe()
    if (value !== null) {
      return value
    }
    if (Date.now() - started > timeout) {
      throw new Error('等待协议事件超时')
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

describe('protocol engine over real UDP', () => {
  it('discovers a peer through seeds and exchanges a text message', async () => {
    const [portA, portB] = await twoFreePorts()
    const a = createRecorder()
    const b = createRecorder()
    const engineA = new ProtocolEngine(
      makeConfig({
        name: '甲',
        account: 'account-a',
        host: 'host-a',
        port: portA,
        seeds: [`127.0.0.1:${portB}`]
      }),
      a.callbacks
    )
    const engineB = new ProtocolEngine(
      makeConfig({
        name: '乙',
        account: 'account-b',
        host: 'host-b',
        port: portB,
        group: '另一个分组',
        seeds: [`127.0.0.1:${portA}`]
      }),
      b.callbacks
    )
    const keyB = '127.0.0.1|account-b'
    const keyA = '127.0.0.1|account-a'
    try {
      await Promise.all([engineA.start(), engineB.start()])

      const peerFromA = await waitFor(() => {
        const peer = a.peers.get(keyB)
        return peer !== undefined && peer.online ? peer : null
      })
      expect(peerFromA.name).toBe('乙')
      expect(peerFromA.group).toBe('另一个分组')
      expect(peerFromA.legacy).toBe(true)

      const peerFromB = await waitFor(() => {
        const peer = b.peers.get(keyA)
        return peer !== undefined && peer.online ? peer : null
      })
      expect(peerFromB.name).toBe('甲')

      const seq = engineA.sendText(keyB, '你好，局域网')
      const message = await waitFor(
        () => b.messages.find((entry) => entry.text === '你好，局域网') ?? null
      )
      expect(message.legacy).toBe(true)
      expect(message.seq).toBe(seq)
      expect(message.peer.key).toBe(keyA)

      const delivered = await waitFor(
        () => a.statuses.find((entry) => entry.seq === seq && entry.status === 'delivered') ?? null
      )
      expect(delivered.key).toBe(keyB)

      engineA.updateStatus(1)
      const changed = await waitFor(() => {
        const peer = b.peers.get(keyA)
        return peer !== undefined && peer.status === 1 ? peer : null
      })
      expect(changed.status).toBe(1)

      await engineA.stop()
      const offline = await waitFor(() => {
        const peer = b.peers.get(keyA)
        return peer !== undefined && !peer.online ? peer : null
      })
      expect(offline.online).toBe(false)

      expect(a.errors).toEqual([])
      expect(b.errors).toEqual([])
    } finally {
      await engineA.stop()
      await engineB.stop()
    }
  }, 20000)

  it('re-announces presence and status to known peers on manual refresh', async () => {
    const [portA, portB] = await twoFreePorts()
    const a = createRecorder()
    const b = createRecorder()
    const engineA = new ProtocolEngine(
      makeConfig({
        name: '甲',
        account: 'account-a',
        host: 'host-a',
        port: portA,
        seeds: [`127.0.0.1:${portB}`]
      }),
      a.callbacks
    )
    const engineB = new ProtocolEngine(
      makeConfig({
        name: '乙',
        account: 'account-b',
        host: 'host-b',
        port: portB
      }),
      b.callbacks
    )
    const keyA = '127.0.0.1|account-a'
    try {
      await Promise.all([engineA.start(), engineB.start()])
      await waitFor(() => {
        const peer = b.peers.get(keyA)
        return peer !== undefined && peer.online ? true : null
      })
      const before = b.peers.get(keyA)?.lastSeen ?? 0
      await new Promise((resolve) => setTimeout(resolve, 1100))
      const count = engineA.refresh()
      expect(count).toBeGreaterThanOrEqual(1)
      const refreshed = await waitFor(() => {
        const peer = b.peers.get(keyA)
        return peer !== undefined && peer.lastSeen > before ? peer : null
      })
      expect(refreshed.online).toBe(true)
      expect(refreshed.name).toBe('甲')
      expect(a.errors).toEqual([])
      expect(b.errors).toEqual([])
    } finally {
      await engineA.stop()
      await engineB.stop()
    }
  }, 20000)

  it('answers a legacy SENDMSG with a NUL terminated RECVMSG and sends legacy text', async () => {
    const enginePort = await freeUdpPort()
    const raw = await openRawSocket()
    const recorder = createRecorder()
    const engine = new ProtocolEngine(
      makeConfig({ name: '新客户端', account: 'engine-new', host: 'host-new', port: enginePort }),
      recorder.callbacks
    )
    const key = '127.0.0.1|legacy-peer'
    try {
      await engine.start()
      raw.socket.send(
        Encode({
          seq: 100,
          user: 'legacy-peer',
          host: 'legacy-host',
          cmd: CMD_ENTRY,
          payload: entryPayload('旧版用户', '旧分组', ''),
          legacy: true
        }),
        enginePort,
        '127.0.0.1'
      )
      const peer = await waitFor(() => {
        const found = recorder.peers.get(key)
        return found !== undefined && found.name === '旧版用户' ? found : null
      })
      expect(peer.legacy).toBe(true)
      expect(peer.group).toBe('旧分组')

      raw.socket.send(
        Encode({
          seq: 321,
          user: 'legacy-peer',
          host: 'legacy-host',
          cmd: CMD_SENDMSG | CMD_SENDCHECK,
          payload: encodeGbk('旧版消息'),
          legacy: true
        }),
        enginePort,
        '127.0.0.1'
      )
      const message = await waitFor(
        () => recorder.messages.find((entry) => entry.seq === 321) ?? null
      )
      expect(message.text).toBe('旧版消息')
      expect(message.legacy).toBe(true)

      const ack = await waitFor(() => {
        for (const packet of raw.packets) {
          const header = DecodeCompat(packet)
          if (header.cmd === CMD_RECVMSG) {
            return header
          }
        }
        return null
      })
      expect(ack.version).toBe('1@shiyeline')
      expect(ack.payload.toString('utf8')).toBe('321\u0000')

      const sentSeq = engine.sendText(key, '回复旧版')
      const outgoing = await waitFor(() => {
        for (const packet of raw.packets) {
          const header = DecodeCompat(packet)
          if (header.cmd === (CMD_SENDMSG | CMD_SENDCHECK)) {
            return header
          }
        }
        return null
      })
      expect(outgoing.version).toBe('1')
      expect(outgoing.legacy).toBe(true)
      expect(outgoing.seq).toBe(sentSeq)
      expect(decodeGbk(outgoing.payload)).toBe('回复旧版')
      expect(recorder.errors).toEqual([])
    } finally {
      await engine.stop()
      await new Promise<void>((resolve) => {
        raw.socket.close(() => resolve())
      })
    }
  }, 20000)

  it('sends legacy SENDMSG to a private-version peer without a completed handshake', async () => {
    const enginePort = await freeUdpPort()
    const raw = await openRawSocket()
    const recorder = createRecorder()
    const engine = new ProtocolEngine(
      makeConfig({
        name: '新客户端',
        account: 'engine-compat',
        host: 'host-compat',
        port: enginePort
      }),
      recorder.callbacks
    )
    const key = '127.0.0.1|nwt-peer'
    try {
      await engine.start()
      // 内网通的标准报文也带 @shiyeline，但不会完成私有握手。
      raw.socket.send(
        Encode({
          seq: 900,
          user: 'nwt-peer',
          host: 'nwt-host',
          cmd: CMD_ENTRY,
          payload: entryPayload('内网通用户', '内网通联系人', 'corp-1'),
          legacy: false
        }),
        enginePort,
        '127.0.0.1'
      )
      const peer = await waitFor(() => {
        const found = recorder.peers.get(key)
        return found !== undefined && found.online ? found : null
      })
      expect(peer.legacy).toBe(false)
      expect(peer.ready).toBe(false)

      const seq = engine.sendText(key, '兼容消息')
      const outgoing = await waitFor(() => {
        for (const packet of raw.packets) {
          const header = DecodeCompat(packet)
          if ((header.cmd & 0xff) === CMD_SENDMSG && (header.cmd & CMD_SENDCHECK) !== 0) {
            return header
          }
        }
        return null
      })
      expect(outgoing.version).toBe('1')
      expect(outgoing.seq).toBe(seq)
      expect(decodeGbk(outgoing.payload)).toBe('兼容消息')
      expect(recorder.errors).toEqual([])
    } finally {
      await engine.stop()
      await new Promise<void>((resolve) => {
        raw.socket.close(() => resolve())
      })
    }
  }, 20000)

  it('runs the private handshake and exchanges chat, ack and read receipt', async () => {
    const enginePort = await freeUdpPort()
    const raw = await openRawSocket()
    const recorder = createRecorder()
    const engine = new ProtocolEngine(
      makeConfig({
        name: '私有引擎',
        account: 'engine-private',
        host: 'host-private',
        port: enginePort,
        group: '私有分组',
        corporation: '公司',
        department: '部门',
        sign: '私有签名'
      }),
      recorder.callbacks
    )
    const user = 'private-peer'
    const host = 'private-host'
    const key = `127.0.0.1|${user}`
    const send = (seq: number, cmd: number, payload: Buffer): void => {
      raw.socket.send(
        Encode({ seq, user, host, cmd, payload, legacy: false }),
        enginePort,
        '127.0.0.1'
      )
    }
    try {
      await engine.start()
      raw.socket.send(
        Encode({
          seq: 700,
          user,
          host,
          cmd: CMD_ENTRY,
          payload: entryPayload('私有对端', '对方分组', 'corp-9'),
          legacy: false
        }),
        enginePort,
        '127.0.0.1'
      )

      const handshakePacket = await waitFor(() => {
        for (const packet of raw.packets) {
          const header = DecodeCompat(packet)
          if (header.cmd === CMD_HANDSHAKE) {
            return header
          }
        }
        return null
      })
      const handshake = decodeXml(handshakePacket.payload, 'X_HANDSHARK')
      expect(handshake?.Info.Name).toBe('私有引擎')
      expect(handshake?.Info.Group).toBe('私有分组')
      expect(handshake?.Info.Corporation).toBe('公司')
      expect(handshake?.Info.Department).toBe('部门')
      expect(handshake?.Info.Sign).toBe('私有签名')
      expect(handshake?.Net.FileTranTCPPort).toBe(enginePort)
      expect(handshake?.Net.FileTranEnetPort).toBe(0)
      expect(handshake?.Feature.Build).toBe('3055')
      expect(handshakePacket.version).toBe('1@shiyeline')

      send(701, CMD_READY, Buffer.from(encodeReady({ Docver: 1, UserID: 'raw', Param: 0 }), 'utf8'))
      const readyPeer = await waitFor(() => {
        const peer = recorder.peers.get(key)
        return peer !== undefined && peer.ready ? peer : null
      })
      expect(readyPeer.name).toBe('私有对端')
      expect(readyPeer.legacy).toBe(false)

      const seq = engine.sendText(key, '私有消息')
      const chatPacket = await waitFor(() => {
        for (const packet of raw.packets) {
          const header = DecodeCompat(packet)
          if (header.cmd === CMD_CHATMSG) {
            return header
          }
        }
        return null
      })
      expect(chatPacket.version).toBe('1@shiyeline')
      const chat = decodeXml(chatPacket.payload, 'X_SEND_MSG')
      expect(chat?.Msg).toBe('私有消息')
      expect(chat?.MsgID).toBe(seq)
      expect(chat?.Receipt).toBe(1)

      send(702, CMD_CHATMSG_ACK, Buffer.from(encodeChatMsgAck({ Docver: 1, MsgID: seq }), 'utf8'))
      const delivered = await waitFor(
        () =>
          recorder.statuses.find((entry) => entry.seq === seq && entry.status === 'delivered') ??
          null
      )
      expect(delivered.key).toBe(key)

      send(
        703,
        CMD_CHATMSG,
        Buffer.from(
          encodeChatMsg({
            Docver: 1,
            MsgID: 555,
            Receipt: 1,
            Msg: '来自私有对端',
            MsgTime: 1700000000,
            Offline: 0,
            HideRecord: 0
          }),
          'utf8'
        )
      )
      const incoming = await waitFor(
        () => recorder.messages.find((entry) => entry.seq === 555) ?? null
      )
      expect(incoming.text).toBe('来自私有对端')
      expect(incoming.legacy).toBe(false)

      const ackPacket = await waitFor(() => {
        for (const packet of raw.packets) {
          const header = DecodeCompat(packet)
          if (header.cmd === CMD_CHATMSG_ACK) {
            return header
          }
        }
        return null
      })
      const ack = decodeXml(ackPacket.payload, 'X_SEND_MSG_ACK')
      expect(ack?.MsgID).toBe(555)

      send(704, CMD_CHAT_RECEIPT, Buffer.from(encodeChatReceipt({ Docver: 1, MsgID: 555 }), 'utf8'))
      const read = await waitFor(
        () =>
          recorder.statuses.find((entry) => entry.seq === 555 && entry.status === 'read') ?? null
      )
      expect(read.key).toBe(key)
      expect(recorder.errors).toEqual([])
    } finally {
      await engine.stop()
      await new Promise<void>((resolve) => {
        raw.socket.close(() => resolve())
      })
    }
  }, 20000)
})
