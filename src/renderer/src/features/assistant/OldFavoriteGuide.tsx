import type { FavoriteLedger } from '@shared/types'
import type { DeepSeekArchiveMode, DeepSeekArchiveScope } from '@shared/types'
import { useEffect, useState } from 'react'
import type { DeepSeekWorkspaceFeedback } from './useOldFavoriteWorkspace'
import type { OldFavoriteWorkspaceView } from '@shared/oldFavoriteWorkspace'
import { OldFavoriteScanOverviewStep } from './OldFavoriteScanOverviewStep'
import { OldFavoriteRecommendationStep } from './OldFavoriteRecommendationStep'
import { OldFavoriteArchivePreviewStep } from './OldFavoriteArchivePreviewStep'
import { OldFavoriteConfirmationStep } from './OldFavoriteConfirmationStep'
import type { OldFavoriteViewScope } from './OldFavoriteOverviewControls'

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
  onAbandonCurrentWorkspace?: () => void
  onAcknowledgeCompletion?: () => void
  onConfirmAndSync: (includeInbox?: boolean) => void
  onExecuteFrozenPlan: () => void
  onReconcile: () => void
}

const steps: Array<{ id: OldFavoriteGuideStep; label: string }> = [
  { id: 'scan', label: '扫描概览' },
  { id: 'generated', label: '推荐收藏夹' },
  { id: 'preview', label: '归档预览' },
  { id: 'confirm', label: '确认执行' }
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
  onAbandonCurrentWorkspace = () => undefined,
  onAcknowledgeCompletion = () => undefined,
  onConfirmAndSync,
  onExecuteFrozenPlan,
  onReconcile
}: OldFavoriteGuideProps) {
  const [guideHintExpanded, setGuideHintExpanded] = useState(() => window.localStorage.getItem('bilimi:old-favorite-hint-open') === 'true')
  const [viewScope, setViewScope] = useState<OldFavoriteViewScope>('current')
  const [viewedSegmentId, setViewedSegmentId] = useState<string | null>(null)
  const [viewedSnapshot, setViewedSnapshot] = useState<Exclude<OldFavoriteWorkspaceView, null | { recovery: 'rebuild-required' }> | null>(null)
  useEffect(() => { window.localStorage.setItem('bilimi:old-favorite-hint-open', String(guideHintExpanded)) }, [guideHintExpanded])
  const recovery = snapshot && 'recovery' in snapshot
  const currentSegmentSummary = snapshot && !('recovery' in snapshot)
    ? snapshot.segments.find((segment) => segment.id === snapshot.currentSegment?.id)
    : undefined
  const tagEnrichmentBlocksNextStep = Boolean(
    snapshot && !('recovery' in snapshot)
    && (currentSegmentSummary?.readiness
      ? currentSegmentSummary.readiness === 'tagging' || currentSegmentSummary.readiness === 'waiting'
      : snapshot.tagEnrichment?.status === 'running' || snapshot.tagEnrichment?.status === 'paused')
  )
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
  const selectedScopeValue = viewScope === 'all' ? 'all' : selectedSegmentId
  const canOpenStep = (next: OldFavoriteGuideStep, targetScope: OldFavoriteViewScope = viewScope) => {
    if (next === 'scan') return true
    if (scanStarting || recovery) return false
    if (targetScope === 'current' && tagEnrichmentBlocksNextStep &&
      !(next === 'confirm' && snapshot && !('recovery' in snapshot) && snapshot.overview?.available)) return false
    if (readOnlyBrowsing) return Boolean(snapshot)
    if ((recommendationSaving || previewPreparationRunning) && next === 'confirm') return false
    if (next === 'generated' || next === 'preview') return snapshot?.status === 'previewing'
    return Boolean(snapshot && ['previewing', 'frozen', 'executing', 'reconciling', 'completed'].includes(snapshot.status))
  }

  return <section className="favorite-ledger-panel__old-favorites-guide" aria-label="整理收藏向导" data-busy={loading || recommendationSaving || previewPreparationRunning || undefined} data-preview-preparing={previewPreparationRunning || undefined}>
    <div className="favorite-ledger-panel__guide-header">
      <div className="favorite-ledger-panel__guide-title-row">
          <button type="button" className="favorite-ledger-panel__help-toggle favorite-ledger-panel__section-title favorite-ledger-panel__guide-title-toggle"
            aria-label={`${guideHintExpanded ? '收起' : '展开'}整理收藏`}
            aria-expanded={guideHintExpanded}
            title={'请从左到右完成本轮整理\n① 扫描概览：选择来源并等待标签补取；标签是分类的重要依据\n② 推荐收藏夹：根据 UP 主和高频标签，勾选想采用的推荐收藏夹\n③ 归档预览：检查标签分类结果，可用 DeepSeek 辅助调整\n④ 确认执行：选择保存到收藏库或同步到 B 站，完成后点“好的”'}
            onClick={() => setGuideHintExpanded((expanded) => !expanded)}><h3>整理收藏</h3><Chevron /></button>
      </div>
      {!recovery && snapshot && snapshot.segments.length > 1 ? <label className="favorite-ledger-panel__guide-segment-select">
        <span>整理批次</span>
        <select aria-label="整理批次" value={selectedScopeValue} disabled={loading && !readOnlyBrowsing}
          onChange={(event) => {
            if (event.currentTarget.value === 'all') {
              setViewScope('all')
              return
            }
            const segment = snapshot.segments.find((candidate) => candidate.id === event.currentTarget.value)
            if (!segment) return
            setViewedSegmentId(segment.id)
            setViewScope('current')
            if (readOnlyBrowsing) void onViewSegment(segment.id).then((next) => { if (next) setViewedSnapshot(next) })
            else onSelectSegment(segment.id)
            if (segment.readiness === 'tagging' || segment.readiness === 'waiting') onStepChange('scan')
          }}>
          <option value="all">本轮总览</option>
          {snapshot.segments.map((segment) => <option key={segment.id} value={segment.id}>
            第 {segment.index + 1}/{snapshot.segments.length} 批 · {segment.itemCount} 条 · {segmentReadinessLabel(segment)}
          </option>)}
        </select>
      </label> : null}
      {guideHintExpanded ? <div className="favorite-ledger-panel__guide-hint"><p>请从左到右完成本轮整理</p><p>① 扫描概览：选择来源并等待标签补取；标签是分类的重要依据</p><p>② 推荐收藏夹：根据 UP 主和高频标签，勾选想采用的推荐收藏夹</p><p>③ 归档预览：检查标签分类结果，可用 DeepSeek 辅助调整</p><p>④ 确认执行：选择保存到收藏库或同步到 B 站，完成后点“好的”</p></div> : null}
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
      onAbandonCurrentWorkspace={onAbandonCurrentWorkspace}
      onAcknowledgeCompletion={onAcknowledgeCompletion}
      onConfirmAndSync={onConfirmAndSync}
      onExecuteFrozenPlan={onExecuteFrozenPlan}
      onReconcile={onReconcile}
      recommendedCandidateIds={recommendedCandidateIds}
      viewScope={viewScope}
      onViewScopeChange={setViewScope}
    /> : null}
  </section>
}

function Chevron() {
  return <svg className="favorite-ledger-panel__chevron" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m3 6 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
