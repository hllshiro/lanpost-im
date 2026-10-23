import { existsSync } from 'node:fs'
import { join } from 'node:path'

// 收到或发送的文件名可能包含相对路径、控制字符，或者 Windows 不允许的冒号。
// 只保留最后一段文件名，保存路径必然落在接收目录内。
const SEPARATORS = /[\\/]+/

function stripControlChars(name: string): string {
  let out = ''
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0
    if (code >= 0x20 && code !== 0x7f) {
      out += char
    }
  }
  return out
}

export function sanitizeFileName(name: string): string {
  const cleaned = stripControlChars(name)
  const segments = cleaned
    .split(SEPARATORS)
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..')
  const base = segments.length > 0 ? segments[segments.length - 1] : ''
  const safe = base.trim().replaceAll(':', '_')
  if (safe === '' || safe === '.' || safe === '..') {
    return ''
  }
  return safe
}

function splitExtension(name: string): { stem: string; extension: string } {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) {
    return { stem: name, extension: '' }
  }
  return { stem: name.slice(0, dot), extension: name.slice(dot) }
}

// 同名文件保存为 “名称 (1).扩展名”，调用方可以传入额外保留判定，
// 让尚未落盘的任务名也参与去重。
export function uniqueName(
  receiveDir: string,
  name: string,
  reserved?: (candidate: string) => boolean
): string {
  const safe = sanitizeFileName(name) === '' ? 'file' : sanitizeFileName(name)
  const isUsed = (candidate: string): boolean => {
    if (existsSync(join(receiveDir, candidate))) {
      return true
    }
    return reserved !== undefined && reserved(candidate)
  }
  if (!isUsed(safe)) {
    return safe
  }
  const { stem, extension } = splitExtension(safe)
  for (let index = 1; index < 10000; index++) {
    const candidate = `${stem} (${index})${extension}`
    if (!isUsed(candidate)) {
      return candidate
    }
  }
  throw new Error(`无法为 ${safe} 生成唯一文件名`)
}
