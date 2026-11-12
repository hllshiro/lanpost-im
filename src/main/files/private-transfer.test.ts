import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PrivateFileTransfer } from './private-transfer'

const dirs: string[] = []
const transfers: PrivateFileTransfer[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lanpost-private-file-'))
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

function makeTransfer(
  port: number,
  events: string[],
  callbacks: { onProgress?(fileId: number, received: number): void } = {}
): PrivateFileTransfer {
  const transfer = new PrivateFileTransfer({
    bindAddr: '127.0.0.1',
    port,
    localUserId: '0123456789abcdef0123456789abcdef',
    localIp: '127.0.0.1',
    localName: '本机',
    callbacks: {
      onProgress: (fileId, received) => {
        events.push(`progress:${fileId}:${received}`)
        callbacks.onProgress?.(fileId, received)
      },
      onDone: (fileId, path) => events.push(`done:${fileId}:${path}`),
      onError: (fileId, error) => events.push(`error:${fileId}:${error.message}`)
    },
    onLog: (message) => events.push(`log:${message}`)
  })
  transfers.push(transfer)
  return transfer
}

async function waitForEvent(events: string[], prefix: string): Promise<void> {
  for (let index = 0; index < 300; index += 1) {
    if (events.some((event) => event === prefix || event.startsWith(prefix))) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`等待事件超时: ${prefix}`)
}

afterEach(async () => {
  await Promise.all(transfers.splice(0).map((transfer) => transfer.stop()))
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('private file transfer', () => {
  it('sends a file to a receiver that dials the sender', async () => {
    const dir = tempDir()
    const source = join(dir, 'source.bin')
    const target = join(dir, 'target.bin')
    const content = Buffer.alloc(90_000)
    for (let index = 0; index < content.length; index += 1) {
      content[index] = index % 251
    }
    writeFileSync(source, content)

    const senderPort = await freeTcpPort()
    const receiverPort = await freeTcpPort()
    const senderEvents: string[] = []
    const receiverEvents: string[] = []
    const sender = makeTransfer(senderPort, senderEvents)
    const receiver = makeTransfer(receiverPort, receiverEvents)
    await sender.start()
    await receiver.start()

    const fileId = 10932
    sender.registerOutgoing({ fileId, path: source, size: content.length })
    receiver.registerIncoming({
      fileId,
      name: 'target.bin',
      size: content.length,
      savePath: target,
      saveDir: dir
    })

    await receiver.receive('127.0.0.1', senderPort, fileId, 'fedcba9876543210fedcba9876543210')

    expect(readFileSync(target).equals(content)).toBe(true)
    expect(statSync(target).size).toBe(content.length)
    expect(senderEvents).toContain(`done:${fileId}:${source}`)
    expect(receiverEvents).toContain(`done:${fileId}:${target}`)
    const lastProgress = receiverEvents
      .filter((event) => event.startsWith(`progress:${fileId}:`))
      .pop()
    expect(lastProgress).toBe(`progress:${fileId}:${content.length}`)
  })

  it('sends a file when the sender dials the receiver reverse port', async () => {
    const dir = tempDir()
    const source = join(dir, 'source.bin')
    const target = join(dir, 'target.bin')
    const content = Buffer.alloc(70_000, 0x5a)
    writeFileSync(source, content)

    const senderPort = await freeTcpPort()
    const receiverPort = await freeTcpPort()
    const sender = makeTransfer(senderPort, [])
    const receiverEvents: string[] = []
    const receiver = makeTransfer(receiverPort, receiverEvents)
    await sender.start()
    await receiver.start()

    const fileId = 28314
    sender.registerOutgoing({ fileId, path: source, size: content.length })
    receiver.registerIncoming({
      fileId,
      name: 'target.bin',
      size: content.length,
      savePath: target,
      saveDir: dir
    })

    await sender.sendReverse('127.0.0.1', receiverPort, fileId)

    await waitForEvent(receiverEvents, `done:${fileId}:${target}`)
    expect(readFileSync(target).equals(content)).toBe(true)
    expect(receiverEvents).toContain(`done:${fileId}:${target}`)
  })

  it('rejects receiving a file that was never registered', async () => {
    const port = await freeTcpPort()
    const events: string[] = []
    const receiver = makeTransfer(port, events)
    await receiver.start()
    await expect(receiver.receive('127.0.0.1', port, 7, 'peer')).rejects.toThrow(/没有待接收的文件/)
  })
})
