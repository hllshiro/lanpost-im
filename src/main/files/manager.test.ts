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

describe('FileManager message linking and cancellation', () => {
  it('links a task to a message and returns the updated snapshot', () => {
    const source = join(tempDir(), 'linked.txt')
    writeFileSync(source, 'x')
    const instance = manager(tempDir())
    const task = instance.addOutgoing({
      peerKey: 'peer',
      peerIp: '127.0.0.1',
      peerPort: 1,
      name: 'linked.txt',
      size: 1,
      mtime: 1,
      fileId: 7,
      packetId: 8,
      path: source
    })
    const linked = instance.linkTask(task.id, 'direct:peer', 42)
    expect(linked).toMatchObject({ messageId: 42, conversationId: 'direct:peer' })
    expect(instance.list()[0]).toMatchObject({ messageId: 42, conversationId: 'direct:peer' })
  })

  it('marks an outgoing task canceled and tells the peer', () => {
    const source = join(tempDir(), 'cancel.txt')
    writeFileSync(source, 'x')
    const releases: string[] = []
    const instance = new FileManager({
      bindAddr: '127.0.0.1',
      port: 0,
      receiveDir: tempDir(),
      notifyAccepted: () => undefined,
      notifyReleased: (peerKey, packetId) => releases.push(`${peerKey}:${packetId}`),
      callbacks: { onUpdate: () => undefined, onLog: () => undefined, onError: () => undefined }
    })
    managers.push(instance)
    const task = instance.addOutgoing({
      peerKey: 'peer',
      peerIp: '127.0.0.1',
      peerPort: 1,
      name: 'cancel.txt',
      size: 1,
      mtime: 1,
      fileId: 9,
      packetId: 10,
      path: source
    })
    instance.cancel(task.id)
    expect(instance.list()[0].state).toBe('canceled')
    expect(releases).toEqual(['peer:10'])
  })

  it('marks an incoming task rejected when the sender releases it', () => {
    const instance = manager(tempDir())
    const created = instance.offerIncoming({
      peerKey: 'peer',
      peerIp: '127.0.0.1',
      peerPort: 1,
      packetId: 11,
      attachments: [{ id: 12, name: 'in.txt', size: 1, mtime: 1, attr: 1 }]
    })
    instance.markReleased(11, [12])
    expect(instance.list().find((task) => task.id === created[0].id)?.state).toBe('rejected')
  })
})

describe('FileManager stale request handling', () => {
  it('revives a canceled task when the peer requests it again', async () => {
    const source = join(tempDir(), 'stale.txt')
    writeFileSync(source, 'stale')
    const releases: string[] = []
    const instance = new FileManager({
      bindAddr: '127.0.0.1',
      port: 0,
      receiveDir: tempDir(),
      notifyAccepted: () => undefined,
      notifyReleased: (peerKey, packetId) => releases.push(`${peerKey}:${packetId}`),
      callbacks: { onUpdate: () => undefined, onLog: () => undefined, onError: () => undefined }
    })
    managers.push(instance)
    const task = instance.addOutgoing({
      peerKey: 'peer',
      peerIp: '127.0.0.1',
      peerPort: 1,
      name: 'stale.txt',
      size: 5,
      mtime: 1,
      fileId: 0x41,
      packetId: 0x42,
      path: source
    })
    instance.cancel(task.id)
    await instance.start()
    const target = join(tempDir(), 'revived.bin')
    await pullFile({
      peerIp: '127.0.0.1',
      peerPort: instance.address().port,
      packetId: 0x42,
      fileId: 0x41,
      seq: 2,
      user: 'u',
      host: 'h',
      path: target,
      size: 5
    })
    expect(readFileSync(target, 'utf8')).toBe('stale')
    expect(instance.list()[0].state).toBe('done')
    expect(releases.length).toBe(1)
  }, 20000)
})

describe('FileManager foreign fileId compatibility', () => {
  it('matches by packetId when the peer sends its own fileId', async () => {
    const receive = tempDir()
    const source = join(tempDir(), 'nwt.bin')
    writeFileSync(source, 'nwt-data')
    const instance = manager(receive)
    instance.addOutgoing({
      peerKey: 'peer',
      peerIp: '127.0.0.1',
      peerPort: 1,
      name: 'nwt.bin',
      size: 8,
      mtime: 1,
      fileId: 0x99,
      packetId: 0x1234,
      path: source
    })
    await instance.start()
    const target = join(receive, 'nwt-received.bin')
    await pullFile({
      peerIp: '127.0.0.1',
      peerPort: instance.address().port,
      packetId: 0x1234,
      fileId: 7,
      seq: 3,
      user: 'u',
      host: 'h',
      path: target,
      size: 8
    })
    expect(readFileSync(target, 'utf8')).toBe('nwt-data')
  }, 20000)
})

describe('FileManager NWT cancel payload', () => {
  it('releases by decimal and hex packetId payloads', () => {
    const source = join(tempDir(), 'nwt-cancel.txt')
    writeFileSync(source, 'x')
    const instance = manager(tempDir())
    const one = instance.addOutgoing({
      peerKey: 'peer',
      peerIp: '127.0.0.1',
      peerPort: 1,
      name: 'nwt-cancel.txt',
      size: 1,
      mtime: 1,
      fileId: 0x99,
      packetId: 1793064324,
      path: source
    })
    instance.releaseByNwtPayload('peer', Buffer.from('17930643247:\0', 'ascii'))
    expect(instance.get(one.id)?.state).toBe('rejected')

    const two = instance.addOutgoing({
      peerKey: 'peer',
      peerIp: '127.0.0.1',
      peerPort: 1,
      name: 'nwt-cancel-2.txt',
      size: 1,
      mtime: 1,
      fileId: 0x9a,
      packetId: 1793064325,
      path: source
    })
    instance.releaseByNwtPayload('peer', Buffer.from('6adffd85:\0 7\0', 'ascii'))
    expect(instance.get(two.id)?.state).toBe('rejected')
  })
})

describe('FileManager receive layout', () => {
  it('places incoming files and images under the peer nickname', () => {
    const base = tempDir()
    const instance = new FileManager({
      bindAddr: '127.0.0.1',
      port: 0,
      receiveDir: base,
      receiveLayout: 'nickname',
      notifyAccepted: () => undefined,
      notifyReleased: () => undefined,
      callbacks: { onUpdate: () => undefined, onLog: () => undefined, onError: () => undefined }
    })
    managers.push(instance)
    const [file] = instance.offerIncoming({
      peerKey: '10.0.0.1|alice',
      peerName: '张三',
      peerIp: '127.0.0.1',
      peerPort: 1,
      packetId: 1,
      attachments: [{ id: 2, name: 'a.txt', size: 1, mtime: 1, attr: 1 }]
    })
    expect(instance.get(file.id)?.folder).toBe(join(base, '张三'))

    const [image] = instance.offerIncoming({
      peerKey: '10.0.0.1|alice',
      peerName: '张三',
      peerIp: '127.0.0.1',
      peerPort: 1,
      packetId: 2,
      kind: 'image',
      attachments: [{ id: 3, name: 'a.png', size: 1, mtime: 1, attr: 0x20 }]
    })
    expect(instance.get(image.id)?.folder).toBe(join(base, '张三', 'images'))
  })
})
