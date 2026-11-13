<script setup lang="ts">
import { computed, ref } from 'vue'
import { Search, Users, X } from '@lucide/vue'
import type { PeerInfo } from '../../../shared/domain'
import type { BatchSendResult, RichPart } from '../../../shared/ipc'
import { useAppStore } from '../stores/app'
import { avatarUrl } from '../utils/avatar'
import { errorMessage } from '../utils/errors'
import { initialOf } from '../utils/format'
import { comparePinyin, pinyinInfo } from '../utils/pinyin'
import Composer from './Composer.vue'

const props = defineProps<{ peers: PeerInfo[] }>()
const emit = defineEmits<{ close: []; sent: [result: BatchSendResult] }>()

const store = useAppStore()
const batchId = `batch:${Date.now().toString(36)}`

const query = ref('')
const selected = ref<Set<string>>(new Set())
const draft = ref('')
const busy = ref(false)
const error = ref('')

const keyword = computed(() => query.value.trim().toLowerCase())

function nameOf(peer: PeerInfo): string {
  return peer.alias.trim() || peer.name || peer.user || peer.ip
}

const ordered = computed(() =>
  [...props.peers].sort((left, right) => comparePinyin(nameOf(left), nameOf(right)))
)

const visible = computed(() => {
  if (keyword.value === '') return ordered.value
  return ordered.value.filter((peer) => {
    const fields = [
      peer.name,
      peer.alias,
      peer.user,
      peer.group,
      peer.department,
      peer.ip,
      peer.host,
      peer.sign
    ]
    if (fields.some((field) => field.toLowerCase().includes(keyword.value))) return true
    const info = pinyinInfo(nameOf(peer))
    return info.full.includes(keyword.value) || info.initials.includes(keyword.value)
  })
})

const selectedPeers = computed(() => ordered.value.filter((peer) => selected.value.has(peer.key)))
const offlineCount = computed(() => selectedPeers.value.filter((peer) => !peer.online).length)
const staged = computed(() => store.staged.filter((item) => item.conversationId === batchId))
const allVisibleSelected = computed(
  () => visible.value.length > 0 && visible.value.every((peer) => selected.value.has(peer.key))
)

function toggle(peerKey: string): void {
  const next = new Set(selected.value)
  if (next.has(peerKey)) next.delete(peerKey)
  else next.add(peerKey)
  selected.value = next
}

function toggleAll(): void {
  const next = new Set(selected.value)
  if (allVisibleSelected.value) {
    for (const peer of visible.value) next.delete(peer.key)
  } else {
    for (const peer of visible.value) next.add(peer.key)
  }
  selected.value = next
}

async function removeStaged(id: string): Promise<void> {
  await store.removeStaged(batchId, id)
}

async function send(parts: RichPart[]): Promise<void> {
  if (busy.value) return
  if (selected.value.size === 0) {
    error.value = '请先选择接收人'
    return
  }
  busy.value = true
  error.value = ''
  try {
    const result = await store.batchSend(batchId, [...selected.value], parts)
    emit('sent', result)
  } catch (reason) {
    error.value = errorMessage(reason)
  } finally {
    busy.value = false
  }
}

async function close(): Promise<void> {
  if (busy.value) return
  for (const item of staged.value) {
    await store.removeStaged(batchId, item.id)
  }
  emit('close')
}
</script>

