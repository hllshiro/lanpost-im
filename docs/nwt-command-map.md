# 内网通（NWT）私有协议：命令号 ↔ XML 模板 完整映射

> **用途**：查命令号和字段。控制面的权威清单，本仓库按它实现私有通道。
> **分析对象**：`D:/Program Files (x86)/nwt/Nwt/ShiYeLine.exe`（PE32 i386，内网通 3.4.3055，7,416,176 字节，ImageBase `0x400000`）。
> **方法**：纯静态。没有运行内网通、没有抓包、没有动态调试。
> **可信度约定**：
> - 「高」= 三个独立证据互相印证（`*Packer` 类 vtable 的 Pack 方法地址、同函数内的 `<X_...>` 模板引用、同函数内紧接 `call 0x67b3b0` 的 `push <命令号>`）。
> - 「中」= 两个证据成立，或依赖命名/字段语义推断。
> - 「低」= 单一线索、语义猜测。
> - 本文 **不含**任何来自抓包或动态观察的结论；真机核对见 [nwt-live-findings.md](nwt-live-findings.md)。
>
> **本文取代**早期那份命令号靶子清单。那份清单里 1000–1025 的部分结论仍然成立（本文复核后全部命中），但 1026–1064 与所谓“缺口”是误判，原因见 §2。

---

## 0. 一页结论

1. **真实的私有命令号空间是 4 段，共 51 条，不是 1000–1064 的连续 65 个：**

   | 段 | 数量 | 归属 |
   |---|---|---|
   | `1000–1025` | 26 | 握手 / 资料 / 文字 / 文件 / 文件夹 / 心跳 / 就绪 / 共享网段 / 离线 / 提醒文件 |
   | `3000–3012` | 13 | QGROUP 群组 |
   | `4000–4001` | 2 | 远程协助 |
   | `5000–5009` | 10 | 共享文件柜 SHARE |

2. **51 条命令与 51 个消息 `*Packer` 类严格 1:1。** 二进制里 `*Packer` 类共 **55** 个，其中
   - **51 个**是消息（每条命令一个，Pack 方法里格式化一条 `<X_...>` 模板并把命令号推给帧构造器）；
   - **4 个**不是消息：`CPacker`（基类占位）、`CEmptyPacker`（Pack 是 `xor eax,eax; ret 8` 桩）、`COfflinePacker`（离线队列对象，不产生线路报文）、`COnlinePacker`（Pack 是同一个桩）。

3. **`1026–1064` 不是命令号。** 上一轮在 `cmdscan.mjs` 里看到的"49 个发送桩"全部是
   `push <立即数>` + `call 0x793140` 的形状，而 `0x793140` 是一个**日志/二进制转储辅助函数**
   （内部字面量：`"Memory allocation failed."`、`"failurePoint"`、`"numBytes"`、`"binary data to log"`），
   并且这些函数所在的代码区属于 **AES / RC2 / PKCS#7 加密实现**。详见 §2。

4. **`1021 = X_SHARE_SUBNET` 已确认**（上一版标"低置信度"）。证据：`CShareSubnetPacker::Pack`
   `0x665290`，模板 `0x9ebbe0`，`push 1021 @0x665513`，`call 0x67b3b0 @0x66551a`。

5. **发送汇聚点找到了，但不是 `0x793140`，而是 `0x67b3b0`。**
   `0x67b3b0` 的函数体里有 `mov ecx, 0x9EF1C8`（TEA 密钥，见 `nwt-private-protocol.md`）
   + `call 0x599030`（TEA 加密），即"**构造应用帧 + 加密正文**"。
   它全二进制只有 **55 个调用点**（= 51 条命令 + 4 条命令的双分支），与 51 个 Packer 完全对得上。

6. **旁证：TEA 密钥引用 52 处 = 51 个 Unpack（解密解析）+ 1 个帧构造器（加密）。**

---

## 1. 方法与证据链（可复现）

### 1.1 正确代码形状

每条命令的发送侧就是一个 `*Packer::Pack` 方法，形状固定（以 `X_CHANGE_STATUS` / 1001 为例，`0x667eb0`）：

```asm
push <字段值>                     ; STATUS
6a 01                    push 1                 ; docver
68 70 c2 9e 00           push 0x9ec270          ; "<X_CHANGE_STATUS docver=\"%u\">..."
8d 44 24 2c              lea  eax,[esp+0x2c]    ; 栈上缓冲区
68 00 10 00 00           push 0x1000            ; 缓冲大小
50                       push eax
e8 9d c0 21 00           call 0x883f68          ; 格式化（窄字符 sink）
...
8d 4c 24 20              lea  ecx,[esp+0x20]    ; 已格式化好的 XML
51                       push ecx               ;  arg3 = xml
68 e9 03 00 00           push 1001              ;  arg2 = 命令号  ← 关键
52                       push edx               ;  arg1
53                       push ebx               ;  arg0
e8 cd 34 01 00           call 0x67b3b0          ;  帧构造器（TEA 加密）
```

- 模板有两个格式化 sink：`0x882549`（宽字符模板）与 `0x883f68`（窄字符模板）。**模板字符串的编码决定了用哪个 sink**，与命令号无关。
- 55 条模板常量里 40 条是 UTF-16LE、15 条是 ASCII（见 §4、§5）。
- `0x67b3b0` 内部：`new(0x68)` 建对象 → 分配 0x200 缓冲 → `strlen(xml)` →
  `mov ecx, 0x9EF1C8; call 0x599030`（TEA 加密）→ 存 CString → 返回对象指针。
  它 `ret 0x10`，即 4 个参数 `(arg0, arg1, cmd, xml)`。

### 1.2 上一轮为什么跑偏

`cmdscan.mjs` 的判据是"`push imm32 ∈ 1000..1064` 且其后 96 字节内有一个 `call rel32`"。这条判据在
`0x67b3b0` 上是对的，但 `0x793140` 也满足，于是把**日志函数**当成了发送函数：

```asm
8b 4d 08                 mov  ecx,[ebp+8]
e8 aa 46 f7 ff           call 0x7bcaa0
83 c0 20                 add  eax,0x20
50                       push eax            ; arg1
68 00 04 00 00           push 0x400          ; ← 0x400 = "1024"，其实是一个字节数
8b 4d 0c                 mov  ecx,[ebp+0xc]
e8 39 ad f4 ff           call 0x793140       ; 日志转储
```

`0x793140` 的序言（原文照录）：

```asm
68 c4 f7 95 00     push 0x95f7c4   ; "Memory allocation failed."
8b 45 fc / 8b 10 / 8b 4d fc / 8b 42 14 / ff d0   ; 虚函数调用（日志对象）
51 / 68 e0 f7 95 00 / e8 ..  ;   LogValue("failurePoint", arg1)
52 / 68 f0 f7 95 00 / e8 ..  ;   LogValue("numBytes",    arg2)
```

——这是"记录失败点 + 二进制块"的诊断输出，不是线路发送。

### 1.3 函数边界与 RTTI

1. **函数结束**：MSVC 的 epilogue 只有两种，`: 8B E5 5D C2 xx xx`（`mov esp,ebp; pop ebp; ret imm16`）与 `8B E5 5D C3`。以它为锚点 + 0xCC 填充即可稳定切分函数。
2. **RTTI → vtable → 方法地址**（本二进制 RTTI 未裁剪，且 COL 里存的是**绝对 VA**，不是 RVA）：
   `.?AV<Class>@@` 名字串地址 − 8 = TypeDescriptor；
   `.rdata` 中 `dword == TypeDescriptor` 的位置 − 12 = CompleteObjectLocator；
   `.rdata` 中 `dword == COL` 的位置 = `vtable[-1]`，其后 3 个函数指针即 `[共享槽, Pack, Unpack]`。
   （脚本 `rtti3.mjs`，输出 55 个 Packer 的 vtable 与方法地址，见 §4。）

### 1.4 三方交叉验证（这是本文置信度的来源）

| 证据 | 数量 | 是否一致 |
|---|---|---|
| `*Packer` 类 vtable 的 Pack 方法 | 51 个消息类 | 每个方法的函数体里**恰好**有 1 条 `<X_...>` 模板引用 |
| 同一函数内 `push <cmd>` 且紧随 `call 0x67b3b0` | 55 处 | 命令号与类名语义 100% 对得上（见 §4） |
| `.rdata` 里 `<X_...>` 格式串 | 50 条模板名 / 55 条字符串（含变体） | 51 条命令用 50 个模板名（1024/1025 共用 `X_REMIND_FILE`） |
| TEA 密钥 `0x9EF1C8` 引用 | 52 处 | 51 个 Unpack + 1 个帧构造器 |

