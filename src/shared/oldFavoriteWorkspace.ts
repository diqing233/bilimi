import type { DeepSeekArchiveMode } from './types'

export const OLD_FAVORITE_WORKSPACE_VERSION = 1 as const
export const DEFAULT_OLD_FAVORITE_WORKSPACE_SEGMENT_SIZE = 2_000
export const RECOMMENDED_OLD_FAVORITE_WORKSPACE_SEGMENT_SIZE = 2_000
export const MIN_OLD_FAVORITE_WORKSPACE_SEGMENT_SIZE = 500
export const MAX_OLD_FAVORITE_WORKSPACE_SEGMENT_SIZE = 5_000
/** Experimental setting: keep the entire next round in one workspace segment. */
export const UNLIMITED_OLD_FAVORITE_WORKSPACE_SEGMENT_SIZE = Number.MAX_SAFE_INTEGER

export type OldFavoriteWorkspaceStatus = 'draft' | 'scanning' | 'previewing' | 'frozen' | 'executing' | 'reconciling' | 'completed'
export type OldFavoriteWorkspaceMode = 'incremental' | 'full'
export type OldFavoriteWorkspaceScope = { kind: 'account' } | { kind: 'selection'; aids: number[] }
export type OldFavoriteWorkspaceClassificationSource = 'manual' | 'fallback' | 'deepseek' | 'system-high' | 'system-low'
/**
 * Relationship to a locally known Bilimi rule. This is intentionally separate
 * from how a remote Bilibili folder is displayed and whether it can be scanned.
 */
export type OldFavoriteRemoteRelationship = 'none' | 'bound' | 'reconcile-required'

export type OldFavoriteWorkspaceLocalWorkspaceFolder = {
  id: string
  title: string
  kind: 'rule' | 'draft'
  relationship: OldFavoriteRemoteRelationship
  itemCount: number
}

type OldFavoriteRemoteSourceFolder = {
  isBilimiWorkFolder: boolean
  remoteRelationship?: OldFavoriteRemoteRelationship
  scanEligible?: boolean
}

/**
 * Old persisted workspaces only have `isBilimiWorkFolder`. Treat it as a
 * compatibility witness of a formal binding, never as a name-based inference.
 */
export function oldFavoriteRemoteRelationship(folder: OldFavoriteRemoteSourceFolder): OldFavoriteRemoteRelationship {
  if (folder.remoteRelationship === 'bound' || folder.remoteRelationship === 'reconcile-required' || folder.remoteRelationship === 'none') {
    return folder.remoteRelationship
  }
  return folder.isBilimiWorkFolder ? 'bound' : 'none'
}

export function oldFavoriteFolderIsScanEligible(folder: OldFavoriteRemoteSourceFolder): boolean {
  // A scan overview is a Bilibili fact table, not a local-rule chooser. Every
  // source folder in this domain has already been observed remotely, so local
  // binding/reconciliation state must never take away the user's source choice.
  void folder
  return true
}

export type OldFavoriteWorkspaceBaseline = {
  revision: number
  aids: number[]
}

export type OldFavoriteWorkspaceSegment = {
  id: string
  index: number
  aids: number[]
  status: 'previewing' | 'frozen'
}

export type OldFavoriteWorkspaceClassification = {
  aid: number
  targetLedgerIds: string[]
  source: OldFavoriteWorkspaceClassificationSource
}

export type OldFavoriteWorkspaceRecommendationCandidate = {
  id: string
  displayName: string
  /** Complete rule terms for projecting a selected recommendation into the editor. */
  keywords?: string[]
  kind: 'author' | 'series' | 'tag'
  count: number
  /** Number of matches in the currently selected batch; the full AID index stays main-process only. */
  currentSegmentCount?: number
  reason: string
}

export type OldFavoriteInventoryMetricProjection = {
  authority: 'complete' | 'incomplete'
  relationshipCount: number
  plannedAidCount: number
  protectedAidCount: number
  unavailableAidCount: number
  sourceFolders: Array<{
    id: string
    title: string
    relationshipCount: number
    plannedAidCount: number | null
    protectedAidCount: number | null
    unavailableAidCount: number | null
    selected: boolean
    /** Compatibility only. New grouping must use `remoteRelationship`. */
    isBilimiWorkFolder: boolean
    remoteRelationship?: OldFavoriteRemoteRelationship
    scanEligible?: boolean
    confirmed: boolean
  }>
}

