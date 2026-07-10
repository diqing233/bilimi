import { fireEvent, render, screen, within } from '@testing-library/react'
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

function openQueueMenu(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: '查看转写队列' }))
  return screen.getByRole('dialog', { name: '转写队列' })
}

function selectQueueItem(title: string): void {
  fireEvent.click(within(openQueueMenu()).getByRole('button', { name: `查看队列任务：${title}` }))
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
  it('renders a compact running transcription status with cancellation beside progress', () => {
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      sessionCompletedCount: 0,
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
    const { onCancelQueuedTranscription } = renderQueuePanel(queue)

    const status = screen.getByRole('region', { name: '转写状态' })

    expect(status).toHaveTextContent('正在转写：Running video')
    expect(status).toHaveTextContent('排队中：1 个')
    const queueCount = screen.getByText('排队中：1 个')
    const queueDetails =
      '等待转写：Pending video\n正在转写：Running video\n转写失败：Failed video'
    expect(queueCount).toHaveAttribute('title', queueDetails)
    const header = status.querySelector('.video-notes__panel-header')
    expect(header).not.toContainElement(screen.getByRole('button', { name: '取消转写' }))
    expect(screen.getByRole('button', { name: '查看转写队列' })).toHaveAttribute(
      'title',
      queueDetails
    )
    expect(screen.getByText('正在转写第 2 / 4 段')).toBeInTheDocument()
    expect(screen.getByText('49%')).toBeInTheDocument()
    expect(screen.getByLabelText('转写音频到文稿生成整体进度')).toHaveAttribute('value', '49')
    expect(screen.queryByRole('button', { name: '加入队列' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '取消转写' }))
    expect(onCancelQueuedTranscription).toHaveBeenCalledWith('bvid:BV2note')
    expect(screen.queryByRole('button', { name: /重试/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Audio download failed.')).not.toBeInTheDocument()
  })

  it('opens a queue menu with status-specific actions separate from item selection', () => {
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      sessionCompletedCount: 1,
      activeItemId: 'bvid:BV-running',
      items: [
        {
          id: 'bvid:BV-running',
          url: 'https://www.bilibili.com/video/BV-running',
          title: 'Running video',
          bvid: 'BV-running',
          status: 'running',
          createdAt: '2026-06-25T00:00:00.000Z',
          updatedAt: '2026-06-25T00:00:00.000Z'
        },
        {
          id: 'bvid:BV-pending',
          url: 'https://www.bilibili.com/video/BV-pending',
          title: 'Pending video',
          bvid: 'BV-pending',
          status: 'pending',
          createdAt: '2026-06-25T00:01:00.000Z',
          updatedAt: '2026-06-25T00:01:00.000Z'
        },
        {
          id: 'bvid:BV-failed',
          url: 'https://www.bilibili.com/video/BV-failed',
          title: 'Failed video',
          bvid: 'BV-failed',
          status: 'failed',
          createdAt: '2026-06-25T00:02:00.000Z',
          updatedAt: '2026-06-25T00:02:00.000Z'
        },
        {
          id: 'bvid:BV-canceled',
          url: 'https://www.bilibili.com/video/BV-canceled',
          title: 'Canceled video',
          bvid: 'BV-canceled',
          status: 'canceled',
          createdAt: '2026-06-25T00:03:00.000Z',
          updatedAt: '2026-06-25T00:03:00.000Z'
        },
        {
          id: 'bvid:BV-completed',
          url: 'https://www.bilibili.com/video/BV-completed',
          title: 'Completed video',
          bvid: 'BV-completed',
          status: 'completed',
          createdAt: '2026-06-25T00:04:00.000Z',
          updatedAt: '2026-06-25T00:04:00.000Z',
          completedAt: '2026-06-25T00:04:00.000Z'
        }
      ]
    }
    const { onCancelQueuedTranscription, onRetryQueuedTranscription } = renderQueuePanel(queue)

    fireEvent.click(screen.getByRole('button', { name: '查看转写队列' }))

    const menu = screen.getByRole('dialog', { name: '转写队列' })
    expect(within(menu).getByRole('button', { name: '查看队列任务：Pending video' })).toBeInTheDocument()
    fireEvent.click(within(menu).getByRole('button', { name: '取消转写：Pending video' }))
    expect(onCancelQueuedTranscription).toHaveBeenCalledWith('bvid:BV-pending')

    fireEvent.click(within(menu).getByRole('button', { name: '重试转写：Failed video' }))
    expect(onRetryQueuedTranscription).toHaveBeenCalledWith('bvid:BV-failed')
    fireEvent.click(within(menu).getByRole('button', { name: '重新转写：Canceled video' }))
    expect(onRetryQueuedTranscription).toHaveBeenCalledWith('bvid:BV-canceled')
    expect(within(menu).getAllByRole('button', { name: /Completed video/ })).toHaveLength(1)
  })

  it('focuses the active queue item when the queue dialog opens', () => {
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      sessionCompletedCount: 0,
      activeItemId: 'bvid:BV-running',
      items: [
        {
          id: 'bvid:BV-pending',
          url: 'https://www.bilibili.com/video/BV-pending',
          title: 'Pending video',
          bvid: 'BV-pending',
          status: 'pending',
          createdAt: '2026-06-25T00:00:00.000Z',
          updatedAt: '2026-06-25T00:00:00.000Z'
        },
        {
          id: 'bvid:BV-running',
          url: 'https://www.bilibili.com/video/BV-running',
          title: 'Running video',
          bvid: 'BV-running',
          status: 'running',
          createdAt: '2026-06-25T00:01:00.000Z',
          updatedAt: '2026-06-25T00:01:00.000Z'
        }
      ]
    }
    renderQueuePanel(queue)

    const dialog = openQueueMenu()

    expect(dialog).not.toHaveAttribute('aria-modal')
    expect(within(dialog).getByRole('button', { name: '查看队列任务：Running video' })).toHaveFocus()
  })

  it('focuses the first queue item when no item is currently running', () => {
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      sessionCompletedCount: 0,
      items: [
        {
          id: 'bvid:BV-first',
          url: 'https://www.bilibili.com/video/BV-first',
          title: 'First pending video',
          bvid: 'BV-first',
          status: 'pending',
          createdAt: '2026-06-25T00:00:00.000Z',
          updatedAt: '2026-06-25T00:00:00.000Z'
        },
        {
          id: 'bvid:BV-second',
          url: 'https://www.bilibili.com/video/BV-second',
          title: 'Second pending video',
          bvid: 'BV-second',
          status: 'pending',
          createdAt: '2026-06-25T00:01:00.000Z',
          updatedAt: '2026-06-25T00:01:00.000Z'
        }
      ]
    }
    renderQueuePanel(queue)

    const dialog = openQueueMenu()

    expect(within(dialog).getByRole('button', { name: '查看队列任务：First pending video' })).toHaveFocus()
  })

  it('closes the queue dialog with Escape or an outside click and restores trigger focus', () => {
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      sessionCompletedCount: 0,
      items: [
        {
          id: 'bvid:BV-pending',
          url: 'https://www.bilibili.com/video/BV-pending',
          title: 'Pending video',
          bvid: 'BV-pending',
          status: 'pending',
          createdAt: '2026-06-25T00:00:00.000Z',
          updatedAt: '2026-06-25T00:00:00.000Z'
        }
      ]
    }
    renderQueuePanel(queue)
    const trigger = screen.getByRole('button', { name: '查看转写队列' })

    fireEvent.keyDown(openQueueMenu(), { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '转写队列' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    openQueueMenu()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog', { name: '转写队列' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('returns focus to the queue trigger after selecting an item', () => {
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      sessionCompletedCount: 0,
      items: [
        {
          id: 'bvid:BV-pending',
          url: 'https://www.bilibili.com/video/BV-pending',
          title: 'Pending video',
          bvid: 'BV-pending',
          status: 'pending',
          createdAt: '2026-06-25T00:00:00.000Z',
          updatedAt: '2026-06-25T00:00:00.000Z'
        }
      ]
    }
    renderQueuePanel(queue)
    const trigger = screen.getByRole('button', { name: '查看转写队列' })
    const itemButton = within(openQueueMenu()).getByRole('button', {
      name: '查看队列任务：Pending video'
    })

    fireEvent.click(itemButton)

    expect(screen.queryByRole('dialog', { name: '转写队列' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('shows DeepSeek summary progress as part of the overall queued task', () => {
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      sessionCompletedCount: 0,
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

  it('does not show a completed history item by default or replace the current note', () => {
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      sessionCompletedCount: 0,
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

    renderQueuePanelWithNote(queue)

    expect(screen.queryByRole('region', { name: '转写状态' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /无时间线文稿/ }))
    expect(screen.getByRole('tabpanel', { name: /无时间线文稿/ })).toHaveTextContent(
      'Transcript text.'
    )
  })

  it('shows saved transcript completion when the DeepSeek summary step fails', () => {
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      sessionCompletedCount: 0,
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

    const activeQueue: VideoAudioTranscriptionQueueSnapshot = {
      ...queue,
      activeItemId: 'bvid:BV-running',
      items: [
        {
          id: 'bvid:BV-running',
          url: 'https://www.bilibili.com/video/BV-running',
          title: 'Running video',
          bvid: 'BV-running',
          status: 'running',
          createdAt: '2026-06-25T00:00:00.000Z',
          updatedAt: '2026-06-25T00:00:00.000Z'
        },
        ...queue.items
      ]
    }
    renderQueuePanel(activeQueue)
    selectQueueItem('Summary failed video')

    expect(screen.getByRole('region', { name: '转写状态' })).toHaveTextContent(
      '排队已完成：Summary failed video'
    )
    expect(screen.getByRole('status')).toHaveTextContent('文稿已生成，总结未完成')
    expect(screen.queryByText(/转写失败/)).not.toBeInTheDocument()
  })

  it('keeps transcript tabs usable when the queue is idle after completion', () => {
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      sessionCompletedCount: 0,
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

    expect(screen.queryByRole('region', { name: '转写状态' })).not.toBeInTheDocument()
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
      sessionCompletedCount: 0,
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

    const activeQueue: VideoAudioTranscriptionQueueSnapshot = {
      ...queue,
      activeItemId: 'bvid:BV-running',
      items: [
        {
          id: 'bvid:BV-running',
          url: 'https://www.bilibili.com/video/BV-running',
          title: 'Running video',
          bvid: 'BV-running',
          status: 'running',
          createdAt: '2026-06-25T00:00:00.000Z',
          updatedAt: '2026-06-25T00:00:00.000Z'
        },
        ...queue.items
      ]
    }
    renderQueuePanel(activeQueue)
    selectQueueItem('Completed video')

    expect(screen.getByRole('region', { name: '转写状态' })).toHaveTextContent(
      '排队已完成：Completed video'
    )
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.queryByText('94%')).not.toBeInTheDocument()
  })

  it('switches queued videos from the queue selector and previews each draft transcript', () => {
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      sessionCompletedCount: 0,
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

    selectQueueItem('Completed video')
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
      sessionCompletedCount: 0,
      activeItemId: 'bvid:BV-running',
      items: [
        {
          id: 'bvid:BV-running',
          url: 'https://www.bilibili.com/video/BV-running',
          title: 'Running video',
          bvid: 'BV-running',
          status: 'running',
          createdAt: '2026-06-25T00:00:00.000Z',
          updatedAt: '2026-06-25T00:00:00.000Z'
        },
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

    selectQueueItem('Completed video')
    fireEvent.click(screen.getAllByRole('tab')[0])

    expect(screen.getByRole('tabpanel')).toHaveTextContent('Completed queued transcript.')
    expect(screen.getByRole('tabpanel')).not.toHaveTextContent('Other archived transcript.')
  })
})
