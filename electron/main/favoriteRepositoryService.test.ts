import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createFavoriteRepositoryArchiveExport,
  createFavoriteRepositoryArchiveExportChecksum,
  type FavoriteRepositoryArchiveExport
} from '../../src/shared/favoriteRepository'
import { FavoriteRepositoryService } from './favoriteRepositoryService'

const roots: string[] = []

async function createRoot() {
  const root = await mkdtemp(join(tmpdir(), 'bilimi-favorite-repository-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('FavoriteRepositoryService', () => {
  it('filters transcription states before pagination with strict account, video, and part identity', async () => {
    const root = await createRoot()
    const queueItems = [
      { id: 'account:100:aid:1:cid:10', accountMid: '100', aid: 1, cid: 10, url: 'https://bilibili.com/1', title: 'Saved and running', status: 'running', createdAt: '', updatedAt: '' },
      { id: 'account:100:aid:2:cid:20', accountMid: '100', aid: 2, cid: 20, url: 'https://bilibili.com/2', title: 'Pending', status: 'pending', createdAt: '', updatedAt: '' },
      { id: 'account:100:aid:3:cid:30', accountMid: '100', aid: 3, cid: 30, url: 'https://bilibili.com/3', title: 'Failed', status: 'failed', createdAt: '', updatedAt: '' },
      { id: 'account:100:aid:1:cid:99', accountMid: '100', aid: 1, cid: 99, url: 'https://bilibili.com/1', title: 'Other part', status: 'failed', createdAt: '', updatedAt: '' },
      { id: 'account:999:aid:1:cid:10', accountMid: '999', aid: 1, cid: 10, url: 'https://bilibili.com/1', title: 'Other account', status: 'failed', createdAt: '', updatedAt: '' },
      { id: 'account:100:aid:5:cid:50', accountMid: '100', aid: 5, cid: 50, url: 'https://bilibili.com/5', title: 'Canceled', status: 'canceled', createdAt: '', updatedAt: '' }
    ]
    const archives = [{
      id: 'archive-1', createdAt: '', updatedAt: '', versions: [{
        id: 'version-1', note: { source: { accountMid: '100', aid: 1, cid: 10 } }
      }],
      source: { accountMid: '100', aid: 1, cid: 10, title: 'Saved and running', url: 'https://bilibili.com/1', tags: [] }
    }, {
      id: 'archive-wrong-part', createdAt: '', updatedAt: '', versions: [],
      source: { accountMid: '100', aid: 2, cid: 99, title: 'Other part', url: 'https://bilibili.com/2', tags: [] }
    }]
    const service = new FavoriteRepositoryService({
      root,
      getTranscriptionItems: () => queueItems,
      getTranscriptionArchives: () => archives as never
    } as never)
    for (const aid of [1, 2, 3, 4, 5]) {
      await service.commit('100', {
        id: `transcription-filter-${aid}`, accountMid: '100', issuedAt: '2026-07-27T00:00:00.000Z', type: 'upsert-video',
        payload: { aid, cid: aid * 10, title: `Video ${aid}`, tags: [], updatedAt: `2026-07-27T00:00:0${aid}.000Z` }
      })
    }

    const page = (transcriptionFilters: string[], limit = 10) => service.getLibraryPage('100', { kind: 'all' }, {
      limit, sort: 'title-asc', transcriptionFilters
    } as never)
    await expect(page(['completed'])).resolves.toMatchObject({ totalCount: 1, items: [{ video: { aid: 1 } }] })
    await expect(page(['running'])).resolves.toMatchObject({ totalCount: 1, items: [{ video: { aid: 1 } }] })
    await expect(page(['pending'])).resolves.toMatchObject({ totalCount: 1, items: [{ video: { aid: 2 } }] })
    await expect(page(['failed'])).resolves.toMatchObject({ totalCount: 1, items: [{ video: { aid: 3 } }] })
    await expect(page(['none'])).resolves.toMatchObject({ totalCount: 2, items: [{ video: { aid: 4 } }, { video: { aid: 5 } }] })
    await expect(page(['completed', 'running'])).resolves.toMatchObject({ totalCount: 1, items: [{ video: { aid: 1 } }] })
    await expect(page([])).resolves.toMatchObject({ totalCount: 5 })
    await expect(page(['none'], 1)).resolves.toMatchObject({ totalCount: 2, items: [{ video: { aid: 4 } }], nextCursor: '1' })
  })

  it('derives completed transcriptions from each archive version source when a BV archive spans accounts and parts', async () => {
    const root = await createRoot()
    const sharedBvid = 'BV1shared'
    const archives = [{
      id: `bvid:${sharedBvid}`,
      // This mutable projection follows the latest write, not every preserved version.
      source: { accountMid: '200', aid: 2, cid: 20, bvid: sharedBvid, title: 'Account 200 part', url: '', tags: [] },
      versions: [{
        id: 'version-account-100-part-10', note: { source: { accountMid: '100', aid: 1, cid: 10, bvid: sharedBvid } }
      }, {
        id: 'version-account-200-part-20', note: { source: { accountMid: '200', aid: 2, cid: 20, bvid: sharedBvid } }
      }],
      createdAt: '', updatedAt: ''
    }]
    const service = new FavoriteRepositoryService({
      root,
      getTranscriptionArchives: () => archives as never
    } as never)
    for (const [accountMid, aid, cid] of [['100', 1, 10], ['200', 2, 20]] as const) {
      await service.commit(accountMid, {
        id: `archive-version-${accountMid}`, accountMid, issuedAt: '2026-07-28T00:00:00.000Z', type: 'upsert-video',
        payload: { aid, cid, bvid: sharedBvid, title: `Account ${accountMid} part`, tags: [], updatedAt: '2026-07-28T00:00:00.000Z' }
      })
    }

    const completed = (accountMid: string) => service.getLibraryPage(accountMid, { kind: 'all' }, {
      limit: 10, transcriptionFilters: ['completed']
    })
    await expect(completed('100')).resolves.toMatchObject({ totalCount: 1, items: [{ video: { aid: 1, cid: 10 } }] })
    await expect(completed('200')).resolves.toMatchObject({ totalCount: 1, items: [{ video: { aid: 2, cid: 20 } }] })
  })

  it('resolves a filtered library selection in the main process without returning every row to the renderer', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-26T00:00:00.000Z' })
    for (const [aid, title] of [[1, 'Needle one'], [2, 'Other'], [3, 'Needle three']] as const) {
      await service.commit('100', {
        id: `selection-video-${aid}`, accountMid: '100', issuedAt: '2026-07-26T00:00:00.000Z', type: 'upsert-video',
        payload: { aid, title, tags: [], updatedAt: '2026-07-26T00:00:00.000Z' }
      })
    }

    await expect(service.resolveLibrarySelection('100', { kind: 'all' }, {
      query: 'needle', sort: 'title-asc'
    }, [3])).resolves.toEqual([1])
  })

  it('filters and sorts the scoped library before cursor pagination', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-24T00:00:00.000Z' })
    for (const [aid, title, updatedAt] of [
      [1, 'Zebra', '2026-07-24T00:00:00.000Z'],
      [2, 'Alpha', '2026-07-23T00:00:00.000Z'],
      [3, 'Needle match', '2026-07-22T00:00:00.000Z']
    ] as const) {
      await service.commit('100', {
        id: `library-row-${aid}`, accountMid: '100', issuedAt: updatedAt, type: 'upsert-video',
        payload: { aid, title, tags: [], updatedAt }
      })
    }

    await expect(service.getLibraryPage('100', { kind: 'all' }, {
      limit: 1, query: 'needle', sort: 'title-asc'
    })).resolves.toMatchObject({ totalCount: 1, items: [{ video: { aid: 3, title: 'Needle match' } }] })
    await expect(service.getLibraryPage('100', { kind: 'all' }, {
      limit: 1, sort: 'title-asc'
    })).resolves.toMatchObject({ totalCount: 3, items: [{ video: { aid: 2, title: 'Alpha' } }], nextCursor: '1' })
    await expect(service.getLibraryPage('100', { kind: 'all' }, {
      limit: 1, sort: 'title-asc', cursor: '1'
    })).resolves.toMatchObject({ items: [{ video: { aid: 3, title: 'Needle match' } }], nextCursor: '2' })
  })

  it('reuses one full updated-date ordering across pages for the same 30k repository revision and query', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root })
    const videos = Object.fromEntries(Array.from({ length: 30_000 }, (_, index) => {
      const aid = index + 1
      return [String(aid), {
        aid, title: `Needle ${aid}`, tags: [], updatedAt: new Date(aid * 1000).toISOString()
      }]
    }))
    ;(service as unknown as { cache: Map<string, unknown> }).cache.set('100', {
      repository: {
        version: 1,
        accountMid: '100',
        snapshot: {
          version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-24T00:00:00.000Z',
          videos, folders: [], memberships: {}, physicalShards: [], syncRecords: [],
          organizationRecords: [], organizationMigrationInitialized: false
        },
        commandResults: {}
      }
    })
    const parse = vi.spyOn(Date, 'parse')

    const first = await service.getLibraryPage('100', { kind: 'all' }, {
      limit: 2, page: 1, query: 'needle', sort: 'updated-desc'
    })
    expect(parse.mock.calls.filter(([value]) => value !== '1970-01-01T00:00:00.000Z').length).toBeGreaterThan(100)
    parse.mockClear()

    const second = await service.getLibraryPage('100', { kind: 'all' }, {
      limit: 2, page: 2, query: 'needle', sort: 'updated-desc'
    })

    expect(parse.mock.calls.filter(([value]) => value !== '1970-01-01T00:00:00.000Z')).toEqual([])
    expect(first.items.map((row) => row.video.aid)).toEqual([30_000, 29_999])
    expect(second.items.map((row) => row.video.aid)).toEqual([29_998, 29_997])
    parse.mockRestore()
  })

  it('keeps ordinary updated-date ordering cached across unrelated queue and archive revisions', async () => {
    const root = await createRoot()
    let queueRevision = 1
    let archiveRevision = 1
    const service = new FavoriteRepositoryService({
      root,
      getTranscriptionRevision: () => queueRevision,
      getTranscriptionArchiveRevision: () => archiveRevision,
      getTranscriptionItems: () => [],
      getTranscriptionArchives: () => []
    })
    for (const aid of [1, 2, 3, 4]) {
      await service.commit('100', {
        id: `unrelated-revision-${aid}`, accountMid: '100', issuedAt: '2026-07-24T00:00:00.000Z', type: 'upsert-video',
        payload: { aid, title: `Video ${aid}`, tags: [], updatedAt: `2026-07-24T00:00:0${aid}.000Z` }
      })
    }
    await service.getLibraryPage('100', { kind: 'all' }, { limit: 2, sort: 'updated-desc' })
    const parse = vi.spyOn(Date, 'parse')
    queueRevision += 1
    archiveRevision += 1

    const page = await service.getLibraryPage('100', { kind: 'all' }, {
      limit: 2, cursor: '2', sort: 'updated-desc'
    })

    expect(parse.mock.calls.filter(([value]) => value !== '1970-01-01T00:00:00.000Z')).toEqual([])
    expect(page.items.map((row) => row.video.aid)).toEqual([2, 1])
    parse.mockRestore()
  })

  it('invalidates a cached library ordering when the repository revision changes', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-24T00:00:00.000Z' })
    for (const aid of [1, 2]) {
      await service.commit('100', {
        id: `cached-revision-${aid}`, accountMid: '100', issuedAt: '2026-07-24T00:00:00.000Z', type: 'upsert-video',
        payload: { aid, title: `Video ${aid}`, tags: [], updatedAt: `2026-07-24T00:00:0${aid}.000Z` }
      })
    }
    await service.getLibraryPage('100', { kind: 'all' }, { limit: 10, sort: 'updated-desc' })
    const parse = vi.spyOn(Date, 'parse')

    await service.commit('100', {
      id: 'cached-revision-3', accountMid: '100', issuedAt: '2026-07-24T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 3, title: 'Video 3', tags: [], updatedAt: '2026-07-24T00:00:03.000Z' }
    })
    const page = await service.getLibraryPage('100', { kind: 'all' }, { limit: 10, sort: 'updated-desc' })

    expect(parse.mock.calls.some(([value]) => value !== '1970-01-01T00:00:00.000Z')).toBe(true)
    expect(page.items.map((row) => row.video.aid)).toEqual([3, 2, 1])
    parse.mockRestore()
  })

  it('keeps search and alternate sort cache entries semantically isolated', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-24T00:00:00.000Z' })
    for (const [aid, title, description] of [
      [1, 'Zulu', 'needle'],
      [2, 'Alpha', 'other'],
      [3, 'Beta', 'needle']
    ] as const) {
      await service.commit('100', {
        id: `cached-semantics-${aid}`, accountMid: '100', issuedAt: '2026-07-24T00:00:00.000Z', type: 'upsert-video',
        payload: { aid, title, description, tags: [], updatedAt: `2026-07-24T00:00:0${aid}.000Z` }
      })
    }

    const titleAscending = await service.getLibraryPage('100', { kind: 'all' }, {
      limit: 10, query: 'needle', sort: 'title-asc'
    })
    const titleDescending = await service.getLibraryPage('100', { kind: 'all' }, {
      limit: 10, query: 'needle', sort: 'title-desc'
    })
    const allTitles = await service.getLibraryPage('100', { kind: 'all' }, {
      limit: 10, sort: 'title-asc'
    })

    expect(titleAscending.items.map((row) => row.video.aid)).toEqual([3, 1])
    expect(titleDescending.items.map((row) => row.video.aid)).toEqual([1, 3])
    expect(allTitles.items.map((row) => row.video.aid)).toEqual([2, 3, 1])
  })

  it('invalidates pending page and selection caches when a sync checkpoint changes without a repository revision', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-24T00:00:00.000Z' })
    await service.commit('100', {
      id: 'checkpoint-cache-video', accountMid: '100', issuedAt: '2026-07-24T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'Video 1', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' }
    })
    await expect(service.getLibraryPage('100', { kind: 'unsynced' }, {
      limit: 10, filter: 'unsynced', sort: 'updated-desc'
    })).resolves.toMatchObject({ items: [] })
    await expect(service.resolveLibrarySelection('100', { kind: 'unsynced' }, {
      filter: 'unsynced', sort: 'updated-desc'
    })).resolves.toEqual([])
    const revision = (await service.getSnapshot('100')).revision

    await service.recordSyncCheckpoint('100', 'checkpoint-cache-failed', {
      id: 'checkpoint-cache-failed', commandId: 'checkpoint-cache-failed', status: 'failed',
      affectedAids: [1], updatedAt: '2026-07-24T00:00:01.000Z'
    })

    await expect(service.getLibraryPage('100', { kind: 'unsynced' }, {
      limit: 10, filter: 'unsynced', sort: 'updated-desc'
    })).resolves.toMatchObject({ revision, items: [{ video: { aid: 1 }, pendingStates: ['failed'] }] })
    await expect(service.resolveLibrarySelection('100', { kind: 'unsynced' }, {
      filter: 'unsynced', sort: 'updated-desc'
    })).resolves.toEqual([1])
  })

  it('does not cache completed or none filters when archives have no reliable revision', async () => {
    const root = await createRoot()
    let archiveReads = 0
    const archives: Array<{ id: string; createdAt: string; updatedAt: string; versions: Array<{ id: string; note: { source: { accountMid: string; aid: number } } }>; source: { accountMid: string; aid: number; title: string; url: string; tags: string[] } }> = []
    const service = new FavoriteRepositoryService({
      root,
      getTranscriptionRevision: () => 1,
      getTranscriptionArchives: () => {
        archiveReads += 1
        return archives as never
      }
    })
    await service.commit('100', {
      id: 'archive-cache-video', accountMid: '100', issuedAt: '2026-07-24T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'Video 1', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' }
    })
    await expect(service.getLibraryPage('100', { kind: 'all' }, {
      limit: 10, transcriptionFilters: ['completed'], sort: 'updated-desc'
    })).resolves.toMatchObject({ items: [] })
    archiveReads = 0
    archives.push({
      id: 'archive-cache-1', createdAt: '', updatedAt: '',
      versions: [{ id: 'archive-version-1', note: { source: { accountMid: '100', aid: 1 } } }],
      source: { accountMid: '100', aid: 1, title: 'Video 1', url: '', tags: [] }
    })

    await expect(service.getLibraryPage('100', { kind: 'all' }, {
      limit: 10, transcriptionFilters: ['completed'], sort: 'updated-desc'
    })).resolves.toMatchObject({ items: [{ video: { aid: 1 } }] })
    expect(archiveReads).toBeGreaterThan(0)
  })

  it('invalidates completed and none filter caches when the archive revision changes', async () => {
    const root = await createRoot()
    let archiveRevision = 1
    const archives: Array<{ id: string; createdAt: string; updatedAt: string; versions: Array<{ id: string; note: { source: { accountMid: string; aid: number } } }>; source: { accountMid: string; aid: number; title: string; url: string; tags: string[] } }> = []
    const service = new FavoriteRepositoryService({
      root,
      getTranscriptionArchiveRevision: () => archiveRevision,
      getTranscriptionArchives: () => archives as never
    })
    await service.commit('100', {
      id: 'archive-revision-video', accountMid: '100', issuedAt: '2026-07-24T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'Video 1', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' }
    })
    await expect(service.getLibraryPage('100', { kind: 'all' }, {
      limit: 10, transcriptionFilters: ['none'], sort: 'updated-desc'
    })).resolves.toMatchObject({ items: [{ video: { aid: 1 } }] })
    archives.push({
      id: 'archive-revision-1', createdAt: '', updatedAt: '',
      versions: [{ id: 'archive-version-1', note: { source: { accountMid: '100', aid: 1 } } }],
      source: { accountMid: '100', aid: 1, title: 'Video 1', url: '', tags: [] }
    })
    archiveRevision += 1

    await expect(service.getLibraryPage('100', { kind: 'all' }, {
      limit: 10, transcriptionFilters: ['none'], sort: 'updated-desc'
    })).resolves.toMatchObject({ items: [] })
    await expect(service.getLibraryPage('100', { kind: 'all' }, {
      limit: 10, transcriptionFilters: ['completed'], sort: 'updated-desc'
    })).resolves.toMatchObject({ items: [{ video: { aid: 1 } }] })
  })

  it('returns an exact local library page and page count without walking cursors', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-24T00:00:00.000Z' })
    for (const aid of [1, 2, 3, 4, 5]) {
      await service.commit('100', {
        id: `page-row-${aid}`, accountMid: '100', issuedAt: '2026-07-24T00:00:00.000Z', type: 'upsert-video',
        payload: { aid, title: `Video ${aid}`, tags: [], updatedAt: `2026-07-24T00:00:0${aid}.000Z` }
      })
    }

    await expect(service.getLibraryPage('100', { kind: 'all' }, { limit: 2, page: 3 }))
      .resolves.toMatchObject({ totalCount: 5, page: 3, pageCount: 3, items: [{ video: { aid: 5 } }] })
  })

  it('treats a cursor as an exact result offset even when it is not aligned to the page limit', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-24T00:00:00.000Z' })
    for (const aid of [1, 2, 3, 4, 5, 6]) {
      await service.commit('100', {
        id: `cursor-offset-${aid}`, accountMid: '100', issuedAt: '2026-07-24T00:00:00.000Z', type: 'upsert-video',
        payload: { aid, title: `Video ${aid}`, tags: [], updatedAt: `2026-07-24T00:00:0${aid}.000Z` }
      })
    }

    await expect(service.getLibraryPage('100', { kind: 'all' }, {
      limit: 2, cursor: '3', sort: 'updated-desc'
    })).resolves.toMatchObject({
      items: [{ video: { aid: 3 } }, { video: { aid: 2 } }],
      nextCursor: '5'
    })
  })

  it('searches video descriptions before globally paginating the library', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-24T00:00:00.000Z' })
    for (const [aid, description] of [[1, 'first page'], [2, 'needle in description']] as const) {
      await service.commit('100', {
        id: `description-row-${aid}`, accountMid: '100', issuedAt: '2026-07-24T00:00:00.000Z', type: 'upsert-video',
        payload: { aid, title: `Video ${aid}`, description, tags: [], updatedAt: `2026-07-24T00:00:0${aid}.000Z` }
      })
    }

    await expect(service.getLibraryPage('100', { kind: 'all' }, { limit: 1, query: 'needle' }))
      .resolves.toMatchObject({ items: [{ video: { aid: 2 } }] })
  })

  it('persists portable audit history, workspace recovery, and reconciliation records in the canonical archive', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-24T00:00:00.000Z' })
    const base = await service.getSnapshot('100')
    const archive = createFavoriteRepositoryArchiveExport({
      ...base,
      workspace: {
        id: 'workspace-1', accountMid: '100', status: 'scanning', baselineRevision: 0, continuationAids: [],
        workspaceRef: { workspaceId: 'workspace-1', accountMid: '100', status: 'scanning', baselineRevision: 0, currentSegmentId: 'segment', overlayRevision: 0, journalCursor: 0, checksum: 'a'.repeat(64), updatedAt: '2026-07-24T00:00:00.000Z' }
      },
      syncRecords: [{ id: 'sync-1', commandId: 'command-1', status: 'result-unknown', affectedAids: [1], updatedAt: '2026-07-24T00:00:00.000Z' }]
    }, {
      generatedAt: '2026-07-24T00:00:00.000Z',
      events: [{ id: 'event-1', sequence: 1, accountMid: '100', aid: 1, kind: 'manual-move', occurredAt: '2026-07-24T00:00:00.000Z' }]
    })

    await service.applyArchiveImport('100', { validate: () => archive, mode: 'overwrite' })
    await expect(service.getPortableAuditEvents('100')).resolves.toEqual([expect.objectContaining({ id: 'event-1' })])
    await expect(service.getPortableWorkspaceRecovery('100')).resolves.toEqual([expect.objectContaining({ id: 'workspace-1' })])
    await expect(service.getPortableRemoteRecoveries('100')).resolves.toEqual([expect.objectContaining({ id: 'sync-1' })])
  })

  it('keeps imported reconciliation-required remote operations pending and actionable after restart', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-24T00:00:00.000Z' })
    const base = await service.getSnapshot('100')
    const archive = createFavoriteRepositoryArchiveExport({
      ...base,
      videos: { '1': { aid: 1, title: 'Imported recovery', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' } },
      syncRecords: [{
        id: 'favorite-remote-unfavorite:imported-operation', commandId: 'imported-operation',
        operationKey: 'favorite-library-unfavorite', status: 'reconciliation-required', autoRetry: false,
        affectedAids: [1], updatedAt: '2026-07-24T00:00:00.000Z'
      }, {
        id: 'managed-folder-delete:imported-folder-delete', commandId: 'imported-folder-delete',
        operationKey: 'managed-folder-delete', status: 'reconciliation-required', autoRetry: false,
        affectedAids: [], targetFolderIds: ['bilimi-logical:work'], updatedAt: '2026-07-24T00:00:00.000Z'
      }]
    }, { generatedAt: '2026-07-24T00:00:00.000Z' })

    await service.applyArchiveImport('100', { validate: () => archive, mode: 'overwrite' })
    const restarted = new FavoriteRepositoryService({ root })

    await expect(restarted.getLibrarySummary('100')).resolves.toMatchObject({
      pendingAidCount: 1,
      syncCounts: { 'result-unknown': 2 },
      remoteReconciliations: [
        { kind: 'unfavorite', operationId: 'imported-operation' },
        { kind: 'managed-folder', operationId: 'imported-folder-delete' }
      ]
    })
    await expect(restarted.getLibraryPage('100', { kind: 'pending' }, { limit: 10 }))
      .resolves.toMatchObject({ items: [{ video: { aid: 1 }, pendingStates: ['result-unknown'] }] })
    await expect(restarted.getPortableRemoteRecoveries('100'))
      .resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'favorite-remote-unfavorite:imported-operation', status: 'reconciliation-required' }),
        expect.objectContaining({ id: 'managed-folder-delete:imported-folder-delete', status: 'reconciliation-required' })
      ]))
  })

  it('deletes only the confirmed account local repository projection', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-24T00:00:00.000Z' })
    for (const accountMid of ['100', '200']) {
      await service.commit(accountMid, {
        id: `video-${accountMid}`, accountMid, issuedAt: '2026-07-24T00:00:00.000Z', type: 'upsert-video',
        payload: { aid: Number(accountMid), title: `Video ${accountMid}`, tags: [], updatedAt: '2026-07-24T00:00:00.000Z' }
      })
    }

    await service.deleteAccountLocalData('100')

    await expect(readFile(join(root, 'accounts', '100', 'repository.manifest.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(service.getSnapshot('200')).resolves.toMatchObject({ accountMid: '200', videos: { '200': expect.any(Object) } })
  })

  it('keeps earlier immutable events when an audited local mutation publishes its generation', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-24T00:00:00.000Z' })
    await service.commit('100', {
      id: 'earlier-event-command', accountMid: '100', issuedAt: '2026-07-24T00:00:00.000Z', type: 'record-favorite-event',
      payload: { id: 'earlier-event', sequence: 1, aid: 1, kind: 'manual-move', occurredAt: '2026-07-24T00:00:00.000Z' }
    })
    const snapshot = await service.getSnapshot('100')

    await service.commitWithAudit('100', {
      id: 'audited-placement', accountMid: '100', issuedAt: '2026-07-24T00:01:00.000Z', expectedRevision: snapshot.revision,
      type: 'set-favorite-placements', payload: { placements: [{ aid: 1, localDesiredFolderIds: [], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], positionState: 'local-only-change', updatedAt: '2026-07-24T00:01:00.000Z' }] }
    }, [{ id: 'audited-event', sequence: 2, aid: 1, kind: 'manual-move', occurredAt: '2026-07-24T00:01:00.000Z' }])

    await expect(service.getEventPage('100', 1, { limit: 10 })).resolves.toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ id: 'earlier-event' }), expect.objectContaining({ id: 'audited-event' })])
    })
  })

  it('recovers every selected account before exposing a partially published portable import after restart', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-24T00:00:00.000Z' })
    for (const accountMid of ['100', '200']) {
      await service.commit(accountMid, {
        id: `existing-${accountMid}`, accountMid, issuedAt: '2026-07-24T00:00:00.000Z', type: 'upsert-video',
        payload: { aid: Number(accountMid), title: `Existing ${accountMid}`, tags: [], updatedAt: '2026-07-24T00:00:00.000Z' }
      })
    }
    const before100 = await service.getSnapshot('100')
    const before200 = await service.getSnapshot('200')
    const imported = createFavoriteRepositoryArchiveExport({
      ...before100,
      videos: { ...before100.videos, '1': { aid: 1, title: 'Imported only', tags: [], updatedAt: '2026-07-24T00:01:00.000Z' } }
    }, { generatedAt: '2026-07-24T00:01:00.000Z' })

    await service.beginPortableImportTransaction(['100', '200'])
    await service.applyArchiveImport('100', { validate: () => imported, mode: 'overwrite' })

    const restarted = new FavoriteRepositoryService({ root })
    // A reader must trigger recovery before it can observe either selected UID.
    await expect(restarted.getSnapshot('100')).resolves.toEqual(before100)
    await expect(restarted.getSnapshot('200')).resolves.toEqual(before200)
  })

  it('does not mutate the repository when archive import validation rejects', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-23T00:00:00.000Z' })
    await service.commit('100', {
      id: 'existing-video', accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'Existing', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }
    })
    const before = await service.getSnapshot('100')

    await expect(service.applyArchiveImport('100', {
      validate: () => { throw new Error('archive checksum is invalid') }
    })).rejects.toThrow('archive checksum is invalid')

    await expect(service.getSnapshot('100')).resolves.toEqual(before)
  })

  it('atomically imports local intent while preserving remote observations and recovering events after restart', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-23T00:00:00.000Z' })
    await service.commit('100', {
      id: 'existing-video', accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 2, title: 'Remote video', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }
    })
    await service.commit('100', {
      id: 'existing-position', accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'set-favorite-placement',
      payload: { aid: 2, localDesiredFolderIds: ['bilimi-logical:old'], remoteObservedPhysicalFolderIds: ['bilibili:900'], remoteObservedLogicalFolderIds: ['bilimi-logical:remote'], positionState: 'failed', updatedAt: '2026-07-23T00:00:00.000Z', reason: 'timeout' }
    })
    const base = await service.getSnapshot('100')
    const archive = createFavoriteRepositoryArchiveExport({
      ...base,
      videos: { '2': { aid: 2, title: 'Imported title', tags: ['saved'], updatedAt: '2026-07-22T00:00:00.000Z' } },
      positions: {
        '100:2': {
          accountMid: '100', aid: 2, localDesiredFolderIds: ['bilimi-logical:new'],
          remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], positionState: 'local-only-change',
          updatedAt: '2026-07-22T00:00:00.000Z', revision: 1
        }
      },
      organizationRecords: [{ accountMid: '100', aid: 2, targetFolderIds: [], completedAt: '2026-07-22T00:00:00.000Z' }]
    }, {
      generatedAt: '2026-07-23T00:00:00.000Z',
      events: [{ id: 'import-event', sequence: 1, accountMid: '100', aid: 2, kind: 'manual-move', occurredAt: '2026-07-22T00:00:00.000Z' }],
      archives: []
    })

    await service.applyArchiveImport('100', { validate: () => archive })
    await service.applyArchiveImport('100', { validate: () => archive })

    await expect(service.getSnapshot('100')).resolves.toMatchObject({
      videos: { '2': { title: 'Imported title', tags: ['saved'] } },
      positions: { '100:2': {
        localDesiredFolderIds: ['bilimi-logical:new'], remoteObservedPhysicalFolderIds: ['bilibili:900'],
        remoteObservedLogicalFolderIds: ['bilimi-logical:remote'], positionState: 'failed', reason: 'timeout'
      } },
      memberships: { 'bilimi-logical:new': [2], 'bilimi-logical:old': [], 'local:inbox': [] }
    })
    const restarted = new FavoriteRepositoryService({ root })
    await expect(restarted.getEventPage('100', 2, { limit: 10 })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: 'import-event' })]
    })
    await expect(readFile(join(root, 'accounts', '100', 'events', '2.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('imports validated recovery records while retaining local remote observations', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-24T00:00:00.000Z' })
    await service.commit('100', {
      id: 'remote-position', accountMid: '100', issuedAt: '2026-07-24T00:00:00.000Z', type: 'set-favorite-placement',
      payload: { aid: 7, localDesiredFolderIds: [], remoteObservedPhysicalFolderIds: ['bilibili:900'], remoteObservedLogicalFolderIds: ['bilimi-logical:remote'], positionState: 'aligned', updatedAt: '2026-07-24T00:00:00.000Z' }
    })
    const base = await service.getSnapshot('100')
    const archive = createFavoriteRepositoryArchiveExport({
      ...base,
      folders: [
        ...base.folders,
        { id: 'bilimi-logical:restored', title: 'Restored', kind: 'bilimi-logical', logicalLedgerId: 'restored', syncState: 'local-only' }
      ],
      memberships: { ...base.memberships, 'bilimi-logical:restored': [7] },
      physicalShards: [{ logicalLedgerId: 'restored', folderId: 'bilimi-logical:restored', shardNumber: 1, remoteTitle: 'Restored', bindingState: 'pending-reconcile' }],
      workspace: undefined,
      syncRecords: [{ id: 'sync-1', commandId: 'command-1', status: 'result-unknown', affectedAids: [7], updatedAt: '2026-07-24T00:00:00.000Z' }],
      organizationRecords: [{ accountMid: '100', aid: 7, targetFolderIds: ['bilimi-logical:restored'], completedAt: '2026-07-24T00:00:00.000Z' }],
      organizationBatches: [],
      organizationMigrationInitialized: true,
      tombstones: { '100:8': { accountMid: '100', aid: 8, deletedAt: '2026-07-24T00:00:00.000Z', allowRediscovery: false } }
    }, { generatedAt: '2026-07-24T00:00:00.000Z' })

    await service.applyArchiveImport('100', { validate: () => archive })

    await expect(service.getSnapshot('100')).resolves.toMatchObject({
      memberships: { 'bilimi-logical:restored': [7] },
      physicalShards: [expect.objectContaining({ logicalLedgerId: 'restored' })],
      syncRecords: [expect.objectContaining({ id: 'sync-1' })],
      organizationRecords: [expect.objectContaining({ aid: 7 })],
      tombstones: { '100:8': expect.objectContaining({ aid: 8 }) },
      positions: { '100:7': expect.objectContaining({ remoteObservedPhysicalFolderIds: ['bilibili:900'] }) }
    })
  })

  it('validates the archive independently when a caller validator lies', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root })
    const archive = createFavoriteRepositoryArchiveExport(await service.getSnapshot('100'), { generatedAt: '2026-07-24T00:00:00.000Z' })
    archive.checksum = '0'.repeat(64)

    await expect(service.applyArchiveImport('100', { validate: () => archive })).rejects.toThrow('checksum')
  })

  it('overwrites imported repository data without importing remote observations', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-24T00:00:00.000Z' })
    await service.commit('100', {
      id: 'local-video', accountMid: '100', issuedAt: '2026-07-24T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'Local only', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' }
    })
    await service.commit('100', {
      id: 'local-remote-observation', accountMid: '100', issuedAt: '2026-07-24T00:00:00.000Z', type: 'set-favorite-placement',
      payload: { aid: 1, localDesiredFolderIds: [], remoteObservedPhysicalFolderIds: ['bilibili:900'], remoteObservedLogicalFolderIds: [], positionState: 'aligned', updatedAt: '2026-07-24T00:00:00.000Z' }
    })
    const source = await service.getSnapshot('200')
    const archive = createFavoriteRepositoryArchiveExport({
      ...source,
      videos: { '2': { aid: 2, title: 'Imported only', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' } }
    }, { generatedAt: '2026-07-24T00:00:00.000Z' })
    archive.accountMid = '100'
    archive.checksum = createFavoriteRepositoryArchiveExportChecksum(archive)

    await service.applyArchiveImport('100', { validate: () => archive, mode: 'overwrite' })

    await expect(service.getSnapshot('100')).resolves.toMatchObject({
      videos: { '2': expect.objectContaining({ title: 'Imported only' }) }, positions: {}
    })
    await expect(service.getSnapshot('100')).resolves.not.toMatchObject({ videos: { '1': expect.anything() } })
  })

  it('overwrite replaces old portable audit history instead of retaining it', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-24T00:00:00.000Z' })
    const base = await service.getSnapshot('100')
    const oldArchive = createFavoriteRepositoryArchiveExport(base, {
      generatedAt: '2026-07-24T00:00:00.000Z',
      events: [{ id: 'old-event', sequence: 1, accountMid: '100', aid: 1, kind: 'manual-move', occurredAt: '2026-07-24T00:00:00.000Z' }]
    })
    await service.applyArchiveImport('100', { validate: () => oldArchive, mode: 'overwrite' })
    const replacement = createFavoriteRepositoryArchiveExport(await service.getSnapshot('100'), {
      generatedAt: '2026-07-24T00:01:00.000Z',
      events: [{ id: 'new-event', sequence: 1, accountMid: '100', aid: 2, kind: 'manual-move', occurredAt: '2026-07-24T00:01:00.000Z' }]
    })

    await service.applyArchiveImport('100', { validate: () => replacement, mode: 'overwrite' })
    await expect(service.getPortableAuditEvents('100')).resolves.toEqual([expect.objectContaining({ id: 'new-event' })])
  })

  it('applies imported tombstones as authoritative local deletions instead of leaving library rows visible', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-24T00:00:00.000Z' })
    const base = await service.getSnapshot('100')
    const archive = createFavoriteRepositoryArchiveExport({
      ...base,
      videos: { '7': { aid: 7, title: 'Deleted import', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' } },
      positions: { '100:7': { accountMid: '100', aid: 7, localDesiredFolderIds: ['bilimi-logical:music'], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], positionState: 'local-only-change', updatedAt: '2026-07-24T00:00:00.000Z', revision: 1 } },
      folders: [...base.folders, { id: 'bilimi-logical:music', title: 'Music', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'pending-reconcile' }],
      memberships: { ...base.memberships, 'bilimi-logical:music': [7] },
      tombstones: { '100:7': { accountMid: '100', aid: 7, deletedAt: '2026-07-24T01:00:00.000Z', allowRediscovery: false } }
    }, { generatedAt: '2026-07-24T01:00:00.000Z' })

    await service.applyArchiveImport('100', { validate: () => archive })

    await expect(service.getSnapshot('100')).resolves.toMatchObject({
      videos: {}, positions: {}, memberships: { 'bilimi-logical:music': [] }, tombstones: { '100:7': expect.any(Object) }
    })
  })

  it('keeps a rediscoverable tombstone visible after archive import', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-24T00:00:00.000Z' })
    const base = await service.getSnapshot('100')
    const archive = createFavoriteRepositoryArchiveExport({
      ...base,
      videos: { '8': { aid: 8, title: 'Can rediscover', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' } },
      tombstones: { '100:8': { accountMid: '100', aid: 8, deletedAt: '2026-07-24T01:00:00.000Z', allowRediscovery: true } }
    }, { generatedAt: '2026-07-24T01:00:00.000Z' })

    await service.applyArchiveImport('100', { validate: () => archive })

    await expect(service.getSnapshot('100')).resolves.toMatchObject({ videos: { '8': expect.objectContaining({ title: 'Can rediscover' }) } })
  })

  it('rejects a cross-account archive event before any local snapshot, receipt, or event projection is published', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-23T00:00:00.000Z' })
    const before = await service.getSnapshot('100')
    const archive = createFavoriteRepositoryArchiveExport(before, { generatedAt: '2026-07-23T01:00:00.000Z' })
    archive.events = [{ id: 'foreign-event', sequence: 1, accountMid: '200', aid: 1, kind: 'manual-move', occurredAt: '2026-07-23T00:30:00.000Z' }]

    await expect(service.applyArchiveImport('100', { validate: () => archive })).rejects.toThrow('event account mismatch')
    await expect(service.getSnapshot('100')).resolves.toEqual(before)
    await expect(service.getEventPage('100', 1, { limit: 10 })).resolves.toMatchObject({ items: [] })
  })

  it('keeps archive snapshot, receipt, and staged user events invisible when generation publication fails', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-23T00:00:00.000Z' })
    const before = await service.getSnapshot('100')
    const archive = createFavoriteRepositoryArchiveExport({
      ...before,
      videos: { '1': { aid: 1, title: 'Imported', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' } }
    }, {
      generatedAt: '2026-07-23T01:00:00.000Z',
      events: [{ id: 'staged-event', sequence: 1, accountMid: '100', aid: 1, kind: 'manual-move', occurredAt: '2026-07-23T00:30:00.000Z' }]
    })
    vi.spyOn(service as never as { persist: () => Promise<never> }, 'persist').mockRejectedValueOnce(new Error('event append failed'))

    await expect(service.applyArchiveImport('100', { validate: () => archive })).rejects.toThrow('event append failed')
    await expect(service.getSnapshot('100')).resolves.toEqual(before)
    await expect(service.getEventPage('100', 1, { limit: 10 })).resolves.toMatchObject({ items: [] })
  })

  it('counts only actionable placement and remote-operation work as pending', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-23T00:00:00.000Z' })
    for (const aid of [1, 2, 3, 4]) {
      await service.commit('100', {
        id: `video-${aid}`, accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'upsert-video',
        payload: { aid, title: `Video ${aid}`, tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }
      })
    }
    await service.commit('100', {
      id: 'metadata-only', accountMid: '100', issuedAt: '2026-07-23T00:00:01.000Z', type: 'record-library-mirror',
      payload: { aid: 1, status: 'failed', metadataRevision: 1 }
    })
    for (const [aid, positionState] of [[2, 'local-only-change'], [3, 'failed'], [4, 'result-unknown']] as const) {
      await service.commit('100', {
        id: `position-${aid}`, accountMid: '100', issuedAt: '2026-07-23T00:00:02.000Z', type: 'set-favorite-placement',
        payload: { aid, localDesiredFolderIds: [], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], positionState, updatedAt: '2026-07-23T00:00:02.000Z' }
      })
    }
    await service.recordSyncCheckpoint('100', 'same-aid-pending', {
      id: 'same-aid-pending', commandId: 'same-aid-pending', status: 'pending', affectedAids: [2], updatedAt: '2026-07-23T00:00:03.000Z'
    })

    await expect(service.getLibrarySummary('100')).resolves.toMatchObject({ pendingAidCount: 3 })
    await expect(service.getLibraryPage('100', { kind: 'pending' }, { limit: 10 })).resolves.toMatchObject({
      items: [{ video: { aid: 2 } }, { video: { aid: 3 } }, { video: { aid: 4 } }]
    })
  })

  it('recovers an event receipt after restart so a command retry does not append another event', async () => {
    const root = await createRoot()
    const command = {
      id: 'event-command-1', accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'record-favorite-event' as const,
      payload: { id: 'event-1', sequence: 1, aid: 1, kind: 'manual-move' as const, occurredAt: '2026-07-23T00:00:00.000Z' }
    }
    const first = new FavoriteRepositoryService({ root, now: () => '2026-07-23T00:00:00.000Z' })
    await first.commit('100', command)

    const restarted = new FavoriteRepositoryService({ root, now: () => '2026-07-23T00:01:00.000Z' })
    await restarted.commit('100', { ...command, issuedAt: '2026-07-23T00:01:00.000Z' })

    const eventLines = (await readFile(join(root, 'accounts', '100', 'events', '1.jsonl'), 'utf8')).trim().split('\n')
    expect(eventLines).toHaveLength(1)
    await expect(restarted.getEventPage('100', 1, { limit: 10 })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: 'event-1' })]
    })
  })

  it('recovers a batch event receipt after restart without duplicating any selected-row audit', async () => {
    const root = await createRoot()
    const command = {
      id: 'batch-event-command-1', accountMid: '100', issuedAt: '2026-07-24T00:00:00.000Z', type: 'record-favorite-events' as const,
      payload: { events: [
        { id: 'batch-event-1', sequence: 1, aid: 1, kind: 'manual-move' as const, occurredAt: '2026-07-24T00:00:00.000Z' },
        { id: 'batch-event-2', sequence: 2, aid: 2, kind: 'manual-move' as const, occurredAt: '2026-07-24T00:00:00.000Z' }
      ] }
    }
    const first = new FavoriteRepositoryService({ root, now: () => '2026-07-24T00:00:00.000Z' })
    await first.commit('100', command)

    const restarted = new FavoriteRepositoryService({ root, now: () => '2026-07-24T00:01:00.000Z' })
    await restarted.commit('100', { ...command, issuedAt: '2026-07-24T00:01:00.000Z' })

    for (const [aid, eventId] of [[1, 'batch-event-1'], [2, 'batch-event-2']] as const) {
      const lines = (await readFile(join(root, 'accounts', '100', 'events', `${aid}.jsonl`), 'utf8')).trim().split('\n')
      expect(lines).toHaveLength(1)
      expect(JSON.parse(lines[0])).toMatchObject({ id: eventId, aid })
    }
  })

  it('keeps protected organization separate from a failed placement in the library detail', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-23T00:00:00.000Z' })

    await service.commit('100', {
      id: 'video', accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'Video 1', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }
    })
    await service.commit('100', {
      id: 'protected', accountMid: '100', issuedAt: '2026-07-23T00:00:01.000Z', type: 'record-organization-protections',
      payload: { records: [{ accountMid: '100', aid: 1, targetFolderIds: ['legacy-folder'], completedAt: '2026-07-23T00:00:01.000Z' }] }
    })
    await service.commit('100', {
      id: 'placement', accountMid: '100', issuedAt: '2026-07-23T00:00:02.000Z', type: 'set-favorite-placement',
      payload: {
        aid: 1, localDesiredFolderIds: ['bilimi-logical:music'], remoteObservedPhysicalFolderIds: [],
        remoteObservedLogicalFolderIds: [], positionState: 'failed', updatedAt: '2026-07-23T00:00:02.000Z'
      }
    })

    await expect(service.getLibraryDetail('100', 1)).resolves.toMatchObject({
      protected: true,
      position: { state: 'failed', localDesiredFolderIds: ['bilimi-logical:music'] }
    })
    await expect(service.getLibrarySummary('100')).resolves.toMatchObject({ pendingAidCount: 1 })
  })

  it('derives sync, protection, and organization from independent repository facts', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-08-02T00:00:00.000Z' })
    for (const aid of [1, 2, 3, 4]) {
      await service.commit('100', {
        id: `state-video-${aid}`, accountMid: '100', issuedAt: '2026-08-02T00:00:00.000Z', type: 'upsert-video',
        payload: { aid, title: `State video ${aid}`, tags: [], updatedAt: '2026-08-02T00:00:00.000Z' }
      })
    }
    await service.commit('100', {
      id: 'state-protection', accountMid: '100', issuedAt: '2026-08-02T00:00:01.000Z', type: 'record-organization-protections',
      payload: { records: [{ accountMid: '100', aid: 1, targetFolderIds: [], completedAt: '2026-08-02T00:00:01.000Z' }] }
    })
    await service.commit('100', {
      id: 'state-work-folder', accountMid: '100', issuedAt: '2026-08-02T00:00:02.000Z', type: 'upsert-physical-shard-binding',
      payload: {
        logicalLedgerId: 'music', logicalTitle: 'bilimi·音乐', shardNumber: 1, memberAids: [2],
        remoteTitle: 'bilimi·音乐', bindingState: 'bound', remoteFolderId: '900'
      }
    })
    await service.commit('100', {
      id: 'state-work-members', accountMid: '100', issuedAt: '2026-08-02T00:00:03.000Z', type: 'set-folder-members',
      payload: { folderId: 'bilimi-logical:music', aids: [2] }
    })
    await service.commit('100', {
      id: 'state-aligned-position', accountMid: '100', issuedAt: '2026-08-02T00:00:04.000Z', type: 'set-favorite-placement',
      payload: {
        aid: 2,
        localDesiredFolderIds: ['bilimi-logical:music'],
        remoteObservedPhysicalFolderIds: ['bilibili:900'],
        remoteObservedLogicalFolderIds: ['bilimi-logical:music'],
        positionState: 'aligned',
        updatedAt: '2026-08-02T00:00:04.000Z'
      }
    })
    await service.commit('100', {
      id: 'state-ordinary-source', accountMid: '100', issuedAt: '2026-08-02T00:00:05.000Z', type: 'record-bilibili-mirror',
      payload: {
        workspaceId: 'state-workspace',
        memberAidsByFolderId: { 'bilibili:901': [3] },
        folders: [{ id: 'bilibili:901', title: '普通用户收藏夹', remoteFolderId: '901' }],
        videos: [1, 2, 3, 4].map((aid) => ({ aid, title: `State video ${aid}`, tags: [], updatedAt: '2026-08-02T00:00:05.000Z' }))
      }
    })
    await service.commit('100', {
      id: 'state-inbox-members', accountMid: '100', issuedAt: '2026-08-02T00:00:06.000Z', type: 'set-folder-members',
      payload: { folderId: 'local:inbox', aids: [1, 4] }
    })

    await expect(service.getLibraryPage('100', { kind: 'all' }, { limit: 10, sort: 'title-asc' })).resolves.toMatchObject({
      items: [
        { video: { aid: 1 }, libraryStates: { sync: 'unsynced', protection: 'protected', organization: 'unorganized' } },
        { video: { aid: 2 }, libraryStates: { sync: 'synced', protection: 'unprotected', organization: 'organized' } },
        { video: { aid: 3 }, libraryStates: { sync: 'unsynced', protection: 'unprotected', organization: 'unorganized' } },
        { video: { aid: 4 }, libraryStates: { sync: 'unsynced', protection: 'unprotected', organization: 'unorganized' } }
      ]
    })
    await expect(service.getLibraryDetail('100', 1)).resolves.toMatchObject({
      libraryStates: { sync: 'unsynced', protection: 'protected', organization: 'unorganized' }
    })
    await expect(service.getLibraryDetail('100', 4)).resolves.toMatchObject({
      libraryStates: { sync: 'unsynced', protection: 'unprotected', organization: 'unorganized' }
    })
    await expect(service.getLibraryPage('100', { kind: 'all' }, {
      limit: 10,
      sort: 'title-asc',
      stateFilters: { sync: 'unsynced', protection: 'unprotected', organization: 'unorganized' }
    } as never)).resolves.toMatchObject({
      totalCount: 2,
      items: [{ video: { aid: 3 } }, { video: { aid: 4 } }]
    })
    await expect(service.resolveLibrarySelection('100', { kind: 'all' }, {
      sort: 'title-asc', stateFilters: { protection: 'protected' }
    } as never)).resolves.toEqual([1])
  })

  it('reapplies an authoritative workspace transition when a retained command result no longer matches', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-23T00:00:00.000Z' })
    const workspace = (status: 'reconciling' | 'frozen') => ({
      id: 'workspace-1', accountMid: '100', status, baselineRevision: 1, continuationAids: [],
      workspaceRef: {
        workspaceId: 'workspace-1', accountMid: '100', status, baselineRevision: 1,
        currentSegmentId: '', overlayRevision: 0, journalCursor: 0, checksum: 'a'.repeat(64)
      },
      frozenSyncPlan: {
        id: 'run-1', workspaceId: 'workspace-1', accountMid: '100', baselineRevision: 1,
        createdAt: '2026-07-23T00:00:00.000Z',
        operations: [{ operationKey: 'append:1', kind: 'append' as const, aid: 1, folderIds: ['remote-1'] }]
      }
    })
    const command = {
      id: 'favorite-sync-workspace:workspace-1:reconciled:run-1', accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z',
      type: 'set-workspace' as const, payload: workspace('reconciling')
    }

    await service.commit('100', command)
    await service.commit('100', {
      ...command,
      payload: workspace('frozen')
    })

    await expect(service.getSnapshot('100')).resolves.toMatchObject({ workspace: { status: 'frozen' } })
  })

  it('loads only the requested account and stores folder membership as aid indexes', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })

    await service.commit('100', {
      id: 'video-1', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'A', tags: [], updatedAt: '2026-07-19T00:00:00.000Z' }
    })
    await service.commit('100', {
      id: 'members-1', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-folder-members',
      payload: { folderId: 'local:inbox', aids: [1] }
    })

    expect((await service.getFolderPage('100', 'local:inbox', { limit: 10 })).items.map((item) => item.aid)).toEqual([1])
    await expect(service.getSnapshot('200')).resolves.toMatchObject({ accountMid: '200', videos: {} })
    const manifest = JSON.parse(await readFile(join(root, 'accounts', '100', 'repository.manifest.json'), 'utf8')) as { generation: string }
    expect(await readFile(join(root, 'accounts', '100', 'generations', manifest.generation, 'memberships.jsonl'), 'utf8'))
      .toContain('{"folderId":"local:inbox","aids":[1]}')
  })

  it('recovers a valid atomic temporary snapshot after an interrupted commit', async () => {
    const root = await createRoot()
    const first = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    await first.commit('100', {
      id: 'video-1', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'Recovered', tags: [], updatedAt: '2026-07-19T00:00:00.000Z' }
    })
    const manifestPath = join(root, 'accounts', '100', 'repository.manifest.json')
    const persisted = await readFile(manifestPath, 'utf8')
    await writeFile(`${manifestPath}.tmp`, persisted, 'utf8')
    await writeFile(manifestPath, '{not-json', 'utf8')

    await expect(new FavoriteRepositoryService({ root }).getSnapshot('100')).resolves.toMatchObject({
      accountMid: '100', revision: 1, videos: { '1': { title: 'Recovered' } }
    })
  })

  it('rejects a generation when its JSONL content no longer matches the committed manifest checksum', async () => {
    const root = await createRoot()
    const first = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    await first.commit('100', {
      id: 'video-1', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'Verified', tags: [], updatedAt: '2026-07-19T00:00:00.000Z' }
    })

    const accountDirectory = join(root, 'accounts', '100')
    const manifest = JSON.parse(await readFile(join(accountDirectory, 'repository.manifest.json'), 'utf8')) as { generation: string }
    await writeFile(join(accountDirectory, 'generations', manifest.generation, 'videos.jsonl'), '{"aid":999}\n', 'utf8')

    await expect(new FavoriteRepositoryService({ root }).getSnapshot('100')).resolves.toMatchObject({
      accountMid: '100', revision: 0, videos: {}
    })
  })

  it('rolls back only to the previous complete generation when the active generation is corrupt', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    await service.commit('100', {
      id: 'video-1', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'First', tags: [], updatedAt: '2026-07-19T00:00:00.000Z' }
    })
    await service.commit('100', {
      id: 'video-2', accountMid: '100', issuedAt: '2026-07-19T00:00:01.000Z', type: 'upsert-video',
      payload: { aid: 2, title: 'Second', tags: [], updatedAt: '2026-07-19T00:00:01.000Z' }
    })

    const accountDirectory = join(root, 'accounts', '100')
    const manifest = JSON.parse(await readFile(join(accountDirectory, 'repository.manifest.json'), 'utf8')) as { generation: string }
    await writeFile(join(accountDirectory, 'generations', manifest.generation, 'memberships.jsonl'), '{"folderId":"broken","aids":[2]}\n', 'utf8')

    await expect(new FavoriteRepositoryService({ root }).getSnapshot('100')).resolves.toMatchObject({
      accountMid: '100', revision: 1, videos: { '1': { title: 'First' } }
    })
  })

  it('returns an equivalent result when the same command is replayed', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    const command = {
      id: 'video-1', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-video' as const,
      payload: { aid: 1, title: 'Original', tags: [], updatedAt: '2026-07-19T00:00:00.000Z' }
    }

    const first = await service.commit('100', command)
    const replay = await service.commit('100', command)

    expect(replay).toEqual(first)
    expect((await service.getSnapshot('100')).videos['1'].title).toBe('Original')
  })

  it('treats a retry timestamp as non-semantic command metadata', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    const command = {
      id: 'video-1', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-video' as const,
      payload: { aid: 1, title: 'Original', tags: [], updatedAt: '2026-07-19T00:00:00.000Z' }
    }
    const first = await service.commit('100', command)

    await expect(service.commit('100', { ...command, issuedAt: '2026-07-19T00:01:00.000Z' })).resolves.toEqual(first)
  })

  it('treats reordered semantic command payload keys as the same retry', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    const first = await service.commit('100', {
      id: 'video-1', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'Original', tags: [], updatedAt: '2026-07-19T00:00:00.000Z' }
    })

    await expect(service.commit('100', {
      id: 'video-1', accountMid: '100', issuedAt: '2026-07-19T00:01:00.000Z', type: 'upsert-video',
      payload: { updatedAt: '2026-07-19T00:00:00.000Z', tags: [], title: 'Original', aid: 1 }
    })).resolves.toEqual(first)
  })

  it('rejects reuse of a command id with different command content', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    const command = {
      id: 'video-1', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-video' as const,
      payload: { aid: 1, title: 'Original', tags: [], updatedAt: '2026-07-19T00:00:00.000Z' }
    }

    await service.commit('100', command)

    await expect(service.commit('100', { ...command, payload: { ...command.payload, title: 'Different' } }))
      .rejects.toThrow('command id conflict')
    expect((await service.getSnapshot('100')).videos['1'].title).toBe('Original')
  })

  it('aggregates logical, physical, and bound remote folders in the Favorite Library read model', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-23T00:00:00.000Z' })
    for (const aid of [1, 2, 3]) {
      await service.commit('100', {
        id: `video-${aid}`, accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'upsert-video',
        payload: { aid, title: `Video ${aid}`, tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }
      })
    }
    await service.commit('100', {
      id: 'music-binding', accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'upsert-physical-shard-binding',
      payload: {
        logicalLedgerId: 'music', logicalTitle: 'bilimi·音乐', shardNumber: 1, memberAids: [1, 2],
        remoteTitle: 'bilimi·音乐', bindingState: 'bound', remoteFolderId: '3990843511'
      }
    })
    await service.commit('100', {
      id: 'music-logical-members', accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'set-folder-members',
      payload: { folderId: 'bilimi-logical:music', aids: [1] }
    })
    await service.commit('100', {
      id: 'film-binding', accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'upsert-physical-shard-binding',
      payload: {
        logicalLedgerId: 'film', logicalTitle: 'bilimi·影视', shardNumber: 1, memberAids: [2, 3],
        remoteTitle: 'bilimi·影视', bindingState: 'bound', remoteFolderId: '3990843512'
      }
    })
    await service.commit('100', {
      id: 'source-mirror', accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'record-bilibili-mirror',
      payload: {
        workspaceId: 'workspace-1',
        memberAidsByFolderId: { 'bilibili:3990843511': [2, 3] },
        folders: [{ id: 'bilibili:3990843511', title: 'bilimi·音乐', remoteFolderId: '3990843511' }],
        videos: [1, 2, 3].map((aid) => ({ aid, title: `Video ${aid}`, tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }))
      }
    })

    const summary = await service.getLibrarySummary('100')
    expect(summary.folderCount).toBe(2)
    expect(summary.workspaceVideoCount).toBe(3)
    expect(summary.folders).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'bilimi-logical:music', kind: 'bilimi-logical', logicalLedgerId: 'music' }),
      expect.objectContaining({ id: 'bilimi-logical:film', kind: 'bilimi-logical', logicalLedgerId: 'film' })
    ]))
    await expect(service.getLibraryPage('100', { kind: 'folder', folderId: 'bilimi-logical:music' }, { limit: 10 }))
      .resolves.toMatchObject({
        items: [
          { video: { aid: 1 }, folderIds: ['bilimi-logical:music'] },
          { video: { aid: 2 }, folderIds: expect.arrayContaining(['bilimi-logical:music']) },
          { video: { aid: 3 }, folderIds: expect.arrayContaining(['bilimi-logical:music']) }
        ]
    })
    await expect(service.getLibraryDetail('100', 3)).resolves.toMatchObject({ folderIds: expect.arrayContaining(['bilimi-logical:music']) })
    await expect(service.resolveArchiveRestoreLogicalFolderAids('100', 'bilimi-logical:music')).resolves.toEqual([1, 2, 3])
  })

  it('rejects non-logical, unbound, and conflicted logical archive restore scopes with an actionable reason', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-23T00:00:00.000Z' })
    await expect(service.resolveArchiveRestoreLogicalFolderAids('100', 'local:inbox')).rejects.toThrow('Bilimi logical folder')
    await service.commit('100', {
      id: 'pending-music', accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'upsert-physical-shard-binding',
      payload: { logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber: 1, memberAids: [], remoteTitle: 'Music', bindingState: 'pending-reconcile' }
    })
    await expect(service.resolveArchiveRestoreLogicalFolderAids('100', 'bilimi-logical:music')).rejects.toThrow('currently bound')
    for (const logicalLedgerId of ['games', 'music']) {
      await service.commit('100', {
        id: `bound-${logicalLedgerId}`, accountMid: '100', issuedAt: '2026-07-23T00:01:00.000Z', type: 'upsert-physical-shard-binding',
        payload: { logicalLedgerId, logicalTitle: logicalLedgerId === 'music' ? 'Music' : logicalLedgerId, shardNumber: 1, memberAids: [], remoteTitle: 'Shared', bindingState: 'bound', remoteFolderId: 'shared-remote' }
      })
    }
    await expect(service.resolveArchiveRestoreLogicalFolderAids('100', 'bilimi-logical:music')).rejects.toThrow('conflicting')
  })

  it('resolves every deduplicated member across multiple bound logical shards and their canonical mirrors for archive restore', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-23T00:00:00.000Z' })
    for (const aid of [1, 2, 3, 4]) {
      await service.commit('100', {
        id: `video-${aid}`, accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'upsert-video',
        payload: { aid, title: `Video ${aid}`, tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }
      })
    }
    for (const [shardNumber, remoteFolderId, memberAids] of [[1, 'music-1', [1, 2]], [2, 'music-2', [2, 3]]] as const) {
      await service.commit('100', {
        id: `music-shard-${shardNumber}`, accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'upsert-physical-shard-binding',
        payload: { logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber, memberAids, remoteTitle: `Music ${shardNumber}`, bindingState: 'bound', remoteFolderId }
      })
    }
    await service.commit('100', {
      id: 'bound-mirror-members', accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'record-bilibili-mirror',
      payload: {
        workspaceId: 'workspace',
        folders: [{ id: 'bilibili:music-1', title: 'Music 1', remoteFolderId: 'music-1' }, { id: 'bilibili:music-2', title: 'Music 2', remoteFolderId: 'music-2' }],
        memberAidsByFolderId: { 'bilibili:music-1': [3, 4], 'bilibili:music-2': [1, 4] },
        videos: [1, 2, 3, 4].map((aid) => ({ aid, title: `Video ${aid}`, tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }))
      }
    })

    await expect(service.resolveArchiveRestoreLogicalFolderAids('100', 'bilimi-logical:music')).resolves.toEqual([1, 2, 3, 4])
  })

  it('publishes canonical folder ids when a raw bound folder changes', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-23T00:00:00.000Z' })
    await service.commit('100', {
      id: 'music-binding', accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'upsert-physical-shard-binding',
      payload: {
        logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber: 1, memberAids: [], remoteTitle: 'Music',
        bindingState: 'bound', remoteFolderId: '3990843511'
      }
    })
    const changes: string[][] = []
    service.onChanged((result) => changes.push(result.affectedFolderIds))

    await service.commit('100', {
      id: 'source-mirror', accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'record-bilibili-mirror',
      payload: {
        workspaceId: 'workspace-1', memberAidsByFolderId: { 'bilibili:3990843511': [1] },
        folders: [{ id: 'bilibili:3990843511', title: 'Music', remoteFolderId: '3990843511' }],
        videos: [{ aid: 1, title: 'Video 1', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }]
      }
    })

    expect(changes.at(-1)).toContain('bilimi-logical:music')
  })

  it('publishes canonical invalidation for both sides when a mirror binding is replaced', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-23T00:00:00.000Z' })
    for (const [ledger, remote] of [['music', '1'], ['games', '2']] as const) {
      await service.commit('100', {
        id: `binding-${ledger}`, accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'upsert-physical-shard-binding',
        payload: { logicalLedgerId: ledger, logicalTitle: ledger, shardNumber: 1, memberAids: [], remoteTitle: ledger, bindingState: 'bound', remoteFolderId: remote }
      })
    }
    const changes: string[][] = []
    service.onChanged((result) => changes.push(result.affectedFolderIds))

    await service.commit('100', {
      id: 'mirror-one', accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'record-bilibili-mirror',
      payload: { workspaceId: 'workspace-1', folders: [{ id: 'bilibili:1', title: 'Music', remoteFolderId: '1' }], memberAidsByFolderId: { 'bilibili:1': [1] }, videos: [{ aid: 1, title: 'One', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }] }
    })
    await service.commit('100', {
      id: 'mirror-two', accountMid: '100', issuedAt: '2026-07-23T00:01:00.000Z', type: 'record-bilibili-mirror',
      payload: { workspaceId: 'workspace-1', folders: [{ id: 'bilibili:2', title: 'Games', remoteFolderId: '2' }], memberAidsByFolderId: { 'bilibili:2': [1] }, videos: [{ aid: 1, title: 'One', tags: [], updatedAt: '2026-07-23T00:01:00.000Z' }] }
    })

    expect(changes.at(-1)).toEqual(expect.arrayContaining(['bilimi-logical:music', 'bilimi-logical:games']))
  })

  it('publishes the former canonical logical folder when clearing a mirror', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-23T00:00:00.000Z' })
    await service.commit('100', {
      id: 'binding', accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'upsert-physical-shard-binding',
      payload: { logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber: 1, memberAids: [], remoteTitle: 'Music', bindingState: 'bound', remoteFolderId: '1' }
    })
    await service.commit('100', {
      id: 'mirror', accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'record-bilibili-mirror',
      payload: { workspaceId: 'workspace-1', folders: [{ id: 'bilibili:1', title: 'Music', remoteFolderId: '1' }], memberAidsByFolderId: { 'bilibili:1': [1] }, videos: [{ aid: 1, title: 'One', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }] }
    })
    const changes: string[][] = []
    service.onChanged((result) => changes.push(result.affectedFolderIds))

    await service.commit('100', { id: 'clear', accountMid: '100', issuedAt: '2026-07-23T00:01:00.000Z', type: 'clear-bilibili-mirror', payload: {} })

    expect(changes.at(-1)).toContain('bilimi-logical:music')
  })

  it('does not invent a canonical invalidation for an unbound mirror replacement', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-23T00:00:00.000Z' })
    const changes: string[][] = []
    service.onChanged((result) => changes.push(result.affectedFolderIds))

    await service.commit('100', {
      id: 'mirror', accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'record-bilibili-mirror',
      payload: { workspaceId: 'workspace-1', folders: [{ id: 'bilibili:9', title: 'Unbound', remoteFolderId: '9' }], memberAidsByFolderId: { 'bilibili:9': [1] }, videos: [{ aid: 1, title: 'One', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }] }
    })

    expect(changes.at(-1)).toEqual(['bilibili:9'])
  })

  it('lists the actual source shards for a logical folder detail', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-23T00:00:00.000Z' })
    for (const shardNumber of [1, 2]) {
      await service.commit('100', {
        id: `music-${shardNumber}`, accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'upsert-physical-shard-binding',
        payload: { logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber, memberAids: [shardNumber], remoteTitle: `Music ${shardNumber}`,
          bindingState: 'bound', remoteFolderId: String(shardNumber) }
      })
    }
    await service.commit('100', {
      id: 'video-2', accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 2, title: 'Second shard', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }
    })

    await expect(service.getLibraryDetail('100', 2)).resolves.toMatchObject({
      sourceShards: [{ folderId: 'bilimi:music:002', shardNumber: 2, remoteFolderId: '2' }]
    })
  })

  it('keeps unbound same-title Bilibili folders separate, reports the conflict, and deduplicates their summary video total', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-23T00:00:00.000Z' })
    await service.commit('100', {
      id: 'source-mirror', accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'record-bilibili-mirror',
      payload: {
        workspaceId: 'workspace-1', memberAidsByFolderId: { 'bilibili:1': [1, 2], 'bilibili:2': [2, 3] },
        folders: [
          { id: 'bilibili:1', title: '同名收藏夹', remoteFolderId: '1' },
          { id: 'bilibili:2', title: '同名收藏夹', remoteFolderId: '2' }
        ],
        videos: [1, 2, 3].map((aid) => ({ aid, title: `Video ${aid}`, tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }))
      }
    })

    await expect(service.getLibrarySummary('100')).resolves.toMatchObject({
      folderCount: 2,
      otherFavoriteVideoCount: 3,
      folderConflicts: [expect.objectContaining({
        title: '同名收藏夹', folderIds: ['bilibili:1', 'bilibili:2'],
        reason: expect.stringContaining('同名收藏夹'),
        candidates: [{ id: 'bilibili:1', title: '同名收藏夹' }, { id: 'bilibili:2', title: '同名收藏夹' }]
      })]
    })
  })

  it('does not report a local classification folder as a remote binding conflict with its bound logical ledger', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-23T00:00:00.000Z' })
    await service.commit('100', {
      id: 'game-binding', accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'upsert-physical-shard-binding',
      payload: {
        logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区', shardNumber: 1,
        remoteTitle: 'bilimi·游戏专区', bindingState: 'bound', remoteFolderId: '4099454411', memberAids: [1]
      }
    })
    await service.commit('100', {
      id: 'legacy-local-game', accountMid: '100', issuedAt: '2026-07-23T00:00:01.000Z', type: 'commit-local-plan',
      payload: {
        workspaceId: 'legacy-local-save', memberAidsByFolderId: { 'local:game': [2] },
        folders: [{ id: 'local:game', title: 'bilimi·游戏专区', kind: 'local', syncState: 'local-only' }],
        videos: [1, 2].map((aid) => ({ aid, title: `Video ${aid}`, tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }))
      }
    })

    await expect(service.getLibrarySummary('100')).resolves.not.toMatchObject({
      folderConflicts: expect.arrayContaining([expect.objectContaining({ title: 'bilimi·游戏专区' })])
    })
  })

  it('does not merge a remote mirror bound to multiple logical ledgers', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-23T00:00:00.000Z' })
    for (const logicalLedgerId of ['music', 'games']) {
      await service.commit('100', {
        id: `binding-${logicalLedgerId}`, accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'upsert-physical-shard-binding',
        payload: {
          logicalLedgerId, logicalTitle: logicalLedgerId, shardNumber: 1, memberAids: [], remoteTitle: 'Shared',
          bindingState: 'bound', remoteFolderId: '99'
        }
      })
    }
    await service.commit('100', {
      id: 'source-mirror', accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'record-bilibili-mirror',
      payload: {
        workspaceId: 'workspace-1', memberAidsByFolderId: { 'bilibili:99': [1] },
        folders: [{ id: 'bilibili:99', title: 'Shared', remoteFolderId: '99' }],
        videos: [{ aid: 1, title: 'Video 1', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }]
      }
    })

    await expect(service.getLibrarySummary('100')).resolves.toMatchObject({
      folderCount: 3,
      folderConflicts: expect.arrayContaining([expect.objectContaining({
        title: 'Shared', folderIds: ['bilimi-logical:games', 'bilimi-logical:music'], reason: expect.stringContaining('多个逻辑工作夹')
      })])
    })
    await expect(service.getLibraryDetail('100', 1)).resolves.toMatchObject({ folderIds: ['bilibili:99'] })
  })

  it('persists user events independently and reads them by descending sequence page', async () => {
    const root = await createRoot()
    const first = new FavoriteRepositoryService({ root, now: () => '2026-07-23T00:00:00.000Z' })
    for (const sequence of [1, 2, 3]) {
      await first.commit('100', {
        id: `event-${sequence}`, accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'record-favorite-event',
        payload: { id: `event-${sequence}`, sequence, aid: 1, kind: 'manual-move', occurredAt: '2026-07-23T00:00:00.000Z' }
      })
    }

    const restarted = new FavoriteRepositoryService({ root })
    await expect(restarted.getEventPage('100', 1, { limit: 2 })).resolves.toMatchObject({
      items: [expect.objectContaining({ sequence: 3 }), expect.objectContaining({ sequence: 2 })], nextCursor: '2:event-2'
    })
  })

  it('keeps unmatched local staging separate from the bilimi inbox ledger', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-23T00:00:00.000Z' })
    for (const aid of [1, 2]) {
      await service.commit('100', {
        id: `video-${aid}`, accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'upsert-video',
        payload: { aid, title: `Video ${aid}`, tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }
      })
    }
    await service.commit('100', {
      id: 'inbox-binding', accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'upsert-physical-shard-binding',
      payload: {
        logicalLedgerId: 'inbox', logicalTitle: 'bilimi·暂存', shardNumber: 1, memberAids: [2],
        remoteTitle: 'bilimi·暂存', bindingState: 'bound', remoteFolderId: '9008'
      }
    })
    await service.commit('100', {
      id: 'local-plan', accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'commit-local-plan',
      payload: {
        workspaceId: 'workspace-1', memberAidsByFolderId: { 'local:inbox': [1] },
        folders: [{ id: 'local:inbox', title: '暂存', kind: 'local', syncState: 'local-only' }]
      }
    })

    const summary = await service.getLibrarySummary('100')
    expect(summary.folderCount).toBe(2)
    expect(summary.folders.map((folder) => folder.id)).toEqual(['bilimi-logical:inbox', 'local:inbox'])
    await expect(service.getLibraryPage('100', { kind: 'folder', folderId: 'bilimi-logical:inbox' }, { limit: 10 }))
      .resolves.toMatchObject({ items: [{ video: { aid: 2 } }] })
    await expect(service.getLibraryPage('100', { kind: 'folder', folderId: 'local:inbox' }, { limit: 10 }))
      .resolves.toMatchObject({ items: [{ video: { aid: 1 } }] })
  })

  it('does not count protected videos as pending work while retaining their organization status', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-23T00:00:00.000Z' })
    await service.commit('100', {
      id: 'video-1', accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'Protected', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }
    })
    await service.commit('100', {
      id: 'protect-1', accountMid: '100', issuedAt: '2026-07-23T00:01:00.000Z', type: 'record-organization-protections',
      payload: { records: [{ accountMid: '100', aid: 1, targetFolderIds: ['remote-1'], completedAt: '2026-07-23T00:01:00.000Z' }] }
    })

    await expect(service.getLibrarySummary('100')).resolves.toMatchObject({ pendingAidCount: 0 })
    await expect(service.getLibraryPage('100', { kind: 'pending' }, { limit: 10 })).resolves.toMatchObject({ items: [] })
    await expect(service.getLibraryPage('100', { kind: 'all' }, { limit: 10 })).resolves.toMatchObject({
      items: [{ video: { aid: 1 }, pendingStates: ['protected'] }]
    })
  })

  it('persists compact command receipts without embedded repository snapshots', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-23T00:00:00.000Z' })
    await service.commit('100', {
      id: 'video-1', accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'Video 1', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }
    })
    const manifest = JSON.parse(await readFile(join(root, 'accounts', '100', 'repository.manifest.json'), 'utf8')) as { generation: string }
    const persisted = JSON.parse(await readFile(join(root, 'accounts', '100', 'generations', manifest.generation, 'repository.json'), 'utf8')) as {
      commandResults: Record<string, Record<string, unknown>>
    }

    expect(persisted.commandResults['video-1']).toMatchObject({
      commandId: 'video-1', commandType: 'upsert-video', acceptedRevision: 1, affectedAids: [1]
    })
    expect(persisted.commandResults['video-1']).not.toHaveProperty('videos')
    expect(JSON.stringify(persisted.commandResults['video-1']).length).toBeLessThan(1_000)
  })

  it('compacts legacy full command results on the next atomic persistence', async () => {
    const root = await createRoot()
    const first = new FavoriteRepositoryService({ root, now: () => '2026-07-23T00:00:00.000Z' })
    const command = {
      id: 'video-1', accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'upsert-video' as const,
      payload: { aid: 1, title: 'Video 1', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }
    }
    const result = await first.commit('100', command)
    const accountDirectory = join(root, 'accounts', '100')
    const manifestPath = join(accountDirectory, 'repository.manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { generation: string }
    const generationDirectory = join(accountDirectory, 'generations', manifest.generation)
    const repositoryPath = join(generationDirectory, 'repository.json')
    const legacy = JSON.parse(await readFile(repositoryPath, 'utf8')) as { commandResults: Record<string, unknown> }
    legacy.commandResults['video-1'] = result
    const repositoryContent = JSON.stringify(legacy)
    await writeFile(repositoryPath, repositoryContent, 'utf8')
    const generationManifestPath = join(generationDirectory, 'manifest.json')
    const generationManifest = JSON.parse(await readFile(generationManifestPath, 'utf8')) as { checksums: { repository: string } }
    const { createHash } = await import('node:crypto')
    generationManifest.checksums.repository = createHash('sha256').update(repositoryContent).digest('hex')
    await writeFile(generationManifestPath, JSON.stringify(generationManifest), 'utf8')
    await writeFile(manifestPath, JSON.stringify(generationManifest), 'utf8')

    const restarted = new FavoriteRepositoryService({ root, now: () => '2026-07-23T00:00:01.000Z' })
    await restarted.commit('100', {
      id: 'video-2', accountMid: '100', issuedAt: '2026-07-23T00:00:01.000Z', type: 'upsert-video',
      payload: { aid: 2, title: 'Video 2', tags: [], updatedAt: '2026-07-23T00:00:01.000Z' }
    })
    const compactManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { generation: string }
    const compact = JSON.parse(await readFile(join(accountDirectory, 'generations', compactManifest.generation, 'repository.json'), 'utf8')) as {
      commandResults: Record<string, Record<string, unknown>>
    }
    expect(compact.commandResults['video-1']).not.toHaveProperty('videos')
    expect(compact.commandResults['video-1']).toMatchObject({ commandId: 'video-1', acceptedRevision: 1 })
  })

  it('retains only the active and rollback repository generations', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-23T00:00:00.000Z' })
    for (const aid of [1, 2, 3]) {
      await service.commit('100', {
        id: `video-${aid}`, accountMid: '100', issuedAt: '2026-07-23T00:00:00.000Z', type: 'upsert-video',
        payload: { aid, title: `Video ${aid}`, tags: [], updatedAt: '2026-07-23T00:00:00.000Z' }
      })
    }

    const accountDirectory = join(root, 'accounts', '100')
    const manifest = JSON.parse(await readFile(join(accountDirectory, 'repository.manifest.json'), 'utf8')) as {
      generation: string
      previousGeneration?: string
    }
    const generations = await readdir(join(accountDirectory, 'generations'))
    expect(generations.sort()).toEqual([manifest.generation, manifest.previousGeneration].filter(Boolean).sort())
  })

  it('rejects a cross-account command even when its id was already committed', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    const command = {
      id: 'shared-command-id', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-video' as const,
      payload: { aid: 1, title: 'Original', tags: [], updatedAt: '2026-07-19T00:00:00.000Z' }
    }

    await service.commit('100', command)

    await expect(service.commit('100', { ...command, accountMid: '200' }))
      .rejects.toThrow('Favorite repository account mismatch.')
    expect((await service.getSnapshot('100')).videos['1'].title).toBe('Original')
  })

  it('returns only the requested library page without treating metadata refresh as organization work', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root })
    const videos: Record<string, { aid: number; title: string; tags: string[]; updatedAt: string }> = {
      '1': { aid: 1, title: 'First', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }
    }
    Object.defineProperty(videos, '2', {
      enumerable: true,
      get: () => { throw new Error('unselected video must not be read') }
    })
    ;(service as unknown as { cache: Map<string, unknown> }).cache.set('100', {
      repository: {
        version: 1,
        accountMid: '100',
        snapshot: {
          version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-20T00:00:00.000Z',
          videos, folders: [], memberships: {}, physicalShards: [], syncRecords: [],
          organizationRecords: [], organizationMigrationInitialized: false
        },
        commandResults: {}
      }
    })

    await expect(service.getLibraryPage('100', { kind: 'all' }, { limit: 1 })).resolves.toEqual({
      version: 1, accountMid: '100', revision: 1, totalCount: 2,
      items: [{
        video: { aid: 1, title: 'First', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' },
          folderIds: [], pendingStates: [],
          libraryStates: { sync: 'unsynced', protection: 'unprotected', organization: 'unorganized' }
      }],
      nextCursor: '1'
    })
  })

  it('does not treat a local metadata mirror as a remote position operation', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    await service.commit('100', {
      id: 'video', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'Local', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }
    })
    await service.commit('100', {
      id: 'members', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'commit-local-plan',
      payload: { workspaceId: 'local-save', memberAidsByFolderId: { 'local:music': [1] },
        folders: [{ id: 'local:music', title: 'Music', kind: 'local', syncState: 'local-only' }] }
    })
    await service.commit('100', {
      id: 'binding', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'upsert-physical-shard-binding',
      payload: { logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber: 1, memberAids: [], remoteTitle: 'Music', bindingState: 'bound', remoteFolderId: 'remote-music' }
    })

    await expect(service.getLibraryPage('100', { kind: 'pending' }, { limit: 10 })).resolves.toMatchObject({
      items: []
    })
    await service.recordSyncCheckpoint('100', 'succeeded', {
      id: 'run:append', commandId: 'run:append', runId: 'run', operationKey: 'append:1', status: 'succeeded',
      affectedAids: [1], targetFolderIds: ['remote-music'], updatedAt: '2026-07-20T00:00:00.000Z', attempt: 1
    })
    await expect(service.getLibraryPage('100', { kind: 'pending' }, { limit: 10 })).resolves.toMatchObject({
      items: []
    })
  })

  it('reuses dynamic pending states for a 30k library while repository and transcription revisions are unchanged', async () => {
    const root = await createRoot()
    let transcriptionReads = 0
    const organizationRecords = [{ aid: 1 }]
    const videos = Object.fromEntries(Array.from({ length: 30_000 }, (_, index) => {
      const aid = index + 1
      return [String(aid), { aid, title: `Video ${aid}`, tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }]
    }))
    const service = new FavoriteRepositoryService({
      root,
      getTranscriptionRevision: () => 1,
      getTranscriptionItems: () => {
        transcriptionReads += 1
        return []
      }
    })
    ;(service as unknown as { cache: Map<string, unknown> }).cache.set('100', {
      repository: {
        version: 1,
        accountMid: '100',
        snapshot: {
          version: 1, accountMid: '100', revision: 1, updatedAt: '2026-07-20T00:00:00.000Z',
          videos,
          folders: [], memberships: {}, physicalShards: [], syncRecords: [],
          organizationRecords, organizationMigrationInitialized: false
        },
        commandResults: {}
      }
    })

    await service.getLibraryPage('100', { kind: 'all' }, { limit: 50 })
    transcriptionReads = 0
    const page = await service.getLibraryPage('100', { kind: 'all' }, { limit: 50 })

    expect(transcriptionReads).toBe(0)
    expect(page).toMatchObject({ totalCount: 30_000, items: { length: 50 } })
  })

  it('keeps metadata refresh separate from actionable remote-operation work after organization', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-21T00:00:00.000Z' })
    await service.commit('100', {
      id: 'source', accountMid: '100', issuedAt: '2026-07-21T00:00:00.000Z', type: 'record-bilibili-mirror',
      payload: { workspaceId: 'scan-1', folders: [{ id: 'bilibili:source', title: 'Source', remoteFolderId: 'source' }],
        memberAidsByFolderId: { 'bilibili:source': Array.from({ length: 243 }, (_, index) => index + 1) },
        videos: Array.from({ length: 243 }, (_, index) => ({ aid: index + 1, title: `Video ${index + 1}`, tags: [], updatedAt: '2026-07-21T00:00:00.000Z' })) }
    })
    for (const aid of Array.from({ length: 15 }, (_, index) => index + 221)) {
      await service.commit('100', { id: `local-${aid}`, accountMid: '100', issuedAt: '2026-07-21T00:00:00.000Z', type: 'record-library-mirror', payload: { aid, status: 'never', metadataRevision: 1 } })
    }
    await service.recordSyncCheckpoint('100', 'failed', { id: 'failed', commandId: 'failed', status: 'failed', affectedAids: [236, 237, 238, 239, 240], updatedAt: '2026-07-21T00:00:00.000Z' })
    await service.recordSyncCheckpoint('100', 'unknown', { id: 'unknown', commandId: 'unknown', status: 'result-unknown', affectedAids: [241, 242, 243], updatedAt: '2026-07-21T00:00:00.000Z' })

    await expect(service.getLibrarySummary('100')).resolves.toMatchObject({ pendingAidCount: 8 })
  })

  it('marks formal organization separately from metadata refresh state', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-21T00:00:00.000Z' })
    await service.commit('100', {
      id: 'source', accountMid: '100', issuedAt: '2026-07-21T00:00:00.000Z', type: 'record-bilibili-mirror',
      payload: { workspaceId: 'scan-1', folders: [], memberAidsByFolderId: {}, videos: [
        { aid: 1, title: 'Protected', tags: [], updatedAt: '2026-07-21T00:00:00.000Z' },
        { aid: 2, title: 'Staged', tags: [], updatedAt: '2026-07-21T00:00:00.000Z' }
      ] }
    })
    await service.commit('100', {
      id: 'protection', accountMid: '100', issuedAt: '2026-07-21T00:00:00.000Z', type: 'record-organization-protections',
      payload: { records: [{ accountMid: '100', aid: 1, targetFolderIds: ['remote-music'], completedAt: '2026-07-21T00:00:00.000Z' }] }
    })

    await expect(service.getLibraryPage('100', { kind: 'all' }, { limit: 10 })).resolves.toMatchObject({
      items: [
        { video: { aid: 1 }, pendingStates: ['protected'] },
        { video: { aid: 2 }, pendingStates: [] }
      ]
    })
  })

  it('persists account-isolated organization recovery records across a repository restart', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-21T00:00:00.000Z' })
    await service.commit('100', {
      id: 'change', accountMid: '100', issuedAt: '2026-07-21T00:00:00.000Z', type: 'record-organization-change',
      payload: { change: {
        id: 'run-1:append-1:succeeded', runId: 'run-1', workspaceId: 'workspace-1', accountMid: '100', aid: 1,
        beforeFolderIds: ['source'], afterFolderIds: ['remote-music'], addedFolderIds: ['remote-music'], removedFolderIds: ['source'],
        status: 'succeeded', recordedAt: '2026-07-21T00:00:00.000Z'
      } }
    })

    await expect(new FavoriteRepositoryService({ root }).getOrganizationChanges('100')).resolves.toEqual([
      expect.objectContaining({ runId: 'run-1', aid: 1, beforeFolderIds: ['source'], afterFolderIds: ['remote-music'] })
    ])
    await expect(new FavoriteRepositoryService({ root }).getOrganizationChanges('200')).resolves.toEqual([])
  })

  it('clears only Bilibili mirror folders and mirror-only videos while preserving local repository data', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-21T00:00:00.000Z' })
    await service.commit('100', {
      id: 'source-mirror', accountMid: '100', issuedAt: '2026-07-21T00:00:00.000Z', type: 'record-bilibili-mirror',
      payload: {
        workspaceId: 'workspace-1',
        folders: [{ id: 'bilibili:source', title: 'Source', remoteFolderId: 'source' }],
        memberAidsByFolderId: { 'bilibili:source': [1, 2] },
        videos: [
          { aid: 1, title: 'Mirror only', tags: [], updatedAt: '2026-07-21T00:00:00.000Z' },
          { aid: 2, title: 'Also local', tags: [], updatedAt: '2026-07-21T00:00:00.000Z' }
        ]
      }
    })
    await service.commit('100', {
      id: 'local-keep', accountMid: '100', issuedAt: '2026-07-21T00:00:00.000Z', type: 'commit-local-plan',
      payload: { workspaceId: 'workspace-1', memberAidsByFolderId: { 'local:inbox': [2, 3] },
        folders: [{ id: 'local:inbox', title: '暂存', kind: 'local', syncState: 'local-only' }],
        videos: [{ aid: 3, title: 'Local only', tags: [], updatedAt: '2026-07-21T00:00:00.000Z' }] }
    })
    await service.commit('100', {
      id: 'library-mirror', accountMid: '100', issuedAt: '2026-07-21T00:00:00.000Z', type: 'record-library-mirror',
      payload: { aid: 1, status: 'synced', metadataRevision: 1, lastSyncedAt: '2026-07-21T00:00:00.000Z' }
    })
    await service.commit('100', {
      id: 'retained-library-mirror', accountMid: '100', issuedAt: '2026-07-21T00:00:00.000Z', type: 'record-library-mirror',
      payload: { aid: 2, status: 'synced', metadataRevision: 1, lastSyncedAt: '2026-07-21T00:00:00.000Z' }
    })

    await service.commit('100', {
      id: 'clear-bilibili-mirror', accountMid: '100', issuedAt: '2026-07-21T00:00:00.000Z', type: 'clear-bilibili-mirror', payload: {}
    })

    await expect(service.getSnapshot('100')).resolves.toMatchObject({
      folders: [{ id: 'local:inbox', kind: 'local' }],
      memberships: { 'local:inbox': [2, 3] },
      videos: { '2': { aid: 2 }, '3': { aid: 3 } },
      libraryMirrors: {}
    })
  })

  it('keeps the last successful mirror timestamp when a later local refresh fails', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root })
    await service.commit('100', {
      id: 'video', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'Mirror', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }
    })
    await service.commit('100', {
      id: 'mirror-ok', accountMid: '100', issuedAt: '2026-07-20T01:00:00.000Z', type: 'record-library-mirror',
      payload: { aid: 1, status: 'synced', metadataRevision: 1, lastSyncedAt: '2026-07-20T01:00:00.000Z' }
    })
    await service.commit('100', {
      id: 'mirror-failed', accountMid: '100', issuedAt: '2026-07-20T02:00:00.000Z', type: 'record-library-mirror',
      payload: { aid: 1, status: 'failed', metadataRevision: 1, lastSyncedAt: '2026-07-20T01:00:00.000Z', errorCode: 'network' }
    })

    await expect(service.getLibraryDetail('100', 1)).resolves.toMatchObject({
      mirror: { status: '同步失败', lastSyncedAt: '2026-07-20T01:00:00.000Z' }
    })
  })

  it('projects an unavailable mirror with its remote code and latest detection time', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root })
    await service.commit('100', {
      id: 'video-unavailable', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 9, title: '保留的旧标题', tags: ['旧标签'], updatedAt: '2026-07-20T00:00:00.000Z' }
    })
    await service.commit('100', {
      id: 'mirror-unavailable', accountMid: '100', issuedAt: '2026-07-20T02:00:00.000Z', type: 'record-library-mirror',
      payload: { aid: 9, status: 'failed', metadataRevision: 2, lastCheckedAt: '2026-07-20T02:00:00.000Z', errorCode: 'unavailable', remoteCode: 62012 }
    })

    await expect(service.getLibraryDetail('100', 9)).resolves.toMatchObject({
      video: { title: '保留的旧标题', tags: ['旧标签'] },
      mirror: { status: '同步失败', errorCode: 'unavailable', remoteCode: 62012, lastCheckedAt: '2026-07-20T02:00:00.000Z' }
    })
  })

  it('reports the local metadata mirror without reusing remote favorite sync records', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root })
    await service.commit('100', {
      id: 'video', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 7, title: '镜像视频', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }
    })
    await service.commit('100', {
      id: 'mirror', accountMid: '100', issuedAt: '2026-07-20T01:00:00.000Z', type: 'record-library-mirror',
      payload: { aid: 7, status: 'synced', metadataRevision: 1, lastSyncedAt: '2026-07-20T01:00:00.000Z' }
    })

    await expect(service.getLibraryDetail('100', 7)).resolves.toMatchObject({
      mirror: { status: '已同步', lastSyncedAt: '2026-07-20T01:00:00.000Z' }
    })
  })

  it('uses the local mirror record, rather than old remote checkpoints, for the pending library page', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root })
    await service.commit('100', {
      id: 'video', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 8, title: '已镜像', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }
    })
    await service.commit('100', {
      id: 'mirror', accountMid: '100', issuedAt: '2026-07-20T01:00:00.000Z', type: 'record-library-mirror',
      payload: { aid: 8, status: 'synced', metadataRevision: 1, lastSyncedAt: '2026-07-20T01:00:00.000Z' }
    })

    await expect(service.getLibraryPage('100', { kind: 'pending' }, { limit: 10 })).resolves.toMatchObject({ items: [] })
  })

  it('reports a pending durable commit so the quit barrier can wait even when old favorite state is clean', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    const pending = service.commit('100', {
      id: 'video-1', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'Pending', tags: [], updatedAt: '2026-07-19T00:00:00.000Z' }
    })

    expect((service as unknown as { hasPendingWrites(): boolean }).hasPendingWrites()).toBe(true)
    await service.flush()
    await pending
    expect((service as unknown as { hasPendingWrites(): boolean }).hasPendingWrites()).toBe(false)
  })

  it('journals sync checkpoints and recovers them without rewriting every repository generation', async () => {
    const root = await createRoot()
    const service = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    await service.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace',
      payload: {
        id: 'workspace-1', accountMid: '100', status: 'executing', baselineRevision: 1, continuationAids: [],
        workspaceRef: {
          workspaceId: 'workspace-1', accountMid: '100', status: 'executing', baselineRevision: 1,
          currentSegmentId: 'segment-1', overlayRevision: 1, journalCursor: 1, checksum: 'a'.repeat(64)
        }
      }
    })
    const generationDirectory = join(root, 'accounts', '100', 'generations')
    const before = await readdir(generationDirectory)

    await service.recordSyncCheckpoint('100', 'checkpoint-pending', {
      id: 'run-1:append-1', commandId: 'append-1', status: 'pending', affectedAids: [1], updatedAt: '2026-07-19T00:00:00.000Z', runId: 'run-1', operationKey: 'append-1', attempt: 1
    })
    await service.recordSyncCheckpoint('100', 'checkpoint-result', {
      id: 'run-1:append-1', commandId: 'append-1', status: 'succeeded', affectedAids: [1], updatedAt: '2026-07-19T00:00:00.000Z', runId: 'run-1', operationKey: 'append-1', attempt: 1
    })

    expect(await readdir(generationDirectory)).toEqual(before)
    const restarted = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    expect(await restarted.getSyncCheckpoints('100', 'run-1')).toEqual([
      expect.objectContaining({ id: 'run-1:append-1', status: 'succeeded' })
    ])

    await restarted.commit('100', {
      id: 'compact-sync-journal', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace',
      payload: {
        id: 'workspace-1', accountMid: '100', status: 'completed', baselineRevision: 1, continuationAids: [],
        workspaceRef: {
          workspaceId: 'workspace-1', accountMid: '100', status: 'completed', baselineRevision: 1,
          currentSegmentId: 'segment-1', overlayRevision: 1, journalCursor: 1, checksum: 'a'.repeat(64)
        }
      }
    })
    const manifest = JSON.parse(await readFile(join(root, 'accounts', '100', 'repository.manifest.json'), 'utf8')) as { generation: string }
    const persisted = JSON.parse(await readFile(join(root, 'accounts', '100', 'generations', manifest.generation, 'repository.json'), 'utf8')) as {
      commandResults: Record<string, unknown>
      snapshot: { syncRecords: Array<{ id: string; status: string }> }
    }
    expect(persisted.commandResults).not.toHaveProperty('checkpoint-pending')
    expect(persisted.commandResults).not.toHaveProperty('checkpoint-result')
    expect(persisted.snapshot.syncRecords).toEqual([
      expect.objectContaining({ id: 'run-1:append-1', status: 'succeeded' })
    ])
  })
})
