<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Paperclip, Send } from '@lucide/vue'
import { errorMessage } from '../utils/errors'

const props = defineProps<{
  draft: string
  sending: boolean
  conversationTitle: string
  conversationId: string
}>()

const emit = defineEmits<{
  'update:draft': [value: string]
  send: [text: string]
}>()

const fileBusy = ref(false)
const fileError = ref('')

async function pickFile(): Promise<void> {
  if (fileBusy.value || props.conversationId === '') return
  fileBusy.value = true
  fileError.value = ''
  try {
    await window.api.files.pickAndSend(props.conversationId)
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
const canSend = computed(() => props.draft.trim().length > 0 && !props.sending)

function resize(): void {
  const element = textarea.value
  if (!element) return
  element.style.height = `${INPUT_HEIGHT}px`
}

function onInput(): void {
  void nextTick(resize)
}

function submit(): void {
  const body = props.draft.trim()
  if (!body || props.sending) return
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
    <textarea
      ref="textarea"
      v-model="text"
      class="input"
      rows="1"
      :placeholder="`发送给 ${conversationTitle}`"
      spellcheck="false"
      @input="onInput"
      @keydown="onKeydown"
    />

    <div class="toolbar">
      <button
        class="tool"
        :disabled="fileBusy || conversationId === ''"
        :title="fileBusy ? '正在选择文件' : '发送文件'"
        aria-label="发送文件"
        @click="pickFile"
      >
        <Paperclip :size="17" :stroke-width="1.8" />
        <span>文件</span>
      </button>

      <span v-if="fileError" class="file-error">{{ fileError }}</span>
      <span v-else class="hint">Enter 发送 · Shift + Enter 换行</span>

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