export function projectOldFavoriteInventoryMetrics(input: {
  authority: 'complete' | 'incomplete'
  sourceFolders: Array<{
    id: string
    title: string
    itemCount: number
    isBilimiWorkFolder: boolean
    /** Name-shaped recovery candidate; no protection is implied. */
    isBilimiWorkFolderCandidate?: boolean
    remoteRelationship?: OldFavoriteRemoteRelationship
    scanEligible?: boolean
    selected?: boolean
    observationComplete?: boolean
  }>
  items: Array<{
    aid: number
    sourceFolderIds: string[]
    protected: boolean
    unavailable: boolean
  }>
}): OldFavoriteInventoryMetricProjection {
  const selectedSourceIds = new Set(input.sourceFolders
    .filter((folder) => oldFavoriteFolderIsScanEligible(folder) && folder.selected)
    .map((folder) => folder.id))
  const uniqueItems = new Map<number, typeof input.items[number]>()
  for (const item of input.items) {
    const existing = uniqueItems.get(item.aid)
    uniqueItems.set(item.aid, existing
      ? {
          ...existing,
          sourceFolderIds: [...new Set([...existing.sourceFolderIds, ...item.sourceFolderIds])],
          protected: existing.protected || item.protected,
          unavailable: existing.unavailable || item.unavailable
        }
      : { ...item, sourceFolderIds: [...new Set(item.sourceFolderIds)] })
  }
  const items = [...uniqueItems.values()]
  const unavailableAidCount = items.filter((item) => item.unavailable).length
  const protectedAidCount = items.filter((item) => !item.unavailable && item.protected).length
  const plannedAidCount = items.filter((item) => !item.unavailable && !item.protected &&
    item.sourceFolderIds.some((folderId) => selectedSourceIds.has(folderId))).length

  return {
    authority: input.authority,
    relationshipCount: input.sourceFolders.reduce((count, folder) => count + Math.max(0, folder.itemCount), 0),
    plannedAidCount,
    protectedAidCount,
    unavailableAidCount,
    sourceFolders: input.sourceFolders.map((folder) => {
      const confirmed = input.authority === 'complete' && folder.observationComplete !== false
      const folderItems = items.filter((item) => item.sourceFolderIds.includes(folder.id))
      const remoteRelationship = oldFavoriteRemoteRelationship(folder)
      const scanEligible = oldFavoriteFolderIsScanEligible(folder)
      return {
        id: folder.id,
        title: folder.title,
        relationshipCount: Math.max(0, folder.itemCount),
        plannedAidCount: confirmed
          ? folder.selected && scanEligible
            ? folderItems.filter((item) => !item.unavailable && !item.protected).length
            : 0
          : null,
        protectedAidCount: confirmed
          ? folderItems.filter((item) => !item.unavailable && item.protected).length
          : null,
        unavailableAidCount: confirmed
          ? folderItems.filter((item) => item.unavailable).length
          : null,
        selected: Boolean(folder.selected),
        isBilimiWorkFolder: folder.isBilimiWorkFolder,
        remoteRelationship,
        scanEligible,
        confirmed
      }
    })
  }
}

export type OldFavoriteWorkspaceHistoryChange = {
  aid: number
  before?: OldFavoriteWorkspaceClassification
  after?: OldFavoriteWorkspaceClassification
}

/** A main-process DeepSeek result that was actually evaluated for organization. */
export type OldFavoriteWorkspaceDeepSeekProcessedItem = {
  aid: number
  title?: string
  beforeTargetLedgerIds: string[]
  afterTargetLedgerIds: string[]
  changed: boolean
}

export type OldFavoriteWorkspaceHistoryEntry = {
  source: OldFavoriteWorkspaceClassificationSource
  changes: OldFavoriteWorkspaceHistoryChange[]
  /** Durable detail projection, including evaluated videos whose targets did not change. */
  deepSeekProcessedItems?: OldFavoriteWorkspaceDeepSeekProcessedItem[]
}

/** Durable outcome while an explicit tag-adoption command recomputes the draft. */
export type OldFavoriteWorkspaceTagAdoption = {
  status: 'recomputing' | 'failed'
  failureCode?: 'classification-recompute-failed'
  /** Development-only diagnostic retained for recovery; never rendered as user-facing text. */
  failureDetail?: string
}

