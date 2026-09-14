import {
  BILIBILI_FAVORITE_LEDGER_NAME_MAX_LENGTH,
  BILIMI_LEDGER_PREFIX,
  createRemoteObservationFavoriteLedgerId,
  createUserFavoriteLedgerId,
  createDefaultFavoriteLedgers,
  favoriteLedgerNameValidation,
  stripBilimiLedgerPrefix
} from '@shared/favoriteLedgers'
import { DEEPSEEK_CONSTRAINT_MARKER, parseFavoriteLedgerRules } from '@shared/favoriteLedgerConstraints'
import {
  applyConfirmedManagedFavoriteRemoteFolderDeletion,
  restoreDefaultFavoriteLedgerAfterLocalDeletion
} from '@shared/favoriteLedgerDeletion'
import { isUnsavedFavoriteLedgerDraft } from '@shared/favoriteLedgerDraftDeletion'
import { favoriteLedgerBackupState, favoriteLedgerBackupStateLabel } from '@shared/favoriteLedgerBackupState'
import type {
  FavoriteLedger,
  AssistantAutomationResult,
  FavoriteLedgerBoundRenameCandidate,
  FavoriteLedgerRuleType,
  FavoriteLedgerSaveOptions,
  RemoteFavoriteLedgerObservation
} from '@shared/types'
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import { OldFavoriteModal } from './OldFavoriteModal'
import { resolveSidebarTooltipPosition } from './sidebarTooltipPosition'
import {
  managedFavoriteFolderDeletionFailureMessage,
  managedFavoriteFolderDeletionSucceeded
} from './managedFavoriteFolderDeletionFeedback'
import {
  FavoriteLedgerEnableButton,
  FavoriteLedgerEnableStore,
  FavoriteLedgerEnableSummary,
  type FavoriteLedgerEnableEntry
} from './favoriteLedgerEnableStore'

type FavoriteLedgerOverviewProps = {
  /** Account identity already resolved by the owning panel. */
  currentAccountMid?: string
  /** Signed-out device-local identity for the narrow saved-unbacked toggle only. */
  localFavoriteToggleAccountMid?: string
  ledgers: FavoriteLedger[]
  missingLedgerIds: string[]
  unboundLedgerIds?: string[]
  remoteOnlyDraftLedgerIds?: string[]
  /** Read-only observations triggered by a manual B站收藏夹 mutation. */
  observedRemoteObservations?: readonly RemoteFavoriteLedgerObservation[]
  /** Read-only exact-ID rename observations triggered by a manual B站收藏夹 mutation. */
  observedBoundRenameCandidates?: readonly FavoriteLedgerBoundRenameCandidate[]
  remoteDiscoveryNoticeDismissed?: boolean
  onDismissRemoteDiscoveryNotice?: () => void
  onDismissRemoteDraftReminder?: (ledgerId: string, remoteFolderIds: string[]) => Promise<void> | void
  /** Exact backup targets while the toolbar is painting its busy state before the request begins. */
  backupPreparationLedgerIds?: readonly string[]
  organizationActive?: boolean
  hasExpandedOrganizationGuide?: boolean
  defaultFavoriteSystemEnabled?: boolean
  openLedgerId?: string
  openLedgerRequestVersion?: number
  createLedger?: boolean
  createLedgerRequestVersion?: number
  onSaveLedgers: (ledgers: FavoriteLedger[], options?: FavoriteLedgerSaveOptions) => Promise<unknown> | void
  onSaveLedgerEnabled?: (ledgerId: string, enabled: boolean) => Promise<unknown> | void
  onEnabledStateChange?: (
    enabledById: ReadonlyMap<string, boolean>,
    source?: 'editor-unsaved' | 'organization-selection'
  ) => void
  /** Active-round recommendations use workspace selection instead of the global enabled preference. */
  onOrganizationRecommendationToggle?: (ledgerId: string, enabled: boolean) => boolean | Promise<boolean>
  /** Workspace recommendation selection projects onto candidate cards without persisting a global toggle. */
  organizationRecommendationEnabledById?: ReadonlyMap<string, boolean>
  /** Saved rules use the current organization-round selection rather than the global preference. */
  onOrganizationSavedLedgerToggle?: (ledgerId: string, enabled: boolean) => boolean | Promise<boolean>
  /** Bulk saved-rule selection commits one complete active-round selection to avoid stale per-row writes. */
  onOrganizationSavedLedgerSelectionChange?: (ledgerIds: string[]) => boolean | Promise<boolean>
  organizationSavedLedgerEnabledById?: ReadonlyMap<string, boolean>
  onDeleteLedger?: (ledgerId: string) => boolean | void | Promise<boolean | void>
  /** A remote-only draft was confirmed deleted from B站 and must not be re-projected by its owner. */
  onRemoteDraftDeleted?: (ledgerId: string) => void
  onBeforeDeleteLedger?: (ledgerId: string) => Promise<void> | void
  onSyncLedgers?: (ledgers: FavoriteLedger[], options?: FavoriteLedgerSaveOptions) => Promise<unknown> | void
  /** Called only after an explicit candidate-bind confirmation reaches a terminal result. */
  onBackupConfirmationFinished?: (result: { ok?: boolean; message?: string; unboundCandidates?: RebindCandidateEntry[] } | undefined) => void
  draftRuleAnalysis?: {
    ledgerId: string
    status: 'running' | 'canceling'
    completedItemCount: number
    totalItemCount: number
  } | null
  draftRuleAnalysisError?: string | null
  onAnalyzeLedgerRule?: (ledger: FavoriteLedger) => Promise<unknown> | void
  onCancelDraftRuleAnalysis?: () => void
}

export type FavoriteLedgerOverviewHandle = {
  getBackupTargetLedgerIds: () => string[]
  requestBackup: (options?: {
    targetLedgerIds?: readonly string[]
    confirmedBackupOptions?: Pick<FavoriteLedgerSaveOptions, 'confirmCreateAndBind' | 'rebindRemoteFolderIds' | 'rebindRemoteFolders'>
    suppressConfirmationDialog?: boolean
    /** Omit/true for the normal direct path; false explicitly requests a preflight. */
    skipRemoteObservationPreflight?: boolean
    onDeferredRemoteDiscoveryBackupFinished?: (result: { ok?: boolean; message?: string } | undefined) => void | Promise<void>
  }) => Promise<unknown>
}

type RebindCandidateEntry = {
  ledgerId: string
  candidates: Array<{
    id: string
    title: string
    memberCount: number
    shardNumber?: number
    bindingFailureReason?: string
  }>
}

type RemoteDiscoveryProcessingMode = 'details' | 'backup'

type RemoteDiscoveryProcessingState = {
  mode: RemoteDiscoveryProcessingMode
  observations: RemoteFavoriteLedgerObservation[]
  renameCandidates: FavoriteLedgerBoundRenameCandidate[]
  backupTargetLedgerIds: string[]
  onDeferredBackupFinished?: (result: { ok?: boolean; message?: string } | undefined) => void | Promise<void>
}

type FavoriteLedgerRemoteDiscoveryResult = AssistantAutomationResult & {
  unboundCandidates?: RebindCandidateEntry[]
  boundRenameCandidates?: FavoriteLedgerBoundRenameCandidate[]
  remoteObservations?: RemoteFavoriteLedgerObservation[]
  remoteDiscoveryProcessingDeferred?: boolean
}

type ManagedFolderDeletionCandidate = {
  logicalLedgerId: string
  remoteFolderId?: string
  title: string
  memberCount: number
  state: 'bound' | 'local-only' | 'unbound-name-match' | 'unbound-historical-id' | 'missing-remote'
  requiresUnboundAcknowledgement: boolean
}

type ManagedDeletionScope = 'local-only' | 'bilibili'

type ManagedDeletionPlan = {
  remoteCustomLedgerIds: string[]
  remoteDefaultLedgerIds: string[]
  remoteDraftTargets: Record<string, { remoteFolderId: string; title: string }>
  historicalBindingTargets: Record<string, Array<{ remoteFolderId: string; title: string }>>
  localCustomLedgerIds: string[]
  localDefaultLedgerIds: string[]
  draftLedgerIds: string[]
  candidates: ManagedFolderDeletionCandidate[]
  confirmedRemoteFolderIds?: string[]
}

type ManagedRemoteDeletionResult = {
  status: 'succeeded' | 'partial-failed' | 'failed' | 'result-unknown'
  succeededRemoteFolderIds: string[]
  failedRemoteFolderIds: string[]
  unknownRemoteFolderIds: string[]
  unattemptedRemoteFolderIds: string[]
  failures: Array<{
    remoteFolderId: string
    title: string
    outcome: 'failed' | 'result-unknown'
    message: string
  }>
}

function managedDeletionErrorMessage(error: unknown) {
  const detail = error instanceof Error ? error.message : ''
  if (/managed-folder-deletion-preview-stale/i.test(detail)) {
    return 'B 站收藏夹目录已变化，已停止删除；请重新打开删除确认后再试。'
  }
  if (/csrf-missing|account-mismatch|account changed|remote account mismatch|page target is unavailable|target-unavailable|favorite-repository-binding-title-stale|remote folder verification failed|response-category=html|network-failure|remote-timeout|invalid-response|remote-ambiguous|http-status=/i.test(detail)) {
    return managedFavoriteFolderDeletionFailureMessage(error)
  }
  return '删除未成功，请稍后重试。'
}

const LEDGER_SYNC_HINTS = [
  { title: '小咪提醒：', detail: '同一个视频可以保存在多个收藏夹里。整理收藏会把视频复制添加到 bilimi 收藏夹，不会移出原有的普通 B 站收藏夹，主人放心使用吧～（bilimi 收藏夹和分类视频支持删除，但需谨慎操作呦）' },
  { title: '自定义收藏夹：', detail: '点击收藏夹名称可以编辑；按住并拖动可调整顺序。' },
  { title: '勾选 bilimi 收藏夹：', detail: '勾选的收藏夹会用于批阅预分类和整理收藏分类。预分类会显示视频建议归类的位置；备册后才能将分类结果同步到 B 站。' },
  { title: '备册到 B 站：', detail: '备册会将已勾选的 bilimi 收藏夹创建或更新到 B 站，为将批阅和整理结果同步到 B 站做好准备。' },
  { title: '删除 bilimi 收藏夹：', detail: '点击右侧“×”进入删除模式，勾选要删除的自建收藏夹或草稿后点击“删除”。右侧删除只会移除本地草稿或规则，不会删除收藏库工作夹；默认收藏夹不可删除。可选择是否同时删除对应的 B 站收藏夹。' },
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
function boundRenameShardKey(
  ledgerId: string,
  shard: FavoriteLedgerBoundRenameCandidate['shards'][number]
) {
  return `${ledgerId}:${shard.remoteFolderId}:${shard.shardNumber}`
}
function rebindShardNumber(title: string, logicalTitle: string) {
  const candidateTitle = displayTitle(title)
  if (candidateTitle === logicalTitle) return 1
  const match = candidateTitle.match(new RegExp(`^${logicalTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}·([2-9]\\d*)$`, 'u'))
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}
function orderedRebindCandidates(
  candidates: RebindCandidateEntry['candidates'],
  logicalTitle: string
) {
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => (left.candidate.shardNumber ?? rebindShardNumber(left.candidate.title, logicalTitle)) - (right.candidate.shardNumber ?? rebindShardNumber(right.candidate.title, logicalTitle)) || left.index - right.index)
    .map(({ candidate }) => candidate)
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
  // Selection is persisted by the dedicated toggle path. It is not an editor
  // draft change, so a just-reselected saved rule must stay eligible for backup.
  const { priority: _priority, enabled: _enabled, ...snapshot } = ledger
  return snapshot
}

