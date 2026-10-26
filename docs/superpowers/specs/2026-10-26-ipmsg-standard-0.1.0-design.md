# 0.1.0 标准 IPMSG 重写设计

日期：2026-10-26
状态：待实现
范围依据：`docs/04-参考资料/ipmsg-protocol-zh.md`（草案 10），常量与目录流以官方 `shirouzu/ipmsg` 的 `src/ipmsg.h`、`mainwinfile.cpp`、`mainwinmsg.cpp` 为准。

## 1. 意图

0.1.0 不是对现有协议层的增量升级，而是**推翻重来**：删除历史遗留的私有握手、X_* 消息和企业字段，只保留一个干净、完整、可独立验收的标准 IPMSG 实现。目标是打开软件就能看到局域网里的其他用户，能稳定收发文字、状态、密封消息、广播、文件和目录，并与飞秋、飞鸽、原版 IP Messenger 等标准客户端互通。

第一优先级是**发现与在线状态**：启动后立即广播上线，快速、持续地看到其他用户。一个看不到人的局域网客户端不会被使用，其他功能都建立在这一点上。

## 2. 范围

### 2.1 纳入

| 组 | 条目 |
| --- | --- |
| A 发现 | 启动广播、ANSENTRY、BR_EXIT、BR_ABSENCE、组名扩展、DIALUPOPT、GETLIST 系、AUTORETOPT、成员超时 |
| B 消息 | 文字、发送确认、密封/已读、ANSREADMSG、DELMSG、广播/多播、确认重传、UTF-8 协商、GETINFO、GETABSENCEINFO、消息内嵌图片 |
| D 文件 | 单文件、目录收发、RELEASEFILES、扩展属性、特殊类型安全处理、附件能力声明 |
| E 报文层 | 标准头、命令/选项常量、非法报文容错、数值边界、未知命令忽略 |

### 2.2 不纳入

- 任何加密协议、密钥交换、电子签名。
- 私有 ENET/XML 通道、私有命令、私有控制载荷。
- 群聊、共享文件柜、远程协助、离线消息。
- 目录断点续传（协议没有 offset 语义）。
- ACL、FinderInfo、AliasFname 的语义处理（只解析、忽略）。
- 设备文件、FIFO、符号链接的还原（安全跳过并记录）。

### 2.3 反目标

- 不保留“先尝试私有通道、失败再走标准”的分支。
- 不因为兼容旧版本而保留企业/部门/签名等非标准字段。
- 不引入原生模块，不改变 Node 24 / Electron 内置 `node:sqlite` 的约束。
- 不写数据迁移：旧数据库直接清空重建。
- 不把协议层的“已确认送达”当成“对方已读”。

## 3. 约束

- 端口 2425 在测试中禁用；协议/文件测试使用随机高端口与真实临时目录。
- 报文头 seq 必须保持 32 位；文件任务按 32 位 packetId + 32 位 fileId 匹配。
- 协议解析在 main 进程内可单测；直接依赖 `electron` 的模块不进入 Vitest。
- 新增 IPC 必须同时改 `src/shared/ipc.ts` 的 `Api`、`src/preload/index.ts`、main handler、renderer 调用。
- 渲染进程不直接读本地文件；图片通过受限的自定义协议读取。
- 发送给不支持 UTF-8 的对端时不得强行发 UTF-8；按 GBK 有损回退并记录日志。

## 4. 实现方式

### 4.1 选定方式

标准协议层重写：新建 `src/main/protocol/` 下的标准模块，`engine.ts` 只负责在线成员与消息编排；删除私有握手、XML 命令与相关数据字段。文件层保留现有 TCP 框架，扩展目录能力。协议层只有一个事实来源，发现、消息、文件都围绕标准命令组织，不存在“先试私有通道”的分支。

### 4.2 模块划分

