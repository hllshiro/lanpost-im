# 内网传书 Phase 0 基础工程实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立可运行、可测试、可打包的 Electron 基础工程，完成设置存储、SQLite 迁移、IPC 契约、窗口与托盘骨架。

**Architecture:** 主进程持有设置与数据库，渲染进程只通过预加载脚本暴露的类型化 IPC 访问。数据库使用 Electron 内置的 `node:sqlite`，不引入原生模块。窗口关闭默认隐藏到托盘，进程常驻。

**Tech Stack:** Electron 44.9.3、electron-vite 6、Vue 3、TypeScript、Pinia、`node:sqlite`、zod、vitest。

**Spec:** `docs/superpowers/specs/2026-10-23-electron-client-design.md`

## Global Constraints

- Electron 固定为 `44.9.3`，内置 Node 24.22.0；`node:sqlite` 已经确认支持 WAL 与事务。
- 禁止引入需要本地编译的原生模块。
- 渲染进程开启 `sandbox` 与 `contextIsolation`，关闭 `nodeIntegration`。
- 所有 IPC 入参必须经过 zod 校验。
- TypeScript 保持严格模式，不用 `any` 绕过类型。
- 设置与数据库写入必须原子化，进程异常退出不能留下半个文件。
- 提交信息使用 `feat:`、`fix:`、`test:`、`chore:` 前缀。

## Review Focus

- 设置文件被截断、包含未知字段或者版本不匹配时，应用使用默认值继续启动，并把坏文件备份；测试放在 Task 1。
- 数据库文件来自更新版本的应用（`user_version` 更高）时，应用给出明确错误并且不修改文件；测试放在 Task 2。
- 渲染进程传入非法设置补丁时，主进程拒绝并且不写盘；测试放在 Task 3。
- 数据库被另一个进程占用时，打开失败给出可读错误；测试放在 Task 2。
- 窗口关闭时仍有文件传输任务，进程保持运行，托盘可以重新打开窗口；人工验证放在 Task 4。

---

### Task 1: 设置 schema 与原子存储

**Files:**

- Create: `src/shared/settings.ts`
- Create: `src/main/settings/store.ts`
- Test: `src/main/settings/store.test.ts`

**Interfaces:**

- Consumes: 无。
- Produces:
  - `settingsSchema: z.ZodType<Settings>`
  - `type Settings = z.infer<typeof settingsSchema>`
  - `defaultSettings: Settings`
  - `class SettingsStore { constructor(filePath: string); get(): Settings; update(patch: SettingsPatch): Settings }`
  - `type SettingsPatch = { [K in keyof Settings]?: Partial<Settings[K]> }`

- [ ] **Step 1: 写失败测试**

覆盖默认值、嵌套合并、未知字段剔除、坏文件备份、跨实例持久化。

```ts
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SettingsStore } from './store'
import { defaultSettings } from '../../shared/settings'

function tempFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'lanpost-settings-')), 'settings.json')
}

describe('SettingsStore', () => {
  it('returns defaults when the file does not exist', () => {
    const store = new SettingsStore(tempFile())
    expect(store.get()).toEqual(defaultSettings)
  })

  it('merges a nested patch and persists it', () => {
    const file = tempFile()
    const store = new SettingsStore(file)
    store.update({ files: { autoAccept: true, autoAcceptMaxMB: 1024 } })
    expect(store.get().files.autoAccept).toBe(true)
    expect(new SettingsStore(file).get().files.autoAcceptMaxMB).toBe(1024)
  })

  it('drops unknown keys instead of writing them', () => {
    const file = tempFile()
    writeFileSync(file, JSON.stringify({ ...defaultSettings, unknown: 1 }))
    expect((new SettingsStore(file).get() as unknown as Record<string, unknown>).unknown).toBeUndefined()
  })

  it('backs up a corrupted file and falls back to defaults', () => {
    const file = tempFile()
    writeFileSync(file, '{ broken')
    const store = new SettingsStore(file)
    expect(store.get()).toEqual(defaultSettings)
    expect(existsSync(file + '.bak')).toBe(true)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/main/settings/store.test.ts`

Expected: FAIL，提示找不到 `./store` 或者 `defaultSettings`。

- [ ] **Step 3: 实现 schema 与存储**

`src/shared/settings.ts` 按设计文档第 9 节定义字段，分组为 `identity`、`network`、`notify`、`files`、`appearance`、`general`、`storage`。所有字段给默认值；未知字段由 zod 默认行为剔除。

`src/main/settings/store.ts`：

