# 内网通私有文件与文件夹通道

本文描述承载实际文件与文件夹字节的那条 TCP 连接。控制命令（`X_SEND_FILE`、`X_SEND_FOLDER`、`X_OPERATE_*`、`X_PROGRESS_RECV_FILE`、`X_REVERSE_*`）只在私有 ENet 通道上通告与控制，字节走这里。

- 文件通道：`proto = 1`，已实现并与真实客户端双向联调通过。权威实现是 `src/main/files/private-wire.ts`、`src/main/files/private-transfer.ts`。
- 文件夹通道：`proto = 2`，协议已从静态逆向与一次真机抓包还原，**尚未实现**。

## 1. 端口

两套通道各有一个固定监听端口和一条反向通道：

| 通道 | 默认端口 | 反向端口 | 在 `X_HANDSHARK` 里的字段 |
| --- | --- | --- | --- |
| 文件 | 9013 | 临时端口 | `FILE_TRAN_TCP_PORT`、`FILE_TRAN_TCP_REVERSE_PORT` |
| 文件夹 | 9014 | 临时端口 | `FOLDER_TRAN_TCP_PORT`、`FOLDER_TRAN_TCP_REVERSE_PORT` |

**实际端口以对端 `X_HANDSHARK` 的 `<NET>` 为准**，随会话变化（实测对端 `FILE_TRAN_TCP_PORT=13603`、`FOLDER_TRAN_TCP_PORT=13859`、反向端口 `33742`/`33998`），9013/9014 只是默认监听端口。本客户端把本地文件端口写进握手；文件夹端口目前填 0，等于不接收文件夹。

反向语义是**把连接方向反过来**：对端作为文件持有方，连到请求方公布的反向端口。对端反向连接时用的是它自己公布的端口号，所以本机要在握手后额外监听这个号，否则连接会被拒绝。

## 2. 帧外壳

```
偏移  长度  类型      字段        说明
0x00   4   u32 BE    unLength    本帧总字节数，包含这 4 字节
0x04   4   u32 BE    proto       1 = 文件通道，2 = 文件夹通道
0x08   4   u32 BE    cmd         命令字
0x0c   ...          载荷        按 cmd 不同
```

- 帧长上限 512 KiB（抓包侧静态结论；本实现按 64 MiB 兜底防坏包）。
- 整条通道明文，没有 TEA、没有 MD5/SHA/CRC；完整性依赖 TCP 与逐项大小校验。
- 一帧一个完整缓冲，长度域必须等于整帧大小。

## 3. 文件通道命令（proto = 1，已实现）

| cmd | 名称 | 方向 | 载荷 |
| ---: | --- | --- | --- |
| 1 | HELLO | 接收方 → 发送方 | 488 字节：本端标识 @17（12 字符）、文件号 @44（u32 大端）、对端标识 @51（15 字符）、对端资料 XML @81 |
| 2 | ACK | 发送方 → 接收方 | 96 字节：文件号 @44、文件大小 @52、时间 @60 |
| 3 | PATH | 接收方 → 发送方 | 96 字节：保存目录 @0（22 字符）、文件号 @44、保存文件名 @56（20 字符） |
| 4 | DATA | 发送方 → 接收方 | 88 字节头：文件号 @44、总大小 @52、本片偏移 @60、本片长度 @64，正文从 88 开始 |
| 100 | WINDOW | 发送方 → 接收方 | 548 字节：UTF-16LE 的 `retrieve` JSON，文件号大端写在 @44（图片反向推送用） |

字符串都是 UTF-16LE、定长缓冲、不足补零。分片 32 KiB。

时序：

```
接收方                              发送方
  |<-- 帧头 cmd=1 HELLO（接收方发起）--|
  |--- cmd=2 ACK -------------------->|
  |--- cmd=3 PATH ------------------->|
  |<-- cmd=4 DATA × n ----------------|
```

图片走反向推送：接收方发 `X_REVERSE_FILE_REQ(1019)`，发送方连过来后先发 `cmd=100` 窗口帧，再按 `1 → 2 → 3 → 数据` 的顺序走。

## 4. 文件夹通道命令（proto = 2，未实现）

文件夹**不打包**：先发清单，再按项流式发送。`sChnnlId` 是 UTF-16LE 的 `TASK_ID`（文件夹的 TASK_ID 是 GUID 字符串）。

