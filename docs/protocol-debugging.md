# 内网通抓包与协议调试记录

本文记录 2026-10-23 对真实内网通 3.4.3055 的抓包、探针联调结论，以及当前 Electron 客户端在协议和文件传输上实际踩过的坑。目标是下次遇到发现、文字或文件问题时，能直接从 2425 的报文定位，不重复逆向。

## 已确认的互通路径

- 文字和文件的兼容通道是 2425 上的标准 IPMSG，不使用内网通私有 XML。对端会忽略我们发出的 `X_SEND_MSG(1004)`。
- 发现使用 `BR_ENTRY(1)` / `ANSENTRY(3)`。广播的 `BR_ENTRY` 头部是 `1@shiyeline`，种子单播使用版本 `1`。
- 文字使用 `SENDMSG(32) | SENDCHECK(0x100)`，接收方回 `RECVMSG(33)`，正文是原包序号的十进制字符串，末尾带 NUL。
- 文件邀请是 `SENDMSG | SENDCHECK | FILEATTACH(0x200000)`，正文后接 NUL 和附件表；拉取使用 TCP 2425 的 `GETFILEDATA(96)`，版本必须是 `1`。
- 内网通还有 9011/UDP 的私有发现和 ENet 私有会话，聊天载荷加密，当前客户端没有实现，也不应该拿它做兼容。

## 抓包环境

历史抓包环境：

- 本机 `192.168.0.135`，对端 `192.168.0.129`，两端都是真实内网通 3.4.3055。
- 抓包文件在 `../../nwt-re/cap/`：`priv1.pcapng` 是私有发现，`session1.pcapng` 是 341 秒、约 29k 包、42 MB 的双向聊天和文件会话，`file1.pcapng`、`file2.pcapng`、`file3.pcapng` 是文件传输，`msg1.pcapng`、`msg2.pcapng` 是文字消息。
- 抓包工具是 Wireshark/dumpcap，网卡是 `WLAN`。用 `dumpcap -D` 或 `tshark -D` 先确认接口名。

本机双实例联调：

- 两个实例分别设置不同的 `LANPOST_DATA_DIR`、不同的 `network.port`（例如 24250/24251），并在 `network.seeds` 里互相指向。
- 不要占用 2425，真实内网通或旧 Go 客户端经常已经占着这个端口。
- 127.0.0.1 的回环流量需要 Npcap 的 “Adapter for loopback traffic capture”，在物理网卡上抓不到。

常用命令：

```bash
# 列出接口
dumpcap -D

# 抓 UDP 和 TCP 2425
dumpcap -i "WLAN" -f "udp port 2425 or tcp port 2425" -w nwt.pcapng

# 只抓某个对端
tshark -r nwt.pcapng -Y "ip.addr == 192.168.0.129" -w peer.pcapng

# 提取 UDP 载荷（data.data 是原始字节）
tshark -r nwt.pcapng -Y "udp.port == 2425" -T fields \
  -e frame.number -e ip.src -e udp.srcport -e ip.dst -e udp.dstport -e data.data

# 提取 TCP 载荷（GETFILEDATA 请求和文件响应）
tshark -r nwt.pcapng -Y "tcp.port == 2425 && tcp.len > 0" -T fields \
  -e frame.number -e ip.src -e tcp.srcport -e ip.dst -e tcp.dstport -e tcp.payload
```

Wireshark 显示过滤器用 `udp.port == 2425 || tcp.port == 2425`，需要只看文件时用 `tcp.port == 2425 && tcp.len > 0`。

## 读包基础

报文头：

```text
版本:包序号:用户名:主机名:命令:正文
```

- 兼容报文版本是 `1`，私有报文版本是 `1@shiyeline`。
- 包序号是 32 位无符号整数，从启动时的 tick 值递增。
- 命令号带标志位：`0x100` 是 SENDCHECK，`0x200000` 是 FILEATTACH，`0x800000` 是 UTF8。
- `SENDMSG | SENDCHECK` 的十进制命令号是 288；文件邀请的命令号是 `0x200120`，十进制 2097440。
- 正文由 UDP 数据报长度界定，头部本身没有长度字段。

