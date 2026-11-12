<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CircleAlert, X } from '@lucide/vue'
import type { Settings } from '../../shared/settings'
import type { NotifyPayload } from '../../shared/ipc'
import type { RichPart } from '../../shared/ipc'
import notifySound from './assets/notify.wav'
import { useAppStore } from './stores/app'
import { errorMessage } from './utils/errors'
import ChatPane from './components/ChatPane.vue'
import ContactsPage from './components/ContactsPage.vue'
import ConversationList from './components/ConversationList.vue'
import FilesPage from './components/FilesPage.vue'
import GroupPicker from './components/GroupPicker.vue'
import NavRail from './components/NavRail.vue'
import SettingsOverlay from './components/SettingsOverlay.vue'

const store = useAppStore()

const settingsOpen = ref(false)
const view = ref<'chat' | 'contacts' | 'files'>('chat')
const groupPicker = ref<null | { mode: 'create' } | { mode: 'invite'; groupId: string }>(null)
const appearance = ref<Settings['appearance']>({ fontSize: 14, density: 'standard' })
const dragActive = ref(false)
let dragDepth = 0

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

function handleSendRich(parts: RichPart[]): void {
  const id = store.currentConversationId
  if (id) void store.sendRich(id, parts)
}

function handleRemoveStaged(id: string): void {
  const conversationId = store.currentConversationId
  if (conversationId) void store.removeStaged(conversationId, id)
}

function hasDroppedFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') ?? false
}

function canDropFiles(): boolean {
  return view.value === 'chat' && !settingsOpen.value && store.currentConversationId !== null
}

function handleDragEnter(event: DragEvent): void {
  if (!hasDroppedFiles(event) || !canDropFiles()) return
  dragDepth += 1
  dragActive.value = true
}

function handleDragOver(event: DragEvent): void {
  if (!hasDroppedFiles(event)) return
  event.preventDefault()
  if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy'
}

function handleDragLeave(event: DragEvent): void {
  if (!hasDroppedFiles(event)) return
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dragActive.value = false
}

// 有磁盘路径的直接引原文件；浏览器里拖出来的图片拿不到路径，按字节落盘
async function handleDrop(event: DragEvent): Promise<void> {
  if (!hasDroppedFiles(event)) return
  event.preventDefault()
  dragDepth = 0
  dragActive.value = false
  const conversationId = store.currentConversationId
  const files = Array.from(event.dataTransfer?.files ?? [])
  if (conversationId === null || files.length === 0) return
  const paths: string[] = []
  const detached: File[] = []
  for (const file of files) {
    const path = window.api.files.pathFor(file)
    if (path === '') detached.push(file)
    else paths.push(path)
  }
  try {
    if (paths.length > 0) {
      const result = await window.api.files.stagePaths(conversationId, paths)
      if (result.skipped.length > 0) {
        store.reportError(`已跳过：${result.skipped.join('、')}`)
      }
    }
    for (const file of detached) {
      const data = await file.arrayBuffer()
      await window.api.files.stageBytes(conversationId, file.name, data)
    }
  } catch (reason) {
    store.reportError(errorMessage(reason))
  }
}

function handleRead(): void {
  void store.markReadCurrent()
}

function handleViewSelect(next: 'chat' | 'contacts' | 'files'): void {
  view.value = next
  settingsOpen.value = false
}

const groupPickerTitle = computed(() => store.currentGroup?.name ?? '')

const groupPickerExcluded = computed(() => {
  const action = groupPicker.value
  if (action === null || action.mode !== 'invite') return []
  return store.currentGroup?.members.map((member) => member.userId) ?? []
})

function openCreateGroup(): void {
  groupPicker.value = { mode: 'create' }
}

function openInvite(): void {
  const group = store.currentGroup
  if (group === null) return
  groupPicker.value = { mode: 'invite', groupId: group.id }
}

async function handleGroupConfirm(name: string, userIds: string[]): Promise<void> {
  const action = groupPicker.value
  if (action === null) return
  groupPicker.value = null
  try {
    if (action.mode === 'create') await store.createGroup(name, userIds)
    else await store.inviteMembers(action.groupId, userIds)
  } catch {
    // 错误已经进 store.error
  }
}

function handleKick(userId: string): void {
  const group = store.currentGroup
  if (group !== null) void store.kickMember(group.id, userId)
}

function handleLeaveGroup(): void {
  const group = store.currentGroup
  if (group !== null) void store.leaveGroup(group.id)
}

function handleDismissGroup(): void {
  const group = store.currentGroup
  if (group !== null) void store.dismissGroup(group.id)
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

    <div
      class="workspace"
      @dragenter="handleDragEnter"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
    >
      <template v-if="!settingsOpen">
        <template v-if="view === 'chat'">
          <ConversationList
            :conversations="store.sortedConversations"
            :peers="store.peers"
            :groups="store.groups"
            :previews="store.previews"
            :selected-id="store.currentConversationId"
            :loading="store.loading"
            :refreshing="store.refreshing"
            @refresh="store.refreshPeers"
            @select="store.selectConversation($event)"
            @pin="store.setPinned"
            @create-group="openCreateGroup"
          />

          <ChatPane
            :conversation="store.currentConversation"
            :peer="store.currentPeer"
            :group="store.currentGroup"
            :messages="store.currentMessages"
            :files="store.currentFiles"
            :staged="store.currentStaged"
            :local="store.local"
            :loading-messages="currentLoadingMessages"
            :sending="store.sending"
            :unread-after-id="currentUnreadAfterId"
            @send-rich="handleSendRich"
            @draft="handleDraft"
            @remove-staged="handleRemoveStaged"
            @read="handleRead"
            @invite="openInvite"
            @kick="handleKick"
            @leave="handleLeaveGroup"
            @dismiss="handleDismissGroup"
          />
        </template>

        <ContactsPage v-else-if="view === 'contacts'" @open="handleOpenContact" />

        <FilesPage v-else />
      </template>

      <SettingsOverlay v-else @close="settingsOpen = false" @saved="handleSettingsSaved" />

      <GroupPicker
        v-if="groupPicker"
        :mode="groupPicker.mode"
        :title="groupPickerTitle"
        :peers="store.peers"
        :exclude-user-ids="groupPickerExcluded"
        @close="groupPicker = null"
        @confirm="handleGroupConfirm"
      />

      <div v-if="dragActive" class="drop-zone">
        <span>松开添加到待发区</span>
      </div>
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

/* 拖文件进来时盖在内容上，只做提示，不挡放下的操作 */
.drop-zone {
  position: absolute;
  inset: 10px;
  z-index: 45;
  display: grid;
  place-items: center;
  border: 2px dashed var(--accent);
  border-radius: 10px;
  background: rgba(7, 193, 96, 0.07);
  pointer-events: none;
}

.drop-zone span {
  padding: 8px 16px;
  border-radius: 16px;
  background: var(--accent);
  color: #ffffff;
  font-size: 13px;
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
