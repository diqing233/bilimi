import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { NotePosterSummary, VideoNote, VideoNoteArchiveEntry } from '@shared/types'
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
    userMemo: '期末复习',
    starred: true
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

function renderArchivePanel(overrides: Partial<React.ComponentProps<typeof VideoNoteArchivePanel>> = {}) {
  return render(
    <VideoNoteArchivePanel
      archives={createArchives()}
      onClose={vi.fn()}
      onOpenSource={vi.fn()}
      onUpdateVersion={vi.fn()}
      onDeleteEntry={vi.fn()}
      onDeleteVersion={vi.fn()}
      deepSeekEnabled={true}
      onGeneratePoster={vi.fn()}
      onArchivePosterSummary={vi.fn()}
      {...overrides}
    />
  )
}

describe('VideoNoteArchivePanel', () => {
  it('renders searchable archive list before showing selected video detail', () => {
    renderArchivePanel()

    expect(screen.getByRole('searchbox', { name: '搜索档案' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /机器学习入门/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /React 状态管理/ })).toBeInTheDocument()
    expect(screen.queryByText('第二版纯文稿。')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /机器学习入门/ }))

    expect(screen.queryByText('第二版纯文稿。')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '无时间线文稿' }))

    expect(screen.getByText('第二版纯文稿。')).toBeInTheDocument()
    expect(screen.queryByLabelText('批注标题')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('批注正文')).not.toBeInTheDocument()
  })

  it('shows archive detail below the list only after a video is selected', () => {
    renderArchivePanel()

    expect(screen.getByRole('list', { name: '视频列表' })).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: '机器学习入门' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /机器学习入门/ }))

    expect(screen.getByRole('article', { name: '机器学习入门' })).toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: '档案文稿' })).toBeInTheDocument()
    expect(screen.queryByText('纯文稿连续阅读，提供复制全文。')).not.toBeInTheDocument()
  })

  it('searches title, author, bvid, transcript and summary text', () => {
    renderArchivePanel()

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索档案' }), {
      target: { value: 'reducer' }
    })

    expect(screen.queryByRole('button', { name: /机器学习入门/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /React 状态管理/ })).toBeInTheDocument()
  })

  it('filters archives with memo and starred notes', () => {
    renderArchivePanel()

    expect(screen.queryByLabelText('有批注')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '已备注' }))
    expect(screen.getByRole('button', { name: /机器学习入门/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /React 状态管理/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '已备注' }))
    fireEvent.click(screen.getByRole('button', { name: '星标' }))
    expect(screen.getByRole('button', { name: /机器学习入门/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /React 状态管理/ })).not.toBeInTheDocument()
  })

  it('places the top archive star filter and memo button beside the search field', () => {
    renderArchivePanel()

    const toolbar = screen.getByRole('searchbox', { name: '搜索档案' }).closest(
      '.video-note-archive__toolbar'
    )
    const searchLabel = screen.getByRole('searchbox', { name: '搜索档案' }).closest('label')
    const starFilter = screen.getByRole('button', { name: '星标' })
    const memoFilter = screen.getByRole('button', { name: '已备注' })

    expect(toolbar?.children[0]).toBe(searchLabel)
    expect(toolbar?.children[1]).toBe(starFilter)
    expect(toolbar?.children[2]).toBe(memoFilter)
    expect(screen.queryByRole('checkbox', { name: '有备注' })).not.toBeInTheDocument()
  })

  it('switches selected video and version', () => {
    renderArchivePanel()

    fireEvent.click(screen.getByRole('button', { name: /机器学习入门/ }))
    fireEvent.change(screen.getByLabelText('历史版本'), {
      target: { value: 'bvid:BV1note:version:2026-06-17T00:00:00.000Z' }
    })

    fireEvent.click(screen.getByRole('tab', { name: '无时间线文稿' }))
    expect(screen.getByText(/先介绍机器学习的基本概念/)).toBeInTheDocument()
  })

  it('collapses an open archive transcript tab when clicked again', () => {
    renderArchivePanel()

    fireEvent.click(screen.getByRole('button', { name: /机器学习入门/ }))
    fireEvent.click(screen.getByRole('tab', { name: '无时间线文稿' }))
    expect(screen.getByText('第二版纯文稿。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '无时间线文稿' }))

    expect(screen.queryByText('第二版纯文稿。')).not.toBeInTheDocument()
  })

  it('opens source from the underlined title and more menu, and deletes versions inline', async () => {
    const onOpenSource = vi.fn()
    const onDeleteVersion = vi.fn().mockResolvedValue(undefined)
    renderArchivePanel({ onOpenSource, onDeleteVersion })

    fireEvent.click(screen.getByRole('button', { name: /机器学习入门/ }))
    fireEvent.click(screen.getByRole('link', { name: '机器学习入门' }))
    expect(onOpenSource).toHaveBeenCalledWith('https://www.bilibili.com/video/BV1note')

    fireEvent.click(screen.getByRole('button', { name: '更多档案操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '打开视频来源' }))
    expect(onOpenSource).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: '展开历史版本' }))
    fireEvent.click(screen.getByRole('button', { name: /删除版本 v1/ }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))

    await waitFor(() =>
      expect(onDeleteVersion).toHaveBeenCalledWith(
        expect.any(String),
        'bvid:BV1note:version:2026-06-17T00:00:00.000Z'
      )
    )
    expect(screen.queryByRole('button', { name: '删除当前版本' })).not.toBeInTheDocument()
  })

  it('opens the memo editor directly below the version controls', () => {
    renderArchivePanel()

    fireEvent.click(screen.getByRole('button', { name: /BV1note/ }))
    fireEvent.click(screen.getByRole('button', { name: '\u5907\u6ce8' }))

    const detail = screen.getByRole('article', { name: /\u673a\u5668\u5b66\u4e60/ })
    const controls = detail.querySelector('.video-note-archive__version-controls')
    const editor = screen.getByLabelText('\u5907\u6ce8')

    expect(controls).not.toBeNull()
    expect(controls?.nextElementSibling).toBe(editor)
    expect(detail.querySelector('.video-note-archive__actions')).toBeNull()
  })

  it('copies transcript and summary text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })

    renderArchivePanel()

    fireEvent.click(screen.getByRole('button', { name: /机器学习入门/ }))
    fireEvent.click(screen.getByRole('tab', { name: '无时间线文稿' }))
    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('第二版纯文稿。'))

    fireEvent.click(screen.getByRole('tab', { name: 'DeepSeek 总结' }))
    expect(screen.getByText('暂无 DeepSeek 总结。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '复制全文' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(''))
  })

  it('uses an attached triangle menu for DeepSeek summary copies in the archive', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })
    const summaryText = [
      '## 精准总结',
      '',
      '### 机器学习入门',
      '整体主旨：用数据和模型解释机器学习。',
      '',
      '- 核心内容：训练数据影响模型表现。',
      '关键词：机器学习、训练数据',
      '',
      '## 精修文稿',
      '',
      '先介绍机器学习的基本概念。',
      '',
      '## 内容核对清单',
      '',
      '- 数据：训练数据'
    ].join('\n')
    const archives = appendVideoNoteArchiveVersion(
      [],
      createNote(),
      '2026-06-17T00:00:00.000Z',
      summaryText
    )

    renderArchivePanel({ archives })

    fireEvent.click(screen.getByRole('button', { name: /机器学习入门/ }))
    fireEvent.click(screen.getByRole('tab', { name: 'DeepSeek 总结' }))

    const splitButton = screen.getByRole('group', { name: '档案 DeepSeek 复制' })
    fireEvent.click(within(splitButton).getByRole('button', { name: '复制全文' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(summaryText))
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

  it('generates a DeepSeek summary for an archived transcript without retranscribing', async () => {
    const poster: NotePosterSummary = {
      title: '归档总结',
      subtitle: '基于已有文稿生成',
      keyPoints: ['不需要重新转写'],
      keywords: ['档案'],
      prompt: 'archive poster',
      polishedTranscriptText: '## 精修文稿\n\n第二版纯文稿。',
      auditChecklistText: '- 文稿：已读取'
    }
    const onGeneratePoster = vi.fn().mockResolvedValue(poster)
    const onArchivePosterSummary = vi.fn().mockResolvedValue(undefined)

    renderArchivePanel({ onGeneratePoster, onArchivePosterSummary })

    fireEvent.click(screen.getByRole('button', { name: /机器学习入门/ }))
    fireEvent.click(screen.getByRole('tab', { name: 'DeepSeek 总结' }))
    fireEvent.click(screen.getByRole('button', { name: '生成总结' }))

    await waitFor(() => expect(onGeneratePoster).toHaveBeenCalledWith(expect.objectContaining({
      id: 'bvid:BV1note'
    })))
    expect(onArchivePosterSummary).toHaveBeenCalledWith(expect.any(Object), poster)
    expect(await screen.findByText('归档总结')).toBeInTheDocument()
  })

  it('saves archive memo and starred state while keeping them filterable', async () => {
    const onUpdateVersion = vi.fn().mockResolvedValue(undefined)

    renderArchivePanel({ onUpdateVersion })

    fireEvent.click(screen.getByRole('button', { name: /React 状态管理/ }))
    expect(screen.queryByLabelText('本地备注')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '备注' }))

    const memoInput = screen.getByLabelText('本地备注')
    fireEvent.change(memoInput, {
      target: { value: '下次复盘时先看这条。' }
    })

    expect(memoInput).toHaveValue('下次复盘时先看这条。')
    expect(onUpdateVersion).not.toHaveBeenCalled()

    fireEvent.blur(memoInput)

    await waitFor(() =>
      expect(onUpdateVersion).toHaveBeenLastCalledWith(
        'bvid:BV1react',
        'bvid:BV1react:version:2026-06-16T00:00:00.000Z',
        expect.objectContaining({
          userMemo: '下次复盘时先看这条。'
        })
      )
    )

    fireEvent.click(screen.getByRole('button', { name: '已备注' }))
    expect(screen.getByRole('button', { name: /React 状态管理/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '星标收藏' }))

    await waitFor(() =>
      expect(onUpdateVersion).toHaveBeenLastCalledWith(
        'bvid:BV1react',
        'bvid:BV1react:version:2026-06-16T00:00:00.000Z',
        expect.objectContaining({
          starred: true
        })
      )
    )

    fireEvent.click(screen.getByRole('button', { name: '已备注' }))
    fireEvent.click(screen.getByRole('button', { name: '星标' }))
    expect(screen.getByRole('button', { name: /React 状态管理/ })).toBeInTheDocument()
  })

  it('keeps memo editing available when the memo filter is active', async () => {
    const onUpdateVersion = vi.fn().mockResolvedValue(undefined)

    renderArchivePanel({ onUpdateVersion })

    fireEvent.click(screen.getByRole('button', { name: '已备注' }))
    fireEvent.click(screen.getByRole('button', { name: /机器学习入门/ }))
    fireEvent.click(screen.getByRole('button', { name: '备注' }))

    const memoInput = screen.getByLabelText('本地备注')
    fireEvent.change(memoInput, { target: { value: '' } })

    expect(screen.getByRole('article', { name: '机器学习入门' })).toBeInTheDocument()
    expect(memoInput).toHaveValue('')

    fireEvent.change(memoInput, { target: { value: '重新整理重点。' } })
    fireEvent.blur(memoInput)

    await waitFor(() =>
      expect(onUpdateVersion).toHaveBeenLastCalledWith(
        'bvid:BV1note',
        'bvid:BV1note:version:2026-06-17T01:00:00.000Z',
        expect.objectContaining({
          userMemo: '重新整理重点。'
        })
      )
    )
  })

  it('opens source and confirms destructive deletes', async () => {
    const onOpenSource = vi.fn()
    const onDeleteEntry = vi.fn().mockResolvedValue(undefined)
    const onDeleteVersion = vi.fn().mockResolvedValue(undefined)

    renderArchivePanel({ onOpenSource, onDeleteEntry, onDeleteVersion })

    fireEvent.click(screen.getByRole('button', { name: /机器学习入门/ }))
    fireEvent.click(screen.getByRole('link', { name: '机器学习入门' }))
    expect(onOpenSource).toHaveBeenCalledWith('https://www.bilibili.com/video/BV1note')

    fireEvent.click(screen.getByRole('button', { name: '展开历史版本' }))
    fireEvent.click(screen.getByRole('button', { name: /删除版本 v2/ }))
    const versionDialog = screen.getByRole('dialog', { name: '确认删除' })
    fireEvent.click(within(versionDialog).getByRole('button', { name: '确认删除' }))
    await waitFor(() =>
      expect(onDeleteVersion).toHaveBeenCalledWith(
        'bvid:BV1note',
        'bvid:BV1note:version:2026-06-17T01:00:00.000Z'
      )
    )

    fireEvent.click(screen.getByRole('button', { name: '更多档案操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '删除视频档案' }))
    const entryDialog = screen.getByRole('dialog', { name: '确认删除' })
    fireEvent.click(within(entryDialog).getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(onDeleteEntry).toHaveBeenCalledWith('bvid:BV1note'))
  })
})
