import { createHash, randomUUID } from 'node:crypto'
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
  type OldFavoriteWorkspaceScope,
  type OldFavoriteWorkspaceRecoveryDecision,
  type OldFavoriteWorkspaceRecoveryDecisionResult,
  type OldFavoriteWorkspaceRecoverySummary,
  type OldFavoriteWorkspaceRecoveryRequired,
  type OldFavoriteWorkspaceSnapshot
} from '../../src/shared/oldFavoriteWorkspace'
import {
  isFavoriteRepositoryMetadataStale,
  isFavoriteRepositoryScanVisible,
  type FavoriteRepositoryVideo,
  type FavoriteRepositoryWorkspace
} from '../../src/shared/favoriteRepository'
import { BILIMI_LEDGER_PREFIX, createDefaultFavoriteLedgers } from '../../src/shared/favoriteLedgers'
import type { FavoriteLedger } from '../../src/shared/types'
import { compileFrozenFavoriteSyncPlan } from '../../src/shared/favoriteRepositoryExecutionPlan'
import { FavoriteRepositoryService } from './favoriteRepositoryService'
import type { FavoriteRepositorySyncRun, FavoriteRepositorySyncService } from './favoriteRepositorySyncService'
import type { FavoriteRepositoryBindingService } from './favoriteRepositoryBindingService'
import { OldFavoriteWorkspaceStore } from './oldFavoriteWorkspaceStore'
import { analyzeOldFavoriteLedgerRule } from './oldFavoriteLedgerRuleAnalysis'

const JOURNAL_EVENT_PREFIX = 'bilimi-old-favorite-workspace:v1:'

