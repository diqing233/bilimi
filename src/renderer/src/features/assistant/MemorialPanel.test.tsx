import type { RecommendationLabel } from '@shared/types'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MemorialPanel } from './MemorialPanel'

const inboxRecommendation: RecommendationLabel = {
  badge: '待分拣',
  summary: '此条暂存待阅，容后再归册。'
}

describe('MemorialPanel', () => {
  it('omits the temporary-review copy, guidance box and red verdict block from the review panel', () => {
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
        videoNote={null}
        videoNoteLoading={false}
      />
    )

    expect(screen.queryByText('此条暂存待阅，容后再归册。')).not.toBeInTheDocument()
    expect(screen.queryByText('臣谨以此条进呈陛下，若准其留档，臣便代行轻赏。')).not.toBeInTheDocument()
    expect(screen.queryByText('若欲代拟奏表，臣已备下 1 条奏折腔批语，静候钦点。')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '朱批' })).not.toBeInTheDocument()
    expect(screen.queryByText('此物可先过目，不必骤然重赏。')).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: '批阅动作' })).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: '仅页面点击' })).not.toBeInTheDocument()
  })

  it('adds 小咪 pet icons to the four primary review actions', () => {
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
        videoNote={null}
        videoNoteLoading={false}
      />
    )

    expect(screen.getByRole('img', { name: '小咪轻赏' })).toHaveClass('memorial-panel__action-pet')
    expect(screen.getByRole('img', { name: '小咪归库' })).toHaveClass('memorial-panel__action-pet')
    expect(screen.getByRole('img', { name: '小咪厚赏' })).toHaveClass('memorial-panel__action-pet')
    expect(screen.getByRole('img', { name: '小咪短评' })).toHaveClass('memorial-panel__action-pet')
    expect(screen.getByRole('img', { name: '小咪轻赏' }).closest('span')).not.toHaveClass(
      'memorial-panel__action-label'
    )
    expect(screen.getByText('轻赏此条')).toHaveClass('memorial-panel__action-label')
    expect(screen.getByText('点赞并归入当前 Bilimi 分册')).toHaveClass(
      'memorial-panel__action-description'
    )
  })

  it('shows whether DeepSeek will generate comments or use default suggestions', () => {
    const props = {
      recommendation: inboxRecommendation,
      commentDrafts: ['先留一评。'],
      videoCategory: '待分拣',
      videoTitle: '测试稿件',
      onAction: vi.fn(),
      onClose: vi.fn(),
      onGenerateVideoNote: vi.fn().mockResolvedValue(null),
      onSaveVideoNote: vi.fn().mockResolvedValue(undefined),
      videoNote: null,
      videoNoteLoading: false
    }
    const { rerender } = render(<MemorialPanel {...props} deepSeekEnabled={false} />)

    expect(screen.getByText('DeepSeek 未开启，表会推荐三条默认评论。')).toHaveClass(
      'memorial-panel__deepseek-status'
    )

    rerender(<MemorialPanel {...props} deepSeekEnabled={true} />)

    expect(screen.getByText('DeepSeek 已开启，表会生成三条有趣视频评论。')).toHaveClass(
      'memorial-panel__deepseek-status'
    )
  })
})
