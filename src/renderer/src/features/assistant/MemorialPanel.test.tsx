import type { RecommendationLabel } from '@shared/types'
import { fireEvent, render, screen, within } from '@testing-library/react'
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

    expect(screen.getByText('当前视频', { selector: 'p.memorial-panel__meta-eyebrow' })).toBeInTheDocument()
    expect(screen.getByText('UP 主：电影观察员')).toBeInTheDocument()
    expect(screen.getByText('小咪准备归类到：影视动漫')).toBeInTheDocument()
    expect(screen.queryByText('小咪的批阅签语：可藏')).not.toBeInTheDocument()
  })

  it('adds only the unprovisioned favorite hint without changing the author or category lines', () => {
    render(
      <MemorialPanel
        recommendation={{ badge: '可藏', summary: '适合归到影视动漫。' }}
        commentDrafts={[]}
        videoCategory="影视动漫"
        favoriteProvisioningHint="最佳匹配：影视动漫（未备册）"
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
    expect(screen.getByText('最佳匹配：影视动漫（未备册）')).toBeInTheDocument()
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

    expect(screen.getByText('UP主').nextElementSibling).toHaveTextContent('李老师讲AI')
  })

  it('passes transcription queue cancel and retry actions into the notes panel', () => {
    const onCancelQueuedVideoAudioTranscription = vi.fn()
    const onRetryQueuedVideoAudioTranscription = vi.fn()

    render(
      <MemorialPanel
        recommendation={inboxRecommendation}
        commentDrafts={['先留一评。']}
        videoCategory="待分拣"
        videoTitle="测试稿件"
        onAction={vi.fn()}
        onClose={vi.fn()}
        onGenerateVideoNote={vi.fn().mockResolvedValue(null)}
        onTranscribeVideoAudio={vi.fn().mockResolvedValue(null)}
        onEnqueueVideoAudioTranscription={vi.fn().mockResolvedValue(null)}
        onCancelQueuedVideoAudioTranscription={onCancelQueuedVideoAudioTranscription}
        onRetryQueuedVideoAudioTranscription={onRetryQueuedVideoAudioTranscription}
        onSaveVideoNote={vi.fn().mockResolvedValue(undefined)}
        videoNote={null}
        videoNoteLoading={false}
        initialTab="notes"
        transcriptionQueue={{
          activeItemId: 'bvid:BV1note',
          sessionCompletedCount: 1,
          items: [
            {
              id: 'bvid:BV1note',
              url: 'https://www.bilibili.com/video/BV1note',
              title: 'Running video',
              bvid: 'BV1note',
              status: 'running',
              createdAt: '2026-06-25T00:01:00.000Z',
              updatedAt: '2026-06-25T00:02:00.000Z',
              progress: {
                step: 'transcribing-segment',
                message: 'Transcribing segment 1/2.',
                segmentIndex: 1,
                segmentCount: 2
              }
            },
            {
              id: 'bvid:BV2note',
              url: 'https://www.bilibili.com/video/BV2note',
              title: 'Failed video',
              bvid: 'BV2note',
              status: 'failed',
              createdAt: '2026-06-25T00:03:00.000Z',
              updatedAt: '2026-06-25T00:04:00.000Z',
              errorMessage: 'Audio download failed.'
            }
          ]
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '取消转写' }))
    fireEvent.click(screen.getByRole('button', { name: '展开转写队列' }))
    fireEvent.click(screen.getByRole('button', { name: '重试 Failed video' }))

    expect(onCancelQueuedVideoAudioTranscription).toHaveBeenCalledWith('bvid:BV1note')
    expect(onRetryQueuedVideoAudioTranscription).toHaveBeenCalledWith('bvid:BV2note')
  })

  it('passes a summary-only retry action into the notes panel', () => {
    const onRetryQueuedVideoSummary = vi.fn()

    render(
      <MemorialPanel
        recommendation={inboxRecommendation}
        commentDrafts={['先留一评。']}
        videoCategory="待分拣"
        videoTitle="测试稿件"
        onAction={vi.fn()}
        onClose={vi.fn()}
        onGenerateVideoNote={vi.fn().mockResolvedValue(null)}
        onTranscribeVideoAudio={vi.fn().mockResolvedValue(null)}
        onRetryQueuedVideoSummary={onRetryQueuedVideoSummary}
        onSaveVideoNote={vi.fn().mockResolvedValue(undefined)}
        videoNote={null}
        videoNoteLoading={false}
        initialTab="notes"
        transcriptionQueue={{
          sessionCompletedCount: 1,
          items: [{
            id: 'account:1:aid:2:cid:3',
            accountMid: '1',
            aid: 2,
            cid: 3,
            bvid: 'BV2note',
            url: 'https://www.bilibili.com/video/BV2note',
            title: 'Summary failed video',
            status: 'completed',
            archiveRegistrationStatus: 'registered',
            archiveNoteId: 'bvid:BV2note',
            archiveVersionId: 'version-1',
            summaryStatus: 'failed',
            createdAt: '2026-06-25T00:03:00.000Z',
            updatedAt: '2026-06-25T00:04:00.000Z'
          }]
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '展开转写队列' }))
    fireEvent.click(screen.getByRole('button', { name: '仅重试总结 Summary failed video' }))

    expect(onRetryQueuedVideoSummary).toHaveBeenCalledWith('account:1:aid:2:cid:3')
  })

  it('switches review action parameters with borderless toggles without firing actions', () => {
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
    expect(screen.queryByRole('combobox', { name: '投币厚赏参数' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '拟奏短评参数' })).not.toBeInTheDocument()

    const coinSettings = screen.getByRole('group', { name: '投币厚赏参数' })
    const commentSettings = screen.getByRole('group', { name: '拟奏短评参数' })
    const singleCoinButton = within(coinSettings).getByRole('button', { name: '一枚' })
    const doubleCoinButton = within(coinSettings).getByRole('button', { name: '两枚' })
    const randomCommentButton = within(commentSettings).getByRole('button', { name: '随机' })
    const chooseCommentButton = within(commentSettings).getByRole('button', { name: '选择' })

    expect(singleCoinButton).toHaveAttribute('aria-pressed', 'true')
    expect(doubleCoinButton).toHaveAttribute('aria-pressed', 'false')
    expect(randomCommentButton).toHaveAttribute('aria-pressed', 'true')
    expect(chooseCommentButton).toHaveAttribute('aria-pressed', 'false')
    expect(singleCoinButton).toHaveAttribute('title', '默认投 1 枚硬币（再次点击可补投 1 枚）')
    expect(doubleCoinButton).toHaveAttribute('title', '默认投 2 枚硬币')
    expect(randomCommentButton).toHaveAttribute('title', '随机生成一条弹幕并直接发送')
    expect(chooseCommentButton).toHaveAttribute(
      'title',
      '生成 3 条候选弹幕，选择后发送(也可以复制发评论）'
    )
    expect(screen.getByTestId('review-action-coin')).not.toContainElement(
      coinSettings
    )
    expect(screen.getByTestId('review-action-comment')).not.toContainElement(
      commentSettings
    )
    expect(screen.getByTestId('review-action-coin').parentElement).toBe(
      coinSettings.parentElement
    )
    expect(screen.getByTestId('review-action-comment').parentElement).toBe(
      commentSettings.parentElement
    )
    expect(screen.getByTestId('review-action-coin').parentElement).toHaveClass(
      'memorial-panel__action-card--with-setting'
    )

    fireEvent.click(doubleCoinButton)
    fireEvent.click(chooseCommentButton)

    expect(onPreferenceChange).toHaveBeenCalledWith({ defaultCoinCount: 2 })
    expect(onPreferenceChange).toHaveBeenCalledWith({ commentSubmitMode: 'choose' })
    expect(onAction).not.toHaveBeenCalled()
  })
})
