<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { FileText, Locate, Search, X } from '@lucide/vue'
import type { FileTaskInfo, MessageInfo } from '../../../shared/domain'
import type { MessageHistoryCategory } from '../../../shared/ipc'
import { useAppStore } from '../stores/app'
import { formatDateDivider, formatSize, formatClock, previewText } from '../utils/format'
import ImageViewer from './ImageViewer.vue'
import ImageMenu from './ImageMenu.vue'

const props = defineProps<{
  conversationId: string
  title: string
  group: boolean
  files: FileTaskInfo[]
}>()

const emit = defineEmits<{
  close: []
  jump: [messageId: number]
}>()

const store = useAppStore()

const categories: Array<{ id: MessageHistoryCategory; label: string }> = [
  { id: 'message', label: '消息' },
  { id: 'image', label: '图片' },
  { id: 'file', label: '文件' }
]

const PAGE_SIZE = 50

const category = ref<MessageHistoryCategory>('message')
const keywordInput = ref('')
const keyword = ref('')
const results = ref<MessageInfo[]>([])
const total = ref(0)
const page = ref(0)
const newestAt = ref(0)
const oldestAt = ref(0)
const dateInput = ref('')
const loading = ref(false)
const error = ref('')
const viewer = ref<FileTaskInfo | null>(null)
const imageMenu = ref<{ file: FileTaskInfo; message: MessageInfo; x: number; y: number } | null>(
  null
)
const rowMenu = ref<{ message: MessageInfo; x: number; y: number } | null>(null)
// 文件还在不在磁盘上：ready 可以打开，deleted 显示已被删除
const fileState = ref<Record<string, 'ready' | 'deleted' | 'unknown'>>({})
let searchTimer: ReturnType<typeof setTimeout> | undefined
// 关键字连续输入时会有多次请求，只有最后一次算数
let requestSeq = 0

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const dateMin = computed(() => toDateInput(oldestAt.value))
const dateMax = computed(() => toDateInput(newestAt.value))

function toDateInput(timestamp: number): string {
  if (timestamp <= 0) return ''
  const date = new Date(timestamp)
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

// 分页取一页；给日期时由服务端算出该落在第几页
async function load(
  options: { offset?: number; dateFrom?: number; dateTo?: number } = {}
): Promise<void> {
  const requestId = ++requestSeq
  loading.value = true
  error.value = ''
  try {
    const result = await window.api.messages.search({
      conversationId: props.conversationId,
      category: category.value,
      query: keyword.value,
      offset: options.offset ?? page.value * PAGE_SIZE,
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
      limit: PAGE_SIZE
    })
    if (requestId !== requestSeq) return
    results.value = result.messages
    total.value = result.total
    newestAt.value = result.newestAt
    oldestAt.value = result.oldestAt
    page.value = Math.round(result.offset / PAGE_SIZE)
    await resolveFileStates(result.messages)
  } catch (reason) {
    if (requestId !== requestSeq) return
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    if (requestId === requestSeq) loading.value = false
  }
}

// 文件消息逐个确认磁盘上还在不在，只有能打开的才给按钮
async function resolveFileStates(list: MessageInfo[]): Promise<void> {
  if (category.value !== 'file') return
  for (const message of list) {
    for (const file of filesOf(message)) {
      if (fileState.value[file.id] !== undefined) continue
      let state: 'ready' | 'deleted' | 'unknown'
      if (file.path === '') state = file.state === 'missing' ? 'deleted' : 'unknown'
      else state = (await window.api.files.exists(file.path)) ? 'ready' : 'deleted'
      fileState.value = { ...fileState.value, [file.id]: state }
    }
  }
}

function stateOf(file: FileTaskInfo): 'ready' | 'deleted' | 'unknown' {
  return fileState.value[file.id] ?? 'unknown'
}

function openRowFile(row: HistoryRow, which: 'file' | 'folder'): void {
  const file = row.file
  if (file === null) return
  const action =
    which === 'file' ? window.api.files.open(file.id) : window.api.files.reveal(file.id)
  void action.catch((reason) => store.reportError(String(reason)))
}

watch(keywordInput, (value) => {
  if (searchTimer !== undefined) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    keyword.value = value.trim()
    page.value = 0
    void load()
  }, 300)
})

watch(category, () => {
  fileState.value = {}
  page.value = 0
  void load()
})

onMounted(() => {
  void load()
})

