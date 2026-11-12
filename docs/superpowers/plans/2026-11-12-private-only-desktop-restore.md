# 私有协议唯一化 + v0.1.1 桌面能力恢复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除 IPMSG 兼容层，只保留内网通 NWT 私有协议；恢复 v0.1.1 除“拨号模式”外的桌面/系统集成能力；在私有协议支持范围内补齐消息与文件功能，不支持的写入文档。

**Architecture:** 私有通道由 `PrivateService` 承担：UDP 9011 发现/通告、临时或固定 UDP 口承载 ENet、TCP 9013/9014 承载文件与文件夹。新增 `PeerRegistry` 替代 `ProtocolEngine` 作为联系人状态源；`PrivateService` 的会话/资料回调直接驱动它。桌面能力从 v0.1.1 移植为独立模块（shortcuts、autostart、presence、firewall），通过 shared IPC 暴露给渲染层。

**Tech Stack:** Electron 44、Vue 3、TypeScript、Node 24、`node:sqlite`、Vitest 5、pnpm 12.15.0。

**Spec:** 用户 2026-11-12 指令 + v0.1.1 功能对比（本会话记录）；现有协议文档 `docs/nwt-private-protocol.md`、`docs/nwt-file-channel.md`、`docs/nwt-compatibility.md`、`docs/known-limits.md`。

## Global Constraints

