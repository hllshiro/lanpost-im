# 文件传输状态机与故障排查

更新：2026-10-26（0.1.0）

文件传输只使用标准 IPMSG：UDP 发邀请，TCP 拉取文件或目录。发送与接收共用协议端口（默认 2425）。

## 流程

1. 发送方通过 UDP 发送 `SENDMSG | SENDCHECK | FILEATTACH`，报文序号就是 `packetId`。
2. 接收方回 `RECVMSG`，载荷是十进制 `packetId` 加 NUL。
3. 接收方建立 TCP 连接，连到发送方的文件服务端口。
4. 单文件：发送 `GETFILEDATA(0x60)`，扩展域 `packetId:fileId:offset:`，全部十六进制。
5. 目录：发送 `GETDIRFILES(0x62)`，扩展域 `packetId:fileId`，发送方返回目录流。
6. 接收方按附件大小或目录流头写入文件/目录；完成或失败后更新任务状态。

## 任务类型

| 类型 | 触发 | 说明 |
| --- | --- | --- |
| `file` | 普通附件 | 支持 offset 续传；同名自动生成 `名称 (1).扩展名` |
| `dir` | 附件类型 `DIR (0x02)` | 接收方先写 `.lanpost-<taskId>` 临时目录，成功后原子改名；无断点续传 |
| `image` | 附件类型 `CLIPBOARD (0x20)` | 自动接受到 `images/`，一次邀请只产生一条消息与多张缩略图 |

## 目录流

```text
headerSize:name:size:attr[:ext=val...]:
```

- `headerSize` 是从该字段开始到内容前最后一个冒号的十六进制字节数，包含自身与末尾冒号。
- 文件名中的 `:` 转义为 `::`；`size`、`attr`、扩展属性键值都是十六进制。
- 根目录也会发送 DIR 头；接收方栈空时用附件名作为根名。
- 每层目录以 `RETPARENT` 结束，根的 `RETPARENT` 是最后一帧。
- 接收方拒绝 `..`、绝对路径、盘符、NUL 和控制字符，所有路径限制在临时目录内。
- 符号链接、设备文件、FIFO、资源分支跳过；mtime 与只读标志会应用。

## 发送方状态

| 状态 | 进入条件 | 说明 |
| --- | --- | --- |
| `offered` | 邀请发出、任务登记完成 | 等待对端接收并拉取 |
| `transferring` | 首次匹配到拉取请求并开始写流 | 收到任何字节前也可能短暂显示 0% |
| `done` | TCP 流完整发送 | `received` 应等于文件大小或目录数据量 |
| `rejected` | 收到 `RELEASEFILES` | 对端拒绝或取消，任务停止 |
| `failed` | 打开、读取或写入文件失败 | `error` 记录具体原因 |
| `canceled` | 用户取消 | 不再接受新的拉取请求 |

`RECVMSG` 只说明对端收到了邀请，真正开始传输以 TCP 拉取为准。

## 接收方状态

| 状态 | 进入条件 | 说明 |
| --- | --- | --- |
| `waiting` | 收到附件邀请 | 等待用户接收或自动接收策略 |
| `transferring` | 用户接收，发出确认并开始拉取 | 排队期间也显示在传输中 |
| `done` | 文件字节数匹配或目录根 RETPARENT | 路径写入数据库 |
| `rejected` | 用户拒绝 | 发送 `RELEASEFILES`，发送方标记为已拒绝 |
| `failed` | 连接、读取或写盘失败 | 半截文件或临时目录会被删除 |
| `canceled` | 用户取消 | 中止拉取并通知发送方 |

## 任务匹配

发送方按以下顺序匹配拉取请求：

1. `packetId` 相同，并且 TCP 来源 IP 与邀请对端 IP 相同。
2. 附件文件 ID 匹配。
3. 该对端最新的 `offered` 或 `transferring` 任务。

第 3 条是兼容兜底。同一对端同时有多个待发送任务时可能选到最新任务；正常 packetId 匹配会优先命中，异常时按日志确认。

## 常见故障

| 现象 | 优先检查 | 处理 |
| --- | --- | --- |
| 对方显示等待，本机没有 `收到取文件连接` | 入站 TCP 2425、防火墙、安全软件 | 设置 → 网络 → 防火墙修复；确认端口监听 |
| 有连接日志，但出现 `忽略未知的取文件请求` | 版本、字段、packetId、seq | 确认版本是 `1`，扩展域是十六进制冒号格式，seq 未超过 32 位 |
| 发送方一直 `offered` | TCP 未到达或匹配失败 | 先看连接日志；没有连接查网络/防火墙，有连接查未知请求日志 |
| 目录接收后多一层/少一层 | 根 DIR 头处理 | 接收方栈空时第一个 DIR 是根，使用附件名；首帧非 DIR 按隐式根处理 |
| 目录传输到一半失败 | TCP 超时、写盘失败、路径不安全 | 查看 `error`；临时目录会被清理，需要整目录重试 |
| 图片不显示 | 任务未完成或媒体协议 | 确认任务 `kind=image` 且 `state=done`；检查 `lanpost-media://file/<taskId>` |
| 拒绝后发送方仍显示等待 | `RELEASEFILES` 未送达 | 检查对端是否支持该命令；本实现会发送并清空任务 |
| 同名文件重复 | 接收目录已有文件 | 自动生成 `名称 (1).扩展名` |

## 关键约束

- 端口同时承载 UDP 和 TCP；修改端口或监听地址后必须重启。
- Windows 防火墙按程序路径放行；Linux deb 规则按默认端口添加，修改端口后需要再点一次修复。
- 未知包编号、版本错误、报文头无法解析时，服务端关闭连接，不返回错误正文。
- 接收目录由 `files.receiveDir` 决定；留空时使用 `Downloads\内网传书`，不可写时回退到 `<userData>\recv`。
- 修改接收目录后需要重启文件服务。
- 目录传输没有 offset 语义，不支持断点续传。

## 调试入口

- 日志：`startup.log` 中的 `收到取文件连接`、`忽略未知的取文件请求`、`文件服务启动`。
- 代码：`src/main/files/manager.ts`（任务、匹配、状态）、`server.ts`（TCP 请求与流）、`client.ts`（单文件拉取）、`dir-sender.ts` / `dir-receiver.ts`（目录流）、`src/main/app-service.ts`（发送、接收、事件）、`src/main/firewall.ts`（防火墙检测与修复）。
- 协议：`src/main/protocol/engine.ts` 的 `sendFileOffer`、`sendFileAccept`、`releaseFiles`。
- 测试：`pnpm exec vitest run src/main/files src/main/protocol`。
- 抓包和报文：`docs/04-参考资料/protocol-debugging.md`。