function goPage(delta: number): void {
  const next = page.value + delta
  if (loading.value || next < 0 || next >= pageCount.value) return
  page.value = next
  void load()
}

function jumpToDate(): void {
  if (dateInput.value === '') return
  const day = new Date(`${dateInput.value}T00:00:00`)
  if (Number.isNaN(day.getTime())) return
  // 结束取本地时间的下一天零点，跨夏令时也不会差一小时
  const from = day.getTime()
  const to = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime()
  void load({ offset: 0, dateFrom: from, dateTo: to })
}

onBeforeUnmount(() => {
  if (searchTimer !== undefined) clearTimeout(searchTimer)
})

function imagesOf(message: MessageInfo): FileTaskInfo[] {
  let meta: Record<string, unknown>
  try {
    meta = JSON.parse(message.meta) as Record<string, unknown>
  } catch {
    return []
  }
  const segments = Array.isArray(meta.segments) ? meta.segments : []
  const found: FileTaskInfo[] = []
  for (const item of segments) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    if (record.kind !== 'image' || typeof record.value !== 'string') continue
    const fileId = record.value.split('|')[0]
    const file = props.files.find((task) => task.fileId === fileId)
    if (file !== undefined) found.push(file)
  }
  return found
}

function filesOf(message: MessageInfo): FileTaskInfo[] {
  return props.files.filter((task) => task.messageId === message.id)
}

function thumbUrl(file: FileTaskInfo): string {
  return `lanpost-file:///${encodeURIComponent(file.id)}`
}

