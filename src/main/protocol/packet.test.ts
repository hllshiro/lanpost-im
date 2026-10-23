import { describe, expect, it } from 'vitest'
import {
  DOCVER,
  Decode,
  DecodeCompat,
  Encode,
  IsLegacy,
  SplitNul,
  TrimNul,
  VERSION_SUFFIX,
  PacketError
} from './packet'
import {
  CMD_ANSENTRY,
  CMD_BROADCAST,
  CMD_CHANGE_INFO,
  CMD_CHATMSG,
  CMD_ENTRY,
  CMD_FILEATTACH,
  CMD_GETFILE,
  CMD_HANDSHAKE,
  CMD_RECVMSG,
  CMD_SENDCHECK,
  CMD_SENDMSG,
  CMD_UTF8
} from './commands'
import { decodeGbk, decodeText, encodeGbk } from './encoding'

describe('packet', () => {
  it('round-trips a private packet with a raw payload', () => {
    const payload = Buffer.from(
      '<X_SEND_MSG docver="1"><MSG_ID>7</MSG_ID><MSG>你好</MSG></X_SEND_MSG>',
      'utf8'
    )
    const raw = Encode({
      seq: 12345,
      user: 'zhangsan',
      host: 'pc01',
      cmd: CMD_CHATMSG,
      payload,
      legacy: false
    })
    expect(raw.subarray(0, 11).toString('ascii')).toBe(`1${VERSION_SUFFIX}`)
    const header = Decode(raw)
    expect(header).toMatchObject({
      version: `1${VERSION_SUFFIX}`,
      seq: 12345,
      user: 'zhangsan',
      host: 'pc01',
      cmd: CMD_CHATMSG,
      legacy: false
    })
    expect(header.payload.equals(payload)).toBe(true)
  })

  it('uses version 1 for legacy packets and rejects them in Decode', () => {
    const payload = encodeGbk('你好')
    const raw = Encode({
      seq: 4242,
      user: 'SYSTEM',
      host: 'P9FD',
      cmd: CMD_SENDMSG | CMD_SENDCHECK,
      payload,
      legacy: true
    })
    expect(raw.subarray(0, 2).toString('ascii')).toBe('1:')
    expect(() => Decode(raw)).toThrow(PacketError)
    const compat = DecodeCompat(raw)
    expect(compat.legacy).toBe(true)
    expect(compat.seq).toBe(4242)
    expect(compat.user).toBe('SYSTEM')
    expect(compat.host).toBe('P9FD')
    expect(compat.cmd).toBe(CMD_SENDMSG | CMD_SENDCHECK)
    expect(compat.payload.equals(payload)).toBe(true)
  })

  it('rejects a version without the private suffix and accepts other suffixed versions', () => {
    expect(() => Decode(Buffer.from('1:1:user:host:32:hi', 'utf8'))).toThrow(PacketError)
    expect(Decode(Buffer.from('2@shiyeline:1:user:host:32:hi', 'utf8')).version).toBe('2@shiyeline')
  })

  it('accepts a header without a payload field', () => {
    const header = DecodeCompat(Buffer.from('1:7:u:h:2', 'utf8'))
    expect(header.legacy).toBe(true)
    expect(header.payload.length).toBe(0)
  })

  it('keeps GBK payload bytes intact through Encode and Decode', () => {
    const payload = encodeGbk('项目:最终报告.docx')
    const raw = Encode({
      seq: 1,
      user: 'u',
      host: 'h',
      cmd: CMD_CHATMSG,
      payload,
      legacy: false
    })
    const header = Decode(raw)
    expect(header.payload.equals(payload)).toBe(true)
  })

  it('trims trailing NULs and splits NUL separated fields', () => {
    const raw = Buffer.concat([
      Buffer.from('P9FD'),
      Buffer.from([0]),
      encodeGbk('内网通联系人'),
      Buffer.from([0]),
      Buffer.from('abc123'),
      Buffer.from([0, 0])
    ])
    const fields = SplitNul(raw)
    expect(fields).toHaveLength(3)
    expect(fields[0].toString('utf8')).toBe('P9FD')
    expect(decodeGbk(fields[1])).toBe('内网通联系人')
    expect(fields[2].toString('utf8')).toBe('abc123')
    expect(TrimNul(raw).length).toBe(raw.length - 2)
    expect(SplitNul(Buffer.from([0, 0]))).toHaveLength(0)
  })

  it('classifies standard IPMSG commands and flags as legacy', () => {
    const legacy = [
      CMD_ENTRY,
      CMD_ANSENTRY,
      CMD_SENDMSG,
      CMD_SENDMSG | CMD_SENDCHECK,
      CMD_SENDMSG | CMD_SENDCHECK | CMD_FILEATTACH,
      CMD_SENDMSG | CMD_SENDCHECK | CMD_FILEATTACH | CMD_UTF8,
      CMD_RECVMSG,
      CMD_GETFILE,
      CMD_ENTRY | CMD_BROADCAST
    ]
    for (const cmd of legacy) {
      expect(IsLegacy(cmd)).toBe(true)
    }
    const privateCommands = [CMD_HANDSHAKE, CMD_CHATMSG, CMD_CHANGE_INFO, 5004]
    for (const cmd of privateCommands) {
      expect(IsLegacy(cmd)).toBe(false)
    }
  })

  it('decodes the reference ANSENTRY sample with GBK fields', () => {
    const raw = Buffer.concat([
      Buffer.from('1@shiyeline:4242:SYSTEM:P9FD:3:', 'ascii'),
      Buffer.from('P9FD'),
      Buffer.from([0]),
      encodeGbk('内网通联系人'),
      Buffer.from([0]),
      Buffer.from('abc123'),
      Buffer.from([0])
    ])
    const header = Decode(raw)
    expect(header.cmd).toBe(CMD_ANSENTRY)
    expect(header.user).toBe('SYSTEM')
    expect(header.host).toBe('P9FD')
    const fields = SplitNul(header.payload)
    expect(fields).toHaveLength(3)
    expect(fields[0].toString('ascii')).toBe('P9FD')
    expect(decodeText(fields[1], false)).toBe('内网通联系人')
    expect(fields[2].toString('ascii')).toBe('abc123')
  })

  it('keeps the docver constant at 1', () => {
    expect(DOCVER).toBe(1)
  })
})
