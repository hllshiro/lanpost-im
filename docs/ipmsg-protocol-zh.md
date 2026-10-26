# IP Messenger 协议中文版（草案版本 10）

协议版本：草案 10（1996/02/21，2011/05/03 修订）
翻译时间：2012/11/04

## 概要

IP Messenger 使用 TCP/UDP 端口，提供收发消息及文件（目录）服务。

## 特点

IP Messenger 能够在任何具有 TCP/IP 协议的操作系统上使用，能够动态识别用户。通过 IP 地址可以和所有在线用户进行信息交换。

## 详细

IP Messenger 默认使用 2425 端口，用如下方法进行操作：

- 消息接收/发送：UDP
- 文件接收/发送：TCP

## 1. 命令

### 1.1 命令类型（命令编号低 8 位）

- `IPMSG_NOOPERATION`：无操作
- `IPMSG_BR_ENTRY`：上线（在启动时广播）
- `IPMSG_BR_EXIT`：下线（在结束时广播）
- `IPMSG_ANSENTRY`：通知新上线
- `IPMSG_BR_ABSENCE`：变更为离开状态
- `IPMSG_BR_ISGETLIST`：广播搜索有效的主机用户
- `IPMSG_OKGETLIST`：主机列表发出通知
- `IPMSG_GETLIST`：请求主机列表
- `IPMSG_ANSLIST`：应答主机列表
- `IPMSG_SENDMSG`：发送消息
- `IPMSG_RECVMSG`：接收消息确认
- `IPMSG_READMSG`：打开消息通知
- `IPMSG_DELMSG`：丢弃消息通知
- `IPMSG_ANSREADMSG`：打开消息确认通知（第 8 版追加）
- `IPMSG_GETFILEDATA`：请求附件（在 TCP 中使用）
- `IPMSG_RELEASEFILES`：取消附件
- `IPMSG_GETDIRFILES`：文件夹传输请求
- `IPMSG_GETINFO`：请求 IPMSG 版本信息
- `IPMSG_SENDINFO`：应答 IPMSG 版本信息
- `IPMSG_GETABSENCEINFO`：获取离开状态判定
- `IPMSG_SENDABSENCEINFO`：发送离开状态判定
- `IPMSG_GETPUBKEY`：请求 RSA 公钥
- `IPMSG_ANSPUBKEY`：应答 RSA 公钥

### 1.2 类型的选项标志（命令编号高 24 位）

- `IPMSG_ABSENCEOPT`：离开状态（使用用户识别命令）
- `IPMSG_SERVEROPT`：服务器（保留）
- `IPMSG_DIALUPOPT`：单独（分别）发送成员识别的命令
- `IPMSG_SENDCHECKOPT`：发送消息检查
- `IPMSG_SECRETOPT`：密封消息
- `IPMSG_READCHECKOPT`：密封消息确认（第 8 版追加）
- `IPMSG_PASSWORDOPT`：密码
- `IPMSG_BROADCASTOPT`：广播
- `IPMSG_MULTICASTOPT`：多播（选择多个）
- `IPMSG_NEWMULTIOPT`：新版本多播（保留）
- `IPMSG_NOLOGOPT`：无日志模式（推荐）
- `IPMSG_NOADDLISTOPT`：非 BR_ENTRY 不在线用户临时通知
- `IPMSG_AUTORETOPT`：自动应答（防止乒乓效应）
- `IPMSG_FILEATTACHOPT`：文件附件
- `IPMSG_ENCRYPTOPT`：密码
- `IPMSG_ENCEXTMSGOPT`：含有密文的文件附件信息
- `IPMSG_CAPUTF8OPT`：兼容 UTF-8 编码集
- `IPMSG_UTF8OPT`：所有消息使用 UTF-8 编码集
- `IPMSG_CLIPBOARDOPT`：支持附件嵌入信息的图像
- `IPMSG_RETRYOPT`：重发标志（获取 HOST/LIST 时使用）

### 1.3 加密扩展标志（扩展位在表达式中使用十六进制组合）

