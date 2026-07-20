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

    expect(document.querySelector('.favorite-ledger-panel__virtual-track-spacer')).toHaveStyle({ width: '14280px' })
  })
})
