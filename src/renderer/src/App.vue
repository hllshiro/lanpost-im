<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { CircleAlert, X } from '@lucide/vue'
import type { Settings } from '../../shared/settings'
import { useAppStore } from './stores/app'
import ChatPane from './components/ChatPane.vue'
import ConversationList from './components/ConversationList.vue'
import NavRail from './components/NavRail.vue'
import SettingsOverlay from './components/SettingsOverlay.vue'

const store = useAppStore()

const settingsOpen = ref(false)
const view = ref<'chat' | 'contacts' | 'files'>('chat')
const appearance = ref<Settings['appearance']>({ fontSize: 14, density: 'standard' })

const shellStyle = computed<Record<string, string>>(() => ({
  '--chat-font-size': `${appearance.value.fontSize}px`,
  '--row-height': appearance.value.density === 'compact' ? '56px' : '64px',
  '--msg-gap': appearance.value.density === 'compact' ? '10px' : '16px'
}))

let unsubscribeSettings: (() => void) | null = null

const currentHasMore = computed(() => {
  const id = store.currentConversationId
  return id ? (store.hasMore[id] ?? false) : false
})

const currentLoadingMessages = computed(() => {
  const id = store.currentConversationId
  return id ? (store.loadingMessages[id] ?? false) : false
})

const currentUnreadAfterId = computed(() => {
  const id = store.currentConversationId
  return id ? (store.readMarks[id] ?? 0) : 0
})

function handleSettingsSaved(next: Settings): void {
  appearance.value = next.appearance
}

function handleDraft(value: string): void {
  const id = store.currentConversationId
  if (id) store.saveDraft(id, value)
}

function handleSend(text: string): void {
  void store.sendText(text)
}

function handleRead(): void {
  void store.markReadCurrent()
}

function handleLoadMore(beforeId: number): void {
  const id = store.currentConversationId
  if (id) void store.loadMessages(id, beforeId)
}

function handleViewSelect(next: 'chat' | 'contacts' | 'files'): void {
  view.value = next
  settingsOpen.value = false
}

onMounted(async () => {
  void store.initialize()
  unsubscribeSettings = window.api.ui.onOpenSettings(() => {
    settingsOpen.value = true
  })
  try {
    const settings = await window.api.settings.get()
    appearance.value = settings.appearance
  } catch (reason) {
    store.reportError(reason)
  }
})

onBeforeUnmount(() => {
  unsubscribeSettings?.()
  unsubscribeSettings = null
})
</script>

<template>
  <div class="shell" :style="shellStyle">
    <NavRail
      :local="store.local"
      :unread="store.unreadTotal"
      :active="view"
      @settings="settingsOpen = true"
      @select="handleViewSelect"
    />

    <div class="workspace">
      <template v-if="!settingsOpen">
        <ConversationList
          :conversations="store.sortedConversations"
          :previews="store.previews"
          :selected-id="store.currentConversationId"
          :loading="store.loading"
          @select="store.selectConversation($event)"
        />

        <ChatPane
          :conversation="store.currentConversation"
          :peer="store.currentPeer"
          :messages="store.currentMessages"
          :files="store.currentFiles"
          :local="store.local"
          :loading-messages="currentLoadingMessages"
          :has-more="currentHasMore"
          :sending="store.sending"
          :unread-after-id="currentUnreadAfterId"
          @send="handleSend"
          @draft="handleDraft"
          @read="handleRead"
          @load-more="handleLoadMore"
        />
      </template>

      <SettingsOverlay v-else @close="settingsOpen = false" @saved="handleSettingsSaved" />
    </div>

    <div v-if="store.error" class="error-toast" role="status">
      <CircleAlert :size="15" :stroke-width="2" />
      <span class="error-text">{{ store.error }}</span>
      <button class="error-dismiss" title="关闭提示" @click="store.clearError()">
        <X :size="13" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.shell {
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--page-bg);
}

.workspace {
  position: relative;
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  overflow: hidden;
}

.error-toast {
  position: fixed;
  left: 50%;
  bottom: 18px;
  z-index: 50;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: min(640px, 70vw);
  padding: 8px 10px 8px 12px;
  border-radius: var(--radius-bubble);
  background: rgba(38, 38, 38, 0.94);
  color: #ffffff;
  font-size: 12px;
  line-height: 1.5;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
  transform: translateX(-50%);
}

.error-toast svg {
  flex: 0 0 auto;
  color: #ffb4b4;
}

.error-text {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}

.error-dismiss {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  color: #d8d8d8;
}

.error-dismiss:hover {
  background: rgba(255, 255, 255, 0.16);
  color: #ffffff;
}
</style>
