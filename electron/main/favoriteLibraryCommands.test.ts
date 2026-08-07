import { describe, expect, it, vi } from 'vitest'
import { createFavoriteLibraryRemoteUnfavorite, FavoriteLibraryCommandService, registerFavoriteLibraryCommandsIpc } from './favoriteLibraryCommands'

const now = () => '2026-07-21T00:00:00.000Z'

function snapshot() {
  return {
    accountMid: '100', revision: 4, libraryMirrors: {}, syncRecords: [], organizationRecords: [], organizationMigrationInitialized: false,
    videos: { '1': { aid: 1, title: '旧标题', tags: [], updatedAt: now() } },
    folders: [{ id: 'source', title: '来源', kind: 'bilibili', remoteFolderId: '9', syncState: 'bound' }],
    memberships: { source: [1] }, physicalShards: []
  }
}

function createService() {
  const repository = { getSnapshot: vi.fn().mockResolvedValue(snapshot()), commit: vi.fn().mockResolvedValue(undefined) }
  const refreshVideo = vi.fn().mockResolvedValue({ aid: 1, title: '已刷新标题', bvid: 'BV1xx', tags: ['测试'], updatedAt: now() })
  const transcriptionQueue = { enqueue: vi.fn() }
  return {
    repository, refreshVideo, transcriptionQueue,
    service: new FavoriteLibraryCommandService({ repository: repository as never, refreshVideo, transcriptionQueue, now })
  }
}

