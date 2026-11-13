<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { ChevronRight, Merge, Search, Users, X } from '@lucide/vue'
import type { GroupInfo, PeerInfo } from '../../../shared/domain'
import type { PeerMergeResult } from '../../../shared/ipc'
import { useAppStore } from '../stores/app'
import { avatarUrl } from '../utils/avatar'
import { errorMessage } from '../utils/errors'
import { initialOf } from '../utils/format'
import GroupMark from './GroupMark.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import MergePeersDialog from './MergePeersDialog.vue'
import { compareLetters, comparePinyin, pinyinInfo } from '../utils/pinyin'

const emit = defineEmits<{ open: [conversationId: string] }>()

const store = useAppStore()
const query = ref('')
const activeLetter = ref<string | null>(null)
const boxOpen = ref(false)
const boxMode = ref<'broadcast' | 'multicast'>('broadcast')
const boxText = ref('')
const boxError = ref('')
const boxBusy = ref(false)
const selected = ref<Set<string>>(new Set())
const tab = ref<'contacts' | 'groups'>('contacts')
const deleteTarget = ref<
  { kind: 'peer'; peer: PeerInfo } | { kind: 'group'; group: GroupInfo } | null
>(null)
const deleteBusy = ref(false)
const deleteError = ref('')
const mergeOpen = ref(false)
const mergeNote = ref('')
let mergeTimer: ReturnType<typeof setTimeout> | undefined

const keyword = computed(() => query.value.trim().toLowerCase())

const groupConversations = computed(() => {
  const map = new Map<string, string>()
  for (const conversation of store.conversations) {
    if (conversation.kind === 'group')
      map.set(conversation.id.slice('group:'.length), conversation.id)
  }
  return map
})

const groupRows = computed(() =>
  store.groups
    .map((group) => ({ group, conversationId: groupConversations.value.get(group.id) ?? '' }))
    .filter(({ group }) => keyword.value === '' || group.name.toLowerCase().includes(keyword.value))
    .sort((left, right) => comparePinyin(left.group.name, right.group.name))
)

const conversationByPeer = computed(() => {
  const map = new Map<string, string>()
  for (const conversation of store.conversations) {
    if (conversation.peerKey) map.set(conversation.peerKey, conversation.id)
  }
  return map
})

function displayName(peer: PeerInfo): string {
  return peer.alias.trim() || peer.name || peer.user || peer.ip
}

function statusText(peer: PeerInfo): string {
  if (!peer.online) return '离线'
  if (peer.status === 1) return '忙碌'
  if (peer.status === 2) return '离开'
  return '在线'
}

function statusClass(peer: PeerInfo): string {
  if (!peer.online) return 'offline'
  if (peer.status === 1) return 'busy'
  if (peer.status === 2) return 'away'
  return 'online'
}

function groupText(peer: PeerInfo): string {
  const parts = [peer.group, peer.department].map((item) => item.trim()).filter(Boolean)
  return parts.join(' · ')
}

const onlineCount = computed(() => store.peers.filter((peer) => peer.online).length)

const ordered = computed(() =>
  [...store.peers].sort((left, right) => comparePinyin(displayName(left), displayName(right)))
)

const letters = computed(() => {
  const set = new Set<string>()
  for (const peer of store.peers) {
    set.add(pinyinInfo(displayName(peer)).letter)
  }
  return [...set].sort(compareLetters)
})

const visible = computed(() => {
  let list = ordered.value
  if (activeLetter.value !== null) {
    list = list.filter((peer) => pinyinInfo(displayName(peer)).letter === activeLetter.value)
  }
  if (!keyword.value) return list
  return list.filter((peer) => {
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
    const info = pinyinInfo(displayName(peer))
    return info.full.includes(keyword.value) || info.initials.includes(keyword.value)
  })
})

const groups = computed(() => {
  const map = new Map<string, PeerInfo[]>()
  for (const peer of visible.value) {
    const letter = pinyinInfo(displayName(peer)).letter
    const bucket = map.get(letter)
    if (bucket === undefined) map.set(letter, [peer])
    else bucket.push(peer)
  }
  return [...map.entries()]
    .map(([letter, peers]) => ({ letter, peers }))
    .sort((left, right) => compareLetters(left.letter, right.letter))
})

const emptyText = computed(() => {
  if (store.peers.length === 0) return '暂无联系人'
  if (activeLetter.value !== null && keyword.value === '') {
    return `没有 ${activeLetter.value} 开头的联系人`
  }
  return '没有匹配的联系人'
})

