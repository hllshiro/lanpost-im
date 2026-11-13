<script setup lang="ts">
import { computed, ref } from 'vue'
import { X } from '@lucide/vue'
import type { NwtImportPreview, NwtImportSummary } from '../../../shared/ipc'
import { errorMessage } from '../utils/errors'

const props = defineProps<{ preview: NwtImportPreview }>()
const emit = defineEmits<{ close: []; done: [summary: NwtImportSummary] }>()

const includeIdentity = ref(props.preview.privateId !== '')
const includeGroups = ref(props.preview.groupCount > 0)
const selected = ref(new Set(props.preview.sessions.map((session) => session.key)))
const search = ref('')
const days = ref<number | ''>('')
const busy = ref(false)
const error = ref('')

const cutoff = computed(() => {
  const value = days.value
  if (value === '' || value <= 0) return 0
  return Date.now() - value * 24 * 60 * 60 * 1000
})

const visibleSessions = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  return props.preview.sessions.filter((session) => {
    if (cutoff.value > 0 && session.lastAt < cutoff.value) return false
    if (keyword === '') return true
    return session.title.toLowerCase().includes(keyword)
  })
})

const selectedSessions = computed(() =>
  props.preview.sessions.filter((session) => selected.value.has(session.key))
)

const selectedMessageCount = computed(() =>
  selectedSessions.value.reduce((total, session) => total + session.count, 0)
)

const allVisibleSelected = computed(
  () =>
    visibleSessions.value.length > 0 &&
    visibleSessions.value.every((session) => selected.value.has(session.key))
)

function toggle(sessionKey: string): void {
  const next = new Set(selected.value)
  if (next.has(sessionKey)) next.delete(sessionKey)
  else next.add(sessionKey)
  selected.value = next
}

function selectAll(): void {
  const next = new Set(selected.value)
  for (const session of visibleSessions.value) next.add(session.key)
  selected.value = next
}

function selectNone(): void {
  const next = new Set(selected.value)
  for (const session of visibleSessions.value) next.delete(session.key)
  selected.value = next
}

function formatTime(value: number): string {
  const date = new Date(value)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

async function submit(): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const summary = await window.api.storage.applyNwtImport({
      includeIdentity: includeIdentity.value,
      includeGroups: includeGroups.value,
      sessions: selectedSessions.value.map((session) => session.key)
    })
    emit('done', summary)
  } catch (reason) {
    error.value = errorMessage(reason)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="nwt-mask" @mousedown.self="busy || emit('close')">
    <div class="nwt-dialog" role="dialog" aria-modal="true" aria-label="从内网通导入">
      <header class="nwt-head">
        <div>
          <h2>从内网通导入</h2>
          <p class="nwt-source">{{ preview.source }}</p>
        </div>
        <button class="nwt-close" title="关闭" :disabled="busy" @click="emit('close')">
          <X :size="16" />
        </button>
      </header>

      <div class="nwt-body">
        <label class="nwt-row">
          <input v-model="includeIdentity" type="checkbox" :disabled="busy" />
          <span class="nwt-row-text">
            <strong>账号与资料</strong>
            <span>
              {{ preview.displayName }} · {{ preview.privateId.slice(0, 8) }}
              <template v-if="preview.hasAvatar"> · 含头像</template>
            </span>
          </span>
        </label>

        <label class="nwt-row">
          <input v-model="includeGroups" type="checkbox" :disabled="busy" />
          <span class="nwt-row-text">
            <strong>群</strong>
            <span>群资料与群成员，共 {{ preview.groupCount }} 个</span>
          </span>
        </label>

        <div class="nwt-history">
          <div class="nwt-history-head">
            <strong>聊天记录</strong>
            <span>{{ preview.messageCount }} 条，共 {{ preview.sessions.length }} 个会话</span>
          </div>
          <div class="nwt-tools">
            <input v-model="search" class="nwt-search" placeholder="搜索会话" :disabled="busy" />
            <label class="nwt-days">
              最近
              <input
                v-model.number="days"
                class="nwt-days-input"
                type="number"
                min="1"
                max="3650"
                placeholder="全部"
                :disabled="busy"
              />
              天
            </label>
          </div>
          <div class="nwt-list-tools">
            <button
              class="nwt-link"
              :disabled="busy"
              @click="allVisibleSelected ? selectNone() : selectAll()"
            >
              {{ allVisibleSelected ? '全不选' : '全选' }}
            </button>
            <span>已选 {{ selectedSessions.length }} 个会话、{{ selectedMessageCount }} 条</span>
          </div>
          <ul class="nwt-list">
            <li v-for="session in visibleSessions" :key="session.key">
              <label class="nwt-item">
                <input
                  type="checkbox"
                  :checked="selected.has(session.key)"
                  :disabled="busy"
                  @change="toggle(session.key)"
                />
                <span class="nwt-badge" :class="session.kind">{{
                  session.kind === 'group' ? '群' : '私'
                }}</span>
                <span class="nwt-title" :title="session.title">{{ session.title }}</span>
                <span class="nwt-count">{{ session.count }} 条</span>
                <span class="nwt-range"
                  >{{ formatTime(session.firstAt) }} ~ {{ formatTime(session.lastAt) }}</span
                >
              </label>
            </li>
            <li v-if="visibleSessions.length === 0" class="nwt-empty">没有符合条件的会话</li>
          </ul>
        </div>

        <p v-if="error" class="nwt-error">{{ error }}</p>
      </div>

      <footer class="nwt-foot">
        <span class="nwt-hint">导入后重复的消息会自动跳过</span>
        <div class="nwt-actions">
          <button class="nwt-secondary" :disabled="busy" @click="emit('close')">取消</button>
          <button class="nwt-primary" :disabled="busy" @click="submit">
            {{ busy ? '导入中…' : '开始导入' }}
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.nwt-mask {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  background: rgba(20, 24, 28, 0.42);
}

.nwt-dialog {
  width: 560px;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.22);
}

