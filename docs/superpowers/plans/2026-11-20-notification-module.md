# 消息通知模块重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把通知重构成右下角置顶弹窗、托盘图标持续闪烁、可切换提示音三种方式，外加 Windows 托盘悬停未读列表与一键已读。

**Architecture:** 主进程 `NotificationManager` 是通知状态的唯一所有者：策略（policy）决定单条消息出哪些效果，`ToastList` 管弹窗的 10 秒/清除/锁屏队列，托盘闪烁由未读总数与窗口状态驱动。渲染侧通过查询参数分支渲染三个窗口形态（主窗口、Windows 弹窗窗口、悬停列表窗口），共用同一个 preload API。

**Tech Stack:** Electron 44 + Vue 3 + Pinia + TypeScript；Vitest（仅 Node 侧）；CDP 端到端脚本（`.dev-data/`，全部带超时）。

**Spec:** `docs/superpowers/specs/2026-11-19-notification-module-design.md`

## Global Constraints

- 验证顺序固定：`pnpm lint` → `pnpm typecheck` → `pnpm test`（52 文件 362 用例起步，只增不减）。
- 开发中不改 `package.json` 版本号；CHANGELOG 只加 `[未发布]` 段。
- 不引入原生模块；不写 mock、不写只为过测试的 workaround。
- 直接 import `electron` 的模块不能单测：纯逻辑抽成独立文件再测（`policy.ts`、`toast-list.ts`、`popup-layout.ts` 模式）。
- 所有新 e2e 脚本必须设置超时，禁止无限等待。
- 注释用中文，术语保留英文；Python 脚本不加 shebang、不加文件头 docstring。
- 中文提交信息，形如 `feat: xxx`、`fix: xxx`。
- 共享常量（弹窗/列表尺寸）放 `src/shared/ipc.ts`，主进程与渲染进程都从那里 import，禁止两侧各写一份数字。

## Review Focus

1. **锁屏期间到达的通知**：解锁后弹窗完整显示 10 秒，解锁后 3 秒内的窗口聚焦不清除它们——Task 4 的 `toast-list.test.ts` 与 manager 接线覆盖。
2. **同一会话连续来消息**：只刷新内容并重置计时，不叠多个弹窗——Task 4 `toast-list.test.ts` 的 upsert 用例覆盖。
3. **前台有焦点时**：声音、弹窗、闪烁、系统通知全部抑制，未读照常累计；失焦后恢复——Task 2 `policy.test.ts` 覆盖。
4. **闪烁条件**：仅未读 > 0 且窗口非活跃且 `notify.enabled`、`flashTaskbar` 开且不在勿扰时段——Task 3 `policy.test.ts` 的 `shouldBlink` 用例覆盖。
5. **10 秒到期**：只隐藏弹窗，未读、角标、闪烁状态不受影响——Task 4 `toast-list.test.ts`（expireDue 不触碰未读）与 Task 9 e2e 覆盖。
6. **一键已读**：水位线推进到每会话最新消息、私有会话回执走既有去重、事件广播后未读归零——Task 6 仓储与服务测试覆盖。
7. **弹窗窗口 `focusable: false` 下点击送达**：Task 9 e2e 用 CDP `Input.dispatchMouseEvent` 点击弹窗断言跳转；系统级投递行为由人工清单确认。

---

### Task 1: 提示音三选一

**Files:**
- Modify: `src/shared/settings.ts`（notifySchema）
- Modify: `src/main/settings/store.test.ts`
- Modify: `scripts/gen-assets.py`
- Create: `src/renderer/src/assets/notify-a.wav`、`notify-b.wav`、`notify-c.wav`（生成物，提交入库）
- Delete: `src/renderer/src/assets/notify.wav`
- Create: `src/renderer/src/utils/notify-sound.ts`
- Modify: `src/renderer/src/App.vue`
- Modify: `src/renderer/src/components/SettingsOverlay.vue`

**Interfaces:**
- Consumes: 无（本任务最先做）。
- Produces:
  - `settings.notify.soundPreset: 'a' | 'b' | 'c'`（默认 `'a'`），`settings.notify.soundFile` 字段删除。
  - `src/renderer/src/utils/notify-sound.ts` 导出 `NOTIFY_SOUNDS: Record<'a' | 'b' | 'c', string>`（三个 wav 的 import 结果）与 `playNotifySound(preset: 'a' | 'b' | 'c', volume: number): void`（内部 `new Audio` + `play().catch(() => undefined)`）。
  - App.vue 与 SettingsOverlay 都只通过该工具播音。

- [ ] **Step 1: 写失败的设置测试**

在 `src/main/settings/store.test.ts` 追加（沿用该文件已有的 store 构造方式）：

```ts
it('soundPreset 默认 a 且旧配置里的 soundFile 被忽略', () => {
  // 用包含 soundFile: 'builtin' 的原始 JSON 加载，不抛错
  const loaded = loadRaw({ notify: { soundFile: 'builtin' } })
  expect(loaded.notify.soundPreset).toBe('a')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/main/settings/store.test.ts`
Expected: FAIL（`soundPreset` 不存在）

- [ ] **Step 3: 改 schema**

