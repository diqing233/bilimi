import type { FavoriteLedger, FavoriteLedgerSaveOptions } from '@shared/types'
import { useEffect, useMemo, useRef, useState } from 'react'
import { VirtualOldFavoriteTrack } from '../favorites/VirtualOldFavoriteTrack'
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

const VIRTUAL_TRACK_THRESHOLD = 50

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
  const activeAccountMid = useRef(currentAccountMid)
  activeAccountMid.current = currentAccountMid
  const snapshot = workspace.snapshot
  const recovery = snapshot && 'recovery' in snapshot ? snapshot : null
  const sourceIds = useMemo(() => new Set(
    recovery ? [] : snapshot?.sourceFolders?.filter((folder) => folder.selected && !folder.isBilimiWorkFolder)
      .map((folder) => folder.id) ?? []
  ), [recovery, snapshot])
  const previewItems = useMemo(() => snapshot?.status === 'previewing'
    ? (snapshot.currentSegment?.items ?? []).filter((item) =>
        item.sourceFolderIds.some((folderId) => sourceIds.has(folderId)))
    : [], [snapshot, sourceIds])
  const readiness = !recovery ? snapshot?.planReadiness : undefined
  const canFreeze = readiness
    ? readiness.selectedAidCount > 0 && readiness.unclassifiedAidCount === 0
    : previewItems.length > 0 && previewItems.every((item) =>
        (snapshot?.classifications[String(item.aid)]?.targetLedgerIds.length ?? 0) > 0)
  useEffect(() => {
    scanPresentationRequestVersion.current += 1
    setStep('scan')
    setScanStarting(false)
    setScanStartFailed(false)
  }, [currentAccountMid])

  useEffect(() => {
    if (recovery || snapshot?.status === 'scanning') setGuideOpen(true)
  }, [recovery, snapshot?.status])

  const startScan = async (mode: 'incremental' | 'full') => {
    if (scanStarting || workspace.loading) return
    const requestedAccountMid = currentAccountMid
    const requestVersion = ++scanPresentationRequestVersion.current
    setGuideOpen(true)
    setStep('scan')
    setScanStartFailed(false)
    setScanStarting(true)
    try {
      if (!await workspace.startScan(mode) && scanPresentationRequestVersion.current === requestVersion && activeAccountMid.current === requestedAccountMid) {
        setScanStartFailed(true)
      }
    } finally {
      if (scanPresentationRequestVersion.current === requestVersion && activeAccountMid.current === requestedAccountMid) {
        setScanStarting(false)
      }
    }
  }

  const renderPreviewItem = (item: typeof previewItems[number]) => {
    const title = item.title?.trim() || `视频 ${item.aid}`
    const targetLedgerId = snapshot?.classifications[String(item.aid)]?.targetLedgerIds[0] ?? ''
    return (
      <article className="favorite-ledger-panel__preview-item-shell">
        <strong>{title}</strong> · {item.author?.trim() || '未知 UP'}
        <label>
          <span>归类</span>
          <select
            aria-label={`归类 ${title}`}
            value={targetLedgerId}
            disabled={workspace.loading}
            onChange={(event) => void workspace.applyManualClassifications([{
              aid: item.aid,
              targetLedgerIds: event.currentTarget.value ? [event.currentTarget.value] : []
            }])}
          >
            <option value="">未分类</option>
            {ledgers.map((ledger) => <option key={ledger.id} value={ledger.id}>{ledger.displayName}</option>)}
          </select>
        </label>
      </article>
    )
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
        generatedStep={!recovery && snapshot ? <section aria-label="专属收藏夹候选">
          <h4>推荐收藏夹</h4>
          {(snapshot.recommendations?.candidates ?? []).map((candidate) => {
            const adopted = snapshot.recommendations?.adoptedCandidateIds.includes(candidate.id) ?? false
            return <label key={candidate.id}><input type="checkbox" aria-label={candidate.displayName} checked={adopted}
              disabled={workspace.loading} onChange={(event) => {
                const next = new Set(snapshot.recommendations?.adoptedCandidateIds ?? [])
                if (event.currentTarget.checked) next.add(candidate.id); else next.delete(candidate.id)
                void workspace.setRecommendedCandidates([...next])
              }} />{candidate.displayName}</label>
          })}
        </section> : null}

        previewStep={!recovery && snapshot ? <section className="favorite-ledger-panel__archive-preview" aria-label="归档预览">
          <h4>归档预览</h4><p>当前分段 {previewItems.length} 条；只加载并显示这一段。</p>
          {snapshot.segments.length > 1 ? <div aria-label="整理分段">{snapshot.segments.map((segment) =>
            <button key={segment.id} type="button" aria-pressed={snapshot.currentSegment?.id === segment.id}
              disabled={snapshot.currentSegment?.id === segment.id || workspace.loading}
              onClick={() => void workspace.selectSegment(segment.id)}>第 {segment.index + 1} 组</button>)}</div> : null}
          <div className="favorite-ledger-panel__confirm-actions">
            <button type="button" disabled={workspace.loading || previewItems.length === 0} onClick={() => void workspace.autoClassifyCurrentSegment()}>自动分类</button>
            <button type="button" disabled={!deepSeekArchiveAvailable || workspace.loading || previewItems.length === 0} onClick={() => void workspace.organizeCurrentSegmentWithDeepSeek()}>DeepSeek 整理</button>
            <button type="button" disabled={workspace.loading || snapshot.history.cursor === 0} onClick={() => void workspace.undoClassification()}>撤销本次改动</button>
            <button type="button" disabled={workspace.loading || snapshot.history.cursor >= snapshot.history.length} onClick={() => void workspace.redoClassification()}>恢复本次改动</button>
          </div>
          {previewItems.length > VIRTUAL_TRACK_THRESHOLD ? <VirtualOldFavoriteTrack className="favorite-ledger-panel__preview-videos" ariaLabel="当前分段归档预览"
            items={previewItems} itemKey={(item) => String(item.aid)} itemWidth={320} renderItem={renderPreviewItem} /> :
            <ul aria-label="当前分段归档预览">{previewItems.map((item) => <li key={item.aid}>{renderPreviewItem(item)}</li>)}</ul>}
        </section> : null}

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
