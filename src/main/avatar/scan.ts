// 群头像请求的 HELLO 正文里，md5 以 UTF-16LE 写在任意偏移；扫出 32 位十六进制串
export function findUtf16Md5(body: Buffer): string {
  for (let offset = 0; offset + 64 <= body.length; offset += 1) {
    const text = body
      .subarray(offset, offset + 64)
      .toString('utf16le')
      .toLowerCase()
    if (/^[0-9a-f]{32}$/.test(text)) return text
  }
  return ''
}