**结论：命令号不是猜的，是把"类 → 方法 → 模板 → 命令号"四者钉死在同一段机器码里了。**

---

## 2. 伪命中排除：为什么 1026–1064 不是命令号

上一轮的 49 个"未知命令发送桩"全部属于同一个形状：

```asm
8b 4d 08 / e8 ..  / 83 c0 20 / 50      ; push &obj->member_0x20
68 <n>                                  ; n ∈ {1026,1027,1029..1032,1033..1036,1040..1043,1051..1058,1064}
8b 4d 10 / e8 ..                        ; call 0x793140（日志）
33 c0                                  ; return 0
```

49 个站点的分布（VA）与所在代码区：

| 区块 | 立即数集合 | 数量 | 该区可读字面量（性质） |
|---|---|---|---|
| `0x802763–0x80390c` | 1000–1015（1007 插在 1003 与 1004 之间，顺序不按枚举） | 16 | `"AES decryption failed"`、`"Input data size is 0."`、`"outSizeBeforeUnpadding"` → **AES** |
| `0x8737f6–0x87434c` | 1016–1023 | 8 | （无 ASCII 提示串） |
| `0x8483fb–0x84936b` | 1024,1025,1026,1027,1029–1032 | 8 | （无） |
| `0x8780d6–0x878a08` | 1033–1036,1040–1043 | 8 | `"RC2 padding must be a multiple of 8."` → **RC2** |
| `0x805086–0x805bc6` | 1051–1058 | 8 | （无） |
| `0x7fa078` | 1064 | 1 | `"CryptMsgOpenToDecode failed."`、`"Not a PKCS7 enveloped message."` → **PKCS#7/CMS** |

三条排除理由：

1. **没有任何一个站点引用 `<X_...>` 模板**（全二进制 55 条模板字符串，引用点已全量枚举，见 `tplmap4.txt`）。
2. **没有任何一个站点 `call 0x67b3b0`**（55 个调用点已全量枚举，全部落在 51 个 Packer::Pack 里）。
3. **所在代码区是加密实现**，且这些 `push` 的最近一次 `call` 一律是日志函数 `0x793140`。

> **诚实标注**：`<n>` 的语义（是"日志条目 id"还是"要转储的字节数"）静态**无法确定**，因为
> 例如 `0x8483fb` 处 `0x400 = 1024` 既可读作命令号 1024，也可读作 1024 字节；
> 而 `0x8737f6` 处 `0x3f8 = 1016` 与真实命令 1016 撞号，说明这套立即数**确实复用了同一个枚举/同一个量级**。
> **但无论它是什么，它都不是"格式化 XML 并发送"的路径。** 抓包时如果线上从不出现 1026–1064，即得到最终确认（见 §8）。

附带说明：上一版文档 §2.5 里"2000–3999 没有命令号"的结论**方向正确但范围说窄了**——
真实情况是 `3000–3012`、`4000–4001`、`5000–5009` **都是**命令号（分别是群组、远程、共享文件柜）。
上一版把它们当成"内部日志枚举"是因为只看了 `0x67b3b0` 的入参列表而没去找模板。

---

## 3. 全量命令表 1000–1064（含"不存在"项）

> 模板 VA 均为 ImageBase `0x400000` 下的 VA。证据列给出 `类::Pack` 地址 + 模板 VA + `push cmd` 站点。

### 3.1 `1000–1025`

| 命令号 | 模板名 | 推测用途 | 方向 | 置信度 | 证据 |
|---:|---|---|---|---|---|
| 1000 | `X_HANDSHARK` | 握手：能力位 + 个人资料 + 8 个传输端口 + Web 端口 | 双向 | 高（与规格一致） | `CHandsharkPacker::Pack 0x669370`，模板 `0x9ec510`，`push 1000 @0x669c59` |
| 1001 | `X_CHANGE_STATUS` | 修改在线状态 | 单向广播（本机→局域网） | 高 | `CChangeStatusPacker::Pack 0x667e00`，`0x9ec270`，`push 1001 @0x667ed7` |
| 1002 | `X_CHANGE_SIGN` | 修改签名 | 单向广播 | 高 | `CChangeSignPacker::Pack 0x66eac0`，`0x9ed5e8`，`push 1002 @0x66ec11` |
| 1003 | `X_CHANGE_INFO` | 修改个人资料（整份覆盖） | 单向广播 | 高 | `CChangeInfoPacker::Pack 0x660820`，`0x9eb050`，`push 1003 @0x660dd7` |
| 1004 | `X_SEND_MSG` | 文字消息（`<MSG>` 内是 JSON） | 请求（发送方→对端） | 高（与规格一致） | `CSendMsgPacker::Pack 0x65ca70`，`0x9ea718`，`push 1004 @0x65cdad` |
| 1005 | `X_SEND_MSG_ACK` | 送达确认 | 响应（接收方→发送方） | 高（与规格一致） | `CSendMsgAckPacker::Pack 0x6747c0`，`0x9ee328`，`push 1005 @0x674898` |
| 1006 | `X_SEND_RECEIPT` | 已读回执 | 响应（接收方→发送方） | 高（与规格一致） | `CSendReceiptPacker::Pack 0x676660`，`0x9ee770`，`push 1006 @0x676738` |
| 1007 | `X_SEND_FLASH_SCREEN` | 闪屏 / 抖动 | 单向（发起方→对端） | 高 | `CSendFlashScreenPacker::Pack 0x65e2b0`，`0x9eaa60`，`push 1007 @0x65e387` |
| 1008 | `X_SEND_WRITTING` | 正在输入 | 双向 | 高（与规格一致） | `CSendWrittingPacker::Pack 0x668b80`，`0x9ec404`，`push 1008 @0x668c57` |
| 1009 | `X_SEND_FILE` | 发送文件请求 | 请求 | 高 | `CSendFilePacker::Pack 0x66f490`，`0x9ed728`，`push 1009 @0x66f8b6` |
| 1010 | `X_OPERATE_SEND_FILE` | 发送侧操作（暂停/取消/继续） | 单向（发送方→接收方） | 高（映射）/ 中（方向语义） | `COperateSendFilePacker::Pack 0x65d5d0`，`0x9ea8a8`，`push 1010 @0x65d705` |
| 1011 | `X_OPERATE_RECV_FILE` | 接收侧操作 | 单向（接收方→发送方） | 高 / 中（方向） | `COperateRecvFilePacker::Pack 0x660340`，`0x9eafe0`，`push 1011 @0x660475` |
| 1012 | `X_PROGRESS_RECV_FILE` | 接收进度（含 `SPEED` 字符串） | 单向（接收方→发送方） | 高 / 中（方向） | `CProgressRecvFilePacker::Pack 0x677d20`，`0x9eea70`，`push 1012 @0x677f91` |
| 1013 | `X_SEND_FOLDER` | 发送文件夹请求 | 请求 | 高 | `CSendFolderPacker::Pack 0x67a5f0`，`0x9eefd0`，`push 1013 @0x67a923` |
| 1014 | `X_OPERATE_SEND_FOLDER` | 文件夹发送操作 | 单向 | 高 / 中（方向） | `COperateSendFolderPacker::Pack 0x674240`，`0x9ee258`，`push 1014 @0x6743c7` |
| 1015 | `X_OPERATE_RECV_FOLDER` | 文件夹接收操作 | 单向 | 高 / 中（方向） | `COperateRecvFolderPacker::Pack 0x670d50`，`0x9eda90`，`push 1015 @0x670ed7` |
| 1016 | `X_HEARTBEAT` | 心跳（自闭合） | 双向 | 高（与规格一致） | `CHeartbeatPacker::Pack 0x674b50`，`0x9ee37c`，`push 1016 @0x674bd4` |
| 1017 | `X_QUIT` | 退出（自闭合） | 双向 | 高（与规格一致） | `CQuitPacker::Pack 0x6712d0`，`0x9edb60`，`push 1017 @0x671354` |
| 1018 | `X_READY` | 就绪（`USER_ID` 32 位十六进制） | 双向 | 高（与规格一致） | `CReadyPacker::Pack 0x6594a0`，`0x9e9948`，`push 1018 @0x65969a` |
| 1019 | `X_REVERSE_FILE_REQ` | 反向（拉取）文件请求 | 请求（接收方→持有方） | 高 / 中（方向） | `CFileReverseReqPacker::Pack 0x6620e0`，`0x9eb4c0`，`push 1019 @0x6621fa` |
| 1020 | `X_REVERSE_FOLDER_REQ` | 反向（拉取）文件夹请求 | 请求 | 高 / 中（方向） | `CFolderReverseReqPacker::Pack 0x668f10`，`0x9ec458`，`push 1020 @0x669043` |
| **1021** | **`X_SHARE_SUBNET`** | **共享/扫描网段清单下发** | **未知（疑单向/广播）** | **高（映射）**（本文确认）/ 低（用途） | `CShareSubnetPacker::Pack 0x665290`，`0x9ebbe0`，`push 1021 @0x665513` |
| 1022 | `X_OFFLINE_SEND_COMPLETED` | 离线消息发送完成通告 | 单向 | 高 | `COfflineSendCompletedPacker::Pack 0x66d440`，`0x9ed350`，`push 1022 @0x66d517` |
| 1023 | `X_OFFLINE_DELETE` | 离线消息删除 | 单向 | 高 | `COfflineDeletePacker::Pack 0x65b5c0`，`0x9ea488`，`push 1023 @0x65b697` |
| 1024 | `X_REMIND_FILE`（`<GROUP>%u</GROUP>` 变体） | 提醒文件：按"文件列表分组号" | 单向 | 高 | `CRemindFilePacker::Pack 0x65dab0`，`0x9ea928`，`push 1024 @0x65dd2b` |
| 1025 | `X_REMIND_FILE`（`<GROUP_ID>%s</GROUP_ID>` 变体） | 提醒文件：按群组 `QGROUP_ID` | 单向 | 高 | `CQGroupRemindFilePacker::Pack 0x66cb90`，`0x9ed238`，`push 1025 @0x66ce28` |