describe('FavoriteLibraryCommandService', () => {
  it('uses the per-account remote queue and stops an unfavorite batch after an unknown remote outcome', async () => {
    const unfavorite = vi.fn().mockRejectedValue(new Error('network-failure'))
    const pageBridgeManager = {
      bind: vi.fn().mockResolvedValue(undefined),
      pageBridge: vi.fn().mockReturnValue({ unfavorite }),
      release: vi.fn()
    }
    const remoteOperations = {
      enqueue: vi.fn(async (_accountMid: string, _options: unknown, run: () => Promise<unknown>) => run())
    }

    const adapter = createFavoriteLibraryRemoteUnfavorite({ pageBridgeManager, remoteOperations })
    await expect(adapter.unfavorite('100', [1, 2])).resolves.toMatchObject({
      status: 'result-unknown', completedOperationCount: 0, totalOperationCount: 2, affectedAids: [1, 2], reason: 'network-failure'
    })

    expect(remoteOperations.enqueue).toHaveBeenCalledTimes(1)
    expect(unfavorite).toHaveBeenCalledTimes(1)
    expect(pageBridgeManager.release).toHaveBeenCalledTimes(1)
  })

  it('runs the remote-unfavorite precondition inside the arbiter work item before the page write', async () => {
    const order: string[] = []
    const pageBridgeManager = {
      bind: vi.fn(async () => { order.push('bind') }),
      pageBridge: vi.fn(() => ({ unfavorite: vi.fn(async () => { order.push('write') }) })),
      release: vi.fn(() => { order.push('release') })
    }
    const remoteOperations = {
      enqueue: vi.fn(async (_accountMid: string, _options: unknown, run: () => Promise<unknown>) => {
        order.push('arbiter')
        return run()
      })
    }
    const adapter = createFavoriteLibraryRemoteUnfavorite({ pageBridgeManager, remoteOperations })

    await adapter.unfavorite('100', [1], { beforeRemoteWrite: async () => { order.push('baseline') } })

    expect(order).toEqual(['arbiter', 'baseline', 'bind', 'write', 'release'])
  })

  it('commits a deduplicated local placement batch before queuing remote work', async () => {
    const { repository, refreshVideo, transcriptionQueue } = createService()
    const synchronizePlacements = vi.fn().mockResolvedValue({ status: 'queued', affectedAids: [1] })
    const service = new FavoriteLibraryCommandService({
      repository: repository as never, refreshVideo, transcriptionQueue, now,
      placementSync: { synchronizePlacements }
    })

    await expect(service.setLocalPlacements('100', [{ aid: 1, folderIds: ['bilimi-logical:music'] }], 4, true))
      .resolves.toMatchObject({ status: 'queued', affectedAids: [1] })

    expect(repository.commit).toHaveBeenCalledWith('100', expect.objectContaining({
      expectedRevision: 4,
      type: 'set-favorite-placements',
      payload: expect.objectContaining({ placements: [expect.objectContaining({
        aid: 1, localDesiredFolderIds: ['bilimi-logical:music']
      })] })
    }))
    expect(synchronizePlacements).toHaveBeenCalledAfter(repository.commit as never)
  })

  it('keeps a frozen workspace local-only and does not start remote placement sync', async () => {
    const { repository, refreshVideo, transcriptionQueue } = createService()
    repository.getSnapshot.mockResolvedValueOnce({ ...snapshot(), workspace: { id: 'w', status: 'frozen' } })
    const synchronizePlacements = vi.fn()
    const service = new FavoriteLibraryCommandService({
      repository: repository as never, refreshVideo, transcriptionQueue, now,
      placementSync: { synchronizePlacements }
    })

    await expect(service.setLocalPlacements('100', [{ aid: 1, folderIds: [] }], 4, true))
      .resolves.toMatchObject({ status: 'queued', affectedAids: [1] })

    expect(synchronizePlacements).not.toHaveBeenCalled()
    expect(repository.commit).toHaveBeenCalledWith('100', expect.objectContaining({
      type: 'set-favorite-placements',
      payload: expect.objectContaining({ placements: [expect.objectContaining({ positionState: 'local-only-change' })] })
    }))
  })

  it('synchronizes existing placements without refreshing video metadata', async () => {
    const { repository, refreshVideo, transcriptionQueue } = createService()
    const synchronizePlacements = vi.fn().mockResolvedValue({ status: 'succeeded', affectedAids: [1] })
    const service = new FavoriteLibraryCommandService({
      repository: repository as never, refreshVideo, transcriptionQueue, now,
      placementSync: { synchronizePlacements }
    })

    await expect(service.synchronizeSelection('100', { kind: 'aids', aids: [1] })).resolves.toMatchObject({
      status: 'succeeded', affectedAids: [1]
    })

    expect(synchronizePlacements).toHaveBeenCalledWith('100', [1])
    expect(refreshVideo).not.toHaveBeenCalled()
    expect(repository.commit).not.toHaveBeenCalled()
  })

  it('keeps direct placement synchronization queued while old-favorite work owns remote writes', async () => {
    const { repository, refreshVideo, transcriptionQueue } = createService()
    repository.getSnapshot.mockResolvedValueOnce({ ...snapshot(), workspace: { id: 'w', status: 'executing' } })
    const synchronizePlacements = vi.fn()
    const service = new FavoriteLibraryCommandService({
      repository: repository as never, refreshVideo, transcriptionQueue, now,
      placementSync: { synchronizePlacements }
    })

    await expect(service.synchronizeSelection('100', { kind: 'aids', aids: [1] })).resolves.toMatchObject({
      status: 'queued', completedOperationCount: 0, totalOperationCount: 1, affectedAids: [1]
    })
    expect(synchronizePlacements).not.toHaveBeenCalled()
  })

  it('adopts observed remote logical folders as a revision-checked local intent', async () => {
    const { repository, refreshVideo, transcriptionQueue } = createService()
    repository.getSnapshot.mockResolvedValueOnce({
      ...snapshot(),
      positions: { '100:1': {
        accountMid: '100', aid: 1, localDesiredFolderIds: ['bilimi-logical:music'],
        remoteObservedPhysicalFolderIds: ['remote-game'], remoteObservedLogicalFolderIds: ['bilimi-logical:game'],
        positionState: 'local-only-change', updatedAt: now(), revision: 4
      } }
    })
    const service = new FavoriteLibraryCommandService({ repository: repository as never, refreshVideo, transcriptionQueue, now })

    await service.adoptRemotePlacement('100', 1, 4)

    expect(repository.commit).toHaveBeenCalledWith('100', expect.objectContaining({
      type: 'set-favorite-placement', expectedRevision: 4,
      payload: expect.objectContaining({ localDesiredFolderIds: ['bilimi-logical:game'] })
    }))
  })

  it('deletes, restores, and permanently clears recycled local records without a remote writer', async () => {
    const { repository, refreshVideo, transcriptionQueue } = createService()
    const service = new FavoriteLibraryCommandService({ repository: repository as never, refreshVideo, transcriptionQueue, now })

    await service.deleteFromLibrary('100', 1, 4)
    await service.restoreToLibrary('100', 1, 5)
    await service.clearRecycledFavorite('100', 1, 6)

    expect(repository.commit).toHaveBeenNthCalledWith(1, '100', expect.objectContaining({ type: 'delete-favorite-from-library', expectedRevision: 4 }))
    expect(repository.commit).toHaveBeenNthCalledWith(2, '100', expect.objectContaining({ type: 'restore-favorite-to-library', expectedRevision: 5 }))
    expect(repository.commit).toHaveBeenNthCalledWith(3, '100', expect.objectContaining({ type: 'clear-recycled-favorite', expectedRevision: 6 }))
  })

  it('cancels an explicitly selected Bilibili favorite through a separate remote adapter without touching local records', async () => {
    const { repository, refreshVideo, transcriptionQueue } = createService()
    const unfavorite = vi.fn().mockResolvedValue({
      status: 'succeeded', completedOperationCount: 1, totalOperationCount: 1, affectedAids: [1]
    })
    const service = new FavoriteLibraryCommandService({
      repository: repository as never, refreshVideo, transcriptionQueue, now,
      remoteUnfavorite: { unfavorite }
    })

    await expect(service.cancelBilibiliFavorites('100', [1])).resolves.toMatchObject({
      status: 'succeeded', affectedAids: [1]
    })

    expect(unfavorite).toHaveBeenCalledWith('100', [1])
    expect(repository.commit).not.toHaveBeenCalled()
  })

  it('refreshes selected metadata locally and never receives a page bridge or remote write dependency', async () => {
    const { service, repository, refreshVideo } = createService()

    await expect(service.syncSelection('100', { kind: 'folder', folderId: 'source' })).resolves.toMatchObject({
      status: 'succeeded', affectedAids: [1]
    })

    expect(refreshVideo).toHaveBeenCalledWith('100', 1)
    expect(repository.commit).toHaveBeenCalledWith('100', expect.objectContaining({ type: 'upsert-video' }))
    expect(repository.commit).toHaveBeenCalledWith('100', expect.objectContaining({ type: 'record-library-mirror', payload: expect.objectContaining({ status: 'synced' }) }))
  })

  it('persists unavailable metadata separately from temporary network failures', async () => {
    const { repository, transcriptionQueue } = createService()
    const unavailable = Object.assign(new Error('Video is unavailable.'), {
      errorCode: 'unavailable' as const,
      remoteCode: 62012
    })
    const service = new FavoriteLibraryCommandService({
      repository: repository as never,
      refreshVideo: vi.fn().mockRejectedValue(unavailable),
      transcriptionQueue,
      now
    })

    await expect(service.syncSelection('100', { kind: 'aids', aids: [1] })).rejects.toBe(unavailable)
    expect(repository.commit).toHaveBeenCalledWith('100', expect.objectContaining({
      type: 'record-library-mirror',
      payload: expect.objectContaining({
        status: 'failed', errorCode: 'unavailable', remoteCode: 62012,
        lastCheckedAt: '2026-07-21T00:00:00.000Z'
      })
    }))
  })

  it('refreshes the deduplicated logical-folder union across logical, physical, and bound remote members', async () => {
    const repository = {
      getSnapshot: vi.fn().mockResolvedValue({
        ...snapshot(),
        folders: [{ id: 'bilimi-logical:music', title: 'Music', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound' }],
        memberships: {
          'bilimi-logical:music': [1],
          'bilimi:music:001': [1, 2],
          'bilibili:900': [2, 3]
        },
        physicalShards: [{ logicalLedgerId: 'music', folderId: 'bilimi:music:001', shardNumber: 1, remoteTitle: 'Music', bindingState: 'bound', remoteFolderId: '900' }]
      }),
      getLibraryFolderAids: vi.fn().mockResolvedValue([1, 2, 3]),
      commit: vi.fn().mockResolvedValue(undefined)
    }
    const refreshVideo = vi.fn(async (_accountMid: string, aid: number) => ({
      aid, title: `Video ${aid}`, tags: [], updatedAt: now()
    }))
    const service = new FavoriteLibraryCommandService({
      repository, refreshVideo, transcriptionQueue: { enqueue: vi.fn() }, now
    })

    await expect(service.syncSelection('100', { kind: 'folder', folderId: 'bilimi-logical:music' }))
      .resolves.toMatchObject({ affectedAids: [1, 2, 3] })
    expect(repository.getLibraryFolderAids).toHaveBeenCalledWith('100', 'bilimi-logical:music')
    expect(refreshVideo).toHaveBeenCalledTimes(3)
    expect(refreshVideo).toHaveBeenNthCalledWith(1, '100', 1)
    expect(refreshVideo).toHaveBeenNthCalledWith(2, '100', 2)
    expect(refreshVideo).toHaveBeenNthCalledWith(3, '100', 3)
  })

  it('refreshes metadata before enqueuing an unsynced video and pins the queue request to that snapshot', async () => {
    const { service, refreshVideo, transcriptionQueue } = createService()
    refreshVideo.mockResolvedValueOnce({ aid: 1, title: '已刷新标题', bvid: 'BV1xx', cid: 70, tags: ['测试'], updatedAt: now() })

    await service.enqueueTranscription('100', [1], true)

    expect(refreshVideo).toHaveBeenCalledBefore(transcriptionQueue.enqueue as never)
    expect(transcriptionQueue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      accountMid: '100', aid: 1, bvid: 'BV1xx', cid: 70, title: '已刷新标题', metadataRevision: 5, summarizeWithDeepSeek: true
    }))
  })

  it('does not let one part suppress another part of the same account video', async () => {
    const { repository, refreshVideo } = createService()
    const enqueue = vi.fn()
    refreshVideo.mockResolvedValueOnce({ aid: 1, title: 'New part', bvid: 'BV1xx', cid: 71, tags: [], updatedAt: now() })
    const service = new FavoriteLibraryCommandService({
      repository: repository as never,
      refreshVideo,
      transcriptionQueue: {
        enqueue,
        getSnapshot: () => ({ items: [{ accountMid: '100', aid: 1, cid: 70, status: 'pending' }] })
      },
      now
    })

    await service.enqueueTranscription('100', [1])

    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ accountMid: '100', aid: 1, cid: 71 }))
  })
})

