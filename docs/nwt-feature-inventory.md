# 内网通 3.4.3055 功能清单（基于安装目录 UI 资源）

本文是对 **内网通（Nwt）3.4.3055（Windows）** 已安装 UI 资源的静态盘点，用于给私有协议逆向定范围：先确认“有哪些功能”，再猜“功能对应哪条通道”。

- 资源根目录：`D:\Program Files (x86)\nwt\Nwt\res\ShiYeLine\`
- 方法：只读解析 `layout/*.xml`、`layout/system/*.xml`、`menu/*.xml`、`value/string.xml`、`value/{config,color,font,image}.xml`、`image/` 文件名。
- **未做**：抓包、反汇编、动态调试、运行程序。
- 资源规模（实测）：`layout` 132 个、`layout/system` 25 个、`menu` 24 个、`image` 303 个文件、`value/string.xml` 1055 条字符串（`StringTable` 共 1060 行）。
- 引用约定：`IDS_*` 后的括号数字是 `value/string.xml` 的**行号**；带 `<br>`/换行的原文已压平。

> 结论摘要：资源里能“看见”的功能远多于已逆向的文字消息。至少有 **23 个功能域**、**9 类**明确只能在私有通道工作（振屏、表情、字体、图片、文件夹、远程协助、文件共享、群组、密聊、截图），以及 3 条强线索指向协议字段：**组织号**（发现域）、**离线**（发送方在线才能投递）、**装饰状态**（红名/加冠/排名优先必须被对端看见）。

---

## 0. 先看主框架：三个 Tab + 七个底部入口

`layout/MainDialog.xml` 是整个客户端的功能地图，信息密度最高：

| 元素 | 控件 / 说明 |
|---|---|
| 标题区 | 头像按钮（`UserHeadButton.xml`）、姓名、状态按钮（`StatusButton.xml`，`StatusMenu.xml` 弹出“找我沟通 / 拼命工作中 / 我在开会 / 离开”） |
| 昵称行 | `SkinEditViewEx Id=104`（Limit 32）——主面板可直接改昵称 |
| 搜索 | `SearchComboBox Id=105`，`IDS_SEARCH_COMBOBOX_TIPS`（22）“搜索：联系人，群” |
| 三个 Tab | `MainTabRecent`（最近联系人）、`MainTabContactor`（联系人）、`MainTabQGroup`（群），布局 Host 内是 `MessageListView` / `UserTreeView` / `QGroupListView` |
| 底部按钮 | 301 主菜单、302 系统设置、306 消息管理器、303 **文件共享**、304 **群发**、311 **一键扫描（加联系人）**、312 **创建群**、313 刷新 |
| 文件拖放 | 对话框 `Drag="File"`——拖文件到主面板即可发送 |
| 悬浮窗 | 锁屏层 `LockScreenLayout` 与主面板互斥切换（`SwitchAnimationHost`） |

主面板直接暴露的“功能入口”共 7 个，另加头像/状态/搜索/刷新：这是后面所有功能域的索引。

---

## 1. 主面板、会话列表与联系人树

| 功能名 | 相关 layout | 关键 UI 字符串 | 备注 |
|---|---|---|---|
| 最近联系人列表 | `MainDialog.xml`、`UserMessageItem.xml`、`QGroupMessageItem.xml`、`SingleChatListItem.xml`、`QGroupChatListItem.xml` | `IDS_RECENT_CONTACTOR`（16）、`IDS_EMPTY_RECENT_CONTACTOR`（222） | 列表项含未读红点（`RedPoint.png` + 数字）与关闭按钮 |
| 联系人树（部门分组） | `UserItem.xml`、`UserItem2.xml`、`UserItem3.xml`、`GroupItem.xml`、`SelectGroupItem.xml` | `IDS_CORP_STRUCT`（15）、`IDS_CORP_STRUCT_LAN_FORMAT`（228） | 树节点显示 `部门 (在线/总数)` |
| 群列表 | `QGroupItem.xml`、`QGroupItem2.xml`、`QGroupListView` | `IDS_QGROUP`（451）、`IDS_QGROUP_EMPTY_TIPS`（224） | 群项显示群名 + 人数（`IDS_QGROUP_MEMBER_NUMBER_FORMAT` 517 `%d人`） |
| 三栏聊天窗口（会话列表 + 对话区） | `ChatDialog.xml`、`ChatMessageLayout.xml`、`ChatFileLayout.xml`、`ChatImageLayout.xml` | `IDS_SEARCH_COMBOBOX_SHORT_TIPS`（23） | 左侧会话列表可搜索；右侧是可切换的 消息 / 往来文件 / 图片 三个视图 |
| 会话置顶 / 取消置顶 | 菜单 `UserMessageItemMenu.xml`、`QGroupMessageItemMenu.xml` | `IDS_SESSION_TOP`（807）、`IDS_CANCEL_SESSION_TOP`（808） | 仅本地排序 |
| 备注姓名 / 备注群名 | 菜单同上 | `IDS_EDIT_USER_REMARK`（811）、`IDS_EDIT_QGROUP_REMARK`（806） | 本地别名 |
| 未读提示与“正在输入” | `ChatDialog.xml`（`ChatFloatLayout` 未读气泡）、`UserChatLayout.xml` | `IDS_CHATDLG_WRITING`（234） | “正在输入”有独立状态字符串 |
| 离线成员清理 | `UserItemMenu.xml`、`GroupItemMenu.xml` | `IDS_TOOLBAR_CLEAR_USER_TIPS`（215）、`IDS_CLEAR_MONTH_USER_PROMPT`（220） | 清本地联系人缓存，不发协议报文 |
| 大头像 / 小头像 | 菜单 `UserItemMenu.xml`、`GroupItemMenu.xml` | `IDS_HEAD_SHOW`（803）、`IDS_BIG_HEAD_SHOW`（804）、`IDS_SMALL_HEAD_SHOW`（805） | 纯 UI |
| 悬浮窗模式 | `MainDialog.xml` | `IDS_CHANGE_MIN_MODE_TIPS`（433）、`IDS_MIN_MODE_TIPS`（449 “拖动文件或文件夹试试”） | 最小化形态仍可拖文件发送 |
| 新手引导 | `GuideDialog.xml` | `IDS_NEW_GUIDE`（779）、`IDS_YOUR_NAME`（27）、`IDS_YOUR_DEPARTMENT`（28）、`IDS_ADD_SUBNET_AUTO`（780） | 三步：填姓名 → 填部门 → 配网段 |

---

## 2. 用户资料、头像、签名、名片

| 功能名 | 相关 layout | 关键 UI 字符串 | 备注 |
|---|---|---|---|
| 编辑个人资料 | `PersonalInfoDialog.xml` | `IDS_OPTION_PERSONAL`（40）、`IDS_EDIT_PERSONAL_INFO`（956）、`IDS_SAVE`（948） | 字段：姓名、签名、性别、单位、部门、电话、手机、邮箱；版本、IP 只读 |
| 个性签名 | 同上 `Id=1102` | `IDS_SIGN`（65）、`IDS_EDIT_SIGN_TIPS`（940）、`IDS_SIGN_TIPS`（941） | 限 32 字 |
| 性别 | 同上 `Id=1103` | `IDS_GENDER`（66）、`IDS_GENDER_MALE`（80）、`IDS_GENDER_FEMALE`（81） | 性别会限制可用头像（见下） |
| 单位 / 企业名称 | 同上、`CompanyDialog.xml` | `IDS_COMPANY`（67）、`IDS_USER_NAME_TIPS`（25 “请填写单位名称”）、`IDS_COMPANY_TIPS`（68） | 首次启动弹 `CompanyDialog` 强制填单位 |
| 部门（最多三级） | 同上、`DepartmentTips.xml` | `IDS_DEPARTMENT_TIPS`（145）、`IDS_NOT_VALID_DEPARTMENT_TIPS2`（70） | 用 `/` 分隔层级，直接决定联系人树分组 |
| 头像库与自定义头像 | `UserHeadDialog.xml`、`UserDefaultHeadItem.xml`、`UserHeadItem.xml`、`UserHeadButton.xml`/`2.xml` | `IDS_SET_PHOTO`（82）、`IDS_SET_PHOTO2`（83）、`IDS_ADD_PHOTO`（86）、`IDS_DELETE_PHOTO`（87） | 内置 76×76 头像网格 + `ImageEditor` 裁剪（滚轮缩放/拖动） |
| 头像按性别校验 | 同上 | `IDS_MALE_CHANGE_TO_FEMALE_HEAD`（91）、`IDS_FEMALE_CHANGE_TO_MALE_HEAD`（92） | 内置头像分男女，服务端/对端不做校验 |
| 联系人名片（悬浮卡） | `UserNameCardDialog.xml` | `IDS_USER_CARD_NAME_TIPS`（958）、`IDS_PHONE`/`MOBILE`/`EMAIL`/`VERSION`/`IP`（77/78/76/441/440） | 展示电话、手机、邮箱、版本、IP |
| 好友信息显示开关 | `OptionDialog.xml`（2401 分组） | `IDS_FRIEND_INFO_SHOW`（950）、`IDS_SHOW_SIGN`（951）、`IDS_SHOW_IP`（952） | 只影响本地渲染 |
| 隐藏自己 IP | `OptionDialog.xml`（2005） | `IDS_HIDE_IP`（98）、`IDS_IP_HIDED`（442） | **会改变对外通告里的 IP 字段** |
| 名字颜色/装饰标记 | 会话与联系人项 | `IDS_USER_NAME_FORMAT`（959 `%s/%s\|ID_COLOR_DISABLE/(%s)`） | 名字串里内嵌颜色指令，说明装饰是随身份下发的字符串 |

---

## 3. 通讯录、部门、企业组织号、自动分组

| 功能名 | 相关 layout | 关键 UI 字符串 | 备注 |
|---|---|---|---|
| 组织号（同网段内再分域） | `NetworkDialog.xml` `Id=3005`、`CorpNumberTips.xml` | `IDS_CORP_STRUCT_NUMBER`（143）、`IDS_CORP_STRUCT_NUMBER_TIPS`（144） | **“组织号不同，不能发现对方，也不能互发消息和文件。可同时加入 10 个组织，用 # 分隔”**——发现与消息的准入条件，协议级强线索 |
| 部门自动分组 | `OptionDialog.xml`（2009） | `IDS_AUTO_GROUP`（652）、`IDS_AUTO_GROUP_RULE`（653）、`IDS_OPEN_AUTO_GROUP`（654）、`IDS_AUTO_GROUP_TIPS`（657） | 用对端“部门”字段在本地建树，`IDS_AUTO_GROUP_NOT_EXIST_DEPT`（656）说明依赖对端资料 |
| 内网通联系人 / 未分组 | `GroupItem.xml` | `IDS_CORP_STRUCT_LAN_NOT_AUTO_GROUP`（226）、`IDS_CORP_STRUCT_LAN_AUTO_GROUP`（227） | 两种兜底分组 |
| 飞鸽/飞秋联系人分组 | `GroupItem.xml` | `IDS_GROUP_IPMSG`（230）、`IDS_CORP_STRUCT_IPMSG_FORMAT`（229）、`IDS_OPEN_IPMSG_GROUP`（655） | 兼容协议联系人单独成树 |
| 仅显示在线成员 | 菜单 `UserItemMenu.xml`、`GroupItemMenu.xml` | `IDS_ONLY_SHOW_ONLINE_USER`（822） | 本地过滤 |
| 组织架构全收起 | 菜单同上 | `IDS_COLLAPSE_USER_TREE_NODE`（966） | 本地 |
| 一键扫描局域网加联系人 | `ScanDialog.xml` | `IDS_ONE_KEY_ADD_CONTACTOR`（607）、`IDS_SCANNING_TIPS`（609）、`IDS_FAST_SCAN_TIPS1/2`（618/619）、`IDS_FULL_SCAN_TIPS1/2`（620/621） | 快速扫描 B/C 类网段（约 3 分钟）、完全扫描 A/B/C（约 20 分钟）；**逐 IP 主动探测**，不是被动等广播 |
| 扫描结果统计 | 同上 | `IDS_SCAN_CONTACTOR_BEGIN/END`（613/614）、`IDS_SCAN_COMPUTER_BEGIN/END`（615/616） | 会统计“还有 N 台电脑未安装内网通” |
| 网段设置 / 其他网段联系人 | `SubnetDialog.xml`、`AddSubnetTips.xml` | `IDS_SUBNET_CONFIG`（957）、`IDS_OTHER_SUBNET`（154）、`IDS_SUBNET_EDIT_TIPS`（150） | 支持手动加网段、导入/导出（`IDS_EXPORT_IP` 88 / `IDS_IMPORT_IP` 89） |
| 网段分享（P2P 传播） | `SubnetDialog.xml`（202 分享）、`SyncSubnetTips.xml` | `IDS_SYNC`（783）、`IDS_SYNC_SUBNET_PROMPT`（785）、`IDS_SHARE_SUBNET_CONFIRM_FORMAT`（877）、`IDS_NOTIFY_SYNC_SUBNET`（271 “将其网段分享给了您”） | **一条应用层消息携带网段列表**，可关闭接收（`IDS_NOT_ACCEPT_SUBNET_SHARE` 962） |
| 网段黑名单 / 仅连指定网段 | `SubnetBlackNameDialog.xml`、`SubnetDialog.xml`（401） | `IDS_SUBNET_BLACK_NAME`（1027）、`IDS_ONLY_CONTECT_UP_SUBNET`（1026）、`IDS_SUBNET_RESTART_TIPS`（1028） | 改后需重启；影响绑定与广播范围 |

---

## 4. 私聊：文字、字体、表情、图片（含文本内图片）

| 功能名 | 相关 layout | 关键 UI 字符串 | 备注 |
|---|---|---|---|
| 单聊窗口 | `ChatDialog.xml` + `UserChatLayout.xml` | `IDS_CHAT`（534）、`IDS_SEND`（191）、`IDS_SEND_SHORTCUT`（194） | 左侧会话列表 + 右侧输入区；ESC 关窗、F7 打开接收目录（`IDS_CHATDLG_USAGETIP_7` 412） |
| 文字输入与发送键 | `UserChatLayout.xml` `Id=2203`（RichEdit, Limit 5000）、`SendMsgMenu.xml` | `IDS_SEND_ENTER`（198）、`IDS_SEND_CTRL_ENTER`（199） | Enter / Ctrl+Enter 可配 |
| 字体 / 颜色 / 字号 | `UserChatLayout.xml`（2101 + 隐藏的 2020 工具栏） | `IDS_FONT_TIPS`（338）、`IDS_TOOLBAR_SEND_MSG_TIPS`（200） | 隐藏的 2021/2022/2026 是字体、字号、颜色下拉 |
| 表情（图片表情） | `EmotionDialog.xml`、`EmotionTabCtrl` | `IDS_EMOTION_TIPS`（339）、`IDS_PRIVIEW_EMOTION`（820 `[表情]`） | 表情是图片资源，不是 Unicode emoji；emoji 字符支持**待验证**（资源里无直接证据） |
| 发送图片（文本内图片） | `UserChatLayout.xml`（2103）、`ChatImageLayout.xml`、`ChatImageDateItem.xml`、`ImageMenu.xml` | `IDS_PICTURE_TIPS`（341）、`IDS_PRIVIEW_PICTURE`（821 `[图片]`）、`IDS_IMAGE_SAVEAS`（181）、`IDS_ADDTO_EMOTION`（182） | 图片作为消息节点内嵌在会话流里；可另存、可直接“添加到表情” |
| 图片查看器 | 图片记录 / `ImageMenu.xml` | `IDS_FULL_SCREEN_TIPS`（372）、`IDS_IMAGE_ROTATE_TIPS`（946）、`IDS_IMAGE_GIF_ROTATE_TIPS`（945） | 支持全屏、旋转（GIF 不支持旋转）、实际大小 |
| 粘贴文本 / 复制 | `EditMenu2.xml` | `IDS_PASTE_TEXT`（994）、`IDS_COPY_SUCCESS`（180） | 富文本编辑框右键菜单 |
| 拖文件到输入框/主面板 | `UserChatLayout.xml` `Drag="File"`、`MainDialog.xml` | `IDS_CHATDLG_NOTCAN_CLOSECAUSE_REMAINSENDMSG`（245） | 有未发送内容时禁关窗 |
| 消息发送失败提示 | `ChatTipsItem.xml` | `IDS_CHATDLG_SEND_MSG_LOST_BEGIN/END`（235/236）、`IDS_CHATDLG_OFFLINE_TIPS`（240 “对方当前处于离线状态”） | 传输层失败会以系统消息条形式插入会话 |
| 消息安全文案 | 会话顶部 | `IDS_SEND_SINGLE_CHAT_MSG_SAFE_TIPS`（296）、`IDS_SINGLE_CHAT_RECORD_SAFE_TIPS`（298） | 明确“不过外网服务器”“记录 AES 加密保存本地” |

---

## 5. 消息扩展能力：振屏、密聊、回执、撤回、群发

| 功能名 | 相关 layout | 关键 UI 字符串 | 备注 |
|---|---|---|---|
| 振屏（闪屏） | `UserChatLayout.xml` `Id=2107`（`ShakeScreen.png`） | `IDS_FLASH_SCREEN_TIPS`（355）、`IDS_CHATDLG_FLASH_SCREEN_SEND`（238）、`IDS_CHATDLG_FLASH_SCREEN_RECEIVE`（239）、`IDS_FLASH_SCREEN_TOO_FREQUENTLY`（241） | **只在单聊布局里**，群聊布局没有该按钮；有频率限制（客户端侧）；与飞鸽/飞秋**不支持**（`IDS_IPMSG_FLASH_SCREEN_MY_TIPS` 575） |
| 密聊（不入库） | `UserChatLayout.xml` `Id=1106`（`HideRecord32.png`） | `IDS_HIDE_RECORD`（483）、`IDS_HIDE_RECORD_TIPS`（477 “此条消息不保存”）、`IDS_OPEN_HIDE_RECORD_TIPS`（482）、`IDS_HIDE_RECORD_NOT_SUPPORT_TIPS`（478） | 有**能力协商**语义（对方版本低则不可用）；与飞鸽/飞秋不支持（597） |
| 已读回执 | `UserChatLayout.xml` `Id=2204`（“消息需回执” checkbox） | `IDS_MSG_NEED_RECEIPT`（1035）、`IDS_SEND_RECEIPT`（1036）、`IDS_RECV_RECEIPT_FORMAT`（1043）、`IDS_SEND_RECEIPT_FORMAT`（1042）、`IDS_RECEIPT_MESSAGE_LOST_END`（237） | 每条消息一键决定是否要回执 |
| 撤回消息 / 撤回文件 | `MsgItemMenu.xml`（11017）、`SendFileItem.xml`（20148） | `IDS_RETRIEVE_MESSAGE`（1029）、`IDS_RETRIEVE`（1030）、`IDS_RETRIEVE_MESSAGE_TIPS`（1031）、`IDS_RETRIEVE_MESSAGE_FAIL_TIPS`（1037 “超过 2 分钟不能撤回”）、`IDS_RETRIEVE_FILE_FOLDER_TIPS`（1032） | 2 分钟窗口是**双方都要遵守**的约束；文件也能撤回 |
| 撤回兼容性提示 | 系统消息 | `IDS_RETRIEVE_MSG_NOT_SUPPORT_TIPS`（480） | 老版本收到撤回请求时的降级文案 |
| 群发（批量发送） | `BatchSendDialog.xml`、`BatchSendBkg.png` | `IDS_BATCH_SEND`（629）、`IDS_BATCH_SEND_TIPS`（630）、`IDS_FROM_GROUP_SEND`（1044 `【群发消息】`）、`IDS_ALL_ACTIVE_SEND`（651） | 群发=逐个单聊，消息里带群发前缀；可同时发文件/文件夹 |
| 群发上限保护 | 同上 | `IDS_BATCH_SEND_RECEIVER_TOO_MUCH_FORMAT`（642）、`IDS_BATCH_SEND_MSG_RECEIVER_TOO_MUCH_FORMAT`（643） | 人数超限二次确认 |

---

## 6. 群聊（建群 / 管理 / 公告 / 群文件）

| 功能名 | 相关 layout | 关键 UI 字符串 | 备注 |
|---|---|---|---|
| 创建群 | `SelectUserDialog.xml`、`SelectUserItem.xml`、`SelectGroupItem.xml`、`InviteUserDialog.xml` | `IDS_CREATE_QGROUP`（453）、`IDS_CREATE_QGROUP_SEL_MEMBER`（452）、`IDS_SELECT_CONTACTOR`（455） | 从联系人树勾选成员；群名必填（`IDS_QGROUP_NAME_EMPTY_TIPS` 462） |
| 群资料（名称/主题/公告/照片） | `QGroupInfoDialog.xml`、`QGroupHeadDialog.xml`、`QGroupDefaultHeadItem.xml`、`QGroupHeadButton.xml` | `IDS_QGROUP_INFO`（531）、`IDS_QGROUP_NAME`（454）、`IDS_SUBJECT`（463）、`IDS_QGROUP_NOTICE`（460）、`IDS_NOTICE`（461）、`IDS_SET_QGROUP_PHOTO`（84） | 名称限 16、主题 32、公告 150 字（MultiLine） |
| 群公告变更广播 | 会话系统消息 | `IDS_QGROUP_UPDATE_NOTICE_FORMAT`（468）、`IDS_QGROUP_MASTER_UPDATE_NOTICE_FORMAT`（472） | 群主改公告后**全员收到系统消息** |
| 群主权限：允许他人拉人 | `QGroupInfoDialog.xml`（2001） | `IDS_NOT_ALLOW_OTHER_INVITE`（527）、`IDS_ALLOW_OTHER_INVITE`（528） | 默认禁止，仅群主可开 |
| 加人依赖群主在线 | 同上 | `IDS_QGROUP_INVITE_MASTER_OFFLINE_TIPS`（524）、`IDS_QGROUP_INVITE_MASTER_VERSION_TIPS`（525）、`IDS_QGROUP_INVITE_MASTER_ALLOW_TIPS`（526） | **“群主不在线就无法加成员”** → 群主承担权威/仲裁角色，强烈暗示无中心服务器 |
| 邀请/入群/拒绝流程 | `InviteUserDialog.xml` | `IDS_QGROUP_INVITE_TIPS`（476）、`IDS_QGROUP_INVITE_PROMPT_FORMAT`（499）、`IDS_QGROUP_INVITE_AGREE`（500）、`IDS_QGROUP_INVITE_REFUSE`（501）、`IDS_QGROUP_REFUSE_JOIN_FORMAT`（502）、`IDS_QGROUP_AGREE_JOIN_FORMAT`（503） | 需要被邀请人同意 |
| 解散群 / 退群 / 踢人 | 菜单 `QGroupItemMenu.xml`、`QGroupUserMenu.xml` | `IDS_QGROUP_DISMISS`（490）、`IDS_QGROUP_DISMISS_PROMPT`（493）、`IDS_QGROUP_DISMISS_FORMAT`（504）、`IDS_QGROUP_QUIT`（494）、`IDS_QGROUP_KICK`（492）、`IDS_QGROUP_KICK_FORMAT`（505） | 解散/被踢有全员广播文案 |
| 群成员列表 | `QGroupMemberLayout.xml`、`MasterItem.xml`、`MemberItem.xml` | `IDS_QGROUP_MEMBER`（484）、`IDS_QGROUP_MEMBER_FORMAT`（456）、`IDS_QGROUP_MASTER`（457）、`IDS_OPEN_QGROUP_MEMBER`（963 “自动显示群成员列表”） | 群主项带皇冠图标（`QGroupMaster.png`） |
| 群消息设置 | `QGroupInfoDialog.xml`（3001-3003）、`QGroupItemMenu.xml` | `IDS_QGROUP_MSG_SETTING`（512）、`IDS_QGROUP_AUTO_POPUP_MSG`（514）、`IDS_QGROUP_JUST_SAVE_MSG`（515）、`IDS_QGROUP_REFUSE_MSG`（516） | 三档：弹窗 / 只收不弹 / 全部阻止 |
| 群聊天窗口 | `QGroupChatLayout.xml`、`QGroupMessageItem.xml`、`RecvQGroupMsgItem.xml` | `IDS_QGROUP_CONFIG_TIPS`（529）、`IDS_QGROUP_INVITE_TIPS`（476）、`IDS_CHAT_RECORD`（249） | 头部按钮：群设置、退群、邀请；**无振屏、无密聊、无回执** |
| 群内文件/文件夹 | `RecvQGroupFileItem.xml`、`SendFileItem.xml` | `IDS_FEMIND_QGROUP_FILE_FORMAT`（1025）、`IDS_FEMIND_QGROUP_FOLDER_FORMAT`（1024） | 群文件与单聊文件共用传输列表，但带“谁已接收”回执文案 |
| 群消息气泡（含发送者名） | `RecvQGroupMsgItem.xml` | `IDS_RETRIEVE_MESSAGE_FORMAT`（1033 `%s撤回了一条消息`） | 群消息项独立显示昵称行 |
| 群组兼容性 | `string.xml` 594-596 | `IDS_IPMSG_QGROUP_INVITE_MY_TIPS`（594） | 群组**完全不支持**飞鸽/飞秋 |

---

## 7. 文件与文件夹传输

| 功能名 | 相关 layout | 关键 UI 字符串 | 备注 |
|---|---|---|---|
| 发送文件 / 文件夹 | `UserChatLayout.xml`（2105/2106）、`FileTransLayout.xml`、`FileTransItem.xml` | `IDS_SEND_FILE_TIPS`（336）、`IDS_SEND_FOLDER_TIPS`（337）、`IDS_FILE_TRANS`（110）、`IDS_SEND_FOLDER`（428） | 单聊窗口工具栏两个独立按钮 |
| 传输列表（收发同列） | `FileTransLayout.xml` | `IDS_RECV_ALL`（281）、`IDS_SAVEAS_ALL`（282）、`IDS_CANCEL_ALL`（283） | 底部三个批量操作 |
| 单条传输状态 | `FileTransItem.xml` | `IDS_FILE_TRANS_CONNECT_ING`（277）、`IDS_FILE_TRANS_CONNECT_SUCCESS`（278）、`IDS_FILE_TRANS_SPEEN_FORMAT`（292）、`IDS_UNKNOWN_SPEED`（291） | 有“正在连接 / 连接成功 / 速度 + 剩余时间” |
| 接收 / 拒收 / 另存 / 续传 | `FileTransItem.xml`、`RecvFileItem.xml`、`ChatFileLayout.xml` | `IDS_RECV`（284）、`IDS_RECV_SAVE_AS`（285）、`IDS_RECV_REFUSE`（286）、`IDS_RECV_CONTINUE`（287 “续传”）、`IDS_SEND_AGAIN`（288） | **断点续传**是明确功能（`IDS_SEND_FILE_FAILD_FORMAT` 308 也说“重新发起支持断点续传”） |
| 传输失败原因枚举（10 种） | 同上 | `IDS_FILE_TRANS_FAILD_REASON1`~`10`（318-327） | 含“对方取消 / 您取消 / 网络连接失败 / 传输异常中断 / 可能被删除” |
| 同名文件冲突处理 | `AcceptFileConfirmDialog.xml`、`AcceptFileButton.xml` | `IDS_ACCEPT_FILE`（1012）、`IDS_ACCEPT_FILE_RENAME`（1015）、`IDS_ACCEPT_FILE_REPLACE`（1017）、`IDS_ACCEPT_FILE_ALWAYS`（1019） | 可“为之后所有冲突执行此操作” |
| 文件夹传输细节 | `FileTransItem.xml`、`string.xml` 386-429 | `IDS_FOLDERTRANS_MAX_ITEM_LIMIT_TIP`（399）、`IDS_FOLDERTRANS_MAX_ITEM_SIZE_TIP`（400）、`IDS_FOLDERTRANS_EMPTY_LIMIT_TIP`（401）、`IDS_FOLDERTRANS_OFFLINE_TIP`（407） | 有文件个数/单文件大小/空目录/磁盘空间四类上限 |
| 文件夹接收报告 | 通知窗口 | `IDS_FOLDER_REPORT`（417）、`IDS_RECV_FOLDER_SUCCESS_PART_FORMAT`（316） | “失败个数”统计 |
| 主动发送（对端免请求） | `OptionDialog.xml`（2502）、`FileTransItem.xml`（306） | `IDS_ALLOW_ACTIVE_SEND`（435）、`IDS_ACTIVE_SEND_TIPS`（438）、`IDS_ACTIVE_SEND`（447） | **允许对方不经确认直接推文件**，落在默认目录 |
| 存储路径策略 | `OptionDialog.xml`（2506/2507） | `IDS_STORE_PATH`（111）、`IDS_SELECT_PATH`（113）、`IDS_RECV_PATH_SENDER`（436）、`IDS_RECV_PATH_TIME`（437） | 按发送者姓名 / 按接收时间建子目录 |
| 发送前校验 | 提示条 | `IDS_FILE_SIZE_ZERO_FORMAT`（305）、`IDS_FILE_EXIST_FORMAT`（303）、`IDS_FILE_OPENED_FORMAT`（304）、`IDS_SELECT_FILE_COUNT_OVER_LIMIT_FORMAT`（334） | 空文件、独占、数量上限（图片另有上限 333） |
| 与 IPMSG 互通的文件 | 提示条 | `IDS_SEND_IPMSG_FILE_FAILD_FORMAT`（309）、`IDS_IPMSG_FILE_TRANS_MY_TIPS`（585） | 单文件走 IPMSG 可以，**文件夹不行** |

---

## 8. 共享文件柜（文件共享）

| 功能名 | 相关 layout | 关键 UI 字符串 | 备注 |
|---|---|---|---|
| 共享文件柜主窗口 | `FileShareDialog.xml` | `IDS_FILE_SHARE_TIPS`（708）、`IDS_SHARE`（707） | 左侧联系人树（`UserTreeView`）+ 搜索，右侧是对方/自己的共享目录 |
| 我的共享 | `FileShareDialog.xml`（“我的共享”） | `IDS_MY_SHARE`（764）、`IDS_SHARE_TIPS`（709 “打开我的共享”） | 可拖拽文件到列表直接共享（`IDS_SHARE_LIST_EMPTY_TIPS1` 737） |
| 共享文件 / 共享文件夹 / 取消共享 | `FileShareDialog.xml`（1002/1003/1004） | `IDS_SHARE_FILE`（713）、`IDS_SHARE_FOLDER`（714）、`IDS_CANCEL_SHARE`（712） | 支持空文件/同名/重复校验（726-729、775） |
| 共享密码 | `VerifyPasswordDialog.xml`、`ShareFileListItem.xml` | `IDS_SHARE_PASSWORD`（768）、`IDS_SET_PASSWORD`（717）、`IDS_MODIFY_PASSWORD`（718）、`IDS_CANCEL_PASSWORD`（715）、`IDS_PLEASE_INPUT_PASSWORD`（766）、`IDS_COPY_PASSWORD_FORMAT`（747） | 每项可单独设密码；密码可复制；**不允许批量下载带密码项**（776） |
| 共享目录浏览 | `FileShareDialog.xml`（`PathToolBar` 151） | `IDS_SHARE_PATH_ROOT`（762 “所有文件”）、`IDS_SHARE_FIND_TIPS`（719 “当前页文件搜索”）、`IDS_LOADING`（763） | 有面包屑/路径栏 → **目录是逐层拉取的** |
| 共享列表列定义 | `ShareFileListItem.xml` | `IDS_SHARE_FILE_NAME`（720）、`SIZE`（721）、`TIME`（722）、`PASSWORD`（723）、`DOWNLOAD_COUNT`（724）、`PATH_VALID`（725） | 有“路径是否有效”列 → 服务端只记路径，被移走即失效 |
| 下载共享内容 | `ShareDownloadDialog.xml`、`ShareDownloadItem.xml` | `IDS_DOWNLOAD`（711）、`IDS_WAITING_DOWNLOAD`（751）、`IDS_SHARE_DOWNLOAD_ING_SPEED_FORMAT`（752）、`IDS_SHARE_DOWNLOAD_SUSPEND_SPEED_FORMAT`（754）、`IDS_SHARE_DOWNLOAD_BREAK`（761） | 支持暂停/继续/取消、断点（`IDS_SHARE_DOWNLOAD_SUSPEND_SPEED_FORMAT2` 755） |
| 共享下载历史 | `ShareDownloadDialog.xml`、`ShareHistory.png` | `IDS_CLEAR_HISTORY`（736）、`IDS_SHARE_DOWNLOAD_HISTORY_EMPTY_TIPS`（750） | 本地历史列表 |
| 错误态枚举 | `ShareDownloadItem.xml` | `IDS_SHARE_DOWNLOAD_CONN_FAILED`（756）、`IDS_SHARE_DOWNLOAD_TOO_MANY_FILE`（757）、`IDS_SHARE_DOWNLOAD_ZERO_SIZE`（759）、`IDS_SHARE_DOWNLOAD_PATH_NOT_FOUND`（760）、`IDS_ERROR_SHARE_CANCEL`（771）、`IDS_ERROR_UNKNOWN`（772） | 状态机相当完整 |
| 对端不可用提示 | `FileShareDialog.xml` | `IDS_SHARE_LIST_EMPTY_TIPS2`（738 离线）、`TIPS3`（739 版本低）、`TIPS4`（740 没共享）、`TIPS7`（743 超时） | “获取文件列表超时”——有独立超时，说明是 RPC 式请求 |
| 兼容性 | `string.xml` 591-593 | `IDS_IPMSG_FILE_SHARE_MY_TIPS`（591） | 共享柜**不支持**飞鸽/飞秋 |

---

## 9. 离线消息与离线文件

| 功能名 | 相关 layout | 关键 UI 字符串 | 备注 |
|---|---|---|---|
| 离线总说明 | 会话提示 | `IDS_OFFLINE_SUPPORT_TIPS`（297） | **“支持发送离线消息和离线文件/文件夹，但只有你在线的时候，对方才能收到您的信息”**——这条把“离线”的定义限定在发送方在线期间 |
| 离线发送入口 | `FileTransItem.xml`（307）、`ChatTipsItem.xml` | `IDS_OFFLINE_SEND`（448）、`IDS_OFFLINE_SEND_FILE_TIPS`（798）、`IDS_OFFLINE_SEND_FOLDER_TIPS`（799） | 传输项上单独一个“离线发送”超链接，说明与在线发送是两条路径 |
| 离线接收回执 | 会话系统消息 | `IDS_FEMIND_FILE_FORMAT`（1023）、`IDS_FEMIND_FOLDER_FORMAT`（1022） | **“对方已成功接收了您发送的离线文件”**——发送方稍后才收到确认，符合“发送方在线时投递、对端上线后拉取/回执”的模型 |
| 离线文件不存在 | 提示 | `IDS_OFFLINE_FILE_NOT_EXIST_FORMAT`（640）、`IDS_OFFLINE_FOLDER_NOT_EXIST_FORMAT`（641） | 离线文件仍指向原始本地路径 → 没有服务端暂存 |
| 离线文件接收前置条件 | 提示 | `IDS_ACCEPT_OFFLINE_FILE_SENDER_NOT_ONLINE`（973 “对方不在线，不能接收离线文件”） | **接收方要拿离线文件，发送方必须在线**——这基本排除了“中心服务器暂存” |
| 老版本降级 | 提示 | `IDS_OFFLINE_FILE_NOT_SUPPORT_TIPS`（479） | 需要版本能力位 |
| 离线传输去重 | 提示 | `IDS_OFFLINE_FILE_TRANSING_TIPS`（974） | 同任务只允许一个 |

---

## 10. 远程协助

| 功能名 | 相关 layout | 关键 UI 字符串 | 备注 |
|---|---|---|---|
| 发起远程控制 | 菜单 `RemoteHelpMenu.xml`（11171） | `IDS_REMOTE_HELP_TIPS`（684）、`IDS_REMOTE_REQUEST`（681）、`IDS_REMOTE_REQUEST_TIPS_FORMAT`（685） | 单聊头部 `RemoteHelp32.png` 按钮进入 |
| 邀请对方协助我 | `RemoteHelpMenu.xml`（11172） | `IDS_REMOTE_INVITE`（682）、`IDS_REMOTE_INVITE_TIPS_FORMAT`（686） | 方向相反的第二种模式 |
| 密码控制 | `RemoteHelpMenu.xml`（11174）、`OptionDialog.xml`（3501） | `IDS_REMOTE_PASSWORD_REQUEST`（703）、`IDS_REMOTE_PASSWORD`（705） | **远程密码**存在设置页，说明可预设免确认 |
| 自动接受 | `RemoteHelpMenu.xml`（11173） | `IDS_REMOTE_AUTO_ACCEPT`（683） | 对被控端是高风险开关 |
| 请求/接受/拒绝/断开 UI | `RemoteHelpLayout.xml` | `IDS_ACCEPT`（678）、`IDS_REFUSE`（679）、`IDS_BREAK`（680）、`IDS_REMOTE_REQUEST_SELECT_TIPS_FORMAT`（687）、`IDS_REMOTE_INVITE_SELECT_TIPS_FORMAT`（688） | 三种状态裁屏：等待、待确认、已连 |
| 远程窗口与工具条 | `RemoteHelpDialog.xml`、`RemoteToolbarDialog.xml` | `IDS_REMOTE_CAPTION_FORMAT`（774）、`IDS_FULL_SCREEN_TIPS`（372）、`IDS_TOP_MOST_TIPS`（368） | 工具条：全屏、置顶、结束 |
| 连接中/已连提示 | 会话 | `IDS_REMOTE_CONNECTING_TIPS_FORMAT`（689）、`IDS_REMOTE_SERVER_CONNECTED_FORAMT`（690）、`IDS_REMOTE_CLIENT_CONNECTED_FORAMT`（691） | 双向文案 |
| 互斥与限制 | 会话 | `IDS_REMOTE_ING_TIPS`（701）、`IDS_REMOTE_FRIEND_REMOTE_ING_TIPS`（698）、`IDS_REMOTE_LOCKED_TIPS`（697）、`IDS_REMOTE_OFFLINE_TIPS`（700）、`IDS_REMOTE_NOT_SUPPORT_TIPS`（702） | **锁屏时不能接受远程**，但可收消息 |
| 兼容性 | `string.xml` 588-590 | `IDS_IPMSG_REMOTE_HELP_MY_TIPS`（588） | 远程协助**不支持**飞鸽/飞秋 |

---

## 11. 截屏

| 功能名 | 相关 layout | 关键 UI 字符串 | 备注 |
|---|---|---|---|
| 截图入口 | `UserChatLayout.xml`（2104 `PrintScreenButton.xml`）、`BatchSendDialog.xml`（2104）、热键 | `IDS_PRINT_SCREEN_TIPS`（343）、`IDS_HOTKEY_PRINT_SCREEN`（157） | 单聊、群发、全局热键三处入口 |
| 截图工具条 | `PrintScreenToolbar.xml` | `IDS_PRINT_SCREEN_RECT_TIPS`（344）、`ARROW`（345）、`PEN`（346）、`UNDO`（347）、`SAVE`（348）、`CANCEL`（349）、`FINISH`（350） | 矩形、箭头、画笔、撤销；画笔三档粗细 + 六种颜色 |
| 坐标/尺寸/取色信息 | `PrintScreenInfo.xml`、`PrintScreenPreview.xml` | `IDS_PRINT_INFO_COLOR_FORMAT`（353）、`IDS_PRINT_INFO_RECT_FORMAT`（354） | 实时显示 RGB 与选区大小 |
| 截图后行为 | 会话 | `IDS_PRINT_SCREEN_HIDE_DLG_TIPS`（351 “截图并隐藏对话窗口”）、`IDS_PRINT_SCREEN_FILE_NAME_FORMAT`（352） | 默认文件名“内网通截图<时间>” |
| 兼容性 | `string.xml` 600-602 | `IDS_IPMSG_PRINT_SCREEN_MY_TIPS`（600） | 截图**不支持**飞鸽/飞秋 |

> 注意：`PrintScreenToolbar.xml` 引用了 `IDS_CAPTURE_IMAGE_FINISH_TIPS`，`image/` 里同时有 `CaptureImage*` 与 `PrintScreen*` 两套图——说明旧版叫 CaptureImage，本版本已改为 PrintScreen，但字符串表没跟上（见 §24）。

---

## 12. 表情管理

| 功能名 | 相关 layout | 关键 UI 字符串 | 备注 |
|---|---|---|---|
| 表情面板 | `EmotionDialog.xml`（`EmotionTabCtrl`） | `IDS_EMOTION_TIPS`（339）、`IDS_IMPORT_EXPORT_EMOTION`（825）、`IDS_PRIVIEW_EMOTION`（820） | 分组 Tab + 网格；底部左右翻页箭头 |
| 添加自定义表情 | `EmotionGroupSelectDialog.xml`、`EmotionItemMenu.xml` | `IDS_ADD_EMOTION`（826）、`IDS_ADD_EMOTION_CAPTION`（840）、`IDS_ADD_EMOTION_TIPS`（340）、`IDS_ADD_EMOTION_SUCCESS_FORMAT`（849） | 支持 jpg/jpeg/bmp/gif/png（837） |
| 分组管理 | `EmotionGroupUpdateDialog.xml`、`EmotionGroupMenu.xml` | `IDS_ADD_GROUP`（831）、`IDS_RENAME_GROUP`（834）、`IDS_DELETE_GROUP`（833）、`IDS_MOVE_LEFT_GROUP`（835）、`IDS_MOVE_RIGHT_GROUP`（836） | 分组可排序 |
| 内置分组 | 同上 | `IDS_EMOTION_GROUP_ORIGINAL`（838 “原创”）、`IDS_EMOTION_GROUP_COLLECTION`（839 “我的收藏”） | 两个固定分组 |
| 导入/导出表情包 | `EmotionImportExportMenu.xml`、`EmotionImportDialog.xml`、`EmotionExportDialog.xml` | `IDS_IMPORT_EMOTION_PACKAGE`（827）、`IDS_EXPORT_EMOTION_GROUP`（828）、`IDS_EXPORT_EMOTION_ALL`（829）、`IDS_EMOTION_EXPORT_SUCCESS`（858） | 有“表情包”概念 → 可离线分发给同事 |
| 移动表情到分组 | `EmotionItemMenu.xml`（3002） | `IDS_MOVE_EMOTION`（845） | 本地 |
| 从聊天图片直接加入表情 | `ImageMenu.xml`、`MsgItemMenu.xml` | `IDS_ADDTO_EMOTION`（182） | 图片 → 表情的高频路径 |

---

## 13. 历史记录管理器（消息 / 文件 / 图片 + 搜索 + 导出）

| 功能名 | 相关 layout | 关键 UI 字符串 | 备注 |
|---|---|---|---|
| 消息管理器 | `ChatRecordDialog.xml`、`ChatRecordLayout.xml` | `IDS_MESSAGE`（38）、`IDS_CHAT_RECORD`（249）、`IDS_SINGLE_CHAT_RECORD_FORMAT`（209）、`IDS_QGROUP_CHAT_RECORD_FORMAT`（210） | 三个 Tab：最近 / 联系人 / 群 |
| 文件管理器 | `FileRecordDialog.xml`、`FileRecordItem.xml` | `IDS_FILE_RECORD`（954）、`IDS_FILE_RECORD_FORMAT`（213）、`IDS_RECEIVED_FILE`（370）、`IDS_SENDED_FILE`（371） | 收到的 / 发出的两栏 |
| 图片管理器 | `ImageRecordDialog.xml`、`ChatImageLayout.xml` | `IDS_IMAGE_RECORD`（955）、`IDS_SINGLE_IMAGE_RECORD_FORMAT`（211）、`IDS_QGROUP_IMAGE_RECORD_FORMAT`（212） | 按会话聚合 |
| 全文搜索 + 时间范围 | `ChatMessageLayout.xml`（搜索条 5165/5170）、`SearchResult*.xml` | `IDS_SEARCH_RANGE`（978）、`IDS_SEARCH_CONTENT`（979）、`IDS_LAST_ONE_MONTH`（980）、`IDS_LAST_THREE_MONTH`（981）、`IDS_LAST_ONE_YEAR`（982）、`IDS_SEARCH_RESULT_FORMAT`（986） | **本地 SQLite 搜索**，有“最近一月/三月/一年/全部” |
| 全局搜索下拉 | `SearchResultPopupBar.xml`、`SearchResultItem.xml`、`SearchResultUserItem.xml`、`SearchResultGroupItem.xml`、`SearchResultQGroupItem.xml` | `IDS_SEARCH_FRIEND`（813）、`IDS_SEARCH_GROUP`（814）、`IDS_SEARCH_FEIGE`（815）、`IDS_SEARCH_QGROUP`（816）、`IDS_YOU_WANT_SEARCH`（817） | 搜索范围：好友 / 部门 / 飞鸽飞秋 / 群组 |
| 导出聊天记录 | `ChatRecordLayout.xml`（5129/5130） | `IDS_OPEN_EXPORT_BAR_TIPS`（976）、`IDS_EXPORT_SUCCESS`（997）、`IDS_EXPORTING_FORMAT`（989） | 可导出记录与文件传输记录（977） |
| 分页浏览 | `ChatMessageLayout.xml`（5121-5128） | `IDS_FIRST_PAGE`（256）、`IDS_LAST_PAGE`（257）、`IDS_DELETE_PAGE`（250）、`IDS_DELETE_ALL`（251） | 记录分页是产品设计的一部分（历史库可能很大） |
| 记录删除策略 | 同上 | `IDS_DELETE_FILE_TRANS_RECORD_CONFIRM`（254）、`IDS_DELETE_FILE_CONFIRM`（255 “同时删除关联文件”） | 有“删记录顺带删文件”选项 |
| 记录加密 | 文案 | `IDS_SINGLE_CHAT_RECORD_SAFE_TIPS`（298）、`IDS_QGROUP_CHAT_RECORD_SAFE_TIPS`（300） | 明示记录 **AES 加密**保存在本地 |

---

## 14. 邮件感知

| 功能名 | 相关 layout | 关键 UI 字符串 | 备注 |
|---|---|---|---|
| 邮件图标（主面板入口） | `MainDialog.xml`（204） | `IDS_OPTION_MAIL`（44）、`IDS_MAIL_PERCEPTION_TIPS`（45） | 主面板头部一个邮件按钮，显示未读数 |
| 邮件服务器配置 | `MailDialog.xml` | `IDS_MAIL_PERCEPTION_CONFIG`（46）、`IDS_MAIL_PROTOCOL`（123）、`IDS_MAIL_POP3`（124）、`IDS_MAIL_IMAP`（125） | POP3 / IMAP |
| 连接参数 | 同上 | `IDS_MAIL_HOST`（127）、`IDS_MAIL_PORT`（128）、`IDS_MAIL_USERNAME`（129）、`IDS_MAIL_PASSWORD`（130）、`IDS_MAIL_SSL`（132）、`IDS_MAIL_SPA`（133） | 含 SSL 与 NTLM SPA |
| 轮询间隔 + 连通性测试 | 同上 | `IDS_MAIL_INTERVAL`（131）、`IDS_MAIL_TEST`（126）、`IDS_MAIL_TEST_SUCCESS`（138）、`IDS_MAIL_TEST_FAIL`（139） | 定时拉取而非推送 |
| 邮件数变化通知 | `OptionDialog.xml`（4006）、`NotifyDialog.xml` | `IDS_MAIL_PERCEPTION`（47）、`IDS_NOTIFY_MAIL_NUMBER_CHANGE`（119）、`IDS_NOTIFY_EMAIL_FORMAT`（61 “您有 %d 封邮件”） | 本地通知 |
| 点击邮件按钮的行为 | `OptionDialog.xml`（7301-7304） | `IDS_OPEN_MAIL_DEFAULT_CLIENT`（49）、`IDS_OPEN_MAIL_WEB_PAGE`（50）、`IDS_OPEN_EMAIL_TIPS_FORMAT`（52） | 打开本地客户端或网页邮箱 |

> 邮件感知是**唯一明确走外网**的“通信”功能，与私有协议无关。

---

## 15. 积分 / VIP 装扮 / 商城 / 广告 / 捐赠

| 功能名 | 相关 layout | 关键 UI 字符串 | 备注 |
|---|---|---|---|
| 我的积分面板 | `ScoreDialog.xml` | `IDS_MY_SCORE`（880）、`IDS_SCORE_FORAMT`（882）、`IDS_ONLINE_TIME_FORMAT`（883）、`IDS_USER_ID_FORMAT`（886）、`IDS_COPY_USER_ID_SUCCESS`（913） | 显示用户 ID（32 位十六进制？见 §24）与在线时长 |
| 积分规则 | 同上 | `IDS_HOW_GET_SCORE_TIPS1/2/3`（890-892） | 在线 1 小时 = 1 分；签到；抽奖；积分码 |
| 签到 | 同上 | `IDS_SIGNIN`（898）、`IDS_SIGNIN_NOW`（899） | 本地/服务端待验证 |
| 试试手气（扫码抽积分） | `ScanCodeDialog.xml`、`AddScoreDialog.xml` | `IDS_SCAN_CODE`（902）、`IDS_SCAN_CODE_TIPS1`（903 “扫描二维码获得四位验证码”）、`IDS_SCAN_CODE_TIPS2`（904）、`IDS_GOOD_LUCK_FORMAT`（914）、`IDS_BAD_LUCK`（915） | **扫码 → 输 4 位验证码 → 加分**，必须访问外网服务校验 |
| 积分码购买 | `BuyCodeDialog.xml` | `IDS_BUY_SHIYELINE_CODE`（907）、`IDS_BUY_CODE_TIPS1/2/3`（894-896）、`IDS_BUY_CODE_TIPS4`（897 “1万积分1元，20元起售”）、`IDS_SCORE_CODE_INVALID`（919） | 微信扫码加客服，人工发码 |
| 免广告 | `BuyRemoveAdvCodeDialog.xml`、`ScoreDialog.xml`、`PersonalInfoLayout.xml`、`QGroupMemberLayout.xml` | `IDS_OPEN_REMOVE_ADVERTISEMENT`（1052）、`IDS_CLOSE_ADVERTISEMENT`（1048）、`IDS_NO_ADV_FORMAT`（884）、`IDS_REMOVE_ADVERTISEMENT_CODE_PRICE1/2`（1054/1055） | 广告位在个人信息面板 / 群成员面板底部 |
| 红名昵称 | `RedNameDialog.xml` | `IDS_RED_NAME`（910）、`IDS_RED_NAME_TIPS1/2`（922/923）、`IDS_DECORATE_OPENED_FORMAT`（960） | 50000 积分 / 200 小时 |
| 姓名加冠 | `CrownNameDialog.xml` | `IDS_CROWN_NAME`（911）、`IDS_CROWN_CU_TIPS`（937）、`SILVER`（938）、`GOLD`（939）、`IDS_CROWN_NAME_TIPS1/2/3`（927-929） | 铜/银/金三档，5万/10万/20万积分 |
| 排名优先 | `UpNameDialog.xml` | `IDS_UP_NAME`（912）、`IDS_UP_NAME_TIPS1/2`（924/925） | 在分组里排到最前 |
| VIP 按钮组件 | `VipButton.xml`、`VipOpen.png` | `IDS_OPEN_NOW`（934）、`IDS_OPENED`（935）、`IDS_SCORE_TOO_LITTLE`（936） | 三张卡片共用组件 |
| 商城 | `MallDialog.xml` | `IDS_RORUM`（532）、`IDS_MALL_CAPTION`（533 “使用微信扫描二维码进入商城”） | 纯本地图片（Mall1.jpg / Mall2.jpg），内容在外网 |
| 资讯 / 弹窗广告 | `NewAdvDialog.xml`、`PopAdvDialog.xml` | `IDS_NEW_ADVERTISEMENT`（1049）、`IDS_NEW_ADVERTISEMENT_FORMAT`（1050 “%d天内不再显示”）、`IDS_ADVERTISEMENT`（949 “广告位招租”） | `PopAdvDialog` 用 `SkinWebView` → **内嵌浏览器（CEF）**，`IDS_CEF_BROKEN`（1051）可证 |
| 捐赠 | `DonationDialog.xml` | `IDS_DONATION_TIPS`（1045）、`IDS_DONATION_TIPS1/2`（1046/1047）、`IDS_DONATE_NOW`（909） | 二维码图片，纯外网 |

> 装扮类（红名/加冠/排名优先）**必须让对端看见**，且要“在线 200 小时”计时——这意味着装饰状态要随身份广播，或由对端按名字串里的颜色指令渲染（见 §2 的 `IDS_USER_NAME_FORMAT`）。

---

## 16. 皮肤与外观

| 功能名 | 相关 layout | 关键 UI 字符串 | 备注 |
|---|---|---|---|
| 皮肤中心 | `layout/system/SkinManagerDialog.xml`、菜单 `SkinMenu.xml` | `IDS_CHANGE_SKIN`（4）、`IDS_SKIN_TIPS`（361） | 上排 12 套主题 + 下排 14 个配色 |
| 自定义皮肤 / 打包 / 更多 | `SkinManagerDialog.xml`、`system/SkinMakeToolbar.xml` | `IDS_DEFINE_SKIN`、`IDS_PACKAGE_SKIN`、`IDS_MORE_SKIN`、`IDS_MAKE_SKIN_TIPS1/2`（**均缺失于 string.xml，见 §24**） | 需消耗积分（`IDS_MORE_SKIN_TIPS2` 931 “每次 100 积分”） |
| 透明度 | `SkinManagerDialog.xml`（104/105） | `IDS_SET_FULL_TRANSPARENT_SKIN`、`IDS_SET_WINDOW_TRANSPARENT`（同样缺失于 string.xml） | 全透明皮肤 + 窗口透明度两个滑杆 |
| Aero / 皮肤导出删除 | 菜单 `SkinMenu.xml` | `IDS_EXPORT_SKIN`、`IDS_DELETE_SKIN`、`IDS_OPEN_AREO`（缺失） | 资源里已有入口，字符串缺失 |
| 头像显示尺寸 | 菜单 | `IDS_HEAD_SHOW`（803） | 与皮肤无关，但同属外观设置 |

> 皮肤相关布局完整、图片完整，但 **16 个字符串 ID 在 string.xml 里查不到**，见 §24 版本漂移。

---

## 17. 锁屏 / 密码 / 快捷键

| 功能名 | 相关 layout | 关键 UI 字符串 | 备注 |
|---|---|---|---|
| 锁定内网通 | `LockScreenLayout.xml`（主面板/聊天窗口的 `LockScreenLayout` 层）、`MainMenuLocked.xml` | `IDS_LOCK_APP`（557）、`IDS_LOCK_APP2`（558）、`IDS_OPTION_LOCK`（559） | 锁屏是**覆盖层**，不是退出 |
| 解锁 | `LockScreenLayout.xml`（39305/39306） | `IDS_UNLOCK`（560）、`IDS_UNLOCK_PASSWORD`（561）、`IDS_UNLOCK_SCREEN_PASSWORD_ERROR`（570）、`IDS_LOCK_SCREEN_TIPS_FORMAT`（556） | **“锁定时不影响消息的接收”**——协议层继续收包，只有 UI 被拦 |
| 设置/修改密码 | `PasswordDialog.xml` | `IDS_SET_PASSWORD`（717）、`IDS_INPUT_PASSWORD_TIPS`（573）、`IDS_CONFIRM_PASSWORD_TIPS`（574）、`IDS_LOCK_SCREEN_PASSWORD_NOT_SAME`（568） | 两次输入校验 |
| 自动锁定（闲置） | `OptionDialog.xml`（6101-6105） | `IDS_IDLE_PROCESS`（93）、`IDS_IDLE_TIPS`（99）、`IDS_AUTO_LOCK_CONFIG`（563）、`IDS_LOCK_SCREEEN_TIPS`（565）、`IDS_LOCK_SCREEEN_TIPS2`（566 “重启电脑可以解开”） | 分钟数 + “切换为离开 / 锁定内网通”二选一 |
| 锁屏时的关闭/退出保护 | 确认框 | `IDS_CLOSE_LOCKED_PROMPT`（328）、`IDS_QUIT_LOCKED_PROMPT`（329） | 防止有人直接关掉进程绕过锁 |
| 全局热键（4 个） | `OptionDialog.xml`（5002-5105） | `IDS_HOTKEY_SHOW_HIDE_MAIN_WINDOW`（156）、`IDS_HOTKEY_PRINT_SCREEN`（157）、`IDS_HOTKEY_OPEN_RECVFOLDER`（158）、`IDS_LOCK_APP2`（558） | 冲突检测与一键改键（`IDS_REG_HOTKEY_FAIL_BEGIN` 163） |
| 锁屏与远程互斥 | 提示 | `IDS_REMOTE_LOCKED_TIPS`（697） | 锁定状态下拒绝远程协助 |

---

## 18. 网络、发现、诊断与防火墙

| 功能名 | 相关 layout | 关键 UI 字符串 | 备注 |
|---|---|---|---|
| 端口设置 | `NetworkDialog.xml`（3004） | `IDS_LAN_PORT`（142）、`IDS_PORT_ERROR_TIPS`（802）、`IDS_PORT_OCCUPIED_FORMAT`（450） | **“9012、9013 和 9014 为保留端口”**——默认端口 + 三个保留端口，直接对上私有通道与附属服务 |
| 组织号 | `NetworkDialog.xml`（3005） | `IDS_CORP_STRUCT_NUMBER`（143） | 见 §3；发现/消息的准入域 |
| 与飞鸽/飞秋互通 | `NetworkDialog.xml`（3102/3104） | `IDS_MSG_CONTECT`（146）、`IDS_OPEN_IPMSG_CONTECT`（148）、`IDS_IPMSG_PORT`（147） | 可单独关闭；关闭时提示会关掉所有兼容会话（331） |
| 网卡绑定 | `NetworkDialog.xml`（3202-3204） | `IDS_BIND_MAC_TIPS`（866）、`IDS_OPEN_BIND_MAC`（867）、`IDS_BIND_MAC`（868）、`IDS_ADAPTER_NOT_FIND`（870） | 影响广播出口网卡 |
| 自动刷新 | `OptionDialog.xml`（3302-3304） | `IDS_AUTO_REFRESH`（872）、`IDS_OPEN_AUTO_REFRESH`（874）、`IDS_AUTO_REFRESH_INTERVAL`（875）、`IDS_CLOSE_AUTO_REFRESH_CONFIRM`（876） | 周期重新通告/扫描 |
| 刷新提示浮层 | `TipsRefreshing.xml` | `IDS_REFRESH_ING`（35）、`IDS_REFRESH`（34） | 托盘浮层 |
| Ping 诊断 | `PingDialog.xml` | `IDS_PING_TIPS`（665）、`IDS_PINGING`（666）、`IDS_PING_SUCCESS`（667）、`IDS_PING_FAIL`（668）、`IDS_CONFIG_NET`（669 “手动调整网络结构”） | 输 IP 直接探测 |
| 防火墙一键关闭 | `FirewallDialog.xml` | `IDS_FIREWALL_CLOSING`（660）、`IDS_CLOSE_FIREWALL_SUCCESS`（661）、`IDS_CLOSE_FIREWALL_FAIL`（662） | 纯本地系统操作 |
| 身份 ID 冲突 | `IDRepeatDialog.xml` | `IDS_ID_REPEAT_TIPS`（1020） | **账号是首次运行时在公共目录生成并写入本机**（Ghost 装机会撞号）；长文案给出删除 `c:\users\public\Nwt` 的修复步骤 → 身份是本地文件里的 32 位标识 |
| 隐藏 IP | `OptionDialog.xml`（2005） | `IDS_HIDE_IP`（98） | 影响通告字段 |
| 网段分享接收确认 | 通知 | `IDS_SHARE_SUBNET_CONFIRM_FORMAT`（877） | 见 §3 |
| 启动/托盘 | `OptionDialog.xml`（2002-2005） | `IDS_STARTUP_CONFIG`（94）、`IDS_AUTO_RUN`（95）、`IDS_AUTO_RUN_MIN`（96）、`IDS_CLOSE_DLG`（104）、`IDS_QUIT_APP`（105）、`IDS_TO_TRAY`（106） | 本地行为 |

---

## 19. 通知与提示音

| 功能名 | 相关 layout | 关键 UI 字符串 | 备注 |
|---|---|---|---|
| 通知窗口（多种形态） | `NotifyDialog.xml` | `IDS_NOTIFY`（62）、`IDS_NOTIFY_ONLINE`（262）、`IDS_NOTIFY_OFFLINE`（263）、`IDS_NOTIFY_RECV_MSG`（264）、`IDS_NOTIFY_RECV_FILE`（265）、`IDS_NOTIFY_RECV_FOLDER`（266） | 一个对话框按 Mode 切换：上线/下线/消息/文件/远程/邮件 |
| 文件通知内联操作 | `NotifyDialog.xml`（301/302/303/305） | `IDS_RECV`（284）、`IDS_RECV_SAVE_AS`（285）、`IDS_RECV_REFUSE`（286）、`IDS_RECV_CONTINUE`（287） | 通知里可直接接收/拒收/续传 |
| 远程通知 | 同上（Mode 4） | `IDS_NOTIFY_RECV_REMOTE_REQUEST`（692）、`IDS_NOTIFY_RECV_REMOTE_INVITE`（693） | 可直接接受/拒绝 |
| 传输结果通知 | 同上 | `IDS_NOTIFY_SEND_FILE_SUCCESS`（267）、`FAILD`（268）、`RECV_FILE_SUCCESS`（269）、`RECV_FILE_FAILD`（270） | 成功/失败都有 |
| 网段分享通知 | 同上 | `IDS_NOTIFY_SYNC_SUBNET`（271） | 见 §3 |
| 通知开关 | `OptionDialog.xml`（4002-4006） | `IDS_NOTIFY_MYSELF_ONLINE`（115）、`IDS_NOTIFY_ONLINE_OFFLINE`（116）、`IDS_NOTIFY_RECEIVE_MSG_FILE`（117）、`IDS_NOTIFY_FINISH_FILE_TRANS`（118） | 五类开关 |
| 声音 | `OptionDialog.xml`（4102-4104） | `IDS_NOTIFY_SOUND`（120）、`IDS_NOTIFY_CLOSE_ALL_SOUND`（121）、`IDS_NOTIFY_QGROUP_SOUND`（122）、`IDS_OPEN_SOUND_FOLDER`（140） | 群消息可单独开声音；声音目录可换 |
| 任务栏/窗口提示 | `OptionDialog.xml`（2202/2203） | `IDS_AUTO_POPUP`（108）、`IDS_FLASH_WINDOW`（109） | 弹出 vs 闪烁 |
| 托盘气泡 | `TipsWindow.xml`、`TrayIcon`（图片 `offline.png`） | `IDS_NOTIFY_FEEDBACK`（274） | 反馈回复也走通知 |

---

## 20. 系统设置总览（六个页面）

`OptionDialog.xml` 是设置的唯一入口，左侧六个 `OptionButton`；每个 ListItem 就是一个页面。这张表可作为“功能是否存在”的权威索引：

| 页 | 关键项 | 字符串 |
|---|---|---|
| 常规设置（200） | 开机自启 / 最小化启动 / 局域网更新 / 隐藏 IP / 不接振屏 / 不接网段分享 / 不给飞鸽飞秋发推荐 / 自动分组 / 飞秋分组 / 收消息行为 / 关窗行为 / 好友信息显示 / 文件传输 | `IDS_OPTION_NOMAL`（41）、`IDS_LAN_UPDATE`（97）、`IDS_NOT_ACCEPT_SHAKE_WINDOW`（961）、`IDS_NOT_SEND_ADVERTISEMENT`（965） |
| 网络设置（300） | 打开 `NetworkDialog`、网段设置、网段黑名单、远程密码、自动刷新 | `IDS_OPTION_NET`（63）、`IDS_SUBNET_CONFIG`（957）、`IDS_SUBNET_BLACK_NAME`（1027）、`IDS_REMOTE_PASSWORD`（705） |
| 通知设置（400） | 五类通知 + 声音 + 声音目录 + 群消息声音 | `IDS_OPTION_NOTIFY`（42）、`IDS_NOTIFY_WHAT`（114） |
| 热键设置（500） | 四个全局热键 + 冲突标记 | `IDS_OPTION_HOT_KEY`（43） |
| 内网通锁（600） | 设密码、闲置分钟数、闲置动作 | `IDS_OPTION_LOCK`（559） |
| 邮件设置（700） | 邮件感知配置入口、点击邮件按钮行为 | `IDS_OPTION_MAIL`（44）、`IDS_CLICKED_MAIL_BUTTON`（48） |

---

## 21. 应用中心（存在但默认隐藏）

| 功能名 | 相关 layout | 关键 UI 字符串 | 备注 |
|---|---|---|---|
| 应用中心面板 | `MainDialog.xml`（205/206，均 `Visible="false"`） | `IDS_APP_BOX`（953）、`IDS_ADD_APP`（998）、`IDS_MORE_APP`（1000） | 主面板头部两个按钮被隐藏，`IDS_APP_BOX` 在布局中从未引用 |
| 添加/修改应用 | `AddAppDialog.xml`、`AppNameTips.xml`、`AppValueTips.xml` | `IDS_MODIFY_APP`（999）、`IDS_APP_NAME2`（1005）、`IDS_APP_VALUE`（1006）、`IDS_APP_VALUE_TIPS`（1011） | 值是网址**或本地可执行文件路径** |
| 应用管理器 | `AppManagerDialog.xml`、`AppListItem.xml` | `IDS_APP_MANAGER`（1001）、`IDS_MOVE_UP`（1002）、`IDS_MOVE_DOWN`（1003） | 可排序 |
| 校验 | 同上 | `IDS_APP_VALUE_UNVALID`（1009）、`IDS_APP_NAME_EMPTY`（1007） | — |

> 这是本版本一个“半下线”的功能：布局、字符串、校验文案齐全，但入口被 `Visible="false"` 隐藏。**如果不看 XML 的 Visible 属性，很容易在清单里把它算成可用功能。**

---

## 22. 更新与数据升级

| 功能名 | 相关 layout | 关键 UI 字符串 | 备注 |
|---|---|---|---|
| 检查更新（在线） | `UpdateDialog.xml`、`MainMenu.xml`（1015） | `IDS_ONLINE_UPDATE`（547）、`IDS_UPDATE_CHECKING`（549）、`IDS_NEW_VERSION_FORMAT`（551）、`IDS_UPDATE_ALREADY_LATEST`（552） | 走官网 |
| 下载与安装 | 同上 | `IDS_DOWNLOAD_PROGRESS_FORMAT`（548）、`IDS_UPDATE_DOWNLOAD_FINISH`（553）、`IDS_INSTALL`（544）、`IDS_UPDATE_ERROR`（554） | — |
| 局域网更新 | `OptionDialog.xml`（2004） | `IDS_LAN_UPDATE`（97）、`IDS_UPDATE_REMIND_TIPS5`（674 “无法连接外网的用户，拷贝最新版安装包”） | **局域网内分发安装包**，无外网也能升级 → 存在一条内网更新通道（`待验证`） |
| 数据升级（旧记录导入） | `UpgradeRecordDialog.xml` | `IDS_UPGRADE_RECORD`（968）、`IDS_UPGRADE_RECORD_ING`（969 “五到十分钟”）、`IDS_UPGRADE_RECORD_FAIL`（970） | 旧版聊天库迁移，纯本地 |
| 版本提醒 | 文案 | `IDS_UPDATE_REMIND_TIPS1`~`7`（670-676） | 官网 `www.51nwt.com` |

---

## 23. 帮助、反馈、社交分享、关于

| 功能名 | 相关 layout | 关键 UI 字符串 | 备注 |
|---|---|---|---|
| 帮助 | `HelperDialog.xml`（`SkinHelperWebView`） | `IDS_HELPER`（659）、`IDS_HELP_TIPS`（658） | 内嵌网页，内容在外网 |
| 反馈建议 | `FeedbackDialog.xml` | `IDS_FEEDBACK_TIPS`（362）、`IDS_FEEDBACK_TIPS1/2`（536/537）、`IDS_FEEDBACK_QQGROUP`（539） | 二维码 + QQ 群号 + 论坛 |
| 论坛中心 | 图片 `ForumCenter.png`、字符串 | `IDS_FEEDBACK_RORUM`（540） | 外链 |
| 分享给朋友（社交通道） | 菜单 `ShareMenu.xml` | `IDS_WEB_SHARE_QQ`（789）、`QZONE`（790）、`WEIBO`（791）、`TENGXUN`（792）、`WEIXIN`（793）、`IDS_WEB_SHARE_TITEL`（800） | 宣传文案带官网水印（`IDS_SHARE_WATER_MASK` 801） |
| 关于 | `AboutDialog.xml` | `IDS_ABOUT_LAN`（5）、`IDS_ABOUT`（9）、`IDS_VERSON`（10）、`IDS_COPYRIGHT_EN`（13）、`IDS_COPYRIGHT_CN`（14） | 官网链接按钮 |
| 新手引导 | `GuideDialog.xml` | 见 §1 | — |

---

## 24. 功能 → 疑似协议通道

先给三条**总判据**，后面表格直接引用：

- **判据 A（资源自证）**：`string.xml` 575-602 一段“与飞鸽/飞秋不支持”的文案，逐条点名了：振屏、表情、字体、图片、文件夹、远程协助、文件共享、群组、密聊、截图。这些功能既然在标准 IPMSG 上不存在，就**必然由私有通道承载**。
- **判据 B（端口自证）**：`IDS_PORT_ERROR_TIPS`（802）说 9012/9013/9014 是保留端口；`docs/nwt-private-protocol.md` 已实测 **9011 = UDP 发现 / 9012 = ENet**，因此 9013、9014 极可能是文件/共享柜/远程用的附属服务端口。
- **判据 C（命名自证）**：布局类名前缀直接对应模块：`QGroup*` = 群、`FileShare*`/`ShareDownload*` = 共享文件柜、`Recv*/SendFile*` = 文件通道、`Remote*` = 远程、`PrintScreen*` = 截图。

| 功能 | 疑似通道 | 依据 / 线索 |
|---|---|---|
| 成员发现、在线状态、上线/下线 | **私有 9011 UDP 通告 + 9012 ENet 会话** | 判据 B；`IDS_ONLINE_NUM_FORMAT`（24）、`IDS_NOTIFY_ONLINE/OFFLINE`（262/263）需要有状态通道；`IDS_AUTO_REFRESH_INTERVAL`（875）对应周期通告 |
| 文字消息、字体、链接、文本内图片、表情 | **私有通道 XML（1004 X_SEND_MSG）** | 判据 A（字体/表情/图片不支持 IPMSG）；仓储文档实测 `dt[]` 节点含 `txt`/`lnk`/`img`/`file`，字体在 `ft` 字段 |
| emoji（Unicode 字符） | 待验证：随文字同一通道，纯编码问题 | 资源内只有图片表情，无 emoji 选择器；`CAPUTF8OPT` 相关结论需另证 |
| 已读回执 | **私有通道（1006 X_SEND_RECEIPT）** | `IDS_MSG_NEED_RECEIPT`（1035）逐条开关；仓储文档已实测 1006 与 `<MSG_ID>` |
| 送达确认 / 发送失败 | **私有通道（1005 X_SEND_MSG_ACK）** | `IDS_CHATDLG_SEND_MSG_LOST_BEGIN`（235）；仓储文档实测 1005 |
| 正在输入 | **私有通道（1008 X_SEND_WRITTING）** | `IDS_CHATDLG_WRITING`（234）；仓储文档实测 1008，本客户端当前只记日志 |
| 密聊（不入库） | **私有通道，靠能力位协商** | `IDS_HIDE_RECORD_NOT_SUPPORT_TIPS`（478）说明需对端支持；仓储文档实测 `HIDE_RECORD=1` 能力位 |
| 振屏 | **私有通道，独立命令** | 判据 A（`IDS_IPMSG_FLASH_SCREEN_MY_TIPS` 575）；有频率限制（241）→ 客户端侧节流 |
| 撤回消息 / 撤回文件 | **私有通道，需对端配合删除** | 2 分钟窗口（1037）双方都要判断；`IDS_RETRIEVE_MESSAGE_FORMAT`（1033）群内要显示“谁撤回” |
| 群发标记 | **私有通道（单聊消息 + 前缀）** | `IDS_FROM_GROUP_SEND`（1044）；无独立群发协议迹象 |
| 群创建、邀请、踢人、解散、群资料 | **私有通道，群主为权威** | `IDS_QGROUP_INVITE_MASTER_OFFLINE_TIPS`（524）——群主不在线就无法加人，说明没有中心群服务；变更以系统消息广播（466-473） |
| 群消息 | **私有通道（多点单播或群播，待验证）** | 判据 A（594 群组不支持 IPMSG）；`IDS_QGROUP_REFUSE_MSG`（516）逐群拦截 |
| 群公告 | **私有通道，随群资料广播** | `IDS_QGROUP_UPDATE_NOTICE_FORMAT`（468）；公告字段在 `QGroupInfoDialog` 里限 150 字 |
| 群文件 / 群文件夹 | **文件通道 + 群上下文** | `IDS_FEMIND_QGROUP_FILE_FORMAT`（1025）需把“谁已收”回传群内 |
| 单文件 / 文件夹传输 | **私有文件通道（TCP，疑似 9013）** | 判据 A（585 文件夹不支持 IPMSG）；与 IPMSG 文件失败文案分开写（309/314）；续传（287）说明有偏移量协商 |
| 主动发送（对方免确认） | **私有文件通道，反向下推** | `IDS_ALLOW_ACTIVE_SEND`（435）、`IDS_ACTIVE_SEND_TIPS`（438） |
| 离线消息 | **无服务端：发送方本地队列 + 对端上线后补发** | `IDS_OFFLINE_SUPPORT_TIPS`（297）“只有你在线的时候对方才能收到”；仓储文档里消息帧带 `OFFLINE` 字段 |
| 离线文件 / 文件夹 | **同上传送模型：接收方拉取时发送方必须在线** | `IDS_ACCEPT_OFFLINE_FILE_SENDER_NOT_ONLINE`（973）+ `IDS_FEMIND_FILE_FORMAT`（1023 “对方已成功接收”）→ 明确是 P2P 补投，不是服务器暂存 |
| 共享文件柜（列目录 / 下载 / 密码） | **私有通道 RPC + 文件通道（疑似 9013/9014）** | `IDS_SHARE_LIST_EMPTY_TIPS7`（743 超时）→ 请求/应答；`IDS_SHARE_FILE_DOWNLOAD_COUNT`（724）→ 目录项带元数据；`IDS_SHARE_FILE_PATH_VALID`（725）→ 只发路径 |
| 共享密码校验 | **私有通道（在服务端即共享方本地校验）** | `IDS_PASSWORD_ERROR`（769）由共享方返回；`IDS_BATCH_DOWNLOAD_WITH_PASSWORD_TIPS`（776）说明批量下载被禁 |
| 远程协助 | **私有通道 + 独立屏幕流（疑似 9014）** | 判据 A（588）；`IDS_REMOTE_PASSWORD`（705）预设密码；`IDS_REMOTE_LOCKED_TIPS`（697）锁屏拒绝 |
| 截屏 | **本地截图 → 作为图片走私有通道** | 判据 A（600）；截屏本身是本地 GDI 能力 |
| 网段分享 | **私有通道，一条携带网段列表的消息** | `IDS_SHARE_SUBNET_CONFIRM_FORMAT`（877）、`IDS_NOTIFY_SYNC_SUBNET`（271） |
| 组织号准入 | **私有通道（发现报文内的域字段）** | `IDS_CORP_STRUCT_NUMBER_TIPS`（144）“不同不能发现、不能互发” |
| 隐藏 IP / 网卡绑定 / 网段黑名单 | **本地设置，影响通告与绑定** | `IDS_HIDE_IP`（98）、`IDS_BIND_MAC`（868）、`IDS_ONLY_CONTECT_UP_SUBNET`（1026） |
| 一键扫描加联系人 | **主动 UDP 探测（9011 单播）** | 快速/完全扫描按网段逐 IP 探测（618-621），不是被动等广播 |
| Ping 诊断 | **ICMP 或 UDP 探测（待验证）** | `IDS_PING_SUCCESS/FAIL`（667/668） |
| 与飞鸽/飞秋的文字、单文件 | **IPMSG 兼容层（2425 UDP/TCP）** | `IDS_OPEN_IPMSG_CONTECT`（148）、`IDS_IPMSG_PORT`（147） |
| 邮件感知 | **外网 POP3/IMAP** | `IDS_MAIL_POP3`（124）、`IDS_MAIL_IMAP`（125）、`IDS_MAIL_SSL`（132）、`IDS_MAIL_INTERVAL`（131） |
| 积分、积分码、免广告码、红名/加冠/排名 | **外网 HTTPS（服务端计费/校验）** | `IDS_VERIFY_CODE_INVALID`（921）、`IDS_SCORE_CODE_ADDED`（920）、`IDS_REMOVE_ADVERTISEMENT_CODE_PRICE1`（1054）；但**展示结果必须同步到内网对端** |
| 商城、资讯、弹窗广告、帮助、更新、论坛、分享 | **外网 HTTPS / 内嵌 CEF** | `PopAdvDialog.xml` 用 `SkinWebView`；`IDS_CEF_BROKEN`（1051）；`IDS_MALL_CAPTION`（533） |
| 局域网更新 | **内网 P2P（待验证）** | `IDS_LAN_UPDATE`（97）+ `IDS_UPDATE_REMIND_TIPS5`（674 拷贝安装包） |
| 聊天记录、文件记录、图片记录、搜索、导出 | **纯本地 SQLite（AES 加密）** | `IDS_SINGLE_CHAT_RECORD_SAFE_TIPS`（298） |
| 表情库、皮肤、锁屏、热键、存储路径、通知 | **纯本地** | 资源里全部是本地文件/设置项 |
| 账号身份（32 位 ID） | **本地生成，随通告/握手广播** | `IDS_ID_REPEAT_TIPS`（1020）描述公共目录里的本地账号文件；`IDS_USER_ID_FORMAT`（886） |

---

## 25. 意外发现与“坑”

按对逆向的价值排序：

1. **组织号是发现层的硬门槛**（`IDS_CORP_STRUCT_NUMBER_TIPS` 144）。同网段不同组织号互相看不见、也不能发消息，且可同时加 10 个（`#` 分隔）。任何“只靠 IP 就能连”的假设都要先验证组织号字段。
2. **“离线”不是服务器暂存**。文案（297）和“对方不在线不能接收离线文件”（973）互相印证：离线是**发送方本地队列 + 对端上线后由发送方在线补投**。这直接决定了我们做兼容时的语义——离线消息不能写给“服务器”，得写进本地队列并在对端出现时推送。
3. **群主是在线权威**（524）。加成员要群主在线批准 → 群没有中心服务，群状态靠群主广播/回放。群解散、踢人、改公告都走系统消息广播（466-473、504-507）。
4. **共享文件柜是 RPC 而非静态目录**：`获取文件列表超时`（743）、`路径`有效性列（725）、`下载次数`（724）、`共享密码`（768）说明共享方本机是个小型“服务端”，列表逐层拉取、路径只做引用。
5. **共享柜支持密码，但禁止批量下载带密码项**（776）——密码校验在共享方本地完成。
6. **远程协助有“预设密码”模式**（705 `IDS_REMOTE_PASSWORD`），并且锁屏时会拒绝（697），但锁屏**不影响收消息**（556）。锁屏是 UI 层锁，不是会话中断。
7. **局域网更新**（97）意味着内网里存在一条“分发安装包”的通道，与私有协议可能共用（待验证）。
8. **没有“扫码加好友”**。`ScanDialog` 是**扫描局域网 IP 段**加联系人（609-621），不是二维码；真正的二维码只出现在三种**外网**场景：商城（533）、积分抽奖（903）、购买积分码/免广告（894、1053）。别被文件名骗了。
9. **应用中心是隐藏功能**：`MainDialog.xml` 205/206 显式 `Visible="false"`，`IDS_APP_BOX` 从未被引用。功能完整但入口关闭。
10. **截图有两代命名**：`image/` 里 `CaptureImage*` 与 `PrintScreen*` 两套图并存，`PrintScreenToolbar.xml` 引用了不存在的 `IDS_CAPTURE_IMAGE_FINISH_TIPS` → 旧版叫 CaptureImage。
11. **消息安全文案是“声明”不是“机制”**：它承诺“不过外网服务器”“本地 AES 加密”，但没有任何字段说明加密方式；私有帧的 TEA 加密已被仓储文档证实，属于传输层而非存储层。
12. **广告位埋在两处非主面板**：个人资料面板底部（`PersonalInfoLayout` 5418/5419）与群成员面板底部（`QGroupMemberLayout`），且有“开通免广告”入口。广告是网页内容（CEF），不是协议消息。

