import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FavoriteRepositoryService } from './favoriteRepositoryService'
import { FavoriteRepositoryBindingService } from './favoriteRepositoryBindingService'
import { FavoriteRepositorySyncService } from './favoriteRepositorySyncService'
import { OldFavoriteWorkspaceCoordinator } from './oldFavoriteWorkspaceCoordinator'
import { OldFavoriteWorkspaceStore } from './oldFavoriteWorkspaceStore'

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

function createCoordinator(repository: FavoriteRepositoryService, workspaceStore: OldFavoriteWorkspaceStore) {
  return new OldFavoriteWorkspaceCoordinator({
    repository,
    workspaceStore,
    now: () => '2026-07-19T00:00:00.000Z'
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

describe('OldFavoriteWorkspaceCoordinator', () => {
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

  it('keeps prior protections when a full reorganization cannot start from an active preview', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await repository.commit('100', {
      id: 'prior-protection', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'record-organization-protections',
      payload: { records: [{ accountMid: '100', aid: 1, targetFolderIds: ['remote-music'], completedAt: '2026-07-20T00:00:00.000Z' }] }
    })
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })

    await expect(coordinator.beginScan('100', 'full')).rejects.toThrow('scan is already active')
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      organizationRecords: [expect.objectContaining({ aid: 1 })]
    })
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

  it('does not mark a multi-segment workspace complete through the current-segment local-only command', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: Array.from({ length: 2_001 }, (_, index) => index + 1) })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: Array.from({ length: 2_000 }, (_, index) => ({ aid: index + 1, targetLedgerIds: ['music'] }))
    })

    await expect(coordinator.saveCurrentSegmentToLocalLibrary('100')).rejects.toThrow('multiple segments')
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({ status: 'previewing' })
  })

  it('keeps rejecting local-only completion after restoring a multi-segment workspace', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const first = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await first.open('100')
    await first.completeScan('100', { revision: 1, aids: Array.from({ length: 2_001 }, (_, index) => index + 1) })
    await first.applyClassificationBatch('100', {
      source: 'manual', assignments: Array.from({ length: 2_000 }, (_, index) => ({ aid: index + 1, targetLedgerIds: ['music'] }))
    })
    const restored = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))

    await expect(restored.saveCurrentSegmentToLocalLibrary('100')).rejects.toThrow('multiple segments')
    await expect(restored.getSnapshot('100')).resolves.toMatchObject({ status: 'previewing', hasMultipleSegments: true })
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
      logicalLedgerId: 'music', logicalTitle: 'music', shardNumber: 1, memberAids: []
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
      selectedSourceFolderIds: [],
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
