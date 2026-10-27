<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import { MessageSquare, Pin, RefreshCw, Search, X } from '@lucide/vue'
import type { ConversationInfo, MessageInfo, PeerInfo } from '../../../shared/domain'
import { formatConversationTime, initialOf, previewText } from '../utils/format'

const props = defineProps<{
  conversations: ConversationInfo[]
  peers: PeerInfo[]
  previews: Record<string, MessageInfo>
  selectedId: string | null
  loading: boolean
  refreshing: boolean
}>()

const emit = defineEmits<{
  select: [id: string]
  refresh: []
  pin: [id: string, pinned: boolean]
}>()

const MENU_WIDTH = 148
const MENU_HEIGHT = 38
const MENU_MARGIN = 8

const query = ref('')
const menu = ref<{ x: number; y: number; conversation: ConversationInfo } | null>(null)

const keyword = computed(() => query.value.trim().toLowerCase())

const peerByKey = computed(() => {
  const map = new Map<string, PeerInfo>()
  for (const peer of props.peers) {
    map.set(peer.key, peer)
  }
  return map
})

function peerOf(conversation: ConversationInfo): PeerInfo | null {
  if (conversation.peerKey === null) return null
  return peerByKey.value.get(conversation.peerKey) ?? null
}

function presenceClass(conversation: ConversationInfo): string {
  const peer = peerOf(conversation)
  if (peer === null || !peer.online) return 'offline'
  if (peer.status === 1) return 'busy'
  if (peer.status === 2) return 'away'
  return 'online'
}

function presenceText(conversation: ConversationInfo): string {
  const peer = peerOf(conversation)
  if (peer === null || !peer.online) return '离线'
  if (peer.status === 1) return '忙碌'
  if (peer.status === 2) return '离开'
  return '在线'
}

const visible = computed(() => {
  return props.conversations.filter((conversation) => {
    if (!keyword.value) return true
    if (conversation.title.toLowerCase().includes(keyword.value)) return true
    return previewOf(conversation).toLowerCase().includes(keyword.value)
  })
})

const pinnedItems = computed(() => visible.value.filter((conversation) => conversation.pinned))
const otherItems = computed(() => visible.value.filter((conversation) => !conversation.pinned))

const sections = computed(() => {
  const list: Array<{
    key: 'pinned' | 'others'
    label: string
    items: ConversationInfo[]
    showHeader: boolean
  }> = []
  if (pinnedItems.value.length > 0) {
    list.push({ key: 'pinned', label: '置顶', items: pinnedItems.value, showHeader: true })
  }
  list.push({
    key: 'others',
    label: '其他',
    items: otherItems.value,
    showHeader: pinnedItems.value.length > 0 && otherItems.value.length > 0
  })
  return list
})

const emptyText = computed(() => {
  if (props.loading && props.conversations.length === 0) return '正在加载会话…'
  if (props.conversations.length === 0) return '暂无会话'
  return '没有匹配的会话'
})

function openMenu(event: MouseEvent, conversation: ConversationInfo): void {
  event.preventDefault()
  menu.value = {
    x: Math.min(event.clientX, window.innerWidth - MENU_WIDTH - MENU_MARGIN),
    y: Math.min(event.clientY, window.innerHeight - MENU_HEIGHT - MENU_MARGIN),
    conversation
  }
}

function closeMenu(): void {
  menu.value = null
}

function togglePin(): void {
  const current = menu.value
  if (current === null) return
  emit('pin', current.conversation.id, !current.conversation.pinned)
  closeMenu()
}

useEventListener(window, 'click', closeMenu)
useEventListener(window, 'scroll', closeMenu, true)
useEventListener(window, 'resize', closeMenu)
useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (event.key === 'Escape') closeMenu()
})

onBeforeUnmount(closeMenu)

const emptyHint = computed(() => {
  if (props.conversations.length === 0 && !props.loading) return '收到新消息后会显示在这里'
  return ''
})

function previewOf(conversation: ConversationInfo): string {
  const draft = conversation.draft.replace(/\s+/g, ' ').trim()
  if (draft) return `[草稿] ${draft}`
  const message = props.previews[conversation.id]
  if (message) return previewText(message)
  return '暂无消息'
}

function badgeOf(count: number): string {
  return count > 99 ? '99+' : String(count)
}
</script>

