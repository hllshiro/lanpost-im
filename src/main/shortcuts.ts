import { globalShortcut } from 'electron'
import { DEFAULT_SHORTCUTS, type Settings } from '../shared/settings'
import { logStartup } from './startup-log'

export type ShortcutAction = keyof typeof DEFAULT_SHORTCUTS

export interface ShortcutRegistration {
  action: ShortcutAction
  accelerator: string
  registered: boolean
}

type ShortcutHandlers = Record<ShortcutAction, () => void>

let currentSettings: Settings['shortcuts'] | null = null
let currentHandlers: ShortcutHandlers | null = null
let suspended = false

function actions(): ShortcutAction[] {
  return Object.keys(DEFAULT_SHORTCUTS) as ShortcutAction[]
}

function registerAll(): ShortcutRegistration[] {
  const results: ShortcutRegistration[] = []
  if (currentSettings === null || currentHandlers === null || suspended) return results
  for (const action of actions()) {
    const accelerator = currentSettings[action].trim()
    if (accelerator === '') continue
    let registered = false
    try {
      registered = globalShortcut.register(accelerator, currentHandlers[action])
    } catch (error) {
      logStartup(
        `shortcut ${action} (${accelerator}) register failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
    if (!registered) {
      logStartup(`shortcut ${action} (${accelerator}) is unavailable`)
    } else {
      logStartup(`shortcut ${action} (${accelerator}) registered`)
    }
    results.push({ action, accelerator, registered })
  }
  return results
}

/** Re-registers every global shortcut from the given settings. */
export function applyGlobalShortcuts(
  settings: Settings,
  handlers: ShortcutHandlers
): ShortcutRegistration[] {
  currentSettings = settings.shortcuts
  currentHandlers = handlers
  globalShortcut.unregisterAll()
  return registerAll()
}

/**
 * While the settings recorder is active the shortcuts must be released,
 * otherwise pressing the current combination would trigger its action
 * instead of being delivered to the renderer.
 */
export function setShortcutRecording(active: boolean): void {
  suspended = active
  if (active) {
    globalShortcut.unregisterAll()
    return
  }
  globalShortcut.unregisterAll()
  registerAll()
}

/** Returns whether the accelerator can be registered right now. */
export function shortcutAvailable(accelerator: string): boolean {
  const value = accelerator.trim()
  if (value === '') return false
  try {
    const registered = globalShortcut.register(value, () => {})
    if (registered) globalShortcut.unregister(value)
    return registered
  } catch {
    return false
  }
}

export function unregisterGlobalShortcuts(): void {
  currentSettings = null
  currentHandlers = null
  suspended = false
  globalShortcut.unregisterAll()
}
