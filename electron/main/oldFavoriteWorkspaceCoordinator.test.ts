import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FavoriteRepositoryService } from './favoriteRepositoryService'
import { FavoriteRepositoryBindingService, favoriteRepositoryManagedShardTitle } from './favoriteRepositoryBindingService'
import { FavoriteRepositorySyncService } from './favoriteRepositorySyncService'
import { OldFavoriteWorkspaceCoordinator } from './oldFavoriteWorkspaceCoordinator'
import { OldFavoriteWorkspaceStore } from './oldFavoriteWorkspaceStore'
import { createOldFavoriteWorkspace } from '../../src/shared/oldFavoriteWorkspace'

const roots: string[] = []

async function createRoot() {
  const root = await mkdtemp(join(tmpdir(), 'bilimi-old-favorite-coordinator-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function createCoordinator(
  repository: FavoriteRepositoryService,
  workspaceStore: OldFavoriteWorkspaceStore,
  options: Pick<ConstructorParameters<typeof OldFavoriteWorkspaceCoordinator>[0], 'classifyCurrentItem' | 'saveRecommendedLedgers' | 'removeRecommendedLedgers'> = {}
) {
  return new OldFavoriteWorkspaceCoordinator({
    repository,
    workspaceStore,
    ...options,
    now: () => '2026-07-19T00:00:00.000Z'
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

describe('OldFavoriteWorkspaceCoordinator', () => {
  it('retains scanned tags and automatically classifies the completed selected segment', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const classifyCurrentItem = vi.fn().mockReturnValue({ targetLedgerIds: ['knowledge'], confidence: 'high' as const })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { classifyCurrentItem })
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [{ aid: 1, title: 'TypeScript tutorial', tags: ['TypeScript'], category: '科技', sourceFolderIds: ['source'] }]
    })

    await coordinator.finishScan('100')

    expect(classifyCurrentItem).toHaveBeenCalledWith(expect.objectContaining({ tags: ['TypeScript'], category: '科技' }))
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      scan: { phase: 'complete', totalItemCount: 1, scannedItemCount: 1, taggedItemCount: 1, untaggedItemCount: 0 },
      currentSegment: { items: [expect.objectContaining({ aid: 1, tags: ['TypeScript'], category: '科技' })] },
      classifications: { '1': { targetLedgerIds: ['knowledge'], source: 'system-high' } },
      planReadiness: { selectedAidCount: 1, classifiedAidCount: 1, unclassifiedAidCount: 0 }
    })
  })

  it('stages unclassified selected aids before refusing an unbound cross-segment remote plan', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2_001, isBilimiWorkFolder: false }]
    })
    for (let offset = 0; offset < 2_001; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source', page: (offset / 50) + 1,
        items: Array.from({ length: Math.min(50, 2_001 - offset) }, (_, index) => ({
          aid: offset + index + 1, title: `Video ${offset + index + 1}`, sourceFolderIds: ['source']
        }))
      })
    }
    await coordinator.finishScan('100')
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: Array.from({ length: 2_000 }, (_, index) => ({ aid: index + 1, targetLedgerIds: ['music'] }))
    })

    await expect(coordinator.freezeForBilibiliExecution('100')).rejects.toThrow('remote-target-unbound')
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      memberships: { 'local:inbox': [2_001] }
    })
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      planReadiness: { selectedAidCount: 2_001, classifiedAidCount: 2_000, unclassifiedAidCount: 1 }
    })
  })

  it('persists a scanning inventory overview, including empty Bilimi work folders, for restart recovery', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    const first = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))

    await first.open('100')
    await first.beginScan('100', 'incremental')
    await first.recordScanInventory('100', {
      sourceFolders: [
        { id: 'source', title: 'Source', itemCount: 3, isBilimiWorkFolder: false },
        { id: 'bilimi-empty', title: 'Bilimi Inbox', itemCount: 0, isBilimiWorkFolder: true }
      ]
    })
    await first.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [{ aid: 1, title: 'First scanned video', tags: ['知识'], sourceFolderIds: ['source'] }]
    })

    await expect(first.getSnapshot('100')).resolves.toMatchObject({
      scan: {
        phase: 'inventory', totalItemCount: 3, scannedItemCount: 1,
        taggedItemCount: 1, untaggedItemCount: 0
      }
    })

    await first.recordScanPage('100', {
      folderId: 'source', page: 2,
      items: [{ aid: 1, title: 'Duplicated source item', sourceFolderIds: ['source'] }]
    })
    await expect(first.getSnapshot('100')).resolves.toMatchObject({
      scan: { totalItemCount: 3, scannedItemCount: 1, taggedItemCount: 1, untaggedItemCount: 0 }
    })

    await expect(createCoordinator(
      new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' }),
      new OldFavoriteWorkspaceStore({ root })
    ).getSnapshot('100')).resolves.toMatchObject({
      status: 'scanning',
      scan: { phase: 'inventory', failureCount: 0 },
      sourceFolders: [
        { id: 'source', itemCount: 3, isBilimiWorkFolder: false },
        { id: 'bilimi-empty', itemCount: 0, isBilimiWorkFolder: true }
      ],
      currentSegment: null
    })
  })

  it('keeps a requested full scan mode and existing inventory overview when restarted', async () => {
    const root = await createRoot()
    const coordinator = createCoordinator(
      new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' }),
      new OldFavoriteWorkspaceStore({ root })
    )
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'bilimi-empty', title: 'Bilimi·Inbox', itemCount: 0, isBilimiWorkFolder: true }]
    })

    await expect(coordinator.beginScan('100', 'full')).resolves.toMatchObject({
      mode: 'full', sourceFolders: [{ id: 'bilimi-empty', itemCount: 0 }]
    })
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({ mode: 'full' })
  })

  it('supersedes an in-progress incremental scan when the user explicitly requests a full reorganization', async () => {
    const root = await createRoot()
    const coordinator = createCoordinator(
      new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' }),
      new OldFavoriteWorkspaceStore({ root })
    )
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    const incrementalRunId = await coordinator.getActiveScanRunId('100')

    await expect(coordinator.beginScan('100', 'full')).resolves.toMatchObject({ status: 'scanning', mode: 'full' })
    await expect(coordinator.getActiveScanRunId('100')).resolves.not.toBe(incrementalRunId)
  })

  it('abandons an interrupted frozen plan before replacing it with a full scan', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const syncService = new FavoriteRepositorySyncService({
      repository,
      pageBridgeManager: { bind: vi.fn(), release: vi.fn(), pageBridge: vi.fn() },
      now: () => '2026-07-20T00:00:00.000Z'
    })
    const abandonFrozenPlan = vi.spyOn(syncService, 'abandonFrozenPlan')
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      bindingService: { ensurePhysicalShard: vi.fn().mockResolvedValue(undefined) },
      syncService,
      now: () => '2026-07-20T00:00:00.000Z'
    })
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    await bindings.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber: 1, memberAids: [], observedAccountMid: '100',
      remoteFolderId: 'remote-music-1',
      inventory: [{ id: 'remote-music-1', title: 'B-music-001-a1b2c3', memberCount: 0, memberAids: [] }]
    })
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })
    await coordinator.freezeForBilibiliExecution('100')

    await expect(coordinator.beginScan('100', 'full')).resolves.toMatchObject({ status: 'scanning', mode: 'full' })
    expect(abandonFrozenPlan).toHaveBeenCalledWith('100')
    const snapshot = await repository.getSnapshot('100')
    expect(snapshot.workspace).toMatchObject({ status: 'scanning', baselineRevision: 0 })
    expect(snapshot.workspace?.frozenSyncPlan).toBeUndefined()
  })

  it('lets an explicitly restarted scan replace a persisted scanning lease after process recovery', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(repository, store)
    await first.open('100')
    await first.beginScan('100', 'incremental')

    const recovered = createCoordinator(
      new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' }),
      new OldFavoriteWorkspaceStore({ root })
    )
    await expect(recovered.getSnapshot('100')).resolves.toMatchObject({ status: 'scanning', mode: 'incremental' })
    await expect(recovered.beginScan('100', 'incremental')).resolves.toMatchObject({ status: 'scanning', mode: 'incremental' })
    await expect(recovered.getActiveScanRunId('100')).resolves.toEqual(expect.any(String))
  })

  it('drops a queued page from a superseded scan run instead of writing it into the full scan', async () => {
    const root = await createRoot()
    const coordinator = createCoordinator(
      new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' }),
      new OldFavoriteWorkspaceStore({ root })
    )
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    const incrementalRunId = await coordinator.getActiveScanRunId('100')
    await coordinator.beginScan('100', 'full')

    await expect(coordinator.recordScanPage('100', {
      folderId: 'old-source', page: 1, items: [{ aid: 1, sourceFolderIds: ['old-source'] }]
    }, incrementalRunId)).resolves.toBe(false)
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'new-source', title: 'New', itemCount: 0, isBilimiWorkFolder: false }]
    })
    await coordinator.finishScan('100')

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({ mode: 'full', currentSegment: null })
  })

  it('writes a bounded source page through the workspace store without committing a repository generation', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const coordinator = createCoordinator(repository, workspaceStore)
    const workspace = await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    const revision = (await repository.getSnapshot('100')).revision

    await coordinator.recordScanPage('100', {
      folderId: 'source-1', page: 1,
      items: [{ aid: 1, title: 'Video', author: 'UP', cover: '', addedAt: 0, sourceFolderIds: ['source-1'] }]
    })

    expect((await repository.getSnapshot('100')).revision).toBe(revision)
    await expect(workspaceStore.readScanPages('100', workspace.id)).resolves.toEqual([
      expect.objectContaining({ folderId: 'source-1', page: 1, items: [expect.objectContaining({ aid: 1 })] })
    ])
  })

  it('starts a new incremental scan after completion without overwriting the completed workspace mirror', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const coordinator = createCoordinator(repository, store)
    const initial = await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    const completedMarker = (await repository.getSnapshot('100')).workspace!
    await repository.commit('100', {
      id: 'complete', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'set-workspace', payload: {
        ...completedMarker,
        status: 'completed', workspaceRef: { ...completedMarker.workspaceRef, status: 'completed' },
        frozenSyncPlan: {
          id: 'run-1', accountMid: '100', workspaceId: initial.id, baselineRevision: 1,
          createdAt: '2026-07-20T00:00:00.000Z', operations: []
        }
      }
    })

    const next = await coordinator.beginScan('100', 'incremental')

    expect(next).toMatchObject({ accountMid: '100', status: 'scanning', mode: 'incremental' })
    expect(next.workspaceId).not.toBe(initial.id)
    await expect(store.recover('100', initial.id)).resolves.toMatchObject({ workspaceId: initial.id, baselineRevision: 1 })
    expect((await repository.getSnapshot('100')).workspace).toMatchObject({ id: next.workspaceId, status: 'scanning' })
  })

  it.each([
    ['incremental', [1, 2, 3], []],
    ['full', [1, 2, 3], []]
  ] as const)('does not treat staged Bilimi membership as %s incremental protection', async (mode, plannedAids, protectedAids) => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    const completed = await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1, 2] })
    const completedMarker = (await repository.getSnapshot('100')).workspace!
    await repository.commit('100', {
      id: 'complete', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'set-workspace', payload: {
        ...completedMarker,
        status: 'completed', workspaceRef: { ...completedMarker.workspaceRef, status: 'completed' },
        frozenSyncPlan: {
          id: 'run-1', accountMid: '100', workspaceId: completed.id, baselineRevision: 1,
          createdAt: '2026-07-20T00:00:00.000Z', operations: []
        }
      }
    })
    await coordinator.beginScan('100', mode)
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'bilimi-inbox', title: 'bilimi·待分类', itemCount: 2, isBilimiWorkFolder: true }]
    })
    await coordinator.recordManagedMembers('100', { 'bilimi-music': [1, 2] })
    await coordinator.recordScanPage('100', {
      folderId: 'source-a', page: 1,
      items: [1, 2, 3].map((aid) => ({ aid, title: `Video ${aid}`, sourceFolderIds: ['source-a'] }))
    })

    await expect(coordinator.finishScan('100')).resolves.toMatchObject({ plannedAids, protectedAids })
  })

  it('conservatively records formal Bilimi membership once while leaving staging aids active', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [
        { id: 'bilimi-music', title: 'bilimi·音乐', itemCount: 1, isBilimiWorkFolder: true },
        { id: 'bilimi-inbox', title: 'bilimi·待分类', itemCount: 1, isBilimiWorkFolder: true }
      ]
    })
    await coordinator.recordManagedMembers('100', { 'bilimi-music': [1, 4], 'bilimi-inbox': [2] })
    await coordinator.recordScanPage('100', {
      folderId: 'source-a', page: 1,
      items: [1, 2, 3].map((aid) => ({ aid, title: `Video ${aid}`, sourceFolderIds: ['source-a'] }))
    })

    await expect(coordinator.finishScan('100')).resolves.toMatchObject({ plannedAids: [2, 3], protectedAids: [1] })
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      organizationMigrationInitialized: true,
      organizationRecords: [
        expect.objectContaining({ aid: 1, targetFolderIds: ['bilimi-music'] }),
        expect.objectContaining({ aid: 4, targetFolderIds: ['bilimi-music'] })
      ]
    })
  })

  it('removes prior successful protections when a user explicitly starts a full reorganization', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await repository.commit('100', {
      id: 'prior-protection', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'record-organization-protections',
      payload: { records: [{ accountMid: '100', aid: 1, targetFolderIds: ['remote-music'], completedAt: '2026-07-20T00:00:00.000Z' }] }
    })
    await coordinator.open('100')

    await coordinator.beginScan('100', 'full')

    await expect(repository.getSnapshot('100')).resolves.toMatchObject({ organizationRecords: [] })
  })

  it('replaces an editable preview with a full reorganization and clears prior protections', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await repository.commit('100', {
      id: 'prior-protection', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'record-organization-protections',
      payload: { records: [{ accountMid: '100', aid: 1, targetFolderIds: ['remote-music'], completedAt: '2026-07-20T00:00:00.000Z' }] }
    })
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })

    await expect(coordinator.beginScan('100', 'full')).resolves.toMatchObject({
      status: 'scanning', mode: 'full'
    })
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({ organizationRecords: [] })
  })

  it('finalizes staged source pages into one deduplicated immutable baseline without treating unclassified managed aids as complete', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const coordinator = createCoordinator(repository, workspaceStore)
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordManagedMembers('100', { 'bilimi-inbox': [2] })
    await coordinator.recordScanPage('100', {
      folderId: 'source-a', page: 1,
      items: [{ aid: 1, title: 'First title', sourceFolderIds: ['source-a'] }, { aid: 2, title: 'Shared', sourceFolderIds: ['source-a'] }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source-b', page: 1,
      items: [{ aid: 2, title: 'Later title', sourceFolderIds: ['source-b'] }]
    })

    await expect(coordinator.finishScan('100')).resolves.toMatchObject({
      status: 'previewing', baseline: { aids: [1, 2] }, baselineCompletedAids: [], plannedAids: [1, 2]
    })
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      status: 'previewing', currentSegment: {
        aids: [1, 2],
        items: [
          { aid: 1, title: 'First title', sourceFolderIds: ['source-a'] },
          { aid: 2, title: 'Shared', sourceFolderIds: ['source-a', 'source-b'] }
        ]
      }, scan: { phase: 'complete' }
    })
  })

  it('mirrors a completed Bilibili source scan into the account-scoped favorite library', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'remote-music', title: '音乐收藏', itemCount: 1, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'remote-music', page: 1,
      items: [{ aid: 7, title: '真实 B 站收藏', author: 'UP 主', sourceFolderIds: ['remote-music'] }]
    })

    await coordinator.finishScan('100')

    await expect(repository.getLibraryPage('100', { kind: 'all' }, { limit: 100 })).resolves.toMatchObject({
      items: [{
        video: { aid: 7, title: '真实 B 站收藏', author: 'UP 主' },
        folderIds: ['bilibili:remote-music']
      }]
    })
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      folders: [{ id: 'bilibili:remote-music', title: '音乐收藏', kind: 'bilibili', remoteFolderId: 'remote-music' }]
    })
  })

  it('rejects a manual classification for a deselected source in the main-process workspace', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [
        { id: 'source-a', title: 'Source A', itemCount: 1, isBilimiWorkFolder: false },
        { id: 'source-b', title: 'Source B', itemCount: 1, isBilimiWorkFolder: false }
      ]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source-a', page: 1,
      items: [{ aid: 1, title: 'Selected', sourceFolderIds: ['source-a'] }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source-b', page: 1,
      items: [{ aid: 2, title: 'Deselected', sourceFolderIds: ['source-b'] }]
    })
    await coordinator.finishScan('100')
    await coordinator.selectSourceFolders('100', ['source-a'])

    await expect(coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 2, targetLedgerIds: ['music'] }]
    })).rejects.toThrow('selected sources')
    await expect(coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })).resolves.toMatchObject({ classifications: { '1': { targetLedgerIds: ['music'] } } })
  })

  it('automatically classifies only selected current-segment items without replacing manual decisions', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const classifyCurrentItem = vi.fn((item: { aid: number }) => item.aid === 1
      ? { targetLedgerIds: ['knowledge'], confidence: 'high' as const }
      : { targetLedgerIds: ['music'], confidence: 'low' as const })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      classifyCurrentItem,
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [
        { id: 'source-a', title: 'Source A', itemCount: 2, isBilimiWorkFolder: false },
        { id: 'source-b', title: 'Source B', itemCount: 1, isBilimiWorkFolder: false }
      ]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source-a', page: 1,
      items: [{ aid: 1, title: 'Knowledge', sourceFolderIds: ['source-a'] }, { aid: 2, title: 'Music', sourceFolderIds: ['source-a'] }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source-b', page: 1,
      items: [{ aid: 3, title: 'Excluded', sourceFolderIds: ['source-b'] }]
    })
    await coordinator.finishScan('100')
    await coordinator.selectSourceFolders('100', ['source-a'])
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 2, targetLedgerIds: ['manual-music'] }]
    })

    await coordinator.autoClassifyCurrentSegment('100')

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      classifications: {
        '1': { targetLedgerIds: ['knowledge'], source: 'system-high' },
        '2': { targetLedgerIds: ['manual-music'], source: 'manual' }
      },
      history: { cursor: 2, length: 2 }
    })
    expect(classifyCurrentItem).toHaveBeenCalledTimes(1)
    expect(classifyCurrentItem).toHaveBeenCalledWith(expect.objectContaining({ aid: 1 }))
  })

  it('records automatic low-confidence assignments as one-target system-low history', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      classifyCurrentItem: () => ({ targetLedgerIds: ['music', 'knowledge'], confidence: 'low' })
    })
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [{ aid: 1, title: 'Low confidence', sourceFolderIds: ['source'] }]
    })
    await coordinator.finishScan('100')

    await coordinator.autoClassifyCurrentSegment('100')

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      classifications: { '1': { targetLedgerIds: ['music'], source: 'system-low' } },
      history: { cursor: 1, length: 1 }
    })
  })

  it('persists whole-round author recommendations and reapplies only system classifications when adoption changes', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    const classifyCurrentItem = vi.fn((item: { author?: string }, recommendedLedgers: Array<{ id: string }> = []) => {
      const authorLedger = recommendedLedgers.find((ledger) => ledger.id === 'custom-author-up-alpha')
      return authorLedger && item.author === 'UP Alpha'
        ? { targetLedgerIds: [authorLedger.id], confidence: 'high' as const }
        : { targetLedgerIds: [], confidence: 'low' as const }
    })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }), bindingService: bindings, classifyCurrentItem,
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [
        { id: 'source-a', title: 'Source A', itemCount: 2, isBilimiWorkFolder: false },
        { id: 'source-b', title: 'Source B', itemCount: 1, isBilimiWorkFolder: false }
      ]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source-a', page: 1,
      items: [
        { aid: 1, title: 'Alpha first', author: 'UP Alpha', sourceFolderIds: ['source-a'] },
        { aid: 2, title: 'Manual', author: 'UP Alpha', sourceFolderIds: ['source-a'] }
      ]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source-b', page: 1,
      items: [{ aid: 3, title: 'Other', author: 'UP Beta', sourceFolderIds: ['source-b'] }]
    })
    await coordinator.finishScan('100')
    await coordinator.selectSourceFolders('100', ['source-a'])
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 2, targetLedgerIds: ['manual'] }]
    })
    await coordinator.autoClassifyCurrentSegment('100')

    await coordinator.setRecommendedCandidates('100', ['custom-author-up-alpha'])

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      recommendations: {
        candidates: [expect.objectContaining({
          id: 'custom-author-up-alpha', kind: 'author', count: 2
        })],
        adoptedCandidateIds: ['custom-author-up-alpha']
      },
      classifications: {
        '1': { targetLedgerIds: ['custom-author-up-alpha'], source: 'system-high' },
        '2': { targetLedgerIds: ['manual'], source: 'manual' }
      }
    })
    expect(classifyCurrentItem).toHaveBeenLastCalledWith(
      expect.objectContaining({ aid: 1 }),
      expect.arrayContaining([expect.objectContaining({ id: 'custom-author-up-alpha' })])
    )

    await coordinator.setRecommendedCandidates('100', [])
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      recommendations: { adoptedCandidateIds: [] },
      classifications: {
        '1': { targetLedgerIds: [], source: 'system-low' },
        '2': { targetLedgerIds: ['manual'], source: 'manual' }
      }
    })

    await bindings.preparePhysicalShard('100', {
      logicalLedgerId: 'manual', logicalTitle: 'bilimi·人工调整', shardNumber: 1, memberAids: [], observedAccountMid: '100',
      remoteFolderId: 'remote-manual', inventory: [{
        id: 'remote-manual', title: favoriteRepositoryManagedShardTitle('manual', 1, 'a1b2c3'), memberCount: 0, memberAids: []
      }]
    })
    await expect(coordinator.freezeForBilibiliExecution('100')).resolves.toMatchObject({
      frozenSyncPlan: { operations: [{ aid: 2, folderIds: ['remote-manual'] }] }
    })
    expect((await repository.getSnapshot('100')).workspace?.frozenSyncPlan?.operations).toHaveLength(1)
  })

  it('creates bounded high-frequency tag recommendations from scanned tag metadata', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'First', tags: ['TypeScript', '  TypeScript  ', '视频'], sourceFolderIds: ['source'] },
        { aid: 2, title: 'Second', tags: ['TypeScript', '视频'], sourceFolderIds: ['source'] },
        { aid: 3, title: 'Third', tags: ['TypeScript', '教程'], sourceFolderIds: ['source'] }
      ]
    })

    await coordinator.finishScan('100')

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      recommendations: {
        candidates: expect.arrayContaining([
          expect.objectContaining({
            id: 'custom-tag-typescript', displayName: 'bilimi·TypeScript', kind: 'tag', count: 3
          })
        ])
      }
    })
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      recommendations: {
        candidates: expect.not.arrayContaining([
          expect.objectContaining({ displayName: 'bilimi·视频' }),
          expect.objectContaining({ displayName: 'bilimi·教程' })
        ])
      }
    })
  })

  it('saves an adopted recommendation as a local ledger rule before reclassifying', async () => {
    const root = await createRoot()
    const saved = vi.fn().mockResolvedValue(undefined)
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      saveRecommendedLedgers: saved,
      classifyCurrentItem: () => ({ targetLedgerIds: ['music'], confidence: 'high' })
    })
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'Alpha 1', author: 'UP Alpha', tags: [], category: '', sourceFolderIds: ['source'] },
        { aid: 2, title: 'Alpha 2', author: 'UP Alpha', tags: [], category: '', sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')

    await coordinator.setRecommendedCandidates('100', ['custom-author-up-alpha'])

    expect(saved).toHaveBeenCalledWith('100', [expect.objectContaining({
      id: 'custom-author-up-alpha', displayName: 'bilimi·UP Alpha', keywords: ['UP Alpha'],
      ruleType: 'author', enabled: true, isDefault: false
    })])
  })

  it('removes a previously adopted recommendation rule when its checkbox is cleared', async () => {
    const root = await createRoot()
    const saved = vi.fn().mockResolvedValue(undefined)
    const removed = vi.fn().mockResolvedValue(undefined)
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      saveRecommendedLedgers: saved,
      removeRecommendedLedgers: removed,
      classifyCurrentItem: () => ({ targetLedgerIds: ['music'], confidence: 'high' })
    })
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'Alpha 1', author: 'UP Alpha', sourceFolderIds: ['source'] },
        { aid: 2, title: 'Alpha 2', author: 'UP Alpha', sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')

    await coordinator.setRecommendedCandidates('100', ['custom-author-up-alpha'])
    await coordinator.setRecommendedCandidates('100', [])

    expect(removed).toHaveBeenCalledWith('100', ['custom-author-up-alpha'])
  })

  it('creates a local logical ledger in the repository and reclassifies system results without changing manual decisions', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      classifyCurrentItem: (_item, ledgers = []) => ledgers.some((ledger) => ledger.id === 'local-music')
        ? { targetLedgerIds: ['local-music'], confidence: 'high' }
        : { targetLedgerIds: ['music'], confidence: 'high' },
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1, 2] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 2, targetLedgerIds: ['manual'] }]
    })

    await coordinator.createLocalLedgerAndReclassify('100', 'Music')
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      recommendations: { adoptedCandidateIds: ['local-music'] },
      classifications: {
        '1': { targetLedgerIds: ['local-music'], source: 'system-high' },
        '2': { targetLedgerIds: ['manual'], source: 'manual' }
      }
    })
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      folders: [expect.objectContaining({ id: 'local:local-music', title: 'Music', kind: 'local', syncState: 'local-only' })]
    })
  })

  it('restores adopted recommendations without leaking them across accounts', async () => {
    const root = await createRoot()
    const first = new OldFavoriteWorkspaceCoordinator({
      repository: new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' }),
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await first.open('100')
    await first.beginScan('100', 'incremental')
    await first.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'Alpha part 1', author: 'UP Alpha', sourceFolderIds: ['source'] },
        { aid: 2, title: 'Alpha part 2', author: 'UP Alpha', sourceFolderIds: ['source'] }
      ]
    })
    await first.finishScan('100')
    await first.setRecommendedCandidates('100', ['custom-author-up-alpha'])
    await first.open('200')

    const restored = new OldFavoriteWorkspaceCoordinator({
      repository: new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' }),
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await expect(restored.getSnapshot('100')).resolves.toMatchObject({
      recommendations: { adoptedCandidateIds: ['custom-author-up-alpha'] }
    })
    await expect(restored.getSnapshot('200')).resolves.toMatchObject({
      recommendations: { candidates: [], adoptedCandidateIds: [] }
    })
  })

  it('uses an adopted recommendation display name when requesting its first physical shard', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const ensurePhysicalShard = vi.fn().mockResolvedValue({})
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      bindingService: { ensurePhysicalShard },
      classifyCurrentItem: (item, recommendedLedgers = []) => item.author === 'UP Alpha' && recommendedLedgers.length
        ? { targetLedgerIds: [recommendedLedgers[0]!.id], confidence: 'high' }
        : { targetLedgerIds: [], confidence: 'low' },
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'Alpha one', author: 'UP Alpha', sourceFolderIds: ['source'] },
        { aid: 2, title: 'Alpha two', author: 'UP Alpha', sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')
    await coordinator.setRecommendedCandidates('100', ['custom-author-up-alpha'])

    await expect(coordinator.freezeForBilibiliExecution('100')).rejects.toThrow('remote-target-unbound')
    expect(ensurePhysicalShard).toHaveBeenCalledWith('100', expect.objectContaining({
      logicalLedgerId: 'custom-author-up-alpha',
      logicalTitle: 'bilimi\u00b7UP Alpha',
      remoteDisplayTitle: 'bilimi\u00b7UP Alpha',
      shardNumber: 1
    }))
  })

  it('keeps one remote organization round coherent from scan through protected incremental follow-up', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const append = vi.fn().mockResolvedValue({ observedAccountMid: '100' })
    const syncService = new FavoriteRepositorySyncService({
      repository,
      pageBridge: { append, remove: vi.fn(), readMembers: vi.fn() },
      now: () => '2026-07-20T00:00:00.000Z',
      pacingMs: 0
    })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      syncService,
      classifyCurrentItem: (item, recommendedLedgers = []) => item.aid === 1 &&
        recommendedLedgers.some((ledger) => ledger.id === 'custom-author-up-alpha')
        ? { targetLedgerIds: ['custom-author-up-alpha'], confidence: 'high' }
        : { targetLedgerIds: ['music'], confidence: 'high' },
      now: () => '2026-07-20T00:00:00.000Z'
    })
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })

    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [
        { id: 'source', title: 'Source', itemCount: 3, isBilimiWorkFolder: false },
        { id: 'bilimi-empty', title: 'bilimi inbox', itemCount: 0, isBilimiWorkFolder: true }
      ]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'Alpha one', author: 'UP Alpha', sourceFolderIds: ['source'] },
        { aid: 2, title: 'Alpha two', author: 'UP Alpha', sourceFolderIds: ['source'] },
        { aid: 3, title: 'Manual', author: 'UP Beta', sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')
    await coordinator.selectSourceFolders('100', ['source'])
    await coordinator.autoClassifyCurrentSegment('100')
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      classifications: {
        '1': { targetLedgerIds: ['music'], source: 'system-high' },
        '2': { targetLedgerIds: ['music'], source: 'system-high' },
        '3': { targetLedgerIds: ['music'], source: 'system-high' }
      }
    })
    await coordinator.setRecommendedCandidates('100', ['custom-author-up-alpha'])
    const deepSeekInput = await coordinator.getSnapshot('100')
    if ('recovery' in deepSeekInput || !deepSeekInput.currentSegment) throw new Error('workspace unexpectedly unavailable')
    await coordinator.applyDeepSeekClassificationBatch('100', [{ aid: 2, targetLedgerIds: ['knowledge'] }], {
      workspaceId: deepSeekInput.workspaceId,
      currentSegmentId: deepSeekInput.currentSegment.id,
      selectedSourceFolderIds: ['source'],
      classifications: {
        '1': { targetLedgerIds: ['custom-author-up-alpha'], source: 'system-high' },
        '2': { targetLedgerIds: ['music'], source: 'system-high' },
        '3': { targetLedgerIds: ['music'], source: 'system-high' }
      }
    })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 3, targetLedgerIds: ['manual'] }]
    })
    await coordinator.undoClassificationChange('100')
    await coordinator.redoClassificationChange('100')
    await coordinator.setRecommendedCandidates('100', [])
    await coordinator.setRecommendedCandidates('100', ['custom-author-up-alpha'])
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      classifications: {
        '1': { targetLedgerIds: ['custom-author-up-alpha'], source: 'system-high' },
        '2': { targetLedgerIds: ['knowledge'], source: 'deepseek' },
        '3': { targetLedgerIds: ['manual'], source: 'manual' }
      }
    })

    const restartedRepository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const restarted = new OldFavoriteWorkspaceCoordinator({
      repository: restartedRepository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      syncService: new FavoriteRepositorySyncService({
        repository: restartedRepository,
        pageBridge: { append, remove: vi.fn(), readMembers: vi.fn() },
        now: () => '2026-07-20T00:00:00.000Z',
        pacingMs: 0
      }),
      classifyCurrentItem: () => ({ targetLedgerIds: ['music'], confidence: 'high' }),
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({
      status: 'previewing',
      classifications: {
        '1': { targetLedgerIds: ['custom-author-up-alpha'], source: 'system-high' },
        '2': { targetLedgerIds: ['knowledge'], source: 'deepseek' },
        '3': { targetLedgerIds: ['manual'], source: 'manual' }
      },
      history: { cursor: 6, length: 6 }
    })

    for (const [logicalLedgerId, remoteFolderId] of [
      ['custom-author-up-alpha', 'remote-alpha'], ['knowledge', 'remote-knowledge'], ['manual', 'remote-manual']
    ]) {
      const remoteTitle = favoriteRepositoryManagedShardTitle(logicalLedgerId, 1, 'a1b2c3')
      await bindings.preparePhysicalShard('100', {
        logicalLedgerId, logicalTitle: logicalLedgerId, shardNumber: 1, memberAids: [], observedAccountMid: '100',
        remoteFolderId,
        inventory: [{ id: remoteFolderId, title: remoteTitle, memberCount: 0, memberAids: [] }]
      })
    }
    const restartedRepositoryAfterBindings = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const restartedAfterBindings = new OldFavoriteWorkspaceCoordinator({
      repository: restartedRepositoryAfterBindings,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      syncService: new FavoriteRepositorySyncService({
        repository: restartedRepositoryAfterBindings,
        pageBridge: { append, remove: vi.fn(), readMembers: vi.fn() },
        now: () => '2026-07-20T00:00:00.000Z',
        pacingMs: 0
      }),
      classifyCurrentItem: () => ({ targetLedgerIds: ['music'], confidence: 'high' }),
      now: () => '2026-07-20T00:00:00.000Z'
    })

    await expect(restartedAfterBindings.freezeForBilibiliExecution('100')).resolves.toMatchObject({
      status: 'frozen', frozenSyncPlan: { operations: expect.arrayContaining([
        expect.objectContaining({ aid: 1, folderIds: ['remote-alpha'] }),
        expect.objectContaining({ aid: 2, folderIds: ['remote-knowledge'] }),
        expect.objectContaining({ aid: 3, folderIds: ['remote-manual'] })
      ]) }
    })
    await expect(restartedAfterBindings.executeFrozenBilibiliPlan('100')).resolves.toMatchObject({ status: 'succeeded' })
    expect(append).toHaveBeenCalledTimes(3)
    await expect(restartedAfterBindings.getSnapshot('100')).resolves.toMatchObject({
      status: 'completed', classifications: {}, history: { cursor: 0, length: 0 }
    })

    await restartedAfterBindings.beginScan('100', 'incremental')
    await restartedAfterBindings.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [1, 2, 3, 4].map((aid) => ({ aid, title: `Video ${aid}`, sourceFolderIds: ['source'] }))
    })
    await restartedAfterBindings.finishScan('100')

    await expect(restartedAfterBindings.getSnapshot('100')).resolves.toMatchObject({
      status: 'previewing', mode: 'incremental', currentSegment: { aids: [4] }
    })
  })

  it('saves only selected-source classifications to the local library', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [
        { id: 'source-a', title: 'Source A', itemCount: 1, isBilimiWorkFolder: false },
        { id: 'source-b', title: 'Source B', itemCount: 1, isBilimiWorkFolder: false }
      ]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source-a', page: 1,
      items: [{ aid: 1, title: 'Selected', sourceFolderIds: ['source-a'] }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source-b', page: 1,
      items: [{ aid: 2, title: 'Deselected', sourceFolderIds: ['source-b'] }]
    })
    await coordinator.finishScan('100')
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }, { aid: 2, targetLedgerIds: ['knowledge'] }]
    })
    await coordinator.selectSourceFolders('100', ['source-a'])

    await coordinator.saveCurrentSegmentToLocalLibrary('100')

    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      memberships: { 'local:music': [1] },
      organizationRecords: [expect.objectContaining({ aid: 1 })]
    })
    const snapshot = await repository.getSnapshot('100')
    expect(snapshot.memberships['local:knowledge']).toBeUndefined()
  })

  it('freezes only selected-source classifications for Bilibili execution', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [
        { id: 'source-a', title: 'Source A', itemCount: 1, isBilimiWorkFolder: false },
        { id: 'source-b', title: 'Source B', itemCount: 1, isBilimiWorkFolder: false }
      ]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source-a', page: 1,
      items: [{ aid: 1, title: 'Selected', sourceFolderIds: ['source-a'] }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source-b', page: 1,
      items: [{ aid: 2, title: 'Deselected', sourceFolderIds: ['source-b'] }]
    })
    await coordinator.finishScan('100')
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }, { aid: 2, targetLedgerIds: ['knowledge'] }]
    })
    await coordinator.selectSourceFolders('100', ['source-a'])
    await bindings.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: '闊充箰', shardNumber: 1, memberAids: [], observedAccountMid: '100',
      remoteFolderId: 'remote-music-1',
      inventory: [{ id: 'remote-music-1', title: 'B-music-001-a1b2c3', memberCount: 0, memberAids: [] }]
    })

    await expect(coordinator.freezeForBilibiliExecution('100')).resolves.toMatchObject({
      frozenSyncPlan: { operations: [{ aid: 1, folderIds: ['remote-music-1'] }] }
    })
  })

  it('does not freeze classifications after every selectable source is deselected', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1, items: [{ aid: 1, title: 'Video', sourceFolderIds: ['source'] }]
    })
    await coordinator.finishScan('100')
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })
    await coordinator.selectSourceFolders('100', [])

    await expect(coordinator.freezeForBilibiliExecution('100')).resolves.toMatchObject({
      frozenSyncPlan: { operations: [] }
    })
  })

  it('does not freeze classifications when source-selection metadata is unavailable', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })
    await bindings.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber: 1, memberAids: [], observedAccountMid: '100',
      remoteFolderId: 'remote-music-1',
      inventory: [{ id: 'remote-music-1', title: 'B-music-001-a1b2c3', memberCount: 0, memberAids: [] }]
    })
    ;(coordinator as unknown as { scanOverviews: Map<string, unknown> }).scanOverviews.delete('100')

    await expect(coordinator.freezeForBilibiliExecution('100')).resolves.toMatchObject({
      frozenSyncPlan: { operations: [] }
    })
  })

  it('freezes a main-process sync plan using only persisted bound physical shard ids', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })
    await bindings.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: '音乐', shardNumber: 1, memberAids: [], observedAccountMid: '100',
      remoteFolderId: 'remote-music-1',
      inventory: [{ id: 'remote-music-1', title: 'B-music-001-a1b2c3', memberCount: 0, memberAids: [] }]
    })

    await expect(coordinator.freezeForBilibiliExecution('100')).resolves.toMatchObject({
      status: 'frozen', frozenSyncPlan: {
        accountMid: '100', workspaceId: expect.any(String), baselineRevision: 1,
        operations: [{ aid: 1, kind: 'append', folderIds: ['remote-music-1'] }]
      }
    })
  })

  it('saves the classified current segment to local library folders without binding or executing Bilibili', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1, 2] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [
        { aid: 1, targetLedgerIds: ['music'] }, { aid: 2, targetLedgerIds: ['knowledge'] }
      ]
    })

    await expect(coordinator.saveCurrentSegmentToLocalLibrary('100')).resolves.toMatchObject({ status: 'completed' })
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      folders: expect.arrayContaining([
        expect.objectContaining({ id: 'local:music', kind: 'local', syncState: 'local-only' }),
        expect.objectContaining({ id: 'local:knowledge', kind: 'local', syncState: 'local-only' })
      ]),
      memberships: { 'local:music': [1], 'local:knowledge': [2] },
      workspace: { status: 'completed' }
    })
  })

  it('keeps existing local library members when saving a classified segment', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    await repository.commit('100', {
      id: 'existing-local', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'commit-local-plan',
      payload: {
        workspaceId: 'previous', memberAidsByFolderId: { 'local:music': [9] },
        folders: [{ id: 'local:music', title: 'music', kind: 'local', syncState: 'local-only' }]
      }
    })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })

    await coordinator.saveCurrentSegmentToLocalLibrary('100')

    await expect(repository.getSnapshot('100')).resolves.toMatchObject({ memberships: { 'local:music': [1, 9] } })
  })

  it('makes locally saved scan items visible through their local library folder', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [{ aid: 1, title: 'Saved locally', author: 'UP', sourceFolderIds: ['source'] }]
    })
    await coordinator.finishScan('100')
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })

    await coordinator.saveCurrentSegmentToLocalLibrary('100')

    await expect(repository.getFolderPage('100', 'local:music', { limit: 10 })).resolves.toMatchObject({
      items: [expect.objectContaining({ aid: 1, title: 'Saved locally', author: 'UP' })]
    })
  })

  it('stores unclassified selected videos in the local inbox without marking them as organized', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [{ aid: 1, title: 'Needs classification', author: 'UP', sourceFolderIds: ['source'] }]
    })
    await coordinator.finishScan('100')

    await expect(coordinator.saveCurrentSegmentToLocalLibrary('100')).resolves.toMatchObject({
      status: 'completed', completionMode: 'local'
    })
    await expect(repository.getFolderPage('100', 'local:inbox', { limit: 10 })).resolves.toMatchObject({
      items: [expect.objectContaining({ aid: 1, title: 'Needs classification' })]
    })
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      organizationRecords: []
    })
  })

  it('commits local memberships, protections, and the completed workspace marker together', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })
    const commit = vi.spyOn(repository, 'commit')

    await coordinator.saveCurrentSegmentToLocalLibrary('100')

    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit.mock.calls[0]?.[1]).toMatchObject({
      type: 'commit-local-plan',
      payload: {
        workspace: { status: 'completed', completionMode: 'local' },
        organizationRecords: [{ aid: 1, targetFolderIds: ['local:music'] }]
      }
    })
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      workspace: { status: 'completed', completionMode: 'local' },
      organizationRecords: [expect.objectContaining({ aid: 1, targetFolderIds: ['local:music'] })]
    })
  })

  it('protects locally saved classifications in the next incremental workspace', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })
    await coordinator.saveCurrentSegmentToLocalLibrary('100')

    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [1, 2].map((aid) => ({ aid, title: `Video ${aid}`, sourceFolderIds: ['source'] }))
    })
    await coordinator.finishScan('100')

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      mode: 'incremental',
      currentSegment: { aids: [2] }
    })
  })

  it('keeps saved local protections after restart while leaving unprotected aids in the incremental scan', async () => {
    const root = await createRoot()
    const firstRepository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const first = createCoordinator(firstRepository, new OldFavoriteWorkspaceStore({ root }))
    await first.open('100')
    await first.completeScan('100', { revision: 1, aids: [1] })
    await first.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })
    await first.saveCurrentSegmentToLocalLibrary('100')

    const restarted = createCoordinator(
      new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:01.000Z' }),
      new OldFavoriteWorkspaceStore({ root })
    )
    await restarted.beginScan('100', 'incremental')
    await restarted.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [1, 2].map((aid) => ({ aid, title: `Video ${aid}`, sourceFolderIds: ['source'] }))
    })
    await restarted.finishScan('100')

    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({
      currentSegment: { aids: [2] }
    })
  })

  it('commits every classified segment to the local library in one atomic local-only round', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: Array.from({ length: 2_001 }, (_, index) => index + 1) })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: Array.from({ length: 2_000 }, (_, index) => ({ aid: index + 1, targetLedgerIds: ['music'] }))
    })
    await coordinator.selectSegment('100', 'segment-2')
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 2_001, targetLedgerIds: ['music'] }]
    })

    await expect(coordinator.saveCurrentSegmentToLocalLibrary('100')).resolves.toMatchObject({ status: 'completed', completionMode: 'local' })
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      memberships: { 'local:music': expect.arrayContaining([1, 2_001]) }, workspace: { status: 'completed' }
    })
  })

  it('freezes one remote plan that deduplicates classifications from every prepared segment', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    const aids = Array.from({ length: 2_001 }, (_, index) => index + 1)
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: Array.from({ length: 2_000 }, (_, index) => ({ aid: index + 1, targetLedgerIds: ['music'] }))
    })
    await coordinator.selectSegment('100', 'segment-2')
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 2_001, targetLedgerIds: ['music'] }]
    })
    for (const shardNumber of [1, 2, 3]) {
      const remoteFolderId = `remote-music-${shardNumber}`
      await bindings.preparePhysicalShard('100', {
        logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber, memberAids: [], observedAccountMid: '100',
        remoteFolderId,
        inventory: [{
          id: remoteFolderId, title: favoriteRepositoryManagedShardTitle('music', shardNumber, 'a1b2c3'), memberCount: 0, memberAids: []
        }]
      })
    }

    await expect(coordinator.freezeForBilibiliExecution('100')).resolves.toMatchObject({
      status: 'frozen', frozenSyncPlan: { operations: expect.arrayContaining([
        expect.objectContaining({ aid: 1 }),
        expect.objectContaining({ aid: 2_001 })
      ]) }
    })
    expect((await repository.getSnapshot('100')).workspace?.frozenSyncPlan?.operations).toHaveLength(2_001)
  })

  it('stages unclassified videos locally while freezing only classified videos for Bilibili', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1, 2] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })
    await bindings.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber: 1, memberAids: [], observedAccountMid: '100',
      remoteFolderId: 'remote-music', inventory: [{
        id: 'remote-music', title: favoriteRepositoryManagedShardTitle('music', 1, 'a1b2c3'), memberCount: 0, memberAids: []
      }]
    })

    await expect(coordinator.freezeForBilibiliExecution('100')).resolves.toMatchObject({
      status: 'frozen', frozenSyncPlan: { operations: [expect.objectContaining({ aid: 1, folderIds: ['remote-music'] })] }
    })
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      memberships: { 'local:inbox': [2] }
    })
    expect((await repository.getSnapshot('100')).workspace?.frozenSyncPlan?.operations).toHaveLength(1)
  })

  it('keeps an explicitly staged inbox classification out of the Bilibili freeze plan', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const ensurePhysicalShard = vi.fn()
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      bindingService: { ensurePhysicalShard }, now: () => '2026-07-20T00:00:00.000Z'
    })
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1, items: [{ aid: 1, title: 'Pending', sourceFolderIds: ['source'] }]
    })
    await coordinator.finishScan('100')
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['inbox'] }]
    })

    await coordinator.freezeForBilibiliExecution('100')

    expect(ensurePhysicalShard).not.toHaveBeenCalled()
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      memberships: { 'local:inbox': [1] },
      workspace: { frozenSyncPlan: { operations: [] } }
    })
  })

  it('stages unclassified recovered segments while completing the local-only round', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const first = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await first.open('100')
    await first.completeScan('100', { revision: 1, aids: Array.from({ length: 2_001 }, (_, index) => index + 1) })
    await first.applyClassificationBatch('100', {
      source: 'manual', assignments: Array.from({ length: 2_000 }, (_, index) => ({ aid: index + 1, targetLedgerIds: ['music'] }))
    })
    const restored = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))

    await expect(restored.saveCurrentSegmentToLocalLibrary('100')).resolves.toMatchObject({ status: 'completed', completionMode: 'local' })
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      memberships: { 'local:inbox': [2_001] }
    })
  })

  it('refuses to freeze a Bilibili sync plan for an unbound logical target', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })

    await expect(coordinator.freezeForBilibiliExecution('100')).rejects.toThrow('remote-target-unbound')
    expect((await repository.getSnapshot('100')).workspace?.frozenSyncPlan).toBeUndefined()
  })

  it('ensures missing physical shards in the main process before compiling a single confirmed plan', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const ensurePhysicalShard = vi.fn().mockResolvedValue({})
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      bindingService: { ensurePhysicalShard }, now: () => '2026-07-20T00:00:00.000Z'
    })
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })

    await expect(coordinator.freezeForBilibiliExecution('100')).rejects.toThrow('remote-target-unbound')
    expect(ensurePhysicalShard).toHaveBeenCalledWith('100', {
      logicalLedgerId: 'music', logicalTitle: 'bilimi·音乐舞台', remoteDisplayTitle: 'bilimi·音乐舞台', shardNumber: 1, memberAids: []
    })
  })

  it('ensures numbered physical shards when one logical ledger needs more than 1000 new members', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root })
    const ensurePhysicalShard = vi.fn().mockResolvedValue({})
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }), bindingService: { ensurePhysicalShard }
    })
    const aids = Array.from({ length: 1_001 }, (_, index) => index + 1)
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: aids.map((aid) => ({ aid, targetLedgerIds: ['music'] }))
    })

    await expect(coordinator.freezeForBilibiliExecution('100')).rejects.toThrow('remote-target-unbound')
    expect(ensurePhysicalShard).toHaveBeenNthCalledWith(1, '100', expect.objectContaining({ logicalLedgerId: 'music', shardNumber: 1 }))
    expect(ensurePhysicalShard).toHaveBeenNthCalledWith(2, '100', expect.objectContaining({ logicalLedgerId: 'music', shardNumber: 2 }))
  })

  it('resolves a saved custom ledger title before preparing its remote shard', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root })
    const ensurePhysicalShard = vi.fn().mockResolvedValue({})
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      bindingService: { ensurePhysicalShard },
      resolveLedgerTitle: vi.fn().mockResolvedValue('bilimi·你好')
    })
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['custom-saved-ledger'] }]
    })

    await expect(coordinator.freezeForBilibiliExecution('100')).rejects.toThrow('remote-target-unbound')
    expect(ensurePhysicalShard).toHaveBeenCalledWith('100', {
      logicalLedgerId: 'custom-saved-ledger', logicalTitle: 'bilimi·你好', remoteDisplayTitle: 'bilimi·你好', shardNumber: 1, memberAids: []
    })
  })

  it('allocates another physical shard when a bound remote folder is nearly full but local members are incomplete', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root })
    const ensurePhysicalShard = vi.fn().mockResolvedValue({})
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }), bindingService: { ensurePhysicalShard }
    })
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    await bindings.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber: 1, memberAids: [], observedAccountMid: '100',
      remoteFolderId: 'remote-music-1',
      inventory: [{ id: 'remote-music-1', title: 'B-music-001-a1b2c3', memberCount: 999, memberAids: [] }]
    })
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1, 2] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }, { aid: 2, targetLedgerIds: ['music'] }]
    })

    await expect(coordinator.freezeForBilibiliExecution('100')).rejects.toThrow('physical-shard-capacity-exceeded')
    expect(ensurePhysicalShard).toHaveBeenCalledWith('100', expect.objectContaining({ logicalLedgerId: 'music', shardNumber: 2 }))
  })

  it('uses local membership when it exceeds an older persisted remote count during freeze compilation', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    const memberAids = Array.from({ length: 1_000 }, (_, index) => index + 1)
    await bindings.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber: 1, memberAids, observedAccountMid: '100',
      remoteFolderId: 'remote-music-1',
      inventory: [{ id: 'remote-music-1', title: 'B-music-001-a1b2c3', memberCount: 999, memberAids }]
    })
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })

    await expect(coordinator.freezeForBilibiliExecution('100')).resolves.toMatchObject({
      status: 'frozen', frozenSyncPlan: { operations: [{ aid: 1, folderIds: ['remote-music-1'] }] }
    })
  })

  it('does not create a shard for a classified aid already present in a nearly full bound remote folder', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root })
    const ensurePhysicalShard = vi.fn()
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }), bindingService: { ensurePhysicalShard }
    })
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    await bindings.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber: 1, memberAids: [1], observedAccountMid: '100',
      remoteFolderId: 'remote-music-1',
      inventory: [{ id: 'remote-music-1', title: 'B-music-001-a1b2c3', memberCount: 999, memberAids: [1] }]
    })
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1, 2] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }, { aid: 2, targetLedgerIds: ['music'] }]
    })

    await expect(coordinator.freezeForBilibiliExecution('100')).resolves.toMatchObject({
      status: 'frozen', frozenSyncPlan: {
        operations: [{ aid: 1, folderIds: ['remote-music-1'] }, { aid: 2, folderIds: ['remote-music-1'] }]
      }
    })
    expect(ensurePhysicalShard).not.toHaveBeenCalled()
  })

  it('executes only the persisted frozen Bilibili plan through the main-process sync service', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const executeFrozenPlan = vi.fn().mockResolvedValue({ id: 'run-1', status: 'succeeded' })
    const getRun = vi.fn().mockResolvedValue({ id: 'run-1', status: 'running' })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      syncService: { executeFrozenPlan, getRun }, now: () => '2026-07-20T00:00:00.000Z'
    })
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })
    await bindings.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: '音乐', shardNumber: 1, memberAids: [], observedAccountMid: '100',
      remoteFolderId: 'remote-music-1',
      inventory: [{ id: 'remote-music-1', title: 'B-music-001-a1b2c3', memberCount: 0, memberAids: [] }]
    })
    await coordinator.freezeForBilibiliExecution('100')

    await expect(coordinator.executeFrozenBilibiliPlan('100')).resolves.toMatchObject({ id: 'run-1', status: 'succeeded' })
    const persisted = (await repository.getSnapshot('100')).workspace?.frozenSyncPlan
    expect(executeFrozenPlan).toHaveBeenCalledWith('100', persisted)
  })

  it('freezes and starts a Bilibili plan from one explicit confirmation', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const executeFrozenPlan = vi.fn().mockResolvedValue({ id: 'run-1', status: 'running' })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      syncService: { executeFrozenPlan, getRun: vi.fn().mockResolvedValue({ id: 'run-1', status: 'running' }) },
      now: () => '2026-07-20T00:00:00.000Z'
    })
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })
    await bindings.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber: 1, memberAids: [], observedAccountMid: '100',
      remoteFolderId: 'remote-music-1',
      inventory: [{ id: 'remote-music-1', title: favoriteRepositoryManagedShardTitle('music', 1, 'a1b2c3'), memberCount: 0, memberAids: [] }]
    })

    await expect(coordinator.confirmAndExecuteBilibiliPlan('100')).resolves.toMatchObject({ id: 'run-1', status: 'running' })
    expect(executeFrozenPlan).toHaveBeenCalledWith('100', expect.objectContaining({ operations: [expect.objectContaining({ aid: 1 })] }))
  })

  it('finishes an all-checkpoint-successful plan without rebinding and exposes the cleared completed snapshot', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const bind = vi.fn()
    const append = vi.fn()
    const syncService = new FavoriteRepositorySyncService({
      repository,
      pageBridgeManager: {
        bind,
        release: vi.fn(),
        pageBridge: vi.fn(() => ({
          append, remove: vi.fn(), readMembers: vi.fn(), readFolderInventory: vi.fn(), createFolder: vi.fn()
        }))
      },
      now: () => '2026-07-20T00:00:00.000Z'
    })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }), syncService,
      now: () => '2026-07-20T00:00:00.000Z'
    })
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })
    await bindings.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber: 1, memberAids: [], observedAccountMid: '100',
      remoteFolderId: 'remote-music-1',
      inventory: [{ id: 'remote-music-1', title: 'B-music-001-a1b2c3', memberCount: 0, memberAids: [] }]
    })
    await coordinator.freezeForBilibiliExecution('100')
    const plan = (await repository.getSnapshot('100')).workspace!.frozenSyncPlan!
    await repository.recordSyncCheckpoint('100', 'already-succeeded', {
      id: `${plan.id}:${plan.operations[0].operationKey}`,
      commandId: plan.operations[0].operationKey,
      status: 'succeeded',
      affectedAids: [1],
      updatedAt: '2026-07-20T00:00:00.000Z',
      runId: plan.id,
      operationKey: plan.operations[0].operationKey,
      attempt: 1
    })

    await expect(coordinator.executeFrozenBilibiliPlan('100')).resolves.toMatchObject({ status: 'succeeded' })
    expect(bind).not.toHaveBeenCalled()
    expect(append).not.toHaveBeenCalled()
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      status: 'completed', classifications: {}, history: { cursor: 0, length: 0 }
    })
  })

  it('does not execute a workspace that has not yet persisted a frozen plan', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const executeFrozenPlan = vi.fn()
    const getRun = vi.fn()
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }), syncService: { executeFrozenPlan, getRun }
    })
    await coordinator.open('100')

    await expect(coordinator.executeFrozenBilibiliPlan('100')).rejects.toThrow('not frozen')
    expect(executeFrozenPlan).not.toHaveBeenCalled()
  })

  it('keeps the compact workspace snapshot readable while remote execution is awaiting a checkpoint', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const waiting = deferred<{ id: string; status: 'running' }>()
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      syncService: { executeFrozenPlan: vi.fn().mockReturnValue(waiting.promise), getRun: vi.fn().mockResolvedValue({ id: 'run-1', status: 'running' }) }
    })
    await coordinator.open('100')
    await repository.commit('100', {
      id: 'frozen', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'set-workspace', payload: {
        id: 'workspace-1', accountMid: '100', status: 'frozen', baselineRevision: 1, continuationAids: [],
        workspaceRef: { workspaceId: 'workspace-1', accountMid: '100', status: 'frozen', baselineRevision: 1,
          currentSegmentId: 'segment-1', overlayRevision: 0, journalCursor: 0, checksum: 'a'.repeat(64) },
        frozenSyncPlan: { id: 'run-1', accountMid: '100', workspaceId: 'workspace-1', baselineRevision: 1,
          createdAt: '2026-07-20T00:00:00.000Z', operations: [{ operationKey: 'append-1', aid: 1, kind: 'append', folderIds: ['remote-1'] }] }
      }
    })

    const executing = coordinator.executeFrozenBilibiliPlan('100')
    await expect(Promise.race([
      coordinator.getSnapshot('100'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('snapshot blocked')), 100))
    ])).resolves.toMatchObject({ accountMid: '100' })
    waiting.resolve({ id: 'run-1', status: 'running' })
    await executing
  })

  it('projects execution progress from the durable frozen plan instead of an in-memory workspace copy', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root })
    const getRun = vi.fn().mockResolvedValue({
      id: 'run-1', status: 'running', completedOperationCount: 3, totalOperationCount: 8
    })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }), syncService: {
        claimFrozenPlan: vi.fn(), executeFrozenPlan: vi.fn(), bindPageTarget: vi.fn(), reconcile: vi.fn(), resume: vi.fn(), getRun
      }
    })
    const executing = {
      ...createOldFavoriteWorkspace({ accountMid: '100', now: '2026-07-20T00:00:00.000Z' }),
      status: 'executing' as const
    }
    vi.spyOn(coordinator as unknown as { openUnsafe: (accountMid: string) => Promise<typeof executing> }, 'openUnsafe')
      .mockResolvedValue(executing)
    await repository.commit('100', {
      id: 'executing', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'set-workspace', payload: {
        id: executing.id, accountMid: '100', status: 'executing', baselineRevision: 0, continuationAids: [],
        workspaceRef: { workspaceId: executing.id, accountMid: '100', status: 'executing', baselineRevision: 0,
          currentSegmentId: '', overlayRevision: 0, journalCursor: 0, checksum: 'a'.repeat(64) },
        frozenSyncPlan: { id: 'run-1', accountMid: '100', workspaceId: executing.id, baselineRevision: 0,
          createdAt: '2026-07-20T00:00:00.000Z', operations: [] }
      }
    })

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      executionProgress: { completedOperationCount: 3, totalOperationCount: 8 }
    })
    expect(getRun).toHaveBeenCalledWith('100', 'run-1')
  })

  it('requires an explicit page bind before reconciling an unknown frozen run', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root })
    const bindPageTarget = vi.fn().mockResolvedValue(undefined)
    const reconcile = vi.fn().mockResolvedValue({ id: 'run-1', status: 'ready-to-resume' })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      syncService: { executeFrozenPlan: vi.fn(), bindPageTarget, reconcile }
    })
    await coordinator.open('100')
    await repository.commit('100', {
      id: 'frozen', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'set-workspace', payload: {
        id: 'workspace-1', accountMid: '100', status: 'reconciling', baselineRevision: 1, continuationAids: [],
        workspaceRef: { workspaceId: 'workspace-1', accountMid: '100', status: 'reconciling', baselineRevision: 1,
          currentSegmentId: 'segment-1', overlayRevision: 0, journalCursor: 0, checksum: 'a'.repeat(64) },
        frozenSyncPlan: { id: 'run-1', accountMid: '100', workspaceId: 'workspace-1', baselineRevision: 1,
          createdAt: '2026-07-20T00:00:00.000Z', operations: [{ operationKey: 'append-1', aid: 1, kind: 'append', folderIds: ['remote-1'] }] }
      }
    })

    await expect(coordinator.bindAndReconcileFrozenBilibiliPlan('100')).resolves.toMatchObject({ status: 'ready-to-resume' })
    expect(bindPageTarget).toHaveBeenCalledWith('100', 'run-1')
    expect(reconcile).toHaveBeenCalledWith('100', 'run-1')
  })

  it('restores staged source metadata and the active segment after scan finalization', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const first = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await first.open('100')
    await first.beginScan('100', 'incremental')
    await first.recordScanInventory('100', {
      sourceFolders: [{ id: 'source-a', title: 'Source A', itemCount: 1, isBilimiWorkFolder: false }]
    })
    await first.recordScanPage('100', {
      folderId: 'source-a', page: 1,
      items: [{ aid: 1, title: 'Recovered title', author: 'Recovered UP', sourceFolderIds: ['source-a'] }]
    })
    await first.finishScan('100')

    await expect(createCoordinator(
      new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' }),
      new OldFavoriteWorkspaceStore({ root })
    ).getSnapshot('100')).resolves.toMatchObject({
      status: 'previewing', scan: { phase: 'complete' },
      sourceFolders: [{ id: 'source-a', itemCount: 1, selected: true }],
      currentSegment: { id: 'segment-1', items: [{ aid: 1, title: 'Recovered title', author: 'Recovered UP', sourceFolderIds: ['source-a'] }] }
    })
  })

  it('defaults legacy non-Bilimi source folders to selected when recovering a preview', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(repository, store)
    const workspace = await first.open('100')
    await first.completeScan('100', { revision: 1, aids: [1] })
    await store.appendOverlay('100', workspace.id, {
      currentSegmentId: 'segment-1', classifications: [], history: [],
      scanMetadata: {
        sourceFolders: [{ id: 'legacy-source', title: 'Legacy source', itemCount: 1, isBilimiWorkFolder: false }]
      }
    })

    await expect(createCoordinator(
      new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' }),
      new OldFavoriteWorkspaceStore({ root })
    ).getSnapshot('100')).resolves.toMatchObject({
      sourceFolders: [{ id: 'legacy-source', selected: true }]
    })
  })

  it('restores source selection and the active segment without leaking either to another account', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(repository, store)
    await first.open('100')
    await first.beginScan('100', 'incremental')
    await first.recordScanInventory('100', {
      sourceFolders: [
        { id: 'source-a', title: 'Source A', itemCount: 1, isBilimiWorkFolder: false },
        { id: 'source-b', title: 'Source B', itemCount: 1, isBilimiWorkFolder: false }
      ]
    })
    await first.completeScan('100', { revision: 1, aids: Array.from({ length: 2_001 }, (_, index) => index + 1) })
    await first.selectSegment('100', 'segment-2')
    await first.selectSourceFolders('100', ['source-b'])

    await first.open('200')
    await first.beginScan('200', 'incremental')
    await first.recordScanInventory('200', {
      sourceFolders: [{ id: 'source-c', title: 'Source C', itemCount: 1, isBilimiWorkFolder: false }]
    })
    await first.completeScan('200', { revision: 1, aids: [3] })

    const recovered = createCoordinator(
      new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' }),
      new OldFavoriteWorkspaceStore({ root })
    )
    await expect(recovered.getSnapshot('100')).resolves.toMatchObject({
      currentSegment: { id: 'segment-2', aids: [2_001] },
      sourceFolders: [
        { id: 'source-a', selected: false },
        { id: 'source-b', selected: true }
      ]
    })
    await expect(recovered.getSnapshot('200')).resolves.toMatchObject({
      currentSegment: { id: 'segment-1', aids: [3] },
      sourceFolders: [{ id: 'source-c', selected: true }]
    })
  })

  it('returns only the current segment in a renderer workspace snapshot', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.completeScan('100', {
      revision: 1,
      aids: Array.from({ length: 2_001 }, (_, index) => index + 1)
    })
    await coordinator.selectSegment('100', 'segment-2')
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 2_001, targetLedgerIds: ['music'] }]
    })

    const snapshot = await coordinator.getSnapshot('100')

    expect(snapshot).toMatchObject({
      version: 1,
      accountMid: '100',
      status: 'previewing',
      currentSegment: { id: 'segment-2', aids: [2_001] },
      classifications: { '2001': { targetLedgerIds: ['music'], source: 'manual' } },
      history: { cursor: 1, length: 1 }
    })
    expect(snapshot).not.toHaveProperty('baseline')
    expect(snapshot).not.toHaveProperty('plannedAids')
    expect(snapshot.segments).toEqual([
      { id: 'segment-1', index: 0, status: 'previewing', itemCount: 2_000 },
      { id: 'segment-2', index: 1, status: 'previewing', itemCount: 1 }
    ])
  })

  it('rejects classification changes outside the loaded current segment', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.completeScan('100', {
      revision: 1,
      aids: Array.from({ length: 2_001 }, (_, index) => index + 1)
    })
    await coordinator.selectSegment('100', 'segment-2')

    await expect(coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })).rejects.toThrow('current segment')
  })

  it('records a main-process DeepSeek batch as one current-segment history entry', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1, 2] })
    const snapshot = await coordinator.getSnapshot('100')
    if ('recovery' in snapshot || !snapshot.currentSegment) throw new Error('workspace unexpectedly unavailable')

    await coordinator.applyDeepSeekClassificationBatch('100', [
      { aid: 1, targetLedgerIds: ['knowledge'] },
      { aid: 2, targetLedgerIds: ['technology'] }
    ], {
      workspaceId: snapshot.workspaceId,
      currentSegmentId: snapshot.currentSegment.id,
      selectedSourceFolderIds: ['legacy-source'],
      classifications: {}
    })

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      classifications: {
        '1': { targetLedgerIds: ['knowledge'], source: 'deepseek' },
        '2': { targetLedgerIds: ['technology'], source: 'deepseek' }
      },
      history: { cursor: 1, length: 1 }
    })
  })

  it('rejects a DeepSeek batch when an equal-target manual classification arrived after its snapshot', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    const snapshot = await coordinator.getSnapshot('100')
    if ('recovery' in snapshot || !snapshot.currentSegment) throw new Error('workspace unexpectedly unavailable')
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })

    await expect(coordinator.applyDeepSeekClassificationBatch('100', [
      { aid: 1, targetLedgerIds: ['music'] }
    ], {
      workspaceId: snapshot.workspaceId,
      currentSegmentId: snapshot.currentSegment.id,
      selectedSourceFolderIds: [],
      classifications: {}
    })).rejects.toThrow('changed while DeepSeek was running')
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      classifications: { '1': { targetLedgerIds: ['music'], source: 'manual' } },
      history: { cursor: 1, length: 1 }
    })
  })

  it('loads the current baseline segment only once during workspace recovery', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const firstStore = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(repository, firstStore)
    await first.open('100')
    await first.completeScan('100', {
      revision: 1,
      aids: Array.from({ length: 2_001 }, (_, index) => index + 1)
    })
    await first.selectSegment('100', 'segment-2')

    const recoveredStore = new OldFavoriteWorkspaceStore({ root })
    const recovered = createCoordinator(
      new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' }),
      recoveredStore
    )

    await recovered.getSnapshot('100')

    const workspaceId = (await repository.getSnapshot('100')).workspace!.id
    await expect(recoveredStore.readWorkspaceReads('100', workspaceId))
      .resolves.toEqual(['manifest.json', 'baseline/segment-2.json', 'overlay.journal.jsonl'])
  })

  it('creates a scanning workspace and persists only its lightweight repository marker', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const coordinator = createCoordinator(repository, workspaceStore)

    const workspace = await coordinator.open('00100')

    expect(workspace).toMatchObject({ accountMid: '100', status: 'scanning' })
    expect((await repository.getSnapshot('100')).workspace).toEqual({
      id: workspace.id,
      accountMid: '100',
      status: 'scanning',
      baselineRevision: 0,
      continuationAids: [],
      workspaceRef: {
        workspaceId: workspace.id,
        accountMid: '100',
        status: 'scanning',
        baselineRevision: 0,
        currentSegmentId: '',
        overlayRevision: 0,
        journalCursor: 0,
        checksum: expect.stringMatching(/^[a-f0-9]{64}$/)
      }
    })
    await expect(workspaceStore.recover('100', workspace.id)).resolves.toMatchObject({
      workspaceId: workspace.id,
      accountMid: '100',
      status: 'scanning'
    })
  })

  it('restores the current segment, baseline revision, classifications, and history after restart', async () => {
    const root = await createRoot()
    const firstRepository = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    const firstStore = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(firstRepository, firstStore)
    const scanning = await first.open('100')
    await first.completeScan('100', {
      revision: 7,
      aids: Array.from({ length: 2_001 }, (_, index) => index + 1)
    })
    await first.selectSegment('100', 'segment-2')
    await first.applyClassificationBatch('100', {
      source: 'manual',
      assignments: [{ aid: 2_001, targetLedgerIds: ['music'] }]
    })
    expect((await firstRepository.getSnapshot('100')).workspace?.workspaceRef).toMatchObject({
      workspaceId: scanning.id,
      baselineRevision: 7,
      currentSegmentId: 'segment-1',
      overlayRevision: 1,
      journalCursor: expect.any(Number),
      checksum: expect.stringMatching(/^[a-f0-9]{64}$/)
    })

    const reopened = await createCoordinator(
      new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' }),
      new OldFavoriteWorkspaceStore({ root })
    ).open('100')

    expect(reopened).toMatchObject({
      id: scanning.id,
      accountMid: '100',
      status: 'previewing',
      baseline: { revision: 7, aids: [2_001] },
      classifications: {
        '2001': { aid: 2_001, targetLedgerIds: ['music'], source: 'manual' }
      },
      historyCursor: 1
    })
    expect('recovery' in reopened).toBe(false)
    if ('recovery' in reopened) throw new Error('workspace unexpectedly requires rebuild')
    expect(reopened.segments).toEqual([
      { id: 'segment-2', index: 1, aids: [2_001], status: 'previewing' }
    ])
    expect(reopened.history).toHaveLength(1)
  })

  it('keeps durable workspaces isolated by account', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const coordinator = createCoordinator(repository, workspaceStore)

    const first = await coordinator.open('100')
    const second = await coordinator.open('200')
    await coordinator.completeScan('100', { revision: 3, aids: [1] })

    expect(first.accountMid).toBe('100')
    expect(second.accountMid).toBe('200')
    await expect(workspaceStore.recover('100', first.id)).resolves.toMatchObject({ accountMid: '100', baselineRevision: 3 })
    await expect(workspaceStore.recover('200', second.id)).resolves.toMatchObject({ accountMid: '200', baselineRevision: 0 })
    await expect(workspaceStore.recover('200', first.id)).resolves.toMatchObject({ recovery: 'rebuild-required' })
  })

  it('writes a manual overlay without committing a new full repository generation', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const coordinator = createCoordinator(repository, workspaceStore)
    const workspace = await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    const repositoryRevision = (await repository.getSnapshot('100')).revision
    const commit = vi.spyOn(repository, 'commit')

    await coordinator.applyClassificationBatch('100', {
      source: 'manual',
      assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })

    expect(commit).not.toHaveBeenCalled()
    expect((await repository.getSnapshot('100')).revision).toBe(repositoryRevision)
    await expect(workspaceStore.readWorkspaceWrites('100', workspace.id)).resolves.toEqual([
      'manifest.json', 'overlay.journal.jsonl'
    ])
  })

  it('undoes and redoes current-segment classifications through compact journal cursor events', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })

    await coordinator.undoClassificationChange('100')
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      classifications: {}, history: { cursor: 0, length: 1 }
    })
    await coordinator.redoClassificationChange('100')
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      classifications: { '1': { targetLedgerIds: ['music'], source: 'manual' } },
      history: { cursor: 1, length: 1 }
    })
  })

  it('returns newest-first human-readable history summaries and jumps to a requested cursor in the main process', async () => {
    const root = await createRoot()
    const coordinator = createCoordinator(
      new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' }),
      new OldFavoriteWorkspaceStore({ root })
    )
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1, 2] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 2, targetLedgerIds: ['knowledge'] }]
    })

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      history: {
        cursor: 2,
        length: 2,
        entries: [
          { cursor: 2, source: 'manual', changeCount: 1, targetLedgerIds: ['knowledge'] },
          { cursor: 1, source: 'manual', changeCount: 1, targetLedgerIds: ['music'] }
        ]
      }
    })

    await coordinator.moveHistoryCursor('100', 1)

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      classifications: { '1': { targetLedgerIds: ['music'] } },
      history: { cursor: 1, length: 2 }
    })
  })

  it('clears completed workspace classifications and undo history when restoring after Bilibili sync', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(repository, store)
    const workspace = await first.open('100')
    await first.completeScan('100', { revision: 1, aids: [1] })
    await first.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })
    const marker = (await repository.getSnapshot('100')).workspace!
    await repository.commit('100', {
      id: 'complete', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'set-workspace', payload: {
        ...marker,
        status: 'completed', workspaceRef: { ...marker.workspaceRef, status: 'completed' },
        frozenSyncPlan: {
          id: 'run-1', accountMid: '100', workspaceId: workspace.id, baselineRevision: 1,
          createdAt: '2026-07-20T00:00:00.000Z', operations: []
        }
      }
    })

    await expect(createCoordinator(
      new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' }),
      new OldFavoriteWorkspaceStore({ root })
    ).getSnapshot('100')).resolves.toMatchObject({
      status: 'completed', classifications: {}, history: { cursor: 0, length: 0 }
    })
  })

  it.each(['executing', 'reconciling'] as const)('keeps %s workspace history during restart recovery', async (status) => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(repository, store)
    const workspace = await first.open('100')
    await first.completeScan('100', { revision: 1, aids: [1] })
    await first.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })
    const marker = (await repository.getSnapshot('100')).workspace!
    await repository.commit('100', {
      id: `recover-${status}`, accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'set-workspace', payload: {
        ...marker,
        status, workspaceRef: { ...marker.workspaceRef, status },
        frozenSyncPlan: {
          id: 'run-1', accountMid: '100', workspaceId: workspace.id, baselineRevision: 1,
          createdAt: '2026-07-20T00:00:00.000Z', operations: []
        }
      }
    })

    await expect(createCoordinator(
      new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' }),
      new OldFavoriteWorkspaceStore({ root })
    ).getSnapshot('100')).resolves.toMatchObject({
      status, classifications: { '1': { targetLedgerIds: ['music'], source: 'manual' } }, history: { cursor: 1, length: 1 }
    })
  })

  it('restores continuation discoveries from the journal while the repository marker stays small', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(repository, workspaceStore)
    const workspace = await first.open('100')
    await first.completeScan('100', { revision: 1, aids: [1] })
    await first.freezeSegment('100', 'segment-1')
    await first.recordDiscoveredFavorites('100', [9, 9, 1])

    expect((await repository.getSnapshot('100')).workspace).toMatchObject({ continuationAids: [] })
    await expect(createCoordinator(
      new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' }),
      new OldFavoriteWorkspaceStore({ root })
    ).open('100')).resolves.toMatchObject({
      id: workspace.id,
      status: 'frozen',
      continuationAids: [9]
    })
  })

  it('returns rebuild-required for a corrupt workspace without deleting completed repository results', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(repository, workspaceStore)
    const workspace = await first.open('100')
    await first.completeScan('100', { revision: 1, aids: [1] })
    await repository.commit('100', {
      id: 'completed-local-result', accountMid: '100', issuedAt: '2026-07-19T00:00:01.000Z',
      type: 'upsert-video', payload: {
        aid: 88, title: 'kept', author: 'up', tags: [], updatedAt: '2026-07-19T00:00:01.000Z'
      }
    })
    await workspaceStore.appendOverlay('100', workspace.id, {
      currentSegmentId: 'segment-1', classifications: [], history: []
    })
    await workspaceStore.corruptOverlayForTest('100', workspace.id)

    await expect(createCoordinator(
      new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' }),
      new OldFavoriteWorkspaceStore({ root })
    ).open('100')).resolves.toEqual({
      recovery: 'rebuild-required',
      preserveCompletedLocalResults: true,
      accountMid: '100',
      workspaceId: workspace.id
    })
    expect((await repository.getSnapshot('100')).videos['88']?.title).toBe('kept')
  })

  it('rebuilds a corrupt workspace into a fresh incremental scan without touching completed local results', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(repository, workspaceStore)
    const corrupted = await first.open('100')
    await first.completeScan('100', { revision: 1, aids: [1] })
    await repository.commit('100', {
      id: 'completed-local-result', accountMid: '100', issuedAt: '2026-07-19T00:00:01.000Z',
      type: 'upsert-video', payload: {
        aid: 88, title: 'kept', author: 'up', tags: [], updatedAt: '2026-07-19T00:00:01.000Z'
      }
    })
    await workspaceStore.corruptOverlayForTest('100', corrupted.id)

    const reopenedRepository = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    const rebuilt = await createCoordinator(reopenedRepository, new OldFavoriteWorkspaceStore({ root })).rebuildAfterRecovery('100')

    expect(rebuilt).toMatchObject({ status: 'scanning', mode: 'incremental' })
    expect(rebuilt.workspaceId).not.toBe(corrupted.id)
    await expect(workspaceStore.recover('100', corrupted.id)).resolves.toMatchObject({ recovery: 'rebuild-required' })
    await expect(reopenedRepository.getSnapshot('100')).resolves.toMatchObject({
      videos: { '88': { title: 'kept' } },
      workspace: { id: rebuilt.workspaceId, status: 'scanning' }
    })
  })

  it('refuses to replace a corrupt workspace with an unfinished frozen sync plan', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(repository, workspaceStore)
    const workspace = await first.open('100')
    await first.completeScan('100', { revision: 1, aids: [1] })
    const marker = (await repository.getSnapshot('100')).workspace!
    await repository.commit('100', {
      id: 'unfinished-frozen-plan', accountMid: '100', issuedAt: '2026-07-19T00:00:01.000Z', type: 'set-workspace', payload: {
        ...marker,
        status: 'frozen', workspaceRef: { ...marker.workspaceRef, status: 'frozen' },
        frozenSyncPlan: {
          id: 'run-1', accountMid: '100', workspaceId: workspace.id, baselineRevision: 1,
          createdAt: '2026-07-19T00:00:01.000Z', operations: []
        }
      }
    })
    await workspaceStore.corruptOverlayForTest('100', workspace.id)

    await expect(createCoordinator(
      new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' }),
      new OldFavoriteWorkspaceStore({ root })
    ).rebuildAfterRecovery('100')).rejects.toThrow('unfinished frozen sync plan')
  })

  it('returns rebuild-required when the active baseline segment is corrupt after manifest-only recovery', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(repository, workspaceStore)
    const workspace = await first.open('100')
    await first.completeScan('100', { revision: 1, aids: [1] })
    await writeFile(join(root, 'accounts', '100', 'workspaces', workspace.id, 'baseline', 'segment-1.json'), '{corrupt', 'utf8')

    await expect(createCoordinator(
      new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' }),
      new OldFavoriteWorkspaceStore({ root })
    ).open('100')).resolves.toEqual({
      recovery: 'rebuild-required',
      preserveCompletedLocalResults: true,
      accountMid: '100',
      workspaceId: workspace.id
    })
  })
})
