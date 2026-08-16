import { createHash, randomUUID } from 'node:crypto'
import {
  applyWorkspaceClassificationBatch,
  completeWorkspaceScan,
  createOldFavoriteWorkspace,
  freezeWorkspaceSegment,
  oldFavoriteFolderIsScanEligible,
  oldFavoriteRemoteRelationship,
  projectOldFavoriteInventoryMetrics,
  recordDiscoveredFavorites,
  redoWorkspaceChange,
  undoWorkspaceChange,
  type ApplyWorkspaceClassificationBatchOptions,
  type CompleteWorkspaceScanOptions,
  type OldFavoriteWorkspace,
  type OldFavoriteInventoryMetricProjection,
  type OldFavoriteWorkspaceClassificationSource,
  type OldFavoriteWorkspaceDeepSeekProcessedItem,
  type OldFavoriteWorkspaceDeepSeekProcessedItem,
  type OldFavoriteWorkspaceExecutionFailureCode,
  type OldFavoriteWorkspaceDeepSeekRunCheckpoint,
  type OldFavoriteWorkspaceExecutionIntent,
  type OldFavoriteWorkspaceHistoryEntry,
  type OldFavoriteWorkspaceLocalWorkspaceFolder,
  type OldFavoriteRemoteRelationship,
  type OldFavoriteWorkspaceScope,
  type OldFavoriteWorkspaceRecoveryDecision,
  type OldFavoriteWorkspaceRecoveryDecisionResult,
  type OldFavoriteWorkspaceRecoverySummary,
  type OldFavoriteWorkspaceRecoveryRequired,
  type OldFavoriteWorkspaceSnapshot
} from '../../src/shared/oldFavoriteWorkspace'
import { MAX_OLD_FAVORITE_WORKSPACE_SEGMENT_SIZE } from '../../src/shared/oldFavoriteWorkspace'
import {
  isFavoriteRepositoryMetadataStale,
  isFavoriteRepositoryScanVisible,
  type FavoriteRepositoryClassificationSource,
  type FavoriteRepositoryVideo,
  type FavoriteRepositoryWorkspace
} from '../../src/shared/favoriteRepository'
import {
  BILIMI_LEDGER_PREFIX,
  createDefaultFavoriteLedgers,
  createRecommendedFavoriteLedgerId,
  createRecommendedFavoriteLedgerNamesForKind,
  disambiguateRecommendedFavoriteLedgerNames
} from '../../src/shared/favoriteLedgers'
import type { FavoriteLedger } from '../../src/shared/types'
import { compileFrozenFavoriteSyncPlan } from '../../src/shared/favoriteRepositoryExecutionPlan'
import { FavoriteRepositoryService } from './favoriteRepositoryService'
import type { FavoriteRepositorySyncRun, FavoriteRepositorySyncService } from './favoriteRepositorySyncService'
import type { FavoriteRepositoryBindingService } from './favoriteRepositoryBindingService'
import { OldFavoriteWorkspaceStore } from './oldFavoriteWorkspaceStore'
import { analyzeOldFavoriteLedgerRule } from './oldFavoriteLedgerRuleAnalysis'

const JOURNAL_EVENT_PREFIX = 'bilimi-old-favorite-workspace:v1:'

type SegmentDescriptor = { id: string; index: number; itemCount: number }
type StreamingScanRuntime = {
  segmentSize: number
  sealedSegments: Array<{ id: string; index: number; aids: number[] }>
  sealedItemsBySegment: Map<string, CurrentSegmentItem[]>
  assignedAids: Set<number>
  observedAids: Set<number>
  openItems: Map<number, CurrentSegmentItem>
  protectedAids: Set<number>
}
type ScanJournalEvent = {
  type: 'scan'
  createdAt: string
  mode: OldFavoriteWorkspace['mode']
  scope?: OldFavoriteWorkspaceScope
  segmentSize: number
  segments: SegmentDescriptor[]
  baselineCompletedAids: number[]
}
type ClassificationJournalEvent = {
  type: 'classification'
  entry: OldFavoriteWorkspaceHistoryEntry
  historyCursor: number
  segmentId?: string
}
type CursorJournalEvent = { type: 'history-cursor'; historyCursor: number }
type HistoryBaselineJournalEvent = { type: 'history-baseline'; historyCursor: number }
type FreezeJournalEvent = { type: 'freeze'; segmentId: string }
type DiscoveryJournalEvent = { type: 'discover'; aids: number[] }
type WorkspaceJournalEvent = ScanJournalEvent | ClassificationJournalEvent | CursorJournalEvent |
  HistoryBaselineJournalEvent | FreezeJournalEvent | DiscoveryJournalEvent
type ScanOverview = {
  sourceFolders: Array<{
    id: string
    title: string
    itemCount: number
    invalidItemCount?: number
    /** Compatibility only. New selection and grouping use the fields below. */
    isBilimiWorkFolder: boolean
    isBilimiWorkFolderCandidate?: boolean
    remoteRelationship?: OldFavoriteRemoteRelationship
    scanEligible?: boolean
    selected?: boolean
  }>
  localWorkspaceFolders?: OldFavoriteWorkspaceLocalWorkspaceFolder[]
  scan: { phase: 'inventory' | 'failed' | 'complete'; failureCount: number; mode: OldFavoriteWorkspace['mode']; paused?: boolean; reason?: string; retryAvailableAt?: string; totalItemCount?: number; scannedItemCount?: number; taggedItemCount?: number; untaggedItemCount?: number }
}

function scanSourceIsEligible(folder: ScanOverview['sourceFolders'][number]) {
  return oldFavoriteFolderIsScanEligible(folder)
}

function scanSourceRelationship(folder: ScanOverview['sourceFolders'][number]) {
  return oldFavoriteRemoteRelationship(folder)
}

const bilibiliRiskControlCooldownMs = 10 * 60 * 1_000

function isBilibiliHtml412(reason: string) {
  return /(?:http=|http-status=)412/i.test(reason) && /category=(?:non-json|html)|response-category=html|content-type=text\/html/i.test(reason)
}
type CurrentSegmentItem = {
  aid: number
  title?: string
  author?: string
  description?: string
  tags?: string[]
  tagEvidence?: 'confirmed'
  category?: string
  cover?: string
  addedAt?: number
  unavailable?: boolean
  sourceFolderIds: string[]
}
type DeepSeekOrganizationProjection = NonNullable<OldFavoriteWorkspaceSnapshot['deepSeekOrganization']>
type AutomaticClassification = { targetLedgerIds: string[]; confidence: 'high' | 'low' }

function repositoryClassificationSource(source: OldFavoriteWorkspaceClassificationSource): FavoriteRepositoryClassificationSource {
  if (source === 'manual') return 'manual'
  if (source === 'deepseek') return 'deepseek'
  return source === 'system-low' ? 'system-low' : 'system-high'
}
type RecoveryConfiguration = {
  metadata?: unknown
  rules?: unknown
  keywords?: unknown
  defaultSettings?: unknown
}
type RecommendedLedger = Pick<FavoriteLedger, 'id' | 'displayName' | 'keywords' | 'ruleType' | 'enabled' | 'priority' | 'isDefault'>
type StoredRecommendation = {
  id: string
  displayName: string
  kind: 'author' | 'series' | 'tag'
  sourceName: string
  keywords: string[]
  count: number
  matchedAidsBySegment?: Record<string, number[]>
  reason: string
}
type RecommendationState = { initialized: boolean; candidates: StoredRecommendation[]; adoptedCandidateIds: string[] }
type RecommendationIndex = {
  workspaceId: string
  authorAids: Map<string, Set<number>>
  tagAids: Map<string, Set<number>>
  tagsByAid: Map<number, string[]>
  segmentIdForAid: Map<number, string>
}
type PlanReadiness = { selectedAidCount: number; classifiedAidCount: number }
type OverviewRuntime = {
  aidRangeBySegment: Map<string, { firstAid?: number; lastAid?: number }>
  segmentAidsBySegment: Map<string, Set<number>>
  sourceCountsBySegment: Map<string, Map<string, number>>
  selectedAidsBySegment: Map<string, Set<number>>
  selectedItemCountsBySegment: Map<string, number>
  classificationsBySegment: Map<string, Map<number, OldFavoriteWorkspace['classifications'][string]>>
  unavailableItemCount: number
}

function executionIntentFailureCode(error: unknown): OldFavoriteWorkspaceExecutionFailureCode {
  const detail = error instanceof Error ? error.message : String(error ?? '')
  if (/remote folder inventory is unavailable|page bridge is unavailable/i.test(detail)) return 'remote-inventory-unavailable'
  if (/remote shard is absent from inventory/i.test(detail)) return 'saved-binding-absent'
  if (/remote shard title is invalid/i.test(detail)) return 'saved-binding-title-mismatch'
  if (/requires explicit rebinding|remote shard title is ambiguous|remote shard is already bound|logical shard conflicts|remote-target-unbound/i.test(detail)) {
    return 'binding-requires-rebind'
  }
  if (/remote account mismatch/i.test(detail)) return 'remote-account-mismatch'
  if (/folder limit/i.test(detail)) return 'remote-folder-limit'
  if (/shard capacity is exceeded|physical-shard-capacity-exceeded/i.test(detail)) return 'remote-shard-capacity'
  return 'bilibili-sync-prepare-failed'
}

function isUnavailableScanItem(item: Pick<CurrentSegmentItem, 'title' | 'author' | 'unavailable'>) {
  return item.unavailable === true || item.title?.trim() === '已失效视频' || item.author?.trim() === '账号已注销'
}

function restoredSourceFoldersWithInvalidCounts(
  sourceFolders: ScanOverview['sourceFolders'],
  snapshot: Awaited<ReturnType<FavoriteRepositoryService['getSnapshot']>>,
  unavailableAids: ReadonlySet<number>
) {
  return sourceFolders.map((folder) => {
    const memberAids = snapshot.memberships[`bilibili:${folder.id}`] ?? snapshot.memberships[folder.id] ?? []
    return { ...folder, invalidItemCount: new Set(memberAids.filter((aid) => unavailableAids.has(aid))).size }
  })
}

function withoutUnavailableRecommendationMatches(state: RecommendationState, unavailableAids: ReadonlySet<number>) {
  if (!unavailableAids.size) return state
  let changed = false
  const candidates: StoredRecommendation[] = []
  for (const candidate of state.candidates) {
    if (!candidate.matchedAidsBySegment) {
      candidates.push(candidate)
      continue
    }
    const matchedAidsBySegment: Record<string, number[]> = {}
    for (const [segmentId, aids] of Object.entries(candidate.matchedAidsBySegment)) {
      const availableAids = [...new Set(aids.filter((aid) => !unavailableAids.has(aid)))]
      if (availableAids.length) matchedAidsBySegment[segmentId] = availableAids
    }
    const count = new Set(Object.values(matchedAidsBySegment).flat()).size
    if (count === candidate.count) {
      candidates.push(candidate)
      continue
    }
    changed = true
    if (count) candidates.push({ ...candidate, count, matchedAidsBySegment })
  }
  if (!changed) return state
  const availableIds = new Set(candidates.map((candidate) => candidate.id))
  return {
    initialized: state.initialized,
    candidates,
    adoptedCandidateIds: state.adoptedCandidateIds.filter((id) => availableIds.has(id))
  }
}

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

function isRecoveryRequired(value: OldFavoriteWorkspace | OldFavoriteWorkspaceRecoveryRequired | null):
value is OldFavoriteWorkspaceRecoveryRequired {
  return value !== null && 'recovery' in value
}

function replayClassificationJournal(overlays: Array<{ currentSegmentId: string; history: Array<{ kind: string }> }>) {
  const entriesBySegment = new Map<string, OldFavoriteWorkspaceHistoryEntry[]>()
  const cursorBySegment = new Map<string, number>()
  const baselineCursorBySegment = new Map<string, number>()
  for (const overlay of overlays) {
    for (const history of overlay.history) {
      const event = decodeJournalEvent(history)
      if (!event) continue
      const segmentId = event.type === 'classification' && event.segmentId
        ? event.segmentId
        : overlay.currentSegmentId
      if (event.type === 'classification') {
        const entries = entriesBySegment.get(segmentId) ?? []
        const next = entries.slice(0, Math.max(0, event.historyCursor - 1))
        next.push(clone(event.entry))
        entriesBySegment.set(segmentId, next)
        cursorBySegment.set(segmentId, event.historyCursor)
      } else if (event.type === 'history-cursor') {
        cursorBySegment.set(segmentId, event.historyCursor)
      } else if (event.type === 'history-baseline') {
        baselineCursorBySegment.set(segmentId, event.historyCursor)
      }
    }
  }
  const classifications = new Map<number, OldFavoriteWorkspace['classifications'][string]>()
  for (const [segmentId, entries] of entriesBySegment) {
    const cursor = Math.min(cursorBySegment.get(segmentId) ?? entries.length, entries.length)
    for (const entry of entries.slice(0, cursor)) {
      for (const change of entry.changes) {
        if (change.after) classifications.set(change.aid, clone(change.after))
        else classifications.delete(change.aid)
      }
    }
  }
  return { entriesBySegment, cursorBySegment, baselineCursorBySegment, classifications }
}

function projectDeepSeekOrganizationDetails(
  entries: OldFavoriteWorkspaceHistoryEntry[],
  cursor: number,
  items: CurrentSegmentItem[]
): OldFavoriteWorkspaceDeepSeekProcessedItem[] {
  const titlesByAid = new Map(items.map((item) => [item.aid, item.title?.trim().slice(0, 160)]))
  const detailsByAid = new Map<number, OldFavoriteWorkspaceDeepSeekProcessedItem>()
  for (const entry of entries.slice(0, Math.min(cursor, entries.length))) {
    if (entry.source !== 'deepseek') continue
    const details = entry.deepSeekProcessedItems ?? entry.changes.map((change) => {
      const beforeTargetLedgerIds = [...(change.before?.targetLedgerIds ?? [])]
      const afterTargetLedgerIds = [...(change.after?.targetLedgerIds ?? [])]
      return {
        aid: change.aid,
        beforeTargetLedgerIds,
        afterTargetLedgerIds,
        changed: JSON.stringify(beforeTargetLedgerIds) !== JSON.stringify(afterTargetLedgerIds)
      }
    })
    for (const detail of details) {
      const title = detail.title?.trim().slice(0, 160) || titlesByAid.get(detail.aid)
      detailsByAid.set(detail.aid, clone({ ...detail, ...(title ? { title } : {}) }))
    }
  }
  return [...detailsByAid.values()].sort((left, right) => left.aid - right.aid)
}

function recoveryBaselineChangeEvidence(workspaceBaselineRevision: number, repositoryRevision: number, baseline?: {
  aids: number[]; aidFingerprint: string; mirrorFingerprint: string; bindingFingerprint: string
  metadataFingerprint: string; rulesFingerprint: string; keywordsFingerprint: string; defaultSettingsFingerprint: string; fingerprint: string
}, snapshot?: Awaited<ReturnType<FavoriteRepositoryService['getSnapshot']>>, configuration?: RecoveryConfiguration) {
  const current = baseline && snapshot ? recoveryBaselineVector(snapshot, baseline.aids, configuration) : undefined
  const changedDimensions = baseline && current ? [
    ...(baseline.aidFingerprint !== current.aidFingerprint ? ['aid-revisions' as const] : []),
    ...(baseline.mirrorFingerprint !== current.mirrorFingerprint ? ['mirror' as const] : []),
    ...(baseline.bindingFingerprint !== current.bindingFingerprint ? ['bindings' as const] : []),
    ...(baseline.metadataFingerprint !== current.metadataFingerprint ? ['metadata' as const] : []),
    ...(baseline.rulesFingerprint !== current.rulesFingerprint ? ['rules' as const] : []),
    ...(baseline.keywordsFingerprint !== current.keywordsFingerprint ? ['keywords' as const] : []),
    ...(baseline.defaultSettingsFingerprint !== current.defaultSettingsFingerprint ? ['default-settings' as const] : [])
  ] : []
  return {
    scope: 'account' as const,
    workspaceBaselineRevision,
    repositoryRevision,
    changed: baseline && current ? changedDimensions.length > 0 : workspaceBaselineRevision !== repositoryRevision,
    direction: workspaceBaselineRevision === repositoryRevision
      ? 'unchanged' as const
      : workspaceBaselineRevision < repositoryRevision ? 'advanced' as const : 'regressed' as const,
    manualClassificationsRemainAuthoritative: true as const,
    changedDimensions,
    ...(changedDimensions.some((dimension) => ['metadata', 'rules', 'keywords', 'default-settings'].includes(dimension))
      ? { deepSeekClassificationsMayBeStale: true }
      : {}),
    ...(baseline ? { fingerprint: baseline.fingerprint } : {})
  }
}

function recoveryBaselineVector(
  snapshot: Awaited<ReturnType<FavoriteRepositoryService['getSnapshot']>>,
  aids: number[],
  configuration?: RecoveryConfiguration
) {
  const normalizedAids = normalizeAids(aids)
  const stable = (value: unknown) => JSON.stringify(value)
  const aidFingerprint = stable(normalizedAids.map((aid) => ({ aid,
    positionRevision: snapshot.positions[String(aid)]?.revision ?? 0,
    metadataRevision: snapshot.libraryMirrors[String(aid)]?.metadataRevision ?? 0,
    videoUpdatedAt: snapshot.videos[String(aid)]?.updatedAt ?? ''
  })))
  const mirrorFingerprint = stable(normalizedAids.map((aid) => ({ aid,
    physical: snapshot.positions[String(aid)]?.remoteObservedPhysicalFolderIds ?? [],
    logical: snapshot.positions[String(aid)]?.remoteObservedLogicalFolderIds ?? []
  })))
  const bindingFingerprint = stable(snapshot.physicalShards.map((shard) => ({
    logicalLedgerId: shard.logicalLedgerId, folderId: shard.folderId, shardNumber: shard.shardNumber,
    remoteFolderId: shard.remoteFolderId ?? '', bindingState: shard.bindingState
  })).sort((a, b) => stable(a).localeCompare(stable(b))))
  const metadataFingerprint = stable(configuration?.metadata ?? null)
  const rulesFingerprint = stable(configuration?.rules ?? null)
  const keywordsFingerprint = stable(configuration?.keywords ?? null)
  const defaultSettingsFingerprint = stable(configuration?.defaultSettings ?? null)
  return { aids: normalizedAids, aidFingerprint, mirrorFingerprint, bindingFingerprint,
    metadataFingerprint, rulesFingerprint, keywordsFingerprint, defaultSettingsFingerprint,
    fingerprint: stable({ aidFingerprint, mirrorFingerprint, bindingFingerprint, metadataFingerprint, rulesFingerprint, keywordsFingerprint, defaultSettingsFingerprint }) }
}

function changedRecoverySystemAids(
  baseline: { aids: number[]; aidFingerprint: string; metadataFingerprint: string; rulesFingerprint: string; keywordsFingerprint: string; defaultSettingsFingerprint: string },
  current: { aids: number[]; aidFingerprint: string; metadataFingerprint: string; rulesFingerprint: string; keywordsFingerprint: string; defaultSettingsFingerprint: string },
  changedDimensions: readonly string[]
) {
  const configurationChanged = changedDimensions.some((dimension) =>
    dimension === 'metadata' || dimension === 'rules' || dimension === 'keywords' || dimension === 'default-settings')
  if (configurationChanged) return normalizeAids(current.aids)
  if (!changedDimensions.includes('aid-revisions')) return []
  try {
    const previous = new Map((JSON.parse(baseline.aidFingerprint) as Array<{ aid: number }>).map((entry) => [entry.aid, JSON.stringify(entry)]))
    return (JSON.parse(current.aidFingerprint) as Array<{ aid: number }>).flatMap((entry) =>
      previous.get(entry.aid) === JSON.stringify(entry) ? [] : [entry.aid])
  } catch {
    return normalizeAids(current.aids)
  }
}

function normalizeAids(aids: number[]) {
  return [...new Set(aids.filter((aid) => Number.isSafeInteger(aid) && aid > 0))]
    .sort((left, right) => left - right)
}

type TagEnrichment = {
  status: 'running' | 'paused' | 'accepted' | 'complete'
  totalItemCount: number
  completedItemCount: number
  pendingAids: number[]
  failedAids: number[]
  reusedTagItemCount: number
  taggedAids: number[]
  confirmedUntaggedAids: number[]
  acceptedSegmentIds: string[]
}

