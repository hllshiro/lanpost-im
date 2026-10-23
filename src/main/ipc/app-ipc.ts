import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type { AppService } from '../app-service'

export function registerAppIpc(service: AppService): void {
  ipcMain.handle(IPC.snapshot, () => service.snapshot())
  ipcMain.handle(IPC.messagesList, (_event, request) => service.listMessages(request))
  ipcMain.handle(IPC.messageSend, (_event, request) => service.sendText(request))
  ipcMain.handle(IPC.conversationRead, (_event, conversationId: string, messageId: number) =>
    service.markRead(conversationId, messageId)
  )
  ipcMain.handle(IPC.conversationDraft, (_event, conversationId: string, draft: string) =>
    service.saveDraft(conversationId, draft)
  )
  ipcMain.handle(IPC.peerAlias, (_event, peerKey: string, alias: string) =>
    service.setAlias(peerKey, alias)
  )
  ipcMain.handle(IPC.filesList, (_event, conversationId?: string) => service.listFiles(conversationId))
  ipcMain.handle(IPC.fileAccept, (_event, id: string) => service.acceptFile(id))
  ipcMain.handle(IPC.fileReject, (_event, id: string) => service.rejectFile(id))
  ipcMain.handle(IPC.fileOpen, (_event, id: string) => service.openFile(id))
  ipcMain.handle(IPC.fileReveal, (_event, id: string) => service.revealFile(id))
  ipcMain.handle(IPC.fileSaveAs, (_event, id: string) => service.saveFileAs(id))
  ipcMain.handle(IPC.filePick, (_event, conversationId: string) =>
    service.pickAndSend(conversationId)
  )
  ipcMain.handle(
    IPC.fileSend,
    (_event, conversationId: string, paths: string[]) => service.sendFiles(conversationId, paths)
  )
  ipcMain.on(IPC.uiActiveConversation, (_event, conversationId: string | null) =>
    service.setActiveConversation(conversationId)
  )
}
