import { describe, expect, it } from 'vitest'
import type { RpcSettings } from '../../shared/settings'
import { decideGatewayRestart, gatewayPending } from './lifecycle'

function rpc(overrides: Partial<RpcSettings> = {}): RpcSettings {
  return {
    enabled: false,
    bindAddr: '127.0.0.1',
    port: 9015,
    token: '',
    ...overrides
  }
}

describe('decideGatewayRestart', () => {
  it('首次开启时启动', () => {
    expect(decideGatewayRestart(null, rpc({ enabled: true }))).toBe('start')
  })

  it('首次仍是关闭状态时不做任何事', () => {
    expect(decideGatewayRestart(null, rpc())).toBe('noop')
  })

  it('关闭后重新开启时启动', () => {
    expect(decideGatewayRestart(rpc(), rpc({ enabled: true }))).toBe('start')
  })

  it('开启后关闭时停止', () => {
    expect(decideGatewayRestart(rpc({ enabled: true }), rpc())).toBe('stop')
  })

  it('端口变化时重启', () => {
    expect(decideGatewayRestart(rpc({ enabled: true }), rpc({ enabled: true, port: 9443 }))).toBe(
      'restart'
    )
  })

  it('监听地址变化时重启', () => {
    expect(
      decideGatewayRestart(rpc({ enabled: true }), rpc({ enabled: true, bindAddr: '0.0.0.0' }))
    ).toBe('restart')
  })

  it('仅令牌变化时只换令牌，不重启', () => {
    expect(decideGatewayRestart(rpc({ enabled: true }), rpc({ enabled: true, token: 'x' }))).toBe(
      'noop'
    )
  })

  it('设置没变时不做任何事', () => {
    expect(decideGatewayRestart(rpc({ enabled: true }), rpc({ enabled: true }))).toBe('noop')
  })
})

describe('gatewayPending', () => {
  it('从未应用过配置时只有启用才提示重载', () => {
    expect(gatewayPending(null, rpc(), false)).toBe(false)
    expect(gatewayPending(null, rpc({ enabled: true }), false)).toBe(true)
  })

  it('开关变化时提示重载', () => {
    expect(gatewayPending(rpc(), rpc({ enabled: true }), false)).toBe(true)
    expect(gatewayPending(rpc({ enabled: true }), rpc(), true)).toBe(true)
  })

  it('地址或端口变化时提示重载', () => {
    expect(gatewayPending(rpc({ enabled: true }), rpc({ enabled: true, port: 9016 }), true)).toBe(
      true
    )
    expect(
      gatewayPending(rpc({ enabled: true }), rpc({ enabled: true, bindAddr: '0.0.0.0' }), true)
    ).toBe(true)
  })

  it('配置一致且运行中时不提示，未运行则提示', () => {
    expect(gatewayPending(rpc({ enabled: true }), rpc({ enabled: true }), true)).toBe(false)
    expect(gatewayPending(rpc({ enabled: true }), rpc({ enabled: true }), false)).toBe(true)
  })

  it('令牌变化不算待重载', () => {
    expect(
      gatewayPending(rpc({ enabled: true }), rpc({ enabled: true, token: 'next' }), true)
    ).toBe(false)
  })
})
