import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { XMLParser } from 'fast-xml-parser'
import type { Settings } from '../../shared/settings'
import type { AvatarStore } from '../avatar/store'
import type { SettingsStore } from '../settings/store'
import type { Repositories } from './repositories'

// 内网通把数据放在安装目录下的 Syl 里：
// data/acc 是协议里的用户标识，data/qrp 存群与群成员，
// cache/cfg/Option.xml 是本机资料，cache/face/<md5> 是头像文件
const NWT_SUBDIR = 'Syl'
const ACCOUNT_PATTERN = /^[0-9a-f]{32}$/

export interface NwtProfile {
  displayName: string
  corporation: string
  department: string
  sign: string
}

export interface NwtGroupMember {
  userId: string
  name: string
}

export interface NwtGroup {
  id: string
  name: string
  master: string
  topic: string
  announcement: string
  infoVersion: number
  userVersion: number
  members: NwtGroupMember[]
}

export interface NwtData {
  root: string
  privateId: string
  profile: NwtProfile
  avatarMd5: string
  avatar: Buffer | null
  groups: NwtGroup[]
}

export interface NwtImportSummary {
  source: string
  privateId: string
  displayName: string
  groupCount: number
  avatarImported: boolean
}

// 用户可能选安装目录，也可能直接选 Syl；两种都认
export function resolveNwtRoot(input: string): string {
  for (const candidate of [input, join(input, NWT_SUBDIR)]) {
    if (existsSync(join(candidate, 'data', 'acc'))) {
      return candidate
    }
  }
  throw new Error('所选目录不是内网通数据目录')
}

export function readNwtData(input: string): NwtData {
  const root = resolveNwtRoot(input)
  const privateId = readAccount(root)
  const profile = readProfile(join(root, 'cache', 'cfg', 'Option.xml'))
  const avatarFile = join(root, 'cache', 'face', profile.faceMd5)
  const avatar = profile.faceMd5 !== '' && existsSync(avatarFile) ? readFileSync(avatarFile) : null
  return {
    root,
    privateId,
    profile: {
      displayName: profile.displayName,
      corporation: profile.corporation,
      department: profile.department,
      sign: profile.sign
    },
    avatarMd5: profile.faceMd5,
    avatar,
    groups: readGroups(join(root, 'data', 'qrp'), privateId)
  }
}

// 把身份、资料、头像与群写进本机；内网通没有的字段保持原值
export function applyNwtImport(options: {
  data: NwtData
  settings: SettingsStore
  repos: Repositories
  avatars: AvatarStore
  randomAvatarId: () => number
  // 用户可以选择只导群、只导历史，身份与群分别开关
  scope?: { identity?: boolean; groups?: boolean }
}): NwtImportSummary {
  const { data, settings, repos, avatars } = options
  const includeIdentity = options.scope?.identity !== false
  const includeGroups = options.scope?.groups !== false
  const identity = settings.get().identity
  let avatarImported = false
  let next = settings.get()

  if (includeIdentity) {
    const patch: Partial<Settings['identity']> = { privateId: data.privateId }
    if (data.profile.displayName !== '') patch.displayName = data.profile.displayName
    if (data.profile.corporation !== '') patch.corporation = data.profile.corporation
    if (data.profile.department !== '') patch.department = data.profile.department
    if (data.profile.sign !== '') patch.sign = data.profile.sign

    if (data.avatar !== null && data.avatarMd5 !== '') {
      avatars.put(data.avatarMd5, data.avatar)
      avatarImported = true
      patch.avatarMd5 = data.avatarMd5
      // 同一张图沿用原来的文件号，对端不用重新取
      patch.avatarId =
        identity.avatarMd5 === data.avatarMd5 && identity.avatarId > 0
          ? identity.avatarId
          : Math.max(1, options.randomAvatarId())
    }
    next = settings.update({ identity: patch })
  }

  for (const group of includeGroups ? data.groups : []) {
    const existing = repos.groups.get(group.id)
    repos.groups.upsert({
      id: group.id,
      name: group.name,
      topic: group.topic,
      announcement: group.announcement,
      master: group.master,
      infoVersion: group.infoVersion,
      userVersion: group.userVersion,
      // qrp 里没有这两项，沿用本机已有的值
      allowOtherAdd: existing?.allowOtherAdd ?? 0,
      photoMd5: existing?.photoMd5 ?? '',
      updatedAt: Date.now()
    })
    repos.groups.replaceMembers(group.id, group.members)
    const title = group.name === '' ? '群聊' : group.name
    const conversation = repos.conversations.ensureGroup(group.id, title)
    repos.conversations.setTitle(conversation.id, title)
  }

  return {
    source: data.root,
    privateId: data.privateId,
    displayName: next.identity.displayName,
    groupCount: includeGroups ? data.groups.length : 0,
    avatarImported
  }
}

