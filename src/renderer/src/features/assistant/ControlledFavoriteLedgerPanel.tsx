import type {
  FavoriteLedger,
  FavoriteLedgerBoundRenameCandidate,
  FavoriteLedgerSaveOptions,
  RemoteFavoriteLedgerObservation
} from '@shared/types'
import type { OldFavoriteWorkspaceBilibiliSyncPreflight, OldFavoriteWorkspaceRecoverySummary, OldFavoriteWorkspaceSnapshot } from '@shared/oldFavoriteWorkspace'
import { stripBilimiLedgerPrefix } from '@shared/favoriteLedgers'
import { parseFavoriteLedgerRules } from '@shared/favoriteLedgerConstraints'
import { useCallback, useEffect, useRef, useState } from 'react'
import clickedPetUrl from '../../assets/pet/blue-white-maid/character/big-head/clicked.png'
import hintPetUrl from '../../assets/pet/blue-white-maid/character/big-head/hint.png'
import idlePetUrl from '../../assets/pet/blue-white-maid/character/big-head/idle.png'
import { AssistantActionButton } from './AssistantActionButton'
import { FavoriteLedgerOverview, type FavoriteLedgerOverviewHandle } from './FavoriteLedgerOverview'
import { FavoriteLibraryEntry } from './FavoriteLibraryEntry'
import { OldFavoriteGuide, type OldFavoriteGuideStep } from './OldFavoriteGuide'
import { OldFavoriteModal } from './OldFavoriteModal'
import { useOldFavoriteWorkspace } from './useOldFavoriteWorkspace'
import type { FavoriteLibraryWorkspaceSelection } from './assistantRuntimeTypes'

type ControlledFavoriteLedgerPanelProps = {
  currentAccountMid?: string
  /** Signed-out local mode may operate only a persisted unbacked custom toggle. */
  localFavoriteToggleAccountMid?: string
  ledgers: FavoriteLedger[]
  missingLedgerIds: string[]
  unboundLedgerIds?: string[]
  remoteOnlyDraftLedgerIds?: string[]
  observedRemoteObservations?: readonly RemoteFavoriteLedgerObservation[]
  observedBoundRenameCandidates?: readonly FavoriteLedgerBoundRenameCandidate[]
  remoteDiscoveryNoticeDismissed?: boolean
  onDismissRemoteDiscoveryNotice?: () => void
  onDismissRemoteDraftReminder?: (ledgerId: string, remoteFolderId: string) => Promise<void> | void
  defaultFavoriteSystemEnabled?: boolean
  onEnsureLedgers: () => Promise<unknown>
  onSaveLedgers: (ledgers: FavoriteLedger[], options?: FavoriteLedgerSaveOptions) => Promise<unknown> | void
  onSaveLedgerEnabled?: (
    ledgerId: string,
    enabled: boolean,
    historyOptions?: { mergeFavoriteRuleHistory?: true }
  ) => Promise<unknown> | void
  onSyncLedgers?: (ledgers: FavoriteLedger[], options?: FavoriteLedgerSaveOptions) => Promise<unknown> | void
  onOpenFavoritePage?: () => Promise<unknown> | void
  onRefreshOrganizationState?: (options?: { reconcileFavoriteBindingProjection?: boolean }) => Promise<unknown> | void
  onOrganizationSnapshotChange?: (snapshot: OldFavoriteWorkspaceSnapshot | null) => void
  onAcknowledgeOrganizationCompletion?: (accountMid: string, workspaceId: string) => void
  onTransientFeedback?: (message: string) => void
  onFavoriteLibraryOpened?: () => void
  onDeepSeekTaskStart?: (detail: string) => () => void
  deepSeekArchiveAvailable?: boolean
  openLedgerId?: string
  openLedgerRequestVersion?: number
  createLedger?: boolean
  createLedgerRequestVersion?: number
  openOrganizationRequestVersion?: number
  openOrganizationSelectionAids?: number[]
  openOrganizationSelection?: FavoriteLibraryWorkspaceSelection
}

function normalizeAccountMid(value: string | undefined) {
  if (!value || !/^\d+$/.test(value.trim()) || BigInt(value.trim()) === 0n) return null
  return BigInt(value.trim()).toString()
}

function isOrganizationSelectionSnapshot(
  snapshot: ReturnType<typeof useOldFavoriteWorkspace>['snapshot']
): snapshot is OldFavoriteWorkspaceSnapshot {
  return Boolean(snapshot && !('recovery' in snapshot) &&
    (snapshot.status === 'previewing' || snapshot.status === 'completed'))
}

function isVisibleOrganizationRecommendationEditing(
  snapshot: ReturnType<typeof useOldFavoriteWorkspace>['snapshot'],
  guideOpen: boolean
): snapshot is OldFavoriteWorkspaceSnapshot {
  return Boolean(guideOpen && snapshot && !('recovery' in snapshot) && snapshot.status === 'previewing')
}

function recoveryPreparationFailureMessage(error: unknown) {
  const detail = error instanceof Error ? error.message : ''
  if (detail.includes('requires rebuild')) return '工作镜像暂时无法恢复，请重新打开整理收藏。'
  return '整理草稿准备失败，请重新尝试。'
}

function waitForVisiblePaint() {
  return new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      window.clearTimeout(fallbackTimer)
      resolve()
    }
    const fallbackTimer = window.setTimeout(finish, 100)
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(finish)
    })
  })
}

function enabledMapsMatch(left: ReadonlyMap<string, boolean>, right: ReadonlyMap<string, boolean>) {
  if (left.size !== right.size) return false
  return [...left].every(([id, enabled]) => right.get(id) === enabled)
}

function sameRecommendationCandidateIds(left: readonly string[], right: readonly string[]) {
  const normalize = (ids: readonly string[]) => [...new Set(ids.map((id) => id.trim()).filter(Boolean))].sort()
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right))
}

type RecommendationProjection = {
  candidateToLedgerId: Map<string, string>
  ledgerToCandidateId: Map<string, string>
}

export function createRecommendationProjection(
  linksOrLedgers: OldFavoriteWorkspaceSnapshot['recommendations']['links'] | readonly FavoriteLedger[] | undefined,
  candidates?: readonly { id: string }[],
  persistedLedgerIds?: ReadonlySet<string>
): RecommendationProjection {
  const candidateToLedgerId = new Map<string, string>()
  const ledgerToCandidateId = new Map<string, string>()
  if (Array.isArray(linksOrLedgers)) {
    const savedIds = persistedLedgerIds ?? new Set(linksOrLedgers.map((ledger) => ledger.id))
    for (const candidate of candidates ?? []) {
      if (!savedIds.has(candidate.id)) continue
      candidateToLedgerId.set(candidate.id, candidate.id)
      ledgerToCandidateId.set(candidate.id, candidate.id)
    }
    return { candidateToLedgerId, ledgerToCandidateId }
  }
  for (const [candidateId, link] of Object.entries(linksOrLedgers ?? {})) {
    if (link.status !== 'linked') continue
    candidateToLedgerId.set(candidateId, link.ledgerId)
    ledgerToCandidateId.set(link.ledgerId, candidateId)
  }
  return { candidateToLedgerId, ledgerToCandidateId }
}

export function resolveRecommendationOpenLedgerId(
  openLedgerId: string | undefined,
  linksOrLedgers: OldFavoriteWorkspaceSnapshot['recommendations']['links'] | readonly FavoriteLedger[] | undefined,
  candidates?: readonly { id: string }[]
) {
  if (!openLedgerId) return undefined
  const projection = createRecommendationProjection(linksOrLedgers, candidates)
  return projection.candidateToLedgerId.get(openLedgerId) ?? (Array.isArray(linksOrLedgers) && candidates?.some((candidate) => candidate.id === openLedgerId) ? undefined : openLedgerId)
}

/** @deprecated compatibility helper for tests; production no longer creates promoted ledgers. */
export function mergePromotedRecommendationLedgers(ledgers: readonly FavoriteLedger[], promotedLedgers: readonly FavoriteLedger[]) {
  const byId = new Map(ledgers.map((ledger) => [ledger.id, ledger]))
  for (const ledger of promotedLedgers) {
    const existing = byId.get(ledger.id)
    const hasRemoteBinding = Boolean(existing?.bilibiliFolderId?.trim()) ||
      (existing?.bilibiliFolderIds ?? []).some((folderId) => folderId.trim())
    byId.set(ledger.id, hasRemoteBinding ? existing! : ledger)
  }
  return [...byId.values()]
}

function confirmationNeedsBackup(
  snapshot: Exclude<ReturnType<typeof useOldFavoriteWorkspace>['snapshot'], null>,
  ledgers: FavoriteLedger[],
  missingLedgerIds: string[]
) {
  if ('recovery' in snapshot) return false
  const knownMissing = new Set(missingLedgerIds)
  const ledgerById = new Map(ledgers.map((ledger) => [ledger.id, ledger]))
  return Object.values(snapshot.classifications).some((classification) =>
    classification.targetLedgerIds.some((ledgerId) => {
      if (ledgerId === 'inbox') return false
      const ledger = ledgerById.get(ledgerId)
      return knownMissing.has(ledgerId) || Boolean(ledger && !ledger.bilibiliFolderId)
    })
  )
}

function confirmationNeedsShardCapacityPreflight(
  snapshot: Exclude<ReturnType<typeof useOldFavoriteWorkspace>['snapshot'], null>,
  ledgers: FavoriteLedger[]
) {
  if ('recovery' in snapshot) return false
  const targetLedgerIds = new Set(Object.values(snapshot.classifications)
    .flatMap((classification) => classification.targetLedgerIds))
  return ledgers.some((ledger) => targetLedgerIds.has(ledger.id) && ledger.enabled &&
    ledger.bilibiliFolderIds?.some((folderId) => folderId.trim()) === true)
}

function bilibiliBackupShardKey(shard: OldFavoriteWorkspaceBilibiliSyncPreflight['requiredPhysicalShards'][number]) {
  return `${shard.logicalLedgerId}:${shard.shardNumber}`
}

function bilibiliBackupLedgerKey(ledger: OldFavoriteWorkspaceBilibiliSyncPreflight['missingLedgers'][number]) {
  return ledger.logicalLedgerId
}

function bilibiliBindingCandidatesForShard(shard: OldFavoriteWorkspaceBilibiliSyncPreflight['requiredPhysicalShards'][number]) {
  // A renderer may briefly retain a pre-upgrade IPC result while the preload
  // updates. Treat the absent additive field as no candidate, never as a
  // reason to crash or silently bind one.
  return shard.bindingCandidates ?? []
}

function bilibiliBindingCandidatesForLedger(ledger: OldFavoriteWorkspaceBilibiliSyncPreflight['missingLedgers'][number]) {
  // See the shard variant above: tolerate an older preload result without
  // weakening the explicit-selection requirement for newer results.
  return ledger.bindingCandidates ?? []
}

