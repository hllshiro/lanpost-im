const ONLINE_TEXT = 'Not absence mode'
const FALLBACK_ABSENCE = 'Away'
const NUL = 0x00

export function buildInfo(version: string): Buffer {
  return Buffer.from(`lanpost-im ${version} (IPMSG draft10; UTF8; FILE; CLIPBOARD)`, 'utf8')
}

export function buildAbsenceInfo(absent: boolean, text: string): Buffer {
  if (!absent) {
    return Buffer.from(ONLINE_TEXT, 'utf8')
  }
  const trimmed = text.trim()
  return Buffer.from(trimmed.length > 0 ? trimmed : FALLBACK_ABSENCE, 'utf8')
}

// SENDINFO / SENDABSENCEINFO 载荷是纯文本，尾部可能带 NUL 填充。
export function parseInfo(payload: Buffer): string {
  let start = 0
  let end = payload.length
  while (start < end && payload[start] === NUL) {
    start++
  }
  while (end > start && payload[end - 1] === NUL) {
    end--
  }
  return payload.subarray(start, end).toString('utf8')
}
