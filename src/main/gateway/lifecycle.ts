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

/**
 * 当前设置是否还没有应用到网关：开关、地址或端口与上次应用的不一致，或应当运行却没跑起来。
 * 设置变更后界面据此提示用户手动重载，而不是自动重启。
 */
export function gatewayPending(
  prev: RpcSettings | null,
  next: RpcSettings,
  running: boolean
): boolean {
  if (prev === null) return next.enabled
  if (next.enabled !== prev.enabled) return true
  if (!next.enabled) return false
  if (next.bindAddr !== prev.bindAddr || next.port !== prev.port) return true
  return !running
}
