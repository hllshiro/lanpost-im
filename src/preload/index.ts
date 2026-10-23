import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type Api } from '../shared/ipc'
import type { AppEvent } from '../shared/domain'
import type { Settings, SettingsPatch } from '../shared/settings'

const api: Api & {
  settings: {
    get(): Promise<Settings>
    update(patch: SettingsPatch): Promise<Settings>
  }
} = {
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
  messages: {
    list: (request) => ipcRenderer.invoke(IPC.messagesList, request),
    send: (request) => ipcRenderer.invoke(IPC.messageSend, request),
    markRead: (conversationId, messageId) =>
      ipcRenderer.invoke(IPC.conversationRead, conversationId, messageId),
    saveDraft: (conversationId, draft) =>
      ipcRenderer.invoke(IPC.conversationDraft, conversationId, draft)
  },
  peers: {
    setAlias: (peerKey, alias) => ipcRenderer.invoke(IPC.peerAlias, peerKey, alias)
  },
  files: {
    accept: (id) => ipcRenderer.invoke(IPC.fileAccept, id),
    reject: (id) => ipcRenderer.invoke(IPC.fileReject, id),
    open: (id) => ipcRenderer.invoke(IPC.fileOpen, id),
    reveal: (id) => ipcRenderer.invoke(IPC.fileReveal, id),
    saveAs: (id) => ipcRenderer.invoke(IPC.fileSaveAs, id)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch)
  }
}

contextBridge.exposeInMainWorld('api', api)
