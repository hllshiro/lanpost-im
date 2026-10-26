const SCHEME = 'lanpost-media://file/'

export function mediaUrl(taskId: string): string {
  return `${SCHEME}${encodeURIComponent(taskId)}`
}

// 只接受 lanpost-media://file/<taskId>，其他路径一律拒绝。
export function parseMediaRequest(url: string): string | null {
  const prefix = 'lanpost-media://'
  if (!url.startsWith(prefix)) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'lanpost-media:' || parsed.hostname !== 'file') return null
  const id = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  if (id === '' || id.includes('/') || id.includes('\\') || id.includes('..')) return null
  return id
}
