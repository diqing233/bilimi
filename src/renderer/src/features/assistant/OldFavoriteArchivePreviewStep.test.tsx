import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { groupOldFavoritePreviewItems, OldFavoriteArchivePreviewStep } from './OldFavoriteArchivePreviewStep'

describe('OldFavoriteArchivePreviewStep', () => {
  it('keeps the current card tree mounted while a multi-batch archive switches to its compact whole-run overview', () => {
    render(<OldFavoriteArchivePreviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 500, hasMultipleSegments: true, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [{ id: 'source', title: 'Source', itemCount: 501, isBilimiWorkFolder: false, selected: true }],
        segments: [
          { id: 'segment-1', index: 0, status: 'previewing', itemCount: 500, readiness: 'ready', completedTagItemCount: 500, pendingTagItemCount: 0 },
          { id: 'segment-2', index: 1, status: 'previewing', itemCount: 1, readiness: 'tagging', completedTagItemCount: 0, pendingTagItemCount: 1 }
        ],
        currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, title: 'Current card stays mounted', sourceFolderIds: ['source'] }] },
        classifications: { '1': { aid: 1, targetLedgerIds: ['knowledge'], source: 'system-high' } },
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] },
        overview: {
          available: true, completedSegmentCount: 1, totalSegmentCount: 2, unavailableItemCount: 1,
          sourceFolders: [{ id: 'source', title: 'Source', itemCount: 500, invalidItemCount: 1 }], recommendationCounts: [],
          archiveTargets: [{ ledgerId: 'knowledge', itemCount: 500, segmentCounts: [{ segmentId: 'segment-1', count: 500 }] }]
        }
      }}
      ledgers={[{ id: 'knowledge', displayName: '知识', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: true }]}
      loading={false} deepSeekAvailable={false} deepSeekFeedback={null}
      onOrganizeWithDeepSeek={vi.fn()} onRetryFailedDeepSeekChunks={vi.fn()} onUndo={vi.fn()} onRedo={vi.fn()}
      onMoveHistoryCursor={vi.fn()} onApplyManualClassification={vi.fn()} onApplyManualClassifications={vi.fn()}
    />)

    expect(screen.getByRole('group', { name: '归档预览视图' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '当前批次' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Current card stays mounted')).toBeInTheDocument()
    expect(screen.getByTestId('current-archive-view')).not.toHaveAttribute('hidden')

    fireEvent.click(screen.getByRole('button', { name: '本轮总览' }))

    expect(screen.getByRole('button', { name: '本轮总览' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('已汇总 1/2 批')).toBeInTheDocument()
    expect(within(screen.getByTestId('whole-run-archive-view')).getByText('知识')).toBeInTheDocument()
    expect(within(screen.getByTestId('whole-run-archive-view')).getByText('预计归档 500 条')).toBeInTheDocument()
    expect(screen.getByTestId('current-archive-view')).toHaveAttribute('hidden')
    expect(screen.getByText('Current card stays mounted')).toBeInTheDocument()
  })

  it('groups 2000 preview items once while preserving source order', () => {
    const items = Array.from({ length: 2_000 }, (_, index) => ({ aid: index + 1, sourceFolderIds: ['source'] }))
    const classifications = Object.fromEntries(items.map((item) => [String(item.aid), {
      aid: item.aid, targetLedgerIds: [item.aid % 2 ? 'music' : 'knowledge'], source: 'system-high' as const
    }]))

    const groups = groupOldFavoritePreviewItems(items, classifications, new Set(['music', 'knowledge']))

    expect(groups.get('music')).toHaveLength(1_000)
    expect(groups.get('knowledge')).toHaveLength(1_000)
    expect(groups.get('music')?.slice(0, 3).map((item) => item.aid)).toEqual([1, 3, 5])
    expect([...groups.values()].flat()).toHaveLength(2_000)
  })

  it('keeps a 2000-item batch transfer virtualized instead of mounting every card', () => {
    const items = Array.from({ length: 2_000 }, (_, index) => ({ aid: index + 1, title: `Video ${index + 1}`, sourceFolderIds: ['source'] }))
    render(<OldFavoriteArchivePreviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2_000, isBilimiWorkFolder: false, selected: true }],
        segments: [], currentSegment: { id: 'segment-1', aids: items.map((item) => item.aid), items },
        classifications: Object.fromEntries(items.map((item) => [String(item.aid), { aid: item.aid, targetLedgerIds: ['music'], source: 'system-high' as const }])),
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
      }}
      ledgers={[{ id: 'music', displayName: '音乐舞台', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: true }]}
      loading={false} deepSeekAvailable={false} deepSeekFeedback={null}
      onOrganizeWithDeepSeek={vi.fn()} onRetryFailedDeepSeekChunks={vi.fn()} onUndo={vi.fn()} onRedo={vi.fn()}
      onMoveHistoryCursor={vi.fn()} onApplyManualClassification={vi.fn()} onApplyManualClassifications={vi.fn()}
    />)

    const group = screen.getByRole('group', { name: '音乐舞台 2000 条' })
    fireEvent.click(within(group).getByRole('button', { name: '批量转移' }))
    expect(group.querySelector('[data-virtualized="true"]')).not.toBeNull()
    expect(group.querySelectorAll('article').length).toBeLessThan(20)

    fireEvent.click(within(group).getByRole('button', { name: '全选' }))
    expect(within(group).getByRole('button', { name: '转移所选' })).toBeEnabled()
    expect(group.querySelectorAll('article').length).toBeLessThan(20)
  })

  it('indexes a multi-target video into every selected archive group', () => {
    const item = { aid: 1, sourceFolderIds: ['source'] }
    const groups = groupOldFavoritePreviewItems([item], {
      '1': { aid: 1, targetLedgerIds: ['music', 'knowledge'], source: 'manual' }
    }, new Set(['music', 'knowledge']))

    expect(groups.get('music')).toEqual([item])
    expect(groups.get('knowledge')).toEqual([item])
  })

  it('does not regroup a stable 2000-item snapshot when only DeepSeek progress changes', () => {
    const items = Array.from({ length: 2_000 }, (_, index) => ({
      aid: index + 1, title: `Video ${index + 1}`, sourceFolderIds: ['source']
    }))
    const storedClassifications = Object.fromEntries(items.map((item) => [String(item.aid), {
      aid: item.aid, targetLedgerIds: ['music'], source: 'system-high' as const
    }]))
    let classificationReads = 0
    const classifications = new Proxy(storedClassifications, {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) classificationReads += 1
        return Reflect.get(target, property, receiver)
      }
    })
    const snapshot = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const, mode: 'incremental' as const,
      segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2_000, isBilimiWorkFolder: false, selected: true }],
      segments: [], currentSegment: { id: 'segment-1', aids: items.map((item) => item.aid), items }, classifications,
      recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
    }
    const ledgers = [{ id: 'music', displayName: 'Music', keywords: [], ruleType: 'keyword' as const, enabled: true, priority: 0, isDefault: true }]
    const actions = {
      onOrganizeWithDeepSeek: vi.fn(), onRetryFailedDeepSeekChunks: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(),
      onMoveHistoryCursor: vi.fn(), onApplyManualClassification: vi.fn(), onApplyManualClassifications: vi.fn()
    }
    const view = render(<OldFavoriteArchivePreviewStep snapshot={snapshot} ledgers={ledgers} loading deepSeekAvailable
      deepSeekFeedback={{ status: 'running', message: 'Running', progress: { totalChunks: 100, completedChunks: 1, totalVideoCount: 2_000, successfulVideoCount: 20, failedVideoCount: 0 } }}
      {...actions} />)
    classificationReads = 0

    view.rerender(<OldFavoriteArchivePreviewStep snapshot={snapshot} ledgers={ledgers} loading deepSeekAvailable
      deepSeekFeedback={{ status: 'running', message: 'Running', progress: { totalChunks: 100, completedChunks: 2, totalVideoCount: 2_000, successfulVideoCount: 40, failedVideoCount: 0 } }}
      {...actions} />)

    expect(classificationReads).toBe(0)
  })

  it('uses the legacy preview title bar and content shell around current workspace data', () => {
    render(<OldFavoriteArchivePreviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 },
        continuationCount: 0, sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false, selected: true }],
        segments: [], currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, title: 'Preview', sourceFolderIds: ['source'] }] },
        classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
      }}
      ledgers={[]}
      loading={false}
      deepSeekAvailable={false}
      deepSeekFeedback={null}
      onSelectSegment={vi.fn()}
      onOrganizeWithDeepSeek={vi.fn()}
      onRetryFailedDeepSeekChunks={vi.fn()}
      onUndo={vi.fn()}
      onRedo={vi.fn()}
      onMoveHistoryCursor={vi.fn()}
      onApplyManualClassification={vi.fn()}
      onApplyManualClassifications={vi.fn()}
    />)

    const region = screen.getByRole('region', { name: '\u5f52\u6863\u9884\u89c8' })
    const heading = screen.getByRole('heading', { name: '\u5f52\u6863\u9884\u89c8' })

    expect(heading).toHaveClass('favorite-ledger-panel__step-title')
    expect(heading.closest('.favorite-ledger-panel__preview-topbar')).not.toBeNull()
    expect(region).toHaveClass('favorite-ledger-panel__preview')
    expect(region.querySelector(':scope > p.favorite-ledger-panel__step-note')).toHaveTextContent('检查分类结果，可手动调整或使用 DeepSeek 辅助整理。')
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
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
      }}
      ledgers={[]} loading={false} deepSeekAvailable={false} deepSeekFeedback={null}
      onSelectSegment={vi.fn()} onOrganizeWithDeepSeek={vi.fn()} onRetryFailedDeepSeekChunks={vi.fn()}
      onUndo={vi.fn()} onRedo={vi.fn()} onMoveHistoryCursor={vi.fn()} onApplyManualClassification={vi.fn()} onApplyManualClassifications={vi.fn()}
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
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 1, length: 2, entries: [] }
      }}
      ledgers={[{ id: 'music', displayName: '音乐舞台', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: true }]}
      loading={false} deepSeekAvailable={false} deepSeekFeedback={null}
      onSelectSegment={vi.fn()} onOrganizeWithDeepSeek={vi.fn()} onRetryFailedDeepSeekChunks={vi.fn()}
      onUndo={vi.fn()} onRedo={vi.fn()} onMoveHistoryCursor={vi.fn()} onApplyManualClassification={vi.fn()} onApplyManualClassifications={vi.fn()}
    />)

    expect(screen.getByText('改动记录')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '撤销本次改动' })).toBeEnabled()
    expect(screen.getByRole('group', { name: '未匹配到合适分类 1 条' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '音乐舞台 1 条' })).toBeInTheDocument()
  })

  it('excludes unavailable videos from archive groups and pending counts', () => {
    render(<OldFavoriteArchivePreviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [{ id: 'source', title: 'Source', itemCount: 4, isBilimiWorkFolder: false, selected: true }],
        segments: [], currentSegment: {
          id: 'segment-1', aids: [1, 2, 3, 4], items: [
            { aid: 1, title: 'Explicitly unavailable', unavailable: true, sourceFolderIds: ['source'] },
            { aid: 2, title: '已失效视频', sourceFolderIds: ['source'] },
            { aid: 3, title: 'Closed account video', author: '账号已注销', sourceFolderIds: ['source'] },
            { aid: 4, title: 'Available', sourceFolderIds: ['source'] }
          ]
        },
        classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
      }}
      ledgers={[]} loading={false} deepSeekAvailable={false} deepSeekFeedback={null}
      onSelectSegment={vi.fn()} onOrganizeWithDeepSeek={vi.fn()} onRetryFailedDeepSeekChunks={vi.fn()}
      onUndo={vi.fn()} onRedo={vi.fn()} onMoveHistoryCursor={vi.fn()}
      onApplyManualClassification={vi.fn()} onApplyManualClassifications={vi.fn()}
    />)

    expect(screen.queryByText('Explicitly unavailable')).not.toBeInTheDocument()
    expect(screen.queryByText('已失效视频')).not.toBeInTheDocument()
    expect(screen.queryByText('Closed account video')).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: '未匹配到合适分类 1 条' })).toBeInTheDocument()
  })

  it('locks only preview mutations during ledger analysis while keeping segment and expansion browsing available', () => {
    const items = Array.from({ length: 13 }, (_, index) => ({
      aid: index + 1, title: `Preview ${index + 1}`, sourceFolderIds: ['source']
    }))
    render(<OldFavoriteArchivePreviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: true, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [{ id: 'source', title: 'Source', itemCount: 13, isBilimiWorkFolder: false, selected: true }],
        segments: [
          { id: 'segment-1', index: 0, itemCount: 13, status: 'previewing' },
          { id: 'segment-2', index: 1, itemCount: 1, status: 'previewing' }
        ],
        currentSegment: { id: 'segment-1', aids: items.map((item) => item.aid), items }, classifications: {},
        recommendations: { candidates: [], adoptedCandidateIds: [] },
        history: {
          cursor: 1, length: 2, entries: [
            { cursor: 1, source: 'manual', changeCount: 1, targetLedgerIds: ['inbox'] },
            { cursor: 2, source: 'deepseek', changeCount: 1, targetLedgerIds: ['inbox'] }
          ]
        }
      }}
      ledgers={[]} loading={false} mutationLocked deepSeekAvailable deepSeekFeedback={null}
      onSelectSegment={vi.fn()} onOrganizeWithDeepSeek={vi.fn()} onRetryFailedDeepSeekChunks={vi.fn()}
      onUndo={vi.fn()} onRedo={vi.fn()} onMoveHistoryCursor={vi.fn()} onApplyManualClassification={vi.fn()} onApplyManualClassifications={vi.fn()}
    />)

    expect(screen.getByRole('button', { name: 'DeepSeek 整理' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '撤销本次改动' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '恢复本次改动' })).toBeDisabled()
    expect(within(screen.getByRole('group', { name: '未匹配到合适分类 13 条' })).getByRole('button', { name: '批量转移' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '转移 Preview 1' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '第 2 组' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '显示全部 13 条' })).toBeEnabled()

    const history = screen.getByRole('button', { name: '查看改动记录' })
    expect(history).toBeEnabled()
    fireEvent.click(history)
    expect(screen.getByRole('menuitem', { name: 'DeepSeek：1 条 → inbox' })).toBeDisabled()
  })

  it('expands a group for batch transfer and submits one replacement while preserving other targets', () => {
    const onApplyManualClassifications = vi.fn()
    render(<OldFavoriteArchivePreviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [{ id: 'source', title: 'Source', itemCount: 8, isBilimiWorkFolder: false, selected: true }],
        segments: [], currentSegment: {
          id: 'segment-1', aids: [1, 2, 3, 4, 5, 6, 7, 8], items: Array.from({ length: 8 }, (_, index) => ({ aid: index + 1, title: `Matched ${index + 1}`, sourceFolderIds: ['source'] }))
        },
        classifications: Object.fromEntries(Array.from({ length: 8 }, (_, index) => [String(index + 1), { aid: index + 1, targetLedgerIds: ['music', 'knowledge'], source: 'system-high' as const }])),
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
      }}
      ledgers={[
        { id: 'music', displayName: '音乐舞台', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: true },
        { id: 'knowledge', displayName: '知识学习', keywords: [], ruleType: 'keyword', enabled: true, priority: 1, isDefault: false },
        { id: 'archive', displayName: '稍后归档', keywords: [], ruleType: 'keyword', enabled: true, priority: 2, isDefault: false }
      ]}
      loading={false} deepSeekAvailable={false} deepSeekFeedback={null}
      onSelectSegment={vi.fn()} onOrganizeWithDeepSeek={vi.fn()} onRetryFailedDeepSeekChunks={vi.fn()}
      onUndo={vi.fn()} onRedo={vi.fn()} onMoveHistoryCursor={vi.fn()} onApplyManualClassification={vi.fn()}
      onApplyManualClassifications={onApplyManualClassifications}
    />)

    const group = screen.getByRole('group', { name: '音乐舞台 8 条' })
    expect(within(group).getByRole('button', { name: '显示全部 8 条' })).toBeInTheDocument()
    fireEvent.click(within(group).getByRole('button', { name: '批量转移' }))

    expect(within(group).queryByRole('button', { name: '显示全部 8 条' })).not.toBeInTheDocument()
    expect(within(group).queryByRole('button', { name: '批量转移' })).not.toBeInTheDocument()
    expect(within(group).getByRole('link', { name: 'Matched 8' })).toBeInTheDocument()
    fireEvent.click(within(group).getByRole('button', { name: '全选' }))
    expect(group.querySelectorAll('article[data-selected="true"]')).toHaveLength(8)

    fireEvent.click(within(group).getByRole('button', { name: '转移所选' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '稍后归档' }))
    expect(onApplyManualClassifications).toHaveBeenCalledTimes(1)
    expect(onApplyManualClassifications).toHaveBeenCalledWith(Array.from({ length: 8 }, (_, index) => ({
      aid: index + 1,
      targetLedgerIds: ['knowledge', 'archive']
    })))
    expect(within(group).getByRole('button', { name: '批量转移' })).toBeInTheDocument()
  })

  it('clears batch selection when the current segment changes', () => {
    const makeSnapshot = (segmentId: string, aid: number) => ({
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const, mode: 'incremental' as const,
      segmentSize: 500, hasMultipleSegments: true, scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2, isBilimiWorkFolder: false, selected: true }],
      segments: [
        { id: 'segment-1', index: 0, status: 'previewing' as const, itemCount: 1, readiness: 'ready' as const, completedTagItemCount: 1, pendingTagItemCount: 0 },
        { id: 'segment-2', index: 1, status: 'previewing' as const, itemCount: 1, readiness: 'ready' as const, completedTagItemCount: 1, pendingTagItemCount: 0 }
      ],
      currentSegment: { id: segmentId, aids: [aid], items: [{ aid, title: `Video ${aid}`, sourceFolderIds: ['source'] }] },
      classifications: { [String(aid)]: { aid, targetLedgerIds: ['music'], source: 'system-high' as const } },
      recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
    })
    const ledgers = [{ id: 'music', displayName: '音乐舞台', keywords: [], ruleType: 'keyword' as const, enabled: true, priority: 0, isDefault: true }]
    const actions = {
      onOrganizeWithDeepSeek: vi.fn(), onRetryFailedDeepSeekChunks: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(),
      onMoveHistoryCursor: vi.fn(), onApplyManualClassification: vi.fn(), onApplyManualClassifications: vi.fn()
    }
    const view = render(<OldFavoriteArchivePreviewStep snapshot={makeSnapshot('segment-1', 1)} ledgers={ledgers}
      loading={false} deepSeekAvailable={false} deepSeekFeedback={null} {...actions} />)

    const firstGroup = screen.getByRole('group', { name: '音乐舞台 1 条' })
    fireEvent.click(within(firstGroup).getByRole('button', { name: '批量转移' }))
    fireEvent.click(within(firstGroup).getByRole('button', { name: '选择 Video 1' }))
    expect(within(firstGroup).getByRole('button', { name: '取消批量' })).toBeInTheDocument()

    view.rerender(<OldFavoriteArchivePreviewStep snapshot={makeSnapshot('segment-2', 2)} ledgers={ledgers}
      loading={false} deepSeekAvailable={false} deepSeekFeedback={null} {...actions} />)

    const secondGroup = screen.getByRole('group', { name: '音乐舞台 1 条' })
    expect(within(secondGroup).getByRole('button', { name: '批量转移' })).toBeInTheDocument()
    expect(within(secondGroup).queryByRole('button', { name: '取消批量' })).not.toBeInTheDocument()
  })

  it('shows only post-scan changes and restores the automatic-classification baseline', () => {
    const onMoveHistoryCursor = vi.fn()
    const { container } = render(<OldFavoriteArchivePreviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false, selected: true }],
        segments: [], currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, title: 'Preview', sourceFolderIds: ['source'] }] },
        classifications: { '1': { aid: 1, targetLedgerIds: ['manual'], source: 'manual' } },
        recommendations: { candidates: [], adoptedCandidateIds: [] },
        history: {
          cursor: 3, length: 3, baselineCursor: 1,
          entries: [
            {
              cursor: 3, source: 'manual', changeCount: 1, targetLedgerIds: ['manual'],
              summary: {
                title: 'Preview', beforeTargetLedgerIds: ['archive'], afterTargetLedgerIds: ['manual'],
                reason: '人工调整', movedCount: 1
              }
            },
            {
              cursor: 2, source: 'deepseek', changeCount: 44, targetLedgerIds: ['manual'],
              summary: {
                title: 'Batch sample', beforeTargetLedgerIds: [], afterTargetLedgerIds: ['manual'],
                reason: 'DeepSeek 整理', movedCount: 44
              }
            }
          ]
        }
      }}
      ledgers={[
        { id: 'archive', displayName: 'Archive', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: false },
        { id: 'manual', displayName: 'Manual', keywords: [], ruleType: 'keyword', enabled: true, priority: 1, isDefault: false }
      ]}
      loading={false} deepSeekAvailable={false} deepSeekFeedback={null}
      onSelectSegment={vi.fn()} onOrganizeWithDeepSeek={vi.fn()} onRetryFailedDeepSeekChunks={vi.fn()}
      onUndo={vi.fn()} onRedo={vi.fn()} onMoveHistoryCursor={onMoveHistoryCursor}
      onApplyManualClassification={vi.fn()} onApplyManualClassifications={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: '查看改动记录' }))
    const menu = screen.getByRole('menu', { name: '改动记录' })
    expect(container.querySelector('[role="menu"][aria-label="改动记录"]')).toBeNull()
    expect(document.body.contains(menu)).toBe(true)
    expect(menu.querySelector('.favorite-ledger-panel__archive-history-current')).toHaveTextContent('当前记录：Preview：Archive → Manual')
    expect(menu.querySelector('.favorite-ledger-panel__archive-history-divider')).not.toBeNull()
    expect(within(menu).getByRole('menuitem', { name: 'DeepSeek 整理 44 条：未分类 → Manual' })).toBeInTheDocument()
    expect(menu).not.toHaveTextContent('自动分类')
    fireEvent.click(within(menu).getByRole('menuitem', { name: '恢复初始改动' }))
    expect(onMoveHistoryCursor).toHaveBeenCalledWith(1)
    expect(screen.queryByRole('button', { name: '恢复初始改动' })).not.toBeInTheDocument()
  })

  it('wires Ctrl+Z and Ctrl+Shift+Z to durable history without stealing editable shortcuts', () => {
    const onUndo = vi.fn()
    const onRedo = vi.fn()
    render(<><input aria-label="history editor" /><OldFavoriteArchivePreviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [], segments: [], currentSegment: { id: 'segment-1', aids: [], items: [] }, classifications: {},
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 1, length: 2, entries: [] }
      }}
      ledgers={[]} loading={false} deepSeekAvailable={false} deepSeekFeedback={null}
      onOrganizeWithDeepSeek={vi.fn()} onRetryFailedDeepSeekChunks={vi.fn()}
      onUndo={onUndo} onRedo={onRedo} onMoveHistoryCursor={vi.fn()}
      onApplyManualClassification={vi.fn()} onApplyManualClassifications={vi.fn()}
    /></>)

    fireEvent.keyDown(document, { key: 'z', ctrlKey: true })
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true, shiftKey: true })
    fireEvent.keyDown(document, { key: 'y', ctrlKey: true })
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(onRedo).toHaveBeenCalledTimes(2)

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'history editor' }), { key: 'z', ctrlKey: true })
    expect(onUndo).toHaveBeenCalledTimes(1)
  })

  it('keeps a moved card first, preserves its original category, and resets source and target tracks', () => {
    const ledgers = [
      { id: 'music', displayName: 'Music', keywords: [], ruleType: 'keyword' as const, enabled: true, priority: 0, isDefault: true },
      { id: 'archive', displayName: 'Archive', keywords: [], ruleType: 'keyword' as const, enabled: true, priority: 1, isDefault: false }
    ]
    const items = [
      { aid: 1, title: 'Move me', sourceFolderIds: ['source'] },
      { aid: 2, title: 'Existing target', sourceFolderIds: ['source'] },
      { aid: 3, title: 'Stay in source', sourceFolderIds: ['source'] }
    ]
    const snapshot = (classifications: Record<string, { aid: number; targetLedgerIds: string[]; source: 'manual' }>) => ({
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const, mode: 'incremental' as const,
      segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 3, isBilimiWorkFolder: false, selected: true }],
      segments: [], currentSegment: { id: 'segment-1', aids: [1, 2, 3], items }, classifications,
      recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
    })
    const actions = {
      onOrganizeWithDeepSeek: vi.fn(), onRetryFailedDeepSeekChunks: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(),
      onMoveHistoryCursor: vi.fn(), onApplyManualClassification: vi.fn(), onApplyManualClassifications: vi.fn()
    }
    const view = render(<OldFavoriteArchivePreviewStep snapshot={snapshot({
      '1': { aid: 1, targetLedgerIds: ['music'], source: 'manual' },
      '2': { aid: 2, targetLedgerIds: ['archive'], source: 'manual' },
      '3': { aid: 3, targetLedgerIds: ['music'], source: 'manual' }
    })} ledgers={ledgers} loading={false} deepSeekAvailable={false} deepSeekFeedback={null} {...actions} />)
    const sourceTrack = screen.getByRole('group', { name: 'Music 2 条' }).querySelector<HTMLElement>('.favorite-ledger-panel__preview-videos')!
    const targetRow = screen.getByRole('group', { name: 'Archive 1 条' })
    const targetTrack = targetRow.querySelector<HTMLElement>('.favorite-ledger-panel__preview-videos')!
    sourceTrack.scrollLeft = 200
    targetTrack.scrollLeft = 160
    const scrollIntoView = vi.fn()
    Object.defineProperty(targetRow, 'scrollIntoView', { configurable: true, value: scrollIntoView })

    fireEvent.click(screen.getByRole('button', { name: '转移 Move me' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }))
    view.rerender(<OldFavoriteArchivePreviewStep snapshot={snapshot({
      '1': { aid: 1, targetLedgerIds: ['archive'], source: 'manual' },
      '2': { aid: 2, targetLedgerIds: ['archive'], source: 'manual' },
      '3': { aid: 3, targetLedgerIds: ['music'], source: 'manual' }
    })} ledgers={ledgers} loading={false} deepSeekAvailable={false} deepSeekFeedback={null} {...actions} />)

    expect(sourceTrack.scrollLeft).toBe(0)
    expect(targetTrack.scrollLeft).toBe(0)
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' })
    expect(within(screen.getByRole('group', { name: 'Archive 2 条' })).getAllByRole('link').map((link) => link.textContent)).toEqual(['Move me', 'Existing target'])
    expect(within(screen.getByRole('link', { name: 'Move me' }).closest('article')!).getByText('原分类：Music')).toBeInTheDocument()
  })

  it('keeps the right-aligned change-history menu inside the viewport near its left edge', () => {
    render(<OldFavoriteArchivePreviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [], segments: [], currentSegment: { id: 'segment-1', aids: [], items: [] }, classifications: {},
        recommendations: { candidates: [], adoptedCandidateIds: [] },
        history: { cursor: 1, length: 1, entries: [{ cursor: 1, source: 'manual', changeCount: 1, targetLedgerIds: [] }] }
      }}
      ledgers={[]} loading={false} deepSeekAvailable={false} deepSeekFeedback={null}
      onSelectSegment={vi.fn()} onOrganizeWithDeepSeek={vi.fn()} onRetryFailedDeepSeekChunks={vi.fn()}
      onUndo={vi.fn()} onRedo={vi.fn()} onMoveHistoryCursor={vi.fn()}
      onApplyManualClassification={vi.fn()} onApplyManualClassifications={vi.fn()}
    />)

    const trigger = screen.getByRole('button', { name: '查看改动记录' })
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 32, top: 0, bottom: 32 } as DOMRect)
    fireEvent.click(trigger)

    expect(screen.getByRole('menu', { name: '改动记录' })).toHaveStyle({ left: '8px' })
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
        classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
      }}
      ledgers={[]} loading={false} deepSeekAvailable={false} deepSeekFeedback={null}
      onSelectSegment={vi.fn()} onOrganizeWithDeepSeek={vi.fn()}
      onRetryFailedDeepSeekChunks={vi.fn()}
      onUndo={vi.fn()} onRedo={vi.fn()} onMoveHistoryCursor={vi.fn()}
      onApplyManualClassification={vi.fn()} onApplyManualClassifications={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: '显示全部 51 条' }))
    expect(document.querySelector('.favorite-ledger-panel__virtual-track-spacer')).toHaveStyle({ width: '14280px' })
    fireEvent.click(screen.getByRole('button', { name: '收起 51 条' }))
    expect(document.querySelector('.favorite-ledger-panel__virtual-track-spacer')).toBeNull()
    expect(screen.getAllByRole('link')).toHaveLength(6)
  })

  it('shows the legacy DeepSeek progress bar while main-process chunks are running', () => {
    render(<OldFavoriteArchivePreviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [{ id: 'source', title: 'Source', itemCount: 20, isBilimiWorkFolder: false, selected: true }],
        segments: [], currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, title: 'Preview', sourceFolderIds: ['source'] }] },
        classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
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
        classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
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
        classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
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
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
      }}
      ledgers={[]} loading={false} deepSeekAvailable={true}
      deepSeekFeedback={{ status: 'canceled', message: 'Canceled', failures: [{ chunkIndex: 2, affectedVideoCount: 3, aids: [], message: 'Request canceled after start' }] }}
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
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
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