export type OldFavoriteWorkspace = {
  version: typeof OLD_FAVORITE_WORKSPACE_VERSION
  id: string
  accountMid: string
  createdAt: string
  status: OldFavoriteWorkspaceStatus
  mode: OldFavoriteWorkspaceMode
  scope: OldFavoriteWorkspaceScope
  segmentSize: number
  baseline?: OldFavoriteWorkspaceBaseline
  baselineCompletedAids: number[]
  plannedAids: number[]
  protectedAids: number[]
  continuationAids: number[]
  hasMultipleSegments: boolean
  segments: OldFavoriteWorkspaceSegment[]
  classifications: Record<string, OldFavoriteWorkspaceClassification>
  /** Preserved DeepSeek choices whose dependency evidence changed after recovery. */
  staleDeepSeekAids?: number[]
  history: OldFavoriteWorkspaceHistoryEntry[]
  historyCursor: number
  /** Cursor after scan-generated automatic classification; earlier entries are not user edits. */
  historyBaselineCursor?: number
  completionMode?: 'bilibili' | 'local'
}

export type OldFavoriteWorkspaceSnapshot = {
  version: 1
  accountMid: string
  workspaceId: string
  status: OldFavoriteWorkspaceStatus
  mode: OldFavoriteWorkspaceMode
  scope?: OldFavoriteWorkspaceScope
  segmentSize: number
  hasMultipleSegments: boolean
  scan: {
    phase: 'inventory' | 'failed' | 'complete'
    failureCount: number
    paused?: boolean
    reason?: string
    retryAvailableAt?: string
    totalItemCount?: number
    scannedItemCount?: number
    taggedItemCount?: number
    untaggedItemCount?: number
  }
  inventoryMetrics?: OldFavoriteInventoryMetricProjection
  currentSegmentMetrics?: {
    plannedAidCount: number
    sourceFolders: Array<{ id: string; plannedAidCount: number }>
  }
  tagEnrichment?: {
    status: 'running' | 'paused' | 'accepted' | 'complete'
    totalItemCount: number
    completedItemCount: number
    pendingItemCount: number
    failedItemCount: number
    reusedTagItemCount?: number
    fetchedTagItemCount?: number
    confirmedUntaggedItemCount?: number
    /** Every scanned batch has an unchanged, user-adopted tag cutoff for complete-round execution. */
    wholeRunTagCutoffAccepted?: boolean
    currentSegmentCanContinueTagEnrichment?: boolean
    currentSegmentHasUnacceptedTagChanges?: boolean
    scopes?: {
      currentSegment: OldFavoriteTagScopeStatistics
      wholeRun: OldFavoriteTagScopeStatistics
    }
  }
  tagAdoption?: OldFavoriteWorkspaceTagAdoption
  deepSeekRun?: {
    mode: DeepSeekArchiveMode
    scope: 'all'
    status: 'running' | 'waiting' | 'failed' | 'canceled' | 'paused' | 'completed'
    completedSegmentCount: number
    waitingSegmentCount: number
    totalVideoCount?: number
    /** Per-batch candidate counts from the authoritative DeepSeek work plan, when available. */
    candidateVideoCountBySegment?: Record<string, number>
    successfulVideoCount?: number
    pendingVideoCount?: number
    failedVideoCount?: number
  }
  deepSeekOrganization?: {
    segments: Array<{
      id: string
      index: number
      status: 'organized' | 'partial' | 'unorganized'
      details: OldFavoriteWorkspaceDeepSeekProcessedItem[]
    }>
  }
  executionIntent?: {
    mode: 'local' | 'bilibili'
    includeInbox?: boolean
    status: 'waiting' | 'running' | 'blocked'
    failureCode?: OldFavoriteWorkspaceExecutionFailureCode
    /** Development-only diagnostic retained with a blocked intent; never rendered as user-facing text. */
    failureDetail?: string
    waitingSegmentCount: number
    waitingForDeepSeek: boolean
  }
  sourceFolders: Array<{
    id: string
    title: string
    itemCount: number
    invalidItemCount?: number
    /** Compatibility only. New grouping must use `remoteRelationship`. */
    isBilimiWorkFolder: boolean
    remoteRelationship?: OldFavoriteRemoteRelationship
    scanEligible?: boolean
    selected?: boolean
  }>
  /** Local Bilimi rules and drafts; never a second list of Bilibili folders. */
  localWorkspaceFolders?: OldFavoriteWorkspaceLocalWorkspaceFolder[]
  continuationCount: number
  protectedAidCount?: number
  segments: Array<{
    id: string
    index: number
    status: 'previewing' | 'frozen'
    itemCount: number
    readiness: 'waiting' | 'tagging' | 'ready' | 'saved'
    completedTagItemCount: number
    pendingTagItemCount: number
  }>
  currentSegment: {
    id: string
    aids: number[]
    items: Array<{
      aid: number
      title?: string
      author?: string
      description?: string
      tags?: string[]
      category?: string
      cover?: string
      addedAt?: number
      unavailable?: boolean
      sourceFolderIds: string[]
    }>
  } | null
  overview?: {
    completedSegmentCount: number
    totalSegmentCount: number
    available: boolean
    sourceFolders: Array<{ id: string; title: string; itemCount: number; invalidItemCount: number }>
    unavailableItemCount: number
    processedItemCount: number
    classifiedItemCount: number
    unmatchedItemCount: number
    deepSeekPendingItemCount?: number
    waitingTagItemCount?: number
    savedItemCount?: number
    waitingItemCount: number
    recommendationCounts: Array<{ id: string; count: number }>
    archiveTargets: Array<{
      ledgerId: string
      itemCount: number
      segmentCounts: Array<{ segmentId: string; count: number }>
    }>
  }
  classifications: Record<string, OldFavoriteWorkspaceClassification>
  /** Initial automatic targets for classifications that still differ from the durable baseline. */
  originalTargetLedgerIdsByAid?: Record<string, string[]>
  recommendations: {
    candidates: OldFavoriteWorkspaceRecommendationCandidate[]
    adoptedCandidateIds: string[]
  }
  planReadiness?: {
    selectedAidCount: number
    classifiedAidCount: number
    unclassifiedAidCount: number
  }
  executionProgress?: {
    completedOperationCount: number
    totalOperationCount: number
    /** User explicitly paused after Bilibili execution began; the frozen plan is resumable. */
    syncPaused?: boolean
    lastFailureReason?: string
    retryAvailableAt?: string
  }
  history: {
    cursor: number
    length: number
    baselineCursor?: number
    entries: Array<{
      cursor: number
      source: OldFavoriteWorkspaceClassificationSource
      changeCount: number
      targetLedgerIds: string[]
      /** Compact renderer projection; optional only for stale in-memory snapshots during development reloads. */
      summary?: {
        title?: string
        beforeTargetLedgerIds: string[]
        afterTargetLedgerIds: string[]
        reason: string
        movedCount: number
        details?: Array<{
          aid: number
          title?: string
          beforeTargetLedgerIds: string[]
          afterTargetLedgerIds: string[]
        }>
      }
    }>
  }
  completionMode?: 'bilibili' | 'local'
}

