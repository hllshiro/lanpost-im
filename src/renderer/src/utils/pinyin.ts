import { pinyin } from 'pinyin-pro'

export interface PinyinInfo {
  full: string
  initials: string
  letter: string
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
  const full = clean(pinyin(text, { toneType: 'none' }))
  const initials = clean(pinyin(text, { pattern: 'first', toneType: 'none' }))
  const info = { full, initials, letter: letterOf(full) }
  cache.set(text, info)
  return info
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