`src/shared/settings.ts` notifySchema：删 `soundFile` 行，加 `soundPreset: z.enum(['a', 'b', 'c']).default('a')`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/main/settings/store.test.ts`
Expected: PASS

- [ ] **Step 5: 生成三个提示音资源**

`scripts/gen-assets.py` 在现有 `notify.wav` 段落处替换为三个合成段，参数抄 `.dev-data/sound-candidates/gen.py`（A：988→1319Hz 两声上行；B：1046.5→784Hz 钟声下行；C：1568Hz 单声），输出 `notify-a.wav`、`notify-b.wav`、`notify-c.wav`，删除对旧 `notify.wav` 的写入。删除仓库里的 `src/renderer/src/assets/notify.wav`。

Run: `python scripts/gen-assets.py && ls src/renderer/src/assets/`
Expected: 三个新 wav 存在，无 `notify.wav`

- [ ] **Step 6: 播音工具与调用方**

创建 `src/renderer/src/utils/notify-sound.ts`（签名见 Interfaces）。`App.vue`：删 `import notifySound`，改用 `playNotifySound`；`onNotify` 回调只保留播音（toast 显示的职责在 Task 4 移交列表通道，本任务先维持现状不动 toast 代码）；播音前 `const settings = await window.api.settings.get()` 取实时 `soundPreset` 与 `soundVolume`（这样切换后下一条消息立即生效，不等重启）。

- [ ] **Step 7: 设置界面**

`SettingsOverlay.vue` 通知区在「提示音」开关行之后新增一行：标签「提示音样式」，`<select>` 三项（`A 轻快两声` / `B 柔和门铃` / `C 清脆单声`），`@change` 里 `saveField('notify', { soundPreset: settings.notify.soundPreset })`；同一行加「试听」按钮，点击调 `playNotifySound(settings.notify.soundPreset, settings.notify.soundVolume)`。同时把「任务栏闪烁」行的标签改为「托盘图标闪烁」，hint 改为「窗口不在前台时托盘图标闪烁，直到未读清零」。

- [ ] **Step 8: 全量验证**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: 全过

- [ ] **Step 9: 提交**

```bash
git add -A
git commit -m "feat: 提示音三选一并支持试听"
```

---

### Task 2: 焦点与锁屏进入通知策略

**Files:**
- Modify: `src/main/notify/policy.ts`、`src/main/notify/policy.test.ts`
- Modify: `src/main/notify/manager.ts`
- Modify: `src/main/app-service.ts`（删 `setActiveConversation`，新增焦点/锁屏薄方法）
- Modify: `src/main/index.ts`（接 focus/blur 与 powerMonitor 锁屏事件）
- Modify: `src/shared/ipc.ts`、`src/preload/index.ts`、`src/renderer/src/App.vue`（删 `uiActiveConversation` 全链路）

**Interfaces:**
- Consumes: 无。
- Produces:
  - `policy.decideNotification` 入参去掉 `activeConversationId`；`windowFocused` 语义 = 窗口有焦点且未锁屏（由 manager 合并后传入）。
  - `manager.setLocked(locked: boolean): void`（本任务只设字段，锁屏弹窗队列在 Task 4 接）。
  - `app-service` 新增 `onWindowFocus(): void`、`onWindowBlur(): void`、`setScreenLocked(locked: boolean): void`，内部转发给 `notifications`。
  - `grep uiActiveConversation` 与 `grep setActiveConversation` 在 `src/` 下零结果。

- [ ] **Step 1: 写失败的策略测试**

`policy.test.ts` 追加（构造函数方式沿用现有用例）：

```ts
it('窗口有焦点时任意会话都只保留未读角标', () => {
  const decision = decideNotification({
    ...baseInput(),
    windowFocused: true,
    activeConversationId: 'other-conversation' // 实现后此字段已不存在，测试里直接删掉
  })
  expect(decision).toEqual({
    badge: true, sound: false, flash: false, system: false, toast: false
  })
})
```

同时把现有所有带 `activeConversationId` 的用例改写：焦点抑制用例不再区分会话，改为 `windowFocused: true` 即抑制；原有"焦点但不是当前会话 → 全部通知"的用例反转为抑制。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/main/notify/policy.test.ts`
Expected: FAIL（类型里还有 `activeConversationId`，新断言不成立）

- [ ] **Step 3: 改策略**

`policy.ts`：`NotificationInput` 删 `activeConversationId`；焦点早返回改为 `if (input.windowFocused) return decision`（decision 为 badge-only）。

- [ ] **Step 4: manager 合并锁屏状态**

`manager.ts`：加 `private locked = false` 与 `setLocked(locked: boolean)`；新增私有方法 `private isActive(): boolean { return (this.getWindow()?.isFocused() ?? false) && !this.locked }`；`notify()` 里 `decideNotification` 的 `windowFocused` 传 `this.isActive()`，删 `activeConversationId` 传参。删除 `setActiveConversation` 方法与字段。

- [ ] **Step 5: 删 activeConversation 全链路**

grep 定位并删除：`src/shared/ipc.ts` 的 `uiActiveConversation` 常量与 `Api.ui.setActiveConversation`；`src/preload/index.ts` 对应实现；main 侧 `ipcMain.on(IPC.uiActiveConversation)` 注册处；`app-service.setActiveConversation`；`App.vue` 里监听 `store.currentConversationId` 调 `setActiveConversation` 的整个 `watch`（`onSelectConversation` 的订阅保留）。`manager.setActiveConversation` 里的 `flashFrame(false)` 一并删除。

- [ ] **Step 6: 焦点与锁屏事件接线**

`index.ts` 在 `createMainWindow(...)` 之后接：

```ts
getMainWindow()?.on('focus', () => appService.onWindowFocus())
getMainWindow()?.on('blur', () => appService.onWindowBlur())
powerMonitor.on('lock-screen', () => appService.setScreenLocked(true))
powerMonitor.on('unlock-screen', () => appService.setScreenLocked(false))
```

