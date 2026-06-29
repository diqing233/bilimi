import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import type {
  AssistantAutomationResult,
  AssistantPreferences,
  FavoriteLedgerStatus,
  VideoNote,
  VideoNoteArchiveEntry
} from '@shared/types'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FloatingAssistantApp } from './FloatingAssistantApp'
import type { AssistantSnapshot } from './assistantRuntimeTypes'
import type { FavoriteLedgerPreview } from '../favorites/favoriteLedgerPreview'

function createPreferences(overrides: Partial<AssistantPreferences> = {}): AssistantPreferences {
  return {
    favoritesFolderName: 'Bilimi 内库',
    favoriteLedgers: createDefaultFavoriteLedgers(),
    ledgerPromptDismissed: true,
    preferenceCounts: {},
    petStyle: 'big-head',
    petHoverShortcuts: ['like', 'coin', 'assistant', 'transcribe'],
    hidePetDuringVideoFullscreen: false,
    bilibiliOperationMode: 'api-assisted',
    favoriteArchiveMultiMode: 'off',
    defaultCoinCount: 1,
    commentSubmitMode: 'random',
    deepseekEnabled: false,
    deepseekApiKeyStored: false,
    deepseekCommentEnabled: false,
    deepseekAutoSummaryEnabled: false,
    deepseekPetChatEnabled: false,
    deepseekModel: 'deepseek-v4-flash',
    deepseekBaseUrl: 'https://api.deepseek.com',
    ...overrides
  }
}

function createSnapshot(overrides: Partial<AssistantSnapshot> = {}): AssistantSnapshot {
  const preferences = overrides.preferences ?? createPreferences()

  return {
    preferences,
    favoriteLedgerStatus: {
      ok: true,
      ledgers: createDefaultFavoriteLedgers(),
      missingLedgerIds: [],
      message: '册目查验已毕。'
    },
    videoContentContext: {
      title: '三分钟讲清机器学习科普教程',
      author: '李老师讲AI',
      pageText: '从原理到入门路线，适合学习收藏。'
    },
    videoTitle: '三分钟讲清机器学习科普教程',
    activeTabUrl: 'https://www.bilibili.com/video/BV1note',
    ...overrides
  }
}

function createResult(message = '已代批。'): AssistantAutomationResult {
  return {
    ok: true,
    steps: ['assistant:run'],
    missingTargets: [],
    message
  }
}

function createVideoNote(): VideoNote {
  return {
    id: 'bvid:BV1note',
    source: {
      title: '机器学习入门教程',
      tags: ['教程'],
      bvid: 'BV1note',
      url: 'https://www.bilibili.com/video/BV1note'
    },
    transcriptSource: 'auto',
    transcript: [{ start: 0, end: 8, text: '机器学习需要数据和模型。' }],
    chapters: [],
    overview: {
      shortSummary: ['机器学习需要数据和模型。'],
      keywords: ['机器学习'],
      timeline: [{ start: 0, title: '开场', detail: '机器学习需要数据和模型。' }],
      highlights: []
    },
    annotations: [],
    userMemo: '',
    createdAt: '2026-05-16T00:00:00.000Z',
    updatedAt: '2026-05-16T00:00:00.000Z'
  }
}

function installDesktopApi(overrides: Partial<Window['bilimiDesktop']> = {}) {
  const requestAssistantSnapshot = vi.fn().mockResolvedValue(createSnapshot())
  const runAssistantAction = vi.fn().mockResolvedValue(createResult('动作已完成。'))
  const generateVideoNote = vi.fn().mockResolvedValue(null)
  const generateVideoNoteFromAudio = vi.fn().mockResolvedValue(null)
  const generateDeepSeek = vi.fn().mockImplementation(async (request) =>
    request.kind === 'note-poster'
      ? {
          kind: 'note-poster',
          poster: {
            title: 'Learning Machine Models',
            subtitle: 'Compact study poster',
            keyPoints: ['Data quality matters'],
            keywords: ['AI'],
            prompt: 'clean poster',
            polishedTranscriptText: '## 精修文稿\n\n机器学习需要数据和模型。',
            auditChecklistText: '- 数据：数据和模型\n- 结论：数据质量重要'
          }
        }
      : {
          kind: 'review-comment',
          comments: ['AI comment one', 'AI comment two', 'AI comment three']
        }
  )
  const saveVideoNote = vi.fn().mockResolvedValue([])
  const saveVideoNoteArchiveVersion = vi.fn().mockResolvedValue([])
  const loadVideoNoteArchives = vi.fn().mockResolvedValue([])
  const loadVideoAudioTranscriptionQueue = vi.fn().mockResolvedValue({ items: [] })
  const enqueueCurrentVideoAudioTranscription = vi.fn().mockResolvedValue({
    activeItemId: 'bvid:BV1note',
    items: [
      {
        id: 'bvid:BV1note',
        url: 'https://www.bilibili.com/video/BV1note',
        title: '机器学习入门教程',
        bvid: 'BV1note',
        status: 'running',
        createdAt: '2026-06-25T00:00:00.000Z',
        updatedAt: '2026-06-25T00:00:00.000Z'
      }
    ]
  })
  const onVideoAudioTranscriptionQueueChanged = vi.fn((_callback) => vi.fn())
  const deleteVideoNoteArchiveEntry = vi.fn().mockResolvedValue([])
  const deleteVideoNoteArchiveVersion = vi.fn().mockResolvedValue([])
  const saveDeepSeekApiKey = vi.fn().mockResolvedValue({ configured: true })
  const clearDeepSeekApiKey = vi.fn().mockResolvedValue({ configured: false })
  const testDeepSeekConnection = vi.fn().mockResolvedValue({
    ok: true,
    message: 'DeepSeek connection succeeded.'
  })
  const loadOpenAiApiKeyStatus = vi.fn().mockResolvedValue({ configured: true })
  const saveOpenAiApiKey = vi.fn().mockResolvedValue({ configured: true })
  const clearOpenAiApiKey = vi.fn().mockResolvedValue({ configured: false })
  const ensureFavoriteLedgers = vi.fn().mockResolvedValue(createResult('册目已备齐。'))
  const saveFavoriteLedgers = vi.fn().mockResolvedValue(createResult('掌库已同步。'))
  const scanOldFavorites = vi.fn().mockResolvedValue({
    items: [],
    skippedSourceFolderTitles: []
  })
  const onAssistantSnapshotChanged = vi.fn()
  const executeOldFavoritePlan = vi.fn().mockResolvedValue(createResult('旧藏已归册。'))
  const savePreferences = vi.fn().mockImplementation(async (preferences: AssistantPreferences) => preferences)
  const closeFloatingAssistant = vi.fn()
  const closeAssistantPet = vi.fn()
  const wakeAssistantPet = vi.fn().mockResolvedValue(undefined)
  const setAssistantPetHint = vi.fn()
  const api = {
    version: '0.1.0',
    closeAssistantPet,
    closeFloatingAssistant,
    ensureFavoriteLedgers,
    executeOldFavoritePlan,
    generateDeepSeek,
    generateVideoNote,
    generateVideoNoteFromAudio,
    saveDeepSeekApiKey,
    clearDeepSeekApiKey,
    testDeepSeekConnection,
    loadOpenAiApiKeyStatus,
    loadPreferences: vi.fn(),
    onAssistantSnapshotChanged,
    requestAssistantSnapshot,
    runAssistantAction,
    saveOpenAiApiKey,
    saveFavoriteLedgers,
    savePreferences,
    saveVideoNote,
    saveVideoNoteArchiveVersion,
    loadVideoNoteArchives,
    loadVideoAudioTranscriptionQueue,
    enqueueCurrentVideoAudioTranscription,
    onVideoAudioTranscriptionQueueChanged,
    deleteVideoNoteArchiveEntry,
    deleteVideoNoteArchiveVersion,
    scanOldFavorites,
    setAssistantPetHint,
    wakeAssistantPet,
    clearOpenAiApiKey,
    ...overrides
  } satisfies Partial<Window['bilimiDesktop']>

  Object.defineProperty(window, 'bilimiDesktop', {
    configurable: true,
    value: api
  })

  return api
}