export type OldFavoriteWorkspaceRecoveryRequired = {
  recovery: 'rebuild-required'
  preserveCompletedLocalResults: true
  accountMid: string
  workspaceId: string
}

export type OldFavoriteTagScopeStatistics = {
  totalItemCount: number
  completedItemCount: number
  pendingItemCount: number
  failedItemCount: number
  reusedTagItemCount: number
  fetchedTagItemCount: number
  confirmedUntaggedItemCount: number
}

/** A compact, manifest/marker-only recovery entry point. It never resumes work. */
export type OldFavoriteWorkspaceRecoveryChoice =
  | 'view'
  /** The only normal user-facing recovery action. */
  | 'recover-draft'
  /** Legacy internal decision values retained for persisted recovery records. */
  | 'continue-original'
  | 'merge-latest'
  | 'rescan'
  | 'abandon'
  | 'reconcile-result-unknown'

/**
 * Evidence available without loading the workspace's baseline pages or replaying
 * its journal. The repository revision is intentionally account-scoped.
 */
export type OldFavoriteWorkspaceBaselineChangeEvidence = {
  scope: 'account'
  workspaceBaselineRevision: number
  repositoryRevision: number
  changed: boolean
  direction: 'unchanged' | 'advanced' | 'regressed'
  /** Any later merge must preserve manual choices; it cannot silently replace them. */
  manualClassificationsRemainAuthoritative: true
  /** Dimensions which differ from the durable workspace baseline. */
  changedDimensions: Array<'aid-revisions' | 'mirror' | 'bindings' | 'metadata' | 'rules' | 'keywords' | 'default-settings'>
  /** DeepSeek choices remain intact but may need explicit review after dependent inputs change. */
  deepSeekClassificationsMayBeStale?: boolean
  fingerprint?: string
}

export type OldFavoriteWorkspaceRecoveryDecision = {
  workspaceId: string
  choice: 'continue-original' | 'merge-latest' | 'rescan'
  expectedBaselineRevision: number
  expectedRepositoryRevision: number
}

/** Explicit acknowledgement only: it never resumes, rescans, or mutates a workspace. */
export type OldFavoriteWorkspaceRecoveryDecisionResult = {
  accountMid: string
  workspaceId: string
  choice: OldFavoriteWorkspaceRecoveryDecision['choice']
  manualClassificationsRemainAuthoritative: true
  requiresFullWorkspaceLoad: boolean
  requiresExplicitScan: boolean
}