- 不引入 IPMSG/飞秋/飞鸽兼容路径；不保留 `network.ipmsg` 开关和 2425 端口。
- 端口：发现 9011/UDP，ENet 默认 9012/UDP（占用时回退临时端口），文件 9013/TCP，文件夹 9014/TCP；实际端口以运行时为准。
- “拨号模式”不恢复。
- 所有新增设置项必须有默认值，旧 `settings.json` 缺字段时自动补默认值；不写数据迁移。
- 测试与源码同目录（`*.test.ts`），协议测试使用随机高端口，不使用 9011/9012/9013/9014/2425。
- 每个任务结束运行 `pnpm typecheck` 与相关单测；最终运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`。
- 不改动与本计划无关的渲染逻辑、样式变量和现有群聊/头像/表情/私有文件行为。

## Review Focus

- 私有通道在没有任何 IPMSG 广播时仍能发现同网段 lanpost 对端：验证 9011 通告、type 2 应答、`privateSeeds` 兜底。
- 真实内网通客户端仍能完成握手、文字、文件、文件夹、群聊：验证我们主动连接其 9011 通告，且不再依赖 2425。
- 现有会话键与历史记录不因移除 IPMSG 而丢失：私有资料到达时按 IP 复用旧 peer key。
- 防火墙修复覆盖私有端口且不会误删用户已有规则：Linux 只记录并删除自己添加的规则，Windows 按程序路径放行。
- 广播/多选只向私有会话已就绪的在线联系人发送，失败逐人上报，不把整批标成成功。

---

### Task 1: 全局快捷键

**Files:**
- Create: `src/main/shortcuts.ts`
- Create: `src/renderer/src/utils/accelerator.ts`
- Create: `src/renderer/src/utils/accelerator.test.ts`
- Create: `src/shared/settings.test.ts`
- Modify: `src/shared/settings.ts`（`shortcuts` schema、`DEFAULT_SHORTCUTS`）
- Modify: `src/shared/ipc.ts`、`src/preload/index.ts`、`src/main/ipc/handlers.ts`、`src/main/ipc/register.ts`
- Modify: `src/main/index.ts`、`src/main/window.ts`
- Modify: `src/renderer/src/components/SettingsOverlay.vue`

**Interfaces:**
- `DEFAULT_SHORTCUTS = { toggleWindow: 'Ctrl+Alt+W', openReceiveDir: 'Ctrl+Alt+R' }`
- `Settings['shortcuts'] = { enabled: boolean; toggleWindow: string; openReceiveDir: string }`
- `applyGlobalShortcuts(settings: Settings, handlers: ShortcutHandlers): ShortcutRegistration[]`
- `setShortcutRecording(active: boolean): void`
- `shortcutAvailable(accelerator: string): boolean`
- `unregisterGlobalShortcuts(): void`
- `toggleMainWindow(): void`
- `Api.shortcuts.setRecording(active): Promise<void>` / `available(accelerator): Promise<boolean>`

- [ ] **Step 1: 写快捷键纯函数测试**

`accelerator.test.ts` 覆盖：修饰键顺序 `Ctrl+Alt+Shift+W`、数字/F 键、方向键/空格映射、纯字母/仅修饰键/逗号/重复键返回 `null`、`Meta` 保留。断言使用 v0.1.1 同名用例。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/renderer/src/utils/accelerator.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 settings schema 与 accelerator**

在 `src/shared/settings.ts` 加 `shortcutsSchema`，默认值来自 `DEFAULT_SHORTCUTS`。移植 v0.1.1 的 `acceleratorFromKeyStroke(input: KeyStroke): string | null` 与 `KeyStroke` 类型。

- [ ] **Step 4: 实现主进程快捷键模块**

按 v0.1.1 `src/main/shortcuts.ts` 移植；`ShortcutAction = keyof typeof DEFAULT_SHORTCUTS`；录制期间 `globalShortcut.unregisterAll()`，结束后重注册。`shortcutAvailable` 注册空回调后立即释放。

- [ ] **Step 5: 接通 IPC 与主进程**

`IPC.shortcutsRecording = 'shortcuts:recording'`、`IPC.shortcutsAvailable = 'shortcuts:available'`；`createHandlers` 增加可选 `shortcutsSetRecording`/`shortcutsAvailable`；`registerIpc` 注册；preload 暴露。

在 `src/main/window.ts` 恢复 `toggleMainWindow()`，恢复 Windows/Linux `Menu.setApplicationMenu(null)`。在 `src/main/index.ts` 构造 `{ toggleWindow: toggleMainWindow, openReceiveDir: () => void appService.openReceiveDir() }`，窗口创建后应用，settings 变化时重应用，`will-quit` 释放。`AppService` 增加 `async openReceiveDir(): Promise<void>`（`mkdirSync` + `shell.openPath`）。

- [ ] **Step 6: 设置页快捷键分组**

移植 v0.1.1 SettingsOverlay 的 `shortcuts` 分类、录制按钮、清除/恢复默认、总开关和提示；录制时调用 `window.api.shortcuts.setRecording`，保存走现有 `pushPatch({ shortcuts: {...} })`。

- [ ] **Step 7: 验证并提交**

Run: `pnpm exec vitest run src/renderer/src/utils/accelerator.test.ts src/shared/settings.test.ts`
Run: `pnpm typecheck`
Expected: PASS。
Commit: `feat: restore global shortcuts`

---

### Task 2: 开机启动与最小化启动

**Files:**
- Create: `src/main/autostart.ts`
- Create: `src/main/autostart.test.ts`
- Modify: `src/shared/ipc.ts`、`src/preload/index.ts`、`src/main/ipc/handlers.ts`、`src/main/ipc/register.ts`
- Modify: `src/main/index.ts`、`src/main/window.ts`
- Modify: `src/renderer/src/components/SettingsOverlay.vue`

**Interfaces:**
- `applyStartAtLogin(enabled: boolean, ctx: AutostartContext): AutostartResult`
- `AutostartContext = { platform; execPath; appPath; isPackaged; configDir; appName; loginItem?: { set(options): void } }`
- `Api.settings.setStartAtLogin(enabled: boolean): Promise<Settings>`
- `createMainWindow(settings: SettingsStore, startHidden = false): BrowserWindow`

- [ ] **Step 1: 移植 autostart 测试**

覆盖 Windows 打包路径、开发模式 `appPath` 参数、macOS `openAsHidden`、注册失败错误、Linux `.desktop` 写入/删除、路径引号、禁用时也调用登录项、 unsupported 平台。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/main/autostart.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 移植 autostart 模块**

直接移植 v0.1.1 `src/main/autostart.ts`。Linux 使用 `configDir/autostart/lanpost-im.desktop`。

- [ ] **Step 4: 接线主进程与 IPC**

`createHandlers` 增加 `settingsStartAtLogin(enabled): Settings`，内部调用 `setStartAtLogin` 回调；失败时抛错并回滚设置。`registerIpc`/preload 暴露 `settings.setStartAtLogin`。设置页“开机启动”改用该 API，保留 busy/error 提示。

- [ ] **Step 5: 启动与窗口**

`index.ts` 构造 `AutostartContext`（Linux AppImage 取 `process.env.APPIMAGE`），启动时同步一次登录项；settings 变化时若 `general.startAtLogin` 变化则重新应用。`createMainWindow(settings, settings.get().general.startMinimized)`；`ready-to-show` 在 `startHidden` 时不显示，托盘仍创建。

- [ ] **Step 6: 验证并提交**

Run: `pnpm exec vitest run src/main/autostart.test.ts src/shared/settings.test.ts`
Run: `pnpm typecheck`
Commit: `feat: restore autostart and hidden launch`

---

### Task 3: 空闲自动离开

**Files:**
- Create: `src/main/presence.ts`
- Create: `src/main/presence.test.ts`
- Modify: `src/shared/domain.ts`（`AppEvent` 增加 `local-status`）
- Modify: `src/main/index.ts`、`src/main/app-service.ts`
- Modify: `src/renderer/src/stores/app.ts`

**Interfaces:**
- `IDLE_AWAY_SECONDS = 30 * 60`
- `resolveIdlePresence(idleSeconds, current, auto): PresenceDecision`
- `AppService.evaluateIdleStatus(idleSeconds: number): void`
- `AppEvent` 增加 `{ type: 'local-status'; status: number }`

- [ ] **Step 1: 移植 presence 测试**

覆盖阈值、在线→离开→恢复、持续空闲保持离开、手动忙碌不被覆盖、手动离开不被覆盖。

- [ ] **Step 2: 实现 presence 模块**

移植 v0.1.1 `src/main/presence.ts`。

- [ ] **Step 3: 接入 AppService**

增加 `autoPresence: AutoPresence | null`。`evaluateIdleStatus` 计算决策，状态变化时 `settings.update({ identity: { status } })` + `applySettings(settings)` + `emit({ type: 'local-status', status })`。手动状态变化时清除 `autoPresence`。

- [ ] **Step 4: 主进程定时器与渲染层事件**

`index.ts` 每 30 秒读取 `powerMonitor.getSystemIdleTime()` 并调用 `appService.evaluateIdleStatus`；`will-quit` 清理。`stores/app.ts` 处理 `local-status` 更新 `local.status`。

- [ ] **Step 5: 验证并提交**

Run: `pnpm exec vitest run src/main/presence.test.ts`
Run: `pnpm typecheck`
Commit: `feat: restore idle auto-away`

---

### Task 4: 接收目录布局与文件选择记忆

**Files:**
- Create: `src/main/files/layout.ts`
- Create: `src/main/files/layout.test.ts`
- Modify: `src/shared/settings.ts`（`files.receiveLayout`、`files.lastDialogDir`）
- Modify: `src/main/app-service.ts`
- Modify: `src/renderer/src/components/SettingsOverlay.vue`

**Interfaces:**
- `receiveFolder(base: string, layout: 'flat' | 'nickname', peerKey: string, peerName: string): string`
- `AppService` 私有方法 `receiveDirFor(peerKey: string, peerName: string): string`
- `lastDialogDir(): string | undefined` / `rememberDialogDir(dir: string): void`

- [ ] **Step 1: 移植 layout 测试**

覆盖 flat、昵称子目录、分隔符/空名/Windows 保留名回退。

- [ ] **Step 2: 实现 layout 模块与设置字段**

移植 v0.1.1 `src/main/files/layout.ts`；settings 增加 `receiveLayout` 默认 `flat`、`lastDialogDir` 默认 `''`。

- [ ] **Step 3: 应用到全部接收路径**

把 `handlePrivateFileOffer`、`registerImageTask`、`receiveGroupFile`、`receiveGroupFolder` 等处的 `join(this.receiveDir, peerName, ...)` 替换为 `this.receiveDirFor(peerKey, peerName)`。文件/文件夹名仍各自 `sanitizeFileName`。

- [ ] **Step 4: 文件对话框记忆**

在 `pickStaged`、`saveFileAs`、`pickAvatar`、`pickGroupAvatar` 的 `showOpenDialog/showSaveDialog` 传 `defaultPath: this.lastDialogDir()`；选择成功后 `rememberDialogDir(dirname(path))`。

- [ ] **Step 5: 设置页“接收目录结构”**

文件设置分组增加下拉框：`flat`（全部放在接收目录下）/ `nickname`（按联系人昵称建立子目录），保存走 `saveField('files', { receiveLayout })`。

- [ ] **Step 6: 验证并提交**

Run: `pnpm exec vitest run src/main/files/layout.test.ts src/shared/settings.test.ts`
Run: `pnpm typecheck`
Commit: `feat: restore receive folder layout`

---

### Task 5: 在线状态快捷切换与默认菜单

**Files:**
- Modify: `src/renderer/src/components/NavRail.vue`
- Modify: `src/renderer/src/App.vue`
- Modify: `src/renderer/src/stores/app.ts`
- Modify: `src/shared/ipc.ts`、`src/preload/index.ts`、`src/main/ipc/app-ipc.ts`、`src/main/app-service.ts`

**Interfaces:**
- `IPC.identityStatus = 'identity:status'`
- `Api.identity.setStatus(status: number): Promise<void>`
- `AppService.setStatus(status: number): void`（更新 settings、`applySettings`、emit `local-status`）

- [ ] **Step 1: 主进程 setStatus**

`AppService.setStatus` 校验 0/1/2，清理 `autoPresence`，写入 settings，调用 `applySettings`，emit `local-status`。`app-ipc` 注册，preload/shared 暴露。

- [ ] **Step 2: NavRail 状态菜单**

移植 v0.1.1 的状态点菜单：点击头像右下角状态点弹出“在线/忙碌/离开”，`Escape` 关闭，当前项打勾；`emit('status', status)`。`App.vue` 监听并调用 `store.setStatus`。

- [ ] **Step 3: store 更新**

`stores/app.ts` 增加 `setStatus`，调用 API 后更新 `local.status`；处理 `local-status` 事件。

- [ ] **Step 4: 验证并提交**

Run: `pnpm typecheck`
Commit: `feat: restore quick presence switcher`

---

### Task 6: 防火墙检测与修复

**Files:**
- Create: `src/main/firewall.ts`
- Create: `src/main/firewall.test.ts`
- Create: `build/installer.nsh`
- Create: `build/linux/after-install.sh`
- Create: `build/linux/after-remove.sh`
- Create: `scripts/firewall-dev.ps1`
- Modify: `src/shared/ipc.ts`、`src/preload/index.ts`、`src/main/ipc/handlers.ts`、`src/main/ipc/register.ts`
- Modify: `src/main/index.ts`、`src/main/app-service.ts`
- Modify: `src/renderer/src/components/SettingsOverlay.vue`
- Modify: `electron-builder.yml`、`package.json`

**Interfaces:**
- `checkFirewall(ports: FirewallPorts): Promise<FirewallStatus>`
- `repairFirewall(ports: FirewallPorts): Promise<FirewallStatus>`
- `FirewallPorts = { udp: number[]; tcp: number[] }`
- `AppService.firewallPorts(): FirewallPorts`（beacon、实际 ENet、文件、文件夹端口）
- `Api.firewall.check(): Promise<FirewallStatus>` / `repair(): Promise<FirewallStatus>`

- [ ] **Step 1: 写纯函数测试**

覆盖 `ruleNameOf(executable)`（`electron.exe` → `lanpost-im-dev`）、端口去重/过滤非法值、Linux ufw/firewalld 命令包含全部端口、记录文件行格式。

- [ ] **Step 2: 移植并改造 firewall 模块**

以 v0.1.1 `src/main/firewall.ts` 为基础：Windows 逻辑保持不变；Linux 从单端口改为 `FirewallPorts`，对每个 UDP/TCP 端口生成 ufw/firewalld 规则，仍写入 `/var/lib/lanpost-im/firewall-ports`，卸载只删除记录过的规则。`checkLinux` 记录文件按全部端口判断。

- [ ] **Step 3: 主进程与 IPC**

`AppService.firewallPorts()` 返回 `{ udp: [privatePort, privateEnetPortActual], tcp: [privateFilePort, privateFolderPort] }`，过滤 0。`createHandlers` 增加 `firewallCheck`/`firewallRepair` 回调；`registerIpc`/preload/shared 暴露。

- [ ] **Step 4: 设置页网络分组**

恢复 v0.1.1 防火墙行：状态标签 + 修复按钮 + 提示，调用 `window.api.firewall.check/repair`。

- [ ] **Step 5: 安装器与开发脚本**

恢复 `build/installer.nsh`（按程序路径放行/卸载删除，规则名 `lanpost-im`）；`electron-builder.yml` 的 nsis 恢复 `perMachine: true` 和 `include: build/installer.nsh`，deb/rpm 恢复 `afterInstall`/`afterRemove`。Linux 脚本针对 9011/UDP、9012/UDP、9013/TCP、9014/TCP 添加并记录规则。`package.json` 恢复 `"firewall:dev": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/firewall-dev.ps1"`。

