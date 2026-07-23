import { describe, expect, it } from 'vitest'
import type { AccountFavoriteRepositorySnapshot, FavoriteRepositoryArchiveExport, FavoriteRepositoryEvent } from '../../src/shared/favoriteRepository'
import { FavoriteRepositoryArchiveService } from './favoriteRepositoryArchiveService'

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
      getEventPage: async (_accountMid, aid) => ({ version: 1, accountMid: '100', revision: 4, items: aid === 1 ? [event] : [] })
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
      { aid: 1, appendLogicalFolderIds: ['bilimi-logical:music'], removeLogicalFolderIds: [] }
    ])
    expect(service.createRestorePlan(archive, observed, 'full').operations).toEqual([
      { aid: 1, appendLogicalFolderIds: ['bilimi-logical:music'], removeLogicalFolderIds: ['bilimi-logical:games'] }
    ])
  })
})
