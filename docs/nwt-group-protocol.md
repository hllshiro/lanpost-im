# 内网通私有群聊协议

本文记录 2026-11-12 在本机真实内网通（192.168.2.119）与对端（192.168.2.125）之间抓到的群操作，命令号来自 `docs/nwt-command-map.md`，正文是解密后的 XML 原文。

- 承载：9011/9012 的 ENet 可靠通道，应用帧 `[u32 总长][u32 命令号][TEA 密文]`，与私聊文字同一套封装。
- 群没有服务器：群信息靠成员之间互相推送，`QGROUP_MASTER` 是创建者的 32 位十六进制用户号。
- 抓包与解码工具：临时脚本 `.dev-data/ghidra/decode-enet.mjs`（tshark 导出 UDP 载荷 → ENet 解包 → TEA 解密）。

## 1. 命令表

| 命令号 | 名称 | 方向 | 说明 | 样本 |
| ---: | --- | --- | --- | --- |
| 3000 | `X_QGROUP_INVITE` | 邀请人 → 被邀请人 | 带完整 `INFO`（群资料） | 未抓到 |
| 3001 | `X_QGROUP_INVITE_RSP` | 被邀请人 → 邀请人 | `USER_NAME` + `ACTION` | 未抓到 |
| 3002 | `X_QGROUP_PUSH_INFO` | 成员 → 成员 | 群资料变更（名称/主题/公告/版本） | 已抓 |
| 3003 | `X_QGROUP_PUSH_USER` | 成员 → 成员 | 群资料 + 成员列表 | 已抓 |
| 3004 | `X_QGROUP_REQ_INFO` | 成员 → 成员 | 拉取群资料 | 未抓到 |
| 3005 | `X_QGROUP_REQ_INFO_RSP` | 成员 → 成员 | 群资料应答（短/长两版，`RET=20`） | 未抓到 |
| 3006 | `X_QGROUP_REQ_USER` | 成员 → 成员 | 拉取成员列表 | 未抓到 |
| 3007 | `X_QGROUP_REQ_USER_RSP` | 成员 → 成员 | 成员列表应答（短/长两版） | 未抓到 |
| 3008 | `X_QGROUP_DISMISS` | 群主 → 成员 | 解散群 | 未抓到 |
| 3009 | `X_QGROUP_EXIT` | 成员 → 群 | 退群 | 未抓到 |
| 3010 | `X_QGROUP_KICK` | 群主 → 成员 | 踢人 | 未抓到 |
| 3011 | `X_QGROUP_SEND_MSG` | 成员 → 成员 | 群消息，无独立 ACK | 已抓 |
| 3012 | `X_QGROUP_OTHER_INVITE` | 成员 → 成员 | 通知既有成员“有人被拉进来了” | 未抓到 |

## 2. 抓到的原文

### 2.1 `3003 X_QGROUP_PUSH_USER`（建立群时推送成员）

```xml
<X_QGROUP_PUSH_USER docver="1"><INFO><QGROUP_ID>75812b7ebb439840afd7577d18f0731f</QGROUP_ID><QGROUP_NAME>笔记本2，上网机PC3</QGROUP_NAME><QGROUP_MASTER>3d2f84b92bd3d542839590568661971c</QGROUP_MASTER><QGROUP_INTR></QGROUP_INTR><QGROUP_ANN></QGROUP_ANN><QGROUP_INFO_VER>2</GROUP_INFO_VER><QGROUP_USER_VER>2</QGROUP_USER_VER><QGROUP_ALLOW_OTHER_ADD>0</QGROUP_ALLOW_OTHER_ADD><QGROUP_PHOTO_MD5></QGROUP_PHOTO_MD5></INFO><USER><ID name="笔记本2">3d2f84b92bd3d542839590568661971c</ID><ID name="上网机PC3">68e24da0fa70794981775dd7dbfb7c6f</ID></USER></X_QGROUP_PUSH_USER>
```

- 成员写在 `<USER>` 里，每项 `<ID name="显示名">32 位用户号</ID>`。
- 默认群名是成员名用中文逗号拼起来的：`笔记本2，上网机PC3`。
- `<QGROUP_INFO_VER>` 的分组资料版本每改一次加一，成员变更用 `QGROUP_USER_VER`。

