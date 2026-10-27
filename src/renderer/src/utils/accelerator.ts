export interface KeyStroke {
  code: string
  key: string
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  repeat: boolean
}

const SPECIAL_KEYS: Record<string, string> = {
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Return',
  NumpadEnter: 'Return',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown'
}

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta'])

function keyName(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  return SPECIAL_KEYS[code] ?? null
}

/**
 * Converts a keyboard event into an Electron accelerator, or null when the
 * combination is not supported. Plain letters/digits require a modifier so a
 * global shortcut cannot swallow normal typing.
 */
export function acceleratorFromKeyStroke(stroke: KeyStroke): string | null {
  if (stroke.repeat) return null
  if (MODIFIER_KEYS.has(stroke.key)) return null
  const key = keyName(stroke.code)
  if (key === null) return null
  const modifiers: string[] = []
  if (stroke.ctrl) modifiers.push('Ctrl')
  if (stroke.alt) modifiers.push('Alt')
  if (stroke.shift) modifiers.push('Shift')
  if (stroke.meta) modifiers.push('Meta')
  if (modifiers.length === 0 && !key.startsWith('F')) return null
  return [...modifiers, key].join('+')
}
