import type { FavoriteLedger } from '@shared/types'
import type { DeepSeekArchiveMode, DeepSeekArchiveScope } from '@shared/types'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DeepSeekWorkspaceFeedback } from './useOldFavoriteWorkspace'
import type { OldFavoriteWorkspaceView } from '@shared/oldFavoriteWorkspace'
import { OldFavoriteScanOverviewStep } from './OldFavoriteScanOverviewStep'
import { OldFavoriteRecommendationStep } from './OldFavoriteRecommendationStep'
import { OldFavoriteArchivePreviewStep } from './OldFavoriteArchivePreviewStep'
import { OldFavoriteConfirmationStep } from './OldFavoriteConfirmationStep'
import type { OldFavoriteViewScope } from './OldFavoriteOverviewControls'
import { resolveSidebarTooltipPosition } from './sidebarTooltipPosition'

export type OldFavoriteGuideStep = 'scan' | 'generated' | 'preview' | 'confirm'

type OldFavoriteGuideProps = {
  snapshot: OldFavoriteWorkspaceView | null
  loading: boolean
  tagEnrichmentUpdating?: boolean
  mutationLocked?: boolean
  reconciling: boolean
  preparationStatus?: string | null
  executionError?: string | null
  scanStarting: boolean
  scanStartFailure: string | null
  step: OldFavoriteGuideStep
  onStepChange: (step: OldFavoriteGuideStep) => void
  onRetryScan: () => void
  scanPaused?: boolean
  onPauseScan?: () => void
  onResumeScan?: () => void
  onFinishScan?: () => void
  onRestartScan?: () => void
  onRetryScanDirect: () => void
  onRebuildWorkspace: () => void
  onSelectSourceFolders: (folderIds: string[]) => void
  onPauseTagEnrichment: () => void
  onResumeTagEnrichment: () => void
  onRetryFailedTagEnrichment: () => void
  onAcceptCurrentTags: () => void
  onSetRecommendedCandidates: (candidateIds: string[]) => void
  onUpdateRecommendedCandidates?: (update: (current: string[]) => string[]) => void
  recommendedCandidateIds?: string[]
  recommendationSaving?: boolean
  recommendationError?: string | null
  previewPreparationRunning?: boolean
  previewPreparationProgress?: { completedItemCount: number; totalItemCount: number } | null
  previewPreparationError?: string | null
  onCancelPreviewPreparation?: () => void
  ledgers: FavoriteLedger[]
  enabledLedgerIds?: ReadonlySet<string>
  deepSeekAvailable: boolean
  deepSeekFeedback: DeepSeekWorkspaceFeedback | null
  onSelectSegment: (segmentId: string) => void
  onViewSegment?: (segmentId: string) => Promise<Exclude<OldFavoriteWorkspaceView, null | { recovery: 'rebuild-required' }> | null>
  onAutoClassify: () => void
  onOrganizeWithDeepSeek: (mode: DeepSeekArchiveMode, scope?: DeepSeekArchiveScope) => void
  onRetryFailedDeepSeekChunks: () => void
  onCancelDeepSeek: () => void
  deepSeekCancelRequested: boolean
  onUndoClassification: () => void
  onRedoClassification: () => void
  onMoveHistoryCursor: (cursor: number) => void
  onApplyManualClassification: (aid: number, targetLedgerIds: string[]) => void
  onApplyManualClassifications: (assignments: Array<{ aid: number; targetLedgerIds: string[] }>) => void
  onSaveLocally: () => void
  onSaveCurrentSegment?: () => void
  onSaveWholeRun?: () => void
  onFinishCurrentSegment?: () => void
  onUseOriginalClassifications?: () => void
  onCancelExecutionIntent?: () => void
  onCloseCurrentWorkspace?: () => void
  onAbandonCurrentWorkspace?: () => void
  onAcknowledgeCompletion?: () => void
  onConfirmAndSync: (includeInbox?: boolean) => void
  onExecuteFrozenPlan: () => void
  onStopSyncAndFinish?: () => Promise<boolean> | void
  onReconcile: () => void
}

type OrganizingGuideHint = {
  label?: string
  detail: Array<{ text: string; strong?: boolean; body?: boolean }>
}

const steps: Array<{ id: OldFavoriteGuideStep; label: string }> = [
  { id: 'scan', label: '扫描概览' },
  { id: 'generated', label: '推荐收藏夹' },
  { id: 'preview', label: '归档预览' },
  { id: 'confirm', label: '确认执行' }
]

const wholeRunSelectValue = '__whole-run__'

