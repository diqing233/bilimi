import { describe, expect, it, vi } from 'vitest'
import { registerFavoriteLibraryOperationsIpc } from './favoriteLibraryOperationsIpc'

class FakeIpcMain {
  handlers = new Map<string, (event: { sender: { id: number } }, ...args: never[]) => unknown>()
  handle(channel: string, handler: (event: { sender: { id: number } }, ...args: never[]) => unknown) { this.handlers.set(channel, handler) }
  invoke(channel: string, senderId: number, ...args: unknown[]) { return this.handlers.get(channel)?.({ sender: { id: senderId } }, ...args as never[]) }
}

describe('registerFavoriteLibraryOperationsIpc', () => {
  it('exposes validated account-bound copy and move operations without granting filesystem access', async () => {
    const ipcMain = new FakeIpcMain()
    const batch = {
      copy: vi.fn().mockResolvedValue({ status: 'succeeded' }),
      move: vi.fn().mockResolvedValue({ status: 'succeeded' }),
      previewRemoteUnfavorite: vi.fn(), confirmRemoteUnfavorite: vi.fn(), executeRemoteUnfavorite: vi.fn(), reconcileRemoteUnfavorite: vi.fn()
    }
    const managed = { preview: vi.fn(), deleteLocal: vi.fn(), confirm: vi.fn(), executeRemote: vi.fn(), reconcile: vi.fn() }
    registerFavoriteLibraryOperationsIpc({ ipcMain, batch: batch as never, managed: managed as never, isTrustedSender: () => true, getCurrentAccountMid: vi.fn().mockResolvedValue('100'), resolveSourceScope: vi.fn(async () => ({ kind: 'bilimi-logical' })) })

    await ipcMain.invoke('favorite-library-operations:copy', 7, '100', [3, 1], ['bilimi-logical:target'], 4, { kind: 'folder', folderId: 'bilimi-logical:source' })
    await ipcMain.invoke('favorite-library-operations:move', 7, '100', [3, 1], 'bilimi-logical:source', ['bilimi-logical:target'], 4, { kind: 'folder', folderId: 'bilimi-logical:source' })

    expect(batch.copy).toHaveBeenCalledWith('100', [1, 3], ['bilimi-logical:target'], 4, { kind: 'bilimi-logical' })
    expect(batch.move).toHaveBeenCalledWith('100', [1, 3], 'bilimi-logical:source', ['bilimi-logical:target'], 4, { kind: 'bilimi-logical' })
    await expect(ipcMain.invoke('favorite-library-operations:copy', 7, '100', [1], ['C:\\escape'], 4, { kind: 'folder', folderId: 'bilimi-logical:source' })).rejects.toThrow('target')
  })

  it('exposes one revision-checked batch local deletion without routing through repeated single-row deletes', async () => {
    const ipcMain = new FakeIpcMain()
    const batch = { copy: vi.fn(), move: vi.fn(), deleteLocal: vi.fn().mockResolvedValue({ status: 'succeeded' }), previewRemoteUnfavorite: vi.fn(), confirmRemoteUnfavorite: vi.fn(), executeRemoteUnfavorite: vi.fn(), reconcileRemoteUnfavorite: vi.fn() }
    const managed = { preview: vi.fn(), deleteLocal: vi.fn(), confirm: vi.fn(), executeRemote: vi.fn(), reconcile: vi.fn() }
    registerFavoriteLibraryOperationsIpc({ ipcMain, batch: batch as never, managed: managed as never, isTrustedSender: () => true, getCurrentAccountMid: vi.fn().mockResolvedValue('100'), resolveSourceScope: vi.fn(async () => ({ kind: 'bilimi-logical' })) })

    await ipcMain.invoke('favorite-library-operations:delete-local', 7, '100', [2, 1], 4, { kind: 'folder', folderId: 'bilimi-logical:source' })
    expect(batch.deleteLocal).toHaveBeenCalledWith('100', [1, 2], 4, { kind: 'bilimi-logical' })
  })

  it('keeps remote unfavorite behind trusted account-bound preview, confirmation, execution, and reconciliation', async () => {
    const ipcMain = new FakeIpcMain()
    const batch = {
      previewRemoteUnfavorite: vi.fn().mockResolvedValue({ executionToken: 'execute', operationId: 'remote-1' }),
      confirmRemoteUnfavorite: vi.fn().mockReturnValue('confirm'),
      executeRemoteUnfavorite: vi.fn().mockResolvedValue({ status: 'result-unknown' }),
      reconcileRemoteUnfavorite: vi.fn().mockResolvedValue({ status: 'reconciliation-required' }),
      copy: vi.fn(), move: vi.fn()
    }
    const managed = { preview: vi.fn(), deleteLocal: vi.fn(), confirm: vi.fn(), executeRemote: vi.fn(), reconcile: vi.fn() }
    registerFavoriteLibraryOperationsIpc({ ipcMain, batch: batch as never, managed: managed as never, isTrustedSender: (id) => id === 7, getCurrentAccountMid: vi.fn().mockResolvedValue('100'), resolveSourceScope: vi.fn(async () => ({ kind: 'bilimi-logical' })) })

    await expect(ipcMain.invoke('favorite-library-operations:preview-unfavorite', 8, '100', [2], 4, { kind: 'folder', folderId: 'bilimi-logical:source' })).rejects.toThrow('untrusted')
    await ipcMain.invoke('favorite-library-operations:preview-unfavorite', 7, '100', [2], 4, { kind: 'folder', folderId: 'bilimi-logical:source' })
    expect(batch.previewRemoteUnfavorite).toHaveBeenCalledWith('100', [2], 4, { kind: 'bilimi-logical' })
    await ipcMain.invoke('favorite-library-operations:confirm-unfavorite', 7, '100', 'execute')
    await ipcMain.invoke('favorite-library-operations:execute-unfavorite', 7, '100', 'execute', 'confirm')
    await expect(ipcMain.invoke('favorite-library-operations:reconcile-unfavorite', 7, '100', 'remote-1')).resolves.toEqual({ status: 'reconciliation-required' })
  })

  it('uses a distinct local-default and second remote-confirmation path for managed folders', async () => {
    const ipcMain = new FakeIpcMain()
    const batch = { previewRemoteUnfavorite: vi.fn(), confirmRemoteUnfavorite: vi.fn(), executeRemoteUnfavorite: vi.fn(), reconcileRemoteUnfavorite: vi.fn(), copy: vi.fn(), move: vi.fn() }
    const managed = {
      preview: vi.fn().mockResolvedValue({ executionToken: 'folder-execute', operationId: 'folder-1' }),
      deleteLocal: vi.fn().mockResolvedValue({ status: 'succeeded' }),
      confirm: vi.fn().mockReturnValue('folder-confirm'), executeRemote: vi.fn().mockResolvedValue({ status: 'succeeded' }), reconcile: vi.fn().mockResolvedValue({ status: 'completed' })
    }
    registerFavoriteLibraryOperationsIpc({ ipcMain, batch: batch as never, managed: managed as never, isTrustedSender: () => true, getCurrentAccountMid: vi.fn().mockResolvedValue('100'), resolveSourceScope: vi.fn(async () => ({ kind: 'bilimi-logical' })) })

    await ipcMain.invoke('favorite-library-operations:preview-managed-folder-delete', 7, '100', 'bilimi-logical:work')
    await ipcMain.invoke('favorite-library-operations:delete-managed-folder-local', 7, '100', 'folder-execute')
    expect(managed.deleteLocal).toHaveBeenCalledWith('100', 'folder-execute')
    await ipcMain.invoke('favorite-library-operations:confirm-managed-folder-remote-delete', 7, '100', 'folder-execute')
    await ipcMain.invoke('favorite-library-operations:execute-managed-folder-remote-delete', 7, '100', 'folder-execute', 'folder-confirm')
    await expect(ipcMain.invoke('favorite-library-operations:reconcile-managed-folder-delete', 7, '100', 'folder-1')).resolves.toEqual({ status: 'completed' })
  })

  it('derives Bilibili source permissions in the main process and preserves explicit virtual evidence', async () => {
    const ipcMain = new FakeIpcMain()
    const batch = { copy: vi.fn(), move: vi.fn(), deleteLocal: vi.fn(), previewRemoteUnfavorite: vi.fn(), confirmRemoteUnfavorite: vi.fn(), executeRemoteUnfavorite: vi.fn(), reconcileRemoteUnfavorite: vi.fn() }
    const managed = { preview: vi.fn(), deleteLocal: vi.fn(), confirm: vi.fn(), executeRemote: vi.fn(), reconcile: vi.fn() }
    const resolveSourceScope = vi.fn()
      .mockResolvedValueOnce({ kind: 'bilibili-default', folderId: 'bilibili:1' })
      .mockResolvedValueOnce({ kind: 'bilibili-default', folderId: 'bilibili:1' })
      .mockResolvedValueOnce({ kind: 'bilibili-default', folderId: 'bilibili:1' })
      .mockResolvedValueOnce({ kind: 'virtual', eligibleAids: [1], skippedAids: [2] })
    registerFavoriteLibraryOperationsIpc({ ipcMain, batch: batch as never, managed: managed as never, isTrustedSender: () => true, getCurrentAccountMid: vi.fn().mockResolvedValue('100'), resolveSourceScope })

    const forgedFolder = { kind: 'folder', folderId: 'bilibili:1' }
    await expect(ipcMain.invoke('favorite-library-operations:move', 7, '100', [1], 'bilimi-logical:source', ['bilimi-logical:target'], 4, forgedFolder)).rejects.toThrow('not permitted')
    await expect(ipcMain.invoke('favorite-library-operations:delete-local', 7, '100', [1], 4, forgedFolder)).rejects.toThrow('not permitted')
    await expect(ipcMain.invoke('favorite-library-operations:preview-unfavorite', 7, '100', [1], 4, forgedFolder)).rejects.toThrow('not permitted')
    expect(batch.move).not.toHaveBeenCalled()
    expect(batch.deleteLocal).not.toHaveBeenCalled()
    expect(batch.previewRemoteUnfavorite).not.toHaveBeenCalled()

    await ipcMain.invoke('favorite-library-operations:delete-local', 7, '100', [1], 4, { kind: 'virtual', eligibleAids: [1], skippedAids: [2] })
    expect(batch.deleteLocal).toHaveBeenLastCalledWith('100', [1], 4, { kind: 'virtual', eligibleAids: [1], skippedAids: [2] })
  })
})