编码：

- IPMSG 兼容层正文使用 GBK；带 `UTF8OPT(0x800000)` 时按 UTF-8 解析。
- 私有 XML 使用 UTF-8，根元素带 `docver="1"`。
- 不要把 `data.data` 先按 UTF-8 转成字符串再处理。中文会变成 `�`，附件长度和 NUL 位置都会错。
- Wireshark 里选 “Show data as Hex Dump”，或用 tshark 拿十六进制，再用 `iconv` 或 Python `bytes.fromhex(...).decode('gbk')` 解码。

## 发现流程

真实内网通的发现应答（ANSENTRY，命令 3）：

```text
1@shiyeline:<seq>:SYSTEM:P9FD:3:P9FD\0内网通联系人\0<corpId>\0
```

- `BR_ENTRY` 正文是 GBK 的 `姓名\0分组\0企业标识\0`。
- 收到 `BR_ENTRY` 后回 `ANSENTRY`，随后双方交换 `X_HANDSHARK(1000)` 和 `X_READY(1018)`。
- 心跳 `X_HEARTBEAT(1016)` 每 30 秒一次，超过 120 秒没有包就判离线。
- 广播地址是 `255.255.255.255` 加上每个网卡的定向广播地址；配置了种子时还会向种子单播 `BR_ENTRY`。
- 种子单播用版本 `1`，广播用 `1@shiyeline`。抓包时不要只过滤版本 `1`，否则会漏掉广播上线。
- 同一主机多网卡时，发现层按 `IP|账号` 建联系人，会出现多个同名对端，这是已知行为。

## 文字消息

真实内网通发来的文字：

```text
1:<seq>:xqkj:DESKTOP-50:32:<GBK 正文>
```

我们发出的文字：

```text
1:<seq>:<账号>:<主机>:288:<GBK 正文>
```

对端收到后回：

```text
1@shiyeline:<seq>:xqkj:DESKTOP-50:33:<原包序号>\x00
```

要点：

- 对端对 `X_SEND_MSG(1004)` 没有任何应答；兼容模式必须走 32/33。
- `RECVMSG` 的正文是十进制序号加结尾 NUL，头部版本带 `@shiyeline`。
- 我们的 `ProtocolEngine` 收到 `SENDCHECK` 后会自动发这条 ACK；对方是 legacy 对端时也发同一格式，实测可接受。
- 正文优先 GBK；只有 GBK 编码失败时才用 UTF-8 并置 `0x800000`。不要对已经是 GBK 的字节做二次编码。

## 文件传输

附件邀请示例：

```text
1:22299:xqkj:DESKTOP-50:2097440:<文本>\x00
0:123 (1).txt:0000000003:2492:1:
```

- 命令号 `2097440` = `SENDMSG(32) | SENDCHECK(0x100) | FILEATTACH(0x200000)`。
- 正文后的 NUL 后是附件表，格式为 `文件ID:文件名:大小(十六进制):修改时间(十六进制):属性(十六进制):`。
- 多项附件用 `\a` 分隔，文件名里的冒号转义为 `::`。
- 这个例子里包序号是 22299（十六进制 `571b`），附件文件 ID 是 0，文件大小是 3 字节。

拉取请求：

```text
1:<seq>:nwtnew:linuxtest:96:571b:0:0:
```

要点：

- 版本必须是不带 `@shiyeline` 的 `1`。带后缀时对端会接受 TCP 连接然后直接关闭，返回 0 字节。
- 扩展域是 `包编号:文件ID:偏移:`，全部十六进制，结尾带冒号，不带 NUL。
- `包编号` 是邀请消息的 UDP 序号，服务端按它匹配发送任务；不要依赖第二个字段。
- 拉取前补发一条：

```text
1@shiyeline:<seq>:<账号>:<主机>:33:<十进制包编号>\x00
```

实测补发后对端界面会显示传输开始并标记发送成功。当前实现由 `sendFileAccept` 负责，legacy 对端由协议引擎的自动 ACK 覆盖。

