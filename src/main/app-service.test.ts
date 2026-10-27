import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from './store/db'
import { createRepositories } from './store/repositories'
import { SettingsStore } from './settings/store'
import type { AppEvent } from '../shared/domain'
import type { ProtocolPeer } from './protocol/engine'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  dialog: {},
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
