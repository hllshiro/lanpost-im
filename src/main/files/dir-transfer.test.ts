import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileServer } from './server'
import { pullDirectory } from './dir-receiver'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lanpost-dir-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

async function freeTcpPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

describe('directory transfer', () => {
  it('rebuilds nested and empty directories with file contents', async () => {
    const source = tempDir()
    mkdirSync(join(source, 'nested', 'empty'), { recursive: true })
    writeFileSync(join(source, '中文.txt'), 'hello')
    writeFileSync(join(source, 'nested', 'child.bin'), Buffer.from([1, 2, 3, 4]))
    const destination = tempDir()
    const target = join(destination, '.lanpost-test')

    const port = await freeTcpPort()
    const server = new FileServer({
      bindAddr: '127.0.0.1',
      port,
      resolve: (request) => (request.cmd === 0x62 ? { path: source, kind: 'dir' } : null),
      onLog: () => undefined,
      onError: (error) => {
        throw error
      }
    })
    await server.start()
    try {
      const result = await pullDirectory({
        peerIp: '127.0.0.1',
        peerPort: port,
        packetId: 1,
        fileId: 2,
        seq: 3,
        user: 'tester',
        host: 'host',
        path: target
      })
      expect(result.received).toBe(9)
      expect(readFileSync(join(target, '中文.txt'), 'utf8')).toBe('hello')
      expect(readFileSync(join(target, 'nested', 'child.bin'))).toEqual(Buffer.from([1, 2, 3, 4]))
      expect(statSync(join(target, 'nested', 'empty')).isDirectory()).toBe(true)
      expect(statSync(join(target, '中文.txt')).isFile()).toBe(true)
    } finally {
      await server.stop()
    }
  }, 20000)
})