> **1024 / 1025 的区分条件已定位到代码层面**：不是同一个函数里的 if/else，而是**两个不同的 Packer 类**
> （`CRemindFilePacker` vs `CQGroupRemindFilePacker`），各自引用一条独立的格式串常量
> （`0x9ea928` = `GROUP`，`0x9ed238` = `GROUP_ID`）。这就是"共用模板名、但参数不同"的机制。

### 3.2 `1026–1064`：不存在（伪命中）

下表逐号列出，便于和上一版文档对账。**注意"不存在"指的是"没有任何一条 XML 模板与它对应"**。

| 命令号 | 模板名 | 推测用途 | 方向 | 置信度 | 证据 |
|---:|---|---|---|---|---|
| 1026 | — | 不存在 | — | 高（排除） | 唯一线索是 `push 0x402 @0x84885b` + `call 0x793140`（日志），函数内无模板 |
| 1027 | — | 不存在 | — | 高（排除） | 同上族，`0x848a9b` |
| 1028 | — | 不存在（上一版列为"缺口"） | — | 高（排除） | 连伪命中都没有 |
| 1029 | — | 不存在 | — | 高（排除） | `0x848d3d`（日志族） |
| 1030 | — | 不存在 | — | 高（排除） | `0x848f3b` |
| 1031 | — | 不存在 | — | 高（排除） | `0x84918b` |
| 1032 | — | 不存在 | — | 高（排除） | `0x84936b` |
| 1033 | — | 不存在 | — | 高（排除） | `0x8780d5`，所在区为 RC2 实现 |
| 1034 | — | 不存在 | — | 高（排除） | `0x878270`，RC2 区 |
| 1035 | — | 不存在 | — | 高（排除） | `0x8783a0`，RC2 区 |
| 1036 | — | 不存在 | — | 高（排除） | `0x8784cf`，RC2 区 |
| 1037–1039 | — | 不存在（上一版列为"缺口"） | — | 高（排除） | 连伪命中都没有 |
| 1040 | — | 不存在 | — | 高（排除） | `0x8785fb`，RC2 区 |
| 1041 | — | 不存在 | — | 高（排除） | `0x87870b` |
| 1042 | — | 不存在 | — | 高（排除） | `0x87882b` |
| 1043 | — | 不存在 | — | 高（排除） | `0x87892b` |
| 1044–1050 | — | 不存在（上一版列为"缺口"） | — | 高（排除） | 连伪命中都没有 |
| 1051 | — | 不存在 | — | 高（排除） | `0x805086`（日志族） |
| 1052 | — | 不存在 | — | 高（排除） | `0x8051bc` |
| 1053 | — | 不存在 | — | 高（排除） | `0x80533b` |
| 1054 | — | 不存在 | — | 高（排除） | `0x8054a6` |
| 1055 | — | 不存在 | — | 高（排除） | `0x8055ec` |
| 1056 | — | 不存在 | — | 高（排除） | `0x80574c` |
| 1057 | — | 不存在 | — | 高（排除） | `0x805a1a` |
| 1058 | — | 不存在 | — | 高（排除） | `0x805bc6` |
| 1059–1063 | — | 不存在（上一版列为"缺口"） | — | 高（排除） | 连伪命中都没有 |
| 1064 | — | 不存在 | — | 高（排除） | `push 0x428 @0x7fa078` + `call 0x793140`，所在区为 PKCS#7/CMS 实现 |

### 3.3 `3000–3012`（QGROUP 群组）

| 命令号 | 模板名 | 推测用途 | 方向 | 置信度 | 证据 |
|---:|---|---|---|---|---|
| 3000 | `X_QGROUP_INVITE` | 邀请入群（带完整群信息 `INFO`） | 请求（群主/成员→被邀请人） | 高（映射）/ 中（方向） | `CQGroupInvitePacker::Pack 0x663cd0`，`0x9eb830`，`push 3000 @0x66403e` |
| 3001 | `X_QGROUP_INVITE_RSP` | 邀请应答（`USER_NAME` + `ACTION`） | 响应（被邀请人→邀请人） | 高 / 中 | `CQGroupInviteRspPacker::Pack 0x6794a0`，`0x9eed78`，`push 3001 @0x6796c1` |
| 3002 | `X_QGROUP_PUSH_INFO` | 推送群信息变更（`INFO` 全套） | 单向（群主→成员） | 高 / 中 | `CQGroupPushInfoPacker::Pack 0x671ad0`，`0x9edc20`，`push 3002 @0x671e3e` |
| 3003 | `X_QGROUP_PUSH_USER` | 推送成员变更（`INFO` + `USER`） | 单向（群主→成员） | 高 / 中 | `CQGroupPushUserPacker::Pack 0x672b00`，`0x9edf30`，`push 3003 @0x6730a6` |
| 3004 | `X_QGROUP_REQ_INFO` | 拉取群信息 | 请求 | 高 | `CQGroupReqInfoPacker::Pack 0x674dc0`，`0x9ee3a8`，`push 3004 @0x674ef3` |
| 3005 | `X_QGROUP_REQ_INFO_RSP` | 群信息应答（**短/长两版**） | 响应 | 高 | `CQGroupReqInfoRspPacker::Pack 0x665a50`，`0x9ebc98`(短) / `0x9ebd60`(长)，`push 3005 @0x665c56 / @0x665f95` |
| 3006 | `X_QGROUP_REQ_USER` | 拉取群成员 | 请求 | 高 | `CQGroupReqUserPacker::Pack 0x664e30`，`0x9ebb30`，`push 3006 @0x664f63` |
| 3007 | `X_QGROUP_REQ_USER_RSP` | 成员应答（**短/长两版**） | 响应 | 高 | `CQGroupReqUserRspPacker::Pack 0x65e640`，`0x9eaac0`(短) / `0x9eab88`(长)，`push 3007 @0x65e81c / @0x65edd2` |
| 3008 | `X_QGROUP_DISMISS` | 解散群 | 单向（群主→成员） | 高 / 中 | `CQGroupDismissPacker::Pack 0x6624c0`，`0x9eb570`，`push 3008 @0x6625f3` |
| 3009 | `X_QGROUP_EXIT` | 退群 | 单向（成员→群） | 高 / 中 | `CQGroupExitPacker::Pack 0x671670`，`0x9edb80`，`push 3009 @0x6717a3` |
| 3010 | `X_QGROUP_KICK` | 踢人 | 单向（群主→成员） | 高 / 中 | `CQGroupKickPacker::Pack 0x679040`，`0x9eecd8`，`push 3010 @0x679173` |
| 3011 | `X_QGROUP_SEND_MSG` | 群消息（**无 ACK 模板**） | 单向（成员→成员） | 高 / 中 | `CQGroupSendMsgPacker::Pack 0x679c10`，`0x9eeea0`，`push 3011 @0x679ea4` |
| 3012 | `X_QGROUP_OTHER_INVITE` | 通知既有成员"有新成员被邀请" | 单向 | 高 / 中 | `CQGroupOtherInvitePacker::Pack 0x662920`，`0x9eb620`，`push 3012 @0x662c7a` |

### 3.4 `4000–4001`（远程协助）

