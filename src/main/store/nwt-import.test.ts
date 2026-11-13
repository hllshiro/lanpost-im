import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { AvatarStore } from '../avatar/store'
import { SettingsStore } from '../settings/store'
import { openDatabase } from './db'
import { applyNwtImport, readNwtData, resolveNwtRoot } from './nwt-import'
import { createRepositories } from './repositories'

const ACCOUNT = '3d2f84b92bd3d542839590568661971c'
const FACE_MD5 = '3f92474ef0592c8001e2b501cbe7986c'
const OTHER_FACE_MD5 = '90865f64921c07909ad1e886220833fe'
const AVATAR = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

// Option.xml 的 CorpId 里是带控制字符的二进制，真实的解析会碰到非法 XML 字符
const OPTION_XML = `\uFEFF<?xml version="1.0" encoding="utf-8"?>
<UserOption>
    <CorpId>98974e7\u000c\u001eb\u0001_#V\u0003
qhwN\u0000\u0002 423 c8d</CorpId>
    <UserCompany>星穹科技</UserCompany>
    <UserDepartment>测试部/笔记本组</UserDepartment>
    <UserGender>0</UserGender>
    <UserName>笔记本2</UserName>
    <UserSign>你猜猜呀</UserSign>
    <UserUserFace>${FACE_MD5}</UserUserFace>
</UserOption>
`

const GROUP_A = '7ad4b2b4f0213b4a832fc807632bc23b'
const GROUP_B = '75812b7ebb439840afd7577d18f0731f'

