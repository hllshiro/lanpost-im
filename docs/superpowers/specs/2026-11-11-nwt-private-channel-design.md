# 内网通私有通道接入设计（文字消息）

- 日期: 2026-11-11
- 状态: 待确认
- 范围: 与真实内网通 3.4.3055 之间通过私有通道双向收发文字消息

## 1. 背景

现有客户端与内网通之间只走 2425 上的 IPMSG 兼容层，文字能用，但没有私有通道提供的送达确认和已读回执。内网通私有通道的协议已在 `../../nwt-re/docs/private-protocol.md` 完整还原：9011 发现报文、ENet 可靠会话、`[长度][命令][TEA 密文]` 应用帧、固定密钥 TEA，以及 `X_SEND_MSG` 的 JSON 正文。

本次把这条通道接进客户端，先解决文字收发。

## 2. 目标

1. 与真实内网通之间通过私有通道发送文字，对方界面正常显示。
2. 接收真实内网通通过私有通道发来的文字，进入现有会话、消息列表、未读与通知。
3. 送达确认（1005）与已读回执（1006）映射到现有消息状态。
4. 私有会话未就绪时，文字自动走现有 IPMSG 路径；已经交给私有通道的消息不跨通道重发。
5. 与现有 IPMSG 路径共用同一套消息模型，界面不区分来源。

## 3. 非目标

- 私有文件、文件夹、群组、共享文件柜、远程协助、离线消息、局域网升级。
- 通过私有通道收发图片、文件等非文字内容；收到时只记录日志。
- 替代或移除 IPMSG 兼容层。
- 第二台真实内网通的部署与验证；本机可以用回环上的真实样本完成联调。

反目标：

- 私有通道失败时文字发不出去，视为失败。
- 私有通道接通后，对方收到重复消息或乱码，视为失败。
- 为了私有通道改动现有 IPMSG 行为，导致与飞秋、飞鸽或旧行为不兼容，视为失败。

## 4. 约束

- 不引入原生模块；ENet 子集用 TypeScript 实现。
- 现有验证顺序：`pnpm lint` → `pnpm typecheck` → `pnpm test`。
- 协议端口不能占用 2425 做测试；单测用随机高端口。
- 私有消息的持久化、未读、通知、状态沿用 `src/main/store` 与 `AppService` 的现有流程。
- 真实内网通的 corp id 双方可以不同（抓包已证实），账号体系不在本设计内。

## 5. 协议依据

完整规格见 `../../nwt-re/docs/private-protocol.md`，本设计用到以下部分：

- 发现：9011/UDP 304 字节报文，类型 1 通告、类型 2 应答。0x10 是 IPv4，0x18/0x1a/0x1c 是端口，0x1e 是 32 位十六进制用户标识，0x5f 是 16 字节随机标识，0xa5 是大端 ENet 端口。
- ENet：头部 `u16 peerID（0x8000 表示带 2 字节 sentTime）| u16 sentTime`，命令头 `u8 命令 | u8 通道 | u16 可靠序号`，字段一律大端。用到 CONNECT(0x02)、VERIFY_CONNECT(0x03)、ACK(0x01)、PING(0x05)、SEND_RELIABLE(0x06)、SEND_FRAGMENT(0x08)、BANDWIDTH_LIMIT(0x0A)；命令字最高位 0x80 表示要求 ACK。MTU 1400、窗口 65536、单通道。
- 应用帧：`u32 总长（= 8 + 正文字节数）| u32 命令号 | 正文`。
- 加密：正文按 8 字节分组做 TEA（32 轮，delta 0x9e3779b9），密钥 `8asfhj@k7*20hbla`，8 字节块与密钥字都按大端解释，末尾 `len % 8` 字节保持明文。
- 会话建立后先发类型 4 的 304 字节 hello（明文），再交换 `X_HANDSHARK`(1000)、`X_READY`(1018)，之后 30 秒一次 `X_HEARTBEAT`(1016)。
- 文字：`X_SEND_MSG`(1004)，`<MSG>` 是 JSON，`<MSG_TIME>`、`<OFFLINE>`、`<HIDE_RECORD>` 为 0；对端回 `X_SEND_MSG_ACK`(1005)。

抓包里的原始字节与解密结果可以直接当作测试向量，脚本在 `nwt-re/test/tea.py` 与 `nwt-re/test/decode_session.py`。

## 6. 架构

新增 `src/main/protocol/private/`，与现有 IPMSG 引擎并列，由 `AppService` 编排：

```
src/main/protocol/private/
  tea.ts          TEA 加解密与按块处理
  frame.ts        应用帧编解码（长度、命令、正文）
  enet.ts         ENet 子集：报文编解码、握手、可靠发送、ACK、重传、分片重组
  beacon.ts       9011 发现报文解析与发送
  messages.ts     私有 XML 报文的构建与解析（hello、1000、1004、1005、1006、1016、1018）
  session.ts      单对端会话状态机
  service.ts      多对端编排、与 AppService 的接口
```

