import type { FavoriteLedger, FavoriteLedgerSaveOptions } from '@shared/types'
import type { OldFavoriteWorkspaceRecoverySummary, OldFavoriteWorkspaceSnapshot } from '@shared/oldFavoriteWorkspace'
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

function projectRecommendedLedgerDrafts(
  ledgers: FavoriteLedger[],
  snapshot: ReturnType<typeof useOldFavoriteWorkspace>['snapshot'],
  candidateIds: string[]
) {
  if (!snapshot || 'recovery' in snapshot || !snapshot.recommendations?.candidates) return ledgers
  const selectedIds = new Set(candidateIds)
  const recommendationIds = new Set(snapshot.recommendations.candidates.map((candidate) => candidate.id))
  const projectedLedgers = ledgers.filter((ledger) =>
    !recommendationIds.has(ledger.id) || ledger.syncState !== 'local-draft' || selectedIds.has(ledger.id))
  const existingIds = new Set(projectedLedgers.map((ledger) => ledger.id))
  return [
    ...projectedLedgers,
    ...snapshot.recommendations.candidates
      .filter((candidate) => selectedIds.has(candidate.id) && !existingIds.has(candidate.id))
      .map((candidate, index) => ({
        id: candidate.id,
        displayName: candidate.displayName,
        keywords: [...(candidate.keywords ?? [])],
        ruleType: candidate.kind === 'author' ? 'author' as const : candidate.kind === 'tag' ? 'tag' as const : 'keyword' as const,
        enabled: true,
        priority: 10_000 + index,
        isDefault: false
      }))
  ]
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

export function canConfirmFullReorganization(openedForAccountMid: string | null, currentAccountMid: string | undefined) {
  return openedForAccountMid !== null && openedForAccountMid === normalizeAccountMid(currentAccountMid)
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
  const [ledgerEnabledById, setLedgerEnabledById] = useState<ReadonlyMap<string, boolean>>(() =>
    new Map(ledgers.map((ledger) => [ledger.id, ledger.enabled])))
  const accountKey = normalizeAccountMid(currentAccountMid)
  const [enabledStateAccountKey, setEnabledStateAccountKey] = useState(accountKey)
  const effectiveLedgerEnabledById = enabledStateAccountKey === accountKey
    ? ledgerEnabledById
    : new Map(ledgers.map((ledger) => [ledger.id, ledger.enabled]))
  useEffect(() => {
    if (enabledStateAccountKey === accountKey) return
    setLedgerEnabledById(new Map(ledgers.map((ledger) => [ledger.id, ledger.enabled])))
    setEnabledStateAccountKey(accountKey)
  }, [accountKey, enabledStateAccountKey, ledgers])
  const handleEnabledStateChange = useCallback((next: ReadonlyMap<string, boolean>) => {
    setLedgerEnabledById(new Map(next))
  }, [])
  const handleDeleteLedger = useCallback((ledgerId: string) => {
    if (workspace.recommendedCandidateIds.includes(ledgerId)) {
      workspace.updateRecommendedCandidates((current) => current.filter((id) => id !== ledgerId))
    }
  }, [workspace.recommendedCandidateIds, workspace.updateRecommendedCandidates])
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
  const [recoveryDecisionPending, setRecoveryDecisionPending] = useState<'continue-original' | 'merge-latest' | 'rescan' | 'reconcile-result-unknown' | null>(null)
  const [recoveryDecisionError, setRecoveryDecisionError] = useState<string | null>(null)
  const [fullReorganizationConfirmOpen, setFullReorganizationConfirmOpen] = useState(false)
  const [fullReorganizationAccountMid, setFullReorganizationAccountMid] = useState<string | null>(null)
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
    setRecoveryDecisionPending(null)
    setRecoveryDecisionError(null)
    setStep('scan')
    setFullReorganizationConfirmOpen(false)
    setFullReorganizationAccountMid(null)
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

  useEffect(() => {
    if (!snapshot || scanStartingRef.current) return
    if (!('recovery' in snapshot) && dismissedGuideWorkspaceIdRef.current === snapshot.workspaceId) return
    setGuideOpen(true)
    setStep((currentStep) => {
      if ('recovery' in snapshot) return 'scan'
      if (snapshot.status === 'scanning') return 'scan'
      if (snapshot.executionIntent) return 'confirm'
      if (snapshot.status !== 'previewing') return 'confirm'
      return currentStep
    })
  }, [recovery, scanStarting, snapshot?.accountMid, snapshotStatus, activeSnapshot?.executionIntent])

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
    setGuideOpen(true)
    setStep('scan')
    setScanStartFailure(null)
    setRecoveryDecisionError(null)
    const summary = await workspace.getRecoverySummary()
    if (!isCurrentRequest()) return
    if (summary && summary.recoveryChoices.some((choice) => choice !== 'view')) {
      setRecoverySummary(summary)
      setResumeDialogOpen(true)
      return
    }
    const authoritativeSnapshot = snapshot || await workspace.refresh()
    if (!isCurrentRequest()) return
    if (authoritativeSnapshot && !('recovery' in authoritativeSnapshot) &&
      authoritativeSnapshot.status !== 'scanning' && authoritativeSnapshot.status !== 'completed') {
      setResumeDialogOpen(true)
      return
    }
    if (authoritativeSnapshot && !('recovery' in authoritativeSnapshot) &&
      authoritativeSnapshot.status === 'scanning') {
      return
    }
    void startScan('incremental')
  }
  const selectRecoveryDecision = async (choice: 'continue-original' | 'merge-latest' | 'rescan') => {
    if (!recoverySummary || recoveryDecisionPending) return
    const requestedAccountMid = currentAccountMid
    const requestVersion = ++recoveryDecisionRequestVersion.current
    const isCurrentRequest = () => recoveryDecisionRequestVersion.current === requestVersion &&
      activeAccountMid.current === requestedAccountMid
    setRecoveryDecisionPending(choice)
    setRecoveryDecisionError(null)
    try {
      const result = await workspace.sendRecoveryDecision?.(recoverySummary, choice)
      if (!isCurrentRequest()) return
      if (!result) {
        setRecoveryDecisionError('恢复整理草稿失败，请重试。')
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
        setRecoveryDecisionError('恢复整理草稿失败，请重试。')
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
  const acknowledgeCompletion = () => {
    if (snapshot && !('recovery' in snapshot) && snapshot.status === 'completed') {
      onAcknowledgeOrganizationCompletion?.(snapshot.accountMid, snapshot.workspaceId)
    }
    closeGuide()
  }
  const abandonCurrentWorkspace = async () => {
    const result = await workspace.abandonCurrentWorkspace()
    if (!result) {
      setRecoverySummary(null)
      setResumeDialogOpen(false)
      closeGuide()
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
  const displayedLedgers = projectRecommendedLedgerDrafts(ledgers, workspace.snapshot, workspace.recommendedCandidateIds)
  const displayedLedgersWithLiveEnabled = displayedLedgers.map((ledger) => ({
    ...ledger,
    enabled: effectiveLedgerEnabledById.get(ledger.id) ?? ledger.enabled
  }))
  const enabledLedgerIds = new Set(displayedLedgersWithLiveEnabled
    .filter((ledger) => ledger.enabled)
    .map((ledger) => ledger.id))

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
          <AssistantActionButton type="button" aria-label="备册" aria-busy={ensuringLedgers} disabled={workspace.loading || ensuringLedgers || defaultFavoriteSystemEnabled === false}
            onClick={() => void ensureLedgersAndOpenFavoritePage()} icon={clickedPetUrl} iconAlt="小咪备册" badge="备"
            label={ensuringLedgers ? '备册中' : '备册'} description={ensuringLedgers ? '正在后台检查并生成 bilimi 收藏夹' : '一键生成 bilimi 收藏夹，用于归类收藏和整理'} />
          <AssistantActionButton type="button" aria-label="整理收藏" disabled={scanStarting || !currentAccountMid}
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
        ledgers={displayedLedgersWithLiveEnabled}
        missingLedgerIds={missingLedgerIds}
        unboundLedgerIds={unboundLedgerIds}
        remoteOnlyDraftLedgerIds={remoteOnlyDraftLedgerIds}
        onDismissRemoteDraftReminder={onDismissRemoteDraftReminder}
        organizationActive={Boolean(activeSnapshot && activeSnapshot.status !== 'completed')}
        hasExpandedOrganizationGuide={guideOpen}
        defaultFavoriteSystemEnabled={defaultFavoriteSystemEnabled}
        openLedgerId={openLedgerId}
        openLedgerRequestVersion={openLedgerRequestVersion}
        createLedger={createLedger}
        createLedgerRequestVersion={createLedgerRequestVersion}
        onSaveLedgers={onSaveLedgers}
        onSaveLedgerEnabled={onSaveLedgerEnabled}
        onEnabledStateChange={handleEnabledStateChange}
        onDeleteLedger={handleDeleteLedger}
        onSyncLedgers={onSyncLedgers}
        draftRuleAnalysis={workspace.draftRuleAnalysis}
        draftRuleAnalysisError={workspace.draftRuleAnalysisError}
        onCancelDraftRuleAnalysis={() => { void workspace.cancelDraftLedgerRuleAnalysis() }}
        onAnalyzeLedgerRule={async (ledger) => {
          const ruleType = ledger.ruleType ?? 'keyword'
          if (ruleType === 'deepseek') return true
          const rules = parseFavoriteLedgerRules(ledger)
          const result = await workspace.saveDraftLedgerRule({
            ledgerId: ledger.id,
            title: stripBilimiLedgerPrefix(ledger.displayName),
            keywords: rules.localKeywords,
            ruleType
          })
          return Boolean(result)
        }}
      />
      {resumeDialogOpen && recoverySummary ? <OldFavoriteModal title="整理收藏"
        onCancel={() => { if (recoveryDecisionPending) return; setRecoverySummary(null); setResumeDialogOpen(false); closeGuide() }}
        extraActions={<>
          {recoverySummary.recoveryChoices.includes('continue-original') ? <button type="button" disabled={Boolean(recoveryDecisionPending)} onClick={() => void selectRecoveryDecision('continue-original')}>按原草稿继续</button> : null}
          {recoverySummary.recoveryChoices.includes('merge-latest') ? <button type="button" disabled={Boolean(recoveryDecisionPending)} onClick={() => void selectRecoveryDecision('merge-latest')}>合并最新变化</button> : null}
          {recoverySummary.recoveryChoices.includes('rescan') ? <button type="button" disabled={Boolean(recoveryDecisionPending)} onClick={() => void selectRecoveryDecision('rescan')}>重新扫描</button> : null}
          {recoverySummary.recoveryChoices.includes('abandon') ? <button type="button" disabled={Boolean(recoveryDecisionPending)} onClick={() => void abandonCurrentWorkspace()}>放弃本轮整理</button> : null}
          {recoverySummary.recoveryChoices.includes('reconcile-result-unknown') ? <button type="button" disabled={Boolean(recoveryDecisionPending)} onClick={() => void openReconciliationDraft()}>查看并检查同步结果</button> : null}
        </>}>
        <p>检测到未完成的整理草稿</p>
        <p>本轮计划 {recoverySummary.plannedCount ?? 0}，已分类 {recoverySummary.classifiedCount ?? 0}；其余 {recoverySummary.unclassifiedCount ?? 0} 条包含未匹配和等待扫描，恢复后按批次继续。</p>
        {recoverySummary.baselineChangeEvidence.changed ? <p>检测到草稿后的资料、B站位置或收藏夹绑定变化；人工分类会保留。</p> : null}
        {recoveryDecisionPending ? <p role="status">正在恢复整理草稿…</p> : null}
        {recoveryDecisionError ? <p role="alert">{recoveryDecisionError}</p> : null}
      </OldFavoriteModal> : null}
      {resumeDialogOpen && !recoverySummary ? <OldFavoriteModal title="整理收藏"
        onCancel={() => { setResumeDialogOpen(false); closeGuide() }}
        extraActions={<>
          <button type="button" onClick={() => { setResumeDialogOpen(false); setGuideOpen(true) }}>继续上次整理</button>
          {canRestartFromResume ? <button type="button" onClick={() => {
            setResumeDialogOpen(false)
            setFullReorganizationAccountMid(normalizeAccountMid(currentAccountMid))
            setFullReorganizationConfirmOpen(true)
          }}>全部重新整理</button> : null}
        </>}>
        <p>检测到当前账号有未结束的整理存档，请选择接下来的操作。</p>
      </OldFavoriteModal> : null}
      {fullReorganizationConfirmOpen ? <OldFavoriteModal title="确认全部重新整理？" danger confirmLabel="确认重置"
        onCancel={() => { setFullReorganizationConfirmOpen(false); setFullReorganizationAccountMid(null); closeGuide() }}
        onConfirm={() => {
          const canConfirm = canConfirmFullReorganization(fullReorganizationAccountMid, currentAccountMid)
          setFullReorganizationConfirmOpen(false)
          setFullReorganizationAccountMid(null)
          if (canConfirm) void startScan('full')
        }}>
        <p>这会清空本地掌库、收藏库和本轮整理状态，再重新扫描 B 站当前收藏；不会撤销已提交到 B 站的操作。</p>
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
        onSetRecommendedCandidates={(candidateIds) => void workspace.setRecommendedCandidates(candidateIds)}
        onUpdateRecommendedCandidates={workspace.updateRecommendedCandidates}
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
        onCloseCurrentWorkspace={closeGuide}
        onAbandonCurrentWorkspace={() => void abandonCurrentWorkspace()}
        onAcknowledgeCompletion={acknowledgeCompletion}
        onConfirmAndSync={(includeInbox) => void confirmAndSync(includeInbox)}
        onExecuteFrozenPlan={() => void workspace.executeFrozenBilibiliPlan()}
        onStopSyncAndFinish={workspace.stopBilibiliSyncAndFinish}
        onReconcile={() => void reconcile()}
      /> : null}
    </section>
  )
}