`powerMonitor` 已在 index.ts 导入。`app-service` 三个薄方法只转发 `this.notifications.*`；`onWindowFocus/onWindowBlur` 在本任务里先只调 `this.notifications.refresh()`——`refresh()` 是 Task 3 的方法，本任务先在 manager 里放一个空实现（只记录，后续任务填充），保持每步可编译可测。

- [ ] **Step 7: 全量验证**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: 全过

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "feat: 前台焦点与锁屏统一抑制全部通知"
```

---

### Task 3: 托盘闪烁控制器

**Files:**
- Modify: `src/main/notify/policy.ts`、`src/main/notify/policy.test.ts`
- Modify: `src/main/notify/manager.ts`
- Modify: `src/main/tray.ts`
- Modify: `src/main/app-service.ts`（`applySettings` 里触发刷新）

**Interfaces:**
- Consumes: Task 2 的 `manager.isActive()`、`refresh()` 空实现、`inDndWindow`。
- Produces:
  - `policy.shouldBlink(input: { unread: number; active: boolean; settings: Settings; now?: Date }): boolean`。
  - `tray.setTrayBlinking(active: boolean): void`（500ms 未读图 ↔ 空图切换；重复调用同值无副作用）。
  - `manager.refresh(): void` 真实实现 = 重算闪烁状态；`manager.stop()` 停闪。
- [ ] **Step 1: 写失败的 shouldBlink 测试**

`policy.test.ts` 追加：

```ts
it('闪烁只在未读大于0、窗口非活跃、开关打开且不在勿扰时段时成立', () => {
  const settings = baseSettings() // 沿用文件里已有的 settings 构造
  expect(shouldBlink({ unread: 3, active: false, settings })).toBe(true)
  expect(shouldBlink({ unread: 0, active: false, settings })).toBe(false)
  expect(shouldBlink({ unread: 3, active: true, settings })).toBe(false)
  expect(shouldBlink({ unread: 3, active: false, settings: { ...settings, notify: { ...settings.notify, enabled: false } } })).toBe(false)
  expect(shouldBlink({ unread: 3, active: false, settings: { ...settings, notify: { ...settings.notify, flashTaskbar: false } } })).toBe(false)
  const inDnd = { ...settings, notify: { ...settings.notify, dnd: true, dndStart: '00:00', dndEnd: '23:59' } }
  expect(shouldBlink({ unread: 3, active: false, settings: inDnd, now: new Date('2026-11-20T12:00:00') })).toBe(false)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/main/notify/policy.test.ts`
Expected: FAIL（`shouldBlink` 未导出）

- [ ] **Step 3: 实现 shouldBlink**

`policy.ts` 导出 `shouldBlink`：`unread > 0 && !active && settings.notify.enabled && settings.notify.flashTaskbar && !inDndWindow(settings, input.now)`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/main/notify/policy.test.ts`
Expected: PASS

- [ ] **Step 5: tray 图元状态机**

`tray.ts`：模块级状态 `unreadCount`、`blinking`、`phase`、`blinkTimer`、`emptyImage = nativeImage.createEmpty()`；私有 `render()` 选图——`blinking ? (phase ? unreadImage : emptyImage) : (unreadCount > 0 ? unreadImage : normalImage)`；`setTrayBadge` 改为更新 count + tooltip 后调 `render()`；新增 `setTrayBlinking(active)`：值不变直接返回，开启时 `phase = true`、`setInterval(() => { phase = !phase; render() }, 500)`，关闭时清定时器并 `render()`；`destroyTray` 清定时器。

- [ ] **Step 6: manager 接闪烁状态**

`manager.ts`：字段 `private unread = 0`、`private blinkActive = false`、构造函数里 `setInterval(() => this.recomputeBlink(), 60_000)`（`unref()`，`stop()` 清除——60 秒周期兜底勿扰时段边界）。`setUnread(count)` 存字段并调 `recomputeBlink()`；`recomputeBlink()` 用 `shouldBlink({ unread: this.unread, active: this.isActive(), settings: this.settings.get() })`，结果与 `blinkActive` 不同才调 `setTrayBlinking`。`refresh()` 填充为 `this.recomputeBlink()`；`setLocked` 末尾补 `this.recomputeBlink()`（Task 2 的空壳在此接实）。`stop()` 里 `setTrayBlinking(false)`。删除 `notify()` 里的 `window?.flashFrame(true)` 与整个 `startIconFlash` 方法。

- [ ] **Step 7: 设置变更触发刷新**

`app-service.applySettings` 末尾加 `this.notifications.refresh()`。

- [ ] **Step 8: 全量验证**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: 全过

- [ ] **Step 9: 提交**

```bash
git add -A
git commit -m "feat: 托盘图标按未读持续闪烁"
```

---

### Task 4: 通知弹窗列表（纯逻辑 + 应用内渲染 + 跳转 + 聚焦清除 + 锁屏队列）

**Files:**
- Create: `src/main/notify/toast-list.ts`、`src/main/notify/toast-list.test.ts`
- Create: `src/renderer/src/components/NotifyToast.vue`
- Modify: `src/main/notify/manager.ts`
- Modify: `src/main/app-service.ts`（`clearToasts`、`jumpToConversation` 薄方法）
- Modify: `src/main/ipc/app-ipc.ts`（jump 通道注册）
- Modify: `src/shared/ipc.ts`、`src/preload/index.ts`
- Modify: `src/renderer/src/App.vue`

**Interfaces:**
- Consumes: Task 2 的 `manager.setLocked`、`isActive`；`IPC.uiSelectConversation`。
- Produces:
  - `src/shared/ipc.ts`：
    ```ts
    uiToastList: 'ui:toast-list',
    uiJumpToConversation: 'ui:jump-to-conversation',
    export interface NotifyToastItem { conversationId: string; title: string; body: string }
    export interface NotifyListPayload { toasts: NotifyToastItem[] }
    export const TOAST_LAYOUT = { width: 320, cardHeight: 64, gap: 8, padding: 16 } as const
    ```
  - `Api.ui` 新增 `onToastList(listener: (payload: NotifyListPayload) => void): () => void` 与 `jumpToConversation(conversationId: string): void`。
  - `ToastList`（纯类，`src/main/notify/toast-list.ts`）：
    ```ts
    export class ToastList {
      constructor(now?: () => number)
      upsert(conversationId: string, title: string, body: string, expiresAt: number | null): void
      releaseAll(ttlMs: number): void   // expiresAt 为 null 的项置为 now + ttlMs
      clearAll(): void
      expireDue(): NotifyToastItem[]    // 移除到期项并返回
      nextExpiry(): number | null       // 最近的非 null 到期时间戳
      snapshot(): NotifyToastItem[]     // 按插入序
    }
    ```
    `expiresAt === null` 表示锁屏挂起。
  - `manager` 新增 `clearToasts(): void`、`onWindowFocus(): void`；`setLocked` 扩展为含解锁释放。
  - `NotifyToast.vue`：props `{ toasts: NotifyToastItem[] }`，emit `jump(conversationId: string)`；固定右下角定位、卡片高 `TOAST_LAYOUT.cardHeight`。

- [ ] **Step 1: 写失败的 ToastList 测试**

`toast-list.test.ts`（用注入的假时钟）：

```ts
it('同会话重复通知只刷新内容并重置到期时间', () => {
  let now = 0
  const list = new ToastList(() => now)
  list.upsert('c1', '张三', '第一条', 10_000)
  now = 5_000
  list.upsert('c1', '张三', '第二条', 15_000)
  expect(list.snapshot()).toEqual([{ conversationId: 'c1', title: '张三', body: '第二条' }])
  expect(list.nextExpiry()).toBe(15_000)
  now = 10_000
  expect(list.expireDue()).toEqual([])
  now = 15_000
  expect(list.expireDue()).toHaveLength(1)
  expect(list.snapshot()).toEqual([])
})

it('挂起项到期时间为 null，releaseAll 后按新时限计时', () => {
  let now = 0
  const list = new ToastList(() => now)
  list.upsert('c1', '张三', '锁屏时来的', null)
  expect(list.nextExpiry()).toBeNull()
  expect(list.expireDue()).toEqual([])
  now = 60_000
  list.releaseAll(10_000)
  expect(list.nextExpiry()).toBe(70_000)
  now = 70_000
  expect(list.expireDue()).toHaveLength(1)
})

it('clearAll 清空且不影响其他状态', () => {
  const list = new ToastList(() => 0)
  list.upsert('c1', 'a', 'b', 10_000)
  list.clearAll()
  expect(list.snapshot()).toEqual([])
  expect(list.nextExpiry()).toBeNull()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/main/notify/toast-list.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 ToastList**

按 Interfaces 签名实现；`upsert` 对已存在的 `conversationId` 覆盖 title/body 并替换 `expiresAt`（不新增条目）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/main/notify/toast-list.test.ts`
Expected: PASS

- [ ] **Step 5: shared/preload 契约**

按 Interfaces 加 `IPC.uiToastList`、`IPC.uiJumpToConversation`、`NotifyToastItem`、`NotifyListPayload`、`TOAST_LAYOUT`；preload 实现 `onToastList`（`ipcRenderer.on` + 返回解绑，照抄 `onNotify` 写法）与 `jumpToConversation`（`ipcRenderer.send`）。

- [ ] **Step 6: manager 弹窗状态机**

`manager.ts`：
- 字段 `private toastList = new ToastList()`、`private toastTimer: ReturnType<typeof setTimeout> | null = null`、`private ignoreFocusUntil = 0`，常量 `TOAST_TTL_MS = 10_000`。
- `notify()` 中 `decision.toast` 为真时：`this.toastList.upsert(input.conversationId, input.title, input.body, this.locked ? null : Date.now() + TOAST_TTL_MS)`，然后 `scheduleToastTimer()` + `pushToasts()`。声音走既有 `IPC.uiNotify` 通道不变（仅 `decision.sound` 时发）；删掉 `decision.toast` 参与 `uiNotify` 发送的条件（改 `if (decision.sound && window !== null)`）。
- 私有 `scheduleToastTimer()`：清旧定时器，`nextExpiry()` 非空则 `setTimeout` 到期后 `expireDue()`、非空才 `pushToasts()`、再调度，`unref()`。
- 私有 `pushToasts()`：`window?.webContents.send(IPC.uiToastList, { toasts: this.toastList.snapshot() })`（Task 5 会在这里加平台分支）。
- `onWindowFocus()`：`if (this.locked || Date.now() < this.ignoreFocusUntil) return`；否则 `clearAll()` + `pushToasts()`；末尾 `this.recomputeBlink()`。
- `setLocked(locked)`：置字段；解锁时 `releaseAll(TOAST_TTL_MS)`、`ignoreFocusUntil = Date.now() + 3000`、`scheduleToastTimer()`、`pushToasts()`；末尾 `recomputeBlink()`。
- `clearToasts()`：`clearAll()` + 清定时器 + `pushToasts()`。
- `stop()`：清 toast 定时器。

- [ ] **Step 7: 服务与 IPC 薄方法**

`app-service` 加 `clearToasts(): void { this.notifications.clearToasts() }`。`app-ipc.ts` 注册：

```ts
ipcMain.on(IPC.uiJumpToConversation, (_event, conversationId: string) => {
  service.clearToasts()
  showMainWindow()
  getMainWindow()?.webContents.send(IPC.uiSelectConversation, conversationId)
})
```

（`showMainWindow` 从 `../window` 导入。）

- [ ] **Step 8: 渲染端**

新建 `src/renderer/src/components/NotifyToast.vue`（样式参考被删的 `.notify-toast`：白卡、圆角、阴影、标题 + 单行省略正文，定位改为 `position: fixed; right: 20px; bottom: 20px`，卡片高由 `TOAST_LAYOUT` 常量约束）。`App.vue`：
- 删 `toast` ref、`toastTimer`、`openToast`、模板里 `.notify-toast` 按钮与相关样式。
- `onNotify` 回调只剩播音（Task 1 已改）。
- 新增 `toastList = ref<NotifyToastItem[]>([])`，`onMounted` 里订阅 `window.api.ui.onToastList(payload => { toastList.value = payload.toasts })`，`onBeforeUnmount` 解绑。
- 模板加 `<NotifyToast :toasts="toastList" @jump="handleToastJump" />`，`handleToastJump(conversationId: string)` 函数体调 `window.api.ui.jumpToConversation(conversationId)`（模板里不能直接写 `window`，必须走具名函数，与现有风格一致）。
- Linux 主窗口隐藏时列表照常推送但不可见，用户聚焦主窗口即触发清除——无需额外分支（这正是设计的弱化行为）。

- [ ] **Step 9: 全量验证**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: 全过（新增 toast-list 用例）

- [ ] **Step 10: 提交**

```bash
git add -A
git commit -m "feat: 右下角通知弹窗与锁屏队列"
```

---

### Task 5: Windows 独立置顶弹窗窗口

**Files:**
- Create: `src/main/notify/toast-window.ts`
- Create: `src/renderer/src/ToastHost.vue`
- Modify: `src/renderer/src/main.ts`（查询参数分支）
- Modify: `src/main/notify/manager.ts`（push 平台分支）
- Modify: `src/main/index.ts`（退出时销毁）

**Interfaces:**
- Consumes: Task 4 的 `NotifyToast.vue`、`TOAST_LAYOUT`、`NotifyListPayload`、`pushToasts()`。
- Produces:
  - `toast-window.ts`（模块级单例，模式照 `tray.ts`）：
    ```ts
    export function pushToastWindow(items: NotifyToastItem[]): void  // 空数组 → 隐藏
    export function destroyToastWindow(): void
    ```
  - `main.ts` 分支：`?window=toast` 渲染 `ToastHost.vue`。
  - `manager.pushToasts()`：`process.platform === 'win32'` 走 `pushToastWindow`，否则发主窗口。

- [ ] **Step 1: ToastHost 渲染组件**

`src/renderer/src/ToastHost.vue`：订阅 `onToastList`，渲染 `<NotifyToast>`，`jump` 时调 `window.api.ui.jumpToConversation($event)`（跳转会聚焦主窗口，主进程侧弹窗随聚焦清除而清空）。页面 body 透明、无边距。

- [ ] **Step 2: main.ts 分支**

```ts
const kind = new URLSearchParams(window.location.search).get('window')
const root = kind === 'toast' ? ToastHost : App
createApp(root).use(createPinia()).mount('#app')
```

（pinia 对 ToastHost 无害，保留统一 `.use`。）

- [ ] **Step 3: toast-window.ts**

创建 `src/main/notify/toast-window.ts`：
- `ensureToastWindow()`：懒创建，`new BrowserWindow({ width: TOAST_LAYOUT.width, height: 计算值, show: false, frame: false, transparent: true, resizable: false, alwaysOnTop: true, focusable: false, skipTaskbar: true, hasShadow: false, webPreferences: { preload, sandbox: true, contextIsolation: true } })`，加载 `?window=toast`（dev 用 `ELECTRON_RENDERER_URL + '/?window=toast'`，prod 用 `loadFile(html, { search: '?window=toast' })`，写法照 `window.ts:104-108`）。
- `pushToastWindow(items)`：`items.length === 0` → `hide()`；否则高度 = `items.length * TOAST_LAYOUT.cardHeight + (items.length - 1) * TOAST_LAYOUT.gap + TOAST_LAYOUT.padding * 2`，`x = workArea.x + workArea.width - width - 16`，`y = workArea.y + workArea.height - height - 16`（`screen.getPrimaryDisplay().workArea`），`setBounds` → `webContents.send(IPC.uiToastList, { toasts: items })` → `showInactive()`。
- `destroyToastWindow()`：`destroy()`。
- 只在 win32 被调用（manager 分支保证），无需内部平台判断。

- [ ] **Step 4: manager 分支与销毁**

`manager.pushToasts()` 改为：`if (process.platform === 'win32') { pushToastWindow(this.toastList.snapshot()); return }` 后接原主窗口发送。`index.ts` 的 `will-quit` 里 `destroyTray()` 旁加 `destroyToastWindow()`。

- [ ] **Step 5: 手工冒烟（Windows）**

Run: `pnpm dev`，用另一个实例发一条消息。
Expected: 屏幕右下角出现独立弹窗（不在主窗口内），不抢焦点，10 秒消失；点击弹窗跳转会话；回软件主窗口时弹窗立即清空。

- [ ] **Step 6: 全量验证与提交**

Run: `pnpm lint && pnpm typecheck && pnpm test`

```bash
git add -A
git commit -m "feat: Windows 右下角独立置顶弹窗"
```

---

### Task 6: 一键已读

**Files:**
- Modify: `src/main/store/repositories.ts`、`src/main/store/repositories.test.ts`
- Modify: `src/main/app-service.ts`
- Modify: `src/main/ipc/app-ipc.ts`
- Modify: `src/shared/ipc.ts`、`src/preload/index.ts`

**Interfaces:**
- Consumes: Task 4 的 `manager.clearToasts()`。
- Produces:
  - `conversations.unreadIds(): string[]`（`SELECT id FROM conversations WHERE unread > 0`）。
  - `messages.latestId(conversationId: string): number | null`（`SELECT MAX(id) FROM messages WHERE conversation_id = ?`）。
  - `app-service.markAllRead(): void`。
  - `Api.conversations.markAllRead(): Promise<void>`，通道 `IPC.conversationReadAll: 'conversation:read-all'`。

- [ ] **Step 1: 写失败的仓储测试**

`repositories.test.ts` 追加（沿用文件里已有的会话/消息构造方式）：

```ts
it('markAllRead 语义：unreadIds 返回有未读的会话，latestId 返回最新消息', async () => {
  // 两个会话，A 有 2 条未读、B 无未读
  expect(messagesRepo(conversationsRepo).unreadIds ... ) // 按该文件实际的仓库引用方式写
  expect(conversations.unreadIds()).toEqual([a.id])
  expect(messages.latestId(a.id)).toBe(secondA.id)
  expect(messages.latestId(emptyConversation.id)).toBeNull()
})
```

（测试体按该文件现有的仓库实例引用方式落地，断言以三个为准：`unreadIds` 只含有未读的会话、`latestId` 返回最大 id、空会话返回 `null`。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/main/store/repositories.test.ts`
Expected: FAIL（方法不存在）

- [ ] **Step 3: 实现两个仓储方法**

按 Interfaces 的 SQL 实现，风格照 `markRead`/`touch`。

- [ ] **Step 4: 服务层 markAllRead**

`app-service.markAllRead()`：

```ts
markAllRead(): void {
  for (const id of this.repos.conversations.unreadIds()) {
    const latest = this.repos.messages.latestId(id)
    if (latest === null) continue
    this.markRead(id, latest) // 复用：回执去重 + 仓储 + 事件 + setUnread
  }
  this.notifications.setUnread(this.unreadTotal())
  this.notifications.clearToasts()
}
```

- [ ] **Step 5: IPC 通道**

`ipc.ts` 加 `conversationReadAll: 'conversation:read-all'` 与 `Api.conversations.markAllRead()`；`app-ipc.ts` `ipcMain.handle(IPC.conversationReadAll, () => service.markAllRead())`；preload 实现。

- [ ] **Step 6: 全量验证与提交**

Run: `pnpm lint && pnpm typecheck && pnpm test`

```bash
git add -A
git commit -m "feat: 一键已读"
```

---

### Task 7: 托盘悬停未读列表窗口（Windows）

**Files:**
- Create: `src/main/notify/popup-layout.ts`、`src/main/notify/popup-layout.test.ts`
- Create: `src/main/notify/tray-popup.ts`
- Create: `src/renderer/src/TrayPopup.vue`
- Modify: `src/main/tray.ts`（TrayActions 加 hover 回调）
- Modify: `src/main/index.ts`（接线）
- Modify: `src/main/app-service.ts`（`emit` 广播到所有窗口；`unreadConversationCount`）
- Modify: `src/main/notify/manager.ts`（`setUnread` 末尾联动列表显隐）
- Modify: `src/main/ipc/app-ipc.ts`（jump 后收起列表）
- Modify: `src/shared/ipc.ts`、`src/preload/index.ts`、`src/renderer/src/main.ts`

**Interfaces:**
- Consumes: Task 6 的 `conversations.markAllRead()`；Task 4 的 `IPC.uiJumpToConversation`；`TOAST_LAYOUT` 同文件的 `TRAY_POPUP` 常量。
- Produces:
  - `src/shared/ipc.ts`：
    ```ts
    uiPopupResize: 'ui:popup-resize',
    uiPopupLeave: 'ui:popup-leave',
    export const TRAY_POPUP = { width: 300, rowHeight: 56, footerHeight: 48, maxHeight: 380, padding: 12 } as const
    ```
    `Api.ui` 增 `popupResize(request: { height: number }): void` 与 `popupLeave(): void`（均为 renderer→main `send`）。
  - `popup-layout.ts`（纯函数，可单测）：
    ```ts
    export function computeTrayPopupBounds(
      trayBounds: Rectangle, workArea: Rectangle, rows: number
    ): { x: number; y: number; width: number; height: number }
    ```
    高度 = `min(rows * rowHeight + footerHeight + padding * 2, maxHeight)`；贴托盘图标上方（`y = trayBounds.y - height - 8`），右缘不超出 `workArea` 右边界且与托盘右缘对齐（钳制在 workArea 内）。
  - `tray.ts` `TrayActions` 增 `onHoverEnter: () => void`、`onHoverLeave: () => void`，`createTray` 里 `tray.on('mouse-enter', ...)` / `tray.on('mouse-leave', ...)`。
  - `tray-popup.ts`：`ensureTrayPopup(rows: number)`、`showTrayPopup()`、`hideTrayPopup()`、`onTrayLeave()`（200ms 后用 `screen.getCursorScreenPoint()` 复查光标同时离开托盘与列表才真隐藏）、`destroyTrayPopup()`、`setPopupUnreadCount(count: number)`（0 时隐藏）。
  - `main.ts` 分支：`?window=tray-popup` 渲染 `TrayPopup.vue`。
  - `Api.ui.onPopupResize` 不需要；新增 renderer→main 的 `ui:popup-resize`（`ipcRenderer.send(IPC.uiPopupResize, { height })`），main 重设 bounds（保持底边不动）。

- [ ] **Step 1: 写失败的布局测试**

`popup-layout.test.ts`：

```ts
it('列表贴托盘上方且不超出工作区', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 }
  const tray = { x: 1880, y: 1040, width: 24, height: 24 } // 托盘在右下角
  const bounds = computeTrayPopupBounds(tray, workArea, 3)
  expect(bounds.width).toBe(TRAY_POPUP.width)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(workArea.x + workArea.width)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(tray.y - 8 + 0.001) // 在托盘上方
  expect(bounds.height).toBe(3 * TRAY_POPUP.rowHeight + TRAY_POPUP.footerHeight + TRAY_POPUP.padding * 2)
})

