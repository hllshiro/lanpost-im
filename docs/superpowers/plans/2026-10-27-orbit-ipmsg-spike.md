# Orbit + 最小 IPMSG 技术验证 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Orbit desktop 底座上增加 IPMSG 发现、点对点文本和文件通道，验证技术链路可行，不改 Orbit UI 风格、不做中文、不做旧数据迁移。

**Architecture:** 新建 `spike/orbit` 目录承载 Orbit desktop + shared；主进程在 Orbit 自己的 `SocketManager`/`TransferManager` 之外并列启动一个 `IpmsgTransport`，由 `transport` 字段路由联系人和消息。IPMSG 联系人独立存储为 `ipmsg:<ip>|<account>`，不合并、不进群。

**Tech Stack:** Electron 32 + 原生 JavaScript + better-sqlite3（Orbit 原栈）；IPMSG 核心用 TypeScript 编写、编译为 CommonJS 供主进程 require；IPMSG 测试用 Vitest。

**Spec:** `docs/superpowers/specs/2026-10-27-orbit-ipmsg-design.md`

## Global Constraints

- Phase 0 只做技术验证；不做 i18n、不做中文、不改 Orbit UI 风格。
- 平台：Windows 与 Linux；Phase 0 至少各启动一次。最终打包矩阵在 Phase 1 验证。
- IPMSG 只做：用户发现、1:1 文本、1:1 文件；不做群聊、目录、图片、密封、广播、加密。
- IPMSG 联系人与 Orbit 联系人分开；不合并、不迁移旧 0.1.x 数据。
- IPMSG 联系人不进 Orbit 群聊；群成员选择器必须过滤。
- IPMSG 文件 Phase 0 自动接收到独立目录，减少接收 UI 适配。
- IPMSG 端口 2425（UDP/TCP）；Orbit 端口 45678（UDP 发现）/ 46000（TCP）保持不变。
- 保留 Orbit MIT LICENSE 与归属说明；Phase 0 不添加上游 git remote/submodule。
- 不改 `main` 分支；实验只在 `spike/orbit-ipmsg`。
- 所有提交遵循仓库现有的中文/英文 commit 风格，阶段结束前保持 `main` 不受影响。

## Review Focus

- IPMSG 对端离线、重启、IP 变化后，联系人状态和消息是否仍能正确恢复。
- UTF-8/GBK 文本、emoji、文件中文名是否在 Orbit 消息 UI 中正常显示。
- IPMSG 文件自动接收的路径、同名文件、路径穿越和取消/失败状态。
- Orbit 联系人与 IPMSG 联系人的发送路由是否互相串线；IPMSG 联系人不能误入群聊。
- 2425 端口被占用、防火墙未放行、Orbit 与 IPMSG 同时启动时的失败提示和降级行为。

---

### Task 1: 导入 Orbit desktop 并建立可运行基线

**Files:**
- Create: `spike/orbit/README.md`
- Create: `spike/orbit/.gitignore`
- Create: `spike/orbit/desktop/**`（复制自 `docs/3rd/Orbit-beta/desktop`，排除 `src/icons/screenshots`）
- Create: `spike/orbit/shared/**`（复制自 `docs/3rd/Orbit-beta/shared`）
- Create: `spike/orbit/LICENSE`（复制自 Orbit）
- Modify: `spike/orbit/desktop/package.json`
- Test: `spike/orbit/desktop/tests/e2e/navigation.spec.js`（Orbit 原有导航测试）

**Interfaces:**
- Produces: 可启动的 Orbit desktop 基线，使用 `spike/orbit/desktop` 作为 app 根目录；`shared` 位于同级目录，保持 Orbit 原有 `../../shared/...` 路径。
- Produces: `spike/orbit/README.md` 记录来源 commit、MIT 归属、启动命令和 Phase 0 范围。

- [ ] **Step 1: 复制 Orbit desktop/shared 到 spike 目录**

```bash
mkdir -p spike/orbit
cp -r docs/3rd/Orbit-beta/desktop spike/orbit/desktop
cp -r docs/3rd/Orbit-beta/shared spike/orbit/shared
cp docs/3rd/Orbit-beta/LICENSE spike/orbit/LICENSE
rm -rf spike/orbit/desktop/src/icons/screenshots spike/orbit/desktop/node_modules
```

