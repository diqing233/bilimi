import type { FavoriteLedger, FavoriteLedgerSaveOptions } from '@shared/types'
import { useEffect, useRef, useState } from 'react'
import { FavoriteLedgerOverview } from './FavoriteLedgerOverview'
import { FavoriteLibraryEntry } from './FavoriteLibraryEntry'
import { OldFavoriteGuide, type OldFavoriteGuideStep } from './OldFavoriteGuide'
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
  const [scanStarting, setScanStarting] = useState(false)
  const [scanStartFailed, setScanStartFailed] = useState(false)
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
    setScanStarting(false)
    setScanStartFailed(false)
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
    if (scanStarting || workspace.loading) return
    if (mode === 'incremental' && snapshot && !recovery && snapshot.scan.phase !== 'failed' && snapshot.status !== 'completed') {
      setGuideOpen(true)
      setStep(snapshot.status === 'scanning' ? 'scan' : snapshot.status === 'previewing' ? 'preview' : 'confirm')
      return
    }
    const requestedAccountMid = currentAccountMid
    const requestVersion = ++scanPresentationRequestVersion.current
    setGuideOpen(true)
    setStep('scan')
    setScanStartFailed(false)
    scanStartingRef.current = true
    setScanStarting(true)
    try {
      if (!await workspace.startScan(mode) && scanPresentationRequestVersion.current === requestVersion && activeAccountMid.current === requestedAccountMid) {
        setScanStartFailed(true)
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
      </div>

      <FavoriteLedgerOverview
        ledgers={ledgers}
        missingLedgerIds={missingLedgerIds}
        onEnsureLedgers={onEnsureLedgers}
        onSaveLedgers={onSaveLedgers}
        onOpenFavoritePage={onOpenFavoritePage}
        onCreateLocalLedger={workspace.createLocalLedgerAndReclassify}
      />
      <div className="favorite-ledger-panel__toolbar">
        <section className="favorite-ledger-panel__workspace" aria-label="整理旧藏">
          <div className="favorite-ledger-panel__editor-title">
            <div><h3>整理旧藏</h3><p>扫描历史收藏，并使用当前受控工作区完成归档。</p></div>
            <div className="favorite-ledger-panel__category-actions">
              <button type="button" aria-label="整理旧藏" disabled={workspace.loading || !currentAccountMid}
                onClick={() => void startScan('incremental')}>整理旧藏</button>
              <button type="button" aria-label="全部重新整理" disabled={workspace.loading || !currentAccountMid}
                onClick={() => void startScan('full')}>全部重新整理</button>
            </div>
          </div>
        </section>
        <FavoriteLibraryEntry />
      </div>

      {guideOpen ? <OldFavoriteGuide
        snapshot={snapshot}
        loading={workspace.loading}
        scanStarting={scanStarting}
        scanStartFailed={scanStartFailed}
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
        onSaveLocally={() => void workspace.saveCurrentSegmentLocally()}
        onConfirmAndSync={() => void workspace.confirmAndExecuteBilibiliPlan()}
        onExecuteFrozenPlan={() => void workspace.executeFrozenBilibiliPlan()}
        onReconcile={() => void workspace.reconcileFrozenBilibiliPlan()}
      /> : null}
    </section>
  )
}
