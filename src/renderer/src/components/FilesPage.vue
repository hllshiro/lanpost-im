<script setup lang="ts">
import { computed, ref } from 'vue'
import { File, FileArchive, FileText, FolderOpen, Image } from '@lucide/vue'
import type { Component } from 'vue'
import type { FileTaskInfo } from '../../../shared/domain'
import { useAppStore } from '../stores/app'
import { formatConversationTime, formatSize } from '../utils/format'

type TabId = 'all' | 'receiving' | 'received' | 'sent' | 'failed'

const store = useAppStore()
const tab = ref<TabId>('all')
const busyId = ref<string | null>(null)

const tabs: Array<{ id: TabId; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'receiving', label: '接收中' },
  { id: 'received', label: '已接收' },
  { id: 'sent', label: '已发送' },
  { id: 'failed', label: '失败' }
]

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'])
const ARCHIVE_EXTENSIONS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'])
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'log', 'csv', 'json', 'xml', 'yml', 'yaml'])

const sortedFiles = computed(() =>
  [...store.files].sort((left, right) => right.createdAt - left.createdAt)
)

const conversationByConversationId = computed(() => {
  const map = new Map<string, { peerKey: string | null; title: string }>()
  for (const conversation of store.conversations) {
    map.set(conversation.id, { peerKey: conversation.peerKey, title: conversation.title })
  }
  return map
})

const peerByKey = computed(() => {
  const map = new Map<string, { name: string; alias: string; user: string; ip: string }>()
  for (const peer of store.peers) {
    map.set(peer.key, {
      name: peer.name,
      alias: peer.alias,
      user: peer.user,
      ip: peer.ip
    })
  }
  return map
})

function peerLabel(file: FileTaskInfo): string {
  const conversation = conversationByConversationId.value.get(file.conversationId)
  const peerKey = file.peerKey ?? conversation?.peerKey ?? null
  const peer = peerKey ? peerByKey.value.get(peerKey) : undefined
  if (peer) return peer.alias.trim() || peer.name || peer.user || peer.ip
  return conversation?.title ?? '未知联系人'
}

function activeStates(file: FileTaskInfo): boolean {
  return file.state === 'waiting' || file.state === 'offered' || file.state === 'transferring'
}

function failedStates(file: FileTaskInfo): boolean {
  return file.state === 'failed' || file.state === 'rejected' || file.state === 'canceled'
}

function matches(file: FileTaskInfo, target: TabId): boolean {
  switch (target) {
    case 'receiving':
      return file.direction === 'in' && activeStates(file)
    case 'received':
      return file.direction === 'in' && file.state === 'done'
    case 'sent':
      return file.direction === 'out' && file.state === 'done'
    case 'failed':
      return failedStates(file)
    case 'all':
      return true
  }
}

const visibleFiles = computed(() => sortedFiles.value.filter((file) => matches(file, tab.value)))

function countOf(target: TabId): number {
  return sortedFiles.value.filter((file) => matches(file, target)).length
}

function stateText(file: FileTaskInfo): string {
  switch (file.state) {
    case 'waiting':
    case 'offered':
      return file.direction === 'in' ? '等待接收' : '等待对方接收'
    case 'transferring':
      return file.direction === 'in' ? '接收中' : '发送中'
    case 'done':
      return file.direction === 'in' ? '已接收' : '已发送'
    case 'rejected':
      return file.direction === 'in' ? '已拒绝' : '对方已拒绝'
    case 'failed':
      return '失败'
    case 'canceled':
      return '已取消'
    default:
      return file.state
  }
}

function stateClass(file: FileTaskInfo): string {
  if (file.state === 'done') return 'done'
  if (failedStates(file)) return 'failed'
  if (file.state === 'transferring') return 'active'
  return 'waiting'
}

function directionText(file: FileTaskInfo): string {
  return file.direction === 'in' ? '接收' : '发送'
}

function canReceive(file: FileTaskInfo): boolean {
  return file.direction === 'in' && (file.state === 'waiting' || file.state === 'offered')
}

function percentOf(file: FileTaskInfo): number {
  if (file.size <= 0) return 0
  return Math.min(100, Math.round((file.received / file.size) * 100))
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.')
  return index >= 0 ? name.slice(index + 1).toLowerCase() : ''
}

function iconFor(name: string): Component {
  const extension = extensionOf(name)
  if (IMAGE_EXTENSIONS.has(extension)) return Image
  if (ARCHIVE_EXTENSIONS.has(extension)) return FileArchive
  if (TEXT_EXTENSIONS.has(extension)) return FileText
  return File
}