---

## 26. 资源自相矛盾 / 版本漂移（重要提醒）

盘点中发现 **16 个被布局引用、但 string.xml 里不存在的字符串 ID**，说明安装目录里的 `ShiYeLine` 资源与主程序不完全同步（或这些串在别的表/代码里）：

```
IDS_SKIN_CENTER              IDS_DEFINE_SKIN            IDS_PACKAGE_SKIN
IDS_MORE_SKIN                IDS_EXPORT_SKIN            IDS_DELETE_SKIN
IDS_OPEN_AREO                IDS_MAKE_SKIN_TIPS1        IDS_MAKE_SKIN_TIPS2
IDS_SET_FULL_TRANSPARENT_SKIN  IDS_SET_WINDOW_TRANSPARENT
IDS_CAPTURE_IMAGE_FINISH_TIPS  IDS_TRY_LUCK
IDS_CONTROL_SHOW1  IDS_CONTROL_SHOW_TEXT8  IDS_CONTROL_SHOW_TEXT22
```

旁证：

- `IDS_VERSON`（10）的值是占位符 `XXX2.0`，版权年份写 `2009 - 2019`。
- 反馈 QQ 群号出现两个不同值：`187314062`（539）与 `368471092`（1020）。
- `StatusMenu.xml` 里残留被注释掉的 `2501 右下角弹窗 / 2502 弹出新闻页 / 2503 右下角闪烁`，说明“新闻/广告推送”曾经有独立入口。