```
src/main/protocol/
  commands.ts    标准命令号、选项位、文件类型、扩展属性常量
  packet.ts      标准报文头编码/解码、NUL/分隔符工具
  encoding.ts    GBK / UTF-8 编解码
  engine.ts      在线成员、消息、状态、确认重传、广播/多播编排
  attach.ts      附件表与附件项编解码
  entry.ts       Entry / ANSENTRY / BR_ABSENCE 载荷与能力位
  text.ts        UTF-8 协商与 GBK 回退
  retransmit.ts  待确认队列（seq → 包）
  seal.ts        密封、READMSG、READCHECKOPT/ANSREADMSG
  info.ts        GETINFO/SENDINFO、GETABSENCEINFO/SENDABSENCEINFO
  host-list.ts   GETLIST / ANSLIST
  clipboard.ts   CLIPBOARD 附件与 CLIPBOARDPOS
  attrs.ts       扩展属性、只读/隐藏标志、文件类型
  dir-stream.ts  GETDIRFILES 头部编解码、目录流生成与消费
```

文件层：
- `src/main/files/dir-sender.ts`：目录树遍历与流输出。
- `src/main/files/dir-receiver.ts`：目录流解析、临时目录落盘、成功后原子改名。
- `src/main/files/paths.ts`：相对路径清洗与越界防护。
- `src/main/files/media.ts`：图片缓存与自定义协议路径解析。

删除：`src/main/protocol/xml.ts`、`xml.test.ts`、`discovery.ts` 中的私有命令与握手状态。设置、数据库、UI 中的企业/部门/签名/corpId/ready 字段一并移除。

## 5. 发现与在线状态（第一优先级）

### 5.1 启动序列

1. 绑定 UDP `0.0.0.0:<port>`，开启 `reuseAddr` 与广播；接收缓冲区调大（至少 64 KB）。
2. 清空内存联系人；把数据库中持久化的联系人全部标记为离线，等对端重新通告。
3. 计算广播目标：`255.255.255.255` + 每个 IPv4 网卡的定向广播地址 + 设置中的附加网段；种子地址作为单播目标。
4. **立即广播上线/离开通知**，然后在启动后 1 秒、3 秒各补发一次，抵消首包丢失；之后按 `broadcastInterval`（默认 30 秒）周期发送。每次发送前重新计算网卡广播地址，适配 DHCP/VPN 切换。
5. 每次广播（含启动补发与周期发送）都对每个种子地址发同样的单播包，用于跨网段发现。
6. 定时器每 5 秒检查一次，120 秒没有收到任何包的成员置为离线。

统一的 `announce()` 根据当前状态选择命令：在线/忙碌/离开分别发送 `BR_ENTRY` 或 `BR_ABSENCE | ABSENCEOPT`，不会在周期发送时把离开状态刷回在线；启动补发、周期发送、手动刷新、种子单播全部复用这一个入口。

### 5.2 成员识别

- 收到 `BR_ENTRY`：更新/创建成员，标记在线，**立即单播回 `ANSENTRY`**（带自己的昵称、组名、状态与能力位）。为避免广播风暴，回包加 0–200 ms 随机抖动。
- 收到 `ANSENTRY`：更新/创建成员，标记在线，不回包。
- 收到 `BR_ABSENCE`：更新昵称/组名与离开状态，标记在线，**不回 `ANSENTRY`**。
- 收到 `BR_EXIT`：立即离线。
- 收到任意合法报文：刷新 `lastSeen` 并置在线。
- 成员键使用 `IP|账号`；多网卡出现多个同名联系人时保持独立，不强行合并。
- 不再需要任何握手或 `ready` 状态：收到 Entry 类包即可见、可发消息。

### 5.3 状态与资料变更

