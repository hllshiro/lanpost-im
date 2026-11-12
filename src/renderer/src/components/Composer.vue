<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { onClickOutside } from '@vueuse/core'
import { FileText, Folder, Paperclip, Send, Smile, X } from '@lucide/vue'
import type { StagedAttachment } from '../../../shared/domain'
import { errorMessage } from '../utils/errors'
import { formatSize } from '../utils/format'
import {
  emotionGroups,
  emotionThumb,
  emotionUrl,
  emotions,
  type EmotionItem
} from '../utils/emotion'

const props = defineProps<{
  draft: string
  sending: boolean
  conversationTitle: string
  conversationId: string
  staged: StagedAttachment[]
}>()

const emit = defineEmits<{
  'update:draft': [value: string]
  send: [text: string]
  'remove-staged': [id: string]
  sticker: [key: string]
}>()

const fileBusy = ref(false)
const fileError = ref('')

const stickersOpen = ref(false)
const stickerAnchor = ref<HTMLElement | null>(null)
const activeGroup = ref(emotionGroups[0] ?? '')
const groupItems = computed(() => emotions.filter((item) => item.group === activeGroup.value))

onClickOutside(stickerAnchor, () => {
  stickersOpen.value = false
})

function sendSticker(item: EmotionItem): void {
  if (props.sending) return
  stickersOpen.value = false
  if (item.kind === 'emotion') {
    emit('sticker', item.id === null ? item.image : String(item.id))
    return
  }
  // 微信/QQ 的表情对端没有同一张表，按图片发出去
  void runImageSticker(item)
}

async function runImageSticker(item: EmotionItem): Promise<void> {
  try {
    const url = emotionUrl(item)
    if (url === '') throw new Error('表情资源不可用')
    const response = await fetch(url)
    if (!response.ok) throw new Error('表情资源不可用')
    const data = await response.arrayBuffer()
    const name = item.image.split('/').pop() ?? 'sticker.gif'
    await window.api.files.stageBytes(props.conversationId, name, data, true)
    await window.api.files.sendStaged(props.conversationId)
  } catch (reason) {
    fileError.value = errorMessage(reason)
  }
}

function stagedUrl(id: string): string {
  return `lanpost-staged:///${encodeURIComponent(id)}`
}

async function pickFile(): Promise<void> {
  if (fileBusy.value || props.conversationId === '') return
  fileBusy.value = true
  fileError.value = ''
  try {
    await window.api.files.pick(props.conversationId)
  } catch (reason) {
    fileError.value = errorMessage(reason)
  } finally {
    fileBusy.value = false
  }
}

// 输入框里粘贴的图片先落盘进待发区，点发送才发出去
async function onPaste(event: ClipboardEvent): Promise<void> {
  if (props.conversationId === '' || fileBusy.value) return
  const items = event.clipboardData?.items
  if (items === undefined) return
  const hasImage = Array.from(items).some((item) => item.type.startsWith('image/'))
  if (!hasImage) return
  event.preventDefault()
  fileBusy.value = true
  fileError.value = ''
  try {
    await window.api.files.paste(props.conversationId)
  } catch (reason) {
    fileError.value = errorMessage(reason)
  } finally {
    fileBusy.value = false
  }
}

const INPUT_HEIGHT = 132
const textarea = ref<HTMLTextAreaElement | null>(null)
const text = computed({
  get: () => props.draft,
  set: (value: string) => emit('update:draft', value)
})
const canSend = computed(
  () => !props.sending && (props.draft.trim().length > 0 || props.staged.length > 0)
)

function resize(): void {
  const element = textarea.value
  if (!element) return
  element.style.height = `${INPUT_HEIGHT}px`
}

function onInput(): void {
  void nextTick(resize)
}

function submit(): void {
  if (props.sending) return
  const body = props.draft.trim()
  if (!body && props.staged.length === 0) return
  emit('send', body)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  submit()
}

watch(
  () => props.draft,
  async () => {
    await nextTick()
    resize()
  }
)

watch(
  () => props.sending,
  async (sending) => {
    if (sending) return
    await nextTick()
    textarea.value?.focus()
  }
)

onMounted(async () => {
  await nextTick()
  resize()
})
</script>

