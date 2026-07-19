import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FavoriteRepositoryService } from './favoriteRepositoryService'
import { FavoriteRepositoryBindingService } from './favoriteRepositoryBindingService'
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

  it('finalizes staged source pages into one deduplicated immutable baseline and preserves managed aids', async () => {
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
      status: 'previewing', baseline: { aids: [1, 2] }, baselineCompletedAids: [2], plannedAids: [1]
    })
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      status: 'previewing', currentSegment: {
        aids: [1],
        items: [{ aid: 1, title: 'First title', sourceFolderIds: ['source-a'] }]
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

  it('executes only the persisted frozen Bilibili plan through the main-process sync service', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const executeFrozenPlan = vi.fn().mockResolvedValue({ id: 'run-1', status: 'succeeded' })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      syncService: { executeFrozenPlan }, now: () => '2026-07-20T00:00:00.000Z'
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

  it('does not execute a workspace that has not yet persisted a frozen plan', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const executeFrozenPlan = vi.fn()
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }), syncService: { executeFrozenPlan }
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
      syncService: { executeFrozenPlan: vi.fn().mockReturnValue(waiting.promise) }
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

    await expect(recoveredStore.readWorkspaceReads('100', 'old-favorite-workspace-100-20260719000000000'))
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
