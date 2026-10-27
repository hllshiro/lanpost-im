<script setup lang="ts">
import { computed } from 'vue'
import { Check, CheckCheck, CircleAlert, FileText, LoaderCircle } from '@lucide/vue'
import type { FileTaskInfo, MessageInfo } from '../../../shared/domain'
import { formatClock, statusLabel } from '../utils/format'
import FileCard from './FileCard.vue'

const props = defineProps<{
  message: MessageInfo
  own: boolean
  showTime: boolean
  files: FileTaskInfo[]
  ownInitial: string
  otherInitial: string
}>()

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

const flags = computed(() => props.message.meta.flags ?? {})
const imageTasks = computed(() => props.files.filter((file) => file.kind === 'image'))
const images = computed(() =>
  imageTasks.value.filter((file) => file.state === 'done' && file.path !== '')
)
const imageStateText = computed(() => {
  const tasks = imageTasks.value
  if (tasks.length === 0) {
    return (props.message.meta.images?.length ?? 0) > 0 ? '图片记录不可用' : ''
  }
  if (tasks.some((file) => file.state === 'failed')) return '图片传输失败'
  if (tasks.some((file) => file.state === 'rejected')) return '对方已拒绝图片'
  if (tasks.some((file) => file.state === 'canceled')) return '图片已取消'
  if (tasks.some((file) => file.state === 'transferring')) {
    return props.message.direction === 'in' ? '图片接收中…' : '图片发送中…'
  }
  if (tasks.some((file) => file.state === 'offered' || file.state === 'waiting')) {
    return '等待接收图片…'
  }
  return images.value.length === 0 ? '图片记录不可用' : ''
})

const statusText = computed(() => {
  if ((props.message.meta.images?.length ?? 0) > 0 && props.own) {
    if (imageTasks.value.some((file) => file.state === 'rejected')) return '对方已拒绝'
    if (imageTasks.value.some((file) => file.state === 'canceled')) return '已取消'
    if (imageTasks.value.some((file) => file.state === 'failed')) return '发送失败'
    if (imageTasks.value.some((file) => file.state === 'transferring')) return '发送中'
    if (imageTasks.value.some((file) => file.state === 'offered' || file.state === 'waiting')) {
      return '等待接收'
    }
  }
  if (props.message.kind === 'file' && props.own) {
    if (props.files.some((file) => file.state === 'rejected')) return '对方已拒绝'
    if (props.files.some((file) => file.state === 'canceled')) return '已取消'
    if (props.files.some((file) => file.state === 'failed')) return '发送失败'
    if (props.files.some((file) => file.state === 'transferring')) return '传输中'
    if (props.files.some((file) => file.state === 'offered' || file.state === 'waiting')) {
      return '等待接收'
    }
  }
  return statusLabel(props.message.status)
})
function openImage(file: FileTaskInfo): void {
  void window.api.files.open(file.id)
}

const statusClass = computed(() => {
  if (props.message.status === 'failed') return 'failed'
  if (props.message.status === 'read') return 'read'
  return ''
})
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
        <span v-if="flags.broadcast || flags.multicast" class="group-tag">
          {{ flags.broadcast ? '广播' : '多播' }}
        </span>
        <div v-if="message.kind === 'file'" class="bubble file-bubble">
          <FileCard v-for="task in files" :key="task.id" :file="task" />
          <div v-if="files.length === 0" class="file-missing">
            <FileText :size="20" :stroke-width="1.6" />
            <div>
              <p class="missing-name">{{ message.text || '文件' }}</p>
              <p class="missing-hint">文件记录不可用</p>
            </div>
          </div>
        </div>

        <div v-else class="bubble text-bubble" :class="{ failed: message.status === 'failed' }">
          {{ message.text }}
          <div
            v-if="imageTasks.length > 0 || (message.meta.images?.length ?? 0) > 0"
            class="image-grid"
          >
            <button
              v-for="image in images"
              :key="image.id"
              class="image-item"
              :title="image.name"
              @click="openImage(image)"
            >
              <img
                :src="`lanpost-media://file/${encodeURIComponent(image.id)}`"
                :alt="image.name"
              />
            </button>
            <div v-if="imageStateText" class="image-placeholder">{{ imageStateText }}</div>
          </div>
        </div>

        <div v-if="own" class="meta" :class="statusClass">
          <component
            :is="statusIcon"
            :size="12"
            :stroke-width="1.9"
            :class="{ spin: message.status === 'sending' }"
          />
          <span>{{ statusText }}</span>
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

.group-tag {
  align-self: flex-start;
  margin-bottom: 3px;
  padding: 1px 6px;
  border-radius: 4px;
  background: #eef3f0;
  color: var(--accent);
  font-size: 10.5px;
}

.row.own .group-tag {
  align-self: flex-end;
}

.content {
  display: flex;
  flex-direction: column;
  min-width: 0;
  max-width: 60%;
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

.image-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  margin-top: 6px;
}

.image-placeholder {
  grid-column: 1 / -1;
  padding: 12px;
  border-radius: 6px;
  background: #f4f4f4;
  color: var(--text-secondary);
  font-size: 12px;
  text-align: center;
}

.image-item {
  overflow: hidden;
  padding: 0;
  border-radius: 6px;
  background: #f4f4f4;
}

.image-item img {
  display: block;
  width: 100%;
  max-height: 220px;
  object-fit: cover;
}

.file-bubble {
  background: transparent;
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
