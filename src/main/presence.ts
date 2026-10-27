export type PresenceStatus = 0 | 1 | 2

export interface AutoPresence {
  restore: PresenceStatus
}

export interface PresenceDecision {
  status: PresenceStatus
  auto: AutoPresence | null
}

/** 30 分钟无操作自动进入离开；忙碌只由用户手动切换。 */
export const IDLE_AWAY_SECONDS = 30 * 60

export function isPresenceStatus(value: number): value is PresenceStatus {
  return value === 0 || value === 1 || value === 2
}

export function idleTarget(idleSeconds: number): PresenceStatus {
  if (!Number.isFinite(idleSeconds) || idleSeconds <= 0) return 0
  return idleSeconds >= IDLE_AWAY_SECONDS ? 2 : 0
}

/**
 * Decides whether the idle state should change the current presence.
 * Only a manually-online user is auto-promoted to away; manual busy/away is
 * never overridden. When the user becomes active again the status captured
 * before the automatic switch is restored.
 */
export function resolveIdlePresence(
  idleSeconds: number,
  current: PresenceStatus,
  auto: AutoPresence | null
): PresenceDecision {
  const target = idleTarget(idleSeconds)
  if (auto !== null) {
    if (target === 0) return { status: auto.restore, auto: null }
    return { status: current, auto }
  }
  if (target === 2 && current === 0) {
    return { status: 2, auto: { restore: current } }
  }
  return { status: current, auto: null }
}
