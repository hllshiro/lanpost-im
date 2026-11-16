import type { Settings, SettingsPatch } from './settings'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// 只覆盖补丁里出现的字段，其余保持原值；undefined 表示不改这一项
function mergeValue(base: unknown, patch: unknown): unknown {
  if (!isRecord(base) || !isRecord(patch)) {
    return patch
  }
  const next: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue
    }
    next[key] = isRecord(value) && isRecord(next[key]) ? mergeValue(next[key], value) : value
  }
  return next
}

export function mergeSettings(base: Settings, patch: SettingsPatch): Settings {
  return mergeValue(base, patch) as Settings
}