export type OldFavoriteWorkspaceRecoverySummary = {
  accountMid: string
  workspaceId: string
  status: OldFavoriteWorkspaceStatus | 'rebuild-required'
  currentSegmentId?: string
  currentStep: OldFavoriteWorkspaceStatus | 'sync-paused' | 'confirmation' | 'result-unknown' | 'rebuild-required'
  plannedCount?: number
  classifiedCount?: number
  unclassifiedCount?: number
  manifestChecksum?: string
  lastCommittedId?: string
  baselineChangeEvidence: OldFavoriteWorkspaceBaselineChangeEvidence
  recoveryChoices: OldFavoriteWorkspaceRecoveryChoice[]
  resultUnknownEvidence?: { operationCount: number; planId?: string }
}

export type OldFavoriteWorkspaceView = OldFavoriteWorkspaceSnapshot | OldFavoriteWorkspaceRecoveryRequired | null

export type OldFavoriteWorkspaceDeepSeekFailure = {
  chunkIndex: number
  aids: number[]
  affectedVideoCount: number
  message: string
  category?: 'timeout' | 'rate-limit' | 'server' | 'network' | 'invalid' | 'unavailable' | 'incomplete' | 'workspace-conflict'
}

export type OldFavoriteWorkspaceDeepSeekRequestGroup = {
  id: string
  segmentId: string
  aids: number[]
  status: 'pending' | 'successful' | 'failed' | 'split'
  timeoutCount: number
  parentId?: string
  failureCategory?: OldFavoriteWorkspaceDeepSeekFailure['category']
}

export type OldFavoriteWorkspaceDeepSeekRunCheckpoint = {
  /** Legacy checkpoints are upgraded when the next run claims them. */
  version?: 1
  workspaceId: string
  mode: DeepSeekArchiveMode
  scope: 'all'
  sourceFolderRevision?: string
  segmentWork?: Array<{ segmentId: string; index: number; aids: number[] }>
  totalVideoCount?: number
  originalTargetLedgerIdsByAid?: Record<string, string[]>
  requestGroups?: OldFavoriteWorkspaceDeepSeekRequestGroup[]
  successfulAids?: number[]
  pendingAids?: number[]
  failedAids?: number[]
  completedSegmentIds: string[]
  waitingSegmentIds: string[]
  canceled: boolean
  /** A recovery-entry pause keeps durable progress but never auto-resumes it. */
  paused?: boolean
  failed?: boolean
}

export type OldFavoriteWorkspaceExecutionFailureCode =
  | 'deepseek-unresolved'
  | 'tag-cutoff-changed'
  | 'remote-inventory-unavailable'
  | 'saved-binding-absent'
  | 'saved-binding-title-mismatch'
  | 'binding-requires-rebind'
  | 'remote-account-mismatch'
  | 'remote-folder-limit'
  | 'remote-shard-capacity'
  | 'bilibili-sync-prepare-failed'

export type OldFavoriteWorkspaceExecutionIntent = {
  workspaceId: string
  mode: 'local' | 'bilibili'
  includeInbox?: boolean
  status: 'waiting' | 'running' | 'blocked'
  /** A durable, user-safe explanation for an automatic whole-run failure. */
  failureCode?: OldFavoriteWorkspaceExecutionFailureCode
  /** Development-only diagnostic retained with a blocked intent; never rendered as user-facing text. */
  failureDetail?: string
}

export type OldFavoriteWorkspaceDeepSeekResult = {
  snapshot: OldFavoriteWorkspaceSnapshot
  /** Cancellation waits for the in-flight request, then applies only completed batches. */
  canceled?: boolean
  /** Unsaved batches skipped because their tags are not ready yet. */
  deferredSegmentCount?: number
  /** Enabled DeepSeek-constraint ledgers sent with this archive organization request. */
  referencedConstraintLedgerNames: string[]
  progress: {
    totalChunks: number
    completedChunks: number
    totalVideoCount: number
    successfulVideoCount: number
    failedVideoCount: number
    /** Trusted main-process results for request groups that have already settled. */
    processedItems?: OldFavoriteWorkspaceDeepSeekProcessedItem[]
  }
  failures: OldFavoriteWorkspaceDeepSeekFailure[]
}

export type CreateOldFavoriteWorkspaceOptions = {
  accountMid: string
  now: string
  id?: string
  segmentSize?: number
  scope?: OldFavoriteWorkspaceScope
}

export type CompleteWorkspaceScanOptions = {
  revision: number
  aids: number[]
  successfullyClassifiedAids?: number[]
  mode?: OldFavoriteWorkspaceMode
  /** Durable discovery-order assignments sealed while the remote scan was still running. */
  sealedSegments?: Array<Pick<OldFavoriteWorkspaceSegment, 'id' | 'index' | 'aids'>>
}

