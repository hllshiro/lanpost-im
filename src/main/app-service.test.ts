import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from './store/db'
import { createRepositories } from './store/repositories'
import { SettingsStore } from './settings/store'
import type { AppEvent } from '../shared/domain'
import type { ProtocolPeer } from './protocol/engine'
import { IDLE_AWAY_SECONDS } from './presence'

const electronMocks = vi.hoisted(() => ({
  showOpenDialog: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  dialog: { showOpenDialog: electronMocks.showOpenDialog },
  shell: {},
  BrowserWindow: class {}
}))

vi.mock('./notify/manager', () => ({
  NotificationManager: class {
    setActiveConversation(): void {
      void 0
    }
    setUnread(): void {
      void 0
    }
    notify(): void {
      void 0
    }
    stop(): void {
      void 0
    }
  }
}))

const { AppService } = await import('./app-service')

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

function setup(): {
  service: InstanceType<typeof AppService>
  events: AppEvent[]
  repos: ReturnType<typeof createRepositories>
  settings: SettingsStore
} {
  const dir = mkdtempSync(join(tmpdir(), 'lanpost-app-'))
  dirs.push(dir)
  const db = openDatabase(':memory:')
  const settings = new SettingsStore(join(dir, 'settings.json'), {
    displayName: 'Me',
    account: 'me',
    hostName: 'me-host'
  })
  settings.update({ files: { receiveDir: dir, autoAccept: false } })
  const service = new AppService(db, settings, {
    name: 'test',
    version: '0.1.0',
    platform: 'win32',
    appId: 'test'
  })
  const events: AppEvent[] = []
  service.attachWindow({
    webContents: { send: (_channel: string, event: AppEvent) => events.push(event) }
  } as never)
  ;(service as unknown as { filesStarted: boolean }).filesStarted = true
  return { service, events, repos: createRepositories(db), settings }
}

function peer(): ProtocolPeer {
  return {
    key: '127.0.0.1|peer',
    ip: '127.0.0.1',
    port: 2425,
    user: 'peer',
    host: 'peer-host',
    name: 'Peer',
    group: '',
    status: 0,
    identityId: 'test-identity',
    clientType: 'lanpost',
    online: true,
    capUtf8: true,
    capFile: true,
    capClipboard: true,
    dialup: false,
    versionInfo: '',
    absenceInfo: '',
    firstSeen: 1,
    lastSeen: 1
  }
}

describe('AppService file message linking', () => {
  it('links an incoming file task to the offer message before acceptance', () => {
    const { service, events, repos } = setup()
    ;(service as unknown as { handleFileOffer: (...args: unknown[]) => void }).handleFileOffer(
      peer(),
      55,
      '给你这个',
      [{ id: 0x21, name: '报告.pdf', size: 10, mtime: 1, attr: 1 }],
      false
    )
    const files = repos.files.list()
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({
      messageId: expect.any(Number),
      conversationId: 'direct:127.0.0.1|peer'
    })

    const fileEvent = [...events]
      .reverse()
      .find((event): event is Extract<AppEvent, { type: 'file' }> => event.type === 'file')
    expect(fileEvent?.file.messageId).toBe(files[0].messageId)
    const message = repos.messages.list('direct:127.0.0.1|peer').messages[0]
    expect(message).toMatchObject({ kind: 'file', text: '给你这个' })
    expect(message.meta.files).toEqual([files[0].id])
  })

  it('persists inbound sealed metadata and read-check flag', () => {
    const { service, repos } = setup()
    ;(
      service as unknown as {
        handleIncoming: (...args: unknown[]) => void
      }
    ).handleIncoming('127.0.0.1|peer', 'Peer', 'secret', 77, {
      sealed: true,
      opened: false,
      readCheck: true
    })
    const message = repos.messages.list('direct:127.0.0.1|peer').messages[0]
    expect(message.text).toBe('secret')
    expect(message.meta).toMatchObject({ sealed: true, opened: false, readCheck: true })
  })

  it('passes the sealed flag to the engine and stores it on the outgoing message', () => {
    const { service, repos } = setup()
    const conversation = repos.conversations.ensureDirect('127.0.0.1|peer', 'Peer')
    const sendText = vi.fn(() => 123)
    ;(service as unknown as { engine: unknown }).engine = {
      getPeers: () => [peer()],
      sendText
    }
    const result = service.sendText({
      conversationId: conversation.id,
      text: 'secret',
      sealed: true
    })
    expect(sendText).toHaveBeenCalledWith('127.0.0.1|peer', 'secret', { sealed: true })
    expect(result.message.meta.sealed).toBe(true)
  })
})

