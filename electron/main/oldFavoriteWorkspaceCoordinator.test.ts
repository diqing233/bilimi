import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FavoriteRepositoryService } from './favoriteRepositoryService'
import { FavoriteRepositoryBindingService, favoriteRepositoryManagedShardTitle } from './favoriteRepositoryBindingService'
import { FavoriteRepositorySyncService, type FavoriteRepositoryPageBridge } from './favoriteRepositorySyncService'
import {
  mergeGeneratedRecommendations,
  OldFavoriteWorkspaceCoordinator as OldFavoriteWorkspaceCoordinatorImplementation
} from './oldFavoriteWorkspaceCoordinator'
import { OldFavoriteWorkspaceStore } from './oldFavoriteWorkspaceStore'
import {
  classifierLedgersForAccount,
  classifyOldFavoriteItemsCooperatively,
  mergeOldFavoriteWorkspaceLedgers
} from './oldFavoriteWorkspaceClassification'
import {
  createOldFavoriteWorkspace,
  type OldFavoriteWorkspace,
  type OldFavoriteWorkspaceHistoryEntry,
  type OldFavoriteWorkspaceRecoveryRequired,
  type OldFavoriteWorkspaceSnapshot
} from '../../src/shared/oldFavoriteWorkspace'
import { createFavoriteRepositoryArchiveExport } from '../../src/shared/favoriteRepository'
import { classifyVideoContent } from '../../src/shared/recommendation/videoClassifier'
import type { FavoriteLedger } from '../../src/shared/types'

const roots: string[] = []
const directCoordinatorRulesByAccount = new Map<string, FavoriteLedger[]>()

function cloneFavoriteLedgers(ledgers: readonly FavoriteLedger[]) {
  return ledgers.map((ledger) => ({
    ...ledger,
    keywords: [...ledger.keywords],
    ...(ledger.bilibiliFolderIds ? { bilibiliFolderIds: [...ledger.bilibiliFolderIds] } : {})
  }))
}

type OrdinaryRuleChanges = {
  upserts: FavoriteLedger[]
  enabled: Array<{ ledgerId: string; enabled: boolean }>
}

/**
 * Test the same persistence boundary used by recommendation adoption: scan
 * candidates only select ordinary rules; they never become saved rules
 * themselves.
 */
function createOrdinaryRuleDirectory(initialRules: FavoriteLedger[] = []) {
  let rules = cloneFavoriteLedgers(initialRules)
  const listSavedFavoriteLedgers = vi.fn(async (_accountMid: string) => cloneFavoriteLedgers(rules))
  const applyFavoriteRecommendationRuleChanges = vi.fn(async (_accountMid: string, changes: OrdinaryRuleChanges) => {
    const before = cloneFavoriteLedgers(rules)
    const nextById = new Map(rules.map((ledger) => [ledger.id, ledger]))
    for (const ledger of changes.upserts) nextById.set(ledger.id, cloneFavoriteLedgers([ledger])[0]!)
    for (const { ledgerId, enabled } of changes.enabled) {
      const ledger = nextById.get(ledgerId)
      if (ledger) nextById.set(ledgerId, { ...ledger, enabled })
    }
    rules = cloneFavoriteLedgers([...nextById.values()])
    return { before, after: cloneFavoriteLedgers(rules) }
  })
  const restoreFavoriteRuleDirectory = vi.fn(async (_accountMid: string, ledgers: FavoriteLedger[]) => {
    rules = cloneFavoriteLedgers(ledgers)
  })
  return {
    listSavedFavoriteLedgers,
    applyFavoriteRecommendationRuleChanges,
    restoreFavoriteRuleDirectory,
    loadFavoriteLedgerHistoryLedgers: vi.fn(async (_accountMid: string) => cloneFavoriteLedgers(rules)),
    current: () => cloneFavoriteLedgers(rules)
  }
}

/**
 * Older coordinator tests construct the service directly.  Keep their focus
 * on workspace behavior while supplying the same ordinary-rule transaction
 * boundary the production composition now requires.
 */
class OldFavoriteWorkspaceCoordinator extends OldFavoriteWorkspaceCoordinatorImplementation {
  constructor(options: ConstructorParameters<typeof OldFavoriteWorkspaceCoordinatorImplementation>[0]) {
    const listSavedFavoriteLedgers = async (accountMid: string) =>
      cloneFavoriteLedgers(directCoordinatorRulesByAccount.get(accountMid) ?? [])
    const applyFavoriteRecommendationRuleChanges: NonNullable<ConstructorParameters<typeof OldFavoriteWorkspaceCoordinatorImplementation>[0]['applyFavoriteRecommendationRuleChanges']> = async (accountMid, changes) => {
      const before = await listSavedFavoriteLedgers(accountMid)
      const nextById = new Map(before.map((ledger) => [ledger.id, ledger]))
      for (const ledger of changes.upserts) nextById.set(ledger.id, cloneFavoriteLedgers([ledger])[0]!)
      for (const { ledgerId, enabled } of changes.enabled) {
        const ledger = nextById.get(ledgerId)
        if (ledger) nextById.set(ledgerId, { ...ledger, enabled })
      }
      const after = cloneFavoriteLedgers([...nextById.values()])
      directCoordinatorRulesByAccount.set(accountMid, after)
      return { before, after: cloneFavoriteLedgers(after) }
    }
    super({
      listSavedFavoriteLedgers,
      applyFavoriteRecommendationRuleChanges,
      restoreFavoriteRuleDirectory: async (accountMid, ledgers) => {
        directCoordinatorRulesByAccount.set(accountMid, cloneFavoriteLedgers(ledgers))
      },
      resolveLedgerTitle: async (accountMid, ledgerId) =>
        directCoordinatorRulesByAccount.get(accountMid)?.find((ledger) => ledger.id === ledgerId)?.displayName,
      ...options
    })
  }
}