| 命令号 | 模板名 | 推测用途 | 方向 | 置信度 | 证据 |
|---:|---|---|---|---|---|
| 4000 | `X_REMOTE_REQUEST` | 发起远程协助请求（`REQ` + `PWD`） | 请求 | 高（映射）/ 中（方向） | `CRemoteRequestPacker::Pack 0x66ef20`，`0x9ed670`，`push 4000 @0x66f0c6` |
| 4001 | `X_REMOTE_OPERATE` | 协助会话操作（`OP` + `PARAM`，猜含同意/拒绝/结束） | 双向（应答与控制共用） | 高 / 中 | `CRemoteOperatePacker::Pack 0x66d7d0`，`0x9ed3c0`，`push 4001 @0x66d93c` |

> **没有 `X_REMOTE_*_RSP` 模板**——远程协助的"同意/拒绝"只能走 4001 的 `OP`。这是 §8 的重点验证项。

### 3.5 `5000–5009`（共享文件柜 SHARE）

| 命令号 | 模板名 | 推测用途 | 方向 | 置信度 | 证据 |
|---:|---|---|---|---|---|
| 5000 | `X_SHARE_GET_REMOTE_ROOT` | 取共享根目录（仅 `REQ_ID`） | 请求 | 高 | `CShareGetRemoteRootPacker::Pack 0x670320`，`0x9ed8c0`，`push 5000 @0x67043a` |
| 5001 | `X_SHARE_GET_REMOTE_ROOT_RSP` | 根目录应答（**分页**，两种变体） | 响应 | 高 | `CShareGetRemoteRootRspPacker::Pack 0x675220`，`0x9ee458`(UTF-16 首帧) / `0x9ee648`(ASCII 尾帧)，`push 5001 @0x67560d / @0x6756e0` |
| 5002 | `X_SHARE_GET_REMOTE` | 列目录（`SHARE_ID`/`SHARE_PATH`/`SHARE_PWD`/`CHECK_PWD`） | 请求 | 高 | `CShareGetRemotePacker::Pack 0x66dce0`，`0x9ed470`，`push 5002 @0x66e0b8` |
| 5003 | `X_SHARE_GET_REMOTE_RSP` | 目录应答（**分页**，两种变体） | 响应 | 高 | `CShareGetRemoteRspPacker::Pack 0x6769f0`，`0x9ee7c8` / `0x9ee990`，`push 5003 @0x676e03 / @0x676e9d` |
| 5004 | `X_SHARE_DOWNLOAD_FILE` | 请求下载共享文件 | 请求 | 高 | `CShareDownloadFilePacker::Pack 0x666f40`，`0x9ec0c8`，`push 5004 @0x66737a` |
| 5005 | `X_SHARE_DOWNLOAD_FILE_RSP` | 下载应答（返回 `FILE_ID`/`FILE_SIZE`/`LAST_MODIFY`） | 响应 | 高 | `CShareDownloadFileRspPacker::Pack 0x678700`，`0x9eeb48`，`push 5005 @0x678998` |
| 5006 | `X_SHARE_DOWNLOAD_FOLDER` | 请求下载共享目录（带 `CHANNEL_ID`） | 请求 | 高 | `CShareDownloadFolderPacker::Pack 0x65b950`，`0x9ea4e8`，`push 5006 @0x65be75` |
| 5007 | `X_SHARE_DOWNLOAD_FOLDER_RSP` | 目录下载应答（回 `CHANNEL_ID`） | 响应 | 高 | `CShareDownloadFolderRspPacker::Pack 0x6634a0`，`0x9eb700`，`push 5007 @0x663693` |
| 5008 | `X_SHARE_CHECK_PWD` | 校验共享密码 | 请求 | 高 | `CShareCheckPwdPacker::Pack 0x668180`，`0x9ec2c8`，`push 5008 @0x6684ec` |
| 5009 | `X_SHARE_CHECK_PWD_RSP` | 密码校验结果（`ERR` + `FILE_ID`） | 响应 | 高 | `CShareCheckPwdRspPacker::Pack 0x670700`，`0x9ed988`，`push 5009 @0x67086d` |

**统计：51 条命令全部映射到模板，未映射数为 0（在真实命令空间内）。**

---

## 4. 命令号 ↔ Packer 类 ↔ 模板 对照表（核心证据表）

vtable 布局：`[vptr-1]=COL`，`vptr+0 = 共享槽 (0x657130)`，`vptr+4 = Pack`，`vptr+8 = Unpack`。

| 命令号 | Packer 类 | Pack VA | Unpack VA | 模板 VA | 模板编码 |
|---:|---|---|---|---|---|
| 1000 | `CHandsharkPacker` | `0x669370` | `0x669cc0` | `0x9ec510` | UTF-16 |
| 1001 | `CChangeStatusPacker` | `0x667e00` | `0x667f10` | `0x9ec270` | ASCII |
| 1002 | `CChangeSignPacker` | `0x66eac0` | `0x66ec70` | `0x9ed5e8` | UTF-16 |
| 1003 | `CChangeInfoPacker` | `0x660820` | `0x660e40` | `0x9eb050` | UTF-16 |
| 1004 | `CSendMsgPacker` | `0x65ca70` | `0x65ce10` | `0x9ea718` | UTF-16 |
| 1005 | `CSendMsgAckPacker` | `0x6747c0` | `0x6748d0` | `0x9ee328` | ASCII |
| 1006 | `CSendReceiptPacker` | `0x676660` | `0x676770` | `0x9ee770` | ASCII |
| 1007 | `CSendFlashScreenPacker` | `0x65e2b0` | `0x65e3c0` | `0x9eaa60` | ASCII |
| 1008 | `CSendWrittingPacker` | `0x668b80` | `0x668c90` | `0x9ec404` | ASCII |
| 1009 | `CSendFilePacker` | `0x66f490` | `0x66f950` | `0x9ed728` | UTF-16 |
| 1010 | `COperateSendFilePacker` | `0x65d5d0` | `0x65d750` | `0x9ea8a8` | ASCII |
| 1011 | `COperateRecvFilePacker` | `0x660340` | `0x6604c0` | `0x9eafe0` | ASCII |
| 1012 | `CProgressRecvFilePacker` | `0x677d20` | `0x677fe0` | `0x9eea70` | ASCII |
| 1013 | `CSendFolderPacker` | `0x67a5f0` | `0x67a9b0` | `0x9eefd0` | UTF-16 |
| 1014 | `COperateSendFolderPacker` | `0x674240` | `0x674420` | `0x9ee258` | UTF-16 |
| 1015 | `COperateRecvFolderPacker` | `0x670d50` | `0x670f30` | `0x9eda90` | UTF-16 |
| 1016 | `CHeartbeatPacker` | `0x674b50` | `0x674c00` | `0x9ee37c` | ASCII |
| 1017 | `CQuitPacker` | `0x6712d0` | `0x671380` | `0x9edb60` | ASCII |
| 1018 | `CReadyPacker` | `0x6594a0` | `0x6596f0` | `0x9e9948` | ASCII |
| 1019 | `CFileReverseReqPacker` | `0x6620e0` | `0x662240` | `0x9eb4c0` | UTF-16 |
| 1020 | `CFolderReverseReqPacker` | `0x668f10` | `0x6690a0` | `0x9ec458` | UTF-16 |
| 1021 | `CShareSubnetPacker` | `0x665290` | `0x6655c0` | `0x9ebbe0` | UTF-16 |
| 1022 | `COfflineSendCompletedPacker` | `0x66d440` | `0x66d550` | `0x9ed350` | ASCII |
| 1023 | `COfflineDeletePacker` | `0x65b5c0` | `0x65b6d0` | `0x9ea488` | ASCII |
| 1024 | `CRemindFilePacker` | `0x65dab0` | `0x65dd90` | `0x9ea928` | UTF-16 |
| 1025 | `CQGroupRemindFilePacker` | `0x66cb90` | `0x66ceb0` | `0x9ed238` | UTF-16 |
| 3000 | `CQGroupInvitePacker` | `0x663cd0` | `0x6640a0` | `0x9eb830` | UTF-16 |
| 3001 | `CQGroupInviteRspPacker` | `0x6794a0` | `0x679750` | `0x9eed78` | UTF-16 |
| 3002 | `CQGroupPushInfoPacker` | `0x671ad0` | `0x671ea0` | `0x9edc20` | UTF-16 |
| 3003 | `CQGroupPushUserPacker` | `0x672b00` | `0x673160` | `0x9edf30` | UTF-16 |
| 3004 | `CQGroupReqInfoPacker` | `0x674dc0` | `0x674f50` | `0x9ee3a8` | UTF-16 |
| 3005 | `CQGroupReqInfoRspPacker` | `0x665a50` | `0x666010` | `0x9ebc98` / `0x9ebd60` | UTF-16 |
| 3006 | `CQGroupReqUserPacker` | `0x664e30` | `0x664fc0` | `0x9ebb30` | UTF-16 |
| 3007 | `CQGroupReqUserRspPacker` | `0x65e640` | `0x65eea0` | `0x9eaac0` / `0x9eab88` | UTF-16 |
| 3008 | `CQGroupDismissPacker` | `0x6624c0` | `0x662650` | `0x9eb570` | UTF-16 |
| 3009 | `CQGroupExitPacker` | `0x671670` | `0x671800` | `0x9edb80` | UTF-16 |
| 3010 | `CQGroupKickPacker` | `0x679040` | `0x6791d0` | `0x9eecd8` | UTF-16 |
| 3011 | `CQGroupSendMsgPacker` | `0x679c10` | `0x679f30` | `0x9eeea0` | UTF-16 |
| 3012 | `CQGroupOtherInvitePacker` | `0x662920` | `0x662d40` | `0x9eb620` | UTF-16 |
| 4000 | `CRemoteRequestPacker` | `0x66ef20` | `0x66f120` | `0x9ed670` | UTF-16 |
| 4001 | `CRemoteOperatePacker` | `0x66d7d0` | `0x66d980` | `0x9ed3c0` | UTF-16 |
| 5000 | `CShareGetRemoteRootPacker` | `0x670320` | `0x670480` | `0x9ed8c0` | UTF-16 |
| 5001 | `CShareGetRemoteRootRspPacker` | `0x675220` | `0x675720` | `0x9ee458` / `0x9ee648` | UTF-16 / ASCII |
| 5002 | `CShareGetRemotePacker` | `0x66dce0` | `0x66e190` | `0x9ed470` | UTF-16 |
| 5003 | `CShareGetRemoteRspPacker` | `0x6769f0` | `0x676ee0` | `0x9ee7c8` / `0x9ee990` | UTF-16 / ASCII |
| 5004 | `CShareDownloadFilePacker` | `0x666f40` | `0x667450` | `0x9ec0c8` | UTF-16 |
| 5005 | `CShareDownloadFileRspPacker` | `0x678700` | `0x6789d0` | `0x9eeb48` | UTF-16 |
| 5006 | `CShareDownloadFolderPacker` | `0x65b950` | `0x65bf80` | `0x9ea4e8` | UTF-16 |
| 5007 | `CShareDownloadFolderRspPacker` | `0x6634a0` | `0x6636f0` | `0x9eb700` | UTF-16 |
| 5008 | `CShareCheckPwdPacker` | `0x668180` | `0x6685c0` | `0x9ec2c8` | UTF-16 |
| 5009 | `CShareCheckPwdRspPacker` | `0x670700` | `0x6708b0` | `0x9ed988` | UTF-16 |
| — | `CEmptyPacker` | `0x58c620`（桩：`xor eax,eax; ret 8`） | `0x670310` | 无 | — |
| — | `COfflinePacker` | `0x66e9d0` | `0x66ea70` | 无 | 离线队列对象，不产生线路报文 |
| — | `COnlinePacker` | `0x58c620`（同一桩） | `0x674050` | 无 | — |
| — | `CPacker` | `0x880608` | `0x880608` | 无 | 基类占位 |

