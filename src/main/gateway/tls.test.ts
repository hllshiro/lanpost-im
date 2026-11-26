import { afterEach, describe, expect, it } from 'vitest'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createPrivateKey, generateKeyPairSync, X509Certificate } from 'node:crypto'
import { loadTlsMaterial } from './tls'

const tempDirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lanpost-gateway-tls-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

describe('loadTlsMaterial 自签模式', () => {
  it('生成可解析的证书、私钥与指纹', async () => {
    const dir = tempDir()
    const material = await loadTlsMaterial({ mode: 'self-signed', dir })
    expect(material.cert).toContain('BEGIN CERTIFICATE')
    expect(material.key).toContain('BEGIN PRIVATE KEY')

    const certificate = new X509Certificate(material.cert)
    expect(certificate.checkHost('localhost')).toBe('localhost')
    expect(certificate.checkIP('127.0.0.1')).toBe('127.0.0.1')
    expect(certificate.checkPrivateKey(createPrivateKey(material.key))).toBe(true)
    expect(material.fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/)
  })

  it('把证书和私钥写到 tls/ 并收紧权限', async () => {
    const dir = tempDir()
    await loadTlsMaterial({ mode: 'self-signed', dir })
    expect(existsSync(join(dir, 'tls', 'cert.pem'))).toBe(true)
    expect(existsSync(join(dir, 'tls', 'key.pem'))).toBe(true)
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, 'tls', 'cert.pem')).mode & 0o777).toBe(0o600)
      expect(statSync(join(dir, 'tls', 'key.pem')).mode & 0o777).toBe(0o600)
    }
  })

  it('再次调用复用同一张证书', async () => {
    const dir = tempDir()
    const first = await loadTlsMaterial({ mode: 'self-signed', dir })
    const second = await loadTlsMaterial({ mode: 'self-signed', dir })
    expect(second.cert).toBe(first.cert)
    expect(second.fingerprint).toBe(first.fingerprint)
  })

  it('剩余有效期不足 7 天时重新生成', async () => {
    const dir = tempDir()
    const now = Date.now()
    const first = await loadTlsMaterial({ mode: 'self-signed', dir, now: () => now })
    const later = (): number => now + 820 * 86_400_000
    const second = await loadTlsMaterial({ mode: 'self-signed', dir, now: later })
    expect(second.fingerprint).not.toBe(first.fingerprint)
  })
})

describe('loadTlsMaterial 文件模式', () => {
  it('读取指定 PEM 并计算同一指纹', async () => {
    const dir = tempDir()
    const generated = await loadTlsMaterial({ mode: 'self-signed', dir })
    const certPath = join(dir, 'custom-cert.pem')
    const keyPath = join(dir, 'custom-key.pem')
    writeFileSync(certPath, generated.cert)
    writeFileSync(keyPath, generated.key)

    const material = await loadTlsMaterial({ mode: 'files', dir, certPath, keyPath })
    expect(new X509Certificate(material.cert).fingerprint256).toBe(generated.fingerprint)
  })

  it('证书与私钥不匹配时抛错', async () => {
    const dir = tempDir()
    const generated = await loadTlsMaterial({ mode: 'self-signed', dir })
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const certPath = join(dir, 'custom-cert.pem')
    const keyPath = join(dir, 'custom-key.pem')
    writeFileSync(certPath, generated.cert)
    writeFileSync(keyPath, other.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string)
    chmodSync(keyPath, 0o600)

    await expect(loadTlsMaterial({ mode: 'files', dir, certPath, keyPath })).rejects.toThrow(
      /证书与私钥不匹配/
    )
  })

  it('缺少路径时抛错', async () => {
    const dir = tempDir()
    await expect(loadTlsMaterial({ mode: 'files', dir })).rejects.toThrow(/证书路径/)
  })
})

describe('loadTlsMaterial 生成物可被 https 使用', () => {
  it('私钥是 RSA-2048 且证书有效期约 825 天', async () => {
    const dir = tempDir()
    const material = await loadTlsMaterial({ mode: 'self-signed', dir })
    const key = createPrivateKey(material.key)
    expect(key.asymmetricKeyDetails?.modulusLength).toBe(2048)
    const certificate = new X509Certificate(material.cert)
    const days = (Date.parse(certificate.validTo) - Date.parse(certificate.validFrom)) / 86_400_000
    expect(days).toBeGreaterThan(824)
    expect(days).toBeLessThan(826)
  })
})

// 保证测试不会因为残留文件而误判复用
describe('loadTlsMaterial 过期文件', () => {
  it('已存在的证书文件损坏时重新生成', async () => {
    const dir = tempDir()
    const first = await loadTlsMaterial({ mode: 'self-signed', dir })
    writeFileSync(join(dir, 'tls', 'cert.pem'), 'not a certificate')
    expect(readFileSync(join(dir, 'tls', 'cert.pem'), 'utf8')).toBe('not a certificate')
    const second = await loadTlsMaterial({ mode: 'self-signed', dir })
    expect(second.fingerprint).not.toBe(first.fingerprint)
  })
})
