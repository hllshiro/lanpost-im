// 标准 IPMSG 命令号。
export const CMD_ENTRY = 0x01
export const CMD_EXIT = 0x02
export const CMD_ANSENTRY = 0x03
export const CMD_SENDMSG = 0x20
export const CMD_RECVMSG = 0x21
export const CMD_READMSG = 0x30
export const CMD_DELMSG = 0x31
export const CMD_GETINFO = 0x40
export const CMD_GETFILE = 0x60
export const CMD_RELEASE = 0x61
export const CMD_GETDIR = 0x62

// 标准命令位。
export const CMD_SENDCHECK = 0x100
export const CMD_SECRET = 0x200
export const CMD_BROADCAST = 0x400
// 附件位与 UTF8 位由内网通扩展，命令号本身仍属于标准命令范围。
export const CMD_FILEATTACH = 0x200000
export const CMD_UTF8 = 0x800000

// 私有 XML 命令号。
export const CMD_HANDSHAKE = 1000
export const CMD_CHANGE_STATUS = 1001
export const CMD_CHANGE_SIGN = 1002
export const CMD_CHANGE_INFO = 1003
export const CMD_CHATMSG = 1004
export const CMD_CHATMSG_ACK = 1005
export const CMD_CHAT_RECEIPT = 1006
export const CMD_FLASH_SCREEN = 1007
export const CMD_WRITING = 1008
export const CMD_SEND_FILE = 1009
export const CMD_OPERATE_SEND_FILE = 1010
export const CMD_OPERATE_RECV_FILE = 1011
export const CMD_PROGRESS_RECV_FILE = 1012
export const CMD_SEND_FOLDER = 1013
export const CMD_OPERATE_SEND_DIR = 1014
export const CMD_OPERATE_RECV_DIR = 1015
export const CMD_HEARTBEAT = 1016
export const CMD_QUIT = 1017
export const CMD_READY = 1018
export const CMD_REVERSE_FILE_REQ = 1019
export const CMD_REVERSE_FOLDER_REQ = 1020
export const CMD_OFFLINE_SEND_DONE = 1022
export const CMD_OFFLINE_DELETE = 1023
export const CMD_REMIND_FILE = 1024
export const CMD_REMIND_FILE_GROUP = 1025

export const LEGACY_COMMAND_MASK = 0xff
export const LEGACY_FLAGS = CMD_SENDCHECK | CMD_SECRET | CMD_BROADCAST | CMD_FILEATTACH | CMD_UTF8