async function handleMerged(payload: {
  targetKey: string
  result: PeerMergeResult
}): Promise<void> {
  mergeOpen.value = false
  await store.loadSnapshot()
  const parts = [
    `已把 ${payload.result.peers} 个联系人合并到目标`,
    `转入消息 ${payload.result.messages} 条`
  ]
  if (payload.result.skipped > 0) parts.push(`跳过重复 ${payload.result.skipped} 条`)
  if (payload.result.files > 0) parts.push(`文件记录 ${payload.result.files} 个`)
  mergeNote.value = parts.join('，')
  if (mergeTimer !== undefined) clearTimeout(mergeTimer)
  mergeTimer = setTimeout(() => {
    mergeNote.value = ''
  }, 5000)
}

onBeforeUnmount(() => {
  if (mergeTimer !== undefined) clearTimeout(mergeTimer)
})

function askDeletePeer(peer: PeerInfo): void {
  deleteError.value = ''
  deleteTarget.value = { kind: 'peer', peer }
}

function askDeleteGroup(group: GroupInfo): void {
  deleteError.value = ''
  deleteTarget.value = { kind: 'group', group }
}

async function confirmDelete(): Promise<void> {
  const target = deleteTarget.value
  if (target === null || deleteBusy.value) return
  deleteBusy.value = true
  deleteError.value = ''
  try {
    if (target.kind === 'peer') {
      await window.api.peers.remove(target.peer.key)
    } else {
      await window.api.groups.remove(target.group.id)
    }
    deleteTarget.value = null
    await store.loadSnapshot()
  } catch (reason) {
    deleteError.value = errorMessage(reason)
  } finally {
    deleteBusy.value = false
  }
}

function toggleLetter(letter: string): void {
  activeLetter.value = activeLetter.value === letter ? null : letter
}

function hasConversation(peer: PeerInfo): boolean {
  return conversationByPeer.value.has(peer.key)
}

function isCurrent(peer: PeerInfo): boolean {
  return conversationByPeer.value.get(peer.key) === store.currentConversationId
}

function openPeer(peer: PeerInfo): void {
  if (boxOpen.value) {
    toggleSelect(peer.key)
    return
  }
  const conversationId = conversationByPeer.value.get(peer.key)
  if (!conversationId) return
  emit('open', conversationId)
}

function openBox(mode: 'broadcast' | 'multicast'): void {
  boxMode.value = mode
  boxOpen.value = true
  boxError.value = ''
  boxText.value = ''
  selected.value = new Set()
}

function closeBox(): void {
  boxOpen.value = false
  boxError.value = ''
  boxText.value = ''
  selected.value = new Set()
}

function toggleSelect(peerKey: string): void {
  const next = new Set(selected.value)
  if (next.has(peerKey)) next.delete(peerKey)
  else next.add(peerKey)
  selected.value = next
}

async function sendBox(): Promise<void> {
  const text = boxText.value.trim()
  if (text === '') {
    boxError.value = '请输入要发送的内容'
    return
  }
  boxBusy.value = true
  boxError.value = ''
  const count =
    boxMode.value === 'broadcast'
      ? await store.broadcastText(text)
      : await store.multicastText([...selected.value], text)
  boxBusy.value = false
  if (count > 0) {
    closeBox()
  } else {
    boxError.value = '没有可发送的在线联系人'
  }
}
</script>