export type WorkspaceClassificationAssignment = {
  aid: number
  targetLedgerIds: string[]
}

export type ApplyWorkspaceClassificationBatchOptions = {
  source: OldFavoriteWorkspaceClassificationSource
  assignments: WorkspaceClassificationAssignment[]
  replaceExistingSystem?: boolean
}

function normalizeAccountMid(value: string) {
  const normalized = value.trim()
  if (!/^\d+$/.test(normalized) || BigInt(normalized) === 0n) {
    throw new Error('Old favorite workspace account is invalid.')
  }
  return BigInt(normalized).toString()
}

function normalizeTimestamp(value: string) {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) throw new Error('Old favorite workspace timestamp is invalid.')
  return new Date(timestamp).toISOString()
}

function normalizeAids(aids: number[]) {
  return [...new Set(aids.filter((aid) => Number.isSafeInteger(aid) && aid > 0))]
    .sort((left, right) => left - right)
}

export function isValidOldFavoriteWorkspaceSegmentSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) &&
    value >= MIN_OLD_FAVORITE_WORKSPACE_SEGMENT_SIZE &&
    (value <= MAX_OLD_FAVORITE_WORKSPACE_SEGMENT_SIZE ||
      value === UNLIMITED_OLD_FAVORITE_WORKSPACE_SEGMENT_SIZE)
}

function normalizeSegmentSize(value: number | undefined) {
  if (value === undefined) return DEFAULT_OLD_FAVORITE_WORKSPACE_SEGMENT_SIZE
  if (!isValidOldFavoriteWorkspaceSegmentSize(value)) {
    throw new Error('Old favorite workspace segment size is invalid.')
  }
  return value
}

export function normalizeOldFavoriteWorkspaceSegmentSize(value: unknown) {
  return isValidOldFavoriteWorkspaceSegmentSize(value)
    ? value
    : RECOMMENDED_OLD_FAVORITE_WORKSPACE_SEGMENT_SIZE
}

function createSegments(aids: number[], segmentSize: number): OldFavoriteWorkspaceSegment[] {
  const segments: OldFavoriteWorkspaceSegment[] = []
  for (let offset = 0; offset < aids.length; offset += segmentSize) {
    const index = segments.length
    segments.push({
      id: `segment-${index + 1}`,
      index,
      aids: aids.slice(offset, offset + segmentSize),
      status: 'previewing'
    })
  }
  return segments
}

function cloneClassification(value: OldFavoriteWorkspaceClassification | undefined) {
  return value && { ...value, targetLedgerIds: [...value.targetLedgerIds] }
}

function cloneHistoryChange(change: OldFavoriteWorkspaceHistoryChange): OldFavoriteWorkspaceHistoryChange {
  return {
    aid: change.aid,
    ...(change.before ? { before: cloneClassification(change.before) } : {}),
    ...(change.after ? { after: cloneClassification(change.after) } : {})
  }
}

function normalizeLedgerIds(ledgerIds: string[]) {
  if (!Array.isArray(ledgerIds)) throw new Error('Old favorite workspace classification is invalid.')
  return [...new Set(ledgerIds.map((ledgerId) => {
    if (typeof ledgerId !== 'string') throw new Error('Old favorite workspace classification is invalid.')
    return ledgerId.trim()
  }).filter(Boolean))].sort()
}

function isClassificationEqual(
  left: OldFavoriteWorkspaceClassification | undefined,
  right: OldFavoriteWorkspaceClassification | undefined
) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function segmentForAid(workspace: OldFavoriteWorkspace, aid: number) {
  return workspace.segments.find((segment) => segment.aids.includes(aid))
}

function withSegmentsForMode(
  workspace: OldFavoriteWorkspace,
  mode: OldFavoriteWorkspaceMode
): Pick<OldFavoriteWorkspace, 'mode' | 'plannedAids' | 'protectedAids' | 'segments' | 'hasMultipleSegments'> {
  const baselineAids = workspace.baseline?.aids ?? []
  const completedAids = workspace.baselineCompletedAids ?? []
  const protectedAids = mode === 'incremental' ? completedAids : []
  const protectedSet = new Set(protectedAids)
  const plannedAids = baselineAids.filter((aid) => !protectedSet.has(aid))
  const segments = createSegments(plannedAids, workspace.segmentSize)
  return {
    mode,
    plannedAids,
    protectedAids,
    segments,
    hasMultipleSegments: segments.length > 1
  }
}