describe('AppService outgoing file status', () => {
  it('links sent files and surfaces a peer rejection', () => {
    const { service, events, repos } = setup()
    const conversation = repos.conversations.ensureDirect('127.0.0.1|peer', 'Peer')
    ;(service as unknown as { engine: unknown }).engine = {
      getPeers: () => [peer()],
      sendFileOffer: () => 99
    }
    const file = join(dirs[dirs.length - 1], 'send.txt')
    writeFileSync(file, 'x')
    service.sendFiles(conversation.id, [file])
    const sent = repos.files.list()[0]
    expect(sent).toMatchObject({ messageId: expect.any(Number), state: 'offered' })

    const live = (
      service as unknown as { fileManager: { get: (id: string) => unknown } }
    ).fileManager.get(sent.id)
    ;(service as unknown as { handleFileUpdate: (file: unknown) => void }).handleFileUpdate({
      ...(live as object),
      state: 'rejected'
    })
    const rejected = [...events]
      .reverse()
      .find((event): event is Extract<AppEvent, { type: 'file' }> => event.type === 'file')
    expect(rejected?.file).toMatchObject({
      id: sent.id,
      state: 'rejected',
      messageId: sent.messageId
    })
  })
})

async function freePort(): Promise<number> {
  const { createServer } = await import('node:net')
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

async function waitUntil(probe: () => boolean, timeout = 5000): Promise<void> {
  const started = Date.now()
  while (!probe()) {
    if (Date.now() - started > timeout) throw new Error('等待状态超时')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

describe('two AppService file rejection', () => {
  it('marks the sender task rejected when the receiver rejects', async () => {
    const portA = await freePort()
    const portB = await freePort()
    const dirA = mkdtempSync(join(tmpdir(), 'lanpost-a-'))
    const dirB = mkdtempSync(join(tmpdir(), 'lanpost-b-'))
    dirs.push(dirA, dirB)
    const dbA = openDatabase(':memory:')
    const dbB = openDatabase(':memory:')
    const settingsA = new SettingsStore(join(dirA, 'settings.json'), {
      displayName: 'Alice',
      account: 'alice',
      hostName: 'alice-host'
    })
    settingsA.update({
      files: { receiveDir: dirA, autoAccept: false },
      network: { port: portA, bindAddr: '127.0.0.1', seeds: [`127.0.0.1:${portB}`] }
    })
    const settingsB = new SettingsStore(join(dirB, 'settings.json'), {
      displayName: 'Bob',
      account: 'bob',
      hostName: 'bob-host'
    })
    settingsB.update({
      files: { receiveDir: dirB, autoAccept: false },
      network: { port: portB, bindAddr: '127.0.0.1', seeds: [`127.0.0.1:${portA}`] }
    })
    const a = new AppService(dbA, settingsA, {
      name: 'test',
      version: '0.1.0',
      platform: 'win32',
      appId: 'test'
    })
    const b = new AppService(dbB, settingsB, {
      name: 'test',
      version: '0.1.0',
      platform: 'win32',
      appId: 'test'
    })
    const source = join(dirA, 'send.txt')
    writeFileSync(source, 'hello file')
    const events: AppEvent[] = []
    a.attachWindow({
      webContents: { send: (_channel: string, event: AppEvent) => events.push(event) }
    } as never)
    try {
      await a.start()
      await b.start()
      await waitUntil(() => a.snapshot().peers.some((peer) => peer.user === 'bob' && peer.online))
      await waitUntil(() => b.snapshot().peers.some((peer) => peer.user === 'alice' && peer.online))
      const conversation = a.snapshot().conversations.find((item) => item.peerKey?.endsWith('|bob'))
      expect(conversation).toBeDefined()
      a.sendFiles(conversation!.id, [source])
      await waitUntil(() => b.snapshot().files.length === 1)
      const incoming = b.snapshot().files[0]
      b.rejectFile(incoming.id)
      await waitUntil(() => a.snapshot().files[0]?.state === 'rejected')
      expect(a.snapshot().files[0].state).toBe('rejected')
      const rejected = [...events]
        .reverse()
        .find((event): event is Extract<AppEvent, { type: 'file' }> => event.type === 'file')
      expect(rejected?.file).toMatchObject({
        state: 'rejected',
        messageId: a.snapshot().files[0].messageId
      })
    } finally {
      await a.stop()
      await b.stop()
      dbA.close()
      dbB.close()
    }
  }, 20000)
})

describe('two AppService sender cancel', () => {
  it('cancels a waiting offer and marks the receiver rejected', async () => {
    const portA = await freePort()
    const portB = await freePort()
    const dirA = mkdtempSync(join(tmpdir(), 'lanpost-ca-'))
    const dirB = mkdtempSync(join(tmpdir(), 'lanpost-cb-'))
    dirs.push(dirA, dirB)
    const dbA = openDatabase(':memory:')
    const dbB = openDatabase(':memory:')
    const settingsA = new SettingsStore(join(dirA, 'settings.json'), {
      displayName: 'Alice',
      account: 'alice',
      hostName: 'alice-host'
    })
    settingsA.update({
      files: { receiveDir: dirA, autoAccept: false },
      network: { port: portA, bindAddr: '127.0.0.1', seeds: [`127.0.0.1:${portB}`] }
    })
    const settingsB = new SettingsStore(join(dirB, 'settings.json'), {
      displayName: 'Bob',
      account: 'bob',
      hostName: 'bob-host'
    })
    settingsB.update({
      files: { receiveDir: dirB, autoAccept: false },
      network: { port: portB, bindAddr: '127.0.0.1', seeds: [`127.0.0.1:${portA}`] }
    })
    const a = new AppService(dbA, settingsA, {
      name: 'test',
      version: '0.1.0',
      platform: 'win32',
      appId: 'test'
    })
    const b = new AppService(dbB, settingsB, {
      name: 'test',
      version: '0.1.0',
      platform: 'win32',
      appId: 'test'
    })
    const source = join(dirA, 'cancel.txt')
    writeFileSync(source, 'cancel me')
    try {
      await a.start()
      await b.start()
      await waitUntil(() => a.snapshot().peers.some((peer) => peer.user === 'bob' && peer.online))
      await waitUntil(() => b.snapshot().peers.some((peer) => peer.user === 'alice' && peer.online))
      const conversation = a.snapshot().conversations.find((item) => item.peerKey?.endsWith('|bob'))
      a.sendFiles(conversation!.id, [source])
      await waitUntil(() => b.snapshot().files.length === 1)
      const outgoing = a.snapshot().files[0]
      a.cancelFile(outgoing.id)
      await waitUntil(() => b.snapshot().files[0]?.state === 'rejected')
      expect(a.snapshot().files[0].state).toBe('canceled')
      expect(b.snapshot().files[0].state).toBe('rejected')
    } finally {
      await a.stop()
      await b.stop()
      dbA.close()
      dbB.close()
    }
  }, 20000)
})

describe('AppService picker directory memory', () => {
  it('uses the last directory and remembers the new one', async () => {
    const { service, repos, settings } = setup()
    const firstDir = mkdtempSync(join(tmpdir(), 'lanpost-pick-a-'))
    const secondDir = mkdtempSync(join(tmpdir(), 'lanpost-pick-b-'))
    dirs.push(firstDir, secondDir)
    settings.update({ files: { lastDialogDir: firstDir } })
    const conversation = repos.conversations.ensureDirect('127.0.0.1|peer', 'Peer')
    ;(service as unknown as { engine: unknown }).engine = {
      getPeers: () => [peer()],
      sendFileOffer: () => 77
    }

    electronMocks.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    await service.pickAndSend(conversation.id)
    expect(electronMocks.showOpenDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ defaultPath: firstDir })
    )

    const picked = join(secondDir, 'picked.txt')
    writeFileSync(picked, 'x')
    electronMocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [picked] })
    await service.pickAndSend(conversation.id)
    expect(electronMocks.showOpenDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ defaultPath: firstDir })
    )
    expect(settings.get().files.lastDialogDir).toBe(secondDir)
  })
})

