export const NOTIFY_SOUND_IDS = ['online', 'receive'] as const

export type NotifySoundId = (typeof NOTIFY_SOUND_IDS)[number]

export const DEFAULT_NOTIFY_SOUND: NotifySoundId = 'online'

export interface NotifySoundOption {
  id: NotifySoundId
  name: string
}

export const NOTIFY_SOUND_OPTIONS: readonly NotifySoundOption[] = [
  { id: 'online', name: '经典叮咚' },
  { id: 'receive', name: '清脆单音' }
]
