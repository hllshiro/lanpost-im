import online from '../assets/notify-sounds/online.wav'
import receive from '../assets/notify-sounds/receive.wav'
import type { NotifySoundId } from '../../../shared/notify-sounds'

export const NOTIFY_SOUNDS: Record<NotifySoundId, string> = {
  online,
  receive
}

// 按设置里的音效播一遍；音量固定 100%，由系统音量控制
export function playNotifySound(preset: NotifySoundId): void {
  const audio = new Audio(NOTIFY_SOUNDS[preset])
  audio.volume = 1
  void audio.play().catch(() => undefined)
}
