# 内网通私有协议：真机抓包验证（2026-11-12）

本文记录一次完整的真实客户端抓包，用来复核静态逆向结论、补齐字段与修正错误。所有 PII（姓名、企业、部门、邮箱、电话、签名、文件/文件夹名、用户 ID）已替换为占位符。

- 环境：本机 `192.168.2.129`（发送侧）↔ 对端 `192.168.2.125`（接收侧），均为内网通 3.4.3055
- 抓包：`dumpcap -i 以太网 -f "host 192.168.2.125 or udp port 9011" -s 0`，约 258 秒，5712 帧 / 4.7 MB
- 操作：发文字、发单个文件（`<FILE>`，24744 B）、发文件夹（`<FOLDER>`，4372509 B / 3 项）、建群 + 发群消息 + 设公告、离线消息、重连
- 工具：控制面用自写的 ENet/TEA 解码器（逆向工作区，不随本仓库提交），数据面用 `tshark -z follow,tcp,raw`
- **文件通道的字段语义以本仓库已联调通的实现为准**（`src/main/files/private-wire.ts`），本文第 4.2 节保留了抓包当时的猜测并标注了修正

> 结论：静态逆向的控制面（命令号、XML 模板）**全部命中**；数据面（文件/文件夹通道）的静态帧布局**大体正确，但 proto 字段与端口语义需要修正**。

## 1. 发现层（9011/UDP，304 字节）

实测两种报文：

- **type 1 ANNOUNCE**：广播到 `192.168.2.255` 与 `255.255.255.255`，也定向发到对端；`enetPort` 是本机 ENet 端口。
- **type 2 REPLY**：单播回 ANNOUNCE 的源地址。

真实字段（节选）：

| 对端 | userId（32 hex）    | enetPort                    |
| ---- | ------------------- | --------------------------- |
| 本机 | `41d80a7a…`（占位） | 53272                       |
| 对端 | `68e24da0…`（占位） | 50366 / 56701（随会话变化） |

- `ip` 字段对端填自己的 IP，本机广播时填 `0.0.0.0`（用 UDP 源地址路由，与旧结论一致）。
- `bcast` 固定 `192.168.2.255`。
- ENet 端口是**临时端口**，每次会话可能不同；只能从通告里读，不能写死 9012。

## 2. 握手（1000 X_HANDSHARK）——真实值

### 2.1 FEATURE（能力位，值为字符串）

```
MAJOR=3 MINOR=4 BUILD=3055 APP=1
MSG=2:1  FILE_TRAN=1  FOLDER_TRAN=2:1
REMOTE_ASSISTANCE=1  FILE_SHARE=1
QGROUP=2:1  QGROUP_MSG=2:1  QGROUP_FILE=(空)  QGROUP_FOLDER=(空)
OFFLINE_MSG=1  OFFLINE_FILE=1  LAN_UPDATE=1  HIDE_RECORD=1
```

- 同一版本的两端能力位完全一致；`QGROUP_FILE/QGROUP_FOLDER` 为空（本版本群文件不走这两条独立通道，见 §6）。
- 值形如 `2:1` 表示"版本:开关"。

### 2.2 INFO（个人资料）

字段与模板完全一致：`CORP_ID CORP_TIME NAME GROUP CORPORATION DEPARTMENT SEX POST TEL MOBILE EMAIL SIGN SYS_FACE USER_FACE[id] STATUS ACTIVE_SEND ONLINE_POPUP HIDE_IP COLOR_NAME SORT_NAME DECORATE_NAME`。

关键结论：

- **`CORP_ID` 不是 32 位十六进制**：实测是一段二进制/编码混合的不透明块（可能含控制字节和 `&nbsp;`），本机一侧为空。**不能用"32 hex 字符串"解析**，当作不透明字节串原样转发。
- **头像 `USER_FACE id="<n>">` 里是一个 32 位十六进制 MD5**（实测 `<USER_FACE id="13059">0487b245…</USER_FACE>`）。即**握手和 `X_CHANGE_INFO` 只带头像的文件号和 MD5，不带图片本体**；图片本体按文件号另取，见 [nwt-private-protocol.md](nwt-private-protocol.md) §11.2。
- `SYS_FACE` 是一个大整数（系统头像编号）。