.nwt-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 18px 20px 10px;
}

.nwt-head h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}

.nwt-source {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--text-faint);
  word-break: break-all;
}

.nwt-close {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-faint);
}

.nwt-close:hover:not(:disabled) {
  background: #f1f2f4;
  color: var(--text);
}

.nwt-body {
  padding: 4px 20px 8px;
  overflow-y: auto;
}

.nwt-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px solid #f0f1f3;
}

.nwt-row input {
  margin-top: 2px;
}

.nwt-row-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12px;
  color: var(--text-faint);
}

.nwt-row-text strong {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
}

.nwt-history {
  padding: 12px 0 4px;
}

.nwt-history-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 13px;
  color: var(--text);
}

.nwt-history-head span {
  font-size: 11px;
  color: var(--text-faint);
}

.nwt-tools {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 10px 0 6px;
}

.nwt-search {
  flex: 1;
  height: 28px;
  padding: 0 9px;
  border: 1px solid #dcdcdc;
  border-radius: 6px;
  font-size: 12px;
}

.nwt-days {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-faint);
}

.nwt-days-input {
  width: 58px;
  height: 28px;
  padding: 0 6px;
  border: 1px solid #dcdcdc;
  border-radius: 6px;
  font-size: 12px;
}

.nwt-list-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-faint);
}

.nwt-link {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent);
  font-size: 12px;
}

.nwt-link:disabled {
  opacity: 0.5;
}

.nwt-list {
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
  max-height: 236px;
  overflow-y: auto;
  border: 1px solid #f0f1f3;
  border-radius: 8px;
}

.nwt-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  font-size: 12px;
  border-bottom: 1px solid #f6f7f8;
}

.nwt-item:hover {
  background: #fafbfc;
}

.nwt-badge {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border-radius: 4px;
  font-size: 10px;
  background: #eef3fb;
  color: #3d6fb4;
}

.nwt-badge.group {
  background: #f3eefb;
  color: #6b4fb4;
}

.nwt-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}

.nwt-count {
  flex: 0 0 auto;
  color: var(--text-faint);
}

.nwt-range {
  flex: 0 0 auto;
  color: #a8adb4;
  font-size: 11px;
}

.nwt-empty {
  padding: 18px 10px;
  text-align: center;
  font-size: 12px;
  color: var(--text-faint);
}

.nwt-error {
  margin: 8px 0 4px;
  font-size: 12px;
  color: #c0392b;
}

.nwt-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 20px 16px;
  border-top: 1px solid #f0f1f3;
}

.nwt-hint {
  font-size: 11px;
  color: var(--text-faint);
}

.nwt-actions {
  display: flex;
  gap: 8px;
}

.nwt-secondary,
.nwt-primary {
  height: 30px;
  padding: 0 14px;
  border-radius: 6px;
  font-size: 12px;
}

.nwt-secondary {
  border: 1px solid #dcdcdc;
  background: #ffffff;
  color: var(--text);
}

.nwt-primary {
  border: 0;
  background: var(--accent);
  color: #ffffff;
}

.nwt-primary:disabled,
.nwt-secondary:disabled {
  opacity: 0.6;
}
</style>
