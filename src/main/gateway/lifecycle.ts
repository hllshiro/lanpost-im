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
 * 当前设置是否还需要重启网关：只有监听地址或端口与已应用的不一致时才需要。
 * 开关切换会立即启停，不算待处理；关闭状态下改地址或端口也不用提示，下次开启时生效。
 */
export function gatewayPending(prev: RpcSettings | null, next: RpcSettings): boolean {
  if (prev === null || !prev.enabled || !next.enabled) return false
  return prev.bindAddr !== next.bindAddr || prev.port !== next.port
}