export function createOldFavoriteWorkspace(options: CreateOldFavoriteWorkspaceOptions): OldFavoriteWorkspace {
  const accountMid = normalizeAccountMid(options.accountMid)
  const createdAt = normalizeTimestamp(options.now)
  const segmentSize = normalizeSegmentSize(options.segmentSize)
  return {
    version: OLD_FAVORITE_WORKSPACE_VERSION,
    id: options.id?.trim() || `old-favorite-workspace:${accountMid}:${createdAt.replace(/[^0-9]/g, '')}`,
    accountMid,
    createdAt,
    status: 'scanning',
    mode: 'incremental',
    scope: options.scope?.kind === 'selection'
      ? { kind: 'selection', aids: normalizeAids(options.scope.aids) }
      : { kind: 'account' },
    segmentSize,
    baselineCompletedAids: [],
    plannedAids: [],
    protectedAids: [],
    continuationAids: [],
    hasMultipleSegments: false,
    segments: [],
    classifications: {},
    history: [],
    historyCursor: 0
  }
}

export function completeWorkspaceScan(
  workspace: OldFavoriteWorkspace,
  options: CompleteWorkspaceScanOptions
): OldFavoriteWorkspace {
  if (workspace.status !== 'scanning') {
    throw new Error('Old favorite workspace scan is already complete.')
  }
  if (!Number.isSafeInteger(options.revision) || options.revision < 0) {
    throw new Error('Old favorite workspace baseline revision is invalid.')
  }

  const baseline = { revision: options.revision, aids: normalizeAids(options.aids) }
  const baselineAidSet = new Set(baseline.aids)
  const baselineCompletedAids = normalizeAids(options.successfullyClassifiedAids ?? [])
    .filter((aid) => baselineAidSet.has(aid))
  const scanned: OldFavoriteWorkspace = {
    ...workspace,
    status: 'previewing',
    mode: options.mode ?? 'incremental',
    baseline,
    baselineCompletedAids,
    plannedAids: [],
    protectedAids: [],
    continuationAids: [],
    hasMultipleSegments: false,
    segments: [],
    classifications: {},
    history: [],
    historyCursor: 0
  }
  const projected = withSegmentsForMode(scanned, scanned.mode)
  if (!options.sealedSegments?.length) return { ...scanned, ...projected }
  const plannedAidSet = new Set(projected.plannedAids)
  const assignedAids = new Set<number>()
  const segments = options.sealedSegments
    .slice()
    .sort((left, right) => left.index - right.index)
    .map((segment, index): OldFavoriteWorkspaceSegment => {
      if (segment.index !== index || segment.id !== `segment-${index + 1}` || !Array.isArray(segment.aids)) {
        throw new Error('Old favorite workspace streaming segments are invalid.')
      }
      const aids = segment.aids.map((aid) => {
        if (!plannedAidSet.has(aid) || assignedAids.has(aid)) {
          throw new Error('Old favorite workspace streaming segments are invalid.')
        }
        assignedAids.add(aid)
        return aid
      })
      if (!aids.length || aids.length > workspace.segmentSize) {
        throw new Error('Old favorite workspace streaming segments are invalid.')
      }
      return { id: segment.id, index, aids, status: 'previewing' }
    })
  if (assignedAids.size !== plannedAidSet.size) {
    throw new Error('Old favorite workspace streaming segments are incomplete.')
  }
  return { ...scanned, ...projected, segments, hasMultipleSegments: segments.length > 1 }
}

export function setWorkspaceReorganizationMode(
  workspace: OldFavoriteWorkspace,
  mode: OldFavoriteWorkspaceMode
): OldFavoriteWorkspace {
  if (workspace.status !== 'previewing' || workspace.segments.some((segment) => segment.status === 'frozen')) {
    throw new Error('Old favorite workspace plan is frozen.')
  }
  if (mode !== 'incremental' && mode !== 'full') {
    throw new Error('Old favorite workspace mode is invalid.')
  }
  const projected = withSegmentsForMode(workspace, mode)
  return {
    ...workspace,
    ...projected,
    classifications: {},
    history: [],
    historyCursor: 0
  }
}

export function freezeWorkspaceSegment(workspace: OldFavoriteWorkspace, segmentId: string): OldFavoriteWorkspace {
  if (workspace.status !== 'previewing') {
    throw new Error('Old favorite workspace is not previewing.')
  }
  const segment = workspace.segments.find((candidate) => candidate.id === segmentId)
  if (!segment) throw new Error('Old favorite workspace segment is invalid.')
  if (segment.status === 'frozen') return workspace

  const segments = workspace.segments.map((candidate) => candidate.id === segmentId
    ? { ...candidate, status: 'frozen' as const }
    : candidate)
  return {
    ...workspace,
    status: segments.every((candidate) => candidate.status === 'frozen') ? 'frozen' : 'previewing',
    segments
  }
}

