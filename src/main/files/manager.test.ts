import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { pullDirectory } from './dir-receiver'
import { pullFile } from './client'
import { FileManager } from './manager'

const dirs: string[] = []
const managers: FileManager[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lanpost-manager-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.stop()))
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

function manager(receiveDir: string): FileManager {
  const instance = new FileManager({
    bindAddr: '127.0.0.1',
    port: 0,
    receiveDir,
    notifyAccepted: () => undefined,
    notifyReleased: () => undefined,
    callbacks: {
      onUpdate: () => undefined,
      onLog: () => undefined,
      onError: (error) => {
        throw error
      }
    }
  })
  managers.push(instance)
  return instance
}

describe('FileManager directory and multi-attachment', () => {
  it('serves an outgoing directory through addOutgoing', async () => {
    const source = tempDir()
    mkdirSync(join(source, 'nested'), { recursive: true })
    writeFileSync(join(source, 'nested', 'a.txt'), 'alpha')
    const receive = tempDir()
    const target = join(receive, '.temp')
    const instance = manager(receive)
    instance.addOutgoing({
      peerKey: 'peer',
      peerIp: '127.0.0.1',
      peerPort: 1,
      name: '源目录',
      size: 5,
      mtime: 1,
      fileId: 0x11,
      packetId: 0x22,
      path: source,
      kind: 'dir',
      entryCount: 1,
      utf8: true
    })
    await instance.start()
    const address = instance.address()
    await pullDirectory({
      peerIp: '127.0.0.1',
      peerPort: address.port,
      packetId: 0x22,
      fileId: 0x11,
      seq: 3,
      user: 'u',
      host: 'h',
      path: target,
      utf8: true
    })
    expect(readFileSync(join(target, 'nested', 'a.txt'), 'utf8')).toBe('alpha')
  }, 20000)

  it('matches fileId before packetId for multi-attachment offers', async () => {
    const receive = tempDir()
    const source = tempDir()
    writeFileSync(join(source, 'one'), 'first')
    writeFileSync(join(source, 'two'), 'second')
    const instance = manager(receive)
    instance.addOutgoing({
      peerKey: 'peer',
      peerIp: '127.0.0.1',
      peerPort: 1,
      name: 'one',
      size: 5,
      mtime: 1,
      fileId: 0x31,
      packetId: 0x44,
      path: join(source, 'one')
    })
    instance.addOutgoing({
      peerKey: 'peer',
      peerIp: '127.0.0.1',
      peerPort: 1,
      name: 'two',
      size: 6,
      mtime: 1,
      fileId: 0x32,
      packetId: 0x44,
      path: join(source, 'two')
    })
    await instance.start()
    const address = instance.address()
    const head = {
      peerIp: '127.0.0.1',
      peerPort: address.port,
      packetId: 0x44,
      seq: 5,
      user: 'u',
      host: 'h'
    }
    await pullFile({ ...head, fileId: 0x32, path: join(receive, 'two.bin'), size: 6 })
    expect(readFileSync(join(receive, 'two.bin'), 'utf8')).toBe('second')
  }, 20000)

  it('marks an outgoing task rejected when the peer releases it', () => {
    const instance = manager(tempDir())
    const source = join(tempDir(), 'file.txt')
    writeFileSync(source, 'x')
    instance.addOutgoing({
      peerKey: 'peer',
      peerIp: '127.0.0.1',
      peerPort: 1,
      name: 'file.txt',
      size: 1,
      mtime: 1,
      fileId: 1,
      packetId: 2,
      path: source
    })
    instance.markReleased(2, [1])
    expect(instance.list()[0].state).toBe('rejected')
  })
})
