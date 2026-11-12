import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type { AppService } from '../app-service'

export function registerAppIpc(service: AppService): void {
  ipcMain.handle(IPC.snapshot, () => service.snapshot())
  ipcMain.handle(IPC.messagesList, (_event, request) => service.listMessages(request))
  ipcMain.handle(IPC.messagesAll, (_event, conversationId: string) =>
    service.listAllMessages(conversationId)
  )
  ipcMain.handle(IPC.messageSend, (_event, request) => service.sendText(request))
  ipcMain.handle(IPC.conversationRead, (_event, conversationId: string, messageId: number) =>
    service.markRead(conversationId, messageId)
  )
  ipcMain.handle(IPC.conversationDraft, (_event, conversationId: string, draft: string) =>
    service.saveDraft(conversationId, draft)
  )
  ipcMain.handle(IPC.conversationPin, (_event, conversationId: string, pinned: boolean) =>
    service.setPinned(conversationId, pinned)
  )
  ipcMain.handle(IPC.peerAlias, (_event, peerKey: string, alias: string) =>
    service.setAlias(peerKey, alias)
  )
  ipcMain.handle(IPC.peersRefresh, () => service.refreshPeers())
  ipcMain.handle(IPC.filesList, (_event, conversationId?: string) =>
    service.listFiles(conversationId)
  )
  ipcMain.handle(IPC.fileAccept, (_event, id: string) => service.acceptFile(id))
  ipcMain.handle(IPC.fileReject, (_event, id: string) => service.rejectFile(id))
  ipcMain.handle(IPC.fileOpen, (_event, id: string) => service.openFile(id))
  ipcMain.handle(IPC.fileOpenPath, (_event, path: string) => service.openPath(path))
  ipcMain.handle(IPC.fileCopyImage, (_event, id: string) => service.copyImage(id))
  ipcMain.handle(IPC.fileReveal, (_event, id: string) => service.revealFile(id))
  ipcMain.handle(IPC.fileSaveAs, (_event, id: string) => service.saveFileAs(id))
  ipcMain.handle(IPC.filePick, (_event, conversationId: string) =>
    service.pickStaged(conversationId)
  )
  ipcMain.handle(IPC.filePaste, (_event, conversationId: string) =>
    service.pasteStaged(conversationId)
  )
  ipcMain.handle(IPC.fileStagePaths, (_event, conversationId: string, paths: string[]) =>
    service.stagePaths(conversationId, paths)
  )
  ipcMain.handle(
    IPC.fileStageBytes,
    (_event, conversationId: string, name: string, data: ArrayBuffer) =>
      service.stageBytes(conversationId, name, data)
  )
  ipcMain.handle(IPC.fileStagedRemove, (_event, conversationId: string, id: string) =>
    service.removeStaged(conversationId, id)
  )
  ipcMain.handle(IPC.fileStagedSend, (_event, conversationId: string) =>
    service.sendStaged(conversationId)
  )
  ipcMain.handle(IPC.fileSendFolder, (_event, conversationId: string, path: string) =>
    service.sendFolder(conversationId, path)
  )
  ipcMain.on(IPC.uiActiveConversation, (_event, conversationId: string | null) =>
    service.setActiveConversation(conversationId)
  )
}