### 2.3 NET（传输端口）——真实值

对端（.125）在本会话声明：

```
FILE_TRAN_TCP_PORT=13603        FILE_TRAN_ENET_PORT=0
FOLDER_TRAN_TCP_PORT=13859      FOLDER_TRAN_ENET_PORT=0
FILE_TRAN_TCP_REVERSE_PORT=33742    FILE_TRAN_ENET_REVERSE_PORT=0
FOLDER_TRAN_TCP_REVERSE_PORT=33998  FOLDER_TRAN_ENET_REVERSE_PORT=0
LAN_UPDATE_HTTP_PORT=34254
```

**结论：文件/文件夹的实际端口来自握手的 NET 块，是随会话变化的动态端口，不能写死 9013/9014。** 9013/9014 只是本机的默认监听/回退端口（见 §4、§5 的实际连接）。`*_ENET_PORT` 本版本全为 0，即传输走纯 TCP。

## 3. 文字（1004 / 1005 / 1006 / 1007 / 1008）

在线消息（节选，`test-text-1` 是测试内容）：

```xml
<X_SEND_MSG docver="1">
  <MSG_ID>1</MSG_ID><RECEIPT>0</RECEIPT>
  <MSG>{ "app":"shiyeline", "dt":[{"txt":{"t":"normal","v":"test-text-1"}}],
        "ft":{"b":"0","c":"0x000000","i":"0","n":"微软雅黑","s":"9","u":"0"},
        "id":"&lt;32hex&gt;","type":"0","ver":"6.0" }</MSG>
  <MSG_TIME>0</MSG_TIME><OFFLINE>0</OFFLINE><HIDE_RECORD>0</HIDE_RECORD>
</X_SEND_MSG>
```

- 在线消息 `MSG_TIME=0`；**离线消息 `MSG_TIME` 是 Unix 秒**（实测 `1794453082`，不是毫秒），且 `OFFLINE=1`。
- `MSG` 内 JSON 的空格写成 `&nbsp;`、引号写成 `&quot;`——与旧文档一致，**这是内网通的私有转义，不是标准 XML 实体**（`&nbsp;` 不是合法 XML 实体，解析时要先还原）。
- 1005 ACK 只带 `MSG_ID`；1006 回执同理；1008 `TYPE=0` 表示"正在输入"。

## 4. 文件（1009 / 1010 / 1011 / 1012 / 1019）与数据通道

### 4.1 控制命令（节选）

```xml
<X_SEND_FILE docver="1"><TASK_ID>1</TASK_ID><FILE_ID>15522</FILE_ID>
  <NAME>&lt;FILE&gt;</NAME><PWD></PWD><SIZE>24744</SIZE>
  <LAST_MODIFY>134310563110000000</LAST_MODIFY><OFFLINE>0</OFFLINE></X_SEND_FILE>

<X_OPERATE_SEND_FILE docver="1"><TASK_ID>1</TASK_ID><OP>2</OP></X_OPERATE_SEND_FILE>
<X_OPERATE_RECV_FILE docver="1"><TASK_ID>1</TASK_ID><OP>2</OP></X_OPERATE_RECV_FILE>

<X_PROGRESS_RECV_FILE docver="1"><TASK_ID>1</TASK_ID>
  <TOTAL_SIZE>24744</TOTAL_SIZE><RECVD_SIZE>24744</RECVD_SIZE>
  <SPEED>未知速度，剩余时间: 未知</SPEED></X_PROGRESS_RECV_FILE>
```

- `NAME` 是**完整路径**，不是 basename。
- `LAST_MODIFY` 是 Windows FILETIME（100ns tick）。
- **`OP=2` 在传输开始阶段出现（收发双方都发 OP=2）**，含义应为"接受/开始"。OP 的暂停/取消值本次未触发（见 §9）。
- `X_REVERSE_FILE_REQ` 的 `TASK_ID` 实测与发送方 `X_SEND_FILE` 的 `TASK_ID` 不同（对端用自己的任务号），匹配要靠 `FILE_ID`/通道，不能只靠 TASK_ID。

### 4.2 数据通道（TCP）——修正

实际文件字节连接：`192.168.2.129:9013 ↔ 192.168.2.125:<临时端口>`。帧格式（实测）：