- 状态 0（在线）、1（忙碌）、2（离开）。1 和 2 在协议层都设置 `ABSENCEOPT`，对端显示离开；本机 UI 仍区分忙碌/离开。
- 切换到离开/忙碌：广播 `BR_ABSENCE | ABSENCEOPT`，载荷带昵称与组名。
- 回到在线：广播 `BR_ENTRY`。
- 昵称或组名变化：广播 `BR_ABSENCE`（在线时不带 `ABSENCEOPT`），接收方更新字段。
- 手动“刷新联系人”：立即执行一次启动广播序列（全量广播 + 种子单播），不重启引擎。
- 以上逻辑全部在 `engine.ts`，不依赖数据库；数据库只做持久化镜像。

### 5.4 能力位

本机在 `BR_ENTRY` / `ANSENTRY` / `BR_ABSENCE` 上声明：
`CAPUTF8OPT | FILEATTACHOPT | CLIPBOARDOPT`，拨号模式额外 `DIALUPOPT`，离开时额外 `ABSENCEOPT`。

接收方记录 `capUtf8 / capFile / capClipboard / dialup`，用于：
- 决定文字与附件名是否可用 UTF-8；
- 联系人详情展示能力标签；
- 对拨号成员的单播通知。

### 5.5 主机列表

- `GETLIST` 载荷为十进制起始序号（可空）；`ANSLIST` 载荷为 `%5d\a%5d\a`（下一批起始序号、本批数量），后接每个主机的 `用户\a主机\a状态\a地址\a端口\a昵称\a组名\a\a`，端口按主机字节序写十进制。
- `BR_ISGETLIST` 有联系人时回 `OKGETLIST`；`OKGETLIST` 触发一次 `GETLIST`；`ANSLIST` 合并已知联系人的昵称/组名，不创建无 IP 联系人；分批时按下一批序号继续，最多 3 批。
- 主机列表只作为发现的补充，不影响 ENTRY/ANSENTRY 主路径。

### 5.6 发现验收

- 同一主机两个实例（不同端口 + 种子）：启动后 2 秒内互相可见。
- 同一网段两个实例（不同机器）：启动后 5 秒内互相可见。
- 关闭一端：`BR_EXIT` 后对端 1 秒内离线；异常断网：120 秒内离线。
- 修改昵称/组名/状态：对端 1 秒内更新。
- 保持离开状态超过两个广播周期：对端仍显示离开，不会被周期广播刷回在线。
- 首次广播丢一个包：1 秒/3 秒补发后仍能在 5 秒内发现。

## 6. 消息与协议细节

### 6.1 常量

`commands.ts` 按官方 `ipmsg.h`（Ver4.50）补全。命令号与选项位分开命名空间；同一数值在 Entry 命令里是 `ABSENCEOPT`，在 SENDMSG 里是 `SENDCHECKOPT`，不能共用常量名。

命令：`BR_ENTRY 0x01`、`BR_EXIT 0x02`、`ANSENTRY 0x03`、`BR_ABSENCE 0x04`、`ISGETLIST 0x10`、`OKGETLIST 0x11`、`GETLIST 0x12`、`ANSLIST 0x13`、`SENDMSG 0x20`、`RECVMSG 0x21`、`READMSG 0x30`、`DELMSG 0x31`、`ANSREADMSG 0x32`、`GETINFO 0x40`、`SENDINFO 0x41`、`GETABSENCEINFO 0x50`、`SENDABSENCEINFO 0x51`、`GETFILEDATA 0x60`、`RELEASEFILES 0x61`、`GETDIRFILES 0x62`。

选项：`ABSENCEOPT 0x100`（Entry 类）、`SENDCHECKOPT 0x100`（SENDMSG）、`SECRETOPT 0x200`、`BROADCASTOPT 0x400`、`MULTICASTOPT 0x800`、`AUTORETOPT 0x2000`、`RETRYOPT 0x4000`、`NOLOGOPT 0x20000`、`NOADDLISTOPT 0x80000`、`READCHECKOPT 0x100000`、`FILEATTACHOPT 0x200000`、`UTF8OPT 0x800000`、`CAPUTF8OPT 0x1000000`、`CLIPBOARDOPT 0x08000000`、`DIALUPOPT 0x10000`、`SERVEROPT 0x200`。