const ORGANIZING_GUIDE_HINTS: OrganizingGuideHint[] = [
  { label: '小咪提醒：', detail: [{ text: '同一个视频可以保存在多个收藏夹里。整理收藏会把视频复制添加到 bilimi 收藏夹，不会移出原有的普通 B 站收藏夹，主人放心使用吧～（bilimi 收藏夹和分类视频支持删除，但需谨慎操作呦）' }] },
  { label: '请从左到右完成本轮整理。', detail: [] },
  { label: '① 扫描概览：', detail: [{ text: '扫描所有收藏的视频基本信息和标签。标签是分类的重要依据，建议耐心等待，不要提前采用；默认全部参与分类整理，可以取消不想整理的非 bilimi 收藏夹。' }] },
  { label: '② 推荐收藏夹：', detail: [{ text: '根据扫描到的 UP 主和高频标签生成推荐收藏夹，主人可勾选想采用的推荐收藏夹。勾选后的收藏夹会参与整理收藏分类；也可以自建收藏夹，保存并勾选即可参与分类。' }] },
  { label: '③ 归档预览：', detail: [{ text: '检查分类结果，本地分类能力有限，未匹配到合适分类和把握不太稳的视频，建议用 DeepSeek 辅助整理，也可手动调整转移。可以在上方收藏夹区域编辑或者新增，归档预览会重新计算。' }] },
  { label: '④ 确认执行：', detail: [{ text: '前面三步都是打草稿，最后一步来执行' }] },
  { label: '保存在收藏库：', detail: [{ text: '适合视频较多的情况，建议先保存在收藏库，后续可在收藏库同步，支持回到前三步修改后反复保存，收藏库可以批量转写视频音频，非常方便。' }] },
  { label: '同步到 B 站（较慢）：', detail: [{ text: '会先保存在收藏库再依次执行，如有勾选未备册的收藏夹会同时备册，整理草稿锁定后不可修改，后续可以去收藏库调整。' }] },
  { label: '暂不同步结束整理：', detail: [{ text: '可以选择先保留整理草稿，或者删除草稿结束本轮整理。' }] }
]
function segmentReadinessLabel(segment: Exclude<OldFavoriteWorkspaceView, null | { recovery: 'rebuild-required' }>['segments'][number]) {
  if (segment.status === 'frozen' || segment.readiness === 'saved') return '已保存'
  if (segment.readiness === 'waiting') return '等待扫描'
  return segment.readiness === 'tagging' ? '补取中' : '可整理'
}

