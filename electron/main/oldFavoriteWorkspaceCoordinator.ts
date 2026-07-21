import { randomUUID } from 'node:crypto'
import {
  applyWorkspaceClassificationBatch,
  completeWorkspaceScan,
  createOldFavoriteWorkspace,
  freezeWorkspaceSegment,
  recordDiscoveredFavorites,
  redoWorkspaceChange,
  undoWorkspaceChange,
  type ApplyWorkspaceClassificationBatchOptions,
  type CompleteWorkspaceScanOptions,
  type OldFavoriteWorkspace,
  type OldFavoriteWorkspaceHistoryEntry,
  type OldFavoriteWorkspaceRecoveryRequired,
  type OldFavoriteWorkspaceSnapshot
} from '../../src/shared/oldFavoriteWorkspace'
import type { FavoriteRepositoryWorkspace } from '../../src/shared/favoriteRepository'
import { BILIMI_LEDGER_PREFIX, createDefaultFavoriteLedgers } from '../../src/shared/favoriteLedgers'
import type { FavoriteLedger } from '../../src/shared/types'
import { compileFrozenFavoriteSyncPlan } from '../../src/shared/favoriteRepositoryExecutionPlan'
import { FavoriteRepositoryService } from './favoriteRepositoryService'
import type { FavoriteRepositorySyncRun, FavoriteRepositorySyncService } from './favoriteRepositorySyncService'
import type { FavoriteRepositoryBindingService } from './favoriteRepositoryBindingService'
import { OldFavoriteWorkspaceStore } from './oldFavoriteWorkspaceStore'

const JOURNAL_EVENT_PREFIX = 'bilimi-old-favorite-workspace:v1:'

type SegmentDescriptor = { id: string; index: number; itemCount: number }
type ScanJournalEvent = {
  type: 'scan'
  createdAt: string
  mode: OldFavoriteWorkspace['mode']
  segmentSize: number
  segments: SegmentDescriptor[]
  baselineCompletedAids: number[]
}
type ClassificationJournalEvent = {
  type: 'classification'
  entry: OldFavoriteWorkspaceHistoryEntry
  historyCursor: number
}
type CursorJournalEvent = { type: 'history-cursor'; historyCursor: number }
type FreezeJournalEvent = { type: 'freeze'; segmentId: string }
type DiscoveryJournalEvent = { type: 'discover'; aids: number[] }
type WorkspaceJournalEvent = ScanJournalEvent | ClassificationJournalEvent | CursorJournalEvent |
  FreezeJournalEvent | DiscoveryJournalEvent
type ScanOverview = {
  sourceFolders: Array<{ id: string; title: string; itemCount: number; isBilimiWorkFolder: boolean; selected?: boolean }>
  scan: { phase: 'inventory' | 'failed' | 'complete'; failureCount: number; mode: OldFavoriteWorkspace['mode']; reason?: string; totalItemCount?: number; scannedItemCount?: number; taggedItemCount?: number; untaggedItemCount?: number }
}
type CurrentSegmentItem = {
  aid: number
  title?: string
  author?: string
  tags?: string[]
  category?: string
  cover?: string
  addedAt?: number
  sourceFolderIds: string[]
}
type AutomaticClassification = { targetLedgerIds: string[]; confidence: 'high' | 'low' }
type RecommendedLedger = Pick<FavoriteLedger, 'id' | 'displayName' | 'keywords' | 'ruleType' | 'enabled' | 'priority' | 'isDefault'>
type StoredRecommendation = {
  id: string
  displayName: string
  kind: 'author' | 'series' | 'tag'
  sourceName: string
  keywords: string[]
  count: number
  reason: string
}
type RecommendationState = { initialized: boolean; candidates: StoredRecommendation[]; adoptedCandidateIds: string[] }
type PlanReadiness = { selectedAidCount: number; classifiedAidCount: number }

export type { OldFavoriteWorkspaceRecoveryRequired, OldFavoriteWorkspaceSnapshot }

function clone<T>(value: T): T {
  return structuredClone(value)
}

function encodeJournalEvent(event: WorkspaceJournalEvent) {
  return {
    kind: `${JOURNAL_EVENT_PREFIX}${JSON.stringify(event)}`,
    aids: event.type === 'discover' ? [...event.aids] : []
  }
}

function decodeJournalEvent(value: { kind: string }): WorkspaceJournalEvent | undefined {
  if (!value.kind.startsWith(JOURNAL_EVENT_PREFIX)) return undefined
  try {
    return JSON.parse(value.kind.slice(JOURNAL_EVENT_PREFIX.length)) as WorkspaceJournalEvent
  } catch {
    return undefined
  }
}

function isRecoveryRequired(value: OldFavoriteWorkspace | OldFavoriteWorkspaceRecoveryRequired):
value is OldFavoriteWorkspaceRecoveryRequired {
  return 'recovery' in value
}

function normalizeAids(aids: number[]) {
  return [...new Set(aids.filter((aid) => Number.isSafeInteger(aid) && aid > 0))]
    .sort((left, right) => left - right)
}

function stableRecommendationId(author: string) {
  const slug = author.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (slug) return `custom-author-${slug}`
  let hash = 2166136261
  for (const character of author) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return `custom-author-${(hash >>> 0).toString(36)}`
}
type TagEnrichment = {
  status: 'running' | 'paused' | 'accepted' | 'complete'
  totalItemCount: number
  pendingAids: number[]
}

function stableTagRecommendationId(tag: string) {
  const slug = tag.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (slug) return `custom-tag-${slug}`
  let hash = 2166136261
  for (const character of tag) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return `custom-tag-${(hash >>> 0).toString(36)}`
}

function localLedgerId(title: string) {
  const slug = title.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (slug) return `local-${slug}`
  let hash = 2166136261
  for (const character of title) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return `local-${(hash >>> 0).toString(36)}`
}

