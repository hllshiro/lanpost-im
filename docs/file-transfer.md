# 私有文件与文件夹传输

本客户端只使用内网通 NWT 私有协议传输文件，不再有 IPMSG `GETFILEDATA` 路径。数据通道细节见 `docs/nwt-file-channel.md`。

## 两条数据通道

| 类型   | 默认端口 | 协议号 | 说明                                             |
| ------ | -------- | ------ | ------------------------------------------------ |
| 文件   | 9013/TCP | 1      | HELLO / ACK / PATH / DATA；逐文件拉取或反向推送   |
| 文件夹 | 9014/TCP | 2      | 先发清单，再按项流式发送；发送方主动连接接收方   |

实际端口以 `X_HANDSHARK` 的 `FILE_TRAN_TCP_PORT` / `FOLDER_TRAN_TCP_PORT` 为准；9013/9014 只是默认监听与回退端口。

## 文件流程

1. 发送方发 `X_SEND_FILE(1009)` 邀请，`TASK_ID` 是十进制数字。
2. 接收方接受时发 `X_OPERATE_RECV_FILE(1011, OP=2)`；发送方发 `X_OPERATE_SEND_FILE(1010, OP=2)`。
3. 接收方连接发送方的文件端口，走 HELLO/ACK/PATH/DATA。
4. 对端不主动来连时，接收方可以发 `X_REVERSE_FILE_REQ(1019)`，让发送方反向连到接收方公布的反向端口。
5. 进度通过 1012 回报；图片复用同一条通道，按 md5 缓存。

## 文件夹流程

1. 发送方发 `X_SEND_FOLDER(1013)`，`TASK_ID` 是 GUID 字符串。
2. 接收方回 `X_OPERATE_RECV_FOLDER(1015, OP=2)`，发送方发 `X_OPERATE_SEND_FOLDER(1014, OP=2)`。
3. 发送方连接接收方的文件夹端口，依次发送开场、清单、逐项数据、收尾。
4. 接收目录按设置选择平铺或按联系人昵称建子目录。

## 排查

| 现象 | 优先检查 |
| ---- | -------- |
| 对端一直等待 | 9013/9014 TCP 是否放行；设置页防火墙是否显示“已放行” |
| 本机没有连接记录 | 防火墙、第三方安全软件、`network.bindAddr` 是否为 0.0.0.0 |
| 有连接但立刻断开 | 文件号/task id 是否匹配；是否把文件夹 GUID 当成了文件数字 |
| 发送方停在等待 | 取消/拒绝的 `OP` 取值尚未还原，当前只处理 `OP=2` |

## 端口与配置

- 文件端口：`network.privateFilePort`，默认 9013。
- 文件夹端口：`network.privateFolderPort`，默认 9014；0 表示不接收文件夹。
- 修改端口或监听地址后需要重启。
- Windows 安装包按程序路径放行；Linux deb/rpm 为默认端口添加 ufw/firewalld 规则，设置页可重新修复。

## 参考

- `docs/nwt-file-channel.md`
- `docs/nwt-private-protocol.md`
- `docs/known-limits.md`
