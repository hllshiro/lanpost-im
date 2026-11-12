import { describe, expect, it } from 'vitest'
import {
  FOLDER_CMD_DATA,
  FOLDER_CMD_ITEM_RECEIVED,
  FolderFrameReader,
  buildAccept,
  buildData,
  buildItemAck,
  buildManifest,
  buildProgress,
  buildStart,
  parseAccept,
  parseData,
  parseItemAck,
  parseManifest,
  parseProgress,
  parseStart
} from './folder-wire'

const TASK_ID = 'e035b4cecce96344a0372a2d57558154'

describe('folder start frame', () => {
  it('writes the task id, item count and total size at the captured offsets', () => {
    const frame = buildStart(TASK_ID, 1, 11)

    expect(frame.length).toBe(684)
    expect(frame.readUInt32BE(0)).toBe(684)
    expect(frame.readUInt32BE(4)).toBe(2)
    expect(frame.readUInt32BE(8)).toBe(1)
    expect(frame.subarray(0x20, 0x20 + TASK_ID.length * 2).toString('utf16le')).toBe(TASK_ID)
    expect(frame.readUInt32BE(0x278)).toBe(1)
    expect(frame.readBigUInt64BE(0x27c)).toBe(11n)
    expect(parseStart(frame.subarray(12))).toEqual({ taskId: TASK_ID, count: 1, totalSize: 11 })
  })

  it('replies the same task id in the accept frame', () => {
    const frame = buildAccept(TASK_ID)

    expect(frame.length).toBe(672)
    expect(frame.readUInt32BE(8)).toBe(2)
    expect(parseAccept(frame.subarray(12))).toBe(TASK_ID)
  })
})

describe('folder manifest', () => {
  it('round-trips relative paths, sizes and file types', () => {
    const items = [
      { name: 'sss\\新建文本文档.txt', dir: false, index: 0, size: 11, time: 1794455386 },
      { name: 'sss\\子目录', dir: true, index: 1, size: 0, time: 1794455386 }
    ]
    const frame = buildManifest(items)

    expect(frame.length).toBe(0x4c + 2 * 0x27b)
    expect(frame.readUInt32BE(12 + 0x20 - 12)).toBe(2)
    // 第一项的名称从 0x4c 开始，类型 1 表示文件，2 表示目录
    expect(frame.subarray(0x4c, 0x4c + 0x27b).readUInt8(0x258)).toBe(1)
    expect(frame.subarray(0x4c + 0x27b, 0x4c + 2 * 0x27b).readUInt8(0x258)).toBe(2)
    expect(parseManifest(frame.subarray(12))).toEqual(items)
  })
})

describe('folder progress and data frames', () => {
  it('round-trips progress entries', () => {
    const entries = [{ index: 0, offset: 0, action: 0 }]
    const frame = buildProgress(entries)

    expect(frame.length).toBe(0x4c + 26)
    expect(parseProgress(frame.subarray(12))).toEqual(entries)
  })

  it('matches the data frame captured from the real client', () => {
    // 真实抓包：命令 5，项 0，action 0，正文 asdfasfasdf
    const hex =
      '000000410000000200000005' +
      '0000000000000000000000000000000000000000' +
      '000000000000000b0000000000000000000000000000' +
      '6173646661736661736466'
    const frame = Buffer.from(hex, 'hex')
    const parsed = parseData(frame.subarray(12))

    expect(parsed.index).toBe(0)
    expect(parsed.action).toBe(0)
    expect(parsed.chunk.toString()).toBe('asdfasfasdf')
    expect(buildData(0, 0, Buffer.from('asdfasfasdf'))).toEqual(frame)
  })

  it('matches the item acknowledgement captured from the real client', () => {
    const hex =
      '0000003a00000002' +
      '0000000600000000' +
      '0000000000000000' +
      '0000000000000000' +
      '0000000000000000' +
      '0000000b00000000' +
      '0000000000000000' +
      '0000'
    const frame = Buffer.from(hex, 'hex')

    expect(parseItemAck(frame.subarray(12))).toEqual({ index: 0, offset: 11, action: 0 })
    expect(buildItemAck(FOLDER_CMD_ITEM_RECEIVED, 0, 11)).toEqual(frame)
  })
})

describe('FolderFrameReader', () => {
  it('splits a stream into frames and tolerates partial chunks', () => {
    const reader = new FolderFrameReader()
    const first = buildData(0, 2, Buffer.from([0]))
    const second = buildData(0, 0, Buffer.from('asdfasfasdf'))
    const stream = Buffer.concat([first, second])

    expect(reader.push(stream.subarray(0, 20))).toEqual([])
    const frames = reader.push(stream.subarray(20))
    expect(frames.map((frame) => frame.cmd)).toEqual([FOLDER_CMD_DATA, FOLDER_CMD_DATA])
  })
})
