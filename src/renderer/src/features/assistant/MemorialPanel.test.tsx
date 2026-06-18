import type { RecommendationLabel } from '@shared/types'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MemorialPanel } from './MemorialPanel'

const inboxRecommendation: RecommendationLabel = {
  badge: '待分拣',
  summary: '此条暂存待阅，容后再归册。'
}

describe('MemorialPanel', () => {
  it('omits the temporary-review copy and red verdict block from the review panel', () => {
    render(
      <MemorialPanel
        recommendation={inboxRecommendation}
        commentDrafts={['先留一评。']}
        videoCategory="待分拣"
        videoTitle="测试稿件"
        onAction={vi.fn()}
        onClose={vi.fn()}
        onGenerateVideoNote={vi.fn().mockResolvedValue(null)}
        onSaveVideoNote={vi.fn().mockResolvedValue(undefined)}
        pageClickOnly={true}
        onPageClickOnlyChange={vi.fn()}
        videoNote={null}
        videoNoteLoading={false}
      />
    )

    expect(screen.queryByText('此条暂存待阅，容后再归册。')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '朱批' })).not.toBeInTheDocument()
    expect(screen.queryByText('此物可先过目，不必骤然重赏。')).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: '批阅动作' })).toBeInTheDocument()
  })
})
