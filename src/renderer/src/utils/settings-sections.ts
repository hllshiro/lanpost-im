export const SETTINGS_SECTION_IDS = [
  'identity',
  'network',
  'notify',
  'files',
  'appearance',
  'general',
  'shortcuts',
  'storage',
  'about'
] as const

export type SettingsSection = (typeof SETTINGS_SECTION_IDS)[number]
