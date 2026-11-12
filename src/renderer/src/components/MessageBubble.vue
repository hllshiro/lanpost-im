<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, CheckCheck, CircleAlert, FileText, Folder, LoaderCircle } from '@lucide/vue'
import type { FileTaskInfo, MessageInfo } from '../../../shared/domain'
import { formatClock, formatSize, statusLabel } from '../utils/format'
import { errorMessage } from '../utils/errors'
import { emotionByKey, emotionUrl } from '../utils/emotion'
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
  () => [props.file?.id, props.file?.state],
  () => {
    imageBroken.value = false
  }
)

const showImage = computed(() => imageUrl.value !== '' && !imageBroken.value)

// 内置表情：meta 里存的是表情表的 Id 或文件名，用本机表情包渲染，不走文件通道
const stickerKey = computed(() => {
  let meta: Record<string, unknown>
  try {
    meta = JSON.parse(props.message.meta) as Record<string, unknown>
  } catch {
    return ''
  }
  return typeof meta.sticker === 'string' ? meta.sticker : ''
})

const sticker = computed(() => (stickerKey.value === '' ? null : emotionByKey(stickerKey.value)))
const stickerUrl = computed(() => (sticker.value === null ? '' : emotionUrl(sticker.value)))

// 微信/QQ 表情是按图片发的，气泡里固定小尺寸显示
const imageSticker = computed(() => {
  try {
    const meta = JSON.parse(props.message.meta) as Record<string, unknown>
    return meta.sticker === true
  } catch {
    return false
  }
})

// 图片和表情已经显示出来时，去掉占位文字
const displayText = computed(() => {
  if (stickerUrl.value !== '') return ''
  return showImage.value ? props.message.text.replace(/\[图片\]/g, '').trim() : props.message.text
})

// 文件夹气泡的信息都放在 meta 里：大小、项数、收发方向与完成状态
const folderMetaRaw = computed<Record<string, unknown>>(() => {
  try {
    return JSON.parse(props.message.meta) as Record<string, unknown>
  } catch {
    return {}
  }
})

// 收到的文件夹按真实客户端的说法显示状态，发出的按发送状态
const folderIncoming = computed(() => folderMetaRaw.value.incoming === true)
const folderDone = computed(() => folderMetaRaw.value.done === true)

const folderStateText = computed(() => {
  if (!folderIncoming.value) {
    return props.message.status === 'failed' ? '发送失败' : '已发送'
  }
  if (typeof folderMetaRaw.value.error === 'string') return '接收失败'
  return folderDone.value ? '接收成功' : '接收中'
})

const folderMeta = computed(() => {
  const meta = folderMetaRaw.value
  const parts: string[] = []
  if (typeof meta.size === 'number') parts.push(formatSize(meta.size))
  if (typeof meta.count === 'number') parts.push(`${meta.count} 个文件`)
  parts.push(folderStateText.value)
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

async function revealFolder(): Promise<void> {
  if (folderPath.value === '') return
  try {
    await window.api.files.revealPath(folderPath.value)
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
            <div class="folder-main">
              <span class="folder-icon">
                <Folder :size="42" :stroke-width="1.2" fill="#f7a72c" color="#e5941f" />
              </span>
              <div class="folder-text">
                <p class="folder-name" :title="message.text">{{ message.text || '文件夹' }}</p>
                <p class="folder-meta">{{ folderMeta }}</p>
              </div>
            </div>
            <div v-if="folderIncoming ? folderDone : folderPath !== ''" class="folder-actions">
              <span class="folder-spacer" />
              <button class="folder-link" @click="openFolder">打开</button>
              <button class="folder-link" @click="revealFolder">打开文件夹</button>
            </div>
          </div>
          <p v-if="downloadedBy.length > 0" class="downloaded">
            已下载：{{ downloadedBy.join('、') }}
          </p>
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
          :class="{
            failed: message.status === 'failed',
            'image-bubble': showImage,
            'sticker-bubble': stickerUrl !== ''
          }"
        >
          <img
            v-if="stickerUrl !== ''"
            class="sticker-image"
            :src="stickerUrl"
            :alt="sticker?.tips ?? '表情'"
          />
          <img
            v-if="showImage"
            class="inline-image"
            :class="{ 'sticker-photo': imageSticker }"
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

/* 表情不套气泡底色，按原始尺寸显示 */
.sticker-bubble {
  padding: 0;
  background: transparent;
}

.row.own .sticker-bubble {
  background: transparent;
}

.sticker-image {
  display: block;
  width: 84px;
  height: 84px;
  object-fit: contain;
}

/* 表情按图片发送时统一成小方块，按原始比例缩放 */
.inline-image.sticker-photo {
  width: 48px;
  height: 48px;
  max-width: 48px;
  max-height: 48px;
  object-fit: contain;
  border-radius: 0;
  cursor: default;
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
  width: 300px;
  max-width: 100%;
  padding: 10px 12px;
  border: 1px solid rgba(0, 0, 0, 0.05);
  border-radius: var(--radius-card);
  background: var(--card-bg);
}

.folder-main {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.folder-icon {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  color: #e5941f;
}

.folder-text {
  flex: 1;
  min-width: 0;
}

.folder-name {
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

.folder-meta {
  margin: 0;
  font-size: 11px;
  color: var(--text-secondary);
}

/* 底部动作栏：分隔线上面是文件信息，下面按真实客户端的样子放文字入口 */
.folder-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid #e7e7e7;
}

.folder-spacer {
  flex: 1;
}

.folder-link {
  padding: 0;
  border: 0;
  background: transparent;
  color: #1a73e8;
  font-size: 12px;
  cursor: pointer;
}

.folder-link:hover {
  text-decoration: underline;
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

/* 收到的文件夹：保留卡片样式，动作按真实客户端的写法给出两个入口 */
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
