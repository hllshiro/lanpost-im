<script setup lang="ts">
import { computed } from 'vue'
import { FolderOpen, MessageSquare, Settings, UserRound, Users } from '@lucide/vue'
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
}>()

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
    <button class="profile" :title="profileTitle" aria-label="账号与设置" @click="emit('settings')">
      <span class="avatar">
        <UserRound v-if="!local" :size="20" :stroke-width="1.7" />
        <template v-else>{{ initial }}</template>
      </span>
      <span class="status" :class="statusClass" />
    </button>

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

      <button class="nav-item disabled" disabled title="联系人页开发中">
        <Users :size="21" :stroke-width="1.7" />
        <span class="label">联系人</span>
      </button>

      <button class="nav-item disabled" disabled title="文件页开发中">
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

.profile {
  position: relative;
  flex: 0 0 auto;
  margin-bottom: 26px;
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
  right: -2px;
  bottom: -2px;
  width: 10px;
  height: 10px;
  border: 2px solid var(--rail-bg);
  border-radius: 50%;
  background: #8d8d8d;
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

.nav-item:hover:not(.disabled) {
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

.nav-item.disabled {
  opacity: 0.42;
  cursor: default;
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
