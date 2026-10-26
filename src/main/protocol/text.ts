import { canEncodeGbk, decodeText, encodeGbk, encodeGbkLossy } from './encoding'

export interface EncodedMessage {
  data: Buffer
  utf8: boolean
  lossy: boolean
}

// 有 UTF-8 能力时一律用 UTF-8，emoji 可以完整往返；旧对端才回退 GBK。
export function encodeMessageText(text: string, caps: { utf8: boolean }): EncodedMessage {
  const normalized = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  if (caps.utf8) {
    return { data: Buffer.from(normalized, 'utf8'), utf8: true, lossy: false }
  }
  if (canEncodeGbk(normalized)) {
    return { data: encodeGbk(normalized), utf8: false, lossy: false }
  }
  return { data: encodeGbkLossy(normalized), utf8: false, lossy: true }
}

export function decodeMessageText(data: Buffer, utf8: boolean): string {
  return decodeText(data, utf8)
}