### 2.2 `3002 X_QGROUP_PUSH_INFO`（改群名/主题/公告之后的推送）

```xml
<X_QGROUP_PUSH_INFO docver="1"><INFO><QGROUP_ID>75812b7ebb439840afd7577d18f0731f</QGROUP_ID><QGROUP_NAME>测试群222</QGROUP_NAME><QGROUP_MASTER>3d2f84b92bd3d542839590568661971c</QGROUP_MASTER><QGROUP_INTR>主题1</QGROUP_INTR><QGROUP_ANN>公告2</QGROUP_ANN><QGROUP_INFO_VER>3</GROUP_INFO_VER><QGROUP_USER_VER>2</QGROUP_USER_VER><QGROUP_ALLOW_OTHER_ADD>0</QGROUP_ALLOW_OTHER_ADD><QGROUP_PHOTO_MD5></QGROUP_PHOTO_MD5></INFO></X_QGROUP_PUSH_INFO>
```

- `QGROUP_INTR` 就是客户端里显示的“主题”，`QGROUP_ANN` 是群公告。
- 闭合标签确实是 `</GROUP_INFO_VER>`，少一个 `Q`，线上就是这样发的，解析要容忍。

### 2.3 `3011 X_QGROUP_SEND_MSG`（群消息）

```xml
<X_QGROUP_SEND_MSG docver="1"><QGROUP_ID>75812b7ebb439840afd7577d18f0731f</QGROUP_ID><MSG_ID>1</MSG_ID><MSG>{ ... 与私聊相同的 JSON ... }</MSG><HIDE_RECORD>0</HIDE_RECORD></X_QGROUP_SEND_MSG>
```

- `<MSG>` 里的 JSON 与私聊文字完全一致（`app`、`dt[].txt`、`ft`、`id`、`type`、`ver`），空格写成 `&nbsp;`、引号写成 `&quot;`。
- 没有 `X_QGROUP_SEND_MSG_ACK`，送达靠 ENet 可靠通道本身。
- `MSG_ID` 是发送方自己递增的序号，用来去重。

### 2.4 `3011` 里的图片

群图片就是一条普通群消息，`dt` 里只有 `img` 节点（不要再带 `txt` 占位，否则对端会在图片下面多画一行文字）：

```json
"dt": [
  { "img": { "t": "feihu", "v": "<文件号>|<md5>" } }
]
```

- 每个成员收到卡片后各自发 `X_REVERSE_FILE_REQ(1019)`，发送方按成员逐个反向推送原图，走的就是私聊文件通道那一套。
- 发送方要按“文件号 + 对端 IP”记录待推状态，同一个文件号会被多个成员分别拉取。

### 2.5 群文件下载回执（`1025`）

成员把群文件拉完以后，会发一条 `X_REMIND_FILE` 给发送方，`GROUP_ID` 是群号，`FILE_NAME` 用的是最初那条 `file2.v` 里的路径：

```xml
<X_REMIND_FILE docver="1"><GROUP_ID>b1eea1ca794d894d9cd8284932e97892</GROUP_ID><FILE>1</FILE><FILE_SIZE>11</FILE_SIZE><FILE_NAME>C:\Users\Public\Nwt\cache\recv\私有联调\probe-folder(297)\中文.txt</FILE_NAME></X_REMIND_FILE>
```

发送方据此在文件卡片上显示“谁下载了”。

### 2.6 群文件的请求与应答（`5004` / `5005`）

```xml
<X_SHARE_DOWNLOAD_FILE docver="1"><REQ_ID>1</REQ_ID><SHARE_ID>64b54fba42f929418d2e14b703cf16c5</SHARE_ID><SHARE_PATH></SHARE_PATH><SHARE_PWD></SHARE_PWD><CHECK_PWD>0</CHECK_PWD><GO_ON>0</GO_ON></X_SHARE_DOWNLOAD_FILE>

<X_SHARE_DOWNLOAD_FILE_RSP docver="1"><ERR>0</ERR><REQ_ID>1</REQ_ID><FILE_ID>13066</FILE_ID><FILE_SIZE>11</FILE_SIZE><LAST_MODIFY>1794455042</LAST_MODIFY></X_SHARE_DOWNLOAD_FILE_RSP>
```

