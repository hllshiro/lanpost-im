import notifyA from '../assets/notify-a.wav'
import notifyB from '../assets/notify-b.wav'
import notifyC from '../assets/notify-c.wav'

export type SoundPreset = 'a' | 'b' | 'c'

export const NOTIFY_SOUNDS: Record<SoundPreset, string> = {
  a: notifyA,
  b: notifyB,
  c: notifyC
}

// 按设置里的样式与音量播一遍提示音；播放被浏览器策略拒绝时静默
export function playNotifySound(preset: SoundPreset, volume: number): void {
  const audio = new Audio(NOTIFY_SOUNDS[preset])
  audio.volume = Math.max(0, Math.min(100, volume)) / 100
  void audio.play().catch(() => undefined)
}
