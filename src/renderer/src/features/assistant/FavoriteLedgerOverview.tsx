import {
  BILIBILI_FAVORITE_LEDGER_NAME_MAX_LENGTH,
  BILIMI_LEDGER_PREFIX,
  createDefaultFavoriteLedgers,
  favoriteLedgerNameValidation,
  stripBilimiLedgerPrefix
} from '@shared/favoriteLedgers'
import { DEEPSEEK_CONSTRAINT_MARKER, parseFavoriteLedgerRules } from '@shared/favoriteLedgerConstraints'
import { isUnsavedFavoriteLedgerDraft } from '@shared/favoriteLedgerDraftDeletion'
import type { FavoriteLedger, FavoriteLedgerRuleType, FavoriteLedgerSaveOptions } from '@shared/types'
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import { OldFavoriteModal } from './OldFavoriteModal'
import { resolveSidebarTooltipPosition } from './sidebarTooltipPosition'
import {
  FavoriteLedgerEnableButton,
  FavoriteLedgerEnableStore,
  FavoriteLedgerEnableSummary,
  type FavoriteLedgerEnableEntry
} from './favoriteLedgerEnableStore'

type FavoriteLedgerOverviewProps = {
  ledgers: FavoriteLedger[]
  missingLedgerIds: string[]
  unboundLedgerIds?: string[]
  remoteOnlyDraftLedgerIds?: string[]
  onDismissRemoteDraftReminder?: (ledgerId: string, remoteFolderIds: string[]) => Promise<void> | void
  organizationActive?: boolean
  hasExpandedOrganizationGuide?: boolean
  defaultFavoriteSystemEnabled?: boolean
  openLedgerId?: string
  openLedgerRequestVersion?: number
  createLedger?: boolean
  createLedgerRequestVersion?: number
  onSaveLedgers: (ledgers: FavoriteLedger[], options?: FavoriteLedgerSaveOptions) => Promise<unknown> | void
  onSaveLedgerEnabled?: (ledgerId: string, enabled: boolean) => Promise<unknown> | void
  onEnabledStateChange?: (enabledById: ReadonlyMap<string, boolean>) => void
  onDeleteLedger?: (ledgerId: string) => void
  onSyncLedgers?: (ledgers: FavoriteLedger[], options?: FavoriteLedgerSaveOptions) => Promise<unknown> | void
  draftRuleAnalysis?: {
    ledgerId: string
    status: 'running' | 'canceling'
    completedItemCount: number
    totalItemCount: number
  } | null
  draftRuleAnalysisError?: string | null
  onAnalyzeLedgerRule?: (ledger: FavoriteLedger) => Promise<boolean>
  onCancelDraftRuleAnalysis?: () => void
}

export type FavoriteLedgerOverviewHandle = {
  requestBackup: () => Promise<unknown>
}

type RebindCandidateEntry = {
  ledgerId: string
  candidates: Array<{
    id: string
    title: string
    memberCount: number
    bindingFailureReason?: string
  }>
}

const LEDGER_SYNC_HINTS = [
  { title: '小咪提醒：', detail: '同一个视频可以保存在多个收藏夹里。整理收藏会把视频复制添加到 bilimi 收藏夹，不会移出原有的普通 B 站收藏夹，主人放心使用吧～（bilimi 收藏夹和分类视频支持删除，但需谨慎操作呦）' },
  { title: '自定义收藏夹：', detail: '点击收藏夹名称可以编辑；按住并拖动可调整顺序。' },
  { title: '勾选 bilimi 收藏夹：', detail: '勾选的收藏夹会用于批阅预分类和整理收藏分类。预分类会显示视频建议归类的位置；备册后才能将分类结果同步到 B 站。' },
  { title: '备册到 B 站：', detail: '备册会将已勾选的 bilimi 收藏夹创建或更新到 B 站，为将批阅和整理结果同步到 B 站做好准备。' },
  { title: '删除 bilimi 收藏夹：', detail: '点击右侧“×”进入删除模式，勾选要删除的自建收藏夹或草稿后点击“删除”。这只会移除右侧本地收藏夹配置，保留收藏库和 B 站收藏夹；默认收藏夹请在左侧收藏库的工作夹菜单中处理。' },
  { title: '分类依据：', detail: '关键词、UP 名称和标签用于本地识别。DeepSeek 约束可用一句话描述你想把什么视频分类到这个收藏夹里，仅在启用 DeepSeek 后生效。' }
]
const TYPES: Array<{ value: FavoriteLedgerRuleType; label: string }> = [
  { value: 'keyword', label: '关键词收藏夹' },
  { value: 'author', label: '专属 UP 追更收藏夹' },
  { value: 'tag', label: '标签收藏夹' },
  { value: 'deepseek', label: 'DeepSeek约束收藏夹' }
]
const COLLAPSED_LEDGER_COUNT = 9
const LEDGER_EAGER_RENDER_LIMIT = 500
const LEDGER_TOGGLE_SAVE_DELAY_MS = 250
const FIXED_ASSISTANT_HELP_EVENT = 'bilimi:fixed-assistant-help'

function ruleLabel(type: FavoriteLedgerRuleType | undefined) {
  return type === 'author' ? 'UP 名字' : type === 'tag' ? '标签' : type === 'deepseek' ? 'DeepSeek约束' : '关键词'
}
function ruleHint(type: FavoriteLedgerRuleType | undefined) {
  if (type === 'author') return '多个 UP 名可用顿号、空格、逗号、斜杠或换行分隔。填写一个或多个 UP 名，命中作者时会优先存入这个收藏夹。'
  if (type === 'tag') return '多个 B 站标签可用顿号、空格、逗号、斜杠或换行分隔。填写一个或多个 B 站标签，命中标签时会优先存入这个收藏夹。'
  if (type === 'deepseek') return '填写自然语言判断规则。此类型不参与本地自动分类，必须开启 DeepSeek 后才会用于辅助判断。'
  return '多个关键词可用顿号、空格、逗号、斜杠或换行分隔。建议优先填写 B 站标签里的词；标签命中权重最高，标题、分区、简介等信息会辅助判断。'
}
function displayTitle(name: string) {
  return stripBilimiLedgerPrefix(name).replace(/^[:：·\s]+/, '').trim()
}
function rebindShardNumber(title: string, logicalTitle: string) {
  const candidateTitle = displayTitle(title)
  if (candidateTitle === logicalTitle) return 1
  const match = candidateTitle.match(new RegExp(`^${logicalTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}·([2-9]\\d*)$`, 'u'))
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}
function idFor(title: string) {
  return `custom-${title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-').replace(/^-|-$/g, '') || 'ledger'}-${Date.now()}`
}

function composeKeywords(ruleText: string, deepSeekConstraint: string, ruleType: FavoriteLedgerRuleType) {
  const rules = ruleType === 'deepseek'
    ? (ruleText.trim() ? [ruleText.trim()] : [])
    : ruleText.split(/[\s,，、/]+/).filter(Boolean)
  const constraint = deepSeekConstraint.replace(/\s+/g, ' ').trim()
  return constraint && ruleType !== 'deepseek'
    ? [...rules, DEEPSEEK_CONSTRAINT_MARKER, constraint]
    : rules
}

function ledgerEditorSnapshot(ledger: FavoriteLedger) {
  const { priority: _priority, ...snapshot } = ledger
  return snapshot
}

function isRecoveredRemoteDraft(ledger: FavoriteLedger) {
  return ledger.syncState === 'local-draft' && Boolean(ledger.bilibiliFolderId)
}

function videoCountForLedger(ledger: FavoriteLedger) {
  return typeof ledger.bilibiliFolderVideoCount === 'number' && Number.isFinite(ledger.bilibiliFolderVideoCount)
    ? Math.max(0, Math.round(ledger.bilibiliFolderVideoCount))
    : undefined
}