文件类型：`REGULAR 1`、`DIR 2`、`RETPARENT 3`、`SYMLINK 4`、`CDEV 5`、`BDEV 6`、`FIFO 7`、`RESFORK 0x10`、`CLIPBOARD 0x20`。
文件标志（低 16 位）：`RONLY 0x100`、`HIDDEN 0x1000`、`EXHIDDEN 0x2000`、`ARCHIVE 0x4000`、`SYSTEM 0x8000`。
扩展属性键（十六进制）：`UID 0x1`、`USERNAME 0x2`、`GID 0x3`、`GROUPNAME 0x4`、`CLIPBOARDPOS 0x8`、`PERM 0x10`、`MAJORNO 0x11`、`MINORNO 0x12`、`CTIME 0x13`、`MTIME 0x14`、`ATIME 0x15`、`CREATETIME 0x16`、`CREATOR 0x20`、`FILETYPE 0x21`、`FINDERINFO 0x22`、`ACL 0x30`、`ALIASFNAME 0x40`。

### 6.2 报文头

固定 `1:<seq>:<账号>:<主机名>:<命令号>:<载荷>`，seq 与命令号为十进制，载荷按命令解释。出站永远发送版本 `1`；入站只接受版本号数字部分为 1 的报文（容忍历史后缀，但不生成）。空载荷允许省略末尾冒号。

### 6.3 Entry 载荷

发送：`昵称\0组名\0` + `\nUN:账号\nHN:主机名\nNN:昵称\nGN:组名\nVS:版本十六进制`。
- **编码规则**：传统字段（昵称、组名）按 GBK 编码，保证旧客户端可读；末尾 `UN/HN/NN/GN` 块一律 UTF-8，携带完整原值。非 GBK 字符在传统字段中有损替换为 `?`，旧客户端只能看到替换值，新客户端以 UTF-8 块为准。
- 头部账号/主机名优先 ASCII；包含非 ASCII 时按 UTF-8 发送（账号与主机名默认就是 ASCII，普通用户不受影响）。
- BR 类包不设置 `UTF8OPT`，只设置 `CAPUTF8OPT`。
- 没有组名时仍然发送两个 NUL（`昵称\0\0\nUN:...`）。
- `VS` 写 `lanpost-im/0.1.0` 的十六进制编码或省略。

解析：先按 NUL 切出昵称、组名（GBK 解码，失败再试 UTF-8）；剩余部分若以 `\n` 开头，按 `UN/HN/NN/GN/VS` 行以 UTF-8 解析并覆盖传统字段；否则忽略。任何字段缺失都不影响成员可见。

### 6.4 文字与 UTF-8

- **默认 UTF-8**：对端声明 `CAPUTF8OPT` 时，所有文字与附件名都用 UTF-8 并设置 `UTF8OPT`，因此 emoji 和任意 Unicode 字符可直接收发。
- **回退 GBK**：对端没有 UTF-8 能力时用 GBK；GBK 无法表示的字符（包括 emoji）有损替换为 `?` 并记录日志。
- 接收：`UTF8OPT` → UTF-8；否则先按 GBK，解码失败再尝试 UTF-8。
- 附件正文与文字同编码；`GETFILEDATA`/`GETDIRFILES` 带 `UTF8OPT` 时文件名按 UTF-8 解析。
- BR 类包例外：传统昵称/组名字段仍用 GBK，UTF-8 块携带原值，见 6.3。
- 正文换行统一 `\n`；字段分隔符按协议用 `:`，文件名中的 `:` 用 `::` 转义。

### 6.5 确认、去重与重传

- 出站 `SENDMSG`（含附件邀请）一律带 `SENDCHECKOPT`；入站回 `RECVMSG`（带 `AUTORETOPT` 时不回）。
- `retransmit.ts` 维护 `seq → { peerKey, data, tries, timer }`，间隔 4 秒、最多 4 次；收到 `RECVMSG` 或 `ANSREADMSG` 清除；用尽后回调 `onMessageStatus(peer, seq, 'failed')`。
- 入站按 `(peerKey, seq)` 在 5 分钟窗口内去重：重复消息只回确认，不重复落库、不重复建文件任务。
- 重传队列在 `stop()` 时清空，测试注入假定时器。
- 广播/多播的每个目标独立 seq、独立重传。

