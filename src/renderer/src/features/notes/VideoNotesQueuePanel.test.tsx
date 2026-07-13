import type { ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { VideoAudioTranscriptionQueueSnapshot, VideoNote, VideoNoteArchiveEntry } from '@shared/types'
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

const queuedCompletedNote: VideoNote = {
  ...sampleNote,
  id: 'note-queued-completed',
  source: {
    title: 'Completed video',
    author: 'Queue teacher',
    tags: ['Queue'],
    bvid: 'BV3note',
    url: 'https://www.bilibili.com/video/BV3note'
  },
  transcript: [
    { start: 0, end: 8, text: 'Completed queued transcript.' },
    { start: 9, end: 18, text: 'Second queued line.' }
  ],
  updatedAt: '2026-06-25T00:04:00.000Z'
}

function renderQueuePanel(
  queue: VideoAudioTranscriptionQueueSnapshot,
  props: Partial<ComponentProps<typeof VideoNotesPanel>> = {}
) {
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
      {...props}
    />
  )

  return {
    onEnqueueTranscription
  }
}

function renderQueuePanelWithNote(queue: VideoAudioTranscriptionQueueSnapshot) {
  render(
    <VideoNotesPanel
      note={sampleNote}
      isLoading={false}
      onGenerate={vi.fn()}
      onSave={vi.fn()}
      onTranscribeAudio={vi.fn()}
      onEnqueueTranscription={vi.fn().mockResolvedValue(queue)}
      transcriptionQueue={queue}
    />
  )
}

function createArchive(note: VideoNote): VideoNoteArchiveEntry {
  return {
    id: note.id,
    source: note.source,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    versions: [
      {
        id: `${note.id}:version:${note.updatedAt}`,
        note,
        plainTranscript: note.transcript.map((segment) => segment.text).join('\n\n'),
        summaryText: '',
        createdAt: note.updatedAt
      }
    ]
  }
}