function remoteBindingIdsForLedger(ledger: FavoriteLedger) {
  const pendingId = ledger.pendingRemoteBinding
    ? (ledger.pendingRemoteFolderId ?? ledger.bilibiliFolderId)?.trim()
    : undefined
  return [...new Set([ledger.bilibiliFolderId, ...(ledger.bilibiliFolderIds ?? [])]
    .map((id) => id?.trim())
    .filter((id): id is string => Boolean(id && id !== pendingId)))]
}

/** External refreshes may rebuild their array; existing cards must not jump. */
export function preserveFavoriteLedgerOrder(
  currentLedgers: readonly FavoriteLedger[],
  incomingLedgers: readonly FavoriteLedger[]
): FavoriteLedger[] {
  const incomingById = new Map(incomingLedgers.map((ledger) => [ledger.id, ledger]))
  const currentIds = new Set(currentLedgers.map((ledger) => ledger.id))
  return [
    ...currentLedgers.flatMap((ledger) => {
      const incoming = incomingById.get(ledger.id)
      return incoming ? [incoming] : []
    }),
    ...incomingLedgers.filter((ledger) => !currentIds.has(ledger.id))
  ]
}

/** Local rule drafts stay in this panel until the owner chooses save or sync. */
export const FavoriteLedgerOverview = forwardRef<FavoriteLedgerOverviewHandle, FavoriteLedgerOverviewProps>(function FavoriteLedgerOverview({ ledgers, missingLedgerIds, unboundLedgerIds = [], remoteOnlyDraftLedgerIds = [], onDismissRemoteDraftReminder, organizationActive = false, hasExpandedOrganizationGuide = false, defaultFavoriteSystemEnabled: defaultFavoriteSystemEnabledProp, openLedgerId, openLedgerRequestVersion = 0, createLedger = false, createLedgerRequestVersion = 0, onSaveLedgers, onSaveLedgerEnabled, onEnabledStateChange, onDeleteLedger, onSyncLedgers = onSaveLedgers, draftRuleAnalysis = null, draftRuleAnalysisError = null, onAnalyzeLedgerRule, onCancelDraftRuleAnalysis }, ref) {
  const defaultFavoriteSystemEnabled = defaultFavoriteSystemEnabledProp ?? true
  const defaultSystemPreferenceExplicit = defaultFavoriteSystemEnabledProp !== undefined
  const externalLedgerSignature = JSON.stringify(ledgers)
  const isDeletedDefaultLedger = (ledger: FavoriteLedger) => Boolean(ledger.isDefault && ledger.managedFolderDeletedByUser)
  const isSystemDisabled = (ledger: FavoriteLedger) => !defaultFavoriteSystemEnabled && ledger.isDefault && ledger.id !== 'inbox'
  const isRoundLocked = (ledger: FavoriteLedger) => organizationActive && ledger.isDefault
  const isDefaultSystemLocked = (ledger: FavoriteLedger) => defaultSystemPreferenceExplicit && defaultFavoriteSystemEnabled && ledger.isDefault && !isDeletedDefaultLedger(ledger)
  const bindingLabelForLedger = (ledger: FavoriteLedger) => isDeletedDefaultLedger(ledger)
    ? '已删除 · 未备册'
    : ledger.bindingState === 'bound'
    ? '已备册'
    : ledger.bindingState === 'unbound' || unboundLedgerIds.includes(ledger.id)
      ? '未绑定'
      : ledger.syncState === 'local-draft'
        ? '未保存'
        : missingLedgerIds.includes(ledger.id) || ledger.bindingState === 'unbacked'
          ? '未备册'
          : ledger.bilibiliFolderId
            ? '已备册'
            : ''
  const bindingStateForLedger = (ledger: FavoriteLedger, label: string) => label.includes('未保存') && !label.includes('未绑定')
    ? 'local-draft'
    : ledger.bindingState ?? (label === '已备册' ? 'bound' : label.includes('未绑定') ? 'unbound' : 'unbacked')
  const isRemoteOnlyDraft = (ledger: FavoriteLedger) => remoteOnlyDraftLedgerIds.includes(ledger.id) && isUnsavedFavoriteLedgerDraft(ledger)
  const isTransientNewDraft = (ledger: FavoriteLedger) => !ledgers.some((item) => item.id === ledger.id) &&
    ledger.syncState === 'local-draft' &&
    !ledger.isDefault &&
    !ledger.bilibiliFolderId &&
    ledger.bindingState === undefined
  const isDraftDirectlyDeletable = (ledger: FavoriteLedger) => isRemoteOnlyDraft(ledger) || isTransientNewDraft(ledger)
  const isOperable = (ledger: FavoriteLedger) => !isRecoveredRemoteDraft(ledger) && !isSystemDisabled(ledger) && !isRoundLocked(ledger) && !isDefaultSystemLocked(ledger)
  const enableEntries = (items: FavoriteLedger[], deletionMode = false, enabledOverride?: ReadonlyMap<string, boolean>): FavoriteLedgerEnableEntry[] => items.map((ledger) => ({
    id: ledger.id,
    enabled: enabledOverride?.get(ledger.id) ?? (deletionMode ? false : isDefaultSystemLocked(ledger) ? true : ledger.enabled),
    operable: deletionMode ? !ledger.isDefault : isOperable(ledger),
    forceEnabledOnBulk: isRoundLocked(ledger)
  }))
  const [ledgerHintExpanded, setLedgerHintExpanded] = useState(false)
  const [ledgerHintVisible, setLedgerHintVisible] = useState(false)
  const [ledgerHintPosition, setLedgerHintPosition] = useState({ top: 0, left: 0 })
  const ledgerHintPanelRef = useRef<HTMLElement>(null)
  const ledgerHintTriggerRef = useRef<HTMLButtonElement>(null)
  const ledgerHintTooltipRef = useRef<HTMLDivElement>(null)
  const [draftLedgers, setDraftLedgers] = useState(ledgers)
  const draftLedgersRef = useRef(draftLedgers)
  const [enableStore] = useState(() => new FavoriteLedgerEnableStore(enableEntries(ledgers)))
  const [deletionStore] = useState(() => new FavoriteLedgerEnableStore(enableEntries(ledgers, true)))
  const [savedLedgerSnapshots, setSavedLedgerSnapshots] = useState<Record<string, ReturnType<typeof ledgerEditorSnapshot>>>(() =>
    Object.fromEntries(ledgers.filter((ledger) => !isRecoveredRemoteDraft(ledger)).map((ledger) => [ledger.id, ledgerEditorSnapshot(ledger)]))
  )
  const [activeLedgerId, setActiveLedgerId] = useState<string | null>(null)
  const [newLedger, setNewLedger] = useState(false)
  const [rebindCandidates, setRebindCandidates] = useState<RebindCandidateEntry[] | null>(null)
  const [rebindSelections, setRebindSelections] = useState<Record<string, string>>({})
  const [rebindSelectedFolderIds, setRebindSelectedFolderIds] = useState<Record<string, string[]>>({})
  const [deletionError, setDeletionError] = useState<string | null>(null)
  const [draftDeletionError, setDraftDeletionError] = useState<string | null>(null)
  const [deletionModeActive, setDeletionModeActive] = useState(false)
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  const [ledgerListExpanded, setLedgerListExpanded] = useState(true)
  const [draggedLedgerId, setDraggedLedgerId] = useState<string | null>(null)
  const [dragTarget, setDragTarget] = useState<string | null>(null)
  const backupInFlightRef = useRef<Promise<unknown> | null>(null)
  const draftMutationLocked = Boolean(draftRuleAnalysis)
  const recoveredRemoteDrafts = draftLedgers.filter((ledger) =>
    ledger.syncState === 'local-draft' && Boolean(ledger.bilibiliFolderId) && !ledger.enabled)
  const recoveredRemoteLedgers = draftLedgers.filter((ledger) =>
    Boolean(ledger.bilibiliFolderId) &&
    (ledger.bindingState === 'unbound' || ledger.syncState === 'local-draft'))
  const persistVersionRef = useRef(0)
  const toggleSaveTimerRef = useRef<number | null>(null)
  const pendingToggleSaveRef = useRef(new Map<string, { previous: boolean; enabled: boolean; version: number }>())
  const pendingBulkSaveRef = useRef<{ previousEnabled: Map<string, boolean>; enabledById: Map<string, boolean> } | null>(null)
  const toggleVersionsRef = useRef(new Map<string, number>())
  const toggleSaveInFlightRef = useRef(false)
  const onSaveLedgersRef = useRef(onSaveLedgers)
  const onSaveLedgerEnabledRef = useRef(onSaveLedgerEnabled)
  const editorRef = useRef<HTMLElement | null>(null)
  const openedLedgerRequestRef = useRef<string | null>(null)
  const positionedLedgerRequestRef = useRef<string | null>(null)
  const openLedgerRequest = openLedgerId ? `${openLedgerId}:${openLedgerRequestVersion}` : null
  const createLedgerRequest = createLedger ? `new:${createLedgerRequestVersion}` : null
  onSaveLedgersRef.current = onSaveLedgers
  onSaveLedgerEnabledRef.current = onSaveLedgerEnabled
  useLayoutEffect(() => {
    draftLedgersRef.current = draftLedgers
  }, [draftLedgers])
  useEffect(() => {
    if (toggleSaveTimerRef.current !== null) window.clearTimeout(toggleSaveTimerRef.current)
    toggleSaveTimerRef.current = null
    pendingToggleSaveRef.current.clear()
    pendingBulkSaveRef.current = null
    const nextLedgers = preserveFavoriteLedgerOrder(draftLedgersRef.current, ledgers)
    enableStore.reset(enableEntries(nextLedgers, false))
    deletionStore.reset(enableEntries(nextLedgers, true))
    setDraftLedgers(nextLedgers)
    setSavedLedgerSnapshots(Object.fromEntries(nextLedgers.filter((ledger) => !isRecoveredRemoteDraft(ledger)).map((ledger) => [ledger.id, ledgerEditorSnapshot(ledger)])))
    setActiveLedgerId(null)
    setNewLedger(false)
    setDeletionModeActive(false)
    setDraftDeletionError(null)
  }, [externalLedgerSignature])
  useEffect(() => () => {
    if (toggleSaveTimerRef.current !== null) window.clearTimeout(toggleSaveTimerRef.current)
    toggleSaveTimerRef.current = null
    const pending = pendingToggleSaveRef.current
    pendingToggleSaveRef.current = new Map()
    const pendingBulk = pendingBulkSaveRef.current
    pendingBulkSaveRef.current = null
    if (pendingBulk) {
      void Promise.resolve(onSaveLedgersRef.current(projectEnabled(draftLedgers), { deleteDisabled: false })).catch(() => undefined)
    } else {
      for (const [id, mutation] of pending) {
        void Promise.resolve(onSaveLedgerEnabledRef.current?.(id, mutation.enabled)).catch(() => undefined)
      }
    }
  }, [])
  useEffect(() => {
    const closeWhenAnotherHelpIsFixed = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== 'ledger') {
        setLedgerHintExpanded(false)
        setLedgerHintVisible(false)
      }
    }
    window.addEventListener(FIXED_ASSISTANT_HELP_EVENT, closeWhenAnotherHelpIsFixed)
    return () => window.removeEventListener(FIXED_ASSISTANT_HELP_EVENT, closeWhenAnotherHelpIsFixed)
  }, [])
  useEffect(() => {
    if (!openLedgerId || !openLedgerRequest || !ledgers.some((ledger) => ledger.id === openLedgerId)) {
      if (!openLedgerId) openedLedgerRequestRef.current = null
      return
    }
    if (openedLedgerRequestRef.current === openLedgerRequest) return
    openedLedgerRequestRef.current = openLedgerRequest
    setActiveLedgerId(openLedgerId)
    setNewLedger(false)
  }, [ledgers, openLedgerId, openLedgerRequest])
  useEffect(() => {
    if (!openLedgerId || !openLedgerRequest || activeLedgerId !== openLedgerId) {
      if (!openLedgerId) positionedLedgerRequestRef.current = null
      return
    }
    if (positionedLedgerRequestRef.current === openLedgerRequest) return
    const frame = window.requestAnimationFrame(() => {
      positionedLedgerRequestRef.current = openLedgerRequest
      const editor = editorRef.current
      if (!editor || typeof editor.scrollIntoView !== 'function') return
      editor.scrollIntoView({
        block: hasExpandedOrganizationGuide ? 'center' : 'start',
        behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeLedgerId, hasExpandedOrganizationGuide, openLedgerId, openLedgerRequest])
  useEffect(() => {
    if (!createLedgerRequest || openedLedgerRequestRef.current === createLedgerRequest) return
    openedLedgerRequestRef.current = createLedgerRequest
    add()
  }, [createLedgerRequest])
  useEffect(() => {
    if (!createLedgerRequest || !newLedger || positionedLedgerRequestRef.current === createLedgerRequest) return
    const frame = window.requestAnimationFrame(() => {
      positionedLedgerRequestRef.current = createLedgerRequest
      editorRef.current?.scrollIntoView({
        block: 'center',
        behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [createLedgerRequest, newLedger])
  useLayoutEffect(() => {
    if (!ledgerHintVisible) return
    const updatePosition = () => {
      const anchorRect = ledgerHintTriggerRef.current?.getBoundingClientRect()
      if (!anchorRect) return
      const tooltipRect = ledgerHintTooltipRef.current?.getBoundingClientRect()
      const tooltipWidth = tooltipRect?.width || 360
      const tooltipHeight = tooltipRect?.height || 48
      setLedgerHintPosition(resolveSidebarTooltipPosition(
        anchorRect,
        { width: tooltipWidth, height: tooltipHeight },
        { width: window.innerWidth, height: window.innerHeight },
        ledgerHintPanelRef.current?.getBoundingClientRect()
      ))
    }
    updatePosition()
    const layoutFrame = window.requestAnimationFrame(updatePosition)
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePosition)
    if (ledgerHintPanelRef.current) resizeObserver?.observe(ledgerHintPanelRef.current)
    if (ledgerHintTriggerRef.current) resizeObserver?.observe(ledgerHintTriggerRef.current)
    if (ledgerHintTooltipRef.current) resizeObserver?.observe(ledgerHintTooltipRef.current)
    ledgerHintPanelRef.current?.addEventListener('transitionend', updatePosition)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.cancelAnimationFrame(layoutFrame)
      resizeObserver?.disconnect()
      ledgerHintPanelRef.current?.removeEventListener('transitionend', updatePosition)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [ledgerHintVisible])
  useEffect(() => {
    const priorities = Object.fromEntries(draftLedgers.map((ledger) => [ledger.id, ledger.priority]))
    window.localStorage.setItem('bilimi:favorite-ledger-priorities', JSON.stringify(priorities))
  }, [draftLedgers])
  useEffect(() => {
    onEnabledStateChange?.(enableStore.getEnabledById())
    return enableStore.subscribe(() => onEnabledStateChange?.(enableStore.getEnabledById()))
  }, [enableStore, onEnabledStateChange])
  const active = draftLedgers.find((ledger) => ledger.id === activeLedgerId)
  const ledgerHasUnsavedChanges = (ledger: FavoriteLedger) =>
    !savedLedgerSnapshots[ledger.id] || JSON.stringify(ledgerEditorSnapshot(ledger)) !== JSON.stringify(savedLedgerSnapshots[ledger.id])
  const statusLabelForLedger = (ledger: FavoriteLedger) => {
    if (organizationActive) return ''
    const bindingLabel = bindingLabelForLedger(ledger)
    const unsaved = ledgerHasUnsavedChanges(ledger)
    return bindingLabel === '未绑定' && unsaved ? '未保存 · 未绑定' : bindingLabel || (unsaved ? '未保存' : '')
  }
  const editorStatusLabelForLedger = (ledger: FavoriteLedger) => {
    const bindingLabel = bindingLabelForLedger(ledger)
    const unsaved = ledgerHasUnsavedChanges(ledger)
    return bindingLabel === '未绑定' && unsaved ? '未保存 · 未绑定' : bindingLabel || (unsaved ? '未保存' : '')
  }
  const recoveredRemoteUnsavedCount = recoveredRemoteLedgers.filter((ledger) => ledgerHasUnsavedChanges(ledger)).length
  const recoveredRemotePendingCount = recoveredRemoteLedgers.length - recoveredRemoteUnsavedCount
  const recoveredRemoteStatusSummary = [
    recoveredRemotePendingCount ? `${recoveredRemotePendingCount} 个未绑定` : '',
    recoveredRemoteUnsavedCount ? `${recoveredRemoteUnsavedCount} 个未保存未绑定` : ''
  ].filter(Boolean).join('，')
  const activeVideoCount = active ? videoCountForLedger(active) : undefined
  const activeRemoteBindingIds = active ? remoteBindingIdsForLedger(active) : []
  const activePendingRemoteBinding = Boolean(active?.pendingRemoteBinding && (active.pendingRemoteFolderId ?? active.bilibiliFolderId)?.trim())
  const activeRules = active ? parseFavoriteLedgerRules(active) : { localKeywords: [] }
  const title = active ? displayTitle(active.displayName) : ''
  const validation = favoriteLedgerNameValidation(active?.displayName ?? '')
  const valid = Boolean(active && title.trim() && validation.valid)
  const canToggleLedgerList = draftLedgers.length > COLLAPSED_LEDGER_COUNT
  const fullLedgerListVisible = ledgerListExpanded && draftLedgers.length <= LEDGER_EAGER_RENDER_LIMIT
  const ledgersToDisplay = fullLedgerListVisible ? draftLedgers : draftLedgers.slice(0, COLLAPSED_LEDGER_COUNT)
  const projectEnabled = (items: FavoriteLedger[], enabledById: ReadonlyMap<string, boolean> = enableStore.getEnabledById()) => items.map((ledger) => ({
    ...ledger,
    enabled: isDeletedDefaultLedger(ledger) || isDefaultSystemLocked(ledger) ? true : enabledById.get(ledger.id) ?? ledger.enabled
  }))
  const backupEligibleLedgers = (items: FavoriteLedger[]) => projectEnabled(items)
    .filter((ledger) => (ledger.enabled || isDeletedDefaultLedger(ledger)) && ledger.syncState !== 'local-draft')
  const recoverableDeletedDefaultLedgers = draftLedgers.filter(isDeletedDefaultLedger)
  const hasRecoverableDeletedDefaultLedger = recoverableDeletedDefaultLedgers.length > 0
  const hasBackupEligibleLedger = backupEligibleLedgers(draftLedgers).length > 0
  const update = (patch: Partial<FavoriteLedger>) => setDraftLedgers((current) => current.map((ledger) => ledger.id === activeLedgerId ? { ...ledger, ...patch } : ledger))
  const persist = (next: FavoriteLedger[]) => {
    const previous = draftLedgers
    const persistVersion = ++persistVersionRef.current
    setDraftLedgers(next)
    setSavedLedgerSnapshots(Object.fromEntries(next.map((ledger) => [ledger.id, ledgerEditorSnapshot(ledger)])))
    void Promise.resolve(onSaveLedgers(next, { deleteDisabled: false })).catch(() => {
      if (persistVersionRef.current !== persistVersion) return
      setDraftLedgers(previous)
      setSavedLedgerSnapshots(Object.fromEntries(previous.filter((ledger) => !isRecoveredRemoteDraft(ledger)).map((ledger) => [ledger.id, ledgerEditorSnapshot(ledger)])))
    })
  }
  const flushTogglePersist = () => {
    if (toggleSaveInFlightRef.current) return
    const scheduled = pendingToggleSaveRef.current
    pendingToggleSaveRef.current = new Map()
    const scheduledBulk = pendingBulkSaveRef.current
    pendingBulkSaveRef.current = null
    if (!scheduledBulk && scheduled.size === 0) return
    const persistVersion = ++persistVersionRef.current
    toggleSaveInFlightRef.current = true
    const save = scheduledBulk
      ? (() => {
          const latestEnabledById = new Map(scheduledBulk.enabledById)
          for (const [id, mutation] of scheduled) latestEnabledById.set(id, mutation.enabled)
          return Promise.resolve(onSaveLedgersRef.current(projectEnabled(draftLedgers, latestEnabledById), { deleteDisabled: false }))
        })().catch(() => {
          if (persistVersionRef.current !== persistVersion || pendingToggleSaveRef.current.size || pendingBulkSaveRef.current) return
          enableStore.replaceEnabled(scheduledBulk.previousEnabled)
        })
      : Promise.all([...scheduled].map(async ([id, mutation]) => {
          try {
            await onSaveLedgerEnabledRef.current?.(id, mutation.enabled)
          } catch {
            if (toggleVersionsRef.current.get(id) !== mutation.version) return
            enableStore.setEnabled(id, mutation.previous)
          }
        }))
    void save.finally(() => {
      toggleSaveInFlightRef.current = false
      if (pendingToggleSaveRef.current.size || pendingBulkSaveRef.current) flushTogglePersist()
    })
  }
  const scheduleTogglePersist = () => {
    if (toggleSaveTimerRef.current !== null) window.clearTimeout(toggleSaveTimerRef.current)
    toggleSaveTimerRef.current = window.setTimeout(() => {
      toggleSaveTimerRef.current = null
      flushTogglePersist()
    }, LEDGER_TOGGLE_SAVE_DELAY_MS)
  }
  const toggle = (id: string) => {
    if (draftMutationLocked) return
    if (deletionModeActive) {
      deletionStore.toggle(id)
      return
    }
    const previousEnabled = enableStore.isEnabled(id)
    if (!enableStore.toggle(id)) return
    const version = (toggleVersionsRef.current.get(id) ?? 0) + 1
    toggleVersionsRef.current.set(id, version)
    const previousMutation = pendingToggleSaveRef.current.get(id)
    pendingToggleSaveRef.current.set(id, {
      previous: previousMutation?.previous ?? previousEnabled,
      enabled: enableStore.isEnabled(id),
      version
    })
    scheduleTogglePersist()
  }
  const toggleAll = () => {
    if (draftMutationLocked) return
    if (deletionModeActive) {
      deletionStore.toggleAll()
      return
    }
    const previousEnabled = enableStore.getEnabledById()
    if (!enableStore.toggleAll()) return
    pendingToggleSaveRef.current.clear()
    pendingBulkSaveRef.current = {
      previousEnabled: pendingBulkSaveRef.current?.previousEnabled ?? previousEnabled,
      enabledById: enableStore.getEnabledById()
    }
    scheduleTogglePersist()
  }
  const enterDeletionMode = () => {
    if (draftMutationLocked || deletionModeActive) return
    setDeletionModeActive(true)
    if (toggleSaveTimerRef.current !== null) window.clearTimeout(toggleSaveTimerRef.current)
    toggleSaveTimerRef.current = null
    flushTogglePersist()
    deletionStore.reset(enableEntries(draftLedgers, true))
  }
  const cancelDeletionMode = () => {
    if (!deletionModeActive) return
    setDeletionModeActive(false)
    deletionStore.reset(enableEntries(draftLedgers, true))
  }
  const beginDrag = (id: string, event: DragEvent<HTMLButtonElement>) => {
    if (draftMutationLocked) return
    setDraggedLedgerId(id)
    setDragTarget(null)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
  }
  const dragOver = (targetId: string, event: DragEvent<HTMLDivElement>) => {
    if (draftMutationLocked) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (!draggedLedgerId || draggedLedgerId === targetId) return setDragTarget(null)
    setDragTarget(targetId)
  }
  const dropOn = (targetId: string, event: DragEvent<HTMLDivElement>) => {
    if (draftMutationLocked) return
    event.preventDefault()
    const sourceId = event.dataTransfer.getData('text/plain') || draggedLedgerId
    setDraggedLedgerId(null)
    setDragTarget(null)
    if (!sourceId || sourceId === targetId) return
    const sourceIndex = draftLedgers.findIndex((ledger) => ledger.id === sourceId)
    const targetIndex = draftLedgers.findIndex((ledger) => ledger.id === targetId)
    if (sourceIndex < 0 || targetIndex < 0) return
    const reordered = [...draftLedgers]
    const [source] = reordered.splice(sourceIndex, 1)
    const target = draftLedgers[targetIndex]
    const nextTargetIndex = reordered.findIndex((ledger) => ledger === target)
    // The blue indicator marks the position above the target; keep the drop
    // result consistent with that visual cue in both drag directions.
    const insertionIndex = nextTargetIndex
    reordered.splice(insertionIndex, 0, source!)
    persist(reordered.map((ledger, index) => ({ ...ledger, priority: (index + 1) * 10 })))
  }
  const add = () => {
    if (draftMutationLocked) return
    const ledger: FavoriteLedger = { id: idFor('new-ledger'), displayName: BILIMI_LEDGER_PREFIX, keywords: [], ruleType: 'keyword', enabled: false, priority: (draftLedgers.length + 1) * 10, syncState: 'local-draft', isDefault: false }
    enableStore.reconcile(enableEntries([...draftLedgers, ledger]))
    setDraftLedgers((current) => [...current, ledger]); setActiveLedgerId(ledger.id); setNewLedger(true); setDraftDeletionError(null)
  }
  const close = () => {
    if (draftMutationLocked) return
    if (newLedger && activeLedgerId) setDraftLedgers((current) => current.filter((ledger) => ledger.id !== activeLedgerId))
    setActiveLedgerId(null); setNewLedger(false); setDraftDeletionError(null)
  }
  const resetLedgers = () => {
    const defaults = createDefaultFavoriteLedgers()
    // Older drafts can contain a user-created ledger carrying a now-reserved
    // default ID. Treat that record as the existing default during reset so we
    // keep its remote binding without rendering or saving two copies.
    const existingLedgersById = new Map(draftLedgers.map((ledger) => [ledger.id, ledger]))
    const defaultIds = new Set(defaults.map((ledger) => ledger.id))
    const resetDefaults = defaults.map((template) => {
      const existing = existingLedgersById.get(template.id)
      return {
        ...template,
        ...(existing ?? {}),
        displayName: template.displayName,
        keywords: [...template.keywords],
        enabled: defaultFavoriteSystemEnabled ? true : template.enabled,
        priority: template.priority,
        isDefault: true
      }
    })
    const resetCustom = draftLedgers
      .filter((ledger) => !ledger.isDefault && !defaultIds.has(ledger.id))
      .map((ledger, index) => ({ ...ledger, enabled: false, priority: (resetDefaults.length + index + 1) * 10 }))
    const next = [...resetDefaults, ...resetCustom]
    const previous = draftLedgers
    const persistVersion = ++persistVersionRef.current
    setDraftLedgers(next)
    enableStore.reset(enableEntries(next, false))
    setSavedLedgerSnapshots(Object.fromEntries(next.map((ledger) => [ledger.id, ledgerEditorSnapshot(ledger)])))
    setActiveLedgerId(null)
    setNewLedger(false)
    void Promise.resolve(onSaveLedgers(next, { deleteDisabled: false })).catch(() => {
      if (persistVersionRef.current !== persistVersion) return
      setDraftLedgers(previous)
      enableStore.reset(enableEntries(previous, false))
      setSavedLedgerSnapshots(Object.fromEntries(previous.filter((ledger) => !isRecoveredRemoteDraft(ledger)).map((ledger) => [ledger.id, ledgerEditorSnapshot(ledger)])))
    })
  }
  const save = async () => {
    if (!valid || draftMutationLocked || !active || !activeLedgerId) return
    const savingLedgerId = activeLedgerId
    const ledgerToSave = projectEnabled(draftLedgers).find((ledger) => ledger.id === savingLedgerId)
    if (organizationActive && ledgerToSave && ledgerToSave.ruleType !== 'deepseek' && onAnalyzeLedgerRule) {
      const analyzed = await onAnalyzeLedgerRule(ledgerToSave)
      if (!analyzed) return
    }
    const previous = ledgers
    const persistVersion = ++persistVersionRef.current
    const next = projectEnabled(draftLedgers).map((ledger) => {
      if (ledger.id !== activeLedgerId || (!isRecoveredRemoteDraft(ledger) && !isTransientNewDraft(ledger))) return ledger
      const { syncState: _syncState, ...savedLedger } = ledger
      return savedLedger
    })
    setDraftLedgers(next)
    enableStore.reconcile(enableEntries(next))
    setSavedLedgerSnapshots(Object.fromEntries(next.map((ledger) => [ledger.id, ledgerEditorSnapshot(ledger)])))
    void Promise.resolve(onSaveLedgers(next, { deleteDisabled: false })).catch(() => {
      if (persistVersionRef.current !== persistVersion) return
      setDraftLedgers(previous)
      setSavedLedgerSnapshots(Object.fromEntries(previous.filter((ledger) => !isRecoveredRemoteDraft(ledger)).map((ledger) => [ledger.id, ledgerEditorSnapshot(ledger)])))
    })
    setActiveLedgerId((current) => current === savingLedgerId ? null : current)
    setNewLedger(false)
  }
  const requestBackup = async () => {
    if (draftMutationLocked) return { ok: false, message: '当前收藏夹规则分析尚未完成，暂不能备册。' }
    if (backupInFlightRef.current) return backupInFlightRef.current
    const operation = (async () => {
      const currentLedgers = backupEligibleLedgers(draftLedgers)
      if (!currentLedgers.length) {
        return { ok: false, message: '请先保存并勾选至少一个 bilimi 收藏夹，再备册到 B 站。' }
      }
      const result = await onSyncLedgers(currentLedgers, { deleteDisabled: false, rediscoverDeletedRemoteDrafts: true }) as {
        ok?: boolean
        unboundCandidates?: RebindCandidateEntry[]
      } | undefined
      if (result?.unboundCandidates?.length) {
        setRebindCandidates(result.unboundCandidates)
        setRebindSelections(Object.fromEntries(result.unboundCandidates
          .filter((entry) => entry.candidates.length)
          .map((entry) => [entry.ledgerId, entry.candidates[0].id])))
        setRebindSelectedFolderIds(Object.fromEntries(result.unboundCandidates
          .map((entry) => [entry.ledgerId, entry.candidates.map((candidate) => candidate.id)])))
      }
      return result
    })()
    backupInFlightRef.current = operation
    try {
      return await operation
    } finally {
      if (backupInFlightRef.current === operation) backupInFlightRef.current = null
    }
  }
  useImperativeHandle(ref, () => ({ requestBackup }))

  const requestSync = async () => {
    if (draftMutationLocked) return
    const currentLedgers = projectEnabled(draftLedgers)
    if (!deletionModeActive) {
      await requestBackup()
      return
    }
    const selectedLedgers = currentLedgers.filter((ledger) => deletionStore.isEnabled(ledger.id) && !ledger.isDefault)
    if (selectedLedgers.length && !await deleteLocalFavoriteLedgers(selectedLedgers.map((ledger) => ledger.id), currentLedgers)) return
    setDeletionModeActive(false)
  }
  const deleteLocalFavoriteLedgers = async (ledgerIds: readonly string[], sourceLedgers = projectEnabled(draftLedgers)) => {
    const deletedIds = new Set(ledgerIds)
    const selectedLedgers = draftLedgers.filter((ledger) => deletedIds.has(ledger.id) && !ledger.isDefault)
    if (!selectedLedgers.length) return true
    const persistedLedgers = selectedLedgers.filter((ledger) => ledgers.some((item) => item.id === ledger.id))
    if (persistedLedgers.length) {
      try {
        const accountMid = window.bilimiDesktop?.readBilibiliAccountMid
          ? await window.bilimiDesktop.readBilibiliAccountMid()
          : ''
        if (!accountMid || !window.bilimiDesktop?.deleteFavoriteLedgersLocal) throw new Error('Local favorite ledger deletion is unavailable.')
        await window.bilimiDesktop.deleteFavoriteLedgersLocal(accountMid, persistedLedgers.map((ledger) => ledger.id))
      } catch {
        setDeletionError('删除未成功，请稍后重试。')
        setDraftDeletionError('删除未成功，请稍后重试。')
        return false
      }
    }
    const next = sourceLedgers
      .filter((ledger) => !deletedIds.has(ledger.id) || ledger.isDefault)
      .map((ledger) => ({ ...ledger, enabled: isDefaultSystemLocked(ledger) ? true : ledger.enabled }))
    setDraftLedgers(next)
    enableStore.reset(enableEntries(next, false))
    deletionStore.reset(enableEntries(next, true))
    setSavedLedgerSnapshots(Object.fromEntries(next.filter((ledger) => !isRecoveredRemoteDraft(ledger)).map((ledger) => [ledger.id, ledgerEditorSnapshot(ledger)])))
    if (activeLedgerId && deletedIds.has(activeLedgerId)) {
      setActiveLedgerId(null)
      setNewLedger(false)
    }
    setDeletionError(null)
    setDraftDeletionError(null)
    for (const ledger of persistedLedgers) onDeleteLedger?.(ledger.id)
    return true
  }
  const deleteUnsavedDraft = async (ledger: FavoriteLedger) => {
    if (draftMutationLocked || !isDraftDirectlyDeletable(ledger)) return
    const wasPersisted = ledgers.some((item) => item.id === ledger.id)
    if (wasPersisted) {
      try {
        const accountMid = window.bilimiDesktop?.readBilibiliAccountMid
          ? await window.bilimiDesktop.readBilibiliAccountMid()
          : ''
        if (!accountMid || !window.bilimiDesktop?.deleteFavoriteLedgerDraft) throw new Error('Draft deletion is unavailable.')
        await window.bilimiDesktop.deleteFavoriteLedgerDraft(accountMid, ledger.id)
      } catch {
        setDraftDeletionError('删除未成功，请稍后重试。')
        return
      }
    }
    const next = draftLedgers.filter((item) => item.id !== ledger.id)
    setDraftLedgers(next)
    enableStore.reset(enableEntries(next, false))
    deletionStore.reset(enableEntries(next, true))
    setSavedLedgerSnapshots(Object.fromEntries(next.filter((item) => !isRecoveredRemoteDraft(item)).map((item) => [item.id, ledgerEditorSnapshot(item)])))
    setActiveLedgerId(null)
    setNewLedger(false)
    setDraftDeletionError(null)
    if (wasPersisted) onDeleteLedger?.(ledger.id)
  }
  const confirmRebinding = async () => {
    if (!rebindCandidates || draftMutationLocked) return
    const ledgerIds = rebindCandidates.map((entry) => entry.ledgerId)
    if (ledgerIds.some((ledgerId) => !(rebindSelectedFolderIds[ledgerId] ?? []).length)) return
    const rebindRemoteFolders = Object.fromEntries(rebindCandidates.map((entry) => [
      entry.ledgerId,
      entry.candidates.filter((candidate) => (rebindSelectedFolderIds[entry.ledgerId] ?? []).includes(candidate.id))
        .map(({ id, title, memberCount }) => ({ id, title, memberCount }))
    ]))
    const result = await onSyncLedgers(backupEligibleLedgers(draftLedgers), {
      deleteDisabled: false,
      rediscoverDeletedRemoteDrafts: true,
      rebindRemoteFolderIds: rebindSelections,
      rebindRemoteFolders
    }) as { ok?: boolean; unboundCandidates?: RebindCandidateEntry[] } | undefined
    if (result?.unboundCandidates?.length) {
      setRebindCandidates(result.unboundCandidates)
      setRebindSelections(Object.fromEntries(result.unboundCandidates
        .filter((entry) => entry.candidates.length)
        .map((entry) => [entry.ledgerId, entry.candidates[0].id])))
      setRebindSelectedFolderIds(Object.fromEntries(result.unboundCandidates
        .map((entry) => [entry.ledgerId, entry.candidates.map((candidate) => candidate.id)])))
      return
    }
    if (result?.ok !== false) {
      setRebindCandidates(null)
      setRebindSelections({})
      setRebindSelectedFolderIds({})
    }
  }
  const duplicateLedgerTitleCounts = draftLedgers.reduce((counts, ledger) => {
    const title = displayTitle(ledger.displayName) || ledger.displayName
    counts.set(title, (counts.get(title) ?? 0) + 1)
    return counts
  }, new Map<string, number>())
  const duplicateLedgerTitleIndexes = new Map<string, number>()
  return <section ref={ledgerHintPanelRef} className="favorite-ledger-panel__ledger-list" aria-label="收藏夹">
    <div className="favorite-ledger-panel__workspace">
      <section className="favorite-ledger-panel__checklist" aria-label="收藏夹规则">
        <div className="favorite-ledger-panel__category-header"><button ref={ledgerHintTriggerRef} type="button" className="favorite-ledger-panel__help-toggle favorite-ledger-panel__section-title" aria-label={`${ledgerHintExpanded ? '收起' : '固定显示'}收藏夹说明`} aria-expanded={ledgerHintExpanded} aria-describedby="favorite-ledger-help-tooltip" onMouseEnter={() => setLedgerHintVisible(true)} onMouseLeave={() => { if (!ledgerHintExpanded) setLedgerHintVisible(false) }} onFocus={() => setLedgerHintVisible(true)} onBlur={() => { if (!ledgerHintExpanded) setLedgerHintVisible(false) }} onClick={() => setLedgerHintExpanded((open) => { const next = !open; setLedgerHintVisible(next); if (next) window.dispatchEvent(new CustomEvent(FIXED_ASSISTANT_HELP_EVENT, { detail: 'ledger' })); return next })}><h3>收藏夹</h3><Chevron /></button><div className="favorite-ledger-panel__category-actions"><button type="button" disabled={draftMutationLocked} onClick={() => setResetConfirmOpen(true)}>重置</button><FavoriteLedgerEnableSummary store={deletionModeActive ? deletionStore : enableStore}>{({ allOperableEnabled }) => <button type="button" data-testid="favorite-ledger-cancel-all" disabled={draftMutationLocked} onClick={toggleAll}>{allOperableEnabled ? '取消全选' : '全选'}</button>}</FavoriteLedgerEnableSummary><button type="button" aria-label={hasRecoverableDeletedDefaultLedger ? '恢复备册收藏夹' : '备册收藏夹'} disabled={deletionModeActive ? draftMutationLocked : draftMutationLocked || !hasBackupEligibleLedger} title={!deletionModeActive && hasRecoverableDeletedDefaultLedger ? '已删除的默认 bilimi 收藏夹可通过备册恢复；系统会先核验并要求确认对应的 B 站收藏夹。' : !deletionModeActive && !hasBackupEligibleLedger ? '请先保存并勾选至少一个 bilimi 收藏夹，再备册到 B 站。' : undefined} onClick={() => void requestSync()}>{deletionModeActive ? '删除' : hasRecoverableDeletedDefaultLedger ? '恢复备册收藏夹' : '备册'}</button><button type="button" className="favorite-ledger-panel__mode-toggle" aria-label={deletionModeActive ? '取消删除模式' : '展开删除模式'} title={deletionModeActive ? '取消删除 bilimi 工作夹模式' : '打开删除 bilimi 工作夹模式'} disabled={draftMutationLocked} onClick={deletionModeActive ? cancelDeletionMode : enterDeletionMode}>×</button></div></div>
        {createPortal(<div ref={ledgerHintTooltipRef} id="favorite-ledger-help-tooltip" className="favorite-ledger-panel__help-tooltip" role="tooltip" data-visible={ledgerHintVisible || undefined} style={ledgerHintPosition}>{LEDGER_SYNC_HINTS.map((hint) => <p key={hint.title}><strong className="favorite-ledger-panel__help-tooltip-title">{hint.title}</strong>{hint.detail}</p>)}</div>, document.body)}
        <div className="favorite-ledger-panel__chips">{ledgersToDisplay.map((ledger) => {
          const disabledBySystem = isSystemDisabled(ledger)
          const bindingLabel = statusLabelForLedger(ledger)
          const baseLedgerTitle = displayTitle(ledger.displayName) || ledger.displayName
          const duplicateIndex = (duplicateLedgerTitleIndexes.get(baseLedgerTitle) ?? 0) + 1
          duplicateLedgerTitleIndexes.set(baseLedgerTitle, duplicateIndex)
          const duplicateSuffix = (duplicateLedgerTitleCounts.get(baseLedgerTitle) ?? 0) > 1 ? String.fromCharCode(9311 + duplicateIndex) : ''
          const ledgerLabel = `${disabledBySystem ? '（已停用）' : ''}${baseLedgerTitle}${duplicateSuffix}`
          const dropPosition = dragTarget === ledger.id ? 'before' : undefined
          return <div key={ledger.id} data-testid={`favorite-ledger-chip-${ledger.id}`} className="favorite-ledger-panel__chip-item"
            data-dragging={draggedLedgerId === ledger.id ? 'true' : undefined} data-drop-position={dropPosition}
            data-default-system-disabled={disabledBySystem ? 'true' : undefined} aria-label={dropPosition ? `插入到${displayTitle(ledger.displayName)}上方` : undefined}
            onDragOver={(event) => dragOver(ledger.id, event)} onDrop={(event) => dropOn(ledger.id, event)}>
            <FavoriteLedgerEnableButton store={deletionModeActive ? deletionStore : enableStore} id={ledger.id} onToggle={() => toggle(ledger.id)}>{({ enabled, toggle: toggleEnabled }) => {
              const ledgerDisplayName = ledger.displayName
              return <>
              <button type="button" draggable={!draftMutationLocked} aria-label={ledgerLabel} title={`${ledgerDisplayName}${bindingLabel ? ` · ${bindingLabel}` : ''}`} aria-pressed={enabled && !disabledBySystem}
                onDragStart={(event) => beginDrag(ledger.id, event)} onDragEnd={() => { setDraggedLedgerId(null); setDragTarget(null) }} onClick={() => {
                if (activeLedgerId === ledger.id) {
                  if (draftMutationLocked) return
                  setActiveLedgerId(null)
                  setNewLedger(false)
                  setDraftDeletionError(null)
                  return
                }
                setActiveLedgerId(ledger.id)
                setNewLedger(false)
                setDraftDeletionError(null)
              }}><span className="favorite-ledger-panel__chip-label">{ledgerLabel}</span>{bindingLabel ? <small className="favorite-ledger-panel__binding-status" data-binding-state={bindingStateForLedger(ledger, bindingLabel)}>{bindingLabel}</small> : null}</button>
              <button type="button" draggable={false} className="favorite-ledger-panel__chip-action" aria-label={`${enabled ? (deletionModeActive ? '取消删除' : '移出同步') : (deletionModeActive ? '加入删除' : '加入同步')} ${ledgerDisplayName}`} data-enabled={enabled && !disabledBySystem} disabled={draftMutationLocked || (deletionModeActive ? !deletionStore.isOperable(ledger.id) : !isOperable(ledger))} onDragStart={(event) => event.preventDefault()} onClick={toggleEnabled}>{enabled && !disabledBySystem ? '✓' : '+'}</button>
            </>
            }}</FavoriteLedgerEnableButton>
          </div>
        })}</div>
        {deletionModeActive && deletionError ? <p role="alert" className="favorite-ledger-panel__notice">{deletionError}</p> : null}
        {recoveredRemoteLedgers.length ? <p className="favorite-ledger-panel__notice">检测到 B 站中有 {recoveredRemoteLedgers.reduce((count, ledger) => count + new Set([...(ledger.bilibiliFolderIds ?? []), ledger.bilibiliFolderId].filter(Boolean)).size, 0)} 个疑似 bilimi 工作夹：{recoveredRemoteStatusSummary}。请先编辑保存好收藏夹规则，再点击“备册”确认绑定；尚未建立绑定前，只可预分类，不能执行 B 站分类同步；更换电脑时建议优先迁移本地数据。</p> : null}
        <div className="favorite-ledger-panel__list-toggle"><button type="button" disabled={draftMutationLocked} onClick={add}>新建收藏夹</button>{canToggleLedgerList ? <button type="button" aria-expanded={fullLedgerListVisible} onClick={() => setLedgerListExpanded((expanded) => !expanded)}>{fullLedgerListVisible ? '折叠' : '展开'}</button> : null}</div>
      </section>
      {missingLedgerIds.length && !organizationActive ? <p className="favorite-ledger-panel__notice" role="alert">部分 Bilimi 收藏夹尚未备册。</p> : null}
      {active ? <section ref={editorRef} className="favorite-ledger-panel__editor" aria-label="当前收藏夹" data-ledger-id={active.id}><div className="favorite-ledger-panel__editor-title"><strong>{newLedger ? '新建收藏夹' : '正在编辑：'}{active.displayName}</strong><div className="favorite-ledger-panel__editor-actions"><button type="button" disabled={!valid || draftMutationLocked} onClick={() => void save()}>保存</button><button type="button" disabled={draftMutationLocked} onClick={close}>取消</button>{!active.isDefault ? <button type="button" disabled={draftMutationLocked} onClick={() => { if (isDraftDirectlyDeletable(active)) { void deleteUnsavedDraft(active); return }; void deleteLocalFavoriteLedgers([active.id]) }}>删除</button> : null}</div></div>
         {remoteOnlyDraftLedgerIds.includes(active.id) && active.bilibiliFolderId ? <p className="favorite-ledger-panel__remote-draft-notice">
           发现 B 站疑似 bilimi 收藏夹，本地尚未建立绑定，可编辑保存好之后备册；更换电脑时建议先迁移数据。
           {onDismissRemoteDraftReminder ? <button type="button" onClick={() => void onDismissRemoteDraftReminder(active.id, [...new Set([
             ...(active.bilibiliFolderIds ?? []), active.bilibiliFolderId!
           ])])}>不再提醒</button> : null}
          </p> : null}
         {draftDeletionError ? <p className="favorite-ledger-panel__notice" role="alert">{draftDeletionError}</p> : null}
         {draftRuleAnalysis ? <div className="favorite-ledger-panel__rule-analysis" role="status">
          <span>{draftRuleAnalysis.status === 'canceling' ? '正在取消分析…' : `正在分析 ${draftRuleAnalysis.completedItemCount} / ${draftRuleAnalysis.totalItemCount} 条`}</span>
          <progress aria-label="收藏夹规则分析进度" value={draftRuleAnalysis.completedItemCount} max={Math.max(1, draftRuleAnalysis.totalItemCount)}
            aria-valuemin={0} aria-valuenow={draftRuleAnalysis.completedItemCount} aria-valuemax={Math.max(1, draftRuleAnalysis.totalItemCount)} />
          <button type="button" disabled={draftRuleAnalysis.status === 'canceling'} onClick={onCancelDraftRuleAnalysis}>取消分析</button>
        </div> : draftRuleAnalysisError ? <p className="favorite-ledger-panel__notice" role="alert">{draftRuleAnalysisError}</p> : null}
        <label><span className="favorite-ledger-panel__ledger-name-label"><span>册名 <small data-invalid={!valid}>{validation.length}/{BILIBILI_FAVORITE_LEDGER_NAME_MAX_LENGTH}</small></span>{activeVideoCount === undefined ? null : <small className="favorite-ledger-panel__ledger-video-count">{activeVideoCount} 个视频</small>}{editorStatusLabelForLedger(active) ? <small className="favorite-ledger-panel__binding-status" data-binding-state={bindingStateForLedger(active, editorStatusLabelForLedger(active))}>{editorStatusLabelForLedger(active)}</small> : null}</span><span className="favorite-ledger-panel__prefixed-input"><span className="favorite-ledger-panel__fixed-prefix" aria-hidden="true">{BILIMI_LEDGER_PREFIX}</span><input aria-label="册名" disabled={draftMutationLocked} value={title} onChange={(event) => update({ displayName: `${BILIMI_LEDGER_PREFIX}${event.currentTarget.value}` })} /></span>{activeRemoteBindingIds.length ? <small className="favorite-ledger-panel__binding-summary">B站绑定：{activeRemoteBindingIds.length} 个收藏夹{activeVideoCount === undefined ? '' : `，共 ${activeVideoCount} 个视频`}</small> : null}{activePendingRemoteBinding ? <small className="favorite-ledger-panel__binding-summary">新增分区待确认绑定</small> : null}{!validation.valid ? <small role="alert">B站收藏夹名称最多20个字，当前{validation.length}个字</small> : active.bilibiliFolderId && active.bilibiliFolderTitle && active.bilibiliFolderTitle !== active.displayName ? <small className="favorite-ledger-panel__name-sync-status">册名不同步；下次备册会按 bilimi 册名更新 B 站。</small> : null}</label>
        <label>收藏夹种类<select aria-label="收藏夹种类" disabled={draftMutationLocked || active.isDefault} value={active.ruleType ?? 'keyword'} onChange={(event) => update({ ruleType: event.currentTarget.value as FavoriteLedgerRuleType, keywords: [] })}>{TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
        <label>{ruleLabel(active.ruleType)}<textarea aria-label={ruleLabel(active.ruleType)}
          disabled={draftMutationLocked}
          value={(active.ruleType ?? 'keyword') === 'deepseek' ? active.keywords.join('\n') : activeRules.localKeywords.join('、')}
          onChange={(event) => update({ keywords: composeKeywords(event.currentTarget.value, activeRules.deepSeekConstraint ?? '', active.ruleType ?? 'keyword') })} /></label>
        {(active.ruleType ?? 'keyword') !== 'deepseek' ? <label className="favorite-ledger-panel__deepseek-constraint-line">
          <span>DeepSeek约束：</span>
          <input aria-label="DeepSeek约束" disabled={draftMutationLocked} value={activeRules.deepSeekConstraint ?? ''}
            onChange={(event) => update({ keywords: composeKeywords(activeRules.localKeywords.join('、'), event.currentTarget.value, active.ruleType ?? 'keyword') })} />
        </label> : null}
        <p className="favorite-ledger-panel__keyword-hint">{ruleHint(active.ruleType)}</p>
      </section> : null}
      {rebindCandidates ? <OldFavoriteModal title="确认绑定 bilimi 收藏夹" confirmLabel="确认绑定" confirmDisabled={rebindCandidates.some((entry) => !(rebindSelectedFolderIds[entry.ledgerId] ?? []).length)} onCancel={() => { setRebindCandidates(null); setRebindSelections({}); setRebindSelectedFolderIds({}) }} onConfirm={() => void confirmRebinding()}>
        <p>检测到 B 站已有疑似 bilimi 收藏夹，请确认它们是否属于同一个 bilimi 工作夹。系统不会按名称自动绑定。</p>
        {rebindCandidates.map((entry) => {
          const ledger = draftLedgers.find((item) => item.id === entry.ledgerId)
          const logicalTitle = displayTitle(ledger?.displayName ?? entry.ledgerId)
          const candidates = entry.candidates
            .map((candidate, index) => ({ candidate, index }))
            .sort((left, right) => rebindShardNumber(left.candidate.title, logicalTitle) - rebindShardNumber(right.candidate.title, logicalTitle) || left.index - right.index)
            .map(({ candidate }) => candidate)
          const selectedIds = rebindSelectedFolderIds[entry.ledgerId] ?? []
          const allSelected = candidates.length > 0 && selectedIds.length === candidates.length
          return <div key={entry.ledgerId} className="favorite-ledger-panel__rebind-choice">
            <label>
              <input type="checkbox" checked={allSelected} ref={(node) => { if (node) node.indeterminate = selectedIds.length > 0 && !allSelected }} onChange={(event) => {
                const nextIds = event.currentTarget.checked ? candidates.map((candidate) => candidate.id) : []
                setRebindSelectedFolderIds((current) => ({ ...current, [entry.ledgerId]: nextIds }))
                setRebindSelections((current) => ({ ...current, [entry.ledgerId]: nextIds[0] ?? '' }))
              }} />
              <span>{logicalTitle}（共 {candidates.reduce((count, candidate) => count + candidate.memberCount, 0)} 个视频）</span>
            </label>
            {candidates.length > 1 || candidates.some((candidate) => candidate.bindingFailureReason) ? <div className="favorite-ledger-panel__rebind-candidates">
              {candidates.map((candidate, index) => {
                const shardNumber = rebindShardNumber(candidate.title, logicalTitle)
                const displayedShardNumber = shardNumber === Number.MAX_SAFE_INTEGER ? index + 1 : shardNumber
                return <label key={candidate.id}><input type="checkbox" checked={selectedIds.includes(candidate.id)} onChange={(event) => setRebindSelectedFolderIds((current) => {
                  const nextIds = event.currentTarget.checked
                    ? [...new Set([...selectedIds, candidate.id])]
                    : selectedIds.filter((id) => id !== candidate.id)
                  setRebindSelections((selection) => ({ ...selection, [entry.ledgerId]: nextIds[0] ?? '' }))
                  return { ...current, [entry.ledgerId]: nextIds }
                })} />分册 {displayedShardNumber}：{candidate.title}（{candidate.memberCount} 个视频）{candidate.bindingFailureReason ? ` — 绑定失败：${candidate.bindingFailureReason}` : ''}</label>
              })}
            </div> : null}
          </div>
        })}
      </OldFavoriteModal> : null}
    </div>
    {resetConfirmOpen ? <OldFavoriteModal title="重置收藏夹规则？" confirmLabel="确认重置" onCancel={() => setResetConfirmOpen(false)} onConfirm={() => { resetLedgers(); setResetConfirmOpen(false) }}><p>恢复默认收藏夹名称和分类规则，保留自建收藏夹但取消其勾选，不会删除已有收藏夹。</p></OldFavoriteModal> : null}
  </section>
})

function Chevron() {
  return <svg className="favorite-ledger-panel__chevron" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m3 6 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
