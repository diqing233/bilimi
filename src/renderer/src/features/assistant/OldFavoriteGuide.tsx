import type { FavoriteLedger } from '@shared/types'
import type { DeepSeekArchiveMode } from '@shared/types'
import { useState } from 'react'
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
  onAcceptCurrentTags: () => void
  onSetRecommendedCandidates: (candidateIds: string[]) => void
  ledgers: FavoriteLedger[]
  deepSeekAvailable: boolean
  deepSeekFeedback: DeepSeekWorkspaceFeedback | null
  onSelectSegment: (segmentId: string) => void
  onAutoClassify: () => void
  onOrganizeWithDeepSeek: (mode: DeepSeekArchiveMode) => void
  onRetryFailedDeepSeekChunks: () => void
  onUndoClassification: () => void
  onRedoClassification: () => void
  onMoveHistoryCursor: (cursor: number) => void
  onApplyManualClassification: (aid: number, targetLedgerIds: string[]) => void
  onApplyManualClassifications: (assignments: Array<{ aid: number; targetLedgerIds: string[] }>) => void
  onCreateLocalLedgerAndReclassify: (title: string) => void
  onSaveLocally: () => void
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

export function OldFavoriteGuide({
  snapshot,
  loading,
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
  onAcceptCurrentTags,
  onSetRecommendedCandidates,
  ledgers,
  deepSeekAvailable,
  deepSeekFeedback,
  onSelectSegment,
  onAutoClassify,
  onOrganizeWithDeepSeek,
  onRetryFailedDeepSeekChunks,
  onUndoClassification,
  onRedoClassification,
  onMoveHistoryCursor,
  onApplyManualClassification,
  onApplyManualClassifications,
  onCreateLocalLedgerAndReclassify,
  onSaveLocally,
  onConfirmAndSync,
  onExecuteFrozenPlan,
  onReconcile
}: OldFavoriteGuideProps) {
  const [guideHintExpanded, setGuideHintExpanded] = useState(false)
  const recovery = snapshot && 'recovery' in snapshot
  const canOpenStep = (next: OldFavoriteGuideStep) => {
    if (next === 'scan') return true
    if (scanStarting || recovery) return false
    if (next === 'generated' || next === 'preview') return snapshot?.status === 'previewing'
    return Boolean(snapshot && ['previewing', 'frozen', 'executing', 'reconciling', 'completed'].includes(snapshot.status))
  }

  return <section className="favorite-ledger-panel__old-favorites-guide" aria-label="整理旧藏向导">
    <div className="favorite-ledger-panel__guide-header">
      <div className="favorite-ledger-panel__guide-title-row">
        <span className="favorite-ledger-panel__section-title">
          <h3 title="扫描旧藏，确认后整理到 bilimi 收藏夹里。">整理旧藏</h3>
          <button type="button" className="favorite-ledger-panel__help-toggle"
            aria-label={`${guideHintExpanded ? '收起' : '展开'}整理旧藏说明`}
            aria-expanded={guideHintExpanded}
            title="扫描旧藏，确认后整理到 bilimi 收藏夹里。"
            onClick={() => setGuideHintExpanded((expanded) => !expanded)}>
            <span className="favorite-ledger-panel__help-arrows" aria-hidden="true">
              <span className="favorite-ledger-panel__help-arrow favorite-ledger-panel__help-arrow--up" />
              <span className="favorite-ledger-panel__help-arrow favorite-ledger-panel__help-arrow--down" />
            </span>
          </button>
        </span>
      </div>
      {guideHintExpanded ? <p className="favorite-ledger-panel__guide-hint">扫描旧藏后，按扫描概览、推荐收藏夹、归档预览和确认执行依次完成本轮整理。</p> : null}
      <nav className="favorite-ledger-panel__guide-steps" aria-label="整理旧藏步骤">
        {steps.map((item) => <button key={item.id} type="button" aria-current={step === item.id ? 'step' : undefined}
          disabled={!canOpenStep(item.id)} onClick={() => onStepChange(item.id)}>{item.label}</button>)}
      </nav>
    </div>
    {recovery || step === 'scan' ? <OldFavoriteScanOverviewStep
      snapshot={snapshot}
      loading={loading}
      executionError={executionError}
      scanStarting={scanStarting}
      scanStartFailure={scanStartFailure}
      onRetry={onRetryScan}
      onRetryDirect={onRetryScanDirect}
      onRebuild={onRebuildWorkspace}
      onSelectSourceFolders={onSelectSourceFolders}
      onPauseTagEnrichment={onPauseTagEnrichment}
      onResumeTagEnrichment={onResumeTagEnrichment}
      onAcceptCurrentTags={onAcceptCurrentTags}
    /> : null}
    {!recovery && snapshot && step === 'generated' ? <OldFavoriteRecommendationStep
      snapshot={snapshot}
      loading={loading}
      onSetRecommendedCandidates={onSetRecommendedCandidates}
    /> : null}
    {!recovery && snapshot && step === 'preview' ? <OldFavoriteArchivePreviewStep
      snapshot={snapshot}
      ledgers={ledgers}
      loading={loading}
      deepSeekAvailable={deepSeekAvailable}
      deepSeekFeedback={deepSeekFeedback}
      onSelectSegment={onSelectSegment}
      onOrganizeWithDeepSeek={onOrganizeWithDeepSeek}
      onRetryFailedDeepSeekChunks={onRetryFailedDeepSeekChunks}
      onUndo={onUndoClassification}
      onRedo={onRedoClassification}
      onMoveHistoryCursor={onMoveHistoryCursor}
      onApplyManualClassification={onApplyManualClassification}
      onApplyManualClassifications={onApplyManualClassifications}
    /> : null}
    {!recovery && snapshot && step === 'confirm' ? <OldFavoriteConfirmationStep
      snapshot={snapshot}
      loading={loading}
      executionError={executionError}
      onSaveLocally={onSaveLocally}
      onConfirmAndSync={onConfirmAndSync}
      onExecuteFrozenPlan={onExecuteFrozenPlan}
      onReconcile={onReconcile}
    /> : null}
  </section>
}
