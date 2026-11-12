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

## 4. 尚未确认

- `3000` / `3001` 的完整字段与 `ACTION` 取值。
- `3004`–`3007` 短/长两版的差异，以及 `RET=20` 的含义。
- 踢人、退群、解散、他人入群通知的真实报文。
- 群文件：本版本 `QGROUP_FILE` / `QGROUP_FOLDER` 为空，群文件不走独立通道。
- 群消息里图片、链接、@ 的具体 `dt` 结构（文字已确认与私聊一致）。