- [ ] **Step 2: 写 spike README 和 .gitignore**

`spike/orbit/README.md` 至少包含：

```text
Orbit desktop from D4niel-dev/Orbit-beta, commit e947539, MIT.
Phase 0: Orbit desktop + minimal IPMSG transport.
No mobile, no i18n, no data migration.
Run: cd spike/orbit/desktop && npm install && npm start
```

`spike/orbit/.gitignore`：

```text
desktop/node_modules/
desktop/dist*/
desktop/src/icons/screenshots/
*.log
```

- [ ] **Step 3: 安装依赖并启动基线**

Run:

```bash
cd spike/orbit/desktop
npm install
npm start
```

Expected: Orbit 窗口启动，联系人/聊天/设置可见，无构建错误。

- [ ] **Step 4: 跑一个 Orbit 原有测试**

Run:

```bash
cd spike/orbit/desktop
npx playwright test tests/e2e/navigation.spec.js
```

Expected: PASS（若环境缺少 Playwright 浏览器，先执行 `npx playwright install chromium`）。

- [ ] **Step 5: 提交**

```bash
git add spike/orbit
git commit -m "spike: import Orbit desktop baseline"
```

---

### Task 2: 抽取可独立测试的 IPMSG 核心

**Files:**
- Create: `spike/orbit/desktop/lib/ipmsg/README.md`
- Create: `spike/orbit/desktop/lib/ipmsg/types.ts`
- Create: `spike/orbit/desktop/lib/ipmsg/protocol/commands.ts`
- Create: `spike/orbit/desktop/lib/ipmsg/protocol/packet.ts`
- Create: `spike/orbit/desktop/lib/ipmsg/protocol/entry.ts`
- Create: `spike/orbit/desktop/lib/ipmsg/protocol/encoding.ts`
- Create: `spike/orbit/desktop/lib/ipmsg/protocol/text.ts`
- Create: `spike/orbit/desktop/lib/ipmsg/protocol/attach.ts`
- Create: `spike/orbit/desktop/lib/ipmsg/protocol/engine.ts`
- Create: `spike/orbit/desktop/lib/ipmsg/files/client.ts`
- Create: `spike/orbit/desktop/lib/ipmsg/files/server.ts`
- Create: `spike/orbit/desktop/lib/ipmsg/files/names.ts`
- Create: `spike/orbit/desktop/lib/ipmsg/files/paths.ts`
- Create: `spike/orbit/desktop/lib/ipmsg/files/manager.ts`
- Create: `spike/orbit/desktop/lib/ipmsg/index.ts`
- Create: `spike/orbit/desktop/lib/ipmsg/tsconfig.json`
- Create: `spike/orbit/desktop/lib/ipmsg/vitest.config.mjs`
- Create: `spike/orbit/desktop/lib/ipmsg/test/engine.test.ts`
- Create: `spike/orbit/desktop/lib/ipmsg/test/manager.test.ts`
- Modify: `spike/orbit/desktop/package.json`

**Interfaces:**
- Produces: `IpmsgTransport`（`lib/ipmsg/index.ts`）：
  - `start(config: IpmsgConfig): Promise<void>`
  - `stop(): Promise<void>`
  - `getPeers(): IpmsgPeer[]`
  - `sendText(peerKey: string, text: string): number`
  - `requestFile(peerKey: string, paths: string[]): Promise<void>`
  - `acceptFile(id: string): void`
  - `rejectFile(id: string): void`
  - `cancelFile(id: string): void`
  - callbacks: `onPeers`, `onText`, `onFile`, `onLog`, `onError`
- Produces: `IpmsgPeer`：`{ key, ip, port, user, host, name, online, lastSeen }`
- Produces: `IpmsgText`：`{ peerKey, text, seq, utf8 }`
- Produces: `IpmsgFile`：与当前 `FileTaskInfo` 字段对齐的 `{ id, direction, name, size, path, state, received, error }`
- 编译产物：`lib/ipmsg/dist/**`（CommonJS），由 `npm run build:ipmsg` 生成。

- [ ] **Step 1: 复制并裁剪现有 IPMSG 源**

从当前项目复制：

```text
src/main/protocol/{commands,packet,entry,encoding,text,attach,engine,retransmit}.ts
src/main/files/{client,server,names,paths,layout,manager}.ts
```

