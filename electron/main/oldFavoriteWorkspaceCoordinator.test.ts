import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FavoriteRepositoryService } from './favoriteRepositoryService'
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
