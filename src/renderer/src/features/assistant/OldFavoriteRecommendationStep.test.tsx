import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OldFavoriteRecommendationStep } from './OldFavoriteRecommendationStep'

describe('OldFavoriteRecommendationStep multi-batch views', () => {
  it('defaults to current-batch candidates and switches to completed whole-run counts without recomputing', () => {
    render(<OldFavoriteRecommendationStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 500, hasMultipleSegments: true, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [], segments: [
          { id: 'segment-1', index: 0, status: 'previewing', itemCount: 500, readiness: 'ready', completedTagItemCount: 500, pendingTagItemCount: 0 },
          { id: 'segment-2', index: 1, status: 'previewing', itemCount: 1, readiness: 'tagging', completedTagItemCount: 0, pendingTagItemCount: 1 }
        ], currentSegment: { id: 'segment-1', aids: [], items: [] }, classifications: {},
        recommendations: {
          candidates: [
            { id: 'tag-current', displayName: '当前标签', kind: 'tag', count: 12, currentSegmentCount: 2, reason: 'current' },
            { id: 'tag-other', displayName: '其他批标签', kind: 'tag', count: 10, currentSegmentCount: 0, reason: 'other' }
          ], adoptedCandidateIds: []
        }, history: { cursor: 0, length: 0, entries: [] },
        overview: {
          available: true, completedSegmentCount: 1, totalSegmentCount: 2, unavailableItemCount: 0, sourceFolders: [], archiveTargets: [],
          recommendationCounts: [{ id: 'tag-current', count: 12 }, { id: 'tag-other', count: 10 }]
        }
      }}
      loading={false} onSetRecommendedCandidates={vi.fn()}
    />)

    expect(screen.getByRole('group', { name: '推荐收藏夹视图' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '当前批次' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('2 条适合')).toBeInTheDocument()
    expect(screen.getByRole('article', { name: '当前标签' })).toHaveAttribute(
      'title',
      '收藏夹：当前标签\n推荐来源：高频标签推荐\ncurrent\n当前匹配：2 条视频'
    )
    expect(screen.queryByRole('checkbox', { name: '其他批标签' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '本轮总览' }))

    expect(screen.getByText('已汇总 1/2 批')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '其他批标签' })).toBeInTheDocument()
    expect(screen.getByText('10 条适合')).toBeInTheDocument()
  })
})
