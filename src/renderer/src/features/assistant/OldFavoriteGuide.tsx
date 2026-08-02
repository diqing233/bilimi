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
  mutationLocked?: boolean
  reconciling: boolean
  preparationStatus?: string | null
  executionError?: string | null
  scanStarting: boolean
  scanStartFailure: string | null
  step: OldFavoriteGuideStep
  onStepChange: (step: OldFavoriteGuideStep) => void
  onRetryScan: () => void
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
  onUseOriginalClassifications?: () => void
  onCancelExecutionIntent?: () => void
  onAbandonCurrentWorkspace?: () => void
  onAcknowledgeCompletion?: () => void
  onConfirmAndSync: () => void
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
  return segment.readiness === 'tagging' ? '补取中' : '可整理'
}

export function OldFavoriteGuide({
  snapshot,
  loading,
  mutationLocked = false,
  reconciling,
  preparationStatus,
  executionError,
  scanStarting,
  scanStartFailure,
  step,
  onStepChange,
  onRetryScan,
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
  const currentSegmentSaved = Boolean(currentSegmentSummary?.status === 'frozen' || currentSegmentSummary?.readiness === 'saved')
  const tagEnrichmentBlocksNextStep = Boolean(
    snapshot && !('recovery' in snapshot)
    && (currentSegmentSummary?.readiness
      ? currentSegmentSummary.readiness === 'tagging'
      : snapshot.tagEnrichment?.status === 'running' || snapshot.tagEnrichment?.status === 'paused')
  )
  const deepSeekRunning = deepSeekFeedback?.status === 'running'
  const readOnlyBrowsing = mutationLocked || deepSeekRunning
  const selectedSegmentId = viewedSegmentId && snapshot && !('recovery' in snapshot) &&
    snapshot.segments.some((segment) => segment.id === viewedSegmentId)
    ? viewedSegmentId
    : snapshot && !('recovery' in snapshot)
      ? snapshot.currentSegment?.id ?? ''
      : ''
  const displayedSnapshot = readOnlyBrowsing && viewedSnapshot?.workspaceId === (snapshot && !('recovery' in snapshot) ? snapshot.workspaceId : '')
    ? viewedSnapshot
    : snapshot
  const canOpenStep = (next: OldFavoriteGuideStep) => {
    if (next === 'scan') return true
    if (scanStarting || recovery || tagEnrichmentBlocksNextStep) return false
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
        <select aria-label="整理批次" value={selectedSegmentId} disabled={loading && !readOnlyBrowsing}
          onChange={(event) => {
            const segment = snapshot.segments.find((candidate) => candidate.id === event.currentTarget.value)
            if (!segment) return
            setViewedSegmentId(segment.id)
            setViewScope('current')
            if (readOnlyBrowsing) void onViewSegment(segment.id).then((next) => { if (next) setViewedSnapshot(next) })
            else onSelectSegment(segment.id)
            if (segment.readiness === 'tagging') onStepChange('scan')
          }}>
          {snapshot.segments.map((segment) => <option key={segment.id} value={segment.id}>
            第 {segment.index + 1}/{snapshot.segments.length} 批 · {segment.itemCount} 条 · {segmentReadinessLabel(segment)}
          </option>)}
        </select>
      </label> : null}
      {guideHintExpanded ? <div className="favorite-ledger-panel__guide-hint"><p>请从左到右完成本轮整理</p><p>① 扫描概览：选择来源并等待标签补取；标签是分类的重要依据</p><p>② 推荐收藏夹：根据 UP 主和高频标签，勾选想采用的推荐收藏夹</p><p>③ 归档预览：检查标签分类结果，可用 DeepSeek 辅助调整</p><p>④ 确认执行：选择保存到收藏库或同步到 B 站，完成后点“好的”</p></div> : null}
      <nav className="favorite-ledger-panel__guide-steps" aria-label="整理收藏步骤">
        {steps.map((item) => <button key={item.id} type="button" aria-current={step === item.id ? 'step' : undefined}
          disabled={!canOpenStep(item.id)} onClick={() => onStepChange(item.id)}>{item.label}</button>)}
      </nav>
    </div>
    {recovery || step === 'scan' ? <OldFavoriteScanOverviewStep
      snapshot={displayedSnapshot}
      loading={loading || mutationLocked}
      scanStarting={scanStarting}
      scanStartFailure={scanStartFailure}
      onRetry={onRetryScan}
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
      loading={loading || mutationLocked || currentSegmentSaved}
      adoptedCandidateIds={recommendedCandidateIds}
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
      loading={loading}
      mutationLocked={mutationLocked || currentSegmentSaved}
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
      viewScope={viewScope}
      onViewScopeChange={setViewScope}
    /> : null}
    {!recovery && displayedSnapshot && !('recovery' in displayedSnapshot) && step === 'confirm' ? <OldFavoriteConfirmationStep
      snapshot={displayedSnapshot}
      ledgers={ledgers}
      loading={loading}
      reconciling={reconciling}
      preparationStatus={preparationStatus}
      executionError={executionError}
      onSaveLocally={onSaveLocally}
      onUseOriginalClassifications={onUseOriginalClassifications}
      onCancelExecutionIntent={onCancelExecutionIntent}
      onAbandonCurrentWorkspace={onAbandonCurrentWorkspace}
      onAcknowledgeCompletion={onAcknowledgeCompletion}
      onConfirmAndSync={onConfirmAndSync}
      onExecuteFrozenPlan={onExecuteFrozenPlan}
      onReconcile={onReconcile}
      viewScope={viewScope}
      onViewScopeChange={setViewScope}
    /> : null}
  </section>
}

function Chevron() {
  return <svg className="favorite-ledger-panel__chevron" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m3 6 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