<template>
  <section class="list" aria-label="会话列表">
    <header class="head">
      <div class="head-top">
        <div class="search">
          <Search :size="14" :stroke-width="1.8" class="search-icon" />
          <input
            v-model="query"
            type="text"
            placeholder="搜索"
            autocomplete="off"
            spellcheck="false"
            aria-label="搜索会话"
          />
          <button v-if="query" class="clear" title="清空搜索" @click="query = ''">
            <X :size="13" />
          </button>
        </div>
        <button
          class="refresh"
          :class="{ spinning: refreshing }"
          :disabled="refreshing"
          :title="refreshing ? '正在刷新联系人' : '刷新联系人，并重新广播上线状态'"
          aria-label="刷新联系人"
          @click="emit('refresh')"
        >
          <RefreshCw :size="15" :stroke-width="1.9" />
        </button>
      </div>
    </header>

    <div class="rows" role="listbox" aria-label="会话">
      <template v-for="section in sections" :key="section.key">
        <div v-if="section.showHeader" class="section-title">{{ section.label }}</div>
        <button
          v-for="conversation in section.items"
          :key="conversation.id"
          class="row"
          :class="{ selected: conversation.id === selectedId }"
          role="option"
          :aria-selected="conversation.id === selectedId"
          @click="emit('select', conversation.id)"
          @contextmenu.prevent="openMenu($event, conversation)"
        >
          <span class="avatar-wrap">
            <span class="avatar">{{ initialOf(conversation.title) }}</span>
            <span
              v-if="peerOf(conversation)"
              class="presence-dot"
              :class="presenceClass(conversation)"
              :title="presenceText(conversation)"
            />
          </span>
          <span class="body">
            <span class="line">
              <span class="title">{{ conversation.title }}</span>
              <span
                v-if="peerOf(conversation)"
                class="presence-text"
                :class="presenceClass(conversation)"
              >
                {{ presenceText(conversation) }}
              </span>
              <Pin v-if="conversation.pinned" class="pin" :size="11" :stroke-width="2" />
              <span class="time">{{ formatConversationTime(conversation.lastMessageAt) }}</span>
            </span>
            <span class="line">
              <span class="preview" :class="{ draft: conversation.draft.trim() }">
                {{ previewOf(conversation) }}
              </span>
              <span v-if="conversation.unread > 0" class="badge">
                {{ badgeOf(conversation.unread) }}
              </span>
            </span>
          </span>
        </button>
      </template>

      <div v-if="visible.length === 0" class="empty">
        <MessageSquare :size="26" :stroke-width="1.4" />
        <p>{{ emptyText }}</p>
        <small v-if="emptyHint">{{ emptyHint }}</small>
      </div>
    </div>

    <div
      v-if="menu"
      class="context-menu"
      :style="{ left: `${menu.x}px`, top: `${menu.y}px`, width: `${MENU_WIDTH}px` }"
      role="menu"
      @click.stop
    >
      <button class="context-item" role="menuitem" @click="togglePin">
        <Pin :size="13" :stroke-width="1.9" />
        <span>{{ menu.conversation.pinned ? '取消置顶' : '置顶会话' }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.list {
  flex: 0 0 280px;
  width: 280px;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--list-bg);
  border-right: 1px solid var(--divider);
  user-select: none;
}

.head {
  flex: 0 0 auto;
  padding: 14px 12px 6px;
}

.head-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.search {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 8px;
  border-radius: var(--radius-button);
  background: var(--page-bg);
}

.refresh {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-button);
  color: var(--text-secondary);
  background: var(--page-bg);
}

.refresh:hover:not(:disabled) {
  color: var(--accent);
}

.refresh:disabled {
  opacity: 0.65;
  cursor: default;
}

.refresh.spinning svg {
  animation: refresh-spin 0.9s linear infinite;
}

@keyframes refresh-spin {
  to {
    transform: rotate(360deg);
  }
}

.search-icon {
  flex: 0 0 auto;
  color: var(--text-muted);
}

.search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  font-size: 12.5px;
}

.clear {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  color: #ffffff;
  background: #c8c8c8;
}

.clear:hover {
  background: #adadad;
}

.section-title {
  padding: 8px 12px 4px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  letter-spacing: 0.02em;
}

.rows {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 0 12px;
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: var(--row-height);
  min-height: var(--row-height);
  padding: 0 12px;
  text-align: left;
  background: transparent;
}

.row:hover {
  background: var(--hover);
}

.row.selected,
.row.selected:hover {
  background: var(--selected);
}

.avatar-wrap {
  position: relative;
  flex: 0 0 auto;
  width: var(--avatar-size);
  height: var(--avatar-size);
}

.avatar {
  display: grid;
  place-items: center;
  width: var(--avatar-size);
  height: var(--avatar-size);
  border-radius: var(--avatar-radius);
  background: #d9e2ea;
  color: #4c5a68;
  font-size: 15px;
  font-weight: 500;
}

.presence-dot {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 10px;
  height: 10px;
  border: 2px solid var(--list-bg);
  border-radius: 50%;
  background: #b8b8b8;
}

.presence-dot.online {
  background: var(--accent);
}

.presence-dot.busy {
  background: var(--warning);
}

.presence-dot.away {
  background: #d9c04a;
}

.presence-dot.offline {
  background: #b8b8b8;
}

.presence-text {
  flex: 0 0 auto;
  font-size: 10px;
  color: var(--text-muted);
}

.presence-text.online {
  color: var(--accent);
}

.presence-text.busy {
  color: var(--warning);
}

.presence-text.away {
  color: #b39a16;
}

.presence-text.offline {
  color: var(--text-muted);
}

.row.selected .avatar {
  background: #cbd8e4;
}

.body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  color: var(--text);
}

.pin {
  flex: 0 0 auto;
  color: var(--text-muted);
}

.time {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--text-muted);
}

.preview {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text-secondary);
}

.preview.draft {
  color: var(--danger);
}

.badge {
  flex: 0 0 auto;
  min-width: 17px;
  height: 17px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--danger);
  color: #ffffff;
  font-size: 10.5px;
  line-height: 17px;
  text-align: center;
}

.context-menu {
  position: fixed;
  z-index: 40;
  padding: 4px;
  border: 1px solid #e2e2e2;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.14);
}

.context-item {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  height: 30px;
  padding: 0 8px;
  border-radius: 5px;
  font-size: 12.5px;
  color: var(--text);
  text-align: left;
}

.context-item:hover {
  background: var(--hover);
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 56px 20px;
  color: var(--text-muted);
  text-align: center;
}

.empty p {
  margin: 4px 0 0;
  font-size: 13px;
}

.empty small {
  font-size: 11.5px;
  color: #c2c2c2;
}
</style>
