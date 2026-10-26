<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import {
  ArrowLeft,
  Bell,
  CircleAlert,
  FolderOpen,
  HardDrive,
  Info,
  Network,
  Palette,
  SlidersHorizontal,
  UserRound,
  X
} from '@lucide/vue'
import type { AppInfo, FirewallStatus } from '../../../shared/ipc'
import { defaultSettings, type Settings, type SettingsPatch } from '../../../shared/settings'
import { errorMessage } from '../utils/errors'
import ToggleSwitch from './ToggleSwitch.vue'

const emit = defineEmits<{
  close: []
  saved: [settings: Settings]
}>()

const categories = [
  { id: 'identity', label: '账号', icon: UserRound },
  { id: 'network', label: '网络', icon: Network },
  { id: 'notify', label: '消息', icon: Bell },
  { id: 'files', label: '文件', icon: FolderOpen },
  { id: 'appearance', label: '外观', icon: Palette },
  { id: 'general', label: '通用', icon: SlidersHorizontal },
  { id: 'storage', label: '存储', icon: HardDrive },
  { id: 'about', label: '关于', icon: Info }
] as const

type CategoryId = (typeof categories)[number]['id']
type Section = Exclude<keyof Settings, 'version'>

const current = ref<CategoryId>('identity')
const settings = ref<Settings>(structuredClone(defaultSettings))
const subnetsText = ref('')
const seedsText = ref('')
const pending = ref(0)
const error = ref('')
const saved = ref(false)
const confirmingReset = ref(false)
const appInfo = ref<AppInfo | null>(null)
const appInfoError = ref('')
const firewall = ref<FirewallStatus | null>(null)
const firewallBusy = ref(false)
let savedTimer: number | undefined

const currentLabel = computed(
  () => categories.find((item) => item.id === current.value)?.label ?? ''
)
const appName = computed(() => appInfo.value?.name ?? '内网传书')
const versionText = computed(() => {
  if (appInfo.value) return `版本 ${appInfo.value.version}`
  if (appInfoError.value) return '版本信息不可用'
  return '正在读取版本…'
})
const firewallLabel = computed(() => {
  switch (firewall.value?.state) {
    case 'allowed':
      return '已放行'
    case 'blocked':
      return '被阻止'
    case 'missing':
      return '未放行'
    case 'manual':
      return '需确认'
    case 'unsupported':
      return '无需配置'
    case 'unknown':
      return '未知'
    default:
      return '检测中…'
  }
})
const firewallHint = computed(
  () => firewall.value?.detail ?? '正在检测 Windows 防火墙规则，其他设备需要连接到本机'
)
const showFirewallRepair = computed(
  () =>
    firewall.value !== null &&
    firewall.value.state !== 'allowed' &&
    firewall.value.state !== 'unsupported'
)

function syncTextFields(): void {
  subnetsText.value = settings.value.network.subnets.join('\n')
  seedsText.value = settings.value.network.seeds.join('\n')
}

function applySettings(next: Settings): void {
  settings.value = next
  syncTextFields()
}

async function loadSettings(): Promise<void> {
  try {
    applySettings(await window.api.settings.get())
  } catch (reason) {
    error.value = errorMessage(reason)
  }
}

async function loadAppInfo(): Promise<void> {
  try {
    appInfo.value = await window.api.app.info()
  } catch (reason) {
    appInfoError.value = errorMessage(reason)
  }
}

async function loadFirewall(): Promise<void> {
  try {
    firewall.value = await window.api.firewall.check()
  } catch (reason) {
    firewall.value = { state: 'unknown', executable: '', detail: errorMessage(reason) }
  }
}

async function repairFirewall(): Promise<void> {
  if (firewallBusy.value) return
  firewallBusy.value = true
  error.value = ''
  try {
    firewall.value = await window.api.firewall.repair()
  } catch (reason) {
    error.value = errorMessage(reason)
  } finally {
    firewallBusy.value = false
  }
}

async function pushPatch(patch: SettingsPatch): Promise<void> {
  pending.value += 1
  error.value = ''
  try {
    const next = await window.api.settings.update(patch)
    applySettings(next)
    emit('saved', next)
    saved.value = true
    if (savedTimer !== undefined) window.clearTimeout(savedTimer)
    savedTimer = window.setTimeout(() => {
      saved.value = false
    }, 1800)
  } catch (reason) {
    error.value = errorMessage(reason)
  } finally {
    pending.value -= 1
  }
}