async function createRoot() {
  const root = await mkdtemp(join(tmpdir(), 'bilimi-old-favorite-coordinator-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  vi.restoreAllMocks()
  directCoordinatorRulesByAccount.clear()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function createCoordinator(
  repository: FavoriteRepositoryService,
  workspaceStore: OldFavoriteWorkspaceStore,
  options: Partial<ConstructorParameters<typeof OldFavoriteWorkspaceCoordinator>[0]> & { initializeOnOpen?: boolean } = {}
) {
  const { initializeOnOpen = true, now = () => '2026-07-19T00:00:00.000Z', ...coordinatorOptions } = options
  let ordinaryRules: FavoriteLedger[] = []
  const cloneRules = cloneFavoriteLedgers
  const defaultApplyFavoriteRecommendationRuleChanges: NonNullable<ConstructorParameters<typeof OldFavoriteWorkspaceCoordinator>[0]['applyFavoriteRecommendationRuleChanges']> = async (_accountMid, changes) => {
    const before = cloneRules(ordinaryRules)
    const nextById = new Map(ordinaryRules.map((ledger) => [ledger.id, ledger]))
    for (const ledger of changes.upserts) nextById.set(ledger.id, cloneRules([ledger])[0]!)
    for (const { ledgerId, enabled } of changes.enabled) {
      const ledger = nextById.get(ledgerId)
      if (ledger) nextById.set(ledgerId, { ...ledger, enabled })
    }
    ordinaryRules = cloneRules([...nextById.values()])
    return { before, after: cloneRules(ordinaryRules) }
  }
  const coordinator = new OldFavoriteWorkspaceCoordinator({
    repository,
    workspaceStore,
    listSavedFavoriteLedgers: async () => cloneRules(ordinaryRules),
    applyFavoriteRecommendationRuleChanges: defaultApplyFavoriteRecommendationRuleChanges,
    restoreFavoriteRuleDirectory: async (_accountMid, ledgers) => {
      ordinaryRules = cloneRules(ledgers)
    },
    resolveLedgerTitle: async (_accountMid, ledgerId) =>
      ordinaryRules.find((ledger) => ledger.id === ledgerId)?.displayName,
    ...(coordinatorOptions as ConstructorParameters<typeof OldFavoriteWorkspaceCoordinator>[0]),
    now
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

function ordinaryAuthorLedger(id: string, author: string, enabled = false): FavoriteLedger {
  return {
    id,
    displayName: `bilimi·${author}`,
    keywords: [author],
    ruleType: 'author',
    enabled,
    priority: 1,
    syncState: 'local-draft',
    bindingState: 'unbacked',
    ruleOrigin: 'saved-rule',
    isDefault: false
  }
}

async function readyWorkspaceWithAuthorRecommendation(coordinator: OldFavoriteWorkspaceCoordinator, author: string) {
  await coordinator.open('100')
  await coordinator.beginScan('100', 'incremental')
  await coordinator.recordScanPage('100', {
    folderId: 'source', page: 1, hasMore: false,
    items: [
      { aid: 1, title: 'First', author, sourceFolderIds: ['source'] },
      { aid: 2, title: 'Second', author, sourceFolderIds: ['source'] }
    ]
  })
  await coordinator.finishScan('100')
  await coordinator.acceptCurrentTags('100')
  const snapshot = requireSnapshot(await coordinator.getSnapshot('100'))
  return {
    snapshot,
    candidateId: snapshot.recommendations.candidates.find((item) => item.displayName === `bilimi·${author}`)!.id
  }
}

function requireWorkspace(value: OldFavoriteWorkspace | OldFavoriteWorkspaceRecoveryRequired | null) {
  if (!value || 'recovery' in value) throw new Error('workspace unexpectedly unavailable')
  return value
}

function requireSnapshot(value: OldFavoriteWorkspaceSnapshot | OldFavoriteWorkspaceRecoveryRequired | null) {
  if (!value || 'recovery' in value) throw new Error('workspace unexpectedly unavailable')
  return value
}

function requireLinkedRecommendationLedgerId(snapshot: OldFavoriteWorkspaceSnapshot, candidateId: string) {
  const link = snapshot.recommendations.links?.[candidateId]
  if (!link || link.status !== 'linked') throw new Error(`recommendation ${candidateId} is not linked to an ordinary rule`)
  return link.ledgerId
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
    stopAndAbandonFrozenPlan: vi.fn(),
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
  it('mirrors live Bilimi observations and excludes only the exact confirmed-deleted remote ID', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-09-10T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false, getConfirmedDeletedRemoteFolderIds: () => ['deleted-game']
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{
        id: 'unbacked-game', title: 'bilimi·游戏专区', itemCount: 0,
        isBilimiWorkFolder: false, remoteRelationship: 'none', scanEligible: true, selected: true
      }, {
        id: 'unbound-game', title: 'bilimi·游戏专区', itemCount: 0,
        isBilimiWorkFolder: false, remoteRelationship: 'none', scanEligible: true, selected: true
      }, {
        id: 'fresh-game', title: 'bilimi·游戏专区', itemCount: 0,
        isBilimiWorkFolder: false, remoteRelationship: 'none', scanEligible: true, selected: true
      }, {
        id: 'deleted-game', title: 'bilimi·游戏专区', itemCount: 0,
        isBilimiWorkFolder: true, remoteRelationship: 'bound', scanEligible: false, selected: false
      }]
    })

    await coordinator.finishScan('100')

    const snapshot = await repository.getSnapshot('100')
    expect(snapshot.folders).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'bilibili:unbacked-game' }),
      expect.objectContaining({ id: 'bilibili:unbound-game' }),
      expect.objectContaining({ id: 'bilibili:fresh-game' })
    ]))
    expect(snapshot.folders).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'bilibili:deleted-game' })
    ]))
    expect(snapshot.physicalShards).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ remoteFolderId: 'deleted-game' }),
      expect.objectContaining({ knownRemoteFolderIds: expect.arrayContaining(['deleted-game']) })
    ]))
  })

  it('drops an adopted recommendation when a later scan no longer generates it', () => {
    const adopted = {
      id: 'custom-author-alice', displayName: 'bilimi\u00b7Alice', kind: 'author' as const,
      sourceName: 'Alice', keywords: ['Alice'], count: 2,
      matchedAidsBySegment: { 'segment-1': [1, 2] }, reason: 'Alice appeared twice.'
    }

    expect(mergeGeneratedRecommendations([], [adopted.id], [adopted])).toEqual({
      initialized: true,
      candidates: [],
      adoptedCandidateIds: []
    })
  })

  it('does not recover non-canonical shard suffixes as physical bilimi bindings', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })
    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [
        { id: 'dot-shard', title: 'bilimi·游戏专区.2', itemCount: 1, isBilimiWorkFolder: true },
        { id: 'zero-shard', title: 'bilimi·游戏专区·02', itemCount: 1, isBilimiWorkFolder: true }
      ]
    })
    await coordinator.recordManagedMembers('100', { 'dot-shard': [1], 'zero-shard': [2] })
    await coordinator.finishScan('100')

    const snapshot = await repository.getSnapshot('100')
    expect(snapshot.physicalShards.filter((shard) => shard.logicalLedgerId === 'game')).toEqual([])
  })

  it('reports the successful Bilibili deletion without deleting the right-side rule', async () => {
    const root = await createRoot()
    const onManagedFolderDeletion = vi.fn().mockResolvedValue(undefined)
    const syncService = createSyncService({
      deleteManagedFolders: vi.fn().mockResolvedValue({
        status: 'succeeded',
        candidates: [{ logicalLedgerId: 'music', remoteFolderId: '9001', title: 'bilimi·音乐', memberCount: 2, state: 'bound', requiresUnboundAcknowledgement: false }],
        succeededRemoteFolderIds: ['9001'], failedRemoteFolderIds: [], unknownRemoteFolderIds: [], unattemptedRemoteFolderIds: [], failures: []
      })
    })
    const coordinator = createCoordinator(
      new FavoriteRepositoryService({ root }),
      new OldFavoriteWorkspaceStore({ root }),
      { initializeOnOpen: false, syncService, onManagedFolderDeletion }
    )

    await coordinator.deleteManagedFolderCandidates('100', ['music'])

    expect(onManagedFolderDeletion).toHaveBeenCalledWith('100', [{
      logicalLedgerId: 'music', remoteFolderIds: ['9001'], remoteDeleted: true
    }])
  })

  it('reports a fresh no-candidate result for an unbound default rule without attempting a remote folder deletion', async () => {
    const root = await createRoot()
    const onManagedFolderDeletion = vi.fn().mockResolvedValue(undefined)
    const syncService = createSyncService({
      deleteManagedRemoteFolders: vi.fn().mockResolvedValue({
        status: 'succeeded',
        candidates: [{ logicalLedgerId: 'music', title: 'bilimi·音乐', memberCount: 0, state: 'local-only', requiresUnboundAcknowledgement: false }],
        succeededRemoteFolderIds: [], failedRemoteFolderIds: [], unknownRemoteFolderIds: [], unattemptedRemoteFolderIds: [], failures: []
      })
    })
    const coordinator = createCoordinator(
      new FavoriteRepositoryService({ root }),
      new OldFavoriteWorkspaceStore({ root }),
      { initializeOnOpen: false, syncService, onManagedFolderDeletion }
    )

    await expect(coordinator.deleteManagedRemoteFolderCandidates('100', ['music'])).resolves.toMatchObject({ status: 'succeeded' })

    expect(onManagedFolderDeletion).toHaveBeenCalledWith('100', [{
      logicalLedgerId: 'music', remoteFolderIds: [], remoteDeleted: false, remoteConfirmedAbsent: true
    }])
  })

  it('does not clear matching ledger rules when no managed folder deletion succeeds', async () => {
    const root = await createRoot()
    const onManagedFolderDeletion = vi.fn().mockResolvedValue(undefined)
    const syncService = createSyncService({
      deleteManagedFolders: vi.fn().mockResolvedValue({
        status: 'failed', candidates: [], succeededRemoteFolderIds: [], failedRemoteFolderIds: ['9001'],
        unknownRemoteFolderIds: [], unattemptedRemoteFolderIds: ['9002'], failures: []
      })
    })
    const coordinator = createCoordinator(
      new FavoriteRepositoryService({ root }),
      new OldFavoriteWorkspaceStore({ root }),
      { initializeOnOpen: false, syncService, onManagedFolderDeletion }
    )

    await expect(coordinator.deleteManagedFolderCandidates('100', ['music', 'game'])).resolves.toMatchObject({ status: 'failed' })

    expect(onManagedFolderDeletion).not.toHaveBeenCalled()
  })

  it('clears only confirmed bindings when a multi-folder deletion partially succeeds', async () => {
    const root = await createRoot()
    const onManagedFolderDeletion = vi.fn().mockResolvedValue(undefined)
    const syncService = createSyncService({
      deleteManagedFolders: vi.fn().mockResolvedValue({
        status: 'partial-failed',
        candidates: [
          { logicalLedgerId: 'music', remoteFolderId: '9001', title: 'bilimi·音乐·1', memberCount: 2, state: 'bound', requiresUnboundAcknowledgement: false },
          { logicalLedgerId: 'music', remoteFolderId: '9002', title: 'bilimi·音乐·2', memberCount: 2, state: 'bound', requiresUnboundAcknowledgement: false }
        ],
        succeededRemoteFolderIds: ['9001'], failedRemoteFolderIds: ['9002'], unknownRemoteFolderIds: [], unattemptedRemoteFolderIds: [], failures: []
      })
    })
    const coordinator = createCoordinator(
      new FavoriteRepositoryService({ root }),
      new OldFavoriteWorkspaceStore({ root }),
      { initializeOnOpen: false, syncService, onManagedFolderDeletion }
    )

    await expect(coordinator.deleteManagedFolderCandidates('100', ['music'])).resolves.toMatchObject({
      status: 'partial-failed', succeededRemoteFolderIds: ['9001'], failedRemoteFolderIds: ['9002']
    })
    expect(onManagedFolderDeletion).toHaveBeenCalledWith('100', [{
      logicalLedgerId: 'music', remoteFolderIds: ['9001'], remoteDeleted: true
    }])
  })

  it('runs the same confirmed-deletion projection after remote draft deletion', async () => {
    const root = await createRoot()
    const onManagedFolderDeletion = vi.fn().mockResolvedValue(undefined)
    const syncService = createSyncService({
      deleteManagedRemoteFolders: vi.fn().mockResolvedValue({
        status: 'partial-failed',
        candidates: [
          { logicalLedgerId: 'draft', remoteFolderId: '9001', title: 'bilimi·草稿', memberCount: 2, state: 'unbound', requiresUnboundAcknowledgement: true },
          { logicalLedgerId: 'draft', remoteFolderId: '9002', title: 'bilimi·草稿·2', memberCount: 1, state: 'unbound', requiresUnboundAcknowledgement: true }
        ],
        succeededRemoteFolderIds: ['9001'], failedRemoteFolderIds: ['9002'], unknownRemoteFolderIds: [], unattemptedRemoteFolderIds: [], failures: []
      })
    })
    const coordinator = createCoordinator(
      new FavoriteRepositoryService({ root }),
      new OldFavoriteWorkspaceStore({ root }),
      { initializeOnOpen: false, syncService, onManagedFolderDeletion }
    )

    await expect(coordinator.deleteManagedRemoteFolderCandidates(
      '100', ['draft'], true, undefined, undefined,
      { draft: { remoteFolderId: '9001', title: 'bilimi·草稿' } }
    )).resolves.toMatchObject({ status: 'partial-failed', succeededRemoteFolderIds: ['9001'] })

    expect(onManagedFolderDeletion).toHaveBeenCalledWith('100', [{
      logicalLedgerId: 'draft', remoteFolderIds: ['9001'], remoteDeleted: true
    }])
  })

  it('publishes one canonical inventory projection for duplicate sources, remote-only managed members, and unavailable videos', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    await repository.commit('100', {
      id: 'bind-managed-before-inventory', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'upsert-physical-shard-binding',
      payload: {
        logicalLedgerId: 'knowledge', logicalTitle: 'bilimi·知识学习', shardNumber: 1,
        remoteTitle: 'bilimi·知识学习', bindingState: 'bound', remoteFolderId: 'managed', memberAids: []
      }
    })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [
        { id: 'ordinary-a', title: '默认收藏夹', itemCount: 3, isBilimiWorkFolder: false },
        { id: 'ordinary-b', title: '自建收藏夹', itemCount: 2, isBilimiWorkFolder: false },
        { id: 'managed', title: 'bilimi·知识学习', itemCount: 2, isBilimiWorkFolder: true }
      ]
    })
    await coordinator.recordManagedMembers('100', { managed: [2, 5] })
    await coordinator.recordScanPage('100', {
      folderId: 'ordinary-a', page: 1, hasMore: false,
      items: [
        { aid: 1, title: 'Duplicate', sourceFolderIds: ['ordinary-a', 'ordinary-b'] },
        { aid: 2, title: 'Protected', sourceFolderIds: ['ordinary-a'] },
        { aid: 3, title: '已失效视频', author: '账号已注销', unavailable: true, sourceFolderIds: ['ordinary-a'] },
        { aid: 4, title: 'Ordinary only', sourceFolderIds: ['ordinary-b'] }
      ]
    })

    await coordinator.finishScan('100')

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      scan: {
        // The scan summary keeps the Bilibili relationship total from the
        // folder inventory, including Bilimi folders and duplicate placements.
        totalItemCount: 7,
        // The discovered-video count remains deduplicated for scan progress.
        scannedItemCount: 5
      },
      inventoryMetrics: {
        authority: 'complete',
        relationshipCount: 7,
        plannedAidCount: 4,
        protectedAidCount: 0,
        unavailableAidCount: 1,
        sourceFolders: [
          { id: 'ordinary-a', relationshipCount: 3, plannedAidCount: 2, protectedAidCount: 0, unavailableAidCount: 1, confirmed: true },
          { id: 'ordinary-b', relationshipCount: 2, plannedAidCount: 2, protectedAidCount: 0, unavailableAidCount: 0, confirmed: true },
          { id: 'managed', relationshipCount: 2, plannedAidCount: 2, protectedAidCount: 0, unavailableAidCount: 0, confirmed: true }
        ]
      }
    })

    const restarted = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })
    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({
      scan: {
        totalItemCount: 7,
        scannedItemCount: 5
      },
      inventoryMetrics: { relationshipCount: 7 }
    })
  })

  it('keeps incomplete folder lifecycle projections pending while preserving the known Bilibili relationship total', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'managed', title: 'bilimi·知识学习', itemCount: 332, isBilimiWorkFolder: true }]
    })

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      inventoryMetrics: {
        authority: 'incomplete',
        relationshipCount: 332,
        sourceFolders: [{
          id: 'managed',
          relationshipCount: 332,
          plannedAidCount: null,
          protectedAidCount: null,
          unavailableAidCount: null,
          confirmed: false
        }]
      }
    })
  })

  it('marks prior remote sources pending when an inventory scan has not completed', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-08-04T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })
    await repository.commit('100', {
      id: 'prior-source', accountMid: '100', issuedAt: '2026-08-04T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'Saved', tags: ['known'], updatedAt: '2026-08-04T00:00:00.000Z' }
    })
    await repository.commit('100', {
      id: 'prior-position', accountMid: '100', issuedAt: '2026-08-04T00:00:00.000Z', type: 'set-favorite-placement',
      payload: { aid: 1, localDesiredFolderIds: ['local:music'], remoteObservedPhysicalFolderIds: ['ordinary-old'], remoteObservedLogicalFolderIds: [], updatedAt: '2026-08-04T00:00:00.000Z' }
    })

    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'ordinary-new', title: 'New source', itemCount: 1, isBilimiWorkFolder: false }]
    })

    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      videos: { '1': { title: 'Saved', tags: ['known'] } },
      positions: { '100:1': { lifecycleState: 'source-pending', sourceAuthority: 'incomplete' } }
    })
    await expect(repository.getSnapshot('100')).resolves.not.toMatchObject({
      tombstones: { '100:1': expect.objectContaining({ kind: 'recycled' }) }
    })
  })

  it('uses the recovered scan run to isolate inventory lifecycle commands after restart', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-08-04T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    await repository.commit('100', {
      id: 'prior-video', accountMid: '100', issuedAt: '2026-08-04T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'Saved', tags: ['known'], updatedAt: '2026-08-04T00:00:00.000Z' }
    })
    await repository.commit('100', {
      id: 'prior-position', accountMid: '100', issuedAt: '2026-08-04T00:00:00.000Z', type: 'set-favorite-placement',
      payload: { aid: 1, localDesiredFolderIds: ['local:music'], remoteObservedPhysicalFolderIds: ['ordinary-old'], remoteObservedLogicalFolderIds: [], updatedAt: '2026-08-04T00:00:00.000Z' }
    })

    const first = createCoordinator(repository, store, { initializeOnOpen: false })
    await first.beginScan('100', 'incremental')
    const firstSnapshot = requireSnapshot(await first.getSnapshot('100'))
    const legacyCommandId = `old-favorite-workspace:source-pending:${firstSnapshot.workspaceId}`
    const beforeLegacyReceipt = await repository.getSnapshot('100')
    await repository.commit('100', {
      id: legacyCommandId, accountMid: '100', issuedAt: '2026-08-04T00:00:00.000Z',
      expectedRevision: beforeLegacyReceipt.revision, type: 'reconcile-scan-lifecycle',
      payload: {
        observationEpoch: firstSnapshot.workspaceId,
        authority: 'incomplete',
        observations: [{ aid: 1, remoteObserved: false }]
      }
    })

    const restarted = createCoordinator(
      new FavoriteRepositoryService({ root, now: () => '2026-08-04T00:00:00.000Z' }),
      new OldFavoriteWorkspaceStore({ root }),
      { initializeOnOpen: false }
    )
    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({
      status: 'scanning', scan: { paused: true }
    })
    await restarted.resumeScan('100')
    const runId = await restarted.getActiveScanRunId('100')

    await expect(restarted.recordScanInventory('100', {
      sourceFolders: [{ id: 'ordinary-new', title: 'New source', itemCount: 1, isBilimiWorkFolder: false }]
    }, runId)).resolves.toBe(true)

    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      positions: { '100:1': { lifecycleState: 'source-pending', sourceAuthority: 'incomplete' } }
    })
  })

  it('recycles prior remote-source videos only after a complete scan proves no source', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-08-04T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })
    await repository.commit('100', {
      id: 'prior-source', accountMid: '100', issuedAt: '2026-08-04T00:00:00.000Z', type: 'commit-local-plan',
      payload: {
        workspaceId: 'saved', folders: [{ id: 'local:music', title: 'Music', kind: 'local', syncState: 'local-only' }],
        memberAidsByFolderId: { 'local:music': [1] },
        videos: [{ aid: 1, title: 'Saved', tags: ['known'], tagEvidence: 'confirmed', updatedAt: '2026-08-04T00:00:00.000Z' }]
      }
    })
    await repository.commit('100', {
      id: 'prior-position', accountMid: '100', issuedAt: '2026-08-04T00:00:00.000Z', type: 'set-favorite-placement',
      payload: { aid: 1, localDesiredFolderIds: ['local:music'], remoteObservedPhysicalFolderIds: ['ordinary-old'], remoteObservedLogicalFolderIds: [], updatedAt: '2026-08-04T00:00:00.000Z' }
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'ordinary-new', title: 'New source', itemCount: 0, isBilimiWorkFolder: false }]
    })
    await coordinator.finishScan('100')

    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      videos: { '1': { title: 'Saved', tags: ['known'] } },
      memberships: { 'local:music': [1] },
      tombstones: { '100:1': { kind: 'recycled', allowRediscovery: true } },
      positions: { '100:1': { lifecycleState: 'recycled', sourceAuthority: 'complete' } }
    })
  })

  it('keeps a locally recorded video protected when its remote work-folder member is absent', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-08-04T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })
    await repository.commit('100', {
      id: 'saved-video', accountMid: '100', issuedAt: '2026-08-04T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'Saved metadata', tags: ['known'], tagEvidence: 'confirmed', updatedAt: '2026-08-04T00:00:00.000Z' }
    })
    await repository.commit('100', {
      id: 'saved-position', accountMid: '100', issuedAt: '2026-08-04T00:00:00.000Z', type: 'set-favorite-placement',
      payload: { aid: 1, localDesiredFolderIds: ['bilimi-logical:music'], remoteObservedPhysicalFolderIds: ['managed-old'], remoteObservedLogicalFolderIds: ['bilimi-logical:music'], updatedAt: '2026-08-04T00:00:00.000Z' }
    })
    await repository.commit('100', {
      id: 'saved-protection', accountMid: '100', issuedAt: '2026-08-04T00:00:00.000Z', type: 'record-organization-protections',
      payload: { records: [{ accountMid: '100', aid: 1, targetFolderIds: ['bilimi-logical:music'], completedAt: '2026-08-04T00:00:00.000Z' }] }
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'ordinary-new', title: 'Ordinary', itemCount: 1, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'ordinary-new', page: 1, hasMore: false,
      items: [{ aid: 1, title: 'Video 1', sourceFolderIds: ['ordinary-new'] }]
    })
    const workspace = await coordinator.finishScan('100')

    expect(workspace.plannedAids).not.toContain(1)
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      videos: { '1': { title: 'Saved metadata', tags: ['known'] } },
      organizationRecords: [{ aid: 1, targetFolderIds: ['bilimi-logical:music'] }]
    })
  })

  it('keeps a local-only saved result protected when a complete scan has no remote source', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-08-04T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })
    await repository.commit('100', {
      id: 'local-only', accountMid: '100', issuedAt: '2026-08-04T00:00:00.000Z', type: 'commit-local-plan',
      payload: {
        workspaceId: 'saved', folders: [{ id: 'local:music', title: 'Music', kind: 'local', syncState: 'local-only' }],
        memberAidsByFolderId: { 'local:music': [1] },
        videos: [{ aid: 1, title: 'Local only', tags: ['known'], updatedAt: '2026-08-04T00:00:00.000Z' }],
        organizationRecords: [{ accountMid: '100', aid: 1, targetFolderIds: ['local:music'], completedAt: '2026-08-04T00:00:00.000Z' }]
      }
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'ordinary', title: 'Ordinary', itemCount: 0, isBilimiWorkFolder: false }]
    })
    await coordinator.finishScan('100')

    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      videos: { '1': { title: 'Local only', tags: ['known'] } },
      organizationRecords: [{ aid: 1, targetFolderIds: ['local:music'] }]
    })
    await expect(repository.getSnapshot('100')).resolves.not.toMatchObject({
      tombstones: { '100:1': expect.objectContaining({ kind: 'recycled' }) }
    })
  })

  it('reprojects pending organization counts when the user changes selected ordinary sources', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [
        { id: 'ordinary-a', title: '默认收藏夹', itemCount: 2, isBilimiWorkFolder: false },
        { id: 'ordinary-b', title: '自建收藏夹', itemCount: 2, isBilimiWorkFolder: false }
      ]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'ordinary-a', page: 1, hasMore: false,
      items: [
        { aid: 1, title: 'Shared', sourceFolderIds: ['ordinary-a', 'ordinary-b'] },
        { aid: 2, title: 'A only', sourceFolderIds: ['ordinary-a'] },
        { aid: 3, title: 'B only', sourceFolderIds: ['ordinary-b'] }
      ]
    })
    await coordinator.finishScan('100')

    await coordinator.selectSourceFolders('100', ['ordinary-a'])

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      inventoryMetrics: {
        plannedAidCount: 2,
        sourceFolders: [
          { id: 'ordinary-a', selected: true, plannedAidCount: 2 },
          { id: 'ordinary-b', selected: false, plannedAidCount: 0 }
        ]
      }
    })
  })

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

  it('removes only scan-confirmed unavailable videos from staging', async () => {
    const root = await createRoot()
    const now = '2026-08-18T00:00:00.000Z'
    const repository = new FavoriteRepositoryService({ root, now: () => now })
    await repository.commit('100', {
      id: 'legacy-staging', accountMid: '100', issuedAt: now, type: 'commit-local-plan',
      payload: {
        workspaceId: 'completed-prior-run',
        videos: [
          { aid: 1, title: '旧失效视频', tags: [], updatedAt: now },
          { aid: 2, title: '有效但未匹配', tags: [], updatedAt: now }
        ],
        memberAidsByFolderId: { 'local:inbox': [1, 2] }
      }
    })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })
    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: '用户收藏夹', itemCount: 2, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1, items: [
        { aid: 1, title: '已失效视频', author: '账号已注销', unavailable: true, sourceFolderIds: ['source'] },
        { aid: 2, title: '有效但未匹配', sourceFolderIds: ['source'] }
      ]
    })

    await coordinator.finishScan('100')

    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      videos: { '1': expect.objectContaining({ unavailable: true }) },
      memberships: {
        'local:inbox': [2],
        'bilibili:source': [1, 2]
      },
      syncRecords: []
    })
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

  it('counts later batches from a legacy current-batch-only tag journal as whole-run pending work', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const coordinator = createCoordinator(repository, store, { initializeOnOpen: false, segmentSize: () => 500 })
    await coordinator.beginScan('100', 'incremental')
    for (let offset = 0; offset < 501; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source', page: offset / 50 + 1,
        items: Array.from({ length: Math.min(50, 501 - offset) }, (_unused, index) => ({
          aid: offset + index + 1, title: `Video ${offset + index + 1}`, sourceFolderIds: ['source']
        }))
      })
    }
    const workspace = await coordinator.finishScan('100')
    await store.appendOverlay('100', workspace.id, {
      currentSegmentId: 'segment-1', classifications: [], history: [],
      tagEnrichment: {
        status: 'paused', totalItemCount: 500, completedItemCount: 1,
        pendingAids: Array.from({ length: 499 }, (_unused, index) => index + 2), failedAids: [], reusedTagItemCount: 0,
        taggedAids: [1], confirmedUntaggedAids: [], acceptedSegmentIds: []
      }
    })

    const restarted = createCoordinator(repository, store, { initializeOnOpen: false })
    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: {
        scopes: {
          currentSegment: { totalItemCount: 500, completedItemCount: 1, pendingItemCount: 499 },
          wholeRun: { totalItemCount: 501, completedItemCount: 1, pendingItemCount: 500, reusedTagItemCount: 0 }
        }
      }
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

  it('seals the first eligible batch before later source pages finish', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const coordinator = createCoordinator(repository, store, {
      initializeOnOpen: false,
      segmentSize: () => 500
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 501, isBilimiWorkFolder: false }]
    })
    for (let offset = 0; offset < 500; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source', page: offset / 50 + 1, hasMore: true,
        items: Array.from({ length: 50 }, (_unused, index) => ({
          aid: offset + index + 1,
          title: `Video ${offset + index + 1}`,
          tags: ['ready'],
          sourceFolderIds: ['source']
        }))
      })
    }

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      status: 'scanning',
      scan: { phase: 'inventory', scannedItemCount: 500 },
      segments: [{ id: 'segment-1', itemCount: 500, readiness: 'tagging' }],
      currentSegment: { id: 'segment-1', aids: Array.from({ length: 500 }, (_unused, index) => index + 1) }
    })
    await expect(store.loadSegment('100', requireSnapshot(await coordinator.getSnapshot('100')).workspaceId, 'segment-1'))
      .resolves.toMatchObject({ id: 'segment-1', aids: Array.from({ length: 500 }, (_unused, index) => index + 1) })
  })

  it('does not let unavailable, protected, or duplicate aids consume streaming batch slots', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    await repository.commit('100', {
      id: 'protected-video', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'commit-local-plan',
      payload: {
        workspaceId: 'prior',
        folders: [{ id: 'local:knowledge', title: 'Knowledge', kind: 'local', syncState: 'local-only' }],
        memberAidsByFolderId: { 'local:knowledge': [2] },
        videos: [{ aid: 2, title: 'Protected', tags: ['saved'], updatedAt: '2026-07-20T00:00:00.000Z' }],
        organizationRecords: [{ accountMid: '100', aid: 2, targetFolderIds: ['local:knowledge'], completedAt: '2026-07-20T00:00:00.000Z' }]
      }
    })
    const store = new OldFavoriteWorkspaceStore({ root })
    const coordinator = createCoordinator(repository, store, { initializeOnOpen: false, segmentSize: () => 500 })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 503, isBilimiWorkFolder: false }]
    })
    const items = [
      { aid: 1, title: '已失效视频', unavailable: true, sourceFolderIds: ['source'] },
      { aid: 2, title: 'Protected', sourceFolderIds: ['source'] },
      { aid: 3, title: 'Duplicate first', tags: ['ready'], sourceFolderIds: ['source'] },
      { aid: 3, title: 'Duplicate second', tags: ['ready'], sourceFolderIds: ['source'] },
      ...Array.from({ length: 499 }, (_unused, index) => ({
        aid: index + 4, title: `Video ${index + 4}`, tags: ['ready'], sourceFolderIds: ['source']
      }))
    ]
    for (let offset = 0; offset < items.length; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source', page: Math.floor(offset / 50) + 1, hasMore: true,
        items: items.slice(offset, offset + 50)
      })
    }

    const snapshot = requireSnapshot(await coordinator.getSnapshot('100'))
    expect(snapshot.segments).toEqual([expect.objectContaining({ id: 'segment-1', itemCount: 500 })])
    expect(snapshot.currentSegment?.aids).toHaveLength(500)
    expect(snapshot.currentSegment?.aids).not.toContain(1)
    expect(snapshot.currentSegment?.aids).not.toContain(2)
    expect(snapshot.currentSegment?.aids.filter((aid) => aid === 3)).toHaveLength(1)
  })

  it('restores sealed streaming assignments and continues filling the next batch without duplication', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(repository, store, { initializeOnOpen: false, segmentSize: () => 500 })
    await first.beginScan('100', 'incremental')
    for (let offset = 0; offset < 520; offset += 50) {
      await first.recordScanPage('100', {
        folderId: 'source', page: Math.floor(offset / 50) + 1, hasMore: true,
        items: Array.from({ length: Math.min(50, 520 - offset) }, (_unused, index) => ({
          aid: offset + index + 1, title: `Video ${offset + index + 1}`, tags: ['ready'], sourceFolderIds: ['source']
        }))
      })
    }

    const restartedStore = new OldFavoriteWorkspaceStore({ root })
    const restarted = createCoordinator(repository, restartedStore, {
      initializeOnOpen: false,
      segmentSize: () => 2_000
    })
    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({
      status: 'scanning', segmentSize: 500, segments: [{ id: 'segment-1', itemCount: 500 }]
    })
    for (let offset = 520; offset < 1_000; offset += 50) {
      await restarted.recordScanPage('100', {
        folderId: 'source', page: Math.floor(offset / 50) + 1, hasMore: true,
        items: Array.from({ length: Math.min(50, 1_000 - offset) }, (_unused, index) => ({
          aid: offset + index + 1, title: `Video ${offset + index + 1}`, tags: ['ready'], sourceFolderIds: ['source']
        }))
      })
    }

    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({
      segments: [{ id: 'segment-1', itemCount: 500 }, { id: 'segment-2', itemCount: 500 }]
    })
    const snapshot = requireSnapshot(await restarted.getSnapshot('100'))
    const second = await store.loadSegment('100', snapshot.workspaceId, 'segment-2')
    expect(second.aids).toEqual(Array.from({ length: 500 }, (_unused, index) => index + 501))
    expect((await restartedStore.readWorkspaceReads('100', snapshot.workspaceId))
      .some((file) => file.startsWith('scan/pages/'))).toBe(false)
  })

  it('keeps a late duplicate in its original streaming batch and merges the extra source relation', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const coordinator = createCoordinator(repository, store, { initializeOnOpen: false, segmentSize: () => 500 })
    await coordinator.beginScan('100', 'incremental')
    for (let offset = 0; offset < 500; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source-a', page: offset / 50 + 1, hasMore: true,
        items: Array.from({ length: 50 }, (_unused, index) => ({
          aid: offset + index + 1, title: `Video ${offset + index + 1}`,
          ...(offset + index > 0 ? { tags: ['ready'] } : {}),
          sourceFolderIds: ['source-a']
        }))
      })
    }
    await coordinator.recordScanPage('100', {
      folderId: 'source-b', page: 1, hasMore: false,
      items: [{
        aid: 1, title: 'Conflicting title', author: 'Late author', description: 'Late description',
        tags: ['late-tag'], category: 'late-category', cover: 'late-cover', sourceFolderIds: ['source-b']
      }]
    })
    await coordinator.finishScan('100')

    const snapshot = requireSnapshot(await coordinator.getSnapshot('100'))
    expect(snapshot.segments).toHaveLength(1)
    const firstItem = snapshot.currentSegment?.items.find((item) => item.aid === 1)
    expect(firstItem).toMatchObject({ title: 'Video 1', sourceFolderIds: ['source-a', 'source-b'] })
    expect(firstItem?.author).toBeUndefined()
    expect(firstItem?.description).toBeUndefined()
    expect(firstItem?.tags).toBeUndefined()
    expect(firstItem?.category).toBeUndefined()
    expect(firstItem?.cover).toBeUndefined()
  })

  it('seals the final incomplete streaming batch only when the inventory finishes', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false,
      segmentSize: () => 500,
      classifyCurrentItems: (items) => items.map(() => ({ targetLedgerIds: ['knowledge'], confidence: 'high' as const }))
    })
    await coordinator.beginScan('100', 'incremental')
    for (let offset = 0; offset < 499; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source', page: Math.floor(offset / 50) + 1, hasMore: true,
        items: Array.from({ length: Math.min(50, 499 - offset) }, (_unused, index) => ({
          aid: offset + index + 1, title: `Video ${offset + index + 1}`, tags: ['ready'], sourceFolderIds: ['source']
        }))
      })
    }

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({ status: 'scanning', segments: [] })
    await coordinator.finishScan('100')
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      status: 'previewing', segments: [{ id: 'segment-1', itemCount: 499 }]
    })
  })

  it('keeps the final incomplete streaming batch open when the scan fails', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const coordinator = createCoordinator(repository, store, { initializeOnOpen: false, segmentSize: () => 500 })
    const started = await coordinator.beginScan('100', 'incremental')
    for (let offset = 0; offset < 499; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source', page: Math.floor(offset / 50) + 1, hasMore: true,
        items: Array.from({ length: Math.min(50, 499 - offset) }, (_unused, index) => ({
          aid: offset + index + 1, title: `Video ${offset + index + 1}`, tags: ['ready'], sourceFolderIds: ['source']
        }))
      })
    }

    await coordinator.recordScanFailure('100', 'target-unavailable')

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      status: 'scanning', scan: { phase: 'failed' }, segments: []
    })
    await expect(store.recover('100', started.workspaceId)).resolves.toMatchObject({
      streamingScan: { sealedSegments: [], openAids: expect.arrayContaining([1, 499]) }
    })
  })

  it('retries a page checkpoint from the last durable streaming state', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const coordinator = createCoordinator(repository, store, { initializeOnOpen: false, segmentSize: () => 500 })
    await coordinator.beginScan('100', 'incremental')
    for (let offset = 0; offset < 450; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source', page: offset / 50 + 1, hasMore: true,
        items: Array.from({ length: 50 }, (_unused, index) => ({
          aid: offset + index + 1, title: `Video ${offset + index + 1}`, sourceFolderIds: ['source']
        }))
      })
    }
    vi.spyOn(store, 'checkpointStreamingScan').mockRejectedValueOnce(new Error('checkpoint-failed'))
    const finalPage = {
      folderId: 'source', page: 10, hasMore: true,
      items: Array.from({ length: 50 }, (_unused, index) => ({
        aid: 451 + index, title: `Video ${451 + index}`, sourceFolderIds: ['source']
      }))
    }

    await expect(coordinator.recordScanPage('100', finalPage)).rejects.toThrow('checkpoint-failed')
    await expect(coordinator.recordScanPage('100', finalPage)).resolves.toEqual({ sealedSegmentIds: ['segment-1'] })
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      status: 'scanning', segments: [{ id: 'segment-1', itemCount: 500 }]
    })
  })

  it('does not publish a sealed batch before its tag-pending checkpoint is durable', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const coordinator = createCoordinator(repository, store, { initializeOnOpen: false, segmentSize: () => 500 })
    await coordinator.beginScan('100', 'incremental')
    for (let offset = 0; offset < 450; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source', page: offset / 50 + 1, hasMore: true,
        items: Array.from({ length: 50 }, (_unused, index) => ({
          aid: offset + index + 1, title: `Video ${offset + index + 1}`, sourceFolderIds: ['source']
        }))
      })
    }
    vi.spyOn(store, 'appendOverlay').mockRejectedValueOnce(new Error('tag-checkpoint-failed'))

    await expect(coordinator.recordScanPage('100', {
      folderId: 'source', page: 10, hasMore: true,
      items: Array.from({ length: 50 }, (_unused, index) => ({
        aid: 451 + index, title: `Video ${451 + index}`, sourceFolderIds: ['source']
      }))
    })).rejects.toThrow('tag-checkpoint-failed')

    const restarted = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })
    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({ status: 'scanning', segments: [] })
    await expect(restarted.getScanResumeState('100')).resolves.toMatchObject({
      completedPages: expect.not.arrayContaining([expect.objectContaining({ page: 10 })])
    })
  })

  it('retries a sealed page idempotently after its tag-pending checkpoint survives a restart', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const coordinator = createCoordinator(repository, store, { initializeOnOpen: false, segmentSize: () => 500 })
    await coordinator.beginScan('100', 'incremental')
    for (let offset = 0; offset < 450; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source', page: offset / 50 + 1, hasMore: true,
        items: Array.from({ length: 50 }, (_unused, index) => ({
          aid: offset + index + 1, title: `Video ${offset + index + 1}`, sourceFolderIds: ['source']
        }))
      })
    }
    const finalPage = {
      folderId: 'source', page: 10, hasMore: true,
      items: Array.from({ length: 50 }, (_unused, index) => ({
        aid: 451 + index, title: `Video ${451 + index}`, sourceFolderIds: ['source']
      }))
    }
    vi.spyOn(store, 'checkpointStreamingScan').mockRejectedValueOnce(new Error('page-checkpoint-failed'))

    await expect(coordinator.recordScanPage('100', finalPage)).rejects.toThrow('page-checkpoint-failed')

    const restarted = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })
    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({
      status: 'scanning',
      segments: [],
      tagEnrichment: { totalItemCount: 500, pendingItemCount: 500 }
    })
    await expect(restarted.recordScanPage('100', finalPage)).resolves.toEqual({ sealedSegmentIds: ['segment-1'] })
    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({
      status: 'scanning',
      segments: [{ id: 'segment-1', itemCount: 500 }],
      tagEnrichment: { totalItemCount: 500, pendingItemCount: 500 }
    })
    await expect(restarted.getScanResumeState('100')).resolves.toMatchObject({
      completedPages: expect.arrayContaining([expect.objectContaining({ page: 10 })])
    })
  })

  it('does not save or start whole-run execution before the inventory scan completes', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false, segmentSize: () => 500
    })
    await coordinator.beginScan('100', 'incremental')
    for (let offset = 0; offset < 500; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source', page: offset / 50 + 1, hasMore: true,
        items: Array.from({ length: 50 }, (_unused, index) => ({
          aid: offset + index + 1, title: `Video ${offset + index + 1}`, tags: ['ready'], sourceFolderIds: ['source']
        }))
      })
    }
    const revisionBefore = (await repository.getSnapshot('100')).revision

    await expect(coordinator.setExecutionIntent('100', 'bilibili')).rejects.toThrow('not ready for confirmation')
    await expect(coordinator.saveWholeRunToLocalLibrary('100')).rejects.toThrow('not ready for local saving')
    await expect(coordinator.beginBilibiliExecution('100')).rejects.toThrow('not ready for local saving')
    expect((await repository.getSnapshot('100')).revision).toBe(revisionBefore)
  })

  it('recovers a legacy scanning draft by replaying its staged page payloads', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(repository, store, { initializeOnOpen: false })
    const started = await first.beginScan('100', 'incremental')
    const runId = await first.getActiveScanRunId('100')
    await store.appendScanPage('100', started.workspaceId, {
      runId: runId!, folderId: 'source', page: 1, hasMore: false,
      items: [{ aid: 1, title: 'Legacy', tags: ['kept'], sourceFolderIds: ['source'] }]
    })
    const manifestPath = join(root, 'accounts', '100', 'workspaces', started.workspaceId, 'manifest.json')
    const { readFile } = await import('node:fs/promises')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
    delete manifest.streamingScan
    const { checksum: _checksum, ...withoutChecksum } = manifest
    const { createHash } = await import('node:crypto')
    manifest.checksum = createHash('sha256').update(JSON.stringify(withoutChecksum)).digest('hex')
    await writeFile(manifestPath, JSON.stringify(manifest), 'utf8')

    const restartedStore = new OldFavoriteWorkspaceStore({ root })
    const legacyPageRead = vi.spyOn(restartedStore, 'readScanPages')
    const restarted = createCoordinator(repository, restartedStore, { initializeOnOpen: false })
    await expect(restarted.getScanResumeState('100')).resolves.toEqual({
      runId, completedPages: [{ folderId: 'source', page: 1, hasMore: false }], taggedAids: [1]
    })
    expect(legacyPageRead).toHaveBeenCalledExactlyOnceWith('100', started.workspaceId)
  })

  it('reports tag readiness independently so an earlier batch can be organized first', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false,
      segmentSize: () => 500,
      classifyCurrentItems: (items) => items.map(() => ({ targetLedgerIds: ['knowledge'], confidence: 'high' as const }))
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 501, isBilimiWorkFolder: false, selected: true }]
    })
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
        { id: 'segment-2', readiness: 'waiting', pendingTagItemCount: 1 }
      ],
      overview: { waitingTagItemCount: 1, waitingItemCount: 1, processedItemCount: 0 }
    })
    await coordinator.recordTagEnrichment('100', 1, ['新标签'], workspaceId)
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      segments: [
        { id: 'segment-1', readiness: 'ready', pendingTagItemCount: 0 },
        { id: 'segment-2', readiness: 'tagging', pendingTagItemCount: 1 }
      ],
      overview: { waitingTagItemCount: 1, waitingItemCount: 0, processedItemCount: 500 }
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

  it('clears a fully successful DeepSeek checkpoint instead of projecting it as running', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })
    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [{ aid: 1, title: 'Ready', tags: ['existing'], sourceFolderIds: ['source'] }]
    })
    await coordinator.finishScan('100')
    const workspaceId = requireSnapshot(await coordinator.getSnapshot('100')).workspaceId

    await coordinator.setDeepSeekRunCheckpoint('100', {
      version: 1, workspaceId, mode: 'all', scope: 'all', sourceFolderRevision: 'source',
      segmentWork: [{ segmentId: 'segment-1', index: 0, aids: [1] }],
      requestGroups: [{ id: 'group-1', segmentId: 'segment-1', aids: [1], status: 'successful', timeoutCount: 0 }],
      originalTargetLedgerIdsByAid: { '1': [] }, totalVideoCount: 1,
      successfulAids: [1], pendingAids: [], failedAids: [], completedSegmentIds: [], waitingSegmentIds: [], canceled: false
    })

    await expect(coordinator.getDeepSeekRunCheckpoint('100')).resolves.toBeNull()
    await expect(coordinator.getSnapshot('100')).resolves.not.toHaveProperty('deepSeekRun')
  })

  it('projects a recovered paused DeepSeek checkpoint as non-running and does not keep execution waiting', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })
    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [{ aid: 1, title: 'Ready', tags: ['existing'], sourceFolderIds: ['source'] }]
    })
    await coordinator.finishScan('100')
    const workspaceId = requireSnapshot(await coordinator.getSnapshot('100')).workspaceId

    await coordinator.setDeepSeekRunCheckpoint('100', {
      workspaceId, mode: 'all', scope: 'all', completedSegmentIds: [],
      waitingSegmentIds: [], canceled: false, paused: true
    })
    await coordinator.setExecutionIntent('100', 'local')

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      deepSeekRun: { status: 'paused' },
      executionIntent: { mode: 'local', status: 'waiting', waitingForDeepSeek: false }
    })
  })

  it('recalculates a restored DeepSeek checkpoint from ready batches only', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false,
      segmentSize: () => 500
    })
    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 501, isBilimiWorkFolder: false, selected: true }]
    })
    const scanItems = Array.from({ length: 501 }, (_unused, index) => ({
      aid: index + 1,
      title: index === 500 ? 'Waiting' : `Ready ${index + 1}`,
      ...(index < 500 ? { tags: ['ready'] } : {}),
      sourceFolderIds: ['source']
    }))
    for (let offset = 0; offset < scanItems.length; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source', page: offset / 50 + 1,
        items: scanItems.slice(offset, offset + 50)
      })
    }
    await coordinator.finishScan('100')
    const snapshot = requireSnapshot(await coordinator.getSnapshot('100'))
    await coordinator.setDeepSeekRunCheckpoint('100', {
      version: 1,
      workspaceId: snapshot.workspaceId,
      mode: 'all', scope: 'all', sourceFolderRevision: 'source',
      segmentWork: [
        { segmentId: 'segment-1', index: 0, aids: Array.from({ length: 500 }, (_unused, index) => index + 1) },
        { segmentId: 'segment-2', index: 1, aids: [501] }
      ],
      requestGroups: [
        { id: 'group-1', segmentId: 'segment-1', aids: Array.from({ length: 500 }, (_unused, index) => index + 1), status: 'pending', timeoutCount: 0 },
        { id: 'group-2', segmentId: 'segment-2', aids: [501], status: 'pending', timeoutCount: 0 }
      ],
      originalTargetLedgerIdsByAid: Object.fromEntries(Array.from({ length: 501 }, (_unused, index) => [String(index + 1), []])),
      totalVideoCount: 501, successfulAids: [], pendingAids: Array.from({ length: 501 }, (_unused, index) => index + 1), failedAids: [],
      completedSegmentIds: [], waitingSegmentIds: [], canceled: false
    })

    await expect(coordinator.getDeepSeekRunCheckpoint('100')).resolves.toMatchObject({
      totalVideoCount: 500,
      segmentWork: [{ aids: Array.from({ length: 500 }, (_unused, index) => index + 1) }],
      requestGroups: [{ aids: Array.from({ length: 500 }, (_unused, index) => index + 1) }],
      pendingAids: Array.from({ length: 500 }, (_unused, index) => index + 1)
    })
  })

  it('projects DeepSeek candidate counts from the authoritative per-batch work plan', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false,
      segmentSize: () => 500
    })
    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 501, isBilimiWorkFolder: false, selected: true }]
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
    const snapshot = requireSnapshot(await coordinator.getSnapshot('100'))
    await coordinator.setDeepSeekRunCheckpoint('100', {
      version: 1, workspaceId: snapshot.workspaceId, mode: 'unclassified-only', scope: 'all', sourceFolderRevision: 'source',
      segmentWork: [
        { segmentId: 'segment-1', index: 0, aids: [1, 2] },
        // Legacy/corrupted journals may duplicate an AID across batches. The
        // snapshot must keep one stable first-batch attribution so its per-
        // batch candidates agree with the whole-run unique candidate count.
        { segmentId: 'segment-2', index: 1, aids: [2, 501] }
      ],
      requestGroups: [], originalTargetLedgerIdsByAid: { '1': [], '2': [], '501': [] }, totalVideoCount: 3,
      successfulAids: [], pendingAids: [1, 2, 501], failedAids: [], completedSegmentIds: [], waitingSegmentIds: [], canceled: false
    })

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      deepSeekRun: {
        mode: 'unclassified-only', scope: 'all', totalVideoCount: 3,
        candidateVideoCountBySegment: { 'segment-1': 2, 'segment-2': 1 }
      }
    })
  })

  it('normalizes a legacy DeepSeek checkpoint during direct restart recovery', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root })
    const store = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(repository, store, { initializeOnOpen: false, segmentSize: () => 500 })
    await first.beginScan('100', 'full')
    await first.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 501, isBilimiWorkFolder: false, selected: true }]
    })
    const items = Array.from({ length: 501 }, (_unused, index) => ({
      aid: index + 1, title: `Video ${index + 1}`,
      ...(index < 500 ? { tags: ['ready'] } : {}), sourceFolderIds: ['source']
    }))
    for (let offset = 0; offset < items.length; offset += 50) {
      await first.recordScanPage('100', { folderId: 'source', page: offset / 50 + 1, items: items.slice(offset, offset + 50) })
    }
    await first.finishScan('100')
    const snapshot = requireSnapshot(await first.getSnapshot('100'))
    await store.appendOverlay('100', snapshot.workspaceId, {
      currentSegmentId: 'segment-1', classifications: [], history: [],
      deepSeekRunCheckpoint: {
        version: 1, workspaceId: snapshot.workspaceId, mode: 'all', scope: 'all',
        segmentWork: [
          { segmentId: 'segment-1', index: 0, aids: Array.from({ length: 500 }, (_unused, index) => index + 1) },
          { segmentId: 'segment-2', index: 1, aids: [501] }
        ],
        requestGroups: [
          { id: 'g1', segmentId: 'segment-1', aids: Array.from({ length: 500 }, (_unused, index) => index + 1), status: 'pending', timeoutCount: 0 },
          { id: 'g2', segmentId: 'segment-2', aids: [501], status: 'pending', timeoutCount: 0 }
        ],
        totalVideoCount: 501,
        pendingAids: Array.from({ length: 501 }, (_unused, index) => index + 1),
        successfulAids: [501], failedAids: [], completedSegmentIds: ['segment-2'], waitingSegmentIds: [], canceled: false
      }
    })
    const restarted = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false, segmentSize: () => 500 })
    await expect(restarted.getDeepSeekRunCheckpoint('100')).resolves.toMatchObject({
      totalVideoCount: 500,
      segmentWork: [{ segmentId: 'segment-1' }],
      requestGroups: [{ segmentId: 'segment-1' }],
      pendingAids: Array.from({ length: 500 }, (_unused, index) => index + 1),
      successfulAids: []
    })
  })

  it('keeps non-contiguous unloaded segment aids waiting instead of assigning them by numeric range', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false,
      segmentSize: () => 500,
      classifyCurrentItems: (items) => items.map(() => ({ targetLedgerIds: ['knowledge'], confidence: 'high' as const }))
    })
    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1_000, isBilimiWorkFolder: false, selected: true }]
    })
    const items = [
      ...Array.from({ length: 499 }, (_unused, index) => ({ aid: index + 1, title: `First ${index + 1}`, tags: ['ready'], sourceFolderIds: ['source'] })),
      { aid: 10_000, title: 'First 10000', tags: ['ready'], sourceFolderIds: ['source'] },
      { aid: 500, title: 'Second 500', sourceFolderIds: ['source'] },
      ...Array.from({ length: 499 }, (_unused, index) => ({ aid: index + 10_001, title: `Second ${index + 10_001}`, sourceFolderIds: ['source'] }))
    ]
    for (let offset = 0; offset < items.length; offset += 50) {
      await coordinator.recordScanPage('100', { folderId: 'source', page: offset / 50 + 1, items: items.slice(offset, offset + 50) })
    }
    await coordinator.finishScan('100')
    await coordinator.autoClassifyCurrentSegment('100')

    const snapshot = requireSnapshot(await coordinator.getSnapshot('100'))
    expect(snapshot.segments).toEqual([
      expect.objectContaining({ id: 'segment-1', readiness: 'ready', pendingTagItemCount: 0 }),
      expect.objectContaining({ id: 'segment-2', readiness: 'tagging', pendingTagItemCount: 500 })
    ])
    expect(snapshot.overview).toMatchObject({ processedItemCount: 500, waitingTagItemCount: 500, waitingItemCount: 0, unmatchedItemCount: 0 })
  })

  it('restores exact waiting membership for a legacy descending batch without counting it as processed or inbox', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root })
    const store = new OldFavoriteWorkspaceStore({ root })
    const options = {
      initializeOnOpen: false,
      segmentSize: () => 500,
      classifyCurrentItems: (items: Array<{ aid: number }>) => items.map(() => ({
        targetLedgerIds: ['knowledge'], confidence: 'high' as const
      }))
    }
    const coordinator = createCoordinator(repository, store, options)
    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1_000, isBilimiWorkFolder: false, selected: true }]
    })
    const first = Array.from({ length: 500 }, (_unused, index) => ({
      aid: index + 1, title: `Ready ${index + 1}`, tags: ['ready'], sourceFolderIds: ['source']
    }))
    const second = Array.from({ length: 500 }, (_unused, index) => ({
      aid: 20_000 - index, title: `Waiting ${index + 1}`, sourceFolderIds: ['source']
    }))
    const items = [...first, ...second]
    for (let offset = 0; offset < items.length; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source', page: offset / 50 + 1, items: items.slice(offset, offset + 50)
      })
    }
    await coordinator.finishScan('100')
    await coordinator.autoClassifyCurrentSegment('100')
    const beforeRestart = requireSnapshot(await coordinator.getSnapshot('100'))
    await store.appendOverlay('100', beforeRestart.workspaceId, {
      currentSegmentId: 'segment-1', classifications: [], history: [],
      overview: {
        segments: [
          { id: 'segment-1', firstAid: 1, lastAid: 500, sourceFolderCounts: { source: 500 }, selectedItemCount: 500 },
          { id: 'segment-2', firstAid: 20_000, lastAid: 19_501, sourceFolderCounts: { source: 500 }, selectedItemCount: 500 }
        ],
        unavailableItemCount: 0
      }
    })

    const restarted = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), options)
    const restored = requireSnapshot(await restarted.getSnapshot('100'))

    expect(restored.segments).toEqual([
      expect.objectContaining({ id: 'segment-1', readiness: 'ready', pendingTagItemCount: 0 }),
      expect.objectContaining({ id: 'segment-2', readiness: 'tagging', pendingTagItemCount: 500 })
    ])
    expect(restored.overview).toMatchObject({
      processedItemCount: 500,
      classifiedItemCount: 500,
      unmatchedItemCount: 0,
      waitingTagItemCount: 500,
      waitingItemCount: 0,
      archiveTargets: [{ ledgerId: 'knowledge', itemCount: 500, segmentCounts: [{ segmentId: 'segment-1', count: 500 }] }]
    })
  })

  it('projects a DeepSeek checkpoint as running when a ready batch can run while another batch waits for tags', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false,
      segmentSize: () => 500
    })
    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1_000, isBilimiWorkFolder: false, selected: true }]
    })
    const items = [
      ...Array.from({ length: 499 }, (_unused, index) => ({ aid: index + 1, title: `First ${index + 1}`, tags: ['ready'], sourceFolderIds: ['source'] })),
      { aid: 10_000, title: 'First 10000', tags: ['ready'], sourceFolderIds: ['source'] },
      { aid: 500, title: 'Second 500', sourceFolderIds: ['source'] },
      ...Array.from({ length: 499 }, (_unused, index) => ({ aid: index + 10_001, title: `Second ${index + 10_001}`, sourceFolderIds: ['source'] }))
    ]
    for (let offset = 0; offset < items.length; offset += 50) {
      await coordinator.recordScanPage('100', { folderId: 'source', page: offset / 50 + 1, items: items.slice(offset, offset + 50) })
    }
    await coordinator.finishScan('100')
    const workspace = requireSnapshot(await coordinator.getSnapshot('100'))

    await coordinator.setDeepSeekRunCheckpoint('100', {
      workspaceId: workspace.workspaceId,
      mode: 'all', scope: 'all',
      completedSegmentIds: [],
      waitingSegmentIds: ['segment-2'],
      canceled: false,
      version: 1,
      sourceFolderRevision: 'source',
      segmentWork: [
        { segmentId: 'segment-1', index: 0, aids: Array.from({ length: 499 }, (_unused, index) => index + 1).concat(10_000) },
        { segmentId: 'segment-2', index: 1, aids: [500, ...Array.from({ length: 499 }, (_unused, index) => index + 10_001)] }
      ],
      totalVideoCount: 2,
      originalTargetLedgerIdsByAid: {},
      requestGroups: [],
      successfulAids: [], pendingAids: [], failedAids: []
    })

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      deepSeekRun: { status: 'running', waitingSegmentCount: 1 }
    })
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
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      status: 'previewing', segments: [{ readiness: 'saved' }, { readiness: 'saved' }]
    })
    expect(requireSnapshot(await coordinator.getSnapshot('100')).executionIntent).toBeUndefined()
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({ workspace: { status: 'previewing' } })
  })

  it('restores a saved whole-run draft without reviving its execution intent', async () => {
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

    expect(restored).toMatchObject({ status: 'previewing', segments: [{ readiness: 'saved' }, { readiness: 'saved' }] })
    expect(restored.executionIntent).toBeUndefined()
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      memberships: { 'bilimi-logical:knowledge': Array.from({ length: 501 }, (_unused, index) => index + 1) },
      workspace: { status: 'previewing' }
    })
  })

  it('continues a recovered multi-batch local save after its own first-batch repository commit', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const coordinator = createCoordinator(repository, store, {
      initializeOnOpen: false, segmentSize: () => 500,
      classifyCurrentItems: (items) => items.map(() => ({ targetLedgerIds: ['knowledge'], confidence: 'high' as const }))
    })
    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 501, isBilimiWorkFolder: false }]
    })
    const items = Array.from({ length: 501 }, (_unused, index) => index + 1)
      .map((aid) => ({ aid, title: `Video ${aid}`, tags: ['ready'], sourceFolderIds: ['source'] }))
    for (let offset = 0; offset < items.length; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source', page: Math.floor(offset / 50) + 1, items: items.slice(offset, offset + 50)
      })
    }
    await coordinator.finishScan('100')
    const summary = await coordinator.getRecoverySummary('100')
    if (!summary) throw new Error('missing recovery summary')
    await coordinator.selectRecoveryDecision('100', {
      workspaceId: summary.workspaceId,
      choice: 'continue-original',
      expectedBaselineRevision: summary.baselineChangeEvidence.workspaceBaselineRevision,
      expectedRepositoryRevision: summary.baselineChangeEvidence.repositoryRevision
    })
    await coordinator.setExecutionIntent('100', 'local')

    await expect(coordinator.continueExecutionIntent('100')).resolves.toBe(true)
    const saved = requireSnapshot(await coordinator.getSnapshot('100'))
    expect(saved).toMatchObject({ status: 'previewing', segments: [{ readiness: 'saved' }, { readiness: 'saved' }] })
    expect(saved.executionIntent).toBeUndefined()
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      memberships: { 'bilimi-logical:knowledge': Array.from({ length: 501 }, (_unused, index) => index + 1) },
      workspace: { status: 'previewing' }
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

  it('does not treat a canceled DeepSeek checkpoint as a whole-run execution blocker', async () => {
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
    await coordinator.setExecutionIntent('100', 'local')

    await expect(coordinator.continueExecutionIntent('100')).resolves.toBe(true)
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      deepSeekRun: { status: 'canceled' }
    })
    expect(requireSnapshot(await coordinator.getSnapshot('100')).executionIntent).toBeUndefined()

    const restarted = createCoordinator(repository, store, { initializeOnOpen: false, segmentSize: () => 500 })
    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({
      deepSeekRun: { status: 'canceled' }
    })
  })

  it('persists the Bilibili binding failure reason instead of marking it as a DeepSeek failure', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.setExecutionIntent('100', 'bilibili')
    vi.spyOn(coordinator, 'beginBilibiliExecution').mockRejectedValue(
      new Error('Favorite repository remote shard is absent from inventory.')
    )

    await expect(coordinator.continueExecutionIntent('100')).rejects.toThrow('remote shard is absent')
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      executionIntent: {
        mode: 'bilibili', status: 'blocked', failureCode: 'saved-binding-absent'
      }
    })
  })

  it('persists an unbound Bilibili target as a rebinding failure', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.setExecutionIntent('100', 'bilibili')
    vi.spyOn(coordinator, 'beginBilibiliExecution').mockRejectedValue(
      new Error('Old favorite workspace cannot freeze: remote-target-unbound:music')
    )

    await expect(coordinator.continueExecutionIntent('100')).rejects.toThrow('remote-target-unbound')
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      executionIntent: {
        mode: 'bilibili', status: 'blocked', failureCode: 'binding-requires-rebind'
      }
    })
  })

  it('publishes a compact whole-run overview before the first batch is ready and restores it after restart', async () => {
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
      overview: {
        available: true,
        completedSegmentCount: 0,
        totalSegmentCount: 2,
        processedItemCount: 0,
        waitingTagItemCount: 1,
        waitingItemCount: 1
      }
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

  it('keeps unscanned inventory separate from tag and DeepSeek pending counts', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false, segmentSize: () => 500,
      classifyCurrentItems: (items) => items.map(() => ({ targetLedgerIds: ['knowledge'], confidence: 'high' as const }))
    })
    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 504, isBilimiWorkFolder: false, selected: true }]
    })
    for (let offset = 0; offset < 500; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source', page: offset / 50 + 1,
        items: Array.from({ length: 50 }, (_unused, index) => ({
          aid: offset + index + 1, title: `Ready ${offset + index + 1}`, tags: ['ready'], sourceFolderIds: ['source']
        }))
      })
    }
    const snapshot = requireSnapshot(await coordinator.getSnapshot('100'))
    expect(snapshot.overview).toMatchObject({
      processedItemCount: 0,
      waitingTagItemCount: 500,
      deepSeekPendingItemCount: 0
    })
    expect(snapshot.overview).not.toHaveProperty('unscannedItemCount')
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
      waitingTagItemCount: 1,
      waitingItemCount: 0,
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

  it('keeps the authoritative archive projection in sync after a manual classification', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-08-27T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false,
      classifyCurrentItems: (items) => items.map(() => ({ targetLedgerIds: [], confidence: 'low' as const }))
    })
    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false, selected: true }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [{ aid: 1, title: 'Video', tags: ['ready'], sourceFolderIds: ['source'] }]
    })
    await coordinator.finishScan('100')

    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })

    const runtime = (coordinator as unknown as {
      overviewRuntimes: Map<string, { classificationsBySegment: Map<string, Map<number, { targetLedgerIds: string[] }>> }>
    }).overviewRuntimes.get('100')
    expect(runtime?.classificationsBySegment.get('segment-1')?.get(1)).toEqual(
      expect.objectContaining({ aid: 1, targetLedgerIds: ['music'] })
    )
  })

  it('publishes high-frequency tag recommendations only when the current batch completes', async () => {
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
    const beforeCurrentBatchCompletes = requireSnapshot(await coordinator.getSnapshot('100'))
    expect(beforeCurrentBatchCompletes.tagEnrichment).toMatchObject({ status: 'running', pendingItemCount: 2 })
    expect(beforeCurrentBatchCompletes.recommendations.candidates).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'custom-tag-typescript' })
    ]))

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

  it('rebuilds recommendations immediately when the current batch accepts known tags', async () => {
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
          title: offset + index < 3 ? 'Tagged after accept' : offset + index === 3 ? 'Still pending' : `Video ${offset + index + 1}`,
          ...((offset + index >= 4 && offset + index < 500) ? { tags: ['Existing'] } : {}),
          sourceFolderIds: ['source']
        }))
      })
    }
    await coordinator.finishScan('100')
    const workspaceId = (await coordinator.getSnapshot('100') as { workspaceId: string }).workspaceId

    await coordinator.recordTagEnrichment('100', 1, ['Focus'], workspaceId)
    await coordinator.recordTagEnrichment('100', 2, ['Focus'], workspaceId)
    await coordinator.recordTagEnrichment('100', 3, ['Focus'], workspaceId)
    await coordinator.acceptCurrentTags('100')

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: { status: 'accepted', pendingItemCount: 2 },
      recommendations: {
        candidates: expect.arrayContaining([
          expect.objectContaining({ id: 'custom-tag-focus', kind: 'tag', count: 3 })
        ])
      }
    })

    await coordinator.setRecommendedCandidates('100', ['custom-tag-focus'])
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      recommendations: { adoptedCandidateIds: ['custom-tag-focus'] }
    })
  })

  it('refreshes the round overview when a non-current batch becomes ready', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false,
      segmentSize: () => 500
    })
    await coordinator.beginScan('100', 'incremental')
    for (let offset = 0; offset < 503; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source', page: offset / 50 + 1,
        items: Array.from({ length: Math.min(50, 503 - offset) }, (_unused, index) => ({
          aid: offset + index + 1,
          title: offset + index >= 500 ? 'Later batch' : `Already tagged ${offset + index + 1}`,
          ...(offset + index >= 500 ? {} : { tags: ['Existing'] }),
          sourceFolderIds: ['source']
        }))
      })
    }
    await coordinator.finishScan('100')
    const workspaceId = (await coordinator.getSnapshot('100') as { workspaceId: string }).workspaceId

    await coordinator.recordTagEnrichment('100', 501, ['Focus'], workspaceId)
    await coordinator.recordTagEnrichment('100', 502, ['Focus'], workspaceId)
    await coordinator.recordTagEnrichment('100', 503, ['Focus'], workspaceId)

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      segments: [
        { id: 'segment-1', readiness: 'ready' },
        { id: 'segment-2', readiness: 'ready' }
      ],
      overview: {
        recommendationCounts: expect.arrayContaining([
          expect.objectContaining({ id: 'custom-tag-focus', count: 3 })
        ])
      }
    })
  })

  it('does not publish a high-frequency tag recommendation while the current batch is still enriching', async () => {
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

    const snapshot = requireSnapshot(await coordinator.getSnapshot('100'))
    expect(snapshot.tagEnrichment).toMatchObject({ status: 'running', pendingItemCount: 2 })
    expect(snapshot.recommendations.candidates).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'custom-tag-typescript' })
    ]))
    expect(classifyCurrentItem).not.toHaveBeenCalled()
    expect(loadSegment).not.toHaveBeenCalled()
  })

  it('does not restore unpublished tag recommendations from the compact tag journal before the batch completes', async () => {
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

    const snapshot = requireSnapshot(await restarted.getSnapshot('100'))
    expect(snapshot.tagEnrichment).toMatchObject({ status: 'paused', pendingItemCount: 1 })
    expect(snapshot.recommendations.candidates).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'custom-tag-typescript' })
    ]))
    expect(loadSegment).not.toHaveBeenCalled()
  })

  it('rejects direct recommendation, classification, and local-save mutations while the current batch is tagging', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [{ aid: 1, title: 'Pending', sourceFolderIds: ['source'] }]
    })
    await coordinator.finishScan('100')

    await expect(coordinator.setRecommendedCandidates('100', [])).rejects.toThrow('current batch tag enrichment is not complete')
    await expect(coordinator.prepareRecommendationPreview('100', [])).rejects.toThrow('current batch tag enrichment is not complete')
    await expect(coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['knowledge'] }]
    })).rejects.toThrow('current batch tag enrichment is not complete')
    await expect(coordinator.saveCurrentSegmentToLocalLibrary('100')).rejects.toThrow('current batch tag enrichment is not complete')
  })

  it('saves the complete scanned range after accepting the current tag cutoff', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const classifyCurrentItem = vi.fn().mockImplementation((item: { aid: number }) => item.aid === 1
      ? { targetLedgerIds: ['knowledge'], confidence: 'high' as const }
      : { targetLedgerIds: [], confidence: 'low' as const })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false,
      segmentSize: () => 500,
      classifyCurrentItem
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 501, isBilimiWorkFolder: false, selected: true }]
    })
    for (let offset = 0; offset < 501; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source', page: offset / 50 + 1,
        items: Array.from({ length: Math.min(50, 501 - offset) }, (_unused, index) => {
          const aid = offset + index + 1
          return {
            aid,
            title: aid === 1 ? 'Ready' : 'Pending',
            ...(aid <= 500 ? { tags: ['TypeScript'] } : {}),
            sourceFolderIds: ['source']
          }
        })
      })
    }
    await coordinator.finishScan('100')
    await expect(coordinator.saveWholeRunToLocalLibrary('100')).rejects.toThrow(
      'Old favorite workspace whole-run tag enrichment is not complete.'
    )
    await coordinator.acceptCurrentTags('100')
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: { status: 'accepted', pendingItemCount: 1 },
      segments: [
        { id: 'segment-1', readiness: 'ready' },
        { id: 'segment-2', readiness: 'ready', pendingTagItemCount: 1 }
      ],
      overview: {
        completedSegmentCount: 2,
        processedItemCount: 501,
        archiveTargets: expect.arrayContaining([
          expect.objectContaining({ ledgerId: 'knowledge', itemCount: 1 }),
          expect.objectContaining({ ledgerId: 'inbox', itemCount: 500 })
        ])
      }
    })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['knowledge'] }]
    })

    await expect(coordinator.saveWholeRunToLocalLibrary('100')).resolves.toBeDefined()
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      memberships: {
        'bilimi-logical:knowledge': [1],
        'local:inbox': expect.arrayContaining([501])
      }
    })
  })

  it('invalidates the complete-round tag cutoff before resuming tag enrichment', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false,
      segmentSize: () => 500
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 501, isBilimiWorkFolder: false, selected: true }]
    })
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
    await coordinator.acceptCurrentTags('100')

    await expect(coordinator.resumeTagEnrichment('100')).resolves.toBe(true)
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: { status: 'running', pendingItemCount: 1 },
      segments: [
        { id: 'segment-1', readiness: 'ready' },
        { id: 'segment-2', readiness: 'tagging', pendingTagItemCount: 1 }
      ]
    })
    await expect(coordinator.saveWholeRunToLocalLibrary('100')).rejects.toThrow(
      'Old favorite workspace whole-run tag enrichment is not complete.'
    )
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

  it('persists the complete tag cutoff and resumes the full range in batch order after restart', async () => {
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
      tagEnrichment: {
        status: 'accepted', pendingItemCount: 501,
        wholeRunTagCutoffAccepted: true,
        currentSegmentCanContinueTagEnrichment: false
      },
      segments: [
        { id: 'segment-1', readiness: 'ready', pendingTagItemCount: 500 },
        { id: 'segment-2', readiness: 'ready', pendingTagItemCount: 1 }
      ]
    })
    await expect(coordinator.getPendingTagEnrichmentAids('100')).resolves.toEqual([])

    const restarted = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })
    await expect(restarted.getPendingTagEnrichmentAids('100')).resolves.toEqual([])
    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: {
        status: 'accepted',
        wholeRunTagCutoffAccepted: true,
        currentSegmentCanContinueTagEnrichment: false,
        scopes: {
          wholeRun: { totalItemCount: 501, completedItemCount: 0, pendingItemCount: 501 },
          currentSegment: { totalItemCount: 500, completedItemCount: 0, pendingItemCount: 500 }
        }
      }
    })
    await expect(restarted.resumeTagEnrichment('100')).resolves.toBe(true)
    await expect(restarted.getPendingTagEnrichmentAids('100')).resolves.toHaveLength(500)
    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: { status: 'running', wholeRunTagCutoffAccepted: false, pendingItemCount: 501 }
    })
    const pendingAids = await restarted.getPendingTagEnrichmentAids('100')
    expect(pendingAids).toContain(1)
    expect(pendingAids).not.toContain(501)
  })

  it('reclassifies every persisted batch when tags are adopted after restart', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const classifyCurrentItems = vi.fn((items: CurrentSegmentItem[]) => items.map(() => ({
      targetLedgerIds: ['knowledge'], confidence: 'high' as const
    })))
    const first = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false,
      segmentSize: () => 500,
      classifyCurrentItems
    })
    await first.beginScan('100', 'incremental')
    for (let offset = 0; offset < 501; offset += 50) {
      await first.recordScanPage('100', {
        folderId: 'source', page: offset / 50 + 1,
        items: Array.from({ length: Math.min(50, 501 - offset) }, (_unused, index) => ({
          aid: offset + index + 1,
          title: `Video ${offset + index + 1}`,
          sourceFolderIds: ['source']
        }))
      })
    }
    await first.finishScan('100')
    classifyCurrentItems.mockClear()

    const restarted = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false,
      classifyCurrentItems
    })

    await expect(restarted.acceptCurrentTags('100')).resolves.toBeUndefined()
    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: { status: 'accepted', wholeRunTagCutoffAccepted: true },
      segments: [
        { id: 'segment-1', readiness: 'ready' },
        { id: 'segment-2', readiness: 'ready' }
      ]
    })
    expect(classifyCurrentItems).toHaveBeenCalledTimes(2)
    expect(classifyCurrentItems.mock.calls.map(([items]) => items.length)).toEqual([500, 1])
  })

  it('keeps a running tag-enrichment queue running when switching batches', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false,
      segmentSize: () => 500
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 501, isBilimiWorkFolder: false }]
    })
    for (let offset = 0; offset < 501; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source',
        page: offset / 50 + 1,
        items: Array.from({ length: Math.min(50, 501 - offset) }, (_unused, index) => ({
          aid: offset + index + 1,
          title: `Video ${offset + index + 1}`,
          sourceFolderIds: ['source']
        }))
      })
    }
    await coordinator.finishScan('100')

    await coordinator.selectSegment('100', 'segment-2')

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: {
        status: 'running',
        scopes: {
          wholeRun: { pendingItemCount: 501 },
          currentSegment: { pendingItemCount: 1 }
        }
      }
    })
    await expect(coordinator.getPendingTagEnrichmentAids('100')).resolves.toEqual(
      Array.from({ length: 500 }, (_unused, index) => index + 1)
    )
  })

  it('enriches tags in frozen batch order instead of globally sorting aids', async () => {
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
          aid: 1_000 - offset - index,
          title: `Video ${1_000 - offset - index}`,
          sourceFolderIds: ['source'],
          ...([1_000, 999, 500].includes(1_000 - offset - index)
            ? {}
            : { tags: ['existing'], tagEvidence: 'confirmed' as const })
        }))
      })
    }
    await coordinator.finishScan('100')

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: {
        scopes: {
          currentSegment: {
            totalItemCount: 500,
            completedItemCount: 498,
            pendingItemCount: 2,
            reusedTagItemCount: 498,
            fetchedTagItemCount: 0,
            confirmedUntaggedItemCount: 0,
            failedItemCount: 0
          },
          wholeRun: {
            totalItemCount: 501,
            completedItemCount: 498,
            pendingItemCount: 3,
            reusedTagItemCount: 498,
            fetchedTagItemCount: 0,
            confirmedUntaggedItemCount: 0,
            failedItemCount: 0
          }
        }
      }
    })
    await expect(coordinator.getPendingTagEnrichmentAids('100')).resolves.toEqual([1_000, 999])

    await coordinator.recordTagEnrichment('100', 1_000, ['已补取'])

    const restarted = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })
    await expect(restarted.getPendingTagEnrichmentAids('100')).resolves.toEqual([])
    await restarted.resumeTagEnrichment('100')
    await expect(restarted.getPendingTagEnrichmentAids('100')).resolves.toEqual([999])

    await restarted.recordTagEnrichment('100', 999, ['已补取'])
    await expect(restarted.getPendingTagEnrichmentAids('100')).resolves.toEqual([500])

    const restartedAgain = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })
    await expect(restartedAgain.getPendingTagEnrichmentAids('100')).resolves.toEqual([])
    await restartedAgain.resumeTagEnrichment('100')
    await expect(restartedAgain.getPendingTagEnrichmentAids('100')).resolves.toEqual([500])
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

  it('reuses confirmed tags, including confirmed empty tags, without an adoption step', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-24T00:00:00.000Z' })
    for (const video of [
      { aid: 1, title: '有历史标签', tags: ['知识'], tagEvidence: 'confirmed' as const },
      { aid: 2, title: '已确认无标签', tags: [], tagEvidence: 'confirmed' as const }
    ]) {
      await repository.commit('100', {
        id: `seed-confirmed-${video.aid}`, accountMid: '100', issuedAt: '2026-07-24T00:00:00.000Z', type: 'upsert-video',
        payload: { ...video, updatedAt: '2026-07-24T00:00:00.000Z' }
      })
    }
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false,
      classifyCurrentItems: (items) => items.map(() => ({ targetLedgerIds: ['knowledge'], confidence: 'high' as const }))
    })

    await expect(coordinator.beginSelectedReorganization('100', [1, 2], { refreshIncompleteMetadata: false }))
      .resolves.toMatchObject({
        tagEnrichment: {
          status: 'complete',
          pendingItemCount: 0,
          currentSegmentHasUnacceptedTagChanges: false
        },
        planReadiness: { selectedAidCount: 2, classifiedAidCount: 2, unclassifiedAidCount: 0 }
      })
  })

  it('treats complete saved non-empty library tags without legacy evidence as accepted history', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-24T00:00:00.000Z' })
    for (const aid of [1, 2]) {
      await repository.commit('100', {
        id: `seed-legacy-tags-${aid}`, accountMid: '100', issuedAt: '2026-07-24T00:00:00.000Z', type: 'upsert-video',
        payload: { aid, title: `历史视频 ${aid}`, tags: [aid === 1 ? '知识' : '游戏'], updatedAt: '2026-07-24T00:00:00.000Z' }
      })
    }
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })

    await expect(coordinator.beginSelectedReorganization('100', [1, 2], { refreshIncompleteMetadata: false }))
      .resolves.toMatchObject({
        tagEnrichment: {
          status: 'complete',
          pendingItemCount: 0,
          currentSegmentHasUnacceptedTagChanges: false
        }
      })
  })

  it('restores a legacy selected-library draft with complete saved tags as already accepted', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-24T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    for (const aid of [1, 2]) {
      await repository.commit('100', {
        id: `seed-legacy-selection-${aid}`, accountMid: '100', issuedAt: '2026-07-24T00:00:00.000Z', type: 'upsert-video',
        payload: { aid, title: `历史视频 ${aid}`, tags: [aid === 1 ? '知识' : '游戏'], updatedAt: '2026-07-24T00:00:00.000Z' }
      })
    }
    const first = createCoordinator(repository, workspaceStore, { initializeOnOpen: false })
    const created = requireSnapshot(await first.beginSelectedReorganization('100', [1, 2], { refreshIncompleteMetadata: false }))
    await workspaceStore.appendOverlay('100', created.workspaceId, {
      currentSegmentId: 'segment-1', classifications: [], history: [],
      tagEnrichment: {
        status: 'complete', totalItemCount: 0, completedItemCount: 0, pendingAids: [], failedAids: [],
        reusedTagItemCount: 2, taggedAids: [], confirmedUntaggedAids: [], acceptedSegmentIds: [],
        tagVersionsBySegment: {}, acceptedTagVersionsBySegment: {}
      }
    })

    const restarted = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })

    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: {
        status: 'complete', pendingItemCount: 0, currentSegmentHasUnacceptedTagChanges: false
      }
    })
    await expect(workspaceStore.recover('100', created.workspaceId)).resolves.toMatchObject({
      tagEnrichment: { acceptedSegmentIds: ['segment-1'], acceptedTagVersionsBySegment: { 'segment-1': 0 } }
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
      tagEnrichment: {
        status: 'complete', completedItemCount: 2, pendingItemCount: 0,
        wholeRunTagCutoffAccepted: true,
        currentSegmentHasUnacceptedTagChanges: false
      },
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
      tagEnrichment: {
        status: 'complete', completedItemCount: 2, pendingItemCount: 0, failedItemCount: 1,
        wholeRunTagCutoffAccepted: false
      },
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
    expect(snapshot.classificationAdjustments).toEqual([])
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

  it('treats a resumed tag batch that naturally completes as complete without re-adoption', async () => {
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
    await expect(coordinator.resumeTagEnrichment('100')).resolves.toBe(true)

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: {
        status: 'running', pendingItemCount: 1, failedItemCount: 0,
        currentSegmentCanContinueTagEnrichment: false,
        wholeRunTagCutoffAccepted: false
      }
    })
    expect(await coordinator.getPendingTagEnrichmentAids('100')).toEqual([2])
    expect(classifyCurrentItem).toHaveBeenCalledTimes(classificationCountAfterAccepting)

    await coordinator.recordTagEnrichment('100', 2, ['React'], workspaceId)

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: {
        status: 'complete', pendingItemCount: 0, failedItemCount: 0,
        wholeRunTagCutoffAccepted: true,
        currentSegmentHasUnacceptedTagChanges: false
      }
    })
    expect(classifyCurrentItem.mock.calls.length).toBeGreaterThan(classificationCountAfterAccepting)
  })

  it('does not requeue a fully completed current tag batch without an unaccepted checkpoint', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [{ aid: 1, title: 'Tagged', sourceFolderIds: ['source'] }]
    })
    await coordinator.finishScan('100')
    const workspaceId = (await coordinator.getSnapshot('100') as { workspaceId: string }).workspaceId
    await coordinator.recordTagEnrichment('100', 1, ['TypeScript'], workspaceId)
    await coordinator.acceptCurrentTags('100')

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: {
        status: 'complete', currentSegmentCanContinueTagEnrichment: false, pendingItemCount: 0
      }
    })

    await expect(coordinator.resumeTagEnrichment('100')).resolves.toBe(false)

    await expect(coordinator.getPendingTagEnrichmentAids('100')).resolves.toEqual([])
  })

  it('settles a claimed tag read before publishing the adopted whole-run cutoff', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'Already read', sourceFolderIds: ['source'] },
        { aid: 2, title: 'Read in flight', sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')
    const workspaceId = (await coordinator.getSnapshot('100') as { workspaceId: string }).workspaceId
    await coordinator.recordTagEnrichment('100', 1, ['TypeScript'], workspaceId)

    await expect(coordinator.claimNextPendingTagEnrichmentAid('100')).resolves.toBe(2)
    const accepting = coordinator.acceptCurrentTags('100')

    await vi.waitFor(async () => expect(await coordinator.getSnapshot('100')).toMatchObject({
      tagEnrichment: { status: 'paused', wholeRunTagCutoffAccepted: false }
    }))
    await expect(coordinator.getPendingTagEnrichmentAids('100')).resolves.toEqual([])
    await expect(coordinator.recordTagEnrichment('100', 2, ['Late result'], workspaceId)).resolves.toBe(true)
    await expect(accepting).resolves.toBeUndefined()

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: {
        status: 'accepted', currentSegmentHasUnacceptedTagChanges: false,
        wholeRunTagCutoffAccepted: true, pendingItemCount: 0
      },
      currentSegment: { items: expect.arrayContaining([expect.objectContaining({ aid: 2, tags: ['Late result'] })]) }
    })
  })

  it('allows a whole-run local save after resumed tags naturally complete', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'Already read', sourceFolderIds: ['source'] },
        { aid: 2, title: 'Read after resume', sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')
    const workspaceId = (await coordinator.getSnapshot('100') as { workspaceId: string }).workspaceId
    await coordinator.recordTagEnrichment('100', 1, ['TypeScript'], workspaceId)
    await coordinator.acceptCurrentTags('100')
    await coordinator.resumeTagEnrichment('100')
    await coordinator.recordTagEnrichment('100', 2, ['React'], workspaceId)
    const save = vi.spyOn(coordinator, 'saveWholeRunToLocalLibrary')

    await coordinator.setExecutionIntent('100', 'local')
    await expect(coordinator.continueExecutionIntent('100')).resolves.toBe(true)

    expect(save).toHaveBeenCalledOnce()
  })

  it('does not resume tag enrichment after a whole-run execution has been claimed', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'Already read', sourceFolderIds: ['source'] },
        { aid: 2, title: 'Paused for adoption', sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')
    const workspaceId = (await coordinator.getSnapshot('100') as { workspaceId: string }).workspaceId
    await coordinator.recordTagEnrichment('100', 1, ['TypeScript'], workspaceId)
    await coordinator.acceptCurrentTags('100')
    await coordinator.setExecutionIntent('100', 'local')
    const saving = deferred<OldFavoriteWorkspace>()
    vi.spyOn(coordinator, 'saveWholeRunToLocalLibrary').mockReturnValue(saving.promise)

    const executing = coordinator.continueExecutionIntent('100')
    await vi.waitFor(async () => expect(await coordinator.getSnapshot('100')).toMatchObject({
      executionIntent: { status: 'running' }, tagEnrichment: { wholeRunTagCutoffAccepted: true }
    }))
    await expect(coordinator.resumeTagEnrichment('100')).rejects.toThrow('execution has already started')

    saving.resolve(requireWorkspace(await coordinator.open('100')))
    await expect(executing).resolves.toBe(true)
  })

  it('does not publish an adopted cutoff when the complete reclassification fails', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const classifyCurrentItem = vi.fn(() => {
      throw new Error('classification unavailable')
    })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { classifyCurrentItem })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'First', sourceFolderIds: ['source'] },
        { aid: 2, title: 'Second', sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')
    const workspaceId = (await coordinator.getSnapshot('100') as { workspaceId: string }).workspaceId
    await coordinator.recordTagEnrichment('100', 1, ['TypeScript'], workspaceId)

    await expect(coordinator.acceptCurrentTags('100')).rejects.toThrow('classification unavailable')

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: {
        status: 'paused',
        pendingItemCount: 1,
        wholeRunTagCutoffAccepted: false
      },
      tagAdoption: {
        status: 'failed',
        failureCode: 'classification-recompute-failed'
      }
    })
    await expect(coordinator.saveWholeRunToLocalLibrary('100')).rejects.toThrow(
      'Old favorite workspace whole-run tag enrichment is not complete.'
    )

    const restarted = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { classifyCurrentItem })
    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: {
        status: 'paused',
        pendingItemCount: 1,
        wholeRunTagCutoffAccepted: false
      },
      tagAdoption: {
        status: 'failed',
        failureCode: 'classification-recompute-failed'
      }
    })
  })

  it('includes an in-flight tag result in the first accepted cutoff', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'Tagged', sourceFolderIds: ['source'] },
        { aid: 2, title: 'In flight', sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')
    const workspaceId = (await coordinator.getSnapshot('100') as { workspaceId: string }).workspaceId
    await coordinator.recordTagEnrichment('100', 1, ['TypeScript'], workspaceId)
    await expect(coordinator.claimNextPendingTagEnrichmentAid('100')).resolves.toBe(2)
    const accepting = coordinator.acceptCurrentTags('100')
    await coordinator.recordTagEnrichment('100', 2, ['React'], workspaceId)
    await accepting
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: {
        status: 'accepted',
        currentSegmentHasUnacceptedTagChanges: false,
        wholeRunTagCutoffAccepted: true
      }
    })
  })

  it('refreshes the draft before the in-flight tag result becomes part of the adopted cutoff', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const classifyCurrentItem = vi.fn().mockReturnValue({ targetLedgerIds: ['knowledge'], confidence: 'high' as const })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { classifyCurrentItem })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'Tagged', sourceFolderIds: ['source'] },
        { aid: 2, title: 'In flight', sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')
    const workspaceId = (await coordinator.getSnapshot('100') as { workspaceId: string }).workspaceId
    await coordinator.recordTagEnrichment('100', 1, ['TypeScript'], workspaceId)
    await expect(coordinator.claimNextPendingTagEnrichmentAid('100')).resolves.toBe(2)
    const classificationCountBeforeAcceptance = classifyCurrentItem.mock.calls.length

    const accepting = coordinator.acceptCurrentTags('100')
    await coordinator.recordTagEnrichment('100', 2, ['React'], workspaceId)
    await accepting

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: {
        wholeRunTagCutoffAccepted: true,
        currentSegmentHasUnacceptedTagChanges: false
      }
    })
    expect(classifyCurrentItem.mock.calls.length).toBeGreaterThan(classificationCountBeforeAcceptance)
  })

  it('does not require explicit re-adoption after resumed tags naturally complete', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const classifyCurrentItem = vi.fn().mockReturnValue({ targetLedgerIds: ['knowledge'], confidence: 'high' as const })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { classifyCurrentItem })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'Tagged', sourceFolderIds: ['source'] },
        { aid: 2, title: 'In flight', sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')
    const workspaceId = (await coordinator.getSnapshot('100') as { workspaceId: string }).workspaceId
    await coordinator.recordTagEnrichment('100', 1, ['TypeScript'], workspaceId)
    await coordinator.acceptCurrentTags('100')
    const classificationCountAfterAcceptance = classifyCurrentItem.mock.calls.length

    await coordinator.resumeTagEnrichment('100')
    await coordinator.recordTagEnrichment('100', 2, ['React'], workspaceId)

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: {
        status: 'complete', pendingItemCount: 0, failedItemCount: 0,
        wholeRunTagCutoffAccepted: true,
        currentSegmentHasUnacceptedTagChanges: false
      }
    })
    expect(classifyCurrentItem.mock.calls.length).toBeGreaterThan(classificationCountAfterAcceptance)
    const classificationCountAfterNaturalCompletion = classifyCurrentItem.mock.calls.length
    await coordinator.acceptCurrentTags('100')
    expect(classifyCurrentItem.mock.calls.length).toBe(classificationCountAfterNaturalCompletion)
  })

  it('keeps manual classifications and adopted recommendations when resumed tags are adopted again', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      classifyCurrentItem: () => ({ targetLedgerIds: ['knowledge'], confidence: 'high' as const })
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'First', author: 'UP Alpha', sourceFolderIds: ['source'] },
        { aid: 2, title: 'Second', author: 'UP Alpha', sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')
    const workspaceId = (await coordinator.getSnapshot('100') as { workspaceId: string }).workspaceId
    await coordinator.recordTagEnrichment('100', 1, ['TypeScript'], workspaceId)
    await coordinator.acceptCurrentTags('100')
    await coordinator.setRecommendedCandidates('100', ['custom-author-up-alpha'])
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 2, targetLedgerIds: ['manual'] }]
    })

    await coordinator.resumeTagEnrichment('100')
    await coordinator.recordTagEnrichment('100', 2, ['React'], workspaceId)
    await coordinator.acceptCurrentTags('100')

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      classifications: { '2': { targetLedgerIds: ['manual'], source: 'manual' } },
      recommendations: { adoptedCandidateIds: ['custom-author-up-alpha'] }
    })
  })

  it('treats a resumed tag run that naturally completes as complete after restart', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const first = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await first.beginScan('100', 'incremental')
    await first.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'Already tagged', sourceFolderIds: ['source'] },
        { aid: 2, title: 'In flight', sourceFolderIds: ['source'] }
      ]
    })
    await first.finishScan('100')
    const workspaceId = (await first.getSnapshot('100') as { workspaceId: string }).workspaceId
    await first.recordTagEnrichment('100', 1, ['TypeScript'], workspaceId)
    await first.acceptCurrentTags('100')
    await first.resumeTagEnrichment('100')
    await first.recordTagEnrichment('100', 2, ['React'], workspaceId)

    const restarted = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: {
        currentSegmentCanContinueTagEnrichment: false,
        currentSegmentHasUnacceptedTagChanges: false,
        wholeRunTagCutoffAccepted: true,
        status: 'complete', pendingItemCount: 0, failedItemCount: 0
      }
    })
  })

  it('ignores an orphaned adopted tag version when a restored run is already complete', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(repository, workspaceStore, { initializeOnOpen: false })
    await first.beginScan('100', 'incremental')
    await first.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'Tagged', sourceFolderIds: ['source'] },
        { aid: 2, title: 'Completed later', sourceFolderIds: ['source'] }
      ]
    })
    await first.finishScan('100')
    const created = requireSnapshot(await first.getSnapshot('100'))
    await first.recordTagEnrichment('100', 1, ['TypeScript'], created.workspaceId)
    await first.recordTagEnrichment('100', 2, ['React'], created.workspaceId)

    await workspaceStore.appendOverlay('100', created.workspaceId, {
      currentSegmentId: 'segment-1', classifications: [], history: [],
      tagEnrichment: {
        status: 'complete', totalItemCount: 2, completedItemCount: 2, pendingAids: [], failedAids: [],
        reusedTagItemCount: 0, taggedAids: [1, 2], confirmedUntaggedAids: [], acceptedSegmentIds: [],
        tagVersionsBySegment: { 'segment-1': 2 }, acceptedTagVersionsBySegment: { 'segment-1': 1 }
      }
    })

    const restarted = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })

    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: {
        status: 'complete', pendingItemCount: 0, failedItemCount: 0,
        wholeRunTagCutoffAccepted: true, currentSegmentHasUnacceptedTagChanges: false
      }
    })
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

  it('clears an adopted cutoff when the compatibility failed-tag retry resumes the whole run', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanPage('100', { folderId: 'source', page: 1, items: [
      { aid: 1, title: 'Tagged', sourceFolderIds: ['source'] },
      { aid: 2, title: 'Failed', sourceFolderIds: ['source'] }
    ] })
    await coordinator.finishScan('100')
    const workspaceId = (await coordinator.getSnapshot('100') as { workspaceId: string }).workspaceId
    await coordinator.recordTagEnrichment('100', 1, ['TypeScript'], workspaceId)
    await coordinator.acceptCurrentTags('100')
    await coordinator.resumeTagEnrichment('100')
    await coordinator.recordTagEnrichmentFailure('100', 2, 'network-failure', workspaceId)

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: { wholeRunTagCutoffAccepted: false, failedItemCount: 1 }
    })
    await expect(coordinator.retryFailedTagEnrichment('100')).resolves.toBe(true)
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      tagEnrichment: { status: 'running', pendingItemCount: 1, failedItemCount: 0, wholeRunTagCutoffAccepted: false }
    })
  })

  it('resumes pending and failed tag reads through the single resume action', async () => {
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

    await coordinator.resumeTagEnrichment('100')

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
    const selected = requireSnapshot(await coordinator.getSnapshot('100'))
    const ledgerId = selected.recommendations.linkedLedgerIdsByCandidateId?.[tagCandidate.id]
    if (!ledgerId) throw new Error('adopted tag recommendation unexpectedly has no linked ordinary rule')
    await coordinator.prepareRecommendationPreview('100', [tagCandidate.id])

    expect(classifyCurrentItem).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ id: ledgerId, ruleType: 'tag' })])
    )
  })

  it('reclassifies a reselected tag recommendation from the persisted adoption state', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const coordinator = createCoordinator(repository, workspaceStore, {
      initializeOnOpen: false,
      classifyCurrentItem: (item, recommendedLedgers = []) => {
        const matchingLedger = recommendedLedgers.find((ledger) => ledger.ruleType === 'tag' &&
          ledger.keywords.includes('Genshin') && item.tags?.includes('Genshin'))
        return {
          targetLedgerIds: matchingLedger ? [matchingLedger.id] : ['game'],
          confidence: 'high' as const
        }
      }
    })
    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'One', tags: ['Genshin'], sourceFolderIds: ['source'] },
        { aid: 2, title: 'Two', tags: ['Genshin'], sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')
    const initial = requireSnapshot(await coordinator.getSnapshot('100'))
    const tagCandidate = initial.recommendations.candidates.find((candidate) => candidate.kind === 'tag' &&
      candidate.keywords.includes('Genshin'))
    if (!tagCandidate) throw new Error('Genshin tag recommendation unexpectedly unavailable')
    expect(tagCandidate.currentSegmentCount).toBe(2)

    await coordinator.setRecommendedCandidates('100', [tagCandidate.id])
    const selected = requireSnapshot(await coordinator.getSnapshot('100'))
    const ledgerId = selected.recommendations.linkedLedgerIdsByCandidateId?.[tagCandidate.id]
    if (!ledgerId) throw new Error('adopted tag recommendation unexpectedly has no linked ordinary rule')
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({ classifications: {
      '1': { aid: 1, targetLedgerIds: [ledgerId], source: 'system-high' },
      '2': { aid: 2, targetLedgerIds: [ledgerId], source: 'system-high' }
    } })

    const recovered = await workspaceStore.recover('100', initial.workspaceId)
    if ('recovery' in recovered) throw new Error('workspace unexpectedly unavailable')
    await workspaceStore.appendOverlay('100', initial.workspaceId, {
      currentSegmentId: 'segment-1', classifications: [], history: [],
      recommendations: { ...recovered.recommendations, adoptedCandidateIds: [] }
    })
    await coordinator.applyClassificationBatch('100', {
      source: 'system-high',
      assignments: [{ aid: 1, targetLedgerIds: ['game'] }, { aid: 2, targetLedgerIds: ['game'] }]
    })

    await coordinator.setRecommendedCandidates('100', [tagCandidate.id])

    const reselected = requireSnapshot(await coordinator.getSnapshot('100'))
    expect(reselected).toMatchObject({
      recommendations: { adoptedCandidateIds: [tagCandidate.id] },
      classifications: {
        '1': { aid: 1, targetLedgerIds: [ledgerId], source: 'system-high' },
        '2': { aid: 2, targetLedgerIds: [ledgerId], source: 'system-high' }
      }
    })
    expect(Object.values(reselected.classifications).filter((classification) =>
      classification.targetLedgerIds.includes(ledgerId)
    )).toHaveLength(2)
    await expect(coordinator.getBilibiliExecutionPreflight('100')).resolves.toMatchObject({
      missingLedgers: [expect.objectContaining({ logicalLedgerId: ledgerId })]
    })
  })

  it('does not retain a user-created local organization rule as a scan recommendation after restart', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    let savedLedgers: FavoriteLedger[] = []
    const applyFavoriteRecommendationRuleChanges = vi.fn(async (_accountMid: string, changes: {
      upserts: FavoriteLedger[]
      enabled: Array<{ ledgerId: string; enabled: boolean }>
    }) => {
      const before = savedLedgers.map((ledger) => ({ ...ledger, keywords: [...ledger.keywords] }))
      const byId = new Map(savedLedgers.map((ledger) => [ledger.id, ledger]))
      for (const ledger of changes.upserts) byId.set(ledger.id, { ...ledger, keywords: [...ledger.keywords] })
      for (const { ledgerId, enabled } of changes.enabled) {
        const ledger = byId.get(ledgerId)
        if (ledger) byId.set(ledgerId, { ...ledger, enabled })
      }
      savedLedgers = [...byId.values()]
      return { before, after: savedLedgers.map((ledger) => ({ ...ledger, keywords: [...ledger.keywords] })) }
    })
    const coordinator = createCoordinator(repository, store, {
      initializeOnOpen: false,
      classifyCurrentItem: () => ({ targetLedgerIds: [], confidence: 'low' as const }),
      listSavedFavoriteLedgers: vi.fn(async () => savedLedgers),
      applyFavoriteRecommendationRuleChanges
    })
    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false, selected: true }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [{ aid: 1, title: 'Video', tags: ['TypeScript'], sourceFolderIds: ['source'] }]
    })
    await coordinator.finishScan('100')
    await coordinator.createLocalLedgerAndReclassify('100', '候选')
    const preview = requireSnapshot(await coordinator.getSnapshot('100'))
    expect(savedLedgers).toEqual([expect.objectContaining({
      id: expect.stringMatching(/^local-/), displayName: 'bilimi·候选', ruleOrigin: 'saved-rule', enabled: true
    })])
    expect(preview.recommendations.candidates.map((candidate) => candidate.id)).not.toContain(savedLedgers[0]!.id)
    expect(preview.recommendations.adoptedCandidateIds).not.toContain(savedLedgers[0]!.id)
    const marker = (await repository.getSnapshot('100')).workspace!
    await repository.commit('100', {
      id: 'mark-completed', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'set-workspace', payload: {
        ...marker, status: 'completed', workspaceRef: { ...marker.workspaceRef, status: 'completed' }
      }
    })
    const restarted = createCoordinator(repository, store, {
      initializeOnOpen: false,
      classifyCurrentItem: () => ({ targetLedgerIds: [], confidence: 'low' as const }),
      listSavedFavoriteLedgers: vi.fn(async () => savedLedgers),
      applyFavoriteRecommendationRuleChanges
    })
    await restarted.open('100')
    const restartedSnapshot = requireSnapshot(await restarted.getSnapshot('100'))
    expect(restartedSnapshot.recommendations.candidates.map((candidate) => candidate.id)).not.toContain(savedLedgers[0]!.id)
    expect(restartedSnapshot.recommendations.adoptedCandidateIds).not.toContain(savedLedgers[0]!.id)
  })

  it('reclassifies when an adopted recommendation is submitted again after its classification became stale', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const coordinator = createCoordinator(repository, workspaceStore, {
      initializeOnOpen: false,
      classifyCurrentItem: (item, recommendedLedgers = []) => {
        const matchingLedger = recommendedLedgers.find((ledger) => ledger.ruleType === 'tag' &&
          ledger.keywords.includes('Genshin') && item.tags?.includes('Genshin'))
        return {
          targetLedgerIds: matchingLedger ? [matchingLedger.id] : ['game'],
          confidence: 'high' as const
        }
      }
    })
    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'One', tags: ['Genshin'], sourceFolderIds: ['source'] },
        { aid: 2, title: 'Two', tags: ['Genshin'], sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')
    const initial = requireSnapshot(await coordinator.getSnapshot('100'))
    const tagCandidate = initial.recommendations.candidates.find((candidate) => candidate.id === 'custom-tag-genshin')
    if (!tagCandidate) throw new Error('Genshin tag recommendation unexpectedly unavailable')

    await coordinator.setRecommendedCandidates('100', [tagCandidate.id])
    const selected = requireSnapshot(await coordinator.getSnapshot('100'))
    const ledgerId = selected.recommendations.linkedLedgerIdsByCandidateId?.[tagCandidate.id]
    if (!ledgerId) throw new Error('adopted tag recommendation unexpectedly has no linked ordinary rule')
    await coordinator.applyClassificationBatch('100', {
      source: 'system-high', assignments: [
        { aid: 1, targetLedgerIds: ['game'] },
        { aid: 2, targetLedgerIds: ['game'] }
      ]
    })

    await coordinator.setRecommendedCandidates('100', [tagCandidate.id])

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      recommendations: { adoptedCandidateIds: [tagCandidate.id] },
      classifications: {
        '1': { aid: 1, targetLedgerIds: [ledgerId], source: 'system-high' },
        '2': { aid: 2, targetLedgerIds: [ledgerId], source: 'system-high' }
      }
    })
  })

  it('reports backup preflight before staging unclassified selected aids for an unbound cross-segment remote plan', async () => {
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
    await coordinator.acceptCurrentTags('100')
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: Array.from({ length: 2_000 }, (_, index) => ({ aid: index + 1, targetLedgerIds: ['music'] }))
    })

    await expect(coordinator.freezeForBilibiliExecution('100')).rejects.toThrow('backup-preflight-required')
    const persisted = await repository.getSnapshot('100')
    expect(persisted.memberships['local:inbox'] ?? []).toContain(2_001)
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      planReadiness: { selectedAidCount: 2_001, classifiedAidCount: 2_000, unclassifiedAidCount: 1 }
    })
  }, 15_000)

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

  it('abandons a paused scanning workspace', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-08-18T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    const paused = await coordinator.beginScan('100', 'incremental')
    await coordinator.pauseScan('100')

    await expect(coordinator.abandonCurrentWorkspace('100')).resolves.toBeUndefined()
    await expect(coordinator.getSnapshot('100')).resolves.toBeNull()
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({ workspace: undefined })

    await expect(coordinator.beginScan('100', 'incremental')).resolves.toMatchObject({
      status: 'scanning', mode: 'incremental'
    })
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      workspaceId: expect.not.stringMatching(new RegExp(`^${paused.workspaceId}$`)), status: 'scanning'
    })
  })

  it('keeps a non-paused scanning workspace intact when abandonment is refused', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-08-18T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    const active = await coordinator.beginScan('100', 'incremental')

    await expect(coordinator.abandonCurrentWorkspace('100')).rejects.toThrow('Old favorite workspace cannot be abandoned while it is active.')
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({ workspace: { id: active.workspaceId, status: 'scanning' } })
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({ workspaceId: active.workspaceId, status: 'scanning' })
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

  it('links and adopts only enabled ordinary rules before a second scan publishes recommendations', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    let savedLedgers: FavoriteLedger[] = []
    const applyFavoriteRecommendationRuleChanges = vi.fn()
    const coordinator = createCoordinator(repository, store, {
      listSavedFavoriteLedgers: vi.fn(async () => cloneFavoriteLedgers(savedLedgers)),
      listSavedEnabledLedgers: vi.fn(async () => savedLedgers
        .filter((ledger) => ledger.enabled)
        .map((ledger) => ({ id: ledger.id, title: ledger.displayName }))),
      listSavedLedgers: vi.fn(async () => savedLedgers
        .map((ledger) => ({ id: ledger.id, title: ledger.displayName }))),
      applyFavoriteRecommendationRuleChanges
    })

    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'first-source', title: 'First source', itemCount: 2, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'first-source', page: 1, hasMore: false,
      items: [
        { aid: 1, title: 'First alpha', author: 'UP Alpha', sourceFolderIds: ['first-source'] },
        { aid: 2, title: 'Second alpha', author: 'UP Alpha', sourceFolderIds: ['first-source'] }
      ]
    })
    await coordinator.finishScan('100')
    const completedMarker = (await repository.getSnapshot('100')).workspace!
    await repository.commit('100', {
      id: 'complete-first-round', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'set-workspace', payload: {
        ...completedMarker,
        status: 'completed', workspaceRef: { ...completedMarker.workspaceRef, status: 'completed' }
      }
    })

    savedLedgers = [
      ordinaryAuthorLedger('custom-author-up-alpha', 'UP Alpha', true),
      // The second scan must match this by name and rule semantics, never by
      // its old candidate-shaped id.
      ordinaryAuthorLedger('custom-author-up-beta-previous-rule', 'UP Beta', true),
      ordinaryAuthorLedger('custom-author-up-disabled', 'UP Disabled', false)
    ]
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'second-source', title: 'Second source', itemCount: 6, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'second-source', page: 1, hasMore: false,
      items: [
        { aid: 11, title: 'Alpha one', author: 'UP Alpha', sourceFolderIds: ['second-source'] },
        { aid: 12, title: 'Alpha two', author: 'UP Alpha', sourceFolderIds: ['second-source'] },
        { aid: 13, title: 'Beta one', author: 'UP Beta', sourceFolderIds: ['second-source'] },
        { aid: 14, title: 'Beta two', author: 'UP Beta', sourceFolderIds: ['second-source'] },
        { aid: 15, title: 'Disabled one', author: 'UP Disabled', sourceFolderIds: ['second-source'] },
        { aid: 16, title: 'Disabled two', author: 'UP Disabled', sourceFolderIds: ['second-source'] }
      ]
    })
    await coordinator.finishScan('100')

    const snapshot = requireSnapshot(await coordinator.getSnapshot('100'))
    expect(snapshot.recommendations.links).toMatchObject({
      'custom-author-up-alpha': { status: 'linked', ledgerId: 'custom-author-up-alpha' },
      'custom-author-up-beta': { status: 'linked', ledgerId: 'custom-author-up-beta-previous-rule' }
    })
    expect(snapshot.recommendations.adoptedCandidateIds).toEqual([
      'custom-author-up-alpha',
      'custom-author-up-beta'
    ])
    expect(snapshot.recommendations.adoptedCandidateIds).not.toContain('custom-author-up-disabled')
    expect(applyFavoriteRecommendationRuleChanges).not.toHaveBeenCalled()
  })

  it('recovers a manual circled shard as the same default logical folder', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })
    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'circled-game', title: 'bilimi·游戏专区②', itemCount: 1, isBilimiWorkFolder: true }]
    })
    await coordinator.recordManagedMembers('100', { 'circled-game': [1] })
    await coordinator.finishScan('100')

    expect((await repository.getSnapshot('100')).physicalShards).toEqual(expect.arrayContaining([
      expect.objectContaining({ logicalLedgerId: 'game', shardNumber: 2, knownRemoteFolderIds: ['circled-game'] })
    ]))
  })

  it('publishes a precomputed ordinary-rule link without auto-adopting the scan candidate', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      listSavedFavoriteLedgers: vi.fn().mockResolvedValue([{
        id: 'custom-up-link', displayName: 'bilimi·UP Link', keywords: ['UP Link'], ruleType: 'author',
        enabled: false, priority: 1, syncState: 'local-draft', bindingState: 'unbacked', ruleOrigin: 'saved-rule', isDefault: false
      }])
    })

    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1, hasMore: false,
      items: [
        { aid: 1, title: 'First', author: 'UP Link', sourceFolderIds: ['source'] },
        { aid: 2, title: 'Second', author: 'UP Link', sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')

    const snapshot = requireSnapshot(await coordinator.getSnapshot('100'))
    const candidate = snapshot.recommendations.candidates.find((item) => item.displayName === 'bilimi·UP Link')!
    expect(snapshot.recommendations.links?.[candidate.id]).toEqual({ status: 'linked', ledgerId: 'custom-up-link' })
    expect(snapshot.recommendations.linkedLedgerIdsByCandidateId?.[candidate.id]).toBe('custom-up-link')
    expect(snapshot.recommendations.adoptedCandidateIds).not.toContain(candidate.id)
  })

  it('recomputes remembered links after a rule rename and creates a new rule when re-adopted', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    let savedRules: FavoriteLedger[] = [ordinaryAuthorLedger('custom-up-link', 'UP Link', true)]
    const cloneRules = (rules: readonly FavoriteLedger[]) => rules.map((rule) => ({
      ...rule,
      keywords: [...rule.keywords]
    }))
    const applyFavoriteRecommendationRuleChanges = vi.fn(async (_accountMid: string, changes: {
      upserts: FavoriteLedger[]
      enabled: Array<{ ledgerId: string; enabled: boolean }>
    }) => {
      const before = cloneRules(savedRules)
      const byId = new Map(savedRules.map((rule) => [rule.id, rule]))
      for (const rule of changes.upserts) byId.set(rule.id, cloneRules([rule])[0]!)
      for (const change of changes.enabled) {
        const rule = byId.get(change.ledgerId)
        if (rule) byId.set(change.ledgerId, { ...rule, enabled: change.enabled })
      }
      savedRules = cloneRules([...byId.values()])
      return { before, after: cloneRules(savedRules) }
    })
    const coordinator = createCoordinator(repository, store, {
      listSavedFavoriteLedgers: async () => cloneRules(savedRules),
      applyFavoriteRecommendationRuleChanges
    })

    const { candidateId } = await readyWorkspaceWithAuthorRecommendation(coordinator, 'UP Link')
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      recommendations: { links: { [candidateId]: { status: 'linked', ledgerId: 'custom-up-link' } } }
    })

    savedRules = [ordinaryAuthorLedger('custom-up-link', 'UP Renamed', true)]
    await coordinator.getFavoriteLedgerHistoryState('100')
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      recommendations: { links: { [candidateId]: { status: 'unlinked' } } }
    })

    await coordinator.setRecommendedCandidates('100', [candidateId])

    expect(savedRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'custom-up-link', displayName: 'bilimi·UP Renamed' }),
      expect.objectContaining({ displayName: 'bilimi·UP Link', ruleType: 'author', ruleOrigin: 'saved-rule', enabled: true })
    ]))
    expect(savedRules).toHaveLength(2)
    expect(applyFavoriteRecommendationRuleChanges).toHaveBeenLastCalledWith('100', expect.objectContaining({
      upserts: [expect.objectContaining({ displayName: 'bilimi·UP Link', ruleType: 'author', ruleOrigin: 'saved-rule' })]
    }))
  })

  it('adopts an unlinked candidate by saving one ordinary rule and classifying with its real id', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    let savedLedgers: FavoriteLedger[] = []
    const applyFavoriteRecommendationRuleChanges = vi.fn(async (_accountMid: string, changes: {
      upserts: FavoriteLedger[]
      enabled: Array<{ ledgerId: string; enabled: boolean }>
    }) => {
      const before = savedLedgers.map((ledger) => ({ ...ledger, keywords: [...ledger.keywords] }))
      const byId = new Map(savedLedgers.map((ledger) => [ledger.id, ledger]))
      for (const ledger of changes.upserts) byId.set(ledger.id, { ...ledger, keywords: [...ledger.keywords] })
      for (const { ledgerId, enabled } of changes.enabled) {
        const ledger = byId.get(ledgerId)
        if (ledger) byId.set(ledgerId, { ...ledger, enabled })
      }
      savedLedgers = [...byId.values()]
      return { before, after: savedLedgers.map((ledger) => ({ ...ledger, keywords: [...ledger.keywords] })) }
    })
    const coordinator = createCoordinator(repository, store, {
      listSavedFavoriteLedgers: vi.fn(async () => savedLedgers),
      applyFavoriteRecommendationRuleChanges,
      classifyCurrentItems: vi.fn((_items, ledgers: FavoriteLedger[]) => _items.map(() => ({
        targetLedgerIds: ledgers.length ? [ledgers[0]!.id] : [], confidence: 'high' as const
      })))
    })

    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1, hasMore: false,
      items: [
        { aid: 1, title: 'First', author: 'UP Adopt', sourceFolderIds: ['source'] },
        { aid: 2, title: 'Second', author: 'UP Adopt', sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')
    await coordinator.acceptCurrentTags('100')
    const before = requireSnapshot(await coordinator.getSnapshot('100'))
    const candidateId = before.recommendations.candidates.find((item) => item.displayName === 'bilimi·UP Adopt')!.id

    const after = await coordinator.setRecommendedCandidates('100', [candidateId])
    const ledgerId = requireSnapshot(await coordinator.getSnapshot('100')).recommendations.linkedLedgerIdsByCandidateId?.[candidateId]

    expect(ledgerId).toMatch(/^custom-/)
    expect(ledgerId).not.toBe(candidateId)
    expect(applyFavoriteRecommendationRuleChanges).toHaveBeenCalledWith('100', expect.objectContaining({
      upserts: [expect.objectContaining({
        id: ledgerId, displayName: 'bilimi·UP Adopt', ruleType: 'author', ruleOrigin: 'saved-rule', enabled: true
      })]
    }))
    expect(Object.values(after.classifications).some((row) => row.targetLedgerIds.includes(ledgerId!))).toBe(true)
  })

  it('reuses a prelinked ordinary rule without creating another rule', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const existing = ordinaryAuthorLedger('custom-existing', 'UP Reuse')
    const applyFavoriteRecommendationRuleChanges = vi.fn(async () => ({
      before: [existing], after: [{ ...existing, enabled: true }]
    }))
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      listSavedFavoriteLedgers: vi.fn(async () => [existing]),
      applyFavoriteRecommendationRuleChanges
    })
    const { candidateId } = await readyWorkspaceWithAuthorRecommendation(coordinator, 'UP Reuse')

    await coordinator.setRecommendedCandidates('100', [candidateId])

    expect(applyFavoriteRecommendationRuleChanges).toHaveBeenCalledWith('100', {
      upserts: [], enabled: [{ ledgerId: 'custom-existing', enabled: true }]
    })
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      recommendations: {
        adoptedCandidateIds: [candidateId],
        linkedLedgerIdsByCandidateId: { [candidateId]: 'custom-existing' }
      }
    })
  })

  it('cancels a candidate by disabling its linked ordinary rule without deleting it', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    let savedLedgers = [ordinaryAuthorLedger('custom-cancel', 'UP Cancel', true)]
    const applyFavoriteRecommendationRuleChanges = vi.fn(async (_accountMid: string, changes: {
      upserts: FavoriteLedger[]
      enabled: Array<{ ledgerId: string; enabled: boolean }>
    }) => {
      const before = savedLedgers.map((ledger) => ({ ...ledger, keywords: [...ledger.keywords] }))
      savedLedgers = savedLedgers.map((ledger) => {
        const change = changes.enabled.find((entry) => entry.ledgerId === ledger.id)
        return change ? { ...ledger, enabled: change.enabled } : ledger
      })
      return { before, after: savedLedgers }
    })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      listSavedFavoriteLedgers: vi.fn(async () => savedLedgers),
      applyFavoriteRecommendationRuleChanges
    })
    const { candidateId } = await readyWorkspaceWithAuthorRecommendation(coordinator, 'UP Cancel')
    await coordinator.setRecommendedCandidates('100', [candidateId])

    await coordinator.setRecommendedCandidates('100', [])

    expect(savedLedgers).toEqual([expect.objectContaining({ id: 'custom-cancel', enabled: false })])
    expect(applyFavoriteRecommendationRuleChanges).toHaveBeenLastCalledWith('100', {
      upserts: [], enabled: [{ ledgerId: 'custom-cancel', enabled: false }]
    })
  })

  it('fails closed for ambiguous recommendation links', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const applyFavoriteRecommendationRuleChanges = vi.fn()
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      listSavedFavoriteLedgers: vi.fn(async () => [
        ordinaryAuthorLedger('custom-duplicate-a', 'UP Duplicate'),
        ordinaryAuthorLedger('custom-duplicate-b', 'UP Duplicate')
      ]),
      applyFavoriteRecommendationRuleChanges
    })
    const { candidateId } = await readyWorkspaceWithAuthorRecommendation(coordinator, 'UP Duplicate')

    await expect(coordinator.setRecommendedCandidates('100', [candidateId]))
      .rejects.toThrow('存在重复收藏夹，请先处理重复项。')
    expect(applyFavoriteRecommendationRuleChanges).not.toHaveBeenCalled()
  })

  it('restores the ordinary rule directory when classification publication fails', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const restoreFavoriteRuleDirectory = vi.fn(async () => undefined)
    const saved = ordinaryAuthorLedger('custom-rollback', 'UP Rollback')
    let failClassificationPublication = false
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      listSavedFavoriteLedgers: vi.fn(async () => [saved]),
      applyFavoriteRecommendationRuleChanges: vi.fn(async () => ({ before: [saved], after: [{ ...saved, enabled: true }] })),
      restoreFavoriteRuleDirectory,
      classifyCurrentItems: vi.fn(async (items: Array<{ aid: number }>) => {
        if (failClassificationPublication) throw new Error('classification publication failed')
        return items.map(() => ({ targetLedgerIds: [], confidence: 'low' as const }))
      })
    })
    const { candidateId } = await readyWorkspaceWithAuthorRecommendation(coordinator, 'UP Rollback')
    failClassificationPublication = true

    await expect(coordinator.setRecommendedCandidates('100', [candidateId]))
      .rejects.toThrow('classification publication failed')
    expect(restoreFavoriteRuleDirectory).toHaveBeenCalledWith('100', [saved])
  })

  it('keeps a user-created organization rule outside scan recommendations', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    let savedLedgers: FavoriteLedger[] = []
    const applyFavoriteRecommendationRuleChanges = vi.fn(async (_accountMid: string, changes: {
      upserts: FavoriteLedger[]
      enabled: Array<{ ledgerId: string; enabled: boolean }>
    }) => {
      const before = savedLedgers
      savedLedgers = [...changes.upserts]
      return { before, after: savedLedgers }
    })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      listSavedFavoriteLedgers: vi.fn(async () => savedLedgers),
      applyFavoriteRecommendationRuleChanges,
      classifyCurrentItems: vi.fn((items: Array<{ aid: number }>, ledgers: FavoriteLedger[]) => items.map(() => ({
        targetLedgerIds: ledgers.length ? [ledgers[0]!.id] : [], confidence: 'high' as const
      })))
    })
    await readyWorkspaceWithAuthorRecommendation(coordinator, 'UP Manual')

    await coordinator.saveDraftLedgerRule('100', {
      analysisId: 'manual-rule', ledgerId: 'custom-music', title: '音乐',
      keywords: ['First'], ruleType: 'keyword', adopt: true
    })

    const snapshot = requireSnapshot(await coordinator.getSnapshot('100'))
    expect(savedLedgers).toEqual([expect.objectContaining({
      id: 'custom-music', displayName: 'bilimi·音乐', ruleOrigin: 'saved-rule', enabled: true
    })])
    expect(snapshot.recommendations.candidates.map((candidate) => candidate.id)).not.toContain('custom-music')
    expect(Object.values(snapshot.classifications).some((row) => row.targetLedgerIds.includes('custom-music'))).toBe(true)
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

  it('does not turn formally bound Bilibili members into local protection records', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    await repository.commit('100', {
      id: 'bind-music-before-scan', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'upsert-physical-shard-binding',
      payload: {
        logicalLedgerId: 'music', logicalTitle: 'bilimi·音乐', shardNumber: 1,
        remoteTitle: 'bilimi·音乐', bindingState: 'bound', remoteFolderId: 'bilimi-music', memberAids: []
      }
    })
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

    await expect(coordinator.finishScan('100')).resolves.toMatchObject({ plannedAids: [1, 2, 3], protectedAids: [] })
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      // Folder inventory has two Bilimi relationships; four unique videos
      // were discovered because managed-member recovery can include items
      // beyond the currently listed folder counts.
      scan: { totalItemCount: 2, scannedItemCount: 4 }
    })
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      organizationRecords: []
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
      logicalLedgerId: 'creative-aesthetic', shardNumber: 1, bindingState: 'pending-reconcile', knownRemoteFolderIds: ['managed-creative']
    })])
    expect(first.memberships).toMatchObject({
      'bilimi-logical:creative-aesthetic': [],
      'bilimi:creative-aesthetic:001': [],
      'bilibili:ordinary': [21]
    })
    expect(first.positions['100:11']).toMatchObject({
      remoteObservedPhysicalFolderIds: ['managed-creative'],
      remoteObservedLogicalFolderIds: []
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
    expect(second.physicalShards.filter((shard) => shard.knownRemoteFolderIds?.includes('managed-creative'))).toHaveLength(1)
    expect(second.memberships['bilimi-logical:creative-aesthetic']).toEqual([])
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

  it('keeps duplicate custom remote titles separate by exact remote folder id', async () => {
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
    expect(customFolders).toHaveLength(2)
    expect(customFolders.map((folder) => folder.logicalLedgerId)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^custom-remote-/), expect.stringMatching(/^custom-remote-/)
    ]))
    expect(snapshot.physicalShards).toEqual(expect.arrayContaining([
      expect.objectContaining({ logicalLedgerId: expect.stringMatching(/^custom-remote-/), bindingState: 'pending-reconcile', knownRemoteFolderIds: ['custom-a'] }),
      expect.objectContaining({ logicalLedgerId: expect.stringMatching(/^custom-remote-/), bindingState: 'pending-reconcile', knownRemoteFolderIds: ['custom-b'] })
    ]))
  })

  it('recovers a numbered bilimi title as a shard of its default logical folder', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [
        { id: 'remote-b', title: 'bilimi·游戏专区②', itemCount: 1, isBilimiWorkFolder: true },
        { id: 'remote-a', title: 'bilimi·游戏专区', itemCount: 1, isBilimiWorkFolder: true }
      ]
    })
    await coordinator.recordManagedMembers('100', { 'remote-a': [1], 'remote-b': [2] })
    await coordinator.finishScan('100')

    const snapshot = await repository.getSnapshot('100')
    const gameShard = snapshot.physicalShards.find((shard) => shard.remoteFolderId === undefined && shard.knownRemoteFolderIds?.includes('remote-a'))!
    const numberedShard = snapshot.physicalShards.find((shard) => shard.remoteFolderId === undefined && shard.knownRemoteFolderIds?.includes('remote-b'))!
    expect(gameShard.logicalLedgerId).toBe('game')
    expect(numberedShard.logicalLedgerId).toBe('game')
    expect(snapshot.physicalShards).toEqual(expect.arrayContaining([
      expect.objectContaining({ logicalLedgerId: 'game', shardNumber: 1, knownRemoteFolderIds: ['remote-a'] }),
      expect.objectContaining({ logicalLedgerId: 'game', shardNumber: 2, knownRemoteFolderIds: ['remote-b'] })
    ]))
    expect(gameShard).toMatchObject({ bindingState: 'pending-reconcile' })
    expect(numberedShard).toMatchObject({ bindingState: 'pending-reconcile' })
    expect(gameShard.remoteFolderId).toBeUndefined()
    expect(numberedShard.remoteFolderId).toBeUndefined()
    expect(snapshot.memberships['bilimi-logical:game']).toEqual([])
    expect(snapshot.organizationRecords).toEqual([])
  })

  it('does not reconstruct a default folder whose deletion marker is persisted', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      getUserDeletedDefaultLedgerIds: () => ['music']
    })
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'remote-music', title: 'bilimi\u00b7音乐舞台', itemCount: 1, isBilimiWorkFolder: true }]
    })
    await coordinator.recordManagedMembers('100', { 'remote-music': [1] })

    await coordinator.finishScan('100')

    const snapshot = await repository.getSnapshot('100')
    expect(snapshot.physicalShards.some((shard) => shard.logicalLedgerId === 'music')).toBe(false)
    expect(snapshot.folders.some((folder) => folder.id === 'bilimi-logical:music')).toBe(false)
    expect(snapshot.folders.some((folder) => folder.title === 'bilimi\u00b7音乐舞台' && folder.kind === 'bilimi-logical')).toBe(false)
  })

  it('does not restore a deleted default folder from a completed scan when the account reopens', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(repository, store)
    await first.open('100')
    await first.recordScanInventory('100', {
      sourceFolders: [{ id: 'remote-music', title: 'bilimi\u00b7音乐舞台', itemCount: 1, isBilimiWorkFolder: true }]
    })
    await first.recordManagedMembers('100', { 'remote-music': [1] })
    await first.finishScan('100')
    const completedMarker = (await repository.getSnapshot('100')).workspace!
    await repository.commit('100', {
      id: 'clear-deleted-default-bindings', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'clear-local-repository',
      payload: { preserveTombstones: true }
    })
    await repository.commit('100', {
      id: 'restore-deleted-default-mirror', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'record-bilibili-mirror',
      payload: {
        workspaceId: 'legacy-workspace',
        folders: [{ id: 'bilibili:remote-music', title: 'bilimi\u00b7音乐舞台', remoteFolderId: 'remote-music' }],
        memberAidsByFolderId: { 'bilibili:remote-music': [1] },
        videos: [{ aid: 1, title: 'Video 1', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }]
      }
    })
    await repository.commit('100', {
      id: 'restore-deleted-default-workspace', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'set-workspace',
      payload: completedMarker
    })

    const reopened = createCoordinator(
      new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:01.000Z' }),
      new OldFavoriteWorkspaceStore({ root }),
      { initializeOnOpen: false, getUserDeletedDefaultLedgerIds: () => ['music'] }
    )
    await expect(reopened.recoverPersistedManagedBindings('100')).resolves.toEqual({ recoveredCount: 0, pendingCount: 0 })
    const restored = await repository.getSnapshot('100')
    expect(restored.physicalShards.some((shard) => shard.logicalLedgerId === 'music')).toBe(false)
    expect(restored.folders.some((folder) => folder.id === 'bilimi-logical:music')).toBe(false)
  })

  it('does not recover or persist a custom remote-observation draft for a confirmed deleted exact id', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(repository, store)
    await first.open('100')
    await first.recordScanInventory('100', {
      sourceFolders: [{ id: '4020631311', title: 'bilimi·知识学习你好', itemCount: 1, isBilimiWorkFolder: true }]
    })
    await first.recordManagedMembers('100', { '4020631311': [1] })
    await first.finishScan('100')
    const completedMarker = (await repository.getSnapshot('100')).workspace!
    await repository.commit('100', {
      id: 'clear-deleted-custom-observation', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'clear-local-repository',
      payload: { preserveTombstones: true }
    })
    await repository.commit('100', {
      id: 'restore-deleted-custom-workspace', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'set-workspace',
      payload: completedMarker
    })

    const reopened = createCoordinator(
      new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:01.000Z' }),
      new OldFavoriteWorkspaceStore({ root }),
      {
        initializeOnOpen: false,
        getConfirmedDeletedRemoteFolderIds: () => ['4020631311']
      }
    )

    await expect(reopened.recoverPersistedManagedBindings('100')).resolves.toEqual({ recoveredCount: 0, pendingCount: 0 })
    const restored = await repository.getSnapshot('100')
    expect(restored.physicalShards.some((shard) => shard.remoteFolderId === '4020631311' || shard.knownRemoteFolderIds?.includes('4020631311'))).toBe(false)
    expect(restored.folders.some((folder) => folder.logicalLedgerId === 'custom-remote-4020631311')).toBe(false)
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
      expect.objectContaining({ logicalLedgerId: 'inbox', bindingState: 'pending-reconcile', knownRemoteFolderIds: ['inbox-remote'] }),
      expect.objectContaining({ bindingState: 'pending-reconcile', knownRemoteFolderIds: ['genshin-remote'], logicalLedgerId: expect.stringMatching(/^custom-/) })
    ]))
    expect(snapshot.memberships[`bilimi-logical:${genshin.logicalLedgerId}`]).toEqual([])

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
      localDesiredFolderIds: [],
      remoteObservedPhysicalFolderIds: ['genshin-remote'],
      remoteObservedLogicalFolderIds: [],
      positionState: 'aligned'
    })
    expect(renamed.positions['100:3']).toMatchObject({
      localDesiredFolderIds: [],
      positionState: 'aligned'
    })
  })

  it('records one unbound custom workspace without saving an observation draft', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const ordinaryRules = createOrdinaryRuleDirectory()
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), ordinaryRules)
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'genshin-remote', title: 'bilimi\u00b7\u539f\u795e', itemCount: 2, isBilimiWorkFolder: true }]
    })
    await coordinator.recordManagedMembers('100', { 'genshin-remote': [2, 3] })

    await coordinator.finishScan('100')

    expect(ordinaryRules.current()).toEqual([])
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      physicalShards: expect.arrayContaining([
        expect.objectContaining({
          logicalLedgerId: 'custom-remote-genshin-remote',
          bindingState: 'pending-reconcile',
          knownRemoteFolderIds: ['genshin-remote']
        })
      ])
    })
  })

  it('recovers a pending custom workspace without saving an observation draft', async () => {
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

    const ordinaryRules = createOrdinaryRuleDirectory()
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), ordinaryRules)

    await coordinator.recoverPersistedManagedBindings('100')

    expect(ordinaryRules.current()).toEqual([])
  })

  it('does not repair a suppressed remote folder after its local managed folder was deleted', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const firstCoordinator = createCoordinator(repository, store)
    await firstCoordinator.open('100')
    await firstCoordinator.beginScan('100', 'incremental')
    await firstCoordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'deleted-recommendation-remote', title: 'bilimi·专属 UP 追更', itemCount: 1, isBilimiWorkFolder: true }]
    })
    await firstCoordinator.recordManagedMembers('100', { 'deleted-recommendation-remote': [7] })
    await firstCoordinator.finishScan('100')

    const beforeDelete = await repository.getSnapshot('100')
    const logicalFolderId = beforeDelete.folders.find((folder) => folder.kind === 'bilimi-logical' && folder.logicalLedgerId?.startsWith('custom-'))?.id
    if (!logicalFolderId) throw new Error('expected recovered custom logical folder')
    await repository.commit('100', {
      id: 'delete-recommendation-logical-folder', accountMid: '100', issuedAt: '2026-07-20T00:00:01.000Z',
      type: 'delete-local-managed-folders', payload: { logicalFolderIds: [logicalFolderId] }
    })

    const repair = vi.spyOn(repository, 'commit')
    const reopened = createCoordinator(repository, store, { initializeOnOpen: false })
    await reopened.recoverPersistedManagedBindings('100', { suppressedRemoteFolderIds: ['deleted-recommendation-remote'] })

    expect(repair.mock.calls.some(([, command]) => command.type === 'repair-persisted-managed-bindings' &&
      command.payload.bindings.some((binding) => binding.knownRemoteFolderIds?.includes('deleted-recommendation-remote') || binding.remoteFolderId === 'deleted-recommendation-remote'))).toBe(false)
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
    await expect(reopened.recoverPersistedManagedBindings('100')).resolves.toEqual({ recoveredCount: 0, pendingCount: 2 })
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
      expect.objectContaining({ logicalLedgerId: 'inbox', bindingState: 'pending-reconcile', knownRemoteFolderIds: ['inbox-remote'] }),
      expect.objectContaining({ logicalLedgerId: expect.stringMatching(/^custom-/), bindingState: 'pending-reconcile', knownRemoteFolderIds: ['genshin-remote'] })
    ]))
    expect(restored.positions['100:2']).toMatchObject({
      remoteObservedPhysicalFolderIds: ['genshin-remote'],
      remoteObservedLogicalFolderIds: []
    })
    expect(restored.positions['100:1']).toMatchObject({
      remoteObservedPhysicalFolderIds: ['inbox-remote', 'ordinary-remote'],
      remoteObservedLogicalFolderIds: []
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
    await expect(reopened.recoverPersistedManagedBindings('100')).resolves.toEqual({ recoveredCount: 0, pendingCount: 101 })

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
    await expect(reopened.recoverPersistedManagedBindings('100')).resolves.toEqual({ recoveredCount: 0, pendingCount: 1 })

    expect(commit).toHaveBeenCalledTimes(2)
    expect(commit.mock.calls.map(([, command]) => command.type)).toEqual([
      'repair-persisted-managed-bindings', 'set-favorite-placements'
    ])
    await expect(reopenedRepository.getSnapshot('100')).resolves.toMatchObject({
      positions: { '100:501': { remoteObservedPhysicalFolderIds: ['inbox-remote'], remoteObservedLogicalFolderIds: [] } }
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
        remoteObservedLogicalFolderIds: [],
        updatedAt: '2026-07-20T00:01:00.000Z'
      }
    })

    await coordinator.recoverPersistedManagedBindings('100')

    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      positions: {
        '100:1': {
          localDesiredFolderIds: ['bilimi-logical:inbox'],
          remoteObservedPhysicalFolderIds: ['inbox-remote'],
          remoteObservedLogicalFolderIds: []
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
    await coordinator.acceptCurrentTags('100')
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
    await coordinator.acceptCurrentTags('100')
    await coordinator.selectSourceFolders('100', ['source-a'])

    await expect(coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 2, targetLedgerIds: ['music'] }]
    })).rejects.toThrow('selected sources')
    await expect(coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })).resolves.toMatchObject({ classifications: { '1': { targetLedgerIds: ['music'] } } })
  })

  it('recalculates plan readiness from selected source items only', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
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
    await coordinator.acceptCurrentTags('100')
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [
        { aid: 1, targetLedgerIds: ['music'] },
        { aid: 2, targetLedgerIds: ['knowledge'] }
      ]
    })

    await coordinator.selectSourceFolders('100', ['source-a'])

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      planReadiness: { selectedAidCount: 1, classifiedAidCount: 1, unclassifiedAidCount: 0 }
    })
  })

  it('automatically classifies only selected current-segment items with the latest run taking precedence', async () => {
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
    await coordinator.acceptCurrentTags('100')
    await coordinator.selectSourceFolders('100', ['source-a'])
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 2, targetLedgerIds: ['manual-music'] }]
    })

    await coordinator.autoClassifyCurrentSegment('100')

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      classifications: {
        '1': { targetLedgerIds: ['knowledge'], source: 'system-high' },
        '2': { targetLedgerIds: ['music'], source: 'system-low' }
      },
      history: { cursor: 4, length: 4 }
    })
    expect(classifyCurrentItem).toHaveBeenCalledTimes(5)
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
    await expect(resumed.getSnapshot('100')).resolves.toMatchObject({
      status: 'scanning', scan: { paused: true, scannedItemCount: 1 }
    })
    await expect(resumed.resumeScan('100')).resolves.toMatchObject({ status: 'scanning', scan: { scannedItemCount: 1 } })
    await expect(resumed.getActiveScanRunId('100')).resolves.toBe(runId)
    await expect(resumed.getScanResumeState('100')).resolves.toEqual({
      runId, completedPages: [{ folderId: 'source', page: 1, hasMore: false }], taggedAids: [1]
    })
  })

  it('lets a later favorite-rule reclassification replace manual and DeepSeek classifications', async () => {
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
    await coordinator.acceptCurrentTags('100')
    await coordinator.applyClassificationBatch('100', { source: 'manual', assignments: [{ aid: 2, targetLedgerIds: ['manual'] }] })
    const beforeDeepSeek = requireSnapshot(await coordinator.getSnapshot('100'))
    if (!beforeDeepSeek.currentSegment) throw new Error('workspace unexpectedly unavailable')
    const expectedClassifications = Object.fromEntries(Object.entries(beforeDeepSeek.classifications).map(([aid, classification]) => [aid, {
      targetLedgerIds: [...classification.targetLedgerIds].sort(), source: classification.source
    }]))
    const expectedSelectedSourceFolderIds = beforeDeepSeek.sourceFolders
      .filter((folder) => !folder.isBilimiWorkFolder && folder.selected)
      .map((folder) => folder.id)
    await coordinator.applyDeepSeekClassificationBatch('100', [{ aid: 3, targetLedgerIds: ['deepseek'] }], {
      workspaceId: beforeDeepSeek.workspaceId,
      currentSegmentId: beforeDeepSeek.currentSegment.id,
      selectedSourceFolderIds: expectedSelectedSourceFolderIds,
      classifications: expectedClassifications
    })

    await coordinator.reclassifyForFavoriteConfiguration('100')

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({ classifications: {
      '1': { targetLedgerIds: ['knowledge'], source: 'system-high' },
      '2': { targetLedgerIds: ['music'], source: 'system-high' },
      '3': { targetLedgerIds: ['music'], source: 'system-high' }
    } })
  })

  it('reclassifies a completed round after a saved rule configuration change', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      classifyCurrentItem: (item) => ({
        targetLedgerIds: [item.title === 'Move me' ? 'updated-rule' : 'other-rule'],
        confidence: 'high'
      })
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanPage('100', { folderId: 'source', page: 1, items: [
      { aid: 1, title: 'Move me', sourceFolderIds: ['source'] }
    ] })
    await coordinator.finishScan('100')
    await coordinator.acceptCurrentTags('100')
    const marker = (await repository.getSnapshot('100')).workspace!
    await repository.commit('100', {
      id: 'complete-reclassification-regression', accountMid: '100',
      issuedAt: '2026-07-20T00:00:00.000Z', type: 'set-workspace',
      payload: { ...marker, status: 'completed', workspaceRef: { ...marker.workspaceRef, status: 'completed' } }
    })
    const reopened = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      classifyCurrentItem: () => ({ targetLedgerIds: ['updated-rule'], confidence: 'high' })
    })

    await reopened.open('100')
    await expect(reopened.reclassifyForFavoriteConfiguration('100')).resolves.toMatchObject({ status: 'completed' })
    await expect(reopened.getSnapshot('100')).resolves.toMatchObject({
      status: 'completed', classifications: { '1': { targetLedgerIds: ['updated-rule'], source: 'system-high' } },
      overview: { archiveTargets: expect.arrayContaining([expect.objectContaining({ ledgerId: 'updated-rule', itemCount: 1 })]) }
    })
  })

  it('withdraws an adopted recommendation by the deleted saved rule semantics before reclassifying the preview', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      classifyCurrentItem: (_item, recommendedLedgers = []) => recommendedLedgers.some((ledger) =>
        ledger.ruleType === 'author' && ledger.keywords.includes('UP Alpha')
      )
        ? { targetLedgerIds: [recommendedLedgers.find((ledger) => ledger.ruleType === 'author')!.id], confidence: 'high' as const }
        : { targetLedgerIds: ['remaining-ledger'], confidence: 'high' as const }
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
    await coordinator.acceptCurrentTags('100')
    await coordinator.setRecommendedCandidates('100', ['custom-author-up-alpha'])
    const adopted = requireSnapshot(await coordinator.getSnapshot('100'))
    const adoptedLedgerId = adopted.recommendations.links?.['custom-author-up-alpha']?.status === 'linked'
      ? adopted.recommendations.links['custom-author-up-alpha'].ledgerId
      : undefined
    if (!adoptedLedgerId) throw new Error('adopted recommendation rule unexpectedly unavailable')

    await coordinator.reconcileDeletedFavoriteLedgerRules('100', [{
      id: adoptedLedgerId, ruleType: 'author', keywords: [' UP Alpha ']
    }])

    const snapshot = requireSnapshot(await coordinator.getSnapshot('100'))
    expect(snapshot.recommendations.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'custom-author-up-alpha', kind: 'author', keywords: ['UP Alpha'], count: 2 })
    ]))
    expect(snapshot.recommendations.adoptedCandidateIds).not.toContain('custom-author-up-alpha')
    expect(snapshot.classifications).toEqual({
      '1': { aid: 1, targetLedgerIds: ['remaining-ledger'], source: 'system-high' },
      '2': { aid: 2, targetLedgerIds: ['remaining-ledger'], source: 'system-high' }
    })
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'alpha1' })
    await bindings.preparePhysicalShard('100', {
      logicalLedgerId: 'remaining-ledger', logicalTitle: 'Remaining ledger', shardNumber: 1, memberAids: [],
      observedAccountMid: '100', remoteFolderId: 'remote-remaining-1', inventory: [{
        id: 'remote-remaining-1', title: favoriteRepositoryManagedShardTitle('remaining-ledger', 1, 'alpha1'), memberCount: 0, memberAids: []
      }]
    })
    await expect(coordinator.getBilibiliExecutionPreflight('100')).resolves.toMatchObject({
      missingLedgers: [], requiredPhysicalShards: []
    })
    await expect(coordinator.freezeForBilibiliExecution('100')).resolves.toMatchObject({
      frozenSyncPlan: {
        operations: [
          { aid: 1, folderIds: ['remote-remaining-1'] },
          { aid: 2, folderIds: ['remote-remaining-1'] }
        ]
      }
    })
  })

  it('withdraws every linked recommendation when its single ordinary rule is deleted', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const rules = createOrdinaryRuleDirectory([ordinaryAuthorLedger('saved-up-alpha', 'UP Alpha', true)])
    const coordinator = createCoordinator(repository, store, {
      ...rules,
      classifyCurrentItem: (_item, recommendedLedgers = []) => ({
        targetLedgerIds: recommendedLedgers.map((ledger) => ledger.id), confidence: 'high' as const
      })
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
    await coordinator.acceptCurrentTags('100')
    const first = requireSnapshot(await coordinator.getSnapshot('100'))
    const candidateA = first.recommendations.candidates.find((candidate) => candidate.id === 'custom-author-up-alpha')
    if (!candidateA) throw new Error('recommendation unexpectedly unavailable')
    const candidateB = {
      ...candidateA,
      id: 'custom-author-up-alpha-alias',
      displayName: candidateA.displayName
    }
    await coordinator.setRecommendedCandidates('100', [candidateA.id])
    await store.appendOverlay('100', first.workspaceId, {
      currentSegmentId: 'segment-1', classifications: [], history: [],
      recommendations: {
        initialized: true,
        candidates: [candidateA, candidateB],
        adoptedCandidateIds: [candidateA.id, candidateB.id]
      }
    })

    const restarted = createCoordinator(repository, store, {
      initializeOnOpen: false,
      ...rules,
      classifyCurrentItem: (_item, recommendedLedgers = []) => ({
        targetLedgerIds: recommendedLedgers.map((ledger) => ledger.id), confidence: 'high' as const
      })
    })
    await restarted.getSnapshot('100')
    await restarted.reconcileDeletedFavoriteLedgerRules('100', [{
      id: 'saved-up-alpha', ruleType: 'author', keywords: [' UP Alpha ']
    }])

    const snapshot = requireSnapshot(await restarted.getSnapshot('100'))
    expect(snapshot.recommendations.adoptedCandidateIds).not.toContain(candidateA.id)
    expect(snapshot.recommendations.adoptedCandidateIds).not.toContain(candidateB.id)
  })

  it('keeps the preview recommendation and classifications when deleted-rule reconciliation cannot reclassify', async () => {
    const root = await createRoot()
    let failReclassification = false
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      classifyCurrentItem: (_item, recommendedLedgers = []) => {
        if (failReclassification) throw new Error('simulated reclassification failure')
        return recommendedLedgers.some((ledger) => ledger.id === 'custom-author-up-alpha')
          ? { targetLedgerIds: ['custom-author-up-alpha'], confidence: 'high' as const }
          : { targetLedgerIds: ['remaining-ledger'], confidence: 'high' as const }
      }
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
    await coordinator.acceptCurrentTags('100')
    await coordinator.setRecommendedCandidates('100', ['custom-author-up-alpha'])
    const before = requireSnapshot(await coordinator.getSnapshot('100'))
    failReclassification = true

    await expect(coordinator.reconcileDeletedFavoriteLedgerRules('100', [{
      id: 'saved-up-alpha', ruleType: 'author', keywords: ['UP Alpha']
    }])).rejects.toThrow('simulated reclassification failure')

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      recommendations: { adoptedCandidateIds: ['custom-author-up-alpha'] },
      classifications: before.classifications
    })
  })

  it('lets a completed saved-rule analysis replace an affected manual classification across the current round', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      classifyCurrentItems: (items, ledgers) => items.map((item) => ({
        targetLedgerIds: ledgers.some((ledger) => ledger.displayName === 'bilimi·Alpha') && item.aid === 1
          ? [ledgers.find((ledger) => ledger.displayName === 'bilimi·Alpha')!.id]
          : ['music'],
        confidence: 'high' as const
      }))
    })
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanPage('100', { folderId: 'source', page: 1, items: [
      { aid: 1, title: 'Alpha entry', sourceFolderIds: ['source'] },
      { aid: 2, title: 'Manual entry', sourceFolderIds: ['source'] }
    ] })
    await coordinator.finishScan('100')
    await coordinator.acceptCurrentTags('100')
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['manual'] }]
    })

    await coordinator.saveDraftLedgerRule('100', {
      analysisId: 'analysis-alpha-replaces-manual',
      title: 'Alpha',
      keywords: ['Alpha'],
      ruleType: 'keyword'
    })

    const snapshot = requireSnapshot(await coordinator.getSnapshot('100'))
    // This is a user-created keyword rule, not a scan recommendation. Its
    // deterministic ordinary-rule ID must be used directly; no candidate link
    // exists for a scan with neither author nor tag recommendations.
    const savedRuleId = 'local-alpha'
    expect(snapshot).toMatchObject({ classifications: {
      '1': { targetLedgerIds: [savedRuleId], source: 'system-high' },
      '2': { targetLedgerIds: ['music'], source: 'system-high' }
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
    await coordinator.acceptCurrentTags('100')

    await coordinator.autoClassifyCurrentSegment('100')

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      classifications: { '1': { targetLedgerIds: ['music'], source: 'system-low' } },
      history: { cursor: 1, length: 1, entries: [] }
    })
  })

  it('persists whole-round author recommendations and applies the latest recommendation choice', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    const classifyCurrentItem = vi.fn((item: { author?: string }, recommendedLedgers: Array<{ id: string }> = []) => {
      const authorLedger = recommendedLedgers[0]
      return authorLedger && item.author === 'UP Alpha'
        ? { targetLedgerIds: [authorLedger.id], confidence: 'high' as const }
        : { targetLedgerIds: [], confidence: 'low' as const }
    })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      bindingService: bindings, classifyCurrentItem,
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
    await coordinator.acceptCurrentTags('100')
    await coordinator.selectSourceFolders('100', ['source-a'])
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 2, targetLedgerIds: ['manual'] }]
    })
    await coordinator.autoClassifyCurrentSegment('100')
    await coordinator.setRecommendedCandidates('100', ['custom-author-up-alpha'])
    await coordinator.prepareRecommendationPreview('100', ['custom-author-up-alpha'])

    const selected = requireSnapshot(await coordinator.getSnapshot('100'))
    const selectedLedgerId = requireLinkedRecommendationLedgerId(selected, 'custom-author-up-alpha')
    expect(selected).toMatchObject({
      recommendations: {
        candidates: [expect.objectContaining({
          id: 'custom-author-up-alpha', kind: 'author', count: 2
        })],
        adoptedCandidateIds: ['custom-author-up-alpha']
      },
      classifications: {
        '1': { targetLedgerIds: [selectedLedgerId], source: 'system-high' },
        '2': { targetLedgerIds: [selectedLedgerId], source: 'system-high' }
      }
    })
    expect(classifyCurrentItem).toHaveBeenCalledWith(
      expect.objectContaining({ aid: 1 }),
      expect.arrayContaining([expect.objectContaining({ id: selectedLedgerId })])
    )

    await coordinator.setRecommendedCandidates('100', [])
    await coordinator.prepareRecommendationPreview('100', [])
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      recommendations: { adoptedCandidateIds: [] },
      classifications: {
        '1': { targetLedgerIds: [], source: 'system-low' },
        '2': { targetLedgerIds: [], source: 'system-low' }
      }
    })

    await bindings.preparePhysicalShard('100', {
      logicalLedgerId: 'manual', logicalTitle: 'bilimi·人工调整', shardNumber: 1, memberAids: [], observedAccountMid: '100',
      remoteFolderId: 'remote-manual', inventory: [{
        id: 'remote-manual', title: favoriteRepositoryManagedShardTitle('manual', 1, 'a1b2c3'), memberCount: 0, memberAids: []
      }]
    })
    await expect(coordinator.freezeForBilibiliExecution('100')).resolves.toMatchObject({
      frozenSyncPlan: { operations: [] }
    })
    expect((await repository.getSnapshot('100')).workspace?.frozenSyncPlan?.operations).toHaveLength(0)
  })

  it('merges a saved-rule selection transition into the classification move it caused', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const classifyCurrentItem = vi.fn((item: { author?: string }, recommendedLedgers: Array<{ id: string }> = []) => ({
      targetLedgerIds: item.author === 'UP Alpha' && recommendedLedgers[0]
        ? [recommendedLedgers[0].id]
        : [],
      confidence: 'high' as const
    }))
    const restoreFavoriteLedgerHistoryState = vi.fn().mockResolvedValue(undefined)
    let savedRuleIsEnabled = false
    const rules = createOrdinaryRuleDirectory([ordinaryAuthorLedger('saved-up-alpha', 'UP Alpha', false)])
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      classifyCurrentItem,
      restoreFavoriteLedgerHistoryState,
      ...rules,
      listSavedEnabledLedgers: vi.fn(async () => savedRuleIsEnabled ? [{
        id: 'saved-up-alpha', displayName: 'bilimi·UP Alpha', enabled: true
      }] : []),
      loadFavoriteLedgerHistoryLedgers: vi.fn(async () => [ordinaryAuthorLedger('saved-up-alpha', 'UP Alpha', savedRuleIsEnabled)])
    })
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'One', author: 'UP Alpha', tags: ['ready'], sourceFolderIds: ['source'] },
        { aid: 2, title: 'Two', author: 'UP Alpha', tags: ['ready'], sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')
    await coordinator.acceptCurrentTags('100')
    const historyLengthBeforeSelection = requireSnapshot(await coordinator.getSnapshot('100')).history.length
    // The round started while this rule was disabled, so it must not be
    // hydrated as an adopted recommendation. Simulate the account-level
    // enable save reaching the coordinator before the linked selection command.
    savedRuleIsEnabled = true
    await rules.applyFavoriteRecommendationRuleChanges('100', { upserts: [], enabled: [{ ledgerId: 'saved-up-alpha', enabled: true }] })

    await coordinator.setRecommendedCandidates('100', ['custom-author-up-alpha'])
    const linkedLedgerId = requireLinkedRecommendationLedgerId(
      requireSnapshot(await coordinator.getSnapshot('100')),
      'custom-author-up-alpha'
    )
    expect(linkedLedgerId).toBe('saved-up-alpha')
    const afterRecommendation = requireSnapshot(await coordinator.getSnapshot('100'))
    expect(afterRecommendation.history.length).toBe(historyLengthBeforeSelection + 1)
    expect(afterRecommendation.history.entries.at(-1)).toMatchObject({
      source: 'favorite-rules',
      changeCount: 2,
      targetLedgerIds: [linkedLedgerId],
      summary: expect.objectContaining({
        movedCount: 2,
        favoriteRule: expect.objectContaining({
          action: 'checked',
          movementGroups: [{
            beforeTargetLedgerIds: [],
            afterTargetLedgerIds: [linkedLedgerId],
            count: 2
          }]
        })
      })
    })

    await coordinator.setRoundExcludedLedgerIds('100', [linkedLedgerId], { mergeWithLatestClassification: true })
    const afterExclusion = requireSnapshot(await coordinator.getSnapshot('100'))
    expect(afterExclusion.history.length).toBe(historyLengthBeforeSelection + 1)
    expect(afterExclusion.history.entries.at(-1)).toMatchObject({
      source: 'favorite-rules',
      changeCount: 2,
      targetLedgerIds: [linkedLedgerId]
    })
    await coordinator.moveHistoryCursor('100', historyLengthBeforeSelection)
    await coordinator.moveHistoryCursor('100', historyLengthBeforeSelection + 1)
    expect(restoreFavoriteLedgerHistoryState.mock.calls).toEqual(expect.arrayContaining([
      ['100', expect.objectContaining({ adoptedCandidateIds: ['custom-author-up-alpha'], excludedLedgerIds: [linkedLedgerId] })]
    ]))
  })

  it('reclassifies a saved-rule cancellation to another active saved rule and records the move', async () => {
    const root = await createRoot()
    const classifyCurrentItems = vi.fn((
      items: Array<{ aid: number }>,
      _recommendedLedgers: Array<{ id: string }>,
      _accountMid: string,
      options?: { participatingSavedLedgerIds?: readonly string[] }
    ) => {
      const participating = new Set(options?.participatingSavedLedgerIds ?? ['game', 'music'])
      return items.map(() => ({
        targetLedgerIds: [participating.has('game') ? 'game' : 'music'],
        confidence: 'high' as const
      }))
    })
    const coordinator = createCoordinator(
      new FavoriteRepositoryService({ root, now: () => '2026-08-27T00:00:00.000Z' }),
      new OldFavoriteWorkspaceStore({ root }),
      {
        classifyCurrentItems,
        listSavedLedgers: vi.fn().mockResolvedValue([
          { id: 'game', title: 'bilimi·游戏专区' },
          { id: 'music', title: 'bilimi·音乐' }
        ]),
        loadFavoriteLedgerHistoryLedgers: vi.fn().mockResolvedValue([
          { id: 'game', displayName: 'bilimi·游戏专区', keywords: ['游戏'], ruleType: 'keyword', enabled: true, priority: 20, ruleOrigin: 'saved-rule', bindingState: 'unbacked', isDefault: false },
          { id: 'music', displayName: 'bilimi·音乐', keywords: ['音乐'], ruleType: 'keyword', enabled: true, priority: 10, ruleOrigin: 'saved-rule', bindingState: 'unbacked', isDefault: false }
        ] as FavoriteLedger[])
      }
    )
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: '来源', itemCount: 1, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [{ aid: 1, title: '游戏视频', sourceFolderIds: ['source'] }]
    })
    await coordinator.finishScan('100')
    await coordinator.acceptCurrentTags('100')
    expect(requireSnapshot(await coordinator.getSnapshot('100')).classifications).toMatchObject({
      '1': { targetLedgerIds: ['game'], source: 'system-high' }
    })

    await coordinator.setRoundExcludedLedgerIds('100', ['game'])

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      classifications: { '1': { targetLedgerIds: ['music'], source: 'system-high' } },
      history: {
        entries: [expect.objectContaining({
          source: 'favorite-rules',
          summary: expect.objectContaining({
            favoriteRule: expect.objectContaining({
              action: 'unchecked',
              title: 'bilimi·游戏专区',
              movementGroups: [{ beforeTargetLedgerIds: ['game'], afterTargetLedgerIds: ['music'], count: 1 }]
            })
          })
        })]
      }
    })
    expect(classifyCurrentItems).toHaveBeenLastCalledWith(expect.any(Array), expect.any(Array), '100',
      expect.objectContaining({ participatingSavedLedgerIds: ['music'] }))
  })

  it('does not add a history cursor for favorite-rule state changes when no video moved', async () => {
    const root = await createRoot()
    const restoreFavoriteLedgerHistoryState = vi.fn().mockResolvedValue(undefined)
    const coordinator = createCoordinator(
      new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' }),
      new OldFavoriteWorkspaceStore({ root }),
      {
        loadFavoriteLedgerHistoryLedgers: vi.fn().mockResolvedValue([]),
        restoreFavoriteLedgerHistoryState
      }
    )
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [{ aid: 1, title: 'One', author: 'UP Alpha', tags: ['ready'], sourceFolderIds: ['source'] }]
    })
    await coordinator.finishScan('100')
    await coordinator.acceptCurrentTags('100')
    const baselineLength = requireSnapshot(await coordinator.getSnapshot('100')).history.length
    const before = {
      ledgers: [{ id: 'saved-honker', displayName: 'bilimi·honker233', keywords: ['honker233'], ruleType: 'author' as const,
        enabled: true, priority: 10_000, ruleOrigin: 'saved-rule' as const, bindingState: 'unbacked' as const, isDefault: false }],
      adoptedCandidateIds: [], excludedLedgerIds: []
    }
    const enabledOff = {
      ...before,
      ledgers: before.ledgers.map((ledger) => ({ ...ledger, enabled: false }))
    }
    const excluded = { ...enabledOff, excludedLedgerIds: ['saved-honker'] }

    await coordinator.recordFavoriteLedgerHistoryChange('100', { before, after: enabledOff })
    await coordinator.recordFavoriteLedgerHistoryChange('100', {
      before: enabledOff,
      after: excluded,
      mergeWithLatestClassification: true
    })

    const snapshot = requireSnapshot(await coordinator.getSnapshot('100'))
    expect(snapshot.history).toMatchObject({ length: baselineLength, cursor: baselineLength, entries: [] })
    expect(restoreFavoriteLedgerHistoryState).not.toHaveBeenCalled()
  })

  it('does not create legacy favorite-rule intermediate checkpoints when no video moved', async () => {
    const root = await createRoot()
    const restoreFavoriteLedgerHistoryState = vi.fn().mockResolvedValue(undefined)
    const coordinator = createCoordinator(
      new FavoriteRepositoryService({ root, now: () => '2026-08-27T00:00:00.000Z' }),
      new OldFavoriteWorkspaceStore({ root }),
      {
        loadFavoriteLedgerHistoryLedgers: vi.fn().mockResolvedValue([]),
        restoreFavoriteLedgerHistoryState
      }
    )
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [{ aid: 1, title: 'One', author: 'honker233', tags: ['ready'], sourceFolderIds: ['source'] }]
    })
    await coordinator.finishScan('100')
    await coordinator.acceptCurrentTags('100')
    const baselineLength = requireSnapshot(await coordinator.getSnapshot('100')).history.length
    const initial = {
      ledgers: [{
        id: 'saved-honker', displayName: 'bilimi·honker233', keywords: ['honker233'], ruleType: 'author' as const,
        enabled: true, priority: 10_000, ruleOrigin: 'saved-rule' as const, bindingState: 'unbacked' as const, isDefault: false
      }],
      adoptedCandidateIds: ['saved-honker'],
      excludedLedgerIds: []
    }
    const recommendationCancelled = { ...initial, adoptedCandidateIds: [] }
    const roundExcluded = { ...recommendationCancelled, excludedLedgerIds: ['saved-honker'] }
    const fullyCancelled = {
      ...roundExcluded,
      ledgers: roundExcluded.ledgers.map((ledger) => ({ ...ledger, enabled: false }))
    }

    // Repeated rule-only writes must not create any selectable historical
    // position. The rule mutations themselves are owned by their callers.
    await coordinator.recordFavoriteLedgerHistoryChange('100', { before: initial, after: recommendationCancelled })
    await coordinator.recordFavoriteLedgerHistoryChange('100', { before: recommendationCancelled, after: roundExcluded })
    await coordinator.recordFavoriteLedgerHistoryChange('100', { before: roundExcluded, after: fullyCancelled })

    const snapshot = requireSnapshot(await coordinator.getSnapshot('100'))
    expect(snapshot.history).toMatchObject({ length: baselineLength, cursor: baselineLength, entries: [] })
    expect(restoreFavoriteLedgerHistoryState).not.toHaveBeenCalled()
  })

  it('does not record a semantic no-op favorite-rule checkpoint with reordered fields', async () => {
    const root = await createRoot()
    const coordinator = createCoordinator(
      new FavoriteRepositoryService({ root, now: () => '2026-08-27T00:00:00.000Z' }),
      new OldFavoriteWorkspaceStore({ root }),
      { loadFavoriteLedgerHistoryLedgers: vi.fn().mockResolvedValue([]) }
    )
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [{ aid: 1, title: 'One', author: 'honker233', tags: ['ready'], sourceFolderIds: ['source'] }]
    })
    await coordinator.finishScan('100')
    await coordinator.acceptCurrentTags('100')
    const baselineLength = requireSnapshot(await coordinator.getSnapshot('100')).history.length
    const before = {
      ledgers: [{
        id: 'saved-honker', displayName: 'bilimi·honker233', keywords: ['honker233'], ruleType: 'author' as const,
        enabled: true, priority: 10_000, ruleOrigin: 'saved-rule' as const, bindingState: 'unbacked' as const, isDefault: false
      }],
      adoptedCandidateIds: ['saved-honker'],
      excludedLedgerIds: []
    }
    const after = {
      ledgers: [{
        displayName: 'bilimi·honker233', id: 'saved-honker', isDefault: false, bindingState: 'unbacked' as const,
        ruleOrigin: 'saved-rule' as const, priority: 10_000, enabled: true, ruleType: 'author' as const, keywords: ['honker233']
      }],
      adoptedCandidateIds: ['saved-honker'],
      excludedLedgerIds: []
    }

    await coordinator.recordFavoriteLedgerHistoryChange('100', { before, after })

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      history: { length: baselineLength, entries: [] }
    })
  })

  it('applies an indexed recommendation without preview preparation', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const classifyCurrentItems = vi.fn((items: Array<{ aid: number; author?: string }>, recommendedLedgers: Array<{ id: string }>) =>
      items.map((item) => ({
        targetLedgerIds: item.author === 'UP Alpha' && recommendedLedgers[0]
          ? [recommendedLedgers[0].id]
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
    await coordinator.acceptCurrentTags('100')
    const before = await coordinator.getSnapshot('100')

    await coordinator.setRecommendedCandidates('100', ['custom-author-up-alpha'])
    const selected = requireSnapshot(await coordinator.getSnapshot('100'))
    const linkedLedgerId = requireLinkedRecommendationLedgerId(selected, 'custom-author-up-alpha')

    expect(classifyCurrentItems).toHaveBeenLastCalledWith(
      [expect.objectContaining({ aid: 1 }), expect.objectContaining({ aid: 2 })],
      [expect.objectContaining({ id: linkedLedgerId })],
      '100',
      { excludedRecommendedLedgers: [] }
    )
    expect(selected).toMatchObject({
      recommendations: { adoptedCandidateIds: ['custom-author-up-alpha'] },
      classifications: {
        ...(before && !('recovery' in before) ? before.classifications : {}),
        '1': { targetLedgerIds: [linkedLedgerId], source: 'system-low' },
        '2': { targetLedgerIds: [linkedLedgerId], source: 'system-low' }
      }
    })
  })

  it('classifies a first adopted recommendation immediately and preserves its local-draft remote lifecycle', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-08-28T00:00:00.000Z' })
    const savedLedgers: FavoriteLedger[] = [{
      id: 'game', displayName: 'bilimi·游戏专区', keywords: ['UP Alpha'], ruleType: 'keyword',
      enabled: true, priority: 100, isDefault: true
    }]
    const persistedRecommendations: FavoriteLedger[][] = []
    const classifyCurrentItems: NonNullable<ConstructorParameters<typeof OldFavoriteWorkspaceCoordinator>[0]['classifyCurrentItems']> =
      async (items, recommendedLedgers, _accountMid, options) => {
        const ledgers = mergeOldFavoriteWorkspaceLedgers(
          classifierLedgersForAccount(savedLedgers, true),
          recommendedLedgers,
          options?.excludedRecommendedLedgers
        )
        return classifyOldFavoriteItemsCooperatively(items, (batch) => batch.map((item) => {
          const classification = classifyVideoContent({
            title: item.title,
            author: item.author,
            tags: item.tags,
            category: item.category
          }, ledgers)
          return classification.ledgerId === 'inbox'
            ? { targetLedgerIds: [], confidence: 'low' as const }
            : {
                targetLedgerIds: [classification.ledgerId],
                confidence: classification.diagnostic?.confidence === 'high' ? 'high' as const : 'low' as const
              }
        }), options)
      }
    const saveRecommendedLedgers: NonNullable<ConstructorParameters<typeof OldFavoriteWorkspaceCoordinator>[0]['saveRecommendedLedgers']> =
      vi.fn(async (_accountMid, ledgers) => {
        const persisted = ledgers.map((ledger) => ({ ...ledger, keywords: [...ledger.keywords] }))
        persistedRecommendations.push(persisted)
        savedLedgers.splice(1, savedLedgers.length, ...persisted)
        return true
      })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false,
      classifyCurrentItems,
      saveRecommendedLedgers,
      segmentSize: () => 500,
      listSavedLedgers: async () => savedLedgers.map((ledger) => ({ id: ledger.id, title: ledger.displayName })),
      listSavedEnabledLedgers: async () => savedLedgers.filter((ledger) => ledger.enabled)
        .map((ledger) => ({ id: ledger.id, title: ledger.displayName }))
    })

    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 501, isBilimiWorkFolder: false, selected: true }]
    })
    const items = Array.from({ length: 501 }, (_unused, index) => ({
      aid: index + 1,
      title: `Video ${index + 1}`,
      ...(index < 2 ? { author: 'UP Alpha' } : { author: 'UP Beta' }),
      sourceFolderIds: ['source']
    }))
    for (let offset = 0; offset < items.length; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source', page: offset / 50 + 1, hasMore: offset + 50 < items.length,
        items: items.slice(offset, offset + 50)
      })
    }
    await coordinator.finishScan('100')
    await coordinator.acceptCurrentTags('100')
    const initial = requireSnapshot(await coordinator.getSnapshot('100'))
    expect(initial.classifications).toMatchObject({
      '1': { targetLedgerIds: ['game'] },
      '2': { targetLedgerIds: ['game'] }
    })
    const candidate = initial.recommendations.candidates.find((item) => item.id === 'custom-author-up-alpha')
    if (!candidate) throw new Error('UP Alpha recommendation unexpectedly unavailable')

    await coordinator.setRecommendedCandidates('100', [candidate.id])
    const immediatelySelected = requireSnapshot(await coordinator.getSnapshot('100'))
    const linkedLedgerId = requireLinkedRecommendationLedgerId(immediatelySelected, candidate.id)
    expect(immediatelySelected.classifications).toMatchObject({
      '1': { targetLedgerIds: [linkedLedgerId] },
      '2': { targetLedgerIds: [linkedLedgerId] }
    })
    expect(immediatelySelected.overview?.archiveTargets).toEqual(expect.arrayContaining([
      expect.objectContaining({ ledgerId: linkedLedgerId, itemCount: 2 })
    ]))
    expect(persistedRecommendations).toEqual([])

    await coordinator.setRoundExcludedLedgerIds('100', [], {
      participatingSavedLedgerIds: ['game', linkedLedgerId]
    })
    const afterSavedRuleParticipationRefresh = requireSnapshot(await coordinator.getSnapshot('100'))
    expect(afterSavedRuleParticipationRefresh.classifications).toMatchObject({
      '1': { targetLedgerIds: [linkedLedgerId] },
      '2': { targetLedgerIds: [linkedLedgerId] }
    })
    expect(afterSavedRuleParticipationRefresh.overview?.archiveTargets).toEqual(expect.arrayContaining([
      expect.objectContaining({ ledgerId: linkedLedgerId, itemCount: 2 })
    ]))
  })

  it('projects adopted recommendation members into the archive overview immediately', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root })
    const classifyCurrentItems = vi.fn((items: Array<{ aid: number }>, recommendedLedgers: Array<{ id: string }>) =>
      items.map((item) => ({
        targetLedgerIds: recommendedLedgers[0] && item.aid <= 2 ? [recommendedLedgers[0].id] : [],
        confidence: 'high' as const
      })))
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false, classifyCurrentItems, segmentSize: () => 500
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 501, isBilimiWorkFolder: false, selected: true }]
    })
    const items = Array.from({ length: 501 }, (_unused, index) => ({
      aid: index + 1,
      title: `Video ${index + 1}`,
      ...(index < 2 ? { author: 'UP Alpha' } : {}),
      sourceFolderIds: ['source']
    }))
    for (let offset = 0; offset < items.length; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source', page: offset / 50 + 1, hasMore: offset + 50 < items.length,
        items: items.slice(offset, offset + 50)
      })
    }
    await coordinator.finishScan('100')
    await coordinator.acceptCurrentTags('100')
    const initial = requireSnapshot(await coordinator.getSnapshot('100'))
    expect(initial.segments).toHaveLength(2)
    const candidate = initial.recommendations.candidates.find((item) => item.id === 'custom-author-up-alpha')
    if (!candidate) throw new Error('UP Alpha recommendation unexpectedly unavailable')

    await coordinator.setRecommendedCandidates('100', [candidate.id])
    const selected = requireSnapshot(await coordinator.getSnapshot('100'))
    const linkedLedgerId = requireLinkedRecommendationLedgerId(selected, candidate.id)
    expect(selected.overview?.archiveTargets).toEqual(expect.arrayContaining([
      expect.objectContaining({ ledgerId: linkedLedgerId, itemCount: 2 })
    ]))
  })

  it('includes an adopted local recommendation in backup preflight even when its archive count is zero', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const savedLedgers: FavoriteLedger[] = [
      { id: 'game', displayName: 'bilimi·游戏专区', keywords: ['游戏'], enabled: true, priority: 10, isDefault: true },
      { id: 'custom-author-up-alpha', displayName: 'bilimi·UP Alpha', keywords: ['UP Alpha'], ruleType: 'author', enabled: true,
        priority: 10_000, ruleOrigin: 'recommendation-draft', bindingState: 'unbacked', isDefault: false }
    ]
    const coordinator = createCoordinator(repository, workspaceStore, {
      initializeOnOpen: false,
      classifyCurrentItem: () => ({ targetLedgerIds: [], confidence: 'low' as const }),
      listSavedLedgers: async () => savedLedgers.map((ledger) => ({ id: ledger.id, title: ledger.displayName })),
      listSavedEnabledLedgers: async () => savedLedgers.filter((ledger) => ledger.enabled).map((ledger) => ({ id: ledger.id, title: ledger.displayName }))
    })
    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2, isBilimiWorkFolder: false, selected: true }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'Unmatched 1', author: 'UP Alpha', sourceFolderIds: ['source'] },
        { aid: 2, title: 'Unmatched 2', author: 'UP Alpha', sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')
    await coordinator.acceptCurrentTags('100')
    await coordinator.setRoundExcludedLedgerIds('100', [], { participatingSavedLedgerIds: ['game'] })
    const candidate = requireSnapshot(await coordinator.getSnapshot('100')).recommendations.candidates
      .find((item) => item.id === 'custom-author-up-alpha')
    if (!candidate) throw new Error('UP Alpha recommendation unexpectedly unavailable')
    await coordinator.setRecommendedCandidates('100', [candidate.id])

    await expect(coordinator.getBilibiliExecutionPreflight('100')).resolves.toMatchObject({
      missingLedgers: expect.arrayContaining([expect.objectContaining({ logicalLedgerId: candidate.id })])
    })
  })

  it('keeps adopted recommendation assignments when round participation is refreshed', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const ledgers: FavoriteLedger[] = [
      { id: 'game', displayName: 'bilimi·游戏专区', keywords: ['游戏'], enabled: true, priority: 10, isDefault: true },
      { id: 'custom-author-up-alpha', displayName: 'bilimi·UP Alpha', keywords: ['UP Alpha'], ruleType: 'author', enabled: true,
        priority: 10_000, ruleOrigin: 'recommendation-draft', bindingState: 'unbacked', isDefault: false }
    ]
    const classifyCurrentItems = (items: Array<{ aid: number; author?: string }>, recommendedLedgers: Array<{ id: string }>) =>
      items.map((item) => ({
        targetLedgerIds: item.author === 'UP Alpha' && recommendedLedgers[0]
          ? [recommendedLedgers[0].id] : ['game'],
        confidence: 'high' as const
      }))
    const coordinator = createCoordinator(repository, workspaceStore, {
      initializeOnOpen: false,
      classifyCurrentItems,
      listSavedLedgers: async () => ledgers.map((ledger) => ({ id: ledger.id, title: ledger.displayName })),
      listSavedEnabledLedgers: async () => ledgers.filter((ledger) => ledger.enabled).map((ledger) => ({ id: ledger.id, title: ledger.displayName }))
    })
    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2, isBilimiWorkFolder: false, selected: true }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'UP video 1', author: 'UP Alpha', sourceFolderIds: ['source'] },
        { aid: 2, title: 'UP video 2', author: 'UP Alpha', sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')
    await coordinator.acceptCurrentTags('100')
    const initial = requireSnapshot(await coordinator.getSnapshot('100'))
    const candidate = initial.recommendations.candidates.find((item) => item.id === 'custom-author-up-alpha')
    if (!candidate) throw new Error('UP Alpha recommendation unexpectedly unavailable')
    await coordinator.setRecommendedCandidates('100', [candidate.id])
    const adopted = requireSnapshot(await coordinator.getSnapshot('100'))
    const linkedLedgerId = requireLinkedRecommendationLedgerId(adopted, candidate.id)
    await coordinator.setRoundExcludedLedgerIds('100', [], { participatingSavedLedgerIds: ['game', linkedLedgerId] })
    const snapshot = requireSnapshot(await coordinator.getSnapshot('100'))
    expect(Object.values(snapshot.classifications).filter((classification) =>
      classification.targetLedgerIds.includes(linkedLedgerId))).toHaveLength(2)
  })

  it('publishes distinct canonical author recommendations with complete renderer rules', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'A1', author: 'honker233-小王爱马枪', sourceFolderIds: ['source'] },
        { aid: 2, title: 'A2', author: 'honker233-小王爱马枪', sourceFolderIds: ['source'] },
        { aid: 3, title: 'B1', author: 'honker233-另一位主播', sourceFolderIds: ['source'] },
        { aid: 4, title: 'B2', author: 'honker233-另一位主播', sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')

    const snapshot = requireSnapshot(await coordinator.getSnapshot('100'))
    expect(snapshot.recommendations.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: expect.stringContaining('custom-author-honker233-小王爱马枪'), keywords: ['honker233-小王爱马枪']
      }),
      expect.objectContaining({
        id: expect.stringContaining('custom-author-honker233-另一位主播'), keywords: ['honker233-另一位主播']
      })
    ]))
    expect(snapshot.recommendations.candidates.map((candidate) => candidate.displayName))
      .toContain('bilimi·honker233')
    expect(new Set(snapshot.recommendations.candidates.map((candidate) => candidate.displayName)).size).toBe(2)
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
    await coordinator.acceptCurrentTags('100')
    const recommendations = requireSnapshot(await coordinator.getSnapshot('100')).recommendations
    const recommendationId = recommendations.candidates.find((candidate) => candidate.kind === 'author')?.id
    if (!recommendationId) throw new Error('recommendation unexpectedly unavailable')
    await coordinator.setRecommendedCandidates('100', [recommendationId])
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
    const excludedRecommendationIds: string[][] = []
    const classifyCurrentItems = vi.fn((
      items: Array<{ aid: number; author?: string }>,
      recommendedLedgers: Array<{ id: string }>,
      _accountMid: string,
      options?: { excludedRecommendedLedgers?: Array<{ id: string }> }
    ) => {
      classifiedAids.push(items.map((item) => item.aid))
      excludedRecommendationIds.push((options?.excludedRecommendedLedgers ?? []).map((ledger) => ledger.id))
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
    await coordinator.acceptCurrentTags('100')
    await coordinator.autoClassifyCurrentSegment('100')
    classifiedAids.length = 0
    excludedRecommendationIds.length = 0

    await coordinator.setRecommendedCandidates('100', ['custom-author-up-alpha'])
    await coordinator.setRecommendedCandidates('100', [])

    expect(classifiedAids).toEqual([[1, 2], [1, 2]])
    expect(excludedRecommendationIds).toEqual([[], [expect.stringMatching(/^custom-/)]])
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      classifications: {
        '1': { targetLedgerIds: ['system'], source: 'system-high' },
        '2': { targetLedgerIds: ['system'], source: 'system-high' },
        '3': { targetLedgerIds: ['system'], source: 'system-high' }
      }
    })
  })

  it('lets later recommendation changes replace a DeepSeek classification', async () => {
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
    await coordinator.acceptCurrentTags('100')
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
        '2': { targetLedgerIds: ['system'], source: 'system-high' }
      }
    })
  })

  it('lets a later DeepSeek batch replace an adopted recommendation classification', async () => {
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
        { aid: 1, title: 'Recommended', author: 'UP Alpha', sourceFolderIds: ['source'] },
        { aid: 2, title: 'Also recommended', author: 'UP Alpha', sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')
    await coordinator.acceptCurrentTags('100')
    const recommendationId = 'custom-author-up-alpha'
    await coordinator.setRecommendedCandidates('100', [recommendationId])
    const beforeDeepSeek = requireSnapshot(await coordinator.getSnapshot('100'))
    if (!beforeDeepSeek.currentSegment) throw new Error('workspace unexpectedly unavailable')

    await coordinator.applyDeepSeekClassificationBatch('100', [{ aid: 1, targetLedgerIds: ['deepseek-game'] }], {
      workspaceId: beforeDeepSeek.workspaceId,
      currentSegmentId: beforeDeepSeek.currentSegment.id,
      selectedSourceFolderIds: ['source'],
      classifications: Object.fromEntries(Object.entries(beforeDeepSeek.classifications).map(([aid, classification]) => [aid, {
        targetLedgerIds: classification.targetLedgerIds,
        source: classification.source
      }]))
    })

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      classifications: {
        '1': { targetLedgerIds: ['deepseek-game'], source: 'deepseek' }
      }
    })
  })

  it('labels both recommendation sources when an UP name and tag share the same title', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'One', author: '明日方舟', tags: ['明日方舟'], sourceFolderIds: ['source'] },
        { aid: 2, title: 'Two', author: '明日方舟', tags: ['明日方舟'], sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')
    const candidates = requireSnapshot(await coordinator.getSnapshot('100')).recommendations.candidates
    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'author', displayName: 'bilimi·明日方舟（UP）' }),
      expect.objectContaining({ kind: 'tag', displayName: 'bilimi·明日方舟（标签）' })
    ]))
  })

  it('applies an adopted recommendation to matching unloaded batches after restart', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root })
    const store = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(repository, store, { initializeOnOpen: false, segmentSize: () => 500 })
    await first.beginScan('100', 'incremental')
    await first.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 501, isBilimiWorkFolder: false, selected: true }]
    })
    const items = Array.from({ length: 501 }, (_unused, index) => ({
      aid: index + 1,
      title: `Video ${index + 1}`,
      ...(index === 0 || index === 500 ? { author: 'UP Alpha' } : { author: 'UP Other' }),
      tags: ['ready'], sourceFolderIds: ['source']
    }))
    for (let offset = 0; offset < items.length; offset += 50) {
      await first.recordScanPage('100', { folderId: 'source', page: offset / 50 + 1, items: items.slice(offset, offset + 50) })
    }
    const workspace = await first.finishScan('100')
    const recommendationId = requireSnapshot(await first.getSnapshot('100')).recommendations.candidates
      .find((candidate) => candidate.kind === 'author' && candidate.keywords?.includes('UP Alpha'))?.id
    if (!recommendationId) throw new Error('recommendation unexpectedly unavailable')

    const classifyCurrentItems = vi.fn((candidates: Array<{ aid: number; author?: string }>, ledgers: Array<{ id: string }>) =>
      candidates.map((item) => ({
        targetLedgerIds: item.author === 'UP Alpha' && ledgers[0] ? [ledgers[0].id] : [], confidence: 'high' as const
      })))
    const restarted = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false, segmentSize: () => 500, classifyCurrentItems
    })

    await restarted.setRecommendedCandidates('100', [recommendationId])
    const adopted = requireSnapshot(await restarted.getSnapshot('100'))
    const linkedLedgerId = requireLinkedRecommendationLedgerId(adopted, recommendationId)

    expect(classifyCurrentItems.mock.calls.some(([classified]) =>
      classified.map((item: { aid: number }) => item.aid).sort((a, b) => a - b).join(',') === '1,501')).toBe(true)
    await expect(new OldFavoriteWorkspaceStore({ root }).recover('100', workspace.id)).resolves.toMatchObject({
      classifications: {
        '1': { targetLedgerIds: [linkedLedgerId] },
        '501': { targetLedgerIds: [linkedLedgerId] }
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
      targetLedgerIds: item.author === 'UP Alpha' && recommendedLedgers[0]
        ? [recommendedLedgers[0].id]
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
    await coordinator.acceptCurrentTags('100')
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
    await coordinator.acceptCurrentTags('100')
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
    await coordinator.acceptCurrentTags('100')
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

  it('persists an adopted recommendation through the ordinary-rule transaction without creating a Bilibili folder', async () => {
    const root = await createRoot()
    const rules = createOrdinaryRuleDirectory()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      ...rules,
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
    await coordinator.acceptCurrentTags('100')

    await coordinator.setRecommendedCandidates('100', ['custom-author-up-alpha'])

    expect(rules.applyFavoriteRecommendationRuleChanges).toHaveBeenCalledTimes(1)
    expect(rules.applyFavoriteRecommendationRuleChanges).toHaveBeenCalledWith(
      '100', expect.objectContaining({ enabled: [] })
    )
    const adoptionUpsert = rules.applyFavoriteRecommendationRuleChanges.mock.calls[0]?.[1].upserts[0]
    expect(adoptionUpsert).toMatchObject({
      displayName: 'bilimi·UP Alpha', keywords: ['UP Alpha'],
      ruleType: 'author', enabled: true, isDefault: false,
      ruleOrigin: 'saved-rule', bindingState: 'unbacked'
    })
    expect(adoptionUpsert).not.toHaveProperty('syncState')
    const savedRule = rules.current()[0]
    expect(savedRule?.bilibiliFolderId).toBeUndefined()
    expect(savedRule?.syncState).toBeUndefined()
    const snapshot = requireSnapshot(await coordinator.getSnapshot('100'))
    expect(snapshot).toMatchObject({
      recommendations: { adoptedCandidateIds: ['custom-author-up-alpha'] }
    })
    expect(requireLinkedRecommendationLedgerId(snapshot, 'custom-author-up-alpha')).toBe(savedRule?.id)

    await coordinator.prepareRecommendationPreview('100', ['custom-author-up-alpha'])
    await coordinator.saveCurrentSegmentToLocalLibrary('100')

    expect(rules.applyFavoriteRecommendationRuleChanges).toHaveBeenCalledTimes(1)
    expect(rules.current()).toEqual([expect.objectContaining({ id: savedRule?.id, enabled: true })])
  })

  it('coalesces repeated adoption clicks for the same recommendation into one ordinary rule', async () => {
    const root = await createRoot()
    const rules = createOrdinaryRuleDirectory()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      ...rules,
      classifyCurrentItem: () => ({ targetLedgerIds: ['music'], confidence: 'high' })
    })
    await coordinator.open('100')
    await coordinator.beginScan('100', 'full')
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
    await coordinator.acceptCurrentTags('100')

    await Promise.all([
      coordinator.setRecommendedCandidates('100', ['custom-author-up-alpha']),
      coordinator.setRecommendedCandidates('100', ['custom-author-up-alpha'])
    ])

    expect(rules.applyFavoriteRecommendationRuleChanges).toHaveBeenCalledTimes(1)
    expect(rules.current()).toHaveLength(1)
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      recommendations: { adoptedCandidateIds: ['custom-author-up-alpha'] }
    })
  })

  it('does not retry the ordinary-rule transaction before blocking an unbacked target in preflight', async () => {
    const root = await createRoot()
    const rules = createOrdinaryRuleDirectory()
    const ensurePhysicalShard = vi.fn().mockResolvedValue({})
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      ...rules,
      bindingService: { ensurePhysicalShard },
      classifyCurrentItem: () => ({ targetLedgerIds: ['music'], confidence: 'high' })
    })
    await coordinator.open('100')
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
    await coordinator.acceptCurrentTags('100')
    await coordinator.setRecommendedCandidates('100', ['custom-author-up-alpha'])
    await coordinator.prepareRecommendationPreview('100', ['custom-author-up-alpha'])

    await expect(coordinator.freezeForBilibiliExecution('100')).rejects.toThrow('backup-preflight-required')

    expect(rules.applyFavoriteRecommendationRuleChanges).toHaveBeenCalledTimes(1)
    expect(ensurePhysicalShard).not.toHaveBeenCalled()
  })

  it('does not publish a recommendation selection when the ordinary-rule transaction fails', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(repository, workspaceStore, {
      applyFavoriteRecommendationRuleChanges: vi.fn().mockRejectedValue(new Error('preferences unavailable')),
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
    await first.acceptCurrentTags('100')
    await expect(first.setRecommendedCandidates('100', ['custom-author-up-alpha'])).rejects.toThrow('preferences unavailable')
    await expect(first.getSnapshot('100')).resolves.toMatchObject({
      recommendations: { adoptedCandidateIds: [] }
    })
  })

  it('disables the linked ordinary rule when a recommendation is deselected from the current round', async () => {
    const root = await createRoot()
    const rules = createOrdinaryRuleDirectory()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      ...rules,
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
    await coordinator.acceptCurrentTags('100')

    await coordinator.setRecommendedCandidates('100', ['custom-author-up-alpha'])
    await coordinator.prepareRecommendationPreview('100', ['custom-author-up-alpha'])
    await coordinator.setRecommendedCandidates('100', [])
    await coordinator.prepareRecommendationPreview('100', [])

    expect(rules.applyFavoriteRecommendationRuleChanges).toHaveBeenCalledTimes(2)
    const savedRule = rules.current()[0]
    expect(savedRule).toMatchObject({ enabled: false })

    await coordinator.saveCurrentSegmentToLocalLibrary('100')

    expect(rules.applyFavoriteRecommendationRuleChanges).toHaveBeenCalledTimes(2)
    expect(rules.current()).toEqual([expect.objectContaining({ id: savedRule?.id, enabled: false })])
  })

  it('retains an adopted ordinary rule when freeze requires its explicit backup', async () => {
    const root = await createRoot()
    const rules = createOrdinaryRuleDirectory()
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
      ...rules,
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
    await coordinator.acceptCurrentTags('100')
    await coordinator.setRecommendedCandidates('100', ['custom-author-up-alpha'])
    await coordinator.prepareRecommendationPreview('100', ['custom-author-up-alpha'])

    expect(rules.applyFavoriteRecommendationRuleChanges).toHaveBeenCalledTimes(1)
    await expect(coordinator.freezeForBilibiliExecution('100')).rejects.toThrow('backup-preflight-required')
    expect(rules.applyFavoriteRecommendationRuleChanges).toHaveBeenCalledTimes(1)
  })

  it('creates a local logical ledger and applies its later classification to the round', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    let savedLedgers: FavoriteLedger[] = []
    const applyFavoriteRecommendationRuleChanges = vi.fn(async (_accountMid: string, changes: {
      upserts: FavoriteLedger[]
      enabled: Array<{ ledgerId: string; enabled: boolean }>
    }) => {
      const before = savedLedgers.map((ledger) => ({ ...ledger, keywords: [...ledger.keywords] }))
      const byId = new Map(savedLedgers.map((ledger) => [ledger.id, ledger]))
      for (const ledger of changes.upserts) byId.set(ledger.id, { ...ledger, keywords: [...ledger.keywords] })
      savedLedgers = [...byId.values()]
      return { before, after: savedLedgers.map((ledger) => ({ ...ledger, keywords: [...ledger.keywords] })) }
    })
    const classifyCurrentItems = vi.fn((_items: Array<{ aid: number }>, _ledgers: FavoriteLedger[], _accountMid: string, options?: {
      participatingSavedLedgerIds?: readonly string[]
    }) => _items.map(() => ({
      targetLedgerIds: options?.participatingSavedLedgerIds?.includes('local-music') ? ['local-music'] : ['music'],
      confidence: 'high' as const
    })))
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      listSavedFavoriteLedgers: async () => savedLedgers,
      applyFavoriteRecommendationRuleChanges,
      classifyCurrentItems,
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1, 2] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 2, targetLedgerIds: ['manual'] }]
    })

    await coordinator.createLocalLedgerAndReclassify('100', 'Music')
    const selected = requireSnapshot(await coordinator.getSnapshot('100'))
    expect(selected).toMatchObject({
      recommendations: { candidates: [], adoptedCandidateIds: [] },
      classifications: {
        '1': { targetLedgerIds: ['local-music'], source: 'system-high' },
        '2': { targetLedgerIds: ['local-music'], source: 'system-high' }
      }
    })
    expect(savedLedgers).toEqual([expect.objectContaining({
      id: 'local-music', displayName: 'bilimi·Music', keywords: ['Music'], ruleType: 'keyword',
      enabled: true, ruleOrigin: 'saved-rule'
    })])
    expect(applyFavoriteRecommendationRuleChanges).toHaveBeenCalledWith('100', expect.objectContaining({
      upserts: [expect.objectContaining({ id: 'local-music', ruleOrigin: 'saved-rule' })]
    }))
    expect(classifyCurrentItems).toHaveBeenLastCalledWith(
      expect.any(Array), expect.any(Array), '100',
      expect.objectContaining({ participatingSavedLedgerIds: ['local-music'] })
    )
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      folders: [expect.objectContaining({ id: 'local:local-music', title: 'Music', kind: 'local', syncState: 'local-only' })]
    })
  })

  it('keeps the active draft unchanged until a saved local rule is fully analyzed and classified', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const classification = deferred<Array<{ targetLedgerIds: string[]; confidence: 'high' | 'low' }>>()
    const classifyCurrentItems = vi.fn()
      .mockResolvedValueOnce([
        { targetLedgerIds: [], confidence: 'low' as const },
        { targetLedgerIds: [], confidence: 'low' as const }
      ])
      .mockImplementation(() => classification.promise)
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
    await coordinator.acceptCurrentTags('100')
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
        candidates: [],
        adoptedCandidateIds: []
      },
      classifications: {
        '1': { targetLedgerIds: ['local-alpha'], source: 'system-high' },
        '2': { targetLedgerIds: ['manual'], source: 'manual' }
      }
    })
    expect((await repository.getSnapshot('100')).folders.find((folder) => folder.id === 'local:local-alpha')).toBeUndefined()
  })

  it('does not publish an analyzed rule after that saved rule was deleted while its result was pending', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const classification = deferred<Array<{ targetLedgerIds: string[]; confidence: 'high' | 'low' }>>()
    const classifyCurrentItems = vi.fn()
      .mockResolvedValueOnce([{ targetLedgerIds: [], confidence: 'low' as const }])
      .mockImplementation(() => classification.promise)
    let savedRule: {
      id: string
      title: string
      keywords: string[]
      ruleType: 'keyword' | 'author' | 'tag'
      enabled: boolean
    } | undefined = {
      id: 'local-alpha', title: 'Alpha', keywords: ['Alpha'], ruleType: 'keyword', enabled: true
    }
    const coordinator = createCoordinator(repository, workspaceStore, {
      classifyCurrentItems,
      resolveSavedLedgerRule: async (_accountMid, ledgerId) =>
        savedRule?.id === ledgerId ? { ...savedRule, keywords: [...savedRule.keywords] } : undefined
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [{ aid: 1, title: 'Alpha series', sourceFolderIds: ['source'] }]
    })
    await coordinator.finishScan('100')
    await coordinator.acceptCurrentTags('100')
    classifyCurrentItems.mockClear()

    const saving = coordinator.saveDraftLedgerRule('100', {
      analysisId: 'analysis-deleted-before-publication', ledgerId: 'local-alpha', title: 'Alpha', keywords: ['Alpha'], ruleType: 'keyword'
    })
    await vi.waitFor(() => expect(classifyCurrentItems).toHaveBeenCalledOnce())
    savedRule = undefined
    classification.resolve([{ targetLedgerIds: ['local-alpha'], confidence: 'high' }])

    await expect(saving).rejects.toThrow('Old favorite ledger rule analysis is stale.')
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      recommendations: { candidates: [], adoptedCandidateIds: [] },
      classifications: {}
    })
  })

  it('stores an analyzed but unselected local rule without adding it to archive preview', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const classifyCurrentItems = vi.fn((items: Array<{ aid: number }>) => items.map(() => ({
      targetLedgerIds: [], confidence: 'low' as const
    })))
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore,
      classifyCurrentItems,
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [{ aid: 1, title: 'Alpha series', author: 'UP Alpha', sourceFolderIds: ['source'] }]
    })
    const workspace = await coordinator.finishScan('100')
    await coordinator.acceptCurrentTags('100')
    classifyCurrentItems.mockClear()

    await coordinator.saveDraftLedgerRule('100', {
      analysisId: 'analysis-unselected-alpha',
      title: 'Alpha',
      keywords: ['Alpha'],
      ruleType: 'keyword',
      adopt: false
    })

    expect(classifyCurrentItems).not.toHaveBeenCalled()
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      recommendations: {
        candidates: [],
        adoptedCandidateIds: []
      },
      classifications: {}
    })
    await expect(workspaceStore.recover('100', workspace.id)).resolves.toMatchObject({
      recommendations: {
        candidates: [],
        adoptedCandidateIds: []
      },
      classifications: {}
    })
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
      if (overlay.ruleAnalysisCheckpoint === null && overlay.recommendations) {
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
      recommendations: { candidates: [], adoptedCandidateIds: [] },
      classifications: { '1': { targetLedgerIds: ['local-publication'], source: 'system-high' } }
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
      classifyCurrentItems: vi.fn()
        .mockResolvedValueOnce([
          { targetLedgerIds: [], confidence: 'low' as const },
          { targetLedgerIds: [], confidence: 'low' as const }
        ])
        .mockRejectedValue(new Error('classifier unavailable')),
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
    await coordinator.acceptCurrentTags('100')
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
    await coordinator.acceptCurrentTags('100')
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
        candidates: [],
        adoptedCandidateIds: []
      },
      classifications: {
        '2': { targetLedgerIds: ['local-topic'], source: 'system-high' }
      }
    })
    expect((await repository.getSnapshot('100')).folders.find((folder) => folder.id === 'local:local-topic')).toBeUndefined()

    await coordinator.saveCurrentSegmentToLocalLibrary('100')
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      folders: expect.arrayContaining([
        expect.objectContaining({ id: 'bilimi-logical:local-topic', title: 'bilimi·Renamed Topic', kind: 'bilimi-logical', logicalLedgerId: 'local-topic', syncState: 'local-only' })
      ])
    })
  })

  it('admits existing custom and default ledgers into the round on their first rule save', async () => {
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
        candidates: [],
        adoptedCandidateIds: []
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
    })).resolves.toMatchObject({ status: 'previewing' })
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      recommendations: {
        candidates: [],
        adoptedCandidateIds: []
      }
    })
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
      if (overlay.ruleAnalysisCheckpoint === null && overlay.recommendations) {
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
        candidates: [],
        adoptedCandidateIds: []
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
    await first.acceptCurrentTags('100')
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
        candidates: []
      }
    })
  })

  it('replaces matching manual and DeepSeek classifications from a later segment when saving a rule after restart', async () => {
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
    await first.acceptCurrentTags('100')
    await first.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['first-segment-manual'] }]
    })
    await first.selectSegment('100', 'segment-2')
    await first.acceptCurrentTags('100')
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

    expect(classifyCurrentItems).toHaveBeenCalledOnce()
    expect(classifyCurrentItems.mock.calls[0]?.[0].map((item) => item.aid)).toEqual([2_001, 2_002])
    await expect(new OldFavoriteWorkspaceStore({ root }).recover('100', workspace.id)).resolves.toMatchObject({
      classifications: {
        '1': { targetLedgerIds: ['first-segment-manual'], source: 'manual' },
        '2001': { targetLedgerIds: ['local-protected'], source: 'system-high' },
        '2002': { targetLedgerIds: ['local-protected'], source: 'system-high' }
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
    await first.acceptCurrentTags('100')
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
    expect(classifyCurrentItems.mock.calls[0]?.[0].map((item) => item.aid)).toEqual([2, 3])
    await expect(new OldFavoriteWorkspaceStore({ root }).recover('100', workspace.id)).resolves.toMatchObject({
      classifications: {
        '1': { targetLedgerIds: ['first'], source: 'manual' },
        '2': { targetLedgerIds: ['local-branch'], source: 'system-high' },
        '3': { targetLedgerIds: ['local-branch'], source: 'system-high' }
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
    await first.acceptCurrentTags('100')
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

  it('does not prepare an adopted recommendation for Bilibili binding during freeze', async () => {
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
    await coordinator.acceptCurrentTags('100')
    await coordinator.setRecommendedCandidates('100', ['custom-author-up-alpha'])
    await coordinator.prepareRecommendationPreview('100', ['custom-author-up-alpha'])

    await expect(coordinator.freezeForBilibiliExecution('100')).rejects.toThrow('backup-preflight-required')
    expect(ensurePhysicalShard).not.toHaveBeenCalled()
  })

  it('keeps one remote organization round coherent from scan through protected incremental follow-up', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const rules = createOrdinaryRuleDirectory()
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
      ...rules,
      classifyCurrentItem: (item, recommendedLedgers = []) => item.aid === 1 &&
        recommendedLedgers.length
        ? { targetLedgerIds: [recommendedLedgers[0]!.id], confidence: 'high' }
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
    await coordinator.acceptCurrentTags('100')
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
    const linkedLedgerId = requireLinkedRecommendationLedgerId(
      requireSnapshot(await coordinator.getSnapshot('100')),
      'custom-author-up-alpha'
    )
    const deepSeekInput = requireSnapshot(await coordinator.getSnapshot('100'))
    if (!deepSeekInput.currentSegment) throw new Error('workspace unexpectedly unavailable')
    await coordinator.applyDeepSeekClassificationBatch('100', [{ aid: 2, targetLedgerIds: ['knowledge'] }], {
      workspaceId: deepSeekInput.workspaceId,
      currentSegmentId: deepSeekInput.currentSegment.id,
      selectedSourceFolderIds: ['source'],
      classifications: {
        '1': { targetLedgerIds: [linkedLedgerId], source: 'system-high' },
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
        '1': { targetLedgerIds: [linkedLedgerId], source: 'system-high' },
        '2': { targetLedgerIds: ['music'], source: 'system-high' },
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
      ...rules,
      classifyCurrentItem: () => ({ targetLedgerIds: ['music'], confidence: 'high' }),
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({
      status: 'previewing',
      classifications: {
        '1': { targetLedgerIds: [linkedLedgerId], source: 'system-high' },
        '2': { targetLedgerIds: ['music'], source: 'system-high' },
        '3': { targetLedgerIds: ['manual'], source: 'manual' }
      },
      history: { cursor: 6, length: 6 }
    })

    for (const [logicalLedgerId, remoteFolderId] of [
      [linkedLedgerId, 'remote-alpha'], ['music', 'remote-music'], ['manual', 'remote-manual']
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
      ...rules,
      classifyCurrentItem: () => ({ targetLedgerIds: ['music'], confidence: 'high' }),
      now: () => '2026-07-20T00:00:00.000Z'
    })

    await expect(restartedAfterBindings.freezeForBilibiliExecution('100')).resolves.toMatchObject({
      status: 'frozen', frozenSyncPlan: { operations: expect.arrayContaining([
        expect.objectContaining({ aid: 1, folderIds: ['remote-alpha'] }),
        expect.objectContaining({ aid: 2, folderIds: ['remote-music'] }),
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
    await coordinator.acceptCurrentTags('100')
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }, { aid: 2, targetLedgerIds: ['knowledge'] }]
    })
    await coordinator.selectSourceFolders('100', ['source-a'])

    await coordinator.saveCurrentSegmentToLocalLibrary('100')

    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      memberships: { 'bilimi-logical:music': [1] },
      organizationRecords: [expect.objectContaining({ aid: 1 })]
    })
    const snapshot = await repository.getSnapshot('100')
    expect(snapshot.memberships['bilimi-logical:knowledge']).toBeUndefined()
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
    await coordinator.acceptCurrentTags('100')
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

  it('requires explicit rebinding of an existing Bilibili ledger after full reset', async () => {
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
      resolveLedgerBinding: vi.fn().mockResolvedValue({
        remoteFolderId: 'remote-music', remoteDisplayTitle: 'bilimi·音乐舞台'
      }),
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
    await coordinator.acceptCurrentTags('100')
    await coordinator.selectSourceFolders('100', ['source'])
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })

    await expect(coordinator.freezeForBilibiliExecution('100')).rejects.toThrow('backup-preflight-required')
    expect(createFolder).not.toHaveBeenCalled()
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
    await coordinator.acceptCurrentTags('100')
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

    await expect(coordinator.saveCurrentSegmentToLocalLibrary('100')).resolves.toMatchObject({ status: 'previewing' })
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      folders: expect.arrayContaining([
        expect.objectContaining({ id: 'bilimi-logical:music', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'local-only' }),
        expect.objectContaining({ id: 'bilimi-logical:knowledge', kind: 'bilimi-logical', logicalLedgerId: 'knowledge', syncState: 'local-only' })
      ]),
      memberships: { 'bilimi-logical:music': [1], 'bilimi-logical:knowledge': [2] },
      positions: {
        '100:1': expect.objectContaining({ localDesiredFolderIds: ['bilimi-logical:music'] }),
        '100:2': expect.objectContaining({ localDesiredFolderIds: ['bilimi-logical:knowledge'] })
      },
      workspace: { status: 'previewing' }
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
      memberships: { 'bilimi-logical:music': [1] },
      workspace: { status: 'previewing' }
    })
    expect((await repository.getSnapshot('100')).memberships).not.toHaveProperty('bilimi-logical:knowledge')

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
    })).resolves.toMatchObject({
      status: 'previewing',
      segments: [{ id: 'segment-1', status: 'previewing' }]
    })
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      memberships: { 'bilimi-logical:music': [1] }
    })
    await restored.saveCurrentSegmentToLocalLibrary('100')
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
      memberships: { 'bilimi-logical:knowledge': [1, 501] },
      workspace: { status: 'previewing' }
    })
  })

  it('reclassifies a saved batch again before the round ends', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    let targetLedgerId = 'music'
    const classifyCurrentItem = vi.fn(async () => ({ targetLedgerIds: [targetLedgerId], confidence: 'high' as const }))
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      segmentSize: () => 500,
      classifyCurrentItem
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: Array.from({ length: 501 }, (_unused, index) => index + 1) })
    await coordinator.autoClassifyCurrentSegment('100')
    await coordinator.saveCurrentSegmentToLocalLibrary('100')

    targetLedgerId = 'knowledge'
    await coordinator.autoClassifyCurrentSegment('100')
    const snapshot = requireSnapshot(await coordinator.getSnapshot('100'))
    expect(snapshot.status).toBe('previewing')
    expect(snapshot.segments).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'segment-1', status: 'previewing', readiness: 'ready' })
    ]))
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
    await coordinator.acceptCurrentTags('100')
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
      expect.objectContaining({ id: 'custom-author-up-alpha', count: 2 })
    ])
    expect(recovered.recommendations.candidates[0]).not.toHaveProperty('matchedAidsBySegment')
  })

  it('hydrates a legacy recommendation match index before first adoption', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root })
    const store = new OldFavoriteWorkspaceStore({ root })
    const coordinator = createCoordinator(repository, store)
    await coordinator.open('100')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2, isBilimiWorkFolder: false, selected: true }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, author: 'UP Alpha', sourceFolderIds: ['source'] },
        { aid: 2, author: 'UP Alpha', sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')
    await coordinator.acceptCurrentTags('100')
    const first = requireSnapshot(await coordinator.getSnapshot('100'))
    await store.appendOverlay('100', first.workspaceId, {
      currentSegmentId: 'segment-1', classifications: [], history: [], recommendations: {
        initialized: true,
        candidates: [{
          id: 'custom-author-up-alpha', displayName: 'bilimi·UP Alpha', kind: 'author', sourceName: 'UP Alpha',
          keywords: ['UP Alpha'], count: 2, reason: 'legacy candidate without an index'
        }],
        adoptedCandidateIds: []
      }
    })

    const resumed = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false,
      classifyCurrentItems: (items, recommendedLedgers) => items.map(() => ({
        targetLedgerIds: recommendedLedgers.length ? [recommendedLedgers[0]!.id] : [],
        confidence: 'high' as const
      }))
    })
    await resumed.getSnapshot('100')

    const adopted = requireSnapshot(await resumed.setRecommendedCandidates('100', ['custom-author-up-alpha']))
    const linkedLedgerId = requireLinkedRecommendationLedgerId(requireSnapshot(await resumed.getSnapshot('100')), 'custom-author-up-alpha')

    expect(adopted.classifications).toMatchObject({
      '1': { targetLedgerIds: [linkedLedgerId] },
      '2': { targetLedgerIds: [linkedLedgerId] }
    })
  })

  it('cancels a legacy adopted candidate when no ordinary rule can link it after restart', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root })
    const store = new OldFavoriteWorkspaceStore({ root })
    const coordinator = createCoordinator(repository, store)
    await coordinator.open('100')
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, author: '中文作者', sourceFolderIds: ['source'] },
        { aid: 2, author: '中文作者', sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')
    const first = requireSnapshot(await coordinator.getSnapshot('100'))
    await store.appendOverlay('100', first.workspaceId, {
      currentSegmentId: 'segment-1', classifications: [], history: [], recommendations: {
        initialized: true,
        candidates: [{
          id: 'custom-author-legacy-hash', displayName: 'bilimi·中文作者', kind: 'author', sourceName: '中文作者',
          keywords: ['中文作者'], count: 2, reason: 'legacy candidate'
        }],
        adoptedCandidateIds: ['custom-author-legacy-hash']
      }
    })

    const restarted = createCoordinator(repository, store, { initializeOnOpen: false })
    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({
      recommendations: { adoptedCandidateIds: [] }
    })
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
        id: 'bilimi-logical:custom-my-list', title: 'bilimi·我的片单', kind: 'bilimi-logical',
        logicalLedgerId: 'custom-my-list', syncState: 'local-only'
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

    await expect(repository.getSnapshot('100')).resolves.toMatchObject({ memberships: { 'bilimi-logical:music': [1, 9] } })
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
    await coordinator.acceptCurrentTags('100')
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })

    await coordinator.saveCurrentSegmentToLocalLibrary('100')

    await expect(repository.getFolderPage('100', 'bilimi-logical:music', { limit: 10 })).resolves.toMatchObject({
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
    await coordinator.acceptCurrentTags('100')

    await expect(coordinator.saveCurrentSegmentToLocalLibrary('100')).resolves.toMatchObject({
      status: 'previewing', segments: [{ status: 'frozen' }]
    })
    await expect(repository.getFolderPage('100', 'local:inbox', { limit: 10 })).resolves.toMatchObject({
      items: [expect.objectContaining({ aid: 1, title: 'Needs classification' })]
    })
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      organizationRecords: []
    })
  })

  it('commits local memberships before updating the repeatable saved-draft marker', async () => {
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

    expect(commit).toHaveBeenCalledTimes(2)
    expect(commit.mock.calls[0]?.[1]).toMatchObject({
      type: 'commit-local-plan',
      payload: {
        organizationRecords: [{ aid: 1, targetFolderIds: ['bilimi-logical:music'] }]
      }
    })
    expect(commit.mock.calls[1]?.[1]).toMatchObject({ type: 'set-workspace', payload: { status: 'previewing' } })
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      workspace: { status: 'previewing' },
      organizationRecords: [expect.objectContaining({ aid: 1, targetFolderIds: ['bilimi-logical:music'] })]
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
    await coordinator.abandonCurrentWorkspace('100')

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
    await first.abandonCurrentWorkspace('100')

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
      memberships: { 'bilimi-logical:music': expect.arrayContaining([1, 2_001]) }, workspace: { status: 'previewing' }
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
    await coordinator.acceptCurrentTags('100')
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

    await expect(coordinator.freezeForBilibiliExecution('100')).rejects.toThrow('backup-preflight-required')
    expect((await repository.getSnapshot('100')).workspace?.frozenSyncPlan).toBeUndefined()
  })

  it('does not bind selected preview targets while freezing the Bilibili plan', async () => {
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

    await expect(coordinator.freezeForBilibiliExecution('100')).rejects.toThrow('backup-preflight-required')
    expect(ensurePhysicalShard).not.toHaveBeenCalled()
  })

  it('includes staged inbox videos only after the user explicitly enables bilimi staging sync', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      bindingService: bindings,
      now: () => '2026-07-20T00:00:00.000Z'
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
    await coordinator.acceptCurrentTags('100')
    await bindings.preparePhysicalShard('100', {
      logicalLedgerId: 'inbox', logicalTitle: 'bilimi·暂存', shardNumber: 1, memberAids: [], observedAccountMid: '100',
      remoteFolderId: 'remote-inbox', inventory: [{
        id: 'remote-inbox', title: favoriteRepositoryManagedShardTitle('inbox', 1, 'a1b2c3'), memberCount: 0, memberAids: []
      }]
    })

    const frozen = await coordinator.freezeForBilibiliExecution('100', { includeInbox: true })

    expect(frozen.frozenSyncPlan?.operations).toEqual([
      expect.objectContaining({ aid: 1, folderIds: [expect.any(String)] })
    ])
    const snapshot = await repository.getSnapshot('100')
    expect(snapshot.folders).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'bilimi-logical', logicalLedgerId: 'inbox', title: 'bilimi·暂存' })
    ]))
    expect(snapshot.memberships).toMatchObject({ 'local:inbox': [1] })
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

  it('does not reclaim a saved remote target after the repository was reset without confirmation', async () => {
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

    await expect(coordinator.freezeForBilibiliExecution('100')).rejects.toThrow('backup-preflight-required')
    expect(createFolder).not.toHaveBeenCalled()
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({ physicalShards: [] })
  })

  it('does not freeze a saved remote target when a prior reset left only its binding command result', async () => {
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

    await expect(coordinator.freezeForBilibiliExecution('100')).rejects.toThrow('backup-preflight-required')
  })

  it('does not bind classifications that arrive while confirmation is preparing', async () => {
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

    await expect(freezing).rejects.toThrow('backup-preflight-required')
    await expect(lateClassification).resolves.toMatchObject({ classifications: { '2': { targetLedgerIds: ['knowledge'] } } })
  })

  it('does not reclaim a saved remote target when confirming a recovered preview', async () => {
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
    await first.acceptCurrentTags('100')
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

    await expect(recovered.freezeForBilibiliExecution('100')).rejects.toThrow('backup-preflight-required')
    await expect(bindings.getBindings('100')).resolves.toMatchObject({ shards: [] })
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

    await expect(coordinator.freezeForBilibiliExecution('100')).rejects.toThrow('backup-preflight-required')
    expect(createFolder).not.toHaveBeenCalled()
  })

  it('does not create a Chinese target while freezing an unbound local round', async () => {
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

    await expect(coordinator.freezeForBilibiliExecution('100')).rejects.toThrow('backup-preflight-required')
    expect(createFolder).not.toHaveBeenCalled()
    const snapshot = await repository.getSnapshot('100')
    expect(snapshot.workspace).toMatchObject({ status: 'previewing' })
    expect(snapshot.workspace?.frozenSyncPlan).toBeUndefined()
  })

  it('reports enough Bilibili shards for a selected target that exceeds one folder without creating them', async () => {
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

    await expect(coordinator.freezeForBilibiliExecution('100')).rejects.toThrow('backup-preflight-required')
    expect(ensurePhysicalShard).not.toHaveBeenCalled()
  })

  it('limits backup gaps to selected assignments and exposes shards needed after first backup', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-08-23T00:00:00.000Z' })
    const ensurePhysicalShard = vi.fn()
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      bindingService: { ensurePhysicalShard },
      listSavedEnabledLedgers: vi.fn().mockResolvedValue([
        { id: 'game', title: 'bilimi·游戏专区' },
        { id: 'genshin', title: 'bilimi·原神' }
      ]),
      now: () => '2026-08-23T00:00:00.000Z'
    })
    const aids = Array.from({ length: 1_208 }, (_, index) => index + 1)
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: aids.map((aid) => ({ aid, targetLedgerIds: ['game'] }))
    })
    await coordinator.setRoundExcludedLedgerIds('100', ['genshin'])

    await expect(coordinator.getBilibiliExecutionPreflight('100')).resolves.toEqual(expect.objectContaining({
      missingLedgers: [{ logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区', reason: 'unbacked', bindingCandidates: [] }],
      requiredPhysicalShards: [{
        logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区', shardNumber: 2,
        requiredAssignmentCount: 1_208, bindingCandidates: []
      }]
    }))

    expect(ensurePhysicalShard).not.toHaveBeenCalled()
  })

  it('includes every selected saved rule in backup preflight even when it has zero archive members', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-08-28T00:00:00.000Z' })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      listSavedEnabledLedgers: vi.fn().mockResolvedValue([
        { id: 'game', title: 'bilimi·游戏专区' },
        { id: 'honker233', title: 'bilimi·honker233' }
      ]),
      now: () => '2026-08-28T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['game'] }]
    })

    await expect(coordinator.getBilibiliExecutionPreflight('100')).resolves.toMatchObject({
      missingLedgers: expect.arrayContaining([
        expect.objectContaining({ logicalLedgerId: 'game', reason: 'unbacked' }),
        expect.objectContaining({ logicalLedgerId: 'honker233', reason: 'unbacked' })
      ])
    })
  })

  it('requires a first backup for an eligible inbox without adding inbox videos to the default write plan', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-08-26T00:00:00.000Z' })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      listSavedEnabledLedgers: vi.fn().mockResolvedValue([{ id: 'inbox', title: 'bilimi·暂存' }]),
      now: () => '2026-08-26T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })

    await expect(coordinator.getBilibiliExecutionPreflight('100')).resolves.toMatchObject({
      missingLedgers: [{ logicalLedgerId: 'inbox', logicalTitle: 'bilimi·暂存', reason: 'unbacked' }],
      requiredPhysicalShards: []
    })
  })

  it('does not back up an inbox that was excluded from the current round', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-08-26T00:00:00.000Z' })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      listSavedEnabledLedgers: vi.fn().mockResolvedValue([{ id: 'inbox', title: 'bilimi·暂存' }]),
      now: () => '2026-08-26T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.setRoundExcludedLedgerIds('100', ['inbox'])

    await expect(coordinator.getBilibiliExecutionPreflight('100')).resolves.toMatchObject({
      missingLedgers: [],
      requiredPhysicalShards: []
    })
  })

  it('returns an exact discovered candidate for an unbacked first shard without mutating remote state', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-08-25T00:00:00.000Z' })
    const ensurePhysicalShard = vi.fn()
    const previewLedgerBindingCandidates = vi.fn().mockResolvedValue([{
      ledgerId: 'genshin', candidates: [
        { id: 'remote-genshin', title: 'bilimi·原神', memberCount: 352 },
        { id: 'unrelated', title: 'bilimi·原神·2', memberCount: 1 }
      ]
    }])
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      bindingService: { ensurePhysicalShard, previewLedgerBindingCandidates },
      listSavedEnabledLedgers: vi.fn().mockResolvedValue([{ id: 'genshin', title: 'bilimi·原神' }]),
      now: () => '2026-08-25T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['genshin'] }]
    })

    await expect(coordinator.getBilibiliExecutionPreflight('100')).resolves.toMatchObject({
      missingLedgers: [{
        logicalLedgerId: 'genshin', logicalTitle: 'bilimi·原神', reason: 'unbacked',
        bindingCandidates: [{ remoteFolderId: 'remote-genshin', remoteTitle: 'bilimi·原神', memberCount: 352 }]
      }]
    })
    expect(previewLedgerBindingCandidates).toHaveBeenCalledWith('100', [{ ledgerId: 'genshin', title: 'bilimi·原神' }])
    expect(ensurePhysicalShard).not.toHaveBeenCalled()
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({ physicalShards: [] })
  })

  it('persists a round ledger exclusion across local save preflight and freeze', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-08-23T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore,
      listSavedEnabledLedgers: vi.fn().mockResolvedValue([
        { id: 'game', title: 'bilimi·游戏专区' },
        { id: 'genshin', title: 'bilimi·原神' }
      ]),
      now: () => '2026-08-23T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1, 2] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual',
      assignments: [
        { aid: 1, targetLedgerIds: ['game'] },
        { aid: 2, targetLedgerIds: ['genshin'] }
      ]
    })

    await coordinator.setRoundExcludedLedgerIds('100', ['genshin'])

    await expect(coordinator.getBilibiliExecutionPreflight('100')).resolves.toMatchObject({
      missingLedgers: [{ logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区', reason: 'unbacked' }]
    })
    await expect(coordinator.saveCurrentSegmentToLocalLibrary('100')).resolves.toBeTruthy()
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      memberships: { 'bilimi-logical:game': [1] }
    })
    await expect(coordinator.freezeForBilibiliExecution('100')).rejects.toThrow('backup-preflight-required')

    const restored = new OldFavoriteWorkspaceCoordinator({
      repository: new FavoriteRepositoryService({ root, now: () => '2026-08-23T00:00:01.000Z' }),
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      listSavedEnabledLedgers: vi.fn().mockResolvedValue([
        { id: 'game', title: 'bilimi·游戏专区' },
        { id: 'genshin', title: 'bilimi·原神' }
      ]),
      now: () => '2026-08-23T00:00:01.000Z'
    })
    await expect(restored.getBilibiliExecutionPreflight('100')).resolves.toMatchObject({
      missingLedgers: [{ logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区', reason: 'unbacked' }]
    })
  })

  it('updates archive preview counts when a saved ledger is excluded from the current round', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-08-27T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore,
      segmentSize: () => 500,
      listSavedEnabledLedgers: vi.fn().mockResolvedValue([
        { id: 'game', title: 'bilimi·游戏专区' },
        { id: 'genshin', title: 'bilimi·原神' }
      ]),
      now: () => '2026-08-27T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1_000, isBilimiWorkFolder: false, selected: true }]
    })
    for (let offset = 0; offset < 1_000; offset += 50) {
      await coordinator.recordScanPage('100', {
        folderId: 'source', page: offset / 50 + 1,
        items: Array.from({ length: 50 }, (_unused, index) => ({
          aid: offset + index + 1, title: `视频 ${offset + index + 1}`,
          tags: ['ready'], sourceFolderIds: ['source']
        }))
      })
    }
    await coordinator.finishScan('100')
    await coordinator.applyClassificationBatch('100', {
      source: 'manual',
      assignments: Array.from({ length: 500 }, (_unused, index) => ({ aid: index + 1, targetLedgerIds: ['game'] }))
    })
    await coordinator.selectSegment('100', 'segment-2')
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: Array.from({ length: 500 }, (_unused, index) => ({ aid: index + 501, targetLedgerIds: ['genshin'] }))
    })

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      overview: expect.objectContaining({
        classifiedItemCount: 1_000,
        archiveTargets: expect.arrayContaining([
          expect.objectContaining({ ledgerId: 'game', itemCount: 500 }),
          expect.objectContaining({ ledgerId: 'genshin', itemCount: 500 })
        ])
      })
    })

    await expect(coordinator.setRoundExcludedLedgerIds('100', ['genshin'])).resolves.toMatchObject({
      overview: expect.objectContaining({
        processedItemCount: 1_000,
        classifiedItemCount: 500,
        unmatchedItemCount: 500,
        archiveTargets: expect.arrayContaining([
          expect.objectContaining({ ledgerId: 'game', itemCount: 500 }),
          expect.objectContaining({ ledgerId: 'inbox', itemCount: 500 })
        ])
      })
    })
  })

  it('keeps a persisted participating zero-match saved ledger out of recommendations while projecting it into a single-batch archive preview without creating a folder', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-08-27T00:00:00.000Z' })
    const savedGenshinRule = {
      id: 'genshin', title: '原神', keywords: ['原神'], ruleType: 'keyword' as const, enabled: true
    }
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      listSavedLedgers: vi.fn().mockResolvedValue([{ id: 'genshin', title: 'bilimi·原神' }]),
      listSavedEnabledLedgers: vi.fn().mockResolvedValue([{ id: 'genshin', title: 'bilimi·原神' }]),
      resolveSavedLedgerRule: vi.fn().mockResolvedValue(savedGenshinRule)
    })
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    const commits = vi.spyOn(repository, 'commit')

    await coordinator.saveDraftLedgerRule('100', {
      analysisId: 'analysis-new-genshin-zero-match', ledgerId: 'genshin', title: '原神', keywords: ['原神'], ruleType: 'keyword'
    })
    await coordinator.setRoundExcludedLedgerIds('100', [], { participatingSavedLedgerIds: ['genshin'] })

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      recommendations: {
        candidates: [],
        adoptedCandidateIds: []
      },
      overview: {
        archiveTargets: expect.arrayContaining([
          { ledgerId: 'genshin', itemCount: 0, segmentCounts: [] }
        ])
      }
    })
    expect(commits).not.toHaveBeenCalled()
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({ physicalShards: [] })
    expect((await repository.getSnapshot('100')).folders).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'bilimi-logical:genshin' })
    ]))
  })

  it('reclassifies when the participating rule set changes while exclusions stay empty', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-08-27T00:00:00.000Z' })
    let reselected = false
    const classifyCurrentItems = vi.fn((items: Array<{ aid: number }>) => items.map(() => ({
      targetLedgerIds: reselected ? ['genshin'] : [],
      confidence: 'high' as const
    })))
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      classifyCurrentItems,
      listSavedLedgers: vi.fn().mockResolvedValue([{ id: 'genshin', title: 'bilimi·原神' }]),
      listSavedEnabledLedgers: vi.fn().mockResolvedValue([])
    })
    await coordinator.open('100')
    await coordinator.beginScan('100', 'full')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false, selected: true }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [{ aid: 1, title: '视频', tags: ['ready'], sourceFolderIds: ['source'] }]
    })
    await coordinator.finishScan('100')
    const callsBeforeReselect = classifyCurrentItems.mock.calls.length
    reselected = true
    await expect(coordinator.setRoundExcludedLedgerIds('100', [])).resolves.toMatchObject({
      classifications: {
        1: expect.objectContaining({ targetLedgerIds: ['genshin'] })
      },
      planReadiness: expect.objectContaining({ classifiedAidCount: 1 })
    })
    expect(classifyCurrentItems.mock.calls.length).toBeGreaterThan(callsBeforeReselect)
  })

  it('does not implicitly reinclude a saved rule that was disabled at round start', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-08-27T00:00:00.000Z' })
    const classifyCurrentItems = vi.fn((items: Array<{ aid: number }>) => items.map(() => ({
      targetLedgerIds: ['game'], confidence: 'high' as const
    })))
    const savedLedgers: FavoriteLedger[] = [
      { id: 'game', displayName: 'bilimi·游戏专区', keywords: ['游戏'], ruleType: 'keyword', enabled: true, priority: 1, isDefault: false, ruleOrigin: 'saved-rule' },
      { id: 'music', displayName: 'bilimi·音乐', keywords: ['音乐'], ruleType: 'keyword', enabled: false, priority: 2, isDefault: false, ruleOrigin: 'saved-rule' }
    ]
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      classifyCurrentItems,
      loadFavoriteLedgerHistoryLedgers: vi.fn().mockResolvedValue(savedLedgers),
      listSavedLedgers: vi.fn().mockResolvedValue(savedLedgers.map((ledger) => ({ id: ledger.id, title: ledger.displayName }))),
      listSavedEnabledLedgers: vi.fn().mockResolvedValue([{ id: 'game', title: 'bilimi·游戏专区' }])
    })
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })

    await coordinator.setRoundExcludedLedgerIds('100', ['game'])
    const callsBeforeReenable = classifyCurrentItems.mock.calls.length
    await coordinator.setRoundExcludedLedgerIds('100', [])

    expect(classifyCurrentItems.mock.calls.length).toBeGreaterThan(callsBeforeReenable)
    expect(classifyCurrentItems).toHaveBeenLastCalledWith(
      expect.any(Array), expect.any(Array), '100',
      expect.objectContaining({ participatingSavedLedgerIds: ['game'] })
    )
  })

  it('reclassifies an explicit upper-card re-enable before the enabled preference write completes', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-08-28T00:00:00.000Z' })
    const ledger: FavoriteLedger = {
      id: 'game', displayName: 'bilimi·游戏专区', keywords: ['游戏'], ruleType: 'keyword',
      enabled: false, priority: 1, isDefault: false, ruleOrigin: 'saved-rule'
    }
    const classifyCurrentItems = vi.fn((items: Array<{ aid: number }>) => items.map(() => ({
      targetLedgerIds: ['game'], confidence: 'high' as const
    })))
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      classifyCurrentItems,
      loadFavoriteLedgerHistoryLedgers: vi.fn().mockResolvedValue([ledger]),
      listSavedLedgers: vi.fn().mockResolvedValue([{ id: ledger.id, title: ledger.displayName }]),
      // This is the renderer's real ordering: the selection command runs before
      // the narrow account preference write has changed enabled=false to true.
      listSavedEnabledLedgers: vi.fn().mockResolvedValue([])
    })
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    const callsBeforeReenable = classifyCurrentItems.mock.calls.length

    await coordinator.setRoundExcludedLedgerIds('100', [], {
      participatingSavedLedgerIds: ['game']
    })

    expect(classifyCurrentItems.mock.calls.length).toBeGreaterThan(callsBeforeReenable)
    expect(classifyCurrentItems).toHaveBeenLastCalledWith(
      expect.any(Array), expect.any(Array), '100',
      expect.objectContaining({ participatingSavedLedgerIds: ['game'] })
    )
  })

  it('restores the persisted round-start checkbox state instead of a later history before-state', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-08-27T00:00:00.000Z' })
    const restoreFavoriteLedgerHistoryState = vi.fn().mockResolvedValue(undefined)
    const initialLedger: FavoriteLedger = {
      id: 'genshin', displayName: 'bilimi·原神', keywords: ['原神'], ruleType: 'tag',
      enabled: false, priority: 1, isDefault: false
    }
    let currentLedgers = [initialLedger]
    let firstClassification = true
    const classifyCurrentItem = vi.fn(() => ({
      targetLedgerIds: firstClassification ? ['initial'] : ['manual'],
      confidence: 'high' as const
    }))
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      classifyCurrentItem,
      loadFavoriteLedgerHistoryLedgers: vi.fn().mockImplementation(async () => currentLedgers),
      restoreFavoriteLedgerHistoryState
    })
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [{ aid: 1, title: '视频', tags: ['ready'], sourceFolderIds: ['source'] }]
    })
    await coordinator.finishScan('100')
    firstClassification = false
    const baseline = requireSnapshot(await coordinator.getSnapshot('100')).history.baselineCursor ?? 0
    expect(baseline).toBeGreaterThan(0)
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['manual'] }]
    })
    const laterEnabled: FavoriteLedger = { ...initialLedger, enabled: true }
    currentLedgers = [laterEnabled]
    await coordinator.recordFavoriteLedgerHistoryChange('100', {
      before: { ledgers: [laterEnabled], adoptedCandidateIds: [], excludedLedgerIds: [] },
      after: { ledgers: [{ ...laterEnabled, enabled: false }], adoptedCandidateIds: [], excludedLedgerIds: ['genshin'] },
      mergeWithLatestClassification: true
    })

    await coordinator.moveHistoryCursor('100', baseline)

    expect(restoreFavoriteLedgerHistoryState).toHaveBeenLastCalledWith('100', {
      ledgers: [initialLedger], adoptedCandidateIds: [], excludedLedgerIds: []
    })
  })

  it('does not run a new classifier when restoring its historical baseline participation set', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-08-28T00:00:00.000Z' })
    const ledger: FavoriteLedger = {
      id: 'game', displayName: 'bilimi·游戏专区', keywords: ['游戏'], ruleType: 'keyword',
      enabled: true, priority: 1, isDefault: false, ruleOrigin: 'saved-rule'
    }
    const classifyCurrentItems = vi.fn((items: Array<{ aid: number }>) => items.map(() => ({
      targetLedgerIds: ['game'], confidence: 'high' as const
    })))
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      classifyCurrentItems,
      loadFavoriteLedgerHistoryLedgers: vi.fn().mockResolvedValue([ledger]),
      restoreFavoriteLedgerHistoryState: vi.fn().mockResolvedValue(undefined),
      listSavedLedgers: vi.fn().mockResolvedValue([{ id: ledger.id, title: ledger.displayName }]),
      listSavedEnabledLedgers: vi.fn().mockResolvedValue([{ id: ledger.id, title: ledger.displayName }])
    })
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    const baseline = requireSnapshot(await coordinator.getSnapshot('100')).history.baselineCursor ?? 0
    await coordinator.setRoundExcludedLedgerIds('100', ['game'])
    const callsBeforeRestore = classifyCurrentItems.mock.calls.length

    await coordinator.moveHistoryCursor('100', baseline)

    expect(classifyCurrentItems.mock.calls.length).toBe(callsBeforeRestore)
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      classifications: {},
      history: { cursor: baseline }
    })
  })

  it('persists the restored round participation set for a later restart', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-08-27T00:00:00.000Z' })
    const classifyCurrentItems = vi.fn((items: Array<{ aid: number }>) => items.map(() => ({
      targetLedgerIds: ['game'], confidence: 'high' as const
    })))
    const ledger: FavoriteLedger = {
      id: 'game', displayName: 'bilimi·游戏专区', keywords: ['游戏'], ruleType: 'keyword',
      enabled: false, priority: 1, isDefault: false, ruleOrigin: 'saved-rule'
    }
    const createOptions = (restoreFavoriteLedgerHistoryState = vi.fn().mockResolvedValue(undefined)) => ({
      classifyCurrentItems,
      loadFavoriteLedgerHistoryLedgers: vi.fn().mockResolvedValue([ledger]),
      listSavedLedgers: vi.fn().mockResolvedValue([{ id: 'game', title: ledger.displayName }]),
      listSavedEnabledLedgers: vi.fn().mockResolvedValue([{ id: 'game', title: ledger.displayName }]),
      restoreFavoriteLedgerHistoryState
    })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), createOptions())
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.setRoundExcludedLedgerIds('100', ['game'])
    await coordinator.setRoundExcludedLedgerIds('100', [])
    const baseline = requireSnapshot(await coordinator.getSnapshot('100')).history.baselineCursor ?? 0
    await coordinator.moveHistoryCursor('100', baseline)
    const callsBeforeSameProcessCheck = classifyCurrentItems.mock.calls.length
    await coordinator.setRoundExcludedLedgerIds('100', ['game'])
    expect(classifyCurrentItems.mock.calls.length).toBe(callsBeforeSameProcessCheck)

    const restarted = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      ...createOptions(), initializeOnOpen: false
    })
    await restarted.getSnapshot('100')
    const callsBefore = classifyCurrentItems.mock.calls.length
    await restarted.setRoundExcludedLedgerIds('100', ['game'])

    expect(classifyCurrentItems.mock.calls.length).toBe(callsBefore)
  })

  it('does not require a remote target for an aid whose only classification is excluded from this round', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-08-23T00:00:00.000Z' })
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore,
      listSavedEnabledLedgers: vi.fn().mockResolvedValue([{ id: 'genshin', title: 'bilimi·原神' }]),
      now: () => '2026-08-23T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['genshin'] }]
    })
    await coordinator.setRoundExcludedLedgerIds('100', ['genshin'])

    await expect(coordinator.getBilibiliExecutionPreflight('100')).resolves.toMatchObject({
      missingLedgers: [], requiredPhysicalShards: []
    })
    await expect(coordinator.freezeForBilibiliExecution('100')).resolves.toMatchObject({
      frozenSyncPlan: { operations: [] }
    })
  })

  it('reports capacity shards only for selected targets without mutating the workspace', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const ensurePhysicalShard = vi.fn()
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      bindingService: { ensurePhysicalShard },
      listSavedEnabledLedgers: vi.fn().mockResolvedValue([
        { id: 'game', title: 'bilimi·游戏专区' },
        { id: 'honker233', title: 'bilimi·honker233' }
      ]),
      now: () => '2026-07-20T00:00:00.000Z'
    })
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    await bindings.preparePhysicalShard('100', {
      logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区', remoteDisplayTitle: 'bilimi·游戏专区', shardNumber: 1,
      memberAids: [], observedAccountMid: '100', remoteFolderId: 'game-1',
      inventory: [{ id: 'game-1', title: 'bilimi·游戏专区', memberCount: 999, memberAids: [] }]
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1, 2] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['game'] }, { aid: 2, targetLedgerIds: ['game'] }]
    })
    await coordinator.setRoundExcludedLedgerIds('100', ['honker233'])
    const revisionBefore = (await repository.getSnapshot('100')).revision

    await expect(coordinator.getBilibiliExecutionPreflight('100')).resolves.toEqual(expect.objectContaining({
      accountMid: '100',
      missingLedgers: [],
      requiredPhysicalShards: [{ logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区', shardNumber: 2, requiredAssignmentCount: 2, bindingCandidates: [] }]
    }))

    expect(ensurePhysicalShard).not.toHaveBeenCalled()
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({ revision: revisionBefore, workspace: { status: 'previewing' } })
  })

  it('uses only live exact shard ids and live counts when reporting the next capacity shard', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-09-10T00:00:00.000Z' })
    const ensurePhysicalShard = vi.fn()
    const inspectBoundPhysicalShardsFromRemote = vi.fn().mockResolvedValue([
      { logicalLedgerId: 'game', remoteFolderId: 'game-1', shardNumber: 1, memberCount: 999 }
    ])
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      bindingService: { ensurePhysicalShard, inspectBoundPhysicalShardsFromRemote },
      listSavedEnabledLedgers: vi.fn().mockResolvedValue([{ id: 'game', title: 'bilimi·游戏专区' }]),
      now: () => '2026-09-10T00:00:00.000Z'
    })
    const staleMemberAids = Array.from({ length: 1_000 }, (_unused, index) => index + 1)
    for (const [shardNumber, remoteFolderId, remoteTitle] of [
      [1, 'game-1', 'bilimi·游戏专区'],
      [2, 'deleted-game-2', 'bilimi·游戏专区②'],
      [3, 'deleted-game-3', 'bilimi·游戏专区③']
    ] as const) {
      await repository.commit('100', {
        id: `stale-game-${shardNumber}`, accountMid: '100', issuedAt: `2026-09-10T00:00:0${shardNumber}.000Z`,
        type: 'upsert-physical-shard-binding', payload: {
          logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区', shardNumber, memberAids: staleMemberAids,
          remoteTitle, bindingState: 'bound', remoteFolderId, remoteMemberCount: 1_000
        }
      })
    }
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1001, 1002] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [
        { aid: 1001, targetLedgerIds: ['game'] },
        { aid: 1002, targetLedgerIds: ['game'] }
      ]
    })
    const revisionBefore = (await repository.getSnapshot('100')).revision

    await expect(coordinator.getBilibiliExecutionPreflight('100')).resolves.toMatchObject({
      missingLedgers: [],
      requiredPhysicalShards: [{
        logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区', shardNumber: 2,
        requiredAssignmentCount: 2, bindingCandidates: []
      }]
    })

    expect(inspectBoundPhysicalShardsFromRemote).toHaveBeenCalledWith('100', { logicalLedgerIds: ['game'] })
    expect(ensurePhysicalShard).not.toHaveBeenCalled()
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({ revision: revisionBefore, workspace: { status: 'previewing' } })
  })

  it('freezes with the same live shard capacity used by preflight instead of a stale local mirror', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-09-10T00:00:00.000Z' })
    const inspectBoundPhysicalShardsFromRemote = vi.fn().mockResolvedValue([
      { logicalLedgerId: 'game', remoteFolderId: 'game-1', shardNumber: 1, memberCount: 3 }
    ])
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      bindingService: { ensurePhysicalShard: vi.fn(), inspectBoundPhysicalShardsFromRemote },
      listSavedEnabledLedgers: vi.fn().mockResolvedValue([{ id: 'game', title: 'bilimi·游戏专区' }]),
      now: () => '2026-09-10T00:00:00.000Z'
    })
    await repository.commit('100', {
      id: 'stale-game-1', accountMid: '100', issuedAt: '2026-09-10T00:00:00.000Z', type: 'upsert-physical-shard-binding',
      payload: {
        logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区', shardNumber: 1,
        memberAids: Array.from({ length: 1_000 }, (_unused, index) => index + 1),
        remoteTitle: 'bilimi·游戏专区', bindingState: 'bound', remoteFolderId: 'game-1', remoteMemberCount: 1_000
      }
    })
    const incomingAids = Array.from({ length: 57 }, (_unused, index) => index + 1001)
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: incomingAids })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: incomingAids.map((aid) => ({ aid, targetLedgerIds: ['game'] }))
    })

    await expect(coordinator.freezeForBilibiliExecution('100')).resolves.toMatchObject({
      frozenSyncPlan: { operations: expect.arrayContaining([
        expect.objectContaining({ aid: 1001, folderIds: ['game-1'] }),
        expect.objectContaining({ aid: 1057, folderIds: ['game-1'] })
      ]) }
    })

    expect(inspectBoundPhysicalShardsFromRemote).toHaveBeenCalledWith('100', { logicalLedgerIds: ['game'] })
  })

  it('requires explicit rebinding when every locally bound exact shard id is absent from the live directory', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-09-10T00:00:00.000Z' })
    const ensurePhysicalShard = vi.fn()
    const inspectBoundPhysicalShardsFromRemote = vi.fn().mockResolvedValue([])
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      bindingService: { ensurePhysicalShard, inspectBoundPhysicalShardsFromRemote },
      listSavedEnabledLedgers: vi.fn().mockResolvedValue([{ id: 'game', title: 'bilimi·游戏专区' }]),
      now: () => '2026-09-10T00:00:00.000Z'
    })
    await repository.commit('100', {
      id: 'missing-game-1', accountMid: '100', issuedAt: '2026-09-10T00:00:00.000Z', type: 'upsert-physical-shard-binding',
      payload: {
        logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区', shardNumber: 1, memberAids: [],
        remoteTitle: 'bilimi·游戏专区', bindingState: 'bound', remoteFolderId: 'deleted-game-1', remoteMemberCount: 0
      }
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['game'] }]
    })

    await expect(coordinator.getBilibiliExecutionPreflight('100')).resolves.toMatchObject({
      missingLedgers: [{ logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区', reason: 'unbound', bindingCandidates: [] }],
      requiredPhysicalShards: []
    })

    expect(ensurePhysicalShard).not.toHaveBeenCalled()
  })

  it('does not block a frozen plan for an unbacked ledger with no round assignments', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const ensurePhysicalShard = vi.fn()
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      bindingService: { ensurePhysicalShard },
      listSavedEnabledLedgers: vi.fn().mockResolvedValue([
        { id: 'music', title: 'bilimi·音乐' },
        { id: 'honker233', title: 'bilimi·honker233' }
      ]),
      now: () => '2026-07-20T00:00:00.000Z'
    })
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    await bindings.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: 'bilimi·音乐', shardNumber: 1,
      memberAids: [], observedAccountMid: '100', remoteFolderId: 'music-1',
      inventory: [{ id: 'music-1', title: 'B-music-001-a1b2c3', memberCount: 0, memberAids: [] }]
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })
    await coordinator.setRoundExcludedLedgerIds('100', ['honker233'])
    await expect(coordinator.getBilibiliExecutionPreflight('100')).resolves.toMatchObject({
      missingLedgers: [], requiredPhysicalShards: []
    })
    await expect(coordinator.freezeForBilibiliExecution('100')).resolves.toMatchObject({
      frozenSyncPlan: { operations: [expect.objectContaining({ aid: 1, folderIds: ['music-1'] })] }
    })

    expect(ensurePhysicalShard).not.toHaveBeenCalled()
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({ workspace: { status: 'frozen' } })
  })

  it('returns an exact discovered capacity-shard candidate and refuses to provision it implicitly', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const ensurePhysicalShard = vi.fn()
    const previewLedgerBindingCandidates = vi.fn().mockResolvedValue([{
      ledgerId: 'game', candidates: [
        { id: 'game-2', title: 'bilimi·游戏专区②', memberCount: 8 },
        { id: 'other-game', title: 'bilimi·游戏专区', memberCount: 8 }
      ]
    }])
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      bindingService: { ensurePhysicalShard, previewLedgerBindingCandidates },
      listSavedEnabledLedgers: vi.fn().mockResolvedValue([{ id: 'game', title: 'bilimi·游戏专区' }]),
      now: () => '2026-07-20T00:00:00.000Z'
    })
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    await bindings.preparePhysicalShard('100', {
      logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区', remoteDisplayTitle: 'bilimi·游戏专区', shardNumber: 1,
      memberAids: [], observedAccountMid: '100', remoteFolderId: 'game-1',
      inventory: [{ id: 'game-1', title: 'bilimi·游戏专区', memberCount: 999, memberAids: [] }]
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1, 2] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['game'] }, { aid: 2, targetLedgerIds: ['game'] }]
    })

    await expect(coordinator.getBilibiliExecutionPreflight('100')).resolves.toMatchObject({
      requiredPhysicalShards: [{
        logicalLedgerId: 'game', shardNumber: 2,
        bindingCandidates: [{ remoteFolderId: 'game-2', remoteTitle: 'bilimi·游戏专区②', memberCount: 8 }]
      }]
    })
    await expect(coordinator.provisionBilibiliExecutionPreflightShards('100')).rejects.toThrow('candidate-confirmation-required')
    expect(ensurePhysicalShard).not.toHaveBeenCalled()
  })

  it('provisions only preflight-listed physical shards after all logical ledgers are formally backed', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const ensurePhysicalShard = vi.fn().mockResolvedValue({})
    const onPhysicalShardProvisioned = vi.fn().mockResolvedValue(undefined)
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      bindingService: { ensurePhysicalShard },
      listSavedEnabledLedgers: vi.fn().mockResolvedValue([{ id: 'music', title: 'bilimi·音乐' }]),
      onPhysicalShardProvisioned,
      now: () => '2026-07-20T00:00:00.000Z'
    })
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    await bindings.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: 'bilimi·音乐', remoteDisplayTitle: 'bilimi·音乐', shardNumber: 1,
      memberAids: [], observedAccountMid: '100', remoteFolderId: 'music-1',
      inventory: [{ id: 'music-1', title: 'bilimi·音乐', memberCount: 999, memberAids: [] }]
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1, 2] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }, { aid: 2, targetLedgerIds: ['music'] }]
    })

    await coordinator.provisionBilibiliExecutionPreflightShards('100')

    expect(ensurePhysicalShard).toHaveBeenCalledWith('100', expect.objectContaining({
      logicalLedgerId: 'music', logicalTitle: 'bilimi·音乐', shardNumber: 2
    }))
    expect(onPhysicalShardProvisioned).toHaveBeenCalledOnce()
    expect(onPhysicalShardProvisioned).toHaveBeenCalledWith('100')
  })

  it('releases absent exact shard ids then reuses the lowest missing capacity shard number', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-09-10T00:00:00.000Z' })
    const ensurePhysicalShard = vi.fn().mockResolvedValue({})
    const releaseBoundPhysicalShardsAbsentFromRemote = vi.fn(async () => {
      await repository.commit('100', {
        id: 'release-game-2', accountMid: '100', issuedAt: '2026-09-10T00:00:02.000Z',
        type: 'remove-physical-shard-binding', payload: { remoteFolderId: 'game-2' }
      })
      return { releasedRemoteFolderIds: ['game-2'] }
    })
    const onPhysicalShardProvisioned = vi.fn().mockResolvedValue(undefined)
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      bindingService: { ensurePhysicalShard, releaseBoundPhysicalShardsAbsentFromRemote },
      listSavedEnabledLedgers: vi.fn().mockResolvedValue([{ id: 'game', title: 'bilimi·游戏专区' }]),
      onPhysicalShardProvisioned,
      now: () => '2026-09-10T00:00:00.000Z'
    })
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    const memberAids = Array.from({ length: 1000 }, (_, index) => index + 1)
    for (const [shardNumber, remoteFolderId, remoteTitle] of [
      [1, 'game-1', 'bilimi·游戏专区'],
      [2, 'game-2', 'bilimi·游戏专区②'],
      [3, 'game-3', 'bilimi·游戏专区③']
    ] as const) {
      await bindings.preparePhysicalShard('100', {
        logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区', remoteDisplayTitle: 'bilimi·游戏专区', shardNumber,
        memberAids, observedAccountMid: '100', remoteFolderId,
        inventory: [{ id: remoteFolderId, title: remoteTitle, memberCount: 1000, memberAids }]
      })
    }
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1001] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1001, targetLedgerIds: ['game'] }]
    })

    await coordinator.provisionBilibiliExecutionPreflightShards('100')

    expect(releaseBoundPhysicalShardsAbsentFromRemote).toHaveBeenCalledWith('100', {
      logicalLedgerIds: ['game']
    })
    expect(ensurePhysicalShard).toHaveBeenCalledWith('100', expect.objectContaining({
      logicalLedgerId: 'game', shardNumber: 2
    }))
    expect(onPhysicalShardProvisioned).toHaveBeenCalledTimes(2)
    expect(onPhysicalShardProvisioned).toHaveBeenNthCalledWith(1, '100')
    expect(onPhysicalShardProvisioned).toHaveBeenNthCalledWith(2, '100')
  })

  it('requires explicit confirmation for a same-title replacement after releasing an absent exact shard id', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-09-10T00:00:00.000Z' })
    const ensurePhysicalShard = vi.fn()
    const releaseBoundPhysicalShardsAbsentFromRemote = vi.fn(async () => {
      await repository.commit('100', {
        id: 'release-game-2', accountMid: '100', issuedAt: '2026-09-10T00:00:02.000Z',
        type: 'remove-physical-shard-binding', payload: { remoteFolderId: 'game-2' }
      })
      return { releasedRemoteFolderIds: ['game-2'] }
    })
    const previewLedgerBindingCandidates = vi.fn().mockResolvedValue([{
      ledgerId: 'game', candidates: [{ id: 'replacement-game-2', title: 'bilimi·游戏专区②', memberCount: 0 }]
    }])
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      bindingService: { ensurePhysicalShard, releaseBoundPhysicalShardsAbsentFromRemote, previewLedgerBindingCandidates },
      listSavedEnabledLedgers: vi.fn().mockResolvedValue([{ id: 'game', title: 'bilimi·游戏专区' }]),
      now: () => '2026-09-10T00:00:00.000Z'
    })
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    const memberAids = Array.from({ length: 1000 }, (_, index) => index + 1)
    for (const [shardNumber, remoteFolderId, remoteTitle] of [
      [1, 'game-1', 'bilimi·游戏专区'],
      [2, 'game-2', 'bilimi·游戏专区②'],
      [3, 'game-3', 'bilimi·游戏专区③']
    ] as const) {
      await bindings.preparePhysicalShard('100', {
        logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区', remoteDisplayTitle: 'bilimi·游戏专区', shardNumber,
        memberAids, observedAccountMid: '100', remoteFolderId,
        inventory: [{ id: remoteFolderId, title: remoteTitle, memberCount: 1000, memberAids }]
      })
    }
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1001] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1001, targetLedgerIds: ['game'] }]
    })

    await expect(coordinator.provisionBilibiliExecutionPreflightShards('100')).rejects.toThrow('candidate-confirmation-required')

    expect(releaseBoundPhysicalShardsAbsentFromRemote).toHaveBeenCalledOnce()
    expect(ensurePhysicalShard).not.toHaveBeenCalled()
  })

  it('blocks a manually created local ledger from remote execution until it is formally bound', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root })
    const ensurePhysicalShard = vi.fn().mockRejectedValue(new Error('Favorite repository page bridge is unavailable.'))
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

    await expect(coordinator.freezeForBilibiliExecution('100')).rejects.toThrow('backup-preflight-required')
    expect(ensurePhysicalShard).not.toHaveBeenCalled()
  })

  it('reports capacity backup requirement before creating the required next shard', async () => {
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

    await expect(coordinator.freezeForBilibiliExecution('100')).rejects.toThrow('backup-preflight-required')
    expect(ensurePhysicalShard).not.toHaveBeenCalled()
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

  it('links each frozen remote operation to the local organize adjustment that produced it', async () => {
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

    await coordinator.freezeForBilibiliExecution('100')

    const snapshot = await repository.getSnapshot('100')
    const adjustment = snapshot.classificationAdjustments.find((record) => record.aid === 1 && record.operation === 'organize-favorites')
    expect(adjustment).toEqual(expect.objectContaining({ classificationSource: 'manual', bilibiliSync: { attempted: false } }))
    expect(snapshot.workspace?.frozenSyncPlan?.operations).toEqual([
      expect.objectContaining({ aid: 1, classificationAdjustmentId: adjustment?.id })
    ])
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

  it('stops an executing Bilibili run only after preserving its full local organization result', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    const stopAndAbandonFrozenPlan = vi.fn()
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }), bindingService: bindings,
      syncService: createSyncService({ stopAndAbandonFrozenPlan }), now: () => '2026-07-20T00:00:00.000Z'
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
    await repository.commit('100', {
      id: 'executing-run', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'set-workspace',
      payload: { ...frozen, status: 'executing', workspaceRef: { ...frozen.workspaceRef, status: 'executing' }, frozenSyncPlan: frozen.frozenSyncPlan! }
    })

    await coordinator.stopBilibiliSyncAndFinish('100')

    expect(stopAndAbandonFrozenPlan).toHaveBeenCalledWith('100')
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      memberships: { 'bilimi-logical:music': [1], 'local:inbox': [2] },
      positions: { '100:1': expect.objectContaining({ localDesiredFolderIds: ['bilimi-logical:music'] }) }
    })
  })

  it('pauses an executing Bilibili run without abandoning its frozen plan', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    const pauseFrozenPlan = vi.fn(async () => {
      const persisted = await repository.getSnapshot('100')
      const workspace = persisted.workspace!
      await repository.commit('100', {
        id: 'paused-run', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'set-workspace',
        payload: {
          ...workspace,
          status: 'frozen',
          workspaceRef: { ...workspace.workspaceRef, status: 'frozen', currentStep: 'sync-paused' }
        }
      })
    })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }), bindingService: bindings,
      syncService: createSyncService({
        pauseFrozenPlan,
        getRun: vi.fn().mockResolvedValue({
          id: 'run-1', accountMid: '100', workspaceId: 'workspace-1', status: 'running',
          completedOperationCount: 0, totalOperationCount: 1
        })
      }), now: () => '2026-07-20T00:00:00.000Z'
    })
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
    const frozen = await coordinator.freezeForBilibiliExecution('100')
    await repository.commit('100', {
      id: 'executing-run', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'set-workspace',
      payload: { ...frozen, status: 'executing', workspaceRef: { ...frozen.workspaceRef, status: 'executing' }, frozenSyncPlan: frozen.frozenSyncPlan! }
    })

    await expect(coordinator.pauseBilibiliSync('100')).resolves.toMatchObject({
      status: 'frozen',
      executionProgress: { syncPaused: true }
    })
    expect(pauseFrozenPlan).toHaveBeenCalledWith('100')
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      workspace: { status: 'frozen', frozenSyncPlan: frozen.frozenSyncPlan }
    })
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

  it('commits the complete local result once before starting a Bilibili run', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }), bindingService: bindings,
      now: () => '2026-07-20T00:00:00.000Z'
    })
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
    const commitCompleteLocalResult = vi.spyOn(coordinator as never, 'commitCompleteLocalResultForRemoteExecution')

    await expect(coordinator.beginBilibiliExecution('100')).rejects.toThrow('Old favorite workspace sync service is unavailable.')

    expect(commitCompleteLocalResult).toHaveBeenCalledTimes(1)
  })

  it('yields while preparing a 2,001-item local result before freezing its Bilibili plan', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const bindings = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    const yieldToEventLoop = vi.fn().mockResolvedValue(undefined)
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore,
      bindingService: bindings,
      segmentSize: () => 2_000,
      now: () => '2026-07-20T00:00:00.000Z',
      yieldToEventLoop
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', {
      revision: 1,
      aids: Array.from({ length: 2_001 }, (_unused, index) => index + 1)
    })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual',
      assignments: Array.from({ length: 2_000 }, (_unused, index) => ({
        aid: index + 1, targetLedgerIds: index < 1_000 ? ['music'] : ['inbox']
      }))
    })
    await coordinator.selectSegment('100', 'segment-2')
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 2_001, targetLedgerIds: ['inbox'] }]
    })
    await bindings.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber: 1, memberAids: [], observedAccountMid: '100',
      remoteFolderId: 'remote-music-1',
      inventory: [{ id: 'remote-music-1', title: favoriteRepositoryManagedShardTitle('music', 1, 'a1b2c3'), memberCount: 0, memberAids: [] }]
    })

    const workspaceId = (await repository.getSnapshot('100')).workspace!.id
    const readsBeforeFreeze = await workspaceStore.readWorkspaceReads('100', workspaceId)
    const recover = vi.spyOn(workspaceStore, 'recover')

    await expect(coordinator.freezeForBilibiliExecution('100')).resolves.toMatchObject({ status: 'frozen' })

    expect(yieldToEventLoop).toHaveBeenCalled()
    expect(recover).not.toHaveBeenCalled()
    const readsAfterFreeze = await workspaceStore.readWorkspaceReads('100', workspaceId)
    expect(readsAfterFreeze.slice(readsBeforeFreeze.length)).not.toContain('overlay.journal.jsonl')
  }, 15_000)

  it('does not commit or provision a missing Bilibili target while freeze is blocked', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    let localSnapshotAtProvisioning: Awaited<ReturnType<FavoriteRepositoryService['getSnapshot']>> | undefined
    const createFolder = vi.fn().mockImplementation(async () => {
      localSnapshotAtProvisioning = await repository.getSnapshot('100')
      return { observedAccountMid: '100', folder: { id: 'remote-music-1', title: 'bilimi·Music', memberCount: 0 } }
    })
    const pageBridgeManager = {
      bind: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
      pageBridge: vi.fn(() => ({
        readFolderInventory: vi.fn().mockImplementation(async () => ({
          observedAccountMid: '100', folders: []
        })),
        createFolder,
        append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
      }))
    }
    const bindings = new FavoriteRepositoryBindingService({
      repository, newBindingToken: () => 'a1b2c3', pageBridgeManager
    })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }), bindingService: bindings,
      resolveLedgerTitle: vi.fn().mockResolvedValue('bilimi·Music'),
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })

    await expect(coordinator.freezeForBilibiliExecution('100')).rejects.toThrow('backup-preflight-required')
    expect(createFolder).not.toHaveBeenCalled()
    expect(localSnapshotAtProvisioning).toBeUndefined()
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({ workspace: { status: 'previewing' } })
  })

  it('retries a changed local result without reusing a prior workspace command id', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository, workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      now: () => '2026-07-20T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })

    const workspaceId = (await repository.getSnapshot('100')).workspace!.id
    await repository.commit('100', {
      id: `old-favorite-workspace:remote-local:${workspaceId}`,
      accountMid: '100',
      issuedAt: '2026-07-20T00:00:00.000Z',
      type: 'commit-local-plan',
      payload: {
        workspaceId,
        memberAidsByFolderId: { 'local:inbox': [1] },
        folders: [{ id: 'local:inbox', title: 'bilimi\u00b7\u6682\u5b58', kind: 'local', syncState: 'local-only' }],
        videos: [{ aid: 1, title: 'Earlier local result', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }]
      }
    })

    await expect(coordinator.freezeForBilibiliExecution('100')).rejects.toThrow('Old favorite workspace cannot freeze: backup-preflight-required')
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

  it('backfills the complete local result without duplicating its original automatic classification audit', async () => {
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
      source: 'system-high', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })
    await bindings.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber: 1, memberAids: [], observedAccountMid: '100',
      remoteFolderId: 'remote-music-1',
      inventory: [{ id: 'remote-music-1', title: favoriteRepositoryManagedShardTitle('music', 1, 'a1b2c3'), memberCount: 0, memberAids: [] }]
    })
    const frozen = await coordinator.freezeForBilibiliExecution('100')
    await syncService.claimFrozenPlan('100', frozen.frozenSyncPlan!)
    await repository.commit('100', {
      id: 'simulate-legacy-missing-local-projection', accountMid: '100', issuedAt: '2026-07-20T00:00:30.000Z', type: 'set-favorite-placement',
      payload: {
        aid: 1, localDesiredFolderIds: [], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [],
        updatedAt: '2026-07-20T00:00:30.000Z'
      }
    })

    await coordinator.executeFrozenBilibiliPlan('100')
    await vi.waitFor(() => expect(append).toHaveBeenCalledOnce())

    expect(localSnapshotAtFirstWrite).toMatchObject({
      memberships: { 'bilimi-logical:music': [1], 'local:inbox': [2] },
      positions: {
        '100:1': expect.objectContaining({ localDesiredFolderIds: ['bilimi-logical:music'] }),
        '100:2': expect.objectContaining({ localDesiredFolderIds: [] })
      }
    })
    expect((await repository.getSnapshot('100')).classificationAdjustments.filter((record) =>
      record.aid === 1 && record.operation === 'organize-favorites'
    )).toHaveLength(1)
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

  it('keeps explicitly suppressed Bilimi observations out of source selection', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [
        {
          id: 'name-only', title: 'bilimi·只是同名', itemCount: 1,
          isBilimiWorkFolder: false, isBilimiWorkFolderCandidate: true, remoteRelationship: 'none', scanEligible: false
        },
        {
          id: 'ordinary', title: '普通收藏夹', itemCount: 1,
          isBilimiWorkFolder: false, remoteRelationship: 'none', scanEligible: true
        }
      ] as never
    })
    await coordinator.completeScan('100', { revision: 1, aids: [] })

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      sourceFolders: [
        { id: 'name-only', remoteRelationship: 'none', scanEligible: false, selected: false },
        { id: 'ordinary', remoteRelationship: 'none', scanEligible: true, selected: true }
      ]
    })
    await expect(coordinator.selectSourceFolders('100', ['name-only'])).rejects.toThrow('source selection is invalid')
    await expect(coordinator.selectSourceFolders('100', ['ordinary'])).resolves.toBeUndefined()
  })

  it('preserves explicitly suppressed Bilimi observations through relationship refreshes and restart', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const getFavoriteLedgersForScanProjection = vi.fn().mockResolvedValue([{
      id: 'learning', displayName: 'bilimi·学习', keywords: [], enabled: true, priority: 10,
      isDefault: true, bindingState: 'unbacked', bilibiliFolderId: 'remote-learning'
    }])
    const coordinator = createCoordinator(repository, store, { initializeOnOpen: false, getFavoriteLedgersForScanProjection })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{
        id: 'remote-learning', title: 'bilimi·学习', itemCount: 3,
        isBilimiWorkFolder: false, isBilimiWorkFolderCandidate: true,
        remoteRelationship: 'none', scanEligible: false, selected: false
      }]
    })
    await coordinator.completeScan('100', { revision: 1, aids: [1] })

    await expect(coordinator.refreshRelationshipProjection('100')).resolves.toMatchObject({
      sourceFolders: [{ id: 'remote-learning', remoteRelationship: 'none', isBilimiWorkFolder: false, scanEligible: false, selected: false }],
      inventoryMetrics: { sourceFolders: [{ id: 'remote-learning', selected: false, scanEligible: false }] },
      localWorkspaceFolders: []
    })
    const restored = createCoordinator(
      new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' }),
      new OldFavoriteWorkspaceStore({ root }),
      { initializeOnOpen: false, getFavoriteLedgersForScanProjection }
    )
    await expect(restored.refreshRelationshipProjection('100')).resolves.toMatchObject({
      sourceFolders: [{ id: 'remote-learning', remoteRelationship: 'none', isBilimiWorkFolder: false, scanEligible: false, selected: false }]
    })
    await expect(restored.getSnapshot('100')).resolves.toMatchObject({
      currentSegment: { id: 'segment-1', aids: [1] },
      sourceFolders: [{ id: 'remote-learning', remoteRelationship: 'none', isBilimiWorkFolder: false, scanEligible: false, selected: false }]
    })
  })

  it('does not treat a legacy Bilimi projection as authority when its card is non-Bilimi', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const coordinator = createCoordinator(repository, store, {
      initializeOnOpen: false,
      getFavoriteLedgersForScanProjection: vi.fn().mockResolvedValue([{
        id: 'ordinary', displayName: '普通收藏夹', keywords: [], enabled: true, priority: 10,
        isDefault: false, bindingState: 'bound', bilibiliFolderId: 'ordinary-bound'
      }])
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{
        id: 'ordinary-bound', title: '普通收藏夹', itemCount: 1,
        isBilimiWorkFolder: true, remoteRelationship: 'bound', scanEligible: true, selected: true
      }]
    })
    await coordinator.completeScan('100', { revision: 1, aids: [] })

    await expect(coordinator.refreshRelationshipProjection('100')).resolves.toMatchObject({
      sourceFolders: [{
        id: 'ordinary-bound', isBilimiWorkFolder: false,
        remoteRelationship: 'none', scanEligible: true, selected: true
      }]
    })
  })

  it('keeps the active segment when refreshing relationships before freezing the workspace', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const coordinator = createCoordinator(repository, store, { initializeOnOpen: false })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 0, isBilimiWorkFolder: false }]
    })
    await coordinator.completeScan('100', { revision: 1, aids: Array.from({ length: 2_001 }, (_value, index) => index + 1) })
    await coordinator.selectSegment('100', 'segment-2')

    await coordinator.refreshRelationshipProjection('100')

    await expect(coordinator.freezeForBilibiliExecution('100')).resolves.toMatchObject({ status: 'frozen' })
    expect((await repository.getSnapshot('100')).workspace?.workspaceRef.currentSegmentId).toBe('segment-2')
  })

  it('does not return a cached workspace after the manifest overlay changes', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const coordinator = createCoordinator(repository, store, { initializeOnOpen: false })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    const workspaceId = (await repository.getSnapshot('100')).workspace!.id
    await store.appendOverlay('100', workspaceId, {
      currentSegmentId: 'segment-1', classifications: [], history: [],
      scanMetadata: {
        sourceFolders: [{ id: 'fresh', title: 'Fresh', itemCount: 1, isBilimiWorkFolder: false }]
      }
    })

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      sourceFolders: [{ id: 'fresh', title: 'Fresh' }]
    })
  })

  it('keeps its in-memory workspace after its own overlay write', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const coordinator = createCoordinator(repository, store, { initializeOnOpen: false })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false }]
    })
    const recover = vi.spyOn(store, 'recover')
    recover.mockClear()

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      sourceFolders: [{ id: 'source', title: 'Source' }]
    })
    expect(recover).not.toHaveBeenCalled()
  })

  it('repairs a persisted marker when a checked journal recovers its empty active segment', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const first = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })
    await first.beginScan('100', 'incremental')
    await first.completeScan('100', { revision: 1, aids: [1] })
    const workspaceId = (await repository.getSnapshot('100')).workspace!.id
    const manifestPath = join(root, 'accounts', '100', 'workspaces', workspaceId, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
    const { checksum: _checksum, ...withoutChecksum } = manifest
    const stale = { ...withoutChecksum, currentSegmentId: '' }
    const { createHash } = await import('node:crypto')
    await writeFile(manifestPath, JSON.stringify({
      ...stale,
      checksum: createHash('sha256').update(JSON.stringify(stale)).digest('hex')
    }), 'utf8')

    const restarted = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), { initializeOnOpen: false })
    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({
      currentSegment: { id: 'segment-1', aids: [1] }
    })
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      workspace: { workspaceRef: { currentSegmentId: 'segment-1' } }
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

  it('restores DeepSeek organization details for every segment after restart', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const first = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false,
      segmentSize: () => 500
    })
    await first.beginScan('100', 'incremental')
    await first.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 501, isBilimiWorkFolder: false }]
    })
    const items = Array.from({ length: 501 }, (_unused, index) => ({
      aid: index + 1,
      title: index === 0 ? 'First batch result' : index === 500 ? 'Second batch result' : `Untouched ${index + 1}`,
      sourceFolderIds: ['source']
    }))
    for (let offset = 0; offset < items.length; offset += 50) {
      await first.recordScanPage('100', {
        folderId: 'source', page: offset / 50 + 1, hasMore: offset + 50 < items.length,
        items: items.slice(offset, offset + 50)
      })
    }
    await first.finishScan('100')
    await first.acceptCurrentTags('100')

    let snapshot = requireSnapshot(await first.getSnapshot('100'))
    await first.applyDeepSeekClassificationBatch('100', [{ aid: 1, targetLedgerIds: ['music'] }], {
      workspaceId: snapshot.workspaceId,
      currentSegmentId: snapshot.currentSegment!.id,
      selectedSourceFolderIds: ['source'],
      classifications: {}
    })
    snapshot = requireSnapshot(await first.getSnapshot('100'))
    await first.applyDeepSeekClassificationBatch('100', [{ aid: 1, targetLedgerIds: ['music'] }], {
      workspaceId: snapshot.workspaceId,
      currentSegmentId: snapshot.currentSegment!.id,
      selectedSourceFolderIds: ['source'],
      classifications: {
        '1': { targetLedgerIds: ['music'], source: 'deepseek' }
      }
    })
    await first.selectSegment('100', 'segment-2')
    await first.acceptCurrentTags('100')
    snapshot = requireSnapshot(await first.getSnapshot('100'))
    await first.applyDeepSeekClassificationBatch('100', [{ aid: 501, targetLedgerIds: ['knowledge'] }], {
      workspaceId: snapshot.workspaceId,
      currentSegmentId: snapshot.currentSegment!.id,
      selectedSourceFolderIds: ['source'],
      classifications: {}
    })

    const restarted = createCoordinator(
      new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' }),
      new OldFavoriteWorkspaceStore({ root }),
      { initializeOnOpen: false, segmentSize: () => 500 }
    )

    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({
      currentSegment: { id: 'segment-2' },
      deepSeekOrganization: {
        segments: [
          {
            id: 'segment-1', index: 0, status: 'organized',
            details: [{ aid: 1, title: 'First batch result', beforeTargetLedgerIds: ['music'], afterTargetLedgerIds: ['music'], changed: false }]
          },
          {
            id: 'segment-2', index: 1, status: 'organized',
            details: [{ aid: 501, title: 'Second batch result', beforeTargetLedgerIds: [], afterTargetLedgerIds: ['knowledge'], changed: true }]
          }
        ]
      }
    })
  })

  it('lets a completed DeepSeek batch replace a manual classification when its workspace context is unchanged', async () => {
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
      selectedSourceFolderIds: snapshot.sourceFolders.filter((folder) => folder.selected).map((folder) => folder.id),
      classifications: {}
    })).resolves.toMatchObject({ classifications: {
      '1': { targetLedgerIds: ['music'], source: 'deepseek' }
    } })
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      classifications: { '1': { targetLedgerIds: ['music'], source: 'deepseek' } },
      history: { cursor: 2, length: 2 }
    })
  })

  it('lets a later DeepSeek result replace prior manual classifications in the same workspace', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1, 2] })
    const snapshot = requireSnapshot(await coordinator.getSnapshot('100'))
    if (!snapshot.currentSegment) throw new Error('workspace unexpectedly unavailable')
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 2, targetLedgerIds: ['manual'] }]
    })

    const result = await coordinator.applyDeepSeekClassificationBatchWithConflicts('100', [
      { aid: 1, targetLedgerIds: ['deepseek'] }, { aid: 2, targetLedgerIds: ['deepseek'] }
    ], {
      workspaceId: snapshot.workspaceId,
      currentSegmentId: snapshot.currentSegment.id,
      selectedSourceFolderIds: snapshot.sourceFolders.filter((folder) => folder.selected).map((folder) => folder.id),
      classifications: Object.fromEntries(Object.entries(snapshot.classifications).map(([aid, classification]) => [aid, {
        targetLedgerIds: [...classification.targetLedgerIds], source: classification.source
      }]))
    })
    expect(result).toMatchObject({ appliedAids: [1, 2], conflictAids: [] })
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      classifications: {
        '1': { targetLedgerIds: ['deepseek'], source: 'deepseek' },
        '2': { targetLedgerIds: ['deepseek'], source: 'deepseek' }
      }
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
    const manifest = JSON.parse(await readFile(
      join(root, 'accounts', '100', 'workspaces', workspaceId, 'manifest.json'),
      'utf8'
    )) as { segments: Array<{ id: string; file: string }> }
    const currentSegmentFile = manifest.segments.find((segment) => segment.id === 'segment-2')!.file
    await expect(recoveredStore.readWorkspaceReads('100', workspaceId))
      .resolves.toEqual(['manifest.json', 'overlay.journal.jsonl', currentSegmentFile, 'manifest.json'])
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

    await coordinator.moveHistoryCursor('100', 0)
    const runtime = (coordinator as unknown as {
      overviewRuntimes: Map<string, { classificationsBySegment: Map<string, Map<number, { targetLedgerIds: string[] }>> }>
    }).overviewRuntimes.get('100')
    expect(runtime?.classificationsBySegment.get('segment-1')?.has(1)).toBe(false)
  })

  it.each([
    { label: 'running', checkpoint: { canceled: false, failed: false, pendingAids: [1], failedAids: [] } },
    { label: 'waiting', checkpoint: { canceled: false, failed: false, pendingAids: [], failedAids: [], waitingSegmentIds: ['segment-2'] } }
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

  it.each([
    { label: 'canceled', checkpoint: { canceled: true, failed: false, pendingAids: [1], failedAids: [] } },
    { label: 'failed', checkpoint: { canceled: false, failed: true, pendingAids: [], failedAids: [1] } }
  ])('keeps the current classification and allows local save when DeepSeek is $label', async ({ checkpoint }) => {
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

    await expect(coordinator.saveCurrentSegmentToLocalLibrary('100')).resolves.toMatchObject({ status: 'previewing' })
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      deepSeekRun: expect.objectContaining({ status: checkpoint.canceled ? 'canceled' : 'failed' }),
      classifications: { '1': { targetLedgerIds: ['music'], source: 'system-high' } },
      history: { entries: expect.not.arrayContaining([expect.objectContaining({ source: 'fallback' })]) }
    })
    await expect(coordinator.freezeForBilibiliExecution('100')).rejects.not.toThrow(/DeepSeek/i)
  })

  it('returns no DeepSeek checkpoint for an account without a workspace', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))

    await expect(coordinator.getDeepSeekRunCheckpoint('100')).resolves.toBeNull()
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
    const runtime = (coordinator as unknown as {
      overviewRuntimes: Map<string, { classificationsBySegment: Map<string, Map<number, { targetLedgerIds: string[] }>> }>
    }).overviewRuntimes.get('100')
    expect(runtime?.classificationsBySegment.get(before.currentSegment!.id)?.get(1)).toEqual(
      expect.objectContaining({ targetLedgerIds: ['original-music'] })
    )
    expect(resolved.history.entries[0]).toMatchObject({ source: 'fallback', summary: { reason: '沿用原自动分类' } })
    await expect(coordinator.saveCurrentSegmentToLocalLibrary('100')).resolves.toMatchObject({ status: 'previewing' })
  })

  it('restores canceled pending DeepSeek aids to their original automatic classifications', async () => {
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
      requestGroups: [], successfulAids: [], pendingAids: [1], failedAids: [], completedSegmentIds: [], waitingSegmentIds: [],
      canceled: true
    })
    await coordinator.setExecutionIntent('100', 'bilibili')
    await expect(coordinator.continueExecutionIntent('100')).rejects.toThrow('backup-preflight-required')

    await coordinator.useOriginalClassificationsForFailedDeepSeekAids('100')

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      classifications: { '1': { targetLedgerIds: ['original-music'], source: 'fallback' } },
      executionIntent: { mode: 'bilibili', status: 'blocked', failureCode: 'backup-preflight-required' }
    })
    await expect(coordinator.getDeepSeekRunCheckpoint('100')).resolves.toBeNull()
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

  it('restores saved-rule selection and recommendation adoption from a classification movement entry', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-08-25T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const restoreFavoriteLedgerHistoryState = vi.fn().mockResolvedValue(undefined)
    const beforeLedgers: FavoriteLedger[] = [{
      id: 'genshin', displayName: 'bilimi·原神', keywords: ['原神'], ruleType: 'tag',
      enabled: true, priority: 1, isDefault: false
    }]
    const afterLedgers: FavoriteLedger[] = beforeLedgers.map((ledger) => ({ ...ledger, enabled: false }))
    const coordinator = createCoordinator(repository, store, {
      restoreFavoriteLedgerHistoryState
    })
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [{ aid: 1, title: 'Video', sourceFolderIds: ['source'] }]
    })
    await coordinator.finishScan('100')
    await coordinator.acceptCurrentTags('100')
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['manual'] }]
    })

    await coordinator.recordFavoriteLedgerHistoryChange('100', {
      before: { ledgers: beforeLedgers, adoptedCandidateIds: ['custom-tag-genshin'], excludedLedgerIds: [] },
      after: { ledgers: afterLedgers, adoptedCandidateIds: [], excludedLedgerIds: ['genshin'] },
      mergeWithLatestClassification: true
    })
    const changed = requireSnapshot(await coordinator.getSnapshot('100'))
    expect(changed.history).toMatchObject({
      cursor: 1,
      entries: [{ cursor: 1, source: 'favorite-rules', changeCount: 1 }]
    })

    const restarted = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      initializeOnOpen: false,
      restoreFavoriteLedgerHistoryState
    })
    await restarted.moveHistoryCursor('100', 0)

    expect(restoreFavoriteLedgerHistoryState).toHaveBeenLastCalledWith('100', {
      ledgers: beforeLedgers,
      adoptedCandidateIds: ['custom-tag-genshin'],
      excludedLedgerIds: []
    })
    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({
      history: { cursor: 0, entries: [{ cursor: 1, source: 'favorite-rules' }] },
      recommendations: { adoptedCandidateIds: ['custom-tag-genshin'] }
    })
  })

  it('does not expose a history entry when a saved rule is created without classification movement', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-08-27T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    const created: FavoriteLedger = {
      id: 'music', displayName: 'bilimi·音乐', keywords: ['旋律'], ruleType: 'keyword',
      enabled: true, priority: 1, isDefault: false
    }
    await coordinator.open('100')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false }]
    })
    await coordinator.completeScan('100', { revision: 1, aids: [1] })

    await coordinator.recordFavoriteLedgerHistoryChange('100', {
      before: { ledgers: [], adoptedCandidateIds: [], excludedLedgerIds: [] },
      after: { ledgers: [created], adoptedCandidateIds: [], excludedLedgerIds: [] }
    })

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      history: { cursor: 0, length: 0, entries: [] }
    })
  })

  it('hides legacy zero-movement favorite-rule checkpoints and skips them when undoing', async () => {
    const root = await createRoot()
    const coordinator = createCoordinator(
      new FavoriteRepositoryService({ root, now: () => '2026-08-27T00:00:00.000Z' }),
      new OldFavoriteWorkspaceStore({ root })
    )
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [{ aid: 1, title: 'Video', sourceFolderIds: ['source'] }]
    })
    await coordinator.finishScan('100')
    await coordinator.acceptCurrentTags('100')
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['manual'] }]
    })
    const internals = coordinator as unknown as { workspaces: Map<string, OldFavoriteWorkspace> }
    const workspace = internals.workspaces.get('100')
    if (!workspace) throw new Error('workspace unexpectedly unavailable')
    const legacy: OldFavoriteWorkspaceHistoryEntry = {
      source: 'favorite-rules',
      changes: [],
      favoriteRuleState: {
        before: { ledgers: [], adoptedCandidateIds: [], excludedLedgerIds: [] },
        after: {
          ledgers: [{ id: 'legacy-genshin', displayName: 'bilimi·原神', keywords: ['原神'], ruleType: 'keyword', enabled: true, priority: 1, isDefault: false }],
          adoptedCandidateIds: [], excludedLedgerIds: []
        }
      }
    }
    internals.workspaces.set('100', {
      ...workspace,
      history: [...workspace.history, legacy],
      historyCursor: workspace.historyCursor + 1
    })

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      history: {
        cursor: 1,
        length: 1,
        entries: [{ cursor: 1, source: 'manual', changeCount: 1 }]
      }
    })

    await coordinator.undoClassificationChange('100')

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      classifications: {},
      history: { cursor: 0, length: 1, entries: [{ cursor: 1, source: 'manual', changeCount: 1 }] }
    })
  })

  it('replays the selected historical classification after restoring a rule-history entry', async () => {
    const root = await createRoot()
    const classifyCurrentItem = vi.fn(() => ({ targetLedgerIds: ['music'], confidence: 'high' as const }))
    const restoreFavoriteLedgerHistoryState = vi.fn().mockResolvedValue(undefined)
    const coordinator = createCoordinator(
      new FavoriteRepositoryService({ root, now: () => '2026-08-25T00:00:00.000Z' }),
      new OldFavoriteWorkspaceStore({ root }),
      { classifyCurrentItem, restoreFavoriteLedgerHistoryState }
    )
    await coordinator.open('100')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [{ aid: 1, title: 'Video', sourceFolderIds: ['source'] }]
    })
    await coordinator.finishScan('100')
    await coordinator.acceptCurrentTags('100')
    const baselineCursor = requireSnapshot(await coordinator.getSnapshot('100')).history.cursor
    await coordinator.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['manual'] }]
    })
    await coordinator.recordFavoriteLedgerHistoryChange('100', {
      before: { ledgers: [], adoptedCandidateIds: [], excludedLedgerIds: [] },
      after: { ledgers: [], adoptedCandidateIds: [], excludedLedgerIds: ['music'] },
      mergeWithLatestClassification: true
    })
    const manualHistoryCursor = requireSnapshot(await coordinator.getSnapshot('100')).history.cursor

    await coordinator.moveHistoryCursor('100', baselineCursor)
    const callsBeforeRestoringManualPosition = classifyCurrentItem.mock.calls.length
    await coordinator.moveHistoryCursor('100', manualHistoryCursor)

    expect(classifyCurrentItem.mock.calls.length).toBe(callsBeforeRestoringManualPosition)
    expect(restoreFavoriteLedgerHistoryState).toHaveBeenLastCalledWith('100', {
      ledgers: [], adoptedCandidateIds: [], excludedLedgerIds: ['music']
    })
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      classifications: { '1': { aid: 1, targetLedgerIds: ['manual'], source: 'manual' } },
      history: { cursor: manualHistoryCursor, length: manualHistoryCursor }
    })
  })

  it('keeps the original redo branch after rebuilding a restored rule-history projection', async () => {
    const root = await createRoot()
    const restoreFavoriteLedgerHistoryState = vi.fn().mockResolvedValue(undefined)
    const rules = createOrdinaryRuleDirectory()
    const coordinator = createCoordinator(
      new FavoriteRepositoryService({ root, now: () => '2026-08-25T00:00:00.000Z' }),
      new OldFavoriteWorkspaceStore({ root }),
      {
        classifyCurrentItem: (_item, recommendedLedgers = []) => ({
          targetLedgerIds: [recommendedLedgers[0]?.id ?? 'game'], confidence: 'high' as const
        }),
        restoreFavoriteLedgerHistoryState,
        ...rules,
        loadFavoriteLedgerHistoryLedgers: rules.loadFavoriteLedgerHistoryLedgers
      }
    )
    await coordinator.open('100')
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanInventory('100', {
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2, isBilimiWorkFolder: false }]
    })
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [
        { aid: 1, title: 'Video 1', author: 'UP Alpha', sourceFolderIds: ['source'] },
        { aid: 2, title: 'Video 2', author: 'UP Alpha', sourceFolderIds: ['source'] }
      ]
    })
    await coordinator.finishScan('100')
    await coordinator.acceptCurrentTags('100')
    await coordinator.setRecommendedCandidates('100', ['custom-author-up-alpha'])
    const beforeRestore = requireSnapshot(await coordinator.getSnapshot('100'))
    const linkedLedgerId = requireLinkedRecommendationLedgerId(beforeRestore, 'custom-author-up-alpha')
    const ruleEntry = beforeRestore.history.entries.find((entry) =>
      entry.source === 'favorite-rules' && entry.targetLedgerIds.includes(linkedLedgerId)
    )
    expect(ruleEntry).toBeDefined()
    expect(ruleEntry).toMatchObject({ source: 'favorite-rules', changeCount: 2 })
    const priorCursor = ruleEntry!.cursor - 1
    const originalLength = beforeRestore.history.length

    await coordinator.moveHistoryCursor('100', priorCursor)
    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      classifications: {
        '1': { aid: 1, targetLedgerIds: ['game'], source: 'system-high' },
        '2': { aid: 2, targetLedgerIds: ['game'], source: 'system-high' }
      },
      history: { cursor: priorCursor, length: originalLength }
    })

    const restarted = createCoordinator(
      new FavoriteRepositoryService({ root, now: () => '2026-08-25T00:00:00.000Z' }),
      new OldFavoriteWorkspaceStore({ root }),
      {
        initializeOnOpen: false,
        restoreFavoriteLedgerHistoryState,
        ...rules,
        loadFavoriteLedgerHistoryLedgers: rules.loadFavoriteLedgerHistoryLedgers
      }
    )
    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({
      classifications: {
        '1': { aid: 1, targetLedgerIds: ['game'], source: 'system-high' },
        '2': { aid: 2, targetLedgerIds: ['game'], source: 'system-high' }
      },
      history: { cursor: priorCursor, length: originalLength }
    })

    await restarted.moveHistoryCursor('100', ruleEntry!.cursor)
    expect(restoreFavoriteLedgerHistoryState).toHaveBeenLastCalledWith('100', expect.objectContaining({
      adoptedCandidateIds: ['custom-author-up-alpha'],
      linkedLedgerIdsByCandidateId: { 'custom-author-up-alpha': linkedLedgerId }
    }))
    await expect(restarted.getSnapshot('100')).resolves.toMatchObject({
      history: { cursor: ruleEntry!.cursor, length: originalLength }
    })
  })

  it('persists a zero-movement recommendation adoption through the ordinary-rule transaction', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-08-25T00:00:00.000Z' })
    const rules = createOrdinaryRuleDirectory()
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      classifyCurrentItem: () => ({ targetLedgerIds: ['music'], confidence: 'high' }),
      ...rules,
      loadFavoriteLedgerHistoryLedgers: rules.loadFavoriteLedgerHistoryLedgers
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
    await coordinator.acceptCurrentTags('100')

    await coordinator.setRecommendedCandidates('100', ['custom-author-up-alpha'])

    await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
      recommendations: { adoptedCandidateIds: ['custom-author-up-alpha'] },
      history: { entries: [] }
    })
    expect(rules.applyFavoriteRecommendationRuleChanges).toHaveBeenCalledWith('100', expect.objectContaining({
      upserts: [expect.objectContaining({ displayName: 'bilimi·UP Alpha', enabled: true })],
      enabled: []
    }))
    expect(rules.current()).toEqual([expect.objectContaining({ enabled: true })])
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

  it('restores a locally saved draft after restart without replaying the local membership commit', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const store = new OldFavoriteWorkspaceStore({ root })
    const first = createCoordinator(repository, store)
    await first.open('100')
    await first.completeScan('100', { revision: 1, aids: [1] })
    await first.applyClassificationBatch('100', {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })
    const commits = vi.spyOn(repository, 'commit')
    await expect(first.saveCurrentSegmentToLocalLibrary('100')).resolves.toMatchObject({ status: 'previewing' })
    commits.mockClear()

    await expect(new OldFavoriteWorkspaceStore({ root }).readRecoverySummary('100', (await repository.getSnapshot('100')).workspace!.id))
      .resolves.toMatchObject({ status: 'previewing' })
    await expect(createCoordinator(repository, new OldFavoriteWorkspaceStore({ root })).getSnapshot('100'))
      .resolves.toMatchObject({ status: 'previewing', segments: [{ readiness: 'saved' }] })
    expect(commits).not.toHaveBeenCalled()
    await expect(new OldFavoriteWorkspaceStore({ root }).readRecoverySummary('100', (await repository.getSnapshot('100')).workspace!.id))
      .resolves.toMatchObject({ status: 'previewing' })
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
      status: 'previewing', manifestChecksum: expected.manifestChecksum,
      recoveryChoices: ['recover-draft', 'rescan', 'abandon']
    })
    await expect(reader.readWorkspaceReads('100', workspaceId)).resolves.toEqual(['manifest.json', 'manifest.json'])
  })

  it('projects exactly the three ordinary recovery actions whether the baseline changed or not', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })

    await expect(coordinator.getRecoverySummary('100')).resolves.toMatchObject({
      status: 'previewing',
      recoveryChoices: ['recover-draft', 'rescan', 'abandon']
    })

    await repository.commit('100', {
      id: 'recovery-facts-changed', accountMid: '100', issuedAt: '2026-07-20T00:00:01.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'latest facts', author: 'up', tags: [], updatedAt: '2026-07-20T00:00:01.000Z' }
    })

    await expect(coordinator.getRecoverySummary('100')).resolves.toMatchObject({
      status: 'previewing',
      baselineChangeEvidence: { changed: true },
      recoveryChoices: ['recover-draft', 'rescan', 'abandon']
    })
  })

  it('offers the three recovery actions for an unfinished frozen remote plan', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }))
    const workspace = requireWorkspace(await coordinator.open('100'))
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    const marker = (await repository.getSnapshot('100')).workspace!
    await repository.commit('100', {
      id: 'frozen-recovery-summary', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'set-workspace',
      payload: {
        ...marker,
        status: 'frozen',
        workspaceRef: { ...marker.workspaceRef, status: 'frozen' },
        frozenSyncPlan: {
          id: 'frozen-recovery-plan', accountMid: '100', workspaceId: workspace.id, baselineRevision: 1,
          createdAt: '2026-07-20T00:00:00.000Z', operations: []
        }
      }
    })

    await expect(coordinator.getRecoverySummary('100')).resolves.toMatchObject({
      status: 'frozen',
      recoveryChoices: ['recover-draft', 'rescan', 'abandon']
    })
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
      recoveryChoices: ['recover-draft', 'rescan', 'abandon']
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

  it('advances only accepted local rule configuration after reclassification, while later remote facts still require recovery', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    let configuration = { metadata: 'metadata-v1', rules: 'rules-v1', keywords: 'keywords-v1', defaultSettings: 'defaults-v1' }
    const coordinator = createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      resolveRecoveryConfiguration: () => configuration,
      classifyCurrentItem: (item) => ({ targetLedgerIds: [`system-${item.aid}`], confidence: 'high' as const })
    })
    await coordinator.open('100')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })
    const summary = await coordinator.getRecoverySummary('100')
    if (!summary) throw new Error('missing summary')
    await coordinator.selectRecoveryDecision('100', {
      workspaceId: summary.workspaceId, choice: 'merge-latest',
      expectedBaselineRevision: summary.baselineChangeEvidence.workspaceBaselineRevision,
      expectedRepositoryRevision: summary.baselineChangeEvidence.repositoryRevision
    })

    configuration = { ...configuration, rules: 'rules-v2', keywords: 'keywords-v2' }
    await coordinator.reclassifyForFavoriteConfiguration('100')

    await expect(createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      resolveRecoveryConfiguration: () => configuration,
      classifyCurrentItem: (item) => ({ targetLedgerIds: [`system-${item.aid}`], confidence: 'high' as const })
    }).getSnapshot('100')).resolves.toMatchObject({
      status: 'previewing', classifications: { '1': { targetLedgerIds: ['system-1'], source: 'system-high' } }
    })

    await repository.commit('100', {
      id: 'external-fact-after-rule-save', accountMid: '100', issuedAt: '2026-07-20T00:00:01.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'remote metadata changed', author: 'up', tags: [], updatedAt: '2026-07-20T00:00:01.000Z' }
    })
    await expect(createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      resolveRecoveryConfiguration: () => configuration,
      classifyCurrentItem: (item) => ({ targetLedgerIds: [`system-${item.aid}`], confidence: 'high' as const })
    }).getSnapshot('100')).rejects.toThrow('recovery decision is stale')
  })

  it('advances accepted configuration after a saved preview rule while later mirror and binding facts still require recovery', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
    let configuration = { metadata: 'metadata-v1', rules: 'rules-v1', keywords: 'keywords-v1', defaultSettings: 'defaults-v1' }
    const workspaceStore = new OldFavoriteWorkspaceStore({ root })
    const coordinator = createCoordinator(repository, workspaceStore, {
      resolveRecoveryConfiguration: () => configuration,
      classifyCurrentItems: (items) => items.map(() => ({ targetLedgerIds: ['custom-music'], confidence: 'high' as const }))
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [{ aid: 1, title: 'Music match', sourceFolderIds: ['source'] }]
    })
    await coordinator.finishScan('100')
    const summary = await coordinator.getRecoverySummary('100')
    if (!summary) throw new Error('missing summary')
    await coordinator.selectRecoveryDecision('100', {
      workspaceId: summary.workspaceId, choice: 'merge-latest',
      expectedBaselineRevision: summary.baselineChangeEvidence.workspaceBaselineRevision,
      expectedRepositoryRevision: summary.baselineChangeEvidence.repositoryRevision
    })

    configuration = { ...configuration, rules: 'rules-v2', keywords: 'keywords-v2' }
    await coordinator.saveDraftLedgerRule('100', {
      analysisId: 'analysis-accepted-config', ledgerId: 'custom-music', title: '音乐', keywords: ['Music'], ruleType: 'keyword'
    })

    await expect(createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      resolveRecoveryConfiguration: () => configuration,
      classifyCurrentItems: (items) => items.map(() => ({ targetLedgerIds: ['custom-music'], confidence: 'high' as const }))
    }).getSnapshot('100')).resolves.toMatchObject({ status: 'previewing' })

    await repository.commit('100', {
      id: 'external-mirror-after-rule-save', accountMid: '100', issuedAt: '2026-07-20T00:00:01.000Z', type: 'set-favorite-placement',
      payload: {
        aid: 1,
        localDesiredFolderIds: [],
        remoteObservedPhysicalFolderIds: ['remote-mirror-changed'],
        remoteObservedLogicalFolderIds: [],
        updatedAt: '2026-07-20T00:00:01.000Z'
      }
    })
    await expect(createCoordinator(repository, new OldFavoriteWorkspaceStore({ root }), {
      resolveRecoveryConfiguration: () => configuration
    }).getSnapshot('100')).rejects.toThrow('recovery decision is stale')

    const freshRoot = await createRoot()
    const bindingRepository = new FavoriteRepositoryService({ root: freshRoot, now: () => '2026-07-20T00:00:00.000Z' })
    const bindingCoordinator = createCoordinator(bindingRepository, new OldFavoriteWorkspaceStore({ root: freshRoot }), {
      resolveRecoveryConfiguration: () => configuration,
      classifyCurrentItems: (items) => items.map(() => ({ targetLedgerIds: ['custom-music'], confidence: 'high' as const }))
    })
    await bindingCoordinator.beginScan('100', 'incremental')
    await bindingCoordinator.recordScanPage('100', {
      folderId: 'source', page: 1,
      items: [{ aid: 1, title: 'Music match', sourceFolderIds: ['source'] }]
    })
    await bindingCoordinator.finishScan('100')
    const bindingSummary = await bindingCoordinator.getRecoverySummary('100')
    if (!bindingSummary) throw new Error('missing binding summary')
    await bindingCoordinator.selectRecoveryDecision('100', {
      workspaceId: bindingSummary.workspaceId, choice: 'merge-latest',
      expectedBaselineRevision: bindingSummary.baselineChangeEvidence.workspaceBaselineRevision,
      expectedRepositoryRevision: bindingSummary.baselineChangeEvidence.repositoryRevision
    })
    configuration = { ...configuration, rules: 'rules-v3', keywords: 'keywords-v3' }
    await bindingCoordinator.saveDraftLedgerRule('100', {
      analysisId: 'analysis-accepted-config-binding', ledgerId: 'custom-music', title: '音乐', keywords: ['Music'], ruleType: 'keyword'
    })
    await bindingRepository.commit('100', {
      id: 'external-binding-after-rule-save', accountMid: '100', issuedAt: '2026-07-20T00:00:02.000Z', type: 'upsert-physical-shard-binding',
      payload: {
        logicalLedgerId: 'custom-music',
        logicalTitle: 'bilimi·音乐',
        shardNumber: 1,
        memberAids: [],
        remoteTitle: 'bilimi·音乐',
        bindingState: 'bound',
        remoteFolderId: 'remote-binding-changed'
      }
    })
    await expect(createCoordinator(bindingRepository, new OldFavoriteWorkspaceStore({ root: freshRoot }), {
      resolveRecoveryConfiguration: () => configuration
    }).getSnapshot('100')).rejects.toThrow('recovery decision is stale')
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

  it('persists DeepSeek stale evidence while a later configuration merge replaces its classification', async () => {
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
      classifications: { '1': { targetLedgerIds: ['system'], source: 'system-high' } }, staleDeepSeekAids: [1]
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
    const recoverySummary = await restarted.getRecoverySummary('100')
    expect(recoverySummary).toMatchObject({
      status: 'reconciling', currentStep: 'result-unknown',
      recoveryChoices: ['recover-draft', 'rescan', 'abandon'],
      resultUnknownEvidence: { operationCount: 1, planId: 'run-unknown' }
    })
    if (!recoverySummary) throw new Error('recovery summary unexpectedly unavailable')
    await expect(restarted.selectRecoveryDecision('100', {
      workspaceId: workspace.id,
      choice: 'continue-original',
      expectedBaselineRevision: recoverySummary.baselineChangeEvidence.workspaceBaselineRevision,
      expectedRepositoryRevision: recoverySummary.baselineChangeEvidence.repositoryRevision
    })).resolves.toMatchObject({
      choice: 'continue-original', requiresFullWorkspaceLoad: true, requiresExplicitScan: false
    })
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
    const workspaceDirectory = join(root, 'accounts', '100', 'workspaces', workspace.id)
    const manifest = JSON.parse(await readFile(join(workspaceDirectory, 'manifest.json'), 'utf8')) as {
      segments: Array<{ id: string; file: string }>
    }
    const currentSegmentFile = manifest.segments.find((segment) => segment.id === 'segment-1')!.file
    await writeFile(join(workspaceDirectory, currentSegmentFile), '{corrupt', 'utf8')

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
