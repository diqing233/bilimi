import type { ComponentProps } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
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

  const renderPanel = (snapshot: VideoAudioTranscriptionQueueSnapshot) => (
    <VideoNotesPanel
      note={null}
      isLoading={false}
      onGenerate={vi.fn()}
      onSave={vi.fn()}
      onTranscribeAudio={vi.fn()}
      onEnqueueTranscription={onEnqueueTranscription}
      transcriptionQueue={snapshot}
      {...props}
    />
  )
  const rendered = render(renderPanel(queue))

  return {
    onEnqueueTranscription,
    rerenderQueue: (snapshot: VideoAudioTranscriptionQueueSnapshot) => rendered.rerender(renderPanel(snapshot))
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

function expandQueue(): void {
  fireEvent.click(screen.getByRole('button', { name: '展开转写队列' }))
}

describe('VideoNotesPanel transcription queue', () => {
  it('keeps queue statistics and the disclosure available when only work is waiting', () => {
    renderQueuePanel({
      sessionCompletedCount: 0,
      items: [{
        id: 'pending-only', url: 'https://www.bilibili.com/video/BV1pending', title: 'Pending only video', bvid: 'BV1pending',
        status: 'pending', createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:00:00.000Z'
      }]
    })

    const status = screen.getByRole('region', { name: '转写状态' })
    expect(status).toHaveTextContent('本次完成：0 个')
    expect(status).toHaveTextContent('排队中：1 个')
    expect(status.querySelector('.video-notes__queue-current-title')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '展开转写队列' }))
    expect(screen.getByRole('button', { name: '等待转写：Pending only video' })).toBeInTheDocument()
  })

  it('keeps active progress above the statistics and does not duplicate the running item after expansion', () => {
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      activeItemId: 'running', sessionCompletedCount: 1,
      items: [
        {
          id: 'running', url: 'https://www.bilibili.com/video/BV1running', title: 'Running video', bvid: 'BV1running',
          status: 'running', createdAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-07-27T00:00:00.000Z',
          progress: { step: 'downloading-audio', message: 'Downloading audio.' }
        },
        { id: 'pending', url: 'https://www.bilibili.com/video/BV1pending', title: 'Pending video', bvid: 'BV1pending', status: 'pending', createdAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-07-27T00:00:00.000Z' }
      ]
    }
    renderQueuePanel(queue)

    const status = screen.getByRole('region', { name: '转写状态' })
    expect(status).toHaveTextContent('正在转写：Running video')
    expect(status).toHaveTextContent('正在下载音频')
    expect(status).toHaveTextContent('本次完成：1 个')
    expect(status).toHaveTextContent('排队中：1 个')
    const currentTitle = status.querySelector('.video-notes__queue-current-title')!
    const currentContent = currentTitle.parentElement!
    expect(currentContent).toHaveClass('video-notes__queue-current-content')
    expect(currentTitle.compareDocumentPosition(
      currentContent.querySelector('.video-notes__queue-progress')!
    )).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(status.querySelector('.video-notes__queue-current-title')?.compareDocumentPosition(
      status.querySelector('.video-notes__queue-header')!
    )).toBe(Node.DOCUMENT_POSITION_FOLLOWING)

    expandQueue()
    expect(screen.getByRole('button', { name: '正在转写：Running video' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '等待转写：Pending video' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /带时间线文稿/ })).toBeInTheDocument()
  })

  it('lets the active running title switch the visible video details and transcript preview', () => {
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      activeItemId: 'running', sessionCompletedCount: 0,
      items: [{
        id: 'running', url: 'https://www.bilibili.com/video/BV1running', title: 'Running video', bvid: 'BV1running',
        status: 'running', createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:00:00.000Z'
      }]
    }
    renderQueuePanelWithNote(queue)

    fireEvent.click(screen.getByRole('button', { name: '正在转写：Running video' }))

    expect(screen.getByRole('region', { name: '当前视频详情' })).toHaveTextContent('Running video')
    expect(screen.getByRole('tab', { name: /无时间线文稿/ })).toHaveAttribute('aria-selected', 'false')
  })

  it('marks the current queue row for list-style selection instead of outlining its title', () => {
    renderQueuePanel({
      activeItemId: 'pending',
      sessionCompletedCount: 0,
      items: [{
        id: 'pending', url: 'https://www.bilibili.com/video/BV1pending', title: 'Selected queue video', bvid: 'BV1pending',
        status: 'pending', createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:00:00.000Z'
      }]
    })

    expandQueue()

    const title = screen.getByRole('button', { name: '等待转写：Selected queue video' })
    expect(title.closest('.video-notes__queue-record')).toHaveAttribute('data-selected', 'true')
    expect(title).not.toHaveClass('video-notes__queue-record-title--outlined')
  })

  it('selects a queued video when its status area is clicked', () => {
    renderQueuePanel({
      sessionCompletedCount: 2,
      items: [
        { id: 'older', url: 'https://www.bilibili.com/video/BV1older', title: 'Older video', bvid: 'BV1older', status: 'completed', createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:01:00.000Z' },
        { id: 'newer', url: 'https://www.bilibili.com/video/BV1newer', title: 'Newer video', bvid: 'BV1newer', status: 'completed', createdAt: '2026-07-28T00:02:00.000Z', updatedAt: '2026-07-28T00:03:00.000Z' }
      ]
    })

    expandQueue()

    const record = screen.getByRole('button', { name: '排队已完成：Older video' }).closest('.video-notes__queue-record')!
    fireEvent.click(within(record).getByRole('status'))

    expect(record).toHaveAttribute('data-selected', 'true')
  })

  it('puts the most recently updated video group at the top of the queue', () => {
    renderQueuePanel({
      sessionCompletedCount: 0,
      items: [
        { id: 'older', url: 'https://www.bilibili.com/video/BV1older', title: 'Older video', bvid: 'BV1older', status: 'completed', createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:01:00.000Z' },
        { id: 'newer', url: 'https://www.bilibili.com/video/BV1newer', title: 'Newer video', bvid: 'BV1newer', status: 'completed', createdAt: '2026-07-28T00:02:00.000Z', updatedAt: '2026-07-28T00:03:00.000Z' }
      ]
    })

    expandQueue()

    const records = [...screen.getAllByRole('button')]
      .filter((button) => button.matches('.video-notes__queue-record-select'))
    expect(records.map((record) => record.getAttribute('aria-label'))).toEqual([
      '排队已完成：Newer video',
      '排队已完成：Older video'
    ])
  })

  it('bulk-selects only visible historical records and leaves the active task to its top action', () => {
    renderQueuePanel({
      activeItemId: 'running',
      sessionCompletedCount: 0,
      items: [
        { id: 'running', url: 'https://www.bilibili.com/video/BV1running', title: 'Running video', bvid: 'BV1running', status: 'running', createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:00:00.000Z' },
        { id: 'pending', url: 'https://www.bilibili.com/video/BV1pending', title: 'Pending video', bvid: 'BV1pending', status: 'pending', createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:00:00.000Z' }
      ]
    })

    expandQueue()
    fireEvent.click(screen.getByRole('checkbox', { name: '全选队列记录' }))

    expect(screen.getByLabelText('全选队列记录')).toBeChecked()
    expect(screen.getByLabelText('全选队列记录').closest('div')).toHaveTextContent('已选 1 项')
    expect(screen.queryByRole('checkbox', { name: '选择 Running video' })).not.toBeInTheDocument()
  })

  it('shows every task for the same video newest first without history folding', () => {
    renderQueuePanel({
      sessionCompletedCount: 0,
      items: [
        { id: 'old-completed', url: 'https://www.bilibili.com/video/BV1same', title: 'Same video', bvid: 'BV1same', status: 'completed', createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:01:00.000Z' },
        { id: 'old-canceled', url: 'https://www.bilibili.com/video/BV1same', title: 'Same video', bvid: 'BV1same', status: 'canceled', createdAt: '2026-07-28T00:02:00.000Z', updatedAt: '2026-07-28T00:03:00.000Z' },
        { id: 'new-pending', url: 'https://www.bilibili.com/video/BV1same', title: 'Same video', bvid: 'BV1same', status: 'pending', createdAt: '2026-07-28T00:04:00.000Z', updatedAt: '2026-07-28T00:05:00.000Z' }
      ]
    })

    expandQueue()
    const records = screen.getAllByRole('button').filter((button) => button.matches('.video-notes__queue-record-select'))
    expect(records.map((record) => record.getAttribute('aria-label'))).toEqual([
      '等待转写：Same video',
      '已取消：Same video',
      '排队已完成：Same video'
    ])
    expect(screen.queryByRole('button', { name: /历史记录/ })).not.toBeInTheDocument()
  })

  it('keeps different accounts’ matching BV records as separate historical rows', () => {
    renderQueuePanel({
      sessionCompletedCount: 0,
      items: [
        { id: 'account-one', accountMid: '1', url: 'https://www.bilibili.com/video/BV1same', title: 'Same video', bvid: 'BV1same', status: 'pending', createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:01:00.000Z' },
        { id: 'account-two', accountMid: '2', url: 'https://www.bilibili.com/video/BV1same', title: 'Same video', bvid: 'BV1same', status: 'completed', createdAt: '2026-07-28T00:02:00.000Z', updatedAt: '2026-07-28T00:03:00.000Z' }
      ]
    })

    expandQueue()

    expect(screen.getByRole('button', { name: '等待转写：Same video' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '排队已完成：Same video' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /查看历史记录/ })).not.toBeInTheDocument()
  })

  it('keeps a selected record visible when another record for the same video becomes newer', () => {
    const { rerenderQueue } = renderQueuePanel({
      sessionCompletedCount: 0,
      items: [
        { id: 'older', url: 'https://www.bilibili.com/video/BV1same', title: 'Same video', bvid: 'BV1same', status: 'completed', createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:01:00.000Z' },
        { id: 'selected-latest', url: 'https://www.bilibili.com/video/BV1same', title: 'Same video', bvid: 'BV1same', status: 'pending', createdAt: '2026-07-28T00:02:00.000Z', updatedAt: '2026-07-28T00:03:00.000Z' }
      ]
    })

    expandQueue()
    fireEvent.click(screen.getAllByRole('checkbox', { name: '选择 Same video' })[0]!)
    expect(screen.getByText('已选 1 项')).toBeInTheDocument()

    rerenderQueue({
      sessionCompletedCount: 0,
      items: [
        { id: 'older', url: 'https://www.bilibili.com/video/BV1same', title: 'Same video', bvid: 'BV1same', status: 'completed', createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:05:00.000Z' },
        { id: 'selected-latest', url: 'https://www.bilibili.com/video/BV1same', title: 'Same video', bvid: 'BV1same', status: 'pending', createdAt: '2026-07-28T00:02:00.000Z', updatedAt: '2026-07-28T00:03:00.000Z' }
      ]
    })

    expect(screen.getByText('已选 1 项')).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox', { name: '选择 Same video' }).filter((checkbox) => (checkbox as HTMLInputElement).checked)).toHaveLength(1)
  })

  it('uses one expandable queue disclosure instead of a second queue dropdown', () => {
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      activeItemId: 'running',
      sessionCompletedCount: 0,
      items: [
        { id: 'running', url: 'https://www.bilibili.com/video/BV1running', title: 'Running video', bvid: 'BV1running', status: 'running', createdAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-07-27T00:00:00.000Z' },
        { id: 'pending', url: 'https://www.bilibili.com/video/BV1pending', title: 'Pending video', bvid: 'BV1pending', status: 'pending', createdAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-07-27T00:00:00.000Z' }
      ]
    }
    renderQueuePanel(queue)

    const disclosure = screen.getByRole('button', { name: '展开转写队列' })
    expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: '选择 Pending video' })).not.toBeInTheDocument()

    fireEvent.click(disclosure)

    expect(screen.getByRole('button', { name: '收起转写队列' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('checkbox', { name: '选择 Pending video' })).toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('selects queue records and exposes a sticky bulk toolbar with eligibility-aware actions', () => {
    const onBulkQueueAction = vi.fn()
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      activeItemId: 'running', sessionCompletedCount: 0,
      items: [
        { id: 'pending', url: 'https://www.bilibili.com/video/BV1pending', title: '等待视频', bvid: 'BV1pending', status: 'pending', createdAt: '2026-07-26T00:00:00.000Z', updatedAt: '2026-07-26T00:00:00.000Z' },
        { id: 'running', url: 'https://www.bilibili.com/video/BV1running', title: '运行视频', bvid: 'BV1running', status: 'running', createdAt: '2026-07-26T00:00:00.000Z', updatedAt: '2026-07-26T00:00:00.000Z' },
        { id: 'completed', url: 'https://www.bilibili.com/video/BV1completed', title: '完成视频', bvid: 'BV1completed', status: 'completed', createdAt: '2026-07-26T00:00:00.000Z', updatedAt: '2026-07-26T00:00:00.000Z' }
      ]
    }
    renderQueuePanel(queue, { onBulkQueueAction })

    expandQueue()
    expect(screen.getByRole('button', { name: '删除记录' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 等待视频' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 完成视频' }))
    fireEvent.click(screen.getByRole('button', { name: '删除记录' }))
    expect(onBulkQueueAction).toHaveBeenCalledWith('remove', ['pending', 'completed'])
  })

  it('uses the shared video summary menu for queue batch actions and opens the export dialog directly', async () => {
    const archived = createArchive({ ...queuedCompletedNote, source: { ...queuedCompletedNote.source, accountMid: '100' } })
    const completedVersion = archived.versions[0]!
    archived.versions.push({ ...completedVersion, id: 'newer-version', createdAt: '2026-07-27T00:00:00.000Z' })
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      activeItemId: 'completed',
      sessionCompletedCount: 0,
      items: [
        { id: 'pending', accountMid: '100', url: 'https://www.bilibili.com/video/BV1pending', title: '等待视频', status: 'pending', createdAt: '2026-07-26T00:00:00.000Z', updatedAt: '2026-07-26T00:00:00.000Z' },
        { id: 'completed', accountMid: '100', archiveNoteId: archived.id, archiveVersionId: completedVersion.id, url: 'https://www.bilibili.com/video/BV1completed', title: '完成视频', status: 'completed', createdAt: '2026-07-26T00:00:00.000Z', updatedAt: '2026-07-26T00:01:00.000Z' }
      ]
    }
    window.bilimiDesktop = {
      previewVideoNoteArchiveBatch: vi.fn().mockResolvedValue({ selectedCount: 1, exportableCount: 1, skippedCount: 0 }),
      startVideoNoteArchiveBatch: vi.fn(), cancelVideoNoteArchiveBatch: vi.fn(), openVideoNoteArchiveBatchFolder: vi.fn(),
      onVideoNoteArchiveBatchProgress: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop
    renderQueuePanel(queue, { archivedNotes: [archived] })

    expandQueue()
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 等待视频' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 完成视频' }))
    const toolbar = screen.getByLabelText('队列批量操作')

    expect(within(toolbar).queryByRole('button', { name: '开始转写' })).not.toBeInTheDocument()
    expect(within(toolbar).queryByRole('button', { name: '批量取消转写' })).not.toBeInTheDocument()
    expect(within(toolbar).queryByRole('button', { name: '导出文稿' })).not.toBeInTheDocument()

    fireEvent.click(within(toolbar).getByRole('button', { name: '视频总结' }))
    expect(within(toolbar).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['转写音频', '取消转写', '导出文稿'])
    expect(within(toolbar).getByRole('menuitem', { name: '取消转写' })).toBeEnabled()
    fireEvent.click(within(toolbar).getByRole('menuitem', { name: '导出文稿' }))

    expect(await screen.findByRole('dialog', { name: '导出文稿' })).toHaveTextContent('已选 2 项，可导出 1 项，跳过 1 项')
    expect(window.bilimiDesktop.previewVideoNoteArchiveBatch).toHaveBeenCalledWith(expect.objectContaining({
      accountMid: '100', selections: [{ archiveId: archived.id, versionId: completedVersion.id }]
    }))
  })

  it('opens the export preview for one-account unresolved selections so their skipped count is visible', async () => {
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      activeItemId: 'pending',
      sessionCompletedCount: 0,
      items: [{
        id: 'pending', accountMid: '100', url: 'https://www.bilibili.com/video/BV1pending', title: 'Pending export',
        status: 'pending', createdAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-07-27T00:00:00.000Z'
      }]
    }
    const preview = vi.fn()
    window.bilimiDesktop = {
      previewVideoNoteArchiveBatch: preview,
      startVideoNoteArchiveBatch: vi.fn(), cancelVideoNoteArchiveBatch: vi.fn(), openVideoNoteArchiveBatchFolder: vi.fn(),
      onVideoNoteArchiveBatchProgress: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop
    renderQueuePanel(queue)

    expandQueue()
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 Pending export' }))
    const toolbar = screen.getByLabelText('队列批量操作')
    fireEvent.click(within(toolbar).getByRole('button', { name: '视频总结' }))
    const exportItem = within(toolbar).getByRole('menuitem', { name: '导出文稿' })
    expect(exportItem).toBeEnabled()
    fireEvent.click(exportItem)

    expect(await screen.findByRole('dialog', { name: '导出文稿' })).toHaveTextContent('已选 1 项，可导出 0 项，跳过 1 项')
    expect(screen.getByRole('button', { name: '开始导出' })).toBeDisabled()
    expect(preview).not.toHaveBeenCalled()
  })

  it('keeps queue document export disabled when selected work spans accounts', () => {
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      activeItemId: 'first',
      sessionCompletedCount: 0,
      items: [
        { id: 'first', accountMid: '100', url: 'https://www.bilibili.com/video/BV1first', title: 'First account', status: 'pending', createdAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-07-27T00:00:00.000Z' },
        { id: 'second', accountMid: '200', url: 'https://www.bilibili.com/video/BV1second', title: 'Second account', status: 'pending', createdAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-07-27T00:00:00.000Z' }
      ]
    }
    renderQueuePanel(queue)

    expandQueue()
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 First account' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 Second account' }))

    const toolbar = screen.getByLabelText('队列批量操作')
    fireEvent.click(within(toolbar).getByRole('button', { name: '视频总结' }))
    expect(within(toolbar).getByRole('menuitem', { name: '导出文稿' })).toBeDisabled()
  })

  it('keeps queue document export disabled when any selected record lacks an account identity', () => {
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      activeItemId: 'unowned',
      sessionCompletedCount: 0,
      items: [{
        id: 'unowned', url: 'https://www.bilibili.com/video/BV1unowned', title: 'Unowned pending', status: 'pending',
        createdAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-07-27T00:00:00.000Z'
      }]
    }
    renderQueuePanel(queue)

    expandQueue()
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 Unowned pending' }))

    const toolbar = screen.getByLabelText('队列批量操作')
    fireEvent.click(within(toolbar).getByRole('button', { name: '视频总结' }))
    expect(within(toolbar).getByRole('menuitem', { name: '导出文稿' })).toBeDisabled()
  })

  it('counts a repeated saved archive identity as skipped instead of writing duplicate documents', async () => {
    const archived = createArchive({ ...queuedCompletedNote, source: { ...queuedCompletedNote.source, accountMid: '100' } })
    const version = archived.versions[0]!
    const preview = vi.fn().mockResolvedValue({ selectedCount: 1, exportableCount: 1, skippedCount: 0 })
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      activeItemId: 'first',
      sessionCompletedCount: 0,
      items: [
        { id: 'first', accountMid: '100', archiveNoteId: archived.id, archiveVersionId: version.id, url: 'https://www.bilibili.com/video/BV1first', title: 'First queue record', status: 'completed', createdAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-07-27T00:00:00.000Z' },
        { id: 'second', accountMid: '100', archiveNoteId: archived.id, archiveVersionId: version.id, url: 'https://www.bilibili.com/video/BV1second', title: 'Second queue record', status: 'completed', createdAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-07-27T00:00:00.000Z' }
      ]
    }
    window.bilimiDesktop = {
      previewVideoNoteArchiveBatch: preview,
      startVideoNoteArchiveBatch: vi.fn(), cancelVideoNoteArchiveBatch: vi.fn(), openVideoNoteArchiveBatchFolder: vi.fn(),
      onVideoNoteArchiveBatchProgress: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop
    renderQueuePanel(queue)

    expandQueue()
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 First queue record' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 Second queue record' }))
    const toolbar = screen.getByLabelText('队列批量操作')
    fireEvent.click(within(toolbar).getByRole('button', { name: '视频总结' }))
    fireEvent.click(within(toolbar).getByRole('menuitem', { name: '导出文稿' }))

    expect(await screen.findByRole('dialog', { name: '导出文稿' })).toHaveTextContent('已选 2 项，可导出 1 项，跳过 1 项')
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({
      selections: [{ archiveId: archived.id, versionId: version.id }]
    }))
  })

  it('cancels selected running work directly without a confirmation dialog', async () => {
    const onCancelQueuedVideoAudioTranscription = vi.fn()
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      activeItemId: 'running',
      sessionCompletedCount: 0,
      items: [{
        id: 'running', url: 'https://www.bilibili.com/video/BV1running', title: '运行视频', bvid: 'BV1running',
        status: 'running', createdAt: '2026-07-26T00:00:00.000Z', updatedAt: '2026-07-26T00:00:00.000Z'
      }]
    }
    renderQueuePanel(queue, { onCancelQueuedVideoAudioTranscription })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '取消转写' }))
    })

    expect(onCancelQueuedVideoAudioTranscription).toHaveBeenCalledWith('running')
    expect(screen.queryByRole('alertdialog', { name: '确认停止正在转写' })).not.toBeInTheDocument()
  })

  it('keeps a running item cancellation as the only direct action', () => {
    const onCancelQueuedVideoAudioTranscription = vi.fn()
    renderQueuePanel({
      activeItemId: 'running',
      sessionCompletedCount: 0,
      items: [{
        id: 'running', url: 'https://www.bilibili.com/video/BV1running', title: 'Running video', bvid: 'BV1running',
        status: 'running', createdAt: '2026-07-26T00:00:00.000Z', updatedAt: '2026-07-26T00:00:00.000Z'
      }]
    }, { onCancelQueuedVideoAudioTranscription })

    fireEvent.click(screen.getByRole('button', { name: '取消转写' }))

    expect(onCancelQueuedVideoAudioTranscription).toHaveBeenCalledWith('running')
    expect(screen.queryByRole('button', { name: '视频总结' })).not.toBeInTheDocument()
  })

  it('cancels a selected item that starts running while waiting cancellation is in flight', async () => {
    const onCancelQueuedVideoAudioTranscription = vi.fn()
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      activeItemId: 'pending',
      sessionCompletedCount: 0,
      items: [{
        id: 'pending', url: 'https://www.bilibili.com/video/BV1pending', title: '等待视频', bvid: 'BV1pending',
        status: 'pending', createdAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-07-27T00:00:00.000Z'
      }]
    }
    const onBulkQueueAction = vi.fn().mockResolvedValue({
      snapshot: {
        activeItemId: 'pending',
        sessionCompletedCount: 0,
        items: [{ ...queue.items[0], status: 'running', updatedAt: '2026-07-27T00:01:00.000Z' }]
      },
      affected: 1,
      canceled: 1,
      stopped: 0,
      retried: 0,
      started: 0,
      removed: 0,
      skipped: 0
    })
    renderQueuePanel(queue, { onBulkQueueAction, onCancelQueuedVideoAudioTranscription })

    expandQueue()
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 等待视频' }))
    await act(async () => {
      const toolbar = screen.getByLabelText('队列批量操作')
      fireEvent.click(within(toolbar).getByRole('button', { name: '视频总结' }))
    })
    await act(async () => {
      fireEvent.click(within(screen.getByLabelText('队列批量操作')).getByRole('menuitem', { name: '取消转写' }))
    })

    expect(onBulkQueueAction).toHaveBeenCalledWith('cancel-waiting', ['pending'])
    expect(onCancelQueuedVideoAudioTranscription).toHaveBeenCalledWith('pending')
  })

  it('shows an in-progress cancellation without offering a second cancel action', () => {
    renderQueuePanel({
      activeItemId: 'canceling',
      sessionCompletedCount: 0,
      items: [{
        id: 'canceling', url: 'https://www.bilibili.com/video/BV1canceling', title: '取消中的视频', bvid: 'BV1canceling',
        status: 'running', cancelRequested: true, createdAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-07-27T00:01:00.000Z',
        progress: { step: 'canceling', message: 'Canceling transcription.' }
      }]
    })

    expect(screen.getByText('正在取消…：取消中的视频')).toBeInTheDocument()
    expect(screen.getByText('正在取消转写')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取消 取消中的视频' })).not.toBeInTheDocument()
  })

  it('does not issue a second bulk cancellation for an already-canceling item', async () => {
    const onCancelQueuedVideoAudioTranscription = vi.fn()
    renderQueuePanel({
      activeItemId: 'canceling',
      sessionCompletedCount: 0,
      items: [{
        id: 'canceling', url: 'https://www.bilibili.com/video/BV1canceling', title: '取消中的视频', bvid: 'BV1canceling',
        status: 'running', cancelRequested: true, createdAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-07-27T00:01:00.000Z',
        progress: { step: 'canceling', message: 'Canceling transcription.' }
      }]
    }, { onCancelQueuedVideoAudioTranscription })

    expandQueue()
    expect(screen.queryByRole('checkbox', { name: '选择 取消中的视频' })).not.toBeInTheDocument()
    expect(within(screen.getByLabelText('队列批量操作')).getByRole('button', { name: '视频总结' })).toBeDisabled()
    expect(onCancelQueuedVideoAudioTranscription).not.toHaveBeenCalled()
  })

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
    expect(queueCount).not.toHaveAttribute('title')
    expect(screen.getByRole('button', { name: '展开转写队列' })).toHaveAttribute(
      'title',
      queueDetails
    )
    expandQueue()
    expect(screen.getByRole('button', { name: '等待转写：Pending video' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '正在转写：Running video' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '转写失败：Failed video' })).toBeInTheDocument()
    expect(screen.getByText('正在转写第 2 / 4 段')).toBeInTheDocument()
    expect(screen.getByText('49%')).toBeInTheDocument()
    expect(screen.getByLabelText('转写音频到文稿生成整体进度')).toHaveAttribute('value', '49')
    expect(screen.queryByRole('button', { name: '加入队列' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '视频总结' })).toHaveLength(1)
    expect(screen.getByText('音频下载失败，请检查网络后重试。')).toBeInTheDocument()
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
        },
        {
          id: 'bvid:BV5note',
          url: 'https://www.bilibili.com/video/BV5note',
          title: 'Imported video',
          bvid: 'BV5note',
          status: 'waiting-restart',
          createdAt: '2026-07-24T00:00:00.000Z',
          updatedAt: '2026-07-24T00:01:00.000Z'
        }
      ]
    }

    renderQueuePanel(queue, {
      onCancelQueuedVideoAudioTranscription,
      onRetryQueuedVideoAudioTranscription
    })

    expandQueue()
    const runningHeading = screen.getByRole('button', { name: '正在转写：Running video' }).closest('.video-notes__queue-current-heading')!
    fireEvent.click(within(runningHeading).getByRole('button', { name: '取消转写' }))

    expect(onCancelQueuedVideoAudioTranscription).toHaveBeenCalledWith('bvid:BV2note')
    expect(screen.getByRole('region', { name: '转写状态' })).toHaveTextContent('正在转写：Running video')

    const failedRecord = screen.getByRole('button', { name: '转写失败：Failed video' }).closest('.video-notes__queue-record')!
    fireEvent.click(within(failedRecord).getByRole('button', { name: '重试 Failed video' }))

    expect(onRetryQueuedVideoAudioTranscription).toHaveBeenCalledWith('bvid:BV4note')
    expect(screen.getByRole('region', { name: '转写状态' })).toHaveTextContent('正在转写：Running video')

    const importedRecord = screen.getByRole('button', { name: '等待重新开始：Imported video' }).closest('.video-notes__queue-record')!
    fireEvent.click(within(importedRecord).getByRole('button', { name: '重试 Imported video' }))
    expect(onRetryQueuedVideoAudioTranscription).toHaveBeenCalledWith('bvid:BV5note')

    fireEvent.click(screen.getByRole('button', { name: '排队已完成：Completed video' }))
    expect(screen.getByRole('region', { name: '转写状态' })).toHaveTextContent(
      '正在转写：Running video'
    )
  })

  it('shows DeepSeek summary progress as part of the overall queued task', () => {
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      activeItemId: 'bvid:BV2note',
      sessionCompletedCount: 0,
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

  it('keeps only transcription cancellation while a queued item is in the DeepSeek stage', () => {
    const onCancelQueuedVideoAudioTranscription = vi.fn()
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      activeItemId: 'bvid:BV2note',
      sessionCompletedCount: 0,
      items: [{
        id: 'bvid:BV2note', url: 'https://www.bilibili.com/video/BV2note', title: 'Running video', bvid: 'BV2note',
        status: 'running', summarizeWithDeepSeek: true, createdAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-07-27T00:00:00.000Z',
        progress: { step: 'summarizing-deepseek', message: 'Generating DeepSeek summary.' }
      }]
    }

    renderQueuePanel(queue, { onCancelQueuedVideoAudioTranscription })
    fireEvent.click(screen.getByRole('button', { name: '取消转写' }))

    expect(onCancelQueuedVideoAudioTranscription).toHaveBeenCalledWith('bvid:BV2note')
    expect(screen.queryByRole('button', { name: '取消总结' })).not.toBeInTheDocument()
  })

  it('shows a summary cancellation in progress without offering a second action', () => {
    renderQueuePanel({
      activeItemId: 'bvid:BV2note',
      sessionCompletedCount: 0,
      items: [{
        id: 'bvid:BV2note', url: 'https://www.bilibili.com/video/BV2note', title: 'Running video', bvid: 'BV2note',
        status: 'running', summarizeWithDeepSeek: true, createdAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-07-27T00:00:00.000Z',
        progress: { step: 'canceling-summary', message: 'Canceling DeepSeek summary.' }
      }]
    })

    expect(screen.getByText('正在取消总结')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取消总结' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取消转写' })).not.toBeInTheDocument()
  })

  it('does not put an action menu on completed queue records', () => {
    const onRetryQueuedArchiveRegistration = vi.fn()
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      activeItemId: undefined,
      sessionCompletedCount: 0,
      items: [{
        id: 'completed-archive-failed',
        url: 'https://www.bilibili.com/video/BV1archive',
        title: 'Archive failed video',
        bvid: 'BV1archive',
        status: 'completed',
        archiveRegistrationStatus: 'failed',
        createdAt: '2026-07-26T00:00:00.000Z',
        updatedAt: '2026-07-26T00:00:00.000Z'
      }]
    }
    renderQueuePanel(queue, { onRetryQueuedArchiveRegistration })

    expandQueue()
    const record = screen.getByRole('button', { name: '排队已完成：Archive failed video' }).closest('.video-notes__queue-record')!
    expect(within(record).queryByRole('button', { name: '视频总结' })).not.toBeInTheDocument()
    expect(onRetryQueuedArchiveRegistration).not.toHaveBeenCalled()
  })

  it('keeps the queue panel visible when the latest queued item completes', () => {
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
          summaryStatus: 'saved',
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
    expect(status).toHaveTextContent('本次完成：0 个')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expandQueue()
    expect(screen.getByRole('button', { name: '排队已完成：Completed video' })).toBeInTheDocument()
    expect(screen.getByText('DeepSeek 总结已完成')).toBeInTheDocument()
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

    renderQueuePanel(queue)

    expect(screen.getByRole('region', { name: '转写状态' })).toHaveTextContent('本次完成：0 个')
    expandQueue()
    expect(screen.getByRole('button', { name: '排队已完成：Summary failed video' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('文稿已生成，总结未完成')
    expect(screen.queryByText(/转写失败/)).not.toBeInTheDocument()
  })

  it('treats an empty transcript as a normal no-speech completion', () => {
    renderQueuePanel({
      sessionCompletedCount: 1,
      items: [{
        id: 'bvid:BVnoSpeech',
        url: 'https://www.bilibili.com/video/BVnoSpeech',
        title: 'No speech video',
        bvid: 'BVnoSpeech',
        status: 'completed',
        summarizeWithDeepSeek: true,
        transcriptOutcome: 'no-speech',
        summaryStatus: 'not-requested',
        archiveRegistrationStatus: 'registered',
        createdAt: '2026-07-29T00:00:00.000Z',
        updatedAt: '2026-07-29T00:01:00.000Z',
        completedAt: '2026-07-29T00:01:00.000Z'
      }]
    })

    expandQueue()

    expect(screen.getByRole('status')).toHaveTextContent('未检测到可转写语音')
    expect(screen.queryByText('总结生成失败')).not.toBeInTheDocument()
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

    expect(screen.getByRole('region', { name: '转写状态' })).toHaveTextContent('本次完成：0 个')
    expandQueue()
    expect(screen.getByRole('button', { name: '排队已完成：Completed video' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /无时间线文稿/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /带时间线文稿/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /DeepSeek 总结/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /无时间线文稿/ }))

    expect(screen.getByRole('tabpanel', { name: /无时间线文稿/ })).toHaveTextContent(
      '该队列项暂无可预览文稿，可到档案库查看。'
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

    renderQueuePanel(queue)

    expect(screen.getByRole('region', { name: '转写状态' })).toHaveTextContent('本次完成：0 个')
    expandQueue()
    expect(screen.getByRole('button', { name: '排队已完成：Completed video' })).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByText('94%')).not.toBeInTheDocument()
  })

  it('switches queued videos from the queue selector and previews each draft transcript', () => {
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      activeItemId: 'bvid:BV2note',
      sessionCompletedCount: 0,
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

    expandQueue()
    fireEvent.click(screen.getByRole('button', { name: '排队已完成：Completed video' }))

    expect(screen.getByRole('region', { name: '转写状态' })).toHaveTextContent(
      '正在转写：Running video'
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
    const queuedCompletedArchive = createArchive(queuedCompletedNote)
    const otherCompletedArchive = createArchive(otherCompletedNote)
    const queue: VideoAudioTranscriptionQueueSnapshot = {
      sessionCompletedCount: 0,
      items: [
        {
          id: 'bvid:BV3note',
          url: 'https://www.bilibili.com/video/BV3note',
          title: 'Completed video',
          bvid: 'BV3note',
          status: 'completed',
          archiveNoteId: queuedCompletedNote.id,
          archiveVersionId: queuedCompletedArchive.versions[0].id,
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
          archiveVersionId: otherCompletedArchive.versions[0].id,
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
        archivedNotes={[queuedCompletedArchive, otherCompletedArchive]}
      />
    )

    expandQueue()
    fireEvent.click(screen.getByRole('button', { name: '排队已完成：Completed video' }))

    expect(screen.getByRole('tabpanel')).toHaveTextContent('Completed queued transcript.')
    expect(screen.getByRole('tabpanel')).not.toHaveTextContent('Other archived transcript.')
  })
})
