import { createSocket } from 'node:dgram'
import { describe, expect, it } from 'vitest'
import { parseOffer, buildFileBody, type Attachment } from '../protocol/attach'
import {
  CMD_ENTRY,
  CMD_RECVMSG,
  CMD_SENDMSG,
  OPT_FILEATTACH,
  OPT_SENDCHECK,
  OPT_UTF8
} from '../protocol/commands'
import { encodeGbk } from '../protocol/encoding'
import {
  ProtocolEngine,
  type ProtocolCallbacks,
  type ProtocolConfig,
  type ProtocolPeer
} from '../protocol/engine'
import { decodePacket, encodePacket } from '../protocol/packet'

interface OfferRecord {
  peer: ProtocolPeer
  packetId: number
  text: string
  attachments: Attachment[]
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

function makeConfig(port: number): ProtocolConfig {
  return {
    name: '收件端',
    account: 'file-receiver',
    host: 'file-host',
    group: '',
    status: 0,
    port,
    bindAddr: '127.0.0.1',
    subnets: [],
    seeds: [],
    broadcastInterval: 3600
  }
}

describe('文件邀请报文', () => {
  it('raises onFileOffer with the packet seq and sends standard file offers', async () => {
    const enginePort = await freeUdpPort()
    const raw = createSocket('udp4')
    const packets: Buffer[] = []
    raw.on('message', (data) => packets.push(data))
    await new Promise<void>((resolve, reject) => {
      raw.once('error', reject)
      raw.bind(0, '127.0.0.1', () => resolve())
    })
    const peerUser = 'file-peer'
    const peerHost = 'peer-host'
    const peerKey = `127.0.0.1|${peerUser}`
    const offers: OfferRecord[] = []
    const messages: string[] = []
    const errors: Error[] = []
    const callbacks: ProtocolCallbacks = {
      onPeers: () => undefined,
      onMessage: (_peer, text) => messages.push(text),
      onMessageStatus: () => undefined,
      onLog: () => undefined,
      onError: (error) => errors.push(error),
      onFileOffer: (peer, packetId, text, attachments) => {
        offers.push({ peer, packetId, text, attachments })
      }
    }
    const engine = new ProtocolEngine(makeConfig(enginePort), callbacks)
    try {
      await engine.start()
      raw.send(
        encodePacket({
          seq: 10,
          user: peerUser,
          host: peerHost,
          cmd: CMD_ENTRY,
          payload: Buffer.concat([encodeGbk('对端'), Buffer.from([0, 0, 0])])
        }),
        enginePort,
        '127.0.0.1'
      )

      const attachments: Attachment[] = [
        { id: 0x21, name: '归档:报告.pdf', size: 0x400, mtime: 1700000000, attr: 1 }
      ]
      const outgoing = buildFileBody('发一个文件', attachments)
      raw.send(
        encodePacket({
          seq: 777,
          user: peerUser,
          host: peerHost,
          cmd: CMD_SENDMSG | OPT_SENDCHECK | OPT_FILEATTACH | (outgoing.utf8 ? OPT_UTF8 : 0),
          payload: outgoing.body
        }),
        enginePort,
        '127.0.0.1'
      )

      const offer = await waitFor(() => offers.find((entry) => entry.packetId === 777) ?? null)
      expect(offer.text).toBe('发一个文件')
      expect(offer.attachments).toHaveLength(1)
      expect(offer.attachments[0].name).toBe('归档:报告.pdf')
      expect(offer.attachments[0].size).toBe(0x400)
      expect(offer.peer.key).toBe(peerKey)

      const ack = await waitFor(() => {
        for (const packet of packets) {
          const header = decodePacket(packet)
          if (header.cmd === CMD_RECVMSG) {
            return header
          }
        }
        return null
      })
      expect(ack.payload.toString('utf8')).toBe('777\u0000')

      const seq = engine.sendFileOffer(peerKey, '发送文件', attachments)
      const sent = await waitFor(() => {
        for (const packet of packets) {
          const header = decodePacket(packet)
          if ((header.cmd & 0xff) === CMD_SENDMSG && (header.cmd & OPT_FILEATTACH) !== 0) {
            return header
          }
        }
        return null
      })
      expect(sent.version).toBe('1')
      expect(sent.seq).toBe(seq)
      expect((sent.cmd & OPT_SENDCHECK) !== 0).toBe(true)
      const parsed = parseOffer(sent.payload, (sent.cmd & OPT_UTF8) !== 0)
      expect(parsed.text).toBe('发送文件')
      expect(parsed.attachments[0]).toMatchObject({ id: 0x21, name: '归档:报告.pdf', size: 0x400 })
      expect(errors).toEqual([])
    } finally {
      await engine.stop()
      await new Promise<void>((resolve) => {
        raw.close(() => resolve())
      })
    }
  }, 20000)
})