describe('AppService identity history reuse', () => {
  it('keeps messages in one conversation when identity matches across peer keys', () => {
    const { service, repos } = setup()
    const inbound = (service as unknown as { handleIncoming: (...args: unknown[]) => void })
      .handleIncoming
    inbound.call(service, '10.0.0.1|alice', 'Alice', 'old ip', 1, {}, 'identity-x')
    inbound.call(service, '10.0.0.2|alice', 'Alice', 'new ip', 2, {}, 'identity-x')
    const conversations = repos.conversations.list()
    expect(conversations).toHaveLength(1)
    expect(conversations[0]).toMatchObject({ identityId: 'identity-x', peerKey: '10.0.0.2|alice' })
    expect(repos.messages.list(conversations[0].id).messages).toHaveLength(2)
  })
})

describe('AppService third-party notice', () => {
  it('adds one system notice per conversation per app lifetime', () => {
    const { service, repos, events } = setup()
    const peerInfo = {
      ...peer(),
      key: '192.168.2.124|xqkj',
      ip: '192.168.2.124',
      user: 'xqkj',
      name: '内网通',
      clientType: 'nwt' as const
    }
    repos.peers.upsert({
      key: peerInfo.key,
      ip: peerInfo.ip,
      port: peerInfo.port,
      user: peerInfo.user,
      host: peerInfo.host,
      name: peerInfo.name,
      group: '',
      status: 0,
      identityId: '',
      clientType: 'nwt',
      online: true,
      lastSeen: 1,
      unread: 0,
      alias: '',
      capUtf8: false,
      capFile: true,
      capClipboard: false,
      dialup: false,
      versionInfo: '',
      absenceInfo: ''
    })
    const conversation = repos.conversations.ensureDirect(peerInfo.key, peerInfo.name)
    service.openConversation(conversation.id)
    service.openConversation(conversation.id)
    const system = repos.messages
      .list(conversation.id)
      .messages.filter((message) => message.kind === 'system')
    expect(system).toHaveLength(1)
    expect(system[0].text).toContain('内网通')
    expect(
      events.some((event) => event.type === 'message' && event.message.kind === 'system')
    ).toBe(true)
  })
})