<template>
  <section class="contacts" aria-label="联系人">
    <header class="page-head">
      <div class="title-block">
        <h1>联系人</h1>
        <p>
          {{ onlineCount }} 位在线 · 共 {{ store.peers.length }} 位 · {{ store.groups.length }} 个群
          <template v-if="activeLetter !== null"> · {{ activeLetter }} 开头</template>
        </p>
      </div>
      <div v-if="tab === 'contacts'" class="head-actions">
        <button class="broadcast" @click="openBox('broadcast')">广播</button>
        <button class="broadcast secondary" @click="openBox('multicast')">多选</button>
        <button class="broadcast secondary" @click="mergeOpen = true">
          <Merge :size="13" :stroke-width="1.9" />
          合并
        </button>
      </div>
      <div class="search">
        <Search :size="14" :stroke-width="1.8" />
        <input
          v-model="query"
          type="text"
          :placeholder="tab === 'contacts' ? '搜索名称、账号、分组、IP 或拼音' : '搜索群聊'"
          autocomplete="off"
          spellcheck="false"
          aria-label="搜索联系人"
        />
        <button v-if="query" class="clear" title="清空搜索" @click="query = ''">
          <X :size="13" />
        </button>
      </div>
    </header>

    <p v-if="mergeNote" class="merge-note">{{ mergeNote }}</p>

    <MergePeersDialog
      v-if="mergeOpen"
      :peers="store.peers"
      @close="mergeOpen = false"
      @merged="handleMerged"
    />

    <ConfirmDialog
      v-if="deleteTarget !== null"
      :title="deleteTarget.kind === 'peer' ? '删除联系人' : '删除群'"
      :message="
        deleteTarget.kind === 'peer'
          ? `将从本机删除「${displayName(deleteTarget.peer)}」的聊天记录与文件记录。在线联系人下次广播会被重新发现。`
          : `将从本机删除群「${deleteTarget.group.name}」的群记录与聊天记录，能通知到的成员会收到退群或解散。`
      "
      :busy="deleteBusy"
      :error="deleteError"
      @cancel="deleteTarget = null"
      @confirm="confirmDelete"
    />

    <div class="tabs" role="tablist" aria-label="联系人分类">
      <button
        role="tab"
        :aria-selected="tab === 'contacts'"
        :class="{ active: tab === 'contacts' }"
        @click="tab = 'contacts'"
      >
        联系人<span class="tab-count">{{ store.peers.length }}</span>
      </button>
      <button
        role="tab"
        :aria-selected="tab === 'groups'"
        :class="{ active: tab === 'groups' }"
        @click="tab = 'groups'"
      >
        群聊<span class="tab-count">{{ store.groups.length }}</span>
      </button>
    </div>

    <div class="scroll">
      <div class="inner">
        <div v-if="tab === 'contacts'" class="list">
          <template v-for="group in groups" :key="group.letter">
            <div class="letter-head">{{ group.letter }}</div>
            <div
              v-for="peer in group.peers"
              :key="peer.key"
              class="peer"
              role="button"
              :tabindex="hasConversation(peer) ? 0 : -1"
              :class="{
                current: isCurrent(peer),
                unavailable: !hasConversation(peer),
                selected: selected.has(peer.key)
              }"
              :title="hasConversation(peer) ? '打开聊天' : '会话尚未建立'"
              @click="openPeer(peer)"
              @keydown.enter="openPeer(peer)"
            >
              <span class="avatar-wrap">
                <span class="avatar">
                  <img
                    v-if="avatarUrl(peer.avatarMd5) !== ''"
                    :src="avatarUrl(peer.avatarMd5)"
                    alt=""
                  />
                  <template v-else>{{ initialOf(displayName(peer)) }}</template>
                </span>
                <span class="dot" :class="statusClass(peer)" />
              </span>

              <span class="main">
                <span class="line">
                  <span class="name">{{ displayName(peer) }}</span>
                  <span class="status" :class="statusClass(peer)">{{ statusText(peer) }}</span>
                </span>
                <span v-if="groupText(peer) || peer.sign.trim()" class="meta">
                  <span v-if="groupText(peer)" class="group">{{ groupText(peer) }}</span>
                  <span v-if="groupText(peer) && peer.sign.trim()" class="sep">·</span>
                  <span v-if="peer.sign.trim()" class="sign">{{ peer.sign }}</span>
                </span>
              </span>

              <span class="address">
                <span class="ip">{{ peer.ip }}</span>
              </span>

              <span
                v-if="boxOpen && boxMode === 'multicast'"
                class="select-mark"
                :class="{ checked: selected.has(peer.key) }"
              />
              <template v-else>
                <button class="row-delete" title="删除联系人" @click.stop="askDeletePeer(peer)">
                  删除
                </button>
                <ChevronRight :size="16" :stroke-width="1.8" class="chevron" />
              </template>
            </div>
          </template>

          <div v-if="visible.length === 0" class="empty">
            <Users :size="30" :stroke-width="1.4" />
            <p>{{ emptyText }}</p>
            <small v-if="store.peers.length === 0">局域网内发现对端后会显示在这里</small>
          </div>
        </div>

        <div v-else class="list">
          <div
            v-for="row in groupRows"
            :key="row.group.id"
            class="peer"
            role="button"
            :tabindex="row.conversationId === '' ? -1 : 0"
            :class="{ unavailable: row.conversationId === '' }"
            :title="row.conversationId === '' ? '群会话尚未建立' : '打开群聊'"
            @click="row.conversationId !== '' && emit('open', row.conversationId)"
            @keydown.enter="row.conversationId !== '' && emit('open', row.conversationId)"
          >
            <span class="avatar-wrap">
              <span class="avatar">
                <img
                  v-if="avatarUrl(row.group.photoMd5) !== ''"
                  :src="avatarUrl(row.group.photoMd5)"
                  alt=""
                />
                <template v-else>{{ initialOf(row.group.name) }}</template>
              </span>
              <GroupMark />
            </span>

            <span class="main">
              <span class="line">
                <span class="name">{{ row.group.name }}</span>
                <span class="status online">{{ row.group.members.length }} 人</span>
              </span>
              <span v-if="row.group.topic.trim()" class="meta">
                <span class="sign">{{ row.group.topic }}</span>
              </span>
            </span>

            <span class="address">
              <span class="ip">群聊</span>
            </span>

            <button class="row-delete" title="删除群" @click.stop="askDeleteGroup(row.group)">
              删除
            </button>
            <ChevronRight :size="16" :stroke-width="1.8" class="chevron" />
          </div>

          <div v-if="groupRows.length === 0" class="empty">
            <Users :size="30" :stroke-width="1.4" />
            <p>{{ query.trim() === '' ? '暂无群聊' : '没有匹配的群聊' }}</p>
          </div>
        </div>
      </div>
    </div>

    <div v-if="boxOpen" class="broadcast-box">
      <div class="box-head">
        <strong>{{ boxMode === 'broadcast' ? '全体在线' : `已选 ${selected.size} 人` }}</strong>
        <button class="box-close" title="关闭" @click="closeBox">×</button>
      </div>
      <input
        v-model="boxText"
        :placeholder="boxMode === 'broadcast' ? '发送给所有在线联系人' : '发送给选中的联系人'"
        :disabled="boxBusy"
        @keydown.enter.prevent="sendBox"
      />
      <div class="box-actions">
        <span v-if="boxError" class="box-error">{{ boxError }}</span>
        <button class="ghost" :disabled="boxBusy" @click="closeBox">取消</button>
        <button class="primary" :disabled="boxBusy" @click="sendBox">
          {{ boxBusy ? '发送中…' : '发送' }}
        </button>
      </div>
    </div>

    <nav v-if="letters.length > 1 && tab === 'contacts'" class="letter-index" aria-label="拼音筛选">
      <button
        v-for="letter in letters"
        :key="letter"
        :class="{ active: activeLetter === letter }"
        :title="`只看 ${letter} 开头的联系人`"
        @click="toggleLetter(letter)"
      >
        {{ letter }}
      </button>
    </nav>
  </section>
