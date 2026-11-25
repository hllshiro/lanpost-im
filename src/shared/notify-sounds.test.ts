import { describe, expect, it } from 'vitest'
import { DEFAULT_NOTIFY_SOUND, NOTIFY_SOUND_IDS, NOTIFY_SOUND_OPTIONS } from './notify-sounds'

describe('notify sounds', () => {
  it('内置提示音 id 唯一，选项覆盖全部 id', () => {
    expect(new Set(NOTIFY_SOUND_IDS).size).toBe(NOTIFY_SOUND_IDS.length)
    expect(NOTIFY_SOUND_OPTIONS.map((item) => item.id).sort()).toEqual([...NOTIFY_SOUND_IDS].sort())
  })

  it('每项都有四个字的短名称，默认项存在且置顶', () => {
    for (const item of NOTIFY_SOUND_OPTIONS) {
      expect(item.name).toHaveLength(4)
    }
    expect(NOTIFY_SOUND_IDS).toContain(DEFAULT_NOTIFY_SOUND)
    expect(NOTIFY_SOUND_OPTIONS[0].id).toBe(DEFAULT_NOTIFY_SOUND)
  })
})
