import {
  BILIBILI_FAVORITE_LEDGER_NAME_MAX_LENGTH,
  BILIMI_LEDGER_PREFIX,
  createDefaultFavoriteLedgers,
  createRecommendedFavoriteLedgerName,
  createRecommendedFavoriteLedgerNames,
  favoriteLedgerNameValidation,
  isBilimiManagedLedgerName,
  stripBilimiLedgerPrefix
} from '@shared/favoriteLedgers'
import { DEEPSEEK_CONSTRAINT_MARKER } from '@shared/favoriteLedgerConstraints'
import {
  acquireAidOwnership,
  createOldFavoriteBatch,
  endOldFavoriteBatch,
  OLD_FAVORITE_SESSIONS_VERSION,
  type OldFavoriteSessionsState
} from '@shared/oldFavoriteSessions'
import type {
  AssistantAutomationResult,
  DeepSeekArchiveMode,
  DeepSeekArchiveVideoResult,
  DeepSeekGenerateRequest,
  DeepSeekGenerateResult,
  FavoriteKeywordSuggestion,
  FavoriteArchiveMultiMode,
  FavoriteArchiveProtectionRecord,
  FavoriteCorrectionRecord,
  FavoriteLedger,
  FavoriteLedgerRuleType,
  FavoriteLedgerSaveOptions
} from '@shared/types'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type DragEvent,
  type MouseEvent,
  type SetStateAction
} from 'react'
import type { FavoriteLedgerCandidate } from '../favorites/favoriteLedgerInsights'
import { groupFavoritePhysicalShards } from '../favorites/favoritePhysicalShards'
import { OldFavoriteSessionOrchestrator } from '../favorites/oldFavoriteSessionOrchestrator'
import { OldFavoriteTaskCoordinator } from '../favorites/oldFavoriteTaskCoordinator'
import { OldFavoriteOverlayQueue } from '../favorites/oldFavoriteOverlayQueue'
import {
  buildIncrementalBatchAids,
  buildContinuousExecutionPlan,
  buildManagedSelectionProtection,
  buildSegmentProgress,
  evaluateBatchExecutionReadiness,
  type CollectionSnapshotItem
} from '../favorites/oldFavoriteBatchUiModel'
import {
  applyBatchRecommendation,
  aggregateBatchRecommendations,
  type BatchRecommendationAdoptionState,
  type SegmentRecommendation
} from '../favorites/oldFavoriteRecommendations'
import {
  createFavoriteLedgerPreview,
  type FavoriteSourceFolder,
  type FavoriteLedgerPreview,
  type FavoriteLedgerPreviewItem,
  type FavoriteLedgerPreviewTarget
} from '../favorites/favoriteLedgerPreview'
import {
  applyArchiveCandidateTransaction,
  applyArchivePlanSelection,
  buildExecutableArchivePlan,
  createArchivePlanState,
  moveArchivePlanItemToUnclassified,
  revertArchivePlanItem,
  type FavoriteArchivePlanItemState,
  type FavoriteArchivePlanState,
  type FavoriteArchiveTransactionState
} from '../favorites/favoriteArchivePlanState'
import {
  applyDeepSeekArchiveResults,
  buildDeepSeekArchiveRequest,
  createDeepSeekArchiveSnapshot,
  revertDeepSeekArchiveRun,
  type DeepSeekArchiveNonApplicationCounts,
  type DeepSeekArchiveRunSnapshot
} from '../favorites/deepseekArchiveOrganizer'
import {
  createCorrectionDraft,
  isArchiveAdjustmentRecordableSource
} from '../recommendation/correctionLearning'
import { classifyVideoContent } from '../recommendation/videoClassifier'
import { AssistantActionButton } from './AssistantActionButton'
import { OldFavoriteModal } from './OldFavoriteModal'
import { classifyOldFavoriteRecoveryState } from './oldFavoriteRecoveryState'
import { VirtualOldFavoriteTrack } from '../favorites/VirtualOldFavoriteTrack'
import {
  bindOldFavoriteRuntimeAccount,
  getOldFavoriteRuntimeValue,
  hasOldFavoriteRuntimeHandler,
  invokeOldFavoriteRuntimeHandler,
  registerOldFavoriteRuntimeHandler,
  resetOldFavoriteRuntimeSession,
  setOldFavoriteRuntimeValue,
  setOldFavoriteTransientRuntimeValue,
  subscribeOldFavoriteRuntimeKey
} from './oldFavoriteRuntimeSession'
import { useOldFavoriteWorkspace } from './useOldFavoriteWorkspace'
import clickedPetUrl from '../../assets/pet/blue-white-maid/character/big-head/clicked.png'
import hintPetUrl from '../../assets/pet/blue-white-maid/character/big-head/hint.png'

export { resetOldFavoriteRuntimeSession } from './oldFavoriteRuntimeSession'

type OldFavoriteStatusTone = 'idle' | 'ok' | 'warn' | 'error' | 'running'

export type OldFavoriteStatusSnapshot = {
  label: string
  message: string
  tone: OldFavoriteStatusTone
}

type DeepSeekArchiveResultSummary = {
  successCount: number
  failedCount: number
  nonApplicationCounts: DeepSeekArchiveNonApplicationCounts
  batchFailures?: DeepSeekArchiveBatchFailure[]
}

type DeepSeekArchiveBatchFailureKind = 'network-error' | 'api-error' | 'invalid-output' | 'invalid-result'

type DeepSeekArchiveBatchFailure = {
  batchIndex: number
  affectedVideoCount: number
  failureKind: DeepSeekArchiveBatchFailureKind
  errorMessage: string
  videoKeys: string[]
}

type ArchiveMultiModeChange = {
  from: FavoriteArchiveMultiMode
  to: FavoriteArchiveMultiMode
}

type OldFavoriteExecutionPhase =
  | 'idle'
  | 'preparing'
  | 'running'
  | 'pausing'
  | 'paused'
  | 'risk-stopped'
  | 'awaiting-acknowledgement'

export function oldFavoriteExecutionAllowsPlanUpdates(phase: OldFavoriteExecutionPhase) {
  return phase === 'idle'
}

type FavoriteLedgerPanelProps = {
  currentAccountMid?: string
  ledgers: FavoriteLedger[]
  missingLedgerIds: string[]
  onEnsureLedgers: () => Promise<AssistantAutomationResult>
  onSaveLedgers: (
    ledgers: FavoriteLedger[],
    options?: FavoriteLedgerSaveOptions
  ) => Promise<AssistantAutomationResult> | void
  onOpenFavoritePage?: () => Promise<AssistantAutomationResult> | void
  onScanOldFavorites: (options?: {
    multiArchiveMode?: FavoriteArchiveMultiMode
  }) => Promise<FavoriteLedgerPreview>
  onReadCurrentOldFavoriteAccount?: () => Promise<string>
  onReadOldFavoriteBatchStatus?: () => Promise<{ pending: boolean }>
  onPrepareOldFavoriteScan?: () => Promise<AssistantAutomationResult>
  onReadOldFavoriteTagEnrichment?: (action?: 'read' | 'progress' | 'pause' | 'resume' | 'cancel' | 'cancel-scan') => Promise<{
    accountMid?: string
    sourceFolders: FavoriteSourceFolder[]
    discoveredAids?: number[]
    readySegments?: Array<{
      index: number
      status: 'ready'
      aids: number[]
      sourceFolders: FavoriteSourceFolder[]
    }>
    sourceUpdates?: Array<{
      aid: number
      segmentIndex: number
      folderId: string
      folderTitle: string
      relationKey: string
    }>
    scanProgress: NonNullable<FavoriteLedgerPreview['scanProgress']>
  }>
  onExecuteOldFavoritePlan: (
    items: FavoriteLedgerPreviewItem[],
    expectedAccountMid?: string
  ) => Promise<AssistantAutomationResult>
  onOldFavoriteExecutionStateChange?: (state: 'running' | 'finished') => void
  onOldFavoriteStatusUpdate?: (status: OldFavoriteStatusSnapshot) => void
  onOldFavoriteStageFeedback?: (message: string) => void
  onOldFavoriteAcknowledged?: () => void
  onOpenOldFavoriteVideo?: (url: string) => void
  onRejudgeOldFavorite?: (item: FavoriteLedgerPreviewItem) => Promise<FavoriteLedgerPreviewItem>
  deepSeekArchiveAvailable?: boolean
  onOrganizeOldFavoritesWithDeepSeek?: (
    mode: DeepSeekArchiveMode,
    request: DeepSeekGenerateRequest
  ) => Promise<DeepSeekGenerateResult | null | undefined>
  onDeepSeekArchiveKeywordSuggestions?: (suggestions: FavoriteKeywordSuggestion[]) => void
  onOpenDeepSeekSuggestions?: () => void
  onConfirmArchiveCorrections?: (records: FavoriteCorrectionRecord[]) => void
  onConfirmArchiveProtections?: (records: FavoriteArchiveProtectionRecord[]) => void
  favoriteArchiveMultiMode?: FavoriteArchiveMultiMode
  organizeOldFavoritesRequestSignal?: number
}

type OldFavoriteExecutionResult = AssistantAutomationResult & {
  paused?: boolean
  partial?: boolean
  resultUnknown?: boolean
  completedItems?: Array<
    FavoriteLedgerPreviewItem & {
      finalFolderIds?: string[]
      addedFolderIds?: string[]
      removedFolderIds?: string[]
    }
  >
}

type OldFavoriteExecutionRun = {
  selectedItems: FavoriteLedgerPreviewItem[]
  nextGroupIndex: number
  results: OldFavoriteExecutionResult[]
  successfulTargetKeys: string[]
  persistedTargetKeys: string[]
  confirmedAt: string
}

type OldFavoriteExecutionOutcome = 'completed' | 'paused' | 'failed'

type OldFavoriteUserBatchSummary = {
  id: string
  kind: 'full' | 'incremental'
  createdAt: string
  accountMid: string
  segmentIndex: number
  segmentCount: number
  segmentAids: number[][]
  status: 'active' | 'ended'
  snapshot?: {
    preview: FavoriteLedgerPreview | null
    baseScanPreview: FavoriteLedgerPreview | null
    archiveEditorState: ArchiveEditorRuntimeState
    step: OldFavoriteGuideStep
    executionPhase: OldFavoriteExecutionPhase
    executionRun: OldFavoriteExecutionRun | null
    executionProgress: { completed: number; total: number } | null
    collectionSnapshot?: CollectionSnapshotItem[]
    recommendations?: {
      entries: SegmentRecommendation[]
      scannedSegmentIndexes: number[]
      adoptedStableKeys?: string[]
      adoptionState?: BatchRecommendationAdoptionState
    }
    segmentExecution?: Array<{
      index: number
      status: 'pending' | 'ready' | 'running' | 'completed' | 'blocked'
      executableCount: number
      completedCount: number
    }>
    segmentSnapshots?: Record<number, {
      preview: FavoriteLedgerPreview
      baseScanPreview: FavoriteLedgerPreview
      archiveEditorState: ArchiveEditorRuntimeState
      finalReconciled?: boolean
    }>
    recoveryFailure?: 'empty-workspace' | 'corrupt-base' | 'corrupt-tags' | 'workspace-unreadable'
  }
}

type OldFavoriteBatchSelectionResult =
  | { kind: 'restored'; itemCount: number }
  | { kind: 'rescan-required' }
  | { kind: 'failed' }
  | { kind: 'failure-history' }

function mergeBatchPreviewSnapshot(
  current: OldFavoriteUserBatchSummary['snapshot'],
  incoming: OldFavoriteUserBatchSummary['snapshot']
) {
  if (!current) return incoming
  if (!incoming) return current
  return {
    ...incoming,
    ...current,
    recommendations: current.recommendations ?? incoming.recommendations,
    segmentExecution: current.segmentExecution ?? incoming.segmentExecution,
    segmentSnapshots: { ...incoming.segmentSnapshots, ...current.segmentSnapshots }
  }
}

type ArchivePreviewLatestChange = {
  kind: 'single' | 'batch'
  title: string
  reason: string
  movedCount: number
  itemChanges: Record<
    string,
    {
      aid: number
      title: string
      previousTargetText: string
      nextTargetText: string
      currentTargetLedgerIds: string[]
      selectedTargetLedgerIds: string[]
      source: FavoriteArchivePlanItemState['lastChangeSource']
    }
  >
  focusItemKey?: string
}

type ArchivePreviewManualMoveFocus = {
  sourceLedgerId: string
  targetLedgerId: string
  resetLedgerIds?: string[]
  scrollIntoView?: boolean
}

type ArchivePreviewFullHistorySnapshot = {
  kind?: 'full'
  archivePlanState: DeepSeekArchiveRunSnapshot
  selectedCandidateKeys: string[]
  draftLedgers: FavoriteLedger[]
  candidateSourceLedgerIdsByItemKey: FavoriteArchiveTransactionState['candidateSourceLedgerIdsByItemKey']
}

export type ArchivePreviewItemHistorySnapshot = {
  kind: 'item'
  itemKey: string
  archivePlanItem: FavoriteArchivePlanItemState
}

type ArchivePreviewHistorySnapshot =
  | ArchivePreviewFullHistorySnapshot
  | ArchivePreviewItemHistorySnapshot

type ArchiveEditorRuntimeState = Omit<FavoriteArchiveTransactionState, 'archivePlanState'> & {
  archivePlanState: FavoriteArchivePlanState | null
}

function cloneArchivePlanItem(item: FavoriteArchivePlanItemState): FavoriteArchivePlanItemState {
  return {
    ...item,
    originalSuggestedLedgerIds: [...item.originalSuggestedLedgerIds],
    currentTargetLedgerIds: [...item.currentTargetLedgerIds],
    selectedTargetLedgerIds: [...item.selectedTargetLedgerIds]
  }
}

export function updateSingleArchivePlanItem(
  state: FavoriteArchivePlanState,
  itemIndex: number,
  update: (item: FavoriteArchivePlanItemState) => string[]
) {
  const previousItem = state.items[itemIndex]
  if (!previousItem) return null
  const selectedTargetLedgerIds = uniqueLedgerIds(update(previousItem))
  if (
    sameLedgerIds(previousItem.selectedTargetLedgerIds, selectedTargetLedgerIds) &&
    previousItem.userModified &&
    previousItem.lastChangeSource === 'user'
  ) {
    return null
  }
  const nextItem: FavoriteArchivePlanItemState = {
    ...cloneArchivePlanItem(previousItem),
    selectedTargetLedgerIds,
    userModified: true,
    lastChangeSource: 'user'
  }
  const items = state.items.slice()
  items[itemIndex] = nextItem
  return {
    state: { ...state, items },
    previousItem: cloneArchivePlanItem(previousItem),
    nextItem
  }
}

export function createArchivePreviewItemHistorySnapshot(
  item: FavoriteArchivePlanItemState
): ArchivePreviewItemHistorySnapshot {
  return {
    kind: 'item',
    itemKey: item.itemKey,
    archivePlanItem: cloneArchivePlanItem(item)
  }
}

export function applyArchivePreviewHistorySnapshotToPlan(
  state: FavoriteArchivePlanState,
  snapshot: ArchivePreviewHistorySnapshot,
  knownItemIndex?: number
): FavoriteArchivePlanState {
  if (snapshot.kind !== 'item') {
    return revertDeepSeekArchiveRun(state, snapshot.archivePlanState)
  }
  const itemIndex = knownItemIndex ?? state.items.findIndex((item) => item.itemKey === snapshot.itemKey)
  if (itemIndex < 0 || state.items[itemIndex]?.itemKey !== snapshot.itemKey) return state
  const items = state.items.slice()
  items[itemIndex] = cloneArchivePlanItem(snapshot.archivePlanItem)
  return { ...state, items }
}

export function buildOldFavoriteSegmentExecution(
  segmentAids: number[][],
  items: Array<Pick<FavoriteLedgerPreviewItem, 'aid'>>
) {
  const segmentIndexByAid = new Map<number, number>()
  segmentAids.forEach((aids, index) => {
    for (const aid of aids) segmentIndexByAid.set(aid, index)
  })
  const executableCounts = Array.from({ length: segmentAids.length }, () => 0)
  for (const item of items) {
    const segmentIndex = segmentIndexByAid.get(item.aid)
    if (segmentIndex !== undefined) executableCounts[segmentIndex] += 1
  }
  return segmentAids.map((_, index) => ({
    index,
    status: 'ready' as const,
    executableCount: executableCounts[index],
    completedCount: 0
  }))
}

function mergePersistedOldFavoriteSources(
  sources: Array<{ aid?: number; sourceFolderIds?: string[]; sourceFolderTitles?: string[] }>
) {
  const merged = new Map<number, { sourceFolderIds: string[]; sourceFolderTitles: string[] }>()
  for (const source of sources) {
    if (!Number.isSafeInteger(source.aid)) continue
    const current = merged.get(source.aid!) ?? { sourceFolderIds: [], sourceFolderTitles: [] }
    for (let index = 0; index < (source.sourceFolderIds?.length ?? 0); index += 1) {
      const id = source.sourceFolderIds![index]
      const existingIndex = current.sourceFolderIds.indexOf(id)
      if (existingIndex >= 0) {
        if (!current.sourceFolderTitles[existingIndex] && source.sourceFolderTitles?.[index]) {
          current.sourceFolderTitles[existingIndex] = source.sourceFolderTitles[index]
        }
        continue
      }
      current.sourceFolderIds.push(id)
      current.sourceFolderTitles.push(source.sourceFolderTitles?.[index] ?? '')
    }
    merged.set(source.aid!, current)
  }
  return merged
}

function useOldFavoriteRuntimeState<T>(
  key: string,
  initialValue: T | (() => T)
): [T, Dispatch<SetStateAction<T>>] {
  getOldFavoriteRuntimeValue(key, initialValue)

  const value = useSyncExternalStore(
    useCallback((listener: () => void) => subscribeOldFavoriteRuntimeKey(key, listener), [key]),
    useCallback(() => getOldFavoriteRuntimeValue(key, initialValue), [initialValue, key]),
    useCallback(() => getOldFavoriteRuntimeValue(key, initialValue), [initialValue, key])
  )
  const setValue = useCallback<Dispatch<SetStateAction<T>>>(
    (nextValue) => {
      setOldFavoriteRuntimeValue(key, nextValue)
    },
    [key]
  )

  return [value, setValue]
}

type OldFavoriteBatchWriteGateContext = {
  batchId: string
  segmentId: string
  accountMid: string
}

export async function guardOldFavoriteBatchWrite<T>(
  coordinator: Pick<OldFavoriteSessionOrchestrator, 'canRun'>,
  context: OldFavoriteBatchWriteGateContext,
  write: () => Promise<T> | T
): Promise<T> {
  const decision = await coordinator.canRun(
    context.batchId,
    context.segmentId,
    context.accountMid.trim()
  )
  if (!decision.allowed) {
    if (decision.reason === 'batch-ended') {
      throw new Error('旧藏整理批次已结束，不能继续写入。')
    }
    throw new Error(`旧藏整理批次当前不可写入：${decision.reason}`)
  }
  return await write()
}

const OLD_FAVORITE_APPEND_DELAY_MS = { min: 1200, max: 3000 }
const OLD_FAVORITE_COOLDOWN_DELAY_MS = { min: 15000, max: 45000 }
const OLD_FAVORITE_COOLDOWN_EVERY = 25
const OLD_FAVORITE_ACCELERATED_AFTER = 50
const OLD_FAVORITE_ACCELERATED_APPEND_DELAY_MS = { min: 600, max: 1400 }
const OLD_FAVORITE_ACCELERATED_COOLDOWN_DELAY_MS = { min: 10000, max: 20000 }
const OLD_FAVORITE_ACCELERATED_COOLDOWN_EVERY = 60
const OLD_FAVORITE_RESUME_COOLDOWN_DELAY_MS = { min: 15000, max: 30000 }
const OLD_FAVORITE_PREVIEW_INITIAL_LIMIT = 100
const OLD_FAVORITE_ARCHIVE_HEALTH_HINT =
  '原归档是上次整理时记录的视频所在收藏夹。状态变化表示视频已不完全在原位置中；为避免覆盖你的手动调整，本轮先跳过，点击后重新纳入整理。'

function splitKeywords(value: string) {
  return value
    .split(/[\s,，、/]+/)
    .map((keyword) => keyword.trim())
    .filter(Boolean)
}

function splitLedgerRuleText(value: string, ruleType: FavoriteLedgerRuleType) {
  if (ruleType === 'deepseek') {
    return value.trim() ? [value.trim()] : []
  }

  return splitKeywords(value)
}

function normalizeDeepSeekConstraintLine(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function splitLedgerKeywordSections(ledger: FavoriteLedger) {
  const markerIndex = ledger.keywords.findIndex((keyword) => keyword === DEEPSEEK_CONSTRAINT_MARKER)
  if (markerIndex < 0) {
    return {
      localKeywords: ledger.keywords,
      deepSeekConstraint: ''
    }
  }

  return {
    localKeywords: ledger.keywords.slice(0, markerIndex),
    deepSeekConstraint: normalizeDeepSeekConstraintLine(ledger.keywords.slice(markerIndex + 1).join(' '))
  }
}

function composeLedgerKeywords(
  ruleText: string,
  deepSeekConstraint: string,
  ruleType: FavoriteLedgerRuleType
) {
  const localKeywords = splitLedgerRuleText(ruleText, ruleType)
  const constraint = normalizeDeepSeekConstraintLine(deepSeekConstraint)
  return constraint && ruleType !== 'deepseek'
    ? [...localKeywords, DEEPSEEK_CONSTRAINT_MARKER, constraint]
    : localKeywords
}

function ledgerRuleText(ledger: FavoriteLedger) {
  if ((ledger.ruleType ?? 'keyword') === 'deepseek') {
    return ledger.keywords.join('\n')
  }

  return splitLedgerKeywordSections(ledger).localKeywords.join('、')
}

function ledgerDeepSeekConstraintText(ledger: FavoriteLedger) {
  if ((ledger.ruleType ?? 'keyword') === 'deepseek') {
    return ''
  }

  return splitLedgerKeywordSections(ledger).deepSeekConstraint
}

function customLedgerId(name: string) {
  const base = name.replace(/\W+/g, '-').replace(/^-|-$/g, '') || 'ledger'
  return `custom-${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function canDeleteLedger(ledger: FavoriteLedger) {
  return !ledger.isDefault && isBilimiManagedLedgerName(ledger.displayName)
}

const LEDGER_RULE_TYPE_OPTIONS: Array<{ value: FavoriteLedgerRuleType; label: string }> = [
  { value: 'keyword', label: '关键词收藏夹' },
  { value: 'author', label: '专属 UP 追更收藏夹' },
  { value: 'tag', label: '标签收藏夹' },
  { value: 'deepseek', label: 'DeepSeek约束收藏夹' }
]

type DeepSeekSegmentScope = 'current-segment' | 'all-ready-segments'

const DEEPSEEK_ARCHIVE_PROCESSING_OPTIONS: Array<{ value: DeepSeekArchiveMode; label: string }> = [
  { value: 'low-confidence-and-unclassified', label: '整理不确定和【未分类】（推荐）' },
  { value: 'unclassified-only', label: '只整理【未匹配到合适分类】' },
  { value: 'all', label: 'DeepSeek重新检查全部' }
]

const DEEPSEEK_ARCHIVE_SEGMENT_OPTIONS: Array<{ value: DeepSeekSegmentScope; label: string }> = [
  { value: 'current-segment', label: '当前分段' },
  { value: 'all-ready-segments', label: '全部已就绪分段' }
]

function deepSeekArchiveProcessingLabel(mode: DeepSeekArchiveMode) {
  return DEEPSEEK_ARCHIVE_PROCESSING_OPTIONS.find((option) => option.value === mode)?.label ??
    DEEPSEEK_ARCHIVE_PROCESSING_OPTIONS[0].label
}

function deepSeekArchiveStateForScope(
  state: FavoriteArchivePlanState,
  mode: DeepSeekArchiveMode,
  segmentScope: DeepSeekSegmentScope,
  currentSegmentAids: Set<number> | null
): FavoriteArchivePlanState {
  const items = state.items.filter((item) => {
    if (item.userModified || item.lastChangeSource === 'user' || item.lastChangeSource === 'transfer') {
      return false
    }
    if (segmentScope === 'current-segment' && currentSegmentAids && !currentSegmentAids.has(item.aid)) return false
    if (mode === 'all') return true
    if (mode === 'unclassified-only') return item.currentTargetLedgerIds.length === 0
    return item.lowConfidence || item.currentTargetLedgerIds.length === 0
  })
  return { ...state, items }
}

function ledgerRuleType(ledger: Pick<FavoriteLedger, 'ruleType'>): FavoriteLedgerRuleType {
  return ledger.ruleType ?? 'keyword'
}

function ledgerEditorSnapshot(ledger: FavoriteLedger) {
  return {
    displayName: ledger.displayName,
    keywords: ledger.keywords,
    ruleType: ledgerRuleType(ledger)
  }
}

function candidateRuleType(candidate: FavoriteLedgerCandidate): FavoriteLedgerRuleType {
  if (candidate.ruleType) {
    return candidate.ruleType
  }
  if (candidate.kind === 'author') {
    return 'author'
  }
  if (candidate.kind === 'tag-cluster') {
    return 'tag'
  }
  return 'keyword'
}

function ruleFieldLabel(ruleType: FavoriteLedgerRuleType) {
  if (ruleType === 'author') {
    return 'UP 名字'
  }
  if (ruleType === 'tag') {
    return '标签'
  }
  if (ruleType === 'deepseek') {
    return 'DeepSeek约束'
  }
  return '关键词'
}

function rulePrimaryHint(ruleType: FavoriteLedgerRuleType) {
  if (ruleType === 'author') {
    return '填写一个或多个 UP 名，命中作者时会优先存入这个收藏夹。'
  }
  if (ruleType === 'tag') {
    return '填写一个或多个 B 站标签，命中标签时会优先存入这个收藏夹。'
  }
  if (ruleType === 'deepseek') {
    return '填写自然语言判断规则。此类型不参与本地自动分类，必须开启 DeepSeek 后才会用于辅助判断。'
  }
  return '建议优先填写 B 站标签里的词；标签命中权重最高，标题、分区、简介等信息会辅助判断。'
}

function ruleSecondaryHint(ruleType: FavoriteLedgerRuleType) {
  if (ruleType === 'author') {
    return '不同 UP 名用顿号或空格隔开，逗号、斜杠也能识别。'
  }
  if (ruleType === 'tag') {
    return '不同标签用顿号或空格隔开，逗号、斜杠也能识别。'
  }
  if (ruleType === 'deepseek') {
    return 'DeepSeek 未开启时不会自动命中；需要本地规则时请选择关键词、UP 或标签收藏夹。'
  }
  return '不同关键词用顿号或空格隔开，逗号、斜杠也能识别。'
}

function defaultLedgerKeywordWarning(ledger: FavoriteLedger) {
  const ruleType = ledgerRuleType(ledger)
  const localKeywordCount =
    ruleType === 'deepseek'
      ? ledger.keywords.filter((keyword) => keyword.trim()).length
      : splitLedgerKeywordSections(ledger).localKeywords.length
  return ledger.isDefault && ledger.id !== 'inbox' && localKeywordCount === 0
    ? '默认分类关键词已清空，本地识别能力会明显下降，未命中的内容可能进入暂存。'
    : ''
}

function alreadyHasLedger(ledgers: FavoriteLedger[], displayName: string) {
  const normalizedDisplayName = normalizeBilimiLedgerName(displayName)
  return ledgers.some((ledger) => normalizeBilimiLedgerName(ledger.displayName) === normalizedDisplayName)
}

function candidateKey(candidate: FavoriteLedgerCandidate) {
  return `${candidate.kind}:${candidate.sourceName}`
}

function isFavoriteLedgerCandidateKind(value: string): value is FavoriteLedgerCandidate['kind'] {
  return value === 'author' || value === 'tag-cluster' || value === 'category' || value === 'series'
}

function sortFavoriteLedgerCandidatesByCount(
  candidates: FavoriteLedgerCandidate[],
  counts: Map<string, number>
) {
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => {
      const leftCount = counts.get(candidateKey(left.candidate)) ?? left.candidate.count
      const rightCount = counts.get(candidateKey(right.candidate)) ?? right.candidate.count
      if (leftCount !== rightCount) {
        return rightCount - leftCount
      }
      return left.index - right.index
    })
    .map(({ candidate }) => candidate)
}

function mergeDefaultLedgers(ledgers: FavoriteLedger[], enabled?: boolean) {
  const ledgerById = new Map(ledgers.map((ledger) => [ledger.id, ledger]))
  const mergedDefaults = createDefaultFavoriteLedgers().map((ledger) => ({
    ...(ledgerById.get(ledger.id) ?? ledger),
    enabled: enabled ?? ledgerById.get(ledger.id)?.enabled ?? ledger.enabled
  }))
  const customLedgers = ledgers.filter((ledger) => !ledger.isDefault)

  return withSequentialPriorities([...mergedDefaults, ...customLedgers])
}

function candidateLedgerId(candidate: FavoriteLedgerCandidate) {
  return candidate.id ?? `custom-${candidate.kind}-${candidate.sourceName
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')}`
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '未知错误')
  if (message.includes('已达到数量上限')) {
    return '收藏夹数量已超过b站上限99个，小咪已经无法再生成更多收藏夹了，主人想继续使用建议适当删除几个哦'
  }
  return message
}

function isFavoriteLedgerConnectionFailure(error: unknown) {
  return /GUEST_VIEW_MANAGER_CALL|Failed to fetch|NetworkError|net::ERR_/i.test(errorMessage(error))
}

async function appendWorkspaceLogicalChunk(
  accountMid: string,
  batchId: string,
  base: FavoriteLedgerPreviewItem[]
) {
  const chunks = {
    base,
    tags: base.map((item) => ({ aid: item.aid, tags: [...(item.tags ?? [])] })),
    sources: base.map((item) => ({
      aid: item.aid,
      sourceFolderIds: [...(item.sourceFolderIds ?? [])],
      sourceFolderTitles: [...(item.sourceFolderTitles ?? [])]
    }))
  }
  if (window.bilimiDesktop?.appendOldFavoriteWorkspaceChunkGroup) {
    await window.bilimiDesktop.appendOldFavoriteWorkspaceChunkGroup(accountMid, batchId, chunks)
    return
  }
  await window.bilimiDesktop?.appendOldFavoriteWorkspaceChunk?.(accountMid, batchId, 'base', chunks.base)
  await window.bilimiDesktop?.appendOldFavoriteWorkspaceChunk?.(accountMid, batchId, 'tags', chunks.tags)
  await window.bilimiDesktop?.appendOldFavoriteWorkspaceChunk?.(accountMid, batchId, 'sources', chunks.sources)
}

function isBilimiLedger(ledger: FavoriteLedger) {
  return isBilimiManagedLedgerName(ledger.displayName)
}

function prefixedBilimiLedgerName(name: string) {
  return `${BILIMI_LEDGER_PREFIX}${stripBilimiLedgerPrefix(name)}`
}

function normalizeBilimiLedgerName(name: string) {
  return isBilimiManagedLedgerName(name) ? prefixedBilimiLedgerName(name) : name.trim()
}

function reorderLedgers(ledgers: FavoriteLedger[], draggedLedgerKey: string, targetLedgerKey: string) {
  if (draggedLedgerKey === targetLedgerKey) {
    return ledgers
  }

  const draggedIndex = ledgers.findIndex(
    (ledger, index) => ledgerDraftKey(ledger, index, ledgers) === draggedLedgerKey
  )
  const targetIndex = ledgers.findIndex(
    (ledger, index) => ledgerDraftKey(ledger, index, ledgers) === targetLedgerKey
  )
  if (draggedIndex < 0 || targetIndex < 0) {
    return ledgers
  }

  const nextLedgers = [...ledgers]
  const [draggedLedger] = nextLedgers.splice(draggedIndex, 1)
  const targetLedger = ledgers[targetIndex]
  const nextTargetIndex = nextLedgers.findIndex((ledger) => ledger === targetLedger)
  const insertionIndex = draggedIndex < targetIndex ? nextTargetIndex + 1 : nextTargetIndex
  nextLedgers.splice(insertionIndex, 0, draggedLedger)
  return nextLedgers
}

function withSequentialPriorities(ledgers: FavoriteLedger[]) {
  return ledgers.map((ledger, index) => ({
    ...ledger,
    priority: (index + 1) * 10
  }))
}

function saveStatusMessage(result: AssistantAutomationResult | void) {
  const message = result?.message === 'favorite ledgers saved' ? '掌库已同步。' : result?.message
  return message ? `保存成功：${message}` : '保存成功：掌库已同步。'
}

const COLLAPSED_LEDGER_COUNT = 15
const COLLAPSED_TAG_CANDIDATE_COUNT = 12
const EXPANDED_TAG_CANDIDATE_COUNT = 24
const LEDGER_SYNC_HINT = [
  '自定义你的 bilimi 收藏夹',
  '点击收藏名字可以编辑，添加好后点击【同步】即可更新到 B 站',
  '取消勾选再点击同步，也会删除对应的 bilimi 收藏夹'
].join('\n')
const BACKUP_COMPLETE_MESSAGE =
  '小咪备册已完成，主人可以再增加自己想要的收藏夹，点击同步即可'
const OLD_FAVORITE_GUIDE_HINT = [
  '请从左到右完成本轮整理',
  '① 扫描概览：勾选要整理的收藏夹（默认全选）',
  '② 推荐收藏夹：勾选想新建的收藏夹',
  '③ 归档预览：检查分类结果，可启用 DeepSeek 辅助调整',
  '④ 确认执行：查看进度，完成后点“结束本轮”'
].join('\n')
const OLD_FAVORITE_EXECUTION_NOTICE =
  '开始整理后，本轮将按当前预览追加到 bilimi 收藏夹，执行中不能再更改。原收藏不会被删除、移动或取消。'
const OLD_FAVORITE_EXECUTION_CONFIRM_MESSAGE =
  '小咪提醒：主人要开始整理吗？开始后就不能再调整了哦！'
type OldFavoriteGuideStep = 'scan' | 'generated' | 'preview' | 'confirm'
const OLD_FAVORITE_VIRTUAL_TRACK_THRESHOLD = 50
const OLD_FAVORITE_VIRTUAL_TRACK_ITEM_WIDTH = 280
type OldFavoriteGuideMode = 'setup' | 'organize'
const OLD_FAVORITE_GUIDE_STEPS: Array<{ id: OldFavoriteGuideStep; label: string }> = [
  { id: 'scan', label: '扫描概览' },
  { id: 'generated', label: '推荐收藏夹' },
  { id: 'preview', label: '归档预览' },
  { id: 'confirm', label: '确认执行' }
]

type OldFavoriteTargetGroup = {
  ledgerId: string
  displayName: string
  entries: Array<{
    item: FavoriteLedgerPreviewItem
    target: FavoriteLedgerPreviewTarget
    selected: boolean
    changedByDeepSeek: boolean
    targetChanged: boolean
  }>
}

type PendingUnclassifiedDecision = {
  itemKey: string
  areaLedgerId: string
}

type DeepSeekArchiveProgress = {
  completedVideos: number
  totalVideos: number
  currentChunk: number
  totalChunks: number
}

function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  const tagName = target.tagName.toLowerCase()
  return (
    tagName === 'input' ||
    tagName === 'select' ||
    tagName === 'textarea' ||
    tagName === 'button' ||
    target.isContentEditable
  )
}

type OldFavoriteSourceFolderSummary = {
  id?: string
  sourceKey: string
  name: string
  totalCount: number
  actionableCount: number
  scanFailed?: boolean
  scanStatus?: 'complete' | 'failed' | 'partial'
  scanFailureMessage?: string
  failedPage?: number
  readVideoCount?: number
}

type OldFavoriteManagedSourceFolderSummary = OldFavoriteSourceFolderSummary & {
  physicalIds: string[]
  memberAids: number[]
  shardCount: number
  isInbox: boolean
}

type OldFavoriteSourceTablesProps = {
  mode: 'setup' | 'organize'
  userFolders: OldFavoriteSourceFolderSummary[]
  bilimiFolders: OldFavoriteManagedSourceFolderSummary[]
  selectedUserKeys: Set<string>
  selectedManagedIds: Set<string>
  unlockedManagedIds: Set<string>
  readOnly: boolean
  onToggleUserFolder: (sourceKey: string) => void
  onToggleManagedFolder: (folder: OldFavoriteManagedSourceFolderSummary, selected: boolean) => void
}

function oldFavoriteSourceOccurrenceSuffix(
  folder: OldFavoriteSourceFolderSummary,
  folders: OldFavoriteSourceFolderSummary[]
) {
  const duplicates = folders.filter(
    (candidate) => candidate.name === folder.name && candidate.totalCount === folder.totalCount
  )
  if (duplicates.length < 2) return ''
  return `，第 ${duplicates.findIndex((candidate) => candidate.sourceKey === folder.sourceKey) + 1} 个`
}

const OldFavoriteSourceTables = memo(function OldFavoriteSourceTables({
  mode,
  userFolders,
  bilimiFolders,
  selectedUserKeys,
  selectedManagedIds,
  unlockedManagedIds,
  readOnly,
  onToggleUserFolder,
  onToggleManagedFolder
}: OldFavoriteSourceTablesProps) {
  return (
    <>
      {userFolders.length > 0 ? (
        <div className="favorite-ledger-panel__source-table" role="table" aria-label="用户收藏夹">
          <div role="row" className="favorite-ledger-panel__source-header favorite-ledger-panel__source-header--user">
            <span role="columnheader" aria-label="选择" />
            <span role="columnheader">用户收藏夹</span>
            <span role="columnheader">总数</span>
            <span role="columnheader">本轮待整理</span>
          </div>
          <ul role="rowgroup" className="favorite-ledger-panel__source-list">
            {userFolders.map((folder) => {
              const occurrenceSuffix = oldFavoriteSourceOccurrenceSuffix(folder, userFolders)
              const scanState = folder.scanStatus === 'partial' ? '部分扫描' : '扫描失败'
              const scanFailureDescription = folder.scanFailed
                ? `第 ${folder.failedPage ?? 1} 页${readableOldFavoriteScanFailure(folder.scanFailureMessage)}，已读取 ${folder.readVideoCount ?? 0} 条`
                : ''
              const content = (
                <>
                  <span role="cell">
                    {mode === 'organize' ? (
                      <input
                        type="checkbox"
                        aria-label={`整理来源 ${folder.name}，共 ${folder.totalCount}${occurrenceSuffix}`}
                        checked={selectedUserKeys.has(folder.sourceKey)}
                        disabled={readOnly || folder.scanFailed}
                        onChange={() => onToggleUserFolder(folder.sourceKey)}
                      />
                    ) : null}
                  </span>
                  <span role="cell" className="favorite-ledger-panel__source-name" title={folder.name}>{folder.name}</span>
                  <span role="cell" className="favorite-ledger-panel__source-count">{folder.totalCount}</span>
                  <span role="cell" className="favorite-ledger-panel__source-count">
                    {folder.scanFailed ? scanState : folder.actionableCount}
                  </span>
                </>
              )
              return (
                <li
                  key={folder.sourceKey}
                  role="row"
                  aria-label={`${folder.name}，总数 ${folder.totalCount}${occurrenceSuffix}`}
                  className="favorite-ledger-panel__source-row favorite-ledger-panel__source-row--user"
                >
                  {mode === 'organize'
                    ? <label className="favorite-ledger-panel__source-row-content">{content}</label>
                    : <div className="favorite-ledger-panel__source-row-content">{content}</div>}
                  {folder.scanFailed ? <small className="favorite-ledger-panel__source-failure">{scanFailureDescription}</small> : null}
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
      {bilimiFolders.length > 0 ? (
        <div className="favorite-ledger-panel__source-table favorite-ledger-panel__source-table--bilimi" role="table" aria-label="bilimi 工作夹">
          <div role="row" className="favorite-ledger-panel__source-header favorite-ledger-panel__source-header--bilimi">
            <span role="columnheader" aria-label="选择" />
            <span role="columnheader">bilimi 工作夹</span>
            <span role="columnheader">已有</span>
            <span role="columnheader">本轮待整理</span>
          </div>
          <ul role="rowgroup" className="favorite-ledger-panel__source-list">
            {bilimiFolders.map((folder) => {
              const unlocked = folder.isInbox || unlockedManagedIds.has(folder.id)
              const selected = folder.isInbox
                ? !selectedManagedIds.has(`disabled:${folder.id}`)
                : unlocked && selectedManagedIds.has(folder.id)
              const shardLabel = folder.shardCount > 1 ? `，${folder.shardCount} 卷` : ''
              return (
                <li
                  key={folder.sourceKey}
                  role="row"
                  aria-label={`${folder.name}，已有 ${folder.totalCount}${shardLabel}，本轮待整理 ${selected ? folder.totalCount : 0}`}
                  className="favorite-ledger-panel__source-row favorite-ledger-panel__source-row--bilimi"
                >
                  <span role="cell">
                    <input
                      type="checkbox"
                      aria-label={`选择 ${folder.name}`}
                      checked={selected}
                      disabled={readOnly || !unlocked}
                      onChange={(event) => onToggleManagedFolder(folder, event.currentTarget.checked)}
                    />
                  </span>
                  <span role="cell" className="favorite-ledger-panel__source-name" title={folder.name}>{folder.name}</span>
                  <span role="cell" className="favorite-ledger-panel__source-count">{folder.totalCount}</span>
                  <span role="cell" className="favorite-ledger-panel__source-count">{selected ? folder.totalCount : 0}</span>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </>
  )
})

type ArchiveBatchOperationProgress = {
  phase: 'running' | 'success'
  completed: number
  total: number
}

function ledgerDraftKey(
  ledger: Pick<FavoriteLedger, 'id'>,
  index: number,
  ledgers: Array<Pick<FavoriteLedger, 'id'>>
) {
  const occurrence = ledgers.slice(0, index).filter((candidate) => candidate.id === ledger.id).length
  return `${ledger.id}::${occurrence}`
}

type OldFavoriteTagEnrichmentSnapshot = Awaited<ReturnType<
  NonNullable<FavoriteLedgerPanelProps['onReadOldFavoriteTagEnrichment']>
>>

function invalidScanProgressPart(
  part: { completed?: number; total?: number; pending?: number; status?: string } | undefined
) {
  if (!part) return false
  const completed = Number(part.completed)
  const total = Number(part.total)
  const pending = part.pending === undefined ? 0 : Number(part.pending)
  return !Number.isFinite(completed) || !Number.isFinite(total) || !Number.isFinite(pending) ||
    completed < 0 || total < 0 || pending < 0 || completed > total || pending > total ||
    completed + pending > total ||
    (part.status === 'complete' && (pending !== 0 || completed < total))
}

function invalidTagScanProgressPart(
  part: {
    completed?: number
    total?: number
    pending?: number
    cacheHits?: number
    succeeded?: number
    failed?: number
    status?: string
    terminalReason?: string
    errorKind?: string
    errorCode?: number
    errorMessage?: string
  } | undefined
) {
  if (!part) return false
  if (invalidScanProgressPart(part)) return true
  return [part.cacheHits, part.succeeded, part.failed].some((value) => {
    const numericValue = Number(value)
    return !Number.isFinite(numericValue) || numericValue < 0
  })
}

function oldFavoriteTagEnrichmentFinished(
  tags: NonNullable<FavoriteLedgerPreview['scanProgress']>['tags'] | undefined
) {
  return Boolean(
    tags &&
    tags.pending === 0 &&
    (tags.status === 'complete' || (tags.status === 'partial' && tags.terminalReason === 'cancelled'))
  )
}

function oldFavoriteSourceKey(id: string | undefined, title: string) {
  return id ? `id:${id}` : `title:${title}`
}

function sameStringSet(left: Set<string>, right: Set<string>) {
  return left.size === right.size && Array.from(left).every((value) => right.has(value))
}

function oldFavoriteItemSourceKeys(
  item: Pick<FavoriteLedgerPreviewItem, 'sourceFolderIds' | 'sourceFolderTitles' | 'sourceFolderTitle'>
) {
  if (item.sourceFolderIds?.length) {
    return item.sourceFolderIds.map((id) => oldFavoriteSourceKey(id, ''))
  }

  return (item.sourceFolderTitles ?? [item.sourceFolderTitle]).map((title) =>
    oldFavoriteSourceKey(undefined, title)
  )
}

function oldFavoriteItemMatchesSource(
  item: Pick<FavoriteLedgerPreviewItem, 'sourceFolderIds' | 'sourceFolderTitles' | 'sourceFolderTitle'>,
  folder: Pick<OldFavoriteSourceFolderSummary, 'id' | 'name' | 'sourceKey'>
) {
  if (item.sourceFolderIds?.length) {
    return Boolean(folder.id && item.sourceFolderIds.includes(folder.id))
  }

  return (item.sourceFolderTitles ?? [item.sourceFolderTitle]).includes(folder.name)
}

type OldFavoriteScanFailureSummary = {
  message?: string
  errorKind?: string
  httpStatus?: number
  apiCode?: number
  finalUrl?: string
  loginSignal?: boolean
  riskSignal?: boolean
}

function readableOldFavoriteScanFailure(failure: OldFavoriteScanFailureSummary | string | undefined) {
  const detail = typeof failure === 'string' ? { message: failure } : (failure ?? {})
  const normalized = String(detail.message ?? '').trim()
  if (detail.errorKind === 'global-circuit-open') {
    return detail.riskSignal
      ? '因全局访问限制未扫描，请等待 30 分钟后重新扫描'
      : '因全局接口异常未扫描'
  }
  if (/timeout|timed out|abort/i.test(normalized)) return '请求超时'
  if (
    detail.apiCode === -101 ||
    (detail.loginSignal && /\/(?:login|passport)(?:\/|$)/i.test(detail.finalUrl ?? ''))
  ) return '登录状态失效'
  if (
    detail.riskSignal ||
    [403, 412].includes(detail.httpStatus ?? 0) ||
    [-352, -509].includes(detail.apiCode ?? 0)
  ) {
    return 'B站暂时限制收藏明细访问，可能是短时间扫描数量较多。已停止后续扫描，请等待 30 分钟后重试；若仍受限，请等待 2 小时'
  }
  if (detail.errorKind === 'html' || /returned html/i.test(normalized)) {
    return '收藏明细接口返回异常页面'
  }
  return normalized.slice(0, 80) || '未知错误'
}

function visibleLedgers(ledgers: FavoriteLedger[], expanded: boolean) {
  if (expanded) {
    return ledgers
  }

  return ledgers.slice(0, COLLAPSED_LEDGER_COUNT)
}

function archivePlanItemKey(item: Pick<FavoriteLedgerPreviewItem, 'aid' | 'sourceFolderTitle'>) {
  return `${item.sourceFolderTitle}::${item.aid}`
}

function archivePlanTargetKey(
  item: Pick<FavoriteLedgerPreviewItem, 'aid' | 'sourceFolderTitle' | 'targetLedgerId'>
) {
  return `${archivePlanItemKey(item)}::${item.targetLedgerId}`
}

function favoriteLedgerDisplayShortName(displayName: string) {
  return stripBilimiLedgerPrefix(displayName)
}

function candidateLedgerIdFromCandidate(candidate: FavoriteLedgerCandidate) {
  return candidateLedgerId(candidate)
}

function recommendedCandidateDisplayName(
  candidate: FavoriteLedgerCandidate,
  existingDisplayNames: Iterable<string>,
  peerCandidates: Iterable<FavoriteLedgerCandidate> = [candidate]
) {
  if (candidate.kind !== 'author') {
    return candidate.displayName
  }

  const authorSourceNames = Array.from(peerCandidates)
    .filter((peer) => peer.kind === 'author')
    .map((peer) => peer.sourceName)
  return createRecommendedFavoriteLedgerNames(
    authorSourceNames.length > 0 ? authorSourceNames : [candidate.sourceName],
    existingDisplayNames
  ).get(candidate.sourceName) ?? createRecommendedFavoriteLedgerName(
    candidate.sourceName,
    existingDisplayNames
  )
}

function candidateLedgerKeywords(candidate: FavoriteLedgerCandidate) {
  return candidate.kind === 'author'
    ? [candidate.sourceName, ...candidate.keywords.filter((keyword) => keyword !== candidate.sourceName)]
    : candidate.keywords
}

function candidateToFavoriteLedger(
  candidate: FavoriteLedgerCandidate,
  priority: number,
  existingDisplayNames: Iterable<string>,
  peerCandidates: Iterable<FavoriteLedgerCandidate> = [candidate]
): FavoriteLedger {
  return {
    id: candidateLedgerIdFromCandidate(candidate),
    displayName: recommendedCandidateDisplayName(candidate, existingDisplayNames, peerCandidates),
    keywords: candidateLedgerKeywords(candidate),
    ruleType: candidateRuleType(candidate),
    enabled: true,
    priority,
    isDefault: false
  }
}

function mergeCandidateLedgers(
  ledgers: FavoriteLedger[],
  preview: FavoriteLedgerPreview,
  selectedCandidateKeys: Set<string>
) {
  const nextLedgers = [...ledgers]
  const candidates = preview.insights?.candidateLedgers ?? []
  for (const candidate of candidates) {
    if (!selectedCandidateKeys.has(candidateKey(candidate))) {
      continue
    }
    if (alreadyHasLedger(
      nextLedgers,
      recommendedCandidateDisplayName(
        candidate,
        nextLedgers.map((ledger) => ledger.displayName),
        candidates
      )
    )) {
      continue
    }
    nextLedgers.push(candidateToFavoriteLedger(
      candidate,
      (nextLedgers.length + 1) * 10,
      nextLedgers.map((ledger) => ledger.displayName),
      candidates
    ))
  }
  return withSequentialPriorities(nextLedgers)
}

function recommendedLedgerIdsForPreview(preview: FavoriteLedgerPreview) {
  const ledgerIds = new Set<string>()
  for (const item of preview.items) {
    if (item.alreadyInTarget) {
      continue
    }

    for (const target of targetsForOldFavoriteItem(item)) {
      if (target.selectedCandidateTarget || target.alreadyInTarget || target.ledgerId === 'inbox') {
        continue
      }

      ledgerIds.add(target.ledgerId)
    }
  }
  return ledgerIds
}

function legacyTargetForOldFavoriteItem(item: FavoriteLedgerPreviewItem): FavoriteLedgerPreviewTarget {
  return {
    ledgerId: item.targetLedgerId,
    folderId: item.targetFolderId,
    displayName: item.targetDisplayName,
    keywords: [],
    alreadyInTarget: item.alreadyInTarget,
    selected: item.selected,
    selectedCandidateTarget: item.selectedCandidateTarget
  }
}

function targetsForOldFavoriteItem(item: FavoriteLedgerPreviewItem): FavoriteLedgerPreviewTarget[] {
  return item.targets?.length ? item.targets : [legacyTargetForOldFavoriteItem(item)]
}

function uniqueLedgerIds(ledgerIds: string[]) {
  return Array.from(new Set(ledgerIds.filter(Boolean)))
}

function selectedArchiveLedgerIdsForOldFavoriteItem(item: FavoriteLedgerPreviewItem) {
  const hasSelectedTargetLedgerIds = Array.isArray(item.selectedTargetLedgerIds)
  if (hasSelectedTargetLedgerIds) {
    return uniqueLedgerIds(item.selectedTargetLedgerIds)
  }

  const selectedTargetLedgerIds = targetsForOldFavoriteItem(item)
    .filter((target) => target.selected && !target.alreadyInTarget)
    .map((target) => target.ledgerId)

  if (selectedTargetLedgerIds.length > 0) {
    return uniqueLedgerIds(selectedTargetLedgerIds)
  }

  if (item.selected && !item.alreadyInTarget && item.targetLedgerId && item.targetLedgerId !== 'inbox') {
    return [item.targetLedgerId]
  }

  return []
}

function currentArchiveLedgerIdsForOldFavoriteItem(item: FavoriteLedgerPreviewItem) {
  if (Array.isArray(item.currentTargetLedgerIds)) {
    return uniqueLedgerIds(item.currentTargetLedgerIds)
  }

  return selectedArchiveLedgerIdsForOldFavoriteItem(item)
}

function originalArchiveLedgerIdsForOldFavoriteItem(item: FavoriteLedgerPreviewItem) {
  if (Array.isArray(item.originalSuggestedLedgerIds)) {
    return uniqueLedgerIds(item.originalSuggestedLedgerIds.filter((ledgerId) => ledgerId !== 'inbox'))
  }

  return currentArchiveLedgerIdsForOldFavoriteItem(item).filter((ledgerId) => ledgerId !== 'inbox')
}

function targetForOldFavoriteLedgerId(
  item: FavoriteLedgerPreviewItem,
  ledgerId: string,
  ledgers: FavoriteLedger[]
): FavoriteLedgerPreviewTarget {
  const existingTarget = targetsForOldFavoriteItem(item).find((target) => target.ledgerId === ledgerId)
  if (existingTarget) {
    return {
      ...existingTarget,
      selected: true
    }
  }

  const candidateTarget = item.candidateTargets?.find((target) => target.ledgerId === ledgerId)
  if (candidateTarget) {
    return {
      ...candidateTarget,
      folderId: '',
      alreadyInTarget: false,
      selectedCandidateTarget: true,
      selected: true
    }
  }

  const ledger = ledgers.find((candidate) => candidate.id === ledgerId)
  return {
    ledgerId,
    folderId: ledger?.bilibiliFolderId ?? '',
    displayName: ledger?.displayName ?? '未知收藏夹',
    keywords: ledger?.keywords ?? [],
    ruleType: ledger?.ruleType,
    alreadyInTarget: false,
    selected: true
  }
}

function normalizeOldFavoritePreviewItem(
  item: FavoriteLedgerPreviewItem,
  ledgers: FavoriteLedger[]
): FavoriteLedgerPreviewItem {
  const currentTargetLedgerIds = currentArchiveLedgerIdsForOldFavoriteItem(item)
  const selectedTargetLedgerIds = selectedArchiveLedgerIdsForOldFavoriteItem(item)
  const originalSuggestedLedgerIds = originalArchiveLedgerIdsForOldFavoriteItem(item)
  const selectedTargetSet = new Set(selectedTargetLedgerIds)
  const currentTargets = currentTargetLedgerIds.map((ledgerId) => ({
    ...targetForOldFavoriteLedgerId(item, ledgerId, ledgers),
    selected: selectedTargetSet.has(ledgerId)
  }))
  const existingUnselectedTargets = (item.targets ?? []).filter(
    (target) => !currentTargetLedgerIds.includes(target.ledgerId)
  )

  const nextItem = {
    ...item,
    targets: currentTargets.length > 0 ? [...currentTargets, ...existingUnselectedTargets] : []
  }

  nextItem.originalSuggestedLedgerIds = originalSuggestedLedgerIds
  nextItem.currentTargetLedgerIds = currentTargetLedgerIds
  nextItem.selectedTargetLedgerIds = selectedTargetLedgerIds
  nextItem.lowConfidence = item.lowConfidence ?? Boolean(item.classificationDiagnostic?.lowConfidence)

  return nextItem
}

function normalizeOldFavoritePreviewItems(
  items: FavoriteLedgerPreviewItem[],
  ledgers: FavoriteLedger[]
) {
  return items.map((item) => normalizeOldFavoritePreviewItem(item, ledgers))
}

function collectionSnapshotFromPreview(preview: FavoriteLedgerPreview | null): CollectionSnapshotItem[] {
  return preview?.items.map((item) => ({
    aid: item.aid,
    sourceFolderIds: item.sourceFolderIds?.length
      ? [...item.sourceFolderIds]
      : [item.sourceFolderTitle]
  })) ?? []
}

function addOldFavoriteSourceRelation(
  item: FavoriteLedgerPreviewItem,
  update: NonNullable<OldFavoriteTagEnrichmentSnapshot['sourceUpdates']>[number]
) {
  const sourceFolderIds = item.sourceFolderIds?.length ? [...item.sourceFolderIds] : []
  const sourceFolderTitles = item.sourceFolderTitles?.length ? [...item.sourceFolderTitles] : []
  if (sourceFolderIds.includes(update.folderId)) return item
  sourceFolderIds.push(update.folderId)
  sourceFolderTitles.push(update.folderTitle)
  return { ...item, sourceFolderIds, sourceFolderTitles }
}

function archiveLedgerIdsForSelectedCandidates(
  item: FavoriteLedgerPreviewItem,
  ledgerIds: string[],
  selectedCandidateKeys: Set<string>
) {
  const candidateTargetsByLedgerId = new Map(
    (item.candidateTargets ?? []).map((target) => [target.ledgerId, target.candidateKey])
  )

  return ledgerIds.filter((ledgerId) => {
    const candidateTargetKey = candidateTargetsByLedgerId.get(ledgerId)
    return !candidateTargetKey || selectedCandidateKeys.has(candidateTargetKey)
  })
}

function createArchivePlanStateFromPreviewItems(
  items: FavoriteLedgerPreviewItem[],
  selectedCandidateKeys: Set<string> = new Set()
) {
  const hasSelectedCandidates = selectedCandidateKeys.size > 0

  return createArchivePlanState(
    items.map((item) => {
      const itemWithCandidateTargets = hasSelectedCandidates
        ? itemWithSelectedCandidateTargets(item, selectedCandidateKeys)
        : item
      const originalSuggestedLedgerIds = archiveLedgerIdsForSelectedCandidates(
        item,
        originalArchiveLedgerIdsForOldFavoriteItem(item),
        selectedCandidateKeys
      )
      const currentTargetLedgerIds = archiveLedgerIdsForSelectedCandidates(
        itemWithCandidateTargets,
        currentArchiveLedgerIdsForOldFavoriteItem(itemWithCandidateTargets),
        selectedCandidateKeys
      )
      const selectedTargetLedgerIds = archiveLedgerIdsForSelectedCandidates(
        itemWithCandidateTargets,
        selectedArchiveLedgerIdsForOldFavoriteItem(itemWithCandidateTargets),
        selectedCandidateKeys
      )

      return {
        itemKey: archivePlanItemKey(item),
        aid: item.aid,
        title: item.title,
        author: item.author,
        description: item.description,
        tags: item.tags,
        category: item.category,
        sourceFolderTitle: item.sourceFolderTitle,
        originalSuggestedLedgerIds,
        currentTargetLedgerIds,
        selectedTargetLedgerIds,
        lowConfidence: item.lowConfidence,
        classificationDiagnostic: item.classificationDiagnostic
      }
    })
  )
}

function mergeArchivePlanAfterModeRefresh(
  refreshedState: FavoriteArchivePlanState,
  currentState: FavoriteArchivePlanState | null,
  targetLimit: number
): FavoriteArchivePlanState {
  if (!currentState) {
    return refreshedState
  }

  const currentItemsByKey = new Map(
    currentState.items.map((item) => [item.itemKey, item])
  )

  return {
    ...refreshedState,
    items: refreshedState.items.map((item) => {
      const currentItem = currentItemsByKey.get(item.itemKey)
      if (
        !currentItem?.userModified ||
        currentItem.selectedTargetLedgerIds.length > targetLimit
      ) {
        return item
      }

      return {
        ...item,
        currentTargetLedgerIds: [...currentItem.currentTargetLedgerIds],
        selectedTargetLedgerIds: [...currentItem.selectedTargetLedgerIds],
        userModified: true,
        lastChangeSource: currentItem.lastChangeSource
      }
    })
  }
}

function applyArchivePlanToPreviewItems(
  items: FavoriteLedgerPreviewItem[],
  state: FavoriteArchivePlanState,
  ledgers: FavoriteLedger[]
) {
  const planItemsByKey = new Map(
    state.items.map((item) => [item.itemKey, item])
  )
  return items.map((item) => {
    const planItem = planItemsByKey.get(archivePlanItemKey(item))
    if (!planItem) {
      return item
    }

    return normalizeOldFavoritePreviewItem(
      {
        ...item,
        originalSuggestedLedgerIds: [...planItem.originalSuggestedLedgerIds],
        currentTargetLedgerIds: [...planItem.currentTargetLedgerIds],
        selectedTargetLedgerIds: [...planItem.selectedTargetLedgerIds]
      },
      ledgers
    )
  })
}

function emptyRecoveredOldFavoriteInsights(totalVideos: number) {
  return {
    totalVideos,
    topAuthors: [],
    topTags: [],
    topCategories: [],
    sourceFolders: [],
    titleSeries: [],
    candidateLedgers: []
  }
}

function rejudgedCurrentArchiveLedgerIds(item: FavoriteLedgerPreviewItem) {
  const explicitCurrentLedgerIds = Array.isArray(item.currentTargetLedgerIds)
    ? uniqueLedgerIds(item.currentTargetLedgerIds)
    : []
  if (explicitCurrentLedgerIds.length > 0) {
    return explicitCurrentLedgerIds
  }

  const targetLedgerIds = targetsForOldFavoriteItem(item)
    .filter((target) => target.ledgerId !== 'inbox' && !target.alreadyInTarget && target.selected)
    .map((target) => target.ledgerId)
  if (targetLedgerIds.length > 0) {
    return uniqueLedgerIds(targetLedgerIds)
  }

  if (item.targetLedgerId && item.targetLedgerId !== 'inbox' && !item.alreadyInTarget) {
    return [item.targetLedgerId]
  }

  return []
}

function rejudgedSelectedArchiveLedgerIds(item: FavoriteLedgerPreviewItem) {
  return Array.isArray(item.selectedTargetLedgerIds)
    ? uniqueLedgerIds(item.selectedTargetLedgerIds)
    : selectedArchiveLedgerIdsForOldFavoriteItem(item)
}

function ledgersWithOldFavoriteTargetFolders(
  ledgers: FavoriteLedger[],
  items: FavoriteLedgerPreviewItem[]
) {
  const folderIdsByLedgerId = new Map<string, string>()
  for (const item of items) {
    for (const target of targetsForOldFavoriteItem(item)) {
      if (target.folderId) {
        folderIdsByLedgerId.set(target.ledgerId, target.folderId)
      }
    }
  }

  return ledgers.map((ledger) =>
    ledger.bilibiliFolderId || !folderIdsByLedgerId.has(ledger.id)
      ? ledger
      : {
          ...ledger,
          bilibiliFolderId: folderIdsByLedgerId.get(ledger.id)
        }
  )
}

function candidateTargetToPreviewTarget(
  target: NonNullable<FavoriteLedgerPreviewItem['candidateTargets']>[number]
): FavoriteLedgerPreviewTarget {
  return {
    ledgerId: target.ledgerId,
    folderId: '',
    displayName: target.displayName,
    keywords: target.keywords,
    ruleType: target.ruleType,
    alreadyInTarget: false,
    selected: true,
    selectedCandidateTarget: true,
    candidateKey: target.candidateKey
  }
}

function itemWithSelectedCandidateTargets(
  item: FavoriteLedgerPreviewItem,
  selectedCandidateKeys: Set<string>
): FavoriteLedgerPreviewItem {
  const selectedCandidateTargets = (item.candidateTargets ?? []).filter((target) =>
    selectedCandidateKeys.has(target.candidateKey)
  )
  if (selectedCandidateTargets.length === 0) {
    return item
  }

  const nextTargets = targetsForOldFavoriteItem(item)
    .filter((target) => {
      if (target.ledgerId === 'inbox') {
        return false
      }
      if (!target.selectedCandidateTarget || !target.candidateKey) {
        return true
      }
      return selectedCandidateKeys.has(target.candidateKey)
    })
    .map((target) =>
      target.selectedCandidateTarget && target.candidateKey && selectedCandidateKeys.has(target.candidateKey)
        ? {
            ...target,
            selected: true
          }
        : target
    )
  const targetIds = new Set(nextTargets.map((target) => target.ledgerId))

  for (const candidateTarget of selectedCandidateTargets) {
    if (targetIds.has(candidateTarget.ledgerId)) {
      continue
    }
    targetIds.add(candidateTarget.ledgerId)
    nextTargets.push(candidateTargetToPreviewTarget(candidateTarget))
  }

  const selectedCandidateLedgerIds = selectedCandidateTargets.map((target) => target.ledgerId)
  const previousCurrentLedgerIds = Array.isArray(item.currentTargetLedgerIds)
    ? item.currentTargetLedgerIds
    : currentArchiveLedgerIdsForOldFavoriteItem(item)
  const previousSelectedLedgerIds = Array.isArray(item.selectedTargetLedgerIds)
    ? item.selectedTargetLedgerIds
    : selectedArchiveLedgerIdsForOldFavoriteItem(item)
  const currentTargetLedgerIds = uniqueLedgerIds([
    ...previousCurrentLedgerIds.filter((ledgerId) => ledgerId !== 'inbox'),
    ...selectedCandidateLedgerIds
  ])
  const selectedTargetLedgerIds = uniqueLedgerIds([
    ...previousSelectedLedgerIds.filter((ledgerId) => ledgerId !== 'inbox'),
    ...selectedCandidateLedgerIds
  ])
  const primaryTarget = nextTargets.find((target) => target.ledgerId === currentTargetLedgerIds[0])

  return {
    ...item,
    targets: nextTargets,
    currentTargetLedgerIds,
    selectedTargetLedgerIds,
    targetLedgerId: primaryTarget?.ledgerId ?? currentTargetLedgerIds[0] ?? 'inbox',
    targetFolderId: primaryTarget?.folderId ?? '',
    targetDisplayName: primaryTarget?.displayName ?? item.targetDisplayName,
    selected: selectedTargetLedgerIds.length > 0
  }
}

function isPreviewScopedPendingItem(item: FavoriteLedgerPreviewItem) {
  if (item.alreadyInTarget) {
    return false
  }

  const targets = targetsForOldFavoriteItem(item)
  const hasSelectedExecutableTarget = targets.some(
    (target) => target.selected && target.ledgerId !== 'inbox' && !target.alreadyInTarget
  )

  if (hasSelectedExecutableTarget) {
    return false
  }

  return (
    item.targetLedgerId === 'inbox' ||
    item.reviewRequired ||
    targets.length === 0 ||
    targets.every((target) => !target.selected || target.ledgerId === 'inbox')
  )
}

function oldFavoriteAuthorText(item: FavoriteLedgerPreviewItem) {
  return item.author?.trim() || '未知'
}

function oldFavoriteTagsText(item: FavoriteLedgerPreviewItem) {
  return (item.tags ?? []).filter(Boolean).join('、')
}

function oldFavoriteVisibleTagsText(item: FavoriteLedgerPreviewItem) {
  return oldFavoriteTagsText(item) || '未识别到'
}

function deepSeekArchiveMultiLimit(mode: FavoriteArchiveMultiMode): 1 | 2 | 3 {
  if (mode === 'three') return 3
  if (mode === 'two') return 2
  return 1
}

function favoriteArchiveMultiModeLabel(mode: FavoriteArchiveMultiMode) {
  const limit = deepSeekArchiveMultiLimit(mode)
  return limit === 1 ? '单收藏夹' : `最多 ${limit} 个`
}

function emptyDeepSeekNonApplicationCounts(): DeepSeekArchiveNonApplicationCounts {
  return {
    'kept-unclassified': 0,
    'unavailable-target': 0,
    'invalid-result': 0,
    'unmatched-video': 0,
    'request-failed': 0
  }
}

function lowConfidenceDetailText(item: FavoriteLedgerPreviewItem) {
  const diagnostic = item.classificationDiagnostic
  const details = [
    diagnostic?.scoreGap !== undefined
      ? `当前分类比第二候选高 ${diagnostic.scoreGap.toFixed(2)}`
      : null,
    ...(diagnostic?.matchedKeywords ?? []),
    ...(diagnostic?.strongSignals ?? []),
    ...(diagnostic?.weakSignals ?? [])
  ].filter(Boolean)

  return details.length > 0 ? details.join('、') : '暂无更多细节'
}

function classificationConfidenceText(item: FavoriteLedgerPreviewItem) {
  return item.lowConfidence || item.classificationDiagnostic?.lowConfidence
    ? '分类把握：不太稳'
    : '分类把握：比较稳'
}

function deepSeekArchiveProgressPercent(progress: DeepSeekArchiveProgress) {
  if (progress.totalVideos <= 0) {
    return 0
  }
  return Math.min(100, Math.round((progress.completedVideos / progress.totalVideos) * 100))
}

function sameLedgerIds(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false
  }

  const rightIds = new Set(right)
  return left.every((ledgerId) => rightIds.has(ledgerId))
}

function archivePlanTargetChanged(item: FavoriteArchivePlanItemState) {
  return !sameLedgerIds(
    item.originalSuggestedLedgerIds.filter((ledgerId) => ledgerId !== 'inbox' && ledgerId !== 'unclassified'),
    item.currentTargetLedgerIds.filter((ledgerId) => ledgerId !== 'inbox' && ledgerId !== 'unclassified')
  )
}

function executableCorrectionLedgerIds(ledgerIds: string[]) {
  return uniqueLedgerIds(ledgerIds.filter((ledgerId) => ledgerId !== 'inbox' && ledgerId !== 'unclassified'))
}

function buildConfirmedArchiveCorrectionRecords(args: {
  state: FavoriteArchivePlanState
  preview: FavoriteLedgerPreview
  successfulTargetKeys: Set<string>
  confirmedAt: string
}): FavoriteCorrectionRecord[] {
  const records: FavoriteCorrectionRecord[] = []

  for (const planItem of args.state.items) {
    if (!planItem.userModified || !isArchiveAdjustmentRecordableSource(planItem.lastChangeSource)) {
      continue
    }

    const originalLedgerIds = executableCorrectionLedgerIds(planItem.originalSuggestedLedgerIds)
    const selectedLedgerIds = executableCorrectionLedgerIds(planItem.selectedTargetLedgerIds)
    const confirmedSelectedLedgerIds = selectedLedgerIds.filter((ledgerId) =>
      args.successfulTargetKeys.has(
        archivePlanTargetKey({
          aid: planItem.aid,
          sourceFolderTitle: planItem.sourceFolderTitle,
          targetLedgerId: ledgerId
        })
      )
    )

    if (confirmedSelectedLedgerIds.length === 0) {
      continue
    }

    if (sameLedgerIds(originalLedgerIds, confirmedSelectedLedgerIds)) {
      continue
    }

    const previewItem = args.preview.items.find(
      (item) => item.aid === planItem.aid && item.sourceFolderTitle === planItem.sourceFolderTitle
    )
    const diagnostic = previewItem?.classificationDiagnostic
    const draft = createCorrectionDraft({
      aid: planItem.aid,
      title: planItem.title,
      originalLedgerId: originalLedgerIds[0],
      userLedgerIds: confirmedSelectedLedgerIds,
      source: planItem.lastChangeSource === 'deepseek' ? 'deepseek' : 'user',
      feedbackType: 'strong-correction',
      sourceScene: 'archive-preview',
      sourceFolderTitle: planItem.sourceFolderTitle,
      author: previewItem?.author,
      tags: previewItem?.tags ?? [],
      matchedKeywords: diagnostic?.matchedKeywords,
      score: diagnostic?.score,
      confidence: diagnostic?.confidence,
      scoreGap: diagnostic?.scoreGap,
      createdAt: args.confirmedAt
    })

    records.push({
      ...draft,
      confirmedAt: args.confirmedAt
    })
  }

  return records
}

function favoriteLedgerNameForArchiveId(
  ledgerId: string,
  item: FavoriteLedgerPreviewItem,
  ledgers: FavoriteLedger[],
  ledgerNamesById: Record<string, string>
) {
  return (
    targetsForOldFavoriteItem(item).find((target) => target.ledgerId === ledgerId)?.displayName ??
    ledgerNamesById[ledgerId] ??
    ledgers.find((ledger) => ledger.id === ledgerId)?.displayName ??
    '未知收藏夹'
  )
}

function retryJudgmentTargetForOldFavoriteItem(
  item: FavoriteLedgerPreviewItem,
  ledgers: FavoriteLedger[]
): FavoriteLedgerPreviewTarget | null {
  const classification = classifyVideoContent(
    {
      title: item.title,
      author: item.author,
      description: item.description,
      pageText: item.pageText,
      category: item.category,
      tags: item.tags
    },
    ledgers
  )
  if (classification.ledgerId === 'inbox') {
    return null
  }

  const ledger = ledgers.find((candidate) => candidate.id === classification.ledgerId)
  if (!ledger?.enabled) {
    return null
  }
  if (ledger.isDefault && item.candidateTargets?.length) {
    return null
  }

  return {
    ledgerId: ledger.id,
    folderId: ledger.bilibiliFolderId ?? '',
    displayName: ledger.displayName,
    keywords: ledger.keywords,
    ruleType: ledger.ruleType,
    alreadyInTarget: false,
    selected: true
  }
}

function findPreviewItemForArchivePlanItem(
  items: FavoriteLedgerPreviewItem[],
  planItem: FavoriteArchivePlanItemState
) {
  return items.find(
    (item) => item.aid === planItem.aid && item.sourceFolderTitle === planItem.sourceFolderTitle
  )
}

function itemWithArchivePlanTargets(
  item: FavoriteLedgerPreviewItem,
  planItem: FavoriteArchivePlanItemState,
  ledgers: FavoriteLedger[]
) {
  return normalizeOldFavoritePreviewItem(
    {
      ...item,
      originalSuggestedLedgerIds: [...planItem.originalSuggestedLedgerIds],
      currentTargetLedgerIds: [...planItem.currentTargetLedgerIds],
      selectedTargetLedgerIds: [...planItem.selectedTargetLedgerIds],
      targetLedgerId: planItem.currentTargetLedgerIds[0] ?? 'inbox',
      targetFolderId: ledgers.find((ledger) => ledger.id === planItem.currentTargetLedgerIds[0])?.bilibiliFolderId ?? '',
      targetDisplayName:
        ledgers.find((ledger) => ledger.id === planItem.currentTargetLedgerIds[0])?.displayName ??
        item.targetDisplayName,
      selected: planItem.selectedTargetLedgerIds.length > 0
    },
    ledgers
  )
}

function buildOldFavoriteTargetGroups(args: {
  state: FavoriteArchivePlanState | null
  items: FavoriteLedgerPreviewItem[]
  ledgers: FavoriteLedger[]
}): OldFavoriteTargetGroup[] {
  const groups = new Map<string, OldFavoriteTargetGroup>()
  if (!args.state) {
    return []
  }
  for (const planItem of args.state.items) {
    const previewItem = findPreviewItemForArchivePlanItem(args.items, planItem)
    if (!previewItem || previewItem.alreadyInTarget || planItem.currentTargetLedgerIds.length === 0) {
      continue
    }
    const item = itemWithArchivePlanTargets(previewItem, planItem, args.ledgers)

    for (const ledgerId of planItem.currentTargetLedgerIds) {
      const target = {
        ...targetForOldFavoriteLedgerId(item, ledgerId, args.ledgers),
        selected: planItem.selectedTargetLedgerIds.includes(ledgerId)
      }
      if (target.alreadyInTarget) {
        continue
      }

      const group = groups.get(target.ledgerId) ?? {
        ledgerId: target.ledgerId,
        displayName: target.displayName,
        entries: []
      }
      group.entries.push({
        item,
        target,
        selected: planItem.selectedTargetLedgerIds.includes(target.ledgerId),
        changedByDeepSeek: planItem.lastChangeSource === 'deepseek',
        targetChanged: archivePlanTargetChanged(planItem)
      })
      groups.set(target.ledgerId, group)
    }
  }

  return Array.from(groups.values())
}

function toSelectedOldFavoritePlanItem(
  item: FavoriteLedgerPreviewItem,
  target: FavoriteLedgerPreviewTarget
): FavoriteLedgerPreviewItem {
  const planItem: FavoriteLedgerPreviewItem = {
    ...item,
    targetLedgerId: target.ledgerId,
    targetFolderId: target.folderId,
    targetDisplayName: target.displayName,
    alreadyInTarget: target.alreadyInTarget,
    selected: true,
    reviewRequired: false
  }
  delete planItem.targets
  if (target.selectedCandidateTarget) {
    planItem.selectedCandidateTarget = target.selectedCandidateTarget
  } else {
    delete planItem.selectedCandidateTarget
  }
  const publicPlanItem = planItem as Partial<FavoriteLedgerPreviewItem>
  delete publicPlanItem.originalSuggestedLedgerIds
  delete publicPlanItem.currentTargetLedgerIds
  delete publicPlanItem.selectedTargetLedgerIds
  delete publicPlanItem.lowConfidence
  return planItem
}

function buildSelectedOldFavoritePlanItems(args: {
  state: FavoriteArchivePlanState | null
  items: FavoriteLedgerPreviewItem[]
  ledgers: FavoriteLedger[]
}): FavoriteLedgerPreviewItem[] {
  const planItems: FavoriteLedgerPreviewItem[] = []
  if (!args.state) {
    return planItems
  }

  const addedKeys = new Set<string>()
  for (const executableItem of buildExecutableArchivePlan(args.state, args.ledgers, { requireFolderId: false })) {
    const planItem = args.state.items.find(
      (item) => item.aid === executableItem.aid && item.sourceFolderTitle === executableItem.sourceFolderTitle
    )
    const previewItem = planItem ? findPreviewItemForArchivePlanItem(args.items, planItem) : undefined
    if (!planItem || !previewItem || previewItem.alreadyInTarget) {
      continue
    }

    const itemWithPlan = itemWithArchivePlanTargets(previewItem, planItem, args.ledgers)
    const target = {
      ...targetForOldFavoriteLedgerId(itemWithPlan, executableItem.targetLedgerId, args.ledgers),
      folderId: executableItem.targetFolderId,
      selected: true
    }
    const key = `${executableItem.sourceFolderTitle}:${executableItem.aid}:${executableItem.targetLedgerId}`
    addedKeys.add(key)
    planItems.push(toSelectedOldFavoritePlanItem(itemWithPlan, target))
  }

  for (const planItem of args.state.items) {
    const previewItem = findPreviewItemForArchivePlanItem(args.items, planItem)
    if (!previewItem || previewItem.alreadyInTarget) {
      continue
    }
    const itemWithPlan = itemWithArchivePlanTargets(previewItem, planItem, args.ledgers)

    for (const ledgerId of planItem.selectedTargetLedgerIds) {
      const key = `${planItem.sourceFolderTitle}:${planItem.aid}:${ledgerId}`
      if (addedKeys.has(key)) {
        continue
      }
      const target = targetForOldFavoriteLedgerId(itemWithPlan, ledgerId, args.ledgers)
      if (target.ledgerId === 'inbox' || target.selectedCandidateTarget) {
        planItems.push(toSelectedOldFavoritePlanItem(itemWithPlan, target))
      }
    }
  }

  const regularItems: FavoriteLedgerPreviewItem[] = []
  const protectedItems = new Map<string, FavoriteLedgerPreviewItem>()
  for (const item of planItems) {
    if (!item.reorganizeProtected) {
      regularItems.push(item)
      continue
    }

    const key = archivePlanItemKey(item)
    const existing = protectedItems.get(key)
    const desiredTargetFolderIds = uniqueLedgerIds([
      ...(existing?.desiredTargetFolderIds ?? []),
      item.targetFolderId
    ])
    const desiredTargetLedgerIds = uniqueLedgerIds([
      ...(existing?.desiredTargetLedgerIds ?? []),
      item.targetLedgerId
    ])
    protectedItems.set(key, {
      ...(existing ?? item),
      desiredTargetFolderIds,
      desiredTargetLedgerIds,
      currentBilimiFolderIds: item.currentBilimiFolderIds ?? [],
      reorganizeProtected: true
    })
  }

  return [...regularItems, ...protectedItems.values()]
}

function buildConfirmedArchiveProtectionRecords(args: {
  accountMid: string
  selectedItems: FavoriteLedgerPreviewItem[]
  results: OldFavoriteExecutionResult[]
  confirmedAt: string
}): FavoriteArchiveProtectionRecord[] {
  if (!args.accountMid) {
    return []
  }

  const selectedByAid = new Map<number, FavoriteLedgerPreviewItem[]>()
  for (const item of args.selectedItems) {
    selectedByAid.set(item.aid, [...(selectedByAid.get(item.aid) ?? []), item])
  }

  const completedItems = args.results.flatMap((result) => result.completedItems ?? [])

  const records: FavoriteArchiveProtectionRecord[] = []
  for (const [aid, items] of selectedByAid) {
    const completedForAid = completedItems.filter((item) => item.aid === aid)
    const reorganizedItem = items.find((item) => item.reorganizeProtected)
    const allTargetsCompleted = reorganizedItem
      ? completedForAid.some((item) => (item.finalFolderIds ?? []).length > 0)
      : items.every((selectedItem) => completedForAid.some((completedItem) =>
          completedItem.targetLedgerId === selectedItem.targetLedgerId
        ))
    if (!allTargetsCompleted) continue
    const targetFolderIds = uniqueLedgerIds(
      reorganizedItem
        ? completedForAid.flatMap((item) => item.finalFolderIds ?? item.desiredTargetFolderIds ?? [])
        : completedForAid.flatMap((item) => item.targetFolderId ? [item.targetFolderId] : [])
    )
    const targetLedgerIds = uniqueLedgerIds(
      reorganizedItem
        ? items.flatMap((item) => item.desiredTargetLedgerIds ?? [])
        : items.map((item) => item.targetLedgerId)
    )
    if (targetFolderIds.length === 0 || targetLedgerIds.length === 0) {
      continue
    }

    records.push({
      accountMid: args.accountMid,
      aid,
      targetLedgerIds,
      targetFolderIds,
      completedAt: args.confirmedAt
    })
  }

  return records
}

function randomDelayMs(range: { min: number; max: number }) {
  const min = Math.max(0, range.min)
  const max = Math.max(min, range.max)
  return Math.round(min + Math.random() * (max - min))
}

function wait(delayMs: number) {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

export async function waitForOldFavoriteExecutionDelay(
  delayMs: number,
  shouldStop: () => boolean
): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, delayMs)
  while (Date.now() < deadline) {
    if (shouldStop()) return false
    const remainingMs = deadline - Date.now()
    const sliceMs = Math.min(50, remainingMs)
    await wait(sliceMs)
  }
  return !shouldStop()
}

function oldFavoriteScanFailureCodeDetail(failure: OldFavoriteScanFailureSummary) {
  const codes = [
    failure.httpStatus ? `HTTP ${failure.httpStatus}` : '',
    Number.isFinite(failure.apiCode) ? `错误码 ${failure.apiCode}` : '',
    failure.errorKind ? `类型 ${failure.errorKind}` : ''
  ].filter(Boolean)
  return codes.length > 0 ? codes.join('，') : '未返回错误码'
}

async function paceOldFavoriteExecution(
  completedCount: number,
  hasNextItem: boolean,
  shouldStop: () => boolean
) {
  if (!hasNextItem || completedCount <= 0) {
    return !shouldStop()
  }

  const pacing = oldFavoriteExecutionPacingFor(completedCount)
  const delayMs = randomDelayMs(pacing.delayMs)
  if (delayMs <= 0 || process.env.NODE_ENV === 'test') {
    return !shouldStop()
  }

  return waitForOldFavoriteExecutionDelay(delayMs, shouldStop)
}

export function oldFavoriteExecutionPacingFor(completedCount: number): {
  delayMs: { min: number; max: number }
  kind: 'pace' | 'cooldown'
} {
  const accelerated = completedCount > OLD_FAVORITE_ACCELERATED_AFTER
  const cooldownEvery = accelerated
    ? OLD_FAVORITE_ACCELERATED_COOLDOWN_EVERY
    : OLD_FAVORITE_COOLDOWN_EVERY
  const cooldown = completedCount > 0 && completedCount % cooldownEvery === 0

  if (cooldown) {
    return {
      delayMs: accelerated
        ? OLD_FAVORITE_ACCELERATED_COOLDOWN_DELAY_MS
        : OLD_FAVORITE_COOLDOWN_DELAY_MS,
      kind: 'cooldown'
    }
  }

  return {
    delayMs: accelerated
      ? OLD_FAVORITE_ACCELERATED_APPEND_DELAY_MS
      : OLD_FAVORITE_APPEND_DELAY_MS,
    kind: 'pace'
  }
}

function groupOldFavoriteExecutionItems(items: FavoriteLedgerPreviewItem[]) {
  const groups: FavoriteLedgerPreviewItem[][] = []
  const groupByAid = new Map<number, FavoriteLedgerPreviewItem[]>()
  for (const item of items) {
    const group = groupByAid.get(item.aid)
    if (group) {
      group.push(item)
    } else {
      const nextGroup = [item]
      groupByAid.set(item.aid, nextGroup)
      groups.push(nextGroup)
    }
  }
  return groups
}

function oldFavoriteResultIsRiskStop(result: OldFavoriteExecutionResult) {
  return Boolean(
    result.paused && (
      result.missingTargets?.includes('favorite-ledger-protection') ||
      result.steps?.some((step) => step.includes('protection-paused')) ||
      /-509|-352|http\s*412|captcha|verify|risk|风控|访问受限|request too fast/i.test(result.message ?? '')
    )
  )
}

export function FavoriteLedgerPanel({
  currentAccountMid,
  ledgers,
  missingLedgerIds,
  onSaveLedgers,
  onOpenFavoritePage,
  onScanOldFavorites,
  onReadCurrentOldFavoriteAccount,
  onReadOldFavoriteBatchStatus,
  onPrepareOldFavoriteScan,
  onReadOldFavoriteTagEnrichment,
  onExecuteOldFavoritePlan,
  onOldFavoriteExecutionStateChange,
  onOldFavoriteStatusUpdate,
  onOldFavoriteStageFeedback,
  onOldFavoriteAcknowledged,
  onOpenOldFavoriteVideo,
  onRejudgeOldFavorite,
  deepSeekArchiveAvailable = false,
  onOrganizeOldFavoritesWithDeepSeek,
  onDeepSeekArchiveKeywordSuggestions,
  onOpenDeepSeekSuggestions,
  onConfirmArchiveCorrections,
  onConfirmArchiveProtections,
  favoriteArchiveMultiMode = 'off',
  organizeOldFavoritesRequestSignal = 0
}: FavoriteLedgerPanelProps) {
  const oldFavoriteWorkspace = useOldFavoriteWorkspace(currentAccountMid)
  const useControlledOldFavoriteWorkspace = oldFavoriteWorkspace.available
  const [archiveEditorState, setArchiveEditorState] = useOldFavoriteRuntimeState<ArchiveEditorRuntimeState>(
    'archiveEditorState',
    () => ({
      archivePlanState: getOldFavoriteRuntimeValue<FavoriteArchivePlanState | null>('archivePlanState', null),
      selectedCandidateKeys: [
        ...getOldFavoriteRuntimeValue<Set<string>>('selectedCandidateKeys', new Set())
      ],
      draftLedgers: getOldFavoriteRuntimeValue<FavoriteLedger[]>(
        'draftLedgers',
        ledgers.map(cloneArchiveDraftLedger)
      ).map(cloneArchiveDraftLedger),
      candidateSourceLedgerIdsByItemKey: getOldFavoriteRuntimeValue<
        FavoriteArchiveTransactionState['candidateSourceLedgerIdsByItemKey']
      >('candidateSourceLedgerIdsByItemKey', {})
    })
  )
  const draftLedgers = Array.isArray(archiveEditorState?.draftLedgers)
    ? archiveEditorState.draftLedgers
    : ledgers.map(cloneArchiveDraftLedger)
  const selectedCandidateKeys = useMemo(
    () => new Set(archiveEditorState.selectedCandidateKeys),
    [archiveEditorState.selectedCandidateKeys]
  )
  const archivePlanState = archiveEditorState.archivePlanState
  const candidateSourceLedgerIdsByItemKey = archiveEditorState.candidateSourceLedgerIdsByItemKey
  const setDraftLedgers = useCallback<Dispatch<SetStateAction<FavoriteLedger[]>>>((nextValue) => {
    setArchiveEditorState((current) => {
      const nextDraftLedgers = typeof nextValue === 'function'
        ? nextValue(current.draftLedgers)
        : nextValue
      return JSON.stringify(nextDraftLedgers) === JSON.stringify(current.draftLedgers)
        ? current
        : { ...current, draftLedgers: nextDraftLedgers }
    })
  }, [setArchiveEditorState])
  const setSelectedCandidateKeys = useCallback<Dispatch<SetStateAction<Set<string>>>>((nextValue) => {
    setArchiveEditorState((current) => {
      const currentKeys = new Set(current.selectedCandidateKeys)
      const nextKeys = typeof nextValue === 'function' ? nextValue(currentKeys) : nextValue
      return { ...current, selectedCandidateKeys: [...nextKeys] }
    })
  }, [setArchiveEditorState])
  const setArchivePlanState = useCallback<Dispatch<SetStateAction<FavoriteArchivePlanState | null>>>((nextValue) => {
    setArchiveEditorState((current) => ({
      ...current,
      archivePlanState: typeof nextValue === 'function' ? nextValue(current.archivePlanState) : nextValue
    }))
  }, [setArchiveEditorState])
  const setCandidateSourceLedgerIdsByItemKey = useCallback<Dispatch<SetStateAction<FavoriteArchiveTransactionState['candidateSourceLedgerIdsByItemKey']>>>((nextValue) => {
    setArchiveEditorState((current) => ({
      ...current,
      candidateSourceLedgerIdsByItemKey: typeof nextValue === 'function'
        ? nextValue(current.candidateSourceLedgerIdsByItemKey)
        : nextValue
    }))
  }, [setArchiveEditorState])
  const [activeLedgerId, setActiveLedgerId] = useState<string | null>(null)
  const [activeLedgerIndex, setActiveLedgerIndex] = useState<number | null>(null)
  const [, setActiveLedgerSavedSnapshot] =
    useState<ReturnType<typeof ledgerEditorSnapshot> | null>(null)
  const [savedLedgerSnapshots, setSavedLedgerSnapshots] = useState<Record<string, ReturnType<typeof ledgerEditorSnapshot>>>(() =>
    Object.fromEntries(ledgers.map((ledger, index) => [ledgerDraftKey(ledger, index, ledgers), ledgerEditorSnapshot(ledger)]))
  )
  const [hasPendingOldFavoriteBatch, setHasPendingOldFavoriteBatch] = useState(false)
  const [preview, setPreview] = useOldFavoriteRuntimeState<FavoriteLedgerPreview | null>('preview', null)
  const [scanProgress] = useOldFavoriteRuntimeState<FavoriteLedgerPreview['scanProgress']>(
    'scanProgress',
    () => getOldFavoriteRuntimeValue<FavoriteLedgerPreview | null>('preview', null)?.scanProgress
  )
  const scanProgressRef = useRef(scanProgress)
  scanProgressRef.current = scanProgress
  const setScanProgress = useCallback((next: FavoriteLedgerPreview['scanProgress']) => {
    if (next === undefined) {
      setOldFavoriteRuntimeValue('scanProgress', undefined)
      return
    }
    setOldFavoriteTransientRuntimeValue('scanProgress', next)
  }, [])
  const [baseScanPreview, setBaseScanPreview] =
    useOldFavoriteRuntimeState<FavoriteLedgerPreview | null>('baseScanPreview', null)
  const [reorganizedProtectedAids, setReorganizedProtectedAids] =
    useOldFavoriteRuntimeState<Set<number>>('reorganizedProtectedAids', () => new Set())
  const [protectedReorganizationConfirming, setProtectedReorganizationConfirming] = useState(false)
  const [abnormalProtectionReorganizationConfirming, setAbnormalProtectionReorganizationConfirming] = useState(false)
  const [selectedDefaultLedgerIds, setSelectedDefaultLedgerIds] = useState<Set<string>>(
    () => new Set(ledgers.filter((ledger) => ledger.enabled && ledger.isDefault).map((ledger) => ledger.id))
  )
  const [pendingUnclassifiedDecision, setPendingUnclassifiedDecision] =
    useState<PendingUnclassifiedDecision | null>(null)
  const [selectedOldFavoriteSourceFolderKeys, setSelectedOldFavoriteSourceFolderKeys] =
    useOldFavoriteRuntimeState<Set<string>>('selectedOldFavoriteSourceFolderTitles', () => new Set())
  const [unlockedManagedLogicalIds, setUnlockedManagedLogicalIds] =
    useOldFavoriteRuntimeState<Set<string>>('unlockedManagedLogicalIds', () => new Set())
  const [selectedManagedLogicalIds, setSelectedManagedLogicalIds] =
    useOldFavoriteRuntimeState<Set<string>>('selectedManagedLogicalIds', () => new Set())
  const [oldFavoriteExecutionProgress, setOldFavoriteExecutionProgress] =
    useOldFavoriteRuntimeState<{
      completed: number
      total: number
    } | null>('oldFavoriteExecutionProgress', null)
  const [oldFavoriteExpandedStep, setOldFavoriteExpandedStep] = useState<OldFavoriteGuideStep | null>(() => {
    const restoredExecutionPhase = getOldFavoriteRuntimeValue<OldFavoriteExecutionPhase>(
      'oldFavoriteExecutionPhase',
      'idle'
    )
    if (restoredExecutionPhase !== 'idle') return 'confirm'
    return getOldFavoriteRuntimeValue('deepSeekArchiveRunning', false) &&
      getOldFavoriteRuntimeValue<OldFavoriteGuideStep>('oldFavoriteStep', 'scan') === 'preview'
      ? 'preview'
      : 'scan'
  })
  const [deepSeekArchiveMode, setDeepSeekArchiveMode] = useOldFavoriteRuntimeState<DeepSeekArchiveMode>(
    'deepSeekArchiveMode',
    'low-confidence-and-unclassified'
  )
  const [deepSeekSegmentScope, setDeepSeekSegmentScope] = useOldFavoriteRuntimeState<DeepSeekSegmentScope>(
    'deepSeekArchiveSegmentScope',
    'current-segment'
  )
  const [deepSeekArchiveScopeOpen, setDeepSeekArchiveScopeOpen] = useState(false)
  const [deepSeekArchiveScopeMenu, setDeepSeekArchiveScopeMenu] = useState<'processing' | 'segment'>('processing')
  const [deepSeekArchiveRunning, setDeepSeekArchiveRunning] =
    useOldFavoriteRuntimeState('deepSeekArchiveRunning', false)
  const [deepSeekArchiveCancelRequested, setDeepSeekArchiveCancelRequested] =
    useOldFavoriteRuntimeState('deepSeekArchiveCancelRequested', false)
  const [deepSeekArchiveStatus, setDeepSeekArchiveStatus] =
    useOldFavoriteRuntimeState('deepSeekArchiveStatus', '')
  const [deepSeekArchiveResultSummary, setDeepSeekArchiveResultSummary] =
    useOldFavoriteRuntimeState<DeepSeekArchiveResultSummary | null>('deepSeekArchiveResultSummary', null)
  const [deepSeekArchiveSummaryOpen, setDeepSeekArchiveSummaryOpen] = useState(false)
  const [deepSeekArchiveSuggestionCount, setDeepSeekArchiveSuggestionCount] =
    useOldFavoriteRuntimeState('deepSeekArchiveSuggestionCount', 0)
  const [deepSeekArchiveProgress, setDeepSeekArchiveProgress] =
    useOldFavoriteRuntimeState<DeepSeekArchiveProgress | null>('deepSeekArchiveProgress', null)
  const [archiveBatchOperationProgress, setArchiveBatchOperationProgress] =
    useState<ArchiveBatchOperationProgress | null>(null)
  const archiveBatchCompletionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const archiveBatchRunning = archiveBatchOperationProgress?.phase === 'running'
  const [oldFavoriteRuntimeStatus, setOldFavoriteRuntimeStatus] =
    useOldFavoriteRuntimeState<OldFavoriteStatusSnapshot | null>('oldFavoriteRuntimeStatus', null)
  const [archivePreviewAlertMessages, setArchivePreviewAlertMessages] =
    useOldFavoriteRuntimeState<string[]>('archivePreviewAlertMessages', [])
  const [deepSeekArchiveRunSnapshot, setDeepSeekArchiveRunSnapshot] =
    useOldFavoriteRuntimeState<DeepSeekArchiveRunSnapshot | null>('deepSeekArchiveRunSnapshot', null)
  const [archiveUndoStack, setArchiveUndoStack] =
    useOldFavoriteRuntimeState<ArchivePreviewHistorySnapshot[]>('archiveUndoStack', [])
  const [archiveRedoStack, setArchiveRedoStack] =
    useOldFavoriteRuntimeState<ArchivePreviewHistorySnapshot[]>('archiveRedoStack', [])
  const [archiveUndoChanges, setArchiveUndoChanges] =
    useOldFavoriteRuntimeState<ArchivePreviewLatestChange[]>('archiveUndoChanges', [])
  const [archiveRedoChanges, setArchiveRedoChanges] =
    useOldFavoriteRuntimeState<ArchivePreviewLatestChange[]>('archiveRedoChanges', [])
  const [latestArchiveChange, setLatestArchiveChange] =
    useOldFavoriteRuntimeState<ArchivePreviewLatestChange | null>('latestArchiveChange', null)
  const [archiveHistoryOpen, setArchiveHistoryOpen] = useState(false)
  const [manualArchiveMoveFocus, setManualArchiveMoveFocus] =
    useState<ArchivePreviewManualMoveFocus | null>(null)
  const archivePlanItemIndexByKey = useMemo(() => {
    const indexes = new Map<string, number>()
    for (let index = 0; index < (archivePlanState?.items.length ?? 0); index += 1) {
      indexes.set(archivePlanState!.items[index].itemKey, index)
    }
    return indexes
  }, [archivePlanState?.originalItemsByKey])

  function clearDeepSeekArchiveRunSnapshot(options: { resetHistory?: boolean } = {}) {
    setDeepSeekArchiveRunSnapshot(null)
    setArchivePreviewAlertMessages([])
    setDeepSeekArchiveProgress(null)
    if (options.resetHistory) {
      setArchiveUndoStack([])
      setArchiveRedoStack([])
      setArchiveUndoChanges([])
      setArchiveRedoChanges([])
      setLatestArchiveChange(null)
    }
  }

  function cloneArchiveDraftLedger(ledger: FavoriteLedger): FavoriteLedger {
    return {
      ...ledger,
      keywords: [...ledger.keywords]
    }
  }

  function createArchivePreviewHistorySnapshot(
    state: FavoriteArchivePlanState,
    values: {
      selectedCandidateKeys?: Iterable<string>
      draftLedgers?: FavoriteLedger[]
      candidateSourceLedgerIdsByItemKey?: FavoriteArchiveTransactionState['candidateSourceLedgerIdsByItemKey']
    } = {}
  ): ArchivePreviewHistorySnapshot {
    return {
      kind: 'full',
      archivePlanState: createDeepSeekArchiveSnapshot(state),
      selectedCandidateKeys: [...(values.selectedCandidateKeys ?? selectedCandidateKeys)],
      draftLedgers: (values.draftLedgers ?? draftLedgers).map(cloneArchiveDraftLedger),
      candidateSourceLedgerIdsByItemKey: structuredClone(
        values.candidateSourceLedgerIdsByItemKey ?? candidateSourceLedgerIdsByItemKey
      )
    }
  }

  async function yieldArchiveBatchFrame() {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }

  function finishArchiveBatchOperation(total: number) {
    setArchiveBatchOperationProgress({ phase: 'success', completed: total, total })
    if (archiveBatchCompletionTimerRef.current) {
      clearTimeout(archiveBatchCompletionTimerRef.current)
    }
    archiveBatchCompletionTimerRef.current = setTimeout(() => {
      setArchiveBatchOperationProgress(null)
      archiveBatchCompletionTimerRef.current = null
    }, 3000)
  }

  function restoreArchivePreviewHistorySnapshot(snapshot: ArchivePreviewHistorySnapshot) {
    if (snapshot.kind === 'item') {
      if (!archivePlanState) return archivePlanState
      const restoredState = applyArchivePreviewHistorySnapshotToPlan(
        archivePlanState,
        snapshot,
        archivePlanItemIndexByKey.get(snapshot.itemKey)
      )
      setArchivePlanState(restoredState)
      return restoredState
    }
    const restoredState = revertDeepSeekArchiveRun(
      archivePlanState ?? snapshot.archivePlanState,
      snapshot.archivePlanState
    )
    updatePreviewFromArchivePlan(restoredState, snapshot.draftLedgers)
    setArchiveEditorState({
      archivePlanState: restoredState,
      selectedCandidateKeys: [...snapshot.selectedCandidateKeys],
      draftLedgers: snapshot.draftLedgers.map(cloneArchiveDraftLedger),
      candidateSourceLedgerIdsByItemKey: structuredClone(
        snapshot.candidateSourceLedgerIdsByItemKey ?? {}
      )
    })
    return restoredState
  }

  function createReciprocalArchivePreviewHistorySnapshot(
    snapshot: ArchivePreviewHistorySnapshot,
    state: FavoriteArchivePlanState,
    values?: Parameters<typeof createArchivePreviewHistorySnapshot>[1]
  ): ArchivePreviewHistorySnapshot {
    if (snapshot.kind !== 'item') return createArchivePreviewHistorySnapshot(state, values)
    const itemIndex = archivePlanItemIndexByKey.get(snapshot.itemKey)
    const item = itemIndex === undefined ? undefined : state.items[itemIndex]
    return item?.itemKey === snapshot.itemKey
      ? createArchivePreviewItemHistorySnapshot(item)
      : createArchivePreviewHistorySnapshot(state, values)
  }

  function applyArchivePreviewHistorySnapshotToEditor(
    editor: ArchiveEditorRuntimeState,
    snapshot: ArchivePreviewHistorySnapshot
  ): ArchiveEditorRuntimeState {
    if (snapshot.kind === 'item') {
      return editor.archivePlanState
        ? {
            ...editor,
            archivePlanState: applyArchivePreviewHistorySnapshotToPlan(
              editor.archivePlanState,
              snapshot,
              archivePlanItemIndexByKey.get(snapshot.itemKey)
            )
          }
        : editor
    }
    return {
      archivePlanState: revertDeepSeekArchiveRun(
        editor.archivePlanState ?? snapshot.archivePlanState,
        snapshot.archivePlanState
      ),
      selectedCandidateKeys: [...snapshot.selectedCandidateKeys],
      draftLedgers: snapshot.draftLedgers.map(cloneArchiveDraftLedger),
      candidateSourceLedgerIdsByItemKey: structuredClone(
        snapshot.candidateSourceLedgerIdsByItemKey ?? {}
      )
    }
  }

  function recordArchivePreviewHistory(
    state: FavoriteArchivePlanState,
    change: ArchivePreviewLatestChange,
    values?: Parameters<typeof createArchivePreviewHistorySnapshot>[1],
    itemSnapshot?: FavoriteArchivePlanItemState
  ) {
    setArchiveUndoStack((current) => [
      ...current,
      itemSnapshot
        ? createArchivePreviewItemHistorySnapshot(itemSnapshot)
        : createArchivePreviewHistorySnapshot(state, values)
    ])
    setArchiveRedoStack([])
    setArchiveUndoChanges((current) => [...current, change])
    setArchiveRedoChanges([])
    if (!activeOldFavoriteUserBatch || activeOldFavoriteUserBatch.status === 'ended') return
    window.bilimiDesktop?.markOldFavoriteWorkspaceOverlayDirty?.()
    for (const item of Object.values(change.itemChanges)) {
      const kind = item.source === 'deepseek' ? 'deepseek' : 'user'
      workspaceOverlayQueueRef.current.enqueue(
        activeOldFavoriteUserBatch.accountMid,
        activeOldFavoriteUserBatch.id,
        kind,
        {
          aid: item.aid,
          currentTargetLedgerIds: item.currentTargetLedgerIds,
          selectedTargetLedgerIds: item.selectedTargetLedgerIds,
          userModified: true,
          lastChangeSource: item.source
        }
      )
    }
    if (workspaceOverlayTimerRef.current) clearTimeout(workspaceOverlayTimerRef.current)
    workspaceOverlayTimerRef.current = setTimeout(() => {
      workspaceOverlayTimerRef.current = null
      void flushWorkspaceOverlayQueue(
        activeOldFavoriteUserBatch.accountMid,
        activeOldFavoriteUserBatch.id
      ).catch((error) => {
        setStatus(`整理修改保存失败：${error instanceof Error ? error.message : String(error)}`)
      })
    }, 100)
  }
  const [oldFavoriteExecutionPhase, setOldFavoriteExecutionPhase] =
    useOldFavoriteRuntimeState<OldFavoriteExecutionPhase>('oldFavoriteExecutionPhase', 'idle')
  const oldFavoriteExecuting =
    oldFavoriteExecutionPhase === 'preparing' ||
    oldFavoriteExecutionPhase === 'running' ||
    oldFavoriteExecutionPhase === 'pausing'
  const oldFavoriteExecutionPaused = oldFavoriteExecutionPhase === 'paused'
  const oldFavoriteExecutionRiskStopped = oldFavoriteExecutionPhase === 'risk-stopped'
  const oldFavoriteExecutionAwaitingAcknowledgement =
    oldFavoriteExecutionPhase === 'awaiting-acknowledgement' || oldFavoriteExecutionRiskStopped
  const [oldFavoriteExecutionRun, setOldFavoriteExecutionRun] =
    useOldFavoriteRuntimeState<OldFavoriteExecutionRun | null>('oldFavoriteExecutionRun', null)
  const workspaceOverlayQueueRef = useRef(new OldFavoriteOverlayQueue(
    async (accountMid, batchId, kind, patches) => {
      if (!window.bilimiDesktop) return
      if (!window.bilimiDesktop.patchOldFavoriteWorkspaceOverlay) throw new Error('桌面存储接口不可用。')
      await window.bilimiDesktop.patchOldFavoriteWorkspaceOverlay(
        accountMid, batchId, kind, patches
      )
    }
  ))
  async function flushWorkspaceOverlayQueue(accountMid?: string, batchId?: string) {
    await workspaceOverlayQueueRef.current.flush(accountMid, batchId)
    if (!workspaceOverlayQueueRef.current.hasPending()) {
      window.bilimiDesktop?.markOldFavoriteWorkspaceOverlayClean?.()
    }
  }
  const workspaceOverlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (workspaceOverlayTimerRef.current) clearTimeout(workspaceOverlayTimerRef.current)
    void flushWorkspaceOverlayQueue().catch(() => undefined)
  }, [])
  useEffect(() => window.bilimiDesktop?.onOldFavoriteWorkspaceFlushRequested?.(async () => {
    if (workspaceOverlayTimerRef.current) {
      clearTimeout(workspaceOverlayTimerRef.current)
      workspaceOverlayTimerRef.current = null
    }
    await flushWorkspaceOverlayQueue()
  }), [])
  const [oldFavoriteExecutionConfirming, setOldFavoriteExecutionConfirming] = useState(false)
  const [continuousOldFavoriteExecution, setContinuousOldFavoriteExecution] = useState(false)
  const [oldFavoriteExecutionStopping, setOldFavoriteExecutionStopping] = useState(false)
  const oldFavoriteExecutionStopRequestedRef = useRef(false)
  const [batchDiscardConfirming, setBatchDiscardConfirming] = useState(false)
  const [pausedRoundEndConfirming, setPausedRoundEndConfirming] = useState(false)
  const [pendingTagDeepSeekConfirming, setPendingTagDeepSeekConfirming] = useState<number | null>(null)
  const [archiveMultiModeChange, setArchiveMultiModeChange] =
    useOldFavoriteRuntimeState<ArchiveMultiModeChange | null>('archiveMultiModeChange', null)
  const [status, setStatus] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const oldFavoriteSourceSelectAllRef = useRef<HTMLInputElement>(null)
  const [basicScanRunning, setBasicScanRunning] = useState(false)
  const scanGenerationRef = useRef(0)
  const scanStartingRef = useRef(false)
  const currentScanRunIdRef = useRef<string | null>(null)
  const currentScanAccountMidRef = useRef<string | null>(null)
  const currentScanSessionRef = useRef<{ batchId: string; kind: 'full' | 'incremental' } | null>(null)
  const currentScanWorkspaceRef = useRef<{ accountMid: string; batchId: string } | null>(null)
  const currentScanInitialFullRef = useRef(false)
  const accountGenerationRef = useRef(0)
  const lastSuccessfulPreviewRef = useRef<FavoriteLedgerPreview | null>(null)
  const lastSuccessfulBasePreviewRef = useRef<FavoriteLedgerPreview | null>(null)
  const lastSuccessfulArchivePlanStateRef = useRef<FavoriteArchivePlanState | null>(null)
  const latestTagEnrichmentSnapshotRef = useRef<OldFavoriteTagEnrichmentSnapshot | null>(null)
  const appliedStreamingSegmentIndexesRef = useRef(new Set<number>())
  const appliedStreamingSourceRelationsRef = useRef(new Set<string>())
  const persistedStreamingSegmentIndexesRef = useRef(new Set<number>())
  const persistedStreamingAidsRef = useRef(new Set<number>())
  const streamingWorkspaceWriteTailRef = useRef<Promise<void>>(Promise.resolve())
  const [draggedLedgerKey, setDraggedLedgerKey] = useState<string | null>(null)
  const [dragTargetLedgerKey, setDragTargetLedgerKey] = useState<string | null>(null)
  const [ledgerListExpanded, setLedgerListExpanded] =
    useOldFavoriteRuntimeState('ledgerListExpanded', false)
  const [oldFavoriteStep, setOldFavoriteStep] =
    useOldFavoriteRuntimeState<OldFavoriteGuideStep>('oldFavoriteStep', 'scan')
  const [oldFavoriteGuideMode, setOldFavoriteGuideMode] =
    useOldFavoriteRuntimeState<OldFavoriteGuideMode>('oldFavoriteGuideMode', 'organize')
  const [oldFavoriteUserBatches, setOldFavoriteUserBatches] =
    useOldFavoriteRuntimeState<OldFavoriteUserBatchSummary[]>('oldFavoriteUserBatches', [])
  const oldFavoriteUserBatchesRef = useRef(oldFavoriteUserBatches)
  oldFavoriteUserBatchesRef.current = oldFavoriteUserBatches
  const [activeOldFavoriteUserBatchId, setActiveOldFavoriteUserBatchId] =
    useOldFavoriteRuntimeState('activeOldFavoriteUserBatchId', '')
  const [pendingOldFavoriteBatchKind, setPendingOldFavoriteBatchKind] =
    useOldFavoriteRuntimeState<'full' | 'incremental'>('pendingOldFavoriteBatchKind', 'full')
  const [oldFavoriteExternalLeaseActive, setOldFavoriteExternalLeaseActive] = useState(false)
  const [oldFavoriteEntryOpen, setOldFavoriteEntryOpen] = useState(false)
  const [oldFavoriteResetConfirmOpen, setOldFavoriteResetConfirmOpen] = useState(false)
  const [oldFavoriteResetRunning, setOldFavoriteResetRunning] = useState(false)
  const [ledgerResetConfirmOpen, setLedgerResetConfirmOpen] = useState(false)
  const [tagEndConfirmOpen, setTagEndConfirmOpen] = useState(false)
  const [oldFavoriteSessionsOpened, setOldFavoriteSessionsOpened] = useState(false)
  const [oldFavoriteRecoveryRunning, setOldFavoriteRecoveryRunning] = useState(false)
  const [oldFavoriteRecoveryFailure, setOldFavoriteRecoveryFailure] = useState<string | null>(null)
  const [oldFavoriteRecoveryResetConfirmOpen, setOldFavoriteRecoveryResetConfirmOpen] = useState(false)
  const [tagActionRunning, setTagActionRunning] = useState<'pause' | 'resume' | 'cancel' | null>(null)
  const tagActionTokenRef = useRef(0)
  const terminalTagScanGenerationRef = useRef<number | null>(null)
  const oldFavoriteSessionsOpeningRef = useRef<Promise<OldFavoriteSessionsState> | null>(null)
  const oldFavoriteOrganizationRequestRef = useRef<Promise<void> | null>(null)
  const oldFavoriteResetRequestRef = useRef<Promise<void> | null>(null)
  const oldFavoriteResetRunningRef = useRef(false)
  const oldFavoriteActivatedRef = useRef(false)
  const oldFavoriteBatchSelectionGenerationRef = useRef(0)
  const oldFavoriteIgnoredSessionBatchIdsRef = useRef(new Map<string, Set<string>>())
  const oldFavoriteResolvedAccountMidRef = useRef(currentAccountMid?.trim() ?? '')
  const oldFavoriteReconciliationByAccountRef = useRef(new Map<string, boolean>())
  function setOldFavoriteReconciliationRequired(accountMid: string, required: boolean) {
    const normalizedAccountMid = accountMid.trim()
    if (!normalizedAccountMid) return
    if (required) oldFavoriteReconciliationByAccountRef.current.set(normalizedAccountMid, true)
    else oldFavoriteReconciliationByAccountRef.current.delete(normalizedAccountMid)
    if (oldFavoriteResolvedAccountMidRef.current === normalizedAccountMid) {
      setOldFavoriteRuntimeValue('oldFavoriteRecoveryRequiresReconciliation', required)
    }
  }
  const sessionCoordinator = useMemo(() => {
    const desktop = window.bilimiDesktop
    if (!desktop?.loadOldFavoriteSessions || !desktop.saveOldFavoriteSessions ||
      !desktop.claimOldFavoriteTaskLease || !desktop.releaseOldFavoriteTaskLease ||
      !desktop.onOldFavoriteSessionsChanged) return null
    return new OldFavoriteTaskCoordinator()
  }, [])
  const sessionOrchestrator = useMemo(
    () => sessionCoordinator ? new OldFavoriteSessionOrchestrator(sessionCoordinator) : null,
    [sessionCoordinator]
  )
  async function guardedSessionUpdateSegment(
    batchId: string,
    segmentId: string,
    accountMid: string,
    update: Parameters<OldFavoriteSessionOrchestrator['updateSegment']>[2]
  ) {
    if (!sessionOrchestrator) return
    return guardOldFavoriteBatchWrite(
      sessionOrchestrator,
      { batchId, segmentId, accountMid },
      () => sessionOrchestrator.updateSegment(batchId, segmentId, update)
    )
  }
  useEffect(() => {
    if (currentAccountMid === undefined) return
    accountGenerationRef.current += 1
    oldFavoriteBatchSelectionGenerationRef.current += 1
    oldFavoriteExecutionStopRequestedRef.current = true
    scanGenerationRef.current += 1
    scanStartingRef.current = false
    currentScanRunIdRef.current = null
    currentScanAccountMidRef.current = currentAccountMid || null
    setBasicScanRunning(false)
    setBusy(false)
    setStatus(null)
    setBatchDiscardConfirming(false)
    setPausedRoundEndConfirming(false)
    setOldFavoriteExecutionConfirming(false)
    oldFavoriteSessionsOpeningRef.current = null
    oldFavoriteOrganizationRequestRef.current = null
    setOldFavoriteSessionsOpened(false)
    setOldFavoriteRecoveryRunning(false)
    setOldFavoriteRecoveryFailure(null)
    setOldFavoriteRecoveryResetConfirmOpen(false)
    setExpandedArchivePreviewGroups(new Set())
    oldFavoriteResolvedAccountMidRef.current = currentAccountMid.trim()
    bindOldFavoriteRuntimeAccount(currentAccountMid)
    setOldFavoriteRuntimeValue(
      'oldFavoriteRecoveryRequiresReconciliation',
      oldFavoriteReconciliationByAccountRef.current.get(currentAccountMid.trim()) === true
    )
  }, [currentAccountMid])
  const applyOldFavoriteSessions = useCallback((state: OldFavoriteSessionsState) => {
      if (oldFavoriteResetRunningRef.current) return
      const resolvedAccountMid = oldFavoriteResolvedAccountMidRef.current
      const rawAccountBatches = resolvedAccountMid
        ? state.batches.filter((batch) => batch.accountMid === resolvedAccountMid)
        : currentAccountMid === undefined
        ? state.batches
        : state.batches.filter((batch) => batch.accountMid === currentAccountMid)
      const ignoredBatchIds = resolvedAccountMid
        ? oldFavoriteIgnoredSessionBatchIdsRef.current.get(resolvedAccountMid)
        : undefined
      const accountBatches = ignoredBatchIds
        ? rawAccountBatches.filter((batch) => !ignoredBatchIds.has(batch.id))
        : rawAccountBatches
      if (resolvedAccountMid && accountBatches.length === 0 && (
        ignoredBatchIds ||
        oldFavoriteUserBatchesRef.current.some((batch) => batch.accountMid === resolvedAccountMid)
      )) return
      if (accountBatches.some((batch) => batch.segments.some(
        (segment) => segment.task?.requestState === 'result-unknown'
      ))) {
        setOldFavoriteReconciliationRequired(resolvedAccountMid || currentAccountMid || '', true)
      }
      const summaries = accountBatches.map((batch) => ({
        id: batch.id,
        kind: batch.kind,
        createdAt: batch.createdAt,
        accountMid: batch.accountMid,
        segmentIndex: Math.max(
          1,
          batch.segments.findIndex((segment) => segment.status !== 'ended') + 1
        ),
        segmentCount: Math.max(1, batch.segments.length),
        segmentAids: batch.segments.map((segment) => segment.aids),
        status: batch.status,
        snapshot: batch.snapshot as OldFavoriteUserBatchSummary['snapshot']
      } satisfies OldFavoriteUserBatchSummary))
      if (summaries.length > 0) {
        setOldFavoriteUserBatches((current) => summaries.map((summary) => {
          const local = current.find((batch) => batch.id === summary.id)
          return local
            ? { ...summary, segmentIndex: local.segmentIndex, snapshot: mergeBatchPreviewSnapshot(local.snapshot, summary.snapshot) }
            : summary
        }))
        setActiveOldFavoriteUserBatchId((current) => {
          const selected = summaries.find((batch) => batch.id === current && batch.status !== 'ended') ??
            summaries.find((batch) => batch.id === current && batch.status === 'ended') ??
            summaries
              .filter((batch) => batch.status !== 'ended')
              .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
              .at(-1)
          if (!selected) {
            setPreview(null)
            setBaseScanPreview(null)
            setArchivePlanState(null)
            return ''
          }
          const currentSummary = oldFavoriteUserBatchesRef.current.find((batch) => batch.id === selected?.id)
          if (selected?.snapshot && !currentSummary?.snapshot) {
            if (selected.snapshot.preview !== undefined) setPreview(selected.snapshot.preview)
            if (selected.snapshot.baseScanPreview !== undefined) setBaseScanPreview(selected.snapshot.baseScanPreview)
            if (selected.snapshot.archiveEditorState) setArchiveEditorState(selected.snapshot.archiveEditorState)
            if (selected.snapshot.step) setOldFavoriteStep(selected.snapshot.step)
            if (selected.snapshot.executionPhase) setOldFavoriteExecutionPhase(selected.snapshot.executionPhase)
            if (selected.snapshot.executionRun !== undefined) setOldFavoriteExecutionRun(selected.snapshot.executionRun)
            if (selected.snapshot.executionProgress !== undefined) {
              setOldFavoriteExecutionProgress(selected.snapshot.executionProgress)
            }
            setOldFavoriteGuideMode('organize')
          }
          return selected?.id ?? ''
        })
      } else if (currentAccountMid !== undefined) {
        setOldFavoriteUserBatches([])
        setActiveOldFavoriteUserBatchId('')
        setPreview(null)
        setBaseScanPreview(null)
        setArchivePlanState(null)
      }
      setOldFavoriteExternalLeaseActive(Boolean(
        state.lease && accountBatches.some((batch) => batch.id === state.lease?.batchId)
      ))
  }, [
    currentAccountMid,
    setActiveOldFavoriteUserBatchId,
    setArchiveEditorState,
    setArchivePlanState,
    setBaseScanPreview,
    setOldFavoriteExecutionPhase,
    setOldFavoriteExecutionProgress,
    setOldFavoriteExecutionRun,
    setOldFavoriteGuideMode,
    setOldFavoriteStep,
    setOldFavoriteUserBatches,
    setPreview
  ])
  const openOldFavoriteSessions = useCallback(async (resolvedAccountMid?: string) => {
    oldFavoriteActivatedRef.current = true
    const accountMid = resolvedAccountMid?.trim() || currentAccountMid?.trim() ||
      (onReadCurrentOldFavoriteAccount ? (await onReadCurrentOldFavoriteAccount()).trim() : '')
    if (accountMid) {
      oldFavoriteResolvedAccountMidRef.current = accountMid
      await window.bilimiDesktop?.openOldFavoriteWorkspaceAccount?.(accountMid)
    }
    if (!sessionCoordinator) {
      setOldFavoriteSessionsOpened(true)
      return { version: OLD_FAVORITE_SESSIONS_VERSION, batches: [], lease: null }
    }
    oldFavoriteSessionsOpeningRef.current ??= sessionCoordinator.load()
    const state = await oldFavoriteSessionsOpeningRef.current
    applyOldFavoriteSessions(state)
    setOldFavoriteSessionsOpened(true)
    return state
  }, [applyOldFavoriteSessions, currentAccountMid, onReadCurrentOldFavoriteAccount, sessionCoordinator])
  useEffect(() => {
    if (!oldFavoriteActivatedRef.current || currentAccountMid === undefined) return
    void openOldFavoriteSessions(currentAccountMid)
  }, [currentAccountMid, openOldFavoriteSessions])
  useEffect(() => {
    if (!sessionCoordinator || !oldFavoriteSessionsOpened) return
    return sessionCoordinator.subscribe(applyOldFavoriteSessions)
  }, [applyOldFavoriteSessions, oldFavoriteSessionsOpened, sessionCoordinator])
  const [tagCandidatesExpanded, setTagCandidatesExpanded] = useState(false)
  const [ledgerHintExpanded, setLedgerHintExpanded] = useState(false)
  const [oldFavoriteGuideHintExpanded, setOldFavoriteGuideHintExpanded] = useState(false)
  const [expandedArchivePreviewGroups, setExpandedArchivePreviewGroups] = useState<Set<string>>(() => new Set())
  const ledgerNamesById = useMemo(
    () => Object.fromEntries(draftLedgers.map((ledger) => [ledger.id, ledger.displayName])),
    [draftLedgers]
  )
  const activeLedger = useMemo(
    () =>
      activeLedgerIndex === null
        ? null
        : (draftLedgers[activeLedgerIndex] ?? null),
    [activeLedgerIndex, draftLedgers]
  )
  const activeLedgerRuleType = activeLedger ? ledgerRuleType(activeLedger) : 'keyword'
  const activeOldFavoriteUserBatch = oldFavoriteUserBatches.find(
    (batch) => batch.id === activeOldFavoriteUserBatchId
  )
  const activeOldFavoriteBatchReadOnly = activeOldFavoriteUserBatch?.status === 'ended'
  const unfinishedOldFavoriteBatches = oldFavoriteUserBatches.filter((batch) => batch.status !== 'ended')
  const endedOldFavoriteBatches = oldFavoriteUserBatches.filter((batch) => batch.status === 'ended')
  const hasUnfinishedOldFavoriteArchive = hasPendingOldFavoriteBatch || unfinishedOldFavoriteBatches.length > 0
  const activeOldFavoriteSegmentId = activeOldFavoriteUserBatch
    ? `${activeOldFavoriteUserBatch.id}:segment:${activeOldFavoriteUserBatch.segmentIndex}`
    : ''
  const activeOldFavoriteAccountMid = activeOldFavoriteUserBatch?.accountMid || preview?.scanContext?.accountMid || ''
  const currentSegmentSnapshot = () => {
    const currentPreview = getOldFavoriteRuntimeValue<FavoriteLedgerPreview | null>('preview', null)
    const currentBasePreview = getOldFavoriteRuntimeValue<FavoriteLedgerPreview | null>('baseScanPreview', null)
    if (!currentPreview || !currentBasePreview) return null
    return {
      preview: currentPreview,
      baseScanPreview: currentBasePreview,
      archiveEditorState: getOldFavoriteRuntimeValue<ArchiveEditorRuntimeState>(
        'archiveEditorState', archiveEditorState
      )
    }
  }
  const restoreSegmentSnapshot = (snapshot: NonNullable<OldFavoriteUserBatchSummary['snapshot']>['segmentSnapshots'][number]) => {
    setPreview(snapshot.preview)
    setBaseScanPreview(snapshot.baseScanPreview)
    setArchiveEditorState(snapshot.archiveEditorState)
  }
  const fullExecutionLeaseHeldRef = useRef(false)
  async function runTrackedOldFavoriteRequest<T>(options: {
    task: 'tag' | 'deepseek' | 'execute'
    segmentId?: string
    currentAid?: number
    checkpoint?: Record<string, unknown>
    snapshot?: Record<string, unknown>
    work: () => Promise<T>
  }): Promise<T> {
    const segmentId = options.segmentId ?? activeOldFavoriteSegmentId
    if (!sessionOrchestrator || !activeOldFavoriteUserBatch || !segmentId) {
      return options.work()
    }
    const currentAccountMid = onReadCurrentOldFavoriteAccount
      ? (await onReadCurrentOldFavoriteAccount()).trim()
      : activeOldFavoriteAccountMid
    if (!currentAccountMid || currentAccountMid !== activeOldFavoriteUserBatch.accountMid) {
      throw new Error('当前 B 站账号与本批次不一致，切回原账号后才能继续。')
    }
    if (options.task === 'execute' && fullExecutionLeaseHeldRef.current) {
      const requestAccountGeneration = accountGenerationRef.current
      await guardedSessionUpdateSegment(activeOldFavoriteUserBatch.id, segmentId, currentAccountMid, {
        status: 'running',
        task: {
          kind: 'execute', status: 'running', requestState: 'in-flight',
          ...(options.currentAid === undefined ? {} : { currentAid: options.currentAid })
        },
        checkpoint: options.checkpoint,
        snapshot: options.snapshot
      })
      try {
        const result = await options.work()
        if (requestAccountGeneration !== accountGenerationRef.current) {
          await guardedSessionUpdateSegment(activeOldFavoriteUserBatch.id, segmentId, currentAccountMid, {
            status: 'paused', taskStatus: 'paused', requestState: 'result-unknown',
            checkpoint: options.checkpoint, snapshot: options.snapshot
          })
          setOldFavoriteReconciliationRequired(activeOldFavoriteUserBatch.accountMid, true)
          return result
        }
        if (result && typeof result === 'object' && 'resultUnknown' in result && result.resultUnknown === true) {
          await guardedSessionUpdateSegment(activeOldFavoriteUserBatch.id, segmentId, currentAccountMid, {
            status: 'paused', taskStatus: 'paused', requestState: 'result-unknown',
            checkpoint: options.checkpoint, snapshot: options.snapshot
          })
          return result
        }
        await guardedSessionUpdateSegment(activeOldFavoriteUserBatch.id, segmentId, currentAccountMid, {
          status: 'ready', taskStatus: 'paused', requestState: 'idle',
          checkpoint: options.checkpoint?.cursor === undefined
            ? options.checkpoint
            : { ...options.checkpoint, cursor: Number(options.checkpoint.cursor) + 1 },
          snapshot: options.snapshot?.execution && typeof options.snapshot.execution === 'object'
            ? {
                ...options.snapshot,
                execution: {
                  ...options.snapshot.execution,
                  nextGroupIndex: Number((options.snapshot.execution as { nextGroupIndex?: number }).nextGroupIndex ?? 0) + 1
                }
              }
            : options.snapshot
        })
        return result
      } catch (error) {
        await guardedSessionUpdateSegment(activeOldFavoriteUserBatch.id, segmentId, currentAccountMid, {
          status: 'paused', taskStatus: 'paused', requestState: 'result-unknown',
          checkpoint: options.checkpoint, snapshot: options.snapshot
        })
        throw error
      }
    }
    return sessionOrchestrator.runTrackedRequest({
      batchId: activeOldFavoriteUserBatch.id,
      segmentId,
      task: options.task,
      accountMid: currentAccountMid,
      currentAid: options.currentAid,
      checkpoint: options.checkpoint,
      snapshot: options.snapshot,
      work: options.work
    })
  }

  const activeLedgerDeepSeekConstraint = activeLedger ? ledgerDeepSeekConstraintText(activeLedger) : ''
  const activeLedgerNameValidation = activeLedger
    ? favoriteLedgerNameValidation(activeLedger.displayName)
    : null
  const firstInvalidLedgerIndex = useMemo(
    () => draftLedgers.findIndex((ledger) => !favoriteLedgerNameValidation(ledger.displayName).valid),
    [draftLedgers]
  )
  const ledgerHasUnsavedChanges = useCallback((ledger: FavoriteLedger, index: number) => {
    const savedSnapshot = savedLedgerSnapshots[ledgerDraftKey(ledger, index, draftLedgers)]
    return Boolean(
      savedSnapshot && JSON.stringify(ledgerEditorSnapshot(ledger)) !== JSON.stringify(savedSnapshot)
    )
  }, [savedLedgerSnapshots])
  const activeLedgerHasUnsavedChanges = useMemo(() => {
    if (!activeLedger || activeLedgerIndex === null) {
      return false
    }

    return ledgerHasUnsavedChanges(activeLedger, activeLedgerIndex)
  }, [activeLedger, activeLedgerIndex, ledgerHasUnsavedChanges])

  useEffect(() => {
    setSavedLedgerSnapshots((current) => {
      let changed = false
      const next = { ...current }
      draftLedgers.forEach((ledger, index) => {
        const key = ledgerDraftKey(ledger, index, draftLedgers)
        if (!next[key]) {
          next[key] = ledgerEditorSnapshot(ledger)
          changed = true
        }
      })
      return changed ? next : current
    })
  }, [draftLedgers])

  useEffect(() => () => {
    if (archiveBatchCompletionTimerRef.current) {
      clearTimeout(archiveBatchCompletionTimerRef.current)
    }
  }, [])
  const normalizedScanProgress = useCallback((scanProgress: FavoriteLedgerPreview['scanProgress']) => {
    if (!scanProgress) return undefined
    const numberOrZero = (value: unknown) => Number.isFinite(Number(value))
      ? Math.max(0, Number(value))
      : 0
    const basicTotal = numberOrZero(scanProgress.basic?.total)
    const tagTotal = numberOrZero(scanProgress.tags?.total)
    return {
      basic: {
        ...scanProgress.basic,
        completed: Math.min(numberOrZero(scanProgress.basic?.completed), basicTotal),
        total: basicTotal,
        status: scanProgress.basic?.status ?? 'running'
      },
      tags: {
        completed: Math.min(numberOrZero(scanProgress.tags?.completed), tagTotal),
        total: tagTotal,
        pending: Math.min(numberOrZero(scanProgress.tags?.pending), tagTotal),
        cacheHits: numberOrZero(scanProgress.tags?.cacheHits),
        succeeded: numberOrZero(scanProgress.tags?.succeeded),
        failed: numberOrZero(scanProgress.tags?.failed),
        status: scanProgress.tags?.status ?? 'idle',
        ...(scanProgress.tags?.terminalReason ? { terminalReason: scanProgress.tags.terminalReason } : {}),
        ...(scanProgress.tags?.errorKind ? { errorKind: scanProgress.tags.errorKind } : {}),
        ...(Number.isFinite(Number(scanProgress.tags?.errorCode)) ? { errorCode: Number(scanProgress.tags.errorCode) } : {}),
        ...(scanProgress.tags?.errorMessage ? { errorMessage: scanProgress.tags.errorMessage } : {})
      }
    } as NonNullable<FavoriteLedgerPreview['scanProgress']>
  }, [])
  const mergeScanProgress = useCallback((
    current: FavoriteLedgerPreview['scanProgress'],
    incoming: FavoriteLedgerPreview['scanProgress']
  ) => {
    const currentBasicInvalid = invalidScanProgressPart(current?.basic)
    const currentTagsInvalid = invalidTagScanProgressPart(current?.tags)
    const next = normalizedScanProgress(incoming)
    const previous = normalizedScanProgress(current)
    if (!next) return previous
    if (!previous) return next
    const differentRun = Boolean(next.basic.runId && next.basic.runId !== previous.basic.runId)
    if (differentRun) return next
    const basicRegressed =
      previous.basic.status === 'complete' && next.basic.status !== 'complete' ||
      next.basic.completed < previous.basic.completed || next.basic.total < previous.basic.total
    const basic = currentBasicInvalid
      ? next.basic
      : basicRegressed
        ? {
            ...next.basic,
            completed: previous.basic.completed,
            total: previous.basic.total,
            status: previous.basic.status === 'complete' ? previous.basic.status : next.basic.status
          }
        : next.basic
    const tags = currentTagsInvalid ? next.tags :
      oldFavoriteTagEnrichmentFinished(previous.tags) && !oldFavoriteTagEnrichmentFinished(next.tags) ||
      next.tags.completed < previous.tags.completed || next.tags.total < previous.tags.total
        ? previous.tags
        : next.tags
    return { basic, tags }
  }, [normalizedScanProgress])
  const tagSnapshotGate = useCallback((
    scanGeneration: number,
    snapshot: OldFavoriteTagEnrichmentSnapshot
  ) => {
    if (scanGeneration !== scanGenerationRef.current) return 'invalid' as const
    const expectedAccountMid = currentScanAccountMidRef.current ?? preview?.scanContext?.accountMid ?? null
    if (expectedAccountMid && 'accountMid' in snapshot && snapshot.accountMid !== expectedAccountMid) {
      scanGenerationRef.current += 1
      scanStartingRef.current = false
      if (snapshot.accountMid) bindOldFavoriteRuntimeAccount(snapshot.accountMid)
      setPreview(null)
      setBaseScanPreview(null)
      setArchivePlanState(null)
      setPendingTagDeepSeekConfirming(null)
      setOldFavoriteRuntimeStatus(null)
      setBasicScanRunning(false)
      setBusy(false)
      currentScanRunIdRef.current = null
      currentScanAccountMidRef.current = snapshot.accountMid || null
      setStatus('检测到账号已切换，请重新扫描当前账号。')
      return 'invalid' as const
    }
    const incomingRunId = snapshot.scanProgress.basic.runId?.trim() || null
    if (
      basicScanRunning &&
      !currentScanRunIdRef.current &&
      snapshot.scanProgress.basic.status === 'complete'
    ) {
      return 'invalid' as const
    }
    if (!currentScanRunIdRef.current && incomingRunId) currentScanRunIdRef.current = incomingRunId
    if (currentScanRunIdRef.current && incomingRunId !== currentScanRunIdRef.current) return 'invalid' as const
    return 'accepted' as const
  }, [basicScanRunning, preview?.scanContext?.accountMid])
  const applyTagEnrichmentAction = useCallback((action: 'pause' | 'resume' | 'cancel') => {
    if (tagActionRunning) return
    if (getOldFavoriteRuntimeValue<OldFavoriteExecutionPhase>('oldFavoriteExecutionPhase', 'idle') !== 'idle') return
    if (!onReadOldFavoriteTagEnrichment) return
    setTagActionRunning(action)
    if (action === 'resume') {
      setStatus('正在继续补取')
    }
    const actionToken = ++tagActionTokenRef.current
    const scanGeneration = scanGenerationRef.current
    void runTrackedOldFavoriteRequest({
      task: 'tag',
      snapshot: { currentStep: 'tags' },
      work: () => onReadOldFavoriteTagEnrichment(action)
    }).then((snapshot) => {
    if (scanGeneration !== scanGenerationRef.current) return
      if (tagSnapshotGate(scanGeneration, snapshot) !== 'accepted') return
      const mergedProgress = mergeScanProgress(scanProgressRef.current, snapshot.scanProgress)
      setScanProgress(mergedProgress)
      setPreview((current) => current ? { ...current, scanProgress: mergedProgress } : current)
      setBaseScanPreview((current) => current ? { ...current, scanProgress: mergedProgress } : current)
      if (action === 'cancel') {
        terminalTagScanGenerationRef.current = scanGeneration
        applyCompletedTagSnapshot(snapshot, scanGeneration)
      }
      const tags = mergedProgress?.tags
      if (!tags) return
      if (tags.status === 'paused' && (tags.errorMessage || tags.errorCode || tags.errorKind)) {
        setStatus(`标签补取已暂停：${tags.errorMessage ?? tags.errorKind ?? '请稍后重试'}${tags.errorCode !== undefined ? `（错误码 ${tags.errorCode}）` : ''}`)
      } else if (tags.status === 'partial' && tags.terminalReason === 'cancelled') {
        setStatus(`标签补取已结束，已使用当前取得的 ${tags.completed} 条结果`)
      }
    }).catch(() => {
      if (scanGeneration !== scanGenerationRef.current) return
      setStatus('标签补取操作未完成，请稍后重试。')
    }).finally(() => {
      setTagActionRunning((current) => (
        current === action && actionToken === tagActionTokenRef.current ? null : current
      ))
    })
  }, [applyCompletedTagSnapshot, mergeScanProgress, onReadOldFavoriteTagEnrichment, setScanProgress, tagActionRunning, tagSnapshotGate])
  const applyStreamingSnapshot = useCallback((
    snapshot: OldFavoriteTagEnrichmentSnapshot,
    expectedScanGeneration = scanGenerationRef.current
  ) => {
    if (expectedScanGeneration !== scanGenerationRef.current) return
    for (const segment of snapshot.readySegments ?? []) {
      const workspace = currentScanWorkspaceRef.current
      if (
        appliedStreamingSegmentIndexesRef.current.has(segment.index) &&
        (!workspace || persistedStreamingSegmentIndexesRef.current.has(segment.index))
      ) continue
      appliedStreamingSegmentIndexesRef.current.add(segment.index)
      const segmentPreview = createFavoriteLedgerPreview({
        ledgers: draftLedgers,
        sourceFolders: segment.sourceFolders,
        targetMembership: {},
        scanProgress: snapshot.scanProgress,
        multiArchiveMode: favoriteArchiveMultiMode
      })
      const normalizedItems = normalizeOldFavoritePreviewItems(segmentPreview.items, draftLedgers)
      const streamingPersistenceAllowed = currentScanSessionRef.current?.kind === 'full' &&
        currentScanInitialFullRef.current
      if (workspace && streamingPersistenceAllowed && !persistedStreamingSegmentIndexesRef.current.has(segment.index)) {
        persistedStreamingSegmentIndexesRef.current.add(segment.index)
        for (const aid of segment.aids) persistedStreamingAidsRef.current.add(aid)
        streamingWorkspaceWriteTailRef.current = streamingWorkspaceWriteTailRef.current.then(async () => {
          if (
            expectedScanGeneration !== scanGenerationRef.current ||
            currentScanWorkspaceRef.current?.batchId !== workspace.batchId
          ) return
          try {
            await appendWorkspaceLogicalChunk(workspace.accountMid, workspace.batchId, normalizedItems)
          } catch (error) {
            persistedStreamingSegmentIndexesRef.current.delete(segment.index)
            for (const aid of segment.aids) persistedStreamingAidsRef.current.delete(aid)
            setStatus(`整理存档写入失败：${error instanceof Error ? error.message : String(error)}`)
          }
        })
      }
      const nextPreview: FavoriteLedgerPreview = {
        ...segmentPreview,
        items: normalizedItems,
        batch: { limit: segment.aids.length, hasMore: true },
        scanContext: {
          accountMid: snapshot.accountMid ?? '',
          totalUniqueVideos: segment.aids.length,
          sourceFolders: segment.sourceFolders,
          activeSourceFolders: segment.sourceFolders,
          protectedVideos: [],
          managedFolders: [],
          targetMembership: {},
          multiArchiveMode: favoriteArchiveMultiMode
        }
      }
      const segmentEditorState: ArchiveEditorRuntimeState = {
        ...archiveEditorState,
        archivePlanState: createArchivePlanStateFromPreviewItems(normalizedItems)
      }
      const batchId = currentScanSessionRef.current?.batchId ?? `stream:${snapshot.accountMid ?? ''}`
      const existingBatch = oldFavoriteUserBatchesRef.current.find((batch) => batch.id === batchId)
      const segmentSnapshots = {
        ...existingBatch?.snapshot?.segmentSnapshots,
        [segment.index]: { preview: nextPreview, baseScanPreview: nextPreview, archiveEditorState: segmentEditorState }
      }
      const segmentAids = [...(existingBatch?.segmentAids ?? [])]
      segmentAids[segment.index] = [...segment.aids]
      const nextBatch: OldFavoriteUserBatchSummary = {
        id: batchId,
        kind: existingBatch?.kind ?? 'full',
        createdAt: existingBatch?.createdAt ?? new Date().toISOString(),
        accountMid: snapshot.accountMid ?? '',
        segmentIndex: existingBatch?.segmentIndex ?? 1,
        segmentCount: Math.max(existingBatch?.segmentCount ?? 1, segment.index + 1),
        segmentAids,
        status: 'active',
        snapshot: {
          preview: existingBatch?.snapshot?.preview ?? nextPreview,
          baseScanPreview: existingBatch?.snapshot?.baseScanPreview ?? nextPreview,
          archiveEditorState: existingBatch?.snapshot?.archiveEditorState ?? segmentEditorState,
          step: existingBatch?.snapshot?.step ?? 'preview',
          executionPhase: existingBatch?.snapshot?.executionPhase ?? 'idle',
          executionRun: existingBatch?.snapshot?.executionRun ?? null,
          executionProgress: existingBatch?.snapshot?.executionProgress ?? null,
          ...existingBatch?.snapshot,
          segmentSnapshots
        }
      }
      setOldFavoriteUserBatches((current) => [
        ...current.filter((batch) => batch.id !== batchId),
        nextBatch
      ])
      if (!activeOldFavoriteUserBatchId || activeOldFavoriteUserBatchId === batchId) {
        setActiveOldFavoriteUserBatchId(batchId)
      }
      if ((!existingBatch || existingBatch.segmentIndex === segment.index + 1) && (!preview || preview.items.length === 0)) {
        setPreview(nextPreview)
        setBaseScanPreview(nextPreview)
        setArchiveEditorState(segmentEditorState)
      }
    }
    const updates = (snapshot.sourceUpdates ?? []).filter((update) => {
      const relationKey = `${update.aid}:${update.folderId}`
      if (appliedStreamingSourceRelationsRef.current.has(relationKey)) return false
      appliedStreamingSourceRelationsRef.current.add(relationKey)
      return appliedStreamingSegmentIndexesRef.current.has(update.segmentIndex)
    })
    if (updates.length === 0) return
    const workspace = currentScanWorkspaceRef.current
    const streamingPersistenceAllowed = currentScanSessionRef.current?.kind === 'full' &&
      currentScanInitialFullRef.current
    if (workspace && streamingPersistenceAllowed) {
      streamingWorkspaceWriteTailRef.current = streamingWorkspaceWriteTailRef.current.then(async () => {
        if (
          expectedScanGeneration !== scanGenerationRef.current ||
          currentScanWorkspaceRef.current?.batchId !== workspace.batchId
        ) return
        try {
          await window.bilimiDesktop?.appendOldFavoriteWorkspaceChunk?.(
            workspace.accountMid,
            workspace.batchId,
            'sources',
            updates.map((update) => ({
              aid: update.aid,
              sourceFolderIds: [update.folderId],
              sourceFolderTitles: [update.folderTitle],
              relationKey: update.relationKey
            }))
          )
        } catch (error) {
          setStatus(`来源关系保存失败：${error instanceof Error ? error.message : String(error)}`)
        }
      })
    }
    setOldFavoriteUserBatches((current) => current.map((batch) => {
      const segmentSnapshots = { ...batch.snapshot?.segmentSnapshots }
      let changed = false
      for (const update of updates) {
        const segmentSnapshot = segmentSnapshots[update.segmentIndex]
        if (!segmentSnapshot) continue
        const mergePreview = (currentPreview: FavoriteLedgerPreview) => ({
          ...currentPreview,
          items: currentPreview.items.map((item) => item.aid === update.aid
            ? addOldFavoriteSourceRelation(item, update)
            : item)
        })
        segmentSnapshots[update.segmentIndex] = {
          ...segmentSnapshot,
          preview: mergePreview(segmentSnapshot.preview),
          baseScanPreview: mergePreview(segmentSnapshot.baseScanPreview)
        }
        changed = true
      }
      return changed && batch.snapshot ? { ...batch, snapshot: { ...batch.snapshot, segmentSnapshots } } : batch
    }))
    const activeSegmentIndex = activeOldFavoriteUserBatch?.segmentIndex ?? 1
    const activeUpdates = updates.filter((update) => update.segmentIndex === activeSegmentIndex - 1)
    if (activeUpdates.length > 0) {
      const mergeRuntime = (current: FavoriteLedgerPreview | null) => current ? {
        ...current,
        items: current.items.map((item) => activeUpdates.reduce(
          (next, update) => next.aid === update.aid ? addOldFavoriteSourceRelation(next, update) : next,
          item
        ))
      } : current
      setPreview(mergeRuntime)
      setBaseScanPreview(mergeRuntime)
    }
  }, [
    activeOldFavoriteUserBatch, activeOldFavoriteUserBatchId, archiveEditorState, draftLedgers,
    favoriteArchiveMultiMode, preview, setActiveOldFavoriteUserBatchId, setArchiveEditorState,
    setBaseScanPreview, setOldFavoriteUserBatches, setPreview
  ])
  const applyStreamingSnapshotRef = useRef(applyStreamingSnapshot)
  applyStreamingSnapshotRef.current = applyStreamingSnapshot
  const tagSnapshotGateRef = useRef(tagSnapshotGate)
  tagSnapshotGateRef.current = tagSnapshotGate
  const cancelOldFavoriteScan = useCallback(() => {
    if (!basicScanRunning || !onReadOldFavoriteTagEnrichment) return
    scanGenerationRef.current += 1
    currentScanRunIdRef.current = null
    currentScanAccountMidRef.current = null
    scanStartingRef.current = false
    currentScanSessionRef.current = null
    currentScanWorkspaceRef.current = null
    setBasicScanRunning(false)
    setBusy(false)
    setPreview(lastSuccessfulPreviewRef.current)
    setBaseScanPreview(lastSuccessfulBasePreviewRef.current)
    setArchivePlanState(lastSuccessfulArchivePlanStateRef.current)
    setStatus('已取消扫描。')
    publishOldFavoriteStatus({ label: '扫描已取消', message: '已取消扫描。', tone: 'idle' })
    void onReadOldFavoriteTagEnrichment('cancel-scan').catch(() => undefined)
  }, [basicScanRunning, onReadOldFavoriteTagEnrichment, publishOldFavoriteStatus])
  useEffect(() => {
    if (!onReadOldFavoriteTagEnrichment || (!preview && !basicScanRunning)) return
    if (!scanProgress) return
    if (
      scanGenerationRef.current === 0 &&
      oldFavoriteTagEnrichmentFinished(scanProgress.tags)
    ) return
    let cancelled = false
    let timeout: number | undefined
    const scanGeneration = scanGenerationRef.current
    if (terminalTagScanGenerationRef.current === scanGeneration) return
    const stillCurrent = () => !cancelled && scanGeneration === scanGenerationRef.current
    const scheduleNext = () => {
      if (!stillCurrent()) return
      timeout = window.setTimeout(() => void pollProgress(), 1500)
    }
    const pollProgress = async () => {
      try {
        const snapshot = await onReadOldFavoriteTagEnrichment('progress')
        if (!stillCurrent()) return
        if (tagSnapshotGateRef.current(scanGeneration, snapshot) !== 'accepted') {
          scheduleNext()
          return
        }
          applyStreamingSnapshotRef.current(snapshot, scanGeneration)
        setScanProgress(mergeScanProgress(scanProgressRef.current, snapshot.scanProgress))
        const tagsComplete =
          !invalidTagScanProgressPart(snapshot.scanProgress.tags) &&
          oldFavoriteTagEnrichmentFinished(snapshot.scanProgress.tags)
        const basicComplete = snapshot.scanProgress.basic.status === 'complete'
        if (!tagsComplete || !basicComplete) {
          scheduleNext()
          return
        }
        const fullSnapshot = await runTrackedOldFavoriteRequest({
          task: 'tag',
          snapshot: { currentStep: 'tags' },
          work: () => onReadOldFavoriteTagEnrichment('read')
        })
        if (!stillCurrent() || tagSnapshotGateRef.current(scanGeneration, fullSnapshot) !== 'accepted') return
        latestTagEnrichmentSnapshotRef.current = fullSnapshot
        applyCompletedTagSnapshot(fullSnapshot, scanGeneration)
      } catch {
        scheduleNext()
      }
    }
    void pollProgress()
    return () => {
      cancelled = true
      if (timeout !== undefined) window.clearTimeout(timeout)
    }
  }, [
    basicScanRunning,
    mergeScanProgress,
    onReadOldFavoriteTagEnrichment,
    setScanProgress,
    Boolean(preview),
    preview?.scanContext?.accountMid
  ])

  useEffect(() => {
    if (!preview) {
      const nextDraftLedgers = ledgers.map(cloneArchiveDraftLedger)
      setDraftLedgers(nextDraftLedgers)
      setSavedLedgerSnapshots(Object.fromEntries(
        nextDraftLedgers.map((ledger, index) => [ledgerDraftKey(ledger, index, nextDraftLedgers), ledgerEditorSnapshot(ledger)])
      ))
    }
    setSelectedDefaultLedgerIds(
      new Set(ledgers.filter((ledger) => ledger.enabled && ledger.isDefault).map((ledger) => ledger.id))
    )
    setActiveLedgerId(null)
    setActiveLedgerIndex(null)
    setActiveLedgerSavedSnapshot(null)
    finishLedgerDrag()
  }, [ledgers])

  useEffect(() => {
    if (!onOldFavoriteStageFeedback) {
      return
    }
    return registerOldFavoriteRuntimeHandler(
      'onOldFavoriteStageFeedback',
      onOldFavoriteStageFeedback
    )
  }, [onOldFavoriteStageFeedback])

  useEffect(() => {
    if (!onDeepSeekArchiveKeywordSuggestions) {
      return
    }
    return registerOldFavoriteRuntimeHandler(
      'onDeepSeekArchiveKeywordSuggestions',
      onDeepSeekArchiveKeywordSuggestions
    )
  }, [onDeepSeekArchiveKeywordSuggestions])

  useEffect(() => {
    if (!oldFavoriteRuntimeStatus) {
      return
    }

    onOldFavoriteStatusUpdate?.(oldFavoriteRuntimeStatus)
  }, [oldFavoriteRuntimeStatus])

  function publishOldFavoriteStatus(status: OldFavoriteStatusSnapshot) {
    setOldFavoriteRuntimeStatus(status)
  }

  function publishOldFavoriteStageFeedback(message: string) {
    setOldFavoriteRuntimeValue('sharedOperationFeedback', message)
    invokeOldFavoriteRuntimeHandler('onOldFavoriteStageFeedback', message)
  }

  useEffect(() => {
    if (!deepSeekArchiveProgress || !deepSeekArchiveRunning) {
      return
    }

    setOldFavoriteRuntimeStatus({
      label: `DeepSeek整理 ${deepSeekArchiveProgress.completedVideos}/${deepSeekArchiveProgress.totalVideos}`,
      message: 'DeepSeek 正在辅助整理旧藏。',
      tone: 'running'
    })
  }, [deepSeekArchiveProgress, deepSeekArchiveRunning, setOldFavoriteRuntimeStatus])

  function oldFavoriteOrganizationLocked() {
    return oldFavoriteExecutionPhase !== 'idle' || oldFavoriteExecutionConfirming
  }

  const oldFavoritePlanReadOnly = oldFavoriteOrganizationLocked() || activeOldFavoriteBatchReadOnly ||
    (oldFavoriteExternalLeaseActive && !(basicScanRunning && preview))

  function showOldFavoriteOrganizationPendingMessage() {
    setStatus('正在整理中，请耐心等待。')
  }

  async function discardActiveOldFavoriteBatch() {
    if (oldFavoriteExecutionPhase !== 'idle' || oldFavoriteExecutionRun) {
      setBatchDiscardConfirming(false)
      setStatus('本轮已开始执行，不能放弃或提交当前批次；请继续整理或结束本轮后重新扫描。')
      return
    }
    setBatchDiscardConfirming(false)
    acknowledgeOldFavoriteExecution()
  }

  async function endOldFavoriteSessionBatch(batchId: string, endedAt: string) {
    if (!sessionCoordinator) return
    const authoritativeResult = await sessionCoordinator.endBatch(batchId, endedAt)
    if (authoritativeResult !== undefined) return
    const state = await sessionCoordinator.load()
    await sessionCoordinator.save(endOldFavoriteBatch(state, batchId, endedAt))
  }

  async function acknowledgeOldFavoriteExecution() {
    if (activeOldFavoriteUserBatch) {
      const endedSnapshot = {
        preview,
        baseScanPreview,
        archiveEditorState,
        step: oldFavoriteStep,
        executionPhase: oldFavoriteExecutionPhase,
        executionRun: oldFavoriteExecutionRun,
        executionProgress: oldFavoriteExecutionProgress
      }
      try {
        if (workspaceOverlayTimerRef.current) {
          clearTimeout(workspaceOverlayTimerRef.current)
          workspaceOverlayTimerRef.current = null
        }
        if (workspaceOverlayQueueRef.current.hasPending(
          activeOldFavoriteUserBatch.accountMid,
          activeOldFavoriteUserBatch.id
        )) {
          await flushWorkspaceOverlayQueue(
            activeOldFavoriteUserBatch.accountMid,
            activeOldFavoriteUserBatch.id
          )
        }
        if (window.bilimiDesktop?.finalizeOldFavoriteWorkspaceBatch) {
          await window.bilimiDesktop.finalizeOldFavoriteWorkspaceBatch(
            activeOldFavoriteUserBatch.accountMid,
            activeOldFavoriteUserBatch.id
          )
        }
      } catch (error) {
        setStatus(`整理结果定档失败：${error instanceof Error ? error.message : String(error)}`)
        return
      }
      if (sessionCoordinator) {
        try {
          await endOldFavoriteSessionBatch(activeOldFavoriteUserBatch.id, new Date().toISOString())
        } catch (error) {
          setStatus(`整理状态保存失败：${error instanceof Error ? error.message : String(error)}`)
          return
        }
      }
      setOldFavoriteUserBatches((current) => current.map((batch) =>
        batch.id === activeOldFavoriteUserBatch.id
          ? { ...batch, status: 'ended', snapshot: { ...batch.snapshot, ...endedSnapshot } }
          : batch
      ))
      oldFavoriteUserBatchesRef.current = oldFavoriteUserBatchesRef.current.map((batch) =>
        batch.id === activeOldFavoriteUserBatch.id
          ? { ...batch, status: 'ended', snapshot: { ...batch.snapshot, ...endedSnapshot } }
          : batch
      )
    }
    const keepEndedBatchDetails = Boolean(activeOldFavoriteUserBatch)
    setOldFavoriteExecutionPhase('idle')
    setOldFavoriteExecutionConfirming(false)
    setOldFavoriteExecutionProgress(null)
    setOldFavoriteExecutionRun(null)
    if (!keepEndedBatchDetails) {
      setPreview(null)
      setBaseScanPreview(null)
      setArchivePlanState(null)
      setSelectedCandidateKeys(new Set())
      setSelectedOldFavoriteSourceFolderKeys(new Set())
    }
    setReorganizedProtectedAids(new Set())
    setProtectedReorganizationConfirming(false)
    setAbnormalProtectionReorganizationConfirming(false)
    setPendingUnclassifiedDecision(null)
    clearDeepSeekArchiveRunSnapshot({ resetHistory: true })
    setDeepSeekArchiveRunning(false)
    setDeepSeekArchiveStatus('')
    setDeepSeekArchiveResultSummary(null)
    setDeepSeekArchiveSummaryOpen(false)
    setDeepSeekArchiveSuggestionCount(0)
    setArchiveMultiModeChange(null)
    setDraftLedgers(ledgers.map(cloneArchiveDraftLedger))
    setLedgerListExpanded(false)
    setOldFavoriteStep(keepEndedBatchDetails ? 'preview' : 'scan')
    setOldFavoriteExpandedStep(keepEndedBatchDetails ? 'preview' : 'scan')
    setBatchDiscardConfirming(false)
    setPausedRoundEndConfirming(false)
    if (keepEndedBatchDetails) {
      setStatus('本次整理已结束，当前批次已转为只读。')
      publishOldFavoriteStatus({
        label: '整理已结束',
        message: '本次整理已结束，当前批次已转为只读。',
        tone: 'ok'
      })
    } else {
      setOldFavoriteRuntimeStatus(null)
    }
    onOldFavoriteAcknowledged?.()
  }

  async function backUpLedgersFromToolbar() {
    if (oldFavoriteOrganizationLocked()) {
      showOldFavoriteOrganizationPendingMessage()
      return
    }

    await saveLedgers({
      includeSelectedCandidates: false,
      pendingMessage: '正在备册...',
      successMessage: BACKUP_COMPLETE_MESSAGE,
      includeDefaultLedgers: true,
      saveOptions: { deleteDisabled: false },
      onSuccess: async () => {
        await onOpenFavoritePage?.()
      }
    })
  }

  async function startOrganizingOldFavorites(forceFresh = false) {
    if (oldFavoriteOrganizationLocked()) {
      showOldFavoriteOrganizationPendingMessage()
      return
    }

    if (useControlledOldFavoriteWorkspace) {
      const snapshot = await oldFavoriteWorkspace.startScan(forceFresh ? 'full' : 'incremental')
      if (snapshot?.status === 'scanning') {
        setOldFavoriteGuideMode('organize')
        setOldFavoriteStep('scan')
        setOldFavoriteExpandedStep('scan')
        setStatus('扫描概览：扫描中')
        publishOldFavoriteStatus({
          label: '旧藏扫描中',
          message: '扫描概览：扫描中',
          tone: 'running'
        })
      } else if (!snapshot) {
        setStatus('无法启动旧藏扫描，请确认 B 站页面与登录状态后重试。')
      }
      return
    }

    if (!forceFresh && preview && oldFavoriteGuideMode === 'organize') {
      setLedgerListExpanded(true)
      return
    }

    if (onPrepareOldFavoriteScan) {
      setBusy(true)
      setStatus('正在准备B站收藏环境，最长等待1分钟…')
      try {
        const prepareResult = await onPrepareOldFavoriteScan()
        if (prepareResult.ok === false) {
          setStatus(prepareResult.message || 'B站页面或登录状态尚未准备好，请确认登录后重试。')
          return
        }
        if (onReadOldFavoriteBatchStatus) {
          try {
            const batchStatus = await onReadOldFavoriteBatchStatus()
            setHasPendingOldFavoriteBatch(Boolean(batchStatus.pending))
          } catch {
            // Preparation succeeded, so a transient status-read failure must not block scanning.
          }
        }
      } catch (error) {
        setStatus(`B站收藏环境准备失败：${errorMessage(error)}`)
        return
      } finally {
        setBusy(false)
      }
    }

    setOldFavoriteGuideMode('organize')
    setOldFavoriteStep('scan')
    scanGenerationRef.current += 1
    scanStartingRef.current = true
    const scanGeneration = scanGenerationRef.current
    currentScanRunIdRef.current = null
    currentScanAccountMidRef.current = preview?.scanContext?.accountMid ?? null
    setBasicScanRunning(true)
    setPreview(null)
    const saved = await saveLedgers({
      includeSelectedCandidates: false,
      includeDefaultLedgers: true,
      pendingMessage: '正在同步整理旧藏需要的主收藏...',
      saveOptions: { deleteDisabled: false },
      onSuccess: async () => {
        if (scanGeneration !== scanGenerationRef.current || !scanStartingRef.current) return
        await scanOldFavorites()
      }
    })
    if (!saved) {
      scanStartingRef.current = false
      setBasicScanRunning(false)
      setBusy(false)
      setPreview(null)
      setBaseScanPreview(null)
      setArchivePlanState(null)
      return
    }
    if (scanGeneration !== scanGenerationRef.current || !scanStartingRef.current) return
    scanStartingRef.current = false
    currentScanRunIdRef.current = null
    currentScanAccountMidRef.current = null
    setBasicScanRunning(false)
    setPreview(lastSuccessfulPreviewRef.current)
    setBaseScanPreview(lastSuccessfulBasePreviewRef.current)
    setArchivePlanState(lastSuccessfulArchivePlanStateRef.current)
  }

  async function runOldFavoriteOrganizationRequest() {
    if (useControlledOldFavoriteWorkspace) {
      setOldFavoriteEntryOpen(false)
      await startOrganizingOldFavorites()
      return
    }
    if (activeOldFavoriteUserBatch?.status === 'active' && preview && oldFavoriteGuideMode === 'organize') {
      setOldFavoriteEntryOpen(true)
      return
    }
    setOldFavoriteEntryOpen(false)
    setOldFavoriteRecoveryRunning(true)
    setOldFavoriteRecoveryFailure(null)
    setStatus('正在恢复整理结果…')
    publishOldFavoriteStatus({
      label: '正在恢复整理结果',
      message: '正在读取最近一次整理结果，请稍候。',
      tone: 'running'
    })
    const requestAccountGeneration = accountGenerationRef.current
    const resolvedAccountMid = currentAccountMid?.trim() ||
      (onReadCurrentOldFavoriteAccount ? (await onReadCurrentOldFavoriteAccount()).trim() : '')
    if (!resolvedAccountMid) {
      setOldFavoriteRecoveryRunning(false)
      setStatus(null)
      void startOrganizingOldFavorites()
      return
    }
    oldFavoriteResolvedAccountMidRef.current = resolvedAccountMid
    let sessions: OldFavoriteSessionsState
    try {
      sessions = await openOldFavoriteSessions(resolvedAccountMid)
    } catch (error) {
      setOldFavoriteRecoveryRunning(false)
      const message = `整理存档恢复失败：${errorMessage(error)}`
      setOldFavoriteRecoveryFailure(message)
      setStatus(message)
      publishOldFavoriteStatus({ label: '恢复失败', message, tone: 'error' })
      return
    }
    if (requestAccountGeneration !== accountGenerationRef.current) {
      setOldFavoriteRecoveryRunning(false)
      return
    }
    const accountBatches = sessions.batches.filter((batch) => batch.accountMid === resolvedAccountMid)
    const summaries = accountBatches.map((batch) => ({
      id: batch.id,
      kind: batch.kind,
      createdAt: batch.createdAt,
      accountMid: batch.accountMid,
      segmentIndex: Math.max(1, batch.segments.findIndex((segment) => segment.status !== 'ended') + 1),
      segmentCount: Math.max(1, batch.segments.length),
      segmentAids: batch.segments.map((segment) => segment.aids),
      status: batch.status,
      snapshot: batch.snapshot as OldFavoriteUserBatchSummary['snapshot']
    } satisfies OldFavoriteUserBatchSummary))
    setOldFavoriteUserBatches(summaries)
    oldFavoriteUserBatchesRef.current = summaries
    const latestActiveBatch = accountBatches
      .filter((batch) => batch.status !== 'ended')
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .at(-1)
    if (latestActiveBatch) {
      const recoveryResult = await selectOldFavoriteUserBatch(latestActiveBatch.id, summaries, requestAccountGeneration)
      if (requestAccountGeneration !== accountGenerationRef.current) {
        setOldFavoriteRecoveryRunning(false)
        return
      }
      setOldFavoriteRecoveryRunning(false)
      if (recoveryResult.kind === 'rescan-required') {
        void startOrganizingOldFavorites(true)
        return
      }
      if (recoveryResult.kind !== 'restored') return
      setOldFavoriteRecoveryFailure(null)
      setStatus(null)
      const restoredCount = recoveryResult.itemCount
      publishOldFavoriteStatus({
        label: `旧藏待整理 ${restoredCount}`,
        message: `已恢复最近一次整理结果，共 ${restoredCount} 条待整理。`,
        tone: 'warn'
      })
      return
    }
    let hasPendingBatch = false
    if (onReadOldFavoriteBatchStatus) {
      const result = await onReadOldFavoriteBatchStatus().catch(() => null)
      hasPendingBatch = Boolean(result?.pending)
      if (result) setHasPendingOldFavoriteBatch(hasPendingBatch)
    }
    setOldFavoriteRecoveryRunning(false)
    setStatus(null)
    if (hasUnfinishedOldFavoriteArchive || hasPendingBatch) {
      setOldFavoriteEntryOpen(true)
      return
    }
    void startOrganizingOldFavorites(true)
  }

  function requestOldFavoriteOrganization(): Promise<void> {
    if (oldFavoriteOrganizationRequestRef.current) {
      return oldFavoriteOrganizationRequestRef.current
    }

    const request = runOldFavoriteOrganizationRequest()
    oldFavoriteOrganizationRequestRef.current = request
    const clearRequest = () => {
      if (oldFavoriteOrganizationRequestRef.current === request) {
        oldFavoriteOrganizationRequestRef.current = null
      }
    }
    void request.then(clearRequest, clearRequest)
    return request
  }

  const controlledScanSnapshot = useControlledOldFavoriteWorkspace ? oldFavoriteWorkspace.snapshot : null

  function continueLastOldFavoriteOrganization() {
    setOldFavoriteEntryOpen(false)
    const latest = unfinishedOldFavoriteBatches.at(-1)
    if (latest) selectOldFavoriteUserBatch(latest.id)
    else void startOrganizingOldFavorites()
  }

  async function resetAllOldFavoriteOrganization() {
    if (oldFavoriteResetRequestRef.current) return oldFavoriteResetRequestRef.current
    const request = (async () => {
    const resetRecoverySnapshot = {
      preview,
      baseScanPreview,
      scanProgress: scanProgressRef.current,
      archiveEditorState,
      selectedOldFavoriteSourceFolderKeys,
      selectedManagedLogicalIds,
      unlockedManagedLogicalIds,
      reorganizedProtectedAids,
      pendingUnclassifiedDecision,
      oldFavoriteUserBatches,
      activeOldFavoriteUserBatchId,
      oldFavoriteExecutionPhase,
      oldFavoriteExecutionProgress,
      oldFavoriteExecutionRun,
      oldFavoriteStep,
      lastSuccessfulPreview: lastSuccessfulPreviewRef.current,
      lastSuccessfulBasePreview: lastSuccessfulBasePreviewRef.current,
      lastSuccessfulArchivePlanState: lastSuccessfulArchivePlanStateRef.current,
      currentScanRunId: currentScanRunIdRef.current,
      currentScanAccountMid: currentScanAccountMidRef.current,
      currentScanSession: currentScanSessionRef.current,
      currentScanWorkspace: currentScanWorkspaceRef.current,
      currentScanInitialFull: currentScanInitialFullRef.current,
      oldFavoriteRecoveryOpen: oldFavoriteEntryOpen
    }
    setOldFavoriteResetConfirmOpen(false)
    setOldFavoriteRecoveryResetConfirmOpen(false)
    setOldFavoriteResetRunning(true)
    oldFavoriteResetRunningRef.current = true
    setStatus('正在清除旧整理结果…')
    publishOldFavoriteStatus({ label: '正在清除旧整理结果', message: '正在清除旧整理结果…', tone: 'running' })
    scanGenerationRef.current += 1
    accountGenerationRef.current += 1
    oldFavoriteBatchSelectionGenerationRef.current += 1
    scanStartingRef.current = false
    oldFavoriteExecutionStopRequestedRef.current = true
    currentScanRunIdRef.current = null
    currentScanAccountMidRef.current = null
    currentScanSessionRef.current = null
    currentScanWorkspaceRef.current = null
    currentScanInitialFullRef.current = false
    latestTagEnrichmentSnapshotRef.current = null
    appliedStreamingSegmentIndexesRef.current.clear()
    appliedStreamingSourceRelationsRef.current.clear()
    persistedStreamingSegmentIndexesRef.current.clear()
    persistedStreamingAidsRef.current.clear()
    streamingWorkspaceWriteTailRef.current = Promise.resolve()
    if (workspaceOverlayTimerRef.current) {
      clearTimeout(workspaceOverlayTimerRef.current)
      workspaceOverlayTimerRef.current = null
    }
    if (workspaceOverlayQueueRef.current.hasPending()) {
      await flushWorkspaceOverlayQueue().catch(() => undefined)
    }
    setBasicScanRunning(false)
    setBusy(true)
    setTagActionRunning(null)
    setOldFavoriteRecoveryRunning(false)
    setOldFavoriteRecoveryFailure(null)
    setPendingTagDeepSeekConfirming(null)
    setTagEndConfirmOpen(false)
    setOldFavoriteExecutionConfirming(false)
    setOldFavoriteExecutionProgress(null)
    setOldFavoriteExecutionRun(null)
    setOldFavoriteExecutionPhase('idle')
    setOldFavoriteRuntimeStatus(null)
    setDeepSeekArchiveResultSummary(null)
    setDeepSeekArchiveSummaryOpen(false)
    clearDeepSeekArchiveRunSnapshot({ resetHistory: true })
    setPreview(null)
    setBaseScanPreview(null)
    setScanProgress(undefined)
    setArchivePlanState(null)
    setArchiveEditorState((current) => ({
      ...current,
      archivePlanState: null,
      selectedCandidateKeys: [],
      candidateSourceLedgerIdsByItemKey: {}
    }))
    setSelectedOldFavoriteSourceFolderKeys(new Set())
    setSelectedManagedLogicalIds(new Set())
    setUnlockedManagedLogicalIds(new Set())
    setReorganizedProtectedAids(new Set())
    setPendingUnclassifiedDecision(null)
    setActiveOldFavoriteUserBatchId('')
    setOldFavoriteUserBatches([])
    oldFavoriteUserBatchesRef.current = []
    oldFavoriteSessionsOpeningRef.current = null
    oldFavoriteOrganizationRequestRef.current = null
    lastSuccessfulPreviewRef.current = null
    lastSuccessfulBasePreviewRef.current = null
    lastSuccessfulArchivePlanStateRef.current = null
    const accountMid = currentAccountMid?.trim() ||
      (onReadCurrentOldFavoriteAccount ? (await onReadCurrentOldFavoriteAccount()).trim() : '')
    if (!accountMid) {
      setStatus('无法确认当前 B 站账号，请重新登录后再整理。')
      setBusy(false)
      setOldFavoriteResetRunning(false)
      oldFavoriteResetRunningRef.current = false
      return
    }
    const accountBatchIds = new Set(oldFavoriteUserBatches
      .filter((batch) => batch.accountMid === accountMid)
      .map((batch) => batch.id))
    const previousIgnoredBatchIds = oldFavoriteIgnoredSessionBatchIdsRef.current.get(accountMid)
    const ignoredBatchIds = new Set(previousIgnoredBatchIds ?? [])
    accountBatchIds.forEach((batchId) => ignoredBatchIds.add(batchId))
    oldFavoriteIgnoredSessionBatchIdsRef.current.set(accountMid, ignoredBatchIds)
    try {
      if (window.bilimiDesktop?.resetOldFavoriteAccount) {
        await window.bilimiDesktop.resetOldFavoriteAccount(accountMid)
      } else {
        await window.bilimiDesktop?.resetOldFavoriteRuntimeAccount?.(accountMid)
        if (window.bilimiDesktop?.resetOldFavoriteSessionsAccount) {
          await window.bilimiDesktop.resetOldFavoriteSessionsAccount(accountMid)
        } else if (sessionCoordinator && accountBatchIds.size > 0) {
          const state = await sessionCoordinator.load()
          await sessionCoordinator.save({
            ...state,
            batches: state.batches.filter((batch) => !accountBatchIds.has(batch.id)),
            lease: state.lease && accountBatchIds.has(state.lease.batchId) ? null : state.lease
          })
        }
        await window.bilimiDesktop?.resetOldFavoriteWorkspaceAccount?.(accountMid)
      }
    } catch (error) {
      if (previousIgnoredBatchIds) {
        oldFavoriteIgnoredSessionBatchIdsRef.current.set(accountMid, previousIgnoredBatchIds)
      } else {
        oldFavoriteIgnoredSessionBatchIdsRef.current.delete(accountMid)
      }
      setPreview(resetRecoverySnapshot.preview)
      setBaseScanPreview(resetRecoverySnapshot.baseScanPreview)
      setScanProgress(resetRecoverySnapshot.scanProgress)
      setArchiveEditorState(resetRecoverySnapshot.archiveEditorState)
      setSelectedOldFavoriteSourceFolderKeys(resetRecoverySnapshot.selectedOldFavoriteSourceFolderKeys)
      setSelectedManagedLogicalIds(resetRecoverySnapshot.selectedManagedLogicalIds)
      setUnlockedManagedLogicalIds(resetRecoverySnapshot.unlockedManagedLogicalIds)
      setReorganizedProtectedAids(resetRecoverySnapshot.reorganizedProtectedAids)
      setPendingUnclassifiedDecision(resetRecoverySnapshot.pendingUnclassifiedDecision)
      setOldFavoriteUserBatches(resetRecoverySnapshot.oldFavoriteUserBatches)
      oldFavoriteUserBatchesRef.current = resetRecoverySnapshot.oldFavoriteUserBatches
      setActiveOldFavoriteUserBatchId(resetRecoverySnapshot.activeOldFavoriteUserBatchId)
      setOldFavoriteExecutionPhase(resetRecoverySnapshot.oldFavoriteExecutionPhase)
      setOldFavoriteExecutionProgress(resetRecoverySnapshot.oldFavoriteExecutionProgress)
      setOldFavoriteExecutionRun(resetRecoverySnapshot.oldFavoriteExecutionRun)
      setOldFavoriteStep(resetRecoverySnapshot.oldFavoriteStep)
      lastSuccessfulPreviewRef.current = resetRecoverySnapshot.lastSuccessfulPreview
      lastSuccessfulBasePreviewRef.current = resetRecoverySnapshot.lastSuccessfulBasePreview
      lastSuccessfulArchivePlanStateRef.current = resetRecoverySnapshot.lastSuccessfulArchivePlanState
      currentScanRunIdRef.current = resetRecoverySnapshot.currentScanRunId
      currentScanAccountMidRef.current = resetRecoverySnapshot.currentScanAccountMid
      currentScanSessionRef.current = resetRecoverySnapshot.currentScanSession
      currentScanWorkspaceRef.current = resetRecoverySnapshot.currentScanWorkspace
      currentScanInitialFullRef.current = resetRecoverySnapshot.currentScanInitialFull
      setOldFavoriteEntryOpen(resetRecoverySnapshot.oldFavoriteRecoveryOpen)
      const failureMessage = `全部重新整理失败：${errorMessage(error)}`
      setOldFavoriteRecoveryFailure(failureMessage)
      setStatus(failureMessage)
      setBusy(false)
      setOldFavoriteResetRunning(false)
      oldFavoriteResetRunningRef.current = false
      return
    }
    setOldFavoriteRuntimeValue('oldFavoriteRecoveryRequiresReconciliation', false)
    setOldFavoriteRuntimeValue('sharedOperationFeedback', null)
    setOldFavoriteRuntimeStatus(null)
    setOldFavoriteEntryOpen(false)
    setHasPendingOldFavoriteBatch(false)
    setOldFavoriteRecoveryFailure(null)
    setStatus('旧整理结果已清除，正在读取收藏夹列表…')
    await startOrganizingOldFavorites(true)
    })()
    oldFavoriteResetRequestRef.current = request
    try {
      await request
    } finally {
      oldFavoriteResetRequestRef.current = null
      setOldFavoriteResetRunning(false)
      oldFavoriteResetRunningRef.current = false
      setBusy(false)
    }
  }

  async function rescanRestoredOldFavoriteBatch() {
    const batch = activeOldFavoriteUserBatch
    if (!batch) {
      await scanOldFavorites('organize')
      return
    }
    try {
      await window.bilimiDesktop?.finalizeOldFavoriteWorkspaceBatch?.(batch.accountMid, batch.id)
      await endOldFavoriteSessionBatch(batch.id, new Date().toISOString())
      setOldFavoriteUserBatches((current) => current.map((candidate) =>
        candidate.id === batch.id ? { ...candidate, status: 'ended' } : candidate
      ))
      oldFavoriteUserBatchesRef.current = oldFavoriteUserBatchesRef.current.map((candidate) =>
        candidate.id === batch.id ? { ...candidate, status: 'ended' } : candidate
      )
      setActiveOldFavoriteUserBatchId('')
      await scanOldFavorites('organize', 'full')
    } catch (error) {
      setStatus(`重新扫描准备失败：${errorMessage(error)}`)
    }
  }

  async function selectOldFavoriteUserBatch(
    batchId: string,
    availableBatches: OldFavoriteUserBatchSummary[] = oldFavoriteUserBatches,
    expectedAccountGeneration = accountGenerationRef.current
  ): Promise<OldFavoriteBatchSelectionResult> {
    const selectionGeneration = oldFavoriteBatchSelectionGenerationRef.current + 1
    oldFavoriteBatchSelectionGenerationRef.current = selectionGeneration
    const selectionIsCurrent = () =>
      expectedAccountGeneration === accountGenerationRef.current &&
      selectionGeneration === oldFavoriteBatchSelectionGenerationRef.current
    if (activeOldFavoriteUserBatch && activeOldFavoriteUserBatch.id !== batchId) {
      if (workspaceOverlayTimerRef.current) {
        clearTimeout(workspaceOverlayTimerRef.current)
        workspaceOverlayTimerRef.current = null
      }
      try {
        await flushWorkspaceOverlayQueue(
          activeOldFavoriteUserBatch.accountMid,
          activeOldFavoriteUserBatch.id
        )
      } catch (error) {
        setStatus(`整理修改保存失败：${error instanceof Error ? error.message : String(error)}`)
        return { kind: 'failed' }
      }
      if (!selectionIsCurrent()) return { kind: 'failed' }
      const leavingSnapshot = {
        preview,
        baseScanPreview,
        archiveEditorState,
        step: oldFavoriteStep,
        executionPhase: oldFavoriteExecutionPhase,
        executionRun: oldFavoriteExecutionRun,
        executionProgress: oldFavoriteExecutionProgress
      }
      setOldFavoriteUserBatches((current) => current.map((batch) =>
        batch.id === activeOldFavoriteUserBatch.id
          ? { ...batch, snapshot: { ...batch.snapshot, ...leavingSnapshot } }
          : batch
      ))
    }
    setActiveOldFavoriteUserBatchId(batchId)
    const selectedBatch = availableBatches.find((batch) => batch.id === batchId)
    if (selectedBatch?.status === 'ended' && selectedBatch.snapshot?.recoveryFailure) {
      setActiveOldFavoriteUserBatchId(activeOldFavoriteUserBatchId)
      setStatus(selectedBatch.snapshot.recoveryFailure === 'empty-workspace'
        ? '该批次没有可恢复的旧藏数据。'
        : '该批次的旧藏存档已损坏，已保留记录。')
      return { kind: 'failure-history' }
    }
    let workspaceDetail: Awaited<ReturnType<NonNullable<typeof window.bilimiDesktop>['loadOldFavoriteWorkspaceBatch']>> | undefined
    if (selectedBatch?.accountMid && !selectedBatch.snapshot?.preview) {
      try {
        if (selectedBatch.status === 'active') {
          await window.bilimiDesktop?.recoverOldFavoriteWorkspaceBatch?.(
            selectedBatch.accountMid,
            selectedBatch.id
          )
          if (!selectionIsCurrent()) return { kind: 'failed' }
        }
        workspaceDetail = await window.bilimiDesktop?.loadOldFavoriteWorkspaceBatch?.(
          selectedBatch.accountMid,
          selectedBatch.id
        )
      } catch (error) {
        if (!selectionIsCurrent()) return { kind: 'failed' }
        const message = `整理存档恢复失败：${error instanceof Error ? error.message : String(error)}`
        setOldFavoriteRecoveryFailure(message)
        setStatus(message)
        publishOldFavoriteStatus({ label: '恢复失败', message, tone: 'error' })
        return { kind: 'failed' }
      }
    }
    if (!selectionIsCurrent()) return { kind: 'failed' }
    if (!selectedBatch?.snapshot?.preview && workspaceDetail) {
      const recoveryState = classifyOldFavoriteRecoveryState({
        base: workspaceDetail.base as Array<{ aid?: unknown }>,
        tags: workspaceDetail.tags as Array<{ aid?: unknown }>,
        sources: workspaceDetail.sources as Array<{ aid?: unknown }>
      })
      if (recoveryState.kind === 'rescan-required' || recoveryState.kind === 'error') {
        const message = recoveryState.reason === 'empty-workspace'
          ? '整理存档恢复失败：该批次没有可恢复的旧藏数据。'
          : `整理存档恢复失败：${recoveryState.reason}`
        setOldFavoriteRecoveryFailure(message)
        setStatus(message)
        publishOldFavoriteStatus({ label: '恢复失败', message, tone: 'error' })
        return { kind: 'failed' }
      }
      const tagsByAid = new Map((workspaceDetail.tags as Array<{ aid?: number; tags?: string[] }>)
        .filter((item) => Number.isSafeInteger(item.aid))
        .map((item) => [item.aid!, item.tags ?? []]))
      const sourcesByAid = mergePersistedOldFavoriteSources(workspaceDetail.sources as Array<{
        aid?: number
        sourceFolderIds?: string[]
        sourceFolderTitles?: string[]
      }>)
      const tagProgress: NonNullable<FavoriteLedgerPreview['scanProgress']>['tags'] = {
        completed: recoveryState.tagRecordCount,
        total: recoveryState.itemCount,
        pending: recoveryState.missingTagAids.length,
        cacheHits: recoveryState.tagRecordCount,
        succeeded: recoveryState.tagRecordCount,
        failed: Math.max(0, recoveryState.itemCount - recoveryState.tagRecordCount - recoveryState.missingTagAids.length),
        status: recoveryState.tagCoverage === 'complete' ? 'complete' : 'paused'
      }
      const loadedPreview: FavoriteLedgerPreview = {
        items: (workspaceDetail.base as FavoriteLedgerPreviewItem[]).map((item) => ({
          ...item,
          ...(tagsByAid.has(item.aid) ? { tags: [...tagsByAid.get(item.aid)!] } : {}),
          ...(sourcesByAid.has(item.aid) ? {
            sourceFolderIds: [...(sourcesByAid.get(item.aid)!.sourceFolderIds ?? [])],
            sourceFolderTitles: [...(sourcesByAid.get(item.aid)!.sourceFolderTitles ?? [])]
          } : {})
        })),
        skippedSourceFolderTitles: [],
        scanContext: {
          accountMid: selectedBatch.accountMid,
          totalUniqueVideos: recoveryState.itemCount,
          sourceFolders: [],
          activeSourceFolders: [],
          protectedVideos: [],
          managedFolders: [],
          targetMembership: {},
          multiArchiveMode: favoriteArchiveMultiMode
        },
        scanProgress: {
          basic: {
            completed: recoveryState.itemCount,
            total: recoveryState.itemCount,
            status: 'complete'
          },
          tags: tagProgress
        },
        ...(selectedBatch.status === 'active' ? {
          scanDiagnostics: {
            tagDetailRequests: recoveryState.tagRecordCount,
            tagDetailFailures: 0,
            taggedVideos: [...tagsByAid.values()].filter((tags) => tags.length > 0).length,
            untaggedVideos: [...tagsByAid.values()].filter((tags) => tags.length === 0).length,
            folderFailures: [{
              folderTitle: '恢复中的来源成员',
              failedPage: 0,
              attempts: 0,
              status: 'partial' as const,
              operation: 'target-membership' as const,
              message: '恢复后需要重新核对来源成员，完成前不可执行。',
              retainedVideoCount: workspaceDetail.base.length
            }]
          }
        } : {})
      }
      const recoveredSourceFoldersByKey = new Map<string, FavoriteSourceFolder>()
      for (const item of loadedPreview.items) {
        const ids = item.sourceFolderIds ?? []
        const titles = item.sourceFolderTitles ?? [item.sourceFolderTitle]
        for (const [index, title] of titles.entries()) {
          const id = ids[index] ?? ''
          const key = oldFavoriteSourceKey(id || undefined, title)
          const source = recoveredSourceFoldersByKey.get(key) ?? { id, title, videos: [] }
          source.videos.push(item)
          recoveredSourceFoldersByKey.set(key, source)
        }
      }
      const recoveredSourceFolders = [...recoveredSourceFoldersByKey.values()]
      loadedPreview.scanContext!.sourceFolders = recoveredSourceFolders
      loadedPreview.scanContext!.activeSourceFolders = recoveredSourceFolders
      loadedPreview.insights = emptyRecoveredOldFavoriteInsights(recoveryState.itemCount)
      const loadedPlan = createArchivePlanStateFromPreviewItems(loadedPreview.items, new Set())
      const overlays = {
        ...workspaceDetail.overlays.user,
        ...workspaceDetail.overlays.deepseek,
        ...workspaceDetail.overlays.execution
      }
      loadedPlan.items = loadedPlan.items.map((item) => {
        const overlay = overlays[String(item.aid)] as Partial<FavoriteArchivePlanItemState> | undefined
        return overlay ? {
          ...item,
          ...(Array.isArray(overlay.currentTargetLedgerIds)
            ? { currentTargetLedgerIds: [...overlay.currentTargetLedgerIds] }
            : {}),
          ...(Array.isArray(overlay.selectedTargetLedgerIds)
            ? { selectedTargetLedgerIds: [...overlay.selectedTargetLedgerIds] }
            : {}),
          ...(typeof overlay.userModified === 'boolean' ? { userModified: overlay.userModified } : {}),
          ...(overlay.lastChangeSource ? { lastChangeSource: overlay.lastChangeSource } : {})
        } : item
      })
      loadedPreview.items = applyArchivePlanToPreviewItems(loadedPreview.items, loadedPlan, draftLedgers)
      const loadedArchiveEditorState: ArchiveEditorRuntimeState = {
        archivePlanState: loadedPlan,
        selectedCandidateKeys: [],
        draftLedgers,
        candidateSourceLedgerIdsByItemKey: {}
      }
      const loadedSnapshot: NonNullable<OldFavoriteUserBatchSummary['snapshot']> = {
        preview: loadedPreview,
        baseScanPreview: loadedPreview,
        archiveEditorState: loadedArchiveEditorState,
        step: selectedBatch.status === 'ended' ? 'preview' :
          (selectedBatch.snapshot?.currentStep as OldFavoriteGuideStep | undefined) ?? 'preview',
        executionPhase: (selectedBatch.snapshot?.executionPhase as OldFavoriteExecutionPhase | undefined) ?? 'idle',
        executionRun: null,
        executionProgress: null,
        collectionSnapshot: collectionSnapshotFromPreview(loadedPreview)
      }
      setOldFavoriteUserBatches((current) => current.map((batch) =>
        batch.id === selectedBatch.id ? { ...batch, snapshot: loadedSnapshot } : batch
      ))
      setPreview(loadedPreview)
      setScanProgress(loadedPreview.scanProgress)
      setBaseScanPreview(loadedPreview)
      setArchiveEditorState(loadedArchiveEditorState)
      setSelectedOldFavoriteSourceFolderKeys(new Set(
        loadedPreview.items.flatMap((item) => oldFavoriteItemSourceKeys(item))
      ))
      setOldFavoriteStep(loadedSnapshot.step)
      setOldFavoriteExpandedStep('scan')
      setOldFavoriteExecutionPhase(loadedSnapshot.executionPhase)
      setOldFavoriteExecutionRun(null)
      setOldFavoriteExecutionProgress(null)
      setOldFavoriteGuideMode('organize')
      setPendingOldFavoriteBatchKind('full')
      return { kind: 'restored', itemCount: recoveryState.itemCount }
    }
    if (!selectedBatch?.snapshot) return { kind: 'failed' }
    setPreview(selectedBatch.snapshot.preview)
    setBaseScanPreview(selectedBatch.snapshot.baseScanPreview)
    setArchiveEditorState(selectedBatch.snapshot.archiveEditorState)
    setSelectedOldFavoriteSourceFolderKeys(new Set(
      (selectedBatch.snapshot.preview?.items ?? []).flatMap((item) => oldFavoriteItemSourceKeys(item))
    ))
    setOldFavoriteStep(selectedBatch.status === 'ended' ? 'preview' : selectedBatch.snapshot.step)
    setOldFavoriteExpandedStep('scan')
    setOldFavoriteExecutionPhase(selectedBatch.snapshot.executionPhase)
    setOldFavoriteExecutionRun(selectedBatch.snapshot.executionRun)
    setOldFavoriteExecutionProgress(selectedBatch.snapshot.executionProgress)
    setOldFavoriteGuideMode('organize')
    setPendingOldFavoriteBatchKind('full')
    return { kind: 'restored', itemCount: selectedBatch.segmentAids.flat().length }
  }

  async function startIncrementalOldFavoriteBatch() {
    if (oldFavoriteOrganizationLocked()) {
      showOldFavoriteOrganizationPendingMessage()
      return
    }
    if (activeOldFavoriteUserBatch) {
      const currentSnapshot = {
        preview,
        baseScanPreview,
        archiveEditorState,
        step: oldFavoriteStep,
        executionPhase: oldFavoriteExecutionPhase,
        executionRun: oldFavoriteExecutionRun,
        executionProgress: oldFavoriteExecutionProgress,
        collectionSnapshot: collectionSnapshotFromPreview(baseScanPreview ?? preview)
      }
      setOldFavoriteUserBatches((current) => current.map((batch) =>
        batch.id === activeOldFavoriteUserBatch.id
          ? { ...batch, snapshot: { ...batch.snapshot, ...currentSnapshot } }
          : batch
      ))
    }
    setPreview(null)
    setBaseScanPreview(null)
    setArchivePlanState(null)
    setOldFavoriteGuideMode('organize')
    setPendingOldFavoriteBatchKind('incremental')
    setOldFavoriteStep('scan')
    await scanOldFavorites('organize', 'incremental')
  }

  useEffect(() => {
    if (organizeOldFavoritesRequestSignal <= 0) {
      return
    }

    void requestOldFavoriteOrganization()
  }, [organizeOldFavoritesRequestSignal])

  function addBlankLedger() {
    const nextLedger = {
      id: customLedgerId('new-ledger'),
      displayName: BILIMI_LEDGER_PREFIX,
      keywords: [],
      ruleType: 'keyword' as const,
      enabled: false,
      priority: (draftLedgers.length + 1) * 10,
      isDefault: false
    }
    const nextLedgers = [...draftLedgers, nextLedger]

    setDraftLedgers(nextLedgers)
    setActiveLedgerId(nextLedger.id)
    setActiveLedgerIndex(nextLedgers.length - 1)
    setActiveLedgerSavedSnapshot(ledgerEditorSnapshot(nextLedger))
    setSavedLedgerSnapshots((current) => ({
      ...current,
      [ledgerDraftKey(nextLedger, nextLedgers.length - 1, nextLedgers)]: ledgerEditorSnapshot(nextLedger)
    }))
    setLedgerListExpanded(true)
    setSaveStatus(null)
  }

  function applyDefaultLedgerRules() {
    if (deepSeekArchiveRunning) {
      return
    }

    const defaultLedgers = createDefaultFavoriteLedgers().map((ledger) => ({
      ...ledger,
      enabled: false
    }))
    setDraftLedgers(defaultLedgers)
    setSavedLedgerSnapshots(Object.fromEntries(
      defaultLedgers.map((ledger, index) => [ledgerDraftKey(ledger, index, defaultLedgers), ledgerEditorSnapshot(ledger)])
    ))
    setSelectedDefaultLedgerIds(new Set())
    setActiveLedgerId(null)
    setActiveLedgerIndex(null)
    setActiveLedgerSavedSnapshot(null)
    setSelectedCandidateKeys(new Set())
    setArchivePlanState(null)
    clearDeepSeekArchiveRunSnapshot({ resetHistory: true })
    setPendingUnclassifiedDecision(null)
    setLedgerListExpanded(false)
    setStatus(null)
    setSaveStatus(null)
  }

  function resetLedgers() {
    if (deepSeekArchiveRunning) return
    setLedgerResetConfirmOpen(true)
  }

  function rebuildOldFavoriteAfterLedgerDeletion(
    nextLedgers: FavoriteLedger[],
    deletedLedger: FavoriteLedger
  ) {
    const currentPreview = preview ?? baseScanPreview
    const context = currentPreview?.scanContext
    if (!currentPreview || !context) {
      setDraftLedgers(nextLedgers)
      return
    }
    const sourceFoldersForRebuild = context.activeSourceFolders.map((folder) => ({
      ...folder,
      videos: folder.videos.map((video) => ({
        ...video,
        currentBilimiFolderIds: (video.currentBilimiFolderIds ?? []).filter(
          (folderId) => folderId !== deletedLedger.bilibiliFolderId
        ),
        desiredTargetFolderIds: (video.desiredTargetFolderIds ?? []).filter(
          (folderId) => folderId !== deletedLedger.bilibiliFolderId
        ),
        desiredTargetLedgerIds: (video.desiredTargetLedgerIds ?? []).filter(
          (ledgerId) => ledgerId !== deletedLedger.id
        )
      }))
    }))

    const deletedLedgerIds = new Set(
      nextLedgers.some((ledger) => ledger.id === deletedLedger.id) ? [] : [deletedLedger.id]
    )
    const deletedFolderIds = new Set(
      deletedLedger.bilibiliFolderId ? [deletedLedger.bilibiliFolderId] : []
    )
    const nextTargetMembership = Object.fromEntries(
      Object.entries(context.targetMembership).filter(([folderId]) => !deletedFolderIds.has(folderId))
    )
    const nextContext = {
      ...context,
      managedFolders: context.managedFolders.filter(
        (folder) => !deletedLedgerIds.has(folder.ledgerId ?? '') && !deletedFolderIds.has(folder.id)
      ),
      targetMembership: nextTargetMembership
    }
    const buildPreview = (sourceFolders: FavoriteSourceFolder[]) => {
      const rebuilt = createFavoriteLedgerPreview({
        ledgers: nextLedgers,
        sourceFolders,
        targetMembership: nextTargetMembership,
        skippedSourceFolderTitles: currentPreview.skippedSourceFolderTitles,
        scanDiagnostics: currentPreview.scanDiagnostics,
        scanProgress: currentPreview.scanProgress,
        multiArchiveMode: favoriteArchiveMultiMode
      })
      return {
        ...rebuilt,
        batch: currentPreview.batch,
        scanContext: nextContext,
        items: normalizeOldFavoritePreviewItems(rebuilt.items, nextLedgers)
      }
    }
    const rebuiltBasePreview = buildPreview(sourceFoldersForRebuild)
    const rebuiltPreview = buildPreview([
      ...sourceFoldersForRebuild,
      ...protectedVideosAsSourceFolders(reorganizedProtectedAids)
    ])
    const knownCandidates = new Map(
      [
        ...(currentPreview.insights?.candidateLedgers ?? []),
        ...(rebuiltPreview.insights?.candidateLedgers ?? [])
      ].map((candidate) => [candidateKey(candidate), candidate])
    )
    const nextSelectedCandidateKeys = new Set(
      [...selectedCandidateKeys].filter((key) => {
        const candidate = knownCandidates.get(key)
        return !candidate || !deletedLedgerIds.has(candidateLedgerId(candidate))
      })
    )
    const nextArchivePlanState = createArchivePlanStateFromPreviewItems(
      rebuiltPreview.items,
      nextSelectedCandidateKeys
    )

    setArchiveEditorState({
      archivePlanState: nextArchivePlanState,
      selectedCandidateKeys: [...nextSelectedCandidateKeys],
      draftLedgers: withSequentialPriorities(nextLedgers),
      candidateSourceLedgerIdsByItemKey: {}
    })
    setBaseScanPreview(rebuiltBasePreview)
    setPreview(rebuiltPreview)
    lastSuccessfulBasePreviewRef.current = rebuiltBasePreview
    lastSuccessfulPreviewRef.current = rebuiltPreview
    lastSuccessfulArchivePlanStateRef.current = nextArchivePlanState
    clearDeepSeekArchiveRunSnapshot({ resetHistory: true })
    setPendingUnclassifiedDecision(null)
    setStatus('本地收藏夹已删除，推荐与归档预览已更新；点击同步后才会更新 B 站。')
  }

  function deleteLedger(ledgerId: string) {
    const ledgerIndex =
      activeLedgerIndex !== null && draftLedgers[activeLedgerIndex]?.id === ledgerId
        ? activeLedgerIndex
        : draftLedgers.findIndex((ledger) => ledger.id === ledgerId)
    const deletedLedger = draftLedgers[ledgerIndex]
    if (!deletedLedger || !canDeleteLedger(deletedLedger)) return

    const nextLedgers = draftLedgers.filter((_ledger, index) => index !== ledgerIndex)
    setSavedLedgerSnapshots((current) => Object.fromEntries(
      nextLedgers.map((ledger, nextIndex) => {
        const previousIndex = nextIndex < ledgerIndex ? nextIndex : nextIndex + 1
        return [
          ledgerDraftKey(ledger, nextIndex, nextLedgers),
          current[ledgerDraftKey(draftLedgers[previousIndex], previousIndex, draftLedgers)] ?? ledgerEditorSnapshot(ledger)
        ]
      })
    ))
    if (ledgerId === activeLedgerId) {
      setActiveLedgerId(null)
      setActiveLedgerIndex(null)
      setActiveLedgerSavedSnapshot(null)
    }
    setSaveStatus(null)
    rebuildOldFavoriteAfterLedgerDeletion(nextLedgers, deletedLedger)
  }

  function toggleLedger(ledgerIndex: number) {
    const ledger = draftLedgers[ledgerIndex]
    if (!ledger) {
      return
    }
    if (ledger?.isDefault) {
      toggleDefaultLedger(ledger.id)
    }

    setDraftLedgers(
      draftLedgers.map((candidate, index) =>
        index === ledgerIndex
          ? {
              ...candidate,
              enabled: !candidate.enabled
            }
          : candidate
      )
    )
  }

  function selectLedger(ledger: FavoriteLedger, ledgerIndex: number) {
    if (activeLedgerId === ledger.id && activeLedgerIndex === ledgerIndex) {
      setActiveLedgerId(null)
      setActiveLedgerIndex(null)
      setActiveLedgerSavedSnapshot(null)
      return
    }

    setActiveLedgerId(ledger.id)
    setActiveLedgerIndex(ledgerIndex)
    setActiveLedgerSavedSnapshot(
      savedLedgerSnapshots[ledgerDraftKey(ledger, ledgerIndex, draftLedgers)] ?? ledgerEditorSnapshot(ledger)
    )
    setSaveStatus(null)
  }
  function closeActiveLedgerEditor() {
    if (!activeLedger) {
      return
    }

    if (activeLedgerHasUnsavedChanges) {
      setSaveStatus('当前收藏夹有未保存修改，请先保存。')
      return
    }

    setActiveLedgerId(null)
    setActiveLedgerIndex(null)
    setActiveLedgerSavedSnapshot(null)
  }

  function handlePanelClick(event: MouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement | null
    if (
      !target ||
      target.closest(
        '.favorite-ledger-panel__editor, .favorite-ledger-panel__chips, .favorite-ledger-panel__list-toggle, .favorite-ledger-panel__category-actions, .favorite-ledger-panel__toolbar, .favorite-ledger-panel__preview, .favorite-ledger-panel__old-favorites-guide'
      )
    ) {
      return
    }

    closeActiveLedgerEditor()
  }

  function updateActiveLedger(patch: Partial<Pick<FavoriteLedger, 'displayName' | 'keywords' | 'ruleType'>>) {
    if (!activeLedger) {
      return
    }

    setDraftLedgers((currentLedgers) => {
      setSaveStatus(null)
      return currentLedgers.map((ledger, index) =>
        index === activeLedgerIndex && ledger.id === activeLedger.id
          ? {
              ...ledger,
              ...patch
            }
          : ledger
      )
    })
  }

  function updateActiveLedgerName(name: string) {
    if (!activeLedger) {
      return
    }

    updateActiveLedger({
      displayName: isBilimiLedger(activeLedger) ? prefixedBilimiLedgerName(name) : name
    })
  }

  function toggleDefaultLedger(ledgerId: string) {
    setSaveStatus(null)
    setSelectedDefaultLedgerIds((current) => {
      const next = new Set(current)
      if (next.has(ledgerId)) {
        next.delete(ledgerId)
      } else {
        next.add(ledgerId)
      }
      return next
    })
  }

  function focusInvalidLedger(index = firstInvalidLedgerIndex) {
    const ledger = index >= 0 ? draftLedgers[index] : null
    if (!ledger) return
    setLedgerListExpanded(true)
    setActiveLedgerId(ledger.id)
    setActiveLedgerIndex(index)
    setActiveLedgerSavedSnapshot(
      savedLedgerSnapshots[ledgerDraftKey(ledger, index, draftLedgers)] ?? ledgerEditorSnapshot(ledger)
    )
    const validation = favoriteLedgerNameValidation(ledger.displayName)
    setSaveStatus(`B站收藏夹名称最多20个字，当前${validation.length}个字：${ledger.displayName}`)
  }

  function saveActiveLedgerDraft() {
    if (!activeLedger || activeLedgerIndex === null) {
      return
    }
    if (!favoriteLedgerNameValidation(activeLedger.displayName).valid) {
      focusInvalidLedger(activeLedgerIndex)
      return
    }

    const nextLedger = {
      ...activeLedger,
      displayName: normalizeBilimiLedgerName(activeLedger.displayName)
    }

    setDraftLedgers((currentLedgers) =>
      currentLedgers.map((ledger, index) =>
        index === activeLedgerIndex && ledger.id === activeLedger.id ? nextLedger : ledger
      )
    )
    setActiveLedgerSavedSnapshot(ledgerEditorSnapshot(nextLedger))
    setSavedLedgerSnapshots((current) => ({
      ...current,
      [ledgerDraftKey(nextLedger, activeLedgerIndex, draftLedgers)]: ledgerEditorSnapshot(nextLedger)
    }))
    setStatus(null)
    const keywordWarning = defaultLedgerKeywordWarning(nextLedger)
    setSaveStatus(
      keywordWarning
        ? `已保存到草稿，请勾选后点击同步。${keywordWarning}`
        : '已保存到草稿，请勾选后点击同步。'
    )
  }

  function setAllLedgersEnabled(enabled: boolean) {
    setSaveStatus(null)
    setStatus(null)
    setSelectedDefaultLedgerIds(
      enabled
        ? new Set(draftLedgers.filter((ledger) => ledger.isDefault).map((ledger) => ledger.id))
        : new Set()
    )
    setDraftLedgers((currentLedgers) =>
      currentLedgers.map((ledger) => ({
        ...ledger,
        enabled
      }))
    )
  }

  function ledgerEnabled(ledger: FavoriteLedger) {
    return ledger.isDefault ? selectedDefaultLedgerIds.has(ledger.id) : ledger.enabled
  }

  function toggleAllLedgers() {
    setAllLedgersEnabled(!draftLedgers.every(ledgerEnabled))
  }

  async function applyCandidateTransactions(
    candidates: FavoriteLedgerCandidate[],
    selected: boolean,
    reason: string
  ) {
    if (oldFavoritePlanReadOnly || deepSeekArchiveRunning || archiveBatchRunning) {
      return
    }

    if (!archivePlanState) {
      const nextCandidateKeys = new Set(selectedCandidateKeys)
      let nextLedgers = draftLedgers.map(cloneArchiveDraftLedger)
      for (const candidate of candidates) {
        const key = candidateKey(candidate)
        const ledgerId = candidateLedgerId(candidate)
        if (selected) {
          nextCandidateKeys.add(key)
          if (!nextLedgers.some((ledger) => ledger.id === ledgerId)) {
            nextLedgers.push(candidateToLedger(
              candidate,
              (nextLedgers.length + 1) * 10,
              nextLedgers.map((ledger) => ledger.displayName)
            ))
          }
        } else {
          nextCandidateKeys.delete(key)
          nextLedgers = nextLedgers.filter((ledger) => ledger.id !== ledgerId)
        }
      }
      setArchiveEditorState((current) => ({
        ...current,
        selectedCandidateKeys: [...nextCandidateKeys],
        draftLedgers: withSequentialPriorities(nextLedgers)
      }))
      return
    }

    const before: FavoriteArchiveTransactionState = {
      archivePlanState,
      selectedCandidateKeys: [...selectedCandidateKeys],
      draftLedgers,
      candidateSourceLedgerIdsByItemKey
    }
    let after = before
    const orderedCandidates = selected ? candidates : [...candidates].reverse()
    const operations = orderedCandidates.map((candidate) => {
      const key = candidateKey(candidate)
      const affectedItemKeys = (preview?.items ?? [])
        .filter(
          (item) =>
            !item.alreadyInTarget &&
            item.candidateTargets?.some((target) => target.candidateKey === key)
        )
        .map(archivePlanItemKey)
      return { candidate, key, affectedItemKeys }
    })
    const total = operations.reduce((count, operation) => count + operation.affectedItemKeys.length, 0)
    const chunked = total >= 100
    let completed = 0
    if (chunked) {
      setArchiveBatchOperationProgress({ phase: 'running', completed: 0, total })
      await yieldArchiveBatchFrame()
    }
    for (const operation of operations) {
      const itemKeyChunks = operation.affectedItemKeys.length > 0
        ? Array.from(
            { length: Math.ceil(operation.affectedItemKeys.length / 100) },
            (_, index) => operation.affectedItemKeys.slice(index * 100, (index + 1) * 100)
          )
        : [[]]
      for (const affectedItemKeys of itemKeyChunks) {
        after = applyArchiveCandidateTransaction(after, {
          candidateKey: operation.key,
          candidateLedgerId: candidateLedgerId(operation.candidate),
          candidateLedger: candidateToLedger(
            operation.candidate,
            (after.draftLedgers.length + 1) * 10,
            after.draftLedgers.map((ledger) => ledger.displayName)
          ),
          affectedItemKeys,
          selected
        })
        if (chunked) {
          completed += affectedItemKeys.length
          setArchiveBatchOperationProgress({ phase: 'running', completed, total })
          if (completed < total) await yieldArchiveBatchFrame()
        }
      }
    }

    const latestChange = latestArchiveChangeBetween(before.archivePlanState, after.archivePlanState, {
      batchReason: reason,
      forceBatch: true,
      inboxAsUnclassified: selected
    })
    if (!latestChange) {
      setArchiveEditorState({
        ...after,
        draftLedgers: withSequentialPriorities(after.draftLedgers)
      })
      if (chunked) finishArchiveBatchOperation(total)
      return
    }

    setSaveStatus(null)
    clearDeepSeekArchiveRunSnapshot()
    recordArchivePreviewHistory(before.archivePlanState, latestChange, {
      selectedCandidateKeys: before.selectedCandidateKeys,
      draftLedgers: before.draftLedgers,
      candidateSourceLedgerIdsByItemKey: before.candidateSourceLedgerIdsByItemKey
    })
    setArchiveEditorState({
      ...after,
      draftLedgers: withSequentialPriorities(after.draftLedgers)
    })
    updatePreviewFromArchivePlan(after.archivePlanState, after.draftLedgers)
    setLatestArchiveChange(latestChange)
    setArchivePreviewAlertMessages(
      [archiveChangeAlertSummary(latestChange)].filter((message): message is string => Boolean(message))
    )
    setLedgerListExpanded(true)
    if (chunked) finishArchiveBatchOperation(total)
  }

  async function setCandidateSelected(candidate: FavoriteLedgerCandidate, selected: boolean) {
    await applyCandidateTransactions(
      [candidate],
      selected,
      `${selected ? '勾选' : '取消勾选'}收藏夹「${candidate.displayName}」`
    )
    if (activeOldFavoriteUserBatch) {
      const stableKey = candidateKey(candidate)
      setOldFavoriteUserBatches((current) => current.map((batch) => {
        if (batch.id !== activeOldFavoriteUserBatch.id) return batch
        const recommendations = batch.snapshot?.recommendations ?? {
          entries: [], scannedSegmentIndexes: []
        }
        const adopted = new Set(recommendations.adoptedStableKeys ?? [])
        if (selected) adopted.add(stableKey)
        else adopted.delete(stableKey)
        const matchingEntries = recommendations.entries.filter((entry) => entry.stableKey === stableKey)
        const adoptionState = recommendations.adoptionState && matchingEntries.length > 0
          ? applyBatchRecommendation(recommendations.adoptionState, {
              ...matchingEntries[0],
              matchedAids: [...new Set(matchingEntries.flatMap((entry) => entry.matchedAids))],
              matchedItemKeys: [...new Set(matchingEntries.flatMap((entry) => entry.matchedItemKeys))]
            }, selected)
          : recommendations.adoptionState
        return {
          ...batch,
          snapshot: batch.snapshot ? {
            ...batch.snapshot,
            recommendations: { ...recommendations, adoptedStableKeys: [...adopted], adoptionState }
          } : batch.snapshot
        }
      }))
    }
    if (!selected) {
      setStatus('已取消批次推荐；只恢复未执行的自动分类，人工修改和已执行结果保持不变。')
    }
  }

  function setCandidateGroupSelected(candidates: FavoriteLedgerCandidate[], selected: boolean) {
    if (oldFavoritePlanReadOnly || deepSeekArchiveRunning || archiveBatchRunning) {
      return
    }

    applyCandidateTransactions(
      candidates,
      selected,
      candidates.length === 1
        ? `${selected ? '勾选' : '取消勾选'}收藏夹「${candidates[0].displayName}」`
        : `${selected ? '勾选' : '取消勾选'} ${candidates.length} 个收藏夹`
    )
  }

  function switchOldFavoriteStep(stepId: OldFavoriteGuideStep) {
    setOldFavoriteStep(stepId)
    setOldFavoriteExpandedStep((current) => current === stepId ? null : stepId)
  }

  function applyCompletedTagSnapshot(
    snapshot: OldFavoriteTagEnrichmentSnapshot,
    scanGeneration: number
  ) {
    if (!oldFavoriteExecutionAllowsPlanUpdates(
      getOldFavoriteRuntimeValue<OldFavoriteExecutionPhase>('oldFavoriteExecutionPhase', 'idle')
    )) return
    if (scanGeneration !== scanGenerationRef.current) return
    const context = baseScanPreview?.scanContext ?? preview?.scanContext
    if (!context) return

    const latestVideosByAid = new Map(
      snapshot.sourceFolders.flatMap((folder) => folder.videos).map((video) => [video.aid, video])
    )
    const transientCandidateLedgerIds = new Set(
      (preview?.insights?.candidateLedgers ?? []).map(candidateLedgerId)
    )
    const refreshLedgers = draftLedgers.filter((ledger) => !transientCandidateLedgerIds.has(ledger.id))
    const withLatestTags = (folders: FavoriteSourceFolder[]) => folders.map((folder) => ({
      ...folder,
      videos: folder.videos.map((video) => {
        const latest = latestVideosByAid.get(video.aid)
        return latest ? {
          ...video,
          title: latest.title || video.title,
          author: latest.author ?? video.author,
          description: latest.description ?? video.description,
          category: latest.category ?? video.category,
          tags: latest.tags
        } : video
      })
    }))
    const latestActiveSourceFolders = withLatestTags(context.activeSourceFolders)
    const nextContext = {
      ...context,
      activeSourceFolders: latestActiveSourceFolders,
      multiArchiveMode: favoriteArchiveMultiMode
    }
    const buildPreview = (sourceFolders: FavoriteSourceFolder[]) => {
      const rebuilt = createFavoriteLedgerPreview({
        ledgers: refreshLedgers,
        sourceFolders,
        targetMembership: context.targetMembership,
        skippedSourceFolderTitles: preview?.skippedSourceFolderTitles,
        scanDiagnostics: preview?.scanDiagnostics,
        scanProgress: snapshot.scanProgress,
        multiArchiveMode: favoriteArchiveMultiMode
      })
      return {
        ...rebuilt,
        scanContext: nextContext,
        items: normalizeOldFavoritePreviewItems(rebuilt.items, draftLedgers)
      }
    }

    const refreshedBase = buildPreview(latestActiveSourceFolders)
    const protectedSources = withLatestTags(protectedVideosAsSourceFolders(reorganizedProtectedAids))
    const refreshedPreview = protectedSources.length === 0
      ? refreshedBase
      : buildPreview([...latestActiveSourceFolders, ...protectedSources])
    const nextState = createArchivePlanStateFromPreviewItems(
      refreshedPreview.items,
      selectedCandidateKeys
    )
    const currentItemsByKey = new Map(archivePlanState?.items.map((item) => [item.itemKey, item]) ?? [])
    nextState.items = nextState.items.map((item) => {
      const existing = currentItemsByKey.get(item.itemKey)
      return existing?.userModified ? {
        ...item,
        currentTargetLedgerIds: existing.currentTargetLedgerIds,
        selectedTargetLedgerIds: existing.selectedTargetLedgerIds,
        userModified: true,
        lastChangeSource: existing.lastChangeSource
      } : item
    })
    refreshedPreview.items = applyArchivePlanToPreviewItems(
      refreshedPreview.items,
      nextState,
      draftLedgers
    )
    setBaseScanPreview(refreshedBase)
    setPreview(refreshedPreview)
    setArchivePlanState(nextState)
    lastSuccessfulPreviewRef.current = refreshedPreview
    lastSuccessfulBasePreviewRef.current = refreshedBase
    lastSuccessfulArchivePlanStateRef.current = nextState
    const failedCount = snapshot.scanProgress.tags.failed ?? 0
    setStatus(failedCount > 0
      ? `扫描已完成，${failedCount} 条视频未取得标签。`
      : '扫描已完成。')
  }

  function candidateToLedger(
    candidate: FavoriteLedgerCandidate,
    priority: number,
    existingDisplayNames: Iterable<string> = draftLedgers.map((ledger) => ledger.displayName),
    peerCandidates: Iterable<FavoriteLedgerCandidate> = preview?.insights?.candidateLedgers ?? [candidate]
  ): FavoriteLedger {
    return {
      id: candidateLedgerId(candidate),
      displayName: recommendedCandidateDisplayName(
        candidate,
        existingDisplayNames,
        peerCandidates
      ),
      keywords: candidateLedgerKeywords(candidate),
      ruleType: candidateRuleType(candidate),
      enabled: true,
      priority,
      isDefault: false
    }
  }

  function handleLedgerDragStart(event: DragEvent<HTMLDivElement>, ledgerIndex: number) {
    const ledger = draftLedgers[ledgerIndex]
    if (!ledger) return
    const ledgerKey = ledgerDraftKey(ledger, ledgerIndex, draftLedgers)
    setDraggedLedgerKey(ledgerKey)
    setDragTargetLedgerKey(null)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', ledgerKey)
  }

  function handleLedgerDragOver(event: DragEvent<HTMLDivElement>, targetLedgerIndex: number) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const targetLedger = draftLedgers[targetLedgerIndex]
    if (!targetLedger) return
    const targetLedgerKey = ledgerDraftKey(targetLedger, targetLedgerIndex, draftLedgers)
    if (!draggedLedgerKey || draggedLedgerKey === targetLedgerKey) {
      setDragTargetLedgerKey(null)
      return
    }

    if (dragTargetLedgerKey === targetLedgerKey) {
      return
    }

    setDragTargetLedgerKey(targetLedgerKey)
  }

  function handleLedgerDrop(event: DragEvent<HTMLDivElement>, targetLedgerIndex: number) {
    event.preventDefault()
    const targetLedger = draftLedgers[targetLedgerIndex]
    const targetLedgerKey = targetLedger
      ? ledgerDraftKey(targetLedger, targetLedgerIndex, draftLedgers)
      : null
    const sourceLedgerKey = event.dataTransfer?.getData('text/plain') || draggedLedgerKey
    setDraggedLedgerKey(null)
    setDragTargetLedgerKey(null)
    if (!sourceLedgerKey || !targetLedgerKey) {
      return
    }

    setDraftLedgers((currentLedgers) => {
      const activeLedgerBeforeReorder = activeLedgerIndex === null
        ? null
        : currentLedgers[activeLedgerIndex] ?? null
      const reorderedRaw = reorderLedgers(currentLedgers, sourceLedgerKey, targetLedgerKey)
      const reordered = withSequentialPriorities(reorderedRaw)
      if (activeLedgerBeforeReorder) {
        setActiveLedgerIndex(reorderedRaw.findIndex((ledger) => ledger === activeLedgerBeforeReorder))
      }
      setSavedLedgerSnapshots((current) => Object.fromEntries(
        reorderedRaw.map((ledger, nextIndex) => {
          const previousIndex = currentLedgers.findIndex((candidate) => candidate === ledger)
          const saved = previousIndex >= 0
            ? current[ledgerDraftKey(currentLedgers[previousIndex], previousIndex, currentLedgers)]
            : undefined
          return [ledgerDraftKey(ledger, nextIndex, reorderedRaw), saved ?? ledgerEditorSnapshot(ledger)]
        })
      ))
      return reordered
    })
    setSaveStatus(null)
  }

  function finishLedgerDrag() {
    setDraggedLedgerKey(null)
    setDragTargetLedgerKey(null)
  }

  function buildLedgersToSave(includeSelectedCandidates = true, includeDefaultLedgers = false) {
    const candidates = preview?.insights?.candidateLedgers ?? []
    const selectedCandidates = candidates.filter((candidate) =>
      selectedCandidateKeys.has(candidateKey(candidate))
    )
    const defaultEnabledById = new Map(
      createDefaultFavoriteLedgers().map((ledger) => [ledger.id, ledger.enabled])
    )
    const ledgersToBuild = includeDefaultLedgers ? mergeDefaultLedgers(draftLedgers) : draftLedgers
    const nextLedgers = withSequentialPriorities(
      ledgersToBuild.map((ledger) =>
        ledger.isDefault
          ? {
              ...ledger,
              displayName: normalizeBilimiLedgerName(ledger.displayName),
              enabled: includeDefaultLedgers
                ? (defaultEnabledById.get(ledger.id) ?? selectedDefaultLedgerIds.has(ledger.id))
                : selectedDefaultLedgerIds.has(ledger.id)
            }
          : {
              ...ledger,
              displayName: normalizeBilimiLedgerName(ledger.displayName)
            }
      )
    )

    for (const candidate of includeSelectedCandidates ? selectedCandidates : []) {
      if (nextLedgers.some((ledger) => ledger.id === candidateLedgerId(candidate))) {
        continue
      }
      const displayName = recommendedCandidateDisplayName(
        candidate,
        nextLedgers.map((ledger) => ledger.displayName),
        candidates
      )
      if (alreadyHasLedger(nextLedgers, displayName)) {
        continue
      }

      nextLedgers.push(candidateToLedger(
        candidate,
        (nextLedgers.length + 1) * 10,
        nextLedgers.map((ledger) => ledger.displayName),
        candidates
      ))
    }

    return nextLedgers
  }

  async function saveLedgers(options: {
    includeSelectedCandidates?: boolean
    includeDefaultLedgers?: boolean
    successMessage?: string
    pendingMessage?: string
    onSuccess?: () => Promise<void> | void
    saveOptions?: FavoriteLedgerSaveOptions
  } = {}): Promise<boolean> {
    if (firstInvalidLedgerIndex >= 0) {
      focusInvalidLedger(firstInvalidLedgerIndex)
      return false
    }
    const nextLedgers = buildLedgersToSave(
      options.includeSelectedCandidates ?? true,
      options.includeDefaultLedgers ?? false
    )

    setBusy(true)
    setStatus(null)
    setSaveStatus(options.pendingMessage ?? '正在保存...')
    try {
      const result =
        options.saveOptions === undefined
          ? await onSaveLedgers(nextLedgers)
          : await onSaveLedgers(nextLedgers, options.saveOptions)
      if (options.includeDefaultLedgers && result?.ok !== false) {
        setDraftLedgers(nextLedgers)
        setSelectedDefaultLedgerIds(
          new Set(
            nextLedgers
              .filter((ledger) => ledger.enabled && ledger.isDefault)
              .map((ledger) => ledger.id)
          )
        )
      }
      if (options.successMessage && result?.ok !== false) {
        setSaveStatus(null)
        setStatus(options.successMessage)
      } else {
        setSaveStatus(saveStatusMessage(result))
      }
      setActiveLedgerId(null)
      setActiveLedgerIndex(null)
      setActiveLedgerSavedSnapshot(null)
      if (result?.ok !== false) {
        await options.onSuccess?.()
        return true
      }
      return false
    } catch (error) {
      setSaveStatus(`同步未完成：${errorMessage(error)}`)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function scanOldFavorites(
    mode: 'setup' | 'organize' = 'organize',
    requestedBatchKind?: 'full' | 'incremental'
  ) {
    let scanSession: { batchId: string; segmentId: string } | null = null
    let scanAccountMid = ''
    if (!scanStartingRef.current) scanGenerationRef.current += 1
    tagActionTokenRef.current += 1
    terminalTagScanGenerationRef.current = null
    setTagActionRunning(null)
    scanStartingRef.current = false
    latestTagEnrichmentSnapshotRef.current = null
    appliedStreamingSegmentIndexesRef.current.clear()
    appliedStreamingSourceRelationsRef.current.clear()
    persistedStreamingSegmentIndexesRef.current.clear()
    persistedStreamingAidsRef.current.clear()
    streamingWorkspaceWriteTailRef.current = Promise.resolve()
    currentScanWorkspaceRef.current = null
    currentScanInitialFullRef.current = false
    setPendingTagDeepSeekConfirming(null)
    const scanGeneration = scanGenerationRef.current
    currentScanRunIdRef.current = null
    currentScanAccountMidRef.current = preview?.scanContext?.accountMid ?? null
    setBusy(true)
    setBasicScanRunning(true)
    setOldFavoriteStep('scan')
    setOldFavoriteGuideMode(mode)
    setSaveStatus(null)
    setArchiveMultiModeChange(null)
    setDeepSeekArchiveResultSummary(null)
    setDeepSeekArchiveSummaryOpen(false)
    clearDeepSeekArchiveRunSnapshot()
    setOldFavoriteExecutionProgress(null)
    oldFavoriteExecutionStopRequestedRef.current = false
    setOldFavoriteExecutionStopping(false)
    setScanProgress({
      basic: { completed: 0, total: 0, status: 'running', phase: 'listing' },
      tags: { completed: 0, total: 0, pending: 0, cacheHits: 0, succeeded: 0, failed: 0, status: 'idle' }
    })
    setStatus('正在扫描旧藏，请稍候。')
    publishOldFavoriteStatus({
      label: '旧藏扫描中',
      message: '正在扫描旧藏，请稍候。',
      tone: 'running'
    })
    try {
      currentScanInitialFullRef.current = (requestedBatchKind ?? pendingOldFavoriteBatchKind) === 'full' &&
        !oldFavoriteUserBatchesRef.current.some((batch) => batch.status !== 'ended')
      if (sessionOrchestrator && onReadCurrentOldFavoriteAccount) {
        const currentAccountMid = (await onReadCurrentOldFavoriteAccount()).trim()
        if (!currentAccountMid) {
          setStatus('无法确认当前 B 站账号，请重新登录后再整理。')
          return
        }
        const requestedKind = currentScanInitialFullRef.current
          ? 'full'
          : (requestedBatchKind ?? pendingOldFavoriteBatchKind)
        const started = await sessionOrchestrator.beginScan({
          accountMid: currentAccountMid,
          kind: requestedKind,
          now: new Date().toISOString(),
          snapshot: { currentStep: 'scan' }
        })
        if (!started.acquired) {
          setStatus('另一个整理任务正在运行，请稍后继续。')
          return
        }
        scanSession = {
          batchId: started.batch.id,
          segmentId: started.batch.segments[0].id
        }
        currentScanSessionRef.current = { batchId: started.batch.id, kind: started.batch.kind }
        if (
          started.batch.kind === 'full' &&
          currentScanInitialFullRef.current &&
          window.bilimiDesktop?.createOldFavoriteWorkspaceBatch
        ) {
          const workspaceBatch = await window.bilimiDesktop.createOldFavoriteWorkspaceBatch({
            accountMid: currentAccountMid,
            kind: started.batch.kind,
            createdAt: started.batch.createdAt,
            id: started.batch.id
          })
          const workspaceBatchId = typeof workspaceBatch === 'object' && workspaceBatch &&
            typeof (workspaceBatch as { id?: unknown }).id === 'string'
            ? (workspaceBatch as { id: string }).id
            : started.batch.id
          if (workspaceBatchId !== started.batch.id) {
            await guardedSessionUpdateSegment(started.batch.id, started.batch.segments[0].id, currentAccountMid, {
              status: 'ended', taskStatus: 'ended', requestState: 'idle'
            })
            if (sessionCoordinator) {
              await endOldFavoriteSessionBatch(started.batch.id, new Date().toISOString())
              const state = await sessionCoordinator.load()
              const orphanAlreadyIndexed = state.batches.some((batch) => batch.id === workspaceBatchId)
              if (!orphanAlreadyIndexed) {
                const imported = createOldFavoriteBatch({
                  accountMid: currentAccountMid,
                  kind: 'full',
                  aids: [],
                  now: typeof workspaceBatch === 'object' && workspaceBatch &&
                    typeof (workspaceBatch as { createdAt?: unknown }).createdAt === 'string'
                    ? (workspaceBatch as { createdAt: string }).createdAt
                    : started.batch.createdAt,
                  id: workspaceBatchId,
                  snapshot: { currentStep: 'scan' }
                })
                await sessionCoordinator.save({ ...state, batches: [...state.batches, imported] })
              } else {
                await sessionCoordinator.save(state)
              }
              await sessionCoordinator.release(started.batch.id, started.batch.segments[0].id)
            }
            setStatus('检测到另一份未结束的完整整理批次，请重新打开整理旧藏恢复该批次。')
            return
          }
          currentScanWorkspaceRef.current = { accountMid: currentAccountMid, batchId: workspaceBatchId }
        }
        scanAccountMid = currentAccountMid
        await guardedSessionUpdateSegment(scanSession.batchId, scanSession.segmentId, scanAccountMid, {
          requestState: 'in-flight'
        })
      }
      if (
        !currentScanWorkspaceRef.current &&
        currentScanInitialFullRef.current &&
        (requestedBatchKind ?? pendingOldFavoriteBatchKind) === 'full' &&
        window.bilimiDesktop?.createOldFavoriteWorkspaceBatch
      ) {
        const accountMid = scanAccountMid || currentAccountMid?.trim() || ''
        if (accountMid) {
          const kind = 'full'
          const createdAt = new Date().toISOString()
          const batchId = `old-favorite:${accountMid}:${kind}:${createdAt.replace(/[^0-9]/g, '')}:0`
          const workspaceBatch = await window.bilimiDesktop.createOldFavoriteWorkspaceBatch({
            accountMid, kind, createdAt, id: batchId
          })
          const workspaceBatchId = typeof workspaceBatch === 'object' && workspaceBatch &&
            typeof (workspaceBatch as { id?: unknown }).id === 'string'
            ? (workspaceBatch as { id: string }).id
            : batchId
          currentScanWorkspaceRef.current = { accountMid, batchId: workspaceBatchId }
        }
      }
      if (onReadOldFavoriteTagEnrichment) {
        void onReadOldFavoriteTagEnrichment('progress').then((snapshot) => {
          if (scanGeneration !== scanGenerationRef.current) return
          if (tagSnapshotGate(scanGeneration, snapshot) !== 'accepted') return
          applyStreamingSnapshot(snapshot, scanGeneration)
          setScanProgress(mergeScanProgress(scanProgressRef.current, snapshot.scanProgress))
        }).catch((error) => {
          if (scanGeneration === scanGenerationRef.current) {
            setStatus(`扫描进度读取失败：${error instanceof Error ? error.message : String(error)}`)
          }
        })
      }
      const nextPreview = await onScanOldFavorites({
        multiArchiveMode: favoriteArchiveMultiMode
      })
      if (scanGeneration !== scanGenerationRef.current) return
      if (nextPreview.ok === false) {
        if (scanSession && sessionOrchestrator) {
          await guardedSessionUpdateSegment(scanSession.batchId, scanSession.segmentId, scanAccountMid, {
            status: 'paused',
            taskStatus: 'paused',
            requestState: 'idle',
            snapshot: { currentStep: 'scan' }
          })
        }
        setPreview(null)
        setBaseScanPreview(null)
        setReorganizedProtectedAids(new Set())
        setArchivePlanState(null)
        clearDeepSeekArchiveRunSnapshot({ resetHistory: true })
        setPendingUnclassifiedDecision(null)
        const failureMessage = `整理旧藏未完成：${nextPreview.message || '请稍后重试。'}`
        setStatus(failureMessage)
        publishOldFavoriteStatus({
          label: '扫描失败',
          message: failureMessage,
          tone: 'error'
        })
        return
      }

      const scannedAccountMid = nextPreview.scanContext?.accountMid?.trim() ||
        scanAccountMid || currentAccountMid?.trim() || ''
      if (!nextPreview.scanProgress && scannedAccountMid && onReadOldFavoriteTagEnrichment) {
        const currentSnapshot = await onReadOldFavoriteTagEnrichment('progress').catch(() => null)
        if (scanGeneration !== scanGenerationRef.current) return
        if (currentSnapshot?.accountMid && currentSnapshot.accountMid !== scannedAccountMid) {
          if (scanSession && sessionOrchestrator) {
            await guardedSessionUpdateSegment(scanSession.batchId, scanSession.segmentId, scannedAccountMid, {
              status: 'paused',
              taskStatus: 'paused',
              requestState: 'idle',
              snapshot: { currentStep: 'scan' }
            })
          }
          if (currentSnapshot.accountMid) bindOldFavoriteRuntimeAccount(currentSnapshot.accountMid)
          setPreview(null)
          setBaseScanPreview(null)
          setArchivePlanState(null)
      setBasicScanRunning(false)
      currentScanSessionRef.current = null
          setStatus('检测到账号已切换，请重新扫描当前账号。')
          return
        }
      }

      const finalRunId = nextPreview.scanProgress?.basic.runId?.trim() || null
      currentScanRunIdRef.current = finalRunId
      currentScanAccountMidRef.current = scannedAccountMid || null

      const accountChanged = bindOldFavoriteRuntimeAccount(scannedAccountMid)
      const scanDraftLedgers = accountChanged
        ? ledgers.map(cloneArchiveDraftLedger)
        : draftLedgers
      if (accountChanged) {
        setDraftLedgers(scanDraftLedgers)
      }
      const normalizedPreview = {
        ...nextPreview,
        items: normalizeOldFavoritePreviewItems(nextPreview.items, scanDraftLedgers)
      }
      const batchKind = oldFavoriteUserBatches.length === 0
        ? 'full'
        : (requestedBatchKind ?? pendingOldFavoriteBatchKind)
      const createdAt = new Date().toISOString()
      const sessionState: OldFavoriteSessionsState = {
        version: OLD_FAVORITE_SESSIONS_VERSION,
        batches: oldFavoriteUserBatches
          .filter((batch) => batch.status === 'active')
          .map((batch) => createOldFavoriteBatch({
            id: batch.id,
            accountMid: batch.accountMid,
            kind: batch.kind,
            aids: batch.segmentAids.flat(),
            now: batch.createdAt
          })),
        lease: null
      }
      const candidateAids = normalizedPreview.items.map((item) => item.aid)
      const ownedAids = acquireAidOwnership(sessionState, scannedAccountMid, candidateAids)
      const previousCollectionSnapshot = oldFavoriteUserBatches
        .slice()
        .reverse()
        .find((batch) => batch.accountMid === scannedAccountMid && batch.id !== scanSession?.batchId)
        ?.snapshot?.collectionSnapshot ?? []
      const protectedAids = normalizedPreview.scanContext?.protectedVideos?.map((item) => item.aid) ?? []
      const includedAids = batchKind === 'incremental'
        ? buildIncrementalBatchAids({
            previous: previousCollectionSnapshot,
            current: collectionSnapshotFromPreview(normalizedPreview),
            protectedAids,
            activeOwnedAids: candidateAids.filter((aid) => !ownedAids.includes(aid))
          })
        : candidateAids
      const includedAidSet = new Set(includedAids)
      normalizedPreview.items = normalizedPreview.items.filter((item) => includedAidSet.has(item.aid))
      if (batchKind === 'incremental' && includedAids.length === 0) {
        if (scanSession && sessionOrchestrator) {
          await sessionOrchestrator.discardBatch(scanSession.batchId, scannedAccountMid)
        }
        const previousBatch = oldFavoriteUserBatches.at(-1)
        if (previousBatch) selectOldFavoriteUserBatch(previousBatch.id)
        setBasicScanRunning(false)
        setBusy(false)
        setStatus('暂未发现需要新增整理的视频')
        publishOldFavoriteStatus({
          label: '暂无新增视频',
          message: '暂未发现需要新增整理的视频',
          tone: 'idle'
        })
        return
      }
      const batchModel = scanSession && sessionOrchestrator
        ? await guardOldFavoriteBatchWrite(
            sessionOrchestrator,
            { batchId: scanSession.batchId, segmentId: scanSession.segmentId, accountMid: scannedAccountMid },
            () => sessionOrchestrator.appendDiscoveredAids(scanSession!.batchId, includedAids)
          ).then(() => guardOldFavoriteBatchWrite(
            sessionOrchestrator,
            { batchId: scanSession!.batchId, segmentId: scanSession!.segmentId, accountMid: scannedAccountMid },
            () => sessionOrchestrator.completeScan(scanSession!.batchId, {
              preview: normalizedPreview,
              currentStep: 'preview',
              statistics: { scanned: normalizedPreview.items.length }
            })
          ))
        : createOldFavoriteBatch({
            accountMid: scannedAccountMid, kind: batchKind, aids: includedAids, now: createdAt,
            id: currentScanWorkspaceRef.current?.batchId
          })
      if (scanGeneration !== scanGenerationRef.current) return
      if (scannedAccountMid && window.bilimiDesktop?.createOldFavoriteWorkspaceBatch) {
        await streamingWorkspaceWriteTailRef.current
        if (scanGeneration !== scanGenerationRef.current) return
        if (!currentScanWorkspaceRef.current) {
          const workspaceBatch = await window.bilimiDesktop.createOldFavoriteWorkspaceBatch({
            accountMid: scannedAccountMid,
            kind: batchKind,
            createdAt: batchModel.createdAt,
            id: batchModel.id
          })
          const workspaceBatchId = typeof workspaceBatch === 'object' && workspaceBatch &&
            typeof (workspaceBatch as { id?: unknown }).id === 'string'
            ? (workspaceBatch as { id: string }).id
            : batchModel.id
          currentScanWorkspaceRef.current = { accountMid: scannedAccountMid, batchId: workspaceBatchId }
        }
        const workspaceBatchId = currentScanWorkspaceRef.current.batchId
        if (scanSession && workspaceBatchId !== batchModel.id) {
          throw new Error('检测到另一份未结束的完整整理批次，请重新打开整理旧藏恢复该批次。')
        }
        const chunkSize = 500
        const unpersistedItems = normalizedPreview.items.filter(
          (item) => !persistedStreamingAidsRef.current.has(item.aid)
        )
        for (let offset = 0; offset < unpersistedItems.length; offset += chunkSize) {
          if (scanGeneration !== scanGenerationRef.current) return
          const chunk = unpersistedItems.slice(offset, offset + chunkSize)
          await appendWorkspaceLogicalChunk(scannedAccountMid, workspaceBatchId, chunk)
        }
      }
      if (scanGeneration !== scanGenerationRef.current) return
      const persistedBatchId = currentScanWorkspaceRef.current?.batchId ?? batchModel.id
      const persistedBatchModel = persistedBatchId === batchModel.id ? batchModel : { ...batchModel, id: persistedBatchId }
      if (sessionCoordinator && !scanSession) {
        const storedSessions = await sessionCoordinator.load()
        await sessionCoordinator.save({
          ...storedSessions,
          batches: [
            ...storedSessions.batches.filter((batch) => batch.id !== persistedBatchId),
            {
              ...persistedBatchModel,
              snapshot: {
                preview: normalizedPreview,
                currentStep: 'scan',
                statistics: { scanned: normalizedPreview.items.length }
              }
            }
          ]
        })
      }
      const segmentAids = batchModel.segments.map((segment) => segment.aids)
      const segmentCount = Math.max(1, segmentAids.length)
      const transientStreamingBatch = oldFavoriteUserBatchesRef.current.find(
        (batch) => batch.id === `stream:${scannedAccountMid ?? ''}`
      )
      const existingStreamingBatch = oldFavoriteUserBatchesRef.current.find(
        (batch) => batch.id === persistedBatchId
      ) ?? (currentScanSessionRef.current?.batchId
        ? oldFavoriteUserBatchesRef.current.find((batch) => batch.id === currentScanSessionRef.current?.batchId)
        : transientStreamingBatch)
      const liveSegmentSnapshot = currentSegmentSnapshot()
      const rawSegmentSnapshots = {
        ...existingStreamingBatch?.snapshot?.segmentSnapshots,
        ...(liveSegmentSnapshot && appliedStreamingSegmentIndexesRef.current.size > 0 ? {
          [(existingStreamingBatch?.segmentIndex ?? 1) - 1]: liveSegmentSnapshot
        } : {})
      }
      const finalItemsByAid = new Map(normalizedPreview.items.map((item) => [item.aid, item]))
      const preservedSegmentSnapshots = Object.fromEntries(
        Object.entries(rawSegmentSnapshots).map(([index, segmentSnapshot]) => {
          const reconciledItems = segmentSnapshot.preview.items.map((item) =>
            finalItemsByAid.get(item.aid) ?? item
          )
          const rebuiltState = createArchivePlanStateFromPreviewItems(reconciledItems, selectedCandidateKeys)
          const existingPlanByAid = new Map(
            segmentSnapshot.archiveEditorState.archivePlanState?.items.map((item) => [item.aid, item]) ?? []
          )
          rebuiltState.items = rebuiltState.items.map((item) => {
            const existing = existingPlanByAid.get(item.aid)
            return existing?.userModified || existing?.lastChangeSource === 'deepseek' ? {
              ...item,
              currentTargetLedgerIds: existing.currentTargetLedgerIds,
              selectedTargetLedgerIds: existing.selectedTargetLedgerIds,
              userModified: existing.userModified,
              lastChangeSource: existing.lastChangeSource
            } : item
          })
          const reconciledPreview = {
            ...segmentSnapshot.preview,
            scanProgress: normalizedPreview.scanProgress,
            scanContext: normalizedPreview.scanContext,
            batch: normalizedPreview.batch,
            items: applyArchivePlanToPreviewItems(reconciledItems, rebuiltState, draftLedgers)
          }
          return [Number(index), {
            preview: reconciledPreview,
            baseScanPreview: { ...reconciledPreview, items: reconciledItems },
            archiveEditorState: {
              ...segmentSnapshot.archiveEditorState,
              archivePlanState: rebuiltState
            },
            finalReconciled: true
          }]
        })
      )
      const preservedActiveSegment = preservedSegmentSnapshots[(existingStreamingBatch?.segmentIndex ?? 1) - 1]
      const nextBatch: OldFavoriteUserBatchSummary = {
        id: persistedBatchId,
        kind: batchKind,
        createdAt: batchModel.createdAt,
        accountMid: batchModel.accountMid,
        segmentIndex: existingStreamingBatch?.segmentIndex ?? 1,
        segmentCount,
        segmentAids,
        status: 'active',
        snapshot: {
          preview: normalizedPreview,
          baseScanPreview: normalizedPreview,
          archiveEditorState,
          step: 'scan',
          executionPhase: 'idle',
          executionRun: null,
          executionProgress: null,
          collectionSnapshot: collectionSnapshotFromPreview(normalizedPreview),
          segmentExecution: buildOldFavoriteSegmentExecution(segmentAids, normalizedPreview.items),
          segmentSnapshots: preservedSegmentSnapshots
        }
      }
      setOldFavoriteUserBatches((current) => [
        ...current.filter((batch) => batch.id !== nextBatch.id && batch.id !== transientStreamingBatch?.id),
        nextBatch
      ])
      setActiveOldFavoriteUserBatchId(persistedBatchId)

      const nextCandidateKeys = new Set(
        preservedActiveSegment?.archiveEditorState.selectedCandidateKeys ?? []
      )
      setPreview(preservedActiveSegment?.preview ?? normalizedPreview)
      setScanProgress(normalizedPreview.scanProgress)
      setBaseScanPreview(preservedActiveSegment?.baseScanPreview ?? normalizedPreview)
      if (preservedActiveSegment) setArchiveEditorState(preservedActiveSegment.archiveEditorState)
      lastSuccessfulPreviewRef.current = preservedActiveSegment?.preview ?? normalizedPreview
      lastSuccessfulBasePreviewRef.current = preservedActiveSegment?.baseScanPreview ?? normalizedPreview
      setReorganizedProtectedAids(new Set())
      setProtectedReorganizationConfirming(false)
      setAbnormalProtectionReorganizationConfirming(false)
      const nextArchivePlanState = preservedActiveSegment?.archiveEditorState.archivePlanState ??
        createArchivePlanStateFromPreviewItems(normalizedPreview.items, nextCandidateKeys)
      if (!preservedActiveSegment) setArchivePlanState(nextArchivePlanState)
      lastSuccessfulArchivePlanStateRef.current = nextArchivePlanState
      clearDeepSeekArchiveRunSnapshot({ resetHistory: true })
      setPendingUnclassifiedDecision(null)
      setOldFavoriteStep('scan')
      setOldFavoriteGuideMode(mode)
      setTagCandidatesExpanded(false)
      setLedgerListExpanded(true)
      const nextRecommendedLedgerIds = recommendedLedgerIdsForPreview(normalizedPreview)
      setSelectedCandidateKeys(nextCandidateKeys)
      setDraftLedgers((currentLedgers) =>
        mergeCandidateLedgers(
          currentLedgers.map((ledger) =>
            nextRecommendedLedgerIds.has(ledger.id) ? { ...ledger, enabled: true } : ledger
          ),
          normalizedPreview,
          nextCandidateKeys
        )
      )
      setSelectedDefaultLedgerIds((current) => {
        const next = new Set(current)
        for (const ledger of scanDraftLedgers) {
          if (ledger.isDefault && nextRecommendedLedgerIds.has(ledger.id)) {
            next.add(ledger.id)
          }
        }
        return next
      })
      if (mode === 'setup') {
        const nextLedgers = mergeDefaultLedgers(
          scanDraftLedgers.map((ledger) =>
            nextRecommendedLedgerIds.has(ledger.id) ? { ...ledger, enabled: true } : ledger
          )
        )
        setDraftLedgers(nextLedgers)
        setSelectedDefaultLedgerIds(
          new Set(nextLedgers.filter((ledger) => ledger.enabled && ledger.isDefault).map((ledger) => ledger.id))
        )
      }
      const scannedSourceFolders = normalizedPreview.scanContext?.sourceFolders
      setSelectedOldFavoriteSourceFolderKeys(
        new Set(
          scannedSourceFolders?.length
            ? scannedSourceFolders
                .filter((folder) => !folder.scanFailed && !isBilimiManagedLedgerName(folder.title))
                .map((folder) => oldFavoriteSourceKey(folder.id, folder.title))
            : normalizedPreview.items.flatMap((item) => {
                const titles = item.sourceFolderTitles ?? [item.sourceFolderTitle]
                return oldFavoriteItemSourceKeys(item).filter((_, index) =>
                  !isBilimiManagedLedgerName(titles[index] ?? item.sourceFolderTitle)
                )
              }).concat(
                (normalizedPreview.scanContext?.protectedVideos ?? []).flatMap((item) => {
                  const titles = item.sourceFolderTitles ?? []
                  return oldFavoriteItemSourceKeys(item).filter((_, index) =>
                    !isBilimiManagedLedgerName(titles[index] ?? '')
                  )
                })
              )
        )
      )
      const scannedCount =
        normalizedPreview.scanContext?.totalUniqueVideos ??
        normalizedPreview.insights?.totalVideos ??
        normalizedPreview.items.length
      const scanMessage =
        mode === 'setup'
          ? `已扫描 ${scannedCount} 条旧藏，可勾选库房后同步。`
          : `已扫描 ${scannedCount} 条旧藏，可勾选后整理。`
      const scanFeedbackMessage =
        mode === 'setup'
          ? `旧藏扫描完成，发现 ${scannedCount} 条待备册`
          : `旧藏扫描完成，发现 ${normalizedPreview.items.length} 条待整理`
      setStatus(scanMessage)
      publishOldFavoriteStatus({
        label: mode === 'setup' ? `旧藏待备册 ${scannedCount}` : `旧藏待整理 ${normalizedPreview.items.length}`,
        message: scanMessage,
        tone: 'warn'
      })
      publishOldFavoriteStageFeedback(scanFeedbackMessage)
    } catch (error) {
      if (scanSession && sessionOrchestrator) {
        await guardedSessionUpdateSegment(scanSession.batchId, scanSession.segmentId, scanAccountMid, {
          status: 'paused',
          taskStatus: 'paused',
          requestState: 'result-unknown',
          snapshot: { currentStep: 'scan' }
        })
      }
      setPreview(null)
      setBaseScanPreview(null)
      setReorganizedProtectedAids(new Set())
      setArchivePlanState(null)
      clearDeepSeekArchiveRunSnapshot({ resetHistory: true })
      setPendingUnclassifiedDecision(null)
      const failureMessage = `整理旧藏未完成：${errorMessage(error)}`
      setStatus(failureMessage)
      publishOldFavoriteStatus({
        label: '扫描失败',
        message: failureMessage,
        tone: 'error'
      })
    } finally {
      if (scanSession && sessionCoordinator) {
        await sessionCoordinator.release(scanSession.batchId, scanSession.segmentId)
      }
      if (scanGeneration === scanGenerationRef.current) {
        setBasicScanRunning(false)
        setBusy(false)
      }
    }
  }

  function candidateDisplayNameForDraft(candidate: FavoriteLedgerCandidate) {
    return draftLedgers.find((ledger) => ledger.id === candidateLedgerId(candidate))?.displayName ??
      recommendedCandidateDisplayName(
        candidate,
        draftLedgers.map((ledger) => ledger.displayName),
        preview?.insights?.candidateLedgers ?? [candidate]
      )
  }

  function updateArchivePlanSelectedTargets(
    item: FavoriteLedgerPreviewItem,
    update: (planItem: FavoriteArchivePlanItemState) => string[]
  ) {
    if (oldFavoritePlanReadOnly || deepSeekArchiveRunning || archiveBatchRunning) {
      return
    }

    if (!archivePlanState) {
      return
    }

    const itemKey = archivePlanItemKey(item)
    const itemIndex = archivePlanItemIndexByKey.get(itemKey)
    if (itemIndex === undefined) return
    const result = updateSingleArchivePlanItem(archivePlanState, itemIndex, update)
    if (!result) {
      return
    }
    const latestChange: ArchivePreviewLatestChange = {
      kind: 'single',
      title: result.nextItem.title,
      reason: result.nextItem.title,
      movedCount: 1,
      itemChanges: {
        [result.nextItem.itemKey]: {
          aid: result.nextItem.aid,
          title: result.nextItem.title,
          previousTargetText: archivePlanTargetText(result.previousItem),
          nextTargetText: archivePlanTargetText(result.nextItem),
          currentTargetLedgerIds: [...result.nextItem.currentTargetLedgerIds],
          selectedTargetLedgerIds: [...result.nextItem.selectedTargetLedgerIds],
          source: result.nextItem.lastChangeSource
        }
      },
      focusItemKey: result.nextItem.itemKey
    }

    clearDeepSeekArchiveRunSnapshot()
    recordArchivePreviewHistory(archivePlanState, latestChange, undefined, result.previousItem)
    setLatestArchiveChange(latestChange)
    setArchivePlanState(result.state)
  }

  function toggleOldFavoriteTarget(item: FavoriteLedgerPreviewItem, ledgerId: string) {
    updateArchivePlanSelectedTargets(item, (planItem) => {
      const selectedTargetLedgerIds = new Set(planItem.selectedTargetLedgerIds)
      if (selectedTargetLedgerIds.has(ledgerId)) {
        selectedTargetLedgerIds.delete(ledgerId)
      } else {
        selectedTargetLedgerIds.add(ledgerId)
      }
      return Array.from(selectedTargetLedgerIds)
    })
  }

  async function setOldFavoriteTargetGroupSelected(group: OldFavoriteTargetGroup, selected: boolean) {
    if (oldFavoritePlanReadOnly || deepSeekArchiveRunning || archiveBatchRunning) {
      return
    }

    if (!archivePlanState) {
      return
    }

    const itemKeys = new Set(group.entries.map((entry) => archivePlanItemKey(entry.item)))
    const total = itemKeys.size
    let nextItems: FavoriteArchivePlanItemState[]
    if (total < 100) {
      nextItems = archivePlanState.items.map((planItem) => {
        if (!itemKeys.has(planItem.itemKey)) return planItem
        const selectedTargetLedgerIds = new Set(planItem.selectedTargetLedgerIds)
        if (selected) selectedTargetLedgerIds.add(group.ledgerId)
        else selectedTargetLedgerIds.delete(group.ledgerId)
        return {
          ...planItem,
          selectedTargetLedgerIds: Array.from(selectedTargetLedgerIds),
          userModified: true,
          lastChangeSource: 'user' as const
        }
      })
    } else {
      setArchiveBatchOperationProgress({ phase: 'running', completed: 0, total })
      await yieldArchiveBatchFrame()
      nextItems = [...archivePlanState.items]
      for (let start = 0; start < nextItems.length; start += 100) {
        const end = Math.min(start + 100, nextItems.length)
        for (let index = start; index < end; index += 1) {
          const planItem = nextItems[index]
          if (!itemKeys.has(planItem.itemKey)) continue
          const selectedTargetLedgerIds = new Set(planItem.selectedTargetLedgerIds)
          if (selected) selectedTargetLedgerIds.add(group.ledgerId)
          else selectedTargetLedgerIds.delete(group.ledgerId)
          nextItems[index] = {
            ...planItem,
            selectedTargetLedgerIds: Array.from(selectedTargetLedgerIds),
            userModified: true,
            lastChangeSource: 'user' as const
          }
        }
        const completed = nextItems.slice(0, end).filter((item) => itemKeys.has(item.itemKey)).length
        setArchiveBatchOperationProgress({ phase: 'running', completed, total })
        if (end < nextItems.length) await yieldArchiveBatchFrame()
      }
    }
    const nextState = {
      ...archivePlanState,
      items: nextItems
    }
    const latestChange = latestArchiveChangeBetween(archivePlanState, nextState, {
      batchReason: `${selected ? '全选' : '取消全选'} ${group.displayName}`,
      forceBatch: true
    })
    if (!latestChange) {
      if (total >= 100) setArchiveBatchOperationProgress(null)
      return
    }
    clearDeepSeekArchiveRunSnapshot()
    recordArchivePreviewHistory(archivePlanState, latestChange)
    setLatestArchiveChange(latestChange)
    setArchivePlanState(nextState)
    if (total >= 100) finishArchiveBatchOperation(total)
  }

  const toggleOldFavoriteSourceFolder = useCallback((sourceKey: string) => {
    if (oldFavoritePlanReadOnly) return
    setSelectedOldFavoriteSourceFolderKeys((current) => {
      const next = new Set(current)
      if (next.has(sourceKey)) {
        next.delete(sourceKey)
      } else {
        next.add(sourceKey)
      }
      return next
    })
  }, [oldFavoritePlanReadOnly, setSelectedOldFavoriteSourceFolderKeys])

  function oldFavoriteVideoUrl(item: FavoriteLedgerPreviewItem) {
    return `https://www.bilibili.com/video/av${item.aid}`
  }

  function openOldFavoriteVideo(item: FavoriteLedgerPreviewItem) {
    onOpenOldFavoriteVideo?.(oldFavoriteVideoUrl(item))
  }

  function renderOldFavoriteVideoTitle(item: FavoriteLedgerPreviewItem) {
    return (
      <button
        type="button"
        className="favorite-ledger-panel__preview-video-title"
        title={item.title}
        aria-label={`打开视频来源 ${item.title}`}
        disabled={deepSeekArchiveRunning || archiveBatchRunning}
        onClick={() => openOldFavoriteVideo(item)}
      >
        {item.title}
      </button>
    )
  }

  function updatePreviewItemFromPlanItem(planItem: FavoriteArchivePlanItemState) {
    setPreview((current) => {
      if (!current) {
        return current
      }

      return {
        ...current,
        items: current.items.map((item) =>
          item.aid === planItem.aid && item.sourceFolderTitle === planItem.sourceFolderTitle
            ? normalizeOldFavoritePreviewItem(
                {
                  ...item,
                  targetLedgerId: planItem.currentTargetLedgerIds[0] ?? 'inbox',
                  targetFolderId:
                    draftLedgers.find((ledger) => ledger.id === planItem.currentTargetLedgerIds[0])
                      ?.bilibiliFolderId ?? '',
                  targetDisplayName:
                    draftLedgers.find((ledger) => ledger.id === planItem.currentTargetLedgerIds[0])
                      ?.displayName ?? item.targetDisplayName,
                  selected: planItem.selectedTargetLedgerIds.length > 0,
                  reviewRequired: false,
                  originalSuggestedLedgerIds: [...planItem.originalSuggestedLedgerIds],
                  currentTargetLedgerIds: [...planItem.currentTargetLedgerIds],
                  selectedTargetLedgerIds: [...planItem.selectedTargetLedgerIds],
                  targets:
                    planItem.currentTargetLedgerIds.length > 0
                      ? planItem.currentTargetLedgerIds.map((ledgerId) => ({
                          ...targetForOldFavoriteLedgerId(item, ledgerId, draftLedgers),
                          selected: planItem.selectedTargetLedgerIds.includes(ledgerId)
                        }))
                      : []
                },
                draftLedgers
              )
            : item
        )
      }
    })
  }

  function updatePreviewFromArchivePlan(
    nextState: FavoriteArchivePlanState,
    ledgersForPreview: FavoriteLedger[] = draftLedgers
  ) {
    setPreview((current) => {
      if (!current) {
        return current
      }

      return {
        ...current,
        items: current.items.map((item) => {
          const planItem = nextState.items.find(
            (candidate) =>
              candidate.aid === item.aid && candidate.sourceFolderTitle === item.sourceFolderTitle
          )
          if (!planItem) {
            return item
          }

          return normalizeOldFavoritePreviewItem(
            {
              ...item,
              originalSuggestedLedgerIds: [...planItem.originalSuggestedLedgerIds],
              currentTargetLedgerIds: [...planItem.currentTargetLedgerIds],
              selectedTargetLedgerIds: [...planItem.selectedTargetLedgerIds],
              targets:
                planItem.currentTargetLedgerIds.length > 0
                  ? planItem.currentTargetLedgerIds.map((ledgerId) => ({
                      ...targetForOldFavoriteLedgerId(item, ledgerId, ledgersForPreview),
                      selected: planItem.selectedTargetLedgerIds.includes(ledgerId)
                    }))
                  : []
            },
            ledgersForPreview
          )
        })
      }
    })
  }

  function commitArchivePlanSelection(
    item: FavoriteLedgerPreviewItem,
    nextState: FavoriteArchivePlanState
  ) {
    const nextPlanItem = nextState.items.find(
      (candidate) => candidate.aid === item.aid && candidate.sourceFolderTitle === item.sourceFolderTitle
    )
    if (!nextPlanItem) {
      return
    }

    const latestChange = archivePlanState ? latestArchiveChangeBetween(archivePlanState, nextState) : null
    if (latestChange) {
      recordArchivePreviewHistory(archivePlanState!, latestChange)
      setLatestArchiveChange(latestChange)
    }
    clearDeepSeekArchiveRunSnapshot()
    setArchivePlanState(nextState)
    updatePreviewItemFromPlanItem(nextPlanItem)
  }

  function applyArchiveSelection(
    item: FavoriteLedgerPreviewItem,
    ledgerIds: string[],
    source: 'user' | 'transfer' | 'rejudge' = 'user'
  ) {
    if (!archivePlanState) {
      return
    }

    commitArchivePlanSelection(
      item,
      applyArchivePlanSelection(
        archivePlanState,
        { aid: item.aid, sourceFolderTitle: item.sourceFolderTitle },
        ledgerIds,
        source
      )
    )
  }

  function moveOldFavoriteToUnclassified(
    item: FavoriteLedgerPreviewItem,
    source: 'user' | 'transfer' = 'user'
  ) {
    if (!archivePlanState) {
      return
    }

    commitArchivePlanSelection(
      item,
      moveArchivePlanItemToUnclassified(
        archivePlanState,
        { aid: item.aid, sourceFolderTitle: item.sourceFolderTitle },
        source
      )
    )
  }

  function revertOldFavoriteArchiveSuggestion(item: FavoriteLedgerPreviewItem) {
    if (!archivePlanState) {
      return
    }

    commitArchivePlanSelection(
      item,
      revertArchivePlanItem(archivePlanState, {
        aid: item.aid,
        sourceFolderTitle: item.sourceFolderTitle
      })
    )
  }

  function handleOldFavoriteArchiveSelection(
    item: FavoriteLedgerPreviewItem,
    areaLedgerId: string,
    nextLedgerId: string
  ) {
    if (nextLedgerId === areaLedgerId) {
      return
    }

    const currentLedgerIds = currentArchiveLedgerIdsForOldFavoriteItem(item)
    if (nextLedgerId === 'unclassified') {
      if (currentLedgerIds.length > 1) {
        setPendingUnclassifiedDecision({
          itemKey: archivePlanItemKey(item),
          areaLedgerId
        })
        return
      }

      moveOldFavoriteToUnclassified(item, 'transfer')
      setManualArchiveMoveFocus({ sourceLedgerId: areaLedgerId, targetLedgerId: 'unclassified' })
      return
    }

    if (areaLedgerId === 'unclassified') {
      applyArchiveSelection(item, [nextLedgerId], 'transfer')
      setManualArchiveMoveFocus({ sourceLedgerId: areaLedgerId, targetLedgerId: nextLedgerId })
      return
    }

    applyArchiveSelection(
      item,
      uniqueLedgerIds(currentLedgerIds.map((ledgerId) => (ledgerId === areaLedgerId ? nextLedgerId : ledgerId))),
      'transfer'
    )
    setManualArchiveMoveFocus({ sourceLedgerId: areaLedgerId, targetLedgerId: nextLedgerId })
  }

  function resolvePendingUnclassifiedPreviewItem() {
    if (!pendingUnclassifiedDecision || !preview) {
      return null
    }

    const planItem = archivePlanState?.items.find(
      (item) => item.itemKey === pendingUnclassifiedDecision.itemKey
    )
    if (!planItem) {
      return null
    }

    return (
      preview.items.find(
        (item) => item.aid === planItem.aid && item.sourceFolderTitle === planItem.sourceFolderTitle
      ) ?? null
    )
  }

  function confirmPendingUnclassifiedDecision(mode: 'all' | 'current') {
    if (oldFavoritePlanReadOnly || deepSeekArchiveRunning || archiveBatchRunning) {
      setPendingUnclassifiedDecision(null)
      return
    }

    const pendingItem = resolvePendingUnclassifiedPreviewItem()
    if (!pendingItem || !archivePlanState || !pendingUnclassifiedDecision) {
      setPendingUnclassifiedDecision(null)
      return
    }

    if (mode === 'all') {
      moveOldFavoriteToUnclassified(pendingItem, 'transfer')
      setManualArchiveMoveFocus({
        sourceLedgerId: pendingUnclassifiedDecision.areaLedgerId,
        targetLedgerId: 'unclassified'
      })
      setPendingUnclassifiedDecision(null)
      return
    }

    const remainingLedgerIds = currentArchiveLedgerIdsForOldFavoriteItem(pendingItem).filter(
      (ledgerId) => ledgerId !== pendingUnclassifiedDecision.areaLedgerId
    )
    applyArchiveSelection(pendingItem, remainingLedgerIds, 'transfer')
    setManualArchiveMoveFocus({
      sourceLedgerId: pendingUnclassifiedDecision.areaLedgerId,
      targetLedgerId: remainingLedgerIds[0] ?? 'unclassified'
    })
    setPendingUnclassifiedDecision(null)
  }

  function chunkDeepSeekArchiveRequest(
    request: Extract<DeepSeekGenerateRequest, { kind: 'favorite-archive-organize' }>,
    chunkSize = 20
  ) {
    const chunks: Array<Extract<DeepSeekGenerateRequest, { kind: 'favorite-archive-organize' }>> = []
    for (let index = 0; index < request.videos.length; index += chunkSize) {
      chunks.push({
        ...request,
        videos: request.videos.slice(index, index + chunkSize)
      })
    }
    return chunks
  }

  function deepSeekArchiveBatchFailureKind(error: unknown): DeepSeekArchiveBatchFailureKind {
    const code = (error as { code?: unknown })?.code
    if (code === 'network-error' || isFavoriteLedgerConnectionFailure(error)) return 'network-error'
    if (code === 'api-error') return 'api-error'
    if (code === 'invalid-output') return 'invalid-output'
    return 'invalid-result'
  }

  function safeDeepSeekArchiveErrorMessage(error: unknown) {
    return errorMessage(error)
      .replace(/(?:api[_-]?key|access[_-]?token|token|cookie|sessdata|bili[_-]?jct|authorization|bearer)\s*[:=]\s*[^\s,;]+/gi, (match) => {
        const key = match.split(/[:=]/, 1)[0]
        return `${key}=[redacted]`
      })
      .replace(/\bsk-[A-Za-z0-9_-]+\b/g, 'sk-[redacted]')
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
      .replace(/https?:\/\/[^\s]+/gi, '[url redacted]')
      .slice(0, 240)
  }

  async function organizeOldFavoritesWithDeepSeek(
    retryFailures: DeepSeekArchiveBatchFailure[] | null = null
  ) {
    if (!deepSeekArchiveAvailable) {
      const message = '请先到设置开启 DeepSeek 后再使用辅助整理。'
      setDeepSeekArchiveStatus(message)
      publishOldFavoriteStageFeedback(message)
      return
    }

    if (!archivePlanState || !onOrganizeOldFavoritesWithDeepSeek) {
      return
    }

    const multiArchiveLimit = deepSeekArchiveMultiLimit(favoriteArchiveMultiMode)
    const requestState = deepSeekArchiveStateForScope(
      archivePlanState,
      deepSeekArchiveMode,
      deepSeekSegmentScope,
      activeSegmentAidSet
    )
    const baseRequest = buildDeepSeekArchiveRequest(
      requestState,
      archiveExecutionLedgers,
      deepSeekArchiveMode,
      multiArchiveLimit
    )
    const retryVideoKeys = retryFailures
      ? new Set(retryFailures.flatMap((failure) => failure.videoKeys))
      : null
    const request = retryVideoKeys
      ? {
          ...baseRequest,
          videos: baseRequest.videos.filter((video) =>
            retryVideoKeys.has(`${video.sourceFolderTitle}::${video.aid}`)
          )
        }
      : baseRequest

    if (request.videos.length === 0) {
      setDeepSeekArchiveStatus('当前范围没有可整理的视频。')
      setDeepSeekArchiveProgress(null)
      return
    }

    const chunks = chunkDeepSeekArchiveRequest(request)
    const deepSeekArchiveRunId = Symbol('deepSeekArchiveRun')
    const isCurrentDeepSeekArchiveRun = () =>
      getOldFavoriteRuntimeValue<symbol | null>('deepSeekArchiveRunId', null) ===
      deepSeekArchiveRunId
    if (!setOldFavoriteRuntimeValue('deepSeekArchiveRunning', true)) {
      return
    }
    setOldFavoriteRuntimeValue('deepSeekArchiveRunId', deepSeekArchiveRunId)
    setDeepSeekArchiveCancelRequested(false)
    setDeepSeekArchiveResultSummary(null)
    setDeepSeekArchiveSummaryOpen(false)
    setDeepSeekArchiveStatus('DeepSeek 正在整理旧藏...')
    setDeepSeekArchiveSuggestionCount(0)
    setDeepSeekArchiveProgress({
      completedVideos: 0,
      totalVideos: request.videos.length,
      currentChunk: 1,
      totalChunks: chunks.length
    })
    setOldFavoriteRuntimeStatus({
      label: `DeepSeek整理 0/${request.videos.length}`,
      message: 'DeepSeek 正在辅助整理旧藏。',
      tone: 'running'
    })
    setArchivePreviewAlertMessages([])

    try {
      const snapshot = createDeepSeekArchiveSnapshot(archivePlanState)
      const results: DeepSeekArchiveVideoResult[] = []
      const keywordSuggestions: FavoriteKeywordSuggestion[] = []
      const batchFailures: DeepSeekArchiveBatchFailure[] = []
      let completedVideos = 0

      for (const [chunkIndex, chunk] of chunks.entries()) {
        if (!isCurrentDeepSeekArchiveRun()) {
          return
        }
        if (getOldFavoriteRuntimeValue('deepSeekArchiveCancelRequested', false)) {
          break
        }
        setDeepSeekArchiveProgress({
          completedVideos,
          totalVideos: request.videos.length,
          currentChunk: chunkIndex + 1,
          totalChunks: chunks.length
        })

        try {
          const result = await runTrackedOldFavoriteRequest({
            task: 'deepseek',
            currentAid: chunk.videos[0]?.aid,
            checkpoint: { cursor: chunkIndex, totalChunks: chunks.length },
            snapshot: {
              currentStep: 'deepseek',
              deepSeek: { completedVideos, totalVideos: request.videos.length }
            },
            work: () => onOrganizeOldFavoritesWithDeepSeek(deepSeekArchiveMode, chunk)
          })
          if (!isCurrentDeepSeekArchiveRun()) {
            return
          }
          if (getOldFavoriteRuntimeValue('deepSeekArchiveCancelRequested', false)) {
            break
          }
          if (!result || result.kind !== 'favorite-archive-organize' || !Array.isArray(result.results)) {
            batchFailures.push({
              batchIndex: retryFailures?.[chunkIndex]?.batchIndex ?? chunkIndex + 1,
              affectedVideoCount: chunk.videos.length,
              failureKind: 'invalid-output',
              errorMessage: 'DeepSeek 返回格式无效。',
              videoKeys: chunk.videos.map((video) => `${video.sourceFolderTitle}::${video.aid}`)
            })
            continue
          }

          const returnedAids = new Set(
            result.results
              .filter((row) => typeof row.aid === 'number')
              .map((row) => row.aid)
          )
          const invalidRows = result.results.filter((row) => row.invalid)
          const invalidVideoKeys = invalidRows.flatMap((row, invalidIndex) => {
            const video = chunk.videos.find((candidate) => candidate.aid === row.aid)
            const fallbackVideo = chunk.videos[invalidIndex]
            const affectedVideo = video ?? fallbackVideo
            return affectedVideo ? [`${affectedVideo.sourceFolderTitle}::${affectedVideo.aid}`] : []
          })
          const missingVideos = chunk.videos.filter((video) => !returnedAids.has(video.aid))
          const failureVideoKeys = Array.from(new Set([
            ...invalidVideoKeys,
            ...missingVideos.map((video) => `${video.sourceFolderTitle}::${video.aid}`)
          ]))
          if (failureVideoKeys.length > 0) {
            const invalidMessage = invalidRows[0]?.errorMessage ??
              (invalidRows.length > 0 ? 'DeepSeek 返回的单条结果格式无效。' : '')
            const missingMessage = missingVideos.length > 0
              ? `DeepSeek 返回不完整，缺少 ${missingVideos.length} 条结果。`
              : ''
            batchFailures.push({
              batchIndex: retryFailures?.[chunkIndex]?.batchIndex ?? chunkIndex + 1,
              affectedVideoCount: failureVideoKeys.length,
              failureKind: invalidRows.length > 0 ? 'invalid-result' : 'invalid-output',
              errorMessage: safeDeepSeekArchiveErrorMessage([invalidMessage, missingMessage].filter(Boolean).join(' ')),
              videoKeys: failureVideoKeys
            })
          }
          results.push(...result.results.filter((row) => !row.invalid))
          keywordSuggestions.push(...(result.keywordSuggestions ?? []))
        } catch (error) {
          if (!isCurrentDeepSeekArchiveRun()) {
            return
          }
          batchFailures.push({
            batchIndex: retryFailures?.[chunkIndex]?.batchIndex ?? chunkIndex + 1,
            affectedVideoCount: chunk.videos.length,
            failureKind: deepSeekArchiveBatchFailureKind(error),
            errorMessage: safeDeepSeekArchiveErrorMessage(error),
            videoKeys: chunk.videos.map((video) => `${video.sourceFolderTitle}::${video.aid}`)
          })
        }

        completedVideos += chunk.videos.length
        setDeepSeekArchiveProgress({
          completedVideos,
          totalVideos: request.videos.length,
          currentChunk: Math.min(chunkIndex + 1, chunks.length),
          totalChunks: chunks.length
        })
        setOldFavoriteRuntimeStatus({
          label: `DeepSeek整理 ${completedVideos}/${request.videos.length}`,
          message: 'DeepSeek 正在辅助整理旧藏。',
          tone: 'running'
        })
      }

      if (!isCurrentDeepSeekArchiveRun()) {
        return
      }
      if (getOldFavoriteRuntimeValue('deepSeekArchiveCancelRequested', false)) {
        setDeepSeekArchiveStatus('DeepSeek 整理已取消。')
        setOldFavoriteRuntimeStatus({
          label: `整理已取消 ${completedVideos}/${request.videos.length}`,
          message: 'DeepSeek 整理已取消，可继续检查当前归档预览。',
          tone: 'warn'
        })
        return
      }

      const hasUsableResult = results.some((result) => !result.invalid && typeof result.aid === 'number')
      if (batchFailures.length === chunks.length && !hasUsableResult) {
        const affectedVideoCount = batchFailures.reduce((total, failure) => total + failure.affectedVideoCount, 0)
        setDeepSeekArchiveRunSnapshot(null)
        setDeepSeekArchiveResultSummary({
          successCount: 0,
          failedCount: affectedVideoCount,
          nonApplicationCounts: emptyDeepSeekNonApplicationCounts(),
          batchFailures
        })
        setDeepSeekArchiveSummaryOpen(false)
        const message = `${batchFailures.length} 个批次失败，影响 ${affectedVideoCount} 条视频`
        setDeepSeekArchiveStatus(message)
        setOldFavoriteRuntimeStatus({ label: 'DeepSeek整理失败', message, tone: 'error' })
        return
      }

      const requestedAids = new Set(request.videos.map((video) => video.aid))
      const applied = applyDeepSeekArchiveResults({
        state: archivePlanState,
        ledgers: archiveExecutionLedgers,
        enabledLedgerIds: archiveExecutionLedgers.filter((ledger) => ledger.enabled).map((ledger) => ledger.id),
        multiArchiveLimit,
        results: results.filter((result) =>
          typeof result.aid === 'number' && requestedAids.has(result.aid)
        )
      })
      const batchFailureImpactCount = batchFailures.reduce(
        (total, failure) => total + failure.affectedVideoCount,
        0
      )
      const deepSeekMoveFocus = archivePreviewMoveFocusBetween(archivePlanState, applied.state)
      const deepSeekArchiveChange = latestArchiveChangeBetween(archivePlanState, applied.state, {
        batchReason: 'DeepSeek 批量整理',
        forceBatch: true
      })
      if (deepSeekArchiveChange) {
        recordArchivePreviewHistory(archivePlanState, deepSeekArchiveChange)
      }
      setArchivePlanState(applied.state)
      updatePreviewFromArchivePlan(applied.state)
      setLatestArchiveChange(deepSeekArchiveChange)
      if (deepSeekMoveFocus) {
        setManualArchiveMoveFocus({ ...deepSeekMoveFocus, scrollIntoView: false })
      }
      setDeepSeekArchiveRunSnapshot(snapshot)
      setArchivePreviewAlertMessages(
        [
          archiveChangeAlertSummary(deepSeekArchiveChange),
          ...applied.redDisplacementMessages
        ].filter((message): message is string => Boolean(message))
      )
      const hasBatchFailures = batchFailures.length > 0
      const markDeepSeekArchiveReady = () => {
        if (hasBatchFailures) {
          const affectedVideoCount = batchFailures.reduce((total, failure) => total + failure.affectedVideoCount, 0)
          const message = `${batchFailures.length} 个批次失败，影响 ${affectedVideoCount} 条视频`
          setDeepSeekArchiveStatus(message)
          setOldFavoriteRuntimeStatus({ label: 'DeepSeek整理部分失败', message, tone: 'error' })
          return
        }
        setOldFavoriteRuntimeStatus({
          label: `整理待确认 ${request.videos.length}`,
          message: 'DeepSeek 整理完成，请确认执行。',
          tone: 'warn'
        })
        publishOldFavoriteStageFeedback('DeepSeek 整理完成，请确认执行')
      }

      setDeepSeekArchiveResultSummary({
        successCount: applied.stats.successCount,
        failedCount: applied.stats.failedCount + batchFailureImpactCount,
        nonApplicationCounts: applied.nonApplicationCounts,
        batchFailures
      })
      setDeepSeekArchiveStatus(
        `${applied.stats.successCount} 条已应用，${applied.stats.failedCount} 条未应用`
      )

      const keywordSuggestionCount = keywordSuggestions.length
      if (keywordSuggestionCount > 0) {
        const hasKeywordSuggestionHandler = hasOldFavoriteRuntimeHandler(
          'onDeepSeekArchiveKeywordSuggestions'
        )
        invokeOldFavoriteRuntimeHandler(
          'onDeepSeekArchiveKeywordSuggestions',
          keywordSuggestions
        )
        setDeepSeekArchiveSuggestionCount(keywordSuggestionCount)
        setDeepSeekArchiveStatus(
          hasKeywordSuggestionHandler
            ? `DeepSeek 返回 ${keywordSuggestionCount} 条关键词建议，已加入设置里的建议列表。`
            : `DeepSeek 返回 ${keywordSuggestionCount} 条关键词建议，暂未写入设置，可稍后处理。`
        )
        markDeepSeekArchiveReady()
        return
      }
      markDeepSeekArchiveReady()
    } catch (error) {
      if (!isCurrentDeepSeekArchiveRun()) {
        return
      }
      const failureMessage = error instanceof Error ? error.message : 'DeepSeek 整理失败。'
      setDeepSeekArchiveResultSummary(null)
      setDeepSeekArchiveSummaryOpen(false)
      setDeepSeekArchiveStatus(failureMessage)
      setOldFavoriteRuntimeStatus({
        label: 'DeepSeek整理失败',
        message: failureMessage,
        tone: 'error'
      })
    } finally {
      if (isCurrentDeepSeekArchiveRun()) {
        setDeepSeekArchiveRunning(false)
        setDeepSeekArchiveCancelRequested(false)
        setOldFavoriteRuntimeValue('deepSeekArchiveRunId', null)
      }
    }
  }

  function retryFailedDeepSeekArchiveBatches() {
    const failures = deepSeekArchiveResultSummary?.batchFailures
    if (!failures?.length || deepSeekArchiveRunning) {
      return
    }
    void organizeOldFavoritesWithDeepSeek(failures)
  }

  function cancelDeepSeekArchiveOrganization() {
    if (!deepSeekArchiveRunning || deepSeekArchiveCancelRequested) {
      return
    }

    setDeepSeekArchiveCancelRequested(true)
    setDeepSeekArchiveStatus('正在取消 DeepSeek 整理...')
  }

  function archivePlanHasPreviewChanges(state: FavoriteArchivePlanState) {
    return state.items.some((item) => {
      const original = state.originalItemsByKey[item.itemKey]
      return (
        !original ||
        !sameLedgerIds(item.currentTargetLedgerIds, original.currentTargetLedgerIds) ||
        !sameLedgerIds(item.selectedTargetLedgerIds, original.selectedTargetLedgerIds)
      )
    })
  }

  function undoArchivePreviewChanges() {
    if (oldFavoritePlanReadOnly || !archivePlanState || deepSeekArchiveRunning || archiveBatchRunning || archiveUndoStack.length === 0) {
      return
    }

    const previousSnapshot = archiveUndoStack[archiveUndoStack.length - 1]
    const undoneChange = archiveUndoChanges[archiveUndoChanges.length - 1]
    const currentSnapshot = createReciprocalArchivePreviewHistorySnapshot(
      previousSnapshot,
      archivePlanState
    )
    restoreArchivePreviewHistorySnapshot(previousSnapshot)
    setArchiveUndoStack((current) => current.slice(0, -1))
    setArchiveRedoStack((current) => [...current, currentSnapshot])
    setArchiveUndoChanges((current) => current.slice(0, -1))
    if (undoneChange) {
      setArchiveRedoChanges((current) => [...current, undoneChange])
    }
    setLatestArchiveChange(archiveUndoChanges[archiveUndoChanges.length - 2] ?? null)
    setDeepSeekArchiveRunSnapshot(null)
    setArchivePreviewAlertMessages([])
    setPendingUnclassifiedDecision(null)
  }

  function redoArchivePreviewChanges() {
    if (oldFavoritePlanReadOnly || !archivePlanState || archiveRedoStack.length === 0 || deepSeekArchiveRunning || archiveBatchRunning) {
      return
    }

    const nextSnapshot = archiveRedoStack[archiveRedoStack.length - 1]
    const restoredChange = archiveRedoChanges[archiveRedoChanges.length - 1]
    const currentSnapshot = createReciprocalArchivePreviewHistorySnapshot(
      nextSnapshot,
      archivePlanState
    )
    restoreArchivePreviewHistorySnapshot(nextSnapshot)
    setArchiveRedoStack((current) => current.slice(0, -1))
    setArchiveUndoStack((current) => [...current, currentSnapshot])
    setArchiveRedoChanges((current) => current.slice(0, -1))
    if (restoredChange) {
      setArchiveUndoChanges((current) => [...current, restoredChange])
    }
    setLatestArchiveChange(restoredChange ?? null)
    setPendingUnclassifiedDecision(null)
  }

  function rollbackArchivePreviewHistory(targetChangeIndex: number) {
    if (oldFavoritePlanReadOnly || !archivePlanState || deepSeekArchiveRunning || archiveBatchRunning) {
      return
    }

    const appliedChangeCount = archiveUndoChanges.length
    const keepCount = targetChangeIndex + 1
    if (keepCount < 0 || keepCount >= appliedChangeCount) {
      return
    }

    const removedSnapshots = archiveUndoStack.slice(keepCount)
    if (removedSnapshots.length === 0) {
      return
    }

    let workingEditor: ArchiveEditorRuntimeState = {
      archivePlanState,
      selectedCandidateKeys: [...selectedCandidateKeys],
      draftLedgers: draftLedgers.map(cloneArchiveDraftLedger),
      candidateSourceLedgerIdsByItemKey: structuredClone(candidateSourceLedgerIdsByItemKey)
    }
    const futureSnapshots: ArchivePreviewHistorySnapshot[] = []
    for (let index = removedSnapshots.length - 1; index >= 0; index -= 1) {
      const snapshot = removedSnapshots[index]
      futureSnapshots.push(createReciprocalArchivePreviewHistorySnapshot(
        snapshot,
        workingEditor.archivePlanState!,
        {
          selectedCandidateKeys: workingEditor.selectedCandidateKeys,
          draftLedgers: workingEditor.draftLedgers,
          candidateSourceLedgerIdsByItemKey: workingEditor.candidateSourceLedgerIdsByItemKey
        }
      ))
      workingEditor = applyArchivePreviewHistorySnapshotToEditor(workingEditor, snapshot)
    }
    const futureChanges = archiveUndoChanges.slice(keepCount).reverse()
    if (!workingEditor.archivePlanState) return
    updatePreviewFromArchivePlan(workingEditor.archivePlanState, workingEditor.draftLedgers)
    setArchiveEditorState(workingEditor)
    setArchiveUndoStack(archiveUndoStack.slice(0, keepCount))
    setArchiveUndoChanges(archiveUndoChanges.slice(0, keepCount))
    setArchiveRedoStack([...archiveRedoStack, ...futureSnapshots])
    setArchiveRedoChanges([...archiveRedoChanges, ...futureChanges])
    setLatestArchiveChange(archiveUndoChanges[keepCount - 1] ?? null)
    setDeepSeekArchiveRunSnapshot(null)
    setArchivePreviewAlertMessages([])
    setPendingUnclassifiedDecision(null)
  }

  function setPreviewScopedPendingItemsStaged(selected: boolean) {
    if (oldFavoritePlanReadOnly || deepSeekArchiveRunning || archiveBatchRunning || !archivePlanState) {
      return
    }

    clearDeepSeekArchiveRunSnapshot()
    const itemKeys = new Set(previewScopedPendingItems.map(archivePlanItemKey))
    const nextState = {
      ...archivePlanState,
      items: archivePlanState.items.map((planItem) =>
        itemKeys.has(planItem.itemKey)
          ? {
              ...planItem,
              currentTargetLedgerIds: selected ? ['inbox'] : [],
              selectedTargetLedgerIds: selected ? ['inbox'] : [],
              userModified: true,
              lastChangeSource: 'user' as const
            }
          : planItem
      )
    }
    const latestChange = latestArchiveChangeBetween(archivePlanState, nextState, {
      batchReason: selected ? '全部存入暂存' : '取消暂存',
      forceBatch: true
    })
    if (!latestChange) {
      return
    }

    recordArchivePreviewHistory(archivePlanState, latestChange)
    setArchivePlanState(nextState)
    setLatestArchiveChange(latestChange)
    setArchivePreviewAlertMessages(
      [archiveChangeAlertSummary(latestChange)].filter((message): message is string => Boolean(message))
    )
  }

  function candidateForOldFavoriteTarget(target: {
    candidateKey?: string
    displayName: string
    keywords: string[]
    ruleType?: FavoriteLedgerRuleType
  }): FavoriteLedgerCandidate | null {
    if (!target.candidateKey) {
      return null
    }

    const existingCandidate = preview?.insights?.candidateLedgers.find(
      (candidate) => candidateKey(candidate) === target.candidateKey
    )
    if (existingCandidate) {
      return existingCandidate
    }

    const separatorIndex = target.candidateKey.indexOf(':')
    const rawKind = separatorIndex >= 0 ? target.candidateKey.slice(0, separatorIndex) : ''
    const sourceName = separatorIndex >= 0 ? target.candidateKey.slice(separatorIndex + 1).trim() : ''
    if (!isFavoriteLedgerCandidateKind(rawKind) || !sourceName) {
      return null
    }

    return {
      kind: rawKind,
      sourceName,
      displayName: target.displayName,
      keywords: target.keywords,
      ruleType: target.ruleType,
      count: oldFavoriteCandidateCounts.get(target.candidateKey) ?? 1,
      confidence: 'medium',
      reason: '进一步判断建议。'
    }
  }

  async function rejudgeOldFavorite(item: FavoriteLedgerPreviewItem) {
    if (deepSeekArchiveRunning) {
      return
    }

    if (onRejudgeOldFavorite) {
      const refreshedItem = await onRejudgeOldFavorite(item)
      const refreshedItemWithProtection = item.reorganizeProtected
        ? {
            ...refreshedItem,
            sourceFolderIds: item.sourceFolderIds,
            sourceFolderTitles: item.sourceFolderTitles,
            currentBilimiFolderIds: item.currentBilimiFolderIds,
            protectedForIncrementalScan: item.protectedForIncrementalScan,
            reorganizeProtected: true
          }
        : refreshedItem
      const refreshedCurrentLedgerIds = rejudgedCurrentArchiveLedgerIds(refreshedItemWithProtection)
      const refreshedSelectedLedgerIds = rejudgedSelectedArchiveLedgerIds(refreshedItemWithProtection)
      const normalizedRefreshedItem = normalizeOldFavoritePreviewItem(
        {
          ...refreshedItemWithProtection,
          currentTargetLedgerIds: refreshedCurrentLedgerIds,
          selectedTargetLedgerIds: refreshedSelectedLedgerIds
        },
        draftLedgers
      )
      setPreview((current) => {
        if (!current) {
          return current
        }

        return {
          ...current,
          items: current.items.map((candidate) =>
            candidate.aid === item.aid && candidate.sourceFolderTitle === item.sourceFolderTitle
              ? normalizedRefreshedItem
              : candidate
          )
        }
      })

      clearDeepSeekArchiveRunSnapshot()
      if (archivePlanState) {
        const nextState: FavoriteArchivePlanState = {
          ...archivePlanState,
          items: archivePlanState.items.map((planItem) =>
            planItem.aid === item.aid && planItem.sourceFolderTitle === item.sourceFolderTitle
              ? {
                  ...planItem,
                  title: normalizedRefreshedItem.title,
                  currentTargetLedgerIds: [...refreshedCurrentLedgerIds],
                  selectedTargetLedgerIds: [...refreshedSelectedLedgerIds],
                  userModified: true,
                  lastChangeSource: 'rejudge'
                }
              : planItem
          )
        }
        setArchivePlanState(nextState)
        const latestChange = latestArchiveChangeBetween(archivePlanState, nextState)
        if (latestChange) {
          recordArchivePreviewHistory(archivePlanState, latestChange)
          setLatestArchiveChange(latestChange)
        }
      }
      return
    }

    const retriedTarget = retryJudgmentTargetForOldFavoriteItem(item, draftLedgers)
    if (retriedTarget) {
      applyArchiveSelection(item, [retriedTarget.ledgerId], 'rejudge')
      return
    }

    const existingTarget = targetsForOldFavoriteItem(item).find(
      (target) => target.ledgerId !== 'inbox' && !target.alreadyInTarget && !target.selectedCandidateTarget
    )

    if (existingTarget) {
      toggleOldFavoriteTarget(item, existingTarget.ledgerId)
      return
    }

    const candidateTarget =
      targetsForOldFavoriteItem(item).find(
        (target) => target.selectedCandidateTarget && target.candidateKey && !target.alreadyInTarget
      ) ?? item.candidateTargets?.[0]
    const candidate = candidateTarget ? candidateForOldFavoriteTarget(candidateTarget) : null
    if (!candidate) {
      return
    }

    setCandidateSelected(candidate, true)
  }

  function persistOldFavoriteExecutionRecords(run: OldFavoriteExecutionRun) {
    const persistedTargetKeys = new Set(run.persistedTargetKeys ?? [])
    const newSuccessfulTargetKeys = new Set(
      run.successfulTargetKeys.filter((key) => !persistedTargetKeys.has(key))
    )
    const confirmedAt = run.confirmedAt || new Date().toISOString()
    if (archivePlanState && newSuccessfulTargetKeys.size > 0) {
      const records = buildConfirmedArchiveCorrectionRecords({
        state: archivePlanState,
        preview: preview!,
        successfulTargetKeys: newSuccessfulTargetKeys,
        confirmedAt
      })
      if (records.length > 0) onConfirmArchiveCorrections?.(records)
    }
    if (preview?.scanContext) {
      const records = buildConfirmedArchiveProtectionRecords({
        accountMid: preview.scanContext.accountMid,
        selectedItems: run.selectedItems,
        results: run.results,
        confirmedAt
      })
      if (records.length > 0) onConfirmArchiveProtections?.(records)
    }
    const nextRun = {
      ...run,
      confirmedAt,
      persistedTargetKeys: [...new Set([...persistedTargetKeys, ...run.successfulTargetKeys])]
    }
    setOldFavoriteExecutionRun(nextRun)
    return nextRun
  }

  async function pauseOldFavoriteExecutionRun(run: OldFavoriteExecutionRun) {
    run = persistOldFavoriteExecutionRecords(run)
    const total = groupOldFavoriteExecutionItems(run.selectedItems).length
    const completed = run.nextGroupIndex
    const remaining = Math.max(0, total - completed)
    setOldFavoriteExecutionRun(run)
    setOldFavoriteExecutionProgress({ completed, total })
    setOldFavoriteExecutionPhase('paused')
    setOldFavoriteExecutionStopping(false)
    const message = `已暂停整理：${completed} 条已完成，${remaining} 条剩余；暂停期间不会发送 B 站请求。`
    setStatus(message)
    publishOldFavoriteStatus({ label: '整理已暂停', message, tone: 'warn' })
    onOldFavoriteExecutionStateChange?.('finished')
  }

  async function runOldFavoriteExecution(
    run: OldFavoriteExecutionRun,
    resuming = false,
    segmentId?: string
  ): Promise<OldFavoriteExecutionOutcome> {
    const groups = groupOldFavoriteExecutionItems(run.selectedItems)
    const accountGeneration = accountGenerationRef.current
    oldFavoriteExecutionStopRequestedRef.current = false
    setOldFavoriteExecutionStopping(false)
    setOldFavoriteExecutionPhase('running')
    onOldFavoriteExecutionStateChange?.('running')
    try {
      if (resuming) {
        setStatus('继续整理前正在安全冷却；冷却期间可再次暂停。')
        const waited = await waitForOldFavoriteExecutionDelay(
          randomDelayMs(OLD_FAVORITE_RESUME_COOLDOWN_DELAY_MS),
          () => oldFavoriteExecutionStopRequestedRef.current
        )
        if (!waited) {
          await pauseOldFavoriteExecutionRun(run)
          return 'paused'
        }
      }

      for (let index = run.nextGroupIndex; index < groups.length; index += 1) {
        if (oldFavoriteExecutionStopRequestedRef.current) {
          await pauseOldFavoriteExecutionRun(run)
          return 'paused'
        }
        const group = groups[index]
        const rawResult = (await runTrackedOldFavoriteRequest({
          task: 'execute',
          segmentId,
          currentAid: group[0]?.aid,
          checkpoint: {
            cursor: index,
            frozenExecutionAids: run.selectedItems.map((item) => item.aid)
          },
          snapshot: {
            currentStep: 'execution',
            execution: { nextGroupIndex: index, total: groups.length }
          },
          work: () => onExecuteOldFavoritePlan(group, activeOldFavoriteUserBatch?.accountMid)
        })) as OldFavoriteExecutionResult
        if (accountGeneration !== accountGenerationRef.current) {
          return 'paused'
        }
        const completedItems = rawResult.ok === true
          ? rawResult.completedItems ?? group
          : rawResult.partial
            ? rawResult.completedItems ?? []
            : []
        const result = { ...rawResult, completedItems }
        if (rawResult.resultUnknown) {
          setOldFavoriteReconciliationRequired(activeOldFavoriteUserBatch.accountMid, true)
          setOldFavoriteExecutionRun(run)
          setOldFavoriteExecutionPhase('paused')
          setOldFavoriteExecutionStopping(false)
          setStatus('当前请求结果未知，已暂停；继续前会先核对 B 站实际状态。')
          onOldFavoriteExecutionStateChange?.('finished')
          return 'paused'
        }
        run = {
          ...run,
          nextGroupIndex: index + 1,
          results: [...run.results, result],
          successfulTargetKeys: [
            ...run.successfulTargetKeys,
            ...completedItems.map(archivePlanTargetKey)
          ]
        }
        setOldFavoriteExecutionRun(run)
        setOldFavoriteExecutionProgress({ completed: index + 1, total: groups.length })
        publishOldFavoriteStatus({
          label: `确认执行 ${index + 1}/${groups.length}`,
          message: '正在确认执行旧藏整理。',
          tone: 'running'
        })
        if (oldFavoriteResultIsRiskStop(result) || result.paused) {
          run = persistOldFavoriteExecutionRecords(run)
          const message = '访问受限，已安全停止。请等待 30 分钟后结束本轮并重新扫描。'
          setStatus(message)
          setOldFavoriteExecutionPhase('risk-stopped')
          setOldFavoriteExecutionStopping(false)
          publishOldFavoriteStatus({ label: '访问受限，已安全停止', message, tone: 'error' })
          onOldFavoriteExecutionStateChange?.('finished')
          return 'failed'
        }
        if (oldFavoriteExecutionStopRequestedRef.current) {
          await pauseOldFavoriteExecutionRun(run)
          return 'paused'
        }
        const paced = await paceOldFavoriteExecution(
          index + 1,
          index < groups.length - 1,
          () => oldFavoriteExecutionStopRequestedRef.current
        )
        if (!paced) {
          await pauseOldFavoriteExecutionRun(run)
          return 'paused'
        }
      }

      run = persistOldFavoriteExecutionRecords(run)
      const failedCount = run.results.filter((result) => result.ok !== true).length
      const partialCount = run.results.filter((result) => result.ok !== true && result.partial).length
      const completeFailureCount = failedCount - partialCount
      const message = failedCount > 0
        ? `本次整理已结束，${run.results.length - failedCount} 条成功，${partialCount} 条部分完成，${completeFailureCount} 条失败。`
        : '本次整理已结束。'
      setStatus(message)
      setOldFavoriteExecutionPhase('awaiting-acknowledgement')
      const incompleteIsError = partialCount > 0 || failedCount === run.results.length
      publishOldFavoriteStatus({
        label: failedCount > 0
          ? incompleteIsError ? '整理未完全成功' : '整理有遗漏'
          : '整理完成',
        message,
        tone: failedCount > 0 ? incompleteIsError ? 'error' : 'warn' : 'ok'
      })
      setOldFavoriteExecutionStopping(false)
      onOldFavoriteExecutionStateChange?.('finished')
      return failedCount === 0 ? 'completed' : 'failed'
    } catch (error) {
      const message = `整理旧藏未完成：${errorMessage(error)}`
      setStatus(message)
      setOldFavoriteExecutionPhase('awaiting-acknowledgement')
      publishOldFavoriteStatus({ label: '整理失败', message, tone: 'error' })
      onOldFavoriteExecutionStateChange?.('finished')
      return 'failed'
    } finally {
      // Each network request owns and releases its own authoritative lease.
    }
  }

  async function continueOldFavoriteExecution() {
    if (!oldFavoriteExecutionPaused || !oldFavoriteExecutionRun) return
    let reconciledRun = oldFavoriteExecutionRun
    const requiresReconciliation = getOldFavoriteRuntimeValue(
      'oldFavoriteRecoveryRequiresReconciliation',
      false
    )
    if (requiresReconciliation) {
      if (!onRejudgeOldFavorite) {
        setStatus('恢复前需要核对 B 站实际状态，请等待页面和登录状态准备完成。')
        return
      }
      if (!sessionCoordinator || !activeOldFavoriteUserBatch || !activeOldFavoriteSegmentId ||
        !activeOldFavoriteAccountMid) {
        setStatus('恢复会话尚未准备完成，请稍后重试。')
        return
      }
      const currentAccountMid = onReadCurrentOldFavoriteAccount
        ? (await onReadCurrentOldFavoriteAccount()).trim()
        : ''
      if (!currentAccountMid || currentAccountMid !== activeOldFavoriteUserBatch.accountMid) {
        setStatus('当前 B 站账号与本批次不一致，切回原账号后才能恢复。')
        return
      }
      const acquired = await sessionCoordinator.acquire(
        activeOldFavoriteUserBatch.id,
        activeOldFavoriteSegmentId,
        'reconcile',
        currentAccountMid
      )
      if (!acquired) {
        setStatus('另一个整理任务正在运行，请稍后继续。')
        return
      }
      setStatus('正在核对 B 站实际收藏状态，不会重复执行已落地请求。')
      try {
        const reconciledItems: FavoriteLedgerPreviewItem[] = []
        for (const item of oldFavoriteExecutionRun.selectedItems) {
          reconciledItems.push(await onRejudgeOldFavorite(item))
        }
        reconciledRun = { ...oldFavoriteExecutionRun, selectedItems: reconciledItems }
        setOldFavoriteExecutionRun(reconciledRun)
        setOldFavoriteReconciliationRequired(activeOldFavoriteUserBatch.accountMid, false)
      } finally {
        await sessionCoordinator.release(activeOldFavoriteUserBatch.id, activeOldFavoriteSegmentId)
      }
    }
    await runOldFavoriteExecution(reconciledRun, true)
  }

  async function executeOldFavoritePlan() {
    if (!preview || deepSeekArchiveRunning) return
    if (!oldFavoriteBatchExecutionReadiness.canExecute) {
      setOldFavoriteExecutionConfirming(false)
      setStatus('执行前安全核对尚未完成，请等待来源扫描、工作夹成员和分段对账完成。')
      return
    }
    const executionAccountGeneration = accountGenerationRef.current
    if (activeOldFavoriteUserBatch && onReadCurrentOldFavoriteAccount) {
      const currentAccountMid = (await onReadCurrentOldFavoriteAccount()).trim()
      if (!currentAccountMid || currentAccountMid !== activeOldFavoriteUserBatch.accountMid) {
        setOldFavoriteExecutionConfirming(false)
        setStatus('当前 B 站账号与本批次不一致，切回原账号后才能执行。')
        return
      }
    }
    if (firstInvalidLedgerIndex >= 0) {
      setOldFavoriteExecutionConfirming(false)
      focusInvalidLedger(firstInvalidLedgerIndex)
      return
    }
    if (unresolvedArchiveTargetError) {
      setStatus(unresolvedArchiveTargetError)
      return
    }
    if (getOldFavoriteRuntimeValue<OldFavoriteExecutionPhase>('oldFavoriteExecutionPhase', 'idle') !== 'idle') return
    if (!setOldFavoriteRuntimeValue('oldFavoriteExecutionPhase', 'preparing')) return
    setOldFavoriteExecutionConfirming(false)
    setOldFavoriteExecutionProgress(null)
    setSaveStatus(null)
    setStatus('正在准备整理所需收藏夹，尚未开始操作 B 站视频。')
    publishOldFavoriteStatus({
      label: '正在准备整理',
      message: '正在准备整理所需收藏夹，尚未开始操作 B 站视频。',
      tone: 'running'
    })
    let executionRequestsStarted = false
    try {
      const nextLedgers = buildLedgersToSave()
      let saveResult: AssistantAutomationResult | void
      if (sessionCoordinator && activeOldFavoriteUserBatch && activeOldFavoriteSegmentId) {
        const acquired = await sessionCoordinator.acquire(
          activeOldFavoriteUserBatch.id,
          activeOldFavoriteSegmentId,
          'execute',
          activeOldFavoriteUserBatch.accountMid
        )
        if (!acquired) {
          setStatus('另一个整理任务正在运行，请稍后继续。')
          setOldFavoriteExecutionPhase('idle')
          return
        }
        fullExecutionLeaseHeldRef.current = true
        await guardedSessionUpdateSegment(activeOldFavoriteUserBatch.id, activeOldFavoriteSegmentId, activeOldFavoriteUserBatch.accountMid, {
          status: 'running',
          task: { kind: 'execute', status: 'running', requestState: 'in-flight' },
          snapshot: { currentStep: 'execution' }
        })
        saveResult = await onSaveLedgers(nextLedgers)
      } else {
        saveResult = await onSaveLedgers(nextLedgers)
      }
      if (executionAccountGeneration !== accountGenerationRef.current) {
        setOldFavoriteExecutionPhase('paused')
        return
      }
      setSaveStatus(saveStatusMessage(saveResult))
      if (saveResult?.ok === false) {
        if (sessionOrchestrator && activeOldFavoriteUserBatch && activeOldFavoriteSegmentId) {
          await guardedSessionUpdateSegment(activeOldFavoriteUserBatch.id, activeOldFavoriteSegmentId, activeOldFavoriteUserBatch.accountMid, {
            status: 'paused', taskStatus: 'paused', requestState: 'idle'
          })
        }
        setStatus(saveResult.message || '收藏夹同步失败，未执行归档。')
        setOldFavoriteExecutionPhase('idle')
        return
      }
      if (!setOldFavoriteRuntimeValue('oldFavoriteExecutionPhase', 'running')) return
      setActiveLedgerId(null)
      setActiveLedgerIndex(null)
      setActiveLedgerSavedSnapshot(null)
      const saveResultWithLedgers = saveResult as (AssistantAutomationResult & { ledgers?: FavoriteLedger[] }) | undefined
      const savedLedgers = Array.isArray(saveResultWithLedgers?.ledgers) ? saveResultWithLedgers.ledgers : nextLedgers
      const selectedItems = archivePlanState
        ? buildSelectedOldFavoritePlanItems({
            state: archivePlanState,
            items: continuousOldFavoriteExecution
              ? allSelectableOldFavoriteItems
              : selectableOldFavoriteItems,
            ledgers: ledgersWithOldFavoriteTargetFolders(
              savedLedgers,
              continuousOldFavoriteExecution ? allSelectableOldFavoriteItems : selectableOldFavoriteItems
            )
          })
        : selectedOldFavoritePlanItems
      const targetLimit = deepSeekArchiveMultiLimit(favoriteArchiveMultiMode)
      const missingFolderTarget = selectedItems.find((item) =>
        item.targetLedgerId !== 'inbox' && item.targetLedgerId !== 'unclassified' && !item.targetFolderId
      )
      if (missingFolderTarget) {
        setStatus(`归档目标尚未同步到 B 站：${missingFolderTarget.targetDisplayName}`)
        setOldFavoriteExecutionPhase('idle')
        return
      }
      if (selectedItems.some((item) =>
        item.reorganizeProtected && (item.desiredTargetFolderIds?.length ?? 0) > targetLimit
      )) {
        setStatus(`当前设置最多允许 ${targetLimit} 个 bilimi 收藏夹，请调整后再确认。`)
        setOldFavoriteExecutionPhase('idle')
        return
      }
      if (selectedItems.length === 0) {
        setStatus('收藏夹已同步，请重新扫描旧藏后再确认整理。')
        setOldFavoriteExecutionPhase('idle')
        return
      }
      executionRequestsStarted = true
      const segmentModels = activeOldFavoriteUserBatch?.snapshot?.segmentExecution ?? []
      const executionSegmentIndexes = activeOldFavoriteUserBatch
        ? buildContinuousExecutionPlan(
            segmentModels,
            activeOldFavoriteUserBatch.segmentIndex - 1,
            continuousOldFavoriteExecution
          )
        : []
      const executionItems = executionSegmentIndexes.length > 1 && activeOldFavoriteUserBatch
        ? executionSegmentIndexes.map((segmentIndex) => ({
            segmentIndex,
            items: selectedItems.filter((item) =>
              activeOldFavoriteUserBatch.segmentAids[segmentIndex]?.includes(item.aid)
            )
          })).filter((segment) => segment.items.length > 0)
        : [{ segmentIndex: activeOldFavoriteUserBatch?.segmentIndex ? activeOldFavoriteUserBatch.segmentIndex - 1 : 0, items: selectedItems }]
      const total = executionItems.reduce(
        (sum, segment) => sum + groupOldFavoriteExecutionItems(segment.items).length,
        0
      )
      const run: OldFavoriteExecutionRun = {
        selectedItems,
        nextGroupIndex: 0,
        results: [],
        successfulTargetKeys: [],
        persistedTargetKeys: [],
        confirmedAt: new Date().toISOString()
      }
      setOldFavoriteExecutionRun(run)
      setOldFavoriteExecutionProgress({ completed: 0, total })
      publishOldFavoriteStatus({
        label: `确认执行 0/${total}`,
        message: '正在确认执行旧藏整理。',
        tone: 'running'
      })
      if (executionItems.length <= 1) {
        const outcome = await runOldFavoriteExecution(run)
        if (outcome === 'completed' && activeOldFavoriteUserBatch && sessionOrchestrator) {
          await guardedSessionUpdateSegment(
            activeOldFavoriteUserBatch.id,
            activeOldFavoriteSegmentId,
            activeOldFavoriteUserBatch.accountMid,
            { status: 'ended', requestState: 'idle' }
          )
        }
      } else {
        let completedGroups = 0
        for (const segment of executionItems) {
          const segmentRun = {
            ...run,
            selectedItems: segment.items,
            nextGroupIndex: 0,
            results: [],
            successfulTargetKeys: [],
            persistedTargetKeys: []
          }
          const outcome = await runOldFavoriteExecution(
            segmentRun,
            false,
            `${activeOldFavoriteUserBatch!.id}:segment:${segment.segmentIndex + 1}`
          )
          if (outcome !== 'completed') break
          completedGroups += groupOldFavoriteExecutionItems(segment.items).length
          setOldFavoriteExecutionProgress({ completed: completedGroups, total })
          setOldFavoriteUserBatches((current) => current.map((batch) => {
            if (batch.id !== activeOldFavoriteUserBatch?.id) return batch
            const segmentExecution = (batch.snapshot?.segmentExecution ?? []).map((entry) =>
              entry.index === segment.segmentIndex
                ? { ...entry, status: 'completed' as const, completedCount: entry.executableCount }
                : entry
            )
            return {
              ...batch,
              segmentIndex: Math.min(batch.segmentCount, segment.segmentIndex + 2),
              snapshot: batch.snapshot ? { ...batch.snapshot, segmentExecution } : batch.snapshot
            }
          }))
          if (sessionOrchestrator) {
            await guardedSessionUpdateSegment(
              activeOldFavoriteUserBatch!.id,
              `${activeOldFavoriteUserBatch!.id}:segment:${segment.segmentIndex + 1}`,
              activeOldFavoriteUserBatch!.accountMid,
              { status: 'ended', requestState: 'idle' }
            )
          }
        }
      }
    } catch (error) {
      if (fullExecutionLeaseHeldRef.current && sessionOrchestrator && activeOldFavoriteUserBatch && activeOldFavoriteSegmentId) {
        await guardedSessionUpdateSegment(activeOldFavoriteUserBatch.id, activeOldFavoriteSegmentId, activeOldFavoriteUserBatch.accountMid, {
          status: 'paused', taskStatus: 'paused', requestState: executionRequestsStarted ? 'result-unknown' : 'idle'
        })
        if (executionRequestsStarted) {
          setOldFavoriteReconciliationRequired(activeOldFavoriteUserBatch.accountMid, true)
        }
      }
      const connectionFailure = !executionRequestsStarted && isFavoriteLedgerConnectionFailure(error)
      const message = connectionFailure
        ? '连接 B 站失败，本次整理尚未开始，请刷新后重试'
        : `整理旧藏未完成：${errorMessage(error)}`
      setStatus(message)
      setOldFavoriteExecutionPhase(executionRequestsStarted ? 'awaiting-acknowledgement' : 'idle')
      publishOldFavoriteStatus({ label: '整理失败', message, tone: 'error' })
      onOldFavoriteExecutionStateChange?.('finished')
    } finally {
      if (fullExecutionLeaseHeldRef.current && sessionCoordinator && activeOldFavoriteUserBatch && activeOldFavoriteSegmentId) {
        fullExecutionLeaseHeldRef.current = false
        await sessionCoordinator.release(activeOldFavoriteUserBatch.id, activeOldFavoriteSegmentId)
      }
    }
  }

  const ledgersToDisplay = visibleLedgers(draftLedgers, ledgerListExpanded)
  const allLedgersSelected = draftLedgers.length > 0 && draftLedgers.every(ledgerEnabled)
  const bulkToggleLabel = allLedgersSelected ? '取消全选' : '全选'
  const canToggleLedgerList = draftLedgers.length > ledgersToDisplay.length || ledgerListExpanded
  const sourceSummaryFolders = baseScanPreview?.scanContext?.sourceFolders
  const sourceSummaryBaseItems = baseScanPreview?.items
  const sourceSummaryPreviewItems = preview?.items
  const sourceSummaryInsightFolders = preview?.insights?.sourceFolders
  const sourceSummaryProtectedVideos = baseScanPreview?.scanContext?.protectedVideos
  const managedLogicalFolders = useMemo(() => {
    const context = baseScanPreview?.scanContext
    if (!context) return []
    const grouped = groupFavoritePhysicalShards(context.managedFolders.map((folder) => ({
      id: folder.id,
      logicalLedgerId: folder.ledgerId?.trim() || `legacy-physical:${folder.id}`,
      title: folder.title,
      memberAids: context.targetMembership[folder.id] ?? [],
      isInbox: folder.isInbox
    })))
    return grouped.map((group) => {
      const physicalIds = group.shards.map((shard) => shard.id)
      return {
        id: group.logicalLedgerId,
        sourceKey: `managed:${group.logicalLedgerId}`,
        name: group.logicalTitle,
        totalCount: group.memberAids.length,
        actionableCount: group.memberAids.length,
        physicalIds,
        memberAids: group.memberAids,
        shardCount: group.shardCount,
        isInbox: group.isInbox
      }
    })
  }, [baseScanPreview?.scanContext])
  const scannedOldFavoriteSourceFolders = useMemo<OldFavoriteSourceFolderSummary[]>(() => {
    if (!sourceSummaryFolders?.length) return []
    return sourceSummaryFolders.map((folder) => ({
        id: folder.id,
        sourceKey: oldFavoriteSourceKey(folder.id, folder.title),
        name: folder.title,
        totalCount: Number.isFinite(folder.mediaCount) ? Number(folder.mediaCount) : folder.videos.length,
        actionableCount: (sourceSummaryBaseItems ?? []).filter((item) =>
          oldFavoriteItemMatchesSource(item, {
            id: folder.id,
            name: folder.title,
            sourceKey: oldFavoriteSourceKey(folder.id, folder.title)
          })
        ).length,
        scanFailed: folder.scanFailed,
        scanStatus: folder.scanStatus,
        scanFailureMessage: folder.scanFailureMessage,
        failedPage: folder.failedPage,
        readVideoCount: folder.readVideoCount
      }))
  }, [sourceSummaryBaseItems, sourceSummaryFolders])
  const fallbackOldFavoriteSourceFolders = useMemo<OldFavoriteSourceFolderSummary[]>(() => {
    const sourceFolderCounts = new Map<string, { id?: string; name: string; count: number }>()
    for (const item of sourceSummaryPreviewItems ?? []) {
      const titles = item.sourceFolderTitles ?? [item.sourceFolderTitle]
      if (item.sourceFolderIds?.length) {
        item.sourceFolderIds.forEach((id, index) => {
          const name = titles[index] ?? item.sourceFolderTitle
          const sourceKey = oldFavoriteSourceKey(id, name)
          const current = sourceFolderCounts.get(sourceKey)
          sourceFolderCounts.set(sourceKey, { id, name, count: (current?.count ?? 0) + 1 })
        })
      } else {
        titles.forEach((name) => {
          const sourceKey = oldFavoriteSourceKey(undefined, name)
          const current = sourceFolderCounts.get(sourceKey)
          sourceFolderCounts.set(sourceKey, { name, count: (current?.count ?? 0) + 1 })
        })
      }
    }
    for (const folder of sourceSummaryInsightFolders ?? []) {
      const existing = Array.from(sourceFolderCounts.values()).find((source) => source.name === folder.name)
      if (existing) {
        existing.count = folder.count
      } else {
        sourceFolderCounts.set(oldFavoriteSourceKey(undefined, folder.name), {
          name: folder.name,
          count: folder.count
        })
      }
    }
    for (const item of sourceSummaryProtectedVideos ?? []) {
      const titles = item.sourceFolderTitles ?? []
      const ids = item.sourceFolderIds ?? []
      for (const [index, name] of titles.entries()) {
        const id = ids[index]
        const sourceKey = oldFavoriteSourceKey(id, name)
        const current = sourceFolderCounts.get(sourceKey)
        sourceFolderCounts.set(sourceKey, { id, name, count: (current?.count ?? 0) + 1 })
      }
    }

    return Array.from(sourceFolderCounts, ([sourceKey, source]) => ({
      id: source.id,
      sourceKey,
      name: source.name,
      totalCount: source.count,
      actionableCount: source.count
    }))
  }, [sourceSummaryInsightFolders, sourceSummaryPreviewItems, sourceSummaryProtectedVideos])
  const oldFavoriteSourceFolders = scannedOldFavoriteSourceFolders.length > 0
    ? scannedOldFavoriteSourceFolders
    : fallbackOldFavoriteSourceFolders
  const validOldFavoriteUserSourceFolders = useMemo(
    () => oldFavoriteSourceFolders.filter(
      (folder) => !folder.scanFailed && !isBilimiManagedLedgerName(folder.name)
    ),
    [oldFavoriteSourceFolders]
  )
  const normalizedSelectedOldFavoriteSourceFolderKeys = useMemo(() => {
    const normalized = new Set<string>()
    const validKeys = new Set(validOldFavoriteUserSourceFolders.map((folder) => folder.sourceKey))

    for (const storedKey of selectedOldFavoriteSourceFolderKeys) {
      if (validKeys.has(storedKey)) {
        normalized.add(storedKey)
        continue
      }
      if (storedKey.startsWith('id:')) continue

      const legacyTitle = storedKey.startsWith('title:') ? storedKey.slice('title:'.length) : storedKey
      for (const folder of validOldFavoriteUserSourceFolders) {
        if (folder.name === legacyTitle) normalized.add(folder.sourceKey)
      }
    }
    return normalized
  }, [selectedOldFavoriteSourceFolderKeys, validOldFavoriteUserSourceFolders])
  useEffect(() => {
    if (oldFavoriteSourceFolders.length === 0) return
    if (!sameStringSet(selectedOldFavoriteSourceFolderKeys, normalizedSelectedOldFavoriteSourceFolderKeys)) {
      setSelectedOldFavoriteSourceFolderKeys(normalizedSelectedOldFavoriteSourceFolderKeys)
    }
  }, [
    normalizedSelectedOldFavoriteSourceFolderKeys,
    oldFavoriteSourceFolders.length,
    selectedOldFavoriteSourceFolderKeys,
    setSelectedOldFavoriteSourceFolderKeys
  ])
  const selectedOldFavoriteSourceFolders = useMemo(
    () => validOldFavoriteUserSourceFolders.filter((folder) =>
      normalizedSelectedOldFavoriteSourceFolderKeys.has(folder.sourceKey)
    ),
    [normalizedSelectedOldFavoriteSourceFolderKeys, validOldFavoriteUserSourceFolders]
  )
  const allOldFavoriteUserSourcesSelected =
    validOldFavoriteUserSourceFolders.length > 0 &&
    validOldFavoriteUserSourceFolders.every((folder) =>
      normalizedSelectedOldFavoriteSourceFolderKeys.has(folder.sourceKey)
    )
  const someOldFavoriteUserSourcesSelected = validOldFavoriteUserSourceFolders.some((folder) =>
    normalizedSelectedOldFavoriteSourceFolderKeys.has(folder.sourceKey)
  )
  useEffect(() => {
    if (oldFavoriteSourceSelectAllRef.current) {
      oldFavoriteSourceSelectAllRef.current.indeterminate =
        someOldFavoriteUserSourcesSelected && !allOldFavoriteUserSourcesSelected
    }
  }, [allOldFavoriteUserSourcesSelected, someOldFavoriteUserSourcesSelected])

  function toggleAllOldFavoriteUserSources() {
    setSelectedOldFavoriteSourceFolderKeys(
      allOldFavoriteUserSourcesSelected
        ? new Set()
        : new Set(validOldFavoriteUserSourceFolders.map((folder) => folder.sourceKey))
    )
  }

  function stopOldFavoriteExecution() {
    if (!oldFavoriteExecuting || oldFavoriteExecutionStopping) return
    oldFavoriteExecutionStopRequestedRef.current = true
    setOldFavoriteExecutionStopping(true)
    setOldFavoriteExecutionPhase('pausing')
    setStatus('正在暂停整理；当前请求明确返回后将不再发送下一条。')
  }
  const activeSegmentAidSet = useMemo(() => {
    if (!activeOldFavoriteUserBatch || activeOldFavoriteUserBatch.segmentCount <= 1) return null
    const aids = activeOldFavoriteUserBatch?.segmentAids[activeOldFavoriteUserBatch.segmentIndex - 1]
    return aids ? new Set(aids) : null
  }, [activeOldFavoriteUserBatch])
  const allSelectableOldFavoriteItems = useMemo(
    () =>
      preview?.items
        .filter((item) => selectedOldFavoriteSourceFolders.some((folder) => oldFavoriteItemMatchesSource(item, folder)))
        .map((item) => itemWithSelectedCandidateTargets(item, selectedCandidateKeys)) ?? [],
    [preview, selectedOldFavoriteSourceFolders, selectedCandidateKeys]
  )
  const selectableOldFavoriteItems = useMemo(
    () => allSelectableOldFavoriteItems.filter((item) => !activeSegmentAidSet || activeSegmentAidSet.has(item.aid)),
    [activeSegmentAidSet, allSelectableOldFavoriteItems]
  )
  const protectedOldFavoriteCount = baseScanPreview?.scanContext?.protectedVideos?.length ?? 0
  const protectedArchiveHealthCounts = useMemo(() => {
    const counts = { complete: 0, incomplete: 0, invalid: 0 }
    for (const item of baseScanPreview?.scanContext?.protectedVideos ?? []) {
      if (reorganizedProtectedAids.has(item.aid)) continue
      if (!selectedOldFavoriteSourceFolders.some((folder) => oldFavoriteItemMatchesSource(item, folder))) continue
      counts[item.archiveHealth ?? 'complete'] += 1
    }
    return counts
  }, [baseScanPreview, reorganizedProtectedAids, selectedOldFavoriteSourceFolders])
  const selectedProtectedOldFavorites = useMemo(
    () =>
      (baseScanPreview?.scanContext?.protectedVideos ?? []).filter(
        (item) =>
          !reorganizedProtectedAids.has(item.aid) &&
          selectedOldFavoriteSourceFolders.some((folder) => oldFavoriteItemMatchesSource(item, folder))
      ),
    [baseScanPreview, reorganizedProtectedAids, selectedOldFavoriteSourceFolders]
  )
  const selectedAbnormalProtectedOldFavorites = useMemo(
    () => selectedProtectedOldFavorites.filter((item) =>
      item.archiveHealth === 'incomplete' || item.archiveHealth === 'invalid'
    ),
    [selectedProtectedOldFavorites]
  )
  const hasSelectedAbnormalProtectedOldFavorites = selectedAbnormalProtectedOldFavorites.length > 0
  const activeOldFavoriteCount = baseScanPreview?.items.length ?? preview?.items.length ?? 0
  const totalScannedOldFavoriteCount =
    baseScanPreview?.scanContext?.totalUniqueVideos ??
    (preview?.insights?.totalVideos ?? preview?.items.length ?? 0)

  function protectedVideosAsSourceFolders(aids: Set<number>): FavoriteSourceFolder[] {
    const folders = new Map<string, FavoriteSourceFolder>()
    for (const video of baseScanPreview?.scanContext?.protectedVideos ?? []) {
      if (!aids.has(video.aid)) continue
      const selectedSource = selectedOldFavoriteSourceFolders.find((folder) =>
        oldFavoriteItemMatchesSource(video, folder)
      )
      if (!selectedSource) continue
      const id = selectedSource.id ?? selectedSource.sourceKey
      const title = selectedSource.name
      const folder = folders.get(id) ?? { id, title, videos: [] }
      folder.videos.push({ ...video, reorganizeProtected: true })
      folders.set(id, folder)
    }
    return Array.from(folders.values())
  }

  useEffect(() => {
    const context = preview?.scanContext ?? baseScanPreview?.scanContext
    if (!context || context.multiArchiveMode === favoriteArchiveMultiMode) {
      return
    }

    const previousMode = context.multiArchiveMode
    const nextContext = {
      ...context,
      multiArchiveMode: favoriteArchiveMultiMode
    }
    const createPreview = (sourceFolders: FavoriteSourceFolder[]) => {
      const rebuilt = createFavoriteLedgerPreview({
        ledgers: draftLedgers,
        sourceFolders,
        targetMembership: context.targetMembership,
        skippedSourceFolderTitles: preview?.skippedSourceFolderTitles,
        scanDiagnostics: preview?.scanDiagnostics,
        scanProgress: preview?.scanProgress ?? baseScanPreview?.scanProgress,
        multiArchiveMode: favoriteArchiveMultiMode
      })
      return {
        ...rebuilt,
        scanContext: nextContext,
        items: normalizeOldFavoritePreviewItems(rebuilt.items, draftLedgers)
      }
    }

    const rebuiltBasePreview = createPreview(context.activeSourceFolders)
    const rebuiltPreview = createPreview([
      ...context.activeSourceFolders,
      ...protectedVideosAsSourceFolders(reorganizedProtectedAids)
    ])
    const refreshedState = createArchivePlanStateFromPreviewItems(
      rebuiltPreview.items,
      selectedCandidateKeys
    )
    const mergedState = mergeArchivePlanAfterModeRefresh(
      refreshedState,
      archivePlanState,
      deepSeekArchiveMultiLimit(favoriteArchiveMultiMode)
    )

    rebuiltPreview.items = applyArchivePlanToPreviewItems(
      rebuiltPreview.items,
      mergedState,
      draftLedgers
    )
    setBaseScanPreview(rebuiltBasePreview)
    setPreview(rebuiltPreview)
    setArchivePlanState(mergedState)
    setArchiveMultiModeChange({ from: previousMode, to: favoriteArchiveMultiMode })
    setDeepSeekArchiveResultSummary(null)
    setDeepSeekArchiveSummaryOpen(false)
    setDeepSeekArchiveStatus('')
    clearDeepSeekArchiveRunSnapshot({ resetHistory: true })
    setStatus(
      `归档预览已按“${favoriteArchiveMultiModeLabel(favoriteArchiveMultiMode)}${
        deepSeekArchiveMultiLimit(favoriteArchiveMultiMode) === 1 ? '' : '收藏夹'
      }”更新。`
    )
  }, [favoriteArchiveMultiMode, preview?.scanContext?.multiArchiveMode])

  function applyProtectedReorganization(aids: Set<number>) {
    const context = baseScanPreview?.scanContext
    if (!context) return
    if (activeOldFavoriteUserBatch && aids.size > 0) {
      const ownedAids = [...aids]
      setOldFavoriteUserBatches((current) => current.map((batch) => {
        if (batch.id !== activeOldFavoriteUserBatch.id) return batch
        const segmentIndex = Math.max(0, batch.segmentIndex - 1)
        const segmentAids = batch.segmentAids.map((segment) => [...segment])
        segmentAids[segmentIndex] = [...new Set([...(segmentAids[segmentIndex] ?? []), ...ownedAids])]
        return { ...batch, segmentAids }
      }))
      void sessionOrchestrator?.appendDiscoveredAids(activeOldFavoriteUserBatch.id, ownedAids)
        .catch((error) => setStatus(`整理归属保存失败：${error instanceof Error ? error.message : String(error)}`))
    }
    const nextPreview = createFavoriteLedgerPreview({
      ledgers: draftLedgers,
      sourceFolders: [...context.activeSourceFolders, ...protectedVideosAsSourceFolders(aids)],
      targetMembership: context.targetMembership,
      skippedSourceFolderTitles: baseScanPreview?.skippedSourceFolderTitles,
      scanDiagnostics: baseScanPreview?.scanDiagnostics,
      scanProgress: preview?.scanProgress ?? baseScanPreview?.scanProgress,
      multiArchiveMode: favoriteArchiveMultiMode
    })
    nextPreview.scanContext = { ...context, multiArchiveMode: favoriteArchiveMultiMode }
    const normalizedPreview = {
      ...nextPreview,
      items: normalizeOldFavoritePreviewItems(nextPreview.items, draftLedgers)
    }
    setPreview(normalizedPreview)
    setArchivePlanState(createArchivePlanStateFromPreviewItems(normalizedPreview.items, selectedCandidateKeys))
  }

  function confirmProtectedReorganization() {
    if (oldFavoritePlanReadOnly) return
    const next = new Set(reorganizedProtectedAids)
    for (const item of selectedProtectedOldFavorites) next.add(item.aid)
    const formalLogicalIds = managedLogicalFolders
      .filter((folder) => !folder.isInbox)
      .map((folder) => folder.id)
    setUnlockedManagedLogicalIds(new Set(formalLogicalIds))
    setSelectedManagedLogicalIds((current) => new Set([...current, ...formalLogicalIds]))
    setReorganizedProtectedAids(next)
    setProtectedReorganizationConfirming(false)
    applyProtectedReorganization(next)
  }

  function confirmAbnormalProtectedReorganization() {
    if (oldFavoritePlanReadOnly) return
    const next = new Set(reorganizedProtectedAids)
    for (const item of selectedAbnormalProtectedOldFavorites) next.add(item.aid)
    setReorganizedProtectedAids(next)
    setAbnormalProtectionReorganizationConfirming(false)
    applyProtectedReorganization(next)
  }

  function restoreProtectedFavorites() {
    if (oldFavoritePlanReadOnly || !baseScanPreview) return
    setReorganizedProtectedAids(new Set())
    setPreview(baseScanPreview)
    setArchivePlanState(createArchivePlanStateFromPreviewItems(baseScanPreview.items, selectedCandidateKeys))
  }

  const applyManagedSelection = useCallback((nextSelectedLogicalIds: Set<string>) => {
    const protectedAids = buildManagedSelectionProtection(
      managedLogicalFolders.flatMap((folder) => folder.physicalIds.map((folderId) => ({
        folderId,
        logicalId: folder.id,
        isStaging: folder.isInbox,
        memberAids: baseScanPreview?.scanContext?.targetMembership[folderId] ?? []
      }))),
      [...nextSelectedLogicalIds]
    )
    const allFormalAids = new Set(managedLogicalFolders
      .filter((folder) => !folder.isInbox)
      .flatMap((folder) => folder.memberAids))
    const protectedAidSet = new Set(protectedAids)
    const nextReorganizedAids = new Set([...allFormalAids].filter((aid) => !protectedAidSet.has(aid)))
    setSelectedManagedLogicalIds(nextSelectedLogicalIds)
    setReorganizedProtectedAids(nextReorganizedAids)
    applyProtectedReorganization(nextReorganizedAids)
  }, [baseScanPreview, managedLogicalFolders, setReorganizedProtectedAids, setSelectedManagedLogicalIds])
  const toggleOldFavoriteManagedSourceFolder = useCallback((
    folder: OldFavoriteManagedSourceFolderSummary,
    selected: boolean
  ) => {
    if (folder.isInbox) {
      setSelectedManagedLogicalIds((current) => {
        const next = new Set(current)
        const disabledKey = `disabled:${folder.id}`
        if (selected) next.delete(disabledKey)
        else next.add(disabledKey)
        return next
      })
      return
    }
    const next = new Set(selectedManagedLogicalIds)
    if (selected) next.add(folder.id)
    else next.delete(folder.id)
    applyManagedSelection(next)
  }, [applyManagedSelection, selectedManagedLogicalIds, setSelectedManagedLogicalIds])
  const oldFavoriteUserSourceFolders = useMemo(
    () => oldFavoriteSourceFolders.filter((folder) => !isBilimiManagedLedgerName(folder.name)),
    [oldFavoriteSourceFolders]
  )
  const oldFavoriteBilimiSourceFolders = useMemo(() => {
    if (managedLogicalFolders.length > 0) return managedLogicalFolders
    return oldFavoriteSourceFolders
      .filter((folder) => isBilimiManagedLedgerName(folder.name))
      .map((folder) => ({
        ...folder,
        physicalIds: folder.id ? [folder.id] : [],
        memberAids: [],
        shardCount: 1,
        isInbox: /暂存|待分类/.test(folder.name)
      }))
  }, [managedLogicalFolders, oldFavoriteSourceFolders])
  const archiveExecutionLedgers = useMemo(
    () => ledgersWithOldFavoriteTargetFolders(draftLedgers, selectableOldFavoriteItems),
    [draftLedgers, selectableOldFavoriteItems]
  )
  const unresolvedArchiveTargetIds = useMemo(() => {
    const knownLedgerIds = new Set(archiveExecutionLedgers.map((ledger) => ledger.id))
    return Array.from(
      new Set(
        (archivePlanState?.items ?? []).flatMap((item) =>
          item.selectedTargetLedgerIds.filter(
            (ledgerId) =>
              ledgerId !== 'inbox' &&
              ledgerId !== 'unclassified' &&
              !knownLedgerIds.has(ledgerId)
          )
        )
      )
    )
  }, [archiveExecutionLedgers, archivePlanState])
  const unresolvedArchiveTargetError = unresolvedArchiveTargetIds.length > 0
    ? `无法解析归档目标：${unresolvedArchiveTargetIds.join('、')}`
    : null
  const selectedOldFavoritePlanItems = useMemo(
    () => {
      if (unresolvedArchiveTargetIds.length > 0) return []
      const stagingFolderIds = new Set(
        (preview?.scanContext?.managedFolders ?? [])
          .filter((folder) => folder.isInbox)
          .map((folder) => folder.id)
      )
      return buildSelectedOldFavoritePlanItems({
            state: archivePlanState,
            items: selectableOldFavoriteItems,
            ledgers: archiveExecutionLedgers
          }).map((item) => ({
            ...item,
            stagingFolderIds: (item.currentBilimiFolderIds ?? []).filter((folderId) => stagingFolderIds.has(folderId))
          }))
    },
    [archiveExecutionLedgers, archivePlanState, preview?.scanContext?.managedFolders, selectableOldFavoriteItems, unresolvedArchiveTargetIds]
  )
  const selectedOldFavoriteVideoCount = useMemo(
    () =>
      new Set(
        selectedOldFavoritePlanItems.map(
          (item) => `${item.sourceFolderTitle}:${item.aid}`
        )
      ).size,
    [selectedOldFavoritePlanItems]
  )
  const oldFavoriteSegmentProgress = useMemo(() => {
    if (!activeOldFavoriteUserBatch) return null
    const segments = activeOldFavoriteUserBatch.snapshot?.segmentExecution ??
      activeOldFavoriteUserBatch.segmentAids.map((aids, index) => ({
        index,
        status: 'ready' as const,
        executableCount: index === activeOldFavoriteUserBatch.segmentIndex - 1
          ? selectedOldFavoritePlanItems.length
          : aids.length,
        completedCount: 0
      }))
    return buildSegmentProgress(segments, activeOldFavoriteUserBatch.segmentIndex - 1)
  }, [activeOldFavoriteUserBatch, selectedOldFavoritePlanItems.length])
  const protectedReconciliationSummary = useMemo(() => {
    let addCount = 0
    let unchangedCount = 0
    for (const item of selectedOldFavoritePlanItems.filter((item) => item.reorganizeProtected)) {
      const desiredFolderIds = uniqueLedgerIds(item.desiredTargetFolderIds ?? [])
      const currentFolderIds = uniqueLedgerIds(item.currentBilimiFolderIds ?? [])
      const hasAdded = desiredFolderIds.some((folderId) => !currentFolderIds.includes(folderId))
      if (hasAdded) addCount += 1
      if (!hasAdded) unchangedCount += 1
    }

    return {
      total: selectedOldFavoritePlanItems.filter((item) => item.reorganizeProtected).length,
      addCount,
      removeCount: 0,
      unchangedCount
    }
  }, [selectedOldFavoritePlanItems])
  const oldFavoriteEndSummary = useMemo(() => {
    const items = archivePlanState?.items ?? []
    const failed = oldFavoriteExecutionRun?.results.filter((result) => result.ok !== true).length ?? 0
    const completed = oldFavoriteExecutionProgress?.completed ?? 0
    const total = oldFavoriteExecutionProgress?.total ?? selectedOldFavoritePlanItems.length
    const stagingAids = new Set(
      (preview?.scanContext?.managedFolders ?? [])
        .filter((folder) => folder.isInbox)
        .flatMap((folder) => preview?.scanContext?.targetMembership[folder.id] ?? [])
    )
    return {
      unmatched: items.filter((item) => item.currentTargetLedgerIds.length === 0).length,
      review: items.filter((item) => item.lowConfidence).length,
      unexecuted: Math.max(0, total - completed),
      failed,
      staging: stagingAids.size
    }
  }, [archivePlanState, oldFavoriteExecutionProgress, oldFavoriteExecutionRun, preview, selectedOldFavoritePlanItems.length])
  const archivePlanItemsByBaseKey = useMemo(() => {
    const itemsByKey = new Map<string, NonNullable<typeof archivePlanState>['items'][number]>()
    for (const item of archivePlanState?.items ?? []) {
      const key = archivePlanItemKey(item)
      if (!itemsByKey.has(key)) itemsByKey.set(key, item)
    }
    return itemsByKey
  }, [archivePlanState])
  const previewScopedPendingItems = useMemo(
    () =>
      selectableOldFavoriteItems.filter((item) => {
        const planItem = archivePlanItemsByBaseKey.get(archivePlanItemKey(item))
        return !item.alreadyInTarget && (planItem ? planItem.currentTargetLedgerIds.length === 0 : isPreviewScopedPendingItem(item))
      }),
      [archivePlanItemsByBaseKey, selectableOldFavoriteItems]
  )
  const previewScopedPendingAids = useMemo(
    () => new Set(previewScopedPendingItems.map((item) => item.aid)),
    [previewScopedPendingItems]
  )
  const missingOldFavoriteTargetNames = Array.from(
    new Set(
      selectedOldFavoritePlanItems
        .filter((item) => !item.targetFolderId && !item.selectedCandidateTarget)
        .map((item) => item.targetDisplayName || ledgerNamesById[item.targetLedgerId] || item.targetLedgerId)
    )
  )
  const oldFavoriteTargetWarning =
    missingOldFavoriteTargetNames.length > 0
      ? `确认整理会先同步 ${missingOldFavoriteTargetNames.join('、')} 收藏夹；同步后请重新扫描旧藏以归档到新建收藏夹。`
      : null
  const autoSelectedOldFavoriteCount = new Set(
    selectableOldFavoriteItems
      .filter((item) =>
        item.selected &&
        !item.alreadyInTarget &&
        !item.reviewRequired &&
        !previewScopedPendingAids.has(item.aid)
      )
      .map((item) => item.aid)
  ).size
  const reviewRequiredOldFavoriteCount = new Set(
    selectableOldFavoriteItems
      .filter((item) => item.reviewRequired && !previewScopedPendingAids.has(item.aid))
      .map((item) => item.aid)
  ).size
  const alreadyInTargetOldFavoriteCount =
    selectableOldFavoriteItems.filter((item) => item.alreadyInTarget).length ?? 0
  const skippedSourceFolderCount = preview?.skippedSourceFolderTitles.length ?? 0
  const tagDetailFailureCount = preview?.scanDiagnostics?.tagDetailFailures ?? 0
  const folderFailures = preview?.scanDiagnostics?.folderFailures ?? []
  const globalCircuitFailures = folderFailures.filter((failure) => failure.errorKind === 'global-circuit-open')
  const globalCircuitTrigger = globalCircuitFailures.length > 0
    ? folderFailures.find((failure) => failure.errorKind !== 'global-circuit-open' && failure.riskSignal)
    : undefined
  const ordinaryFolderFailures = folderFailures.filter(
    (failure) => failure.errorKind !== 'global-circuit-open' && failure !== globalCircuitTrigger
  )
  const visibleOrdinaryFolderFailures = ordinaryFolderFailures.slice(0, 3)
  const foldedOrdinaryFolderFailures = ordinaryFolderFailures.slice(3)
  const globalCircuitRetainedCount = globalCircuitTrigger?.retainedVideoCount ?? 0
  const oldFavoriteCandidateCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of selectableOldFavoriteItems) {
      if (item.alreadyInTarget) {
        continue
      }

      for (const target of item.candidateTargets ?? []) {
        counts.set(target.candidateKey, (counts.get(target.candidateKey) ?? 0) + 1)
      }
    }
    return counts
  }, [selectableOldFavoriteItems])
  const batchRecommendationSummaries = useMemo(() => {
    if (!activeOldFavoriteUserBatch) return new Map<string, ReturnType<typeof aggregateBatchRecommendations>[number]>()
    const stored = activeOldFavoriteUserBatch.snapshot?.recommendations
    const segmentIndex = activeOldFavoriteUserBatch.segmentIndex - 1
    const matchingItemsByCandidateKey = new Map<string, FavoriteLedgerPreviewItem[]>()
    for (const item of preview?.items ?? []) {
      for (const target of item.candidateTargets ?? []) {
        const matchingItems = matchingItemsByCandidateKey.get(target.candidateKey)
        if (matchingItems) matchingItems.push(item)
        else matchingItemsByCandidateKey.set(target.candidateKey, [item])
      }
    }
    const currentEntries: SegmentRecommendation[] = (preview?.insights?.candidateLedgers ?? []).map((candidate) => {
      const stableKey = candidateKey(candidate)
      const matchingItems = matchingItemsByCandidateKey.get(stableKey) ?? []
      return {
        stableKey,
        ledgerId: candidateLedgerId(candidate),
        displayName: candidate.displayName,
        segmentIndex,
        matchedAids: matchingItems.map((item) => item.aid),
        matchedItemKeys: matchingItems.map(archivePlanItemKey)
      }
    })
    const entries = stored?.entries?.length ? stored.entries : currentEntries
    const scannedSegmentIndexes = stored?.scannedSegmentIndexes?.length
      ? stored.scannedSegmentIndexes
      : [segmentIndex]
    return new Map(aggregateBatchRecommendations(entries, {
      currentSegmentIndex: segmentIndex,
      totalSegments: activeOldFavoriteUserBatch.segmentCount,
      scannedSegmentIndexes
    }).map((summary) => [summary.stableKey, summary]))
  }, [activeOldFavoriteUserBatch, preview])
  const oldFavoriteTargetGroups = useMemo(
    () => {
      const groups = buildOldFavoriteTargetGroups({
        state: archivePlanState,
        items: selectableOldFavoriteItems,
        ledgers: archiveExecutionLedgers
      })

      return groups.map((group) => ({
        ...group,
        entries: [...group.entries].sort((left, right) => {
          const leftLowConfidence = left.item.lowConfidence || left.item.classificationDiagnostic?.lowConfidence
          const rightLowConfidence = right.item.lowConfidence || right.item.classificationDiagnostic?.lowConfidence
          if (left.targetChanged !== right.targetChanged) {
            return left.targetChanged ? -1 : 1
          }
          if (leftLowConfidence !== rightLowConfidence) {
            return leftLowConfidence ? -1 : 1
          }
          return left.item.title.localeCompare(right.item.title, 'zh-Hans-CN')
        })
      }))
    },
    [archiveExecutionLedgers, archivePlanState, selectableOldFavoriteItems]
  )
  useEffect(() => {
    if (!manualArchiveMoveFocus) {
      return
    }

    const previewRows = Array.from(
      document.querySelectorAll<HTMLElement>('.favorite-ledger-panel__preview-row')
    )
    const previewRowForLedger = (ledgerId: string) =>
      previewRows.find((row) => row.dataset.archiveLedgerId === ledgerId) ?? null

    for (const ledgerId of uniqueLedgerIds([
      manualArchiveMoveFocus.sourceLedgerId,
      manualArchiveMoveFocus.targetLedgerId,
      ...(manualArchiveMoveFocus.resetLedgerIds ?? [])
    ])) {
      const track = previewRowForLedger(ledgerId)?.querySelector<HTMLElement>(
        '.favorite-ledger-panel__preview-videos'
      )
      if (track) {
        track.scrollLeft = 0
      }
    }

    if (manualArchiveMoveFocus.scrollIntoView !== false) {
      previewRowForLedger(manualArchiveMoveFocus.targetLedgerId)?.scrollIntoView?.({
        behavior: 'smooth',
        block: 'nearest'
      })
    }
    setManualArchiveMoveFocus(null)
  }, [manualArchiveMoveFocus, oldFavoriteTargetGroups])
  const hasArchivePreviewChanges = archivePlanState ? archivePlanHasPreviewChanges(archivePlanState) : false
  const deepSeekArchiveProgressValue = deepSeekArchiveProgress
    ? deepSeekArchiveProgressPercent(deepSeekArchiveProgress)
    : 0
  const deepSeekArchiveNonApplicationRows = deepSeekArchiveResultSummary
    ? [
        ['保持未分类', deepSeekArchiveResultSummary.nonApplicationCounts['kept-unclassified']],
        ['目标分类不可用', deepSeekArchiveResultSummary.nonApplicationCounts['unavailable-target']],
        ['返回信息不完整', deepSeekArchiveResultSummary.nonApplicationCounts['invalid-result']],
        ['无法匹配原视频', deepSeekArchiveResultSummary.nonApplicationCounts['unmatched-video']],
        ['请求失败', deepSeekArchiveResultSummary.nonApplicationCounts['request-failed']]
      ].filter((entry): entry is [string, number] => Number(entry[1]) > 0)
    : []
  const deepSeekArchiveResultStatusText = deepSeekArchiveResultSummary
    ? `${deepSeekArchiveResultSummary.successCount} 条已应用，${deepSeekArchiveResultSummary.failedCount} 条未应用`
    : ''
  const allPreviewScopedPendingItemsStaged =
    previewScopedPendingItems.length > 0 &&
    previewScopedPendingItems.every((item) => {
      const planItem = archivePlanItemsByBaseKey.get(archivePlanItemKey(item))
      return planItem?.selectedTargetLedgerIds.includes('inbox')
    })
  const oldFavoriteFollowUpCandidates = useMemo(
    () =>
      sortFavoriteLedgerCandidatesByCount(
        preview?.insights?.candidateLedgers.filter(
          (candidate) => candidate.kind === 'author' || candidate.kind === 'series'
        ) ?? [],
        oldFavoriteCandidateCounts
      ),
    [oldFavoriteCandidateCounts, preview]
  )
  const oldFavoriteTagCandidates = useMemo(
    () =>
      sortFavoriteLedgerCandidatesByCount(
        preview?.insights?.candidateLedgers.filter((candidate) => candidate.kind === 'tag-cluster') ?? [],
        oldFavoriteCandidateCounts
      ),
    [oldFavoriteCandidateCounts, preview]
  )
  const visibleOldFavoriteTagCandidates = useMemo(
    () =>
      oldFavoriteTagCandidates.slice(
        0,
        tagCandidatesExpanded ? EXPANDED_TAG_CANDIDATE_COUNT : COLLAPSED_TAG_CANDIDATE_COUNT
      ),
    [oldFavoriteTagCandidates, tagCandidatesExpanded]
  )
  const canExpandOldFavoriteTagCandidates =
    !tagCandidatesExpanded && oldFavoriteTagCandidates.length > COLLAPSED_TAG_CANDIDATE_COUNT
  const allFollowUpCandidatesSelected =
    oldFavoriteFollowUpCandidates.length > 0 &&
    oldFavoriteFollowUpCandidates.every((candidate) => selectedCandidateKeys.has(candidateKey(candidate)))
  const allTagCandidatesSelected =
    oldFavoriteTagCandidates.length > 0 &&
    oldFavoriteTagCandidates.every((candidate) => selectedCandidateKeys.has(candidateKey(candidate)))
  const deepSeekArchiveDisabled =
    oldFavoriteGuideMode === 'setup' ||
    !archivePlanState ||
    !onOrganizeOldFavoritesWithDeepSeek

  useEffect(() => {
    if (deepSeekArchiveRunning) {
      setDeepSeekArchiveScopeOpen(false)
    }
  }, [deepSeekArchiveRunning])

  useEffect(() => {
    if (oldFavoriteGuideMode !== 'organize' || oldFavoriteStep !== 'preview') {
      return undefined
    }

    function handleArchiveShortcut(event: KeyboardEvent) {
      if (oldFavoritePlanReadOnly) return
      if (
        !event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.key.toLowerCase() !== 'z' ||
        isEditableShortcutTarget(event.target)
      ) {
        return
      }

      if (event.shiftKey) {
        if (archiveRedoStack.length === 0 || deepSeekArchiveRunning || archiveBatchRunning) {
          return
        }

        event.preventDefault()
        redoArchivePreviewChanges()
        return
      }

      if (!archivePlanState || deepSeekArchiveRunning || archiveBatchRunning || archiveUndoStack.length === 0) {
        return
      }

      event.preventDefault()
      undoArchivePreviewChanges()
    }

    document.addEventListener('keydown', handleArchiveShortcut)
    return () => document.removeEventListener('keydown', handleArchiveShortcut)
  }, [
    archivePlanState,
    archiveBatchRunning,
    archiveRedoStack,
    archiveUndoStack,
    deepSeekArchiveRunning,
    oldFavoriteGuideMode,
    oldFavoritePlanReadOnly,
    oldFavoriteStep
  ])

  function oldFavoriteCandidateDetailText(candidate: FavoriteLedgerCandidate) {
    return oldFavoriteCandidateRecommendationText(candidate)
  }

  function oldFavoriteCandidateRecommendationText(candidate: FavoriteLedgerCandidate) {
    const batchSummary = batchRecommendationSummaries.get(candidateKey(candidate))
    if (batchSummary && activeOldFavoriteUserBatch && (
      activeOldFavoriteUserBatch.segmentCount > 1 ||
      Boolean(activeOldFavoriteUserBatch.snapshot?.recommendations?.entries?.length)
    )) {
      return `全批 ${batchSummary.uniqueMatchCount}${batchSummary.countIsFinal ? '' : '+'} · 本段 ${batchSummary.currentSegmentMatchCount} · ${batchSummary.scannedSegmentCount}/${batchSummary.totalSegments}`
    }
    const count = oldFavoriteCandidateCounts.get(candidateKey(candidate)) ?? candidate.count
    return count > 0 ? `${count} 条适合` : '按扫描结果生成'
  }

  function archiveTargetOptionsForOldFavoriteItem(item: FavoriteLedgerPreviewItem) {
    return draftLedgers.filter(
      (ledger) =>
        ledger.enabled &&
        isBilimiLedger(ledger)
    )
  }

  function originalArchiveSuggestionText(item: FavoriteLedgerPreviewItem) {
    const originalLedgerIds = originalArchiveLedgerIdsForOldFavoriteItem(item)
    if (originalLedgerIds.length === 0) {
      return '未分类'
    }

    return originalLedgerIds
      .map((ledgerId) => favoriteLedgerNameForArchiveId(ledgerId, item, draftLedgers, ledgerNamesById))
      .join('、')
  }

  function oldFavoriteArchiveWasModified(item: FavoriteLedgerPreviewItem) {
    return !sameLedgerIds(
      originalArchiveLedgerIdsForOldFavoriteItem(item),
      currentArchiveLedgerIdsForOldFavoriteItem(item)
    )
  }

  function archiveSourceNoticeAreaLedgerIds(item: FavoriteLedgerPreviewItem) {
    const originalLedgerIds = originalArchiveLedgerIdsForOldFavoriteItem(item)
    const currentLedgerIds = currentArchiveLedgerIdsForOldFavoriteItem(item)
    const addedLedgerIds = currentLedgerIds.filter((ledgerId) => !originalLedgerIds.includes(ledgerId))

    if (addedLedgerIds.length > 0) {
      return addedLedgerIds
    }

    return currentLedgerIds.length > 0 ? currentLedgerIds : ['unclassified']
  }

  function currentArchivePositionText(item: FavoriteLedgerPreviewItem) {
    const currentLedgerIds = currentArchiveLedgerIdsForOldFavoriteItem(item)
    return currentLedgerIds.length > 0
      ? currentLedgerIds.map(archiveLedgerDisplayName).join('、')
      : '未分类'
  }

  function archiveLedgerDisplayName(ledgerId: string) {
    if (ledgerId === 'unclassified') {
      return '未分类'
    }

    return archiveExecutionLedgers.find((ledger) => ledger.id === ledgerId)?.displayName ?? '未知收藏夹'
  }

  function archivePlanTargetText(
    planItem: FavoriteArchivePlanItemState,
    options: { inboxAsUnclassified?: boolean } = {}
  ) {
    if (planItem.currentTargetLedgerIds.length === 0) {
      return '未分类'
    }

    const displayLedgerIds = options.inboxAsUnclassified
      ? planItem.currentTargetLedgerIds.filter((ledgerId) => ledgerId !== 'inbox')
      : planItem.currentTargetLedgerIds
    if (displayLedgerIds.length === 0) {
      return '未分类'
    }

    return displayLedgerIds.map(archiveLedgerDisplayName).join('、')
  }

  function latestArchiveChangeBetween(
    previousState: FavoriteArchivePlanState,
    nextState: FavoriteArchivePlanState,
    options: { batchReason?: string; forceBatch?: boolean; inboxAsUnclassified?: boolean } = {}
  ): ArchivePreviewLatestChange | null {
    const previousItemsByKey = new Map(previousState.items.map((item) => [item.itemKey, item]))
    const movedItems = nextState.items.filter((nextItem) => {
      const previousItem = previousItemsByKey.get(nextItem.itemKey)
      return previousItem && (
        !sameLedgerIds(previousItem.currentTargetLedgerIds, nextItem.currentTargetLedgerIds) ||
        !sameLedgerIds(previousItem.selectedTargetLedgerIds, nextItem.selectedTargetLedgerIds)
      )
    })
    const latestItem = movedItems[movedItems.length - 1]
    if (!latestItem) {
      return null
    }

    const itemChanges: ArchivePreviewLatestChange['itemChanges'] = {}
    for (const nextItem of movedItems) {
      const previousMovedItem = previousItemsByKey.get(nextItem.itemKey)
      itemChanges[nextItem.itemKey] = {
        aid: nextItem.aid,
        title: nextItem.title,
        previousTargetText: previousMovedItem
          ? archivePlanTargetText(previousMovedItem, {
              inboxAsUnclassified: options.inboxAsUnclassified
            })
          : '未分类',
        nextTargetText: archivePlanTargetText(nextItem),
        currentTargetLedgerIds: [...nextItem.currentTargetLedgerIds],
        selectedTargetLedgerIds: [...nextItem.selectedTargetLedgerIds],
        source: nextItem.lastChangeSource
      }
    }
    const isBatch = Boolean(options.forceBatch) || movedItems.length > 1
    return {
      kind: isBatch ? 'batch' : 'single',
      title: latestItem.title,
      reason: options.batchReason ?? latestItem.title,
      movedCount: movedItems.length,
      itemChanges,
      focusItemKey: latestItem.itemKey
    }
  }

  function archiveChangeRecordOptionText(change: ArchivePreviewLatestChange) {
    if (change.kind === 'batch') {
      return `最近批量改动：${change.reason}，移动 ${change.movedCount} 条`
    }

    return `最近一次改动：${change.title}`
  }

  function renderArchiveHistoryMenu() {
    const currentChange = archiveUndoChanges.at(-1)
    return (
      <div className="favorite-ledger-panel__archive-history-select-control">
        <button
          type="button"
          className="favorite-ledger-panel__archive-history-trigger"
          aria-label="查看改动记录"
          aria-expanded={archiveHistoryOpen}
          title="查看改动记录"
          onClick={() => setArchiveHistoryOpen((open) => !open)}
        >
          <span className="favorite-ledger-panel__archive-history-arrow" aria-hidden="true" />
        </button>
        {archiveHistoryOpen ? (
          <div className="favorite-ledger-panel__archive-history-menu" role="menu" aria-label="改动记录">
            {currentChange ? (
              <button type="button" role="menuitem" disabled title={`当前状态：${archiveChangeRecordOptionText(currentChange)}`}>
                当前状态：{archiveChangeRecordOptionText(currentChange)}
              </button>
            ) : (
              <button type="button" role="menuitem" disabled title="暂无改动记录">暂无改动记录</button>
            )}
            {archiveUndoChanges.slice(0, -1)
              .map((change, index) => ({ change, index }))
              .reverse()
              .map(({ change, index }) => (
                <button
                  key={`archive-change-${index}`}
                  type="button"
                  role="menuitem"
                  title={archiveChangeRecordOptionText(change)}
                  onClick={() => {
                    setArchiveHistoryOpen(false)
                    rollbackArchivePreviewHistory(index)
                  }}
                >
                  {archiveChangeRecordOptionText(change)}
                </button>
              ))}
            {archiveUndoChanges.length > 0 ? (
              <button
                type="button"
                role="menuitem"
                title="归档预览初始状态"
                onClick={() => {
                  setArchiveHistoryOpen(false)
                  rollbackArchivePreviewHistory(-1)
                }}
              >
                归档预览初始状态
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  function archiveChangeAlertSummary(change: ArchivePreviewLatestChange | null) {
    if (!change || change.kind !== 'batch') {
      return null
    }

    return `${change.reason}：移动 ${change.movedCount} 条`
  }

  function archivePreviewMoveFocusBetween(
    previousState: FavoriteArchivePlanState,
    nextState: FavoriteArchivePlanState
  ): ArchivePreviewManualMoveFocus | null {
    const resetLedgerIds: string[] = []
    let sourceLedgerId = ''
    let targetLedgerId = ''
    const previousItemsByKey = new Map(previousState.items.map((item) => [item.itemKey, item]))

    for (const nextItem of nextState.items) {
      const previousItem = previousItemsByKey.get(nextItem.itemKey)
      if (!previousItem || sameLedgerIds(previousItem.currentTargetLedgerIds, nextItem.currentTargetLedgerIds)) {
        continue
      }

      const previousLedgerIds =
        previousItem.currentTargetLedgerIds.length > 0 ? previousItem.currentTargetLedgerIds : ['unclassified']
      const nextLedgerIds =
        nextItem.currentTargetLedgerIds.length > 0 ? nextItem.currentTargetLedgerIds : ['unclassified']
      resetLedgerIds.push(...previousLedgerIds, ...nextLedgerIds)
      sourceLedgerId = previousLedgerIds[0] ?? 'unclassified'
      targetLedgerId =
        nextLedgerIds.find((ledgerId) => !previousLedgerIds.includes(ledgerId)) ??
        nextLedgerIds[0] ??
        'unclassified'
    }

    if (!sourceLedgerId || !targetLedgerId) {
      return null
    }

    return { sourceLedgerId, targetLedgerId, resetLedgerIds: uniqueLedgerIds(resetLedgerIds) }
  }

  function renderOldFavoritePreviewMeta(item: FavoriteLedgerPreviewItem, target?: FavoriteLedgerPreviewTarget) {
    const allTagsText = oldFavoriteTagsText(item)
    const visibleTagsText = oldFavoriteVisibleTagsText(item)
    const confidenceTitle = lowConfidenceDetailText(item)
    const confidenceText = classificationConfidenceText(item)

    return (
      <span className="favorite-ledger-panel__preview-video-meta">
        <small title={item.sourceFolderTitle}>来源：{item.sourceFolderTitle}</small>
        <small title={oldFavoriteAuthorText(item)}>UP：{oldFavoriteAuthorText(item)}</small>
        <small title={allTagsText || visibleTagsText}>标签：{visibleTagsText}</small>
        <small title={confidenceTitle}>{confidenceText}</small>
        {target?.alreadyInTarget ? <small title="已在目标">已在目标</small> : null}
      </span>
    )
  }

  function renderOldFavoriteArchiveControls(
    item: FavoriteLedgerPreviewItem,
    areaLedgerId: string,
    target?: FavoriteLedgerPreviewTarget
  ) {
    const selectLabel = '转移'
    const targetDisplayName = archiveLedgerDisplayName(areaLedgerId)
    const hasSelectedTarget = areaLedgerId !== 'unclassified'
    const targetTitle = hasSelectedTarget
      ? `当前位置：${targetDisplayName}，可手动切换`
      : '当前位置：未分类，可手动切换到 bilimi 收藏夹'

    return (
      <div className="favorite-ledger-panel__preview-controls" onClick={(event) => event.stopPropagation()}>
        <label className="favorite-ledger-panel__position-control">
          <span className="sr-only">{selectLabel} {item.title}</span>
          <select
            aria-label={`${selectLabel} ${item.title}`}
            className="favorite-ledger-panel__target-select"
            data-selected={hasSelectedTarget}
            title={targetTitle}
            value=""
            disabled={oldFavoritePlanReadOnly || deepSeekArchiveRunning || archiveBatchRunning}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              const targetLedgerId = event.currentTarget.value
              if (targetLedgerId) {
                handleOldFavoriteArchiveSelection(item, areaLedgerId, targetLedgerId)
              }
            }}
          >
            <option value="" disabled>
              转移
            </option>
            {archiveTargetOptionsForOldFavoriteItem(item).map((ledger) => (
              <option key={ledger.id} value={ledger.id}>
                {ledger.displayName}
              </option>
            ))}
            <option value="unclassified">未分类</option>
          </select>
        </label>
        {areaLedgerId === 'unclassified' ? (
          <button
            type="button"
            aria-label={`再次整理 ${item.title}`}
            disabled={oldFavoritePlanReadOnly || deepSeekArchiveRunning || archiveBatchRunning}
            onClick={() => void rejudgeOldFavorite(item)}
          >
            再次整理
          </button>
        ) : null}
        {renderOriginalArchiveSourceNotice(item, areaLedgerId)}
      </div>
    )
  }

  function renderPendingOldFavoriteArticle(item: FavoriteLedgerPreviewItem) {
    return (
      <article
        data-latest-change={
          latestArchiveChange?.itemChanges[archivePlanItemKey(item)] ? 'true' : undefined
        }
      >
        <div className="favorite-ledger-panel__preview-video favorite-ledger-panel__preview-video--pending">
          {renderOldFavoriteVideoTitle(item)}
          {renderOldFavoritePreviewMeta(item)}
        </div>
        {renderOldFavoriteArchiveControls(item, 'unclassified')}
      </article>
    )
  }

  function renderTargetOldFavoriteArticle(
    group: OldFavoriteTargetGroup,
    entry: OldFavoriteTargetGroup['entries'][number]
  ) {
    const { item, target, selected, changedByDeepSeek } = entry
    return (
      <article
        data-latest-change={
          latestArchiveChange?.itemChanges[archivePlanItemKey(item)] ? 'true' : undefined
        }
      >
        <div
          className={[
            'favorite-ledger-panel__preview-video',
            selected ? 'favorite-ledger-panel__preview-video--selected' : '',
            changedByDeepSeek ? 'favorite-ledger-panel__preview-video--deepseek' : ''
          ].filter(Boolean).join(' ')}
          data-selected={selected}
          aria-pressed={selected}
          aria-disabled={oldFavoritePlanReadOnly || deepSeekArchiveRunning || archiveBatchRunning || target.alreadyInTarget}
          onClick={() => {
            if (!oldFavoritePlanReadOnly && !deepSeekArchiveRunning && !target.alreadyInTarget) {
              toggleOldFavoriteTarget(item, group.ledgerId)
            }
          }}
        >
          {renderOldFavoriteVideoTitle(item)}
          {renderOldFavoritePreviewMeta(item, target)}
        </div>
        {renderOldFavoriteArchiveControls(item, group.ledgerId, target)}
      </article>
    )
  }

  function renderOriginalArchiveSourceNotice(item: FavoriteLedgerPreviewItem, areaLedgerId: string) {
    if (
      !oldFavoriteArchiveWasModified(item) ||
      !archiveSourceNoticeAreaLedgerIds(item).includes(areaLedgerId)
    ) {
      return null
    }

    const originalPosition = originalArchiveSuggestionText(item)
    const currentPosition = currentArchivePositionText(item)
    const message = `来自 ${originalPosition}`
    const detail = `整理前位置：【${originalPosition}】；当前位置：【${currentPosition}】。`

    return (
      <small className="favorite-ledger-panel__preview-delta-row">
        <span className="favorite-ledger-panel__preview-delta" title={detail}>
          {message}
        </span>
      </small>
    )
  }

  function renderDeepSeekArchiveScopeMenu() {
    const selectedScopeLabel = deepSeekArchiveProcessingLabel(deepSeekArchiveMode)
    const canChooseSegmentScope = Boolean(activeOldFavoriteUserBatch && activeOldFavoriteUserBatch.segmentCount > 1)

    const renderMenu = () => deepSeekArchiveScopeMenu === 'processing' ? (
      <div
        className="favorite-ledger-panel__deepseek-archive-scope-menu"
        role="menu"
        aria-label="DeepSeek 处理对象"
      >
        {DEEPSEEK_ARCHIVE_PROCESSING_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="menuitemradio"
            aria-checked={deepSeekArchiveMode === option.value}
            onClick={() => {
              setDeepSeekArchiveMode(option.value)
              setDeepSeekArchiveScopeOpen(false)
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    ) : (
      <div
        className="favorite-ledger-panel__deepseek-archive-scope-menu"
        role="menu"
        aria-label="DeepSeek 分段范围"
      >
        {DEEPSEEK_ARCHIVE_SEGMENT_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="menuitemradio"
            aria-checked={deepSeekSegmentScope === option.value}
            onClick={() => {
              setDeepSeekSegmentScope(option.value)
              setDeepSeekArchiveScopeOpen(false)
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    )

    return (
      <div
        className="favorite-ledger-panel__deepseek-archive-scope"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDeepSeekArchiveScopeOpen(false)
          }
        }}
      >
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={deepSeekArchiveScopeOpen}
          aria-label="整理范围"
          title={`当前选择：${selectedScopeLabel}`}
          disabled={oldFavoritePlanReadOnly || deepSeekArchiveRunning || archiveBatchRunning}
            onClick={() => {
              const wasOpenForProcessing = deepSeekArchiveScopeOpen && deepSeekArchiveScopeMenu === 'processing'
              setDeepSeekArchiveScopeMenu('processing')
              setDeepSeekArchiveScopeOpen(!wasOpenForProcessing)
          }}
        >
          <span>整理范围</span>
          <span className="favorite-ledger-panel__deepseek-archive-scope-arrow" aria-hidden="true" />
        </button>
        {canChooseSegmentScope ? (
          <button
            type="button"
            aria-haspopup="menu"
            aria-label="分段范围"
            aria-expanded={deepSeekArchiveScopeOpen && deepSeekArchiveScopeMenu === 'segment'}
            title={`当前选择：${DEEPSEEK_ARCHIVE_SEGMENT_OPTIONS.find((option) => option.value === deepSeekSegmentScope)?.label ?? '当前分段'}`}
            disabled={oldFavoritePlanReadOnly || deepSeekArchiveRunning || archiveBatchRunning}
            onClick={() => {
              setDeepSeekArchiveScopeMenu('segment')
              setDeepSeekArchiveScopeOpen(true)
            }}
          >
            <span>分段范围</span>
            <span className="favorite-ledger-panel__deepseek-archive-scope-arrow" aria-hidden="true" />
          </button>
        ) : null}
        {deepSeekArchiveScopeOpen ? (
          renderMenu()
        ) : null}
      </div>
    )
  }

  function requestDeepSeekArchiveOrganization() {
    if (oldFavoritePlanReadOnly) return
    const tags = scanProgress?.tags ?? preview?.scanProgress?.tags
    if (tags && (
      !oldFavoriteTagEnrichmentFinished(tags) ||
      tags.pending > 0 ||
      (tags.status === 'complete' && tags.completed < tags.total)
    )) {
      setPendingTagDeepSeekConfirming(scanGenerationRef.current)
      return
    }
    void organizeOldFavoritesWithDeepSeek()
  }

  const basicScanProgress = scanProgress?.basic ?? preview?.scanProgress?.basic
  const activeSegmentFinalReconciled = activeOldFavoriteUserBatch?.snapshot?.segmentSnapshots?.[
    activeOldFavoriteUserBatch.segmentIndex - 1
  ]?.finalReconciled
  const oldFavoriteClassificationReady = Boolean(
    !basicScanRunning &&
    preview &&
    preview.batch?.hasMore !== true &&
    (appliedStreamingSegmentIndexesRef.current.size === 0 || activeSegmentFinalReconciled) &&
    (!scanProgress || (
      basicScanProgress?.status === 'complete' &&
      oldFavoriteTagEnrichmentFinished(scanProgress.tags)
    ))
  )
  const oldFavoriteScanFlowComplete = Boolean(
    oldFavoriteClassificationReady &&
    preview?.skippedSourceFolderTitles.length === 0 &&
    !preview.scanContext?.sourceFolders?.some((folder) => folder.scanFailed)
  )
  const oldFavoritePreviewReady = oldFavoriteClassificationReady || Boolean(
    basicScanRunning && preview && appliedStreamingSegmentIndexesRef.current.size > 0
  )
  const oldFavoriteBatchExecutionReadiness = useMemo(() => {
    const segmentModels = activeOldFavoriteUserBatch?.snapshot?.segmentExecution ??
      activeOldFavoriteUserBatch?.segmentAids.map((aids, index) => ({
        index,
        status: (appliedStreamingSegmentIndexesRef.current.size === 0 ||
          activeOldFavoriteUserBatch.snapshot?.segmentSnapshots?.[index]?.finalReconciled)
          ? 'ready' as const
          : 'pending' as const,
        executableCount: index === activeOldFavoriteUserBatch.segmentIndex - 1
          ? selectedOldFavoritePlanItems.length
          : aids.length,
        completedCount: 0
      })) ?? []
    const managedMembershipComplete = !(preview?.scanDiagnostics?.folderFailures ?? [])
      .some((failure) => failure.operation === 'target-membership')
    const ownedAids = new Set(activeOldFavoriteUserBatch?.segmentAids.flat() ?? [])
    const aidOwnershipComplete = !activeOldFavoriteUserBatch || selectedOldFavoritePlanItems.every(
      (item) => ownedAids.has(item.aid)
    )
    const reconciliationComplete = appliedStreamingSegmentIndexesRef.current.size === 0 || Boolean(
      activeOldFavoriteUserBatch?.segmentAids.every((aids, index) =>
        aids.length === 0 || activeOldFavoriteUserBatch.snapshot?.segmentSnapshots?.[index]?.finalReconciled
      )
    )
    return evaluateBatchExecutionReadiness({
      segments: segmentModels,
      currentSegmentIndex: (activeOldFavoriteUserBatch?.segmentIndex ?? 1) - 1,
      sourceScanComplete: oldFavoriteScanFlowComplete,
      managedMembershipComplete,
      aidOwnershipComplete,
      reconciliationComplete
    })
  }, [
    activeOldFavoriteUserBatch,
    oldFavoriteScanFlowComplete,
    preview?.scanDiagnostics?.folderFailures,
    selectedOldFavoritePlanItems
  ])
  const basicScanDetailLabel = useMemo(() => {
    if (basicScanProgress?.status !== 'running') return ''
    if (basicScanProgress.phase === 'listing') return '正在读取收藏夹列表'
    const folderTitle = basicScanProgress.folderTitle?.trim()
    const page = Number(basicScanProgress.page)
    const attempt = Number(basicScanProgress.attempt)
    if (!folderTitle || !Number.isInteger(page) || page < 1 || !Number.isInteger(attempt) || attempt < 1) {
      return ''
    }
    if (basicScanProgress.phase === 'requesting') {
      return `正在读取“${folderTitle}”第 ${page} 页（第 ${attempt}/3 次请求）`
    }
    if (basicScanProgress.phase === 'retrying') {
      return `“${folderTitle}”第 ${page} 页请求失败，准备第 ${Math.min(attempt + 1, 3)}/3 次请求`
    }
    return ''
  }, [basicScanProgress])
  const hasExactBasicScanProgress = Boolean(
    basicScanProgress &&
    Number.isInteger(basicScanProgress.completed) &&
    Number.isInteger(basicScanProgress.total) &&
    basicScanProgress.completed >= 0 &&
    basicScanProgress.total > 0 &&
    basicScanProgress.completed <= basicScanProgress.total &&
    !(basicScanRunning && basicScanProgress.completed === 0 && basicScanProgress.total === 1) &&
    (basicScanProgress.status === 'complete' || basicScanProgress.completed < basicScanProgress.total)
  )
  const oldFavoriteBatchSwitcher = oldFavoriteGuideMode === 'organize' &&
    !basicScanRunning &&
    !oldFavoriteRecoveryRunning &&
    (preview || oldFavoriteUserBatches.length > 0) ? (
      <div className="favorite-ledger-panel__batch-switcher">
        <select
          className="favorite-ledger-panel__batch-select"
          aria-label="当前整理批次"
          title={oldFavoriteUserBatches.find((batch) => batch.id === activeOldFavoriteUserBatch?.id)
            ? `${activeOldFavoriteUserBatch?.kind === 'incremental' ? '新增批次' : '当前批次'} · ${new Date(activeOldFavoriteUserBatch!.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}${activeOldFavoriteUserBatch!.segmentCount > 1 ? ` · 第${activeOldFavoriteUserBatch!.segmentIndex}/${activeOldFavoriteUserBatch!.segmentCount}段` : ''}${activeOldFavoriteUserBatch!.status === 'ended' ? ' · 已结束' : ''}`
            : '当前批次'}
          value={activeOldFavoriteUserBatch?.id ?? ''}
          onChange={(event) => {
            void selectOldFavoriteUserBatch(event.target.value).then((result) => {
              if (result.kind === 'rescan-required') void startOrganizingOldFavorites(true)
            })
          }}
        >
          {activeOldFavoriteUserBatch ? null : <option value="">当前批次</option>}
          {oldFavoriteUserBatches.map((batch) => {
            const dateLabel = new Date(batch.createdAt).toLocaleString('zh-CN', {
              month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
            })
            const segmentLabel = batch.segmentCount > 1
              ? ` · 第${batch.segmentIndex}/${batch.segmentCount}段`
              : ''
            const executionPhase = batch.snapshot?.executionPhase
            const statusLabel = batch.status === 'ended'
              ? '已结束'
              : executionPhase === 'paused' || executionPhase === 'risk-stopped' || executionPhase === 'awaiting-acknowledgement'
                ? '已暂停'
                : '进行中'
            const fullLabel = `${batch.kind === 'incremental' ? '新增批次' : '扫描批次'} · ${dateLabel}${segmentLabel} · ${statusLabel}`
            const shortLabel = new Date(batch.createdAt).toLocaleString('zh-CN', {
              month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
            }).replace(/^(\d{2})\/(\d{2})\s/, '$1/$2 ')
            return <option key={batch.id} value={batch.id} title={fullLabel}>{shortLabel} · {statusLabel}</option>
          })}
        </select>
        {activeOldFavoriteUserBatch && activeOldFavoriteUserBatch.segmentCount > 1 ? (
          <select
            className="favorite-ledger-panel__segment-select"
            aria-label="当前整理分段"
            value={activeOldFavoriteUserBatch.segmentIndex}
            disabled={oldFavoriteOrganizationLocked()}
            onChange={(event) => {
              const segmentIndex = Number(event.target.value)
              const leavingSnapshot = currentSegmentSnapshot()
              const targetSnapshot = activeOldFavoriteUserBatch.snapshot?.segmentSnapshots?.[segmentIndex - 1]
              setOldFavoriteUserBatches((current) => current.map((batch) =>
                batch.id === activeOldFavoriteUserBatch.id ? {
                  ...batch,
                  segmentIndex,
                  snapshot: batch.snapshot && leavingSnapshot ? {
                    ...batch.snapshot,
                    segmentSnapshots: {
                      ...batch.snapshot.segmentSnapshots,
                      [activeOldFavoriteUserBatch.segmentIndex - 1]: leavingSnapshot
                    }
                  } : batch.snapshot
                } : batch
              ))
              if (targetSnapshot) restoreSegmentSnapshot(targetSnapshot)
            }}
          >
            {activeOldFavoriteUserBatch.segmentAids.map((_, index) => (
              <option key={index} value={index + 1}>第{index + 1}/{activeOldFavoriteUserBatch.segmentCount}段</option>
            ))}
          </select>
        ) : null}
      </div>
    ) : null

  const scanOverviewPreview = preview ?? {
    items: [],
    skippedSourceFolderTitles: [],
    scanProgress: scanProgress ?? {
      basic: { completed: 0, total: 0, status: 'running' as const, phase: 'listing' as const },
      tags: { completed: 0, total: 0, pending: 0, cacheHits: 0, succeeded: 0, failed: 0, status: 'idle' as const }
    }
  }
  const controlledSelectedSourceIds = new Set(
    controlledScanSnapshot?.sourceFolders.filter((folder) => folder.selected && !folder.isBilimiWorkFolder).map((folder) => folder.id) ?? []
  )
  const controlledPreviewItems = controlledScanSnapshot?.status === 'previewing'
    ? (controlledScanSnapshot.currentSegment?.items ?? []).filter((item) =>
        item.sourceFolderIds.some((folderId) => controlledSelectedSourceIds.has(folderId))
      )
    : []
  const controlledBilibiliFreezeReady = controlledPreviewItems.length > 0 &&
    controlledPreviewItems.every((item) => (controlledScanSnapshot?.classifications[String(item.aid)]?.targetLedgerIds.length ?? 0) > 0)
  const renderControlledPreviewItem = (item: typeof controlledPreviewItems[number]) => {
    const title = item.title?.trim() || `视频 ${item.aid}`
    const targetLedgerId = controlledScanSnapshot?.classifications[String(item.aid)]?.targetLedgerIds[0] ?? ''
    return (
      <article>
        <strong>{title}</strong> · {item.author?.trim() || '未知 UP'}
        <label>
          <span>归类</span>
          <select
            aria-label={`归类 ${title}`}
            value={targetLedgerId}
            onChange={(event) => void oldFavoriteWorkspace.applyManualClassifications([{
              aid: item.aid,
              targetLedgerIds: event.currentTarget.value ? [event.currentTarget.value] : []
            }])}
          >
            <option value="">未分类</option>
            {ledgers.map((ledger) => <option key={ledger.id} value={ledger.id}>{ledger.displayName}</option>)}
          </select>
        </label>
      </article>
    )
  }

  return (
    <section
      role="dialog"
      aria-label="掌库"
      className="favorite-ledger-panel"
      onClick={handlePanelClick}
    >
      <div className="favorite-ledger-panel__topbar">
        <div className="favorite-ledger-panel__header">
          <h2 className="sr-only">掌库</h2>
        </div>

        <div className="favorite-ledger-panel__toolbar">
          <AssistantActionButton
            type="button"
            aria-label="备册"
            disabled={busy || oldFavoritePlanReadOnly}
            onClick={() => void backUpLedgersFromToolbar()}
            icon={clickedPetUrl}
            iconAlt="小咪备册"
            badge="备"
            label="备册"
            description="一键生成 bilimi 收藏夹，用于归类收藏和整理"
          />
          <AssistantActionButton
            type="button"
            aria-label="整理旧藏"
            disabled={busy || oldFavoriteRecoveryRunning || oldFavoritePlanReadOnly}
            onClick={() => void requestOldFavoriteOrganization()}
            icon={hintPetUrl}
            iconAlt="小咪整理旧藏"
            badge="整"
            label="整理旧藏"
            description="扫描旧藏，确认后整理到 bilimi 收藏夹里"
          />
        </div>
      </div>

      {oldFavoriteEntryOpen ? (
        <OldFavoriteModal
          title="整理旧藏"
          onCancel={() => setOldFavoriteEntryOpen(false)}
          extraActions={(
            <>
              <button type="button" onClick={continueLastOldFavoriteOrganization}>继续上次整理</button>
              <button type="button" onClick={() => setOldFavoriteResetConfirmOpen(true)}>全部重新整理</button>
            </>
          )}
        >
            <p>检测到当前账号有未结束的整理存档，请选择接下来的操作。</p>
        </OldFavoriteModal>
      ) : null}
      {oldFavoriteResetConfirmOpen ? (
        <OldFavoriteModal
          title="确认全部重新整理？"
          danger
          confirmLabel="确认重置"
          confirmDisabled={oldFavoriteResetRunning}
          onCancel={() => { if (!oldFavoriteResetRunning) setOldFavoriteResetConfirmOpen(false) }}
          onConfirm={() => void resetAllOldFavoriteOrganization()}
        >
          <p>这会清空当前账号全部旧藏本地整理记录（包括历史记录），且无法恢复，再从头扫描；不会修改 B 站收藏夹。</p>
        </OldFavoriteModal>
      ) : null}
      {oldFavoriteRecoveryResetConfirmOpen ? (
        <OldFavoriteModal
          title="清除旧结果并重新扫描？"
          danger
          confirmLabel="确认清除并重新扫描"
          confirmDisabled={oldFavoriteResetRunning}
          onCancel={() => { if (!oldFavoriteResetRunning) setOldFavoriteRecoveryResetConfirmOpen(false) }}
          onConfirm={() => void resetAllOldFavoriteOrganization()}
        >
          <p>这会清除当前账号全部旧藏扫描结果并从头扫描；不会修改 B 站收藏夹规则或其他账号数据。</p>
        </OldFavoriteModal>
      ) : null}
      {ledgerResetConfirmOpen ? (
        <OldFavoriteModal
          title="重置收藏夹规则？"
          onCancel={() => setLedgerResetConfirmOpen(false)}
          confirmLabel="确认重置"
          onConfirm={() => {
            setLedgerResetConfirmOpen(false)
            applyDefaultLedgerRules()
          }}
        >
          <p>仅恢复默认收藏夹名称和分类规则，不会清除旧藏扫描结果，也不会重新扫描。</p>
        </OldFavoriteModal>
      ) : null}

      {missingLedgerIds.length > 0 ? (
        <p className="favorite-ledger-panel__notice">
          尚缺 {missingLedgerIds.map((id) => ledgerNamesById[id] ?? id).join('、')}。
        </p>
      ) : null}

      {status || saveStatus ? (
        <div className="favorite-ledger-panel__status" role="status">
          <span>{status ?? saveStatus}</span>
          {oldFavoriteRecoveryFailure && !oldFavoriteRecoveryRunning ? (
            <button
              type="button"
              aria-label="清除旧结果并重新扫描"
              onClick={() => setOldFavoriteRecoveryResetConfirmOpen(true)}
            >
              清除旧结果并重新扫描
            </button>
          ) : null}
          {basicScanRunning ? (
            <button type="button" aria-label="取消旧藏扫描" onClick={cancelOldFavoriteScan}>取消</button>
          ) : null}
        </div>
      ) : null}

      <div className="favorite-ledger-panel__workspace">
        <section className="favorite-ledger-panel__checklist" aria-label="收藏夹">
        <div className="favorite-ledger-panel__category-header">
          <span className="favorite-ledger-panel__section-title">
            <h3 title={LEDGER_SYNC_HINT}>收藏夹</h3>
            <button
              type="button"
              className="favorite-ledger-panel__help-toggle"
              aria-label={`${ledgerHintExpanded ? '收起' : '展开'}收藏夹说明`}
              aria-expanded={ledgerHintExpanded}
              title={LEDGER_SYNC_HINT}
              onClick={() => setLedgerHintExpanded((expanded) => !expanded)}
            >
              <span className="favorite-ledger-panel__help-arrows" aria-hidden="true">
                <span className="favorite-ledger-panel__help-arrow favorite-ledger-panel__help-arrow--up" />
                <span className="favorite-ledger-panel__help-arrow favorite-ledger-panel__help-arrow--down" />
              </span>
            </button>
          </span>
          <div className="favorite-ledger-panel__category-actions">
            <button type="button" disabled={busy || oldFavoritePlanReadOnly || deepSeekArchiveRunning} onClick={resetLedgers}>
              重置
            </button>
            <button type="button" disabled={busy || oldFavoritePlanReadOnly || deepSeekArchiveRunning} onClick={toggleAllLedgers}>
              {bulkToggleLabel}
            </button>
            <button
              type="button"
              disabled={busy || oldFavoritePlanReadOnly || deepSeekArchiveRunning || firstInvalidLedgerIndex >= 0}
              onClick={() => void saveLedgers()}
            >
              同步
            </button>
          </div>
        </div>
        {ledgerHintExpanded ? (
          <div className="favorite-ledger-panel__sync-hint">
            <p>{LEDGER_SYNC_HINT}</p>
            <p>
              关键词、UP 名字和标签用于本地识别；DeepSeek 约束只在开启 DeepSeek 后作为辅助判断参考，可以输入一段自然语言。
            </p>
          </div>
        ) : null}
        <div className="favorite-ledger-panel__chips">
          {ledgersToDisplay.map((ledger, ledgerIndex) => {
            const draftKey = ledgerDraftKey(ledger, ledgerIndex, draftLedgers)
            const isLedgerEnabled = ledgerEnabled(ledger)
            const ledgerLabel = stripBilimiLedgerPrefix(ledger.displayName)
            const ledgerDirty = ledgerHasUnsavedChanges(ledger, ledgerIndex)
            const ledgerButtonLabel = `${ledgerDirty ? '（未保存）' : ''}${ledgerLabel}`
            const selectLedgerLabel = ledgerLabel || '新建收藏夹'
            return (
              <div
                key={`${ledger.id}-${ledgerIndex}`}
                className="favorite-ledger-panel__chip-item"
                draggable={!oldFavoritePlanReadOnly}
                data-dragging={draggedLedgerKey === draftKey}
                data-drop-target={dragTargetLedgerKey === draftKey}
                onDragStart={(event) => handleLedgerDragStart(event, ledgerIndex)}
                onDragOver={(event) => handleLedgerDragOver(event, ledgerIndex)}
                onDrop={(event) => handleLedgerDrop(event, ledgerIndex)}
                onDragEnd={finishLedgerDrag}
              >
                <button
                  type="button"
                  aria-label={ledgerButtonLabel || `选择${selectLedgerLabel}`}
                  title={ledger.displayName}
                  aria-pressed={isLedgerEnabled}
                  data-active={activeLedger?.id === ledger.id && activeLedgerIndex === ledgerIndex}
                  disabled={oldFavoritePlanReadOnly}
                  onClick={() => selectLedger(ledger, ledgerIndex)}
                >
                  {ledgerButtonLabel}
                </button>
                <button
                  type="button"
                  className="favorite-ledger-panel__chip-action"
                  aria-label={`${isLedgerEnabled ? '移出同步' : '加入同步'} ${ledger.displayName}`}
                  data-enabled={isLedgerEnabled}
                  disabled={oldFavoritePlanReadOnly}
                  onClick={() => toggleLedger(ledgerIndex)}
                >
                  {isLedgerEnabled ? '✓' : '+'}
                </button>
              </div>
            )
          })}
        </div>
        <div className="favorite-ledger-panel__list-toggle">
          <button type="button" disabled={busy || oldFavoritePlanReadOnly} onClick={addBlankLedger}>
            新建收藏夹
          </button>
          {canToggleLedgerList ? (
            <button
              type="button"
              aria-expanded={ledgerListExpanded}
              disabled={busy || oldFavoritePlanReadOnly}
              onClick={() => setLedgerListExpanded((current) => !current)}
            >
              {ledgerListExpanded ? '折叠' : '展开'}
            </button>
          ) : null}
        </div>
        </section>

      {activeLedger ? (
        <section className="favorite-ledger-panel__editor" aria-label="当前收藏夹">
          <div className="favorite-ledger-panel__editor-title">
            <strong>
              {activeLedgerHasUnsavedChanges ? '（未保存）' : ''}正在编辑：{activeLedger.displayName}
            </strong>
            <div className="favorite-ledger-panel__editor-actions">
              <button
                type="button"
                disabled={busy || oldFavoritePlanReadOnly || !activeLedgerNameValidation?.valid}
                onClick={saveActiveLedgerDraft}
              >
                保存
              </button>
              {!activeLedger.isDefault ? (
                <button
                  type="button"
                  aria-label={`删除 ${activeLedger.displayName}`}
                  onClick={() => deleteLedger(activeLedger.id)}
                  disabled={oldFavoritePlanReadOnly || !canDeleteLedger(activeLedger)}
                >
                  删除
                </button>
              ) : null}
            </div>
          </div>
        <label>
          <span className="favorite-ledger-panel__name-label">
            <span className="favorite-ledger-panel__name-label-copy">
              <span>册名</span>
              {activeLedgerNameValidation ? (
                <small data-invalid={!activeLedgerNameValidation.valid}>
                  {activeLedgerNameValidation.length}/{BILIBILI_FAVORITE_LEDGER_NAME_MAX_LENGTH}
                </small>
              ) : null}
            </span>
            <select
              aria-label="收藏夹种类"
              disabled={oldFavoritePlanReadOnly || activeLedger.isDefault}
              value={activeLedgerRuleType}
              onChange={(event) => {
                if (activeLedger.isDefault) {
                  return
                }

                updateActiveLedger({ ruleType: event.currentTarget.value as FavoriteLedgerRuleType })
              }}
            >
              {LEDGER_RULE_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </span>
          {isBilimiLedger(activeLedger) ? (
            <span className="favorite-ledger-panel__prefixed-input">
              <span className="favorite-ledger-panel__fixed-prefix" aria-hidden="true">
                {BILIMI_LEDGER_PREFIX}
              </span>
              <input
                aria-label="册名"
                disabled={oldFavoritePlanReadOnly}
                value={stripBilimiLedgerPrefix(activeLedger.displayName)}
                onChange={(event) => updateActiveLedgerName(event.currentTarget.value)}
              />
            </span>
          ) : (
            <input
              aria-label="册名"
              disabled={oldFavoritePlanReadOnly}
              value={activeLedger.displayName}
              onChange={(event) => updateActiveLedgerName(event.currentTarget.value)}
            />
          )}
          {activeLedgerNameValidation && !activeLedgerNameValidation.valid ? (
            <div className="favorite-ledger-panel__name-validation">
              <small role="alert">
                B站收藏夹名称最多20个字，当前{activeLedgerNameValidation.length}个字
              </small>
            </div>
          ) : null}
        </label>
          <label>
            {ruleFieldLabel(activeLedgerRuleType)}
            <textarea
              disabled={oldFavoritePlanReadOnly}
              value={ledgerRuleText(activeLedger)}
              onChange={(event) =>
                updateActiveLedger({
                  keywords: composeLedgerKeywords(
                    event.currentTarget.value,
                    activeLedgerDeepSeekConstraint,
                    activeLedgerRuleType
                  )
                })
              }
            />
          </label>
          {activeLedgerRuleType !== 'deepseek' ? (
            <label className="favorite-ledger-panel__deepseek-constraint-line">
              <span>DeepSeek约束：</span>
              <input
                aria-label="DeepSeek约束"
                type="text"
                disabled={oldFavoritePlanReadOnly}
                value={activeLedgerDeepSeekConstraint}
                onChange={(event) =>
                  updateActiveLedger({
                    keywords: composeLedgerKeywords(
                      ledgerRuleText(activeLedger),
                      event.currentTarget.value,
                      activeLedgerRuleType
                    )
                  })
                }
              />
            </label>
          ) : null}
          <p className="favorite-ledger-panel__keyword-hint">
            {rulePrimaryHint(activeLedgerRuleType)}
          </p>
          <p className="favorite-ledger-panel__keyword-hint">
            {ruleSecondaryHint(activeLedgerRuleType)}
          </p>
          <div className="favorite-ledger-panel__keyword-actions">
          </div>
        </section>
      ) : (
        <p className="favorite-ledger-panel__editor-empty">选择左侧收藏夹后可查看和编辑规则。</p>
      )}

      </div>

      {oldFavoriteBatchSwitcher && !preview ? (
        <section className="favorite-ledger-panel__old-favorite-recovery" aria-label="整理批次">
          {oldFavoriteBatchSwitcher}
          {oldFavoriteRecoveryRunning ? <p role="status">正在恢复整理结果…</p> : null}
        </section>
      ) : null}

      {(preview || basicScanRunning || controlledScanSnapshot) ? (
        <section
          className="favorite-ledger-panel__old-favorites-guide"
          aria-label={oldFavoriteGuideMode === 'setup' ? '备册向导' : '整理旧藏向导'}
        >
          <div className="favorite-ledger-panel__guide-header">
            <div className="favorite-ledger-panel__guide-title-row">
              <span className="favorite-ledger-panel__section-title">
                <h3 title={OLD_FAVORITE_GUIDE_HINT}>
                  {activeOldFavoriteBatchReadOnly ? '整理结果' : oldFavoriteGuideMode === 'setup' ? '备册' : '整理旧藏'}
                </h3>
                <button
                  type="button"
                  className="favorite-ledger-panel__help-toggle"
                  aria-label={`${oldFavoriteGuideHintExpanded ? '收起' : '展开'}整理旧藏说明`}
                  aria-expanded={oldFavoriteGuideHintExpanded}
                  title={OLD_FAVORITE_GUIDE_HINT}
                  onClick={() => setOldFavoriteGuideHintExpanded((expanded) => !expanded)}
                >
                  <span className="favorite-ledger-panel__help-arrows" aria-hidden="true">
                    <span className="favorite-ledger-panel__help-arrow favorite-ledger-panel__help-arrow--up" />
                    <span className="favorite-ledger-panel__help-arrow favorite-ledger-panel__help-arrow--down" />
                  </span>
                </button>
              </span>
            </div>
            {oldFavoriteBatchSwitcher}
            {oldFavoriteGuideHintExpanded ? (
              <p className="favorite-ledger-panel__guide-hint">{OLD_FAVORITE_GUIDE_HINT}</p>
            ) : null}
            {!activeOldFavoriteBatchReadOnly ? <nav className="favorite-ledger-panel__guide-steps" aria-label="整理旧藏步骤">
              {OLD_FAVORITE_GUIDE_STEPS.map((step) => (
                <button
                  key={step.id}
                  type="button"
                  aria-current={oldFavoriteStep === step.id ? 'step' : undefined}
                  aria-expanded={oldFavoriteExpandedStep === step.id}
                  disabled={(deepSeekArchiveRunning && oldFavoriteStep !== step.id) ||
                    (useControlledOldFavoriteWorkspace && step.id !== 'scan' && step.id !== 'preview')}
                  onClick={() => {
                    if (useControlledOldFavoriteWorkspace) {
                      setOldFavoriteStep(step.id)
                      setOldFavoriteExpandedStep(step.id)
                      return
                    }
                    switchOldFavoriteStep(step.id)
                  }}
                >
                  {step.label}
                </button>
              ))}
            </nav> : null}
          </div>

          {archiveBatchOperationProgress ? (
            <div
              className="favorite-ledger-panel__archive-batch-progress"
              role="status"
              aria-label="批量移动进度"
            >
              {archiveBatchOperationProgress.phase === 'running' ? (
                <>
                  <span className="favorite-ledger-panel__spinner" aria-hidden="true" />
                  <span>
                    正在移动 {archiveBatchOperationProgress.total} 条
                    {archiveBatchOperationProgress.completed > 0
                      ? `（${archiveBatchOperationProgress.completed}/${archiveBatchOperationProgress.total}）`
                      : ''}
                  </span>
                </>
              ) : (
                <span>已移动 {archiveBatchOperationProgress.total} 条</span>
              )}
            </div>
          ) : null}

          {oldFavoriteExpandedStep === 'scan' ? (
            <section className="favorite-ledger-panel__scan-overview" aria-label="扫描概览">
              <h4 className="favorite-ledger-panel__step-title">扫描概览</h4>
              {controlledScanSnapshot ? (
                <>
                  <p className="favorite-ledger-panel__scan-guidance">
                    {controlledScanSnapshot.status === 'scanning' ? '扫描概览：扫描中' : '扫描概览已完成，正在准备归档预览。'}
                  </p>
                  <div className="favorite-ledger-panel__scan-progress" aria-label="旧藏扫描进度">
                    <div>
                      <span>收藏夹概览</span>
                      <progress aria-label="收藏夹概览进度" max={1} value={controlledScanSnapshot.status === 'scanning' ? 0 : 1} />
                      <strong>{controlledScanSnapshot.status === 'scanning' ? '正在扫描' : '已完成'}</strong>
                    </div>
                  </div>
                  <p className="favorite-ledger-panel__step-note">
                    已发现 {controlledScanSnapshot.sourceFolders.length} 个收藏夹，当前扫描 {controlledScanSnapshot.continuationCount} 条待续新增。
                  </p>
                  <ul className="favorite-ledger-panel__scan-folder-list" aria-label="扫描收藏夹列表">
                    {controlledScanSnapshot.sourceFolders.map((folder) => (
                      <li key={folder.id}>
                        <label>
                          <input
                            type="checkbox"
                            aria-label={`选择来源 ${folder.title}`}
                            checked={Boolean(folder.selected)}
                            disabled={folder.isBilimiWorkFolder}
                            onChange={(event) => {
                              const next = new Set(controlledSelectedSourceIds)
                              if (event.currentTarget.checked) next.add(folder.id)
                              else next.delete(folder.id)
                              void oldFavoriteWorkspace.selectSourceFolders([...next])
                            }}
                          />
                          {folder.title} · {folder.itemCount} 条{folder.isBilimiWorkFolder ? ' · Bilimi 工作夹' : ''}
                        </label>
                      </li>
                    ))}
                  </ul>
                  {controlledScanSnapshot.status === 'previewing' ? (
                    <section className="favorite-ledger-panel__insights" aria-label="归档预览">
                      <h4>归档预览</h4>
                      <p className="favorite-ledger-panel__step-note">当前分段 {controlledPreviewItems.length} 条；只加载这一段。</p>
                      <button type="button" onClick={() => {
                        setOldFavoriteStep('preview')
                        setOldFavoriteExpandedStep('preview')
                      }}>查看归档预览</button>
                    </section>
                  ) : null}
                </>
              ) : (
                <>
              <p className="favorite-ledger-panel__scan-guidance">
                请耐心等待扫描完成；完成后按上方步骤从左到右，依次完成本轮整理。
              </p>
              <div className="favorite-ledger-panel__scan-progress" aria-label="旧藏扫描进度">
                <div>
                  <span>视频基本信息</span>
                  <progress
                    aria-label="视频基本信息进度"
                    max={hasExactBasicScanProgress ? basicScanProgress!.total : 1}
                    value={hasExactBasicScanProgress ? basicScanProgress!.completed : (basicScanRunning ? 0 : 1)}
                  />
                  <strong>
                    {!hasExactBasicScanProgress && basicScanRunning
                      ? Number.isInteger(basicScanProgress?.completed) && (basicScanProgress?.completed ?? 0) > 0
                        ? `已读取 ${basicScanProgress!.completed}`
                        : '正在读取'
                    : hasExactBasicScanProgress
                        ? `${basicScanProgress!.completed} / ${basicScanProgress!.total}`
                        : basicScanRunning
                          ? '正在读取'
                          : `${scanOverviewPreview.items.length} / ${scanOverviewPreview.items.length}`}
                  </strong>
                  {basicScanDetailLabel ? <small>{basicScanDetailLabel}</small> : null}
                </div>
                <div>
                  <span>标签补取</span>
                  <progress
                    aria-label="标签补取进度"
                    max={Math.max(scanProgress?.tags.total ?? 1, 1)}
                    value={scanProgress?.tags.completed ?? 0}
                  />
                  <strong>
                    {(scanProgress?.tags.completed ?? null) !== null && (scanProgress?.tags.total ?? 0) > 0
                      ? `${scanProgress?.tags.completed ?? 0} / ${scanProgress?.tags.total ?? 0}`
                      : '正在统计缺失标签'}
                  </strong>
                </div>
              </div>
              {preview?.scanDiagnostics?.folderFailures?.some((failure) => failure.operation === 'target-membership') ? (
                <div className="favorite-ledger-panel__scan-warning">
                  <p>恢复结果已显示；执行前需要重新核对收藏夹成员。</p>
                  <button
                    type="button"
                    disabled={busy || oldFavoritePlanReadOnly}
                    onClick={() => void rescanRestoredOldFavoriteBatch()}
                  >
                    重新扫描全部
                  </button>
                </div>
              ) : null}
              {(scanProgress?.tags.pending ?? 0) > 0 && ['running', 'paused'].includes(scanProgress?.tags.status ?? '') && !basicScanRunning ? (
                <div className="favorite-ledger-panel__scan-enrichment-status">
                  <p className="favorite-ledger-panel__scan-warning">
                    视频信息已扫描完成，可以查看和调整整理结果。标签仍在后台补取，建议等待扫描结束后再执行。
                  </p>
                  {scanProgress?.tags.status === 'paused' && (scanProgress.tags.errorMessage || scanProgress.tags.errorCode || scanProgress.tags.errorKind) ? (
                    <p role="alert" className="favorite-ledger-panel__scan-warning">
                      {scanProgress.tags.errorKind === 'login' ? '登录状态可能已失效，请重新登录后再继续。' : '标签补取已因风控暂停，请等待冷却后再继续。'}
                      {scanProgress.tags.errorMessage ? ` ${scanProgress.tags.errorMessage}` : ''}
                      {scanProgress.tags.errorCode !== undefined ? `（错误码 ${scanProgress.tags.errorCode}）` : ''}
                    </p>
                  ) : null}
                  {onReadOldFavoriteTagEnrichment ? (
                    <div>
                      {scanProgress?.tags.status === 'paused' ? (
                        <button type="button" disabled={oldFavoritePlanReadOnly || tagActionRunning !== null} onClick={() => applyTagEnrichmentAction('resume')}>
                          {tagActionRunning === 'resume' ? '正在继续补取' : '继续补取'}
                        </button>
                      ) : (
                        <button type="button" disabled={oldFavoritePlanReadOnly || tagActionRunning !== null} onClick={() => applyTagEnrichmentAction('pause')}>暂停补取</button>
                      )}
                      <button type="button" disabled={oldFavoritePlanReadOnly || tagActionRunning !== null} onClick={() => setTagEndConfirmOpen(true)}>
                        结束补取，使用当前结果
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {oldFavoriteTagEnrichmentFinished(scanProgress?.tags) && scanProgress?.tags.terminalReason === 'cancelled' ? (
                <p role="status" className="favorite-ledger-panel__scan-warning">
                  标签补取已结束，已使用当前取得的 {scanProgress.tags.completed} 条结果
                </p>
              ) : null}
                </>
              )}
              {preview?.insights ? (
                <>
                  <p className="favorite-ledger-panel__step-note">
                    {preview.scanContext
                      ? `共扫描 ${totalScannedOldFavoriteCount} 条，其中 ${preview.items.length} 条待整理`
                      : `共扫描 ${preview.insights.totalVideos} 条，其中 ${preview.items.length} 条待整理`}
                  </p>
                  {tagDetailFailureCount > 0 ? (
                    <p className="favorite-ledger-panel__scan-warning">
                      标签补取失败 {tagDetailFailureCount} 条，高频标签候选可能偏少；稍后重扫会更准。
                    </p>
                  ) : null}
                  {globalCircuitTrigger ? (
                    <div
                      className="favorite-ledger-panel__scan-warning favorite-ledger-panel__scan-risk-summary"
                      role="alert"
                      aria-label="访问受限，扫描已安全停止"
                    >
                      <strong>访问受限，扫描已安全停止</strong>
                      <p>
                        在第 {globalCircuitTrigger.failedPage} 页触发；后续安全跳过 {globalCircuitFailures.length} 个收藏夹，
                        均未发送请求；已读取 {globalCircuitRetainedCount} 条。建议等待 30 分钟后重试；若仍受限，请等待 2 小时。
                      </p>
                      <details>
                        <summary>查看详细信息</summary>
                        <ul>
                          <li>
                            {globalCircuitTrigger.folderTitle}：第 {globalCircuitTrigger.failedPage} 页，
                            {oldFavoriteScanFailureCodeDetail(globalCircuitTrigger)}，已读取 {globalCircuitTrigger.retainedVideoCount} 条
                          </li>
                          {globalCircuitFailures.map((failure) => (
                            <li key={`${failure.folderId ?? failure.folderTitle}:circuit`}>
                              {failure.folderTitle}：因全局访问限制安全跳过，未发送请求
                            </li>
                          ))}
                        </ul>
                      </details>
                    </div>
                  ) : null}
                  {visibleOrdinaryFolderFailures.length > 0 ? (
                    <ul className="favorite-ledger-panel__scan-warning" aria-label="普通扫描失败">
                      {visibleOrdinaryFolderFailures.map((failure) => (
                        <li key={`${failure.folderId ?? failure.folderTitle}:${failure.failedPage}`}>
                          {failure.folderTitle}：{failure.status === 'partial' ? '部分扫描' : '扫描失败'}，
                          第 {failure.failedPage} 页{readableOldFavoriteScanFailure(failure)}，尝试 {failure.attempts} 次
                          ，已读取 {failure.retainedVideoCount} 条
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {foldedOrdinaryFolderFailures.length > 0 ? (
                    <details className="favorite-ledger-panel__scan-failure-details">
                      <summary>查看其余 {foldedOrdinaryFolderFailures.length} 条普通失败</summary>
                      <ul aria-label="其余普通扫描失败">
                        {foldedOrdinaryFolderFailures.map((failure) => (
                          <li key={`${failure.folderId ?? failure.folderTitle}:${failure.failedPage}:folded`}>
                            {failure.folderTitle}：第 {failure.failedPage} 页{readableOldFavoriteScanFailure(failure)}，
                            尝试 {failure.attempts} 次，已读取 {failure.retainedVideoCount} 条
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  <hr className="favorite-ledger-panel__step-divider" aria-hidden="true" />
                </>
              ) : null}
              {preview ? <section className="favorite-ledger-panel__insights" aria-label="基础数据">
                <h4>基础数据</h4>
                {preview.scanContext && protectedOldFavoriteCount > 0 && reorganizedProtectedAids.size === 0 ? (
                  <div className="favorite-ledger-panel__protected-summary">
                    <small>想按当前规则重新判断以前整理过的视频？可将当前勾选来源中的全部已整理视频重新纳入计算。</small>
                    <button
                      type="button"
                      aria-label={`重新整理全部已整理视频 ${selectedProtectedOldFavorites.length} 条`}
                      disabled={oldFavoritePlanReadOnly || selectedProtectedOldFavorites.length === 0}
                      onClick={() => setProtectedReorganizationConfirming(true)}
                    >
                      重新整理全部已整理视频 {selectedProtectedOldFavorites.length} 条
                    </button>
                  </div>
                ) : null}
                <div className="favorite-ledger-panel__guide-metrics">
                  <article>
                    <span>共扫描</span>
                    <strong>{totalScannedOldFavoriteCount}</strong>
                  </article>
                  <article>
                    <span>可执行</span>
                    <strong>{autoSelectedOldFavoriteCount}</strong>
                  </article>
                  <article>
                    <span>待复核</span>
                    <strong>{reviewRequiredOldFavoriteCount}</strong>
                  </article>
                  <article>
                    <span>未匹配</span>
                    <strong>{previewScopedPendingItems.length}</strong>
                  </article>
                  <article>
                    <span>{preview.scanContext ? '已保护' : '已存在'}</span>
                    <strong>{preview.scanContext ? protectedOldFavoriteCount : alreadyInTargetOldFavoriteCount}</strong>
                  </article>
                  <article>
                    <span>跳过来源</span>
                    <strong>{skippedSourceFolderCount}</strong>
                  </article>
                </div>
                {preview.scanContext ? (
                  <p className="favorite-ledger-panel__source-note">
                    暂存标记为待整理，不计入保护；单个工作夹数量可能重叠，保护数量按 aid 去重。
                  </p>
                ) : null}
                {oldFavoriteGuideMode === 'organize' && autoSelectedOldFavoriteCount === 0 ? (
                  <p className="favorite-ledger-panel__scan-warning">当前没有可执行视频，请先复核或为未匹配视频选择正式工作夹。</p>
                ) : null}
                {preview.scanContext && (reorganizedProtectedAids.size > 0 || hasSelectedAbnormalProtectedOldFavorites) ? (
                  <div className="favorite-ledger-panel__protected-summary">
                    {reorganizedProtectedAids.size > 0 ? (
                      <>
                        <span>已重新纳入 {reorganizedProtectedAids.size}</span>
                        <button type="button" disabled={oldFavoritePlanReadOnly} onClick={restoreProtectedFavorites}>恢复保护</button>
                      </>
                    ) : (
                      <>
                        {hasSelectedAbnormalProtectedOldFavorites ? (
                          <>
                            <small>
                              发现 {selectedAbnormalProtectedOldFavorites.length} 条视频的原归档状态发生变化。为避免覆盖你的手动调整，本轮暂不处理。
                            </small>
                            <button
                              type="button"
                              aria-label={`重新整理状态有变化的 ${selectedAbnormalProtectedOldFavorites.length} 条`}
                              title={OLD_FAVORITE_ARCHIVE_HEALTH_HINT}
                              disabled={oldFavoritePlanReadOnly || selectedAbnormalProtectedOldFavorites.length === 0}
                              onClick={() => setAbnormalProtectionReorganizationConfirming(true)}
                            >
                              重新整理状态有变化的 {selectedAbnormalProtectedOldFavorites.length} 条
                            </button>
                          </>
                        ) : null}
                      </>
                    )}
                  </div>
                ) : null}
                {preview.scanContext && hasSelectedAbnormalProtectedOldFavorites ? (
                  <div className="favorite-ledger-panel__guide-metrics" aria-label="原归档状态">
                    <article><span>仍在原归档</span><strong>{protectedArchiveHealthCounts.complete}</strong></article>
                    <article><span>仅保留部分归档</span><strong>{protectedArchiveHealthCounts.incomplete}</strong></article>
                    <article><span>已不在原归档</span><strong>{protectedArchiveHealthCounts.invalid}</strong></article>
                  </div>
                ) : null}
              </section> : null}
              {preview?.insights ? (
                <>
                  <hr className="favorite-ledger-panel__step-divider" aria-hidden="true" />
                  <div className="favorite-ledger-panel__insight-columns">
                    <div>
                      <div className="favorite-ledger-panel__source-heading">
                        <strong>扫描收藏夹</strong>
                        {oldFavoriteGuideMode === 'organize' ? (
                          <label>
                            <input
                              ref={oldFavoriteSourceSelectAllRef}
                              type="checkbox"
                              aria-label="全选扫描收藏夹"
                              checked={allOldFavoriteUserSourcesSelected}
                              disabled={oldFavoritePlanReadOnly || validOldFavoriteUserSourceFolders.length === 0}
                              onChange={toggleAllOldFavoriteUserSources}
                            />
                            <span>全选</span>
                          </label>
                        ) : null}
                      </div>
                      {oldFavoriteUserSourceFolders.length > 0 ? (
                        <>
                          <p className="favorite-ledger-panel__source-note">
                            待整理数会排除已整理视频，并对多个收藏夹中的同一视频去重，因此数量可能较少。
                          </p>
                          {oldFavoriteUserSourceFolders.some((folder) => folder.scanFailed) ||
                          preview.scanDiagnostics?.folderFailures?.some((failure) => failure.operation === 'target-membership') ? (
                            <button
                              type="button"
                              className="favorite-ledger-panel__source-rescan"
                              disabled={busy || oldFavoritePlanReadOnly}
                              onClick={() => void (
                                preview.scanDiagnostics?.folderFailures?.some((failure) => failure.operation === 'target-membership')
                                  ? rescanRestoredOldFavoriteBatch()
                                  : scanOldFavorites('organize')
                              )}
                            >
                              重新扫描全部
                            </button>
                          ) : null}
                        </>
                      ) : null}
                      <OldFavoriteSourceTables
                        mode={oldFavoriteGuideMode}
                        userFolders={oldFavoriteUserSourceFolders}
                        bilimiFolders={oldFavoriteBilimiSourceFolders}
                        selectedUserKeys={normalizedSelectedOldFavoriteSourceFolderKeys}
                        selectedManagedIds={selectedManagedLogicalIds}
                        unlockedManagedIds={unlockedManagedLogicalIds}
                        readOnly={oldFavoritePlanReadOnly}
                        onToggleUserFolder={toggleOldFavoriteSourceFolder}
                        onToggleManagedFolder={toggleOldFavoriteManagedSourceFolder}
                      />
                    </div>
                  </div>
                </>
              ) : null}
            </section>
          ) : null}

          {oldFavoriteExpandedStep === 'generated' ? (
            <section className="favorite-ledger-panel__candidates" aria-label="专属收藏夹候选">
              <h4 className="favorite-ledger-panel__step-title">推荐收藏夹</h4>
              <p className="favorite-ledger-panel__step-note">确认执行后，会把已勾选候选同步到 B 站收藏夹里。</p>
              {!oldFavoritePreviewReady ? (
                <p role="status" className="favorite-ledger-panel__step-note">请等待扫描结束</p>
              ) : (
                <>
              <hr className="favorite-ledger-panel__step-divider" aria-hidden="true" />
              <div className="favorite-ledger-panel__candidate-section">
                <div className="favorite-ledger-panel__candidate-section-heading">
                  <h5>专属 UP 追更</h5>
                  <label>
                    <input
                      type="checkbox"
                      aria-label="全选 专属 UP 追更"
                      checked={allFollowUpCandidatesSelected}
                      disabled={oldFavoritePlanReadOnly || deepSeekArchiveRunning || archiveBatchRunning || !oldFavoriteFollowUpCandidates.length}
                      onChange={(event) =>
                        setCandidateGroupSelected(oldFavoriteFollowUpCandidates, event.currentTarget.checked)
                      }
                    />
                    <span>全选</span>
                  </label>
                </div>
                <div className="favorite-ledger-panel__candidate-list">
                {oldFavoriteFollowUpCandidates.length ? (
                  oldFavoriteFollowUpCandidates.map((candidate) => {
                  const key = candidateKey(candidate)
                  const isSelected = selectedCandidateKeys.has(key)
                  const candidateDisplayName = candidateDisplayNameForDraft(candidate)
                  const candidateLabel = favoriteLedgerDisplayShortName(candidateDisplayName)

                  return (
                    <article key={`${candidate.kind}-${candidate.sourceName}`} title={candidateLabel}>
                      <label>
                        <input
                          type="checkbox"
                          aria-label={candidateDisplayName}
                          checked={isSelected}
                          disabled={
                            oldFavoritePlanReadOnly || deepSeekArchiveRunning || archiveBatchRunning || (
                              !isSelected &&
                              alreadyHasLedger(draftLedgers, candidateDisplayName) &&
                              !draftLedgers.some((ledger) =>
                                ledger.id === candidateLedgerId(candidate) &&
                                !ledger.enabled &&
                                !ledger.bilibiliFolderId
                              )
                            )
                          }
                          onClick={() => setCandidateSelected(candidate, !isSelected)}
                          onChange={() => undefined}
                        />
                        <span>
                          <strong title={candidateLabel}>{candidateLabel}</strong>
                          <small>{oldFavoriteCandidateDetailText(candidate)}</small>
                        </span>
                      </label>
                    </article>
                  )
                  })
                ) : null}
                {oldFavoriteFollowUpCandidates.length ? null : (
                  <p>暂无专属 UP 追更候选。</p>
                )}
                </div>
              </div>
              <hr className="favorite-ledger-panel__step-divider" aria-hidden="true" />
              <div className="favorite-ledger-panel__candidate-section">
                <div className="favorite-ledger-panel__candidate-section-heading">
                  <h5>高频标签收藏夹</h5>
                  <label>
                    <input
                      type="checkbox"
                      aria-label="全选 高频标签收藏夹"
                      checked={allTagCandidatesSelected}
                      disabled={oldFavoritePlanReadOnly || deepSeekArchiveRunning || archiveBatchRunning || !oldFavoriteTagCandidates.length}
                      onChange={(event) =>
                        setCandidateGroupSelected(oldFavoriteTagCandidates, event.currentTarget.checked)
                      }
                    />
                    <span>全选</span>
                  </label>
                </div>
                <div className="favorite-ledger-panel__candidate-list">
                {visibleOldFavoriteTagCandidates.map((candidate) => {
                    const key = candidateKey(candidate)
                    const isSelected = selectedCandidateKeys.has(key)
                    const candidateDisplayName = candidateDisplayNameForDraft(candidate)
                    const candidateLabel = favoriteLedgerDisplayShortName(candidateDisplayName)

                    return (
                      <article key={`${candidate.kind}-${candidate.sourceName}`} title={candidateLabel}>
                        <label>
                          <input
                            type="checkbox"
                            aria-label={candidateDisplayName}
                            checked={isSelected}
                            disabled={
                              oldFavoritePlanReadOnly || deepSeekArchiveRunning || archiveBatchRunning ||
                              (!isSelected && alreadyHasLedger(draftLedgers, candidateDisplayName) &&
                                !draftLedgers.some((ledger) =>
                                  ledger.id === candidateLedgerId(candidate) &&
                                  !ledger.enabled &&
                                  !ledger.bilibiliFolderId
                                ))
                            }
                            onClick={() => setCandidateSelected(candidate, !isSelected)}
                            onChange={() => undefined}
                          />
                          <span>
                            <strong title={candidateLabel}>{candidateLabel}</strong>
                            <small>{oldFavoriteCandidateRecommendationText(candidate)}</small>
                          </span>
                        </label>
                      </article>
                    )
                  })}
                {oldFavoriteTagCandidates.length ? null : (
                  <p>暂无高频标签收藏夹候选，可直接查看归档预览。</p>
                )}
                {canExpandOldFavoriteTagCandidates ? (
                  <button type="button" onClick={() => setTagCandidatesExpanded(true)}>
                    展开更多高频标签
                  </button>
                ) : null}
                </div>
              </div>
                </>
              )}
            </section>
          ) : null}

          {oldFavoriteExpandedStep === 'preview' ? useControlledOldFavoriteWorkspace ? (
            <section className="favorite-ledger-panel__insights" aria-label="归档预览">
              <h4 className="favorite-ledger-panel__step-title">归档预览</h4>
              <p className="favorite-ledger-panel__step-note">当前分段 {controlledPreviewItems.length} 条；只加载并显示这一段。</p>
              {controlledScanSnapshot && controlledScanSnapshot.segments.length > 1 ? (
                <div className="favorite-ledger-panel__archive-history-actions" role="group" aria-label="分段选择">
                  {controlledScanSnapshot.segments.map((segment) => (
                    <button
                      key={segment.id}
                      type="button"
                      aria-pressed={controlledScanSnapshot.currentSegment?.id === segment.id}
                      disabled={controlledScanSnapshot.currentSegment?.id === segment.id}
                      onClick={() => void oldFavoriteWorkspace.selectSegment(segment.id)}
                    >第 {segment.index + 1} 组</button>
                  ))}
                </div>
              ) : null}
              <div className="favorite-ledger-panel__archive-history-actions" role="group" aria-label="归档预览改动操作">
                <button
                  type="button"
                  disabled={(controlledScanSnapshot?.history.cursor ?? 0) === 0}
                  onClick={() => void oldFavoriteWorkspace.undoClassification()}
                >撤销本次改动</button>
                <button
                  type="button"
                  disabled={(controlledScanSnapshot?.history.cursor ?? 0) >= (controlledScanSnapshot?.history.length ?? 0)}
                  onClick={() => void oldFavoriteWorkspace.redoClassification()}
                >恢复本次改动</button>
              </div>
              {controlledPreviewItems.length > OLD_FAVORITE_VIRTUAL_TRACK_THRESHOLD ? (
                <div role="list" aria-label="当前分段归档预览">
                  <VirtualOldFavoriteTrack
                    className="favorite-ledger-panel__preview-videos favorite-ledger-panel__preview-videos--virtual"
                    ariaLabel="当前分段归档预览滚动区"
                    items={controlledPreviewItems}
                    itemKey={(item) => item.aid}
                    itemWidth={OLD_FAVORITE_VIRTUAL_TRACK_ITEM_WIDTH}
                    renderItem={renderControlledPreviewItem}
                  />
                </div>
              ) : (
                <ul className="favorite-ledger-panel__preview-list" aria-label="当前分段归档预览">
                  {controlledPreviewItems.map((item) => (
                    <li key={item.aid}>{renderControlledPreviewItem(item)}</li>
                  ))}
                </ul>
              )}
            </section>
          ) : (
            <div className="favorite-ledger-panel__preview">
              {!oldFavoritePreviewReady ? (
                <>
                  <div className="favorite-ledger-panel__preview-topbar">
                    <div>
                      <h4 className="favorite-ledger-panel__step-title">归档预览</h4>
                      <p className="favorite-ledger-panel__step-note">查看本轮归档分类结果，并在确认前调整。</p>
                    </div>
                  </div>
                  <p role="status" className="favorite-ledger-panel__step-note">请等待扫描结束</p>
                </>
              ) : (
                <>
              <div className="favorite-ledger-panel__preview-topbar">
                <div>
                  <h4 className="favorite-ledger-panel__step-title">归档预览</h4>
                  <p className="favorite-ledger-panel__step-note">查看本轮归档分类结果，并在确认前调整。</p>
                </div>
              </div>
              {oldFavoriteGuideMode === 'organize' && !activeOldFavoriteBatchReadOnly ? (
                <>
                  <div className="favorite-ledger-panel__preview-tools">
                    <div
                      className="favorite-ledger-panel__archive-tool-card"
                      role="group"
                      aria-label="归档预览辅助工具"
                    >
                      <div
                        className="favorite-ledger-panel__deepseek-archive-section"
                        role="group"
                        aria-label="DeepSeek 辅助整理"
                      >
                        <div className="favorite-ledger-panel__deepseek-archive-heading">
                          <strong>DeepSeek 辅助整理</strong>
                          <div className="favorite-ledger-panel__deepseek-archive-actions">
                            {renderDeepSeekArchiveScopeMenu()}
                            <button
                              type="button"
                              className="favorite-ledger-panel__deepseek-archive-run-button"
                              data-action={deepSeekArchiveRunning ? 'cancel' : 'organize'}
                              disabled={
                                deepSeekArchiveRunning
                                  ? deepSeekArchiveCancelRequested
                                  : oldFavoritePlanReadOnly || deepSeekArchiveDisabled
                              }
                              onClick={() =>
                                deepSeekArchiveRunning
                                  ? cancelDeepSeekArchiveOrganization()
                                  : requestDeepSeekArchiveOrganization()
                              }
                            >
                              {deepSeekArchiveCancelRequested
                                ? '取消中...'
                                : deepSeekArchiveRunning
                                  ? '取消整理'
                                  : 'DeepSeek 整理'}
                            </button>
                          </div>
                        </div>
                        {deepSeekArchiveAvailable ? null : (
                          <small className="favorite-ledger-panel__deepseek-archive-disabled">
                            请先到设置开启 DeepSeek 后再使用辅助整理。
                          </small>
                        )}
                        <p className="favorite-ledger-panel__deepseek-archive-hint">
                          将发送标题、UP、标签、简介、来源收藏夹、当前建议和 bilimi 册目信息给 DeepSeek。
                        </p>
                        {deepSeekArchiveResultSummary ? (
                          <div className="favorite-ledger-panel__deepseek-result">
                            <div
                              className="favorite-ledger-panel__deepseek-result-summary"
                              role="status"
                              aria-label="DeepSeek 整理结果"
                              title={deepSeekArchiveResultSummary.batchFailures?.length
                                ? `DeepSeek 整理失败：${deepSeekArchiveResultSummary.batchFailures.length} 个批次失败，影响 ${deepSeekArchiveResultSummary.failedCount} 条视频`
                                : `DeepSeek 整理完成：已应用 ${deepSeekArchiveResultSummary.successCount} 条，未应用 ${deepSeekArchiveResultSummary.failedCount} 条`}
                            >
                              <span>
                                {deepSeekArchiveResultSummary.batchFailures?.length
                                  ? `${deepSeekArchiveResultSummary.batchFailures.length} 个批次失败，影响 ${deepSeekArchiveResultSummary.failedCount} 条视频`
                                  : `DeepSeek 整理完成：已应用 ${deepSeekArchiveResultSummary.successCount} 条，未应用 ${deepSeekArchiveResultSummary.failedCount} 条`}
                              </span>
                              <button
                                type="button"
                                className="favorite-ledger-panel__deepseek-result-toggle"
                                aria-label={`${deepSeekArchiveSummaryOpen ? '收起' : '查看'} DeepSeek ${deepSeekArchiveResultSummary.batchFailures?.length ? '整理失败' : '整理结果'}详情`}
                                aria-expanded={deepSeekArchiveSummaryOpen}
                                onClick={() => setDeepSeekArchiveSummaryOpen((open) => !open)}
                              >
                                <span>详情</span>
                                <span
                                  className="favorite-ledger-panel__deepseek-result-arrow"
                                  data-open={deepSeekArchiveSummaryOpen ? 'true' : 'false'}
                                  aria-hidden="true"
                                />
                              </button>
                            </div>
                            {deepSeekArchiveSummaryOpen ? (
                              <div
                                className="favorite-ledger-panel__deepseek-result-details"
                                role="region"
                                aria-label="本次 DeepSeek 整理结果"
                              >
                                <strong>{deepSeekArchiveResultSummary.batchFailures?.length ? '本次 DeepSeek 整理失败详情' : '本次 DeepSeek 整理结果'}</strong>
                                <span>
                                  共处理 {deepSeekArchiveResultSummary.successCount + deepSeekArchiveResultSummary.failedCount} 条视频。
                                </span>
                                {deepSeekArchiveResultSummary.batchFailures?.map((failure) => (
                                  <span key={`deepseek-failure-${failure.batchIndex}`}>
                                    第 {failure.batchIndex} 批：影响 {failure.affectedVideoCount} 条，{failure.failureKind}，{failure.errorMessage}
                                  </span>
                                ))}
                                {deepSeekArchiveResultSummary.batchFailures?.length ? (
                                  <button
                                    type="button"
                                    onClick={retryFailedDeepSeekArchiveBatches}
                                    disabled={deepSeekArchiveRunning}
                                  >
                                    仅重试失败批次
                                  </button>
                                ) : null}
                              {deepSeekArchiveResultSummary.successCount > 0 ? (
                                <span>
                                  <b>已应用 {deepSeekArchiveResultSummary.successCount} 条：</b>
                                  已采用 DeepSeek 建议并更新归档预览，尚未操作 B 站收藏夹。
                                </span>
                              ) : null}
                              {deepSeekArchiveResultSummary.failedCount > 0 ? (
                                <span>
                                  <b>未应用 {deepSeekArchiveResultSummary.failedCount} 条：</b>
                                  未采用 DeepSeek 建议，继续保持整理前的归档状态。
                                </span>
                              ) : null}
                              {deepSeekArchiveNonApplicationRows.map(([label, count]) => (
                                <span key={label}>{label}：{count} 条</span>
                              ))}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        {deepSeekArchiveStatus && deepSeekArchiveStatus !== deepSeekArchiveResultStatusText ? (
                          <p className="favorite-ledger-panel__deepseek-archive-status" role="status">
                            {deepSeekArchiveStatus}
                          </p>
                        ) : null}
                        {deepSeekArchiveSuggestionCount > 0 && onOpenDeepSeekSuggestions ? (
                          <button
                            type="button"
                            className="favorite-ledger-panel__deepseek-suggestion-link"
                            onClick={onOpenDeepSeekSuggestions}
                          >
                            前往采纳 DeepSeek 建议
                          </button>
                        ) : null}
                        {deepSeekArchiveProgress ? (
                          <div
                            className="favorite-ledger-panel__deepseek-archive-progress"
                            data-running={deepSeekArchiveRunning}
                          >
                            <div className="favorite-ledger-panel__deepseek-archive-progress-copy">
                              <span>
                                第 {deepSeekArchiveProgress.currentChunk} / {deepSeekArchiveProgress.totalChunks} 批
                              </span>
                              <span>
                                已完成 {deepSeekArchiveProgress.completedVideos} /{' '}
                                {deepSeekArchiveProgress.totalVideos} 条
                              </span>
                            </div>
                            <div
                              aria-label="DeepSeek 整理进度"
                              aria-valuemax={100}
                              aria-valuemin={0}
                              aria-valuenow={deepSeekArchiveProgressValue}
                              className="favorite-ledger-panel__deepseek-archive-progress-track"
                              role="progressbar"
                            >
                              <span style={{ width: `${deepSeekArchiveProgressValue}%` }} />
                            </div>
                          </div>
                        ) : null}
                      </div>
                      <div className="favorite-ledger-panel__archive-tool-divider" aria-hidden="true" />
                      <div
                        className="favorite-ledger-panel__archive-history-section"
                        role="group"
                        aria-label="归档预览改动操作"
                      >
                        <div className="favorite-ledger-panel__archive-history-actions">
                          <label className="favorite-ledger-panel__archive-history-select">
                            <span>改动记录</span>
                            {renderArchiveHistoryMenu()}
                          </label>
                          <button
                            type="button"
                            className="favorite-ledger-panel__archive-history-button"
                            disabled={oldFavoritePlanReadOnly || deepSeekArchiveRunning || archiveBatchRunning || archiveUndoStack.length === 0}
                            onClick={undoArchivePreviewChanges}
                          >
                            撤销本次改动
                          </button>
                          <button
                            type="button"
                            className="favorite-ledger-panel__archive-history-button"
                            disabled={oldFavoritePlanReadOnly || deepSeekArchiveRunning || archiveBatchRunning || archiveRedoStack.length === 0}
                            onClick={redoArchivePreviewChanges}
                          >
                            恢复本次改动
                          </button>
                        </div>
                        <p>Ctrl+Z 撤销，Ctrl+Shift+Z 恢复；会按最近改动逐步回退或重做。</p>
                      </div>
                    </div>
                  </div>
                  {archivePreviewAlertMessages.length > 0 ? (
                    <div className="favorite-ledger-panel__deepseek-archive-alert" role="alert">
                      {archivePreviewAlertMessages.map((message) => (
                        <p key={message}>{message}</p>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}
              {oldFavoriteGuideMode === 'setup' ? (
                draftLedgers.map((ledger) => (
                  <article key={ledger.id}>
                    <strong>{ledger.displayName}</strong>
                  </article>
                ))
              ) : (
                <div className="favorite-ledger-panel__preview-groups">
                  {previewScopedPendingItems.length > 0 ? (
                    <section
                      className="favorite-ledger-panel__preview-row favorite-ledger-panel__preview-row--pending"
                      data-archive-ledger-id="unclassified"
                      role="group"
                      aria-label={`未匹配到合适分类 ${previewScopedPendingItems.length} 条`}
                    >
                    <header>
                      <span className="favorite-ledger-panel__preview-heading">
                        <strong>未匹配到合适分类</strong>
                        <small>{previewScopedPendingItems.length} 条需要处理</small>
                      </span>
                      <label>
                        <input
                          type="checkbox"
                          aria-label="全部存入暂存"
                          checked={allPreviewScopedPendingItemsStaged}
                          disabled={oldFavoritePlanReadOnly || deepSeekArchiveRunning || archiveBatchRunning}
                          onChange={(event) =>
                            setPreviewScopedPendingItemsStaged(event.currentTarget.checked)
                          }
                        />
                        <span>全部存入暂存</span>
                      </label>
                    </header>
                    {expandedArchivePreviewGroups.has('unclassified') &&
                    previewScopedPendingItems.length > OLD_FAVORITE_VIRTUAL_TRACK_THRESHOLD ? (
                      <VirtualOldFavoriteTrack
                        className="favorite-ledger-panel__preview-videos favorite-ledger-panel__preview-videos--virtual"
                        ariaLabel="未匹配到合适分类视频"
                        items={previewScopedPendingItems}
                        itemKey={(item) => `pending-${item.sourceFolderTitle}-${item.aid}`}
                        itemWidth={OLD_FAVORITE_VIRTUAL_TRACK_ITEM_WIDTH}
                        renderItem={renderPendingOldFavoriteArticle}
                      />
                    ) : (
                    <div className="favorite-ledger-panel__preview-videos" aria-label="未匹配到合适分类视频">
                      {(expandedArchivePreviewGroups.has('unclassified')
                        ? previewScopedPendingItems
                        : previewScopedPendingItems.slice(0, OLD_FAVORITE_PREVIEW_INITIAL_LIMIT)).map((item) => (
                          <div key={`pending-${item.sourceFolderTitle}-${item.aid}`} className="favorite-ledger-panel__preview-item-shell">
                            {renderPendingOldFavoriteArticle(item)}
                          </div>
                        ))}
                      {previewScopedPendingItems.length > OLD_FAVORITE_PREVIEW_INITIAL_LIMIT &&
                      !expandedArchivePreviewGroups.has('unclassified') ? (
                        <button type="button" onClick={() => setExpandedArchivePreviewGroups((current) => new Set([...current, 'unclassified']))}>
                          显示全部 {previewScopedPendingItems.length} 条
                        </button>
                      ) : null}
                    </div>
                    )}
                    </section>
                  ) : null}
                  {oldFavoriteTargetGroups.map((group) => {
                    const selectedCount = group.entries.filter((entry) => entry.selected).length
                    const allSelected = group.entries.length > 0 && selectedCount === group.entries.length

                    return (
                      <section
                        key={group.ledgerId}
                        className="favorite-ledger-panel__preview-row"
                        data-archive-ledger-id={group.ledgerId}
                        role="group"
                        aria-label={`${group.displayName} ${group.entries.length} 条`}
                      >
                        <header>
                          <label>
                            <input
                              type="checkbox"
                              aria-label={`全选 ${group.displayName}`}
                              checked={allSelected}
                              disabled={oldFavoritePlanReadOnly || deepSeekArchiveRunning || archiveBatchRunning}
                              onChange={(event) =>
                                setOldFavoriteTargetGroupSelected(group, event.currentTarget.checked)
                              }
                            />
                            <span
                              className="favorite-ledger-panel__preview-heading"
                              title={group.displayName}
                            >
                              <strong>{group.displayName}</strong>
                              <small>{group.entries.length} 条适合</small>
                            </span>
                          </label>
                        </header>
                        {expandedArchivePreviewGroups.has(group.ledgerId) &&
                        group.entries.length > OLD_FAVORITE_VIRTUAL_TRACK_THRESHOLD ? (
                          <VirtualOldFavoriteTrack
                            className="favorite-ledger-panel__preview-videos favorite-ledger-panel__preview-videos--virtual"
                            ariaLabel={`${group.displayName} 视频`}
                            items={group.entries}
                            itemKey={(entry) => `${group.ledgerId}-${entry.item.sourceFolderTitle}-${entry.item.aid}`}
                            itemWidth={OLD_FAVORITE_VIRTUAL_TRACK_ITEM_WIDTH}
                            renderItem={(entry) => renderTargetOldFavoriteArticle(group, entry)}
                          />
                        ) : <div
                          className="favorite-ledger-panel__preview-videos"
                          aria-label={`${group.displayName} 视频`}
                        >
                          {(expandedArchivePreviewGroups.has(group.ledgerId)
                            ? group.entries
                            : group.entries.slice(0, OLD_FAVORITE_PREVIEW_INITIAL_LIMIT)).map(({ item, target, selected, changedByDeepSeek }) => (
                            <div key={`${group.ledgerId}-${item.sourceFolderTitle}-${item.aid}`} className="favorite-ledger-panel__preview-item-shell">
                              {renderTargetOldFavoriteArticle(group, { item, target, selected, changedByDeepSeek, targetChanged: false })}
                            </div>
                          ))}
                          {group.entries.length > OLD_FAVORITE_PREVIEW_INITIAL_LIMIT &&
                          !expandedArchivePreviewGroups.has(group.ledgerId) ? (
                            <button type="button" onClick={() => setExpandedArchivePreviewGroups((current) => new Set([...current, group.ledgerId]))}>
                              显示全部 {group.entries.length} 条
                            </button>
                          ) : null}
                        </div>}
                      </section>
                    )
                  })}
                </div>
              )}
                </>
              )}
            </div>
          ) : null}

          {oldFavoriteExpandedStep === 'confirm' ? useControlledOldFavoriteWorkspace ? (
            <section className="favorite-ledger-panel__confirm" aria-label="确认整理">
              <h4>确认执行</h4>
              {controlledScanSnapshot?.status === 'frozen' ? (
                <>
                  <p role="status">B 站同步计划已冻结，执行过程由主进程受控并带检查点。</p>
                  <div className="favorite-ledger-panel__confirm-actions">
                    <button
                      type="button"
                      disabled={oldFavoriteWorkspace.loading}
                      onClick={() => void oldFavoriteWorkspace.executeFrozenBilibiliPlan()}
                    >{oldFavoriteWorkspace.loading ? '正在开始…' : '开始同步到 B 站'}</button>
                  </div>
                </>
              ) : (
                <>
                  <p>将为当前归档预览生成不可变 B 站同步计划；未绑定、待对账或容量不足时不会执行。</p>
                  {!controlledBilibiliFreezeReady ? <p className="favorite-ledger-panel__confirm-warning" role="alert">请先为当前分段的每条视频选择归类。</p> : null}
                  <div className="favorite-ledger-panel__confirm-actions">
                    <button
                      type="button"
                      disabled={!controlledBilibiliFreezeReady || oldFavoriteWorkspace.loading}
                      onClick={() => void oldFavoriteWorkspace.freezeBilibiliExecution()}
                    >{oldFavoriteWorkspace.loading ? '正在冻结…' : '确认同步到 B 站'}</button>
                  </div>
                </>
              )}
            </section>
          ) : (
            !oldFavoriteScanFlowComplete ? (
              <section className="favorite-ledger-panel__confirm" aria-label="确认整理">
                <h4>确认执行</h4>
                <p className="favorite-ledger-panel__step-note">{OLD_FAVORITE_EXECUTION_NOTICE}</p>
                <p role="status" className="favorite-ledger-panel__step-note">请等待扫描结束</p>
              </section>
            ) : oldFavoriteExecutionConfirming && oldFavoriteGuideMode === 'organize' ? null : (
              <section className="favorite-ledger-panel__confirm" aria-label="确认整理">
                <h4>确认执行</h4>
                {oldFavoriteGuideMode === 'setup' ? (
                <>
                  <p>确认后会把当前勾选收藏夹同步到 B 站。</p>
                  <button
                    type="button"
                    disabled={busy || firstInvalidLedgerIndex >= 0}
                    onClick={() => void saveLedgers()}
                  >
                    确认同步
                  </button>
                </>
              ) : (
                <>
                  <p>已选择 {selectedOldFavoritePlanItems.length} 条归档任务</p>
                  {oldFavoriteSegmentProgress && activeOldFavoriteUserBatch?.segmentCount > 1 ? (
                    <>
                      <p>
                        当前段可执行 {oldFavoriteSegmentProgress.currentExecutableCount} · 全批可执行{' '}
                        {oldFavoriteSegmentProgress.batchExecutableCount} · 已完成{' '}
                        {oldFavoriteSegmentProgress.batchCompletedCount}/{oldFavoriteSegmentProgress.batchTotalCount}
                      </p>
                      <label>
                        <input
                          type="checkbox"
                          checked={continuousOldFavoriteExecution}
                          onChange={(event) => setContinuousOldFavoriteExecution(event.currentTarget.checked)}
                        />
                        连续执行所有已就绪分段
                      </label>
                    </>
                  ) : oldFavoriteSegmentProgress ? (
                    <p>本次可执行 {oldFavoriteSegmentProgress.currentExecutableCount} · 已完成 {oldFavoriteSegmentProgress.batchCompletedCount}/{oldFavoriteSegmentProgress.batchTotalCount}</p>
                  ) : null}
                  {selectedOldFavoritePlanItems.length === 0 ? (
                    <p>本轮没有需要执行的归档任务，点击确认整理后结束本轮整理</p>
                  ) : null}
                  {oldFavoriteTargetWarning ? (
                    <p className="favorite-ledger-panel__confirm-warning" role="alert">
                      {oldFavoriteTargetWarning}
                    </p>
                  ) : null}
                  {unresolvedArchiveTargetError ? (
                    <p className="favorite-ledger-panel__confirm-warning" role="alert">
                      {unresolvedArchiveTargetError}
                    </p>
                  ) : null}
                  {protectedReconciliationSummary.total > 0 ? (
                    <>
                      <p>
                        重新整理 {protectedReconciliationSummary.total} 条：{protectedReconciliationSummary.addCount} 条将追加，
                        {protectedReconciliationSummary.unchangedCount} 条保持当前 bilimi 归档。
                      </p>
                      <p>普通收藏保持不变。</p>
                    </>
                  ) : null}
                  <p>{OLD_FAVORITE_EXECUTION_NOTICE}</p>
                  {oldFavoriteExecutionProgress ? (
                    <div
                      className="favorite-ledger-panel__old-favorite-progress"
                      role="status"
                      aria-live="polite"
                    >
                      <strong>
                        {oldFavoriteExecutionPaused
                          ? '整理已暂停'
                          : oldFavoriteExecutionRiskStopped
                            ? '访问受限，整理已安全停止'
                            : '整理进度'}{' '}
                        {oldFavoriteExecutionProgress.completed}/{oldFavoriteExecutionProgress.total}
                      </strong>
                      {oldFavoriteExecutionPaused ? (
                        <>
                          <p>
                            已完成 {oldFavoriteExecutionProgress.completed} 条，剩余{' '}
                            {Math.max(0, oldFavoriteExecutionProgress.total - oldFavoriteExecutionProgress.completed)} 条
                          </p>
                          <p>暂停期间不会发送 B 站请求</p>
                        </>
                      ) : oldFavoriteExecutionRiskStopped ? (
                        <p>风控停止后不能继续整理，只能结束本轮；不会再发送 B 站请求。</p>
                      ) : null}
                      <progress
                        max={oldFavoriteExecutionProgress.total}
                        value={oldFavoriteExecutionProgress.completed}
                        aria-label="整理旧藏进度"
                      />
                      {oldFavoriteExecutionPaused ? (
                        pausedRoundEndConfirming ? null : (
                          <div className="favorite-ledger-panel__confirm-actions">
                            <button type="button" aria-label="结束本轮" onClick={() => setPausedRoundEndConfirming(true)}>结束批次</button>
                            <button type="button" onClick={() => void continueOldFavoriteExecution()}>继续整理</button>
                          </div>
                        )
                      ) : oldFavoriteExecutionRiskStopped ? (
                        <button type="button" aria-label="结束本轮" onClick={acknowledgeOldFavoriteExecution}>结束批次</button>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="favorite-ledger-panel__confirm-actions">
                    {oldFavoriteExecuting ? (
                      <button
                        type="button"
                        disabled={oldFavoriteExecutionStopping}
                        onClick={stopOldFavoriteExecution}
                      >
                        {oldFavoriteExecutionStopping ? '正在暂停…' : '暂停整理'}
                      </button>
                    ) : !oldFavoriteExecutionPaused && !oldFavoriteExecutionAwaitingAcknowledgement ? (
                      <button type="button" aria-label="结束本轮" onClick={() => setBatchDiscardConfirming(true)}>
                        结束批次
                      </button>
                    ) : null}
                    {!oldFavoriteExecutionPaused && !oldFavoriteExecutionRiskStopped ? <button
                      type="button"
                      aria-label={oldFavoriteExecutionAwaitingAcknowledgement ? '结束本轮' : undefined}
                      disabled={
                        deepSeekArchiveRunning ||
                        Boolean(unresolvedArchiveTargetError) ||
                        ((oldFavoriteExecuting ||
                          oldFavoriteExecutionConfirming) &&
                        !oldFavoriteExecutionAwaitingAcknowledgement)
                      }
                      onClick={() =>
                        firstInvalidLedgerIndex >= 0
                          ? focusInvalidLedger(firstInvalidLedgerIndex)
                          : oldFavoriteExecutionPaused
                          ? void continueOldFavoriteExecution()
                          : oldFavoriteExecutionAwaitingAcknowledgement
                          ? acknowledgeOldFavoriteExecution()
                          : selectedOldFavoritePlanItems.length === 0
                            ? acknowledgeOldFavoriteExecution()
                            : setOldFavoriteExecutionConfirming(true)
                      }
                    >
                      {oldFavoriteExecutionAwaitingAcknowledgement
                        ? '结束批次'
                        : oldFavoriteExecutionPaused
                        ? '继续整理'
                        : oldFavoriteExecuting
                        ? '整理中'
                        : '确认整理'}
                    </button> : null}
                  </div>
                </>
                )}
              </section>
            )
          ) : null}
          {tagEndConfirmOpen ? (
            <OldFavoriteModal
              title="确认结束标签补取？"
              danger
              confirmLabel="确认结束"
              onCancel={() => setTagEndConfirmOpen(false)}
              onConfirm={() => { setTagEndConfirmOpen(false); applyTagEnrichmentAction('cancel') }}
            >
                <p>结束后将停止继续补取标签，并使用当前已经取得的结果；尚未补取的标签不会自动加入本批次。</p>
            </OldFavoriteModal>
          ) : null}
          {pendingTagDeepSeekConfirming !== null ? (
            <OldFavoriteModal
              title="标签尚未补取完成"
              danger
              cancelLabel="继续等待"
              onCancel={() => setPendingTagDeepSeekConfirming(null)}
              extraActions={(
                <button
                  type="button"
                  onClick={() => {
                    const confirmedGeneration = pendingTagDeepSeekConfirming
                    setPendingTagDeepSeekConfirming(null)
                    if (confirmedGeneration === scanGenerationRef.current) {
                      void organizeOldFavoritesWithDeepSeek()
                    }
                  }}
                >
                  使用当前标签整理
                </button>
              )}
            >
              <p>
                {(scanProgress?.tags.pending ?? 0) > 0
                  ? `仍有 ${scanProgress?.tags.pending ?? 0} 个视频正在补取标签，`
                  : '标签补取尚未完成，'}
                建议等待标签补取完成后再整理。
              </p>
              <p>使用当前标签整理将使用当前归档预览，不会自动采用之后补取的标签。</p>
            </OldFavoriteModal>
          ) : null}
          {protectedReorganizationConfirming ? (
            <OldFavoriteModal
              title="确认重新整理已整理收藏？"
              danger
              confirmLabel="继续重新整理"
              onCancel={() => setProtectedReorganizationConfirming(false)}
              onConfirm={confirmProtectedReorganization}
            >
              <p>
                将把当前勾选来源中全部已整理的 {selectedProtectedOldFavorites.length} 条重新加入本轮判断，按当前规则重新计算，不受以前分类限制。用户原有普通收藏不会改变。
              </p>
            </OldFavoriteModal>
          ) : null}
          {abnormalProtectionReorganizationConfirming ? (
            <OldFavoriteModal
              title="确认重新整理状态有变化的视频？"
              danger
              confirmLabel="继续重新整理"
              onCancel={() => setAbnormalProtectionReorganizationConfirming(false)}
              onConfirm={confirmAbnormalProtectedReorganization}
            >
              <p>
                将把当前勾选来源中仅保留部分原归档或已不在原归档的 {selectedAbnormalProtectedOldFavorites.length} 条重新加入本轮判断，并按当前启用的收藏夹规则重新整理。用户原有普通收藏不会改变。
              </p>
            </OldFavoriteModal>
          ) : null}
          {pendingUnclassifiedDecision ? (
            <OldFavoriteModal
              title="确认未分类处理"
              danger
              onCancel={() => setPendingUnclassifiedDecision(null)}
              extraActions={(
                <>
                  <button type="button" onClick={() => confirmPendingUnclassifiedDecision('all')}>
                    全部去掉不整理
                  </button>
                  <button type="button" onClick={() => confirmPendingUnclassifiedDecision('current')}>
                    只取消当前收藏夹
                  </button>
                </>
              )}
            >
              <p>这个旧藏同时命中了多个收藏夹，要只取消当前收藏夹，还是全部去掉不整理？</p>
            </OldFavoriteModal>
          ) : null}
          {oldFavoriteExecutionConfirming && oldFavoriteGuideMode === 'organize' ? (
            <OldFavoriteModal
              title="确认开始整理？"
              danger
              cancelLabel="返回检查"
              confirmLabel="开始整理"
              confirmDisabled={firstInvalidLedgerIndex >= 0}
              onCancel={() => setOldFavoriteExecutionConfirming(false)}
              onConfirm={() => void executeOldFavoritePlan()}
            >
              <p>{OLD_FAVORITE_EXECUTION_CONFIRM_MESSAGE}</p>
              <p>
                本次将整理 {selectedOldFavoriteVideoCount} 条视频，每条视频最多存入{' '}
                {deepSeekArchiveMultiLimit(favoriteArchiveMultiMode)} 个 bilimi 收藏夹。
              </p>
              {oldFavoriteSegmentProgress && activeOldFavoriteUserBatch?.segmentCount > 1 ? (
                <>
                  <p>
                    当前段可执行 {oldFavoriteSegmentProgress.currentExecutableCount} · 全批可执行{' '}
                    {oldFavoriteSegmentProgress.batchExecutableCount} · 已完成{' '}
                    {oldFavoriteSegmentProgress.batchCompletedCount}/{oldFavoriteSegmentProgress.batchTotalCount}
                  </p>
                  <label>
                    <input
                      type="checkbox"
                      checked={continuousOldFavoriteExecution}
                      onChange={(event) => setContinuousOldFavoriteExecution(event.currentTarget.checked)}
                    />
                    连续执行所有已就绪分段
                  </label>
                </>
              ) : oldFavoriteSegmentProgress ? (
                <p>本次可执行 {oldFavoriteSegmentProgress.currentExecutableCount} · 已完成 {oldFavoriteSegmentProgress.batchCompletedCount}/{oldFavoriteSegmentProgress.batchTotalCount}</p>
              ) : null}
              {archiveMultiModeChange ? (
                <p className="favorite-ledger-panel__execution-dialog-change-note">
                  收藏夹数量设置已从“{favoriteArchiveMultiModeLabel(archiveMultiModeChange.from)}”调整为“
                  {favoriteArchiveMultiModeLabel(archiveMultiModeChange.to)}”，归档预览已按新设置更新。
                </p>
              ) : null}
            </OldFavoriteModal>
          ) : null}
          {pausedRoundEndConfirming ? (
            <OldFavoriteModal
              title="确认结束本轮？"
              danger
              cancelLabel="返回"
              confirmLabel="确认结束"
              onCancel={() => setPausedRoundEndConfirming(false)}
              onConfirm={acknowledgeOldFavoriteExecution}
            >
              <p>已完成 {oldFavoriteExecutionProgress?.completed ?? 0} 条，剩余 {Math.max(0, (oldFavoriteExecutionProgress?.total ?? 0) - (oldFavoriteExecutionProgress?.completed ?? 0))} 条。</p>
              <p>未匹配 {oldFavoriteEndSummary.unmatched} · 待复核 {oldFavoriteEndSummary.review} · 未执行 {oldFavoriteEndSummary.unexecuted} · 失败 {oldFavoriteEndSummary.failed} · 暂存 {oldFavoriteEndSummary.staging}</p>
              <p>结束后清除恢复执行点并转为历史只读；未完成视频可在下一次完整整理中重新纳入。</p>
            </OldFavoriteModal>
          ) : null}
          {batchDiscardConfirming ? (
            <OldFavoriteModal
              title="确认结束本轮？"
              danger
              cancelLabel="返回"
              confirmLabel="确认结束"
              onCancel={() => setBatchDiscardConfirming(false)}
              onConfirm={() => void discardActiveOldFavoriteBatch()}
            >
              <p>未匹配 {oldFavoriteEndSummary.unmatched} · 待复核 {oldFavoriteEndSummary.review} · 未执行 {oldFavoriteEndSummary.unexecuted} · 失败 {oldFavoriteEndSummary.failed} · 暂存 {oldFavoriteEndSummary.staging}</p>
              <p>结束后本批次转为历史只读；未执行、失败和未匹配视频可在下一次完整整理中重新纳入。</p>
            </OldFavoriteModal>
          ) : null}
        </section>
      ) : null}

    </section>
  )
}
