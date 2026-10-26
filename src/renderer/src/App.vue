<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CircleAlert, X } from '@lucide/vue'
import type { Settings } from '../../shared/settings'
import type { NotifyPayload } from '../../shared/ipc'
import notifySound from './assets/notify.wav'
import { useAppStore } from './stores/app'
import ChatPane from './components/ChatPane.vue'
import ContactsPage from './components/ContactsPage.vue'
import ConversationList from './components/ConversationList.vue'
import FilesPage from './components/FilesPage.vue'
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
let unsubscribeNotify: (() => void) | null = null
let unsubscribeSelect: (() => void) | null = null
let toastTimer: ReturnType<typeof setTimeout> | null = null

const toast = ref<NotifyPayload | null>(null)
const soundVolume = ref(70)

function openToast(): void {
  if (toast.value === null) return
  void store.selectConversation(toast.value.conversationId)
  toast.value = null
  if (toastTimer !== null) {
    clearTimeout(toastTimer)
    toastTimer = null
  }
}

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

function handleSend(text: string, sealed: boolean): void {
  void store.sendText(text, sealed)
}

function handleUnseal(messageId: number): void {
  void store.unseal(messageId)
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

function handleOpenContact(conversationId: string): void {
  view.value = 'chat'
  settingsOpen.value = false
  void store.selectConversation(conversationId)
}

onMounted(async () => {
  void store.initialize()
  unsubscribeSettings = window.api.ui.onOpenSettings(() => {
    settingsOpen.value = true
  })
  unsubscribeNotify = window.api.ui.onNotify((payload) => {
    toast.value = payload
    if (toastTimer !== null) {
      clearTimeout(toastTimer)
    }
    toastTimer = setTimeout(() => {
      toast.value = null
      toastTimer = null
    }, 4000)
    if (payload.sound) {
      const audio = new Audio(notifySound)
      audio.volume = soundVolume.value / 100
      void audio.play().catch(() => undefined)
    }
  })
  unsubscribeSelect = window.api.ui.onSelectConversation((conversationId) => {
    void store.selectConversation(conversationId)
  })
  watch(
    () => store.currentConversationId,
    (conversationId) => {
      window.api.ui.setActiveConversation(conversationId)
    },
    { immediate: true }
  )
  try {
    const settings = await window.api.settings.get()
    appearance.value = settings.appearance
    soundVolume.value = settings.notify.soundVolume
  } catch (reason) {
    store.reportError(reason)
  }
})

onBeforeUnmount(() => {
  unsubscribeSettings?.()
  unsubscribeNotify?.()
  unsubscribeSelect?.()
  unsubscribeSettings = null
  unsubscribeNotify = null
  unsubscribeSelect = null
  if (toastTimer !== null) {
    clearTimeout(toastTimer)
    toastTimer = null
  }
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
        <template v-if="view === 'chat'">
          <ConversationList
            :conversations="store.sortedConversations"
            :peers="store.peers"
            :previews="store.previews"
            :selected-id="store.currentConversationId"
            :loading="store.loading"
            :refreshing="store.refreshing"
            @refresh="store.refreshPeers"
            @select="store.selectConversation($event)"
            @pin="store.setPinned"
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
            @unseal="handleUnseal"
            @draft="handleDraft"
            @read="handleRead"
            @load-more="handleLoadMore"
          />
        </template>

        <ContactsPage v-else-if="view === 'contacts'" @open="handleOpenContact" />

        <FilesPage v-else />
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

    <button v-if="toast" class="notify-toast" @click="openToast">
      <strong>{{ toast.title }}</strong>
      <span>{{ toast.body }}</span>
    </button>
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

.notify-toast {
  position: fixed;
  top: 18px;
  right: 20px;
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-width: 300px;
  padding: 10px 14px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #ffffff;
  color: var(--text);
  text-align: left;
  box-shadow: 0 8px 24px rgba(20, 30, 50, 0.16);
  cursor: pointer;
}

.notify-toast strong {
  font-size: 13px;
  font-weight: 600;
}

.notify-toast span {
  font-size: 12px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
