<script setup lang="ts">
import { computed, ref } from 'vue'
import { onClickOutside, useEventListener } from '@vueuse/core'
import { Check, FolderOpen, MessageSquare, Settings, UserRound, Users } from '@lucide/vue'
import type { LocalInfo } from '../../../shared/domain'
import { initialOf } from '../utils/format'

const props = withDefaults(
  defineProps<{
    local: LocalInfo | null
    unread: number
    active?: 'chat' | 'contacts' | 'files'
  }>(),
  { active: 'chat' }
)

const emit = defineEmits<{
  select: [view: 'chat' | 'contacts' | 'files']
  settings: []
  status: [status: number]
}>()

const statusOptions = [
  { value: 0, label: '在线', tone: 'online' },
  { value: 1, label: '忙碌', tone: 'busy' },
  { value: 2, label: '离开', tone: 'away' }
] as const

const profileRef = ref<HTMLElement | null>(null)
const statusMenuOpen = ref(false)

onClickOutside(profileRef, () => {
  statusMenuOpen.value = false
})
useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (event.key === 'Escape') statusMenuOpen.value = false
})

function toggleStatusMenu(): void {
  statusMenuOpen.value = !statusMenuOpen.value
}

function chooseStatus(status: number): void {
  statusMenuOpen.value = false
  if (props.local?.status !== status) emit('status', status)
}

const displayName = computed(() => props.local?.name ?? '未识别')
const initial = computed(() => initialOf(props.local?.name ?? ''))
const statusClass = computed(() => {
  if (!props.local?.online) return 'offline'
  if (props.local.status === 1) return 'busy'
  if (props.local.status === 2) return 'away'
  return 'online'
})
const statusText = computed(() => {
  if (!props.local) return '离线'
  if (!props.local.online) return '离线'
  if (props.local.status === 1) return '忙碌'
  if (props.local.status === 2) return '离开'
  return '在线'
})
const profileTitle = computed(() => `${displayName.value} · ${statusText.value}`)
const badge = computed(() => (props.unread > 99 ? '99+' : String(props.unread)))
</script>

<template>
  <aside class="rail">
    <div ref="profileRef" class="profile-wrap">
      <button
        class="profile"
        :title="`${profileTitle} · 点击打开设置`"
        aria-label="账号与设置"
        @click="emit('settings')"
      >
        <span class="avatar">
          <UserRound v-if="!local" :size="20" :stroke-width="1.7" />
          <template v-else>{{ initial }}</template>
        </span>
      </button>
      <button
        class="status"
        :class="statusClass"
        :title="`当前状态：${statusText}，点击切换`"
        aria-label="切换在线状态"
        aria-haspopup="menu"
        :aria-expanded="statusMenuOpen"
        @click="toggleStatusMenu"
      />
      <div v-if="statusMenuOpen" class="status-menu" role="menu" aria-label="在线状态">
        <p class="status-menu-title">在线状态</p>
        <button
          v-for="option in statusOptions"
          :key="option.value"
          class="status-option"
          :class="{ active: local?.status === option.value }"
          role="menuitemradio"
          :aria-checked="local?.status === option.value"
          @click="chooseStatus(option.value)"
        >
          <span class="dot" :class="option.tone" />
          <span>{{ option.label }}</span>
          <Check v-if="local?.status === option.value" :size="13" :stroke-width="2" class="check" />
        </button>
      </div>
    </div>

    <nav class="nav" aria-label="主导航">
      <button
        class="nav-item"
        :class="{ active: active === 'chat' }"
        title="聊天"
        @click="emit('select', 'chat')"
      >
        <MessageSquare :size="21" :stroke-width="1.7" />
        <span class="label">聊天</span>
        <span v-if="unread > 0" class="badge">{{ badge }}</span>
      </button>

      <button
        class="nav-item"
        :class="{ active: active === 'contacts' }"
        title="联系人"
        @click="emit('select', 'contacts')"
      >
        <Users :size="21" :stroke-width="1.7" />
        <span class="label">联系人</span>
      </button>

      <button
        class="nav-item"
        :class="{ active: active === 'files' }"
        title="文件"
        @click="emit('select', 'files')"
      >
        <FolderOpen :size="21" :stroke-width="1.7" />
        <span class="label">文件</span>
      </button>
    </nav>

    <div class="bottom">
      <button class="nav-item" title="设置" @click="emit('settings')">
        <Settings :size="21" :stroke-width="1.7" />
        <span class="label">设置</span>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.rail {
  flex: 0 0 60px;
  width: 60px;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 18px 0 14px;
  background: var(--rail-bg);
  color: var(--rail-text);
  user-select: none;
}

.profile-wrap {
  position: relative;
  flex: 0 0 auto;
  margin-bottom: 26px;
}

.profile {
  display: block;
  border-radius: var(--avatar-radius);
}

.avatar {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: var(--avatar-radius);
  background: #4b4b4b;
  color: #ffffff;
  font-size: 16px;
  font-weight: 500;
}

.profile:hover .avatar {
  background: #575757;
}

.status {
  position: absolute;
  right: -3px;
  bottom: -3px;
  width: 14px;
  height: 14px;
  padding: 0;
  border: 2px solid var(--rail-bg);
  border-radius: 50%;
  background: #8d8d8d;
  cursor: pointer;
  transition: transform 0.12s ease;
}

.status:hover {
  transform: scale(1.15);
}

.status.online {
  background: var(--accent);
}

.status.busy {
  background: var(--warning);
}

.status.away {
  background: #d9c04a;
}

.status.offline {
  background: #8d8d8d;
}

.status-menu {
  position: absolute;
  left: 46px;
  top: 30px;
  z-index: 60;
  width: 126px;
  padding: 5px;
  border-radius: 8px;
  background: #ffffff;
  color: var(--text);
  text-align: left;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
}

.status-menu-title {
  margin: 4px 8px 6px;
  font-size: 10.5px;
  color: var(--text-muted);
}

.status-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 30px;
  padding: 0 8px;
  border-radius: 5px;
  font-size: 12px;
  color: var(--text);
}

.status-option:hover {
  background: #f2f2f2;
}

.status-option.active {
  color: var(--accent);
  font-weight: 600;
}

.status-option .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #8d8d8d;
}

.status-option .dot.online {
  background: var(--accent);
}

.status-option .dot.busy {
  background: var(--warning);
}

.status-option .dot.away {
  background: #d9c04a;
}

.status-option .check {
  margin-left: auto;
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  align-items: center;
}

.nav-item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  width: 48px;
  height: 52px;
  border-radius: 6px;
  color: var(--rail-text-dim);
  transition:
    background-color 0.12s ease,
    color 0.12s ease;
}

.nav-item:hover {
  background: var(--rail-hover);
  color: var(--rail-text);
}

.nav-item.active {
  background: var(--rail-active);
  color: var(--accent);
}

.nav-item.active .label {
  color: var(--rail-text);
}

.label {
  font-size: 10px;
  line-height: 1;
  color: var(--rail-text-dim);
}

.badge {
  position: absolute;
  top: 3px;
  right: 2px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border: 2px solid var(--rail-bg);
  border-radius: 8px;
  background: var(--danger);
  color: #ffffff;
  font-size: 10px;
  line-height: 12px;
  text-align: center;
}

.bottom {
  margin-top: auto;
  width: 100%;
  display: flex;
  justify-content: center;
}
</style>