### 6.6 密封消息与已读

- 入站 `SECRETOPT`：消息 `meta.sealed=true, opened=false`；通知文案为“收到一条密封消息”，不展示正文。
- 用户点击气泡：`unseal(messageId)` → 本地 `opened=true` → 发 `READMSG`（载荷 `seq\0`，带 `READCHECKOPT` 当入站包带 `READCHECKOPT` 或为 `SECRETEXOPT`）→ 显示正文。
- 入站 `READMSG`：把对应出站消息状态置 `read`；带 `READCHECKOPT` 时回 `ANSREADMSG`。
- 出站密封：Composer 提供“密封发送”开关；消息 `meta.sealed=true`，本人可见正文；收到 `READMSG` 后状态变已读。
- 普通消息不主动发 `READMSG`；标准普通消息的“已读”不纳入本版验收。
- 正文仍在本地明文入库，UI 只做遮挡；这是传输层保密，不是静态加密。
- `DELMSG`：收到后删除对应本地消息并广播事件；UI 不提供发起入口。

### 6.7 广播与多播

- 广播：targets = 全部在线联系人，报文带 `BROADCASTOPT`；多播：targets = 勾选联系人，报文带 `MULTICASTOPT`；每个目标单独 `SENDMSG|SENDCHECKOPT`。
- 归档：每个目标会话各落一条 `direction='out'`，`meta.flags` 记录 `broadcast`/`multicast`；回复进入对应私聊。
- 入站：`meta.flags` 记录标记，气泡显示“广播/多播”徽标；回复只回发送者。
- UI：联系人页“广播消息”；聊天列表支持多选后发送。

### 6.8 状态信息与版本

- `GETINFO`：回 `SENDINFO`，载荷为 `lanpost-im 0.1.0 (IPMSG draft10; UTF8; FILE; CLIPBOARD)`。
- `GETABSENCEINFO`：离开时回离开说明，在线时回 `Not absence mode`。
- `requestInfo(peerKey)`：依次发 `GETINFO`、`GETABSENCEINFO`，结果缓存到成员并落库；联系人详情显示并可手动刷新。
- `AUTORETOPT`：抑制 ANSENTRY、RECVMSG、READMSG、SENDINFO、SENDABSENCEINFO 等自动回复，但内容照常处理。
- `NOADDLISTOPT`：来自陌生联系人时只落消息，不主动回 Entry/AnsEntry。
- `DIALUPOPT`：对该联系人的自动通知使用单播；设置页提供“拨号模式”开关。

## 7. 附件与文件

### 7.1 附件表

- 单文件：`fileID:filename:size:mtime:fileattr[:ext...]:`，多项用 `\a` 分隔；十六进制数值；文件名 `:` 转义 `::`。
- 目录：顶层附件的 `fileattr` 低 8 位必须是 `DIR (0x02)`，不能写成 `REGULAR|DIR`；`size` 为目录内文件总字节数。
- 扩展属性写 `键=值`，键与值均为十六进制，例如 `14=<mtime>`；解析未知键忽略。
- 发送普通文件带 `REGULAR`，只读文件补 `RONLY`；接收应用 mtime 与只读标志；`SYMLINK/CDEV/BDEV/FIFO/RESFORK` 跳过并记录。

### 7.2 消息与任务模型