<template>
  <footer class="composer">
    <div v-if="staged.length > 0" class="staged">
      <div v-for="item in staged" :key="item.id" class="staged-item" :title="item.name">
        <img
          v-if="item.kind === 'image'"
          class="staged-thumb"
          :src="stagedUrl(item.id)"
          :alt="item.name"
        />
        <div v-else class="staged-file">
          <Folder v-if="item.kind === 'folder'" :size="16" :stroke-width="1.6" />
          <FileText v-else :size="16" :stroke-width="1.6" />
          <span class="staged-name">{{ item.name }}</span>
          <span class="staged-size">{{ formatSize(item.size) }}</span>
        </div>
        <button
          class="staged-remove"
          :aria-label="`移除 ${item.name}`"
          :title="`移除 ${item.name}`"
          @click="emit('remove-staged', item.id)"
        >
          <X :size="11" :stroke-width="2.4" />
        </button>
      </div>
    </div>

    <textarea
      ref="textarea"
      v-model="text"
      class="input"
      rows="1"
      :placeholder="`发送给 ${conversationTitle}`"
      spellcheck="false"
      @input="onInput"
      @keydown="onKeydown"
      @paste="onPaste"
    />

    <div class="toolbar">
      <div ref="stickerAnchor" class="sticker-anchor">
        <button
          class="tool"
          :class="{ active: stickersOpen }"
          title="表情"
          aria-label="表情"
          @click="stickersOpen = !stickersOpen"
        >
          <Smile :size="17" :stroke-width="1.8" />
          <span>表情</span>
        </button>

        <div v-if="stickersOpen" class="sticker-panel" role="dialog" aria-label="表情">
          <div class="sticker-tabs">
            <button
              v-for="group in emotionGroups"
              :key="group"
              class="sticker-tab"
              :class="{ active: group === activeGroup }"
              @click="activeGroup = group"
            >
              {{ group }}
            </button>
          </div>
          <div class="sticker-grid">
            <button
              v-for="item in groupItems"
              :key="item.image"
              class="sticker-item"
              :title="item.tips"
              :aria-label="item.tips"
              @click="sendSticker(item)"
            >
              <img :src="emotionThumb(item)" :alt="item.tips" />
            </button>
          </div>
        </div>
      </div>

      <button
        class="tool"
        :disabled="fileBusy || conversationId === ''"
        :title="fileBusy ? '正在选择文件' : '添加文件'"
        aria-label="添加文件"
        @click="pickFile"
      >
        <Paperclip :size="17" :stroke-width="1.8" />
        <span>文件</span>
      </button>

      <span v-if="fileError" class="file-error">{{ fileError }}</span>
      <span v-else class="hint">Enter 发送 · Shift + Enter 换行 · Ctrl + V 粘贴图片</span>

      <button class="send" :disabled="!canSend" @click="submit">
        <Send :size="14" :stroke-width="2" />
        <span>{{ sending ? '发送中' : '发送' }}</span>
      </button>
    </div>
  </footer>
</template>

<style scoped>
.composer {
  flex: 0 0 auto;
  padding: 8px 20px 10px;
  border-top: 1px solid var(--divider);
  background: #ffffff;
}

/* 待发区：粘贴的图片和选中的文件在发送前挂在这里 */
.staged {
  display: flex;
  flex-wrap: nowrap;
  gap: 8px;
  overflow-x: auto;
  padding: 2px 0 10px;
}

.staged-item {
  position: relative;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 56px;
  height: 56px;
  border-radius: 6px;
  background: var(--hover);
}

.staged-thumb {
  display: block;
  width: 56px;
  height: 56px;
  border-radius: 6px;
  object-fit: cover;
}

.staged-file {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  width: 168px;
  height: 56px;
  padding: 0 10px;
  border-radius: 6px;
  background: var(--hover);
  color: var(--text-secondary);
}

.staged-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text);
}

.staged-size {
  font-size: 11px;
  color: var(--text-muted);
}

.staged-remove {
  position: absolute;
  top: 3px;
  right: 3px;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.5);
  color: #ffffff;
}

.staged-remove:hover {
  background: rgba(0, 0, 0, 0.75);
}

.input {
  display: block;
  width: 100%;
  height: 132px;
  max-height: 132px;
  padding: 4px 2px;
  border: 0;
  outline: none;
  resize: none;
  background: transparent;
  font-size: var(--chat-font-size);
  line-height: 1.6;
  color: var(--text);
  overflow-y: auto;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-top: 4px;
}

.sticker-anchor {
  position: relative;
  display: flex;
}

.sticker-panel {
  position: absolute;
  left: 0;
  bottom: 32px;
  z-index: 30;
  width: 360px;
  max-width: 70vw;
  padding: 8px;
  border: 1px solid var(--divider);
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.16);
}

.sticker-tabs {
  display: flex;
  gap: 6px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--divider);
}

.sticker-tab {
  padding: 3px 8px;
  border-radius: var(--radius-button);
  font-size: 12px;
  color: var(--text-secondary);
}

.sticker-tab.active {
  background: var(--hover);
  color: var(--text);
}

.sticker-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 4px;
  max-height: 220px;
  overflow-y: auto;
  padding-top: 6px;
}

.sticker-item {
  display: grid;
  place-items: center;
  padding: 4px;
  border-radius: 6px;
}

.sticker-item:hover {
  background: var(--hover);
}

.sticker-item img {
  width: 28px;
  height: 28px;
  object-fit: contain;
}

.tool {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border-radius: var(--radius-button);
  font-size: 12px;
  color: var(--text-secondary);
}

.tool:disabled {
  opacity: 0.5;
}

.hint {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--text-muted);
  text-align: right;
}

.file-error {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: #d33b3b;
  text-align: right;
}

.send {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 66px;
  height: 28px;
  padding: 0 12px;
  border-radius: var(--radius-button);
  background: var(--accent);
  color: #ffffff;
  font-size: 12.5px;
}

.send:hover:not(:disabled) {
  background: var(--accent-hover);
}

.send:disabled {
  background: #d9d9d9;
  color: #ffffff;
}
</style>
