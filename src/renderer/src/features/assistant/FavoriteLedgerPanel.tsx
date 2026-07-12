import {
  BILIMI_LEDGER_PREFIX,
  createDefaultFavoriteLedgers,
  isBilimiManagedLedgerName,
  stripBilimiLedgerPrefix
} from '@shared/favoriteLedgers'
import { DEEPSEEK_CONSTRAINT_MARKER } from '@shared/favoriteLedgerConstraints'
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
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type DragEvent,
  type MouseEvent,
  type SetStateAction
} from 'react'
import type { FavoriteLedgerCandidate } from '../favorites/favoriteLedgerInsights'
import {
  createFavoriteLedgerPreview,
  type FavoriteSourceFolder,
  type FavoriteLedgerPreview,
  type FavoriteLedgerPreviewItem,
  type FavoriteLedgerPreviewTarget
} from '../favorites/favoriteLedgerPreview'
import {
  applyArchivePlanSelection,
  buildExecutableArchivePlan,
  createArchivePlanState,
  moveArchivePlanItemToUnclassified,
  revertArchivePlanItem,
  type FavoriteArchivePlanItemState,
  type FavoriteArchivePlanState
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
import {
  bindOldFavoriteRuntimeAccount,
  getOldFavoriteRuntimeValue,
  hasOldFavoriteRuntimeHandler,
  invokeOldFavoriteRuntimeHandler,
  registerOldFavoriteRuntimeHandler,
  resetOldFavoriteRuntimeSession,
  setOldFavoriteRuntimeValue,
  subscribeOldFavoriteRuntime
} from './oldFavoriteRuntimeSession'
import clickedPetUrl from '../../assets/pet/blue-white-maid/character/big-head/clicked.png'
import hintPetUrl from '../../assets/pet/blue-white-maid/character/big-head/hint.png'

export { resetOldFavoriteRuntimeSession } from './oldFavoriteRuntimeSession'

type OldFavoriteStatusTone = 'idle' | 'ok' | 'warn' | 'error' | 'running'

type OldFavoriteStatusSnapshot = {
  label: string
  message: string
  tone: OldFavoriteStatusTone
}

type DeepSeekArchiveResultSummary = {
  successCount: number
  failedCount: number
  nonApplicationCounts: DeepSeekArchiveNonApplicationCounts
}

type ArchiveMultiModeChange = {
  from: FavoriteArchiveMultiMode
  to: FavoriteArchiveMultiMode
}

type OldFavoriteExecutionPhase = 'idle' | 'running' | 'awaiting-acknowledgement'

type FavoriteLedgerPanelProps = {
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
  onExecuteOldFavoritePlan: (items: FavoriteLedgerPreviewItem[]) => Promise<AssistantAutomationResult>
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
  completedItems?: Array<
    FavoriteLedgerPreviewItem & {
      finalFolderIds?: string[]
      addedFolderIds?: string[]
      removedFolderIds?: string[]
    }
  >
}

type ArchivePreviewLatestChange = {
  kind: 'single' | 'batch'
  title: string
  reason: string
  movedCount: number
  itemChanges: Record<
    string,
    {
      title: string
      previousTargetText: string
      nextTargetText: string
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

type ArchivePreviewHistorySnapshot = {
  archivePlanState: DeepSeekArchiveRunSnapshot
  selectedCandidateKeys: string[]
  draftLedgers: FavoriteLedger[]
}

function useOldFavoriteRuntimeState<T>(
  key: string,
  initialValue: T | (() => T)
): [T, Dispatch<SetStateAction<T>>] {
  getOldFavoriteRuntimeValue(key, initialValue)

  const value = useSyncExternalStore(
    subscribeOldFavoriteRuntime,
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

const OLD_FAVORITE_APPEND_DELAY_MS = { min: 1200, max: 3000 }
const OLD_FAVORITE_COOLDOWN_DELAY_MS = { min: 15000, max: 45000 }
const OLD_FAVORITE_COOLDOWN_EVERY = 25
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

const DEEPSEEK_ARCHIVE_SCOPE_OPTIONS: Array<{ value: DeepSeekArchiveMode; label: string }> = [
  { value: 'low-confidence-and-unclassified', label: '不太稳 + 未匹配到合适分类' },
  { value: 'all', label: 'DeepSeek 进行二次整理' },
  { value: 'unclassified-only', label: '仅未匹配到合适分类' }
]

function deepSeekArchiveScopeLabel(mode: DeepSeekArchiveMode) {
  return DEEPSEEK_ARCHIVE_SCOPE_OPTIONS.find((option) => option.value === mode)?.label ?? '不太稳 + 未匹配到合适分类'
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
  return `custom-${candidate.kind}-${candidate.sourceName
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

function isBilimiLedger(ledger: FavoriteLedger) {
  return isBilimiManagedLedgerName(ledger.displayName)
}

function prefixedBilimiLedgerName(name: string) {
  return `${BILIMI_LEDGER_PREFIX}${stripBilimiLedgerPrefix(name)}`
}

function normalizeBilimiLedgerName(name: string) {
  return isBilimiManagedLedgerName(name) ? prefixedBilimiLedgerName(name) : name.trim()
}

function reorderLedgers(ledgers: FavoriteLedger[], draggedLedgerId: string, targetLedgerId: string) {
  if (draggedLedgerId === targetLedgerId) {
    return ledgers
  }

  const draggedIndex = ledgers.findIndex((ledger) => ledger.id === draggedLedgerId)
  const targetIndex = ledgers.findIndex((ledger) => ledger.id === targetLedgerId)
  if (draggedIndex < 0 || targetIndex < 0) {
    return ledgers
  }

  const nextLedgers = [...ledgers]
  const [draggedLedger] = nextLedgers.splice(draggedIndex, 1)
  const nextTargetIndex = nextLedgers.findIndex((ledger) => ledger.id === targetLedgerId)
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
  '④ 确认执行：查看进度，完成后点“好的”结束'
].join('\n')
const OLD_FAVORITE_EXECUTION_NOTICE =
  '开始整理后，本轮将按当前预览追加到 bilimi 收藏夹，执行中不能再更改。原收藏不会被删除、移动或取消。'
const OLD_FAVORITE_EXECUTION_CONFIRM_MESSAGE =
  '小咪提醒：主人要开始整理吗？开始后就不能再调整了哦！'
type OldFavoriteGuideStep = 'scan' | 'generated' | 'preview' | 'confirm'
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
    target.isContentEditable
  )
}

type OldFavoriteSourceFolderSummary = {
  name: string
  count: number
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
  return `custom-${candidate.kind}-${candidate.sourceName
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')}`
}

function candidateToFavoriteLedger(candidate: FavoriteLedgerCandidate, priority: number): FavoriteLedger {
  return {
    id: candidateLedgerIdFromCandidate(candidate),
    displayName: candidate.displayName,
    keywords: candidate.keywords,
    ruleType: candidateRuleType(candidate),
    enabled: true,
    priority,
    isDefault: false
  }
}

function recommendedCandidateKeysForPreview(preview: FavoriteLedgerPreview) {
  void preview
  return new Set<string>()
}

function mergeCandidateLedgers(
  ledgers: FavoriteLedger[],
  preview: FavoriteLedgerPreview,
  selectedCandidateKeys: Set<string>
) {
  const nextLedgers = [...ledgers]
  for (const candidate of preview.insights?.candidateLedgers ?? []) {
    if (!selectedCandidateKeys.has(candidateKey(candidate))) {
      continue
    }
    if (alreadyHasLedger(nextLedgers, candidate.displayName)) {
      continue
    }
    nextLedgers.push(candidateToFavoriteLedger(candidate, (nextLedgers.length + 1) * 10))
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

  const ledger = ledgers.find((candidate) => candidate.id === ledgerId)
  return {
    ledgerId,
    folderId: ledger?.bilibiliFolderId ?? '',
    displayName: ledger?.displayName ?? ledgerId,
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

  return {
    ...refreshedState,
    items: refreshedState.items.map((item) => {
      const currentItem = currentState.items.find((candidate) => candidate.itemKey === item.itemKey)
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
  return items.map((item) => {
    const planItem = state.items.find((candidate) => candidate.itemKey === archivePlanItemKey(item))
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
    ledgerId
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
  for (const executableItem of buildExecutableArchivePlan(args.state, args.ledgers)) {
    const planItem = args.state.items.find(
      (item) =>
        item.aid === executableItem.aid &&
        item.sourceFolderTitle === executableItem.sourceFolderTitle
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

  const resultsByAid = new Map<number, OldFavoriteExecutionResult[]>()
  for (const [index, item] of args.selectedItems.entries()) {
    const result = args.results[index]
    if (result) {
      resultsByAid.set(item.aid, [...(resultsByAid.get(item.aid) ?? []), result])
    }
  }

  const records: FavoriteArchiveProtectionRecord[] = []
  for (const [aid, items] of selectedByAid) {
    const results = resultsByAid.get(aid) ?? []
    if (results.length !== items.length || results.some((result) => result.ok === false || result.partial)) {
      continue
    }
    if (results.some((result) => !(result.completedItems ?? []).some((item) => item.aid === aid))) {
      continue
    }

    const completedItems = results.flatMap((result) => result.completedItems ?? []).filter((item) => item.aid === aid)
    const reorganizedItem = items.find((item) => item.reorganizeProtected)
    const targetFolderIds = uniqueLedgerIds(
      reorganizedItem
        ? completedItems.flatMap((item) => item.finalFolderIds ?? item.desiredTargetFolderIds ?? [])
        : completedItems.flatMap((item) => item.targetFolderId ? [item.targetFolderId] : [])
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

async function paceOldFavoriteExecution(completedCount: number, hasNextItem: boolean) {
  if (!hasNextItem || completedCount <= 0) {
    return
  }

  const shouldCooldown = completedCount % OLD_FAVORITE_COOLDOWN_EVERY === 0
  const delayMs = randomDelayMs(shouldCooldown ? OLD_FAVORITE_COOLDOWN_DELAY_MS : OLD_FAVORITE_APPEND_DELAY_MS)
  if (delayMs <= 0 || process.env.NODE_ENV === 'test') {
    return
  }

  await wait(delayMs)
}

export function FavoriteLedgerPanel({
  ledgers,
  missingLedgerIds,
  onSaveLedgers,
  onOpenFavoritePage,
  onScanOldFavorites,
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
  const [draftLedgers, setDraftLedgers] = useOldFavoriteRuntimeState<FavoriteLedger[]>(
    'draftLedgers',
    () => ledgers.map(cloneArchiveDraftLedger)
  )
  const [activeLedgerId, setActiveLedgerId] = useState<string | null>(null)
  const [activeLedgerIndex, setActiveLedgerIndex] = useState<number | null>(null)
  const [activeLedgerSavedSnapshot, setActiveLedgerSavedSnapshot] =
    useState<ReturnType<typeof ledgerEditorSnapshot> | null>(null)
  const [preview, setPreview] = useOldFavoriteRuntimeState<FavoriteLedgerPreview | null>('preview', null)
  const [baseScanPreview, setBaseScanPreview] =
    useOldFavoriteRuntimeState<FavoriteLedgerPreview | null>('baseScanPreview', null)
  const [reorganizedProtectedAids, setReorganizedProtectedAids] =
    useOldFavoriteRuntimeState<Set<number>>('reorganizedProtectedAids', () => new Set())
  const [protectedReorganizationConfirming, setProtectedReorganizationConfirming] = useState(false)
  const [abnormalProtectionReorganizationConfirming, setAbnormalProtectionReorganizationConfirming] = useState(false)
  const [selectedDefaultLedgerIds, setSelectedDefaultLedgerIds] = useState<Set<string>>(
    () => new Set(ledgers.filter((ledger) => ledger.enabled && ledger.isDefault).map((ledger) => ledger.id))
  )
  const [selectedCandidateKeys, setSelectedCandidateKeys] = useOldFavoriteRuntimeState<Set<string>>(
    'selectedCandidateKeys',
    () => new Set()
  )
  const [archivePlanState, setArchivePlanState] =
    useOldFavoriteRuntimeState<FavoriteArchivePlanState | null>('archivePlanState', null)
  const [pendingUnclassifiedDecision, setPendingUnclassifiedDecision] =
    useState<PendingUnclassifiedDecision | null>(null)
  const [selectedOldFavoriteSourceFolderTitles, setSelectedOldFavoriteSourceFolderTitles] =
    useOldFavoriteRuntimeState<Set<string>>('selectedOldFavoriteSourceFolderTitles', () => new Set())
  const [oldFavoriteExecutionProgress, setOldFavoriteExecutionProgress] =
    useOldFavoriteRuntimeState<{
      completed: number
      total: number
    } | null>('oldFavoriteExecutionProgress', null)
  const [deepSeekArchiveMode, setDeepSeekArchiveMode] = useOldFavoriteRuntimeState<DeepSeekArchiveMode>(
    'deepSeekArchiveMode',
    'low-confidence-and-unclassified'
  )
  const [deepSeekArchiveScopeOpen, setDeepSeekArchiveScopeOpen] = useState(false)
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
  const [latestArchiveChange, setLatestArchiveChange] =
    useOldFavoriteRuntimeState<ArchivePreviewLatestChange | null>('latestArchiveChange', null)
  const [manualArchiveMoveFocus, setManualArchiveMoveFocus] =
    useState<ArchivePreviewManualMoveFocus | null>(null)

  function clearDeepSeekArchiveRunSnapshot(options: { resetHistory?: boolean } = {}) {
    setDeepSeekArchiveRunSnapshot(null)
    setArchivePreviewAlertMessages([])
    setDeepSeekArchiveProgress(null)
    if (options.resetHistory) {
      setArchiveUndoStack([])
      setArchiveRedoStack([])
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
    state: FavoriteArchivePlanState
  ): ArchivePreviewHistorySnapshot {
    return {
      archivePlanState: createDeepSeekArchiveSnapshot(state),
      selectedCandidateKeys: [...selectedCandidateKeys],
      draftLedgers: draftLedgers.map(cloneArchiveDraftLedger)
    }
  }

  function restoreArchivePreviewHistorySnapshot(snapshot: ArchivePreviewHistorySnapshot) {
    const restoredState = revertDeepSeekArchiveRun(
      archivePlanState ?? snapshot.archivePlanState,
      snapshot.archivePlanState
    )
    setArchivePlanState(restoredState)
    updatePreviewFromArchivePlan(restoredState)
    setSelectedCandidateKeys(new Set(snapshot.selectedCandidateKeys))
    setDraftLedgers(snapshot.draftLedgers.map(cloneArchiveDraftLedger))
    return restoredState
  }

  function recordArchivePreviewHistory(state: FavoriteArchivePlanState) {
    setArchiveUndoStack((current) => [...current, createArchivePreviewHistorySnapshot(state)])
    setArchiveRedoStack([])
  }
  const [oldFavoriteExecutionPhase, setOldFavoriteExecutionPhase] =
    useOldFavoriteRuntimeState<OldFavoriteExecutionPhase>('oldFavoriteExecutionPhase', 'idle')
  const oldFavoriteExecuting = oldFavoriteExecutionPhase === 'running'
  const oldFavoriteExecutionAwaitingAcknowledgement =
    oldFavoriteExecutionPhase === 'awaiting-acknowledgement'
  const [oldFavoriteExecutionConfirming, setOldFavoriteExecutionConfirming] = useState(false)
  const [archiveMultiModeChange, setArchiveMultiModeChange] =
    useOldFavoriteRuntimeState<ArchiveMultiModeChange | null>('archiveMultiModeChange', null)
  const [status, setStatus] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [draggedLedgerId, setDraggedLedgerId] = useState<string | null>(null)
  const [dragTargetLedgerId, setDragTargetLedgerId] = useState<string | null>(null)
  const [ledgerListExpanded, setLedgerListExpanded] =
    useOldFavoriteRuntimeState('ledgerListExpanded', false)
  const [oldFavoriteStep, setOldFavoriteStep] =
    useOldFavoriteRuntimeState<OldFavoriteGuideStep>('oldFavoriteStep', 'scan')
  const [oldFavoriteGuideMode, setOldFavoriteGuideMode] =
    useOldFavoriteRuntimeState<OldFavoriteGuideMode>('oldFavoriteGuideMode', 'organize')
  const [tagCandidatesExpanded, setTagCandidatesExpanded] = useState(false)
  const [ledgerHintExpanded, setLedgerHintExpanded] = useState(false)
  const [oldFavoriteGuideHintExpanded, setOldFavoriteGuideHintExpanded] = useState(false)
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
  const activeLedgerDeepSeekConstraint = activeLedger ? ledgerDeepSeekConstraintText(activeLedger) : ''
  const activeLedgerHasUnsavedChanges = useMemo(() => {
    if (!activeLedger) {
      return false
    }

    return JSON.stringify(ledgerEditorSnapshot(activeLedger)) !== JSON.stringify(activeLedgerSavedSnapshot)
  }, [activeLedger, activeLedgerSavedSnapshot])
  useEffect(() => {
    if (!preview) {
      setDraftLedgers(ledgers.map(cloneArchiveDraftLedger))
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
    return oldFavoriteExecuting || oldFavoriteExecutionAwaitingAcknowledgement || oldFavoriteExecutionConfirming
  }

  function showOldFavoriteOrganizationPendingMessage() {
    setStatus('正在整理中，请耐心等待。')
  }

  function acknowledgeOldFavoriteExecution() {
    setOldFavoriteExecutionPhase('idle')
    setOldFavoriteExecutionConfirming(false)
    setOldFavoriteExecutionProgress(null)
    setPreview(null)
    setBaseScanPreview(null)
    setReorganizedProtectedAids(new Set())
    setProtectedReorganizationConfirming(false)
    setAbnormalProtectionReorganizationConfirming(false)
    setArchivePlanState(null)
    setPendingUnclassifiedDecision(null)
    clearDeepSeekArchiveRunSnapshot({ resetHistory: true })
    setSelectedCandidateKeys(new Set())
    setSelectedOldFavoriteSourceFolderTitles(new Set())
    setDeepSeekArchiveRunning(false)
    setDeepSeekArchiveStatus('')
    setDeepSeekArchiveResultSummary(null)
    setDeepSeekArchiveSummaryOpen(false)
    setDeepSeekArchiveSuggestionCount(0)
    setArchiveMultiModeChange(null)
    setOldFavoriteRuntimeStatus(null)
    setDraftLedgers(ledgers.map(cloneArchiveDraftLedger))
    setLedgerListExpanded(false)
    setOldFavoriteStep('scan')
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

  async function startOrganizingOldFavorites() {
    if (oldFavoriteOrganizationLocked()) {
      showOldFavoriteOrganizationPendingMessage()
      return
    }

    if (preview && oldFavoriteGuideMode === 'organize') {
      setLedgerListExpanded(true)
      return
    }

    await saveLedgers({
      includeSelectedCandidates: false,
      includeDefaultLedgers: true,
      pendingMessage: '正在同步整理旧藏需要的主收藏...',
      saveOptions: { deleteDisabled: false },
      onSuccess: async () => {
        await scanOldFavorites()
      }
    })
  }

  useEffect(() => {
    if (organizeOldFavoritesRequestSignal <= 0) {
      return
    }

    void startOrganizingOldFavorites()
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
    setLedgerListExpanded(true)
    setSaveStatus(null)
  }

  function resetLedgers() {
    if (deepSeekArchiveRunning) {
      return
    }

    const defaultLedgers = createDefaultFavoriteLedgers().map((ledger) => ({
      ...ledger,
      enabled: false
    }))
    setDraftLedgers(defaultLedgers)
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

  function deleteLedger(ledgerId: string) {
    setDraftLedgers((currentLedgers) => {
      const ledgerIndex =
        activeLedgerIndex !== null && currentLedgers[activeLedgerIndex]?.id === ledgerId
          ? activeLedgerIndex
          : currentLedgers.findIndex((ledger) => ledger.id === ledgerId)
      const nextLedgers = currentLedgers.filter(
        (ledger, index) => index !== ledgerIndex || !canDeleteLedger(ledger)
      )
      if (ledgerId === activeLedgerId) {
        setActiveLedgerId(null)
        setActiveLedgerIndex(null)
        setActiveLedgerSavedSnapshot(null)
      }
      setSaveStatus(null)
      return nextLedgers
    })
  }

  function toggleLedger(ledgerId: string) {
    const ledger = draftLedgers.find((item) => item.id === ledgerId)
    if (ledger?.isDefault) {
      toggleDefaultLedger(ledgerId)
    }

    setDraftLedgers(
      draftLedgers.map((ledger) =>
        ledger.id === ledgerId
          ? {
              ...ledger,
              enabled: !ledger.enabled
            }
          : ledger
      )
    )
  }

  function selectLedger(ledger: FavoriteLedger, ledgerIndex: number) {
    if (activeLedgerId && activeLedgerId !== ledger.id && activeLedgerHasUnsavedChanges) {
      setSaveStatus('当前收藏夹有未保存修改，请先保存。')
      return
    }

    if (activeLedgerId === ledger.id && activeLedgerIndex !== ledgerIndex) {
      if (activeLedgerHasUnsavedChanges) {
        setSaveStatus('当前收藏夹有未保存修改，请先保存。')
        return
      }

      setActiveLedgerId(null)
      setActiveLedgerIndex(null)
      setActiveLedgerSavedSnapshot(null)
      return
    }

    setActiveLedgerId(ledger.id)
    setActiveLedgerIndex(ledgerIndex)
    setActiveLedgerSavedSnapshot(ledgerEditorSnapshot(ledger))
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
      return currentLedgers.map((ledger) =>
        ledger.id === activeLedger.id
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

  function saveActiveLedgerDraft() {
    if (!activeLedger || activeLedgerIndex === null) {
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

  function setArchivePlanCandidateSelected(
    candidateTargetKey: string,
    selected: boolean,
    reason: string
  ) {
    if (deepSeekArchiveRunning) {
      return
    }

    clearDeepSeekArchiveRunSnapshot()
    setArchivePlanState((current) => {
      if (!current) {
        return current
      }

      const candidateLedgerIdsByItemKey = new Map<string, string[]>()
      for (const item of preview?.items ?? []) {
        const ledgerIds = (item.candidateTargets ?? [])
          .filter((target) => target.candidateKey === candidateTargetKey)
          .map((target) => target.ledgerId)
        if (ledgerIds.length > 0 && !item.alreadyInTarget) {
          candidateLedgerIdsByItemKey.set(archivePlanItemKey(item), ledgerIds)
        }
      }

      const nextState = {
        ...current,
        items: current.items.map((planItem) => {
          const candidateLedgerIds = candidateLedgerIdsByItemKey.get(planItem.itemKey)
          if (!candidateLedgerIds) {
            return planItem
          }

          const currentTargetLedgerIds = new Set(planItem.currentTargetLedgerIds)
          const selectedTargetLedgerIds = new Set(planItem.selectedTargetLedgerIds)
          for (const ledgerId of candidateLedgerIds) {
            if (selected) {
              currentTargetLedgerIds.delete('inbox')
              selectedTargetLedgerIds.delete('inbox')
              currentTargetLedgerIds.add(ledgerId)
              selectedTargetLedgerIds.add(ledgerId)
            } else {
              currentTargetLedgerIds.delete(ledgerId)
              selectedTargetLedgerIds.delete(ledgerId)
            }
          }

          return {
            ...planItem,
            currentTargetLedgerIds: Array.from(currentTargetLedgerIds),
            selectedTargetLedgerIds: Array.from(selectedTargetLedgerIds),
            userModified: true,
            lastChangeSource: 'user' as const
          }
        })
      }
      const previousStateForChange = selected
        ? {
            ...current,
            items: current.items.map((planItem) =>
              candidateLedgerIdsByItemKey.has(planItem.itemKey)
                ? {
                    ...planItem,
                    currentTargetLedgerIds: planItem.currentTargetLedgerIds.filter(
                      (ledgerId) => ledgerId !== 'inbox'
                    ),
                    selectedTargetLedgerIds: planItem.selectedTargetLedgerIds.filter(
                      (ledgerId) => ledgerId !== 'inbox'
                    )
                  }
                : planItem
            )
          }
        : current
      const latestChange = latestArchiveChangeBetween(previousStateForChange, nextState, {
        batchReason: reason,
        forceBatch: true,
        inboxAsUnclassified: selected
      })
      if (!latestChange) {
        return current
      }

      recordArchivePreviewHistory(previousStateForChange)
      setLatestArchiveChange(latestChange)
      setArchivePreviewAlertMessages(
        [archiveChangeAlertSummary(latestChange)].filter((message): message is string => Boolean(message))
      )
      return nextState
    })
  }

  function setCandidateSelected(candidate: FavoriteLedgerCandidate, selected: boolean) {
    if (deepSeekArchiveRunning) {
      return
    }

    const key = candidateKey(candidate)
    setSaveStatus(null)
    if (!selected) {
      setArchivePlanCandidateSelected(key, false, `取消勾选收藏夹「${candidate.displayName}」`)
      setSelectedCandidateKeys((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
      setDraftLedgers((currentLedgers) =>
        currentLedgers.filter(
          (ledger) =>
            !(
              !ledger.isDefault &&
              ledger.id === candidateLedgerId(candidate) &&
              ledger.displayName === candidate.displayName
            )
        )
      )
      return
    }

    setArchivePlanCandidateSelected(key, true, `勾选收藏夹「${candidate.displayName}」`)
    setSelectedCandidateKeys((current) => {
      const next = new Set(current)
      next.add(key)
      return next
    })
    setDraftLedgers((currentLedgers) => {
      if (alreadyHasLedger(currentLedgers, candidate.displayName)) {
        return currentLedgers.map((ledger) =>
          ledger.displayName === candidate.displayName
            ? {
                ...ledger,
                enabled: true
              }
            : ledger
        )
      }

      return withSequentialPriorities([
        ...currentLedgers,
        candidateToLedger(candidate, (currentLedgers.length + 1) * 10)
      ])
    })
    setLedgerListExpanded(true)
  }

  function setCandidateGroupSelected(candidates: FavoriteLedgerCandidate[], selected: boolean) {
    if (deepSeekArchiveRunning) {
      return
    }

    for (const candidate of candidates) {
      setCandidateSelected(candidate, selected)
    }
  }

  function selectedCandidateBatchReason() {
    const selectedCandidates =
      preview?.insights?.candidateLedgers.filter((candidate) =>
        selectedCandidateKeys.has(candidateKey(candidate))
      ) ?? []
    if (selectedCandidates.length === 1) {
      return `勾选收藏夹「${selectedCandidates[0].displayName}」`
    }

    return `勾选 ${selectedCandidates.length} 个收藏夹`
  }

  function syncSelectedCandidatesToArchivePlanForPreview() {
    if (!preview || !archivePlanState || selectedCandidateKeys.size === 0) {
      return
    }

    const nextState = createArchivePlanStateFromPreviewItems(preview.items, selectedCandidateKeys)
    const latestChange = latestArchiveChangeBetween(archivePlanState, nextState, {
      batchReason: selectedCandidateBatchReason(),
      forceBatch: true
    })
    if (!latestChange) {
      if (!latestArchiveChange) {
        const baselineState = createArchivePlanStateFromPreviewItems(preview.items)
        const baselineChange = latestArchiveChangeBetween(baselineState, nextState, {
          batchReason: selectedCandidateBatchReason(),
          forceBatch: true
        })
        if (baselineChange) {
          setLatestArchiveChange(baselineChange)
          setArchivePreviewAlertMessages(
            [archiveChangeAlertSummary(baselineChange)].filter((message): message is string => Boolean(message))
          )
        }
      }
      return
    }

    recordArchivePreviewHistory(archivePlanState)
    setArchivePlanState(nextState)
    setLatestArchiveChange(latestChange)
    setArchivePreviewAlertMessages(
      [archiveChangeAlertSummary(latestChange)].filter((message): message is string => Boolean(message))
    )
  }

  function switchOldFavoriteStep(stepId: OldFavoriteGuideStep) {
    if (stepId === 'preview') {
      syncSelectedCandidatesToArchivePlanForPreview()
    }
    setOldFavoriteStep(stepId)
  }

  function candidateToLedger(candidate: FavoriteLedgerCandidate, priority: number): FavoriteLedger {
    return {
      id: candidateLedgerId(candidate),
      displayName: candidate.displayName,
      keywords: candidate.keywords,
      ruleType: candidateRuleType(candidate),
      enabled: true,
      priority,
      isDefault: false
    }
  }

  function handleLedgerDragStart(event: DragEvent<HTMLDivElement>, ledgerId: string) {
    setDraggedLedgerId(ledgerId)
    setDragTargetLedgerId(null)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', ledgerId)
  }

  function handleLedgerDragOver(event: DragEvent<HTMLDivElement>, targetLedgerId: string) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (!draggedLedgerId || draggedLedgerId === targetLedgerId) {
      setDragTargetLedgerId(null)
      return
    }

    if (dragTargetLedgerId === targetLedgerId) {
      return
    }

    setDragTargetLedgerId(targetLedgerId)
  }

  function handleLedgerDrop(event: DragEvent<HTMLDivElement>, targetLedgerId: string) {
    event.preventDefault()
    const sourceLedgerId = event.dataTransfer?.getData('text/plain') || draggedLedgerId
    setDraggedLedgerId(null)
    setDragTargetLedgerId(null)
    if (!sourceLedgerId) {
      return
    }

    setDraftLedgers((currentLedgers) => withSequentialPriorities(reorderLedgers(currentLedgers, sourceLedgerId, targetLedgerId)))
    setSaveStatus(null)
  }

  function finishLedgerDrag() {
    setDraggedLedgerId(null)
    setDragTargetLedgerId(null)
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
      if (alreadyHasLedger(nextLedgers, candidate.displayName)) {
        continue
      }

      nextLedgers.push(candidateToLedger(candidate, (nextLedgers.length + 1) * 10))
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
  } = {}) {
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
      }
    } catch (error) {
      setSaveStatus(`同步未完成：${errorMessage(error)}`)
    } finally {
      setBusy(false)
    }
  }

  async function scanOldFavorites(
    mode: 'setup' | 'organize' = 'organize'
  ) {
    setBusy(true)
    setSaveStatus(null)
    setArchiveMultiModeChange(null)
    setDeepSeekArchiveResultSummary(null)
    setDeepSeekArchiveSummaryOpen(false)
    clearDeepSeekArchiveRunSnapshot()
    setOldFavoriteExecutionProgress(null)
    setStatus('正在扫描旧藏，请稍候。')
    onOldFavoriteStatusUpdate?.({
      label: '旧藏扫描中',
      message: '正在扫描旧藏，请稍候。',
      tone: 'running'
    })
    try {
      const nextPreview = await onScanOldFavorites({
        multiArchiveMode: favoriteArchiveMultiMode
      })
      if (nextPreview.ok === false) {
        setPreview(null)
        setBaseScanPreview(null)
        setReorganizedProtectedAids(new Set())
        setArchivePlanState(null)
        clearDeepSeekArchiveRunSnapshot({ resetHistory: true })
        setPendingUnclassifiedDecision(null)
        const failureMessage = `整理旧藏未完成：${nextPreview.message || '请稍后重试。'}`
        setStatus(failureMessage)
        onOldFavoriteStatusUpdate?.({
          label: '扫描失败',
          message: failureMessage,
          tone: 'error'
        })
        return
      }

      const accountChanged = bindOldFavoriteRuntimeAccount(
        nextPreview.scanContext?.accountMid ?? ''
      )
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

      const nextCandidateKeys = recommendedCandidateKeysForPreview(normalizedPreview)
      setPreview(normalizedPreview)
      setBaseScanPreview(normalizedPreview)
      setReorganizedProtectedAids(new Set())
      setProtectedReorganizationConfirming(false)
      setAbnormalProtectionReorganizationConfirming(false)
      setArchivePlanState(createArchivePlanStateFromPreviewItems(normalizedPreview.items, nextCandidateKeys))
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
      setSelectedOldFavoriteSourceFolderTitles(
        new Set([
          ...normalizedPreview.items.map((item) => item.sourceFolderTitle),
          ...(normalizedPreview.scanContext?.protectedVideos.flatMap(
            (item) => item.sourceFolderTitles ?? []
          ) ?? [])
        ])
      )
      const scannedCount = normalizedPreview.insights?.totalVideos ?? normalizedPreview.items.length
      const scanMessage =
        mode === 'setup'
          ? `已扫描 ${scannedCount} 条旧藏，可勾选库房后同步。`
          : `已扫描 ${normalizedPreview.items.length} 条旧藏，可勾选后整理。`
      const scanFeedbackMessage =
        mode === 'setup'
          ? `旧藏扫描完成，发现 ${scannedCount} 条待备册`
          : `旧藏扫描完成，发现 ${normalizedPreview.items.length} 条待整理`
      setStatus(scanMessage)
      onOldFavoriteStatusUpdate?.({
        label: mode === 'setup' ? `旧藏待备册 ${scannedCount}` : `旧藏待整理 ${normalizedPreview.items.length}`,
        message: scanMessage,
        tone: 'warn'
      })
      invokeOldFavoriteRuntimeHandler('onOldFavoriteStageFeedback', scanFeedbackMessage)
    } catch (error) {
      setPreview(null)
      setBaseScanPreview(null)
      setReorganizedProtectedAids(new Set())
      setArchivePlanState(null)
      clearDeepSeekArchiveRunSnapshot({ resetHistory: true })
      setPendingUnclassifiedDecision(null)
      const failureMessage = `整理旧藏未完成：${errorMessage(error)}`
      setStatus(failureMessage)
      onOldFavoriteStatusUpdate?.({
        label: '扫描失败',
        message: failureMessage,
        tone: 'error'
      })
    } finally {
      setBusy(false)
    }
  }

  function updateArchivePlanSelectedTargets(
    item: FavoriteLedgerPreviewItem,
    update: (planItem: FavoriteArchivePlanItemState) => string[]
  ) {
    if (deepSeekArchiveRunning) {
      return
    }

    clearDeepSeekArchiveRunSnapshot()
    setArchivePlanState((current) => {
      if (!current) {
        return current
      }

      return {
        ...current,
        items: current.items.map((planItem) =>
          planItem.aid === item.aid && planItem.sourceFolderTitle === item.sourceFolderTitle
            ? {
                ...planItem,
                selectedTargetLedgerIds: uniqueLedgerIds(update(planItem)),
                userModified: true,
                lastChangeSource: 'user'
              }
            : planItem
        )
      }
    })
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

  function setOldFavoriteTargetGroupSelected(group: OldFavoriteTargetGroup, selected: boolean) {
    if (deepSeekArchiveRunning) {
      return
    }

    clearDeepSeekArchiveRunSnapshot()
    setArchivePlanState((current) => {
      if (!current) {
        return current
      }

      const itemKeys = new Set(group.entries.map((entry) => archivePlanItemKey(entry.item)))
      return {
        ...current,
        items: current.items.map((planItem) => {
          if (!itemKeys.has(planItem.itemKey)) {
            return planItem
          }

          const selectedTargetLedgerIds = new Set(planItem.selectedTargetLedgerIds)
          if (selected) {
            selectedTargetLedgerIds.add(group.ledgerId)
          } else {
            selectedTargetLedgerIds.delete(group.ledgerId)
          }
          return {
            ...planItem,
            selectedTargetLedgerIds: Array.from(selectedTargetLedgerIds),
            userModified: true,
            lastChangeSource: 'user'
          }
        })
      }
    })
  }

  function toggleOldFavoriteSourceFolder(sourceFolderTitle: string) {
    setSelectedOldFavoriteSourceFolderTitles((current) => {
      const next = new Set(current)
      if (next.has(sourceFolderTitle)) {
        next.delete(sourceFolderTitle)
      } else {
        next.add(sourceFolderTitle)
      }
      return next
    })
  }

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
        disabled={deepSeekArchiveRunning}
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

  function updatePreviewFromArchivePlan(nextState: FavoriteArchivePlanState) {
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
                      ...targetForOldFavoriteLedgerId(item, ledgerId, draftLedgers),
                      selected: planItem.selectedTargetLedgerIds.includes(ledgerId)
                    }))
                  : []
            },
            draftLedgers
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

    if (archivePlanState && archivePlanHasPreviewChanges(nextState)) {
      recordArchivePreviewHistory(archivePlanState)
    }
    const latestChange = archivePlanState ? latestArchiveChangeBetween(archivePlanState, nextState) : null
    if (latestChange) {
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
    if (deepSeekArchiveRunning) {
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

  function failedDeepSeekArchiveRows(
    request: Extract<DeepSeekGenerateRequest, { kind: 'favorite-archive-organize' }>,
    message: string
  ): DeepSeekArchiveVideoResult[] {
    return request.videos.map((video) => ({
      aid: video.aid,
      sourceFolderTitle: video.sourceFolderTitle,
      targetLedgerIds: [],
      keepOriginal: false,
      reason: '',
      lowConfidence: true,
      invalid: true,
      failureKind: 'request-failed',
      errorMessage: message
    }))
  }

  async function organizeOldFavoritesWithDeepSeek() {
    if (!deepSeekArchiveAvailable) {
      const message = '请先到设置开启 DeepSeek 后再使用辅助整理。'
      setDeepSeekArchiveStatus(message)
      invokeOldFavoriteRuntimeHandler('onOldFavoriteStageFeedback', message)
      return
    }

    if (!archivePlanState || !onOrganizeOldFavoritesWithDeepSeek) {
      return
    }

    const multiArchiveLimit = deepSeekArchiveMultiLimit(favoriteArchiveMultiMode)
    const request = buildDeepSeekArchiveRequest(
      archivePlanState,
      archiveExecutionLedgers,
      deepSeekArchiveMode,
      multiArchiveLimit
    )

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
          const result = await onOrganizeOldFavoritesWithDeepSeek(deepSeekArchiveMode, chunk)
          if (!isCurrentDeepSeekArchiveRun()) {
            return
          }
          if (getOldFavoriteRuntimeValue('deepSeekArchiveCancelRequested', false)) {
            break
          }
          if (!result || result.kind !== 'favorite-archive-organize' || !Array.isArray(result.results)) {
            results.push(...failedDeepSeekArchiveRows(chunk, 'DeepSeek 返回格式无效。'))
            continue
          }

          results.push(...result.results)
          keywordSuggestions.push(...(result.keywordSuggestions ?? []))
        } catch (error) {
          if (!isCurrentDeepSeekArchiveRun()) {
            return
          }
          results.push(...failedDeepSeekArchiveRows(chunk, errorMessage(error)))
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

      const applied = applyDeepSeekArchiveResults({
        state: archivePlanState,
        ledgers: archiveExecutionLedgers,
        enabledLedgerIds: archiveExecutionLedgers.filter((ledger) => ledger.enabled).map((ledger) => ledger.id),
        multiArchiveLimit,
        results
      })
      const deepSeekMoveFocus = archivePreviewMoveFocusBetween(archivePlanState, applied.state)
      const deepSeekArchiveChange = latestArchiveChangeBetween(archivePlanState, applied.state, {
        batchReason: 'DeepSeek 批量整理',
        forceBatch: true
      })
      recordArchivePreviewHistory(archivePlanState)
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
      const markDeepSeekArchiveReady = () => {
        setOldFavoriteRuntimeStatus({
          label: `整理待确认 ${request.videos.length}`,
          message: 'DeepSeek 整理完成，请确认执行。',
          tone: 'warn'
        })
        invokeOldFavoriteRuntimeHandler(
          'onOldFavoriteStageFeedback',
          'DeepSeek 整理完成，请确认执行'
        )
      }

      setDeepSeekArchiveResultSummary({
        successCount: applied.stats.successCount,
        failedCount: applied.stats.failedCount,
        nonApplicationCounts: applied.nonApplicationCounts
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
    if (!archivePlanState || deepSeekArchiveRunning || archiveUndoStack.length === 0) {
      return
    }

    const previousSnapshot = archiveUndoStack[archiveUndoStack.length - 1]
    const currentSnapshot = createArchivePreviewHistorySnapshot(archivePlanState)
    const revertedState = restoreArchivePreviewHistorySnapshot(previousSnapshot)
    setArchiveUndoStack((current) => current.slice(0, -1))
    setArchiveRedoStack((current) => [...current, currentSnapshot])
    setLatestArchiveChange(latestArchiveChangeBetween(archivePlanState, revertedState))
    setDeepSeekArchiveRunSnapshot(null)
    setArchivePreviewAlertMessages([])
    setPendingUnclassifiedDecision(null)
  }

  function redoArchivePreviewChanges() {
    if (!archivePlanState || archiveRedoStack.length === 0 || deepSeekArchiveRunning) {
      return
    }

    const nextSnapshot = archiveRedoStack[archiveRedoStack.length - 1]
    const currentSnapshot = createArchivePreviewHistorySnapshot(archivePlanState)
    const restoredState = restoreArchivePreviewHistorySnapshot(nextSnapshot)
    setArchiveRedoStack((current) => current.slice(0, -1))
    setArchiveUndoStack((current) => [...current, currentSnapshot])
    setLatestArchiveChange(latestArchiveChangeBetween(archivePlanState, restoredState))
    setPendingUnclassifiedDecision(null)
  }

  function setPreviewScopedPendingItemsStaged(selected: boolean) {
    if (deepSeekArchiveRunning || !archivePlanState) {
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

    recordArchivePreviewHistory(archivePlanState)
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

  async function executeOldFavoritePlan() {
    if (!preview || deepSeekArchiveRunning) {
      return
    }

    if (getOldFavoriteRuntimeValue<OldFavoriteExecutionPhase>('oldFavoriteExecutionPhase', 'idle') !== 'idle') {
      return
    }

    if (!setOldFavoriteRuntimeValue('oldFavoriteExecutionPhase', 'running')) {
      return
    }
    setOldFavoriteExecutionConfirming(false)
    setOldFavoriteExecutionProgress(null)
    setSaveStatus(null)
    setStatus('正在整理中，请耐心等待。')
    onOldFavoriteExecutionStateChange?.('running')
    try {
      const nextLedgers = buildLedgersToSave()
      const saveResult = await onSaveLedgers(nextLedgers)
      setSaveStatus(saveStatusMessage(saveResult))
      setActiveLedgerId(null)
      setActiveLedgerIndex(null)
      setActiveLedgerSavedSnapshot(null)

      const saveResultWithLedgers = saveResult as
        | (AssistantAutomationResult & { ledgers?: FavoriteLedger[] })
        | undefined
      const savedLedgers = Array.isArray(saveResultWithLedgers?.ledgers)
        ? saveResultWithLedgers.ledgers
        : nextLedgers
      const selectedItems = (
        archivePlanState
          ? buildSelectedOldFavoritePlanItems({
              state: archivePlanState,
              items: selectableOldFavoriteItems,
              ledgers: ledgersWithOldFavoriteTargetFolders(savedLedgers, selectableOldFavoriteItems)
            })
          : selectedOldFavoritePlanItems
      ).filter(
        (item) => item.targetFolderId || item.selectedCandidateTarget
      )
      const targetLimit = deepSeekArchiveMultiLimit(favoriteArchiveMultiMode)
      if (
        selectedItems.some(
          (item) => item.reorganizeProtected && (item.desiredTargetFolderIds?.length ?? 0) > targetLimit
        )
      ) {
        setStatus(`当前设置最多允许 ${targetLimit} 个 Bilimi 收藏夹，请调整后再确认。`)
        setOldFavoriteExecutionPhase('idle')
        return
      }
      if (selectedItems.length === 0) {
        setStatus('收藏夹已同步，请重新扫描旧藏后再确认整理。')
        setOldFavoriteExecutionPhase('idle')
        return
      }

      setOldFavoriteExecutionProgress({ completed: 0, total: selectedItems.length })
      onOldFavoriteStatusUpdate?.({
        label: `确认执行 0/${selectedItems.length}`,
        message: '正在确认执行旧藏整理。',
        tone: 'running'
      })
      const results: OldFavoriteExecutionResult[] = []
      const successfulTargetKeys = new Set<string>()
      for (const [index, item] of selectedItems.entries()) {
        const result = (await onExecuteOldFavoritePlan([item])) as OldFavoriteExecutionResult
        results.push(result)
        if (result.ok !== false) {
          successfulTargetKeys.add(archivePlanTargetKey(item))
        }
        setOldFavoriteExecutionProgress({ completed: index + 1, total: selectedItems.length })
        onOldFavoriteStatusUpdate?.({
          label: `确认执行 ${index + 1}/${selectedItems.length}`,
          message: '正在确认执行旧藏整理。',
          tone: 'running'
        })
        if (result.paused) {
          break
        }
        await paceOldFavoriteExecution(index + 1, index < selectedItems.length - 1)
      }
      if (archivePlanState && successfulTargetKeys.size > 0) {
        const confirmedAt = new Date().toISOString()
        const records = buildConfirmedArchiveCorrectionRecords({
          state: archivePlanState,
          preview,
          successfulTargetKeys,
          confirmedAt
        })

        if (records.length > 0) {
          onConfirmArchiveCorrections?.(records)
        }
      }
      if (preview.scanContext) {
        const protectionRecords = buildConfirmedArchiveProtectionRecords({
          accountMid: preview.scanContext.accountMid,
          selectedItems,
          results,
          confirmedAt: new Date().toISOString()
        })
        if (protectionRecords.length > 0) {
          onConfirmArchiveProtections?.(protectionRecords)
        }
      }
      const failedCount = results.filter((result) => result.ok === false).length
      const partialCount = results.filter((result) => result.ok === false && result.partial).length
      const completeFailureCount = failedCount - partialCount
      const paused = results.some((result) => result.paused)
      setStatus(
        paused
          ? '本次整理已暂停，请稍后再继续。'
          : failedCount > 0
          ? `本次整理已结束，${results.length - failedCount} 条成功，${partialCount} 条部分完成，${completeFailureCount} 条失败。`
          : '本次整理已结束。'
      )
      setOldFavoriteExecutionPhase('awaiting-acknowledgement')
      const finalStatus = paused
        ? { label: '整理已暂停', message: '本次整理已暂停，请稍后再继续。', tone: 'warn' as const }
        : failedCount > 0
        ? partialCount > 0 || failedCount === results.length
          ? {
              label: '整理未完全成功',
              message: `本次整理已结束，${results.length - failedCount} 条成功，${partialCount} 条部分完成，${completeFailureCount} 条失败。`,
              tone: 'error' as const
            }
          : {
              label: '整理有遗漏',
              message: `本次整理已结束，${results.length - failedCount} 条成功，${completeFailureCount} 条未完成。`,
              tone: 'warn' as const
            }
        : { label: '整理完成', message: '本次整理已结束。', tone: 'ok' as const }
      onOldFavoriteStatusUpdate?.({
        ...finalStatus
      })
      onOldFavoriteExecutionStateChange?.('finished')
    } catch (error) {
      setStatus(`整理旧藏未完成：${errorMessage(error)}`)
      setOldFavoriteExecutionPhase('awaiting-acknowledgement')
      onOldFavoriteStatusUpdate?.({
        label: '整理失败',
        message: `整理旧藏未完成：${errorMessage(error)}`,
        tone: 'error'
      })
      onOldFavoriteExecutionStateChange?.('finished')
    }
  }

  const ledgersToDisplay = visibleLedgers(draftLedgers, ledgerListExpanded)
  const allLedgersSelected = draftLedgers.length > 0 && draftLedgers.every(ledgerEnabled)
  const bulkToggleLabel = allLedgersSelected ? '取消全选' : '全选'
  const canToggleLedgerList = draftLedgers.length > ledgersToDisplay.length || ledgerListExpanded
  const selectableOldFavoriteItems = useMemo(
    () =>
      preview?.items
        .filter((item) =>
          (item.sourceFolderTitles ?? [item.sourceFolderTitle]).some((title) =>
            selectedOldFavoriteSourceFolderTitles.has(title)
          )
        )
        .map((item) => itemWithSelectedCandidateTargets(item, selectedCandidateKeys)) ?? [],
    [preview, selectedOldFavoriteSourceFolderTitles, selectedCandidateKeys]
  )
  const oldFavoriteSourceFolders = useMemo<OldFavoriteSourceFolderSummary[]>(() => {
    const sourceFolderCounts = new Map<string, number>()
    for (const item of preview?.items ?? []) {
      sourceFolderCounts.set(item.sourceFolderTitle, (sourceFolderCounts.get(item.sourceFolderTitle) ?? 0) + 1)
    }
    for (const folder of preview?.insights?.sourceFolders ?? []) {
      sourceFolderCounts.set(folder.name, folder.count)
    }
    for (const item of baseScanPreview?.scanContext?.protectedVideos ?? []) {
      for (const title of item.sourceFolderTitles ?? []) {
        sourceFolderCounts.set(title, (sourceFolderCounts.get(title) ?? 0) + 1)
      }
    }

    return Array.from(sourceFolderCounts, ([name, count]) => ({ name, count }))
  }, [baseScanPreview, preview])
  const protectedOldFavoriteCount = baseScanPreview?.scanContext?.protectedVideos.length ?? 0
  const protectedArchiveHealthCounts = useMemo(() => {
    const counts = { complete: 0, incomplete: 0, invalid: 0 }
    for (const item of baseScanPreview?.scanContext?.protectedVideos ?? []) {
      if (reorganizedProtectedAids.has(item.aid)) continue
      if (!(item.sourceFolderTitles ?? []).some((title) => selectedOldFavoriteSourceFolderTitles.has(title))) continue
      counts[item.archiveHealth ?? 'complete'] += 1
    }
    return counts
  }, [baseScanPreview, reorganizedProtectedAids, selectedOldFavoriteSourceFolderTitles])
  const selectedProtectedOldFavorites = useMemo(
    () =>
      (baseScanPreview?.scanContext?.protectedVideos ?? []).filter(
        (item) =>
          !reorganizedProtectedAids.has(item.aid) &&
          (item.sourceFolderTitles ?? []).some((title) =>
            selectedOldFavoriteSourceFolderTitles.has(title)
          )
      ),
    [baseScanPreview, reorganizedProtectedAids, selectedOldFavoriteSourceFolderTitles]
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
      const index = Math.max(
        0,
        (video.sourceFolderTitles ?? []).findIndex((title) =>
          selectedOldFavoriteSourceFolderTitles.has(title)
        )
      )
      const id = video.sourceFolderIds?.[index] ?? `protected-${video.aid}`
      const title = video.sourceFolderTitles?.[index] ?? '已整理收藏'
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
    const nextPreview = createFavoriteLedgerPreview({
      ledgers: draftLedgers,
      sourceFolders: [...context.activeSourceFolders, ...protectedVideosAsSourceFolders(aids)],
      targetMembership: context.targetMembership,
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
    const next = new Set(reorganizedProtectedAids)
    for (const item of selectedProtectedOldFavorites) next.add(item.aid)
    setReorganizedProtectedAids(next)
    setProtectedReorganizationConfirming(false)
    applyProtectedReorganization(next)
  }

  function confirmAbnormalProtectedReorganization() {
    const next = new Set(reorganizedProtectedAids)
    for (const item of selectedAbnormalProtectedOldFavorites) next.add(item.aid)
    setReorganizedProtectedAids(next)
    setAbnormalProtectionReorganizationConfirming(false)
    applyProtectedReorganization(next)
  }

  function restoreProtectedFavorites() {
    if (!baseScanPreview) return
    setReorganizedProtectedAids(new Set())
    setPreview(baseScanPreview)
    setArchivePlanState(createArchivePlanStateFromPreviewItems(baseScanPreview.items, selectedCandidateKeys))
  }
  const oldFavoriteUserSourceFolders = useMemo(
    () => oldFavoriteSourceFolders.filter((folder) => !isBilimiManagedLedgerName(folder.name)),
    [oldFavoriteSourceFolders]
  )
  const oldFavoriteBilimiSourceFolders = useMemo(
    () => oldFavoriteSourceFolders.filter((folder) => isBilimiManagedLedgerName(folder.name)),
    [oldFavoriteSourceFolders]
  )
  const archiveExecutionLedgers = useMemo(
    () => ledgersWithOldFavoriteTargetFolders(draftLedgers, selectableOldFavoriteItems),
    [draftLedgers, selectableOldFavoriteItems]
  )
  const selectedOldFavoritePlanItems = useMemo(
    () =>
      buildSelectedOldFavoritePlanItems({
        state: archivePlanState,
        items: selectableOldFavoriteItems,
        ledgers: archiveExecutionLedgers
      }),
    [archiveExecutionLedgers, archivePlanState, selectableOldFavoriteItems]
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
  const protectedReconciliationSummary = useMemo(() => {
    let addCount = 0
    let removeCount = 0
    let unchangedCount = 0
    for (const item of selectedOldFavoritePlanItems.filter((item) => item.reorganizeProtected)) {
      const desiredFolderIds = uniqueLedgerIds(item.desiredTargetFolderIds ?? [])
      const currentFolderIds = uniqueLedgerIds(item.currentBilimiFolderIds ?? [])
      const hasAdded = desiredFolderIds.some((folderId) => !currentFolderIds.includes(folderId))
      const hasRemoved = currentFolderIds.some((folderId) => !desiredFolderIds.includes(folderId))
      if (hasAdded) addCount += 1
      if (hasRemoved) removeCount += 1
      if (!hasAdded && !hasRemoved) unchangedCount += 1
    }

    return {
      total: selectedOldFavoritePlanItems.filter((item) => item.reorganizeProtected).length,
      addCount,
      removeCount,
      unchangedCount
    }
  }, [selectedOldFavoritePlanItems])
  const previewScopedPendingItems = useMemo(
    () =>
      selectableOldFavoriteItems.filter((item) => {
        const planItem = archivePlanState?.items.find(
          (candidate) =>
            candidate.aid === item.aid && candidate.sourceFolderTitle === item.sourceFolderTitle
        )
        return !item.alreadyInTarget && (planItem ? planItem.currentTargetLedgerIds.length === 0 : isPreviewScopedPendingItem(item))
      }),
    [archivePlanState, selectableOldFavoriteItems]
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
  const autoSelectedOldFavoriteCount =
    selectableOldFavoriteItems.filter((item) => item.selected && !item.alreadyInTarget && !item.reviewRequired)
      .length ?? 0
  const reviewRequiredOldFavoriteCount = selectableOldFavoriteItems.filter((item) => item.reviewRequired).length ?? 0
  const alreadyInTargetOldFavoriteCount =
    selectableOldFavoriteItems.filter((item) => item.alreadyInTarget).length ?? 0
  const skippedSourceFolderCount = preview?.skippedSourceFolderTitles.length ?? 0
  const tagDetailFailureCount = preview?.scanDiagnostics?.tagDetailFailures ?? 0
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
      const planItem = archivePlanState?.items.find(
        (candidate) =>
          candidate.aid === item.aid && candidate.sourceFolderTitle === item.sourceFolderTitle
      )
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
        if (archiveRedoStack.length === 0 || deepSeekArchiveRunning) {
          return
        }

        event.preventDefault()
        redoArchivePreviewChanges()
        return
      }

      if (!archivePlanState || deepSeekArchiveRunning || archiveUndoStack.length === 0) {
        return
      }

      event.preventDefault()
      undoArchivePreviewChanges()
    }

    document.addEventListener('keydown', handleArchiveShortcut)
    return () => document.removeEventListener('keydown', handleArchiveShortcut)
  }, [
    archivePlanState,
    archiveRedoStack,
    archiveUndoStack,
    deepSeekArchiveRunning,
    oldFavoriteGuideMode,
    oldFavoriteStep
  ])

  function oldFavoriteCandidateDetailText(candidate: FavoriteLedgerCandidate) {
    return oldFavoriteCandidateRecommendationText(candidate)
  }

  function oldFavoriteCandidateRecommendationText(candidate: FavoriteLedgerCandidate) {
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

    return archiveExecutionLedgers.find((ledger) => ledger.id === ledgerId)?.displayName ?? ledgerId
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
    const movedItems = nextState.items.filter((nextItem) => {
      const previousItem = previousState.items.find((item) => item.itemKey === nextItem.itemKey)
      return previousItem && !sameLedgerIds(previousItem.currentTargetLedgerIds, nextItem.currentTargetLedgerIds)
    })
    const latestItem = movedItems[movedItems.length - 1]
    if (!latestItem) {
      return null
    }

    const itemChanges: ArchivePreviewLatestChange['itemChanges'] = {}
    for (const nextItem of movedItems) {
      const previousMovedItem = previousState.items.find((item) => item.itemKey === nextItem.itemKey)
      itemChanges[nextItem.itemKey] = {
        title: nextItem.title,
        previousTargetText: previousMovedItem
          ? archivePlanTargetText(previousMovedItem, {
              inboxAsUnclassified: options.inboxAsUnclassified
            })
          : '未分类',
        nextTargetText: archivePlanTargetText(nextItem)
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

    for (const nextItem of nextState.items) {
      const previousItem = previousState.items.find((item) => item.itemKey === nextItem.itemKey)
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

  function jumpToLatestArchiveChange() {
    if (latestArchiveChange?.kind !== 'single') {
      return
    }

    document
      .querySelector<HTMLElement>('[data-latest-change="true"]')
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
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
            disabled={deepSeekArchiveRunning}
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
        {renderOriginalArchiveSourceNotice(item, areaLedgerId)}
      </div>
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
    const selectedScopeLabel = deepSeekArchiveScopeLabel(deepSeekArchiveMode)

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
          title={`当前选择：${selectedScopeLabel}`}
          disabled={deepSeekArchiveRunning}
          onClick={() => setDeepSeekArchiveScopeOpen((open) => !open)}
        >
          <span>整理范围</span>
          <span className="favorite-ledger-panel__deepseek-archive-scope-arrow" aria-hidden="true" />
        </button>
        {deepSeekArchiveScopeOpen ? (
          <div
            className="favorite-ledger-panel__deepseek-archive-scope-menu"
            role="menu"
            aria-label="DeepSeek 辅助整理范围"
          >
            {DEEPSEEK_ARCHIVE_SCOPE_OPTIONS.map((option) => (
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
        ) : null}
      </div>
    )
  }

  function renderOldFavoriteSourceFolder(folder: OldFavoriteSourceFolderSummary) {
    return (
      <li key={folder.name}>
        {oldFavoriteGuideMode === 'organize' ? (
          <label>
            <input
              type="checkbox"
              aria-label={`整理来源 ${folder.name}`}
              checked={selectedOldFavoriteSourceFolderTitles.has(folder.name)}
              onChange={() => toggleOldFavoriteSourceFolder(folder.name)}
            />
            <span>
              {folder.name} {folder.count}
            </span>
          </label>
        ) : (
          <>
            {folder.name} {folder.count}
          </>
        )}
      </li>
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
            disabled={busy}
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
            disabled={busy}
            onClick={() => void startOrganizingOldFavorites()}
            icon={hintPetUrl}
            iconAlt="小咪整理旧藏"
            badge="整"
            label="整理旧藏"
            description="扫描旧藏，确认后整理到 bilimi 收藏夹里"
          />
        </div>
      </div>

      {missingLedgerIds.length > 0 ? (
        <p className="favorite-ledger-panel__notice">
          尚缺 {missingLedgerIds.map((id) => ledgerNamesById[id] ?? id).join('、')}。
        </p>
      ) : null}

      {status || saveStatus ? (
        <p className="favorite-ledger-panel__status" role="status">
          {status ?? saveStatus}
        </p>
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
            <button type="button" disabled={busy || deepSeekArchiveRunning} onClick={resetLedgers}>
              重置
            </button>
            <button type="button" disabled={busy || deepSeekArchiveRunning} onClick={toggleAllLedgers}>
              {bulkToggleLabel}
            </button>
            <button type="button" disabled={busy || deepSeekArchiveRunning} onClick={() => void saveLedgers()}>
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
            const isLedgerEnabled = ledgerEnabled(ledger)
            const ledgerLabel = stripBilimiLedgerPrefix(ledger.displayName)
            const selectLedgerLabel = ledgerLabel || '新建收藏夹'
            return (
              <div
                key={`${ledger.id}-${ledgerIndex}`}
                className="favorite-ledger-panel__chip-item"
                draggable
                data-dragging={draggedLedgerId === ledger.id}
                data-drop-target={dragTargetLedgerId === ledger.id}
                onDragStart={(event) => handleLedgerDragStart(event, ledger.id)}
                onDragOver={(event) => handleLedgerDragOver(event, ledger.id)}
                onDrop={(event) => handleLedgerDrop(event, ledger.id)}
                onDragEnd={finishLedgerDrag}
              >
                <button
                  type="button"
                  aria-label={ledgerLabel ? undefined : `选择${selectLedgerLabel}`}
                  aria-pressed={isLedgerEnabled}
                  data-active={activeLedger?.id === ledger.id && activeLedgerIndex === ledgerIndex}
                  onClick={() => selectLedger(ledger, ledgerIndex)}
                >
                  {ledgerLabel}
                </button>
                <button
                  type="button"
                  className="favorite-ledger-panel__chip-action"
                  aria-label={`${isLedgerEnabled ? '移出同步' : '加入同步'} ${ledger.displayName}`}
                  data-enabled={isLedgerEnabled}
                  onClick={() => toggleLedger(ledger.id)}
                >
                  {isLedgerEnabled ? '✓' : '+'}
                </button>
              </div>
            )
          })}
        </div>
        <div className="favorite-ledger-panel__list-toggle">
          <button type="button" disabled={busy} onClick={addBlankLedger}>
            新建收藏夹
          </button>
          {canToggleLedgerList ? (
            <button
              type="button"
              aria-expanded={ledgerListExpanded}
              disabled={busy}
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
            <strong>正在编辑：{activeLedger.displayName}</strong>
            <div className="favorite-ledger-panel__editor-actions">
              <button type="button" disabled={busy} onClick={saveActiveLedgerDraft}>
                保存
              </button>
              {!activeLedger.isDefault ? (
                <button
                  type="button"
                  aria-label={`删除 ${activeLedger.displayName}`}
                  onClick={() => deleteLedger(activeLedger.id)}
                  disabled={!canDeleteLedger(activeLedger)}
                >
                  删除
                </button>
              ) : null}
            </div>
          </div>
        <label>
          <span className="favorite-ledger-panel__name-label">
            <span>册名</span>
            <select
              aria-label="收藏夹种类"
              disabled={activeLedger.isDefault}
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
                value={stripBilimiLedgerPrefix(activeLedger.displayName)}
                onChange={(event) => updateActiveLedgerName(event.currentTarget.value)}
              />
            </span>
          ) : (
            <input
              aria-label="册名"
              value={activeLedger.displayName}
              onChange={(event) => updateActiveLedgerName(event.currentTarget.value)}
            />
          )}
        </label>
          <label>
            {ruleFieldLabel(activeLedgerRuleType)}
            <textarea
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
        <div className="favorite-ledger-panel__editor-placeholder" aria-hidden="true" />
      )}

      </div>

      {preview ? (
        <section
          className="favorite-ledger-panel__old-favorites-guide"
          aria-label={oldFavoriteGuideMode === 'setup' ? '备册向导' : '整理旧藏向导'}
        >
          <div className="favorite-ledger-panel__guide-header">
            <span className="favorite-ledger-panel__section-title">
              <h3 title={OLD_FAVORITE_GUIDE_HINT}>
                {oldFavoriteGuideMode === 'setup' ? '备册' : '整理旧藏'}
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
            {oldFavoriteGuideHintExpanded ? (
              <p className="favorite-ledger-panel__guide-hint">{OLD_FAVORITE_GUIDE_HINT}</p>
            ) : null}
            <nav className="favorite-ledger-panel__guide-steps" aria-label="整理旧藏步骤">
              {OLD_FAVORITE_GUIDE_STEPS.map((step) => (
                <button
                  key={step.id}
                  type="button"
                  aria-current={oldFavoriteStep === step.id ? 'step' : undefined}
                  disabled={deepSeekArchiveRunning && oldFavoriteStep !== step.id}
                  onClick={() => switchOldFavoriteStep(step.id)}
                >
                  {step.label}
                </button>
              ))}
            </nav>
          </div>

          {oldFavoriteStep === 'scan' ? (
            <section className="favorite-ledger-panel__scan-overview" aria-label="扫描概览">
              <h4 className="favorite-ledger-panel__step-title">扫描概览</h4>
              {preview.insights ? (
                <>
                  <p className="favorite-ledger-panel__step-note">
                    {preview.scanContext
                      ? `共扫描 ${totalScannedOldFavoriteCount} 条旧藏，其中 ${activeOldFavoriteCount} 条进入本轮整理，${protectedOldFavoriteCount} 条之前已整理，本轮保持原归档。`
                      : `共扫描 ${preview.insights.totalVideos} 条旧藏，生成 ${preview.insights.candidateLedgers.length} 个候选收藏夹`}
                  </p>
                  {tagDetailFailureCount > 0 ? (
                    <p className="favorite-ledger-panel__scan-warning">
                      标签补取失败 {tagDetailFailureCount} 条，高频标签候选可能偏少；稍后重扫会更准。
                    </p>
                  ) : null}
                  <hr className="favorite-ledger-panel__step-divider" aria-hidden="true" />
                </>
              ) : null}
              <section className="favorite-ledger-panel__insights" aria-label="基础数据">
                <h4>基础数据</h4>
                {preview.scanContext && protectedOldFavoriteCount > 0 && reorganizedProtectedAids.size === 0 ? (
                  <div className="favorite-ledger-panel__protected-summary">
                    <small>想按当前规则重新判断以前整理过的视频？可将当前勾选来源中的全部已整理视频重新纳入计算。</small>
                    <button
                      type="button"
                      aria-label={`重新整理全部已整理视频 ${selectedProtectedOldFavorites.length} 条`}
                      disabled={selectedProtectedOldFavorites.length === 0}
                      onClick={() => setProtectedReorganizationConfirming(true)}
                    >
                      重新整理全部已整理视频 {selectedProtectedOldFavorites.length} 条
                    </button>
                    {protectedReorganizationConfirming ? (
                      <div
                        className="favorite-ledger-panel__execution-dialog favorite-ledger-panel__execution-dialog--inline"
                        role="alertdialog"
                        aria-modal="true"
                        aria-label="确认重新整理已整理收藏？"
                      >
                        <h4>确认重新整理已整理收藏？</h4>
                        <p>
                          将把当前勾选来源中全部已整理的 {selectedProtectedOldFavorites.length} 条重新加入本轮判断，按当前规则重新计算，不受以前分类限制。用户原有普通收藏不会改变。
                        </p>
                        <div className="favorite-ledger-panel__execution-dialog-actions">
                          <button type="button" onClick={() => setProtectedReorganizationConfirming(false)}>取消</button>
                          <button type="button" onClick={confirmProtectedReorganization}>继续重新整理</button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className="favorite-ledger-panel__guide-metrics">
                  <article>
                    <span>共扫描</span>
                    <strong>{preview.insights?.totalVideos ?? preview.items.length}</strong>
                  </article>
                  <article>
                    <span>可自动归档</span>
                    <strong>{autoSelectedOldFavoriteCount}</strong>
                  </article>
                  <article>
                    <span>需复核</span>
                    <strong>{reviewRequiredOldFavoriteCount}</strong>
                  </article>
                  <article>
                    <span>待分类</span>
                    <strong>{previewScopedPendingItems.length}</strong>
                  </article>
                  <article>
                    <span>{preview.scanContext ? '已整理跳过' : '已存在'}</span>
                    <strong>{preview.scanContext ? protectedOldFavoriteCount : alreadyInTargetOldFavoriteCount}</strong>
                  </article>
                  <article>
                    <span>跳过来源</span>
                    <strong>{skippedSourceFolderCount}</strong>
                  </article>
                </div>
                {preview.scanContext && (reorganizedProtectedAids.size > 0 || hasSelectedAbnormalProtectedOldFavorites) ? (
                  <div className="favorite-ledger-panel__protected-summary">
                    {reorganizedProtectedAids.size > 0 ? (
                      <>
                        <span>已重新纳入 {reorganizedProtectedAids.size}</span>
                        <button type="button" onClick={restoreProtectedFavorites}>恢复保护</button>
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
                              disabled={selectedAbnormalProtectedOldFavorites.length === 0}
                              onClick={() => setAbnormalProtectionReorganizationConfirming(true)}
                            >
                              重新整理状态有变化的 {selectedAbnormalProtectedOldFavorites.length} 条
                            </button>
                            {abnormalProtectionReorganizationConfirming ? (
                              <div
                                className="favorite-ledger-panel__execution-dialog favorite-ledger-panel__execution-dialog--inline"
                                role="alertdialog"
                                aria-modal="true"
                                aria-label="确认重新整理状态有变化的视频？"
                              >
                                <h4>确认重新整理状态有变化的视频？</h4>
                                <p>
                                  将把当前勾选来源中仅保留部分原归档或已不在原归档的 {selectedAbnormalProtectedOldFavorites.length} 条重新加入本轮判断，并按当前启用的收藏夹规则重新整理。用户原有普通收藏不会改变。
                                </p>
                                <div className="favorite-ledger-panel__execution-dialog-actions">
                                  <button type="button" onClick={() => setAbnormalProtectionReorganizationConfirming(false)}>取消</button>
                                  <button type="button" onClick={confirmAbnormalProtectedReorganization}>继续重新整理</button>
                                </div>
                              </div>
                            ) : null}
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
              </section>
              {preview.insights ? (
                <>
                  <hr className="favorite-ledger-panel__step-divider" aria-hidden="true" />
                  <div className="favorite-ledger-panel__insight-columns">
                    <div>
                      <strong>扫描收藏夹</strong>
                      {oldFavoriteUserSourceFolders.length > 0 ? (
                        <div>
                          <small>用户收藏夹</small>
                          <ul>{oldFavoriteUserSourceFolders.map(renderOldFavoriteSourceFolder)}</ul>
                        </div>
                      ) : null}
                      {oldFavoriteBilimiSourceFolders.length > 0 ? (
                        <div>
                          <small>bilimi 工作夹</small>
                          <ul>{oldFavoriteBilimiSourceFolders.map(renderOldFavoriteSourceFolder)}</ul>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </>
              ) : null}
            </section>
          ) : null}

          {oldFavoriteStep === 'generated' ? (
            <section className="favorite-ledger-panel__candidates" aria-label="专属收藏夹候选">
              <h4 className="favorite-ledger-panel__step-title">推荐收藏夹</h4>
              <p className="favorite-ledger-panel__step-note">确认执行后，会把已勾选候选同步到 B 站收藏夹里。</p>
              <hr className="favorite-ledger-panel__step-divider" aria-hidden="true" />
              <div className="favorite-ledger-panel__candidate-section">
                <div className="favorite-ledger-panel__candidate-section-heading">
                  <h5>专属 UP 追更</h5>
                  <label>
                    <input
                      type="checkbox"
                      aria-label="全选 专属 UP 追更"
                      checked={allFollowUpCandidatesSelected}
                      disabled={deepSeekArchiveRunning || !oldFavoriteFollowUpCandidates.length}
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
                  const candidateLabel = favoriteLedgerDisplayShortName(candidate.displayName)

                  return (
                    <article key={`${candidate.kind}-${candidate.sourceName}`} title={candidateLabel}>
                      <label>
                        <input
                          type="checkbox"
                          aria-label={candidate.displayName}
                          checked={isSelected}
                          disabled={
                            deepSeekArchiveRunning || (!isSelected && alreadyHasLedger(ledgers, candidate.displayName))
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
                      disabled={deepSeekArchiveRunning || !oldFavoriteTagCandidates.length}
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
                    const candidateLabel = favoriteLedgerDisplayShortName(candidate.displayName)

                    return (
                      <article key={`${candidate.kind}-${candidate.sourceName}`} title={candidateLabel}>
                        <label>
                          <input
                            type="checkbox"
                            aria-label={candidate.displayName}
                            checked={isSelected}
                            disabled={
                              deepSeekArchiveRunning ||
                              (!isSelected && alreadyHasLedger(ledgers, candidate.displayName))
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
            </section>
          ) : null}

          {oldFavoriteStep === 'preview' ? (
            <div className="favorite-ledger-panel__preview">
              <div className="favorite-ledger-panel__preview-topbar">
                <div>
                  <h4 className="favorite-ledger-panel__step-title">归档预览</h4>
                  <p className="favorite-ledger-panel__step-note">增删收藏夹或修改标签后，回到归档预览会自动更新</p>
                </div>
              </div>
              {oldFavoriteGuideMode === 'organize' ? (
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
                                  : deepSeekArchiveDisabled
                              }
                              onClick={() =>
                                deepSeekArchiveRunning
                                  ? cancelDeepSeekArchiveOrganization()
                                  : void organizeOldFavoritesWithDeepSeek()
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
                          <div
                            className="favorite-ledger-panel__deepseek-result"
                            data-open={deepSeekArchiveSummaryOpen ? 'true' : 'false'}
                          >
                            <button
                              type="button"
                              className="favorite-ledger-panel__deepseek-archive-status favorite-ledger-panel__deepseek-result-trigger"
                              aria-label={`DeepSeek 整理结果：${deepSeekArchiveResultSummary.successCount} 条已应用，${deepSeekArchiveResultSummary.failedCount} 条未应用`}
                              title={`DeepSeek 整理完成：已应用 ${deepSeekArchiveResultSummary.successCount} 条，未应用 ${deepSeekArchiveResultSummary.failedCount} 条`}
                              aria-expanded={deepSeekArchiveSummaryOpen}
                              onClick={() => setDeepSeekArchiveSummaryOpen((open) => !open)}
                            >
                              DeepSeek 整理完成：已应用 {deepSeekArchiveResultSummary.successCount} 条，未应用{' '}
                              {deepSeekArchiveResultSummary.failedCount} 条
                            </button>
                            <div className="favorite-ledger-panel__deepseek-result-tooltip" role="tooltip">
                              <strong>本次 DeepSeek 整理结果</strong>
                              <span>
                                共处理 {deepSeekArchiveResultSummary.successCount + deepSeekArchiveResultSummary.failedCount} 条视频。
                              </span>
                              <span>
                                <b>已应用 {deepSeekArchiveResultSummary.successCount} 条：</b>
                                已采用 DeepSeek 建议并更新归档预览，尚未操作 B 站收藏夹。
                              </span>
                              <span>
                                <b>未应用 {deepSeekArchiveResultSummary.failedCount} 条：</b>
                                未采用 DeepSeek 建议，继续保持整理前的归档状态。
                              </span>
                              {deepSeekArchiveNonApplicationRows.map(([label, count]) => (
                                <span key={label}>{label}：{count} 条</span>
                              ))}
                            </div>
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
                            <span className="favorite-ledger-panel__archive-history-select-control">
                              <select
                                aria-label="改动记录"
                                disabled={!latestArchiveChange}
                                value=""
                                onChange={(event) => {
                                  if (event.currentTarget.value === 'latest') {
                                    jumpToLatestArchiveChange()
                                  }
                                }}
                              >
                                {!latestArchiveChange ? (
                                  <option value="">暂无改动记录</option>
                                ) : (
                                  <>
                                    <option value="">最近改动</option>
                                    <option value="latest">{archiveChangeRecordOptionText(latestArchiveChange)}</option>
                                  </>
                                )}
                              </select>
                            </span>
                          </label>
                          <button
                            type="button"
                            className="favorite-ledger-panel__archive-history-button"
                            disabled={deepSeekArchiveRunning || archiveUndoStack.length === 0}
                            onClick={undoArchivePreviewChanges}
                          >
                            撤销本次改动
                          </button>
                          <button
                            type="button"
                            className="favorite-ledger-panel__archive-history-button"
                            disabled={deepSeekArchiveRunning || archiveRedoStack.length === 0}
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
                          disabled={deepSeekArchiveRunning}
                          onChange={(event) =>
                            setPreviewScopedPendingItemsStaged(event.currentTarget.checked)
                          }
                        />
                        <span>全部存入暂存</span>
                      </label>
                    </header>
                    <div className="favorite-ledger-panel__preview-videos" aria-label="未匹配到合适分类视频">
                      {previewScopedPendingItems.length > 0 ? (
                        previewScopedPendingItems.map((item) => (
                          <article
                            key={`pending-${item.sourceFolderTitle}-${item.aid}`}
                            data-latest-change={
                              latestArchiveChange?.itemChanges[archivePlanItemKey(item)] ? 'true' : undefined
                            }
                          >
                            <div
                              className="favorite-ledger-panel__preview-video favorite-ledger-panel__preview-video--pending"
                            >
                              {renderOldFavoriteVideoTitle(item)}
                              {renderOldFavoritePreviewMeta(item)}
                            </div>
                            {renderOldFavoriteArchiveControls(item, 'unclassified')}
                          </article>
                        ))
                      ) : (
                        <p>暂无需要处理的旧藏。</p>
                      )}
                    </div>
                  </section>
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
                              disabled={deepSeekArchiveRunning}
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
                        <div
                          className="favorite-ledger-panel__preview-videos"
                          aria-label={`${group.displayName} 视频`}
                        >
                          {group.entries.map(({ item, target, selected, changedByDeepSeek }) => (
                            <article
                              key={`${group.ledgerId}-${item.sourceFolderTitle}-${item.aid}`}
                              data-latest-change={
                                latestArchiveChange?.itemChanges[archivePlanItemKey(item)] ? 'true' : undefined
                              }
                            >
                              <div
                                className={[
                                  'favorite-ledger-panel__preview-video',
                                  selected ? 'favorite-ledger-panel__preview-video--selected' : '',
                                  changedByDeepSeek
                                    ? 'favorite-ledger-panel__preview-video--deepseek'
                                    : ''
                                ]
                                  .filter(Boolean)
                                  .join(' ')}
                                data-selected={selected}
                                aria-pressed={selected}
                                aria-disabled={deepSeekArchiveRunning || target.alreadyInTarget}
                                onClick={() => {
                                  if (!deepSeekArchiveRunning && !target.alreadyInTarget) {
                                    toggleOldFavoriteTarget(item, group.ledgerId)
                                  }
                                }}
                              >
                                {renderOldFavoriteVideoTitle(item)}
                                {renderOldFavoritePreviewMeta(item, target)}
                              </div>
                              {renderOldFavoriteArchiveControls(item, group.ledgerId, target)}
                            </article>
                          ))}
                        </div>
                      </section>
                    )
                  })}
                </div>
              )}
            </div>
          ) : null}

          {pendingUnclassifiedDecision ? (
            <div
              className="favorite-ledger-panel__unclassified-dialog"
              role="alertdialog"
              aria-modal="true"
              aria-label="确认未分类处理"
            >
              <strong>确认未分类处理</strong>
              <p>这个旧藏同时命中了多个收藏夹，要只取消当前收藏夹，还是全部去掉不整理？</p>
              <div className="favorite-ledger-panel__unclassified-dialog-actions">
                <button
                  type="button"
                  onClick={() => confirmPendingUnclassifiedDecision('all')}
                >
                  全部去掉不整理
                </button>
                <button
                  type="button"
                  onClick={() => confirmPendingUnclassifiedDecision('current')}
                >
                  只取消当前收藏夹
                </button>
                <button type="button" onClick={() => setPendingUnclassifiedDecision(null)}>
                  取消
                </button>
              </div>
            </div>
          ) : null}

          {oldFavoriteStep === 'confirm' ? (
            oldFavoriteExecutionConfirming && oldFavoriteGuideMode === 'organize' ? (
              <div
                className="favorite-ledger-panel__execution-dialog"
                role="alertdialog"
                aria-modal="true"
                aria-label="确认开始整理？"
              >
                <h4>确认开始整理？</h4>
                <p>{OLD_FAVORITE_EXECUTION_CONFIRM_MESSAGE}</p>
                <p>
                  本次将整理 {selectedOldFavoriteVideoCount} 条视频，每条视频最多存入{' '}
                  {deepSeekArchiveMultiLimit(favoriteArchiveMultiMode)} 个 Bilimi 收藏夹。
                </p>
                {archiveMultiModeChange ? (
                  <p className="favorite-ledger-panel__execution-dialog-change-note">
                    收藏夹数量设置已从“{favoriteArchiveMultiModeLabel(archiveMultiModeChange.from)}”调整为“
                    {favoriteArchiveMultiModeLabel(archiveMultiModeChange.to)}”，归档预览已按新设置更新。
                  </p>
                ) : null}
                <div className="favorite-ledger-panel__execution-dialog-actions">
                  <button
                    type="button"
                    onClick={() => setOldFavoriteExecutionConfirming(false)}
                  >
                    返回检查
                  </button>
                  <button type="button" onClick={() => void executeOldFavoritePlan()}>
                    开始整理
                  </button>
                </div>
              </div>
            ) : (
              <section className="favorite-ledger-panel__confirm" aria-label="确认整理">
                <h4>确认执行</h4>
                {oldFavoriteGuideMode === 'setup' ? (
                <>
                  <p>确认后会把当前勾选收藏夹同步到 B 站。</p>
                  <button type="button" disabled={busy} onClick={() => void saveLedgers()}>
                    确认同步
                  </button>
                </>
              ) : (
                <>
                  <p>已选择 {selectedOldFavoritePlanItems.length} 条归档任务</p>
                  {selectedOldFavoritePlanItems.length === 0 ? (
                    <p>本轮没有需要执行的归档任务，点击确认整理后结束本轮整理</p>
                  ) : null}
                  {oldFavoriteTargetWarning ? (
                    <p className="favorite-ledger-panel__confirm-warning" role="alert">
                      {oldFavoriteTargetWarning}
                    </p>
                  ) : null}
                  {protectedReconciliationSummary.total > 0 ? (
                    <>
                      <p>
                        重新整理 {protectedReconciliationSummary.total} 条：{protectedReconciliationSummary.addCount} 条将加入，
                        {protectedReconciliationSummary.removeCount} 条将移出，{protectedReconciliationSummary.unchangedCount} 条保持当前 Bilimi 归档。
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
                        整理进度 {oldFavoriteExecutionProgress.completed}/{oldFavoriteExecutionProgress.total}
                      </strong>
                      <progress
                        max={oldFavoriteExecutionProgress.total}
                        value={oldFavoriteExecutionProgress.completed}
                        aria-label="整理旧藏进度"
                      />
                    </div>
                  ) : null}
                  <button
                    type="button"
                    disabled={
                      deepSeekArchiveRunning ||
                      (oldFavoriteExecuting ||
                        oldFavoriteExecutionConfirming) &&
                      !oldFavoriteExecutionAwaitingAcknowledgement
                    }
                    onClick={() =>
                      oldFavoriteExecutionAwaitingAcknowledgement
                        ? acknowledgeOldFavoriteExecution()
                        : selectedOldFavoritePlanItems.length === 0
                          ? acknowledgeOldFavoriteExecution()
                          : setOldFavoriteExecutionConfirming(true)
                    }
                  >
                    {oldFavoriteExecutionAwaitingAcknowledgement
                      ? '好的'
                      : oldFavoriteExecuting
                      ? '整理中'
                      : '确认整理'}
                  </button>
                </>
                )}
              </section>
            )
          ) : null}
        </section>
      ) : null}

    </section>
  )
}