function dayKey(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

interface HistoryRow {
  message: MessageInfo
  images: FileTaskInfo[]
  file: FileTaskInfo | null
  day: string
  sender: string
}

// 群消息按 meta.senderId 找发送者名字，私聊只标我/对方
function senderOf(message: MessageInfo): string {
  if (message.direction === 'out') return '我'
  if (!props.group) return '对方'
  try {
    const meta = JSON.parse(message.meta) as Record<string, unknown>
    if (typeof meta.senderId === 'string') {
      const peer = store.peers.find((item) => item.privateUserId === meta.senderId)
      if (peer !== undefined && peer.name !== '') return peer.name
      if (meta.senderName !== undefined && typeof meta.senderName === 'string') {
        return meta.senderName
      }
    }
  } catch {
    // meta 解析失败就退回“对方”
  }
  return '对方'
}

const rows = computed<HistoryRow[]>(() =>
  results.value.map((message) => ({
    message,
    images: category.value === 'image' ? imagesOf(message) : [],
    file: category.value === 'file' ? (filesOf(message)[0] ?? null) : null,
    day: dayKey(message.createdAt),
    sender: senderOf(message)
  }))
)

const emptyText = computed(() => {
  if (loading.value && results.value.length === 0) return '正在搜索…'
  if (keyword.value !== '') return '没有匹配的消息'
  if (category.value === 'image') return '还没有图片'
  if (category.value === 'file') return '还没有文件'
  return '还没有消息'
})

// 右键菜单：图片走聊天窗口那套 ImageMenu，文字与文件用这个
const MENU_WIDTH = 160

const rowMenuStyle = computed(() => {
  if (rowMenu.value === null) return {}
  const menu = rowMenu.value
  return {
    left: `${Math.max(8, Math.min(menu.x, window.innerWidth - MENU_WIDTH - 8))}px`,
    top: `${Math.max(8, Math.min(menu.y, window.innerHeight - 90 - 8))}px`
  }
})

function openRowMenu(row: HistoryRow, event: MouseEvent): void {
  rowMenu.value = { message: row.message, x: event.clientX, y: event.clientY }
}

function locateFromRowMenu(): void {
  const menu = rowMenu.value
  rowMenu.value = null
  if (menu !== null) emit('jump', menu.message.id)
}

function openImageMenu(row: HistoryRow, file: FileTaskInfo, event: MouseEvent): void {
  event.preventDefault()
  event.stopPropagation()
  imageMenu.value = { file, message: row.message, x: event.clientX, y: event.clientY }
}

function locateFromImageMenu(): void {
  const menu = imageMenu.value
  if (menu !== null) emit('jump', menu.message.id)
  imageMenu.value = null
}
</script>

<template>
  <div class="history-mask" @mousedown.self="emit('close')">
    <div
      class="history-dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="`聊天记录 · ${props.title}`"
    >
      <header class="history-head">
        <h2>
          聊天记录
          <span class="peer">{{ props.title }}</span>
        </h2>
        <button class="history-close" title="关闭" @click="emit('close')">
          <X :size="16" />
        </button>
      </header>

      <div class="history-tools">
        <div class="history-search">
          <Search :size="14" :stroke-width="1.8" />
          <input
            v-model="keywordInput"
            type="text"
            placeholder="搜索消息、文件名"
            autocomplete="off"
            spellcheck="false"
            aria-label="搜索聊天记录"
          />
          <button v-if="keywordInput" class="clear" title="清空搜索" @click="keywordInput = ''">
            <X :size="12" />
          </button>
        </div>

        <div class="history-tabs" role="tablist" aria-label="消息分类">
          <button
            v-for="item in categories"
            :key="item.id"
            role="tab"
            :aria-selected="category === item.id"
            :class="{ active: category === item.id }"
            @click="category = item.id"
          >
            {{ item.label }}
          </button>
        </div>
      </div>

      <div class="history-body">
        <p v-if="error" class="history-error">{{ error }}</p>

        <template v-else>
          <template v-for="(row, index) in rows" :key="row.message.id">
            <div v-if="index === 0 || rows[index - 1].day !== row.day" class="history-date">
              <span>{{ formatDateDivider(row.message.createdAt) }}</span>
            </div>

            <div
              class="history-item"
              :data-message-id="row.message.id"
              @contextmenu.prevent="openRowMenu(row, $event)"
            >
              <span class="history-meta">
                <span class="history-time">{{ formatClock(row.message.createdAt) }}</span>
                <span class="history-sender">{{ row.sender }}</span>
              </span>

              <span v-if="category === 'image'" class="history-thumbs">
                <img
                  v-for="file in row.images"
                  :key="file.id"
                  :src="thumbUrl(file)"
                  :alt="file.name"
                  loading="lazy"
                  title="查看大图"
                  @click="viewer = file"
                  @contextmenu="openImageMenu(row, file, $event)"
                />
                <span v-if="row.images.length === 0" class="thumb-empty">图片已删除</span>
              </span>

              <span v-else-if="category === 'file'" class="history-file">
                <FileText :size="14" :stroke-width="1.8" />
                <span class="history-text">{{ row.message.text || '文件' }}</span>
                <template v-if="row.file !== null">
                  <span class="history-size">{{ formatSize(row.file.size) }}</span>
                  <span v-if="stateOf(row.file) === 'deleted'" class="history-deleted">
                    已被删除
                  </span>
                  <span v-else-if="stateOf(row.file) === 'ready'" class="history-actions">
                    <button class="history-action" @click.stop="openRowFile(row, 'file')">
                      打开文件
                    </button>
                    <button class="history-action" @click.stop="openRowFile(row, 'folder')">
                      打开文件夹
                    </button>
                  </span>
                </template>
              </span>

              <span v-else class="history-text">{{ previewText(row.message) }}</span>
            </div>
          </template>

          <p v-if="rows.length === 0 && !loading" class="history-empty">{{ emptyText }}</p>

          <div class="history-foot">
            <button class="history-page" :disabled="page === 0 || loading" @click="goPage(-1)">
              上一页
            </button>
            <span class="history-page-info">
              第 {{ page + 1 }} / {{ pageCount }} 页 · 共 {{ total }} 条
            </span>
            <button
              class="history-page"
              :disabled="page + 1 >= pageCount || loading"
              @click="goPage(1)"
            >
              下一页
            </button>
            <input
              v-model="dateInput"
              class="history-jump-date"
              type="date"
              :min="dateMin"
              :max="dateMax"
              aria-label="按日期跳转"
              @change="jumpToDate"
            />
          </div>
        </template>
      </div>

      <div
        v-if="rowMenu !== null"
        class="history-menu-layer"
        @click="rowMenu = null"
        @contextmenu.prevent="rowMenu = null"
      >
        <div class="history-menu" role="menu" :style="rowMenuStyle" @click.stop>
          <button class="history-menu-item" role="menuitem" @click="locateFromRowMenu">
            <Locate :size="14" :stroke-width="1.8" />
            <span>定位到原消息</span>
          </button>
        </div>
      </div>

      <ImageMenu
        v-if="imageMenu !== null"
        :file="imageMenu.file"
        :x="imageMenu.x"
        :y="imageMenu.y"
        show-locate
        @close="imageMenu = null"
        @locate="locateFromImageMenu"
      />

      <ImageViewer v-if="viewer !== null" :file="viewer" @close="viewer = null" />
    </div>
  </div>
</template>

<style scoped>
.history-mask {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  background: rgba(20, 24, 28, 0.42);
}

.history-dialog {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 560px;
  max-width: calc(100vw - 48px);
  height: 620px;
  max-height: calc(100vh - 96px);
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.22);
  overflow: hidden;
}

