import type { FavoriteLedger, FavoriteLedgerSaveOptions } from '@shared/types'
import type { OldFavoriteWorkspaceRecoverySummary, OldFavoriteWorkspaceSnapshot } from '@shared/oldFavoriteWorkspace'
import { stripBilimiLedgerPrefix } from '@shared/favoriteLedgers'
import { parseFavoriteLedgerRules } from '@shared/favoriteLedgerConstraints'
import { useEffect, useRef, useState } from 'react'
import clickedPetUrl from '../../assets/pet/blue-white-maid/character/big-head/clicked.png'
import hintPetUrl from '../../assets/pet/blue-white-maid/character/big-head/hint.png'
import idlePetUrl from '../../assets/pet/blue-white-maid/character/big-head/idle.png'
import { AssistantActionButton } from './AssistantActionButton'
import { FavoriteLedgerOverview } from './FavoriteLedgerOverview'
import { FavoriteLibraryEntry } from './FavoriteLibraryEntry'
import { OldFavoriteGuide, type OldFavoriteGuideStep } from './OldFavoriteGuide'
import { OldFavoriteModal } from './OldFavoriteModal'
import { useOldFavoriteWorkspace } from './useOldFavoriteWorkspace'

type ControlledFavoriteLedgerPanelProps = {
  currentAccountMid?: string
  ledgers: FavoriteLedger[]
  missingLedgerIds: string[]
  defaultFavoriteSystemEnabled?: boolean
  onEnsureLedgers: () => Promise<unknown>
  onSaveLedgers: (ledgers: FavoriteLedger[], options?: FavoriteLedgerSaveOptions) => Promise<unknown> | void
  onSaveLedgerEnabled?: (ledgerId: string, enabled: boolean) => Promise<unknown> | void
  onSyncLedgers?: (ledgers: FavoriteLedger[], options?: FavoriteLedgerSaveOptions) => Promise<unknown> | void
  onOpenFavoritePage?: () => Promise<unknown> | void
  onRefreshOrganizationState?: () => Promise<unknown> | void
  onOrganizationSnapshotChange?: (snapshot: OldFavoriteWorkspaceSnapshot | null) => void
  deepSeekArchiveAvailable?: boolean
  openLedgerId?: string
  openLedgerRequestVersion?: number
  createLedger?: boolean
  createLedgerRequestVersion?: number
  openOrganizationRequestVersion?: number
}

