import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { VideoNote } from '@shared/types'
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
    highlights: []
  },
  userMemo: '',
  createdAt: '2026-04-28T00:00:00.000Z',
  updatedAt: '2026-04-28T00:00:00.000Z'
}

describe('VideoNotesPanel', () => {
  it('generates notes from the current video when there is no note', async () => {
    const onGenerate = vi.fn().mockResolvedValue(null)

    render(
      <VideoNotesPanel
        note={null}
        isLoading={false}
        onGenerate={onGenerate}
        onSave={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理札记' }))

    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith(undefined))
  })

  it('switches between overview, transcript, and archive tabs when a note exists', () => {
    render(
      <VideoNotesPanel
        note={sampleNote}
        isLoading={false}
        onGenerate={vi.fn()}
        onSave={vi.fn()}
      />
    )

    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '速览' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('三分钟讲清机器学习的基本思路。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '文稿' }))
    expect(screen.getByRole('tab', { name: '文稿' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('先介绍机器学习的基本概念。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '归档' }))
    expect(screen.getByRole('tab', { name: '归档' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('机器学习入门')).toBeInTheDocument()
  })

  it('shows the overview summary and timeline highlights', () => {
    render(
      <VideoNotesPanel
        note={sampleNote}
        isLoading={false}
        onGenerate={vi.fn()}
        onSave={vi.fn()}
      />
    )

    expect(screen.getByText('三分钟讲清机器学习的基本思路。')).toBeInTheDocument()
    expect(screen.getByText('开场')).toBeInTheDocument()
    expect(screen.getByText('解释机器学习为什么有用。')).toBeInTheDocument()
    expect(screen.getByText('01:15')).toBeInTheDocument()
    expect(screen.getByText('说明数据质量的重要性。')).toBeInTheDocument()
  })

  it('shows transcript segments with formatted timestamps', () => {
    render(
      <VideoNotesPanel
        note={sampleNote}
        isLoading={false}
        onGenerate={vi.fn()}
        onSave={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('tab', { name: '文稿' }))

    expect(screen.getByText('00:00')).toBeInTheDocument()
    expect(screen.getByText('先介绍机器学习的基本概念。')).toBeInTheDocument()
    expect(screen.getByText('01:15')).toBeInTheDocument()
    expect(screen.getByText('再说明训练数据如何影响模型。')).toBeInTheDocument()
  })

  it('shows archive metadata and reports after saving the note', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)

    render(
      <VideoNotesPanel
        note={sampleNote}
        isLoading={false}
        onGenerate={vi.fn()}
        onSave={onSave}
      />
    )

    fireEvent.click(screen.getByRole('tab', { name: '归档' }))

    expect(screen.getByText('机器学习入门')).toBeInTheDocument()
    expect(screen.getByText('李老师')).toBeInTheDocument()
    expect(screen.getByText('BV1note')).toBeInTheDocument()
    expect(screen.getByText('https://www.bilibili.com/video/BV1note')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '保存札记' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(sampleNote))
    expect(screen.getByRole('status')).toHaveTextContent('札记已保存')
  })

  it('generates notes from pasted transcript text', async () => {
    const onGenerate = vi.fn().mockResolvedValue(null)

    render(
      <VideoNotesPanel
        note={null}
        isLoading={false}
        onGenerate={onGenerate}
        onSave={vi.fn()}
      />
    )

    fireEvent.change(screen.getByLabelText('粘贴文稿'), {
      target: { value: '这是手动粘贴的文稿。' }
    })
    fireEvent.click(screen.getByRole('button', { name: '整理粘贴文稿' }))

    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith('这是手动粘贴的文稿。'))
  })

  it('disables generate actions and shows progress while loading', () => {
    render(
      <VideoNotesPanel
        note={null}
        isLoading
        onGenerate={vi.fn()}
        onSave={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: '整理中...' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '整理粘贴文稿' })).toBeDisabled()
  })
})
