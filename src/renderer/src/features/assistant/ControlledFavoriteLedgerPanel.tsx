import type { FavoriteLedger, FavoriteLedgerSaveOptions } from '@shared/types'
import type { OldFavoriteWorkspaceRecommendationCandidate, OldFavoriteWorkspaceRecoverySummary, OldFavoriteWorkspaceSnapshot } from '@shared/oldFavoriteWorkspace'
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
  ledgers: FavoriteLedger[]
  missingLedgerIds: string[]
  unboundLedgerIds?: string[]
  remoteOnlyDraftLedgerIds?: string[]
  onDismissRemoteDraftReminder?: (ledgerId: string, remoteFolderId: string) => Promise<void> | void
  defaultFavoriteSystemEnabled?: boolean
  onEnsureLedgers: () => Promise<unknown>
  onSaveLedgers: (ledgers: FavoriteLedger[], options?: FavoriteLedgerSaveOptions) => Promise<unknown> | void
  onSaveLedgerEnabled?: (ledgerId: string, enabled: boolean) => Promise<unknown> | void
  onSyncLedgers?: (ledgers: FavoriteLedger[], options?: FavoriteLedgerSaveOptions) => Promise<unknown> | void
  onOpenFavoritePage?: () => Promise<unknown> | void
  onRefreshOrganizationState?: () => Promise<unknown> | void
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

type RecommendationProjection = {
  candidateToLedgerId: Map<string, string>
  ledgerToCandidateId: Map<string, string>
}

function recommendationRuleType(candidate: OldFavoriteWorkspaceRecommendationCandidate) {
  return candidate.kind === 'author' ? 'author' as const : candidate.kind === 'tag' ? 'tag' as const : 'keyword' as const
}

function normalizedRuleKeywords(values: readonly string[] | undefined) {
  return [...new Set((values ?? []).map((value) => value.trim().toLocaleLowerCase()).filter(Boolean))].sort()
}

function sameRecommendationRule(ledger: FavoriteLedger, candidate: OldFavoriteWorkspaceRecommendationCandidate) {
  return (ledger.ruleType ?? 'keyword') === recommendationRuleType(candidate) &&
    JSON.stringify(normalizedRuleKeywords(ledger.keywords)) === JSON.stringify(normalizedRuleKeywords(candidate.keywords))
}

export function createRecommendationProjection(
  ledgers: readonly FavoriteLedger[],
  candidates: readonly OldFavoriteWorkspaceRecommendationCandidate[]
): RecommendationProjection {
  const candidateToLedgerId = new Map<string, string>()
  const ledgerToCandidateId = new Map<string, string>()
  const matchedLedgerIds = new Set<string>()
  const savedLedgers = ledgers.filter((ledger) => ledger.syncState !== 'local-draft' || Boolean(ledger.bilibiliFolderId || ledger.bindingState))
  for (const candidate of candidates) {
    const exact = savedLedgers.find((ledger) => ledger.id === candidate.id)
    const resolved = exact ?? savedLedgers.find((ledger) => !matchedLedgerIds.has(ledger.id) && sameRecommendationRule(ledger, candidate))
    if (!resolved) continue
    matchedLedgerIds.add(resolved.id)
    candidateToLedgerId.set(candidate.id, resolved.id)
    ledgerToCandidateId.set(resolved.id, candidate.id)
  }
  return { candidateToLedgerId, ledgerToCandidateId }
}

export function resolveRecommendationOpenLedgerId(
  openLedgerId: string | undefined,
  ledgers: readonly FavoriteLedger[],
  candidates: readonly OldFavoriteWorkspaceRecommendationCandidate[]
) {
  if (!openLedgerId) return undefined
  const projection = createRecommendationProjection(ledgers, candidates)
  const candidateIds = new Set(candidates.map((candidate) => candidate.id))
  return candidateIds.has(openLedgerId)
    ? projection.candidateToLedgerId.get(openLedgerId)
    : openLedgerId
}

