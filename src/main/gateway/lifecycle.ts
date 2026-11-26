import type { RpcSettings } from '../../shared/settings'

export type GatewayRestartAction = 'noop' | 'start' | 'stop' | 'restart'

/**
 * 设置变更后网关需要做什么。
 * 令牌变化不算重启：连接已经建立，换令牌只需断开旧连接并替换内存里的期望值。
 */
export function decideGatewayRestart(
  prev: RpcSettings | null,
  next: RpcSettings
): GatewayRestartAction {
  if (prev === null) return next.enabled ? 'start' : 'noop'
  if (prev.enabled !== next.enabled) return next.enabled ? 'start' : 'stop'
  if (!next.enabled) return 'noop'
  if (prev.bindAddr !== next.bindAddr || prev.port !== next.port) return 'restart'
  return 'noop'
}
