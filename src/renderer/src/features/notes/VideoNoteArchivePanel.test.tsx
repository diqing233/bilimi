import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { VideoNote, VideoNoteArchiveEntry } from '@shared/types'
import { appendVideoNoteArchiveVersion } from '@shared/videoNoteArchive'
import { VideoNoteArchivePanel } from './VideoNoteArchivePanel'

function createNote(overrides: Partial<VideoNote> = {}): VideoNote {
  return {
    id: 'bvid:BV1note',
    source: {
      title: '机器学习入门',
      author: '李老师',
      bvid: 'BV1note',
      url: 'https://www.bilibili.com/video/BV1note',
      tags: []
    },
    transcriptSource: 'audio',
    transcript: [
      { start: 0, end: 12, text: '先介绍机器学习的基本概念。' },
      { start: 75, end: 120, text: '训练数据决定模型上限。' }
    ],
    chapters: [],
    overview: {
      shortSummary: ['一句话：三分钟讲清机器学习的基本思路。'],
      keywords: ['机器学习'],
      timeline: [{ start: 75, title: '数据', detail: '说明数据质量的重要性。' }],
      highlights: []
    },
    annotations: [],
    userMemo: '',
    createdAt: '2026-06-17T00:00:00.000Z',
    updatedAt: '2026-06-17T00:00:00.000Z',
    ...overrides
  }
}

function createArchives(): VideoNoteArchiveEntry[] {
  const firstNote = createNote()
  const secondNote = createNote({
    transcript: [{ start: 3, end: 8, text: '第二版纯文稿。' }],
    updatedAt: '2026-06-17T01:00:00.000Z',
    annotations: [
      {
        id: 'annotation-1',
        start: 3,
        title: '复看',
        body: '这一版更清楚。',
        createdAt: '2026-06-17T01:00:00.000Z',
        updatedAt: '2026-06-17T01:00:00.000Z'
      }
    ],
    userMemo: '期末复习'
  })
  const otherNote = createNote({
    id: 'bvid:BV1react',
    source: {
      title: 'React 状态管理',
      author: '王老师',
      bvid: 'BV1react',
      url: 'https://www.bilibili.com/video/BV1react',
      tags: []
    },
    transcript: [{ start: null, end: null, text: 'useState 和 reducer。' }]
  })

  return appendVideoNoteArchiveVersion(
    appendVideoNoteArchiveVersion(
      appendVideoNoteArchiveVersion([], firstNote, '2026-06-17T00:00:00.000Z'),
      secondNote,
      '2026-06-17T01:00:00.000Z'
    ),
    otherNote,
    '2026-06-16T00:00:00.000Z'
  )
}

describe('VideoNoteArchivePanel', () => {
  it('renders searchable archive list and selected video detail', () => {
    render(
      <VideoNoteArchivePanel
        archives={createArchives()}
        onClose={vi.fn()}
        onOpenSource={vi.fn()}
        onDeleteEntry={vi.fn()}
        onDeleteVersion={vi.fn()}
      />
    )

    expect(screen.getByRole('searchbox', { name: '搜索档案' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /机器学习入门/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /React 状态管理/ })).toBeInTheDocument()
    expect(screen.getByText('第二版纯文稿。')).toBeInTheDocument()
    expect(screen.getByText('期末复习')).toBeInTheDocument()
  })

  it('searches title, author, bvid, transcript and summary text', () => {
    render(
      <VideoNoteArchivePanel
        archives={createArchives()}
        onClose={vi.fn()}
        onOpenSource={vi.fn()}
        onDeleteEntry={vi.fn()}
        onDeleteVersion={vi.fn()}
      />
    )

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索档案' }), {
      target: { value: 'reducer' }
    })

    expect(screen.queryByRole('button', { name: /机器学习入门/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /React 状态管理/ })).toBeInTheDocument()
  })

  it('filters archives with annotations and memo', () => {
    render(
      <VideoNoteArchivePanel
        archives={createArchives()}
        onClose={vi.fn()}
        onOpenSource={vi.fn()}
        onDeleteEntry={vi.fn()}
        onDeleteVersion={vi.fn()}
      />
    )

    fireEvent.click(screen.getByLabelText('有批注'))

    expect(screen.getByRole('button', { name: /机器学习入门/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /React 状态管理/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('有备注'))
    expect(screen.getByRole('button', { name: /机器学习入门/ })).toBeInTheDocument()
  })

  it('switches selected video and version', () => {
    render(
      <VideoNoteArchivePanel
        archives={createArchives()}
        onClose={vi.fn()}
        onOpenSource={vi.fn()}
        onDeleteEntry={vi.fn()}
        onDeleteVersion={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /机器学习入门/ }))
    fireEvent.change(screen.getByLabelText('历史版本'), {
      target: { value: 'bvid:BV1note:version:2026-06-17T00:00:00.000Z' }
    })

    expect(screen.getByText(/先介绍机器学习的基本概念/)).toBeInTheDocument()
  })

  it('copies transcript and summary text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })

    render(
      <VideoNoteArchivePanel
        archives={createArchives()}
        onClose={vi.fn()}
        onOpenSource={vi.fn()}
        onDeleteEntry={vi.fn()}
        onDeleteVersion={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '复制纯文稿' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('第二版纯文稿。'))

    fireEvent.click(screen.getByRole('button', { name: '复制总结' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('## 速览')))
  })

  it('opens source and confirms destructive deletes', async () => {
    const onOpenSource = vi.fn()
    const onDeleteEntry = vi.fn().mockResolvedValue(undefined)
    const onDeleteVersion = vi.fn().mockResolvedValue(undefined)

    render(
      <VideoNoteArchivePanel
        archives={createArchives()}
        onClose={vi.fn()}
        onOpenSource={onOpenSource}
        onDeleteEntry={onDeleteEntry}
        onDeleteVersion={onDeleteVersion}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '打开来源' }))
    expect(onOpenSource).toHaveBeenCalledWith('https://www.bilibili.com/video/BV1note')

    fireEvent.click(screen.getByRole('button', { name: '删除当前版本' }))
    const versionDialog = screen.getByRole('dialog', { name: '确认删除' })
    fireEvent.click(within(versionDialog).getByRole('button', { name: '确认删除' }))
    await waitFor(() =>
      expect(onDeleteVersion).toHaveBeenCalledWith(
        'bvid:BV1note',
        'bvid:BV1note:version:2026-06-17T01:00:00.000Z'
      )
    )

    fireEvent.click(screen.getByRole('button', { name: '删除视频档案' }))
    const entryDialog = screen.getByRole('dialog', { name: '确认删除' })
    fireEvent.click(within(entryDialog).getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(onDeleteEntry).toHaveBeenCalledWith('bvid:BV1note'))
  })
})
