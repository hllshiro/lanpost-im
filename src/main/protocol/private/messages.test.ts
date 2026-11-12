import { describe, expect, it } from 'vitest'
import {
  fileTimeFromMs,
  handshakeXml,
  heartbeatXml,
  helloFrame,
  messageTextJson,
  operateRecvFileXml,
  operateSendFileXml,
  parsePrivate,
  progressRecvFileXml,
  quitXml,
  readyXml,
  sendFileXml,
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
    expect(parsePrivate(1004, xml)).toEqual({ kind: 'text', msgId: 7, text: '你好', images: [] })
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

  it('turns a link card into its url', () => {
    const xml =
      '<X_SEND_MSG docver="1"><MSG_ID>6</MSG_ID><RECEIPT>0</RECEIPT><MSG>{&quot;app&quot;:&quot;shiyeline&quot;,&quot;dt&quot;:[{&quot;lnk&quot;:{&quot;v&quot;:&quot;https://example.com/a&quot;}}]}</MSG></X_SEND_MSG>'
    expect(parsePrivate(1004, xml)).toEqual({
      kind: 'text',
      msgId: 6,
      text: 'https://example.com/a',
      images: []
    })
  })

  it('shows a placeholder for an image and keeps its file id', () => {
    const image =
      '<X_SEND_MSG docver="1"><MSG_ID>3</MSG_ID><RECEIPT>0</RECEIPT><MSG>{&quot;app&quot;:&quot;shiyeline&quot;,&quot;dt&quot;:[{&quot;img&quot;:{&quot;v&quot;:&quot;x&quot;}}]}</MSG></X_SEND_MSG>'
    expect(parsePrivate(1004, image)).toEqual({
      kind: 'text',
      msgId: 3,
      text: '[图片]',
      images: []
    })
    const real =
      '<X_SEND_MSG docver="1"><MSG_ID>5</MSG_ID><RECEIPT>0</RECEIPT><MSG>{&quot;app&quot;:&quot;shiyeline&quot;,&quot;dt&quot;:[{&quot;img&quot;:{&quot;t&quot;:&quot;feihu&quot;,&quot;v&quot;:&quot;5723|6825bf031f45b541a19c305eb5c898a1&quot;}}]}</MSG></X_SEND_MSG>'
    expect(parsePrivate(1004, real)).toEqual({
      kind: 'text',
      msgId: 5,
      text: '[图片]',
      images: [{ id: 5723, type: 'feihu', value: '5723|6825bf031f45b541a19c305eb5c898a1' }]
    })
    const unknown =
      '<X_SEND_MSG docver="1"><MSG_ID>4</MSG_ID><RECEIPT>0</RECEIPT><MSG>{&quot;app&quot;:&quot;shiyeline&quot;,&quot;dt&quot;:[{&quot;voip&quot;:{}}]}</MSG></X_SEND_MSG>'
    expect(parsePrivate(1004, unknown)).toEqual({ kind: 'text-unsupported', msgId: 4 })
  })
})