describe('registerFavoriteLibraryCommandsIpc', () => {
  it('preserves the complete filtered scope when resolving a batch document-export selection', async () => {
    const handlers = new Map<string, (event: { sender: { id: number } }, ...args: never[]) => unknown>()
    const ipcMain = { handle: (channel: string, handler: (event: { sender: { id: number } }, ...args: never[]) => unknown) => handlers.set(channel, handler) }
    const resolveSelection = vi.fn().mockResolvedValue([7, 9])
    registerFavoriteLibraryCommandsIpc({ ipcMain, commands: { syncSelection: vi.fn(), enqueueTranscription: vi.fn() } as never, isTrustedLibrarySender: () => true, getCurrentAccountMid: vi.fn().mockResolvedValue('100'), resolveSelection })
    await expect(handlers.get('favorite-library:resolve-document-export-selection')?.({ sender: { id: 8 } }, '100', {
      kind: 'scope', scope: { kind: 'all' }, options: { query: 'needle', filter: 'unsynced', transcriptionFilters: ['failed'] }, excludedAids: [3]
    } as never)).resolves.toEqual({ aids: [7, 9] })
    expect(resolveSelection).toHaveBeenCalledWith('100', expect.objectContaining({ options: expect.objectContaining({ query: 'needle', filter: 'unsynced', transcriptionFilters: ['failed'] }), excludedAids: [3] }))
  })
  it('maps explicit document-export aids through the main-process identity resolver', async () => {
    const handlers = new Map<string, (event: { sender: { id: number } }, ...args: never[]) => unknown>()
    const ipcMain = { handle: (channel: string, handler: (event: { sender: { id: number } }, ...args: never[]) => unknown) => handlers.set(channel, handler) }
    const resolveDocumentExportSelection = vi.fn().mockResolvedValue({ selections: [{ archiveId: 'archive-1', versionId: 'version-1' }], skippedAids: [2] })
    registerFavoriteLibraryCommandsIpc({ ipcMain, commands: { syncSelection: vi.fn(), enqueueTranscription: vi.fn() } as never, isTrustedLibrarySender: () => true, getCurrentAccountMid: vi.fn().mockResolvedValue('100'), resolveDocumentExportSelection })

    await expect(handlers.get('favorite-library:resolve-document-export-selection')?.({ sender: { id: 8 } }, '100', { kind: 'aids', aids: [2, 1, 1] } as never))
      .resolves.toEqual({ selections: [{ archiveId: 'archive-1', versionId: 'version-1' }], skippedAids: [2] })
    expect(resolveDocumentExportSelection).toHaveBeenCalledWith('100', [1, 2])
  })
  it('exposes only account-scoped local refresh and transcription commands', async () => {
    const handlers = new Map<string, (event: { sender: { id: number } }, ...args: never[]) => unknown>()
    const ipcMain = { handle: (channel: string, handler: (event: { sender: { id: number } }, ...args: never[]) => unknown) => handlers.set(channel, handler) }
    const commands = {
      syncSelection: vi.fn().mockResolvedValue({ status: 'succeeded' }),
      synchronizeSelection: vi.fn().mockResolvedValue({ status: 'queued' }),
      enqueueTranscription: vi.fn()
    }
    registerFavoriteLibraryCommandsIpc({ ipcMain, commands: commands as never, isTrustedLibrarySender: (id) => id === 8, getCurrentAccountMid: vi.fn().mockResolvedValue('100') })
    const invoke = (channel: string, senderId: number, ...args: unknown[]) => handlers.get(channel)?.({ sender: { id: senderId } }, ...args as never[])

    await expect(invoke('favorite-library:sync-selection', 8, '100', { kind: 'aids', aids: [1] })).resolves.toEqual({ status: 'succeeded' })
    await expect(invoke('favorite-library:synchronize-placements', 8, '100', { kind: 'aids', aids: [1] })).resolves.toEqual({ status: 'queued' })
    expect(commands.synchronizeSelection).toHaveBeenCalledWith('100', { kind: 'aids', aids: [1] })
    expect(handlers.has('favorite-library:reconcile-sync')).toBe(false)
    expect(handlers.has('favorite-library:retry-sync')).toBe(false)
    expect(handlers.has('favorite-library:bind-sync-page')).toBe(false)
    expect(handlers.has('favorite-library:get-pending-sync-runs')).toBe(false)
  })

  it('keeps an all-results refresh selection in the main process', async () => {
    const handlers = new Map<string, (event: { sender: { id: number } }, ...args: never[]) => unknown>()
    const ipcMain = { handle: (channel: string, handler: (event: { sender: { id: number } }, ...args: never[]) => unknown) => handlers.set(channel, handler) }
    const commands = { syncSelection: vi.fn().mockResolvedValue({ status: 'succeeded' }), enqueueTranscription: vi.fn(), cancelWaitingTranscription: vi.fn() }
    const resolveSelection = vi.fn().mockResolvedValue([1, 3])
    registerFavoriteLibraryCommandsIpc({ ipcMain, commands: commands as never, isTrustedLibrarySender: () => true, getCurrentAccountMid: vi.fn().mockResolvedValue('100'), resolveSelection })

    await handlers.get('favorite-library:sync-selection')?.({ sender: { id: 8 } }, '100', {
      kind: 'scope', scope: { kind: 'folder', folderId: 'bilimi-logical:music' }, options: { query: 'needle', filter: 'unsynced', sort: 'title-asc', transcriptionFilters: ['running', 'failed', 'running'] }, excludedAids: [2]
    } as never)
    expect(resolveSelection).toHaveBeenCalledWith('100', expect.objectContaining({ kind: 'scope', options: expect.objectContaining({ transcriptionFilters: ['failed', 'running'] }), excludedAids: [2] }))
    expect(commands.syncSelection).toHaveBeenCalledWith('100', { kind: 'aids', aids: [1, 3] })

    await handlers.get('favorite-library:enqueue-transcription')?.({ sender: { id: 8 } }, '100', {
      kind: 'scope', scope: { kind: 'folder', folderId: 'bilimi-logical:music' }, options: { transcriptionFilters: ['none', 'running', 'none'] }, excludedAids: []
    } as never)
    expect(resolveSelection).toHaveBeenLastCalledWith('100', expect.objectContaining({
      options: expect.objectContaining({ transcriptionFilters: ['none', 'running'] })
    }))
    expect(commands.enqueueTranscription).toHaveBeenCalledWith('100', [1, 3], false)

    await handlers.get('favorite-library:cancel-waiting-transcription')?.({ sender: { id: 8 } }, '100', {
      kind: 'scope', scope: { kind: 'all' }, options: { transcriptionFilters: ['failed'] }, excludedAids: [2]
    } as never)
    expect(resolveSelection).toHaveBeenLastCalledWith('100', expect.objectContaining({
      options: expect.objectContaining({ transcriptionFilters: ['failed'] }), excludedAids: [2]
    }))
    expect(commands.cancelWaitingTranscription).toHaveBeenCalledWith('100', [1, 3])
  })

  it('rejects a scope action when the account changes while main-process selection resolution is pending', async () => {
    const handlers = new Map<string, (event: { sender: { id: number } }, ...args: never[]) => unknown>()
    const ipcMain = { handle: (channel: string, handler: (event: { sender: { id: number } }, ...args: never[]) => unknown) => handlers.set(channel, handler) }
    let accountMid = '100'
    let resolveSelection: ((aids: number[]) => void) | undefined
    const commands = { syncSelection: vi.fn(), enqueueTranscription: vi.fn() }
    registerFavoriteLibraryCommandsIpc({
      ipcMain, commands: commands as never, isTrustedLibrarySender: () => true,
      getCurrentAccountMid: async () => accountMid,
      resolveSelection: vi.fn(() => new Promise<number[]>((resolve) => { resolveSelection = resolve }))
    })

    const pending = handlers.get('favorite-library:sync-selection')?.({ sender: { id: 8 } }, '100', {
      kind: 'scope', scope: { kind: 'all' }, options: {}, excludedAids: []
    } as never)
    await vi.waitFor(() => expect(resolveSelection).toBeDefined())
    accountMid = '200'
    resolveSelection?.([1])
    await expect(pending).rejects.toThrow('当前账号已切换')
    expect(commands.syncSelection).not.toHaveBeenCalled()
  })

  it('rejects more than 500 explicit transcription targets at the IPC boundary', async () => {
    const handlers = new Map<string, (event: { sender: { id: number } }, ...args: never[]) => unknown>()
    const ipcMain = { handle: (channel: string, handler: (event: { sender: { id: number } }, ...args: never[]) => unknown) => handlers.set(channel, handler) }
    registerFavoriteLibraryCommandsIpc({ ipcMain, commands: { enqueueTranscription: vi.fn() } as never, isTrustedLibrarySender: () => true, getCurrentAccountMid: async () => '100' })
    await expect(handlers.get('favorite-library:enqueue-transcription')?.({ sender: { id: 8 } }, '100', {
      targets: Array.from({ length: 501 }, (_, index) => ({ aid: index + 1 }))
    } as never)).rejects.toThrow('invalid')
  })

  it('passes an explicit video-part transcription target through the trusted IPC boundary', async () => {
    const handlers = new Map<string, (event: { sender: { id: number } }, ...args: never[]) => unknown>()
    const ipcMain = { handle: (channel: string, handler: (event: { sender: { id: number } }, ...args: never[]) => unknown) => handlers.set(channel, handler) }
    const commands = { syncSelection: vi.fn(), enqueueTranscription: vi.fn().mockResolvedValue({ status: 'queued' }), cancelWaitingTranscription: vi.fn() }
    registerFavoriteLibraryCommandsIpc({ ipcMain, commands: commands as never, isTrustedLibrarySender: () => true, getCurrentAccountMid: vi.fn().mockResolvedValue('100') })

    await handlers.get('favorite-library:enqueue-transcription')?.({ sender: { id: 8 } }, '100', {
      targets: [{ aid: 1, cid: 70 }], summarizeWithDeepSeek: true
    } as never)

    expect(commands.enqueueTranscription).toHaveBeenCalledWith('100', [{ aid: 1, cid: 70 }], true)
  })

  it('skips already queued library videos and cancels waiting work without stopping running work', async () => {
    const { repository, refreshVideo } = createService()
    const enqueue = vi.fn()
    const cancelWaitingForVideos = vi.fn().mockReturnValue({ affected: 1, skipped: 1 })
    const service = new FavoriteLibraryCommandService({
      repository: repository as never,
      refreshVideo,
      transcriptionQueue: {
        enqueue,
        getSnapshot: () => ({ items: [
          { accountMid: '100', aid: 1, status: 'pending' },
          { accountMid: '100', aid: 2, status: 'running' }
        ] }),
        cancelWaitingForVideos
      },
      now
    })

    await expect(service.enqueueTranscription('100', [1, 2])).resolves.toMatchObject({ completedOperationCount: 0 })
    expect(enqueue).not.toHaveBeenCalled()
    expect(service.cancelWaitingTranscription('100', [1, 2])).toMatchObject({ completedOperationCount: 1 })
    expect(cancelWaitingForVideos).toHaveBeenCalledWith('100', [{ aid: 1 }, { aid: 2 }])
  })
})