describe('VideoNotesPanel transcription queue', () => {
  it('renders a compact running transcription status without extra queue controls', () => {
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      activeItemId: 'bvid:BV2note',
      sessionCompletedCount: 3,
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

    expect(screen.getByText('本次完成：3 个')).toBeInTheDocument()

    const status = screen.getByRole('region', { name: '转写状态' })

    expect(status).toHaveTextContent('正在转写：Running video')
    expect(status).toHaveTextContent('排队中：1 个')
    const queueCount = screen.getByText('排队中：1 个')
    const queueDetails =
      '等待转写：Pending video\n正在转写：Running video\n转写失败：Failed video'
    expect(queueCount).toHaveAttribute('title', queueDetails)
    expect(screen.getByRole('button', { name: '切换队列视频' })).toHaveAttribute(
      'title',
      queueDetails
    )
    fireEvent.click(screen.getByRole('button', { name: '切换队列视频' }))
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      '等待转写：Pending video取消',
      '正在转写：Running video取消',
      '转写失败：Failed video重试'
    ])
    expect(screen.getByText('正在转写第 2 / 4 段')).toBeInTheDocument()
    expect(screen.getByText('49%')).toBeInTheDocument()
    expect(screen.getByLabelText('转写音频到文稿生成整体进度')).toHaveAttribute('value', '49')
    expect(screen.queryByRole('button', { name: '加入队列' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取消转写' })).toBeInTheDocument()
    expect(screen.queryByText('Audio download failed.')).not.toBeInTheDocument()
  })

  it('calls queue row actions without switching the selected preview', () => {
    const onCancelQueuedVideoAudioTranscription = vi.fn()
    const onRetryQueuedVideoAudioTranscription = vi.fn()
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      activeItemId: 'bvid:BV2note',
      sessionCompletedCount: 3,
      items: [
        {
          id: 'bvid:BV2note',
          url: 'https://www.bilibili.com/video/BV2note',
          title: 'Running video',
          bvid: 'BV2note',
          status: 'running',
          createdAt: '2026-06-25T00:01:00.000Z',
          updatedAt: '2026-06-25T00:02:00.000Z'
        },
        {
          id: 'bvid:BV3note',
          url: 'https://www.bilibili.com/video/BV3note',
          title: 'Completed video',
          bvid: 'BV3note',
          status: 'completed',
          createdAt: '2026-06-25T00:03:00.000Z',
          updatedAt: '2026-06-25T00:04:00.000Z',
          completedAt: '2026-06-25T00:04:00.000Z',
          draftNote: queuedCompletedNote
        },
        {
          id: 'bvid:BV4note',
          url: 'https://www.bilibili.com/video/BV4note',
          title: 'Failed video',
          bvid: 'BV4note',
          status: 'failed',
          createdAt: '2026-06-25T00:05:00.000Z',
          updatedAt: '2026-06-25T00:06:00.000Z'
        }
      ]
    }

    renderQueuePanel(queue, {
      onCancelQueuedVideoAudioTranscription,
      onRetryQueuedVideoAudioTranscription
    })

    fireEvent.click(screen.getByRole('button', { name: '切换队列视频' }))
    fireEvent.click(screen.getByRole('button', { name: '取消 Running video' }))

    expect(onCancelQueuedVideoAudioTranscription).toHaveBeenCalledWith('bvid:BV2note')
    expect(screen.getByRole('region', { name: '转写状态' })).toHaveTextContent('正在转写：Running video')

    fireEvent.click(screen.getByRole('button', { name: '重试 Failed video' }))

    expect(onRetryQueuedVideoAudioTranscription).toHaveBeenCalledWith('bvid:BV4note')
    expect(screen.getByRole('region', { name: '转写状态' })).toHaveTextContent('正在转写：Running video')

    fireEvent.click(screen.getByRole('menuitem', { name: /Completed video/ }))
    expect(screen.getByRole('region', { name: '转写状态' })).toHaveTextContent(
      '排队已完成：Completed video'
    )
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

  it('shows saved transcript completion when the DeepSeek summary step fails', () => {
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      items: [
        {
          id: 'bvid:BV2note',
          url: 'https://www.bilibili.com/video/BV2note',
          title: 'Summary failed video',
          bvid: 'BV2note',
          status: 'completed',
          summarizeWithDeepSeek: true,
          errorMessage: 'DeepSeek is not configured.',
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

    expect(screen.getByRole('region', { name: '转写状态' })).toHaveTextContent(
      '排队已完成：Summary failed video'
    )
    expect(screen.getByRole('status')).toHaveTextContent('文稿已生成，总结未完成')
    expect(screen.queryByText(/转写失败/)).not.toBeInTheDocument()
  })

  it('keeps transcript tabs usable when the queue is idle after completion', () => {
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      items: [
        {
          id: 'bvid:BV2note',
          url: 'https://www.bilibili.com/video/BV2note',
          title: 'Completed video',
          bvid: 'BV2note',
          status: 'completed',
          createdAt: '2026-06-25T00:01:00.000Z',
          updatedAt: '2026-06-25T00:04:00.000Z',
          completedAt: '2026-06-25T00:04:00.000Z'
        }
      ]
    }

    renderQueuePanelWithNote(queue)

    expect(screen.getByRole('region', { name: '转写状态' })).toHaveTextContent(
      '排队已完成：Completed video'
    )
    expect(screen.getByRole('tab', { name: /无时间线文稿/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /带时间线文稿/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /DeepSeek 总结/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /无时间线文稿/ }))

    expect(screen.getByRole('tabpanel', { name: /无时间线文稿/ })).toHaveTextContent(
      'Transcript text.'
    )
  })

  it('normalizes stale progress on completed queue items after restart', () => {
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      items: [
        {
          id: 'bvid:BV2note',
          url: 'https://www.bilibili.com/video/BV2note',
          title: 'Completed video',
          bvid: 'BV2note',
          status: 'completed',
          createdAt: '2026-06-25T00:01:00.000Z',
          updatedAt: '2026-06-25T00:04:00.000Z',
          completedAt: '2026-06-25T00:04:00.000Z',
          progress: {
            step: 'generating-note',
            message: 'Generating note from transcript.'
          }
        }
      ]
    }

    renderQueuePanel(queue)

    expect(screen.getByRole('region', { name: '转写状态' })).toHaveTextContent(
      '排队已完成：Completed video'
    )
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.queryByText('94%')).not.toBeInTheDocument()
  })

  it('switches queued videos from the queue selector and previews each draft transcript', () => {
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      activeItemId: 'bvid:BV2note',
      items: [
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
            message: 'Transcribing segment 1/2.',
            segmentIndex: 1,
            segmentCount: 2
          }
        },
        {
          id: 'bvid:BV3note',
          url: 'https://www.bilibili.com/video/BV3note',
          title: 'Completed video',
          bvid: 'BV3note',
          status: 'completed',
          createdAt: '2026-06-25T00:03:00.000Z',
          updatedAt: '2026-06-25T00:04:00.000Z',
          completedAt: '2026-06-25T00:04:00.000Z',
          draftNote: queuedCompletedNote
        }
      ]
    }

    renderQueuePanel(queue)

    fireEvent.click(screen.getByRole('button', { name: '切换队列视频' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Completed video/ }))
    fireEvent.click(screen.getByRole('tab', { name: /无时间线文稿/ }))

    expect(screen.getByRole('region', { name: '转写状态' })).toHaveTextContent(
      '排队已完成：Completed video'
    )
    expect(screen.getByRole('tabpanel', { name: /无时间线文稿/ })).toHaveTextContent(
      'Completed queued transcript.'
    )
    expect(screen.getByRole('tabpanel', { name: /无时间线文稿/ })).not.toHaveTextContent(
      'Transcript text.'
    )
  })

  it('previews the selected completed queue item from its archived note when the queue item no longer keeps a draft', () => {
    const otherCompletedNote: VideoNote = {
      ...sampleNote,
      id: 'note-other-completed',
      source: {
        title: 'Other completed video',
        author: 'Other teacher',
        tags: [],
        bvid: 'BV4note',
        url: 'https://www.bilibili.com/video/BV4note'
      },
      transcript: [{ start: 0, end: 6, text: 'Other archived transcript.' }],
      updatedAt: '2026-06-25T00:05:00.000Z'
    }
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      items: [
        {
          id: 'bvid:BV3note',
          url: 'https://www.bilibili.com/video/BV3note',
          title: 'Completed video',
          bvid: 'BV3note',
          status: 'completed',
          archiveNoteId: queuedCompletedNote.id,
          createdAt: '2026-06-25T00:03:00.000Z',
          updatedAt: '2026-06-25T00:04:00.000Z',
          completedAt: '2026-06-25T00:04:00.000Z'
        },
        {
          id: 'bvid:BV4note',
          url: 'https://www.bilibili.com/video/BV4note',
          title: 'Other completed video',
          bvid: 'BV4note',
          status: 'completed',
          archiveNoteId: otherCompletedNote.id,
          createdAt: '2026-06-25T00:04:00.000Z',
          updatedAt: '2026-06-25T00:05:00.000Z',
          completedAt: '2026-06-25T00:05:00.000Z'
        }
      ]
    }

    render(
      <VideoNotesPanel
        note={null}
        isLoading={false}
        onGenerate={vi.fn()}
        onSave={vi.fn()}
        onTranscribeAudio={vi.fn()}
        onEnqueueTranscription={vi.fn().mockResolvedValue(queue)}
        transcriptionQueue={queue}
        archivedNotes={[createArchive(queuedCompletedNote), createArchive(otherCompletedNote)]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '切换队列视频' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Completed video/ }))
    fireEvent.click(screen.getAllByRole('tab')[0])

    expect(screen.getByRole('tabpanel')).toHaveTextContent('Completed queued transcript.')
    expect(screen.getByRole('tabpanel')).not.toHaveTextContent('Other archived transcript.')
  })
})
