import { describe, expect, it } from 'vitest'
import { mediaUrl, parseMediaRequest } from '../../../src/main/files/media'

describe('media url', () => {
  it('round-trips a task id', () => {
    const url = mediaUrl('in-1')
    expect(url).toBe('lanpost-media://file/in-1')
    expect(parseMediaRequest(url)).toBe('in-1')
  })

  it('rejects arbitrary paths and ids', () => {
    expect(parseMediaRequest('file:///etc/passwd')).toBeNull()
    expect(parseMediaRequest('lanpost-media://other/in-1')).toBeNull()
    expect(parseMediaRequest('lanpost-media://file/%2E%2E')).toBeNull()
    expect(parseMediaRequest('lanpost-media://file/a%2Fb')).toBeNull()
    expect(parseMediaRequest('lanpost-media://file/')).toBeNull()
  })
})
