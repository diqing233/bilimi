import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OldFavoriteScanOverviewStep } from './OldFavoriteScanOverviewStep'

describe('OldFavoriteScanOverviewStep', () => {
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
})
