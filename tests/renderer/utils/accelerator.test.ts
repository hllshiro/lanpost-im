import { describe, expect, it } from 'vitest'
import {
  acceleratorFromKeyStroke,
  type KeyStroke
} from '../../../src/renderer/src/utils/accelerator'

function stroke(overrides: Partial<KeyStroke> = {}): KeyStroke {
  return {
    code: 'KeyW',
    key: 'w',
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    repeat: false,
    ...overrides
  }
}

describe('acceleratorFromKeyStroke', () => {
  it('builds modifiers in a stable order', () => {
    expect(
      acceleratorFromKeyStroke(stroke({ code: 'KeyW', ctrl: true, alt: true, shift: true }))
    ).toBe('Ctrl+Alt+Shift+W')
  })

  it('supports digits and function keys', () => {
    expect(acceleratorFromKeyStroke(stroke({ code: 'Digit1', key: '1', ctrl: true }))).toBe(
      'Ctrl+1'
    )
    expect(acceleratorFromKeyStroke(stroke({ code: 'F9', key: 'F9' }))).toBe('F9')
  })

  it('maps named keys to Electron accelerator names', () => {
    expect(acceleratorFromKeyStroke(stroke({ code: 'ArrowUp', key: 'ArrowUp', alt: true }))).toBe(
      'Alt+Up'
    )
    expect(acceleratorFromKeyStroke(stroke({ code: 'Space', key: ' ', ctrl: true }))).toBe(
      'Ctrl+Space'
    )
  })

  it('rejects plain typing, modifier-only and unsupported keys', () => {
    expect(acceleratorFromKeyStroke(stroke({ code: 'KeyA', key: 'a' }))).toBeNull()
    expect(
      acceleratorFromKeyStroke(stroke({ code: 'ControlLeft', key: 'Control', ctrl: true }))
    ).toBeNull()
    expect(acceleratorFromKeyStroke(stroke({ code: 'Comma', key: ',', ctrl: true }))).toBeNull()
    expect(acceleratorFromKeyStroke(stroke({ code: 'KeyW', ctrl: true, repeat: true }))).toBeNull()
  })

  it('keeps Meta for macOS style combinations', () => {
    expect(acceleratorFromKeyStroke(stroke({ code: 'KeyK', meta: true, shift: true }))).toBe(
      'Shift+Meta+K'
    )
  })
})
