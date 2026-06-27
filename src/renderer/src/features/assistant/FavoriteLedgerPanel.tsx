import { BILIMI_LEDGER_PREFIX, createDefaultFavoriteLedgers, isBilimiManagedLedgerName } from '@shared/favoriteLedgers'
import type {
  AssistantAutomationResult,
  FavoriteArchiveMultiMode,
  FavoriteLedger,
  FavoriteLedgerSaveOptions
} from '@shared/types'
import { useEffect, useMemo, useState, type DragEvent, type MouseEvent } from 'react'
import type { FavoriteLedgerCandidate } from '../favorites/favoriteLedgerInsights'
import type {
  FavoriteLedgerPreview,
  FavoriteLedgerPreviewItem,
  FavoriteLedgerPreviewTarget
} from '../favorites/favoriteLedgerPreview'
import { AssistantActionButton } from './AssistantActionButton'
import clickedPetUrl from '../../assets/pet/blue-white-maid/character/big-head/clicked.png'
import hintPetUrl from '../../assets/pet/blue-white-maid/character/big-head/hint.png'

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
    enhanceWithDeepSeek?: boolean
    multiArchiveMode?: FavoriteArchiveMultiMode
  }) => Promise<FavoriteLedgerPreview>
  onExecuteOldFavoritePlan: (items: FavoriteLedgerPreviewItem[]) => Promise<AssistantAutomationResult>
  onOldFavoriteExecutionStateChange?: (state: 'running' | 'finished') => void
  favoriteArchiveMultiMode?: FavoriteArchiveMultiMode
  deepSeekOldFavoriteAssistanceEnabled?: boolean
  deepSeekReady?: boolean
}

type OldFavoriteExecutionResult = AssistantAutomationResult & {
  paused?: boolean
}

const OLD_FAVORITE_APPEND_DELAY_MS = { min: 2500, max: 6000 }
const OLD_FAVORITE_COOLDOWN_DELAY_MS = { min: 30000, max: 90000 }
const OLD_FAVORITE_COOLDOWN_EVERY = 15

function splitKeywords(value: string) {
  return value
    .split(/[\s,，、/]+/)
    .map((keyword) => keyword.trim())
    .filter(Boolean)
}