</template>

<style scoped>
.contacts {
  position: relative;
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

.search {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 260px;
  height: 28px;
  padding: 0 8px;
  border-radius: var(--radius-button);
  background: #e9e9e9;
  color: var(--text-muted);
}

.search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  font-size: 12.5px;
  color: var(--text);
}

.clear {
  display: grid;
  place-items: center;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: #c8c8c8;
  color: #ffffff;
}

.clear:hover {
  background: #adadad;
}

.scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.inner {
  max-width: 920px;
  margin: 0 auto;
  padding: 18px 24px 32px;
}

.list {
  overflow: hidden;
  border: 1px solid var(--divider);
  border-radius: var(--radius-card);
  background: var(--card-bg);
}

.letter-head {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 6px 16px 4px;
  border-bottom: 1px solid #f0f0f0;
  background: var(--card-bg);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
}

.tabs {
  flex: 0 0 40px;
  display: flex;
  align-items: stretch;
  gap: 4px;
  padding: 0 20px;
  border-bottom: 1px solid var(--divider);
  background: var(--page-bg);
}

.tabs button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12.5px;
}

.tabs button:hover {
  color: var(--text);
}

.tabs button.active {
  border-bottom-color: var(--accent);
  color: var(--text);
  font-weight: 600;
}

.tab-count {
  min-width: 16px;
  padding: 0 5px;
  border-radius: 8px;
  background: #ececec;
  color: var(--text-muted);
  font-size: 10.5px;
  font-weight: 400;
  line-height: 16px;
  text-align: center;
}

.tabs button.active .tab-count {
  background: #e6f4ea;
  color: #2f7a45;
}

.row-delete {
  flex: 0 0 auto;
  padding: 2px 6px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #c0392b;
  font-size: 11.5px;
  opacity: 0;
  transition: opacity 0.12s ease;
}

.peer:hover .row-delete,
.peer:focus-within .row-delete {
  opacity: 1;
}

.row-delete:hover {
  background: #fdf0ee;
}

.peer {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 72px;
  padding: 12px 16px;
  border-bottom: 1px solid #f0f0f0;
  text-align: left;
  cursor: pointer;
}

.peer.unavailable {
  cursor: default;
}

.peer:last-of-type {
  border-bottom: 0;
}

