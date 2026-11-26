import {
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  X509Certificate
} from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { hostname, networkInterfaces } from 'node:os'
import { join } from 'node:path'

export interface TlsMaterial {
  key: string
  cert: string
  fingerprint: string
}

export interface TlsInput {
  mode: 'self-signed' | 'files'
  dir: string
  certPath?: string
  keyPath?: string
  now?: () => number
}

const VALIDITY_DAYS = 825
const RENEW_BEFORE_MS = 7 * 86_400_000

/** 最小 DER 编码器：只覆盖本证书用到的 ASN.1 结构。 */
function derLength(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length])
  const bytes: number[] = []
  let rest = length
  while (rest > 0) {
    bytes.unshift(rest & 0xff)
    rest >>>= 8
  }
  return Buffer.from([0x80 | bytes.length, ...bytes])
}

function tlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), content])
}

function seq(...items: Buffer[]): Buffer {
  return tlv(0x30, Buffer.concat(items))
}

function set(...items: Buffer[]): Buffer {
  return tlv(0x31, Buffer.concat(items))
}

function integer(value: number): Buffer {
  const bytes: number[] = []
  let rest = value
  do {
    bytes.unshift(rest & 0xff)
    rest >>= 8
  } while (rest > 0)
  if (bytes[0] & 0x80) bytes.unshift(0)
  return tlv(0x02, Buffer.from(bytes))
}

function oid(dotted: string): Buffer {
  const parts = dotted.split('.').map(Number)
  const bytes: number[] = [parts[0] * 40 + parts[1]]
  for (const part of parts.slice(2)) {
    const chunk: number[] = [part & 0x7f]
    let rest = part >>> 7
    while (rest > 0) {
      chunk.unshift((rest & 0x7f) | 0x80)
      rest >>>= 7
    }
    bytes.push(...chunk)
  }
  return tlv(0x06, Buffer.from(bytes))
}

function utf8(value: string): Buffer {
  return tlv(0x0c, Buffer.from(value, 'utf8'))
}

function utcTime(date: Date): Buffer {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const text =
    `${pad(date.getUTCFullYear() % 100)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  return tlv(0x17, Buffer.from(text, 'ascii'))
}

function bool(value: boolean): Buffer {
  return tlv(0x01, Buffer.from([value ? 0xff : 0x00]))
}

function octetString(value: Buffer): Buffer {
  return tlv(0x04, value)
}

function bitString(value: Buffer, unusedBits = 0): Buffer {
  return tlv(0x03, Buffer.concat([Buffer.from([unusedBits]), value]))
}

function explicit(tagNumber: number, value: Buffer): Buffer {
  return tlv(0xa0 | tagNumber, value)
}

function extension(dotted: string, critical: boolean, value: Buffer): Buffer {
  const parts = [oid(dotted)]
  if (critical) parts.push(bool(true))
  parts.push(octetString(value))
  return seq(...parts)
}

function name(): Buffer {
  return seq(set(seq(oid('2.5.4.3'), utf8('lanpost-im Gateway'))))
}

function localIpv4s(): string[] {
  const addresses = new Set(['127.0.0.1'])
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) addresses.add(entry.address)
    }
  }
  return [...addresses]
}

function subjectAltName(hosts: string[]): Buffer {
  const names: Buffer[] = []
  for (const host of hosts) {
    names.push(tlv(0x82, Buffer.from(host, 'ascii')))
  }
  const ipv4 = localIpv4s()
  for (const ip of ipv4) {
    names.push(tlv(0x87, Buffer.from(ip.split('.').map(Number))))
  }
  names.push(tlv(0x87, Buffer.from([...new Array(15).fill(0), 1])))
  return seq(...names)
}

function pemEncode(der: Buffer, label: string): string {
  const body = der.toString('base64').replace(/(.{64})/g, '$1\n')
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`
}

function usable(cert: X509Certificate, keyPem: string, now: number): boolean {
  const expiresAt = Date.parse(cert.validTo)
  if (!Number.isFinite(expiresAt) || expiresAt - now < RENEW_BEFORE_MS) return false
  try {
    if (!cert.checkPrivateKey(createPrivateKey(keyPem))) return false
  } catch {
    return false
  }
  for (const ip of localIpv4s()) {
    if (!cert.checkIP(ip)) return false
  }
  return Boolean(cert.checkHost(hostname()))
}

function generate(now: number): { key: string; cert: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  let serial: Buffer
  do {
    serial = randomBytes(16)
    serial[0] &= 0x7f
  } while (serial[0] === 0)

  const algorithm = seq(oid('1.2.840.113549.1.1.11'), tlv(0x05, Buffer.alloc(0)))
  const issuer = name()
  const validity = seq(
    utcTime(new Date(now - 3_600_000)),
    utcTime(new Date(now + VALIDITY_DAYS * 86_400_000))
  )
  const spki = publicKey.export({ type: 'spki', format: 'der' })
  const extensions = seq(
    extension('2.5.29.19', true, seq()),
    extension('2.5.29.15', true, bitString(Buffer.from([0xa0]), 5)),
    extension('2.5.29.37', false, seq(oid('1.3.6.1.5.5.7.3.1'))),
    extension('2.5.29.17', false, subjectAltName(['localhost', hostname()]))
  )
  const tbs = seq(
    explicit(0, integer(2)),
    tlv(0x02, serial),
    algorithm,
    issuer,
    validity,
    issuer,
    spki,
    explicit(3, extensions)
  )
  const signature = sign('sha256', tbs, privateKey)
  const der = seq(tbs, algorithm, bitString(signature))
  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    cert: pemEncode(der, 'CERTIFICATE')
  }
}

function materialFrom(key: string, cert: string): TlsMaterial {
  return { key, cert, fingerprint: new X509Certificate(cert).fingerprint256 }
}

export async function loadTlsMaterial(input: TlsInput): Promise<TlsMaterial> {
  const now = input.now ? input.now() : Date.now()

  if (input.mode === 'files') {
    if (!input.certPath || !input.keyPath) {
      throw new Error('证书路径和私钥路径不能为空')
    }
    const cert = readFileSync(input.certPath, 'utf8')
    const key = readFileSync(input.keyPath, 'utf8')
    const certificate = new X509Certificate(cert)
    if (!certificate.checkPrivateKey(createPrivateKey(key))) {
      throw new Error('证书与私钥不匹配')
    }
    return materialFrom(key, cert)
  }

  const tlsDir = join(input.dir, 'tls')
  const certFile = join(tlsDir, 'cert.pem')
  const keyFile = join(tlsDir, 'key.pem')
  if (existsSync(certFile) && existsSync(keyFile)) {
    try {
      const cert = readFileSync(certFile, 'utf8')
      const key = readFileSync(keyFile, 'utf8')
      if (usable(new X509Certificate(cert), key, now)) {
        return materialFrom(key, cert)
      }
    } catch {
      // 证书损坏或无法解析：重新生成。
    }
  }

  const generated = generate(now)
  mkdirSync(tlsDir, { recursive: true })
  writeFileSync(keyFile, generated.key, { mode: 0o600 })
  writeFileSync(certFile, generated.cert, { mode: 0o600 })
  try {
    chmodSync(keyFile, 0o600)
    chmodSync(certFile, 0o600)
  } catch {
    // Windows 上 chmod 能力有限，忽略即可。
  }
  return materialFrom(generated.key, generated.cert)
}