function normalizeTagEnrichment(value: {
  status: TagEnrichment['status']
  totalItemCount: number
  completedItemCount: number
  pendingAids: number[]
  failedAids?: number[]
  reusedTagItemCount?: number
  taggedAids?: number[]
  confirmedUntaggedAids?: number[]
  acceptedSegmentIds?: string[]
}): TagEnrichment {
  return {
    ...value,
    failedAids: [...new Set(value.failedAids ?? [])],
    reusedTagItemCount: value.reusedTagItemCount ?? 0,
    taggedAids: [...new Set(value.taggedAids ?? [])],
    confirmedUntaggedAids: [...new Set(value.confirmedUntaggedAids ?? [])],
    acceptedSegmentIds: [...new Set(value.acceptedSegmentIds ?? [])]
  }
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

const GENERIC_RECOMMENDATION_TAGS = new Set(['视频', 'bilibili', '哔哩哔哩', '收藏', '推荐'])

function normalizedRecommendationTags(tags: readonly string[] | undefined) {
  return [...new Set((tags ?? []).map((tag) => tag.trim().replace(/\s+/g, ' ')).filter(Boolean))]
}

function createRecommendationIndex(
  workspaceId: string,
  items: Iterable<Pick<CurrentSegmentItem, 'aid' | 'author' | 'tags'>>,
  segmentIdForAid: (aid: number) => string = () => 'segment-1'
): RecommendationIndex {
  const authorAids = new Map<string, Set<number>>()
  const tagAids = new Map<string, Set<number>>()
  const tagsByAid = new Map<number, string[]>()
  const segmentIds = new Map<number, string>()
  for (const item of items) {
    if (isUnavailableScanItem(item)) continue
    segmentIds.set(item.aid, segmentIdForAid(item.aid))
    const author = item.author?.trim()
    if (author) {
      const aids = authorAids.get(author) ?? new Set<number>()
      aids.add(item.aid)
      authorAids.set(author, aids)
    }
    const tags = normalizedRecommendationTags(item.tags)
    tagsByAid.set(item.aid, tags)
    for (const tag of tags) {
      const aids = tagAids.get(tag) ?? new Set<number>()
      aids.add(item.aid)
      tagAids.set(tag, aids)
    }
  }
  return { workspaceId, authorAids, tagAids, tagsByAid, segmentIdForAid: segmentIds }
}

function matchedRecommendationAidsBySegment(index: RecommendationIndex, aids: ReadonlySet<number>) {
  return Object.fromEntries(
    [...aids].sort((left, right) => left - right).reduce((segments, aid) => {
      const segmentId = index.segmentIdForAid.get(aid) ?? 'segment-1'
      const segmentAids = segments.get(segmentId) ?? []
      segmentAids.push(aid)
      segments.set(segmentId, segmentAids)
      return segments
    }, new Map<string, number[]>())
  )
}

function allocateRecommendationNames(
  candidates: Array<Omit<StoredRecommendation, 'displayName'>>,
  existingDisplayNames: Iterable<string> = []
): StoredRecommendation[] {
  const reservedNames = Array.from(existingDisplayNames)
  const displayNameByCandidate = new Map<string, string>()
  for (const kind of ['author', 'series', 'tag'] as const) {
    const namesBySource = createRecommendedFavoriteLedgerNamesForKind(
      kind,
      candidates.filter((candidate) => candidate.kind === kind).map((candidate) => candidate.sourceName),
      reservedNames
    )
    for (const [sourceName, displayName] of namesBySource) {
      displayNameByCandidate.set(`${kind}:${sourceName}`, displayName)
    }
  }
  return disambiguateRecommendedFavoriteLedgerNames(candidates.map((candidate) => ({
    ...candidate,
    displayName: displayNameByCandidate.get(`${candidate.kind}:${candidate.sourceName}`)!
  })))
}

function tagRecommendation(index: RecommendationIndex, sourceName: string, aids: ReadonlySet<number>): Omit<StoredRecommendation, 'displayName'> {
  return {
    id: createRecommendedFavoriteLedgerId('tag', sourceName),
    kind: 'tag',
    sourceName,
    keywords: [sourceName],
    count: aids.size,
    matchedAidsBySegment: matchedRecommendationAidsBySegment(index, aids),
    reason: `高频标签“${sourceName}”出现 ${aids.size} 次，适合单独成册。`
  }
}

export function mergeGeneratedRecommendations(
  generatedCandidates: StoredRecommendation[],
  adoptedCandidateIds: string[] = [],
  priorCandidates: StoredRecommendation[] = []
): RecommendationState {
  const adoptedPriorCandidates = priorCandidates
    .filter((candidate) => adoptedCandidateIds.includes(candidate.id))
  const priorIdCounts = adoptedPriorCandidates.reduce((counts, candidate) =>
    counts.set(candidate.id, (counts.get(candidate.id) ?? 0) + 1), new Map<string, number>())
  const uniqueAdoptedPriorByLogicalKey = new Map(adoptedPriorCandidates
    .filter((candidate) => priorIdCounts.get(candidate.id) === 1)
    .map((candidate) => [`${candidate.kind}:${candidate.sourceName}`, candidate] as const))
  const candidates = generatedCandidates.map((candidate) => {
    const prior = uniqueAdoptedPriorByLogicalKey.get(`${candidate.kind}:${candidate.sourceName}`)
    return prior ? { ...candidate, id: prior.id } : candidate
  })
  const generatedLogicalKeys = new Set(candidates.map((candidate) => `${candidate.kind}:${candidate.sourceName}`))
  const candidateIds = new Set(candidates.map((candidate) => candidate.id))
  for (const candidate of adoptedPriorCandidates) {
    if (generatedLogicalKeys.has(`${candidate.kind}:${candidate.sourceName}`) || candidateIds.has(candidate.id)) continue
    candidates.push(candidate)
    candidateIds.add(candidate.id)
  }
  return {
    candidates,
    initialized: true,
    adoptedCandidateIds: candidates
      .filter((candidate) => adoptedCandidateIds.includes(candidate.id) ||
        uniqueAdoptedPriorByLogicalKey.has(`${candidate.kind}:${candidate.sourceName}`))
      .map((candidate) => candidate.id)
  }
}

function recommendationsFromIndex(
  index: RecommendationIndex,
  adoptedCandidateIds: string[] = [],
  priorCandidates: StoredRecommendation[] = []
): RecommendationState {
  const matchedAidsBySegment = (aids: ReadonlySet<number>) => Object.fromEntries(
    [...aids].sort((left, right) => left - right).reduce((segments, aid) => {
      const segmentId = index.segmentIdForAid.get(aid) ?? 'segment-1'
      const segmentAids = segments.get(segmentId) ?? []
      segmentAids.push(aid)
      segments.set(segmentId, segmentAids)
      return segments
    }, new Map<string, number[]>())
  )
  const authors = [...index.authorAids.entries()]
    .filter(([, aids]) => aids.size >= 2)
    .sort(([leftName, leftAids], [rightName, rightAids]) => rightAids.size - leftAids.size || leftName.localeCompare(rightName, 'zh-Hans-CN'))
    .slice(0, 24)
    .map(([sourceName, aids]) => ({
      id: createRecommendedFavoriteLedgerId('author', sourceName),
      kind: 'author' as const,
      sourceName,
      keywords: [sourceName],
      count: aids.size,
      matchedAidsBySegment: matchedAidsBySegment(aids),
      reason: `${sourceName} appeared ${aids.size} times.`
    }))
  const tags = [...index.tagAids.entries()]
    .filter(([tag, aids]) => aids.size >= 2 && tag.length >= 2 && !GENERIC_RECOMMENDATION_TAGS.has(tag.toLocaleLowerCase()))
    .sort(([leftName, leftAids], [rightName, rightAids]) => rightAids.size - leftAids.size || leftName.localeCompare(rightName, 'zh-Hans-CN'))
    .slice(0, 24)
    .map(([sourceName, aids]) => tagRecommendation(index, sourceName, aids))
  const generatedCandidates = allocateRecommendationNames([...authors, ...tags])
  return mergeGeneratedRecommendations(generatedCandidates, adoptedCandidateIds, priorCandidates)
}

function buildAuthorRecommendations(
  items: Iterable<Pick<CurrentSegmentItem, 'aid' | 'author' | 'tags'>>,
  segmentIdForAid: (aid: number) => string = () => 'segment-1'
): RecommendationState {
  return recommendationsFromIndex(createRecommendationIndex('', items, segmentIdForAid))
}

function updateRecommendationIndexTags(index: RecommendationIndex, aid: number, tags: readonly string[]) {
  const previousTags = index.tagsByAid.get(aid) ?? []
  const nextTags = normalizedRecommendationTags(tags)
  const changedTags = new Set([...previousTags, ...nextTags])
  for (const tag of previousTags) {
    const aids = index.tagAids.get(tag)
    aids?.delete(aid)
    if (!aids?.size) index.tagAids.delete(tag)
  }
  for (const tag of nextTags) {
    const aids = index.tagAids.get(tag) ?? new Set<number>()
    aids.add(aid)
    index.tagAids.set(tag, aids)
  }
  index.tagsByAid.set(aid, nextTags)
  return changedTags
}

function asLocalRecommendedLedger(candidate: StoredRecommendation, priority: number): FavoriteLedger {
  return {
    id: candidate.id,
    displayName: candidate.displayName,
    keywords: [...candidate.keywords],
    ruleType: candidate.kind === 'author' ? 'author' : candidate.kind === 'tag' ? 'tag' : 'keyword',
    enabled: true,
    priority,
    syncState: 'local-draft',
    bindingState: 'unbacked',
    isDefault: false
  }
}

function isStagingBilimiFolder(title: string) {
  return /\u5f85\u5206\u7c7b|\u6682\u5b58/u.test(title)
}

function recommendationLogicalTitle(candidate: StoredRecommendation) {
  return candidate.kind === 'series' ? candidate.sourceName : candidate.displayName
}

type RecoverableManagedFolder = {
  logicalLedgerId: string
  logicalTitle: string
  shardNumber: number
  remoteFolderId: string
  remoteTitle: string
  memberAids: number[]
  bindingState: 'bound' | 'pending-reconcile'
  knownRemoteFolderIds?: string[]
}

function recoveredCustomLedgerId(remoteFolderId: string) {
  let hash = 2166136261
  for (const character of remoteFolderId.trim()) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return `custom-${(hash >>> 0).toString(36)}`
}

function normalizedRecoveredCustomTitle(title: string) {
  return title.trim().normalize('NFKC').replace(/\s+/gu, ' ').toLocaleLowerCase('zh-Hans-CN')
}

function recoveredManagedShardNumber(title: string, baseTitle: string): number | undefined {
  if (title === baseTitle) return 1
  const match = title.match(new RegExp(`^${escapeRegExp(baseTitle)}·([2-9]\\d*)$`))
  if (!match) return undefined
  const shardNumber = Number(match[1])
  return Number.isSafeInteger(shardNumber) && shardNumber >= 2 ? shardNumber : undefined
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * A reset loses device-local bindings. Reconstruct only a complete, unique
 * remote work folder; incomplete reads remain pending for confirmation.
 */
function recoverableManagedFolders(
  sourceFolders: ScanOverview['sourceFolders'],
  managedMembers: Record<string, number[]>,
  deletedDefaultLedgerIds: ReadonlySet<string> = new Set()
) {
  const defaults = createDefaultFavoriteLedgers()
  const candidates: RecoverableManagedFolder[] = []
  for (const folder of sourceFolders.filter((candidate) => candidate.isBilimiWorkFolder || candidate.isBilimiWorkFolderCandidate)) {
    const title = folder.title.trim()
    const memberAids = [...new Set(managedMembers[folder.id] ?? [])].sort((left, right) => left - right)
    // A same-name remote folder is only a discovery candidate while its
    // default rule is active. A deliberate default deletion marker is a
    // durable opt-out and must not degrade into a custom logical folder.
    const deletedDefault = defaults.find((ledger) =>
      deletedDefaultLedgerIds.has(ledger.id) && recoveredManagedShardNumber(title, ledger.displayName.trim()) !== undefined)
    if (deletedDefault) continue
    let recovered = false
    for (const ledger of defaults) {
      const baseTitle = ledger.displayName.trim()
      // A title is discovery text, never a physical shard identity. Only the
      // current `·2`, `·3` ... suffixes are recognized as physical shards.
      const shardNumber = recoveredManagedShardNumber(title, baseTitle)
      if (shardNumber === undefined) continue
      candidates.push({
        logicalLedgerId: ledger.id,
        logicalTitle: baseTitle,
        shardNumber,
        remoteFolderId: folder.id,
        remoteTitle: title,
        memberAids,
        // A scan after reset is evidence, not authority. Rebinding still requires
        // an explicit remote-folder ID selection, even with a complete member read.
        bindingState: 'pending-reconcile',
        knownRemoteFolderIds: [folder.id]
      })
      recovered = true
      break
    }
    if (!recovered) {
      candidates.push({
        logicalLedgerId: recoveredCustomLedgerId(folder.id),
        logicalTitle: title,
        shardNumber: 1,
        remoteFolderId: folder.id,
        remoteTitle: title,
        memberAids,
        bindingState: 'pending-reconcile',
        knownRemoteFolderIds: [folder.id]
      })
    }
  }
  const customCandidatesByTitle = new Map<string, RecoverableManagedFolder[]>()
  for (const candidate of candidates.filter((candidate) => candidate.logicalLedgerId.startsWith('custom-'))) {
    const key = normalizedRecoveredCustomTitle(candidate.logicalTitle)
    customCandidatesByTitle.set(key, [...(customCandidatesByTitle.get(key) ?? []), candidate])
  }
  const resolvedCandidates = candidates.flatMap((candidate) => {
    if (!candidate.logicalLedgerId.startsWith('custom-')) return [candidate]
    const titleKey = normalizedRecoveredCustomTitle(candidate.logicalTitle)
    const matches = customCandidatesByTitle.get(titleKey) ?? []
    if (matches.length === 1) return [candidate]
    if (matches[0] !== candidate) return []
    return [{
      ...candidate,
      logicalLedgerId: recoveredCustomLedgerId(`title:${titleKey}`),
      memberAids: [],
      bindingState: 'pending-reconcile' as const,
      knownRemoteFolderIds: matches.map((match) => match.remoteFolderId).sort()
    }]
  })
  const byTarget = new Map<string, RecoverableManagedFolder[]>()
  for (const candidate of resolvedCandidates) {
    const target = `${candidate.logicalLedgerId}:${candidate.shardNumber}`
    byTarget.set(target, [...(byTarget.get(target) ?? []), candidate])
  }
  return [...byTarget.values()].map((matches) => {
    if (matches.length === 1) return matches[0]
    const [first] = matches
    return {
      ...first,
      memberAids: [],
      bindingState: 'pending-reconcile' as const,
      knownRemoteFolderIds: matches.map((candidate) => candidate.remoteFolderId).sort()
    }
  })
}

function uniquelyRecoveredRemoteFolderId(candidate: RecoverableManagedFolder) {
  const remoteFolderIds = [...new Set(candidate.knownRemoteFolderIds ?? [candidate.remoteFolderId])]
    .map((folderId) => folderId.trim())
    .filter(Boolean)
  return remoteFolderIds.length === 1 ? remoteFolderIds[0] : undefined
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
  private readonly streamingScans = new Map<string, StreamingScanRuntime>()
  private readonly tagEnrichments = new Map<string, TagEnrichment>()
  private readonly recommendations = new Map<string, RecommendationState>()
  private readonly recommendationIndexes = new Map<string, RecommendationIndex>()
  private readonly planReadiness = new Map<string, PlanReadiness>()
  private readonly staleDeepSeekAids = new Map<string, number[]>()
  private readonly overviewRuntimes = new Map<string, OverviewRuntime>()
  private readonly inventoryMetrics = new Map<string, OldFavoriteInventoryMetricProjection>()
  private readonly deepSeekRunCheckpoints = new Map<string, OldFavoriteWorkspaceDeepSeekRunCheckpoint>()
  private readonly deepSeekOrganizationProjections = new Map<string, { workspaceId: string; projection: DeepSeekOrganizationProjection }>()
  private readonly executionIntents = new Map<string, OldFavoriteWorkspaceExecutionIntent>()
  private readonly executionIntentRuns = new Map<string, Promise<boolean>>()
  private readonly recommendationPreviewGenerations = new Map<string, number>()
  private readonly draftLedgerRuleAnalysisIds = new Map<string, string>()
  private operationTail = Promise.resolve()

  constructor(private readonly options: {
    repository: FavoriteRepositoryService
    workspaceStore: OldFavoriteWorkspaceStore
    bindingService?: {
      ensurePhysicalShard(accountMid: string, input: {
        logicalLedgerId: string
        logicalTitle: string
        remoteDisplayTitle?: string
        preferredRemoteFolderId?: string
        shardNumber: number
        memberAids: number[]
      }): Promise<unknown>
    }
    syncService?: Pick<FavoriteRepositorySyncService, 'abandonFrozenPlan' | 'stopAndAbandonFrozenPlan' | 'pauseFrozenPlan' | 'claimFrozenPlan' | 'executeFrozenPlan' | 'bindPageTarget' | 'rebindPageTarget' | 'reconcile' | 'resume' | 'getRun' | 'deleteManagedFolders' | 'deleteManagedRemoteFolders' | 'previewManagedFolderDeletion'>
    classifyCurrentItem?: (item: CurrentSegmentItem, recommendedLedgers?: RecommendedLedger[]) => AutomaticClassification | Promise<AutomaticClassification>
    classifyCurrentItems?: (
      items: CurrentSegmentItem[],
      recommendedLedgers: RecommendedLedger[],
      accountMid: string,
      options?: {
        onBatchComplete?: (completedItemCount: number, totalItemCount: number) => void
        shouldCancel?: () => boolean
        excludedRecommendedLedgers?: RecommendedLedger[]
      }
    ) => AutomaticClassification[] | Promise<AutomaticClassification[]>
    saveRecommendedLedgers?: (
      accountMid: string,
      ledgers: FavoriteLedger[],
      adoptedLedgerIds?: string[]
    ) => Promise<boolean | void>
    notifyRecommendedLedgersChanged?: (accountMid: string) => void
    saveRecoveredLedgerDrafts?: (accountMid: string, ledgers: FavoriteLedger[]) => Promise<void>
    getUserDeletedDefaultLedgerIds?: (accountMid: string) => readonly string[] | Promise<readonly string[]>
    onManagedFolderDeletion?: (accountMid: string, deletions: Array<{
      logicalLedgerId: string
      remoteFolderIds: string[]
      remoteDeleted: boolean
    }>) => Promise<void>
    prepareForOrganization?: (accountMid: string) => Promise<void>
    refreshSelectedVideoMetadata?: (accountMid: string, aid: number) => Promise<FavoriteRepositoryVideo>
    resolveLedgerTitle?: (accountMid: string, logicalLedgerId: string) => Promise<string | undefined>
    resolveLedgerBinding?: (accountMid: string, logicalLedgerId: string) => Promise<{
      remoteFolderId: string
      remoteDisplayTitle?: string
    } | undefined>
    resolveRecoveryConfiguration?: (accountMid: string) => RecoveryConfiguration | Promise<RecoveryConfiguration>
    segmentSize?: () => number
    onSegmentsReady?: (accountMid: string, segmentIds: string[]) => void | Promise<void>
    now?: () => string
  }) {}

  /** Clears process-local workspace projections after durable storage has been removed. */
  resetAfterFullLocalDataClear(): void {
    this.workspaces.clear()
    this.currentSegments.clear()
    this.segmentDescriptors.clear()
    this.currentSegmentItems.clear()
    this.frozenSegments.clear()
    this.scanOverviews.clear()
    this.scanRuns.clear()
    this.scannedAids.clear()
    this.scannedTagStates.clear()
    this.streamingScans.clear()
    this.tagEnrichments.clear()
    this.recommendations.clear()
    this.recommendationIndexes.clear()
    this.planReadiness.clear()
    this.staleDeepSeekAids.clear()
    this.overviewRuntimes.clear()
    this.inventoryMetrics.clear()
    this.deepSeekRunCheckpoints.clear()
    this.deepSeekOrganizationProjections.clear()
    this.executionIntents.clear()
    this.executionIntentRuns.clear()
    this.recommendationPreviewGenerations.clear()
    this.draftLedgerRuleAnalysisIds.clear()
  }

  resetAfterAccountLocalDataClear(accountMid: string): void {
    this.forgetWorkspace(accountMid)
  }

  async open(accountMid: string): Promise<OldFavoriteWorkspace | OldFavoriteWorkspaceRecoveryRequired | null> {
    return this.queue(() => this.openUnsafe(accountMid))
  }

  /** IDs, not title-shaped candidates, are the only authority for protection. */
  async getFormallyBoundRemoteFolderIds(accountMid: string): Promise<ReadonlySet<string>> {
    const snapshot = await this.options.repository.getSnapshot(accountMid)
    return new Set(snapshot.physicalShards
      .filter((shard) => shard.bindingState === 'bound' && shard.remoteFolderId)
      .map((shard) => shard.remoteFolderId!))
  }

  /**
   * The scanner receives relationship facts only from durable local bindings.
   * A folder name or a scan observation can never create one of these links.
   */
  async getRemoteFolderRelationships(accountMid: string): Promise<ReadonlyMap<string, {
    remoteRelationship: OldFavoriteRemoteRelationship
  }>> {
    const snapshot = await this.options.repository.getSnapshot(accountMid)
    const relationships = new Map<string, { remoteRelationship: OldFavoriteRemoteRelationship }>()
    const record = (folderId: string | undefined, remoteRelationship: OldFavoriteRemoteRelationship) => {
      const id = folderId?.trim()
      if (!id) return
      const existing = relationships.get(id)
      // A formal binding is stronger evidence than a pending reconciliation.
      if (!existing || remoteRelationship === 'bound') relationships.set(id, { remoteRelationship })
    }
    for (const shard of snapshot.physicalShards) {
      if (shard.bindingState === 'bound') record(shard.remoteFolderId, 'bound')
      else {
        record(shard.remoteFolderId, 'reconcile-required')
        for (const folderId of shard.knownRemoteFolderIds ?? []) record(folderId, 'reconcile-required')
      }
    }
    return relationships
  }

  /** Restores only complete, uniquely identifiable Bilimi folders from an existing scan. */
  async recoverPersistedManagedBindings(accountMid: string) {
    // Serialize only restoration: the expensive persisted-member read and
    // revision-guarded repair remain outside the interactive command FIFO.
    const workspace = await this.open(accountMid)
    if (!workspace || isRecoveryRequired(workspace)) return { recoveredCount: 0, pendingCount: 0 }
    const overview = this.scanOverviews.get(workspace.accountMid)
    if (workspace.status === 'scanning' || overview?.scan.phase !== 'complete' ||
      !overview.sourceFolders.some((folder) => folder.isBilimiWorkFolder)) {
      return { recoveredCount: 0, pendingCount: 0 }
    }
    const deletedDefaultLedgerIds = new Set(await this.options.getUserDeletedDefaultLedgerIds?.(workspace.accountMid) ?? [])
    const storedManagedMembers = await this.options.workspaceStore.readManagedMembers(workspace.accountMid, workspace.id)
    let committedRecoveredCount = 0
    let committedPendingCount = 0
    let repairBatchNumber = 0
    for (let attempt = 0; attempt < 2; attempt++) {
      const snapshot = await this.options.repository.getSnapshot(workspace.accountMid)
      if (snapshot.workspace?.id !== workspace.id || snapshot.workspace.status !== workspace.status) {
        return { recoveredCount: 0, pendingCount: 0 }
      }
      const memberAidsByFolderId = Object.fromEntries(overview.sourceFolders.map((folder) => {
        const stored = storedManagedMembers[folder.id]
        // Completed legacy workspaces retained their canonical mirror, not the
        // temporary scan chunks. Reuse it only when it proves the full count.
        const mirrored = snapshot.memberships[`bilibili:${folder.id}`] ?? []
        return [folder.id, folder.isBilimiWorkFolder && stored?.length === folder.itemCount ? stored : mirrored]
      }))
      const candidates = recoverableManagedFolders(overview.sourceFolders, memberAidsByFolderId, deletedDefaultLedgerIds)
      const persistedCustomCandidates = snapshot.physicalShards.flatMap((shard): RecoverableManagedFolder[] => {
        if (!shard.logicalLedgerId.startsWith('custom-') || shard.bindingState !== 'bound' || !shard.remoteFolderId) return []
        const folder = overview.sourceFolders.find((candidate) => candidate.id === shard.remoteFolderId)
        if (!folder?.isBilimiWorkFolder) return []
        return [{
          logicalLedgerId: shard.logicalLedgerId,
          logicalTitle: folder.title,
          shardNumber: shard.shardNumber,
          remoteFolderId: shard.remoteFolderId,
          remoteTitle: shard.remoteTitle,
          memberAids: snapshot.memberships[shard.folderId] ?? [],
          bindingState: 'bound'
        }]
      })
      const recoveredCustomDrafts = [...new Map([...candidates, ...persistedCustomCandidates]
        .filter((candidate) => candidate.bindingState === 'pending-reconcile' && candidate.logicalLedgerId.startsWith('custom-'))
        .map((candidate) => [candidate.logicalLedgerId, candidate])).values()]
        .map((candidate, index): FavoriteLedger => ({
          id: candidate.logicalLedgerId,
          displayName: candidate.logicalTitle.replace(/^bilimi[\u00b7.\s_-]*/i, '').trim() || candidate.logicalTitle,
          keywords: [],
          ruleType: 'keyword',
          enabled: false,
          priority: 20_000 + index,
          ...(uniquelyRecoveredRemoteFolderId(candidate)
            ? { bilibiliFolderId: uniquelyRecoveredRemoteFolderId(candidate) }
            : {}),
          bindingState: 'unbound',
          syncState: 'local-draft',
          isDefault: false
        }))
      if (recoveredCustomDrafts.length) {
        await this.options.saveRecoveredLedgerDrafts?.(workspace.accountMid, recoveredCustomDrafts)
      }
      const boundRemoteIds = new Set(snapshot.physicalShards.flatMap((shard) => shard.remoteFolderId ? [shard.remoteFolderId] : []))
      const boundTargets = new Set(snapshot.physicalShards.map((shard) => `${shard.logicalLedgerId}:${shard.shardNumber}`))
      const bindings = [] as Array<{
        logicalLedgerId: string
        logicalTitle: string
        shardNumber: number
        memberAids: number[]
        remoteTitle: string
        bindingState: 'bound' | 'pending-reconcile'
        remoteFolderId?: string
        knownRemoteFolderIds?: string[]
        remoteMemberCount: number
      }>
      for (const candidate of candidates) {
        const target = `${candidate.logicalLedgerId}:${candidate.shardNumber}`
        const remoteIds = candidate.bindingState === 'bound'
          ? [candidate.remoteFolderId]
          : candidate.knownRemoteFolderIds ?? [candidate.remoteFolderId]
        if (remoteIds.some((remoteFolderId) => boundRemoteIds.has(remoteFolderId)) || boundTargets.has(target)) continue
        bindings.push({
          logicalLedgerId: candidate.logicalLedgerId,
          logicalTitle: candidate.logicalTitle,
          shardNumber: candidate.shardNumber,
          memberAids: candidate.bindingState === 'bound' ? candidate.memberAids : [],
          remoteTitle: candidate.remoteTitle,
          bindingState: candidate.bindingState,
          ...(candidate.bindingState === 'bound'
            ? { remoteFolderId: candidate.remoteFolderId }
            : { knownRemoteFolderIds: candidate.knownRemoteFolderIds ?? [candidate.remoteFolderId] }),
          remoteMemberCount: candidate.memberAids.length
        })
        for (const remoteFolderId of remoteIds) boundRemoteIds.add(remoteFolderId)
        boundTargets.add(target)
      }
      const logicalIdsByRemoteFolderId = new Map<string, Set<string>>()
      for (const shard of snapshot.physicalShards) {
        if (shard.bindingState === 'bound' && shard.remoteFolderId) {
          const logicalIds = logicalIdsByRemoteFolderId.get(shard.remoteFolderId) ?? new Set<string>()
          logicalIds.add(`bilimi-logical:${shard.logicalLedgerId}`)
          logicalIdsByRemoteFolderId.set(shard.remoteFolderId, logicalIds)
        }
      }
      for (const binding of bindings) {
        if (binding.bindingState !== 'bound' || !binding.remoteFolderId) continue
        logicalIdsByRemoteFolderId.set(binding.remoteFolderId, new Set([`bilimi-logical:${binding.logicalLedgerId}`]))
      }
      const recoveredObservations = new Map<number, Set<string>>()
      for (const folder of snapshot.folders.filter((candidate) => candidate.kind === 'bilibili' && candidate.remoteFolderId)) {
        for (const aid of snapshot.memberships[folder.id] ?? []) {
          const observed = recoveredObservations.get(aid) ?? new Set<string>()
          observed.add(folder.remoteFolderId!)
          recoveredObservations.set(aid, observed)
        }
      }
      const placements = [...recoveredObservations.keys()].sort((left, right) => left - right).slice(0, 500).flatMap((aid) => {
        const existing = snapshot.positions[`${workspace.accountMid}:${aid}`]
        const remoteObservedPhysicalFolderIds = [...(recoveredObservations.get(aid) ?? new Set<string>())].sort()
        const bindingConflict = remoteObservedPhysicalFolderIds.some((folderId) =>
          (logicalIdsByRemoteFolderId.get(folderId)?.size ?? 0) > 1)
        const remoteObservedLogicalFolderIds = [...new Set(remoteObservedPhysicalFolderIds.flatMap((folderId) => {
          const logicalIds = logicalIdsByRemoteFolderId.get(folderId)
          return logicalIds?.size === 1 ? [...logicalIds] : []
        }))].sort()
        const unchanged = existing &&
          JSON.stringify(existing.remoteObservedPhysicalFolderIds) === JSON.stringify(remoteObservedPhysicalFolderIds) &&
          JSON.stringify(existing.remoteObservedLogicalFolderIds) === JSON.stringify(remoteObservedLogicalFolderIds) &&
          (!bindingConflict || (existing.positionState === 'needs-review' && existing.reason === 'binding-conflict'))
        if (unchanged) return []
        return [{
          aid,
          localDesiredFolderIds: existing?.localDesiredFolderIds ?? [],
          remoteObservedPhysicalFolderIds,
          remoteObservedLogicalFolderIds,
          observedAt: this.now(),
          ...(bindingConflict ? { positionState: 'needs-review' as const, reason: 'binding-conflict' } : {}),
          updatedAt: this.now()
        }]
      })
      if (!bindings.length && !placements.length) {
        if (recoveredObservations.size > 500) {
          await this.commitRemoteObservationRepair(workspace.accountMid,
            `old-favorite-workspace:recover-persisted-observation:${workspace.id}`, recoveredObservations, false, undefined, undefined,
            { id: workspace.id, status: workspace.status })
        }
        return { recoveredCount: committedRecoveredCount, pendingCount: committedPendingCount }
      }
      try {
        for (let start = 0; start < Math.max(bindings.length, 1); start += 100) {
          const bindingBatch = bindings.slice(start, start + 100)
          let committed = false
          for (let batchAttempt = 0; batchAttempt < 2 && !committed; batchAttempt++) {
            const current = start === 0 && batchAttempt === 0 ? snapshot : await this.options.repository.getSnapshot(workspace.accountMid)
            if (current.workspace?.id !== workspace.id || current.workspace.status !== workspace.status) {
              return { recoveredCount: committedRecoveredCount, pendingCount: committedPendingCount }
            }
            const placementBatch = start === 0 ? placements.map((placement) => ({
              ...placement,
              localDesiredFolderIds: current.positions[`${workspace.accountMid}:${placement.aid}`]?.localDesiredFolderIds ?? []
            })) : []
            try {
              await this.options.repository.commit(workspace.accountMid, {
                id: `old-favorite-workspace:recover-persisted-bindings:${workspace.id}:${++repairBatchNumber}`,
                accountMid: workspace.accountMid,
                issuedAt: this.now(),
                expectedRevision: current.revision,
                type: 'repair-persisted-managed-bindings',
                payload: { workspaceId: workspace.id, workspaceStatus: workspace.status, bindings: bindingBatch, placements: placementBatch }
              })
              committed = true
            } catch (error) {
              if (!(error instanceof Error) || error.message !== 'Favorite repository revision mismatch.' || batchAttempt === 1) throw error
            }
          }
          committedRecoveredCount += bindingBatch.filter((binding) => binding.bindingState === 'bound').length
          committedPendingCount += bindingBatch.filter((binding) => binding.bindingState === 'pending-reconcile').length
        }
        if (recoveredObservations.size > 500) {
          await this.commitRemoteObservationRepair(workspace.accountMid,
            `old-favorite-workspace:recover-persisted-observation:${workspace.id}`, recoveredObservations, false, undefined, undefined,
            { id: workspace.id, status: workspace.status })
        }
        return { recoveredCount: committedRecoveredCount, pendingCount: committedPendingCount }
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'Favorite repository revision mismatch.' || attempt === 1) throw error
      }
    }
    return { recoveredCount: 0, pendingCount: 0 }
  }

  async getSnapshot(accountMid: string): Promise<OldFavoriteWorkspaceSnapshot | OldFavoriteWorkspaceRecoveryRequired | null> {
    return this.queue(async () => {
      const workspace = await this.openUnsafe(accountMid)
      if (!workspace || isRecoveryRequired(workspace)) return workspace
      return this.createSnapshotWithExecutionProgress(workspace)
    })
  }

  async getScanRetryState(accountMid: string): Promise<{ reason: string; retryAvailableAt: string } | null> {
    return this.queue(async () => {
      const workspace = await this.openUnsafe(accountMid)
      if (!workspace || isRecoveryRequired(workspace)) return null
      const scan = this.scanOverviews.get(workspace.accountMid)?.scan
      if (scan?.phase !== 'failed' || !scan.reason || !scan.retryAvailableAt) return null
      return { reason: scan.reason, retryAvailableAt: scan.retryAvailableAt }
    })
  }

  async resumeFailedScan(accountMid: string): Promise<OldFavoriteWorkspaceSnapshot> {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      if (workspace.status !== 'scanning') throw new Error('Old favorite workspace failed scan is not resumable.')
      const prior = this.scanOverviews.get(workspace.accountMid)
      if (prior?.scan.phase !== 'failed') throw new Error('Old favorite workspace scan has not failed.')
      if (prior.scan.retryAvailableAt && Date.parse(this.now()) < Date.parse(prior.scan.retryAvailableAt)) {
        throw new Error(`retry-cooldown; ${prior.scan.reason ?? 'bilibili-risk-control'}; retry-at=${prior.scan.retryAvailableAt}`)
      }
      if (!this.scanRuns.get(workspace.accountMid)) throw new Error('Old favorite workspace scan needs an explicit rescan.')
      const { reason: _reason, retryAvailableAt: _retryAvailableAt, ...retained } = prior.scan
      const scan = { ...retained, phase: 'inventory' as const }
      await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
        currentSegmentId: '', classifications: [], history: [],
        scanMetadata: { sourceFolders: prior.sourceFolders, ...scan }
      })
      this.scanOverviews.set(workspace.accountMid, { sourceFolders: prior.sourceFolders, scan })
      return this.createSnapshot(workspace)
    })
  }

  async getSegmentSnapshot(accountMid: string, segmentId: string): Promise<OldFavoriteWorkspaceSnapshot> {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      const descriptor = (this.segmentDescriptors.get(workspace.accountMid) ?? []).find((candidate) => candidate.id === segmentId)
      const segment = workspace.segments.find((candidate) => candidate.id === segmentId)
      if (!descriptor || !segment) throw new Error('Old favorite workspace segment is invalid.')
      const stored = await this.options.workspaceStore.loadSegment(workspace.accountMid, workspace.id, segmentId)
      const runtimeClassifications = this.overviewRuntimes.get(workspace.accountMid)?.classificationsBySegment.get(segmentId)
      const classifications = runtimeClassifications
        ? Object.fromEntries([...runtimeClassifications].map(([aid, classification]) => [String(aid), clone(classification)]))
        : Object.fromEntries(Object.entries(workspace.classifications)
          .filter(([aid]) => segment.aids.includes(Number(aid)))
          .map(([aid, classification]) => [aid, clone(classification)]))
      return {
        ...this.createSnapshot(workspace),
        currentSegment: { id: segmentId, aids: [...segment.aids], items: (stored.items ?? []).map(clone) },
        classifications,
        history: { cursor: 0, length: 0, entries: [] }
      }
    })
  }

  async getDeepSeekRunCheckpoint(accountMid: string): Promise<OldFavoriteWorkspaceDeepSeekRunCheckpoint | null> {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      const checkpoint = this.deepSeekRunCheckpoints.get(workspace.accountMid)
      return checkpoint?.workspaceId === workspace.id ? clone(checkpoint) : null
    })
  }

  async setDeepSeekRunCheckpoint(
    accountMid: string,
    checkpoint: OldFavoriteWorkspaceDeepSeekRunCheckpoint | null
  ): Promise<void> {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      if (checkpoint && checkpoint.workspaceId !== workspace.id) {
        throw new Error('DeepSeek checkpoint does not match the active old favorite workspace.')
      }
      const normalized = this.normalizeDeepSeekRunCheckpoint(workspace, checkpoint)
      await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
        currentSegmentId: this.currentSegment(workspace),
        classifications: [],
        history: [],
        deepSeekRunCheckpoint: normalized
      })
      if (normalized) this.deepSeekRunCheckpoints.set(workspace.accountMid, clone(normalized))
      else this.deepSeekRunCheckpoints.delete(workspace.accountMid)
    })
  }

  private normalizeDeepSeekRunCheckpoint(
    workspace: OldFavoriteWorkspace,
    checkpoint: OldFavoriteWorkspaceDeepSeekRunCheckpoint | null
  ): OldFavoriteWorkspaceDeepSeekRunCheckpoint | null {
    if (!checkpoint) return null
    const successfulAids = [...new Set(checkpoint.successfulAids ?? [])]
    const pendingAids = [...new Set(checkpoint.pendingAids ?? [])]
    const failedAids = [...new Set(checkpoint.failedAids ?? [])]
    if (!checkpoint.canceled && !checkpoint.failed && checkpoint.waitingSegmentIds.length === 0 &&
      pendingAids.length === 0 && failedAids.length === 0 && checkpoint.totalVideoCount !== undefined &&
      successfulAids.length >= checkpoint.totalVideoCount) {
      return null
    }
    const knownSegmentIds = new Set((this.segmentDescriptors.get(workspace.accountMid) ?? workspace.segments).map((segment) => segment.id))
    const segmentReadiness = new Map(this.createSnapshot(workspace).segments.map((segment) => [segment.id, segment.readiness]))
    const runnableSegmentIds = new Set([...segmentReadiness]
      .filter(([, readiness]) => readiness === 'ready')
      .map(([segmentId]) => segmentId))
    const retainedSegmentWork = checkpoint.segmentWork?.filter((segment) =>
      knownSegmentIds.has(segment.segmentId) && runnableSegmentIds.has(segment.segmentId))
      .map((segment) => ({ ...segment, aids: [...new Set(segment.aids)].sort((left, right) => left - right) }))
    const retainedWorkAids = new Set(retainedSegmentWork?.flatMap((segment) => segment.aids) ?? [])
    const normalizedGroups = checkpoint.requestGroups?.flatMap((group) => {
      if (!runnableSegmentIds.has(group.segmentId)) return []
      const segmentAids = new Set(retainedSegmentWork?.find((segment) => segment.segmentId === group.segmentId)?.aids ?? [])
      const aids = [...new Set(group.aids)].filter((aid) => segmentAids.has(aid)).sort((left, right) => left - right)
      return aids.length ? [{ ...group, aids }] : []
    })
    const normalizedTargets = checkpoint.originalTargetLedgerIdsByAid
      ? Object.fromEntries(Object.entries(checkpoint.originalTargetLedgerIdsByAid)
        .filter(([aid]) => retainedWorkAids.has(Number(aid)))
        .map(([aid, targets]) => [aid, [...new Set(targets)].sort()]))
      : undefined
    const completedSegmentIds = [...new Set(checkpoint.completedSegmentIds.filter((id) =>
      knownSegmentIds.has(id) && !runnableSegmentIds.has(id)))]
      .sort()
    return {
      ...checkpoint,
      completedSegmentIds,
      waitingSegmentIds: [...new Set(checkpoint.waitingSegmentIds.filter((id) => knownSegmentIds.has(id)))].sort(),
      ...(retainedSegmentWork ? { segmentWork: retainedSegmentWork, totalVideoCount: retainedWorkAids.size } : {}),
      ...(checkpoint.requestGroups ? { requestGroups: normalizedGroups ?? [] } : {}),
      ...(normalizedTargets ? { originalTargetLedgerIdsByAid: normalizedTargets } : {}),
      ...(checkpoint.successfulAids ? { successfulAids: [...new Set(checkpoint.successfulAids.filter((aid) => retainedWorkAids.has(aid)))].sort((left, right) => left - right) } : {}),
      ...(checkpoint.pendingAids ? { pendingAids: [...new Set(checkpoint.pendingAids.filter((aid) => retainedWorkAids.has(aid)))].sort((left, right) => left - right) } : {}),
      ...(checkpoint.failedAids ? { failedAids: [...new Set(checkpoint.failedAids.filter((aid) => retainedWorkAids.has(aid)))].sort((left, right) => left - right) } : {})
    }
  }

  async useOriginalClassificationsForFailedDeepSeekAids(accountMid: string): Promise<OldFavoriteWorkspace> {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      const checkpoint = this.deepSeekRunCheckpoints.get(workspace.accountMid)
      const fallbackAids = [...new Set([
        ...(checkpoint?.failedAids ?? []),
        ...((checkpoint?.canceled || checkpoint?.failed) ? (checkpoint?.pendingAids ?? []) : [])
      ])].sort((left, right) => left - right)
      if (!checkpoint || checkpoint.workspaceId !== workspace.id || !fallbackAids.length) {
        throw new Error('DeepSeek unresolved classifications are unavailable for fallback.')
      }
      const fallbackSet = new Set(fallbackAids)
      const originalTargets = new Map<number, string[]>()
      for (const aid of fallbackAids) {
        const targets = checkpoint.originalTargetLedgerIdsByAid?.[String(aid)]
        if (targets) originalTargets.set(aid, [...targets])
      }
      for (let index = workspace.historyBaselineCursor ?? 0; index < workspace.historyCursor; index += 1) {
        for (const change of workspace.history[index]?.changes ?? []) {
          if (fallbackSet.has(change.aid) && !originalTargets.has(change.aid)) {
            originalTargets.set(change.aid, [...(change.before?.targetLedgerIds ?? [])])
          }
        }
      }
      if (fallbackAids.some((aid) => !originalTargets.has(aid))) {
        throw new Error('DeepSeek original automatic classifications are incomplete.')
      }
      const blockedIntent = this.executionIntents.get(workspace.accountMid)
      const resumedIntent = blockedIntent?.workspaceId === workspace.id && blockedIntent.status === 'blocked' &&
        blockedIntent.failureCode === 'deepseek-unresolved'
        ? (() => {
            const { failureCode: _failureCode, ...waiting } = blockedIntent
            return { ...waiting, status: 'waiting' as const }
          })()
        : undefined
      const updated = applyWorkspaceClassificationBatch(workspace, {
        source: 'fallback',
        assignments: fallbackAids.map((aid) => ({ aid, targetLedgerIds: originalTargets.get(aid)! }))
      })
      const entry = updated.history[updated.history.length - 1]
      if (updated === workspace || !entry) throw new Error('DeepSeek fallback did not change the workspace.')
      const readiness = await this.applyReadinessHistoryChange(workspace, entry, 'forward')
      await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
        currentSegmentId: this.currentSegment(workspace),
        classifications: entry.changes.flatMap((change) => change.after ? [{
          aid: change.after.aid,
          targetLedgerIds: [...change.after.targetLedgerIds],
          source: change.after.source
        }] : []),
        history: [encodeJournalEvent({
          type: 'classification', entry: clone(entry), historyCursor: updated.historyCursor
        })],
        planReadiness: readiness,
        deepSeekRunCheckpoint: null,
        ...(resumedIntent ? { executionIntent: resumedIntent } : {})
      })
      this.planReadiness.set(workspace.accountMid, readiness)
      this.deepSeekRunCheckpoints.delete(workspace.accountMid)
      if (resumedIntent) this.executionIntents.set(workspace.accountMid, resumedIntent)
      this.workspaces.set(updated.accountMid, updated)
      return clone(updated)
    })
  }

  private assertDeepSeekExecutionReady(workspace: OldFavoriteWorkspace) {
    const checkpoint = this.deepSeekRunCheckpoints.get(workspace.accountMid)
    if (!checkpoint || checkpoint.workspaceId !== workspace.id) return
    throw new Error('DeepSeek organization must be completed or explicitly resolved before saving or syncing.')
  }

  private async assertDeepSeekExecutionReadyForAccount(accountMid: string) {
    await this.queue(async () => this.assertDeepSeekExecutionReady(await this.requireWorkspace(accountMid)))
  }

  async setExecutionIntent(accountMid: string, mode: 'local' | 'bilibili' | null, includeInbox = false): Promise<void> {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      if (workspace.status !== 'previewing') throw new Error('Old favorite workspace is not ready for confirmation.')
      if (this.executionIntents.get(workspace.accountMid)?.status === 'running') {
        throw new Error('Old favorite workspace whole-run execution has already started.')
      }
      const intent = mode ? { workspaceId: workspace.id, mode, ...(mode === 'bilibili' && includeInbox ? { includeInbox: true } : {}), status: 'waiting' as const } : null
      await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
        currentSegmentId: this.currentSegment(workspace), classifications: [], history: [], executionIntent: intent
      })
      if (intent) this.executionIntents.set(workspace.accountMid, intent)
      else this.executionIntents.delete(workspace.accountMid)
    })
  }

  async continueExecutionIntent(accountMid: string): Promise<boolean> {
    const account = String(accountMid).trim()
    const existing = this.executionIntentRuns.get(account)
    if (existing) return existing
    const run = this.continueExecutionIntentUnsafe(account).finally(() => {
      if (this.executionIntentRuns.get(account) === run) this.executionIntentRuns.delete(account)
    })
    this.executionIntentRuns.set(account, run)
    return run
  }

  private async continueExecutionIntentUnsafe(accountMid: string): Promise<boolean> {
    const state = await this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      const intent = this.executionIntents.get(workspace.accountMid)
      if (!intent || intent.workspaceId !== workspace.id || intent.status === 'blocked') return null
      if (intent.status === 'running') return { mode: intent.mode, includeInbox: intent.includeInbox === true }
      const snapshot = this.createSnapshot(workspace)
      const waitingForSegments = snapshot.segments.some((segment) => segment.readiness === 'tagging' || segment.readiness === 'waiting')
      const checkpoint = this.deepSeekRunCheckpoints.get(workspace.accountMid)
      if (checkpoint?.workspaceId === workspace.id && (checkpoint.canceled || checkpoint.failed)) {
        const blocked = { ...intent, status: 'blocked' as const, failureCode: 'deepseek-unresolved' as const }
        await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
          currentSegmentId: this.currentSegment(workspace), classifications: [], history: [], executionIntent: blocked
        })
        this.executionIntents.set(workspace.accountMid, blocked)
        return null
      }
      const waitingForDeepSeek = Boolean(checkpoint)
      if (waitingForSegments || waitingForDeepSeek) return null
      const running = { ...intent, status: 'running' as const }
      await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
        currentSegmentId: this.currentSegment(workspace), classifications: [], history: [], executionIntent: running
      })
      this.executionIntents.set(workspace.accountMid, running)
      return { mode: running.mode, includeInbox: running.includeInbox === true }
    })
    if (!state) return false
    try {
      if (state.mode === 'local') {
        await this.saveWholeRunToLocalLibrary(accountMid)
      } else {
        if (state.includeInbox) await this.beginBilibiliExecution(accountMid, { includeInbox: true })
        else await this.beginBilibiliExecution(accountMid)
      }
      this.executionIntents.delete(accountMid)
      return true
    } catch (error) {
      // Keep the persisted failure state safe for the renderer, while retaining
      // the concrete preparation error in the development main-process log.
      console.error('[old-favorite-workspace] automatic Bilibili sync preparation failed:', error)
      await this.queue(async () => {
        const workspace = await this.requireWorkspace(accountMid)
        const intent = this.executionIntents.get(workspace.accountMid)
        if (workspace.status !== 'previewing' || intent?.workspaceId !== workspace.id || intent.status !== 'running') return
      const blocked = {
        ...intent,
        status: 'blocked' as const,
        failureCode: executionIntentFailureCode(error),
        failureDetail: (error instanceof Error ? error.message : String(error ?? 'unknown failure')).slice(0, 240)
        }
        await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
          currentSegmentId: this.currentSegment(workspace), classifications: [], history: [], executionIntent: blocked
        })
        this.executionIntents.set(workspace.accountMid, blocked)
      })
      throw error
    }
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
      let workspace = await this.openUnsafe(accountMid)
      if (workspace && !isRecoveryRequired(workspace)) {
        const failedScan = this.scanOverviews.get(workspace.accountMid)?.scan
        if (failedScan?.retryAvailableAt && Date.parse(this.now()) < Date.parse(failedScan.retryAvailableAt)) {
          throw new Error(`retry-cooldown; ${failedScan.reason ?? 'bilibili-risk-control'}; retry-at=${failedScan.retryAvailableAt}`)
        }
      }
      await this.options.prepareForOrganization?.(accountMid)
      if (!workspace) workspace = await this.createScanningWorkspace(accountMid, mode)
      if (isRecoveryRequired(workspace)) {
        const restored = (await this.options.repository.getSnapshot(accountMid)).workspace
        if (restored?.status !== 'draft' || restored.resumable !== true) {
          throw new Error('Old favorite workspace requires rebuild.')
        }
        await this.options.repository.commit(restored.accountMid, {
          id: `old-favorite-workspace:discard-portable-draft:${restored.id}`,
          accountMid: restored.accountMid,
          issuedAt: this.now(),
          type: 'abandon-workspace',
          payload: { workspaceId: restored.id }
        })
        this.forgetWorkspace(restored.accountMid)
        workspace = await this.createScanningWorkspace(restored.accountMid, mode)
      }
      const recovery = await this.options.workspaceStore.readRecoverySummary(workspace.accountMid, workspace.id)
      if (!('recovery' in recovery) && recovery.recoveryDecision?.choice === 'rescan') {
        await this.options.repository.commit(workspace.accountMid, {
          id: `old-favorite-workspace:discard-recovery-rescan:${workspace.id}`,
          accountMid: workspace.accountMid,
          issuedAt: this.now(),
          type: 'abandon-workspace',
          payload: { workspaceId: workspace.id }
        })
        this.forgetWorkspace(workspace.accountMid)
        workspace = await this.createScanningWorkspace(workspace.accountMid, mode)
      }
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
          id: `old-favorite-workspace:clear-local-repository:${workspace.id}`,
          accountMid: workspace.accountMid,
          issuedAt: this.now(),
          type: 'clear-local-repository',
          payload: { preserveTombstones: true }
        })
        await this.persistMarker(workspace)
        await this.options.repository.commit(workspace.accountMid, {
          id: `old-favorite-workspace:clear-protection:${workspace.id}`,
          accountMid: workspace.accountMid,
          issuedAt: this.now(),
          type: 'record-organization-protections',
          payload: { records: [], replace: true }
        })
      }
      if (workspace.status !== 'scanning') throw new Error('Old favorite workspace scan is already active.')
      const updated = { ...workspace, mode }
      const scanRunId = randomUUID()
      const sourceFolders = this.scanOverviews.get(workspace.accountMid)?.sourceFolders.map(clone) ?? []
      this.scanOverviews.set(workspace.accountMid, { sourceFolders, scan: { phase: 'inventory', failureCount: 0, mode, paused: false } })
      await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
        currentSegmentId: '', classifications: [], history: [],
        scanMetadata: { sourceFolders, phase: 'inventory', failureCount: 0, mode, paused: false }
      })
      await this.options.workspaceStore.startScanRun(workspace.accountMid, workspace.id, scanRunId)
      this.scanRuns.set(workspace.accountMid, scanRunId)
      this.scannedAids.set(workspace.accountMid, new Set())
      this.scannedTagStates.set(workspace.accountMid, new Map())
      this.streamingScans.set(workspace.accountMid, {
        segmentSize: workspace.segmentSize,
        sealedSegments: [],
        sealedItemsBySegment: new Map(),
        assignedAids: new Set(),
        observedAids: new Set(),
        openItems: new Map(),
        protectedAids: new Set((await this.options.repository.getSnapshot(workspace.accountMid)).organizationRecords
          .map((record) => record.aid))
      })
      await this.options.workspaceStore.checkpointStreamingScan(workspace.accountMid, workspace.id, {
        runId: scanRunId,
        segmentSize: workspace.segmentSize,
        sealedSegments: [],
        openAids: [],
        observedAids: [],
        taggedAids: []
      })
      this.tagEnrichments.delete(workspace.accountMid)
      this.recommendationIndexes.delete(workspace.accountMid)
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
      const sourceFolders = input.sourceFolders.map((folder) => ({
        ...folder,
        remoteRelationship: scanSourceRelationship(folder),
        scanEligible: scanSourceIsEligible(folder),
        selected: scanSourceIsEligible(folder)
      }))
      const repository = await this.options.repository.getSnapshot(workspace.accountMid)
      const localWorkspaceFolders = this.projectLocalWorkspaceFolders(repository)
      const priorScan = this.scanOverviews.get(workspace.accountMid)?.scan
      const mode = priorScan?.mode ?? workspace.mode
      const overview: ScanOverview = {
        sourceFolders,
        localWorkspaceFolders,
        scan: {
          phase: 'inventory', failureCount: 0, mode, paused: priorScan?.paused ?? false,
          totalItemCount: sourceFolders.reduce((count, folder) => count + folder.itemCount, 0),
          scannedItemCount: priorScan?.scannedItemCount ?? 0,
          taggedItemCount: priorScan?.taggedItemCount ?? 0,
          untaggedItemCount: priorScan?.untaggedItemCount ?? 0
        }
      }
      const inventoryMetrics = projectOldFavoriteInventoryMetrics({
        authority: 'incomplete',
        sourceFolders,
        items: []
      })
      await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
        currentSegmentId: '', classifications: [], history: [],
        scanMetadata: { sourceFolders, localWorkspaceFolders, ...overview.scan, inventoryMetrics }
      })
      const scanRunId = this.scanRuns.get(workspace.accountMid) ?? workspace.id
      await this.commitScanLifecycle(
        workspace.accountMid,
        `old-favorite-workspace:source-pending:${workspace.id}:${scanRunId}`,
        scanRunId,
        'incomplete',
        Object.values(repository.positions).map((position) => ({ aid: position.aid, remoteObserved: false }))
      )
      this.scanOverviews.set(workspace.accountMid, overview)
      this.inventoryMetrics.set(workspace.accountMid, inventoryMetrics)
      return true
    })
  }

  /** Commits one short remote page without using the repository generation path. */
  async recordScanPage(accountMid: string, input: {
    folderId: string
    page: number
    hasMore?: boolean
    items: Array<{ aid: number; title?: string; author?: string; description?: string; tags?: string[]; category?: string; cover?: string; addedAt?: number; unavailable?: boolean; sourceFolderIds: string[] }>
  }, expectedRunId?: string) {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      if (expectedRunId && this.scanRuns.get(workspace.accountMid) !== expectedRunId) return false
      if (workspace.status !== 'scanning') throw new Error('Old favorite workspace scan is not active.')
      const runId = this.scanRuns.get(workspace.accountMid)
      if (!runId) throw new Error('Old favorite workspace scan run is not active.')
      const repository = await this.options.repository.getSnapshot(workspace.accountMid)
      const priorStreaming = this.streamingScans.get(workspace.accountMid)
      const streaming: StreamingScanRuntime = priorStreaming ? {
        segmentSize: priorStreaming.segmentSize,
        sealedSegments: priorStreaming.sealedSegments.map((segment) => ({ ...segment, aids: [...segment.aids] })),
        sealedItemsBySegment: new Map(priorStreaming.sealedItemsBySegment),
        assignedAids: new Set(priorStreaming.assignedAids),
        observedAids: new Set(priorStreaming.observedAids),
        openItems: new Map([...priorStreaming.openItems].map(([aid, item]) => [aid, clone(item)])),
        protectedAids: new Set(priorStreaming.protectedAids)
      } : {
        segmentSize: workspace.segmentSize,
        sealedSegments: [],
        sealedItemsBySegment: new Map<string, CurrentSegmentItem[]>(),
        assignedAids: new Set<number>(),
        observedAids: new Set<number>(),
        openItems: new Map<number, CurrentSegmentItem>(),
        protectedAids: new Set(repository.organizationRecords.map((record) => record.aid))
      }
      const changedSegmentIds = new Set<string>()
      const newSegmentIds = new Set<string>()
      const writableSealedSegmentIds = new Set<string>()
      let reusedTagItemCount = 0
      const mergeSourceRelations = (existing: CurrentSegmentItem, item: CurrentSegmentItem) => {
        existing.sourceFolderIds = [...new Set([...existing.sourceFolderIds, ...item.sourceFolderIds])].sort()
      }
      const sealedSegmentByAid = new Map(streaming.sealedSegments.flatMap((segment) =>
        segment.aids.map((aid) => [aid, segment] as const)))
      for (const rawItem of input.items) {
        const wasObserved = streaming.observedAids.has(rawItem.aid)
        streaming.observedAids.add(rawItem.aid)
        const sealedSegment = sealedSegmentByAid.get(rawItem.aid)
        if (sealedSegment) {
          let items = streaming.sealedItemsBySegment.get(sealedSegment.id)
          if (!items) {
            const stored = await this.options.workspaceStore.loadSegment(workspace.accountMid, workspace.id, sealedSegment.id)
            items = (stored.items ?? []).map(clone)
            streaming.sealedItemsBySegment.set(sealedSegment.id, items)
          }
          if (!writableSealedSegmentIds.has(sealedSegment.id)) {
            items = items.map(clone)
            streaming.sealedItemsBySegment.set(sealedSegment.id, items)
            writableSealedSegmentIds.add(sealedSegment.id)
          }
          const existing = items.find((candidate) => candidate.aid === rawItem.aid)
          if (existing) {
            mergeSourceRelations(existing, rawItem)
            changedSegmentIds.add(sealedSegment.id)
          }
          continue
        }
        const existing = streaming.openItems.get(rawItem.aid)
        if (existing) {
          mergeSourceRelations(existing, rawItem)
          continue
        }
        // The first observation fixes disposition for this round. Later duplicates
        // may add a source relation, but cannot consume another batch slot.
        if (wasObserved || isUnavailableScanItem(rawItem) ||
          (workspace.mode === 'incremental' && streaming.protectedAids.has(rawItem.aid)) ||
          !isFavoriteRepositoryScanVisible(repository, rawItem.aid)) continue
        const item: CurrentSegmentItem = { ...rawItem, sourceFolderIds: [...new Set(rawItem.sourceFolderIds)].sort() }
        const saved = repository.videos[String(item.aid)]
        if (saved && !item.tags?.length && (saved.tagEvidence === 'confirmed' || saved.tags.length > 0)) {
          item.tags = [...saved.tags]
          if (saved.tagEvidence === 'confirmed') item.tagEvidence = 'confirmed'
          if (saved.tags.length) reusedTagItemCount += 1
        }
        streaming.openItems.set(item.aid, item)
        streaming.assignedAids.add(item.aid)
      }
      while (streaming.openItems.size >= streaming.segmentSize) {
        const entries = [...streaming.openItems.entries()].slice(0, streaming.segmentSize)
        const index = streaming.sealedSegments.length
        const segment = { id: `segment-${index + 1}`, index, aids: entries.map(([aid]) => aid) }
        streaming.sealedSegments.push(segment)
        streaming.sealedItemsBySegment.set(segment.id, entries.map(([, item]) => clone(item)))
        newSegmentIds.add(segment.id)
        for (const [aid] of entries) streaming.openItems.delete(aid)
      }
      const sealedSegments = streaming.sealedSegments.map((segment) => ({
        ...segment,
        ...((newSegmentIds.has(segment.id) || changedSegmentIds.has(segment.id))
          ? { items: (streaming.sealedItemsBySegment.get(segment.id) ?? []).map(clone) }
          : {})
      }))
      const segments = streaming.sealedSegments.map((segment) => ({ ...segment, status: 'previewing' as const }))
      const currentSegmentId = this.currentSegments.get(workspace.accountMid) || segments[0]?.id || ''
      let nextTagEnrichment: TagEnrichment | undefined
      if (newSegmentIds.size) {
        const newItems = [...newSegmentIds].flatMap((segmentId) => streaming.sealedItemsBySegment.get(segmentId) ?? [])
        const pendingAids = newItems.filter((item) => !item.tags?.length && item.tagEvidence !== 'confirmed').map((item) => item.aid)
        if (pendingAids.length) {
          const prior = this.tagEnrichments.get(workspace.accountMid)
          const priorPendingAids = new Set(prior?.pendingAids ?? [])
          const addedPendingItemCount = pendingAids.filter((aid) => !priorPendingAids.has(aid)).length
          const nextPendingAids = [...new Set([...priorPendingAids, ...pendingAids])]
          nextTagEnrichment = {
            status: prior?.status === 'paused' ? 'paused' : 'running',
            totalItemCount: (prior?.totalItemCount ?? 0) + addedPendingItemCount,
            completedItemCount: prior?.completedItemCount ?? 0,
            pendingAids: nextPendingAids,
            failedAids: [...(prior?.failedAids ?? [])],
            reusedTagItemCount: (prior?.reusedTagItemCount ?? 0) + (addedPendingItemCount ? reusedTagItemCount : 0),
            taggedAids: [...(prior?.taggedAids ?? [])],
            confirmedUntaggedAids: [...(prior?.confirmedUntaggedAids ?? [])],
            acceptedSegmentIds: [...(prior?.acceptedSegmentIds ?? [])]
          }
          // A sealed batch must never become resumable before its tag work is durable.
          await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
            currentSegmentId,
            classifications: [],
            history: [],
            tagEnrichment: nextTagEnrichment
          })
        }
      }
      await this.options.workspaceStore.checkpointStreamingScan(workspace.accountMid, workspace.id, {
        runId,
        page: { ...input, runId },
        segmentSize: streaming.segmentSize,
        sealedSegments,
        openAids: [...streaming.openItems.keys()],
        openItems: [...streaming.openItems.values()],
        observedAids: [...streaming.observedAids],
        taggedAids: [...new Set([
          ...[...(this.scannedTagStates.get(workspace.accountMid) ?? new Map())]
            .filter(([, tagged]) => tagged).map(([aid]) => aid),
          ...input.items.filter((item) => item.tags?.length).map((item) => item.aid)
        ])],
        changedSegmentIds: [...changedSegmentIds]
      })
      this.streamingScans.set(workspace.accountMid, streaming)
      if (streaming.sealedSegments.length) {
        let currentItems = streaming.sealedItemsBySegment.get(currentSegmentId)
        if (!currentItems) {
          const current = await this.options.workspaceStore.loadSegment(workspace.accountMid, workspace.id, currentSegmentId)
          currentItems = (current.items ?? []).map(clone)
          streaming.sealedItemsBySegment.set(currentSegmentId, currentItems)
        }
        const streamingWorkspace = {
          ...workspace,
          plannedAids: streaming.sealedSegments.flatMap((segment) => segment.aids),
          segments,
          hasMultipleSegments: segments.length > 1
        }
        this.remember(streamingWorkspace, currentSegmentId, streaming.sealedSegments.map((segment) => ({
          id: segment.id, index: segment.index, itemCount: segment.aids.length
        })), new Set())
        this.currentSegmentItems.set(workspace.accountMid, currentItems.map(clone))
        if (nextTagEnrichment) this.tagEnrichments.set(workspace.accountMid, nextTagEnrichment)
      }
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
          currentSegmentId: this.currentSegments.get(workspace.accountMid) ?? '',
          classifications: [], history: [], scanMetadata: { ...scan }
        })
        this.scanOverviews.set(workspace.accountMid, { ...overview, scan })
      }
      return newSegmentIds.size ? { sealedSegmentIds: [...newSegmentIds] } : true
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
      if (workspace.mode === 'incremental') {
        const managedFolderIds = new Set((this.scanOverviews.get(workspace.accountMid)?.sourceFolders ?? [])
          .filter((folder) => scanSourceRelationship(folder) === 'bound' && !isStagingBilimiFolder(folder.title))
          .map((folder) => folder.id))
        const streaming = this.streamingScans.get(workspace.accountMid)
        if (streaming) for (const [folderId, aids] of Object.entries(members)) {
          if (managedFolderIds.has(folderId)) for (const aid of aids) streaming.protectedAids.add(aid)
        }
      }
      return true
    })
  }

  async selectSourceFolders(accountMid: string, folderIds: string[]) {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      if (workspace.status !== 'previewing') throw new Error('Old favorite workspace sources are not ready.')
      const checkpoint = this.deepSeekRunCheckpoints.get(workspace.accountMid)
      if (checkpoint?.workspaceId === workspace.id) {
        throw new Error('Old favorite workspace sources cannot change while DeepSeek owns the draft.')
      }
      const sourceFolders = this.scanOverviews.get(workspace.accountMid)?.sourceFolders ?? []
      const validIds = new Set(sourceFolders.filter(scanSourceIsEligible).map((folder) => folder.id))
      if (!folderIds.every((folderId) => validIds.has(folderId))) throw new Error('Old favorite workspace source selection is invalid.')
      const selectedIds = new Set(folderIds)
      const updatedFolders = sourceFolders.map((folder) => ({
        ...folder,
        selected: scanSourceIsEligible(folder) ? selectedIds.has(folder.id) : false
      }))
      this.scanOverviews.set(workspace.accountMid, {
        sourceFolders: updatedFolders,
        localWorkspaceFolders: this.scanOverviews.get(workspace.accountMid)?.localWorkspaceFolders,
        scan: this.scanOverviews.get(workspace.accountMid)?.scan ?? { phase: 'complete', failureCount: 0, mode: workspace.mode }
      })
      const overviewRuntime = this.overviewRuntimes.get(workspace.accountMid)
      if (overviewRuntime) {
        overviewRuntime.selectedAidsBySegment.clear()
        for (const descriptor of this.segmentDescriptors.get(workspace.accountMid) ?? []) {
          const stored = await this.options.workspaceStore.loadSegment(workspace.accountMid, workspace.id, descriptor.id)
          const selectedAids = new Set((stored.items ?? [])
            .filter((item) => !isUnavailableScanItem(item) && item.sourceFolderIds.some((folderId) => selectedIds.has(folderId)))
            .map((item) => item.aid))
          overviewRuntime.selectedAidsBySegment.set(descriptor.id, selectedAids)
          overviewRuntime.selectedItemCountsBySegment.set(descriptor.id, selectedAids.size)
        }
      }
      const readiness = await this.calculatePlanReadiness(workspace)
      const inventoryMetrics = this.projectInventoryMetrics(
        updatedFolders,
        await this.options.repository.getSnapshot(workspace.accountMid),
        'complete'
      )
      await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
        currentSegmentId: this.currentSegment(workspace), classifications: [], history: [],
        scanMetadata: {
          sourceFolders: updatedFolders,
          localWorkspaceFolders: this.scanOverviews.get(workspace.accountMid)?.localWorkspaceFolders,
          inventoryMetrics
        }, planReadiness: readiness
      })
      this.planReadiness.set(workspace.accountMid, readiness)
      this.inventoryMetrics.set(workspace.accountMid, inventoryMetrics)
    })
  }

  /** Stores only compact candidate metadata; the renderer never supplies rules or classifications. */
  async setRecommendedCandidates(accountMid: string, candidateIds: string[]) {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      if (workspace.status !== 'previewing') throw new Error('Old favorite workspace recommendations are not ready.')
      this.assertCurrentSegmentTagReady(workspace)
      const state = await this.ensureRecommendations(workspace)
      const knownIds = new Set(state.candidates.map((candidate) => candidate.id))
      const adoptedCandidateIds = [...new Set(candidateIds.map((id) => id.trim()).filter(Boolean))].sort()
      if (!adoptedCandidateIds.every((id) => knownIds.has(id))) {
        throw new Error('Old favorite workspace recommendation selection is invalid.')
      }
      const next = { initialized: true, candidates: state.candidates.map(clone), adoptedCandidateIds }
      const updated = await this.applyRecommendedLedgerDeltaUnsafe(
        workspace,
        state.adoptedCandidateIds,
        adoptedCandidateIds,
        next
      )
      await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
        currentSegmentId: this.currentSegment(workspace), classifications: [], history: [], recommendations: next
      })
      this.recommendations.set(workspace.accountMid, next)
      await this.persistRecommendedLedgersUnsafe(workspace, next)
      return updated
    })
  }

  /** Builds a segmented full-mode draft from main-resolved library AIDs without reading Bilibili folders. */
  async beginSelectedReorganization(
    accountMid: string,
    requestedAids: number[],
    options: { refreshIncompleteMetadata?: boolean } = {}
  ): Promise<OldFavoriteWorkspaceSnapshot> {
    return this.queue(async () => {
      const aids = normalizeAids(requestedAids)
      if (!aids.length || aids.length > 100_000) throw new Error('收藏库所选视频无效，请重新勾选。')
      const existing = await this.openUnsafe(accountMid)
      if (existing && (isRecoveryRequired(existing) || existing.status !== 'completed')) {
        throw new Error('当前有未结束的全库整理草稿，请先完成或放弃后再重新整理所选视频。')
      }
      let repository = await this.options.repository.getSnapshot(accountMid)
      const missingAids = aids.filter((aid) => !repository.videos[String(aid)] || !isFavoriteRepositoryScanVisible(repository, aid))
      if (missingAids.length) throw new Error('收藏库所选视频已变化，请刷新后重新勾选。')

      if (options.refreshIncompleteMetadata !== false && this.options.refreshSelectedVideoMetadata) {
        for (const aid of aids) {
          const video = repository.videos[String(aid)]!
          if (!isFavoriteRepositoryMetadataStale(video) && video.description?.trim() && video.tagEvidence === 'confirmed') continue
          try {
            const refreshed = await this.options.refreshSelectedVideoMetadata(repository.accountMid, aid)
            if (refreshed.aid !== aid) throw new Error('Selected favorite metadata does not match its requested AID.')
            await this.options.repository.commit(repository.accountMid, {
              id: `old-favorite-workspace:selected-metadata:${aid}:${randomUUID()}`,
              accountMid: repository.accountMid,
              issuedAt: this.now(),
              type: 'upsert-video',
              payload: refreshed
            })
          } catch {
            // Keep the last durable facts. Unconfirmed tags remain pending and block automatic classification.
          }
        }
        repository = await this.options.repository.getSnapshot(repository.accountMid)
      }

      const sourceId = `favorite-library-selection:${randomUUID()}`
      const scanning = await this.createScanningWorkspace(repository.accountMid, 'full', { kind: 'selection', aids })
      const completed = completeWorkspaceScan(scanning, {
        revision: repository.revision,
        aids,
        mode: 'full'
      })
      const sourceFolders = [{
        id: sourceId,
        title: '收藏库所选视频',
        itemCount: aids.length,
        isBilimiWorkFolder: false,
        selected: true
      }]
      const items = aids.map((aid): CurrentSegmentItem => {
        const video = repository.videos[String(aid)]!
        return {
          aid,
          title: video.title,
          ...(video.author ? { author: video.author } : {}),
          ...(video.description ? { description: video.description } : {}),
          tags: [...video.tags],
          ...(video.tagEvidence ? { tagEvidence: video.tagEvidence } : {}),
          ...(video.category ? { category: video.category } : {}),
          ...(video.coverUrl ? { cover: video.coverUrl } : {}),
          sourceFolderIds: [sourceId]
        }
      })
      const itemsByAid = new Map(items.map((item) => [item.aid, item]))
      const currentSegmentId = completed.segments[0]?.id ?? ''
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
          items: segment.aids.map((aid) => clone(itemsByAid.get(aid)!))
        }))
      })
      const descriptors = completed.segments.map(({ id, index, aids: segmentAids }) => ({ id, index, itemCount: segmentAids.length }))
      const segmentIdForAid = new Map(completed.segments.flatMap((segment) => segment.aids.map((aid) => [aid, segment.id] as const)))
      const recommendationIndex = createRecommendationIndex(
        completed.id,
        items,
        (aid) => segmentIdForAid.get(aid) ?? currentSegmentId
      )
      const recommendations = recommendationsFromIndex(recommendationIndex)
      const pendingTagAids = items
        .filter((item) => !item.tags?.length && item.tagEvidence !== 'confirmed')
        .map((item) => item.aid)
      const tagEnrichment: TagEnrichment = {
        status: pendingTagAids.length ? 'running' : 'complete',
        totalItemCount: pendingTagAids.length,
        completedItemCount: 0,
        pendingAids: pendingTagAids,
        failedAids: [],
        reusedTagItemCount: items.filter((item) => Boolean(item.tags?.length)).length,
        taggedAids: [],
        confirmedUntaggedAids: [],
        acceptedSegmentIds: []
      }
      const readiness = this.calculatePlanReadinessFromItems(completed, items, sourceFolders)
      const overviewRuntime = this.initializeOverviewRuntime(completed, itemsByAid.values(), 0)
      await this.options.workspaceStore.appendOverlay(completed.accountMid, completed.id, {
        currentSegmentId,
        classifications: [],
        history: [],
        recommendations,
        planReadiness: readiness,
        scanMetadata: {
          sourceFolders,
          phase: 'complete',
          failureCount: 0,
          mode: completed.mode,
          totalItemCount: aids.length,
          scannedItemCount: aids.length,
          taggedItemCount: items.filter((item) => Boolean(item.tags?.length)).length,
          untaggedItemCount: items.filter((item) => !item.tags?.length).length
        },
        tagEnrichment,
        overview: this.persistedOverviewRuntime(overviewRuntime)
      })
      await this.appendEvents(completed, currentSegmentId, [{
        type: 'scan',
        createdAt: completed.createdAt,
        mode: completed.mode,
        scope: clone(completed.scope),
        segmentSize: completed.segmentSize,
        segments: descriptors,
        baselineCompletedAids: []
      }])
      await this.persistMarker(completed)
      this.scanOverviews.set(completed.accountMid, {
        sourceFolders,
        scan: {
          phase: 'complete', failureCount: 0, mode: completed.mode,
          totalItemCount: aids.length, scannedItemCount: aids.length,
          taggedItemCount: items.filter((item) => Boolean(item.tags?.length)).length,
          untaggedItemCount: items.filter((item) => !item.tags?.length).length
        }
      })
      this.tagEnrichments.set(completed.accountMid, tagEnrichment)
      this.recommendations.set(completed.accountMid, clone(recommendations))
      this.recommendationIndexes.set(completed.accountMid, recommendationIndex)
      this.planReadiness.set(completed.accountMid, readiness)
      this.remember(completed, currentSegmentId, descriptors, new Set())
      this.currentSegmentItems.set(completed.accountMid, completed.segments[0]?.aids.map((aid) => clone(itemsByAid.get(aid)!)) ?? [])
      const canClassify = Boolean(this.options.classifyCurrentItem || this.options.classifyCurrentItems)
      const currentSegmentHasPendingTags = completed.segments[0]?.aids.some((aid) => pendingTagAids.includes(aid)) ?? false
      const classified = canClassify && pendingTagAids.length === 0
        ? await this.checkpointInitialSystemClassificationsUnsafe(await this.autoClassifyAllSegmentsUnsafe(completed, true))
        : canClassify && !currentSegmentHasPendingTags
        ? await this.checkpointInitialSystemClassificationsUnsafe(await this.autoClassifyCurrentSegmentUnsafe(completed, true))
        : completed
      return this.createSnapshot(classified)
    })
  }

  async prepareRecommendationPreview(
    accountMid: string,
    candidateIds: string[],
    onProgress?: (progress: { completedItemCount: number; totalItemCount: number }) => void
  ) {
    const generation = (this.recommendationPreviewGenerations.get(accountMid) ?? 0) + 1
    this.recommendationPreviewGenerations.set(accountMid, generation)
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      if (workspace.status !== 'previewing') throw new Error('Old favorite workspace recommendations are not ready.')
      this.assertCurrentSegmentTagReady(workspace)
      const state = await this.ensureRecommendations(workspace)
      const knownIds = new Set(state.candidates.map((candidate) => candidate.id))
      const adoptedCandidateIds = [...new Set(candidateIds.map((id) => id.trim()).filter(Boolean))].sort()
      if (!adoptedCandidateIds.every((id) => knownIds.has(id)) ||
        JSON.stringify(adoptedCandidateIds) !== JSON.stringify(state.adoptedCandidateIds)) {
        throw new Error('Old favorite workspace recommendation selection is stale.')
      }
      const shouldCancel = () => this.recommendationPreviewGenerations.get(accountMid) !== generation
      if (shouldCancel()) throw new Error('Old favorite preview preparation canceled.')
      const totalItemCount = this.planReadiness.get(workspace.accountMid)?.selectedAidCount ?? workspace.plannedAids.length
      onProgress?.({ completedItemCount: totalItemCount, totalItemCount })
      return clone(workspace)
    })
  }

  cancelRecommendationPreviewPreparation(accountMid: string) {
    this.recommendationPreviewGenerations.set(accountMid, (this.recommendationPreviewGenerations.get(accountMid) ?? 0) + 1)
  }

  cancelDraftLedgerRuleAnalysis(accountMid: string, analysisId: string) {
    const normalizedAccount = String(accountMid).trim()
    if (this.draftLedgerRuleAnalysisIds.get(normalizedAccount) !== analysisId) return false
    this.draftLedgerRuleAnalysisIds.delete(normalizedAccount)
    return true
  }

  async saveDraftLedgerRule(accountMid: string, input: {
    analysisId: string
    ledgerId?: string
    title: string
    keywords: string[]
    ruleType: 'keyword' | 'author' | 'tag'
    adopt?: boolean
  }, onProgress?: (progress: {
    workspaceId: string
    analysisId: string
    completedItemCount: number
    totalItemCount: number
  }) => void) {
    const normalizedAccount = String(accountMid).trim()
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(input.analysisId)) {
      throw new Error('Old favorite workspace draft ledger rule is invalid.')
    }
    this.draftLedgerRuleAnalysisIds.set(normalizedAccount, input.analysisId)
    const shouldCancel = () => this.draftLedgerRuleAnalysisIds.get(normalizedAccount) !== input.analysisId
    const run = this.queue(async () => {
      if (shouldCancel()) throw new Error('Old favorite ledger rule analysis canceled.')
      const workspace = await this.requireWorkspace(accountMid)
      const title = input.title.trim()
      const keywords = [...new Set(input.keywords.map((keyword) => keyword.trim()).filter(Boolean))]
      if (workspace.status !== 'previewing' || !/^[a-zA-Z0-9_-]{8,128}$/.test(input.analysisId) ||
        !title || title.length > 128 || !keywords.length || keywords.length > 64 ||
        keywords.some((keyword) => keyword.length > 128) ||
        !['keyword', 'author', 'tag'].includes(input.ruleType)) {
        throw new Error('Old favorite workspace draft ledger rule is invalid.')
      }
      const id = input.ledgerId?.trim() || localLedgerId(title)
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
        throw new Error('Old favorite workspace draft ledger rule is invalid.')
      }
      const state = await this.ensureRecommendations(workspace)
      const existingCandidate = state.candidates.find((candidate) => candidate.id === id)
      if (!input.ledgerId && state.candidates.some((candidate) => candidate.id === id)) {
        throw new Error('Old favorite workspace local ledger already exists.')
      }

      const recovered = await this.options.workspaceStore.recover(workspace.accountMid, workspace.id)
      if ('recovery' in recovered) throw new Error('Old favorite workspace requires rebuild.')
      const tagUpdates = new Map(recovered.tagUpdates.map((update) => [update.aid, update.tags]))
      const sourceFolders = this.scanOverviews.get(workspace.accountMid)?.sourceFolders ?? []
      const selectedSourceFolderIds = new Set(sourceFolders
        .filter((folder) => scanSourceIsEligible(folder) && folder.selected).map((folder) => folder.id))
      const hasSelectableSources = sourceFolders.some(scanSourceIsEligible)
      const descriptors = this.segmentDescriptors.get(workspace.accountMid) ??
        workspace.segments.map((segment) => ({ id: segment.id, index: segment.index, itemCount: segment.aids.length }))
      const selectedItemCountsBySegment = new Map<string, number>()
      for (const segment of descriptors) {
        if (shouldCancel()) throw new Error('Old favorite ledger rule analysis canceled.')
        const stored = await this.options.workspaceStore.loadSegment(workspace.accountMid, workspace.id, segment.id)
        const selectedItemCount = (stored.items ?? []).filter((item) => !isUnavailableScanItem(item) &&
          (!hasSelectableSources || item.sourceFolderIds.some((folderId) => selectedSourceFolderIds.has(folderId)))).length
        selectedItemCountsBySegment.set(segment.id, selectedItemCount)
      }
      const totalItemCount = [...selectedItemCountsBySegment.values()].reduce((count, itemCount) => count + itemCount, 0)
      const fingerprint = createHash('sha256').update(JSON.stringify({
        workspaceId: workspace.id,
        baselineRevision: workspace.baseline?.revision ?? 0,
        ledgerId: id,
        title,
        keywords,
        ruleType: input.ruleType,
        segments: descriptors,
        selectedSourceFolderIds: [...selectedSourceFolderIds].sort(),
        tagUpdates: recovered.tagUpdates
      })).digest('hex')
      const priorCheckpoint = recovered.ruleAnalysisCheckpoint?.fingerprint === fingerprint
        ? recovered.ruleAnalysisCheckpoint
        : undefined
      const completedSegmentIds = new Set(priorCheckpoint?.completedSegmentIds ?? [])
      const matchedAidsBySegment = clone(priorCheckpoint?.matchedAidsBySegment ?? {})
      let completedItemCount = [...completedSegmentIds].reduce((count, segmentId) =>
        count + (selectedItemCountsBySegment.get(segmentId) ?? 0), 0)
      for (const segment of descriptors) {
        if (completedSegmentIds.has(segment.id)) continue
        const stored = await this.options.workspaceStore.loadSegment(workspace.accountMid, workspace.id, segment.id)
        const items = (stored.items ?? [])
          .map((item) => ({ ...item, ...(tagUpdates.has(item.aid) ? { tags: tagUpdates.get(item.aid) } : {}) }))
          .filter((item) => !isUnavailableScanItem(item) &&
            (!hasSelectableSources || item.sourceFolderIds.some((folderId) => selectedSourceFolderIds.has(folderId))))
        const completedBeforeSegment = completedItemCount
        const matchedInSegment = await analyzeOldFavoriteLedgerRule([{
          id: segment.id,
          items
        }], {
          ruleType: input.ruleType,
          keywords
        }, {
          shouldCancel,
          onProgress: (segmentCompletedItemCount) => onProgress?.({
            workspaceId: workspace.id,
            analysisId: input.analysisId,
            completedItemCount: Math.min(completedBeforeSegment + segmentCompletedItemCount, totalItemCount),
            totalItemCount
          })
        })
        if (matchedInSegment[segment.id]?.length) {
          matchedAidsBySegment[segment.id] = [...matchedInSegment[segment.id]]
        } else delete matchedAidsBySegment[segment.id]
        completedSegmentIds.add(segment.id)
        completedItemCount += items.length
        await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
          currentSegmentId: this.currentSegment(workspace),
          classifications: [],
          history: [],
          ruleAnalysisCheckpoint: {
            fingerprint,
            ledgerId: id,
            completedSegmentIds: [...completedSegmentIds],
            completedItemCount,
            totalItemCount,
            matchedAidsBySegment: clone(matchedAidsBySegment)
          }
        })
        if (shouldCancel()) throw new Error('Old favorite ledger rule analysis canceled.')
      }
      const candidate: StoredRecommendation = {
        id,
        displayName: `${BILIMI_LEDGER_PREFIX}${title}`,
        kind: input.ruleType === 'author' ? 'author' : input.ruleType === 'tag' ? 'tag' : 'series',
        sourceName: title,
        keywords,
        count: new Set(Object.values(matchedAidsBySegment).flat()).size,
        matchedAidsBySegment,
        reason: 'Created locally for this organization round.'
      }
      const candidates = existingCandidate
        ? state.candidates.map((item) => item.id === id ? candidate : item)
        : [...state.candidates, candidate]
      const shouldAdopt = input.adopt !== false
      const next: RecommendationState = {
        initialized: true,
        candidates,
        adoptedCandidateIds: shouldAdopt
          ? [...new Set([...state.adoptedCandidateIds, id])].sort()
          : state.adoptedCandidateIds.filter((candidateId) => candidateId !== id)
      }
      if (!shouldAdopt && !state.adoptedCandidateIds.includes(id)) {
        this.draftLedgerRuleAnalysisIds.delete(normalizedAccount)
        await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
          currentSegmentId: this.currentSegment(workspace),
          classifications: [],
          history: [],
          recommendations: next,
          ruleAnalysisCheckpoint: null
        })
        const visibleUpdated: OldFavoriteWorkspace = {
          ...workspace,
          recommendations: clone(next)
        }
        this.recommendations.set(workspace.accountMid, clone(next))
        this.workspaces.set(workspace.accountMid, visibleUpdated)
        return clone(visibleUpdated)
      }
      const affectedAids = new Set([
        ...Object.values(existingCandidate?.matchedAidsBySegment ?? {}).flat(),
        ...Object.values(matchedAidsBySegment).flat()
      ])
      const affectedSegmentIds = new Set([
        ...Object.keys(existingCandidate?.matchedAidsBySegment ?? {}),
        ...Object.keys(matchedAidsBySegment)
      ])
      const itemsByAid = new Map<number, CurrentSegmentItem>()
      const classificationSegments: OldFavoriteWorkspace['segments'] = []
      for (const segment of descriptors) {
        if (!affectedSegmentIds.has(segment.id)) continue
        const stored = await this.options.workspaceStore.loadSegment(workspace.accountMid, workspace.id, segment.id)
        const affectedSegmentAids = stored.aids.filter((aid) => affectedAids.has(aid))
        classificationSegments.push({
          id: segment.id,
          index: segment.index,
          aids: affectedSegmentAids,
          status: this.frozenSegments.get(workspace.accountMid)?.has(segment.id) ? 'frozen' : 'previewing'
        })
        for (const item of stored.items ?? []) {
          if (!affectedAids.has(item.aid)) continue
          const withTags = { ...item, ...(tagUpdates.has(item.aid) ? { tags: tagUpdates.get(item.aid) } : {}) }
          if (!isUnavailableScanItem(withTags) &&
            (!hasSelectableSources || withTags.sourceFolderIds.some((folderId) => selectedSourceFolderIds.has(folderId)))) {
            itemsByAid.set(withTags.aid, withTags)
          }
        }
      }
      const journalState = replayClassificationJournal(recovered.overlayHistory)
      let globalClassifications: OldFavoriteWorkspace['classifications'] = Object.fromEntries(
        [...journalState.classifications].map(([aid, classification]) => [String(aid), clone(classification)]))
      const classificationCandidates = [...affectedAids]
        .map((aid) => itemsByAid.get(aid))
        .filter((item): item is CurrentSegmentItem => Boolean(item))
        .filter((item) => {
          const existing = globalClassifications[String(item.aid)]
          return existing?.source !== 'manual' && existing?.source !== 'deepseek'
        })
      const recommendedLedgers = next.candidates
        .filter((item) => next.adoptedCandidateIds.includes(item.id))
        .map((item, index) => asLocalRecommendedLedger(item, index))
      const excludedRecommendedLedgers = next.candidates
        .filter((item) => !next.adoptedCandidateIds.includes(item.id))
        .map((item, index) => asLocalRecommendedLedger(item, index))
      if (classificationCandidates.length && !this.options.classifyCurrentItems && !this.options.classifyCurrentItem) {
        throw new Error('Old favorite workspace automatic classification is unavailable.')
      }
      const classifications = classificationCandidates.length === 0
        ? []
        : this.options.classifyCurrentItems
        ? await this.options.classifyCurrentItems(classificationCandidates.map(clone), clone(recommendedLedgers), workspace.accountMid, {
            shouldCancel,
            excludedRecommendedLedgers: clone(excludedRecommendedLedgers)
          })
        : await Promise.all(classificationCandidates.map((item) => recommendedLedgers.length
          ? this.options.classifyCurrentItem!(clone(item), clone(recommendedLedgers))
          : this.options.classifyCurrentItem!(clone(item))))
      if (shouldCancel()) throw new Error('Old favorite ledger rule analysis canceled.')
      if (classifications.length !== classificationCandidates.length) {
        throw new Error('Old favorite workspace automatic classification result is invalid.')
      }
      const proposed = classificationCandidates.map((item, index) => ({ aid: item.aid, proposal: classifications[index]! }))
      const newEntries: Array<{ segmentId: string; entry: OldFavoriteWorkspaceHistoryEntry; historyCursor: number }> = []
      for (const segment of classificationSegments) {
        let segmentWorkspace: OldFavoriteWorkspace = {
          ...workspace,
          baseline: { revision: workspace.baseline?.revision ?? recovered.baselineRevision, aids: [...segment.aids] },
          plannedAids: [...segment.aids],
          segments: [segment],
          classifications: globalClassifications,
          history: clone(journalState.entriesBySegment.get(segment.id) ?? []),
          historyCursor: journalState.cursorBySegment.get(segment.id) ?? 0
        }
        for (const source of ['system-high', 'system-low'] as const) {
          const assignments = proposed
            .filter(({ aid, proposal }) => segment.aids.includes(aid) &&
              proposal.confidence === (source === 'system-high' ? 'high' : 'low'))
            .map(({ aid, proposal }) => ({ aid, targetLedgerIds: proposal.targetLedgerIds.slice(0, 1) }))
          if (!assignments.length) continue
          const classified = applyWorkspaceClassificationBatch(segmentWorkspace, {
            source,
            assignments,
            replaceExistingSystem: true
          })
          if (classified === segmentWorkspace) continue
          newEntries.push({
            segmentId: segment.id,
            entry: clone(classified.history[classified.history.length - 1]!),
            historyCursor: classified.historyCursor
          })
          globalClassifications = classified.classifications
          segmentWorkspace = classified
        }
      }

      const readiness = this.calculatePlanReadinessFromClassifications(workspace, globalClassifications)
      if (shouldCancel()) throw new Error('Old favorite ledger rule analysis canceled.')
      this.draftLedgerRuleAnalysisIds.delete(normalizedAccount)
      await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
        currentSegmentId: this.currentSegment(workspace),
        classifications: newEntries.flatMap(({ entry }) => entry.changes.flatMap((change) => change.after ? [{
          aid: change.after.aid,
          targetLedgerIds: [...change.after.targetLedgerIds],
          source: change.after.source
        }] : [])),
        history: newEntries.map(({ segmentId, entry, historyCursor }) => encodeJournalEvent({
          type: 'classification', segmentId, entry: clone(entry), historyCursor
        })),
        recommendations: next,
        planReadiness: readiness,
        ruleAnalysisCheckpoint: null
      })
      this.updateOverviewClassifications(workspace.accountMid, newEntries)
      const visibleAidSet = new Set(workspace.segments.flatMap((segment) => segment.aids))
      const visibleEntries = newEntries.filter(({ segmentId }) => segmentId === this.currentSegment(workspace)).map(({ entry }) => ({
        ...clone(entry),
        changes: entry.changes.filter((change) => visibleAidSet.has(change.aid)).map(clone)
      })).filter((entry) => entry.changes.length > 0)
      const visibleHistory = [...workspace.history.slice(0, workspace.historyCursor), ...visibleEntries]
      const visibleUpdated: OldFavoriteWorkspace = {
        ...workspace,
        classifications: Object.fromEntries(Object.entries(globalClassifications)
          .filter(([aid]) => visibleAidSet.has(Number(aid))).map(([aid, classification]) => [aid, clone(classification)])),
        history: visibleHistory,
        historyCursor: visibleHistory.length
      }
      this.recommendations.set(workspace.accountMid, clone(next))
      this.planReadiness.set(workspace.accountMid, readiness)
      this.workspaces.set(workspace.accountMid, visibleUpdated)
      return clone(visibleUpdated)
    })
    return run.finally(() => {
      if (this.draftLedgerRuleAnalysisIds.get(normalizedAccount) === input.analysisId) {
        this.draftLedgerRuleAnalysisIds.delete(normalizedAccount)
      }
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
      return this.options.classifyCurrentItem || this.options.classifyCurrentItems
        ? this.autoClassifyAllSegmentsUnsafe(workspace, true, true)
        : clone(workspace)
    })
  }

  /** Converts scan staging to the immutable 2,000-item baseline only after every page succeeds. */
  async finishScan(accountMid: string, expectedRunId?: string) {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      if (expectedRunId && this.scanRuns.get(workspace.accountMid) !== expectedRunId) return clone(workspace)
      if (workspace.status !== 'scanning') throw new Error('Old favorite workspace scan is not active.')
      const deletedDefaultLedgerIds = new Set(await this.options.getUserDeletedDefaultLedgerIds?.(workspace.accountMid) ?? [])
      const itemsByAid = new Map<number, CurrentSegmentItem>()
      await this.options.workspaceStore.visitScanPages(workspace.accountMid, workspace.id, (page) => {
        for (const item of page.items) {
          const existing = itemsByAid.get(item.aid)
          if (existing) {
            existing.sourceFolderIds = [...new Set([...existing.sourceFolderIds, ...item.sourceFolderIds])].sort()
          } else {
            itemsByAid.set(item.aid, { ...item, sourceFolderIds: [...new Set(item.sourceFolderIds)].sort() })
          }
        }
      })
      let managedMembers = await this.options.workspaceStore.readManagedMembers(workspace.accountMid, workspace.id)
      const repository = await this.options.repository.getSnapshot(workspace.accountMid)
      // A local deletion is intentional. Do not let a later read-only scan recreate
      // its mirror, remote-position projection, or incremental-protection record.
      for (const aid of itemsByAid.keys()) {
        if (!isFavoriteRepositoryScanVisible(repository, aid)) itemsByAid.delete(aid)
      }
      managedMembers = Object.fromEntries(Object.entries(managedMembers).map(([folderId, aids]) => [
        folderId,
        aids.filter((aid) => isFavoriteRepositoryScanVisible(repository, aid))
      ]))
      let reusedTagItemCount = 0
      for (const item of itemsByAid.values()) {
        const saved = repository.videos[String(item.aid)]
        if (saved && !item.tags?.length && (saved.tagEvidence === 'confirmed' || saved.tags.length > 0)) {
          item.tags = [...saved.tags]
          if (saved.tags.length > 0) reusedTagItemCount += 1
          if (saved.tagEvidence === 'confirmed') item.tagEvidence = 'confirmed'
        }
      }
      const sourceFolders = (this.scanOverviews.get(workspace.accountMid)?.sourceFolders ?? []).map((folder) => ({
        ...folder,
        invalidItemCount: [...itemsByAid.values()].filter((item) =>
          isUnavailableScanItem(item) && item.sourceFolderIds.includes(folder.id)).length
      }))
      const currentOverview = this.scanOverviews.get(workspace.accountMid)
      if (currentOverview) this.scanOverviews.set(workspace.accountMid, { ...currentOverview, sourceFolders })
      const organizableItemsByAid = new Map([...itemsByAid].filter(([, item]) => !isUnavailableScanItem(item)))
      const mirrorFolders = sourceFolders.map((folder) => ({
        id: `bilibili:${folder.id}`,
        title: folder.title,
        remoteFolderId: folder.id
      }))
      const mirrorMembers = new Map(mirrorFolders.map((folder) => [folder.remoteFolderId, [] as number[]]))
      for (const item of itemsByAid.values()) {
        for (const folderId of item.sourceFolderIds) mirrorMembers.get(folderId)?.push(item.aid)
      }
      for (const folder of sourceFolders.filter((candidate) => scanSourceRelationship(candidate) === 'bound')) {
        mirrorMembers.set(folder.id, [...new Set(managedMembers[folder.id] ?? [])])
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
          videos: [
            ...[...itemsByAid.values()].map((item) => ({
            aid: item.aid,
            title: item.title ?? `Video ${item.aid}`,
            ...(item.author ? { author: item.author } : {}),
            tags: [...(item.tags ?? [])],
            ...(item.tagEvidence ? { tagEvidence: item.tagEvidence } : {}),
            updatedAt: mirrorUpdatedAt
            })),
            ...sourceFolders.filter((folder) => scanSourceRelationship(folder) === 'bound').flatMap((folder) =>
              (managedMembers[folder.id] ?? []).filter((aid) => !itemsByAid.has(aid)).map((aid) => ({
                aid, title: `Video ${aid}`, tags: [], updatedAt: mirrorUpdatedAt
              }))
            )
          ]
        }
      })
      // Rebuild only deterministic remote bindings after local data was
      // cleared. Duplicate titles stay ordinary mirrors; incomplete reads are
      // pending rather than silently attaching partial membership.
      const mirroredAfterScan = await this.options.repository.getSnapshot(workspace.accountMid)
      const remoteBindingCounts = new Map<string, number>()
      const targetBindingCounts = new Map<string, number>()
      for (const shard of mirroredAfterScan.physicalShards) {
        if (!shard.remoteFolderId) continue
        remoteBindingCounts.set(shard.remoteFolderId, (remoteBindingCounts.get(shard.remoteFolderId) ?? 0) + 1)
        const target = `${shard.logicalLedgerId}:${shard.shardNumber}`
        targetBindingCounts.set(target, (targetBindingCounts.get(target) ?? 0) + 1)
      }
      const recoveredBindings = [] as Array<{
        logicalLedgerId: string
        logicalTitle: string
        shardNumber: number
        memberAids: number[]
        remoteTitle: string
        bindingState: 'bound' | 'pending-reconcile'
        remoteFolderId?: string
        knownRemoteFolderIds?: string[]
        remoteMemberCount: number
      }>
      for (const candidate of recoverableManagedFolders(sourceFolders, managedMembers, deletedDefaultLedgerIds)) {
        const target = `${candidate.logicalLedgerId}:${candidate.shardNumber}`
        const candidateRemoteFolderIds = candidate.bindingState === 'bound'
          ? [candidate.remoteFolderId]
          : candidate.knownRemoteFolderIds ?? [candidate.remoteFolderId]
        if (candidateRemoteFolderIds.some((folderId) => remoteBindingCounts.has(folderId)) || targetBindingCounts.has(target)) continue
        recoveredBindings.push({
          logicalLedgerId: candidate.logicalLedgerId,
          logicalTitle: candidate.logicalTitle,
          shardNumber: candidate.shardNumber,
          memberAids: candidate.bindingState === 'bound' ? candidate.memberAids : [],
          remoteTitle: candidate.remoteTitle,
          bindingState: candidate.bindingState,
          ...(candidate.bindingState === 'bound'
            ? { remoteFolderId: candidate.remoteFolderId }
            : { knownRemoteFolderIds: candidate.knownRemoteFolderIds ?? [candidate.remoteFolderId] }),
          remoteMemberCount: candidate.memberAids.length
        })
        for (const folderId of candidateRemoteFolderIds) remoteBindingCounts.set(folderId, 1)
        targetBindingCounts.set(target, 1)
      }
      for (let start = 0; start < recoveredBindings.length; start += 100) {
        const current = await this.options.repository.getSnapshot(workspace.accountMid)
        await this.options.repository.commit(workspace.accountMid, {
          id: `old-favorite-workspace:recover-managed-bindings:${workspace.id}:${start / 100 + 1}`,
          accountMid: workspace.accountMid,
          issuedAt: mirrorUpdatedAt,
          expectedRevision: current.revision,
          type: 'repair-persisted-managed-bindings',
          payload: {
            workspaceId: workspace.id,
            workspaceStatus: workspace.status,
            bindings: recoveredBindings.slice(start, start + 100),
            placements: []
          }
        })
      }
      const recoveredCustomDrafts = recoveredBindings
        .filter((binding) => binding.bindingState === 'pending-reconcile' && binding.logicalLedgerId.startsWith('custom-'))
        .map((binding, index): FavoriteLedger => ({
          id: binding.logicalLedgerId,
          displayName: binding.logicalTitle.replace(/^bilimi[\u00b7.\s_-]*/i, '').trim() || binding.logicalTitle,
          keywords: [],
          ruleType: 'keyword',
          enabled: false,
          priority: 20_000 + index,
          ...(uniquelyRecoveredRemoteFolderId(binding)
            ? { bilibiliFolderId: uniquelyRecoveredRemoteFolderId(binding) }
            : {}),
          bindingState: 'unbound',
          syncState: 'local-draft',
          isDefault: false
        }))
      if (recoveredCustomDrafts.length) {
        await this.options.saveRecommendedLedgers?.(workspace.accountMid, recoveredCustomDrafts)
      }
      // A scan records remote facts only. Local placement remains the user's intent
      // until an explicit adopt/sync command changes it.
      const mirroredSnapshot = await this.options.repository.getSnapshot(workspace.accountMid)
      const logicalLedgerIdsByRemoteFolderId = new Map<string, Set<string>>()
      for (const shard of mirroredSnapshot.physicalShards) {
        if (shard.bindingState !== 'bound' || !shard.remoteFolderId) continue
        const logicalIds = logicalLedgerIdsByRemoteFolderId.get(shard.remoteFolderId) ?? new Set<string>()
        logicalIds.add(`bilimi-logical:${shard.logicalLedgerId}`)
        logicalLedgerIdsByRemoteFolderId.set(shard.remoteFolderId, logicalIds)
      }
      const observedPhysicalFolderIdsByAid = new Map<number, Set<string>>()
      const recordObservedFolders = (aid: number, folderIds: readonly string[]) => {
        const observed = observedPhysicalFolderIdsByAid.get(aid) ?? new Set<string>()
        for (const folderId of folderIds) observed.add(folderId)
        observedPhysicalFolderIdsByAid.set(aid, observed)
      }
      for (const item of itemsByAid.values()) recordObservedFolders(item.aid, item.sourceFolderIds)
      for (const folder of sourceFolders.filter((candidate) => scanSourceRelationship(candidate) === 'bound')) {
        for (const aid of managedMembers[folder.id] ?? []) recordObservedFolders(aid, [folder.id])
      }
      await this.commitRemoteObservationRepair(workspace.accountMid,
        `old-favorite-workspace:observed:${workspace.id}:${(workspace.baseline?.revision ?? 0) + 1}`,
        observedPhysicalFolderIdsByAid, false, undefined, mirrorUpdatedAt, undefined,
        workspace.mode === 'full', true)
      const lifecycleSnapshot = await this.options.repository.getSnapshot(workspace.accountMid)
      const ordinarySourceFolderIds = new Set(sourceFolders
        .filter(scanSourceIsEligible)
        .map((folder) => folder.id))
      await this.commitScanLifecycle(
        workspace.accountMid,
        `old-favorite-workspace:lifecycle:${workspace.id}:${(workspace.baseline?.revision ?? 0) + 1}`,
        workspace.id,
        'complete',
        Object.values(lifecycleSnapshot.positions).map((position) => {
          const observed = observedPhysicalFolderIdsByAid.get(position.aid)
          return {
            aid: position.aid,
            remoteObserved: Boolean(observed?.size),
            ...(observed?.size ? { remoteFolderIds: [...observed].sort() } : {}),
            ordinarySource: Boolean(observed && [...observed].some((folderId) => ordinarySourceFolderIds.has(folderId)))
          }
        })
      )
      // A scanned bilimi title is only a candidate. Protect a remote member
      // only after an explicit bind has established that this exact physical
      // Bilibili folder belongs to one logical working folder.
      const formalManagedFolderIds = new Set(mirroredSnapshot.physicalShards.flatMap((shard) =>
        shard.bindingState === 'bound' && shard.remoteFolderId &&
          !isStagingBilimiFolder(shard.remoteTitle)
          ? [shard.remoteFolderId]
          : []
      ))
      const formallyArchivedAids = new Set([...formalManagedFolderIds].flatMap((folderId) => managedMembers[folderId] ?? []))
      const successfulAids = repository.organizationRecords
        .filter((record) => {
          if (!organizableItemsByAid.has(record.aid)) return false
          if (record.targetFolderIds.some((folderId) => folderId.startsWith('local:'))) return true
          // A complete inventory is authoritative: remote records only protect
          // videos that remain in a currently observed formal Bilimi folder.
          return sourceFolders.length === 0 || formallyArchivedAids.has(record.aid)
        })
        .map((record) => record.aid)
      const initializedRecords = sourceFolders
        .filter((folder) => formalManagedFolderIds.has(folder.id))
        .flatMap((folder) => (managedMembers[folder.id] ?? []).map((aid) => ({
          accountMid: workspace.accountMid, aid, targetFolderIds: [folder.id], completedAt: this.now()
        })))
      if (initializedRecords.length || !repository.organizationMigrationInitialized) {
        await this.options.repository.commit(workspace.accountMid, {
          id: `old-favorite-workspace:migrate-protection:${workspace.id}`,
          accountMid: workspace.accountMid,
          issuedAt: this.now(),
          type: 'record-organization-protections',
          payload: { records: initializedRecords, markMigrationInitialized: true }
        })
      }
      const protectedAidSet = new Set([...successfulAids, ...initializedRecords.map((record) => record.aid)])
      const plannedAidSet = new Set([...organizableItemsByAid.keys()].filter((aid) => !protectedAidSet.has(aid)))
      const streaming = this.streamingScans.get(workspace.accountMid)
      let sealedSegments: CompleteWorkspaceScanOptions['sealedSegments'] | undefined
      if (streaming) {
        const assigned = new Set<number>()
        sealedSegments = streaming.sealedSegments.map((segment) => ({
          id: segment.id,
          index: segment.index,
          aids: segment.aids.filter((aid) => plannedAidSet.has(aid) && !assigned.has(aid) && (assigned.add(aid) || true))
        })).filter((segment) => segment.aids.length > 0)
        const openAids = [...streaming.openItems.keys()]
          .filter((aid) => plannedAidSet.has(aid) && !assigned.has(aid) && (assigned.add(aid) || true))
        const unassignedAids = [...organizableItemsByAid.keys()]
          .filter((aid) => plannedAidSet.has(aid) && !assigned.has(aid) && (assigned.add(aid) || true))
        const tailAids = [...openAids, ...unassignedAids]
        for (let offset = 0; offset < tailAids.length; offset += streaming.segmentSize) {
          const index = sealedSegments.length
          sealedSegments.push({
            id: `segment-${index + 1}`,
            index,
            aids: tailAids.slice(offset, offset + streaming.segmentSize)
          })
        }
        sealedSegments = sealedSegments.map((segment, index) => ({ ...segment, id: `segment-${index + 1}`, index }))
      }
      const completed = completeWorkspaceScan(workspace, {
        revision: (workspace.baseline?.revision ?? 0) + 1,
        aids: [...organizableItemsByAid.keys()],
        successfullyClassifiedAids: [...successfulAids, ...initializedRecords.map((record) => record.aid)],
        mode: workspace.mode,
        ...(sealedSegments?.length ? { sealedSegments } : {})
      })
      const inventoryMetrics = this.projectInventoryMetrics(
        sourceFolders,
        await this.options.repository.getSnapshot(workspace.accountMid),
        'complete'
      )
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
          items: segment.aids.map((aid) => organizableItemsByAid.get(aid) ?? { aid, sourceFolderIds: [] })
        }))
      })
      const segmentIdForAid = new Map(completed.segments.flatMap((segment) => segment.aids.map((aid) => [aid, segment.id] as const)))
      const recommendationIndex = createRecommendationIndex(
        completed.id,
        organizableItemsByAid.values(),
        (aid) => segmentIdForAid.get(aid) ?? currentSegmentId
      )
      const recommendations = recommendationsFromIndex(recommendationIndex)
      const readiness = this.calculatePlanReadinessFromItems(completed, organizableItemsByAid.values(), sourceFolders)
      const discoveredAids = new Set([
        ...itemsByAid.keys(),
        ...Object.values(managedMembers).flat()
      ])
      // Keep the same inventory scope before and after finalization: this is
      // every Bilibili favorite relationship reported by the folder directory,
      // including Bilimi work folders and duplicate video placements.
      const totalItemCount = sourceFolders.reduce((count, folder) => count + Math.max(0, folder.itemCount), 0)
      const taggedItemCount = [...organizableItemsByAid.values()].filter((item) => Boolean(item.tags?.length)).length
      const completedScan = {
        phase: 'complete' as const,
        failureCount: 0,
        mode: completed.mode,
        totalItemCount,
        scannedItemCount: discoveredAids.size,
        taggedItemCount,
        untaggedItemCount: organizableItemsByAid.size - taggedItemCount
      }
      const pendingTagAids = completed.plannedAids
        .map((aid) => organizableItemsByAid.get(aid))
        .filter((item): item is CurrentSegmentItem => Boolean(item))
        .filter((item) => !item.tags?.length && item.tagEvidence !== 'confirmed')
        .map((item) => item.aid)
        .sort((left, right) => left - right)
      const tagEnrichment: TagEnrichment = {
        status: pendingTagAids.length ? 'running' : 'complete',
        totalItemCount: pendingTagAids.length,
        completedItemCount: 0,
        pendingAids: pendingTagAids,
        failedAids: [],
        reusedTagItemCount,
        taggedAids: [],
        confirmedUntaggedAids: [],
        acceptedSegmentIds: []
      }
      const overviewRuntime = this.initializeOverviewRuntime(completed, itemsByAid.values(),
        [...itemsByAid.values()].filter((item) => isUnavailableScanItem(item)).length)
      await this.options.workspaceStore.appendOverlay(completed.accountMid, completed.id, {
        currentSegmentId, classifications: [], history: [], recommendations, planReadiness: readiness,
        scanMetadata: { sourceFolders, ...completedScan, inventoryMetrics }, tagEnrichment,
        overview: this.persistedOverviewRuntime(overviewRuntime)
      })
      const descriptors = completed.segments.map(({ id, index, aids }) => ({ id, index, itemCount: aids.length }))
      await this.appendEvents(completed, currentSegmentId, [{
        type: 'scan', createdAt: completed.createdAt, mode: completed.mode, scope: clone(completed.scope), segmentSize: completed.segmentSize,
        segments: descriptors, baselineCompletedAids: [...completed.baselineCompletedAids]
      }])
      await this.persistMarker(completed)
      this.scanOverviews.set(completed.accountMid, {
        sourceFolders: this.scanOverviews.get(completed.accountMid)?.sourceFolders ?? [],
        scan: completedScan
      })
      this.inventoryMetrics.set(completed.accountMid, inventoryMetrics)
      this.scanRuns.delete(completed.accountMid)
      this.scannedAids.delete(completed.accountMid)
      this.scannedTagStates.delete(completed.accountMid)
      this.streamingScans.delete(completed.accountMid)
      this.tagEnrichments.set(completed.accountMid, tagEnrichment)
      this.recommendations.set(completed.accountMid, clone(recommendations))
      this.recommendationIndexes.set(completed.accountMid, recommendationIndex)
      this.planReadiness.set(completed.accountMid, readiness)
      this.remember(completed, currentSegmentId, descriptors, new Set())
      this.currentSegmentItems.set(completed.accountMid, completed.segments[0]?.aids.map((aid) => clone(organizableItemsByAid.get(aid) ?? {
        aid, sourceFolderIds: []
      })) ?? [])
      // Current bridge pages always carry this classification metadata; older
      // recovered staging files do not, so preserve their explicit re-run flow.
      const hasClassificationSignals = [...itemsByAid.values()].some((item) => item.tags !== undefined || item.category !== undefined)
      if ((this.options.classifyCurrentItem || this.options.classifyCurrentItems) && hasClassificationSignals) {
        if (tagEnrichment.pendingAids.length === 0) {
          return this.checkpointInitialSystemClassificationsUnsafe(await this.autoClassifyAllSegmentsUnsafe(completed, true))
        }
        const pendingAids = new Set(tagEnrichment.pendingAids)
        if (!completed.segments[0]?.aids.some((aid) => pendingAids.has(aid))) {
          return this.checkpointInitialSystemClassificationsUnsafe(await this.autoClassifyCurrentSegmentUnsafe(completed, true))
        }
      }
      return clone(completed)
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
        scan: {
          phase: 'failed', failureCount: prior.scan.failureCount + 1, mode: prior.scan.mode, reason: reason.slice(0, 256),
          ...(Number.isSafeInteger(prior.scan.totalItemCount) ? { totalItemCount: prior.scan.totalItemCount } : {}),
          ...(Number.isSafeInteger(prior.scan.scannedItemCount) ? { scannedItemCount: prior.scan.scannedItemCount } : {}),
          ...(Number.isSafeInteger(prior.scan.taggedItemCount) ? { taggedItemCount: prior.scan.taggedItemCount } : {}),
          ...(Number.isSafeInteger(prior.scan.untaggedItemCount) ? { untaggedItemCount: prior.scan.untaggedItemCount } : {}),
          ...(isBilibiliHtml412(reason)
            ? { retryAvailableAt: new Date(Date.parse(this.now()) + bilibiliRiskControlCooldownMs).toISOString() }
            : {})
        }
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
      const observedSourceFolders = this.scanOverviews.get(completed.accountMid)?.sourceFolders
      const sourceFolders = observedSourceFolders?.length ? observedSourceFolders : [{
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
        scope: clone(completed.scope),
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
      const restored = await this.restoreFromStore(snapshot.workspace, snapshot.updatedAt, snapshot, {
        pauseRunningTagEnrichment: false
      })
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
      this.assertCurrentSegmentTagReady(workspace)
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
      const frozenIds = new Set(this.frozenSegments.get(workspace.accountMid) ?? [])
      frozenIds.delete(currentSegmentId)
      this.remember(updated, currentSegmentId, this.segmentDescriptors.get(workspace.accountMid) ?? [], frozenIds)
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
    if (assignments.length > MAX_OLD_FAVORITE_WORKSPACE_SEGMENT_SIZE || assignments.some((assignment) =>
      assignment.targetLedgerIds.length > 3 || assignment.targetLedgerIds.some((id) => id.trim().length > 128))) {
      throw new Error('Old favorite workspace DeepSeek classification is invalid.')
    }
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      this.assertCurrentSegmentTagReady(workspace)
      const currentSegmentId = this.currentSegment(workspace)
      const selectedSourceFolderIds = (this.scanOverviews.get(workspace.accountMid)?.sourceFolders ?? [])
        .filter((folder) => scanSourceIsEligible(folder) && folder.selected)
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
      const currentItemsByAid = new Map((this.currentSegmentItems.get(workspace.accountMid) ?? []).map((item) => [item.aid, item]))
      const normalizedAssignments = new Map(assignments.map((assignment) => [assignment.aid, {
        aid: assignment.aid,
        targetLedgerIds: [...new Set(assignment.targetLedgerIds.map((id) => id.trim()).filter(Boolean))].sort()
      }]))
      const processedItems: OldFavoriteWorkspaceDeepSeekProcessedItem[] = [...normalizedAssignments.values()]
        .sort((left, right) => left.aid - right.aid)
        .map((assignment) => {
          const beforeTargetLedgerIds = [...(workspace.classifications[String(assignment.aid)]?.targetLedgerIds ?? [])]
          const title = currentItemsByAid.get(assignment.aid)?.title?.trim().slice(0, 160)
          return {
            aid: assignment.aid,
            ...(title ? { title } : {}),
            beforeTargetLedgerIds,
            afterTargetLedgerIds: [...assignment.targetLedgerIds],
            changed: JSON.stringify(beforeTargetLedgerIds) !== JSON.stringify(assignment.targetLedgerIds)
          }
        })
      const applied = applyWorkspaceClassificationBatch(workspace, { source: 'deepseek', assignments })
      const entry: OldFavoriteWorkspaceHistoryEntry = {
        ...(applied === workspace ? { source: 'deepseek' as const, changes: [] } : applied.history[applied.history.length - 1]!),
        deepSeekProcessedItems: processedItems
      }
      const history = applied === workspace
        ? [...workspace.history.slice(0, workspace.historyCursor), entry]
        : [...applied.history.slice(0, -1), entry]
      const updated: OldFavoriteWorkspace = { ...applied, history, historyCursor: history.length }
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
      const frozenIds = new Set(this.frozenSegments.get(workspace.accountMid) ?? [])
      frozenIds.delete(currentSegmentId)
      this.remember(updated, currentSegmentId, this.segmentDescriptors.get(workspace.accountMid) ?? [], frozenIds)
      return clone(updated)
    })
  }

  /** Classifies only the selected current segment; user and DeepSeek decisions remain authoritative. */
  async autoClassifyCurrentSegment(accountMid: string): Promise<OldFavoriteWorkspace> {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      this.assertCurrentSegmentTagReady(workspace)
      return this.autoClassifyCurrentSegmentUnsafe(workspace, false, true)
    })
  }

  async pauseScan(accountMid: string): Promise<OldFavoriteWorkspaceSnapshot> {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      if (workspace.status !== 'scanning') throw new Error('Old favorite workspace scan is not active.')
      const runId = this.scanRuns.get(workspace.accountMid)
      if (!runId) throw new Error('Old favorite workspace scan needs an explicit rescan.')
      const prior = this.scanOverviews.get(workspace.accountMid) ?? {
        sourceFolders: [], scan: { phase: 'inventory' as const, failureCount: 0, mode: workspace.mode }
      }
      const scan = { ...prior.scan, phase: 'inventory' as const, paused: true }
      await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
        currentSegmentId: '', classifications: [], history: [],
        scanMetadata: { sourceFolders: prior.sourceFolders, ...scan }
      })
      this.scanOverviews.set(workspace.accountMid, { ...prior, scan })
      return this.createSnapshot(workspace)
    })
  }

  /** Explicitly reclaims a durable scanning lease after restart; it never starts a fresh scan. */
  async resumeScan(accountMid: string): Promise<OldFavoriteWorkspaceSnapshot> {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      if (workspace.status !== 'scanning') throw new Error('Old favorite workspace scan is not resumable.')
      if (!this.scanRuns.get(workspace.accountMid)) throw new Error('Old favorite workspace scan needs an explicit rescan.')
      const prior = this.scanOverviews.get(workspace.accountMid)
      if (prior?.scan.paused) {
        const scan = { ...prior.scan, paused: false }
        await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
          currentSegmentId: '', classifications: [], history: [],
          scanMetadata: { sourceFolders: prior.sourceFolders, ...scan }
        })
        this.scanOverviews.set(workspace.accountMid, { ...prior, scan })
      }
      if (prior?.scan.phase === 'failed') {
        if (prior.scan.retryAvailableAt && Date.parse(this.now()) < Date.parse(prior.scan.retryAvailableAt)) {
          throw new Error(`retry-cooldown; ${prior.scan.reason ?? 'bilibili-risk-control'}; retry-at=${prior.scan.retryAvailableAt}`)
        }
        const { reason: _reason, retryAvailableAt: _retryAvailableAt, ...retained } = prior.scan
        const scan = { ...retained, phase: 'inventory' as const, paused: false }
        await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
          currentSegmentId: '', classifications: [], history: [],
          scanMetadata: { sourceFolders: prior.sourceFolders, ...scan }
        })
        this.scanOverviews.set(workspace.accountMid, { sourceFolders: prior.sourceFolders, scan })
      }
      return this.createSnapshot(workspace)
    })
  }

  /** Trusted scan runners use this cursor to skip pages already persisted before interruption. */
  async getScanResumeState(accountMid: string) {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      if (workspace.status !== 'scanning') throw new Error('Old favorite workspace scan is not active.')
      const runId = this.scanRuns.get(workspace.accountMid)
      if (!runId) throw new Error('Old favorite workspace scan needs an explicit rescan.')
      const pages = await this.options.workspaceStore.readScanPageCursors(workspace.accountMid, workspace.id)
      const taggedAids = [...(this.scannedTagStates.get(workspace.accountMid) ?? new Map<number, boolean>()).entries()]
        .filter(([, tagged]) => tagged).map(([aid]) => aid).sort((left, right) => left - right)
      return {
        runId,
        completedPages: pages.map((page) => ({ folderId: page.folderId, page: page.page,
          ...(typeof page.hasMore === 'boolean' ? { hasMore: page.hasMore } : {}) })),
        taggedAids
      }
    })
  }

  /**
   * Reads only the repository marker plus the workspace manifest. In
   * particular, this must not load a baseline segment, start scanning, invoke
   * DeepSeek, reconcile, or resume a frozen remote plan.
   */
  async getRecoverySummary(accountMid: string): Promise<OldFavoriteWorkspaceRecoverySummary | null> {
    return this.queue(() => this.getRecoverySummaryUnsafe(accountMid))
  }

  /**
   * A recovery decision is an acknowledgement guarded by both revisions. It
   * deliberately has no side effect: callers must separately request a full
   * workspace load or a scan after showing the observed changes to the user.
   */
  async selectRecoveryDecision(
    accountMid: string,
    decision: OldFavoriteWorkspaceRecoveryDecision
  ): Promise<OldFavoriteWorkspaceRecoveryDecisionResult> {
    return this.queue(async () => {
      const summary = await this.getRecoverySummaryUnsafe(accountMid)
      if (!summary || summary.workspaceId !== decision.workspaceId) {
        throw new Error('Old favorite workspace recovery decision does not match the active workspace.')
      }
      if (summary.currentStep === 'result-unknown') {
        throw new Error('Old favorite workspace result must be reconciled before it can be resumed.')
      }
      const evidence = summary.baselineChangeEvidence
      if (decision.expectedBaselineRevision !== evidence.workspaceBaselineRevision ||
        decision.expectedRepositoryRevision !== evidence.repositoryRevision) {
        throw new Error('Old favorite workspace recovery baseline changed; read a new recovery summary first.')
      }
      if (!summary.recoveryChoices.includes(decision.choice)) {
        throw new Error('Old favorite workspace recovery decision is not available for this workspace.')
      }
      // `merge-latest` adopts only the latest durable *facts* as the new
      // recovery baseline. Classifications themselves remain in the workspace
      // journal: its priority rules keep manual decisions authoritative and
      // retain DeepSeek choices for explicit user review rather than silently
      // replaying either source here.
      let decisionFingerprint = evidence.fingerprint
      let mergeLatestSystemAids: number[] | undefined
      let staleDeepSeekAids: number[] | undefined
      if (decision.choice === 'merge-latest') {
        const recovered = await this.options.workspaceStore.readRecoverySummary(summary.accountMid, summary.workspaceId)
        if ('recovery' in recovered || !recovered.recoveryBaseline) {
          throw new Error('Old favorite workspace recovery baseline is unavailable.')
        }
        const current = recoveryBaselineVector(await this.options.repository.getSnapshot(summary.accountMid), recovered.recoveryBaseline.aids,
          await this.options.resolveRecoveryConfiguration?.(summary.accountMid))
        mergeLatestSystemAids = changedRecoverySystemAids(recovered.recoveryBaseline, current, evidence.changedDimensions)
        if (evidence.deepSeekClassificationsMayBeStale) {
          const full = await this.options.workspaceStore.recover(summary.accountMid, summary.workspaceId)
          if ('recovery' in full) throw new Error('Old favorite workspace requires rebuild.')
          staleDeepSeekAids = Object.values(full.classifications)
            .filter((classification) => classification.source === 'deepseek')
            .map((classification) => classification.aid).sort((left, right) => left - right)
        }
        await this.options.workspaceStore.setRecoveryBaseline(summary.accountMid, summary.workspaceId, current)
        decisionFingerprint = current.fingerprint
      }
      await this.options.workspaceStore.setRecoveryDecision(accountMid, summary.workspaceId, {
        choice: decision.choice,
        expectedBaselineRevision: decision.expectedBaselineRevision,
        expectedRepositoryRevision: decision.expectedRepositoryRevision,
        ...(decisionFingerprint ? { evidenceFingerprint: decisionFingerprint } : {}),
        ...(mergeLatestSystemAids?.length ? { mergeLatestSystemAids } : {}),
        ...(staleDeepSeekAids?.length ? { staleDeepSeekAids } : {}),
        ...(mergeLatestSystemAids?.length ? { mergeLatestAppliedAt: this.now() } : {}),
        recordedAt: this.now()
      })
      return {
        accountMid: summary.accountMid,
        workspaceId: summary.workspaceId,
        choice: decision.choice,
        manualClassificationsRemainAuthoritative: true,
        requiresFullWorkspaceLoad: decision.choice !== 'rescan',
        requiresExplicitScan: decision.choice === 'rescan'
      }
    })
  }

  private async getRecoverySummaryUnsafe(accountMid: string): Promise<OldFavoriteWorkspaceRecoverySummary | null> {
    const snapshot = await this.options.repository.getSnapshot(accountMid)
    const marker = snapshot.workspace
    if (!marker) return null
    if (marker.status === 'draft') {
      if (marker.resumable === true) {
        return {
          accountMid: snapshot.accountMid,
          workspaceId: marker.id,
          status: 'draft',
          currentStep: 'draft',
          baselineChangeEvidence: recoveryBaselineChangeEvidence(marker.workspaceRef.baselineRevision, snapshot.revision, undefined, snapshot,
            await this.options.resolveRecoveryConfiguration?.(snapshot.accountMid)),
          recoveryChoices: ['view', 'rescan']
        }
      }
      return {
        accountMid: snapshot.accountMid,
        workspaceId: marker.id,
        status: 'rebuild-required',
        currentStep: 'rebuild-required',
        baselineChangeEvidence: recoveryBaselineChangeEvidence(marker.workspaceRef.baselineRevision, snapshot.revision, undefined, snapshot,
          await this.options.resolveRecoveryConfiguration?.(snapshot.accountMid)),
        recoveryChoices: ['view']
      }
    }
    const summary = await this.options.workspaceStore.readRecoverySummary(snapshot.accountMid, marker.id)
    if ('recovery' in summary) {
      return {
        accountMid: snapshot.accountMid,
        workspaceId: marker.id,
        status: 'rebuild-required',
        currentStep: 'rebuild-required',
        baselineChangeEvidence: recoveryBaselineChangeEvidence(marker.workspaceRef.baselineRevision, snapshot.revision, undefined, snapshot,
          await this.options.resolveRecoveryConfiguration?.(snapshot.accountMid)),
        recoveryChoices: ['view']
      }
    }
    // The manifest is the persisted baseline source. A disagreement with the
    // compact repository marker is an integrity failure, not a merge choice.
    const baselineChangeEvidence = recoveryBaselineChangeEvidence(summary.baselineRevision, snapshot.revision,
      summary.recoveryBaseline, snapshot, await this.options.resolveRecoveryConfiguration?.(snapshot.accountMid))
    if (summary.baselineRevision !== marker.workspaceRef.baselineRevision) {
      return {
        accountMid: snapshot.accountMid,
        workspaceId: marker.id,
        status: 'rebuild-required',
        currentStep: 'rebuild-required',
        baselineChangeEvidence,
        recoveryChoices: ['view']
      }
    }
    const currentStep = marker.workspaceRef.currentStep ?? marker.status
    const plannedCount = marker.workspaceRef.plannedCount ?? summary.plannedCount
    const classifiedCount = marker.workspaceRef.classifiedCount ?? summary.classifiedCount
    const unclassifiedCount = marker.workspaceRef.unclassifiedCount ?? summary.unclassifiedCount
    const canRescan = (marker.status === 'scanning' || marker.status === 'previewing') && !marker.frozenSyncPlan
    const canAbandon = marker.status === 'previewing' && !marker.frozenSyncPlan
    const recoveryChoices = currentStep === 'result-unknown'
      ? ['view', 'reconcile-result-unknown'] as const
      : marker.status === 'completed'
        ? ['view'] as const
        : [
            'view',
            'continue-original',
            ...(baselineChangeEvidence.changed ? ['merge-latest'] as const : []),
            ...(canRescan ? ['rescan'] as const : []),
            ...(canAbandon ? ['abandon'] as const : [])
          ] as const
    return {
      accountMid: snapshot.accountMid,
      workspaceId: marker.id,
      status: marker.status,
      currentSegmentId: marker.workspaceRef.currentSegmentId,
      currentStep,
      ...(plannedCount !== undefined ? { plannedCount } : {}),
      ...(classifiedCount !== undefined ? { classifiedCount } : {}),
      ...(unclassifiedCount !== undefined ? { unclassifiedCount } : {}),
      manifestChecksum: summary.manifestChecksum,
      ...(marker.workspaceRef.lastCommittedId ? { lastCommittedId: marker.workspaceRef.lastCommittedId } : {}),
      baselineChangeEvidence,
      recoveryChoices: [...recoveryChoices],
      ...(currentStep === 'result-unknown' ? {
        resultUnknownEvidence: {
          operationCount: marker.frozenSyncPlan?.operations.length ?? 0,
          ...(marker.frozenSyncPlan ? { planId: marker.frozenSyncPlan.id } : {})
        }
      } : {})
    }
  }

  /** Discards a draft before any Bilibili operation has been started. */
  async abandonCurrentWorkspace(accountMid: string): Promise<void> {
    return this.queue(async () => {
      const persisted = await this.options.repository.getSnapshot(accountMid)
      if (!persisted.workspace) {
        this.forgetWorkspace(persisted.accountMid)
        return
      }
      const workspace = await this.requireWorkspace(persisted.accountMid)
      if (workspace.status === 'frozen') {
        if (!this.options.syncService) throw new Error('Old favorite workspace sync service is unavailable.')
        await this.commitCompleteLocalResultForRemoteExecutionUnsafe(workspace)
        await this.options.syncService.abandonFrozenPlan(workspace.accountMid)
      } else {
        if (workspace.status !== 'previewing') throw new Error('Old favorite workspace cannot be abandoned while it is active.')
        await this.options.repository.commit(workspace.accountMid, {
          id: `old-favorite-workspace:abandon:${workspace.id}`,
          accountMid: workspace.accountMid,
          issuedAt: this.now(),
          type: 'abandon-workspace',
          payload: { workspaceId: workspace.id }
        })
      }
      this.forgetWorkspace(workspace.accountMid)
    })
  }

  /** Replaces derived system results after an explicit saved rule configuration change. */
  async reclassifyForFavoriteConfiguration(accountMid: string): Promise<OldFavoriteWorkspace> {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      return workspace.status === 'previewing'
        ? this.autoClassifyAllSegmentsUnsafe(workspace, true, true)
        : clone(workspace)
    })
  }

  async previewManagedFolderDeletion(accountMid: string, logicalLedgerIds: string[], ledgerTitleHints?: Record<string, string>) {
    if (!this.options.syncService) throw new Error('Old favorite workspace sync service is unavailable.')
    return this.options.syncService.previewManagedFolderDeletion(accountMid, logicalLedgerIds, ledgerTitleHints)
  }

  async deleteManagedFolderCandidates(
    accountMid: string,
    logicalLedgerIds: string[],
    acknowledgeUnboundRemoteDeletion = false,
    ledgerTitleHints?: Record<string, string>,
    expectedRemoteFolderIds?: Record<string, string[]>
  ) {
    if (!this.options.syncService) throw new Error('Old favorite workspace sync service is unavailable.')
    const deletion = await this.options.syncService.deleteManagedFolders(accountMid, logicalLedgerIds, acknowledgeUnboundRemoteDeletion, ledgerTitleHints, expectedRemoteFolderIds)
    const succeededRemoteFolderIds = new Set(deletion.succeededRemoteFolderIds)
    const remoteFolderIdsByLedgerId = new Map<string, Set<string>>()
    for (const candidate of deletion.candidates) {
      if (!candidate.remoteFolderId || !succeededRemoteFolderIds.has(candidate.remoteFolderId)) continue
      const remoteFolderIds = remoteFolderIdsByLedgerId.get(candidate.logicalLedgerId) ?? new Set<string>()
      remoteFolderIds.add(candidate.remoteFolderId)
      remoteFolderIdsByLedgerId.set(candidate.logicalLedgerId, remoteFolderIds)
    }
    const confirmedDeletions = [...remoteFolderIdsByLedgerId]
      .map(([logicalLedgerId, remoteFolderIds]) => ({
        logicalLedgerId,
        remoteFolderIds: [...remoteFolderIds].sort(),
        remoteDeleted: true
      }))
      .sort((left, right) => left.logicalLedgerId.localeCompare(right.logicalLedgerId))
    if (confirmedDeletions.length) await this.options.onManagedFolderDeletion?.(accountMid, confirmedDeletions)
    return deletion
  }

  async deleteManagedRemoteFolderCandidates(
    accountMid: string,
    logicalLedgerIds: string[],
    acknowledgeUnboundRemoteDeletion = false,
    ledgerTitleHints?: Record<string, string>,
    expectedRemoteFolderIds?: Record<string, string[]>
  ) {
    if (!this.options.syncService) throw new Error('Old favorite workspace sync service is unavailable.')
    return this.options.syncService.deleteManagedRemoteFolders(accountMid, logicalLedgerIds, acknowledgeUnboundRemoteDeletion, ledgerTitleHints, expectedRemoteFolderIds)
  }

  private async autoClassifyCurrentSegmentUnsafe(
    workspace: OldFavoriteWorkspace,
    replaceSystem: boolean,
    replaceUserChoices = false
  ) {
    return this.autoClassifySegmentsUnsafe(workspace, [this.currentSegment(workspace)], replaceSystem, undefined, undefined, replaceUserChoices)
  }

  private async applyRecommendedLedgerDeltaUnsafe(
    workspace: OldFavoriteWorkspace,
    beforeIds: string[],
    afterIds: string[],
    nextState: RecommendationState
  ) {
    const changedIds = new Set([
      ...beforeIds.filter((id) => !afterIds.includes(id)),
      ...afterIds.filter((id) => !beforeIds.includes(id))
    ])
    if (!changedIds.size || (!this.options.classifyCurrentItem && !this.options.classifyCurrentItems)) {
      return clone(workspace)
    }
    const affectedAids = new Set<number>()
    const affectedSegmentIds = new Set<string>()
    for (const candidate of nextState.candidates) {
      if (!changedIds.has(candidate.id)) continue
      for (const [segmentId, aids] of Object.entries(candidate.matchedAidsBySegment ?? {})) {
        affectedSegmentIds.add(segmentId)
        for (const aid of aids) affectedAids.add(aid)
      }
    }
    if (!affectedAids.size) return clone(workspace)
    const descriptors = (this.segmentDescriptors.get(workspace.accountMid) ?? workspace.segments
      .map(({ id, index, aids }) => ({ id, index, itemCount: aids.length })))
      .filter((segment) => affectedSegmentIds.has(segment.id))
    if (!descriptors.length) return clone(workspace)

    const recovered = await this.options.workspaceStore.recover(workspace.accountMid, workspace.id)
    if ('recovery' in recovered) throw new Error('Old favorite workspace requires rebuild.')
    const journalState = replayClassificationJournal(recovered.overlayHistory)
    const tagUpdates = new Map(recovered.tagUpdates.map((update) => [update.aid, update.tags]))
    const sourceFolders = this.scanOverviews.get(workspace.accountMid)?.sourceFolders ?? []
    const selectedSourceFolderIds = new Set(sourceFolders
      .filter((folder) => scanSourceIsEligible(folder) && folder.selected).map((folder) => folder.id))
    const hasSelectableSources = sourceFolders.some(scanSourceIsEligible)
    const itemsBySegment = new Map<string, CurrentSegmentItem[]>()
    const candidates: CurrentSegmentItem[] = []
    for (const descriptor of descriptors) {
      const stored = await this.options.workspaceStore.loadSegment(workspace.accountMid, workspace.id, descriptor.id)
      const items = (stored.items ?? []).map((item) => ({
        ...item, ...(tagUpdates.has(item.aid) ? { tags: tagUpdates.get(item.aid) } : {})
      }))
      itemsBySegment.set(descriptor.id, items)
      candidates.push(...items
        .filter((item) => affectedAids.has(item.aid) && !isUnavailableScanItem(item))
        .filter((item) => !hasSelectableSources || item.sourceFolderIds.some((folderId) => selectedSourceFolderIds.has(folderId))))
    }
    const adopted = new Set(nextState.adoptedCandidateIds)
    const recommendedLedgers = nextState.candidates.filter((candidate) => adopted.has(candidate.id))
      .map((candidate, index) => asLocalRecommendedLedger(candidate, index))
    const excludedRecommendedLedgers = nextState.candidates.filter((candidate) => !adopted.has(candidate.id))
      .map((candidate, index) => asLocalRecommendedLedger(candidate, index))
    const classifications = this.options.classifyCurrentItems
      ? await this.options.classifyCurrentItems(candidates.map(clone), clone(recommendedLedgers), workspace.accountMid, {
          excludedRecommendedLedgers: clone(excludedRecommendedLedgers)
        })
      : await Promise.all(candidates.map((item) => recommendedLedgers.length
        ? this.options.classifyCurrentItem!(clone(item), clone(recommendedLedgers))
        : this.options.classifyCurrentItem!(clone(item))))
    if (classifications.length !== candidates.length) {
      throw new Error('Old favorite workspace automatic classification result is invalid.')
    }

    let globalClassifications: OldFavoriteWorkspace['classifications'] = Object.fromEntries(
      [...journalState.classifications].map(([aid, classification]) => [String(aid), clone(classification)]))
    const proposed = candidates.map((item, index) => ({ aid: item.aid, proposal: classifications[index]! }))
    const newEntries: Array<{ segmentId: string; entry: OldFavoriteWorkspaceHistoryEntry; historyCursor: number }> = []
    for (const descriptor of descriptors) {
      const segmentAids = (itemsBySegment.get(descriptor.id) ?? []).map((item) => item.aid)
      let segmentWorkspace: OldFavoriteWorkspace = {
        ...workspace,
        status: 'previewing',
        baseline: { revision: workspace.baseline?.revision ?? recovered.baselineRevision, aids: segmentAids },
        plannedAids: segmentAids,
        segments: [{
          id: descriptor.id, index: descriptor.index, aids: segmentAids,
          status: this.frozenSegments.get(workspace.accountMid)?.has(descriptor.id) ? 'frozen' : 'previewing'
        }],
        classifications: globalClassifications,
        history: clone(journalState.entriesBySegment.get(descriptor.id) ?? []),
        historyCursor: journalState.cursorBySegment.get(descriptor.id) ?? 0
      }
      for (const source of ['system-high', 'system-low'] as const) {
        const assignments = proposed
          .filter(({ aid, proposal }) => segmentAids.includes(aid) &&
            proposal.confidence === (source === 'system-high' ? 'high' : 'low'))
          .map(({ aid, proposal }) => ({ aid, targetLedgerIds: proposal.targetLedgerIds.slice(0, 1) }))
        if (!assignments.length) continue
        const classified = applyWorkspaceClassificationBatch(segmentWorkspace, { source, assignments })
        if (classified === segmentWorkspace) continue
        newEntries.push({
          segmentId: descriptor.id,
          entry: clone(classified.history[classified.history.length - 1]!),
          historyCursor: classified.historyCursor
        })
        globalClassifications = classified.classifications
        segmentWorkspace = classified
      }
    }
    if (!newEntries.length) return clone(workspace)

    const readiness = this.calculatePlanReadinessFromClassifications(workspace, globalClassifications)
    await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
      currentSegmentId: this.currentSegment(workspace),
      classifications: newEntries.flatMap(({ entry }) => entry.changes.flatMap((change) => change.after ? [{
        aid: change.after.aid,
        targetLedgerIds: [...change.after.targetLedgerIds],
        source: change.after.source
      }] : [])),
      history: newEntries.map(({ segmentId, entry, historyCursor }) => encodeJournalEvent({
        type: 'classification', segmentId, entry: clone(entry), historyCursor
      })),
      planReadiness: readiness
    })
    this.updateOverviewClassifications(workspace.accountMid, newEntries)
    this.planReadiness.set(workspace.accountMid, readiness)
    const visibleSegmentId = this.currentSegment(workspace)
    const visibleAidSet = new Set(workspace.segments.flatMap((segment) => segment.aids))
    const visibleEntries = newEntries.filter(({ segmentId }) => segmentId === visibleSegmentId).map(({ entry }) => ({
      ...clone(entry), changes: entry.changes.filter((change) => visibleAidSet.has(change.aid)).map(clone)
    })).filter((entry) => entry.changes.length > 0)
    const visibleHistory = [...workspace.history.slice(0, workspace.historyCursor), ...visibleEntries]
    const visibleUpdated: OldFavoriteWorkspace = {
      ...workspace,
      status: visibleEntries.length ? 'previewing' : workspace.status,
      segments: workspace.segments.map((segment) => visibleEntries.length && segment.id === visibleSegmentId
        ? { ...segment, status: 'previewing' as const }
        : segment),
      classifications: Object.fromEntries(Object.entries(globalClassifications)
        .filter(([aid]) => visibleAidSet.has(Number(aid))).map(([aid, classification]) => [aid, clone(classification)])),
      history: visibleHistory,
      historyCursor: visibleHistory.length
    }
    const frozenIds = new Set(this.frozenSegments.get(workspace.accountMid) ?? [])
    for (const { segmentId } of newEntries) frozenIds.delete(segmentId)
    this.remember(visibleUpdated, visibleSegmentId, this.segmentDescriptors.get(workspace.accountMid) ?? [], frozenIds)
    return clone(visibleUpdated)
  }

  /** Classification is global; the visible segment only limits rendering, never scan coverage. */
  private async autoClassifyAllSegmentsUnsafe(
    workspace: OldFavoriteWorkspace,
    replaceSystem: boolean,
    replaceUserChoices = false
  ) {
    return this.autoClassifySegmentsUnsafe(workspace, workspace.segments.map((segment) => segment.id), replaceSystem, undefined, undefined, replaceUserChoices)
  }

  /** Makes scan-generated system results the durable state behind “恢复初始改动”. */
  private async checkpointInitialSystemClassificationsUnsafe(workspace: OldFavoriteWorkspace) {
    const baselineCursor = workspace.historyBaselineCursor ?? 0
    const initialEntries = workspace.history.slice(baselineCursor, workspace.historyCursor)
    if (!initialEntries.length || !initialEntries.every((entry) => entry.source === 'system-high' || entry.source === 'system-low')) {
      return clone(workspace)
    }
    const updated = { ...workspace, historyBaselineCursor: workspace.historyCursor }
    await this.appendEvents(updated, this.currentSegment(updated), [{
      type: 'history-baseline', historyCursor: updated.historyBaselineCursor
    }])
    this.workspaces.set(updated.accountMid, updated)
    return clone(updated)
  }

  private async autoClassifySegmentsUnsafe(
    workspace: OldFavoriteWorkspace,
    segmentIds: string[],
    replaceSystem: boolean,
    onlyAids?: ReadonlySet<number>,
    recommendationState?: RecommendationState,
    replaceUserChoices = false
  ) {
    const classify = this.options.classifyCurrentItem
    const classifyMany = this.options.classifyCurrentItems
    if (!classify && !classifyMany) throw new Error('Old favorite workspace automatic classification is unavailable.')
    const state = recommendationState ?? await this.ensureRecommendations(workspace)
    const adopted = new Set(state.adoptedCandidateIds)
    const recommendedLedgers = state.candidates.filter((candidate) => adopted.has(candidate.id)).map((candidate, index) => ({
      id: candidate.id, displayName: candidate.displayName, keywords: [...candidate.keywords],
      ruleType: candidate.kind === 'author' ? 'author' as const : candidate.kind === 'tag' ? 'tag' as const : 'keyword' as const,
      enabled: true, priority: index, isDefault: false
    }))
    const excludedRecommendedLedgers = state.candidates.filter((candidate) => !adopted.has(candidate.id))
      .map((candidate, index) => asLocalRecommendedLedger(candidate, index))
    const recovered = await this.options.workspaceStore.recover(workspace.accountMid, workspace.id)
    if ('recovery' in recovered) throw new Error('Old favorite workspace requires rebuild.')
    const tagUpdates = new Map(recovered.tagUpdates.map((update) => [update.aid, update.tags]))
    const selectedSourceFolderIds = new Set((this.scanOverviews.get(workspace.accountMid)?.sourceFolders ?? [])
      .filter((folder) => scanSourceIsEligible(folder) && folder.selected).map((folder) => folder.id))
    const hasSelectableSources = (this.scanOverviews.get(workspace.accountMid)?.sourceFolders ?? [])
      .some(scanSourceIsEligible)
    let updated = workspace
    const visibleSegmentId = this.currentSegment(workspace)
    const visibleItems = this.currentSegmentItems.get(workspace.accountMid)
    const editedSegmentIds = new Set<string>()
    try {
      for (const segmentId of segmentIds) {
        const segment = updated.segments.find((candidate) => candidate.id === segmentId)
        if (!segment) throw new Error('Old favorite workspace segment is unavailable.')
        const stored = await this.options.workspaceStore.loadSegment(updated.accountMid, updated.id, segment.id)
        const items = (stored.items ?? []).map((item) => ({ ...item, ...(tagUpdates.has(item.aid) ? { tags: tagUpdates.get(item.aid) } : {}) }))
        this.currentSegmentItems.set(updated.accountMid, items.map(clone))
        const candidates = items
          .filter((item) => !isUnavailableScanItem(item))
          .filter((item) => !hasSelectableSources || item.sourceFolderIds.some((folderId) => selectedSourceFolderIds.has(folderId)))
          .filter((item) => !onlyAids || onlyAids.has(item.aid))
          .filter((item) => replaceUserChoices || !['manual', 'deepseek'].includes(updated.classifications[String(item.aid)]?.source ?? ''))
        const classifications = classifyMany
          ? await classifyMany(candidates.map(clone), clone(recommendedLedgers), updated.accountMid, {
              excludedRecommendedLedgers: clone(excludedRecommendedLedgers)
            })
          : await Promise.all(candidates.map((item) => recommendedLedgers.length
            ? classify!(clone(item), clone(recommendedLedgers))
            : classify!(clone(item))))
        if (classifications.length !== candidates.length) {
          throw new Error('Old favorite workspace automatic classification result is invalid.')
        }
        const proposed = candidates.map((item, index) => ({ aid: item.aid, proposal: classifications[index]! }))
        for (const source of ['system-high', 'system-low'] as const) {
          const assignments = proposed
            .filter(({ proposal }) => proposal.confidence === (source === 'system-high' ? 'high' : 'low'))
            .map(({ aid, proposal }) => ({ aid, targetLedgerIds: proposal.targetLedgerIds.slice(0, 1) }))
          if (!assignments.length) continue
          const next = applyWorkspaceClassificationBatch(updated, { source, assignments, replaceExistingSystem: replaceSystem })
          if (next === updated) continue
          const entry = next.history[next.history.length - 1]
          const readiness = await this.applyReadinessHistoryChange(updated, entry, 'forward')
          const classificationEvent: Extract<WorkspaceJournalEvent, { type: 'classification' }> = {
            type: 'classification', segmentId: segment.id, entry: clone(entry), historyCursor: next.historyCursor
          }
          await this.options.workspaceStore.appendOverlay(updated.accountMid, updated.id, {
            currentSegmentId: segment.id,
            classifications: entry.changes.flatMap((change) => change.after ? [{
              aid: change.after.aid, targetLedgerIds: [...change.after.targetLedgerIds], source: change.after.source
            }] : []),
            history: [encodeJournalEvent(classificationEvent)],
            planReadiness: readiness
          })
          this.updateOverviewClassifications(updated.accountMid, [{ segmentId: segment.id, entry }])
          this.planReadiness.set(updated.accountMid, readiness)
          editedSegmentIds.add(segment.id)
          updated = next
        }
      }
    } finally {
      if (visibleItems) this.currentSegmentItems.set(workspace.accountMid, visibleItems)
      else if (visibleSegmentId) {
        const visible = await this.options.workspaceStore.loadSegment(workspace.accountMid, workspace.id, visibleSegmentId)
        this.currentSegmentItems.set(workspace.accountMid, (visible.items ?? []).map((item) => ({
          ...item, ...(tagUpdates.has(item.aid) ? { tags: tagUpdates.get(item.aid) } : {})
        })))
      }
    }
    const frozenIds = new Set(this.frozenSegments.get(updated.accountMid) ?? [])
    for (const segmentId of editedSegmentIds) frozenIds.delete(segmentId)
    this.remember(updated, visibleSegmentId, this.segmentDescriptors.get(updated.accountMid) ?? [], frozenIds)
    return clone(updated)
  }

  async undoClassificationChange(accountMid: string): Promise<OldFavoriteWorkspace> {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      this.assertCurrentSegmentTagReady(workspace)
      if (workspace.historyCursor <= (workspace.historyBaselineCursor ?? 0)) return clone(workspace)
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
      this.assertCurrentSegmentTagReady(workspace)
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
      this.assertSegmentTagReady(workspace, segmentId)
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
      this.assertDeepSeekExecutionReady(workspace)
      if (workspace.status !== 'previewing') throw new Error('Old favorite workspace is not ready for local saving.')
      this.assertCurrentSegmentTagReady(workspace)
      const currentSegmentId = this.currentSegment(workspace)
      const currentSegment = workspace.segments.find((segment) => segment.id === currentSegmentId)
      if (!currentSegment) throw new Error('Old favorite workspace segment is invalid.')
      const currentSegmentAids = new Set(currentSegment.aids)
      const selectedAssignments = (await this.loadSelectedClassificationsForFreeze(workspace))
        .filter((assignment) => currentSegmentAids.has(assignment.aid))
      const recommendations = await this.ensureRecommendations(workspace)
      const recommendationTitles = new Map(recommendations.candidates
        .map((candidate) => [candidate.id, recommendationLogicalTitle(candidate)] as const))
      const repository = await this.options.repository.getSnapshot(workspace.accountMid)
      const itemsByAid = new Map<number, CurrentSegmentItem>()
      const descriptors = this.segmentDescriptors.get(workspace.accountMid) ??
        workspace.segments.map(({ id, index, aids }) => ({ id, index, itemCount: aids.length }))
      const descriptorsToSave = descriptors.length > 1
        ? descriptors.filter((descriptor) => descriptor.id === currentSegmentId)
        : descriptors
      for (const descriptor of descriptorsToSave) {
        const segment = await this.options.workspaceStore.loadSegment(workspace.accountMid, workspace.id, descriptor.id)
        for (const item of segment.items ?? []) itemsByAid.set(item.aid, item)
      }
      const selectableSourceFolders = (this.scanOverviews.get(workspace.accountMid)?.sourceFolders ?? [])
        .filter(scanSourceIsEligible)
      const selectedSourceFolderIds = new Set(selectableSourceFolders
        .filter((folder) => folder.selected).map((folder) => folder.id))
      const selectedAids = [...itemsByAid.values()]
        .filter((item) => !isUnavailableScanItem(item))
        .filter((item) => !selectableSourceFolders.length || item.sourceFolderIds.some((folderId) => selectedSourceFolderIds.has(folderId)))
        .map((item) => item.aid)
        .sort((left, right) => left - right)
      if (!selectedAids.length) throw new Error('Old favorite workspace selected plan is empty.')
      const assignmentsByAid = new Map(selectedAssignments.map((assignment) => [assignment.aid, assignment]))
      const existingLogicalFolderIds = new Set(repository.folders
        .filter((folder) => folder.kind === 'bilimi-logical' && folder.logicalLedgerId)
        .map((folder) => folder.logicalLedgerId!))
      const localFolderIdForLedger = (logicalLedgerId: string) => logicalLedgerId === 'inbox'
        ? 'local:inbox'
        : existingLogicalFolderIds.has(logicalLedgerId)
          ? `bilimi-logical:${logicalLedgerId}`
          : `local:${logicalLedgerId}`
      const memberAidsByFolderId: Record<string, number[]> = {}
      for (const aid of selectedAids) {
        const targets = assignmentsByAid.get(aid)?.targetLedgerIds ?? ['inbox']
        for (const logicalLedgerId of targets) {
          const folderId = localFolderIdForLedger(logicalLedgerId)
          memberAidsByFolderId[folderId] = [...new Set([
            ...(memberAidsByFolderId[folderId] ?? []),
            aid
          ])].sort((left, right) => left - right)
        }
      }
      const defaultTitles = new Map(createDefaultFavoriteLedgers().map((ledger) => [ledger.id, ledger.displayName]))
      const existingLocalTitles = new Map(repository.folders
        .filter((folder) => folder.kind === 'local')
        .map((folder) => [folder.id, folder.title]))
      const localFolderTitles = new Map(await Promise.all(Object.keys(memberAidsByFolderId).map(async (folderId) => {
        if (folderId === 'local:inbox') return [folderId, 'bilimi·暂存'] as const
        const logicalLedgerId = folderId.slice('local:'.length)
        const recommendationTitle = recommendationTitles.get(logicalLedgerId)
        if (recommendationTitle) return [folderId, recommendationTitle] as const
        const existingTitle = existingLocalTitles.get(folderId)
        if (existingTitle) return [folderId, existingTitle] as const
        return [folderId, await this.options.resolveLedgerTitle?.(workspace.accountMid, logicalLedgerId) ??
          defaultTitles.get(logicalLedgerId) ?? logicalLedgerId] as const
      })))
      const frozen = freezeWorkspaceSegment(workspace, currentSegmentId)
      const updated: OldFavoriteWorkspace = { ...frozen, status: 'previewing' }
      // The local plan contains fresh metadata timestamps on every retry. Do
      // not reuse a revision-derived command id with a changed payload.
      const localCommitId = `old-favorite-workspace:local:${workspace.id}:${currentSegmentId}:${randomUUID()}`
      await this.options.repository.commit(workspace.accountMid, {
        id: localCommitId,
        accountMid: workspace.accountMid,
        issuedAt: this.now(),
        type: 'commit-local-plan',
        payload: {
          workspaceId: workspace.id,
          memberAidsByFolderId,
          replaceManagedAids: selectedAids,
          videos: selectedAids.flatMap((aid) => {
            const item = itemsByAid.get(aid)
            return [{
              aid,
              title: item?.title?.trim() || `Video ${aid}`,
              ...(item?.author?.trim() ? { author: item.author.trim() } : {}),
              ...(item?.description?.trim() ? { description: item.description.trim() } : {}),
              tags: [...(item?.tags ?? [])],
              updatedAt: this.now()
            }]
          }),
          folders: Object.keys(memberAidsByFolderId).filter((folderId) => folderId.startsWith('local:')).map((folderId) => ({
            id: folderId,
            title: localFolderTitles.get(folderId)!,
            kind: 'local' as const,
            syncState: 'local-only' as const
          })),
          organizationRecords: selectedAssignments.filter((assignment) => assignment.targetLedgerIds.some((id) => id !== 'inbox')).map((assignment) => ({
            accountMid: workspace.accountMid,
            aid: assignment.aid,
            targetFolderIds: assignment.targetLedgerIds.filter((id) => id !== 'inbox').map(localFolderIdForLedger),
            completedAt: this.now(),
            classificationSource: repositoryClassificationSource(assignment.source)
          })),
          audit: { operation: 'organize-favorites' },
        }
      })
      await this.appendEvents(updated, currentSegmentId, [{ type: 'freeze', segmentId: currentSegmentId }])
      await this.persistMarker(updated)
      await this.persistRecommendedLedgersUnsafe(workspace, recommendations)
      const frozenIds = new Set(this.frozenSegments.get(workspace.accountMid) ?? [])
      frozenIds.add(currentSegmentId)
      this.remember(updated, currentSegmentId, this.segmentDescriptors.get(workspace.accountMid) ?? [], frozenIds)
      return clone(updated)
    })
  }

  async saveWholeRunToLocalLibrary(accountMid: string): Promise<OldFavoriteWorkspace> {
    await this.assertDeepSeekExecutionReadyForAccount(accountMid)
    const snapshot = await this.getSnapshot(accountMid)
    if (!snapshot || 'recovery' in snapshot) throw new Error('Old favorite workspace is not ready for local saving.')
    if (snapshot.segments.some((segment) => segment.readiness === 'tagging' || segment.readiness === 'waiting')) {
      throw new Error('Old favorite workspace whole-run tag enrichment is not complete.')
    }
    const originalSegmentId = snapshot.currentSegment?.id
    let final: OldFavoriteWorkspace | null = null
    for (const segment of snapshot.segments) {
      await this.selectSegment(accountMid, segment.id)
      final = await this.saveCurrentSegmentToLocalLibrary(accountMid)
      await this.advanceRecoveryDecisionAfterOwnLocalCommit(accountMid)
    }
    if (originalSegmentId) await this.selectSegment(accountMid, originalSegmentId)
    if (!final) final = await this.requireWorkspace(accountMid)
    return this.completeWholeRunLocalSave(accountMid)
  }

  private async advanceRecoveryDecisionAfterOwnLocalCommit(accountMid: string) {
    const workspace = await this.requireWorkspace(accountMid)
    const recovery = await this.options.workspaceStore.readRecoverySummary(workspace.accountMid, workspace.id)
    if ('recovery' in recovery || !recovery.recoveryDecision || !recovery.recoveryBaseline) return
    const repository = await this.options.repository.getSnapshot(workspace.accountMid)
    await this.options.workspaceStore.setRecoveryDecision(workspace.accountMid, workspace.id, {
      ...recovery.recoveryDecision,
      expectedRepositoryRevision: repository.revision,
      evidenceFingerprint: recovery.recoveryBaseline.fingerprint,
      recordedAt: this.now()
    })
  }

  private async completeWholeRunLocalSave(accountMid: string): Promise<OldFavoriteWorkspace> {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      const descriptors = this.segmentDescriptors.get(workspace.accountMid) ?? []
      const frozenIds = this.frozenSegments.get(workspace.accountMid) ?? new Set<string>()
      if (!descriptors.length || descriptors.some((segment) => !frozenIds.has(segment.id))) {
        throw new Error('Old favorite workspace whole-run local save is incomplete.')
      }
      await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
        currentSegmentId: this.currentSegment(workspace), classifications: [], history: [], executionIntent: null
      })
      await this.persistMarker(workspace)
      this.executionIntents.delete(workspace.accountMid)
      this.remember(workspace, this.currentSegment(workspace), descriptors, new Set(frozenIds))
      return clone(workspace)
    })
  }

  /** Freezes a remote plan from persisted physical shards; it never touches the page bridge. */
  async freezeForBilibiliExecution(accountMid: string, options: { includeInbox?: boolean } = {}): Promise<FavoriteRepositoryWorkspace> {
    await this.assertDeepSeekExecutionReadyForAccount(accountMid)
    // A recovered draft may retain adopted recommendations after a previous
    // preference write failed. Repair that local configuration before either
    // committing the local result or asking Bilibili to bind a target.
    await this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      await this.persistRecommendedLedgersUnsafe(workspace, await this.ensureRecommendations(workspace))
    })
    // Establish the local archive boundary before provisioning or inspecting
    // any remote target.  The commit is idempotent, so callers that already
    // performed the local-first save simply take the fast path.
    await this.commitCompleteLocalResultForRemoteExecution(accountMid)
    await this.stageUnclassifiedSelectedVideos(accountMid)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const preparation = await this.queue(async () => {
        const workspace = await this.requireWorkspace(accountMid)
        if (workspace.status !== 'previewing' || !workspace.baseline) {
          throw new Error('Old favorite workspace is not ready to freeze.')
        }
        const classifications = await this.loadSelectedClassificationsForFreeze(workspace, options.includeInbox === true)
        const recommendations = await this.ensureRecommendations(workspace)
        const recommendationTitles = new Map(recommendations.candidates
          .map((candidate) => [candidate.id, recommendationLogicalTitle(candidate)] as const))
        const assignmentAids = classifications.reduce<Record<string, number[]>>((aidsByLedger, classification) => {
          for (const logicalLedgerId of classification.targetLedgerIds.map((id) => id.trim()).filter((id) => id && (options.includeInbox === true || id !== 'inbox'))) {
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
          logicalLedgerId === 'inbox' ? 'bilimi·暂存' :
            boundTitles.get(logicalLedgerId) ?? recommendationTitles.get(logicalLedgerId) ??
              await this.options.resolveLedgerTitle?.(workspace.accountMid, logicalLedgerId) ?? defaultTitles.get(logicalLedgerId)
        ] as const)))
        const savedBindings = new Map(await Promise.all(Object.keys(assignmentAids).map(async (logicalLedgerId) => [
          logicalLedgerId,
          await this.options.resolveLedgerBinding?.(workspace.accountMid, logicalLedgerId)
        ] as const)))
        return {
          accountMid: workspace.accountMid,
          logicalTitles,
          savedBindings,
          assignmentAids
        }
      })
      if (this.options.bindingService) {
        const snapshot = await this.options.repository.getSnapshot(preparation.accountMid)
        for (const [logicalLedgerId, assignmentAids] of Object.entries(preparation.assignmentAids)
          .sort(([left], [right]) => left.localeCompare(right))) {
          const logicalTitle = preparation.logicalTitles.get(logicalLedgerId)
          if (!logicalTitle) throw new Error('Old favorite workspace target title is unavailable.')
          // Pending shards are not safe capacity evidence: the prior create may
          // have failed locally after succeeding remotely. Re-run their ordinal
          // through the binding service so it can claim one exact remote title.
          const existing = snapshot.physicalShards.filter((shard) =>
            shard.logicalLedgerId === logicalLedgerId && shard.bindingState === 'bound' && Boolean(shard.remoteFolderId)
          )
          const existingMemberAids = new Set(existing.flatMap((shard) => snapshot.memberships[shard.folderId] ?? []))
          const newAssignmentCount = assignmentAids.filter((aid) => !existingMemberAids.has(aid)).length
          const availableCapacity = existing.reduce((total, shard) => total + Math.max(
            0,
            1_000 - Math.max(snapshot.memberships[shard.folderId]?.length ?? 0, shard.remoteMemberCount ?? 0)
          ), 0)
          const shardCount = Math.max(0, Math.ceil((newAssignmentCount - availableCapacity) / 1_000))
          const hasUnreconciledShard = snapshot.physicalShards.some((shard) =>
            shard.logicalLedgerId === logicalLedgerId && shard.bindingState !== 'bound'
          )
          // A brand-new logical ledger may provision its first Bilibili shard here.
          // If a prior attempt left an unbound/pending shard, stop instead of
          // creating another remote folder and losing the reconciliation path.
          if (newAssignmentCount > 0 && existing.length === 0 && hasUnreconciledShard) {
            throw new Error(`Old favorite workspace cannot freeze: remote-target-unbound:${logicalLedgerId}`)
          }
          const nextShardNumber = Math.max(0, ...existing.map((shard) => shard.shardNumber)) + 1
          const savedBinding = preparation.savedBindings.get(logicalLedgerId)
          for (let offset = 0; offset < shardCount; offset += 1) {
            await this.options.bindingService.ensurePhysicalShard(preparation.accountMid, {
              logicalLedgerId,
              logicalTitle,
              remoteDisplayTitle: savedBinding?.remoteDisplayTitle ?? logicalTitle,
              ...(existing.length === 0 && offset === 0 && savedBinding?.remoteFolderId
                ? { preferredRemoteFolderId: savedBinding.remoteFolderId }
                : {}),
              shardNumber: nextShardNumber + offset,
              memberAids: []
            })
          }
        }
      }
      const frozen = await this.queue(async () => {
        const workspace = await this.requireWorkspace(preparation.accountMid)
        if (workspace.status !== 'previewing' || !workspace.baseline) {
          throw new Error('Old favorite workspace is not ready to freeze.')
        }
        const classifications = await this.loadSelectedClassificationsForFreeze(workspace, options.includeInbox === true)
        const currentAssignments = classifications.reduce<Record<string, number[]>>((aidsByLedger, classification) => {
          for (const logicalLedgerId of classification.targetLedgerIds.map((id) => id.trim()).filter((id) => id && (options.includeInbox === true || id !== 'inbox'))) {
            aidsByLedger[logicalLedgerId] = [...new Set([...(aidsByLedger[logicalLedgerId] ?? []), classification.aid])]
          }
          return aidsByLedger
        }, {})
        if (JSON.stringify(currentAssignments) !== JSON.stringify(preparation.assignmentAids)) return null
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
          replaceManagedMemberships: workspace.scope.kind === 'selection',
          classifications: classifications.map((classification) => {
            const adjustment = [...snapshot.classificationAdjustments]
              .filter((record) => record.aid === classification.aid && record.operation === 'organize-favorites')
              .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id))[0]
            return {
              aid: classification.aid,
              targetLedgerIds: options.includeInbox === true
                ? classification.targetLedgerIds
                : classification.targetLedgerIds.filter((id) => id !== 'inbox'),
              ...(adjustment ? { classificationAdjustmentId: adjustment.id } : {})
            }
          }),
          shards: boundShards
        })
        if (!result.allowed || !result.plan) {
          throw new Error(`Old favorite workspace cannot freeze: ${result.reason ?? 'invalid-input'}`)
        }
        const next = { ...workspace, status: 'frozen' as const }
        await this.persistMarker(next, result.plan)
        this.remember(next, this.currentSegment(workspace), this.segmentDescriptors.get(workspace.accountMid) ?? [],
          new Set(this.frozenSegments.get(workspace.accountMid) ?? []))
        const persisted = await this.options.repository.getSnapshot(workspace.accountMid)
        if (!persisted.workspace?.frozenSyncPlan) throw new Error('Old favorite workspace frozen plan was not persisted.')
        return clone(persisted.workspace)
      })
      if (frozen) return frozen
    }
    throw new Error('Old favorite workspace changed while preparing Bilibili bindings.')
  }

  async pauseTagEnrichment(accountMid: string) {
    return this.queue(() => this.setTagEnrichmentStatus(accountMid, 'paused'))
  }

  async resumeTagEnrichment(accountMid: string) {
    return this.queue(() => this.setTagEnrichmentStatus(accountMid, 'running'))
  }

  async retryFailedTagEnrichment(accountMid: string) {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      if (workspace.status !== 'previewing') throw new Error('Old favorite workspace tags are not ready.')
      const current = this.tagEnrichments.get(workspace.accountMid)
      if (!current?.failedAids.length) return false
      const next: TagEnrichment = {
        ...current,
        status: 'running',
        pendingAids: [...new Set([...current.pendingAids, ...current.failedAids])].sort((left, right) => left - right),
        failedAids: [],
        completedItemCount: current.totalItemCount - [...new Set([...current.pendingAids, ...current.failedAids])].length
      }
      await this.options.workspaceStore.appendTagEnrichmentDelta(workspace.accountMid, workspace.id, {
        currentSegmentId: this.currentSegment(workspace), kind: 'retry-failed'
      })
      this.tagEnrichments.set(workspace.accountMid, next)
      return true
    })
  }

  async acceptCurrentTags(accountMid: string) {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      const enrichment = this.tagEnrichments.get(workspace.accountMid)
      if (!enrichment) return
      const segmentId = this.currentSegment(workspace)
      if (enrichment.status !== 'complete' && !enrichment.acceptedSegmentIds.includes(segmentId)) {
        const acceptedSegmentIds = [...new Set([...enrichment.acceptedSegmentIds, segmentId])]
        const accepted = new Set(acceptedSegmentIds)
        const hasActivePending = workspace.segments.some((segment) =>
          !accepted.has(segment.id) && segment.aids.some((aid) => enrichment.pendingAids.includes(aid)))
        const status = hasActivePending
          ? enrichment.status === 'paused' ? 'paused' as const : 'running' as const
          : 'accepted' as const
        await this.options.workspaceStore.appendTagEnrichmentDelta(workspace.accountMid, workspace.id, {
          currentSegmentId: segmentId, kind: 'accept-segment', segmentId, status
        })
        this.tagEnrichments.set(workspace.accountMid, { ...enrichment, acceptedSegmentIds, status })
      }
      this.rebuildRecommendationsAfterTagBatch(workspace)
      await this.refreshRecommendationsAfterTagEnrichment(workspace)
      if (this.options.classifyCurrentItem || this.options.classifyCurrentItems) {
        await this.checkpointInitialSystemClassificationsUnsafe(await this.autoClassifyCurrentSegmentUnsafe(workspace, true))
      }
    })
  }

  async getPendingTagEnrichmentAids(accountMid: string) {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      const enrichment = this.tagEnrichments.get(workspace.accountMid)
      if (enrichment?.status !== 'running') return []
      const accepted = new Set(enrichment.acceptedSegmentIds)
      const pending = new Set(enrichment.pendingAids)
      const descriptors = (this.segmentDescriptors.get(workspace.accountMid) ??
        workspace.segments.map(({ id, index, aids }) => ({ id, index, itemCount: aids.length })))
        .slice()
        .sort((left, right) => left.index - right.index)
      for (const descriptor of descriptors) {
        if (accepted.has(descriptor.id)) continue
        const segment = workspace.segments.find((candidate) => candidate.id === descriptor.id) ??
          await this.options.workspaceStore.loadSegment(workspace.accountMid, workspace.id, descriptor.id)
        const segmentPendingAids = segment.aids.filter((aid) => pending.has(aid))
        if (segmentPendingAids.length) return segmentPendingAids
      }
      return []
    })
  }

  async recordTagEnrichment(accountMid: string, aid: number, tags: string[], expectedWorkspaceId?: string) {
    let readyAccountMid = ''
    let readySegmentIds: string[] = []
    const recorded = await this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      if (expectedWorkspaceId && workspace.id !== expectedWorkspaceId) return false
      const enrichment = this.tagEnrichments.get(workspace.accountMid)
      if (!enrichment || enrichment.status !== 'running' || !enrichment.pendingAids.includes(aid)) return false
      if (workspace.segments.some((segment) => enrichment.acceptedSegmentIds.includes(segment.id) && segment.aids.includes(aid))) return false
      const normalizedTags = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 32)
      const persistedVideo = (await this.options.repository.getSnapshot(workspace.accountMid)).videos[String(aid)]
      await this.options.repository.commit(workspace.accountMid, {
        id: `old-favorite-workspace:confirm-tags:${workspace.id}:${aid}`,
        accountMid: workspace.accountMid,
        issuedAt: this.now(),
        type: 'upsert-video',
        payload: {
          aid,
          title: persistedVideo?.title ?? `Video ${aid}`,
          ...(persistedVideo?.author ? { author: persistedVideo.author } : {}),
          ...(persistedVideo?.description ? { description: persistedVideo.description } : {}),
          tags: normalizedTags,
          tagEvidence: 'confirmed',
          updatedAt: persistedVideo?.updatedAt ?? this.now()
        }
      })
      const overview = this.scanOverviews.get(workspace.accountMid)
      const priorTags = this.currentSegmentItems.get(workspace.accountMid)
        ?.find((item) => item.aid === aid)?.tags ?? []
      const scan = overview
        ? {
            ...overview.scan,
            taggedItemCount: Math.max(0, (overview.scan.taggedItemCount ?? 0) +
              (normalizedTags.length > 0 && priorTags.length === 0 ? 1 : 0)),
            untaggedItemCount: Math.max(0, (overview.scan.scannedItemCount ?? 0) -
              Math.max(0, (overview.scan.taggedItemCount ?? 0) +
                (normalizedTags.length > 0 && priorTags.length === 0 ? 1 : 0)))
          }
        : undefined
      const pendingAids = enrichment.pendingAids.filter((candidate) => candidate !== aid)
      readyAccountMid = workspace.accountMid
      readySegmentIds = this.newlyReadySegmentIds(workspace, enrichment.pendingAids, pendingAids)
      const activePendingAids = pendingAids.filter((pendingAid) => !workspace.segments.some((segment) =>
        enrichment.acceptedSegmentIds.includes(segment.id) && segment.aids.includes(pendingAid)))
      const next: TagEnrichment = {
        ...enrichment,
        pendingAids,
        completedItemCount: enrichment.totalItemCount - pendingAids.length,
        failedAids: enrichment.failedAids.filter((candidate) => candidate !== aid),
        taggedAids: normalizedTags.length > 0
          ? [...new Set([...enrichment.taggedAids, aid])].sort((left, right) => left - right)
          : enrichment.taggedAids.filter((candidate) => candidate !== aid),
        confirmedUntaggedAids: normalizedTags.length > 0
          ? enrichment.confirmedUntaggedAids.filter((candidate) => candidate !== aid)
          : [...new Set([...enrichment.confirmedUntaggedAids, aid])].sort((left, right) => left - right),
        status: activePendingAids.length ? 'running' : pendingAids.length ? 'accepted' : 'complete'
      }
      await this.options.workspaceStore.appendTagEnrichmentDelta(workspace.accountMid, workspace.id, {
        currentSegmentId: this.currentSegment(workspace), kind: 'tagged', aid, tags: normalizedTags,
        ...(scan ? { scanMetadata: { ...(overview?.sourceFolders ? { sourceFolders: overview.sourceFolders } : {}), ...scan } } : {})
      })
      const currentItems = this.currentSegmentItems.get(workspace.accountMid)
      if (currentItems) {
        this.currentSegmentItems.set(workspace.accountMid, currentItems.map((item) => item.aid === aid ? { ...item, tags: normalizedTags, tagEvidence: 'confirmed' } : item))
      }
      this.updateRecommendationIndexTags(workspace, aid, normalizedTags)
      this.tagEnrichments.set(workspace.accountMid, next)
      if (overview && scan) this.scanOverviews.set(workspace.accountMid, { ...overview, scan })
      const currentSegmentCompleted = this.completedCurrentSegmentTagEnrichment(workspace, enrichment.pendingAids, pendingAids)
      if (workspace.status === 'previewing' && (readySegmentIds.length || !pendingAids.length || currentSegmentCompleted)) {
        this.rebuildRecommendationsAfterTagBatch(workspace)
        await this.refreshRecommendationsAfterTagEnrichment(workspace)
        if (this.options.classifyCurrentItem || this.options.classifyCurrentItems) {
          const segmentIds = !pendingAids.length
            ? workspace.segments.map((segment) => segment.id)
            : readySegmentIds.length
              ? readySegmentIds
              : [this.currentSegment(workspace)]
          await this.checkpointInitialSystemClassificationsUnsafe(await this.autoClassifySegmentsUnsafe(workspace, segmentIds, true))
        }
      }
      return true
    })
    if (recorded && readySegmentIds.length && this.workspaces.get(readyAccountMid)?.status === 'previewing' && this.options.onSegmentsReady) {
      void Promise.resolve(this.options.onSegmentsReady(readyAccountMid, readySegmentIds)).catch(() => undefined)
    }
    return recorded
  }

  async recordTagEnrichmentFailure(accountMid: string, aid: number, _reason: string, expectedWorkspaceId?: string) {
    let readyAccountMid = ''
    let readySegmentIds: string[] = []
    const recorded = await this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      if (expectedWorkspaceId && workspace.id !== expectedWorkspaceId) return false
      const enrichment = this.tagEnrichments.get(workspace.accountMid)
      if (!enrichment || enrichment.status !== 'running' || !enrichment.pendingAids.includes(aid)) return false
      if (workspace.segments.some((segment) => enrichment.acceptedSegmentIds.includes(segment.id) && segment.aids.includes(aid))) return false
      const pendingAids = enrichment.pendingAids.filter((candidate) => candidate !== aid)
      readyAccountMid = workspace.accountMid
      readySegmentIds = this.newlyReadySegmentIds(workspace, enrichment.pendingAids, pendingAids)
      const activePendingAids = pendingAids.filter((pendingAid) => !workspace.segments.some((segment) =>
        enrichment.acceptedSegmentIds.includes(segment.id) && segment.aids.includes(pendingAid)))
      const next: TagEnrichment = {
        ...enrichment,
        pendingAids,
        completedItemCount: enrichment.totalItemCount - pendingAids.length,
        failedAids: [...new Set([...enrichment.failedAids, aid])].sort((left, right) => left - right),
        status: activePendingAids.length ? 'running' : pendingAids.length ? 'accepted' : 'complete'
      }
      await this.options.workspaceStore.appendTagEnrichmentDelta(workspace.accountMid, workspace.id, {
        currentSegmentId: this.currentSegment(workspace), kind: 'failed', aid
      })
      this.tagEnrichments.set(workspace.accountMid, next)
      const currentSegmentCompleted = this.completedCurrentSegmentTagEnrichment(workspace, enrichment.pendingAids, pendingAids)
      if (workspace.status === 'previewing' && (readySegmentIds.length || !pendingAids.length || currentSegmentCompleted)) {
        this.rebuildRecommendationsAfterTagBatch(workspace)
        await this.refreshRecommendationsAfterTagEnrichment(workspace)
        if (this.options.classifyCurrentItem || this.options.classifyCurrentItems) {
          const segmentIds = !pendingAids.length
            ? workspace.segments.map((segment) => segment.id)
            : readySegmentIds.length
              ? readySegmentIds
              : [this.currentSegment(workspace)]
          await this.checkpointInitialSystemClassificationsUnsafe(await this.autoClassifySegmentsUnsafe(workspace, segmentIds, true))
        }
      }
      return true
    })
    if (recorded && readySegmentIds.length && this.workspaces.get(readyAccountMid)?.status === 'previewing' && this.options.onSegmentsReady) {
      void Promise.resolve(this.options.onSegmentsReady(readyAccountMid, readySegmentIds)).catch(() => undefined)
    }
    return recorded
  }

  private newlyReadySegmentIds(
    workspace: OldFavoriteWorkspace,
    pendingAidsBefore: readonly number[],
    pendingAidsAfter: readonly number[]
  ) {
    const before = new Set(pendingAidsBefore)
    const after = new Set(pendingAidsAfter)
    return workspace.segments
      .filter((segment) => segment.aids.some((aid) => before.has(aid)) && !segment.aids.some((aid) => after.has(aid)))
      .map((segment) => segment.id)
  }

  private completedCurrentSegmentTagEnrichment(
    workspace: OldFavoriteWorkspace,
    pendingAidsBefore: readonly number[],
    pendingAidsAfter: readonly number[]
  ) {
    const currentSegment = workspace.segments.find((segment) => segment.id === this.currentSegment(workspace))
    if (!currentSegment) return false
    const currentAids = new Set(currentSegment.aids)
    return pendingAidsBefore.some((aid) => currentAids.has(aid)) && !pendingAidsAfter.some((aid) => currentAids.has(aid))
  }

  private async setTagEnrichmentStatus(accountMid: string, status: TagEnrichment['status']) {
    const workspace = await this.requireWorkspace(accountMid)
    if (workspace.status !== 'previewing') throw new Error('Old favorite workspace tags are not ready.')
    const current = this.tagEnrichments.get(workspace.accountMid)
    if (!current || current.status === 'complete' || (current.status === 'accepted' && status !== 'running')) return false
    if (status === 'running' && !current.pendingAids.length) return false
    const segmentId = this.currentSegment(workspace)
    if (status === 'running' && current.acceptedSegmentIds.includes(segmentId)) {
      const acceptedSegmentIds = current.acceptedSegmentIds.filter((id) => id !== segmentId)
      const next: TagEnrichment = { ...current, status, acceptedSegmentIds }
      await this.options.workspaceStore.appendTagEnrichmentDelta(workspace.accountMid, workspace.id, {
        currentSegmentId: segmentId, kind: 'resume-segment', segmentId, status
      })
      this.tagEnrichments.set(workspace.accountMid, next)
      return true
    }
    const next: TagEnrichment = { ...current, status }
    await this.options.workspaceStore.appendTagEnrichmentDelta(workspace.accountMid, workspace.id, {
      currentSegmentId: this.currentSegment(workspace), kind: 'status', status
    })
    this.tagEnrichments.set(workspace.accountMid, next)
    return true
  }

  /** Moves the durable history cursor without letting the renderer replay classifications. */
  async moveHistoryCursor(accountMid: string, targetCursor: number): Promise<OldFavoriteWorkspace> {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      this.assertCurrentSegmentTagReady(workspace)
      if (!Number.isSafeInteger(targetCursor) || targetCursor < 0 || targetCursor > workspace.history.length) {
        throw new Error('Old favorite workspace history cursor is invalid.')
      }
      if (targetCursor < (workspace.historyBaselineCursor ?? 0)) {
        throw new Error('Old favorite workspace history cursor cannot precede the initial classification baseline.')
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
      const selectable = overview?.sourceFolders.filter(scanSourceIsEligible) ?? []
      const selectedSourceFolderIds = new Set(selectable.filter((folder) => folder.selected).map((folder) => folder.id))
      const descriptors = this.segmentDescriptors.get(workspace.accountMid) ??
        workspace.segments.map(({ id, index, aids }) => ({ id, index, itemCount: aids.length }))
      const items: CurrentSegmentItem[] = []
      for (const descriptor of descriptors) {
        const segment = await this.options.workspaceStore.loadSegment(workspace.accountMid, workspace.id, descriptor.id)
        items.push(...(segment.items ?? []))
      }
      const unresolved = items.filter((item) =>
        !isUnavailableScanItem(item) &&
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
          folders: [{ id: 'local:inbox', title: 'bilimi·暂存', kind: 'local', syncState: 'local-only' }],
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
    await this.backfillCompleteLocalResultIfRecoverable(accountMid)
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
      await this.options.syncService.rebindPageTarget(frozenPlan.accountMid, frozenPlan.plan.id)
      return this.options.syncService.resume(frozenPlan.accountMid, frozenPlan.plan.id)
    }
    if (currentRun.status !== 'running') {
      return currentRun
    }
    return this.options.syncService.executeFrozenPlan(frozenPlan.accountMid, frozenPlan.plan)
  }

  /** One user confirmation freezes the immutable plan, then starts its controlled execution. */
  async confirmAndExecuteBilibiliPlan(accountMid: string, options: { includeInbox?: boolean } = {}): Promise<FavoriteRepositorySyncRun> {
    await this.freezeForBilibiliExecution(accountMid, options)
    return this.executeFrozenBilibiliPlan(accountMid)
  }

  /** Claims a frozen plan synchronously, then drives Bilibili in one main-process background task. */
  async beginBilibiliExecution(accountMid: string, options: { includeInbox?: boolean } = {}): Promise<OldFavoriteWorkspaceSnapshot> {
    await this.commitCompleteLocalResultForRemoteExecution(accountMid)
    const frozen = await this.freezeForBilibiliExecution(accountMid, options)
    if (!frozen.frozenSyncPlan || !this.options.syncService) {
      throw new Error('Old favorite workspace sync service is unavailable.')
    }
    await this.options.syncService.claimFrozenPlan(frozen.accountMid, frozen.frozenSyncPlan)
    void this.executeFrozenBilibiliPlan(frozen.accountMid).catch(() => undefined)
    return this.getSnapshot(frozen.accountMid) as Promise<OldFavoriteWorkspaceSnapshot>
  }

  /** Restarts a persisted frozen plan without holding the renderer request open for every remote write. */
  async beginFrozenBilibiliPlanExecution(accountMid: string): Promise<OldFavoriteWorkspaceSnapshot> {
    await this.backfillCompleteLocalResultIfRecoverable(accountMid)
    const frozen = await this.queue(async () => {
      const snapshot = await this.options.repository.getSnapshot(accountMid)
      const workspace = snapshot.workspace
      if (!workspace?.frozenSyncPlan || (workspace.status !== 'frozen' && workspace.status !== 'executing')) {
        throw new Error('Old favorite workspace is not frozen for Bilibili execution.')
      }
      if (!this.options.syncService) throw new Error('Old favorite workspace sync service is unavailable.')
      return { accountMid: snapshot.accountMid, plan: clone(workspace.frozenSyncPlan) }
    })
    if (!this.options.syncService) throw new Error('Old favorite workspace sync service is unavailable.')
    await this.options.syncService.claimFrozenPlan(frozen.accountMid, frozen.plan)
    void this.executeFrozenBilibiliPlan(frozen.accountMid).catch(() => undefined)
    return this.getSnapshot(frozen.accountMid) as Promise<OldFavoriteWorkspaceSnapshot>
  }

  private async commitCompleteLocalResultForRemoteExecution(accountMid: string) {
    await this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      await this.commitCompleteLocalResultForRemoteExecutionUnsafe(workspace)
    })
  }

  private async backfillCompleteLocalResultIfRecoverable(accountMid: string) {
    try {
      await this.commitCompleteLocalResultForRemoteExecution(accountMid)
    } catch (error) {
      if (error instanceof Error && [
        'Old favorite workspace requires rebuild.',
        'Old favorite workspace has not been started.'
      ].includes(error.message)) return
      throw error
    }
  }

  private async commitCompleteLocalResultForRemoteExecutionUnsafe(workspace: OldFavoriteWorkspace) {
      this.assertDeepSeekExecutionReady(workspace)
      if (!['previewing', 'frozen', 'executing', 'reconciling'].includes(workspace.status)) {
        throw new Error('Old favorite workspace is not ready for local saving.')
      }
      const selectedAssignments = await this.loadSelectedClassificationsForFreeze(workspace)
      const assignmentsByAid = new Map(selectedAssignments.map((assignment) => [assignment.aid, assignment]))
      const overview = this.scanOverviews.get(workspace.accountMid)
      const selectable = overview?.sourceFolders.filter(scanSourceIsEligible) ?? []
      const selectedSourceFolderIds = new Set(selectable.filter((folder) => folder.selected).map((folder) => folder.id))
      const items: CurrentSegmentItem[] = []
      const descriptors = this.segmentDescriptors.get(workspace.accountMid) ??
        workspace.segments.map(({ id, index, aids }) => ({ id, index, itemCount: aids.length }))
      for (const descriptor of descriptors) {
        const segment = await this.options.workspaceStore.loadSegment(workspace.accountMid, workspace.id, descriptor.id)
        items.push(...(segment.items ?? []))
      }
      const selectedItems = items.filter((item) => !isUnavailableScanItem(item) &&
        (!selectable.length || item.sourceFolderIds.some((folderId) => selectedSourceFolderIds.has(folderId))))
      // A user may intentionally deselect every ordinary source. There is no
      // local result to commit in that case, but the remote plan may still be
      // frozen as an empty no-op for the confirmation flow.
      if (!selectedItems.length) return
      const repository = await this.options.repository.getSnapshot(workspace.accountMid)
      const existingLogicalFolderIds = new Set(repository.folders
        .filter((folder) => folder.kind === 'bilimi-logical' && folder.logicalLedgerId)
        .map((folder) => folder.logicalLedgerId!))
      const localFolderIdForLedger = (logicalLedgerId: string) => existingLogicalFolderIds.has(logicalLedgerId)
        ? `bilimi-logical:${logicalLedgerId}`
        : `local:${logicalLedgerId}`
      const organizationRecordAids = new Set(repository.organizationRecords.map((record) => record.aid))
      const localResultAlreadyComplete = selectedItems.every((item) => {
        const targets = assignmentsByAid.get(item.aid)?.targetLedgerIds.filter((id) => id !== 'inbox') ?? []
        const desired = targets.map((ledgerId) => `bilimi-logical:${ledgerId}`).sort()
        const position = repository.positions[`${workspace.accountMid}:${item.aid}`]
        if (!position || JSON.stringify([...position.localDesiredFolderIds].sort()) !== JSON.stringify(desired)) return false
        if (!targets.length) return repository.memberships['local:inbox']?.includes(item.aid) ?? false
        return organizationRecordAids.has(item.aid) && desired.every((folderId) => repository.memberships[folderId]?.includes(item.aid))
      })
      if (localResultAlreadyComplete) return
      const memberAidsByFolderId: Record<string, number[]> = { 'local:inbox': [] }
      const organizationRecords: Array<{ accountMid: string; aid: number; targetFolderIds: string[]; completedAt: string; classificationSource: FavoriteRepositoryClassificationSource }> = []
      for (const item of selectedItems) {
        const targets = assignmentsByAid.get(item.aid)?.targetLedgerIds.filter((id) => id !== 'inbox') ?? []
        if (!targets.length) memberAidsByFolderId['local:inbox'].push(item.aid)
        else {
          const targetFolderIds = targets.map(localFolderIdForLedger)
          for (const folderId of targetFolderIds) memberAidsByFolderId[folderId] = [...(memberAidsByFolderId[folderId] ?? []), item.aid]
          organizationRecords.push({
            accountMid: workspace.accountMid,
            aid: item.aid,
            targetFolderIds,
            completedAt: this.now(),
            classificationSource: repositoryClassificationSource(assignmentsByAid.get(item.aid)?.source ?? 'system-low')
          })
        }
      }
      const recommendationTitles = new Map((await this.ensureRecommendations(workspace)).candidates
        .map((candidate) => [candidate.id, recommendationLogicalTitle(candidate)] as const))
      const defaultTitles = new Map(createDefaultFavoriteLedgers().map((ledger) => [ledger.id, ledger.displayName]))
      const folders = await Promise.all(Object.keys(memberAidsByFolderId).filter((folderId) => folderId.startsWith('local:')).map(async (folderId) => {
        if (folderId === 'local:inbox') return { id: folderId, title: 'bilimi·暂存', kind: 'local' as const, syncState: 'local-only' as const }
        const ledgerId = folderId.slice('local:'.length)
        return {
          id: folderId,
          title: repository.folders.find((folder) => folder.id === folderId)?.title ?? recommendationTitles.get(ledgerId) ??
            await this.options.resolveLedgerTitle?.(workspace.accountMid, ledgerId) ?? defaultTitles.get(ledgerId) ?? ledgerId,
          kind: 'local' as const,
          syncState: 'local-only' as const
        }
      }))
      const placements = selectedItems.map((item) => {
        const targets = assignmentsByAid.get(item.aid)?.targetLedgerIds.filter((id) => id !== 'inbox') ?? []
        const prior = repository.positions[`${workspace.accountMid}:${item.aid}`]
        return {
          aid: item.aid,
          localDesiredFolderIds: targets.map((ledgerId) => `bilimi-logical:${ledgerId}`).sort(),
          remoteObservedPhysicalFolderIds: [...(prior?.remoteObservedPhysicalFolderIds ?? [])],
          remoteObservedLogicalFolderIds: [...(prior?.remoteObservedLogicalFolderIds ?? [])],
          updatedAt: this.now(),
          reason: 'old-favorite-local-first'
        }
      })
      await this.options.repository.commit(workspace.accountMid, {
        id: `old-favorite-workspace:remote-local:${workspace.id}:${randomUUID()}`,
        accountMid: workspace.accountMid,
        issuedAt: this.now(),
        type: 'commit-local-plan',
        payload: {
          workspaceId: workspace.id,
          memberAidsByFolderId: Object.fromEntries(Object.entries(memberAidsByFolderId)
            .map(([folderId, aids]) => [folderId, [...new Set(aids)].sort((left, right) => left - right)])),
          folders,
          videos: selectedItems.map((item) => ({
            aid: item.aid,
            title: item.title?.trim() || `Video ${item.aid}`,
            ...(item.author?.trim() ? { author: item.author.trim() } : {}),
            ...(item.description?.trim() ? { description: item.description.trim() } : {}),
            tags: [...(item.tags ?? [])],
            updatedAt: this.now()
          })),
          organizationRecords,
          placements,
          audit: { operation: 'organize-favorites' }
        }
      })
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
    await this.options.syncService.rebindPageTarget(run.accountMid, run.runId)
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
    await this.options.syncService.rebindPageTarget(run.accountMid, run.runId)
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

  private async openUnsafe(accountMid: string): Promise<OldFavoriteWorkspace | OldFavoriteWorkspaceRecoveryRequired | null> {
    const snapshot = await this.options.repository.getSnapshot(accountMid)
    const account = snapshot.accountMid
    const cached = this.workspaces.get(account)
    if (cached && snapshot.workspace && this.matchesMarker(cached, snapshot.workspace)) return clone(cached)

    if (snapshot.workspace) {
      const restored = await this.restoreFromStore(snapshot.workspace, snapshot.updatedAt, snapshot)
      return restored
    }

    return null
  }

  private async createScanningWorkspace(accountMid: string, mode?: OldFavoriteWorkspace['mode'], scope?: OldFavoriteWorkspaceScope) {
    const account = (await this.options.repository.getSnapshot(accountMid)).accountMid
    const now = this.now()
    const workspace = createOldFavoriteWorkspace({
      accountMid: account,
      now,
      id: `old-favorite-workspace-${account}-${now.replace(/[^0-9]/g, '')}-${randomUUID()}`,
      scope,
      segmentSize: this.options.segmentSize?.()
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
    this.inventoryMetrics.delete(account)
    this.scanRuns.delete(account)
    this.scannedAids.delete(account)
    this.scannedTagStates.delete(account)
    this.streamingScans.delete(account)
    this.tagEnrichments.delete(account)
    this.deepSeekRunCheckpoints.delete(account)
    this.recommendationIndexes.delete(account)
    this.remember(workspace, '', [], new Set())
    return mode ? { ...workspace, mode } : workspace
  }

  private async restoreFromStore(
    marker: FavoriteRepositoryWorkspace,
    updatedAt: string,
    repositorySnapshot: Awaited<ReturnType<FavoriteRepositoryService['getSnapshot']>>,
    options: { pauseRunningTagEnrichment?: boolean } = {}
  ): Promise<OldFavoriteWorkspace | OldFavoriteWorkspaceRecoveryRequired> {
    if (marker.status === 'draft') {
      this.workspaces.delete(marker.accountMid)
      return {
        recovery: 'rebuild-required',
        preserveCompletedLocalResults: true,
        accountMid: marker.accountMid,
        workspaceId: marker.id
      }
    }
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
    const recoveredDeepSeekRunCheckpoint = recovered.deepSeekRunCheckpoint?.workspaceId === marker.id
      ? clone(recovered.deepSeekRunCheckpoint)
      : null
    this.deepSeekRunCheckpoints.delete(marker.accountMid)
    // A frozen/executing/completed repository marker supersedes the preview-only
    // intent even if the process stopped before its journal tombstone was written.
    if (marker.status === 'previewing' && recovered.executionIntent?.workspaceId === marker.id) {
      this.executionIntents.set(marker.accountMid, clone(recovered.executionIntent))
    } else {
      this.executionIntents.delete(marker.accountMid)
    }
    const unavailableAids = new Set(Object.values(repositorySnapshot.videos)
      .filter((video) => isUnavailableScanItem(video))
      .map((video) => video.aid))
    const restoredSourceFolders = restoredSourceFoldersWithInvalidCounts(
      recovered.sourceFolders, repositorySnapshot, unavailableAids
    )
    if (marker.status === 'previewing' && recovered.recoveryDecision && recovered.recoveryBaseline) {
      const current = recoveryBaselineVector(await this.options.repository.getSnapshot(marker.accountMid), recovered.recoveryBaseline.aids,
        await this.options.resolveRecoveryConfiguration?.(marker.accountMid))
      if (recovered.recoveryDecision.evidenceFingerprint &&
        recovered.recoveryDecision.evidenceFingerprint !== current.fingerprint) {
        throw new Error('Old favorite workspace recovery decision is stale; read a new recovery summary first.')
      }
    }

    // The repository commit is authoritative. If the process stopped between
    // that idempotent commit and the workspace-manifest acknowledgement, repair
    // only the local marker; never replay the repository command.
    if (marker.status === 'completed' && marker.workspaceRef.lastCommittedId &&
      (recovered.status !== 'completed' || recovered.lastCommittedId !== marker.workspaceRef.lastCommittedId)) {
      await this.options.workspaceStore.markCommitted(marker.accountMid, marker.id, marker.workspaceRef.lastCommittedId)
    }

    const events = recovered.history.map(decodeJournalEvent).filter((event): event is WorkspaceJournalEvent => Boolean(event))
    const scan = events.find((event): event is ScanJournalEvent => event.type === 'scan')
    if (marker.status === 'scanning') {
      this.recommendationIndexes.delete(marker.accountMid)
      const streamingState = recovered.streamingScan
      const scanningBase = createOldFavoriteWorkspace({
        accountMid: marker.accountMid,
        id: marker.id,
        now: updatedAt,
        segmentSize: streamingState?.segmentSize
      })
      const scanningSegments = (streamingState?.sealedSegments ?? []).map((segment) => ({
        id: segment.id,
        index: segment.index,
        aids: [...segment.aids],
        status: 'previewing' as const
      }))
      const scanning = {
        ...scanningBase,
        mode: recovered.scan.mode,
        plannedAids: scanningSegments.flatMap((segment) => segment.aids),
        segments: scanningSegments,
        hasMultipleSegments: scanningSegments.length > 1
      }
      const restoredScan = { ...recovered.scan, paused: true }
      this.scanOverviews.set(marker.accountMid, {
        sourceFolders: restoredSourceFolders,
        scan: restoredScan
      })
      if (recovered.scan.paused !== true) {
        await this.options.workspaceStore.appendOverlay(marker.accountMid, marker.id, {
          currentSegmentId: '', classifications: [], history: [],
          scanMetadata: { sourceFolders: restoredSourceFolders, ...restoredScan }
        })
      }
      if (recovered.inventoryMetrics) this.inventoryMetrics.set(marker.accountMid, clone(recovered.inventoryMetrics))
      else this.inventoryMetrics.delete(marker.accountMid)
      this.recommendations.set(marker.accountMid, clone(recovered.recommendations))
      if (recovered.scanRunId) {
        const scannedAids = new Set<number>(streamingState?.observedAids ?? [])
        const scannedTagStates = new Map<number, boolean>((streamingState?.taggedAids ?? []).map((aid) => [aid, true]))
        if (!streamingState) {
          // Legacy v1 scanning drafts have no compact index. Preserve their
          // resumability, while all new drafts recover without reading pages.
          const pages = await this.options.workspaceStore.readScanPages(marker.accountMid, marker.id)
          for (const page of pages) for (const item of page.items) {
            scannedAids.add(item.aid)
            scannedTagStates.set(item.aid, Boolean(scannedTagStates.get(item.aid) || item.tags?.length))
          }
        }
        this.scanRuns.set(marker.accountMid, recovered.scanRunId)
        this.scannedAids.set(marker.accountMid, scannedAids)
        this.scannedTagStates.set(marker.accountMid, scannedTagStates)
        const managedProtectedAids = recovered.scan.mode === 'incremental'
          ? await this.options.workspaceStore.readManagedMemberAids(marker.accountMid, marker.id)
          : []
        const openItems = new Map((streamingState?.openItems ?? []).map((item) => [item.aid, clone(item)]))
        this.streamingScans.set(marker.accountMid, {
          segmentSize: streamingState?.segmentSize ?? scanning.segmentSize,
          sealedSegments: scanningSegments.map(({ id, index, aids }) => ({ id, index, aids: [...aids] })),
          sealedItemsBySegment: recovered.currentSegmentId && recovered.loadedSegmentItems.length
            ? new Map([[recovered.currentSegmentId, recovered.loadedSegmentItems.map(clone)]])
            : new Map(),
          assignedAids: new Set([
            ...scanningSegments.flatMap((segment) => segment.aids),
            ...openItems.keys()
          ]),
          observedAids: scannedAids,
          openItems,
          protectedAids: new Set([
            ...repositorySnapshot.organizationRecords.map((record) => record.aid),
            ...managedProtectedAids
          ])
        })
      } else {
        this.scanRuns.delete(marker.accountMid)
        this.scannedAids.delete(marker.accountMid)
        this.scannedTagStates.delete(marker.accountMid)
        this.streamingScans.delete(marker.accountMid)
      }
      if (recovered.tagEnrichment) {
        const normalizedTagEnrichment = normalizeTagEnrichment(recovered.tagEnrichment)
        if (options.pauseRunningTagEnrichment !== false &&
          normalizedTagEnrichment.status === 'running' && normalizedTagEnrichment.pendingAids.length) {
          await this.options.workspaceStore.appendTagEnrichmentDelta(marker.accountMid, marker.id, {
            currentSegmentId: recovered.currentSegmentId, kind: 'status', status: 'paused'
          })
          normalizedTagEnrichment.status = 'paused'
        }
        this.tagEnrichments.set(marker.accountMid, normalizedTagEnrichment)
      }
      this.currentSegmentItems.set(marker.accountMid, recovered.loadedSegmentItems.map(clone))
      this.remember(scanning, recovered.currentSegmentId, scanningSegments.map((segment) => ({
        id: segment.id, index: segment.index, itemCount: segment.aids.length
      })), new Set())
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
    const frozenIds = new Set<string>()
    for (const event of events) {
      if (event.type === 'freeze') frozenIds.add(event.segmentId)
      else if (event.type === 'classification') frozenIds.delete(event.segmentId ?? recovered.currentSegmentId)
    }
    const journalState = replayClassificationJournal(recovered.overlayHistory)
    const overviewClassificationsBySegment = new Map<string, Map<number, OldFavoriteWorkspace['classifications'][string]>>()
    for (const descriptor of scan.segments) {
      const entries = journalState.entriesBySegment.get(descriptor.id) ?? []
      const cursor = Math.min(journalState.cursorBySegment.get(descriptor.id) ?? entries.length, entries.length)
      const classifications = new Map<number, OldFavoriteWorkspace['classifications'][string]>()
      for (const entry of entries.slice(0, cursor)) for (const change of entry.changes) {
        if (change.after) classifications.set(change.aid, clone(change.after))
        else classifications.delete(change.aid)
      }
      overviewClassificationsBySegment.set(descriptor.id, classifications)
    }
    await this.restoreOverviewRuntime(marker.accountMid, marker.id, scan.segments, recovered.currentSegmentId,
      recovered.loadedSegmentItems, overviewClassificationsBySegment, recovered.overview,
      restoredSourceFolders, repositorySnapshot, unavailableAids)
    await this.restoreDeepSeekOrganizationProjection(
      marker.accountMid,
      marker.id,
      scan.segments,
      recovered.currentSegmentId,
      recovered.loadedSegmentItems,
      journalState
    )
    const allHistory = journalState.entriesBySegment.get(recovered.currentSegmentId) ?? []
    const latestCursor = journalState.cursorBySegment.get(recovered.currentSegmentId) ?? allHistory.length
    const recoveredHistory = allHistory.map((entry) => ({
      ...entry,
      changes: entry.changes.filter((change) => activeAidSet.has(change.aid)),
      ...(entry.deepSeekProcessedItems
        ? { deepSeekProcessedItems: entry.deepSeekProcessedItems.filter((detail) => activeAidSet.has(detail.aid)) }
        : {})
    })).filter((entry) => entry.changes.length > 0 || Boolean(entry.deepSeekProcessedItems?.length))
    const history = marker.status === 'completed' ? [] : recoveredHistory
    const historyCursor = marker.status === 'completed' ? 0 : Math.min(latestCursor, history.length)
    const historyBaselineCursor = marker.status === 'completed'
      ? 0
      : Math.min(journalState.baselineCursorBySegment.get(recovered.currentSegmentId) ?? 0, history.length)
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
      ,scope: scan.scope
    })
    let workspace: OldFavoriteWorkspace = {
      ...scanning,
      status: marker.status,
      mode: scan.mode,
      scope: scan.scope?.kind === 'selection' ? clone(scan.scope) : { kind: 'account' },
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
      ...(historyBaselineCursor ? { historyBaselineCursor } : {}),
      ...(marker.completionMode ? { completionMode: marker.completionMode } : {})
    }
    this.scanOverviews.set(marker.accountMid, {
      // Workspaces created before source selection did not persist this flag.
      sourceFolders: restoredSourceFolders.map((folder) => ({
        ...folder,
        selected: scanSourceIsEligible(folder) ? folder.selected ?? true : false
      })),
      localWorkspaceFolders: recovered.localWorkspaceFolders ?? this.projectLocalWorkspaceFolders(repositorySnapshot),
      // Preserve the completed inventory totals written by the scan instead
      // of rebuilding a status-only summary after an application restart.
      scan: { ...recovered.scan, phase: 'complete', failureCount: 0, mode: scan.mode }
    })
    this.inventoryMetrics.set(marker.accountMid, recovered.inventoryMetrics
      ? clone(recovered.inventoryMetrics)
      : this.projectInventoryMetrics(restoredSourceFolders, repositorySnapshot, 'complete'))
    const recommendations = await this.restoreRecommendationIndexes(
      marker.accountMid,
      marker.id,
      recovered.currentSegmentId,
      scan.segments,
      recovered.recommendations,
      recovered.tagUpdates,
      recovered.loadedSegmentItems,
      Boolean(recovered.tagEnrichment && recovered.tagEnrichment.status !== 'complete'),
      unavailableAids
    )
    this.recommendations.set(marker.accountMid, clone(recommendations))
    if (recommendations.adoptedCandidateIds.length > 0 || marker.status === 'completed' || marker.status === 'frozen' || frozenIds.size > 0) {
      await this.persistRecommendedLedgersUnsafe(workspace, recommendations)
    }
    const repairedReadiness = this.calculatePlanReadinessFromClassifications(
      workspace,
      recovered.classifications,
      unavailableAids
    )
    if (JSON.stringify(repairedReadiness) !== JSON.stringify(recovered.planReadiness)) {
      await this.options.workspaceStore.appendOverlay(marker.accountMid, marker.id, {
        currentSegmentId: recovered.currentSegmentId,
        classifications: [],
        history: [],
        planReadiness: repairedReadiness
      })
    }
    this.planReadiness.set(marker.accountMid, repairedReadiness)
    this.staleDeepSeekAids.set(marker.accountMid, [...new Set(recovered.recoveryDecision?.staleDeepSeekAids ?? [])].sort((left, right) => left - right))
    if (recovered.tagEnrichment) {
      const normalizedTagEnrichment = normalizeTagEnrichment(recovered.tagEnrichment)
      if (options.pauseRunningTagEnrichment !== false &&
        normalizedTagEnrichment.status === 'running' && normalizedTagEnrichment.pendingAids.length) {
        await this.options.workspaceStore.appendTagEnrichmentDelta(marker.accountMid, marker.id, {
          currentSegmentId: recovered.currentSegmentId, kind: 'status', status: 'paused'
        })
        normalizedTagEnrichment.status = 'paused'
      }
      this.tagEnrichments.set(marker.accountMid, normalizedTagEnrichment)
      if (recovered.tagUpdates.length) {
        const updates = new Map(recovered.tagUpdates.map((update) => [update.aid, update.tags]))
        this.currentSegmentItems.set(marker.accountMid, recovered.loadedSegmentItems.map((item) =>
          updates.has(item.aid) ? { ...item, tags: updates.get(item.aid) } : item))
      }
    } else this.tagEnrichments.delete(marker.accountMid)
    this.remember(workspace, recovered.currentSegmentId, scan.segments, frozenIds)
    const normalizedDeepSeekRunCheckpoint = this.normalizeDeepSeekRunCheckpoint(workspace, recoveredDeepSeekRunCheckpoint)
    if (normalizedDeepSeekRunCheckpoint) this.deepSeekRunCheckpoints.set(marker.accountMid, clone(normalizedDeepSeekRunCheckpoint))
    if (JSON.stringify(normalizedDeepSeekRunCheckpoint) !== JSON.stringify(recoveredDeepSeekRunCheckpoint)) {
      await this.options.workspaceStore.appendOverlay(marker.accountMid, marker.id, {
        currentSegmentId: recovered.currentSegmentId,
        classifications: [],
        history: [],
        deepSeekRunCheckpoint: normalizedDeepSeekRunCheckpoint
      })
    }
    if (this.shouldBackfillInitialSystemClassifications(workspace, this.tagEnrichments.get(marker.accountMid))) {
      workspace = await this.checkpointInitialSystemClassificationsUnsafe(
        await this.autoClassifyCurrentSegmentUnsafe(workspace, true)
      )
    }
    if (recovered.recoveryDecision?.choice === 'merge-latest' && recovered.recoveryDecision.mergeLatestSystemAids?.length &&
      marker.status === 'previewing') {
      // Recovery intentionally loads only the active segment. Leave other
      // affected aids pending until their segment is explicitly selected.
      const changedAids = new Set(recovered.recoveryDecision.mergeLatestSystemAids)
      const segmentIds = workspace.segments.filter((segment) => segment.aids.some((aid) => changedAids.has(aid))).map((segment) => segment.id)
      if (segmentIds.length && (this.options.classifyCurrentItem || this.options.classifyCurrentItems)) {
        const refreshed = await this.autoClassifySegmentsUnsafe(workspace, segmentIds, true, changedAids, undefined, true)
        const appliedAids = new Set(workspace.segments.flatMap((segment) => segment.aids).filter((aid) => changedAids.has(aid)))
        await this.options.workspaceStore.setRecoveryDecision(marker.accountMid, marker.id, {
          ...recovered.recoveryDecision,
          mergeLatestSystemAids: recovered.recoveryDecision.mergeLatestSystemAids.filter((aid) => !appliedAids.has(aid)),
          recordedAt: this.now()
        })
        return clone(refreshed)
      }
    }
    return clone(workspace)
  }

  private shouldBackfillInitialSystemClassifications(
    workspace: OldFavoriteWorkspace,
    enrichment: TagEnrichment | undefined
  ) {
    if (workspace.status !== 'previewing' || (!this.options.classifyCurrentItem && !this.options.classifyCurrentItems)) {
      return false
    }
    if ((workspace.historyBaselineCursor ?? 0) > 0 || workspace.history.some((entry) =>
      entry.source === 'manual' || entry.source === 'deepseek')) {
      return false
    }
    const currentSegment = workspace.segments.find((segment) => segment.id === this.currentSegment(workspace))
    if (!currentSegment) return false
    if (enrichment?.acceptedSegmentIds.includes(currentSegment.id)) return true
    const pendingAids = new Set(enrichment?.pendingAids ?? [])
    return !currentSegment.aids.some((aid) => pendingAids.has(aid))
  }

  /** Stops only the remaining remote queue after the active request reaches a durable result. */
  async stopBilibiliSyncAndFinish(accountMid: string): Promise<void> {
    const execution = await this.queue(async () => {
      const persisted = await this.options.repository.getSnapshot(accountMid)
      if (persisted.workspace?.status !== 'executing' || !persisted.workspace.frozenSyncPlan) {
        throw new Error('Old favorite workspace is not executing a Bilibili sync.')
      }
      const workspace = await this.requireWorkspace(persisted.accountMid)
      if (!this.options.syncService) throw new Error('Old favorite workspace sync service is unavailable.')
      await this.commitCompleteLocalResultForRemoteExecutionUnsafe(workspace)
      return { accountMid: persisted.accountMid, planId: persisted.workspace.frozenSyncPlan.id }
    })
    if (!this.options.syncService) throw new Error('Old favorite workspace sync service is unavailable.')
    await this.options.syncService.stopAndAbandonFrozenPlan(execution.accountMid)
    await this.queue(async () => {
      this.forgetWorkspace(execution.accountMid)
    })
  }

  /** Preserves the frozen remote plan after the current request reaches its durable checkpoint. */
  async pauseBilibiliSync(accountMid: string): Promise<OldFavoriteWorkspaceSnapshot> {
    const execution = await this.queue(async () => {
      const persisted = await this.options.repository.getSnapshot(accountMid)
      if (persisted.workspace?.status !== 'executing' || !persisted.workspace.frozenSyncPlan) {
        throw new Error('Old favorite workspace is not executing a Bilibili sync.')
      }
      if (!this.options.syncService) throw new Error('Old favorite workspace sync service is unavailable.')
      return persisted.accountMid
    })
    if (!this.options.syncService) throw new Error('Old favorite workspace sync service is unavailable.')
    await this.options.syncService.pauseFrozenPlan(execution)
    const snapshot = await this.getSnapshot(execution)
    if (!snapshot || isRecoveryRequired(snapshot)) throw new Error('Old favorite workspace is unavailable after pausing Bilibili sync.')
    return snapshot
  }

  private assertCurrentSegmentTagReady(workspace: OldFavoriteWorkspace) {
    this.assertSegmentTagReady(workspace, this.currentSegment(workspace))
  }

  private assertSegmentTagReady(workspace: OldFavoriteWorkspace, segmentId: string) {
    const segment = workspace.segments.find((candidate) => candidate.id === segmentId)
    if (!segment) throw new Error('Old favorite workspace segment is invalid.')
    const enrichment = this.tagEnrichments.get(workspace.accountMid)
    if (!enrichment || enrichment.acceptedSegmentIds.includes(segment.id)) return
    if (segment.aids.some((aid) => enrichment.pendingAids.includes(aid))) {
      throw new Error('Old favorite workspace current batch tag enrichment is not complete.')
    }
  }

  private async requireWorkspace(accountMid: string): Promise<OldFavoriteWorkspace> {
    const snapshot = await this.options.repository.getSnapshot(accountMid)
    const workspace = this.workspaces.get(snapshot.accountMid)
    if (workspace && snapshot.workspace && this.matchesMarker(workspace, snapshot.workspace)) return workspace
    const opened = await this.openUnsafe(snapshot.accountMid)
    if (isRecoveryRequired(opened)) throw new Error('Old favorite workspace requires rebuild.')
    if (!opened) throw new Error('Old favorite workspace has not been started.')
    return opened
  }

  private forgetWorkspace(accountMid: string) {
    this.workspaces.delete(accountMid)
    this.currentSegments.delete(accountMid)
    this.segmentDescriptors.delete(accountMid)
    this.currentSegmentItems.delete(accountMid)
    this.frozenSegments.delete(accountMid)
    this.scanOverviews.delete(accountMid)
    this.inventoryMetrics.delete(accountMid)
    this.scanRuns.delete(accountMid)
    this.scannedAids.delete(accountMid)
    this.scannedTagStates.delete(accountMid)
    this.streamingScans.delete(accountMid)
    this.tagEnrichments.delete(accountMid)
    this.recommendations.delete(accountMid)
    this.recommendationIndexes.delete(accountMid)
    this.planReadiness.delete(accountMid)
    this.staleDeepSeekAids.delete(accountMid)
    this.overviewRuntimes.delete(accountMid)
    this.deepSeekRunCheckpoints.delete(accountMid)
    this.deepSeekOrganizationProjections.delete(accountMid)
    this.executionIntents.delete(accountMid)
    this.executionIntentRuns.delete(accountMid)
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
    this.updateOverviewClassifications(workspace.accountMid, events.flatMap((event) => event.type === 'classification'
      ? [{ segmentId: event.segmentId ?? currentSegmentId, entry: event.entry }]
      : []))
    if (planReadiness) this.planReadiness.set(workspace.accountMid, planReadiness)
  }

  private updateOverviewClassifications(
    accountMid: string,
    entries: Array<{ segmentId: string; entry: OldFavoriteWorkspaceHistoryEntry }>
  ) {
    const overviewRuntime = this.overviewRuntimes.get(accountMid)
    if (!overviewRuntime) return
    for (const { segmentId, entry } of entries) {
      const classifications = overviewRuntime.classificationsBySegment.get(segmentId) ?? new Map()
      for (const change of entry.changes) {
        if (change.after) classifications.set(change.aid, clone(change.after))
        else classifications.delete(change.aid)
      }
      overviewRuntime.classificationsBySegment.set(segmentId, classifications)
    }
  }

  private async calculatePlanReadiness(workspace: OldFavoriteWorkspace): Promise<PlanReadiness> {
    const plannedAids = new Set(normalizeAids(workspace.plannedAids))
    const recovered = await this.options.workspaceStore.recover(workspace.accountMid, workspace.id)
    if ('recovery' in recovered) throw new Error('Old favorite workspace requires rebuild.')
    return this.calculatePlanReadinessFromClassifications(workspace, recovered.classifications)
  }

  private calculatePlanReadinessFromClassifications(
    workspace: OldFavoriteWorkspace,
    classifications: Record<string, { aid: number; targetLedgerIds: string[] }>,
    excludedAids: ReadonlySet<number> = new Set()
  ): PlanReadiness {
    const selectableSources = (this.scanOverviews.get(workspace.accountMid)?.sourceFolders ?? [])
      .filter(scanSourceIsEligible)
    const overviewRuntime = this.overviewRuntimes.get(workspace.accountMid)
    const hasSourceSelectionMetadata = selectableSources.length > 0
    const hasDeselectedSource = selectableSources.some((folder) => folder.selected === false)
    const selectedAids = hasSourceSelectionMetadata && hasDeselectedSource && overviewRuntime
      ? new Set([...overviewRuntime.selectedAidsBySegment.values()].flatMap((aids) => [...aids]))
      : undefined
    const plannedAids = new Set(normalizeAids(workspace.plannedAids)
      .filter((aid) => !excludedAids.has(aid) && (!selectedAids || selectedAids.has(aid))))
    const classifiedAidCount = new Set(Object.values(classifications)
      .filter((classification) => !excludedAids.has(classification.aid) &&
        (!selectedAids || selectedAids.has(classification.aid)) && classification.targetLedgerIds.length)
      .map((classification) => classification.aid)).size
    const selectedAidCount = hasSourceSelectionMetadata && overviewRuntime
      ? [...overviewRuntime.selectedItemCountsBySegment.values()].reduce((count, itemCount) => count + itemCount, 0)
      : plannedAids.size
    return { selectedAidCount, classifiedAidCount: Math.min(selectedAidCount, classifiedAidCount) }
  }

  private calculatePlanReadinessFromItems(
    workspace: OldFavoriteWorkspace,
    _items: Iterable<CurrentSegmentItem>,
    _sourceFolders: ScanOverview['sourceFolders']
  ): PlanReadiness {
    return { selectedAidCount: normalizeAids(workspace.plannedAids).length, classifiedAidCount: 0 }
  }

  private async applyReadinessHistoryChange(
    workspace: OldFavoriteWorkspace,
    entry: OldFavoriteWorkspaceHistoryEntry | undefined,
    direction: 'forward' | 'undo'
  ): Promise<PlanReadiness> {
    const current = this.planReadiness.get(workspace.accountMid) ?? await this.calculatePlanReadiness(workspace)
    if (!entry) return current
    const selectedAids = new Set(normalizeAids(workspace.plannedAids))
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
      .filter((folder) => scanSourceIsEligible(folder) && folder.selected)
      .map((folder) => folder.id))
    const currentItems = this.currentSegmentItems.get(workspace.accountMid)
    const items = currentItems ?? await this.loadCurrentSegmentItems(workspace)
    const itemsByAid = new Map(items.map((item) => [item.aid, item]))
    return assignments.filter((assignment) =>
      !isUnavailableScanItem(itemsByAid.get(assignment.aid) ?? {}) &&
      itemsByAid.get(assignment.aid)?.sourceFolderIds.some((folderId) => selectedSourceFolderIds.has(folderId)))
  }

  /** Replays per-segment journal deltas only when compiling a one-confirmation remote plan. */
  private async loadSelectedClassificationsForFreeze(workspace: OldFavoriteWorkspace, includeInbox = false) {
    const overlays = await this.options.workspaceStore.readOverlayHistory(workspace.accountMid, workspace.id)
    const classifications = replayClassificationJournal(overlays).classifications
    const overview = this.scanOverviews.get(workspace.accountMid)
    if (!overview) return []
    const sourceFolders = overview.sourceFolders
    const hasSelectableSourceFolders = sourceFolders.some(scanSourceIsEligible)
    const selectedSourceFolderIds = new Set(sourceFolders
      .filter((folder) => scanSourceIsEligible(folder) && folder.selected)
      .map((folder) => folder.id))
    const selected = [] as OldFavoriteWorkspace['classifications'][string][]
    const descriptors = this.segmentDescriptors.get(workspace.accountMid) ?? workspace.segments.map(({ id, index, aids }) => ({ id, index, itemCount: aids.length }))
    for (const descriptor of descriptors) {
      const segment = await this.options.workspaceStore.loadSegment(workspace.accountMid, workspace.id, descriptor.id)
      for (const item of segment.items ?? []) {
        const classification = classifications.get(item.aid)
        if (!isUnavailableScanItem(item) &&
          (!hasSelectableSourceFolders || item.sourceFolderIds.some((folderId) => selectedSourceFolderIds.has(folderId)))) {
          if (classification?.targetLedgerIds.length) selected.push(clone(classification))
          else if (includeInbox) selected.push({ aid: item.aid, targetLedgerIds: ['inbox'], source: 'system-low' })
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
    const selectable = overview.sourceFolders.filter(scanSourceIsEligible)
    const selectedSourceFolderIds = new Set(selectable.filter((folder) => folder.selected).map((folder) => folder.id))
    if (selectable.length && !selectedSourceFolderIds.size) return
    const expectedAids = new Set<number>()
    const descriptors = this.segmentDescriptors.get(workspace.accountMid) ?? workspace.segments.map(({ id, index, aids }) => ({ id, index, itemCount: aids.length }))
    for (const descriptor of descriptors) {
      const segment = await this.options.workspaceStore.loadSegment(workspace.accountMid, workspace.id, descriptor.id)
      for (const item of segment.items ?? []) {
        if (!isUnavailableScanItem(item) &&
          (!selectable.length || item.sourceFolderIds.some((folderId) => selectedSourceFolderIds.has(folderId)))) expectedAids.add(item.aid)
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
    const snapshot = await this.options.repository.getSnapshot(workspace.accountMid)
    await this.options.workspaceStore.setRecoveryBaseline(workspace.accountMid, workspace.id,
      recoveryBaselineVector(snapshot, workspace.segments.flatMap((segment) => segment.aids),
        await this.options.resolveRecoveryConfiguration?.(workspace.accountMid)))
  }

  private async createMarker(
    workspace: OldFavoriteWorkspace,
    frozenSyncPlan?: FavoriteRepositoryWorkspace['frozenSyncPlan'],
    completionMode?: FavoriteRepositoryWorkspace['completionMode'],
    lastCommittedId?: string
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
        checksum: recovered.manifestChecksum,
        ...(lastCommittedId ? { lastCommittedId } : snapshot.workspace?.id === workspace.id && snapshot.workspace.workspaceRef.lastCommittedId
          ? { lastCommittedId: snapshot.workspace.workspaceRef.lastCommittedId } : {})
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

  private async restoreRecommendationIndexes(
    accountMid: string,
    workspaceId: string,
    currentSegmentId: string,
    segments: SegmentDescriptor[],
    state: RecommendationState,
    tagUpdates: Array<{ aid: number; tags: string[] }>,
    currentSegmentItems: CurrentSegmentItem[],
    rebuildIncrementalIndex: boolean,
    unavailableAids: ReadonlySet<number>
  ): Promise<RecommendationState> {
    const sanitizedState = withoutUnavailableRecommendationMatches(state, unavailableAids)
    const missingIds = new Set(sanitizedState.candidates
      .filter((candidate) => !candidate.matchedAidsBySegment)
      .map((candidate) => candidate.id))
    const sanitized = sanitizedState !== state
    if (!rebuildIncrementalIndex && !missingIds.size) {
      if (sanitized) {
        await this.options.workspaceStore.appendOverlay(accountMid, workspaceId, {
          currentSegmentId, classifications: [], history: [], recommendations: sanitizedState
        })
      }
      return sanitizedState
    }

    const updatedTags = new Map(tagUpdates.map((update) => [update.aid, update.tags]))
    const itemsByAid = new Map<number, CurrentSegmentItem>()
    const segmentIdForAid = new Map<number, string>()
    for (const descriptor of segments) {
      const storedItems = descriptor.id === currentSegmentId
        ? currentSegmentItems
        : (await this.options.workspaceStore.loadSegment(accountMid, workspaceId, descriptor.id)).items ?? []
      for (const item of storedItems) {
        segmentIdForAid.set(item.aid, descriptor.id)
        const existing = itemsByAid.get(item.aid)
        const tags = updatedTags.get(item.aid) ?? item.tags
        if (existing) {
          existing.sourceFolderIds = [...new Set([...existing.sourceFolderIds, ...item.sourceFolderIds])].sort()
          if (!existing.tags?.length && tags?.length) existing.tags = [...tags]
        } else itemsByAid.set(item.aid, { ...item, ...(tags ? { tags: [...tags] } : {}) })
      }
    }
    const index = createRecommendationIndex(
      workspaceId,
      itemsByAid.values(),
      (aid) => segmentIdForAid.get(aid) ?? currentSegmentId
    )
    if (rebuildIncrementalIndex) {
      this.recommendationIndexes.set(accountMid, index)
      if (sanitized) {
        await this.options.workspaceStore.appendOverlay(accountMid, workspaceId, {
          currentSegmentId, classifications: [], history: [], recommendations: sanitizedState
        })
      }
      return sanitizedState
    }
    const rebuilt = recommendationsFromIndex(
      index,
      sanitizedState.adoptedCandidateIds,
      sanitizedState.candidates
    )
    if (missingIds.size || sanitized) {
      await this.options.workspaceStore.appendOverlay(accountMid, workspaceId, {
        currentSegmentId, classifications: [], history: [], recommendations: rebuilt
      })
    }
    return rebuilt
  }

  private async refreshRecommendationsAfterTagEnrichment(workspace: OldFavoriteWorkspace) {
    const index = this.recommendationIndexes.get(workspace.accountMid)
    if (!index || index.workspaceId !== workspace.id) {
      throw new Error('Old favorite workspace recommendation index is unavailable.')
    }
    const next = this.recommendations.get(workspace.accountMid) ?? recommendationsFromIndex(index)
    await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
      currentSegmentId: this.currentSegment(workspace), classifications: [], history: [], recommendations: next
    })
    this.recommendations.set(workspace.accountMid, clone(next))
  }

  private updateRecommendationIndexTags(workspace: OldFavoriteWorkspace, aid: number, tags: readonly string[]) {
    const index = this.recommendationIndexes.get(workspace.accountMid)
    if (!index || index.workspaceId !== workspace.id) {
      throw new Error('Old favorite workspace recommendation index is unavailable.')
    }
    updateRecommendationIndexTags(index, aid, tags)
  }

  private rebuildRecommendationsAfterTagBatch(workspace: OldFavoriteWorkspace) {
    const index = this.recommendationIndexes.get(workspace.accountMid)
    if (!index || index.workspaceId !== workspace.id) {
      throw new Error('Old favorite workspace recommendation index is unavailable.')
    }
    const prior = this.recommendations.get(workspace.accountMid)
    this.recommendations.set(workspace.accountMid, recommendationsFromIndex(
      index,
      prior?.adoptedCandidateIds ?? [],
      prior?.candidates ?? []
    ))
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
      items.push(...page.items.filter((item) => !isUnavailableScanItem(item)))
    })
    const segmentIdForAid = new Map(workspace.segments.flatMap((segment) => segment.aids.map((aid) => [aid, segment.id] as const)))
    const state = buildAuthorRecommendations(items, (aid) => segmentIdForAid.get(aid) ?? this.currentSegment(workspace))
    await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
      currentSegmentId: this.currentSegment(workspace), classifications: [], history: [], recommendations: state
    })
    this.recommendations.set(workspace.accountMid, clone(state))
    return clone(state)
  }

  private async persistRecommendedLedgersUnsafe(workspace: OldFavoriteWorkspace, state: RecommendationState) {
    if (!this.options.saveRecommendedLedgers || !state.candidates.length) return
    const saved = await this.options.saveRecommendedLedgers(
      workspace.accountMid,
      state.candidates.map((candidate, index) => asLocalRecommendedLedger(candidate, 10_000 + index)),
      state.adoptedCandidateIds
    )
    if (saved !== false) this.options.notifyRecommendedLedgersChanged?.(workspace.accountMid)
  }

  private initializeOverviewRuntime(
    workspace: OldFavoriteWorkspace,
    items: Iterable<CurrentSegmentItem>,
    unavailableItemCount: number
  ) {
    const segmentIdByAid = new Map(workspace.segments.flatMap((segment) =>
      segment.aids.map((aid) => [aid, segment.id] as const)))
    const aidRangeBySegment = new Map(workspace.segments.map((segment) => [segment.id, {
      ...(segment.aids.length ? { firstAid: segment.aids[0], lastAid: segment.aids[segment.aids.length - 1] } : {})
    }]))
    const segmentAidsBySegment = new Map(workspace.segments.map((segment) => [segment.id, new Set(segment.aids)]))
    const sourceCountsBySegment = new Map(workspace.segments.map((segment) => [segment.id, new Map<string, number>()]))
    const selectedAidsBySegment = new Map(workspace.segments.map((segment) => [segment.id, new Set<number>()]))
    const selectedSourceFolderIds = new Set((this.scanOverviews.get(workspace.accountMid)?.sourceFolders ?? [])
      .filter((folder) => scanSourceIsEligible(folder) && folder.selected !== false)
      .map((folder) => folder.id))
    for (const item of items) {
      const segmentId = segmentIdByAid.get(item.aid)
      if (!segmentId || isUnavailableScanItem(item)) continue
      const sourceCounts = sourceCountsBySegment.get(segmentId) ?? new Map<string, number>()
      for (const sourceFolderId of new Set(item.sourceFolderIds)) {
        sourceCounts.set(sourceFolderId, (sourceCounts.get(sourceFolderId) ?? 0) + 1)
      }
      sourceCountsBySegment.set(segmentId, sourceCounts)
      if (item.sourceFolderIds.some((folderId) => selectedSourceFolderIds.has(folderId))) {
        const selectedAids = selectedAidsBySegment.get(segmentId) ?? new Set<number>()
        selectedAids.add(item.aid)
        selectedAidsBySegment.set(segmentId, selectedAids)
      }
    }
    const runtime: OverviewRuntime = {
      aidRangeBySegment,
      segmentAidsBySegment,
      sourceCountsBySegment,
      selectedAidsBySegment,
      selectedItemCountsBySegment: new Map(workspace.segments.map((segment) => [
        segment.id, selectedAidsBySegment.get(segment.id)?.size ?? 0
      ])),
      classificationsBySegment: new Map(workspace.segments.map((segment) => [segment.id, new Map()])),
      unavailableItemCount
    }
    this.overviewRuntimes.set(workspace.accountMid, runtime)
    return runtime
  }

  private persistedOverviewRuntime(runtime: OverviewRuntime) {
    return {
      segments: [...runtime.sourceCountsBySegment].map(([id, sourceCounts]) => ({
        id,
        aids: [...(runtime.segmentAidsBySegment.get(id) ?? [])].sort((left, right) => left - right),
        ...runtime.aidRangeBySegment.get(id),
        sourceFolderCounts: Object.fromEntries(sourceCounts),
        selectedItemCount: runtime.selectedItemCountsBySegment.get(id) ?? 0
      })),
      unavailableItemCount: runtime.unavailableItemCount
    }
  }

  private async restoreOverviewRuntime(
    accountMid: string,
    workspaceId: string,
    descriptors: SegmentDescriptor[],
    currentSegmentId: string,
    currentSegmentItems: CurrentSegmentItem[],
    classificationsBySegment: Map<string, Map<number, OldFavoriteWorkspace['classifications'][string]>>,
    persisted: { segments: Array<{ id: string; aids?: number[]; firstAid?: number; lastAid?: number; sourceFolderCounts: Record<string, number>; selectedItemCount?: number }>; unavailableItemCount: number } | undefined,
    sourceFolders: ScanOverview['sourceFolders'],
    repository: Awaited<ReturnType<FavoriteRepositoryService['getSnapshot']>>,
    unavailableAids: ReadonlySet<number>
  ) {
    const sourceMembershipAids = new Set(sourceFolders.flatMap((folder) =>
      repository.memberships[`bilibili:${folder.id}`] ?? repository.memberships[folder.id] ?? []))
    const sourceCountsBySegment = new Map((persisted?.segments ?? []).map((segment) => [
      segment.id, new Map(Object.entries(segment.sourceFolderCounts))
    ]))
    const aidRangeBySegment = new Map((persisted?.segments ?? []).map((segment) => [segment.id, {
      ...(segment.firstAid ? { firstAid: segment.firstAid } : {}),
      ...(segment.lastAid ? { lastAid: segment.lastAid } : {})
    }]))
    const segmentAidsBySegment = new Map((persisted?.segments ?? []).map((segment) => [segment.id, new Set(segment.aids ?? [])]))
    for (const descriptor of descriptors) {
      if (descriptor.id === currentSegmentId) continue
      const persistedSegment = persisted?.segments.find((segment) => segment.id === descriptor.id)
      if (!persistedSegment || (persistedSegment.aids?.length ?? 0) > 0) continue
      const stored = await this.options.workspaceStore.loadSegment(accountMid, workspaceId, descriptor.id)
      segmentAidsBySegment.set(descriptor.id, new Set(stored.aids))
    }
    const selectedSourceFolderIds = new Set(sourceFolders
      .filter((folder) => scanSourceIsEligible(folder) && folder.selected !== false)
      .map((folder) => folder.id))
    const allSelectableSourcesSelected = sourceFolders
      .filter(scanSourceIsEligible)
      .every((folder) => folder.selected !== false)
    const selectedAidsBySegment = new Map<string, Set<number>>()
    const selectedItemCountsBySegment = new Map<string, number>()
    const legacyAllSourceSegmentIds: string[] = []
    for (const descriptor of descriptors) {
      if (descriptor.id === currentSegmentId) {
        const selectedAids = new Set(currentSegmentItems
          .filter((item) => !isUnavailableScanItem(item) && item.sourceFolderIds.some((folderId) => selectedSourceFolderIds.has(folderId)))
          .map((item) => item.aid))
        selectedAidsBySegment.set(descriptor.id, selectedAids)
        selectedItemCountsBySegment.set(descriptor.id, selectedAids.size)
        continue
      }
      const persistedSegment = persisted?.segments.find((segment) => segment.id === descriptor.id)
      if (allSelectableSourcesSelected && persistedSegment?.selectedItemCount !== undefined) {
        selectedItemCountsBySegment.set(descriptor.id, persistedSegment.selectedItemCount)
        continue
      }
      if (allSelectableSourcesSelected) {
        selectedItemCountsBySegment.set(descriptor.id, descriptor.itemCount)
        legacyAllSourceSegmentIds.push(descriptor.id)
        continue
      }
      const items = descriptor.id === currentSegmentId
        ? currentSegmentItems
        : (await this.options.workspaceStore.loadSegment(accountMid, workspaceId, descriptor.id)).items ?? []
      const selectedAids = new Set(items
        .filter((item) => !isUnavailableScanItem(item) && item.sourceFolderIds.some((folderId) => selectedSourceFolderIds.has(folderId)))
        .map((item) => item.aid))
      selectedAidsBySegment.set(descriptor.id, selectedAids)
      selectedItemCountsBySegment.set(descriptor.id, selectedAids.size)
    }
    if (allSelectableSourcesSelected && legacyAllSourceSegmentIds.length) {
      const selectedTotal = [...sourceMembershipAids].filter((aid) => !unavailableAids.has(aid)).length
      let excess = Math.max(0, [...selectedItemCountsBySegment.values()]
        .reduce((count, itemCount) => count + itemCount, 0) - selectedTotal)
      for (const segmentId of legacyAllSourceSegmentIds) {
        if (!excess) break
        const count = selectedItemCountsBySegment.get(segmentId) ?? 0
        const correction = Math.min(count, excess)
        selectedItemCountsBySegment.set(segmentId, count - correction)
        excess -= correction
      }
    }
    if (!sourceCountsBySegment.has(currentSegmentId)) {
      const counts = new Map<string, number>()
      for (const item of currentSegmentItems) for (const sourceFolderId of new Set(item.sourceFolderIds)) {
        counts.set(sourceFolderId, (counts.get(sourceFolderId) ?? 0) + 1)
      }
      sourceCountsBySegment.set(currentSegmentId, counts)
      const aids = currentSegmentItems.map((item) => item.aid).sort((left, right) => left - right)
      segmentAidsBySegment.set(currentSegmentId, new Set(aids))
      aidRangeBySegment.set(currentSegmentId, aids.length ? { firstAid: aids[0], lastAid: aids[aids.length - 1] } : {})
    }
    if (!selectedAidsBySegment.has(currentSegmentId)) {
      const selectedAids = new Set(currentSegmentItems
        .filter((item) => !isUnavailableScanItem(item) && item.sourceFolderIds.some((folderId) => selectedSourceFolderIds.has(folderId)))
        .map((item) => item.aid))
      selectedAidsBySegment.set(currentSegmentId, selectedAids)
      selectedItemCountsBySegment.set(currentSegmentId, selectedAids.size)
    }
    for (const descriptor of descriptors) {
      if (!sourceCountsBySegment.has(descriptor.id)) sourceCountsBySegment.set(descriptor.id, new Map())
      if (!segmentAidsBySegment.has(descriptor.id)) segmentAidsBySegment.set(descriptor.id, new Set())
      if (!aidRangeBySegment.has(descriptor.id)) aidRangeBySegment.set(descriptor.id, {})
    }
    this.overviewRuntimes.set(accountMid, {
      aidRangeBySegment,
      segmentAidsBySegment,
      sourceCountsBySegment,
      selectedAidsBySegment,
      selectedItemCountsBySegment,
      classificationsBySegment,
      unavailableItemCount: persisted?.unavailableItemCount ??
        [...unavailableAids].filter((aid) => sourceMembershipAids.has(aid)).length
    })
  }

  private captureCurrentSegmentOverviewClassifications(workspace: OldFavoriteWorkspace) {
    const runtime = this.overviewRuntimes.get(workspace.accountMid)
    const currentSegment = workspace.segments.find((segment) => segment.id === this.currentSegment(workspace))
    if (!runtime || !currentSegment) return
    const classifications = new Map<number, OldFavoriteWorkspace['classifications'][string]>()
    for (const [aid, classification] of Object.entries(workspace.classifications)) {
      const numericAid = Number(aid)
      if (currentSegment.aids.includes(numericAid)) classifications.set(numericAid, clone(classification))
    }
    runtime.classificationsBySegment.set(currentSegment.id, classifications)
  }

  private createOverviewProjection(
    workspace: OldFavoriteWorkspace,
    segments: OldFavoriteWorkspaceSnapshot['segments']
  ): OldFavoriteWorkspaceSnapshot['overview'] {
    const scan = this.scanOverviews.get(workspace.accountMid)?.scan
    const unscannedItemCount = Math.max(0, (scan?.totalItemCount ?? 0) - (scan?.scannedItemCount ?? 0))
    if (segments.length < 2 && !unscannedItemCount) return undefined
    const runtime = this.overviewRuntimes.get(workspace.accountMid)
    const completedSegmentIds = new Set(segments
      .filter((segment) => segment.readiness === 'ready' || segment.readiness === 'saved')
      .map((segment) => segment.id))
    const sourceFolders = (this.scanOverviews.get(workspace.accountMid)?.sourceFolders ?? [])
      .filter((folder) => scanSourceIsEligible(folder) && folder.selected !== false)
      .map((folder) => ({
        id: folder.id,
        title: folder.title,
        itemCount: [...completedSegmentIds].reduce((count, segmentId) =>
          count + (runtime?.sourceCountsBySegment.get(segmentId)?.get(folder.id) ?? 0), 0),
        invalidItemCount: folder.invalidItemCount ?? 0
      }))
    const recommendations = this.recommendations.get(workspace.accountMid)
    const recommendationCounts = (recommendations?.candidates ?? []).map((candidate) => ({
      id: candidate.id,
      count: [...completedSegmentIds].reduce((count, segmentId) =>
        count + new Set(candidate.matchedAidsBySegment?.[segmentId] ?? []).size, 0)
    })).filter((candidate) => candidate.count > 0)
    const archiveCounts = new Map<string, Map<string, number>>()
    let processedItemCount = 0
    let classifiedItemCount = 0
    let unmatchedItemCount = 0
    for (const segmentId of completedSegmentIds) {
      const classifications = runtime?.classificationsBySegment.get(segmentId) ??
        new Map<number, OldFavoriteWorkspace['classifications'][string]>()
      const selectedAids = runtime?.selectedAidsBySegment.get(segmentId)
      const descriptorCount = segments.find((segment) => segment.id === segmentId)?.itemCount ?? 0
      const segmentProcessedItemCount = selectedAids?.size ?? runtime?.selectedItemCountsBySegment.get(segmentId) ?? descriptorCount
      let segmentClassifiedItemCount = 0
      for (const classification of classifications.values()) {
        if (selectedAids && !selectedAids.has(classification.aid)) continue
        if (classification.targetLedgerIds.length) segmentClassifiedItemCount += 1
        for (const ledgerId of new Set(classification.targetLedgerIds.slice(0, 3))) {
          const segmentCounts = archiveCounts.get(ledgerId) ?? new Map<string, number>()
          segmentCounts.set(segmentId, (segmentCounts.get(segmentId) ?? 0) + 1)
          archiveCounts.set(ledgerId, segmentCounts)
        }
      }
      processedItemCount += segmentProcessedItemCount
      classifiedItemCount += Math.min(segmentProcessedItemCount, segmentClassifiedItemCount)
      const segmentUnmatchedCount = Math.max(0, segmentProcessedItemCount - segmentClassifiedItemCount)
      unmatchedItemCount += segmentUnmatchedCount
      if (segmentUnmatchedCount) {
        const inboxCounts = archiveCounts.get('inbox') ?? new Map<string, number>()
        inboxCounts.set(segmentId, segmentUnmatchedCount)
        archiveCounts.set('inbox', inboxCounts)
      }
    }
    const waitingItemCount = Math.max(0, segments
      .filter((segment) => segment.readiness === 'waiting')
      .reduce((count, segment) => count + (runtime?.selectedItemCountsBySegment.get(segment.id) ?? segment.itemCount), 0))
    const waitingTagItemCount = segments
      .filter((segment) => segment.readiness === 'tagging')
      .reduce((count, segment) => count + segment.pendingTagItemCount, 0)
    const savedItemCount = segments
      .filter((segment) => segment.readiness === 'saved')
      .reduce((count, segment) => count + segment.itemCount, 0)
    const deepSeekPendingItemCount = this.deepSeekRunCheckpoints.get(workspace.accountMid)?.workspaceId === workspace.id
      ? this.deepSeekRunCheckpoints.get(workspace.accountMid)?.pendingAids?.length ?? 0
      : 0
    const archiveTargets = [...archiveCounts].map(([ledgerId, counts]) => ({
      ledgerId,
      itemCount: [...counts.values()].reduce((sum, count) => sum + count, 0),
      segmentCounts: [...counts].map(([segmentId, count]) => ({ segmentId, count }))
        .sort((left, right) => left.segmentId.localeCompare(right.segmentId))
    })).sort((left, right) => left.ledgerId.localeCompare(right.ledgerId))
    const expectedSegmentCount = scan?.totalItemCount
      ? Math.ceil(scan.totalItemCount / workspace.segmentSize)
      : segments.length
    return {
      completedSegmentCount: completedSegmentIds.size,
      totalSegmentCount: Math.max(segments.length, expectedSegmentCount),
      available: true,
      sourceFolders,
      unavailableItemCount: runtime?.unavailableItemCount ?? 0,
      processedItemCount,
      classifiedItemCount,
      unmatchedItemCount,
      deepSeekPendingItemCount,
      waitingTagItemCount,
      unscannedItemCount,
      savedItemCount,
      waitingItemCount,
      recommendationCounts,
      archiveTargets
    }
  }

  private projectLocalWorkspaceFolders(
    repository: Awaited<ReturnType<FavoriteRepositoryService['getSnapshot']>>
  ): OldFavoriteWorkspaceLocalWorkspaceFolder[] {
    const shardsByLedger = new Map<string, typeof repository.physicalShards>()
    for (const shard of repository.physicalShards) {
      const shards = shardsByLedger.get(shard.logicalLedgerId) ?? []
      shards.push(shard)
      shardsByLedger.set(shard.logicalLedgerId, shards)
    }
    return repository.folders
      .filter((folder) => folder.kind === 'bilimi-logical' || folder.kind === 'local')
      .map((folder) => {
        if (folder.kind === 'bilimi-logical') {
          const shards = shardsByLedger.get(folder.logicalLedgerId ?? '') ?? []
          const relationship = shards.length > 0 && shards.every((shard) =>
            shard.bindingState === 'bound' && Boolean(shard.remoteFolderId))
            ? 'bound' as const
            : 'reconcile-required' as const
          return {
            id: folder.id,
            title: folder.title,
            kind: 'rule' as const,
            relationship,
            itemCount: repository.memberships[folder.id]?.length ?? 0
          }
        }
        return {
          id: folder.id,
          title: folder.title,
          kind: 'draft' as const,
          relationship: 'none' as const,
          itemCount: repository.memberships[folder.id]?.length ?? 0
        }
      })
      .sort((left, right) => left.kind.localeCompare(right.kind) || left.title.localeCompare(right.title) || left.id.localeCompare(right.id))
  }

  private projectInventoryMetrics(
    sourceFolders: ScanOverview['sourceFolders'],
    repository: Awaited<ReturnType<FavoriteRepositoryService['getSnapshot']>>,
    authority: 'complete' | 'incomplete'
  ) {
    const protectedAids = new Set(repository.organizationRecords.map((record) => record.aid))
    const itemsByAid = new Map<number, { aid: number; sourceFolderIds: string[]; protected: boolean; unavailable: boolean }>()
    for (const folder of sourceFolders) {
      for (const aid of repository.memberships[`bilibili:${folder.id}`] ?? []) {
        const existing = itemsByAid.get(aid)
        itemsByAid.set(aid, {
          aid,
          sourceFolderIds: [...new Set([...(existing?.sourceFolderIds ?? []), folder.id])],
          protected: protectedAids.has(aid),
          unavailable: isUnavailableScanItem(repository.videos[String(aid)] ?? {})
        })
      }
    }
    return projectOldFavoriteInventoryMetrics({
      authority,
      sourceFolders: sourceFolders.map((folder) => ({ ...folder, observationComplete: authority === 'complete' })),
      items: [...itemsByAid.values()]
    })
  }

  private async restoreDeepSeekOrganizationProjection(
    accountMid: string,
    workspaceId: string,
    descriptors: SegmentDescriptor[],
    currentSegmentId: string,
    currentItems: CurrentSegmentItem[],
    journalState: ReturnType<typeof replayClassificationJournal>
  ) {
    const segments: DeepSeekOrganizationProjection['segments'] = []
    for (const descriptor of [...descriptors].sort((left, right) => left.index - right.index)) {
      const entries = journalState.entriesBySegment.get(descriptor.id) ?? []
      const cursor = Math.min(journalState.cursorBySegment.get(descriptor.id) ?? entries.length, entries.length)
      const hasAppliedDeepSeekEntry = entries.slice(0, cursor).some((entry) => entry.source === 'deepseek')
      const items = !hasAppliedDeepSeekEntry
        ? []
        : descriptor.id === currentSegmentId
          ? currentItems
          : (await this.options.workspaceStore.loadSegment(accountMid, workspaceId, descriptor.id)).items ?? []
      const details = projectDeepSeekOrganizationDetails(entries, cursor, items)
      segments.push({
        id: descriptor.id,
        index: descriptor.index,
        status: details.length ? 'organized' : 'unorganized',
        details
      })
    }
    this.deepSeekOrganizationProjections.set(accountMid, { workspaceId, projection: { segments } })
  }

  private createSnapshot(workspace: OldFavoriteWorkspace): OldFavoriteWorkspaceSnapshot {
    const currentSegment = workspace.segments.find((segment) => segment.id === this.currentSegment(workspace))
    const currentSegmentItems = this.currentSegmentItems.get(workspace.accountMid) ?? []
    const currentSegmentItemsByAid = new Map(currentSegmentItems.map((item) => [item.aid, item]))
    const tagEnrichment = this.tagEnrichments.get(workspace.accountMid)
    const pendingTagAids = new Set(tagEnrichment?.pendingAids ?? [])
    const acceptedTagSegments = new Set(tagEnrichment?.acceptedSegmentIds ?? [])
    const failedTagAids = new Set(tagEnrichment?.failedAids ?? [])
    const fetchedTagAids = new Set(tagEnrichment?.taggedAids ?? [])
    const confirmedUntaggedTagAids = new Set(tagEnrichment?.confirmedUntaggedAids ?? [])
    const workspaceSegmentsById = new Map(workspace.segments.map((segment) => [segment.id, segment]))
    const overviewRuntime = this.overviewRuntimes.get(workspace.accountMid)
    const acceptedTagAids = new Set<number>()
    for (const segmentId of acceptedTagSegments) {
      const loadedAids = workspaceSegmentsById.get(segmentId)?.aids
      if (loadedAids) {
        for (const aid of loadedAids) acceptedTagAids.add(aid)
        continue
      }
      const segmentAids = overviewRuntime?.segmentAidsBySegment.get(segmentId)
      if (segmentAids?.size) {
        for (const aid of pendingTagAids) if (segmentAids.has(aid)) acceptedTagAids.add(aid)
      } else {
        const range = overviewRuntime?.aidRangeBySegment.get(segmentId)
        if (range?.firstAid === undefined || range.lastAid === undefined) continue
        for (const aid of pendingTagAids) if (aid >= range.firstAid && aid <= range.lastAid) acceptedTagAids.add(aid)
      }
    }
    this.captureCurrentSegmentOverviewClassifications(workspace)
    const segmentProgress =
      (this.segmentDescriptors.get(workspace.accountMid) ?? workspace.segments.map(({ id, index, aids }) => ({ id, index, itemCount: aids.length })))
        .map((segment) => ({
          id: segment.id,
          index: segment.index,
          status: (this.frozenSegments.get(workspace.accountMid)?.has(segment.id) ? 'frozen' : 'previewing') as 'previewing' | 'frozen',
          itemCount: segment.itemCount,
          ...(() => {
            const knownSegmentAids = workspaceSegmentsById.get(segment.id)?.aids
            const range = overviewRuntime?.aidRangeBySegment.get(segment.id)
            const segmentAids = overviewRuntime?.segmentAidsBySegment.get(segment.id)
            const selectedAids = overviewRuntime?.selectedAidsBySegment.get(segment.id)
            const sourceSelectionKnown = (this.scanOverviews.get(workspace.accountMid)?.sourceFolders ?? [])
              .some(scanSourceIsEligible)
            const isSelected = (aid: number) => !sourceSelectionKnown || !selectedAids || selectedAids.has(aid)
            const pendingTagItemCount = acceptedTagSegments.has(segment.id) ? 0 : knownSegmentAids
              ? knownSegmentAids.reduce((count, aid) => count + Number(isSelected(aid) && pendingTagAids.has(aid)), 0)
              : segmentAids?.size
                ? [...pendingTagAids].reduce((count, aid) => count + Number(isSelected(aid) && segmentAids.has(aid)), 0)
                : [...pendingTagAids].reduce((count, aid) => count + Number(isSelected(aid) &&
                  range?.firstAid !== undefined && range.lastAid !== undefined && aid >= range.firstAid && aid <= range.lastAid
                ), 0)
            const saved = this.frozenSegments.get(workspace.accountMid)?.has(segment.id) ?? false
            return {
              saved,
              completedTagItemCount: Math.max(0, segment.itemCount - pendingTagItemCount),
              pendingTagItemCount
            }
          })()
        }))
    const activeTagSegmentId = segmentProgress
      .filter((segment) => !segment.saved && segment.pendingTagItemCount > 0)
      .sort((left, right) => left.index - right.index)[0]?.id
    const projectedSegments: OldFavoriteWorkspaceSnapshot['segments'] = segmentProgress.map(({ saved, ...segment }) => ({
      ...segment,
      readiness: saved
        ? 'saved'
        : segment.pendingTagItemCount === 0
          ? 'ready'
          : segment.id === activeTagSegmentId ? 'tagging' : 'waiting'
    }))
    const overview = this.createOverviewProjection(workspace, projectedSegments)
    const deepSeekRunCheckpoint = this.deepSeekRunCheckpoints.get(workspace.accountMid)
    const cachedDeepSeekOrganization = this.deepSeekOrganizationProjections.get(workspace.accountMid)
    const unresolvedDeepSeekAids = new Set([
      ...(deepSeekRunCheckpoint?.pendingAids ?? []),
      ...(deepSeekRunCheckpoint?.failedAids ?? [])
    ])
    const partialDeepSeekSegmentIds = new Set((deepSeekRunCheckpoint?.requestGroups ?? [])
      .filter((group) => group.status === 'failed' || group.aids.some((aid) => unresolvedDeepSeekAids.has(aid)))
      .map((group) => group.segmentId))
    const cachedDeepSeekSegments = new Map(
      cachedDeepSeekOrganization?.workspaceId === workspace.id
        ? cachedDeepSeekOrganization.projection.segments.map((segment) => [segment.id, segment] as const)
        : []
    )
    const deepSeekOrganizationSegments = projectedSegments.map((segment) => {
      const cached = cachedDeepSeekSegments.get(segment.id)
      const details = segment.id === currentSegment?.id
        ? projectDeepSeekOrganizationDetails(workspace.history, workspace.historyCursor, currentSegmentItems)
        : clone(cached?.details ?? [])
      return {
        id: segment.id,
        index: segment.index,
        status: partialDeepSeekSegmentIds.has(segment.id)
          ? 'partial' as const
          : details.length ? 'organized' as const : 'unorganized' as const,
        details
      }
    })
    const deepSeekOrganization = deepSeekOrganizationSegments.some((segment) =>
      segment.status !== 'unorganized' || segment.details.length)
      ? { segments: deepSeekOrganizationSegments }
      : undefined
    const executionIntent = this.executionIntents.get(workspace.accountMid)
    const historyBaselineCursor = workspace.historyBaselineCursor ?? 0
    const originalTargetLedgerIds = new Map<number, string[]>()
    for (let index = historyBaselineCursor; index < workspace.historyCursor; index += 1) {
      for (const change of workspace.history[index]?.changes ?? []) {
        if (!originalTargetLedgerIds.has(change.aid)) {
          originalTargetLedgerIds.set(change.aid, [...(change.before?.targetLedgerIds ?? [])])
        }
      }
    }
    const originalTargetLedgerIdsByAid = Object.fromEntries([...originalTargetLedgerIds]
      .filter(([aid, targets]) => JSON.stringify(workspace.classifications[String(aid)]?.targetLedgerIds ?? []) !== JSON.stringify(targets))
      .map(([aid, targets]) => [String(aid), targets]))
    return {
      version: 1,
      accountMid: workspace.accountMid,
      workspaceId: workspace.id,
      status: workspace.status,
      mode: workspace.mode,
      scope: clone(workspace.scope),
      segmentSize: workspace.segmentSize,
      hasMultipleSegments: workspace.hasMultipleSegments,
      scan: clone(this.scanOverviews.get(workspace.accountMid)?.scan ?? { phase: workspace.status === 'scanning' ? 'inventory' : 'complete', failureCount: 0, mode: workspace.mode }),
      ...(this.inventoryMetrics.get(workspace.accountMid)
        ? { inventoryMetrics: clone(this.inventoryMetrics.get(workspace.accountMid)!) }
        : {}),
      ...(currentSegment ? {
        currentSegmentMetrics: {
          plannedAidCount: currentSegment.aids.length,
          sourceFolders: (this.scanOverviews.get(workspace.accountMid)?.sourceFolders ?? []).map((folder) => ({
            id: folder.id,
            plannedAidCount: currentSegmentItems.reduce((count, item) =>
              count + Number(item.sourceFolderIds.includes(folder.id)), 0)
          }))
        }
      } : {}),
      ...(tagEnrichment ? {
        tagEnrichment: (() => {
          const enrichment = tagEnrichment
          const createTagScope = (aids: readonly number[], isCurrentSegment = false) => {
            const scopeAids = new Set(aids)
            const pendingItemCount = aids.reduce((count, aid) =>
              count + Number(pendingTagAids.has(aid) && !acceptedTagAids.has(aid)), 0)
            const failedItemCount = aids.reduce((count, aid) => count + Number(failedTagAids.has(aid)), 0)
            const fetchedTagItemCount = aids.reduce((count, aid) => count + Number(fetchedTagAids.has(aid)), 0)
            const confirmedUntaggedItemCount = aids.reduce((count, aid) => count + Number(confirmedUntaggedTagAids.has(aid)), 0)
            const reusedTagItemCount = currentSegment && isCurrentSegment
              ? currentSegmentItems.reduce((count, item) => count + Number(
                Boolean(item.tags?.length) && !fetchedTagAids.has(item.aid)
              ), 0)
              : Math.max(0, aids.length - pendingItemCount - failedItemCount - fetchedTagItemCount - confirmedUntaggedItemCount)
            return {
              totalItemCount: scopeAids.size,
              completedItemCount: Math.max(0, scopeAids.size - pendingItemCount),
              pendingItemCount,
              failedItemCount,
              reusedTagItemCount,
              fetchedTagItemCount,
              confirmedUntaggedItemCount
            }
          }
          const wholeRunItemCount = workspace.hasMultipleSegments
            ? (this.segmentDescriptors.get(workspace.accountMid) ?? []).reduce((count, segment) => count + segment.itemCount, 0)
            : workspace.plannedAids.length
          const knownTagFactAids = new Set([
            ...pendingTagAids,
            ...failedTagAids,
            ...fetchedTagAids,
            ...confirmedUntaggedTagAids
          ])
          const wholeRunScope = createTagScope([...knownTagFactAids])
          const legacyCurrentBatchOnly = Boolean(currentSegment &&
            enrichment.totalItemCount === currentSegment.aids.length &&
            wholeRunItemCount > enrichment.totalItemCount)
          const untrackedWholeRunItemCount = legacyCurrentBatchOnly
            ? Math.max(0, wholeRunItemCount - enrichment.totalItemCount)
            : 0
          wholeRunScope.totalItemCount = wholeRunItemCount
          wholeRunScope.pendingItemCount += untrackedWholeRunItemCount
          wholeRunScope.reusedTagItemCount = Math.min(enrichment.reusedTagItemCount, Math.max(0, wholeRunItemCount
            - wholeRunScope.pendingItemCount
            - wholeRunScope.failedItemCount
            - wholeRunScope.fetchedTagItemCount
            - wholeRunScope.confirmedUntaggedItemCount))
          if (!legacyCurrentBatchOnly) {
            wholeRunScope.reusedTagItemCount = Math.max(0, wholeRunItemCount
              - wholeRunScope.pendingItemCount
              - wholeRunScope.failedItemCount
              - wholeRunScope.fetchedTagItemCount
              - wholeRunScope.confirmedUntaggedItemCount)
          }
          wholeRunScope.completedItemCount = Math.max(0, wholeRunItemCount - wholeRunScope.pendingItemCount)
          return {
            status: enrichment.status,
            totalItemCount: enrichment.totalItemCount,
            completedItemCount: enrichment.completedItemCount,
            pendingItemCount: enrichment.pendingAids.length,
            failedItemCount: enrichment.failedAids.length
            ,reusedTagItemCount: enrichment.reusedTagItemCount
            ,fetchedTagItemCount: enrichment.taggedAids.length
            ,confirmedUntaggedItemCount: enrichment.confirmedUntaggedAids.length
            ,scopes: {
              currentSegment: createTagScope(currentSegment?.aids ?? [], true),
              wholeRun: wholeRunScope
            }
          }
        })()
      } : {}),
      ...(deepSeekRunCheckpoint?.workspaceId === workspace.id ? {
        deepSeekRun: {
          mode: deepSeekRunCheckpoint.mode,
          scope: deepSeekRunCheckpoint.scope,
          status: deepSeekRunCheckpoint.canceled
            ? 'canceled' as const
            : deepSeekRunCheckpoint.failed
              ? 'failed' as const
            : deepSeekRunCheckpoint.segmentWork?.some((segment) =>
              !deepSeekRunCheckpoint.completedSegmentIds.includes(segment.segmentId) &&
              projectedSegments.find((candidate) => candidate.id === segment.segmentId)?.readiness === 'ready')
              ? 'running' as const
            : deepSeekRunCheckpoint.waitingSegmentIds.length
              ? 'waiting' as const
              : 'running' as const,
          completedSegmentCount: deepSeekRunCheckpoint.completedSegmentIds.length,
          waitingSegmentCount: deepSeekRunCheckpoint.waitingSegmentIds.length,
          ...(deepSeekRunCheckpoint.totalVideoCount !== undefined ? { totalVideoCount: deepSeekRunCheckpoint.totalVideoCount } : {}),
          ...(deepSeekRunCheckpoint.successfulAids ? { successfulVideoCount: deepSeekRunCheckpoint.successfulAids.length } : {}),
          ...(deepSeekRunCheckpoint.pendingAids ? { pendingVideoCount: deepSeekRunCheckpoint.pendingAids.length } : {}),
          ...(deepSeekRunCheckpoint.failedAids ? { failedVideoCount: deepSeekRunCheckpoint.failedAids.length } : {})
        }
      } : {}),
      ...(deepSeekOrganization ? { deepSeekOrganization } : {}),
      ...(executionIntent?.workspaceId === workspace.id ? {
        executionIntent: {
          mode: executionIntent.mode,
          ...(executionIntent.includeInbox ? { includeInbox: true } : {}),
          status: executionIntent.status,
          ...(executionIntent.failureCode ? { failureCode: executionIntent.failureCode } : {}),
          ...(executionIntent.failureDetail ? { failureDetail: executionIntent.failureDetail } : {}),
          waitingSegmentCount: projectedSegments.filter((segment) => segment.readiness === 'tagging' || segment.readiness === 'waiting').length,
          waitingForDeepSeek: Boolean(deepSeekRunCheckpoint && !deepSeekRunCheckpoint.canceled && !deepSeekRunCheckpoint.failed)
        }
      } : {}),
      sourceFolders: clone(this.scanOverviews.get(workspace.accountMid)?.sourceFolders ?? []),
      ...(this.scanOverviews.get(workspace.accountMid)?.localWorkspaceFolders
        ? { localWorkspaceFolders: clone(this.scanOverviews.get(workspace.accountMid)!.localWorkspaceFolders!) }
        : {}),
      continuationCount: workspace.continuationAids.length,
      protectedAidCount: workspace.protectedAids.length,
      segments: projectedSegments,
      currentSegment: currentSegment ? {
        id: currentSegment.id,
        aids: [...currentSegment.aids],
        items: clone(currentSegmentItems).filter((item) => currentSegment.aids.includes(item.aid))
      } : null,
      ...(overview ? { overview } : {}),
      classifications: Object.fromEntries(Object.entries(workspace.classifications).map(([aid, classification]) => [aid, {
        aid: classification.aid,
        targetLedgerIds: [...classification.targetLedgerIds],
        source: classification.source
      }])),
      originalTargetLedgerIdsByAid,
      ...(this.staleDeepSeekAids.get(workspace.accountMid)?.length ? { staleDeepSeekAids: [...this.staleDeepSeekAids.get(workspace.accountMid)!] } : {}),
      recommendations: {
        candidates: (this.recommendations.get(workspace.accountMid)?.candidates ?? []).map((candidate) => {
          const currentSegmentCount = currentSegment
            ? new Set(candidate.matchedAidsBySegment?.[currentSegment.id] ?? []).size
            : 0
          const { sourceName: _sourceName, matchedAidsBySegment: _matchedAidsBySegment, ...publicCandidate } = candidate
          return clone({ ...publicCandidate, currentSegmentCount })
        }),
        adoptedCandidateIds: [...(this.recommendations.get(workspace.accountMid)?.adoptedCandidateIds ?? [])]
      },
      planReadiness: (() => {
        const readiness = this.planReadiness.get(workspace.accountMid) ?? { selectedAidCount: 0, classifiedAidCount: 0 }
        return { ...readiness, unclassifiedAidCount: readiness.selectedAidCount - readiness.classifiedAidCount }
      })(),
      history: {
        cursor: workspace.historyCursor,
        length: workspace.history.length,
        ...(workspace.historyBaselineCursor ? { baselineCursor: workspace.historyBaselineCursor } : {}),
        entries: workspace.history.slice(workspace.historyBaselineCursor ?? 0).map((entry, index) => ({
          cursor: (workspace.historyBaselineCursor ?? 0) + index + 1,
          source: entry.source,
          changeCount: entry.changes.length,
          targetLedgerIds: [...new Set(entry.changes.flatMap((change) => change.after?.targetLedgerIds ?? change.before?.targetLedgerIds ?? []))].sort(),
          summary: (() => {
            const firstChange = entry.changes[0]
            const title = firstChange
              ? currentSegmentItemsByAid.get(firstChange.aid)?.title?.trim().slice(0, 160)
              : undefined
            const reasons: Record<OldFavoriteWorkspaceClassificationSource, string> = {
              manual: '人工调整',
              fallback: '沿用原自动分类',
              deepseek: 'DeepSeek 整理',
              'system-high': '高置信度自动分类',
              'system-low': '低置信度自动分类'
            }
            return {
              ...(title ? { title } : {}),
              beforeTargetLedgerIds: [...(firstChange?.before?.targetLedgerIds ?? [])],
              afterTargetLedgerIds: [...(firstChange?.after?.targetLedgerIds ?? [])],
              reason: reasons[entry.source],
              movedCount: entry.changes.length,
              ...(entry.source === 'deepseek' ? {
                details: (entry.deepSeekProcessedItems ?? entry.changes.map((change) => ({
                  aid: change.aid,
                  beforeTargetLedgerIds: [...(change.before?.targetLedgerIds ?? [])],
                  afterTargetLedgerIds: [...(change.after?.targetLedgerIds ?? [])],
                  changed: JSON.stringify(change.before?.targetLedgerIds ?? []) !== JSON.stringify(change.after?.targetLedgerIds ?? [])
                }))).map((detail) => ({
                  aid: detail.aid,
                  ...(detail.title?.trim() || currentSegmentItemsByAid.get(detail.aid)?.title?.trim()
                    ? { title: (detail.title?.trim() || currentSegmentItemsByAid.get(detail.aid)?.title?.trim())!.slice(0, 160) }
                    : {}),
                  beforeTargetLedgerIds: [...detail.beforeTargetLedgerIds],
                  afterTargetLedgerIds: [...detail.afterTargetLedgerIds]
                }))
              } : {})
            }
          })()
        })).reverse()
      },
      ...(workspace.completionMode ? { completionMode: workspace.completionMode } : {})
    }
  }

  private async createSnapshotWithExecutionProgress(workspace: OldFavoriteWorkspace): Promise<OldFavoriteWorkspaceSnapshot> {
    const snapshot = this.createSnapshot(workspace)
    if (!['frozen', 'executing', 'reconciling'].includes(workspace.status) || !this.options.syncService) return snapshot
    try {
      const persisted = await this.options.repository.getSnapshot(workspace.accountMid)
      const plan = persisted.workspace?.frozenSyncPlan
      if (!plan || !['frozen', 'executing', 'reconciling'].includes(persisted.workspace?.status ?? '')) return snapshot
      const syncPaused = persisted.workspace?.workspaceRef.currentStep === 'sync-paused'
      const run = await this.options.syncService.getRun(workspace.accountMid, plan.id)
      if (workspace.status === 'executing' && run.status === 'ready-to-resume') {
        const frozen = { ...workspace, status: 'frozen' as const }
        await this.persistMarker(frozen, plan)
        this.workspaces.set(workspace.accountMid, frozen)
        return this.createSnapshot(frozen)
      }
      if (workspace.status === 'executing' && run.status === 'result-unknown') {
        const reconciling = { ...workspace, status: 'reconciling' as const }
        const marker = await this.createMarker(reconciling, plan)
        marker.workspaceRef.currentStep = 'result-unknown'
        await this.options.repository.commit(workspace.accountMid, {
          id: `old-favorite-workspace:${workspace.id}:${randomUUID()}`,
          accountMid: workspace.accountMid,
          issuedAt: this.now(),
          type: 'set-workspace',
          payload: marker
        })
        this.workspaces.set(workspace.accountMid, reconciling)
        return {
          ...this.createSnapshot(reconciling),
          executionProgress: {
            completedOperationCount: run.completedOperationCount,
            totalOperationCount: run.totalOperationCount,
            ...(syncPaused ? { syncPaused: true } : {}),
            ...(run.lastFailureReason ? { lastFailureReason: run.lastFailureReason } : {}),
            ...(run.retryAvailableAt ? { retryAvailableAt: run.retryAvailableAt } : {})
          }
        }
      }
      return {
        ...snapshot,
        executionProgress: {
          completedOperationCount: run.completedOperationCount,
          totalOperationCount: run.totalOperationCount,
          ...(syncPaused ? { syncPaused: true } : {}),
          ...(run.lastFailureReason ? { lastFailureReason: run.lastFailureReason } : {}),
          ...(run.retryAvailableAt ? { retryAvailableAt: run.retryAvailableAt } : {})
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

  /**
   * Observations are derived from a completed scan outside the repository write
   * queue. Re-read before each bounded commit so a user move always keeps the
   * latest local desired folders while remote facts are repaired.
   */
  private async commitRemoteObservationRepair(
    accountMid: string,
    commandPrefix: string,
    observedPhysicalFolderIdsByAid: ReadonlyMap<number, ReadonlySet<string>>,
    preserveExistingObservations: boolean,
    managedRemoteFolderIds?: ReadonlySet<string>,
    timestamp = this.now(),
    expectedWorkspace?: Pick<OldFavoriteWorkspace, 'id' | 'status'>,
    adoptUniqueObservedPlacementWhenLocalEmpty = false,
    repairPersistedMembershipProjection = false
  ) {
    const aids = [...observedPhysicalFolderIdsByAid.keys()].sort((left, right) => left - right)
    for (let start = 0; start < aids.length; start += 500) {
      let committed = false
      for (let attempt = 0; attempt < 2 && !committed; attempt++) {
        const snapshot = await this.options.repository.getSnapshot(accountMid)
        if (expectedWorkspace && (snapshot.workspace?.id !== expectedWorkspace.id || snapshot.workspace.status !== expectedWorkspace.status)) return
        const logicalIdsByRemoteFolderId = new Map<string, Set<string>>()
        for (const shard of snapshot.physicalShards) {
          if (shard.bindingState !== 'bound' || !shard.remoteFolderId) continue
          const logicalIds = logicalIdsByRemoteFolderId.get(shard.remoteFolderId) ?? new Set<string>()
          logicalIds.add(`bilimi-logical:${shard.logicalLedgerId}`)
          logicalIdsByRemoteFolderId.set(shard.remoteFolderId, logicalIds)
        }
        const placements = aids.slice(start, start + 500).flatMap((aid) => {
        const existing = snapshot.positions[`${accountMid}:${aid}`]
        const observed = observedPhysicalFolderIdsByAid.get(aid) ?? new Set<string>()
        const remoteObservedPhysicalFolderIds = [...new Set([
          ...(preserveExistingObservations ? existing?.remoteObservedPhysicalFolderIds ?? [] : []), ...observed
        ])].sort()
        if (!existing && managedRemoteFolderIds && !remoteObservedPhysicalFolderIds.some((folderId) => managedRemoteFolderIds.has(folderId))) return []
        const bindingConflict = remoteObservedPhysicalFolderIds.some((folderId) =>
          (logicalIdsByRemoteFolderId.get(folderId)?.size ?? 0) > 1)
        const remoteObservedLogicalFolderIds = [...new Set(remoteObservedPhysicalFolderIds.flatMap((folderId) => {
          const logicalIds = logicalIdsByRemoteFolderId.get(folderId)
          return logicalIds?.size === 1 ? [...logicalIds] : []
        }))].sort()
        const matchingLogicalMemberships = remoteObservedLogicalFolderIds.filter((folderId) =>
          (snapshot.memberships[folderId] ?? []).includes(aid))
        // A prior local save can leave the durable logical membership intact
        // while its placement projection is empty. Repair that duplicated
        // projection only when one observed bound folder proves the intent.
        const uniquelyPersistedLocalPlacement = matchingLogicalMemberships.length === 1
          ? matchingLogicalMemberships
          : []
        const localDesiredFolderIds = adoptUniqueObservedPlacementWhenLocalEmpty &&
          !bindingConflict && (existing?.localDesiredFolderIds.length ?? 0) === 0
          ? remoteObservedLogicalFolderIds
          : repairPersistedMembershipProjection && (existing?.localDesiredFolderIds.length ?? 0) === 0 && !bindingConflict && uniquelyPersistedLocalPlacement.length
            ? uniquelyPersistedLocalPlacement
            : existing?.localDesiredFolderIds ?? []
        const unchanged = existing &&
          JSON.stringify(existing.localDesiredFolderIds) === JSON.stringify(localDesiredFolderIds) &&
          JSON.stringify(existing.remoteObservedPhysicalFolderIds) === JSON.stringify(remoteObservedPhysicalFolderIds) &&
          JSON.stringify(existing.remoteObservedLogicalFolderIds) === JSON.stringify(remoteObservedLogicalFolderIds) &&
          (!bindingConflict || (existing.positionState === 'needs-review' && existing.reason === 'binding-conflict'))
        if (unchanged) return []
        return [{
          aid,
          // Take the current snapshot's intent at the commit boundary.
          localDesiredFolderIds,
          remoteObservedPhysicalFolderIds,
          remoteObservedLogicalFolderIds,
          observedAt: timestamp,
          ...(bindingConflict ? { positionState: 'needs-review' as const, reason: 'binding-conflict' } : {}),
          updatedAt: timestamp
        }]
        })
        if (!placements.length) {
          committed = true
          continue
        }
        try {
          await this.options.repository.commit(accountMid, {
            id: `${commandPrefix}:${start / 500 + 1}`,
            accountMid,
            issuedAt: timestamp,
            expectedRevision: snapshot.revision,
            type: 'set-favorite-placements',
            payload: { adjustmentKind: 'manual', placements }
          })
          committed = true
        } catch (error) {
          if (!(error instanceof Error) || error.message !== 'Favorite repository revision mismatch.' || attempt === 1) throw error
        }
      }
    }
  }

  private async commitScanLifecycle(
    accountMid: string,
    commandPrefix: string,
    observationEpoch: string,
    authority: 'complete' | 'incomplete',
    observations: Array<{ aid: number; remoteObserved: boolean; remoteFolderIds?: string[]; ordinarySource?: boolean }>
  ) {
    const unique = [...new Map(observations.map((observation) => [observation.aid, observation])).values()]
      .sort((left, right) => left.aid - right.aid)
    if (!unique.length) return
    const snapshot = await this.options.repository.getSnapshot(accountMid)
    await this.options.repository.commit(accountMid, {
      id: commandPrefix,
      accountMid,
      issuedAt: this.now(),
      expectedRevision: snapshot.revision,
      type: 'reconcile-scan-lifecycle',
      payload: { observationEpoch, authority, observations: unique }
    })
  }

  private queue<T>(operation: () => Promise<T>) {
    const run = this.operationTail.then(operation, operation)
    this.operationTail = run.then(() => undefined, () => undefined)
    return run
  }
}
