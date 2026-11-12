<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ChevronDown } from '@lucide/vue'
import type { FileTaskInfo, MessageInfo } from '../../../shared/domain'
import { formatDateDivider } from '../utils/format'
import ImageMenu from './ImageMenu.vue'
import ImageViewer from './ImageViewer.vue'
import MessageBubble from './MessageBubble.vue'

const props = defineProps<{
  messages: MessageInfo[]
  files: FileTaskInfo[]
  conversationId: string
  ownInitial: string
  otherInitial: string
  unreadAfterId: number
  hasMore: boolean
  hasNewer: boolean
  loadingMore: boolean
  searching: boolean
  loading: boolean
}>()

const emit = defineEmits<{
  loadMore: [beforeId: number]
  loadNewer: []
  read: []
}>()

type Row =
  | { type: 'date'; key: string; label: string }
  | { type: 'unread'; key: string }
  | {
      type: 'message'
      key: string
      message: MessageInfo
      own: boolean
      showTime: boolean
      file: FileTaskInfo | null
    }

const scroller = ref<HTMLElement | null>(null)
const atBottom = ref(true)
const newBelow = ref(0)

// 单击图片放大查看，右键出图片菜单
const viewer = ref<FileTaskInfo | null>(null)
const menu = ref<{ file: FileTaskInfo; x: number; y: number } | null>(null)

function openViewer(file: FileTaskInfo): void {
  menu.value = null
  viewer.value = file
}

function openMenu(file: FileTaskInfo, event: MouseEvent): void {
  menu.value = { file, x: event.clientX, y: event.clientY }
}

const filesByMessage = computed(() => {
  const map = new Map<number, FileTaskInfo>()
  for (const file of props.files) {
    if (file.messageId === null) continue
    const current = map.get(file.messageId)
    if (!current || file.updatedAt >= current.updatedAt) map.set(file.messageId, file)
  }
  return map
})

function dayKey(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

function minuteKey(timestamp: number): string {
  const date = new Date(timestamp)
  return `${dayKey(timestamp)} ${date.getHours()}:${date.getMinutes()}`
}

const rows = computed<Row[]>(() => {
  const result: Row[] = []
  let previous: MessageInfo | null = null
  let day = ''
  let unreadPlaced = false
  for (const message of props.messages) {
    const currentDay = dayKey(message.createdAt)
    if (currentDay !== day) {
      day = currentDay
      result.push({
        type: 'date',
        key: `date-${currentDay}`,
        label: formatDateDivider(message.createdAt)
      })
    }
    if (!unreadPlaced && props.unreadAfterId > 0 && message.id > props.unreadAfterId) {
      result.push({ type: 'unread', key: 'unread' })
      unreadPlaced = true
    }
    result.push({
      type: 'message',
      key: `m-${message.id}`,
      message,
      own: message.direction === 'out',
      showTime: previous === null || minuteKey(previous.createdAt) !== minuteKey(message.createdAt),
      file: filesByMessage.value.get(message.id) ?? null
    })
    previous = message
  }
  return result
})

function isNearBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 80
}

function scrollToBottom(): void {
  const element = scroller.value
  if (!element) return
  ignoreScroll = true
  element.scrollTop = element.scrollHeight
  atBottom.value = true
  newBelow.value = 0
}

function onScroll(): void {
  const element = scroller.value
  if (!element) return
  const bottom = isNearBottom(element)
  if (bottom && !atBottom.value) emit('read')
  atBottom.value = bottom
  if (bottom) newBelow.value = 0
  // 刚由代码调整过滚动位置，这次事件不触发补页，避免一补页就来回弹
  if (ignoreScroll) {
    ignoreScroll = false
    return
  }
  // 翻到顶部附近就动态向前补一页，旧消息不会一次性全读出来
  if (element.scrollTop < 120 && props.hasMore && !props.loadingMore && props.messages.length > 0) {
    requestOlder()
  }
  // 往回翻到底部附近时，把之前为控内存裁掉的新消息补回来
  if (props.hasNewer && !props.loadingMore && bottom && props.messages.length > 0) {
    requestNewer()
  }
}

function jumpToBottom(): void {
  scrollToBottom()
  emit('read')
}

const requestedOlder = ref(false)
const requestedNewer = ref(false)
let anchorElement: HTMLElement | null = null
let anchorTop = 0
let anchorDirection: 'older' | 'newer' = 'older'
let ignoreScroll = false

// 补页前后以某个消息为锚点，保证眼下的内容不会跳
function setAnchor(element: Element | null, direction: 'older' | 'newer'): void {
  anchorElement = element instanceof HTMLElement ? element : null
  anchorTop = anchorElement?.offsetTop ?? 0
  anchorDirection = direction
}

function restoreAnchor(): void {
  const scrollerElement = scroller.value
  if (scrollerElement === null || anchorElement === null) return
  ignoreScroll = true
  // 窗口只有一页时锚点可能正好被裁掉，这时把刚补上的一页滚进视野
  if (!scrollerElement.contains(anchorElement)) {
    scrollerElement.scrollTop = anchorDirection === 'older' ? scrollerElement.scrollHeight : 0
    anchorElement = null
    return
  }
  const delta = anchorElement.offsetTop - anchorTop
  if (delta !== 0) scrollerElement.scrollTop += delta
  anchorElement = null
}