export function recordDiscoveredFavorites(workspace: OldFavoriteWorkspace, discoveredAids: number[]): OldFavoriteWorkspace {
  if (!workspace.baseline) throw new Error('Old favorite workspace scan is incomplete.')
  if (!workspace.segments.some((segment) => segment.status === 'frozen')) return workspace
  const knownAids = new Set([...workspace.baseline.aids, ...workspace.continuationAids])
  const additions = normalizeAids(discoveredAids).filter((aid) => !knownAids.has(aid))
  if (!additions.length) return workspace
  return { ...workspace, continuationAids: [...workspace.continuationAids, ...additions] }
}

export function applyWorkspaceClassificationBatch(
  workspace: OldFavoriteWorkspace,
  options: ApplyWorkspaceClassificationBatchOptions
): OldFavoriteWorkspace {
  if (workspace.status !== 'previewing' && workspace.status !== 'frozen') {
    throw new Error('Old favorite workspace is frozen.')
  }
  if (!['manual', 'fallback', 'deepseek', 'system-high', 'system-low'].includes(options.source) || !Array.isArray(options.assignments)) {
    throw new Error('Old favorite workspace classification is invalid.')
  }

  const assignments = new Map<number, OldFavoriteWorkspaceClassification>()
  for (const assignment of options.assignments) {
    if (!assignment || !Number.isSafeInteger(assignment.aid) || assignment.aid <= 0) {
      throw new Error('Old favorite workspace classification is invalid.')
    }
    const segment = segmentForAid(workspace, assignment.aid)
    if (!segment) throw new Error('Old favorite workspace aid is not in the active plan.')
    const targetLedgerIds = normalizeLedgerIds(assignment.targetLedgerIds)
    if (options.source === 'system-low' && targetLedgerIds.length > 1) {
      throw new Error('Old favorite workspace low-confidence classification cannot target multiple ledgers.')
    }
    assignments.set(assignment.aid, {
      aid: assignment.aid,
      targetLedgerIds,
      source: options.source
    })
  }

  const changes = [...assignments.values()]
    .sort((left, right) => left.aid - right.aid)
    .map((after) => {
      const before = cloneClassification(workspace.classifications[String(after.aid)])
      return { aid: after.aid, before, after: cloneClassification(after) }
    })
    .filter((change) => !isClassificationEqual(change.before, change.after))
  if (!changes.length) return workspace

  const classifications = { ...workspace.classifications }
  for (const change of changes) {
    if (change.after) classifications[String(change.aid)] = change.after
  }
  const history = [...workspace.history.slice(0, workspace.historyCursor), {
    source: options.source,
    changes: changes.map(cloneHistoryChange)
  }]
  const changedSegmentIds = new Set(changes.map((change) => segmentForAid(workspace, change.aid)?.id).filter((id): id is string => Boolean(id)))
  const segments = workspace.segments.map((segment) => changedSegmentIds.has(segment.id)
    ? { ...segment, status: 'previewing' as const }
    : segment)
  return {
    ...workspace,
    status: 'previewing',
    segments,
    classifications,
    history,
    historyCursor: history.length
  }
}

export function undoWorkspaceChange(workspace: OldFavoriteWorkspace): OldFavoriteWorkspace {
  if (workspace.segments.some((segment) => segment.status === 'frozen')) {
    throw new Error('Old favorite workspace plan is frozen.')
  }
  if (workspace.historyCursor === 0) return workspace
  const entry = workspace.history[workspace.historyCursor - 1]
  const classifications = { ...workspace.classifications }
  for (const change of entry.changes) {
    if (change.before) classifications[String(change.aid)] = cloneClassification(change.before)!
    else delete classifications[String(change.aid)]
  }
  return { ...workspace, classifications, historyCursor: workspace.historyCursor - 1 }
}

export function redoWorkspaceChange(workspace: OldFavoriteWorkspace): OldFavoriteWorkspace {
  if (workspace.segments.some((segment) => segment.status === 'frozen')) {
    throw new Error('Old favorite workspace plan is frozen.')
  }
  if (workspace.historyCursor >= workspace.history.length) return workspace
  const entry = workspace.history[workspace.historyCursor]
  const classifications = { ...workspace.classifications }
  for (const change of entry.changes) {
    if (change.after) classifications[String(change.aid)] = cloneClassification(change.after)!
    else delete classifications[String(change.aid)]
  }
  return { ...workspace, classifications, historyCursor: workspace.historyCursor + 1 }
}
