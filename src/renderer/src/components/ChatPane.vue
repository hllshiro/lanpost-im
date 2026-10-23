<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { onClickOutside, useEventListener } from '@vueuse/core'
import { Ellipsis, MessageCircle, Search, VolumeX, X } from '@lucide/vue'
import type {
  ConversationInfo,
  FileTaskInfo,
  LocalInfo,
  MessageInfo,
  PeerInfo
} from '../../../shared/domain'
import { initialOf } from '../utils/format'
import Composer from './Composer.vue'
import MessageList from './MessageList.vue'

const props = defineProps<{
  conversation: ConversationInfo | null
  peer: PeerInfo | null
  messages: MessageInfo[]
  files: FileTaskInfo[]
  local: LocalInfo | null
  loadingMessages: boolean
  hasMore: boolean
  sending: boolean
  unreadAfterId: number
}>()

const emit = defineEmits<{
  send: [text: string]
  draft: [value: string]
  read: []
  loadMore: [beforeId: number]
}>()

const search = ref('')
const infoOpen = ref(false)
const infoAnchor = ref<HTMLElement | null>(null)
const copied = ref(false)
const copyError = ref('')
let copyTimer: number | undefined

const keyword = computed(() => search.value.trim().toLowerCase())

const presence = computed(() => {
  if (!props.conversation) return ''
  if (props.conversation.kind === 'group') return '群聊'
  if (!props.peer || !props.peer.online) return '离线'
  if (props.peer.status === 1) return '忙碌'
  if (props.peer.status === 2) return '离开'
  return '在线'
})

const presenceClass = computed(() => {
  if (!props.peer?.online) return 'offline'
  if (props.peer.status === 1) return 'busy'
  if (props.peer.status === 2) return 'away'
  return 'online'
})

const filteredMessages = computed(() => {
  if (!keyword.value) return props.messages
  return props.messages.filter((message) => message.text.toLowerCase().includes(keyword.value))
})

const ownInitial = computed(() => initialOf(props.local?.name ?? '我'))
const otherInitial = computed(() => initialOf(props.conversation?.title ?? ''))

const showSearchSummary = computed(() => keyword.value.length > 0)

onClickOutside(infoAnchor, () => {
  infoOpen.value = false
})

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return
  if (infoOpen.value) infoOpen.value = false
  else if (search.value) search.value = ''
})

watch(
  () => props.conversation?.id,
  () => {
    search.value = ''
    infoOpen.value = false
    copied.value = false
    copyError.value = ''
  }
)

function handleLoadMore(beforeId: number): void {
  emit('loadMore', beforeId)
}

function handleDraft(value: string): void {
  emit('draft', value)
}

function handleSend(text: string): void {
  emit('send', text)
}

async function copyAddress(): Promise<void> {
  if (!props.peer) return
  copyError.value = ''
  try {
    await navigator.clipboard.writeText(`${props.peer.ip}:${props.peer.port}`)
    copied.value = true
    if (copyTimer !== undefined) window.clearTimeout(copyTimer)
    copyTimer = window.setTimeout(() => {
      copied.value = false
    }, 1500)
  } catch (reason) {
    copyError.value = reason instanceof Error ? reason.message : String(reason)
  }
}

onBeforeUnmount(() => {
  if (copyTimer !== undefined) window.clearTimeout(copyTimer)
})
</script>