function ledgerHasUnsavedChangesFromSnapshots(
  ledger: FavoriteLedger,
  savedLedgerSnapshots: Record<string, ReturnType<typeof ledgerEditorSnapshot>>
) {
  return !savedLedgerSnapshots[ledger.id] ||
    JSON.stringify(ledgerEditorSnapshot(ledger)) !== JSON.stringify(savedLedgerSnapshots[ledger.id])
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

function removeConfirmedRemoteBindings(
  ledgers: FavoriteLedger[],
  deletedRemoteFolderIds: Iterable<string>,
  candidates: readonly ManagedFolderDeletionCandidate[] = []
) {
  const deletedIds = new Set([...deletedRemoteFolderIds].map((id) => id.trim()).filter(Boolean))
  if (!deletedIds.size) return ledgers
  return applyConfirmedManagedFavoriteRemoteFolderDeletion(ledgers, new Map(ledgers.map((ledger) => [
    ledger.id,
    new Set([
      ...remoteBindingIdsForLedger(ledger).filter((remoteId) => deletedIds.has(remoteId)),
      ...candidates
        .filter((candidate) => candidate.logicalLedgerId === ledger.id && candidate.remoteFolderId && deletedIds.has(candidate.remoteFolderId))
        .map((candidate) => candidate.remoteFolderId!)
    ])
  ])))
}

function isManagedRemoteDeletionResult(result: unknown): result is ManagedRemoteDeletionResult {
  return Boolean(result && typeof result === 'object' &&
    ['succeeded', 'partial-failed', 'failed', 'result-unknown'].includes(String((result as { status?: unknown }).status)) &&
    Array.isArray((result as { succeededRemoteFolderIds?: unknown }).succeededRemoteFolderIds) &&
    Array.isArray((result as { failures?: unknown }).failures))
}

function confirmedRemoteFolderIdsFromDeletionResult(result: unknown): string[] {
  if (isManagedRemoteDeletionResult(result)) return result.succeededRemoteFolderIds
  if (Array.isArray(result)) {
    return result.flatMap((candidate) => typeof candidate === 'object' && candidate
      ? [String((candidate as { remoteFolderId?: unknown }).remoteFolderId ?? '').trim()]
      : []).filter(Boolean)
  }
  return []
}

function partialManagedRemoteDeletionMessage(result: ManagedRemoteDeletionResult, candidates: ManagedFolderDeletionCandidate[]) {
  const namesFor = (remoteFolderIds: readonly string[]) => candidates
    .filter((candidate) => candidate.remoteFolderId && remoteFolderIds.includes(candidate.remoteFolderId))
    .map((candidate) => `“${displayTitle(candidate.title)}”`)
  const succeeded = namesFor(result.succeededRemoteFolderIds)
  const failed = result.failures.map((failure) => `“${displayTitle(failure.title)}”${failure.outcome === 'result-unknown' ? '（结果无法确认）' : ''}`)
  const unattempted = namesFor(result.unattemptedRemoteFolderIds)
  const fragments = [
    succeeded.length ? `已从 B 站删除：${succeeded.join('、')}。` : '',
    failed.length ? `未成功：${failed.join('、')}。` : '',
    unattempted.length ? `未执行：${unattempted.join('、')}。` : ''
  ].filter(Boolean)
  return `部分删除完成：${fragments.join('')}本地草稿和规则已保留。`
}

/** External refreshes may rebuild their array; existing cards must not jump. */
export function preserveFavoriteLedgerOrder(
  currentLedgers: readonly FavoriteLedger[],
  incomingLedgers: readonly FavoriteLedger[],
  retainedMissingIds: Iterable<string> = []
): FavoriteLedger[] {
  const incomingById = new Map(incomingLedgers.map((ledger) => [ledger.id, ledger]))
  const currentIds = new Set(currentLedgers.map((ledger) => ledger.id))
  const retainedIds = new Set(retainedMissingIds)
  return [
    ...currentLedgers.flatMap((ledger) => {
      const incoming = incomingById.get(ledger.id)
      return incoming ? [incoming] : retainedIds.has(ledger.id) ? [ledger] : []
    }),
    ...incomingLedgers.filter((ledger) => !currentIds.has(ledger.id))
  ]
}

/** Local rule drafts stay in this panel until the owner chooses save or sync. */
export const FavoriteLedgerOverview = forwardRef<FavoriteLedgerOverviewHandle, FavoriteLedgerOverviewProps>(function FavoriteLedgerOverview({ currentAccountMid, localFavoriteToggleAccountMid, ledgers, missingLedgerIds, unboundLedgerIds = [], remoteOnlyDraftLedgerIds = [], observedRemoteObservations = [], observedBoundRenameCandidates = [], remoteDiscoveryNoticeDismissed = false, onDismissRemoteDiscoveryNotice, onDismissRemoteDraftReminder, backupPreparationLedgerIds = [], organizationActive = false, hasExpandedOrganizationGuide = false, defaultFavoriteSystemEnabled: defaultFavoriteSystemEnabledProp, openLedgerId, openLedgerRequestVersion = 0, createLedger = false, createLedgerRequestVersion = 0, onSaveLedgers, onSaveLedgerEnabled, onEnabledStateChange, onOrganizationRecommendationToggle, organizationRecommendationEnabledById, onOrganizationSavedLedgerToggle, onOrganizationSavedLedgerSelectionChange, organizationSavedLedgerEnabledById, onDeleteLedger, onRemoteDraftDeleted, onBeforeDeleteLedger, onSyncLedgers = onSaveLedgers, onBackupConfirmationFinished, draftRuleAnalysis = null, draftRuleAnalysisError = null, onAnalyzeLedgerRule, onCancelDraftRuleAnalysis }, ref) {
  const defaultFavoriteSystemEnabled = defaultFavoriteSystemEnabledProp ?? true
  const defaultSystemPreferenceExplicit = defaultFavoriteSystemEnabledProp !== undefined
  const externalLedgerSignature = JSON.stringify(ledgers)
  const persistedLedgerIds = useMemo(() => new Set(ledgers.map((ledger) => ledger.id)), [ledgers])
  const isSystemDisabled = (ledger: FavoriteLedger) => !defaultFavoriteSystemEnabled && ledger.isDefault && ledger.id !== 'inbox'
  const isRoundLocked = (ledger: FavoriteLedger) => organizationActive && ledger.isDefault
  const isDefaultSystemLocked = (ledger: FavoriteLedger) => defaultSystemPreferenceExplicit && defaultFavoriteSystemEnabled && ledger.isDefault
  const isForcedEnabled = (ledger: FavoriteLedger) => ledger.id === 'inbox' || isDefaultSystemLocked(ledger)
  const [backupInFlightLedgerIds, setBackupInFlightLedgerIds] = useState<ReadonlySet<string>>(() => new Set())
  const [confirmedUnbackedLedgerIds, setConfirmedUnbackedLedgerIds] = useState<ReadonlySet<string>>(() => new Set())
  const shouldHideUnboundNotice = (ledgerId: string) => backupPreparationLedgerIds.includes(ledgerId) || backupInFlightLedgerIds.has(ledgerId)
  const bindingLabelForLedger = (ledger: FavoriteLedger) => {
    const label = ledger.pendingRemoteBindingCreatedByBackup
      ? '已创建 · 待正式确认'
      : confirmedUnbackedLedgerIds.has(ledger.id)
        ? '未备册'
        : favoriteLedgerBackupStateLabel(ledger, { missingLedgerIds, unboundLedgerIds })
    return label === '未绑定' && shouldHideUnboundNotice(ledger.id) ? '' : label
  }
  const bindingStateForLedger = (ledger: FavoriteLedger, label: string) => label.includes('未保存')
    ? 'local-draft'
    : label.includes('未备册')
      ? 'unbacked'
      : label.includes('部分已备册')
        ? 'partial'
      : label.includes('未绑定')
        ? 'unbound'
        : ledger.bindingState ?? (label === '已备册' ? 'bound' : 'unbacked')
  const isRemoteOnlyDraft = (ledger: FavoriteLedger) => remoteOnlyDraftLedgerIds.includes(ledger.id) && isUnsavedFavoriteLedgerDraft(ledger)
  const isTransientNewDraft = (ledger: FavoriteLedger) => !persistedLedgerIds.has(ledger.id) &&
    ledger.syncState === 'local-draft' &&
    !ledger.isDefault &&
    !ledger.bilibiliFolderId &&
    ledger.bindingState === undefined
  const isDraftDirectlyDeletable = (ledger: FavoriteLedger) => isRemoteOnlyDraft(ledger) || isTransientNewDraft(ledger)
  const hasRemoteDeletionFacts = (ledger: FavoriteLedger) => Boolean(
    ledger.bilibiliFolderId?.trim() ||
    ledger.bilibiliFolderIds?.some((folderId) => folderId.trim()) ||
    (ledger.pendingRemoteBinding && (ledger.pendingRemoteFolderId ?? ledger.bilibiliFolderId)?.trim()) ||
    ledger.historicalBilibiliFolderIds?.some((folderId) => folderId.trim()) ||
    ledger.confirmedDeletedRemoteFolderIds?.some((folderId) => folderId.trim())
  )
  const isPureLocalLedger = (ledger: FavoriteLedger) => !ledger.isDefault &&
    !hasRemoteDeletionFacts(ledger) &&
    !isRemoteOnlyDraft(ledger)
  const [ledgerHintExpanded, setLedgerHintExpanded] = useState(false)
  const [ledgerHintVisible, setLedgerHintVisible] = useState(false)
  const [ledgerHintPosition, setLedgerHintPosition] = useState({ top: 0, left: 0 })
  const ledgerHintPanelRef = useRef<HTMLElement>(null)
  const ledgerHintTriggerRef = useRef<HTMLButtonElement>(null)
  const ledgerHintTooltipRef = useRef<HTMLDivElement>(null)
  const ledgerScrollRestoreRef = useRef<{
    container: HTMLElement
    top: number
    frames: number[]
    userScrolled: boolean
    restoring: boolean
    removeScrollListener?: () => void
  }>({
    container: ledgerHintPanelRef.current as HTMLElement,
    top: 0,
    frames: [],
    userScrolled: false,
    restoring: false
  })
  const preserveLedgerScroll = () => {
    const origin = ledgerHintPanelRef.current
    if (!origin) return
    const container = origin.closest<HTMLElement>('[role="dialog"][aria-label="掌库"]') ?? origin
    const state = ledgerScrollRestoreRef.current
    state.container = container
    state.top = container.scrollTop
    state.userScrolled = false
    state.restoring = false
    state.removeScrollListener?.()
    const onUserScroll = () => {
      if (state.restoring) return
      state.userScrolled = true
      state.removeScrollListener?.()
      state.removeScrollListener = undefined
    }
    container.addEventListener('scroll', onUserScroll, { passive: true, once: true })
    state.removeScrollListener = () => container.removeEventListener('scroll', onUserScroll)
    for (const frame of state.frames) window.cancelAnimationFrame(frame)
    const restore = (remainingFrames: number) => {
      if (!state.container.isConnected || state.userScrolled) {
        state.frames = []
        state.removeScrollListener?.()
        state.removeScrollListener = undefined
        return
      }
      if (state.container.scrollTop !== state.top) {
        state.restoring = true
        state.container.scrollTop = state.top
        state.restoring = false
      }
      if (remainingFrames > 0) {
        state.frames = [window.requestAnimationFrame(() => restore(remainingFrames - 1))]
      } else {
        state.frames = []
        state.removeScrollListener?.()
        state.removeScrollListener = undefined
      }
    }
    state.frames = [window.requestAnimationFrame(() => restore(3))]
  }
  const [draftLedgers, setDraftLedgers] = useState(ledgers)
  const draftLedgersRef = useRef(draftLedgers)
  const awaitingParentLedgerIdsRef = useRef<Set<string>>(new Set())
  const [savedLedgerSnapshots, setSavedLedgerSnapshots] = useState<Record<string, ReturnType<typeof ledgerEditorSnapshot>>>(() =>
    Object.fromEntries(ledgers.filter((ledger) => !isRecoveredRemoteDraft(ledger)).map((ledger) => [ledger.id, ledgerEditorSnapshot(ledger)]))
  )
  const savedLedgerSnapshotsRef = useRef(savedLedgerSnapshots)
  const [locallyUnsavedLedgerIds, setLocallyUnsavedLedgerIds] = useState<ReadonlySet<string>>(() => new Set())
  const ledgerHasUnsavedChanges = (ledger: FavoriteLedger) =>
    ledgerHasUnsavedChangesFromSnapshots(ledger, savedLedgerSnapshots)
  const isLocalToggleOnly = !currentAccountMid && Boolean(localFavoriteToggleAccountMid)
  const isLocalToggleEligible = (ledger: FavoriteLedger) =>
    ledger.isDefault === false && ledger.ruleOrigin === 'saved-rule' && ledger.bindingState === 'unbacked' &&
    !ledger.bilibiliFolderId?.trim() && !(ledger.bilibiliFolderIds ?? []).some((folderId) => folderId.trim())
  const isOperable = (ledger: FavoriteLedger, unsavedLedgerIds = locallyUnsavedLedgerIds) =>
    (!isLocalToggleOnly || isLocalToggleEligible(ledger)) &&
    !unsavedLedgerIds.has(ledger.id) && !isTransientNewDraft(ledger) &&
    (ledger.syncState !== 'local-draft' || ledger.ruleOrigin === 'saved-rule' ||
      Boolean(organizationSavedLedgerEnabledById?.has(ledger.id)) ||
      Boolean(organizationRecommendationEnabledById?.has(ledger.id))) && !isRecoveredRemoteDraft(ledger) &&
    !isSystemDisabled(ledger) && !isRoundLocked(ledger) && !isForcedEnabled(ledger)
  const enableEntries = (items: FavoriteLedger[], deletionMode = false, enabledOverride?: ReadonlyMap<string, boolean>, unsavedLedgerIds = locallyUnsavedLedgerIds): FavoriteLedgerEnableEntry[] => items.map((ledger) => ({
    id: ledger.id,
    enabled: enabledOverride?.get(ledger.id) ?? (deletionMode ? false : isForcedEnabled(ledger) ? true : ledger.enabled),
    operable: deletionMode || isOperable(ledger, unsavedLedgerIds),
    forceEnabledOnBulk: !deletionMode && (isRoundLocked(ledger) || isForcedEnabled(ledger))
  }))
  const [enableStore] = useState(() => new FavoriteLedgerEnableStore(enableEntries(ledgers)))
  const [deletionStore] = useState(() => new FavoriteLedgerEnableStore(enableEntries(ledgers, true)))
  const [activeLedgerId, setActiveLedgerId] = useState<string | null>(null)
  const [newLedger, setNewLedger] = useState(false)
  const [deletionPlan, setDeletionPlan] = useState<ManagedDeletionPlan | null>(null)
  const [rebindCandidates, setRebindCandidates] = useState<RebindCandidateEntry[] | null>(null)
  const [rebindSelections, setRebindSelections] = useState<Record<string, string>>({})
  const [rebindSelectedFolderIds, setRebindSelectedFolderIds] = useState<Record<string, string[]>>({})
  const [rebindTargetLedgerIds, setRebindTargetLedgerIds] = useState<string[]>([])
  const [remoteDiscoveryProcessing, setRemoteDiscoveryProcessing] = useState<RemoteDiscoveryProcessingState | null>(null)
  const [selectedRemoteObservationFolderIds, setSelectedRemoteObservationFolderIds] = useState<ReadonlySet<string>>(() => new Set())
  const [selectedBoundRenameShardKeys, setSelectedBoundRenameShardKeys] = useState<ReadonlySet<string>>(() => new Set())
  const [remoteDiscoveryProcessingError, setRemoteDiscoveryProcessingError] = useState<string | null>(null)
  const [remoteDiscoveryProcessingBusy, setRemoteDiscoveryProcessingBusy] = useState(false)
  const [deletionConfirmed, setDeletionConfirmed] = useState(false)
  const [deletionAcknowledgedUnbound, setDeletionAcknowledgedUnbound] = useState(false)
  const [deletionScope, setDeletionScope] = useState<ManagedDeletionScope>('local-only')
  const [deletionExecuting, setDeletionExecuting] = useState(false)
  const [deletionError, setDeletionError] = useState<string | null>(null)
  const [draftDeletionError, setDraftDeletionError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [backupSkipNotice, setBackupSkipNotice] = useState<string | null>(null)
  const [deletionModeActive, setDeletionModeActive] = useState(false)
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  const [ledgerListExpanded, setLedgerListExpanded] = useState(true)
  const [draggedLedgerId, setDraggedLedgerId] = useState<string | null>(null)
  const [dragTarget, setDragTarget] = useState<string | null>(null)
  const backupInFlightRef = useRef<Promise<unknown> | null>(null)
  // Rule analysis changes the workspace classification in the background. It
  // blocks backup, remote mutations, and reordering, but ordinary-rule
  // deletion stays available: the coordinator discards a stale analysis when
  // its source rule disappears.
  const destructiveActionLocked = Boolean(draftRuleAnalysis)
  const recoveredRemoteDrafts = draftLedgers.filter((ledger) =>
    ledger.syncState === 'local-draft' && Boolean(ledger.bilibiliFolderId) && !ledger.enabled)
  const hasRemoteDetectionNotice = !remoteDiscoveryNoticeDismissed && (observedRemoteObservations.length > 0 || observedBoundRenameCandidates.length > 0)
  const persistVersionRef = useRef(0)
  const toggleSaveTimerRef = useRef<number | null>(null)
  const pendingToggleSaveRef = useRef(new Map<string, { previous: boolean; enabled: boolean; version: number }>())
  const pendingBulkSaveRef = useRef<{ previousEnabled: Map<string, boolean>; enabledById: Map<string, boolean> } | null>(null)
  const toggleVersionsRef = useRef(new Map<string, number>())
  const organizationToggleVersionsRef = useRef(new Map<string, number>())
  const toggleSaveInFlightRef = useRef(false)
  const enabledStateChangeSourceRef = useRef<'editor-unsaved' | 'organization-selection' | undefined>(undefined)
  const onEnabledStateChangeRef = useRef(onEnabledStateChange)
  const onSaveLedgersRef = useRef(onSaveLedgers)
  const onSaveLedgerEnabledRef = useRef(onSaveLedgerEnabled)
  const editorRef = useRef<HTMLElement | null>(null)
  const openedLedgerRequestRef = useRef<string | null>(null)
  const positionedLedgerRequestRef = useRef<string | null>(null)
  const openLedgerRequest = openLedgerId ? `${openLedgerId}:${openLedgerRequestVersion}` : null
  const createLedgerRequest = createLedger ? `new:${createLedgerRequestVersion}` : null
  onEnabledStateChangeRef.current = onEnabledStateChange
  onSaveLedgersRef.current = onSaveLedgers
  onSaveLedgerEnabledRef.current = onSaveLedgerEnabled
  useLayoutEffect(() => {
    draftLedgersRef.current = draftLedgers
  }, [draftLedgers])
  useLayoutEffect(() => {
    savedLedgerSnapshotsRef.current = savedLedgerSnapshots
  }, [savedLedgerSnapshots])
  useEffect(() => {
    if (toggleSaveTimerRef.current !== null) window.clearTimeout(toggleSaveTimerRef.current)
    toggleSaveTimerRef.current = null
    pendingToggleSaveRef.current.clear()
    pendingBulkSaveRef.current = null
    const awaitingParentLedgerIds = awaitingParentLedgerIdsRef.current
    for (const ledgerId of awaitingParentLedgerIds) {
      if (persistedLedgerIds.has(ledgerId)) awaitingParentLedgerIds.delete(ledgerId)
    }
    const nextLedgers = preserveFavoriteLedgerOrder(draftLedgersRef.current, ledgers, awaitingParentLedgerIds)
    enableStore.reset(enableEntries(nextLedgers, false))
    deletionStore.reset(enableEntries(nextLedgers, true))
    setDraftLedgers(nextLedgers)
    setSavedLedgerSnapshots(Object.fromEntries(nextLedgers.filter((ledger) => !isRecoveredRemoteDraft(ledger)).map((ledger) => [ledger.id, ledgerEditorSnapshot(ledger)])))
    setLocallyUnsavedLedgerIds(new Set())
    const requestedEditorId = organizationActive && openLedgerId && nextLedgers.some((ledger) => ledger.id === openLedgerId)
      ? openLedgerId
      : null
    setActiveLedgerId(requestedEditorId)
    setNewLedger(false)
    setDeletionModeActive(false)
    setDraftDeletionError(null)
  }, [externalLedgerSignature])
  useEffect(() => {
    if (!confirmedUnbackedLedgerIds.size) return
    // Keep the deletion result visible until the parent has supplied a new
    // authoritative ledger snapshot. Once that snapshot represents a formal
    // binding again, discard the short-lived local override so it cannot hide
    // the recovered “已备册” state.
    const currentLedgerById = new Map(ledgers.map((ledger) => [ledger.id, ledger]))
    const next = new Set([...confirmedUnbackedLedgerIds].filter((ledgerId) => {
      const ledger = currentLedgerById.get(ledgerId)
      if (!ledger) return false
      const state = favoriteLedgerBackupState(ledger, { missingLedgerIds, unboundLedgerIds })
      return state === 'unbacked' || state === 'unbound' || state === 'partial'
    }))
    if (next.size === confirmedUnbackedLedgerIds.size &&
      [...next].every((ledgerId) => confirmedUnbackedLedgerIds.has(ledgerId))) return
    setConfirmedUnbackedLedgerIds(next)
  }, [externalLedgerSignature])
  useEffect(() => () => {
    const scrollRestore = ledgerScrollRestoreRef.current
    for (const frame of scrollRestore.frames) window.cancelAnimationFrame(frame)
    scrollRestore.frames = []
    scrollRestore.removeScrollListener?.()
    scrollRestore.removeScrollListener = undefined
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
    const notify = () => {
      const source = enabledStateChangeSourceRef.current
      enabledStateChangeSourceRef.current = undefined
      onEnabledStateChangeRef.current?.(enableStore.getEnabledById(), source)
    }
    notify()
    return enableStore.subscribe(notify)
  }, [enableStore])
  const organizationRecommendationSignature = organizationRecommendationEnabledById
    ? JSON.stringify([...organizationRecommendationEnabledById].sort(([left], [right]) => left.localeCompare(right)))
    : ''
  const organizationSavedLedgerSignature = organizationSavedLedgerEnabledById
    ? JSON.stringify([...organizationSavedLedgerEnabledById].sort(([left], [right]) => left.localeCompare(right)))
    : ''
  useEffect(() => {
    if (!organizationActive || (!organizationRecommendationEnabledById?.size && !organizationSavedLedgerEnabledById?.size)) return
    const current = enableStore.getEnabledById()
    const next = new Map(current)
    let changed = false
    for (const [ledgerId, enabled] of [...(organizationRecommendationEnabledById ?? []), ...(organizationSavedLedgerEnabledById ?? [])]) {
      if (next.get(ledgerId) === enabled) continue
      next.set(ledgerId, enabled)
      changed = true
    }
    if (!changed) return
    enabledStateChangeSourceRef.current = 'organization-selection'
    enableStore.replaceEnabled(next)
    if (enabledStateChangeSourceRef.current === 'organization-selection') {
      enabledStateChangeSourceRef.current = undefined
    }
  }, [enableStore, organizationActive, organizationRecommendationEnabledById, organizationRecommendationSignature, organizationSavedLedgerEnabledById, organizationSavedLedgerSignature])
  const active = draftLedgers.find((ledger) => ledger.id === activeLedgerId)
  const combinedStatusLabel = (ledger: FavoriteLedger) => [
    ledgerHasUnsavedChanges(ledger) ? '未保存' : '',
    bindingLabelForLedger(ledger)
  ].filter(Boolean).join(' · ')
  const statusLabelForLedger = (ledger: FavoriteLedger) => {
    const label = combinedStatusLabel(ledger)
    if (hasExpandedOrganizationGuide) {
      return ledgerHasUnsavedChanges(ledger) ? '未保存' : ''
    }
    return label
  }
  // The card/list projection hides remote lifecycle labels while organizing,
  // but the open detail editor is the authoritative inspection surface and
  // must keep showing the real backup/binding state.
  const editorStatusLabelForLedger = (ledger: FavoriteLedger) => combinedStatusLabel(ledger)
  const activeVideoCount = active ? videoCountForLedger(active) : undefined
  const activeRemoteBindingIds = active ? remoteBindingIdsForLedger(active) : []
  const activePendingRemoteBinding = Boolean(active?.pendingRemoteBinding && (active.pendingRemoteFolderId ?? active.bilibiliFolderId)?.trim())
  // A paused or recoverable organization workspace can remain mounted while
  // the guide itself is closed.  Only the actually visible guide hides the
  // card-level remote lifecycle labels; the detail editor always shows them.
  const hideRemoteLifecycleStatus = hasExpandedOrganizationGuide
  const activeRules = active ? parseFavoriteLedgerRules(active) : { localKeywords: [] }
  const title = active ? displayTitle(active.displayName) : ''
  const validation = favoriteLedgerNameValidation(active?.displayName ?? '')
  const valid = Boolean(active && title.trim() && validation.valid)
  const canToggleLedgerList = draftLedgers.length > COLLAPSED_LEDGER_COUNT
  const fullLedgerListVisible = ledgerListExpanded && draftLedgers.length <= LEDGER_EAGER_RENDER_LIMIT
  const ledgersToDisplay = fullLedgerListVisible ? draftLedgers : draftLedgers.slice(0, COLLAPSED_LEDGER_COUNT)
  const projectEnabled = (items: FavoriteLedger[], enabledById: ReadonlyMap<string, boolean> = enableStore.getEnabledById()) => items.map((ledger) => ({
    ...ledger,
    enabled: isForcedEnabled(ledger) ? true : enabledById.get(ledger.id) ?? ledger.enabled
  }))
  const selectedBackupLedgers = (items: FavoriteLedger[]) => projectEnabled(items)
    .filter((ledger) => !isSystemDisabled(ledger) && ledger.enabled)
  const hasSelectedBackupLedger = selectedBackupLedgers(draftLedgers).length > 0
  const update = (patch: Partial<FavoriteLedger>) => {
    if (!activeLedgerId) return
    const editingLedger = draftLedgers.find((ledger) => ledger.id === activeLedgerId)
    const next = draftLedgers.map((ledger) => ledger.id === activeLedgerId ? { ...ledger, ...patch } : ledger)
    const nextUnsavedLedgerIds = new Set(locallyUnsavedLedgerIds)
    if (editingLedger && !isForcedEnabled(editingLedger)) nextUnsavedLedgerIds.add(activeLedgerId)
    setDraftLedgers(next)
    setLocallyUnsavedLedgerIds(nextUnsavedLedgerIds)
    if (editingLedger && !isForcedEnabled(editingLedger)) {
      enableStore.reconcile(enableEntries(next, false, undefined, nextUnsavedLedgerIds))
      enabledStateChangeSourceRef.current = 'editor-unsaved'
      if (!enableStore.setEnabled(activeLedgerId, false) && enabledStateChangeSourceRef.current === 'editor-unsaved') {
        enabledStateChangeSourceRef.current = undefined
      }
    }
  }
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
            enableStore.setSaveError(id, '收藏夹启用状态保存失败，请稍后重试。')
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
    preserveLedgerScroll()
    if (deletionModeActive) {
      deletionStore.toggle(id)
      return
    }
    enableStore.setSaveError(id, undefined)
    const previousEnabled = enableStore.isEnabled(id)
    const toggledLedger = draftLedgers.find((ledger) => ledger.id === id)
    if (organizationSavedLedgerEnabledById?.has(id) && onOrganizationSavedLedgerToggle) {
      const nextEnabled = !previousEnabled
      // Publish the local projection before awaiting the main-process command so
      // a round toggle is immediately visible and does not feel blocked by the
      // classification/queue work behind it. A version guard prevents an older
      // failed request from rolling back a newer click.
      enabledStateChangeSourceRef.current = 'organization-selection'
      if (!enableStore.setEnabled(id, nextEnabled)) return
      const version = (organizationToggleVersionsRef.current.get(id) ?? 0) + 1
      organizationToggleVersionsRef.current.set(id, version)
      void Promise.resolve(onOrganizationSavedLedgerToggle(id, nextEnabled)).then((result) => {
        if (result !== false || organizationToggleVersionsRef.current.get(id) !== version) return
        enabledStateChangeSourceRef.current = 'organization-selection'
        enableStore.setEnabled(id, previousEnabled)
      }).catch(() => {
        if (organizationToggleVersionsRef.current.get(id) !== version) return
        enabledStateChangeSourceRef.current = 'organization-selection'
        enableStore.setEnabled(id, previousEnabled)
      })
      return
    }
    if (organizationRecommendationEnabledById?.has(id) && onOrganizationRecommendationToggle) {
      const nextEnabled = !previousEnabled
      enabledStateChangeSourceRef.current = 'organization-selection'
      if (!enableStore.setEnabled(id, nextEnabled)) return
      const version = (organizationToggleVersionsRef.current.get(id) ?? 0) + 1
      organizationToggleVersionsRef.current.set(id, version)
      void Promise.resolve(onOrganizationRecommendationToggle(id, nextEnabled)).then((result) => {
        if (result !== false || organizationToggleVersionsRef.current.get(id) !== version) return
        enabledStateChangeSourceRef.current = 'organization-selection'
        enableStore.setEnabled(id, previousEnabled)
      }).catch(() => {
        if (organizationToggleVersionsRef.current.get(id) !== version) return
        enabledStateChangeSourceRef.current = 'organization-selection'
        enableStore.setEnabled(id, previousEnabled)
      })
      return
    }
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
    preserveLedgerScroll()
    if (deletionModeActive) {
      deletionStore.toggleAll()
      return
    }
    if (organizationSavedLedgerEnabledById && onOrganizationSavedLedgerSelectionChange) {
      const selectAll = ![...organizationSavedLedgerEnabledById.values()].every(Boolean)
      const selectedLedgerIds = selectAll
        ? [...organizationSavedLedgerEnabledById.keys()]
        : draftLedgers.filter((ledger) => isRoundLocked(ledger) || isForcedEnabled(ledger)).map((ledger) => ledger.id)
      void onOrganizationSavedLedgerSelectionChange(selectedLedgerIds)
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
    if (deletionModeActive) return
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
    if (destructiveActionLocked) return
    setDraggedLedgerId(id)
    setDragTarget(null)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
  }
  const dragOver = (targetId: string, event: DragEvent<HTMLDivElement>) => {
    if (destructiveActionLocked) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (!draggedLedgerId || draggedLedgerId === targetId) return setDragTarget(null)
    setDragTarget(targetId)
  }
  const dropOn = (targetId: string, event: DragEvent<HTMLDivElement>) => {
    if (destructiveActionLocked) return
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
    const ledger: FavoriteLedger = { id: createUserFavoriteLedgerId('new-ledger'), displayName: BILIMI_LEDGER_PREFIX, keywords: [], ruleType: 'keyword', enabled: false, priority: (draftLedgers.length + 1) * 10, syncState: 'local-draft', ruleOrigin: 'saved-rule', isDefault: false }
    awaitingParentLedgerIdsRef.current.add(ledger.id)
    enableStore.reconcile(enableEntries([...draftLedgers, ledger]))
    setDraftLedgers((current) => [...current, ledger]); setActiveLedgerId(ledger.id); setNewLedger(true); setDraftDeletionError(null); setSaveError(null)
  }
  const close = () => {
    setActiveLedgerId(null); setNewLedger(false); setDraftDeletionError(null); setSaveError(null)
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
    setLocallyUnsavedLedgerIds(new Set())
    setActiveLedgerId(null)
    setNewLedger(false)
    setSaveError(null)
    void Promise.resolve(onSaveLedgers(next, { deleteDisabled: false })).catch(() => {
      if (persistVersionRef.current !== persistVersion) return
      setDraftLedgers(previous)
      enableStore.reset(enableEntries(previous, false))
      setSavedLedgerSnapshots(Object.fromEntries(previous.filter((ledger) => !isRecoveredRemoteDraft(ledger)).map((ledger) => [ledger.id, ledgerEditorSnapshot(ledger)])))
    })
  }
  const save = async () => {
    if (!valid || !active || !activeLedgerId) return
    const savingLedgerId = activeLedgerId
    const previous = ledgers
    const persistVersion = ++persistVersionRef.current
    const next = projectEnabled(draftLedgers).map((ledger) => {
      if (ledger.id !== activeLedgerId || (!isRecoveredRemoteDraft(ledger) && !isTransientNewDraft(ledger))) return ledger
      const { syncState: _syncState, ...savedLedger } = ledger
      if (isRecoveredRemoteDraft(ledger) && savedLedger.bilibiliFolderId) {
        return {
          ...savedLedger,
          ruleOrigin: 'saved-rule' as const,
          bindingState: 'unbound' as const,
          pendingRemoteBinding: true,
          pendingRemoteFolderId: savedLedger.bilibiliFolderId
        }
      }
      return savedLedger.bindingState || savedLedger.bilibiliFolderId
        ? { ...savedLedger, ruleOrigin: 'saved-rule' as const }
        : { ...savedLedger, ruleOrigin: 'saved-rule' as const, bindingState: 'unbacked' as const }
    })
    const nextUnsavedLedgerIds = new Set(locallyUnsavedLedgerIds)
    nextUnsavedLedgerIds.delete(savingLedgerId)
    const nextSavedLedgerSnapshots = Object.fromEntries(next.map((ledger) => [ledger.id, ledgerEditorSnapshot(ledger)]))
    draftLedgersRef.current = next
    savedLedgerSnapshotsRef.current = nextSavedLedgerSnapshots
    setDraftLedgers(next)
    enableStore.reconcile(enableEntries(next, false, undefined, nextUnsavedLedgerIds))
    setSavedLedgerSnapshots(nextSavedLedgerSnapshots)
    setLocallyUnsavedLedgerIds(nextUnsavedLedgerIds)
    const savedLedger = next.find((ledger) => ledger.id === savingLedgerId)
    setSaveError(null)
    awaitingParentLedgerIdsRef.current.add(savingLedgerId)
    try {
      const result = await onSaveLedgers(next, { deleteDisabled: false }) as { ok?: boolean; message?: string } | undefined
      if (result?.ok === false) {
        awaitingParentLedgerIdsRef.current.delete(savingLedgerId)
        if (persistVersionRef.current !== persistVersion) return
        const restoredUnsavedLedgerIds = new Set(nextUnsavedLedgerIds)
        restoredUnsavedLedgerIds.add(savingLedgerId)
        setLocallyUnsavedLedgerIds(restoredUnsavedLedgerIds)
        setSaveError(result.message ?? '收藏夹规则未能持久化，请稍后重试。')
        return
      }
      setActiveLedgerId((current) => current === savingLedgerId ? null : current)
      setNewLedger(false)
      if (savedLedger) {
        try {
          const discovery = await onSyncLedgers([savedLedger], {
            backupTargetLedgerIds: [savedLedger.id],
            deleteDisabled: false,
            remoteObservationPreflight: true
          }) as FavoriteLedgerRemoteDiscoveryResult | undefined
          const observations = Array.isArray(discovery?.remoteObservations) ? discovery.remoteObservations : []
          if (observations.length || discovery?.boundRenameCandidates?.length) {
            openRemoteDiscoveryProcessing('details', observations, discovery?.boundRenameCandidates ?? [], [])
          }
        } catch {
          // The local rule save has already succeeded. Discovery is advisory.
        }
      }
      if (organizationActive && savedLedger && savedLedger.ruleType !== 'deepseek' && onAnalyzeLedgerRule) {
        await onAnalyzeLedgerRule(savedLedger)
      }
    } catch {
      awaitingParentLedgerIdsRef.current.delete(savingLedgerId)
      if (persistVersionRef.current !== persistVersion) return
      const restoredUnsavedLedgerIds = new Set(nextUnsavedLedgerIds)
      restoredUnsavedLedgerIds.add(savingLedgerId)
      setLocallyUnsavedLedgerIds(restoredUnsavedLedgerIds)
      setSaveError('收藏夹规则未能持久化，请稍后重试。')
    }
  }
  const closeRemoteDiscoveryProcessing = () => {
    if (remoteDiscoveryProcessingBusy) return
    setRemoteDiscoveryProcessing(null)
    setSelectedRemoteObservationFolderIds(new Set())
    setSelectedBoundRenameShardKeys(new Set())
    setRemoteDiscoveryProcessingError(null)
  }
  const openRemoteDiscoveryProcessing = (
    mode: RemoteDiscoveryProcessingMode,
    observations: readonly RemoteFavoriteLedgerObservation[],
    renameCandidates: readonly FavoriteLedgerBoundRenameCandidate[],
    backupTargetLedgerIds: readonly string[],
    onDeferredBackupFinished?: RemoteDiscoveryProcessingState['onDeferredBackupFinished']
  ) => {
    const nextObservations = [...observations]
    const nextRenameCandidates = renameCandidates.map((candidate) => ({
      ...candidate,
      shards: [...candidate.shards]
    }))
    setRemoteDiscoveryProcessing({
      mode,
      observations: nextObservations,
      renameCandidates: nextRenameCandidates,
      backupTargetLedgerIds: [...backupTargetLedgerIds],
      onDeferredBackupFinished
    })
    setSelectedRemoteObservationFolderIds(new Set(nextObservations.map((observation) => observation.folderId)))
    setSelectedBoundRenameShardKeys(new Set(nextRenameCandidates.flatMap((candidate) =>
      candidate.shards.map((shard) => boundRenameShardKey(candidate.ledgerId, shard)))))
    setRemoteDiscoveryProcessingError(null)
  }
  const showRebindCandidates = (nextCandidates: RebindCandidateEntry[], targetLedgerIds: readonly string[]) => {
    setRebindCandidates(nextCandidates)
    setRebindTargetLedgerIds([...targetLedgerIds])
    setRebindSelections(Object.fromEntries(nextCandidates
      .filter((entry) => entry.candidates.length)
      .map((entry) => {
        const logicalTitle = displayTitle(draftLedgersRef.current.find((ledger) => ledger.id === entry.ledgerId)?.displayName ?? entry.ledgerId)
        return [entry.ledgerId, orderedRebindCandidates(entry.candidates, logicalTitle)[0]!.id]
      })))
    setRebindSelectedFolderIds(Object.fromEntries(nextCandidates
      .map((entry) => {
        const logicalTitle = displayTitle(draftLedgersRef.current.find((ledger) => ledger.id === entry.ledgerId)?.displayName ?? entry.ledgerId)
        return [entry.ledgerId, orderedRebindCandidates(entry.candidates, logicalTitle).map((candidate) => candidate.id)]
      })))
  }
  const requestBackup = async (options?: {
    targetLedgerIds?: readonly string[]
    confirmedBackupOptions?: Pick<FavoriteLedgerSaveOptions, 'confirmCreateAndBind' | 'rebindRemoteFolderIds' | 'rebindRemoteFolders'>
    suppressConfirmationDialog?: boolean
    /** Omit/true for the normal direct path; false explicitly requests a preflight. */
    skipRemoteObservationPreflight?: boolean
    onDeferredRemoteDiscoveryBackupFinished?: (result: { ok?: boolean; message?: string } | undefined) => void | Promise<void>
  }) => {
    if (destructiveActionLocked) return { ok: false, message: '当前收藏夹规则分析尚未完成，暂不能备册。' }
    if (backupInFlightRef.current) return backupInFlightRef.current
    const operation = (async () => {
      const currentLedgers = draftLedgersRef.current
      const targetLedgerIds = options?.targetLedgerIds
        ? new Set(options.targetLedgerIds.map((ledgerId) => ledgerId.trim()).filter(Boolean))
        : null
      const selectedLedgers = targetLedgerIds
        ? currentLedgers.filter((ledger) => targetLedgerIds.has(ledger.id))
        : selectedBackupLedgers(currentLedgers)
      const skippedLedgers = selectedLedgers.filter((ledger) =>
        (ledger.syncState === 'local-draft' && ledger.ruleOrigin !== 'saved-rule') ||
        ledgerHasUnsavedChangesFromSnapshots(ledger, savedLedgerSnapshotsRef.current))
      const eligibleLedgers = selectedLedgers.filter((ledger) => !skippedLedgers.includes(ledger))
      if (skippedLedgers.length) {
        setBackupSkipNotice(`${skippedLedgers.map((ledger) => displayTitle(ledger.displayName)).join('、')}尚未保存，已跳过本次备册，请先保存后再备册。`)
      } else {
        setBackupSkipNotice(null)
      }
      if (!eligibleLedgers.length) {
        return { ok: false, message: '请先保存并勾选至少一个 bilimi 收藏夹，再备册到 B 站。' }
      }
      setBackupInFlightLedgerIds(new Set(eligibleLedgers.map((ledger) => ledger.id)))
      try {
        // Keep ordinary backup on the name-first save path. Its first fresh
        // inventory also stops for remote-only confirmation before write.
        // Follow-up/organizer calls already own that confirmation surface.
        const runRemoteObservationPreflight = options?.skipRemoteObservationPreflight === false
        const useCombinedRemoteObservationGate = !runRemoteObservationPreflight &&
          options?.skipRemoteObservationPreflight !== true &&
          !options?.suppressConfirmationDialog
        const result = await onSyncLedgers(eligibleLedgers, {
          deleteDisabled: false,
          backupTargetLedgerIds: eligibleLedgers.map((ledger) => ledger.id),
          rediscoverDeletedRemoteDrafts: true,
          ...(runRemoteObservationPreflight ? { remoteObservationPreflight: true } : {}),
          ...(useCombinedRemoteObservationGate ? {
            includeRemoteOnlyDrafts: true,
            haltOnRemoteObservations: true
          } : {}),
          ...options?.confirmedBackupOptions
        }) as FavoriteLedgerRemoteDiscoveryResult | undefined
        const freshRemoteObservations = Array.isArray(result?.remoteObservations) ? result.remoteObservations : []
        if (freshRemoteObservations.length || result?.boundRenameCandidates?.length) {
          if (options?.suppressConfirmationDialog) {
            return onSyncLedgers(eligibleLedgers, {
              deleteDisabled: false,
              backupTargetLedgerIds: eligibleLedgers.map((ledger) => ledger.id),
              rediscoverDeletedRemoteDrafts: true,
              ...options?.confirmedBackupOptions
            })
          }
          openRemoteDiscoveryProcessing(
            'backup',
            freshRemoteObservations,
            result?.boundRenameCandidates ?? [],
            eligibleLedgers.map((ledger) => ledger.id),
            options?.onDeferredRemoteDiscoveryBackupFinished
          )
          return { ...result, remoteDiscoveryProcessingDeferred: true }
        }
        if (result?.unboundCandidates?.length) {
          if (options?.suppressConfirmationDialog) return result
          showRebindCandidates(result.unboundCandidates, eligibleLedgers.map((ledger) => ledger.id))
          return result
        }
        if (result?.ok === false) {
          setBackupSkipNotice(result.message ?? '收藏夹状态核验失败，请刷新 B 站收藏夹后重试。')
          return result
        }
        if (!runRemoteObservationPreflight) return result
        return onSyncLedgers(eligibleLedgers, {
          deleteDisabled: false,
          backupTargetLedgerIds: eligibleLedgers.map((ledger) => ledger.id),
          rediscoverDeletedRemoteDrafts: true,
          ...options?.confirmedBackupOptions
        })
      } finally {
        setBackupInFlightLedgerIds(new Set())
      }
    })()
    backupInFlightRef.current = operation
    try {
      return await operation
    } finally {
      if (backupInFlightRef.current === operation) backupInFlightRef.current = null
    }
  }
  const getBackupTargetLedgerIds = () => selectedBackupLedgers(draftLedgersRef.current)
    .filter((ledger) =>
      (ledger.syncState !== 'local-draft' || ledger.ruleOrigin === 'saved-rule') &&
      !ledgerHasUnsavedChangesFromSnapshots(ledger, savedLedgerSnapshotsRef.current))
    .map((ledger) => ledger.id)
  useImperativeHandle(ref, () => ({ getBackupTargetLedgerIds, requestBackup }))

  const requestSync = async () => {
    if (!deletionModeActive && destructiveActionLocked) return
    const currentLedgers = projectEnabled(draftLedgers)
    if (!deletionModeActive) {
      await requestBackup()
      return
    }
    const selectedLedgers = currentLedgers.filter((ledger) => deletionStore.isEnabled(ledger.id))
    const deletionLedgers = selectedLedgers
    const draftLedgerIds = deletionLedgers
      .filter(isDraftDirectlyDeletable)
      .map((ledger) => ledger.id)
    const remoteDraftTargets = Object.fromEntries(deletionLedgers
      .filter(isRemoteOnlyDraft)
      .flatMap((ledger) => {
        const remoteFolderId = ledger.bilibiliFolderId?.trim()
        return remoteFolderId ? [[ledger.id, { remoteFolderId, title: ledger.displayName }]] : []
      }))
    const selectedCustomLedgers = deletionLedgers.filter((ledger) => !ledger.isDefault && !draftLedgerIds.includes(ledger.id))
    const selectedDefaultLedgers = deletionLedgers.filter((ledger) => ledger.isDefault)
    const historicalBindingTargets = Object.fromEntries(selectedDefaultLedgers
      .filter((ledger) => remoteBindingIdsForLedger(ledger).length === 0 && (ledger.historicalBilibiliFolderIds ?? []).length > 0)
      .map((ledger) => [ledger.id, (ledger.historicalBilibiliFolderIds ?? []).map((remoteFolderId) => ({
        remoteFolderId,
        title: ledger.historicalBilibiliFolderTitle ?? ledger.bilibiliFolderTitle ?? ledger.displayName
      }))]))
    const remoteCustomLedgerIds = selectedCustomLedgers
      .filter((ledger) => ledger.bindingState === 'bound' && remoteBindingIdsForLedger(ledger).length > 0)
      .map((ledger) => ledger.id)
    const remoteDefaultLedgerIds = selectedDefaultLedgers
      .filter((ledger) => remoteBindingIdsForLedger(ledger).length > 0 ||
        Object.prototype.hasOwnProperty.call(historicalBindingTargets, ledger.id) ||
        ledger.bindingState === 'unbound')
      .map((ledger) => ledger.id)
    const localCustomLedgerIds = selectedCustomLedgers
      .filter((ledger) => !remoteCustomLedgerIds.includes(ledger.id))
      .map((ledger) => ledger.id)
    const localDefaultLedgerIds = selectedDefaultLedgers
      .filter((ledger) => !remoteDefaultLedgerIds.includes(ledger.id))
      .map((ledger) => ledger.id)
    const plan = { remoteCustomLedgerIds, remoteDefaultLedgerIds, remoteDraftTargets, historicalBindingTargets, localCustomLedgerIds, localDefaultLedgerIds, draftLedgerIds, candidates: [] }
    await requestManagedDeletion(plan)
  }
  const deleteLocalFavoriteLedgers = async (ledgerIds: readonly string[], sourceLedgers = projectEnabled(draftLedgers)) => {
    const deletedIds = new Set(ledgerIds)
    const selectedLedgers = draftLedgers.filter((ledger) => deletedIds.has(ledger.id) && !ledger.isDefault)
    if (!selectedLedgers.length) return true
    preserveLedgerScroll()
    for (const ledgerId of deletedIds) awaitingParentLedgerIdsRef.current.delete(ledgerId)
    const persistedLedgers = selectedLedgers.filter((ledger) => ledgers.some((item) => item.id === ledger.id))
    if (persistedLedgers.length) {
      try {
        for (const ledger of persistedLedgers) await onBeforeDeleteLedger?.(ledger.id)
        const accountMid = currentAccountMid !== undefined
          ? currentAccountMid.trim()
          : window.bilimiDesktop?.readBilibiliAccountMid
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
      .map((ledger) => ({ ...ledger, enabled: isForcedEnabled(ledger) ? true : ledger.enabled }))
    setDraftLedgers(next)
    enableStore.reset(enableEntries(next, false))
    deletionStore.reset(enableEntries(next, true))
    setSavedLedgerSnapshots(Object.fromEntries(next.filter((ledger) => !isRecoveredRemoteDraft(ledger)).map((ledger) => [ledger.id, ledgerEditorSnapshot(ledger)])))
    setLocallyUnsavedLedgerIds(new Set([...locallyUnsavedLedgerIds].filter((ledgerId) => !deletedIds.has(ledgerId))))
    if (activeLedgerId && deletedIds.has(activeLedgerId)) {
      setActiveLedgerId(null)
      setNewLedger(false)
    }
    setDeletionError(null)
    setDraftDeletionError(null)
    for (const ledger of persistedLedgers) {
      // The account-local deletion has already committed. A workspace or
      // parent projection refresh is best-effort and must not resurrect this
      // rule or turn a completed local deletion into a false failure.
      try {
        await onDeleteLedger?.(ledger.id)
      } catch {
        // The next authoritative refresh will reconcile the parent snapshot.
      }
    }
    return true
  }
  const deleteUnsavedDraft = async (ledger: FavoriteLedger) => {
    if (!isDraftDirectlyDeletable(ledger)) return
    preserveLedgerScroll()
    const wasPersisted = ledgers.some((item) => item.id === ledger.id)
    awaitingParentLedgerIdsRef.current.delete(ledger.id)
    if (wasPersisted) {
      try {
        const accountMid = currentAccountMid !== undefined
          ? currentAccountMid.trim()
          : window.bilimiDesktop?.readBilibiliAccountMid
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
    setLocallyUnsavedLedgerIds(new Set([...locallyUnsavedLedgerIds].filter((ledgerId) => ledgerId !== ledger.id)))
    setActiveLedgerId(null)
    setNewLedger(false)
    setDraftDeletionError(null)
    if (wasPersisted) {
      const result = await onDeleteLedger?.(ledger.id)
      if (result === false) setDraftDeletionError('删除未成功，请稍后重试。')
    }
  }
  const requestSingleLedgerDeletion = (ledger: FavoriteLedger) => {
    if (isDraftDirectlyDeletable(ledger)) {
      void deleteUnsavedDraft(ledger)
      return
    }
    if (isPureLocalLedger(ledger)) {
      void deleteLocalFavoriteLedgers([ledger.id])
      return
    }

    const remoteDraftFolderId = isRemoteOnlyDraft(ledger)
      ? ledger.bilibiliFolderId?.trim()
      : ledger.pendingRemoteBinding
        ? (ledger.pendingRemoteFolderId ?? ledger.bilibiliFolderId)?.trim()
        : undefined
    const remoteBindingIds = remoteBindingIdsForLedger(ledger)
    const historicalIds = (ledger.historicalBilibiliFolderIds ?? []).map((folderId) => folderId.trim()).filter(Boolean)
    const remoteDraftTargets = remoteDraftFolderId
      ? { [ledger.id]: { remoteFolderId: remoteDraftFolderId, title: ledger.displayName } }
      : {}
    const plan: Omit<ManagedDeletionPlan, 'candidates'> = {
      remoteCustomLedgerIds: !ledger.isDefault && remoteBindingIds.length && !remoteDraftFolderId ? [ledger.id] : [],
      remoteDefaultLedgerIds: ledger.isDefault && (remoteBindingIds.length || historicalIds.length || ledger.bindingState === 'unbound') ? [ledger.id] : [],
      remoteDraftTargets,
      historicalBindingTargets: ledger.isDefault && !remoteBindingIds.length && historicalIds.length
        ? {
            [ledger.id]: historicalIds.map((remoteFolderId) => ({
              remoteFolderId,
              title: ledger.historicalBilibiliFolderTitle ?? ledger.bilibiliFolderTitle ?? ledger.displayName
            }))
          }
        : {},
      localCustomLedgerIds: !ledger.isDefault && !remoteBindingIds.length && !remoteDraftFolderId ? [ledger.id] : [],
      localDefaultLedgerIds: ledger.isDefault && !remoteBindingIds.length && !historicalIds.length ? [ledger.id] : [],
      draftLedgerIds: remoteDraftFolderId ? [ledger.id] : [],
    }
    void requestManagedDeletion(plan)
  }
  const requestManagedDeletion = async (plan: Omit<ManagedDeletionPlan, 'candidates'>) => {
    const ledgerIds = [...plan.remoteCustomLedgerIds, ...plan.remoteDefaultLedgerIds]
    const remoteDraftLedgerIds = new Set(Object.keys(plan.remoteDraftTargets))
    const remotePlanLedgerIds = new Set([...ledgerIds, ...remoteDraftLedgerIds])
    const localCandidateLedgerIds = [...plan.localCustomLedgerIds, ...plan.localDefaultLedgerIds, ...plan.draftLedgerIds]
      .filter((ledgerId, index, ids) => !remotePlanLedgerIds.has(ledgerId) && ids.indexOf(ledgerId) === index)
    const localCandidates = localCandidateLedgerIds.flatMap((ledgerId) => {
      const ledger = draftLedgersRef.current.find((item) => item.id === ledgerId)
      return ledger ? [{
        logicalLedgerId: ledger.id,
        title: ledger.displayName,
        memberCount: ledger.bilibiliFolderVideoCount ?? 0,
        state: 'local-only' as const,
        requiresUnboundAcknowledgement: false
      }] : []
    })
    if (!ledgerIds.length && !remoteDraftLedgerIds.size) {
      if (!localCandidates.length) return
      setDeletionPlan({ ...plan, candidates: localCandidates })
      setDeletionScope('local-only')
      setDeletionConfirmed(false)
      setDeletionAcknowledgedUnbound(false)
      setDeletionError(null)
      return
    }
    const accountMid = window.bilimiDesktop?.readBilibiliAccountMid ? await window.bilimiDesktop.readBilibiliAccountMid() : ''
    if (!accountMid || !window.bilimiDesktop?.previewManagedFavoriteFolderDeletion) {
      setDeletionError('删除未成功，请稍后重试。')
      return
    }
    try {
      const ledgerTitleHints = Object.fromEntries(ledgerIds.flatMap((ledgerId) => {
        const ledger = draftLedgers.find((item) => item.id === ledgerId)
        return ledger ? [[ledgerId, ledger.displayName]] : []
      }))
      const hasRemoteDraftTargets = Object.keys(plan.remoteDraftTargets).length > 0
      const hasHistoricalBindingTargets = Object.keys(plan.historicalBindingTargets).length > 0
      const remoteCandidates = hasHistoricalBindingTargets
        ? await window.bilimiDesktop.previewManagedFavoriteFolderDeletion(accountMid, ledgerIds, ledgerTitleHints, hasRemoteDraftTargets ? plan.remoteDraftTargets : undefined, plan.historicalBindingTargets)
        : hasRemoteDraftTargets
          ? await window.bilimiDesktop.previewManagedFavoriteFolderDeletion(accountMid, ledgerIds, ledgerTitleHints, plan.remoteDraftTargets)
          : await window.bilimiDesktop.previewManagedFavoriteFolderDeletion(accountMid, ledgerIds, ledgerTitleHints)
      const candidates = [...remoteCandidates, ...localCandidates]
      if (!candidates.length) throw new Error('Managed folder deletion preview is unavailable.')
      setDeletionPlan({ ...plan, candidates })
      setDeletionScope('local-only')
      setDeletionConfirmed(false)
      setDeletionAcknowledgedUnbound(false)
      setDeletionError(null)
    } catch (error) {
      setDeletionError(managedDeletionErrorMessage(error))
    }
  }
  const deletePersistedDraftLedgers = async (accountMid: string, ledgerIds: readonly string[]) => {
    const ids = new Set(ledgerIds)
    const persisted = draftLedgers.filter((ledger) => ids.has(ledger.id) && ledgers.some((item) => item.id === ledger.id))
    if (!persisted.length) return
    if (!window.bilimiDesktop?.deleteFavoriteLedgerDraft) throw new Error('Draft deletion is unavailable.')
    let firstError: unknown
    for (const ledger of persisted) {
      try {
        await window.bilimiDesktop.deleteFavoriteLedgerDraft(accountMid, ledger.id)
      } catch (error) {
        firstError ??= error
      }
    }
    if (firstError) throw firstError
  }
  const deletePersistedCustomLedgers = async (accountMid: string, ledgerIds: readonly string[]) => {
    const ids = new Set(ledgerIds)
    const persisted = draftLedgers.filter((ledger) => ids.has(ledger.id) && ledgers.some((item) => item.id === ledger.id))
    if (!persisted.length) return
    if (!window.bilimiDesktop?.deleteFavoriteLedgersLocal) throw new Error('Local favorite ledger deletion is unavailable.')
    await window.bilimiDesktop.deleteFavoriteLedgersLocal(accountMid, persisted.map((ledger) => ledger.id))
  }
  const finalizeManagedDeletionPlan = async (
    plan: ManagedDeletionPlan,
    accountMid = '',
    options: { localCleanupFailed?: boolean } = {}
  ) => {
    const locallyReleasedDefaultLedgerIds = deletionScope === 'local-only'
      ? plan.remoteDefaultLedgerIds
      : []
    if (locallyReleasedDefaultLedgerIds.length) {
      if (!accountMid || !window.bilimiDesktop?.releaseDefaultFavoriteLedgerBindings) {
        throw new Error('Default favorite ledger binding release is unavailable.')
      }
      await window.bilimiDesktop.releaseDefaultFavoriteLedgerBindings(accountMid, locallyReleasedDefaultLedgerIds)
    }
    const deletedCustomIds = new Set([...plan.remoteCustomLedgerIds, ...plan.localCustomLedgerIds, ...plan.draftLedgerIds])
    const locallyResetDefaultIds = new Set(deletionScope === 'local-only'
      ? [...plan.remoteDefaultLedgerIds, ...plan.localDefaultLedgerIds]
      : [])
    // A remote-scope deletion can legitimately have no remote folder id: the
    // fresh inventory already confirmed that an unbound default rule has no
    // exact historical id or same-title candidate.  The main process persists
    // that fact as `unbacked`; mirror it in the renderer projection instead of
    // reusing the stale `unbound` draft that opened the dialog.
    const confirmedAbsentDefaultIds = new Set(deletionScope === 'bilibili'
      ? plan.candidates
        .filter((candidate) => candidate.state === 'local-only' && !candidate.remoteFolderId)
        .map((candidate) => candidate.logicalLedgerId)
        .filter((ledgerId) => draftLedgers.some((ledger) => ledger.id === ledgerId && ledger.isDefault))
      : [])
    const defaultIdsToReset = new Set([...locallyResetDefaultIds, ...confirmedAbsentDefaultIds])
    const retained = draftLedgers
      .filter((ledger) => !deletedCustomIds.has(ledger.id))
      .map((ledger) => ({
        ...ledger,
        enabled: isForcedEnabled(ledger)
          ? true
          : enableStore.isEnabled(ledger.id)
      }))
    const next = removeConfirmedRemoteBindings(retained, deletionScope === 'bilibili'
      ? plan.confirmedRemoteFolderIds ?? []
      : [], plan.candidates).map((ledger) => {
      if (!defaultIdsToReset.has(ledger.id)) return ledger
      const restored = restoreDefaultFavoriteLedgerAfterLocalDeletion(ledger)
      return confirmedAbsentDefaultIds.has(ledger.id)
        ? { ...restored, bindingState: 'unbacked' as const }
        : restored
    })
    let localCleanupFailed = Boolean(options.localCleanupFailed)
    // Remote deletion already persists the default-rule reset through the
    // main-process deletion callback. Re-saving that same snapshot here can
    // race with the authoritative write and turn a confirmed deletion into a
    // stale "local state pending" dialog. Local-only resets still need this
    // renderer save because they do not go through the remote deletion path.
    if (locallyResetDefaultIds.size) {
      try {
        await onSaveLedgers(next, { deleteDisabled: false })
      } catch {
        // The remote result is already confirmed. Retry only the idempotent
        // local snapshot write; never repeat a Bilibili deletion.
        try {
          await Promise.resolve()
          await onSaveLedgers(next, { deleteDisabled: false })
        } catch {
          localCleanupFailed = true
        }
      }
    }
    let refreshAttempted = false
    let refreshFailed = false
    // The local projection above is already the confirmed remote result. A
    // follow-up refresh is best-effort: a renderer/workspace refresh failure
    // must not turn an already completed deletion into a stale error dialog.
    for (const ledger of draftLedgers) {
      if (!deletedCustomIds.has(ledger.id) || !ledgers.some((item) => item.id === ledger.id)) continue
      if (!onDeleteLedger) continue
      refreshAttempted = true
      try {
        const result = await onDeleteLedger(ledger.id)
        if (result === false) refreshFailed = true
      } catch {
        refreshFailed = true
        // Keep the confirmed local projection and let the next authoritative
        // snapshot refresh reconcile any parent state that was unavailable.
      }
    }
    if (localCleanupFailed && (!refreshAttempted || refreshFailed)) {
      setDeletionError('B 站已删除，本地状态待保存，请刷新或重试。')
      return false
    }
    setDraftLedgers(next)
    // The parent snapshot can still contain an old `unboundLedgerIds` entry
    // during this render. A Bilibili deletion with a confirmed response is
    // the only locally authoritative case that establishes “unbacked”.
    // Keep this short-lived display projection scoped to the finalized plan.
    setConfirmedUnbackedLedgerIds((current) => new Set([
      ...current,
      ...(deletionScope === 'bilibili' ? defaultIdsToReset : []),
      ...(plan.confirmedRemoteFolderIds ?? []).flatMap((remoteFolderId) =>
        plan.candidates
          .filter((candidate) => candidate.remoteFolderId === remoteFolderId)
          .map((candidate) => candidate.logicalLedgerId)
      )
    ]))
    enableStore.reset(enableEntries(next, false))
    deletionStore.reset(enableEntries(next, true))
    setSavedLedgerSnapshots(Object.fromEntries(next.filter((ledger) => !isRecoveredRemoteDraft(ledger)).map((ledger) => [ledger.id, ledgerEditorSnapshot(ledger)])))
    setDeletionModeActive(false)
    setDeletionPlan(null)
    setDeletionConfirmed(false)
    setDeletionAcknowledgedUnbound(false)
    setDeletionError(null)
    if (deletionScope === 'bilibili') {
      Object.keys(plan.remoteDraftTargets).forEach((ledgerId) => onRemoteDraftDeleted?.(ledgerId))
    }
    return true
  }
  const confirmManagedDeletion = async () => {
    if (!deletionPlan || !deletionConfirmed || deletionExecuting) return
    if (deletionScope === 'bilibili' && deletionPlan.candidates.some((candidate) => candidate.requiresUnboundAcknowledgement) && !deletionAcknowledgedUnbound) return
    preserveLedgerScroll()
    const persistedLedgerIds = new Set(ledgers.map((ledger) => ledger.id))
    const accountRequiredLedgerIds = [
      ...deletionPlan.remoteCustomLedgerIds,
      ...deletionPlan.remoteDefaultLedgerIds,
      ...deletionPlan.localCustomLedgerIds,
      ...deletionPlan.draftLedgerIds
    ]
    const requiresAccount = deletionScope === 'bilibili' || accountRequiredLedgerIds.some((ledgerId) => persistedLedgerIds.has(ledgerId))
    const accountMid = requiresAccount && window.bilimiDesktop?.readBilibiliAccountMid
      ? await window.bilimiDesktop.readBilibiliAccountMid()
      : ''
    if (requiresAccount && !accountMid) {
      setDeletionError('删除未成功，请稍后重试。')
      return
    }
    const remoteIds = new Set([...deletionPlan.remoteCustomLedgerIds, ...deletionPlan.remoteDefaultLedgerIds])
    const remoteDraftLedgerIds = new Set(Object.keys(deletionPlan.remoteDraftTargets))
    const remotePlanLedgerIds = new Set([...remoteIds, ...remoteDraftLedgerIds])
    const ledgerTitleHints = Object.fromEntries([...remoteIds].flatMap((ledgerId) => {
      const ledger = draftLedgers.find((item) => item.id === ledgerId)
      return ledger ? [[ledgerId, ledger.displayName]] : []
    }))
    const expectedRemoteFolderIds = (ids: ReadonlySet<string>) => Object.fromEntries([...ids].map((ledgerId) => [
      ledgerId,
      [...new Set(deletionPlan.candidates
        .filter((candidate) => candidate.logicalLedgerId === ledgerId && candidate.remoteFolderId)
        .map((candidate) => candidate.remoteFolderId!))]
    ]))
    setDeletionExecuting(true)
    setDeletionError(null)
    let remoteDeletionResult: unknown
    try {
      if (deletionScope === 'bilibili' && remotePlanLedgerIds.size) {
        const historicalBindingTargetIds = Object.keys(deletionPlan.historicalBindingTargets)
        remoteDeletionResult = historicalBindingTargetIds.length
          ? await window.bilimiDesktop?.deleteManagedRemoteFolders?.(
              accountMid,
              [...remoteIds],
              deletionAcknowledgedUnbound,
              ledgerTitleHints,
              expectedRemoteFolderIds(remotePlanLedgerIds),
              remoteDraftLedgerIds.size ? deletionPlan.remoteDraftTargets : undefined,
              deletionPlan.historicalBindingTargets
            )
          : remoteDraftLedgerIds.size
          ? await window.bilimiDesktop?.deleteManagedRemoteFolders?.(
              accountMid,
              [...remoteIds],
              deletionAcknowledgedUnbound,
              ledgerTitleHints,
              expectedRemoteFolderIds(remotePlanLedgerIds),
              deletionPlan.remoteDraftTargets
            )
          : await window.bilimiDesktop?.deleteManagedRemoteFolders?.(
              accountMid,
              [...remoteIds],
              deletionAcknowledgedUnbound,
              ledgerTitleHints,
              expectedRemoteFolderIds(remotePlanLedgerIds)
            )
        if (isManagedRemoteDeletionResult(remoteDeletionResult) && remoteDeletionResult.status === 'partial-failed') {
          const succeededIds = new Set(remoteDeletionResult.succeededRemoteFolderIds)
          const succeededDraftLedgerIds = deletionPlan.candidates
            .filter((candidate) => remoteDraftLedgerIds.has(candidate.logicalLedgerId) && candidate.remoteFolderId && succeededIds.has(candidate.remoteFolderId))
            .map((candidate) => candidate.logicalLedgerId)
          await deletePersistedDraftLedgers(accountMid, succeededDraftLedgerIds)
          const next = removeConfirmedRemoteBindings(
            draftLedgers,
            remoteDeletionResult.succeededRemoteFolderIds,
            deletionPlan.candidates
          )
            .filter((ledger) => !succeededDraftLedgerIds.includes(ledger.id))
          await onSaveLedgers(next, { deleteDisabled: false })
          setDraftLedgers(next)
          enableStore.reset(enableEntries(next, false))
          deletionStore.reset(enableEntries(next, true))
          setSavedLedgerSnapshots(Object.fromEntries(next.filter((ledger) => !isRecoveredRemoteDraft(ledger)).map((ledger) => [ledger.id, ledgerEditorSnapshot(ledger)])))
          setDeletionPlan({
            ...deletionPlan,
            candidates: deletionPlan.candidates.filter((candidate) => !candidate.remoteFolderId || !succeededIds.has(candidate.remoteFolderId))
          })
          setDeletionError(partialManagedRemoteDeletionMessage(remoteDeletionResult, deletionPlan.candidates))
          // A partial response can still conclusively delete an unsaved
          // remote draft. Tell its owner only about those exact successful
          // remote targets, so a later refresh cannot project it again.
          new Set(succeededDraftLedgerIds).forEach((ledgerId) => onRemoteDraftDeleted?.(ledgerId))
          return
        }
        if (!managedFavoriteFolderDeletionSucceeded(remoteDeletionResult)) throw new Error('Remote folder deletion failed.')
      }
      let localCleanupFailed = false
      try {
        await deletePersistedDraftLedgers(accountMid, deletionPlan.draftLedgerIds)
      } catch {
        localCleanupFailed = true
      }
      try {
        await deletePersistedCustomLedgers(accountMid, [...deletionPlan.remoteCustomLedgerIds, ...deletionPlan.localCustomLedgerIds])
      } catch {
        localCleanupFailed = true
      }
      const confirmedRemoteFolderIds = deletionScope === 'bilibili'
        ? confirmedRemoteFolderIdsFromDeletionResult(remoteDeletionResult)
        : []
      const finalized = await finalizeManagedDeletionPlan({ ...deletionPlan, confirmedRemoteFolderIds }, accountMid, { localCleanupFailed })
      if (!finalized) return
    } catch (error) {
      const confirmedRemoteFolderIds = confirmedRemoteFolderIdsFromDeletionResult(remoteDeletionResult)
      const unknownRemoteFolderIds = isManagedRemoteDeletionResult(remoteDeletionResult)
        ? remoteDeletionResult.unknownRemoteFolderIds
        : []
      setDeletionError(unknownRemoteFolderIds.length
        ? '删除结果待核对：B 站未返回可靠回执，请重新打开删除确认核对后再试。'
        : confirmedRemoteFolderIds.length
          ? 'B 站已删除，本地状态待保存，请刷新或重试。'
          : managedDeletionErrorMessage(error))
    } finally {
      setDeletionExecuting(false)
    }
  }
  const confirmRebinding = async () => {
    if (!rebindCandidates || destructiveActionLocked) return
    if (rebindCandidates.some((entry) => entry.candidates.length > 0 && !(rebindSelectedFolderIds[entry.ledgerId] ?? []).length)) return
    const bindingTargetLedgerIds = rebindCandidates.map((entry) => entry.ledgerId)
    const hasCreationConfirmation = rebindCandidates.some((entry) => entry.candidates.length === 0)
    const rebindRemoteFolders = Object.fromEntries(rebindCandidates.filter((entry) => entry.candidates.length > 0).map((entry) => [
      entry.ledgerId,
      (rebindSelectedFolderIds[entry.ledgerId] ?? [])
        .map((candidateId) => entry.candidates.find((candidate) => candidate.id === candidateId))
        .filter((candidate): candidate is RebindCandidateEntry['candidates'][number] => Boolean(candidate))
        .map(({ id, title, memberCount, shardNumber }) => ({ id, title, memberCount, ...(shardNumber === undefined ? {} : { shardNumber }) }))
    ]))
    const rebindRemoteFolderIds = Object.fromEntries(Object.entries(rebindSelections)
      .filter(([ledgerId, remoteFolderId]) => rebindCandidates.some((entry) => entry.ledgerId === ledgerId && entry.candidates.length > 0) && Boolean(remoteFolderId)))
    setBackupInFlightLedgerIds(new Set(bindingTargetLedgerIds))
    try {
      const result = await onSyncLedgers(projectEnabled(draftLedgersRef.current), {
        backupTargetLedgerIds: rebindTargetLedgerIds,
        deleteDisabled: false,
        rediscoverDeletedRemoteDrafts: true,
        ...(hasCreationConfirmation ? { confirmCreateAndBind: true } : {}),
        ...(Object.keys(rebindRemoteFolderIds).length ? { rebindRemoteFolderIds } : {}),
        ...(Object.keys(rebindRemoteFolders).length ? { rebindRemoteFolders } : {})
      }) as AssistantAutomationResult & { unboundCandidates?: RebindCandidateEntry[] } | undefined
    if (result?.boundRenameCandidates?.length) {
      openRemoteDiscoveryProcessing('backup', [], result.boundRenameCandidates, rebindTargetLedgerIds)
      setRebindCandidates(null)
      setRebindTargetLedgerIds([])
      setRebindSelections({})
      setRebindSelectedFolderIds({})
      return
    }
    if (result?.unboundCandidates?.length) {
      setRebindCandidates(result.unboundCandidates)
      setRebindTargetLedgerIds(result.unboundCandidates.map((entry) => entry.ledgerId))
      setRebindSelections(Object.fromEntries(result.unboundCandidates
        .filter((entry) => entry.candidates.length)
        .map((entry) => {
          const logicalTitle = displayTitle(draftLedgersRef.current.find((ledger) => ledger.id === entry.ledgerId)?.displayName ?? entry.ledgerId)
          return [entry.ledgerId, orderedRebindCandidates(entry.candidates, logicalTitle)[0]!.id]
        })))
      setRebindSelectedFolderIds(Object.fromEntries(result.unboundCandidates
        .map((entry) => {
          const logicalTitle = displayTitle(draftLedgersRef.current.find((ledger) => ledger.id === entry.ledgerId)?.displayName ?? entry.ledgerId)
          return [entry.ledgerId, orderedRebindCandidates(entry.candidates, logicalTitle).map((candidate) => candidate.id)]
        })))
      return
    }
    onBackupConfirmationFinished?.(result)
    if (result?.ok !== false) {
      setRebindCandidates(null)
      setRebindTargetLedgerIds([])
      setRebindSelections({})
      setRebindSelectedFolderIds({})
    }
    } finally {
      setBackupInFlightLedgerIds(new Set())
    }
  }
  const processRemoteDiscoverySelection = async () => {
    const processing = remoteDiscoveryProcessing
    if (!processing || remoteDiscoveryProcessingBusy || destructiveActionLocked) return
    setRemoteDiscoveryProcessingBusy(true)
    setRemoteDiscoveryProcessingError(null)
    try {
      const selectedObservations = processing.observations
        .filter((observation) => selectedRemoteObservationFolderIds.has(observation.folderId))
      let ledgersAfterSave = draftLedgersRef.current
      if (selectedObservations.length) {
        const existingLedgerIds = new Set(ledgersAfterSave.map((ledger) => ledger.id))
        const nextPriority = ledgersAfterSave.reduce((maximum, ledger) => Math.max(maximum, ledger.priority), 0)
        const selectedDrafts = selectedObservations.flatMap((observation, index) => {
          const id = createRemoteObservationFavoriteLedgerId(observation.folderId)
          if (existingLedgerIds.has(id)) return []
          return [{
            id,
            displayName: observation.title,
            keywords: [],
            ruleType: 'keyword' as const,
            enabled: false,
            priority: nextPriority + ((index + 1) * 10),
            bilibiliFolderId: observation.folderId,
            bilibiliFolderIds: [observation.folderId],
            bilibiliFolderTitle: observation.title,
            bilibiliFolderVideoCount: observation.memberCount,
            bindingState: 'unbound' as const,
            syncState: 'local-draft' as const,
            ruleOrigin: 'saved-rule' as const,
            pendingRemoteBinding: true,
            pendingRemoteFolderId: observation.folderId,
            isDefault: false
          } satisfies FavoriteLedger]
        })
        if (selectedDrafts.length) {
          const nextLedgers = [...ledgersAfterSave, ...selectedDrafts]
          try {
            const saveResult = await onSaveLedgers(nextLedgers, { deleteDisabled: false }) as { ok?: boolean; message?: string } | undefined
            if (saveResult?.ok === false) {
              setRemoteDiscoveryProcessingError(saveResult.message ?? '本地草稿未能保存，请稍后重试。')
              return
            }
          } catch {
            setRemoteDiscoveryProcessingError('本地草稿未能保存，请稍后重试。')
            return
          }
          ledgersAfterSave = nextLedgers
          draftLedgersRef.current = nextLedgers
          setDraftLedgers(nextLedgers)
          enableStore.reset(enableEntries(nextLedgers, false))
          deletionStore.reset(enableEntries(nextLedgers, true))
          setSavedLedgerSnapshots(Object.fromEntries(nextLedgers.map((ledger) => [ledger.id, ledgerEditorSnapshot(ledger)])))
        }
      }
      const selectedRenameCandidates = processing.renameCandidates.flatMap((candidate) => {
        const shards = candidate.shards.filter((shard) =>
          selectedBoundRenameShardKeys.has(boundRenameShardKey(candidate.ledgerId, shard)))
        return shards.length ? [{ ...candidate, shards }] : []
      })
      if (selectedRenameCandidates.length) {
        const result = await onSyncLedgers(projectEnabled(ledgersAfterSave), {
          backupTargetLedgerIds: selectedRenameCandidates.map((candidate) => candidate.ledgerId),
          deleteDisabled: false,
          rediscoverDeletedRemoteDrafts: true,
          renameBoundOnly: true,
          confirmBoundRename: true,
          boundRenameShards: Object.fromEntries(selectedRenameCandidates.map((candidate) => [
            candidate.ledgerId,
            candidate.shards.map((shard) => ({
              remoteFolderId: shard.remoteFolderId,
              shardNumber: shard.shardNumber,
              currentRemoteTitle: shard.currentRemoteTitle,
              targetTitle: shard.targetTitle
            }))
          ]))
        }) as {
          ok?: boolean
          message?: string
          boundRenameCandidates?: FavoriteLedgerBoundRenameCandidate[]
        } | undefined
        if (result?.boundRenameCandidates?.length) {
          setRemoteDiscoveryProcessing({
            ...processing,
            renameCandidates: result.boundRenameCandidates
          })
          setSelectedBoundRenameShardKeys(new Set(result.boundRenameCandidates.flatMap((candidate) =>
            candidate.shards.map((shard) => boundRenameShardKey(candidate.ledgerId, shard)))))
          setRemoteDiscoveryProcessingError(result.message || 'B 站收藏夹状态已变化，请确认最新名称后继续。')
          return
        }
        if (result?.ok === false) {
          setRemoteDiscoveryProcessingError(result.message || '已绑定收藏夹改名未完成，请稍后重试。')
          return
        }
      }
      setRemoteDiscoveryProcessing(null)
      setSelectedRemoteObservationFolderIds(new Set())
      setSelectedBoundRenameShardKeys(new Set())
      if (processing.mode === 'backup') {
        const backupResult = await requestBackup({
          targetLedgerIds: processing.backupTargetLedgerIds,
          // The owner has just completed this dialog's one-window remote
          // observation decision. Preserve the established continuation
          // semantics: continue the original backup once instead of opening
          // the same confirmation again for observations intentionally left
          // out of this decision.
          skipRemoteObservationPreflight: true
        })
        if (backupResult && typeof backupResult === 'object' &&
          (backupResult as { ok?: boolean }).ok === false) return
        await processing.onDeferredBackupFinished?.(backupResult as { ok?: boolean; message?: string } | undefined)
      }
    } catch (error) {
      setRemoteDiscoveryProcessingError(error instanceof Error ? error.message : '处理未完成，请稍后重试。')
    } finally {
      setRemoteDiscoveryProcessingBusy(false)
    }
  }
  const remoteDeletionCounts = deletionPlan
    ? deletionPlan.candidates.reduce((counts, candidate) => {
      // A historical ID confirmed absent from the current Bilibili inventory
      // remains in the candidate list for local binding cleanup, but it is not
      // an actual remote folder and must not inflate the displayed shard count.
      if (candidate.remoteFolderId && candidate.state !== 'missing-remote') {
        counts.set(candidate.logicalLedgerId, (counts.get(candidate.logicalLedgerId) ?? 0) + 1)
      }
      return counts
    }, new Map<string, number>())
    : new Map<string, number>()
  const deletionCandidateGroups = deletionPlan
    ? [...deletionPlan.candidates.reduce((groups, candidate) => {
      const group = groups.get(candidate.logicalLedgerId) ?? []
      group.push(candidate)
      groups.set(candidate.logicalLedgerId, group)
      return groups
    }, new Map<string, ManagedFolderDeletionCandidate[]>())]
    : []
  const duplicateLedgerTitleCounts = draftLedgers.reduce((counts, ledger) => {
    const title = displayTitle(ledger.displayName) || ledger.displayName
    counts.set(title, (counts.get(title) ?? 0) + 1)
    return counts
  }, new Map<string, number>())
  const duplicateLedgerTitleIndexes = new Map<string, number>()
  const rebindHasCreationTarget = Boolean(rebindCandidates?.some((entry) => entry.candidates.length === 0))
  const rebindHasExistingCandidate = Boolean(rebindCandidates?.some((entry) => entry.candidates.length > 0))
  const rebindModalTitle = rebindHasCreationTarget
    ? '确认创建并绑定 bilimi 收藏夹'
    : '确认绑定 bilimi 收藏夹'
  const rebindConfirmLabel = rebindHasCreationTarget
    ? '确认创建并绑定'
    : '确认绑定'
  return <section ref={ledgerHintPanelRef} className="favorite-ledger-panel__ledger-list" aria-label="收藏夹">
    <div className="favorite-ledger-panel__workspace">
      <section className="favorite-ledger-panel__checklist" aria-label="收藏夹规则">
        <div className="favorite-ledger-panel__category-header"><button ref={ledgerHintTriggerRef} type="button" className="favorite-ledger-panel__help-toggle favorite-ledger-panel__section-title" aria-label={`${ledgerHintExpanded ? '收起' : '固定显示'}收藏夹说明`} aria-expanded={ledgerHintExpanded} aria-describedby="favorite-ledger-help-tooltip" onMouseEnter={() => setLedgerHintVisible(true)} onMouseLeave={() => { if (!ledgerHintExpanded) setLedgerHintVisible(false) }} onFocus={() => setLedgerHintVisible(true)} onBlur={() => { if (!ledgerHintExpanded) setLedgerHintVisible(false) }} onClick={() => setLedgerHintExpanded((open) => { const next = !open; setLedgerHintVisible(next); if (next) window.dispatchEvent(new CustomEvent(FIXED_ASSISTANT_HELP_EVENT, { detail: 'ledger' })); return next })}><h3>收藏夹</h3><Chevron /></button><div className="favorite-ledger-panel__category-actions" data-deletion-mode={deletionModeActive || undefined}><button type="button" disabled={isLocalToggleOnly || destructiveActionLocked} onClick={() => setResetConfirmOpen(true)}>重置</button><FavoriteLedgerEnableSummary store={deletionModeActive ? deletionStore : enableStore}>{({ allOperableEnabled }) => <button type="button" data-testid="favorite-ledger-cancel-all" disabled={isLocalToggleOnly} onClick={toggleAll}>{allOperableEnabled ? '取消全选' : '全选'}</button>}</FavoriteLedgerEnableSummary><button type="button" aria-label="备册收藏夹" disabled={isLocalToggleOnly || (!deletionModeActive && (destructiveActionLocked || !hasSelectedBackupLedger))} title={!deletionModeActive && !hasSelectedBackupLedger ? '请先勾选至少一个 bilimi 收藏夹，再备册到 B 站。' : undefined} onClick={() => void requestSync()}>{deletionModeActive ? '删除' : '备册'}</button><button type="button" className="favorite-ledger-panel__mode-toggle" aria-label={deletionModeActive ? '取消删除模式' : '展开删除模式'} title={deletionModeActive ? '取消删除 bilimi 工作夹模式' : '打开删除 bilimi 收藏夹模式'} disabled={isLocalToggleOnly} onClick={deletionModeActive ? cancelDeletionMode : enterDeletionMode}>×</button></div></div>
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
          return <FavoriteLedgerEnableButton key={ledger.id} store={deletionModeActive ? deletionStore : enableStore} id={ledger.id} onToggle={() => toggle(ledger.id)}>{({ enabled, saveError: toggleSaveError, toggle: toggleEnabled }) => {
              const ledgerDisplayName = ledger.displayName
              return <div data-testid={`favorite-ledger-chip-${ledger.id}`} className="favorite-ledger-panel__chip-item"
                data-dragging={draggedLedgerId === ledger.id ? 'true' : undefined} data-drop-position={dropPosition}
                data-default-system-disabled={disabledBySystem ? 'true' : undefined} data-deletion-selected={deletionModeActive && enabled && !disabledBySystem || undefined} aria-label={dropPosition ? `插入到${displayTitle(ledger.displayName)}上方` : undefined}
                onDragOver={(event) => dragOver(ledger.id, event)} onDrop={(event) => dropOn(ledger.id, event)}>
              <button type="button" disabled={isLocalToggleOnly} draggable={!isLocalToggleOnly && !destructiveActionLocked} aria-label={ledgerLabel} title={`${ledgerDisplayName}${bindingLabel ? ` · ${bindingLabel}` : ''}`} aria-pressed={enabled && !disabledBySystem}
                onDragStart={(event) => beginDrag(ledger.id, event)} onDragEnd={() => { setDraggedLedgerId(null); setDragTarget(null) }} onClick={() => {
                if (activeLedgerId === ledger.id) {
                  setActiveLedgerId(null)
                  setNewLedger(false)
                  setDraftDeletionError(null)
                  return
                }
                setActiveLedgerId(ledger.id)
                setNewLedger(false)
                setDraftDeletionError(null)
              }}><span className="favorite-ledger-panel__chip-label">{ledgerLabel}</span>{bindingLabel ? <small className="favorite-ledger-panel__binding-status" data-binding-state={bindingStateForLedger(ledger, bindingLabel)}>{bindingLabel}</small> : null}</button>
              <button type="button" draggable={false} className="favorite-ledger-panel__chip-action" aria-label={`${enabled ? (deletionModeActive ? '取消删除' : '移出同步') : (deletionModeActive ? '加入删除' : '加入同步')} ${ledgerDisplayName}`} data-enabled={enabled && !disabledBySystem} disabled={deletionModeActive ? !deletionStore.isOperable(ledger.id) : !isOperable(ledger)} onDragStart={(event) => event.preventDefault()} onClick={toggleEnabled}>{enabled && !disabledBySystem ? '✓' : '+'}</button>
              {toggleSaveError ? <p role="alert" className="favorite-ledger-panel__notice">{toggleSaveError}</p> : null}
            </div>
            }}</FavoriteLedgerEnableButton>
        })}</div>
        {deletionModeActive && deletionError && !deletionPlan ? <p role="alert" className="favorite-ledger-panel__notice">{deletionError}</p> : null}
        {hasRemoteDetectionNotice ? <div className="favorite-ledger-panel__notice">
          <span>检测到 {observedRemoteObservations.length} 个疑似 bilimi 收藏夹、{observedBoundRenameCandidates.length} 个已绑定收藏夹名称变更。</span>
          <button type="button" onClick={() => openRemoteDiscoveryProcessing(
            'details',
            observedRemoteObservations,
            observedBoundRenameCandidates,
            []
          )}>查看详情</button>
          {onDismissRemoteDiscoveryNotice ? <button type="button" onClick={onDismissRemoteDiscoveryNotice}>暂不提醒</button> : null}
        </div> : null}
        <div className="favorite-ledger-panel__list-toggle"><button type="button" disabled={isLocalToggleOnly} onClick={add}>新建收藏夹</button>{canToggleLedgerList ? <button type="button" aria-expanded={fullLedgerListVisible} onClick={() => setLedgerListExpanded((expanded) => !expanded)}>{fullLedgerListVisible ? '折叠' : '展开'}</button> : null}</div>
      </section>
      {backupSkipNotice ? <p className="favorite-ledger-panel__notice" role="alert">{backupSkipNotice}</p> : null}
        {active ? <section ref={editorRef} className="favorite-ledger-panel__editor" aria-label="当前收藏夹" data-ledger-id={active.id}><div className="favorite-ledger-panel__editor-title"><strong>{newLedger ? '新建收藏夹' : '正在编辑：'}{active.displayName}</strong><div className="favorite-ledger-panel__editor-actions"><button type="button" disabled={isLocalToggleOnly || !valid} onClick={() => void save()}>保存</button><button type="button" onClick={close}>收起</button>{!active.isDefault ? <button type="button" disabled={isLocalToggleOnly} onClick={() => requestSingleLedgerDeletion(active)}>删除</button> : null}</div></div>
         {remoteOnlyDraftLedgerIds.includes(active.id) && active.bilibiliFolderId ? <p className="favorite-ledger-panel__remote-draft-notice">
           发现 B 站疑似 bilimi 收藏夹，本地尚未建立绑定，可编辑保存好之后备册；更换电脑时建议先迁移数据。
           {onDismissRemoteDraftReminder ? <button type="button" onClick={() => void onDismissRemoteDraftReminder(active.id, [...new Set([
             ...(active.bilibiliFolderIds ?? []), active.bilibiliFolderId!
           ])])}>不再提醒</button> : null}
          </p> : null}
         {saveError ? <p className="favorite-ledger-panel__notice" role="alert">{saveError}</p> : null}
         {draftDeletionError ? <p className="favorite-ledger-panel__notice" role="alert">{draftDeletionError}</p> : null}
         {draftRuleAnalysis ? <div className="favorite-ledger-panel__rule-analysis" role="status">
          <span>{draftRuleAnalysis.status === 'canceling' ? '正在取消分析…' : `正在分析 ${draftRuleAnalysis.completedItemCount} / ${draftRuleAnalysis.totalItemCount} 条`}</span>
          <progress aria-label="收藏夹规则分析进度" value={draftRuleAnalysis.completedItemCount} max={Math.max(1, draftRuleAnalysis.totalItemCount)}
            aria-valuemin={0} aria-valuenow={draftRuleAnalysis.completedItemCount} aria-valuemax={Math.max(1, draftRuleAnalysis.totalItemCount)} />
          <button type="button" disabled={draftRuleAnalysis.status === 'canceling'} onClick={onCancelDraftRuleAnalysis}>取消分析</button>
        </div> : draftRuleAnalysisError ? <p className="favorite-ledger-panel__notice" role="alert">{draftRuleAnalysisError}</p> : null}
         <label><span className="favorite-ledger-panel__ledger-name-label"><span>册名 <small data-invalid={!valid}>{validation.length}/{BILIBILI_FAVORITE_LEDGER_NAME_MAX_LENGTH}</small></span>{activeVideoCount === undefined ? null : <small className="favorite-ledger-panel__ledger-video-count">{activeVideoCount} 个视频</small>}{editorStatusLabelForLedger(active) ? <small className="favorite-ledger-panel__binding-status" data-binding-state={bindingStateForLedger(active, editorStatusLabelForLedger(active))}>{editorStatusLabelForLedger(active)}</small> : null}</span><span className="favorite-ledger-panel__prefixed-input"><span className="favorite-ledger-panel__fixed-prefix" aria-hidden="true">{BILIMI_LEDGER_PREFIX}</span><input aria-label="册名" value={title} onChange={(event) => update({ displayName: `${BILIMI_LEDGER_PREFIX}${event.currentTarget.value}` })} /></span>{activeRemoteBindingIds.length ? <small className="favorite-ledger-panel__binding-summary">B站绑定：{activeRemoteBindingIds.length} 个收藏夹{activeVideoCount === undefined ? '' : `，共 ${activeVideoCount} 个视频`}</small> : null}{activePendingRemoteBinding ? <small className="favorite-ledger-panel__binding-summary">新增分区待确认绑定</small> : null}{!validation.valid ? <small role="alert">B站收藏夹名称最多20个字，当前{validation.length}个字</small> : active.bilibiliFolderId && active.bilibiliFolderTitle && active.bilibiliFolderTitle !== active.displayName ? <small className="favorite-ledger-panel__name-sync-status">册名不同步；下次备册会按 bilimi 册名更新 B 站。</small> : null}</label>
        <label>收藏夹种类<select aria-label="收藏夹种类" disabled={active.isDefault} value={active.ruleType ?? 'keyword'} onChange={(event) => update({ ruleType: event.currentTarget.value as FavoriteLedgerRuleType, keywords: [] })}>{TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
        <label>{ruleLabel(active.ruleType)}<textarea aria-label={ruleLabel(active.ruleType)}
          value={(active.ruleType ?? 'keyword') === 'deepseek' ? active.keywords.join('\n') : activeRules.localKeywords.join('、')}
          onChange={(event) => update({ keywords: composeKeywords(event.currentTarget.value, activeRules.deepSeekConstraint ?? '', active.ruleType ?? 'keyword') })} /></label>
        {(active.ruleType ?? 'keyword') !== 'deepseek' ? <label className="favorite-ledger-panel__deepseek-constraint-line">
          <span>DeepSeek约束：</span>
          <input aria-label="DeepSeek约束" value={activeRules.deepSeekConstraint ?? ''}
            onChange={(event) => update({ keywords: composeKeywords(activeRules.localKeywords.join('、'), event.currentTarget.value, active.ruleType ?? 'keyword') })} />
        </label> : null}
        <p className="favorite-ledger-panel__keyword-hint">{ruleHint(active.ruleType)}</p>
      </section> : null}
      {deletionPlan ? <OldFavoriteModal danger title="删除 bilimi 收藏夹" confirmLabel={deletionExecuting ? '删除中…' : '删除'} confirmDisabled={!deletionPlan.candidates.length || !deletionConfirmed || deletionExecuting || (deletionScope === 'bilibili' && deletionPlan.candidates.some((candidate) => candidate.requiresUnboundAcknowledgement) && !deletionAcknowledgedUnbound)} onCancel={() => { if (deletionExecuting) return; setDeletionPlan(null); setDeletionConfirmed(false); setDeletionAcknowledgedUnbound(false); setDeletionScope('local-only'); setDeletionError(null) }} onConfirm={() => void confirmManagedDeletion()}>
        <p>以下 {deletionPlan.candidates.length} 个右侧 bilimi 收藏夹将被删除或移除：</p>
        <fieldset className="favorite-ledger-panel__deletion-scope"><legend>删除范围</legend><label className="favorite-ledger-panel__deletion-scope-option"><input type="radio" name="managed-deletion-scope" checked={deletionScope === 'local-only'} onChange={() => setDeletionScope('local-only')} /><span>仅删除右侧 bilimi 收藏夹（保留收藏库和 B 站收藏夹）</span></label><label className="favorite-ledger-panel__deletion-scope-option"><input type="radio" name="managed-deletion-scope" checked={deletionScope === 'bilibili'} onChange={() => setDeletionScope('bilibili')} /><span>同时从 B 站删除收藏夹（保留收藏库）</span></label></fieldset>
        <ul className="favorite-ledger-panel__deletion-list">{deletionCandidateGroups.map(([logicalLedgerId, candidates]) => {
          const groupTitle = displayTitle(draftLedgers.find((ledger) => ledger.id === logicalLedgerId)?.displayName ?? candidates[0]?.title ?? logicalLedgerId)
          const currentRemoteCount = candidates.filter((candidate) => candidate.remoteFolderId && candidate.state !== 'missing-remote').length
          return <li key={logicalLedgerId} data-testid={`managed-deletion-group-${logicalLedgerId}`} className="favorite-ledger-panel__deletion-group">
            {currentRemoteCount > 0 ? <strong>{groupTitle}（{currentRemoteCount} 个分册）</strong> : null}
            <ul>{candidates.map((candidate) => {
              const remoteDeletionCount = remoteDeletionCounts.get(candidate.logicalLedgerId) ?? 0
              const isRemoteDraftCandidate = Boolean(deletionPlan.remoteDraftTargets[candidate.logicalLedgerId])
              const isHistoricalCandidate = candidate.state === 'unbound-historical-id'
              const isMissingRemoteCandidate = candidate.state === 'missing-remote'
              const remoteSummary = deletionScope === 'local-only'
                ? 'B站：保留'
                : isMissingRemoteCandidate
                  ? 'B站：远端已不存在，不会删除'
                : remoteDeletionCount
                  ? `B站：删除 ${remoteDeletionCount} 个实际收藏夹`
                  : 'B站：无绑定，不会删除'
              return <li key={`${candidate.logicalLedgerId}:${candidate.remoteFolderId ?? 'local'}`}>{candidate.title}{isRemoteDraftCandidate ? '（未保存 · 未绑定 / 仅名称识别）' : isHistoricalCandidate ? '（历史分册 / 精确 ID 核验）' : isMissingRemoteCandidate ? '（历史分册 / 远端已不存在）' : ''}（当前 {candidate.memberCount} 个视频）{remoteSummary}</li>
            })}</ul>
          </li>
        })}</ul>
        <p>{deletionScope === 'local-only'
          ? '只移除右侧规则或草稿；收藏库和 B 站保留。'
          : '收藏库工作夹和成员保留。'}</p>
        <label><input type="checkbox" checked={deletionConfirmed} onChange={(event) => setDeletionConfirmed(event.currentTarget.checked)} />我已确认</label>
        {deletionScope === 'bilibili' && deletionPlan.candidates.some((candidate) => candidate.requiresUnboundAcknowledgement) ? <label><input type="checkbox" checked={deletionAcknowledgedUnbound} onChange={(event) => setDeletionAcknowledgedUnbound(event.currentTarget.checked)} />已检测到未绑定的 bilimi 收藏夹。请确认名称识别候选不是你在 B 站手动创建的同名普通收藏夹，并确认历史分册候选的精确 ID后再勾选。</label> : null}
        {deletionError ? <p role="alert" className="favorite-ledger-panel__notice">{deletionError}</p> : null}
      </OldFavoriteModal> : null}
      {remoteDiscoveryProcessing ? <OldFavoriteModal
        title="发现待处理的 bilimi 收藏夹"
        confirmLabel={remoteDiscoveryProcessing.mode === 'backup' ? '确认处理并继续备册' : '开始处理'}
        confirmDisabled={remoteDiscoveryProcessingBusy || destructiveActionLocked ||
          (selectedRemoteObservationFolderIds.size === 0 && selectedBoundRenameShardKeys.size === 0)}
        onCancel={closeRemoteDiscoveryProcessing}
        onConfirm={() => void processRemoteDiscoverySelection()}
      >
        <p>发现以下 B 站收藏夹需要你确认处理。疑似收藏夹将生成本地草稿；已绑定收藏夹的名称变更将同步修改到 B 站。不会自动绑定或创建收藏夹。</p>
        <p>{remoteDiscoveryProcessing.mode === 'backup' ? '确认处理后将继续执行备册。' : '处理不会启动备册。'}</p>
        {(() => {
          const observationCount = remoteDiscoveryProcessing.observations.length
          const renameCount = remoteDiscoveryProcessing.renameCandidates.reduce((count, candidate) => count + candidate.shards.length, 0)
          const totalCount = observationCount + renameCount
          const selectedCount = selectedRemoteObservationFolderIds.size + selectedBoundRenameShardKeys.size
          const allSelected = totalCount > 0 && selectedCount === totalCount
          return <>
            <label className="favorite-ledger-panel__remote-discovery-choice"><input
              type="checkbox"
              aria-label={`全选（共 ${totalCount} 项）`}
              checked={allSelected}
              ref={(node) => { if (node) node.indeterminate = selectedCount > 0 && !allSelected }}
              onChange={(event) => {
                if (event.currentTarget.checked) {
                  setSelectedRemoteObservationFolderIds(new Set(remoteDiscoveryProcessing.observations.map((observation) => observation.folderId)))
                  setSelectedBoundRenameShardKeys(new Set(remoteDiscoveryProcessing.renameCandidates.flatMap((candidate) =>
                    candidate.shards.map((shard) => boundRenameShardKey(candidate.ledgerId, shard)))))
                } else {
                  setSelectedRemoteObservationFolderIds(new Set())
                  setSelectedBoundRenameShardKeys(new Set())
                }
              }}
            />全选（共 {totalCount} 项）</label>
            <div className="favorite-ledger-panel__remote-discovery-groups">
              {observationCount ? <section className="favorite-ledger-panel__remote-discovery-group">
                <h3>疑似 bilimi 收藏夹（{observationCount}）</h3>
                {remoteDiscoveryProcessing.observations.map((observation) => <label key={observation.folderId} className="favorite-ledger-panel__remote-discovery-choice"><input
                  type="checkbox"
                  aria-label={`${observation.title}（${observation.memberCount} 个视频）`}
                  checked={selectedRemoteObservationFolderIds.has(observation.folderId)}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked
                    setSelectedRemoteObservationFolderIds((current) => {
                    const next = new Set(current)
                    if (checked) next.add(observation.folderId)
                    else next.delete(observation.folderId)
                    return next
                    })
                  }}
                />{observation.title}（{observation.memberCount} 个视频）</label>)}
              </section> : null}
              {observationCount && renameCount ? <div className="favorite-ledger-panel__remote-discovery-divider" role="separator" /> : null}
              {renameCount ? <section className="favorite-ledger-panel__remote-discovery-group">
                <h3>已绑定收藏夹名称变更（{renameCount}）</h3>
                {remoteDiscoveryProcessing.renameCandidates.flatMap((candidate) => candidate.shards.map((shard) => {
                  const shardKey = boundRenameShardKey(candidate.ledgerId, shard)
                  const label = `${shard.currentRemoteTitle} → ${shard.targetTitle}（${shard.remoteMemberCount} 个视频）`
                  return <label key={shardKey} className="favorite-ledger-panel__remote-discovery-choice"><input
                    type="checkbox"
                    aria-label={label}
                    checked={selectedBoundRenameShardKeys.has(shardKey)}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked
                      setSelectedBoundRenameShardKeys((current) => {
                      const next = new Set(current)
                      if (checked) next.add(shardKey)
                      else next.delete(shardKey)
                      return next
                      })
                    }}
                  />{label}</label>
                }))}
              </section> : null}
            </div>
          </>
        })()}
        {remoteDiscoveryProcessingError ? <p role="alert" className="favorite-ledger-panel__notice">{remoteDiscoveryProcessingError}</p> : null}
      </OldFavoriteModal> : null}
      {rebindCandidates ? <OldFavoriteModal className="old-favorite-modal__dialog--rebind" title={rebindModalTitle} confirmLabel={rebindConfirmLabel} confirmDisabled={rebindCandidates.some((entry) => entry.candidates.length > 0 && !(rebindSelectedFolderIds[entry.ledgerId] ?? []).length)} onCancel={() => { setRebindCandidates(null); setRebindTargetLedgerIds([]); setRebindSelections({}); setRebindSelectedFolderIds({}) }} onConfirm={() => void confirmRebinding()}>
        {rebindHasCreationTarget
          ? <p>以下已选收藏夹中，未找到可复用同名 bilimi 收藏夹的项会创建并绑定新的 B 站收藏夹；不会同步视频或处理其他收藏夹。{rebindHasExistingCandidate ? '已有候选的项请确认要绑定的实际收藏夹。' : ''}</p>
          : <p>检测到 B 站已有同名 bilimi 收藏夹，请确认要绑定的实际收藏夹。确认后只记录精确绑定，不会更改 B 站收藏夹名称。系统不会按名称自动绑定。</p>}
        <div className="favorite-ledger-panel__rebind-scroll">{rebindCandidates.map((entry) => {
           const ledger = draftLedgers.find((item) => item.id === entry.ledgerId)
           const logicalTitle = displayTitle(ledger?.displayName ?? entry.ledgerId)
           const defaultCandidates = orderedRebindCandidates(entry.candidates, logicalTitle)
          const selectedIds = rebindSelectedFolderIds[entry.ledgerId] ?? []
          const candidates = [
            ...selectedIds.map((candidateId) => defaultCandidates.find((candidate) => candidate.id === candidateId))
              .filter((candidate): candidate is RebindCandidateEntry['candidates'][number] => Boolean(candidate)),
            ...defaultCandidates.filter((candidate) => !selectedIds.includes(candidate.id))
          ]
          const allSelected = defaultCandidates.length > 0 && selectedIds.length === defaultCandidates.length
          const moveSelectedCandidate = (candidateId: string, direction: -1 | 1) => {
            setRebindSelectedFolderIds((current) => {
              const currentIds = current[entry.ledgerId] ?? []
              const index = currentIds.indexOf(candidateId)
              const targetIndex = index + direction
              if (index < 0 || targetIndex < 0 || targetIndex >= currentIds.length) return current
              const nextIds = [...currentIds]
              ;[nextIds[index], nextIds[targetIndex]] = [nextIds[targetIndex]!, nextIds[index]!]
              setRebindSelections((selection) => ({ ...selection, [entry.ledgerId]: nextIds[0] ?? '' }))
              return { ...current, [entry.ledgerId]: nextIds }
            })
          }
          return <div key={entry.ledgerId} className="favorite-ledger-panel__rebind-choice">
            {defaultCandidates.length === 0
              ? <label><input type="checkbox" checked readOnly aria-label={`${logicalTitle}（将创建并绑定）`} /><span>{logicalTitle}（将创建并绑定）</span></label>
              : <label>
                  <input type="checkbox" checked={allSelected} ref={(node) => { if (node) node.indeterminate = selectedIds.length > 0 && !allSelected }} onChange={(event) => {
                    const nextIds = event.currentTarget.checked ? defaultCandidates.map((candidate) => candidate.id) : []
                    setRebindSelectedFolderIds((current) => ({ ...current, [entry.ledgerId]: nextIds }))
                    setRebindSelections((current) => ({ ...current, [entry.ledgerId]: nextIds[0] ?? '' }))
                  }} />
                  <span>{logicalTitle}（共 {defaultCandidates.reduce((count, candidate) => count + candidate.memberCount, 0)} 个视频）</span>
                </label>}
            {candidates.length > 0 ? <div className="favorite-ledger-panel__rebind-candidates">
              {candidates.map((candidate, index) => {
                const selectedIndex = selectedIds.indexOf(candidate.id)
                const titleShardNumber = candidate.title.trim().match(/·([2-9]\d*)$/u)?.[1]
                const displayedShardNumber = selectedIndex >= 0 && selectedIds.length > 1
                  ? selectedIndex + 1
                  : titleShardNumber ? Number(titleShardNumber) : index + 1
                return <div key={candidate.id} className="favorite-ledger-panel__rebind-candidate"><label><input type="checkbox" checked={selectedIndex >= 0} onChange={(event) => setRebindSelectedFolderIds((current) => {
                  const nextIds = event.currentTarget.checked
                    ? defaultCandidates.filter((item) => new Set([...selectedIds, candidate.id]).has(item.id)).map((item) => item.id)
                    : selectedIds.filter((id) => id !== candidate.id)
                  setRebindSelections((selection) => ({ ...selection, [entry.ledgerId]: nextIds[0] ?? '' }))
                  return { ...current, [entry.ledgerId]: nextIds }
                })} />分册 {displayedShardNumber}：{candidate.title}（{candidate.memberCount} 个视频，确认后仅绑定，不修改 B 站名称）{candidate.bindingFailureReason ? ` — 绑定失败：${candidate.bindingFailureReason}` : ''}</label>{selectedIndex >= 0 && selectedIds.length > 1 ? <span className="favorite-ledger-panel__rebind-order"><button type="button" aria-label={`将分册 ${displayedShardNumber} 上移`} title="上移" disabled={selectedIndex === 0} onClick={() => moveSelectedCandidate(candidate.id, -1)}>↑</button><button type="button" aria-label={`将分册 ${displayedShardNumber} 下移`} title="下移" disabled={selectedIndex === selectedIds.length - 1} onClick={() => moveSelectedCandidate(candidate.id, 1)}>↓</button></span> : null}</div>
              })}
            </div> : null}
          </div>
        })}</div>
      </OldFavoriteModal> : null}
    </div>
    {resetConfirmOpen ? <OldFavoriteModal title="重置收藏夹规则？" confirmLabel="确认重置" onCancel={() => setResetConfirmOpen(false)} onConfirm={() => { resetLedgers(); setResetConfirmOpen(false) }}><p>恢复默认收藏夹名称和分类规则，保留自建收藏夹但取消其勾选，不会删除已有收藏夹。</p></OldFavoriteModal> : null}
  </section>
})

function Chevron() {
  return <svg className="favorite-ledger-panel__chevron" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m3 6 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
