import type { ComponentProps } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { NotePosterSummary, VideoAudioTranscriptionQueueSnapshot, VideoNote } from '@shared/types'
import { VideoNotesPanel } from './VideoNotesPanel'

const sampleNote: VideoNote = {
  id: 'note-1',
  source: {
    title: '机器学习入门',
    author: '李老师',
    tags: ['AI'],
    bvid: 'BV1note',
    url: 'https://www.bilibili.com/video/BV1note'
  },
  transcriptSource: 'auto',
  transcript: [
    { start: 0, end: 12, text: '先介绍机器学习的基本概念。' },
    { start: 75, end: 120, text: '再说明训练数据如何影响模型。' }
  ],
  chapters: [],
  overview: {
    shortSummary: ['三分钟讲清机器学习的基本思路。'],
    keywords: ['机器学习', '训练数据'],
    timeline: [
      { start: 0, title: '开场', detail: '解释机器学习为什么有用。' },
      { start: 75, title: '数据', detail: '说明数据质量的重要性。' }
    ],
    highlights: [{ start: 75, title: '核心提示', detail: '训练数据决定模型上限。' }]
  },
  annotations: [],
  userMemo: '',
  createdAt: '2026-04-28T00:00:00.000Z',
  updatedAt: '2026-04-28T00:00:00.000Z'
}

function renderPanel(props: Partial<ComponentProps<typeof VideoNotesPanel>> = {}): ReturnType<typeof render> {
  return render(
    <VideoNotesPanel
      note={sampleNote}
      isLoading={false}
      onGenerate={vi.fn()}
      onSave={vi.fn()}
      {...props}
    />
  )
}