- [ ] **Step 6: 验证并提交**

Run: `pnpm exec vitest run src/main/firewall.test.ts`
Run: `pnpm typecheck`
Commit: `feat: restore firewall diagnostics and repair`

---

### Task 7: 9011 私有发现通告

**Files:**
- Modify: `src/main/protocol/private/service.ts`
- Modify: `src/main/protocol/private/service.test.ts`
- Modify: `src/main/app-service.ts`
- Modify: `src/shared/settings.ts`（`network.privateEnetPort`）

**Interfaces:**
- `PrivateService.announce(): void`
- `PrivateService.refresh(): void`
- `PrivateService.localEnetPort(): number`（已有）
- `PrivateServiceOptions.broadcastIntervalMs?: number`
- `network.privateEnetPort` 默认 `9012`；绑定失败回退 `0` 并把实际端口写日志。

- [ ] **Step 1: 写发现测试**

`service.test.ts` 新增：
- 调用 `service.announce()` 后，假 peer 的 beacon socket 收到 304 字节、type 1、`enetPort === service.localEnetPort()`、`userId` 与配置一致的报文。
- 向 service 的 beacon 端口发送 type 1 后，假 peer 收到 type 2 应答，且 service 向该地址发起 CONNECT。
- 同一 userId 的自通告被忽略，不建立会话。

