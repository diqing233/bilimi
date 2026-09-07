import { describe, expect, it, vi } from 'vitest'
import { registerFavoriteRepositoryIpc } from './favoriteRepositoryIpc'

class FakeIpcMain {
  handlers = new Map<string, (event: { sender: { id: number } }, ...args: never[]) => unknown>()

  handle(channel: string, handler: (event: { sender: { id: number } }, ...args: never[]) => unknown) {
    this.handlers.set(channel, handler)
  }

  invoke(channel: string, senderId: number, ...args: unknown[]) {
    return this.handlers.get(channel)?.({ sender: { id: senderId } }, ...args as never[])
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

describe('registerFavoriteRepositoryIpc', () => {
  it('exposes a read-only binding candidate preview and keeps adoption separate', async () => {
    const ipcMain = new FakeIpcMain()
    const previewLedgerBindingCandidates = vi.fn().mockResolvedValue([{ ledgerId: 'music', candidates: [] }])
    registerFavoriteRepositoryIpc({
      ipcMain, service: { getLibrarySummary: vi.fn() } as never,
      bindingService: { adoptExistingPhysicalShard: vi.fn(), previewLedgerBindingCandidates },
      isTrustedSender: () => true, getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('favorite-repository:preview-ledger-binding-candidates', 7, '100', [
      { ledgerId: 'music', title: 'bilimi·Music' }
    ])).resolves.toEqual([{ ledgerId: 'music', candidates: [] }])
    expect(previewLedgerBindingCandidates).toHaveBeenCalledWith('100', [{ ledgerId: 'music', title: 'bilimi·Music' }])
  })

  it('adopts an explicitly selected remote ledger into the account repository', async () => {
    const ipcMain = new FakeIpcMain()
    const adoptExistingPhysicalShard = vi.fn().mockResolvedValue({ logicalLedgerId: 'music' })
    registerFavoriteRepositoryIpc({
      ipcMain,
      service: { getLibrarySummary: vi.fn() } as never,
      bindingService: { adoptExistingPhysicalShard },
      isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('favorite-repository:adopt-ledger-binding', 7, '100', {
      logicalLedgerId: 'music', logicalTitle: 'bilimi·音乐', remoteFolderId: '41', remoteTitle: 'bilimi·音乐'
    })).resolves.toEqual({ logicalLedgerId: 'music' })
    expect(adoptExistingPhysicalShard).toHaveBeenCalledWith('100', {
      logicalLedgerId: 'music', logicalTitle: 'bilimi·音乐', remoteDisplayTitle: 'bilimi·音乐',
      expectedRemoteTitle: 'bilimi·音乐', remoteFolderId: '41', shardNumber: 1, memberAids: []
    })
  })

  it('renames only an explicitly addressed formally bound shard without adoption', async () => {
    const ipcMain = new FakeIpcMain()
    const renameBoundPhysicalShard = vi.fn().mockResolvedValue({ logicalLedgerId: 'game' })
    const adoptExistingPhysicalShard = vi.fn()
    const onLedgerBindingAdopted = vi.fn().mockResolvedValue(undefined)
    registerFavoriteRepositoryIpc({
      ipcMain,
      service: { getLibrarySummary: vi.fn() } as never,
      bindingService: { adoptExistingPhysicalShard, renameBoundPhysicalShard },
      onLedgerBindingAdopted,
      isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('favorite-repository:rename-bound-ledger-shard', 7, '100', {
      logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区哈哈', remoteFolderId: '4106106611', shardNumber: 1,
      currentRemoteTitle: 'bilimi·游戏专区', targetTitle: 'bilimi·游戏专区哈哈'
    })).resolves.toEqual({ logicalLedgerId: 'game' })

    expect(renameBoundPhysicalShard).toHaveBeenCalledWith('100', {
      logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区哈哈', remoteFolderId: '4106106611', shardNumber: 1,
      currentRemoteTitle: 'bilimi·游戏专区', targetTitle: 'bilimi·游戏专区哈哈'
    })
    expect(adoptExistingPhysicalShard).not.toHaveBeenCalled()
    expect(onLedgerBindingAdopted).toHaveBeenCalledWith('100', 'game')
  })

  it('rejects an invalid or failed bound-shard rename before preference projection', async () => {
    const ipcMain = new FakeIpcMain()
    const renameBoundPhysicalShard = vi.fn().mockRejectedValue(new Error('bound shard is absent'))
    const onLedgerBindingAdopted = vi.fn()
    registerFavoriteRepositoryIpc({
      ipcMain,
      service: { getLibrarySummary: vi.fn() } as never,
      bindingService: { adoptExistingPhysicalShard: vi.fn(), renameBoundPhysicalShard },
      onLedgerBindingAdopted,
      isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('favorite-repository:rename-bound-ledger-shard', 7, '100', {
      logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区', remoteFolderId: '', shardNumber: 1
    })).rejects.toThrow('input is invalid')
    expect(renameBoundPhysicalShard).not.toHaveBeenCalled()

    await expect(ipcMain.invoke('favorite-repository:rename-bound-ledger-shard', 7, '100', {
      logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区', remoteFolderId: '4106106611', shardNumber: 1
    })).rejects.toThrow('bound shard is absent')
    expect(onLedgerBindingAdopted).not.toHaveBeenCalled()
  })

  it('notifies preference persistence only after formal ledger adoption succeeds', async () => {
    const ipcMain = new FakeIpcMain()
    const adoptExistingPhysicalShard = vi.fn().mockResolvedValue({ logicalLedgerId: 'music' })
    const onLedgerBindingAdopted = vi.fn().mockResolvedValue(undefined)
    registerFavoriteRepositoryIpc({
      ipcMain,
      service: { getLibrarySummary: vi.fn() } as never,
      bindingService: { adoptExistingPhysicalShard },
      onLedgerBindingAdopted,
      isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await ipcMain.invoke('favorite-repository:adopt-ledger-binding', 7, '100', {
      logicalLedgerId: 'music', logicalTitle: 'bilimi路闊充箰', remoteFolderId: '41', remoteTitle: 'bilimi路闊充箰'
    })

    expect(onLedgerBindingAdopted).toHaveBeenCalledWith('100', 'music')
    adoptExistingPhysicalShard.mockRejectedValueOnce(new Error('remote shard is absent'))
    await expect(ipcMain.invoke('favorite-repository:adopt-ledger-binding', 7, '100', {
      logicalLedgerId: 'music', logicalTitle: 'bilimi路闊充箰', remoteFolderId: '41', remoteTitle: 'bilimi路闊充箰'
    })).rejects.toThrow('remote shard is absent')
    expect(onLedgerBindingAdopted).toHaveBeenCalledTimes(1)
  })

  it('returns a committed exact-id adoption when the later projection notification fails', async () => {
    const ipcMain = new FakeIpcMain()
    const adoption = { logicalLedgerId: 'music' }
    const adoptExistingPhysicalShard = vi.fn().mockResolvedValue(adoption)
    const onLedgerBindingAdopted = vi.fn().mockRejectedValueOnce(new Error('projection refresh unavailable'))
    registerFavoriteRepositoryIpc({
      ipcMain,
      service: { getLibrarySummary: vi.fn() } as never,
      bindingService: { adoptExistingPhysicalShard },
      onLedgerBindingAdopted,
      isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('favorite-repository:adopt-ledger-binding', 7, '100', {
      logicalLedgerId: 'music', logicalTitle: 'bilimi·音乐', remoteFolderId: '41', remoteTitle: 'bilimi·音乐'
    })).resolves.toEqual(adoption)

    expect(adoptExistingPhysicalShard).toHaveBeenCalledOnce()
    expect(onLedgerBindingAdopted).toHaveBeenCalledWith('100', 'music')
  })

  it('returns the same complete library summary contract from snapshot and account-open reads', async () => {
    const ipcMain = new FakeIpcMain()
    const summary = {
      version: 1, accountMid: '100', revision: 3, updatedAt: '2026-07-25T00:00:00.000Z',
      videoCount: 2, folderCount: 1, folders: [], folderCounts: { 'bilimi-logical:music': 2 },
      scopeCounts: { all: 2, pending: 1, protected: 2, unsynced: 1 }, folderConflicts: [],
      physicalShardCount: 0, syncRecordCount: 1,
      syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 1 }, pendingAidCount: 1,
      remoteReconciliations: [{ kind: 'unfavorite', operationId: 'remote-1' }]
    }
    const getLibrarySummary = vi.fn().mockResolvedValue(summary)
    const getSnapshot = vi.fn()
    registerFavoriteRepositoryIpc({
      ipcMain, service: { getLibrarySummary, getSnapshot } as never,
      isTrustedSender: () => true, getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('favorite-repository:open-account', 7, '100')).resolves.toEqual(summary)
    await expect(ipcMain.invoke('favorite-repository:get-snapshot', 7, '100')).resolves.toEqual(summary)
    expect(getLibrarySummary).toHaveBeenCalledTimes(2)
    expect(getSnapshot).not.toHaveBeenCalled()
  })

  it('repairs confirmed legacy review half-records before returning an account-open summary', async () => {
    const ipcMain = new FakeIpcMain()
    const repairLegacyConfirmedReviewFavorites = vi.fn().mockResolvedValue(1)
    const getLibrarySummary = vi.fn().mockResolvedValue({ accountMid: '100', revision: 2 })
    registerFavoriteRepositoryIpc({
      ipcMain,
      service: { repairLegacyConfirmedReviewFavorites, getLibrarySummary } as never,
      isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('favorite-repository:open-account', 7, '100')).resolves.toEqual({ accountMid: '100', revision: 2 })
    expect(repairLegacyConfirmedReviewFavorites).toHaveBeenCalledWith('100')
    expect(repairLegacyConfirmedReviewFavorites).toHaveBeenCalledBefore(getLibrarySummary)
  })

  it('recovers durable confirmed review checkpoints before legacy repair and the account-open summary', async () => {
    const ipcMain = new FakeIpcMain()
    const recoverConfirmedReviewFavorites = vi.fn().mockResolvedValue(1)
    const repairLegacyConfirmedReviewFavorites = vi.fn().mockResolvedValue(0)
    const getLibrarySummary = vi.fn().mockResolvedValue({ accountMid: '100', revision: 3 })
    registerFavoriteRepositoryIpc({
      ipcMain,
      service: { recoverConfirmedReviewFavorites, repairLegacyConfirmedReviewFavorites, getLibrarySummary } as never,
      isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('favorite-repository:open-account', 7, '100')).resolves.toEqual({ accountMid: '100', revision: 3 })
    expect(recoverConfirmedReviewFavorites).toHaveBeenCalledWith('100')
    expect(recoverConfirmedReviewFavorites).toHaveBeenCalledBefore(repairLegacyConfirmedReviewFavorites)
    expect(repairLegacyConfirmedReviewFavorites).toHaveBeenCalledBefore(getLibrarySummary)
  })

  it('routes confirmed review registration through the dedicated main-process channel', async () => {
    const ipcMain = new FakeIpcMain()
    const result = { accountMid: '100', revision: 4, commandId: 'review:local', affectedFolderIds: [], affectedAids: [101] }
    const commitConfirmedReviewFavorite = vi.fn().mockResolvedValue(result)
    registerFavoriteRepositoryIpc({
      ipcMain,
      service: { getLibrarySummary: vi.fn(), commitConfirmedReviewFavorite } as never,
      isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    const input = {
      operationId: 'review-favorite:100:101:operation-1', occurredAt: '2026-08-20T01:00:00.000Z', aid: 101,
      video: { aid: 101, title: '游戏攻略', tags: [], updatedAt: '2026-08-20T01:00:00.000Z' },
      targets: [{ logicalFolderId: 'bilimi-logical:game', remoteFolderId: '9001', title: 'bilimi·游戏专区' }],
      classificationSource: 'system-high',
      event: { kind: 'entered', titleAtTime: '游戏攻略', folderTitlesAtTime: ['bilimi·游戏专区'], detail: 'test' }
    }
    await expect(ipcMain.invoke('favorite-repository:commit-confirmed-review', 7, '100', input)).resolves.toEqual(result)
    expect(commitConfirmedReviewFavorite).toHaveBeenCalledWith('100', input)
  })

  it('routes Bilibili-confirmed review checkpoints through the trusted main-process channel', async () => {
    const ipcMain = new FakeIpcMain()
    const checkpointConfirmedReviewFavorite = vi.fn().mockResolvedValue(undefined)
    registerFavoriteRepositoryIpc({
      ipcMain,
      service: { getLibrarySummary: vi.fn(), checkpointConfirmedReviewFavorite } as never,
      isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })
    const input = {
      operationId: 'review-favorite:100:101:checkpoint-1', occurredAt: '2026-08-20T01:00:00.000Z', aid: 101,
      video: { aid: 101, title: '游戏攻略', tags: [], updatedAt: '2026-08-20T01:00:00.000Z' },
      targets: [{ logicalFolderId: 'bilimi-logical:game', remoteFolderId: '9001', title: 'bilimi·游戏专区' }],
      classificationSource: 'system-high',
      event: { kind: 'entered', titleAtTime: '游戏攻略', folderTitlesAtTime: ['bilimi·游戏专区'], detail: 'test' }
    }
    await expect(ipcMain.invoke('favorite-repository:checkpoint-confirmed-review', 7, '100', input)).resolves.toBeUndefined()
    expect(checkpointConfirmedReviewFavorite).toHaveBeenCalledWith('100', input)
  })

  it('keeps protected organization commands rejected on the generic renderer channel', async () => {
    const ipcMain = new FakeIpcMain()
    const commit = vi.fn()
    registerFavoriteRepositoryIpc({
      ipcMain, service: { getLibrarySummary: vi.fn(), commit } as never,
      isTrustedSender: () => true, getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })
    await expect(ipcMain.invoke('favorite-repository:commit-command', 7, '100', {
      id: 'protected', accountMid: '100', issuedAt: '2026-08-20T01:00:00.000Z', type: 'record-organization-protections',
      payload: { records: [] }
    })).rejects.toThrow('reserved for the main process')
    expect(commit).not.toHaveBeenCalled()
  })

  it('passes persisted local draft ledger identities into summary projection', async () => {
    const ipcMain = new FakeIpcMain()
    const getLibrarySummary = vi.fn().mockResolvedValue({ accountMid: '100', revision: 1 })
    const getLocalDraftLedgerIds = vi.fn().mockReturnValue(['custom-author-honker233'])
    registerFavoriteRepositoryIpc({
      ipcMain,
      service: { getLibrarySummary } as never,
      isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100'),
      getLocalDraftLedgerIds
    })

    await ipcMain.invoke('favorite-repository:open-account', 7, '100')
    await ipcMain.invoke('favorite-repository:get-snapshot', 7, '100')

    expect(getLocalDraftLedgerIds).toHaveBeenNthCalledWith(1, '100')
    expect(getLibrarySummary).toHaveBeenNthCalledWith(1, '100', { localDraftLedgerIds: ['custom-author-honker233'] })
    expect(getLibrarySummary).toHaveBeenNthCalledWith(2, '100', { localDraftLedgerIds: ['custom-author-honker233'] })
  })

  it('returns the local summary before deferred account-open recovery completes', async () => {
    const ipcMain = new FakeIpcMain()
    const recovery = deferred<void>()
    const onAccountOpen = vi.fn().mockReturnValue(recovery.promise)
    const getLibrarySummary = vi.fn().mockResolvedValue({ accountMid: '100', revision: 1 })
    registerFavoriteRepositoryIpc({
      ipcMain,
      service: { getLibrarySummary } as never,
      isTrustedSender: (senderId) => senderId === 7,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100'),
      onAccountOpen
    })

    const opened = ipcMain.invoke('favorite-repository:open-account', 7, '100')
    await Promise.resolve()
    await Promise.resolve()
    expect(onAccountOpen).toHaveBeenCalledWith('100')
    expect(getLibrarySummary).toHaveBeenCalledWith('100')
    recovery.resolve()
    await expect(opened).resolves.toEqual({ accountMid: '100', revision: 1 })
  })

  it('waits for local binding projection before the first summary while remote recovery stays deferred', async () => {
    const ipcMain = new FakeIpcMain()
    const recovery = deferred<void>()
    const onAccountOpenLocal = vi.fn().mockResolvedValue(undefined)
    const onAccountOpen = vi.fn().mockReturnValue(recovery.promise)
    const getLibrarySummary = vi.fn().mockResolvedValue({ accountMid: '100', revision: 7 })
    registerFavoriteRepositoryIpc({
      ipcMain, service: { getLibrarySummary } as never,
      isTrustedSender: (senderId) => senderId === 7,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100'),
      onAccountOpenLocal,
      onAccountOpen
    })

    const opened = ipcMain.invoke('favorite-repository:open-account', 7, '100')
    await expect(opened).resolves.toEqual({ accountMid: '100', revision: 7 })
    expect(onAccountOpenLocal).toHaveBeenCalledWith('100')
    expect(onAccountOpenLocal).toHaveBeenCalledBefore(getLibrarySummary)
    expect(onAccountOpen).toHaveBeenCalledWith('100')
    recovery.resolve()
  })

  it('coalesces repeated account opens into one in-flight recovery', async () => {
    const ipcMain = new FakeIpcMain()
    const recovery = deferred<void>()
    const onAccountOpen = vi.fn().mockReturnValue(recovery.promise)
    const getLibrarySummary = vi.fn().mockResolvedValue({ accountMid: '100', revision: 1 })
    registerFavoriteRepositoryIpc({
      ipcMain, service: { getLibrarySummary } as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100'), onAccountOpen
    })

    await Promise.all([
      ipcMain.invoke('favorite-repository:open-account', 7, '100'),
      ipcMain.invoke('favorite-repository:open-account', 7, '100')
    ])

    expect(onAccountOpen).toHaveBeenCalledOnce()
    recovery.resolve()
  })

  it('keeps the local library readable when optional account-open reconciliation is unavailable', async () => {
    const ipcMain = new FakeIpcMain()
    const getLibrarySummary = vi.fn().mockResolvedValue({ accountMid: '100', revision: 1 })
    registerFavoriteRepositoryIpc({
      ipcMain,
      service: { getLibrarySummary } as never,
      isTrustedSender: (senderId) => senderId === 7,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100'),
      onAccountOpen: vi.fn().mockRejectedValue(new Error('runtime unavailable'))
    })

    await expect(ipcMain.invoke('favorite-repository:open-account', 7, '100')).resolves.toEqual({ accountMid: '100', revision: 1 })
    expect(getLibrarySummary).toHaveBeenCalledWith('100')
  })

  it('does not register an ordinary-folder dismissal IPC that could create a permanent local ignore', async () => {
    const ipcMain = new FakeIpcMain()
    const service = { getSnapshot: vi.fn().mockResolvedValue({
      folders: [{ id: 'bilibili:41', title: 'bilimi·音乐', kind: 'bilibili', remoteFolderId: '41', syncState: 'bound' }],
      physicalShards: [{ logicalLedgerId: 'music', folderId: 'bilimi:music:001', shardNumber: 1, remoteFolderId: '41', remoteTitle: 'bilimi·音乐', bindingState: 'bound' }]
    }) }
    registerFavoriteRepositoryIpc({
      ipcMain, service: service as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    expect(ipcMain.handlers.has('favorite-repository:dismiss-ordinary-folder')).toBe(false)
  })

  it('returns only an explicit remote-draft reminder dismissal to the status reader', async () => {
    const ipcMain = new FakeIpcMain()
    const getRemoteDraftReminderDismissed = vi.fn().mockReturnValue(['explicit-dismissal'])
    registerFavoriteRepositoryIpc({
      ipcMain,
      service: {} as never,
      isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100'),
      getRemoteDraftReminderDismissed
    })

    await expect(ipcMain.invoke('favorite-repository:get-remote-draft-reminder-dismissals', 7, '100'))
      .resolves.toEqual(['explicit-dismissal'])
    expect(getRemoteDraftReminderDismissed).toHaveBeenCalledWith('100')
  })

  it('only accepts logical placement targets and forwards a revision-guarded local move to the command service', async () => {
    const ipcMain = new FakeIpcMain()
    const setLocalPlacements = vi.fn().mockResolvedValue({ status: 'succeeded', affectedAids: [1] })
    registerFavoriteRepositoryIpc({
      ipcMain, service: {} as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100'),
      commandService: { setLocalPlacements } as never
    })

    await expect(ipcMain.invoke('favorite-library:set-local-placements', 7, '100', [
      { aid: 1, folderIds: ['bilimi-logical:music'] }
    ], 4, false)).resolves.toMatchObject({ status: 'succeeded' })
    expect(setLocalPlacements).toHaveBeenCalledWith('100', [
      { aid: 1, folderIds: ['bilimi-logical:music'] }
    ], 4, false)
    await expect(ipcMain.invoke('favorite-library:set-local-placements', 7, '100', [
      { aid: 1, folderIds: ['bilimi:music:001'] }
    ], 4, false)).rejects.toThrow('logical folder')
  })

  it('forwards permanent recycle clearing to the dedicated local lifecycle command', async () => {
    const ipcMain = new FakeIpcMain()
    const clearRecycledFavorite = vi.fn().mockResolvedValue({ status: 'succeeded', affectedAids: [9] })
    registerFavoriteRepositoryIpc({
      ipcMain, service: {} as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100'),
      commandService: { clearRecycledFavorite } as never
    })

    await expect(ipcMain.invoke('favorite-library:clear-recycled', 7, '100', 9, 4))
      .resolves.toMatchObject({ status: 'succeeded', affectedAids: [9] })
    expect(clearRecycledFavorite).toHaveBeenCalledWith('100', 9, 4)
  })

  it('retires global Bilibili unfavorite IPC channels without calling the global cancellation command', async () => {
    const ipcMain = new FakeIpcMain()
    const cancelBilibiliFavorites = vi.fn()
    registerFavoriteRepositoryIpc({
      ipcMain, service: {} as never, isTrustedSender: (id) => id === 7,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100'),
      commandService: { cancelBilibiliFavorites } as never
    })

    for (const channel of [
      'favorite-library:unfavorite-preview',
      'favorite-library:unfavorite-confirm',
      'favorite-library:execute-unfavorite'
    ]) {
      expect(() => ipcMain.invoke(channel, 7, '100', [2], 'execution-token', 'confirmation-token'))
        .toThrow('The global Bilibili unfavorite operation is retired; remove a bound Bilimi work-folder placement instead.')
    }
    expect(cancelBilibiliFavorites).not.toHaveBeenCalled()
  })

  it('binds an archive restore preview to a trusted current account with an opaque execution token', async () => {
    const ipcMain = new FakeIpcMain()
    const previewImport = vi.fn().mockReturnValue({ canApply: true })
    const createRestorePlanFromManagedScan = vi.fn().mockResolvedValue({ mode: 'safe', accountMid: '100', operations: [] })
    const canonicalAids = Array.from({ length: 201 }, (_, index) => index + 1)
    const resolveArchiveRestoreLogicalFolderAids = vi.fn().mockResolvedValue(canonicalAids)
    const writer = { readBaseline: vi.fn(), write: vi.fn() }
    registerFavoriteRepositoryIpc({
      ipcMain, service: { resolveArchiveRestoreLogicalFolderAids } as never, isTrustedSender: (id) => id === 7,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100'),
      archiveService: { previewImport, createRestorePlanFromManagedScan } as never,
      archiveRestoreWriter: writer as never
    })

    await expect(ipcMain.invoke('favorite-repository:archive-preview-import', 7, '100', '{}')).resolves.toEqual({ canApply: true })
    expect(previewImport).toHaveBeenCalledWith('{}', '100')
    const preview = await ipcMain.invoke('favorite-repository:archive-restore-plan', 7, '100', '{}', 'safe', { kind: 'all' }) as {
      mode: string
      accountMid: string
      executionToken: string
      confirmationRequired: boolean
    }
    expect(preview).toMatchObject({ mode: 'safe', accountMid: '100', confirmationRequired: false })
    expect(preview.executionToken).toEqual(expect.any(String))
    expect(createRestorePlanFromManagedScan).toHaveBeenCalledWith('{}', 'safe', writer)
    await ipcMain.invoke('favorite-repository:archive-restore-plan', 7, '100', '{}', 'safe', { kind: 'aids', aids: [4] })
    expect(createRestorePlanFromManagedScan).toHaveBeenLastCalledWith('{}', 'safe', writer, [4])
    await ipcMain.invoke('favorite-repository:archive-restore-plan', 7, '100', '{}', 'safe', { kind: 'logical-folder', folderId: 'bilimi-logical:music' })
    expect(resolveArchiveRestoreLogicalFolderAids).toHaveBeenCalledWith('100', 'bilimi-logical:music')
    expect(createRestorePlanFromManagedScan).toHaveBeenLastCalledWith('{}', 'safe', writer, canonicalAids)
    await expect(ipcMain.invoke('favorite-repository:archive-restore-plan', 7, '100', '{}', 'safe', { kind: 'logical-folder', folderId: 'local:inbox' }))
      .rejects.toThrow('restore scope')
    await expect(ipcMain.invoke('favorite-repository:archive-restore-plan', 7, '100', '{}', 'safe', { kind: 'aids', aids: [4, 4] }))
      .rejects.toThrow('restore scope')
    await expect(ipcMain.invoke('favorite-repository:archive-preview-import', 8, '100', '{}')).rejects.toThrow('untrusted renderer')
  })

  it('executes and reconciles only a preview-token-bound safe restore plan through the main-process writer', async () => {
    const ipcMain = new FakeIpcMain()
    const plan = { mode: 'safe', accountMid: '100', operations: [] }
    const createRestorePlanFromManagedScan = vi.fn().mockResolvedValue(plan)
    const executeRestorePlan = vi.fn().mockResolvedValue({ status: 'succeeded', completedOperationCount: 0 })
    const reconcileRestorePlan = vi.fn().mockResolvedValue({ status: 'succeeded', completedOperationCount: 0 })
    const writer = { readBaseline: vi.fn(), write: vi.fn() }
    registerFavoriteRepositoryIpc({
      ipcMain, service: {} as never, isTrustedSender: (id) => id === 7,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100'),
      archiveService: { createRestorePlanFromManagedScan, executeRestorePlan, reconcileRestorePlan } as never,
      archiveRestoreWriter: writer as never
    })

    const preview = await ipcMain.invoke('favorite-repository:archive-restore-plan', 7, '100', '{}', 'safe', { kind: 'all' }) as { executionToken: string }

    await expect(ipcMain.invoke('favorite-repository:archive-execute-restore', 7, '100', plan, preview.executionToken))
      .resolves.toMatchObject({ status: 'succeeded' })
    await expect(ipcMain.invoke('favorite-repository:archive-reconcile-restore', 7, '100', plan, preview.executionToken))
      .resolves.toMatchObject({ status: 'succeeded' })
    expect(executeRestorePlan).toHaveBeenCalledWith(plan, writer)
    expect(reconcileRestorePlan).toHaveBeenCalledWith(plan, writer)
    await expect(ipcMain.invoke('favorite-repository:archive-execute-restore', 8, '100', plan, preview.executionToken)).rejects.toThrow('untrusted renderer')
    await expect(ipcMain.invoke('favorite-repository:archive-execute-restore', 7, '101', plan, preview.executionToken)).rejects.toThrow('current Bilibili account')
  })

  it('requires a second full-restore confirmation token and rejects missing, expired, or mismatched preview tokens', async () => {
    const ipcMain = new FakeIpcMain()
    let currentTime = 1_000
    const fullPlan = {
      mode: 'full' as const,
      accountMid: '100',
      operations: [{ aid: 1, desiredLogicalFolderIds: ['bilimi-logical:music'], appendLogicalFolderIds: [], removeLogicalFolderIds: ['bilimi-logical:old'] }]
    }
    const safePlan = { mode: 'safe' as const, accountMid: '100', operations: [] }
    const createRestorePlanFromManagedScan = vi.fn((_input: unknown, mode: 'safe' | 'full') => Promise.resolve(mode === 'full' ? fullPlan : safePlan))
    const executeRestorePlan = vi.fn().mockResolvedValue({ status: 'succeeded', completedOperationCount: 1 })
    const writer = { readBaseline: vi.fn(), write: vi.fn() }
    registerFavoriteRepositoryIpc({
      ipcMain, service: {} as never, isTrustedSender: (id) => id === 7,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100'),
      archiveService: { createRestorePlanFromManagedScan, executeRestorePlan } as never,
      archiveRestoreWriter: writer as never,
      now: () => currentTime,
      archiveRestoreTokenTtlMs: 10
    })

    const safePreview = await ipcMain.invoke('favorite-repository:archive-restore-plan', 7, '100', '{}', 'safe', { kind: 'all' }) as { executionToken: string }
    const fullPreview = await ipcMain.invoke('favorite-repository:archive-restore-plan', 7, '100', '{}', 'full', { kind: 'all' }) as { executionToken: string }

    await expect(ipcMain.invoke('favorite-repository:archive-execute-restore', 7, '100', fullPlan, fullPreview.executionToken))
      .rejects.toThrow('second confirmation')
    await expect(ipcMain.invoke('favorite-repository:archive-confirm-full-restore', 7, '100', fullPlan, safePreview.executionToken))
      .rejects.toThrow('does not match')
    await expect(ipcMain.invoke('favorite-repository:archive-execute-restore', 7, '100', fullPlan, safePreview.executionToken, 'not-a-confirmation'))
      .rejects.toThrow('does not match')

    const confirmation = await ipcMain.invoke('favorite-repository:archive-confirm-full-restore', 7, '100', fullPlan, fullPreview.executionToken) as { confirmationToken: string }
    await expect(ipcMain.invoke('favorite-repository:archive-execute-restore', 7, '100', fullPlan, fullPreview.executionToken, confirmation.confirmationToken))
      .resolves.toMatchObject({ status: 'succeeded' })

    const expiredPreview = await ipcMain.invoke('favorite-repository:archive-restore-plan', 7, '100', '{}', 'safe', { kind: 'all' }) as { executionToken: string }
    currentTime += 11
    await expect(ipcMain.invoke('favorite-repository:archive-reconcile-restore', 7, '100', safePlan, expiredPreview.executionToken))
      .rejects.toThrow('expired')

    const validPreview = await ipcMain.invoke('favorite-repository:archive-restore-plan', 7, '100', '{}', 'safe', { kind: 'all' }) as { executionToken: string }
    await expect(ipcMain.invoke('favorite-repository:archive-execute-restore', 7, '100', {
      ...safePlan,
      operations: [{ aid: 2, desiredLogicalFolderIds: [], appendLogicalFolderIds: [], removeLogicalFolderIds: [] }]
    }, validPreview.executionToken)).rejects.toThrow('does not match')
  })
  it('rejects every read and subscription for an account other than the current Bilibili account', async () => {
    const ipcMain = new FakeIpcMain()
    const service = {
      getSnapshot: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, videos: {} }),
      getFolderPage: vi.fn()
    }
    registerFavoriteRepositoryIpc({
      ipcMain,
      service: service as never,
      isTrustedSender: (senderId) => senderId === 7,
      getCurrentAccountMid: vi.fn().mockResolvedValue('101')
    })

    await expect(ipcMain.invoke('favorite-repository:open-account', 7, '100')).rejects.toThrow('current Bilibili account')
    await expect(ipcMain.invoke('favorite-repository:get-snapshot', 7, '100')).rejects.toThrow('current Bilibili account')
    await expect(ipcMain.invoke('favorite-repository:get-folder-page', 7, '100', 'folder-a', { limit: 1 })).rejects.toThrow('current Bilibili account')
    await expect(ipcMain.invoke('favorite-repository:search-page', 7, '100', 'video', { limit: 1 })).rejects.toThrow('current Bilibili account')
    await expect(ipcMain.invoke('favorite-repository:subscribe', 7, '100', 'folder-a')).rejects.toThrow('current Bilibili account')
    // Unsubscribe is deliberately allowed after an account switch so stale tokens can be removed.
    await expect(ipcMain.invoke('favorite-repository:unsubscribe', 7, '100', 'subscription-a')).resolves.toBe(false)
    expect(service.getSnapshot).not.toHaveBeenCalled()
    await expect(ipcMain.invoke('favorite-repository:open-account', 7, '')).rejects.toThrow('account is invalid')
    await expect(ipcMain.invoke('favorite-repository:open-account', 9, '100')).rejects.toThrow('untrusted renderer')
  })

  it('rejects a command when its account is not the current Bilibili account', async () => {
    const ipcMain = new FakeIpcMain()
    const service = { commit: vi.fn() }
    registerFavoriteRepositoryIpc({
      ipcMain,
      service: service as never,
      isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('101')
    })
    const command = {
      id: 'command-1', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-video' as const,
      payload: { aid: 1, title: 'video', tags: [], updatedAt: '2026-07-19T00:00:00.000Z' }
    }

    await expect(ipcMain.invoke('favorite-repository:commit-command', 7, '100', command))
      .rejects.toThrow('current Bilibili account')
    expect(service.commit).not.toHaveBeenCalled()
  })

  it('does not let the renderer submit a frozen workspace plan through the generic command channel', async () => {
    const ipcMain = new FakeIpcMain()
    const service = { commit: vi.fn() }
    registerFavoriteRepositoryIpc({
      ipcMain, service: service as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('favorite-repository:commit-command', 7, '100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace',
      payload: {
        id: 'workspace-1', accountMid: '100', status: 'frozen', baselineRevision: 1, continuationAids: [],
        frozenSyncPlan: { id: 'run-1', accountMid: '100', workspaceId: 'workspace-1', baselineRevision: 1, createdAt: '2026-07-19T00:00:00.000Z', operations: [] }
      }
    })).rejects.toThrow('reserved for the main process')
    expect(service.commit).not.toHaveBeenCalled()
  })

  it('does not let the renderer forge incremental organization protections', async () => {
    const ipcMain = new FakeIpcMain()
    const service = { commit: vi.fn() }
    registerFavoriteRepositoryIpc({
      ipcMain, service: service as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('favorite-repository:commit-command', 7, '100', {
      id: 'protections', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'record-organization-protections',
      payload: { records: [{ accountMid: '100', aid: 1, targetFolderIds: ['remote-1'], completedAt: '2026-07-20T00:00:00.000Z' }] }
    })).rejects.toThrow('reserved for the main process')
    expect(service.commit).not.toHaveBeenCalled()
  })

  it('does not let the renderer forge a local workspace save plan', async () => {
    const ipcMain = new FakeIpcMain()
    const service = { commit: vi.fn() }
    registerFavoriteRepositoryIpc({
      ipcMain, service: service as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('favorite-repository:commit-command', 7, '100', {
      id: 'local-plan', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'commit-local-plan',
      payload: { workspaceId: 'workspace-1', memberAidsByFolderId: { 'local:music': [1] } }
    })).rejects.toThrow('reserved for the main process')
    expect(service.commit).not.toHaveBeenCalled()
  })

  it('does not let the renderer forge a Bilibili source mirror', async () => {
    const ipcMain = new FakeIpcMain()
    const service = { commit: vi.fn() }
    registerFavoriteRepositoryIpc({
      ipcMain, service: service as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('favorite-repository:commit-command', 7, '100', {
      id: 'mirror', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'record-bilibili-mirror',
      payload: { workspaceId: 'workspace-1', memberAidsByFolderId: {}, folders: [], videos: [] }
    })).rejects.toThrow('reserved for the main process')
    expect(service.commit).not.toHaveBeenCalled()
  })

  it('does not let the renderer clear the Bilibili mirror outside a full organization command', async () => {
    const ipcMain = new FakeIpcMain()
    const service = { commit: vi.fn() }
    registerFavoriteRepositoryIpc({
      ipcMain, service: service as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('favorite-repository:commit-command', 7, '100', {
      id: 'clear-mirror', accountMid: '100', issuedAt: '2026-07-21T00:00:00.000Z', type: 'clear-bilibili-mirror', payload: {}
    })).rejects.toThrow('reserved for the main process')
    expect(service.commit).not.toHaveBeenCalled()
  })

  it('does not let the renderer abandon a frozen workspace plan', async () => {
    const ipcMain = new FakeIpcMain()
    const service = { commit: vi.fn() }
    registerFavoriteRepositoryIpc({
      ipcMain, service: service as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('favorite-repository:commit-command', 7, '100', {
      id: 'abandon', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'abandon-frozen-workspace',
      payload: { workspaceId: 'workspace-1', frozenPlanId: 'run-1' }
    })).rejects.toThrow('reserved for the main process')
    expect(service.commit).not.toHaveBeenCalled()
  })

  it('returns a compact account and workspace summary rather than repository videos or memberships', async () => {
    const ipcMain = new FakeIpcMain()
    const summary = {
      version: 1, accountMid: '100', revision: 2, updatedAt: '2026-07-19T00:00:00.000Z',
      videoCount: 30_000, folderCount: 1,
      folders: [{ id: 'folder-a', title: 'A', kind: 'local', syncState: 'local-only' }],
      folderCounts: { 'folder-a': 30_000 }, scopeCounts: { all: 30_000, pending: 2, protected: 0, unsynced: 0 },
      physicalShardCount: 0, syncRecordCount: 0,
      syncCounts: { pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0 }, pendingAidCount: 2,
      remoteReconciliations: [],
      workspace: { id: 'workspace-1', status: 'previewing', baselineRevision: 1, continuationCount: 2 }
    }
    const service = {
      getLibrarySummary: vi.fn().mockResolvedValue(summary)
    }
    registerFavoriteRepositoryIpc({
      ipcMain, service: service as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    const result = await ipcMain.invoke('favorite-repository:get-snapshot', 7, '100')

    expect(result).toEqual(expect.objectContaining({
      version: 1, accountMid: '100', revision: 2, videoCount: 30_000, folderCount: 1,
      workspace: { id: 'workspace-1', status: 'previewing', baselineRevision: 1, continuationCount: 2 }
    }))
    expect(result).not.toHaveProperty('videos')
    expect(result).not.toHaveProperty('memberships')
  })

  it('publishes bounded revision invalidations only to exact live subscriptions', async () => {
    const ipcMain = new FakeIpcMain()
    const send = vi.fn()
    const service = {
      commit: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 2, commandId: 'command-1',
        affectedFolderIds: ['folder-a'], affectedAids: [1, 2]
      })
    }
    registerFavoriteRepositoryIpc({
      ipcMain,
      service: service as never,
      isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100'),
      send
    })
    const activeSubscription = await ipcMain.invoke('favorite-repository:subscribe', 7, '100', 'folder-a') as string
    await ipcMain.invoke('favorite-repository:subscribe', 8, '100', 'folder-b')

    await ipcMain.invoke('favorite-repository:commit-command', 7, '100', {
      id: 'command-1', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'video', tags: [], updatedAt: '2026-07-19T00:00:00.000Z' }
    })

    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledWith(7, 'favorite-repository:revision-changed', {
      subscriptionId: activeSubscription, accountMid: '100', revision: 2,
      affectedFolderIds: ['folder-a'], affectedFolderCount: 1, affectedFolderIdsTruncated: false,
      affectedAidCount: 2, pageInvalidated: true
    })
    expect(send.mock.calls.flat().join(',')).not.toContain('1,2')
  })

  it('invalidates a folder page when affected aids can change shared row data', async () => {
    const ipcMain = new FakeIpcMain()
    const send = vi.fn()
    let changed: ((result: { accountMid: string; revision: number; affectedFolderIds: string[]; affectedAids: number[] }) => void) | undefined
    const service = { onChanged: vi.fn((listener) => { changed = listener }), commit: vi.fn() }
    registerFavoriteRepositoryIpc({
      ipcMain, service: service as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100'), send
    })
    await ipcMain.invoke('favorite-repository:subscribe', 7, '100', 'folder-b')

    changed?.({ accountMid: '100', revision: 2, affectedFolderIds: ['folder-a'], affectedAids: [1] })

    expect(send).toHaveBeenCalledWith(7, 'favorite-repository:revision-changed', expect.objectContaining({
      revision: 2, pageInvalidated: true
    }))
  })

  it('keeps an unrelated folder page valid for an aid-free structural change', async () => {
    const ipcMain = new FakeIpcMain()
    const send = vi.fn()
    let changed: ((result: { accountMid: string; revision: number; affectedFolderIds: string[]; affectedAids: number[] }) => void) | undefined
    const service = { onChanged: vi.fn((listener) => { changed = listener }), commit: vi.fn() }
    registerFavoriteRepositoryIpc({
      ipcMain, service: service as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100'), send
    })
    await ipcMain.invoke('favorite-repository:subscribe', 7, '100', 'folder-b')

    changed?.({ accountMid: '100', revision: 2, affectedFolderIds: ['folder-a'], affectedAids: [] })

    expect(send).toHaveBeenCalledWith(7, 'favorite-repository:revision-changed', expect.objectContaining({
      revision: 2, pageInvalidated: false
    }))
  })

  it('removes every subscription owned by a destroyed renderer', async () => {
    const ipcMain = new FakeIpcMain()
    const send = vi.fn()
    const service = { commit: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 2, commandId: 'command-1', affectedFolderIds: [], affectedAids: [] }) }
    const registration = registerFavoriteRepositoryIpc({
      ipcMain, service: service as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100'), send
    }) as unknown as { removeSender(senderId: number): void }
    await ipcMain.invoke('favorite-repository:subscribe', 7, '100', 'folder-a')
    registration.removeSender(7)

    await ipcMain.invoke('favorite-repository:commit-command', 7, '100', {
      id: 'command-1', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'video', tags: [], updatedAt: '2026-07-19T00:00:00.000Z' }
    })

    expect(send).not.toHaveBeenCalled()
  })

  it('allows cleanup of an existing subscription after the Bilibili account changes', async () => {
    const ipcMain = new FakeIpcMain()
    const getCurrentAccountMid = vi.fn()
      .mockResolvedValueOnce('100')
      .mockResolvedValueOnce('101')
    registerFavoriteRepositoryIpc({
      ipcMain, service: {} as never, isTrustedSender: () => true, getCurrentAccountMid
    })

    const subscriptionId = await ipcMain.invoke('favorite-repository:subscribe', 7, '100', 'folder-a') as string

    await expect(ipcMain.invoke('favorite-repository:unsubscribe', 7, '100', subscriptionId)).resolves.toBe(true)
  })

  it('returns paged deduplicated search rows without broadcasting repository contents', async () => {
    const ipcMain = new FakeIpcMain()
    const service = {
      getSnapshot: vi.fn().mockResolvedValue({
        version: 1,
        accountMid: '100',
        revision: 3,
        videos: {
          '1': { aid: 1, title: 'Alpha video', author: 'creator', tags: ['music'], updatedAt: '2026-07-19T00:00:00.000Z' },
          '2': { aid: 2, title: 'Beta video', tags: ['other'], updatedAt: '2026-07-19T00:00:00.000Z' }
        }
      })
    }
    registerFavoriteRepositoryIpc({
      ipcMain,
      service: service as never,
      isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('favorite-repository:search-page', 7, '100', 'music', { limit: 1 })).resolves.toEqual({
      version: 1,
      accountMid: '100',
      revision: 3,
      items: [{ aid: 1, title: 'Alpha video', author: 'creator', tags: ['music'], updatedAt: '2026-07-19T00:00:00.000Z' }],
      nextCursor: undefined
    })
  })

  it('returns one bounded library page with every membership and pending state for each aid', async () => {
    const ipcMain = new FakeIpcMain()
    const service = {
      getLibraryPage: vi.fn()
        .mockResolvedValueOnce({
          version: 1, accountMid: '100', revision: 4,
          items: [{
            video: { aid: 1, title: 'Alpha', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' },
            folderIds: ['local', 'remote'], pendingStates: ['failed']
          }],
          nextCursor: '1'
        })
        .mockResolvedValueOnce({
          version: 1, accountMid: '100', revision: 4,
          items: [
            { video: { aid: 1 }, folderIds: ['local', 'remote'], pendingStates: ['failed'] },
            { video: { aid: 2 }, folderIds: ['local'], pendingStates: ['unsynced', 'continuation'] }
          ]
        })
    }
    registerFavoriteRepositoryIpc({
      ipcMain, service: service as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('favorite-repository:get-library-page', 7, '100', { kind: 'all' }, { limit: 1 }))
      .resolves.toEqual({
        version: 1, accountMid: '100', revision: 4,
        items: [{
          video: { aid: 1, title: 'Alpha', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' },
          folderIds: ['local', 'remote'], pendingStates: ['failed']
        }],
        nextCursor: '1'
      })
    await expect(ipcMain.invoke('favorite-repository:get-library-page', 7, '100', { kind: 'pending' }, { limit: 10 }))
      .resolves.toMatchObject({
        items: [
          { video: { aid: 1 }, pendingStates: ['failed'] },
          { video: { aid: 2 }, pendingStates: ['unsynced', 'continuation'] }
        ]
      })
    await ipcMain.invoke('favorite-repository:get-library-page', 7, '100', { kind: 'recycle' }, { limit: 10 })
    expect(service.getLibraryPage).toHaveBeenLastCalledWith('100', { kind: 'recycle' }, { limit: 10 })
  })

  it('forwards validated current and original source filters to the main repository reader', async () => {
    const ipcMain = new FakeIpcMain()
    const getLibraryPage = vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 4, items: [] })
    registerFavoriteRepositoryIpc({
      ipcMain, service: { getLibraryPage } as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await ipcMain.invoke('favorite-repository:get-library-page', 7, '100', { kind: 'all' }, {
      limit: 50, page: 3, query: '  later page  ', filter: 'unsynced', sourceFilter: 'with-other', initialSourceFilter: 'initial-ordinary', sort: 'title-asc'
    })

    expect(getLibraryPage).toHaveBeenCalledWith('100', { kind: 'all' }, {
      limit: 50, page: 3, query: 'later page', filter: 'unsynced', sourceFilter: 'with-other', initialSourceFilter: 'initial-ordinary', sort: 'title-asc'
    })

    await ipcMain.invoke('favorite-repository:get-library-page', 7, '100', { kind: 'all' }, {
      limit: 50, stateFilters: { sync: 'synced' }
    })
    expect(getLibraryPage).toHaveBeenLastCalledWith('100', { kind: 'all' }, {
      limit: 50, stateFilters: { sync: 'synced' }
    })

    await ipcMain.invoke('favorite-repository:get-library-page', 7, '100', { kind: 'all' }, {
      limit: 50, stateFilters: { sync: 'unsynced' }
    })
    expect(getLibraryPage).toHaveBeenLastCalledWith('100', { kind: 'all' }, {
      limit: 50, stateFilters: { sync: 'unsynced' }
    })

    for (const sync of ['write-confirmed-awaiting-readback', 'write-confirmed-readback-conflict']) {
      await expect(ipcMain.invoke('favorite-repository:get-library-page', 7, '100', { kind: 'all' }, {
        limit: 50, stateFilters: { sync }
      })).rejects.toThrow('Favorite library page options are invalid.')
    }
  })

  it('normalizes a transcription filter selection before forwarding the global library query', async () => {
    const ipcMain = new FakeIpcMain()
    const getLibraryPage = vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 4, items: [] })
    registerFavoriteRepositoryIpc({
      ipcMain, service: { getLibraryPage } as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await ipcMain.invoke('favorite-repository:get-library-page', 7, '100', { kind: 'all' }, {
      limit: 50, transcriptionFilters: ['running', 'completed', 'running']
    })
    expect(getLibraryPage).toHaveBeenCalledWith('100', { kind: 'all' }, {
      limit: 50, transcriptionFilters: ['completed', 'running']
    })
    await expect(ipcMain.invoke('favorite-repository:get-library-page', 7, '100', { kind: 'all' }, {
      limit: 50, transcriptionFilters: ['unknown']
    })).rejects.toThrow('Favorite library page options are invalid.')
    await expect(ipcMain.invoke('favorite-repository:get-library-page', 7, '100', { kind: 'all' }, {
      limit: 50, sourceFilter: 'unknown'
    })).rejects.toThrow('Favorite library page options are invalid.')
    await expect(ipcMain.invoke('favorite-repository:get-library-page', 7, '100', { kind: 'all' }, {
      limit: 50, initialSourceFilter: 'unknown'
    })).rejects.toThrow('Favorite library page options are invalid.')
  })

  it('normalizes classification-source filters before forwarding the global library query', async () => {
    const ipcMain = new FakeIpcMain()
    const getLibraryPage = vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 4, items: [] })
    registerFavoriteRepositoryIpc({
      ipcMain, service: { getLibraryPage } as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await ipcMain.invoke('favorite-repository:get-library-page', 7, '100', { kind: 'all' }, {
      limit: 50, classificationSources: ['manual', 'deepseek', 'manual']
    })
    expect(getLibraryPage).toHaveBeenCalledWith('100', { kind: 'all' }, {
      limit: 50, classificationSources: ['deepseek', 'manual']
    })
    await expect(ipcMain.invoke('favorite-repository:get-library-page', 7, '100', { kind: 'all' }, {
      limit: 50, classificationSources: ['unknown']
    })).rejects.toThrow('Favorite library page options are invalid.')
  })

  it('publishes changes committed by a main-process sync service without a renderer command', async () => {
    const ipcMain = new FakeIpcMain()
    const send = vi.fn()
    let changed: ((result: { accountMid: string; revision: number; affectedFolderIds: string[]; affectedAids: number[] }) => void) | undefined
    const service = {
      onChanged: vi.fn((listener) => { changed = listener }),
      commit: vi.fn()
    }
    registerFavoriteRepositoryIpc({
      ipcMain, service: service as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100'), send
    })
    const subscriptionId = await ipcMain.invoke('favorite-repository:subscribe', 7, '100', 'bilimi-logical:music') as string

    changed?.({ accountMid: '100', revision: 9, affectedFolderIds: ['bilimi-logical:music'], affectedAids: [1] })

    expect(send).toHaveBeenCalledWith(7, 'favorite-repository:revision-changed', expect.objectContaining({ subscriptionId, revision: 9, pageInvalidated: true }))
  })

  it('does not double-publish renderer commits when the repository service already emits them', async () => {
    const ipcMain = new FakeIpcMain()
    const send = vi.fn()
    let changed: ((result: { accountMid: string; revision: number; affectedFolderIds: string[]; affectedAids: number[] }) => void) | undefined
    const result = { accountMid: '100', revision: 3, affectedFolderIds: ['folder-a'], affectedAids: [1] }
    const service = {
      onChanged: vi.fn((listener) => { changed = listener }),
      commit: vi.fn(async () => { changed?.(result); return result })
    }
    registerFavoriteRepositoryIpc({
      ipcMain, service: service as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100'), send
    })
    await ipcMain.invoke('favorite-repository:subscribe', 7, '100', 'folder-a')

    await ipcMain.invoke('favorite-repository:commit-command', 7, '100', {
      id: 'command-1', accountMid: '100', issuedAt: '2026-07-21T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'One', tags: [], updatedAt: '2026-07-21T00:00:00.000Z' }
    })

    expect(send).toHaveBeenCalledTimes(1)
  })

  it('returns account-scoped read-only organization recovery records to a library reader', async () => {
    const ipcMain = new FakeIpcMain()
    const service = { getOrganizationChanges: vi.fn().mockResolvedValue([
      { id: 'run-1:append-1:succeeded', runId: 'run-1', workspaceId: 'workspace-1', accountMid: '100', aid: 1,
        beforeFolderIds: ['source'], afterFolderIds: ['remote-music'], addedFolderIds: ['remote-music'], removedFolderIds: ['source'], status: 'succeeded', recordedAt: '2026-07-21T00:00:00.000Z' }
    ]) }
    registerFavoriteRepositoryIpc({
      ipcMain, service: service as never, isTrustedSender: () => false, isTrustedReader: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('favorite-repository:get-organization-changes', 8, '100')).resolves.toEqual([
      expect.objectContaining({ runId: 'run-1', afterFolderIds: ['remote-music'] })
    ])
  })

  it('allows a library-only sender to read a page but not commit a repository command', async () => {
    const ipcMain = new FakeIpcMain()
    const service = {
      getLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 0, items: [] }),
      commit: vi.fn()
    }
    registerFavoriteRepositoryIpc({
      ipcMain, service: service as never, isTrustedSender: (senderId) => senderId === 7,
      isTrustedReader: (senderId) => senderId === 8,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('favorite-repository:get-library-page', 8, '100', { kind: 'all' }, { limit: 10 }))
      .resolves.toMatchObject({ accountMid: '100', items: [] })
    const subscriptionId = await ipcMain.invoke('favorite-repository:subscribe', 8, '100') as string
    await expect(ipcMain.invoke('favorite-repository:unsubscribe', 8, '100', subscriptionId)).resolves.toBe(true)
    await expect(ipcMain.invoke('favorite-repository:commit-command', 8, '100', {
      id: 'command-1', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'Blocked', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }
    })).rejects.toThrow('untrusted renderer')
    expect(service.commit).not.toHaveBeenCalled()
  })

  it('returns one account-scoped library detail with Chinese mirror, transcription, and archive summaries', async () => {
    const ipcMain = new FakeIpcMain()
    const service = {
      getLibraryDetail: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 4,
        video: { aid: 1, title: 'Alpha', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' },
        folderIds: ['source'], pendingStates: [],
        mirror: { status: '已同步', lastSyncedAt: '2026-07-20T00:00:00.000Z' }
      })
    }
    registerFavoriteRepositoryIpc({
      ipcMain, service: service as never, isTrustedSender: () => false, isTrustedReader: (id) => id === 8,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100'),
      getArchiveSummary: vi.fn().mockReturnValue({
        status: '已入档', versionCount: 2, starred: true, hasMemo: true, memoPreview: '稍后复习',
        hasSummary: true, updatedAt: '2026-07-20T01:00:00.000Z'
      }),
      getTranscriptionSummary: vi.fn().mockReturnValue({ status: '转写完成' })
    })

    await expect(ipcMain.invoke('favorite-repository:get-library-video-detail', 8, '100', 1)).resolves.toEqual({
      version: 1, accountMid: '100', revision: 4,
      video: { aid: 1, title: 'Alpha', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' },
      folderIds: ['source'], pendingStates: [],
      mirror: { status: '已同步', lastSyncedAt: '2026-07-20T00:00:00.000Z' },
      archive: {
        status: '已入档', versionCount: 2, starred: true, hasMemo: true, memoPreview: '稍后复习',
        hasSummary: true, updatedAt: '2026-07-20T01:00:00.000Z'
      },
      transcription: { status: '转写完成' }
    })
    await expect(ipcMain.invoke('favorite-repository:get-library-video-detail', 8, '101', 1))
      .rejects.toThrow('current Bilibili account')
  })

  it('returns a trusted current-account page of user-visible video events', async () => {
    const ipcMain = new FakeIpcMain()
    const service = {
      getEventPage: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 5,
        items: [{ id: 'event-2', sequence: 2, accountMid: '100', aid: 1, kind: 'manual-move', occurredAt: '2026-07-23T00:00:00.000Z' }],
        nextCursor: '2:event-2'
      })
    }
    registerFavoriteRepositoryIpc({
      ipcMain, service: service as never, isTrustedSender: () => false, isTrustedReader: (id) => id === 8,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('favorite-repository:get-library-video-events', 8, '100', 1, { limit: 20 }))
      .resolves.toMatchObject({ accountMid: '100', items: [expect.objectContaining({ id: 'event-2', aid: 1 })] })
    expect(service.getEventPage).toHaveBeenCalledWith('100', 1, { limit: 20 })
    await expect(ipcMain.invoke('favorite-repository:get-library-video-events', 8, '101', 1, { limit: 20 }))
      .rejects.toThrow('current Bilibili account')
    await expect(ipcMain.invoke('favorite-repository:get-library-video-events', 8, '100', 0, { limit: 20 }))
      .rejects.toThrow('Favorite library video is invalid')
  })
})