- TCP 读取首字节超时 3 秒，后续字节空闲 300 毫秒视为请求结束；请求可能带 NUL，也可能不带。
- 未知包编号、版本错误或报文头无法解析时，服务端直接关闭连接，不返回任何字节。
- 对端自己来拉取时，`GETFILEDATA` 的第二个字段是它自己分配的文件句柄，不是附件表里的文件 ID；服务端只按包编号匹配。
- 部分内网通版本会在第一个字段回传自己的任务标识，包编号和文件 ID 都对不上。发送端需要按对端 IP 取最新的 `offered`/`transferring` 任务兜底；Go 版本已经这样做，Electron 版本也补上了这一层。
- 接收文件必须保存 TCP 响应里的原始字节，不能把 UDP 邀请里的文本当成文件内容。

## 私有通道（未实现）

如果以后要做群聊、私有文件通道或远程协助，需要知道这些结论：

- 9011/UDP 上是 304 字节的二进制发现报文，类型 1/2，包含 IP、端口、企业标识和两个 65 字节块。
- 两台真实客户端建立的是 ENet 可靠 UDP 会话，使用临时端口；命令字节 0x82/0x83/0x86/0x88 与 ENet 一致。
- ENet 载荷封装为 `uint32 长度 + uint32 命令号 + 16 字节随机块 + 载荷`。
- 1000/1004/3011 等控制载荷熵约 7.4–7.8，二进制里有 AES 查表，疑似使用 AES 流模式（CTR/CFB/OFB）加密；用企业标识、候选密钥、MD5/SHA 派生和常见模式都没有解出明文。
- 私有文件通道是明文，帧格式为 `uint32 长度 + uint32 版本/类型 + uint32 子类型 + 载荷`，端口由私有报文协商，不固定是 9012–9014。
- 这些内容没有进入当前客户端。兼容模式不要绕到私有通道上，否则对端不响应。

## 排查手册

### 看不到联系人

1. 过滤 `udp.port == 2425`，确认本机是否发出 `BR_ENTRY`。
2. 检查广播地址、种子地址、防火墙入站规则和端口占用。
3. 如果使用种子，确认 seed 写的是 `IP:端口`，对端端口与配置一致。
4. 不要只看 `1:` 版本，广播头是 `1@shiyeline`。

### 文字发出去但对方不显示

1. 看命令号是 32 还是 288；兼容对端需要 `SENDMSG | SENDCHECK`。
2. 检查正文编码和 UTF8 标志。
3. 看对端是否回了 `RECVMSG(33)`；没有 ACK 时先查序号和 NUL。
4. 如果发的是 `X_SEND_MSG(1004)`，这是私有通道，真实内网通兼容层不会回。

### 文件邀请到了但传不动

1. 对端界面一直显示等待建立链接、本机 `startup.log` 里没有 `收到取文件连接`，说明 TCP SYN 没有到达文件服务。优先检查 Windows 防火墙、安全软件的入站 TCP 2425 规则，以及当前 `electron.exe` / `lanpost-im.exe` 是否在白名单里。Go 版本可能已经有放行规则，Electron 是另一个可执行文件。
2. 看 UDP 邀请里的包序号和附件表是否解析正确。
3. 看是否先发了 `RECVMSG(33)`，正文是否为十进制包序号加 NUL。
4. 看 `GETFILEDATA` 的版本是不是 `1`，扩展域是不是十六进制且以冒号结尾。
5. 检查包序号是否超过 32 位。超过时对端会直接断开，返回 0 字节。
6. 检查发送端是否已经把该 `packetId` 登记到 TCP 服务；邀请发出后要立即登记，不能等异步操作。

### 收到 0 字节

优先怀疑三种情况：版本带了 `@shiyeline`、包编号不匹配、序号超过 32 位。服务端对无法解析的请求不会返回错误正文。

### 文件内容不完整

- TCP 读取要读到声明的文件大小，或者连接 EOF；首字节 3 秒、空闲 300 毫秒的超时不能混用。
- 字节数不足时删除半截文件，不要留下可打开的损坏文件。
- 用 SHA-256 对比源文件和接收文件，200,000 字节的本地双实例测试已经验证过一致。