function saveField<K extends Section>(section: K, patch: Partial<Settings[K]>): void {
  void pushPatch({ [section]: patch } as SettingsPatch)
}

function saveSubnets(): void {
  const list = subnetsText.value
    .split(/[\s,;，；]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  settings.value.network.subnets = list
  saveField('network', { subnets: list })
}

function saveSeeds(): void {
  const list = seedsText.value
    .split(/[\s,;，；]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  settings.value.network.seeds = list
  saveField('network', { seeds: list })
}

function setDensity(density: Settings['appearance']['density']): void {
  settings.value.appearance.density = density
  saveField('appearance', { density })
}

async function restoreDefaults(): Promise<void> {
  let next: Settings
  try {
    next = await window.api.settings.defaults()
  } catch (reason) {
    error.value = errorMessage(reason)
    return
  }
  const patch: SettingsPatch = {
    identity: next.identity,
    network: next.network,
    notify: next.notify,
    files: next.files,
    appearance: next.appearance,
    general: next.general,
    storage: next.storage
  }
  confirmingReset.value = false
  await pushPatch(patch)
}

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (event.key === 'Escape') emit('close')
})

onMounted(() => {
  void loadSettings()
  void loadAppInfo()
  void loadFirewall()
})

onBeforeUnmount(() => {
  if (savedTimer !== undefined) window.clearTimeout(savedTimer)
})
</script>

