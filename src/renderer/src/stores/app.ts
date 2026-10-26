import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  AppEvent,
  AppSnapshot,
  ConversationInfo,
  FileTaskInfo,
  LocalInfo,
  MessageInfo,
  PeerInfo
} from '../../../shared/domain'

const MESSAGE_PAGE_SIZE = 50
const PREVIEW_PAGE_SIZE = 10
const DRAFT_SAVE_DELAY = 400

function describe(reason: unknown): string {
  if (reason instanceof Error) return reason.message
  return String(reason)
}

export const useAppStore = defineStore('app', () => {
  const local = ref<LocalInfo | null>(null)
  const peers = ref<PeerInfo[]>([])
  const conversations = ref<ConversationInfo[]>([])
  const files = ref<FileTaskInfo[]>([])
  const currentConversationId = ref<string | null>(null)
  const messages = ref<Record<string, MessageInfo[]>>({})
  const previews = ref<Record<string, MessageInfo>>({})
  const hasMore = ref<Record<string, boolean>>({})
  const loadingMessages = ref<Record<string, boolean>>({})
  const readMarks = ref<Record<string, number>>({})
  const loading = ref(false)
  const refreshing = ref(false)
  const sending = ref(false)
  const error = ref('')

  const draftTimers = new Map<string, number>()
  let initialized = false

  const unreadTotal = computed(() =>
    conversations.value.reduce((total, conversation) => total + Math.max(0, conversation.unread), 0)
  )

  const sortedConversations = computed(() =>
    [...conversations.value].sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1
      if (left.lastMessageAt !== right.lastMessageAt)
        return right.lastMessageAt - left.lastMessageAt
      return left.title.localeCompare(right.title, 'zh-CN')
    })
  )

  const currentConversation = computed(
    () =>
      conversations.value.find((conversation) => conversation.id === currentConversationId.value) ??
      null
  )

  const currentMessages = computed(() => {
    const id = currentConversationId.value
    return id ? (messages.value[id] ?? []) : []
  })

  const currentPeer = computed(() => {
    const conversation = currentConversation.value
    if (!conversation?.peerKey) return null
    return peers.value.find((peer) => peer.key === conversation.peerKey) ?? null
  })

  const currentFiles = computed(() => {
    const id = currentConversationId.value
    return id ? files.value.filter((file) => file.conversationId === id) : []
  })

  function reportError(reason: unknown): void {
    const message = describe(reason)
    if (message) error.value = message
  }

  function clearError(): void {
    error.value = ''
  }

  function applySnapshot(snapshot: AppSnapshot): void {
    local.value = snapshot.local
    peers.value = snapshot.peers
    conversations.value = snapshot.conversations
    files.value = snapshot.files
    if (
      currentConversationId.value &&
      !snapshot.conversations.some(
        (conversation) => conversation.id === currentConversationId.value
      )
    ) {
      currentConversationId.value = null
    }
  }

  function upsertConversation(next: ConversationInfo): void {
    const index = conversations.value.findIndex((conversation) => conversation.id === next.id)
    if (index >= 0) {
      const current = conversations.value[index]
      // 草稿只由当前渲染进程写入，事件里的草稿可能落后于本地输入，保留本地值。
      next.draft = current.draft
      conversations.value[index] = next
    } else {
      conversations.value.push(next)
    }
    if (next.id === currentConversationId.value) {
      const unread = next.unread
      next.unread = 0
      if (unread > 0) void markRead(next.id)
    }
  }

  function upsertMessage(message: MessageInfo): void {
    const list = messages.value[message.conversationId]
    if (!list) return
    const index = list.findIndex((item) => item.id === message.id)
    if (index >= 0) list[index] = message
    else {
      list.push(message)
      list.sort((left, right) => left.id - right.id)
    }
  }

  function upsertFile(file: FileTaskInfo): void {
    const index = files.value.findIndex((item) => item.id === file.id)
    if (index >= 0) files.value[index] = file
    else files.value.push(file)
  }

  function handleEvent(event: AppEvent): void {
    switch (event.type) {
      case 'peers':
        peers.value = event.peers
        break
      case 'conversation':
        upsertConversation(event.conversation)
        break
      case 'message': {
        const message = event.message
        if (messages.value[message.conversationId]) upsertMessage(message)
        const preview = previews.value[message.conversationId]
        if (!preview || message.id >= preview.id) {
          previews.value = { ...previews.value, [message.conversationId]: message }
        }
        const conversation = conversations.value.find((item) => item.id === message.conversationId)
        if (conversation && message.createdAt > conversation.lastMessageAt) {
          conversation.lastMessageAt = message.createdAt
        }
        if (
          message.conversationId === currentConversationId.value &&
          message.direction === 'in' &&
          document.hasFocus()
        ) {
          void markRead(message.conversationId)
        }
        break
      }
      case 'file':
        upsertFile(event.file)
        break
      case 'settings':
        break
    }
  }

  async function loadSnapshot(): Promise<void> {
    loading.value = true
    try {
      const snapshot = await window.api.state.snapshot()
      applySnapshot(snapshot)
    } catch (reason) {
      reportError(reason)
    } finally {
      loading.value = false
    }
    void refreshPreviews()
  }

  async function refreshPeers(): Promise<void> {
    if (refreshing.value) return
    refreshing.value = true
    try {
      await window.api.peers.refresh()
      // 给对端留出应答时间，再拉一次完整快照。
      await new Promise((resolve) => setTimeout(resolve, 700))
      await loadSnapshot()
    } catch (reason) {
      reportError(reason)
    } finally {
      refreshing.value = false
    }
  }

  async function refreshPreviews(): Promise<void> {
    const targets = conversations.value.filter((conversation) => !previews.value[conversation.id])
    await Promise.all(
      targets.map(async (conversation) => {
        try {
          const page = await window.api.messages.list({
            conversationId: conversation.id,
            limit: PREVIEW_PAGE_SIZE
          })
          let latest: MessageInfo | null = null
          for (const message of page.messages) {
            if (!latest || message.id > latest.id) latest = message
          }
          if (latest) previews.value = { ...previews.value, [conversation.id]: latest }
        } catch (reason) {
          reportError(reason)
        }
      })
    )
  }

  async function initialize(): Promise<void> {
    if (initialized) return
    initialized = true
    try {
      window.api.state.onEvent(handleEvent)
    } catch (reason) {
      reportError(reason)
    }
    await loadSnapshot()
  }

  async function loadMessages(conversationId: string, beforeId?: number): Promise<void> {
    if (loadingMessages.value[conversationId]) return
    loadingMessages.value = { ...loadingMessages.value, [conversationId]: true }
    try {
      const page = await window.api.messages.list({
        conversationId,
        beforeId,
        limit: MESSAGE_PAGE_SIZE
      })
      const merged = new Map<number, MessageInfo>()
      for (const message of messages.value[conversationId] ?? []) merged.set(message.id, message)
      for (const message of page.messages) merged.set(message.id, message)
      const list = [...merged.values()].sort((left, right) => left.id - right.id)
      messages.value[conversationId] = list
      hasMore.value[conversationId] = page.hasMore
      const latest = list[list.length - 1]
      const preview = previews.value[conversationId]
      if (latest && (!preview || latest.id > preview.id)) {
        previews.value = { ...previews.value, [conversationId]: latest }
      }
      if (!beforeId) await markRead(conversationId)
    } catch (reason) {
      reportError(reason)
    } finally {
      loadingMessages.value = { ...loadingMessages.value, [conversationId]: false }
    }
  }

  async function selectConversation(id: string | null): Promise<void> {
    currentConversationId.value = id
    if (!id) return
    const conversation = conversations.value.find((item) => item.id === id)
    if (!conversation) return
    if (conversation.unread > 0 && readMarks.value[id] === undefined) {
      readMarks.value = { ...readMarks.value, [id]: conversation.lastReadMessageId }
    }
    conversation.unread = 0
    if (messages.value[id] === undefined) {
      await loadMessages(id)
      return
    }
    await markRead(id)
  }

  async function sendText(text: string): Promise<boolean> {
    const conversationId = currentConversationId.value
    const body = text.trim()
    if (!conversationId || !body || sending.value) return false
    sending.value = true
    try {
      const result = await window.api.messages.send({ conversationId, text: body })
      upsertMessage(result.message)
      const conversation = conversations.value.find((item) => item.id === conversationId)
      if (conversation) {
        conversation.draft = ''
        if (result.message.createdAt > conversation.lastMessageAt) {
          conversation.lastMessageAt = result.message.createdAt
        }
      }
      previews.value = { ...previews.value, [conversationId]: result.message }
      const timer = draftTimers.get(conversationId)
      if (timer !== undefined) {
        window.clearTimeout(timer)
        draftTimers.delete(conversationId)
      }
      try {
        await window.api.messages.saveDraft(conversationId, '')
      } catch (reason) {
        reportError(reason)
      }
      return true
    } catch (reason) {
      reportError(reason)
      return false
    } finally {
      sending.value = false
    }
  }

  function saveDraft(conversationId: string, draft: string): void {
    const conversation = conversations.value.find((item) => item.id === conversationId)
    if (conversation) conversation.draft = draft
    const timer = draftTimers.get(conversationId)
    if (timer !== undefined) window.clearTimeout(timer)
    draftTimers.set(
      conversationId,
      window.setTimeout(() => {
        draftTimers.delete(conversationId)
        void persistDraft(conversationId, draft)
      }, DRAFT_SAVE_DELAY)
    )
  }

  async function persistDraft(conversationId: string, draft: string): Promise<void> {
    try {
      await window.api.messages.saveDraft(conversationId, draft)
    } catch (reason) {
      reportError(reason)
    }
  }

  async function markRead(conversationId: string): Promise<void> {
    const conversation = conversations.value.find((item) => item.id === conversationId)
    const list = messages.value[conversationId]
    if (!conversation || !list || list.length === 0) return
    const latest = list[list.length - 1]
    conversation.unread = 0
    if (latest.id <= conversation.lastReadMessageId) return
    try {
      await window.api.messages.markRead(conversationId, latest.id)
      conversation.lastReadMessageId = latest.id
    } catch (reason) {
      reportError(reason)
    }
  }

  async function markReadCurrent(): Promise<void> {
    const id = currentConversationId.value
    if (id) await markRead(id)
  }

  async function setAlias(peerKey: string, alias: string): Promise<void> {
    const name = alias.trim()
    try {
      await window.api.peers.setAlias(peerKey, name)
    } catch (reason) {
      reportError(reason)
      return
    }
    const peer = peers.value.find((item) => item.key === peerKey)
    if (peer) peer.alias = name
    for (const conversation of conversations.value) {
      if (conversation.peerKey !== peerKey) continue
      conversation.title = name || peer?.name || conversation.title
    }
  }

  return {
    local,
    peers,
    conversations,
    files,
    currentConversationId,
    messages,
    previews,
    hasMore,
    loadingMessages,
    readMarks,
    loading,
    refreshing,
    sending,
    error,
    unreadTotal,
    sortedConversations,
    currentConversation,
    currentMessages,
    currentPeer,
    currentFiles,
    initialize,
    loadSnapshot,
    refreshPeers,
    selectConversation,
    loadMessages,
    sendText,
    saveDraft,
    markRead,
    markReadCurrent,
    setAlias,
    handleEvent,
    reportError,
    clearError
  }
})
