<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { onClickOutside } from '@vueuse/core'
import { FileText, Folder, Paperclip, Send, Smile, X } from '@lucide/vue'
import type { StagedAttachment } from '../../../shared/domain'
import type { RichPart } from '../../../shared/ipc'
import { errorMessage } from '../utils/errors'
import { formatSize } from '../utils/format'
import { useAppStore } from '../stores/app'
import {
  emotionGroups,
  emotionThumb,
  emotionUrl,
  emotions,
  type EmotionItem
} from '../utils/emotion'
import {
  emotionUsageKey,
  loadEmotionUsage,
  saveEmotionUsage,
  sortByUsage
} from '../utils/emotion-usage'

const props = defineProps<{
  draft: string
  sending: boolean
  conversationTitle: string
  conversationId: string
  staged: StagedAttachment[]
}>()

const emit = defineEmits<{
  'update:draft': [value: string]
  'send-rich': [parts: RichPart[]]
  'remove-staged': [id: string]
}>()

const fileBusy = ref(false)
const fileError = ref('')
const store = useAppStore()

const stickersOpen = ref(false)
const stickerAnchor = ref<HTMLElement | null>(null)
const FAVORITES_TAB = '收藏'
const tabs = computed(() => [...emotionGroups, FAVORITES_TAB])
const activeGroup = ref(emotionGroups[0] ?? '')
const usage = ref<Record<string, number>>(loadEmotionUsage())
const groupItems = computed(() =>
  sortByUsage(
    emotions.filter((item) => item.group === activeGroup.value),
    usage.value
  )
)

function rememberUsage(item: EmotionItem): void {
  const key = emotionUsageKey(item)
  usage.value = { ...usage.value, [key]: (usage.value[key] ?? 0) + 1 }
  saveEmotionUsage(usage.value)
}

function favoriteUrl(id: string): string {
  return `lanpost-emotion:///${encodeURIComponent(id)}`
}

onClickOutside(stickerAnchor, () => {
  stickersOpen.value = false
})

// ---- 富文本输入：文字和图片在同一个输入框里按顺序混排 ----

const editor = ref<HTMLElement | null>(null)
const hasContent = ref(false)
const stagedImages = computed(() => props.staged.filter((item) => item.kind === 'image'))
const stagedFiles = computed(() => props.staged.filter((item) => item.kind !== 'image'))

function stagedUrl(id: string): string {
  return `lanpost-staged:///${encodeURIComponent(id)}`
}

function imageNode(attachment: StagedAttachment): HTMLElement {
  const image = document.createElement('img')
  image.src = stagedUrl(attachment.id)
  image.alt = attachment.name
  image.title = attachment.name
  image.className = 'editor-image'
  image.dataset.staged = attachment.id
  image.setAttribute('contenteditable', 'false')
  return image
}

function insertAtCaret(node: Node): void {
  const element = editor.value
  if (element === null) return
  element.focus()
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0 || !element.contains(selection.anchorNode)) {
    element.appendChild(node)
    return
  }
  const range = selection.getRangeAt(0)
  range.deleteContents()
  range.insertNode(node)
  range.setStartAfter(node)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

function insertImages(attachments: StagedAttachment[]): void {
  for (const attachment of attachments) {
    if (attachment.kind !== 'image') continue
    insertAtCaret(imageNode(attachment))
  }
  refreshContent()
}

// 等待主进程把附件放进待发区，再把新增的图片插到光标位置
async function stageAndInsert(
  work: () => Promise<StagedAttachment[]>,
  before: Set<string>
): Promise<void> {
  const list = await work()
  insertImages(list.filter((item) => !before.has(item.id)))
}

function currentStagedIds(): Set<string> {
  return new Set(props.staged.map((item) => item.id))
}

async function sendSticker(item: EmotionItem): Promise<void> {
  if (props.sending) return
  rememberUsage(item)
  stickersOpen.value = false
  const before = currentStagedIds()
  try {
    const url = emotionUrl(item)
    if (url === '') throw new Error('表情资源不可用')
    const data = await (await fetch(url)).arrayBuffer()
    const name = item.image.split('/').pop() ?? 'sticker.gif'
    await stageAndInsert(
      () => window.api.files.stageBytes(props.conversationId, name, data, true),
      before
    )
  } catch (reason) {
    fileError.value = errorMessage(reason)
  }
}

async function sendFavorite(id: string): Promise<void> {
  if (props.sending) return
  stickersOpen.value = false
  const before = currentStagedIds()
  try {
    await stageAndInsert(() => window.api.emotions.stage(props.conversationId, id), before)
  } catch (reason) {
    fileError.value = errorMessage(reason)
  }
}

async function pickFile(): Promise<void> {
  if (fileBusy.value || props.conversationId === '') return
  fileBusy.value = true
  fileError.value = ''
  const before = currentStagedIds()
  try {
    await stageAndInsert(() => window.api.files.pick(props.conversationId), before)
  } catch (reason) {
    fileError.value = errorMessage(reason)
  } finally {
    fileBusy.value = false
  }
}

// 粘贴图片直接插到光标处，和文字一起发
async function onPaste(event: ClipboardEvent): Promise<void> {
  if (props.conversationId === '' || fileBusy.value) return
  const items = event.clipboardData?.items
  if (items === undefined) return
  const hasImage = Array.from(items).some((item) => item.type.startsWith('image/'))
  if (!hasImage) return
  event.preventDefault()
  fileBusy.value = true
  fileError.value = ''
  const before = currentStagedIds()
  try {
    await stageAndInsert(() => window.api.files.paste(props.conversationId), before)
  } catch (reason) {
    fileError.value = errorMessage(reason)
  } finally {
    fileBusy.value = false
  }
}