.peer:hover:not(:disabled) {
  background: var(--hover);
}

.peer.current {
  background: #f3faf5;
}

.peer.current:hover {
  background: #edf7f0;
}

.peer.unavailable {
  opacity: 0.55;
}

.avatar-wrap {
  position: relative;
  flex: 0 0 auto;
  width: 42px;
  height: 42px;
}

.avatar {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: var(--avatar-radius);
  background: #d9e2ea;
  color: #4c5a68;
  font-size: 16px;
  font-weight: 500;
}

.avatar img {
  width: 100%;
  height: 100%;
  border-radius: inherit;
  object-fit: cover;
}

.dot {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 10px;
  height: 10px;
  border: 2px solid var(--card-bg);
  border-radius: 50%;
  background: #b8b8b8;
}

.dot.online {
  background: var(--accent);
}

.dot.busy {
  background: var(--warning);
}

.dot.away {
  background: #d9c04a;
}

.dot.offline {
  background: #b8b8b8;
}

.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  color: var(--text);
}

.status {
  flex: 0 0 auto;
  padding: 0 5px;
  border-radius: 3px;
  font-size: 10px;
  line-height: 16px;
  color: var(--text-secondary);
  background: #f0f0f0;
}

.status.online {
  color: #068d47;
  background: var(--accent-soft);
}

.status.busy {
  color: #b8720a;
  background: #fff3e0;
}

.status.away {
  color: #8a7a12;
  background: #f8f4d8;
}

.meta {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  font-size: 11.5px;
  color: var(--text-secondary);
}

.group {
  flex: 0 0 auto;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sign {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
}

.sep {
  flex: 0 0 auto;
  color: #c9c9c9;
}

.address {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  max-width: 150px;
  text-align: right;
}

.ip {
  font-size: 11.5px;
  color: var(--text-secondary);
}

.head-actions {
  display: flex;
  gap: 6px;
  margin-left: auto;
}

.broadcast {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 12px;
  border-radius: var(--radius-button);
  background: var(--accent);
  color: #ffffff;
  font-size: 12px;
}

.merge-note {
  flex: 0 0 auto;
  margin: 0;
  padding: 6px 24px;
  background: #f2f8f4;
  border-bottom: 1px solid #e3f0e7;
  font-size: 12px;
  color: #3d7a52;
}

.broadcast.secondary {
  background: #ffffff;
  border: 1px solid #dcdcdc;
  color: var(--text);
}

.peer.selected {
  background: #eef8f1;
}

.select-mark {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  border: 1px solid #c8c8c8;
  border-radius: 4px;
  background: #ffffff;
}

.select-mark.checked {
  border-color: var(--accent);
  background: var(--accent);
}

.broadcast-box {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 16px;
  z-index: 30;
  padding: 12px;
  border-radius: 10px;
  background: #ffffff;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);
}

.box-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 12.5px;
}

.box-close {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  color: var(--text-muted);
  font-size: 16px;
  line-height: 1;
}

.broadcast-box input {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 1px solid #dcdcdc;
  border-radius: var(--radius-button);
  font-size: 12.5px;
}

.box-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.box-error {
  flex: 1;
  min-width: 0;
  color: var(--danger);
  font-size: 11.5px;
}

.box-actions .ghost,
.box-actions .primary {
  height: 28px;
  padding: 0 12px;
  border-radius: var(--radius-button);
  font-size: 12px;
}

.box-actions .ghost {
  border: 1px solid #e0e0e0;
  background: #ffffff;
  color: var(--text-secondary);
}

.box-actions .primary {
  background: var(--accent);
  color: #ffffff;
}

.chevron {
  flex: 0 0 auto;
  color: #c2c2c2;
}

.peer:hover:not(:disabled) .chevron {
  color: var(--text-secondary);
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 72px 20px;
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

.letter-index {
  position: absolute;
  top: 50%;
  right: 8px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 4px 2px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.86);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
  transform: translateY(-50%);
}

.letter-index button {
  width: 18px;
  height: 17px;
  border-radius: 4px;
  font-size: 10px;
  line-height: 17px;
  color: var(--text-secondary);
}

.letter-index button:hover {
  color: var(--accent);
  background: var(--hover);
}

.letter-index button.active {
  color: #ffffff;
  background: var(--accent);
}

@media (max-width: 1100px) {
  .inner {
    padding-right: 54px;
  }
}

@media (max-width: 960px) {
  .search {
    width: 220px;
  }

  .inner {
    padding: 16px 54px 24px 18px;
  }

  .address {
    max-width: 120px;
  }
}
</style>