- `IPMSG_RSA_512`：公钥加密（RSA 512 位）
- `IPMSG_RSA_1024`：公钥加密（RSA 1024 位）
- `IPMSG_RSA_2048`：公钥加密（RSA 2048 位）
- `IPMSG_RC2_40`：密钥加密（RC2 40 位共用）
- `IPMSG_BLOWFISH_128`：密钥加密（Blowfish 128 位）
- `IPMSG_AES_256`：AES 256 位密钥加密
- `IPMSG_PACKETNO_IV`：在密钥编码 IV 里面使用 Packet 编号字符串
- `IPMSG_ENCODE_BASE64`：加密的密钥使用 Base64 编码表示
- `IPMSG_SIGN_SHA1`：给原文添加 SHA-1 字签名

### 1.4 用于附加文件类型（fileattr 低 8 位）

- `IPMSG_FILE_REGULAR`
- `IPMSG_FILE_DIR`
- `IPMSG_FILE_RETPARENT`
- `IPMSG_FILE_SYMLINK`
- `IPMSG_FILE_CDEV`
- `IPMSG_FILE_BDEV`
- `IPMSG_FILE_FIFO`
- `IPMSG_FILE_RESFORK`

### 1.5 附件文件扩展文件属性（fileattr 高 24 位）

- `IPMSG_FILE_RONLYOPT`
- `IPMSG_FILE_HIDDENOPT`
- `IPMSG_FILE_EXHIDDENOPT`
- `IPMSG_FILE_ARCHIVEOPT`
- `IPMSG_FILE_SYSTEMOPT`

### 1.6 附件文件扩展的文件属性

- `IPMSG_FILE_UID`
- `IPMSG_FILE_USERNAME`
- `IPMSG_FILE_GID`
- `IPMSG_FILE_GROUPNAME`
- `IPMSG_FILE_PERM`
- `IPMSG_FILE_MAJORNO`
- `IPMSG_FILE_MINORNO`
- `IPMSG_FILE_CTIME`
- `IPMSG_FILE_MTIME`
- `IPMSG_FILE_ATIME`
- `IPMSG_FILE_CREATETIME`
- `IPMSG_FILE_CREATOR`
- `IPMSG_FILE_FILETYPE`
- `IPMSG_FILE_FINDERINFO`
- `IPMSG_FILE_ACL`
- `IPMSG_FILE_ALIASFNAME`

## 2. 命令格式

命令格式版本一：

```text
Ver(1) : Packet编号 : 本机User名称 : 本机Host名称 : Command编号 : 附件部分
```

使用当前命令格式发送字符串消息的示例：

```text
1:100:shirouzu:jupiter:32:Hello
```

## 3. 命令处理概述

### 3.1 成员识别

启动时，使用 `IPMSG_BR_ENTRY` 命令广播，向已在线成员通告新上线成员。通过广播该命令，已在线成员把新进入成员的信息添加到自己的发送列表当中，同时新进入的成员应答 `IPMSG_ANSENTRY` 命令。

Windows 版的 IPMSG 在成员数量和 IP 地址距离的基础上，加入了 0–4 秒的随机等待时间。

新上线的成员通过接收 `IPMSG_ANSENTRY` 命令，可以立刻获得在线用户信息。因此，只要 IP 分组没有丢失，所有用户成员都能保有同样的发送列表。

对于离开或昵称的改变，广播 `IPMSG_BR_ABSENCE` 命令以通知所有成员。与 `IPMSG_BR_ABSENCE` 命令不同，接收到的成员不会应答 `IPMSG_ANSENTRY` 命令。

如果在 `IPMSG_BR_ENTRY`、`IPMSG_ANSENTRY` 以及 `IPMSG_BR_ABSENCE` 命令中出现离开状态，设置 `IPMSG_ABSENCEOPT` 标志，并在命令的扩展部分加入昵称。像拨号用户等没有收到网络指定广播的成员，需要设置 `IPMSG_DIALUPOPT` 标志；对于设置了该标志位的成员，会分别给他们发送用户判定命令。

分组扩展：`IPMSG_BR_ENTRY`、`IPMSG_ANSENTRY`、`IPMSG_BR_ABSENCE` 按照传统命令格式的字符串（插入 `\0`），再输入组名，用这些命令发送自己所在（设置）的组名。

### 3.2 信息接收

使用 `IPMSG_SENDMSG` 命令发送信息，在扩展部分放入信息实体。如果发送方设置了 `IPMSG_SENDCHECKOPT` 标志位，则接收方应答 `IPMSG_RECVMSG` 命令，并在扩展部分放入该包的编号。

