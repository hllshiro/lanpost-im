import { describe, expect, it } from 'vitest'
import {
  handshakeXml,
  heartbeatXml,
  helloFrame,
  messageTextJson,
  parsePrivate,
  quitXml,
  readyXml,
  sendMsgAckXml,
  sendMsgXml,
  sendReceiptXml
} from './messages'
import type { PrivateProfile } from './messages'
import { decodeBeacon } from './beacon'

describe('private messages', () => {
  it('builds X_SEND_MSG with the captured JSON shape', () => {
    const xml = sendMsgXml(7, '你好')
    expect(xml).toContain('<MSG_ID>7</MSG_ID>')
    expect(xml).toContain('<RECEIPT>0</RECEIPT>')
    expect(xml).toContain('&quot;app&quot;&nbsp;:&nbsp;&quot;shiyeline&quot;')
    expect(xml).toContain('&quot;v&quot;&nbsp;:&nbsp;&quot;你好&quot;')
    expect(xml).toContain('<MSG_TIME>0</MSG_TIME><OFFLINE>0</OFFLINE><HIDE_RECORD>0</HIDE_RECORD>')
    expect(parsePrivate(1004, xml)).toEqual({ kind: 'text', msgId: 7, text: '你好' })
  })

  it('parses ack and receipt', () => {
    expect(parsePrivate(1005, sendMsgAckXml(9))).toEqual({ kind: 'ack', msgId: 9 })
    expect(parsePrivate(1006, sendReceiptXml(9))).toEqual({ kind: 'receipt', msgId: 9 })
  })

  it('parses X_READY and heartbeat', () => {
    expect(parsePrivate(1018, readyXml('abc'))).toEqual({ kind: 'ready', userId: 'abc' })
    expect(parsePrivate(1016, heartbeatXml())).toEqual({ kind: 'heartbeat' })
  })

  it('builds a 304-byte type 4 hello', () => {
    const peerId = Buffer.alloc(16, 0x5a)
    const raw = helloFrame({
      ip: '192.168.1.20',
      broadcast: '192.168.1.255',
      userId: '0123456789abcdef0123456789abcdef',
      peerId,
      enetPort: 54321
    })
    expect(raw.length).toBe(304)
    expect(decodeBeacon(raw)).toMatchObject({ type: 4, ip: '192.168.1.20', enetPort: 54321 })
  })

  it('ignores messages without text content', () => {
    const xml =
      '<X_SEND_MSG docver="1"><MSG_ID>3</MSG_ID><RECEIPT>0</RECEIPT><MSG>{&quot;app&quot;:&quot;shiyeline&quot;,&quot;dt&quot;:[{&quot;img&quot;:{&quot;v&quot;:&quot;x&quot;}}]}</MSG></X_SEND_MSG>'
    expect(parsePrivate(1004, xml)).toEqual({ kind: 'text-unsupported', msgId: 3 })
  })
})

describe('private messages round-trip', () => {
  it('round-trips a handshake that only enables MSG and HIDE_RECORD', () => {
    const profile: PrivateProfile = {
      name: '本机',
      group: '研发部',
      corporation: '示例公司',
      department: '一组',
      sign: '在线',
      status: 1
    }
    const userId = '0123456789abcdef0123456789abcdef'
    const xml = handshakeXml(profile, userId)
    expect(xml).toContain('<MSG>2:1</MSG>')
    expect(xml).toContain('<HIDE_RECORD>1</HIDE_RECORD>')
    expect(xml).toContain('<FILE_TRAN>0</FILE_TRAN>')
    expect(xml).toContain('<FILE_TRAN_TCP_PORT>0</FILE_TRAN_TCP_PORT>')
    expect(xml).toContain(`<CORP_ID>${userId}</CORP_ID>`)
    expect(parsePrivate(1000, xml)).toEqual({
      kind: 'handshake',
      profile: { ...profile, userId }
    })
  })

  it('parses X_QUIT', () => {
    expect(parsePrivate(1017, quitXml())).toEqual({ kind: 'quit' })
  })

  it('keeps spaces and XML characters from the message text', () => {
    const text = 'a b<c>'
    const xml = sendMsgXml(11, text)
    expect(xml).toContain('&quot;a&nbsp;b&lt;c&gt;&quot;')
    expect(parsePrivate(1004, xml)).toEqual({ kind: 'text', msgId: 11, text })
  })

  it('keeps quotes in the message text', () => {
    const text = 'say "hi"'
    const xml = sendMsgXml(13, text)
    expect(parsePrivate(1004, xml)).toEqual({ kind: 'text', msgId: 13, text })
  })

  it('concatenates every text segment', () => {
    const xml =
      '<X_SEND_MSG docver="1"><MSG_ID>4</MSG_ID><RECEIPT>0</RECEIPT><MSG>{&quot;app&quot;:&quot;shiyeline&quot;,&quot;dt&quot;:[{&quot;txt&quot;:{&quot;t&quot;:&quot;normal&quot;,&quot;v&quot;:&quot;a&quot;}},{&quot;img&quot;:{&quot;v&quot;:&quot;x&quot;}},{&quot;txt&quot;:{&quot;t&quot;:&quot;normal&quot;,&quot;v&quot;:&quot;b&quot;}}]}</MSG></X_SEND_MSG>'
    expect(parsePrivate(1004, xml)).toEqual({ kind: 'text', msgId: 4, text: 'ab' })
  })

  it('writes the json body with escaped spaces and quotes', () => {
    const json = messageTextJson('你好')
    expect(json).toContain('&quot;app&quot;&nbsp;:&nbsp;&quot;shiyeline&quot;')
    expect(json).toContain('&quot;n&quot;&nbsp;:&nbsp;&quot;微软雅黑&quot;')
    expect(json).toContain('&quot;s&quot;&nbsp;:&nbsp;&quot;9&quot;')
    expect(json).toContain('&quot;ver&quot;&nbsp;:&nbsp;&quot;6.0&quot;')
    expect(json).toContain('&quot;v&quot;&nbsp;:&nbsp;&quot;你好&quot;')
    expect(json).toMatch(/&quot;id&quot;&nbsp;:&nbsp;&quot;[0-9a-f]{32}&quot;/)
    expect(json.startsWith('{')).toBe(true)
    expect(json.endsWith('}')).toBe(true)
  })
})