---

## 5. 50 条模板分组 + 完整元素表

> 类型直接取自格式串：`%u` = u32、`%llu` = u64、`%s` = 字符串（UTF-8）。
> 55 条模板常量里 40 条是 UTF-16LE、15 条是 ASCII（见 §4 最后一列），这**只是编译期常量编码**，
> 与线上报文的 UTF-8 正文无关。

### 5.1 握手与个人资料（1000 / 1001 / 1002 / 1003 / 1018）

`X_HANDSHARK`（`0x9ec510`）—— 等于把能力协商表交出来了：

```
<FEATURE>  %s × 17： MAJOR MINOR BUILD APP MSG FILE_TRAN FOLDER_TRAN REMOTE_ASSISTANCE
                     FILE_SHARE QGROUP QGROUP_MSG QGROUP_FILE QGROUP_FOLDER
                     OFFLINE_MSG OFFLINE_FILE LAN_UPDATE HIDE_RECORD
<INFO>     CORP_ID %s | CORP_TIME %llu | NAME %s | GROUP %s | CORPORATION %s |
           DEPARTMENT %s | SEX %u | POST %s | TEL %s | MOBILE %s | EMAIL %s | SIGN %s |
           SYS_FACE %llu | USER_FACE id="%llu">%s | STATUS %u | ACTIVE_SEND %u |
           ONLINE_POPUP %u | HIDE_IP %u | COLOR_NAME %u | SORT_NAME %u | DECORATE_NAME %u
<NET>      FILE_TRAN_TCP_PORT %u          FILE_TRAN_ENET_PORT %u
           FOLDER_TRAN_TCP_PORT %u        FOLDER_TRAN_ENET_PORT %u
           FILE_TRAN_TCP_REVERSE_PORT %u  FILE_TRAN_ENET_REVERSE_PORT %u
           FOLDER_TRAN_TCP_REVERSE_PORT %u FOLDER_TRAN_ENET_REVERSE_PORT %u
           LAN_UPDATE_HTTP_PORT %u
```

> `FEATURE` 子项全是 `%s` 不是 `%u` → 传的是字符串化数值（与规格里 `MSG=2:1` 吻合）。

| 模板 | VA | 元素（类型） |
|---|---|---|
| `X_CHANGE_INFO`（1003） | `0x9eb050` | NAME`s` GROUP`s` CORPORATION`s` DEPARTMENT`s` SEX`u` POST`s` TEL`s` MOBILE`s` EMAIL`s` SIGN`s` SYS_FACE`llu` USER_FACE[id=`llu`]`s` STATUS`u` ACTIVE_SEND`u` ONLINE_POPUP`u` HIDE_IP`u` COLOR_NAME`u` SORT_NAME`u` DECORATE_NAME`u` |
| `X_CHANGE_SIGN`（1002） | `0x9ed5e8` | SIGN`s` |
| `X_CHANGE_STATUS`（1001） | `0x9ec270` | STATUS`u` |
| `X_READY`（1018） | `0x9e9948` | USER_ID`s` PARAM`u` |

### 5.2 文字消息（1004 / 1005 / 1006 / 1007 / 1008）

| 模板 | VA | 元素 |
|---|---|---|
| `X_SEND_MSG`（1004） | `0x9ea718` | MSG_ID`llu` RECEIPT`u` MSG`s` MSG_TIME`llu` OFFLINE`u` HIDE_RECORD`u` |
| `X_SEND_MSG_ACK`（1005） | `0x9ee328` | MSG_ID`llu` |
| `X_SEND_RECEIPT`（1006） | `0x9ee770` | MSG_ID`llu` |
| `X_SEND_FLASH_SCREEN`（1007） | `0x9eaa60` | TYPE`u` |
| `X_SEND_WRITTING`（1008） | `0x9ec404` | TYPE`u` |

### 5.3 文件 / 文件夹传输（1009–1015 / 1019 / 1020）

| 模板 | VA | 元素 |
|---|---|---|
| `X_SEND_FILE`（1009） | `0x9ed728` | TASK_ID`llu` FILE_ID`llu` NAME`s` PWD`s` SIZE`llu` LAST_MODIFY`llu` OFFLINE`u` |
| `X_OPERATE_SEND_FILE`（1010） | `0x9ea8a8` | TASK_ID`llu` OP`u` |
| `X_OPERATE_RECV_FILE`（1011） | `0x9eafe0` | TASK_ID`llu` OP`u` |
| `X_PROGRESS_RECV_FILE`（1012） | `0x9eea70` | TASK_ID`llu` TOTAL_SIZE`llu` RECVD_SIZE`llu` SPEED`s` |
| `X_SEND_FOLDER`（1013） | `0x9eefd0` | TASK_ID**`s`** FOLDER_NAME`s` FOLDER_SIZE`llu` MAX_ITEM_PATH`llu` MAX_ITEM_SIZE`llu` OFFLINE`u` |
| `X_OPERATE_SEND_FOLDER`（1014） | `0x9ee258` | TASK_ID**`s`** OP`u` |
| `X_OPERATE_RECV_FOLDER`（1015） | `0x9eda90` | TASK_ID**`s`** OP`u` |
| `X_REVERSE_FILE_REQ`（1019） | `0x9eb4c0` | TASK_ID`llu` |
| `X_REVERSE_FOLDER_REQ`（1020） | `0x9ec458` | TASK_ID**`s`** |

> **硬约束**：`TASK_ID` 在文件链路是 `%llu`，在文件夹链路是 `%s`。实现时必须分流。

### 5.4 心跳 / 退出（1016 / 1017）

- `X_HEARTBEAT`（`0x9ee37c`）：无元素，自闭合 `<X_HEARTBEAT docver="%u" />`
- `X_QUIT`（`0x9edb60`）：无元素，自闭合 `<X_QUIT docver="%u" />`