describe('AppService presence', () => {
  it('persists a manual status and tells the renderer', () => {
    const { service, settings, events } = setup()

    service.setStatus(1)

    expect(settings.get().identity.status).toBe(1)
    expect(events).toContainEqual({ type: 'local-status', status: 1 })
    expect(() => service.setStatus(9)).toThrow('无效的在线状态')
  })

  it('auto switches to away and back to online', () => {
    const { service, settings, events } = setup()

    service.evaluateIdleStatus(10 * 60)
    expect(settings.get().identity.status).toBe(0)

    service.evaluateIdleStatus(IDLE_AWAY_SECONDS)
    expect(settings.get().identity.status).toBe(2)

    service.evaluateIdleStatus(0)
    expect(settings.get().identity.status).toBe(0)

    expect(
      events
        .filter((event) => event.type === 'local-status')
        .map((event) => (event.type === 'local-status' ? event.status : -1))
    ).toEqual([2, 0])
  })

  it('keeps a manual busy status untouched by idle automation', () => {
    const { service, settings } = setup()

    service.setStatus(1)
    service.evaluateIdleStatus(IDLE_AWAY_SECONDS)

    expect(settings.get().identity.status).toBe(1)
  })

  it('does not override a manual away status with idle automation', () => {
    const { service, settings } = setup()

    service.setStatus(2)
    service.evaluateIdleStatus(0)
    service.evaluateIdleStatus(IDLE_AWAY_SECONDS)

    expect(settings.get().identity.status).toBe(2)
  })

  it('clears automatic state when settings change the status elsewhere', () => {
    const { service, settings } = setup()

    service.evaluateIdleStatus(IDLE_AWAY_SECONDS)
    expect(settings.get().identity.status).toBe(2)

    settings.update({ identity: { status: 0 } })
    service.applySettings(settings.get())
    service.evaluateIdleStatus(0)

    expect(settings.get().identity.status).toBe(0)
  })
})