- `SHARE_ID` 就是群消息 `file2.i`；`REQ_ID` 由接收方自增，应答里原样带回。
- 拿到 `FILE_ID` 之后，接收方连发送方的 **9013**（实测公布的文件端口 13603 是关的），用文件通道的 HELLO/ACK/PATH/DATA 把数据收下来。

### 2.7 群管理命令（`3004` / `3005` / `3008` / `3009` / `3010`）

```xml
<X_QGROUP_REQ_INFO docver="1"><QGROUP_ID>7ad4b2b4f0213b4a832fc807632bc23b</QGROUP_ID></X_QGROUP_REQ_INFO>

<X_QGROUP_REQ_INFO_RSP docver="1"><RET>20</RET><QGROUP_ID>7ad4b2b4…</QGROUP_ID><INFO>…完整群资料…</INFO></X_QGROUP_REQ_INFO_RSP>

<X_QGROUP_DISMISS docver="1"><QGROUP_ID>0294121576ef584b821ef3f3cd0ecc04</QGROUP_ID></X_QGROUP_DISMISS>
<X_QGROUP_EXIT docver="1"><QGROUP_ID>7f414658e80421479d52419569b50e28</QGROUP_ID></X_QGROUP_EXIT>
<X_QGROUP_KICK docver="1"><QGROUP_ID>2ac5a2e8617ce84983597dda5ae7cee0</QGROUP_ID></X_QGROUP_KICK>
```

- 解散、退群、踢人都只带群号：解散发给全体成员，踢人发给被踢的人，退群发给其余成员。
- 成员进群/重连时会发 `3004` 拉群资料，应答 `3005` 的 `RET` 实测固定为 `20`，`INFO` 与推送里的结构一致（群名里的空格会写成 `&nbsp;`）。

## 3. 时序（实测）

```
建群方                                    被邀请人
  |-- 3000 INVITE（INFO + 成员） --------->|
  |<-- 3001 INVITE_RSP（ACTION）-----------|
  |-- 3003 PUSH_USER（INFO + 成员）------->|
  |-- 3011 SEND_MSG ---------------------->|
  |-- 3002 PUSH_INFO（改资料后）----------->|
```

真实抓包里建群完成后只看到 `3003`、`3011`、`3002`，邀请与应答发生在抓包开始之前。

## 4. 群里的文件夹（离线文件语义）

往群里发文件夹不会走私有文件夹通道，而是一条普通群消息，`dt` 里带 `txt`（兼容提示）和 `file2`：

```json
"dt": [
  { "txt": { "t": "compatible", "v": "对方给您发送了一个离线文件，当前版本不支持。请升级到最新版本接收此文件。" } },
  { "file2": { "a": "false", "i": "daef8cfebeebda449a2b2e90f52c37f2", "s": "0", "t": "offline_folder", "v": "C:\\Users\\xqkj\\Desktop\\测试文件夹" } }
],
"ft": { "s": "10" }
```

- `t` 是类型：`offline_folder`（文件夹），`s` 是字节数，`i` 是内容标识，`v` 是发送端的完整路径。
- 这属于“离线文件”那一套：文件留在发送方机器上，接收方再去拉，不在本文范围。
- 群文件同理，本版本 `QGROUP_FILE` / `QGROUP_FOLDER` 能力位为空。

## 5. 尚未确认

- `3000` / `3001` 的完整字段与 `ACTION` 取值（3.4.3055 建群直接发 `3003`，没看到这两个命令）。
- `3004`–`3007` 短/长两版的差异，以及 `RET=20` 的含义（`3004` 已观察到：`<QGROUP_ID>` 请求群资料，我们目前不回应）。
- 踢人（`3010`）、退群（`3009`）、他人入群通知（`3012`）的真实报文；`3008` 解散群已观察到，只有 `<QGROUP_ID>`。
- 群文件里 `offline_folder` 的下载流程（接收方如何拿目录清单）。
- 群消息里 @、表情、链接的具体 `dt` 结构。