到 `spike/orbit/desktop/lib/ipmsg/` 对应目录。删除目录流、图片、密封、广播、多播、主机列表等当前项目不需要的分支；把 `shared/domain` 的类型复制到 `lib/ipmsg/types.ts`，避免依赖当前仓库。

- [ ] **Step 2: 写 tsconfig 和测试配置**

`lib/ipmsg/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["**/*.ts"],
  "exclude": ["test/**"]
}
```

`lib/ipmsg/vitest.config.mjs`：

```js
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { include: ['lib/ipmsg/test/**/*.test.ts'], environment: 'node' }
})
```

在 `spike/orbit/desktop/package.json` 增加：

```json
"build:ipmsg": "tsc -p lib/ipmsg/tsconfig.json",
"test:ipmsg": "vitest run --config lib/ipmsg/vitest.config.mjs"
```

并加入 devDependencies：`vitest`、`typescript`、`@types/node`。

- [ ] **Step 3: 写失败的发现/文本测试**

`lib/ipmsg/test/engine.test.ts` 至少覆盖：

```ts
it('discovers a peer through a seed address', async () => { /* A/B 两个 transport，断言 B 出现在 A.getPeers() */ })
it('starts in away mode and still discovers peers', async () => { /* 启动 A 为 away，B 已在线，断言 A 收到 B */ })
it('sends text and receives delivery ack', async () => { /* A.sendText(B), 断言 B 的 onText 收到，A 消息状态 delivered */ })
it('decodes GBK text from a non-UTF8 peer', async () => { /* 断言中文不丢 */ })
```

Run:

```bash
cd spike/orbit/desktop
npm run test:ipmsg
```

Expected: FAIL（`IpmsgTransport` 尚未实现）。

- [ ] **Step 4: 实现 `IpmsgTransport` 最小接口**

在 `lib/ipmsg/index.ts` 组合 engine/files，暴露 Interfaces 中的方法。engine 只保留：

- UDP 发现和 Entry/AnsEntry/Absence/Exit
- 文本 SENDMSG/RECVMSG/重传/去重
- UTF-8/GBK
- 在线超时

文件 manager 只保留：

- 文件邀请、接收/拒绝、GETFILEDATA
- 自动接收（`autoAccept: true`）
- 取消

- [ ] **Step 5: 跑测试并构建**

```bash
cd spike/orbit/desktop
npm run test:ipmsg
npm run build:ipmsg
```

Expected: 测试 PASS；`lib/ipmsg/dist/index.js` 生成。

- [ ] **Step 6: 提交**

```bash
git add spike/orbit/desktop/lib/ipmsg spike/orbit/desktop/package.json spike/orbit/desktop/package-lock.json
git commit -m "spike: extract minimal ipmsg transport"
```

---

### Task 3: 主进程接入 IPMSG 与 IPC

**Files:**
- Create: `spike/orbit/desktop/lib/ipmsg/bridge.js`
- Modify: `spike/orbit/desktop/main.js`
- Modify: `spike/orbit/desktop/preload.js`
- Test: `spike/orbit/desktop/tests/unit/ipmsg-bridge.test.js`

**Interfaces:**
- Produces: `bridge.start(config, sendToRenderer)` / `bridge.stop()`
- Produces IPC:
  - `ipmsg-peer` main → renderer: `IpmsgPeer`
  - `ipmsg-text` main → renderer: `IpmsgText`
  - `ipmsg-file` main → renderer: `IpmsgFile`
  - `ipmsg-send-text` renderer → main: `(peerKey, text)`
  - `ipmsg-send-file` renderer → main: `(peerKey, filePath)`
  - `ipmsg-accept` / `ipmsg-reject` / `ipmsg-cancel` renderer → main
- Produces preload API:
  - `orbitAPI.ipmsgSendText(peerKey, text)`
  - `orbitAPI.ipmsgSendFile(peerKey, filePath)`
  - `orbitAPI.ipmsgAccept(id)` / `ipmsgReject(id)` / `ipmsgCancel(id)`
  - `orbitAPI.onIpmsgPeer(cb)` / `onIpmsgText(cb)` / `onIpmsgFile(cb)`

- [ ] **Step 1: 写 bridge 的失败测试**

`tests/unit/ipmsg-bridge.test.js` 用 fake transport 测：

