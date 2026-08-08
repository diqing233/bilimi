import type { ComponentProps } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { NotePosterSummary, VideoAudioTranscriptionQueueSnapshot, VideoNote } from '@shared/types'
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
    highlights: [{ start: 75, title: '核心提示', detail: '训练数据决定模型上限。' }]
  },
  annotations: [],
  userMemo: '',
  createdAt: '2026-04-28T00:00:00.000Z',
  updatedAt: '2026-04-28T00:00:00.000Z'
}

function renderPanel(props: Partial<ComponentProps<typeof VideoNotesPanel>> = {}): ReturnType<typeof render> {
  return render(
    <VideoNotesPanel
      note={sampleNote}
      isLoading={false}
      onGenerate={vi.fn()}
      onSave={vi.fn()}
      {...props}
    />
  )
}

describe('VideoNotesPanel', () => {
  it('keeps a queued video selected over the current page and never borrows its author', () => {
    renderPanel({
      accountMid: '100',
      currentVideoTitle: '另一个当前网页视频',
      currentVideoAuthor: '不应串入的 UP 主',
      transcriptionQueue: {
        sessionCompletedCount: 0,
        items: [{
          id: 'pending-queue', accountMid: '100', bvid: 'BV1queued',
          url: 'https://www.bilibili.com/video/BV1queued', title: '队列中的视频', status: 'pending',
          createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:01:00.000Z'
        }]
      }
    })

    const details = screen.getByRole('region', { name: '当前视频详情' })
    expect(details).toHaveTextContent('队列中的视频')
    expect(details).toHaveTextContent('UP主')
    expect(details).toHaveTextContent('待转写后补齐')
    expect(details).not.toHaveTextContent('不应串入的 UP 主')
    expect(details).not.toHaveTextContent('BV')
  })

  it('opens the selected completed queue item directly in the plain transcript', () => {
    const archived = { ...sampleNote, source: { ...sampleNote.source, accountMid: '100', aid: 7, cid: 70 }, transcript: [{ start: 0, end: 2, text: '队列正文。' }, { start: 4, end: 6, text: '第二段。' }] }
    renderPanel({
      accountMid: '100', note: null,
      archivedNotes: [{ id: 'archive-queue', source: archived.source, versions: [{ id: 'version-queue', note: archived, plainTranscript: '队列正文。\n\n第二段。', summaryText: '', createdAt: archived.createdAt }], createdAt: archived.createdAt, updatedAt: archived.updatedAt }],
      transcriptionQueue: { sessionCompletedCount: 1, items: [{ id: 'completed-queue', accountMid: '100', aid: 7, cid: 70, bvid: 'BV1note', url: archived.source.url, title: archived.source.title, status: 'completed', archiveRegistrationStatus: 'registered', archiveNoteId: 'archive-queue', archiveVersionId: 'version-queue', createdAt: archived.createdAt, updatedAt: archived.updatedAt }] }
    })

    fireEvent.click(screen.getByRole('button', { name: '展开转写队列' }))
    fireEvent.click(screen.getByRole('button', { name: /排队已完成：机器学习入门/ }))

    expect(screen.getByRole('tab', { name: /无时间线文稿/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: /无时间线文稿/ })).toHaveTextContent('队列正文。')
  })

  it('does not offer a timed transcript tab for an archive that only has one timestamped block', () => {
    const archived = { ...sampleNote, source: { ...sampleNote.source, accountMid: '100', aid: 7, cid: 70 }, transcript: [{ start: 0, end: 120, text: '只有一整段。' }] }
    renderPanel({ accountMid: '100', note: archived })

    expect(screen.queryByRole('tab', { name: /带时间线文稿/ })).not.toBeInTheDocument()
  })
  it('does not offer a timed-transcript copy for an archive with one timestamped block', () => {
    const archived = { ...sampleNote, source: { ...sampleNote.source, accountMid: '100', aid: 7, cid: 70 }, transcript: [{ start: 0, end: 120, text: '只有一整段。' }] }
    renderPanel({ accountMid: '100', note: archived })

    fireEvent.click(screen.getByRole('tab', { name: /无时间线文稿/ }))
    const copyGroup = screen.getByRole('group', { name: '无时间线文稿复制' })
    fireEvent.click(within(copyGroup).getByRole('button', { name: '复制' }))

    expect(screen.getByRole('menuitem', { name: '复制带时间线文稿' })).toBeDisabled()
  })

  it('uses one copy disclosure with transcript and available DeepSeek copy choices', () => {
    renderPanel({ archivedSummaryText: '## 总结\n总结内容\n\n## 提要\n提要内容\n\n## 精修文稿\n精修内容' })

    fireEvent.click(screen.getByRole('tab', { name: /无时间线文稿/ }))
    expect(screen.queryByRole('button', { name: '复制全文' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    expect(screen.getByRole('menuitem', { name: '复制无时间线文稿' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '复制带时间线文稿' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '复制 DeepSeek 总结全文' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '仅复制精准总结' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '仅复制详细内容提要' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '仅复制精修文稿' })).toBeInTheDocument()
  })

  it('uses a neutral local-transcription prompt instead of whisper.cpp', () => {
    renderPanel({
      note: null,
      transcriptionQueue: {
        activeItemId: 'sensevoice-running',
        sessionCompletedCount: 0,
        items: [{
          id: 'sensevoice-running', accountMid: '100', aid: 7, cid: 70, bvid: 'BV1sense',
          url: 'https://www.bilibili.com/video/BV1sense', title: 'SenseVoice task', status: 'running',
          transcriptionModelId: 'sensevoice-small',
          progress: { step: 'transcribing-segment', message: 'transcribing', segmentIndex: 1, segmentCount: 4 },
          createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:00:01.000Z'
        }]
      }
    })

    expect(screen.getByText('正在本地转写，CPU 占用升高是正常现象。')).toBeInTheDocument()
    expect(screen.queryByText(/whisper\.cpp 正在本地转写/)).not.toBeInTheDocument()
  })

  it('does not render an old-account queue record after the active account changes', () => {
    renderPanel({
      note: null,
      accountMid: '200',
      transcriptionQueue: {
        sessionCompletedCount: 1,
        items: [{
          id: 'account:100:aid:7:cid:70', accountMid: '100', aid: 7, cid: 70,
          url: 'https://www.bilibili.com/video/BV1old', title: 'Old account video', bvid: 'BV1old',
          status: 'completed', archiveRegistrationStatus: 'registered', archiveNoteId: 'bvid:BV1old', archiveVersionId: 'version-1',
          createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:01:00.000Z'
        }]
      }
    })

    expect(screen.getByRole('region', { name: '转写状态' })).toHaveTextContent('排队中：0 个')
    expect(screen.queryByText('Old account video')).not.toBeInTheDocument()
  })

  it('closes a queued document-export dialog when the Bilibili account changes', async () => {
    let onAccountChanged: (() => void) | undefined
    window.bilimiDesktop = {
      onBilibiliAccountChanged: (callback: () => void) => { onAccountChanged = callback; return () => undefined },
      previewVideoNoteArchiveBatch: vi.fn().mockResolvedValue({ selectedCount: 1, exportableCount: 1, skippedCount: 0 }),
      startVideoNoteArchiveBatch: vi.fn(), cancelVideoNoteArchiveBatch: vi.fn(), openVideoNoteArchiveBatchFolder: vi.fn(), onVideoNoteArchiveBatchProgress: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop
    renderPanel({
      note: null,
      transcriptionQueue: {
        sessionCompletedCount: 0,
        items: [{
          id: 'completed-export', url: 'https://www.bilibili.com/video/BV1export', title: '已归档视频', bvid: 'BV1export', accountMid: '100',
          status: 'completed', archiveNoteId: 'archive-1', archiveVersionId: 'version-1', createdAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-07-27T00:01:00.000Z'
        }]
      }
    })

    fireEvent.click(screen.getByRole('button', { name: '展开转写队列' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 已归档视频' }))
    const toolbar = screen.getByLabelText('队列批量操作')
    fireEvent.click(within(toolbar).getByRole('button', { name: '视频总结' }))
    fireEvent.click(within(toolbar).getByRole('menuitem', { name: '导出文稿' }))
    expect(await screen.findByRole('dialog', { name: '导出文稿' })).toBeInTheDocument()

    await act(async () => { onAccountChanged?.() })

    expect(screen.queryByRole('dialog', { name: '导出文稿' })).not.toBeInTheDocument()
  })

  it('closes a current-content export dialog when the account prop changes without a desktop event', async () => {
    const archivedNote = { ...sampleNote, source: { ...sampleNote.source, accountMid: '100', aid: 7, cid: 70 } }
    window.bilimiDesktop = {
      previewVideoNoteArchiveBatch: vi.fn().mockResolvedValue({ selectedCount: 1, exportableCount: 1, skippedCount: 0 }),
      startVideoNoteArchiveBatch: vi.fn(), cancelVideoNoteArchiveBatch: vi.fn(), openVideoNoteArchiveBatchFolder: vi.fn(), onVideoNoteArchiveBatchProgress: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop
    const view = renderPanel({
      accountMid: '100', note: archivedNote,
      archivedNotes: [{ id: 'archive-current', source: archivedNote.source, versions: [{ id: 'version-current', note: archivedNote, plainTranscript: '已归档文稿', summaryText: '', createdAt: archivedNote.createdAt }], createdAt: archivedNote.createdAt, updatedAt: archivedNote.updatedAt }]
    })
    fireEvent.click(screen.getByRole('tab', { name: /无时间线文稿/ }))
    fireEvent.click(within(screen.getByRole('tabpanel')).getByRole('button', { name: '导出' }))
    expect(await screen.findByRole('dialog', { name: '导出文稿' })).toBeInTheDocument()

    view.rerender(<VideoNotesPanel note={archivedNote} accountMid="200" isLoading={false} onGenerate={vi.fn()} onSave={vi.fn()} archivedNotes={[]} />)
    expect(screen.queryByRole('dialog', { name: '导出文稿' })).not.toBeInTheDocument()
  })

  it('puts archive guidance inside the primary action buttons', () => {
    const { container } = renderPanel({ note: null, onTranscribeAudio: vi.fn(), onOpenArchive: vi.fn() })

    expect(screen.queryByText('转写完成后保存到全局档案库。')).not.toBeInTheDocument()
    expect(screen.queryByText('生成与归档')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '转写音频' })).toHaveTextContent(
      '一键转写视频音频，生成文稿自动保存在档案库'
    )
    expect(screen.getByRole('button', { name: '档案库' })).toHaveTextContent(
      '打开档案库，可查看或备注视频文稿'
    )
    expect(
      Array.from(container.querySelectorAll('.assistant-action-button__icon strong')).map(
        (badge) => badge.textContent
      )
    ).toEqual(['转', '库'])
    expect(screen.getByRole('img', { name: '小咪转写音频' })).toHaveClass(
      'assistant-action-button__pet'
    )
    expect(screen.getByRole('img', { name: '小咪档案库' })).toHaveClass(
      'assistant-action-button__pet'
    )
  })

  it('does not expose the raw source URL in current video details', () => {
    renderPanel()

    expect(screen.queryByText('BV')).not.toBeInTheDocument()
    expect(screen.queryByText('链接')).not.toBeInTheDocument()
    expect(screen.queryByText(sampleNote.source.url)).not.toBeInTheDocument()
  })

  it('shows a concise audio-format error and keeps its diagnostic behind details', () => {
    renderPanel({
      note: null,
      transcriptionQueue: {
        sessionCompletedCount: 0,
        items: [{
          id: 'failed-format', accountMid: '100', aid: 7, cid: 70, url: 'https://www.bilibili.com/video/BV1format',
          title: '格式失败的视频', bvid: 'BV1format', status: 'failed',
          errorMessage: '音频格式转换失败', errorDetails: 'Audio preparation failed: ffmpeg exited with 1.',
          createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:00:01.000Z'
        }]
      }
    })

    fireEvent.click(screen.getByRole('button', { name: '展开转写队列' }))

    expect(screen.getByText('音频格式转换失败')).toBeInTheDocument()
    expect(screen.getByText('查看详情')).toBeInTheDocument()
    expect(screen.queryByText('Audio preparation failed: ffmpeg exited with 1.')).not.toBeVisible()
  })

  it('reads the immutable archive version pinned by a completed queue item instead of the newest version', () => {
    const pinnedVersion = { id: 'version-pinned', note: { ...sampleNote, transcript: [{ start: 0, end: 10, text: '固定版本文稿' }] }, plainTranscript: '固定版本文稿', summaryText: '已归档总结', createdAt: '2026-07-27T00:00:00.000Z' }
    const newerVersion = { id: 'version-unrelated', note: { ...sampleNote, userMemo: '其他保存', transcript: [{ start: 0, end: 10, text: '不应显示的新版文稿' }] }, plainTranscript: '不应显示的新版文稿', summaryText: '不应显示的新版总结', createdAt: '2026-07-27T01:00:00.000Z' }

    renderPanel({
      note: null,
      archivedNotes: [{ id: 'archive-1', source: sampleNote.source, versions: [pinnedVersion, newerVersion], createdAt: pinnedVersion.createdAt, updatedAt: newerVersion.createdAt }],
      transcriptionQueue: {
        sessionCompletedCount: 1,
        items: [{
          id: 'account:42:aid:7:cid:70', url: sampleNote.source.url, title: sampleNote.source.title, status: 'completed',
          archiveNoteId: 'archive-1', archiveVersionId: 'version-pinned', createdAt: pinnedVersion.createdAt, updatedAt: newerVersion.createdAt
        }]
      }
    })

    fireEvent.click(screen.getByRole('tab', { name: /无时间线文稿/ }))
    expect(screen.getByText('固定版本文稿')).toBeInTheDocument()
    expect(screen.queryByText('不应显示的新版文稿')).not.toBeInTheDocument()
  })

  it('uses audio transcription for the primary action when available', async () => {
    const onGenerate = vi.fn().mockResolvedValue(null)
    const onTranscribeAudio = vi.fn().mockResolvedValue(sampleNote)
    renderPanel({ note: null, onGenerate, onTranscribeAudio })
    fireEvent.click(screen.getByRole('button', { name: '转写音频' }))
    await waitFor(() => expect(onTranscribeAudio).toHaveBeenCalledOnce())
    expect(onGenerate).not.toHaveBeenCalled()
  })

  it('keeps transcript result panels closed after audio transcription completes until the user opens them', async () => {
    const onTranscribeAudio = vi.fn().mockResolvedValue(sampleNote)
    const { rerender } = renderPanel({ note: null, onTranscribeAudio })

    expect(screen.getByRole('tab', { name: /无时间线文稿/ })).toHaveAttribute(
      'aria-selected',
      'false'
    )
    expect(screen.queryByText('暂无文稿。点击“转写音频”开始。')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '转写音频' }))

    await waitFor(() => expect(onTranscribeAudio).toHaveBeenCalledOnce())
    rerender(
      <VideoNotesPanel
        note={sampleNote}
        isLoading={false}
        onGenerate={vi.fn()}
        onSave={vi.fn()}
        onTranscribeAudio={onTranscribeAudio}
      />
    )
    expect(screen.getByRole('tab', { name: /无时间线文稿/ })).toHaveAttribute(
      'aria-selected',
      'false'
    )
    expect(screen.queryByRole('tabpanel', { name: /无时间线文稿/ })).not.toBeInTheDocument()
  })

  it('lets users collapse transcript result tabs and keeps the panel collapsed across rerenders', () => {
    const { rerender } = renderPanel()

    fireEvent.click(screen.getByRole('tab', { name: /无时间线文稿/ }))
    expect(screen.getByRole('tabpanel', { name: /无时间线文稿/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /无时间线文稿/ }))
    expect(screen.queryByRole('tabpanel', { name: /无时间线文稿/ })).not.toBeInTheDocument()

    rerender(
      <VideoNotesPanel
        note={sampleNote}
        isLoading={false}
        onGenerate={vi.fn()}
        onSave={vi.fn()}
      />
    )

    expect(screen.queryByRole('tabpanel', { name: /无时间线文稿/ })).not.toBeInTheDocument()
  })

  it('keeps full result tab descriptions available as hover tooltips', () => {
    renderPanel()

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

  it('reports copy success outside the content card', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const onCopyFeedback = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    renderPanel({ onCopyFeedback })

    fireEvent.click(screen.getByRole('tab', { name: /无时间线文稿/ }))
    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '复制无时间线文稿' }))

    await waitFor(() => expect(onCopyFeedback).toHaveBeenCalledWith({ tone: 'success', message: '无时间线文稿已复制' }))
    expect(screen.queryByText('无时间线文稿已复制')).not.toBeInTheDocument()
  })

  it('reports copy failure outside the content card', async () => {
    const onCopyFeedback = vi.fn()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('剪贴板不可用')) }
    })
    renderPanel({ onCopyFeedback })

    fireEvent.click(screen.getByRole('tab', { name: /无时间线文稿/ }))
    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '复制无时间线文稿' }))

    await waitFor(() => expect(onCopyFeedback).toHaveBeenCalledWith({ tone: 'error', message: '剪贴板不可用' }))
    expect(screen.queryByText('剪贴板不可用')).not.toBeInTheDocument()
  })

  it('keeps enqueue feedback out of every result tab while the queue shows the running task', async () => {
    const onTranscribeAudio = vi.fn().mockResolvedValue(sampleNote)
    const onEnqueueTranscription = vi.fn().mockResolvedValue({
      activeItemId: 'bvid:BV-current',
      sessionCompletedCount: 0,
      items: [
        {
          id: 'bvid:BV-current',
          url: 'https://www.bilibili.com/video/BV-current',
          title: '当前视频',
          bvid: 'BV-current',
          status: 'running',
          createdAt: '2026-06-25T00:00:00.000Z',
          updatedAt: '2026-06-25T00:00:00.000Z'
        }
      ]
    } satisfies VideoAudioTranscriptionQueueSnapshot)

    renderPanel({
      note: null,
      currentVideoTitle: '当前视频',
      onTranscribeAudio,
      onEnqueueTranscription,
      transcriptionQueue: { sessionCompletedCount: 0, items: [] }
    })

    fireEvent.click(screen.getByRole('button', { name: '转写音频' }))

    await waitFor(() => expect(onEnqueueTranscription).toHaveBeenCalledOnce())
    expect(onTranscribeAudio).not.toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: /无时间线文稿/ })).toHaveAttribute(
      'aria-selected',
      'false'
    )
    expect(screen.queryByRole('tabpanel', { name: /无时间线文稿/ })).not.toBeInTheDocument()
    expect(screen.queryByText('「当前视频」已开始转写。')).not.toBeInTheDocument()
    for (const tabName of ['无时间线文稿', '带时间线文稿', 'DeepSeek 总结']) {
      fireEvent.click(screen.getByRole('tab', { name: new RegExp(tabName) }))
      expect(screen.queryByText('「当前视频」已开始转写。')).not.toBeInTheDocument()
    }
  })

  it('opens the shared current-content download dialog from every saved transcript panel', async () => {
    const archivedVersion = {
      id: 'version-current',
      note: { ...sampleNote, source: { ...sampleNote.source, accountMid: '100', aid: 7, cid: 70 } },
      plainTranscript: '已归档文稿',
      summaryText: '已归档总结',
      createdAt: sampleNote.createdAt
    }
    window.bilimiDesktop = {
      previewVideoNoteArchiveBatch: vi.fn().mockResolvedValue({ selectedCount: 1, exportableCount: 1, skippedCount: 0 }),
      startVideoNoteArchiveBatch: vi.fn(), cancelVideoNoteArchiveBatch: vi.fn(), openVideoNoteArchiveBatchFolder: vi.fn(), onVideoNoteArchiveBatchProgress: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop
    renderPanel({
      accountMid: '100',
      note: archivedVersion.note,
      archivedNotes: [{ id: 'archive-current', source: archivedVersion.note.source, versions: [archivedVersion], createdAt: sampleNote.createdAt, updatedAt: sampleNote.updatedAt }]
    })

    for (const tabName of ['无时间线文稿', '带时间线文稿', 'DeepSeek 总结']) {
      fireEvent.click(screen.getByRole('tab', { name: new RegExp(tabName) }))
      const panel = screen.getByRole('tabpanel')
      fireEvent.click(within(panel).getByRole('button', { name: '导出' }))
      expect(await screen.findByRole('dialog', { name: '导出文稿' })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: '关闭' }))
      fireEvent.click(screen.getByRole('tab', { name: new RegExp(tabName) }))
    }
  })

  it('opens the download dialog with Markdown selected without a format submenu', async () => {
    const archivedNote = { ...sampleNote, source: { ...sampleNote.source, accountMid: '100', aid: 7, cid: 70 } }
    const previewVideoNoteArchiveBatch = vi.fn().mockResolvedValue({ selectedCount: 1, exportableCount: 1, skippedCount: 0 })
    window.bilimiDesktop = {
      previewVideoNoteArchiveBatch,
      startVideoNoteArchiveBatch: vi.fn(), cancelVideoNoteArchiveBatch: vi.fn(), openVideoNoteArchiveBatchFolder: vi.fn(), onVideoNoteArchiveBatchProgress: vi.fn(() => () => undefined)
    } as unknown as typeof window.bilimiDesktop
    renderPanel({
      accountMid: '100',
      note: archivedNote,
      archivedNotes: [{ id: 'archive-current', source: archivedNote.source, versions: [{ id: 'version-current', note: archivedNote, plainTranscript: '已归档文稿', summaryText: '', createdAt: archivedNote.createdAt }], createdAt: archivedNote.createdAt, updatedAt: archivedNote.updatedAt }]
    })
    fireEvent.click(screen.getByRole('tab', { name: /无时间线文稿/ }))
    const panel = screen.getByRole('tabpanel')
    fireEvent.click(within(panel).getByRole('button', { name: '导出' }))
    expect(screen.queryByRole('button', { name: '无时间线文稿导出 选项' })).not.toBeInTheDocument()
    expect(await screen.findByRole('dialog', { name: '导出文稿' })).toBeInTheDocument()

    await waitFor(() => expect(previewVideoNoteArchiveBatch).toHaveBeenLastCalledWith(expect.objectContaining({
      accountMid: '100', selections: [{ archiveId: 'archive-current', versionId: 'version-current' }], formats: ['markdown'], scope: 'current', currentContent: 'plain'
    })))
    expect(previewVideoNoteArchiveBatch.mock.calls.at(-1)?.[0]).not.toHaveProperty('archive')
    expect(previewVideoNoteArchiveBatch.mock.calls.at(-1)?.[0]).not.toHaveProperty('text')
  })

  it('does not render a separate download-menu trigger', () => {
    const archivedNote = { ...sampleNote, source: { ...sampleNote.source, accountMid: '100', aid: 7, cid: 70 } }
    renderPanel({
      accountMid: '100', note: archivedNote,
      archivedNotes: [{ id: 'archive-current', source: archivedNote.source, versions: [{ id: 'version-current', note: archivedNote, plainTranscript: '已归档文稿', summaryText: '', createdAt: archivedNote.createdAt }], createdAt: archivedNote.createdAt, updatedAt: archivedNote.updatedAt }]
    })
    fireEvent.click(screen.getByRole('tab', { name: /无时间线文稿/ }))
    expect(screen.queryByRole('button', { name: '无时间线文稿导出 选项' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导出' })).toBeInTheDocument()
  })

  it('returns focus to the more-copy trigger when its menu closes with Escape', () => {
    renderPanel({ note: sampleNote })
    fireEvent.click(screen.getByRole('tab', { name: /带时间线文稿/ }))

    const moreCopy = screen.getByRole('button', { name: '复制' })
    fireEvent.click(moreCopy)
    expect(moreCopy).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(moreCopy).toHaveAttribute('aria-expanded', 'false')
    expect(moreCopy).toHaveFocus()
  })

  it('seeks the current video from an available timeline timestamp without starting another job', () => {
    const onSeekCurrentVideoTime = vi.fn()
    const onSeekSource = vi.fn()
    const onTranscribeAudio = vi.fn()
    const onGenerate = vi.fn()
    renderPanel({ onSeekCurrentVideoTime, onSeekSource, onTranscribeAudio, onGenerate })

    fireEvent.click(screen.getByRole('tab', { name: /带时间线文稿/ }))
    fireEvent.click(screen.getByRole('button', { name: '跳转到 01:15' }))

    expect(onSeekCurrentVideoTime).toHaveBeenCalledWith(75)
    expect(onSeekSource).not.toHaveBeenCalled()
    expect(onTranscribeAudio).not.toHaveBeenCalled()
    expect(onGenerate).not.toHaveBeenCalled()
  })

  it('opens the exact queued-note source for a timeline timestamp instead of seeking the current video', () => {
    const onSeekCurrentVideoTime = vi.fn()
    const onSeekSource = vi.fn()
    const queuedNote = {
      ...sampleNote,
      source: { ...sampleNote.source, title: '队列预览', bvid: 'BV1queued', aid: 8, cid: 80, url: 'https://www.bilibili.com/video/BV1queued?p=2' }
    }
    renderPanel({
      accountMid: '100', note: sampleNote, onSeekCurrentVideoTime, onSeekSource,
      transcriptionQueue: {
        sessionCompletedCount: 0,
        items: [{
          id: 'queued-preview', accountMid: '100', aid: 8, cid: 80, url: queuedNote.source.url,
          title: queuedNote.source.title, bvid: queuedNote.source.bvid, status: 'completed', draftNote: queuedNote,
          createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:01:00.000Z'
        }]
      }
    })

    fireEvent.click(screen.getByRole('tab', { name: /带时间线文稿/ }))
    fireEvent.click(screen.getByRole('button', { name: '跳转到 01:15' }))

    expect(onSeekSource).toHaveBeenCalledWith(queuedNote.source, 75)
    expect(onSeekCurrentVideoTime).not.toHaveBeenCalled()
  })

  it('locks only the transcription button while the enqueue request is pending', async () => {
    let resolveEnqueue!: (snapshot: VideoAudioTranscriptionQueueSnapshot) => void
    const onEnqueueTranscription = vi.fn(() => new Promise<VideoAudioTranscriptionQueueSnapshot>((resolve) => {
      resolveEnqueue = resolve
    }))
    const onOpenArchive = vi.fn()
    renderPanel({
      note: null,
      onTranscribeAudio: vi.fn(),
      onEnqueueTranscription,
      onOpenArchive,
      transcriptionQueue: { sessionCompletedCount: 0, items: [] }
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '转写音频' }))
    })

    expect(screen.getByRole('button', { name: '正在加入...' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '档案库' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '档案库' }))
    expect(onOpenArchive).toHaveBeenCalledOnce()

    resolveEnqueue({ sessionCompletedCount: 0, items: [] })
    await waitFor(() => expect(screen.getByRole('button', { name: '转写音频' })).toBeEnabled())
  })

  it('does not add a duplicate panel message when the queued video is canceled', async () => {
    const runningQueue: VideoAudioTranscriptionQueueSnapshot = {
      activeItemId: 'bvid:BV-current',
      sessionCompletedCount: 0,
      items: [
        {
          id: 'bvid:BV-current',
          url: 'https://www.bilibili.com/video/BV-current',
          title: '当前视频',
          bvid: 'BV-current',
          status: 'running',
          createdAt: '2026-06-25T00:00:00.000Z',
          updatedAt: '2026-06-25T00:00:00.000Z'
        }
      ]
    }
    const canceledQueue: VideoAudioTranscriptionQueueSnapshot = {
      sessionCompletedCount: 0,
      items: [
        {
          ...runningQueue.items[0],
          status: 'canceled',
          updatedAt: '2026-06-25T00:01:00.000Z'
        }
      ]
    }
    const onEnqueueTranscription = vi.fn().mockResolvedValue(runningQueue)
    const onCancelQueuedVideoAudioTranscription = vi.fn()
    const { rerender } = renderPanel({
      note: null,
      currentVideoTitle: '当前视频',
      onTranscribeAudio: vi.fn(),
      onEnqueueTranscription,
      onCancelQueuedVideoAudioTranscription,
      transcriptionQueue: { sessionCompletedCount: 0, items: [] }
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '转写音频' }))
    })

    rerender(
      <VideoNotesPanel
        note={null}
        currentVideoTitle="当前视频"
        isLoading={false}
        onGenerate={vi.fn()}
        onSave={vi.fn()}
        onTranscribeAudio={vi.fn()}
        onEnqueueTranscription={onEnqueueTranscription}
        onCancelQueuedVideoAudioTranscription={onCancelQueuedVideoAudioTranscription}
        transcriptionQueue={canceledQueue}
      />
    )

    expect(onEnqueueTranscription).toHaveBeenCalledOnce()
    expect(screen.queryByText('「当前视频」已开始转写。')).not.toBeInTheDocument()
    expect(screen.queryByText('已取消「当前视频」的转写。')).not.toBeInTheDocument()
  })

  it('uses the primary transcription action to enqueue when another video is already running', async () => {
    const onTranscribeAudio = vi.fn().mockResolvedValue(sampleNote)
    const onEnqueueTranscription = vi.fn().mockResolvedValue({
      activeItemId: 'bvid:BV-running',
      sessionCompletedCount: 0,
      items: [
        {
          id: 'bvid:BV-running',
          url: 'https://www.bilibili.com/video/BV-running',
          title: '正在跑的视频',
          bvid: 'BV-running',
          status: 'running',
          createdAt: '2026-06-25T00:00:00.000Z',
          updatedAt: '2026-06-25T00:00:00.000Z'
        },
        {
          id: 'bvid:BV-next',
          url: 'https://www.bilibili.com/video/BV-next',
          title: '当前视频',
          bvid: 'BV-next',
          status: 'pending',
          createdAt: '2026-06-25T00:01:00.000Z',
          updatedAt: '2026-06-25T00:01:00.000Z'
        }
      ]
    } satisfies VideoAudioTranscriptionQueueSnapshot)

    renderPanel({
      note: null,
      currentVideoTitle: '当前视频',
      onTranscribeAudio,
      onEnqueueTranscription,
      transcriptionQueue: {
        activeItemId: 'bvid:BV-running',
        sessionCompletedCount: 0,
        items: [
          {
            id: 'bvid:BV-running',
            url: 'https://www.bilibili.com/video/BV-running',
            title: '正在跑的视频',
            bvid: 'BV-running',
            status: 'running',
            createdAt: '2026-06-25T00:00:00.000Z',
            updatedAt: '2026-06-25T00:00:00.000Z',
            progress: {
              step: 'transcribing-segment',
              message: 'Transcribing segment 1/2.',
              segmentIndex: 1,
              segmentCount: 2
            }
          }
        ]
      }
    })

    expect(screen.queryByRole('button', { name: '加入队列' })).not.toBeInTheDocument()
    const queueStatus = screen.getByRole('region', { name: '转写状态' })
    expect(queueStatus).toHaveTextContent('正在转写：正在跑的视频')
    expect(queueStatus).toHaveTextContent('排队中：0 个')
    const queueHeader = queueStatus.querySelector('.video-notes__queue-header')
    expect(queueHeader?.children[0]).toHaveClass('video-notes__queue-summary')
    expect(queueStatus.querySelector('.video-notes__queue-current-title')?.compareDocumentPosition(queueHeader!))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING)

    fireEvent.click(screen.getByRole('button', { name: '转写音频' }))

    await waitFor(() => expect(onEnqueueTranscription).toHaveBeenCalledOnce())
    expect(onTranscribeAudio).not.toHaveBeenCalled()
    expect(screen.queryByText('正在转写「正在跑的视频」，「当前视频」已加入队列。')).not.toBeInTheDocument()
  })

  it('shows queue snapshot progress with a visual percentage', () => {
    renderPanel({
      note: null,
      onTranscribeAudio: vi.fn(),
      transcriptionQueue: {
        activeItemId: 'queue-item',
        sessionCompletedCount: 0,
        items: [{
          id: 'queue-item',
          url: 'https://www.bilibili.com/video/BV1queue',
          title: '队列视频',
          bvid: 'BV1queue',
          status: 'running',
          createdAt: '2026-07-27T00:00:00.000Z',
          updatedAt: '2026-07-27T00:00:00.000Z',
          progress: {
            step: 'transcribing-segment',
            message: 'Transcribing segment 1/2.',
            segmentIndex: 1,
            segmentCount: 2
          }
        }]
      }
    })
    expect(screen.getByText('正在转写第 1 / 2 段')).toBeInTheDocument()
    expect(screen.getByText('49%')).toBeInTheDocument()
    expect(screen.getByLabelText('转写音频到文稿生成整体进度')).toHaveAttribute('value', '49')
    expect(screen.queryByText('Transcribing segment 1/2.')).not.toBeInTheDocument()
    const queueStatus = screen.getByRole('region', { name: '转写状态' })
    const progressIndex = Array.from(queueStatus.children).findIndex((element) => element.classList.contains('video-notes__queue-progress'))
    const summaryIndex = Array.from(queueStatus.children).findIndex((element) => element.classList.contains('video-notes__queue-header'))
    expect(progressIndex).toBeLessThan(summaryIndex)
  })

  it('does not claim a DeepSeek summary completed when its archive registration failed', () => {
    renderPanel({
      note: null,
      transcriptionQueue: {
        sessionCompletedCount: 0,
        items: [{
          id: 'account:42:aid:7:cid:70',
          accountMid: '42',
          aid: 7,
          cid: 70,
          url: 'https://www.bilibili.com/video/BV1queue',
          title: '档案保存失败的视频',
          bvid: 'BV1queue',
          status: 'completed',
          summarizeWithDeepSeek: true,
          archiveRegistrationStatus: 'failed',
          archiveRegistrationError: 'Archive version could not be re-read after saving.',
          archiveSummaryText: '已生成但未保存的总结',
          createdAt: '2026-07-27T00:00:00.000Z',
          updatedAt: '2026-07-27T00:01:00.000Z'
        }]
      }
    })

    fireEvent.click(screen.getByRole('button', { name: '展开转写队列' }))

    expect(screen.getByText('文稿已生成，档案保存失败')).toBeInTheDocument()
    expect(screen.queryByText('DeepSeek 总结已完成')).not.toBeInTheDocument()
  })

  it('shows the concrete summary failure reason for a completed queue item', () => {
    renderPanel({
      note: null,
      transcriptionQueue: {
        sessionCompletedCount: 0,
        items: [{
          id: 'account:42:aid:8:cid:80',
          accountMid: '42',
          aid: 8,
          cid: 80,
          url: 'https://www.bilibili.com/video/BV1summary-failed',
          title: '总结失败的视频',
          bvid: 'BV1summary-failed',
          status: 'completed',
          summarizeWithDeepSeek: true,
          summaryStatus: 'failed',
          errorMessage: 'DeepSeek 总结内容不完整：缺少详细内容提要。',
          archiveRegistrationStatus: 'registered',
          createdAt: '2026-07-27T00:00:00.000Z',
          updatedAt: '2026-07-27T00:01:00.000Z'
        }]
      }
    })

    fireEvent.click(screen.getByRole('button', { name: '展开转写队列' }))

    expect(screen.getByText('DeepSeek 总结内容不完整：缺少详细内容提要。')).toBeInTheDocument()
  })

  it('uses the standard retry action for a failed CUDA out-of-memory queue item', () => {
    const onRetryQueuedVideoAudioTranscription = vi.fn()
    renderPanel({
      note: null,
      onTranscribeAudio: vi.fn(),
      onEnqueueTranscription: vi.fn(),
      onRetryQueuedVideoAudioTranscription,
      transcriptionQueue: {
        sessionCompletedCount: 0,
        items: [{
          id: 'bvid:BV1oom',
          url: 'https://www.bilibili.com/video/BV1oom',
          title: 'GPU 内存不足视频',
          bvid: 'BV1oom',
          status: 'failed',
          failureKind: 'cuda-oom',
          errorMessage: 'NVIDIA GPU ran out of memory during transcription.',
          createdAt: '2026-07-27T00:00:00.000Z',
          updatedAt: '2026-07-27T00:00:00.000Z'
        }]
      }
    })

    fireEvent.click(screen.getByRole('button', { name: '展开转写队列' }))
    const record = screen.getByRole('button', { name: '转写失败：GPU 内存不足视频' }).closest('.video-notes__queue-record')!
    fireEvent.click(within(record).getByRole('button', { name: '重试 GPU 内存不足视频' }))
    expect(onRetryQueuedVideoAudioTranscription).toHaveBeenCalledWith('bvid:BV1oom')
  })

  it('shows the actual runtime and visible CPU fallback feedback after queue completion', () => {
    renderPanel({
      note: null,
      onTranscribeAudio: vi.fn(),
      onEnqueueTranscription: vi.fn(),
      transcriptionQueue: {
        sessionCompletedCount: 0,
        items: [{
          id: 'bvid:BV1fallback',
          url: 'https://www.bilibili.com/video/BV1fallback',
          title: '回退视频',
          bvid: 'BV1fallback',
          status: 'completed',
          actualDevice: 'cpu',
          actualComputeType: 'int8',
          runtimeFallbackMessage: 'NVIDIA GPU initialization failed; using CPU for this transcription.',
          createdAt: '2026-07-27T00:00:00.000Z',
          updatedAt: '2026-07-27T00:01:00.000Z'
        }]
      }
    })

    fireEvent.click(screen.getByRole('button', { name: '展开转写队列' }))

    expect(screen.getByRole('status')).toHaveTextContent('实际使用：CPU（int8）')
    expect(screen.getByRole('status')).toHaveTextContent('NVIDIA GPU initialization failed; using CPU for this transcription.')
  })

  it('uses the current video author before a transcription note exists', () => {
    renderPanel({
      note: null,
      currentVideoTitle: '当前视频',
      currentVideoAuthor: '李老师讲AI',
      onTranscribeAudio: vi.fn()
    })

    expect(screen.getByText('UP主').nextElementSibling).toHaveTextContent('李老师讲AI')
  })

  it('prompts users to enable DeepSeek when opening DeepSeek summary while disabled', () => {
    const onGeneratePoster = vi.fn()
    renderPanel({ deepSeekEnabled: false, onGeneratePoster })
    fireEvent.click(screen.getByRole('tab', { name: /DeepSeek 总结/ }))
    expect(screen.getAllByText('请先到设置启用 DeepSeek 后再生成总结。').length).toBeGreaterThan(0)
    expect(onGeneratePoster).not.toHaveBeenCalled()
  })

  it('enables DeepSeek summary generation immediately after DeepSeek is turned on', () => {
    const onGeneratePoster = vi.fn()
    const { rerender } = renderPanel({ deepSeekEnabled: false, onGeneratePoster })

    fireEvent.click(screen.getByRole('tab', { name: /DeepSeek 总结/ }))
    expect(screen.getByRole('button', { name: '生成总结' })).toBeDisabled()

    rerender(
      <VideoNotesPanel
        note={sampleNote}
        isLoading={false}
        onGenerate={vi.fn()}
        onSave={vi.fn()}
        deepSeekEnabled={true}
        onGeneratePoster={onGeneratePoster}
      />
    )

    expect(screen.getByRole('button', { name: '生成总结' })).not.toBeDisabled()
    expect(screen.getByText('请点击生成总结，让 DeepSeek 基于文稿生成精准总结。')).toBeInTheDocument()
  })

  it('disables summary generation while an external DeepSeek summary task is running', () => {
    const onGeneratePoster = vi.fn()
    const { rerender } = renderPanel({
      deepSeekEnabled: true,
      deepSeekSummaryGenerating: true,
      onGeneratePoster
    })

    fireEvent.click(screen.getByRole('tab', { name: /DeepSeek 总结/ }))

    const generateButton = screen.getByRole('button', { name: '生成中...' })
    expect(generateButton).toBeDisabled()
    fireEvent.click(generateButton)
    expect(onGeneratePoster).not.toHaveBeenCalled()

    rerender(
      <VideoNotesPanel
        note={sampleNote}
        isLoading={false}
        onGenerate={vi.fn()}
        onSave={vi.fn()}
        deepSeekEnabled={true}
        deepSeekSummaryGenerating={false}
        onGeneratePoster={onGeneratePoster}
      />
    )

    expect(screen.getByRole('button', { name: '生成总结' })).not.toBeDisabled()
  })

  it('restores summary generation after a failed request without rendering an in-panel error', async () => {
    const onGeneratePoster = vi.fn().mockRejectedValue(new Error('DeepSeek unavailable.'))
    renderPanel({ deepSeekEnabled: true, onGeneratePoster })
    fireEvent.click(screen.getByRole('tab', { name: /DeepSeek 总结/ }))

    fireEvent.click(screen.getByRole('button', { name: '生成总结' }))

    await waitFor(() => expect(onGeneratePoster).toHaveBeenCalledOnce())
    expect(screen.queryByText('DeepSeek unavailable.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '生成总结' })).not.toBeDisabled()
  })

  it('generates DeepSeek summary from an explicit current-note action', async () => {
    const poster: NotePosterSummary = {
      title: 'Learning Machine Models',
      subtitle: 'Compact study poster',
      keyPoints: ['Data quality matters', 'Models need examples'],
      keywords: ['AI', 'notes'],
      prompt: '',
      polishedTranscriptText: '## 精修文稿\n\n先介绍机器学习的基本概念。',
      detailedOutline: ['先说明训练数据。', '结论是数据质量影响模型。'],
      reviewItems: [{ text: 'X200', reason: '型号读音不确定' }]
    }
    const onGeneratePoster = vi.fn().mockResolvedValue(poster)
    const onArchivePosterSummary = vi.fn().mockResolvedValue(undefined)
    renderPanel({ deepSeekEnabled: true, onGeneratePoster, onArchivePosterSummary })
    fireEvent.click(screen.getByRole('tab', { name: /DeepSeek 总结/ }))
    expect(onGeneratePoster).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /点击总结/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /自动总结/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '生成总结' }))
    await waitFor(() => expect(onGeneratePoster).toHaveBeenCalledWith(sampleNote))
    expect(onArchivePosterSummary).toHaveBeenCalledWith(sampleNote, poster)
    expect(await screen.findByRole('button', { name: '重新总结' })).toBeInTheDocument()
    const summaryRegion = await screen.findByRole('region', { name: 'DeepSeek 总结' })
    expect(summaryRegion).toHaveClass('video-notes__summary-result')
    expect(summaryRegion).toHaveTextContent('Learning Machine Models')
    expect(screen.getByText('Data quality matters')).toBeInTheDocument()
    expect(screen.getByText('精修文稿')).toBeInTheDocument()
    expect(screen.getByText('先介绍机器学习的基本概念。')).toBeInTheDocument()
    expect(screen.getByText('详细内容提要')).toBeInTheDocument()
    expect(screen.queryByText(/待人工确认/)).not.toBeInTheDocument()
    expect(summaryRegion).not.toHaveTextContent('segment-')
    expect(summaryRegion.textContent?.indexOf('Learning Machine Models')).toBeLessThan(
      summaryRegion.textContent?.indexOf('精修文稿') ?? -1
    )
  })

  it('does not show local draft overview as a DeepSeek summary before generation', () => {
    renderPanel({ deepSeekEnabled: true, onGeneratePoster: vi.fn() })

    fireEvent.click(screen.getByRole('tab', { name: /DeepSeek 总结/ }))

    expect(screen.getByRole('button', { name: '生成总结' })).toBeInTheDocument()
    expect(screen.queryByText('三分钟讲清机器学习的基本思路。')).not.toBeInTheDocument()
    expect(screen.queryByText('训练数据决定模型上限。')).not.toBeInTheDocument()
    expect(screen.getByText('请点击生成总结，让 DeepSeek 基于文稿生成精准总结。')).toBeInTheDocument()
  })

  it('shows an archived DeepSeek summary without requiring a new generation', () => {
    const archivedSummaryText = [
      '## 精准总结',
      '',
      '### Archived Machine Models',
      'Data quality matters for model training.',
      '',
      '## 精修文稿',
      '',
      'Archived polished transcript.',
      '',
      '## 内容核对清单',
      '',
      '- Data point checked.'
    ].join('\n')
    renderPanel({ deepSeekEnabled: true, archivedSummaryText, onGeneratePoster: vi.fn() })

    fireEvent.click(screen.getByRole('tab', { name: /DeepSeek/ }))

    expect(screen.getByRole('region', { name: /DeepSeek/ })).toHaveTextContent(
      'Archived Machine Models'
    )
    expect(screen.getByText(/Archived polished transcript/)).toBeInTheDocument()
    expect(screen.queryByText('请点击生成总结，让 DeepSeek 基于文稿生成精准总结。')).not.toBeInTheDocument()
  })

  it('normalizes a legacy archived DeepSeek summary for display and copy without changing the saved archive', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const archivedSummaryText = [
      '## 精准总结', '', '旧总结仍在。', '',
      '## 内容核对清单', '', '- 旧档案细节。', '',
      '精修记录：', '- segment-1：甲 → 乙', '',
      '## 精修文稿', '', '旧精修文稿。', '',
      '## 待人工确认（1）', '', '- segment-2：X200 型号（读音不确定）'
    ].join('\n')
    renderPanel({ deepSeekEnabled: true, archivedSummaryText, onGeneratePoster: vi.fn() })

    fireEvent.click(screen.getByRole('tab', { name: /DeepSeek/ }))

    const summary = screen.getByRole('region', { name: /DeepSeek/ })
    expect(summary).toHaveTextContent('详细内容提要')
    expect(summary).toHaveTextContent('待人工确认')
    expect(summary).not.toHaveTextContent('内容核对清单')
    expect(summary).not.toHaveTextContent('精修记录')
    expect(summary).not.toHaveTextContent('segment-')

    fireEvent.click(within(screen.getByRole('group', { name: 'DeepSeek 复制' })).getByRole('button', { name: '复制' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '复制 DeepSeek 总结全文' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.not.stringContaining('segment-')))
    expect(archivedSummaryText).toContain('内容核对清单')
    expect(archivedSummaryText).toContain('精修记录')
  })

  it('reuses the generated DeepSeek summary when the summary tab is reopened', async () => {
    const poster: NotePosterSummary = {
      title: 'Learning Machine Models',
      subtitle: 'Compact study poster',
      keyPoints: ['Data quality matters'],
      keywords: ['AI'],
      prompt: 'clean poster',
      polishedTranscriptText: '## 精修文稿\n\n先介绍机器学习。',
      auditChecklistText: '- 观点：数据重要'
    }
    const onGeneratePoster = vi.fn().mockResolvedValue(poster)
    renderPanel({ deepSeekEnabled: true, onGeneratePoster })

    fireEvent.click(screen.getByRole('tab', { name: /DeepSeek 总结/ }))
    fireEvent.click(screen.getByRole('button', { name: '生成总结' }))
    expect(await screen.findByText('Learning Machine Models')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /无时间线文稿/ }))
    fireEvent.click(screen.getByRole('tab', { name: /DeepSeek 总结/ }))

    expect(onGeneratePoster).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '重新总结' })).toBeInTheDocument()
    expect(screen.getByText('Learning Machine Models')).toBeInTheDocument()
  })

  it('uses an attached triangle menu to copy polished transcript and summary separately', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const poster: NotePosterSummary = {
      title: '机器学习入门',
      subtitle: '整体主旨：用数据和模型解释机器学习。',
      keyPoints: ['核心内容：训练数据影响模型表现。'],
      keywords: ['机器学习', '训练数据'],
      prompt: 'clean poster',
      polishedTranscriptText: '## 精修文稿\n\n先介绍机器学习的基本概念。',
      auditChecklistText: '- 数据：训练数据'
    }
    const onGeneratePoster = vi.fn().mockResolvedValue(poster)
    renderPanel({ deepSeekEnabled: true, onGeneratePoster })

    fireEvent.click(screen.getByRole('tab', { name: /DeepSeek 总结/ }))
    fireEvent.click(screen.getByRole('button', { name: '生成总结' }))
    expect(await screen.findByText('机器学习入门')).toBeInTheDocument()

    const splitButton = screen.getByRole('group', { name: 'DeepSeek 复制' })
    expect(within(splitButton).getByRole('button', { name: '复制' })).toBeInTheDocument()
    expect(within(splitButton).queryByRole('combobox', { name: '复制' })).not.toBeInTheDocument()
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
          '- 核心内容：训练数据影响模型表现。'
        ].join('\n')
      )
    )
  })

  it('does not start audio transcription from DeepSeek summary when no note exists', async () => {
    const onTranscribeAudio = vi.fn().mockResolvedValue(sampleNote)
    const onGeneratePoster = vi.fn()
    renderPanel({ note: null, deepSeekEnabled: true, onTranscribeAudio, onGeneratePoster })
    fireEvent.click(screen.getAllByRole('tab')[2])
    expect(screen.getAllByText('请先转写音频，再生成 DeepSeek 总结。').length).toBeGreaterThan(0)
    expect(onTranscribeAudio).not.toHaveBeenCalled()
    expect(onGeneratePoster).not.toHaveBeenCalled()
  })

  it('requests automatic DeepSeek summary when enabled in settings before transcribing', async () => {
    const onTranscribeAudio = vi.fn().mockResolvedValue(sampleNote)
    renderPanel({
      note: null,
      deepSeekEnabled: true,
      deepSeekAutoSummaryEnabled: true,
      onTranscribeAudio
    })

    fireEvent.click(screen.getByRole('tab', { name: /DeepSeek/ }))
    expect(screen.getByRole('button', { name: '生成总结' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '转写音频' }))

    await waitFor(() =>
      expect(onTranscribeAudio).toHaveBeenCalledWith({ summarizeWithDeepSeek: true })
    )
  })

  it('keeps timed transcript and DeepSeek summary copy actions to top-right copy buttons', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    renderPanel()
    fireEvent.click(screen.getByRole('tab', { name: /带时间线文稿/ }))
    expect(screen.getByText('00:00')).toBeInTheDocument()
    expect(screen.getByText('先介绍机器学习的基本概念。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '复制带时间线文稿' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('[00:00] 先介绍机器学习的基本概念。')))
    fireEvent.click(screen.getByRole('tab', { name: /DeepSeek 总结/ }))
    expect(screen.getByRole('button', { name: '复制' })).toBeInTheDocument()
  })

  it('does not render obsolete annotation, memo, markdown, or image export controls', () => {
    renderPanel({ deepSeekEnabled: true })
    expect(screen.queryByRole('button', { name: '取当前时间' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('批注标题')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存批注' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('本地备注')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Markdown/)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Save image' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generate one-image summary' })).not.toBeInTheDocument()
  })
})
