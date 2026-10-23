<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { File, FileArchive, FileText, Image } from '@lucide/vue'
import type { FileTaskInfo } from '../../../shared/domain'
import { formatSize, formatSpeed } from '../utils/format'

const props = defineProps<{ file: FileTaskInfo }>()

type Action = 'accept' | 'reject' | 'open' | 'reveal' | 'saveAs'

const busy = ref<Action | ''>('')
const error = ref('')
const speed = ref(0)
let lastReceived = props.file.received
let lastAt = Date.now()

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'])
const ARCHIVE_EXTENSIONS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'])
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'log', 'csv', 'json', 'xml', 'yml', 'yaml'])

const extension = computed(() => {
  const name = props.file.name
  const index = name.lastIndexOf('.')
  return index >= 0 ? name.slice(index + 1).toLowerCase() : ''
})

const icon = computed(() => {
  if (IMAGE_EXTENSIONS.has(extension.value)) return Image
  if (ARCHIVE_EXTENSIONS.has(extension.value)) return FileArchive
  if (TEXT_EXTENSIONS.has(extension.value)) return FileText
  return File
})

const incoming = computed(() => props.file.direction === 'in')
const canReceive = computed(
  () => incoming.value && (props.file.state === 'waiting' || props.file.state === 'offered')
)
const transferring = computed(() => props.file.state === 'transferring')
const done = computed(() => props.file.state === 'done')

const percent = computed(() => {
  if (props.file.size <= 0) return 0
  return Math.min(100, Math.round((props.file.received / props.file.size) * 100))
})

const stateText = computed(() => {
  switch (props.file.state) {
    case 'waiting':
    case 'offered':
      return incoming.value ? '等待接收' : '等待对方接收'
    case 'transferring':
      return incoming.value ? '接收中' : '发送中'
    case 'done':
      return incoming.value ? '已接收' : '已发送'
    case 'rejected':
      return incoming.value ? '已拒绝' : '对方已拒绝'
    case 'failed':
      return '传输失败'
    case 'canceled':
      return '已取消'
    default:
      return props.file.state
  }
})

watch(
  () => props.file.received,
  (received) => {
    const now = Date.now()
    const elapsed = (now - lastAt) / 1000
    if (elapsed >= 0.2 && received > lastReceived) {
      speed.value = (received - lastReceived) / elapsed
    }
    lastReceived = received
    lastAt = now
  }
)

watch(
  () => props.file.state,
  (state) => {
    if (state !== 'transferring') speed.value = 0
    else {
      lastReceived = props.file.received
      lastAt = Date.now()
    }
  }
)

async function run(action: Action, task: () => Promise<void>): Promise<void> {
  if (busy.value) return
  busy.value = action
  error.value = ''
  try {
    await task()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    busy.value = ''
  }
}

function accept(): void {
  void run('accept', () => window.api.files.accept(props.file.id))
}

function reject(): void {
  void run('reject', () => window.api.files.reject(props.file.id))
}

function open(): void {
  void run('open', () => window.api.files.open(props.file.id))
}

function reveal(): void {
  void run('reveal', () => window.api.files.reveal(props.file.id))
}

function saveAs(): void {
  void run('saveAs', () => window.api.files.saveAs(props.file.id))
}
</script>

<template>
  <div class="file-card">
    <div class="file-main">
      <span class="file-icon">
        <component :is="icon" :size="22" :stroke-width="1.6" />
      </span>
      <div class="file-text">
        <p class="file-name" :title="file.name">{{ file.name }}</p>
        <p class="file-meta">
          <span>{{ formatSize(file.size) }}</span>
          <span class="dot">·</span>
          <span>{{ stateText }}</span>
          <template v-if="transferring && percent > 0">
            <span class="dot">·</span>
            <span>{{ percent }}%</span>
          </template>
          <template v-if="transferring && speed > 0">
            <span class="dot">·</span>
            <span>{{ formatSpeed(speed) }}</span>
          </template>
        </p>
      </div>
    </div>

    <div
      v-if="transferring"
      class="progress"
      role="progressbar"
      :aria-valuenow="percent"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <span class="progress-fill" :style="{ width: `${percent}%` }" />
    </div>

    <p v-if="error" class="file-error">{{ error }}</p>

    <div v-if="canReceive || done" class="actions">
      <template v-if="canReceive">
        <button class="action primary" :disabled="busy !== ''" @click="accept">接收</button>
        <button class="action" :disabled="busy !== ''" @click="reject">拒绝</button>
      </template>
      <template v-else-if="done">
        <button class="action" :disabled="busy !== ''" @click="open">打开文件</button>
        <button class="action" :disabled="busy !== ''" @click="reveal">打开文件夹</button>
        <button class="action" :disabled="busy !== ''" @click="saveAs">另存为</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.file-card {
  width: 300px;
  max-width: 100%;
  padding: 10px 12px;
  border-radius: var(--radius-card);
  background: #ffffff;
}

.file-main {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.file-icon {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: var(--radius-button);
  background: #f2f3f5;
  color: #5b6570;
}

.file-text {
  flex: 1;
  min-width: 0;
}

.file-name {
  margin: 1px 0 5px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 13px;
  line-height: 1.4;
  color: var(--text);
  word-break: break-all;
}

.file-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin: 0;
  font-size: 11px;
  color: var(--text-secondary);
}

.dot {
  color: #c9c9c9;
}

.progress {
  height: 4px;
  margin: 10px 0 2px;
  overflow: hidden;
  border-radius: 2px;
  background: #ededed;
}

.progress-fill {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 0.2s ease;
}

.file-error {
  margin: 7px 0 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--danger);
  word-break: break-all;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.action {
  padding: 4px 10px;
  border: 1px solid #e0e0e0;
  border-radius: var(--radius-button);
  font-size: 12px;
  color: #444444;
  background: #ffffff;
}

.action:hover:not(:disabled) {
  border-color: #c9c9c9;
  background: #f7f7f7;
}

.action.primary {
  border-color: var(--accent);
  background: var(--accent);
  color: #ffffff;
}

.action.primary:hover:not(:disabled) {
  border-color: var(--accent-hover);
  background: var(--accent-hover);
}

.action:disabled {
  opacity: 0.55;
}
</style>
