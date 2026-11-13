import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createCipheriv } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { nwtPageIv, nwtPageKey } from './nwt-db'
import { readNwtHistory } from './nwt-history'

const ACCOUNT = '3d2f84b92bd3d542839590568661971c'
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

function messageData(parts: unknown[]): string {
  return JSON.stringify({ app: 'shiyeline', dt: parts, id: 'x', type: '0', ver: '6.0' })
}

function makeRecordTable(db: DatabaseSync, name: string): void {
  db.exec(`CREATE TABLE ${name} (
    PriKey integer primary key autoincrement,
    FromUserId text, FromUserName text, ToUserId text, ToUserName text,
    PeerUserId text, MsgId text, HasImage integer, MsgTime integer, MsgData text,
    MsgText text, RecordType integer, Receipt integer
  )`)
}

function encryptDatabase(plain: Buffer): Buffer {
  const pageSize = 1024
  const out = Buffer.alloc(plain.length)
  for (let index = 0; index < plain.length; index += pageSize) {
    const page = index / pageSize + 1
    const cipher = createCipheriv('aes-128-cbc', nwtPageKey(page), nwtPageIv(page))
    cipher.setAutoPadding(false)
    cipher.update(plain.subarray(index, index + pageSize)).copy(out, index)
    cipher.final()
  }
  return out
}

function makeNwtDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nwt-history-'))
  const root = join(dir, 'Syl')
  mkdirSync(join(root, 'data'), { recursive: true })
  mkdirSync(join(root, 'cache', 'db'), { recursive: true })
  writeFileSync(join(root, 'data', 'acc'), ACCOUNT)

  const qrp = new DatabaseSync(join(root, 'data', 'qrp'))
  qrp.exec('PRAGMA page_size = 1024')
  qrp.exec(`CREATE TABLE QGroupInfo_${ACCOUNT} (
    PriKey integer primary key autoincrement, QGroupId text, Name text, Master text,
    Intr text, Ann text, InfoVer integer, UserVer integer, CreateTime integer,
    Reserved1 text, Reserved2 text, Reserved3 integer, Reserved4 integer
  )`)
  qrp
    .prepare(
      `INSERT INTO QGroupInfo_${ACCOUNT} (QGroupId, Name, Master, Intr, Ann, InfoVer, UserVer, CreateTime)
     VALUES (?, ?, ?, '', '', 3, 3, 1)`
    )
    .run(GROUP, '测试群222', ACCOUNT)
  qrp.close()

  const nr = new DatabaseSync(join(root, 'cache', 'db', 'nr'))
  nr.exec('PRAGMA page_size = 1024')
  makeRecordTable(nr, `ChatRecord_${ACCOUNT}_0`)
  makeRecordTable(nr, `ChatRecord_${ACCOUNT}_22`)
  makeRecordTable(nr, `QGroupChatRecord_${ACCOUNT}_1`)
  const insert = nr.prepare(
    `INSERT INTO ChatRecord_${ACCOUNT}_0
       (FromUserId, FromUserName, ToUserId, ToUserName, PeerUserId, MsgId, HasImage, MsgTime, MsgData, MsgText, RecordType, Receipt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)`
  )
  insert.run(
    PEER,
    '上网机PC3',
    ACCOUNT,
    '笔记本2',
    PEER,
    'a1',
    0,
    1_793_000_000,
    messageData([{ txt: { t: 'normal', v: '你好' } }]),
    '你好'
  )
  insert.run(
    ACCOUNT,
    '笔记本2',
    PEER,
    '上网机PC3',
    PEER,
    'a2',
    0,
    1_793_000_100,
    messageData([{ txt: { t: 'normal', v: '收到' } }, { img: { t: 'feihu', v: '2016.gif' } }]),
    '收到'
  )
  insert.run(
    PEER,
    '上网机PC3',
    ACCOUNT,
    '笔记本2',
    PEER,
    'a3',
    0,
    1_793_000_200,
    messageData([{ file: { t: 'recv_file', v: 'C:\\Users\\xqkj\\Downloads\\流程.txt' } }]),
    '流程.txt'
  )
  insert.run(
    PEER,
    '上网机PC3',
    ACCOUNT,
    '笔记本2',
    PEER,
    'a1',
    0,
    1_793_000_000,
    messageData([{ txt: { t: 'normal', v: '你好' } }]),
    '你好'
  )
  const second = nr.prepare(
    `INSERT INTO ChatRecord_${ACCOUNT}_22
       (FromUserId, FromUserName, ToUserId, ToUserName, PeerUserId, MsgId, HasImage, MsgTime, MsgData, MsgText, RecordType, Receipt)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 1, 0)`
  )
  second.run(
    PEER,
    '上网机PC3',
    ACCOUNT,
    '笔记本2',
    PEER,
    'b1',
    1_793_100_000,
    messageData([
      { txt: { t: 'normal', v: '看文件' } },
      {
        file2: {
          a: 'false',
          i: '8626733db986e14f9c578bd191147df9',
          s: '19901144',
          t: 'offline_file',
          v: 'C:\\Users\\xqkj\\Downloads\\LocalSend.exe'
        }
      }
    ]),
    '看文件'
  )
  const group = nr.prepare(
    `INSERT INTO QGroupChatRecord_${ACCOUNT}_1
       (FromUserId, FromUserName, ToUserId, ToUserName, PeerUserId, MsgId, HasImage, MsgTime, MsgData, MsgText, RecordType, Receipt)
     VALUES (?, ?, ?, '', '', ?, 0, ?, ?, ?, 1, 0)`
  )
  group.run(
    PEER,
    '上网机PC3',
    GROUP,
    'g1',
    1_793_200_000,
    messageData([{ txt: { t: 'normal', v: '群消息' } }]),
    '群消息'
  )
  nr.close()

  const plain = readFileSync(join(root, 'cache', 'db', 'nr'))
  writeFileSync(join(root, 'cache', 'db', 'nr'), encryptDatabase(plain))
  return dir
}

