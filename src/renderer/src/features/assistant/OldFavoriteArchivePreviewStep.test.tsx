import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OldFavoriteArchivePreviewStep } from './OldFavoriteArchivePreviewStep'

describe('OldFavoriteArchivePreviewStep', () => {
  it('uses the legacy preview title bar and content shell around current workspace data', () => {
    render(<OldFavoriteArchivePreviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 },
        continuationCount: 0, sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false, selected: true }],
        segments: [], currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, title: 'Preview', sourceFolderIds: ['source'] }] },
        classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 }
      }}
      ledgers={[]}
      loading={false}
      deepSeekAvailable={false}
      deepSeekFeedback={null}
      onSelectSegment={vi.fn()}
      onAutoClassify={vi.fn()}
      onOrganizeWithDeepSeek={vi.fn()}
      onUndo={vi.fn()}
      onRedo={vi.fn()}
      onApplyManualClassification={vi.fn()}
      onCreateLocalLedgerAndReclassify={vi.fn()}
    />)

    const region = screen.getByRole('region', { name: '\u5f52\u6863\u9884\u89c8' })
    const heading = screen.getByRole('heading', { name: '\u5f52\u6863\u9884\u89c8' })

    expect(heading).toHaveClass('favorite-ledger-panel__step-title')
    expect(heading.closest('.favorite-ledger-panel__preview-topbar')).not.toBeNull()
    expect(region).toHaveClass('favorite-ledger-panel__preview')
    expect(region.querySelector(':scope > p.favorite-ledger-panel__step-note')).toHaveTextContent('当前分段 1 条；只加载并显示这一段。')
    expect(region.querySelector('.favorite-ledger-panel__preview-new-ledger')).toBeNull()
    expect(region.querySelector('.favorite-ledger-panel__preview-toolbar')).toBeNull()
    expect(region.querySelector('.favorite-ledger-panel__preview-tools .favorite-ledger-panel__archive-tool-card')).not.toBeNull()
    expect(screen.getByRole('group', { name: 'DeepSeek 辅助整理' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '归档预览改动操作' })).toBeInTheDocument()

    expect(screen.queryByRole('button', { name: '自动分类当前分段' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '新建收藏夹后重新归类' })).not.toBeInTheDocument()
  })

  it('places a full-width dashed divider between DeepSeek organization and change history', () => {
    const { container } = render(<OldFavoriteArchivePreviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 },
        continuationCount: 0, sourceFolders: [], segments: [],
        currentSegment: { id: 'segment-1', aids: [], items: [] }, classifications: {},
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 }
      }}
      ledgers={[]} loading={false} deepSeekAvailable={false} deepSeekFeedback={null}
      onSelectSegment={vi.fn()} onAutoClassify={vi.fn()} onOrganizeWithDeepSeek={vi.fn()}
      onUndo={vi.fn()} onRedo={vi.fn()} onApplyManualClassification={vi.fn()} onCreateLocalLedgerAndReclassify={vi.fn()}
    />)

    const toolCard = container.querySelector('.favorite-ledger-panel__archive-tool-card')
    const divider = toolCard?.querySelector('.favorite-ledger-panel__archive-tool-divider--full-width')

    expect(divider).not.toBeNull()
    expect(divider?.previousElementSibling).toHaveClass('favorite-ledger-panel__deepseek-archive-section')
    expect(divider?.nextElementSibling).toHaveClass('favorite-ledger-panel__archive-history-section')
  })

  it('restores the legacy change-record entry and groups unmatched and classified videos', () => {
    render(<OldFavoriteArchivePreviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2, isBilimiWorkFolder: false, selected: true }],
        segments: [], currentSegment: {
          id: 'segment-1', aids: [1, 2], items: [
            { aid: 1, title: 'Matched', sourceFolderIds: ['source'] },
            { aid: 2, title: 'Unmatched', sourceFolderIds: ['source'] }
          ]
        },
        classifications: { '1': { aid: 1, targetLedgerIds: ['music'], source: 'system-high' } },
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 1, length: 2 }
      }}
      ledgers={[{ id: 'music', displayName: '音乐舞台', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: true }]}
      loading={false} deepSeekAvailable={false} deepSeekFeedback={null}
      onSelectSegment={vi.fn()} onAutoClassify={vi.fn()} onOrganizeWithDeepSeek={vi.fn()}
      onUndo={vi.fn()} onRedo={vi.fn()} onApplyManualClassification={vi.fn()} onCreateLocalLedgerAndReclassify={vi.fn()}
    />)

    expect(screen.getByText('改动记录')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '撤销本次改动' })).toBeEnabled()
    expect(screen.getByRole('group', { name: '未匹配到合适分类 1 条' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '音乐舞台 1 条' })).toBeInTheDocument()
  })

  it('restores a select-all control for every concrete archive group', () => {
    const onApplyManualClassifications = vi.fn()
    render(<OldFavoriteArchivePreviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2, isBilimiWorkFolder: false, selected: true }],
        segments: [], currentSegment: {
          id: 'segment-1', aids: [1, 2], items: [
            { aid: 1, title: 'Matched', sourceFolderIds: ['source'] },
            { aid: 2, title: 'Unmatched', sourceFolderIds: ['source'] }
          ]
        },
        classifications: { '1': { aid: 1, targetLedgerIds: ['music'], source: 'system-high' } },
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 }
      }}
      ledgers={[{ id: 'music', displayName: '音乐舞台', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: true }]}
      loading={false} deepSeekAvailable={false} deepSeekFeedback={null}
      onSelectSegment={vi.fn()} onOrganizeWithDeepSeek={vi.fn()} onRetryFailedDeepSeekChunks={vi.fn()}
      onUndo={vi.fn()} onRedo={vi.fn()} onMoveHistoryCursor={vi.fn()} onApplyManualClassification={vi.fn()}
      onApplyManualClassifications={onApplyManualClassifications}
    />)

    expect(screen.getByRole('checkbox', { name: '全选 音乐舞台' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '全部存入暂存' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: '全选 音乐舞台' }))
    expect(onApplyManualClassifications).toHaveBeenCalledWith([{ aid: 1, targetLedgerIds: [] }])
  })

  it('uses the legacy 280px virtual track width for large preview groups', () => {
    const items = Array.from({ length: 51 }, (_, index) => ({
      aid: index + 1, title: `Video ${index + 1}`, sourceFolderIds: ['source']
    }))
    render(<OldFavoriteArchivePreviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [{ id: 'source', title: 'Source', itemCount: items.length, isBilimiWorkFolder: false, selected: true }],
        segments: [], currentSegment: { id: 'segment-1', aids: items.map((item) => item.aid), items },
        classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 }
      }}
      ledgers={[]} loading={false} deepSeekAvailable={false} deepSeekFeedback={null}
      onSelectSegment={vi.fn()} onAutoClassify={vi.fn()} onOrganizeWithDeepSeek={vi.fn()}
      onUndo={vi.fn()} onRedo={vi.fn()} onApplyManualClassification={vi.fn()} onCreateLocalLedgerAndReclassify={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: '显示全部 51 条' }))
    expect(document.querySelector('.favorite-ledger-panel__virtual-track-spacer')).toHaveStyle({ width: '14280px' })
  })

  it('shows the legacy DeepSeek progress bar while main-process chunks are running', () => {
    render(<OldFavoriteArchivePreviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [{ id: 'source', title: 'Source', itemCount: 20, isBilimiWorkFolder: false, selected: true }],
        segments: [], currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, title: 'Preview', sourceFolderIds: ['source'] }] },
        classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 }
      }}
      ledgers={[]} loading={true} deepSeekAvailable={true}
      deepSeekFeedback={{ status: 'running', message: 'DeepSeek 正在整理当前分段…', progress: { totalChunks: 2, completedChunks: 1, totalVideoCount: 21, successfulVideoCount: 20, failedVideoCount: 0 } }}
      onSelectSegment={vi.fn()} onOrganizeWithDeepSeek={vi.fn()} onRetryFailedDeepSeekChunks={vi.fn()}
      onUndo={vi.fn()} onRedo={vi.fn()} onMoveHistoryCursor={vi.fn()} onApplyManualClassification={vi.fn()} onApplyManualClassifications={vi.fn()}
    />)

    expect(screen.getByRole('progressbar', { name: 'DeepSeek 整理进度' })).toHaveAttribute('aria-valuenow', '50')
    expect(screen.getByText('第 1 / 2 批')).toBeInTheDocument()
    expect(screen.getByText('已完成 20 / 21 条视频')).toBeInTheDocument()
  })

  it('replaces the DeepSeek run action with a cancellable current-batch action while running', () => {
    const onCancelDeepSeek = vi.fn()
    const { rerender } = render(<OldFavoriteArchivePreviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false, selected: true }],
        segments: [], currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, title: 'Preview', sourceFolderIds: ['source'] }] },
        classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 }
      }}
      ledgers={[]} loading={false} deepSeekAvailable={true}
      deepSeekFeedback={{ status: 'running', message: 'DeepSeek 正在整理当前分段。' }}
      onSelectSegment={vi.fn()} onOrganizeWithDeepSeek={vi.fn()} onRetryFailedDeepSeekChunks={vi.fn()}
      onCancelDeepSeek={onCancelDeepSeek} deepSeekCancelRequested={false}
      onUndo={vi.fn()} onRedo={vi.fn()} onMoveHistoryCursor={vi.fn()} onApplyManualClassification={vi.fn()} onApplyManualClassifications={vi.fn()}
    />)

    const cancelButton = screen.getByRole('button', { name: '取消整理' })
    expect(cancelButton.closest('.favorite-ledger-panel__deepseek-archive-actions')).not.toBeNull()
    fireEvent.click(cancelButton)
    expect(onCancelDeepSeek).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'DeepSeek 整理' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('DeepSeek 整理反馈')).not.toBeInTheDocument()
    rerender(<OldFavoriteArchivePreviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false, selected: true }],
        segments: [], currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, title: 'Preview', sourceFolderIds: ['source'] }] },
        classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 }
      }}
      ledgers={[]} loading={false} deepSeekAvailable={true}
      deepSeekFeedback={{ status: 'running', message: 'DeepSeek 正在整理当前分段。' }}
      onSelectSegment={vi.fn()} onOrganizeWithDeepSeek={vi.fn()} onRetryFailedDeepSeekChunks={vi.fn()}
      onCancelDeepSeek={onCancelDeepSeek} deepSeekCancelRequested
      onUndo={vi.fn()} onRedo={vi.fn()} onMoveHistoryCursor={vi.fn()} onApplyManualClassification={vi.fn()} onApplyManualClassifications={vi.fn()}
    />)
    expect(screen.getByRole('button', { name: '正在取消' })).toBeDisabled()
    const canceledRender = render(<OldFavoriteArchivePreviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [], segments: [], currentSegment: { id: 'segment-1', aids: [], items: [] }, classifications: {},
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 }
      }}
      ledgers={[]} loading={false} deepSeekAvailable={true}
      deepSeekFeedback={{ status: 'canceled', message: 'Canceled', failures: [{ chunkIndex: 2, affectedVideoCount: 3, message: 'Request canceled after start' }] }}
      onSelectSegment={vi.fn()} onOrganizeWithDeepSeek={vi.fn()} onRetryFailedDeepSeekChunks={vi.fn()}
      onUndo={vi.fn()} onRedo={vi.fn()} onMoveHistoryCursor={vi.fn()} onApplyManualClassification={vi.fn()} onApplyManualClassifications={vi.fn()}
    />)
    expect(canceledRender.container.querySelector('[aria-label="DeepSeek 整理反馈"]')).toBeNull()
    expect(screen.getByRole('button', { name: '重试失败批次' })).toBeInTheDocument()
    canceledRender.unmount()

    const completedRender = render(<OldFavoriteArchivePreviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [], segments: [], currentSegment: { id: 'segment-1', aids: [], items: [] }, classifications: {},
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 }
      }}
      ledgers={[]} loading={false} deepSeekAvailable={true}
      deepSeekFeedback={{ status: 'completed', message: 'Completed', failures: [] }}
      onSelectSegment={vi.fn()} onOrganizeWithDeepSeek={vi.fn()} onRetryFailedDeepSeekChunks={vi.fn()}
      onUndo={vi.fn()} onRedo={vi.fn()} onMoveHistoryCursor={vi.fn()} onApplyManualClassification={vi.fn()} onApplyManualClassifications={vi.fn()}
    />)
    expect(completedRender.container.querySelector('[aria-label="DeepSeek 整理反馈"]')).toBeNull()
    expect(screen.queryByRole('button', { name: '重试失败批次' })).not.toBeInTheDocument()
    completedRender.unmount()
    expect(screen.queryByRole('button', { name: 'DeepSeek 整理中' })).not.toBeInTheDocument()
  })
})