function mergePromotedRecommendationLedgers(
  ledgers: readonly FavoriteLedger[],
  promotedLedgers: readonly FavoriteLedger[]
) {
  const promotedIds = new Set(promotedLedgers.map((ledger) => ledger.id))
  const retainedLedgers = ledgers.filter((ledger) => !(ledger.syncState === 'local-draft' && promotedIds.has(ledger.id)))
  const persistedIds = new Set(retainedLedgers.map((ledger) => ledger.id))
  return [...retainedLedgers, ...promotedLedgers.filter((ledger) => !persistedIds.has(ledger.id))]
}

function savedRecommendationLedger(candidate: OldFavoriteWorkspaceRecommendationCandidate, index: number): FavoriteLedger {
  return {
    id: candidate.id,
    displayName: candidate.displayName,
    keywords: [...(candidate.keywords ?? [])],
    ruleType: recommendationRuleType(candidate),
    enabled: true,
    priority: 10_000 + index,
    bindingState: 'unbacked',
    isDefault: false
  }
}

function isPureLocalGeneratedRecommendation(ledger: FavoriteLedger) {
  return ledger.bindingState === 'unbacked' &&
    !ledger.bilibiliFolderId &&
    !(ledger.bilibiliFolderIds ?? []).some((folderId) => folderId.trim())
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

export function ControlledFavoriteLedgerPanel({
  currentAccountMid,
  ledgers,
  missingLedgerIds,
  unboundLedgerIds,
  remoteOnlyDraftLedgerIds = [],
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
  const accountKey = normalizeAccountMid(currentAccountMid)
  const [promotedRecommendationLedgers, setPromotedRecommendationLedgers] = useState<FavoriteLedger[]>([])
  const promotedRecommendationLedgersRef = useRef<FavoriteLedger[]>([])
  const pendingRecommendationSavesRef = useRef(new Map<string, Promise<unknown>>())
  const [promotedRecommendationAccountKey, setPromotedRecommendationAccountKey] = useState(accountKey)
  const [dismissedGeneratedRecommendationLedgerIds, setDismissedGeneratedRecommendationLedgerIds] = useState<ReadonlySet<string>>(() => new Set())
  const [dismissedRecommendationAccountKey, setDismissedRecommendationAccountKey] = useState(accountKey)
  const [ledgerEnabledById, setLedgerEnabledById] = useState<ReadonlyMap<string, boolean>>(() =>
    new Map(ledgers.map((ledger) => [ledger.id, ledger.enabled])))
  const ledgerEnabledByIdRef = useRef(ledgerEnabledById)
  const visiblePromotedRecommendationLedgers = promotedRecommendationAccountKey === accountKey
    ? promotedRecommendationLedgers
    : []
  const visibleDismissedGeneratedRecommendationLedgerIds = dismissedRecommendationAccountKey === accountKey
    ? dismissedGeneratedRecommendationLedgerIds
    : new Set<string>()
  const mergedEffectiveLedgers = mergePromotedRecommendationLedgers(ledgers, visiblePromotedRecommendationLedgers)
  const previewRecommendationSnapshot = workspace.snapshot && !('recovery' in workspace.snapshot) && workspace.snapshot.status === 'previewing'
    ? workspace.snapshot
    : null
  const effectiveLedgersBeforeDismissal = previewRecommendationSnapshot
    ? (() => {
        const projection = createRecommendationProjection(mergedEffectiveLedgers, previewRecommendationSnapshot.recommendations.candidates)
        const candidateIds = new Set(previewRecommendationSnapshot.recommendations.candidates.map((candidate) => candidate.id))
        return mergedEffectiveLedgers.filter((ledger) => ledger.syncState !== 'local-draft' ||
          !candidateIds.has(ledger.id) || projection.candidateToLedgerId.get(ledger.id) === ledger.id)
      })()
    : mergedEffectiveLedgers
  const effectiveLedgers = effectiveLedgersBeforeDismissal.filter((ledger) => !visibleDismissedGeneratedRecommendationLedgerIds.has(ledger.id))
  const [enabledStateAccountKey, setEnabledStateAccountKey] = useState(accountKey)
  const updateLedgerEnabledById = useCallback((next: ReadonlyMap<string, boolean>) => {
    const normalized = new Map(next)
    if (enabledMapsMatch(ledgerEnabledByIdRef.current, normalized)) return
    ledgerEnabledByIdRef.current = normalized
    setLedgerEnabledById(normalized)
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
    if (promotedRecommendationAccountKey === accountKey) return
    promotedRecommendationLedgersRef.current = []
    setPromotedRecommendationLedgers([])
    setPromotedRecommendationAccountKey(accountKey)
  }, [accountKey, promotedRecommendationAccountKey])
  useEffect(() => {
    if (dismissedRecommendationAccountKey === accountKey) return
    setDismissedGeneratedRecommendationLedgerIds(new Set())
    setDismissedRecommendationAccountKey(accountKey)
  }, [accountKey, dismissedRecommendationAccountKey])
  const removePromotedRecommendationLedger = useCallback((ledgerId: string) => {
    const nextPromoted = promotedRecommendationLedgersRef.current.filter((ledger) => ledger.id !== ledgerId)
    if (nextPromoted.length === promotedRecommendationLedgersRef.current.length) return
    promotedRecommendationLedgersRef.current = nextPromoted
    setPromotedRecommendationLedgers(nextPromoted)
  }, [])
  const promoteSelectedRecommendationLedgers = useCallback((candidateIds: readonly string[]) => {
    const snapshot = workspace.snapshot
    if (!snapshot || 'recovery' in snapshot || snapshot.status !== 'previewing') return
    const selectedIds = new Set(candidateIds)
    const currentLedgers = mergePromotedRecommendationLedgers(ledgers, promotedRecommendationLedgersRef.current)
    const projection = createRecommendationProjection(currentLedgers, snapshot.recommendations.candidates)
    const existingIds = new Set(currentLedgers.filter((ledger) => ledger.syncState !== 'local-draft').map((ledger) => ledger.id))
    const additions = snapshot.recommendations.candidates
      .filter((candidate) => selectedIds.has(candidate.id) && !projection.candidateToLedgerId.has(candidate.id) && !existingIds.has(candidate.id))
      .map((candidate, index) => savedRecommendationLedger(candidate, currentLedgers.length + index))
    if (!additions.length) return
    const nextPromoted = [...promotedRecommendationLedgersRef.current, ...additions]
    promotedRecommendationLedgersRef.current = nextPromoted
    setPromotedRecommendationLedgers(nextPromoted)
    const nextLedgers = mergePromotedRecommendationLedgers(ledgers, nextPromoted)
    const saveOperation = Promise.resolve().then(() => onSaveLedgers(nextLedgers, { deleteDisabled: false }))
    for (const addition of additions) pendingRecommendationSavesRef.current.set(addition.id, saveOperation)
    void saveOperation.catch(() => {
      const failedIds = new Set(additions.map((ledger) => ledger.id))
      const restoredPromoted = promotedRecommendationLedgersRef.current.filter((ledger) => !failedIds.has(ledger.id))
      promotedRecommendationLedgersRef.current = restoredPromoted
      setPromotedRecommendationLedgers(restoredPromoted)
    }).finally(() => {
      for (const addition of additions) {
        if (pendingRecommendationSavesRef.current.get(addition.id) === saveOperation) pendingRecommendationSavesRef.current.delete(addition.id)
      }
    })
  }, [ledgers, onSaveLedgers, workspace.snapshot])
  const setOrganizationRecommendedCandidates = useCallback(async (candidateIds: string[]) => {
    const snapshot = workspace.snapshot
    if (!snapshot || 'recovery' in snapshot || snapshot.status !== 'previewing') {
      workspace.setRecommendedCandidates(candidateIds)
      return workspace.waitForRecommendationQueue()
    }
    const candidates = snapshot.recommendations.candidates
    const knownCandidateIds = new Set(candidates.map((candidate) => candidate.id))
    const nextCandidateIds = [...new Set(candidateIds.map((id) => id.trim()).filter((id) => knownCandidateIds.has(id)))].sort()
    const previousCandidateIds = new Set(workspace.recommendedCandidateIds)
    const currentLedgers = mergePromotedRecommendationLedgers(ledgers, promotedRecommendationLedgersRef.current)
    const projection = createRecommendationProjection(currentLedgers, candidates)
    const ledgerById = new Map(currentLedgers.map((ledger) => [ledger.id, ledger]))
    promoteSelectedRecommendationLedgers(nextCandidateIds)
    workspace.setRecommendedCandidates(nextCandidateIds)
    const committedCandidateIds = new Set(await workspace.waitForRecommendationQueue())
    const dismissedLedgerIds = candidates
      .filter((candidate) => previousCandidateIds.has(candidate.id) && !nextCandidateIds.includes(candidate.id) && !committedCandidateIds.has(candidate.id))
      .map((candidate) => projection.candidateToLedgerId.get(candidate.id))
      .filter((ledgerId): ledgerId is string => Boolean(ledgerId))
      .filter((ledgerId) => {
        const ledger = ledgerById.get(ledgerId)
        return ledger ? isPureLocalGeneratedRecommendation(ledger) : false
      })
    if (dismissedLedgerIds.length) {
      for (const ledgerId of dismissedLedgerIds) removePromotedRecommendationLedger(ledgerId)
      setDismissedGeneratedRecommendationLedgerIds((current) => new Set([...current, ...dismissedLedgerIds]))
    }
    const restoredLedgerIds = candidates
      .filter((candidate) => !previousCandidateIds.has(candidate.id) && nextCandidateIds.includes(candidate.id) && committedCandidateIds.has(candidate.id))
      .map((candidate) => projection.candidateToLedgerId.get(candidate.id))
      .filter((ledgerId): ledgerId is string => Boolean(ledgerId))
    if (restoredLedgerIds.length) {
      const restoredIds = new Set(restoredLedgerIds)
      setDismissedGeneratedRecommendationLedgerIds((current) => new Set([...current].filter((ledgerId) => !restoredIds.has(ledgerId))))
    }
    return [...committedCandidateIds]
  }, [ledgers, promoteSelectedRecommendationLedgers, removePromotedRecommendationLedger, workspace.recommendedCandidateIds, workspace.setRecommendedCandidates, workspace.snapshot, workspace.waitForRecommendationQueue])
  const updateOrganizationRecommendedCandidates = useCallback((update: (current: string[]) => string[]) => {
    void setOrganizationRecommendedCandidates(update(workspace.recommendedCandidateIds))
  }, [setOrganizationRecommendedCandidates, workspace.recommendedCandidateIds])
  const handleEnabledStateChange = useCallback((next: ReadonlyMap<string, boolean>, source?: 'editor-unsaved' | 'organization-selection') => {
    const previousEnabledById = ledgerEnabledByIdRef.current
    updateLedgerEnabledById(next)
    if (source) return
    const recommendationCandidateIds = new Set(
      workspace.snapshot && !('recovery' in workspace.snapshot) && workspace.snapshot.status === 'previewing'
        ? createRecommendationProjection(effectiveLedgers, workspace.snapshot.recommendations.candidates).ledgerToCandidateId.keys()
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
  const handleOrganizationRecommendationToggle = useCallback(async (ledgerId: string, enabled: boolean) => {
    const snapshot = workspace.snapshot
    if (!snapshot || 'recovery' in snapshot || snapshot.status !== 'previewing') return false
    const candidateId = createRecommendationProjection(effectiveLedgers, snapshot.recommendations.candidates)
      .ledgerToCandidateId.get(ledgerId)
    if (!candidateId) return false
    const committedIds = await setOrganizationRecommendedCandidates(enabled
      ? [...workspace.recommendedCandidateIds, candidateId]
      : workspace.recommendedCandidateIds.filter((currentCandidateId) => currentCandidateId !== candidateId))
    return enabled ? committedIds.includes(candidateId) : !committedIds.includes(candidateId)
  }, [effectiveLedgers, setOrganizationRecommendedCandidates, workspace.recommendedCandidateIds, workspace.snapshot])
  useEffect(() => {
    promoteSelectedRecommendationLedgers(workspace.recommendedCandidateIds)
  }, [promoteSelectedRecommendationLedgers, workspace.recommendedCandidateIds])
  // FavoriteLedgerOverview owns its narrow deletion IPC. This callback only
  // acknowledges the completed local-rule deletion so the overview can update
  // its transient editor state without submitting the same IPC a second time.
  const handleDeleteLedger = useCallback(async () => true, [])
  const waitForRecommendationLedgerSave = useCallback(async (ledgerId: string) => {
    await pendingRecommendationSavesRef.current.get(ledgerId)
  }, [])
  const applyManualClassification = useCallback((aid: number, targetLedgerIds: string[]) => {
    void workspace.applyManualClassifications([{ aid, targetLedgerIds }])
  }, [workspace.applyManualClassifications])
  const applyManualClassifications = useCallback((assignments: Array<{ aid: number; targetLedgerIds: string[] }>) => {
    void workspace.applyManualClassifications(assignments)
  }, [workspace.applyManualClassifications])
  const [step, setStep] = useState<OldFavoriteGuideStep>('scan')
  const [guideOpen, setGuideOpen] = useState(false)
  const [resumeDialogOpen, setResumeDialogOpen] = useState(false)
  const [recoverySummary, setRecoverySummary] = useState<OldFavoriteWorkspaceRecoverySummary | null>(null)
  const [recoveryPreparing, setRecoveryPreparing] = useState(false)
  const [recoveryPreparationError, setRecoveryPreparationError] = useState<string | null>(null)
  const [recoveryDecisionPending, setRecoveryDecisionPending] = useState<'merge-latest' | 'rescan' | 'reconcile-result-unknown' | null>(null)
  const [recoveryRescanConfirmOpen, setRecoveryRescanConfirmOpen] = useState(false)
  const [recoveryDecisionError, setRecoveryDecisionError] = useState<string | null>(null)
  const [scanStarting, setScanStarting] = useState(false)
  const [ensuringLedgers, setEnsuringLedgers] = useState(false)
  const ensuringLedgersRef = useRef(false)
  const favoriteLedgerOverviewRef = useRef<FavoriteLedgerOverviewHandle>(null)
  const [scanStartFailure, setScanStartFailure] = useState<string | null>(null)
  const [confirmationPreparing, setConfirmationPreparing] = useState(false)
  const [confirmationPreparationStatus, setConfirmationPreparationStatus] = useState<string | null>(null)
  const [confirmationPreparationError, setConfirmationPreparationError] = useState<string | null>(null)
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
    ? resolveRecommendationOpenLedgerId(openLedgerId, effectiveLedgers, activeSnapshot.recommendations.candidates)
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
    if (paused) setGuideOpen(false)
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
      setRecoveryPreparationError(error instanceof Error ? error.message : '暂停并保存整理进度失败，请重试。')
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
  const continueConfirmAndSync = async (includeInbox = false) => {
    if (!activeSnapshot) return
    try {
      if (confirmationNeedsBackup(activeSnapshot, displayedLedgersWithLiveEnabled, missingLedgerIds)) {
        setConfirmationPreparationStatus('正在同步目标收藏夹，完成后会继续同步到 B 站。')
        const result = await onEnsureLedgers() as { ok?: boolean; message?: string } | undefined
        if (result?.ok === false) {
          setConfirmationPreparationError(result.message || '收藏夹同步失败，请重试。')
          return
        }
      }
      if (activeSnapshot.hasMultipleSegments) await workspace.setWholeRunExecutionIntent('bilibili', includeInbox)
      else await workspace.confirmAndExecuteBilibiliPlan(includeInbox)
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
  const organizationRecommendationEnabledById = activeSnapshot?.status === 'previewing'
    ? new Map([...createRecommendationProjection(displayedLedgers, activeSnapshot.recommendations.candidates).ledgerToCandidateId]
      .map(([ledgerId, candidateId]) => [ledgerId, workspace.recommendedCandidateIds.includes(candidateId)]))
    : undefined
  const enabledLedgerIds = new Set(displayedLedgersWithLiveEnabled
    .filter((ledger) => ledger.enabled)
    .map((ledger) => ledger.id))
  const hasBackupEligibleLedger = displayedLedgersWithLiveEnabled.some((ledger) =>
    ledger.enabled && ledger.syncState !== 'local-draft' &&
    (defaultFavoriteSystemEnabled !== false || !ledger.isDefault || ledger.id === 'inbox'))

  const ensureLedgersAndOpenFavoritePage = async () => {
    if (ensuringLedgersRef.current) return
    ensuringLedgersRef.current = true
    setEnsuringLedgers(true)
    try {
      await waitForVisiblePaint()
      const result = (onSyncLedgers
        ? await favoriteLedgerOverviewRef.current?.requestBackup()
        : await onEnsureLedgers()) as { ok?: boolean } | undefined
      if (result?.ok !== false) await onOpenFavoritePage?.()
    } finally {
      ensuringLedgersRef.current = false
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
    <section role="dialog" aria-label="掌库" className="favorite-ledger-panel">
      <div className="favorite-ledger-panel__topbar">
        <div className="favorite-ledger-panel__header"><h2 className="sr-only">掌库</h2></div>
        <div className="favorite-ledger-panel__toolbar">
          <AssistantActionButton type="button" aria-label="备册" aria-busy={ensuringLedgers} disabled={workspace.loading || ensuringLedgers || !hasBackupEligibleLedger}
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
        ledgers={displayedLedgers}
        missingLedgerIds={missingLedgerIds}
        unboundLedgerIds={unboundLedgerIds}
        remoteOnlyDraftLedgerIds={remoteOnlyDraftLedgerIds}
        onDismissRemoteDraftReminder={onDismissRemoteDraftReminder}
        organizationActive={Boolean(activeSnapshot && activeSnapshot.status !== 'completed')}
        hasExpandedOrganizationGuide={guideOpen}
        defaultFavoriteSystemEnabled={defaultFavoriteSystemEnabled}
        openLedgerId={resolvedOpenLedgerId}
        openLedgerRequestVersion={openLedgerRequestVersion}
        createLedger={createLedger}
        createLedgerRequestVersion={createLedgerRequestVersion}
        onSaveLedgers={onSaveLedgers}
        onSaveLedgerEnabled={onSaveLedgerEnabled}
        onEnabledStateChange={handleEnabledStateChange}
        onOrganizationRecommendationToggle={handleOrganizationRecommendationToggle}
        onBeforeDeleteLedger={waitForRecommendationLedgerSave}
        organizationRecommendationEnabledById={organizationRecommendationEnabledById}
        onDeleteLedger={handleDeleteLedger}
        onSyncLedgers={onSyncLedgers}
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
      {resumeDialogOpen && recoveryPreparationError ? <OldFavoriteModal title="整理收藏"
        onCancel={() => { setRecoveryPreparationError(null); setResumeDialogOpen(false); closeGuide() }}
        extraActions={<button type="button" onClick={() => void requestOldFavoriteOrganization()}>重试暂停</button>}>
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
        preparationStatus={confirmationPreparationStatus}
        executionError={confirmationPreparationError ?? workspace.executionError}
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
        recommendedCandidateIds={workspace.recommendedCandidateIds}
        recommendationSaving={workspace.recommendationSaving}
        recommendationError={workspace.recommendationError}
        previewPreparationRunning={workspace.previewPreparationRunning}
        previewPreparationProgress={workspace.previewPreparationProgress}
        previewPreparationError={workspace.previewPreparationError}
        onCancelPreviewPreparation={() => void workspace.cancelRecommendationPreviewPreparation()}

        ledgers={displayedLedgersWithLiveEnabled}
        enabledLedgerIds={enabledLedgerIds}
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
        onUndoClassification={() => void workspace.undoClassification()}
        onRedoClassification={() => void workspace.redoClassification()}
        onMoveHistoryCursor={(cursor) => void workspace.moveHistoryCursor(cursor)}
        onApplyManualClassification={applyManualClassification}
        onApplyManualClassifications={applyManualClassifications}
        onSaveLocally={() => void workspace.saveCurrentSegmentLocally()}
        onSaveCurrentSegment={() => void workspace.saveCurrentSegmentLocally()}
        onSaveWholeRun={() => void workspace.setWholeRunExecutionIntent('local')}
        onFinishCurrentSegment={() => void finishCurrentSegment()}
        onUseOriginalClassifications={() => void workspace.useOriginalClassificationsForFailedDeepSeek()}
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
