import { describe, expect, it } from 'vitest'
import { linuxManualCommand, linuxRepairScript, normalizePorts, ruleNameOf } from './firewall'

describe('normalizePorts', () => {
  it('deduplicates, sorts and drops invalid ports', () => {
    expect(normalizePorts([9013, 9011, 9013, 0, -1, 65536, 9012])).toEqual([9011, 9012, 9013])
  })
})

describe('ruleNameOf', () => {
  it('uses the dev rule name for electron.exe', () => {
    expect(ruleNameOf('C:\\repo\\node_modules\\electron\\electron.exe')).toBe('lanpost-im-dev')
  })

  it('uses the product rule name for packaged executables', () => {
    expect(ruleNameOf('C:\\Program Files\\lanpost-im\\lanpost-im.exe')).toBe('lanpost-im')
  })
})

describe('linuxRepairScript', () => {
  const ports = { udp: [9011, 9012], tcp: [9013, 9014] }

  it('adds and records every port for ufw', () => {
    const script = linuxRepairScript('ufw', ports)
    for (const line of ['9011/udp', '9012/udp', '9013/tcp', '9014/tcp']) {
      expect(script).toContain(`ufw allow ${line}`)
    }
    expect(script).toContain('ufw udp 9011')
    expect(script).toContain('ufw tcp 9014')
  })

  it('adds and records every port for firewalld and reloads once', () => {
    const script = linuxRepairScript('firewalld', ports)
    for (const line of ['9011/udp', '9012/udp', '9013/tcp', '9014/tcp']) {
      expect(script).toContain(`--add-port=${line}`)
    }
    expect(script).toContain('firewalld udp 9011')
    expect(script.match(/firewall-cmd --reload/g)).toHaveLength(1)
  })

  it('prints a manual command containing every port', () => {
    expect(linuxManualCommand('ufw', ports)).toContain('sudo ufw allow 9014/tcp')
    expect(linuxManualCommand('firewalld', ports)).toContain(
      'sudo firewall-cmd --permanent --add-port=9011/udp'
    )
  })
})