describe('VideoNotesPanel', () => {
  it('puts archive guidance inside the primary action buttons', () => {
    const { container } = renderPanel({ note: null, onTranscribeAudio: vi.fn(), onOpenArchive: vi.fn() })

    expect(screen.queryByText('转写完成后保存到全局档案库。')).not.toBeInTheDocument()
    expect(screen.queryByText('生成与归档')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '转写音频' })).toHaveTextContent(
      '一键转写视频音频，生成文稿自动保存在档案库'
    )
    expect(screen.getByRole('button', { name: '档案库' })).toHaveTextContent(
      '打开档案库，可查看或备注视频文稿'
    )
    expect(
      Array.from(container.querySelectorAll('.assistant-action-button__icon strong')).map(
        (badge) => badge.textContent
      )
    ).toEqual(['转', '库'])
    expect(screen.getByRole('img', { name: '小咪转写音频' })).toHaveClass(
      'assistant-action-button__pet'
    )
    expect(screen.getByRole('img', { name: '小咪档案库' })).toHaveClass(
      'assistant-action-button__pet'
    )
  })

  it('uses audio transcription for the primary action when available', async () => {
    const onGenerate = vi.fn().mockResolvedValue(null)
    const onTranscribeAudio = vi.fn().mockResolvedValue(sampleNote)
    renderPanel({ note: null, onGenerate, onTranscribeAudio })
    fireEvent.click(screen.getByRole('button', { name: '转写音频' }))
    await waitFor(() => expect(onTranscribeAudio).toHaveBeenCalledOnce())
    expect(onGenerate).not.toHaveBeenCalled()
  })

  it('keeps transcript result panels closed after audio transcription completes until the user opens them', async () => {
    const onTranscribeAudio = vi.fn().mockResolvedValue(sampleNote)
    const { rerender } = renderPanel({ note: null, onTranscribeAudio })

    expect(screen.getByRole('tab', { name: /无时间线文稿/ })).toHaveAttribute(
      'aria-selected',
      'false'
    )
    expect(screen.queryByText('暂无文稿。点击“转写音频”开始。')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '转写音频' }))

    await waitFor(() => expect(onTranscribeAudio).toHaveBeenCalledOnce())
    rerender(
      <VideoNotesPanel
        note={sampleNote}
        isLoading={false}
        onGenerate={vi.fn()}
        onSave={vi.fn()}
        onTranscribeAudio={onTranscribeAudio}
      />
    )
    expect(screen.getByRole('tab', { name: /无时间线文稿/ })).toHaveAttribute(
      'aria-selected',
      'false'
    )
    expect(screen.queryByRole('tabpanel', { name: /无时间线文稿/ })).not.toBeInTheDocument()
  })

  it('lets users collapse transcript result tabs and keeps the panel collapsed across rerenders', () => {
    const { rerender } = renderPanel()

    fireEvent.click(screen.getByRole('tab', { name: /无时间线文稿/ }))
    expect(screen.getByRole('tabpanel', { name: /无时间线文稿/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /无时间线文稿/ }))
    expect(screen.queryByRole('tabpanel', { name: /无时间线文稿/ })).not.toBeInTheDocument()

    rerender(
      <VideoNotesPanel
        note={sampleNote}
        isLoading={false}
        onGenerate={vi.fn()}
        onSave={vi.fn()}
      />
    )

    expect(screen.queryByRole('tabpanel', { name: /无时间线文稿/ })).not.toBeInTheDocument()
  })

  it('uses the primary transcription action to enqueue the first video when queue support is available', async () => {
    const onTranscribeAudio = vi.fn().mockResolvedValue(sampleNote)
    const onEnqueueTranscription = vi.fn().mockResolvedValue({
      activeItemId: 'bvid:BV-current',
      items: [
        {
          id: 'bvid:BV-current',
          url: 'https://www.bilibili.com/video/BV-current',
          title: '当前视频',
          bvid: 'BV-current',
          status: 'running',
          createdAt: '2026-06-25T00:00:00.000Z',
          updatedAt: '2026-06-25T00:00:00.000Z'
        }
      ]
    } satisfies VideoAudioTranscriptionQueueSnapshot)

    renderPanel({
      note: null,
      currentVideoTitle: '当前视频',
      onTranscribeAudio,
      onEnqueueTranscription,
      transcriptionQueue: { items: [] }
    })

    fireEvent.click(screen.getByRole('button', { name: '转写音频' }))

    await waitFor(() => expect(onEnqueueTranscription).toHaveBeenCalledOnce())
    expect(onTranscribeAudio).not.toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: /无时间线文稿/ })).toHaveAttribute(
      'aria-selected',
      'false'
    )
    expect(screen.queryByRole('tabpanel', { name: /无时间线文稿/ })).not.toBeInTheDocument()
    expect(await screen.findByText('「当前视频」已开始转写。')).toBeInTheDocument()
  })

  it('uses the primary transcription action to enqueue when another video is already running', async () => {
    const onTranscribeAudio = vi.fn().mockResolvedValue(sampleNote)
    const onEnqueueTranscription = vi.fn().mockResolvedValue({
      activeItemId: 'bvid:BV-running',
      items: [
        {
          id: 'bvid:BV-running',
          url: 'https://www.bilibili.com/video/BV-running',
          title: '正在跑的视频',
          bvid: 'BV-running',
          status: 'running',
          createdAt: '2026-06-25T00:00:00.000Z',
          updatedAt: '2026-06-25T00:00:00.000Z'
        },
        {
          id: 'bvid:BV-next',
          url: 'https://www.bilibili.com/video/BV-next',
          title: '当前视频',
          bvid: 'BV-next',
          status: 'pending',
          createdAt: '2026-06-25T00:01:00.000Z',
          updatedAt: '2026-06-25T00:01:00.000Z'
        }
      ]
    } satisfies VideoAudioTranscriptionQueueSnapshot)

    renderPanel({
      note: null,
      currentVideoTitle: '当前视频',
      onTranscribeAudio,
      onEnqueueTranscription,
      transcriptionQueue: {
        activeItemId: 'bvid:BV-running',
        items: [
          {
            id: 'bvid:BV-running',
            url: 'https://www.bilibili.com/video/BV-running',
            title: '正在跑的视频',
            bvid: 'BV-running',
            status: 'running',
            createdAt: '2026-06-25T00:00:00.000Z',
            updatedAt: '2026-06-25T00:00:00.000Z',
            progress: {
              step: 'transcribing-segment',
              message: 'Transcribing segment 1/2.',
              segmentIndex: 1,
              segmentCount: 2
            }
          }
        ]
      }
    })

    expect(screen.queryByRole('button', { name: '加入队列' })).not.toBeInTheDocument()
    const queueStatus = screen.getByRole('region', { name: '转写状态' })
    expect(queueStatus).toHaveTextContent('正在转写：正在跑的视频')
    expect(queueStatus).toHaveTextContent('排队中：0 个')

    fireEvent.click(screen.getByRole('button', { name: '转写音频' }))

    await waitFor(() => expect(onEnqueueTranscription).toHaveBeenCalledOnce())
    expect(onTranscribeAudio).not.toHaveBeenCalled()
    expect(await screen.findByText('正在转写「正在跑的视频」，「当前视频」已加入队列。')).toBeInTheDocument()
  })

  it('shows Chinese transcription progress with a visual percentage', () => {
    renderPanel({
      note: null,
      onTranscribeAudio: vi.fn(),
      transcriptionProgress: {
        step: 'transcribing-segment',
        message: 'Transcribing segment 1/2.',
        segmentIndex: 1,
        segmentCount: 2
      }
    })
    expect(screen.getByText('正在转写第 1 / 2 段')).toBeInTheDocument()
    expect(screen.getByText('49%')).toBeInTheDocument()
    expect(screen.getByLabelText('转写音频到文稿生成整体进度')).toHaveAttribute('value', '49')
    expect(screen.queryByText('Transcribing segment 1/2.')).not.toBeInTheDocument()
  })

  it('uses the current video author before a transcription note exists', () => {
    renderPanel({
      note: null,
      currentVideoTitle: '当前视频',
      currentVideoAuthor: '李老师讲AI',
      onTranscribeAudio: vi.fn()
    })

    expect(screen.getByText('UP').nextElementSibling).toHaveTextContent('李老师讲AI')
  })

  it('prompts users to enable DeepSeek when opening DeepSeek summary while disabled', () => {
    const onGeneratePoster = vi.fn()
    renderPanel({ deepSeekEnabled: false, onGeneratePoster })
    fireEvent.click(screen.getByRole('tab', { name: /DeepSeek 总结/ }))
    expect(screen.getAllByText('请先到设置启用 DeepSeek 后再生成总结。').length).toBeGreaterThan(0)
    expect(onGeneratePoster).not.toHaveBeenCalled()
  })

  it('enables DeepSeek summary generation immediately after DeepSeek is turned on', () => {
    const onGeneratePoster = vi.fn()
    const { rerender } = renderPanel({ deepSeekEnabled: false, onGeneratePoster })

    fireEvent.click(screen.getByRole('tab', { name: /DeepSeek 总结/ }))
    expect(screen.getByRole('button', { name: '生成总结' })).toBeDisabled()

    rerender(
      <VideoNotesPanel
        note={sampleNote}
        isLoading={false}
        onGenerate={vi.fn()}
        onSave={vi.fn()}
        deepSeekEnabled={true}
        onGeneratePoster={onGeneratePoster}
      />
    )

    expect(screen.getByRole('button', { name: '生成总结' })).not.toBeDisabled()
    expect(screen.getByText('请点击生成总结，让 DeepSeek 基于文稿生成精准总结。')).toBeInTheDocument()
  })

  it('generates DeepSeek summary from an explicit current-note action', async () => {
    const poster: NotePosterSummary = {
      title: 'Learning Machine Models',
      subtitle: 'Compact study poster',
      keyPoints: ['Data quality matters', 'Models need examples'],
      keywords: ['AI', 'notes'],
      prompt: 'clean poster',
      polishedTranscriptText: '## 精修文稿\n\n先介绍机器学习的基本概念。',
      auditChecklistText: '- 数据：训练数据\n- 结论：数据质量影响模型'
    }
    const onGeneratePoster = vi.fn().mockResolvedValue(poster)
    const onArchivePosterSummary = vi.fn().mockResolvedValue(undefined)
    renderPanel({ deepSeekEnabled: true, onGeneratePoster, onArchivePosterSummary })
    fireEvent.click(screen.getByRole('tab', { name: /DeepSeek 总结/ }))
    expect(onGeneratePoster).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /点击总结/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /自动总结/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '生成总结' }))
    await waitFor(() => expect(onGeneratePoster).toHaveBeenCalledWith(sampleNote))
    expect(onArchivePosterSummary).toHaveBeenCalledWith(sampleNote, poster)
    expect(await screen.findByRole('button', { name: '重新总结' })).toBeInTheDocument()
    const summaryRegion = await screen.findByRole('region', { name: 'DeepSeek 总结' })
    expect(summaryRegion).toHaveClass('video-notes__summary-result')
    expect(summaryRegion).toHaveTextContent('Learning Machine Models')
    expect(screen.getByText('Data quality matters')).toBeInTheDocument()
    expect(screen.getByText('精修文稿')).toBeInTheDocument()
    expect(screen.getByText('先介绍机器学习的基本概念。')).toBeInTheDocument()
    expect(screen.getByText('内容核对清单')).toBeInTheDocument()
    expect(summaryRegion.textContent?.indexOf('Learning Machine Models')).toBeLessThan(
      summaryRegion.textContent?.indexOf('精修文稿') ?? -1
    )
  })

  it('does not show local draft overview as a DeepSeek summary before generation', () => {
    renderPanel({ deepSeekEnabled: true, onGeneratePoster: vi.fn() })

    fireEvent.click(screen.getByRole('tab', { name: /DeepSeek 总结/ }))

    expect(screen.getByRole('button', { name: '生成总结' })).toBeInTheDocument()
    expect(screen.queryByText('三分钟讲清机器学习的基本思路。')).not.toBeInTheDocument()
    expect(screen.queryByText('训练数据决定模型上限。')).not.toBeInTheDocument()
    expect(screen.getByText('请点击生成总结，让 DeepSeek 基于文稿生成精准总结。')).toBeInTheDocument()
  })

  it('shows an archived DeepSeek summary without requiring a new generation', () => {
    const archivedSummaryText = [
      '## 精准总结',
      '',
      '### Archived Machine Models',
      'Data quality matters for model training.',
      '',
      '## 精修文稿',
      '',
      'Archived polished transcript.',
      '',
      '## 内容核对清单',
      '',
      '- Data point checked.'
    ].join('\n')
    renderPanel({ deepSeekEnabled: true, archivedSummaryText, onGeneratePoster: vi.fn() })

    fireEvent.click(screen.getByRole('tab', { name: /DeepSeek/ }))

    expect(screen.getByRole('region', { name: /DeepSeek/ })).toHaveTextContent(
      'Archived Machine Models'
    )
    expect(screen.getByText(/Archived polished transcript/)).toBeInTheDocument()
    expect(screen.queryByText('请点击生成总结，让 DeepSeek 基于文稿生成精准总结。')).not.toBeInTheDocument()
  })

  it('reuses the generated DeepSeek summary when the summary tab is reopened', async () => {
    const poster: NotePosterSummary = {
      title: 'Learning Machine Models',
      subtitle: 'Compact study poster',
      keyPoints: ['Data quality matters'],
      keywords: ['AI'],
      prompt: 'clean poster',
      polishedTranscriptText: '## 精修文稿\n\n先介绍机器学习。',
      auditChecklistText: '- 观点：数据重要'
    }
    const onGeneratePoster = vi.fn().mockResolvedValue(poster)
    renderPanel({ deepSeekEnabled: true, onGeneratePoster })

    fireEvent.click(screen.getByRole('tab', { name: /DeepSeek 总结/ }))
    fireEvent.click(screen.getByRole('button', { name: '生成总结' }))
    expect(await screen.findByText('Learning Machine Models')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /无时间线文稿/ }))
    fireEvent.click(screen.getByRole('tab', { name: /DeepSeek 总结/ }))

    expect(onGeneratePoster).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '重新总结' })).toBeInTheDocument()
    expect(screen.getByText('Learning Machine Models')).toBeInTheDocument()
  })

  it('uses an attached triangle menu to copy polished transcript and summary separately', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const poster: NotePosterSummary = {
      title: '机器学习入门',
      subtitle: '整体主旨：用数据和模型解释机器学习。',
      keyPoints: ['核心内容：训练数据影响模型表现。'],
      keywords: ['机器学习', '训练数据'],
      prompt: 'clean poster',
      polishedTranscriptText: '## 精修文稿\n\n先介绍机器学习的基本概念。',
      auditChecklistText: '- 数据：训练数据'
    }
    const onGeneratePoster = vi.fn().mockResolvedValue(poster)
    renderPanel({ deepSeekEnabled: true, onGeneratePoster })

    fireEvent.click(screen.getByRole('tab', { name: /DeepSeek 总结/ }))
    fireEvent.click(screen.getByRole('button', { name: '生成总结' }))
    expect(await screen.findByText('机器学习入门')).toBeInTheDocument()

    const splitButton = screen.getByRole('group', { name: 'DeepSeek 复制' })
    expect(within(splitButton).getByRole('button', { name: '复制全文' })).toBeInTheDocument()
    expect(within(splitButton).queryByRole('combobox', { name: '更多复制' })).not.toBeInTheDocument()
    expect(within(splitButton).getByRole('button', { name: '更多复制' })).toHaveTextContent('▾')

    fireEvent.click(within(splitButton).getByRole('button', { name: '更多复制' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '复制精修文' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('先介绍机器学习的基本概念。'))

    fireEvent.click(within(splitButton).getByRole('button', { name: '更多复制' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '复制总结' }))
    await waitFor(() =>
      expect(writeText).toHaveBeenLastCalledWith(
        [
          '## 精准总结',
          '',
          '### 机器学习入门',
          '整体主旨：用数据和模型解释机器学习。',
          '',
          '- 核心内容：训练数据影响模型表现。',
          '关键词：机器学习、训练数据'
        ].join('\n')
      )
    )
  })

  it('does not start audio transcription from DeepSeek summary when no note exists', async () => {
    const onTranscribeAudio = vi.fn().mockResolvedValue(sampleNote)
    const onGeneratePoster = vi.fn()
    renderPanel({ note: null, deepSeekEnabled: true, onTranscribeAudio, onGeneratePoster })
    fireEvent.click(screen.getAllByRole('tab')[2])
    expect(screen.getAllByText('请先转写音频，再生成 DeepSeek 总结。').length).toBeGreaterThan(0)
    expect(onTranscribeAudio).not.toHaveBeenCalled()
    expect(onGeneratePoster).not.toHaveBeenCalled()
  })

  it('requests automatic DeepSeek summary when enabled in settings before transcribing', async () => {
    const onTranscribeAudio = vi.fn().mockResolvedValue(sampleNote)
    renderPanel({
      note: null,
      deepSeekEnabled: true,
      deepSeekAutoSummaryEnabled: true,
      onTranscribeAudio
    })

    fireEvent.click(screen.getByRole('tab', { name: /DeepSeek/ }))
    expect(screen.getByRole('button', { name: '生成总结' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '转写音频' }))

    await waitFor(() =>
      expect(onTranscribeAudio).toHaveBeenCalledWith({ summarizeWithDeepSeek: true })
    )
  })

  it('keeps timed transcript and DeepSeek summary copy actions to top-right copy buttons', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    renderPanel()
    fireEvent.click(screen.getByRole('tab', { name: /带时间线文稿/ }))
    expect(screen.getByText('00:00')).toBeInTheDocument()
    expect(screen.getByText('先介绍机器学习的基本概念。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '复制全文' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('[00:00] 先介绍机器学习的基本概念。')))
    fireEvent.click(screen.getByRole('tab', { name: /DeepSeek 总结/ }))
    expect(screen.getByRole('button', { name: '复制全文' })).toBeInTheDocument()
  })

  it('does not render obsolete annotation, memo, markdown, or image export controls', () => {
    renderPanel({ deepSeekEnabled: true })
    expect(screen.queryByRole('button', { name: '取当前时间' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('批注标题')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存批注' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('本地备注')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Markdown/)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Save image' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generate one-image summary' })).not.toBeInTheDocument()
  })
})
