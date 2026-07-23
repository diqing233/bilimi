import { describe, expect, it, vi } from 'vitest'
import type { AccountFavoriteRepositorySnapshot, FavoriteRepositoryArchiveExport, FavoriteRepositoryEvent } from '../../src/shared/favoriteRepository'
import { FavoriteRepositoryArchiveService, type FavoriteRepositoryRestoreWriter } from './favoriteRepositoryArchiveService'
import { FavoriteRepositoryRemoteOperationArbiter } from './favoriteRepositoryRemoteOperationArbiter'

const snapshot = (): AccountFavoriteRepositorySnapshot => ({
  version: 1, accountMid: '100', revision: 4, updatedAt: '2026-07-24T00:00:00.000Z',
  videos: {
    '1': { aid: 1, title: 'One', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' },
    '2': { aid: 2, title: 'Two', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' }
  },
  libraryMirrors: {}, folders: [], memberships: {}, physicalShards: [], syncRecords: [],
  organizationRecords: [{ accountMid: '100', aid: 1, targetFolderIds: [], completedAt: '2026-07-24T00:00:00.000Z' }],
  organizationBatches: [], organizationMigrationInitialized: true,
  positions: {
    '100:1': {
      accountMid: '100', aid: 1, localDesiredFolderIds: ['bilimi-logical:music'],
      remoteObservedPhysicalFolderIds: ['1'], remoteObservedLogicalFolderIds: ['bilimi-logical:music'],
      positionState: 'aligned', updatedAt: '2026-07-24T00:00:00.000Z', revision: 4
    }
  }, tombstones: {}
})

const event: FavoriteRepositoryEvent = {
  id: 'event-1', sequence: 1, accountMid: '100', aid: 1, kind: 'manual-move', occurredAt: '2026-07-24T00:00:00.000Z'
}

function createService(overrides: Partial<ConstructorParameters<typeof FavoriteRepositoryArchiveService>[0]> = {}) {
  return new FavoriteRepositoryArchiveService({
    repository: {
      getSnapshot: async () => snapshot(),
      getEventPage: async (_accountMid, aid) => ({ version: 1, accountMid: '100', revision: 4, items: aid === 1 ? [event] : [] }),
      recordSyncCheckpoint: async () => undefined
    },
    now: () => '2026-07-24T01:00:00.000Z',
    loadArchiveIndex: async () => [{ aid: 1, archiveId: 'archive-1', registeredAt: '2026-07-24T00:00:00.000Z' }],
    ...overrides
  })
}

describe('FavoriteRepositoryArchiveService', () => {
  it('exports a credential-free account archive with events and archive index', async () => {
    const exported = await createService().exportAccount('100')

    expect(exported).toMatchObject({ accountMid: '100', generatedAt: '2026-07-24T01:00:00.000Z', checksum: expect.any(String) })
    expect(exported.events).toEqual([event])
    expect(exported.archives).toEqual([{ aid: 1, archiveId: 'archive-1', registeredAt: '2026-07-24T00:00:00.000Z' }])
  })

  it('rejects import data whose serialized size exceeds the configured safety limit', async () => {
    const service = createService({ maxImportBytes: 10 })
    const archive = await createService().exportAccount('100')

    expect(() => service.previewImport(JSON.stringify(archive), '100')).toThrow('size')
  })

  it('keeps a different account import offline and read-only', async () => {
    const archive = await createService().exportAccount('100')

    expect(createService().previewImport(archive, '200')).toMatchObject({ accountMatches: false, canApply: false, canRestoreRemotely: false })
  })

  it('applies a matching validated import through exactly one atomic callback', async () => {
    const archive = await createService().exportAccount('100')
    const calls: FavoriteRepositoryArchiveExport[] = []

    await createService({ applyImportedArchive: async (value) => { calls.push(value) } }).applyImport(archive, '100')

    expect(calls).toHaveLength(1)
    expect(calls[0].checksum).toBe(archive.checksum)
  })

  it('plans safe recovery as add-only and full recovery as managed removals too', async () => {
    const archive = await createService().exportAccount('100')
    const service = createService()
    const observed = {
      1: { managedLogicalFolderIds: ['bilimi-logical:games'], ordinaryRemoteFolderIds: ['ordinary'] }
    }

    expect(service.createRestorePlan(archive, observed, 'safe').operations).toEqual([
      { aid: 1, desiredLogicalFolderIds: ['bilimi-logical:music'], appendLogicalFolderIds: ['bilimi-logical:music'], removeLogicalFolderIds: [] }
    ])
    expect(service.createRestorePlan(archive, observed, 'full').operations).toEqual([
      { aid: 1, desiredLogicalFolderIds: ['bilimi-logical:music'], appendLogicalFolderIds: ['bilimi-logical:music'], removeLogicalFolderIds: ['bilimi-logical:games'] }
    ])
  })

  it('derives a restore preview from a privileged managed-folder scan instead of renderer observations', async () => {
    const archive = await createService().exportAccount('100')
    const begin = vi.fn(async () => undefined)
    const finish = vi.fn(async () => undefined)
    const readBaseline = vi.fn(async () => ({
      1: {
        managedLogicalFolderIds: ['bilimi-logical:games'],
        managedPhysicalFolderIdsByLogicalFolderId: { 'bilimi-logical:games': ['remote-games'] },
        managedObservedPhysicalFolderIds: ['remote-games']
      }
    }))

    await expect(createService().createRestorePlanFromManagedScan(archive, 'full', {
      begin, finish, readBaseline,
      write: async () => undefined
    })).resolves.toMatchObject({
      mode: 'full',
      operations: [{ aid: 1, appendLogicalFolderIds: ['bilimi-logical:music'], removeLogicalFolderIds: ['bilimi-logical:games'] }]
    })
    expect(begin).toHaveBeenCalledWith({ accountMid: '100', restoreId: expect.stringContaining('archive-restore-preview:') })
    expect(readBaseline).toHaveBeenCalledWith({ accountMid: '100', aid: 1, restoreId: expect.stringContaining('archive-restore-preview:') })
    expect(finish).toHaveBeenCalledWith({ accountMid: '100', restoreId: expect.stringContaining('archive-restore-preview:') })
  })

  it('limits a managed restore preview to an explicit account-scoped aid selection', async () => {
    const archive = await createService().exportAccount('100')
    const readBaseline = vi.fn(async ({ aid }: { aid: number }) => ({
      [aid]: { managedLogicalFolderIds: [], managedPhysicalFolderIdsByLogicalFolderId: { 'bilimi-logical:music': ['remote-music'] }, managedObservedPhysicalFolderIds: [] }
    }))

    const plan = await createService().createRestorePlanFromManagedScan(archive, 'safe', {
      readBaseline, write: async () => undefined
    }, [2])

    expect(plan.operations).toEqual([])
    expect(readBaseline).not.toHaveBeenCalled()
  })

  it('rechecks the physical managed baseline immediately before each queued safe restore and never removes ordinary folders', async () => {
    const archive = await createService().exportAccount('100')
    const plan = createService().createRestorePlan(archive, {
      1: { managedLogicalFolderIds: [] }
    }, 'safe')
    const writes: Array<{ aid: number; appendPhysicalFolderIds: string[]; removePhysicalFolderIds: string[] }> = []
    const checkpoints: Array<{ status: string; targetFolderIds?: string[] }> = []
    const writer: FavoriteRepositoryRestoreWriter = {
      readBaseline: vi.fn(async () => ({
        1: {
          managedLogicalFolderIds: ['bilimi-logical:music'],
          managedPhysicalFolderIdsByLogicalFolderId: {
            'bilimi-logical:music': ['music-1', 'music-2'],
            'bilimi-logical:games': ['games-1']
          },
          managedObservedPhysicalFolderIds: ['music-2', 'ordinary-remote'],
          ordinaryRemoteFolderIds: ['ordinary-remote']
        }
      })),
      write: vi.fn(async (input) => { writes.push(input) })
    }
    const service = createService({
      repository: {
        getSnapshot: async () => snapshot(),
        getEventPage: async () => ({ items: [] }),
        recordSyncCheckpoint: async (_account, _command, record) => { checkpoints.push(record) }
      },
      remoteOperations: new FavoriteRepositoryRemoteOperationArbiter()
    })

    await expect(service.executeRestorePlan(plan, writer)).resolves.toMatchObject({
      status: 'succeeded', completedOperationCount: 1, totalOperationCount: 1,
      items: [{ aid: 1, status: 'succeeded' }]
    })
    expect(writer.readBaseline).toHaveBeenCalledWith({ accountMid: '100', aid: 1, restoreId: expect.any(String) })
    expect(writes).toEqual([])
    expect(checkpoints.map(({ status }) => status)).toEqual(['pending', 'succeeded'])
  })

  it('rejects a physical folder bound to multiple logical ledgers before any restore write regardless of mapping order', async () => {
    const archive = await createService().exportAccount('100')
    const plan = createService().createRestorePlan(archive, { 1: { managedLogicalFolderIds: [] } }, 'safe')
    const writes = vi.fn(async () => undefined)
    const duplicateMaps = [
      { 'bilimi-logical:music': ['remote-1'], 'bilimi-logical:games': ['remote-1'] },
      { 'bilimi-logical:games': ['remote-1'], 'bilimi-logical:music': ['remote-1'] }
    ]

    for (const managedPhysicalFolderIdsByLogicalFolderId of duplicateMaps) {
      const result = await createService().executeRestorePlan(plan, {
        readBaseline: async () => ({
          1: { managedLogicalFolderIds: [], managedPhysicalFolderIdsByLogicalFolderId, managedObservedPhysicalFolderIds: [] }
        }),
        write: writes
      })
      expect(result).toMatchObject({ status: 'failed', items: [{ aid: 1, status: 'failed', reason: expect.stringContaining('multiple logical ledgers') }] })
    }
    expect(writes).not.toHaveBeenCalled()
  })

  it('persists unknown archive writes, skips them on resume, and makes reconciliation a prerequisite for retry', async () => {
    const archive = await createService().exportAccount('100')
    const plan = createService().createRestorePlan(archive, { 1: { managedLogicalFolderIds: [] } }, 'safe')
    const records: any[] = []
    const writer: FavoriteRepositoryRestoreWriter = {
      readBaseline: vi.fn(async () => ({
        1: {
          managedLogicalFolderIds: [],
          managedPhysicalFolderIdsByLogicalFolderId: { 'bilimi-logical:music': ['music-1'] },
          managedObservedPhysicalFolderIds: []
        }
      })),
      write: vi.fn().mockRejectedValueOnce(new Error('connection interrupted')).mockResolvedValue(undefined)
    }
    const service = createService({
      repository: {
        getSnapshot: async () => ({ ...snapshot(), syncRecords: records }),
        getEventPage: async () => ({ items: [] }),
        recordSyncCheckpoint: async (_account, _command, record) => {
          const index = records.findIndex((candidate) => candidate.id === record.id)
          if (index >= 0) records[index] = record
          else records.push(record)
        }
      }
    })

    await expect(service.executeRestorePlan(plan, writer)).resolves.toMatchObject({ status: 'result-unknown' })
    await expect(service.executeRestorePlan(plan, writer)).resolves.toMatchObject({ status: 'result-unknown' })
    expect(writer.write).toHaveBeenCalledTimes(1)

    await expect(service.reconcileRestorePlan(plan, writer)).resolves.toMatchObject({ status: 'failed' })
    await expect(service.executeRestorePlan(plan, writer)).resolves.toMatchObject({ status: 'succeeded' })
    expect(writer.write).toHaveBeenCalledTimes(2)
  })

  it('keeps semantically distinct restore plans from reusing each other\'s completed checkpoints', async () => {
    // These two logical IDs collide under the former 32-bit DJB restore ID.
    // Exercise the public execution path so a collision cannot silently skip
    // a later, different confirmed restore plan.
    const firstPlan = {
      accountMid: '100', mode: 'safe' as const,
      operations: [{
        aid: 1,
        desiredLogicalFolderIds: ['bilimi-logical:collision-2v'],
        appendLogicalFolderIds: ['bilimi-logical:collision-2v'],
        removeLogicalFolderIds: []
      }]
    }
    const secondPlan = {
      accountMid: '100', mode: 'safe' as const,
      operations: [{
        aid: 1,
        desiredLogicalFolderIds: ['bilimi-logical:collision-40'],
        appendLogicalFolderIds: ['bilimi-logical:collision-40'],
        removeLogicalFolderIds: []
      }]
    }
    const records: any[] = []
    const writer: FavoriteRepositoryRestoreWriter = {
      readBaseline: vi.fn(async () => ({
        1: {
          managedLogicalFolderIds: [],
          managedPhysicalFolderIdsByLogicalFolderId: {
            'bilimi-logical:collision-2v': ['collision-2v'],
            'bilimi-logical:collision-40': ['collision-40']
          },
          managedObservedPhysicalFolderIds: []
        }
      })),
      write: vi.fn(async () => undefined)
    }
    const service = createService({
      repository: {
        getSnapshot: async () => ({ ...snapshot(), syncRecords: records }),
        getEventPage: async () => ({ items: [] }),
        recordSyncCheckpoint: async (_account, _command, record) => {
          const index = records.findIndex((candidate) => candidate.id === record.id)
          if (index >= 0) records[index] = record
          else records.push(record)
        }
      }
    })

    const first = await service.executeRestorePlan(firstPlan, writer)
    const second = await service.executeRestorePlan(secondPlan, writer)

    expect(first.id).not.toBe(second.id)
    expect(writer.write).toHaveBeenCalledTimes(2)
    expect(second).toMatchObject({ status: 'succeeded', completedOperationCount: 1 })
  })
})