```
u32 BE len（含自身） | u32 BE proto | u32 BE cmd | 载荷
```

- **`proto = 1` 表示文件通道**（本文件通道实测全为 1）。
- `cmd=1..4`：抓包时按长度猜成“1=握手/协商（500 B）、2=小结构（108 B）、3=XML 片段（108 B）、4=文件数据（24844 B，内含原始文件字节）”。加上 12 字节帧头后与已实现的语义对得上：**1=HELLO（488 B 载荷）、2=ACK（96 B）、3=PATH（96 B）、4=DATA（88 字节头 + 数据，32 KiB 一片）**，另有 `cmd=100` 的窗口帧用于反向推送图片。字段偏移见 [nwt-file-channel.md](nwt-file-channel.md)。
- 文件数据帧长度 ≈ 文件大小 + 100 字节（12 字节帧头 + 88 字节数据帧头）。
- 明文，无 TEA、无 MD5/SHA/CRC（与静态结论一致）。

## 5. 文件夹（1013 / 1014 / 1015 / 1020）与数据通道

### 5.1 控制命令（节选）

```xml
<X_SEND_FOLDER docver="1"><TASK_ID>fc8467cf…（GUID 字符串）</TASK_ID>
  <FOLDER_NAME>&lt;FOLDER&gt;</FOLDER_NAME><FOLDER_SIZE>4372509</FOLDER_SIZE>
  <MAX_ITEM_PATH>41</MAX_ITEM_PATH><MAX_ITEM_SIZE>4073951</MAX_ITEM_SIZE>
  <OFFLINE>0</OFFLINE></X_SEND_FOLDER>

<X_OPERATE_SEND_FOLDER docver="1"><TASK_ID>fc8467cf…</TASK_ID><OP>2</OP></X_OPERATE_SEND_FOLDER>
<X_OPERATE_RECV_FOLDER docver="1"><TASK_ID>fc8467cf…</TASK_ID><OP>2</OP></X_OPERATE_RECV_FOLDER>
```

- **文件夹 `TASK_ID` 是 GUID 字符串**（文件是十进制数字）——这是文件和文件夹必须分流的硬约束。

### 5.2 数据通道（TCP）——与静态文档一致

实际连接：`192.168.2.129:<临时端口> → 192.168.2.125:9014`。帧格式（实测）：

```
u32 BE len(含自身) | u32 BE proto(=2) | u32 BE cmd | 20 字节保留 | 300 字节 sChnnlId(UTF-16LE 的 TASK_ID) | 载荷
```

- **`proto = 2` 表示文件夹通道**。
- cmd：`1`=开始（最小 684 B）、`2`=接受（672 B）、`3`=文件项清单（每项约 635 B，实测 3 项 = 1981 B）、`4`=进度、`5`=文件项数据（内含原始字节，可看到 `50 4b 03 04`）。
- `sChnnlId` 是 **UTF-16LE** 的 TASK_ID（静态文档曾猜 ANSI）。

## 6. 群聊（3002 / 3003 / 3004 / 3005 / 3011）

```xml
<!-- 群信息推送：公告 QGROUP_ANN 就在这里 -->
<X_QGROUP_PUSH_INFO docver="1"><INFO>
  <QGROUP_ID>d11cd974…（32hex）</QGROUP_ID><QGROUP_NAME>&lt;GROUP_NAME&gt;</QGROUP_NAME>
  <QGROUP_MASTER>&lt;MASTER_ID&gt;</QGROUP_MASTER>
  <QGROUP_INTR>46654</QGROUP_INTR><QGROUP_ANN>564645</QGROUP_ANN>
  <QGROUP_INFO_VER>3</QGROUP_INFO_VER><QGROUP_USER_VER>2</QGROUP_USER_VER>
  <QGROUP_ALLOW_OTHER_ADD>0</QGROUP_ALLOW_OTHER_ADD><QGROUP_PHOTO_MD5></QGROUP_PHOTO_MD5>
</INFO></X_QGROUP_PUSH_INFO>

<!-- 成员推送：成员是 <ID name="...">hex</ID> 列表 -->
<X_QGROUP_PUSH_USER docver="1"><INFO>…</INFO><USER>
  <ID name="&lt;NAME_A&gt;">&lt;ID_A&gt;</ID><ID name="&lt;NAME_B&gt;">&lt;ID_B&gt;</ID>
</USER></X_QGROUP_PUSH_USER>

<!-- 群消息 -->
<X_QGROUP_SEND_MSG docver="1"><QGROUP_ID>d11cd974…</QGROUP_ID>
  <MSG_ID>2</MSG_ID><MSG>{ …JSON 同私聊… }</MSG><HIDE_RECORD>0</HIDE_RECORD></X_QGROUP_SEND_MSG>
```

