export interface HostListEntry {
  user: string
  host: string
  status: number
  addr: string
  port: number
  nickname: string
  group: string
}

const IDENT = 0x07
const NUL = 0x00
const DECIMAL = /^\d+$/
const FIELDS_PER_HOST = 7
const HEADER_FIELDS = 2
const MAX_PORT = 0xffff
const MAX_STATUS = 0xffffffff

// 端口按主机字节序（htons）写进报文，读回时再交换一次。
function htons(port: number): number {
  return ((port & 0xff) << 8) | ((port >>> 8) & 0xff)
}

function pad5(value: number): string {
  return String(value).padStart(5, ' ')
}

function encodeHost(host: HostListEntry): string {
  const fields = [
    host.user,
    host.host,
    String(host.status),
    host.addr,
    String(htons(host.port)),
    host.nickname,
    host.group
  ]
  return `${fields.join('\u0007')}\u0007\u0007`
}

// ANSLIST 载荷：`%5d\a%5d\a` 头（下一批起始序号、本批数量），后接主机条目。
export function buildHostList(start: number, hosts: HostListEntry[]): Buffer {
  const header = `${pad5(start)}\u0007${pad5(hosts.length)}\u0007`
  const body = hosts.map(encodeHost).join('')
  return Buffer.from(`${header}${body}`, 'utf8')
}

function trimNuls(data: Buffer): Buffer {
  let end = data.length
  while (end > 0 && data[end - 1] === NUL) {
    end--
  }
  return data.subarray(0, end)
}

function splitIdent(data: Buffer): Buffer[] {
  const fields: Buffer[] = []
  let start = 0
  for (let i = 0; i < data.length; i++) {
    if (data[i] !== IDENT) continue
    fields.push(data.subarray(start, i))
    start = i + 1
  }
  if (start < data.length) {
    fields.push(data.subarray(start))
  }
  return fields
}

function parseDecimal(field: Buffer, max: number): number | null {
  // 头部按 `%5d` 用空格补齐，数字字段先去掉首尾空白。
  const text = field.toString('ascii').trim()
  if (!DECIMAL.test(text)) {
    return null
  }
  const value = Number.parseInt(text, 10)
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    return null
  }
  return value
}

function decodeField(field: Buffer): string {
  let end = field.length
  while (end > 0 && field[end - 1] === NUL) {
    end--
  }
  return field.subarray(0, end).toString('utf8')
}

function isBlank(field: Buffer): boolean {
  return field.length === 0
}

function parseHost(fields: Buffer[], index: number): HostListEntry | null {
  const status = parseDecimal(fields[index + 2], MAX_STATUS)
  const port = parseDecimal(fields[index + 4], MAX_PORT)
  if (status === null || port === null) {
    return null
  }
  return {
    user: decodeField(fields[index]),
    host: decodeField(fields[index + 1]),
    status,
    addr: decodeField(fields[index + 3]),
    port: htons(port),
    nickname: decodeField(fields[index + 5]),
    group: decodeField(fields[index + 6])
  }
}

// 容错解析：尾部 NUL 填充与不完整的尾项都直接忽略，不抛错。
export function parseHostList(payload: Buffer): { next: number; hosts: HostListEntry[] } {
  const fields = splitIdent(trimNuls(payload))
  if (fields.length < HEADER_FIELDS) {
    return { next: 0, hosts: [] }
  }
  const next = parseDecimal(fields[0], Number.MAX_SAFE_INTEGER) ?? 0
  const count = parseDecimal(fields[1], Number.MAX_SAFE_INTEGER) ?? 0
  const hosts: HostListEntry[] = []
  let index = HEADER_FIELDS
  while (index < fields.length && hosts.length < (count > 0 ? count : Number.MAX_SAFE_INTEGER)) {
    if (fields.length - index < FIELDS_PER_HOST) {
      break
    }
    const host = parseHost(fields, index)
    if (host === null) {
      break
    }
    hosts.push(host)
    index += FIELDS_PER_HOST
    if (index < fields.length && isBlank(fields[index])) {
      index++
    }
  }
  return { next, hosts }
}