function refreshContent(): void {
  const element = editor.value
  const text = element?.innerText ?? ''
  hasContent.value = text.trim() !== '' || element?.querySelector('img[data-staged]') !== null
  emit('update:draft', text)
}

// 退格删掉输入框里的图片后，把对应的待发附件也移除
let pruneTimer: number | undefined
function schedulePrune(): void {
  if (pruneTimer !== undefined) window.clearTimeout(pruneTimer)
  pruneTimer = window.setTimeout(() => {
    const element = editor.value
    if (element === null) return
    const alive = new Set(
      Array.from(element.querySelectorAll('img[data-staged]')).map(
        (image) => (image as HTMLImageElement).dataset.staged ?? ''
      )
    )
    for (const attachment of stagedImages.value) {
      if (!alive.has(attachment.id)) {
        void window.api.files.removeStaged(props.conversationId, attachment.id)
      }
    }
  }, 300)
}

function onInput(): void {
  refreshContent()
  schedulePrune()
}

function collectParts(): RichPart[] {
  const element = editor.value
  if (element === null) return []
  const parts: RichPart[] = []
  const pushText = (value: string): void => {
    if (value === '') return
    const last = parts[parts.length - 1]
    if (last !== undefined && last.kind === 'text') last.text += value
    else parts.push({ kind: 'text', text: value })
  }
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      pushText(node.textContent ?? '')
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const entry = node as HTMLElement
    if (entry.tagName === 'IMG') {
      const stagedId = entry.dataset.staged
      if (stagedId !== undefined) parts.push({ kind: 'image', stagedId })
      return
    }
    if (entry.tagName === 'BR') {
      pushText('\n')
      return
    }
    const block = entry.tagName === 'DIV' || entry.tagName === 'P'
    if (block && parts.length > 0) pushText('\n')
    for (const child of Array.from(entry.childNodes)) walk(child)
  }
  for (const child of Array.from(element.childNodes)) walk(child)
  return parts
}

const canSend = computed(() => !props.sending && (hasContent.value || stagedFiles.value.length > 0))

function submit(): void {
  if (props.sending) return
  const parts = collectParts()
  const hasImage = parts.some((part) => part.kind === 'image')
  const text = parts
    .filter((part) => part.kind === 'text')
    .map((part) => part.text)
    .join('')
    .trim()
  if (!hasImage && text === '' && stagedFiles.value.length === 0) return
  emit('send-rich', parts)
  clearEditor()
}

function clearEditor(): void {
  const element = editor.value
  if (element !== null) element.innerHTML = ''
  hasContent.value = false
  emit('update:draft', '')
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  submit()
}

// 会话切换或首次进入时，把草稿文字和已经在待发区的图片放回输入框
function loadEditor(): void {
  const element = editor.value
  if (element === null) return
  element.innerHTML = ''
  if (props.draft !== '') element.appendChild(document.createTextNode(props.draft))
  for (const attachment of stagedImages.value) element.appendChild(imageNode(attachment))
  refreshContent()
}

watch(
  () => props.conversationId,
  async () => {
    await nextTick()
    loadEditor()
  }
)

watch(
  () => props.sending,
  async (sending) => {
    if (sending) return
    await nextTick()
    editor.value?.focus()
  }
)

onMounted(async () => {
  await nextTick()
  loadEditor()
})
</script>

<template>
  <footer class="composer">
    <div v-if="stagedFiles.length > 0" class="staged">
      <div v-for="item in stagedFiles" :key="item.id" class="staged-item" :title="item.name">
        <div class="staged-file">
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

    <div
      ref="editor"
      class="input rich-input"
      contenteditable="plaintext-only"
      spellcheck="false"
      :data-placeholder="`发送给 ${conversationTitle}`"
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
              v-for="group in tabs"
              :key="group"
              class="sticker-tab"
              :class="{ active: group === activeGroup }"
              @click="activeGroup = group"
            >
              {{ group }}
            </button>
          </div>
          <div v-if="activeGroup === FAVORITES_TAB" class="sticker-grid favorite-grid">
            <div v-if="store.favorites.length === 0" class="favorite-empty">
              在图片上右键，选「收藏到表情」
            </div>
            <div v-for="favorite in store.favorites" :key="favorite.id" class="favorite-item">
              <button
                class="sticker-item"
                :title="favorite.name"
                @click="sendFavorite(favorite.id)"
              >
                <img :src="favoriteUrl(favorite.id)" :alt="favorite.name" />
              </button>
              <button
                class="favorite-remove"
                title="取消收藏"
                aria-label="取消收藏"
                @click.stop="store.removeFavorite(favorite.id)"
              >
                <X :size="9" :stroke-width="2.6" />
              </button>
            </div>
          </div>
          <div v-else class="sticker-grid">
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

/* 富文本输入：图片作为原子元素夹在文字之间 */
.rich-input {
  white-space: pre-wrap;
  word-break: break-word;
}

.rich-input:empty::before {
  content: attr(data-placeholder);
  color: var(--text-muted);
  pointer-events: none;
}

.editor-image {
  display: inline-block;
  height: 28px;
  max-width: 96px;
  margin: 0 2px;
  border-radius: 4px;
  object-fit: contain;
  vertical-align: middle;
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

.favorite-grid {
  position: relative;
}

.favorite-item {
  position: relative;
  display: grid;
  place-items: center;
}

.favorite-remove {
  position: absolute;
  top: -2px;
  right: -2px;
  display: none;
  place-items: center;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: #ffffff;
}

.favorite-item:hover .favorite-remove {
  display: grid;
}

.favorite-empty {
  grid-column: 1 / -1;
  padding: 24px 0;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
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
