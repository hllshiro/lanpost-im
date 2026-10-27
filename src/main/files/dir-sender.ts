import { open, readdir, stat, type FileHandle } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { Socket } from 'node:net'
import { encodeDirHeader } from '../protocol/dir-stream'
import {
  EXT_MTIME,
  FILE_ATTR_DIR,
  FILE_ATTR_REGULAR,
  FILE_ATTR_RETPARENT,
  FILE_OPT_RONLY
} from '../protocol/commands'

const CHUNK_SIZE = 64 * 1024

function writeAll(socket: Socket, chunk: Buffer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (socket.destroyed) {
      reject(new Error('对端连接已经关闭'))
      return
    }
    socket.write(chunk, (error) => {
      if (error !== null && error !== undefined) reject(error)
      else resolve()
    })
  })
}

async function sendFile(
  socket: Socket,
  path: string,
  name: string,
  utf8: boolean,
  sent: (n: number) => void,
  isCanceled?: () => boolean
): Promise<void> {
  const info = await stat(path)
  const attr = FILE_ATTR_REGULAR | (info.mode & 0o200 ? 0 : FILE_OPT_RONLY)
  const ext = new Map<number, string>([[EXT_MTIME, Math.floor(info.mtimeMs / 1000).toString(16)]])
  await writeAll(socket, encodeDirHeader({ name, size: info.size, attr, ext }, utf8))
  const handle: FileHandle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(CHUNK_SIZE)
    for (;;) {
      if (isCanceled?.() === true) throw new Error('发送已取消')
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      await writeAll(socket, buffer.subarray(0, bytesRead))
      sent(bytesRead)
    }
  } finally {
    await handle.close()
  }
}

async function sendDir(
  socket: Socket,
  path: string,
  name: string,
  root: boolean,
  utf8: boolean,
  sent: (n: number) => void,
  isCanceled?: () => boolean
): Promise<void> {
  const info = await stat(path)
  const attr = FILE_ATTR_DIR | (info.mode & 0o200 ? 0 : FILE_OPT_RONLY)
  const ext = new Map<number, string>([[EXT_MTIME, Math.floor(info.mtimeMs / 1000).toString(16)]])
  await writeAll(socket, encodeDirHeader({ name, size: 0, attr, ext }, utf8))

  const entries = await readdir(path, { withFileTypes: true })
  entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const target = join(path, entry.name)
    if (entry.isDirectory()) {
      await sendDir(socket, target, entry.name, false, utf8, sent, isCanceled)
    } else if (entry.isFile()) {
      await sendFile(socket, target, entry.name, utf8, sent, isCanceled)
    }
  }

  await writeAll(
    socket,
    encodeDirHeader(
      {
        name: '.',
        size: 0,
        attr: FILE_ATTR_RETPARENT,
        ext
      },
      utf8
    )
  )
  if (root) return
}

// 目录流从附件目录自身的 DIR 头开始，最后以根目录的 RETPARENT 结束。
export async function sendDirectory(
  socket: Socket,
  rootPath: string,
  utf8: boolean,
  onProgress?: (sent: number) => void,
  isCanceled?: () => boolean
): Promise<number> {
  let sent = 0
  await sendDir(
    socket,
    rootPath,
    basename(rootPath),
    true,
    utf8,
    (count) => {
      if (isCanceled?.() === true) throw new Error('发送已取消')
      sent += count
      onProgress?.(sent)
    },
    isCanceled
  )
  return sent
}