<template>
  <div class="overlay">
    <aside class="side">
      <button class="back" @click="emit('close')">
        <ArrowLeft :size="15" :stroke-width="2" />
        <span>返回</span>
      </button>
      <nav class="side-nav" aria-label="设置分类">
        <button
          v-for="category in categories"
          :key="category.id"
          class="cat"
          :class="{ active: current === category.id }"
          @click="current = category.id"
        >
          <component :is="category.icon" :size="16" :stroke-width="1.8" />
          <span>{{ category.label }}</span>
        </button>
      </nav>
      <p class="side-foot">内网传书 · 局域网即时通信</p>
    </aside>

    <section class="panel">
      <header class="panel-head">
        <h1>{{ currentLabel }}</h1>
        <div class="save-state" aria-live="polite">
          <span v-if="pending > 0">保存中…</span>
          <span v-else-if="saved" class="done">已保存</span>
        </div>
      </header>

      <div v-if="error" class="error-line" role="alert">
        <CircleAlert :size="14" :stroke-width="2" />
        <span>{{ error }}</span>
        <button class="error-close" title="关闭错误提示" @click="error = ''">
          <X :size="12" />
        </button>
      </div>

      <div class="panel-body">
        <div v-show="current === 'identity'" class="group">
          <h2>个人资料</h2>
          <div class="row">
            <div class="row-text">
              <label class="label" for="setting-display-name">显示名称</label>
              <p class="hint">局域网内其他人看到的名称</p>
            </div>
            <div class="control">
              <input
                id="setting-display-name"
                v-model="settings.identity.displayName"
                class="input"
                maxlength="32"
                @change="saveField('identity', { displayName: settings.identity.displayName })"
              />
            </div>
          </div>
          <div class="row">
            <div class="row-text">
              <label class="label" for="setting-account">协议账号</label>
              <p class="hint">IPMSG 协议中的用户名，默认取当前计算机名</p>
            </div>
            <div class="control">
              <input
                id="setting-account"
                v-model="settings.identity.account"
                class="input"
                maxlength="32"
                @change="saveField('identity', { account: settings.identity.account })"
              />
            </div>
          </div>
          <div class="row">
            <div class="row-text">
              <label class="label" for="setting-host">主机名</label>
              <p class="hint">默认取当前计算机名，避免局域网内冲突</p>
            </div>
            <div class="control">
              <input
                id="setting-host"
                v-model="settings.identity.hostName"
                class="input"
                maxlength="64"
                @change="saveField('identity', { hostName: settings.identity.hostName })"
              />
            </div>
          </div>
          <div class="row">
            <div class="row-text"><label class="label" for="setting-group">分组</label></div>
            <div class="control">
              <input
                id="setting-group"
                v-model="settings.identity.group"
                class="input"
                maxlength="64"
                @change="saveField('identity', { group: settings.identity.group })"
              />
            </div>
          </div>
          <div class="row">
            <div class="row-text"><label class="label" for="setting-corporation">公司</label></div>
            <div class="control">
              <input
                id="setting-corporation"
                v-model="settings.identity.corporation"
                class="input"
                maxlength="64"
                @change="saveField('identity', { corporation: settings.identity.corporation })"
              />
            </div>
          </div>
          <div class="row">
            <div class="row-text"><label class="label" for="setting-department">部门</label></div>
            <div class="control">
              <input
                id="setting-department"
                v-model="settings.identity.department"
                class="input"
                maxlength="64"
                @change="saveField('identity', { department: settings.identity.department })"
              />
            </div>
          </div>
          <div class="row">
            <div class="row-text">
              <label class="label" for="setting-sign">个性签名</label>
            </div>
            <div class="control">
              <textarea
                id="setting-sign"
                v-model="settings.identity.sign"
                class="input textarea"
                maxlength="200"
                @change="saveField('identity', { sign: settings.identity.sign })"
              />
            </div>
          </div>
          <div class="row">
            <div class="row-text">
              <label class="label" for="setting-status">在线状态</label>
              <p class="hint">广播给局域网内其他人的状态</p>
            </div>
            <div class="control">
              <select
                id="setting-status"
                v-model.number="settings.identity.status"
                class="input"
                @change="saveField('identity', { status: settings.identity.status })"
              >
                <option :value="0">在线</option>
                <option :value="1">忙碌</option>
                <option :value="2">离开</option>
              </select>
            </div>
          </div>
        </div>

        <div v-show="current === 'network'" class="group">
          <h2>发现与连接</h2>
          <div class="row">
            <div class="row-text">
              <span class="label">监听端口<span class="restart">重启生效</span></span>
              <p class="hint">默认 2425，需与对端一致</p>
            </div>
            <div class="control">
              <input
                v-model.number="settings.network.port"
                class="input"
                type="number"
                min="1"
                max="65535"
                aria-label="监听端口"
                @change="saveField('network', { port: settings.network.port })"
              />
            </div>
          </div>
          <div class="row">
            <div class="row-text">
              <span class="label">监听地址<span class="restart">重启生效</span></span>
              <p class="hint">0.0.0.0 表示监听全部网卡</p>
            </div>
            <div class="control">
              <input
                v-model="settings.network.bindAddr"
                class="input"
                aria-label="监听地址"
                @change="saveField('network', { bindAddr: settings.network.bindAddr })"
              />
            </div>
          </div>
          <div class="row">
            <div class="row-text">
              <span class="label">防火墙</span>
              <p class="hint">{{ firewallHint }}</p>
            </div>
            <div class="control control-auto">
              <span class="firewall-state" :class="firewall?.state">{{ firewallLabel }}</span>
              <button
                v-if="showFirewallRepair"
                class="reset"
                :disabled="firewallBusy"
                @click="repairFirewall"
              >
                {{ firewallBusy ? '处理中…' : '修复' }}
              </button>
            </div>
          </div>
          <div class="row">
            <div class="row-text">
              <span class="label">广播间隔</span>
              <p class="hint">秒，范围 5 到 3600</p>
            </div>
            <div class="control">
              <input
                v-model.number="settings.network.broadcastInterval"
                class="input"
                type="number"
                min="5"
                max="3600"
                aria-label="广播间隔"
                @change="
                  saveField('network', { broadcastInterval: settings.network.broadcastInterval })
                "
              />
            </div>
          </div>
          <div class="row align-top">
            <div class="row-text">
              <label class="label" for="setting-subnets">额外广播网段</label>
              <p class="hint">每行一个，例如 192.168.1.255</p>
            </div>
            <div class="control">
              <textarea
                id="setting-subnets"
                v-model="subnetsText"
                class="input textarea"
                placeholder="留空表示自动"
                @change="saveSubnets"
              />
            </div>
          </div>
          <div class="row align-top">
            <div class="row-text">
              <label class="label" for="setting-seeds">固定对端地址</label>
              <p class="hint">每行一个，例如 192.168.1.20:2425</p>
            </div>
            <div class="control">
              <textarea
                id="setting-seeds"
                v-model="seedsText"
                class="input textarea"
                placeholder="留空表示只依赖广播"
                @change="saveSeeds"
              />
            </div>
          </div>
        </div>

        <div v-show="current === 'notify'" class="group">
          <h2>新消息提醒</h2>
          <div class="row">
            <div class="row-text">
              <span class="label">新消息提醒</span>
              <p class="hint">关闭后全部提醒效果都不生效</p>
            </div>
            <div class="control control-auto">
              <ToggleSwitch
                v-model="settings.notify.enabled"
                @update:model-value="saveField('notify', { enabled: $event })"
              />
            </div>
          </div>
          <div class="row">
            <div class="row-text">
              <span class="label">提示音</span>
              <p class="hint">使用内置提示音</p>
            </div>
            <div class="control control-auto">
              <ToggleSwitch
                v-model="settings.notify.sound"
                @update:model-value="saveField('notify', { sound: $event })"
              />
            </div>
          </div>
          <div class="row">
            <div class="row-text"><span class="label">提示音音量</span></div>
            <div class="control">
              <input
                v-model.number="settings.notify.soundVolume"
                class="range"
                type="range"
                min="0"
                max="100"
                step="5"
                aria-label="提示音音量"
                @change="saveField('notify', { soundVolume: settings.notify.soundVolume })"
              />
              <span class="value">{{ settings.notify.soundVolume }}%</span>
            </div>
          </div>
          <div class="row">
            <div class="row-text">
              <span class="label">任务栏闪烁</span>
              <p class="hint">窗口不在前台时闪烁任务栏与托盘</p>
            </div>
            <div class="control control-auto">
              <ToggleSwitch
                v-model="settings.notify.flashTaskbar"
                @update:model-value="saveField('notify', { flashTaskbar: $event })"
              />
            </div>
          </div>
          <div class="row">
            <div class="row-text"><span class="label">系统通知</span></div>
            <div class="control control-auto">
              <ToggleSwitch
                v-model="settings.notify.systemNotification"
                @update:model-value="saveField('notify', { systemNotification: $event })"
              />
            </div>
          </div>
          <div class="row">
            <div class="row-text"><span class="label">应用内提示</span></div>
            <div class="control control-auto">
              <ToggleSwitch
                v-model="settings.notify.inAppToast"
                @update:model-value="saveField('notify', { inAppToast: $event })"
              />
            </div>
          </div>
          <h2 class="group-gap">免打扰</h2>
          <div class="row">
            <div class="row-text">
              <span class="label">免打扰</span>
              <p class="hint">在此时段内不播放声音与系统通知</p>
            </div>
            <div class="control control-auto">
              <ToggleSwitch
                v-model="settings.notify.dnd"
                @update:model-value="saveField('notify', { dnd: $event })"
              />
            </div>
          </div>
          <div class="row">
            <div class="row-text"><span class="label">免打扰时段</span></div>
            <div class="control time-range">
              <input
                v-model="settings.notify.dndStart"
                class="input time"
                type="time"
                aria-label="免打扰开始时间"
                @change="saveField('notify', { dndStart: settings.notify.dndStart })"
              />
              <span class="time-sep">至</span>
              <input
                v-model="settings.notify.dndEnd"
                class="input time"
                type="time"
                aria-label="免打扰结束时间"
                @change="saveField('notify', { dndEnd: settings.notify.dndEnd })"
              />
            </div>
          </div>
        </div>

        <div v-show="current === 'files'" class="group">
          <h2>接收文件</h2>
          <div class="row">
            <div class="row-text">
              <label class="label" for="setting-receive-dir"
                >接收目录<span class="restart">重启生效</span></label
              >
              <p class="hint">留空使用默认目录</p>
            </div>
            <div class="control">
              <input
                id="setting-receive-dir"
                v-model="settings.files.receiveDir"
                class="input"
                placeholder="默认接收目录"
                @change="saveField('files', { receiveDir: settings.files.receiveDir })"
              />
            </div>
          </div>
          <div class="row">
            <div class="row-text">
              <span class="label">自动接收</span>
              <p class="hint">符合大小上限的文件直接接收</p>
            </div>
            <div class="control control-auto">
              <ToggleSwitch
                v-model="settings.files.autoAccept"
                @update:model-value="saveField('files', { autoAccept: $event })"
              />
            </div>
          </div>
          <div class="row">
            <div class="row-text">
              <span class="label">自动接收大小上限</span>
              <p class="hint">MB，0 表示不限</p>
            </div>
            <div class="control">
              <input
                v-model.number="settings.files.autoAcceptMaxMB"
                class="input"
                type="number"
                min="0"
                aria-label="自动接收大小上限"
                @change="saveField('files', { autoAcceptMaxMB: settings.files.autoAcceptMaxMB })"
              />
            </div>
          </div>
          <div class="row">
            <div class="row-text"><span class="label">接收完成提醒</span></div>
            <div class="control control-auto">
              <ToggleSwitch
                v-model="settings.files.notifyOnComplete"
                @update:model-value="saveField('files', { notifyOnComplete: $event })"
              />
            </div>
          </div>
          <div class="row">
            <div class="row-text">
              <span class="label">完成后打开文件</span>
              <p class="hint">接收完成后自动用系统默认程序打开</p>
            </div>
            <div class="control control-auto">
              <ToggleSwitch
                v-model="settings.files.openAfterReceive"
                @update:model-value="saveField('files', { openAfterReceive: $event })"
              />
            </div>
          </div>
        </div>

        <div v-show="current === 'appearance'" class="group">
          <h2>界面</h2>
          <div class="row">
            <div class="row-text">
              <span class="label">消息字号</span>
              <p class="hint">影响聊天气泡中的文字大小</p>
            </div>
            <div class="control">
              <input
                v-model.number="settings.appearance.fontSize"
                class="range"
                type="range"
                min="12"
                max="20"
                step="1"
                aria-label="消息字号"
                @change="saveField('appearance', { fontSize: settings.appearance.fontSize })"
              />
              <span class="value">{{ settings.appearance.fontSize }} px</span>
            </div>
          </div>
          <div class="row">
            <div class="row-text">
              <span class="label">列表密度</span>
              <p class="hint">紧凑模式缩短会话行与消息间距</p>
            </div>
            <div class="control">
              <div class="segmented" role="group" aria-label="列表密度">
                <button
                  :class="{ active: settings.appearance.density === 'standard' }"
                  @click="setDensity('standard')"
                >
                  标准
                </button>
                <button
                  :class="{ active: settings.appearance.density === 'compact' }"
                  @click="setDensity('compact')"
                >
                  紧凑
                </button>
              </div>
            </div>
          </div>
          <p class="note">当前版本只提供浅色主题。</p>
        </div>

        <div v-show="current === 'general'" class="group">
          <h2>窗口与启动</h2>
          <div class="row">
            <div class="row-text">
              <span class="label">关闭窗口时最小化到托盘</span>
              <p class="hint">关闭后程序继续在托盘运行</p>
            </div>
            <div class="control control-auto">
              <ToggleSwitch
                v-model="settings.general.closeToTray"
                @update:model-value="saveField('general', { closeToTray: $event })"
              />
            </div>
          </div>
          <div class="row">
            <div class="row-text"><span class="label">开机启动</span></div>
            <div class="control control-auto">
              <ToggleSwitch
                v-model="settings.general.startAtLogin"
                @update:model-value="saveField('general', { startAtLogin: $event })"
              />
            </div>
          </div>
          <div class="row">
            <div class="row-text">
              <span class="label">启动时隐藏窗口</span>
              <p class="hint">开机启动后不显示主界面</p>
            </div>
            <div class="control control-auto">
              <ToggleSwitch
                v-model="settings.general.startMinimized"
                @update:model-value="saveField('general', { startMinimized: $event })"
              />
            </div>
          </div>
          <div class="row">
            <div class="row-text"><span class="label">界面语言</span></div>
            <div class="control control-auto">
              <span class="readonly">简体中文</span>
            </div>
          </div>
        </div>

        <div v-show="current === 'storage'" class="group">
          <h2>数据存储</h2>
          <div class="row">
            <div class="row-text">
              <label class="label" for="setting-data-dir"
                >数据目录<span class="restart">重启生效</span></label
              >
              <p class="hint">数据库与设置文件所在位置，留空使用默认目录</p>
            </div>
            <div class="control">
              <input
                id="setting-data-dir"
                v-model="settings.storage.dataDir"
                class="input"
                placeholder="默认数据目录"
                @change="saveField('storage', { dataDir: settings.storage.dataDir })"
              />
            </div>
          </div>
          <div class="row">
            <div class="row-text"><span class="label">历史记录保留</span></div>
            <div class="control control-auto">
              <span class="readonly">永久</span>
            </div>
          </div>
          <p class="note">修改数据目录不会移动已经接收的文件。</p>
        </div>

        <div v-show="current === 'about'" class="about">
          <div class="brand">
            <span class="logo">✉</span>
            <div>
              <h2>{{ appName }}</h2>
              <p>{{ versionText }}</p>
            </div>
          </div>
          <p class="about-text">
            面向局域网环境的即时通信客户端，基于 IPMSG 协议发现对端并传输消息与文件。
          </p>
          <dl class="about-list">
            <div>
              <dt>应用标识</dt>
              <dd>{{ appInfo?.appId ?? '—' }}</dd>
            </div>
            <div>
              <dt>运行平台</dt>
              <dd>{{ appInfo?.platform ?? '—' }}</dd>
            </div>
            <div>
              <dt>通信协议</dt>
              <dd>IPMSG · 局域网广播</dd>
            </div>
            <div>
              <dt>数据目录</dt>
              <dd>{{ settings.storage.dataDir || '默认数据目录' }}</dd>
            </div>
          </dl>
          <p v-if="appInfoError" class="about-error">{{ appInfoError }}</p>
        </div>
      </div>

      <footer v-if="current !== 'about'" class="panel-foot">
        <template v-if="confirmingReset">
          <span class="reset-ask">确定恢复默认设置？</span>
          <button class="reset-confirm" @click="restoreDefaults">确认</button>
          <button class="reset" @click="confirmingReset = false">取消</button>
        </template>
        <button v-else class="reset" @click="confirmingReset = true">恢复默认</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.overlay {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  background: #ffffff;
  user-select: none;
}

