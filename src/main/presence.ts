export type PresenceStatus = 0 | 1 | 2

export interface AutoPresence {
  status: 1 | 2
  restore: PresenceStatus
}

export interface PresenceDecision {
  status: PresenceStatus
  auto: AutoPresence | null
}

/** 10 分钟无操作进入忙碌，30 分钟无操作进入离开。 */
export const IDLE_BUSY_SECONDS = 10 * 60
export const IDLE_AWAY_SECONDS = 30 * 60

export function isPresenceStatus(value: number): value is PresenceStatus {
  return value === 0 || value === 1 || value === 2
}

export function idleTarget(idleSeconds: number): PresenceStatus {
  if (!Number.isFinite(idleSeconds) || idleSeconds <= 0) return 0
  if (idleSeconds >= IDLE_AWAY_SECONDS) return 2
  if (idleSeconds >= IDLE_BUSY_SECONDS) return 1
  return 0
}

/**
 * Decides whether the idle state should change the current presence.
 * Only a manually-online user is auto-promoted; manual busy/away is never
 * overridden. When the user becomes active again the status captured before
 * the automatic switch is restored.
 */
export function resolveIdlePresence(
  idleSeconds: number,
  current: PresenceStatus,
  auto: AutoPresence | null
): PresenceDecision {
  const target = idleTarget(idleSeconds)
  if (auto !== null) {
    if (target === auto.status) return { status: current, auto }
    if (target === 0) return { status: auto.restore, auto: null }
    return { status: target, auto: { status: target, restore: auto.restore } }
  }
  if (current === 0 && (target === 1 || target === 2)) {
    return { status: target, auto: { status: target, restore: current } }
  }
  return { status: current, auto: null }
}