```js
test('forwards peer and text events to renderer', () => { /* 断言 sendToRenderer 收到 ipmsg-peer/ipmsg-text */ })
test('routes sendText to the ipmsg transport only', () => { /* 断言 fake.sendText 调用一次，Orbit socket 不调用 */ })
test('auto-accepts incoming files in phase 0', () => { /* 断言 fake.acceptFile 被调用 */ })
```

Run: `node tests/unit/ipmsg-bridge.test.js`
Expected: FAIL。

- [ ] **Step 2: 实现 bridge**

`bridge.js` 以 CommonJS require `./ipmsg/dist`；配置来自 Orbit 当前用户：

```js
{
  name: currentIdentity.username,
  account: currentIdentity.userId,
  host: os.hostname(),
  port: 2425,
  receiveDir: path.join(app.getPath('downloads'), 'Orbit IPMSG')
}
```

主进程启动时同时启动 Orbit transport 和 IPMSG transport；任一失败只记录日志，不阻止 Orbit 启动。

- [ ] **Step 3: 接 IPC 和 preload**

在 `main.js` 注册 IPC；在 `preload.js` 暴露 `ipmsgSendText` 等 API。所有主进程 → renderer 事件使用 `mainWindow.webContents.send`。

- [ ] **Step 4: 运行 bridge 测试**

Run: `node tests/unit/ipmsg-bridge.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add spike/orbit/desktop/lib/ipmsg/bridge.js spike/orbit/desktop/main.js spike/orbit/desktop/preload.js spike/orbit/desktop/tests/unit/ipmsg-bridge.test.js
git commit -m "spike: bridge ipmsg transport into orbit main"
```

---

### Task 4: IPMSG 联系人、消息入库与文本收发

**Files:**
- Modify: `spike/orbit/desktop/src/js/database/database.js`
- Modify: `spike/orbit/desktop/src/js/store.js`
- Modify: `spike/orbit/desktop/src/js/app.js`
- Modify: `spike/orbit/desktop/src/js/views/sidebar-middle.js`
- Modify: `spike/orbit/desktop/src/js/views/chat-panel.js`
- Test: `spike/orbit/desktop/tests/unit/ipmsg-store.test.js`

**Interfaces:**
- `friends` 新增列：`transport TEXT NOT NULL DEFAULT 'orbit'`、`ipmsgAccount TEXT`、`ipmsgHost TEXT`、`lastIp TEXT`。
- `messages` 新增列：`transport TEXT NOT NULL DEFAULT 'orbit'`、`remoteId TEXT`、`remoteSeq INTEGER`、`deliveryStatus TEXT`。
- IPMSG 联系人 ID：`ipmsg:<ip>|<account>`。
- 渲染层 `store.handleIncomingPacket` 接收合成的 `MESSAGE` 包，`from` 为 IPMSG 联系人 ID。

- [ ] **Step 1: 写 schema/migration 测试**

```js
test('adds transport columns to existing database', () => { /* 打开旧 schema，运行迁移，断言 PRAGMA table_info 有 transport */ })
test('saves and reloads an ipmsg friend', () => { /* transport='ipmsg', lastIp 保留 */ })
test('stores an ipmsg message with remote seq', () => { /* messages.transport='ipmsg', remoteSeq 保留 */ })
```

Run: `node tests/unit/ipmsg-store.test.js`
Expected: FAIL。

- [ ] **Step 2: 实现数据库迁移和 store 处理**

- 在 `database.js` 的启动迁移中 `ALTER TABLE ... ADD COLUMN`，使用 `PRAGMA table_info` 防止重复。
- `saveFriend` / `addMessage` 支持新列。
- `app.js` 订阅 `orbitAPI.onIpmsgPeer`，创建/更新 friend 并 `store.setState`。
- `app.js` 订阅 `orbitAPI.onIpmsgText`，合成 `MESSAGE` 包并调用 `store.handleIncomingPacket`。
- `sidebar-middle.js` 显示 IPMSG 联系人（Orbit 原好友列表即可），标题旁加 `IPMSG` 小标签。
- `chat-panel.js` 对 IPMSG 联系人隐藏 typing/reaction/read receipt/群邀请/编辑按钮。

- [ ] **Step 3: 写文本发送测试**

