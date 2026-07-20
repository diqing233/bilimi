import { render, screen } from '@testing-library/react'
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
  })
})