.history-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 6px;
}

.history-head h2 {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}

.history-head .peer {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-secondary);
}

.history-close {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-faint);
}

.history-close:hover {
  background: #f1f2f4;
  color: var(--text);
}

.history-tools {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 16px 12px;
  border-bottom: 1px solid var(--divider);
}

.history-search {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 8px;
  border-radius: var(--radius-button);
  background: #e9e9e9;
  color: var(--text-muted);
}

.history-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  font-size: 12.5px;
  color: var(--text);
}

.history-search .clear {
  display: grid;
  place-items: center;
  width: 15px;
  height: 15px;
  border: 0;
  border-radius: 50%;
  background: #c8c8c8;
  color: #ffffff;
}

.history-search .clear:hover {
  background: #adadad;
}

.history-tabs {
  display: flex;
  gap: 4px;
}

.history-tabs button {
  height: 26px;
  padding: 0 12px;
  border: 1px solid var(--divider);
  border-radius: var(--radius-button);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
}

.history-tabs button:hover {
  color: var(--text);
}

.history-tabs button.active {
  border-color: var(--accent);
  background: var(--accent);
  color: #ffffff;
}

.history-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 8px 14px;
}

.history-date {
  display: flex;
  justify-content: center;
  margin: 8px 0 10px;
}

.history-date span {
  padding: 1px 6px;
  border-radius: 3px;
  background: #dedede;
  color: #ffffff;
  font-size: 11px;
  line-height: 16px;
}

.history-item {
  display: block;
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  cursor: default;
  user-select: text;
}

.history-item:hover {
  background: var(--hover);
}

.history-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.history-time {
  font-size: 11px;
  color: var(--text-muted);
}

.history-sender {
  font-size: 11.5px;
  color: var(--text-secondary);
}

.history-text {
  display: block;
  font-size: 12.5px;
  color: var(--text);
  word-break: break-word;
}

.history-thumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.history-thumbs img {
  width: 96px;
  height: 96px;
  border-radius: 6px;
  background: #f0f0f0;
  object-fit: cover;
  cursor: zoom-in;
  user-select: none;
}

.thumb-empty {
  font-size: 12px;
  color: var(--text-muted);
}

.history-file {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
}

.history-file .history-text {
  flex: 1;
  min-width: 0;
}

.history-size {
  font-size: 11.5px;
  color: var(--text-muted);
}

.history-deleted {
  font-size: 11.5px;
  color: var(--text-muted);
}

.history-actions {
  display: inline-flex;
  gap: 6px;
}

.history-action {
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--divider);
  border-radius: var(--radius-button);
  background: transparent;
  color: var(--text-secondary);
  font-size: 11.5px;
}

.history-action:hover {
  border-color: var(--text-muted);
  color: var(--text);
}

.history-empty,
.history-error {
  margin: 48px 12px;
  text-align: center;
  font-size: 12.5px;
  color: var(--text-muted);
}

.history-error {
  color: #c0392b;
}

.history-foot {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 0 4px;
}

.history-page {
  height: 26px;
  padding: 0 12px;
  border: 1px solid var(--divider);
  border-radius: var(--radius-button);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
}

.history-page:hover:not(:disabled) {
  border-color: var(--text-muted);
  color: var(--text);
}

.history-page:disabled {
  opacity: 0.45;
}

.history-page-info {
  font-size: 11.5px;
  color: var(--text-muted);
  white-space: nowrap;
}

.history-jump-date {
  height: 26px;
  padding: 0 6px;
  border: 1px solid var(--divider);
  border-radius: var(--radius-button);
  background: #ffffff;
  color: var(--text-secondary);
  font-size: 12px;
}

.history-menu-layer {
  position: fixed;
  inset: 0;
  z-index: 80;
}

.history-menu {
  position: fixed;
  display: flex;
  flex-direction: column;
  width: 160px;
  padding: 4px;
  border-radius: 6px;
  background: #ffffff;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
}

.history-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border-radius: 4px;
  color: var(--text);
  font-size: 12.5px;
  text-align: left;
}

.history-menu-item:hover {
  background: var(--hover);
}
</style>