### 5.5 离线消息（1022 / 1023）

- `X_OFFLINE_SEND_COMPLETED`（`0x9ed350`）：TYPE`u`
- `X_OFFLINE_DELETE`（`0x9ea488`）：TYPE`u`

> 配合 `X_SEND_MSG`/`X_SEND_FILE` 里的 `OFFLINE`(`%u`) 标志，构成"带 OFFLINE 标志发送 → 发完通告 → 删除"三段式（**待验证**）。

### 5.6 提醒文件（1024 / 1025，同一模板名两个变体）

| 模板 | VA | 元素 | 归属 |
|---|---|---|---|
| `X_REMIND_FILE` | `0x9ea928` | **GROUP`u`** FILE`u` FILE_SIZE`llu` FILE_NAME`s` | 1024 / `CRemindFilePacker` |
| `X_REMIND_FILE` | `0x9ed238` | **GROUP_ID`s`** FILE`u` FILE_SIZE`llu` FILE_NAME`s` | 1025 / `CQGroupRemindFilePacker` |

### 5.7 QGROUP 群组（3000–3012，13 条命令 / 15 条模板串）

公共子结构 `QG`（出现在 INVITE / PUSH_INFO / PUSH_USER / 两个长版 RSP 中）：

```
<INFO> QGROUP_ID %s | QGROUP_NAME %s | QGROUP_MASTER %s | QGROUP_INTR %s | QGROUP_ANN %s |
       QGROUP_INFO_VER %llu | QGROUP_USER_VER %llu | QGROUP_ALLOW_OTHER_ADD %llu |
       QGROUP_PHOTO_MD5 %s
```

| 模板 | VA | 元素 |
|---|---|---|
| `X_QGROUP_INVITE`（3000） | `0x9eb830` | `INFO` 全套（见上） |
| `X_QGROUP_INVITE_RSP`（3001） | `0x9eed78` | QGROUP_ID`s` USER_NAME`s` ACTION`u` |
| `X_QGROUP_PUSH_INFO`（3002） | `0x9edc20` | `INFO` 全套 |
| `X_QGROUP_PUSH_USER`（3003） | `0x9edf30` | `INFO` 全套 + USER`s` |
| `X_QGROUP_REQ_INFO`（3004） | `0x9ee3a8` | QGROUP_ID`s` |
| `X_QGROUP_REQ_INFO_RSP`（3005）短 | `0x9ebc98` | RET`u` QGROUP_ID`s` |
| `X_QGROUP_REQ_INFO_RSP`（3005）长 | `0x9ebd60` | RET`u` QGROUP_ID`s` + `INFO` 全套 |
| `X_QGROUP_REQ_USER`（3006） | `0x9ebb30` | QGROUP_ID`s` |
| `X_QGROUP_REQ_USER_RSP`（3007）短 | `0x9eaac0` | RET`u` QGROUP_ID`s` |
| `X_QGROUP_REQ_USER_RSP`（3007）长 | `0x9eab88` | RET`u` QGROUP_ID`s` + `INFO` 全套 + USER`s` |
| `X_QGROUP_DISMISS`（3008） | `0x9eb570` | QGROUP_ID`s` |
| `X_QGROUP_EXIT`（3009） | `0x9edb80` | QGROUP_ID`s` |
| `X_QGROUP_KICK`（3010） | `0x9eecd8` | QGROUP_ID`s` |
| `X_QGROUP_SEND_MSG`（3011） | `0x9eeea0` | QGROUP_ID`s` MSG_ID`llu` MSG`s` HIDE_RECORD`u` |
| `X_QGROUP_OTHER_INVITE`（3012） | `0x9eb620` | QGROUP_ID`s` USER`s` |

**短/长两版的切换条件已定位**（`CQGroupReqInfoRspPacker::Pack 0x665a50`）：

```asm
f6 44 24 18 04        test byte ptr [esp+0x18], 4      ; 一个标志字节的第 2 位
0f 85 02 01 00 00     jne  <长版 0x9ebd60 分支>
                      ; 位未置 → 短版 0x9ebc98（只有 RET + QGROUP_ID）
```

即"有没有群信息可打包"由调用方用一个标志位决定，与 `RET` 值本身无直接关系（`RET` 只是一个 `%u` 字段）。

### 5.8 远程协助（4000 / 4001）

- `X_REMOTE_REQUEST`（`0x9ed670`）：REQ`u` PWD`s`
- `X_REMOTE_OPERATE`（`0x9ed3c0`）：OP`u` PARAM`u`

### 5.9 共享文件柜 SHARE（5000–5009 / 1021）

统一请求头：`REQ_ID %llu | SHARE_ID %s | SHARE_PATH %s | SHARE_PWD %s`；
统一响应带 `ERR %u`。

| 模板 | VA | 元素 |
|---|---|---|
| `X_SHARE_SUBNET`（1021） | `0x9ebbe0` | 只有开头：`<SUBNETS>`（子项 `<IP>%s</IP>` 与闭合串在运行时拼接，见 §5.10） |
| `X_SHARE_GET_REMOTE_ROOT`（5000） | `0x9ed8c0` | REQ_ID`llu` |
| `X_SHARE_GET_REMOTE_ROOT_RSP`（5001）首帧 | `0x9ee458` | ERR`u` END`u` REQ_ID`llu` + `CATALOG_ITEM` 列表 |
| `X_SHARE_GET_REMOTE_ROOT_RSP`（5001）尾帧 | `0x9ee648` | ERR`u` END`u` REQ_ID`llu`（空列表） |
| `X_SHARE_GET_REMOTE`（5002） | `0x9ed470` | REQ_ID`llu` SHARE_ID`s` SHARE_PATH`s` SHARE_PWD`s` CHECK_PWD`u` |
| `X_SHARE_GET_REMOTE_RSP`（5003）首帧 | `0x9ee7c8` | ERR`u` END`u` REQ_ID`llu` SHARE_ID`s` SHARE_PATH`s` + `CATALOG_ITEM` 列表 |
| `X_SHARE_GET_REMOTE_RSP`（5003）尾帧 | `0x9ee990` | ERR`u` END`u` REQ_ID`llu` |
| `X_SHARE_DOWNLOAD_FILE`（5004） | `0x9ec0c8` | REQ_ID`llu` SHARE_ID`s` SHARE_PATH`s` SHARE_PWD`s` CHECK_PWD`u` GO_ON`u` |
| `X_SHARE_DOWNLOAD_FILE_RSP`（5005） | `0x9eeb48` | ERR`u` REQ_ID`llu` FILE_ID`llu` FILE_SIZE`llu` LAST_MODIFY`llu` |
| `X_SHARE_DOWNLOAD_FOLDER`（5006） | `0x9ea4e8` | REQ_ID`llu` SHARE_ID`s` SHARE_PATH`s` SHARE_PWD`s` CHANNEL_ID`s` CHECK_PWD`u` GO_ON`u` |
| `X_SHARE_DOWNLOAD_FOLDER_RSP`（5007） | `0x9eb700` | ERR`u` REQ_ID`llu` CHANNEL_ID`s` |
| `X_SHARE_CHECK_PWD`（5008） | `0x9ec2c8` | REQ_ID`llu` SHARE_ID`s` SHARE_PATH`s` SHARE_PWD`s` |
| `X_SHARE_CHECK_PWD_RSP`（5009） | `0x9ed988` | ERR`u` REQ_ID`llu` FILE_ID`llu` |

**分页目录项**（独立字符串常量，不属于任何 `<X_...>`）：

```
CATALOG_ITEM 项： <ITEM><ID>%s</ID><NAME>%s</NAME><SIZE>%llu</SIZE><PWD>%u</PWD>
                  <TYPE>%u</TYPE><LASTM>%llu</LASTM><CREATET>%llu</CREATET><VALID>%u</VALID></ITEM>
子目录项：      <ITEM><NAME>%s</NAME><SIZE>%llu</SIZE><TYPE>%u</TYPE><LASTM>%llu</LASTM></ITEM>
闭合：          </CATALOG_ITEM></X_SHARE_GET_REMOTE_ROOT_RSP>
                </CATALOG_ITEM></X_SHARE_GET_REMOTE_RSP>
```

### 5.10 协议外层 / 非 `X_` 前缀常量