function makeQrp(file: string, options: { withMembers?: boolean } = {}): void {
  const db = new DatabaseSync(file)
  db.exec(`CREATE TABLE QGroupInfo_${ACCOUNT} (
    PriKey integer primary key autoincrement,
    QGroupId text, Name text, Master text, Intr text, Ann text,
    InfoVer integer, UserVer integer, CreateTime integer,
    Reserved1 text, Reserved2 text, Reserved3 integer, Reserved4 integer
  )`)
  const insert = db.prepare(
    `INSERT INTO QGroupInfo_${ACCOUNT} (QGroupId, Name, Master, Intr, Ann, InfoVer, UserVer, CreateTime)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  insert.run(GROUP_A, '上网机 笔记本，上网机 3', ACCOUNT, '', '', 2, 2, 1792734259)
  insert.run(GROUP_B, '测试群222', ACCOUNT, '主题1', '公告2', 4, 3, 1794463075)
  if (options.withMembers !== false) {
    db.exec(`CREATE TABLE QGroupUser_${ACCOUNT} (
      PriKey integer primary key autoincrement,
      QGroupId text, UserId text, UserName text,
      Reserved1 text, Reserved2 text, Reserved3 integer, Reserved4 integer
    )`)
    const member = db.prepare(
      `INSERT INTO QGroupUser_${ACCOUNT} (QGroupId, UserId, UserName) VALUES (?, ?, ?)`
    )
    member.run(GROUP_A, ACCOUNT, '笔记本2')
    member.run(GROUP_A, '68e24da0fa70794981775dd7dbfb7c6f', '上网机 3')
  }
  db.close()
}

function makeNwtDir(options: { withQrp?: boolean; withMembers?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'nwt-import-'))
  const root = join(dir, 'Syl')
  mkdirSync(join(root, 'data'), { recursive: true })
  mkdirSync(join(root, 'cache', 'cfg'), { recursive: true })
  mkdirSync(join(root, 'cache', 'face'), { recursive: true })
  writeFileSync(join(root, 'data', 'acc'), ACCOUNT)
  writeFileSync(join(root, 'cache', 'cfg', 'Option.xml'), OPTION_XML)
  writeFileSync(join(root, 'cache', 'face', FACE_MD5), AVATAR)
  if (options.withQrp !== false) {
    makeQrp(join(root, 'data', 'qrp'), { withMembers: options.withMembers })
  }
  return dir
}

const temps: string[] = []

function track(dir: string): string {
  temps.push(dir)
  return dir
}

function makeSettings(dir: string): SettingsStore {
  return new SettingsStore(join(dir, 'settings.json'))
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
  }
})

describe('resolveNwtRoot', () => {
  it('接受内网通安装目录并定位到 Syl', () => {
    const dir = track(makeNwtDir())
    expect(resolveNwtRoot(dir)).toBe(join(dir, 'Syl'))
  })

  it('接受 Syl 目录本身', () => {
    const dir = track(makeNwtDir())
    expect(resolveNwtRoot(join(dir, 'Syl'))).toBe(join(dir, 'Syl'))
  })

  it('目录里没有 data/acc 时明确报错', () => {
    const dir = track(mkdtempSync(join(tmpdir(), 'nwt-empty-')))
    expect(() => resolveNwtRoot(dir)).toThrow('所选目录不是内网通数据目录')
  })
})

describe('readNwtData', () => {
  it('读取用户标识、资料、头像与群', () => {
    const dir = track(makeNwtDir())
    const data = readNwtData(dir)
    expect(data.privateId).toBe(ACCOUNT)
    expect(data.profile.displayName).toBe('笔记本2')
    expect(data.profile.corporation).toBe('星穹科技')
    expect(data.profile.department).toBe('测试部/笔记本组')
    expect(data.profile.sign).toBe('你猜猜呀')
    expect(data.avatarMd5).toBe(FACE_MD5)
    expect(data.avatar?.equals(AVATAR)).toBe(true)
    expect(data.groups).toHaveLength(2)
    const group = data.groups[1]
    expect(group.id).toBe(GROUP_B)
    expect(group.name).toBe('测试群222')
    expect(group.topic).toBe('主题1')
    expect(group.announcement).toBe('公告2')
    expect(group.master).toBe(ACCOUNT)
    expect(group.infoVersion).toBe(4)
    expect(group.userVersion).toBe(3)
  })

  it('读取群成员', () => {
    const dir = track(makeNwtDir())
    const data = readNwtData(dir)
    const members = data.groups[0].members
    expect(members.map((member) => member.name)).toEqual(['笔记本2', '上网机 3'])
    expect(members[1].userId).toBe('68e24da0fa70794981775dd7dbfb7c6f')
  })

  it('没有成员表时群成员为空', () => {
    const dir = track(makeNwtDir({ withMembers: false }))
    expect(readNwtData(dir).groups[0].members).toEqual([])
  })

  it('没有 qrp 时不报错，群列表为空', () => {
    const dir = track(makeNwtDir({ withQrp: false }))
    expect(readNwtData(dir).groups).toEqual([])
  })

  it('头像文件缺失时不返回头像数据', () => {
    const dir = track(makeNwtDir())
    rmSync(join(dir, 'Syl', 'cache', 'face', FACE_MD5))
    const data = readNwtData(dir)
    expect(data.avatarMd5).toBe(FACE_MD5)
    expect(data.avatar).toBeNull()
  })

  it('用户标识不是 32 位十六进制时报错', () => {
    const dir = track(makeNwtDir())
    writeFileSync(join(dir, 'Syl', 'data', 'acc'), 'not-a-user-id')
    expect(() => readNwtData(dir)).toThrow('内网通用户标识格式不正确')
  })
})

describe('applyNwtImport', () => {
  function prepare(): {
    dir: string
    settings: SettingsStore
    db: DatabaseSync
    repos: ReturnType<typeof createRepositories>
    avatars: AvatarStore
  } {
    const dir = track(makeNwtDir())
    const settings = makeSettings(dir)
    const db = openDatabase(':memory:')
    const repos = createRepositories(db)
    const avatars = new AvatarStore(join(dir, 'avatars'))
    return { dir, settings, db, repos, avatars }
  }

  it('写入身份、头像与群会话', () => {
    const { dir, settings, repos, avatars } = prepare()
    const summary = applyNwtImport({
      data: readNwtData(dir),
      settings,
      repos,
      avatars,
      randomAvatarId: () => 12345
    })

    const identity = settings.get().identity
    expect(identity.privateId).toBe(ACCOUNT)
    expect(identity.displayName).toBe('笔记本2')
    expect(identity.corporation).toBe('星穹科技')
    expect(identity.department).toBe('测试部/笔记本组')
    expect(identity.sign).toBe('你猜猜呀')
    expect(identity.avatarMd5).toBe(FACE_MD5)
    expect(identity.avatarId).toBe(12345)
    expect(readFileSync(avatars.path(FACE_MD5)).equals(AVATAR)).toBe(true)

    expect(repos.groups.list()).toHaveLength(2)
    expect(repos.groups.members(GROUP_A)).toHaveLength(2)
    const conversation = repos.conversations.get(`group:${GROUP_B}`)
    expect(conversation?.title).toBe('测试群222')
    expect(conversation?.kind).toBe('group')
    expect(summary.groupCount).toBe(2)
    expect(summary.displayName).toBe('笔记本2')
    expect(summary.privateId).toBe(ACCOUNT)
    expect(summary.avatarImported).toBe(true)
  })

  it('头像没变时沿用原来的头像文件号', () => {
    const { dir, settings, repos, avatars } = prepare()
    applyNwtImport({
      data: readNwtData(dir),
      settings,
      repos,
      avatars,
      randomAvatarId: () => 700
    })
    applyNwtImport({
      data: readNwtData(dir),
      settings,
      repos,
      avatars,
      randomAvatarId: () => 900
    })
    expect(settings.get().identity.avatarId).toBe(700)
  })

  it('头像换图时生成新的头像文件号', () => {
    const { dir, settings, repos, avatars } = prepare()
    applyNwtImport({
      data: readNwtData(dir),
      settings,
      repos,
      avatars,
      randomAvatarId: () => 700
    })
    writeFileSync(join(dir, 'Syl', 'cache', 'face', OTHER_FACE_MD5), Buffer.from([9, 9, 9]))
    writeFileSync(
      join(dir, 'Syl', 'cache', 'cfg', 'Option.xml'),
      OPTION_XML.replace(FACE_MD5, OTHER_FACE_MD5)
    )
    applyNwtImport({
      data: readNwtData(dir),
      settings,
      repos,
      avatars,
      randomAvatarId: () => 900
    })
    expect(settings.get().identity.avatarMd5).toBe(OTHER_FACE_MD5)
    expect(settings.get().identity.avatarId).toBe(900)
    expect(existsSync(avatars.path(OTHER_FACE_MD5))).toBe(true)
  })

  it('内网通资料为空时不覆盖本机已有内容', () => {
    const { dir, settings, repos, avatars } = prepare()
    settings.update({ identity: { corporation: '保留公司', department: '保留部门' } })
    writeFileSync(
      join(dir, 'Syl', 'cache', 'cfg', 'Option.xml'),
      '<?xml version="1.0" encoding="utf-8"?><UserOption><UserName></UserName></UserOption>'
    )
    applyNwtImport({
      data: readNwtData(dir),
      settings,
      repos,
      avatars,
      randomAvatarId: () => 1
    })
    const identity = settings.get().identity
    expect(identity.corporation).toBe('保留公司')
    expect(identity.department).toBe('保留部门')
    expect(identity.displayName).not.toBe('')
  })
})

describe('applyNwtImport 范围选择', () => {
  it('关掉身份与群时只写会话数据', () => {
    const dir = track(makeNwtDir())
    const settings = makeSettings(dir)
    const db = openDatabase(':memory:')
    const repos = createRepositories(db)
    const avatars = new AvatarStore(join(dir, 'avatars'))
    const before = settings.get().identity
    const summary = applyNwtImport({
      data: readNwtData(dir),
      settings,
      repos,
      avatars,
      randomAvatarId: () => 1,
      scope: { identity: false, groups: false }
    })
    const after = settings.get().identity
    expect(after.privateId).toBe(before.privateId)
    expect(after.displayName).toBe(before.displayName)
    expect(summary.groupCount).toBe(0)
    expect(summary.avatarImported).toBe(false)
    expect(repos.groups.list()).toEqual([])
    db.close()
  })

  it('只关掉群时仍然导入身份', () => {
    const dir = track(makeNwtDir())
    const settings = makeSettings(dir)
    const db = openDatabase(':memory:')
    const repos = createRepositories(db)
    const avatars = new AvatarStore(join(dir, 'avatars'))
    applyNwtImport({
      data: readNwtData(dir),
      settings,
      repos,
      avatars,
      randomAvatarId: () => 1,
      scope: { groups: false }
    })
    expect(settings.get().identity.privateId).toBe(ACCOUNT)
    expect(repos.groups.list()).toEqual([])
    db.close()
  })
})