- 构造时读取文件；JSON 解析或 schema 校验失败时，把原文件重命名为 `.bak`，使用默认值。
- `update` 做一层深合并（只合并对象，不合并数组），校验后写临时文件、`fsyncSync`、`renameSync` 覆盖。
- `get` 返回内存副本，避免调用方修改内部状态。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run src/main/settings/store.test.ts`

Expected: 4 passed。

- [ ] **Step 5: 提交**

```bash
git add src/shared/settings.ts src/main/settings/store.ts src/main/settings/store.test.ts
git commit -m "feat: add atomic settings store"
```

---

### Task 2: SQLite schema 与迁移

**Files:**

- Create: `src/main/store/db.ts`
- Create: `src/main/store/schema.ts`
- Test: `src/main/store/db.test.ts`

**Interfaces:**

- Consumes: 无。
- Produces:
  - `openDatabase(file: string): DatabaseSync`
  - `migrate(db: DatabaseSync): void`
  - `SCHEMA_VERSION = 1`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabase } from './db'

function tempDb(): string {
  return join(mkdtempSync(join(tmpdir(), 'lanpost-db-')), 'lanpost.db')
}

describe('openDatabase', () => {
  it('creates the phase 0 tables and sets the schema version', () => {
    const db = openDatabase(tempDb())
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((row) => row.name)
    expect(tables).toEqual(
      expect.arrayContaining(['conversations', 'messages', 'file_tasks', 'peers', 'group_members'])
    )
    expect(db.prepare('PRAGMA user_version').get().user_version).toBe(1)
    db.close()
  })

  it('finds chinese text with a like query', () => {
    const db = openDatabase(tempDb())
    db.prepare(
      'INSERT INTO conversations (id, kind, title, created_at) VALUES (?, ?, ?, ?)'
    ).run('c1', 'direct', '测试会话', 1)
    db.prepare(
      'INSERT INTO messages (conversation_id, direction, kind, text, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('c1', 'in', 'text', '局域网文件传输', 'delivered', 1)
    const rows = db.prepare("SELECT id FROM messages WHERE text LIKE ?").all('%文件%')
    expect(rows).toHaveLength(1)
    db.close()
  })

  it('refuses a database from a newer schema version', () => {
    const file = tempDb()
    const db = openDatabase(file)
    db.exec('PRAGMA user_version = 99')
    db.close()
    expect(() => openDatabase(file)).toThrow(/更新版本/)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/main/store/db.test.ts`

Expected: FAIL，提示找不到 `./db`。

- [ ] **Step 3: 实现 schema 与打开逻辑**

`src/main/store/schema.ts` 导出 `SCHEMA_VERSION = 1` 与建表语句：设计文档第 8 节的全部表与索引。正文搜索使用 `LIKE`，首版不建 FTS5 虚拟表与触发器。

`src/main/store/db.ts`：

- `new DatabaseSync(file)`；执行 `PRAGMA journal_mode = WAL`、`PRAGMA foreign_keys = ON`、`PRAGMA busy_timeout = 5000`。
- 读取 `PRAGMA user_version`；大于 `SCHEMA_VERSION` 时关闭连接并抛出 `数据库由更新版本创建`。
- 等于 0 时在事务里建表并设置版本；等于 1 时跳过。
- 捕获打开失败，抛出带文件路径的可读错误。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run src/main/store/db.test.ts`

Expected: 3 passed。

- [ ] **Step 5: 提交**

```bash
git add src/main/store/db.ts src/main/store/schema.ts src/main/store/db.test.ts
git commit -m "feat: add sqlite schema and migrations"
```

---

### Task 3: IPC 契约与预加载桥

**Files:**

- Create: `src/shared/ipc.ts`
- Create: `src/main/ipc/handlers.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`
- Test: `src/main/ipc/handlers.test.ts`

**Interfaces:**

- Consumes: `SettingsStore`（Task 1）。
- Produces:
  - `IPC.appInfo = 'app:info'`、`IPC.settingsGet = 'settings:get'`、`IPC.settingsUpdate = 'settings:update'`
  - `interface AppInfo { name: string; version: string; platform: string; appId: string }`
  - `createHandlers(ctx: { settings: SettingsStore; appInfo: AppInfo }): Handlers`
  - `window.api.app.info(): Promise<AppInfo>`
  - `window.api.settings.get(): Promise<Settings>`
  - `window.api.settings.update(patch: SettingsPatch): Promise<Settings>`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SettingsStore } from '../settings/store'
import { createHandlers } from './handlers'

function context(): ReturnType<typeof createHandlers> {
  const file = join(mkdtempSync(join(tmpdir(), 'lanpost-ipc-')), 'settings.json')
  return createHandlers({
    settings: new SettingsStore(file),
    appInfo: { name: '内网传书', version: '0.1.0', platform: 'win32', appId: 'com.lanpost.im' }
  })
}

describe('ipc handlers', () => {
  it('returns app info', () => {
    expect(context().appInfo().appId).toBe('com.lanpost.im')
  })

  it('rejects an invalid settings patch', () => {
    expect(() => context().settingsUpdate({ files: { autoAcceptMaxMB: -1 } })).toThrow()
  })

  it('applies a valid patch', () => {
    const handlers = context()
    const next = handlers.settingsUpdate({ files: { autoAccept: true } })
    expect(next.files.autoAccept).toBe(true)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/main/ipc/handlers.test.ts`

