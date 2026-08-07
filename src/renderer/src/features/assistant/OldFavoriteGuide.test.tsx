import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OldFavoriteGuide } from './OldFavoriteGuide'

describe('OldFavoriteGuide DeepSeek browsing', () => {
  it('keeps whole-run scope when moving from archive preview to confirmation', () => {
    const snapshot = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const, mode: 'incremental' as const,
      segmentSize: 1, hasMultipleSegments: true, scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [], segments: [
        { id: 'segment-1', index: 0, status: 'previewing' as const, itemCount: 1, readiness: 'ready' as const },
        { id: 'segment-2', index: 1, status: 'previewing' as const, itemCount: 1, readiness: 'ready' as const }
      ], currentSegment: { id: 'segment-1', aids: [1], items: [] }, classifications: {},
      recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] },
      overview: { available: true, completedSegmentCount: 2, totalSegmentCount: 2, sourceFolders: [], unavailableItemCount: 0,
        processedItemCount: 2, classifiedItemCount: 2, unmatchedItemCount: 0, waitingItemCount: 0, recommendationCounts: [], archiveTargets: [] }
    }
    const common = {
      snapshot, loading: false, reconciling: false, scanStarting: false, scanStartFailure: null,
      onRetryScan: vi.fn(), onRetryScanDirect: vi.fn(), onRebuildWorkspace: vi.fn(), onSelectSourceFolders: vi.fn(),
      onPauseTagEnrichment: vi.fn(), onResumeTagEnrichment: vi.fn(), onRetryFailedTagEnrichment: vi.fn(), onAcceptCurrentTags: vi.fn(),
      onSetRecommendedCandidates: vi.fn(), ledgers: [], deepSeekAvailable: false, deepSeekFeedback: null, onSelectSegment: vi.fn(),
      onAutoClassify: vi.fn(), onOrganizeWithDeepSeek: vi.fn(), onRetryFailedDeepSeekChunks: vi.fn(), onCancelDeepSeek: vi.fn(),
      deepSeekCancelRequested: false, onUndoClassification: vi.fn(), onRedoClassification: vi.fn(), onMoveHistoryCursor: vi.fn(),
      onApplyManualClassification: vi.fn(), onApplyManualClassifications: vi.fn(), onSaveLocally: vi.fn(), onConfirmAndSync: vi.fn(),
      onExecuteFrozenPlan: vi.fn(), onReconcile: vi.fn()
    }
    render(<OldFavoriteGuide {...common} step="preview" onStepChange={vi.fn()} />)
    fireEvent.click(within(screen.getByRole('group', { name: '归档预览视图' })).getByRole('button', { name: '本轮总览' }))
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    expect(screen.getByRole('button', { name: '本轮总览' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('已汇总 2/2 批')).toBeInTheDocument()
  })

  it('keeps four top-level steps and switches confirmation scope inside the confirmation page', () => {
    const onStepChange = vi.fn()
    const snapshot = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const, mode: 'incremental' as const,
      segmentSize: 1, hasMultipleSegments: true, scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [], segments: [
        { id: 'segment-1', index: 0, status: 'previewing' as const, itemCount: 1, readiness: 'ready' as const },
        { id: 'segment-2', index: 1, status: 'previewing' as const, itemCount: 1, readiness: 'ready' as const }
      ], currentSegment: { id: 'segment-1', aids: [1], items: [] }, classifications: {},
      recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
    }
    render(<OldFavoriteGuide snapshot={snapshot} loading={false} reconciling={false} scanStarting={false} scanStartFailure={null}
      step="confirm" onStepChange={onStepChange} onRetryScan={vi.fn()} onRetryScanDirect={vi.fn()} onRebuildWorkspace={vi.fn()}
      onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()} onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()}
      onAcceptCurrentTags={vi.fn()} onSetRecommendedCandidates={vi.fn()} ledgers={[]} deepSeekAvailable={false} deepSeekFeedback={null}
      onSelectSegment={vi.fn()} onAutoClassify={vi.fn()} onOrganizeWithDeepSeek={vi.fn()} onRetryFailedDeepSeekChunks={vi.fn()}
      onCancelDeepSeek={vi.fn()} deepSeekCancelRequested={false} onUndoClassification={vi.fn()} onRedoClassification={vi.fn()}
      onMoveHistoryCursor={vi.fn()} onApplyManualClassification={vi.fn()} onApplyManualClassifications={vi.fn()}
      onSaveLocally={vi.fn()} onConfirmAndSync={vi.fn()} onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()} />)

    const navigation = screen.getByRole('navigation', { name: '整理收藏步骤' })
    expect(within(navigation).getAllByRole('button').map((button) => button.textContent)).toEqual([
      '扫描概览', '推荐收藏夹', '归档预览', '确认执行'
    ])
    expect(within(navigation).queryByRole('button', { name: '本轮总览' })).not.toBeInTheDocument()
    const confirmationScope = screen.getByRole('group', { name: '确认执行视图' })
    fireEvent.click(within(confirmationScope).getByRole('button', { name: '本轮总览' }))
    expect(onStepChange).not.toHaveBeenCalled()
    expect(screen.getByRole('group', { name: '本轮操作' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '本批操作' })).not.toBeInTheDocument()
  })

  it('restores the batch selector option for switching to the whole-run overview', () => {
    const snapshot = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const, mode: 'incremental' as const,
      segmentSize: 1, hasMultipleSegments: true, scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [], segments: [
        { id: 'segment-1', index: 0, status: 'previewing' as const, itemCount: 1, readiness: 'ready' as const },
        { id: 'segment-2', index: 1, status: 'previewing' as const, itemCount: 1, readiness: 'ready' as const }
      ], currentSegment: { id: 'segment-1', aids: [1], items: [] }, classifications: {},
      recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
    }
    render(<OldFavoriteGuide snapshot={snapshot} loading={false} reconciling={false} scanStarting={false} scanStartFailure={null}
      step="preview" onStepChange={vi.fn()} onRetryScan={vi.fn()} onRetryScanDirect={vi.fn()} onRebuildWorkspace={vi.fn()}
      onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()} onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()}
      onAcceptCurrentTags={vi.fn()} onSetRecommendedCandidates={vi.fn()} ledgers={[]} deepSeekAvailable={false} deepSeekFeedback={null}
      onSelectSegment={vi.fn()} onAutoClassify={vi.fn()} onOrganizeWithDeepSeek={vi.fn()} onRetryFailedDeepSeekChunks={vi.fn()}
      onCancelDeepSeek={vi.fn()} deepSeekCancelRequested={false} onUndoClassification={vi.fn()} onRedoClassification={vi.fn()}
      onMoveHistoryCursor={vi.fn()} onApplyManualClassification={vi.fn()} onApplyManualClassifications={vi.fn()}
      onSaveLocally={vi.fn()} onConfirmAndSync={vi.fn()} onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()} />)
    expect(screen.getByRole('option', { name: '本轮总览' })).toBeInTheDocument()
  })

  it('keeps batch browsing read-only while DeepSeek waits to continue', () => {
    const onSelectSegment = vi.fn()
    const onViewSegment = vi.fn().mockResolvedValue(null)
    const onStepChange = vi.fn()
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
      step="preview" onStepChange={onStepChange} onRetryScan={vi.fn()} onRetryScanDirect={vi.fn()} onRebuildWorkspace={vi.fn()}
      onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()} onResumeTagEnrichment={vi.fn()}
      onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()} onSetRecommendedCandidates={vi.fn()}
      ledgers={[{ id: 'music', displayName: 'Music', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: true }]}
      deepSeekAvailable deepSeekFeedback={{ status: 'waiting', message: 'DeepSeek 正在等待下一批标签补取' }}
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
    expect(screen.getByRole('button', { name: '取消整理' })).toBeEnabled()
    const scanButton = screen.getByRole('button', { name: '扫描概览' })
    expect(scanButton).toBeEnabled()
    fireEvent.click(scanButton)
    expect(onStepChange).toHaveBeenCalledWith('scan')
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

  it('keeps cancellation visible when an all-batch DeepSeek run advances to the scan step', () => {
    const onCancelDeepSeek = vi.fn()
    const onPauseTagEnrichment = vi.fn()
    const snapshot = {
      version: 1 as const,
      accountMid: '100', workspaceId: 'workspace-100', status: 'scanning' as const, mode: 'incremental' as const,
      segmentSize: 1, hasMultipleSegments: true, scan: { phase: 'running' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [],
      segments: [
        { id: 'segment-1', index: 0, status: 'scanning' as const, itemCount: 1, readiness: 'tagging' as const }
      ],
      currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, title: 'Video 1', sourceFolderIds: [] }] },
      classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      tagEnrichment: { status: 'running' as const, totalItemCount: 1, completedItemCount: 0, pendingItemCount: 1, failedItemCount: 0 },
      history: { cursor: 0, length: 0, entries: [] }
    }

    render(<OldFavoriteGuide
      snapshot={snapshot} loading reconciling={false} scanStarting={false} scanStartFailure={null}
      step="scan" onStepChange={vi.fn()} onRetryScan={vi.fn()} onRetryScanDirect={vi.fn()} onRebuildWorkspace={vi.fn()}
      onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={onPauseTagEnrichment} onResumeTagEnrichment={vi.fn()}
      onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()} onSetRecommendedCandidates={vi.fn()}
      ledgers={[]} deepSeekAvailable deepSeekFeedback={{ status: 'running', message: 'DeepSeek 正在等待下一批标签补取' }}
      onSelectSegment={vi.fn()} onViewSegment={vi.fn()} onAutoClassify={vi.fn()}
      onOrganizeWithDeepSeek={vi.fn()} onRetryFailedDeepSeekChunks={vi.fn()} onCancelDeepSeek={onCancelDeepSeek}
      deepSeekCancelRequested={false} onUndoClassification={vi.fn()} onRedoClassification={vi.fn()}
      onMoveHistoryCursor={vi.fn()} onApplyManualClassification={vi.fn()} onApplyManualClassifications={vi.fn()}
      onSaveLocally={vi.fn()} onConfirmAndSync={vi.fn()} onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: '取消整理' }))
    expect(onCancelDeepSeek).toHaveBeenCalledOnce()
    const pauseButton = screen.getByRole('button', { name: '暂停补取标签' })
    expect(pauseButton).toBeEnabled()
    fireEvent.click(pauseButton)
    expect(onPauseTagEnrichment).toHaveBeenCalledOnce()
  })
})