async function run(file: FileTaskInfo, task: () => Promise<void>): Promise<void> {
  if (busyId.value !== null) return
  busyId.value = file.id
  try {
    await task()
  } catch (reason) {
    store.reportError(reason)
  } finally {
    busyId.value = null
  }
}

function accept(file: FileTaskInfo): void {
  void run(file, () => window.api.files.accept(file.id))
}

function reject(file: FileTaskInfo): void {
  void run(file, () => window.api.files.reject(file.id))
}

function openFile(file: FileTaskInfo): void {
  void run(file, () => window.api.files.open(file.id))
}

function revealFile(file: FileTaskInfo): void {
  void run(file, () => window.api.files.reveal(file.id))
}

function saveFile(file: FileTaskInfo): void {
  void run(file, () => window.api.files.saveAs(file.id))
}

const emptyText = computed(() => {
  if (store.files.length === 0) return '暂无文件记录'
  switch (tab.value) {
    case 'receiving':
      return '没有正在接收的文件'
    case 'received':
      return '没有已接收的文件'
    case 'sent':
      return '没有已发送的文件'
    case 'failed':
      return '没有失败的文件'
    default:
      return '暂无文件记录'
  }
})
</script>

<template>
  <section class="files" aria-label="文件">
    <header class="page-head">
      <div class="title-block">
        <h1>文件</h1>
        <p>共 {{ store.files.length }} 个文件任务</p>
      </div>
      <div class="tabs" role="tablist">
        <button
          v-for="entry in tabs"
          :key="entry.id"
          class="tab"
          :class="{ active: tab === entry.id }"
          role="tab"
          :aria-selected="tab === entry.id"
          @click="tab = entry.id"
        >
          <span>{{ entry.label }}</span>
          <span v-if="countOf(entry.id) > 0" class="count">{{ countOf(entry.id) }}</span>
        </button>
      </div>
    </header>

    <div class="scroll">
      <div class="inner">
        <div v-if="visibleFiles.length > 0" class="table">
          <div class="table-head">
            <span>文件</span>
            <span>对端</span>
            <span>大小</span>
            <span>状态</span>
            <span>操作</span>
          </div>

          <div v-for="file in visibleFiles" :key="file.id" class="row">
            <div class="file-cell">
              <span class="file-icon">
                <component :is="iconFor(file.name)" :size="19" :stroke-width="1.6" />
              </span>
              <div class="file-text">
                <p class="file-name" :title="file.name">{{ file.name }}</p>
                <p class="file-meta">
                  <span class="direction" :class="file.direction">
                    {{ directionText(file) }}
                  </span>
                  <span>{{ formatConversationTime(file.createdAt) }}</span>
                </p>
                <p v-if="file.error" class="file-error">{{ file.error }}</p>
              </div>
            </div>

            <div class="peer-cell" :title="peerLabel(file)">{{ peerLabel(file) }}</div>

            <div class="size-cell">{{ formatSize(file.size) }}</div>

            <div class="state-cell">
              <span class="state" :class="stateClass(file)">{{ stateText(file) }}</span>
              <span v-if="file.state === 'transferring'" class="progress">
                <span class="progress-fill" :style="{ width: `${percentOf(file)}%` }" />
              </span>
              <span v-if="file.state === 'transferring'" class="progress-text">
                {{ percentOf(file) }}% · {{ formatSize(file.received) }} /
                {{ formatSize(file.size) }}
              </span>
            </div>

            <div class="actions">
              <template v-if="canReceive(file)">
                <button class="action primary" :disabled="busyId !== null" @click="accept(file)">
                  接收
                </button>
                <button class="action" :disabled="busyId !== null" @click="reject(file)">
                  拒绝
                </button>
              </template>
              <template v-else-if="file.state === 'done'">
                <button class="action" :disabled="busyId !== null" @click="openFile(file)">
                  打开文件
                </button>
                <button class="action" :disabled="busyId !== null" @click="revealFile(file)">
                  打开文件夹
                </button>
                <button class="action" :disabled="busyId !== null" @click="saveFile(file)">
                  另存为
                </button>
              </template>
              <span v-else class="no-action">—</span>
            </div>
          </div>
        </div>

        <div v-else class="empty">
          <FolderOpen :size="34" :stroke-width="1.3" />
          <p>{{ emptyText }}</p>
          <small v-if="store.files.length === 0">收到或发送文件后会显示在这里</small>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.files {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--page-bg);
}

