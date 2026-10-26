<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronRight, Search, Users, X } from '@lucide/vue'
import type { PeerInfo } from '../../../shared/domain'
import { useAppStore } from '../stores/app'
import { initialOf } from '../utils/format'
import { compareLetters, comparePinyin, pinyinInfo } from '../utils/pinyin'

const emit = defineEmits<{ open: [conversationId: string] }>()

const store = useAppStore()
const query = ref('')
const activeLetter = ref<string | null>(null)

const keyword = computed(() => query.value.trim().toLowerCase())

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
  const conversationId = conversationByPeer.value.get(peer.key)
  if (!conversationId) return
  emit('open', conversationId)
}
</script>

<template>
  <section class="contacts" aria-label="联系人">
    <header class="page-head">
      <div class="title-block">
        <h1>联系人</h1>
        <p>
          {{ onlineCount }} 位在线 · 共 {{ store.peers.length }} 位
          <template v-if="activeLetter !== null"> · {{ activeLetter }} 开头</template>
        </p>
      </div>
      <div class="search">
        <Search :size="14" :stroke-width="1.8" />
        <input
          v-model="query"
          type="text"
          placeholder="搜索名称、账号、分组、IP 或拼音"
          autocomplete="off"
          spellcheck="false"
          aria-label="搜索联系人"
        />
        <button v-if="query" class="clear" title="清空搜索" @click="query = ''">
          <X :size="13" />
        </button>
      </div>
    </header>

    <div class="scroll">
      <div class="inner">
        <div class="list">
          <template v-for="group in groups" :key="group.letter">
            <div class="letter-head">{{ group.letter }}</div>
            <button
              v-for="peer in group.peers"
              :key="peer.key"
              class="peer"
              :class="{ current: isCurrent(peer), unavailable: !hasConversation(peer) }"
              :disabled="!hasConversation(peer)"
              :title="hasConversation(peer) ? '打开聊天' : '会话尚未建立'"
              @click="openPeer(peer)"
            >
              <span class="avatar-wrap">
                <span class="avatar">{{ initialOf(displayName(peer)) }}</span>
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

              <ChevronRight :size="16" :stroke-width="1.8" class="chevron" />
            </button>
          </template>

          <div v-if="visible.length === 0" class="empty">
            <Users :size="30" :stroke-width="1.4" />
            <p>{{ emptyText }}</p>
            <small v-if="store.peers.length === 0">局域网内发现对端后会显示在这里</small>
          </div>
        </div>
      </div>
    </div>

    <nav v-if="letters.length > 1" class="letter-index" aria-label="拼音筛选">
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

.peer {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 72px;
  padding: 12px 16px;
  border-bottom: 1px solid #f0f0f0;
  text-align: left;
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