function normalizeAccountMid(value: string | undefined) {
  if (!value || !/^\d+$/.test(value.trim()) || BigInt(value.trim()) === 0n) return null
  return BigInt(value.trim()).toString()
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
        keywords: [],
        ruleType: candidate.kind === 'author' ? 'author' as const : candidate.kind === 'tag' ? 'tag' as const : 'keyword' as const,
        enabled: true,
        priority: 10_000 + index,
        syncState: 'local-draft' as const,
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
  defaultFavoriteSystemEnabled,
  onEnsureLedgers,
  onSaveLedgers,
  onSaveLedgerEnabled,
  onSyncLedgers,
  onOpenFavoritePage,
  onRefreshOrganizationState,
  onOrganizationSnapshotChange,
  deepSeekArchiveAvailable = false,
  openLedgerId,
  openLedgerRequestVersion,
  createLedger,
  createLedgerRequestVersion,
  openOrganizationRequestVersion
}: ControlledFavoriteLedgerPanelProps) {
  const workspace = useOldFavoriteWorkspace(currentAccountMid)
  const [step, setStep] = useState<OldFavoriteGuideStep>('scan')
  const [guideOpen, setGuideOpen] = useState(false)
  const [resumeDialogOpen, setResumeDialogOpen] = useState(false)
  const [recoverySummary, setRecoverySummary] = useState<OldFavoriteWorkspaceRecoverySummary | null>(null)
  const [fullReorganizationConfirmOpen, setFullReorganizationConfirmOpen] = useState(false)
  const [fullReorganizationAccountMid, setFullReorganizationAccountMid] = useState<string | null>(null)
  const [scanStarting, setScanStarting] = useState(false)
  const [scanStartFailure, setScanStartFailure] = useState<string | null>(null)
  const [confirmationPreparing, setConfirmationPreparing] = useState(false)
  const [confirmationPreparationStatus, setConfirmationPreparationStatus] = useState<string | null>(null)
  const [confirmationPreparationError, setConfirmationPreparationError] = useState<string | null>(null)
  const [managedDeletionCandidates, setManagedDeletionCandidates] = useState<Array<{ logicalLedgerId: string; remoteFolderId: string; title: string; memberCount: number }> | null>(null)
  const [managedDeletionReviewOpen, setManagedDeletionReviewOpen] = useState(false)
  const [managedDeletionConfirmed, setManagedDeletionConfirmed] = useState(false)
  const scanPresentationRequestVersion = useRef(0)
  const scanStartingRef = useRef(false)
  const previousWorkspaceStatusRef = useRef<string | null>(null)
  const activeAccountMid = useRef(currentAccountMid)
  activeAccountMid.current = currentAccountMid
  const snapshot = workspace.snapshot &&
    normalizeAccountMid(workspace.snapshot.accountMid) === normalizeAccountMid(currentAccountMid)
    ? workspace.snapshot
    : null
  const recovery = snapshot && 'recovery' in snapshot ? snapshot : null
  useEffect(() => {
    scanPresentationRequestVersion.current += 1
    scanStartingRef.current = false
    previousWorkspaceStatusRef.current = null
    setGuideOpen(false)
    setResumeDialogOpen(false)
    setRecoverySummary(null)
    setStep('scan')
    setFullReorganizationConfirmOpen(false)
    setFullReorganizationAccountMid(null)
    setScanStarting(false)
    setScanStartFailure(null)
    setConfirmationPreparing(false)
    setConfirmationPreparationStatus(null)
    setConfirmationPreparationError(null)
  }, [currentAccountMid])

  useEffect(() => {
    onOrganizationSnapshotChange?.(snapshot && !recovery ? snapshot : null)
  }, [onOrganizationSnapshotChange, recovery, snapshot])

  useEffect(() => {
    if (!openOrganizationRequestVersion) return
    setGuideOpen(true)
    setStep('scan')
    setScanStartFailure(null)
  }, [openOrganizationRequestVersion])

  useEffect(() => {
    if (!snapshot || scanStartingRef.current) return
    const previousStatus = previousWorkspaceStatusRef.current
    previousWorkspaceStatusRef.current = snapshot.status
    setGuideOpen(true)
    setStep((currentStep) => {
      if (snapshot.status === 'scanning' || recovery) return 'scan'
      if (snapshot.status !== 'previewing') return 'confirm'
      if (previousStatus === null) return 'preview'
      return currentStep
    })
  }, [recovery, scanStarting, snapshot?.accountMid, snapshot?.status])

  const startScan = async (mode: 'incremental' | 'full', options?: { clearBilibiliMirror?: boolean }) => {
    if (scanStarting) return
    if (mode === 'incremental' && snapshot && !recovery && snapshot.scan.phase !== 'failed' &&
      snapshot.status !== 'completed' && snapshot.status !== 'scanning') {
      setGuideOpen(true)
      setStep(snapshot.status === 'scanning' ? 'scan' : snapshot.status === 'previewing' ? 'preview' : 'confirm')
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
        setScanStartFailure(workspace.lastError ?? '扫描启动失败，请重新扫描。')
      }
    } catch (error) {
      if (scanPresentationRequestVersion.current === requestVersion && activeAccountMid.current === requestedAccountMid) {
        setScanStartFailure(error instanceof Error ? error.message : '扫描启动失败，请重新扫描。')
      }
    } finally {
      if (scanPresentationRequestVersion.current === requestVersion && activeAccountMid.current === requestedAccountMid) {
        scanStartingRef.current = false
        setScanStarting(false)
      }
    }
  }

  const requestOldFavoriteOrganization = async () => {
    setGuideOpen(true)
    setStep('scan')
    setScanStartFailure(null)
    const summary = await workspace.getRecoverySummary()
    if (summary && summary.recoveryChoices.some((choice) => choice !== 'view')) {
      setRecoverySummary(summary)
      setResumeDialogOpen(true)
      return
    }
    const authoritativeSnapshot = snapshot || await workspace.refresh()
    if (authoritativeSnapshot && !('recovery' in authoritativeSnapshot) &&
      authoritativeSnapshot.status !== 'scanning' && authoritativeSnapshot.status !== 'completed') {
      setResumeDialogOpen(true)
      return
    }
    if (authoritativeSnapshot && !('recovery' in authoritativeSnapshot) &&
      authoritativeSnapshot.status === 'scanning' && authoritativeSnapshot.scan.phase !== 'failed') {
      void workspace.resumeScan()
      return
    }
    void startScan('incremental')
  }
  const selectRecoveryDecision = async (choice: 'continue-original' | 'merge-latest' | 'rescan') => {
    if (!recoverySummary) return
    const result = await workspace.sendRecoveryDecision?.(recoverySummary, choice)
    if (!result) return
    setRecoverySummary(null)
    setResumeDialogOpen(false)
    if (choice === 'rescan') void startScan('incremental')
    else {
      setGuideOpen(true)
      if (!('recovery' in result) && result.status === 'scanning' && result.scan.phase !== 'failed') {
        void workspace.resumeScan()
        return
      }
      await workspace.refresh()
    }
  }
  const retryScanWithDirectSession = async () => {
    await window.bilimiDesktop?.retryBilibiliSessionDirect?.()
    await startScan('incremental')
  }
  const continueConfirmAndSync = async () => {
    if (!snapshot || recovery) return
    try {
      if (confirmationNeedsBackup(snapshot, ledgers, missingLedgerIds)) {
        setConfirmationPreparationStatus('正在同步目标收藏夹，完成后会继续同步到 B 站。')
        const result = await onEnsureLedgers() as { ok?: boolean; message?: string } | undefined
        if (result?.ok === false) {
          setConfirmationPreparationError(result.message || '收藏夹同步失败，请重试。')
          return
        }
      }
      await workspace.confirmAndExecuteBilibiliPlan()
    } catch (error) {
      setConfirmationPreparationError(error instanceof Error ? error.message : '收藏夹同步失败，请重试。')
    } finally {
      setConfirmationPreparing(false)
      setConfirmationPreparationStatus(null)
    }
  }
  const confirmAndSync = async () => {
    if (!snapshot || recovery || confirmationPreparing) return
    setConfirmationPreparationError(null)
    setConfirmationPreparing(true)
    const disabledLedgerIds = ledgers.filter((ledger) => !ledger.enabled).map((ledger) => ledger.id)
    try {
      const candidates = currentAccountMid && disabledLedgerIds.length
        ? await window.bilimiDesktop?.previewManagedFavoriteFolderDeletion?.(currentAccountMid, disabledLedgerIds)
        : []
      if (candidates?.length) {
        setManagedDeletionCandidates(candidates)
        setConfirmationPreparing(false)
        return
      }
      await continueConfirmAndSync()
    } catch (error) {
      setConfirmationPreparationError(error instanceof Error ? error.message : '收藏夹同步失败，请重试。')
      setConfirmationPreparing(false)
    }
  }
  const confirmManagedDeletionAndSync = async () => {
    if (!currentAccountMid || !managedDeletionCandidates || !managedDeletionConfirmed) return
    setConfirmationPreparing(true)
    try {
      await window.bilimiDesktop?.deleteManagedFavoriteFolders?.(currentAccountMid, managedDeletionCandidates.map((candidate) => candidate.logicalLedgerId))
      setManagedDeletionCandidates(null)
      setManagedDeletionReviewOpen(false)
      setManagedDeletionConfirmed(false)
      await continueConfirmAndSync()
    } catch (error) {
      setConfirmationPreparationError(error instanceof Error ? error.message : '收藏夹删除失败，请重试。')
    } finally {
      setConfirmationPreparing(false)
    }
  }
  const reconcile = async () => {
    try {
      await workspace.reconcileFrozenBilibiliPlan()
    } finally {
      await onRefreshOrganizationState?.()
    }
  }
  const closeGuide = () => {
    setGuideOpen(false)
    setStep('scan')
    setScanStartFailure(null)
  }
  const abandonCurrentWorkspace = async () => {
    const result = await workspace.abandonCurrentWorkspace()
    if (!result) {
      setRecoverySummary(null)
      setResumeDialogOpen(false)
      closeGuide()
    }
  }
  const canRestartFromResume = snapshot !== null && !recovery && snapshot.status !== 'completed'
  const displayedLedgers = projectRecommendedLedgerDrafts(ledgers, workspace.snapshot, workspace.recommendedCandidateIds)

  return (
    <section role="dialog" aria-label="掌库" className="favorite-ledger-panel">
      <div className="favorite-ledger-panel__topbar">
        <div className="favorite-ledger-panel__header"><h2 className="sr-only">掌库</h2></div>
        <div className="favorite-ledger-panel__toolbar">
          <AssistantActionButton type="button" aria-label="备册" disabled={workspace.loading || defaultFavoriteSystemEnabled === false}
            onClick={() => void onEnsureLedgers().then((result) => {
              if ((result as { ok?: boolean } | undefined)?.ok !== false) return onOpenFavoritePage?.()
            })} icon={clickedPetUrl} iconAlt="小咪备册" badge="备"
            label="备册" description="一键生成 bilimi 收藏夹，用于归类收藏和整理" />
          <AssistantActionButton type="button" aria-label="整理收藏" disabled={scanStarting || !currentAccountMid}
            onClick={() => void requestOldFavoriteOrganization()} icon={hintPetUrl} iconAlt="小咪整理收藏" badge="整"
            label="整理收藏" description="扫描已有收藏，确认后整理到 bilimi 收藏夹里" />
          <AssistantActionButton type="button" aria-label="收藏库"
            onClick={() => void window.bilimiDesktop?.openFavoriteLibrary?.()} icon={idlePetUrl} iconAlt="小咪收藏库" badge="库"
            label="收藏库" description="在独立窗口浏览收藏库" />
        </div>
      </div>

      <FavoriteLedgerOverview
        key={normalizeAccountMid(currentAccountMid) ?? 'no-account'}
        ledgers={displayedLedgers}
        missingLedgerIds={missingLedgerIds}
        organizationActive={Boolean(snapshot && !recovery && snapshot.status !== 'completed')}
        hasExpandedOrganizationGuide={guideOpen}
        defaultFavoriteSystemEnabled={defaultFavoriteSystemEnabled}
        openLedgerId={openLedgerId}
        openLedgerRequestVersion={openLedgerRequestVersion}
        createLedger={createLedger}
        createLedgerRequestVersion={createLedgerRequestVersion}
        onSaveLedgers={onSaveLedgers}
        onSaveLedgerEnabled={onSaveLedgerEnabled}
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
      {managedDeletionCandidates && !managedDeletionReviewOpen ? <OldFavoriteModal title="同步变更说明" confirmLabel="继续" onCancel={() => setManagedDeletionCandidates(null)} onConfirm={() => setManagedDeletionReviewOpen(true)}>
        <p>本次同步有 {managedDeletionCandidates.length} 个 bilimi 管理的收藏夹需要删除。</p>
        <p>请先确认变更内容；继续后需要进行危险操作确认。</p>
      </OldFavoriteModal> : null}
      {managedDeletionCandidates && managedDeletionReviewOpen ? <OldFavoriteModal danger title="删除 bilimi 收藏夹" confirmLabel="删除并同步" confirmDisabled={!managedDeletionConfirmed || confirmationPreparing} onCancel={() => { setManagedDeletionCandidates(null); setManagedDeletionReviewOpen(false); setManagedDeletionConfirmed(false) }} onConfirm={() => void confirmManagedDeletionAndSync()}>
        <ul>{managedDeletionCandidates.map((candidate) => <li key={candidate.remoteFolderId}>{candidate.title}（当前 {candidate.memberCount} 个视频）</li>)}</ul>
        <p>请确认这些 bilimi 收藏夹中没有需要保留的重要视频。删除收藏夹不会删除 B 站视频，但会移除这些收藏关系。</p>
        <label><input type="checkbox" checked={managedDeletionConfirmed} onChange={(event) => setManagedDeletionConfirmed(event.currentTarget.checked)} />我已确认</label>
      </OldFavoriteModal> : null}
      {resumeDialogOpen && recoverySummary ? <OldFavoriteModal title="整理收藏"
        onCancel={() => { setRecoverySummary(null); setResumeDialogOpen(false); closeGuide() }}
        extraActions={<>
          {recoverySummary.recoveryChoices.includes('continue-original') ? <button type="button" onClick={() => void selectRecoveryDecision('continue-original')}>按原草稿继续</button> : null}
          {recoverySummary.recoveryChoices.includes('merge-latest') ? <button type="button" onClick={() => void selectRecoveryDecision('merge-latest')}>合并最新变化</button> : null}
          {recoverySummary.recoveryChoices.includes('rescan') ? <button type="button" onClick={() => void selectRecoveryDecision('rescan')}>重新扫描</button> : null}
          {recoverySummary.recoveryChoices.includes('abandon') ? <button type="button" onClick={() => void abandonCurrentWorkspace()}>放弃本轮整理</button> : null}
          {recoverySummary.recoveryChoices.includes('reconcile-result-unknown') ? <button type="button" onClick={() => { setRecoverySummary(null); setResumeDialogOpen(false); setGuideOpen(true); setStep('confirm') }}>查看并对账</button> : null}
        </>}>
        <p>检测到未完成的整理草稿</p>
        <p>本轮计划 {recoverySummary.plannedCount ?? 0}，已分类 {recoverySummary.classifiedCount ?? 0}，未匹配 {recoverySummary.unclassifiedCount ?? 0}。</p>
        {recoverySummary.baselineChangeEvidence.changed ? <p>检测到草稿后的资料、B站位置或收藏夹绑定变化；人工分类会保留。</p> : null}
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
        mutationLocked={Boolean(workspace.draftRuleAnalysis)}
        reconciling={workspace.reconciling}
        preparationStatus={confirmationPreparationStatus}
        executionError={confirmationPreparationError ?? workspace.executionError}
        scanStarting={scanStarting}
        scanStartFailure={scanStartFailure}
        step={step}
        onStepChange={(nextStep) => {
          setStep(nextStep)
        }}
        onRetryScan={() => void startScan('incremental')}
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

        ledgers={ledgers}
        deepSeekAvailable={deepSeekArchiveAvailable}
        deepSeekFeedback={workspace.deepSeekFeedback}
        onSelectSegment={(segmentId) => void workspace.selectSegment(segmentId)}
        onAutoClassify={() => void workspace.autoClassifyCurrentSegment()}
        onOrganizeWithDeepSeek={(mode) => void workspace.organizeCurrentSegmentWithDeepSeek(mode)}
        onRetryFailedDeepSeekChunks={() => void workspace.retryFailedDeepSeekChunks()}
        onCancelDeepSeek={() => void workspace.cancelCurrentSegmentDeepSeek()}
        deepSeekCancelRequested={workspace.deepSeekCancelRequested}
        onUndoClassification={() => void workspace.undoClassification()}
        onRedoClassification={() => void workspace.redoClassification()}
        onMoveHistoryCursor={(cursor) => void workspace.moveHistoryCursor(cursor)}
        onApplyManualClassification={(aid, targetLedgerIds) => void workspace.applyManualClassifications([{ aid, targetLedgerIds }])}
        onApplyManualClassifications={(assignments) => void workspace.applyManualClassifications(assignments)}
        onSaveLocally={() => void workspace.saveCurrentSegmentLocally()}
        onAbandonCurrentWorkspace={() => void abandonCurrentWorkspace()}
        onAcknowledgeCompletion={closeGuide}
        onConfirmAndSync={() => void confirmAndSync()}
        onExecuteFrozenPlan={() => void workspace.executeFrozenBilibiliPlan()}
        onReconcile={() => void reconcile()}
      /> : null}
    </section>
  )
}