.page-head {
  flex: 0 0 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 0 24px;
  border-bottom: 1px solid var(--divider);
  background: var(--page-bg);
}

.title-block {
  min-width: 0;
}

.title-block h1 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}

.title-block p {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--text-secondary);
}

.tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 4px 8px;
  border-radius: var(--radius-button);
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.tab:hover {
  background: #ebebeb;
  color: var(--text);
}

.tab.active {
  background: #e6f7ec;
  color: var(--accent);
  font-weight: 600;
}

.count {
  font-size: 10px;
  font-weight: 500;
  opacity: 0.85;
}

.scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.inner {
  max-width: 1080px;
  margin: 0 auto;
  padding: 18px 24px 32px;
}

.table {
  overflow: hidden;
  border: 1px solid var(--divider);
  border-radius: var(--radius-card);
  background: var(--card-bg);
}

.table-head,
.row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 118px 76px 104px 220px;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
}

.table-head {
  height: 34px;
  border-bottom: 1px solid var(--divider);
  background: #fafafa;
  font-size: 11px;
  color: var(--text-secondary);
}

.table-head span:last-child {
  text-align: right;
}

.row {
  min-height: 64px;
  padding-top: 9px;
  padding-bottom: 9px;
  border-bottom: 1px solid #f0f0f0;
}

.row:last-child {
  border-bottom: 0;
}

.row:hover {
  background: #fafafa;
}

.file-cell {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}

.file-icon {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: var(--radius-button);
  background: #f2f3f5;
  color: #5b6570;
}

.file-text {
  min-width: 0;
}

.file-name {
  margin: 1px 0 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--text);
}

.file-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  margin: 0;
  font-size: 10.5px;
  color: var(--text-secondary);
}

.direction {
  flex: 0 0 auto;
  padding: 0 4px;
  border-radius: 2px;
  font-size: 10px;
  line-height: 15px;
}

.direction.in {
  color: #068d47;
  background: var(--accent-soft);
}

.direction.out {
  color: #3f6a8a;
  background: #edf3f8;
}

.file-error {
  margin: 4px 0 0;
  font-size: 10.5px;
  line-height: 1.4;
  color: var(--danger);
  word-break: break-all;
}

.peer-cell {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text);
}

.size-cell {
  font-size: 11.5px;
  color: var(--text-secondary);
}

.state-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.state {
  font-size: 11.5px;
  color: var(--text-secondary);
}

.state.done {
  color: #068d47;
}

.state.active {
  color: var(--accent);
}

.state.waiting {
  color: #b8720a;
}

.state.failed {
  color: var(--danger);
}

.progress {
  display: block;
  width: 100%;
  height: 3px;
  overflow: hidden;
  border-radius: 2px;
  background: #ededed;
}

.progress-fill {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 0.2s ease;
}

.progress-text {
  font-size: 9.5px;
  color: var(--text-muted);
  white-space: nowrap;
}

.actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  min-width: 0;
}

.action {
  flex: 0 0 auto;
  padding: 3px 7px;
  border: 1px solid #e0e0e0;
  border-radius: var(--radius-button);
  background: #ffffff;
  font-size: 11.5px;
  color: #444444;
  white-space: nowrap;
}

.action:hover:not(:disabled) {
  border-color: #c9c9c9;
  background: #f7f7f7;
}

.action.primary {
  border-color: var(--accent);
  background: var(--accent);
  color: #ffffff;
}

.action.primary:hover:not(:disabled) {
  border-color: var(--accent-hover);
  background: var(--accent-hover);
}

.action:disabled {
  opacity: 0.55;
}

.no-action {
  font-size: 11.5px;
  color: var(--text-muted);
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 96px 20px;
  color: var(--text-muted);
  text-align: center;
}

.empty p {
  margin: 4px 0 0;
  font-size: 13px;
}

.empty small {
  font-size: 11.5px;
  color: #c2c2c2;
}

@media (max-width: 960px) {
  .page-head {
    padding: 0 18px;
  }

  .inner {
    padding: 16px 18px 24px;
  }

  .table-head,
  .row {
    grid-template-columns: minmax(0, 1fr) 96px 68px 96px 208px;
    gap: 9px;
    padding-left: 12px;
    padding-right: 12px;
  }

  .tab {
    padding: 4px 6px;
  }
}
</style>