### 中文乱码

- 先用 `bytes.fromhex` 取原始字节，再按 GBK/UTF-8 解码。
- 不要在 Wireshark 的 UTF-8 视图里判断内容。
- XML 私有报文是 UTF-8，IPMSG 兼容正文是 GBK，两条路径不要共用解码器。

### 同名联系人重复

- 同一主机多网卡会产生多个 `IP|账号` 联系人，抓包时确认流量走的是哪个网卡。
- 这是发现层的已知限制，不是消息重复。

## 实现中踩过的坑

- **32 位序号**：文件管理器的 TCP 请求序号曾经用 `Date.now()*1000` 生成，服务端日志报 `报文头 seq 超出范围: 1792751771326001`，请求被丢弃。头部的 seq 必须用 32 位计数器；附件文件 ID 可以更大，两者不能混用。
- **邀请和登记竞态**：`sendFileOffer` 发出 UDP 邀请后，对端可能马上发起 TCP 拉取。`addOutgoing` 必须紧接着在同一个同步代码块里执行，否则服务端按 `packetId` 找不到任务。
- **版本后缀**：`GETFILEDATA` 只用 `1`；文字 ACK 和文件接收确认用 `1@shiyeline`。两者写反时的表现分别是 0 字节和对方无响应。
- **NUL 处理**：UDP 正文长度由数据报界定，不能对整个 payload 做 `trim`；`RECVMSG` 的十进制序号需要保留结尾 NUL 的语义，解析时先按 NUL 边界取字段。
- **TCP 请求边界**：请求可能没有 NUL，不能一直阻塞等 NUL；首字节超时加空闲超时才能覆盖真实客户端。
- **端口双绑**：2425 同时是 UDP 和 TCP，两个服务都要启动；本地测试换到 24250/24251，避免和真实内网通抢端口。
- **附件文件名**：冒号要转义，多个附件用 `\a` 分隔；文件名和正文的编码策略要保持一致。
- **私聊和兼容聊天的边界**：不要用 `X_SEND_MSG` 代替 `SENDMSG`；兼容对端只认后者。

## 本地复现

```powershell
# 终端 A
$env:LANPOST_DATA_DIR="D:\wlr\ai\lanpost-im\.tmp-a"; pnpm dev
# 终端 B
$env:LANPOST_DATA_DIR="D:\wlr\ai\lanpost-im\.tmp-b"; pnpm dev

# 协议和文件层的回归
pnpm exec vitest run src/main/protocol src/main/files
```

每个实例的 `settings.json` 要配置不同的 `network.port` 和互相指向的 `network.seeds`；`LANPOST_DATA_DIR` 只隔离数据目录。正常终端优先 `pnpm dev`，只有 GPU 或沙箱启动失败时才用 `pnpm dev:no-sandbox`。

抓包时把过滤器换成实际端口，例如 `udp.port == 24250 || tcp.port == 24250`。本地回环需要 Npcap loopback 接口；真实局域网联调再切到 WLAN/以太网。

## 抓包文件与隐私

- `session1.pcapng` 约 42 MB，包含真实账号、主机名和聊天内容，不要提交到仓库，也不要直接外发。
- 需要共享时先截取单个会话、删掉无关流量，并对账号、主机名、企业标识做替换。
- `../../nwt-re/cap/` 下的原始抓包只作为本工作区的参考，不进入 `lanpost-im` 仓库。

## 参考

- 设计基线：`docs/superpowers/specs/2026-10-23-electron-client-design.md`
- 原始协议记录（同一工作区）：`../../nwt-re/docs/protocol.md`、`../../nwt-re/docs/private-protocol.md`
- 抓包与解析脚本（同一工作区）：`../../nwt-re/test/dump_payloads.py`、`../../nwt-re/test/frida_*.py`
- 关键抓包：`../../nwt-re/cap/priv1.pcapng`、`session1.pcapng`、`file1.pcapng`、`msg1.pcapng`
