<script setup lang="ts">
import { computed, ref } from 'vue'
import { X } from '@lucide/vue'
import type { PeerInfo } from '../../../shared/domain'
import type { PeerMergeResult } from '../../../shared/ipc'
import { errorMessage } from '../utils/errors'
import { comparePinyin } from '../utils/pinyin'

const props = defineProps<{ peers: PeerInfo[] }>()
const emit = defineEmits<{
  close: []
  merged: [payload: { targetKey: string; result: PeerMergeResult }]
}>()

function nameOf(peer: PeerInfo): string {
  return peer.alias.trim() || peer.name || peer.user || peer.ip
}

const ordered = computed(() =>
  [...props.peers].sort((left, right) => comparePinyin(nameOf(left), nameOf(right)))
)

const targetKey = ref(ordered.value[0]?.key ?? '')
const origins = ref<Set<string>>(new Set())
const busy = ref(false)
const error = ref('')

const candidates = computed(() => ordered.value.filter((peer) => peer.key !== targetKey.value))
const originPeers = computed(() =>
  ordered.value.filter((peer) => peer.key !== targetKey.value && origins.value.has(peer.key))
)
const target = computed(() => ordered.value.find((peer) => peer.key === targetKey.value) ?? null)

function toggle(key: string): void {
  const next = new Set(origins.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  origins.value = next
}

function chooseTarget(key: string): void {
  targetKey.value = key
  const next = new Set(origins.value)
  next.delete(key)
  origins.value = next
}

async function submit(): Promise<void> {
  if (busy.value || target.value === null || originPeers.value.length === 0) return
  busy.value = true
  error.value = ''
  try {
    const result = await window.api.peers.merge(
      target.value.key,
      originPeers.value.map((peer) => peer.key)
    )
    emit('merged', { targetKey: target.value.key, result })
  } catch (reason) {
    error.value = errorMessage(reason)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="merge-mask" @mousedown.self="busy || emit('close')">
    <div class="merge-dialog" role="dialog" aria-modal="true" aria-label="合并联系人">
      <header class="merge-head">
        <div>
          <h2>合并联系人</h2>
          <p class="merge-hint">
            来源联系人的聊天记录、文件记录与群成员身份会转到目标联系人，来源联系人会被移除。
          </p>
        </div>
        <button class="merge-close" title="关闭" :disabled="busy" @click="emit('close')">
          <X :size="16" />
        </button>
      </header>

      <div class="merge-body">
        <section class="merge-block">
          <h3>目标联系人（保留）</h3>
          <div class="merge-select">
            <select
              :value="targetKey"
              :disabled="busy"
              aria-label="目标联系人"
              @change="chooseTarget(($event.target as HTMLSelectElement).value)"
            >
              <option v-for="peer in ordered" :key="peer.key" :value="peer.key">
                {{ nameOf(peer) }} · {{ peer.key.slice(0, 8) }}
              </option>
            </select>
          </div>
        </section>

        <section class="merge-block">
          <h3>来源联系人（并入目标）</h3>
          <ul class="merge-list">
            <li v-for="peer in candidates" :key="peer.key">
              <label class="merge-item">
                <input
                  type="checkbox"
                  :checked="origins.has(peer.key)"
                  :disabled="busy"
                  @change="toggle(peer.key)"
                />
                <span class="merge-name">{{ nameOf(peer) }}</span>
                <span class="merge-id">{{ peer.key.slice(0, 12) }}</span>
                <span class="merge-state">{{ peer.online ? '在线' : '离线' }}</span>
              </label>
            </li>
            <li v-if="candidates.length === 0" class="merge-empty">没有其他联系人</li>
          </ul>
        </section>

        <p v-if="error" class="merge-error">{{ error }}</p>
      </div>

      <footer class="merge-foot">
        <span class="merge-count">
          已选 {{ originPeers.length }} 个来源，合并到
          {{ target === null ? '—' : nameOf(target) }}
        </span>
        <div class="merge-actions">
          <button class="merge-secondary" :disabled="busy" @click="emit('close')">取消</button>
          <button
            class="merge-primary"
            :disabled="busy || target === null || originPeers.length === 0"
            @click="submit"
          >
            {{ busy ? '合并中…' : '合并' }}
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.merge-mask {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  background: rgba(20, 24, 28, 0.42);
}

.merge-dialog {
  width: 480px;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.22);
}

.merge-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 20px 8px;
}

.merge-head h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}

.merge-hint {
  margin: 6px 0 0;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--text-faint);
}

.merge-close {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-faint);
}

.merge-close:hover:not(:disabled) {
  background: #f1f2f4;
  color: var(--text);
}

.merge-body {
  padding: 4px 20px 8px;
  overflow-y: auto;
}

.merge-block h3 {
  margin: 12px 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.merge-select select {
  width: 100%;
  height: 32px;
  padding: 0 8px;
  border: 1px solid #dcdcdc;
  border-radius: 6px;
  background: #ffffff;
  font-size: 12.5px;
  color: var(--text);
}

.merge-list {
  margin: 0;
  padding: 0;
  max-height: 220px;
  overflow-y: auto;
  list-style: none;
  border: 1px solid #f0f1f3;
  border-radius: 8px;
}

.merge-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid #f6f7f8;
  font-size: 12.5px;
}

.merge-item:hover {
  background: #fafbfc;
}

.merge-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}

.merge-id {
  color: #a8adb4;
  font-size: 11px;
}

.merge-state {
  color: var(--text-faint);
  font-size: 11px;
}

.merge-empty {
  padding: 18px 10px;
  text-align: center;
  font-size: 12px;
  color: var(--text-faint);
}

.merge-error {
  margin: 10px 0 4px;
  font-size: 12px;
  color: #c0392b;
}

.merge-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 20px 16px;
  border-top: 1px solid #f0f1f3;
}

.merge-count {
  font-size: 11.5px;
  color: var(--text-faint);
}

.merge-actions {
  display: flex;
  gap: 8px;
}

.merge-secondary,
.merge-primary {
  height: 30px;
  padding: 0 14px;
  border-radius: 6px;
  font-size: 12px;
}

.merge-secondary {
  border: 1px solid #dcdcdc;
  background: #ffffff;
  color: var(--text);
}

.merge-primary {
  border: 0;
  background: var(--accent);
  color: #ffffff;
}

.merge-primary:disabled,
.merge-secondary:disabled {
  opacity: 0.6;
}
</style>