| VA | 字符串 | 用途推断 | 引用点 |
|---|---|---|---|
| `0x9ebc2c` | `<IP>%s</IP>` | `X_SHARE_SUBNET` 的**子网项**格式 | `0x66544d`（`CShareSubnetPacker::Pack` 内） |
| `0x9ebc44` | `</SUBNETS></X_SHARE_SUBNET>` | `X_SHARE_SUBNET` 的**闭合串** | `0x6654c6`（`push 0x1b` + `push 0x9ebc44` + `call 0x4052f0` 追加） |
| `0x9be640` | `<ShiYeLine docver="1"><SubnetIps>` | 另一个"子网清单"信封（与 `SubnetIPs.xml` 相关），**与 1021 无直接关系** | `0x46bd10` |
| — | `CATALOG_ITEM` 系列 | 共享目录分页（见 §5.9） | 见 §5.9 |
| — | `%u@shiyeline:%u:%s:%s:%u:%s` | IPMSG 扩展身份后缀（对应飞秋的 `1_lbt80_0#…#9:`） | — |

**`X_SHARE_SUBNET` 的完整拼装（已定位）**，全部在 `CShareSubnetPacker::Pack 0x665290` 内：

```asm
6a 01                    push 1
68 e0 bb 9e 00           push 0x9ebbe0     ; "<X_SHARE_SUBNET docver=\"%u\"><SUBNETS>"
68 00 00 04 00           push 0x40000
...
68 2c bc 9e 00           push 0x9ebc2c     ; "<IP>%s</IP>"   ← 每个子网循环追加一次
...
6a 1b                    push 0x1b         ; 27 = 闭合串长度
68 44 bc 9e 00           push 0x9ebc44     ; "</SUBNETS></X_SHARE_SUBNET>"
8d 74 24 5c              lea  esi,[esp+0x5c]
e8 1d fe d9 ff           call 0x4052f0     ; CString 追加
...
68 fd 03 00 00           push 1021
e8 91 5e 01 00           call 0x67b3b0
```

### 5.11 关于 `.rdata` 中"多出的 E / Y 前缀"

上一版 `summary.json` 里有两条模板带前导字母：`E<X_CHANGE_INFO ...>`、`Y<X_SHARE_GET_REMOTE_ROOT ...>`。
**这是扫描假象，不是模板内容**：这两条是 UTF-16 常量，且**前一个常量不以 NUL 结尾对齐**——
`<` 前面两个字节正好是上一条 ASCII 串结尾的 `'E'`+`0x00`（或 `'Y'`+`0x00`），
按 UTF-16 读就被并成了 `E` / `Y`。本文的扫描放宽了这一约束，得到完整的 50 个模板名（55 条模板字符串）。

---

## 6. 模板缺陷与实现陷阱（务必逐条核对）

| # | 现象 | 位置 | 影响 |
|---:|---|---|---|
| 1 | **`</GROUP_INFO_VER>` 少了 `Q`**（写作 `<QGROUP_INFO_VER>%llu</GROUP_INFO_VER>`），导致整段 XML 标签不闭合 | 5 条模板：`X_QGROUP_INVITE 0x9eb830`、`X_QGROUP_PUSH_INFO 0x9edc20`、`X_QGROUP_PUSH_USER 0x9edf30`、`X_QGROUP_REQ_INFO_RSP(长) 0x9ebd60`、`X_QGROUP_REQ_USER_RSP(长) 0x9eab88` | 若对端用严格 XML 解析会整条丢弃；说明发送侧只 sprintf 不做校验。抓包必须核对真实拼写 |
| 2 | **`WRITTING` 拼写错误**（应为 `WRITING`） | 模板 `X_SEND_WRITTING 0x9ec404` 与类名 `CSendWrittingPacker` | 实现时**必须照抄错拼** |
| 3 | `TASK_ID` 双重类型（`%llu` 文件 / `%s` 文件夹） | 1009/1010/1011/1012/1019 vs 1013/1014/1015/1020 | 必须分流，否则格式串错位 |
| 4 | 1024 / 1025 **共用一个模板名**，靠 `GROUP` vs `GROUP_ID` 区分 | `0x9ea928` vs `0x9ed238`（两个不同类） | 不总结"一条模板对一个号"，要按元素区分 |
| 5 | QGROUP / SHARE 的 RSP 有 **短/长（首帧/尾帧）两版**，同一个命令号两条格式串 | 3005、3007、5001、5003 | 同号多模板，接收侧要容忍两种 |
| 6 | SHARE 列表是**三段拼接**：首帧模板（含 `<CATALOG_ITEM>`）→ 循环 `<ITEM>` → 闭合串 | `0x9ee458`/`0x9ee7c8` + `</CATALOG_ITEM></X_SHARE_GET_REMOTE_*_RSP>` | 解析必须处理分页与 `END` 标志 |
| 7 | `X_SHARE_SUBNET` 是**三段拼装**：开头模板 `<SUBNETS>` → 循环 `<IP>%s</IP>` → 闭合串（含显式长度 `0x1b`） | `0x9ebbe0` / `0x9ebc2c` / `0x9ebc44`（同一函数 `0x665290`） | 解析必须处理"不定长子网列表"；`<IP>` 里是 IP 还是 IP/掩码**待抓包** |
| 8 | 15 条模板常量是窄字符（ASCII）、40 条是宽字符 | 见 §4 | 只是编译期常量编码；线上正文一律 UTF-8 |
| 9 | `X_SEND_FOLDER` 的 `MAX_ITEM_PATH` / `MAX_ITEM_SIZE` 是 `%llu`（不是 `%u`） | `0x9eefd0` | 传的是"最长路径/最大文件"阈值，注意 64 位 |
| 10 | `X_PROGRESS_RECV_FILE.SPEED` 是 `%s`（字符串）而不是数值 | `0x9eea70` | 速率是格式化好的文本（如 `"1.2 MB/s"`） |

---

## 7. 期望的请求 / 响应配对

> 「谁发起」按模板语义 + `*_RSP` 命名推断，**未经抓包验证**（除非标注"已确认"）。
> 注意：**同一条命令号既用于 Pack 也用于 Unpack**（每个 Packer 类同时有 Pack/Unpack 两个方法），
> 所以"方向"是消息语义层面的，不是命令号层面的。

| 请求 | 响应 | 语义 | 谁发起 | 置信度 |
|---|---|---|---|---|
| 1004 `X_SEND_MSG` | 1005 `X_SEND_MSG_ACK` | 文字送达 | 发送方 → 接收方；ACK 反向 | 高（已确认） |
| 1004 `X_SEND_MSG`（`RECEIPT=1`） | 1006 `X_SEND_RECEIPT` | 已读回执 | 接收方读后回 | 高（已确认） |
| 1009 `X_SEND_FILE` | 1010 / 1011 / 1012 | 文件任务协商与状态 | 发送方发起 | 高（映射）/ 中（时序） |
| 1013 `X_SEND_FOLDER` | 1014 / 1015 | 文件夹任务协商与状态 | 发送方发起 | 高 / 中 |
| 1019 `X_REVERSE_FILE_REQ` | （复用 1009 系？） | 反向拉取文件 | 接收方发起 | 低（配对方式未知） |
| 1020 `X_REVERSE_FOLDER_REQ` | （复用 1013 系？） | 反向拉取文件夹 | 接收方发起 | 低 |
| 1021 `X_SHARE_SUBNET` | — | 网段清单 | 未知 | 低 |
| 3000 `X_QGROUP_INVITE` | 3001 `X_QGROUP_INVITE_RSP` | 邀请 / 接受-拒绝 | 邀请人发起 | 高 |
| 3002 `X_QGROUP_PUSH_INFO` | — | 群信息变更广播 | 群主发起 | 中 |
| 3003 `X_QGROUP_PUSH_USER` | — | 成员变更广播 | 群主发起 | 中 |
| 3004 `X_QGROUP_REQ_INFO` | 3005 `X_QGROUP_REQ_INFO_RSP`（短/长） | 拉群信息 | 成员发起 | 高 |
| 3006 `X_QGROUP_REQ_USER` | 3007 `X_QGROUP_REQ_USER_RSP`（短/长） | 拉成员列表 | 成员发起 | 高 |
| 3008 `X_QGROUP_DISMISS` | — | 解散群 | 群主发起 | 中 |
| 3009 `X_QGROUP_EXIT` | — | 退群 | 成员发起 | 中 |
| 3010 `X_QGROUP_KICK` | — | 踢人 | 群主发起 | 中 |
| 3011 `X_QGROUP_SEND_MSG` | **无对应 ACK 模板** | 群消息 | 成员发起 | 高（无 ACK 是事实）/ 配对未知 |
| 3012 `X_QGROUP_OTHER_INVITE` | — | 通知既有成员 | 邀请人发起 | 中 |
| 4000 `X_REMOTE_REQUEST` | 4001 `X_REMOTE_OPERATE`（`OP` 承载同意/拒绝） | 远程协助 | 控制方发起 | 中 |
| 4001 `X_REMOTE_OPERATE` | 4001（同一号码双向） | 会话控制 | 双向 | 中 |
| 5000 `X_SHARE_GET_REMOTE_ROOT` | 5001 `X_SHARE_GET_REMOTE_ROOT_RSP` | 共享根目录 | 访问方发起 | 高 |
| 5002 `X_SHARE_GET_REMOTE` | 5003 `X_SHARE_GET_REMOTE_RSP` | 列目录 | 访问方发起 | 高 |
| 5004 `X_SHARE_DOWNLOAD_FILE` | 5005 `X_SHARE_DOWNLOAD_FILE_RSP` | 下载文件 | 访问方发起 | 高 |
| 5006 `X_SHARE_DOWNLOAD_FOLDER` | 5007 `X_SHARE_DOWNLOAD_FOLDER_RSP` | 下载目录（`CHANNEL_ID` 可能对应 TCP 通道） | 访问方发起 | 高 |
| 5008 `X_SHARE_CHECK_PWD` | 5009 `X_SHARE_CHECK_PWD_RSP` | 校验共享密码 | 访问方发起 | 高 |