export function ControlledFavoriteLedgerPanel({
  currentAccountMid,
  localFavoriteToggleAccountMid,
  ledgers,
  missingLedgerIds,
  unboundLedgerIds,
  remoteOnlyDraftLedgerIds = [],
  observedRemoteObservations,
  observedBoundRenameCandidates,
  remoteDiscoveryNoticeDismissed,
  onDismissRemoteDiscoveryNotice,
  onDismissRemoteDraftReminder,
  defaultFavoriteSystemEnabled,
  onEnsureLedgers,
  onSaveLedgers,
  onSaveLedgerEnabled,
  onSyncLedgers,
  onOpenFavoritePage,
  onRefreshOrganizationState,
  onOrganizationSnapshotChange,
  onAcknowledgeOrganizationCompletion,
  onTransientFeedback,
  onFavoriteLibraryOpened,
  onDeepSeekTaskStart,
  deepSeekArchiveAvailable = false,
  openLedgerId,
  openLedgerRequestVersion,
  createLedger,
  createLedgerRequestVersion,
  openOrganizationRequestVersion,
  openOrganizationSelectionAids,
  openOrganizationSelection
}: ControlledFavoriteLedgerPanelProps) {
  const workspace = useOldFavoriteWorkspace(currentAccountMid)
  const favoritePanelRef = useRef<HTMLElement>(null)
  const favoritePanelScrollRestoreRef = useRef<{
    panel: HTMLElement
    top: number
    frames: number[]
    userScrolled: boolean
    restoring: boolean
    ignoreInitialScroll: boolean
    capturedBeforeFocus: boolean
    cleanup?: () => void
  } | null>(null)
  const preserveFavoritePanelScrollPosition = useCallback((options: { ignoreInitialScroll?: boolean; capturedBeforeFocus?: boolean } = {}) => {
    const panel = favoritePanelRef.current
    if (!panel) return
    const existingState = favoritePanelScrollRestoreRef.current
    if (existingState?.frames.length) {
      for (const frame of existingState.frames) window.cancelAnimationFrame(frame)
      existingState.cleanup?.()
      existingState.cleanup = undefined
      existingState.frames = []
    }
    const state = existingState ?? {
      panel,
      top: panel.scrollTop,
      frames: [],
      userScrolled: false,
      restoring: false,
      ignoreInitialScroll: false,
      capturedBeforeFocus: false
    }
    for (const frame of state.frames) window.cancelAnimationFrame(frame)
    state.cleanup?.()
    state.panel = panel
    state.top = panel.scrollTop
    state.userScrolled = false
    state.ignoreInitialScroll = Boolean(options.ignoreInitialScroll)
    state.capturedBeforeFocus = Boolean(options.capturedBeforeFocus)
    const onScroll = () => {
      if (!state.restoring && !state.ignoreInitialScroll) state.userScrolled = true
    }
    panel.addEventListener('scroll', onScroll)
    state.cleanup = () => panel.removeEventListener('scroll', onScroll)
    const restore = (remainingFrames: number) => {
      if (!state.panel.isConnected || state.userScrolled) {
        state.cleanup?.()
        state.cleanup = undefined
        state.frames = []
        return
      }
      if (state.panel.scrollTop !== state.top) {
        state.restoring = true
        state.panel.scrollTop = state.top
        state.restoring = false
      }
      state.frames = remainingFrames > 0
        ? [window.requestAnimationFrame(() => restore(remainingFrames - 1))]
        : []
    }
    state.frames = [window.requestAnimationFrame(() => restore(1))]
    favoritePanelScrollRestoreRef.current = state
  }, [])
  const completeFavoritePanelPointerSelection = useCallback(() => {
    const state = favoritePanelScrollRestoreRef.current
    if (state) state.ignoreInitialScroll = false
  }, [])
  useEffect(() => () => {
    for (const frame of favoritePanelScrollRestoreRef.current?.frames ?? []) window.cancelAnimationFrame(frame)
    favoritePanelScrollRestoreRef.current?.cleanup?.()
  }, [])
  const [guideOpen, setGuideOpen] = useState(false)
  const accountKey = normalizeAccountMid(currentAccountMid)
  const localToggleOnly = !accountKey && Boolean(normalizeAccountMid(localFavoriteToggleAccountMid))
  const reclassifySavedLedgerDirectory = useCallback(async () => {
    const snapshot = workspace.snapshot
    if (!isOrganizationSelectionSnapshot(snapshot) ||
      normalizeAccountMid(snapshot.accountMid) !== accountKey) return null
    return workspace.reclassifyFavoriteConfiguration()
  }, [accountKey, workspace.reclassifyFavoriteConfiguration, workspace.snapshot])
  const saveLedgersAndRefreshWorkspace = useCallback(async (nextLedgers: FavoriteLedger[], options?: FavoriteLedgerSaveOptions) => {
    const result = await onSaveLedgers(nextLedgers, options) as { ok?: boolean } | undefined
    if (result?.ok === false) return result
    if (options?.recommendationOnly) {
      // The account-rule commit is authoritative. A best-effort workspace
      // refresh must not turn a successful local recommendation save into a
      // rejected mutation (which would remove the optimistic card and let an
      // older parent snapshot resurrect it). The next authoritative refresh
      // can still repair a stale workspace projection.
      await workspace.refresh(true).catch(() => undefined)
    } else {
      await reclassifySavedLedgerDirectory()
    }
    return result
  }, [onSaveLedgers, reclassifySavedLedgerDirectory, workspace.refresh])
  const saveLedgerEnabledAndRefreshWorkspace = useCallback(async (
    ledgerId: string,
    enabled: boolean,
    historyOptions?: { mergeFavoriteRuleHistory?: true }
  ) => {
    // A participation change has its authoritative current-round result
    // published by the selection commands below. Do not queue a second full
    // workspace read/reclassification behind the narrow preference write.
    return historyOptions
      ? onSaveLedgerEnabled?.(ledgerId, enabled, historyOptions)
      : onSaveLedgerEnabled?.(ledgerId, enabled)
  }, [onSaveLedgerEnabled])
  const pendingHistoryRestoreRef = useRef<{ workspaceId: string; cursor: number } | null>(null)
  const runHistoryRestore = useCallback(async (cursor: number, run: () => Promise<OldFavoriteWorkspaceSnapshot | null>) => {
    const snapshot = workspace.snapshot
    const activeSnapshot = isOrganizationSelectionSnapshot(snapshot)
      ? snapshot
      : null
    const target = activeSnapshot && cursor !== activeSnapshot.history.cursor
      ? { workspaceId: activeSnapshot.workspaceId, cursor }
      : null
    if (target) {
      // Set synchronously, before the IPC command can cause a surrounding
      // preference render.  That render must not promote the selection being
      // undone while it still observes the previous workspace snapshot.
      pendingHistoryRestoreRef.current = target
    }
    const next = await run()
    if (!next && target && pendingHistoryRestoreRef.current === target) {
      pendingHistoryRestoreRef.current = null
    }
    return next
  }, [workspace.snapshot])
  const undoOrganizationHistory = useCallback(() => {
    const cursor = workspace.snapshot && !('recovery' in workspace.snapshot) ? workspace.snapshot.history.cursor - 1 : 0
    return runHistoryRestore(cursor, workspace.undoClassification)
  }, [runHistoryRestore, workspace.snapshot, workspace.undoClassification])
  const redoOrganizationHistory = useCallback(() => {
    const cursor = workspace.snapshot && !('recovery' in workspace.snapshot) ? workspace.snapshot.history.cursor + 1 : 0
    return runHistoryRestore(cursor, workspace.redoClassification)
  }, [runHistoryRestore, workspace.redoClassification, workspace.snapshot])
  const moveOrganizationHistoryCursor = useCallback((cursor: number) =>
    runHistoryRestore(cursor, () => workspace.moveHistoryCursor(cursor)), [runHistoryRestore, workspace.moveHistoryCursor])
  const organizationRecommendationIdsRef = useRef<string[]>(workspace.recommendedCandidateIds)
  const organizationRecommendationIdsInitializedRef = useRef(false)
  const [ledgerEnabledById, setLedgerEnabledById] = useState<ReadonlyMap<string, boolean>>(() =>
    new Map(ledgers.map((ledger) => [ledger.id, ledger.enabled])))
  const ledgerEnabledByIdRef = useRef(ledgerEnabledById)
  // The top-card participation selection is distinct from an editor's
  // temporary unsaved enabled state. Keep its optimistic projection separate
  // so an editor update cannot overwrite a just-clicked organization choice.
  const [organizationSavedLedgerParticipationById, setOrganizationSavedLedgerParticipationById] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const organizationSavedLedgerParticipationByIdRef = useRef(organizationSavedLedgerParticipationById)
  const pendingOrganizationSavedLedgerIdsRef = useRef<Set<string>>(new Set())
  const persistedUpperLedgerIds = new Set(ledgers
    .filter((ledger) => !remoteOnlyDraftLedgerIds.includes(ledger.id))
    .map((ledger) => ledger.id))
  const effectiveLedgers = ledgers
  const organizationUpperLedgerIds = new Set(effectiveLedgers
    .filter((ledger) => !remoteOnlyDraftLedgerIds.includes(ledger.id))
    .map((ledger) => ledger.id))
  const [enabledStateAccountKey, setEnabledStateAccountKey] = useState(accountKey)
  const updateLedgerEnabledById = useCallback((next: ReadonlyMap<string, boolean>) => {
    const normalized = new Map(next)
    if (enabledMapsMatch(ledgerEnabledByIdRef.current, normalized)) return
    ledgerEnabledByIdRef.current = normalized
    setLedgerEnabledById(normalized)
  }, [])
  const updateOrganizationSavedLedgerParticipationById = useCallback((next: ReadonlyMap<string, boolean>) => {
    const normalized = new Map(next)
    if (enabledMapsMatch(organizationSavedLedgerParticipationByIdRef.current, normalized)) return
    organizationSavedLedgerParticipationByIdRef.current = normalized
    setOrganizationSavedLedgerParticipationById(normalized)
  }, [])
  const effectiveLedgerEnabledById = enabledStateAccountKey === accountKey
    ? ledgerEnabledById
    : new Map(effectiveLedgers.map((ledger) => [ledger.id, ledger.enabled]))
  useEffect(() => {
    if (enabledStateAccountKey === accountKey) return
    updateLedgerEnabledById(new Map(effectiveLedgers.map((ledger) => [ledger.id, ledger.enabled])))
    setEnabledStateAccountKey(accountKey)
  }, [accountKey, effectiveLedgers, enabledStateAccountKey, updateLedgerEnabledById])
  useEffect(() => {
    organizationRecommendationIdsRef.current = []
    organizationRecommendationIdsInitializedRef.current = false
    updateOrganizationSavedLedgerParticipationById(new Map())
  }, [accountKey, updateOrganizationSavedLedgerParticipationById])
  useEffect(() => {
    const pending = pendingHistoryRestoreRef.current
    const snapshot = workspace.snapshot
    if (!pending || !isOrganizationSelectionSnapshot(snapshot) ||
      snapshot.workspaceId !== pending.workspaceId || snapshot.history.cursor !== pending.cursor ||
      !sameRecommendationCandidateIds(workspace.recommendedCandidateIds, snapshot.recommendations.adoptedCandidateIds)) return
    pendingHistoryRestoreRef.current = null
  }, [workspace.recommendedCandidateIds, workspace.snapshot])
  useEffect(() => {
    const snapshot = workspace.snapshot
    if (!isOrganizationSelectionSnapshot(snapshot)) return
    const pendingLedgerIds = pendingOrganizationSavedLedgerIdsRef.current
    const authoritativeParticipationById = new Map(effectiveLedgers
      .filter((ledger) => !remoteOnlyDraftLedgerIds.includes(ledger.id))
      .map((ledger) => [ledger.id, ledger.enabled && !(snapshot.excludedLedgerIds ?? []).includes(ledger.id)] as const))
    const nextEnabledById = new Map(ledgerEnabledByIdRef.current)
    for (const [ledgerId, enabled] of authoritativeParticipationById) {
      if (!pendingLedgerIds.has(ledgerId)) nextEnabledById.set(ledgerId, enabled)
    }
    updateLedgerEnabledById(nextEnabledById)
    updateOrganizationSavedLedgerParticipationById(new Map(
      [...organizationSavedLedgerParticipationByIdRef.current]
        .filter(([ledgerId]) => pendingLedgerIds.has(ledgerId))
    ))
  }, [effectiveLedgers, guideOpen, remoteOnlyDraftLedgerIds, updateLedgerEnabledById, updateOrganizationSavedLedgerParticipationById, workspace.snapshot])
  useEffect(() => {
    const snapshot = workspace.snapshot
    if (!isOrganizationSelectionSnapshot(snapshot)) return
    organizationRecommendationIdsRef.current = !organizationRecommendationIdsInitializedRef.current && !workspace.recommendedCandidateIds.length
      ? [...snapshot.recommendations.adoptedCandidateIds]
      : [...workspace.recommendedCandidateIds]
    organizationRecommendationIdsInitializedRef.current = true
  }, [workspace.recommendedCandidateIds, workspace.snapshot])
  const setOrganizationRecommendedCandidates = useCallback(async (candidateIds: string[]) => {
    const snapshot = workspace.snapshot
    if (!isOrganizationSelectionSnapshot(snapshot)) {
      workspace.setRecommendedCandidates(candidateIds)
      return workspace.waitForRecommendationQueue()
    }
    const candidates = snapshot.recommendations.candidates
    const knownCandidateIds = new Set(candidates.map((candidate) => candidate.id))
    const nextCandidateIds = [...new Set(candidateIds.map((id) => id.trim()).filter((id) => knownCandidateIds.has(id)))].sort()
    const snapshotAdoptedCandidateIds = snapshot.recommendations.adoptedCandidateIds
    const needsSnapshotHydration = !organizationRecommendationIdsInitializedRef.current ||
      (!organizationRecommendationIdsRef.current.length && !workspace.recommendedCandidateIds.length && snapshotAdoptedCandidateIds.length > 0)
    const priorCandidateIds = [...(needsSnapshotHydration ? snapshotAdoptedCandidateIds : organizationRecommendationIdsRef.current)]
    organizationRecommendationIdsInitializedRef.current = true
    organizationRecommendationIdsRef.current = nextCandidateIds
    workspace.stageRecommendedCandidateSelection(nextCandidateIds)
    workspace.setRecommendedCandidates(nextCandidateIds)
    try {
      const committedCandidateIds = new Set(await workspace.waitForRecommendationQueue({ rejectOnError: true }))
      organizationRecommendationIdsRef.current = [...committedCandidateIds]
      return [...committedCandidateIds]
    } catch (error) {
      if (JSON.stringify(organizationRecommendationIdsRef.current) === JSON.stringify(nextCandidateIds)) {
        organizationRecommendationIdsRef.current = priorCandidateIds
        workspace.stageRecommendedCandidateSelection(priorCandidateIds)
      }
      throw error
    }
  }, [workspace.recommendedCandidateIds, workspace.setRecommendedCandidates, workspace.snapshot, workspace.stageRecommendedCandidateSelection, workspace.waitForRecommendationQueue])
  const handleEnabledStateChange = useCallback((next: ReadonlyMap<string, boolean>, source?: 'editor-unsaved' | 'organization-selection') => {
    const previousEnabledById = ledgerEnabledByIdRef.current
    updateLedgerEnabledById(next)
    if (source) return
    const recommendationCandidateIds = new Set(
      isOrganizationSelectionSnapshot(workspace.snapshot)
        ? createRecommendationProjection(workspace.snapshot.recommendations.links).ledgerToCandidateId.keys()
        : [])
    for (const ledger of effectiveLedgers) {
      const previousEnabled = previousEnabledById.get(ledger.id) ?? ledger.enabled
      const enabled = next.get(ledger.id) ?? ledger.enabled
      const ruleType = ledger.ruleType ?? 'keyword'
      if (previousEnabled === enabled || ruleType === 'deepseek' || recommendationCandidateIds.has(ledger.id)) continue
      const rules = parseFavoriteLedgerRules(ledger)
      workspace.queueDraftLedgerRuleAnalysis({
        ledgerId: ledger.id,
        title: stripBilimiLedgerPrefix(ledger.displayName),
        keywords: rules.localKeywords,
        ruleType,
        ...(enabled ? {} : { adopt: false })
      })
    }
  }, [effectiveLedgers, updateLedgerEnabledById, workspace.queueDraftLedgerRuleAnalysis, workspace.snapshot])
  const setOrganizationSavedLedgerParticipation = useCallback(async (ledgerId: string, enabled: boolean) => {
    const snapshot = workspace.snapshot
    if (!isOrganizationSelectionSnapshot(snapshot)) return false
    const savedLedger = effectiveLedgers.find((ledger) => ledger.id === ledgerId && organizationUpperLedgerIds.has(ledger.id))
    if (!savedLedger) return false
    const projection = createRecommendationProjection(snapshot.recommendations.links)
    const candidateId = projection.ledgerToCandidateId.get(ledgerId)
    const priorCandidateIds = [...(organizationRecommendationIdsInitializedRef.current
      ? organizationRecommendationIdsRef.current
      : snapshot.recommendations.adoptedCandidateIds)]
    organizationRecommendationIdsInitializedRef.current = true
    const nextCandidateIds = candidateId
      ? enabled
        ? [...new Set([...priorCandidateIds, candidateId])]
        : priorCandidateIds.filter((currentCandidateId) => currentCandidateId !== candidateId)
      : priorCandidateIds
    const excludedLedgerIds = new Set(snapshot.excludedLedgerIds ?? [])
    if (enabled) excludedLedgerIds.delete(ledgerId)
    else excludedLedgerIds.add(ledgerId)
    const previousEnabledById = new Map(ledgerEnabledByIdRef.current)
    const nextEnabledById = new Map(previousEnabledById)
    nextEnabledById.set(ledgerId, enabled)
    updateLedgerEnabledById(nextEnabledById)
    const previousParticipationById = new Map(organizationSavedLedgerParticipationByIdRef.current)
    const nextParticipationById = new Map(previousParticipationById)
    nextParticipationById.set(ledgerId, enabled)
    updateOrganizationSavedLedgerParticipationById(nextParticipationById)
    const participatingSavedLedgerIds = [...persistedUpperLedgerIds]
      .filter((candidateLedgerId) => nextEnabledById.get(candidateLedgerId) ??
        effectiveLedgers.find((ledger) => ledger.id === candidateLedgerId)?.enabled)
      .sort()
    pendingOrganizationSavedLedgerIdsRef.current.add(ledgerId)
    try {
      const committedCandidateIds = JSON.stringify(nextCandidateIds) !== JSON.stringify(priorCandidateIds)
        ? await setOrganizationRecommendedCandidates(nextCandidateIds)
        : priorCandidateIds
      const selectionChanged = JSON.stringify(nextCandidateIds) !== JSON.stringify(priorCandidateIds)
      const next = await workspace.setRoundExcludedLedgerIds([...excludedLedgerIds], {
        ...(enabled && participatingSavedLedgerIds.length
          ? { participatingSavedLedgerIds }
          : {}),
        ...(candidateId && selectionChanged ? { mergeFavoriteRuleHistory: true } : {})
      })
      if (!next || 'recovery' in next) throw new Error('Organization selection update failed.')
      if (candidateId && (enabled ? !committedCandidateIds.includes(candidateId) : committedCandidateIds.includes(candidateId))) {
        throw new Error('Organization recommendation selection update failed.')
      }
      await saveLedgerEnabledAndRefreshWorkspace(ledgerId, enabled)
      return enabled ? !(next.excludedLedgerIds ?? []).includes(ledgerId) : (next.excludedLedgerIds ?? []).includes(ledgerId)
    } catch {
      updateLedgerEnabledById(previousEnabledById)
      updateOrganizationSavedLedgerParticipationById(previousParticipationById)
      if (JSON.stringify(nextCandidateIds) !== JSON.stringify(priorCandidateIds)) {
        await setOrganizationRecommendedCandidates(priorCandidateIds).catch(() => undefined)
      }
      await saveLedgerEnabledAndRefreshWorkspace(ledgerId, previousEnabledById.get(ledgerId) ?? savedLedger.enabled).catch(() => undefined)
      await workspace.setRoundExcludedLedgerIds(snapshot.excludedLedgerIds ?? [], {
        participatingSavedLedgerIds: [...persistedUpperLedgerIds]
          .filter((candidateLedgerId) => previousEnabledById.get(candidateLedgerId) ??
            effectiveLedgers.find((ledger) => ledger.id === candidateLedgerId)?.enabled)
          .sort()
      }).catch(() => undefined)
      return false
    } finally {
      pendingOrganizationSavedLedgerIdsRef.current.delete(ledgerId)
    }
  }, [effectiveLedgers, organizationUpperLedgerIds, persistedUpperLedgerIds, saveLedgerEnabledAndRefreshWorkspace, setOrganizationRecommendedCandidates, updateLedgerEnabledById, updateOrganizationSavedLedgerParticipationById, workspace.setRoundExcludedLedgerIds, workspace.snapshot])
  const updateOrganizationRecommendedCandidates = useCallback((update: (current: string[]) => string[]) => {
    // A pointerdown may already have captured the anchor before the native
    // focus event scrolls the panel. Keep that earlier anchor instead of
    // replacing it with the post-focus position during this change handler.
    const pendingScrollRestore = favoritePanelScrollRestoreRef.current
    if (!pendingScrollRestore?.frames.length || !pendingScrollRestore.capturedBeforeFocus) preserveFavoritePanelScrollPosition()
    const snapshot = workspace.snapshot
    const snapshotAdoptedCandidateIds = isOrganizationSelectionSnapshot(snapshot)
      ? snapshot.recommendations.adoptedCandidateIds
      : []
    const current = !organizationRecommendationIdsInitializedRef.current ||
      (!organizationRecommendationIdsRef.current.length && !workspace.recommendedCandidateIds.length && snapshotAdoptedCandidateIds.length > 0)
      ? snapshotAdoptedCandidateIds
      : organizationRecommendationIdsRef.current
    const next = update([...current])
    organizationRecommendationIdsInitializedRef.current = true
    const addedCandidateIds = next.filter((candidateId) => !current.includes(candidateId))
    const removedCandidateIds = current.filter((candidateId) => !next.includes(candidateId))
    const changedCandidateId = addedCandidateIds.length === 1 && removedCandidateIds.length === 0
      ? addedCandidateIds[0]
      : removedCandidateIds.length === 1 && addedCandidateIds.length === 0
        ? removedCandidateIds[0]
        : undefined
    const linkedSavedLedgerId = isOrganizationSelectionSnapshot(snapshot) && changedCandidateId
      ? createRecommendationProjection(snapshot.recommendations.links).candidateToLedgerId.get(changedCandidateId)
      : undefined
    const linkedSavedLedger = linkedSavedLedgerId
      ? effectiveLedgers.find((ledger) => ledger.id === linkedSavedLedgerId && organizationUpperLedgerIds.has(ledger.id))
      : undefined
    if (linkedSavedLedger) {
      void setOrganizationSavedLedgerParticipation(linkedSavedLedger.id, addedCandidateIds.length === 1)
      return
    }
    void setOrganizationRecommendedCandidates(next)
  }, [effectiveLedgers, organizationUpperLedgerIds, preserveFavoritePanelScrollPosition, setOrganizationRecommendedCandidates, setOrganizationSavedLedgerParticipation, workspace.recommendedCandidateIds, workspace.snapshot])
  const handleOrganizationRecommendationToggle = useCallback(async (ledgerId: string, enabled: boolean) => {
    const snapshot = workspace.snapshot
    if (!isVisibleOrganizationRecommendationEditing(snapshot, guideOpen)) return false
    const projection = createRecommendationProjection(snapshot.recommendations.links)
    const candidateId = projection.ledgerToCandidateId.get(ledgerId)
    if (!candidateId) return false
    const linkedSavedLedgerId = projection.candidateToLedgerId.get(candidateId)
    const linkedSavedLedger = linkedSavedLedgerId
      ? effectiveLedgers.find((ledger) => ledger.id === linkedSavedLedgerId && organizationUpperLedgerIds.has(ledger.id))
      : undefined
    if (linkedSavedLedger) {
      return setOrganizationSavedLedgerParticipation(linkedSavedLedger.id, enabled)
    }
    const committedIds = await setOrganizationRecommendedCandidates(enabled
      ? [...organizationRecommendationIdsRef.current, candidateId]
      : organizationRecommendationIdsRef.current.filter((currentCandidateId) => currentCandidateId !== candidateId))
    return enabled ? committedIds.includes(candidateId) : !committedIds.includes(candidateId)
  }, [effectiveLedgers, guideOpen, organizationUpperLedgerIds, setOrganizationRecommendedCandidates, setOrganizationSavedLedgerParticipation, workspace.snapshot])
  const handleOrganizationSavedLedgerToggle = useCallback(async (ledgerId: string, enabled: boolean) => {
    const ledger = effectiveLedgers.find((candidate) => candidate.id === ledgerId)
    const snapshot = workspace.snapshot
    const linkedRecommendation = isOrganizationSelectionSnapshot(snapshot) &&
      snapshot.recommendations.candidates.some((candidate) => candidate.id === ledgerId)
    if (linkedRecommendation &&
      !isVisibleOrganizationRecommendationEditing(snapshot, guideOpen)) {
      if (!onSaveLedgerEnabled) return false
      try {
        const result = await onSaveLedgerEnabled(ledgerId, enabled) as { ok?: boolean } | undefined
        if (result?.ok === false) return false
        await Promise.resolve(onRefreshOrganizationState?.()).catch(() => undefined)
        return true
      } catch {
        return false
      }
    }
    return setOrganizationSavedLedgerParticipation(ledgerId, enabled)
  }, [effectiveLedgers, guideOpen, onRefreshOrganizationState, onSaveLedgerEnabled, setOrganizationSavedLedgerParticipation, workspace.snapshot])
  const handleOrganizationSavedLedgerSelectionChange = useCallback(async (selectedLedgerIds: string[]) => {
    const snapshot = workspace.snapshot
    if (!isOrganizationSelectionSnapshot(snapshot)) return false
    const projection = createRecommendationProjection(snapshot.recommendations.links)
    const selectableLedgerIds = new Set(effectiveLedgers
      .filter((ledger) => persistedUpperLedgerIds.has(ledger.id))
      .map((ledger) => ledger.id))
    const selectedIds = new Set(selectedLedgerIds.filter((ledgerId) => selectableLedgerIds.has(ledgerId)))
    const priorCandidateIds = [...(organizationRecommendationIdsInitializedRef.current
      ? organizationRecommendationIdsRef.current
      : snapshot.recommendations.adoptedCandidateIds)]
    organizationRecommendationIdsInitializedRef.current = true
    const priorCandidateIdSet = new Set(priorCandidateIds)
    const nextCandidateIds = snapshot.recommendations.candidates
      .filter((candidate) => {
        const linkedLedgerId = projection.candidateToLedgerId.get(candidate.id)
        return linkedLedgerId && selectableLedgerIds.has(linkedLedgerId)
          ? selectedIds.has(linkedLedgerId)
          : priorCandidateIdSet.has(candidate.id)
      })
      .map((candidate) => candidate.id)
    const previousEnabledById = new Map(ledgerEnabledByIdRef.current)
    const nextEnabledById = new Map(previousEnabledById)
    for (const ledgerId of selectableLedgerIds) nextEnabledById.set(ledgerId, selectedIds.has(ledgerId))
    updateLedgerEnabledById(nextEnabledById)
    const changedEnabledByLedgerId = [...selectableLedgerIds].flatMap((ledgerId) => {
      const enabled = selectedIds.has(ledgerId)
      const previousEnabled = previousEnabledById.get(ledgerId) ?? effectiveLedgers.find((ledger) => ledger.id === ledgerId)?.enabled
      return previousEnabled === enabled ? [] : [[ledgerId, enabled] as const]
    })
    const nextExcludedLedgerIds = [...selectableLedgerIds].filter((ledgerId) => !selectedIds.has(ledgerId))
    for (const [ledgerId] of changedEnabledByLedgerId) pendingOrganizationSavedLedgerIdsRef.current.add(ledgerId)
    try {
      const selectionChanged = JSON.stringify(nextCandidateIds) !== JSON.stringify(priorCandidateIds)
      if (selectionChanged) {
        await setOrganizationRecommendedCandidates(nextCandidateIds)
      }
      const next = await workspace.setRoundExcludedLedgerIds(nextExcludedLedgerIds, {
        ...(changedEnabledByLedgerId.some(([, enabled]) => enabled)
          ? { participatingSavedLedgerIds: [...selectedIds].sort() }
          : {}),
        ...(selectionChanged ? { mergeFavoriteRuleHistory: true } : {})
      })
      if (!next || 'recovery' in next) throw new Error('Organization selection update failed.')
      for (const [ledgerId, enabled] of changedEnabledByLedgerId) {
        await saveLedgerEnabledAndRefreshWorkspace(ledgerId, enabled)
      }
      return [...selectableLedgerIds].every((ledgerId) => selectedIds.has(ledgerId) === !(next.excludedLedgerIds ?? []).includes(ledgerId))
    } catch {
      updateLedgerEnabledById(previousEnabledById)
      if (JSON.stringify(nextCandidateIds) !== JSON.stringify(priorCandidateIds)) {
        await setOrganizationRecommendedCandidates(priorCandidateIds).catch(() => undefined)
      }
      for (const [ledgerId] of changedEnabledByLedgerId) {
        await saveLedgerEnabledAndRefreshWorkspace(
          ledgerId,
          previousEnabledById.get(ledgerId) ?? effectiveLedgers.find((ledger) => ledger.id === ledgerId)?.enabled ?? false
        ).catch(() => undefined)
      }
      await workspace.setRoundExcludedLedgerIds(snapshot.excludedLedgerIds ?? [], {
        participatingSavedLedgerIds: [...selectableLedgerIds]
          .filter((ledgerId) => previousEnabledById.get(ledgerId) ??
            effectiveLedgers.find((ledger) => ledger.id === ledgerId)?.enabled)
          .sort()
      }).catch(() => undefined)
      return false
    } finally {
      for (const [ledgerId] of changedEnabledByLedgerId) pendingOrganizationSavedLedgerIdsRef.current.delete(ledgerId)
    }
  }, [effectiveLedgers, saveLedgerEnabledAndRefreshWorkspace, setOrganizationRecommendedCandidates, updateLedgerEnabledById, workspace.setRoundExcludedLedgerIds, workspace.snapshot])
  const handleDeleteLedger = useCallback(async () => {
    await workspace.refresh().catch(() => undefined)
    try {
      await onRefreshOrganizationState?.()
    } catch {
      // The local deletion is already committed; leave parent refresh retryable.
    }
    return true
  }, [onRefreshOrganizationState, workspace.refresh])
  const applyManualClassification = useCallback((aid: number, targetLedgerIds: string[]) => {
    void workspace.applyManualClassifications([{ aid, targetLedgerIds }])
  }, [workspace.applyManualClassifications])
  const applyManualClassifications = useCallback((assignments: Array<{ aid: number; targetLedgerIds: string[] }>) => {
    void workspace.applyManualClassifications(assignments)
  }, [workspace.applyManualClassifications])
  const [step, setStep] = useState<OldFavoriteGuideStep>('scan')
  const [resumeDialogOpen, setResumeDialogOpen] = useState(false)
  const [recoverySummary, setRecoverySummary] = useState<OldFavoriteWorkspaceRecoverySummary | null>(null)
  const [recoveryPreparing, setRecoveryPreparing] = useState(false)
  const [recoveryPreparationError, setRecoveryPreparationError] = useState<string | null>(null)
  const [recoveryDecisionPending, setRecoveryDecisionPending] = useState<'merge-latest' | 'rescan' | 'reconcile-result-unknown' | null>(null)
  const [recoveryRescanConfirmOpen, setRecoveryRescanConfirmOpen] = useState(false)
  const [recoveryDecisionError, setRecoveryDecisionError] = useState<string | null>(null)
  const [scanStarting, setScanStarting] = useState(false)
  const [ensuringLedgers, setEnsuringLedgers] = useState(false)
  const [backupPreparationLedgerIds, setBackupPreparationLedgerIds] = useState<string[]>([])
  const ensuringLedgersRef = useRef(false)
  const favoriteLedgerOverviewRef = useRef<FavoriteLedgerOverviewHandle>(null)
  const [scanStartFailure, setScanStartFailure] = useState<string | null>(null)
  const [confirmationPreparing, setConfirmationPreparing] = useState(false)
  const [confirmationPreparationStatus, setConfirmationPreparationStatus] = useState<string | null>(null)
  const [confirmationPreparationError, setConfirmationPreparationError] = useState<string | null>(null)
  const [bilibiliBackupPreflight, setBilibiliBackupPreflight] = useState<OldFavoriteWorkspaceBilibiliSyncPreflight | null>(null)
  const [bilibiliLedgerCandidateIds, setBilibiliLedgerCandidateIds] = useState<Record<string, string>>({})
  const [bilibiliShardCandidateIds, setBilibiliShardCandidateIds] = useState<Record<string, string>>({})
  const [bilibiliBackupIncludeInbox, setBilibiliBackupIncludeInbox] = useState(false)
  const bilibiliBackupSyncIntentRef = useRef<{ includeInbox: boolean; workspaceId: string } | null>(null)
  const scanPresentationRequestVersion = useRef(0)
  const organizationRequestVersion = useRef(0)
  const recoveryDecisionRequestVersion = useRef(0)
  const scanStartingRef = useRef(false)
  const dismissedGuideWorkspaceIdRef = useRef<string | null>(null)
  const previousAccountMidRef = useRef(currentAccountMid)
  const activeAccountMid = useRef(currentAccountMid)
  activeAccountMid.current = currentAccountMid
  const reportScanStartFailure = (message: string) => {
    setScanStartFailure(message)
    onTransientFeedback?.(message)
  }
  useEffect(() => {
    if (!scanStartFailure) return
    const timer = window.setTimeout(() => setScanStartFailure(null), 8_000)
    return () => window.clearTimeout(timer)
  }, [scanStartFailure])
  const snapshot = workspace.snapshot &&
    normalizeAccountMid(workspace.snapshot.accountMid) === normalizeAccountMid(currentAccountMid)
    ? workspace.snapshot
    : null
  const recovery = snapshot && 'recovery' in snapshot ? snapshot : null
  const activeSnapshot = snapshot && !('recovery' in snapshot) ? snapshot : null
  const snapshotStatus = activeSnapshot?.status
  const resolvedOpenLedgerId = activeSnapshot?.status === 'previewing'
    ? resolveRecommendationOpenLedgerId(openLedgerId, activeSnapshot.recommendations.links)
    : openLedgerId
  useEffect(() => {
    if (previousAccountMidRef.current === currentAccountMid) return
    previousAccountMidRef.current = currentAccountMid
    scanPresentationRequestVersion.current += 1
    organizationRequestVersion.current += 1
    recoveryDecisionRequestVersion.current += 1
    scanStartingRef.current = false
    setGuideOpen(false)
    setResumeDialogOpen(false)
    setRecoverySummary(null)
    setRecoveryPreparing(false)
    setRecoveryPreparationError(null)
    setRecoveryDecisionPending(null)
    setRecoveryRescanConfirmOpen(false)
    setRecoveryDecisionError(null)
    setStep('scan')
    setScanStarting(false)
    setScanStartFailure(null)
    setConfirmationPreparing(false)
    setConfirmationPreparationStatus(null)
    setConfirmationPreparationError(null)
    setBilibiliBackupPreflight(null)
    setBilibiliLedgerCandidateIds({})
    setBilibiliShardCandidateIds({})
    setBilibiliBackupIncludeInbox(false)
    bilibiliBackupSyncIntentRef.current = null
    dismissedGuideWorkspaceIdRef.current = null
  }, [currentAccountMid])

  useEffect(() => {
    onOrganizationSnapshotChange?.(activeSnapshot)
  }, [activeSnapshot, onOrganizationSnapshotChange])

  useEffect(() => {
    if (!openOrganizationRequestVersion) return
    dismissedGuideWorkspaceIdRef.current = null
    setGuideOpen(true)
    setStep('scan')
    setScanStartFailure(null)
    const aids = [...new Set((openOrganizationSelectionAids ?? [])
      .filter((aid) => Number.isSafeInteger(aid) && aid > 0))].sort((left, right) => left - right)
    if (!aids.length && !openOrganizationSelection) return
    const requestedAccountMid = currentAccountMid
    const requestVersion = ++organizationRequestVersion.current
    let active = true
    void workspace.startSelectedReorganization(openOrganizationSelection ?? aids).then((next) => {
      if (!active || organizationRequestVersion.current !== requestVersion ||
        activeAccountMid.current !== requestedAccountMid) return
      if (next && !('recovery' in next)) setStep('preview')
    }).catch((error) => {
      if (!active || organizationRequestVersion.current !== requestVersion ||
        activeAccountMid.current !== requestedAccountMid) return
      reportScanStartFailure(error instanceof Error ? error.message : '启动所选视频整理失败。')
    })
    return () => { active = false }
  }, [currentAccountMid, openOrganizationRequestVersion, openOrganizationSelectionAids, openOrganizationSelection])

  const startScan = async (mode: 'incremental' | 'full', options?: { clearBilibiliMirror?: boolean }) => {
    if (scanStarting) return
    dismissedGuideWorkspaceIdRef.current = null
    if (mode === 'incremental' && activeSnapshot && activeSnapshot.scan.phase !== 'failed' &&
      activeSnapshot.status !== 'completed' && activeSnapshot.status !== 'scanning') {
      setGuideOpen(true)
      setStep(activeSnapshot.status === 'previewing' ? 'preview' : 'confirm')
      return
    }
    const requestedAccountMid = currentAccountMid
    const requestVersion = ++scanPresentationRequestVersion.current
    setGuideOpen(true)
    setStep('scan')
    setScanStartFailure(null)
    scanStartingRef.current = true
    setScanStarting(true)
    try {
      if (!await workspace.startScan(mode, options) && scanPresentationRequestVersion.current === requestVersion && activeAccountMid.current === requestedAccountMid) {
        reportScanStartFailure(workspace.lastError ?? '扫描启动失败，请重新扫描。')
      }
    } catch (error) {
      if (scanPresentationRequestVersion.current === requestVersion && activeAccountMid.current === requestedAccountMid) {
        reportScanStartFailure(error instanceof Error ? error.message : '扫描启动失败，请重新扫描。')
      }
    } finally {
      if (scanPresentationRequestVersion.current === requestVersion && activeAccountMid.current === requestedAccountMid) {
        scanStartingRef.current = false
        setScanStarting(false)
      }
    }
  }

  const continueScan = async () => {
    if (scanStarting) return
    dismissedGuideWorkspaceIdRef.current = null
    const requestedAccountMid = currentAccountMid
    const requestVersion = ++scanPresentationRequestVersion.current
    setGuideOpen(true)
    setStep('scan')
    setScanStartFailure(null)
    scanStartingRef.current = true
    setScanStarting(true)
    try {
      if (!await workspace.resumeScan() && scanPresentationRequestVersion.current === requestVersion && activeAccountMid.current === requestedAccountMid) {
        reportScanStartFailure(workspace.lastError ?? '继续扫描失败，请保持已登录的 B站页面打开后重试。')
      }
    } catch (error) {
      if (scanPresentationRequestVersion.current === requestVersion && activeAccountMid.current === requestedAccountMid) {
        reportScanStartFailure(error instanceof Error ? error.message : '继续扫描失败，请保持已登录的 B站页面打开后重试。')
      }
    } finally {
      if (scanPresentationRequestVersion.current === requestVersion && activeAccountMid.current === requestedAccountMid) {
        scanStartingRef.current = false
        setScanStarting(false)
      }
    }
  }

  const pauseScan = async () => {
    if (scanStarting) return
    await workspace.pauseScan()
  }

  const finishScan = async () => {
    if (scanStarting) return
    const paused = await workspace.pauseScan()
    if (paused) await abandonCurrentWorkspace()
  }

  const requestOldFavoriteOrganization = async () => {
    const requestedAccountMid = currentAccountMid
    const requestVersion = ++organizationRequestVersion.current
    dismissedGuideWorkspaceIdRef.current = null
    const isCurrentRequest = () => organizationRequestVersion.current === requestVersion &&
      activeAccountMid.current === requestedAccountMid
    // A recovered draft stays collapsed until the user chooses how to resume it.
    // The resume dialog is the only UI shown between the toolbar click and that choice.
    setGuideOpen(false)
    setStep('scan')
    setScanStartFailure(null)
    setRecoveryDecisionError(null)
    setRecoverySummary(null)
    setRecoveryPreparationError(null)
    setRecoveryRescanConfirmOpen(false)
    setResumeDialogOpen(true)
    setRecoveryPreparing(true)
    try {
      const summary = await workspace.prepareRecovery()
      if (!isCurrentRequest()) return
      if (summary && summary.recoveryChoices.some((choice) => choice !== 'view')) {
        setRecoverySummary(summary)
        return
      }
      setResumeDialogOpen(false)
      const authoritativeSnapshot = snapshot
        ? 'recovery' in snapshot || snapshot.status === 'scanning'
          ? snapshot
          : await workspace.refresh(true) ?? snapshot
        : await workspace.refresh()
      if (!isCurrentRequest()) return
      if (authoritativeSnapshot && 'recovery' in authoritativeSnapshot) {
        setGuideOpen(true)
        setStep('scan')
        return
      }
      if (authoritativeSnapshot && !('recovery' in authoritativeSnapshot) &&
        authoritativeSnapshot.status === 'scanning') {
        setGuideOpen(true)
        setStep('scan')
        return
      }
      if (authoritativeSnapshot && !('recovery' in authoritativeSnapshot) &&
        authoritativeSnapshot.status !== 'completed') {
        setGuideOpen(true)
        setStep(authoritativeSnapshot.executionIntent || authoritativeSnapshot.status !== 'previewing' ? 'confirm' : 'scan')
        return
      }
      void startScan('incremental')
    } catch (error) {
      if (!isCurrentRequest()) return
      setRecoveryPreparationError(recoveryPreparationFailureMessage(error))
    } finally {
      if (isCurrentRequest()) setRecoveryPreparing(false)
    }
  }
  const selectRecoveryDecision = async (choice: 'merge-latest' | 'rescan') => {
    if (!recoverySummary || recoveryDecisionPending) return
    const requestedAccountMid = currentAccountMid
    const requestVersion = ++recoveryDecisionRequestVersion.current
    const isCurrentRequest = () => recoveryDecisionRequestVersion.current === requestVersion &&
      activeAccountMid.current === requestedAccountMid
    setRecoveryDecisionPending(choice)
    setRecoveryDecisionError(null)
    setGuideOpen(true)
    setStep('scan')
    const recoveryFailureMessage = choice === 'merge-latest'
      ? '恢复草稿失败，草稿不会丢失。请重试。'
      : '重新扫描准备失败，草稿不会丢失。请重试。'
    try {
      const result = await workspace.sendRecoveryDecision?.(recoverySummary, choice)
      if (!isCurrentRequest()) return
      if (!result) {
        setRecoveryDecisionError(recoveryFailureMessage)
        return
      }
      if (choice === 'rescan') {
        setRecoverySummary(null)
        setResumeDialogOpen(false)
        void startScan('incremental')
        return
      }
      const restored = await workspace.refresh(true)
      if (!isCurrentRequest()) return
      if (!restored || 'recovery' in restored) {
        setRecoveryDecisionError(recoveryFailureMessage)
        return
      }
      setRecoverySummary(null)
      setResumeDialogOpen(false)
      setGuideOpen(true)
      setStep('scan')
    } finally {
      if (isCurrentRequest()) setRecoveryDecisionPending(null)
    }
  }
  const openReconciliationDraft = async () => {
    if (!recoverySummary || recoveryDecisionPending) return
    const requestedAccountMid = currentAccountMid
    const requestVersion = ++recoveryDecisionRequestVersion.current
    const isCurrentRequest = () => recoveryDecisionRequestVersion.current === requestVersion &&
      activeAccountMid.current === requestedAccountMid
    setRecoveryDecisionPending('reconcile-result-unknown')
    setRecoveryDecisionError(null)
    try {
      const restored = await workspace.refresh(true)
      if (!isCurrentRequest()) return
      if (!restored || 'recovery' in restored || restored.workspaceId !== recoverySummary.workspaceId) {
        setRecoveryDecisionError('恢复整理草稿失败，请重试。')
        return
      }
      setRecoverySummary(null)
      setResumeDialogOpen(false)
      setGuideOpen(true)
      setStep('confirm')
    } finally {
      if (isCurrentRequest()) setRecoveryDecisionPending(null)
    }
  }
  const retryScanWithDirectSession = async () => {
    await window.bilimiDesktop?.retryBilibiliSessionDirect?.()
    if (activeSnapshot?.status === 'scanning' && activeSnapshot.scan.phase === 'failed') await continueScan()
    else await startScan('incremental')
  }
  const executeConfirmedBilibiliSync = async (includeInbox: boolean) => {
    if (!activeSnapshot) return
    if (activeSnapshot.hasMultipleSegments) return workspace.setWholeRunExecutionIntent('bilibili', includeInbox)
    return workspace.confirmAndExecuteBilibiliPlan(includeInbox)
  }
  const readBilibiliBackupPreflight = async (includeInbox = false) => {
    const accountMid = normalizeAccountMid(currentAccountMid)
    const read = window.bilimiDesktop?.getOldFavoriteWorkspaceBilibiliExecutionPreflightV1
    if (!accountMid || !read) return null
    return includeInbox ? read(accountMid, { includeInbox: true }) : read(accountMid)
  }
  const hasBilibiliBackupGaps = (preflight: OldFavoriteWorkspaceBilibiliSyncPreflight) =>
    preflight.missingLedgers.length > 0 || preflight.requiredPhysicalShards.length > 0
  const bilibiliBackupGroups = bilibiliBackupPreflight
    ? (() => {
        const groups = new Map<string, {
          logicalLedgerId: string
          logicalTitle: string
          missingLedger?: OldFavoriteWorkspaceBilibiliSyncPreflight['missingLedgers'][number]
          shards: OldFavoriteWorkspaceBilibiliSyncPreflight['requiredPhysicalShards']
        }>()
        for (const ledger of bilibiliBackupPreflight.missingLedgers) {
          groups.set(ledger.logicalLedgerId, {
            logicalLedgerId: ledger.logicalLedgerId,
            logicalTitle: ledger.logicalTitle,
            missingLedger: ledger,
            shards: groups.get(ledger.logicalLedgerId)?.shards ?? []
          })
        }
        for (const shard of bilibiliBackupPreflight.requiredPhysicalShards) {
          const existing = groups.get(shard.logicalLedgerId)
          groups.set(shard.logicalLedgerId, {
            logicalLedgerId: shard.logicalLedgerId,
            logicalTitle: existing?.logicalTitle ?? shard.logicalTitle,
            missingLedger: existing?.missingLedger,
            shards: [...(existing?.shards ?? []), shard]
          })
        }
        return [...groups.values()]
      })()
    : []
  const sameBilibiliBackupPreflightTargets = (
    left: OldFavoriteWorkspaceBilibiliSyncPreflight,
    right: OldFavoriteWorkspaceBilibiliSyncPreflight
  ) => JSON.stringify({
    accountMid: left.accountMid,
    workspaceId: left.workspaceId,
    missingLedgers: left.missingLedgers,
    requiredPhysicalShards: left.requiredPhysicalShards.map(({ bindingCandidates: _bindingCandidates, ...shard }) => shard)
  }) === JSON.stringify({
    accountMid: right.accountMid,
    workspaceId: right.workspaceId,
    missingLedgers: right.missingLedgers,
    requiredPhysicalShards: right.requiredPhysicalShards.map(({ bindingCandidates: _bindingCandidates, ...shard }) => shard)
  })
  const presentBilibiliBackupPreflight = (preflight: OldFavoriteWorkspaceBilibiliSyncPreflight) => {
    setBilibiliBackupPreflight(preflight)
    setBilibiliLedgerCandidateIds((current) => Object.fromEntries(preflight.missingLedgers.flatMap((ledger) => {
      const candidates = bilibiliBindingCandidatesForLedger(ledger)
      const selectedId = current[bilibiliBackupLedgerKey(ledger)]
      const candidate = candidates.find((item) => item.remoteFolderId === selectedId) ?? candidates[0]
      return candidate ? [[bilibiliBackupLedgerKey(ledger), candidate.remoteFolderId]] : []
    })))
    setBilibiliShardCandidateIds((current) => Object.fromEntries(preflight.requiredPhysicalShards.flatMap((shard) => {
      const candidates = bilibiliBindingCandidatesForShard(shard)
      const selectedId = current[bilibiliBackupShardKey(shard)]
      const candidate = candidates.find((item) => item.remoteFolderId === selectedId) ?? candidates[0]
      return candidate ? [[bilibiliBackupShardKey(shard), candidate.remoteFolderId]] : []
    })))
  }
  const updateBilibiliBackupIncludeInbox = async (includeInbox: boolean) => {
    const intent = bilibiliBackupSyncIntentRef.current
    if (!intent || confirmationPreparing) return
    setBilibiliBackupIncludeInbox(includeInbox)
    bilibiliBackupSyncIntentRef.current = { ...intent, includeInbox }
    setConfirmationPreparationError(null)
    try {
      const refreshed = await readBilibiliBackupPreflight(includeInbox)
      if (!refreshed || refreshed.workspaceId !== intent.workspaceId) return
      presentBilibiliBackupPreflight(refreshed)
    } catch (error) {
      setConfirmationPreparationError(error instanceof Error ? error.message : '无法更新暂存同步范围，请重试。')
    }
  }
  const continueConfirmedBilibiliBackup = async () => {
    const intent = bilibiliBackupSyncIntentRef.current
    const preflight = bilibiliBackupPreflight
    const accountMid = normalizeAccountMid(currentAccountMid)
    if (!intent || !preflight || !accountMid) return
    const provision = window.bilimiDesktop?.provisionOldFavoriteWorkspaceBilibiliExecutionPreflightShardsV1
    setConfirmationPreparing(true)
    setConfirmationPreparationError(null)
    try {
      let provisionedPhysicalShards = false
      let adoptedPhysicalShards = false
      // A logical rule may have entered an explicit create/rebind flow above.
      // Do not use the snapshot from before that consent to create a capacity
      // shard: main must first confirm that every logical gap is actually gone.
      let beforeProvision = await readBilibiliBackupPreflight(intent.includeInbox) ?? preflight
      if (beforeProvision.missingLedgers.length) {
        presentBilibiliBackupPreflight(beforeProvision)
        setConfirmationPreparationError('备册尚未完成；请完成列出的收藏夹和分册确认后再同步。')
        return
      }
      const candidateShards = beforeProvision.requiredPhysicalShards.filter((shard) => bilibiliBindingCandidatesForShard(shard).length)
      if (candidateShards.length) {
        const adopt = window.bilimiDesktop?.adoptFavoriteRepositoryLedgerBinding
        if (!adopt) throw new Error('同步前候选分册绑定不可用，请重启应用后重试。')
        for (const shard of candidateShards) {
          const remoteFolderId = bilibiliShardCandidateIds[bilibiliBackupShardKey(shard)]
          const candidate = bilibiliBindingCandidatesForShard(shard).find((item) => item.remoteFolderId === remoteFolderId)
          if (!candidate) {
            presentBilibiliBackupPreflight(beforeProvision)
            setConfirmationPreparationError('请按具体 B 站 ID 选择每个新增分册后再继续。')
            return
          }
          setConfirmationPreparationStatus(`正在确认绑定新增分册：${candidate.remoteTitle}。`)
          await adopt(accountMid, {
            logicalLedgerId: shard.logicalLedgerId,
            logicalTitle: shard.logicalTitle,
            shardNumber: shard.shardNumber,
            remoteFolderId: candidate.remoteFolderId,
            remoteTitle: candidate.remoteTitle
          })
          adoptedPhysicalShards = true
        }
        beforeProvision = await readBilibiliBackupPreflight(intent.includeInbox) ?? beforeProvision
        if (beforeProvision.missingLedgers.length || beforeProvision.requiredPhysicalShards.some((shard) => bilibiliBindingCandidatesForShard(shard).length)) {
          presentBilibiliBackupPreflight(beforeProvision)
          setConfirmationPreparationError('备册尚未完成；请完成列出的收藏夹和分册确认后再同步。')
          return
        }
      }
      if (beforeProvision.requiredPhysicalShards.length) {
        if (!provision) throw new Error('同步前新增分册备册不可用，请重启应用后重试。')
        setConfirmationPreparationStatus('正在确认新增分册的备册状态。')
        await provision(accountMid)
        provisionedPhysicalShards = true
      }
      const rechecked = await readBilibiliBackupPreflight(intent.includeInbox)
      if (rechecked && hasBilibiliBackupGaps(rechecked)) {
        presentBilibiliBackupPreflight(rechecked)
        setConfirmationPreparationError('备册尚未完成；请完成列出的收藏夹和分册确认后再同步。')
        return
      }
      if (provisionedPhysicalShards || adoptedPhysicalShards) {
        await onRefreshOrganizationState?.({ reconcileFavoriteBindingProjection: true })
      }
      setBilibiliBackupPreflight(null)
      setBilibiliLedgerCandidateIds({})
      setBilibiliShardCandidateIds({})
      setBilibiliBackupIncludeInbox(false)
      bilibiliBackupSyncIntentRef.current = null
      setConfirmationPreparationStatus('备册已核验，正在准备同步到 B 站。')
      await executeConfirmedBilibiliSync(intent.includeInbox)
    } catch (error) {
      setConfirmationPreparationError(error instanceof Error ? error.message : '收藏夹备册失败，请重试。')
    } finally {
      setConfirmationPreparing(false)
      setConfirmationPreparationStatus(null)
    }
  }
  const confirmBilibiliBackupPreflight = async () => {
    const preflight = bilibiliBackupPreflight
    const intent = bilibiliBackupSyncIntentRef.current
    if (!preflight || confirmationPreparing) return
    setConfirmationPreparing(true)
    setConfirmationPreparationError(null)
    try {
      // The dialog only presents a read-only projection. Do not turn a list
      // captured before a rule or round-selection change into a Bilibili
      // backup operation: re-read the authoritative projection first.
      const latestPreflight = await readBilibiliBackupPreflight(intent?.includeInbox ?? false)
      if (!latestPreflight || latestPreflight.workspaceId !== preflight.workspaceId) {
        setBilibiliBackupPreflight(null)
        setBilibiliLedgerCandidateIds({})
        setBilibiliShardCandidateIds({})
        setBilibiliBackupIncludeInbox(false)
        bilibiliBackupSyncIntentRef.current = null
        setConfirmationPreparationError('同步目标已更新，请重新确认同步到 B 站。')
        return
      }
      if (!sameBilibiliBackupPreflightTargets(latestPreflight, preflight)) {
        presentBilibiliBackupPreflight(latestPreflight)
        setConfirmationPreparationError('同步目标已更新，请确认最新备册范围后继续。')
        return
      }
      const missingLedgerIds = latestPreflight.missingLedgers.map((ledger) => ledger.logicalLedgerId)
      if (missingLedgerIds.length) {
        const ledgersWithCandidates = latestPreflight.missingLedgers.filter((ledger) => bilibiliBindingCandidatesForLedger(ledger).length)
        const missingLedgerCandidates = ledgersWithCandidates.map((ledger) => {
          const remoteFolderId = bilibiliLedgerCandidateIds[bilibiliBackupLedgerKey(ledger)]
          const candidate = bilibiliBindingCandidatesForLedger(ledger).find((item) => item.remoteFolderId === remoteFolderId)
          return { ledger, candidate }
        })
        if (missingLedgerCandidates.some(({ candidate }) => !candidate)) {
          presentBilibiliBackupPreflight(latestPreflight)
          setConfirmationPreparationError('请按具体 B 站 ID 选择每个未备册收藏夹后再继续。')
          return
        }
        const rebindRemoteFolders = Object.fromEntries(missingLedgerCandidates
          .filter((entry): entry is { ledger: typeof entry.ledger; candidate: NonNullable<typeof entry.candidate> } => Boolean(entry.candidate))
          .map(({ ledger, candidate }) => [ledger.logicalLedgerId, [{
            id: candidate.remoteFolderId,
            title: candidate.remoteTitle,
            memberCount: candidate.memberCount,
            ...(candidate.shardNumber === undefined ? {} : { shardNumber: candidate.shardNumber })
          }]]))
        const rebindRemoteFolderIds = Object.fromEntries(Object.entries(rebindRemoteFolders)
          .map(([ledgerId, folders]) => [ledgerId, folders[0]!.id]))
        const hasCreationTarget = latestPreflight.missingLedgers.some((ledger) => !bilibiliBindingCandidatesForLedger(ledger).length)
        setConfirmationPreparationStatus('正在按确认范围备册收藏夹。')
        const result = await favoriteLedgerOverviewRef.current?.requestBackup({
          targetLedgerIds: missingLedgerIds,
          suppressConfirmationDialog: true,
          confirmedBackupOptions: {
            ...(hasCreationTarget ? { confirmCreateAndBind: true } : {}),
            ...(Object.keys(rebindRemoteFolderIds).length ? { rebindRemoteFolderIds } : {}),
            ...(Object.keys(rebindRemoteFolders).length ? { rebindRemoteFolders } : {})
          }
        }) as {
          ok?: boolean
          message?: string
          unboundCandidates?: unknown[]
        } | undefined
        if (result?.unboundCandidates?.length) {
          // A creation-time directory reread found a changed candidate set.
          // Keep the current dialog as the sole consent surface and require a
          // fresh preflight instead of opening the overview's own dialog.
          const refreshed = await readBilibiliBackupPreflight(intent?.includeInbox ?? false)
          if (refreshed) presentBilibiliBackupPreflight(refreshed)
          setConfirmationPreparationError('B 站收藏夹候选已变化，请确认最新备册范围后继续。')
          return
        }
        if (result?.ok === false) {
          setConfirmationPreparationError(result.message || '收藏夹备册失败，请重试。')
          return
        }
      }
      await continueConfirmedBilibiliBackup()
    } catch (error) {
      setConfirmationPreparationError(error instanceof Error ? error.message : '收藏夹备册失败，请重试。')
    } finally {
      setConfirmationPreparing(false)
      setConfirmationPreparationStatus(null)
    }
  }
  const continueConfirmAndSync = async (includeInbox = false) => {
    if (!activeSnapshot) return
    setConfirmationPreparing(true)
    setConfirmationPreparationError(null)
    try {
      const unmatchedCount = activeSnapshot.planReadiness?.unclassifiedAidCount ?? 0
      const needsKnownBackup = confirmationNeedsBackup(activeSnapshot, displayedLedgersWithLiveEnabled, missingLedgerIds) ||
        displayedLedgersWithLiveEnabled.some((ledger) => ledger.enabled && !ledger.bilibiliFolderId)
      const needsKnownShardCapacity = confirmationNeedsShardCapacityPreflight(activeSnapshot, displayedLedgersWithLiveEnabled)
      if (needsKnownBackup || needsKnownShardCapacity || unmatchedCount > 0) {
        const preflight = await readBilibiliBackupPreflight(includeInbox)
        if (preflight) {
          bilibiliBackupSyncIntentRef.current = { includeInbox, workspaceId: preflight.workspaceId }
          setBilibiliBackupIncludeInbox(includeInbox)
          presentBilibiliBackupPreflight(preflight)
          return
        }
      }
      // Compatibility for a renderer running with an older preload. Current
      // Electron builds use the main-process preflight above; the freeze guard
      // remains fail-closed even if this fallback is reached.
      if (needsKnownBackup) {
        setConfirmationPreparationStatus('正在同步目标收藏夹，完成后会继续同步到 B 站。')
        const result = await onEnsureLedgers() as { ok?: boolean; message?: string } | undefined
        if (result?.ok === false) {
          setConfirmationPreparationError(result.message || '收藏夹同步失败，请重试。')
          return
        }
      }
      const execution = await executeConfirmedBilibiliSync(includeInbox)
      const executionFailure = workspace.getLatestExecutionFailure()
      const backupPreflightRequired = executionFailure instanceof Error && /backup-preflight-required/i.test(executionFailure.message) ||
        Boolean(execution && !('recovery' in execution) && execution.executionIntent?.failureCode === 'backup-preflight-required')
      if (backupPreflightRequired) {
        const preflight = await readBilibiliBackupPreflight(includeInbox)
        if (preflight && hasBilibiliBackupGaps(preflight) && preflight.workspaceId === activeSnapshot.workspaceId) {
          bilibiliBackupSyncIntentRef.current = { includeInbox, workspaceId: preflight.workspaceId }
          setBilibiliBackupIncludeInbox(includeInbox)
          presentBilibiliBackupPreflight(preflight)
          return
        }
      }
    } catch (error) {
      setConfirmationPreparationError(error instanceof Error ? error.message : '收藏夹同步失败，请重试。')
    } finally {
      setConfirmationPreparing(false)
      setConfirmationPreparationStatus(null)
    }
  }
  const confirmAndSync = async (includeInbox = false) => {
    if (!snapshot || recovery || confirmationPreparing) return
    await continueConfirmAndSync(includeInbox)
  }
  const bilibiliBackupUnmatchedCount = activeSnapshot?.planReadiness?.unclassifiedAidCount ?? 0
  const reconcile = async () => {
    try {
      await workspace.reconcileFrozenBilibiliPlan()
    } finally {
      await onRefreshOrganizationState?.()
    }
  }
  const closeGuide = () => {
    if (activeSnapshot) dismissedGuideWorkspaceIdRef.current = activeSnapshot.workspaceId
    setGuideOpen(false)
    setStep('scan')
    setScanStartFailure(null)
  }
  const closeCurrentWorkspace = async () => {
    if (recoveryPreparing) return
    setRecoveryPreparing(true)
    setConfirmationPreparationError(null)
    try {
      await workspace.prepareRecovery()
      closeGuide()
    } catch (error) {
      setConfirmationPreparationError(error instanceof Error ? error.message : '暂停并保存整理进度失败，请重试。')
    } finally {
      setRecoveryPreparing(false)
    }
  }
  const acknowledgeCompletion = () => {
    if (snapshot && !('recovery' in snapshot) && snapshot.status === 'completed') {
      onAcknowledgeOrganizationCompletion?.(snapshot.accountMid, snapshot.workspaceId)
    }
    closeGuide()
  }
  const abandonCurrentWorkspace = async () => {
    const result = await workspace.abandonCurrentWorkspace()
    if (result.status === 'succeeded') {
      setRecoverySummary(null)
      setResumeDialogOpen(false)
      closeGuide()
    } else {
      setRecoveryDecisionError(result.message)
      setResumeDialogOpen(true)
    }
  }
  const finishCurrentSegment = async () => {
    const current = activeSnapshot && !('recovery' in activeSnapshot) ? activeSnapshot.currentSegment?.id : undefined
    const segments = activeSnapshot && !('recovery' in activeSnapshot) ? activeSnapshot.segments : []
    const currentIndex = current ? segments.find((candidate) => candidate.id === current)?.index ?? -1 : -1
    const unfinished = segments.filter((segment) => segment.readiness !== 'saved')
    const next = unfinished.find((segment) => segment.index > currentIndex) ?? unfinished[0]
    if (next) {
      await workspace.selectSegment(next.id)
      setStep(next.readiness === 'tagging' || next.readiness === 'waiting' ? 'scan' : 'preview')
      return
    }
    await abandonCurrentWorkspace()
  }
  const canRestartFromResume = activeSnapshot !== null && activeSnapshot.status !== 'completed'
  const displayedLedgers = effectiveLedgers
  const displayedLedgersWithLiveEnabled = displayedLedgers.map((ledger) => ({
    ...ledger,
    enabled: effectiveLedgerEnabledById.get(ledger.id) ?? ledger.enabled
  }))
  const visibleOrganizationRecommendationEditing = isVisibleOrganizationRecommendationEditing(activeSnapshot, guideOpen)
  const activeOrganizationSelectionSnapshot = isOrganizationSelectionSnapshot(activeSnapshot)
  const recommendationProjection = activeOrganizationSelectionSnapshot
    ? createRecommendationProjection(activeSnapshot.recommendations.links)
    : undefined
  const authoritativeRecommendationAdoptionByLedgerId = activeOrganizationSelectionSnapshot
    ? new Map(activeSnapshot.recommendations.adoptedCandidateIds.length > 0
      ? activeSnapshot.recommendations.candidates.flatMap((candidate) => {
      const ledgerId = recommendationProjection!.candidateToLedgerId.get(candidate.id)
      return ledgerId && persistedUpperLedgerIds.has(ledgerId)
        ? [[ledgerId, activeSnapshot.recommendations.adoptedCandidateIds.includes(candidate.id)] as const]
        : []
      })
      : [])
    : undefined
  const organizationSavedLedgerEnabledById = activeOrganizationSelectionSnapshot
    ? new Map(displayedLedgers
      .filter((ledger) => persistedUpperLedgerIds.has(ledger.id))
      .map((ledger) => [ledger.id,
        authoritativeRecommendationAdoptionByLedgerId?.get(ledger.id) ??
        organizationSavedLedgerParticipationById.get(ledger.id) ??
        (ledger.enabled && !(activeSnapshot.excludedLedgerIds ?? []).includes(ledger.id))]))
    : undefined
  const enabledLedgerIds = new Set(displayedLedgersWithLiveEnabled
    .filter((ledger) => ledger.enabled)
    .map((ledger) => ledger.id))
  const hasBackupEligibleLedger = displayedLedgersWithLiveEnabled.some((ledger) =>
    ledger.enabled && (ledger.syncState !== 'local-draft' || ledger.ruleOrigin === 'saved-rule') &&
    (defaultFavoriteSystemEnabled !== false || !ledger.isDefault || ledger.id === 'inbox'))
  const ensureLedgersAndOpenFavoritePage = async () => {
    if (ensuringLedgersRef.current) return
    ensuringLedgersRef.current = true
    setBackupPreparationLedgerIds(onSyncLedgers
      ? favoriteLedgerOverviewRef.current?.getBackupTargetLedgerIds() ?? []
      : [])
    setEnsuringLedgers(true)
    try {
      await waitForVisiblePaint()
      const result = (onSyncLedgers
        ? await favoriteLedgerOverviewRef.current?.requestBackup()
        : await onEnsureLedgers()) as { ok?: boolean } | undefined
      if (result?.ok !== false) await onOpenFavoritePage?.()
    } finally {
      ensuringLedgersRef.current = false
      setBackupPreparationLedgerIds([])
      setEnsuringLedgers(false)
    }
  }

  const openFavoriteLibrary = async () => {
    try {
      await window.bilimiDesktop?.openFavoriteLibrary?.()
      onFavoriteLibraryOpened?.()
    } catch {
      onTransientFeedback?.('收藏库打开失败，请重试。')
    }
  }

  return (
    <section ref={favoritePanelRef} role="dialog" aria-label="掌库" className="favorite-ledger-panel">
      <div className="favorite-ledger-panel__topbar">
        <div className="favorite-ledger-panel__header"><h2 className="sr-only">掌库</h2></div>
        <div className="favorite-ledger-panel__toolbar">
          <AssistantActionButton type="button" aria-label="备册" aria-busy={ensuringLedgers} disabled={localToggleOnly || workspace.loading || ensuringLedgers || !hasBackupEligibleLedger}
            onClick={() => void ensureLedgersAndOpenFavoritePage()} icon={clickedPetUrl} iconAlt="小咪备册" badge="备"
            label={ensuringLedgers ? '备册中' : '备册'} description={ensuringLedgers ? '正在后台检查并生成 bilimi 收藏夹' : '一键生成 bilimi 收藏夹，用于归类收藏和整理'} />
          <AssistantActionButton type="button" aria-label="整理收藏" disabled={scanStarting || recoveryPreparing || !currentAccountMid}
            onClick={() => void requestOldFavoriteOrganization()} icon={hintPetUrl} iconAlt="小咪整理收藏" badge="整"
            label="整理收藏" description="扫描已有收藏，确认后整理到 bilimi 收藏夹里" />
          <AssistantActionButton type="button" aria-label="收藏库"
            onClick={() => void openFavoriteLibrary()} icon={idlePetUrl} iconAlt="小咪收藏库" badge="库"
            label="收藏库" description="唤醒 bilimi 并打开收藏库" />
        </div>
      </div>

      <FavoriteLedgerOverview
        ref={favoriteLedgerOverviewRef}
        key={normalizeAccountMid(currentAccountMid) ?? 'no-account'}
        currentAccountMid={currentAccountMid}
        localFavoriteToggleAccountMid={localFavoriteToggleAccountMid}
        ledgers={displayedLedgers}
        missingLedgerIds={missingLedgerIds}
        unboundLedgerIds={unboundLedgerIds}
        remoteOnlyDraftLedgerIds={remoteOnlyDraftLedgerIds}
        observedRemoteObservations={observedRemoteObservations}
        observedBoundRenameCandidates={observedBoundRenameCandidates}
        remoteDiscoveryNoticeDismissed={remoteDiscoveryNoticeDismissed}
        onDismissRemoteDiscoveryNotice={onDismissRemoteDiscoveryNotice}
        onDismissRemoteDraftReminder={onDismissRemoteDraftReminder}
        backupPreparationLedgerIds={backupPreparationLedgerIds}
        organizationActive={Boolean(activeSnapshot && !['frozen', 'executing', 'reconciling'].includes(activeSnapshot.status))}
        hasExpandedOrganizationGuide={guideOpen}
        defaultFavoriteSystemEnabled={defaultFavoriteSystemEnabled}
        openLedgerId={resolvedOpenLedgerId}
        openLedgerRequestVersion={openLedgerRequestVersion}
        createLedger={createLedger}
        createLedgerRequestVersion={createLedgerRequestVersion}
        onSaveLedgers={saveLedgersAndRefreshWorkspace}
        onSaveLedgerEnabled={saveLedgerEnabledAndRefreshWorkspace}
        onEnabledStateChange={handleEnabledStateChange}
        onOrganizationRecommendationToggle={handleOrganizationRecommendationToggle}
        onOrganizationSavedLedgerToggle={handleOrganizationSavedLedgerToggle}
        onOrganizationSavedLedgerSelectionChange={handleOrganizationSavedLedgerSelectionChange}
        organizationSavedLedgerEnabledById={organizationSavedLedgerEnabledById}
        onDeleteLedger={handleDeleteLedger}
        onSyncLedgers={onSyncLedgers}
        onBackupConfirmationFinished={(result) => {
          if (!bilibiliBackupSyncIntentRef.current) return
          if (result?.ok === false) {
            setConfirmationPreparationError(result.message || '收藏夹备册失败，请重试。')
            return
          }
          void continueConfirmedBilibiliBackup()
        }}
        draftRuleAnalysis={workspace.draftRuleAnalysis}
        draftRuleAnalysisError={workspace.draftRuleAnalysisError}
        onCancelDraftRuleAnalysis={() => { void workspace.cancelDraftLedgerRuleAnalysis() }}
        onAnalyzeLedgerRule={async (ledger) => {
          const ruleType = ledger.ruleType ?? 'keyword'
          if (ruleType === 'deepseek') return true
          const rules = parseFavoriteLedgerRules(ledger)
          workspace.queueDraftLedgerRuleAnalysis({
            ledgerId: ledger.id,
            title: stripBilimiLedgerPrefix(ledger.displayName),
            keywords: rules.localKeywords,
            ruleType,
            ...(ledger.enabled ? {} : { adopt: false })
          })
          return true
        }}
      />
      {bilibiliBackupPreflight ? <OldFavoriteModal title="同步前备册确认" confirmLabel={hasBilibiliBackupGaps(bilibiliBackupPreflight) ? '确认备册并继续' : '确认并同步'} confirmDisabled={confirmationPreparing || bilibiliBackupPreflight.missingLedgers.some((ledger) => bilibiliBindingCandidatesForLedger(ledger).length > 0 && !bilibiliLedgerCandidateIds[bilibiliBackupLedgerKey(ledger)]) || bilibiliBackupPreflight.requiredPhysicalShards.some((shard) => bilibiliBindingCandidatesForShard(shard).length > 0 && !bilibiliShardCandidateIds[bilibiliBackupShardKey(shard)])}
        onCancel={() => {
          if (confirmationPreparing) return
          setBilibiliBackupPreflight(null)
          setBilibiliLedgerCandidateIds({})
          setBilibiliShardCandidateIds({})
          setBilibiliBackupIncludeInbox(false)
          bilibiliBackupSyncIntentRef.current = null
          setConfirmationPreparationError(null)
        }}
        onConfirm={() => void confirmBilibiliBackupPreflight()}>
        <p>{hasBilibiliBackupGaps(bilibiliBackupPreflight)
          ? '确认同步到 B 站前，需要先完成以下备册。'
          : '确认后会先保存本轮分类到收藏库，再开始同步到 B 站。'} 取消或关闭不会冻结整理计划、创建/绑定收藏夹或写入视频。</p>
        {bilibiliBackupGroups.length ? <ul>
          {bilibiliBackupGroups.map((group) => <li key={`ledger:${group.logicalLedgerId}`}>
            收藏夹：{group.logicalTitle}{group.missingLedger ? `（${group.missingLedger.reason === 'unbacked' ? '未备册' : group.missingLedger.reason === 'unbound' ? '未绑定' : '待正式确认'}）` : ''}
            {group.missingLedger && bilibiliBindingCandidatesForLedger(group.missingLedger).length ? <div><p>检测到实际未绑定的 B 站候选；请选择要绑定的精确 ID：</p>{bilibiliBindingCandidatesForLedger(group.missingLedger).map((candidate) => <label key={candidate.remoteFolderId}><input type="radio" name={`bilibili-backup-ledger:${bilibiliBackupLedgerKey(group.missingLedger!)}`} checked={bilibiliLedgerCandidateIds[bilibiliBackupLedgerKey(group.missingLedger)] === candidate.remoteFolderId} onChange={() => setBilibiliLedgerCandidateIds((current) => ({ ...current, [bilibiliBackupLedgerKey(group.missingLedger!)]: candidate.remoteFolderId }))} />{candidate.remoteTitle}（ID：{candidate.remoteFolderId}，{candidate.memberCount} 个视频）</label>)}</div> : null}
            {group.shards.length ? <ul>{group.shards.map((shard) => <li key={`shard:${shard.logicalLedgerId}:${shard.shardNumber}`}>新增分册：{shard.logicalTitle}{shard.shardNumber > 1 ? `·${shard.shardNumber}` : ''}（本轮需容纳 {shard.requiredAssignmentCount} 条新归属）
              {bilibiliBindingCandidatesForShard(shard).length ? <div><p>检测到实际未绑定的 B 站候选；请选择要绑定的精确 ID：</p>{bilibiliBindingCandidatesForShard(shard).map((candidate) => <label key={candidate.remoteFolderId}><input type="radio" name={`bilibili-backup-shard:${bilibiliBackupShardKey(shard)}`} checked={bilibiliShardCandidateIds[bilibiliBackupShardKey(shard)] === candidate.remoteFolderId} onChange={() => setBilibiliShardCandidateIds((current) => ({ ...current, [bilibiliBackupShardKey(shard)]: candidate.remoteFolderId }))} />{candidate.remoteTitle}（ID：{candidate.remoteFolderId}，{candidate.memberCount} 个视频）</label>)}</div> : null}
            </li>)}</ul> : null}
          </li>)}
        </ul> : null}
        {bilibiliBackupUnmatchedCount > 0 ? <label><input type="checkbox" checked={bilibiliBackupIncludeInbox} disabled={confirmationPreparing} onChange={(event) => void updateBilibiliBackupIncludeInbox(event.currentTarget.checked)} />同步 bilimi·暂存（{bilibiliBackupUnmatchedCount} 条）</label> : null}
        <p>实际发现未绑定的 B 站收藏夹时，仍会要求你按具体 ID 确认绑定；创建前会再次读取清单。</p>
        {confirmationPreparationStatus ? <p role="status">{confirmationPreparationStatus}</p> : null}
        {confirmationPreparationError ? <p role="alert">{confirmationPreparationError}</p> : null}
      </OldFavoriteModal> : null}
      {resumeDialogOpen && recoveryPreparationError ? <OldFavoriteModal title="整理收藏"
        onCancel={() => { setRecoveryPreparationError(null); setResumeDialogOpen(false); closeGuide() }}
        extraActions={<button type="button" onClick={() => void requestOldFavoriteOrganization()}>重新尝试</button>}>
        <p role="alert">{recoveryPreparationError}</p>
      </OldFavoriteModal> : null}
      {resumeDialogOpen && recoverySummary ? <OldFavoriteModal title="整理收藏"
        onCancel={() => { if (recoveryDecisionPending) return; setRecoverySummary(null); setResumeDialogOpen(false); closeGuide() }}
        extraActions={<>
          {recoverySummary.recoveryChoices.includes('recover-draft') ? <button type="button" disabled={Boolean(recoveryDecisionPending)} onClick={() => void selectRecoveryDecision('merge-latest')}>恢复草稿</button> : null}
          {recoverySummary.recoveryChoices.includes('rescan') ? <button type="button" disabled={Boolean(recoveryDecisionPending)} onClick={() => {
            setResumeDialogOpen(false)
            setRecoveryRescanConfirmOpen(true)
          }}>重新扫描</button> : null}
          {recoverySummary.recoveryChoices.includes('abandon') ? <button type="button" disabled={Boolean(recoveryDecisionPending)} onClick={() => void abandonCurrentWorkspace()}>放弃本轮整理</button> : null}
          {recoverySummary.recoveryChoices.includes('reconcile-result-unknown') ? <button type="button" disabled={Boolean(recoveryDecisionPending)} onClick={() => void openReconciliationDraft()}>查看并检查同步结果</button> : null}
        </>}>
        <p>检测到未完成的整理草稿</p>
        <p>本轮计划 {recoverySummary.plannedCount ?? 0}，已分类 {recoverySummary.classifiedCount ?? 0}；其余 {recoverySummary.unclassifiedCount ?? 0} 条包含未匹配和等待扫描，恢复后按批次继续。</p>
        {recoverySummary.baselineChangeEvidence.changed ? <p>检测到草稿后的资料、B站位置或收藏夹绑定变化；人工分类会保留。</p> : null}
        {recoveryDecisionPending ? <p role="status">正在恢复整理草稿…</p> : null}
        {recoveryDecisionError ? <p role="alert">{recoveryDecisionError}</p> : null}
      </OldFavoriteModal> : null}
      {recoveryRescanConfirmOpen ? <OldFavoriteModal title="确认重新扫描？" danger confirmLabel="确认重新扫描"
        onCancel={() => {
          setRecoveryRescanConfirmOpen(false)
          setResumeDialogOpen(Boolean(recoverySummary))
        }}
        onConfirm={() => {
          setRecoveryRescanConfirmOpen(false)
          void selectRecoveryDecision('rescan')
        }}>
        <p>重新扫描会重新建立本轮的扫描事实和系统分类；已保存的本地结果、人工分类及已同步到 B 站的结果不会被撤销。</p>
      </OldFavoriteModal> : null}
      {guideOpen ? <OldFavoriteGuide
        snapshot={snapshot}
        loading={workspace.loading || confirmationPreparing}
        tagEnrichmentUpdating={workspace.tagEnrichmentUpdating}
        mutationLocked={Boolean(workspace.draftRuleAnalysis || activeSnapshot?.executionIntent ||
          (activeSnapshot && ['frozen', 'executing', 'reconciling'].includes(activeSnapshot.status)))}
        reconciling={workspace.reconciling}
        preparationStatus={bilibiliBackupPreflight ? null : confirmationPreparationStatus}
        executionError={bilibiliBackupPreflight ? workspace.executionError : confirmationPreparationError ?? workspace.executionError}
        scanStarting={scanStarting}
        scanStartFailure={scanStartFailure}
        step={step}
        onStepChange={(nextStep) => {
          setStep(nextStep)
        }}
        onRetryScan={() => void (activeSnapshot?.status === 'scanning' && activeSnapshot.scan.phase === 'failed'
          ? continueScan()
          : startScan('incremental'))}
        scanPaused={Boolean(activeSnapshot?.scan.paused)}
        onPauseScan={() => void pauseScan()}
        onResumeScan={() => void continueScan()}
        onFinishScan={() => void finishScan()}
        onRestartScan={() => void startScan('incremental')}
        onRetryScanDirect={() => void retryScanWithDirectSession()}
        onRebuildWorkspace={() => void workspace.rebuildCorruptWorkspace()}
        onSelectSourceFolders={(folderIds) => void workspace.selectSourceFolders(folderIds)}
        onPauseTagEnrichment={() => void workspace.pauseTagEnrichment()}
        onResumeTagEnrichment={() => void workspace.resumeTagEnrichment()}
        onRetryFailedTagEnrichment={() => void workspace.retryFailedTagEnrichment()}
        onAcceptCurrentTags={() => void workspace.acceptCurrentTags()}
        onSetRecommendedCandidates={setOrganizationRecommendedCandidates}
        onUpdateRecommendedCandidates={updateOrganizationRecommendedCandidates}
        onRecommendationPointerDown={() => preserveFavoritePanelScrollPosition({ ignoreInitialScroll: true, capturedBeforeFocus: true })}
        onRecommendationSelectionChange={completeFavoritePanelPointerSelection}
        recommendedCandidateIds={workspace.recommendedCandidateIds}
        recommendationSaving={workspace.recommendationSaving}
        recommendationError={workspace.recommendationError}
        previewPreparationRunning={workspace.previewPreparationRunning}
        previewPreparationProgress={workspace.previewPreparationProgress}
        previewPreparationError={workspace.previewPreparationError}
        onCancelPreviewPreparation={() => void workspace.cancelRecommendationPreviewPreparation()}

        ledgers={displayedLedgersWithLiveEnabled}
        enabledLedgerIds={enabledLedgerIds}
        candidateLedgerIds={recommendationProjection?.candidateToLedgerId}
        deepSeekAvailable={deepSeekArchiveAvailable}
        deepSeekFeedback={workspace.deepSeekFeedback}
        onSelectSegment={(segmentId) => void workspace.selectSegment(segmentId)}
        onViewSegment={workspace.viewSegment}
        onAutoClassify={() => void workspace.autoClassifyCurrentSegment()}
        onOrganizeWithDeepSeek={(mode, scope) => {
          const finishDeepSeekTask = onDeepSeekTaskStart?.(scope === 'all' ? '收藏整理：本轮所有批次' : '收藏整理：当前批次')
          void workspace.organizeCurrentSegmentWithDeepSeek(mode, scope).finally(() => finishDeepSeekTask?.())
        }}
        onRetryFailedDeepSeekChunks={() => {
          const finishDeepSeekTask = onDeepSeekTaskStart?.('收藏整理：重试失败批次')
          void workspace.retryFailedDeepSeekChunks().finally(() => finishDeepSeekTask?.())
        }}
        onCancelDeepSeek={() => void workspace.cancelCurrentSegmentDeepSeek()}
        deepSeekCancelRequested={workspace.deepSeekCancelRequested}
        onUndoClassification={() => void undoOrganizationHistory()}
        onRedoClassification={() => void redoOrganizationHistory()}
        onMoveHistoryCursor={(cursor) => void moveOrganizationHistoryCursor(cursor)}
        onApplyManualClassification={applyManualClassification}
        onApplyManualClassifications={applyManualClassifications}
        onSaveLocally={() => void workspace.saveCurrentSegmentLocally()}
        onSaveCurrentSegment={() => void workspace.saveCurrentSegmentLocally()}
        onSaveWholeRun={() => void workspace.setWholeRunExecutionIntent('local')}
        onFinishCurrentSegment={() => void finishCurrentSegment()}
        onCancelExecutionIntent={() => void workspace.cancelWholeRunExecutionIntent()}
        onCloseCurrentWorkspace={() => void closeCurrentWorkspace()}
        onAbandonCurrentWorkspace={() => void abandonCurrentWorkspace()}
        onAcknowledgeCompletion={acknowledgeCompletion}
        onConfirmAndSync={(includeInbox) => void confirmAndSync(includeInbox)}
        onExecuteFrozenPlan={() => void workspace.executeFrozenBilibiliPlan()}
        onPauseBilibiliSync={workspace.pauseBilibiliSync}
        onStopSyncAndFinish={workspace.stopBilibiliSyncAndFinish}
        onReconcile={() => void reconcile()}
      /> : null}
    </section>
  )
}