<template>
  <section class="chat" aria-label="聊天区">
    <template v-if="conversation">
      <header class="chat-head">
        <div class="title-block">
          <div class="title-line">
            <h2 :title="conversation.title">{{ conversation.title }}</h2>
            <VolumeX
              v-if="conversation.muted"
              class="muted"
              :size="14"
              :stroke-width="1.8"
              title="本会话已静音"
            />
          </div>
          <div class="presence">
            <span class="dot" :class="presenceClass" />
            <span>{{ presence }}</span>
          </div>
        </div>

        <div class="head-actions">
          <div class="search" :class="{ active: keyword.length > 0 }">
            <Search :size="14" :stroke-width="1.8" />
            <input
              v-model="search"
              type="text"
              placeholder="搜索"
              autocomplete="off"
              aria-label="搜索聊天记录"
            />
            <button v-if="search" class="clear" title="清空搜索" @click="search = ''">
              <X :size="12" />
            </button>
          </div>

          <div ref="infoAnchor" class="info-anchor">
            <button
              class="icon-btn"
              :class="{ active: infoOpen }"
              title="聊天信息"
              aria-label="聊天信息"
              @click="infoOpen = !infoOpen"
            >
              <Ellipsis :size="18" :stroke-width="1.9" />
            </button>

            <div v-if="infoOpen" class="info-popover" role="dialog" aria-label="聊天信息">
              <header class="info-head">
                <span>聊天信息</span>
                <button class="info-close" title="关闭" @click="infoOpen = false">
                  <X :size="13" />
                </button>
              </header>
              <dl class="info-body">
                <div v-if="conversation.kind === 'direct'" class="info-row">
                  <dt>账号</dt>
                  <dd>{{ peer?.user || '未知' }}</dd>
                </div>
                <div class="info-row">
                  <dt>状态</dt>
                  <dd>{{ presence }}</dd>
                </div>
                <div v-if="peer" class="info-row">
                  <dt>地址</dt>
                  <dd class="address">
                    <span>{{ peer.ip }}:{{ peer.port }}</span>
                    <button class="copy" @click="copyAddress">
                      {{ copied ? '已复制' : '复制' }}
                    </button>
                  </dd>
                </div>
                <div v-if="peer" class="info-row">
                  <dt>部门</dt>
                  <dd>{{ peer.department || '未填写' }}</dd>
                </div>
                <div v-if="peer" class="info-row">
                  <dt>分组</dt>
                  <dd>{{ peer.group || '未填写' }}</dd>
                </div>
                <div v-if="peer" class="info-row">
                  <dt>签名</dt>
                  <dd class="sign">{{ peer.sign || '未填写' }}</dd>
                </div>
                <div class="info-row">
                  <dt>本会话文件</dt>
                  <dd>{{ files.length }} 个</dd>
                </div>
              </dl>
              <p v-if="copyError" class="copy-error">{{ copyError }}</p>
            </div>
          </div>
        </div>
      </header>

      <div class="chat-body">
        <div v-if="showSearchSummary" class="search-summary">
          <span>找到 {{ filteredMessages.length }} 条消息</span>
          <button @click="search = ''">退出搜索</button>
        </div>

        <MessageList
          :messages="filteredMessages"
          :files="files"
          :conversation-id="conversation.id"
          :own-initial="ownInitial"
          :other-initial="otherInitial"
          :unread-after-id="keyword.length > 0 ? 0 : unreadAfterId"
          :has-more="hasMore"
          :loading-more="loadingMessages"
          :searching="keyword.length > 0"
          :loading="loadingMessages"
          @load-more="handleLoadMore"
          @read="emit('read')"
        />
      </div>

      <Composer
        :draft="conversation.draft"
        :sending="sending"
        :conversation-title="conversation.title"
        :conversation-id="conversation.id"
        @update:draft="handleDraft"
        @send="handleSend"
      />
    </template>

    <div v-else class="chat-empty">
      <span class="empty-icon">
        <MessageCircle :size="42" :stroke-width="1.2" />
      </span>
      <p>选择一个会话开始聊天</p>
      <small>从左侧会话列表中选择联系人</small>
    </div>
  </section>
</template>

<style scoped>
.chat {
  position: relative;
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--page-bg);
}

.chat-head {
  position: relative;
  flex: 0 0 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 16px;
  border-bottom: 1px solid var(--divider);
  background: var(--page-bg);
}

.title-block {
  min-width: 0;
}

.title-line {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

h2 {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}

.muted {
  flex: 0 0 auto;
  color: var(--text-muted);
}

.presence {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-secondary);
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #b8b8b8;
}

.dot.online {
  background: var(--accent);
}

.dot.busy {
  background: var(--warning);
}

.dot.away {
  background: #d9c04a;
}

.dot.offline {
  background: #b8b8b8;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.search {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 168px;
  height: 27px;
  padding: 0 7px;
  border-radius: var(--radius-button);
  background: #e9e9e9;
  color: var(--text-muted);
}

.search.active {
  background: #ffffff;
  box-shadow: inset 0 0 0 1px rgba(7, 193, 96, 0.45);
}

.search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  font-size: 12px;
  color: var(--text);
}

.clear {
  display: grid;
  place-items: center;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: #c8c8c8;
  color: #ffffff;
}

.clear:hover {
  background: #adadad;
}

.info-anchor {
  position: relative;
}

.icon-btn {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-button);
  color: #5a5a5a;
}

.icon-btn:hover,
.icon-btn.active {
  background: #e7e7e7;
}

.info-popover {
  position: absolute;
  top: 34px;
  right: 0;
  z-index: 20;
  width: 268px;
  border: 1px solid #e2e2e2;
  border-radius: var(--radius-card);
  background: #ffffff;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.14);
}

.info-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 38px;
  padding: 0 12px;
  border-bottom: 1px solid var(--divider);
  font-size: 13px;
  font-weight: 600;
}

.info-close {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  color: var(--text-secondary);
}

.info-close:hover {
  background: var(--hover);
}

.info-body {
  margin: 0;
  padding: 8px 12px 10px;
}

.info-row {
  display: flex;
  gap: 12px;
  padding: 4px 0;
  font-size: 12px;
  line-height: 1.5;
}

.info-row dt {
  flex: 0 0 62px;
  color: var(--text-secondary);
}

.info-row dd {
  flex: 1;
  min-width: 0;
  margin: 0;
  color: var(--text);
  word-break: break-word;
}

.address {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.copy {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--accent);
}

.copy:hover {
  text-decoration: underline;
}

.sign {
  white-space: pre-wrap;
}

.copy-error {
  margin: 0;
  padding: 0 12px 10px;
  font-size: 11px;
  color: var(--danger);
}

.chat-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.search-summary {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 20px;
  border-bottom: 1px solid var(--divider);
  background: #f0f0f0;
  font-size: 11.5px;
  color: var(--text-secondary);
}

.search-summary button {
  font-size: 11.5px;
  color: var(--accent);
}

.chat-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--text-muted);
  user-select: none;
}

.empty-icon {
  display: grid;
  place-items: center;
  width: 72px;
  height: 72px;
  margin-bottom: 6px;
  border-radius: 18px;
  background: #ededed;
  color: #b9b9b9;
}

.chat-empty p {
  margin: 0;
  font-size: 14px;
  color: #8f8f8f;
}

.chat-empty small {
  font-size: 12px;
  color: var(--text-muted);
}
</style>
