import type { FavoriteLedger, FavoriteLedgerSaveOptions } from '@shared/types'
import { useEffect, useMemo, useRef, useState } from 'react'
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
  const previewItems = useMemo(() => snapshot?.currentSegment?.items ?? [], [snapshot])

  const readiness = !recovery ? snapshot?.planReadiness : undefined
  const canFreeze = readiness
    ? readiness.selectedAidCount > 0 && readiness.unclassifiedAidCount === 0
    : previewItems.length > 0 && previewItems.every((item) =>
        (snapshot?.classifications[String(item.aid)]?.targetLedgerIds.length ?? 0) > 0)
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
    if (mode === 'incremental' && snapshot && !recovery && snapshot.scan.phase !== 'failed') {
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
        confirmStep={!recovery && snapshot ? <section className="favorite-ledger-panel__confirm" aria-label="确认整理">
          <h4>确认执行</h4>
          {snapshot.status === 'frozen' ? <button type="button" disabled={workspace.loading} onClick={() => void workspace.executeFrozenBilibiliPlan()}>继续同步到 B 站</button>
            : snapshot.status === 'reconciling' ? <button type="button" disabled={workspace.loading} onClick={() => void workspace.reconcileFrozenBilibiliPlan()}>对账 B 站结果</button>
              : snapshot.status === 'executing' ? <button type="button" disabled={workspace.loading} onClick={() => void workspace.reconcileFrozenBilibiliPlan()}>检查 B 站同步状态</button>
                : snapshot.status === 'completed' ? <p role="status">{snapshot.completionMode === 'local' ? '本轮已保存到收藏库。' : '本轮已完成同步到 B 站。已提交的 B 站操作不会在此撤销。'}</p>
                  : <><p>可直接同步到 B 站，或仅保存到本地收藏库；两种方式都会冻结当前分类结果。</p>
                    {!canFreeze ? <p role="alert">{readiness?.unclassifiedAidCount ? `还需完成 ${readiness.unclassifiedAidCount} 条（跨所有分段）。` : '请先为当前分段的每条视频选择归类。'}</p> : null}
                    <button type="button" disabled={!canFreeze || workspace.loading} onClick={() => void workspace.saveCurrentSegmentLocally()}>仅保存本轮到收藏库</button>
                    <button type="button" disabled={!canFreeze || workspace.loading} onClick={() => void workspace.confirmAndExecuteBilibiliPlan()}>确认并同步到 B 站</button></>}
        </section> : null}
      /> : null}
    </section>
  )
}
