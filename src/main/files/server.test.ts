import { createServer, connect } from 'node:net'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { encodePacket } from '../protocol/packet'
import { FileServer, parseGetFileRequest } from './server'

const dirs: string[] = []
let server: FileServer | null = null

afterEach(async () => {
  await server?.stop()
  server = null
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

async function freeTcpPort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => resolve())
  })
  const address = probe.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return port
}

describe('file server', () => {
  it('parses packetId, fileId and offset separately', () => {
    expect(parseGetFileRequest(Buffer.from('2a:1f:10:'))).toEqual({
      packetId: 0x2a,
      fileIds: [0x1f],
      offset: 0x10
    })
    expect(parseGetFileRequest(Buffer.from('2a:1f'))).toEqual({
      packetId: 0x2a,
      fileIds: [0x1f],
      offset: 0
    })
  })

  it('streams from the requested offset', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lanpost-offset-'))
    dirs.push(dir)
    const file = join(dir, 'data.txt')
    writeFileSync(file, 'abcdef')
    const port = await freeTcpPort()
    server = new FileServer({
      bindAddr: '127.0.0.1',
      port,
      resolve: (request) => ({ path: file, kind: 'file', offset: request.offset }),
      onLog: () => undefined,
      onError: (error) => {
        throw error
      }
    })
    await server.start()
    const received = await new Promise<Buffer>((resolve, reject) => {
      const socket = connect({ host: '127.0.0.1', port })
      const chunks: Buffer[] = []
      socket.on('connect', () => {
        socket.write(
          encodePacket({
            seq: 1,
            user: 'u',
            host: 'h',
            cmd: 0x60,
            payload: Buffer.from('2a:1f:2:')
          })
        )
      })
      socket.on('data', (chunk) => chunks.push(chunk))
      socket.on('end', () => resolve(Buffer.concat(chunks)))
      socket.on('error', reject)
    })
    expect(received.toString()).toBe('cdef')
  })
})
