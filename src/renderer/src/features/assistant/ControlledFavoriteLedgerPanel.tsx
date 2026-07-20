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
  onOpenFavoritePage?: () => Promise<unknown> | void
  deepSeekArchiveAvailable?: boolean
}

function normalizeAccountMid(value: string | undefined) {
  if (!value || !/^\d+$/.test(value.trim()) || BigInt(value.trim()) === 0n) return null
  return BigInt(value.trim()).toString()
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
  onOpenFavoritePage,
  deepSeekArchiveAvailable = false
}: ControlledFavoriteLedgerPanelProps) {
  const workspace = useOldFavoriteWorkspace(currentAccountMid)
  const [step, setStep] = useState<OldFavoriteGuideStep>('scan')
  const [guideOpen, setGuideOpen] = useState(false)
  const [fullReorganizationConfirmOpen, setFullReorganizationConfirmOpen] = useState(false)
  const [fullReorganizationAccountMid, setFullReorganizationAccountMid] = useState<string | null>(null)
  const [scanStarting, setScanStarting] = useState(false)
  const [scanStartFailure, setScanStartFailure] = useState<string | null>(null)
  const scanPresentationRequestVersion = useRef(0)
  const scanStartingRef = useRef(false)
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
    setGuideOpen(false)
    setStep('scan')
    setFullReorganizationConfirmOpen(false)
    setFullReorganizationAccountMid(null)
    setScanStarting(false)
    setScanStartFailure(null)
  }, [currentAccountMid])

  useEffect(() => {
    if (!snapshot || scanStartingRef.current) return
    setGuideOpen(true)
    setStep((currentStep) => {
      if (snapshot.status === 'scanning' || recovery) return 'scan'
      if (snapshot.status !== 'previewing') return 'confirm'
      if (currentStep === 'scan') return 'preview'
      return currentStep
    })
  }, [recovery, scanStarting, snapshot?.accountMid, snapshot?.status])

  const startScan = async (mode: 'incremental' | 'full') => {
    if (scanStarting) return
    if (mode === 'incremental' && snapshot && !recovery && snapshot.scan.phase !== 'failed' && snapshot.status !== 'completed') {
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
      if (!await workspace.startScan(mode) && scanPresentationRequestVersion.current === requestVersion && activeAccountMid.current === requestedAccountMid) {
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

  return (
    <section role="dialog" aria-label="掌库" className="favorite-ledger-panel">
      <div className="favorite-ledger-panel__topbar">
        <div className="favorite-ledger-panel__header"><h2 className="sr-only">掌库</h2></div>
        <div className="favorite-ledger-panel__toolbar">
          <AssistantActionButton type="button" aria-label="备册" disabled={workspace.loading}
            onClick={() => void onEnsureLedgers()} icon={clickedPetUrl} iconAlt="小咪备册" badge="备"
            label="备册" description="一键生成 bilimi 收藏夹，用于归类收藏和整理" />
          <AssistantActionButton type="button" aria-label="整理旧藏" disabled={scanStarting || !currentAccountMid}
            onClick={() => void startScan('incremental')} icon={hintPetUrl} iconAlt="小咪整理旧藏" badge="整"
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
      />
      {guideOpen && snapshot && !recovery ? <div className="favorite-ledger-panel__guide-entry-actions">
        <button type="button" onClick={() => {
          setFullReorganizationAccountMid(normalizeAccountMid(currentAccountMid))
          setFullReorganizationConfirmOpen(true)
        }} disabled={workspace.loading}>全部重新整理</button>
      </div> : null}

      {fullReorganizationConfirmOpen ? <OldFavoriteModal title="确认全部重新整理？" danger confirmLabel="确认重置"
        onCancel={() => { setFullReorganizationConfirmOpen(false); setFullReorganizationAccountMid(null) }}
        onConfirm={() => {
          const canConfirm = canConfirmFullReorganization(fullReorganizationAccountMid, currentAccountMid)
          setFullReorganizationConfirmOpen(false)
          setFullReorganizationAccountMid(null)
          if (canConfirm) void startScan('full')
        }}>
        <p>这会解除既有保护并从头扫描；不会改写收藏库。</p>
      </OldFavoriteModal> : null}

      {guideOpen ? <OldFavoriteGuide
        snapshot={snapshot}
        loading={workspace.loading}
        scanStarting={scanStarting}
        scanStartFailure={scanStartFailure}
        step={step}
        onStepChange={setStep}
        onRetryScan={() => void startScan('incremental')}
        onRebuildWorkspace={() => void workspace.rebuildCorruptWorkspace()}
        onSelectSourceFolders={(folderIds) => void workspace.selectSourceFolders(folderIds)}
        onSetRecommendedCandidates={(candidateIds) => void workspace.setRecommendedCandidates(candidateIds)}

        ledgers={ledgers}
        deepSeekAvailable={deepSeekArchiveAvailable}
        onSelectSegment={(segmentId) => void workspace.selectSegment(segmentId)}
        onAutoClassify={() => void workspace.autoClassifyCurrentSegment()}
        onOrganizeWithDeepSeek={() => void workspace.organizeCurrentSegmentWithDeepSeek()}
        onUndoClassification={() => void workspace.undoClassification()}
        onRedoClassification={() => void workspace.redoClassification()}
        onApplyManualClassification={(aid, targetLedgerIds) => void workspace.applyManualClassifications([{ aid, targetLedgerIds }])}
        onCreateLocalLedgerAndReclassify={(title) => void workspace.createLocalLedgerAndReclassify(title)}
        onSaveLocally={() => void workspace.saveCurrentSegmentLocally()}
        onConfirmAndSync={() => void workspace.confirmAndExecuteBilibiliPlan()}
        onExecuteFrozenPlan={() => void workspace.executeFrozenBilibiliPlan()}
        onReconcile={() => void workspace.reconcileFrozenBilibiliPlan()}
      /> : null}
    </section>
  )
}
