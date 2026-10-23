<script setup lang="ts">
import { computed, ref } from 'vue'
import { MessageSquare, Search, X } from '@lucide/vue'
import type { ConversationInfo, MessageInfo } from '../../../shared/domain'
import { formatConversationTime, initialOf, previewText } from '../utils/format'

const props = defineProps<{
  conversations: ConversationInfo[]
  previews: Record<string, MessageInfo>
  selectedId: string | null
  loading: boolean
}>()

const emit = defineEmits<{ select: [id: string] }>()

const query = ref('')
const filter = ref<'all' | 'unread'>('all')

const keyword = computed(() => query.value.trim().toLowerCase())
const unreadCount = computed(() => props.conversations.filter((item) => item.unread > 0).length)

const visible = computed(() => {
  const list = props.conversations.filter((conversation) => {
    if (filter.value === 'unread' && conversation.unread === 0) return false
    if (!keyword.value) return true
    if (conversation.title.toLowerCase().includes(keyword.value)) return true
    return previewOf(conversation).toLowerCase().includes(keyword.value)
  })
  return list
})

const emptyText = computed(() => {
  if (props.loading && props.conversations.length === 0) return '正在加载会话…'
  if (props.conversations.length === 0) return '暂无会话'
  if (filter.value === 'unread') return '没有未读会话'
  return '没有匹配的会话'
})

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
      <div class="tabs" role="tablist">
        <button
          class="tab"
          :class="{ active: filter === 'all' }"
          role="tab"
          :aria-selected="filter === 'all'"
          @click="filter = 'all'"
        >
          全部
        </button>
        <button
          class="tab"
          :class="{ active: filter === 'unread' }"
          role="tab"
          :aria-selected="filter === 'unread'"
          @click="filter = 'unread'"
        >
          未读<span v-if="unreadCount > 0" class="tab-count">{{ unreadCount }}</span>
        </button>
      </div>
    </header>

    <div class="rows" role="listbox" aria-label="会话">
      <button
        v-for="conversation in visible"
        :key="conversation.id"
        class="row"
        :class="{ selected: conversation.id === selectedId }"
        role="option"
        :aria-selected="conversation.id === selectedId"
        @click="emit('select', conversation.id)"
      >
        <span class="avatar">{{ initialOf(conversation.title) }}</span>
        <span class="body">
          <span class="line">
            <span class="title">{{ conversation.title }}</span>
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

      <div v-if="visible.length === 0" class="empty">
        <MessageSquare :size="26" :stroke-width="1.4" />
        <p>{{ emptyText }}</p>
        <small v-if="emptyHint">{{ emptyHint }}</small>
      </div>
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

.search {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 8px;
  border-radius: var(--radius-button);
  background: var(--page-bg);
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

.tabs {
  display: flex;
  gap: 14px;
  padding: 8px 2px 2px;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 0;
  font-size: 12.5px;
  color: var(--text-secondary);
}

.tab.active {
  color: var(--accent);
  font-weight: 600;
}

.tab-count {
  font-size: 10px;
  font-weight: 500;
  color: var(--accent);
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

.avatar {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: var(--avatar-radius);
  background: #d9e2ea;
  color: #4c5a68;
  font-size: 15px;
  font-weight: 500;
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
