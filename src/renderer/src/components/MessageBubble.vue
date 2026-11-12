<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, CheckCheck, CircleAlert, FileText, Folder, LoaderCircle } from '@lucide/vue'
import type { FileTaskInfo, MessageInfo } from '../../../shared/domain'
import { formatClock, formatSize, statusLabel } from '../utils/format'
import { errorMessage } from '../utils/errors'
import { useAppStore } from '../stores/app'
import FileCard from './FileCard.vue'

const props = defineProps<{
  message: MessageInfo
  own: boolean
  showTime: boolean
  file: FileTaskInfo | null
  ownInitial: string
  otherInitial: string
}>()

const store = useAppStore()

const statusIcon = computed(() => {
  switch (props.message.status) {
    case 'sending':
      return LoaderCircle
    case 'failed':
      return CircleAlert
    case 'delivered':
    case 'read':
      return CheckCheck
    default:
      return Check
  }
})

const statusClass = computed(() => {
  if (props.message.status === 'failed') return 'failed'
  if (props.message.status === 'read') return 'read'
  return ''
})

const emit = defineEmits<{
  preview: [file: FileTaskInfo]
  menu: [file: FileTaskInfo, event: MouseEvent]
}>()

function previewImage(): void {
  if (props.file !== null) emit('preview', props.file)
}

function openImageMenu(event: MouseEvent): void {
  if (props.file !== null) emit('menu', props.file, event)
}

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|bmp|webp|avif|tiff?)$/i

const imageUrl = computed(() => {
  const file = props.file
  if (file === null || !IMAGE_EXTENSIONS.test(file.name)) {
    return ''
  }
  // 自己发的图片本地就有原图，立刻显示；收到的要等文件落盘完成
  if (file.direction === 'out' || file.state === 'done') {
    return `lanpost-file:///${encodeURIComponent(file.id)}`
  }
  return ''
})

const imageBroken = ref(false)
watch(
  () => props.file?.id,
  () => {
    imageBroken.value = false
  }
)

const showImage = computed(() => imageUrl.value !== '' && !imageBroken.value)

// 图片已经显示出来时，去掉占位文字
const displayText = computed(() =>
  showImage.value ? props.message.text.replace(/\[图片\]/g, '').trim() : props.message.text
)

// 文件夹气泡的信息都放在 meta 里：大小、项数、收发方向与完成状态
const folderMeta = computed(() => {
  let meta: Record<string, unknown>
  try {
    meta = JSON.parse(props.message.meta) as Record<string, unknown>
  } catch {
    meta = {}
  }
  const parts: string[] = []
  if (typeof meta.size === 'number') parts.push(formatSize(meta.size))
  if (typeof meta.count === 'number') parts.push(`${meta.count} 个文件`)
  if (meta.incoming === true) {
    parts.push(meta.done === true ? '已接收' : '接收中')
  } else if (props.message.status === 'failed') {
    parts.push('发送失败')
  } else {
    parts.push(props.message.status === 'delivered' ? '已发送' : '发送中')
  }
  return parts.join(' · ')
})

