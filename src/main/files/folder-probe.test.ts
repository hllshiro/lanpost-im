import { describe, expect, it } from 'vitest'
import { scanUtf16 } from './folder-probe'

function utf16(value: string): Buffer {
  return Buffer.from(value, 'utf16le')
}

describe('scanUtf16', () => {
  it('picks UTF-16LE strings out of a binary payload', () => {
    const body = Buffer.concat([
      Buffer.alloc(8, 0),
      utf16('C:\\资料\\报告.docx'),
      Buffer.alloc(6, 0),
      utf16('子目录'),
      Buffer.alloc(4, 0)
    ])

    expect(scanUtf16(body)).toEqual(['C:\\资料\\报告.docx', '子目录'])
  })

  it('keeps channel ids made of digits and dashes', () => {
    const body = Buffer.concat([
      Buffer.alloc(4, 0),
      utf16('fc8467cf-1a2b-4c3d'),
      Buffer.alloc(4, 0)
    ])

    expect(scanUtf16(body)).toEqual(['fc8467cf-1a2b-4c3d'])
  })

  it('ignores short runs left by numeric fields', () => {
    const body = Buffer.concat([Buffer.from([0, 0, 2, 0, 1, 0, 0, 0]), Buffer.alloc(8, 0)])

    expect(scanUtf16(body)).toEqual([])
  })
})
