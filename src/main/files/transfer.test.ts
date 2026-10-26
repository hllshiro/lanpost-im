import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { FileTaskInfo } from '../../shared/domain'
import { pullFile } from './client'
import { FileManager } from './manager'
import { FileServer, type GetFileRequest } from './server'

const dirs: string[] = []
const servers: FileServer[] = []
const managers: FileManager[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lanpost-transfer-'))
  dirs.push(dir)
  return dir
}

async function freeTcpPort(): Promise<number> {
  for (;;) {
    const server = createServer()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    const port = address !== null && typeof address === 'object' ? address.port : 0
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
    if (port > 0 && port !== 2425) {
      return port
    }
  }
}

function payload(size: number): Buffer {
  const data = Buffer.alloc(size)
  for (let index = 0; index < size; index++) {
    data[index] = (index * 31 + 7) % 251
  }
  return data
}

afterEach(async () => {
  for (const manager of managers.splice(0)) {
    await manager.stop()
  }
  for (const server of servers.splice(0)) {
    await server.stop()
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('文件服务与拉取客户端', () => {
  it('streams a file over real TCP and refuses an unknown packet id', async () => {
    const dir = tempDir()
    const receiveDir = join(dir, 'receive')
    mkdirSync(receiveDir)
    const content = payload(2 * 1024 * 1024 + 17)
    const source = join(dir, 'source.bin')
    writeFileSync(source, content)

    const requests: GetFileRequest[] = []
    const sentProgress: number[] = []
    const errors: Error[] = []
    const logs: string[] = []
    const port = await freeTcpPort()
    const server = new FileServer({
      bindAddr: '127.0.0.1',
      port,
      resolve: (request) => {
        requests.push(request)
        if (request.packetId !== 0x2a2a) {
          return null
        }
        return {
          path: source,
          onProgress: (sent) => sentProgress.push(sent)
        }
      },
      onLog: (message) => logs.push(message),
      onError: (error) => errors.push(error)
    })
    servers.push(server)
    await server.start()
    expect(server.address().port).toBe(port)

    const target = join(receiveDir, 'source.bin')
    const receivedProgress: number[] = []
    const written = await pullFile({
      peerIp: '127.0.0.1',
      peerPort: port,
      packetId: 0x2a2a,
      fileId: 0x77,
      seq: 42,
      user: 'tester',
      host: 'test-host',
      path: target,
      size: content.length,
      onProgress: (received) => receivedProgress.push(received)
    })

    expect(written).toBe(content.length)
    expect(readFileSync(target).equals(content)).toBe(true)
    expect(requests[0].version).toBe('1')
    expect(requests[0].packetId).toBe(0x2a2a)
    expect(requests[0].fileIds).toEqual([0x77])
    expect(receivedProgress.at(-1)).toBe(content.length)
    expect(sentProgress.at(-1)).toBe(content.length)

    const wrongTarget = join(receiveDir, 'wrong.bin')
    await expect(
      pullFile({
        peerIp: '127.0.0.1',
        peerPort: port,
        packetId: 0x999,
        fileId: 0x77,
        seq: 43,
        user: 'tester',
        host: 'test-host',
        path: wrongTarget,
        size: content.length
      })
    ).rejects.toThrow(/文件不完整/)
    expect(existsSync(wrongTarget)).toBe(false)
    expect(requests.at(-1)?.packetId).toBe(0x999)
    expect(errors).toEqual([])
    expect(logs.some((message) => message.includes('未知的取文件请求'))).toBe(true)
  }, 20000)

  it('offers and accepts a file through the manager', async () => {
    const dir = tempDir()
    const receiveDir = join(dir, 'receive')
    const content = payload(180 * 1024 + 3)
    const source = join(dir, '报告.pdf')
    writeFileSync(source, content)

    const accepted: Array<{ peerKey: string; packetId: number }> = []
    const updates: FileTaskInfo[] = []
    const errors: Error[] = []
    const port = await freeTcpPort()
    let seq = 1000
    const manager = new FileManager({
      bindAddr: '127.0.0.1',
      port,
      receiveDir,
      notifyAccepted: (peerKey, packetId) => {
        accepted.push({ peerKey, packetId })
      },
      callbacks: {
        onUpdate: (file) => updates.push(file),
        onLog: () => undefined,
        onError: (error) => errors.push(error)
      },
      identity: () => {
        seq += 1
        return { user: 'tester', host: 'test-host', seq }
      }
    })
    managers.push(manager)
    await manager.start()

    const packetId = 0x51
    const outgoing = manager.addOutgoing({
      peerKey: '127.0.0.1|peer',
      peerIp: '127.0.0.1',
      peerPort: manager.address().port,
      name: '报告.pdf',
      size: content.length,
      mtime: 1700000000,
      fileId: 0x33,
      packetId,
      path: source
    })
    expect(outgoing.state).toBe('offered')

    const attachment = {
      id: 0x33,
      name: '报告.pdf',
      size: content.length,
      mtime: 1700000000,
      attr: 1
    }
    const [incoming] = manager.offerIncoming({
      peerKey: '127.0.0.1|peer',
      peerIp: '127.0.0.1',
      peerPort: manager.address().port,
      packetId,
      attachments: [attachment]
    })
    expect(incoming.name).toBe('报告.pdf')
    expect(incoming.state).toBe('waiting')

    const [duplicate] = manager.offerIncoming({
      peerKey: '127.0.0.1|peer',
      peerIp: '127.0.0.1',
      peerPort: manager.address().port,
      packetId,
      attachments: [attachment]
    })
    expect(duplicate.name).toBe('报告 (1).pdf')

    await manager.accept(incoming.id)
    expect(accepted).toEqual([{ peerKey: '127.0.0.1|peer', packetId }])

    const done = manager.get(incoming.id)
    if (done === null) {
      throw new Error('文件任务丢失')
    }
    expect(done.state).toBe('done')
    expect(done.received).toBe(content.length)
    expect(done.path).not.toBe('')
    expect(readFileSync(done.path).equals(content)).toBe(true)
    expect(manager.get(outgoing.id)?.state).toBe('done')
    expect(manager.get(outgoing.id)?.received).toBe(content.length)
    expect(updates.some((file) => file.id === incoming.id && file.state === 'transferring')).toBe(
      true
    )
    expect(
      updates.some((file) => file.id === incoming.id && file.received === content.length)
    ).toBe(true)
    const listed = manager.list()
    expect(listed.find((file) => file.id === incoming.id)?.state).toBe('done')
    expect(listed.find((file) => file.id === outgoing.id)?.state).toBe('done')
    expect(errors).toEqual([])

    manager.reject(duplicate.id)
    expect(manager.get(duplicate.id)?.state).toBe('rejected')
  }, 20000)

  it('serves the newest offered task when the peer echoes its own identifiers', async () => {
    const dir = tempDir()
    const receiveDir = join(dir, 'receive')
    const content = payload(64 * 1024 + 7)
    const source = join(dir, 'fallback.bin')
    writeFileSync(source, content)
    const port = await freeTcpPort()
    const errors: Error[] = []
    const manager = new FileManager({
      bindAddr: '127.0.0.1',
      port,
      receiveDir,
      notifyAccepted: () => undefined,
      callbacks: {
        onUpdate: () => undefined,
        onLog: () => undefined,
        onError: (error) => errors.push(error)
      },
      identity: () => ({ user: 'peer', host: 'peer-host', seq: 1 })
    })
    managers.push(manager)
    await manager.start()

    const task = manager.addOutgoing({
      peerKey: '127.0.0.1|peer',
      peerIp: '127.0.0.1',
      peerPort: port,
      name: 'fallback.bin',
      size: content.length,
      mtime: 1700000000,
      fileId: 0xabc,
      packetId: 0x111,
      path: source
    })

    const target = join(receiveDir, 'fallback.bin')
    const written = await pullFile({
      peerIp: '127.0.0.1',
      peerPort: port,
      packetId: 0x999,
      fileId: 0x777,
      seq: 1,
      user: 'peer',
      host: 'peer-host',
      path: target,
      size: content.length
    })

    expect(written).toBe(content.length)
    expect(readFileSync(target).equals(content)).toBe(true)
    expect(manager.get(task.id)?.state).toBe('done')
    expect(errors).toEqual([])
  }, 20000)

  it('cancels a pending incoming task without creating a file', async () => {
    const dir = tempDir()
    const receiveDir = join(dir, 'receive')
    const port = await freeTcpPort()
    const manager = new FileManager({
      bindAddr: '127.0.0.1',
      port,
      receiveDir,
      notifyAccepted: () => undefined,
      callbacks: {
        onUpdate: () => undefined,
        onLog: () => undefined,
        onError: () => undefined
      }
    })
    managers.push(manager)
    await manager.start()
    const [incoming] = manager.offerIncoming({
      peerKey: '127.0.0.1|peer',
      peerIp: '127.0.0.1',
      peerPort: port,
      packetId: 7,
      attachments: [{ id: 8, name: '未接收.txt', size: 100, mtime: 0, attr: 1 }]
    })
    manager.cancel(incoming.id)
    expect(manager.get(incoming.id)?.state).toBe('canceled')
    expect(existsSync(join(receiveDir, '未接收.txt'))).toBe(false)
  }, 20000)
})