**SHARE 的典型时序（推断）**：
`5000` 取根 → `5001` 分页返回 → 用户进入目录 → `5002` → `5003` 分页 →
（若有密码）`5008` → `5009` → `5004`/`5006` 请求下载 → `5005`/`5007` 返回 `FILE_ID`/`CHANNEL_ID` →
随后走既有的 TCP 文件通道（`FILE_TRAN_*` 端口由 1000 握手协商）。

---

## 8. 剩余未知 + 实时抓包（Phase 4）应验证什么

### 8.1 静态无法定论的点

1. **`X_SHARE_SUBNET`(1021) 的实际用途与发起方**。它下发一个 `<SUBNETS>` + 若干 `<IP>%s</IP>` 清单，
   合理解释是"局域网更新/网段扫描下发"，但代码里看不到触发条件，也看不出是单播还是广播。
2. **`X_SHARE_SUBNET` 子项的确切写法**。已知是 `<IP>%s</IP>`，但 `%s` 里是裸 IP、`IP/掩码` 还是 `起-止` 区间未知。
3. **`1026–1064` 是否真的永不上线**。静态证据是"无模板、无 Packer、只在日志族里出现"；
   若线上出现这些号码，则说明本版本存在**另一条不经过模板的发送路径**（可能性低但未排除）。
4. **`3011` 群消息为什么没有 ACK**。可能复用 1005，或群消息不保证送达。
5. **`4001` 的 `OP` 取值表**。远程协助的同意/拒绝/结束只能靠 `OP` 区分，目前完全未知。
6. **`1010/1011/1014/1015/1022/1023` 的 `OP` / `TYPE` 取值**。
7. **`1024/1025` 的 `GROUP` / `FILE` 语义**（"文件列表分组号"还是"最近文件列表序号"）。

### 8.2 抓包靶标（按优先级）

| 优先级 | 抓什么 | 怎么触发 | 期望看到 |
|---:|---|---|---|
| 1 | **先确认整张命令表** | 每条命令各触发一次 | 只出现 §3 的 51 个号码，**没有 1026–1064** |
| 2 | `1004` 的 XML 明文 | 发一条含 emoji + 链接的消息 | `<MSG>` 内是 JSON；`MSG_TIME` 是否真为 0 |
| 3 | `TASK_ID` 真实类型 | 发文件 / 发文件夹 | 文件 `%llu`、文件夹 `%s` |
| 4 | `3000/3001` 邀请流程 | 建群并拉人 | `ACTION` 的取值（接受=?, 拒绝=?） |
| 5 | `3005/3007` 短/长两版 | 正常拉取 + 拉取一个不存在/无权限的群 | 标志位为 0/1 时对端分别回哪一版 |
| 6 | `3011` 群消息是否有回执 | 发群消息 | 有无 1005/1006 或任何回包 |
| 7 | `4000/4001` 远程协助 | 发起 → 接受 → 结束 | `REQ`、`OP`、`PARAM` 的取值序列 |
| 8 | `5000–5009` 全链路 | 打开对端共享文件柜：进目录、输密码、下载文件与目录 | `REQ_ID` 是否自增、`END` 分页终止条件、`CHECK_PWD`/`GO_ON` 语义 |
| 9 | `1021` | 观察启动/刷新时的广播 | `<SUBNETS>` 内子项的真实标签与闭合串 |
| 10 | `<QGROUP_INFO_VER>` 拼写 | 任意群组操作 | 线上是否真的是 `</GROUP_INFO_VER>`（少 Q） |
| 11 | `1026–1064` | 无事发生时观察 | 若出现，务必记录（会推翻 §2） |

> 提示：TEA 只加密正文，**应用帧头的 u32 命令号是明文**，直接按它过滤最快。
> `0x67b3b0` 里的 TEA 调用是 `mov ecx, 0x9EF1C8; call 0x599030`，密钥即 `8asfhj@k7*20hbla`。

---

## 9. 复现脚本（在另一份逆向工作区，不随本仓库提交）

静态分析脚本留在逆向工作区的 `.superpowers/sdd/nwt-private-protocol-reverse-engineering/scratch/` 下，没有第三方依赖。要复现时按下面的顺序跑：

```
.superpowers/sdd/nwt-private-protocol-reverse-engineering/scratch/   （逆向工作区）
  mapfn.mjs       桩位置 → 所在函数（第一版，函数切分不准，仅历史保留）
  fmap4.mjs       ★ 模板 → 所在函数 → push <cmd>（放宽模板前导 NUL 约束）
  rtti.mjs        RTTI 名字枚举
  rtti2.mjs       代码 VA → vtable → 类名（反向）
  rtti3.mjs       ★ 类名 → td → COL → vtable → {共享槽, Pack, Unpack}
  join2.mjs       ★ 最终 join：55 个 call 0x67b3b0 → 最近 push cmd → 最近 Packer::Pack
  tplfields.mjs   ★ 模板字段表 + XML 标签闭合校验（发现 </GROUP_INFO_VER>）
  countrefs.mjs   统计某 VA 的 call 引用数（验证 49 / 55 / 52）
  tables.mjs      搜索 cmd→handler 表（结论：没有这种表，接收侧不是按命令号 switch）
  dispatch.mjs    搜索命令号立即数聚类（用于定位伪命中区块）
  strrefs.mjs     列代码区间里引用的可读字符串
  findstr.mjs / strva.mjs / xref.mjs / peek3.mjs / imp.mjs  辅助工具

  out/tplmap4.txt   模板 → 函数 → 命令号
  out/join2.txt     命令号 → Packer 类
  out/tplfields.txt 50 条模板的字段与标签校验
```

复现：

```bash
cd .superpowers/sdd/nwt-private-protocol-reverse-engineering/scratch
EXE="D:/Program Files (x86)/nwt/Nwt/ShiYeLine.exe"
node rtti3.mjs "$EXE"            # 55 个 Packer 的 vtable / Pack / Unpack
node fmap4.mjs "$EXE"            # 模板 → cmd
node join2.mjs "$EXE"            # cmd → 类（51 条，一一对应）
node tplfields.mjs "$EXE"        # 字段表 + 标签闭合检查
```

### 关键技术点（给下一个人省时间）

1. **`push imm32 ∈ 1000..1064` + 最近 `call` 不是判别式**。真正的判别式是
   **`push <cmd>` 之后 40 字节内 `call 0x67b3b0`**（帧构造器）。
2. **`0x793140` 是日志转储函数**，不是发送函数（`"Memory allocation failed."` /`"failurePoint"` /`"numBytes"`）。
3. **RTTI 的 COL 里存的是绝对 VA**（不是 RVA）：`COL = TypeDescriptorDocAddr - 12`，
   `vtable[-1] == COL`，`vtable[0]` 是共享槽 `0x657130`，`vtable[1] = Pack`，`vtable[2] = Unpack`。
4. **函数边界用 `8B E5 5D C2/C3`（epilogue）+ 0xCC 填充**切分，比"向前找 prologue"可靠。
5. **模板常量不以 NUL 前导对齐**，不要用"前两字节为 0x00 0x00"做 UTF-16 判定（会漏 2 条模板，并产生 `E`/`Y` 前缀假象）。

---

## 10. 明确未做的事

- 没有运行内网通、没有抓包、没有动态调试；所有"方向"和"时序"结论都是静态推断。
- 没有还原 `9011` 发现报文的准入字段，也没有分析 `9012/9013/9014` TCP 文件通道的报文格式。
- 没有反编译 `Unpack` 方法（本文只用了它们的地址作为交叉验证），因此**入站字段校验、错误码取值、状态机**都未分析。
- `OP` / `TYPE` / `REQ` / `ACTION` / `ERR` / `RET` 等枚举的具体取值一律未知。
