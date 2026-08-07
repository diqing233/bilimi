import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OldFavoriteGuide } from './OldFavoriteGuide'

describe('OldFavoriteGuide DeepSeek browsing', () => {
  it('keeps an incomplete scan below the first batch in the four-metric whole-run view', () => {
    const snapshot = {
      version: 1 as const,
      accountMid: '100', workspaceId: 'workspace-100', status: 'scanning' as const, mode: 'incremental' as const,
      segmentSize: 500, hasMultipleSegments: false,
      scan: { phase: 'inventory' as const, failureCount: 0, paused: true, totalItemCount: 2_868, scannedItemCount: 140 },
      inventoryMetrics: {
        authority: 'incomplete' as const, relationshipCount: 2_868, plannedAidCount: null, protectedAidCount: null, unavailableAidCount: null,
        sourceFolders: []
      },
      continuationCount: 0, sourceFolders: [], segments: [], currentSegment: null, classifications: {},
      recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
    }

    render(<OldFavoriteGuide
      snapshot={snapshot} loading={false} reconciling={false} scanStarting={false} scanStartFailure={null}
      step="scan" onStepChange={vi.fn()} onRetryScan={vi.fn()} onRetryScanDirect={vi.fn()} onRebuildWorkspace={vi.fn()}
      onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()} onResumeTagEnrichment={vi.fn()}
      onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()} onSetRecommendedCandidates={vi.fn()}
      ledgers={[]} deepSeekAvailable={false} deepSeekFeedback={null}
      onSelectSegment={vi.fn()} onAutoClassify={vi.fn()} onOrganizeWithDeepSeek={vi.fn()}
      onRetryFailedDeepSeekChunks={vi.fn()} onCancelDeepSeek={vi.fn()} deepSeekCancelRequested={false}
      onUndoClassification={vi.fn()} onRedoClassification={vi.fn()} onMoveHistoryCursor={vi.fn()}
      onApplyManualClassification={vi.fn()} onApplyManualClassifications={vi.fn()}
      onSaveLocally={vi.fn()} onConfirmAndSync={vi.fn()} onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()}
    />)

    const metrics = screen.getByLabelText('本轮整理统计')
    expect(metrics).toHaveTextContent('扫描总数2868')
    expect(screen.getByLabelText('本轮待整理')).toBeInTheDocument()
    expect(screen.getByLabelText('已保护跳过')).toBeInTheDocument()
    expect(screen.getByLabelText('失效视频')).toBeInTheDocument()
  })

  it('defaults to the whole-run overview and locks current batches until the first batch tags are ready', () => {
    const snapshot = {
      version: 1 as const,
      accountMid: '100', workspaceId: 'workspace-100', status: 'scanning' as const, mode: 'incremental' as const,
      segmentSize: 500, hasMultipleSegments: true,
      scan: { phase: 'inventory' as const, failureCount: 0, totalItemCount: 1_000, scannedItemCount: 140 }, continuationCount: 0,
      sourceFolders: [],
      segments: [
        { id: 'segment-1', index: 0, status: 'previewing' as const, itemCount: 500, readiness: 'waiting' as const, completedTagItemCount: 0 },
        { id: 'segment-2', index: 1, status: 'previewing' as const, itemCount: 500, readiness: 'waiting' as const, completedTagItemCount: 0 }
      ],
      currentSegment: { id: 'segment-1', aids: [], items: [] }, classifications: {},
      recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
    }

    render(<OldFavoriteGuide
      snapshot={snapshot} loading={false} reconciling={false} scanStarting={false} scanStartFailure={null}
      step="scan" onStepChange={vi.fn()} onRetryScan={vi.fn()} onRetryScanDirect={vi.fn()} onRebuildWorkspace={vi.fn()}
      onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()} onResumeTagEnrichment={vi.fn()}
      onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()} onSetRecommendedCandidates={vi.fn()}
      ledgers={[]} deepSeekAvailable={false} deepSeekFeedback={null}
      onSelectSegment={vi.fn()} onAutoClassify={vi.fn()} onOrganizeWithDeepSeek={vi.fn()}
      onRetryFailedDeepSeekChunks={vi.fn()} onCancelDeepSeek={vi.fn()} deepSeekCancelRequested={false}
      onUndoClassification={vi.fn()} onRedoClassification={vi.fn()} onMoveHistoryCursor={vi.fn()}
      onApplyManualClassification={vi.fn()} onApplyManualClassifications={vi.fn()}
      onSaveLocally={vi.fn()} onConfirmAndSync={vi.fn()} onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()}
    />)

    const selector = screen.getByRole('combobox', { name: '整理批次' })
    expect(selector).toHaveValue('__whole-run__')
    expect(screen.getByRole('option', { name: /第 1\/2 批/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: '本轮总览' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('locks tag controls before source scanning has projected the first batch', () => {
    const snapshot = {
      version: 1 as const,
      accountMid: '100', workspaceId: 'workspace-100', status: 'scanning' as const, mode: 'incremental' as const,
      segmentSize: 500, hasMultipleSegments: true,
      scan: { phase: 'inventory' as const, failureCount: 0, totalItemCount: 2_868, scannedItemCount: 700 }, continuationCount: 0,
      sourceFolders: [], segments: [], currentSegment: null, classifications: {},
      recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] },
      tagEnrichment: { status: 'running' as const, totalItemCount: 500, completedItemCount: 1, pendingItemCount: 499, failedItemCount: 0 }
    }

    render(<OldFavoriteGuide
      snapshot={snapshot} loading={false} reconciling={false} scanStarting={false} scanStartFailure={null}
      step="scan" onStepChange={vi.fn()} onRetryScan={vi.fn()} onRetryScanDirect={vi.fn()} onRebuildWorkspace={vi.fn()}
      onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()} onResumeTagEnrichment={vi.fn()}
      onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()} onSetRecommendedCandidates={vi.fn()}
      ledgers={[]} deepSeekAvailable={false} deepSeekFeedback={null}
      onSelectSegment={vi.fn()} onAutoClassify={vi.fn()} onOrganizeWithDeepSeek={vi.fn()}
      onRetryFailedDeepSeekChunks={vi.fn()} onCancelDeepSeek={vi.fn()} deepSeekCancelRequested={false}
      onUndoClassification={vi.fn()} onRedoClassification={vi.fn()} onMoveHistoryCursor={vi.fn()}
      onApplyManualClassification={vi.fn()} onApplyManualClassifications={vi.fn()}
      onSaveLocally={vi.fn()} onConfirmAndSync={vi.fn()} onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()}
    />)

    expect(screen.getByRole('button', { name: '暂停补取标签' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '采用当前标签' })).toBeDisabled()
  })

  it('keeps every later step locked while a single batch is still enriching tags', () => {
    const snapshot = {
      version: 1 as const,
      accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const, mode: 'incremental' as const,
      segmentSize: 2_000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0, totalItemCount: 2, scannedItemCount: 2 }, continuationCount: 0,
      sourceFolders: [],
      segments: [{ id: 'segment-1', index: 0, status: 'previewing' as const, itemCount: 2, readiness: 'ready' as const, completedTagItemCount: 1 }],
      currentSegment: { id: 'segment-1', aids: [1, 2], items: [] }, classifications: {},
      recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] },
      tagEnrichment: { status: 'running' as const, totalItemCount: 2, completedItemCount: 1, pendingItemCount: 1, failedItemCount: 0 }
    }

    render(<OldFavoriteGuide
      snapshot={snapshot} loading={false} reconciling={false} scanStarting={false} scanStartFailure={null}
      step="scan" onStepChange={vi.fn()} onRetryScan={vi.fn()} onRetryScanDirect={vi.fn()} onRebuildWorkspace={vi.fn()}
      onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()} onResumeTagEnrichment={vi.fn()}
      onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()} onSetRecommendedCandidates={vi.fn()}
      ledgers={[]} deepSeekAvailable={false} deepSeekFeedback={null}
      onSelectSegment={vi.fn()} onAutoClassify={vi.fn()} onOrganizeWithDeepSeek={vi.fn()}
      onRetryFailedDeepSeekChunks={vi.fn()} onCancelDeepSeek={vi.fn()} deepSeekCancelRequested={false}
      onUndoClassification={vi.fn()} onRedoClassification={vi.fn()} onMoveHistoryCursor={vi.fn()}
      onApplyManualClassification={vi.fn()} onApplyManualClassifications={vi.fn()}
      onSaveLocally={vi.fn()} onConfirmAndSync={vi.fn()} onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()}
    />)

    expect(screen.getByRole('button', { name: '推荐收藏夹' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '归档预览' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '确认执行' })).toBeDisabled()
  })

  it('keeps batch browsing read-only while DeepSeek is running', () => {
    const onSelectSegment = vi.fn()
    const onViewSegment = vi.fn().mockResolvedValue(null)
    const snapshot = {
      version: 1 as const,
      accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const, mode: 'incremental' as const,
      segmentSize: 1, hasMultipleSegments: true, scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2, isBilimiWorkFolder: false, selected: true }],
      segments: [
        { id: 'segment-1', index: 0, status: 'previewing' as const, itemCount: 1, readiness: 'ready' as const },
        { id: 'segment-2', index: 1, status: 'previewing' as const, itemCount: 1, readiness: 'ready' as const }
      ],
      currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, title: 'Video 1', sourceFolderIds: ['source'] }] },
      classifications: { '1': { aid: 1, targetLedgerIds: ['music'], source: 'system-high' as const } },
      recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 1, length: 1, entries: [{ cursor: 1, source: 'deepseek' as const, changeCount: 1, targetLedgerIds: ['music'] }] }
    }

    render(<OldFavoriteGuide
      snapshot={snapshot} loading={false} reconciling={false} scanStarting={false} scanStartFailure={null}
      step="preview" onStepChange={vi.fn()} onRetryScan={vi.fn()} onRetryScanDirect={vi.fn()} onRebuildWorkspace={vi.fn()}
      onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()} onResumeTagEnrichment={vi.fn()}
      onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()} onSetRecommendedCandidates={vi.fn()}
      ledgers={[{ id: 'music', displayName: 'Music', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: true }]}
      deepSeekAvailable deepSeekFeedback={{ status: 'running', message: 'DeepSeek 正在整理' }}
      onSelectSegment={onSelectSegment} onViewSegment={onViewSegment} onAutoClassify={vi.fn()}
      onOrganizeWithDeepSeek={vi.fn()} onRetryFailedDeepSeekChunks={vi.fn()} onCancelDeepSeek={vi.fn()}
      deepSeekCancelRequested={false} onUndoClassification={vi.fn()} onRedoClassification={vi.fn()}
      onMoveHistoryCursor={vi.fn()} onApplyManualClassification={vi.fn()} onApplyManualClassifications={vi.fn()}
      onSaveLocally={vi.fn()} onConfirmAndSync={vi.fn()} onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()}
    />)

    const selector = screen.getByRole('combobox', { name: '整理批次' })
    expect(selector).toBeEnabled()
    fireEvent.change(selector, { target: { value: 'segment-2' } })
    expect(onViewSegment).toHaveBeenCalledWith('segment-2')
    expect(onSelectSegment).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '撤销本次改动' })).toBeDisabled()
  })

  it('keeps batch browsing available while a cancellation request is still settling', () => {
    const onSelectSegment = vi.fn()
    const onViewSegment = vi.fn().mockResolvedValue(null)
    const snapshot = {
      version: 1 as const,
      accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const, mode: 'incremental' as const,
      segmentSize: 1, hasMultipleSegments: true, scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [],
      segments: [
        { id: 'segment-1', index: 0, status: 'previewing' as const, itemCount: 1, readiness: 'ready' as const },
        { id: 'segment-2', index: 1, status: 'previewing' as const, itemCount: 1, readiness: 'ready' as const }
      ],
      currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, title: 'Video 1', sourceFolderIds: [] }] },
      classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0, entries: [] }
    }

    render(<OldFavoriteGuide
      snapshot={snapshot} loading={true} reconciling={false} scanStarting={false} scanStartFailure={null}
      step="preview" onStepChange={vi.fn()} onRetryScan={vi.fn()} onRetryScanDirect={vi.fn()} onRebuildWorkspace={vi.fn()}
      onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()} onResumeTagEnrichment={vi.fn()}
      onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()} onSetRecommendedCandidates={vi.fn()}
      ledgers={[]} deepSeekAvailable deepSeekFeedback={{ status: 'canceled', message: '正在收尾' }}
      onSelectSegment={onSelectSegment} onViewSegment={onViewSegment} onAutoClassify={vi.fn()}
      onOrganizeWithDeepSeek={vi.fn()} onRetryFailedDeepSeekChunks={vi.fn()} onCancelDeepSeek={vi.fn()}
      deepSeekCancelRequested onUndoClassification={vi.fn()} onRedoClassification={vi.fn()}
      onMoveHistoryCursor={vi.fn()} onApplyManualClassification={vi.fn()} onApplyManualClassifications={vi.fn()}
      onSaveLocally={vi.fn()} onConfirmAndSync={vi.fn()} onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()}
    />)

    const selector = screen.getByRole('combobox', { name: '整理批次' })
    expect(selector).toBeEnabled()
    fireEvent.change(selector, { target: { value: 'segment-2' } })
    expect(onViewSegment).toHaveBeenCalledWith('segment-2')
    expect(onSelectSegment).not.toHaveBeenCalled()
  })
})
