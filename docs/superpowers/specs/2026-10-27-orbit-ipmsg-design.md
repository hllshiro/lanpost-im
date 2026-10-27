# 基于 Orbit 的 lanpost 0.2 设计

- 状态：方向已确认，Phase 0 技术验证待执行
- 日期：2026-10-27
- 目标分支：`spike/orbit-ipmsg`
- 参考代码：`docs/3rd/Orbit-beta`（MIT，v0.9.0-beta）

## 1. 背景与决定

0.1.x 是标准 IPMSG 的轻量实现，已经具备发现、文本、文件、目录、图片、身份码、快捷键、开机启动等能力，但距离“完整 IM”仍缺少群聊稳定性、离线消息、富消息和完整的中文产品界面。

经过对比：

- BLIP：Electron + WebRTC，功能多，但 GPL-3.0、无 IPMSG、无群聊离线，UI 偏加密通讯。
- LANChat：MIT，Tauri + Rust，有离线队列，但无群聊、无 IPMSG，技术栈不同。
- Orbit-beta：MIT，Electron + SQLite，群聊、角色、邀请码、回应、已读、Markdown、相册、搜索、E2EE、测试体系最完整。

决定以 Orbit desktop 为底座，保留 Orbit 自己的 UI，增加一个最小 IPMSG 通道。

## 2. 目标

### 2.1 本次目标

- 桌面端：Windows 与 Linux（Android 移除，不构建 Capacitor）。
- 最终产物与当前发布需求一致：
  - Windows x64：NSIS 安装包、zip
  - Linux x64/arm64：deb、rpm、AppImage
- 保留 Orbit 原有 P2P 协议、联系人、消息、群聊、文件、设置和 UI。
- 增加 IPMSG 通道：
  - 用户发现
  - 点对点文本
  - 点对点文件
- IPMSG 联系人与 Orbit 联系人分开存储，不做双通道合并。
- 不做旧 0.1.x 数据迁移。
- Orbit UI 风格保持不变。
- 最终目标是替换当前根应用，相当于 fork Orbit，但不与上游仓库建立 git remote/submodule 关联。

### 2.1.1 阶段划分

- **Phase 0（当前）**：技术验证。只验证 Orbit 桌面端、IPMSG 最小通道、联系人/消息/文件集成、Windows/Linux 可运行。**不做中文 i18n。**
- **Phase 1**：集成确认可用后，再做全量中文 i18n、现有功能补齐、打包发布。
- **Phase 2**：群聊离线、其他产品化能力。

### 2.2 非目标

- 不做 IPMSG 群聊、目录、图片、密封、广播、主机列表、加密。
- 不把 IPMSG 联系人加入 Orbit 群聊。
- 不做 Android / iOS。
- 不做旧数据迁移或双通道去重。
- 不在 Phase 0 重做 Orbit UI，也不做中文 i18n。
- 不在 Phase 0 实现完整的群聊离线同步（见 8 Phase 2）。

## 3. 约束

- 纯局域网、零服务器。
- 桌面端 Web 技术栈：Electron。
- 默认中文；需要语言框架，但不改变 Orbit 的视觉风格。
- IPMSG 使用 2425（UDP/TCP），Orbit 使用 45678（UDP 发现）/ 46000（TCP），端口并存。
- Orbit 使用 MIT，允许修改和分发。
- 不引入服务端、云账号、遥测。

## 4. 方案选择

### 方案 A：Orbit 底座 + 最小 IPMSG 通道（采用）

- 复用 Orbit 的聊天、群聊、文件、SQLite、通知、测试。
- 新增 IPMSG transport，只做发现、1:1 文本、文件。
- Phase 1 新增 i18n 层，默认中文；Phase 0 保持 Orbit 英文 UI。
- 代价：维护 Orbit fork、补当前项目已有功能、i18n 工作量大。

### 方案 B：继续当前项目，移植 Orbit 功能

- 保留当前 Vue/微信 UI 和 IPMSG。
- 从 Orbit 移植群角色、文件续传、outbox、FTS5 等。
- 代价：群聊/离线仍要自己设计，Orbit 的大量 UI/产品细节无法直接复用。

### 方案 C：Fork BLIP / LANChat

- 不满足许可、技术栈或 IPMSG 要求，已排除。

采用方案 A。

## 5. 总体架构

```text
┌──────────────────────────── Orbit desktop ────────────────────────────┐
│ main process                                                          │
│  ├─ OrbitTransport    Discovery / SocketManager / TransferManager     │
│  ├─ IpmsgTransport    UDP/TCP 2425, discovery, text, file              │
│  ├─ ContactService    friends / transport / IPMSG contact              │
│  ├─ MessageService    unified messages / SQLite / outbox（后续）        │
│  ├─ FileService       Orbit transfer / IPMSG file adapter              │
│  └─ I18nService       zh-CN / en catalogs, main-process strings        │
│                                                                       │
│ preload.js  →  orbitAPI + ipmsg events + i18n                         │
│                                                                       │
│ renderer（Orbit 原 UI）                                                │
│  ├─ 联系人/会话/聊天/群聊/设置                                         │
│  ├─ transport badge / capability gating                                │
│  └─ i18n DOM 应用层                                                    │
└───────────────────────────────────────────────────────────────────────┘
```

