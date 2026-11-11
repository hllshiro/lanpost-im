import { describe, expect, it } from 'vitest'
import { FrameError, decodeFrame, encodeFrame } from './frame'

const HEARTBEAT = '00000022000003f8d529c5439de045c9d3dc11866769e1fedfa896e8e704a5532f3e'

describe('frame', () => {
  it('decodes a captured heartbeat frame', () => {
    const frame = decodeFrame(Buffer.from(HEARTBEAT, 'hex'))
    expect(frame.cmd).toBe(1016)
    expect(frame.xml).toBe('<X_HEARTBEAT docver="1" />')
  })

  it('re-encodes to the captured bytes', () => {
    expect(encodeFrame(1016, '<X_HEARTBEAT docver="1" />').toString('hex')).toBe(HEARTBEAT)
  })

  it('rejects a length field that does not match the datagram', () => {
    const raw = Buffer.from(HEARTBEAT, 'hex')
    expect(() => decodeFrame(raw.subarray(0, raw.length - 1))).toThrow(FrameError)
  })

  it('rejects a datagram shorter than the header', () => {
    expect(() => decodeFrame(Buffer.from('00000001', 'hex'))).toThrow(FrameError)
  })
})