.side {
  flex: 0 0 190px;
  width: 190px;
  display: flex;
  flex-direction: column;
  padding: 14px 10px 12px;
  background: #f7f7f7;
  border-right: 1px solid var(--divider);
}

.back {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  align-self: flex-start;
  padding: 5px 8px;
  margin-bottom: 10px;
  border-radius: var(--radius-button);
  font-size: 12.5px;
  color: var(--text-secondary);
}

.back:hover {
  background: #ececec;
  color: var(--text);
}

.side-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cat {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 10px;
  border-radius: var(--radius-button);
  font-size: 13px;
  color: #444444;
  text-align: left;
}

.cat:hover {
  background: #ededed;
}

.cat.active {
  background: #e4e4e4;
  color: var(--text);
  font-weight: 600;
}

.side-foot {
  margin: auto 0 0;
  padding: 0 8px;
  font-size: 10.5px;
  line-height: 1.5;
  color: #b0b0b0;
}

.panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.panel-head {
  flex: 0 0 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 28px;
  border-bottom: 1px solid var(--divider);
}

.panel-head h1 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.save-state {
  min-width: 52px;
  font-size: 11.5px;
  color: var(--text-muted);
  text-align: right;
}

.save-state .done {
  color: var(--accent);
}

.error-line {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 12px 28px 0;
  padding: 8px 10px;
  border-radius: var(--radius-button);
  background: #fff1f1;
  color: var(--danger);
  font-size: 11.5px;
  line-height: 1.5;
}

