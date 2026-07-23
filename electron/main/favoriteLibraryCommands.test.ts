import { describe, expect, it, vi } from 'vitest'
import { FavoriteLibraryCommandService, registerFavoriteLibraryCommandsIpc } from './favoriteLibraryCommands'

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

    await service.enqueueTranscription('100', [1], true)

    expect(refreshVideo).toHaveBeenCalledBefore(transcriptionQueue.enqueue as never)
    expect(transcriptionQueue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      accountMid: '100', aid: 1, bvid: 'BV1xx', title: '已刷新标题', metadataRevision: 5, summarizeWithDeepSeek: true
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
