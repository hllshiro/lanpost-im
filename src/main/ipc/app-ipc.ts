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
  ipcMain.handle(IPC.identityPickAvatar, () => service.pickAvatar())
  ipcMain.handle(IPC.identityClearAvatar, () => service.clearAvatar())
  ipcMain.handle(IPC.groupCreate, (_event, name: string, memberUserIds: string[]) =>
    service.createGroup(name, memberUserIds)
  )
  ipcMain.handle(IPC.groupAvatar, (_event, groupId: string, path?: string) =>
    service.pickGroupAvatar(groupId, path)
  )
  ipcMain.handle(IPC.groupInvite, (_event, groupId: string, memberUserIds: string[]) =>
    service.inviteToGroup(groupId, memberUserIds)
  )
  ipcMain.handle(IPC.groupKick, (_event, groupId: string, userId: string) =>
    service.kickFromGroup(groupId, userId)
  )
  ipcMain.handle(IPC.groupLeave, (_event, groupId: string) => service.leaveGroup(groupId))
  ipcMain.handle(IPC.groupDismiss, (_event, groupId: string) => service.dismissGroup(groupId))
  ipcMain.handle(IPC.emotionList, () => service.listFavorites())
  ipcMain.handle(IPC.emotionAdd, (_event, fileId: string) => service.addFavorite(fileId))
  ipcMain.handle(IPC.emotionRemove, (_event, id: string) => service.removeFavorite(id))
  ipcMain.handle(IPC.emotionStage, (_event, conversationId: string, id: string) =>
    service.stageFavorite(conversationId, id)
  )
  ipcMain.handle(IPC.filesList, (_event, conversationId?: string) =>
    service.listFiles(conversationId)
  )
  ipcMain.handle(IPC.fileAccept, (_event, id: string) => service.acceptFile(id))
  ipcMain.handle(IPC.fileReject, (_event, id: string) => service.rejectFile(id))
  ipcMain.handle(IPC.fileOpen, (_event, id: string) => service.openFile(id))
  ipcMain.handle(IPC.fileOpenPath, (_event, path: string) => service.openPath(path))
  ipcMain.handle(IPC.fileCopyImage, (_event, id: string) => service.copyImage(id))
  ipcMain.handle(IPC.fileReveal, (_event, id: string) => service.revealFile(id))
  ipcMain.handle(IPC.fileRevealPath, (_event, path: string) => service.revealPath(path))
  ipcMain.handle(IPC.fileSaveAs, (_event, id: string) => service.saveFileAs(id))
  ipcMain.handle(IPC.filePick, (_event, conversationId: string) =>
    service.pickStaged(conversationId)
  )
  ipcMain.handle(IPC.filePaste, (_event, conversationId: string) =>
    service.pasteStaged(conversationId)
  )
  ipcMain.handle(
    IPC.fileStagePaths,
    (_event, conversationId: string, paths: string[], sticker: boolean) =>
      service.stagePaths(conversationId, paths, sticker)
  )
  ipcMain.handle(
    IPC.fileStageBytes,
    (_event, conversationId: string, name: string, data: ArrayBuffer, sticker: boolean) =>
      service.stageBytes(conversationId, name, data, sticker)
  )
  ipcMain.handle(IPC.fileStagedRemove, (_event, conversationId: string, id: string) =>
    service.removeStaged(conversationId, id)
  )
  ipcMain.handle(IPC.fileStagedSend, (_event, conversationId: string, text?: string) =>
    service.sendStaged(conversationId, text)
  )
  ipcMain.handle(IPC.fileSendRich, (_event, conversationId: string, parts) =>
    service.sendRich(conversationId, parts)
  )
  ipcMain.handle(IPC.fileSendFolder, (_event, conversationId: string, path: string) =>
    service.sendFolder(conversationId, path)
  )
  ipcMain.on(IPC.uiActiveConversation, (_event, conversationId: string | null) =>
    service.setActiveConversation(conversationId)
  )
}