离开通知等自动发送的包，为了防止乒乓效应，需要设置 `IPMSG_AUTORETOPT` 标志位。如果包的任何一个选项在使用时设置了该标志位，就不会返回确认和自动传输数据包。

发送密封的消息时，分组应该设置 `IPMSG_SECRETOPT` 标志位。接收方在启封时应答 `IPMSG_READMSG` 命令，并在扩展部分放入该包的编号。

`IPMSG_NOADDLISTOPT`：当收到来自不在发送列表中主机的 `IPMSG_SENDMSG` 命令时，可以向目标主机发送 `IPMSG_BR_ENTRY` 命令确定该主机是否存在，也可以直接把它添加到自己发送地址列表并进行相关处理。对于没有通报上线的单向信息发送，为了建议接收主机不遵循这样的跟踪行为，需要在 `IPMSG_SENDMSG` 命令里设置 `IPMSG_NOADDLISTOPT` 标志位。

关于 `IPMSG_READCHECKOPT` 标志（第 8 版追加）：如果在 `IPMSG_READMSG` 命令中设置了该标志位，处理方式与在 `IPMSG_SENDMSG` 中设置 `IPMSG_SENDCHECKOPT` 相同。应答时使用 `IPMSG_ANSREADMSG` 命令而不是 `IPMSG_RECVMSG` 命令。

信息中的嵌入图像在文件附件扩展部分说明。

### 3.3 信息收发——加密扩展（第 9 版追加）

将公钥（RSA）和公用密钥（AES/Blowfish/RC2）结合即可实现。加密相关的扩展部分原则上用十六进制表示。`IPMSG_ENCODE_BASE64` 具有加密功能。发送加密信息时，如果里面含有 `IPMSG_ENCODE_BASE64` 的加密信息，共用密钥部分用 Base64 编码代替十六进制形式（第 10 版添加）。

获取公钥：首先给接收方发送 `IPMSG_GETPUBKEY` 命令，然后接收对方应答的 `IPMSG_ANSPUBKEY` 命令，从而得到发送方的 RSA 公钥。发送带有 `IPMSG_GETPUBKEY`/`IPMSG_ANSPUBKEY` 的加密信息时，需要在扩展域的开头输入用按位或表示的主机加密能力（`IPMSG_RSA_2048` 等）。

`IPMSG_ANSPUBKEY` 命令中的公钥按照 `E-N` 的形式用 `:` 隔开（E = 指数，N = 模）。第二次接收/发送信息之后，根据公钥和加密信息的记录，可以省略这个序列。

信息加密化：发送方选择一个收发双方都支持的共用密钥类型，生成一个共用密钥，通过该密钥对信息进行加密。该密钥可以用对方的公钥加密，但存在实现组合限制。

加密信息发送：在 `IPMSG_SENDMSG` 命令里设置 `IPMSG_ENCEXTMSGOPT` 标志位，在扩展域开头填入公钥和公用密钥按位或的结果，接着输入 `:`（如果设置了 `IPMSG_ENCODE_BASE64` 标志位，则用 Base64 编码代替十六进制），再输入通过公钥加密的共用密钥，然后插入 `:`，最后输入用共用密钥加密的信息。原文末尾含有 `\0`。

电子签名选项：如果双方都支持 SHA-1 电子签名，在设置 `IPMSG_SIGN_SHA1` 标志位的基础上，需在前面的加密信息后输入 `:`，再添加用自己私钥加密的普通文章 SHA-1 摘要值。

编码和填充方式：RSA 使用 PKCS#1 v1.5；AES/Blowfish/RC2 共通密钥使用 PKCS#5 CBC。若使用 `IPMSG_PACKETNO_IV`，IV 使用包编号字符串（比 IV 短时后面用 `0` 补全）；若未使用 `IPMSG_PACKETNO_IV`，IV 直接改为 `0`。

如果与 Entry 相关的包中设置了 `IPMSG_ENCRYPTOPT` 标志位，表示支持加密功能。

