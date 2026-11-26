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
  it('开关变化不算待重启（切换后立即启停）', () => {
    expect(gatewayPending(rpc(), rpc({ enabled: true }))).toBe(false)
    expect(gatewayPending(rpc({ enabled: true }), rpc())).toBe(false)
  })

  it('运行中修改地址或端口时才提示重启', () => {
    expect(gatewayPending(rpc({ enabled: true }), rpc({ enabled: true, port: 9016 }))).toBe(true)
    expect(
      gatewayPending(rpc({ enabled: true }), rpc({ enabled: true, bindAddr: '0.0.0.0' }))
    ).toBe(true)
  })

  it('关闭状态下改地址或端口不提示，下次开启时生效', () => {
    expect(gatewayPending(rpc(), rpc({ port: 9016 }))).toBe(false)
  })

  it('从未应用过配置时不提示', () => {
    expect(gatewayPending(null, rpc({ enabled: true }))).toBe(false)
  })

  it('配置一致或仅令牌变化不提示', () => {
    expect(gatewayPending(rpc({ enabled: true }), rpc({ enabled: true }))).toBe(false)
    expect(gatewayPending(rpc({ enabled: true }), rpc({ enabled: true, token: 'next' }))).toBe(
      false
    )
  })
})