function readAccount(root: string): string {
  const raw = readFileSync(join(root, 'data', 'acc'), 'utf8')
    .trim()
    .toLowerCase()
  if (!ACCOUNT_PATTERN.test(raw)) {
    throw new Error('内网通用户标识格式不正确')
  }
  return raw
}

interface OptionFields {
  displayName: string
  corporation: string
  department: string
  sign: string
  faceMd5: string
}

// Option.xml 的 CorpId 里带控制字符，普通 XML 解析会把它当文本收下；
// 这里只取需要的几个字段，其余内容原样忽略
function readProfile(file: string): OptionFields {
  const empty: OptionFields = {
    displayName: '',
    corporation: '',
    department: '',
    sign: '',
    faceMd5: ''
  }
  if (!existsSync(file)) return empty
  const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
  const parsed: unknown = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    trimValues: true
  }).parse(text)
  const root = child(parsed, 'UserOption')
  if (root === null) return empty
  const faceMd5 = field(root, 'UserUserFace').toLowerCase()
  return {
    displayName: field(root, 'UserName'),
    corporation: field(root, 'UserCompany'),
    department: field(root, 'UserDepartment'),
    sign: field(root, 'UserSign'),
    faceMd5: /^[0-9a-f]{32}$/.test(faceMd5) ? faceMd5 : ''
  }
}

function child(source: unknown, name: string): unknown {
  if (typeof source !== 'object' || source === null) return null
  return (source as Record<string, unknown>)[name] ?? null
}

function field(source: unknown, name: string): string {
  const value = child(source, name)
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  return ''
}

function readGroups(file: string, account: string): NwtGroup[] {
  if (!existsSync(file)) return []
  let db: DatabaseSync
  try {
    db = new DatabaseSync(file, { readOnly: true })
  } catch (error) {
    throw new Error(`无法读取内网通群数据：${(error as Error).message}`, { cause: error })
  }
  try {
    const infoTable = `QGroupInfo_${account}`
    if (!hasTable(db, infoTable)) return []
    const members = readMembers(db, `QGroupUser_${account}`)
    const rows = db
      .prepare(
        `SELECT QGroupId, Name, Master, Intr, Ann, InfoVer, UserVer
         FROM ${infoTable} ORDER BY PriKey ASC`
      )
      .all() as unknown as Array<Record<string, unknown>>
    return rows.map((row) => {
      const id = text(row['QGroupId'])
      return {
        id,
        name: text(row['Name']),
        master: text(row['Master']).toLowerCase(),
        topic: text(row['Intr']),
        announcement: text(row['Ann']),
        infoVersion: integer(row['InfoVer']),
        userVersion: integer(row['UserVer']),
        members: members.filter((member) => member.groupId === id).map((member) => member.member)
      }
    })
  } finally {
    db.close()
  }
}

function readMembers(
  db: DatabaseSync,
  table: string
): Array<{ groupId: string; member: NwtGroupMember }> {
  if (!hasTable(db, table)) return []
  const rows = db
    .prepare(`SELECT QGroupId, UserId, UserName FROM ${table} ORDER BY PriKey ASC`)
    .all() as unknown as Array<Record<string, unknown>>
  return rows.map((row) => ({
    groupId: text(row['QGroupId']),
    member: { userId: text(row['UserId']).toLowerCase(), name: text(row['UserName']) }
  }))
}

function hasTable(db: DatabaseSync, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name)
  return row !== undefined
}

function text(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return ''
}

function integer(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(text(value))
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0
}