- [ ] **Step 2: 实现通告/应答/定时器**

`start()` 绑定 ENet 后绑定 9011；启动后立即 `announce()`，并按 `broadcastIntervalMs`（默认 30s）重复。`announce()` 向 `255.255.255.255`、各网卡广播地址、`privateSubnets`（如保留）发送 type 1。收到 type 1 时若非本机，建立会话并单播 type 2 应答；收到 type 2 只建立会话。`stop()` 清理定时器。`refresh()` = `announce()` + 重拨 seeds。

- [ ] **Step 3: 接入 AppService**

`startPrivateService` 传 `enetPort: settings.network.privateEnetPort` 和 `broadcastIntervalMs: settings.network.broadcastInterval * 1000`。`AppService.refreshPeers` 改为调用 `privateService.refresh()`（IPMSG 移除后）。

- [ ] **Step 4: 验证并提交**

Run: `pnpm exec vitest run src/main/protocol/private/service.test.ts src/main/protocol/private/beacon.test.ts`
Run: `pnpm typecheck`
Commit: `feat: announce private discovery on 9011`

---

### Task 8: 移除 IPMSG，切换到 PeerRegistry

**Files:**
- Create: `src/main/peers/registry.ts`
- Create: `src/main/peers/registry.test.ts`
- Modify: `src/main/app-service.ts`
- Modify: `src/main/index.ts`（如仍引用）
- Modify: `src/shared/settings.ts`
- Modify: `src/renderer/src/components/SettingsOverlay.vue`
- Delete: `src/main/protocol/discovery.ts`、`src/main/protocol/discovery.test.ts`
- Delete: `src/main/protocol/packet.ts`、`packet.test.ts`、`attach.ts`、`attach.test.ts`、`encoding.ts`、`encoding.test.ts`、`commands.ts`
- Delete: `src/main/files/manager.ts`、`client.ts`、`server.ts`、`transfer.test.ts`、`offer.test.ts`
- Modify/Delete: 引用上述模块的测试与文档