describe('readNwtHistory', () => {
  it('按对端聚合私聊，跳过重复消息号', () => {
    const dir = track(makeNwtDir())
    const history = readNwtHistory(dir)
    expect(history.account).toBe(ACCOUNT)
    const direct = history.sessions.find((session) => session.key === PEER)
    expect(direct).toBeDefined()
    expect(direct?.kind).toBe('direct')
    expect(direct?.title).toBe('上网机PC3')
    expect(direct?.messages.map((message) => message.nwtId)).toEqual(['a1', 'a2', 'a3', 'b1'])
    expect(direct?.count).toBe(4)
    expect(direct?.firstAt).toBe(1_793_000_000_000)
    expect(direct?.lastAt).toBe(1_793_100_000_000)
  })

  it('解析文字、表情与文件段', () => {
    const dir = track(makeNwtDir())
    const history = readNwtHistory(dir)
    const direct = history.sessions.find((session) => session.key === PEER)
    const messages = direct?.messages ?? []
    expect(messages[0]).toMatchObject({ direction: 'in', kind: 'text', text: '你好' })
    expect(messages[1].direction).toBe('out')
    expect(messages[1].segments).toEqual([
      { kind: 'text', text: '收到' },
      { kind: 'image', value: '2016.gif' }
    ])
    const file = messages[2]
    expect(file.kind).toBe('file')
    expect(file.file?.name).toBe('流程.txt')
    expect(file.file?.path).toContain('流程.txt')
    expect(messages[3].file).toMatchObject({ name: 'LocalSend.exe', size: 19901144 })
  })

  it('群会话用群号作键，标题取群资料', () => {
    const dir = track(makeNwtDir())
    const history = readNwtHistory(dir)
    const group = history.sessions.find((session) => session.kind === 'group')
    expect(group?.key).toBe(GROUP)
    expect(group?.title).toBe('测试群222')
    expect(group?.messages[0].text).toBe('群消息')
  })

  it('没有加密库时返回空会话', () => {
    const dir = track(makeNwtDir())
    rmSync(join(dir, 'Syl', 'cache', 'db', 'nr'))
    expect(readNwtHistory(dir).sessions).toEqual([])
  })
})