function buildAuthorRecommendations(items: Iterable<Pick<CurrentSegmentItem, 'author' | 'tags'>>): RecommendationState {
  const authorCounts = new Map<string, number>()
  const tagCounts = new Map<string, number>()
  for (const item of items) {
    const author = item.author?.trim()
    if (author) authorCounts.set(author, (authorCounts.get(author) ?? 0) + 1)
    const tags = new Set((item.tags ?? []).map((tag) => tag.trim().replace(/\s+/g, ' ')).filter(Boolean))
    for (const tag of tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
  }
  const authors: StoredRecommendation[] = [...authorCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort(([leftName, leftCount], [rightName, rightCount]) => rightCount - leftCount || leftName.localeCompare(rightName, 'zh-Hans-CN'))
    .slice(0, 24)
    .map(([sourceName, count]) => ({
      id: stableRecommendationId(sourceName),
      displayName: `${BILIMI_LEDGER_PREFIX}${sourceName}`,
      kind: 'author' as const,
      sourceName,
      keywords: [sourceName],
      count,
      reason: `${sourceName} appeared ${count} times.`
    }))
  const genericTags = new Set(['视频', 'bilibili', '哔哩哔哩', '收藏', '推荐'])
  const tags: StoredRecommendation[] = [...tagCounts.entries()]
    .filter(([tag, count]) => count >= 2 && tag.length >= 2 && !genericTags.has(tag.toLocaleLowerCase()))
    .sort(([leftName, leftCount], [rightName, rightCount]) => rightCount - leftCount || leftName.localeCompare(rightName, 'zh-Hans-CN'))
    .slice(0, 24)
    .map(([sourceName, count]) => ({
      id: stableTagRecommendationId(sourceName),
      displayName: `${BILIMI_LEDGER_PREFIX}${sourceName}`,
      kind: 'tag' as const,
      sourceName,
      keywords: [sourceName],
      count,
      reason: `高频标签“${sourceName}”出现 ${count} 次，适合单独成册。`
    }))
  return {
    candidates: [...authors, ...tags],
    initialized: true,
    adoptedCandidateIds: []
  }
}

function asLocalRecommendedLedger(candidate: StoredRecommendation, priority: number): FavoriteLedger {
  return {
    id: candidate.id,
    displayName: candidate.displayName,
    keywords: [...candidate.keywords],
    ruleType: candidate.kind === 'author' ? 'author' : candidate.kind === 'tag' ? 'tag' : 'keyword',
    enabled: true,
    priority,
    isDefault: false
  }
}

function isStagingBilimiFolder(title: string) {
  return /\u5f85\u5206\u7c7b|\u6682\u5b58/u.test(title)
}

/**
 * Owns the main-process old-favorite mirror while keeping its large baseline
 * and high-frequency edits in OldFavoriteWorkspaceStore. The repository only
 * receives a lightweight account-owned marker when lifecycle state changes.
 */
export class OldFavoriteWorkspaceCoordinator {
  private readonly workspaces = new Map<string, OldFavoriteWorkspace>()
  private readonly currentSegments = new Map<string, string>()
  private readonly segmentDescriptors = new Map<string, SegmentDescriptor[]>()
  private readonly currentSegmentItems = new Map<string, CurrentSegmentItem[]>()
  private readonly frozenSegments = new Map<string, Set<string>>()
  private readonly scanOverviews = new Map<string, ScanOverview>()
  private readonly scanRuns = new Map<string, string>()
  private readonly scannedAids = new Map<string, Set<number>>()
  private readonly scannedTagStates = new Map<string, Map<number, boolean>>()
  private readonly tagEnrichments = new Map<string, TagEnrichment>()
  private readonly recommendations = new Map<string, RecommendationState>()
  private readonly planReadiness = new Map<string, PlanReadiness>()
  private operationTail = Promise.resolve()

  constructor(private readonly options: {
    repository: FavoriteRepositoryService
    workspaceStore: OldFavoriteWorkspaceStore
    bindingService?: {
      ensurePhysicalShard(accountMid: string, input: {
        logicalLedgerId: string
        logicalTitle: string
        remoteDisplayTitle?: string
        shardNumber: number
        memberAids: number[]
      }): Promise<unknown>
    }
    syncService?: Pick<FavoriteRepositorySyncService, 'abandonFrozenPlan' | 'claimFrozenPlan' | 'executeFrozenPlan' | 'bindPageTarget' | 'reconcile' | 'resume' | 'getRun'>
    classifyCurrentItem?: (item: CurrentSegmentItem, recommendedLedgers: RecommendedLedger[]) => AutomaticClassification | Promise<AutomaticClassification>
    saveRecommendedLedgers?: (accountMid: string, ledgers: FavoriteLedger[]) => Promise<void>
    removeRecommendedLedgers?: (accountMid: string, ledgerIds: string[]) => Promise<void>
    resolveLedgerTitle?: (accountMid: string, logicalLedgerId: string) => Promise<string | undefined>
    now?: () => string
  }) {}

  async open(accountMid: string): Promise<OldFavoriteWorkspace | OldFavoriteWorkspaceRecoveryRequired> {
    return this.queue(() => this.openUnsafe(accountMid))
  }

  async getSnapshot(accountMid: string): Promise<OldFavoriteWorkspaceSnapshot | OldFavoriteWorkspaceRecoveryRequired> {
    return this.queue(async () => {
      const workspace = await this.openUnsafe(accountMid)
      return isRecoveryRequired(workspace) ? workspace : await this.createSnapshotWithExecutionProgress(workspace)
    })
  }

  /** Replaces only a verified-corrupt mirror; completed repository results remain authoritative. */
  async rebuildAfterRecovery(accountMid: string): Promise<OldFavoriteWorkspaceSnapshot> {
    return this.queue(async () => {
      const snapshot = await this.options.repository.getSnapshot(accountMid)
      if (!snapshot.workspace) throw new Error('Old favorite workspace does not require rebuild.')
      const opened = await this.openUnsafe(snapshot.accountMid)
      if (!isRecoveryRequired(opened)) throw new Error('Old favorite workspace does not require rebuild.')
      if (snapshot.workspace.frozenSyncPlan && snapshot.workspace.status !== 'completed') {
        throw new Error('Old favorite workspace has an unfinished frozen sync plan.')
      }
      const rebuilt = await this.createScanningWorkspace(snapshot.accountMid, 'incremental')
      return this.createSnapshot(rebuilt)
    })
  }

  async beginScan(accountMid: string, mode: OldFavoriteWorkspace['mode'], options?: { clearBilibiliMirror?: boolean }): Promise<OldFavoriteWorkspaceSnapshot> {
    return this.queue(async () => {
      if (mode !== 'incremental' && mode !== 'full') throw new Error('Old favorite workspace mode is invalid.')
      let workspace = await this.requireWorkspace(accountMid)
      const persistedWorkspace = (await this.options.repository.getSnapshot(workspace.accountMid)).workspace
      const abandonFrozenPlan = mode === 'full' && Boolean(persistedWorkspace?.frozenSyncPlan) &&
        persistedWorkspace?.status !== 'completed'
      if (abandonFrozenPlan) {
        if (!this.options.syncService) throw new Error('Old favorite workspace sync service is unavailable.')
        await this.options.syncService.abandonFrozenPlan(workspace.accountMid)
      }
      if (mode === 'full') {
        workspace = await this.createScanningWorkspace(workspace.accountMid, mode)
      } else if (workspace.status !== 'scanning' && workspace.status !== 'completed') {
        throw new Error('Old favorite workspace scan is already active.')
      }
      if (mode === 'incremental' && workspace.status === 'completed') {
        workspace = await this.createScanningWorkspace(workspace.accountMid, mode)
      }
      if (mode === 'full') {
        await this.options.repository.commit(workspace.accountMid, {
          id: `old-favorite-workspace:clear-protection:${workspace.id}`,
          accountMid: workspace.accountMid,
          issuedAt: this.now(),
          type: 'record-organization-protections',
          payload: { records: [], replace: true }
        })
        if (options?.clearBilibiliMirror) {
          await this.options.repository.commit(workspace.accountMid, {
            id: `old-favorite-workspace:clear-bilibili-mirror:${workspace.id}`,
            accountMid: workspace.accountMid,
            issuedAt: this.now(),
            type: 'clear-bilibili-mirror',
            payload: {}
          })
        }
      }
      if (workspace.status !== 'scanning') throw new Error('Old favorite workspace scan is already active.')
      const updated = { ...workspace, mode }
      const scanRunId = randomUUID()
      const sourceFolders = this.scanOverviews.get(workspace.accountMid)?.sourceFolders.map(clone) ?? []
      this.scanOverviews.set(workspace.accountMid, { sourceFolders, scan: { phase: 'inventory', failureCount: 0, mode } })
      await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
        currentSegmentId: '', classifications: [], history: [],
        scanMetadata: { sourceFolders, phase: 'inventory', failureCount: 0, mode }
      })
      await this.options.workspaceStore.startScanRun(workspace.accountMid, workspace.id, scanRunId)
      this.scanRuns.set(workspace.accountMid, scanRunId)
      this.scannedAids.set(workspace.accountMid, new Set())
      this.scannedTagStates.set(workspace.accountMid, new Map())
      this.tagEnrichments.delete(workspace.accountMid)
      this.workspaces.set(updated.accountMid, updated)
      return this.createSnapshot(updated)
    })
  }

  /** Internal scan lease; renderer snapshots never expose this token. */
  async getActiveScanRunId(accountMid: string): Promise<string> {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      const runId = this.scanRuns.get(workspace.accountMid)
      if (!runId) throw new Error('Old favorite workspace scan run is not active.')
      return runId
    })
  }

  async recordScanInventory(accountMid: string, input: { sourceFolders: ScanOverview['sourceFolders'] }, expectedRunId?: string) {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      if (expectedRunId && this.scanRuns.get(workspace.accountMid) !== expectedRunId) return false
      if (workspace.status !== 'scanning') throw new Error('Old favorite workspace scan is not active.')
      const sourceFolders = input.sourceFolders.map((folder) => ({ ...folder, selected: !folder.isBilimiWorkFolder }))
      const mode = this.scanOverviews.get(workspace.accountMid)?.scan.mode ?? workspace.mode
      const overview: ScanOverview = {
        sourceFolders,
        scan: {
          phase: 'inventory', failureCount: 0, mode,
          totalItemCount: sourceFolders.filter((folder) => !folder.isBilimiWorkFolder).reduce((count, folder) => count + folder.itemCount, 0),
          scannedItemCount: 0, taggedItemCount: 0, untaggedItemCount: 0
        }
      }
      await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
        currentSegmentId: '', classifications: [], history: [],
        scanMetadata: { sourceFolders, ...overview.scan }
      })
      this.scanOverviews.set(workspace.accountMid, overview)
      return true
    })
  }

  /** Commits one short remote page without using the repository generation path. */
  async recordScanPage(accountMid: string, input: {
    folderId: string
    page: number
    items: Array<{ aid: number; title?: string; author?: string; tags?: string[]; category?: string; cover?: string; addedAt?: number; sourceFolderIds: string[] }>
  }, expectedRunId?: string) {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      if (expectedRunId && this.scanRuns.get(workspace.accountMid) !== expectedRunId) return false
      if (workspace.status !== 'scanning') throw new Error('Old favorite workspace scan is not active.')
      const runId = this.scanRuns.get(workspace.accountMid)
      if (!runId) throw new Error('Old favorite workspace scan run is not active.')
      await this.options.workspaceStore.appendScanPage(workspace.accountMid, workspace.id, { ...input, runId })
      const overview = this.scanOverviews.get(workspace.accountMid)
      if (overview) {
        let scannedAids = this.scannedAids.get(workspace.accountMid)
        let scannedTagStates = this.scannedTagStates.get(workspace.accountMid)
        if (!scannedAids) {
          const pages = await this.options.workspaceStore.readScanPages(workspace.accountMid, workspace.id)
          scannedAids = new Set(pages.flatMap((page) => page.items.map((item) => item.aid)))
          scannedTagStates = new Map<number, boolean>()
          for (const item of pages.flatMap((page) => page.items)) {
            scannedTagStates.set(item.aid, Boolean(scannedTagStates.get(item.aid) || item.tags?.length))
          }
          this.scannedAids.set(workspace.accountMid, scannedAids)
          this.scannedTagStates.set(workspace.accountMid, scannedTagStates)
        } else {
          scannedTagStates ??= new Map<number, boolean>()
          for (const item of input.items) {
            scannedAids.add(item.aid)
            scannedTagStates.set(item.aid, Boolean(scannedTagStates.get(item.aid) || item.tags?.length))
          }
          this.scannedTagStates.set(workspace.accountMid, scannedTagStates)
        }
        const scannedItemCount = scannedAids.size
        const taggedItemCount = [...(scannedTagStates?.values() ?? [])].filter(Boolean).length
        const scan = { ...overview.scan, scannedItemCount, taggedItemCount, untaggedItemCount: scannedItemCount - taggedItemCount }
        await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
          currentSegmentId: '', classifications: [], history: [], scanMetadata: { ...scan }
        })
        this.scanOverviews.set(workspace.accountMid, { ...overview, scan })
      }
      return true
    })
  }

  async recordManagedMembers(accountMid: string, members: Record<string, number[]>, expectedRunId?: string) {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      if (expectedRunId && this.scanRuns.get(workspace.accountMid) !== expectedRunId) return false
      if (workspace.status !== 'scanning') throw new Error('Old favorite workspace scan is not active.')
      const runId = this.scanRuns.get(workspace.accountMid)
      if (!runId) throw new Error('Old favorite workspace scan run is not active.')
      await this.options.workspaceStore.appendManagedMembers(workspace.accountMid, workspace.id, { runId, members })
      return true
    })
  }

  async selectSourceFolders(accountMid: string, folderIds: string[]) {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      if (workspace.status !== 'previewing') throw new Error('Old favorite workspace sources are not ready.')
      const sourceFolders = this.scanOverviews.get(workspace.accountMid)?.sourceFolders ?? []
      const validIds = new Set(sourceFolders.filter((folder) => !folder.isBilimiWorkFolder).map((folder) => folder.id))
      if (!folderIds.every((folderId) => validIds.has(folderId))) throw new Error('Old favorite workspace source selection is invalid.')
      const selectedIds = new Set(folderIds)
      const updatedFolders = sourceFolders.map((folder) => ({
        ...folder,
        selected: folder.isBilimiWorkFolder ? false : selectedIds.has(folder.id)
      }))
      this.scanOverviews.set(workspace.accountMid, {
        sourceFolders: updatedFolders,
        scan: this.scanOverviews.get(workspace.accountMid)?.scan ?? { phase: 'complete', failureCount: 0, mode: workspace.mode }
      })
      const readiness = await this.calculatePlanReadiness(workspace)
      await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
        currentSegmentId: this.currentSegment(workspace), classifications: [], history: [],
        scanMetadata: { sourceFolders: updatedFolders }, planReadiness: readiness
      })
      this.planReadiness.set(workspace.accountMid, readiness)
    })
  }

  /** Stores only compact candidate metadata; the renderer never supplies rules or classifications. */
  async setRecommendedCandidates(accountMid: string, candidateIds: string[]) {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      if (workspace.status !== 'previewing') throw new Error('Old favorite workspace recommendations are not ready.')
      const state = await this.ensureRecommendations(workspace)
      const knownIds = new Set(state.candidates.map((candidate) => candidate.id))
      const adoptedCandidateIds = [...new Set(candidateIds.map((id) => id.trim()).filter(Boolean))].sort()
      if (!adoptedCandidateIds.every((id) => knownIds.has(id))) {
        throw new Error('Old favorite workspace recommendation selection is invalid.')
      }
      const newlyAdopted = state.candidates.filter((candidate) =>
        adoptedCandidateIds.includes(candidate.id) && !state.adoptedCandidateIds.includes(candidate.id))
      const removedAdoptions = state.candidates.filter((candidate) =>
        state.adoptedCandidateIds.includes(candidate.id) && !adoptedCandidateIds.includes(candidate.id))
      if (newlyAdopted.length) {
        await this.options.saveRecommendedLedgers?.(workspace.accountMid, newlyAdopted.map((candidate, index) =>
          asLocalRecommendedLedger(candidate, 10_000 + index)))
      }
      if (removedAdoptions.length) {
        await this.options.removeRecommendedLedgers?.(workspace.accountMid, removedAdoptions.map((candidate) => candidate.id))
      }
      const next = { initialized: true, candidates: state.candidates.map(clone), adoptedCandidateIds }
      await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
        currentSegmentId: this.currentSegment(workspace), classifications: [], history: [], recommendations: next
      })
      this.recommendations.set(workspace.accountMid, next)
      if (!this.options.classifyCurrentItem) return clone(workspace)
      return this.autoClassifyCurrentSegmentUnsafe(workspace, true)
    })
  }

  /** Creates a repository-only logical target, then reapplies system suggestions for the current segment. */
  async createLocalLedgerAndReclassify(accountMid: string, title: string) {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      const normalizedTitle = title.trim()
      if (workspace.status !== 'previewing' || !normalizedTitle || normalizedTitle.length > 128) {
        throw new Error('Old favorite workspace local ledger is invalid.')
      }
      const id = localLedgerId(normalizedTitle)
      const folderId = `local:${id}`
      const repository = await this.options.repository.getSnapshot(workspace.accountMid)
      const existingFolder = repository.folders.find((folder) => folder.id === folderId)
      if (existingFolder && (existingFolder.kind !== 'local' || existingFolder.title !== normalizedTitle)) {
        throw new Error('Old favorite workspace local ledger already exists.')
      }
      if (!existingFolder) {
        await this.options.repository.commit(workspace.accountMid, {
          id: `old-favorite-workspace:create-local-ledger:${workspace.id}:${id}`,
          accountMid: workspace.accountMid,
          issuedAt: this.now(),
          type: 'commit-local-plan',
          payload: {
            workspaceId: workspace.id,
            memberAidsByFolderId: {},
            folders: [{ id: folderId, title: normalizedTitle, kind: 'local', syncState: 'local-only' }]
          }
        })
      }
      const state = await this.ensureRecommendations(workspace)
      const candidate: StoredRecommendation = {
        id,
        displayName: `${BILIMI_LEDGER_PREFIX}${normalizedTitle}`,
        kind: 'series',
        sourceName: normalizedTitle,
        keywords: [normalizedTitle],
        count: 0,
        reason: 'Created locally for this organization round.'
      }
      const candidates = state.candidates.some((item) => item.id === id)
        ? state.candidates.map((item) => item.id === id ? candidate : item)
        : [...state.candidates, candidate]
      const next: RecommendationState = {
        initialized: true,
        candidates,
        adoptedCandidateIds: [...new Set([...state.adoptedCandidateIds, id])].sort()
      }
      await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
        currentSegmentId: this.currentSegment(workspace), classifications: [], history: [], recommendations: next
      })
      this.recommendations.set(workspace.accountMid, next)
      return this.options.classifyCurrentItem
        ? this.autoClassifyCurrentSegmentUnsafe(workspace, true)
        : clone(workspace)
    })
  }

  /** Converts scan staging to the immutable 2,000-item baseline only after every page succeeds. */
  async finishScan(accountMid: string, expectedRunId?: string) {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      if (expectedRunId && this.scanRuns.get(workspace.accountMid) !== expectedRunId) return clone(workspace)
      if (workspace.status !== 'scanning') throw new Error('Old favorite workspace scan is not active.')
      const itemsByAid = new Map<number, CurrentSegmentItem>()
      await this.options.workspaceStore.visitScanPages(workspace.accountMid, workspace.id, (page) => {
        for (const item of page.items) {
          const existing = itemsByAid.get(item.aid)
          if (existing) {
            existing.sourceFolderIds = [...new Set([...existing.sourceFolderIds, ...item.sourceFolderIds])].sort()
            if (!existing.tags?.length && item.tags?.length) existing.tags = [...item.tags]
            if (!existing.category && item.category) existing.category = item.category
          } else {
            itemsByAid.set(item.aid, { ...item, sourceFolderIds: [...new Set(item.sourceFolderIds)].sort() })
          }
        }
      })
      const managedMembers = await this.options.workspaceStore.readManagedMembers(workspace.accountMid, workspace.id)
      const repository = await this.options.repository.getSnapshot(workspace.accountMid)
      const sourceFolders = this.scanOverviews.get(workspace.accountMid)?.sourceFolders ?? []
      const mirrorFolders = sourceFolders.filter((folder) => !folder.isBilimiWorkFolder).map((folder) => ({
        id: `bilibili:${folder.id}`,
        title: folder.title,
        remoteFolderId: folder.id
      }))
      const mirrorMembers = new Map(mirrorFolders.map((folder) => [folder.remoteFolderId, [] as number[]]))
      for (const item of itemsByAid.values()) {
        for (const folderId of item.sourceFolderIds) mirrorMembers.get(folderId)?.push(item.aid)
      }
      const mirrorUpdatedAt = this.now()
      await this.options.repository.commit(workspace.accountMid, {
        id: `old-favorite-workspace:mirror:${workspace.id}:${(workspace.baseline?.revision ?? 0) + 1}`,
        accountMid: workspace.accountMid,
        issuedAt: this.now(),
        type: 'record-bilibili-mirror',
        payload: {
          workspaceId: workspace.id,
          memberAidsByFolderId: Object.fromEntries(mirrorFolders.map((folder) => [folder.id,
            (mirrorMembers.get(folder.remoteFolderId) ?? []).sort((left, right) => left - right)
          ])),
          folders: mirrorFolders,
          videos: [...itemsByAid.values()].map((item) => ({
            aid: item.aid,
            title: item.title ?? `Video ${item.aid}`,
            ...(item.author ? { author: item.author } : {}),
            tags: [...(item.tags ?? [])],
            updatedAt: mirrorUpdatedAt
          }))
        }
      })
      const successfulAids = repository.organizationRecords
        .filter((record) => record.accountMid === workspace.accountMid && itemsByAid.has(record.aid))
        .map((record) => record.aid)
      const initializedRecords = !repository.organizationMigrationInitialized
        ? sourceFolders.filter((folder) => folder.isBilimiWorkFolder && !isStagingBilimiFolder(folder.title)).flatMap((folder) =>
          (managedMembers[folder.id] ?? []).map((aid) => ({
            accountMid: workspace.accountMid, aid, targetFolderIds: [folder.id], completedAt: this.now()
          }))
        )
        : []
      if (initializedRecords.length || !repository.organizationMigrationInitialized) {
        await this.options.repository.commit(workspace.accountMid, {
          id: `old-favorite-workspace:migrate-protection:${workspace.id}`,
          accountMid: workspace.accountMid,
          issuedAt: this.now(),
          type: 'record-organization-protections',
          payload: { records: initializedRecords, markMigrationInitialized: true }
        })
      }
      const completed = completeWorkspaceScan(workspace, {
        revision: (workspace.baseline?.revision ?? 0) + 1,
        aids: [...itemsByAid.keys()],
        successfullyClassifiedAids: [...successfulAids, ...initializedRecords.map((record) => record.aid)],
        mode: workspace.mode
      })
      const currentSegmentId = completed.segments[0]?.id ?? ''
      await this.options.workspaceStore.create({
        accountMid: completed.accountMid,
        workspaceId: completed.id,
        status: completed.status,
        baselineRevision: completed.baseline?.revision ?? 0,
        currentSegmentId,
        sourceFolders: this.scanOverviews.get(completed.accountMid)?.sourceFolders ?? [],
        segments: completed.segments.map((segment) => ({
          id: segment.id,
          aids: [...segment.aids],
          items: segment.aids.map((aid) => itemsByAid.get(aid) ?? { aid, sourceFolderIds: [] })
        }))
      })
      const recommendations = buildAuthorRecommendations(itemsByAid.values())
      const readiness = this.calculatePlanReadinessFromItems(completed, itemsByAid.values(), sourceFolders)
      const totalItemCount = sourceFolders.filter((folder) => !folder.isBilimiWorkFolder)
        .reduce((count, folder) => count + folder.itemCount, 0)
      const taggedItemCount = [...itemsByAid.values()].filter((item) => Boolean(item.tags?.length)).length
      const completedScan = {
        phase: 'complete' as const,
        failureCount: 0,
        mode: completed.mode,
        totalItemCount,
        scannedItemCount: itemsByAid.size,
        taggedItemCount,
        untaggedItemCount: itemsByAid.size - taggedItemCount
      }
      const pendingTagAids = [...itemsByAid.values()]
        .filter((item) => !item.tags?.length)
        .map((item) => item.aid)
        .sort((left, right) => left - right)
      const tagEnrichment: TagEnrichment = {
        status: pendingTagAids.length ? 'running' : 'complete',
        totalItemCount: pendingTagAids.length,
        pendingAids: pendingTagAids
      }
      await this.options.workspaceStore.appendOverlay(completed.accountMid, completed.id, {
        currentSegmentId, classifications: [], history: [], recommendations, planReadiness: readiness,
        scanMetadata: { sourceFolders, ...completedScan }, tagEnrichment
      })
      const descriptors = completed.segments.map(({ id, index, aids }) => ({ id, index, itemCount: aids.length }))
      await this.appendEvents(completed, currentSegmentId, [{
        type: 'scan', createdAt: completed.createdAt, mode: completed.mode, segmentSize: completed.segmentSize,
        segments: descriptors, baselineCompletedAids: [...completed.baselineCompletedAids]
      }])
      await this.persistMarker(completed)
      this.scanOverviews.set(completed.accountMid, {
        sourceFolders: this.scanOverviews.get(completed.accountMid)?.sourceFolders ?? [],
        scan: completedScan
      })
      this.scanRuns.delete(completed.accountMid)
      this.scannedAids.delete(completed.accountMid)
      this.scannedTagStates.delete(completed.accountMid)
      this.tagEnrichments.set(completed.accountMid, tagEnrichment)
      this.recommendations.set(completed.accountMid, clone(recommendations))
      this.planReadiness.set(completed.accountMid, readiness)
      this.remember(completed, currentSegmentId, descriptors, new Set())
      this.currentSegmentItems.set(completed.accountMid, completed.segments[0]?.aids.map((aid) => clone(itemsByAid.get(aid) ?? {
        aid, sourceFolderIds: []
      })) ?? [])
      // Current bridge pages always carry this classification metadata; older
      // recovered staging files do not, so preserve their explicit re-run flow.
      const hasClassificationSignals = [...itemsByAid.values()].some((item) => item.tags !== undefined || item.category !== undefined)
      return this.options.classifyCurrentItem && hasClassificationSignals
        ? this.autoClassifyCurrentSegmentUnsafe(completed, true)
        : clone(completed)
    })
  }

  async recordScanFailure(accountMid: string, reason: string, expectedRunId?: string) {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      if (expectedRunId && this.scanRuns.get(workspace.accountMid) !== expectedRunId) return false
      if (workspace.status !== 'scanning') return
      const prior = this.scanOverviews.get(workspace.accountMid) ?? { sourceFolders: [], scan: { phase: 'inventory' as const, failureCount: 0, mode: workspace.mode } }
      const overview: ScanOverview = {
        sourceFolders: prior.sourceFolders,
        scan: { phase: 'failed', failureCount: prior.scan.failureCount + 1, mode: prior.scan.mode, reason: reason.slice(0, 256) }
      }
      await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
        currentSegmentId: '', classifications: [], history: [],
        scanMetadata: { sourceFolders: overview.sourceFolders, ...overview.scan }
      })
      this.scanOverviews.set(workspace.accountMid, overview)
      return true
    })
  }

  async completeScan(accountMid: string, options: CompleteWorkspaceScanOptions): Promise<OldFavoriteWorkspace> {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      const completed = completeWorkspaceScan(workspace, options)
      const currentSegmentId = completed.segments[0]?.id ?? ''
      // This internal test/compatibility entry point represents one selected source.
      // The production scan path persists the real inventory before finalization.
      const sourceFolders = this.scanOverviews.get(completed.accountMid)?.sourceFolders ?? [{
        id: 'legacy-source', title: 'Legacy source', itemCount: options.aids.length, isBilimiWorkFolder: false, selected: true
      }]
      await this.options.workspaceStore.create({
        accountMid: completed.accountMid,
        workspaceId: completed.id,
        status: completed.status,
        baselineRevision: completed.baseline?.revision ?? 0,
        currentSegmentId,
        sourceFolders,
        segments: completed.segments.map((segment) => ({
          id: segment.id,
          aids: [...segment.aids],
          items: segment.aids.map((aid) => ({ aid, sourceFolderIds: ['legacy-source'] }))
        }))
      })
      const descriptors = completed.segments.map(({ id, index, aids }) => ({ id, index, itemCount: aids.length }))
      await this.appendEvents(completed, currentSegmentId, [{
        type: 'scan',
        createdAt: completed.createdAt,
        mode: completed.mode,
        segmentSize: completed.segmentSize,
        segments: descriptors,
        baselineCompletedAids: [...completed.baselineCompletedAids]
      }])
      await this.persistMarker(completed)
      this.scanOverviews.set(completed.accountMid, {
        sourceFolders,
        scan: { phase: 'complete', failureCount: 0, mode: completed.mode }
      })
      this.currentSegmentItems.set(completed.accountMid, completed.segments[0]?.aids.map((aid) => ({
        aid, sourceFolderIds: ['legacy-source']
      })) ?? [])
      this.remember(completed, currentSegmentId, descriptors, new Set())
      return clone(completed)
    })
  }

  async selectSegment(accountMid: string, segmentId: string): Promise<OldFavoriteWorkspace> {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      const descriptors = this.segmentDescriptors.get(workspace.accountMid) ??
        workspace.segments.map(({ id, index, aids }) => ({ id, index, itemCount: aids.length }))
      if (!descriptors.some((segment) => segment.id === segmentId)) {
        throw new Error('Old favorite workspace segment is invalid.')
      }
      await this.appendEvents(workspace, segmentId, [])
      const snapshot = await this.options.repository.getSnapshot(workspace.accountMid)
      if (!snapshot.workspace) throw new Error('Old favorite workspace was not found.')
      const restored = await this.restoreFromStore(snapshot.workspace, snapshot.updatedAt)
      if (isRecoveryRequired(restored)) throw new Error('Old favorite workspace requires rebuild.')
      return clone(restored)
    })
  }

  async applyClassificationBatch(
    accountMid: string,
    options: ApplyWorkspaceClassificationBatchOptions
  ): Promise<OldFavoriteWorkspace> {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      const currentSegmentId = this.currentSegment(workspace)
      const currentSegment = workspace.segments.find((segment) => segment.id === currentSegmentId)
      if (!currentSegment || !options.assignments.every((assignment) => currentSegment.aids.includes(assignment.aid))) {
        throw new Error('Old favorite workspace classifications must target the current segment.')
      }
      await this.assertAssignmentsUseSelectedSources(workspace, options.assignments)
      const updated = applyWorkspaceClassificationBatch(workspace, options)
      if (updated === workspace) return clone(workspace)
      const entry = updated.history[updated.history.length - 1]
      const readiness = await this.applyReadinessHistoryChange(workspace, entry, 'forward')
      await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
        currentSegmentId,
        classifications: entry.changes.flatMap((change) => change.after ? [{
          aid: change.after.aid,
          targetLedgerIds: [...change.after.targetLedgerIds],
          source: change.after.source
        }] : []),
        history: [encodeJournalEvent({
          type: 'classification',
          entry: clone(entry),
          historyCursor: updated.historyCursor
        })], planReadiness: readiness
      })
      this.planReadiness.set(workspace.accountMid, readiness)
      this.workspaces.set(updated.accountMid, updated)
      return clone(updated)
    })
  }

  /** DeepSeek results originate in the main process, never from a renderer command. */
  async applyDeepSeekClassificationBatch(
    accountMid: string,
    assignments: ApplyWorkspaceClassificationBatchOptions['assignments'],
    expected: {
      workspaceId: string
      currentSegmentId: string
      selectedSourceFolderIds: string[]
      classifications: Record<string, { targetLedgerIds: string[]; source: string }>
    }
  ): Promise<OldFavoriteWorkspace> {
    if (assignments.length > 2_000 || assignments.some((assignment) =>
      assignment.targetLedgerIds.length > 3 || assignment.targetLedgerIds.some((id) => id.trim().length > 128))) {
      throw new Error('Old favorite workspace DeepSeek classification is invalid.')
    }
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      const currentSegmentId = this.currentSegment(workspace)
      const selectedSourceFolderIds = (this.scanOverviews.get(workspace.accountMid)?.sourceFolders ?? [])
        .filter((folder) => !folder.isBilimiWorkFolder && folder.selected)
        .map((folder) => folder.id)
        .sort()
      const classifications = Object.fromEntries(Object.entries(workspace.classifications).map(([aid, classification]) => [aid, {
        targetLedgerIds: [...classification.targetLedgerIds].sort(),
        source: classification.source
      }]))
      if (workspace.id !== expected.workspaceId || currentSegmentId !== expected.currentSegmentId ||
        JSON.stringify(selectedSourceFolderIds) !== JSON.stringify([...expected.selectedSourceFolderIds].sort()) ||
        JSON.stringify(classifications) !== JSON.stringify(expected.classifications)) {
        throw new Error('Old favorite workspace changed while DeepSeek was running.')
      }
      const currentSegment = workspace.segments.find((segment) => segment.id === currentSegmentId)
      if (!currentSegment || !assignments.every((assignment) => currentSegment.aids.includes(assignment.aid))) {
        throw new Error('Old favorite workspace classifications must target the current segment.')
      }
      await this.assertAssignmentsUseSelectedSources(workspace, assignments)
      const updated = applyWorkspaceClassificationBatch(workspace, { source: 'deepseek', assignments })
      if (updated === workspace) return clone(workspace)
      const entry = updated.history[updated.history.length - 1]
      const readiness = await this.applyReadinessHistoryChange(workspace, entry, 'forward')
      await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
        currentSegmentId,
        classifications: entry.changes.flatMap((change) => change.after ? [{
          aid: change.after.aid,
          targetLedgerIds: [...change.after.targetLedgerIds],
          source: change.after.source
        }] : []),
        history: [encodeJournalEvent({
          type: 'classification', entry: clone(entry), historyCursor: updated.historyCursor
        })], planReadiness: readiness
      })
      this.planReadiness.set(workspace.accountMid, readiness)
      this.workspaces.set(updated.accountMid, updated)
      return clone(updated)
    })
  }

  /** Classifies only the selected current segment; user and DeepSeek decisions remain authoritative. */
  async autoClassifyCurrentSegment(accountMid: string): Promise<OldFavoriteWorkspace> {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      return this.autoClassifyCurrentSegmentUnsafe(workspace, false)
    })
  }

  private async autoClassifyCurrentSegmentUnsafe(workspace: OldFavoriteWorkspace, replaceSystem: boolean) {
    const classify = this.options.classifyCurrentItem
    if (!classify) throw new Error('Old favorite workspace automatic classification is unavailable.')
    const currentSegmentId = this.currentSegment(workspace)
    const currentSegment = workspace.segments.find((segment) => segment.id === currentSegmentId)
    if (!currentSegment) throw new Error('Old favorite workspace current segment is unavailable.')
    const state = await this.ensureRecommendations(workspace)
    const adopted = new Set(state.adoptedCandidateIds)
    const recommendedLedgers = state.candidates.filter((candidate) => adopted.has(candidate.id)).map((candidate, index) => ({
      id: candidate.id, displayName: candidate.displayName, keywords: [...candidate.keywords],
      ruleType: candidate.kind === 'author' ? 'author' as const : 'keyword' as const,
      enabled: true, priority: index, isDefault: false
    }))
    const items = this.currentSegmentItems.get(workspace.accountMid) ?? await this.loadCurrentSegmentItems(workspace)
    const eligibleAids = new Set((await this.selectedSourceAssignments(workspace, items)).map((item) => item.aid))
    const proposed = await Promise.all(items
      .filter((item) => currentSegment.aids.includes(item.aid) && eligibleAids.has(item.aid))
      .filter((item) => {
        const existing = workspace.classifications[String(item.aid)]
        return existing?.source !== 'manual' && existing?.source !== 'deepseek'
      })
      .map(async (item) => ({
        aid: item.aid,
        proposal: recommendedLedgers.length
          ? await classify(clone(item), clone(recommendedLedgers))
          : await classify(clone(item))
      })))
    let updated = workspace
    for (const source of ['system-high', 'system-low'] as const) {
      const assignments = proposed
        .filter(({ proposal }) => proposal.confidence === (source === 'system-high' ? 'high' : 'low'))
        .map(({ aid, proposal }) => ({ aid, targetLedgerIds: proposal.targetLedgerIds.slice(0, 1) }))
      if (!assignments.length) continue
      const next = applyWorkspaceClassificationBatch(updated, { source, assignments, replaceExistingSystem: replaceSystem })
      if (next === updated) continue
      const entry = next.history[next.history.length - 1]
      const readiness = await this.applyReadinessHistoryChange(updated, entry, 'forward')
      await this.options.workspaceStore.appendOverlay(updated.accountMid, updated.id, {
        currentSegmentId,
        classifications: entry.changes.flatMap((change) => change.after ? [{
          aid: change.after.aid, targetLedgerIds: [...change.after.targetLedgerIds], source: change.after.source
        }] : []),
        history: [encodeJournalEvent({ type: 'classification', entry: clone(entry), historyCursor: next.historyCursor })],
        planReadiness: readiness
      })
      this.planReadiness.set(updated.accountMid, readiness)
      updated = next
    }
    this.workspaces.set(updated.accountMid, updated)
    return clone(updated)
  }

  async undoClassificationChange(accountMid: string): Promise<OldFavoriteWorkspace> {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      const updated = undoWorkspaceChange(workspace)
      if (updated === workspace) return clone(workspace)
      const readiness = await this.applyReadinessHistoryChange(workspace, workspace.history[workspace.historyCursor - 1], 'undo')
      await this.appendEvents(updated, this.currentSegment(workspace), [{
        type: 'history-cursor', historyCursor: updated.historyCursor
      }], readiness)
      this.workspaces.set(updated.accountMid, updated)
      return clone(updated)
    })
  }

  async redoClassificationChange(accountMid: string): Promise<OldFavoriteWorkspace> {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      const updated = redoWorkspaceChange(workspace)
      if (updated === workspace) return clone(workspace)
      const readiness = await this.applyReadinessHistoryChange(workspace, workspace.history[workspace.historyCursor], 'forward')
      await this.appendEvents(updated, this.currentSegment(workspace), [{
        type: 'history-cursor', historyCursor: updated.historyCursor
      }], readiness)
      this.workspaces.set(updated.accountMid, updated)
      return clone(updated)
    })
  }

  async freezeSegment(accountMid: string, segmentId: string): Promise<OldFavoriteWorkspace> {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      const frozen = freezeWorkspaceSegment(workspace, segmentId)
      const frozenIds = new Set(this.frozenSegments.get(workspace.accountMid) ?? [])
      frozenIds.add(segmentId)
      const descriptors = this.segmentDescriptors.get(workspace.accountMid) ??
        frozen.segments.map(({ id, index, aids }) => ({ id, index, itemCount: aids.length }))
      const updated = {
        ...frozen,
        status: frozenIds.size >= descriptors.length ? 'frozen' as const : 'previewing' as const
      }
      await this.appendEvents(updated, segmentId, [{ type: 'freeze', segmentId }])
      await this.persistMarker(updated)
      this.remember(updated, segmentId, descriptors, frozenIds)
      return clone(updated)
    })
  }

  /** Commits the complete, classified round to local folders without touching Bilibili. */
  async saveCurrentSegmentToLocalLibrary(accountMid: string): Promise<OldFavoriteWorkspace> {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      if (workspace.status !== 'previewing') throw new Error('Old favorite workspace is not ready for local saving.')
      const currentSegmentId = this.currentSegment(workspace)
      const selectedAssignments = await this.loadSelectedClassificationsForFreeze(workspace)
      const repository = await this.options.repository.getSnapshot(workspace.accountMid)
      const itemsByAid = new Map<number, CurrentSegmentItem>()
      const descriptors = this.segmentDescriptors.get(workspace.accountMid) ??
        workspace.segments.map(({ id, index, aids }) => ({ id, index, itemCount: aids.length }))
      for (const descriptor of descriptors) {
        const segment = await this.options.workspaceStore.loadSegment(workspace.accountMid, workspace.id, descriptor.id)
        for (const item of segment.items ?? []) itemsByAid.set(item.aid, item)
      }
      const selectableSourceFolders = (this.scanOverviews.get(workspace.accountMid)?.sourceFolders ?? [])
        .filter((folder) => !folder.isBilimiWorkFolder)
      const selectedSourceFolderIds = new Set(selectableSourceFolders
        .filter((folder) => folder.selected).map((folder) => folder.id))
      const selectedAids = [...itemsByAid.values()]
        .filter((item) => !selectableSourceFolders.length || item.sourceFolderIds.some((folderId) => selectedSourceFolderIds.has(folderId)))
        .map((item) => item.aid)
        .sort((left, right) => left - right)
      if (!selectedAids.length) throw new Error('Old favorite workspace selected plan is empty.')
      const assignmentsByAid = new Map(selectedAssignments.map((assignment) => [assignment.aid, assignment]))
      const memberAidsByFolderId: Record<string, number[]> = {}
      for (const aid of selectedAids) {
        const targets = assignmentsByAid.get(aid)?.targetLedgerIds ?? ['inbox']
        for (const logicalLedgerId of targets) {
          const folderId = `local:${logicalLedgerId}`
          memberAidsByFolderId[folderId] = [...new Set([
            ...(memberAidsByFolderId[folderId] ?? []),
            aid
          ])].sort((left, right) => left - right)
        }
      }
      const completed = {
        ...workspace, status: 'completed' as const, classifications: {}, history: [], historyCursor: 0,
        completionMode: 'local' as const
      }
      const marker = await this.createMarker(completed, undefined, 'local')
      await this.options.repository.commit(workspace.accountMid, {
        id: `old-favorite-workspace:local:${workspace.id}`,
        accountMid: workspace.accountMid,
        issuedAt: this.now(),
        type: 'commit-local-plan',
        payload: {
          workspaceId: workspace.id,
          memberAidsByFolderId,
          videos: selectedAids.flatMap((aid) => {
            if (repository.videos[String(aid)]) return []
            const item = itemsByAid.get(aid)
            return [{
              aid,
              title: item?.title?.trim() || `Video ${aid}`,
              ...(item?.author?.trim() ? { author: item.author.trim() } : {}),
              tags: [],
              updatedAt: this.now()
            }]
          }),
          folders: Object.keys(memberAidsByFolderId).map((folderId) => ({
            id: folderId,
            title: folderId === 'local:inbox' ? '暂存' : folderId.slice('local:'.length),
            kind: 'local' as const,
            syncState: 'local-only' as const
          })),
          organizationRecords: selectedAssignments.filter((assignment) => assignment.targetLedgerIds.some((id) => id !== 'inbox')).map((assignment) => ({
            accountMid: workspace.accountMid,
            aid: assignment.aid,
            targetFolderIds: assignment.targetLedgerIds.filter((id) => id !== 'inbox').map((logicalLedgerId) => `local:${logicalLedgerId}`),
            completedAt: this.now()
          })),
          workspace: marker
        }
      })
      this.remember(completed, currentSegmentId, this.segmentDescriptors.get(workspace.accountMid) ?? [],
        new Set(this.frozenSegments.get(workspace.accountMid) ?? []))
      return clone(completed)
    })
  }

  /** Freezes a remote plan from persisted physical shards; it never touches the page bridge. */
  async freezeForBilibiliExecution(accountMid: string): Promise<FavoriteRepositoryWorkspace> {
    const preparation = await this.queue(async () => {
        const workspace = await this.requireWorkspace(accountMid)
        if (workspace.status !== 'previewing' || !workspace.baseline) {
          throw new Error('Old favorite workspace is not ready to freeze.')
        }
        const classifications = await this.loadSelectedClassificationsForFreeze(workspace)
        const recommendations = await this.ensureRecommendations(workspace)
        const recommendationTitles = new Map(recommendations.candidates.map((candidate) => [candidate.id, candidate.displayName]))
        const assignmentAids = classifications.reduce<Record<string, number[]>>((aidsByLedger, classification) => {
          for (const logicalLedgerId of classification.targetLedgerIds.map((id) => id.trim()).filter((id) => id && id !== 'inbox')) {
            aidsByLedger[logicalLedgerId] = [...new Set([...(aidsByLedger[logicalLedgerId] ?? []), classification.aid])]
          }
          return aidsByLedger
        }, {})
        const repositorySnapshot = await this.options.repository.getSnapshot(workspace.accountMid)
        const boundTitles = new Map(repositorySnapshot.folders
          .filter((folder) => folder.kind === 'bilimi-logical' && folder.logicalLedgerId)
          .map((folder) => [folder.logicalLedgerId!, folder.title]))
        const defaultTitles = new Map(createDefaultFavoriteLedgers().map((ledger) => [ledger.id, ledger.displayName]))
        const logicalTitles = new Map(await Promise.all(Object.keys(assignmentAids).map(async (logicalLedgerId) => [
          logicalLedgerId,
          boundTitles.get(logicalLedgerId) ?? recommendationTitles.get(logicalLedgerId) ??
            await this.options.resolveLedgerTitle?.(workspace.accountMid, logicalLedgerId) ?? defaultTitles.get(logicalLedgerId)
        ] as const)))
        return {
          accountMid: workspace.accountMid,
          logicalTitles,
          assignmentAids
      }
    })
    await this.stageUnclassifiedSelectedVideos(preparation.accountMid)
    if (this.options.bindingService) {
      const snapshot = await this.options.repository.getSnapshot(preparation.accountMid)
      for (const [logicalLedgerId, assignmentAids] of Object.entries(preparation.assignmentAids).sort(([left], [right]) => left.localeCompare(right))) {
        const logicalTitle = preparation.logicalTitles.get(logicalLedgerId)
        if (!logicalTitle) throw new Error('Old favorite workspace target title is unavailable.')
        const existing = snapshot.physicalShards.filter((shard) => shard.logicalLedgerId === logicalLedgerId)
        const existingMemberAids = new Set(existing.flatMap((shard) => snapshot.memberships[shard.folderId] ?? []))
        const newAssignmentCount = assignmentAids.filter((aid) => !existingMemberAids.has(aid)).length
        const availableCapacity = existing.reduce((total, shard) => total + Math.max(
          0,
          1_000 - Math.max(snapshot.memberships[shard.folderId]?.length ?? 0, shard.remoteMemberCount ?? 0)
        ), 0)
        const shardCount = Math.max(0, Math.ceil((newAssignmentCount - availableCapacity) / 1_000))
        const nextShardNumber = Math.max(0, ...existing.map((shard) => shard.shardNumber)) + 1
        for (let offset = 0; offset < shardCount; offset += 1) {
          await this.options.bindingService.ensurePhysicalShard(preparation.accountMid, {
            logicalLedgerId,
            logicalTitle,
            remoteDisplayTitle: logicalTitle,
            shardNumber: nextShardNumber + offset,
            memberAids: []
          })
        }
      }
    }
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(preparation.accountMid)
      if (workspace.status !== 'previewing' || !workspace.baseline) {
        throw new Error('Old favorite workspace is not ready to freeze.')
      }
      const classifications = await this.loadSelectedClassificationsForFreeze(workspace)
      const snapshot = await this.options.repository.getSnapshot(workspace.accountMid)
      const boundShards = snapshot.physicalShards.flatMap((shard) => {
        if (shard.bindingState !== 'bound' || !shard.remoteFolderId) return []
        const memberAids = snapshot.memberships[shard.folderId] ?? []
        return [{
          logicalLedgerId: shard.logicalLedgerId,
          remoteFolderId: shard.remoteFolderId,
          memberAids,
          memberCount: Math.max(memberAids.length, shard.remoteMemberCount ?? 0),
          shardNumber: shard.shardNumber
        }]
      })
      const result = compileFrozenFavoriteSyncPlan({
        accountMid: workspace.accountMid,
        workspaceId: workspace.id,
        baselineRevision: workspace.baseline.revision,
        createdAt: this.now(),
        classifications: classifications.map((classification) => ({
          aid: classification.aid,
          targetLedgerIds: classification.targetLedgerIds.filter((id) => id !== 'inbox')
        })),
        shards: boundShards
      })
      if (!result.allowed || !result.plan) {
        throw new Error(`Old favorite workspace cannot freeze: ${result.reason ?? 'invalid-input'}`)
      }
      const frozen = { ...workspace, status: 'frozen' as const }
      await this.persistMarker(frozen, result.plan)
      this.remember(frozen, this.currentSegment(workspace), this.segmentDescriptors.get(workspace.accountMid) ?? [],
        new Set(this.frozenSegments.get(workspace.accountMid) ?? []))
      const persisted = await this.options.repository.getSnapshot(workspace.accountMid)
      if (!persisted.workspace?.frozenSyncPlan) throw new Error('Old favorite workspace frozen plan was not persisted.')
      return clone(persisted.workspace)
    })
  }

  async pauseTagEnrichment(accountMid: string) {
    return this.queue(() => this.setTagEnrichmentStatus(accountMid, 'paused'))
  }

  async resumeTagEnrichment(accountMid: string) {
    return this.queue(() => this.setTagEnrichmentStatus(accountMid, 'running'))
  }

  async acceptCurrentTags(accountMid: string) {
    return this.queue(() => this.setTagEnrichmentStatus(accountMid, 'accepted'))
  }

  async getPendingTagEnrichmentAids(accountMid: string) {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      const enrichment = this.tagEnrichments.get(workspace.accountMid)
      return enrichment?.status === 'running' ? [...enrichment.pendingAids] : []
    })
  }

  async recordTagEnrichment(accountMid: string, aid: number, tags: string[], expectedWorkspaceId?: string) {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      if (expectedWorkspaceId && workspace.id !== expectedWorkspaceId) return false
      const enrichment = this.tagEnrichments.get(workspace.accountMid)
      if (!enrichment || enrichment.status !== 'running' || !enrichment.pendingAids.includes(aid)) return false
      const normalizedTags = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 32)
      const pendingAids = enrichment.pendingAids.filter((candidate) => candidate !== aid)
      const next: TagEnrichment = {
        ...enrichment,
        pendingAids,
        status: pendingAids.length ? 'running' : 'complete'
      }
      await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
        currentSegmentId: this.currentSegment(workspace), classifications: [], history: [],
        tagUpdates: [{ aid, tags: normalizedTags }], tagEnrichment: clone(next)
      })
      const currentItems = this.currentSegmentItems.get(workspace.accountMid)
      if (currentItems) {
        this.currentSegmentItems.set(workspace.accountMid, currentItems.map((item) => item.aid === aid ? { ...item, tags: normalizedTags } : item))
      }
      this.tagEnrichments.set(workspace.accountMid, next)
      return true
    })
  }

  private async setTagEnrichmentStatus(accountMid: string, status: TagEnrichment['status']) {
    const workspace = await this.requireWorkspace(accountMid)
    if (workspace.status !== 'previewing') throw new Error('Old favorite workspace tags are not ready.')
    const current = this.tagEnrichments.get(workspace.accountMid)
    if (!current || current.status === 'complete' || current.status === 'accepted') return
    if (status === 'running' && !current.pendingAids.length) return
    const next: TagEnrichment = { ...current, status }
    await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
      currentSegmentId: this.currentSegment(workspace), classifications: [], history: [], tagEnrichment: clone(next)
    })
    this.tagEnrichments.set(workspace.accountMid, next)
  }

  /** Moves the durable history cursor without letting the renderer replay classifications. */
  async moveHistoryCursor(accountMid: string, targetCursor: number): Promise<OldFavoriteWorkspace> {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      if (!Number.isSafeInteger(targetCursor) || targetCursor < 0 || targetCursor > workspace.history.length) {
        throw new Error('Old favorite workspace history cursor is invalid.')
      }
      let updated = workspace
      while (updated.historyCursor > targetCursor) updated = undoWorkspaceChange(updated)
      while (updated.historyCursor < targetCursor) updated = redoWorkspaceChange(updated)
      if (updated === workspace) return clone(workspace)
      const readiness = await this.calculatePlanReadiness(updated)
      await this.appendEvents(updated, this.currentSegment(workspace), [{
        type: 'history-cursor', historyCursor: updated.historyCursor
      }], readiness)
      this.planReadiness.set(updated.accountMid, readiness)
      this.workspaces.set(updated.accountMid, updated)
      return clone(updated)
    })
  }

  /** Writes unresolved videos to the local-only inbox before compiling a remote-only plan. */
  private async stageUnclassifiedSelectedVideos(accountMid: string) {
    await this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      if (workspace.status !== 'previewing') return
      const selectedAssignments = await this.loadSelectedClassificationsForFreeze(workspace)
      const remotelyClassifiedAids = new Set(selectedAssignments
        .filter((assignment) => assignment.targetLedgerIds.some((id) => id !== 'inbox'))
        .map((assignment) => assignment.aid))
      const overview = this.scanOverviews.get(workspace.accountMid)
      const selectable = overview?.sourceFolders.filter((folder) => !folder.isBilimiWorkFolder) ?? []
      const selectedSourceFolderIds = new Set(selectable.filter((folder) => folder.selected).map((folder) => folder.id))
      const descriptors = this.segmentDescriptors.get(workspace.accountMid) ??
        workspace.segments.map(({ id, index, aids }) => ({ id, index, itemCount: aids.length }))
      const items: CurrentSegmentItem[] = []
      for (const descriptor of descriptors) {
        const segment = await this.options.workspaceStore.loadSegment(workspace.accountMid, workspace.id, descriptor.id)
        items.push(...(segment.items ?? []))
      }
      const unresolved = items.filter((item) =>
        (!selectable.length || item.sourceFolderIds.some((folderId) => selectedSourceFolderIds.has(folderId))) && !remotelyClassifiedAids.has(item.aid))
      if (!unresolved.length) return
      const repository = await this.options.repository.getSnapshot(workspace.accountMid)
      await this.options.repository.commit(workspace.accountMid, {
        id: `old-favorite-workspace:stage:${workspace.id}:${randomUUID()}`,
        accountMid: workspace.accountMid,
        issuedAt: this.now(),
        type: 'commit-local-plan',
        payload: {
          workspaceId: workspace.id,
          memberAidsByFolderId: { 'local:inbox': unresolved.map((item) => item.aid).sort((left, right) => left - right) },
          folders: [{ id: 'local:inbox', title: '暂存', kind: 'local', syncState: 'local-only' }],
          videos: unresolved.flatMap((item) => repository.videos[String(item.aid)] ? [] : [{
            aid: item.aid,
            title: item.title?.trim() || `Video ${item.aid}`,
            ...(item.author?.trim() ? { author: item.author.trim() } : {}),
            tags: [...(item.tags ?? [])],
            updatedAt: this.now()
          }])
        }
      })
    })
  }

  async executeFrozenBilibiliPlan(accountMid: string): Promise<FavoriteRepositorySyncRun> {
    const frozenPlan = await this.queue(async () => {
      const snapshot = await this.options.repository.getSnapshot(accountMid)
      const workspace = snapshot.workspace
      if (!workspace?.frozenSyncPlan || (workspace.status !== 'frozen' && workspace.status !== 'executing')) {
        throw new Error('Old favorite workspace is not frozen for Bilibili execution.')
      }
      if (!this.options.syncService) throw new Error('Old favorite workspace sync service is unavailable.')
      return { accountMid: snapshot.accountMid, plan: clone(workspace.frozenSyncPlan) }
    })
    // The sync service owns its own run lock; never hold workspace mutations
    // while waiting on a remote page request so snapshot recovery stays live.
    if (!this.options.syncService) throw new Error('Old favorite workspace sync service is unavailable.')
    const currentRun = await this.options.syncService.getRun(frozenPlan.accountMid, frozenPlan.plan.id)
    if (currentRun.status === 'succeeded') {
      // A crash can occur after the final checkpoint but before the completed
      // marker. The sync service resolves that durable boundary without a page bind.
      return this.options.syncService.executeFrozenPlan(frozenPlan.accountMid, frozenPlan.plan)
    }
    if (currentRun.status === 'ready-to-resume') {
      return this.options.syncService.resume(frozenPlan.accountMid, frozenPlan.plan.id)
    }
    if (currentRun.status !== 'running') {
      return currentRun
    }
    return this.options.syncService.executeFrozenPlan(frozenPlan.accountMid, frozenPlan.plan)
  }

  /** One user confirmation freezes the immutable plan, then starts its controlled execution. */
  async confirmAndExecuteBilibiliPlan(accountMid: string): Promise<FavoriteRepositorySyncRun> {
    await this.freezeForBilibiliExecution(accountMid)
    return this.executeFrozenBilibiliPlan(accountMid)
  }

  /** Claims a frozen plan synchronously, then drives Bilibili in one main-process background task. */
  async beginBilibiliExecution(accountMid: string): Promise<OldFavoriteWorkspaceSnapshot> {
    const frozen = await this.freezeForBilibiliExecution(accountMid)
    if (!frozen.frozenSyncPlan || !this.options.syncService) {
      throw new Error('Old favorite workspace sync service is unavailable.')
    }
    await this.options.syncService.claimFrozenPlan(frozen.accountMid, frozen.frozenSyncPlan)
    void this.executeFrozenBilibiliPlan(frozen.accountMid).catch(() => undefined)
    return this.getSnapshot(frozen.accountMid) as Promise<OldFavoriteWorkspaceSnapshot>
  }

  async bindAndReconcileFrozenBilibiliPlan(accountMid: string): Promise<FavoriteRepositorySyncRun> {
    const run = await this.queue(async () => {
      const snapshot = await this.options.repository.getSnapshot(accountMid)
      const plan = snapshot.workspace?.frozenSyncPlan
      if (!plan || (snapshot.workspace?.status !== 'reconciling' && snapshot.workspace?.status !== 'executing')) {
        throw new Error('Old favorite workspace does not require reconciliation.')
      }
      if (!this.options.syncService) throw new Error('Old favorite workspace sync service is unavailable.')
      return { accountMid: snapshot.accountMid, runId: plan.id }
    })
    if (!this.options.syncService) throw new Error('Old favorite workspace sync service is unavailable.')
    await this.options.syncService.bindPageTarget(run.accountMid, run.runId)
    return this.options.syncService.reconcile(run.accountMid, run.runId)
  }

  async resumeReconciledBilibiliPlan(accountMid: string): Promise<FavoriteRepositorySyncRun> {
    const run = await this.queue(async () => {
      const snapshot = await this.options.repository.getSnapshot(accountMid)
      const plan = snapshot.workspace?.frozenSyncPlan
      if (!plan || snapshot.workspace?.status !== 'frozen') throw new Error('Old favorite workspace is not ready to continue.')
      if (!this.options.syncService) throw new Error('Old favorite workspace sync service is unavailable.')
      return { accountMid: snapshot.accountMid, runId: plan.id }
    })
    if (!this.options.syncService) throw new Error('Old favorite workspace sync service is unavailable.')
    return this.options.syncService.resume(run.accountMid, run.runId)
  }

  async recordDiscoveredFavorites(accountMid: string, discoveredAids: number[]): Promise<OldFavoriteWorkspace> {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      const updated = recordDiscoveredFavorites(workspace, discoveredAids)
      if (updated === workspace) return clone(workspace)
      const existing = new Set(workspace.continuationAids)
      const additions = updated.continuationAids.filter((aid) => !existing.has(aid))
      await this.appendEvents(updated, this.currentSegment(workspace), [{ type: 'discover', aids: additions }])
      this.workspaces.set(updated.accountMid, updated)
      return clone(updated)
    })
  }

  private async openUnsafe(accountMid: string): Promise<OldFavoriteWorkspace | OldFavoriteWorkspaceRecoveryRequired> {
    const snapshot = await this.options.repository.getSnapshot(accountMid)
    const account = snapshot.accountMid
    const cached = this.workspaces.get(account)
    if (cached && snapshot.workspace && this.matchesMarker(cached, snapshot.workspace)) return clone(cached)

    if (snapshot.workspace) return this.restoreFromStore(snapshot.workspace, snapshot.updatedAt)

    const workspace = await this.createScanningWorkspace(account)
    return clone(workspace)
  }

  private async createScanningWorkspace(accountMid: string, mode?: OldFavoriteWorkspace['mode']) {
    const account = (await this.options.repository.getSnapshot(accountMid)).accountMid
    const now = this.now()
    const workspace = createOldFavoriteWorkspace({
      accountMid: account,
      now,
      id: `old-favorite-workspace-${account}-${now.replace(/[^0-9]/g, '')}-${randomUUID()}`
    })
    await this.options.workspaceStore.create({
      accountMid: account,
      workspaceId: workspace.id,
      status: workspace.status,
      baselineRevision: 0,
      currentSegmentId: '',
      segments: []
    })
    await this.persistMarker(workspace)
    this.currentSegmentItems.delete(account)
    this.scanOverviews.delete(account)
      this.scanRuns.delete(account)
    this.scannedAids.delete(account)
    this.scannedTagStates.delete(account)
    this.tagEnrichments.delete(account)
    this.remember(workspace, '', [], new Set())
    return mode ? { ...workspace, mode } : workspace
  }

  private async restoreFromStore(
    marker: FavoriteRepositoryWorkspace,
    updatedAt: string
  ): Promise<OldFavoriteWorkspace | OldFavoriteWorkspaceRecoveryRequired> {
    const recovered = await this.options.workspaceStore.recover(marker.accountMid, marker.id)
    if ('recovery' in recovered || recovered.baselineRevision !== marker.baselineRevision) {
      this.workspaces.delete(marker.accountMid)
      return {
        recovery: 'rebuild-required',
        preserveCompletedLocalResults: true,
        accountMid: marker.accountMid,
        workspaceId: marker.id
      }
    }

    const events = recovered.history.map(decodeJournalEvent).filter((event): event is WorkspaceJournalEvent => Boolean(event))
    const scan = events.find((event): event is ScanJournalEvent => event.type === 'scan')
    if (marker.status === 'scanning') {
      const scanning = { ...createOldFavoriteWorkspace({ accountMid: marker.accountMid, id: marker.id, now: updatedAt }), mode: recovered.scan.mode }
      this.scanOverviews.set(marker.accountMid, {
        sourceFolders: recovered.sourceFolders,
        scan: recovered.scan
      })
      this.recommendations.set(marker.accountMid, clone(recovered.recommendations))
      this.remember(scanning, '', [], new Set())
      return clone(scanning)
    }
    if (!scan) return {
      recovery: 'rebuild-required',
      preserveCompletedLocalResults: true,
      accountMid: marker.accountMid,
      workspaceId: marker.id
    }

    const descriptor = scan.segments.find((segment) => segment.id === recovered.currentSegmentId)
    if (!descriptor && scan.segments.length) return {
      recovery: 'rebuild-required', preserveCompletedLocalResults: true,
      accountMid: marker.accountMid, workspaceId: marker.id
    }
    const loaded = {
      id: recovered.currentSegmentId,
      aids: [...recovered.loadedSegmentAids]
    }
    this.currentSegmentItems.set(marker.accountMid, recovered.loadedSegmentItems.map(clone))
    const activeAidSet = new Set(loaded.aids)
    const frozenIds = new Set(events.flatMap((event) => event.type === 'freeze' ? [event.segmentId] : []))
    const historyEvents = events.filter((event): event is ClassificationJournalEvent => event.type === 'classification')
    const allHistory = historyEvents.map((event) => clone(event.entry))
    const latestCursor = [...events].reverse().find((event): event is ClassificationJournalEvent | CursorJournalEvent =>
      event.type === 'classification' || event.type === 'history-cursor')?.historyCursor ?? allHistory.length
    const recoveredHistory = allHistory.map((entry) => ({
      ...entry,
      changes: entry.changes.filter((change) => activeAidSet.has(change.aid))
    })).filter((entry) => entry.changes.length > 0)
    const history = marker.status === 'completed' ? [] : recoveredHistory
    const historyCursor = marker.status === 'completed' ? 0 : Math.min(latestCursor, history.length)
    const classifications: OldFavoriteWorkspace['classifications'] = {}
    for (const entry of history.slice(0, historyCursor)) {
      for (const change of entry.changes) {
        if (change.after) classifications[String(change.aid)] = clone(change.after)
        else delete classifications[String(change.aid)]
      }
    }
    const baselineCompletedAids = normalizeAids(scan.baselineCompletedAids).filter((aid) => activeAidSet.has(aid))
    const protectedSet = new Set(scan.mode === 'incremental' ? baselineCompletedAids : [])
    const continuationAids = normalizeAids(events.flatMap((event) => event.type === 'discover' ? event.aids : []))
    const scanning = createOldFavoriteWorkspace({
      accountMid: marker.accountMid,
      id: marker.id,
      now: scan.createdAt,
      segmentSize: scan.segmentSize
    })
    const workspace: OldFavoriteWorkspace = {
      ...scanning,
      status: marker.status,
      mode: scan.mode,
      baseline: { revision: marker.baselineRevision, aids: [...loaded.aids] },
      baselineCompletedAids,
      plannedAids: loaded.aids.filter((aid) => !protectedSet.has(aid)),
      protectedAids: [...protectedSet],
      continuationAids,
      hasMultipleSegments: scan.segments.length > 1,
      segments: descriptor ? [{
        id: descriptor.id,
        index: descriptor.index,
        aids: [...loaded.aids],
        status: frozenIds.has(descriptor.id) ? 'frozen' : 'previewing'
      }] : [],
      classifications,
      history,
      historyCursor,
      ...(marker.completionMode ? { completionMode: marker.completionMode } : {})
    }
    this.scanOverviews.set(marker.accountMid, {
      // Workspaces created before source selection did not persist this flag.
      sourceFolders: recovered.sourceFolders.map((folder) => ({
        ...folder,
        selected: folder.isBilimiWorkFolder ? false : folder.selected ?? true
      })),
      scan: { phase: 'complete', failureCount: 0, mode: scan.mode }
    })
    this.recommendations.set(marker.accountMid, clone(recovered.recommendations))
    this.planReadiness.set(marker.accountMid, clone(recovered.planReadiness))
    if (recovered.tagEnrichment) {
      this.tagEnrichments.set(marker.accountMid, clone(recovered.tagEnrichment))
      if (recovered.tagUpdates.length) {
        const updates = new Map(recovered.tagUpdates.map((update) => [update.aid, update.tags]))
        this.currentSegmentItems.set(marker.accountMid, recovered.loadedSegmentItems.map((item) =>
          updates.has(item.aid) ? { ...item, tags: updates.get(item.aid) } : item))
      }
    } else this.tagEnrichments.delete(marker.accountMid)
    this.remember(workspace, recovered.currentSegmentId, scan.segments, frozenIds)
    return clone(workspace)
  }

  private async requireWorkspace(accountMid: string): Promise<OldFavoriteWorkspace> {
    const snapshot = await this.options.repository.getSnapshot(accountMid)
    const workspace = this.workspaces.get(snapshot.accountMid)
    if (workspace && snapshot.workspace && this.matchesMarker(workspace, snapshot.workspace)) return workspace
    const opened = await this.openUnsafe(snapshot.accountMid)
    if (isRecoveryRequired(opened)) throw new Error('Old favorite workspace requires rebuild.')
    return opened
  }

  private async appendEvents(
    workspace: OldFavoriteWorkspace,
    currentSegmentId: string,
    events: WorkspaceJournalEvent[],
    planReadiness?: PlanReadiness
  ) {
    await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
      currentSegmentId,
      classifications: [],
      history: events.map(encodeJournalEvent),
      ...(planReadiness ? { planReadiness } : {})
    })
    if (planReadiness) this.planReadiness.set(workspace.accountMid, planReadiness)
  }

  private async calculatePlanReadiness(workspace: OldFavoriteWorkspace): Promise<PlanReadiness> {
    const overview = this.scanOverviews.get(workspace.accountMid)
    if (!overview) return { selectedAidCount: 0, classifiedAidCount: 0 }
    const selectedSourceFolderIds = new Set(overview.sourceFolders
      .filter((folder) => !folder.isBilimiWorkFolder && folder.selected)
      .map((folder) => folder.id))
    if (!selectedSourceFolderIds.size) return { selectedAidCount: 0, classifiedAidCount: 0 }
    const descriptors = this.segmentDescriptors.get(workspace.accountMid) ??
      workspace.segments.map(({ id, index, aids }) => ({ id, index, itemCount: aids.length }))
    let selectedAidCount = 0
    for (const descriptor of descriptors) {
      const segment = await this.options.workspaceStore.loadSegment(workspace.accountMid, workspace.id, descriptor.id)
      selectedAidCount += (segment.items ?? []).filter((item) =>
        item.sourceFolderIds.some((folderId) => selectedSourceFolderIds.has(folderId))).length
    }
    const classifiedAidCount = new Set((await this.loadSelectedClassificationsForFreeze(workspace))
      .filter((classification) => classification.targetLedgerIds.length)
      .map((classification) => classification.aid)).size
    return { selectedAidCount, classifiedAidCount: Math.min(selectedAidCount, classifiedAidCount) }
  }

  private calculatePlanReadinessFromItems(
    _workspace: OldFavoriteWorkspace,
    items: Iterable<CurrentSegmentItem>,
    sourceFolders: ScanOverview['sourceFolders']
  ): PlanReadiness {
    const selectedSourceFolderIds = new Set(sourceFolders
      .filter((folder) => !folder.isBilimiWorkFolder && folder.selected)
      .map((folder) => folder.id))
    const selectedAidCount = [...items].filter((item) =>
      item.sourceFolderIds.some((folderId) => selectedSourceFolderIds.has(folderId))).length
    return { selectedAidCount, classifiedAidCount: 0 }
  }

  private async applyReadinessHistoryChange(
    workspace: OldFavoriteWorkspace,
    entry: OldFavoriteWorkspaceHistoryEntry | undefined,
    direction: 'forward' | 'undo'
  ): Promise<PlanReadiness> {
    const current = this.planReadiness.get(workspace.accountMid) ?? await this.calculatePlanReadiness(workspace)
    if (!entry) return current
    const selectedSourceFolderIds = new Set((this.scanOverviews.get(workspace.accountMid)?.sourceFolders ?? [])
      .filter((folder) => !folder.isBilimiWorkFolder && folder.selected).map((folder) => folder.id))
    const currentItems = this.currentSegmentItems.get(workspace.accountMid) ?? await this.loadCurrentSegmentItems(workspace)
    const selectedAids = new Set(currentItems.filter((item) => item.sourceFolderIds.some((folderId) => selectedSourceFolderIds.has(folderId))).map((item) => item.aid))
    let classifiedAidCount = current.classifiedAidCount
    for (const change of entry.changes) {
      if (!selectedAids.has(change.aid)) continue
      const before = (direction === 'forward' ? change.before : change.after)?.targetLedgerIds.length ?? 0
      const after = (direction === 'forward' ? change.after : change.before)?.targetLedgerIds.length ?? 0
      if (!before && after) classifiedAidCount += 1
      if (before && !after) classifiedAidCount -= 1
    }
    return { selectedAidCount: current.selectedAidCount, classifiedAidCount: Math.max(0, Math.min(current.selectedAidCount, classifiedAidCount)) }
  }

  private async assertAssignmentsUseSelectedSources(
    workspace: OldFavoriteWorkspace,
    assignments: ApplyWorkspaceClassificationBatchOptions['assignments']
  ) {
    const selected = await this.selectedSourceAssignments(workspace, assignments)
    if (selected.length !== assignments.length) {
      throw new Error('Old favorite workspace classifications must target selected sources.')
    }
  }

  private async selectedSourceAssignments<T extends { aid: number }>(workspace: OldFavoriteWorkspace, assignments: T[]): Promise<T[]> {
    const overview = this.scanOverviews.get(workspace.accountMid)
    // A remote plan requires durable evidence of the user-selected source scope.
    // Missing metadata must never widen that scope after recovery.
    if (!overview) return []
    const sourceFolders = overview.sourceFolders
    // Legacy/test workspaces may not have inventory metadata; only enforce a scope the user could select.
    if (!sourceFolders.length) return assignments
    const selectedSourceFolderIds = new Set(sourceFolders
      .filter((folder) => !folder.isBilimiWorkFolder && folder.selected)
      .map((folder) => folder.id))
    const currentItems = this.currentSegmentItems.get(workspace.accountMid)
    const items = currentItems ?? await this.loadCurrentSegmentItems(workspace)
    const itemsByAid = new Map(items.map((item) => [item.aid, item]))
    return assignments.filter((assignment) =>
      itemsByAid.get(assignment.aid)?.sourceFolderIds.some((folderId) => selectedSourceFolderIds.has(folderId)))
  }

  /** Replays per-segment journal deltas only when compiling a one-confirmation remote plan. */
  private async loadSelectedClassificationsForFreeze(workspace: OldFavoriteWorkspace) {
    const overlays = await this.options.workspaceStore.readOverlayHistory(workspace.accountMid, workspace.id)
    const entriesBySegment = new Map<string, OldFavoriteWorkspaceHistoryEntry[]>()
    const cursorBySegment = new Map<string, number>()
    for (const overlay of overlays) {
      const entries = entriesBySegment.get(overlay.currentSegmentId) ?? []
      for (const history of overlay.history) {
        const event = decodeJournalEvent(history)
        if (!event) continue
        if (event.type === 'classification') {
          const next = entries.slice(0, Math.max(0, event.historyCursor - 1))
          next.push(clone(event.entry))
          entriesBySegment.set(overlay.currentSegmentId, next)
          cursorBySegment.set(overlay.currentSegmentId, event.historyCursor)
        } else if (event.type === 'history-cursor') {
          cursorBySegment.set(overlay.currentSegmentId, event.historyCursor)
        }
      }
    }
    const classifications = new Map<number, OldFavoriteWorkspace['classifications'][string]>()
    for (const [segmentId, entries] of entriesBySegment) {
      for (const entry of entries.slice(0, Math.min(cursorBySegment.get(segmentId) ?? entries.length, entries.length))) {
        for (const change of entry.changes) {
          if (change.after) classifications.set(change.aid, clone(change.after))
          else classifications.delete(change.aid)
        }
      }
    }
    const overview = this.scanOverviews.get(workspace.accountMid)
    if (!overview) return []
    const sourceFolders = overview.sourceFolders
    const hasSelectableSourceFolders = sourceFolders.some((folder) => !folder.isBilimiWorkFolder)
    const selectedSourceFolderIds = new Set(sourceFolders
      .filter((folder) => !folder.isBilimiWorkFolder && folder.selected)
      .map((folder) => folder.id))
    const selected = [] as OldFavoriteWorkspace['classifications'][string][]
    const descriptors = this.segmentDescriptors.get(workspace.accountMid) ?? workspace.segments.map(({ id, index, aids }) => ({ id, index, itemCount: aids.length }))
    for (const descriptor of descriptors) {
      const segment = await this.options.workspaceStore.loadSegment(workspace.accountMid, workspace.id, descriptor.id)
      for (const item of segment.items ?? []) {
        const classification = classifications.get(item.aid)
        if (classification && (!hasSelectableSourceFolders || item.sourceFolderIds.some((folderId) => selectedSourceFolderIds.has(folderId)))) {
          selected.push(clone(classification))
        }
      }
    }
    return selected
  }

  /** A one-click cross-segment plan must never silently omit an unclassified selected item. */
  private async assertSelectedPlanFullyClassified(
    workspace: OldFavoriteWorkspace,
    classifications: OldFavoriteWorkspace['classifications'][string][]
  ) {
    const overview = this.scanOverviews.get(workspace.accountMid)
    // Old workspaces without persisted selection metadata are fail-closed by
    // freezing an empty plan, never by widening their source scope.
    if (!overview) return
    const selectable = overview.sourceFolders.filter((folder) => !folder.isBilimiWorkFolder)
    const selectedSourceFolderIds = new Set(selectable.filter((folder) => folder.selected).map((folder) => folder.id))
    if (selectable.length && !selectedSourceFolderIds.size) return
    const expectedAids = new Set<number>()
    const descriptors = this.segmentDescriptors.get(workspace.accountMid) ?? workspace.segments.map(({ id, index, aids }) => ({ id, index, itemCount: aids.length }))
    for (const descriptor of descriptors) {
      const segment = await this.options.workspaceStore.loadSegment(workspace.accountMid, workspace.id, descriptor.id)
      for (const item of segment.items ?? []) {
        if (!selectable.length || item.sourceFolderIds.some((folderId) => selectedSourceFolderIds.has(folderId))) expectedAids.add(item.aid)
      }
    }
    const classifiedAids = new Set(classifications.filter((classification) => classification.targetLedgerIds.length).map((classification) => classification.aid))
    if ([...expectedAids].some((aid) => !classifiedAids.has(aid))) {
      throw new Error('Old favorite workspace selected plan is not fully classified.')
    }
  }

  private async loadCurrentSegmentItems(workspace: OldFavoriteWorkspace) {
    const recovered = await this.options.workspaceStore.recover(workspace.accountMid, workspace.id)
    if ('recovery' in recovered) throw new Error('Old favorite workspace requires rebuild.')
    this.currentSegmentItems.set(workspace.accountMid, recovered.loadedSegmentItems.map(clone))
    return recovered.loadedSegmentItems
  }

  private async persistMarker(
    workspace: OldFavoriteWorkspace,
    frozenSyncPlan?: FavoriteRepositoryWorkspace['frozenSyncPlan'],
    completionMode?: FavoriteRepositoryWorkspace['completionMode']
  ) {
    const marker = await this.createMarker(workspace, frozenSyncPlan, completionMode)
    await this.options.repository.commit(workspace.accountMid, {
      id: `old-favorite-workspace:${workspace.id}:${randomUUID()}`,
      accountMid: workspace.accountMid,
      issuedAt: this.now(),
      type: 'set-workspace',
      payload: marker
    })
  }

  private async createMarker(
    workspace: OldFavoriteWorkspace,
    frozenSyncPlan?: FavoriteRepositoryWorkspace['frozenSyncPlan'],
    completionMode?: FavoriteRepositoryWorkspace['completionMode']
  ): Promise<FavoriteRepositoryWorkspace> {
    const snapshot = await this.options.repository.getSnapshot(workspace.accountMid)
    const recovered = await this.options.workspaceStore.recover(workspace.accountMid, workspace.id)
    if ('recovery' in recovered) throw new Error('Old favorite workspace requires rebuild.')
    const marker: FavoriteRepositoryWorkspace = {
      id: workspace.id,
      accountMid: workspace.accountMid,
      status: workspace.status,
      baselineRevision: workspace.baseline?.revision ?? 0,
      continuationAids: [],
      workspaceRef: {
        workspaceId: workspace.id,
        accountMid: workspace.accountMid,
        status: workspace.status,
        baselineRevision: workspace.baseline?.revision ?? 0,
        currentSegmentId: recovered.currentSegmentId,
        overlayRevision: recovered.overlayRevision,
        journalCursor: recovered.journalCursor,
        checksum: recovered.manifestChecksum
      },
      ...(frozenSyncPlan
        ? { frozenSyncPlan: clone(frozenSyncPlan) }
        : snapshot.workspace?.id === workspace.id && snapshot.workspace.frozenSyncPlan
        ? { frozenSyncPlan: clone(snapshot.workspace.frozenSyncPlan) }
        : {}),
      ...(completionMode ? { completionMode } : snapshot.workspace?.completionMode ? { completionMode: snapshot.workspace.completionMode } : {})
    }
    return marker
  }

  private remember(
    workspace: OldFavoriteWorkspace,
    currentSegmentId: string,
    descriptors: SegmentDescriptor[],
    frozenIds: Set<string>
  ) {
    this.workspaces.set(workspace.accountMid, workspace)
    this.currentSegments.set(workspace.accountMid, currentSegmentId)
    this.segmentDescriptors.set(workspace.accountMid, descriptors.map(clone))
    this.frozenSegments.set(workspace.accountMid, new Set(frozenIds))
    if (!workspace.segments.length) this.currentSegmentItems.set(workspace.accountMid, [])
  }

  private currentSegment(workspace: OldFavoriteWorkspace) {
    return this.currentSegments.get(workspace.accountMid) ?? workspace.segments[0]?.id ?? ''
  }

  private async ensureRecommendations(workspace: OldFavoriteWorkspace): Promise<RecommendationState> {
    const remembered = this.recommendations.get(workspace.accountMid)
    if (remembered) return clone(remembered)

    const recovered = await this.options.workspaceStore.recover(workspace.accountMid, workspace.id)
    if ('recovery' in recovered) throw new Error('Old favorite workspace requires rebuild.')
    if (recovered.recommendations.initialized) {
      this.recommendations.set(workspace.accountMid, clone(recovered.recommendations))
      return clone(recovered.recommendations)
    }

    const items: CurrentSegmentItem[] = []
    await this.options.workspaceStore.visitScanPages(workspace.accountMid, workspace.id, (page) => {
      items.push(...page.items)
    })
    const state = buildAuthorRecommendations(items)
    await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
      currentSegmentId: this.currentSegment(workspace), classifications: [], history: [], recommendations: state
    })
    this.recommendations.set(workspace.accountMid, clone(state))
    return clone(state)
  }

  private createSnapshot(workspace: OldFavoriteWorkspace): OldFavoriteWorkspaceSnapshot {
    const currentSegment = workspace.segments.find((segment) => segment.id === this.currentSegment(workspace))
    return {
      version: 1,
      accountMid: workspace.accountMid,
      workspaceId: workspace.id,
      status: workspace.status,
      mode: workspace.mode,
      segmentSize: workspace.segmentSize,
      hasMultipleSegments: workspace.hasMultipleSegments,
      scan: clone(this.scanOverviews.get(workspace.accountMid)?.scan ?? { phase: workspace.status === 'scanning' ? 'inventory' : 'complete', failureCount: 0, mode: workspace.mode }),
      ...(this.tagEnrichments.get(workspace.accountMid) ? {
        tagEnrichment: (() => {
          const enrichment = this.tagEnrichments.get(workspace.accountMid)!
          return {
            status: enrichment.status,
            totalItemCount: enrichment.totalItemCount,
            completedItemCount: enrichment.totalItemCount - enrichment.pendingAids.length,
            pendingItemCount: enrichment.pendingAids.length
          }
        })()
      } : {}),
      sourceFolders: clone(this.scanOverviews.get(workspace.accountMid)?.sourceFolders ?? []),
      continuationCount: workspace.continuationAids.length,
      segments: (this.segmentDescriptors.get(workspace.accountMid) ?? workspace.segments.map(({ id, index, aids }) => ({ id, index, itemCount: aids.length })))
        .map((segment) => ({
          id: segment.id,
          index: segment.index,
          status: (this.frozenSegments.get(workspace.accountMid)?.has(segment.id) ? 'frozen' : 'previewing') as 'previewing' | 'frozen',
          itemCount: segment.itemCount
        })),
      currentSegment: currentSegment ? {
        id: currentSegment.id,
        aids: [...currentSegment.aids],
        items: clone(this.currentSegmentItems.get(workspace.accountMid) ?? []).filter((item) => currentSegment.aids.includes(item.aid))
      } : null,
      classifications: Object.fromEntries(Object.entries(workspace.classifications).map(([aid, classification]) => [aid, {
        aid: classification.aid,
        targetLedgerIds: [...classification.targetLedgerIds],
        source: classification.source
      }])),
      recommendations: {
        candidates: (this.recommendations.get(workspace.accountMid)?.candidates ?? []).map(({ sourceName: _sourceName, keywords: _keywords, ...candidate }) => clone(candidate)),
        adoptedCandidateIds: [...(this.recommendations.get(workspace.accountMid)?.adoptedCandidateIds ?? [])]
      },
      planReadiness: (() => {
        const readiness = this.planReadiness.get(workspace.accountMid) ?? { selectedAidCount: 0, classifiedAidCount: 0 }
        return { ...readiness, unclassifiedAidCount: readiness.selectedAidCount - readiness.classifiedAidCount }
      })(),
      history: {
        cursor: workspace.historyCursor,
        length: workspace.history.length,
        entries: workspace.history.map((entry, index) => ({
          cursor: index + 1,
          source: entry.source,
          changeCount: entry.changes.length,
          targetLedgerIds: [...new Set(entry.changes.flatMap((change) => change.after?.targetLedgerIds ?? change.before?.targetLedgerIds ?? []))].sort()
        })).reverse()
      },
      ...(workspace.completionMode ? { completionMode: workspace.completionMode } : {})
    }
  }

  private async createSnapshotWithExecutionProgress(workspace: OldFavoriteWorkspace): Promise<OldFavoriteWorkspaceSnapshot> {
    const snapshot = this.createSnapshot(workspace)
    if (workspace.status !== 'executing' || !this.options.syncService) return snapshot
    try {
      const persisted = await this.options.repository.getSnapshot(workspace.accountMid)
      const plan = persisted.workspace?.frozenSyncPlan
      if (!plan || persisted.workspace?.status !== 'executing') return snapshot
      const run = await this.options.syncService.getRun(workspace.accountMid, plan.id)
      return {
        ...snapshot,
        executionProgress: {
          completedOperationCount: run.completedOperationCount,
          totalOperationCount: run.totalOperationCount
        }
      }
    } catch {
      return snapshot
    }
  }

  private now() {
    return this.options.now?.() ?? new Date().toISOString()
  }

  private matchesMarker(workspace: OldFavoriteWorkspace, marker: FavoriteRepositoryWorkspace) {
    return workspace.id === marker.id && marker.workspaceRef.workspaceId === marker.id &&
      workspace.accountMid === marker.accountMid &&
      workspace.status === marker.status && (workspace.baseline?.revision ?? 0) === marker.baselineRevision
  }

  private queue<T>(operation: () => Promise<T>) {
    const run = this.operationTail.then(operation, operation)
    this.operationTail = run.then(() => undefined, () => undefined)
    return run
  }
}