type SegmentDescriptor = { id: string; index: number; itemCount: number }
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
  sourceFolders: Array<{ id: string; title: string; itemCount: number; invalidItemCount?: number; isBilimiWorkFolder: boolean; selected?: boolean }>
  scan: { phase: 'inventory' | 'failed' | 'complete'; failureCount: number; mode: OldFavoriteWorkspace['mode']; reason?: string; totalItemCount?: number; scannedItemCount?: number; taggedItemCount?: number; untaggedItemCount?: number }
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
type AutomaticClassification = { targetLedgerIds: string[]; confidence: 'high' | 'low' }
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
  sourceCountsBySegment: Map<string, Map<string, number>>
  classificationsBySegment: Map<string, Map<number, OldFavoriteWorkspace['classifications'][string]>>
  unavailableItemCount: number
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
  completedItemCount: number
  pendingAids: number[]
  failedAids: number[]
  reusedTagItemCount: number
  taggedAids: number[]
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
  acceptedSegmentIds?: string[]
}): TagEnrichment {
  return {
    ...value,
    failedAids: [...new Set(value.failedAids ?? [])],
    reusedTagItemCount: value.reusedTagItemCount ?? 0,
    taggedAids: [...new Set(value.taggedAids ?? [])],
    acceptedSegmentIds: [...new Set(value.acceptedSegmentIds ?? [])]
  }
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

function tagRecommendation(index: RecommendationIndex, sourceName: string, aids: ReadonlySet<number>): StoredRecommendation {
  return {
    id: stableTagRecommendationId(sourceName),
    displayName: `${BILIMI_LEDGER_PREFIX}${sourceName}`,
    kind: 'tag',
    sourceName,
    keywords: [sourceName],
    count: aids.size,
    matchedAidsBySegment: matchedRecommendationAidsBySegment(index, aids),
    reason: `高频标签“${sourceName}”出现 ${aids.size} 次，适合单独成册。`
  }
}

function recommendationsFromIndex(index: RecommendationIndex, adoptedCandidateIds: string[] = []): RecommendationState {
  const matchedAidsBySegment = (aids: ReadonlySet<number>) => Object.fromEntries(
    [...aids].sort((left, right) => left - right).reduce((segments, aid) => {
      const segmentId = index.segmentIdForAid.get(aid) ?? 'segment-1'
      const segmentAids = segments.get(segmentId) ?? []
      segmentAids.push(aid)
      segments.set(segmentId, segmentAids)
      return segments
    }, new Map<string, number[]>())
  )
  const authors: StoredRecommendation[] = [...index.authorAids.entries()]
    .filter(([, aids]) => aids.size >= 2)
    .sort(([leftName, leftAids], [rightName, rightAids]) => rightAids.size - leftAids.size || leftName.localeCompare(rightName, 'zh-Hans-CN'))
    .slice(0, 24)
    .map(([sourceName, aids]) => ({
      id: stableRecommendationId(sourceName),
      displayName: `${BILIMI_LEDGER_PREFIX}${sourceName}`,
      kind: 'author' as const,
      sourceName,
      keywords: [sourceName],
      count: aids.size,
      matchedAidsBySegment: matchedAidsBySegment(aids),
      reason: `${sourceName} appeared ${aids.size} times.`
    }))
  const tags: StoredRecommendation[] = [...index.tagAids.entries()]
    .filter(([tag, aids]) => aids.size >= 2 && tag.length >= 2 && !GENERIC_RECOMMENDATION_TAGS.has(tag.toLocaleLowerCase()))
    .sort(([leftName, leftAids], [rightName, rightAids]) => rightAids.size - leftAids.size || leftName.localeCompare(rightName, 'zh-Hans-CN'))
    .slice(0, 24)
    .map(([sourceName, aids]) => tagRecommendation(index, sourceName, aids))
  const availableIds = new Set([...authors, ...tags].map((candidate) => candidate.id))
  return {
    candidates: [...authors, ...tags],
    initialized: true,
    adoptedCandidateIds: adoptedCandidateIds.filter((id) => availableIds.has(id))
  }
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

function updateTagRecommendations(
  state: RecommendationState,
  index: RecommendationIndex,
  changedTags: ReadonlySet<string>
): RecommendationState {
  const changedIds = new Set([...changedTags].map(stableTagRecommendationId))
  const tagCandidates = state.candidates.filter((candidate) => candidate.kind === 'tag' && !changedIds.has(candidate.id))
  for (const tag of changedTags) {
    const aids = index.tagAids.get(tag)
    if (!aids || aids.size < 2 || tag.length < 2 || GENERIC_RECOMMENDATION_TAGS.has(tag.toLocaleLowerCase())) continue
    tagCandidates.push(tagRecommendation(index, tag, aids))
  }
  tagCandidates.sort((left, right) => right.count - left.count || left.sourceName.localeCompare(right.sourceName, 'zh-Hans-CN'))
  const candidates = [
    ...state.candidates.filter((candidate) => candidate.kind !== 'tag'),
    ...tagCandidates.slice(0, 24)
  ]
  const availableIds = new Set(candidates.map((candidate) => candidate.id))
  return {
    initialized: true,
    candidates,
    adoptedCandidateIds: state.adoptedCandidateIds.filter((id) => availableIds.has(id))
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

/**
 * A reset loses device-local bindings. Reconstruct only a complete, unique
 * remote work folder; incomplete reads remain pending for confirmation.
 */
function recoverableManagedFolders(sourceFolders: ScanOverview['sourceFolders'], managedMembers: Record<string, number[]>) {
  const defaults = createDefaultFavoriteLedgers()
  const candidates: RecoverableManagedFolder[] = []
  for (const folder of sourceFolders.filter((candidate) => candidate.isBilimiWorkFolder)) {
    const title = folder.title.trim()
    const memberAids = [...new Set(managedMembers[folder.id] ?? [])].sort((left, right) => left - right)
    let recovered = false
    for (const ledger of defaults) {
      const baseTitle = ledger.displayName.trim()
      const suffix = title.startsWith(baseTitle) ? title.slice(baseTitle.length) : ''
      const shardNumber = title === baseTitle ? 1 : /^·(\d+)$/u.test(suffix) ? Number(suffix.slice(1)) : 0
      if (!shardNumber || (shardNumber === 1 && title !== baseTitle)) continue
      candidates.push({
        logicalLedgerId: ledger.id,
        logicalTitle: baseTitle,
        shardNumber,
        remoteFolderId: folder.id,
        remoteTitle: title,
        memberAids,
        bindingState: memberAids.length === folder.itemCount ? 'bound' : 'pending-reconcile',
        ...(memberAids.length === folder.itemCount ? {} : { knownRemoteFolderIds: [folder.id] })
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
        bindingState: memberAids.length === folder.itemCount ? 'bound' : 'pending-reconcile',
        ...(memberAids.length === folder.itemCount ? {} : { knownRemoteFolderIds: [folder.id] })
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
  private readonly recommendationIndexes = new Map<string, RecommendationIndex>()
  private readonly planReadiness = new Map<string, PlanReadiness>()
  private readonly staleDeepSeekAids = new Map<string, number[]>()
  private readonly overviewRuntimes = new Map<string, OverviewRuntime>()
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
    syncService?: Pick<FavoriteRepositorySyncService, 'abandonFrozenPlan' | 'claimFrozenPlan' | 'executeFrozenPlan' | 'bindPageTarget' | 'reconcile' | 'resume' | 'getRun' | 'deleteManagedFolders' | 'previewManagedFolderDeletion'>
    classifyCurrentItem?: (item: CurrentSegmentItem, recommendedLedgers?: RecommendedLedger[]) => AutomaticClassification | Promise<AutomaticClassification>
    classifyCurrentItems?: (
      items: CurrentSegmentItem[],
      recommendedLedgers: RecommendedLedger[],
      accountMid: string,
      options?: {
        onBatchComplete?: (completedItemCount: number, totalItemCount: number) => void
        shouldCancel?: () => boolean
      }
    ) => AutomaticClassification[] | Promise<AutomaticClassification[]>
    saveRecommendedLedgers?: (
      accountMid: string,
      ledgers: FavoriteLedger[],
      adoptedLedgerIds?: string[]
    ) => Promise<boolean | void>
    notifyRecommendedLedgersChanged?: (accountMid: string) => void
    saveRecoveredLedgerDrafts?: (accountMid: string, ledgers: FavoriteLedger[]) => Promise<void>
    prepareForOrganization?: (accountMid: string) => Promise<void>
    refreshSelectedVideoMetadata?: (accountMid: string, aid: number) => Promise<FavoriteRepositoryVideo>
    resolveLedgerTitle?: (accountMid: string, logicalLedgerId: string) => Promise<string | undefined>
    resolveLedgerBinding?: (accountMid: string, logicalLedgerId: string) => Promise<{
      remoteFolderId?: string
      remoteDisplayTitle?: string
    } | undefined>
    resolveRecoveryConfiguration?: (accountMid: string) => RecoveryConfiguration | Promise<RecoveryConfiguration>
    segmentSize?: () => number
    now?: () => string
  }) {}

  async open(accountMid: string): Promise<OldFavoriteWorkspace | OldFavoriteWorkspaceRecoveryRequired | null> {
    return this.queue(() => this.openUnsafe(accountMid))
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
      const candidates = recoverableManagedFolders(overview.sourceFolders, memberAidsByFolderId)
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
        .filter((candidate) => candidate.bindingState === 'bound' && candidate.remoteFolderId && candidate.logicalLedgerId.startsWith('custom-'))
        .map((candidate) => [candidate.logicalLedgerId, candidate])).values()]
        .map((candidate, index): FavoriteLedger => ({
          id: candidate.logicalLedgerId,
          displayName: candidate.logicalTitle.replace(/^bilimi[\u00b7.\s_-]*/i, '').trim() || candidate.logicalTitle,
          keywords: [],
          ruleType: 'keyword',
          enabled: false,
          priority: 20_000 + index,
          bilibiliFolderId: candidate.remoteFolderId,
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
      await this.options.prepareForOrganization?.(accountMid)
      let workspace = await this.openUnsafe(accountMid)
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
      const sourceFolders = input.sourceFolders.map((folder) => ({ ...folder, selected: !folder.isBilimiWorkFolder }))
      const mode = this.scanOverviews.get(workspace.accountMid)?.scan.mode ?? workspace.mode
      const overview: ScanOverview = {
        sourceFolders,
        scan: {
          phase: 'inventory', failureCount: 0, mode,
          totalItemCount: sourceFolders.reduce((count, folder) => count + folder.itemCount, 0),
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
    hasMore?: boolean
    items: Array<{ aid: number; title?: string; author?: string; description?: string; tags?: string[]; category?: string; cover?: string; addedAt?: number; unavailable?: boolean; sourceFolderIds: string[] }>
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
      const defaultLedgerIds = new Set(createDefaultFavoriteLedgers().map((ledger) => ledger.id))
      if (input.ledgerId && !existingCandidate && defaultLedgerIds.has(id)) {
        throw new Error('Old favorite workspace draft ledger rule is unavailable.')
      }
      if (!input.ledgerId && state.candidates.some((candidate) => candidate.id === id)) {
        throw new Error('Old favorite workspace local ledger already exists.')
      }

      const recovered = await this.options.workspaceStore.recover(workspace.accountMid, workspace.id)
      if ('recovery' in recovered) throw new Error('Old favorite workspace requires rebuild.')
      const tagUpdates = new Map(recovered.tagUpdates.map((update) => [update.aid, update.tags]))
      const sourceFolders = this.scanOverviews.get(workspace.accountMid)?.sourceFolders ?? []
      const selectedSourceFolderIds = new Set(sourceFolders
        .filter((folder) => !folder.isBilimiWorkFolder && folder.selected).map((folder) => folder.id))
      const hasSelectableSources = sourceFolders.some((folder) => !folder.isBilimiWorkFolder)
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
      const next: RecommendationState = {
        initialized: true,
        candidates,
        adoptedCandidateIds: [...new Set([...state.adoptedCandidateIds, id])].sort()
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
      if (classificationCandidates.length && !this.options.classifyCurrentItems && !this.options.classifyCurrentItem) {
        throw new Error('Old favorite workspace automatic classification is unavailable.')
      }
      const classifications = classificationCandidates.length === 0
        ? []
        : this.options.classifyCurrentItems
        ? await this.options.classifyCurrentItems(classificationCandidates.map(clone), clone(recommendedLedgers), workspace.accountMid, {
            shouldCancel
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

      const readiness = newEntries.flatMap(({ entry }) => entry.changes).reduce((current, change) => ({
        selectedAidCount: current.selectedAidCount,
        classifiedAidCount: current.classifiedAidCount +
          (change.after?.targetLedgerIds.length ? 1 : 0) - (change.before?.targetLedgerIds.length ? 1 : 0)
      }), clone(recovered.planReadiness))
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
        ? this.autoClassifyAllSegmentsUnsafe(workspace, true)
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
      for (const folder of sourceFolders.filter((candidate) => candidate.isBilimiWorkFolder)) {
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
            ...sourceFolders.filter((folder) => folder.isBilimiWorkFolder).flatMap((folder) =>
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
      for (const candidate of recoverableManagedFolders(sourceFolders, managedMembers)) {
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
        .filter((binding) => binding.bindingState === 'bound' && binding.remoteFolderId && binding.logicalLedgerId.startsWith('custom-'))
        .map((binding, index): FavoriteLedger => ({
          id: binding.logicalLedgerId,
          displayName: binding.logicalTitle.replace(/^bilimi[\u00b7.\s_-]*/i, '').trim() || binding.logicalTitle,
          keywords: [],
          ruleType: 'keyword',
          enabled: false,
          priority: 20_000 + index,
          bilibiliFolderId: binding.remoteFolderId,
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
      for (const folder of sourceFolders.filter((candidate) => candidate.isBilimiWorkFolder)) {
        for (const aid of managedMembers[folder.id] ?? []) recordObservedFolders(aid, [folder.id])
      }
      await this.commitRemoteObservationRepair(workspace.accountMid,
        `old-favorite-workspace:observed:${workspace.id}:${(workspace.baseline?.revision ?? 0) + 1}`,
        observedPhysicalFolderIdsByAid, false, undefined, mirrorUpdatedAt, undefined,
        workspace.mode === 'full', true)
      const formalManagedFolderIds = new Set(sourceFolders
        .filter((folder) => folder.isBilimiWorkFolder && !isStagingBilimiFolder(folder.title))
        .map((folder) => folder.id))
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
        .filter((folder) => folder.isBilimiWorkFolder && !isStagingBilimiFolder(folder.title))
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
      const completed = completeWorkspaceScan(workspace, {
        revision: (workspace.baseline?.revision ?? 0) + 1,
        aids: [...organizableItemsByAid.keys()],
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
      const totalItemCount = discoveredAids.size
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
        acceptedSegmentIds: []
      }
      const overviewRuntime = this.initializeOverviewRuntime(completed, itemsByAid.values(),
        [...itemsByAid.values()].filter((item) => isUnavailableScanItem(item)).length)
      await this.options.workspaceStore.appendOverlay(completed.accountMid, completed.id, {
        currentSegmentId, classifications: [], history: [], recommendations, planReadiness: readiness,
        scanMetadata: { sourceFolders, ...completedScan }, tagEnrichment,
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
      this.scanRuns.delete(completed.accountMid)
      this.scannedAids.delete(completed.accountMid)
      this.scannedTagStates.delete(completed.accountMid)
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
      const restored = await this.restoreFromStore(snapshot.workspace, snapshot.updatedAt, snapshot)
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
      if (this.frozenSegments.get(workspace.accountMid)?.has(currentSegmentId)) {
        throw new Error('Old favorite workspace saved segment is read-only.')
      }
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
      if (this.frozenSegments.get(workspace.accountMid)?.has(currentSegmentId)) {
        throw new Error('Old favorite workspace saved segment is read-only.')
      }
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

  /** Explicitly reclaims a durable scanning lease after restart; it never starts a fresh scan. */
  async resumeScan(accountMid: string): Promise<OldFavoriteWorkspaceSnapshot> {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      if (workspace.status !== 'scanning') throw new Error('Old favorite workspace scan is not resumable.')
      if (!this.scanRuns.get(workspace.accountMid)) throw new Error('Old favorite workspace scan needs an explicit rescan.')
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
      const pages = await this.options.workspaceStore.readScanPages(workspace.accountMid, workspace.id)
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
        ? this.autoClassifyAllSegmentsUnsafe(workspace, true)
        : clone(workspace)
    })
  }

  async previewManagedFolderDeletion(accountMid: string, logicalLedgerIds: string[]) {
    if (!this.options.syncService) throw new Error('Old favorite workspace sync service is unavailable.')
    return this.options.syncService.previewManagedFolderDeletion(accountMid, logicalLedgerIds)
  }

  async deleteManagedFolderCandidates(accountMid: string, logicalLedgerIds: string[]) {
    if (!this.options.syncService) throw new Error('Old favorite workspace sync service is unavailable.')
    return this.options.syncService.deleteManagedFolders(accountMid, logicalLedgerIds)
  }

  private async autoClassifyCurrentSegmentUnsafe(workspace: OldFavoriteWorkspace, replaceSystem: boolean) {
    if (this.frozenSegments.get(workspace.accountMid)?.has(this.currentSegment(workspace))) {
      throw new Error('Old favorite workspace saved segment is read-only.')
    }
    return this.autoClassifySegmentsUnsafe(workspace, [this.currentSegment(workspace)], replaceSystem)
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
    const availableSegmentIds = [...affectedSegmentIds]
      .filter((segmentId) => workspace.segments.some((segment) => segment.id === segmentId))
      .filter((segmentId) => !this.frozenSegments.get(workspace.accountMid)?.has(segmentId))
    if (!availableSegmentIds.length) return clone(workspace)
    return this.autoClassifySegmentsUnsafe(workspace, availableSegmentIds, true, affectedAids, nextState)
  }

  /** Classification is global; the visible segment only limits rendering, never scan coverage. */
  private async autoClassifyAllSegmentsUnsafe(workspace: OldFavoriteWorkspace, replaceSystem: boolean) {
    const frozen = this.frozenSegments.get(workspace.accountMid) ?? new Set<string>()
    return this.autoClassifySegmentsUnsafe(workspace, workspace.segments.map((segment) => segment.id).filter((id) => !frozen.has(id)), replaceSystem)
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
    recommendationState?: RecommendationState
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
    const recovered = await this.options.workspaceStore.recover(workspace.accountMid, workspace.id)
    if ('recovery' in recovered) throw new Error('Old favorite workspace requires rebuild.')
    const tagUpdates = new Map(recovered.tagUpdates.map((update) => [update.aid, update.tags]))
    const selectedSourceFolderIds = new Set((this.scanOverviews.get(workspace.accountMid)?.sourceFolders ?? [])
      .filter((folder) => !folder.isBilimiWorkFolder && folder.selected).map((folder) => folder.id))
    const hasSelectableSources = (this.scanOverviews.get(workspace.accountMid)?.sourceFolders ?? [])
      .some((folder) => !folder.isBilimiWorkFolder)
    let updated = workspace
    const visibleSegmentId = this.currentSegment(workspace)
    const visibleItems = this.currentSegmentItems.get(workspace.accountMid)
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
          .filter((item) => {
            const existing = updated.classifications[String(item.aid)]
            return existing?.source !== 'manual' && existing?.source !== 'deepseek'
          })
        const classifications = classifyMany
          ? await classifyMany(candidates.map(clone), clone(recommendedLedgers), updated.accountMid)
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
    this.workspaces.set(updated.accountMid, updated)
    return clone(updated)
  }

  async undoClassificationChange(accountMid: string): Promise<OldFavoriteWorkspace> {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
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
      if (this.frozenSegments.get(workspace.accountMid)?.has(currentSegmentId)) return clone(workspace)
      const currentSegment = workspace.segments.find((segment) => segment.id === currentSegmentId)
      if (!currentSegment) throw new Error('Old favorite workspace segment is invalid.')
      const currentSegmentAids = new Set(currentSegment.aids)
      const selectedAssignments = (await this.loadSelectedClassificationsForFreeze(workspace))
        .filter((assignment) => currentSegmentAids.has(assignment.aid))
      const recommendations = await this.ensureRecommendations(workspace)
      const recommendationTitles = new Map(recommendations.candidates
        .map((candidate) => [candidate.id, candidate.sourceName] as const))
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
        .filter((folder) => !folder.isBilimiWorkFolder)
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
        if (folderId === 'local:inbox') return [folderId, '暂存'] as const
        const logicalLedgerId = folderId.slice('local:'.length)
        const recommendationTitle = recommendationTitles.get(logicalLedgerId)
        if (recommendationTitle) return [folderId, recommendationTitle] as const
        const existingTitle = existingLocalTitles.get(folderId)
        if (existingTitle) return [folderId, existingTitle] as const
        return [folderId, await this.options.resolveLedgerTitle?.(workspace.accountMid, logicalLedgerId) ??
          defaultTitles.get(logicalLedgerId) ?? logicalLedgerId] as const
      })))
      const multiSegment = descriptors.length > 1
      const frozen = multiSegment ? freezeWorkspaceSegment(workspace, currentSegmentId) : workspace
      const updated: OldFavoriteWorkspace = multiSegment
        ? { ...frozen, status: 'previewing' }
        : {
            ...workspace, status: 'completed', classifications: {}, history: [], historyCursor: 0,
            completionMode: 'local'
          }
      const localCommitId = multiSegment
        ? `old-favorite-workspace:local:${workspace.id}:${currentSegmentId}`
        : `old-favorite-workspace:local:${workspace.id}`
      const marker = multiSegment ? undefined : await this.createMarker(updated, undefined, 'local', localCommitId)
      await this.options.repository.commit(workspace.accountMid, {
        id: localCommitId,
        accountMid: workspace.accountMid,
        issuedAt: this.now(),
        type: 'commit-local-plan',
        payload: {
          workspaceId: workspace.id,
          memberAidsByFolderId,
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
            completedAt: this.now()
          })),
          ...(marker ? { workspace: marker } : {})
        }
      })
      if (multiSegment) {
        await this.appendEvents(updated, currentSegmentId, [{ type: 'freeze', segmentId: currentSegmentId }])
        await this.persistMarker(updated)
      } else {
        await this.options.workspaceStore.markCommitted(workspace.accountMid, workspace.id, localCommitId)
      }
      await this.persistRecommendedLedgersUnsafe(workspace, recommendations)
      const frozenIds = new Set(this.frozenSegments.get(workspace.accountMid) ?? [])
      if (multiSegment) frozenIds.add(currentSegmentId)
      this.remember(updated, currentSegmentId, this.segmentDescriptors.get(workspace.accountMid) ?? [], frozenIds)
      return clone(updated)
    })
  }

  /** Freezes a remote plan from persisted physical shards; it never touches the page bridge. */
  async freezeForBilibiliExecution(accountMid: string): Promise<FavoriteRepositoryWorkspace> {
    await this.stageUnclassifiedSelectedVideos(accountMid)
    for (let attempt = 0; attempt < 3; attempt += 1) {
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
          const nextShardNumber = Math.max(0, ...existing.map((shard) => shard.shardNumber)) + 1
          for (let offset = 0; offset < shardCount; offset += 1) {
            const savedBinding = await this.options.resolveLedgerBinding?.(preparation.accountMid, logicalLedgerId)
            await this.options.bindingService.ensurePhysicalShard(preparation.accountMid, {
              logicalLedgerId,
              logicalTitle,
              remoteDisplayTitle: savedBinding?.remoteDisplayTitle ?? logicalTitle,
              ...(savedBinding?.remoteFolderId ? { preferredRemoteFolderId: savedBinding.remoteFolderId } : {}),
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
        const classifications = await this.loadSelectedClassificationsForFreeze(workspace)
        const currentAssignments = classifications.reduce<Record<string, number[]>>((aidsByLedger, classification) => {
          for (const logicalLedgerId of classification.targetLedgerIds.map((id) => id.trim()).filter((id) => id && id !== 'inbox')) {
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
          classifications: classifications.map((classification) => ({
            aid: classification.aid,
            targetLedgerIds: classification.targetLedgerIds.filter((id) => id !== 'inbox')
          })),
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
        await this.persistRecommendedLedgersUnsafe(workspace, await this.ensureRecommendations(workspace))
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
      const acceptedAids = new Set(workspace.segments
        .filter((segment) => accepted.has(segment.id))
        .flatMap((segment) => segment.aids))
      return enrichment.pendingAids.filter((aid) => !acceptedAids.has(aid))
    })
  }

  async recordTagEnrichment(accountMid: string, aid: number, tags: string[], expectedWorkspaceId?: string) {
    return this.queue(async () => {
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
      this.updateRecommendationsAfterTagEnrichment(workspace, aid, normalizedTags)
      this.tagEnrichments.set(workspace.accountMid, next)
      if (overview && scan) this.scanOverviews.set(workspace.accountMid, { ...overview, scan })
      if (!pendingAids.length) {
        await this.refreshRecommendationsAfterTagEnrichment(workspace)
        if (this.options.classifyCurrentItem || this.options.classifyCurrentItems) {
          await this.checkpointInitialSystemClassificationsUnsafe(await this.autoClassifyAllSegmentsUnsafe(workspace, true))
        }
      } else if (this.completedCurrentSegmentTagEnrichment(workspace, enrichment.pendingAids, pendingAids)) {
        await this.refreshRecommendationsAfterTagEnrichment(workspace)
        if (this.options.classifyCurrentItem || this.options.classifyCurrentItems) {
          await this.checkpointInitialSystemClassificationsUnsafe(await this.autoClassifyCurrentSegmentUnsafe(workspace, true))
        }
      }
      return true
    })
  }

  async recordTagEnrichmentFailure(accountMid: string, aid: number, _reason: string, expectedWorkspaceId?: string) {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      if (expectedWorkspaceId && workspace.id !== expectedWorkspaceId) return false
      const enrichment = this.tagEnrichments.get(workspace.accountMid)
      if (!enrichment || enrichment.status !== 'running' || !enrichment.pendingAids.includes(aid)) return false
      if (workspace.segments.some((segment) => enrichment.acceptedSegmentIds.includes(segment.id) && segment.aids.includes(aid))) return false
      const pendingAids = enrichment.pendingAids.filter((candidate) => candidate !== aid)
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
      if (!pendingAids.length) {
        await this.refreshRecommendationsAfterTagEnrichment(workspace)
        if (this.options.classifyCurrentItem || this.options.classifyCurrentItems) {
          await this.checkpointInitialSystemClassificationsUnsafe(await this.autoClassifyAllSegmentsUnsafe(workspace, true))
        }
      } else if (this.completedCurrentSegmentTagEnrichment(workspace, enrichment.pendingAids, pendingAids)) {
        await this.refreshRecommendationsAfterTagEnrichment(workspace)
        if (this.options.classifyCurrentItem || this.options.classifyCurrentItems) {
          await this.checkpointInitialSystemClassificationsUnsafe(await this.autoClassifyCurrentSegmentUnsafe(workspace, true))
        }
      }
      return true
    })
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
      this.scanRuns.delete(account)
    this.scannedAids.delete(account)
    this.scannedTagStates.delete(account)
    this.tagEnrichments.delete(account)
    this.recommendationIndexes.delete(account)
    this.remember(workspace, '', [], new Set())
    return mode ? { ...workspace, mode } : workspace
  }

  private async restoreFromStore(
    marker: FavoriteRepositoryWorkspace,
    updatedAt: string,
    repositorySnapshot: Awaited<ReturnType<FavoriteRepositoryService['getSnapshot']>>
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
    const unavailableAids = new Set(Object.values(repositorySnapshot.videos)
      .filter((video) => isUnavailableScanItem(video))
      .map((video) => video.aid))
    const restoredSourceFolders = restoredSourceFoldersWithInvalidCounts(
      recovered.sourceFolders, repositorySnapshot, unavailableAids
    )
    if (recovered.recoveryDecision && recovered.recoveryBaseline) {
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
      const scanning = { ...createOldFavoriteWorkspace({ accountMid: marker.accountMid, id: marker.id, now: updatedAt }), mode: recovered.scan.mode }
      this.scanOverviews.set(marker.accountMid, {
        sourceFolders: restoredSourceFolders,
        scan: recovered.scan
      })
      this.recommendations.set(marker.accountMid, clone(recovered.recommendations))
      if (recovered.scanRunId) {
        const pages = await this.options.workspaceStore.readScanPages(marker.accountMid, marker.id)
        const scannedAids = new Set<number>()
        const scannedTagStates = new Map<number, boolean>()
        for (const page of pages) for (const item of page.items) {
          scannedAids.add(item.aid)
          scannedTagStates.set(item.aid, Boolean(scannedTagStates.get(item.aid) || item.tags?.length))
        }
        this.scanRuns.set(marker.accountMid, recovered.scanRunId)
        this.scannedAids.set(marker.accountMid, scannedAids)
        this.scannedTagStates.set(marker.accountMid, scannedTagStates)
      } else {
        this.scanRuns.delete(marker.accountMid)
        this.scannedAids.delete(marker.accountMid)
        this.scannedTagStates.delete(marker.accountMid)
      }
      if (recovered.tagEnrichment) this.tagEnrichments.set(marker.accountMid, normalizeTagEnrichment(recovered.tagEnrichment))
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
    this.restoreOverviewRuntime(marker.accountMid, scan.segments, recovered.currentSegmentId,
      recovered.loadedSegmentItems, overviewClassificationsBySegment, recovered.overview,
      restoredSourceFolders, repositorySnapshot, unavailableAids)
    const allHistory = journalState.entriesBySegment.get(recovered.currentSegmentId) ?? []
    const latestCursor = journalState.cursorBySegment.get(recovered.currentSegmentId) ?? allHistory.length
    const recoveredHistory = allHistory.map((entry) => ({
      ...entry,
      changes: entry.changes.filter((change) => activeAidSet.has(change.aid))
    })).filter((entry) => entry.changes.length > 0)
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
        selected: folder.isBilimiWorkFolder ? false : folder.selected ?? true
      })),
      scan: { phase: 'complete', failureCount: 0, mode: scan.mode }
    })
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
    if (marker.status === 'completed' || marker.status === 'frozen') {
      await this.persistRecommendedLedgersUnsafe(workspace, recommendations)
    }
    const repairedReadiness = unavailableAids.size
      ? this.calculatePlanReadinessFromClassifications(workspace, recovered.classifications, unavailableAids)
      : recovered.planReadiness
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
      this.tagEnrichments.set(marker.accountMid, normalizeTagEnrichment(recovered.tagEnrichment))
      if (recovered.tagUpdates.length) {
        const updates = new Map(recovered.tagUpdates.map((update) => [update.aid, update.tags]))
        this.currentSegmentItems.set(marker.accountMid, recovered.loadedSegmentItems.map((item) =>
          updates.has(item.aid) ? { ...item, tags: updates.get(item.aid) } : item))
      }
    } else this.tagEnrichments.delete(marker.accountMid)
    this.remember(workspace, recovered.currentSegmentId, scan.segments, frozenIds)
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
        const refreshed = await this.autoClassifySegmentsUnsafe(workspace, segmentIds, true, changedAids)
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
    this.scanRuns.delete(accountMid)
    this.scannedAids.delete(accountMid)
    this.scannedTagStates.delete(accountMid)
    this.tagEnrichments.delete(accountMid)
    this.recommendations.delete(accountMid)
    this.recommendationIndexes.delete(accountMid)
    this.planReadiness.delete(accountMid)
    this.staleDeepSeekAids.delete(accountMid)
    this.overviewRuntimes.delete(accountMid)
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
    const plannedAids = new Set(normalizeAids(workspace.plannedAids).filter((aid) => !excludedAids.has(aid)))
    const classifiedAidCount = new Set(Object.values(classifications)
      .filter((classification) => plannedAids.has(classification.aid) && classification.targetLedgerIds.length)
      .map((classification) => classification.aid)).size
    const selectedAidCount = plannedAids.size
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
      .filter((folder) => !folder.isBilimiWorkFolder && folder.selected)
      .map((folder) => folder.id))
    const currentItems = this.currentSegmentItems.get(workspace.accountMid)
    const items = currentItems ?? await this.loadCurrentSegmentItems(workspace)
    const itemsByAid = new Map(items.map((item) => [item.aid, item]))
    return assignments.filter((assignment) =>
      !isUnavailableScanItem(itemsByAid.get(assignment.aid) ?? {}) &&
      itemsByAid.get(assignment.aid)?.sourceFolderIds.some((folderId) => selectedSourceFolderIds.has(folderId)))
  }

  /** Replays per-segment journal deltas only when compiling a one-confirmation remote plan. */
  private async loadSelectedClassificationsForFreeze(workspace: OldFavoriteWorkspace) {
    const overlays = await this.options.workspaceStore.readOverlayHistory(workspace.accountMid, workspace.id)
    const classifications = replayClassificationJournal(overlays).classifications
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
        if (classification && !isUnavailableScanItem(item) &&
          (!hasSelectableSourceFolders || item.sourceFolderIds.some((folderId) => selectedSourceFolderIds.has(folderId)))) {
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
    const rebuilt = recommendationsFromIndex(index, sanitizedState.adoptedCandidateIds)
    if (rebuildIncrementalIndex) this.recommendationIndexes.set(accountMid, index)
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

  private updateRecommendationsAfterTagEnrichment(workspace: OldFavoriteWorkspace, aid: number, tags: readonly string[]) {
    const index = this.recommendationIndexes.get(workspace.accountMid)
    if (!index || index.workspaceId !== workspace.id) {
      throw new Error('Old favorite workspace recommendation index is unavailable.')
    }
    const state = this.recommendations.get(workspace.accountMid) ?? recommendationsFromIndex(index)
    const changedTags = updateRecommendationIndexTags(index, aid, tags)
    this.recommendations.set(workspace.accountMid, updateTagRecommendations(state, index, changedTags))
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
    const sourceCountsBySegment = new Map<string, Map<string, number>>()
    for (const item of items) {
      const segmentId = segmentIdByAid.get(item.aid)
      if (!segmentId || isUnavailableScanItem(item)) continue
      const sourceCounts = sourceCountsBySegment.get(segmentId) ?? new Map<string, number>()
      for (const sourceFolderId of new Set(item.sourceFolderIds)) {
        sourceCounts.set(sourceFolderId, (sourceCounts.get(sourceFolderId) ?? 0) + 1)
      }
      sourceCountsBySegment.set(segmentId, sourceCounts)
    }
    const runtime: OverviewRuntime = {
      aidRangeBySegment,
      sourceCountsBySegment,
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
        ...runtime.aidRangeBySegment.get(id),
        sourceFolderCounts: Object.fromEntries(sourceCounts)
      })),
      unavailableItemCount: runtime.unavailableItemCount
    }
  }

  private restoreOverviewRuntime(
    accountMid: string,
    descriptors: SegmentDescriptor[],
    currentSegmentId: string,
    currentSegmentItems: CurrentSegmentItem[],
    classificationsBySegment: Map<string, Map<number, OldFavoriteWorkspace['classifications'][string]>>,
    persisted: { segments: Array<{ id: string; firstAid?: number; lastAid?: number; sourceFolderCounts: Record<string, number> }>; unavailableItemCount: number } | undefined,
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
    if (!sourceCountsBySegment.has(currentSegmentId)) {
      const counts = new Map<string, number>()
      for (const item of currentSegmentItems) for (const sourceFolderId of new Set(item.sourceFolderIds)) {
        counts.set(sourceFolderId, (counts.get(sourceFolderId) ?? 0) + 1)
      }
      sourceCountsBySegment.set(currentSegmentId, counts)
      const aids = currentSegmentItems.map((item) => item.aid).sort((left, right) => left - right)
      aidRangeBySegment.set(currentSegmentId, aids.length ? { firstAid: aids[0], lastAid: aids[aids.length - 1] } : {})
    }
    for (const descriptor of descriptors) {
      if (!sourceCountsBySegment.has(descriptor.id)) sourceCountsBySegment.set(descriptor.id, new Map())
      if (!aidRangeBySegment.has(descriptor.id)) aidRangeBySegment.set(descriptor.id, {})
    }
    this.overviewRuntimes.set(accountMid, {
      aidRangeBySegment,
      sourceCountsBySegment,
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
    if (segments.length < 2) return undefined
    const runtime = this.overviewRuntimes.get(workspace.accountMid)
    const completedSegmentIds = new Set(segments
      .filter((segment) => segment.readiness === 'ready' || segment.readiness === 'saved')
      .map((segment) => segment.id))
    const sourceFolders = (this.scanOverviews.get(workspace.accountMid)?.sourceFolders ?? [])
      .filter((folder) => !folder.isBilimiWorkFolder && folder.selected !== false)
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
    for (const segmentId of completedSegmentIds) {
      for (const classification of runtime?.classificationsBySegment.get(segmentId)?.values() ?? []) {
        for (const ledgerId of new Set(classification.targetLedgerIds.slice(0, 3))) {
          const segmentCounts = archiveCounts.get(ledgerId) ?? new Map<string, number>()
          segmentCounts.set(segmentId, (segmentCounts.get(segmentId) ?? 0) + 1)
          archiveCounts.set(ledgerId, segmentCounts)
        }
      }
    }
    const archiveTargets = [...archiveCounts].map(([ledgerId, counts]) => ({
      ledgerId,
      itemCount: [...counts.values()].reduce((sum, count) => sum + count, 0),
      segmentCounts: [...counts].map(([segmentId, count]) => ({ segmentId, count }))
        .sort((left, right) => left.segmentId.localeCompare(right.segmentId))
    })).sort((left, right) => left.ledgerId.localeCompare(right.ledgerId))
    return {
      completedSegmentCount: completedSegmentIds.size,
      totalSegmentCount: segments.length,
      available: completedSegmentIds.size > 0,
      sourceFolders,
      unavailableItemCount: runtime?.unavailableItemCount ?? 0,
      recommendationCounts,
      archiveTargets
    }
  }

  private createSnapshot(workspace: OldFavoriteWorkspace): OldFavoriteWorkspaceSnapshot {
    const currentSegment = workspace.segments.find((segment) => segment.id === this.currentSegment(workspace))
    const tagEnrichment = this.tagEnrichments.get(workspace.accountMid)
    const pendingTagAids = new Set(tagEnrichment?.pendingAids ?? [])
    const acceptedTagSegments = new Set(tagEnrichment?.acceptedSegmentIds ?? [])
    const workspaceSegmentsById = new Map(workspace.segments.map((segment) => [segment.id, segment]))
    const overviewRuntime = this.overviewRuntimes.get(workspace.accountMid)
    this.captureCurrentSegmentOverviewClassifications(workspace)
    const projectedSegments: OldFavoriteWorkspaceSnapshot['segments'] =
      (this.segmentDescriptors.get(workspace.accountMid) ?? workspace.segments.map(({ id, index, aids }) => ({ id, index, itemCount: aids.length })))
        .map((segment) => ({
          id: segment.id,
          index: segment.index,
          status: (this.frozenSegments.get(workspace.accountMid)?.has(segment.id) ? 'frozen' : 'previewing') as 'previewing' | 'frozen',
          itemCount: segment.itemCount,
          ...(() => {
            const knownSegmentAids = workspaceSegmentsById.get(segment.id)?.aids
            const range = overviewRuntime?.aidRangeBySegment.get(segment.id)
            const pendingTagItemCount = acceptedTagSegments.has(segment.id) ? 0 : knownSegmentAids
              ? knownSegmentAids.reduce((count, aid) => count + Number(pendingTagAids.has(aid)), 0)
              : [...pendingTagAids].reduce((count, aid) => count + Number(
                range?.firstAid !== undefined && range.lastAid !== undefined && aid >= range.firstAid && aid <= range.lastAid
              ), 0)
            const saved = this.frozenSegments.get(workspace.accountMid)?.has(segment.id) ?? false
            return {
              readiness: saved ? 'saved' as const : pendingTagItemCount > 0 ? 'tagging' as const : 'ready' as const,
              completedTagItemCount: Math.max(0, segment.itemCount - pendingTagItemCount),
              pendingTagItemCount
            }
          })()
        }))
    const overview = this.createOverviewProjection(workspace, projectedSegments)
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
      ...(tagEnrichment ? {
        tagEnrichment: (() => {
          const enrichment = tagEnrichment
          return {
            status: enrichment.status,
            totalItemCount: enrichment.totalItemCount,
            completedItemCount: enrichment.completedItemCount,
            pendingItemCount: enrichment.pendingAids.length,
            failedItemCount: enrichment.failedAids.length
            ,reusedTagItemCount: enrichment.reusedTagItemCount
            ,fetchedTagItemCount: enrichment.taggedAids.length
            ,confirmedUntaggedItemCount: Math.max(0, enrichment.totalItemCount - enrichment.pendingAids.length - enrichment.failedAids.length - enrichment.taggedAids.length)
          }
        })()
      } : {}),
      sourceFolders: clone(this.scanOverviews.get(workspace.accountMid)?.sourceFolders ?? []),
      continuationCount: workspace.continuationAids.length,
      protectedAidCount: workspace.protectedAids.length,
      segments: projectedSegments,
      currentSegment: currentSegment ? {
        id: currentSegment.id,
        aids: [...currentSegment.aids],
        items: clone(this.currentSegmentItems.get(workspace.accountMid) ?? []).filter((item) => currentSegment.aids.includes(item.aid))
      } : null,
      ...(overview ? { overview } : {}),
      classifications: Object.fromEntries(Object.entries(workspace.classifications).map(([aid, classification]) => [aid, {
        aid: classification.aid,
        targetLedgerIds: [...classification.targetLedgerIds],
        source: classification.source
      }])),
      ...(this.staleDeepSeekAids.get(workspace.accountMid)?.length ? { staleDeepSeekAids: [...this.staleDeepSeekAids.get(workspace.accountMid)!] } : {}),
      recommendations: {
        candidates: (this.recommendations.get(workspace.accountMid)?.candidates ?? []).map((candidate) => {
          const currentSegmentCount = currentSegment
            ? new Set(candidate.matchedAidsBySegment?.[currentSegment.id] ?? []).size
            : 0
          const {
            sourceName: _sourceName,
            keywords: _keywords,
            matchedAidsBySegment: _matchedAidsBySegment,
            ...publicCandidate
          } = candidate
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
            payload: { placements }
          })
          committed = true
        } catch (error) {
          if (!(error instanceof Error) || error.message !== 'Favorite repository revision mismatch.' || attempt === 1) throw error
        }
      }
    }
  }

  private queue<T>(operation: () => Promise<T>) {
    const run = this.operationTail.then(operation, operation)
    this.operationTail = run.then(() => undefined, () => undefined)
    return run
  }
}
