import { useState } from 'react'
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
    highlights: [
      { start: 75, title: '核心提示', detail: '训练数据决定模型上限。' }
    ]
  },
  annotations: [],
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

    await waitFor(() => expect(onGenerate).toHaveBeenCalledOnce())
  })

  it('keeps the redesigned flat layout before a note exists', () => {
    const onOpenArchive = vi.fn()

    render(
      <VideoNotesPanel
        note={null}
        currentVideoTitle="机器学习当前页"
        isLoading={false}
        onGenerate={vi.fn()}
        onSave={vi.fn()}
        onTranscribeAudio={vi.fn()}
        onOpenArchive={onOpenArchive}
      />
    )

    expect(screen.getByRole('region', { name: '当前视频详情' })).toHaveTextContent('机器学习当前页')

    const actions = screen.getAllByRole('button', { name: /转写音频|档案库/ })
    expect(actions.map((button) => button.textContent)).toEqual(['转写音频', '档案库'])

    const resultEntries = screen.getAllByRole('button', {
      name: /无时间线文稿|带时间线文稿|一图流总结/
    })
    expect(resultEntries.map((entry) => entry.textContent)).toEqual([
      '无时间线文稿纯文稿连续阅读，提供复制全文。',
      '带时间线文稿按时间段阅读，可跳回视频、可加批注。',
      '一图流总结结构化摘要，支持复制。'
    ])
  })

  it('uses audio transcription for the default note organization action when available', async () => {
    const onGenerate = vi.fn().mockResolvedValue(null)
    const onTranscribeAudio = vi.fn().mockResolvedValue(sampleNote)

    render(
      <VideoNotesPanel
        note={null}
        isLoading={false}
        onGenerate={onGenerate}
        onSave={vi.fn()}
        onTranscribeAudio={onTranscribeAudio}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '转写音频' }))

    await waitFor(() => expect(onTranscribeAudio).toHaveBeenCalledOnce())
    expect(onGenerate).not.toHaveBeenCalled()
  })

  it('shows the redesigned action and result entry order when a note exists', () => {
    const onOpenArchive = vi.fn()
    const onTranscribeAudio = vi.fn().mockResolvedValue(sampleNote)

    render(
      <VideoNotesPanel
        note={sampleNote}
        isLoading={false}
        onGenerate={vi.fn()}
        onSave={vi.fn()}
        onTranscribeAudio={onTranscribeAudio}
        onOpenArchive={onOpenArchive}
      />
    )

    const actions = screen.getAllByRole('button', { name: /转写音频|档案库/ })
    expect(actions.map((button) => button.textContent)).toEqual(['转写音频', '档案库'])

    const resultTabs = screen.getAllByRole('tab')
    expect(resultTabs.map((tab) => tab.textContent)).toEqual([
      '无时间线文稿纯文稿连续阅读，提供复制全文。',
      '带时间线文稿按时间段阅读，可跳回视频、可加批注。',
      '一图流总结结构化摘要，支持复制。'
    ])

    fireEvent.click(screen.getByRole('button', { name: '档案库' }))
    expect(onOpenArchive).toHaveBeenCalledOnce()
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

    fireEvent.click(screen.getByRole('tab', { name: /一图流总结/ }))

    expect(screen.getByText('三分钟讲清机器学习的基本思路。')).toBeInTheDocument()
    expect(screen.getByText('开场')).toBeInTheDocument()
    expect(screen.getByText('解释机器学习为什么有用。')).toBeInTheDocument()
    expect(screen.getAllByText('01:15')).toHaveLength(2)
    expect(screen.getByText('说明数据质量的重要性。')).toBeInTheDocument()
    expect(screen.getByText('机器学习')).toBeInTheDocument()
    expect(screen.getByText('训练数据')).toBeInTheDocument()
    expect(screen.getByText('核心提示')).toBeInTheDocument()
    expect(screen.getByText('训练数据决定模型上限。')).toBeInTheDocument()
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

    fireEvent.click(screen.getByRole('tab', { name: /带时间线文稿/ }))

    expect(screen.getByText('00:00')).toBeInTheDocument()
    expect(screen.getByText('先介绍机器学习的基本概念。')).toBeInTheDocument()
    expect(screen.getByText('01:15')).toBeInTheDocument()
    expect(screen.getByText('再说明训练数据如何影响模型。')).toBeInTheDocument()
  })

  it('starts a timestamp annotation from a transcript segment', () => {
    render(
      <VideoNotesPanel
        note={sampleNote}
        isLoading={false}
        onGenerate={vi.fn()}
        onSave={vi.fn()}
        onChange={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('tab', { name: /带时间线文稿/ }))
    fireEvent.click(screen.getAllByRole('button', { name: '加批注' })[1])

    expect(screen.getAllByRole('button', { name: '01:15' }).length).toBeGreaterThan(0)
    expect(screen.getByLabelText<HTMLInputElement>('批注标题').value).toBe('训练数据如何影响模型')
  })

  it('starts a timestamp annotation from a timeline item', () => {
    render(
      <VideoNotesPanel
        note={sampleNote}
        isLoading={false}
        onGenerate={vi.fn()}
        onSave={vi.fn()}
        onChange={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('tab', { name: /一图流总结/ }))
    fireEvent.click(screen.getAllByRole('button', { name: '加批注' })[1])

    expect(screen.getAllByRole('button', { name: '01:15' }).length).toBeGreaterThan(0)
    expect(screen.getByLabelText<HTMLInputElement>('批注标题').value).toBe('数据')
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


    expect(screen.getByText('机器学习入门')).toBeInTheDocument()
    expect(screen.getByText('李老师')).toBeInTheDocument()
    expect(screen.getByText('BV1note')).toBeInTheDocument()
    expect(screen.getByText('https://www.bilibili.com/video/BV1note')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '保存札记' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(sampleNote))
    expect(screen.getByRole('status')).toHaveTextContent('札记已保存')
  })

  it('adds a timestamp annotation from the current video time', async () => {
    const onGetCurrentTime = vi.fn().mockResolvedValue(83.8)
    const onSave = vi.fn().mockResolvedValue(undefined)
    const onChange = vi.fn()

    render(
      <VideoNotesPanel
        note={sampleNote}
        isLoading={false}
        onGenerate={vi.fn()}
        onSave={onSave}
        onChange={onChange}
        onGetCurrentTime={onGetCurrentTime}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '取当前时间' }))

    await waitFor(() => expect(onGetCurrentTime).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: '01:23' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('批注标题'), {
      target: { value: '反复看这里' }
    })
    fireEvent.change(screen.getByLabelText('批注正文'), {
      target: { value: '训练数据和模型关系的解释很清楚。' }
    })
    fireEvent.click(screen.getByRole('button', { name: '保存批注' }))

    await waitFor(() => expect(onChange).toHaveBeenCalledOnce())
    const nextNote = onChange.mock.calls[0][0] as VideoNote
    expect(onSave).toHaveBeenCalledWith(nextNote)
    expect(nextNote.annotations).toHaveLength(1)
    expect(nextNote.annotations[0]).toEqual(
      expect.objectContaining({
        start: 83.8,
        title: '反复看这里',
        body: '训练数据和模型关系的解释很清楚。'
      })
    )
  })

  it('seeks to an annotation timestamp', async () => {
    const onSeekToTime = vi.fn().mockResolvedValue(true)
    const noteWithAnnotation: VideoNote = {
      ...sampleNote,
      annotations: [
        {
          id: 'annotation-1',
          start: 125,
          title: '模型解释',
          body: '复看这一段。',
          createdAt: '2026-04-28T01:00:00.000Z',
          updatedAt: '2026-04-28T01:00:00.000Z'
        }
      ]
    }

    render(
      <VideoNotesPanel
        note={noteWithAnnotation}
        isLoading={false}
        onGenerate={vi.fn()}
        onSave={vi.fn()}
        onSeekToTime={onSeekToTime}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '02:05' }))

    await waitFor(() => expect(onSeekToTime).toHaveBeenCalledWith(125))
  })

  it('shows an accessible error when seeking to a timestamp fails', async () => {
    const onSeekToTime = vi.fn().mockResolvedValue(false)
    const noteWithAnnotation: VideoNote = {
      ...sampleNote,
      annotations: [
        {
          id: 'annotation-1',
          start: 125,
          title: '模型解释',
          body: '复看这一段。',
          createdAt: '2026-04-28T01:00:00.000Z',
          updatedAt: '2026-04-28T01:00:00.000Z'
        }
      ]
    }

    render(
      <VideoNotesPanel
        note={noteWithAnnotation}
        isLoading={false}
        onGenerate={vi.fn()}
        onSave={vi.fn()}
        onSeekToTime={onSeekToTime}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '02:05' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('未能跳转到该视频时间。'))
  })

  it('does not report annotation save success when note changes cannot be applied', async () => {
    render(
      <VideoNotesPanel
        note={sampleNote}
        isLoading={false}
        onGenerate={vi.fn()}
        onSave={vi.fn()}
      />
    )

    fireEvent.change(screen.getByLabelText('批注标题'), {
      target: { value: '无法保存的批注' }
    })
    fireEvent.click(screen.getByRole('button', { name: '保存批注' }))

    expect(screen.getByRole('alert')).toHaveTextContent('当前窗口暂不能更新批注。')
    expect(screen.queryByText('批注已保存')).not.toBeInTheDocument()
  })

  it('shows an accessible error when current video time cannot be read', async () => {
    const onGetCurrentTime = vi.fn().mockRejectedValue(new Error('无法读取当前播放时间'))

    render(
      <VideoNotesPanel
        note={sampleNote}
        isLoading={false}
        onGenerate={vi.fn()}
        onSave={vi.fn()}
        onChange={vi.fn()}
        onGetCurrentTime={onGetCurrentTime}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '取当前时间' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('无法读取当前播放时间'))
  })

  it('copies the Markdown export', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })

    render(
      <VideoNotesPanel
        note={sampleNote}
        isLoading={false}
        onGenerate={vi.fn()}
        onSave={vi.fn()}
      />
    )

    expect(screen.getByLabelText<HTMLTextAreaElement>('Markdown 预览').value).toContain(
      '# 机器学习入门'
    )

    fireEvent.click(screen.getByRole('button', { name: '复制 Markdown' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('# 机器学习入门')))
    expect(screen.getByRole('status')).toHaveTextContent('Markdown 已复制')
  })

  it('shows an accessible error when copying Markdown fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('剪贴板不可用'))
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })

    render(
      <VideoNotesPanel
        note={sampleNote}
        isLoading={false}
        onGenerate={vi.fn()}
        onSave={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '复制 Markdown' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('剪贴板不可用'))
  })

  it('saves the latest local memo draft', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)

    render(
      <VideoNotesPanel
        note={{ ...sampleNote, userMemo: '旧备注' }}
        isLoading={false}
        onGenerate={vi.fn()}
        onSave={onSave}
      />
    )

    fireEvent.change(screen.getByLabelText('本地备注'), {
      target: { value: '这里要整理成长期复习材料。' }
    })
    fireEvent.click(screen.getByRole('button', { name: '保存札记' }))

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          userMemo: '这里要整理成长期复习材料。'
        })
      )
    )
  })

  it('updates the export preview after saving the latest memo through onChange', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)

    function StatefulPanel(): React.JSX.Element {
      const [note, setNote] = useState<VideoNote>({ ...sampleNote, userMemo: '旧备注' })

      return (
        <VideoNotesPanel
          note={note}
          isLoading={false}
          onGenerate={vi.fn()}
          onSave={onSave}
          onChange={setNote}
        />
      )
    }

    render(<StatefulPanel />)

    fireEvent.change(screen.getByLabelText('本地备注'), {
      target: { value: '保存后导出也要看到这条备注。' }
    })
    fireEvent.click(screen.getByRole('button', { name: '保存札记' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())

    expect(screen.getByLabelText<HTMLTextAreaElement>('Markdown 预览').value).toContain(
      '保存后导出也要看到这条备注。'
    )
  })

  it('does not render manual pasted transcript controls before a note exists', () => {
    const onGenerate = vi.fn()

    render(
      <VideoNotesPanel
        note={null}
        isLoading={false}
        onGenerate={onGenerate}
        onSave={vi.fn()}
      />
    )

    expect(screen.queryByLabelText('粘贴文稿')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '整理粘贴文稿' })).not.toBeInTheDocument()
    expect(screen.queryByText(/粘贴文稿/)).not.toBeInTheDocument()
    expect(onGenerate).not.toHaveBeenCalled()
  })

  it('shows audio transcription fallback when no note is present', () => {
    render(
      <VideoNotesPanel
        note={null}
        isLoading={false}
        onGenerate={vi.fn()}
        onSave={vi.fn()}
        onTranscribeAudio={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: '转写音频' })).toBeInTheDocument()
  })

  it('runs audio transcription and reports progress', async () => {
    const onTranscribeAudio = vi.fn().mockResolvedValue(sampleNote)

    render(
      <VideoNotesPanel
        note={null}
        isLoading={false}
        onGenerate={vi.fn()}
        onSave={vi.fn()}
        onTranscribeAudio={onTranscribeAudio}
        transcriptionProgress={{
          step: 'transcribing-segment',
          message: 'Transcribing segment 1/2.',
          segmentIndex: 1,
          segmentCount: 2
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '转写音频' }))

    await waitFor(() => expect(onTranscribeAudio).toHaveBeenCalledOnce())
    expect(screen.getByText('音频转写已完成')).toBeInTheDocument()
    expect(screen.getByText('Transcribing segment 1/2.')).toBeInTheDocument()
  })

  it('offers audio transcription when an existing note has no transcript', async () => {
    const onTranscribeAudio = vi.fn().mockResolvedValue(sampleNote)

    render(
      <VideoNotesPanel
        note={{ ...sampleNote, transcript: [], transcriptSource: 'manual' }}
        isLoading={false}
        onGenerate={vi.fn()}
        onSave={vi.fn()}
        onTranscribeAudio={onTranscribeAudio}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '转写音频' }))

    await waitFor(() => expect(onTranscribeAudio).toHaveBeenCalledOnce())
  })

  it('keeps manual paste hidden when audio transcription fails', async () => {
    const onTranscribeAudio = vi.fn().mockRejectedValue(new Error('Audio download failed.'))

    render(
      <VideoNotesPanel
        note={null}
        isLoading={false}
        onGenerate={vi.fn()}
        onSave={vi.fn()}
        onTranscribeAudio={onTranscribeAudio}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '转写音频' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Audio download failed.'))
    expect(screen.queryByLabelText('粘贴文稿')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '整理粘贴文稿' })).not.toBeInTheDocument()
  })

  it('does not render OpenAI key controls for local transcription', () => {
    render(
      <VideoNotesPanel
        note={null}
        isLoading={false}
        onGenerate={vi.fn()}
        onSave={vi.fn()}
        onTranscribeAudio={vi.fn()}
      />
    )

    expect(screen.queryByLabelText('OpenAI API Key')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存 Key' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '清除 Key' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '转写音频' })).toBeEnabled()
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
    expect(screen.queryByRole('button', { name: '整理粘贴文稿' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('粘贴文稿')).not.toBeInTheDocument()
  })

  it('locks generate buttons during a local generation request and reports failures', async () => {
    let rejectGenerate: (error: Error) => void
    const onGenerate = vi.fn(
      () =>
        new Promise<VideoNote | null>((_resolve, reject) => {
          rejectGenerate = reject
        })
    )

    render(
      <VideoNotesPanel
        note={null}
        isLoading={false}
        onGenerate={onGenerate}
        onSave={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理札记' }))

    expect(screen.getByRole('button', { name: '整理中...' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '整理粘贴文稿' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('粘贴文稿')).not.toBeInTheDocument()

    rejectGenerate!(new Error('文稿读取失败'))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('文稿读取失败'))
    expect(screen.getByRole('button', { name: '重新整理' })).toBeEnabled()
  })

  it('shows a completion status after generation returns a note before the parent refreshes', async () => {
    const onGenerate = vi.fn().mockResolvedValue(sampleNote)

    render(
      <VideoNotesPanel
        note={null}
        isLoading={false}
        onGenerate={onGenerate}
        onSave={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理札记' }))

    expect(await screen.findByRole('status')).toHaveTextContent('札记已整理')
  })

  it('locks the archive save button while saving and reports save failures', async () => {
    let rejectSave: (error: Error) => void
    const onSave = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSave = reject
        })
    )

    render(
      <VideoNotesPanel
        note={sampleNote}
        isLoading={false}
        onGenerate={vi.fn()}
        onSave={onSave}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '保存札记' }))

    expect(screen.getByRole('button', { name: '保存中...' })).toBeDisabled()

    rejectSave!(new Error('磁盘写入失败'))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('磁盘写入失败'))
    expect(screen.getByRole('button', { name: '保存札记' })).toBeEnabled()
  })
})

