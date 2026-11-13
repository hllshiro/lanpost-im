import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { NwtHistory, NwtHistorySession } from './nwt-history'
import { applyNwtHistory } from './nwt-history'
import { openDatabase } from './db'
import { createRepositories } from './repositories'

const PEER = '68e24da0fa70794981775dd7dbfb7c6f'
const GROUP = '69558a1017f54f458bb0985d0c0979ef'

const temps: string[] = []

function track(dir: string): string {
  temps.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
  }
})

function session(overrides: Partial<NwtHistorySession> = {}): NwtHistorySession {
  return {
    key: PEER,
    kind: 'direct',
    title: '上网机PC3',
    firstAt: 1_793_000_000,
    lastAt: 1_793_000_100,
    count: 2,
    messages: [
      {
        nwtId: 'a1',
        direction: 'in',
        kind: 'text',
        text: '你好',
        time: 1_793_000_000,
        segments: [{ kind: 'text', text: '你好' }],
        file: null
      },
      {
        nwtId: 'a2',
        direction: 'out',
        kind: 'text',
        text: '收到',
        time: 1_793_000_100,
        segments: [
          { kind: 'text', text: '收到' },
          { kind: 'image', value: '2016.gif' }
        ],
        file: null
      }
    ],
    ...overrides
  }
}

function makeHistory(sessions: NwtHistorySession[]): NwtHistory {
  return { account: '3d2f84b92bd3d542839590568661971c', sessions }
}

describe('applyNwtHistory', () => {
  it('写入会话与消息，重复导入按消息号跳过', () => {
    const db = openDatabase(':memory:')
    const repos = createRepositories(db)
    const history = makeHistory([session()])

    const first = applyNwtHistory({ history, selected: [PEER], repos, db })
    expect(first).toEqual({ conversations: 1, messages: 2, files: 0, skipped: 0 })

    const conversation = repos.conversations.get(`direct:${PEER}`)
    expect(conversation?.title).toBe('上网机PC3')
    expect(conversation?.lastMessageAt).toBe(1_793_000_100)
    const messages = repos.messages.listAll(`direct:${PEER}`)
    expect(messages.map((message) => [message.direction, message.text])).toEqual([
      ['in', '你好'],
      ['out', '收到']
    ])
    expect(JSON.parse(messages[1].meta)).toMatchObject({
      imported: 'nwt',
      segments: [
        { kind: 'text', text: '收到' },
        { kind: 'image', value: '2016.gif' }
      ]
    })
    expect(repos.peers.get(PEER)?.name).toBe('上网机PC3')

    const second = applyNwtHistory({ history, selected: [PEER], repos, db })
    expect(second).toEqual({ conversations: 1, messages: 0, files: 0, skipped: 2 })
    expect(repos.messages.listAll(`direct:${PEER}`)).toHaveLength(2)
    db.close()
  })

  it('只导入选中的会话', () => {
    const db = openDatabase(':memory:')
    const repos = createRepositories(db)
    const history = makeHistory([
      session(),
      session({ key: 'other-user', title: '另一个人', messages: [] })
    ])
    const result = applyNwtHistory({ history, selected: ['other-user'], repos, db })
    expect(result.conversations).toBe(1)
    expect(repos.conversations.get(`direct:${PEER}`)).toBeNull()
    expect(repos.conversations.get('direct:other-user')).not.toBeNull()
    db.close()
  })

  it('群历史写进群会话', () => {
    const db = openDatabase(':memory:')
    const repos = createRepositories(db)
    const history = makeHistory([
      session({ key: GROUP, kind: 'group', title: '测试群222', messages: [] })
    ])
    applyNwtHistory({ history, selected: [GROUP], repos, db })
    const conversation = repos.conversations.get(`group:${GROUP}`)
    expect(conversation?.kind).toBe('group')
    expect(conversation?.title).toBe('测试群222')
    db.close()
  })

  it('已有会话保留当前标题', () => {
    const db = openDatabase(':memory:')
    const repos = createRepositories(db)
    repos.conversations.ensureDirect(PEER, '上网机PC3')
    applyNwtHistory({
      history: makeHistory([session({ title: '上网机 3' })]),
      selected: [PEER],
      repos,
      db
    })
    expect(repos.conversations.get(`direct:${PEER}`)?.title).toBe('上网机PC3')
    db.close()
  })

  it('按地址保存的旧联系人合并到用户标识下', () => {
    const db = openDatabase(':memory:')
    const repos = createRepositories(db)
    db.prepare(
      `INSERT INTO peers (key, ip, port, user, host, name, last_seen) VALUES ('192.168.2.125', '192.168.2.125', 0, '', '', '上网机PC3', 5)`
    ).run()
    repos.conversations.ensureDirect('192.168.2.125', '上网机PC3')
    repos.messages.insertIncoming('direct:192.168.2.125', '旧消息', 0, 'text', '{}')

    applyNwtHistory({ history: makeHistory([session()]), selected: [PEER], repos, db })

    expect(repos.conversations.get('direct:192.168.2.125')).toBeNull()
    const messages = repos.messages.listAll(`direct:${PEER}`)
    expect(messages.map((message) => message.text)).toEqual(['旧消息', '你好', '收到'])
    db.close()
  })

  it('文件记录生成本机有或没有两种状态', () => {
    const dir = track(mkdtempSync(join(tmpdir(), 'nwt-files-')))
    const present = join(dir, 'present.txt')
    writeFileSync(present, 'x')
    const db = openDatabase(':memory:')
    const repos = createRepositories(db)
    const history = makeHistory([
      session({
        messages: [
          {
            nwtId: 'f1',
            direction: 'in',
            kind: 'file',
            text: 'present.txt',
            time: 1_793_000_000,
            segments: [],
            file: { name: 'present.txt', path: present, size: 1 }
          },
          {
            nwtId: 'f2',
            direction: 'out',
            kind: 'file',
            text: 'gone.txt',
            time: 1_793_000_050,
            segments: [],
            file: { name: 'gone.txt', path: join(dir, 'gone.txt'), size: 42 }
          }
        ]
      })
    ])
    const result = applyNwtHistory({ history, selected: [PEER], repos, db })
    expect(result.files).toBe(2)
    const tasks = repos.files.list(`direct:${PEER}`)
    expect(tasks.map((task) => [task.name, task.state])).toEqual([
      ['present.txt', 'done'],
      ['gone.txt', 'missing']
    ])
    expect(tasks[1].error).toBe('文件不在这台电脑')
    db.close()
  })
})