describe('FloatingAssistantApp', () => {
  it('responds to pet workspace requests inside the floating assistant window', async () => {
    let openWorkspace: Parameters<
      NonNullable<Window['bilimiDesktop']['onOpenFloatingAssistantWorkspace']>
    >[0] | undefined
    installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({ preferences: createPreferences({ commentSubmitMode: 'choose' }) })
      ),
      onOpenFloatingAssistantWorkspace: vi.fn((callback) => {
        openWorkspace = callback
        return vi.fn()
      })
    })

    render(<FloatingAssistantApp />)

    expect(await screen.findByRole('tab', { name: '批阅' })).toBeInTheDocument()

    act(() => {
      openWorkspace?.({ tab: 'ledger' })
    })

    expect(screen.getByRole('tab', { name: '掌库' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('dialog', { name: '掌库' })).toBeInTheDocument()

    act(() => {
      openWorkspace?.({ tab: 'review', action: '表' })
    })

    expect(screen.getByRole('tab', { name: '批阅' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('小咪拟好三条，主人点一条就发送。')).toBeInTheDocument()
  })

  it('opens the note archive when a pet workspace request asks for 库', async () => {
    let openWorkspace: Parameters<
      NonNullable<Window['bilimiDesktop']['onOpenFloatingAssistantWorkspace']>
    >[0] | undefined
    const note = createVideoNote()
    const loadVideoNoteArchives = vi.fn().mockResolvedValue([
      {
        id: note.id,
        source: note.source,
        versions: [
          {
            id: `${note.id}:v1`,
            note,
            plainTranscript: '机器学习需要数据和模型。',
            timedTranscript: '00:00 机器学习需要数据和模型。',
            summaryText: '机器学习入门',
            createdAt: note.updatedAt
          }
        ],
        createdAt: note.createdAt,
        updatedAt: note.updatedAt
      }
    ])
    installDesktopApi({
      loadVideoNoteArchives,
      onOpenFloatingAssistantWorkspace: vi.fn((callback) => {
        openWorkspace = callback
        return vi.fn()
      })
    })

    render(<FloatingAssistantApp />)

    expect(await screen.findByRole('tab', { name: '批阅' })).toBeInTheDocument()

    act(() => {
      openWorkspace?.({ tab: 'notes', openNoteArchive: true })
    })

    expect(await screen.findByRole('region', { name: '全局档案库' })).toBeInTheDocument()
    expect(loadVideoNoteArchives).toHaveBeenCalled()
    expect(screen.getAllByText('机器学习入门教程').length).toBeGreaterThan(0)
  })

  it('keeps the floating assistant fold button available across workspace tabs', async () => {
    const api = installDesktopApi()

    render(<FloatingAssistantApp />)

    expect(await screen.findByRole('button', { name: '合折' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '掌库' }))
    expect(screen.getByRole('button', { name: '合折' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '设置' }))
    fireEvent.click(screen.getByRole('button', { name: '合折' }))

    expect(api.closeFloatingAssistant).toHaveBeenCalledOnce()
  })

  it('renders the complete floating assistant tabs from a snapshot', async () => {
    installDesktopApi()

    render(<FloatingAssistantApp />)

    expect(await screen.findByRole('tab', { name: '批阅' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '札记' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '掌库' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '设置' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '小咪批阅' })).toHaveClass('floating-assistant-tabs__pet')
    expect(screen.getByRole('img', { name: '小咪札记' })).toHaveClass('floating-assistant-tabs__pet')
    expect(screen.getByRole('img', { name: '小咪掌库' })).toHaveClass('floating-assistant-tabs__pet')
    expect(screen.getByRole('img', { name: '小咪设置' })).toHaveClass('floating-assistant-tabs__pet')
    expect(screen.getByRole('button', { name: /赏.*轻赏此条/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /藏.*归入内库/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /赐.*投币厚赏.*一键三连/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /表.*拟奏短评.*一键弹幕/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /阅.*本条已阅/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /打开掌库/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/若欲代拟奏表/)).not.toBeInTheDocument()
    expect(await screen.findByText('三分钟讲清机器学习科普教程')).toBeInTheDocument()
  })

  it('shows clear Bilimi collection strategy copy in settings', async () => {
    installDesktopApi()

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))

    expect(screen.getByText('Bilimi 收藏策略')).toBeInTheDocument()
    expect(
      screen.getByText('说明：设置一个待分类视频最多可同时保存在几个 Bilimi 收藏夹。用户原收藏夹不会移动、删除，也不计入数量。')
    ).toBeInTheDocument()
    expect(screen.queryByText('旧收藏夹不会移动、删除，也不计入数量。')).not.toBeInTheDocument()
    expect(
      screen.getByText('最多存入 1 个 Bilimi 收藏夹，优先存入生成和自定义创建的收藏夹')
    ).toBeInTheDocument()
    expect(
      screen.getByText('最多存入 2 个 Bilimi 收藏夹，同一个视频可以存入一个默认分类和一个其他匹配的 Bilimi 收藏夹')
    ).toBeInTheDocument()
    expect(
      screen.getByText('最多存入 3 个 Bilimi 收藏夹，同一个视频可以存入一个默认分类和两个其他匹配的 Bilimi 收藏夹')
    ).toBeInTheDocument()
  })

  it('uses the configured coin count inside the floating assistant when running 赐', async () => {
    const { runAssistantAction } = installDesktopApi()

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('button', { name: /赐.*投币厚赏/ }))

    await waitFor(() =>
      expect(runAssistantAction).toHaveBeenCalledWith(
        '赐',
        expect.objectContaining({
          coinCount: 1,
          pageClickOnly: false
        })
      )
    )
    expect(screen.queryByText('陛下意欲赐几枚铜钱？')).not.toBeInTheDocument()
  })

  it('uses key-moment emotional tones while running review actions', async () => {
    const setAssistantPetHint = vi.fn()
    const { runAssistantAction } = installDesktopApi({ setAssistantPetHint })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('button', { name: /赏.*轻赏此条/ }))

    await waitFor(() =>
      expect(runAssistantAction).toHaveBeenCalledWith(
        '赏',
        expect.objectContaining({
          pageClickOnly: false
        })
      )
    )
    expect(setAssistantPetHint.mock.calls.some(([hint]) => hint?.tone === 'cheer')).toBe(true)
    expect(setAssistantPetHint.mock.calls.some(([hint]) => hint?.tone === 'done')).toBe(true)
  })

  it('shows the broad default ledger suggested by explicit page signals', async () => {
    const preferences = createPreferences()
    const runAssistantAction = vi.fn().mockResolvedValue(createResult('动作已完成。'))
    installDesktopApi({
      runAssistantAction,
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences,
          videoContentContext: {
            title: '大阪地铁自动扶梯现场音乐',
            pageText: '演奏 音乐 现场',
            tags: ['音乐现场']
          },
          videoTitle: '大阪地铁自动扶梯现场音乐'
        })
      )
    })

    render(<FloatingAssistantApp />)

    expect(await screen.findByText('音乐舞台')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /藏.*归入内库/ }))

    await waitFor(() =>
      expect(runAssistantAction).toHaveBeenCalledWith(
        '藏',
        expect.objectContaining({
          pageClickOnly: false
        })
      )
    )
  })

  it('dismisses review action feedback when switching to another workspace page', async () => {
    installDesktopApi({
      runAssistantAction: vi.fn().mockResolvedValue({
        ok: true,
        steps: ['like:already-liked'],
        missingTargets: [],
        message: 'Saved to Bilimi.'
      })
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByTestId('review-action-like'))

    expect(await screen.findByRole('status')).toHaveTextContent('Saved to Bilimi.')
    expect(screen.getByText('like:already-liked')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('tab')[1])

    expect(screen.queryByText('Saved to Bilimi.')).not.toBeInTheDocument()
    expect(screen.queryByText('like:already-liked')).not.toBeInTheDocument()
  })

  it('uses default 小咪 comments directly when DeepSeek is disabled', async () => {
    const { generateDeepSeek, runAssistantAction } = installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({ preferences: createPreferences({ commentSubmitMode: 'choose' }) })
      )
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('button', { name: /表.*拟奏短评/ }))

    expect(screen.queryByLabelText('评论方向')).not.toBeInTheDocument()
    expect(generateDeepSeek).not.toHaveBeenCalled()
    expect(screen.getByText('小咪拟好三条，主人点一条就发送。')).toBeInTheDocument()
    const choices = screen.getAllByRole('button', { name: /三分钟讲清机器学习科普教程/ })
    expect(choices).toHaveLength(3)
    expect(choices[0]).toHaveTextContent(/小咪|我家主人/)
    expect(choices[0]).toHaveTextContent('李老师讲AI')

    fireEvent.click(choices[0])

    await waitFor(() =>
      expect(runAssistantAction).toHaveBeenCalledWith(
        '表',
        expect.objectContaining({
          commentDraft: expect.stringContaining('三分钟讲清机器学习科普教程'),
          pageClickOnly: false
        })
      )
    )
  })

  it('generates AI comment drafts directly when DeepSeek is enabled', async () => {
    const preferences = createPreferences({
      deepseekEnabled: true,
      deepseekApiKeyStored: true,
      deepseekCommentEnabled: true,
      commentSubmitMode: 'choose'
    })
    const { generateDeepSeek, runAssistantAction } = installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(createSnapshot({ preferences }))
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByTestId('review-action-comment'))

    await waitFor(() =>
      expect(generateDeepSeek).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'review-comment',
          intent: '',
          author: '李老师讲AI',
          title: '三分钟讲清机器学习科普教程'
        })
      )
    )
    expect(screen.queryByLabelText('评论方向')).not.toBeInTheDocument()
    expect(await screen.findByText('AI comment one')).toBeInTheDocument()
    expect(screen.getByText('AI comment two')).toBeInTheDocument()
    expect(screen.getByText('AI comment three')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'AI comment two' }))

    await waitFor(() =>
      expect(runAssistantAction).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          commentDraft: 'AI comment two',
          pageClickOnly: false
        })
      )
    )
  })

  it('falls back to 小咪 comments when DeepSeek comment generation is unusable', async () => {
    const preferences = createPreferences({
      deepseekEnabled: true,
      deepseekApiKeyStored: true,
      deepseekCommentEnabled: true,
      commentSubmitMode: 'choose'
    })
    const { generateDeepSeek, runAssistantAction } = installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(createSnapshot({ preferences })),
      generateDeepSeek: vi.fn().mockResolvedValue({ kind: 'pet-chat', message: 'wrong shape' })
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByTestId('review-action-comment'))

    await waitFor(() => expect(generateDeepSeek).toHaveBeenCalledOnce())
    expect(screen.queryByLabelText('评论方向')).not.toBeInTheDocument()
    const choices = await screen.findAllByRole('button', {
      name: /三分钟讲清机器学习科普教程/
    })
    expect(choices).toHaveLength(3)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    fireEvent.click(choices[0])

    await waitFor(() =>
      expect(runAssistantAction).toHaveBeenCalledWith(
        '表',
        expect.objectContaining({
          commentDraft: expect.stringContaining('李老师讲AI'),
          pageClickOnly: false
        })
      )
    )
  })

  it('uses local comments when DeepSeek comments are disabled separately', async () => {
    const preferences = createPreferences({
      deepseekEnabled: true,
      deepseekApiKeyStored: true,
      deepseekCommentEnabled: false,
      commentSubmitMode: 'choose'
    })
    const { generateDeepSeek, runAssistantAction } = installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(createSnapshot({ preferences }))
    })

    render(<FloatingAssistantApp />)

    await screen.findByText('三分钟讲清机器学习科普教程')
    fireEvent.click(await screen.findByRole('button', { name: /表.*拟奏短评/ }))

    expect(generateDeepSeek).not.toHaveBeenCalled()
    expect(await screen.findByText('小咪拟好三条，主人点一条就发送。')).toBeInTheDocument()
    const choices = screen.getAllByRole('button', { name: /三分钟讲清机器学习科普教程/ })
    expect(choices).toHaveLength(3)

    fireEvent.click(choices[0])

    await waitFor(() =>
      expect(runAssistantAction).toHaveBeenCalledWith(
        '表',
        expect.objectContaining({
          commentDraft: expect.stringContaining('三分钟讲清机器学习科普教程'),
          pageClickOnly: false
        })
      )
    )
  })

  it('hides Bilibili operation mode settings while preserving the current preference', async () => {
    const preferences = createPreferences({ bilibiliOperationMode: 'page-visual' })
    const { runAssistantAction } = installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(createSnapshot({ preferences }))
    })

    render(<FloatingAssistantApp />)

    expect(await screen.findByRole('button', { name: /藏.*归入内库/ })).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: '仅页面点击' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '设置' }))

    expect(screen.queryByRole('group', { name: 'B 站操作方式' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'B 站 API 辅助' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: '纯页面 DOM/视觉操作（未完成）' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '批阅' }))
    fireEvent.click(await screen.findByRole('button', { name: /藏.*归入内库/ }))

    await waitFor(() =>
      expect(runAssistantAction).toHaveBeenCalledWith(
        '藏',
        expect.objectContaining({
          pageClickOnly: true
        })
      )
    )
  })

  it('opens ledger management inside the floating assistant workspace', async () => {
    installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue({
        ...createSnapshot(),
        favoriteLedgerStatus: {
          ok: true,
          ledgers: createDefaultFavoriteLedgers(),
          missingLedgerIds: ['knowledge'],
          message: '册目缺失。'
        } satisfies FavoriteLedgerStatus
      })
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '掌库' }))

    expect(screen.getByRole('dialog', { name: '掌库' })).toBeInTheDocument()
    expect(screen.getByText(/尚缺/)).toBeInTheDocument()
  })

  it('syncs ledger edits through the account sync bridge only after clicking 同步', async () => {
    const saveFavoriteLedgers = vi.fn().mockResolvedValue(createResult('掌库已同步。'))
    installDesktopApi({ saveFavoriteLedgers })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '掌库' }))
    fireEvent.click(screen.getByRole('button', { name: '新建收藏夹' }))
    const editor = within(screen.getByRole('region', { name: '当前收藏夹' }))
    fireEvent.change(editor.getByLabelText('册名'), { target: { value: 'Bilimi Test' } })
    fireEvent.change(editor.getByLabelText('关键词'), { target: { value: 'test video' } })

    expect(saveFavoriteLedgers).not.toHaveBeenCalled()

    fireEvent.click(editor.getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(saveFavoriteLedgers).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            displayName: 'Bilimi·Test',
            keywords: ['test', 'video'],
            isDefault: false
          })
        ])
      )
    )
  })

  it('saves the selected pet style and fullscreen pet visibility from assistant settings', async () => {
    const { closeAssistantPet, savePreferences, wakeAssistantPet } = installDesktopApi()

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Q版小人' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '全屏视频时自动收起小咪' }))
    fireEvent.click(screen.getByRole('button', { name: '唤醒宠物' }))
    fireEvent.click(screen.getByRole('button', { name: '关闭宠物' }))

    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          petStyle: 'classic'
        })
      )
    )
    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          hidePetDuringVideoFullscreen: true
        })
      )
    )
    expect(wakeAssistantPet).toHaveBeenCalledOnce()
    expect(closeAssistantPet).toHaveBeenCalledOnce()
  })

  it('saves review action behavior settings', async () => {
    const { savePreferences } = installDesktopApi()

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))

    expect(screen.getByRole('group', { name: '批阅动作设置' })).toBeInTheDocument()
    expect(screen.getByText('赐：一键三连')).toBeInTheDocument()
    expect(screen.getByText('表：发送弹幕')).toBeInTheDocument()
    expect(
      screen.getByRole('radio', {
        name: '默认投 1 枚硬币（再点一次可补投 1 枚）'
      })
    ).toBeChecked()
    expect(screen.getByRole('radio', { name: '随机生成一条并直接发送' })).toBeChecked()

    fireEvent.click(screen.getByRole('radio', { name: '默认投 2 枚硬币' }))

    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultCoinCount: 2
        })
      )
    )

    fireEvent.click(
      screen.getByRole('radio', {
        name: '生成 3 条候选，选择后发送（也可以复制后发评论）'
      })
    )

    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          commentSubmitMode: 'choose'
        })
      )
    )
  })

  it('does not refresh the assistant snapshot after saving review action settings', async () => {
    const notifyAssistantSnapshotChanged = vi.fn()
    const { savePreferences } = installDesktopApi({
      notifyAssistantSnapshotChanged
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    fireEvent.click(screen.getByRole('radio', { name: '默认投 2 枚硬币' }))

    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultCoinCount: 2
        })
      )
    )
    expect(notifyAssistantSnapshotChanged).not.toHaveBeenCalled()
  })

  it('keeps locally saved review action settings when a stale snapshot arrives after video changes', async () => {
    let snapshotChanged: (() => void) | undefined
    const requestAssistantSnapshot = vi
      .fn()
      .mockResolvedValue(createSnapshot({ preferences: createPreferences({ defaultCoinCount: 1 }) }))
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => ({
      ...preferences,
      defaultCoinCount: 2
    }))
    installDesktopApi({
      requestAssistantSnapshot,
      savePreferences,
      onAssistantSnapshotChanged: vi.fn((callback) => {
        snapshotChanged = callback
        return vi.fn()
      })
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    fireEvent.click(screen.getByRole('radio', { name: '默认投 2 枚硬币' }))

    await waitFor(() =>
      expect(screen.getByRole('radio', { name: '默认投 2 枚硬币' })).toBeChecked()
    )

    await act(async () => {
      snapshotChanged?.()
    })

    expect(await screen.findByRole('radio', { name: '默认投 2 枚硬币' })).toBeChecked()
  })

  it('opens three comment choices before 表 sends the selected draft in choose mode', async () => {
    const { runAssistantAction } = installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({ preferences: createPreferences({ commentSubmitMode: 'choose' }) })
      )
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('button', { name: /表.*拟奏短评/ }))
    expect(screen.getByText('小咪拟好三条，主人点一条就发送。')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: /三分钟讲清机器学习科普教程/ })[0])

    await waitFor(() =>
      expect(runAssistantAction).toHaveBeenCalledWith(
        '表',
        expect.objectContaining({
          submitComment: true
        })
      )
    )
  })

  it('cancels open comment choices before running a different review action', async () => {
    const { runAssistantAction } = installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({ preferences: createPreferences({ commentSubmitMode: 'choose' }) })
      )
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('button', { name: /表.*拟奏短评/ }))
    expect(screen.getByText('小咪拟好三条，主人点一条就发送。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /藏.*归入内库/ }))

    expect(screen.queryByText('小咪拟好三条，主人点一条就发送。')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(runAssistantAction).toHaveBeenCalledWith(
        '藏',
        expect.objectContaining({
          pageClickOnly: false
        })
      )
    )
  })

  it('randomly sends one draft directly when 表 is configured to random mode', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.6)
    const preferences = createPreferences({ commentSubmitMode: 'random' })
    const requestAssistantSnapshot = vi.fn().mockResolvedValue(createSnapshot({ preferences }))
    const { runAssistantAction } = installDesktopApi({
      requestAssistantSnapshot
    })

    try {
      render(<FloatingAssistantApp />)

      await waitFor(() => expect(requestAssistantSnapshot).toHaveBeenCalled())
      fireEvent.click(await screen.findByRole('button', { name: /表.*拟奏短评/ }))

      await waitFor(() =>
        expect(runAssistantAction).toHaveBeenCalledWith(
          '表',
          expect.objectContaining({
            commentDraft: expect.stringContaining('三分钟讲清机器学习科普教程'),
            submitComment: true
          })
        )
      )
      expect(screen.queryByText('小咪拟好三条，主人点一条就发送。')).not.toBeInTheDocument()
    } finally {
      randomSpy.mockRestore()
    }
  })

  it('does not generate or send 表 comments when no video is open', async () => {
    const preferences = createPreferences({
      deepseekEnabled: true,
      deepseekApiKeyStored: true,
      deepseekCommentEnabled: true,
      commentSubmitMode: 'random'
    })
    const { generateDeepSeek, runAssistantAction } = installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences,
          videoTitle: '首页',
          videoContentContext: {
            title: '首页',
            pageText: '推荐、番剧、直播和游戏中心'
          },
          activeTabUrl: 'https://www.bilibili.com/'
        })
      )
    })

    render(<FloatingAssistantApp />)

    expect(await screen.findByText('首页')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /表.*拟奏短评/ }))

    expect(generateDeepSeek).not.toHaveBeenCalled()
    expect(runAssistantAction).not.toHaveBeenCalled()
    expect(screen.queryByText('小咪拟好三条，主人点一条就发送。')).not.toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('未打开视频')
  })

  it('saves the 表 comment send strategy from settings', async () => {
    const { savePreferences } = installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({ preferences: createPreferences({ commentSubmitMode: 'choose' }) })
      )
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    fireEvent.click(screen.getByRole('radio', { name: '随机生成一条并直接发送' }))

    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          commentSubmitMode: 'random'
        })
      )
    )
    expect(screen.getByRole('radio', { name: '随机生成一条并直接发送' })).toBeChecked()
    expect(
      screen.getByRole('radio', {
        name: '生成 3 条候选，选择后发送（也可以复制后发评论）'
      })
    ).not.toBeChecked()
  })

  it('lets settings choose up to four pet hover shortcuts', async () => {
    const { savePreferences } = installDesktopApi()

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))

    expect(screen.getByText('宠物设置')).toBeInTheDocument()
    expect(screen.queryByText('宠物样式')).not.toBeInTheDocument()
    expect(screen.getByText('宠物快捷操作')).toBeInTheDocument()
    expect(
      screen.getByText('选择常用操作，数字表示显示顺序；点击可启用或停用快捷项，可不选，最多4个。')
    ).toBeInTheDocument()
    const shortcutGroup = screen.getByRole('group', { name: '宠物快捷操作' })
    expect(within(shortcutGroup).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(within(shortcutGroup).getByRole('button', { name: '赏 轻赏此条 第 1 位' })).toHaveTextContent('1')
    expect(within(shortcutGroup).getByRole('button', { name: '赐 投币厚赏 第 2 位' })).toHaveTextContent('2')
    expect(within(shortcutGroup).getByRole('button', { name: '咪 打开小咪 第 3 位' })).toHaveTextContent('3')
    expect(within(shortcutGroup).getByRole('button', { name: '转 转写音频 第 4 位' })).toHaveTextContent('4')
    expect(within(shortcutGroup).getByRole('button', { name: '藏 归入内库' })).toBeDisabled()

    fireEvent.click(within(shortcutGroup).getByRole('button', { name: '转 转写音频 第 4 位' }))

    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          petHoverShortcuts: ['like', 'coin', 'assistant']
        })
      )
    )

    fireEvent.click(within(shortcutGroup).getByRole('button', { name: '藏 归入内库' }))

    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          petHoverShortcuts: ['like', 'coin', 'assistant', 'favorite']
        })
      )
    )
  })

  it('lets settings clear every pet hover shortcut', async () => {
    const { savePreferences } = installDesktopApi()

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))

    const shortcutGroup = screen.getByRole('group', { name: '宠物快捷操作' })
    fireEvent.click(within(shortcutGroup).getByRole('button', { name: '转 转写音频 第 4 位' }))
    fireEvent.click(within(shortcutGroup).getByRole('button', { name: '咪 打开小咪 第 3 位' }))
    fireEvent.click(within(shortcutGroup).getByRole('button', { name: '赐 投币厚赏 第 2 位' }))
    fireEvent.click(within(shortcutGroup).getByRole('button', { name: '赏 轻赏此条 第 1 位' }))

    await waitFor(() =>
      expect(savePreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({
          petHoverShortcuts: []
        })
      )
    )
    expect(within(shortcutGroup).getByRole('button', { name: '赏 轻赏此条' })).not.toBeDisabled()
  })

  it('saves and tests DeepSeek assistant settings', async () => {
    const { clearDeepSeekApiKey, saveDeepSeekApiKey, savePreferences, testDeepSeekConnection } =
      installDesktopApi()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })

    render(<FloatingAssistantApp />)

    await screen.findAllByRole('tab')
    fireEvent.click(screen.getAllByRole('tab')[3])

    expect(screen.getByRole('link', { name: '官网：https://yunshulink.com/' })).toHaveAttribute(
      'href',
      'https://yunshulink.com/'
    )
    expect(screen.getByText('致谢 云枢智元')).toBeInTheDocument()
    expect(screen.getByText('大模型 Token 中转，低至官方价 2 折起')).toBeInTheDocument()
    expect(screen.getByText(/令牌分组请选择 deepseek（限时特价）/)).toBeInTheDocument()
    expect(screen.getByText('推荐模型：deepseek-v4-pro')).toBeInTheDocument()
    expect(screen.getByText('服务器地址：https://api.yunshulink.com/v1')).toBeInTheDocument()
    expect(
      screen.getByText('开启后可使用批阅的拟奏短评、札记中的 DeepSeek 总结、宠物对话功能。')
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '复制推荐模型' }))
    expect(screen.getByRole('button', { name: '复制推荐模型' })).toHaveTextContent('复制')
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('deepseek-v4-pro'))
    expect(await screen.findByRole('status')).toHaveTextContent('已复制推荐模型。')

    fireEvent.click(screen.getByRole('button', { name: '复制服务器地址' }))
    expect(screen.getByRole('button', { name: '复制服务器地址' })).toHaveTextContent('复制')
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://api.yunshulink.com/v1'))
    expect(await screen.findByRole('status')).toHaveTextContent('已复制服务器地址。')

    const enabled = screen.getByRole('checkbox', { name: '启用 DeepSeek' })
    fireEvent.click(enabled)
    expect(screen.queryByRole('checkbox', { name: '用 DeepSeek 辅助整理旧藏' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: '启用 DeepSeek 生成趣味评论' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '转写完成后自动生成 DeepSeek 总结' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '启用 DeepSeek 宠物对话功能' }))
    fireEvent.change(screen.getByLabelText('DeepSeek API 密钥'), {
      target: { value: 'sk-test' }
    })
    fireEvent.change(screen.getByLabelText('DeepSeek 模型'), {
      target: { value: 'deepseek-chat' }
    })
    fireEvent.change(screen.getByLabelText('DeepSeek 服务地址'), {
      target: { value: 'https://api.deepseek.local' }
    })

    fireEvent.click(screen.getByRole('button', { name: '保存 DeepSeek' }))

    await waitFor(() => expect(saveDeepSeekApiKey).toHaveBeenCalledWith('sk-test'))
    expect(screen.getByLabelText<HTMLInputElement>('DeepSeek API 密钥').value).toBe('sk-test')
    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          deepseekEnabled: true,
          deepseekCommentEnabled: true,
          deepseekAutoSummaryEnabled: true,
          deepseekPetChatEnabled: true,
          deepseekModel: 'deepseek-chat',
          deepseekBaseUrl: 'https://api.deepseek.local'
        })
      )
    )

    fireEvent.click(screen.getByRole('button', { name: '测试 DeepSeek' }))

    await waitFor(() => expect(saveDeepSeekApiKey).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(testDeepSeekConnection).toHaveBeenCalledOnce())
    expect(await screen.findByRole('status')).toHaveTextContent('DeepSeek 连接成功。')

    fireEvent.click(screen.getByRole('button', { name: '重置 DeepSeek' }))

    await waitFor(() => expect(clearDeepSeekApiKey).toHaveBeenCalledOnce())
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: '启用 DeepSeek' })).not.toBeChecked()
      expect(screen.getByRole('checkbox', { name: '启用 DeepSeek 生成趣味评论' })).not.toBeChecked()
      expect(screen.getByRole('checkbox', { name: '转写完成后自动生成 DeepSeek 总结' })).not.toBeChecked()
      expect(screen.getByRole('checkbox', { name: '启用 DeepSeek 宠物对话功能' })).not.toBeChecked()
    })
    expect(screen.getByLabelText<HTMLInputElement>('DeepSeek API 密钥').value).toBe('')
    expect(screen.getByLabelText<HTMLInputElement>('DeepSeek 模型').value).toBe('deepseek-v4-flash')
    expect(screen.getByLabelText<HTMLInputElement>('DeepSeek 服务地址').value).toBe(
      'https://api.deepseek.com'
    )
    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          deepseekEnabled: false,
          deepseekApiKeyStored: false,
          deepseekCommentEnabled: false,
          deepseekAutoSummaryEnabled: false,
          deepseekPetChatEnabled: false,
          deepseekModel: 'deepseek-v4-flash',
          deepseekBaseUrl: 'https://api.deepseek.com'
        })
      )
    )
    expect(await screen.findByRole('status')).toHaveTextContent('DeepSeek 设置已重置。')
  })

  it('persists the DeepSeek auto-summary toggle as soon as it changes', async () => {
    const { savePreferences } = installDesktopApi()

    render(<FloatingAssistantApp />)

    await screen.findAllByRole('tab')
    fireEvent.click(screen.getAllByRole('tab')[3])

    expect(screen.queryByRole('checkbox', { name: '用 DeepSeek 辅助整理旧藏' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: '转写完成后自动生成 DeepSeek 总结' }))

    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          deepseekAutoSummaryEnabled: true
        })
      )
    )
  })

  it('restores the saved DeepSeek auto-summary toggle from the assistant snapshot', async () => {
    installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({
            deepseekAutoSummaryEnabled: true
          })
        })
      )
    })

    render(<FloatingAssistantApp />)

    await screen.findAllByRole('tab')
    fireEvent.click(screen.getAllByRole('tab')[3])

    expect(screen.queryByRole('checkbox', { name: '用 DeepSeek 辅助整理旧藏' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '转写完成后自动生成 DeepSeek 总结' })).toBeChecked()
  })

  it('explains when the DeepSeek test bridge is not available', async () => {
    installDesktopApi({
      testDeepSeekConnection: undefined
    })

    render(<FloatingAssistantApp />)

    await screen.findAllByRole('tab')
    fireEvent.click(screen.getAllByRole('tab')[3])
    fireEvent.click(screen.getByRole('button', { name: '测试 DeepSeek' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'DeepSeek 测试功能未加载，请重启应用后再试。'
    )
  })

  it('keeps old favorite scanning alive after leaving and returning to ledger', async () => {
    let resolveScan: (preview: FavoriteLedgerPreview) => void = () => undefined
    const scanRequest = new Promise<FavoriteLedgerPreview>((resolve) => {
      resolveScan = resolve
    })
    const scanOldFavorites = vi.fn(() => scanRequest)
    installDesktopApi({ scanOldFavorites })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '掌库' }))
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))

    expect(await screen.findByRole('status')).toHaveTextContent('正在扫描旧藏，请稍候。')
    fireEvent.click(screen.getByRole('tab', { name: '批阅' }))
    expect(screen.queryByRole('region', { name: '整理旧藏向导' })).not.toBeInTheDocument()

    await act(async () => {
      resolveScan({
        items: [
          {
            aid: 101,
            title: '动画分镜教程',
            sourceFolderTitle: '默认收藏夹',
            targetLedgerId: 'movie-tv',
            targetFolderId: '9001',
            targetDisplayName: 'Bilimi·影视动漫',
            reviewRequired: false,
            alreadyInTarget: false,
            selected: true
          }
        ],
        skippedSourceFolderTitles: [],
        insights: {
          totalVideos: 1,
          topAuthors: [],
          topTags: [{ name: '动画', count: 1 }],
          topCategories: [{ name: '动画', count: 1 }],
          sourceFolders: [{ name: '默认收藏夹', count: 1 }],
          titleSeries: [],
          candidateLedgers: []
        }
      })
      await scanRequest
    })

    fireEvent.click(screen.getByRole('tab', { name: '掌库' }))

    expect(scanOldFavorites).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('region', { name: '整理旧藏向导' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    expect(screen.getByText('动画分镜教程')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('已扫描 1 条旧藏，可勾选后整理。')
  })

  it('shows preview-scoped pending classification after scanning old favorites', async () => {
    const scanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 242,
          title: '待分类旧藏',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '',
          targetDisplayName: 'Bilimi·暂存',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false
        }
      ],
      skippedSourceFolderTitles: []
    })

    installDesktopApi({ scanOldFavorites })

    const { container } = render(<FloatingAssistantApp />)

    await screen.findAllByRole('tab')
    fireEvent.click(screen.getAllByRole('tab')[2])
    expect(screen.queryByRole('region', { name: '待分类队列' })).not.toBeInTheDocument()

    fireEvent.click(container.querySelectorAll('.favorite-ledger-panel__toolbar button')[1])

    await waitFor(() => expect(scanOldFavorites).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    expect(await screen.findByRole('group', { name: '未匹配到合适分类 1 条' })).toBeInTheDocument()
    expect(screen.getByText('待分类旧藏')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '待分类队列' })).not.toBeInTheDocument()
  })

  it('keeps old favorite pet hints quiet between organization start and finish', async () => {
    const setAssistantPetHint = vi.fn()
    const executeOldFavoritePlan = vi
      .fn()
      .mockResolvedValueOnce(createResult('first item done'))
      .mockResolvedValueOnce(createResult('second item done'))
    installDesktopApi({
      executeOldFavoritePlan,
      scanOldFavorites: vi.fn().mockResolvedValue({
        items: [
          {
            aid: 101,
            title: 'old favorite with two targets',
            sourceFolderTitle: 'Default Favorites',
            targetLedgerId: 'knowledge',
            targetFolderId: '9001',
            targetDisplayName: 'Bilimi Knowledge',
            reviewRequired: false,
            alreadyInTarget: false,
            selected: true,
            targets: [
              {
                ledgerId: 'knowledge',
                folderId: '9001',
                displayName: 'Bilimi Knowledge',
                keywords: ['knowledge'],
                alreadyInTarget: false,
                selected: true
              },
              {
                ledgerId: 'movie-tv',
                folderId: '9002',
                displayName: 'Bilimi Movie',
                keywords: ['movie'],
                alreadyInTarget: false,
                selected: true
              }
            ]
          }
        ],
        skippedSourceFolderTitles: []
      }),
      setAssistantPetHint
    })

    const { container } = render(<FloatingAssistantApp />)

    await screen.findAllByRole('tab')
    fireEvent.click(screen.getAllByRole('tab')[2])
    fireEvent.click(container.querySelectorAll('.favorite-ledger-panel__toolbar button')[1])
    await waitFor(() => expect(container.querySelector('.favorite-ledger-panel__old-favorites-guide')).toBeInTheDocument())
    fireEvent.click(container.querySelectorAll('.favorite-ledger-panel__guide-steps button')[2])
    fireEvent.click(container.querySelectorAll('.favorite-ledger-panel__guide-steps button')[3])
    fireEvent.click(container.querySelector('.favorite-ledger-panel__confirm button')!)

    await waitFor(() => expect(executeOldFavoritePlan).toHaveBeenCalledTimes(2))
    expect(setAssistantPetHint.mock.calls.some(([hint]) => hint?.tone === 'working')).toBe(true)
    expect(setAssistantPetHint.mock.calls.some(([hint]) => hint?.tone === 'happy')).toBe(true)
    expect(setAssistantPetHint.mock.calls.some(([hint]) => hint?.message.includes('first item done'))).toBe(false)
    expect(setAssistantPetHint.mock.calls.some(([hint]) => hint?.message.includes('second item done'))).toBe(false)
  })

  it('refreshes the displayed video when the main window reports a snapshot change', async () => {
    let snapshotChanged: (() => void) | undefined
    const requestAssistantSnapshot = vi
      .fn()
      .mockResolvedValueOnce(createSnapshot())
      .mockResolvedValueOnce({
        ...createSnapshot(),
        videoContentContext: {
          title: '高一的笨豆，做出的视频让我惊呆了',
          pageText: '新视频页面内容。'
        },
        videoTitle: '高一的笨豆，做出的视频让我惊呆了 - 哔哩哔哩'
      } satisfies AssistantSnapshot)

    installDesktopApi({
      onAssistantSnapshotChanged: vi.fn((callback) => {
        snapshotChanged = callback
        return vi.fn()
      }),
      requestAssistantSnapshot
    })

    render(<FloatingAssistantApp />)

    expect(await screen.findByText('三分钟讲清机器学习科普教程')).toBeInTheDocument()

    snapshotChanged?.()

    expect(await screen.findByText('高一的笨豆，做出的视频让我惊呆了')).toBeInTheDocument()
    expect(requestAssistantSnapshot).toHaveBeenCalledTimes(2)
  })

  it('enqueues audio transcription through the floating assistant bridge', async () => {
    const generateVideoNoteFromAudio = vi.fn()
    const enqueueCurrentVideoAudioTranscription = vi.fn().mockResolvedValue({
      activeItemId: 'bvid:BV1note',
      items: [
        {
          id: 'bvid:BV1note',
          url: 'https://www.bilibili.com/video/BV1note',
          title: '三分钟讲清机器学习科普教程',
          bvid: 'BV1note',
          status: 'running',
          createdAt: '2026-06-25T00:00:00.000Z',
          updatedAt: '2026-06-25T00:00:00.000Z'
        }
      ]
    })
    installDesktopApi({ generateVideoNoteFromAudio, enqueueCurrentVideoAudioTranscription })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '札记' }))
    fireEvent.click(screen.getByRole('button', { name: '转写音频' }))

    await waitFor(() => expect(enqueueCurrentVideoAudioTranscription).toHaveBeenCalledOnce())
    expect(generateVideoNoteFromAudio).not.toHaveBeenCalled()
    expect(await screen.findByText('「三分钟讲清机器学习科普教程」已开始转写。')).toBeInTheDocument()
  })

  it('keeps audio transcription quiet when no video is available', async () => {
    const generateVideoNoteFromAudio = vi.fn().mockResolvedValue(null)
    const enqueueCurrentVideoAudioTranscription = vi.fn().mockResolvedValue(null)
    const setAssistantPetHint = vi.fn()
    installDesktopApi({ generateVideoNoteFromAudio, enqueueCurrentVideoAudioTranscription, setAssistantPetHint })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '札记' }))
    fireEvent.click(screen.getByRole('button', { name: '转写音频' }))

    await waitFor(() => expect(enqueueCurrentVideoAudioTranscription).toHaveBeenCalledOnce())
    expect(generateVideoNoteFromAudio).not.toHaveBeenCalled()
    expect(screen.queryByText(/打开视频/)).not.toBeInTheDocument()
    expect(
      setAssistantPetHint.mock.calls.some(([hint]) => hint?.tone === 'error')
    ).toBe(false)
  })

  it('generates notes from audio and shows transcription progress', async () => {
    let progressCallback:
      | ((progress: { step: 'transcribing-segment'; message: string; segmentIndex: number; segmentCount: number }) => void)
      | undefined
    const generateVideoNoteFromAudio = vi.fn()
    const enqueueCurrentVideoAudioTranscription = vi.fn().mockResolvedValue({
      activeItemId: 'bvid:BV1note',
      items: [
        {
          id: 'bvid:BV1note',
          url: 'https://www.bilibili.com/video/BV1note',
          title: '机器学习入门教程',
          bvid: 'BV1note',
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
    })
    installDesktopApi({
      generateVideoNoteFromAudio,
      enqueueCurrentVideoAudioTranscription,
      onVideoAudioTranscriptionProgress: vi.fn((callback) => {
        progressCallback = callback
        return vi.fn()
      })
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '札记' }))
    act(() => {
      progressCallback?.({
        step: 'transcribing-segment',
        message: 'Transcribing segment 1/2.',
        segmentIndex: 1,
        segmentCount: 2
      })
    })
    fireEvent.click(screen.getByRole('button', { name: '转写音频' }))

    await waitFor(() => expect(enqueueCurrentVideoAudioTranscription).toHaveBeenCalledOnce())
    expect(generateVideoNoteFromAudio).not.toHaveBeenCalled()
    expect(screen.getAllByText('正在转写第 1 / 2 段').length).toBeGreaterThan(0)
    expect(screen.getAllByText('49%').length).toBeGreaterThan(0)
    expect(screen.queryByText('Transcribing segment 1/2.')).not.toBeInTheDocument()
  })

  it('shows the current UP owner in the notes source panel before transcription', async () => {
    installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          videoContentContext: {
            title: 'Machine Learning Intro',
            author: 'AI Teacher',
            pageText: 'Introductory learning notes.'
          },
          videoTitle: 'Machine Learning Intro'
        })
      )
    })

    render(<FloatingAssistantApp />)

    const tabs = await screen.findAllByRole('tab')
    fireEvent.click(tabs[1])

    expect(screen.getByText('UP').nextElementSibling).toHaveTextContent('AI Teacher')
  })

  it('shows the recognized transcript while DeepSeek summary is still running', async () => {
    let queueChanged:
      | Parameters<NonNullable<Window['bilimiDesktop']['onVideoAudioTranscriptionQueueChanged']>>[0]
      | undefined
    const enqueueCurrentVideoAudioTranscription = vi.fn().mockResolvedValue({
      activeItemId: 'bvid:BV1note',
      items: [
        {
          id: 'bvid:BV1note',
          url: 'https://www.bilibili.com/video/BV1note',
          title: '机器学习入门教程',
          bvid: 'BV1note',
          status: 'running',
          createdAt: '2026-06-25T00:00:00.000Z',
          updatedAt: '2026-06-25T00:00:00.000Z'
        }
      ]
    })
    const note = createVideoNote()
    installDesktopApi({
      enqueueCurrentVideoAudioTranscription,
      onVideoAudioTranscriptionQueueChanged: vi.fn((callback) => {
        queueChanged = callback
        return vi.fn()
      })
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '札记' }))
    fireEvent.click(screen.getByRole('button', { name: '转写音频' }))
    await waitFor(() => expect(enqueueCurrentVideoAudioTranscription).toHaveBeenCalledOnce())

    act(() => {
      queueChanged?.({
        activeItemId: 'bvid:BV1note',
        items: [
          {
            id: 'bvid:BV1note',
            url: 'https://www.bilibili.com/video/BV1note',
            title: '机器学习入门教程',
            bvid: 'BV1note',
            status: 'running',
            createdAt: '2026-06-25T00:00:00.000Z',
            updatedAt: '2026-06-25T00:00:30.000Z',
            progress: { step: 'summarizing-deepseek', message: 'Generating DeepSeek summary.' },
            draftNote: note
          }
        ]
      })
    })

    expect(await screen.findByText('机器学习需要数据和模型。')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /无时间线文稿/ })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByText('正在生成 DeepSeek 总结')).toBeInTheDocument()
  })

  it('archives generated audio notes and opens the global archive panel', async () => {
    const note = createVideoNote()
    const archive: VideoNoteArchiveEntry = {
      id: note.id,
      source: note.source,
      versions: [
        {
          id: `${note.id}:version:${note.updatedAt}`,
          note,
          plainTranscript: '机器学习需要数据和模型。',
          summaryText: [
            '## 精准总结',
            '',
            '### 队列自动总结',
            '机器学习需要数据和模型。',
            '',
            '## 精修文稿',
            '',
            '自动总结后的精修文稿。'
          ].join('\n'),
          createdAt: note.updatedAt
        }
      ],
      createdAt: note.updatedAt,
      updatedAt: note.updatedAt
    }
    const loadVideoNoteArchives = vi.fn().mockResolvedValue([archive])
    let queueChanged:
      | Parameters<NonNullable<Window['bilimiDesktop']['onVideoAudioTranscriptionQueueChanged']>>[0]
      | undefined
    const enqueueCurrentVideoAudioTranscription = vi.fn().mockResolvedValue({
      activeItemId: 'bvid:BV1note',
      items: [
        {
          id: 'bvid:BV1note',
          url: 'https://www.bilibili.com/video/BV1note',
          title: '机器学习入门教程',
          bvid: 'BV1note',
          status: 'running',
          createdAt: '2026-06-25T00:00:00.000Z',
          updatedAt: '2026-06-25T00:00:00.000Z'
        }
      ]
    })
    installDesktopApi({
      enqueueCurrentVideoAudioTranscription,
      loadVideoNoteArchives,
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({
            deepseekEnabled: true,
            deepseekAutoSummaryEnabled: true
          })
        })
      ),
      onVideoAudioTranscriptionQueueChanged: vi.fn((callback) => {
        queueChanged = callback
        return vi.fn()
      })
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '札记' }))
    fireEvent.click(screen.getByRole('button', { name: '转写音频' }))

    await waitFor(() => expect(enqueueCurrentVideoAudioTranscription).toHaveBeenCalledOnce())
    act(() => {
      queueChanged?.({
        items: [
          {
            id: 'bvid:BV1note',
            url: 'https://www.bilibili.com/video/BV1note',
            title: '机器学习入门教程',
            bvid: 'BV1note',
            status: 'completed',
            createdAt: '2026-06-25T00:00:00.000Z',
            updatedAt: '2026-06-25T00:01:00.000Z',
            completedAt: '2026-06-25T00:01:00.000Z',
            archiveNoteId: note.id
          }
        ]
      })
    })
    await waitFor(() => expect(loadVideoNoteArchives).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('tab', { name: /无时间线文稿/ }))
    expect(screen.getByRole('tabpanel', { name: /无时间线文稿/ })).toHaveTextContent(
      '机器学习需要数据和模型。'
    )
    fireEvent.click(screen.getByRole('tab', { name: /DeepSeek/ }))
    expect(screen.getByRole('region', { name: /DeepSeek/ })).toHaveTextContent('队列自动总结')
    expect(screen.getByText(/自动总结后的精修文稿/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '档案库' }))

    expect(await screen.findByRole('region', { name: '全局档案库' })).toBeInTheDocument()
    expect(screen.getByText('所有视频历史')).toBeInTheDocument()
    expect(screen.getAllByText('机器学习入门教程').length).toBeGreaterThan(0)
  })

  it('keeps removed time annotation controls out of the notes panel', async () => {
    const generateVideoNoteFromAudio = vi.fn()
    const enqueueCurrentVideoAudioTranscription = vi.fn().mockResolvedValue({ items: [] })
    const getCurrentVideoTime = vi.fn().mockResolvedValue(92)
    const seekVideoTime = vi.fn().mockResolvedValue(true)
    const saveVideoNote = vi.fn().mockResolvedValue([])
    installDesktopApi({
      generateVideoNoteFromAudio,
      enqueueCurrentVideoAudioTranscription,
      getCurrentVideoTime,
      seekVideoTime,
      saveVideoNote
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '札记' }))
    fireEvent.click(screen.getByRole('button', { name: '转写音频' }))
    await waitFor(() => expect(enqueueCurrentVideoAudioTranscription).toHaveBeenCalledOnce())
    expect(generateVideoNoteFromAudio).not.toHaveBeenCalled()

    expect(screen.queryByRole('button', { name: '取当前时间' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('批注标题')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('批注正文')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存批注' })).not.toBeInTheDocument()
    expect(getCurrentVideoTime).not.toHaveBeenCalled()
    expect(seekVideoTime).not.toHaveBeenCalled()
    expect(saveVideoNote).not.toHaveBeenCalled()
  })

  it('keeps removed local memo editing out of the notes panel', async () => {
    const generateVideoNoteFromAudio = vi.fn()
    const enqueueCurrentVideoAudioTranscription = vi.fn().mockResolvedValue({ items: [] })
    const saveVideoNote = vi.fn().mockResolvedValue([])
    installDesktopApi({ generateVideoNoteFromAudio, enqueueCurrentVideoAudioTranscription, saveVideoNote })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '札记' }))
    fireEvent.click(screen.getByRole('button', { name: '转写音频' }))
    await waitFor(() => expect(enqueueCurrentVideoAudioTranscription).toHaveBeenCalledOnce())
    expect(generateVideoNoteFromAudio).not.toHaveBeenCalled()

    expect(screen.queryByLabelText('本地备注')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存札记' })).not.toBeInTheDocument()
    expect(saveVideoNote).not.toHaveBeenCalled()
  })

  it('closes the system assistant from 合折', async () => {
    const setAssistantPetHint = vi.fn()
    const { closeFloatingAssistant } = installDesktopApi({ setAssistantPetHint })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('button', { name: '合折' }))

    expect(closeFloatingAssistant).toHaveBeenCalledOnce()
    expect(setAssistantPetHint).toHaveBeenCalledWith({
      tone: 'sleepy',
      message: '主人先专心享受，有需要随时呼唤小咪'
    })
  })

  it('renders as an embedded sidebar workspace without an in-panel collapse button', async () => {
    const closeFloatingAssistant = vi.fn()
    const onRequestCollapse = vi.fn()
    installDesktopApi({ closeFloatingAssistant })

    render(<FloatingAssistantApp mode="sidebar" onRequestCollapse={onRequestCollapse} />)

    expect(await screen.findByRole('tab', { name: '批阅' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '札记' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '掌库' })).toBeInTheDocument()

    expect(screen.queryByRole('button', { name: '收起侧栏' })).not.toBeInTheDocument()
    expect(onRequestCollapse).not.toHaveBeenCalled()
    expect(closeFloatingAssistant).not.toHaveBeenCalled()
  })

  it('reports cheer and done pet states around successful sidebar actions', async () => {
    const setAssistantPetState = vi.fn()
    const setAssistantPetHint = vi.fn()
    const runAssistantAction = vi.fn().mockResolvedValue(createResult('动作已完成。'))
    installDesktopApi({
      runAssistantAction,
      setAssistantPetHint,
      setAssistantPetState
    })

    render(<FloatingAssistantApp mode="sidebar" />)

    fireEvent.click(await screen.findByRole('button', { name: /藏.*归入内库/ }))

    await waitFor(() => expect(runAssistantAction).toHaveBeenCalled())
    expect(setAssistantPetState).toHaveBeenNthCalledWith(1, 'cheer')
    expect(setAssistantPetState).toHaveBeenLastCalledWith('done')
    expect(setAssistantPetHint).toHaveBeenNthCalledWith(1, {
      tone: 'cheer',
      message: '主人，小咪正在把它收进合适的 Bilimi 分册～'
    })
    expect(setAssistantPetHint).toHaveBeenLastCalledWith({
      tone: 'done',
      message: '主人，收好啦，这支视频已经进 Bilimi 分册了。'
    })
  })
})
