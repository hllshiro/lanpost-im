import { z } from 'zod'

export const SETTINGS_VERSION = 1

const identitySchema = z.object({
  displayName: z.string().min(1).default('张三'),
  account: z.string().min(1).default('lanpost'),
  hostName: z.string().min(1).default('lanpost-pc'),
  group: z.string().default(''),
  corporation: z.string().default(''),
  department: z.string().default(''),
  sign: z.string().default(''),
  status: z.number().int().min(0).max(2).default(0),
  privateId: z.string().default(''),
  // 本机头像：文件按 md5 存在数据目录，id 是对端取图时用的文件号
  avatarMd5: z.string().default(''),
  avatarId: z.number().int().min(0).default(0)
})

const networkSchema = z.object({
  bindAddr: z.string().default('0.0.0.0'),
  broadcastInterval: z.number().int().min(5).max(3600).default(30),
  privatePort: z.number().int().min(1).max(65535).default(9011),
  // ENet 会话监听端口；0 表示由系统分配
  privateEnetPort: z.number().int().min(0).max(65535).default(9012),
  // 私有文件通道的 TCP 监听端口，写进 X_HANDSHARK 的 NET 节点，对端据此连过来
  privateFilePort: z.number().int().min(1).max(65535).default(9013),
  // 私有文件夹通道的 TCP 监听端口；置 0 表示不接收文件夹
  privateFolderPort: z.number().int().min(0).max(65535).default(9014),
  privateSeeds: z.array(z.string()).default([])
})

const notifySchema = z.object({
  enabled: z.boolean().default(true),
  sound: z.boolean().default(true),
  soundFile: z.string().default('builtin'),
  soundVolume: z.number().int().min(0).max(100).default(70),
  flashTaskbar: z.boolean().default(true),
  systemNotification: z.boolean().default(true),
  inAppToast: z.boolean().default(true),
  dnd: z.boolean().default(false),
  dndStart: z.string().default('22:00'),
  dndEnd: z.string().default('08:00')
})

const filesSchema = z.object({
  receiveDir: z.string().default(''),
  receiveLayout: z.enum(['flat', 'nickname']).default('flat'),
  lastDialogDir: z.string().default(''),
  autoAccept: z.boolean().default(false),
  autoAcceptMaxMB: z.number().int().min(0).default(512),
  notifyOnComplete: z.boolean().default(true),
  openAfterReceive: z.boolean().default(false)
})

const appearanceSchema = z.object({
  fontSize: z.number().int().min(12).max(20).default(14),
  density: z.enum(['standard', 'compact']).default('standard')
})

export const DEFAULT_SHORTCUTS = {
  toggleWindow: 'Ctrl+Alt+W',
  openReceiveDir: 'Ctrl+Alt+R'
} as const

const shortcutsSchema = z.object({
  enabled: z.boolean().default(true),
  toggleWindow: z.string().default(DEFAULT_SHORTCUTS.toggleWindow),
  openReceiveDir: z.string().default(DEFAULT_SHORTCUTS.openReceiveDir)
})

const generalSchema = z.object({
  startAtLogin: z.boolean().default(false),
  startMinimized: z.boolean().default(false),
  language: z.enum(['zh-CN']).default('zh-CN')
})

const storageSchema = z.object({
  dataDir: z.string().default(''),
  historyRetention: z.enum(['forever']).default('forever')
})

export const settingsSchema = z.object({
  version: z.number().int().min(1).default(SETTINGS_VERSION),
  identity: identitySchema.prefault({}),
  network: networkSchema.prefault({}),
  notify: notifySchema.prefault({}),
  files: filesSchema.prefault({}),
  appearance: appearanceSchema.prefault({}),
  general: generalSchema.prefault({}),
  shortcuts: shortcutsSchema.prefault({}),
  storage: storageSchema.prefault({})
})

export type Settings = z.infer<typeof settingsSchema>
export type SettingsPatch = {
  [K in Exclude<keyof Settings, 'version'>]?: Partial<Settings[K]>
}

export const defaultSettings: Settings = settingsSchema.parse({})