describe('private messages round-trip', () => {
  it('falls back to a non-empty group because the sample rejects a blank one', () => {
    const xml = handshakeXml(
      { name: '本机', group: '  ', corporation: '', department: '', sign: '', status: 0 },
      '0123456789abcdef0123456789abcdef'
    )
    expect(xml).toContain('<GROUP>Default</GROUP>')
    expect(parsePrivate(1000, xml)).toMatchObject({
      kind: 'handshake',
      profile: { group: 'Default' }
    })
  })

  it('round-trips a handshake that enables MSG, FILE_TRAN and HIDE_RECORD', () => {
    const profile: PrivateProfile = {
      name: '本机',
      group: '研发部',
      corporation: '示例公司',
      department: '一组',
      sign: '在线',
      status: 1
    }
    const userId = '0123456789abcdef0123456789abcdef'
    const xml = handshakeXml(profile, userId, 9013)
    expect(xml).toContain('<MSG>2:1</MSG>')
    expect(xml).toContain('<HIDE_RECORD>1</HIDE_RECORD>')
    expect(xml).toContain('<FILE_TRAN>1</FILE_TRAN>')
    expect(xml).toContain('<FILE_TRAN_TCP_PORT>9013</FILE_TRAN_TCP_PORT>')
    expect(xml).toContain('<FILE_TRAN_TCP_REVERSE_PORT>9013</FILE_TRAN_TCP_REVERSE_PORT>')
    expect(xml).toContain(`<CORP_ID>${userId}</CORP_ID>`)
    expect(parsePrivate(1000, xml)).toEqual({
      kind: 'handshake',
      profile: { ...profile, userId },
      filePort: 9013,
      reversePort: 9013
    })
  })

  it('parses X_QUIT', () => {
    expect(parsePrivate(1017, quitXml())).toEqual({ kind: 'quit' })
  })

  it('keeps spaces and XML characters from the message text', () => {
    const text = 'a b<c>'
    const xml = sendMsgXml(11, text)
    expect(xml).toContain('&quot;a&nbsp;b&lt;c&gt;&quot;')
    expect(parsePrivate(1004, xml)).toEqual({ kind: 'text', msgId: 11, text, images: [] })
  })

  it('keeps quotes in the message text', () => {
    const text = 'say "hi"'
    const xml = sendMsgXml(13, text)
    expect(parsePrivate(1004, xml)).toEqual({ kind: 'text', msgId: 13, text, images: [] })
  })

  it('concatenates every text segment', () => {
    const xml =
      '<X_SEND_MSG docver="1"><MSG_ID>4</MSG_ID><RECEIPT>0</RECEIPT><MSG>{&quot;app&quot;:&quot;shiyeline&quot;,&quot;dt&quot;:[{&quot;txt&quot;:{&quot;t&quot;:&quot;normal&quot;,&quot;v&quot;:&quot;a&quot;}},{&quot;img&quot;:{&quot;v&quot;:&quot;x&quot;}},{&quot;txt&quot;:{&quot;t&quot;:&quot;normal&quot;,&quot;v&quot;:&quot;b&quot;}}]}</MSG></X_SEND_MSG>'
    expect(parsePrivate(1004, xml)).toEqual({
      kind: 'text',
      msgId: 4,
      text: 'a[图片]b',
      images: []
    })
  })

  it('returns other instead of throwing on malformed input', () => {
    expect(parsePrivate(1004, '<X_HEARTBEAT docver="1" />')).toEqual({ kind: 'other', cmd: 1004 })
    expect(parsePrivate(1004, '<X_SEND_MSG docver="1"><MSG_ID>1</MSG_ID>')).toEqual({
      kind: 'other',
      cmd: 1004
    })
    expect(
      parsePrivate(1006, '<X_SEND_RECEIPT docver="1"><MSG_ID>abc</MSG_ID></X_SEND_RECEIPT>')
    ).toEqual({ kind: 'other', cmd: 1006 })
    expect(parsePrivate(1008, 'plain text')).toEqual({ kind: 'other', cmd: 1008 })
  })

  it('writes the captured self-closing heartbeat and quit', () => {
    expect(heartbeatXml()).toBe('<X_HEARTBEAT docver="1" />')
    expect(Buffer.byteLength(heartbeatXml(), 'utf8')).toBe(26)
    expect(quitXml()).toBe('<X_QUIT docver="1" />')
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

describe('private file messages', () => {
  it('round-trips X_SEND_FILE with the captured fields', () => {
    const xml = sendFileXml({
      taskId: '1',
      fileId: 10932,
      name: 'C:\\Users\\xqkj\\Desktop\\流程.txt',
      size: 2441,
      lastModify: '134339123560000000'
    })
    expect(xml).toContain('<TASK_ID>1</TASK_ID>')
    expect(xml).toContain('<FILE_ID>10932</FILE_ID>')
    expect(xml).toContain('<SIZE>2441</SIZE>')
    expect(xml).toContain('<LAST_MODIFY>134339123560000000</LAST_MODIFY>')
    expect(parsePrivate(1009, xml)).toEqual({
      kind: 'file-offer',
      offer: {
        taskId: '1',
        fileId: 10932,
        name: 'C:\\Users\\xqkj\\Desktop\\流程.txt',
        size: 2441,
        lastModify: '134339123560000000'
      }
    })
  })

  it('round-trips the operate and progress commands', () => {
    expect(parsePrivate(1010, operateSendFileXml('7', 2))).toEqual({
      kind: 'file-operate',
      cmd: 1010,
      taskId: '7',
      op: 2
    })
    expect(parsePrivate(1011, operateRecvFileXml('7', 2))).toEqual({
      kind: 'file-operate',
      cmd: 1011,
      taskId: '7',
      op: 2
    })
    expect(parsePrivate(1012, progressRecvFileXml('7', 2441, 2441, '未知速度'))).toEqual({
      kind: 'file-progress',
      taskId: '7',
      totalSize: 2441,
      recvdSize: 2441
    })
  })

  it('converts milliseconds to a windows file time string', () => {
    expect(fileTimeFromMs(0)).toBe('116444736000000000')
    expect(fileTimeFromMs(1_700_000_000_000)).toBe('133444736000000000')
  })
})
