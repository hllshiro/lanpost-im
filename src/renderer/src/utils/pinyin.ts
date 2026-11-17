import { pinyin } from 'pinyin-pro'

export interface PinyinInfo {
  full: string
  initials: string
  wordInitials: string
  letter: string
  syllables: string[]
}

const CLEAN = /[^a-z0-9]+/g
const cache = new Map<string, PinyinInfo>()

function clean(value: string): string {
  return value.toLowerCase().replace(CLEAN, '')
}

function letterOf(full: string): string {
  const first = full.charAt(0)
  return /^[a-z]$/.test(first) ? first.toUpperCase() : '#'
}

export function pinyinInfo(text: string): PinyinInfo {
  const cached = cache.get(text)
  if (cached !== undefined) {
    return cached
  }
  const raw = pinyin(text, { toneType: 'none' }).toLowerCase()
  const full = clean(raw)
  const initials = clean(pinyin(text, { pattern: 'first', toneType: 'none' }))
  const syllables = raw
    .split(/\s+/)
    .map(clean)
    .filter((value) => value !== '')
  // 按空格/符号分词后的首字母，例如「Alice 王」→ aw
  const words = text.split(/[^\p{L}\p{N}]+/u).filter((value) => value !== '')
  const wordInitials =
    words.length > 1
      ? words.map((word) => pinyinInfo(word).initials.charAt(0)).join('')
      : initials.charAt(0)
  const info = { full, initials, wordInitials, letter: letterOf(full), syllables }
  cache.set(text, info)
  return info
}

// 支持中文、全拼、首字母和空格分隔的拼音，例如「张」「zhang」「zs」「zhang s」
export function matchesPinyin(text: string, keyword: string): boolean {
  const query = keyword.trim().toLowerCase()
  if (query === '') return true
  if (text.toLowerCase().includes(query)) return true
  const info = pinyinInfo(text)
  const compact = query.replace(/\s+/g, '')
  if (
    compact !== '' &&
    (info.full.includes(compact) ||
      info.initials.includes(compact) ||
      info.wordInitials.includes(compact))
  ) {
    return true
  }
  const tokens = query.split(/\s+/).filter((token) => token !== '')
  if (tokens.length > 1) {
    return tokens.every(
      (token) =>
        info.full.includes(token) ||
        info.initials.includes(token) ||
        info.syllables.some((syllable) => syllable.startsWith(token))
    )
  }
  return false
}

export function comparePinyin(left: string, right: string): number {
  const a = pinyinInfo(left)
  const b = pinyinInfo(right)
  if (a.letter !== b.letter) {
    if (a.letter === '#') return 1
    if (b.letter === '#') return -1
    return a.letter < b.letter ? -1 : 1
  }
  return a.full.localeCompare(b.full) || left.localeCompare(right, 'zh-CN')
}

export function compareLetters(left: string, right: string): number {
  if (left === right) return 0
  if (left === '#') return 1
  if (right === '#') return -1
  return left.localeCompare(right)
}
