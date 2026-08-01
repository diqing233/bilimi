import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OldFavoriteScanOverviewStep } from './OldFavoriteScanOverviewStep'

describe('OldFavoriteScanOverviewStep', () => {
  it('defaults a multi-batch scan to the compact whole-run overview and keeps single batches unchanged', () => {
    const snapshot = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const, mode: 'incremental' as const,
      segmentSize: 500, hasMultipleSegments: true,
      scan: { phase: 'complete' as const, failureCount: 0, totalItemCount: 501, scannedItemCount: 501, taggedItemCount: 500, untaggedItemCount: 1 },
      continuationCount: 0,
      sourceFolders: [{ id: 'source', title: '默认收藏夹', itemCount: 501, invalidItemCount: 1, isBilimiWorkFolder: false, selected: true }],
      segments: [
        { id: 'segment-1', index: 0, status: 'previewing' as const, itemCount: 500, readiness: 'ready' as const, completedTagItemCount: 500, pendingTagItemCount: 0 },
        { id: 'segment-2', index: 1, status: 'previewing' as const, itemCount: 1, readiness: 'tagging' as const, completedTagItemCount: 0, pendingTagItemCount: 1 }
      ],
      currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, title: 'Current', sourceFolderIds: ['source'] }] },
      classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] },
      overview: {
        available: true, completedSegmentCount: 1, totalSegmentCount: 2, unavailableItemCount: 1,
        sourceFolders: [{ id: 'source', title: '默认收藏夹', itemCount: 500, invalidItemCount: 1 }],
        recommendationCounts: [], archiveTargets: []
      }
    }
    const props = {
      loading: false, scanStarting: false, scanStartFailure: null, onRetry: vi.fn(), onRetryDirect: vi.fn(),
      onRebuild: vi.fn(), onSelectSourceFolders: vi.fn(), onPauseTagEnrichment: vi.fn(), onResumeTagEnrichment: vi.fn(),
      onRetryFailedTagEnrichment: vi.fn(), onAcceptCurrentTags: vi.fn()
    }
    const rendered = render(<OldFavoriteScanOverviewStep snapshot={snapshot} {...props} />)

    expect(screen.getByRole('group', { name: '扫描概览视图' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '本轮总览' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('已汇总 1/2 批')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: '用户收藏夹' })).toHaveTextContent('默认收藏夹500')

    fireEvent.click(screen.getByRole('button', { name: '当前批次' }))
    expect(screen.getByRole('button', { name: '当前批次' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('table', { name: '用户收藏夹' })).toHaveTextContent('默认收藏夹1')

    rendered.rerender(<OldFavoriteScanOverviewStep snapshot={{ ...snapshot, hasMultipleSegments: false, segments: [snapshot.segments[0]] }} {...props} />)
    expect(screen.queryByRole('group', { name: '扫描概览视图' })).not.toBeInTheDocument()
  })

  it('keeps the scan view mounted when a scan reports a rebuild-required recovery state', () => {
    render(<OldFavoriteScanOverviewStep
      snapshot={{ recovery: 'rebuild-required', preserveCompletedLocalResults: true, accountMid: '100', workspaceId: 'workspace-100' }}
      loading={false} scanStarting={false} scanStartFailure={null} onRetry={vi.fn()} onRetryDirect={vi.fn()}
      onRebuild={vi.fn()} onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()}
      onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
    />)

    expect(screen.getByRole('region', { name: '扫描概览' })).toHaveTextContent('工作镜像损坏')
    expect(screen.getByRole('button', { name: '重建工作镜像并重新扫描' })).toBeEnabled()
  })

  it('shows an unstarted state until the user starts old-favorite organization', () => {
    render(<OldFavoriteScanOverviewStep
      snapshot={null} loading={false} scanStarting={false} scanStartFailure={null} onRetry={vi.fn()} onRetryDirect={vi.fn()}
      onRebuild={vi.fn()} onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()}
      onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
    />)

    expect(screen.getByText('尚未开始扫描，请点击“整理收藏”后扫描。')).toBeInTheDocument()
    expect(screen.getByText('尚未开始')).toBeInTheDocument()
    expect(screen.queryByText('正在扫描')).not.toBeInTheDocument()
  })

  it('reports formally protected videos skipped by an incremental scan', () => {
    render(<OldFavoriteScanOverviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 },
        protectedAidCount: 3, continuationCount: 0, sourceFolders: [], segments: [], currentSegment: null,
        classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
      }}
      loading={false} scanStarting={false} scanStartFailure={null} onRetry={vi.fn()} onRetryDirect={vi.fn()}
      onRebuild={vi.fn()} onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()}
      onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
    />)

    expect(screen.getByRole('status')).toHaveTextContent('增量扫描已跳过 3 条已保护视频')
  })

  it('separates source, pending, protected, and tag-read counts without calling empty cached items confirmed untagged', () => {
    render(<OldFavoriteScanOverviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false,
        scan: { phase: 'complete', failureCount: 0, totalItemCount: 246, scannedItemCount: 25, taggedItemCount: 25, untaggedItemCount: 0 },
        protectedAidCount: 221, continuationCount: 0,
        sourceFolders: [{ id: 'source', title: '默认收藏夹', itemCount: 246, isBilimiWorkFolder: false, selected: true }],
        segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
        history: { cursor: 0, length: 0, entries: [] }, planReadiness: { selectedAidCount: 25, classifiedAidCount: 0, unclassifiedAidCount: 25 },
        tagEnrichment: { status: 'complete', totalItemCount: 25, completedItemCount: 25, pendingItemCount: 0, failedItemCount: 0 }
      }}
      loading={false} scanStarting={false} scanStartFailure={null} onRetry={vi.fn()} onRetryDirect={vi.fn()}
      onRebuild={vi.fn()} onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()}
      onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
    />)

    expect(screen.getByLabelText('本轮整理统计')).toHaveTextContent('来源总数246')
    expect(screen.getByLabelText('本轮整理统计')).toHaveTextContent('本轮待整理25')
    expect(screen.getByLabelText('本轮整理统计')).toHaveTextContent('已保护跳过221')
    expect(screen.getByLabelText('标签补取结果')).toHaveTextContent('沿用历史标签0')
    expect(screen.getByLabelText('标签补取结果')).toHaveTextContent('本轮获取标签25')
    expect(screen.getByLabelText('标签补取结果')).toHaveTextContent('本轮确认无标签0')
    expect(screen.getByText('扫描会读取来源列表用于增量比对；仅本轮待整理的视频会补取标签。')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: '用户收藏夹' })).toHaveTextContent('全选·用户收藏夹（1）总数（246）已选来源⇄（246）默认收藏夹246246')
  })

  it('shows tag enrichment once and keeps its actions in one equal-width row', () => {
    render(<OldFavoriteScanOverviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false,
        scan: { phase: 'complete', failureCount: 0, totalItemCount: 244, scannedItemCount: 244, taggedItemCount: 183, untaggedItemCount: 61 },
        continuationCount: 0, sourceFolders: [], segments: [], currentSegment: null, classifications: {},
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] },
        tagEnrichment: { status: 'running', totalItemCount: 244, completedItemCount: 184, pendingItemCount: 60, failedItemCount: 0 }
      }}
      loading={false} scanStarting={false} scanStartFailure={null} onRetry={vi.fn()} onRetryDirect={vi.fn()}
      onRebuild={vi.fn()} onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()}
      onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
    />)

    expect(screen.getByText('标签补取进行中：已处理 184 / 244 条。')).toBeInTheDocument()
    expect(screen.getByLabelText('标签补取结果')).toHaveTextContent('本轮获取标签183')
    expect(screen.getByText('标签是重要的分类依据，建议耐心等待获取完成。暂停会保留已取得标签；采用当前标签会用当前结果继续本轮整理，未读取项不自动加入。')).toBeInTheDocument()
    expect(screen.getByTestId('tag-enrichment-actions')).toHaveClass('favorite-ledger-panel__scan-enrichment-actions')
  })

  it('lets adopted current tags resume later and retries only failed tag reads', () => {
    const resume = vi.fn()
    const retryFailed = vi.fn()
    render(<OldFavoriteScanOverviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false,
        scan: { phase: 'complete', failureCount: 0, totalItemCount: 3, scannedItemCount: 3, taggedItemCount: 1, untaggedItemCount: 2 },
        continuationCount: 0, sourceFolders: [], segments: [], currentSegment: null, classifications: {},
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] },
        tagEnrichment: { status: 'accepted', totalItemCount: 3, completedItemCount: 2, pendingItemCount: 1, failedItemCount: 1 }
      }}
      loading={false} scanStarting={false} scanStartFailure={null} onRetry={vi.fn()} onRetryDirect={vi.fn()}
      onRebuild={vi.fn()} onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()}
      onResumeTagEnrichment={resume} onAcceptCurrentTags={vi.fn()} onRetryFailedTagEnrichment={retryFailed}
    />)

    expect(screen.getByRole('button', { name: '继续补取标签' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '采用当前标签' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新补取失败标签' })).toBeInTheDocument()
  })

  it('keeps classified source folders selectable and makes the header control select all only', () => {
    const selectSourceFolders = vi.fn()
    render(<OldFavoriteScanOverviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false,
        scan: { phase: 'complete', failureCount: 0, totalItemCount: 3, scannedItemCount: 3, taggedItemCount: 3, untaggedItemCount: 0 },
        continuationCount: 0,
        sourceFolders: [
          { id: 'source-a', title: '收藏夹 A', itemCount: 2, isBilimiWorkFolder: false, selected: true },
          { id: 'source-b', title: '收藏夹 B', itemCount: 1, isBilimiWorkFolder: false, selected: false }
        ],
        segments: [], currentSegment: null,
        classifications: { '1': { aid: 1, targetLedgerIds: ['knowledge'], source: 'system-high' } },
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
      }}
      loading={false} scanStarting={false} scanStartFailure={null} onRetry={vi.fn()} onRetryDirect={vi.fn()}
      onRebuild={vi.fn()} onSelectSourceFolders={selectSourceFolders} onPauseTagEnrichment={vi.fn()}
      onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
    />)

    const sourceA = screen.getByRole('checkbox', { name: '选择来源 收藏夹 A' })
    expect(sourceA).toBeEnabled()
    fireEvent.click(sourceA)
    expect(selectSourceFolders).toHaveBeenLastCalledWith([])

    const selectAll = screen.getByRole('checkbox', { name: '全选来源' })
    expect(selectAll).not.toBeChecked()
    fireEvent.click(selectAll)
    expect(selectSourceFolders).toHaveBeenLastCalledWith(['source-a', 'source-b'])
  })

  it('deselects every user source when the checked header control is clicked', () => {
    const selectSourceFolders = vi.fn()
    render(<OldFavoriteScanOverviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false,
        scan: { phase: 'complete', failureCount: 0, totalItemCount: 3, scannedItemCount: 3, taggedItemCount: 3, untaggedItemCount: 0 },
        continuationCount: 0,
        sourceFolders: [
          { id: 'source-a', title: 'Source A', itemCount: 2, isBilimiWorkFolder: false, selected: true },
          { id: 'source-b', title: 'Source B', itemCount: 1, isBilimiWorkFolder: false, selected: true }
        ],
        segments: [], currentSegment: null, classifications: {},
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
      }}
      loading={false} scanStarting={false} scanStartFailure={null} onRetry={vi.fn()} onRetryDirect={vi.fn()}
      onRebuild={vi.fn()} onSelectSourceFolders={selectSourceFolders} onPauseTagEnrichment={vi.fn()}
      onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('checkbox', { name: '全选来源' }))

    expect(selectSourceFolders).toHaveBeenCalledWith([])
  })

  it('toggles the source summary column between selected and unavailable counts', () => {
    render(<OldFavoriteScanOverviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false,
        scan: { phase: 'complete', failureCount: 0, totalItemCount: 5, scannedItemCount: 5, taggedItemCount: 2, untaggedItemCount: 0 },
        continuationCount: 0,
        sourceFolders: [
          { id: 'source-a', title: '收藏夹 A', itemCount: 3, invalidItemCount: 1, isBilimiWorkFolder: false, selected: true },
          { id: 'source-b', title: '收藏夹 B', itemCount: 2, invalidItemCount: 2, isBilimiWorkFolder: false, selected: false }
        ],
        segments: [], currentSegment: null, classifications: {},
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
      }}
      loading={false} scanStarting={false} scanStartFailure={null} onRetry={vi.fn()} onRetryDirect={vi.fn()}
      onRebuild={vi.fn()} onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()}
      onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
    />)

    const rows = screen.getAllByRole('row').slice(-2)
    expect(screen.getByText('全选')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '总数（5）' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '已选来源（3）' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '已选来源（3）' })).toHaveTextContent('⇄')
    expect(rows[0]).toHaveTextContent('收藏夹 A33')
    expect(rows[1]).toHaveTextContent('收藏夹 B20')

    fireEvent.click(screen.getByRole('button', { name: '已选来源（3）' }))

    expect(screen.getByRole('button', { name: '失效视频（3）' })).toBeInTheDocument()
    expect(rows[0]).toHaveTextContent('收藏夹 A31')
    expect(rows[1]).toHaveTextContent('收藏夹 B22')
  })
})