**结论**：本清单覆盖的是“资源里能证明存在”的功能；是否在当前二进制里启用，个别项（尤其皮肤中心、试试手气、应用中心）需要动态验证。

---

## 27. 待验证清单

| # | 问题 | 建议验证方式 |
|---|---|---|
| 1 | 9013 / 9014 分别承载什么（文件？共享柜？远程？） | 只跑文件传输 / 只跑共享柜 / 只跑远程，观察各自监听端口 |
| 2 | 组织号在 9011 报文的哪个字段，是否同时影响 ENet 握手 | 改组织号前后对比 9011 通告字节 |
| 3 | 离线消息的真实投递时机（对端上线即推？还是对端请求才推？） | 让对方下线→我发离线消息→对方上线，抓我侧出站包 |
| 4 | 离线文件的拉取方向（谁发起 TCP/ENet） | 接收方点“接收”时抓双方 |
| 5 | 群消息是多播还是逐人单播 | 3 人群，抓发送方的出站目标地址数量 |
| 6 | 群主离线时群消息是否还能发 | 群主退出后发群消息 |
| 7 | 红名/加冠/排名优先如何被对端看见（握手字段？名字串？外网账号？） | 开通后对比我的通告/握手字节 |
| 8 | 共享柜列目录用哪个命令号、是否分页 | 打开对方共享目录，抓请求/应答 |
| 9 | 远程协助的画面流协议（自有编码？VNC 变体？） | 只连接不发画面，看首包 |
| 10 | 是否支持 Unicode emoji 文字（非图片表情） | 发 emoji 字符串，看对端渲染与报文字节 |
| 11 | 局域网更新的分发方式 | 断外网，用两台机器试在线更新 |
| 12 | `IDS_APP_BOX` 是否有隐藏开关可开启 | 检查配置项/注册表，或改 XML 试运行 |