- **一次 SENDMSG 邀请对应一条消息**，消息在邀请发出/收到时立即创建，不等传输进度；`message.remote_seq = packetId`，送达/失败状态能直接落到这条消息上。
- 文件与目录：每个顶层附件单独发一次 SENDMSG（多选文件 = 多次邀请、多条消息），每条消息对应一个文件/目录任务。
- 图片：一次邀请可以带多张 CLIPBOARD 附件，只产生一条消息，`meta.images` 列出全部图片任务。
- `FileManager` 不再创建消息；`app-service` 在 `sendFiles` / `handleFileOffer` 时创建消息并记录 `file_tasks.message_id`，后续进度只更新任务。`MessageList` 按 `message.meta.files`/`meta.images` 取任务，不再依赖 `messageId → file` 的一对一映射。
- 邀请重传用尽后，`onMessageStatus(peer, packetId, 'failed')` 把邀请消息置失败；已开始传输的任务仍按 TCP 结果单独更新状态。

### 7.3 单文件传输

- `GETFILEDATA` 载荷 `packetId:fileId:offset:`，offset 为十六进制；支持从偏移续传。
- 接收方按 packetId + fileId 匹配任务；找不到时按同 IP 最新待发送任务兜底（保留现有日志）。
- 拒绝/取消入站任务时发 `RELEASEFILES`（`packetId:fileId` 十六进制）；发送方收到后把出站任务置 `rejected`。

### 7.4 目录传输

发送：
1. `GETDIRFILES` 载荷 `packetId:fileId`。
2. 流式输出：**先发根目录自身的 DIR 头**，再递归子项，每层目录结束发 `RETPARENT`；根目录的 `RETPARENT` 是最后一帧。
3. 头部 `headerSize:name:size:attr[:ext...]:`；`headerSize` 从该字段开始到内容前最后一个冒号为止，包含自身与末尾冒号，至少 4 位十六进制。
4. 目录项按名称排序；不跟随符号链接；单文件分块读取。

接收：
1. 收到 DIR 附件时建 `kind='dir'` 任务，显示项数与总大小；用户接受后连接发送方 TCP。
2. 写入 `<receiveDir>/.lanpost-<taskId>/`：
   - 栈空时的第一个 `DIR` 是根目录，最终目录名用附件名，忽略头部根名；
   - 其余 `DIR` 创建子目录并压栈；
   - `RETPARENT` 弹栈，栈空即完成；
   - `REGULAR` 按 size 写入并应用 mtime/只读；
   - 其他类型按 size 消费字节后跳过；
   - 首帧不是 `DIR` 时按隐式根目录处理。
3. 成功后原子改名为最终目录（重名用 `名称 (1)`）；失败/取消删除临时目录。
4. 路径逐段清洗：拒绝 `..`、绝对路径、盘符、NUL；超长名截断；所有文件限制在临时目录内。
5. 进度 = 已收字节 / 总大小；项数进度单独记录。

## 8. 内嵌图片

- 发送：Composer“发送图片”选择图片，以 `attr=CLIPBOARD` 的附件发送；多张按顺序，`CLIPBOARDPOS` 记录文字长度 + 序号；图片显示在文字下方。
- 接收：`CLIPBOARD` 附件自动接受到 `<receiveDir>/images/<packetId>-<fileId>-<name>`，任务 `kind='image'`；一次 offer 只产生一条消息（`kind='text'`，正文可为空），`meta.images` 记录所有图片任务；图片任务仍出现在文件页。
- 空正文也落库并通知“收到图片”，未读按一条计。
- 渲染：气泡显示缩略图网格，点击调用 `openFile`；地址为 `lanpost-media://file/<taskId>`。
- 自定义协议：只允许 `<taskId>` 对应、`kind='image'` 且状态为 `done` 的任务（从数据库查询，重启后仍有效），返回 `net.fetch(pathToFileURL(path))`；拒绝任意路径；在 `app.ready` 前注册 scheme 为 standard/secure。
- 限制：单张 10 MB、一次最多 10 张，超出降级为普通附件。

## 9. 数据与契约变更

### 9.1 SQLite