### 5.1 传输路由

主进程新增 transport 选择：

```text
sendMessage(contact, payload)
  ├─ contact.transport === 'orbit'  → SocketManager
  └─ contact.transport === 'ipmsg'  → IpmsgTransport

sendFile(contact, attachment)
  ├─ orbit → TransferManager
  └─ ipmsg → IpmsgFileAdapter
```

renderer 不直接判断协议；由主进程根据联系人记录路由。

### 5.2 IPMSG transport

从当前项目抽取以下能力：

- `engine`：UDP 发现、Entry/AnsEntry/Absence/Exit、在线超时、文本 SENDMSG/RECVMSG、UTF-8/GBK、确认重传、去重。
- `files`：文件邀请、接收/拒绝、TCP GETFILEDATA、进度、取消。

删除/不启用：

- 目录流、图片消息、密封、广播、多播、主机列表、信息查询、内网通私有 230（除非后续需要）。
- 群聊、联系人与 Orbit 的合并。

端口：

- UDP 2425 广播/种子单播。
- TCP 2425 文件拉取。
- 与 Orbit 的 45678/46000 独立。

### 5.3 联系人模型

在 Orbit `friends` 上增加：

| 字段 | 说明 |
| --- | --- |
| `transport` | `orbit` / `ipmsg` |
| `ipmsgAccount` | IPMSG 账号 |
| `ipmsgHost` | 主机名 |
| `lastIp` | 最近一次发现的 IP |
| `lastSeen` | 最后在线时间 |
| `capabilities` | 可选：文本/文件 |

IPMSG 联系人使用独立键：

```text
ipmsg:<ip>|<account>
```

不做双通道合并。若同一人同时运行 Orbit 和旧 IPMSG 客户端，会出现两个联系人；这是本阶段接受的限制。

### 5.4 消息与附件模型

在 Orbit `messages` 上增加：

| 字段 | 说明 |
| --- | --- |
| `transport` | `orbit` / `ipmsg` |
| `remoteId` | IPMSG 的 packet seq 或文件 id |
| `remoteSeq` | 去重/确认用 |
| `deliveryStatus` | pending / sent / delivered / read / failed |

`chatId` 继续使用联系人 ID（Orbit userId 或 `ipmsg:...`），消息 UI 不改结构。

IPMSG 文件转成 Orbit attachment 记录，复用 Orbit 的文件消息气泡和下载/打开入口；传输进度映射为 Orbit 的 transfer 事件。

### 5.5 状态与能力

- IPMSG status 0/1/2 → Orbit online/busy/away。
- IPMSG 联系人只显示文本、文件能力。
- 对 IPMSG 联系人隐藏/禁用：群邀请、typing、reaction、已读回执、编辑、删除远端消息、E2EE 标记。
- Orbit 联系人保持原能力。

## 6. i18n 设计

### 6.1 现状

对 `Orbit-beta` 的检查结果：

- **没有应用级 i18n 框架**。
- 没有 `locales/`、`i18n/`、`t()`、`data-i18n` 等基础设施。
- UI 字符串直接硬编码在渲染层的模板字符串和 DOM 构造代码中。
- 只有第三方 `emoji-picker-element` 自带 i18n 资源，和 Orbit UI 无关。
- 主要字符串集中在：
  - `desktop/src/js/views/settings-modal.js`
  - `desktop/src/js/views/chat-panel.js`
  - `desktop/src/js/views/sidebar-middle.js`
  - `desktop/src/js/components/*.js`
  - `desktop/main.js` 的通知/错误文案

粗略扫描约有 **1,000–1,500 条候选可见文本**（包含少量误报）。这意味着中文改造是一个独立的大工作包，不是给 IPMSG 加一个开关。

### 6.2 框架选择

采用轻量自研 i18n，不引入 i18next/FormatJS：

- 应用是原生 JS，无前端构建链；直接加载 locale 模块最简单。
- 需求是 zh-CN 默认、en 回退、插值、少量复数/日期。
- 中文没有复数变化，`Intl` 足够处理日期/数字。

目录：

```text
desktop/src/i18n/
  index.js        # t(key, params), setLocale, applyI18n
  zh-CN.js        # 默认
  en.js           # 源语言/回退
desktop/lib/i18n.js  # 主进程复用（CJS）
```

API：

```js
t('chat.send', { name })
applyI18n(root)  // 处理 data-i18n / data-i18n-title / data-i18n-placeholder
```

- `zh-CN` 为默认，`en` 保留作为源语言和回退。
- 语言设置持久化在 Orbit 设置中；切换后重新渲染当前视图，必要时重启。
- 主进程的通知、错误、托盘菜单也走同一套 key。
- 日期/时间/数字统一用 `Intl.DateTimeFormat('zh-CN')` / `Intl.NumberFormat('zh-CN')`。

