import { decryptBody, encryptBody } from './tea'

const HEADER_SIZE = 8

export class FrameError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FrameError'
  }
}

export function encodeFrame(cmd: number, xml: string): Buffer {
  const body = encryptBody(Buffer.from(xml, 'utf8'))
  const frame = Buffer.alloc(HEADER_SIZE + body.length)
  frame.writeUInt32BE(frame.length, 0)
  frame.writeUInt32BE(cmd, 4)
  body.copy(frame, HEADER_SIZE)
  return frame
}

export function decodeFrame(data: Buffer): { cmd: number; xml: string } {
  if (data.length < HEADER_SIZE) {
    throw new FrameError(`应用帧长度 ${data.length} 小于帧头长度 ${HEADER_SIZE}`)
  }
  const total = data.readUInt32BE(0)
  if (total < HEADER_SIZE) {
    throw new FrameError(`应用帧总长 ${total} 小于帧头长度 ${HEADER_SIZE}`)
  }
  if (total !== data.length) {
    throw new FrameError(`应用帧总长 ${total} 与数据报长度 ${data.length} 不一致`)
  }
  const cmd = data.readUInt32BE(4)
  const xml = decryptBody(data.subarray(HEADER_SIZE)).toString('utf8')
  return { cmd, xml }
}
