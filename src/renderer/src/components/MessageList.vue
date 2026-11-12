<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ChevronDown } from '@lucide/vue'
import type { FileTaskInfo, MessageInfo } from '../../../shared/domain'
import { emotionKeyByUrl } from '../utils/emotion'
import { formatDateDivider } from '../utils/format'
import { walkRichCopy, writeRichCopy, type RichCopyPart } from '../utils/rich-copy'
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
  searching: boolean
  loading: boolean
}>()

const emit = defineEmits<{
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
      files: FileTaskInfo[]
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
  const map = new Map<number, FileTaskInfo[]>()
  for (const file of props.files) {
    if (file.messageId === null) continue
    const list = map.get(file.messageId) ?? []
    if (!list.some((item) => item.id === file.id)) list.push(file)
    map.set(file.messageId, list)
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
      files: filesByMessage.value.get(message.id) ?? []
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
}

function jumpToBottom(): void {
  scrollToBottom()
  emit('read')
}

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
    if (!element) return
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

// 复制选中的聊天内容：文字与图片（含内置表情）按原顺序写入剪贴板
function copyImagePart(image: HTMLImageElement): RichCopyPart | null {
  const src = image.getAttribute('src') ?? ''
  if (src.startsWith('lanpost-file:///')) {
    const id = decodeURIComponent(src.slice('lanpost-file:///'.length))
    const file = props.files.find((item) => item.id === id)
    if (file === undefined || file.path === '') return null
    return {
      kind: 'image',
      path: file.path,
      name: file.name,
      sticker: image.classList.contains('sticker-photo')
    }
  }
  const key = emotionKeyByUrl(src)
  return key === null ? null : { kind: 'emotion', key }
}

function onCopy(event: ClipboardEvent): void {
  const selection = window.getSelection()
  const root = scroller.value
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return
  const range = selection.getRangeAt(0)
  if (root === null || !root.contains(range.commonAncestorContainer)) return
  const holder = document.createElement('div')
  holder.appendChild(range.cloneContents())
  for (const junk of Array.from(
    holder.querySelectorAll('.time, .sender, .meta, .avatar, .date, .unread')
  )) {
    junk.remove()
  }
  writeRichCopy(event, walkRichCopy(holder, copyImagePart))
}
</script>

<template>
  <div class="message-list" @copy="onCopy">
    <div ref="scroller" class="scroller" @scroll="onScroll">
      <div class="stream">
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
            :files="row.files"
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