- **群公告 = `INFO/QGROUP_ANN`**（实测 `564645`），群介绍 = `QGROUP_INTR`（实测 `46654`）。
- **实测确认模板 bug**：`<QGROUP_INFO_VER>3</GROUP_INFO_VER>` 的闭合标签**真的少了一个 `Q`**，线上就是这样发的。解析时要容忍。
- 3005 `X_QGROUP_REQ_INFO_RSP` 实测 `RET=20`（不是 0）。语义待确认（可能是"成功 + 条目数/标志"）。
- 群消息没有独立 ACK 模板（与静态结论一致），靠 ENet 可靠通道保证送达。

## 7. 离线（1022 / 1023 + OFFLINE 标志）

实测时序：

1. 发送方发 `X_SEND_MSG`，`OFFLINE=1`，`MSG_TIME=<Unix 秒>`。
2. 发送方发 `X_OFFLINE_SEND_COMPLETED`，`TYPE=0`。
3. 接收方收到后回 `X_SEND_MSG_ACK`，并发 `X_OFFLINE_DELETE`，`TYPE=0`。

确认"发送方本地队列 + 对方上线后推送 + 完成后删除"的模型，无中心服务器。

## 8. 对既有文档的修正

| 项             | 旧结论            | 实测修正                                                                                                                                                         |
| -------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 正文加密       | TEA               | 本仓库的 TEA 实现（32 轮、密钥 `8asfhj@k7*20hbla`）与真实客户端双向互通，控制面所有帧都用它；抓包侧当时换用 XTEA 才能解出心跳，结论未能在联调中复现，按 TEA 处理 |
| 命令空间       | 1000–1064 连续    | **4 段 51 条**（1000–1025 / 3000–3012 / 4000–4001 / 5000–5009）                                                                                                  |
| 数据通道 proto | 文件/文件夹都为 2 | **文件=1，文件夹=2**                                                                                                                                             |
| 传输端口       | 固定 9013/9014    | **来自握手 NET，动态**；9013/9014 只是默认监听/回退                                                                                                              |
| 头像           | 未明确            | 握手 `USER_FACE` 带 **文件号 + MD5**；取图连对端 9013，走 HELLO/ACK/PATH/DATA，文件是 96×96 PNG                                                                  |
| `CORP_ID`      | 32 hex            | **不透明二进制/编码块**，不能按 hex 解析                                                                                                                         |
| 模板 bug       | 疑似              | `</GROUP_INFO_VER>` 少 `Q` **线上确认**                                                                                                                          |
| `MSG_TIME`     | 0 / 毫秒          | 在线=0；**离线=Unix 秒**                                                                                                                                         |

## 9. 本次未覆盖（需再抓）

- `X_OPERATE_*` 的 `OP` 其它值（暂停/继续/取消）——本次只触发到 OP=2。- 文件数据通道 `cmd=1..3` 的精确字段（含那段不透明块）。
- `X_QGROUP_REQ_INFO_RSP` 的 `RET=20` 语义。
- 共享文件柜（5000–5009）与远程协助（4000–4001）未触发。

## 10. 复现

```bash
# 抓包（对端 .125）
dumpcap -i 以太网 -f "host 192.168.2.125 or udp port 9011" -s 0 -w live.pcapng

# 控制面解码（逆向工作区的解码器，按 ENet + TEA 还原 XML）
tshark -r live.pcapng -Y "udp and data.data" -T fields \
  -e frame.number -e ip.src -e udp.srcport -e ip.dst -e udp.dstport -e data.data \
  | awk -F'\t' '$6!=""{print $1, $2":"$3, $4":"$5, $6}' > live-udp.txt
node decode.mjs live-udp.txt

# 数据面：重组 TCP 流
tshark -r live.pcapng -q -z follow,tcp,raw,<stream>
```
