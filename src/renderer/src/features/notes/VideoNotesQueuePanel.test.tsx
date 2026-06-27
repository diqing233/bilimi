import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { VideoAudioTranscriptionQueueSnapshot, VideoNote } from '@shared/types'
import { VideoNotesPanel } from './VideoNotesPanel'

const sampleNote: VideoNote = {
  id: 'note-1',
  source: {
    title: 'Current note',
    author: 'Teacher',
    tags: ['AI'],
    bvid: 'BV1note',
    url: 'https://www.bilibili.com/video/BV1note'
  },
  transcriptSource: 'auto',
  transcript: [{ start: 0, end: 12, text: 'Transcript text.' }],
  chapters: [],
  overview: {
    shortSummary: ['Summary text.'],
    keywords: ['AI'],
    timeline: [],
    highlights: []
  },
  annotations: [],
  userMemo: '',
  createdAt: '2026-04-28T00:00:00.000Z',
  updatedAt: '2026-04-28T00:00:00.000Z'
}

function renderQueuePanel(queue: VideoAudioTranscriptionQueueSnapshot) {
  const onEnqueueTranscription = vi.fn().mockResolvedValue(queue)

  render(
    <VideoNotesPanel
      note={null}
      isLoading={false}
      onGenerate={vi.fn()}
      onSave={vi.fn()}
      onTranscribeAudio={vi.fn()}
      onEnqueueTranscription={onEnqueueTranscription}
      transcriptionQueue={queue}
    />
  )

  return {
    onEnqueueTranscription
  }
}

describe('VideoNotesPanel transcription queue', () => {
  it('renders a compact running transcription status without extra queue controls', () => {
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      activeItemId: 'bvid:BV2note',
      items: [
        {
          id: 'bvid:BV1note',
          url: 'https://www.bilibili.com/video/BV1note',
          title: 'Pending video',
          bvid: 'BV1note',
          status: 'pending',
          createdAt: '2026-06-25T00:00:00.000Z',
          updatedAt: '2026-06-25T00:00:00.000Z'
        },
        {
          id: 'bvid:BV2note',
          url: 'https://www.bilibili.com/video/BV2note',
          title: 'Running video',
          bvid: 'BV2note',
          status: 'running',
          createdAt: '2026-06-25T00:01:00.000Z',
          updatedAt: '2026-06-25T00:02:00.000Z',
          progress: {
            step: 'transcribing-segment',
            message: 'Transcribing segment 2/4.',
            segmentIndex: 2,
            segmentCount: 4
          }
        },
        {
          id: 'bvid:BV3note',
          url: 'https://www.bilibili.com/video/BV3note',
          title: 'Failed video',
          bvid: 'BV3note',
          status: 'failed',
          createdAt: '2026-06-25T00:03:00.000Z',
          updatedAt: '2026-06-25T00:04:00.000Z',
          errorMessage: 'Audio download failed.'
        }
      ]
    }
    renderQueuePanel(queue)

    const status = screen.getByRole('region', { name: '转写状态' })

    expect(status).toHaveTextContent('正在转写：Running video')
    expect(status).toHaveTextContent('排队中：1 个')
    expect(screen.getByText('正在转写第 2 / 4 段')).toBeInTheDocument()
    expect(screen.getByText('49%')).toBeInTheDocument()
    expect(screen.getByLabelText('转写音频到文稿生成整体进度')).toHaveAttribute('value', '49')
    expect(screen.queryByRole('button', { name: '加入队列' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /取消/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /重试/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Audio download failed.')).not.toBeInTheDocument()
  })

  it('shows DeepSeek summary progress as part of the overall queued task', () => {
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      activeItemId: 'bvid:BV2note',
      items: [
        {
          id: 'bvid:BV2note',
          url: 'https://www.bilibili.com/video/BV2note',
          title: 'Running video',
          bvid: 'BV2note',
          status: 'running',
          summarizeWithDeepSeek: true,
          createdAt: '2026-06-25T00:01:00.000Z',
          updatedAt: '2026-06-25T00:02:00.000Z',
          progress: {
            step: 'summarizing-deepseek',
            message: 'Generating DeepSeek summary.'
          }
        }
      ]
    }

    renderQueuePanel(queue)

    expect(screen.getByText('正在生成 DeepSeek 总结')).toBeInTheDocument()
    expect(screen.getByText('96%')).toBeInTheDocument()
    expect(screen.getByLabelText('转写音频到 DeepSeek 总结整体进度')).toHaveAttribute('value', '96')
  })

  it('keeps the queue panel visible when the latest queued item completes', () => {
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      items: [
        {
          id: 'bvid:BV2note',
          url: 'https://www.bilibili.com/video/BV2note',
          title: 'Completed video',
          bvid: 'BV2note',
          status: 'completed',
          summarizeWithDeepSeek: true,
          createdAt: '2026-06-25T00:01:00.000Z',
          updatedAt: '2026-06-25T00:04:00.000Z',
          completedAt: '2026-06-25T00:04:00.000Z',
          progress: {
            step: 'queue-completed',
            message: 'Queued transcription completed.'
          }
        }
      ]
    }

    renderQueuePanel(queue)

    const status = screen.getByRole('region', { name: '转写状态' })
    expect(status).toHaveTextContent('排队已完成：Completed video')
    expect(screen.getByText('DeepSeek 总结已完成')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
  })
})
