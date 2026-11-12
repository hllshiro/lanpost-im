import { describe, expect, it } from 'vitest'
import {
  FILE_DATA_HEADER_SIZE,
  FILE_FRAME_DATA,
  FILE_FRAME_HELLO,
  FILE_WINDOW_BODY_SIZE,
  FileFrameReader,
  buildAck,
  buildData,
  buildHello,
  buildPath,
  buildWindow,
  encodeFileFrame,
  parseDataHeader,
  parseHello,
  parsePath
} from './private-wire'

describe('private file wire', () => {
  it('writes the frame header the sample uses', () => {
    const body = buildAck({ fileId: 10932, size: 2441, time: 1789438756 })
    const frame = encodeFileFrame(2, body)
    expect(frame.readUInt32BE(0)).toBe(frame.length)
    expect(frame.readUInt32BE(4)).toBe(1)
    expect(frame.readUInt32BE(8)).toBe(2)
    // 抓包里 FILE_ID 在消息体偏移 44，SIZE 在 52，时间在 60
    expect(frame.readUInt32BE(12 + 44)).toBe(10932)
    expect(frame.readUInt32BE(12 + 52)).toBe(2441)
    expect(frame.readUInt32BE(12 + 60)).toBe(1789438756)
  })

  it('keeps hello fields at the captured offsets', () => {
    const body = buildHello({
      selfId: '68e24da0fa70',
      peerId: '1775dd7dbfb7c6f',
      fileId: 10932,
      xml: '<U><Name>上网机 3</Name></U>'
    })
    expect(body.length).toBe(488)
    expect(body.readUInt32BE(44)).toBe(10932)
    expect(parseHello(body).selfId).toBe('68e24da0fa70')
    expect(parseHello(body).peerId).toBe('1775dd7dbfb7c6f')
    expect(parseHello(body).xml).toBe('<U><Name>上网机 3</Name></U>')
  })

  it('keeps path fields at the captured offsets', () => {
    const body = buildPath({ dir: 'D:\\recv\\上网机', fileId: 10932, name: '流程.txt' })
    expect(body.readUInt32BE(44)).toBe(10932)
    const parsed = parsePath(body)
    expect(parsed.dir).toBe('D:\\recv\\上网机')
    expect(parsed.fileId).toBe(10932)
    expect(parsed.name).toBe('流程.txt')
  })

  it('carries file id, total size, offset and chunk size in a data frame', () => {
    const chunk = Buffer.from('abcdef')
    const body = buildData({ fileId: 28314, size: 19901144, offset: 32768, chunk })
    expect(body.readUInt32BE(44)).toBe(28314)
    expect(body.readUInt32BE(52)).toBe(19901144)
    expect(body.readUInt32BE(60)).toBe(32768)
    expect(body.readUInt32BE(64)).toBe(6)
    expect(body.subarray(FILE_DATA_HEADER_SIZE).toString()).toBe('abcdef')
    expect(parseDataHeader(body)).toEqual({
      fileId: 28314,
      size: 19901144,
      offset: 32768,
      chunkSize: 6
    })
  })

  it('reassembles frames split across tcp chunks', () => {
    const reader = new FileFrameReader()
    const one = encodeFileFrame(
      FILE_FRAME_HELLO,
      buildHello({ selfId: '', peerId: '', fileId: 1, xml: '' })
    )
    const two = encodeFileFrame(
      FILE_FRAME_DATA,
      buildData({ fileId: 1, size: 1, offset: 0, chunk: Buffer.from('z') })
    )
    const all = Buffer.concat([one, two])
    expect(reader.push(all.subarray(0, 7))).toEqual([])
    const first = reader.push(all.subarray(7, 510))
    expect(first.map((frame) => frame.type)).toEqual([FILE_FRAME_HELLO])
    const rest = reader.push(all.subarray(510))
    expect(rest.map((frame) => frame.type)).toEqual([FILE_FRAME_DATA])
  })

  it('builds the reverse window message with the file id at offset 44', () => {
    const body = buildWindow({ fileId: 5728, value: '5728|062a99702965417116db64d5ba75fdb1' })
    expect(body.length).toBe(FILE_WINDOW_BODY_SIZE)
    expect(body.readUInt32BE(44)).toBe(5728)
    const text = body.toString('utf16le')
    expect(text.startsWith('app" : "shiyeline",')).toBe(true)
    expect(text).toContain('"retrieve"')
    expect(text).toContain('"v" : "5728|062a99702965417116db64d5ba75fdb1"')
  })

  it('rejects a bogus frame length', () => {
    const reader = new FileFrameReader()
    const bad = Buffer.alloc(12)
    bad.writeUInt32BE(4, 0)
    expect(() => reader.push(bad)).toThrow(/帧长度异常/)
  })
})