---

## 附录 A：菜单命令 ID 区间（可作为模块划分线索）

| ID 区间 | 出现文件 | 推测模块 |
|---|---|---|
| 900-902 | `SkinMenu.xml` | 皮肤 |
| 1001-1005 / 2000-2003 / 3000-3002 | `Emotion*Menu.xml` | 表情分组、导入导出、单项操作 |
| 10001-10002 | `SendMsgMenu.xml` | 发送键行为 |
| 10111-10112 | `MainMenu.xml`、`MainMenuLocked.xml`、`StatusMenu.xml` | 锁定/解锁 |
| 1012-1018 | `MainMenu.xml`、`StatusMenu.xml` | 设置、积分、引导、更新、关于、帮助、退出 |
| 1101-1119 | `UserItemMenu.xml`、`UserMessageItemMenu.xml`、`GroupItemMenu.xml` | 联系人/会话操作（收发消息、发文件、备注、免打扰、清离线） |
| 11001-11017 | `EditMenu*.xml`、`MsgItemMenu.xml`、`OutputMenu*.xml`、`ImageMenu.xml` | 消息与文本编辑（含 11017 撤回） |
| 11171-11174 | `RemoteHelpMenu.xml` | **远程协助独占区间** |
| 1201-1206 | `GroupItemMenu.xml`、`QGroupItemMenu.xml`、`QGroupMessageItemMenu.xml` | 群发、建群、置顶、移出最近 |
| 1301-1308 | `QGroupItemMenu.xml` 等 | 群会话操作（打开、记录、备注、消息设置、邀请、解散） |
| 1401-1405 | `ShareMenu.xml` | **社交分享（外网）** |
| 306-313 | `MainDialog.xml`、`StatusMenu.xml` | 主面板固定按钮 |

## 附录 B：界面文本里没写、但图片名暗示的功能

`EmotionThumb.png`（91KB，表情总览图）、`Mall1.jpg`/`Mall2.jpg`（商城海报）、`Advertisement.gif`/`Advertisement2.gif`（广告条）、`QQFeedback.png`（反馈二维码）、`ForumCenter.png`（论坛入口）、`GuideTips1-3.png`（引导三屏）、`Scanning.png`/`ScanSuccess.png`/`ScanFail.png`（扫描三态）、`RemoteHelp.gif`/`RemoteSuccess.png`/`RemoteFinish.png`（远程三态）、`ShareHistory.png`/`ShareHistoryBkg.png`（共享下载历史）、`IpMsgOffline24/32/42.png`（飞鸽离线图标）、`VipOpen.png`（VIP 开通）、`gm0/gm1`、`jz0/jz1`、`offline.png`、`WebSite.png`、`News.png`（布局未引用，疑似托盘/资讯/广告在用，**用途待验证**）。