**Interfaces:**
- `PeerRegistry`：
  - `constructor(seed: PeerInfo[], callbacks: { onPeers(peers: PeerInfo[]): void })`
  - `upsertPrivatePeer(input: { ip; userId; name; group; corporation; department; sign; status; online }): PeerInfo | null`
  - `touchPrivatePeer(ip: string): void`
  - `markPrivatePeerOffline(ip: string): void`
  - `peerKeyForIp(ip: string): string | null`
  - `getPeers(): PeerInfo[]`
- key 策略：先用 `ip -> key` 命中现有记录（包括 DB 旧 key），否则 `${ip}|${userId}`；`port = 0`、`host = ''`、`corpId = ''`、`legacy = false`。

- [ ] **Step 1: 写 PeerRegistry 测试**

覆盖：种子按 IP 复用旧 key；新 peer 用 `${ip}|${userId}`；资料更新不改变 key；`getPeers` 返回副本；离线/在线/lastSeen 更新；`peerKeyForIp` 未知 IP 返回 null。

- [ ] **Step 2: 实现 PeerRegistry**

纯类，不依赖 Electron；`onPeers` 在每次变更后触发，排序与现有联系人一致（在线优先、名称拼音由渲染层处理，registry 只保证稳定顺序）。

- [ ] **Step 3: AppService 改为私有唯一通道**