export function OldFavoriteGuide({
  snapshot,
  loading,
  tagEnrichmentUpdating = false,
  mutationLocked = false,
  reconciling,
  preparationStatus,
  executionError,
  scanStarting,
  scanStartFailure,
  step,
  onStepChange,
  onRetryScan,
  scanPaused = false,
  onPauseScan = () => undefined,
  onResumeScan = () => undefined,
  onFinishScan = () => undefined,
  onRestartScan,
  onRetryScanDirect,
  onRebuildWorkspace,
  onSelectSourceFolders,
  onPauseTagEnrichment,
  onResumeTagEnrichment,
  onRetryFailedTagEnrichment,
  onAcceptCurrentTags,
  onSetRecommendedCandidates,
  onUpdateRecommendedCandidates,
  recommendedCandidateIds,
  recommendationSaving = false,
  recommendationError,
  previewPreparationRunning = false,
  previewPreparationProgress,
  previewPreparationError,
  onCancelPreviewPreparation = () => undefined,
  ledgers,
  enabledLedgerIds,
  deepSeekAvailable,
  deepSeekFeedback,
  onSelectSegment,
  onViewSegment = async () => null,
  onAutoClassify,
  onOrganizeWithDeepSeek,
  onRetryFailedDeepSeekChunks,
  onCancelDeepSeek,
  deepSeekCancelRequested,
  onUndoClassification,
  onRedoClassification,
  onMoveHistoryCursor,
  onApplyManualClassification,
  onApplyManualClassifications,
  onSaveLocally,
  onSaveCurrentSegment,
  onSaveWholeRun,
  onFinishCurrentSegment,
  onUseOriginalClassifications = () => undefined,
  onCancelExecutionIntent = () => undefined,
  onCloseCurrentWorkspace = () => undefined,
  onAbandonCurrentWorkspace = () => undefined,
  onAcknowledgeCompletion = () => undefined,
  onConfirmAndSync,
  onExecuteFrozenPlan,
  onStopSyncAndFinish = () => undefined,
  onReconcile
}: OldFavoriteGuideProps) {
  const [guideHintExpanded, setGuideHintExpanded] = useState(() => window.localStorage.getItem('bilimi:old-favorite-hint-open') === 'true')
  const [guideHintVisible, setGuideHintVisible] = useState(false)
  const [guideHintPosition, setGuideHintPosition] = useState({ top: 0, left: 0 })
  const guideHintPanelRef = useRef<HTMLElement>(null)
  const guideHintTriggerRef = useRef<HTMLButtonElement>(null)
  const guideHintTooltipRef = useRef<HTMLDivElement>(null)
  const [viewScope, setViewScope] = useState<OldFavoriteViewScope>('current')
  const [viewedSegmentId, setViewedSegmentId] = useState<string | null>(null)
  const [viewedSnapshot, setViewedSnapshot] = useState<Exclude<OldFavoriteWorkspaceView, null | { recovery: 'rebuild-required' }> | null>(null)
  useEffect(() => { window.localStorage.setItem('bilimi:old-favorite-hint-open', String(guideHintExpanded)) }, [guideHintExpanded])
  useLayoutEffect(() => {
    if (guideHintExpanded || !guideHintVisible) return
    const updatePosition = () => {
      const anchorRect = guideHintTriggerRef.current?.getBoundingClientRect()
      if (!anchorRect) return
      const tooltipRect = guideHintTooltipRef.current?.getBoundingClientRect()
      const tooltipWidth = tooltipRect?.width || 360
      const tooltipHeight = tooltipRect?.height || 48
      setGuideHintPosition(resolveSidebarTooltipPosition(
        anchorRect,
        { width: tooltipWidth, height: tooltipHeight },
        { width: window.innerWidth, height: window.innerHeight },
        guideHintPanelRef.current?.getBoundingClientRect()
      ))
    }
    updatePosition()
    const layoutFrame = window.requestAnimationFrame(updatePosition)
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePosition)
    if (guideHintPanelRef.current) resizeObserver?.observe(guideHintPanelRef.current)
    if (guideHintTriggerRef.current) resizeObserver?.observe(guideHintTriggerRef.current)
    if (guideHintTooltipRef.current) resizeObserver?.observe(guideHintTooltipRef.current)
    guideHintPanelRef.current?.addEventListener('transitionend', updatePosition)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.cancelAnimationFrame(layoutFrame)
      resizeObserver?.disconnect()
      guideHintPanelRef.current?.removeEventListener('transitionend', updatePosition)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [guideHintExpanded, guideHintVisible])
  const recovery = snapshot && 'recovery' in snapshot
  const deepSeekBusy = deepSeekFeedback?.status === 'running' || deepSeekFeedback?.status === 'waiting' || deepSeekCancelRequested
  const readOnlyBrowsing = mutationLocked || deepSeekBusy
  const selectedSegmentId = viewedSegmentId && snapshot && !('recovery' in snapshot) &&
    snapshot.segments.some((segment) => segment.id === viewedSegmentId)
    ? viewedSegmentId
    : snapshot && !('recovery' in snapshot)
      ? snapshot.currentSegment?.id ?? ''
      : ''
  const displayedSnapshot = readOnlyBrowsing && viewedSnapshot?.workspaceId === (snapshot && !('recovery' in snapshot) ? snapshot.workspaceId : '')
    ? viewedSnapshot
    : snapshot
  const segmentContentAvailable = !displayedSnapshot || 'recovery' in displayedSnapshot || (() => {
    const enrichmentActive = displayedSnapshot.tagEnrichment?.status === 'running' || displayedSnapshot.tagEnrichment?.status === 'paused'
    if (viewScope === 'all') return !enrichmentActive
    const segment = displayedSnapshot.segments.find((candidate) => candidate.id === displayedSnapshot.currentSegment?.id)
    if (segment?.readiness) return segment.readiness !== 'tagging' && segment.readiness !== 'waiting'
    return !enrichmentActive
  })()
  const selectedScopeValue = viewScope === 'all' ? wholeRunSelectValue : selectedSegmentId
  const canOpenStep = (next: OldFavoriteGuideStep) => {
    if (next === 'scan') return true
    if (scanStarting || recovery) return false
    if (readOnlyBrowsing) return Boolean(snapshot)
    if ((recommendationSaving || previewPreparationRunning) && next === 'confirm') return false
    if (next === 'generated' || next === 'preview') return snapshot?.status === 'previewing'
    return Boolean(snapshot && ['previewing', 'frozen', 'executing', 'reconciling', 'completed'].includes(snapshot.status))
  }

  return <section ref={guideHintPanelRef} className="favorite-ledger-panel__old-favorites-guide" aria-label="整理收藏向导" data-busy={loading || recommendationSaving || previewPreparationRunning || undefined} data-preview-preparing={previewPreparationRunning || undefined}>
    <div className="favorite-ledger-panel__guide-header">
      <div className="favorite-ledger-panel__guide-title-row">
          <button ref={guideHintTriggerRef} type="button" className="favorite-ledger-panel__help-toggle favorite-ledger-panel__section-title favorite-ledger-panel__guide-title-toggle"
            aria-label={`${guideHintExpanded ? '收起' : '展开'}整理收藏`}
            aria-expanded={guideHintExpanded}
            aria-describedby={guideHintExpanded ? undefined : 'favorite-organization-help-tooltip'}
            onMouseEnter={() => setGuideHintVisible(true)} onMouseLeave={() => setGuideHintVisible(false)}
            onFocus={() => setGuideHintVisible(true)} onBlur={() => setGuideHintVisible(false)}
            onClick={() => setGuideHintExpanded((expanded) => !expanded)}><h3>整理收藏</h3><Chevron /></button>
      </div>
      {!recovery && snapshot && snapshot.segments.length > 1 ? <label className="favorite-ledger-panel__guide-segment-select">
        <span>整理批次</span>
        <select aria-label="整理批次" value={selectedScopeValue} disabled={loading && !readOnlyBrowsing}
          onChange={(event) => {
            if (event.currentTarget.value === wholeRunSelectValue) {
              setViewScope('all')
              return
            }
            const segment = snapshot.segments.find((candidate) => candidate.id === event.currentTarget.value)
            if (!segment) return
            setViewedSegmentId(segment.id)
            setViewScope('current')
            if (readOnlyBrowsing) void onViewSegment(segment.id).then((next) => { if (next) setViewedSnapshot(next) })
            else onSelectSegment(segment.id)
          }}>
          <option value={wholeRunSelectValue}>本轮总览</option>
          {snapshot.segments.map((segment) => <option key={segment.id} value={segment.id}>
            第 {segment.index + 1}/{snapshot.segments.length} 批 · {segment.itemCount} 条 · {segmentReadinessLabel(segment)}
          </option>)}
        </select>
      </label> : null}
      {!guideHintExpanded ? createPortal(<div ref={guideHintTooltipRef} id="favorite-organization-help-tooltip" className="favorite-ledger-panel__help-tooltip" role="tooltip" data-visible={guideHintVisible || undefined} style={guideHintPosition}>{ORGANIZING_GUIDE_HINTS.map((hint) => <p key={hint.label ?? hint.detail.map((part) => part.text).join('')}><GuideHintContent hint={hint} tooltip /></p>)}</div>, document.body) : null}
      {guideHintExpanded ? <div className="favorite-ledger-panel__guide-hint">{ORGANIZING_GUIDE_HINTS.map((hint) => <p key={hint.label ?? hint.detail.map((part) => part.text).join('')}><GuideHintContent hint={hint} /></p>)}</div> : null}
      <nav className="favorite-ledger-panel__guide-steps" aria-label="整理收藏步骤">
        {steps.map((item) => <button key={item.id} type="button" aria-current={step === item.id ? 'step' : undefined}
          disabled={!canOpenStep(item.id)} onClick={() => {
            onStepChange(item.id)
          }}>{item.label}</button>)}
      </nav>
      {deepSeekBusy && step !== 'preview' ? <div className="favorite-ledger-panel__deepseek-guide-status" role="status">
        <span>{deepSeekCancelRequested ? '正在结束当前批次，后续批次不会再开始。' : deepSeekFeedback?.message}</span>
        <button type="button" className="favorite-ledger-panel__deepseek-archive-run-button" data-action="cancel"
          disabled={deepSeekCancelRequested} onClick={onCancelDeepSeek}>
          {deepSeekCancelRequested ? '正在取消' : '取消整理'}
        </button>
      </div> : null}
    </div>
    {recovery || step === 'scan' ? <OldFavoriteScanOverviewStep
      snapshot={displayedSnapshot}
      loading={loading || readOnlyBrowsing}
      tagControlsLoading={tagEnrichmentUpdating}
      scanStarting={scanStarting}
      scanPaused={scanPaused}
      onPauseScan={onPauseScan}
      onResumeScan={onResumeScan}
      onFinishScan={onFinishScan}
      scanStartFailure={scanStartFailure}
      onRetry={onRetryScan}
      onRestart={onRestartScan}
      onRetryDirect={onRetryScanDirect}
      onRebuild={onRebuildWorkspace}
      onSelectSourceFolders={onSelectSourceFolders}
      onPauseTagEnrichment={onPauseTagEnrichment}
      onResumeTagEnrichment={onResumeTagEnrichment}
      onRetryFailedTagEnrichment={onRetryFailedTagEnrichment}
      onAcceptCurrentTags={onAcceptCurrentTags}
      viewScope={viewScope}
      onViewScopeChange={setViewScope}
    /> : null}
    {!recovery && displayedSnapshot && !('recovery' in displayedSnapshot) && step === 'generated' ? <OldFavoriteRecommendationStep
      snapshot={displayedSnapshot}
      loading={loading || readOnlyBrowsing}
      adoptedCandidateIds={recommendedCandidateIds}
      recommendationSaving={recommendationSaving}
      error={recommendationError}
      previewPreparationRunning={previewPreparationRunning}
      previewPreparationProgress={previewPreparationProgress}
      previewPreparationError={previewPreparationError}
      onCancelPreviewPreparation={onCancelPreviewPreparation}
      onSetRecommendedCandidates={onSetRecommendedCandidates}
      onUpdateRecommendedCandidates={onUpdateRecommendedCandidates}
      viewScope={viewScope}
      onViewScopeChange={setViewScope}
      contentAvailable={segmentContentAvailable}
    /> : null}
    {!recovery && displayedSnapshot && !('recovery' in displayedSnapshot) && step === 'preview' ? <OldFavoriteArchivePreviewStep
      snapshot={displayedSnapshot}
      ledgers={ledgers}
      enabledLedgerIds={enabledLedgerIds}
      loading={loading}
      mutationLocked={readOnlyBrowsing}
      deepSeekAvailable={deepSeekAvailable}
      deepSeekFeedback={deepSeekFeedback}
      onOrganizeWithDeepSeek={onOrganizeWithDeepSeek}
      onRetryFailedDeepSeekChunks={onRetryFailedDeepSeekChunks}
      onCancelDeepSeek={onCancelDeepSeek}
      deepSeekCancelRequested={deepSeekCancelRequested}
      onUndo={onUndoClassification}
      onRedo={onRedoClassification}
      onMoveHistoryCursor={onMoveHistoryCursor}
      onApplyManualClassification={onApplyManualClassification}
      onApplyManualClassifications={onApplyManualClassifications}
      recommendedCandidateIds={recommendedCandidateIds}
      viewScope={viewScope}
      onViewScopeChange={setViewScope}
      contentAvailable={segmentContentAvailable}
    /> : null}
    {!recovery && displayedSnapshot && !('recovery' in displayedSnapshot) && step === 'confirm' ? <OldFavoriteConfirmationStep
      snapshot={displayedSnapshot}
      ledgers={ledgers}
      enabledLedgerIds={enabledLedgerIds}
      loading={loading}
      reconciling={reconciling}
      preparationStatus={preparationStatus}
      executionError={executionError}
      onSaveLocally={onSaveLocally}
      onSaveCurrentSegment={onSaveCurrentSegment}
      onSaveWholeRun={onSaveWholeRun}
      onFinishCurrentSegment={onFinishCurrentSegment}
      onUseOriginalClassifications={onUseOriginalClassifications}
      onCancelExecutionIntent={onCancelExecutionIntent}
      onCloseCurrentWorkspace={onCloseCurrentWorkspace}
      onAbandonCurrentWorkspace={onAbandonCurrentWorkspace}
      onAcknowledgeCompletion={onAcknowledgeCompletion}
      onConfirmAndSync={onConfirmAndSync}
      onExecuteFrozenPlan={onExecuteFrozenPlan}
      onStopSyncAndFinish={onStopSyncAndFinish}
      onReconcile={onReconcile}
      recommendedCandidateIds={recommendedCandidateIds}
      viewScope={viewScope}
      onViewScopeChange={setViewScope}
    /> : null}
  </section>
}

function GuideHintContent({ hint, tooltip = false }: { hint: OrganizingGuideHint; tooltip?: boolean }) {
  return <>{hint.label ? <strong className={tooltip ? 'favorite-ledger-panel__help-tooltip-title' : undefined}>{hint.label}</strong> : null}{hint.detail.map((part) => part.strong
    ? <strong key={part.text}>{part.text}</strong>
    : <span key={part.text} className={part.body ? 'favorite-ledger-panel__guide-hint-body' : undefined}>{part.text}</span>)}</>
}

function Chevron() {
  return <svg className="favorite-ledger-panel__chevron" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m3 6 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
