import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { NotePosterSummary, VideoNote, VideoNoteArchiveEntry } from '@shared/types'
import { appendVideoNoteArchiveVersion } from '@shared/videoNoteArchive'
import { VideoNoteArchivePanel } from './VideoNoteArchivePanel'

function createNote(overrides: Partial<VideoNote> = {}): VideoNote {
  return {
    id: 'bvid:BV1note',
    source: {
      accountMid: '100',
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
  it('enters batch mode with no selection and keeps archive details available', () => {
    const archives = createArchives()
    renderArchivePanel({ archives })

    fireEvent.click(screen.getByRole('button', { name: '批量导出' }))

    expect(screen.getAllByRole('checkbox', { name: /选择档案/ })).toHaveLength(archives.length)
    expect(screen.getByText('已选 0 项')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导出所选档案' })).toBeDisabled()

    const firstCheckbox = screen.getByRole('checkbox', { name: `选择档案：${archives[0]!.source.title}` })
    fireEvent.click(firstCheckbox)
    expect(screen.getByText('已选 1 项')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: new RegExp(archives[0]!.source.title) }))
    expect(screen.getByRole('article', { name: archives[0]!.source.title })).toBeInTheDocument()
    expect(firstCheckbox).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: '清除选择' }))
    expect(firstCheckbox).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '取消批量' }))
    expect(screen.queryByRole('checkbox', { name: /选择档案/ })).not.toBeInTheDocument()
  })

  it('selects the whole archive library through filters and exports every latest version', async () => {
    const archives = createArchives()
    for (const archive of archives) archive.source.accountMid = '100'
    const previewVideoNoteArchiveBatch = vi.fn().mockResolvedValue({ selectedCount: 2, exportableCount: 2, skippedCount: 0 })
    window.bilimiDesktop = {
      previewVideoNoteArchiveBatch, startVideoNoteArchiveBatch: vi.fn(), cancelVideoNoteArchiveBatch: vi.fn(), openVideoNoteArchiveBatchFolder: vi.fn(), onVideoNoteArchiveBatchProgress: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop
    renderArchivePanel({ archives, accountMid: '100' })

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索档案' }), { target: { value: archives[0]!.source.title } })
    fireEvent.click(screen.getByRole('button', { name: '批量导出' }))
    fireEvent.click(screen.getByRole('button', { name: '全选全部档案' }))

    expect(screen.getByText('已选 2 项，其中 1 项不在当前筛选结果中')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: new RegExp(archives[0]!.source.title) }))
    fireEvent.change(screen.getByLabelText('历史版本'), { target: { value: archives[0]!.versions[0]!.id } })
    fireEvent.click(screen.getByRole('button', { name: '导出所选档案' }))

    const dialog = await screen.findByRole('dialog', { name: '导出文稿' })
    expect(within(dialog).getByLabelText('当前版本完整档案')).toBeChecked()
    fireEvent.click(within(dialog).getByLabelText('单项内容'))
    expect(within(dialog).getByRole('button', { name: '选择导出内容' })).toBeEnabled()
    await waitFor(() => expect(previewVideoNoteArchiveBatch).toHaveBeenLastCalledWith(expect.objectContaining({
      accountMid: '100',
      selections: archives.map((archive) => ({ archiveId: archive.id, versionId: archive.versions.at(-1)!.id })),
      scope: 'current'
    })))
  })

  it('marks the return-to-notes control as the archive primary navigation action', () => {
    renderArchivePanel()

    const returnButton = screen.getByRole('button', { name: '返回 小咪 札记' })

    expect(returnButton).toHaveClass('video-note-archive__return-button')
    expect(within(returnButton).getByText('返回')).toHaveClass('video-note-archive__return-label')
    expect(within(returnButton).getByText('札记')).toHaveClass('video-note-archive__return-label')
    expect(within(returnButton).getByRole('img', { name: '小咪' })).toHaveClass(
      'video-note-archive__return-pet'
    )
  })

  it('renders searchable archive list before showing selected video detail', () => {
    renderArchivePanel()

    expect(screen.getByRole('searchbox', { name: '搜索档案' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /机器学习入门/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /React 状态管理/ })).toBeInTheDocument()
    expect(screen.queryByText('第二版纯文稿。')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /机器学习入门/ }))

    expect(screen.queryByText('第二版纯文稿。')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /无时间线文稿/ }))

    expect(screen.getByText('第二版纯文稿。')).toBeInTheDocument()
    expect(screen.queryByLabelText('批注标题')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('批注正文')).not.toBeInTheDocument()
  })

  it('keeps archived DeepSeek outline entries in a separately spaced reading list', () => {
    const archivedSummaryText = [
      '## 精准总结', '', '### 机器学习入门', '数据质量决定模型上限。', '',
      '- 训练数据需要覆盖典型样本。', '- 结论需要结合实际场景。', '',
      '## 详细内容提要', '',
      '- 先说明训练数据的作用。', '- 再对比不同样本的结果。', '',
      '## 精修文稿', '', '第一段。', '', '第二段。'
    ].join('\n')
    const archives = appendVideoNoteArchiveVersion([], createNote(), '2026-06-17T00:00:00.000Z', archivedSummaryText)
    renderArchivePanel({ archives })

    fireEvent.click(screen.getByRole('button', { name: /机器学习入门/ }))
    fireEvent.click(screen.getByRole('tab', { name: /DeepSeek 总结/ }))

    expect(screen.getByRole('list', { name: '精准总结要点' })).toHaveClass('video-notes__summary-points')
    expect(screen.getByRole('list', { name: '详细内容提要' })).toHaveClass('video-notes__summary-outline')
    expect(screen.getByText((_, element) =>
      element?.tagName === 'PRE' && element.textContent === '第一段。\n\n第二段。'
    )).toHaveClass('video-notes__summary-polished-text')
  })

  it('shows archive detail below the list only after a video is selected', () => {
    renderArchivePanel()

    expect(screen.getByRole('list', { name: '视频列表' })).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: '机器学习入门' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /机器学习入门/ }))

    expect(screen.getByRole('article', { name: '机器学习入门' })).toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: '档案文稿' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /无时间线文稿/ })).toHaveTextContent(
      '查看纯文稿，适合连续阅读'
    )
    expect(screen.getByRole('tab', { name: /带时间线文稿/ })).toHaveTextContent(
      '查看时间线文稿，可点击时间跳转'
    )
    expect(screen.getByRole('tab', { name: /DeepSeek 总结/ })).toHaveTextContent(
      '查看结构化总结与精修文稿'
    )
    expect(screen.getByRole('tab', { name: /无时间线文稿/ })).toHaveAttribute(
      'title',
      '无时间线文稿：查看纯文稿，适合连续阅读'
    )
    expect(screen.getByRole('tab', { name: /带时间线文稿/ })).toHaveAttribute(
      'title',
      '带时间线文稿：查看时间线文稿，可点击时间跳转'
    )
    expect(screen.getByRole('tab', { name: /DeepSeek 总结/ })).toHaveAttribute(
      'title',
      'DeepSeek 总结：查看结构化总结与精修文稿'
    )
  })

  it('keeps the archive detail compact until a transcript tab is expanded', () => {
    renderArchivePanel()
    const archive = screen.getByRole('region', { name: '全局档案库' })

    expect(archive).toHaveAttribute('data-result-expanded', 'false')
    fireEvent.click(screen.getByRole('button', { name: /机器学习入门/ }))
    expect(archive).toHaveAttribute('data-result-expanded', 'false')
    fireEvent.click(screen.getByRole('tab', { name: /无时间线文稿/ }))
    expect(archive).toHaveAttribute('data-result-expanded', 'true')
    fireEvent.click(screen.getByRole('tab', { name: /无时间线文稿/ }))
    expect(archive).toHaveAttribute('data-result-expanded', 'false')
  })

  it('marks only the clicked archive video as expanded in the list', () => {
    renderArchivePanel()

    const machineLearningButton = screen.getByRole('button', { name: /机器学习入门/ })
    const reactButton = screen.getByRole('button', { name: /React 状态管理/ })

    expect(within(machineLearningButton).getByText('详情')).toBeInTheDocument()
    expect(within(reactButton).getByText('详情')).toBeInTheDocument()

    fireEvent.click(machineLearningButton)

    expect(within(machineLearningButton).getByText('已展开')).toBeInTheDocument()
    expect(within(reactButton).getByText('详情')).toBeInTheDocument()

    fireEvent.click(reactButton)

    expect(within(machineLearningButton).getByText('详情')).toBeInTheDocument()
    expect(within(reactButton).getByText('已展开')).toBeInTheDocument()
  })

  it('collapses the selected archive detail when clicking the same video again', () => {
    renderArchivePanel()

    const archiveButton = screen.getByRole('button', { name: /机器学习入门/ })
    fireEvent.click(archiveButton)

    expect(screen.getByRole('article', { name: '机器学习入门' })).toBeInTheDocument()

    fireEvent.click(archiveButton)

    expect(screen.queryByRole('article', { name: '机器学习入门' })).not.toBeInTheDocument()
  })

  it('restores the previously selected archive detail when reopened with saved selection', () => {
    const archives = createArchives()
    renderArchivePanel({
      archives,
      selectedArchiveId: archives[0].id,
      selectedVersionId: archives[0].versions.at(-1)?.id ?? null
    })

    const archiveButton = screen.getByRole('button', { name: /机器学习入门/ })

    expect(screen.getByRole('article', { name: '机器学习入门' })).toBeInTheDocument()
    expect(within(archiveButton).getByText('已展开')).toBeInTheDocument()
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

    fireEvent.click(screen.getByRole('tab', { name: /无时间线文稿/ }))
    expect(screen.getByText(/先介绍机器学习的基本概念/)).toBeInTheDocument()
  })

  it('collapses an open archive transcript tab when clicked again', () => {
    renderArchivePanel()

    fireEvent.click(screen.getByRole('button', { name: /机器学习入门/ }))
    fireEvent.click(screen.getByRole('tab', { name: /无时间线文稿/ }))
    expect(screen.getByText('第二版纯文稿。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /无时间线文稿/ }))

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
    const header = detail.querySelector('header')
    const editor = screen.getByLabelText('\u5907\u6ce8')

    expect(controls).not.toBeNull()
    expect(header?.contains(controls)).toBe(true)
    expect(header?.nextElementSibling).toBe(editor)
    expect(detail.querySelector('.video-note-archive__actions')).toBeNull()
  })

  it('keeps archive detail title, metadata and version controls in compact adjacent rows', () => {
    renderArchivePanel()

    fireEvent.click(screen.getByRole('button', { name: /BV1note/ }))

    const detail = screen.getByRole('article', { name: /\u673a\u5668\u5b66\u4e60/ })
    const titleRow = detail.querySelector('.video-note-archive__detail-title-row')
    const metadataRow = detail.querySelector('.video-note-archive__detail-meta')
    const versionRow = detail.querySelector('.video-note-archive__version-controls')
    const title = screen.getByRole('link', { name: /\u673a\u5668\u5b66\u4e60/ })
    const moreButton = screen.getByRole('button', { name: /\u66f4\u591a.*\u64cd\u4f5c/ })

    expect(titleRow).not.toBeNull()
    expect(metadataRow).not.toBeNull()
    expect(versionRow).not.toBeNull()
    expect(titleRow?.contains(title)).toBe(true)
    expect(titleRow?.contains(moreButton)).toBe(true)
    expect(titleRow?.nextElementSibling).toBe(metadataRow)
    expect(metadataRow?.nextElementSibling).toBe(versionRow)
    expect(metadataRow).toHaveTextContent('BV1note')
    expect(metadataRow).toHaveTextContent('2')
  })

  it('keeps whole-archive deletion in the more menu and version deletion inside version rows', () => {
    renderArchivePanel()

    fireEvent.click(screen.getByRole('button', { name: /BV1note/ }))
    fireEvent.click(screen.getByRole('button', { name: /\u66f4\u591a.*\u64cd\u4f5c/ }))

    const moreMenu = screen.getByRole('menu')
    expect(within(moreMenu).getByRole('menuitem', { name: /\u6253\u5f00.*\u6765\u6e90/ })).toBeInTheDocument()
    expect(within(moreMenu).getByRole('menuitem', { name: /\u5220\u9664.*\u89c6\u9891.*\u6863\u6848/ })).toBeInTheDocument()
    expect(within(moreMenu).queryByRole('menuitem', { name: /\u5220\u9664\u7248\u672c/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /\u66f4\u591a.*\u64cd\u4f5c/ }))
    fireEvent.click(screen.getByRole('button', { name: /\u5c55\u5f00.*\u5386\u53f2\u7248\u672c/ }))

    const versionMenu = screen.getByRole('listbox')
    expect(within(versionMenu).getAllByRole('button', { name: /\u5220\u9664.*v\d/ })).toHaveLength(2)
    expect(within(versionMenu).queryByRole('button', { name: /\u5220\u9664.*\u89c6\u9891.*\u6863\u6848/ })).not.toBeInTheDocument()
  })

  it('copies transcript and summary text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })

    renderArchivePanel()

    fireEvent.click(screen.getByRole('button', { name: /机器学习入门/ }))
    fireEvent.click(screen.getByRole('tab', { name: /无时间线文稿/ }))
    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '复制无时间线文稿' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('第二版纯文稿。'))

    fireEvent.click(screen.getByRole('tab', { name: /DeepSeek 总结/ }))
    expect(screen.getByText('暂无 DeepSeek 总结。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    expect(screen.getByRole('menuitem', { name: '复制无时间线文稿' })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: '复制 DeepSeek 总结全文' })).toBeDisabled()
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
    fireEvent.click(screen.getByRole('tab', { name: /DeepSeek 总结/ }))

    const splitButton = screen.getByRole('group', { name: '档案 DeepSeek 复制' })
    fireEvent.click(within(splitButton).getByRole('button', { name: '复制' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '复制 DeepSeek 总结全文' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith([
      '## 精准总结', '', '### 机器学习入门', '整体主旨：用数据和模型解释机器学习。', '',
      '- 核心内容：训练数据影响模型表现。', '关键词：机器学习、训练数据', '',
      '## 详细内容提要', '', '- 数据：训练数据', '', '## 精修文稿', '', '先介绍机器学习的基本概念。'
    ].join('\n')))
    expect(within(splitButton).getByRole('button', { name: '复制' })).toHaveTextContent('▾')

    fireEvent.click(within(splitButton).getByRole('button', { name: '复制' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '仅复制精修文稿' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('先介绍机器学习的基本概念。'))

    fireEvent.click(within(splitButton).getByRole('button', { name: '复制' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '仅复制精准总结' }))
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
    const originalArchives = createArchives()
    const nextArchives = appendVideoNoteArchiveVersion(
      originalArchives,
      createNote({ updatedAt: '2026-06-17T02:00:00.000Z' }),
      '2026-06-17T02:00:00.000Z',
      '## 精准总结\n\n### 归档总结\n基于已有文稿生成'
    )
    const onArchivePosterSummary = vi.fn().mockResolvedValue({
      archives: nextArchives,
      archiveId: nextArchives[0].id,
      versionId: nextArchives[0].versions.at(-1)?.id
    })

    renderArchivePanel({
      archives: originalArchives,
      onGeneratePoster,
      onArchivePosterSummary
    })

    fireEvent.click(screen.getByRole('button', { name: /机器学习入门/ }))
    fireEvent.click(screen.getByRole('tab', { name: /DeepSeek 总结/ }))
    fireEvent.click(screen.getByRole('button', { name: '生成总结' }))

    await waitFor(() => expect(onGeneratePoster).toHaveBeenCalledWith(expect.objectContaining({
      id: 'bvid:BV1note'
    })))
    expect(onArchivePosterSummary).toHaveBeenCalledWith(
      originalArchives[0].id,
      originalArchives[0].versions.at(-1)?.id,
      expect.any(Object),
      poster
    )
    expect(await screen.findByText('归档总结')).toBeInTheDocument()
  })

  it('reports archive copy feedback outside the archive card', async () => {
    const onCopyFeedback = vi.fn()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) }
    })
    renderArchivePanel({ onCopyFeedback })

    fireEvent.click(screen.getByRole('button', { name: /机器学习入门/ }))
    fireEvent.click(screen.getByRole('tab', { name: /无时间线文稿/ }))
    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '复制无时间线文稿' }))

    await waitFor(() => expect(onCopyFeedback).toHaveBeenCalledWith({ tone: 'success', message: '无时间线文稿已复制' }))
    expect(screen.queryByText('无时间线文稿已复制')).not.toBeInTheDocument()
  })

  it('opens a current-content download dialog from every archive transcript panel', async () => {
    window.bilimiDesktop = {
      previewVideoNoteArchiveBatch: vi.fn().mockResolvedValue({ selectedCount: 1, exportableCount: 1, skippedCount: 0 }),
      startVideoNoteArchiveBatch: vi.fn(), cancelVideoNoteArchiveBatch: vi.fn(), openVideoNoteArchiveBatchFolder: vi.fn(), onVideoNoteArchiveBatchProgress: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop
    renderArchivePanel({ accountMid: '100' })
    fireEvent.click(screen.getByRole('button', { name: /机器学习入门/ }))

    for (const tabName of ['无时间线文稿', '带时间线文稿', 'DeepSeek 总结']) {
      fireEvent.click(screen.getByRole('tab', { name: new RegExp(tabName) }))
      const panel = screen.getByRole('tabpanel')
      fireEvent.click(within(panel).getByRole('button', { name: '导出' }))
      expect(await screen.findByRole('dialog', { name: '导出文稿' })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: '关闭弹窗' }))
      fireEvent.click(screen.getByRole('tab', { name: new RegExp(tabName) }))
    }
  })

  it('switches to the newly archived version after regenerating a summary', async () => {
    const originalSummary = '## 精准总结\n\n### 旧总结'
    const originalArchives = appendVideoNoteArchiveVersion(
      [],
      createNote(),
      '2026-06-17T00:00:00.000Z',
      originalSummary
    )
    const poster: NotePosterSummary = {
      title: '新总结',
      subtitle: '重新生成的内容',
      keyPoints: ['保留历史版本'],
      keywords: ['档案'],
      prompt: 'regenerated archive poster'
    }
    const nextArchives = appendVideoNoteArchiveVersion(
      originalArchives,
      createNote({ updatedAt: '2026-06-17T01:00:00.000Z' }),
      '2026-06-17T01:00:00.000Z',
      '## 精准总结\n\n### 新总结\n重新生成的内容'
    )
    const onArchivePosterSummary = vi.fn().mockResolvedValue({
      archives: nextArchives,
      archiveId: nextArchives[0].id,
      versionId: nextArchives[0].versions.at(-1)?.id
    })
    const onUpdateVersion = vi.fn().mockResolvedValue(undefined)

    renderArchivePanel({
      archives: originalArchives,
      onGeneratePoster: vi.fn().mockResolvedValue(poster),
      onArchivePosterSummary,
      onUpdateVersion
    })

    fireEvent.click(screen.getByRole('button', { name: /机器学习入门/ }))
    fireEvent.click(screen.getByRole('tab', { name: /DeepSeek 总结/ }))
    fireEvent.click(screen.getByRole('button', { name: '重新总结' }))

    await waitFor(() =>
      expect(screen.getByLabelText('历史版本')).toHaveValue(
        'bvid:BV1note:version:2026-06-17T01:00:00.000Z'
      )
    )
    expect(screen.getByText('新总结')).toBeInTheDocument()
    expect(onUpdateVersion).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('历史版本'), {
      target: { value: 'bvid:BV1note:version:2026-06-17T00:00:00.000Z' }
    })
    expect(screen.getByText('旧总结')).toBeInTheDocument()
  })

  it('keeps another account and legacy archives hidden after regenerating a summary', async () => {
    const originalArchives = appendVideoNoteArchiveVersion(
      [],
      createNote(),
      '2026-06-17T00:00:00.000Z',
      '## Summary\n\n### Current account'
    )
    const currentAccountArchives = appendVideoNoteArchiveVersion(
      originalArchives,
      createNote({ updatedAt: '2026-06-17T01:00:00.000Z' }),
      '2026-06-17T01:00:00.000Z',
      '## Summary\n\n### Regenerated current account'
    )
    const otherAccountArchives = appendVideoNoteArchiveVersion(
      currentAccountArchives,
      createNote({
        id: 'bvid:BV1other-account',
        source: {
          accountMid: '200',
          title: 'Other account archive',
          author: 'Other account',
          bvid: 'BV1other-account',
          url: 'https://www.bilibili.com/video/BV1other-account',
          tags: []
        }
      }),
      '2026-06-17T00:00:00.000Z'
    )
    const savedArchives = appendVideoNoteArchiveVersion(
      otherAccountArchives,
      createNote({
        id: 'bvid:BV1legacy',
        source: {
          title: 'Legacy unowned archive',
          author: 'Legacy',
          bvid: 'BV1legacy',
          url: 'https://www.bilibili.com/video/BV1legacy',
          tags: []
        }
      }),
      '2026-06-17T00:00:00.000Z'
    )

    renderArchivePanel({
      archives: originalArchives,
      accountMid: '100',
      onGeneratePoster: vi.fn().mockResolvedValue({
        title: 'Regenerated current account',
        subtitle: 'Current account only',
        keyPoints: ['Keep account isolation'],
        keywords: ['archive'],
        prompt: 'regenerated archive poster'
      }),
      onArchivePosterSummary: vi.fn().mockResolvedValue({
        archives: savedArchives,
        archiveId: currentAccountArchives[0]!.id,
        versionId: currentAccountArchives[0]!.versions.at(-1)!.id
      })
    })

    fireEvent.click(screen.getByRole('button', { name: /BV1note/ }))
    fireEvent.click(screen.getByRole('tab', { name: /DeepSeek/ }))
    fireEvent.click(screen.getByRole('button', { name: /重新总结/ }))

    await waitFor(() =>
      expect(screen.getByLabelText('历史版本')).toHaveValue(
        currentAccountArchives[0]!.versions.at(-1)!.id
      )
    )
    expect(screen.queryByRole('button', { name: /Other account archive/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Legacy unowned archive/ })).not.toBeInTheDocument()
  })

  it('does not publish a completed summary into the archive panel after the account changes', async () => {
    const firstAccountArchives = appendVideoNoteArchiveVersion(
      [],
      createNote(),
      '2026-06-17T00:00:00.000Z',
      '## Summary\n\n### First account'
    )
    const secondAccountArchives = appendVideoNoteArchiveVersion(
      [],
      createNote({
        id: 'bvid:BV1second-account',
        source: {
          accountMid: '200',
          title: 'Second account archive',
          author: 'Second account',
          bvid: 'BV1second-account',
          url: 'https://www.bilibili.com/video/BV1second-account',
          tags: []
        }
      }),
      '2026-06-17T00:00:00.000Z'
    )
    let resolveSummarySave: ((value: {
      archives: VideoNoteArchiveEntry[]
      archiveId: string
      versionId: string
    }) => void) | undefined
    const onArchivePosterSummary = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveSummarySave = resolve
    }))
    const commonProps = {
      onClose: vi.fn(),
      onOpenSource: vi.fn(),
      onUpdateVersion: vi.fn(),
      onDeleteEntry: vi.fn(),
      onDeleteVersion: vi.fn(),
      deepSeekEnabled: true,
      onGeneratePoster: vi.fn().mockResolvedValue({
        title: 'First account regenerated',
        subtitle: 'Delayed result',
        keyPoints: ['Do not cross accounts'],
        keywords: ['archive'],
        prompt: 'delayed archive poster'
      }),
      onArchivePosterSummary
    }
    const view = render(
      <VideoNoteArchivePanel archives={firstAccountArchives} accountMid="100" {...commonProps} />
    )

    fireEvent.click(screen.getByRole('button', { name: /BV1note/ }))
    fireEvent.click(screen.getByRole('tab', { name: /DeepSeek/ }))
    fireEvent.click(screen.getByRole('button', { name: /重新总结/ }))
    await waitFor(() => expect(onArchivePosterSummary).toHaveBeenCalledTimes(1))

    view.rerender(
      <VideoNoteArchivePanel archives={secondAccountArchives} accountMid="200" {...commonProps} />
    )
    resolveSummarySave?.({
      archives: firstAccountArchives,
      archiveId: firstAccountArchives[0]!.id,
      versionId: firstAccountArchives[0]!.versions[0]!.id
    })

    expect(await screen.findByRole('button', { name: /Second account archive/ })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /BV1note/ })).not.toBeInTheDocument()
    )
  })

  it('keeps the current summary unchanged when archiving a regenerated version fails', async () => {
    const originalSummary = '## 精准总结\n\n### 旧总结'
    const originalArchives = appendVideoNoteArchiveVersion(
      [],
      createNote(),
      '2026-06-17T00:00:00.000Z',
      originalSummary
    )
    const onUpdateVersion = vi.fn().mockResolvedValue(undefined)

    renderArchivePanel({
      archives: originalArchives,
      onGeneratePoster: vi.fn().mockResolvedValue({
        title: '新总结',
        subtitle: '不应覆盖旧版本',
        keyPoints: ['归档失败'],
        keywords: ['档案'],
        prompt: 'failed archive poster'
      }),
      onArchivePosterSummary: vi.fn().mockResolvedValue(undefined),
      onUpdateVersion
    })

    fireEvent.click(screen.getByRole('button', { name: /机器学习入门/ }))
    fireEvent.click(screen.getByRole('tab', { name: /DeepSeek 总结/ }))
    fireEvent.click(screen.getByRole('button', { name: '重新总结' }))

    expect(await screen.findByText('旧总结')).toBeInTheDocument()
    expect(onUpdateVersion).not.toHaveBeenCalled()
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

  it('uses the shared modal footer for archive deletion confirmation', () => {
    renderArchivePanel()

    fireEvent.click(screen.getByRole('button', { name: /机器学习入门/ }))
    fireEvent.click(screen.getByRole('button', { name: '展开历史版本' }))
    fireEvent.click(screen.getByRole('button', { name: /删除版本 v2/ }))

    const dialog = screen.getByRole('dialog', { name: '确认删除' })
    const confirm = within(dialog).getByRole('button', { name: '确认删除' })
    expect(dialog).toHaveClass('bilimi-modal__dialog')
    expect(dialog.querySelector('.bilimi-modal__actions')).toContainElement(confirm)
    expect(dialog.querySelector('.bilimi-modal__body')).not.toContainElement(confirm)
  })

  it('disables shared export for a legacy archive without an account identity', () => {
    const archives = createArchives()
    const legacy = archives[0]!
    delete legacy.source.accountMid
    renderArchivePanel({ archives })

    fireEvent.click(screen.getByRole('button', { name: new RegExp(legacy.source.title) }))

    fireEvent.click(screen.getByRole('tab', { name: /无时间线文稿/ }))
    expect(within(screen.getByRole('tabpanel')).getByRole('button', { name: '导出' })).toBeDisabled()
    expect(within(screen.getByRole('tabpanel')).getByRole('button', { name: '导出' })).toHaveAttribute('title', '此历史档案缺少账号标识，无法安全导出文稿。')
  })

  it('uses the shared batch dialog with identity-only current content, both formats, and available notes included', async () => {
    const previewVideoNoteArchiveBatch = vi.fn().mockResolvedValue({ selectedCount: 1, exportableCount: 1, skippedCount: 0 })
    window.bilimiDesktop = {
      previewVideoNoteArchiveBatch, startVideoNoteArchiveBatch: vi.fn(), cancelVideoNoteArchiveBatch: vi.fn(), openVideoNoteArchiveBatchFolder: vi.fn(), onVideoNoteArchiveBatchProgress: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop
    renderArchivePanel()
    fireEvent.click(screen.getByRole('button', { name: /机器学习入门/ }))
    fireEvent.click(screen.getByRole('tab', { name: /无时间线文稿/ }))
    fireEvent.click(within(screen.getByRole('tabpanel')).getByRole('button', { name: '导出' }))

    const dialog = await screen.findByRole('dialog', { name: '导出文稿' })
    expect(within(dialog).getByLabelText('单项内容')).toBeChecked()
    expect(within(dialog).getByLabelText('Markdown')).toBeChecked()
    expect(within(dialog).getByLabelText('Word')).not.toBeChecked()
    expect(within(dialog).getByLabelText('包含备注')).toBeChecked()
    fireEvent.click(within(dialog).getByLabelText('Word'))
    await waitFor(() => expect(previewVideoNoteArchiveBatch).toHaveBeenLastCalledWith(expect.objectContaining({
      accountMid: '100', selections: [{ archiveId: 'bvid:BV1note', versionId: 'bvid:BV1note:version:2026-06-17T01:00:00.000Z' }], formats: ['markdown', 'word'], scope: 'current', currentContent: 'plain', includeNotes: true
    })))
  })

  it('immediately hides an open export dialog when the archive account changes', async () => {
    window.bilimiDesktop = {
      previewVideoNoteArchiveBatch: vi.fn().mockResolvedValue({ selectedCount: 1, exportableCount: 1, skippedCount: 0 }),
      startVideoNoteArchiveBatch: vi.fn(), cancelVideoNoteArchiveBatch: vi.fn(), openVideoNoteArchiveBatchFolder: vi.fn(), onVideoNoteArchiveBatchProgress: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop
    const view = renderArchivePanel({ accountMid: '100' })
    fireEvent.click(screen.getByRole('button', { name: /机器学习入门/ }))
    fireEvent.click(screen.getByRole('tab', { name: /无时间线文稿/ }))
    fireEvent.click(within(screen.getByRole('tabpanel')).getByRole('button', { name: '导出' }))
    expect(await screen.findByRole('dialog', { name: '导出文稿' })).toBeInTheDocument()

    view.rerender(<VideoNoteArchivePanel
      archives={createArchives()}
      accountMid="200"
      onClose={vi.fn()}
      onOpenSource={vi.fn()}
      onUpdateVersion={vi.fn()}
      onDeleteEntry={vi.fn()}
      onDeleteVersion={vi.fn()}
    />)

    expect(screen.queryByRole('dialog', { name: '导出文稿' })).not.toBeInTheDocument()
  })

  it('moves complete-archive export into the more-actions menu', async () => {
    const previewVideoNoteArchiveBatch = vi.fn().mockResolvedValue({ selectedCount: 1, exportableCount: 1, skippedCount: 0 })
    window.bilimiDesktop = {
      previewVideoNoteArchiveBatch, startVideoNoteArchiveBatch: vi.fn(), cancelVideoNoteArchiveBatch: vi.fn(), openVideoNoteArchiveBatchFolder: vi.fn(), onVideoNoteArchiveBatchProgress: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop
    renderArchivePanel({ accountMid: '100' })
    fireEvent.click(screen.getByRole('button', { name: /机器学习入门/ }))
    fireEvent.click(screen.getByRole('button', { name: '更多档案操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '导出完整档案' }))

    await waitFor(() => expect(previewVideoNoteArchiveBatch).toHaveBeenLastCalledWith(expect.objectContaining({
      accountMid: '100', scope: 'complete', selections: [{ archiveId: 'bvid:BV1note', versionId: 'bvid:BV1note:version:2026-06-17T01:00:00.000Z' }]
    })))
  })

  it('keeps the clicked archive version identity when the version picker changes behind an open download dialog', async () => {
    const previewVideoNoteArchiveBatch = vi.fn().mockResolvedValue({ selectedCount: 1, exportableCount: 1, skippedCount: 0 })
    window.bilimiDesktop = {
      previewVideoNoteArchiveBatch, startVideoNoteArchiveBatch: vi.fn(), cancelVideoNoteArchiveBatch: vi.fn(), openVideoNoteArchiveBatchFolder: vi.fn(), onVideoNoteArchiveBatchProgress: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop
    renderArchivePanel({ accountMid: '100' })
    fireEvent.click(screen.getByRole('button', { name: /机器学习入门/ }))
    fireEvent.click(screen.getByRole('tab', { name: /无时间线文稿/ }))
    fireEvent.click(within(screen.getByRole('tabpanel')).getByRole('button', { name: '导出' }))
    await screen.findByRole('dialog', { name: '导出文稿' })
    fireEvent.change(screen.getByLabelText('历史版本'), { target: { value: 'bvid:BV1note:version:2026-06-17T00:00:00.000Z' } })

    await waitFor(() => expect(previewVideoNoteArchiveBatch).toHaveBeenLastCalledWith(expect.objectContaining({
      selections: [{ archiveId: 'bvid:BV1note', versionId: 'bvid:BV1note:version:2026-06-17T01:00:00.000Z' }]
    })))
  })

  it('seeks the archived video part only from valid timeline timestamps', () => {
    const onSeekSource = vi.fn()
    const archives = createArchives()
    const archive = archives.find((entry) => entry.id === 'bvid:BV1note')!
    const version = archive.versions.at(-1)!
    version.note.transcript.push({ start: null, end: null, text: '无有效时间点。' })

    renderArchivePanel({ archives, onSeekSource })

    fireEvent.click(screen.getByRole('button', { name: /机器学习入门/ }))
    fireEvent.click(screen.getByRole('tab', { name: /带时间线文稿/ }))

    fireEvent.click(screen.getByRole('button', { name: '00:03' }))

    expect(onSeekSource).toHaveBeenCalledWith(
      expect.objectContaining({ bvid: 'BV1note' }),
      3
    )
    expect(screen.queryByRole('button', { name: '--:--' })).not.toBeInTheDocument()
    expect(screen.getByText('--:--')).toBeInTheDocument()
  })
})