带有指纹的公钥用户名（第 10 版添加）：可以使用 2048 位 RSA 且 SHA-1 签名的用户，在用户 ID 末尾添加用公钥签名的指纹，实现用户名称唯一性和抵御伪造共用密钥的冒领攻击（收到 `IPMSG_ANSPUBKEY` 命令时，需要确认密钥和指纹的一致性）。

创建带有公钥指纹的用户名：

1. 按照生成共用公钥的方法生成公钥的 SHA-1 摘要值（160 位）。
2. 在末尾补 32 位的 0，将其变成 192 位的值。
3. 将 192 位分为 3 个 64 位的场，将这 3 个做异或（XOR）操作。
4. 将 64 位值转化为 16 个固定字符的十六进制字符串。
5. 在用户名末尾添加“用户名<指纹字符串>”形式的指纹。

如果使用了用户名和公钥指纹，却没有设置 `IPMSG_ENCEXTMSGOPT` 标志位，或者在表明能够支持加密的 `IPMSG_GETPUBKEY`/`IPMSG_ANSPUBKEY` 上不包含 `IPMSG_RSA_2048`/`IPMSG_SIGN_SHA1` 标志位，建议丢弃该分组。

尽管使用了这种带有指纹的公钥用户名，`IPMSG_ENCRYPTOPT` 标志却没有出现在 Entry 序列里，或者 `IPMSG_RSA_2048`/`IPMSG_SIGN_SHA1` 没有包含在 `IPMSG_GETPUBKEY`/`IPMSG_ANSPUBKEY` 的加密标志位中，可以推断它被当做错误包丢弃。

### 3.4 附件文件扩展（第 9 版添加）

发送附件文件信息（下载许可）时，需要发送一个设置了 `IPMSG_FILEATTACHOPT` 标志位的 `IPMSG_SENDMSG` 命令。在普通（或加密）信息后插入 `\0`，再列举附件文件（可以下载）信息：

```text
fileID:filename:size:mtime:fileattr[:extend-attr=val1[,val2...][:extend-attr2=...]]:\a[:]fileID...
```

`size`、`mtime`、`fileattr` 以十六进制表示文件属性。如果 `filename` 中含有 `:` 符号，应使用 `::` 转义。

接收方想要下载附件时，发送 `IPMSG_GETFILEDATA` 命令请求，连接和发送方 UDP 端口号一样的 TCP 端口，在扩展域放入 `packetID:fileID:offset`（均为十六进制表示），发出数据传输请求包。

文件发送方收到请求，判定它是正确的请求之后再发送指定数据（没有格式）。

若数据接收方想下载阶层的附件文件时，使用 `IPMSG_GETDIRFILES` 命令，并且将 `packetID:fileID` 写入扩展域中，再发送数据传输请求包（全部使用十六进制表示）。

数据发送方可以用下面的格式来发送这种阶层数据：

```text
header-size:filename:file-size:fileattr[:extend-attr=val1[,val2...][:extend-attr2=...]]:contents-data
```

之后继续 `header-size:filename...`。除了 `filename` 与 `contents-data` 以外全部十六进制表示。

`header-size` 表示从 `header-size` 开始到 `contents-data` 前的 `:` 为止的大小。`extend-attr` 表示可以省略和使用多种扩展属性，输入使用与 `=` 对应容量的数据值。

当 `fileattr` 是 `IPMSG_FILE_DIR` 时，会自动看作已潜入该目录状态，并附带有后面文件的数据信息。

当 `fileattr` 是 `IPMSG_FILE_RETPARENT` 时，表示返回到父目录中，并且文件名总是 `.`。这时的属性值（返回到父目录之前时）是当前的目录信息。

发送过程是指从附件目录自身开始，发送 `IPMSG_FILE_RETPARENT` 信息，最后返回到附件目录的过程。

在 Entry 关联包中使用 `IPMSG_FILEATTACHOPT`，能够支持附件文件。

附件文件名加密：接着之前的从信息原文末尾到输入 `\0` 后的叙述，若对上述格式的内容进行整个信息的加密化，需要在 Entry 关联包和 `IPMSG_SENDMSG` 间建立 `IPMSG_ENCEXTMSGOPT`。