`SCHEMA_VERSION` 升到 2。用户已确认旧数据不需要保留：打开数据库时若 `user_version` 在 `1..2` 之间，直接删除全部业务表并重建 schema，不写列迁移；日志记录“旧结构已重置”。`user_version > 2` 仍拒绝打开。

`peers` 表删除 `corporation / department / sign / corp_id / ready`，增加：
- `cap_utf8 INTEGER NOT NULL DEFAULT 0`
- `cap_file INTEGER NOT NULL DEFAULT 0`
- `cap_clipboard INTEGER NOT NULL DEFAULT 0`
- `dialup INTEGER NOT NULL DEFAULT 0`
- `version_info TEXT NOT NULL DEFAULT ''`
- `absence_info TEXT NOT NULL DEFAULT ''`

`file_tasks` 增加：
- `kind TEXT NOT NULL DEFAULT 'file'`（`file` / `dir` / `image`）
- `entry_count INTEGER NOT NULL DEFAULT 0`
- `completed_count INTEGER NOT NULL DEFAULT 0`

`messages` 不新增列：密封、广播、多播、图片、附件信息都放现有 `meta` JSON。

### 9.2 设置

`identity` 删除 `corporation / department / sign`，保留 `displayName / account / hostName / group / status`。
`network` 增加 `dialup: boolean`（默认 false）。
删除所有私有通道相关设置。

### 9.3 shared 契约

`PeerInfo` 删除 `corporation / department / corpId / ready / sign`，增加 `capUtf8 / capFile / capClipboard / dialup / versionInfo / absenceInfo`。
`FileTaskInfo` 增加 `kind: 'file' | 'dir' | 'image'`、`entryCount`、`completedCount`。
`MessageInfo` 增加可选 `meta: MessageMeta`（main 解析后下发）。
`MessageStatus` 扩展 `'failed'`。

IPC 新增：
- `messages.broadcast({ text }) → { count }`
- `messages.multicast({ peerKeys, text }) → { count }`
- `messages.unseal({ messageId }) → { message }`
- `messages.send` 增加可选 `{ sealed }`
- `peers.requestInfo({ peerKey }) → { peer }`
- `files.pickFolderAndSend({ conversationId }) → void`
- `files.pickImagesAndSend({ conversationId }) → void`

### 9.4 事件

`AppEvent` 增加 `{ type: 'peer'; peer: PeerInfo }`，让联系人详情实时刷新。

## 10. UI 变更

整体保持现有微信风格：左侧导航、会话列表、聊天气泡布局不变。

- `MessageBubble`：密封遮挡与点击解锁；广播/多播徽标；图片网格；失败状态。聊天消息模块不引入成员属性或编组逻辑。
- `Composer`：密封开关、发送图片按钮；保留草稿与回车行为。
- `ChatPane`：联系人详情展示版本、离开信息、能力标签与“刷新信息”；删除企业/部门/签名展示；不新增编组展示。
- `ContactsPage`：**编组展示放在联系人页**。按 `peer.group` 分区，组名作为可折叠分区标题，同名组合并；没有组名的联系人归入“未分组”。分区内保持现有联系人卡片样式（头像用昵称首字生成，协议没有头像字段）；顶部搜索跨组过滤；组名变化时联系人实时移动分区。
- `ContactsPage` 同时提供广播入口、联系人多选与多播发送。
- `FileCard` / `FilesPage`：目录图标、“N 项”、目录进度、取消/拒绝；目录完成后“打开文件夹”。
- `SettingsOverlay`：删除企业/部门/签名输入；新增“拨号模式”开关；在“网络”页说明广播与种子地址的用途。

## 11. 测试

### 11.1 单元

