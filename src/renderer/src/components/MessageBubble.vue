<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, CheckCheck, CircleAlert, FileText, LoaderCircle } from '@lucide/vue'
import type { FileTaskInfo, MessageInfo } from '../../../shared/domain'
import { formatClock, statusLabel } from '../utils/format'
import FileCard from './FileCard.vue'

const props = defineProps<{
  message: MessageInfo
  own: boolean
  showTime: boolean
  file: FileTaskInfo | null
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

const statusClass = computed(() => {
  if (props.message.status === 'failed') return 'failed'
  if (props.message.status === 'read') return 'read'
  return ''
})

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
        <div v-if="message.kind === 'file'" class="bubble file-bubble">
          <FileCard v-if="file" :file="file" />
          <div v-else class="file-missing">
            <FileText :size="20" :stroke-width="1.6" />
            <div>
              <p class="missing-name">{{ message.text || '文件' }}</p>
              <p class="missing-hint">文件记录不可用</p>
            </div>
          </div>
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