信息嵌入附件图像：在信息中插入图像，通常以附件文件的形式进行传输。`fileattr` 指定 `IPMSG_FILE_CLIPBOARD`，在文件名字段中指定包含画像种类的扩展名命名的虚拟文件名，一般使用 PNG 格式。嵌入图像的位置推荐使用包含 `IPMSG_FILE_CLIPBOARDPOS=` 的 `extend-attr=val`（均用十六进制表示）。若要插入多个图像，即使存在之前发送的图像，也都算作一个字符图像进行计数。

支持信息嵌入图像的用户，在 Entry 关联包里建立 `IPMSG_CLIPBOARDOPT` 命令。

### 3.5 多语言扩展（UTF-8）

主机可以通过 UTF-8 编码集在多种语言之间进行文件（夹）和消息的收发。

使用设置了 `IPMSG_CAPUTF8OPT` 标志位的 `IPMSG_BR_ENTRY`、`IPMSG_ANSENTRY` 和 `IPMSG_BR_ABSENCE` 命令发送数据包，表明能够使用 UTF-8 编码集传输信息。若相互都支持 `IPMSG_CAPUTF8OPT`，在设置 `IPMSG_UTF8OPT` 标志位的基础上，就能发送用 UTF-8 表示的信息数据包（包括附件信息部分）。

接收附件文件时，若附件信息中设置了 `IPMSG_UTF8OPT` 标志位，同样在 `IPMSG_GETFILEDATA` 命令中设置 `IPMSG_UTF8OPT` 标志位，发送附件文件转发请求，就能接收用 UTF-8 编码集表示的文件名和目录名。

BR 关联包（`IPMSG_BR_ENTRY`/`IPMSG_BR_EXIT`/`IPMSG_BR_ABSENCE`）的 `IPMSG_UTF8OPT` 不能用 UTF-8 表示，因为会在既存的非 UTF-8 客户端中出问题。因此，BR 关联包在组名扩展的后面添加 `\0\n` 两位（没有输入组名扩展时，输入 `\0` 后再输入 `\0\n`，也就是 `\0\0\n`，作为虚拟组名），再用 UTF-8 形式添加以下 Entry：

```text
UN:用户名
HN:主机名
NN:昵称
GN:组名
```

只能使用 ASCII 表示的 Entry 和不存在的 Entry 可以省略。如果上述扩展和以前的字段存在不同，解释时把扩展 Entry 作为正确的进行处理。

### 3.6 其它命令

通过发送 `IPMSG_GETINFO` 命令，可以取得其它成员的版本信息。接收方应答 `IPMSG_SENDINFO` 命令，在扩展区域设定版本信息字符串。

对于离开状态用户，发送 `IPMSG_GETABSENCEINFO` 命令取得离开状态信息。如果接收方处于离开状态，则应答 `IPMSG_SENDABSENCEINFO` 命令设定离开信息；如果未处于离开状态，则应答相关字符串（如 `Not absence mode` 等）。

### 3.7 确认与重传

在某一段时间内没有收到确认分组（如 `IPMSG_SENDMSG`、`IPMSG_RECVMSG` 等），则重传相同的包。重传的次数和间隔依赖于具体实现。

## 4. 其它

### 4.1 换行

发出信息的换行符统一为 UNIX 风格（`0x0a`）。必要情况下请更换形式（转义）。

### 4.2 分隔符

使用 `:` 作为分隔符时，用户名或主机名可能包含 `:` 字符串，所以这里不能使用。若主机名中包含 `:`，请使用其他字符（例如 `;`）进行置换（或转义）。

### 4.3 字符编码

如果设置了 `IPMSG_UTF8OPT` 标志位，而字符编码不是 UTF-8，假设这种情况下使用 CP932 字符集。

### 4.4 加密的组合

这不是协议的必需组合，请参考具体实现的描述。Windows 版支持下列三个组合：

1. `IPMSG_RSA_2048` / `IPMSG_AES_256`：支持 `IPMSG_PACKETNO_IV`/`IPMSG_SIGN_SHA1`
2. `IPMSG_RSA_1024` / `IPMSG_BLOWFISH_128`：支持 `IPMSG_PACKETNO_IV`
3. `IPMSG_RSA_512` / `IPMSG_RC2_40`

## 附录

命令代码请参考 `ipmsg.h` 文件。

> 文档翻译自：IP Messenger 协议（草案版本 10），来源：https://github.com/franksong/ipmsg/blob/master/doc/protocol_zh.txt
