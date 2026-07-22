import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OldFavoriteScanOverviewStep } from './OldFavoriteScanOverviewStep'

describe('OldFavoriteScanOverviewStep', () => {
  it('shows an unstarted state until the user starts old-favorite organization', () => {
    render(<OldFavoriteScanOverviewStep
      snapshot={null} loading={false} scanStarting={false} scanStartFailure={null} onRetry={vi.fn()} onRetryDirect={vi.fn()}
      onRebuild={vi.fn()} onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()}
      onResumeTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
    />)

    expect(screen.getByText('尚未开始扫描，请点击“整理旧藏”后扫描。')).toBeInTheDocument()
    expect(screen.getByText('尚未开始')).toBeInTheDocument()
    expect(screen.queryByText('正在扫描')).not.toBeInTheDocument()
  })

  it('reports formally protected videos skipped by an incremental scan', () => {
    render(<OldFavoriteScanOverviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 },
        protectedAidCount: 3, continuationCount: 0, sourceFolders: [], segments: [], currentSegment: null,
        classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 }
      }}
      loading={false} scanStarting={false} scanStartFailure={null} onRetry={vi.fn()} onRetryDirect={vi.fn()}
      onRebuild={vi.fn()} onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()}
      onResumeTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
    />)

    expect(screen.getByRole('status')).toHaveTextContent('增量扫描已跳过 3 条已保护视频')
  })

  it('shows tag enrichment once and keeps its actions in one equal-width row', () => {
    render(<OldFavoriteScanOverviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false,
        scan: { phase: 'complete', failureCount: 0, totalItemCount: 244, scannedItemCount: 244, taggedItemCount: 183, untaggedItemCount: 61 },
        continuationCount: 0, sourceFolders: [], segments: [], currentSegment: null, classifications: {},
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 },
        tagEnrichment: { status: 'running', totalItemCount: 244, completedItemCount: 184, pendingItemCount: 60, failedItemCount: 0 }
      }}
      loading={false} scanStarting={false} scanStartFailure={null} onRetry={vi.fn()} onRetryDirect={vi.fn()}
      onRebuild={vi.fn()} onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()}
      onResumeTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
    />)

    expect(screen.getByText('标签补取进行中：已处理 184 / 244 条。')).toBeInTheDocument()
    expect(screen.getAllByText(/已获取标签 183/)).toHaveLength(1)
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
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 },
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
})
