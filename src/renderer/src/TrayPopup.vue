<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ConversationInfo, GroupInfo, PeerInfo } from '../../shared/domain'
import { TRAY_POPUP } from '../../shared/ipc'
import { avatarUrl } from './utils/avatar'

const conversations = ref<ConversationInfo[]>([])
const peers = ref<PeerInfo[]>([])
const groups = ref<GroupInfo[]>([])

// 所有有未读的会话，最新的在最上面
const rows = computed(() =>
  conversations.value
    .filter((item) => item.unread > 0)
    .slice()
    .sort((left, right) => right.lastMessageAt - left.lastMessageAt)
)

function avatarFor(conversation: ConversationInfo): string {
  if (conversation.kind === 'group') {
    const group = groups.value.find((item) => item.id === conversation.id)
    return avatarUrl(group?.photoMd5)
  }
  const peer =
    conversation.peerKey === null
      ? undefined
      : peers.value.find((item) => item.key === conversation.peerKey)
  return avatarUrl(peer?.avatarMd5)
}

function badge(unread: number): string {
  return unread > 99 ? '99+' : String(unread)
}

function handleJump(conversationId: string): void {
  window.api.ui.jumpToConversation(conversationId)
}

function handleMarkAll(): void {
  void window.api.conversations.markAllRead()
}

function handleLeave(): void {
  window.api.ui.popupLeave()
}

// 行数变化时让主进程按实际内容重新贴齐托盘上方
watch(
  () => rows.value.length,
  (count) => {
    window.api.ui.popupRows(count)
  }
)

let unsubscribe: (() => void) | null = null

onMounted(() => {
  document.title = 'lanpost-popup'
  void window.api.state.snapshot().then((snapshot) => {
    conversations.value = snapshot.conversations
    peers.value = snapshot.peers
    groups.value = snapshot.groups
    window.api.ui.popupRows(rows.value.length)
  })
  unsubscribe = window.api.state.onEvent((event) => {
    switch (event.type) {
      case 'conversation': {
        const index = conversations.value.findIndex((item) => item.id === event.conversation.id)
        if (index >= 0) conversations.value[index] = event.conversation
        else conversations.value.push(event.conversation)
        break
      }
      case 'conversation-removed':
        conversations.value = conversations.value.filter((item) => item.id !== event.conversationId)
        break
      case 'peers':
        peers.value = event.peers
        break
      case 'group': {
        const index = groups.value.findIndex((item) => item.id === event.group.id)
        if (index >= 0) groups.value[index] = event.group
        else groups.value.push(event.group)
        break
      }
    }
  })
})

onBeforeUnmount(() => {
  unsubscribe?.()
  unsubscribe = null
})

const popupStyle = {
  width: `${TRAY_POPUP.width}px`,
  padding: `${TRAY_POPUP.padding}px`
}
const listStyle = {
  maxHeight: `${TRAY_POPUP.maxHeight - TRAY_POPUP.footerHeight - TRAY_POPUP.padding * 2}px`
}
const footStyle = { height: `${TRAY_POPUP.footerHeight}px` }
const rowStyle = { height: `${TRAY_POPUP.rowHeight}px` }
</script>

<template>
  <div class="popup" :style="popupStyle" @mouseleave="handleLeave">
    <div class="popup-list" :style="listStyle">
      <button
        v-for="row in rows"
        :key="row.id"
        class="popup-row"
        :style="rowStyle"
        @click="handleJump(row.id)"
      >
        <img v-if="avatarFor(row) !== ''" class="popup-avatar" :src="avatarFor(row)" alt="" />
        <span v-else class="popup-avatar popup-placeholder">{{ row.title.slice(0, 1) }}</span>
        <span class="popup-title">{{ row.title }}</span>
        <span class="popup-badge">{{ badge(row.unread) }}</span>
      </button>
    </div>
    <div class="popup-foot" :style="footStyle">
      <button class="popup-readall" @click="handleMarkAll">一键已读</button>
    </div>
  </div>
</template>

<style scoped>
.popup {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--divider);
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.16);
  overflow: hidden;
}

.popup-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.popup-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 0 4px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.popup-row:hover {
  background: var(--hover);
}

.popup-avatar {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  object-fit: cover;
}

.popup-placeholder {
  display: grid;
  place-items: center;
  background: var(--accent);
  color: #ffffff;
  font-size: 15px;
}

.popup-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.popup-badge {
  flex: 0 0 auto;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: #e5484d;
  color: #ffffff;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}

.popup-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  border-top: 1px solid var(--divider);
}

.popup-readall {
  height: 30px;
  padding: 0 12px;
  border: 0;
  background: transparent;
  color: var(--accent);
  font-size: 13px;
  cursor: pointer;
}

.popup-readall:hover {
  text-decoration: underline;
}
</style>

<style>
html,
body {
  margin: 0;
  background: transparent;
  overflow: hidden;
}
</style>