- 构造：`this.registry = new PeerRegistry(this.repos.peers.list(), { onPeers: (peers) => this.handlePeers(peers) })`；删除 `this.engine`、`this.fileManager`、`this.filesStarted`。
- `start()`：只启动私有文件/文件夹/服务；`handlePeers(this.registry.getPeers())`。
- `handlePeers(peers: PeerInfo[])` 直接 upsert，不再 `toPeerInfo`。
- `sendText`：只允许私有会话；未就绪时 `ensureSession` 后抛“内网通私有会话未就绪，请稍后重试”。
- `sendFiles`：删除 IPMSG 分支，直接 `sendFilesPrivate`。
- `acceptFile/rejectFile`：只处理 `privateIncomingFiles`；其余抛“文件任务不存在”。
- `handleFileOffer`（标准）、`handleIncoming`（标准）、`handleStatus`（标准）删除；私有回调保留。
- `refreshPeers`：`privateService.refresh()` + `handlePeers(registry.getPeers())`。
- `applySettings`：不再调用 `engine.updateProfile/updateStatus`，只更新 `privateService` profile；状态变化通过 `broadcastChangeInfo`。
- `stop`：移除 fileManager/engine 停止，保留 privateFiles/privateFolders/privateService。
- `upsertPrivatePeer`/`handlePrivateStatus`/`handlePrivateState` 改用 registry。

- [ ] **Step 4: 移除 IPMSG 设置与 UI**

`network` schema 删除 `ipmsg`、`port`、`seeds`；`subnets` 若仅用于 IPMSG 广播则删除，私有发现改用 `privateSubnets`（如实现）或仅用网卡广播。设置页网络分组删除飞鸽兼容开关、2425 监听端口、广播间隔/种子/网段（或改为私有发现说明），保留监听地址、私有端口、私有种子。

- [ ] **Step 5: 删除 IPMSG 代码与测试**

删除上述文件；清理所有 import。保留 `protocol/xml.ts`、`protocol/private/*`、`files/private-*`、`folder-*`、`names.ts`、`staged.ts`。`files/manager` 删除后，`handleFileUpdate` 仍保留给私有文件任务。

- [ ] **Step 6: 更新文档**

`AGENTS.md`、`README.md`、`docs/known-limits.md`、`docs/nwt-private-protocol.md`、`docs/nwt-compatibility.md`、`docs/handoff.md` 删除 IPMSG/飞秋/飞鸽/2425 作为运行路径的描述，明确“只支持内网通私有协议”。历史说明可保留为“已移除”。

- [ ] **Step 7: 验证并提交**

Run: `pnpm typecheck`
Run: `pnpm test`
Expected: 所有保留测试通过；删除的 IPMSG 测试不存在。
Commit: `refactor: make NWT private protocol the only transport`

---

### Task 9: 广播与多选群发

