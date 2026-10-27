import { z } from 'zod'

export const SETTINGS_VERSION = 1

const identitySchema = z.object({
  displayName: z.string().min(1).default('张三'),
  account: z.string().min(1).default('lanpost'),
  hostName: z.string().min(1).default('lanpost-pc'),
  group: z.string().default(''),
  status: z.number().int().min(0).max(2).default(0),
  identityId: z.string().default('')
})

const networkSchema = z.object({
  port: z.number().int().min(1).max(65535).default(2425),
  bindAddr: z.string().default('0.0.0.0'),
  subnets: z.array(z.string()).default([]),
  seeds: z.array(z.string()).default([]),
  broadcastInterval: z.number().int().min(5).max(3600).default(30),
  dialup: z.boolean().default(false)
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
  closeToTray: z.boolean().default(true),
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