`AppService` 增加一个 `PrivateService` 实例：

- 启动时绑定 9011/UDP 与一个临时 UDP 端口（ENet），监听发现报文与 ENet 报文；关闭时先发 `X_QUIT`(1017) 再释放。
- `sendText` 改为：目标联系人有就绪的私有会话时走 `PrivateService.sendText`，否则走现有 `engine.sendText`。
- `PrivateService` 的接收回调把文字交给现有的 `handleIncoming`，`remoteSeq` 使用对方的 `MSG_ID`。
- 状态回调把 1005 映射为 `delivered`，1006 映射为 `read`。
- `markRead` 时对私有会话补发 1006。

私有会话与联系人的对应关系按远端 IPv4 匹配现有 `ProtocolEngine` 的联系人；维护一张 `IP → peerKey` 的映射，私有会话先到时用 `IP|<privateId>` 建一条，IPMSG 通告随后到达时复用同一条，不再新建，避免同一个人的消息分成两个会话。`ProtocolEngine` 增加一个供私有通道调用的入口，把私有会话的在线状态、资料写进同一张联系人表，`online` 跟随会话状态，并参与现有的 120 秒离线判定；`sendText`、`sendFiles` 的在线校验继续以这张表为准。

## 7. 会话状态机

每个远端地址一个会话，状态：

```
idle → connecting → verifying → hello_sent → handshaking → ready → closed
```

- `idle`：已知对端 ENet 端口（来自发现报文或私有种子）。
- `connecting`：发 CONNECT，携带随机 connectID，5 秒无 VERIFY 重试，最多 3 次。
- `verifying`：收到 VERIFY_CONNECT，记录分配到的 peerID 与 sentTime，回 ACK 与 PING。
- `hello_sent`：在通道 0 发类型 4 的 hello。
- `handshaking`：收到对端 `X_HANDSHARK` 后回 `X_READY`；同时主动发自己的 `X_HANDSHARK`。
- `ready`：可以收发 1004；每 30 秒发 `X_HEARTBEAT`，120 秒无任何入站报文判定超时。
- `closed`：发 `X_QUIT`，释放重传队列，回落到 IPMSG。

触发时机：收到发现报文时记录端口并预热；`sendText` 时若会话不在 `ready`，立即发起连接，本次消息仍走 IPMSG；会话进入 `ready` 后，后续消息走私有通道。这样不会因为握手把某一条消息卡住。

对端主动 CONNECT 本机时走同一条状态机的接收侧：校验连接字段、分配 peerID、回 VERIFY_CONNECT，收到 hello 与 `X_HANDSHARK` 后同样进入 `ready`。本设计不主动广播 9011 通告（准入条件尚未完全确定），对端通常不会主动连我们，接收侧实现用于兼容对端先连过来的情况。

## 8. ENet 子集

- 头部与命令头按抓包实现；CONNECT 与 VERIFY_CONNECT 的载荷字段顺序照抄抓包（见协议文档第 3 节）。
- 发送可靠命令：通道 0 维护自增序号，未确认的报文按 500ms 起步、1.5 倍退避重传，6 次后放弃并记录日志。
- 接收：按通道维护期望序号，乱序时缓存；分片按 `startSeq` 聚合，收齐后交付并回 ACK；对要求 ACK 的命令（最高位 0x80）逐条回 ACK。
- PING 与 BANDWIDTH_LIMIT 收到即回 ACK；对端 30 秒无报文时保持静默，超过 120 秒关闭会话。
- 所有多字节字段大端；序号回绕按 ENet 的 16 位比较规则处理（`(a - b) & 0xffff < 0x8000`）。
- 接收侧维护一份按 `(远端 IP, 远端端口)` 索引的会话表，处理 CONNECT、VERIFY_CONNECT 的 ACK 与对端的可靠序号；与发送侧共用同一套编解码与重传代码。

## 9. 消息层