// 群文件的下载回执：谁已经把这个文件拉走了
const downloadedBy = computed(() => {
  try {
    const meta = JSON.parse(props.message.meta) as Record<string, unknown>
    return Array.isArray(meta.downloadedBy)
      ? (meta.downloadedBy as unknown[]).filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
})

// 群消息里显示发送者名字，私聊不显示
const senderLabel = computed(() => {
  if (props.own) return ''
  try {
    const meta = JSON.parse(props.message.meta) as Record<string, unknown>
    return typeof meta.senderName === 'string' ? meta.senderName : ''
  } catch {
    return ''
  }
})

// 文件夹卡片上的“打开文件夹”，路径来自消息 meta
const folderPath = computed(() => {
  try {
    const meta = JSON.parse(props.message.meta) as Record<string, unknown>
    return typeof meta.dir === 'string' ? meta.dir : ''
  } catch {
    return ''
  }
})

async function openFolder(): Promise<void> {
  if (folderPath.value === '') return
  try {
    await window.api.files.openPath(folderPath.value)
  } catch (reason) {
    store.reportError(errorMessage(reason))
  }
}
</script>

<template>
  <div class="message">
    <div v-if="showTime" class="time">{{ formatClock(message.createdAt) }}</div>

    <div v-if="message.kind === 'system'" class="system">
      <span>{{ message.text }}</span>
    </div>

    <div v-else class="row" :class="{ own }">
      <span class="avatar" :class="own ? 'own' : 'other'">
        {{ own ? ownInitial : otherInitial }}
      </span>

      <div class="content">
        <span v-if="senderLabel !== ''" class="sender">{{ senderLabel }}</span>
        <div v-if="message.kind === 'folder'" class="bubble folder-bubble">
          <div class="folder-card">
            <Folder :size="22" :stroke-width="1.6" />
            <div class="folder-text">
              <p class="folder-name">{{ message.text || '文件夹' }}</p>
              <p class="folder-meta">{{ folderMeta }}</p>
            </div>
            <button v-if="folderPath !== ''" class="folder-open" @click="openFolder">
              打开文件夹
            </button>
          </div>
        </div>

        <div v-else-if="message.kind === 'file'" class="bubble file-bubble">
          <FileCard v-if="file" :file="file" />
          <div v-else class="file-missing">
            <FileText :size="20" :stroke-width="1.6" />
            <div>
              <p class="missing-name">{{ message.text || '文件' }}</p>
              <p class="missing-hint">文件记录不可用</p>
            </div>
          </div>
          <p v-if="downloadedBy.length > 0" class="downloaded">
            已下载：{{ downloadedBy.join('、') }}
          </p>
        </div>

        <div
          v-else
          class="bubble text-bubble"
          :class="{ failed: message.status === 'failed', 'image-bubble': showImage }"
        >
          <img
            v-if="showImage"
            class="inline-image"
            :src="imageUrl"
            :alt="file?.name ?? '图片'"
            loading="lazy"
            @click="previewImage"
            @contextmenu.prevent="openImageMenu"
            @error="imageBroken = true"
          />
          <span v-if="displayText !== ''" class="text-body">{{ displayText }}</span>
        </div>

        <div v-if="own" class="meta" :class="statusClass">
          <component
            :is="statusIcon"
            :size="12"
            :stroke-width="1.9"
            :class="{ spin: message.status === 'sending' }"
          />
          <span>{{ statusLabel(message.status) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.message {
  display: flex;
  flex-direction: column;
  margin-bottom: var(--msg-gap);
}

.time {
  align-self: center;
  margin: -4px 0 8px;
  font-size: 11px;
  color: var(--text-muted);
}

.system {
  align-self: center;
  max-width: 70%;
  padding: 2px 10px;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--text-secondary);
  text-align: center;
  word-break: break-word;
}

.row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  max-width: 100%;
}

.row.own {
  flex-direction: row-reverse;
}

.avatar {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: var(--avatar-radius);
  color: #ffffff;
  font-size: 13px;
  font-weight: 500;
  user-select: none;
}

.avatar.own {
  background: var(--accent);
}

.avatar.other {
  background: #7f8f9f;
}

.content {
  display: flex;
  flex-direction: column;
  min-width: 0;
  /* 宽窗口下气泡贴着两侧，正文行宽仍控制在易读范围 */
  max-width: min(60%, 640px);
}

.row.own .content {
  align-items: flex-end;
}

.bubble {
  max-width: 100%;
  border-radius: var(--radius-bubble);
  font-size: var(--chat-font-size);
  line-height: 1.55;
  color: #191919;
}

.sender {
  margin-bottom: 3px;
  font-size: 11px;
  color: var(--text-muted);
}

.text-bubble {
  padding: 9px 12px;
  background: var(--other-bubble);
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.row.own .text-bubble {
  background: var(--own-bubble);
}

.text-bubble.failed {
  box-shadow: 0 0 0 1px rgba(250, 81, 81, 0.55);
}

/* 图片不加气泡底色和留白，直接显示图片本身 */
.text-bubble.image-bubble,
.row.own .text-bubble.image-bubble {
  padding: 0;
  background: transparent;
}

.text-bubble.image-bubble .text-body {
  padding: 6px 10px;
}

.inline-image {
  display: block;
  max-width: 280px;
  max-height: 320px;
  border-radius: 10px;
  cursor: zoom-in;
  object-fit: contain;
}

.text-body {
  display: block;
}

.inline-image + .text-body {
  margin-top: 6px;
}

.file-bubble {
  background: transparent;
}

.folder-bubble {
  background: transparent;
}

.folder-card {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 220px;
  max-width: 320px;
  padding: 10px 12px;
  border: 1px solid rgba(0, 0, 0, 0.05);
  border-radius: var(--radius-card);
  background: var(--card-bg);
  color: var(--text-secondary);
}

.folder-text {
  min-width: 0;
}

.folder-name {
  margin: 0 0 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--text);
}

.folder-meta {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.folder-open {
  flex: 0 0 auto;
  padding: 3px 8px;
  border-radius: var(--radius-button);
  background: var(--hover);
  color: var(--text-secondary);
  font-size: 11.5px;
}

.folder-open:hover {
  color: var(--accent);
}

.file-bubble :deep(.file-card) {
  border: 1px solid rgba(0, 0, 0, 0.05);
}

.file-missing {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 220px;
  padding: 10px 12px;
  border-radius: var(--radius-card);
  background: var(--card-bg);
  color: var(--text-secondary);
}

.downloaded {
  margin: 4px 0 0;
  padding-left: 2px;
  font-size: 11px;
  color: var(--text-muted);
}

.missing-name {
  margin: 0 0 3px;
  font-size: 13px;
  color: var(--text);
  word-break: break-all;
}

.missing-hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.meta {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-top: 4px;
  padding-right: 2px;
  font-size: 10.5px;
  color: var(--text-muted);
}

.meta.read {
  color: #7db894;
}

.meta.failed {
  color: var(--danger);
}

.spin {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