- `commands.test.ts`：命令/选项命名空间、组合判定。
- `packet.test.ts`：标准头、32 位 seq、空载荷、非法字段。
- `entry.test.ts`：传统字段、UTF-8 扩展覆盖、空组名、能力位、缺失扩展。
- `text.test.ts`：有 UTF-8 能力时默认 UTF-8、emoji 往返；无能力时 GBK 回退与有损替换。
- `retransmit.test.ts`：假时钟、4 秒 × 4 次、确认清除、失败回调、停止清空。
- `seal.test.ts`：SECRET/READCHECK 组合、ANSREADMSG 判定。
- `attrs.test.ts`：类型/标志拆分、扩展属性解析、异常输入。
- `dir-stream.test.ts`：头部往返、`::` 转义、空目录、嵌套、越界路径拒绝、根头/隐式根。
- `clipboard.test.ts`：位置与类型识别、超限降级。
- `host-list.test.ts`：GETLIST 序号、ANSLIST 字段与分批、异常载荷。
- `db.test.ts`：`user_version=1` 重置到 2；`user_version=3` 仍拒绝。
- `contacts.test.ts`：按组分区、未分组、空组名、同名组合并、搜索跨组过滤。

### 11.2 集成（Node 侧，随机端口）

- 两个 `ProtocolEngine`：启动发现（含首包丢失补发）、ENTRY/ANSENTRY、UTF-8、离开/回归、昵称变更、密封与 READMSG、广播/多播、确认重传与去重。
- 单文件：offer → GETFILEDATA（含 offset）→ 完成 → RELEASEFILES 拒绝路径。
- 目录：嵌套 + 空目录 + 中文名 + 特殊文件（跳过）→ 接收树一致、mtime/只读生效、失败清理临时目录。
- 图片：CLIPBOARD 附件 → 自动接收 → `meta.images` 指向任务。

### 11.3 验证命令

`pnpm lint` → `pnpm typecheck` → `pnpm test` → `pnpm build`。双实例手工验证使用不同 `LANPOST_DATA_DIR`、端口与 seeds。

## 12. 交付计划（新分支、多次提交）

分支：`feat/ipmsg-standard-0.1.0`

1. `refactor(protocol): replace private channel with standard IPMSG core`
   删除私有命令/XML/握手/ready，重写 `packet.ts`/`commands.ts`/`engine.ts` 骨架；删企业字段与相关 UI/DB；所有现有测试改为标准路径。
2. `feat(discovery): reliable startup announce and entry negotiation`
   启动补发、定向广播重算、ANSENTRY 抖动、超时、种子、刷新；发现集成测试。
3. `feat(protocol): entry capabilities and UTF-8 negotiation`
   entry/text/能力位/DB 落库。
4. `feat(protocol): retransmit, dedupe and sealed messages`
   确认重传、去重、READMSG/ANSREADMSG、失败状态。
5. `feat(protocol): absence, info and host list`
   离开/回归、GETINFO、GETABSENCEINFO、GETLIST；联系人详情。
6. `feat(protocol): broadcast and multicast`
   引擎 API、归档、IPC、联系人页与多选 UI。
7. `feat(files): directory transfer and release`
   dir-stream/dir-sender/dir-receiver/paths、RELEASEFILES、扩展属性、文件页与发送文件夹。
8. `feat(media): clipboard images`
   收发、自动接受、lanpost-media 协议、气泡图片。
9. `chore(release): prepare 0.1.0`
   CHANGELOG、known-limits、协议说明、`package.json` 0.1.0。

每个提交都要通过 lint + typecheck + 相关 Vitest；第 9 个提交前跑全量 test 与 build。

## 13. 风险与取舍

- **发现依赖 UDP 广播**：部分企业网络或 VPN 禁用广播；种子地址与附加网段是兜底，需在设置页说明。
- **重传可能触发重复文件邀请**：入站按 `(peerKey, seq)` 去重。
- **密封消息本地明文**：只做 UI 遮挡；文档明确“非静态加密”。
- **目录无断点续传**：失败整目录重来。
- **内嵌图片不实现光标插入**：图片固定显示在文字下方，`CLIPBOARDPOS` 仍然发送。
- **旧数据库直接清空**：不提供迁移，需在 CHANGELOG 与 known-limits 写明。
- **特殊文件类型只跳过**：不创建符号链接/设备节点。