function requestOlder(): void {
  const element = scroller.value
  const first = props.messages[0]
  if (!element || !first || props.loadingMore || requestedOlder.value) return
  requestedOlder.value = true
  setAnchor(element.querySelector('.message'), 'older')
  emit('loadMore', first.id)
}

// 向下补页时窗口会裁掉顶部的一部分，同样用锚点补偿滚动位置
function requestNewer(): void {
  const element = scroller.value
  if (!element || props.loadingMore || requestedNewer.value) return
  requestedNewer.value = true
  const items = element.querySelectorAll('.message')
  setAnchor(items.length > 0 ? items[items.length - 1] : null, 'newer')
  emit('loadNewer')
}

watch(
  () => props.loadingMore,
  async (loading) => {
    if (loading) return
    requestedOlder.value = false
    requestedNewer.value = false
    await nextTick()
    restoreAnchor()
  }
)

watch(
  () => props.conversationId,
  async () => {
    newBelow.value = 0
    atBottom.value = true
    viewer.value = null
    menu.value = null
    await nextTick()
    scrollToBottom()
  }
)

watch(
  () => props.messages.length,
  async (length, previousLength) => {
    await nextTick()
    const element = scroller.value
    if (!element || requestedOlder.value || requestedNewer.value) return
    if (props.searching) return
    const grew = length > (previousLength ?? 0)
    if (!grew) return
    const last = props.messages[props.messages.length - 1]
    if (atBottom.value || last?.direction === 'out') scrollToBottom()
    else newBelow.value += length - (previousLength ?? 0)
  }
)

watch(
  () => props.searching,
  async (searching) => {
    await nextTick()
    newBelow.value = 0
    atBottom.value = true
    if (searching) {
      const element = scroller.value
      if (element) element.scrollTop = 0
    } else {
      scrollToBottom()
    }
  }
)

onMounted(async () => {
  await nextTick()
  scrollToBottom()
})
</script>

<template>
  <div class="message-list">
    <div ref="scroller" class="scroller" @scroll="onScroll">
      <div class="stream">
        <div v-if="hasMore || loadingMore" class="older">
          <button v-if="!loadingMore" :disabled="loadingMore" @click="requestOlder">
            查看更早的消息
          </button>
          <span v-else class="older-loading">正在加载更早的消息…</span>
        </div>

        <template v-for="row in rows" :key="row.key">
          <div v-if="row.type === 'date'" class="date">
            <span>{{ row.label }}</span>
          </div>
          <div v-else-if="row.type === 'unread'" class="unread">
            <span>以下是新消息</span>
          </div>
          <MessageBubble
            v-else
            :message="row.message"
            :own="row.own"
            :show-time="row.showTime"
            :file="row.file"
            :own-initial="ownInitial"
            :other-initial="otherInitial"
            @preview="openViewer"
            @menu="openMenu"
          />
        </template>

        <div v-if="messages.length === 0" class="empty">
          <p v-if="loading">正在加载消息…</p>
          <p v-else-if="searching">没有找到匹配的消息</p>
          <p v-else>暂无消息，发送第一条消息吧</p>
        </div>
      </div>
    </div>

    <button v-if="newBelow > 0" class="jump" @click="jumpToBottom">
      有新消息<span v-if="newBelow > 1"> {{ newBelow }}</span>
      <ChevronDown :size="13" :stroke-width="2" />
    </button>

    <ImageViewer v-if="viewer" :file="viewer" @close="viewer = null" />
    <ImageMenu v-if="menu" :file="menu.file" :x="menu.x" :y="menu.y" @close="menu = null" />
  </div>
</template>

<style scoped>
.message-list {
  position: relative;
  flex: 1;
  min-height: 0;
}

.scroller {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
}

.stream {
  padding: 16px 20px 10px;
}

.older {
  display: flex;
  justify-content: center;
  padding: 2px 0 12px;
}

.older button {
  padding: 3px 10px;
  border-radius: 10px;
  font-size: 11px;
  color: var(--text-secondary);
  background: rgba(255, 255, 255, 0.7);
}

.older button:hover:not(:disabled) {
  color: var(--accent);
}

.older button:disabled {
  color: var(--text-muted);
}

.older-loading {
  font-size: 11px;
  color: var(--text-muted);
}

.date {
  display: flex;
  justify-content: center;
  margin: 6px 0 14px;
}

.date span {
  padding: 1px 6px;
  border-radius: 3px;
  background: #dedede;
  color: #ffffff;
  font-size: 11px;
  line-height: 16px;
}

.unread {
  display: flex;
  align-items: center;
  margin: 2px 0 14px;
}

.unread::before,
.unread::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #dedede;
}

.unread span {
  padding: 0 10px;
  font-size: 11px;
  color: var(--text-secondary);
}

.empty {
  display: flex;
  justify-content: center;
  padding: 80px 20px;
  color: var(--text-muted);
  font-size: 12.5px;
}

.jump {
  position: absolute;
  right: 20px;
  bottom: 14px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.14);
  color: var(--accent);
  font-size: 12px;
}

.jump:hover {
  background: #f8f8f8;
}
</style>
