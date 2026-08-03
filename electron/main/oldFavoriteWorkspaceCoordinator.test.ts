import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FavoriteRepositoryService } from './favoriteRepositoryService'
import { FavoriteRepositoryBindingService, favoriteRepositoryManagedShardTitle } from './favoriteRepositoryBindingService'
import { FavoriteRepositorySyncService, type FavoriteRepositoryPageBridge } from './favoriteRepositorySyncService'
import { OldFavoriteWorkspaceCoordinator } from './oldFavoriteWorkspaceCoordinator'
import { OldFavoriteWorkspaceStore } from './oldFavoriteWorkspaceStore'
import { classifyOldFavoriteItemsCooperatively } from './oldFavoriteWorkspaceClassification'
import {
  createOldFavoriteWorkspace,
  type OldFavoriteWorkspace,
  type OldFavoriteWorkspaceRecoveryRequired,
  type OldFavoriteWorkspaceSnapshot
} from '../../src/shared/oldFavoriteWorkspace'
import { createFavoriteRepositoryArchiveExport } from '../../src/shared/favoriteRepository'
import type { FavoriteLedger } from '../../src/shared/types'

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
  options: Pick<ConstructorParameters<typeof OldFavoriteWorkspaceCoordinator>[0], 'classifyCurrentItem' | 'classifyCurrentItems' | 'saveRecommendedLedgers' | 'notifyRecommendedLedgersChanged' | 'saveRecoveredLedgerDrafts' | 'prepareForOrganization' | 'resolveRecoveryConfiguration' | 'refreshSelectedVideoMetadata' | 'segmentSize' | 'onSegmentsReady'> & { initializeOnOpen?: boolean } = {}
) {
  const { initializeOnOpen = true, ...coordinatorOptions } = options
  const coordinator = new OldFavoriteWorkspaceCoordinator({
    repository,
    workspaceStore,
    ...coordinatorOptions,
    now: () => '2026-07-19T00:00:00.000Z'
  })
  if (initializeOnOpen) {
    const open = coordinator.open.bind(coordinator)
    vi.spyOn(coordinator, 'open').mockImplementation(async (accountMid) => {
      const snapshot = await open(accountMid)
      if (snapshot) return snapshot
      await coordinator.beginScan(accountMid, 'incremental')
      return open(accountMid)
    })
  }
  return coordinator
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function requireWorkspace(value: OldFavoriteWorkspace | OldFavoriteWorkspaceRecoveryRequired | null) {
  if (!value || 'recovery' in value) throw new Error('workspace unexpectedly unavailable')
  return value
}

function requireSnapshot(value: OldFavoriteWorkspaceSnapshot | OldFavoriteWorkspaceRecoveryRequired | null) {
  if (!value || 'recovery' in value) throw new Error('workspace unexpectedly unavailable')
  return value
}

function createPageBridge(overrides: Partial<FavoriteRepositoryPageBridge> = {}): FavoriteRepositoryPageBridge {
  return {
    append: vi.fn().mockResolvedValue({ observedAccountMid: '100' }),
    remove: vi.fn().mockResolvedValue({ observedAccountMid: '100' }),
    readMembers: vi.fn().mockResolvedValue({ observedAccountMid: '100', members: {} }),
    readFolderInventory: vi.fn().mockResolvedValue({ observedAccountMid: '100', folders: [] }),
    createFolder: vi.fn().mockResolvedValue({ observedAccountMid: '100', folder: { id: 'remote-folder', title: 'Folder', memberCount: 0 } }),
    deleteFolder: vi.fn().mockResolvedValue({ observedAccountMid: '100' }),
    ...overrides
  }
}

type CoordinatorSyncService = NonNullable<ConstructorParameters<typeof OldFavoriteWorkspaceCoordinator>[0]['syncService']>

function createSyncService(overrides: Partial<CoordinatorSyncService> = {}): CoordinatorSyncService {
  return {
    abandonFrozenPlan: vi.fn(),
    claimFrozenPlan: vi.fn(),
    executeFrozenPlan: vi.fn(),
    bindPageTarget: vi.fn(),
    rebindPageTarget: vi.fn(),
    reconcile: vi.fn(),
    resume: vi.fn(),
    getRun: vi.fn(),
    deleteManagedFolders: vi.fn(),
    previewManagedFolderDeletion: vi.fn(),
    ...overrides
  }
}

describe('OldFavoriteWorkspaceCoordinator', () => {
  it('keeps unavailable videos in the Bilibili mirror but excludes them from organization work', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const classifyCurrentItem = vi.fn().mockReturnValue({ targetLedgerIds: ['knowledge'], confidence: 'high' as const })
    const coordinator = createCoordinator(repository, workspaceStore, {
      initializeOnOpen: false, classifyCurrentItem
    })
    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [
        { id: 'source-a', title: 'Source A', itemCount: 2, isBilimiWorkFolder: false },
        { id: 'source-b', title: 'Source B', itemCount: 1, isBilimiWorkFolder: false }
      ]
    })
    await coordinator.recordScanPage('100', { folderId: 'source-a', page: 1, items: [
      { aid: 1, title: 'Available', author: 'UP', tags: ['TypeScript'], sourceFolderIds: ['source-a'] },
      { aid: 2, title: '已失效视频', author: '账号已注销', tags: [], unavailable: true, sourceFolderIds: ['source-a'] }
    ] })
    await coordinator.recordScanPage('100', { folderId: 'source-b', page: 1, items: [
      { aid: 2, title: '已失效视频', author: '账号已注销', tags: [], unavailable: true, sourceFolderIds: ['source-b'] }
    ] })

    const workspace = await coordinator.finishScan('100')

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      sourceFolders: [
        { id: 'source-a', invalidItemCount: 1 },
        { id: 'source-b', invalidItemCount: 1 }
      ],
      currentSegment: { aids: [1] },
      tagEnrichment: { pendingItemCount: 0 },
      classifications: { '1': expect.any(Object) }
    })
    expect(classifyCurrentItem).toHaveBeenCalledWith(expect.objectContaining({ aid: 1 }))
    expect(classifyCurrentItem).not.toHaveBeenCalledWith(expect.objectContaining({ aid: 2 }))
    expect(await coordinator.getPendingTagEnrichmentAids('100')).toEqual([])
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      videos: {
        '1': expect.objectContaining({ title: 'Available' }),
        '2': expect.objectContaining({ title: '已失效视频' })
      },
      memberships: {
        'bilibili:source-a': [1, 2],
        'bilibili:source-b': [2]
      }
    })

    await workspaceStore.appendOverlay('100', workspace.id, {
      currentSegmentId: 'segment-1', classifications: [], history: [],
      recommendations: {
        initialized: true,
        candidates: [{
          id: 'custom-author-closed', displayName: 'bilimi·账号已注销', kind: 'author',
          sourceName: '账号已注销', keywords: ['账号已注销'], count: 1,
          matchedAidsBySegment: { 'segment-1': [2] }, reason: '旧版草稿候选'
        }],
        adoptedCandidateIds: ['custom-author-closed']
      },
      scanMetadata: {
        sourceFolders: [
          { id: 'source-a', title: 'Source A', itemCount: 2, isBilimiWorkFolder: false },
          { id: 'source-b', title: 'Source B', itemCount: 1, isBilimiWorkFolder: false }
        ],
        phase: 'complete', failureCount: 0, mode: 'full'
      }
    })
    const restarted = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })
    const recovered = requireSnapshot(await restarted.getSnapshot('100'))

    expect(recovered.sourceFolders).toMatchObject([
      { id: 'source-a', invalidItemCount: 1 },
      { id: 'source-b', invalidItemCount: 1 }
    ])
    expect(recovered.recommendations.candidates).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ displayName: 'bilimi·账号已注销' })
    ]))
    expect(recovered.recommendations.adoptedCandidateIds).not.toContain('custom-author-closed')
    expect(recovered.currentSegment?.items).toEqual([
      expect.objectContaining({ aid: 1 }),
    ])
  })

  it('repairs stale readiness totals for unavailable videos when restoring an older draft', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const classifyCurrentItem = vi.fn().mockReturnValue({ targetLedgerIds: ['knowledge'], confidence: 'high' as const })
    const first = createCoordinator(repository, workspaceStore, {
      initializeOnOpen: false,
      classifyCurrentItem
    })
    await first.beginScan('100', 'full')
    await first.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2, isBilimiWorkFolder: false }]
    })
    await first.recordScanPage('100', {
      folderId: 'source', page: 1, items: [
        { aid: 1, title: 'Available', tags: ['TypeScript'], sourceFolderIds: ['source'] },
        { aid: 2, title: '已失效视频', author: '账号已注销', unavailable: true, sourceFolderIds: ['source'] }
      ]
    })
    const workspace = await first.finishScan('100')
    await workspaceStore.appendOverlay('100', workspace.id, {
      currentSegmentId: 'segment-1', classifications: [], history: [],
      planReadiness: { selectedAidCount: 2, classifiedAidCount: 0 }
    })

    const restarted = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false,
      classifyCurrentItem
    })

    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({
      planReadiness: { selectedAidCount: 1, classifiedAidCount: 1, unclassifiedAidCount: 0 }
    })
  })

  it('captures the configured segment limit only when a new organization round is created', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    let configuredSize = 1_000
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false,
      segmentSize: () => configuredSize
    })
    await coordinator.beginScan('100', 'incremental')
    configuredSize = 500
    await coordinator.completeScan('100', {
      revision: 1,
      aids: Array.from({ length: 1_500 }, (_unused, index) => index + 1)
    })

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      segmentSize: 1_000,
      segments: [{ itemCount: 1_000 }, { itemCount: 500 }]
    })
  })

  it('reports tag readiness independently so an earlier batch can be organized first', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false,
      segmentSize: () => 500
    })
    await coordinator.beginScan('100', 'incremental')
    for (let offset = 0; offset < 501; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source', page: offset / 50 + 1,
        items: Array.from({ length: Math.min(50, 501 - offset) }, (_unused, index) => {
          const aid = offset + index + 1
          return {
            aid,
            title: `Video ${aid}`,
            ...(aid === 1 || aid === 501 ? {} : { tags: ['已有标签'] }),
            sourceFolderIds: ['source']
          }
        })
      })
    }
    await coordinator.finishScan('100')
    const workspaceId = (await coordinator.getSnapshot('100') as { workspaceId: string }).workspaceId

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      segments: [
        { id: 'segment-1', readiness: 'tagging', pendingTagItemCount: 1 },
        { id: 'segment-2', readiness: 'tagging', pendingTagItemCount: 1 }
      ]
    })
    await coordinator.recordTagEnrichment('100', 1, ['新标签'], workspaceId)
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      segments: [
        { id: 'segment-1', readiness: 'ready', pendingTagItemCount: 0 },
        { id: 'segment-2', readiness: 'tagging', pendingTagItemCount: 1 }
      ]
    })
  })

  it('notifies newly ready batches outside the coordinator queue exactly once', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    let coordinator!: OldFavoriteWorkspaceCoordinator
    const onSegmentsReady = vi.fn(async (accountMid: string, segmentIds: string[]) => {
      await expect(coordinator.getSnapshot(accountMid)).resolves.toMatchObject({
        segments: expect.arrayContaining(segmentIds.map((id) => expect.objectContaining({ id, readiness: 'ready' })))
      })
    })
    coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false,
      segmentSize: () => 500,
      onSegmentsReady
    })
    await coordinator.beginScan('100', 'incremental')
    for (let offset = 0; offset < 501; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source', page: offset / 50 + 1,
        items: Array.from({ length: Math.min(50, 501 - offset) }, (_unused, index) => {
          const aid = offset + index + 1
          return {
            aid,
            title: `Video ${aid}`,
            ...(aid === 1 || aid === 501 ? {} : { tags: ['existing'] }),
            sourceFolderIds: ['source']
          }
        })
      })
    }
    await coordinator.finishScan('100')
    const workspaceId = requireSnapshot(await coordinator.getSnapshot('100')).workspaceId

    await coordinator.recordTagEnrichment('100', 1, ['ready'], workspaceId)
    await vi.waitFor(() => expect(onSegmentsReady).toHaveBeenCalledExactlyOnceWith('100', ['segment-1']))
    await coordinator.recordTagEnrichment('100', 501, ['ready'], workspaceId)
    await vi.waitFor(() => expect(onSegmentsReady).toHaveBeenCalledTimes(2))
    expect(onSegmentsReady).toHaveBeenNthCalledWith(2, '100', ['segment-2'])
  })

  it('exposes the durable DeepSeek checkpoint after coordinator reconstruction', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const first = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })
    await first.beginScan('100', 'full')
    await first.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [{ aid: 1, title: 'Ready', tags: ['existing'], sourceFolderIds: ['source'] }]
    })
    await first.finishScan('100')
    const workspaceId = requireSnapshot(await first.getSnapshot('100')).workspaceId

    await first.setDeepSeekRunCheckpoint('100', {
      workspaceId, mode: 'all', scope: 'all', completedSegmentIds: [],
      waitingSegmentIds: ['segment-1'], canceled: false
    })
    await expect(first.getSnapshot('100')).resolves.toMatchObject({
      deepSeekRun: { status: 'waiting', completedSegmentCount: 0, waitingSegmentCount: 1 }
    })

    const restarted = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })
    await expect(restarted.getDeepSeekRunCheckpoint('100')).resolves.toEqual({
      workspaceId, mode: 'all', scope: 'all', completedSegmentIds: [],
      waitingSegmentIds: ['segment-1'], canceled: false
    })
    await restarted.setDeepSeekRunCheckpoint('100', null)
    await expect(restarted.getDeepSeekRunCheckpoint('100')).resolves.toBeNull()
  })

  it('waits to execute a durable whole-run local intent until every batch and DeepSeek run are ready', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false, segmentSize: () => 500,
      classifyCurrentItems: (items) => items.map(() => ({ targetLedgerIds: ['knowledge'], confidence: 'high' as const }))
    })
    await coordinator.beginScan('100', 'full')
    for (let offset = 0; offset < 501; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source', page: offset / 50 + 1,
        items: Array.from({ length: Math.min(50, 501 - offset) }, (_unused, index) => {
          const aid = offset + index + 1
          return { aid, title: `Video ${aid}`, ...(aid <= 500 ? { tags: ['ready'] } : {}), sourceFolderIds: ['source'] }
        })
      })
    }
    await coordinator.finishScan('100')
    const workspaceId = requireSnapshot(await coordinator.getSnapshot('100')).workspaceId
    await coordinator.setDeepSeekRunCheckpoint('100', {
      workspaceId, mode: 'all', scope: 'all', completedSegmentIds: ['segment-1'],
      waitingSegmentIds: ['segment-2'], canceled: false
    })
    await coordinator.setExecutionIntent('100', 'local')

    await expect(coordinator.continueExecutionIntent('100')).resolves.toBe(false)
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      executionIntent: { mode: 'local', status: 'waiting', waitingSegmentCount: 1, waitingForDeepSeek: true }
    })
    expect((await repository.getSnapshot('100')).workspace?.status).toBe('previewing')

    await coordinator.recordTagEnrichment('100', 501, ['ready'], workspaceId)
    await coordinator.setDeepSeekRunCheckpoint('100', null)
    await expect(coordinator.continueExecutionIntent('100')).resolves.toBe(true)
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({ status: 'completed', completionMode: 'local' })
    expect(requireSnapshot(await coordinator.getSnapshot('100')).executionIntent).toBeUndefined()
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({ workspace: { status: 'completed', completionMode: 'local' } })
  })

  it('restores a completed whole-run local save without reviving its execution intent', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(repository, store, {
      initializeOnOpen: false, segmentSize: () => 500,
      classifyCurrentItems: (items) => items.map(() => ({ targetLedgerIds: ['knowledge'], confidence: 'high' as const }))
    })
    await first.beginScan('100', 'full')
    for (let offset = 0; offset < 501; offset += 50) {
      await first.recordScanPage('100', {
        folderId: 'source', page: offset / 50 + 1,
        items: Array.from({ length: Math.min(50, 501 - offset) }, (_unused, index) => ({
          aid: offset + index + 1, title: `Video ${offset + index + 1}`, tags: ['ready'], sourceFolderIds: ['source']
        }))
      })
    }
    await first.finishScan('100')
    await first.setExecutionIntent('100', 'local')
    await expect(first.continueExecutionIntent('100')).resolves.toBe(true)

    const restarted = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false, segmentSize: () => 500
    })
    const restored = requireSnapshot(await restarted.getSnapshot('100'))

    expect(restored).toMatchObject({ status: 'completed', completionMode: 'local' })
    expect(restored.executionIntent).toBeUndefined()
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      memberships: { 'local:knowledge': Array.from({ length: 501 }, (_unused, index) => index + 1) },
      workspace: { status: 'completed', completionMode: 'local' }
    })
  })

  it('does not revive a whole-run execution intent after the Bilibili plan has been frozen and claimed', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    const executeFrozenPlan = vi.fn().mockResolvedValue({ id: 'run-1', status: 'running' })
    const syncService = createSyncService({
      claimFrozenPlan: vi.fn().mockResolvedValue(undefined),
      getRun: vi.fn().mockResolvedValue({ id: 'run-1', status: 'running' }),
      executeFrozenPlan
    })
    const first = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: store, syncService, segmentSize: () => 500,
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await first.beginScan('100', 'full')
    await first.completeScan('100', { revision: 1, aids: Array.from({ length: 501 }, (_unused, index) => index + 1) })
    await first.applyClassificationBatch('100', {
      source: 'manual', assignments: Array.from({ length: 500 }, (_unused, index) => ({ aid: index + 1, targetLedgerIds: ['music'] }))
    })
    await first.selectSegment('100', 'segment-2')
    await first.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 501, targetLedgerIds: ['music'] }]
    })
    await bindings.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber: 1, memberAids: [], observedAccountMid: '100',
      remoteFolderId: 'remote-music-1',
      inventory: [{ id: 'remote-music-1', title: 'B-music-001-a1b2c3', memberCount: 0, memberAids: [] }]
    })
    await first.setExecutionIntent('100', 'bilibili')
    await expect(first.continueExecutionIntent('100')).resolves.toBe(true)
    await vi.waitFor(() => expect(executeFrozenPlan).toHaveBeenCalledTimes(1))

    const restarted = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }), syncService,
      segmentSize: () => 500, now: () => '2026-07-20T00:00:00.000Z'
    })
    const restored = requireSnapshot(await restarted.getSnapshot('100'))

    expect(restored.status).toBe('frozen')
    expect(restored.executionIntent).toBeUndefined()
  }, 15_000)

  it('claims a ready execution intent once when multiple completion signals arrive together', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false, segmentSize: () => 500,
      classifyCurrentItems: (items) => items.map(() => ({ targetLedgerIds: ['knowledge'], confidence: 'high' as const }))
    })
    await coordinator.beginScan('100', 'full')
    await coordinator.completeScan('100', { revision: 1, aids: Array.from({ length: 501 }, (_unused, index) => index + 1) })
    await coordinator.setExecutionIntent('100', 'local')
    const save = vi.spyOn(coordinator, 'saveWholeRunToLocalLibrary')

    const results = await Promise.all([
      coordinator.continueExecutionIntent('100'),
      coordinator.continueExecutionIntent('100'),
      coordinator.continueExecutionIntent('100')
    ])

    expect(results).toEqual([true, true, true])
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('stops offering cancellation after a ready execution intent has been atomically claimed', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false, segmentSize: () => 500
    })
    await coordinator.beginScan('100', 'full')
    await coordinator.completeScan('100', { revision: 1, aids: Array.from({ length: 501 }, (_unused, index) => index + 1) })
    await coordinator.setExecutionIntent('100', 'local')
    const waiting = deferred<OldFavoriteWorkspace>()
    vi.spyOn(coordinator, 'saveWholeRunToLocalLibrary').mockReturnValue(waiting.promise)

    const continuing = coordinator.continueExecutionIntent('100')
    await vi.waitFor(async () => expect(requireSnapshot(await coordinator.getSnapshot('100')).executionIntent)
      .toMatchObject({ mode: 'local', status: 'running' }))
    await expect(coordinator.setExecutionIntent('100', null)).rejects.toThrow('already started')
    waiting.resolve(requireWorkspace(await coordinator.open('100')))
    await expect(continuing).resolves.toBe(true)
  })

  it('blocks a queued whole-run execution after DeepSeek cancellation until the user cancels it', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const coordinator = createCoordinator(repository, store, { initializeOnOpen: false, segmentSize: () => 500 })
    await coordinator.beginScan('100', 'full')
    for (let offset = 0; offset < 501; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source', page: offset / 50 + 1,
        items: Array.from({ length: Math.min(50, 501 - offset) }, (_unused, index) => ({
          aid: offset + index + 1, tags: ['ready'], sourceFolderIds: ['source']
        }))
      })
    }
    await coordinator.finishScan('100')
    const workspaceId = requireSnapshot(await coordinator.getSnapshot('100')).workspaceId
    await coordinator.setDeepSeekRunCheckpoint('100', {
      workspaceId, mode: 'all', scope: 'all', completedSegmentIds: ['segment-1'], waitingSegmentIds: [], canceled: true
    })
    await coordinator.setExecutionIntent('100', 'bilibili')

    await expect(coordinator.continueExecutionIntent('100')).resolves.toBe(false)
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      executionIntent: { mode: 'bilibili', status: 'blocked', waitingForDeepSeek: false }
    })

    const restarted = createCoordinator(repository, store, { initializeOnOpen: false, segmentSize: () => 500 })
    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({
      executionIntent: { mode: 'bilibili', status: 'blocked' }
    })
    await restarted.setExecutionIntent('100', null)
    expect(requireSnapshot(await restarted.getSnapshot('100')).executionIntent).toBeUndefined()
  })

  it('publishes a compact whole-run overview only when a complete batch is ready and restores it after restart', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const classifyCurrentItems = vi.fn((items: Array<{ aid: number }>) => items.map(() => ({
      targetLedgerIds: ['knowledge'], confidence: 'high' as const
    })))
    const coordinator = createCoordinator(repository, workspaceStore, {
      initializeOnOpen: false, segmentSize: () => 500, classifyCurrentItems
    })
    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 502, isBilimiWorkFolder: false }]
    })
    for (let offset = 0; offset < 502; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source', page: offset / 50 + 1,
        items: Array.from({ length: Math.min(50, 502 - offset) }, (_unused, index) => {
          const aid = offset + index + 1
          if (aid === 502) return { aid, title: '已失效视频', unavailable: true, sourceFolderIds: ['source'] }
          return {
            aid, title: `Video ${aid}`,
            ...(aid === 1 || aid === 501 ? {} : { tags: ['TypeScript'] }),
            sourceFolderIds: ['source']
          }
        })
      })
    }
    await coordinator.finishScan('100')
    const workspaceId = requireSnapshot(await coordinator.getSnapshot('100')).workspaceId

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      overview: { available: false, completedSegmentCount: 0, totalSegmentCount: 2 }
    })

    await coordinator.recordTagEnrichment('100', 1, ['TypeScript'], workspaceId)
    const ready = requireSnapshot(await coordinator.getSnapshot('100'))
    expect(ready.overview).toMatchObject({
      available: true,
      completedSegmentCount: 1,
      totalSegmentCount: 2,
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 500, invalidItemCount: 1 }],
      unavailableItemCount: 1,
      recommendationCounts: expect.arrayContaining([
        expect.objectContaining({ id: 'custom-tag-typescript', count: 500 })
      ]),
      archiveTargets: [{ ledgerId: 'knowledge', itemCount: 500, segmentCounts: [{ segmentId: 'segment-1', count: 500 }] }]
    })
    expect(JSON.stringify(ready.overview)).not.toContain('"aids"')

    await coordinator.recordTagEnrichment('100', 501, ['TypeScript'], workspaceId)
    const allReady = requireSnapshot(await coordinator.getSnapshot('100'))
    expect(allReady.overview).toMatchObject({
      available: true,
      completedSegmentCount: 2,
      totalSegmentCount: 2,
      sourceFolders: [{ id: 'source', itemCount: 501, invalidItemCount: 1 }],
      recommendationCounts: expect.arrayContaining([
        expect.objectContaining({ id: 'custom-tag-typescript', count: 501 })
      ]),
      archiveTargets: [{
        ledgerId: 'knowledge', itemCount: 501,
        segmentCounts: [{ segmentId: 'segment-1', count: 500 }, { segmentId: 'segment-2', count: 1 }]
      }]
    })

    const restarted = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false, segmentSize: () => 500, classifyCurrentItems
    })
    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({ overview: allReady.overview })
  })

  it('keeps waiting batches out of unmatched counts and publishes completed unmatched videos as local inbox', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const classifyCurrentItems = vi.fn((items: Array<{ aid: number }>) => items.map((item) => ({
      targetLedgerIds: item.aid === 2 ? [] : ['knowledge'], confidence: 'high' as const
    })))
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false, segmentSize: () => 500, classifyCurrentItems
    })
    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 501, isBilimiWorkFolder: false }]
    })
    for (let offset = 0; offset < 501; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source', page: offset / 50 + 1,
        items: Array.from({ length: Math.min(50, 501 - offset) }, (_unused, index) => {
          const aid = offset + index + 1
          return { aid, title: `Video ${aid}`, ...(aid === 501 ? {} : { tags: ['ready'] }), sourceFolderIds: ['source'] }
        })
      })
    }
    await coordinator.finishScan('100')

    const snapshot = requireSnapshot(await coordinator.getSnapshot('100'))
    expect(snapshot.overview).toMatchObject({
      completedSegmentCount: 1,
      totalSegmentCount: 2,
      processedItemCount: 500,
      classifiedItemCount: 499,
      unmatchedItemCount: 1,
      waitingItemCount: 1,
      archiveTargets: expect.arrayContaining([
        { ledgerId: 'knowledge', itemCount: 499, segmentCounts: [{ segmentId: 'segment-1', count: 499 }] },
        { ledgerId: 'inbox', itemCount: 1, segmentCounts: [{ segmentId: 'segment-1', count: 1 }] }
      ])
    })
  })

  it('keeps unavailable videos out of whole-run processed and inbox counts after restart', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const classifyCurrentItems = vi.fn((items: Array<{ aid: number }>) => items.map((item) => ({
      targetLedgerIds: item.aid === 1 ? ['knowledge'] : [], confidence: 'high' as const
    })))
    const coordinator = createCoordinator(repository, store, {
      initializeOnOpen: false, segmentSize: () => 500, classifyCurrentItems
    })
    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 503, isBilimiWorkFolder: false }]
    })
    for (let offset = 0; offset < 503; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source', page: offset / 50 + 1,
        items: Array.from({ length: Math.min(50, 503 - offset) }, (_unused, index) => {
          const aid = offset + index + 1
          return aid === 2 || aid === 503
            ? { aid, title: '已失效视频', unavailable: true, sourceFolderIds: ['source'] }
            : { aid, title: `Video ${aid}`, tags: ['ready'], sourceFolderIds: ['source'] }
        })
      })
    }
    await coordinator.finishScan('100')

    const expected = {
      processedItemCount: 501,
      classifiedItemCount: 1,
      unmatchedItemCount: 500,
      unavailableItemCount: 2,
      archiveTargets: expect.arrayContaining([
        { ledgerId: 'knowledge', itemCount: 1, segmentCounts: [{ segmentId: 'segment-1', count: 1 }] },
        { ledgerId: 'inbox', itemCount: 500, segmentCounts: [
          { segmentId: 'segment-1', count: 499 }, { segmentId: 'segment-2', count: 1 }
        ] }
      ])
    }
    expect(requireSnapshot(await coordinator.getSnapshot('100')).overview).toMatchObject(expected)

    const restarted = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false, segmentSize: () => 500, classifyCurrentItems
    })
    expect(requireSnapshot(await restarted.getSnapshot('100')).overview).toMatchObject(expected)
  })

  it('counts completed selected videos without classification records as local inbox items', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const classifyCurrentItems = vi.fn((items: Array<{ aid: number }>) => items.map(() => ({
      targetLedgerIds: ['knowledge'], confidence: 'high' as const
    })))
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false, segmentSize: () => 500, classifyCurrentItems
    })
    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 501, isBilimiWorkFolder: false }]
    })
    for (let offset = 0; offset < 501; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source', page: offset / 50 + 1,
        items: Array.from({ length: Math.min(50, 501 - offset) }, (_unused, index) => {
          const aid = offset + index + 1
          return { aid, title: `Video ${aid}`, tags: ['ready'], sourceFolderIds: ['source'] }
        })
      })
    }
    await coordinator.finishScan('100')

    const runtime = (coordinator as unknown as {
      overviewRuntimes: Map<string, { classificationsBySegment: Map<string, Map<number, unknown>> }>
    }).overviewRuntimes.get('100')
    runtime?.classificationsBySegment.get('segment-2')?.delete(501)

    const snapshot = requireSnapshot(await coordinator.getSnapshot('100'))
    expect(snapshot.overview).toMatchObject({
      processedItemCount: 501,
      classifiedItemCount: 500,
      unmatchedItemCount: 1,
      archiveTargets: expect.arrayContaining([
        { ledgerId: 'inbox', itemCount: 1, segmentCounts: [{ segmentId: 'segment-2', count: 1 }] }
      ])
    })
  })

  it('refreshes high-frequency tag recommendations and classifies the completed batch before later batches finish tagging', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const classifyCurrentItem = vi.fn().mockReturnValue({ targetLedgerIds: ['knowledge'], confidence: 'high' as const })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false,
      segmentSize: () => 500,
      classifyCurrentItem
    })
    await coordinator.beginScan('100', 'incremental')
    for (let offset = 0; offset < 501; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source', page: offset / 50 + 1,
        items: Array.from({ length: Math.min(50, 501 - offset) }, (_unused, index) => {
          const aid = offset + index + 1
          return {
            aid,
            title: `Video ${aid}`,
            ...(aid === 1 || aid === 2 || aid === 3 || aid === 501 ? {} : { tags: ['existing'] }),
            sourceFolderIds: ['source']
          }
        })
      })
    }
    await coordinator.finishScan('100')
    const workspaceId = (await coordinator.getSnapshot('100') as { workspaceId: string }).workspaceId

    await coordinator.recordTagEnrichment('100', 1, ['TypeScript'], workspaceId)
    await coordinator.recordTagEnrichment('100', 2, ['TypeScript'], workspaceId)
    await coordinator.recordTagEnrichment('100', 3, ['TypeScript'], workspaceId)

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: { status: 'running', pendingItemCount: 1 },
      recommendations: {
        candidates: expect.arrayContaining([
          expect.objectContaining({ id: 'custom-tag-typescript', kind: 'tag', count: 3 })
        ])
      },
      classifications: {
        '1': { targetLedgerIds: ['knowledge'], source: 'system-high' }
      }
    })
    expect(classifyCurrentItem).toHaveBeenCalledWith(expect.objectContaining({ aid: 1, tags: ['TypeScript'] }))
    expect(classifyCurrentItem).not.toHaveBeenCalledWith(expect.objectContaining({ aid: 501 }))
  })

  it('publishes a high-frequency tag recommendation while the current batch is still enriching', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const classifyCurrentItem = vi.fn().mockReturnValue({ targetLedgerIds: ['knowledge'], confidence: 'high' as const })
    const coordinator = createCoordinator(repository, workspaceStore, {
      initializeOnOpen: false,
      segmentSize: () => 500,
      classifyCurrentItem
    })
    await coordinator.beginScan('100', 'incremental')
    for (let offset = 0; offset < 501; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source', page: offset / 50 + 1,
        items: Array.from({ length: Math.min(50, 501 - offset) }, (_unused, index) => {
          const aid = offset + index + 1
          return {
            aid,
            title: `Video ${aid}`,
            ...(aid === 1 || aid === 2 || aid === 3 || aid === 501 ? {} : { tags: ['existing'] }),
            sourceFolderIds: ['source']
          }
        })
      })
    }
    await coordinator.finishScan('100')
    const workspaceId = (await coordinator.getSnapshot('100') as { workspaceId: string }).workspaceId
    const loadSegment = vi.spyOn(workspaceStore, 'loadSegment')

    await coordinator.recordTagEnrichment('100', 1, ['TypeScript'], workspaceId)
    await coordinator.recordTagEnrichment('100', 2, ['TypeScript'], workspaceId)

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: { status: 'running', pendingItemCount: 2 },
      recommendations: {
        candidates: expect.arrayContaining([
          expect.objectContaining({ id: 'custom-tag-typescript', kind: 'tag', count: 2, currentSegmentCount: 2 })
        ])
      }
    })
    expect(classifyCurrentItem).not.toHaveBeenCalled()
    expect(loadSegment).not.toHaveBeenCalled()
  })

  it('restores incremental tag recommendations from the compact tag journal before the batch completes', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(repository, workspaceStore, { initializeOnOpen: false })
    await first.beginScan('100', 'incremental')
    await first.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'One', sourceFolderIds: ['source'] },
        { aid: 2, title: 'Two', sourceFolderIds: ['source'] },
        { aid: 3, title: 'Pending', sourceFolderIds: ['source'] }
      ]
    })
    await first.finishScan('100')
    const workspaceId = (await first.getSnapshot('100') as { workspaceId: string }).workspaceId
    await first.recordTagEnrichment('100', 1, ['TypeScript'], workspaceId)
    await first.recordTagEnrichment('100', 2, ['TypeScript'], workspaceId)

    const restartedStore = new OldFavoriteWorkspaceStore({ root })
    const loadSegment = vi.spyOn(restartedStore, 'loadSegment')
    const restarted = createCoordinator(repository, restartedStore, { initializeOnOpen: false })

    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: { status: 'running', pendingItemCount: 1 },
      recommendations: {
        candidates: expect.arrayContaining([
          expect.objectContaining({ id: 'custom-tag-typescript', kind: 'tag', count: 2, currentSegmentCount: 2 })
        ])
      }
    })
    expect(loadSegment).not.toHaveBeenCalled()
  })

  it('classifies an already-ready first batch when a later batch still needs tags', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const classifyCurrentItems = vi.fn((items: Array<{ aid: number }>) => items.map(() => ({
      targetLedgerIds: ['knowledge'], confidence: 'high' as const
    })))
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false,
      segmentSize: () => 500,
      classifyCurrentItems
    })
    await coordinator.beginScan('100', 'incremental')
    for (let offset = 0; offset < 501; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source', page: offset / 50 + 1,
        items: Array.from({ length: Math.min(50, 501 - offset) }, (_unused, index) => {
          const aid = offset + index + 1
          return {
            aid,
            title: `Video ${aid}`,
            ...(aid <= 500 ? { tags: ['TypeScript'] } : {}),
            sourceFolderIds: ['source']
          }
        })
      })
    }

    await coordinator.finishScan('100')

    expect(classifyCurrentItems).toHaveBeenCalledOnce()
    expect(classifyCurrentItems.mock.calls[0]?.[0]).toHaveLength(500)
    expect(classifyCurrentItems.mock.calls[0]?.[0].map((item) => item.aid)).not.toContain(501)
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: { status: 'running', pendingItemCount: 1 },
      classifications: {
        '1': { targetLedgerIds: ['knowledge'], source: 'system-high' },
        '500': { targetLedgerIds: ['knowledge'], source: 'system-high' }
      }
    })
  })

  it('adopts only the current batch tags while later batches keep enriching and can resume after restart', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false,
      segmentSize: () => 500
    })
    await coordinator.beginScan('100', 'incremental')
    for (let offset = 0; offset < 501; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source', page: offset / 50 + 1,
        items: Array.from({ length: Math.min(50, 501 - offset) }, (_unused, index) => ({
          aid: offset + index + 1,
          title: `Video ${offset + index + 1}`,
          sourceFolderIds: ['source']
        }))
      })
    }
    await coordinator.finishScan('100')

    await coordinator.acceptCurrentTags('100')
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: { status: 'running', pendingItemCount: 501 },
      segments: [
        { id: 'segment-1', readiness: 'ready', pendingTagItemCount: 0 },
        { id: 'segment-2', readiness: 'tagging', pendingTagItemCount: 1 }
      ]
    })
    await expect(coordinator.getPendingTagEnrichmentAids('100')).resolves.toEqual([501])

    const restarted = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })
    await expect(restarted.getPendingTagEnrichmentAids('100')).resolves.toEqual([501])
    await restarted.resumeTagEnrichment('100')
    await expect(restarted.getPendingTagEnrichmentAids('100')).resolves.toHaveLength(501)
  })
  it('creates a full-mode selection scope from repository videos without scanning the account', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-24T00:00:00.000Z' })
    for (const video of [
      { aid: 1, title: '视频一', author: 'UP 一', description: '简介一', tags: ['游戏'] },
      { aid: 2, title: '视频二', author: 'UP 二', description: '简介二', tags: ['知识'] }
    ]) {
      await repository.commit('100', {
        id: `seed-${video.aid}`, accountMid: '100', issuedAt: '2026-07-24T00:00:00.000Z', type: 'upsert-video',
        payload: { ...video, tagEvidence: 'confirmed', updatedAt: '2026-07-24T00:00:00.000Z' }
      })
    }
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })

    await expect(coordinator.beginSelectedReorganization('100', [2, 1, 2])).resolves.toMatchObject({
      status: 'previewing',
      mode: 'full',
      scope: { kind: 'selection', aids: [1, 2] },
      protectedAidCount: 0,
      currentSegment: {
        aids: [1, 2],
        items: [
          expect.objectContaining({ aid: 1, title: '视频一', author: 'UP 一', tags: ['游戏'] }),
          expect.objectContaining({ aid: 2, title: '视频二', author: 'UP 二', tags: ['知识'] })
        ]
      }
    })
  })

  it('refreshes and persists only incomplete selected metadata before building the selection preview', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-24T00:00:00.000Z' })
    for (const video of [
      { aid: 1, title: 'Video 1', tags: [] },
      { aid: 2, title: '完整视频', author: 'UP 二', description: '简介二', tags: ['知识'], tagEvidence: 'confirmed' as const },
      { aid: 3, title: 'Video 3', tags: [] }
    ]) {
      await repository.commit('100', {
        id: `seed-refresh-${video.aid}`, accountMid: '100', issuedAt: '2026-07-24T00:00:00.000Z', type: 'upsert-video',
        payload: { ...video, updatedAt: '2026-07-24T00:00:00.000Z' }
      })
    }
    const refreshSelectedVideoMetadata = vi.fn().mockResolvedValue({
      aid: 1, title: '已补全视频', author: 'UP 一', description: '简介一', tags: ['游戏'], tagEvidence: 'confirmed',
      updatedAt: '2026-07-24T00:01:00.000Z'
    })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false, refreshSelectedVideoMetadata
    })

    await expect(coordinator.beginSelectedReorganization('100', [2, 1])).resolves.toMatchObject({
      scan: { phase: 'complete', taggedItemCount: 2, untaggedItemCount: 0 },
      currentSegment: { items: [
        expect.objectContaining({ aid: 1, title: '已补全视频', author: 'UP 一', tags: ['游戏'] }),
        expect.objectContaining({ aid: 2, title: '完整视频', author: 'UP 二', tags: ['知识'] })
      ] }
    })
    expect(refreshSelectedVideoMetadata).toHaveBeenCalledTimes(1)
    expect(refreshSelectedVideoMetadata).toHaveBeenCalledWith('100', 1)
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      videos: { '1': expect.objectContaining({ title: '已补全视频', description: '简介一', tags: ['游戏'] }) }
    })
  })

  it('builds a main-resolved scope immediately without synchronously refreshing every selected video', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-24T00:00:00.000Z' })
    for (const aid of [1, 2]) {
      await repository.commit('100', {
        id: `seed-scope-${aid}`, accountMid: '100', issuedAt: '2026-07-24T00:00:00.000Z', type: 'upsert-video',
        payload: { aid, title: `Video ${aid}`, tags: [], updatedAt: '2026-07-24T00:00:00.000Z' }
      })
    }
    const refreshSelectedVideoMetadata = vi.fn()
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false, refreshSelectedVideoMetadata
    })

    await expect(coordinator.beginSelectedReorganization('100', [1, 2], {
      refreshIncompleteMetadata: false
    })).resolves.toMatchObject({
      status: 'previewing',
      scope: { kind: 'selection', aids: [1, 2] },
      scan: { phase: 'complete', taggedItemCount: 0, untaggedItemCount: 2 }
    })
    expect(refreshSelectedVideoMetadata).not.toHaveBeenCalled()
  })

  it('refuses to replace an unfinished account workspace with a selection scope', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-24T00:00:00.000Z' })
    await repository.commit('100', {
      id: 'seed-1', accountMid: '100', issuedAt: '2026-07-24T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: '视频一', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' }
    })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })
    const accountWorkspace = await coordinator.beginScan('100', 'incremental')

    await expect(coordinator.beginSelectedReorganization('100', [1]))
      .rejects.toThrow('当前有未结束的全库整理草稿')
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({ workspaceId: accountWorkspace.workspaceId })
  })

  it('prepares account targets before an explicit organization scan begins', async () => {
    const root = await createRoot()
    const prepareForOrganization = vi.fn().mockResolvedValue(undefined)
    const coordinator = createCoordinator(
      new FavoriteRepositoryService({ root }),
      new OldFavoriteWorkspaceStore({ root }),
      { initializeOnOpen: false, prepareForOrganization }
    )

    await coordinator.beginScan('100', 'incremental')

    expect(prepareForOrganization).toHaveBeenCalledOnce()
    expect(prepareForOrganization).toHaveBeenCalledWith('100')
  })

  it('keeps a new account idle until an explicit scan begins', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-22T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })

    await expect(coordinator.open('100')).resolves.toBeNull()
    await expect(coordinator.getSnapshot('100')).resolves.toBeNull()
    expect((await repository.getSnapshot('100')).workspace).toBeUndefined()

    await expect(coordinator.beginScan('100', 'incremental')).resolves.toMatchObject({
      status: 'scanning', mode: 'incremental'
    })
  })

  it('persists a ten-minute scan retry cooldown after a Bilibili HTML 412 response', async () => {
    const root = await createRoot()
    let now = '2026-07-19T00:00:00.000Z'
    const repository = new FavoriteRepositoryService({ root, now: () => now })
    const store = new OldFavoriteWorkspaceStore({ root })
    const first = new OldFavoriteWorkspaceCoordinator({ repository, workspaceStore: store, now: () => now })
    await first.beginScan('100', 'incremental')

    await first.recordScanFailure(
      '100',
      'invalid-response [category=non-json http=412 content-type=text/html]',
      await first.getActiveScanRunId('100')
    )

    await expect(first.getSnapshot('100')).resolves.toMatchObject({
      scan: {
        phase: 'failed',
        retryAvailableAt: '2026-07-19T00:10:00.000Z'
      }
    })
    await expect(first.getScanRetryState('100')).resolves.toEqual({
      reason: 'invalid-response [category=non-json http=412 content-type=text/html]',
      retryAvailableAt: '2026-07-19T00:10:00.000Z'
    })
    const restarted = new OldFavoriteWorkspaceCoordinator({
      repository: new FavoriteRepositoryService({ root, now: () => now }),
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      now: () => now
    })
    await expect(restarted.beginScan('100', 'incremental')).rejects.toThrow(/retry-cooldown.*http=412/i)

    now = '2026-07-19T00:10:00.000Z'
    await expect(restarted.beginScan('100', 'incremental')).resolves.toMatchObject({
      scan: { phase: 'inventory', failureCount: 0 }
    })
  })

  it('resumes an expired 412 scan without discarding persisted pages or progress', async () => {
    const root = await createRoot()
    let now = '2026-07-19T00:00:00.000Z'
    const repository = new FavoriteRepositoryService({ root, now: () => now })
    const store = new OldFavoriteWorkspaceStore({ root })
    const coordinator = new OldFavoriteWorkspaceCoordinator({ repository, workspaceStore: store, now: () => now })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source-1', title: 'Source', itemCount: 40, isBilimiWorkFolder: false }]
    })
    const runId = await coordinator.getActiveScanRunId('100')
    await coordinator.recordScanPage('100', {
      folderId: 'source-1', page: 1, hasMore: true,
      items: [{ aid: 1, title: 'V1', tags: ['Technology'], sourceFolderIds: ['source-1'] }]
    }, runId)
    await coordinator.recordScanFailure(
      '100', 'invalid-response [category=non-json http=412 content-type=text/html]', runId
    )

    now = '2026-07-19T00:10:00.000Z'
    await expect(coordinator.resumeFailedScan('100')).resolves.toMatchObject({
      scan: {
        phase: 'inventory', totalItemCount: 40, scannedItemCount: 1,
        taggedItemCount: 1, untaggedItemCount: 0
      }
    })
    expect(await coordinator.getActiveScanRunId('100')).toBe(runId)
    await expect(coordinator.getScanResumeState('100')).resolves.toMatchObject({
      runId,
      completedPages: [{ folderId: 'source-1', page: 1, hasMore: true }]
    })

    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source-1', title: 'Source', itemCount: 41, isBilimiWorkFolder: false }]
    }, runId)
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      scan: { phase: 'inventory', totalItemCount: 41, scannedItemCount: 1, taggedItemCount: 1, untaggedItemCount: 0 }
    })
  })

  it('keeps ordinary scan failures immediately retryable', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }), now: () => '2026-07-19T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanFailure('100', 'network-failure', await coordinator.getActiveScanRunId('100'))

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      scan: { phase: 'failed', reason: 'network-failure' }
    })
    expect(requireSnapshot(await coordinator.getSnapshot('100')).scan.retryAvailableAt).toBeUndefined()
    await expect(coordinator.beginScan('100', 'incremental')).resolves.toMatchObject({
      scan: { phase: 'inventory' }
    })
  })

  it('continues an ordinary failed scan without replacing its durable lease or persisted pages', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: store, now: () => '2026-07-19T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source-1', title: 'Source', itemCount: 40, isBilimiWorkFolder: false }]
    })
    const runId = await coordinator.getActiveScanRunId('100')
    await coordinator.recordScanPage('100', {
      folderId: 'source-1', page: 1, hasMore: true,
      items: [{ aid: 1, title: 'V1', tags: ['Technology'], sourceFolderIds: ['source-1'] }]
    }, runId)
    await coordinator.recordScanFailure('100', 'target-unavailable', runId)

    await expect(coordinator.resumeScan('100')).resolves.toMatchObject({
      scan: { phase: 'inventory', totalItemCount: 40, scannedItemCount: 1 }
    })
    expect(await coordinator.getActiveScanRunId('100')).toBe(runId)
    await expect(coordinator.getScanResumeState('100')).resolves.toMatchObject({
      runId,
      completedPages: [{ folderId: 'source-1', page: 1, hasMore: true }]
    })
  })

  it('lets the user explicitly restart a restored portable draft without reporting a rebuild failure', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-24T00:00:00.000Z' })
    const base = await repository.getSnapshot('100')
    const archive = createFavoriteRepositoryArchiveExport({
      ...base,
      workspace: {
        id: 'portable-draft', accountMid: '100', status: 'draft', resumable: true, baselineRevision: 0, continuationAids: [],
        workspaceRef: { workspaceId: 'portable-draft', accountMid: '100', status: 'draft', baselineRevision: 0, currentSegmentId: '', overlayRevision: 0, journalCursor: 0, checksum: 'a'.repeat(64), updatedAt: '2026-07-24T00:00:00.000Z' }
      }
    }, { generatedAt: '2026-07-24T00:00:00.000Z' })
    await repository.applyArchiveImport('100', { validate: () => archive, mode: 'overwrite' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })

    await expect(coordinator.beginScan('100', 'incremental')).resolves.toMatchObject({ status: 'scanning' })
  })

  it('reports a restored portable draft as resumable instead of corrupt', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-24T00:00:00.000Z' })
    const base = await repository.getSnapshot('100')
    const archive = createFavoriteRepositoryArchiveExport({
      ...base,
      workspace: {
        id: 'portable-draft', accountMid: '100', status: 'draft', resumable: true, baselineRevision: 0, continuationAids: [],
        workspaceRef: { workspaceId: 'portable-draft', accountMid: '100', status: 'draft', baselineRevision: 0, currentSegmentId: '', overlayRevision: 0, journalCursor: 0, checksum: 'a'.repeat(64), updatedAt: '2026-07-24T00:00:00.000Z' }
      }
    }, { generatedAt: '2026-07-24T00:00:00.000Z' })
    await repository.applyArchiveImport('100', { validate: () => archive, mode: 'overwrite' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })

    await expect(coordinator.getRecoverySummary('100')).resolves.toMatchObject({
      status: 'draft', currentStep: 'draft', recoveryChoices: ['view', 'rescan']
    })
  })

  it('persists tag enrichment pause, resume, and current-tag adoption across coordinator restart', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(repository, store)
    await first.open('100')
    await first.beginScan('100', 'full')
    await first.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2, isBilimiWorkFolder: false }]
    })
    await first.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'Tagged', tags: ['existing'], sourceFolderIds: ['source'] },
        { aid: 2, title: 'Pending', sourceFolderIds: ['source'] }
      ]
    })
    await first.finishScan('100')
    await first.pauseTagEnrichment('100')

    await expect(first.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: { status: 'paused', totalItemCount: 1, completedItemCount: 0, pendingItemCount: 1 }
    })
    const restarted = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: { status: 'paused', totalItemCount: 1, completedItemCount: 0, pendingItemCount: 1 }
    })
    await restarted.resumeTagEnrichment('100')
    await expect(restarted.getPendingTagEnrichmentAids('100')).resolves.toEqual([2])
    await restarted.acceptCurrentTags('100')
    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: { status: 'accepted', totalItemCount: 1, completedItemCount: 0, pendingItemCount: 1 }
    })
  })

  it('restores tag enrichment journals written before failed tag counts existed', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(repository, store)
    await first.open('100')
    await first.beginScan('100', 'full')
    await first.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false }]
    })
    await first.recordScanPage('100', {
      folderId: 'source', page: 1, items: [{ aid: 1, title: 'Pending', sourceFolderIds: ['source'] }]
    })
    await first.finishScan('100')
    const workspaceId = (await first.getSnapshot('100') as { workspaceId: string }).workspaceId
    await store.appendOverlay('100', workspaceId, {
      currentSegmentId: 'segment-1', classifications: [], history: [],
      tagEnrichment: { status: 'paused', totalItemCount: 1, completedItemCount: 0, pendingAids: [1] }
    })

    const restarted = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))

    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: { status: 'paused', failedItemCount: 0 }
    })
  })

  it('rebuilds tag recommendations as soon as tag enrichment naturally completes', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [{ aid: 1, title: 'One', sourceFolderIds: ['source'] }, { aid: 2, title: 'Two', sourceFolderIds: ['source'] }]
    })
    await coordinator.finishScan('100')
    expect((await coordinator.getSnapshot('100') as { recommendations: { candidates: Array<{ kind: string }> } }).recommendations.candidates)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'tag' })]))

    await coordinator.recordTagEnrichment('100', 1, ['音乐'], (await coordinator.getSnapshot('100') as { workspaceId: string }).workspaceId)
    await coordinator.recordTagEnrichment('100', 2, ['音乐'], (await coordinator.getSnapshot('100') as { workspaceId: string }).workspaceId)

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: { status: 'complete', completedItemCount: 2, pendingItemCount: 0 },
      scan: { scannedItemCount: 2, taggedItemCount: 2, untaggedItemCount: 0 },
      recommendations: { candidates: expect.arrayContaining([expect.objectContaining({ kind: 'tag', displayName: 'bilimi·音乐' })]) }
    })
  })

  it('classifies an initially untagged scan item when its final tag result arrives', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const classifyCurrentItem = vi.fn().mockReturnValue({ targetLedgerIds: ['knowledge'], confidence: 'high' as const })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { classifyCurrentItem })
    await coordinator.open('100')
    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [{ aid: 1, title: 'Untitled', category: '科技', sourceFolderIds: ['source'] }]
    })
    await coordinator.finishScan('100')
    expect(classifyCurrentItem).not.toHaveBeenCalled()

    const workspaceId = (await coordinator.getSnapshot('100') as { workspaceId: string }).workspaceId
    await coordinator.recordTagEnrichment('100', 1, ['TypeScript'], workspaceId)

    expect(classifyCurrentItem).toHaveBeenCalledWith(expect.objectContaining({
      aid: 1, category: '科技', tags: ['TypeScript']
    }))
  })

  it('classifies every item when the final tag request completes without tags', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const classifyCurrentItem = vi.fn().mockReturnValue({ targetLedgerIds: ['knowledge'], confidence: 'high' as const })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { classifyCurrentItem })
    await coordinator.open('100')
    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'Tagged item', category: '科技', sourceFolderIds: ['source'] },
        { aid: 2, title: 'No tag item', category: '生活', sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')
    const workspaceId = (await coordinator.getSnapshot('100') as { workspaceId: string }).workspaceId

    await coordinator.recordTagEnrichment('100', 1, ['TypeScript'], workspaceId)
    await coordinator.recordTagEnrichment('100', 2, [], workspaceId)

    expect(classifyCurrentItem).toHaveBeenCalledTimes(2)
    expect(classifyCurrentItem).toHaveBeenCalledWith(expect.objectContaining({ aid: 1, tags: ['TypeScript'] }))
    expect(classifyCurrentItem).toHaveBeenCalledWith(expect.objectContaining({ aid: 2, tags: [] }))
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: { status: 'complete', completedItemCount: 2, pendingItemCount: 0 },
      scan: { taggedItemCount: 1, untaggedItemCount: 1 },
      planReadiness: { classifiedAidCount: 2, unclassifiedAidCount: 0 }
    })
  })

  it('finishes tag enrichment with a visible failed-item count while still classifying the remaining videos', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const classifyCurrentItem = vi.fn().mockReturnValue({ targetLedgerIds: ['knowledge'], confidence: 'high' as const })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { classifyCurrentItem })
    await coordinator.open('100')
    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'Tagged item', category: '科技', sourceFolderIds: ['source'] },
        { aid: 2, title: 'Failed tag item', category: '生活', sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')
    const workspaceId = (await coordinator.getSnapshot('100') as { workspaceId: string }).workspaceId

    await coordinator.recordTagEnrichment('100', 1, ['TypeScript'], workspaceId)
    await coordinator.recordTagEnrichmentFailure('100', 2, 'network-failure', workspaceId)

    expect(classifyCurrentItem).toHaveBeenCalledTimes(2)
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: { status: 'complete', completedItemCount: 2, pendingItemCount: 0, failedItemCount: 1 },
      scan: { taggedItemCount: 1, untaggedItemCount: 1 },
      planReadiness: { classifiedAidCount: 2, unclassifiedAidCount: 0 }
    })
  })

  it('mirrors videos added externally to a formal Bilimi folder into the local library', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'formal', title: 'bilimi Archive', itemCount: 1, isBilimiWorkFolder: true }]
    })
    await coordinator.recordManagedMembers('100', { formal: [7] })
    await coordinator.finishScan('100')

    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      memberships: { 'bilibili:formal': [7] },
      videos: { '7': expect.objectContaining({ aid: 7 }) }
    })
  })

  it('does not reintroduce a tombstoned video when finishing a later Bilibili scan', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    await repository.commit('100', {
      id: 'deleted-locally', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'tombstone-favorite-video',
      payload: { aid: 7, deletedAt: '2026-07-20T00:00:00.000Z', allowRediscovery: false }
    })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'formal', title: 'bilimi Archive', itemCount: 1, isBilimiWorkFolder: true }]
    })
    await coordinator.recordManagedMembers('100', { formal: [7] })
    await coordinator.finishScan('100')

    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      memberships: { 'bilibili:formal': [] },
      videos: {},
      positions: {}
    })
  })

  it('projects a completed scan into remote placement without replacing local intent or adding a user event', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    await repository.commit('100', {
      id: 'bind-formal', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'upsert-physical-shard-binding',
      payload: {
        logicalLedgerId: 'knowledge', logicalTitle: 'Knowledge', shardNumber: 1, memberAids: [],
        remoteTitle: 'bilimi Knowledge', bindingState: 'bound', remoteFolderId: 'formal'
      }
    })
    await repository.commit('100', {
      id: 'keep-local-intent', accountMid: '100', issuedAt: '2026-07-20T00:00:01.000Z', type: 'set-favorite-placement',
      payload: {
        aid: 7, localDesiredFolderIds: ['local:keep'], remoteObservedPhysicalFolderIds: [],
        remoteObservedLogicalFolderIds: [], updatedAt: '2026-07-20T00:00:01.000Z'
      }
    })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'formal', title: 'bilimi Knowledge', itemCount: 1, isBilimiWorkFolder: true }]
    })
    await coordinator.recordManagedMembers('100', { formal: [7] })
    await coordinator.finishScan('100')

    const snapshot = await repository.getSnapshot('100')
    expect(snapshot.positions['100:7']).toMatchObject({
      localDesiredFolderIds: ['local:keep'],
      remoteObservedPhysicalFolderIds: ['formal'],
      remoteObservedLogicalFolderIds: ['bilimi-logical:knowledge'],
      observedAt: '2026-07-19T00:00:00.000Z'
    })
  })

  it('repairs an empty stale placement from existing logical membership when the remote folder still matches', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    await repository.commit('100', {
      id: 'bind-knowledge', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'upsert-physical-shard-binding',
      payload: {
        logicalLedgerId: 'knowledge', logicalTitle: 'Knowledge', shardNumber: 1, memberAids: [7],
        remoteTitle: 'bilimi Knowledge', bindingState: 'bound', remoteFolderId: 'formal'
      }
    })
    await repository.commit('100', {
      id: 'stale-empty-placement', accountMid: '100', issuedAt: '2026-07-20T00:00:01.000Z', type: 'set-favorite-placement',
      payload: {
        aid: 7, localDesiredFolderIds: [], remoteObservedPhysicalFolderIds: ['default', 'formal'],
        remoteObservedLogicalFolderIds: ['bilimi-logical:knowledge'], positionState: 'local-only-change',
        updatedAt: '2026-07-20T00:00:01.000Z'
      }
    })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [
        { id: 'default', title: 'Default', itemCount: 1, isBilimiWorkFolder: false },
        { id: 'formal', title: 'bilimi Knowledge', itemCount: 1, isBilimiWorkFolder: true }
      ]
    })
    await coordinator.recordManagedMembers('100', { formal: [7] })
    await coordinator.recordScanPage('100', {
      folderId: 'default', page: 1, items: [{ aid: 7, title: 'Video', sourceFolderIds: ['default'] }]
    })

    await coordinator.finishScan('100')

    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      memberships: { 'bilimi-logical:knowledge': [7] },
      positions: {
        '100:7': {
          localDesiredFolderIds: ['bilimi-logical:knowledge'],
          remoteObservedPhysicalFolderIds: ['default', 'formal'],
          remoteObservedLogicalFolderIds: ['bilimi-logical:knowledge'],
          positionState: 'aligned'
        }
      }
    })
  })

  it('commits a 257-video scan observation as one bounded repair batch', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    await repository.commit('100', {
      id: 'bind-creative', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'upsert-physical-shard-binding',
      payload: {
        logicalLedgerId: 'creative-aesthetic', logicalTitle: 'bilimi·创意美学', shardNumber: 1, memberAids: [],
        remoteTitle: 'bilimi·创意美学', bindingState: 'bound', remoteFolderId: 'creative'
      }
    })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'creative', title: 'bilimi·创意美学', itemCount: 257, isBilimiWorkFolder: true }]
    })
    await coordinator.recordManagedMembers('100', { creative: Array.from({ length: 257 }, (_, index) => index + 1) })
    const commit = vi.spyOn(repository, 'commit')

    await coordinator.finishScan('100')

    const repairs = commit.mock.calls.filter(([, command]) => command.type === 'set-favorite-placements')
    expect(repairs).toHaveLength(1)
    expect(repairs[0][1].payload.placements).toHaveLength(257)
  })

  it('retries a stale repair batch without overwriting a concurrent user placement', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    await repository.commit('100', {
      id: 'bind-knowledge', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'upsert-physical-shard-binding',
      payload: { logicalLedgerId: 'knowledge', logicalTitle: 'Knowledge', shardNumber: 1, memberAids: [], remoteTitle: 'Knowledge', bindingState: 'bound', remoteFolderId: 'knowledge' }
    })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'knowledge', title: 'Knowledge', itemCount: 1, isBilimiWorkFolder: true }]
    })
    await coordinator.recordManagedMembers('100', { knowledge: [7] })
    const originalCommit = repository.commit.bind(repository)
    let raced = false
    vi.spyOn(repository, 'commit').mockImplementation(async (accountMid, command) => {
      if (!raced && command.type === 'set-favorite-placements') {
        raced = true
        await originalCommit(accountMid, {
          id: 'user-move-during-repair', accountMid, issuedAt: '2026-07-20T00:00:01.000Z', type: 'set-favorite-placement',
          payload: { aid: 7, localDesiredFolderIds: ['local:keep'], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], updatedAt: '2026-07-20T00:00:01.000Z' }
        })
      }
      return originalCommit(accountMid, command)
    })

    await coordinator.finishScan('100')

    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      positions: { '100:7': { localDesiredFolderIds: ['local:keep'], remoteObservedLogicalFolderIds: ['bilimi-logical:knowledge'] } }
    })
  })

  it('keeps a duplicate remote binding as a physical observation without choosing one logical target', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    for (const logicalLedgerId of ['music', 'games']) {
      await repository.commit('100', {
        id: `bind-${logicalLedgerId}`, accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'upsert-physical-shard-binding',
        payload: {
          logicalLedgerId, logicalTitle: logicalLedgerId, shardNumber: 1, memberAids: [],
          remoteTitle: 'bilimi Shared', bindingState: 'bound', remoteFolderId: 'shared'
        }
      })
    }
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'shared', title: 'bilimi Shared', itemCount: 1, isBilimiWorkFolder: true }]
    })
    await coordinator.recordManagedMembers('100', { shared: [7] })
    await coordinator.finishScan('100')

    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      positions: {
        '100:7': {
          remoteObservedPhysicalFolderIds: ['shared'],
          remoteObservedLogicalFolderIds: [],
          positionState: 'needs-review',
          reason: 'binding-conflict'
        }
      }
    })
  })

  it('resumes only the remaining tag reads after accepting the current tags', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const classifyCurrentItem = vi.fn().mockReturnValue({ targetLedgerIds: ['knowledge'], confidence: 'high' as const })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { classifyCurrentItem })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanPage('100', { folderId: 'source', page: 1, items: [
      { aid: 1, title: 'Tagged', sourceFolderIds: ['source'] },
      { aid: 2, title: 'Pending', sourceFolderIds: ['source'] }
    ] })
    await coordinator.finishScan('100')
    const workspaceId = (await coordinator.getSnapshot('100') as { workspaceId: string }).workspaceId
    await coordinator.recordTagEnrichment('100', 1, ['TypeScript'], workspaceId)

    await coordinator.acceptCurrentTags('100')
    const classificationCountAfterAccepting = classifyCurrentItem.mock.calls.length
    await coordinator.resumeTagEnrichment('100')

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: { status: 'running', pendingItemCount: 1, failedItemCount: 0 }
    })
    expect(await coordinator.getPendingTagEnrichmentAids('100')).toEqual([2])
    expect(classifyCurrentItem).toHaveBeenCalledTimes(classificationCountAfterAccepting)
  })

  it('requeues only failed tag reads without reprocessing confirmed empty tags', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanPage('100', { folderId: 'source', page: 1, items: [
      { aid: 1, title: 'No tags', sourceFolderIds: ['source'] },
      { aid: 2, title: 'Failed', sourceFolderIds: ['source'] }
    ] })
    await coordinator.finishScan('100')
    const workspaceId = (await coordinator.getSnapshot('100') as { workspaceId: string }).workspaceId
    await coordinator.recordTagEnrichment('100', 1, [], workspaceId)
    await coordinator.recordTagEnrichmentFailure('100', 2, 'network-failure', workspaceId)

    await coordinator.retryFailedTagEnrichment('100')

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: { status: 'running', pendingItemCount: 1, failedItemCount: 0 }
    })
    expect(await coordinator.getPendingTagEnrichmentAids('100')).toEqual([2])
  })

  it('does not reread a confirmed-empty tag result after a later incremental scan', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await repository.commit('100', {
      id: 'confirmed-empty', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'No tags', tags: [], tagEvidence: 'confirmed', updatedAt: '2026-07-20T00:00:00.000Z' }
    })

    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanPage('100', { folderId: 'source', page: 1, items: [
      { aid: 1, title: 'No tags', sourceFolderIds: ['source'] }
    ] })
    await coordinator.finishScan('100')

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: { status: 'complete', totalItemCount: 0, pendingItemCount: 0 }
    })
  })

  it('reuses legacy nonempty library tags without fetching them again', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await repository.commit('100', {
      id: 'legacy-tagged', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'Cached tags', tags: ['TypeScript'], updatedAt: '2026-07-20T00:00:00.000Z' }
    })

    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1, items: [{ aid: 1, title: 'Cached tags', sourceFolderIds: ['source'] }]
    })
    await coordinator.finishScan('100')

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      currentSegment: { items: [expect.objectContaining({ aid: 1, tags: ['TypeScript'] })] },
      tagEnrichment: { status: 'complete', totalItemCount: 0, pendingItemCount: 0, reusedTagItemCount: 1, fetchedTagItemCount: 0 }
    })
  })

  it('rejects a stale tag-enrichment result after full reorganization creates a new workspace', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1, items: [{ aid: 1, title: 'Pending', sourceFolderIds: ['source'] }]
    })
    await coordinator.finishScan('100')
    const oldWorkspaceId = (await coordinator.getSnapshot('100') as { workspaceId: string }).workspaceId

    await coordinator.beginScan('100', 'full')

    await expect(coordinator.recordTagEnrichment('100', 1, ['stale'], oldWorkspaceId)).resolves.toBe(false)
  })

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

  it('classifies every scanned segment after tag enrichment completes', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const classifyCurrentItem = vi.fn((item: { aid: number }) => ({
      targetLedgerIds: [item.aid % 2 ? 'knowledge' : 'music'], confidence: 'high' as const
    }))
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { classifyCurrentItem })
    await coordinator.open('100')
    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2_001, isBilimiWorkFolder: false }]
    })
    for (let offset = 0; offset < 2_001; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source', page: (offset / 50) + 1,
        items: Array.from({ length: Math.min(50, 2_001 - offset) }, (_, index) => ({
          aid: offset + index + 1, title: `Video ${offset + index + 1}`, tags: ['technology'], sourceFolderIds: ['source']
        }))
      })
    }

    await coordinator.finishScan('100')

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      planReadiness: { selectedAidCount: 2_001, classifiedAidCount: 2_001, unclassifiedAidCount: 0 }
    })
    expect(classifyCurrentItem).toHaveBeenCalledTimes(2_001)
  })

  it('passes adopted tag recommendations to automatic classification as tag rules', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const classifyCurrentItem = vi.fn().mockReturnValue({ targetLedgerIds: [], confidence: 'low' as const })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { classifyCurrentItem })
    await coordinator.open('100')
    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'One', tags: ['TypeScript'], sourceFolderIds: ['source'] },
        { aid: 2, title: 'Two', tags: ['TypeScript'], sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')
    const snapshot = requireSnapshot(await coordinator.getSnapshot('100'))
    const tagCandidate = snapshot.recommendations.candidates.find((candidate) => candidate.kind === 'tag')
    if (!tagCandidate) throw new Error('tag recommendation unexpectedly unavailable')

    await coordinator.setRecommendedCandidates('100', [tagCandidate.id])
    await coordinator.prepareRecommendationPreview('100', [tagCandidate.id])

    expect(classifyCurrentItem).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ id: tagCandidate.id, ruleType: 'tag' })])
    )
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
      memberships: { 'local:inbox': expect.arrayContaining([2_001]) }
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

  it('creates a new empty workspace for every explicit full reorganization', async () => {
    const root = await createRoot()
    const coordinator = createCoordinator(
      new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' }),
      new OldFavoriteWorkspaceStore({ root })
    )
    const initial = requireWorkspace(await coordinator.open('100'))
    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'bilimi-empty', title: 'Bilimi·Inbox', itemCount: 0, isBilimiWorkFolder: true }]
    })

    const reset = await coordinator.beginScan('100', 'full')

    expect(reset).toMatchObject({ mode: 'full', status: 'scanning', sourceFolders: [] })
    expect(reset.workspaceId).not.toBe(initial.id)
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      mode: 'full', workspaceId: reset.workspaceId, sourceFolders: []
    })
  })

  it('clears the favorite library repository when the user explicitly requests a clean full reorganization', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await repository.commit('100', {
      id: 'stale-library', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'commit-local-plan',
      payload: { workspaceId: 'old-workspace', memberAidsByFolderId: { 'local:inbox': [1] },
        folders: [{ id: 'local:inbox', title: 'Inbox', kind: 'local', syncState: 'local-only' }],
        videos: [{ aid: 1, title: 'Stale', tags: [], updatedAt: '2026-07-19T00:00:00.000Z' }] }
    })
    await coordinator.open('100')

    await coordinator.beginScan('100', 'full')

    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      videos: {}, folders: [], memberships: {}, physicalShards: [], syncRecords: [], organizationRecords: []
    })
  })

  it('abandons a preview workspace while retaining already saved favorite library records', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await repository.commit('100', {
      id: 'saved-video', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'Saved', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }
    })

    await coordinator.abandonCurrentWorkspace('100')

    await expect(coordinator.getSnapshot('100')).resolves.toBeNull()
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      workspace: undefined,
      videos: { 1: { title: 'Saved' } }
    })
  })

  it('treats an already-cleared legacy workspace as safely abandoned', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })
    await repository.commit('100', {
      id: 'saved-video', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'Saved', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }
    })

    await expect(coordinator.abandonCurrentWorkspace('100')).resolves.toBeUndefined()
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      workspace: undefined,
      videos: { 1: { title: 'Saved' } }
    })
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
    await coordinator.beginScan('100', 'incremental')
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

  it('treats full reorganization as a fresh workspace even when reconciliation is pending', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const syncService = new FavoriteRepositorySyncService({
      repository,
      pageBridgeManager: { bind: vi.fn(), release: vi.fn(), pageBridge: vi.fn() },
      now: () => '2026-07-20T00:00:00.000Z'
    })
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
    await coordinator.beginScan('100', 'incremental')
    const oldWorkspace = await coordinator.open('100')
    if (!oldWorkspace || 'recovery' in oldWorkspace) throw new Error('workspace unexpectedly unavailable')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })
    await coordinator.freezeForBilibiliExecution('100')
    const frozen = (await repository.getSnapshot('100')).workspace!
    await repository.commit('100', {
      id: 'mark-reconciling', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'set-workspace',
      payload: { ...frozen, status: 'reconciling', workspaceRef: { ...frozen.workspaceRef, status: 'reconciling' } }
    })

    const reset = await coordinator.beginScan('100', 'full')

    expect(reset).toMatchObject({ status: 'scanning', mode: 'full', workspaceId: expect.not.stringContaining(oldWorkspace.id) })
    const persisted = await repository.getSnapshot('100')
    expect(persisted.workspace).toMatchObject({ status: 'scanning', baselineRevision: 0 })
    expect(persisted.workspace?.id).not.toBe(oldWorkspace.id)
    expect(persisted.workspace?.frozenSyncPlan).toBeUndefined()
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
    const workspace = requireWorkspace(await coordinator.open('100'))
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
    const initial = requireWorkspace(await coordinator.open('100'))
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
    const completed = requireWorkspace(await coordinator.open('100'))
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
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({ scan: { totalItemCount: 4, scannedItemCount: 4 } })
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
    await coordinator.beginScan('100', 'incremental')
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

  it('recovers uniquely identified managed remote folders into logical bindings without absorbing ordinary folders', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [
        { id: 'managed-creative', title: 'bilimi·创意美学', itemCount: 2, isBilimiWorkFolder: true },
        { id: 'ordinary', title: '普通收藏夹', itemCount: 1, isBilimiWorkFolder: false }
      ]
    })
    await coordinator.recordManagedMembers('100', { 'managed-creative': [11, 12] })
    await coordinator.recordScanPage('100', {
      folderId: 'ordinary', page: 1,
      items: [{ aid: 21, title: '普通视频', sourceFolderIds: ['ordinary'] }]
    })

    await coordinator.finishScan('100')

    const first = await repository.getSnapshot('100')
    expect(first.folders).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'bilimi-logical:creative-aesthetic', kind: 'bilimi-logical', title: 'bilimi·创意美学' }),
      expect.objectContaining({ id: 'bilibili:ordinary', kind: 'bilibili', title: '普通收藏夹' })
    ]))
    await expect(repository.getLibrarySummary('100')).resolves.toMatchObject({
      folders: expect.arrayContaining([
        expect.objectContaining({ id: 'bilimi-logical:creative-aesthetic', kind: 'bilimi-logical' }),
        expect.objectContaining({ id: 'bilibili:ordinary', kind: 'bilibili' })
      ])
    })
    expect(first.physicalShards).toEqual([expect.objectContaining({
      logicalLedgerId: 'creative-aesthetic', shardNumber: 1, remoteFolderId: 'managed-creative', bindingState: 'bound'
    })])
    expect(first.memberships).toMatchObject({
      'bilimi-logical:creative-aesthetic': [11, 12],
      'bilimi:creative-aesthetic:001': [11, 12],
      'bilibili:ordinary': [21]
    })
    expect(first.positions['100:11']).toMatchObject({
      remoteObservedPhysicalFolderIds: ['managed-creative'],
      remoteObservedLogicalFolderIds: ['bilimi-logical:creative-aesthetic']
    })

    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [
        { id: 'managed-creative', title: 'bilimi·创意美学', itemCount: 2, isBilimiWorkFolder: true },
        { id: 'ordinary', title: '普通收藏夹', itemCount: 1, isBilimiWorkFolder: false }
      ]
    })
    await coordinator.recordManagedMembers('100', { 'managed-creative': [11, 12] })
    await coordinator.recordScanPage('100', {
      folderId: 'ordinary', page: 1,
      items: [{ aid: 21, title: '普通视频', sourceFolderIds: ['ordinary'] }]
    })
    await coordinator.finishScan('100')

    const second = await repository.getSnapshot('100')
    expect(second.folders.filter((folder) => folder.id === 'bilimi-logical:creative-aesthetic')).toHaveLength(1)
    expect(second.physicalShards.filter((shard) => shard.remoteFolderId === 'managed-creative')).toHaveLength(1)
    expect(second.memberships['bilimi-logical:creative-aesthetic']).toEqual([11, 12])
  })

  it('keeps duplicate remote titles pending instead of choosing a managed binding', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [
        { id: 'creative-a', title: 'bilimi·创意美学', itemCount: 1, isBilimiWorkFolder: true },
        { id: 'creative-b', title: 'bilimi·创意美学', itemCount: 1, isBilimiWorkFolder: true }
      ]
    })
    await coordinator.recordManagedMembers('100', { 'creative-a': [1], 'creative-b': [2] })
    await coordinator.finishScan('100')

    const snapshot = await repository.getSnapshot('100')
    expect(snapshot.folders).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'bilimi-logical:creative-aesthetic', kind: 'bilimi-logical', syncState: 'pending-reconcile' })
    ]))
    expect(snapshot.physicalShards).toEqual(expect.arrayContaining([
      expect.objectContaining({ logicalLedgerId: 'creative-aesthetic', bindingState: 'pending-reconcile', knownRemoteFolderIds: ['creative-a', 'creative-b'] })
    ]))
    expect(snapshot.memberships['bilimi-logical:creative-aesthetic']).toEqual([])
    expect(snapshot.folders.filter((folder) => folder.kind === 'bilibili').map((folder) => folder.id).sort())
      .toEqual(['bilibili:creative-a', 'bilibili:creative-b'])
  })

  it('keeps duplicate custom remote titles on one explicitly unbound logical target', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [
        { id: 'custom-a', title: 'bilimi\u00b7\u6211\u7684\u7247\u5355', itemCount: 1, isBilimiWorkFolder: true },
        { id: 'custom-b', title: 'bilimi\u00b7\u6211\u7684\u7247\u5355', itemCount: 1, isBilimiWorkFolder: true }
      ]
    })
    await coordinator.recordManagedMembers('100', { 'custom-a': [1], 'custom-b': [2] })

    await coordinator.finishScan('100')

    const snapshot = await repository.getSnapshot('100')
    const customFolders = snapshot.folders.filter((folder) => folder.kind === 'bilimi-logical' && folder.title === 'bilimi\u00b7\u6211\u7684\u7247\u5355')
    expect(customFolders).toHaveLength(1)
    expect(customFolders[0]).toMatchObject({ syncState: 'pending-reconcile', logicalLedgerId: expect.stringMatching(/^custom-/) })
    expect(snapshot.physicalShards).toEqual(expect.arrayContaining([
      expect.objectContaining({ logicalLedgerId: customFolders[0].logicalLedgerId, bindingState: 'pending-reconcile', knownRemoteFolderIds: ['custom-a', 'custom-b'] })
    ]))
  })

  it('recovers the staging folder and a unique custom Bilimi workspace with stable logical identities', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [
        { id: 'inbox-remote', title: 'bilimi\u00b7\u6682\u5b58', itemCount: 1, isBilimiWorkFolder: true },
        { id: 'genshin-remote', title: 'bilimi\u00b7\u539f\u795e', itemCount: 2, isBilimiWorkFolder: true },
        { id: 'ordinary-remote', title: '\u666e\u901a\u6536\u85cf', itemCount: 1, isBilimiWorkFolder: false }
      ]
    })
    await coordinator.recordManagedMembers('100', { 'inbox-remote': [1], 'genshin-remote': [2, 3] })

    const commit = vi.spyOn(repository, 'commit')
    await coordinator.finishScan('100')

    const bindingRepairs = commit.mock.calls.filter(([, command]) => command.type === 'repair-persisted-managed-bindings')
    expect(bindingRepairs).toHaveLength(1)
    expect(bindingRepairs[0][1].payload.bindings).toHaveLength(2)

    const snapshot = await repository.getSnapshot('100')
    expect(snapshot.folders).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'bilimi-logical:inbox', title: 'bilimi\u00b7\u6682\u5b58', kind: 'bilimi-logical' }),
      expect.objectContaining({ title: 'bilimi\u00b7\u539f\u795e', kind: 'bilimi-logical', logicalLedgerId: expect.stringMatching(/^custom-/) })
    ]))
    const genshin = snapshot.folders.find((folder) => folder.title === 'bilimi\u00b7\u539f\u795e' && folder.kind === 'bilimi-logical')!
    expect(genshin.logicalLedgerId).not.toBe('game')
    expect(snapshot.physicalShards).toEqual(expect.arrayContaining([
      expect.objectContaining({ logicalLedgerId: 'inbox', remoteFolderId: 'inbox-remote', bindingState: 'bound' }),
      expect.objectContaining({ remoteFolderId: 'genshin-remote', bindingState: 'bound', logicalLedgerId: expect.stringMatching(/^custom-/) })
    ]))
    expect(snapshot.memberships[`bilimi-logical:${genshin.logicalLedgerId}`]).toEqual([2, 3])

    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'genshin-remote', title: 'bilimi·原神收藏', itemCount: 2, isBilimiWorkFolder: true }]
    })
    await coordinator.recordManagedMembers('100', { 'genshin-remote': [2, 3] })
    await coordinator.finishScan('100')

    const renamed = await repository.getSnapshot('100')
    expect(renamed.folders).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `bilimi-logical:${genshin.logicalLedgerId}`, title: 'bilimi·原神收藏' })
    ]))
    expect(renamed.positions['100:2']).toMatchObject({
      localDesiredFolderIds: [`bilimi-logical:${genshin.logicalLedgerId}`],
      remoteObservedPhysicalFolderIds: ['genshin-remote'],
      remoteObservedLogicalFolderIds: [`bilimi-logical:${genshin.logicalLedgerId}`],
      positionState: 'aligned'
    })
    expect(renamed.positions['100:3']).toMatchObject({
      localDesiredFolderIds: [`bilimi-logical:${genshin.logicalLedgerId}`],
      positionState: 'aligned'
    })
  })

  it('creates one disabled local rule draft for a uniquely recovered custom workspace', async () => {
    const root = await createRoot()
    const saved = vi.fn(async (_accountMid: string, _ledgers: FavoriteLedger[]) => undefined)
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { saveRecommendedLedgers: saved })
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'genshin-remote', title: 'bilimi\u00b7\u539f\u795e', itemCount: 2, isBilimiWorkFolder: true }]
    })
    await coordinator.recordManagedMembers('100', { 'genshin-remote': [2, 3] })

    await coordinator.finishScan('100')

    expect(saved).toHaveBeenCalledOnce()
    expect(saved.mock.calls[0][1]).toEqual([expect.objectContaining({
      id: expect.stringMatching(/^custom-/), displayName: '\u539f\u795e', enabled: false,
      bilibiliFolderId: 'genshin-remote', syncState: 'local-draft'
    })])
  })

  it('reconciles a missing local rule draft when the remote binding already exists', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const firstCoordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await firstCoordinator.open('100')
    await firstCoordinator.beginScan('100', 'incremental')
    await firstCoordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'genshin-remote', title: 'bilimi\u00b7\u539f\u795e', itemCount: 2, isBilimiWorkFolder: true }]
    })
    await firstCoordinator.recordManagedMembers('100', { 'genshin-remote': [2, 3] })
    await firstCoordinator.finishScan('100')

    const saved = vi.fn(async (_accountMid: string, _ledgers: FavoriteLedger[]) => undefined)
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { saveRecoveredLedgerDrafts: saved })

    await coordinator.recoverPersistedManagedBindings('100')

    expect(saved).toHaveBeenCalledOnce()
    expect(saved.mock.calls[0][1]).toEqual([expect.objectContaining({
      id: expect.stringMatching(/^custom-/), displayName: '\u539f\u795e', enabled: false,
      bilibiliFolderId: 'genshin-remote', syncState: 'local-draft'
    })])
  })

  it('bounds scan-time deterministic binding repairs to one hundred targets per atomic command', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    const sourceFolders = Array.from({ length: 101 }, (_, index) => ({
      id: `custom-${index + 1}`,
      title: `bilimi·自定义${index + 1}`,
      itemCount: 1,
      isBilimiWorkFolder: true
    }))
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', { sourceFolders })
    await coordinator.recordManagedMembers('100', Object.fromEntries(sourceFolders.map((folder, index) => [folder.id, [index + 1]])))
    const commit = vi.spyOn(repository, 'commit')

    await coordinator.finishScan('100')

    const bindingRepairs = commit.mock.calls.filter(([, command]) => command.type === 'repair-persisted-managed-bindings')
    expect(bindingRepairs).toHaveLength(2)
    expect(bindingRepairs.map(([, command]) => command.payload.bindings.length)).toEqual([100, 1])
  })

  it('restores complete persisted Bilimi folders when an existing account opens the library', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(repository, store)
    await first.open('100')
    await first.recordScanInventory('100', {
      sourceFolders: [
        { id: 'inbox-remote', title: 'bilimi\u00b7\u6682\u5b58', itemCount: 1, isBilimiWorkFolder: true },
        { id: 'genshin-remote', title: 'bilimi\u00b7\u539f\u795e', itemCount: 2, isBilimiWorkFolder: true }
      ]
    })
    await first.recordManagedMembers('100', { 'inbox-remote': [1], 'genshin-remote': [2, 3] })
    await first.finishScan('100')
    const completedMarker = (await repository.getSnapshot('100')).workspace!
    await repository.commit('100', {
      id: 'clear-legacy-bindings', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'clear-local-repository',
      payload: { preserveTombstones: true }
    })
    await repository.commit('100', {
      id: 'legacy-bilibili-mirror', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'record-bilibili-mirror',
      payload: {
        workspaceId: 'legacy-workspace',
        folders: [
          { id: 'bilibili:inbox-remote', title: 'bilimi\u00b7\u6682\u5b58', remoteFolderId: 'inbox-remote' },
          { id: 'bilibili:genshin-remote', title: 'bilimi\u00b7\u539f\u795e', remoteFolderId: 'genshin-remote' },
          { id: 'bilibili:ordinary-remote', title: '\u666e\u901a\u6536\u85cf', remoteFolderId: 'ordinary-remote' }
        ],
        memberAidsByFolderId: {
          'bilibili:inbox-remote': [1], 'bilibili:genshin-remote': [2, 3], 'bilibili:ordinary-remote': [1]
        },
        videos: [1, 2, 3].map((aid) => ({ aid, title: `Video ${aid}`, tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }))
      }
    })
    await repository.commit('100', {
      id: 'restore-legacy-workspace-marker', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'set-workspace',
      payload: completedMarker
    })

    const reopenedRepository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:01.000Z' })
    const reopened = createCoordinator(reopenedRepository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })
    const commit = vi.spyOn(reopenedRepository, 'commit')
    await expect(reopened.recoverPersistedManagedBindings('100')).resolves.toEqual({ recoveredCount: 2, pendingCount: 0 })
    expect(commit).toHaveBeenCalledOnce()
    expect(commit.mock.calls[0][1].type).toBe('repair-persisted-managed-bindings')

    await expect(reopenedRepository.getLibrarySummary('100')).resolves.toMatchObject({
      folders: expect.arrayContaining([
        expect.objectContaining({ id: 'bilimi-logical:inbox', kind: 'bilimi-logical', title: 'bilimi\u00b7\u6682\u5b58' }),
        expect.objectContaining({ kind: 'bilimi-logical', title: 'bilimi\u00b7\u539f\u795e', logicalLedgerId: expect.stringMatching(/^custom-/) })
      ])
    })
    const restored = await reopenedRepository.getSnapshot('100')
    expect(restored.physicalShards).toEqual(expect.arrayContaining([
      expect.objectContaining({ logicalLedgerId: 'inbox', remoteFolderId: 'inbox-remote', bindingState: 'bound' }),
      expect.objectContaining({ logicalLedgerId: expect.stringMatching(/^custom-/), remoteFolderId: 'genshin-remote', bindingState: 'bound' })
    ]))
    expect(restored.positions['100:2']).toMatchObject({
      remoteObservedPhysicalFolderIds: ['genshin-remote'],
      remoteObservedLogicalFolderIds: [expect.stringMatching(/^bilimi-logical:custom-/)]
    })
    expect(restored.positions['100:1']).toMatchObject({
      remoteObservedPhysicalFolderIds: ['inbox-remote', 'ordinary-remote'],
      remoteObservedLogicalFolderIds: ['bilimi-logical:inbox']
    })
  })

  it('continues persisted managed-binding recovery after the first 100 bindings', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(repository, store)
    const sourceFolders = Array.from({ length: 101 }, (_, index) => ({
      id: `custom-remote-${index + 1}`,
      title: `bilimi·分类${index + 1}`,
      itemCount: 1,
      isBilimiWorkFolder: true
    }))
    await first.open('100')
    await first.recordScanInventory('100', { sourceFolders })
    await first.recordManagedMembers('100', Object.fromEntries(sourceFolders.map((folder, index) => [folder.id, [index + 1]])))
    await first.finishScan('100')
    const completedMarker = (await repository.getSnapshot('100')).workspace!
    await repository.commit('100', {
      id: 'clear-persisted-binding-batches', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'clear-local-repository',
      payload: { preserveTombstones: true }
    })
    await repository.commit('100', {
      id: 'restore-persisted-binding-batches-mirror', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'record-bilibili-mirror',
      payload: {
        workspaceId: 'legacy-workspace',
        folders: sourceFolders.map((folder) => ({ id: `bilibili:${folder.id}`, title: folder.title, remoteFolderId: folder.id })),
        memberAidsByFolderId: Object.fromEntries(sourceFolders.map((folder, index) => [`bilibili:${folder.id}`, [index + 1]])),
        videos: sourceFolders.map((_, index) => ({ aid: index + 1, title: `Video ${index + 1}`, tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }))
      }
    })
    await repository.commit('100', {
      id: 'restore-persisted-binding-batches-workspace', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'set-workspace',
      payload: completedMarker
    })

    const reopenedRepository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:01.000Z' })
    const reopened = createCoordinator(reopenedRepository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })
    const commit = vi.spyOn(reopenedRepository, 'commit')
    await expect(reopened.recoverPersistedManagedBindings('100')).resolves.toEqual({ recoveredCount: 101, pendingCount: 0 })

    const repairs = commit.mock.calls.filter(([, command]) => command.type === 'repair-persisted-managed-bindings')
    expect(repairs.map(([, command]) => command.payload.bindings.length)).toEqual([100, 1])
    expect((await reopenedRepository.getSnapshot('100')).physicalShards).toHaveLength(101)
  })

  it('abandons a persisted recovery when a user starts a new scan while its background read is pending', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const coordinator = createCoordinator(repository, store)
    await coordinator.open('100')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'inbox-remote', title: 'bilimi\u00b7\u6682\u5b58', itemCount: 1, isBilimiWorkFolder: true }]
    })
    await coordinator.recordManagedMembers('100', { 'inbox-remote': [1] })
    await coordinator.finishScan('100')

    const members = deferred<Record<string, number[]>>()
    vi.spyOn(store, 'readManagedMembers').mockImplementationOnce(() => members.promise)
    const recovery = coordinator.recoverPersistedManagedBindings('100')
    await vi.waitFor(() => expect(store.readManagedMembers).toHaveBeenCalledOnce())
    await coordinator.beginScan('100', 'full')
    const commit = vi.spyOn(repository, 'commit')

    members.resolve({ 'inbox-remote': [1] })
    await expect(recovery).resolves.toEqual({ recoveredCount: 0, pendingCount: 0 })
    expect(commit).not.toHaveBeenCalled()
  })

  it('continues persisted recovery observations after the first bounded atomic batch', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(repository, store)
    const aids = Array.from({ length: 501 }, (_, index) => index + 1)
    await first.open('100')
    await first.recordScanInventory('100', {
      sourceFolders: [{ id: 'inbox-remote', title: 'bilimi\u00b7\u6682\u5b58', itemCount: aids.length, isBilimiWorkFolder: true }]
    })
    await first.recordManagedMembers('100', { 'inbox-remote': aids })
    await first.finishScan('100')
    const completedMarker = (await repository.getSnapshot('100')).workspace!
    await repository.commit('100', {
      id: 'clear-persisted-recovery-batch', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'clear-local-repository',
      payload: { preserveTombstones: true }
    })
    await repository.commit('100', {
      id: 'restore-persisted-recovery-mirror', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'record-bilibili-mirror',
      payload: {
        workspaceId: 'legacy-workspace',
        folders: [{ id: 'bilibili:inbox-remote', title: 'bilimi\u00b7\u6682\u5b58', remoteFolderId: 'inbox-remote' }],
        memberAidsByFolderId: { 'bilibili:inbox-remote': aids },
        videos: aids.map((aid) => ({ aid, title: `Video ${aid}`, tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }))
      }
    })
    await repository.commit('100', {
      id: 'restore-persisted-recovery-workspace', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'set-workspace',
      payload: completedMarker
    })

    const reopenedRepository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:01.000Z' })
    const reopened = createCoordinator(reopenedRepository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })
    const commit = vi.spyOn(reopenedRepository, 'commit')
    await expect(reopened.recoverPersistedManagedBindings('100')).resolves.toEqual({ recoveredCount: 1, pendingCount: 0 })

    expect(commit).toHaveBeenCalledTimes(2)
    expect(commit.mock.calls.map(([, command]) => command.type)).toEqual([
      'repair-persisted-managed-bindings', 'set-favorite-placements'
    ])
    await expect(reopenedRepository.getSnapshot('100')).resolves.toMatchObject({
      positions: { '100:501': { remoteObservedPhysicalFolderIds: ['inbox-remote'] } }
    })
  })

  it('does not serialize an interactive snapshot behind a background persisted-binding read', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const coordinator = createCoordinator(repository, store)
    await coordinator.open('100')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'inbox-remote', title: 'bilimi·暂存', itemCount: 1, isBilimiWorkFolder: true }]
    })
    await coordinator.recordManagedMembers('100', { 'inbox-remote': [1] })
    await coordinator.finishScan('100')

    const members = deferred<Record<string, number[]>>()
    const readManagedMembers = vi.spyOn(store, 'readManagedMembers').mockImplementationOnce(() => members.promise)
    const recovery = coordinator.recoverPersistedManagedBindings('100')
    await vi.waitFor(() => expect(readManagedMembers).toHaveBeenCalledOnce())

    let snapshotReady = false
    void coordinator.getSnapshot('100').then(() => { snapshotReady = true })
    await vi.waitFor(() => expect(snapshotReady).toBe(true))

    members.resolve({ 'inbox-remote': [1] })
    await recovery
  })

  it('rebuilds placement consistency from the current complete remote set', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'inbox-remote', title: 'bilimi·暂存', itemCount: 1, isBilimiWorkFolder: true }]
    })
    await coordinator.recordManagedMembers('100', { 'inbox-remote': [1] })
    await coordinator.finishScan('100')
    await repository.commit('100', {
      id: 'stale-remote-placement', accountMid: '100', issuedAt: '2026-07-20T00:01:00.000Z', type: 'set-favorite-placement',
      payload: {
        aid: 1,
        localDesiredFolderIds: ['bilimi-logical:inbox'],
        remoteObservedPhysicalFolderIds: ['inbox-remote', 'obsolete-remote'],
        remoteObservedLogicalFolderIds: ['bilimi-logical:inbox'],
        updatedAt: '2026-07-20T00:01:00.000Z'
      }
    })

    await coordinator.recoverPersistedManagedBindings('100')

    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      positions: {
        '100:1': {
          localDesiredFolderIds: ['bilimi-logical:inbox'],
          remoteObservedPhysicalFolderIds: ['inbox-remote'],
          remoteObservedLogicalFolderIds: ['bilimi-logical:inbox']
        }
      }
    })
  })

  it('does not recover persisted Bilimi bindings while its scan is incomplete', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'inbox-remote', title: 'bilimi\u00b7\u6682\u5b58', itemCount: 1, isBilimiWorkFolder: true }]
    })
    await coordinator.recordManagedMembers('100', { 'inbox-remote': [1] })

    await expect(coordinator.recoverPersistedManagedBindings('100')).resolves.toEqual({ recoveredCount: 0, pendingCount: 0 })

    const snapshot = await repository.getSnapshot('100')
    expect(snapshot.physicalShards).toEqual([])
    expect(snapshot.folders).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'bilimi-logical:inbox' })
    ]))
  })

  it('keeps incomplete managed-member recovery pending instead of attaching remote members', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'inbox-remote', title: 'bilimi\u00b7\u6682\u5b58', itemCount: 2, isBilimiWorkFolder: true }]
    })
    await coordinator.recordManagedMembers('100', { 'inbox-remote': [1] })

    await coordinator.finishScan('100')

    const snapshot = await repository.getSnapshot('100')
    expect(snapshot.physicalShards).toEqual(expect.arrayContaining([
      expect.objectContaining({ logicalLedgerId: 'inbox', bindingState: 'pending-reconcile', knownRemoteFolderIds: ['inbox-remote'] })
    ]))
    expect(snapshot.memberships['bilimi-logical:inbox']).toEqual([])
  })

  it('counts only unique planned aids in snapshots and recovery summaries after protected source duplicates', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    const protectedAids = Array.from({ length: 221 }, (_, index) => index + 1)
    const sourceAids = Array.from({ length: 247 }, (_, index) => index + 1)
    await repository.commit('100', {
      id: 'existing-protections', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'record-organization-protections',
      payload: { records: protectedAids.map((aid) => ({ accountMid: '100', aid, targetFolderIds: ['local:archive'], completedAt: '2026-07-20T00:00:00.000Z' })), replace: false }
    })
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 247, isBilimiWorkFolder: false, selected: true }]
    })
    for (let page = 0; page < 5; page += 1) {
      await coordinator.recordScanPage('100', {
        folderId: 'source', page: page + 1,
        items: sourceAids.slice(page * 50, (page + 1) * 50).map((aid) => ({ aid, sourceFolderIds: ['source'] }))
      })
    }
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 6,
      items: [...sourceAids.slice(250), ...sourceAids.slice(0, 3)].map((aid) => ({ aid, sourceFolderIds: ['source'] }))
    })
    await coordinator.finishScan('100')
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [222, 223, 224].map((aid) => ({ aid, targetLedgerIds: ['archive'] }))
    })

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      planReadiness: { selectedAidCount: 26, classifiedAidCount: 3, unclassifiedAidCount: 23 }
    })
    const recovery = await coordinator.getRecoverySummary('100')
    expect(recovery).toMatchObject({ plannedCount: 26, classifiedCount: 3, unclassifiedCount: 23 })
    expect(recovery).not.toMatchObject({ plannedCount: 247 })
    expect(recovery).not.toMatchObject({ unclassifiedCount: 244 })
  })

  it('mirrors a completed Bilibili source scan into the account-scoped favorite library', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    const initial = await coordinator.open('100')
    await coordinator.beginScan('100', 'full')
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
        folderIds: ['bilibili:remote-music', 'local:inbox']
      }]
    })
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      folders: [{ id: 'bilibili:remote-music', title: '音乐收藏', kind: 'bilibili', remoteFolderId: 'remote-music' }],
      positions: {
        '100:7': {
          remoteObservedPhysicalFolderIds: ['remote-music'],
          remoteObservedLogicalFolderIds: []
        }
      }
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

  it('restores a staged scanning lease and resumes without replacing completed pages or tag facts', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    const first = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await first.open('100')
    await first.beginScan('100', 'incremental')
    const runId = await first.getActiveScanRunId('100')
    await first.recordScanInventory('100', { sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2, isBilimiWorkFolder: false }] }, runId)
    await first.recordScanPage('100', { folderId: 'source', page: 1, hasMore: false, items: [
      { aid: 1, tags: ['kept'], sourceFolderIds: ['source'] }
    ] }, runId)

    const resumed = createCoordinator(new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' }), new OldFavoriteWorkspaceStore({ root }))
    await expect(resumed.resumeScan('100')).resolves.toMatchObject({ status: 'scanning', scan: { scannedItemCount: 1 } })
    await expect(resumed.getActiveScanRunId('100')).resolves.toBe(runId)
    await expect(resumed.getScanResumeState('100')).resolves.toEqual({
      runId, completedPages: [{ folderId: 'source', page: 1, hasMore: false }], taggedAids: [1]
    })
  })

  it('reclassifies every segment while preserving manual and DeepSeek decisions', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      classifyCurrentItem: (item) => ({ targetLedgerIds: [item.aid === 1 ? 'knowledge' : 'music'], confidence: 'high' })
    })
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanPage('100', { folderId: 'source', page: 1, items: [
      { aid: 1, title: 'One', sourceFolderIds: ['source'] },
      { aid: 2, title: 'Two', sourceFolderIds: ['source'] },
      { aid: 3, title: 'Three', sourceFolderIds: ['source'] }
    ] })
    await coordinator.finishScan('100')
    await coordinator.applyClassificationBatch('100', { source: 'manual', assignments: [{ aid: 2, targetLedgerIds: ['manual'] }] })
    const beforeDeepSeek = requireSnapshot(await coordinator.getSnapshot('100'))
    if (!beforeDeepSeek.currentSegment) throw new Error('workspace unexpectedly unavailable')
    await coordinator.applyDeepSeekClassificationBatch('100', [{ aid: 3, targetLedgerIds: ['deepseek'] }], {
      workspaceId: beforeDeepSeek.workspaceId,
      currentSegmentId: beforeDeepSeek.currentSegment.id,
      selectedSourceFolderIds: [],
      classifications: { '2': { targetLedgerIds: ['manual'], source: 'manual' } }
    })

    await coordinator.reclassifyForFavoriteConfiguration('100')

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({ classifications: {
      '1': { targetLedgerIds: ['knowledge'], source: 'system-high' },
      '2': { targetLedgerIds: ['manual'], source: 'manual' },
      '3': { targetLedgerIds: ['deepseek'], source: 'deepseek' }
    } })
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
    await coordinator.prepareRecommendationPreview('100', ['custom-author-up-alpha'])

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
    await coordinator.prepareRecommendationPreview('100', [])
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

  it('applies an indexed recommendation without preview preparation', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const classifyCurrentItems = vi.fn((items: Array<{ aid: number; author?: string }>, recommendedLedgers: Array<{ id: string }>) =>
      items.map((item) => ({
        targetLedgerIds: item.author === 'UP Alpha' && recommendedLedgers.some((ledger) => ledger.id === 'custom-author-up-alpha')
          ? ['custom-author-up-alpha']
          : [],
        confidence: 'low' as const
      })))
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { classifyCurrentItems })
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 3, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'One', author: 'UP Alpha', sourceFolderIds: ['source'] },
        { aid: 2, title: 'Two', author: 'UP Alpha', sourceFolderIds: ['source'] },
        { aid: 3, title: 'Three', author: 'UP Beta', sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')
    const before = await coordinator.getSnapshot('100')

    await coordinator.setRecommendedCandidates('100', ['custom-author-up-alpha'])

    expect(classifyCurrentItems).toHaveBeenCalledWith(
      [expect.objectContaining({ aid: 1 }), expect.objectContaining({ aid: 2 })],
      [expect.objectContaining({ id: 'custom-author-up-alpha' })],
      '100'
    )
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      recommendations: { adoptedCandidateIds: ['custom-author-up-alpha'] },
      classifications: {
        ...(before && !('recovery' in before) ? before.classifications : {}),
        '1': { targetLedgerIds: ['custom-author-up-alpha'], source: 'system-low' },
        '2': { targetLedgerIds: ['custom-author-up-alpha'], source: 'system-low' }
      }
    })
  })

  it('opens the prepared recommendation preview without classifying the workspace again', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const classifyCurrentItems = vi.fn((items: Array<{ aid: number; author?: string }>, recommendedLedgers: Array<{ id: string }>) =>
      items.map((item) => ({
        targetLedgerIds: item.author === 'UP Alpha' && recommendedLedgers.some((ledger) => ledger.id === 'custom-author-up-alpha')
          ? ['custom-author-up-alpha']
          : [],
        confidence: 'low' as const
      })))
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { classifyCurrentItems })
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 3, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'One', author: 'UP Alpha', sourceFolderIds: ['source'] },
        { aid: 2, title: 'Two', author: 'UP Alpha', sourceFolderIds: ['source'] },
        { aid: 3, title: 'Three', author: 'UP Beta', sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')
    await coordinator.setRecommendedCandidates('100', ['custom-author-up-alpha'])
    const prepared = requireSnapshot(await coordinator.getSnapshot('100'))
    classifyCurrentItems.mockClear()
    const progress = vi.fn()

    await expect(coordinator.prepareRecommendationPreview('100', ['custom-author-up-alpha'], progress))
      .resolves.toMatchObject({ classifications: prepared.classifications })

    expect(classifyCurrentItems).not.toHaveBeenCalled()
    expect(progress).toHaveBeenCalledOnce()
  })

  it('reclassifies only indexed AIDs when a recommendation is added or removed', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const classifiedAids: number[][] = []
    const classifyCurrentItems = vi.fn((
      items: Array<{ aid: number; author?: string }>,
      recommendedLedgers: Array<{ id: string }>
    ) => {
      classifiedAids.push(items.map((item) => item.aid))
      return items.map((item) => ({
        targetLedgerIds: item.author === 'UP Alpha' && recommendedLedgers.some((ledger) => ledger.id === 'custom-author-up-alpha')
          ? ['custom-author-up-alpha']
          : ['system'],
        confidence: 'high' as const
      }))
    })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { classifyCurrentItems })
    await coordinator.open('100')
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, author: 'UP Alpha', sourceFolderIds: ['source'] },
        { aid: 2, author: 'UP Alpha', sourceFolderIds: ['source'] },
        { aid: 3, author: 'UP Beta', sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')
    await coordinator.autoClassifyCurrentSegment('100')
    classifiedAids.length = 0

    await coordinator.setRecommendedCandidates('100', ['custom-author-up-alpha'])
    await coordinator.setRecommendedCandidates('100', [])

    expect(classifiedAids).toEqual([[1, 2], [1, 2]])
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      classifications: {
        '1': { targetLedgerIds: ['system'], source: 'system-high' },
        '2': { targetLedgerIds: ['system'], source: 'system-high' },
        '3': { targetLedgerIds: ['system'], source: 'system-high' }
      }
    })
  })

  it('preserves a DeepSeek classification while recommendation adoption is prepared and removed', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      classifyCurrentItem: (item, recommendedLedgers = []) => ({
        targetLedgerIds: recommendedLedgers.length && item.author === 'UP Alpha'
          ? [recommendedLedgers[0]!.id]
          : ['system'],
        confidence: 'high'
      })
    })
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'System', author: 'UP Alpha', sourceFolderIds: ['source'] },
        { aid: 2, title: 'DeepSeek', author: 'UP Alpha', sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')
    const beforeDeepSeek = requireSnapshot(await coordinator.getSnapshot('100'))
    if (!beforeDeepSeek.currentSegment) throw new Error('workspace unexpectedly unavailable')
    await coordinator.applyDeepSeekClassificationBatch('100', [{ aid: 2, targetLedgerIds: ['deepseek'] }], {
      workspaceId: beforeDeepSeek.workspaceId,
      currentSegmentId: beforeDeepSeek.currentSegment.id,
      selectedSourceFolderIds: ['source'],
      classifications: Object.fromEntries(Object.entries(beforeDeepSeek.classifications).map(([aid, classification]) => [aid, {
        targetLedgerIds: classification.targetLedgerIds,
        source: classification.source
      }]))
    })

    await coordinator.setRecommendedCandidates('100', ['custom-author-up-alpha'])
    await coordinator.prepareRecommendationPreview('100', ['custom-author-up-alpha'])
    await coordinator.setRecommendedCandidates('100', [])
    await coordinator.prepareRecommendationPreview('100', [])

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      classifications: {
        '1': { targetLedgerIds: ['system'], source: 'system-high' },
        '2': { targetLedgerIds: ['deepseek'], source: 'deepseek' }
      }
    })
  })

  it('opens a 2000-item prepared preview with one completed progress update', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const classifyCurrentItems = vi.fn((
      items: Array<{ aid: number; author?: string }>,
      recommendedLedgers: Array<{ id: string }>,
      _accountMid: string,
      options?: { onBatchComplete?: (completed: number, total: number) => void; shouldCancel?: () => boolean }
    ) => classifyOldFavoriteItemsCooperatively(items, (batch) => batch.map((item) => ({
      targetLedgerIds: item.author === 'UP Alpha' && recommendedLedgers.some((ledger) => ledger.id === 'custom-author-up-alpha')
        ? ['custom-author-up-alpha']
        : [],
      confidence: 'low' as const
    })), { batchSize: 128, ...options }))
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { classifyCurrentItems })
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2_000, isBilimiWorkFolder: false }]
    })
    for (let offset = 0; offset < 2_000; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source', page: (offset / 50) + 1,
        items: Array.from({ length: 50 }, (_, index) => ({
          aid: offset + index + 1, author: 'UP Alpha', sourceFolderIds: ['source']
        }))
      })
    }
    await coordinator.finishScan('100')
    await coordinator.setRecommendedCandidates('100', ['custom-author-up-alpha'])
    classifyCurrentItems.mockClear()
    const progress: Array<[number, number]> = []

    await coordinator.prepareRecommendationPreview('100', ['custom-author-up-alpha'], (value) => {
      progress.push([value.completedItemCount, value.totalItemCount])
    })

    expect(progress).toEqual([[2_000, 2_000]])
    expect(classifyCurrentItems).not.toHaveBeenCalled()
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      recommendations: { adoptedCandidateIds: ['custom-author-up-alpha'] },
      planReadiness: { selectedAidCount: 2_000, classifiedAidCount: 2_000, unclassifiedAidCount: 0 }
    })
  })

  it('rejects a stale preview selection without recomputing or changing classifications', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const classifyCurrentItems = vi.fn((items: Array<{ aid: number }>) => items.map(() => ({
      targetLedgerIds: ['music'], confidence: 'high' as const
    })))
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { classifyCurrentItems })
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, author: 'UP Alpha', sourceFolderIds: ['source'] },
        { aid: 2, author: 'UP Alpha', sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')
    await coordinator.setRecommendedCandidates('100', ['custom-author-up-alpha'])
    const before = requireSnapshot(await coordinator.getSnapshot('100'))
    classifyCurrentItems.mockClear()

    await expect(coordinator.prepareRecommendationPreview('100', [], vi.fn()))
      .rejects.toThrow('Old favorite workspace recommendation selection is stale.')
    expect(classifyCurrentItems).not.toHaveBeenCalled()
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({ classifications: before.classifications })
  })

  it('keeps prior recommendation state and classifications when an indexed delta fails', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const classifyCurrentItems = vi.fn((
      items: Array<{ aid: number }>,
      recommendedLedgers: Array<{ id: string }>
    ) => {
      if (recommendedLedgers.length) throw new Error('simulated classification failure')
      return items.map(() => ({ targetLedgerIds: ['music'], confidence: 'high' as const }))
    })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { classifyCurrentItems })
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, author: 'UP Alpha', sourceFolderIds: ['source'] },
        { aid: 2, author: 'UP Alpha', sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')
    const before = requireSnapshot(await coordinator.getSnapshot('100'))

    await expect(coordinator.setRecommendedCandidates('100', ['custom-author-up-alpha']))
      .rejects.toThrow('simulated classification failure')
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      recommendations: { adoptedCandidateIds: [] },
      classifications: before.classifications,
      history: { cursor: before.history.cursor, length: before.history.length }
    })
  })

  it('creates bounded high-frequency tag recommendations from scanned tag metadata', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    const initial = await coordinator.open('100')
    await coordinator.beginScan('100', 'full')
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

  it('keeps an adopted recommendation in the workspace draft until local save', async () => {
    const root = await createRoot()
    const saved = vi.fn().mockResolvedValue(true)
    const published = vi.fn()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      saveRecommendedLedgers: saved,
      notifyRecommendedLedgersChanged: published,
      classifyCurrentItem: () => ({ targetLedgerIds: ['music'], confidence: 'high' })
    })
    const initial = await coordinator.open('100')
    await coordinator.beginScan('100', 'full')
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

    expect(saved).not.toHaveBeenCalled()
    expect(published).not.toHaveBeenCalled()
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      recommendations: { adoptedCandidateIds: ['custom-author-up-alpha'] }
    })

    await coordinator.prepareRecommendationPreview('100', ['custom-author-up-alpha'])
    await coordinator.saveCurrentSegmentToLocalLibrary('100')

    expect(published).toHaveBeenCalledTimes(1)
    expect(saved).toHaveBeenCalledTimes(1)
    expect(saved).toHaveBeenCalledWith(
      '100',
      [expect.objectContaining({
        id: 'custom-author-up-alpha', displayName: 'bilimi·UP Alpha', keywords: ['UP Alpha'],
        ruleType: 'author', enabled: true, isDefault: false
      })],
      ['custom-author-up-alpha']
    )
  })

  it('repairs recommendation preferences when the process reopens after a post-commit save failure', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(repository, workspaceStore, {
      saveRecommendedLedgers: vi.fn().mockRejectedValue(new Error('preferences unavailable')),
      classifyCurrentItem: () => ({ targetLedgerIds: ['music'], confidence: 'high' })
    })
    await first.open('100')
    await first.beginScan('100', 'full')
    await first.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2, isBilimiWorkFolder: false }]
    })
    await first.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'Alpha 1', author: 'UP Alpha', sourceFolderIds: ['source'] },
        { aid: 2, title: 'Alpha 2', author: 'UP Alpha', sourceFolderIds: ['source'] }
      ]
    })
    await first.finishScan('100')
    await first.setRecommendedCandidates('100', ['custom-author-up-alpha'])
    await first.prepareRecommendationPreview('100', ['custom-author-up-alpha'])

    await expect(first.saveCurrentSegmentToLocalLibrary('100')).rejects.toThrow('preferences unavailable')

    const repaired = vi.fn().mockResolvedValue(true)
    const published = vi.fn()
    const reopened = createCoordinator(repository, workspaceStore, {
      initializeOnOpen: false,
      saveRecommendedLedgers: repaired,
      notifyRecommendedLedgersChanged: published
    })
    await expect(reopened.open('100')).resolves.toMatchObject({ status: 'completed' })
    expect(repaired).toHaveBeenCalledWith(
      '100',
      [expect.objectContaining({ id: 'custom-author-up-alpha' })],
      ['custom-author-up-alpha']
    )
    expect(published).toHaveBeenCalledTimes(1)
  })

  it('does not touch account preferences when a recommendation is selected and cleared in the draft', async () => {
    const root = await createRoot()
    const saved = vi.fn().mockResolvedValue(false)
    const published = vi.fn()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      saveRecommendedLedgers: saved,
      notifyRecommendedLedgersChanged: published,
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
    await coordinator.prepareRecommendationPreview('100', ['custom-author-up-alpha'])
    await coordinator.setRecommendedCandidates('100', [])
    await coordinator.prepareRecommendationPreview('100', [])

    expect(saved).not.toHaveBeenCalled()
    expect(published).not.toHaveBeenCalled()

    await coordinator.saveCurrentSegmentToLocalLibrary('100')

    expect(saved).toHaveBeenCalledWith(
      '100',
      [expect.objectContaining({ id: 'custom-author-up-alpha' })],
      []
    )
    expect(published).not.toHaveBeenCalled()
  })

  it('persists adopted recommendations once after a Bilibili plan freezes successfully', async () => {
    const root = await createRoot()
    const saved = vi.fn().mockResolvedValue(true)
    const published = vi.fn()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const bindings = new FavoriteRepositoryBindingService({
      repository,
      newBindingToken: () => 'a1b2c3',
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined),
        release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory: vi.fn().mockResolvedValue({ observedAccountMid: '100', folders: [] }),
          createFolder: vi.fn(async ({ title }: { title: string }) => ({
            observedAccountMid: '100', folder: { id: 'remote-alpha-1', title, memberCount: 0 }
          })),
          append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      bindingService: bindings,
      saveRecommendedLedgers: saved,
      notifyRecommendedLedgersChanged: published,
      classifyCurrentItem: (item, recommendedLedgers = []) => item.author === 'UP Alpha' && recommendedLedgers.length
        ? { targetLedgerIds: [recommendedLedgers[0]!.id], confidence: 'high' }
        : { targetLedgerIds: [], confidence: 'low' },
      now: () => '2026-07-20T00:00:00.000Z'
    })
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
    await coordinator.prepareRecommendationPreview('100', ['custom-author-up-alpha'])

    expect(saved).not.toHaveBeenCalled()
    await expect(coordinator.freezeForBilibiliExecution('100')).resolves.toMatchObject({ status: 'frozen' })
    expect(saved).toHaveBeenCalledTimes(1)
    expect(saved).toHaveBeenCalledWith(
      '100',
      [expect.objectContaining({ id: 'custom-author-up-alpha', ruleType: 'author' })],
      ['custom-author-up-alpha']
    )
    expect(published).toHaveBeenCalledTimes(1)
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
    await coordinator.beginScan('100', 'incremental')
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

  it('keeps the active draft unchanged until a saved local rule is fully analyzed and classified', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const classification = deferred<Array<{ targetLedgerIds: string[]; confidence: 'high' | 'low' }>>()
    const classifyCurrentItems = vi.fn(() => classification.promise)
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore,
      classifyCurrentItems,
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'Alpha series', author: 'UP Alpha', sourceFolderIds: ['source'] },
        { aid: 2, title: 'Manual choice', author: 'UP Beta', sourceFolderIds: ['source'] }
      ]
    })
    const workspace = await coordinator.finishScan('100')
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 2, targetLedgerIds: ['manual'] }]
    })

    const saving = coordinator.saveDraftLedgerRule('100', {
      analysisId: 'analysis-local-alpha',
      title: 'Alpha',
      keywords: ['Alpha'],
      ruleType: 'keyword'
    })
    await vi.waitFor(() => expect(classifyCurrentItems).toHaveBeenCalledOnce())

    await expect(workspaceStore.recover('100', workspace.id)).resolves.toMatchObject({
      recommendations: { candidates: [], adoptedCandidateIds: [] },
      classifications: { '2': { targetLedgerIds: ['manual'], source: 'manual' } }
    })
    expect((await repository.getSnapshot('100')).folders.find((folder) => folder.id === 'local:local-alpha')).toBeUndefined()

    classification.resolve([{ targetLedgerIds: ['local-alpha'], confidence: 'high' }])
    await saving

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      recommendations: {
        candidates: [expect.objectContaining({
          id: 'local-alpha', count: 1
        })],
        adoptedCandidateIds: ['local-alpha']
      },
      classifications: {
        '1': { targetLedgerIds: ['local-alpha'], source: 'system-high' },
        '2': { targetLedgerIds: ['manual'], source: 'manual' }
      }
    })
    expect((await repository.getSnapshot('100')).folders.find((folder) => folder.id === 'local:local-alpha')).toBeUndefined()
  })

  it('cancels draft rule analysis out of band without committing partial rules or classifications', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const classifyCurrentItems = vi.fn()
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore,
      classifyCurrentItems,
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'incremental')
    const workspace = await coordinator.completeScan('100', {
      revision: 1,
      aids: Array.from({ length: 129 }, (_, index) => index + 1)
    })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['manual'] }]
    })
    const onProgress = vi.fn((progress: { analysisId: string }) => {
      coordinator.cancelDraftLedgerRuleAnalysis('100', progress.analysisId)
    })

    await expect(coordinator.saveDraftLedgerRule('100', {
      analysisId: 'analysis-cancel-local',
      title: 'Canceled',
      keywords: ['Canceled'],
      ruleType: 'keyword'
    }, onProgress)).rejects.toThrow('Old favorite ledger rule analysis canceled.')

    expect(onProgress).toHaveBeenCalledTimes(1)
    expect(classifyCurrentItems).not.toHaveBeenCalled()
    await expect(workspaceStore.recover('100', workspace.id)).resolves.toMatchObject({
      recommendations: { candidates: [], adoptedCandidateIds: [] },
      classifications: { '1': { targetLedgerIds: ['manual'], source: 'manual' } }
    })
    expect((await repository.getSnapshot('100')).folders.find((folder) => folder.id === 'local:local-canceled')).toBeUndefined()
  })

  it('registers a draft rule analysis before its queued work starts so immediate cancellation is not lost', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const classifyCurrentItems = vi.fn((items: Array<{ aid: number }>) => items.map(() => ({
      targetLedgerIds: ['local-immediate'], confidence: 'high' as const
    })))
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore,
      classifyCurrentItems,
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'incremental')
    const workspace = await coordinator.completeScan('100', { revision: 1, aids: [1] })

    const saving = coordinator.saveDraftLedgerRule('100', {
      analysisId: 'analysis-immediate-cancel',
      title: 'Immediate',
      keywords: ['Video 1'],
      ruleType: 'keyword'
    })
    expect(coordinator.cancelDraftLedgerRuleAnalysis('100', 'analysis-immediate-cancel')).toBe(true)

    await expect(saving).rejects.toThrow('Old favorite ledger rule analysis canceled.')
    expect(classifyCurrentItems).not.toHaveBeenCalled()
    await expect(workspaceStore.recover('100', workspace.id)).resolves.toMatchObject({
      recommendations: { candidates: [], adoptedCandidateIds: [] },
      classifications: {}
    })
  })

  it('stops accepting cancellation once the atomic draft publication has started', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore,
      classifyCurrentItems: vi.fn((items: Array<{ aid: number }>) => items.map(() => ({
        targetLedgerIds: ['local-publication'], confidence: 'high' as const
      }))),
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [{ aid: 1, title: 'Publication Match', sourceFolderIds: ['source'] }]
    })
    await coordinator.finishScan('100')
    const publicationStarted = deferred<void>()
    const releasePublication = deferred<void>()
    const appendOverlay = workspaceStore.appendOverlay.bind(workspaceStore)
    vi.spyOn(workspaceStore, 'appendOverlay').mockImplementation(async (accountMid, workspaceId, overlay) => {
      if (overlay.ruleAnalysisCheckpoint === null && overlay.recommendations?.candidates?.some((item) => item.id === 'local-publication')) {
        publicationStarted.resolve(undefined)
        await releasePublication.promise
      }
      return appendOverlay(accountMid, workspaceId, overlay)
    })

    const saving = coordinator.saveDraftLedgerRule('100', {
      analysisId: 'analysis-publication-boundary',
      title: 'Publication',
      keywords: ['Publication Match'],
      ruleType: 'keyword'
    })
    await publicationStarted.promise
    const canceled = coordinator.cancelDraftLedgerRuleAnalysis('100', 'analysis-publication-boundary')
    releasePublication.resolve(undefined)
    await saving

    expect(canceled).toBe(false)
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      recommendations: { adoptedCandidateIds: ['local-publication'] }
    })
  })

  it('reports and checkpoints progress against selected source items only', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore,
      classifyCurrentItems: vi.fn((items: Array<{ aid: number }>) => items.map(() => ({
        targetLedgerIds: ['local-selected'], confidence: 'high' as const
      }))),
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [
        { id: 'selected', title: 'Selected', itemCount: 1, isBilimiWorkFolder: false },
        { id: 'deselected', title: 'Deselected', itemCount: 1, isBilimiWorkFolder: false }
      ]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'selected', page: 1,
      items: [{ aid: 1, title: 'Selected Match', sourceFolderIds: ['selected'] }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'deselected', page: 1,
      items: [{ aid: 2, title: 'Selected Match', sourceFolderIds: ['deselected'] }]
    })
    const workspace = await coordinator.finishScan('100')
    await coordinator.selectSourceFolders('100', ['selected'])
    const onProgress = vi.fn((progress: { analysisId: string; completedItemCount: number; totalItemCount: number }) => {
      if (progress.completedItemCount === 1) coordinator.cancelDraftLedgerRuleAnalysis('100', progress.analysisId)
    })

    await expect(coordinator.saveDraftLedgerRule('100', {
      analysisId: 'analysis-selected-progress',
      title: 'Selected',
      keywords: ['Selected Match'],
      ruleType: 'keyword'
    }, onProgress)).rejects.toThrow('Old favorite ledger rule analysis canceled.')

    expect(onProgress.mock.calls.map(([progress]) => [progress.completedItemCount, progress.totalItemCount])).toEqual([[1, 1]])
    await expect(workspaceStore.recover('100', workspace.id)).resolves.toMatchObject({
      ruleAnalysisCheckpoint: {
        completedSegmentIds: ['segment-1'],
        completedItemCount: 1,
        totalItemCount: 1
      },
      recommendations: { candidates: [], adoptedCandidateIds: [] }
    })
  })

  it('keeps the prior draft active and retires the analysis id when rule classification fails', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore,
      classifyCurrentItems: vi.fn().mockRejectedValue(new Error('classifier unavailable')),
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'Alpha series', author: 'UP Alpha', sourceFolderIds: ['source'] },
        { aid: 2, title: 'Manual choice', author: 'UP Beta', sourceFolderIds: ['source'] }
      ]
    })
    const workspace = await coordinator.finishScan('100')
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 2, targetLedgerIds: ['manual'] }]
    })

    await expect(coordinator.saveDraftLedgerRule('100', {
      analysisId: 'analysis-failed-local',
      title: 'Alpha',
      keywords: ['Alpha'],
      ruleType: 'keyword'
    })).rejects.toThrow('classifier unavailable')

    expect(coordinator.cancelDraftLedgerRuleAnalysis('100', 'analysis-failed-local')).toBe(false)
    await expect(workspaceStore.recover('100', workspace.id)).resolves.toMatchObject({
      recommendations: { candidates: [], adoptedCandidateIds: [] },
      classifications: { '2': { targetLedgerIds: ['manual'], source: 'manual' } }
    })
    expect((await repository.getSnapshot('100')).folders.find((folder) => folder.id === 'local:local-alpha')).toBeUndefined()
  })

  it('updates a saved rule by stable ledger id and creates its renamed folder only during final local save', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore,
      classifyCurrentItems: vi.fn((items: Array<{ aid: number; title?: string }>) => items.map((item) => item.title?.includes('Beta')
        ? { targetLedgerIds: ['local-topic'], confidence: 'high' as const }
        : { targetLedgerIds: [], confidence: 'low' as const })),
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'Alpha entry', sourceFolderIds: ['source'] },
        { aid: 2, title: 'Beta entry', sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')
    await coordinator.saveDraftLedgerRule('100', {
      analysisId: 'analysis-create-topic',
      title: 'Topic',
      keywords: ['Alpha'],
      ruleType: 'keyword'
    })

    await coordinator.saveDraftLedgerRule('100', {
      analysisId: 'analysis-rename-topic',
      ledgerId: 'local-topic',
      title: 'Renamed Topic',
      keywords: ['Beta'],
      ruleType: 'keyword'
    })

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      recommendations: {
        candidates: [expect.objectContaining({ id: 'local-topic', displayName: 'bilimi·Renamed Topic', count: 1 })],
        adoptedCandidateIds: ['local-topic']
      },
      classifications: {
        '2': { targetLedgerIds: ['local-topic'], source: 'system-high' }
      }
    })
    expect((await repository.getSnapshot('100')).folders.find((folder) => folder.id === 'local:local-topic')).toBeUndefined()

    await coordinator.saveCurrentSegmentToLocalLibrary('100')
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      folders: expect.arrayContaining([
        expect.objectContaining({ id: 'local:local-topic', title: 'Renamed Topic', kind: 'local', syncState: 'local-only' })
      ])
    })
  })

  it('admits an existing custom ledger into the round on its first rule save but rejects default ledger ids', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore,
      classifyCurrentItems: vi.fn((items: Array<{ aid: number }>) => items.map(() => ({
        targetLedgerIds: ['custom-jazz'], confidence: 'high' as const
      }))),
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [{ aid: 1, title: 'Jazz live', sourceFolderIds: ['source'] }]
    })
    await coordinator.finishScan('100')

    await coordinator.saveDraftLedgerRule('100', {
      analysisId: 'analysis-existing-custom-jazz',
      ledgerId: 'custom-jazz',
      title: '爵士现场',
      keywords: ['Jazz'],
      ruleType: 'keyword'
    })

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      recommendations: {
        candidates: [expect.objectContaining({ id: 'custom-jazz', displayName: 'bilimi·爵士现场', count: 1 })],
        adoptedCandidateIds: ['custom-jazz']
      },
      classifications: {
        '1': { targetLedgerIds: ['custom-jazz'], source: 'system-high' }
      }
    })
    await expect(coordinator.saveDraftLedgerRule('100', {
      analysisId: 'analysis-default-knowledge',
      ledgerId: 'knowledge',
      title: '知识学习',
      keywords: ['知识'],
      ruleType: 'keyword'
    })).rejects.toThrow('Old favorite workspace draft ledger rule is unavailable.')
  })

  it('does not leave a repository folder when atomic draft publication fails', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore,
      classifyCurrentItems: vi.fn((items: Array<{ aid: number }>) => items.map(() => ({
        targetLedgerIds: ['local-failed-publication'], confidence: 'high' as const
      }))),
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [{ aid: 1, title: 'Failed Publication Match', sourceFolderIds: ['source'] }]
    })
    const workspace = await coordinator.finishScan('100')
    const appendOverlay = workspaceStore.appendOverlay.bind(workspaceStore)
    vi.spyOn(workspaceStore, 'appendOverlay').mockImplementation(async (accountMid, workspaceId, overlay) => {
      if (overlay.ruleAnalysisCheckpoint === null && overlay.recommendations?.candidates?.some((item) => item.id === 'local-failed-publication')) {
        throw new Error('final overlay failed')
      }
      return appendOverlay(accountMid, workspaceId, overlay)
    })

    await expect(coordinator.saveDraftLedgerRule('100', {
      analysisId: 'analysis-failed-publication',
      title: 'Failed Publication',
      keywords: ['Failed Publication Match'],
      ruleType: 'keyword'
    })).rejects.toThrow('final overlay failed')

    expect((await repository.getSnapshot('100')).folders.find((folder) => folder.id === 'local:local-failed-publication')).toBeUndefined()
    await expect(workspaceStore.recover('100', workspace.id)).resolves.toMatchObject({
      recommendations: { candidates: [], adoptedCandidateIds: [] },
      classifications: {}
    })
  })

  it('resumes the same saved rule from a persisted completed-segment checkpoint', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore,
      classifyCurrentItems: vi.fn((items) => items.map(() => ({ targetLedgerIds: [], confidence: 'low' as const }))),
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'incremental')
    const workspace = await coordinator.completeScan('100', {
      revision: 1,
      aids: Array.from({ length: 2_001 }, (_, index) => index + 1)
    })
    const firstProgress = vi.fn((progress: { analysisId: string; completedItemCount: number }) => {
      if (progress.completedItemCount === 2_000) {
        coordinator.cancelDraftLedgerRuleAnalysis('100', progress.analysisId)
      }
    })

    await expect(coordinator.saveDraftLedgerRule('100', {
      analysisId: 'analysis-checkpoint-first',
      title: 'Checkpoint',
      keywords: ['Checkpoint'],
      ruleType: 'keyword'
    }, firstProgress)).rejects.toThrow('Old favorite ledger rule analysis canceled.')

    await expect(workspaceStore.recover('100', workspace.id)).resolves.toMatchObject({
      ruleAnalysisCheckpoint: {
        ledgerId: 'local-checkpoint',
        completedSegmentIds: ['segment-1'],
        completedItemCount: 2_000,
        totalItemCount: 2_001,
        matchedAidsBySegment: {}
      },
      recommendations: { candidates: [], adoptedCandidateIds: [] }
    })

    const resumedCoordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      classifyCurrentItems: vi.fn((items) => items.map(() => ({ targetLedgerIds: [], confidence: 'low' as const }))),
      now: () => '2026-07-20T00:00:00.000Z'
    })
    const resumedProgress = vi.fn()
    await resumedCoordinator.saveDraftLedgerRule('100', {
      analysisId: 'analysis-checkpoint-resume',
      title: 'Checkpoint',
      keywords: ['Checkpoint'],
      ruleType: 'keyword'
    }, resumedProgress)

    expect(resumedProgress.mock.calls.map(([progress]) => [
      progress.completedItemCount,
      progress.totalItemCount
    ])).toEqual([[2_001, 2_001]])
    await expect(new OldFavoriteWorkspaceStore({ root }).recover('100', workspace.id)).resolves.toMatchObject({
      ruleAnalysisCheckpoint: undefined,
      recommendations: {
        candidates: [expect.objectContaining({ id: 'local-checkpoint', matchedAidsBySegment: {} })],
        adoptedCandidateIds: ['local-checkpoint']
      }
    })
  })

  it('commits a saved rule classification outside the loaded segment after restart', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const first = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore,
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await first.beginScan('100', 'incremental')
    await first.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2_001, isBilimiWorkFolder: false }]
    })
    for (let offset = 0; offset < 2_001; offset += 50) {
      await first.recordScanPage('100', {
        folderId: 'source', page: (offset / 50) + 1,
        items: Array.from({ length: Math.min(50, 2_001 - offset) }, (_, index) => {
          const aid = offset + index + 1
          return { aid, title: aid === 2_001 ? 'Later Match' : `Video ${aid}`, sourceFolderIds: ['source'] }
        })
      })
    }
    const workspace = await first.finishScan('100')
    await first.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['manual'] }]
    })

    const classifyCurrentItems = vi.fn((items: Array<{ aid: number }>) => items.map(() => ({
      targetLedgerIds: ['local-later'], confidence: 'high' as const
    })))
    const resumed = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      classifyCurrentItems,
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await resumed.saveDraftLedgerRule('100', {
      analysisId: 'analysis-later-segment',
      title: 'Later',
      keywords: ['Later Match'],
      ruleType: 'keyword'
    })

    expect(classifyCurrentItems).toHaveBeenCalledOnce()
    expect(classifyCurrentItems.mock.calls[0]?.[0].map((item) => item.aid)).toEqual([2_001])
    await expect(new OldFavoriteWorkspaceStore({ root }).recover('100', workspace.id)).resolves.toMatchObject({
      classifications: {
        '1': { targetLedgerIds: ['manual'], source: 'manual' },
        '2001': { targetLedgerIds: ['local-later'], source: 'system-high' }
      },
      planReadiness: { selectedAidCount: 2_001, classifiedAidCount: 2 }
    })
    await expect(resumed.getSnapshot('100')).resolves.toMatchObject({
      currentSegment: { id: 'segment-1' },
      classifications: { '1': { targetLedgerIds: ['manual'], source: 'manual' } }
    })
    await resumed.selectSegment('100', 'segment-2')
    await expect(resumed.getSnapshot('100')).resolves.toMatchObject({
      currentSegment: { id: 'segment-2' },
      classifications: { '2001': { targetLedgerIds: ['local-later'], source: 'system-high' } }
    })
  })

  it('retains only sparse matched AIDs across segments for rule reclassification', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const classifyCurrentItems = vi.fn((items: Array<{ aid: number }>) => items.map(() => ({
      targetLedgerIds: ['local-sparse'], confidence: 'high' as const
    })))
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore,
      classifyCurrentItems,
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2_001, isBilimiWorkFolder: false }]
    })
    for (let offset = 0; offset < 2_001; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source', page: (offset / 50) + 1,
        items: Array.from({ length: Math.min(50, 2_001 - offset) }, (_, index) => {
          const aid = offset + index + 1
          return {
            aid,
            title: aid === 1 || aid === 2_001 ? 'Sparse Match' : `Video ${aid}`,
            sourceFolderIds: ['source']
          }
        })
      })
    }
    const workspace = await coordinator.finishScan('100')

    await coordinator.saveDraftLedgerRule('100', {
      analysisId: 'analysis-sparse-segments',
      title: 'Sparse',
      keywords: ['Sparse Match'],
      ruleType: 'keyword'
    })

    expect(classifyCurrentItems).toHaveBeenCalledOnce()
    expect(classifyCurrentItems.mock.calls[0]?.[0].map((item) => item.aid)).toEqual([1, 2_001])
    await expect(workspaceStore.recover('100', workspace.id)).resolves.toMatchObject({
      recommendations: {
        candidates: [expect.objectContaining({
          id: 'local-sparse',
          matchedAidsBySegment: { 'segment-1': [1], 'segment-2': [2_001] }
        })]
      }
    })
  })

  it('preserves manual and DeepSeek classifications from a later segment when saving a rule after restart', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const first = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await first.beginScan('100', 'incremental')
    await first.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2_002, isBilimiWorkFolder: false }]
    })
    for (let offset = 0; offset < 2_002; offset += 50) {
      await first.recordScanPage('100', {
        folderId: 'source', page: (offset / 50) + 1,
        items: Array.from({ length: Math.min(50, 2_002 - offset) }, (_, index) => {
          const aid = offset + index + 1
          return {
            aid,
            title: aid >= 2_001 ? 'Protected Match' : `Video ${aid}`,
            sourceFolderIds: ['source']
          }
        })
      })
    }
    const workspace = await first.finishScan('100')
    await first.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['first-segment-manual'] }]
    })
    await first.selectSegment('100', 'segment-2')
    await first.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 2_001, targetLedgerIds: ['later-manual'] }]
    })
    const laterSnapshot = requireSnapshot(await first.getSnapshot('100'))
    await first.applyDeepSeekClassificationBatch('100', [{ aid: 2_002, targetLedgerIds: ['later-deepseek'] }], {
      workspaceId: laterSnapshot.workspaceId,
      currentSegmentId: laterSnapshot.currentSegment!.id,
      selectedSourceFolderIds: ['source'],
      classifications: { '2001': { targetLedgerIds: ['later-manual'], source: 'manual' } }
    })
    await first.selectSegment('100', 'segment-1')

    const classifyCurrentItems = vi.fn((items: Array<{ aid: number }>) => items.map(() => ({
      targetLedgerIds: ['local-protected'], confidence: 'high' as const
    })))
    const resumed = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      classifyCurrentItems,
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await resumed.saveDraftLedgerRule('100', {
      analysisId: 'analysis-protected-segment',
      title: 'Protected',
      keywords: ['Protected Match'],
      ruleType: 'keyword'
    })

    expect(classifyCurrentItems).not.toHaveBeenCalled()
    await expect(new OldFavoriteWorkspaceStore({ root }).recover('100', workspace.id)).resolves.toMatchObject({
      classifications: {
        '1': { targetLedgerIds: ['first-segment-manual'], source: 'manual' },
        '2001': { targetLedgerIds: ['later-manual'], source: 'manual' },
        '2002': { targetLedgerIds: ['later-deepseek'], source: 'deepseek' }
      },
      planReadiness: { selectedAidCount: 2_002, classifiedAidCount: 3 }
    })
  })

  it('replays the active undo branch before classifying a saved rule', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const first = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore,
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await first.beginScan('100', 'incremental')
    await first.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'First', sourceFolderIds: ['source'] },
        { aid: 2, title: 'Branch Match', sourceFolderIds: ['source'] },
        { aid: 3, title: 'Branch Match', sourceFolderIds: ['source'] }
      ]
    })
    const workspace = await first.finishScan('100')
    await first.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['first'] }]
    })
    await first.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 2, targetLedgerIds: ['discarded-branch'] }]
    })
    await first.undoClassificationChange('100')
    await first.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 3, targetLedgerIds: ['active-branch'] }]
    })

    const classifyCurrentItems = vi.fn((items: Array<{ aid: number }>) => items.map(() => ({
      targetLedgerIds: ['local-branch'], confidence: 'high' as const
    })))
    const resumed = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      classifyCurrentItems,
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await resumed.saveDraftLedgerRule('100', {
      analysisId: 'analysis-active-branch',
      title: 'Branch',
      keywords: ['Branch Match'],
      ruleType: 'keyword'
    })

    expect(classifyCurrentItems).toHaveBeenCalledOnce()
    expect(classifyCurrentItems.mock.calls[0]?.[0].map((item) => item.aid)).toEqual([2])
    await expect(new OldFavoriteWorkspaceStore({ root }).recover('100', workspace.id)).resolves.toMatchObject({
      classifications: {
        '1': { targetLedgerIds: ['first'], source: 'manual' },
        '2': { targetLedgerIds: ['local-branch'], source: 'system-high' },
        '3': { targetLedgerIds: ['active-branch'], source: 'manual' }
      },
      planReadiness: { selectedAidCount: 3, classifiedAidCount: 3 }
    })
  })

  it('reports the standard unavailable error when a matching saved rule has no classifier', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore,
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [{ aid: 1, title: 'Alpha Match', sourceFolderIds: ['source'] }]
    })
    const workspace = await coordinator.finishScan('100')

    await expect(coordinator.saveDraftLedgerRule('100', {
      analysisId: 'analysis-no-classifier',
      title: 'Alpha',
      keywords: ['Alpha Match'],
      ruleType: 'keyword'
    })).rejects.toThrow('Old favorite workspace automatic classification is unavailable.')

    await expect(workspaceStore.recover('100', workspace.id)).resolves.toMatchObject({
      recommendations: { candidates: [], adoptedCandidateIds: [] },
      classifications: {}
    })
    expect((await repository.getSnapshot('100')).folders.find((folder) => folder.id === 'local:local-alpha')).toBeUndefined()
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
    await expect(first.open('200')).resolves.toBeNull()

    const restored = new OldFavoriteWorkspaceCoordinator({
      repository: new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' }),
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await expect(restored.getSnapshot('100')).resolves.toMatchObject({
      recommendations: { adoptedCandidateIds: ['custom-author-up-alpha'] }
    })
    await expect(restored.getSnapshot('200')).resolves.toBeNull()
  })

  it('prepares an adopted recommendation for Bilibili binding during confirmation', async () => {
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
    await coordinator.prepareRecommendationPreview('100', ['custom-author-up-alpha'])

    await expect(coordinator.freezeForBilibiliExecution('100')).rejects.toThrow('remote-target-unbound')
    expect(ensurePhysicalShard).toHaveBeenCalledWith('100', expect.objectContaining({
      logicalLedgerId: 'custom-author-up-alpha', logicalTitle: 'bilimi·UP Alpha'
    }))
  })

  it('keeps one remote organization round coherent from scan through protected incremental follow-up', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const append = vi.fn().mockResolvedValue({ observedAccountMid: '100' })
    const syncService = new FavoriteRepositorySyncService({
      repository,
      pageBridge: createPageBridge({ append }),
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
    await coordinator.prepareRecommendationPreview('100', ['custom-author-up-alpha'])
    const deepSeekInput = requireSnapshot(await coordinator.getSnapshot('100'))
    if (!deepSeekInput.currentSegment) throw new Error('workspace unexpectedly unavailable')
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
    await coordinator.prepareRecommendationPreview('100', ['custom-author-up-alpha'])
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
        pageBridge: createPageBridge({ append }),
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
        pageBridge: createPageBridge({ append }),
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

  it('rebinds an existing Bilibili ledger after full reset before compiling confirmation', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const createFolder = vi.fn()
    const bindings = new FavoriteRepositoryBindingService({
      repository,
      newBindingToken: () => 'a1b2c3',
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined),
        release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory: vi.fn().mockResolvedValue({
            observedAccountMid: '100',
            folders: [{ id: 'remote-music', title: 'bilimi·音乐舞台', memberCount: 12 }]
          }),
          createFolder,
          append: vi.fn(),
          remove: vi.fn(),
          readMembers: vi.fn(),
          deleteFolder: vi.fn()
        }))
      }
    })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      bindingService: bindings,
      now: () => '2026-07-20T00:00:00.000Z'
    })

    await coordinator.open('100')
    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [{ aid: 1, title: 'Music video', sourceFolderIds: ['source'] }]
    })
    await coordinator.finishScan('100')
    await coordinator.selectSourceFolders('100', ['source'])
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })

    await expect(coordinator.freezeForBilibiliExecution('100')).resolves.toMatchObject({
      frozenSyncPlan: { operations: [{ aid: 1, folderIds: ['remote-music'] }] }
    })
    expect(createFolder).not.toHaveBeenCalled()
    expect((await repository.getSnapshot('100')).physicalShards).toEqual([
      expect.objectContaining({ logicalLedgerId: 'music', remoteFolderId: 'remote-music', bindingState: 'bound' })
    ])
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
    await coordinator.beginScan('100', 'incremental')
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
    await coordinator.beginScan('100', 'incremental')
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

  it('persists scanned tags when saving a video to the local library', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [{ aid: 1, title: 'Tagged video', tags: ['TypeScript', 'Electron'], sourceFolderIds: ['source'] }]
    })
    await coordinator.finishScan('100')
    await repository.commit('100', {
      id: 'strip-scanned-tags', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'record-bilibili-mirror',
      payload: {
        workspaceId: 'workspace-100', memberAidsByFolderId: { 'bilibili:source': [1] },
        folders: [{ id: 'bilibili:source', title: 'source', remoteFolderId: 'source' }],
        videos: [{ aid: 1, title: 'Tagged video', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }]
      }
    })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })
    const commit = vi.spyOn(repository, 'commit')

    await coordinator.saveCurrentSegmentToLocalLibrary('100')

    expect(commit.mock.calls[0]?.[1]).toMatchObject({
      type: 'commit-local-plan', payload: {
        videos: [expect.objectContaining({ aid: 1, tags: ['TypeScript', 'Electron'] })]
      }
    })
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      videos: { 1: expect.objectContaining({ tags: ['TypeScript', 'Electron'] }) }
    })
  })

  it('saves and freezes only the current batch while keeping a multi-batch round open for later sync', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const coordinator = createCoordinator(repository, store, {
      segmentSize: () => 500
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', {
      revision: 1,
      aids: Array.from({ length: 501 }, (_unused, index) => index + 1)
    })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })
    await coordinator.selectSegment('100', 'segment-2')
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 501, targetLedgerIds: ['knowledge'] }]
    })
    await coordinator.selectSegment('100', 'segment-1')

    await expect(coordinator.saveCurrentSegmentToLocalLibrary('100')).resolves.toMatchObject({ status: 'previewing' })
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      status: 'previewing',
      segments: [
        { id: 'segment-1', readiness: 'saved', status: 'frozen' },
        { id: 'segment-2', readiness: 'ready', status: 'previewing' }
      ]
    })
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      memberships: { 'local:music': [1] },
      workspace: { status: 'previewing' }
    })
    expect((await repository.getSnapshot('100')).memberships).not.toHaveProperty('local:knowledge')

    const restored = createCoordinator(repository, store, { segmentSize: () => 500, initializeOnOpen: false })
    await expect(restored.getSnapshot('100')).resolves.toMatchObject({
      status: 'previewing', currentSegment: { id: 'segment-1' },
      segments: [
        { id: 'segment-1', readiness: 'saved', status: 'frozen' },
        { id: 'segment-2', readiness: 'ready', status: 'previewing' }
      ]
    })
    await expect(restored.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['knowledge'] }]
    })).rejects.toThrow('saved segment is read-only')
    await restored.selectSegment('100', 'segment-2')
    await expect(restored.saveCurrentSegmentToLocalLibrary('100')).resolves.toMatchObject({ status: 'previewing' })
    await expect(restored.getSnapshot('100')).resolves.toMatchObject({
      status: 'previewing',
      segments: [
        { id: 'segment-1', readiness: 'saved', status: 'frozen' },
        { id: 'segment-2', readiness: 'saved', status: 'frozen' }
      ]
    })
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      memberships: { 'local:music': [1], 'local:knowledge': [501] },
      workspace: { status: 'previewing' }
    })
  })

  it('persists recommendation matched AID indexes without exposing them in renderer snapshots', async () => {
    const root = await createRoot()
    const store = new OldFavoriteWorkspaceStore({ root })
    const coordinator = createCoordinator(new FavoriteRepositoryService({ root }), store)
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, author: 'UP Alpha', tags: ['TypeScript'], sourceFolderIds: ['source'] },
        { aid: 2, author: 'UP Alpha', tags: ['TypeScript'], sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')

    const snapshot = requireSnapshot(await coordinator.getSnapshot('100'))
    expect(snapshot.recommendations.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'author', count: 2, currentSegmentCount: 2 }),
      expect.objectContaining({ kind: 'tag', count: 2, currentSegmentCount: 2 })
    ]))
    expect(snapshot.recommendations.candidates[0]).not.toHaveProperty('matchedAidsBySegment')

    const recovered = await store.recover('100', snapshot.workspaceId)
    if ('recovery' in recovered) throw new Error('workspace unexpectedly unavailable')
    expect(recovered.recommendations.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ matchedAidsBySegment: { 'segment-1': [1, 2] } })
    ]))
  })

  it('rebuilds missing recommendation indexes from persisted segments once', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root })
    const store = new OldFavoriteWorkspaceStore({ root })
    const coordinator = createCoordinator(repository, store)
    await coordinator.open('100')
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, author: 'UP Alpha', sourceFolderIds: ['source'] },
        { aid: 2, author: 'UP Alpha', sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')
    const first = requireSnapshot(await coordinator.getSnapshot('100'))
    await store.appendOverlay('100', first.workspaceId, {
      currentSegmentId: 'segment-1', classifications: [], history: [], recommendations: {
        initialized: true,
        candidates: [{
          id: 'custom-author-up-alpha', displayName: 'bilimi·UP Alpha', kind: 'author', sourceName: 'UP Alpha',
          keywords: ['UP Alpha'], count: 2, reason: 'UP Alpha appeared 2 times.'
        }],
        adoptedCandidateIds: []
      }
    })

    const restarted = createCoordinator(repository, store, { initializeOnOpen: false })
    await restarted.getSnapshot('100')
    const recovered = await store.recover('100', first.workspaceId)
    if ('recovery' in recovered) throw new Error('workspace unexpectedly unavailable')
    expect(recovered.recommendations.candidates).toEqual([
      expect.objectContaining({ matchedAidsBySegment: { 'segment-1': [1, 2] } })
    ])
  })

  it('saves local library folders under resolved display names instead of internal ledger ids', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      resolveLedgerTitle: vi.fn().mockResolvedValue('bilimi·我的片单')
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['custom-my-list'] }]
    })

    await coordinator.saveCurrentSegmentToLocalLibrary('100')

    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      folders: [expect.objectContaining({
        id: 'local:custom-my-list', title: 'bilimi·我的片单', kind: 'local'
      })]
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
    await coordinator.beginScan('100', 'incremental')
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
    await coordinator.beginScan('100', 'incremental')
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
    await coordinator.beginScan('100', 'incremental')
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
      currentSegment: { aids: [2] },
      tagEnrichment: { totalItemCount: 1, pendingItemCount: 1 }
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

  it('commits each prepared segment to the local library without closing the multi-batch round', async () => {
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

    await expect(coordinator.saveCurrentSegmentToLocalLibrary('100')).resolves.toMatchObject({ status: 'previewing' })
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      status: 'previewing', segments: [
        expect.objectContaining({ id: 'segment-1', status: 'previewing' }),
        expect.objectContaining({ id: 'segment-2', status: 'frozen' })
      ]
    })
    await coordinator.selectSegment('100', 'segment-1')
    await expect(coordinator.saveCurrentSegmentToLocalLibrary('100')).resolves.toMatchObject({ status: 'previewing' })
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      status: 'previewing', segments: [
        expect.objectContaining({ id: 'segment-1', status: 'frozen' }),
        expect.objectContaining({ id: 'segment-2', status: 'frozen' })
      ]
    })
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      memberships: { 'local:music': expect.arrayContaining([1, 2_001]) }, workspace: { status: 'previewing' }
    })
  })

  it('freezes one remote plan that deduplicates classifications from every prepared segment', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    const aids = Array.from({ length: 2_001 }, (_, index) => index + 1)
    await coordinator.beginScan('100', 'incremental')
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

  it('stages recovered batches independently and keeps unclassified videos local', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const first = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await first.open('100')
    await first.completeScan('100', { revision: 1, aids: Array.from({ length: 2_001 }, (_, index) => index + 1) })
    await first.applyClassificationBatch('100', {
      source: 'manual', assignments: Array.from({ length: 2_000 }, (_, index) => ({ aid: index + 1, targetLedgerIds: ['music'] }))
    })
    const restored = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))

    await expect(restored.saveCurrentSegmentToLocalLibrary('100')).resolves.toMatchObject({ status: 'previewing' })
    await restored.selectSegment('100', 'segment-2')
    await expect(restored.saveCurrentSegmentToLocalLibrary('100')).resolves.toMatchObject({ status: 'previewing' })
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      memberships: { 'local:inbox': [2_001] }
    })
  })

  it('refuses to freeze a Bilibili sync plan for an unbound logical target', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })

    await expect(coordinator.freezeForBilibiliExecution('100')).rejects.toThrow('remote-target-unbound')
    expect((await repository.getSnapshot('100')).workspace?.frozenSyncPlan).toBeUndefined()
  })

  it('binds the selected preview targets before freezing the Bilibili plan', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const bindings = new FavoriteRepositoryBindingService({
      repository,
      newBindingToken: () => 'a1b2c3',
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined),
        release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory: vi.fn().mockResolvedValue({ observedAccountMid: '100', folders: [] }),
          createFolder: vi.fn(async ({ title }: { title: string }) => ({
            observedAccountMid: '100', folder: { id: 'remote-music-1', title, memberCount: 0 }
          })),
          append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })
    const ensurePhysicalShard = vi.spyOn(bindings, 'ensurePhysicalShard')
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      bindingService: bindings, now: () => '2026-07-20T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })

    await expect(coordinator.freezeForBilibiliExecution('100')).resolves.toMatchObject({
      status: 'frozen', frozenSyncPlan: { operations: [{ aid: 1, folderIds: ['remote-music-1'] }] }
    })
    expect(ensurePhysicalShard).toHaveBeenCalledWith('100', expect.objectContaining({
      logicalLedgerId: 'music', logicalTitle: 'bilimi·音乐舞台', remoteDisplayTitle: 'bilimi·音乐舞台', shardNumber: 1
    }))
  })

  it('reuses an existing bilimi logical ledger when saving an old-favorite plan locally', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    await repository.commit('100', {
      id: 'bind-game', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'upsert-physical-shard-binding',
      payload: {
        logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区', shardNumber: 1,
        remoteTitle: 'bilimi·游戏专区', bindingState: 'bound', remoteFolderId: '4099454411', memberAids: []
      }
    })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['game'] }]
    })

    await coordinator.saveCurrentSegmentToLocalLibrary('100')

    const snapshot = await repository.getSnapshot('100')
    expect(snapshot.memberships['bilimi-logical:game']).toEqual([1])
    expect(snapshot.organizationRecords).toContainEqual(expect.objectContaining({
      aid: 1, targetFolderIds: ['bilimi-logical:game']
    }))
    expect(snapshot.folders).not.toContainEqual(expect.objectContaining({ id: 'local:game' }))
  })

  it('reclaims a saved remote target after the repository was reset', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const createFolder = vi.fn()
    const bindings = new FavoriteRepositoryBindingService({
      repository,
      newBindingToken: () => 'a1b2c3',
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory: vi.fn().mockResolvedValue({
            observedAccountMid: '100',
            folders: [{ id: 'saved-music-folder', title: 'bilimi\u00b7Music', memberCount: 12 }]
          }),
          createFolder, append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      bindingService: bindings,
      resolveLedgerTitle: vi.fn().mockResolvedValue('bilimi\u00b7Music'),
      resolveLedgerBinding: vi.fn().mockResolvedValue({
          remoteFolderId: 'saved-music-folder',
          remoteDisplayTitle: 'bilimi\u00b7Music'
      }),
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })

    await expect(coordinator.freezeForBilibiliExecution('100')).resolves.toMatchObject({
      status: 'frozen', frozenSyncPlan: { operations: [{ aid: 1, folderIds: ['saved-music-folder'] }] }
    })
    expect(createFolder).not.toHaveBeenCalled()
    await expect(bindings.getBindings('100')).resolves.toMatchObject({
      shards: [expect.objectContaining({ remoteFolderId: 'saved-music-folder', bindingState: 'bound' })]
    })
  })

  it('freezes a saved remote target when a prior reset left only its binding command result', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const bindings = new FavoriteRepositoryBindingService({
      repository,
      newBindingToken: () => 'a1b2c3',
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory: vi.fn().mockResolvedValue({
            observedAccountMid: '100', folders: [{ id: 'saved-music-folder', title: 'bilimi·Music', memberCount: 12 }]
          }),
          createFolder: vi.fn(), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })
    await bindings.ensurePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: 'bilimi·Music', remoteDisplayTitle: 'bilimi·Music',
      preferredRemoteFolderId: 'saved-music-folder', shardNumber: 1, memberAids: []
    })
    await repository.commit('100', {
      id: 'reset-with-stale-binding-result', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z',
      type: 'clear-local-repository', payload: {}
    })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }), bindingService: bindings,
      resolveLedgerTitle: vi.fn().mockResolvedValue('bilimi·Music'),
      resolveLedgerBinding: vi.fn().mockResolvedValue({
        remoteFolderId: 'saved-music-folder', remoteDisplayTitle: 'bilimi·Music'
      }),
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })

    await expect(coordinator.freezeForBilibiliExecution('100')).resolves.toMatchObject({
      status: 'frozen', frozenSyncPlan: { operations: [{ aid: 1, folderIds: ['saved-music-folder'] }] }
    })
  })

  it('binds classifications that arrive while confirmation is preparing', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const titleRequested = deferred<void>()
    const releaseTitle = deferred<void>()
    const bindings = new FavoriteRepositoryBindingService({
      repository,
      newBindingToken: () => 'a1b2c3',
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory: vi.fn().mockResolvedValue({
            observedAccountMid: '100',
            folders: [
              { id: 'remote-music', title: 'bilimi\u00b7Music', memberCount: 0 },
              { id: 'remote-knowledge', title: 'bilimi\u00b7Knowledge', memberCount: 0 }
            ]
          }),
          createFolder: vi.fn(), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      bindingService: bindings,
      resolveLedgerTitle: vi.fn(async (_accountMid, logicalLedgerId) => {
        if (logicalLedgerId === 'music') {
          titleRequested.resolve()
          await releaseTitle.promise
          return 'bilimi\u00b7Music'
        }
        return 'bilimi\u00b7Knowledge'
      }),
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1, 2] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })

    const freezing = coordinator.freezeForBilibiliExecution('100')
    await titleRequested.promise
    const lateClassification = coordinator.applyClassificationBatch('100', {
      source: 'deepseek', assignments: [{ aid: 2, targetLedgerIds: ['knowledge'] }]
    })
    releaseTitle.resolve()

    await expect(freezing).resolves.toMatchObject({
      status: 'frozen',
      frozenSyncPlan: {
        operations: [
          { aid: 1, folderIds: ['remote-music'] },
          { aid: 2, folderIds: ['remote-knowledge'] }
        ]
      }
    })
    await expect(lateClassification).resolves.toMatchObject({ classifications: { '2': { targetLedgerIds: ['knowledge'] } } })
  })

  it('reclaims a saved remote target when confirming a recovered preview', async () => {
    const root = await createRoot()
    const firstRepository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const first = createCoordinator(firstRepository, new OldFavoriteWorkspaceStore({ root }))
    await first.beginScan('100', 'incremental')
    await first.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false }]
    })
    await first.recordScanPage('100', {
      folderId: 'source', page: 1, items: [{ aid: 1, title: 'Saved', sourceFolderIds: ['source'] }]
    })
    await first.finishScan('100')
    await first.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })

    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:01.000Z' })
    const bindings = new FavoriteRepositoryBindingService({
      repository,
      newBindingToken: () => 'a1b2c3',
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory: vi.fn().mockResolvedValue({
            observedAccountMid: '100',
            folders: [{ id: 'saved-music-folder', title: 'bilimi\u00b7Music', memberCount: 0 }]
          }),
          createFolder: vi.fn(), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })
    const recovered = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      bindingService: bindings,
      resolveLedgerTitle: vi.fn().mockResolvedValue('bilimi\u00b7Music'),
      resolveLedgerBinding: vi.fn().mockResolvedValue({
        remoteFolderId: 'saved-music-folder', remoteDisplayTitle: 'bilimi\u00b7Music'
      }),
      now: () => '2026-07-20T00:00:01.000Z'
    })

    await expect(recovered.freezeForBilibiliExecution('100')).resolves.toMatchObject({
      status: 'frozen', frozenSyncPlan: { operations: [{ aid: 1, folderIds: ['saved-music-folder'] }] }
    })
    await expect(bindings.getBindings('100')).resolves.toMatchObject({
      shards: [expect.objectContaining({ remoteFolderId: 'saved-music-folder', bindingState: 'bound' })]
    })
  })

  it('reclaims an unresolved prior target from the remote inventory before freezing a retry', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const createFolder = vi.fn()
    const bindings = new FavoriteRepositoryBindingService({
      repository,
      newBindingToken: () => 'a1b2c3',
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory: vi.fn().mockResolvedValue({
            observedAccountMid: '100',
            folders: [{ id: 'remote-music-1', title: 'bilimi·音乐舞台', memberCount: 8 }]
          }),
          createFolder, append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })
    await bindings.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: 'bilimi·音乐舞台', shardNumber: 1, memberAids: [],
      observedAccountMid: '100', inventory: []
    })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      bindingService: bindings, now: () => '2026-07-20T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })

    await expect(coordinator.freezeForBilibiliExecution('100')).resolves.toMatchObject({
      status: 'frozen', frozenSyncPlan: { operations: [{ aid: 1, folderIds: ['remote-music-1'] }] }
    })
    expect(createFolder).not.toHaveBeenCalled()
    await expect(bindings.getBindings('100')).resolves.toMatchObject({
      shards: [expect.objectContaining({ bindingState: 'bound', remoteFolderId: 'remote-music-1' })]
    })
  })

  it('preserves a Chinese target creation failure without completing the local round', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const createFolder = vi.fn().mockRejectedValue(new Error('Bilibili create failed'))
    const bindings = new FavoriteRepositoryBindingService({
      repository,
      newBindingToken: () => 'a1b2c3',
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined),
        release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory: vi.fn().mockResolvedValue({ observedAccountMid: '100', folders: [] }),
          createFolder, append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      bindingService: bindings,
      resolveLedgerTitle: vi.fn().mockResolvedValue('bilimi·你好'),
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['custom-saved-ledger'] }]
    })

    await expect(coordinator.freezeForBilibiliExecution('100')).rejects.toThrow('Bilibili create failed')
    expect(createFolder).toHaveBeenCalledWith(expect.objectContaining({ title: 'bilimi·你好' }))
    const snapshot = await repository.getSnapshot('100')
    expect(snapshot.workspace).toMatchObject({ status: 'previewing' })
    expect(snapshot.workspace?.frozenSyncPlan).toBeUndefined()
  })

  it('prepares enough Bilibili shards for a selected target that exceeds one folder', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root })
    const ensurePhysicalShard = vi.fn().mockResolvedValue({})
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }), bindingService: { ensurePhysicalShard }
    })
    const aids = Array.from({ length: 1_001 }, (_, index) => index + 1)
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: aids.map((aid) => ({ aid, targetLedgerIds: ['music'] }))
    })

    await expect(coordinator.freezeForBilibiliExecution('100')).rejects.toThrow('remote-target-unbound')
    expect(ensurePhysicalShard).toHaveBeenCalledTimes(2)
    expect(ensurePhysicalShard).toHaveBeenNthCalledWith(1, '100', expect.objectContaining({ shardNumber: 1 }))
    expect(ensurePhysicalShard).toHaveBeenNthCalledWith(2, '100', expect.objectContaining({ shardNumber: 2 }))
  })

  it('prepares a manually created local ledger for Bilibili binding during confirmation', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root })
    const ensurePhysicalShard = vi.fn().mockResolvedValue({})
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      bindingService: { ensurePhysicalShard },
      resolveLedgerTitle: vi.fn().mockResolvedValue('bilimi·你好')
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['custom-saved-ledger'] }]
    })

    await expect(coordinator.freezeForBilibiliExecution('100')).rejects.toThrow('remote-target-unbound')
    expect(ensurePhysicalShard).toHaveBeenCalledWith('100', expect.objectContaining({
      logicalLedgerId: 'custom-saved-ledger', logicalTitle: 'bilimi·你好'
    }))
  })

  it('reports capacity exhaustion after preparing the required next shard during confirmation', async () => {
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
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1, 2] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }, { aid: 2, targetLedgerIds: ['music'] }]
    })

    await expect(coordinator.freezeForBilibiliExecution('100')).rejects.toThrow('physical-shard-capacity-exceeded')
    expect(ensurePhysicalShard).toHaveBeenCalledWith('100', expect.objectContaining({
      logicalLedgerId: 'music', shardNumber: 2
    }))
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
    await coordinator.beginScan('100', 'incremental')
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
    await coordinator.beginScan('100', 'incremental')
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
      syncService: createSyncService({ executeFrozenPlan, getRun }), now: () => '2026-07-20T00:00:00.000Z'
    })
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    await coordinator.beginScan('100', 'incremental')
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
      syncService: createSyncService({ executeFrozenPlan, getRun: vi.fn().mockResolvedValue({ id: 'run-1', status: 'running' }) }),
      now: () => '2026-07-20T00:00:00.000Z'
    })
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    await coordinator.beginScan('100', 'incremental')
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

  it('commits the complete local organization result before the first Bilibili write starts', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    let localSnapshotAtFirstWrite: Awaited<ReturnType<typeof repository.getSnapshot>> | undefined
    const append = vi.fn(async () => {
      localSnapshotAtFirstWrite = await repository.getSnapshot('100')
      return { observedAccountMid: '100' }
    })
    const syncService = new FavoriteRepositorySyncService({
      repository,
      pageBridge: { append, remove: vi.fn(), readMembers: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn(), readFolderInventory: vi.fn() },
      now: () => '2026-07-20T00:01:00.000Z', pacingMs: 0
    })
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }), bindingService: bindings, syncService,
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1, 2] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })
    await bindings.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber: 1, memberAids: [], observedAccountMid: '100',
      remoteFolderId: 'remote-music-1',
      inventory: [{ id: 'remote-music-1', title: favoriteRepositoryManagedShardTitle('music', 1, 'a1b2c3'), memberCount: 0, memberAids: [] }]
    })

    await expect(coordinator.beginBilibiliExecution('100')).resolves.toMatchObject({ status: 'executing' })
    await vi.waitFor(() => expect(append).toHaveBeenCalledOnce())

    expect(localSnapshotAtFirstWrite).toMatchObject({
      memberships: {
        'bilimi-logical:music': [1],
        'local:inbox': [2]
      },
      positions: {
        '100:1': expect.objectContaining({ localDesiredFolderIds: ['bilimi-logical:music'] }),
        '100:2': expect.objectContaining({ localDesiredFolderIds: [] })
      }
    })
    await vi.waitFor(async () => {
      expect((await repository.getSnapshot('100')).workspace?.status).toBe('completed')
    })
  })

  it('keeps the complete local result after a Bilibili write fails', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const append = vi.fn().mockRejectedValue(new Error('remote write failed'))
    const syncService = new FavoriteRepositorySyncService({
      repository,
      pageBridge: { append, remove: vi.fn(), readMembers: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn(), readFolderInventory: vi.fn() },
      now: () => '2026-07-20T00:01:00.000Z', pacingMs: 0
    })
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }), bindingService: bindings, syncService,
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1, 2] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })
    await bindings.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber: 1, memberAids: [], observedAccountMid: '100',
      remoteFolderId: 'remote-music-1',
      inventory: [{ id: 'remote-music-1', title: favoriteRepositoryManagedShardTitle('music', 1, 'a1b2c3'), memberCount: 0, memberAids: [] }]
    })

    await coordinator.beginBilibiliExecution('100')
    await vi.waitFor(() => expect(append).toHaveBeenCalledOnce())

    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      memberships: { 'bilimi-logical:music': [1], 'local:inbox': [2] },
      positions: {
        '100:1': expect.objectContaining({ localDesiredFolderIds: ['bilimi-logical:music'] }),
        '100:2': expect.objectContaining({ localDesiredFolderIds: [] })
      }
    })
  })

  it('backfills the complete local result before continuing a legacy frozen plan', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    let localSnapshotAtFirstWrite: Awaited<ReturnType<FavoriteRepositoryService['getSnapshot']>> | undefined
    const append = vi.fn(async () => {
      localSnapshotAtFirstWrite = await repository.getSnapshot('100')
      return { observedAccountMid: '100' }
    })
    const syncService = new FavoriteRepositorySyncService({
      repository,
      pageBridge: { append, remove: vi.fn(), readMembers: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn(), readFolderInventory: vi.fn() },
      now: () => '2026-07-20T00:01:00.000Z', pacingMs: 0
    })
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }), bindingService: bindings, syncService,
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1, 2] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })
    await bindings.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber: 1, memberAids: [], observedAccountMid: '100',
      remoteFolderId: 'remote-music-1',
      inventory: [{ id: 'remote-music-1', title: favoriteRepositoryManagedShardTitle('music', 1, 'a1b2c3'), memberCount: 0, memberAids: [] }]
    })
    const frozen = await coordinator.freezeForBilibiliExecution('100')
    await syncService.claimFrozenPlan('100', frozen.frozenSyncPlan!)

    await coordinator.executeFrozenBilibiliPlan('100')
    await vi.waitFor(() => expect(append).toHaveBeenCalledOnce())

    expect(localSnapshotAtFirstWrite).toMatchObject({
      memberships: { 'bilimi-logical:music': [1], 'local:inbox': [2] },
      positions: {
        '100:1': expect.objectContaining({ localDesiredFolderIds: ['bilimi-logical:music'] }),
        '100:2': expect.objectContaining({ localDesiredFolderIds: [] })
      }
    })
  })

  it('keeps the complete archive result when abandoning a legacy frozen plan', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const syncService = new FavoriteRepositorySyncService({
      repository,
      pageBridge: { append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn(), readFolderInventory: vi.fn() },
      now: () => '2026-07-20T00:01:00.000Z', pacingMs: 0
    })
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }), bindingService: bindings, syncService,
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1, 2] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })
    await bindings.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber: 1, memberAids: [], observedAccountMid: '100',
      remoteFolderId: 'remote-music-1',
      inventory: [{ id: 'remote-music-1', title: favoriteRepositoryManagedShardTitle('music', 1, 'a1b2c3'), memberCount: 0, memberAids: [] }]
    })
    await coordinator.freezeForBilibiliExecution('100')

    await coordinator.abandonCurrentWorkspace('100')

    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      workspace: undefined,
      memberships: { 'bilimi-logical:music': [1], 'local:inbox': [2] },
      positions: {
        '100:1': expect.objectContaining({ localDesiredFolderIds: ['bilimi-logical:music'] }),
        '100:2': expect.objectContaining({ localDesiredFolderIds: [] })
      }
    })
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
          append, remove: vi.fn(), readMembers: vi.fn(), readFolderInventory: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn()
        }))
      },
      now: () => '2026-07-20T00:00:00.000Z'
    })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }), syncService,
      now: () => '2026-07-20T00:00:00.000Z'
    })
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    await coordinator.beginScan('100', 'incremental')
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
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }), syncService: createSyncService({ executeFrozenPlan, getRun })
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
      syncService: createSyncService({ executeFrozenPlan: vi.fn().mockReturnValue(waiting.promise), getRun: vi.fn().mockResolvedValue({ id: 'run-1', status: 'running' }) })
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
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }), syncService: createSyncService({
        claimFrozenPlan: vi.fn(), executeFrozenPlan: vi.fn(), bindPageTarget: vi.fn(), reconcile: vi.fn(), resume: vi.fn(), getRun
      })
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

  it('requires an explicit fresh page bind before reconciling an unknown frozen run', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root })
    const rebindPageTarget = vi.fn().mockResolvedValue(undefined)
    const reconcile = vi.fn().mockResolvedValue({ id: 'run-1', status: 'ready-to-resume' })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      syncService: createSyncService({ executeFrozenPlan: vi.fn(), rebindPageTarget, reconcile })
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
    expect(rebindPageTarget).toHaveBeenCalledWith('100', 'run-1')
    expect(reconcile).toHaveBeenCalledWith('100', 'run-1')
  })

  it('requires an explicit fresh page bind before resuming a reconciled frozen run', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root })
    const rebindPageTarget = vi.fn().mockResolvedValue(undefined)
    const resume = vi.fn().mockResolvedValue({ id: 'run-1', status: 'running' })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      syncService: createSyncService({ executeFrozenPlan: vi.fn(), rebindPageTarget, resume })
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

    await expect(coordinator.resumeReconciledBilibiliPlan('100')).resolves.toMatchObject({ status: 'running' })
    expect(rebindPageTarget).toHaveBeenCalledWith('100', 'run-1')
    expect(resume).toHaveBeenCalledWith('100', 'run-1')
  })

  it('rebinds the current Bilibili page before the frozen continue button resumes a stopped run', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root })
    const rebindPageTarget = vi.fn().mockResolvedValue(undefined)
    const resume = vi.fn().mockResolvedValue({ id: 'run-1', status: 'running' })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      syncService: createSyncService({
        getRun: vi.fn().mockResolvedValue({ id: 'run-1', status: 'ready-to-resume' }),
        rebindPageTarget, resume
      })
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

    await expect(coordinator.executeFrozenBilibiliPlan('100')).resolves.toMatchObject({ status: 'running' })
    expect(rebindPageTarget).toHaveBeenCalledWith('100', 'run-1')
    expect(resume).toHaveBeenCalledWith('100', 'run-1')
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
    const workspace = requireWorkspace(await first.open('100'))
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

    const snapshot = requireSnapshot(await coordinator.getSnapshot('100'))

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
      { id: 'segment-1', index: 0, status: 'previewing', itemCount: 2_000, readiness: 'ready', completedTagItemCount: 2_000, pendingTagItemCount: 0 },
      { id: 'segment-2', index: 1, status: 'previewing', itemCount: 1, readiness: 'ready', completedTagItemCount: 1, pendingTagItemCount: 0 }
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
    const snapshot = requireSnapshot(await coordinator.getSnapshot('100'))
    if (!snapshot.currentSegment) throw new Error('workspace unexpectedly unavailable')

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
    const snapshot = requireSnapshot(await coordinator.getSnapshot('100'))
    if (!snapshot.currentSegment) throw new Error('workspace unexpectedly unavailable')
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

    const workspace = requireWorkspace(await coordinator.open('00100'))

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
    const scanning = requireWorkspace(await first.open('100'))
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

    const reopened = requireWorkspace(await createCoordinator(
      new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' }),
      new OldFavoriteWorkspaceStore({ root })
    ).open('100'))

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

    const first = requireWorkspace(await coordinator.open('100'))
    const second = requireWorkspace(await coordinator.open('200'))
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
    const workspace = requireWorkspace(await coordinator.open('100'))
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
      new OldFavoriteWorkspaceStore({ root }),
      { initializeOnOpen: false }
    )
    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1, items: [
        { aid: 1, title: 'First video', tags: ['music'], sourceFolderIds: ['source'] },
        { aid: 2, title: 'Second video', tags: ['music'], sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [
        { aid: 1, targetLedgerIds: ['music'] },
        { aid: 2, targetLedgerIds: ['music'] }
      ]
    })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['knowledge'] }]
    })

    const snapshot = requireSnapshot(await coordinator.getSnapshot('100'))
    expect(snapshot).toMatchObject({
      history: {
        cursor: 2,
        length: 2,
        entries: [
          {
            cursor: 2,
            source: 'manual',
            changeCount: 1,
            targetLedgerIds: ['knowledge'],
            summary: {
              title: 'First video',
              beforeTargetLedgerIds: ['music'],
              afterTargetLedgerIds: ['knowledge'],
              reason: '人工调整',
              movedCount: 1
            }
          },
          {
            cursor: 1,
            source: 'manual',
            changeCount: 2,
            targetLedgerIds: ['music'],
            summary: {
              title: 'First video',
              beforeTargetLedgerIds: [],
              afterTargetLedgerIds: ['music'],
              reason: '人工调整',
              movedCount: 2
            }
          }
        ]
      }
    })
    expect(snapshot.history.entries[0]).not.toHaveProperty('changes')
    expect(snapshot.history.entries[1]).not.toHaveProperty('changes')

    await coordinator.moveHistoryCursor('100', 1)

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      classifications: { '1': { targetLedgerIds: ['music'] } },
      history: { cursor: 1, length: 2 }
    })
  })

  it.each([
    { label: 'running', checkpoint: { canceled: false, failed: false, pendingAids: [1], failedAids: [] } },
    { label: 'waiting', checkpoint: { canceled: false, failed: false, pendingAids: [], failedAids: [], waitingSegmentIds: ['segment-2'] } },
    { label: 'canceled', checkpoint: { canceled: true, failed: false, pendingAids: [1], failedAids: [] } },
    { label: 'failed', checkpoint: { canceled: false, failed: true, pendingAids: [], failedAids: [1] } }
  ])('blocks local save and Bilibili freeze while DeepSeek is $label', async ({ checkpoint }) => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.applyClassificationBatch('100', { source: 'system-high', assignments: [{ aid: 1, targetLedgerIds: ['music'] }] })
    const snapshot = requireSnapshot(await coordinator.getSnapshot('100'))
    await coordinator.setDeepSeekRunCheckpoint('100', {
      version: 1, workspaceId: snapshot.workspaceId, mode: 'all', scope: 'all',
      segmentWork: [{ segmentId: snapshot.currentSegment!.id, index: 0, aids: [1] }], totalVideoCount: 1,
      requestGroups: [], successfulAids: [], completedSegmentIds: [], waitingSegmentIds: [],
      ...checkpoint
    })

    await expect(coordinator.saveCurrentSegmentToLocalLibrary('100')).rejects.toThrow(/DeepSeek/i)
    await expect(coordinator.freezeForBilibiliExecution('100')).rejects.toThrow(/DeepSeek/i)
  })

  it('restores failed DeepSeek aids to their original automatic classifications and records the resolution', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      classifyCurrentItems: async () => [{ targetLedgerIds: ['original-music'], confidence: 'high' as const }]
    })
    await coordinator.open('100')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [{ aid: 1, title: 'Video 1', tags: ['tag'], sourceFolderIds: ['source'] }]
    })
    await coordinator.finishScan('100')
    const before = requireSnapshot(await coordinator.getSnapshot('100'))
    await coordinator.applyDeepSeekClassificationBatch('100', [{ aid: 1, targetLedgerIds: ['deepseek-games'] }], {
      workspaceId: before.workspaceId,
      currentSegmentId: before.currentSegment!.id,
      selectedSourceFolderIds: ['source'],
      classifications: { '1': { targetLedgerIds: ['original-music'], source: 'system-high' } }
    })
    await coordinator.setDeepSeekRunCheckpoint('100', {
      version: 1, workspaceId: before.workspaceId, mode: 'all', scope: 'all',
      segmentWork: [{ segmentId: before.currentSegment!.id, index: 0, aids: [1] }], totalVideoCount: 1,
      requestGroups: [], successfulAids: [], pendingAids: [], failedAids: [1], completedSegmentIds: [], waitingSegmentIds: [],
      canceled: false, failed: true
    })

    await coordinator.useOriginalClassificationsForFailedDeepSeekAids('100')

    await expect(coordinator.getDeepSeekRunCheckpoint('100')).resolves.toBeNull()
    const resolved = requireSnapshot(await coordinator.getSnapshot('100'))
    expect(resolved).toMatchObject({
      classifications: { '1': { targetLedgerIds: ['original-music'], source: 'fallback' } }
    })
    expect(resolved.history.entries[0]).toMatchObject({ source: 'fallback', summary: { reason: '沿用原自动分类' } })
    await expect(coordinator.saveCurrentSegmentToLocalLibrary('100')).resolves.toMatchObject({ status: 'completed' })
  })

  it('restores a provider-failed aid even when DeepSeek never changed its automatic classification', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      classifyCurrentItems: async () => [{ targetLedgerIds: ['original-music'], confidence: 'high' as const }]
    })
    await coordinator.open('100')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [{ aid: 1, title: 'Video 1', tags: ['tag'], sourceFolderIds: ['source'] }]
    })
    await coordinator.finishScan('100')
    const before = requireSnapshot(await coordinator.getSnapshot('100'))
    await coordinator.setDeepSeekRunCheckpoint('100', {
      version: 1, workspaceId: before.workspaceId, mode: 'all', scope: 'all', sourceFolderRevision: 'source',
      segmentWork: [{ segmentId: before.currentSegment!.id, index: 0, aids: [1] }], totalVideoCount: 1,
      originalTargetLedgerIdsByAid: { '1': ['original-music'] },
      requestGroups: [], successfulAids: [], pendingAids: [], failedAids: [1], completedSegmentIds: [], waitingSegmentIds: [],
      canceled: false, failed: true
    })

    await coordinator.useOriginalClassificationsForFailedDeepSeekAids('100')

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      classifications: { '1': { targetLedgerIds: ['original-music'], source: 'fallback' } }
    })
    await expect(coordinator.getDeepSeekRunCheckpoint('100')).resolves.toBeNull()
  })

  it('rejects source selection changes while a durable DeepSeek work plan owns the draft', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [
        { id: 'source-a', title: 'Source A', itemCount: 1, isBilimiWorkFolder: false },
        { id: 'source-b', title: 'Source B', itemCount: 1, isBilimiWorkFolder: false }
      ]
    })
    await coordinator.completeScan('100', { revision: 1, aids: [1, 2] })
    const snapshot = requireSnapshot(await coordinator.getSnapshot('100'))
    await coordinator.setDeepSeekRunCheckpoint('100', {
      version: 1, workspaceId: snapshot.workspaceId, mode: 'all', scope: 'all', sourceFolderRevision: 'source-a|source-b',
      segmentWork: [{ segmentId: snapshot.currentSegment!.id, index: 0, aids: [1, 2] }], totalVideoCount: 2,
      originalTargetLedgerIdsByAid: { '1': [], '2': [] }, requestGroups: [], successfulAids: [], pendingAids: [1, 2], failedAids: [],
      completedSegmentIds: [], waitingSegmentIds: [], canceled: false
    })

    await expect(coordinator.selectSourceFolders('100', ['source-a'])).rejects.toThrow(/DeepSeek/i)
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      sourceFolders: [
        { id: 'source-a', selected: true },
        { id: 'source-b', selected: true }
      ]
    })
  })

  it('treats initial automatic classification as a durable restore baseline instead of user change history', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const coordinator = createCoordinator(repository, store, {
      classifyCurrentItems: async (items) => items.map((item) => ({
        targetLedgerIds: [item.aid === 1 ? 'initial-high' : 'initial-low'],
        confidence: item.aid === 1 ? 'high' as const : 'low' as const
      }))
    })
    await coordinator.open('100')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'High confidence', tags: ['tag'], sourceFolderIds: ['source'] },
        { aid: 2, title: 'Low confidence', tags: ['tag'], sourceFolderIds: ['source'] }
      ]
    })

    await coordinator.finishScan('100')

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      classifications: {
        '1': { targetLedgerIds: ['initial-high'], source: 'system-high' },
        '2': { targetLedgerIds: ['initial-low'], source: 'system-low' }
      },
      history: { cursor: 2, length: 2, baselineCursor: 2, entries: [] }
    })

    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['manual'] }]
    })
    const changed = requireSnapshot(await coordinator.getSnapshot('100'))
    expect(changed.history).toMatchObject({
      cursor: 3, length: 3, baselineCursor: 2,
      entries: [{ cursor: 3, source: 'manual', targetLedgerIds: ['manual'] }]
    })
    expect(changed).toMatchObject({ originalTargetLedgerIdsByAid: { '1': ['initial-high'] } })

    if (changed.history.baselineCursor === undefined) throw new Error('history baseline unexpectedly unavailable')
    await coordinator.moveHistoryCursor('100', changed.history.baselineCursor)
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      classifications: { '1': { targetLedgerIds: ['initial-high'], source: 'system-high' } },
      history: { cursor: 2, baselineCursor: 2, entries: [{ cursor: 3, source: 'manual' }] },
      originalTargetLedgerIdsByAid: {}
    })
    await expect(coordinator.moveHistoryCursor('100', 0)).rejects.toThrow('cannot precede the initial classification baseline')

    await expect(createCoordinator(repository, new OldFavoriteWorkspaceStore({ root })).getSnapshot('100')).resolves.toMatchObject({
      history: { cursor: 2, length: 3, baselineCursor: 2, entries: [{ cursor: 3, source: 'manual' }] }
    })
  })

  it('backfills a missing automatic classification baseline when a ready draft is restored', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(repository, store)
    await first.open('100')
    await first.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2, isBilimiWorkFolder: false }]
    })
    await first.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'High confidence', tags: ['high'], sourceFolderIds: ['source'] },
        { aid: 2, title: 'Low confidence', tags: ['low'], sourceFolderIds: ['source'] }
      ]
    })
    await first.finishScan('100')
    await first.applyClassificationBatch('100', {
      source: 'system-low', assignments: [{ aid: 1, targetLedgerIds: ['stale-system-result'] }]
    })
    await first.undoClassificationChange('100')
    await expect(first.getSnapshot('100')).resolves.toMatchObject({
      segments: [{ id: 'segment-1', readiness: 'ready' }],
      classifications: {},
      history: { cursor: 0, length: 1 }
    })

    const classifyCurrentItems = vi.fn(async (items: Array<{ aid: number }>) => items.map((item) => ({
      targetLedgerIds: [item.aid === 1 ? 'initial-high' : 'initial-low'],
      confidence: item.aid === 1 ? 'high' as const : 'low' as const
    })))
    const reopened = createCoordinator(
      new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' }),
      new OldFavoriteWorkspaceStore({ root }),
      { initializeOnOpen: false, classifyCurrentItems }
    )

    await expect(reopened.getSnapshot('100')).resolves.toMatchObject({
      classifications: {
        '1': { targetLedgerIds: ['initial-high'], source: 'system-high' },
        '2': { targetLedgerIds: ['initial-low'], source: 'system-low' }
      },
      history: { cursor: 2, length: 2, baselineCursor: 2, entries: [] }
    })
    expect(classifyCurrentItems).toHaveBeenCalledOnce()

    await reopened.undoClassificationChange('100')
    await expect(reopened.getSnapshot('100')).resolves.toMatchObject({
      classifications: {
        '1': { targetLedgerIds: ['initial-high'], source: 'system-high' },
        '2': { targetLedgerIds: ['initial-low'], source: 'system-low' }
      },
      history: { cursor: 2, baselineCursor: 2 }
    })
  })

  it('clears completed workspace classifications and undo history when restoring after Bilibili sync', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(repository, store)
    const workspace = requireWorkspace(await first.open('100'))
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
    const workspace = requireWorkspace(await first.open('100'))
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

  it('repairs a locally committed workspace manifest after restart without replaying the repository commit', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(repository, store)
    await first.open('100')
    await first.completeScan('100', { revision: 1, aids: [1] })
    await first.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })
    vi.spyOn(store, 'markCommitted').mockRejectedValueOnce(new Error('simulated post-commit interruption'))
    const commits = vi.spyOn(repository, 'commit')
    await expect(first.saveCurrentSegmentToLocalLibrary('100')).rejects.toThrow('simulated post-commit interruption')
    commits.mockClear()

    await expect(new OldFavoriteWorkspaceStore({ root }).readRecoverySummary('100', (await repository.getSnapshot('100')).workspace!.id))
      .resolves.toMatchObject({ status: 'previewing' })
    await expect(createCoordinator(repository, new OldFavoriteWorkspaceStore({ root })).getSnapshot('100'))
      .resolves.toMatchObject({ status: 'completed' })
    expect(commits).not.toHaveBeenCalled()
    await expect(new OldFavoriteWorkspaceStore({ root }).readRecoverySummary('100', (await repository.getSnapshot('100')).workspace!.id))
      .resolves.toMatchObject({ status: 'completed', lastCommittedId: expect.stringMatching(/^old-favorite-workspace:local:/) })
  })

  it('returns the verified manifest checksum in a recovery summary without loading a baseline segment', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const first = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await first.open('100')
    await first.completeScan('100', { revision: 1, aids: [1] })
    await first.saveCurrentSegmentToLocalLibrary('100')
    const workspaceId = (await repository.getSnapshot('100')).workspace!.id
    const reader = new OldFavoriteWorkspaceStore({ root })
    const expected = await reader.readRecoverySummary('100', workspaceId)
    if ('recovery' in expected) throw new Error('workspace summary unexpectedly unavailable')
    const restarted = createCoordinator(repository, reader, { initializeOnOpen: false })

    await expect(restarted.getRecoverySummary('100')).resolves.toMatchObject({
      status: 'completed', manifestChecksum: expected.manifestChecksum, recoveryChoices: ['view']
    })
    await expect(reader.readWorkspaceReads('100', workspaceId)).resolves.toEqual(['manifest.json', 'manifest.json'])
  })

  it('reports deterministic account-scoped baseline change evidence and requires an explicit recovery decision', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const first = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await first.open('100')
    await first.completeScan('100', { revision: 1, aids: [1] })

    const summary = await first.getRecoverySummary('100')
    expect(summary).toMatchObject({
      accountMid: '100',
      baselineChangeEvidence: {
        scope: 'account', workspaceBaselineRevision: 1,
        repositoryRevision: expect.any(Number), changed: false, direction: 'advanced',
        manualClassificationsRemainAuthoritative: true
      },
      recoveryChoices: expect.arrayContaining(['continue-original', 'rescan'])
    })
    if (!summary) throw new Error('workspace summary unexpectedly unavailable')

    await expect(first.selectRecoveryDecision('100', {
      workspaceId: summary.workspaceId,
      choice: 'continue-original',
      expectedBaselineRevision: summary.baselineChangeEvidence.workspaceBaselineRevision,
      expectedRepositoryRevision: summary.baselineChangeEvidence.repositoryRevision
    })).resolves.toMatchObject({
      choice: 'continue-original',
      manualClassificationsRemainAuthoritative: true,
      requiresFullWorkspaceLoad: true
    })

    await repository.commit('100', {
      id: 'advance-repository-revision', accountMid: '100', issuedAt: '2026-07-20T00:00:01.000Z', type: 'record-organization-protections',
      payload: { records: [], replace: false }
    })
    await expect(first.selectRecoveryDecision('100', {
      workspaceId: summary.workspaceId,
      choice: 'continue-original',
      expectedBaselineRevision: summary.baselineChangeEvidence.workspaceBaselineRevision,
      expectedRepositoryRevision: summary.baselineChangeEvidence.repositoryRevision
    })).rejects.toThrow('baseline changed')
  })

  it('replaces a restored preview workspace after its recovery decision requests a rescan', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const first = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })
    await first.beginScan('100', 'incremental')
    await first.completeScan('100', { revision: 1, aids: [1] })
    const summary = await first.getRecoverySummary('100')
    if (!summary) throw new Error('workspace summary unexpectedly unavailable')
    await first.selectRecoveryDecision('100', {
      workspaceId: summary.workspaceId,
      choice: 'rescan',
      expectedBaselineRevision: summary.baselineChangeEvidence.workspaceBaselineRevision,
      expectedRepositoryRevision: summary.baselineChangeEvidence.repositoryRevision
    })

    const restarted = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })

    await expect(restarted.beginScan('100', 'incremental')).resolves.toMatchObject({
      status: 'scanning',
      mode: 'incremental',
      workspaceId: expect.not.stringMatching(new RegExp(`^${summary.workspaceId}$`))
    })
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      workspace: { status: 'scanning' }
    })
  })

  it('compares recovery baselines by affected aids and managed bindings instead of unrelated repository writes', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    const before = await coordinator.getRecoverySummary('100')
    expect(before?.baselineChangeEvidence).toMatchObject({
      changed: false, changedDimensions: []
    })

    await repository.commit('100', {
      id: 'unrelated-video', accountMid: '100', issuedAt: '2026-07-20T00:00:01.000Z', type: 'upsert-video',
      payload: { aid: 99, title: 'unrelated', author: 'up', tags: [], updatedAt: '2026-07-20T00:00:01.000Z' }
    })
    await expect(coordinator.getRecoverySummary('100')).resolves.toMatchObject({
      baselineChangeEvidence: { changed: false, changedDimensions: [] }
    })

    await repository.commit('100', {
      id: 'affected-metadata', accountMid: '100', issuedAt: '2026-07-20T00:00:02.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'affected', author: 'up', tags: [], updatedAt: '2026-07-20T00:00:02.000Z' }
    })
    await expect(coordinator.getRecoverySummary('100')).resolves.toMatchObject({
      baselineChangeEvidence: { changed: true, changedDimensions: ['aid-revisions'] }
    })
  })

  it('persists injected recovery configuration fingerprints and reports exact changed dimensions', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    let configuration = { metadata: 'metadata-v1', rules: 'rules-v1', keywords: 'keywords-v1', defaultSettings: 'defaults-v1' }
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      resolveRecoveryConfiguration: () => configuration
    })
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })

    await expect(coordinator.getRecoverySummary('100')).resolves.toMatchObject({
      baselineChangeEvidence: { changed: false, changedDimensions: [] }
    })
    const changes = [
      ['metadata', { ...configuration, metadata: 'metadata-v2' }],
      ['rules', { ...configuration, rules: 'rules-v2' }],
      ['keywords', { ...configuration, keywords: 'keywords-v2' }],
      ['default-settings', { ...configuration, defaultSettings: 'defaults-v2' }]
    ] as const
    for (const [dimension, next] of changes) {
      configuration = next
      await expect(coordinator.getRecoverySummary('100')).resolves.toMatchObject({
        baselineChangeEvidence: { changed: true, changedDimensions: [dimension], deepSeekClassificationsMayBeStale: true }
      })
      configuration = { metadata: 'metadata-v1', rules: 'rules-v1', keywords: 'keywords-v1', defaultSettings: 'defaults-v1' }
    }
    configuration = { metadata: 'metadata-v2', rules: 'rules-v2', keywords: 'keywords-v1', defaultSettings: 'defaults-v2' }
    await expect(coordinator.getRecoverySummary('100')).resolves.toMatchObject({
      baselineChangeEvidence: { changed: true, changedDimensions: ['metadata', 'rules', 'default-settings'] }
    })
  })

  it('persists a recovery decision and rejects its full recovery after affected evidence becomes stale', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    const summary = await coordinator.getRecoverySummary('100')
    if (!summary) throw new Error('missing summary')
    await coordinator.selectRecoveryDecision('100', {
      workspaceId: summary.workspaceId, choice: 'continue-original',
      expectedBaselineRevision: summary.baselineChangeEvidence.workspaceBaselineRevision,
      expectedRepositoryRevision: summary.baselineChangeEvidence.repositoryRevision
    })
    await expect(new OldFavoriteWorkspaceStore({ root }).readRecoverySummary('100', summary.workspaceId))
      .resolves.toMatchObject({ recoveryDecision: { choice: 'continue-original' } })
    await repository.commit('100', {
      id: 'stale-decision', accountMid: '100', issuedAt: '2026-07-20T00:00:01.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'new facts', author: 'up', tags: [], updatedAt: '2026-07-20T00:00:01.000Z' }
    })
    await expect(createCoordinator(repository, new OldFavoriteWorkspaceStore({ root })).open('100'))
      .rejects.toThrow('recovery decision is stale')
  })

  it('restores a result-unknown sync workspace without revalidating its preview recovery decision', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const coordinator = createCoordinator(repository, store)
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    const summary = await coordinator.getRecoverySummary('100')
    if (!summary) throw new Error('missing summary')
    await coordinator.selectRecoveryDecision('100', {
      workspaceId: summary.workspaceId, choice: 'continue-original',
      expectedBaselineRevision: summary.baselineChangeEvidence.workspaceBaselineRevision,
      expectedRepositoryRevision: summary.baselineChangeEvidence.repositoryRevision
    })
    const snapshot = await repository.getSnapshot('100')
    if (!snapshot.workspace) throw new Error('missing workspace')
    await repository.commit('100', {
      id: 'result-unknown-marker', accountMid: '100', issuedAt: '2026-07-20T00:00:01.000Z', type: 'set-workspace',
      payload: {
        ...snapshot.workspace,
        status: 'reconciling',
        workspaceRef: { ...snapshot.workspace.workspaceRef, status: 'reconciling', currentStep: 'result-unknown' }
      }
    })
    await repository.commit('100', {
      id: 'confirmed-sync-projection', accountMid: '100', issuedAt: '2026-07-20T00:00:02.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'confirmed remote facts', author: 'up', tags: [], updatedAt: '2026-07-20T00:00:02.000Z' }
    })

    await expect(createCoordinator(repository, new OldFavoriteWorkspaceStore({ root })).getSnapshot('100'))
      .resolves.toMatchObject({ status: 'reconciling' })
  })

  it('merges latest recovery facts without replacing manual classifications or making the decision stale', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })
    await repository.commit('100', {
      id: 'latest-facts', accountMid: '100', issuedAt: '2026-07-20T00:00:01.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'latest facts', author: 'up', tags: [], updatedAt: '2026-07-20T00:00:01.000Z' }
    })
    const summary = await coordinator.getRecoverySummary('100')
    if (!summary) throw new Error('missing summary')

    await expect(coordinator.selectRecoveryDecision('100', {
      workspaceId: summary.workspaceId, choice: 'merge-latest',
      expectedBaselineRevision: summary.baselineChangeEvidence.workspaceBaselineRevision,
      expectedRepositoryRevision: summary.baselineChangeEvidence.repositoryRevision
    })).resolves.toMatchObject({ choice: 'merge-latest', manualClassificationsRemainAuthoritative: true })

    await expect(createCoordinator(repository, new OldFavoriteWorkspaceStore({ root })).getSnapshot('100'))
      .resolves.toMatchObject({ classifications: { '1': { targetLedgerIds: ['music'], source: 'manual' } } })
  })

  it('reclassifies only affected system results after merge-latest while retaining manual and DeepSeek choices across restart', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const classifyCurrentItem = vi.fn((item: { aid: number }) => ({ targetLedgerIds: [`system-${item.aid}`], confidence: 'high' as const }))
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { classifyCurrentItem })
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1, 2, 3, 4] })
    await coordinator.autoClassifyCurrentSegment('100')
    await coordinator.applyClassificationBatch('100', { source: 'manual', assignments: [{ aid: 3, targetLedgerIds: ['manual'] }] })
    const current = requireSnapshot(await coordinator.getSnapshot('100'))
    if (!current.currentSegment) throw new Error('workspace unexpectedly unavailable')
    await coordinator.applyDeepSeekClassificationBatch('100', [{ aid: 4, targetLedgerIds: ['deepseek'] }], {
      workspaceId: current.workspaceId, currentSegmentId: current.currentSegment.id, selectedSourceFolderIds: ['legacy-source'],
      classifications: Object.fromEntries(Object.entries(current.classifications).map(([aid, classification]) => [aid, {
        targetLedgerIds: classification.targetLedgerIds, source: classification.source
      }]))
    })
    classifyCurrentItem.mockClear()
    await repository.commit('100', {
      id: 'changed-aid-one', accountMid: '100', issuedAt: '2026-07-20T00:00:01.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'changed', tags: [], updatedAt: '2026-07-20T00:00:01.000Z' }
    })
    const summary = await coordinator.getRecoverySummary('100')
    if (!summary) throw new Error('missing recovery summary')
    await coordinator.selectRecoveryDecision('100', {
      workspaceId: summary.workspaceId, choice: 'merge-latest',
      expectedBaselineRevision: summary.baselineChangeEvidence.workspaceBaselineRevision,
      expectedRepositoryRevision: summary.baselineChangeEvidence.repositoryRevision
    })

    const restarted = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { classifyCurrentItem })
    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({ classifications: {
      '1': { targetLedgerIds: ['system-1'], source: 'system-high' },
      '2': { targetLedgerIds: ['system-2'], source: 'system-high' },
      '3': { targetLedgerIds: ['manual'], source: 'manual' },
      '4': { targetLedgerIds: ['deepseek'], source: 'deepseek' }
    } })
    expect(classifyCurrentItem).toHaveBeenCalledTimes(1)
    await restarted.getSnapshot('100')
    expect(classifyCurrentItem).toHaveBeenCalledTimes(1)
  })

  it('persists DeepSeek stale evidence after a configuration merge without replacing its classification', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    let configuration = { metadata: 'v1', rules: 'v1', keywords: 'v1', defaultSettings: 'v1' }
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      resolveRecoveryConfiguration: () => configuration,
      classifyCurrentItem: () => ({ targetLedgerIds: ['system'], confidence: 'high' })
    })
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    const initial = requireSnapshot(await coordinator.getSnapshot('100'))
    if (!initial.currentSegment) throw new Error('workspace unexpectedly unavailable')
    await coordinator.applyDeepSeekClassificationBatch('100', [{ aid: 1, targetLedgerIds: ['deepseek'] }], {
      workspaceId: initial.workspaceId, currentSegmentId: initial.currentSegment.id, selectedSourceFolderIds: ['legacy-source'], classifications: {}
    })
    configuration = { ...configuration, keywords: 'v2' }
    const summary = await coordinator.getRecoverySummary('100')
    if (!summary) throw new Error('missing recovery summary')
    await coordinator.selectRecoveryDecision('100', {
      workspaceId: summary.workspaceId, choice: 'merge-latest',
      expectedBaselineRevision: summary.baselineChangeEvidence.workspaceBaselineRevision,
      expectedRepositoryRevision: summary.baselineChangeEvidence.repositoryRevision
    })

    await expect(createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      resolveRecoveryConfiguration: () => configuration,
      classifyCurrentItem: () => ({ targetLedgerIds: ['system'], confidence: 'high' })
    }).getSnapshot('100')).resolves.toMatchObject({
      classifications: { '1': { targetLedgerIds: ['deepseek'], source: 'deepseek' } }, staleDeepSeekAids: [1]
    })
  })

  it('does not execute an interrupted frozen plan merely by reopening the workspace', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(repository, store)
    const workspace = requireWorkspace(await first.open('100'))
    await first.completeScan('100', { revision: 1, aids: [1] })
    const marker = (await repository.getSnapshot('100')).workspace!
    const plan = {
      id: 'run-1', accountMid: '100', workspaceId: workspace.id, baselineRevision: 1,
      createdAt: '2026-07-20T00:00:00.000Z', operations: []
    }
    await repository.commit('100', {
      id: 'interrupted-execution', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'set-workspace', payload: {
        ...marker, status: 'executing', workspaceRef: { ...marker.workspaceRef, status: 'executing' }, frozenSyncPlan: plan
      }
    })
    const executeFrozenPlan = vi.fn().mockResolvedValue({ id: plan.id, status: 'ready-to-resume' })
    const getRun = vi.fn().mockResolvedValue({
      id: plan.id,
      status: 'ready-to-resume',
      completedOperationCount: 1,
      totalOperationCount: 2
    })
    const restarted = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }), syncService: createSyncService({ executeFrozenPlan, getRun })
    })

    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({ status: 'frozen' })

    expect(executeFrozenPlan).not.toHaveBeenCalled()
  })

  it('restores an interrupted unknown result as reconciliation without repeating the remote write', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(repository, store)
    const workspace = requireWorkspace(await first.open('100'))
    await first.completeScan('100', { revision: 1, aids: [1] })
    const marker = (await repository.getSnapshot('100')).workspace!
    const plan = {
      id: 'run-unknown-interrupted', accountMid: '100', workspaceId: workspace.id, baselineRevision: 1,
      createdAt: '2026-07-20T00:00:00.000Z', operations: []
    }
    await repository.commit('100', {
      id: 'interrupted-unknown', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'set-workspace', payload: {
        ...marker, status: 'executing', workspaceRef: { ...marker.workspaceRef, status: 'executing' }, frozenSyncPlan: plan
      }
    })
    const executeFrozenPlan = vi.fn()
    const reconcile = vi.fn()
    const restarted = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      syncService: createSyncService({
        executeFrozenPlan,
        reconcile,
        getRun: vi.fn().mockResolvedValue({
          id: plan.id,
          status: 'result-unknown',
          completedOperationCount: 1,
          totalOperationCount: 2
        })
      })
    })

    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({
      status: 'reconciling',
      executionProgress: { completedOperationCount: 1, totalOperationCount: 2 }
    })
    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({
      status: 'reconciling',
      executionProgress: { completedOperationCount: 1, totalOperationCount: 2 }
    })
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      workspace: { status: 'reconciling', workspaceRef: { currentStep: 'result-unknown' } }
    })
    expect(executeFrozenPlan).not.toHaveBeenCalled()
    expect(reconcile).not.toHaveBeenCalled()
  })

  it('surfaces a persisted unknown remote result after restart without loading or retrying the workspace', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(repository, store)
    const workspace = requireWorkspace(await first.open('100'))
    await first.completeScan('100', { revision: 1, aids: [1] })
    const marker = (await repository.getSnapshot('100')).workspace!
    const plan = {
      id: 'run-unknown', accountMid: '100', workspaceId: workspace.id, baselineRevision: 1,
      createdAt: '2026-07-20T00:00:00.000Z',
      operations: [{ operationKey: 'append-1', aid: 1, kind: 'append' as const, folderIds: ['remote-a'] }]
    }
    await repository.commit('100', {
      id: 'freeze-unknown-run', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'set-workspace', payload: {
        ...marker,
        status: 'frozen',
        workspaceRef: { ...marker.workspaceRef, status: 'frozen', currentStep: 'frozen' },
        frozenSyncPlan: plan
      }
    })
    const sync = new FavoriteRepositorySyncService({
      repository,
      pageBridge: createPageBridge({ append: vi.fn().mockRejectedValue(new Error('network interrupted')) }),
      now: () => '2026-07-20T00:00:01.000Z', pacingMs: 0
    })

    await expect(sync.executeFrozenPlan('100', plan)).resolves.toMatchObject({ status: 'result-unknown' })

    const restarted = createCoordinator(
      new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:02.000Z' }),
      new OldFavoriteWorkspaceStore({ root }),
      { initializeOnOpen: false }
    )
    await expect(restarted.getRecoverySummary('100')).resolves.toMatchObject({
      status: 'reconciling', currentStep: 'result-unknown',
      recoveryChoices: ['view', 'reconcile-result-unknown'],
      resultUnknownEvidence: { operationCount: 1, planId: 'run-unknown' }
    })
    await expect(restarted.selectRecoveryDecision('100', {
      workspaceId: workspace.id, choice: 'continue-original', expectedBaselineRevision: 1, expectedRepositoryRevision: 3
    })).rejects.toThrow('must be reconciled')
  })

  it('restores continuation discoveries from the journal while the repository marker stays small', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(repository, workspaceStore)
    const workspace = requireWorkspace(await first.open('100'))
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
    const workspace = requireWorkspace(await first.open('100'))
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
    const corrupted = requireWorkspace(await first.open('100'))
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
    const workspace = requireWorkspace(await first.open('100'))
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
    const workspace = requireWorkspace(await first.open('100'))
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
