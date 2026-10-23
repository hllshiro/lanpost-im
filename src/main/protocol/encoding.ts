import iconv from 'iconv-lite'

const REPLACEMENT = '\uFFFD'

// iconv-lite 的 GBK 编码器遇到无法表示的字符时不会报错，而是写入 '?'，
// 因此用往返比对判断文本是否真的能放进 GBK。
export function canEncodeGbk(text: string): boolean {
  return iconv.decode(iconv.encode(text, 'gbk'), 'gbk') === text
}

export function encodeGbk(text: string): Buffer {
  const data = iconv.encode(text, 'gbk')
  if (iconv.decode(data, 'gbk') !== text) {
    throw new Error(`文本无法用 GBK 编码: ${JSON.stringify(text)}`)
  }
  return data
}

export interface EncodedText {
  data: Buffer
  utf8: boolean
}

export function encodeText(text: string): EncodedText {
  if (canEncodeGbk(text)) {
    return { data: iconv.encode(text, 'gbk'), utf8: false }
  }
  return { data: Buffer.from(text, 'utf8'), utf8: true }
}

export function decodeGbk(data: Buffer): string {
  return iconv.decode(data, 'gbk')
}

// 入站按 UTF8 标志选择编码；没有标志时按 GBK 解码，遇到非法序列退回 UTF-8。
export function decodeText(data: Buffer, utf8: boolean): string {
  if (utf8) {
    return data.toString('utf8')
  }
  const gbk = iconv.decode(data, 'gbk')
  if (gbk.includes(REPLACEMENT)) {
    const asUtf8 = data.toString('utf8')
    if (!asUtf8.includes(REPLACEMENT)) {
      return asUtf8
    }
  }
  return gbk
}
