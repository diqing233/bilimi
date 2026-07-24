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

  it('deletes, restores, and forgets local library tombstones without a remote writer', async () => {
    const { repository, refreshVideo, transcriptionQueue } = createService()
    const service = new FavoriteLibraryCommandService({ repository: repository as never, refreshVideo, transcriptionQueue, now })

    await service.deleteFromLibrary('100', 1, 4)
    await service.restoreToLibrary('100', 1, 5)
    await service.forgetTombstone('100', 1, 6)

    expect(repository.commit).toHaveBeenNthCalledWith(1, '100', expect.objectContaining({ type: 'delete-favorite-from-library', expectedRevision: 4 }))
    expect(repository.commit).toHaveBeenNthCalledWith(2, '100', expect.objectContaining({ type: 'restore-favorite-to-library', expectedRevision: 5 }))
    expect(repository.commit).toHaveBeenNthCalledWith(3, '100', expect.objectContaining({ type: 'forget-favorite-tombstone', expectedRevision: 6 }))
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
})

describe('registerFavoriteLibraryCommandsIpc', () => {
  it('exposes only account-scoped local refresh and transcription commands', async () => {
    const handlers = new Map<string, (event: { sender: { id: number } }, ...args: never[]) => unknown>()
    const ipcMain = { handle: (channel: string, handler: (event: { sender: { id: number } }, ...args: never[]) => unknown) => handlers.set(channel, handler) }
    const commands = { syncSelection: vi.fn().mockResolvedValue({ status: 'succeeded' }), enqueueTranscription: vi.fn() }
    registerFavoriteLibraryCommandsIpc({ ipcMain, commands: commands as never, isTrustedLibrarySender: (id) => id === 8, getCurrentAccountMid: vi.fn().mockResolvedValue('100') })
    const invoke = (channel: string, senderId: number, ...args: unknown[]) => handlers.get(channel)?.({ sender: { id: senderId } }, ...args as never[])

    await expect(invoke('favorite-library:sync-selection', 8, '100', { kind: 'aids', aids: [1] })).resolves.toEqual({ status: 'succeeded' })
    expect(handlers.has('favorite-library:reconcile-sync')).toBe(false)
    expect(handlers.has('favorite-library:retry-sync')).toBe(false)
    expect(handlers.has('favorite-library:bind-sync-page')).toBe(false)
    expect(handlers.has('favorite-library:get-pending-sync-runs')).toBe(false)
  })
})
