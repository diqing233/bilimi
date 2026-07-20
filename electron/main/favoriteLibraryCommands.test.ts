import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { FavoriteLibraryCommandService, registerFavoriteLibraryCommandsIpc } from './favoriteLibraryCommands'

const now = () => '2026-07-20T00:00:00.000Z'

function snapshot() {
  return {
    accountMid: '100', revision: 4,
    videos: {
      '1': { aid: 1, title: 'One', author: 'UP One', tags: [], updatedAt: now() },
      '2': { aid: 2, title: 'Two', tags: [], updatedAt: now() }
    },
    folders: [
      { id: 'local:music', title: 'Music', kind: 'local', syncState: 'local-only' },
      { id: 'remote:source', title: 'Source', kind: 'bilibili', syncState: 'bound' },
      { id: 'bilimi-logical:music', title: 'Music', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound' }
    ],
    memberships: { 'local:music': [1, 2], 'remote:source': [1] },
    physicalShards: [{
      logicalLedgerId: 'music', folderId: 'bilimi:music:001', shardNumber: 1,
      remoteFolderId: 'remote-music', remoteTitle: 'Music', bindingState: 'bound', remoteMemberCount: 0
    }],
    workspace: {
      id: 'old-workspace', accountMid: '100', status: 'previewing', baselineRevision: 3, continuationAids: [],
      workspaceRef: { workspaceId: 'old-workspace', accountMid: '100', status: 'previewing', baselineRevision: 3, currentSegmentId: 'segment-1', overlayRevision: 1, journalCursor: 1, checksum: 'abc' },
      frozenSyncPlan: { id: 'old-run', accountMid: '100', workspaceId: 'old-workspace', baselineRevision: 3, createdAt: now(), operations: [] }
    }
  }
}

function createService(overrides: Partial<ConstructorParameters<typeof FavoriteLibraryCommandService>[0]> = {}) {
  const checkpoints: Array<{ runId?: string; operationKey?: string; status: string }> = []
  const repository = {
    getSnapshot: vi.fn().mockResolvedValue(snapshot()),
    getSyncCheckpoints: vi.fn(async (_account: string, runId: string) => checkpoints.filter((record) => record.runId === runId)),
    recordSyncCheckpoint: vi.fn(async (_account: string, _id: string, record: { runId?: string; operationKey?: string; status: string }) => {
      const index = checkpoints.findIndex((item) => item.runId === record.runId && item.operationKey === record.operationKey)
      if (index >= 0) checkpoints[index] = record
      else checkpoints.push(record)
    })
  }
  const bridge = {
    append: vi.fn().mockResolvedValue({ observedAccountMid: '100' }),
    readMembers: vi.fn().mockResolvedValue({ observedAccountMid: '100', members: { 'remote-music': [] } })
  }
  const pageBridgeManager = {
    bind: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
    pageBridge: vi.fn(() => bridge)
  }
  const transcriptionQueue = { enqueue: vi.fn() }
  return {
    repository, pageBridgeManager, transcriptionQueue, pageBridge: bridge,
    service: new FavoriteLibraryCommandService({
      repository: repository as never,
      pageBridgeManager: pageBridgeManager as never,
      transcriptionQueue,
      root: join(tmpdir(), 'bilimi-favorite-library-command-tests'),
      now,
      runId: () => 'library-run-1',
      ...overrides
    })
  }
}

describe('FavoriteLibraryCommandService', () => {
  it('resolves a folder selection in the main process, preserves the old workspace, and checkpoints only the library run', async () => {
    const { service, repository, pageBridge } = createService({ root: await mkdtemp(join(tmpdir(), 'bilimi-library-sync-')) })

    await expect(service.syncSelection('100', { kind: 'folder', folderId: 'local:music' })).resolves.toMatchObject({
      runId: 'library-run-1', status: 'succeeded', affectedAids: [1, 2]
    })

    expect(pageBridge.append).toHaveBeenCalledWith(expect.objectContaining({ aid: 1, folderIds: ['remote-music'] }))
    expect(pageBridge.append).toHaveBeenCalledWith(expect.objectContaining({ aid: 2, folderIds: ['remote-music'] }))
    expect(repository.recordSyncCheckpoint).toHaveBeenCalled()
    expect(repository.getSnapshot).toHaveBeenCalled()
    expect(repository.commit).toBeUndefined()
  })

  it('rejects Bilibili source folders and unknown aids instead of accepting renderer supplied targets', async () => {
    const { service, pageBridgeManager } = createService()

    await expect(service.syncSelection('100', { kind: 'folder', folderId: 'remote:source' })).rejects.toThrow('not a local Bilimi folder')
    await expect(service.syncSelection('100', { kind: 'aids', aids: [999] })).rejects.toThrow('not available for sync')
    expect(pageBridgeManager.bind).not.toHaveBeenCalled()
  })

  it('requires reconciliation before retrying an unknown remote result', async () => {
    const { service, pageBridge, pageBridgeManager } = createService({ root: await mkdtemp(join(tmpdir(), 'bilimi-library-reconcile-')) })
    pageBridge.append.mockRejectedValue(new Error('connection lost'))
    await expect(service.syncSelection('100', { kind: 'aids', aids: [1] })).resolves.toMatchObject({ status: 'result-unknown' })
    await expect(service.retrySync('100', 'library-run-1')).rejects.toThrow('must be reconciled')

    await expect(service.reconcileSync('100', 'library-run-1')).resolves.toMatchObject({ status: 'ready-to-retry' })
    expect(pageBridgeManager.bind).toHaveBeenCalledTimes(1)
  })

  it('hydrates selected repository videos into the existing transcription queue without a renderer supplied URL', async () => {
    const { service, transcriptionQueue } = createService()

    await expect(service.enqueueTranscription('100', [2, 1, 2], true)).resolves.toMatchObject({ affectedAids: [1, 2] })

    expect(transcriptionQueue.enqueue).toHaveBeenNthCalledWith(1, {
      url: 'https://www.bilibili.com/video/av1', title: 'One', author: 'UP One', aid: 1, summarizeWithDeepSeek: true
    })
    expect(transcriptionQueue.enqueue).toHaveBeenNthCalledWith(2, {
      url: 'https://www.bilibili.com/video/av2', title: 'Two', aid: 2, summarizeWithDeepSeek: true
    })
  })
})

describe('registerFavoriteLibraryCommandsIpc', () => {
  it('accepts only narrow account-scoped library actions from the isolated library renderer', async () => {
    const handlers = new Map<string, (event: { sender: { id: number } }, ...args: never[]) => unknown>()
    const ipcMain = { handle: (channel: string, handler: (event: { sender: { id: number } }, ...args: never[]) => unknown) => handlers.set(channel, handler) }
    const commands = {
      syncSelection: vi.fn().mockResolvedValue({ status: 'succeeded' }),
      reconcileSync: vi.fn(), retrySync: vi.fn(), bindSyncPage: vi.fn(), enqueueTranscription: vi.fn(), getPendingSyncRuns: vi.fn()
    }
    registerFavoriteLibraryCommandsIpc({
      ipcMain, commands: commands as never, isTrustedLibrarySender: (id) => id === 8,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })
    const invoke = (channel: string, senderId: number, ...args: unknown[]) => handlers.get(channel)?.({ sender: { id: senderId } }, ...args as never[])

    await expect(invoke('favorite-library:sync-selection', 8, '100', { kind: 'aids', aids: [1] })).resolves.toEqual({ status: 'succeeded' })
    await expect(invoke('favorite-library:sync-selection', 8, '101', { kind: 'aids', aids: [1] })).rejects.toThrow('current Bilibili account')
    await expect(invoke('favorite-library:sync-selection', 7, '100', { kind: 'aids', aids: [1] })).rejects.toThrow('untrusted renderer')
    await expect(invoke('favorite-library:sync-selection', 8, '100', { kind: 'aids', aids: [1], folderIds: ['forged'] })).rejects.toThrow('selection is invalid')
    await expect(invoke('favorite-library:enqueue-transcription', 8, '100', { aids: [1], url: 'https://forged.invalid' })).rejects.toThrow('transcription request is invalid')
    expect(commands.syncSelection).toHaveBeenCalledWith('100', { kind: 'aids', aids: [1] })
  })

  it('returns only failed or unresolved persisted runs to a library renderer after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bilimi-library-restarted-'))
    const { service, pageBridge, repository } = createService({ root })
    pageBridge.append.mockRejectedValue(new Error('connection lost'))
    await service.syncSelection('100', { kind: 'aids', aids: [1] })

    const restarted = createService({ root, repository: repository as never }).service
    await expect(restarted.getPendingSyncRuns('100')).resolves.toMatchObject([
      { runId: 'library-run-1', status: 'result-unknown', affectedAids: [1] }
    ])
  })

  it('recovers earlier job entries when the journal has an incomplete final line', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bilimi-library-truncated-'))
    const { service, pageBridge, repository } = createService({ root })
    pageBridge.append.mockRejectedValue(new Error('connection lost'))
    await service.syncSelection('100', { kind: 'aids', aids: [1] })
    const { appendFile } = await import('node:fs/promises')
    await appendFile(join(root, '100', 'library-sync-jobs.jsonl'), '{"type":"create"', 'utf8')

    await expect(createService({ root, repository: repository as never }).service.getPendingSyncRuns('100'))
      .resolves.toMatchObject([{ runId: 'library-run-1', status: 'result-unknown' }])
  })
})