```js
test('sends text through ipmsg API for ipmsg friends', () => { /* mock orbitAPI.ipmsgSendText，断言被调用，networkSend 未被调用 */ })
test('sends text through networkSend for orbit friends', () => { /* 反向断言 */ })
test('group send excludes ipmsg friends', () => { /* 群成员列表不含 transport='ipmsg' */ })
```

Run: `node tests/unit/ipmsg-store.test.js`
Expected: PASS。

- [ ] **Step 4: 手工双实例验证**

- 启动 Orbit 实例 A。
- 用当前 0.1.1 IPMSG 客户端或一个 IPMSG 测试脚本启动实例 B。
- 验证 B 出现在 A 联系人列表，标记 IPMSG；A→B、B→A 文本均正常；中文/emoji 正常。

- [ ] **Step 5: 提交**

```bash
git add spike/orbit/desktop/src/js/database/database.js spike/orbit/desktop/src/js/store.js spike/orbit/desktop/src/js/app.js spike/orbit/desktop/src/js/views/sidebar-middle.js spike/orbit/desktop/src/js/views/chat-panel.js spike/orbit/desktop/tests/unit/ipmsg-store.test.js
git commit -m "spike: persist ipmsg contacts and text"
```

---

### Task 5: IPMSG 文件发送与自动接收

**Files:**
- Modify: `spike/orbit/desktop/main.js`
- Modify: `spike/orbit/desktop/lib/ipmsg/bridge.js`
- Modify: `spike/orbit/desktop/src/js/app.js`
- Modify: `spike/orbit/desktop/src/js/views/chat-panel.js`
- Modify: `spike/orbit/desktop/src/js/database/database.js`
- Test: `spike/orbit/desktop/tests/unit/ipmsg-file.test.js`

**Interfaces:**
- `IpmsgFile` → renderer: `{ id, peerKey, direction, name, size, path, state, received, error }`
- Incoming complete → 生成一个 `MESSAGE` 包，`attachments: [{ id, type, name, size, path }]`，写入 Orbit `attachments` 表。
- Outgoing complete → 同样写入附件消息；Phase 0 不要求 Orbit transfer 弹窗，只要求消息气泡和文件可打开/定位。

- [ ] **Step 1: 写文件接收失败测试**

```js
test('auto-accepts an incoming ipmsg file', () => { /* fake 发出 offer，断言 acceptFile 调用 */ })
test('creates an attachment message after file completion', () => { /* 断言 messages/attachments 新增记录，path 存在 */ })
test('deduplicates filenames and blocks path traversal', () => { /* 断言 ../evil 被 sanitize，同名生成 (1) */ })
```

Run: `node tests/unit/ipmsg-file.test.js`
Expected: FAIL。

- [ ] **Step 2: 实现自动接收与附件消息**

- bridge 收到 file offer 直接 `acceptFile`。
- 接收完成发送 `ipmsg-file`；`app.js` 合成附件消息。
- 接收目录：`path.join(app.getPath('downloads'), 'Orbit IPMSG')`；启动时创建。
- 文件名复用当前项目 `names.ts`/`paths.ts` 的清洗和去重逻辑。

- [ ] **Step 3: 实现发送**

`chat-panel.js` 对 IPMSG 联系人调用 `orbitAPI.ipmsgSendFile(peerKey, filePath)`；bridge 调用 transport。发送完成生成附件消息。

- [ ] **Step 4: 跑测试 + 双实例文件验证**

- 测试 PASS。
- A→B 和 B→A 各传一个中文名文件；确认文件存在、可打开、同名不覆盖。
- 取消/拒绝路径至少手工验证一次。

- [ ] **Step 5: 提交**

```bash
git add spike/orbit/desktop/main.js spike/orbit/desktop/lib/ipmsg/bridge.js spike/orbit/desktop/src/js/app.js spike/orbit/desktop/src/js/views/chat-panel.js spike/orbit/desktop/src/js/database/database.js spike/orbit/desktop/tests/unit/ipmsg-file.test.js
git commit -m "spike: add ipmsg file transfer"
```

---

### Task 6: 能力降级与群聊隔离

**Files:**
- Modify: `spike/orbit/desktop/src/js/views/chat-panel.js`
- Modify: `spike/orbit/desktop/src/js/views/sidebar-middle.js`
- Modify: `spike/orbit/desktop/src/js/components/`（按需）
- Test: `spike/orbit/desktop/tests/e2e/ipmsg-capabilities.spec.js`

