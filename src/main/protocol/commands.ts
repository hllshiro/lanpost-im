// 标准 IPMSG 命令号（低 8 位）与选项位（高 24 位）。
export const CMD_ENTRY = 0x01
export const CMD_EXIT = 0x02
export const CMD_ANSENTRY = 0x03
export const CMD_ABSENCE = 0x04
export const CMD_ISGETLIST = 0x10
export const CMD_OKGETLIST = 0x11
export const CMD_GETLIST = 0x12
export const CMD_ANSLIST = 0x13
export const CMD_SENDMSG = 0x20
export const CMD_RECVMSG = 0x21
export const CMD_READMSG = 0x30
export const CMD_DELMSG = 0x31
export const CMD_ANSREADMSG = 0x32
export const CMD_GETINFO = 0x40
export const CMD_SENDINFO = 0x41
export const CMD_GETABSENCEINFO = 0x50
export const CMD_SENDABSENCEINFO = 0x51
export const CMD_GETFILEDATA = 0x60
export const CMD_RELEASEFILES = 0x61
export const CMD_GETDIRFILES = 0x62

export const OPT_ABSENCE = 0x00000100
export const OPT_SENDCHECK = 0x00000100
export const OPT_SECRET = 0x00000200
export const OPT_BROADCAST = 0x00000400
export const OPT_MULTICAST = 0x00000800
export const OPT_AUTORET = 0x00002000
export const OPT_RETRY = 0x00004000
export const OPT_NOLOG = 0x00020000
export const OPT_NOADDLIST = 0x00080000
export const OPT_READCHECK = 0x00100000
export const OPT_FILEATTACH = 0x00200000
export const OPT_UTF8 = 0x00800000
export const OPT_CAPUTF8 = 0x01000000
export const OPT_CLIPBOARD = 0x08000000
export const OPT_DIALUP = 0x00010000
export const OPT_SERVER = 0x00000200

export const LEGACY_FLAGS =
  OPT_ABSENCE |
  OPT_SENDCHECK |
  OPT_SECRET |
  OPT_BROADCAST |
  OPT_MULTICAST |
  OPT_AUTORET |
  OPT_RETRY |
  OPT_NOLOG |
  OPT_NOADDLIST |
  OPT_READCHECK |
  OPT_FILEATTACH |
  OPT_UTF8 |
  OPT_CAPUTF8 |
  OPT_CLIPBOARD |
  OPT_DIALUP |
  OPT_SERVER

export const FILE_ATTR_REGULAR = 0x01
export const FILE_ATTR_DIR = 0x02
export const FILE_ATTR_RETPARENT = 0x03
export const FILE_ATTR_SYMLINK = 0x04
export const FILE_ATTR_CDEV = 0x05
export const FILE_ATTR_BDEV = 0x06
export const FILE_ATTR_FIFO = 0x07
export const FILE_ATTR_RESFORK = 0x10
export const FILE_ATTR_CLIPBOARD = 0x20

export const FILE_OPT_RONLY = 0x00000100
export const FILE_OPT_HIDDEN = 0x00001000
export const FILE_OPT_EXHIDDEN = 0x00002000
export const FILE_OPT_ARCHIVE = 0x00004000
export const FILE_OPT_SYSTEM = 0x00008000

export const EXT_UID = 0x01
export const EXT_USERNAME = 0x02
export const EXT_GID = 0x03
export const EXT_GROUPNAME = 0x04
export const EXT_CLIPBOARDPOS = 0x08
export const EXT_PERM = 0x10
export const EXT_MAJORNO = 0x11
export const EXT_MINORNO = 0x12
export const EXT_CTIME = 0x13
export const EXT_MTIME = 0x14
export const EXT_ATIME = 0x15
export const EXT_CREATETIME = 0x16
export const EXT_CREATOR = 0x20
export const EXT_FILETYPE = 0x21
export const EXT_FINDERINFO = 0x22
export const EXT_ACL = 0x30
export const EXT_ALIASFNAME = 0x40