Expected: FAIL，提示找不到 `./handlers`。

- [ ] **Step 3: 实现契约、处理器与预加载**

`src/shared/ipc.ts` 定义通道常量、`AppInfo`、`SettingsPatch` 与 `Handlers` 类型。

`src/main/ipc/handlers.ts` 提供纯函数处理器：`appInfo` 返回快照；`settingsGet` 返回设置；`settingsUpdate` 用 zod 校验补丁后调用 `SettingsStore.update`。另导出 `registerIpc(ipcMain, handlers)` 注册三个通道，注册函数只做转发。

`src/preload/index.ts` 用 `contextBridge.exposeInMainWorld('api', ...)` 暴露上述三个方法，不暴露其他 Electron API。`src/preload/index.d.ts` 声明 `window.api`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run src/main/ipc/handlers.test.ts`

Expected: 3 passed。

- [ ] **Step 5: 提交**

```bash
git add src/shared/ipc.ts src/main/ipc/handlers.ts src/main/ipc/handlers.test.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "feat: add typed ipc bridge"
```

---

### Task 4: 窗口、单实例与托盘骨架

**Files:**

- Create: `src/main/window.ts`
- Create: `src/main/tray.ts`
- Modify: `src/main/index.ts`

**Interfaces:**

- Consumes: `SettingsStore`（Task 1）、`registerIpc`（Task 3）。
- Produces:
  - `createMainWindow(): BrowserWindow`
  - `showMainWindow(): void`
  - `createTray(opts: { onShow: () => void; onQuit: () => void }): Tray`

- [ ] **Step 1: 实现窗口模块**

`src/main/window.ts` 创建 1080×720、最小 900×600 的窗口，`sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`，加载 electron-vite 的开发地址或者打包后的 `index.html`。关闭事件在 `closeToTray` 开启且未退出时调用 `event.preventDefault()` 并隐藏窗口。

- [ ] **Step 2: 实现托盘模块**

`src/main/tray.ts` 使用 `resources/icon.png` 创建托盘，菜单包含“打开主界面”“设置”“退出”。点击托盘显示窗口。“设置”通过 `mainWindow.webContents.send('ui:open-settings')` 通知渲染进程。退出前设置 `isQuitting`，让窗口关闭事件不再拦截。

- [ ] **Step 3: 接线与单实例**

`src/main/index.ts`：

- 在 `app.whenReady()` 之前申请单实例锁；第二次启动直接聚焦已有窗口。
- 初始化 `SettingsStore`（路径为 `join(app.getPath('userData'), 'settings.json')`）。
- 打开数据库（`join(app.getPath('userData'), 'lanpost.db')`）。
- 注册 IPC，创建窗口与托盘。
- `window-all-closed` 不退出进程；`before-quit` 设置退出标记。

- [ ] **Step 4: 人工验证**

Run: `pnpm dev`

Expected:

1. 窗口标题为“内网传书”，尺寸 1080×720。
2. 点击关闭按钮，窗口隐藏，进程仍在托盘。
3. 点击托盘图标，窗口重新显示。
4. 托盘菜单“退出”结束进程。
5. 再次启动应用时聚焦已有窗口，不产生第二个实例。

- [ ] **Step 5: 提交**

```bash
git add src/main/window.ts src/main/tray.ts src/main/index.ts
git commit -m "feat: add main window and tray"
```

---

### Task 5: 基础工程质量门

**Files:**

- Modify: `.github/workflows/build.yml`（已经存在，确认命令与产物路径）
- Modify: `README.md`（补充开发命令）

**Interfaces:**

- Consumes: Task 1 至 Task 4 的全部产出。
- Produces: 无。

- [ ] **Step 1: 本地执行完整检查**

Run:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Expected: 全部通过，`out/` 目录生成主进程、预加载与渲染进程产物。

- [ ] **Step 2: 验证打包配置**

Run: `pnpm build:unpack`

Expected: `dist/win-unpacked/lanpost-im.exe` 存在，启动后窗口正常。

- [ ] **Step 3: 推送后确认 CI**

推送标签 `v0.1.0` 后，GitHub Actions 的 `windows` 与 `linux-arm64` 两个任务都为绿色，Release 附件包含 exe、zip、deb、AppImage。

- [ ] **Step 4: 提交**

```bash
git add README.md .github/workflows/build.yml
git commit -m "chore: wire ci and document phase 0"
```

---

## 阶段退出条件

- 窗口可以启动、关闭到托盘、从托盘恢复、正常退出。
- 设置修改后重启仍然生效，坏文件自动备份。
- 数据库自动建表，中文两字词搜索可用，版本更高时拒绝打开。
- 渲染进程通过 `window.api` 读取设置与修改设置，非法入参被拒绝。
- `pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过。
- CI 两个平台任务通过，Release 产物齐全。
