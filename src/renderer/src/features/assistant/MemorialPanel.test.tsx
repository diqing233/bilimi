import type { RecommendationLabel } from '@shared/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MemorialPanel } from './MemorialPanel'

const inboxRecommendation: RecommendationLabel = {
  badge: '待分拣',
  summary: '此条暂存待阅，容后再归册。'
}

describe('MemorialPanel', () => {
  it('shows the current video author and classification in the meta card', () => {
    render(
      <MemorialPanel
        recommendation={{ badge: '可藏', summary: '适合归到影视动漫。' }}
        commentDrafts={['先留一评。']}
        videoCategory="影视动漫"
        videoTitle="测试稿件"
        videoAuthor="电影观察员"
        hasCurrentVideo={true}
        onAction={vi.fn()}
        onClose={vi.fn()}
        onGenerateVideoNote={vi.fn().mockResolvedValue(null)}
        onSaveVideoNote={vi.fn().mockResolvedValue(undefined)}
        videoNote={null}
        videoNoteLoading={false}
      />
    )

    expect(screen.getByText('UP 主：电影观察员')).toBeInTheDocument()
    expect(screen.getByText('小咪准备归类到：影视动漫')).toBeInTheDocument()
    expect(screen.queryByText('小咪的批阅签语：可藏')).not.toBeInTheDocument()
  })

  it('shows 小咪 placeholder wording in the meta card when the current page is not a video', () => {
    render(
      <MemorialPanel
        recommendation={{ badge: '可藏', summary: '适合归到影视动漫。' }}
        commentDrafts={['先留一评。']}
        videoCategory="影视动漫"
        videoTitle="哔哩哔哩首页"
        hasCurrentVideo={false}
        onAction={vi.fn()}
        onClose={vi.fn()}
        onGenerateVideoNote={vi.fn().mockResolvedValue(null)}
        onSaveVideoNote={vi.fn().mockResolvedValue(undefined)}
        videoNote={null}
        videoNoteLoading={false}
      />
    )

    expect(screen.getByText('哔哩哔哩首页')).toBeInTheDocument()
    expect(screen.getByText('UP 主会显示在这里')).toBeInTheDocument()
    expect(screen.getByText('小咪会在这里展示视频的预归类位置')).toBeInTheDocument()
    expect(screen.queryByText('小咪会在这里给出批阅建议')).not.toBeInTheDocument()
    expect(screen.queryByText('小咪准备归类到：影视动漫')).not.toBeInTheDocument()
    expect(screen.queryByText('小咪的批阅签语：可藏')).not.toBeInTheDocument()
  })

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

    expect(screen.getByRole('img', { name: '小咪轻赏' })).toHaveClass('assistant-action-button__pet')
    expect(screen.getByRole('img', { name: '小咪归库' })).toHaveClass('assistant-action-button__pet')
    expect(screen.getByRole('img', { name: '小咪厚赏' })).toHaveClass('assistant-action-button__pet')
    expect(screen.getByRole('img', { name: '小咪短评' })).toHaveClass('assistant-action-button__pet')
    expect(screen.getByRole('img', { name: '小咪轻赏' }).closest('span')).not.toHaveClass(
      'assistant-action-button__label'
    )
    expect(screen.getByText('轻赏此条')).toHaveClass('assistant-action-button__label')
    expect(screen.getByText('一键点赞，并归类收藏到 bilimi')).toHaveClass(
      'assistant-action-button__description'
    )
    expect(screen.getByText('一键归类收藏，不点赞不投币')).toHaveClass(
      'assistant-action-button__description'
    )
    expect(screen.getByText('一键三连，投币数量可在设置中调整')).toHaveClass(
      'assistant-action-button__description'
    )
    expect(screen.getByText('一键弹幕，发送方式可在设置中调整')).toHaveClass(
      'assistant-action-button__description'
    )
  })

  it('does not render static DeepSeek comment capability copy in the review content area', () => {
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

    expect(screen.queryByText(/DeepSeek .*表会.*评论/)).not.toBeInTheDocument()

    rerender(<MemorialPanel {...props} deepSeekEnabled={true} />)

    expect(screen.queryByText(/DeepSeek .*表会.*评论/)).not.toBeInTheDocument()
  })

  it('shows the recommendation summary as the visible classification hint', () => {
    render(
      <MemorialPanel
        recommendation={{
          badge: '待分拣',
          summary: '更适合归到旅游出行，当前先待分拣。',
          hint: '标签更像旅游出行，先放到待分类，备册后再归档。'
        }}
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

    expect(screen.getByText('标签更像旅游出行，先放到待分类，备册后再归档。')).toHaveClass(
      'memorial-panel__recommendation-summary'
    )
  })

  it('localizes missing automation targets in feedback and keeps the execution log collapsed', () => {
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
        feedback={{
          tone: 'error',
          message: '尚有 like 未能寻见。',
          steps: ['already-liked', 'favorite:add'],
          missingTargets: ['like']
        }}
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent('未得：点赞按钮')
    expect(screen.queryByText('未得：like')).not.toBeInTheDocument()
    expect(screen.getByText('执行日志').closest('details')).not.toHaveAttribute('open')
  })

  it('passes the current video author into the notes panel', () => {
    render(
      <MemorialPanel
        recommendation={inboxRecommendation}
        commentDrafts={['先留一评。']}
        videoCategory="待分拣"
        videoTitle="测试稿件"
        videoAuthor="李老师讲AI"
        onAction={vi.fn()}
        onClose={vi.fn()}
        onGenerateVideoNote={vi.fn().mockResolvedValue(null)}
        onTranscribeVideoAudio={vi.fn().mockResolvedValue(null)}
        onSaveVideoNote={vi.fn().mockResolvedValue(undefined)}
        videoNote={null}
        videoNoteLoading={false}
        initialTab="notes"
      />
    )

    expect(screen.getByText('UP').nextElementSibling).toHaveTextContent('李老师讲AI')
  })

  it('embeds coin and comment settings inside their action buttons without firing actions', () => {
    const onPreferenceChange = vi.fn()
    const onAction = vi.fn()

    render(
      <MemorialPanel
        recommendation={inboxRecommendation}
        commentDrafts={['先留一评。']}
        videoCategory="待分拣"
        videoTitle="测试稿件"
        onAction={onAction}
        onClose={vi.fn()}
        onGenerateVideoNote={vi.fn().mockResolvedValue(null)}
        onSaveVideoNote={vi.fn().mockResolvedValue(undefined)}
        videoNote={null}
        videoNoteLoading={false}
        defaultCoinCount={1}
        commentSubmitMode="random"
        onPreferenceChange={onPreferenceChange}
      />
    )

    expect(screen.queryByText('投币数量')).not.toBeInTheDocument()
    expect(screen.queryByText('评论发送方式')).not.toBeInTheDocument()
    expect(screen.getByLabelText('投币厚赏参数')).toHaveValue('1')
    expect(screen.getByLabelText('拟奏短评参数')).toHaveValue('random')
    expect(screen.getByTestId('review-action-coin')).toContainElement(screen.getByLabelText('投币厚赏参数'))
    expect(screen.getByTestId('review-action-comment')).toContainElement(
      screen.getByLabelText('拟奏短评参数')
    )

    fireEvent.change(screen.getByLabelText('投币厚赏参数'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('拟奏短评参数'), { target: { value: 'choose' } })

    expect(onPreferenceChange).toHaveBeenCalledWith({ defaultCoinCount: 2 })
    expect(onPreferenceChange).toHaveBeenCalledWith({ commentSubmitMode: 'choose' })
    expect(onAction).not.toHaveBeenCalled()
  })
})