**Files:**
- Modify: `src/shared/ipc.ts`、`src/preload/index.ts`、`src/main/ipc/app-ipc.ts`
- Modify: `src/main/app-service.ts`
- Modify: `src/renderer/src/components/ContactsPage.vue`
- Modify: `src/renderer/src/stores/app.ts`
- Create: `src/main/protocol/private/broadcast.ts` + test（纯选择逻辑）

**Interfaces:**
- `Api.messages.broadcast({ text }): Promise<{ count: number }>`
- `Api.messages.multicast({ peerKeys, text }): Promise<{ count: number }>`
- `eligibleTargets(peers: PeerInfo[], ready: (ip: string) => boolean): PeerInfo[]`：在线且私有会话就绪。
- `AppService.broadcastText(text): number` / `multicastText(peerKeys, text): number`

- [ ] **Step 1: 写选择逻辑测试**

覆盖离线/未就绪过滤、去重、空文本拒绝、保留输入顺序。

- [ ] **Step 2: 实现主进程广播**

逐个目标调用 `privateService.sendText`，为每个目标分配独立 `msgId`，在各自 direct conversation 记录 `insertOutgoing` + `trackPrivateSend`；失败的会话跳过并记录日志，返回成功数。空文本或 0 目标抛错。

- [ ] **Step 3: IPC 与渲染层**

`IPC.messageBroadcast`/`messageMulticast`；preload/shared/store。联系人页恢复“广播”“多选”按钮和底部输入框；多选模式在联系人行显示复选框；发送后清空并显示成功人数。

- [ ] **Step 4: 验证并提交**

Run: `pnpm exec vitest run src/main/protocol/private/broadcast.test.ts`
Run: `pnpm typecheck`
Commit: `feat: restore broadcast and multicast over private sessions`

---

### Task 10: 不支持的 NWT 能力文档

**Files:**
- Create: `docs/private-mode-gaps.md`
- Modify: `docs/known-limits.md`

- [ ] **Step 1: 记录结论**

表格列出：密封消息（NWT 无对应字段）、文件取消/拒绝对端通知（`OP` 取值未知，只有 OP=2 确认）、标准 IPMSG 已读回执（私有 1006 已覆盖）、标准目录流（私有文件夹通道已覆盖）、标准剪贴板附件（私有图片已覆盖）、联系人资料请求（握手/X_CHANGE_INFO 已覆盖）、拨号模式（明确不恢复）。每条写“现状/影响/后续验证方法”。

- [ ] **Step 2: 提交**

Commit: `docs: record NWT private-mode capability gaps`

---

### Task 11: 回归与构建

- [ ] **Step 1: 全量验证**

Run: `pnpm lint`
Run: `pnpm typecheck`
Run: `pnpm test`
Run: `pnpm build`
Expected: lint 0 error；typecheck 退出 0；所有测试通过；`out/` 生成。

- [ ] **Step 2: 两实例私有通道联调**

使用两个 `LANPOST_DATA_DIR`，分别设置不同的 `privatePort`/`privateEnetPort`/`privateFilePort`/`privateFolderPort`，并互相写入 `privateSeeds`。验证：自动发现（或种子直连）、文字收发、送达/已读、文件、文件夹、群聊；关闭其中一个实例后另一侧转为离线。记录结果到 `docs/private-mode-gaps.md` 的“验证记录”小节。

- [ ] **Step 3: 最终提交**

Commit: `test: verify private-only regression`

---

## Self-Review

- **Spec coverage:** 桌面集成 7 项（快捷键、防火墙、开机启动、最小化、空闲离开、接收布局、快捷状态/菜单）均有任务；拨号模式明确排除；消息文件功能按 NWT 支持情况拆分（广播/多选实现，其余文档）；IPMSG 移除由 Task 8 覆盖。
- **Step scan:** 每个任务有独立可运行的测试或类型检查；删除任务明确列出文件；没有“适当处理”这类空步骤。
- **Type consistency:** `FirewallPorts`、`PeerRegistry`、`ShortcutHandlers`、`eligibleTargets` 在首次定义处给出签名；后续任务引用同名类型。
- **Review Focus:** 私有发现、真实 NWT 兼容、旧 key 复用、防火墙规则安全、广播逐人失败均有对应测试或验证步骤。
- **Proportion:** 计划按能力分组，未复制实现代码；具体实现留给执行阶段。
