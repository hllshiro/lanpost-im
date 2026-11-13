import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC, type Api, type NotifyPayload } from '../shared/ipc'
import type { AppEvent } from '../shared/domain'

const api: Api = {
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo)
  },
  state: {
    snapshot: () => ipcRenderer.invoke(IPC.snapshot),
    onEvent: (listener: (event: AppEvent) => void) => {
      const handler = (_event: unknown, payload: AppEvent): void => listener(payload)
      ipcRenderer.on(IPC.event, handler)
      return () => ipcRenderer.removeListener(IPC.event, handler)
    }
  },
  conversations: {
    pin: (conversationId, pinned) => ipcRenderer.invoke(IPC.conversationPin, conversationId, pinned)
  },
  ui: {
    onOpenSettings: (listener: () => void) => {
      const handler = (): void => listener()
      ipcRenderer.on(IPC.uiOpenSettings, handler)
      return () => ipcRenderer.removeListener(IPC.uiOpenSettings, handler)
    },
    onNotify: (listener) => {
      const handler = (_event: unknown, payload: NotifyPayload): void => listener(payload)
      ipcRenderer.on(IPC.uiNotify, handler)
      return () => ipcRenderer.removeListener(IPC.uiNotify, handler)
    },
    onSelectConversation: (listener) => {
      const handler = (_event: unknown, conversationId: string): void => listener(conversationId)
      ipcRenderer.on(IPC.uiSelectConversation, handler)
      return () => ipcRenderer.removeListener(IPC.uiSelectConversation, handler)
    },
    setActiveConversation: (conversationId) => {
      ipcRenderer.send(IPC.uiActiveConversation, conversationId)
    }
  },
  messages: {
    list: (request) => ipcRenderer.invoke(IPC.messagesList, request),
    all: (conversationId) => ipcRenderer.invoke(IPC.messagesAll, conversationId),
    send: (request) => ipcRenderer.invoke(IPC.messageSend, request),
    broadcast: (request) => ipcRenderer.invoke(IPC.messageBroadcast, request),
    multicast: (request) => ipcRenderer.invoke(IPC.messageMulticast, request),
    markRead: (conversationId, messageId) =>
      ipcRenderer.invoke(IPC.conversationRead, conversationId, messageId),
    saveDraft: (conversationId, draft) =>
      ipcRenderer.invoke(IPC.conversationDraft, conversationId, draft)
  },
  peers: {
    setAlias: (peerKey, alias) => ipcRenderer.invoke(IPC.peerAlias, peerKey, alias),
    refresh: () => ipcRenderer.invoke(IPC.peersRefresh)
  },
  groups: {
    create: (name, memberUserIds) => ipcRenderer.invoke(IPC.groupCreate, name, memberUserIds),
    setAvatar: (groupId, path) => ipcRenderer.invoke(IPC.groupAvatar, groupId, path),
    invite: (groupId, memberUserIds) => ipcRenderer.invoke(IPC.groupInvite, groupId, memberUserIds),
    kick: (groupId, userId) => ipcRenderer.invoke(IPC.groupKick, groupId, userId),
    leave: (groupId) => ipcRenderer.invoke(IPC.groupLeave, groupId),
    dismiss: (groupId) => ipcRenderer.invoke(IPC.groupDismiss, groupId)
  },
  emotions: {
    list: () => ipcRenderer.invoke(IPC.emotionList),
    add: (fileId) => ipcRenderer.invoke(IPC.emotionAdd, fileId),
    remove: (id) => ipcRenderer.invoke(IPC.emotionRemove, id),
    stage: (conversationId, id) => ipcRenderer.invoke(IPC.emotionStage, conversationId, id)
  },
  files: {
    accept: (id) => ipcRenderer.invoke(IPC.fileAccept, id),
    reject: (id) => ipcRenderer.invoke(IPC.fileReject, id),
    open: (id) => ipcRenderer.invoke(IPC.fileOpen, id),
    openPath: (path) => ipcRenderer.invoke(IPC.fileOpenPath, path),
    copyImage: (id) => ipcRenderer.invoke(IPC.fileCopyImage, id),
    reveal: (id) => ipcRenderer.invoke(IPC.fileReveal, id),
    revealPath: (path) => ipcRenderer.invoke(IPC.fileRevealPath, path),
    saveAs: (id) => ipcRenderer.invoke(IPC.fileSaveAs, id),
    pick: (conversationId) => ipcRenderer.invoke(IPC.filePick, conversationId),
    paste: (conversationId) => ipcRenderer.invoke(IPC.filePaste, conversationId),
    stagePaths: (conversationId, paths, sticker) =>
      ipcRenderer.invoke(IPC.fileStagePaths, conversationId, paths, sticker === true),
    stageBytes: (conversationId, name, data, sticker) =>
      ipcRenderer.invoke(IPC.fileStageBytes, conversationId, name, data, sticker === true),
    pathFor: (file) => webUtils.getPathForFile(file),
    removeStaged: (conversationId, id) =>
      ipcRenderer.invoke(IPC.fileStagedRemove, conversationId, id),
    sendStaged: (conversationId, text) =>
      ipcRenderer.invoke(IPC.fileStagedSend, conversationId, text),
    sendRich: (conversationId, parts) =>
      ipcRenderer.invoke(IPC.fileSendRich, conversationId, parts),
    sendFolder: (conversationId, path) =>
      ipcRenderer.invoke(IPC.fileSendFolder, conversationId, path)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
    defaults: () => ipcRenderer.invoke(IPC.settingsDefaults),
    setStartAtLogin: (enabled) => ipcRenderer.invoke(IPC.settingsStartAtLogin, enabled)
  },
  shortcuts: {
    setRecording: (active) => ipcRenderer.invoke(IPC.shortcutsRecording, active),
    available: (accelerator) => ipcRenderer.invoke(IPC.shortcutsAvailable, accelerator)
  },
  firewall: {
    check: () => ipcRenderer.invoke(IPC.firewallCheck),
    repair: () => ipcRenderer.invoke(IPC.firewallRepair)
  },
  identity: {
    pickAvatar: () => ipcRenderer.invoke(IPC.identityPickAvatar),
    clearAvatar: () => ipcRenderer.invoke(IPC.identityClearAvatar),
    setStatus: (status) => ipcRenderer.invoke(IPC.identityStatus, status)
  },
  storage: {
    previewNwtImport: () => ipcRenderer.invoke(IPC.storageImportNwtPreview),
    applyNwtImport: (request) => ipcRenderer.invoke(IPC.storageImportNwtApply, request)
  }
}

contextBridge.exposeInMainWorld('api', api)