**Interfaces:**
- IPMSG 联系人：隐藏群邀请、typing、reaction、read receipt、编辑、E2EE 标记。
- 群成员选择器只接受 `transport === 'orbit'`。

- [ ] **Step 1: 写 Playwright 检查**

```js
test('ipmsg contact shows transport badge and hides orbit-only actions', async () => { /* 断言 IPMSG badge；typing/reaction 不存在 */ })
test('group member picker excludes ipmsg contacts', async () => { /* 断言群成员列表不含 ipmsg friend */ })
```

Run: `npx playwright test tests/e2e/ipmsg-capabilities.spec.js`
Expected: FAIL。

- [ ] **Step 2: 实现能力标记和过滤**

在联系人/聊天头部显示 `IPMSG` 标签；在 chat-panel 的按钮渲染处按 `friend.transport` 过滤；群成员 picker 过滤。

- [ ] **Step 3: 跑测试**

Run: `npx playwright test tests/e2e/ipmsg-capabilities.spec.js`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add spike/orbit/desktop/src/js/views/chat-panel.js spike/orbit/desktop/src/js/views/sidebar-middle.js spike/orbit/desktop/tests/e2e/ipmsg-capabilities.spec.js
git commit -m "spike: gate orbit-only features for ipmsg contacts"
```

---

### Task 7: Phase 0 验收与记录

**Files:**
- Modify: `spike/orbit/README.md`
- Modify: `docs/superpowers/specs/2026-10-27-orbit-ipmsg-design.md`（状态/结果）
- Test: `spike/orbit/desktop/lib/ipmsg/test/**`、`spike/orbit/desktop/tests/unit/**`、`spike/orbit/desktop/tests/e2e/**`

**Interfaces:**
- Produces: Phase 0 验收记录：启动、发现、文本、文件、Orbit↔Orbit 回归、Windows/Linux 结果、已知限制。

- [ ] **Step 1: 跑完整测试**

```bash
cd spike/orbit/desktop
npm run test:ipmsg
node tests/unit/ipmsg-bridge.test.js
node tests/unit/ipmsg-store.test.js
node tests/unit/ipmsg-file.test.js
npx playwright test tests/e2e/navigation.spec.js tests/e2e/ipmsg-capabilities.spec.js
```

Expected: 全部 PASS。

- [ ] **Step 2: Windows 启动和打包 smoke**

```bash
cd spike/orbit/desktop
npm run build:win
```

Expected: 生成 Orbit 安装包/目录产物，无构建错误（Phase 0 只验证，不一定上传）。

- [ ] **Step 3: Linux 启动 smoke**

在 Linux 环境或 CI 中：

```bash
cd spike/orbit/desktop
npm install
npm start
```

Expected: 窗口启动，无 IPMSG 端口绑定错误；若 2425 被占用，界面/日志有明确提示。

- [ ] **Step 4: 记录结果**

在 `spike/orbit/README.md` 写：

```text
Phase 0 result:
- Windows: ...
- Linux: ...
- IPMSG discovery/text/file: ...
- Orbit↔Orbit regression: ...
- Known issues: ...
```

更新设计文档状态为 `Phase 0 完成，待评估`。

- [ ] **Step 5: 提交**

```bash
git add spike/orbit/README.md docs/superpowers/specs/2026-10-27-orbit-ipmsg-design.md
git commit -m "spike: record phase 0 verification"
```

---

## Self-Review

- Spec coverage：Task 1–6 覆盖 Orbit 导入、IPMSG 发现/文本/文件、联系人/消息模型、能力降级和群聊隔离；Task 7 覆盖验收。i18n、旧数据迁移、Android、群聊离线明确不在 Phase 0。
- 类型一致性：`IpmsgPeer`/`IpmsgText`/`IpmsgFile`/`IpmsgTransport` 在 Task 2 定义，Task 3–5 复用；`transport` 字段统一为 `orbit`/`ipmsg`。
- Review Focus 每项都有对应测试或手工验证：离线/重启（Task 4）、编码（Task 2）、文件名/路径（Task 5）、发送串线（Task 4）、端口/防火墙（Task 7）。
