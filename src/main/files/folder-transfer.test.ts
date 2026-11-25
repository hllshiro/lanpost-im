import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { connect, createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PrivateFolderTransfer, type IncomingFolder, type OutgoingFolder } from './folder-transfer'
import { scanFolder } from './folder-info'
import { buildData, buildManifest, buildStart, FolderFrameReader } from './folder-wire'

const dirs: string[] = []
const transfers: PrivateFolderTransfer[] = []

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

async function freeTcpPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  const port = address !== null && typeof address === 'object' ? address.port : 0
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

interface Recorded {
  events: string[]
}

function makeReceiver(
  port: number,
  recorded: Recorded,
  hook?: (taskId: string, received: number) => void
): PrivateFolderTransfer {
  const transfer = new PrivateFolderTransfer({
    bindAddr: '127.0.0.1',
    port,
    callbacks: {
      onProgress: (taskId, received) => {
        recorded.events.push(`progress:${taskId}:${received}`)
        hook?.(taskId, received)
      },
      onDone: (taskId, dir) => recorded.events.push(`done:${taskId}:${dir}`),
      onError: (taskId, error) => recorded.events.push(`error:${taskId}:${error.message}`)
    },
    onLog: (message) => recorded.events.push(`log:${message}`)
  })
  transfers.push(transfer)
  return transfer
}

function makeSender(recorded: Recorded): PrivateFolderTransfer {
  const transfer = new PrivateFolderTransfer({
    bindAddr: '127.0.0.1',
    port: 0,
    callbacks: {
      onProgress: (taskId, received) => recorded.events.push(`progress:${taskId}:${received}`),
      onDone: () => {},
      onError: (taskId, error) => recorded.events.push(`sender-error:${taskId}:${error.message}`)
    },
    onLog: (message) => recorded.events.push(`log:${message}`)
  })
  transfers.push(transfer)
  return transfer
}

function outgoing(root: string, taskId: string): OutgoingFolder {
  const info = scanFolder(root)
  return { taskId, name: root, root, size: info.totalSize, items: info.items }
}

async function waitUntil(step: string, probe: () => boolean): Promise<void> {
  for (let index = 0; index < 500; index += 1) {
    if (probe()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`等待超时: ${step}`)
}

async function waitEvent(recorded: Recorded, prefix: string): Promise<void> {
  await waitUntil(prefix, () =>
    recorded.events.some((event) => event === prefix || event.startsWith(prefix))
  )
}

async function waitEventPrefix(recorded: Recorded, prefix: string): Promise<string> {
  await waitUntil(prefix, () => recorded.events.some((event) => event.startsWith(prefix)))
  return recorded.events.find((event) => event.startsWith(prefix)) ?? ''
}

afterEach(async () => {
  for (const transfer of transfers.splice(0)) transfer.stop()
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
  }
})

describe('folder transfer', () => {
  it('receives files before and after an empty file', async () => {
    const source = tempDir('folder-src-')
    writeFileSync(join(source, 'a.txt'), 'aaaaa')
    writeFileSync(join(source, 'b-empty.txt'), '')
    writeFileSync(join(source, 'c.txt'), 'ccccc')
    const saveDir = tempDir('folder-dst-')
    const port = await freeTcpPort()
    const recorded: Recorded = { events: [] }
    const receiver = makeReceiver(port, recorded)
    await receiver.start()
    receiver.registerIncoming({ taskId: 'task-1', name: 'f', saveDir, size: 10 })

    const sender = makeSender(recorded)
    await expect(
      sender.send('127.0.0.1', outgoing(source, 'task-1'), port)
    ).resolves.toBeUndefined()
    await waitEvent(recorded, 'done:task-1')

    expect(readFileSync(join(saveDir, 'a.txt'), 'utf8')).toBe('aaaaa')
    expect(statSync(join(saveDir, 'b-empty.txt')).size).toBe(0)
    expect(readFileSync(join(saveDir, 'c.txt'), 'utf8')).toBe('ccccc')
    expect(recorded.events.some((event) => event.startsWith('error:'))).toBe(false)
  })

  it('reports an incomplete folder instead of completing it', async () => {
    const saveDir = tempDir('folder-dst-')
    const port = await freeTcpPort()
    const recorded: Recorded = { events: [] }
    const receiver = makeReceiver(port, recorded)
    await receiver.start()
    receiver.registerIncoming({ taskId: 'task-2', name: 'f', saveDir, size: 10 })

    const socket: Socket = connect({ host: '127.0.0.1', port })
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve())
      socket.once('error', reject)
    })
    const reader = new FolderFrameReader()
    const frames: Array<ReturnType<FolderFrameReader['push']>[number]> = []
    socket.on('data', (chunk: Buffer) => {
      for (const frame of reader.push(chunk)) frames.push(frame)
    })
    socket.write(buildStart('task-2', 2, 10))
    await waitUntil('接受帧', () => frames.length >= 1)
    socket.write(
      buildManifest([
        { name: 'one.txt', dir: false, index: 0, size: 5, time: 0 },
        { name: 'two.txt', dir: false, index: 1, size: 5, time: 0 }
      ])
    )
    await waitUntil('进度帧', () => frames.length >= 2)
    socket.write(buildData(0, 2, Buffer.from([0])))
    socket.write(buildData(0, 0, Buffer.from('one!!')))
    await waitUntil('项回执', () => frames.length >= 3)
    socket.destroy()

    const error = await waitEventPrefix(recorded, 'error:task-2')
    expect(error).toContain('不完整')
    expect(recorded.events.some((event) => event.startsWith('done:'))).toBe(false)
    expect(statSync(join(saveDir, 'one.txt')).size).toBe(5)
  })

  it('removes the half-written file when receiving is stopped', async () => {
    const source = tempDir('folder-src-')
    const content = Buffer.alloc(4 * 1024 * 1024, 7)
    writeFileSync(join(source, 'big.bin'), content)
    const saveDir = tempDir('folder-dst-')
    const port = await freeTcpPort()
    const recorded: Recorded = { events: [] }
    const holder: { current: PrivateFolderTransfer | null } = { current: null }
    const receiver = makeReceiver(port, recorded, (taskId) => {
      if (taskId === 'task-3') holder.current?.cancel('task-3')
    })
    holder.current = receiver
    await receiver.start()
    const incoming: IncomingFolder = {
      taskId: 'task-3',
      name: 'f',
      saveDir,
      size: content.length
    }
    receiver.registerIncoming(incoming)
    const sender = makeSender(recorded)
    const sending = sender.send('127.0.0.1', outgoing(source, 'task-3'), port)

    await expect(sending).rejects.toThrow()
    await waitUntil('半成品被清理', () => !existsSync(join(saveDir, 'big.bin')))
    expect(recorded.events.some((event) => event === 'done:task-3')).toBe(false)
    expect(recorded.events.some((event) => event.startsWith('error:task-3'))).toBe(false)
  })
})
