import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { OldFavoriteGuide } from './OldFavoriteGuide'

describe('OldFavoriteGuide DeepSeek browsing', () => {
  it('remeasures sidebar guide help after the hidden tooltip becomes visible', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/OldFavoriteGuide.tsx'), 'utf8')

    expect(source).toContain('}, [guideHintVisible])')
    expect(source).toContain('resizeObserver?.observe(guideHintPanelRef.current)')
  })

  it('explains that selected unbacked folders are backed up during Bilibili sync', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/OldFavoriteGuide.tsx'), 'utf8')

    expect(source).toContain('如有勾选未备册的收藏夹会同时备册')
  })

  it('shows the complete organizing reminder in both the guide tooltip and expanded instructions', () => {
    window.localStorage.removeItem('bilimi:old-favorite-hint-open')

    render(<OldFavoriteGuide
      snapshot={null} loading={false} reconciling={false} scanStarting={false} scanStartFailure={null}
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

    const toggle = screen.getByRole('button', { name: '固定显示整理收藏说明' })
    expect(toggle).not.toHaveAttribute('title')
    expect(toggle).toHaveAttribute('aria-describedby', 'favorite-organization-help-tooltip')
    expect(screen.getByRole('tooltip')).toHaveTextContent('小咪提醒：同一个视频可以保存在多个收藏夹里。')
    expect(screen.getByRole('tooltip')).toHaveTextContent('扫描所有视频收藏的基本信息。扫描完成后会补取标签，标签是分类的重要依据，建议耐心等待，不要提前采用；默认扫描到的全部收藏夹参与分类整理，可以取消不想整理的非bilimi收藏夹。')
    expect(screen.getByRole('tooltip')).toHaveTextContent('勾选后的收藏夹会参与整理收藏分类；也可以自建收藏夹，保存并勾选即可参与分类。未备册不影响本轮草稿，整理结束后可再备册并同步到 B 站。')
    expect(screen.getByRole('tooltip')).toHaveTextContent('检查分类结果，由于本地分类能力有限，建议用DeepSeek辅助整理未匹配到合适分类和把握不太稳的视频，也可手动调整转移。在上方收藏夹区域编辑或者新增bilimi收藏夹，归档预览会重新计算。')
    expect(screen.getByRole('tooltip')).toHaveTextContent('可以选择先保留整理草稿，或者删除草稿结束本轮整理。')
    expect(screen.getByRole('tooltip').parentElement).toBe(document.body)

    fireEvent.click(toggle)

    expect(screen.getByRole('tooltip')).toBeVisible()
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('does not open organizing help on hover or focus', () => {
    render(<OldFavoriteGuide
      snapshot={null} loading={false} reconciling={false} scanStarting={false} scanStartFailure={null}
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

    const toggle = screen.getByRole('button', { name: '固定显示整理收藏说明' })
    fireEvent.mouseEnter(toggle)
    fireEvent.focus(toggle)
    expect(screen.getByRole('tooltip')).not.toHaveAttribute('data-visible')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes organizing help when the ledger workspace becomes inactive', () => {
    render(<OldFavoriteGuide
      snapshot={null} loading={false} reconciling={false} scanStarting={false} scanStartFailure={null}
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

    const toggle = screen.getByRole('button', { name: '固定显示整理收藏说明' })
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    act(() => window.dispatchEvent(new Event('bilimi:favorite-ledger-workspace-inactive')))
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('tooltip')).not.toHaveAttribute('data-visible')
  })

  it('uses round-level metrics while scanning basic video information', () => {
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
    expect(metrics).toHaveTextContent('扫描总数140')
    expect(screen.getByLabelText('本轮待整理')).toHaveTextContent('待确认')
    expect(screen.queryByText('已扫描 140 条视频，待获取标签')).not.toBeInTheDocument()
  })

  it('puts continue scan and finish organization side by side for a paused scan', () => {
    const onResumeScan = vi.fn()
    const onFinishScan = vi.fn()
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
      onPauseScan={vi.fn()} onResumeScan={onResumeScan} onFinishScan={onFinishScan} scanPaused
      onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()} onResumeTagEnrichment={vi.fn()}
      onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()} onSetRecommendedCandidates={vi.fn()}
      ledgers={[]} deepSeekAvailable={false} deepSeekFeedback={null}
      onSelectSegment={vi.fn()} onAutoClassify={vi.fn()} onOrganizeWithDeepSeek={vi.fn()}
      onRetryFailedDeepSeekChunks={vi.fn()} onCancelDeepSeek={vi.fn()} deepSeekCancelRequested={false}
      onUndoClassification={vi.fn()} onRedoClassification={vi.fn()} onMoveHistoryCursor={vi.fn()}
      onApplyManualClassification={vi.fn()} onApplyManualClassifications={vi.fn()}
      onSaveLocally={vi.fn()} onConfirmAndSync={vi.fn()} onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()}
    />)

    const actions = screen.getByRole('group', { name: '扫描操作' })
    expect(within(actions).getAllByRole('button').map((button) => button.textContent)).toEqual(['继续扫描', '结束整理'])
    fireEvent.click(within(actions).getByRole('button', { name: '继续扫描' }))
    fireEvent.click(within(actions).getByRole('button', { name: '结束整理' }))
    expect(onResumeScan).toHaveBeenCalledOnce()
    expect(onFinishScan).toHaveBeenCalledOnce()
  })

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

  it('defaults a newly entered multi-batch workspace to the whole-run overview without resetting a manual batch choice', () => {
    const snapshot = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const, mode: 'incremental' as const,
      segmentSize: 1, hasMultipleSegments: true, scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [], segments: [
        { id: 'segment-1', index: 0, status: 'previewing' as const, itemCount: 1, readiness: 'ready' as const },
        { id: 'segment-2', index: 1, status: 'previewing' as const, itemCount: 1, readiness: 'ready' as const }
      ], currentSegment: { id: 'segment-1', aids: [1], items: [] }, classifications: {},
      recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 },
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
    const rendered = render(<OldFavoriteGuide {...common} step="preview" onStepChange={vi.fn()} />)

    expect(screen.getByRole('combobox', { name: '整理批次' })).toHaveValue('__whole-run__')
    fireEvent.change(screen.getByRole('combobox', { name: '整理批次' }), { target: { value: 'segment-1' } })
    rendered.rerender(<OldFavoriteGuide {...common} snapshot={{ ...snapshot, scan: { ...snapshot.scan } }} step="preview" onStepChange={vi.fn()} />)
    expect(screen.getByRole('combobox', { name: '整理批次' })).toHaveValue('segment-1')
  })

  it('defaults to the whole-run view when one workspace grows from one segment to multiple segments', () => {
    const singleSnapshot = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-growing', status: 'previewing' as const, mode: 'incremental' as const,
      segmentSize: 1, hasMultipleSegments: false, scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [], segments: [
        { id: 'segment-1', index: 0, status: 'previewing' as const, itemCount: 1, readiness: 'ready' as const }
      ], currentSegment: { id: 'segment-1', aids: [1], items: [] }, classifications: {},
      recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 }
    }
    const multiSnapshot = {
      ...singleSnapshot,
      hasMultipleSegments: true,
      segments: [
        ...singleSnapshot.segments,
        { id: 'segment-2', index: 1, status: 'previewing' as const, itemCount: 1, readiness: 'ready' as const }
      ],
      overview: { available: true, completedSegmentCount: 2, totalSegmentCount: 2, sourceFolders: [], unavailableItemCount: 0,
        processedItemCount: 2, classifiedItemCount: 2, unmatchedItemCount: 0, waitingItemCount: 0, recommendationCounts: [], archiveTargets: [] }
    }
    const common = {
      loading: false, reconciling: false, scanStarting: false, scanStartFailure: null,
      onRetryScan: vi.fn(), onRetryScanDirect: vi.fn(), onRebuildWorkspace: vi.fn(), onSelectSourceFolders: vi.fn(),
      onPauseTagEnrichment: vi.fn(), onResumeTagEnrichment: vi.fn(), onRetryFailedTagEnrichment: vi.fn(), onAcceptCurrentTags: vi.fn(),
      onSetRecommendedCandidates: vi.fn(), ledgers: [], deepSeekAvailable: false, deepSeekFeedback: null, onSelectSegment: vi.fn(),
      onAutoClassify: vi.fn(), onOrganizeWithDeepSeek: vi.fn(), onRetryFailedDeepSeekChunks: vi.fn(), onCancelDeepSeek: vi.fn(),
      deepSeekCancelRequested: false, onUndoClassification: vi.fn(), onRedoClassification: vi.fn(), onMoveHistoryCursor: vi.fn(),
      onApplyManualClassification: vi.fn(), onApplyManualClassifications: vi.fn(), onSaveLocally: vi.fn(), onConfirmAndSync: vi.fn(),
      onExecuteFrozenPlan: vi.fn(), onReconcile: vi.fn()
    }
    const rendered = render(<OldFavoriteGuide {...common} snapshot={singleSnapshot} step="preview" onStepChange={vi.fn()} />)

    expect(screen.queryByRole('combobox', { name: '整理批次' })).not.toBeInTheDocument()
    rendered.rerender(<OldFavoriteGuide {...common} snapshot={multiSnapshot} step="preview" onStepChange={vi.fn()} />)

    expect(screen.getByRole('combobox', { name: '整理批次' })).toHaveValue('__whole-run__')
  })

  it('shows ready-batch recommendations in the whole-run view while another batch still enriches tags', () => {
    const snapshot = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const, mode: 'incremental' as const,
      segmentSize: 500, hasMultipleSegments: true, scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [], segments: [
        { id: 'segment-ready', index: 0, status: 'previewing' as const, itemCount: 500, readiness: 'ready' as const, completedTagItemCount: 500, pendingTagItemCount: 0 },
        { id: 'segment-enriching', index: 1, status: 'previewing' as const, itemCount: 1, readiness: 'tagging' as const, completedTagItemCount: 0, pendingTagItemCount: 1 }
      ], currentSegment: { id: 'segment-ready', aids: [], items: [] }, classifications: {},
      recommendations: {
        candidates: [{ id: 'tag-ready', displayName: '已就绪标签', kind: 'tag' as const, count: 12, currentSegmentCount: 12, reason: 'ready' }],
        adoptedCandidateIds: []
      },
      tagEnrichment: { status: 'running' as const, totalItemCount: 501, completedItemCount: 500, pendingItemCount: 1, failedItemCount: 0 },
      history: { cursor: 0, length: 0, entries: [] },
      overview: {
        available: true, completedSegmentCount: 1, totalSegmentCount: 2, unavailableItemCount: 0, sourceFolders: [], archiveTargets: [],
        recommendationCounts: [{ id: 'tag-ready', count: 12 }]
      }
    }

    render(<OldFavoriteGuide
      snapshot={snapshot} loading={false} reconciling={false} scanStarting={false} scanStartFailure={null}
      step="generated" onStepChange={vi.fn()} onRetryScan={vi.fn()} onRetryScanDirect={vi.fn()} onRebuildWorkspace={vi.fn()}
      onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()} onResumeTagEnrichment={vi.fn()}
      onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()} onSetRecommendedCandidates={vi.fn()}
      ledgers={[]} deepSeekAvailable={false} deepSeekFeedback={null}
      onSelectSegment={vi.fn()} onAutoClassify={vi.fn()} onOrganizeWithDeepSeek={vi.fn()}
      onRetryFailedDeepSeekChunks={vi.fn()} onCancelDeepSeek={vi.fn()} deepSeekCancelRequested={false}
      onUndoClassification={vi.fn()} onRedoClassification={vi.fn()} onMoveHistoryCursor={vi.fn()}
      onApplyManualClassification={vi.fn()} onApplyManualClassifications={vi.fn()}
      onSaveLocally={vi.fn()} onConfirmAndSync={vi.fn()} onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()}
    />)

    fireEvent.change(screen.getByRole('combobox', { name: '整理批次' }), { target: { value: '__whole-run__' } })

    expect(screen.getByText('已汇总 1/2 批')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '已就绪标签' })).toBeInTheDocument()
    expect(screen.queryByText('本轮仍有标签补取中，完成批次会在就绪后汇总到推荐收藏夹。')).not.toBeInTheDocument()
  })

  it('locks whole-run recommendation changes when the active batch is still enriching tags', () => {
    const snapshot = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-enriching', status: 'previewing' as const, mode: 'incremental' as const,
      segmentSize: 500, hasMultipleSegments: true, scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [], segments: [
        { id: 'segment-ready', index: 0, status: 'previewing' as const, itemCount: 500, readiness: 'ready' as const, completedTagItemCount: 500, pendingTagItemCount: 0 },
        { id: 'segment-enriching', index: 1, status: 'previewing' as const, itemCount: 1, readiness: 'tagging' as const, completedTagItemCount: 0, pendingTagItemCount: 1 }
      ], currentSegment: { id: 'segment-enriching', aids: [501], items: [] }, classifications: {},
      recommendations: {
        candidates: [{ id: 'tag-ready', displayName: '已就绪标签', kind: 'tag' as const, count: 12, currentSegmentCount: 0, reason: 'ready' }],
        adoptedCandidateIds: []
      },
      tagEnrichment: { status: 'running' as const, totalItemCount: 501, completedItemCount: 500, pendingItemCount: 1, failedItemCount: 0 },
      history: { cursor: 0, length: 0, entries: [] },
      overview: {
        available: true, completedSegmentCount: 1, totalSegmentCount: 2, unavailableItemCount: 0, sourceFolders: [], archiveTargets: [],
        recommendationCounts: [{ id: 'tag-ready', count: 12 }]
      }
    }

    render(<OldFavoriteGuide
      snapshot={snapshot} loading={false} reconciling={false} scanStarting={false} scanStartFailure={null}
      step="generated" onStepChange={vi.fn()} onRetryScan={vi.fn()} onRetryScanDirect={vi.fn()} onRebuildWorkspace={vi.fn()}
      onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()} onResumeTagEnrichment={vi.fn()}
      onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()} onSetRecommendedCandidates={vi.fn()}
      ledgers={[]} deepSeekAvailable={false} deepSeekFeedback={null}
      onSelectSegment={vi.fn()} onAutoClassify={vi.fn()} onOrganizeWithDeepSeek={vi.fn()}
      onRetryFailedDeepSeekChunks={vi.fn()} onCancelDeepSeek={vi.fn()} deepSeekCancelRequested={false}
      onUndoClassification={vi.fn()} onRedoClassification={vi.fn()} onMoveHistoryCursor={vi.fn()}
      onApplyManualClassification={vi.fn()} onApplyManualClassifications={vi.fn()}
      onSaveLocally={vi.fn()} onConfirmAndSync={vi.fn()} onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()}
    />)

    fireEvent.change(screen.getByRole('combobox', { name: '整理批次' }), { target: { value: '__whole-run__' } })

    expect(screen.getByRole('checkbox', { name: '已就绪标签' })).toBeDisabled()
    expect(screen.getByText('当前批次标签补取中，完成后可修改推荐收藏夹。')).toBeInTheDocument()
  })

  it('shows the adopted whole-run recommendations and archive preview while retaining pending tag facts', () => {
    const snapshot = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-accepted', status: 'previewing' as const, mode: 'incremental' as const,
      segmentSize: 1, hasMultipleSegments: true, scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2, isBilimiWorkFolder: false, selected: true }], segments: [
        { id: 'segment-1', index: 0, status: 'previewing' as const, itemCount: 1, readiness: 'ready' as const, completedTagItemCount: 1, pendingTagItemCount: 0 },
        { id: 'segment-2', index: 1, status: 'previewing' as const, itemCount: 1, readiness: 'ready' as const, completedTagItemCount: 0, pendingTagItemCount: 1 }
      ], currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, title: '已采用结果', sourceFolderIds: ['source'] }] },
      classifications: { '1': { aid: 1, targetLedgerIds: ['knowledge'], source: 'system-high' as const } },
      recommendations: {
        candidates: [{ id: 'tag-accepted', displayName: '已采用标签', kind: 'tag' as const, count: 1, currentSegmentCount: 1, reason: 'accepted' }],
        adoptedCandidateIds: ['tag-accepted']
      },
      tagEnrichment: {
        status: 'accepted' as const, totalItemCount: 2, completedItemCount: 1, pendingItemCount: 1, failedItemCount: 0,
        wholeRunTagCutoffAccepted: true
      },
      planReadiness: { selectedAidCount: 2, classifiedAidCount: 1, unclassifiedAidCount: 1 },
      history: { cursor: 0, length: 0, entries: [] },
      overview: {
        available: true, completedSegmentCount: 2, totalSegmentCount: 2, unavailableItemCount: 0, sourceFolders: [],
        processedItemCount: 2, classifiedItemCount: 1, unmatchedItemCount: 1, waitingItemCount: 0,
        recommendationCounts: [{ id: 'tag-accepted', count: 1 }],
        archiveTargets: [
          { ledgerId: 'knowledge', itemCount: 1, segmentCounts: [{ segmentId: 'segment-1', count: 1 }] },
          { ledgerId: 'inbox', itemCount: 1, segmentCounts: [{ segmentId: 'segment-2', count: 1 }] }
        ]
      }
    }
    const common = {
      snapshot, loading: false, reconciling: false, scanStarting: false, scanStartFailure: null,
      onRetryScan: vi.fn(), onRetryScanDirect: vi.fn(), onRebuildWorkspace: vi.fn(), onSelectSourceFolders: vi.fn(),
      onPauseTagEnrichment: vi.fn(), onResumeTagEnrichment: vi.fn(), onRetryFailedTagEnrichment: vi.fn(), onAcceptCurrentTags: vi.fn(),
      onSetRecommendedCandidates: vi.fn(), ledgers: [{ id: 'knowledge', displayName: '知识', keywords: [], enabled: true, priority: 0, isDefault: true }],
      deepSeekAvailable: false, deepSeekFeedback: null, onSelectSegment: vi.fn(), onAutoClassify: vi.fn(), onOrganizeWithDeepSeek: vi.fn(),
      onRetryFailedDeepSeekChunks: vi.fn(), onCancelDeepSeek: vi.fn(), deepSeekCancelRequested: false, onUndoClassification: vi.fn(), onRedoClassification: vi.fn(), onMoveHistoryCursor: vi.fn(),
      onApplyManualClassification: vi.fn(), onApplyManualClassifications: vi.fn(), onSaveLocally: vi.fn(), onConfirmAndSync: vi.fn(),
      onExecuteFrozenPlan: vi.fn(), onReconcile: vi.fn()
    }
    const rendered = render(<OldFavoriteGuide {...common} step="generated" onStepChange={vi.fn()} />)

    expect(screen.getByRole('checkbox', { name: '已采用标签' })).toBeInTheDocument()
    expect(screen.queryByText('当前批次标签补取中，完成后将生成推荐收藏夹。')).not.toBeInTheDocument()

    rendered.rerender(<OldFavoriteGuide {...common} step="preview" onStepChange={vi.fn()} />)
    expect(screen.getByText('已采用结果')).toBeInTheDocument()
    expect(screen.queryByText('当前批次标签补取中，完成后可查看归档预览。')).not.toBeInTheDocument()
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
      onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()} onResumeTagEnrichment={vi.fn()}
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
    expect(screen.queryByRole('button', { name: '暂停补取标签' })).not.toBeInTheDocument()
  })
})