- hello：304 字节，类型 4，写入本机 IPv4、ENet 端口、32 位十六进制用户标识与 16 字节随机标识；用户标识在首次启动时生成并持久化。
- `X_HANDSHARK`：FEATURE 只声明 `MSG=2:1` 与 `HIDE_RECORD=1`，其余能力位与 NET 端口全部为 0，避免对端发起未实现的私有文件流程；`<CORP_ID>` 与 `X_READY` 的 `USER_ID` 都填本机私有标识，保证对端把两条通道看成同一个身份。
- `X_READY`：`USER_ID` 用本机私有用户标识，`PARAM=0`。
- `X_SEND_MSG`：`MSG_ID` 用毫秒时间戳加自增，`RECEIPT=0`，`MSG` 是 JSON，`MSG_TIME=0`，`OFFLINE=0`，`HIDE_RECORD=0`。
- JSON 正文：`app="shiyeline"`，`dt=[{"txt":{"t":"normal","v":正文}}]`，`ft` 用默认字体 `微软雅黑`、字号 9、其余 0，`id` 为 32 位十六进制随机值，`type="0"`，`ver="6.0"`；空格与引号按对端格式写成 `&nbsp;` 与 `&quot;`。
- 接收：解析 `<MSG>` 的 JSON，拼接所有 `txt.v`；没有文字内容时记录日志并忽略，仍回 1005。
- 1005：按 `MSG_ID` 找到出站消息，状态置 `delivered`。
- 1006：按 `MSG_ID` 置 `read`；本机 `markRead` 时，对会话里每条私有入站且尚未回过执的消息各发一条 1006。
- 入站消息在 `meta` 里记录来源与对方 `MSG_ID`（`{"source":"private","msgId":"..."}`），IPMSG 路径保持不变；发 1006 只针对 `source=private` 的消息，避免把 IPMSG 序号当成私有 `MSG_ID`。

## 10. 设置与持久化

- `network` 增加 `privatePort`（默认 9011，发现报文监听）、`privateSeeds`（`IP` 或 `IP:ENet端口`，用于广播被隔离或本机端口冲突时）。
- 首次启动生成 32 位十六进制私有用户标识，存入 `settings`（`identity.privateId`），后续固定。
- 不新增数据库表；私有消息复用现有消息表，`remote_seq` 存 `MSG_ID`，来源与对方消息号写进 `meta`。

## 11. 失败处理

- 发现报文解析失败、ENet 握手超时、会话超时：记录日志，删除会话，文字走 IPMSG。
- “失败”的判定按阶段划分：交给 ENet 之前的同步异常（加密、组帧、没有会话）立即回落到 IPMSG 发送本条；已经交给 ENet、重传耗尽或等不到 1005 时**不**跨通道重发，消息状态置 `failed`，由用户重试，避免对端界面出现两条内容相同的消息。
- 私有发送保持调用方同步返回：`AppService.sendText` 先写入消息行并返回，状态异步更新为 `delivered` 或 `failed`。
- 对端发送非文字内容：记录日志，不展示；1005 照常回。
- 端口绑定失败：发现端口（9011）被占用时记录日志并继续，私有会话仍可通过 `privateSeeds` 建立；ENet 端口绑定失败时私有通道整体不可用，客户端照常以 IPMSG 运行。

## 12. 测试

单元测试（Vitest，纯 Node）：

- TEA：抓包里的心跳密文、`X_READY` 首块、`X_OPERATE_*` 首块作为向量，加解密往返。
- 帧：抓包帧解码、长度与命令号校验、末尾明文保留。
- ENet：CONNECT/VERIFY/ACK/SEND_RELIABLE/SEND_FRAGMENT 的字节级构造与解析，用抓包原始字节做黄金样例；序号回绕；分片重组。
- 消息层：1004 的 XML 与 JSON 往返；收到多段 `dt`；非文字内容的忽略路径。
- 会话状态机：用可注入的假传输覆盖握手、超时、重传、回落。

联调：

- 回环假对端：Node 脚本模拟 ENet 对端，覆盖握手、乱序、丢包、分片。
- 本机真实样本：同时运行内网通样本与 `pnpm dev`（客户端 `network.port` 改为非 2425，私有种子指向 `127.0.0.1:9012`），从客户端发一条、用样本发一条，确认双方界面、状态、未读与通知。

## 13. 风险与待确认

- 真实内网通是否接受私有用户标识与它不同的会话：抓包中两端标识本就不同，预期可以；联调时验证。
- 真实内网通是否会把未在 9011 通告中登记的会话计入联系人：本机样本联调时验证。
- ENet 的 PING、BANDWIDTH_LIMIT 与对端超时策略需要照抓包验证，参数以实测为准。

## 14. 留给实现者决定

- 模块内部的类划分、事件命名与日志措辞。
- 重传定时器的具体参数、分片缓存的淘汰策略。
- 假对端测试脚本的组织方式。

## 15. 本设计已经定下

- 失败语义：交给 ENet 之前的同步失败才回落 IPMSG；交给 ENet 之后不跨通道重发，状态置 `failed`。
- 联系人身份：只用一张联系人表，维护 `IP → peerKey`，私有会话的在线状态写进这张表。
- 接收侧同时实现 ENet 服务端角色，用于对端主动连接。
- 已读回执按私有入站消息逐条发送，来源写进 `meta`。
- `X_HANDSHARK` 的 `CORP_ID` 与 `X_READY` 的 `USER_ID` 都用本机私有标识。
- 正在输入（1008）只解析、不展示，不进入本次范围。
- 本次不主动广播 9011 通告，只监听；对端主动连接走接收侧实现。
