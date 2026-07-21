import type { FavoriteLedger, FavoriteLedgerSaveOptions } from '@shared/types'
import { useEffect, useRef, useState } from 'react'
import clickedPetUrl from '../../assets/pet/blue-white-maid/character/big-head/clicked.png'
import hintPetUrl from '../../assets/pet/blue-white-maid/character/big-head/hint.png'
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
  onEnsureLedgers: () => Promise<unknown>
  onSaveLedgers: (ledgers: FavoriteLedger[], options?: FavoriteLedgerSaveOptions) => Promise<unknown> | void
  onSyncLedgers?: (ledgers: FavoriteLedger[], options?: FavoriteLedgerSaveOptions) => Promise<unknown> | void
  onOpenFavoritePage?: () => Promise<unknown> | void
  deepSeekArchiveAvailable?: boolean
}

function normalizeAccountMid(value: string | undefined) {
  if (!value || !/^\d+$/.test(value.trim()) || BigInt(value.trim()) === 0n) return null
  return BigInt(value.trim()).toString()
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
  onEnsureLedgers,
  onSaveLedgers,
  onSyncLedgers,
  onOpenFavoritePage,
  deepSeekArchiveAvailable = false
}: ControlledFavoriteLedgerPanelProps) {
  const workspace = useOldFavoriteWorkspace(currentAccountMid)
  const [step, setStep] = useState<OldFavoriteGuideStep>('scan')
  const [guideOpen, setGuideOpen] = useState(false)
  const [resumeDialogOpen, setResumeDialogOpen] = useState(false)
  const [fullReorganizationConfirmOpen, setFullReorganizationConfirmOpen] = useState(false)
  const [fullReorganizationAccountMid, setFullReorganizationAccountMid] = useState<string | null>(null)
  const [scanStarting, setScanStarting] = useState(false)
  const [scanStartFailure, setScanStartFailure] = useState<string | null>(null)
  const [confirmationPreparing, setConfirmationPreparing] = useState(false)
  const [confirmationPreparationError, setConfirmationPreparationError] = useState<string | null>(null)
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
    setStep('scan')
    setFullReorganizationConfirmOpen(false)
    setFullReorganizationAccountMid(null)
    setScanStarting(false)
    setScanStartFailure(null)
    setConfirmationPreparing(false)
    setConfirmationPreparationError(null)
  }, [currentAccountMid])

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
    const authoritativeSnapshot = snapshot || await workspace.refresh()
    if (authoritativeSnapshot && !('recovery' in authoritativeSnapshot) &&
      authoritativeSnapshot.status !== 'scanning' && authoritativeSnapshot.status !== 'completed') {
      setResumeDialogOpen(true)
      return
    }
    void startScan('incremental')
  }
  const retryScanWithDirectSession = async () => {
    await window.bilimiDesktop?.retryBilibiliSessionDirect?.()
    await startScan('incremental')
  }
  const confirmAndSync = async () => {
    if (!snapshot || recovery || confirmationPreparing) return
    setConfirmationPreparationError(null)
    setConfirmationPreparing(true)
    try {
      if (confirmationNeedsBackup(snapshot, ledgers, missingLedgerIds)) {
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
    }
  }
  const canRestartFromResume = snapshot !== null && !recovery && snapshot.status !== 'completed'

  return (
    <section role="dialog" aria-label="掌库" className="favorite-ledger-panel">
      <div className="favorite-ledger-panel__topbar">
        <div className="favorite-ledger-panel__header"><h2 className="sr-only">掌库</h2></div>
        <div className="favorite-ledger-panel__toolbar">
          <AssistantActionButton type="button" aria-label="备册" disabled={workspace.loading}
            onClick={() => void onEnsureLedgers().then((result) => {
              if ((result as { ok?: boolean } | undefined)?.ok !== false) return onOpenFavoritePage?.()
            })} icon={clickedPetUrl} iconAlt="小咪备册" badge="备"
            label="备册" description="一键生成 bilimi 收藏夹，用于归类收藏和整理" />
          <AssistantActionButton type="button" aria-label="整理旧藏" disabled={scanStarting || !currentAccountMid}
            onClick={() => void requestOldFavoriteOrganization()} icon={hintPetUrl} iconAlt="小咪整理旧藏" badge="整"
            label="整理旧藏" description="扫描旧藏，确认后整理到 bilimi 收藏夹里" />
          <AssistantActionButton type="button" aria-label="收藏库"
            onClick={() => void window.bilimiDesktop?.openFavoriteLibrary?.()} icon={clickedPetUrl} iconAlt="小咪收藏库" badge="库"
            label="收藏库" description="在独立窗口浏览收藏库" />
        </div>
      </div>

      <FavoriteLedgerOverview
        ledgers={ledgers}
        missingLedgerIds={missingLedgerIds}
        onSaveLedgers={onSaveLedgers}
        onSyncLedgers={onSyncLedgers}
      />
      {resumeDialogOpen ? <OldFavoriteModal title="整理旧藏"
        onCancel={() => setResumeDialogOpen(false)}
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
        onCancel={() => { setFullReorganizationConfirmOpen(false); setFullReorganizationAccountMid(null) }}
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
        executionError={confirmationPreparationError ?? workspace.executionError}
        scanStarting={scanStarting}
        scanStartFailure={scanStartFailure}
        step={step}
        onStepChange={setStep}
        onRetryScan={() => void startScan('incremental')}
        onRetryScanDirect={() => void retryScanWithDirectSession()}
        onRebuildWorkspace={() => void workspace.rebuildCorruptWorkspace()}
        onSelectSourceFolders={(folderIds) => void workspace.selectSourceFolders(folderIds)}
        onPauseTagEnrichment={() => void workspace.pauseTagEnrichment()}
        onResumeTagEnrichment={() => void workspace.resumeTagEnrichment()}
        onAcceptCurrentTags={() => void workspace.acceptCurrentTags()}
        onSetRecommendedCandidates={(candidateIds) => void workspace.setRecommendedCandidates(candidateIds)}

        ledgers={ledgers}
        deepSeekAvailable={deepSeekArchiveAvailable}
        deepSeekFeedback={workspace.deepSeekFeedback}
        onSelectSegment={(segmentId) => void workspace.selectSegment(segmentId)}
        onAutoClassify={() => void workspace.autoClassifyCurrentSegment()}
        onOrganizeWithDeepSeek={(mode) => void workspace.organizeCurrentSegmentWithDeepSeek(mode)}
        onRetryFailedDeepSeekChunks={() => void workspace.retryFailedDeepSeekChunks()}
        onUndoClassification={() => void workspace.undoClassification()}
        onRedoClassification={() => void workspace.redoClassification()}
        onMoveHistoryCursor={(cursor) => void workspace.moveHistoryCursor(cursor)}
        onApplyManualClassification={(aid, targetLedgerIds) => void workspace.applyManualClassifications([{ aid, targetLedgerIds }])}
        onApplyManualClassifications={(assignments) => void workspace.applyManualClassifications(assignments)}
        onCreateLocalLedgerAndReclassify={(title) => void workspace.createLocalLedgerAndReclassify(title)}
        onSaveLocally={() => void workspace.saveCurrentSegmentLocally()}
        onConfirmAndSync={() => void confirmAndSync()}
        onExecuteFrozenPlan={() => void workspace.executeFrozenBilibiliPlan()}
        onReconcile={() => void workspace.reconcileFrozenBilibiliPlan()}
      /> : null}
    </section>
  )
}