it('行数很多时高度封顶', () => {
  const bounds = computeTrayPopupBounds({ x: 1880, y: 1040, width: 24, height: 24 }, { x: 0, y: 0, width: 1920, height: 1040 }, 50)
  expect(bounds.height).toBe(TRAY_POPUP.maxHeight)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/main/notify/popup-layout.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 computeTrayPopupBounds 并跑通**

按签名实现；跑测试到 PASS。

- [ ] **Step 4: 事件广播**

`app-service.emit` 从 `this.window?.webContents.send(...)` 改为遍历 `BrowserWindow.getAllWindows()` 逐个 `webContents.send`（弹窗窗口靠这个拿到会话更新；未订阅的窗口收到即忽略）。`app-service` 需导入 `BrowserWindow`。

- [ ] **Step 5: tray hover 接线**

`tray.ts`：`TrayActions` 加 `onHoverEnter`/`onHoverLeave`，`createTray` 注册两个事件。`index.ts` 的 `createTray({...})` 传 `onHoverEnter: () => showTrayPopup()`、`onHoverLeave: () => onTrayLeave()`（导入 `tray-popup` 模块）。

- [ ] **Step 6: tray-popup 控制器**

`tray-popup.ts`：
- `ensureTrayPopup(rows)` 懒创建窗口：`width: TRAY_POPUP.width, height: computeTrayPopupBounds(...).height, show: false, frame: false, transparent: true, resizable: false, alwaysOnTop: true, focusable: false, skipTaskbar: true, hasShadow: false`，加载 `?window=tray-popup`（dev/prod 写法同 Task 5）。
- 行数来源：index.ts 传入回调 `getUnreadRows: () => appService.unreadConversationCount()`——`app-service` 新增 `unreadConversationCount()`（`repos.conversations.unreadIds().length`）。
- `showTrayPopup()`：`rows === 0` 直接返回；`ensure` → `setBounds(computeTrayPopupBounds(tray.getBounds(), workArea, rows))` → `showInactive()`（列表内容由窗口自己订阅快照与事件，主进程不推数据）。
- 隐藏：`hideTrayPopup()`；`onTrayLeave()` 起 200ms 定时器，到期 `screen.getCursorScreenPoint()` 同时不在托盘 bounds 与列表 bounds 内才 `hide()`；`TrayPopup.vue` DOM `mouseleave` 时调 `window.api.ui.popupLeave()`（渲染进程没有 `ipcRenderer`，必须走 preload），main 收到后走同样的 200ms 复查（光标回到托盘则取消隐藏）。—— 若实现中发现 `uiPopupLeave` 与 `onTrayLeave` 可共用一个复查函数，合并为一个私有 `scheduleHideCheck()`。
- `setPopupUnreadCount(count)`：0 → `hideTrayPopup()`。`manager.setUnread` 末尾调用（`tray-popup` 与 `manager` 同为无状态模块单例，直接 import，不形成循环）。
- `app-ipc.ts` 的 `uiJumpToConversation` 处理里追加 `hideTrayPopup()`：点条目跳转后收起列表（聚焦清除只管通知弹窗，管不到这个窗口）。
- `destroyTrayPopup()`：`will-quit` 里 `destroyTray` 旁调用。

- [ ] **Step 7: TrayPopup 渲染组件**

`src/renderer/src/TrayPopup.vue`：
- `onMounted`：`window.api.state.snapshot()` 初始化会话行，订阅 `window.api.state.onEvent`，`conversation` / `conversation-removed` 事件增删本地行；只保留 `unread > 0` 的行，按 `lastMessageAt` 倒序。
- 行渲染：头像（direct 用 `peers` 里 `peerKey` 对应的 `avatarMd5`，group 用 `groups` 的 `photoMd5`，`avatarUrl` 来自 `utils/avatar.ts`；头像为空显示首字圆形占位）、标题、红色角标（`>99` 显示 `99+`）——头像与列表结构参考 `ConversationList.vue:70-80` 的 `peerOf` 写法。
- 点击行：`window.api.ui.jumpToConversation(id)`。
- 底部按钮「一键已读」：`window.api.conversations.markAllRead()`。
- 行数变化时 `ipcRenderer` 不可直接用——用 `window.api.ui.popupResize({ height })`（preload 里 `ipcRenderer.send(IPC.uiPopupResize, request)`，Api 加 `popupResize(request: { height: number }): void`），高度 = 实际行数按 `TRAY_POPUP` 常量计算。
- 页面 body 透明无边距，内容区右下角对齐（窗口本身已定位）。

- [ ] **Step 8: main.ts 分支**

同 Task 5 模式，加 `tray-popup` 分支。

- [ ] **Step 9: 手工冒烟（Windows）**

Run: `pnpm dev`，双实例互发消息制造未读。
Expected: 鼠标悬停托盘图标 120ms 后弹出列表（贴图标上方）；光标移入列表不消失，移开 200ms 后收起；点条目跳转会话；点「一键已读」列表收起、闪烁停止；窗口聚焦时闪烁暂停、失焦恢复。

- [ ] **Step 10: 全量验证与提交**

Run: `pnpm lint && pnpm typecheck && pnpm test`

```bash
git add -A
git commit -m "feat: 托盘悬停未读列表与一键已读入口"
```

---

### Task 8: 麒麟信安托盘图标修复

**Files:**
- Modify: `scripts/gen-assets.py`
- Create: `resources/tray-16.png`、`tray-unread-16.png`、`tray-22.png`、`tray-unread-22.png`、`tray-24.png`、`tray-unread-24.png`（生成物，提交入库）
- Modify: `src/main/tray.ts`

**Interfaces:**
- Consumes: 现有 `build/icon.png` 与 `gen-assets.py` 里画红点徽标的逻辑。
- Produces: `createTray` 用「复制到 `userData/icons/` 的真实路径」创建托盘，Windows 取 16、Linux 取 22，运行时不再 `resize()`。

- [ ] **Step 1: 生成精确尺寸图标**

`gen-assets.py`：保留红点徽标绘制，改成导出 6 个文件（256 基图 `LANCZOS` 缩到目标尺寸）：`tray-{16,22,24}.png` 与 `tray-unread-{16,22,24}.png`，放进 `resources/`；删除旧的 256 尺寸 `tray-unread.png` 引用（`tray.ts` 不再用它）。

Run: `python scripts/gen-assets.py && ls resources/`
Expected: 6 个新文件，无旧 `tray-unread.png`

- [ ] **Step 2: tray.ts 用真实路径**

`createTray`：
```ts
const size = process.platform === 'win32' ? 16 : 22
const suffix = `${size}`
// 启动时把图标复制到 userData/icons（asar 之外），宿主进程按路径读图才能读到
const iconDir = join(app.getPath('userData'), 'icons')
mkdirSync(iconDir, { recursive: true })
const normalPath = join(iconDir, `tray-${suffix}.png`)
const unreadPath = join(iconDir, `tray-unread-${suffix}.png`)
copyFileSync(join(__dirname, ...原资源路径), normalPath)  // 资源路径用 ?asset 导入得到的原文件
copyFileSync(..., unreadPath)
normalImage = nativeImage.createFromPath(normalPath)
unreadImage = nativeImage.createFromPath(unreadPath)
```
（`?asset` 导入的原文件路径作为 copy 源；`copyFileSync`/`mkdirSync` 失败直接抛出——按仓库的 fast-fail 约定，不静默回退。`window.ts` 的 `icon` 导入方式可参考。）

- [ ] **Step 3: 全量验证与提交**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

```bash
git add -A
git commit -m "fix: 托盘图标改用精确尺寸并复制到数据目录"
```

- [ ] **Step 4: 麒麟信安验证（人工，阻塞该项关闭）**

把新包给需求方在麒麟信安上验证：仍显示默认图标则进入排查第 3 步（`busctl` 读 `org.kde.StatusNotifierItem` 属性），并把 Linux 取图尺寸换成 24 重试（`tray.ts` 的 `size` 一行）。此步不完成不阻塞其他任务合并，但必须在 CHANGELOG 里如实记录状态。

---

### Task 9: 端到端验证与收尾

**Files:**
- Create: `.dev-data/verify-toast.mjs`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: 全部前序任务；`.dev-data/` 现有双实例 e2e 启动方式（`LANPOST_DATA_DIR`、独立端口、`privateSeeds`，参考现有 `verify-*.mjs` 与 AGENTS.md 测试节）。
- Produces: 可重复运行的弹窗验证脚本；CHANGELOG `[未发布]` 段。

- [ ] **Step 1: 写弹窗 e2e 脚本**

`.dev-data/verify-toast.mjs`（文件头无 shebang；顶部 `const DEADLINE = Date.now() + 120_000`，所有等待循环里 `if (Date.now() > DEADLINE) throw new Error('超时')`）：

1. 启动实例 A（9333，e2e-a）与实例 B（9334，e2e-b），等待就绪。
2. B 通过 `window.api.messages.send` 给 A 的会话发文本。
3. 轮询 A 的 `/json/list`，找到 url 含 `window=toast` 的 target；断言弹窗窗口存在。
4. 在弹窗 target 里 `Input.dispatchMouseEvent` 点击卡片 → 断言 A 主窗口 `document.hasFocus()` 为 true 且 `store.currentConversationId` 为目标会话；断言弹窗已隐藏。
5. 再发一条消息 → 弹窗重新出现 → 主窗口 `window.focus()` → 断言弹窗隐藏（聚焦清除）。
6. 再发一条 → 等 11 秒 → 断言弹窗隐藏（10 秒到期），且 A 的未读仍 > 0（到期不清未读）。
7. 全程输出 `log(...)` 到 `.dev-data/toast-verify.txt`。

- [ ] **Step 2: 跑脚本**

Run: `timeout 300 node .dev-data/verify-toast.mjs`
Expected: exit=0，日志含每步结果

- [ ] **Step 3: 回归全量**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: 全过

- [ ] **Step 4: CHANGELOG**

`CHANGELOG.md` 加 `## [未发布]` 段，`### 新增` 写：右下角 10 秒置顶通知（点击跳转、回软件自动清除、锁屏解锁补显示）、托盘图标 500ms 闪烁直到未读清零、Windows 悬停未读列表与一键已读、提示音三选一（默认 A，可试听）。`### 变更` 写：前台有焦点时不再弹任何通知（含系统通知）；「任务栏闪烁」文案改为「托盘图标闪烁」。**不改版本号。**

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "test: 通知弹窗端到端验证与变更记录"
```