function customLedgerId(name: string) {
  const base = name.replace(/\W+/g, '-').replace(/^-|-$/g, '') || 'ledger'
  return `custom-${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function canDeleteLedger(ledger: FavoriteLedger) {
  return !ledger.isDefault && ledger.displayName.startsWith(BILIMI_LEDGER_PREFIX)
}

function alreadyHasLedger(ledgers: FavoriteLedger[], displayName: string) {
  return ledgers.some((ledger) => ledger.displayName === displayName)
}

function candidateKey(candidate: FavoriteLedgerCandidate) {
  return `${candidate.kind}:${candidate.sourceName}`
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
  return error instanceof Error ? error.message : String(error || '未知错误')
}

function stripBilimiLedgerPrefix(displayName: string) {
  return displayName.replace(/^Bilimi[·\s-]*/, '').trim()
}

function isBilimiLedger(ledger: FavoriteLedger) {
  return ledger.displayName.startsWith(BILIMI_LEDGER_PREFIX)
}

function prefixedBilimiLedgerName(name: string) {
  return `${BILIMI_LEDGER_PREFIX}${stripBilimiLedgerPrefix(name)}`
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
const FAVORITE_LEDGER_SAFETY_NOTE =
  '使用bilimi第一件事就是备册，生成专属收藏夹，同一个视频可以同时保存在不同的收藏夹里，小咪不会删除主人的旧收藏哦，安心使用吧'
const LEDGER_SYNC_HINT =
  '自定义你的bilimi收藏夹，点击收藏名字可以进行编辑，添加好后点击【同步】即可更新到b站；取消勾选再点击同步，也会删除对应的 Bilimi 收藏夹。'
const BACKUP_COMPLETE_MESSAGE =
  '小咪备册已完成，主人可以再增加自己想要的收藏夹，点击同步即可'
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
  }>
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

function oldFavoriteTargetKey(aid: number, ledgerId: string) {
  return `${aid}:${ledgerId}`
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

function defaultOldFavoriteTargetKeys(
  preview: FavoriteLedgerPreview,
  selectedCandidateKeys: Set<string>,
  selectedLedgerIds: Set<string> = new Set()
) {
  const keys = selectedTargetKeysForPreview(preview, selectedCandidateKeys)
  for (const item of preview.items) {
    if (item.alreadyInTarget) {
      continue
    }

    for (const target of targetsForOldFavoriteItem(item)) {
      if (target.selectedCandidateTarget || target.alreadyInTarget || target.ledgerId === 'inbox') {
        continue
      }
      if (selectedLedgerIds.has(target.ledgerId)) {
        keys.add(oldFavoriteTargetKey(item.aid, target.ledgerId))
      }
    }
  }
  return keys
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

function candidateTargetToPreviewTarget(
  target: NonNullable<FavoriteLedgerPreviewItem['candidateTargets']>[number],
  reviewRequired: boolean
): FavoriteLedgerPreviewTarget {
  return {
    ledgerId: target.ledgerId,
    folderId: '',
    displayName: target.displayName,
    keywords: target.keywords,
    alreadyInTarget: false,
    selected: !reviewRequired,
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

  const nextTargets = targetsForOldFavoriteItem(item).filter((target) => {
    if (target.ledgerId === 'inbox') {
      return false
    }
    if (!target.selectedCandidateTarget || !target.candidateKey) {
      return true
    }
    return selectedCandidateKeys.has(target.candidateKey)
  })
  const targetIds = new Set(nextTargets.map((target) => target.ledgerId))

  for (const candidateTarget of selectedCandidateTargets) {
    if (targetIds.has(candidateTarget.ledgerId)) {
      continue
    }
    targetIds.add(candidateTarget.ledgerId)
    nextTargets.push(candidateTargetToPreviewTarget(candidateTarget, item.reviewRequired))
  }

  return {
    ...item,
    targets: nextTargets
  }
}

function selectedTargetKeysForPreview(
  preview: FavoriteLedgerPreview,
  selectedCandidateKeys: Set<string>
) {
  const keys = new Set<string>()
  for (const item of preview.items) {
    for (const target of targetsForOldFavoriteItem(itemWithSelectedCandidateTargets(item, selectedCandidateKeys))) {
      if (target.selectedCandidateTarget && target.candidateKey && !selectedCandidateKeys.has(target.candidateKey)) {
        continue
      }
      if (target.selected && !target.alreadyInTarget) {
        keys.add(oldFavoriteTargetKey(item.aid, target.ledgerId))
      }
    }
  }
  return keys
}

function buildOldFavoriteTargetGroups(
  items: FavoriteLedgerPreviewItem[],
  selectedCandidateKeys: Set<string>,
  selectedTargetKeys: Set<string>
): OldFavoriteTargetGroup[] {
  const groups = new Map<string, OldFavoriteTargetGroup>()
  for (const item of items) {
    if (item.alreadyInTarget) {
      continue
    }

    for (const target of targetsForOldFavoriteItem(item)) {
      if (target.alreadyInTarget) {
        continue
      }

      if (target.selectedCandidateTarget && target.candidateKey && !selectedCandidateKeys.has(target.candidateKey)) {
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
        selected: selectedTargetKeys.has(oldFavoriteTargetKey(item.aid, target.ledgerId))
      })
      groups.set(target.ledgerId, group)
    }
  }

  return Array.from(groups.values())
}

function buildSelectedOldFavoritePlanItems(args: {
  items: FavoriteLedgerPreviewItem[]
  selectedTargetKeys: Set<string>
  selectedCandidateKeys: Set<string>
}): FavoriteLedgerPreviewItem[] {
  const planItems: FavoriteLedgerPreviewItem[] = []

  for (const item of args.items) {
    if (item.alreadyInTarget) {
      continue
    }

    const selectedTargets = targetsForOldFavoriteItem(item).filter((target) => {
      if (target.selectedCandidateTarget && target.candidateKey && !args.selectedCandidateKeys.has(target.candidateKey)) {
        return false
      }
      return args.selectedTargetKeys.has(oldFavoriteTargetKey(item.aid, target.ledgerId))
    })
    for (const target of selectedTargets) {
      planItems.push({
        ...item,
        targets: undefined,
        targetLedgerId: target.ledgerId,
        targetFolderId: target.folderId,
        targetDisplayName: target.displayName,
        alreadyInTarget: target.alreadyInTarget,
        selected: true,
        selectedCandidateTarget: target.selectedCandidateTarget,
        reviewRequired: false
      })
    }
  }

  return planItems
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
  favoriteArchiveMultiMode = 'off',
  deepSeekOldFavoriteAssistanceEnabled = false,
  deepSeekReady = false
}: FavoriteLedgerPanelProps) {
  const [draftLedgers, setDraftLedgers] = useState<FavoriteLedger[]>(ledgers)
  const [activeLedgerId, setActiveLedgerId] = useState<string | null>(null)
  const [activeLedgerIndex, setActiveLedgerIndex] = useState<number | null>(null)
  const [preview, setPreview] = useState<FavoriteLedgerPreview | null>(null)
  const [selectedDefaultLedgerIds, setSelectedDefaultLedgerIds] = useState<Set<string>>(
    () => new Set(ledgers.filter((ledger) => ledger.enabled && ledger.isDefault).map((ledger) => ledger.id))
  )
  const [selectedCandidateKeys, setSelectedCandidateKeys] = useState<Set<string>>(new Set())
  const [selectedOldFavoriteAids, setSelectedOldFavoriteAids] = useState<Set<number>>(new Set())
  const [selectedOldFavoriteTargetKeys, setSelectedOldFavoriteTargetKeys] = useState<Set<string>>(new Set())
  const [selectedOldFavoriteSourceFolderTitles, setSelectedOldFavoriteSourceFolderTitles] =
    useState<Set<string>>(new Set())
  const [oldFavoriteExecutionProgress, setOldFavoriteExecutionProgress] = useState<{
    completed: number
    total: number
  } | null>(null)
  const [oldFavoriteExecuting, setOldFavoriteExecuting] = useState(false)
  const [oldFavoriteExecutionAwaitingAcknowledgement, setOldFavoriteExecutionAwaitingAcknowledgement] =
    useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [draggedLedgerId, setDraggedLedgerId] = useState<string | null>(null)
  const [dragTargetLedgerId, setDragTargetLedgerId] = useState<string | null>(null)
  const [ledgerListExpanded, setLedgerListExpanded] = useState(false)
  const [oldFavoriteStep, setOldFavoriteStep] = useState<OldFavoriteGuideStep>('scan')
  const [oldFavoriteGuideMode, setOldFavoriteGuideMode] = useState<OldFavoriteGuideMode>('organize')
  const [oldFavoriteDeepSeekEnhanced, setOldFavoriteDeepSeekEnhanced] = useState(false)
  const [tagCandidatesExpanded, setTagCandidatesExpanded] = useState(false)
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
  const activeLedgerHasUnsavedChanges = useMemo(() => {
    if (!activeLedger) {
      return false
    }

    const originalLedger = ledgers.find((ledger) => ledger.id === activeLedger.id)
    return JSON.stringify(activeLedger) !== JSON.stringify(originalLedger ?? null)
  }, [activeLedger, ledgers])
  useEffect(() => {
    setDraftLedgers(ledgers)
    setSelectedDefaultLedgerIds(
      new Set(ledgers.filter((ledger) => ledger.enabled && ledger.isDefault).map((ledger) => ledger.id))
    )
    setActiveLedgerId(null)
    setActiveLedgerIndex(null)
    finishLedgerDrag()
  }, [ledgers])

  function oldFavoriteOrganizationLocked() {
    return oldFavoriteExecuting || oldFavoriteExecutionAwaitingAcknowledgement
  }

  function showOldFavoriteOrganizationPendingMessage() {
    setStatus('正在整理中，请耐心等待。')
  }

  function acknowledgeOldFavoriteExecution() {
    setOldFavoriteExecutionAwaitingAcknowledgement(false)
    setOldFavoriteExecutionProgress(null)
    setStatus(null)
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

    if (missingLedgerIds.length > 0) {
      await scanOldFavorites('setup')
      return
    }

    await scanOldFavorites()
  }

  function addBlankLedger() {
    const nextLedger = {
      id: customLedgerId('new-ledger'),
      displayName: BILIMI_LEDGER_PREFIX,
      keywords: [],
      enabled: true,
      priority: (draftLedgers.length + 1) * 10,
      isDefault: false
    }
    const nextLedgers = [...draftLedgers, nextLedger]

    setDraftLedgers(nextLedgers)
    setActiveLedgerId(nextLedger.id)
    setActiveLedgerIndex(nextLedgers.length - 1)
    setLedgerListExpanded(true)
    setSaveStatus(null)
  }

  function resetLedgers() {
    const defaultLedgers = createDefaultFavoriteLedgers().map((ledger) => ({
      ...ledger,
      enabled: false
    }))
    setDraftLedgers(defaultLedgers)
    setSelectedDefaultLedgerIds(new Set())
    setActiveLedgerId(null)
    setActiveLedgerIndex(null)
    setSelectedCandidateKeys(new Set())
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
      return
    }

    setActiveLedgerId(ledger.id)
    setActiveLedgerIndex(ledgerIndex)
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

  function updateActiveLedger(patch: Partial<Pick<FavoriteLedger, 'displayName' | 'keywords'>>) {
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

  function setCandidateSelected(candidate: FavoriteLedgerCandidate, selected: boolean) {
    const key = candidateKey(candidate)
    setSelectedCandidateKeys((current) => {
      setSaveStatus(null)
      const next = new Set(current)
      if (!selected) {
        next.delete(key)
        setSelectedOldFavoriteTargetKeys((currentTargets) => {
          const nextTargets = new Set(currentTargets)
          for (const item of selectableOldFavoriteItems) {
            for (const target of targetsForOldFavoriteItem(item)) {
              if (target.candidateKey === key) {
                nextTargets.delete(oldFavoriteTargetKey(item.aid, target.ledgerId))
              }
            }
            for (const target of item.candidateTargets ?? []) {
              if (target.candidateKey === key) {
                nextTargets.delete(oldFavoriteTargetKey(item.aid, target.ledgerId))
              }
            }
          }
          return nextTargets
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
      } else {
        next.add(key)
        setSelectedOldFavoriteTargetKeys((currentTargets) => {
          const nextTargets = new Set(currentTargets)
          for (const item of selectableOldFavoriteItems) {
            for (const target of targetsForOldFavoriteItem(item)) {
              if (target.candidateKey === key && target.selected && !target.alreadyInTarget) {
                nextTargets.add(oldFavoriteTargetKey(item.aid, target.ledgerId))
              }
            }
            for (const target of item.candidateTargets ?? []) {
              if (target.candidateKey === key && !item.alreadyInTarget) {
                nextTargets.add(oldFavoriteTargetKey(item.aid, target.ledgerId))
              }
            }
          }
          return nextTargets
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
      return next
    })
  }

  function setCandidateGroupSelected(candidates: FavoriteLedgerCandidate[], selected: boolean) {
    for (const candidate of candidates) {
      setCandidateSelected(candidate, selected)
    }
  }

  function candidateToLedger(candidate: FavoriteLedgerCandidate, priority: number): FavoriteLedger {
    return {
      id: candidateLedgerId(candidate),
      displayName: candidate.displayName,
      keywords: candidate.keywords,
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
              enabled: includeDefaultLedgers
                ? (defaultEnabledById.get(ledger.id) ?? selectedDefaultLedgerIds.has(ledger.id))
                : selectedDefaultLedgerIds.has(ledger.id)
            }
          : ledger
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
    mode: 'setup' | 'organize' = 'organize',
    options: { enhanceWithDeepSeek?: boolean } = {}
  ) {
    setBusy(true)
    setSaveStatus(null)
    setOldFavoriteExecutionProgress(null)
    setStatus(options.enhanceWithDeepSeek ? '正在用 DeepSeek 补判旧藏，请稍候。' : '正在扫描旧藏，请稍候。')
    try {
      const nextPreview = await onScanOldFavorites({
        enhanceWithDeepSeek: Boolean(options.enhanceWithDeepSeek),
        multiArchiveMode: favoriteArchiveMultiMode
      })
      if (nextPreview.ok === false) {
        setPreview(null)
        setStatus(`整理旧藏未完成：${nextPreview.message || '请稍后重试。'}`)
        return
      }

      setPreview(nextPreview)
      setOldFavoriteStep('scan')
      setOldFavoriteGuideMode(mode)
      setOldFavoriteDeepSeekEnhanced(Boolean(options.enhanceWithDeepSeek))
      setTagCandidatesExpanded(false)
      setLedgerListExpanded(true)
      const nextCandidateKeys = recommendedCandidateKeysForPreview(nextPreview)
      const nextRecommendedLedgerIds = recommendedLedgerIdsForPreview(nextPreview)
      setSelectedCandidateKeys(nextCandidateKeys)
      setDraftLedgers((currentLedgers) =>
        mergeCandidateLedgers(
          currentLedgers.map((ledger) =>
            nextRecommendedLedgerIds.has(ledger.id) ? { ...ledger, enabled: true } : ledger
          ),
          nextPreview,
          nextCandidateKeys
        )
      )
      setSelectedDefaultLedgerIds((current) => {
        const next = new Set(current)
        for (const ledger of draftLedgers) {
          if (ledger.isDefault && nextRecommendedLedgerIds.has(ledger.id)) {
            next.add(ledger.id)
          }
        }
        return next
      })
      if (mode === 'setup') {
        const nextLedgers = mergeDefaultLedgers(
          draftLedgers.map((ledger) =>
            nextRecommendedLedgerIds.has(ledger.id) ? { ...ledger, enabled: true } : ledger
          )
        )
        setDraftLedgers(nextLedgers)
        setSelectedDefaultLedgerIds(
          new Set(nextLedgers.filter((ledger) => ledger.enabled && ledger.isDefault).map((ledger) => ledger.id))
        )
      }
      setSelectedOldFavoriteAids(
        new Set(
          nextPreview.items
            .filter((item) => item.selected && !item.alreadyInTarget && !item.reviewRequired)
            .map((item) => item.aid)
        )
      )
      setSelectedOldFavoriteTargetKeys(
        defaultOldFavoriteTargetKeys(nextPreview, nextCandidateKeys, nextRecommendedLedgerIds)
      )
      setSelectedOldFavoriteSourceFolderTitles(
        new Set(nextPreview.items.map((item) => item.sourceFolderTitle))
      )
      setStatus(
        options.enhanceWithDeepSeek
          ? `DeepSeek 已补判 ${nextPreview.items.length} 条旧藏，可查看推荐收藏夹。`
          : mode === 'setup'
          ? `已扫描 ${nextPreview.insights?.totalVideos ?? nextPreview.items.length} 条旧藏，可勾选库房后同步。`
          : `已扫描 ${nextPreview.items.length} 条旧藏，可勾选后整理。`
      )
    } catch (error) {
      setPreview(null)
      setStatus(`整理旧藏未完成：${errorMessage(error)}`)
    } finally {
      setBusy(false)
    }
  }

  async function enhanceOldFavoritesWithDeepSeek() {
    await scanOldFavorites(oldFavoriteGuideMode, { enhanceWithDeepSeek: true })
  }

  function toggleOldFavorite(aid: number) {
    setSelectedOldFavoriteAids((current) => {
      const next = new Set(current)
      if (next.has(aid)) {
        next.delete(aid)
      } else {
        next.add(aid)
      }
      return next
    })
  }

  function toggleOldFavoriteTarget(aid: number, ledgerId: string) {
    const key = oldFavoriteTargetKey(aid, ledgerId)
    setSelectedOldFavoriteTargetKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
    setSelectedOldFavoriteAids((current) => {
      const next = new Set(current)
      next.add(aid)
      return next
    })
  }

  function setOldFavoriteTargetGroupSelected(group: OldFavoriteTargetGroup, selected: boolean) {
    setSelectedOldFavoriteTargetKeys((current) => {
      const next = new Set(current)
      for (const entry of group.entries) {
        const key = oldFavoriteTargetKey(entry.item.aid, group.ledgerId)
        if (selected) {
          next.add(key)
        } else {
          next.delete(key)
        }
      }
      return next
    })
    setSelectedOldFavoriteAids((current) => {
      const next = new Set(current)
      for (const entry of group.entries) {
        next.add(entry.item.aid)
      }
      return next
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

  async function executeOldFavoritePlan() {
    if (!preview) {
      return
    }

    setOldFavoriteExecuting(true)
    setOldFavoriteExecutionAwaitingAcknowledgement(false)
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

      const selectedItems = selectedOldFavoritePlanItems.filter(
        (item) => item.targetFolderId || item.selectedCandidateTarget
      )
      if (selectedItems.length === 0) {
        setStatus('收藏夹已同步，请重新扫描旧藏后再确认整理。')
        return
      }

      setOldFavoriteExecutionProgress({ completed: 0, total: selectedItems.length })
      const results: OldFavoriteExecutionResult[] = []
      for (const [index, item] of selectedItems.entries()) {
        const result = (await onExecuteOldFavoritePlan([item])) as OldFavoriteExecutionResult
        results.push(result)
        setOldFavoriteExecutionProgress({ completed: index + 1, total: selectedItems.length })
        if (result.paused) {
          break
        }
        await paceOldFavoriteExecution(index + 1, index < selectedItems.length - 1)
      }
      const failedCount = results.filter((result) => result.ok === false).length
      const paused = results.some((result) => result.paused)
      setStatus(
        paused
          ? '本次整理已暂停，请稍后再继续。'
          : failedCount > 0
          ? `本次整理已结束，${results.length - failedCount} 条成功，${failedCount} 条失败。`
          : '本次整理已结束。'
      )
      setOldFavoriteExecutionAwaitingAcknowledgement(true)
      onOldFavoriteExecutionStateChange?.('finished')
    } catch (error) {
      setStatus(`整理旧藏未完成：${errorMessage(error)}`)
      setOldFavoriteExecutionAwaitingAcknowledgement(true)
      onOldFavoriteExecutionStateChange?.('finished')
    } finally {
      setOldFavoriteExecuting(false)
    }
  }

  const ledgersToDisplay = visibleLedgers(draftLedgers, ledgerListExpanded)
  const allLedgersSelected = draftLedgers.length > 0 && draftLedgers.every(ledgerEnabled)
  const bulkToggleLabel = allLedgersSelected ? '取消全选' : '全选'
  const canToggleLedgerList = draftLedgers.length > ledgersToDisplay.length || ledgerListExpanded
  const selectableOldFavoriteItems = useMemo(
    () =>
      preview?.items
        .filter((item) => selectedOldFavoriteSourceFolderTitles.has(item.sourceFolderTitle))
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

    return Array.from(sourceFolderCounts, ([name, count]) => ({ name, count }))
  }, [preview])
  const oldFavoriteUserSourceFolders = useMemo(
    () => oldFavoriteSourceFolders.filter((folder) => !isBilimiManagedLedgerName(folder.name)),
    [oldFavoriteSourceFolders]
  )
  const oldFavoriteBilimiSourceFolders = useMemo(
    () => oldFavoriteSourceFolders.filter((folder) => isBilimiManagedLedgerName(folder.name)),
    [oldFavoriteSourceFolders]
  )
  const selectedOldFavoritePlanItems = useMemo(
    () =>
      buildSelectedOldFavoritePlanItems({
        items: selectableOldFavoriteItems,
        selectedTargetKeys: selectedOldFavoriteTargetKeys,
        selectedCandidateKeys
      }),
    [selectableOldFavoriteItems, selectedOldFavoriteTargetKeys, selectedCandidateKeys]
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
    () => buildOldFavoriteTargetGroups(selectableOldFavoriteItems, selectedCandidateKeys, selectedOldFavoriteTargetKeys),
    [selectableOldFavoriteItems, selectedCandidateKeys, selectedOldFavoriteTargetKeys]
  )
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

  function oldFavoriteCandidateDetailText(candidate: FavoriteLedgerCandidate) {
    const count = oldFavoriteCandidateCounts.get(candidateKey(candidate)) ?? candidate.count
    const sourceLabel = candidate.kind === 'author' ? '固定 UP' : candidate.kind === 'series' ? '标题系列' : '主题聚类'
    const aiLabel = candidate.aiEnhanced ? ' · DeepSeek 补判' : ''
    return `${count} 条旧藏 · ${sourceLabel}${aiLabel} · ${candidate.reason}`
  }

  function oldFavoriteCandidateRecommendationText(candidate: FavoriteLedgerCandidate) {
    const count = oldFavoriteCandidateCounts.get(candidateKey(candidate)) ?? 0
    return count > 0 ? `${count} 条适合` : '按扫描结果生成'
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

        <p className="favorite-ledger-panel__safety-note">{FAVORITE_LEDGER_SAFETY_NOTE}</p>

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
            description="生成专属 Bilimi 收藏夹，以便批阅和归类"
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
            description="扫描并整理旧收藏，放进 Bilimi 收藏里"
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
          <h3>收藏夹</h3>
          <div className="favorite-ledger-panel__category-actions">
            <button type="button" disabled={busy} onClick={resetLedgers}>
              重置
            </button>
            <button type="button" disabled={busy} onClick={toggleAllLedgers}>
              {bulkToggleLabel}
            </button>
            <button type="button" disabled={busy} onClick={() => void saveLedgers()}>
              同步
            </button>
          </div>
        </div>
        <p className="favorite-ledger-panel__sync-hint">{LEDGER_SYNC_HINT}</p>
        <div className="favorite-ledger-panel__chips">
          {ledgersToDisplay.map((ledger, ledgerIndex) => {
            const isLedgerEnabled = ledgerEnabled(ledger)
            const ledgerLabel = ledger.displayName.replace(/^Bilimi[·\s-]*/, '')
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
              <button type="button" disabled={busy} onClick={() => void saveLedgers()}>
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
          册名
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
            关键词
            <textarea
              value={activeLedger.keywords.join('、')}
              onChange={(event) =>
                updateActiveLedger({ keywords: splitKeywords(event.currentTarget.value) })
              }
            />
          </label>
          <p className="favorite-ledger-panel__keyword-hint">
            建议优先填写 B 站标签里的词；标签命中权重最高，标题、分区、简介等信息会辅助判断。
          </p>
          <p className="favorite-ledger-panel__keyword-hint">
            不同关键词用顿号或空格隔开，逗号、斜杠也能识别。
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
            <h3>{oldFavoriteGuideMode === 'setup' ? '备册' : '整理旧藏'}</h3>
            <nav className="favorite-ledger-panel__guide-steps" aria-label="整理旧藏步骤">
              {OLD_FAVORITE_GUIDE_STEPS.map((step) => (
                <button
                  key={step.id}
                  type="button"
                  aria-current={oldFavoriteStep === step.id ? 'step' : undefined}
                  onClick={() => setOldFavoriteStep(step.id)}
                >
                  {step.label}
                </button>
              ))}
            </nav>
          </div>

          {oldFavoriteStep === 'scan' ? (
            <section className="favorite-ledger-panel__insights" aria-label="基础数据">
              <h4>基础数据</h4>
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
                  <span>已存在</span>
                  <strong>{alreadyInTargetOldFavoriteCount}</strong>
                </article>
                <article>
                  <span>跳过来源</span>
                  <strong>{skippedSourceFolderCount}</strong>
                </article>
              </div>
              {preview.insights ? (
                <>
                  <p>共扫描 {preview.insights.totalVideos} 条旧藏，生成 {preview.insights.candidateLedgers.length} 个候选收藏夹</p>
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
                          <small>Bilimi 工作夹</small>
                          <ul>{oldFavoriteBilimiSourceFolders.map(renderOldFavoriteSourceFolder)}</ul>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="favorite-ledger-panel__deepseek-assist">
                    {deepSeekReady && deepSeekOldFavoriteAssistanceEnabled ? (
                      <>
                        <span>
                          {oldFavoriteDeepSeekEnhanced
                            ? 'DeepSeek 已补判，可查看推荐收藏夹。'
                            : '候选不够准时，可让 DeepSeek 继续补判。'}
                        </span>
                        <button
                          type="button"
                          disabled={busy || oldFavoriteDeepSeekEnhanced}
                          onClick={() => void enhanceOldFavoritesWithDeepSeek()}
                        >
                          智能补判旧藏
                        </button>
                      </>
                    ) : deepSeekReady ? (
                      <span>在设置中开启“用 DeepSeek 辅助整理旧藏”后，可继续补判旧藏。</span>
                    ) : (
                      <span>配置并启用 DeepSeek 后，可继续补判旧藏。</span>
                    )}
                  </div>
                </>
              ) : null}
            </section>
          ) : null}

          {oldFavoriteStep === 'generated' ? (
            <section className="favorite-ledger-panel__candidates" aria-label="专属收藏夹候选">
              <h4>推荐收藏夹</h4>
              <p>确认执行后，会把已勾选候选同步到 B 站收藏夹里。</p>
              <div className="favorite-ledger-panel__candidate-section">
                <div className="favorite-ledger-panel__candidate-section-heading">
                  <h5>专属 UP 追更</h5>
                  <label>
                    <input
                      type="checkbox"
                      aria-label="全选 专属 UP 追更"
                      checked={allFollowUpCandidatesSelected}
                      disabled={!oldFavoriteFollowUpCandidates.length}
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

                  return (
                    <article key={`${candidate.kind}-${candidate.sourceName}`}>
                      <label>
                        <input
                          type="checkbox"
                          aria-label={candidate.displayName}
                          checked={isSelected}
                          disabled={!isSelected && alreadyHasLedger(ledgers, candidate.displayName)}
                          onClick={() => setCandidateSelected(candidate, !isSelected)}
                          onChange={() => undefined}
                        />
                        <span>
                          <strong>{candidate.displayName}</strong>
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
              <div className="favorite-ledger-panel__candidate-section">
                <div className="favorite-ledger-panel__candidate-section-heading">
                  <h5>高频标签收藏夹</h5>
                  <label>
                    <input
                      type="checkbox"
                      aria-label="全选 高频标签收藏夹"
                      checked={allTagCandidatesSelected}
                      disabled={!oldFavoriteTagCandidates.length}
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

                    return (
                      <article key={`${candidate.kind}-${candidate.sourceName}`}>
                        <label>
                          <input
                            type="checkbox"
                            aria-label={candidate.displayName}
                            checked={isSelected}
                            disabled={!isSelected && alreadyHasLedger(ledgers, candidate.displayName)}
                            onClick={() => setCandidateSelected(candidate, !isSelected)}
                            onChange={() => undefined}
                          />
                          <span>
                            <strong>{favoriteLedgerDisplayShortName(candidate.displayName)}</strong>
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
              <h4>归档预览</h4>
              {oldFavoriteGuideMode === 'setup' ? (
                draftLedgers.map((ledger) => (
                  <article key={ledger.id}>
                    <strong>{ledger.displayName}</strong>
                  </article>
                ))
              ) : oldFavoriteTargetGroups.length > 0 ? (
                <div className="favorite-ledger-panel__preview-groups">
                  {oldFavoriteTargetGroups.map((group) => {
                    const selectedCount = group.entries.filter((entry) => entry.selected).length
                    const allSelected = group.entries.length > 0 && selectedCount === group.entries.length

                    return (
                      <section
                        key={group.ledgerId}
                        className="favorite-ledger-panel__preview-row"
                        role="group"
                        aria-label={`${group.displayName} ${group.entries.length} 条`}
                      >
                        <header>
                          <label>
                            <input
                              type="checkbox"
                              aria-label={`全选 ${group.displayName}`}
                              checked={allSelected}
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
                          {group.entries.map(({ item, target, selected }) => (
                            <article key={`${group.ledgerId}-${item.sourceFolderTitle}-${item.aid}`}>
                              <button
                                type="button"
                                className="favorite-ledger-panel__preview-video"
                                aria-pressed={selected}
                                disabled={target.alreadyInTarget}
                                onClick={() => toggleOldFavoriteTarget(item.aid, group.ledgerId)}
                              >
                                <span
                                  className="favorite-ledger-panel__preview-video-title"
                                  title={item.title}
                                >
                                  {item.title}
                                </span>
                                <small>
                                  来源 {item.sourceFolderTitle}
                                  {target.alreadyInTarget ? ' · 已在目标' : ''}
                                  {item.reviewRequired ? ' · 需要复核' : ''}
                                </small>
                              </button>
                            </article>
                          ))}
                        </div>
                      </section>
                    )
                  })}
                </div>
              ) : (
                <p>暂无可归册旧藏。</p>
              )}
            </div>
          ) : null}

          {oldFavoriteStep === 'confirm' ? (
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
                  {oldFavoriteTargetWarning ? (
                    <p className="favorite-ledger-panel__confirm-warning" role="alert">
                      {oldFavoriteTargetWarning}
                    </p>
                  ) : null}
                  <p>只会追加到 Bilimi 收藏夹，不会删除、移动或取消原收藏。</p>
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
                      (oldFavoriteExecuting || selectedOldFavoritePlanItems.length === 0) &&
                      !oldFavoriteExecutionAwaitingAcknowledgement
                    }
                    onClick={() =>
                      oldFavoriteExecutionAwaitingAcknowledgement
                        ? acknowledgeOldFavoriteExecution()
                        : void executeOldFavoritePlan()
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
          ) : null}
        </section>
      ) : null}

    </section>
  )
}
