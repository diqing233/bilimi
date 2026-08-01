import type { FavoriteLedger } from '@shared/types'
import type { DeepSeekArchiveMode, DeepSeekArchiveScope } from '@shared/types'
import { useEffect, useState } from 'react'
import type { DeepSeekWorkspaceFeedback } from './useOldFavoriteWorkspace'
import type { OldFavoriteWorkspaceView } from '@shared/oldFavoriteWorkspace'
import { OldFavoriteScanOverviewStep } from './OldFavoriteScanOverviewStep'
import { OldFavoriteRecommendationStep } from './OldFavoriteRecommendationStep'
import { OldFavoriteArchivePreviewStep } from './OldFavoriteArchivePreviewStep'
import { OldFavoriteConfirmationStep } from './OldFavoriteConfirmationStep'

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
  onAbandonCurrentWorkspace = () => undefined,
  onAcknowledgeCompletion = () => undefined,
  onConfirmAndSync,
  onExecuteFrozenPlan,
  onReconcile
}: OldFavoriteGuideProps) {
  const [guideHintExpanded, setGuideHintExpanded] = useState(() => window.localStorage.getItem('bilimi:old-favorite-hint-open') === 'true')
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
  const canOpenStep = (next: OldFavoriteGuideStep) => {
    if (next === 'scan') return true
    if (scanStarting || recovery || tagEnrichmentBlocksNextStep) return false
    if ((recommendationSaving || previewPreparationRunning || mutationLocked) && next === 'confirm') return false
    if (next === 'generated' || next === 'preview') return snapshot?.status === 'previewing'
    return Boolean(snapshot && ['previewing', 'frozen', 'executing', 'reconciling', 'completed'].includes(snapshot.status))
  }

  return <section className="favorite-ledger-panel__old-favorites-guide" aria-label="整理收藏向导" data-busy={loading || recommendationSaving || previewPreparationRunning || undefined} data-preview-preparing={previewPreparationRunning || undefined}>
    <div className="favorite-ledger-panel__guide-header">
      <div className="favorite-ledger-panel__guide-title-row">
          <button type="button" className="favorite-ledger-panel__help-toggle favorite-ledger-panel__section-title favorite-ledger-panel__guide-title-toggle"
            aria-label={`${guideHintExpanded ? '收起' : '展开'}整理收藏`}
            aria-expanded={guideHintExpanded}
            title={'扫描已有收藏：读取可整理的收藏内容。\n检查建议：确认推荐收藏夹与分类结果。\n确认执行：核对后再同步到 bilimi 收藏夹。'}
            onClick={() => setGuideHintExpanded((expanded) => !expanded)}><h3>整理收藏</h3><Chevron /></button>
          {!recovery && snapshot && snapshot.segments.length > 1 ? <label className="favorite-ledger-panel__guide-segment-select">
            <span>当前批次</span>
            <select aria-label="整理批次" value={snapshot.currentSegment?.id ?? ''} disabled={loading || mutationLocked}
              onChange={(event) => {
                const segment = snapshot.segments.find((candidate) => candidate.id === event.currentTarget.value)
                if (!segment) return
                onSelectSegment(segment.id)
                if (segment.readiness === 'tagging') onStepChange('scan')
              }}>
              {snapshot.segments.map((segment) => <option key={segment.id} value={segment.id}>
                第 {segment.index + 1}/{snapshot.segments.length} 批 · {segment.itemCount} 条 · {segmentReadinessLabel(segment)}
              </option>)}
            </select>
          </label> : null}
      </div>
      {guideHintExpanded ? <div className="favorite-ledger-panel__guide-hint"><p>扫描已有收藏：读取可整理的收藏内容。</p><p>检查建议：确认推荐收藏夹与分类结果。</p><p>确认执行：核对后再同步到 bilimi 收藏夹。</p></div> : null}
      <nav className="favorite-ledger-panel__guide-steps" aria-label="整理收藏步骤">
        {steps.map((item) => <button key={item.id} type="button" aria-current={step === item.id ? 'step' : undefined}
          disabled={!canOpenStep(item.id)} onClick={() => onStepChange(item.id)}>{item.label}</button>)}
      </nav>
    </div>
    {recovery || step === 'scan' ? <OldFavoriteScanOverviewStep
      snapshot={snapshot}
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
    /> : null}
    {!recovery && snapshot && step === 'generated' ? <OldFavoriteRecommendationStep
      snapshot={snapshot}
      loading={loading || mutationLocked || currentSegmentSaved}
      adoptedCandidateIds={recommendedCandidateIds}
      error={recommendationError}
      previewPreparationRunning={previewPreparationRunning}
      previewPreparationProgress={previewPreparationProgress}
      previewPreparationError={previewPreparationError}
      onCancelPreviewPreparation={onCancelPreviewPreparation}
      onSetRecommendedCandidates={onSetRecommendedCandidates}
      onUpdateRecommendedCandidates={onUpdateRecommendedCandidates}
    /> : null}
    {!recovery && snapshot && step === 'preview' ? <OldFavoriteArchivePreviewStep
      snapshot={snapshot}
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
    /> : null}
    {!recovery && snapshot && step === 'confirm' ? <OldFavoriteConfirmationStep
      snapshot={snapshot}
      loading={loading || mutationLocked}
      reconciling={reconciling}
      preparationStatus={preparationStatus}
      executionError={executionError}
      onSaveLocally={onSaveLocally}
      onAbandonCurrentWorkspace={onAbandonCurrentWorkspace}
      onAcknowledgeCompletion={onAcknowledgeCompletion}
      onConfirmAndSync={onConfirmAndSync}
      onExecuteFrozenPlan={onExecuteFrozenPlan}
      onReconcile={onReconcile}
    /> : null}
  </section>
}

function Chevron() {
  return <svg className="favorite-ledger-panel__chevron" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m3 6 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
