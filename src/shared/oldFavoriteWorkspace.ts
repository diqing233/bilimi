export const OLD_FAVORITE_WORKSPACE_VERSION = 1 as const
export const DEFAULT_OLD_FAVORITE_WORKSPACE_SEGMENT_SIZE = 2_000
export const RECOMMENDED_OLD_FAVORITE_WORKSPACE_SEGMENT_SIZE = 1_000
export const MIN_OLD_FAVORITE_WORKSPACE_SEGMENT_SIZE = 500
export const MAX_OLD_FAVORITE_WORKSPACE_SEGMENT_SIZE = 2_000

export type OldFavoriteWorkspaceStatus = 'draft' | 'scanning' | 'previewing' | 'frozen' | 'executing' | 'reconciling' | 'completed'
export type OldFavoriteWorkspaceMode = 'incremental' | 'full'
export type OldFavoriteWorkspaceScope = { kind: 'account' } | { kind: 'selection'; aids: number[] }
export type OldFavoriteWorkspaceClassificationSource = 'manual' | 'deepseek' | 'system-high' | 'system-low'

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
  kind: 'author' | 'series' | 'tag'
  count: number
  /** Number of matches in the currently selected batch; the full AID index stays main-process only. */
  currentSegmentCount?: number
  reason: string
}

export type OldFavoriteWorkspaceHistoryChange = {
  aid: number
  before?: OldFavoriteWorkspaceClassification
  after?: OldFavoriteWorkspaceClassification
}

export type OldFavoriteWorkspaceHistoryEntry = {
  source: OldFavoriteWorkspaceClassificationSource
  changes: OldFavoriteWorkspaceHistoryChange[]
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
    reason?: string
    totalItemCount?: number
    scannedItemCount?: number
    taggedItemCount?: number
    untaggedItemCount?: number
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
  }
  sourceFolders: Array<{
    id: string
    title: string
    itemCount: number
    invalidItemCount?: number
    isBilimiWorkFolder: boolean
    selected?: boolean
  }>
  continuationCount: number
  protectedAidCount?: number
  segments: Array<{
    id: string
    index: number
    status: 'previewing' | 'frozen'
    itemCount: number
    readiness: 'tagging' | 'ready' | 'saved'
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
  classifications: Record<string, OldFavoriteWorkspaceClassification>
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

/** A compact, manifest/marker-only recovery entry point. It never resumes work. */
export type OldFavoriteWorkspaceRecoveryChoice =
  | 'view'
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
  currentStep: OldFavoriteWorkspaceStatus | 'confirmation' | 'result-unknown' | 'rebuild-required'
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
}

/** A main-process DeepSeek run may apply completed chunks while retaining failed chunks for retry. */
export type OldFavoriteWorkspaceDeepSeekResult = {
  snapshot: OldFavoriteWorkspaceSnapshot
  /** Cancellation waits for the in-flight request, then applies only completed batches. */
  canceled?: boolean
  /** Enabled DeepSeek-constraint ledgers sent with this archive organization request. */
  referencedConstraintLedgerNames: string[]
  progress: {
    totalChunks: number
    completedChunks: number
    totalVideoCount: number
    successfulVideoCount: number
    failedVideoCount: number
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

function normalizeSegmentSize(value: number | undefined) {
  if (value === undefined) return DEFAULT_OLD_FAVORITE_WORKSPACE_SEGMENT_SIZE
  if (!Number.isSafeInteger(value) || value < MIN_OLD_FAVORITE_WORKSPACE_SEGMENT_SIZE || value > MAX_OLD_FAVORITE_WORKSPACE_SEGMENT_SIZE) {
    throw new Error('Old favorite workspace segment size is invalid.')
  }
  return value
}

export function normalizeOldFavoriteWorkspaceSegmentSize(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) &&
    value >= MIN_OLD_FAVORITE_WORKSPACE_SEGMENT_SIZE && value <= MAX_OLD_FAVORITE_WORKSPACE_SEGMENT_SIZE
    ? value
    : RECOMMENDED_OLD_FAVORITE_WORKSPACE_SEGMENT_SIZE
}

function createSegments(aids: number[], segmentSize: number): OldFavoriteWorkspaceSegment[] {
  const effectiveSegmentSize = Math.min(segmentSize, MAX_OLD_FAVORITE_WORKSPACE_SEGMENT_SIZE)
  const segments: OldFavoriteWorkspaceSegment[] = []
  for (let offset = 0; offset < aids.length; offset += effectiveSegmentSize) {
    const index = segments.length
    segments.push({
      id: `segment-${index + 1}`,
      index,
      aids: aids.slice(offset, offset + effectiveSegmentSize),
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

function classificationPriority(source: OldFavoriteWorkspaceClassificationSource) {
  return { 'system-low': 0, 'system-high': 1, deepseek: 2, manual: 3 }[source]
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
  return { ...scanned, ...projected }
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
  if (workspace.status !== 'previewing') {
    throw new Error('Old favorite workspace is frozen.')
  }
  if (!['manual', 'deepseek', 'system-high', 'system-low'].includes(options.source) || !Array.isArray(options.assignments)) {
    throw new Error('Old favorite workspace classification is invalid.')
  }

  const assignments = new Map<number, OldFavoriteWorkspaceClassification>()
  for (const assignment of options.assignments) {
    if (!assignment || !Number.isSafeInteger(assignment.aid) || assignment.aid <= 0) {
      throw new Error('Old favorite workspace classification is invalid.')
    }
    const segment = segmentForAid(workspace, assignment.aid)
    if (!segment) throw new Error('Old favorite workspace aid is not in the active plan.')
    if (segment.status === 'frozen') throw new Error('Old favorite workspace segment is frozen.')
    const targetLedgerIds = normalizeLedgerIds(assignment.targetLedgerIds)
    if (options.source === 'system-low' && targetLedgerIds.length > 1) {
      throw new Error('Old favorite workspace low-confidence classification cannot target multiple ledgers.')
    }
    const existing = workspace.classifications[String(assignment.aid)]
    if (existing && classificationPriority(existing.source) > classificationPriority(options.source) &&
      !(options.replaceExistingSystem && existing.source.startsWith('system-') && options.source.startsWith('system-'))) {
      continue
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
  return { ...workspace, classifications, history, historyCursor: history.length }
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
