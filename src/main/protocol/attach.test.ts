import { describe, expect, it } from 'vitest'
import {
  FILE_ATTR_REGULAR,
  buildFileBody,
  encodeAttachmentItem,
  escapeAttachName,
  parseOffer,
  type Attachment
} from './attach'
import { encodeGbk } from './encoding'

describe('attachment table', () => {
  it('encodes the standard item fields and parses 0:123.txt:0000000003:2492:1:', () => {
    const attachment: Attachment = {
      id: 0,
      name: '123.txt',
      size: 3,
      mtime: 0x2492,
      attr: FILE_ATTR_REGULAR
    }
    expect(encodeAttachmentItem(attachment)).toBe('0:123.txt:3:2492:1:')
    const example = Buffer.from('hello\u00000:123.txt:0000000003:2492:1:', 'ascii')
    const parsed = parseOffer(example, false)
    expect(parsed.text).toBe('hello')
    expect(parsed.attachments).toEqual([attachment])
    const built = buildFileBody('', [attachment])
    expect(built.utf8).toBe(false)
    expect(built.body[0]).toBe(0)
    expect(parseOffer(built.body, built.utf8).attachments).toEqual([attachment])
  })

  it('parses the standard item with hex fields', () => {
    const body = Buffer.from('hello\u000012c:test.txt:1000:65f00000:20:', 'utf8')
    const parsed = parseOffer(body, false)
    expect(parsed.text).toBe('hello')
    expect(parsed.attachments).toEqual([
      { id: 0x12c, name: 'test.txt', size: 0x1000, mtime: 0x65f00000, attr: 0x20 }
    ])
  })

  it('round-trips a Chinese name and escapes colons', () => {
    const attachment: Attachment = {
      id: 0x1a2b,
      name: '项目:最终报告.docx',
      size: 2048,
      mtime: 1700000000,
      attr: FILE_ATTR_REGULAR
    }
    expect(escapeAttachName(attachment.name)).toBe('项目::最终报告.docx')
    const built = buildFileBody('请查收附件', [attachment])
    expect(built.utf8).toBe(false)
    expect(built.body.includes(encodeGbk('项目::最终报告.docx'))).toBe(true)
    expect(built.body.includes(Buffer.from(':800:', 'ascii'))).toBe(true)
    const parsed = parseOffer(built.body, built.utf8)
    expect(parsed.text).toBe('请查收附件')
    expect(parsed.attachments).toEqual([attachment])
  })

  it('separates multiple attachments with \\a', () => {
    const attachments: Attachment[] = [
      { id: 1, name: 'a.txt', size: 1, mtime: 1700000001, attr: FILE_ATTR_REGULAR },
      { id: 2, name: '中文 名.bin', size: 4096, mtime: 1700000002, attr: FILE_ATTR_REGULAR }
    ]
    const built = buildFileBody('', attachments)
    expect(built.utf8).toBe(false)
    expect(built.body[0]).toBe(0)
    expect(built.body.filter((byte) => byte === 0x07)).toHaveLength(1)
    expect(parseOffer(built.body, built.utf8).attachments).toEqual(attachments)
  })

  it('switches the whole body to UTF-8 when a name needs it', () => {
    const attachments: Attachment[] = [
      { id: 7, name: '报告📄.txt', size: 3, mtime: 1700000003, attr: FILE_ATTR_REGULAR }
    ]
    const built = buildFileBody('看这个📄', attachments)
    expect(built.utf8).toBe(true)
    const parsed = parseOffer(built.body, built.utf8)
    expect(parsed.text).toBe('看这个📄')
    expect(parsed.attachments).toEqual(attachments)
  })

  it('skips malformed attachment items', () => {
    const body = Buffer.from('hi\u0000not-a-file\u0007zz:bad.txt:1:2:1:', 'utf8')
    const parsed = parseOffer(body, false)
    expect(parsed.text).toBe('hi')
    expect(parsed.attachments).toHaveLength(0)
  })
})