### 6.3 迁移策略

不做运行期 DOM 文本替换作为最终方案，避免歧义和不可维护。采用：

1. 给静态 HTML/模板加 `data-i18n` 属性。
2. 动态文本用 `t('semantic.key', params)`。
3. 按页面分批迁移：聊天 → 联系人/侧栏 → 设置 → 弹窗/通知 → 剩余组件。
4. 每批补 Playwright 断言：关键页面不出现未翻译的英文 key/文案。
5. 建立 `zh-CN.js` 与 `en.js` 的 key 对齐检查（缺失 key 在测试中失败）。

如果时间紧，可以在 spike 阶段先用“英文原文 → 中文”的临时字典做静态替换，但必须在正式实现前替换为 key，不把 DOM 替换层带进产品。

### 6.4 工作量与阶段

- 框架 + 构建/加载 + 日期/数字：小。
- 全量文案迁移：大，按 1,000+ 条估算，需要逐屏翻译和视觉检查。
- **Phase 0 不实现 i18n**，Orbit UI 保持英文；先验证技术链。
- Phase 1 再做框架、全量中文和视觉检查；不把翻译工作混入技术验证。

## 7. 目录与分支策略

实验分支：`spike/orbit-ipmsg`，从 `main` 创建。

Phase 0 把 Orbit desktop 放到：

```text
spike/orbit/
  desktop/
  shared/
```

保留当前 `src/` 不动，方便对比和回退。Orbit 应用从 `spike/orbit/desktop` 启动；IPMSG 模块放在：

```text
spike/orbit/desktop/lib/ipmsg/
```

Phase 0 验证通过后，最终把 Orbit desktop 作为仓库根应用，移除当前 Electron 实现；不保留 `spike/orbit` 作为长期目录，也不添加上游 git remote/submodule。保留 MIT LICENSE 和 Orbit 归属说明。

## 8. 实施阶段

### Phase 0：spike

- 导入 Orbit desktop + shared，移除 mobile 构建。
- 启动 Orbit desktop，确认 Windows 与 Linux 可运行。
- 抽取 IPMSG 发现/文本/文件最小模块。
- 增加 IPMSG 联系人、文本收发、单文件双向传输。
- 增加 transport 字段和路由。
- 验证 Orbit↔Orbit 原功能不受影响。
- 不做 i18n，Orbit UI 保持英文。

验收：

1. Orbit 启动正常，UI 风格不变。
2. IPMSG 对端出现在联系人列表，标记为 IPMSG。
3. 双向文本正常，UTF-8/GBK 正常。
4. 单文件双向发送、自动接收、取消/拒绝正常。
5. IPMSG 联系人不能加入群聊，相关按钮禁用。
6. Orbit↔Orbit 文本、文件、群聊不受影响。
7. Windows 与 Linux 至少各启动一次成功；最终打包在 Phase 1 验证。

### Phase 1：产品化

- 全量 i18n 中文迁移（默认 zh-CN）。
- 当前项目已有能力补齐：目录传输（如仍需要）、快捷键、开机启动、状态自动离开、设置缓存等。
- 文件传输 UI 完整对接：进度、暂停/续传、取消、拒收、打开目录；再决定手动/自动接收。
- Windows x64 与 Linux x64/arm64 打包：NSIS/zip、deb/rpm/AppImage。
- 防火墙、自动更新、发布流程。
- 旧 0.1.x 用户明确不迁移，或后续单独设计。

### Phase 2：群聊离线

Orbit 当前群聊只 fan-out 在线成员，桌面端没有持久化 outbox。后续单独设计：

- SQLite outbox
- 消息 ACK
- 群成员 per-member delivery
- 成员上线同步游标
- 发送方离线后上线补发

本设计不把 Phase 2 混入 IPMSG spike。

## 9. 风险

- **i18n 工作量被低估**：1,000+ 条硬编码文案，且 Orbit 视图文件很大；这是最大不确定性。
- Orbit 是 beta，原生 JS + better-sqlite3 + Electron 32；需要承担上游 bug 和原生模块构建。
- IPMSG 文件传输事件与 Orbit 附件/进度 UI 的语义差异。
- IPMSG 联系人不进群，群聊仍是 Orbit-only；用户需接受。
- Orbit UI 是英文/Discord 风格；设计上保持风格，但中文文案会影响布局，需要逐屏检查。
- spike 成功不等于全量迁移成功；数据迁移、旧功能补齐、打包仍需单独估算。

## 10. 已确认决策

- Windows 和 Linux 都需要；最终产物沿用 Windows x64 + Linux x64/arm64 的 deb/rpm/AppImage。
- IPMSG 文件 Phase 0 采用自动接收，减少 UI 适配；Phase 1 再评估。
- Phase 0 只做技术验证，不做中文 i18n；全量中文放 Phase 1。
- 最终替换当前根应用，fork Orbit，但不与上游建立 git 关联。
