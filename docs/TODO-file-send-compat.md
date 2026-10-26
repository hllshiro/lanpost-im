# 文件发送兼容修复 TODO

日期：2026-10-26
范围：我们主动向 NWT 或飞秋发送文件时，对端停在“正在连接”，本机没有完成 TCP 拉取。反向（NWT/飞秋发给我们）正常。

## 背景与目标

- 最终目标：替代 NWT，兼容飞秋、飞鸽等 IPMSG 程序，并与 NWT 保持基本文字和文件收发兼容。
- 两个不同对端都在同一处失败，优先按“入站 TCP 2425 没有到达文件服务”处理，不要先改报文头。
- 反向正常说明出站 TCP 没问题；失败方向要求对端主动连接我们的 TCP 服务。

## P0：确认入站链路

- [ ] 检查本机 `startup.log`：
  - [ ] 有 `文件服务启动: TCP ...:2425`。
  - [ ] 发送文件后是否出现 `收到取文件连接: IP:端口`。
  - [ ] 是否有 `file service start failed`。
- [ ] 确认 TCP 2425 监听地址是 `0.0.0.0` 或 `::`，不能只有 `127.0.0.1`。
- [ ] 确认 2425 的 TCP 监听进程是我们的客户端，不是 NWT、飞秋或其他程序。
- [ ] 从对端执行 `Test-NetConnection <本机IP> -Port 2425`，记录 `TcpTestSucceeded`。
- [ ] 检查运行客户端的机器的 Windows 防火墙和第三方安全软件是否放行：
  - 开发版：`electron.exe`。
  - 安装版：`lanpost-im.exe`。
- [ ] 在本机抓包：`tcp port 2425 and host <对端IP>`，区分：
  - 没有 SYN：对端没有连过来，检查 IP、端口、路由、握手声明。
  - 有 SYN 没有 SYN-ACK：本机防火墙或安全软件拦截。
  - 有 SYN-ACK 没有 `GETFILEDATA`：对端在等待其他通道。
  - 有 `GETFILEDATA` 没有文件数据：进入 P1 的任务匹配排查。

命令参考：

```powershell
Get-NetTCPConnection -LocalPort 2425 -State Listen |
  Select-Object LocalAddress,LocalPort,OwningProcess

Test-NetConnection <本机IP> -Port 2425
```

## P0：修复监听与防火墙

- [ ] 兼容模式固定端口 2425；`network.bindAddr` 必须为 `0.0.0.0`。
- [ ] 安装包增加 NSIS 防火墙规则，按程序路径允许入站 TCP/UDP 2425：
  - [ ] 添加 `build/installer.nsh`。
  - [ ] 在 `electron-builder.yml` 中配置 `nsis.include`。
  - [ ] 安装时创建规则，卸载时删除规则。
- [ ] 开发环境文档补充：手动放行当前 `electron.exe` 的入站 2425，或用测试机防火墙例外验证。
- [ ] 文件服务启动失败时，在界面和 `startup.log` 明确提示，不能让发送方一直停在“等待对方接收”。
- [ ] 监听地址或端口配置为 `127.0.0.1`、非 2425 时给出警告。

## P1：发送端与文件服务稳健性

- [ ] 发送文件时先登记 outgoing 任务，再发 UDP 邀请，和 Go 版本保持一致，消除快速自动接收的竞态。
- [ ] 保持 `FILE_TRAN_ENET_PORT = 0`，只广告 TCP 文件端口，不把对端引到未实现的 ENet。
- [ ] 文件服务继续接受 `GETFILEDATA` 的两种版本：
  - [ ] 标准 `1`。
  - [ ] `1@shiyeline`。
- [ ] 任务匹配顺序：packetId + 对端 IP、文件 ID、同 IP 最新的 `offered`/`transferring` 任务。
- [ ] TCP 请求读取支持无 NUL、首字节 3 秒、空闲 300 毫秒结束的边界。
- [ ] 增加测试：未知包编号、版本错误、seq 超过 32 位、文件不完整时的行为。

## P2：IPMSG 族兼容层

- [ ] 给 `Header`/`Peer` 增加 `headerStyle`：
  - [ ] `standard`：`1:`，飞鸽/普通 IPMSG。
  - [ ] `nwt`：`1@shiyeline:`。
  - [ ] `feiq`：`1_lbt80_0#...#9:` 外层头。
- [ ] 解析后归一化；回复和对端保持同一风格。
- [ ] 文字通道：
  - [ ] NWT 未完成私有握手时走 `SENDMSG`。
  - [ ] 飞秋/普通 IPMSG 走标准 `SENDMSG`。
  - [ ] 只有私有握手完成的自有客户端才走 `X_SEND_MSG`。
- [ ] 文件拉取版本按对端选择：
  - [ ] NWT 作为发送方：`1`。
  - [ ] 从飞秋拉取：按抓包使用 `1@shiyeline`。
- [ ] 发送给 NWT 继续使用标准 `SENDMSG | FILEATTACH`；不要为了飞秋把 NWT 路径改成 `lbt80`。
- [ ] 飞秋的 `lbt80` 邀请需要补单测：字段拆分、packetId、附件表、文件大小。

## P3：验证矩阵

| 场景            | 期望                       | 证据                             |
| --------------- | -------------------------- | -------------------------------- |
| 我们 → NWT 文件 | 对端接收完成，SHA-256 一致 | 对端界面、`收到取文件连接`、抓包 |
| 我们 → 飞秋文件 | 对端接收完成，SHA-256 一致 | 对端界面、`收到取文件连接`、抓包 |
| NWT → 我们文件  | 正常接收，SHA-256 一致     | 本机文件与日志                   |
| 飞秋 → 我们文件 | 正常接收，SHA-256 一致     | 本机文件与日志                   |
| 双向文字        | 发送、送达、已读状态正常   | 两端界面与日志                   |

验收标准：

- [ ] 两种对端的发送文件都不再停在“正在连接”。
- [ ] 安装版在默认 Windows 防火墙机器上无需手动加规则即可接收。
- [ ] 关闭防火墙或手动放行后，如果问题消失，确认是部署问题而非协议问题。
- [ ] `pnpm typecheck`、`pnpm test`、`pnpm build` 通过。
- [ ] 真实对端回归记录写入 `docs/protocol-debugging.md` 或后续抓包文档。

## 不做

- 不在 P0 未确认前修改 NWT 标准邀请报头。
- 不在私有 ENet 控制载荷未解密前广告 ENet 文件端口。
- 不用管理员权限启动开发版来“修复”网络问题。
- 不提交包含真实账号、主机名和聊天内容的 pcap。

## 参考

- `docs/file-transfer.md`
- `docs/nwt-compatibility.md`
- `docs/protocol-debugging.md`
- `AGENTS.md`
