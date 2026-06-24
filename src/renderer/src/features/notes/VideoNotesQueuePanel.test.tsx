import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  const onCancelQueuedTranscription = vi.fn()
  const onRetryQueuedTranscription = vi.fn()

  render(
    <VideoNotesPanel
      note={null}
      isLoading={false}
      onGenerate={vi.fn()}
      onSave={vi.fn()}
      onTranscribeAudio={vi.fn()}
      onEnqueueTranscription={onEnqueueTranscription}
      onCancelQueuedTranscription={onCancelQueuedTranscription}
      onRetryQueuedTranscription={onRetryQueuedTranscription}
      transcriptionQueue={queue}
    />
  )

  return {
    onEnqueueTranscription,
    onCancelQueuedTranscription,
    onRetryQueuedTranscription
  }
}

describe('VideoNotesPanel transcription queue', () => {
  it('enqueues the current video and renders retryable queue rows', async () => {
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
    const { onCancelQueuedTranscription, onEnqueueTranscription, onRetryQueuedTranscription } =
      renderQueuePanel(queue)

    fireEvent.click(screen.getByRole('button', { name: '加入队列' }))

    await waitFor(() => expect(onEnqueueTranscription).toHaveBeenCalledOnce())
    expect(screen.getByRole('region', { name: '转写队列' })).toHaveTextContent('Pending video')
    expect(screen.getByRole('region', { name: '转写队列' })).toHaveTextContent('Running video')
    expect(screen.getByText('正在转写第 2 / 4 段')).toBeInTheDocument()
    expect(screen.getByText('Audio download failed.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '取消 Pending video' }))
    expect(onCancelQueuedTranscription).toHaveBeenCalledWith('bvid:BV1note')

    fireEvent.click(screen.getByRole('button', { name: '重试 Failed video' }))
    expect(onRetryQueuedTranscription).toHaveBeenCalledWith('bvid:BV3note')
  })
})
