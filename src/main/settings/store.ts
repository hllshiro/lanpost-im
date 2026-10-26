import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync
} from 'node:fs'
import { dirname } from 'node:path'
import {
  SETTINGS_VERSION,
  settingsSchema,
  type Settings,
  type SettingsPatch
} from '../../shared/settings'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

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

export class SettingsStore {
  private settings: Settings
  private readonly defaults: Settings

  constructor(
    private readonly file: string,
    identityDefaults: Partial<Settings['identity']> = {}
  ) {
    mkdirSync(dirname(file), { recursive: true })
    this.defaults = settingsSchema.parse({ identity: identityDefaults })
    this.settings = this.load()
  }

  get(): Settings {
    return structuredClone(this.settings)
  }

  defaultSettings(): Settings {
    return structuredClone(this.defaults)
  }

  update(patch: SettingsPatch): Settings {
    const next = settingsSchema.parse(mergeValue(this.settings, patch))
    next.version = SETTINGS_VERSION
    this.write(next)
    this.settings = next
    return structuredClone(next)
  }

  private load(): Settings {
    if (!existsSync(this.file)) {
      return structuredClone(this.defaults)
    }
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
      const version =
        typeof parsed === 'object' && parsed !== null
          ? (parsed as { version?: unknown }).version
          : undefined
      if (typeof version === 'number' && version > SETTINGS_VERSION) {
        this.backup()
        return structuredClone(this.defaults)
      }
      return settingsSchema.parse(parsed)
    } catch {
      this.backup()
      return structuredClone(this.defaults)
    }
  }

  private backup(): void {
    const backup = this.file + '.bak'
    rmSync(backup, { force: true })
    renameSync(this.file, backup)
  }

  private write(value: Settings): void {
    const temp = this.file + '.tmp'
    const fd = openSync(temp, 'w')
    try {
      writeSync(fd, JSON.stringify(value, null, 2) + '\n')
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(temp, this.file)
  }
}