<template>
  <div class="batch-mask" @mousedown.self="close">
    <div class="batch-dialog" role="dialog" aria-modal="true" aria-label="群发">
      <header class="batch-head">
        <div>
          <h2>群发</h2>
          <p>选择接收人，可以发送文字、图片、文件与表情。离线联系人只排队文字消息。</p>
        </div>
        <button class="batch-close" title="关闭" :disabled="busy" @click="close">
          <X :size="16" />
        </button>
      </header>

      <div class="batch-body">
        <section class="picker">
          <div class="picker-top">
            <div class="picker-search">
              <Search :size="13" :stroke-width="1.9" />
              <input
                v-model="query"
                type="text"
                placeholder="搜索名称、账号或拼音"
                autocomplete="off"
                spellcheck="false"
                aria-label="搜索接收人"
              />
            </div>
            <button class="picker-all" :disabled="visible.length === 0" @click="toggleAll">
              {{ allVisibleSelected ? '取消全选' : '全选' }}
            </button>
          </div>

          <div class="picker-list">
            <label v-for="peer in visible" :key="peer.key" class="picker-item">
              <input type="checkbox" :checked="selected.has(peer.key)" @change="toggle(peer.key)" />
              <span class="picker-avatar">
                <img
                  v-if="avatarUrl(peer.avatarMd5) !== ''"
                  :src="avatarUrl(peer.avatarMd5)"
                  alt=""
                />
                <template v-else>{{ initialOf(nameOf(peer)) }}</template>
              </span>
              <span class="picker-name">{{ nameOf(peer) }}</span>
              <span class="picker-state" :class="{ online: peer.online }">
                {{ peer.online ? '在线' : '离线' }}
              </span>
            </label>
            <div v-if="visible.length === 0" class="picker-empty">
              <Users :size="22" :stroke-width="1.5" />
              <p>{{ ordered.length === 0 ? '暂无联系人' : '没有匹配的联系人' }}</p>
            </div>
          </div>

          <p class="picker-summary">
            已选 {{ selected.size }} 人
            <span v-if="offlineCount > 0">· 其中 {{ offlineCount }} 位离线</span>
          </p>
        </section>

        <section class="compose">
          <div class="compose-head">
            <strong>{{
              selectedPeers.length === 0
                ? '未选择接收人'
                : `发送给 ${selectedPeers.length} 位联系人`
            }}</strong>
            <span v-if="offlineCount > 0" class="compose-hint">离线的只排队文字</span>
          </div>
          <div class="compose-fill">
            <Composer
              :draft="draft"
              :sending="busy"
              :blocked="selected.size === 0"
              conversation-title="群发"
              :conversation-id="batchId"
              :staged="staged"
              @update:draft="draft = $event"
              @send-rich="send"
              @remove-staged="removeStaged"
            />
          </div>
          <p v-if="error" class="compose-error">{{ error }}</p>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.batch-mask {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.28);
}

.batch-dialog {
  display: flex;
  flex-direction: column;
  width: min(860px, calc(100vw - 48px));
  height: min(620px, calc(100vh - 64px));
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.22);
  overflow: hidden;
}

.batch-head {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px 12px;
  border-bottom: 1px solid var(--divider);
}

.batch-head h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.batch-head p {
  margin: 3px 0 0;
  font-size: 11.5px;
  color: var(--text-secondary);
}

.batch-close {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  color: var(--text-muted);
}

.batch-close:hover {
  background: var(--hover);
}

.batch-body {
  flex: 1;
  min-height: 0;
  display: flex;
}

.picker {
  flex: 0 0 300px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--divider);
}

.picker-top {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px 6px;
}

.picker-search {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 8px;
  border-radius: var(--radius-button);
  background: #eef0f1;
  color: var(--text-muted);
}

.picker-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  font-size: 12.5px;
  color: var(--text);
}

.picker-all {
  flex: 0 0 auto;
  height: 28px;
  padding: 0 10px;
  border: 1px solid #dcdcdc;
  border-radius: var(--radius-button);
  background: #ffffff;
  color: var(--text-secondary);
  font-size: 12px;
}

.picker-all:hover:not(:disabled) {
  color: var(--text);
  background: var(--hover);
}

.picker-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 6px;
}

.picker-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 6px;
  cursor: pointer;
}

.picker-item:hover {
  background: var(--hover);
}

.picker-item input {
  flex: 0 0 auto;
  accent-color: var(--accent);
}

.picker-avatar {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  overflow: hidden;
  background: #d9e2ea;
  color: #4c5a68;
  font-size: 11px;
}

.picker-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.picker-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  color: var(--text);
}

.picker-state {
  flex: 0 0 auto;
  font-size: 10.5px;
  color: var(--text-muted);
}

.picker-state.online {
  color: #068d47;
}

.picker-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 40px 10px;
  color: var(--text-muted);
  font-size: 12px;
}

.picker-empty p {
  margin: 0;
}

.picker-summary {
  flex: 0 0 auto;
  margin: 0;
  padding: 8px 14px;
  border-top: 1px solid #f0f0f0;
  font-size: 11.5px;
  color: var(--text-secondary);
}

.compose {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--page-bg);
}

.compose-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--divider);
  background: #ffffff;
  font-size: 12.5px;
  color: var(--text);
}

.compose-hint {
  font-size: 11px;
  color: var(--warning);
}

.compose-fill {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

.compose-error {
  flex: 0 0 auto;
  margin: 0;
  padding: 6px 16px 10px;
  color: var(--danger);
  font-size: 11.5px;
}

@media (max-width: 760px) {
  .batch-body {
    flex-direction: column;
  }

  .picker {
    flex: 0 0 40%;
    border-right: 0;
    border-bottom: 1px solid var(--divider);
  }
}
</style>
