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
    registerFavoriteLibraryOperationsIpc({ ipcMain, batch: batch as never, managed: managed as never, isTrustedSender: () => true, getCurrentAccountMid: vi.fn().mockResolvedValue('100'), resolveSourceScope: vi.fn(async () => ({ kind: 'bilimi-logical', folderId: 'bilimi-logical:source' })) as never })

    await ipcMain.invoke('favorite-library-operations:copy', 7, '100', [3, 1], ['bilimi-logical:target'], 4, { kind: 'folder', folderId: 'bilimi-logical:source' })
    await ipcMain.invoke('favorite-library-operations:move', 7, '100', [3, 1], 'bilimi-logical:source', ['bilimi-logical:target'], 4, { kind: 'folder', folderId: 'bilimi-logical:source' })

    expect(batch.copy).toHaveBeenCalledWith('100', [1, 3], ['bilimi-logical:target'], 4, { kind: 'bilimi-logical', folderId: 'bilimi-logical:source' })
    expect(batch.move).toHaveBeenCalledWith('100', [1, 3], 'bilimi-logical:source', ['bilimi-logical:target'], 4, { kind: 'bilimi-logical', folderId: 'bilimi-logical:source' })
    await expect(ipcMain.invoke('favorite-library-operations:copy', 7, '100', [1], ['C:\\escape'], 4, { kind: 'folder', folderId: 'bilimi-logical:source' })).rejects.toThrow('target')
  })

  it('exposes one revision-checked batch local deletion without routing through repeated single-row deletes', async () => {
    const ipcMain = new FakeIpcMain()
    const batch = { copy: vi.fn(), move: vi.fn(), deleteLocal: vi.fn().mockResolvedValue({ status: 'succeeded' }), previewRemoteUnfavorite: vi.fn(), confirmRemoteUnfavorite: vi.fn(), executeRemoteUnfavorite: vi.fn(), reconcileRemoteUnfavorite: vi.fn() }
    const managed = { preview: vi.fn(), deleteLocal: vi.fn(), confirm: vi.fn(), executeRemote: vi.fn(), reconcile: vi.fn() }
    registerFavoriteLibraryOperationsIpc({ ipcMain, batch: batch as never, managed: managed as never, isTrustedSender: () => true, getCurrentAccountMid: vi.fn().mockResolvedValue('100'), resolveSourceScope: vi.fn(async () => ({ kind: 'bilimi-logical', folderId: 'bilimi-logical:source' })) as never })

    await ipcMain.invoke('favorite-library-operations:delete-local', 7, '100', [2, 1], 4, { kind: 'folder', folderId: 'bilimi-logical:source' })
    expect(batch.deleteLocal).toHaveBeenCalledWith('100', [1, 2], 4, { kind: 'bilimi-logical', folderId: 'bilimi-logical:source' })
  })

  it('passes an explicitly selected current-and-other bilimi work-folder scope to local deletion', async () => {
    const ipcMain = new FakeIpcMain()
    const batch = {
      copy: vi.fn(), move: vi.fn(),
      deleteLocal: vi.fn().mockResolvedValue({ status: 'succeeded', completedOperationCount: 1, totalOperationCount: 1, affectedAids: [2] }),
      previewRemoteUnfavorite: vi.fn(), confirmRemoteUnfavorite: vi.fn(), executeRemoteUnfavorite: vi.fn(), reconcileRemoteUnfavorite: vi.fn()
    }
    const managed = { preview: vi.fn(), deleteLocal: vi.fn(), confirm: vi.fn(), executeRemote: vi.fn(), reconcile: vi.fn() }
    registerFavoriteLibraryOperationsIpc({
      ipcMain, batch: batch as never, managed: managed as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100'),
      resolveSourceScope: vi.fn(async (_accountMid, source) => ({
        kind: 'bilimi-logical', folderId: 'bilimi-logical:source',
        ...(source.folderIds ? { folderIds: source.folderIds } : {})
      })) as never
    })

    await expect(ipcMain.invoke('favorite-library-operations:delete-local', 7, '100', [2], 4, {
      kind: 'folder', folderId: 'bilimi-logical:source', folderIds: ['bilimi-logical:source', 'bilimi-logical:target']
    })).resolves.toEqual({ status: 'succeeded', completedOperationCount: 1, totalOperationCount: 1, affectedAids: [2] })

    expect(batch.deleteLocal).toHaveBeenCalledWith('100', [2], 4, {
      kind: 'bilimi-logical', folderId: 'bilimi-logical:source', folderIds: ['bilimi-logical:source', 'bilimi-logical:target']
    })
  })

  it('resolves a scope selection in the main process before executing a batch operation', async () => {
    const ipcMain = new FakeIpcMain()
    const batch = { copy: vi.fn(), move: vi.fn(), deleteLocal: vi.fn().mockResolvedValue({ status: 'succeeded' }), previewRemoteUnfavorite: vi.fn(), confirmRemoteUnfavorite: vi.fn(), executeRemoteUnfavorite: vi.fn(), reconcileRemoteUnfavorite: vi.fn() }
    const managed = { preview: vi.fn(), deleteLocal: vi.fn(), confirm: vi.fn(), executeRemote: vi.fn(), reconcile: vi.fn() }
    const resolveSelection = vi.fn().mockResolvedValue([1, 3])
    registerFavoriteLibraryOperationsIpc({
      ipcMain, batch: batch as never, managed: managed as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100'), resolveSourceScope: vi.fn(async () => ({ kind: 'bilimi-logical', folderId: 'bilimi-logical:music' })) as never, resolveSelection
    })

    await ipcMain.invoke('favorite-library-operations:delete-local', 7, '100', {
      kind: 'scope', scope: { kind: 'folder', folderId: 'bilimi-logical:music' }, options: { query: 'needle', filter: 'unsynced', sort: 'title-asc', transcriptionFilters: ['failed'] }, excludedAids: [2]
    }, 4, { kind: 'folder', folderId: 'bilimi-logical:music' })

    expect(resolveSelection).toHaveBeenCalledWith('100', expect.objectContaining({ kind: 'scope', options: expect.objectContaining({ transcriptionFilters: ['failed'] }), excludedAids: [2] }))
    expect(batch.deleteLocal).toHaveBeenCalledWith('100', [1, 3], 4, { kind: 'bilimi-logical', folderId: 'bilimi-logical:music' })
  })

  it('keeps a physical shard on the server-side scope descriptor for a batch operation', async () => {
    const ipcMain = new FakeIpcMain()
    const batch = { copy: vi.fn(), move: vi.fn(), deleteLocal: vi.fn().mockResolvedValue({ status: 'succeeded' }), previewRemoteUnfavorite: vi.fn(), confirmRemoteUnfavorite: vi.fn(), executeRemoteUnfavorite: vi.fn(), reconcileRemoteUnfavorite: vi.fn() }
    const managed = { preview: vi.fn(), deleteLocal: vi.fn(), confirm: vi.fn(), executeRemote: vi.fn(), reconcile: vi.fn() }
    const resolveSelection = vi.fn().mockResolvedValue([2])
    registerFavoriteLibraryOperationsIpc({
      ipcMain, batch: batch as never, managed: managed as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100'),
      resolveSourceScope: vi.fn(async () => ({ kind: 'bilimi-logical', folderId: 'bilimi-logical:music' })) as never,
      resolveSelection
    })

    await ipcMain.invoke('favorite-library-operations:delete-local', 7, '100', {
      kind: 'scope', scope: { kind: 'folder', folderId: 'bilimi-logical:music' },
      options: { physicalShard: { logicalLedgerId: 'music', shardNumber: 2 } }, excludedAids: []
    }, 4, { kind: 'folder', folderId: 'bilimi-logical:music' })

    expect(resolveSelection).toHaveBeenCalledWith('100', expect.objectContaining({
      options: expect.objectContaining({ physicalShard: { logicalLedgerId: 'music', shardNumber: 2 } })
    }))
    expect(batch.deleteLocal).toHaveBeenCalledWith('100', [2], 4, { kind: 'bilimi-logical', folderId: 'bilimi-logical:music' })
  })

  it('keeps transcription filters on a scope descriptor passed to a copy operation', async () => {
    const ipcMain = new FakeIpcMain()
    const batch = { copy: vi.fn().mockResolvedValue({ status: 'succeeded' }), move: vi.fn(), deleteLocal: vi.fn(), previewRemoteUnfavorite: vi.fn(), confirmRemoteUnfavorite: vi.fn(), executeRemoteUnfavorite: vi.fn(), reconcileRemoteUnfavorite: vi.fn() }
    const managed = { preview: vi.fn(), deleteLocal: vi.fn(), confirm: vi.fn(), executeRemote: vi.fn(), reconcile: vi.fn() }
    const resolveSelection = vi.fn().mockResolvedValue([1, 3])
    registerFavoriteLibraryOperationsIpc({
      ipcMain, batch: batch as never, managed: managed as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100'), resolveSourceScope: vi.fn(async () => ({ kind: 'bilimi-logical' })) as never, resolveSelection
    })

    await ipcMain.invoke('favorite-library-operations:copy', 7, '100', {
      kind: 'scope', scope: { kind: 'all' }, options: { transcriptionFilters: ['running', 'completed', 'running'] }, excludedAids: [2]
    }, ['bilimi-logical:target'], 4, { kind: 'folder', folderId: 'bilimi-logical:source' })

    expect(resolveSelection).toHaveBeenCalledWith('100', expect.objectContaining({
      options: expect.objectContaining({ transcriptionFilters: ['completed', 'running'] }), excludedAids: [2]
    }))
    expect(batch.copy).toHaveBeenCalledWith('100', [1, 3], ['bilimi-logical:target'], 4, { kind: 'bilimi-logical' })
  })

  it('keeps classification-source filters on a scope descriptor passed to a copy operation', async () => {
    const ipcMain = new FakeIpcMain()
    const batch = { copy: vi.fn().mockResolvedValue({ status: 'succeeded' }), move: vi.fn(), deleteLocal: vi.fn(), previewRemoteUnfavorite: vi.fn(), confirmRemoteUnfavorite: vi.fn(), executeRemoteUnfavorite: vi.fn(), reconcileRemoteUnfavorite: vi.fn() }
    const managed = { preview: vi.fn(), deleteLocal: vi.fn(), confirm: vi.fn(), executeRemote: vi.fn(), reconcile: vi.fn() }
    const resolveSelection = vi.fn().mockResolvedValue([1])
    registerFavoriteLibraryOperationsIpc({
      ipcMain, batch: batch as never, managed: managed as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100'), resolveSourceScope: vi.fn(async () => ({ kind: 'bilimi-logical' })) as never, resolveSelection
    })

    await ipcMain.invoke('favorite-library-operations:copy', 7, '100', {
      kind: 'scope', scope: { kind: 'all' }, options: { classificationSources: ['manual', 'deepseek', 'manual'] }, excludedAids: []
    }, ['bilimi-logical:target'], 4, { kind: 'folder', folderId: 'bilimi-logical:source' })

    expect(resolveSelection).toHaveBeenCalledWith('100', expect.objectContaining({
      options: expect.objectContaining({ classificationSources: ['deepseek', 'manual'] })
    }))
  })

  it('passes a resolved all-results virtual selection to the local deletion service', async () => {
    const ipcMain = new FakeIpcMain()
    const batch = { copy: vi.fn(), move: vi.fn(), deleteLocal: vi.fn().mockResolvedValue({ status: 'succeeded' }), previewRemoteUnfavorite: vi.fn(), confirmRemoteUnfavorite: vi.fn(), executeRemoteUnfavorite: vi.fn(), reconcileRemoteUnfavorite: vi.fn() }
    const managed = { preview: vi.fn(), deleteLocal: vi.fn(), confirm: vi.fn(), executeRemote: vi.fn(), reconcile: vi.fn() }
    const resolveSelection = vi.fn().mockResolvedValue([1, 2])
    const resolveSourceScope = vi.fn(async (_accountMid, source) => ({ kind: 'virtual', ...source }))
    registerFavoriteLibraryOperationsIpc({ ipcMain, batch: batch as never, managed: managed as never, isTrustedSender: () => true, getCurrentAccountMid: vi.fn().mockResolvedValue('100'), resolveSelection, resolveSourceScope: resolveSourceScope as never })

    await ipcMain.invoke('favorite-library-operations:delete-local', 7, '100', {
      kind: 'scope', scope: { kind: 'all' }, options: {}, excludedAids: []
    }, 4, { kind: 'virtual', eligibleAids: [], skippedAids: [] })

    expect(resolveSourceScope).toHaveBeenCalledWith('100', { kind: 'virtual', eligibleAids: [1, 2], skippedAids: [] }, [1, 2])
    expect(batch.deleteLocal).toHaveBeenCalledWith('100', [1, 2], 4, { kind: 'virtual', eligibleAids: [1, 2], skippedAids: [] })
  })

  it('passes a virtual bilimi-membership deletion request only after resolving the selected aids in main', async () => {
    const ipcMain = new FakeIpcMain()
    const batch = { copy: vi.fn(), move: vi.fn(), deleteLocal: vi.fn().mockResolvedValue({ status: 'succeeded' }), previewRemoteUnfavorite: vi.fn(), confirmRemoteUnfavorite: vi.fn(), executeRemoteUnfavorite: vi.fn(), reconcileRemoteUnfavorite: vi.fn() }
    const managed = { preview: vi.fn(), deleteLocal: vi.fn(), confirm: vi.fn(), executeRemote: vi.fn(), reconcile: vi.fn() }
    const resolveSourceScope = vi.fn(async (_accountMid, source) => ({ kind: 'virtual', ...source }))
    registerFavoriteLibraryOperationsIpc({ ipcMain, batch: batch as never, managed: managed as never, isTrustedSender: () => true, getCurrentAccountMid: vi.fn().mockResolvedValue('100'), resolveSourceScope: resolveSourceScope as never })

    await ipcMain.invoke('favorite-library-operations:delete-local', 7, '100', [2, 1], 4, {
      kind: 'virtual', eligibleAids: [2, 1], skippedAids: [], bilimiMembershipSelection: 'primary'
    })

    expect(resolveSourceScope).toHaveBeenCalledWith('100', {
      kind: 'virtual', eligibleAids: [1, 2], skippedAids: [], bilimiMembershipSelection: 'primary'
    }, [1, 2])
    expect(batch.deleteLocal).toHaveBeenCalledWith('100', [1, 2], 4, {
      kind: 'virtual', eligibleAids: [1, 2], skippedAids: [], bilimiMembershipSelection: 'primary'
    })
  })

  it('derives virtual managed-placement eligibility from a resolved all-results selection', async () => {
    const ipcMain = new FakeIpcMain()
    const batch = {
      copy: vi.fn(), move: vi.fn(), deleteLocal: vi.fn(),
      previewRemoteUnfavorite: vi.fn(), confirmRemoteUnfavorite: vi.fn(), executeRemoteUnfavorite: vi.fn(), reconcileRemoteUnfavorite: vi.fn(),
      previewManagedPlacementRemoval: vi.fn().mockResolvedValue({ status: 'previewed', executionToken: 'managed-preview' }),
      confirmManagedPlacementRemoval: vi.fn(), executeManagedPlacementRemoval: vi.fn(), reconcileManagedPlacementRemoval: vi.fn()
    }
    const managed = { preview: vi.fn(), deleteLocal: vi.fn(), confirm: vi.fn(), executeRemote: vi.fn(), reconcile: vi.fn() }
    const resolveSelection = vi.fn().mockResolvedValue([1, 2])
    const resolveSourceScope = vi.fn(async (_accountMid, source) => ({ kind: 'virtual', ...source }))
    registerFavoriteLibraryOperationsIpc({ ipcMain, batch: batch as never, managed: managed as never, isTrustedSender: () => true, getCurrentAccountMid: vi.fn().mockResolvedValue('100'), resolveSelection, resolveSourceScope: resolveSourceScope as never })

    await ipcMain.invoke('favorite-library-operations:preview-managed-placement-removal', 7, '100', {
      kind: 'scope', scope: { kind: 'all' }, options: {}, excludedAids: []
    }, ['bilimi-logical:target'], 4, { kind: 'virtual', eligibleAids: [], skippedAids: [] })

    expect(resolveSourceScope).toHaveBeenCalledWith('100', { kind: 'virtual', eligibleAids: [1, 2], skippedAids: [] }, [1, 2])
    expect(batch.previewManagedPlacementRemoval).toHaveBeenCalledWith('100', [1, 2], ['bilimi-logical:target'], 4, { kind: 'virtual', eligibleAids: [1, 2], skippedAids: [] })
  })

  it('rejects a scope operation when the account changes during main-process resolution', async () => {
    const ipcMain = new FakeIpcMain()
    const batch = { copy: vi.fn(), move: vi.fn(), deleteLocal: vi.fn(), previewRemoteUnfavorite: vi.fn(), confirmRemoteUnfavorite: vi.fn(), executeRemoteUnfavorite: vi.fn(), reconcileRemoteUnfavorite: vi.fn() }
    const managed = { preview: vi.fn(), deleteLocal: vi.fn(), confirm: vi.fn(), executeRemote: vi.fn(), reconcile: vi.fn() }
    let accountMid = '100'
    let resolveSelection: ((aids: number[]) => void) | undefined
    registerFavoriteLibraryOperationsIpc({
      ipcMain, batch: batch as never, managed: managed as never, isTrustedSender: () => true,
      getCurrentAccountMid: async () => accountMid,
      resolveSelection: vi.fn(() => new Promise<number[]>((resolve) => { resolveSelection = resolve })),
      resolveSourceScope: vi.fn(async () => ({ kind: 'bilimi-logical' })) as never
    })
    const pending = ipcMain.invoke('favorite-library-operations:delete-local', 7, '100', {
      kind: 'scope', scope: { kind: 'all' }, options: {}, excludedAids: []
    }, 4, { kind: 'folder', folderId: 'bilimi-logical:source' })
    await vi.waitFor(() => expect(resolveSelection).toBeDefined())
    accountMid = '200'
    resolveSelection?.([1])
    await expect(pending).rejects.toThrow('account')
    expect(batch.deleteLocal).not.toHaveBeenCalled()
  })

  it('rejects the retired global remote unfavorite route so a caller cannot remove every Bilibili membership', async () => {
    const ipcMain = new FakeIpcMain()
    const batch = {
      previewRemoteUnfavorite: vi.fn().mockResolvedValue({ executionToken: 'execute', operationId: 'remote-1' }),
      confirmRemoteUnfavorite: vi.fn().mockReturnValue('confirm'),
      executeRemoteUnfavorite: vi.fn().mockResolvedValue({ status: 'result-unknown' }),
      reconcileRemoteUnfavorite: vi.fn().mockResolvedValue({ status: 'reconciliation-required' }),
      copy: vi.fn(), move: vi.fn()
    }
    const managed = { preview: vi.fn(), deleteLocal: vi.fn(), confirm: vi.fn(), executeRemote: vi.fn(), reconcile: vi.fn() }
    registerFavoriteLibraryOperationsIpc({ ipcMain, batch: batch as never, managed: managed as never, isTrustedSender: (id) => id === 7, getCurrentAccountMid: vi.fn().mockResolvedValue('100'), resolveSourceScope: vi.fn(async () => ({ kind: 'bilimi-logical' })) as never })

    expect(() => ipcMain.invoke('favorite-library-operations:preview-unfavorite', 7, '100', [2], 4, { kind: 'folder', folderId: 'bilimi-logical:source' }))
      .toThrow('retired')
    expect(batch.previewRemoteUnfavorite).not.toHaveBeenCalled()
    expect(batch.confirmRemoteUnfavorite).not.toHaveBeenCalled()
    expect(batch.executeRemoteUnfavorite).not.toHaveBeenCalled()
    batch.reconcileRemoteUnfavorite.mockResolvedValue({ status: 'reconciliation-required' })
    await expect(ipcMain.invoke('favorite-library-operations:reconcile-unfavorite', 7, '100', 'remote-1'))
      .resolves.toEqual({ status: 'reconciliation-required' })
    expect(batch.reconcileRemoteUnfavorite).toHaveBeenCalledWith('100', 'remote-1')
  })

  it('exposes managed-placement removal from an ordinary source without granting global unfavorite', async () => {
    const ipcMain = new FakeIpcMain()
    const batch = {
      copy: vi.fn(), move: vi.fn(), deleteLocal: vi.fn(),
      previewRemoteUnfavorite: vi.fn(), confirmRemoteUnfavorite: vi.fn(), executeRemoteUnfavorite: vi.fn(), reconcileRemoteUnfavorite: vi.fn(),
      previewManagedPlacementRemoval: vi.fn().mockResolvedValue({ executionToken: 'managed-execute', operationId: 'managed-1' }),
      confirmManagedPlacementRemoval: vi.fn().mockReturnValue('managed-confirm'),
      executeManagedPlacementRemoval: vi.fn().mockResolvedValue({ status: 'result-unknown' }),
      reconcileManagedPlacementRemoval: vi.fn().mockResolvedValue({ status: 'reconciliation-required' })
    }
    const managed = { preview: vi.fn(), deleteLocal: vi.fn(), confirm: vi.fn(), executeRemote: vi.fn(), reconcile: vi.fn() }
    registerFavoriteLibraryOperationsIpc({
      ipcMain, batch: batch as never, managed: managed as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100'),
      resolveSourceScope: vi.fn(async () => ({ kind: 'bilibili-user', folderId: 'bilibili:ordinary' })) as never
    })

    await ipcMain.invoke('favorite-library-operations:preview-managed-placement-removal', 7, '100', [2], ['bilimi-logical:work'], 4, { kind: 'folder', folderId: 'bilibili:ordinary' })
    expect(batch.previewManagedPlacementRemoval).toHaveBeenCalledWith('100', [2], ['bilimi-logical:work'], 4, { kind: 'bilibili-user', folderId: 'bilibili:ordinary' })
    await ipcMain.invoke('favorite-library-operations:confirm-managed-placement-removal', 7, '100', 'managed-execute')
    expect(batch.confirmManagedPlacementRemoval).toHaveBeenCalledWith('100', 'managed-execute')
    await ipcMain.invoke('favorite-library-operations:execute-managed-placement-removal', 7, '100', 'managed-execute', 'managed-confirm')
    await expect(ipcMain.invoke('favorite-library-operations:reconcile-managed-placement-removal', 7, '100', 'managed-1'))
      .resolves.toEqual({ status: 'reconciliation-required' })
    expect(batch.previewRemoteUnfavorite).not.toHaveBeenCalled()
  })

  it('uses a distinct local-default and second remote-confirmation path for managed folders', async () => {
    const ipcMain = new FakeIpcMain()
    const batch = { previewRemoteUnfavorite: vi.fn(), confirmRemoteUnfavorite: vi.fn(), executeRemoteUnfavorite: vi.fn(), reconcileRemoteUnfavorite: vi.fn(), copy: vi.fn(), move: vi.fn() }
    const managed = {
      preview: vi.fn().mockResolvedValue({ executionToken: 'folder-execute', operationId: 'folder-1' }),
      deleteLocal: vi.fn().mockResolvedValue({ status: 'succeeded' }), deleteLocalMany: vi.fn().mockResolvedValue({ status: 'succeeded' }),
      confirm: vi.fn().mockReturnValue('folder-confirm'), executeRemote: vi.fn().mockResolvedValue({ status: 'succeeded' }), reconcile: vi.fn().mockResolvedValue({ status: 'completed' })
    }
    registerFavoriteLibraryOperationsIpc({ ipcMain, batch: batch as never, managed: managed as never, isTrustedSender: () => true, getCurrentAccountMid: vi.fn().mockResolvedValue('100'), resolveSourceScope: vi.fn(async () => ({ kind: 'bilimi-logical' })) as never })

    await ipcMain.invoke('favorite-library-operations:preview-managed-folder-delete', 7, '100', 'bilimi-logical:work')
    await ipcMain.invoke('favorite-library-operations:delete-managed-folder-local', 7, '100', 'folder-execute')
    expect(managed.deleteLocal).toHaveBeenCalledWith('100', 'folder-execute')
    await ipcMain.invoke('favorite-library-operations:delete-managed-folders-local', 7, '100', ['folder-execute', 'folder-execute-2'])
    expect(managed.deleteLocalMany).toHaveBeenCalledWith('100', ['folder-execute', 'folder-execute-2'])
    await ipcMain.invoke('favorite-library-operations:confirm-managed-folder-remote-delete', 7, '100', 'folder-execute')
    expect(managed.confirm).toHaveBeenCalledWith('100', 'folder-execute')
    await ipcMain.invoke('favorite-library-operations:execute-managed-folder-remote-delete', 7, '100', 'folder-execute', 'folder-confirm')
    await expect(ipcMain.invoke('favorite-library-operations:reconcile-managed-folder-delete', 7, '100', 'folder-1')).resolves.toEqual({ status: 'completed' })
  })

  it('returns the account-bound all-workspace deletion preview without trusting renderer folder ids', async () => {
    const ipcMain = new FakeIpcMain()
    const previewAll = vi.fn().mockResolvedValue({ folderCount: 2, remoteAllowed: false })
    const batch = { copy: vi.fn(), move: vi.fn(), deleteLocal: vi.fn(), previewRemoteUnfavorite: vi.fn(), confirmRemoteUnfavorite: vi.fn(), executeRemoteUnfavorite: vi.fn(), reconcileRemoteUnfavorite: vi.fn() }
    const managed = { preview: vi.fn(), previewAll, deleteLocal: vi.fn(), confirm: vi.fn(), executeRemote: vi.fn(), reconcile: vi.fn() }
    registerFavoriteLibraryOperationsIpc({ ipcMain, batch: batch as never, managed: managed as never, isTrustedSender: () => true, getCurrentAccountMid: vi.fn().mockResolvedValue('100'), resolveSourceScope: vi.fn(async () => ({ kind: 'bilimi-logical' })) as never })

    await expect(ipcMain.invoke('favorite-library-operations:preview-managed-folder-group-delete', 7, '100')).resolves.toEqual({ folderCount: 2, remoteAllowed: false })
    expect(previewAll).toHaveBeenCalledWith('100')
  })

  it('allows local deletion while rejecting remote and placement mutation from a Bilibili source', async () => {
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
    await ipcMain.invoke('favorite-library-operations:delete-local', 7, '100', [1], 4, forgedFolder)
    expect(() => ipcMain.invoke('favorite-library-operations:preview-unfavorite', 7, '100', [1], 4, forgedFolder)).toThrow('retired')
    expect(batch.move).not.toHaveBeenCalled()
    expect(batch.deleteLocal).toHaveBeenCalledWith('100', [1], 4, { kind: 'bilibili-default', folderId: 'bilibili:1' })
    expect(batch.previewRemoteUnfavorite).not.toHaveBeenCalled()

    await ipcMain.invoke('favorite-library-operations:delete-local', 7, '100', [1], 4, { kind: 'virtual', eligibleAids: [1], skippedAids: [2] })
    expect(batch.deleteLocal).toHaveBeenCalledTimes(2)
  })
})