| cmd | 方向 | 帧长 | 说明 |
| ---: | --- | --- | --- |
| 1 | 接收方 → 发送方 | 684 | 开始传输，带通道号与项数/总大小 |
| 2 | 发送方 → 接收方 | 672 | 接受，回显通道号 |
| 3 | 发送方 → 接收方 | `0x4c + n × 0x27b` | 清单，每项 635 字节 |
| 4 | 接收方 → 发送方 | `0x4c + n × 0x1a` | 进度/续传，每项 26 字节 |
| 5 | 发送方 → 接收方 | `0x36 + n` | 数据块，头部 54 字节 |
| 100 | 双向 | 1132 | 任务级通知/中止，语义未确认 |

清单项（635 字节）：

```
项内偏移  大小  字段            说明
0x000    600   aItemName       UTF-16LE 名称或相对路径，300 wchar，末尾为 0
0x258      1   unItemType      1/2（文件/目录）
0x259      4   unItemIndex     BE，等于期望序号
0x25d      8   unItemSize      BE u64
0x265      8   -               另一个 u64，疑似目录累计大小
0x26d      4   -               疑似 unLastModify
0x271     10   -               保留
```

进度项（26 字节）：`unItemIndex`（u32 BE）、`unItemOffset`（u64 BE）、`unAction`（u32 BE，0 = 正常接收、1 = 跳过），其余保留。

数据块的头部字段名与文件通道同族（`unItemIndex`、`unLength`、`unAction`），但偏移按文件夹通道自己的布局，静态分析只确认了最小帧长 0x36。

## 5. 控制面命令

| 命令号 | 名称 | 字段 | 说明 |
| ---: | --- | --- | --- |
| 1013 | `X_SEND_FOLDER` | `TASK_ID%s`、`FOLDER_NAME%s`、`FOLDER_SIZE%llu`、`MAX_ITEM_PATH%llu`、`MAX_ITEM_SIZE%llu`、`OFFLINE%u` | 文件夹邀请 |
| 1014 | `X_OPERATE_SEND_FOLDER` | `TASK_ID%s`、`OP%u` | 发送方操作 |
| 1015 | `X_OPERATE_RECV_FOLDER` | `TASK_ID%s`、`OP%u` | 接收方操作 |
| 1020 | `X_REVERSE_FOLDER_REQ` | `TASK_ID%s` | 反向推送请求 |

实测邀请：

```xml
<X_SEND_FOLDER docver="1"><TASK_ID>fc8467cf…（GUID）</TASK_ID>
  <FOLDER_NAME>&lt;FOLDER&gt;</FOLDER_NAME><FOLDER_SIZE>4372509</FOLDER_SIZE>
  <MAX_ITEM_PATH>41</MAX_ITEM_PATH><MAX_ITEM_SIZE>4073951</MAX_ITEM_SIZE>
  <OFFLINE>0</OFFLINE></X_SEND_FOLDER>
```

- 文件夹的 `TASK_ID` 是 GUID 字符串，文件的是十进制数字，两者必须分流。
- `MAX_ITEM_PATH` / `MAX_ITEM_SIZE` 是发送端扫描目录时的准入阈值，同时对应清单项的定宽字段。
- `OP=2` 在开始时双方都会发，含义是“接受/开始”；暂停与取消的取值尚未触发确认。

## 6. 分块、校验与续传

- 分块 32 KiB（0x8000），一帧一块。
- 发送窗口按队列水位：同一任务最多 100 帧在途（约 3.2 MiB）。
- 没有摘要校验；只有长度、命令字、通道号、项序号与项大小累计的连续性检查。
- 续传以项为单位：接收方回 `unCmd 4` 带上每项已收字节数，发送方据此跳读。
- 中断会留下半成品文件，文件夹不会打包回滚。

## 7. 待确认

- 文件夹 `cmd 5` 的头部字段在 0x20 之后的完整偏移。
- `unCmd 7/8` 三段握手的业务含义。
- `unCmd 100` 是否用于任务中止。
- 暂停/继续/取消对应的 `OP` 取值。
- `X_QGROUP_FILE` / `X_QGROUP_FOLDER` 在本版本为空，群文件不走这两条通道。

## 8. 参考

- 命令号与 XML 模板：`docs/nwt-command-map.md`
- 真机抓包结论：`docs/nwt-live-findings.md`
- 本仓库的实现：`src/main/files/private-wire.ts`、`src/main/files/private-transfer.ts`