.error-line svg {
  flex: 0 0 auto;
  margin-top: 1px;
}

.error-line span {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}

.error-close {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  color: var(--danger);
  opacity: 0.75;
}

.error-close:hover {
  opacity: 1;
}

.panel-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 28px 24px;
}

.group {
  max-width: 640px;
}

.group h2 {
  margin: 0 0 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

.group h2.group-gap {
  margin-top: 22px;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  min-height: 44px;
  padding: 8px 0;
  border-bottom: 1px solid #f0f0f0;
}

.row.align-top {
  align-items: flex-start;
  padding-top: 12px;
}

.row:last-child {
  border-bottom: 0;
}

.row-text {
  min-width: 0;
}

.label {
  display: inline-block;
  font-size: 13px;
  color: var(--text);
  line-height: 1.4;
}

.hint {
  margin: 2px 0 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-secondary);
}

.restart {
  display: inline-block;
  margin-left: 6px;
  padding: 0 5px;
  border-radius: 3px;
  background: #fff3e0;
  color: #b8720a;
  font-size: 10px;
  line-height: 16px;
  vertical-align: 1px;
}

.control {
  flex: 0 0 230px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.control-auto {
  flex: 0 0 auto;
}

.input {
  width: 100%;
  height: 30px;
  padding: 0 9px;
  border: 1px solid #dcdcdc;
  border-radius: var(--radius-button);
  background: #ffffff;
  font-size: 12.5px;
  color: var(--text);
  outline: none;
}

.input:focus {
  border-color: var(--accent);
}

.textarea {
  height: 64px;
  padding: 6px 9px;
  resize: vertical;
  line-height: 1.5;
}

select.input {
  cursor: pointer;
}

.range {
  flex: 1;
  min-width: 0;
  accent-color: var(--accent);
}

.value {
  flex: 0 0 42px;
  font-size: 11.5px;
  color: var(--text-secondary);
  text-align: right;
}

.segmented {
  display: inline-flex;
  padding: 2px;
  border-radius: var(--radius-button);
  background: #f0f0f0;
}

.segmented button {
  min-width: 56px;
  height: 24px;
  border-radius: 3px;
  font-size: 12px;
  color: var(--text-secondary);
}

.segmented button.active {
  background: #ffffff;
  color: var(--text);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

.readonly {
  font-size: 12.5px;
  color: var(--text-secondary);
}

.firewall-state {
  font-size: 12.5px;
  color: var(--text-secondary);
}

.firewall-state.allowed {
  color: var(--accent);
}

.firewall-state.blocked {
  color: var(--danger);
}

.firewall-state.missing {
  color: #b8720a;
}

.firewall-state.manual {
  color: #b8720a;
}

.reset:disabled {
  opacity: 0.55;
  cursor: default;
}

.time-range {
  flex: 0 0 230px;
}

.time {
  width: 92px;
  flex: 0 0 92px;
}

.time-sep {
  font-size: 12px;
  color: var(--text-secondary);
}

.note {
  margin: 14px 0 0;
  font-size: 11.5px;
  color: var(--text-muted);
}

.panel-foot {
  flex: 0 0 54px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 28px;
  border-top: 1px solid var(--divider);
}

.reset {
  padding: 5px 10px;
  border-radius: var(--radius-button);
  border: 1px solid #e0e0e0;
  background: #ffffff;
  font-size: 12px;
  color: #666666;
}

.reset:hover {
  background: #f7f7f7;
}

.reset-ask {
  font-size: 12px;
  color: var(--text-secondary);
}

.reset-confirm {
  padding: 5px 10px;
  border-radius: var(--radius-button);
  background: var(--danger);
  color: #ffffff;
  font-size: 12px;
}

.about {
  max-width: 560px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 6px 0 18px;
}

.logo {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: var(--accent);
  color: #ffffff;
  font-size: 28px;
  line-height: 1;
}

.brand h2 {
  margin: 0 0 4px;
  font-size: 17px;
  font-weight: 600;
}

.brand p {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary);
}

.about-text {
  margin: 0 0 18px;
  font-size: 12.5px;
  line-height: 1.7;
  color: #555555;
}

.about-list {
  margin: 0;
  border-top: 1px solid #f0f0f0;
}

.about-list > div {
  display: flex;
  gap: 20px;
  padding: 9px 0;
  border-bottom: 1px solid #f0f0f0;
  font-size: 12.5px;
}

.about-list dt {
  flex: 0 0 84px;
  color: var(--text-secondary);
}

.about-list dd {
  flex: 1;
  min-width: 0;
  margin: 0;
  color: var(--text);
  word-break: break-all;
}

.about-error {
  margin: 12px 0 0;
  font-size: 11.5px;
  color: var(--danger);
}
</style>
