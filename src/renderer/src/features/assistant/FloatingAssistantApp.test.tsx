import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import type {
  AssistantAutomationResult,
  AssistantPreferences,
  FavoriteLedger,
  FavoriteLedgerStatus,
  VideoNote,
  VideoNoteArchiveEntry
} from '@shared/types'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FloatingAssistantApp } from './FloatingAssistantApp'
import type { AssistantSnapshot } from './assistantRuntimeTypes'
import type { FavoriteLedgerPreview } from '../favorites/favoriteLedgerPreview'
import { publishDeepSeekTask } from './deepSeekTaskSignal'

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

function getLocalCommentChoices(): HTMLButtonElement[] {
  return Array.from(
    screen.getByRole('dialog', { name: '小咪推荐评论' }).querySelectorAll<HTMLButtonElement>(
      '.assistant-dialog__comment-choice'
    )
  )
}

function confirmOldFavoriteExecution() {
  fireEvent.click(screen.getByRole('button', { name: '确认整理' }))
  const dialog = screen.getByRole('alertdialog', { name: '确认开始整理？' })
  fireEvent.click(within(dialog).getByRole('button', { name: '开始整理' }))
}

function createPreferences(overrides: Partial<AssistantPreferences> = {}): AssistantPreferences {
  return {
    favoritesFolderName: 'bilimi 内库',
    favoriteLedgers: createDefaultFavoriteLedgers(),
    ledgerPromptDismissed: true,
    preferenceCounts: {},
    petStyle: 'big-head',
    petHoverShortcuts: ['like', 'coin', 'comment', 'transcribe'],
    showPetAssistantShortcut: true,
    hidePetDuringVideoFullscreen: false,
    bilibiliOperationMode: 'api-assisted',
    favoriteArchiveMultiMode: 'off',
    favoriteArchiveStrategy: 'aggressive',
    favoriteArchiveProtectionRecords: [],
    favoriteCorrectionLearningEnabled: true,
    favoriteCorrectionLearningClassificationEnabled: true,
    favoriteCorrectionRecords: [],
    favoriteKeywordSuggestions: [],
    defaultCoinCount: 1,
    commentSubmitMode: 'random',
    deepseekEnabled: false,
    deepseekApiKeyStored: false,
    deepseekCommentEnabled: true,
    deepseekAutoSummaryEnabled: true,
    deepseekPetChatEnabled: true,
    deepseekDailyClassificationEnabled: true,
    deepseekArchiveOrganizationEnabled: true,
    deepseekDailyClassificationMode: 'all',
    deepseekModel: 'deepseek-v4-flash',
    deepseekBaseUrl: 'https://api.deepseek.com',
    permissionOnboardingCompleted: true,
    assistantSidebarWidthPx: null,
    videoAudioTranscriptionThreadLimit: 'unlimited',
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

function selectDeepSeekArchiveScope(label: string) {
  fireEvent.click(screen.getByRole('button', { name: '整理范围' }))
  fireEvent.click(screen.getByRole('menuitemradio', { name: label }))
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

function createBackedFavoriteLedgers(): FavoriteLedger[] {
  return createDefaultFavoriteLedgers().map((ledger, index) => ({
    ...ledger,
    bilibiliFolderId: `900${index + 1}`
  }))
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
  const runStartupDiagnostics = vi.fn().mockResolvedValue({
    ok: true,
    checkedAt: '2026-07-03T00:00:00.000Z',
    items: [
      {
        id: 'bilibili-network',
        label: 'B 站网络',
        status: 'ok',
        message: '已能访问 B 站。'
      }
    ]
  })
  const loadDeepSeekApiKeyStatus = vi.fn().mockResolvedValue({ configured: true })
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
  const restoreDefaultLayoutSize = vi.fn().mockResolvedValue(undefined)
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
    loadDeepSeekApiKeyStatus,
    loadPreferences: vi.fn(),
    onAssistantSnapshotChanged,
    requestAssistantSnapshot,
    runAssistantAction,
    runStartupDiagnostics,
    saveFavoriteLedgers,
    savePreferences,
    restoreDefaultLayoutSize,
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
    ...overrides
  } satisfies Partial<Window['bilimiDesktop']>

  Object.defineProperty(window, 'bilimiDesktop', {
    configurable: true,
    value: api
  })

  return api
}

describe('FloatingAssistantApp', () => {
  it('shows runtime feedback from refreshed snapshots in the global feedback area', async () => {
    let snapshotChanged: (() => void) | undefined
    const requestAssistantSnapshot = vi
      .fn()
      .mockResolvedValueOnce(createSnapshot())
      .mockResolvedValueOnce(
        createSnapshot({
          runtimeFeedback: 'DeepSeek 二判完成：与本地判断一致，保留在「游戏专区」。',
          runtimeFeedbackId: 1
        })
      )
    installDesktopApi({
      requestAssistantSnapshot,
      onAssistantSnapshotChanged: vi.fn((callback: () => void) => {
        snapshotChanged = callback
        return vi.fn()
      })
    })
    render(<FloatingAssistantApp />)
    await screen.findByRole('main', { name: 'bilimi 悬浮助手' })

    act(() => snapshotChanged?.())

    expect(await screen.findByLabelText('全局提示')).toHaveTextContent(
      'DeepSeek 二判完成：与本地判断一致，保留在「游戏专区」。'
    )
    expect(screen.getByLabelText('全局提示')).toHaveAttribute(
      'title',
      'DeepSeek 二判完成：与本地判断一致，保留在「游戏专区」。'
    )
  })

  it('does not replay historical runtime feedback when the assistant first mounts', async () => {
    let snapshotChanged: (() => void) | undefined
    let resolveInitialSnapshot: ((snapshot: AssistantSnapshot) => void) | undefined
    const requestAssistantSnapshot = vi
      .fn()
      .mockResolvedValueOnce(
        new Promise<AssistantSnapshot>((resolve) => {
          resolveInitialSnapshot = resolve
        })
      )
      .mockResolvedValueOnce(
        createSnapshot({
          runtimeFeedback: 'DeepSeek 二判完成：这是一条新提示。',
          runtimeFeedbackId: 8
        })
      )
    installDesktopApi({
      requestAssistantSnapshot,
      onAssistantSnapshotChanged: vi.fn((callback: () => void) => {
        snapshotChanged = callback
        return vi.fn()
      })
    })

    render(<FloatingAssistantApp />)
    await waitFor(() => expect(requestAssistantSnapshot).toHaveBeenCalledTimes(1))

    act(() => snapshotChanged?.())
    expect(requestAssistantSnapshot).toHaveBeenCalledTimes(1)

    resolveInitialSnapshot?.(
      createSnapshot({
        runtimeFeedback: 'DeepSeek 二判完成：这是一条历史提示。',
        runtimeFeedbackId: 7
      })
    )

    expect(await screen.findByLabelText('全局提示')).toHaveTextContent(
      'DeepSeek 二判完成：这是一条新提示。'
    )
    expect(screen.getByLabelText('全局提示')).not.toHaveTextContent('这是一条历史提示')
  })
  const favoriteLedgerSafetyNote =
    '使用bilimi第一件事就是备册，生成专属收藏夹，同一个视频可以同时保存在不同的收藏夹里，小咪不会删除主人的旧收藏哦，安心使用吧'

  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

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

  it('uses status lights as shortcuts to the related assistant area', async () => {
    installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({
            deepseekEnabled: false,
            deepseekApiKeyStored: false
          })
        })
      )
    })

    const { container } = render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByLabelText('DeepSeek状态'))
    expect(screen.getByRole('tab', { name: '设置' })).toHaveAttribute('aria-selected', 'true')
    const settingsJump = screen.getByRole<HTMLSelectElement>('combobox', { name: '设置项' })
    expect(settingsJump).toHaveValue('deepseek')

    const settingsBody = container.querySelector<HTMLElement>('.assistant-settings__body')
    const diagnosticsSection = screen.getByRole('group', { name: '诊断' })
    const deepSeekSection = screen.getByRole('group', { name: 'DeepSeek' })
    expect(settingsBody).not.toBeNull()
    vi.spyOn(settingsBody!, 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect)
    container.querySelectorAll<HTMLElement>('[data-settings-section]').forEach((section) => {
      vi.spyOn(section, 'getBoundingClientRect').mockReturnValue({ top: 1000 } as DOMRect)
    })
    vi.mocked(diagnosticsSection.getBoundingClientRect).mockReturnValue({ top: -200 } as DOMRect)
    vi.mocked(deepSeekSection.getBoundingClientRect).mockReturnValue({ top: 126 } as DOMRect)
    fireEvent.scroll(settingsBody!)

    expect(settingsJump).toHaveValue('deepseek')

    fireEvent.click(screen.getByLabelText('转写音频状态'))
    expect(screen.getByRole('tab', { name: '札记' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(screen.getByLabelText('整理状态'))
    expect(screen.getByRole('tab', { name: '掌库' })).toHaveAttribute('aria-selected', 'true')
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

  it('starts old favorite organization when a pet workspace request asks for 整', async () => {
    let openWorkspace: Parameters<
      NonNullable<Window['bilimiDesktop']['onOpenFloatingAssistantWorkspace']>
    >[0] | undefined
    const scanOldFavorites = vi.fn().mockResolvedValue({
      items: [],
      skippedSourceFolderTitles: []
    } satisfies FavoriteLedgerPreview)
    installDesktopApi({
      scanOldFavorites,
      onOpenFloatingAssistantWorkspace: vi.fn((callback) => {
        openWorkspace = callback
        return vi.fn()
      })
    })

    render(<FloatingAssistantApp />)

    expect(await screen.findByRole('tab', { name: '批阅' })).toBeInTheDocument()

    act(() => {
      openWorkspace?.({ tab: 'ledger', organizeOldFavorites: true })
    })

    expect(screen.getByRole('tab', { name: '掌库' })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(scanOldFavorites).toHaveBeenCalledOnce())
    expect(screen.getByRole('region', { name: '整理旧藏向导' })).toBeInTheDocument()
  })

  it('persists completed old favorite protection records from the ledger panel', async () => {
    const savePreferences = vi.fn().mockImplementation(async (preferences: AssistantPreferences) => preferences)
    const preview: FavoriteLedgerPreview = {
      items: [
        {
          aid: 901,
          title: '完成后保护的旧藏',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·知识学习',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['knowledge'],
          currentTargetLedgerIds: ['knowledge'],
          selectedTargetLedgerIds: ['knowledge']
        }
      ],
      skippedSourceFolderTitles: [],
      scanContext: {
        accountMid: '42',
        totalUniqueVideos: 1,
        activeSourceFolders: [],
        protectedVideos: [],
        managedFolders: [],
        targetMembership: {},
        multiArchiveMode: 'off'
      }
    }
    installDesktopApi({
      savePreferences,
      scanOldFavorites: vi.fn().mockResolvedValue(preview),
      executeOldFavoritePlan: vi.fn().mockImplementation(async ([item]) => ({
        ok: true,
        steps: [],
        missingTargets: [],
        completedItems: [item],
        message: 'done'
      })),
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({
            favoriteLedgers: createDefaultFavoriteLedgers().map((ledger) =>
              ledger.id === 'knowledge' ? { ...ledger, bilibiliFolderId: '9001' } : ledger
            )
          })
        })
      )
    })

    render(<FloatingAssistantApp />)
    expect(await screen.findByRole('tab', { name: '批阅' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '掌库' }))
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    confirmOldFavoriteExecution()

    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          favoriteArchiveProtectionRecords: [
            expect.objectContaining({
              accountMid: '42',
              aid: 901,
              targetLedgerIds: ['knowledge'],
              targetFolderIds: ['9001'],
              completedAt: expect.any(String)
            })
          ]
        })
      )
    )
  })

  it('uses DeepSeek for archive preview organization and persists returned keyword suggestions', async () => {
    const savePreferences = vi.fn().mockImplementation(async (preferences: AssistantPreferences) => preferences)
    const deepSeekOrganization = createDeferred<
      Awaited<ReturnType<NonNullable<Window['bilimiDesktop']['generateDeepSeek']>>>
    >()
    const generateDeepSeek = vi.fn(() => deepSeekOrganization.promise)
    const deepSeekResult = {
      kind: 'favorite-archive-organize',
      results: [],
      keywordSuggestions: [
        {
          id: 'deepseek-keyword-1',
          action: 'add-keyword',
          ledgerId: 'knowledge',
          keyword: 'AI 工具',
          reason: 'DeepSeek 在旧藏整理中发现高频组合词。',
          source: 'deepseek',
          status: 'pending',
          createdAt: '2026-07-06T00:00:00.000Z'
        }
      ]
    } as const
    const scanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 901,
          title: 'AI 工具链教程',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·学吧你就',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['knowledge'],
          currentTargetLedgerIds: ['knowledge'],
          selectedTargetLedgerIds: ['knowledge'],
          lowConfidence: false
        }
      ],
      skippedSourceFolderTitles: []
    } satisfies FavoriteLedgerPreview)
    installDesktopApi({
      generateDeepSeek,
      savePreferences,
      scanOldFavorites,
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({
            deepseekEnabled: true,
            deepseekApiKeyStored: true,
            deepseekDailyClassificationEnabled: true
          })
        })
      )
    })

    render(<FloatingAssistantApp />)

    expect(await screen.findByRole('tab', { name: '批阅' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '掌库' }))
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    selectDeepSeekArchiveScope('DeepSeek 进行二次整理')

    expect(generateDeepSeek).not.toHaveBeenCalled()
    expect(screen.getByLabelText('DeepSeek状态')).not.toHaveTextContent('DeepSeek 工作中')

    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))

    await waitFor(() =>
      expect(generateDeepSeek).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'favorite-archive-organize',
          mode: 'all',
          videos: [expect.objectContaining({ aid: 901 })]
        })
      )
    )
    await waitFor(() =>
      expect(screen.getByLabelText('DeepSeek状态')).toHaveTextContent('DeepSeek 工作中')
    )

    deepSeekOrganization.resolve(deepSeekResult)

    expect(
      await screen.findByText('DeepSeek 返回 1 条关键词建议，已加入设置里的建议列表。')
    ).toBeInTheDocument()
    expect(screen.getByLabelText('DeepSeek状态')).not.toHaveTextContent('DeepSeek 工作中')
    fireEvent.click(screen.getByRole('button', { name: '前往采纳 DeepSeek 建议' }))
    expect(screen.getByRole('tab', { name: '设置' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: '设置项' })).toHaveValue(
      'learning'
    )
    expect(screen.getByText('DeepSeek 建议（1）')).toBeInTheDocument()
    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          favoriteKeywordSuggestions: [
            expect.objectContaining({
              id: 'deepseek-keyword-1',
              keyword: 'AI 工具',
              status: 'pending'
            })
          ]
        })
      )
    )
  })

  it('deduplicates DeepSeek archive keyword suggestions by action ledger keyword and replacement', async () => {
    const savePreferences = vi.fn().mockImplementation(async (preferences: AssistantPreferences) => preferences)
    const generateDeepSeek = vi.fn().mockResolvedValue({
      kind: 'favorite-archive-organize',
      results: [],
      keywordSuggestions: [
        {
          id: 'deepseek-keyword-duplicate-pending',
          action: 'add-keyword',
          ledgerId: 'knowledge',
          keyword: 'AI 工具',
          reason: '同一条待处理建议不应重复加入。',
          source: 'deepseek',
          status: 'pending',
          createdAt: '2026-07-06T00:02:00.000Z'
        },
        {
          id: 'deepseek-keyword-duplicate-accepted',
          action: 'replace-with-combination',
          ledgerId: 'game',
          keyword: '攻略',
          replacement: '游戏攻略',
          reason: '已处理过的建议不应同轮回流。',
          source: 'deepseek',
          status: 'pending',
          createdAt: '2026-07-06T00:03:00.000Z'
        },
        {
          id: 'deepseek-keyword-new',
          action: 'add-keyword',
          ledgerId: 'life-interest',
          keyword: '通勤路线',
          reason: '新的组合词仍应进入待处理列表。',
          source: 'deepseek',
          status: 'pending',
          createdAt: '2026-07-06T00:04:00.000Z'
        }
      ]
    })
    const scanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 902,
          title: 'AI 工具链教程',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·学吧你就',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['knowledge'],
          currentTargetLedgerIds: ['knowledge'],
          selectedTargetLedgerIds: ['knowledge'],
          lowConfidence: false
        }
      ],
      skippedSourceFolderTitles: []
    } satisfies FavoriteLedgerPreview)
    installDesktopApi({
      generateDeepSeek,
      savePreferences,
      scanOldFavorites,
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({
            deepseekEnabled: true,
            deepseekApiKeyStored: true,
            deepseekDailyClassificationEnabled: true,
            favoriteKeywordSuggestions: [
              {
                id: 'existing-pending',
                action: 'add-keyword',
                ledgerId: 'knowledge',
                keyword: 'AI 工具',
                reason: 'Already pending.',
                source: 'deepseek',
                status: 'pending',
                createdAt: '2026-07-06T00:00:00.000Z'
              },
              {
                id: 'existing-accepted',
                action: 'replace-with-combination',
                ledgerId: 'game',
                keyword: '攻略',
                replacement: '游戏攻略',
                reason: 'Already accepted.',
                source: 'deepseek',
                status: 'accepted',
                createdAt: '2026-07-06T00:01:00.000Z'
              }
            ]
          })
        })
      )
    })

    render(<FloatingAssistantApp />)

    expect(await screen.findByRole('tab', { name: '批阅' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '掌库' }))
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    selectDeepSeekArchiveScope('DeepSeek 进行二次整理')
    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))

    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          favoriteKeywordSuggestions: [
            expect.objectContaining({ id: 'existing-pending' }),
            expect.objectContaining({ id: 'existing-accepted' }),
            expect.objectContaining({ id: 'deepseek-keyword-new' })
          ]
        })
      )
    )
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

  it('closes the floating assistant when clicking blank workspace area', async () => {
    const api = installDesktopApi()
    const { container } = render(<FloatingAssistantApp />)

    expect(await screen.findByRole('button', { name: '合折' })).toBeInTheDocument()

    const workspace = container.querySelector('.floating-assistant-workspace')
    expect(workspace).toBeInstanceOf(HTMLElement)

    fireEvent.pointerDown(workspace as HTMLElement)

    expect(api.closeFloatingAssistant).toHaveBeenCalledOnce()
  })

  it('closes the floating assistant when the floating window loses focus', async () => {
    const api = installDesktopApi()

    render(<FloatingAssistantApp />)

    expect(await screen.findByRole('button', { name: '合折' })).toBeInTheDocument()

    fireEvent(window, new Event('blur'))

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

  it('keeps long-running old favorite status out of the realtime feedback line', async () => {
    const scanRequest = createDeferred<FavoriteLedgerPreview>()
    const scanOldFavorites = vi.fn(() => scanRequest.promise)
    const scanPreview = {
      items: [
        {
          aid: 901,
          title: 'AI 工具链教程',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·学吧你就',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['knowledge'],
          currentTargetLedgerIds: ['knowledge'],
          selectedTargetLedgerIds: ['knowledge'],
          lowConfidence: false
        }
      ],
      skippedSourceFolderTitles: []
    } satisfies FavoriteLedgerPreview
    const backedLedgers = createBackedFavoriteLedgers()
    installDesktopApi({
      scanOldFavorites,
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({ favoriteLedgers: backedLedgers }),
          favoriteLedgerStatus: {
            ok: true,
            ledgers: backedLedgers,
            missingLedgerIds: [],
            message: '册目查验已毕。'
          }
        })
      )
    })

    render(<FloatingAssistantApp />)

    await waitFor(() => expect(screen.getByLabelText('整理状态')).toHaveTextContent('已备册'))
    fireEvent.click(screen.getByRole('tab', { name: '掌库' }))
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))

    await waitFor(() => expect(screen.getByLabelText('整理状态')).toHaveTextContent('旧藏扫描中'))
    expect(screen.getByLabelText('全局提示')).not.toHaveTextContent('正在扫描旧藏')

    await act(async () => {
      scanRequest.resolve(scanPreview)
    })

    await waitFor(() => expect(screen.getByLabelText('整理状态')).toHaveTextContent('旧藏待整理 1'))
    expect(screen.getByLabelText('全局提示')).toHaveTextContent('旧藏扫描完成，发现 1 条待整理')
  })

  it('keeps quick review settings compact inside action buttons', async () => {
    installDesktopApi()

    render(<FloatingAssistantApp />)

    expect(await screen.findByRole('button', { name: /赐.*投币厚赏/ })).toBeInTheDocument()
    expect(screen.queryByText('投币数量')).not.toBeInTheDocument()
    expect(screen.queryByText('评论发送方式')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '投币厚赏参数' })).toHaveDisplayValue('一枚')
    expect(screen.getByRole('combobox', { name: '拟奏短评参数' })).toHaveDisplayValue('随机')
  })

  it('validates saved DeepSeek configuration once after startup', async () => {
    let snapshotChanged: (() => void) | undefined
    const connectionTest = createDeferred<{
      ok: boolean
      message: string
      requestedModel: string
      responseModel: string
    }>()
    const testDeepSeekConnection = vi.fn().mockReturnValue(connectionTest.promise)
    const connectionResult = {
      ok: true,
      message: 'DeepSeek connection succeeded.',
      requestedModel: 'deepseek-v4-pro',
      responseModel: 'deepseek-v4-pro'
    }
    installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({
            deepseekEnabled: true,
            deepseekApiKeyStored: true,
            deepseekModel: 'deepseek-v4-pro',
            deepseekCommentEnabled: true,
            deepseekAutoSummaryEnabled: false,
            deepseekPetChatEnabled: true,
            deepseekDailyClassificationEnabled: false
          })
        })
      ),
      testDeepSeekConnection,
      onAssistantSnapshotChanged: vi.fn((callback: () => void) => {
        snapshotChanged = callback
        return vi.fn()
      })
    })

    render(<FloatingAssistantApp mode="sidebar" />)

    await waitFor(() => expect(testDeepSeekConnection).toHaveBeenCalledOnce())
    expect(screen.getByLabelText('DeepSeek状态')).toHaveTextContent('DeepSeek 验证中')

    connectionTest.resolve(connectionResult)

    await waitFor(() =>
      expect(screen.getByLabelText('DeepSeek状态')).toHaveTextContent('DeepSeek 已连接')
    )
    expect(screen.getByLabelText('DeepSeek状态')).toHaveAttribute('data-tone', 'ok')
    expect(screen.getByLabelText('DeepSeek状态')).toHaveAttribute(
      'title',
      expect.stringContaining('当前模型：deepseek-v4-pro')
    )
    await waitFor(() =>
      expect(screen.getByLabelText('DeepSeek状态')).toHaveAttribute(
        'title',
        expect.stringContaining('趣味评论：开启')
      )
    )
    expect(screen.getByLabelText('DeepSeek状态')).toHaveAttribute(
      'title',
      expect.stringContaining('自动总结：关闭')
    )
    expect(screen.getByLabelText('DeepSeek状态')).toHaveAttribute(
      'title',
      expect.stringContaining('宠物对话：开启')
    )
    expect(screen.getByLabelText('DeepSeek状态')).toHaveAttribute(
      'title',
      expect.stringContaining('批阅辅助：关闭')
    )

    act(() => snapshotChanged?.())
    await waitFor(() => expect(testDeepSeekConnection).toHaveBeenCalledOnce())
  })

  it.each([
    {
      deepseekEnabled: false,
      deepseekApiKeyStored: true,
      expectedStatus: 'DeepSeek 未启用'
    },
    {
      deepseekEnabled: true,
      deepseekApiKeyStored: false,
      expectedStatus: 'DeepSeek 待配置'
    }
  ])(
    'does not validate DeepSeek on startup when enabled=$deepseekEnabled and configured=$deepseekApiKeyStored',
    async ({ expectedStatus, ...deepSeekPreferences }) => {
      const testDeepSeekConnection = vi.fn()
      installDesktopApi({
        requestAssistantSnapshot: vi.fn().mockResolvedValue(
          createSnapshot({
            preferences: createPreferences(deepSeekPreferences)
          })
        ),
        testDeepSeekConnection
      })

      render(<FloatingAssistantApp />)

      await waitFor(() =>
        expect(screen.getByLabelText('DeepSeek状态')).toHaveTextContent(expectedStatus)
      )
      expect(testDeepSeekConnection).not.toHaveBeenCalled()
    }
  )

  it('shows an idle no-transcript status when the current video has no transcription yet', async () => {
    installDesktopApi({
      loadVideoAudioTranscriptionQueue: vi.fn().mockResolvedValue({
        items: [
          {
            id: 'bvid:BV-old-failed',
            url: 'https://www.bilibili.com/video/BV-old-failed',
            title: '旧视频',
            bvid: 'BV-old-failed',
            status: 'failed',
            errorMessage: 'Audio download failed.',
            createdAt: '2026-06-25T00:00:00.000Z',
            updatedAt: '2026-06-25T00:01:00.000Z'
          }
        ]
      })
    })

    render(<FloatingAssistantApp />)

    await waitFor(() =>
      expect(screen.getByLabelText('转写音频状态')).toHaveTextContent('暂无转写')
    )
    const transcriptionStatus = screen.getByLabelText('转写音频状态')
    expect(transcriptionStatus).toHaveAttribute('data-tone', 'idle')
    expect(transcriptionStatus).not.toHaveTextContent('转写失败')
  })

  it('shows the completed transcription count from the current app session while idle', async () => {
    installDesktopApi({
      loadVideoAudioTranscriptionQueue: vi.fn().mockResolvedValue({
        items: [],
        sessionCompletedCount: 3
      })
    })

    render(<FloatingAssistantApp />)

    await waitFor(() =>
      expect(screen.getByLabelText('转写音频状态')).toHaveTextContent('暂无转写 · 成功 3')
    )
    const transcriptionStatus = screen.getByLabelText('转写音频状态')
    expect(transcriptionStatus).toHaveAttribute(
      'title',
      '本次启动已成功转写 3 个视频，文稿已保存到档案库。'
    )

    fireEvent.click(transcriptionStatus)
    expect(screen.getByRole('tab', { name: '札记' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('region', { name: '全局档案库' })).not.toBeInTheDocument()
  })

  it('restores the session completed count after the renderer is rebuilt', async () => {
    const loadVideoAudioTranscriptionQueue = vi.fn().mockResolvedValue({
      items: [],
      sessionCompletedCount: 2
    })
    installDesktopApi({ loadVideoAudioTranscriptionQueue })

    const app = render(<FloatingAssistantApp />)
    await waitFor(() =>
      expect(screen.getByLabelText('转写音频状态')).toHaveTextContent('暂无转写 · 成功 2')
    )

    app.unmount()
    render(<FloatingAssistantApp />)

    await waitFor(() =>
      expect(screen.getByLabelText('转写音频状态')).toHaveTextContent('暂无转写 · 成功 2')
    )
    expect(loadVideoAudioTranscriptionQueue).toHaveBeenCalledTimes(2)
  })

  it('guides the user to log in and back up ledgers instead of waiting for action', async () => {
    installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          activeTabUrl: '',
          favoriteLedgerStatus: {
            ok: false,
            ledgers: createDefaultFavoriteLedgers(),
            missingLedgerIds: ['knowledge'],
            message: '册目缺失。'
          }
        })
      )
    })

    render(<FloatingAssistantApp />)

    await waitFor(() =>
      expect(screen.getByLabelText('全局提示')).toHaveTextContent(
        '请先登录 B 站，并到掌库备册。'
      )
    )
    expect(screen.getByLabelText('全局提示')).not.toHaveTextContent('等待操作')
    expect(screen.getByLabelText('整理状态')).toHaveAttribute(
      'title',
      expect.stringContaining(favoriteLedgerSafetyNote)
    )
  })

  it('uses a loading placeholder instead of a fake video title before the snapshot arrives', async () => {
    let resolveSnapshot: (snapshot: AssistantSnapshot) => void = () => {}
    installDesktopApi({
      requestAssistantSnapshot: vi.fn(
        () =>
          new Promise<AssistantSnapshot>((resolve) => {
            resolveSnapshot = resolve
          })
      )
    })

    render(<FloatingAssistantApp />)

    await act(async () => {})

    expect(screen.getByText('等待视频加载')).toBeInTheDocument()
    expect(screen.queryByText('早八生存实录')).not.toBeInTheDocument()

    await act(async () => {
      resolveSnapshot(createSnapshot())
    })
  })

  it('shows clear Bilimi collection strategy copy in settings', async () => {
    installDesktopApi()

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))

    expect(screen.getByText('bilimi 收藏策略')).toBeInTheDocument()
    expect(
      screen.getByText('说明：设置一个待分类视频最多可同时保存到几个合适的 bilimi 收藏夹。')
    ).toBeInTheDocument()
    expect(screen.getByText('1. 用户原收藏夹不会被移动或删除，也不计入数量。')).toBeInTheDocument()
    expect(
      screen.getByText('2. 优先保存到 bilimi 中系统推荐生成和用户自定义创建的收藏夹。')
    ).toBeInTheDocument()
    expect(screen.queryByText('旧收藏夹不会移动、删除，也不计入数量。')).not.toBeInTheDocument()
    expect(
      screen.getByText('最多同时保存到 1 个 bilimi 收藏夹')
    ).toBeInTheDocument()
    expect(
      screen.getByText('最多同时保存到 2 个 bilimi 收藏夹')
    ).toBeInTheDocument()
    expect(
      screen.getByText('最多同时保存到 3 个 bilimi 收藏夹')
    ).toBeInTheDocument()
  })

  it('renders archive strategy and correction learning settings', async () => {
    installDesktopApi()

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))

    expect(screen.getByRole('group', { name: '整理策略' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '积极整理' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '记录纠错参考' })).toBeChecked()
    expect(screen.queryByRole('checkbox', { name: '纠错学习参与分类' })).not.toBeInTheDocument()
    expect(screen.getByText('DeepSeek 建议（0）')).toBeInTheDocument()
    expect(screen.getByText('纠错参考记录（0）')).toBeInTheDocument()
  })

  it('renders the settings jump select instead of fixed section buttons', async () => {
    installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({
            favoriteCorrectionRecords: [
              {
                id: 'c1',
                aid: 1,
                title: '东京旅行攻略',
                author: '旅行UP',
                tags: ['旅行'],
                originalLedgerId: 'inbox',
                userLedgerIds: ['life-interest'],
                feedbackType: 'strong-correction',
                source: 'user',
                sourceScene: 'archive-preview',
                sourceFolderTitle: '默认收藏夹',
                matchedKeywords: ['攻略'],
                score: 1,
                confidence: 'low',
                createdAt: '2026-07-05T00:00:00.000Z'
              }
            ],
            favoriteKeywordSuggestions: [
              {
                id: 's1',
                action: 'add-keyword',
                ledgerId: 'game',
                keyword: '攻略',
                reason: '用户多次改到游戏册。',
                source: 'deepseek',
                status: 'pending',
                createdAt: '2026-07-05T00:00:00.000Z'
              }
            ]
          })
        })
      )
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))

    expect(screen.queryByRole('group', { name: '设置分区' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '设置项' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '诊断' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'DeepSeek' })).not.toBeInTheDocument()

    const settingsJump = screen.getByRole<HTMLSelectElement>('combobox', { name: '设置项' })
    expect(settingsJump).toHaveValue('diagnostics')
    expect(Array.from(settingsJump.options).map((option) => option.textContent)).toEqual([
      '诊断',
      'DeepSeek',
      '整理策略',
      '宠物设置',
      '视频音频转写速度',
      '收藏整理',
      '批阅动作',
      '关闭设置'
    ])
    expect(await screen.findByText('纠错参考记录（1）')).toBeInTheDocument()
    expect(screen.getByText('DeepSeek 建议（1）')).toBeInTheDocument()

    const diagnosticsSection = screen.getByRole('group', { name: '诊断' })
    const deepSeekSection = screen.getByRole('group', { name: 'DeepSeek' })
    const learningSection = screen.getByRole('group', { name: '整理策略' })
    const petSection = screen.getByRole('group', { name: '宠物设置' })
    const reviewActionsSection = screen.getByRole('group', { name: '批阅动作设置' })
    const closeSection = screen.getByRole('group', { name: '关闭设置' })
    expect(
      diagnosticsSection.compareDocumentPosition(deepSeekSection) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      deepSeekSection.compareDocumentPosition(learningSection) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      learningSection.compareDocumentPosition(petSection) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      reviewActionsSection.compareDocumentPosition(closeSection) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    deepSeekSection.scrollIntoView = vi.fn()
    fireEvent.change(settingsJump, { target: { value: 'deepseek' } })

    expect(settingsJump).toHaveValue('deepseek')
    expect(deepSeekSection.scrollIntoView).toHaveBeenCalledWith({
      block: 'start',
      behavior: 'smooth'
    })
    expect(screen.getByRole('group', { name: '视频音频转写速度' })).toBeInTheDocument()
    expect(
      screen.getByText(
        '控制本地 whisper.cpp / whisper-cli.exe 转写视频音频能使用多少 CPU 线程；限制越低，电脑越不容易卡，但转写会更慢。'
      )
    ).toBeInTheDocument()
  })

  it('saves close behavior and exit confirmation settings', async () => {
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({
            closeBehavior: 'minimize-to-tray',
            confirmBeforeExit: true
          })
        })
      ),
      savePreferences
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))

    expect(screen.getByRole('group', { name: '关闭设置' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /最小化到系统托盘/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /退出前确认/ })).toBeDisabled()

    fireEvent.click(screen.getByRole('radio', { name: /退出启动器/ }))

    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          closeBehavior: 'exit-launcher',
          confirmBeforeExit: true
        })
      )
    )
    expect(screen.getByRole('checkbox', { name: /退出前确认/ })).toBeEnabled()

    fireEvent.click(screen.getByRole('checkbox', { name: /退出前确认/ }))

    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          closeBehavior: 'exit-launcher',
          confirmBeforeExit: false
        })
      )
    )
  })

  it('saves archive strategy and correction learning choices', async () => {
    const { savePreferences } = installDesktopApi()

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    fireEvent.click(screen.getByRole('radio', { name: '均衡整理' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '记录纠错参考' }))

    await waitFor(() =>
      expect(savePreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({
          favoriteArchiveStrategy: 'balanced',
          favoriteCorrectionLearningEnabled: false
        })
      )
    )
  })

  it('renders independent DeepSeek organization controls with a compact review mode select', async () => {
    installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({
            deepseekEnabled: true,
            deepseekApiKeyStored: true
          })
        })
      )
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))

    const reviewToggle = screen.getByRole('checkbox', { name: '批阅辅助' })
    const archiveToggle = screen.getByRole('checkbox', { name: '旧藏整理' })
    const reviewMode = screen.getByRole('combobox', { name: '批阅辅助范围' })

    expect(reviewToggle).toBeChecked()
    expect(archiveToggle).toBeChecked()
    expect(reviewMode).toHaveValue('all')

    fireEvent.click(reviewToggle)
    expect(reviewMode).toBeDisabled()
    expect(archiveToggle).toBeChecked()
  })

  it('enables every DeepSeek child feature only on the first master-switch activation', async () => {
    const { savePreferences } = installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({
            deepseekEnabled: false,
            deepseekFeatureDefaultsInitialized: false,
            deepseekCommentEnabled: false,
            deepseekAutoSummaryEnabled: false,
            deepseekPetChatEnabled: false,
            deepseekDailyClassificationEnabled: false,
            deepseekArchiveOrganizationEnabled: false
          })
        })
      )
    })

    render(<FloatingAssistantApp />)
    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '启用 DeepSeek' }))

    expect(screen.getByRole('checkbox', { name: '趣味评论' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '自动总结' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '宠物对话' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '批阅辅助' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '旧藏整理' })).toBeChecked()

    fireEvent.click(screen.getByRole('checkbox', { name: '宠物对话' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '启用 DeepSeek' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '启用 DeepSeek' }))

    expect(screen.getByRole('checkbox', { name: '宠物对话' })).not.toBeChecked()
    await waitFor(() =>
      expect(savePreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({
          deepseekFeatureDefaultsInitialized: true,
          deepseekPetChatEnabled: false
        })
      )
    )
  })

  it('can review, delete, and clear correction records', async () => {
    const { savePreferences } = installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({
            favoriteCorrectionRecords: [
              {
                id: 'c1',
                aid: 1,
                title: '东京旅行攻略',
                originalLedgerId: 'game',
                userLedgerIds: ['life-interest'],
                source: 'deepseek',
                feedbackType: 'strong-correction',
                sourceScene: 'archive-preview',
                sourceFolderTitle: '稍后再看',
                author: '旅行UP',
                tags: ['旅行'],
                matchedKeywords: ['攻略'],
                score: 0.8,
                confidence: 'medium',
                scoreGap: 0.18,
                createdAt: '2026-07-05T00:00:00.000Z',
                confirmedAt: '2026-07-05T00:01:00.000Z'
              },
              {
                id: 'c2',
                aid: 2,
                title: '料理学习笔记',
                userLedgerIds: ['craft'],
                source: 'deepseek',
                feedbackType: 'weak-negative',
                sourceScene: 'daily-favorite',
                tags: [],
                matchedKeywords: [],
                createdAt: '2026-07-05T00:02:00.000Z'
              }
            ]
          })
        })
      )
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))

    expect(screen.getByText(/标签：旅行/)).toBeInTheDocument()
    expect(screen.getByText(/UP：旅行UP/)).toBeInTheDocument()
    expect(screen.getByText(/命中关键词：攻略/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /删除纠错 东京旅行攻略/ }))

    expect(screen.queryByText('东京旅行攻略')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(savePreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({
          favoriteCorrectionRecords: [
            expect.objectContaining({
              id: 'c2',
              title: '料理学习笔记'
            })
          ]
        })
      )
    )

    fireEvent.click(screen.getByRole('button', { name: '清空纠错记录' }))

    await waitFor(() =>
      expect(savePreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({
          favoriteCorrectionRecords: []
        })
      )
    )
  })

  it('accepts keyword suggestions that add or replace ledger keywords', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'game'
        ? {
            ...ledger,
            keywords: ['游戏', '单机']
          }
        : ledger
    )
    const { savePreferences } = installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({
            favoriteLedgers: ledgers,
            favoriteKeywordSuggestions: [
              {
                id: 's1',
                action: 'add-keyword',
                ledgerId: 'game',
                keyword: '攻略',
                reason: '用户多次改到游戏册。',
                source: 'deepseek',
                status: 'pending',
                createdAt: '2026-07-05T00:00:00.000Z'
              },
              {
                id: 's2',
                action: 'replace-with-combination',
                ledgerId: 'game',
                keyword: '单机',
                replacement: '单机攻略',
                reason: '组合词更精确。',
                source: 'deepseek',
                status: 'pending',
                createdAt: '2026-07-05T00:01:00.000Z'
              }
            ]
          })
        })
      )
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    fireEvent.click(screen.getByRole('button', { name: /采纳建议 攻略/ }))

    await waitFor(() =>
      expect(savePreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({
          favoriteLedgers: expect.arrayContaining([
            expect.objectContaining({
              id: 'game',
              keywords: expect.arrayContaining(['游戏', '单机', '攻略'])
            })
          ]),
          favoriteKeywordSuggestions: expect.arrayContaining([
            expect.objectContaining({
              id: 's1',
              status: 'accepted'
            })
          ])
        })
      )
    )

    fireEvent.click(screen.getByRole('button', { name: /采纳建议 单机/ }))

    await waitFor(() =>
      expect(savePreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({
          favoriteLedgers: expect.arrayContaining([
            expect.objectContaining({
              id: 'game',
              keywords: expect.arrayContaining(['游戏', '攻略', '单机攻略'])
            })
          ]),
          favoriteKeywordSuggestions: expect.arrayContaining([
            expect.objectContaining({
              id: 's2',
              status: 'accepted'
            })
          ])
        })
      )
    )

    expect(
      (savePreferences as ReturnType<typeof vi.fn>).mock.calls
        .at(-1)?.[0]
        .favoriteLedgers.find((ledger: FavoriteLedger) => ledger.id === 'game')
        ?.keywords
    ).not.toContain('单机')
  })

  it('can ignore and delete keyword suggestions', async () => {
    const { savePreferences } = installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({
            favoriteKeywordSuggestions: [
              {
                id: 's1',
                action: 'downgrade-to-weak',
                ledgerId: 'game',
                keyword: '实况',
                reason: '弱词更适合。',
                source: 'deepseek',
                status: 'pending',
                createdAt: '2026-07-05T00:00:00.000Z'
              },
              {
                id: 's2',
                action: 'remove-keyword',
                ledgerId: 'life-interest',
                keyword: 'vlog',
                reason: '误命中生活册。',
                source: 'deepseek',
                status: 'pending',
                createdAt: '2026-07-05T00:01:00.000Z'
              }
            ]
          })
        })
      )
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    fireEvent.click(screen.getByRole('button', { name: /忽略建议 实况/ }))

    await waitFor(() =>
      expect(savePreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({
          favoriteKeywordSuggestions: expect.arrayContaining([
            expect.objectContaining({
              id: 's1',
              status: 'ignored'
            })
          ])
        })
      )
    )

    fireEvent.click(screen.getByRole('button', { name: /删除建议 vlog/ }))

    await waitFor(() =>
      expect(savePreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({
          favoriteKeywordSuggestions: expect.arrayContaining([
            expect.objectContaining({
              id: 's2',
              status: 'deleted'
            })
          ])
        })
      )
    )
  })

  it('keeps newer local preference edits when an older save resolves before the latest save', async () => {
    let resolveFirstSave: (preferences: AssistantPreferences) => void = () => {}
    let resolveSecondSave: (preferences: AssistantPreferences) => void = () => {}
    const savePreferences = vi
      .fn()
      .mockImplementationOnce(
        (preferences: AssistantPreferences) =>
          new Promise<AssistantPreferences>((resolve) => {
            resolveFirstSave = () => resolve(preferences)
          })
      )
      .mockImplementationOnce(
        (preferences: AssistantPreferences) =>
          new Promise<AssistantPreferences>((resolve) => {
            resolveSecondSave = () => resolve(preferences)
          })
      )
      .mockImplementation(async (preferences: AssistantPreferences) => preferences)
    installDesktopApi({
      savePreferences,
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({
            favoriteKeywordSuggestions: [
              {
                id: 's1',
                action: 'downgrade-to-weak',
                ledgerId: 'game',
                keyword: '实况',
                reason: '弱词更适合。',
                source: 'deepseek',
                status: 'pending',
                createdAt: '2026-07-05T00:00:00.000Z'
              },
              {
                id: 's2',
                action: 'downgrade-to-weak',
                ledgerId: 'game',
                keyword: '攻略',
                reason: '弱词更适合。',
                source: 'deepseek',
                status: 'pending',
                createdAt: '2026-07-05T00:01:00.000Z'
              },
              {
                id: 's3',
                action: 'downgrade-to-weak',
                ledgerId: 'game',
                keyword: '剧情',
                reason: '弱词更适合。',
                source: 'deepseek',
                status: 'pending',
                createdAt: '2026-07-05T00:02:00.000Z'
              }
            ]
          })
        })
      )
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    fireEvent.click(screen.getByRole('button', { name: /忽略建议 实况/ }))

    await waitFor(() => expect(savePreferences).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: /忽略建议 攻略/ }))

    act(() => {
      resolveFirstSave(savePreferences.mock.calls[0][0])
    })

    await waitFor(() => expect(savePreferences).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: /忽略建议 剧情/ }))

    act(() => {
      resolveSecondSave(savePreferences.mock.calls[1][0])
    })

    await waitFor(() => expect(savePreferences).toHaveBeenCalledTimes(3))

    await waitFor(() =>
      expect(savePreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({
          favoriteKeywordSuggestions: expect.arrayContaining([
            expect.objectContaining({ id: 's1', status: 'ignored' }),
            expect.objectContaining({ id: 's2', status: 'ignored' }),
            expect.objectContaining({ id: 's3', status: 'ignored' })
          ])
        })
      )
    )
  })

  it('hides processed keyword suggestions from settings', async () => {
    installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({
            favoriteKeywordSuggestions: [
              {
                id: 's1',
                action: 'downgrade-to-weak',
                ledgerId: 'game',
                keyword: '实况',
                reason: '已采纳的弱词。',
                source: 'deepseek',
                status: 'accepted',
                createdAt: '2026-07-05T00:00:00.000Z'
              },
              {
                id: 's2',
                action: 'downgrade-to-weak',
                ledgerId: 'game',
                keyword: '攻略',
                reason: '已忽略的弱词。',
                source: 'user',
                status: 'ignored',
                createdAt: '2026-07-05T00:01:00.000Z'
              }
            ]
          })
        })
      )
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))

    expect(screen.queryByText('实况')).not.toBeInTheDocument()
    expect(screen.queryByText('攻略')).not.toBeInTheDocument()
    expect(screen.getByText('暂无 DeepSeek 建议')).toBeInTheDocument()
  })

  it('removes keyword suggestions from the visible list after handling them', async () => {
    const { savePreferences } = installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({
            favoriteKeywordSuggestions: [
              {
                id: 's1',
                action: 'downgrade-to-weak',
                ledgerId: 'game',
                keyword: '实况',
                reason: '弱词更适合。',
                source: 'deepseek',
                status: 'pending',
                createdAt: '2026-07-05T00:00:00.000Z'
              }
            ]
          })
        })
      )
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    fireEvent.click(screen.getByRole('button', { name: /忽略建议 实况/ }))

    await waitFor(() =>
      expect(savePreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({
          favoriteKeywordSuggestions: expect.arrayContaining([
            expect.objectContaining({ id: 's1', status: 'ignored' })
          ])
        })
      )
    )

    expect(screen.queryByText('实况')).not.toBeInTheDocument()
    expect(screen.getByText('暂无 DeepSeek 建议')).toBeInTheDocument()
  })

  it('shows correction records without folding controls', async () => {
    installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({
            favoriteCorrectionRecords: [
              {
                id: 'c1',
                aid: 1,
                title: '东京旅行攻略',
                originalLedgerId: 'game',
                userLedgerIds: ['life-interest'],
                source: 'user',
                feedbackType: 'strong-correction',
                sourceScene: 'archive-preview',
                tags: ['旅行'],
                matchedKeywords: ['攻略'],
                createdAt: '2026-07-05T00:00:00.000Z',
                confirmedAt: '2026-07-05T00:01:00.000Z'
              }
            ]
          })
        })
      )
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))

    expect(screen.getByText('东京旅行攻略')).toBeInTheDocument()
    expect(screen.getByText(/原建议：游戏专区/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /展开纠错 东京旅行攻略/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /收起纠错 东京旅行攻略/ })).not.toBeInTheDocument()
  })

  it('keeps correction reference records compact and shows processed DeepSeek suggestions separately', async () => {
    const savePreferences = vi.fn().mockImplementation(async (preferences: AssistantPreferences) => preferences)
    installDesktopApi({
      savePreferences,
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({
            favoriteCorrectionRecords: [
              {
                id: 'c1',
                aid: 1,
                title: '东京旅行攻略',
                originalLedgerId: 'game',
                userLedgerIds: ['life-interest'],
                source: 'user',
                feedbackType: 'strong-correction',
                sourceScene: 'archive-preview',
                tags: ['旅行'],
                matchedKeywords: ['攻略'],
                createdAt: '2026-07-05T00:00:00.000Z',
                confirmedAt: '2026-07-05T00:01:00.000Z'
              }
            ],
            favoriteKeywordSuggestions: [
              {
                id: 'pending-keyword',
                action: 'add-keyword',
                ledgerId: 'knowledge',
                keyword: '机器学习',
                reason: '新词可帮助后续分类。',
                source: 'deepseek',
                status: 'pending',
                createdAt: '2026-07-05T00:00:00.000Z'
              },
              {
                id: 'accepted-keyword',
                action: 'replace-with-combination',
                ledgerId: 'game',
                keyword: '攻略',
                replacement: '游戏攻略',
                reason: '弱词已替换为组合词。',
                source: 'deepseek',
                status: 'accepted',
                createdAt: '2026-07-05T00:02:00.000Z'
              }
            ]
          })
        })
      )
    })

    const { container } = render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))

    expect(screen.getByRole('list', { name: '纠错参考记录' })).toHaveClass(
      'assistant-settings__record-track'
    )
    expect(screen.getByRole('list', { name: '待处理 DeepSeek 建议' })).toHaveClass(
      'assistant-settings__record-track'
    )
    expect(screen.getByText('机器学习')).toBeInTheDocument()
    expect(screen.queryByText('游戏攻略')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '已处理' }))

    expect(screen.getByRole('list', { name: '已处理 DeepSeek 建议' })).toHaveClass(
      'assistant-settings__record-track'
    )
    expect(screen.getByText('游戏攻略')).toBeInTheDocument()
    expect(container.querySelectorAll('.assistant-settings__record-card')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: '撤回建议 攻略' }))

    await waitFor(() =>
      expect(savePreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({
          favoriteKeywordSuggestions: expect.arrayContaining([
            expect.objectContaining({ id: 'accepted-keyword', status: 'pending' })
          ])
        })
      )
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      '已撤回到待处理，收藏夹关键词不自动回滚。'
    )

    fireEvent.click(screen.getByRole('button', { name: '待处理' }))

    expect(screen.getByRole('list', { name: '待处理 DeepSeek 建议' })).toHaveTextContent('游戏攻略')
  })

  it('runs startup diagnostics from settings', async () => {
    const runStartupDiagnostics = vi.fn().mockResolvedValue({
      ok: true,
      checkedAt: '2026-07-03T00:00:00.000Z',
      items: [
        {
          id: 'bilibili-network',
          label: 'B 站网络',
          status: 'ok',
          message: '已能访问 B 站。'
        },
        {
          id: 'media-tools',
          label: '本地媒体工具',
          status: 'ok',
          message: '媒体工具已就绪。'
        }
      ]
    })
    installDesktopApi({ runStartupDiagnostics })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    fireEvent.click(screen.getByRole('button', { name: '运行诊断' }))

    await waitFor(() => expect(runStartupDiagnostics).toHaveBeenCalledOnce())
    expect(await screen.findByRole('list', { name: '设置诊断结果' })).toBeInTheDocument()
    expect(screen.getByText('B 站网络')).toBeInTheDocument()
    expect(screen.getByText('当前 B 站页面')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('全局提示')).toHaveTextContent('诊断完成。'))
  })

  it('marks DeepSeek as connected when settings diagnostics succeeds', async () => {
    const runStartupDiagnostics = vi.fn().mockResolvedValue({
      ok: true,
      checkedAt: '2026-07-03T00:00:00.000Z',
      items: [
        {
          id: 'deepseek',
          label: 'DeepSeek 连接',
          status: 'ok',
          message: 'DeepSeek 连接成功。'
        }
      ]
    })
    installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({
            deepseekEnabled: true,
            deepseekApiKeyStored: true,
            deepseekModel: 'deepseek-v4-pro',
            deepseekBaseUrl: 'https://api.yunshulink.com/v1'
          })
        })
      ),
      runStartupDiagnostics
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    expect(screen.getByLabelText('DeepSeek状态')).toHaveTextContent('DeepSeek 待测试')
    fireEvent.click(screen.getByRole('button', { name: '运行诊断' }))

    await waitFor(() => expect(runStartupDiagnostics).toHaveBeenCalledOnce())
    await waitFor(() =>
      expect(screen.getByLabelText('DeepSeek状态')).toHaveTextContent('DeepSeek 已连接')
    )
    expect(screen.getByLabelText('DeepSeek状态')).toHaveAttribute('data-tone', 'ok')
  })

  it('keeps local audio transcription out of the DeepSeek work list', async () => {
    installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({ deepseekEnabled: true, deepseekApiKeyStored: true })
        })
      ),
      loadVideoAudioTranscriptionQueue: vi.fn().mockResolvedValue({
        activeItemId: 'bvid:BV-local',
        items: [
          {
            id: 'bvid:BV-local',
            url: 'https://www.bilibili.com/video/BV-local',
            title: '只在本地转写的视频',
            bvid: 'BV-local',
            status: 'running',
            createdAt: '2026-07-11T00:00:00.000Z',
            updatedAt: '2026-07-11T00:01:00.000Z',
            progress: {
              step: 'transcribing-segment',
              message: 'Transcribing audio.',
              segmentIndex: 1,
              segmentCount: 2
            }
          }
        ]
      })
    })

    render(<FloatingAssistantApp />)

    await waitFor(() =>
      expect(screen.getByLabelText('转写音频状态')).toHaveAttribute(
        'title',
        expect.stringContaining('只在本地转写的视频')
      )
    )
    expect(screen.getByLabelText('DeepSeek状态')).toHaveTextContent('DeepSeek 待测试')
    expect(screen.getByLabelText('DeepSeek状态')).not.toHaveAttribute(
      'title',
      expect.stringContaining('只在本地转写的视频')
    )
  })

  it('lists a transcription queue item only after DeepSeek summary generation starts', async () => {
    installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({ deepseekEnabled: true, deepseekApiKeyStored: true })
        })
      ),
      loadVideoAudioTranscriptionQueue: vi.fn().mockResolvedValue({
        activeItemId: 'bvid:BV-summary',
        items: [
          {
            id: 'bvid:BV-summary',
            url: 'https://www.bilibili.com/video/BV-summary',
            title: '正在总结的视频',
            bvid: 'BV-summary',
            status: 'running',
            createdAt: '2026-07-11T00:00:00.000Z',
            updatedAt: '2026-07-11T00:01:00.000Z',
            progress: { step: 'summarizing-deepseek', message: 'Generating DeepSeek summary.' }
          }
        ]
      })
    })

    render(<FloatingAssistantApp />)

    await waitFor(() =>
      expect(screen.getByLabelText('DeepSeek状态')).toHaveTextContent('DeepSeek 工作中')
    )
    expect(screen.getByLabelText('DeepSeek状态')).toHaveAttribute(
      'title',
      expect.stringContaining('文稿总结：正在总结的视频')
    )
  })

  it.each([
    {
      configured: false,
      expectedLabel: 'DeepSeek 待配置',
      expectedTone: 'warn'
    },
    {
      configured: true,
      expectedLabel: 'DeepSeek 连接失败',
      expectedTone: 'error'
    }
  ])(
    'maps unsuccessful DeepSeek diagnostics from configured=$configured to the status light',
    async ({ configured, expectedLabel, expectedTone }) => {
      const runStartupDiagnostics = vi.fn().mockResolvedValue({
        ok: false,
        checkedAt: '2026-07-03T00:00:00.000Z',
        items: [
          {
            id: 'deepseek',
            label: 'DeepSeek 连接',
            status: 'warning',
            message: 'DeepSeek 当前不可用。'
          }
        ]
      })
      installDesktopApi({
        requestAssistantSnapshot: vi.fn().mockResolvedValue(
          createSnapshot({
            preferences: createPreferences({
              deepseekEnabled: true,
              deepseekApiKeyStored: configured
            })
          })
        ),
        runStartupDiagnostics
      })

      render(<FloatingAssistantApp />)

      fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
      fireEvent.click(screen.getByRole('button', { name: '运行诊断' }))

      await waitFor(() => expect(runStartupDiagnostics).toHaveBeenCalledOnce())
      await waitFor(() =>
        expect(screen.getByLabelText('DeepSeek状态')).toHaveTextContent(expectedLabel)
      )
      expect(screen.getByLabelText('DeepSeek状态')).toHaveAttribute('data-tone', expectedTone)
    }
  )

  it('can collapse and expand long settings diagnostics', async () => {
    const runStartupDiagnostics = vi.fn().mockResolvedValue({
      ok: true,
      checkedAt: '2026-07-03T00:00:00.000Z',
      items: [
        {
          id: 'bilibili-network',
          label: 'B 站网络',
          status: 'ok',
          message: '已能访问 B 站。'
        }
      ]
    })
    installDesktopApi({ runStartupDiagnostics })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    fireEvent.click(screen.getByRole('button', { name: '运行诊断' }))

    expect(await screen.findByRole('list', { name: '设置诊断结果' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '收起诊断' }))

    expect(screen.queryByRole('list', { name: '设置诊断结果' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '展开诊断' }))

    expect(await screen.findByRole('list', { name: '设置诊断结果' })).toBeInTheDocument()
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

  it.each([
    [/赏.*轻赏此条/, '主人，当前还没打开视频，小咪不能帮这条点喜欢。'],
    [/藏.*归入内库/, '主人，当前还没打开视频，小咪不能把这条归入 bilimi。'],
    [/赐.*投币厚赏/, '主人，当前还没打开视频，小咪不能给这条投币。'],
    [/表.*拟奏短评/, '主人，当前还没打开视频，小咪不能帮这条拟短评。']
  ])('tells the concrete no-video reason through 小咪 for %s failures', async (buttonName, petHint) => {
    const preferences = createPreferences({ commentSubmitMode: 'random' })
    const setAssistantPetHint = vi.fn()
    installDesktopApi({
      setAssistantPetHint,
      requestAssistantSnapshot: vi.fn().mockResolvedValue(createSnapshot({ preferences })),
      runAssistantAction: vi.fn().mockResolvedValue({
        ok: false,
        steps: [],
        missingTargets: ['current-video'],
        message: '暂无视频，请先打开一个视频。'
      })
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('button', { name: buttonName }))

    expect(await screen.findByRole('alert')).toHaveTextContent('暂无视频，请先打开一个视频。')
    await waitFor(() =>
      expect(
        setAssistantPetHint.mock.calls.some(
          ([hint]) => hint?.tone === 'error' && hint.message === petHint
        )
      ).toBe(true)
    )
    expect(
      setAssistantPetHint.mock.calls.some(([hint]) =>
        /看一眼提示|放在面板里|留给你看/.test(hint?.message ?? '')
      )
    ).toBe(false)
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

  it('dismisses local review action details while keeping global feedback when switching pages', async () => {
    installDesktopApi({
      runAssistantAction: vi.fn().mockResolvedValue({
        ok: true,
        steps: ['like:already-liked'],
        missingTargets: [],
        message: 'Saved to bilimi.'
      })
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByTestId('review-action-like'))

    expect(await screen.findByRole('status')).toHaveTextContent('Saved to bilimi.')
    expect(screen.getByLabelText('全局提示')).toHaveTextContent('Saved to bilimi.')
    expect(screen.getByText('like:already-liked')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('tab')[1])

    expect(screen.getByLabelText('全局提示')).toHaveTextContent('Saved to bilimi.')
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
    const choices = getLocalCommentChoices()
    expect(choices).toHaveLength(3)
    expect(choices[0]).not.toHaveTextContent(/小咪|主人|特派|再接再厉/)
    expect(choices.every((choice) => choice.textContent?.includes('李老师讲AI'))).toBe(true)

    fireEvent.click(choices[0])

    await waitFor(() =>
      expect(runAssistantAction).toHaveBeenCalledWith(
        '表',
        expect.objectContaining({
          commentDraft: choices[0].textContent,
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
    await screen.findByRole('dialog', { name: '小咪推荐评论' })
    const choices = getLocalCommentChoices()
    expect(choices).toHaveLength(3)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    fireEvent.click(choices[0])

    await waitFor(() =>
      expect(runAssistantAction).toHaveBeenCalledWith(
        '表',
        expect.objectContaining({
          commentDraft: choices[0].textContent,
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
    const choices = getLocalCommentChoices()
    expect(choices).toHaveLength(3)

    fireEvent.click(choices[0])

    await waitFor(() =>
      expect(runAssistantAction).toHaveBeenCalledWith(
        '表',
        expect.objectContaining({
          commentDraft: choices[0].textContent,
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

    expect(saveFavoriteLedgers).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '加入同步 bilimi·Test' }))
    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() =>
      expect(saveFavoriteLedgers).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            displayName: 'bilimi·Test',
            keywords: ['test', 'video'],
            enabled: true,
            isDefault: false
          })
        ])
      )
    )
  })

  it('shows the active DeepSeek task while AI comments are being generated', async () => {
    const preferences = createPreferences({
      deepseekEnabled: true,
      deepseekApiKeyStored: true,
      deepseekCommentEnabled: true,
      commentSubmitMode: 'choose'
    })
    const commentGeneration = createDeferred<Awaited<ReturnType<NonNullable<Window['bilimiDesktop']['generateDeepSeek']>>>>()
    installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(createSnapshot({ preferences })),
      generateDeepSeek: vi.fn(() => commentGeneration.promise)
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByTestId('review-action-comment'))

    await waitFor(() => expect(screen.getByLabelText('DeepSeek状态')).toHaveTextContent('DeepSeek 工作中'))
    expect(screen.getByLabelText('DeepSeek状态')).toHaveAttribute('data-tone', 'running')
    expect(screen.getByLabelText('DeepSeek状态')).toHaveAttribute(
      'title',
      expect.stringContaining('• 趣评生成：三分钟讲清机器学习科普教程')
    )
    expect(screen.getByLabelText('DeepSeek状态')).toHaveAttribute(
      'title',
      expect.stringContaining('批阅辅助：开启（全部归类）')
    )

    commentGeneration.resolve({
      kind: 'review-comment',
      comments: ['AI comment one', 'AI comment two', 'AI comment three']
    })

    await screen.findByText('AI comment one')
    await waitFor(() =>
      expect(screen.getByLabelText('DeepSeek状态')).toHaveTextContent('DeepSeek 已连接')
    )
  })

  it('marks ledger status as unbacked after syncing every ledger out of backup', async () => {
    const backedLedgers = createDefaultFavoriteLedgers().map((ledger, index) => ({
      ...ledger,
      enabled: true,
      bilibiliFolderId: String(9001 + index)
    }))
    const clearedLedgers = backedLedgers.map((ledger) => ({
      ...ledger,
      enabled: false
    }))
    const requestAssistantSnapshot = vi
      .fn()
      .mockResolvedValueOnce(
        createSnapshot({
          preferences: createPreferences({ favoriteLedgers: backedLedgers }),
          favoriteLedgerStatus: {
            ok: true,
            ledgers: backedLedgers,
            missingLedgerIds: [],
            message: '册目查验已毕。'
          }
        })
      )
      .mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({ favoriteLedgers: clearedLedgers }),
          favoriteLedgerStatus: {
            ok: true,
            ledgers: clearedLedgers,
            missingLedgerIds: [],
            message: '册目查验已毕。'
          }
        })
      )
    const saveFavoriteLedgers = vi.fn().mockResolvedValue(createResult('掌库已同步。'))
    installDesktopApi({ requestAssistantSnapshot, saveFavoriteLedgers })

    render(<FloatingAssistantApp />)

    await waitFor(() => expect(screen.getByLabelText('整理状态')).toHaveTextContent('已备册'))
    fireEvent.click(screen.getByRole('tab', { name: '掌库' }))
    fireEvent.click(screen.getByRole('button', { name: '取消全选' }))
    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() => expect(screen.getByLabelText('整理状态')).toHaveTextContent('未备册'))
    expect(screen.getByLabelText('整理状态')).toHaveAttribute('data-tone', 'error')
    expect(screen.getByLabelText('全局提示')).toHaveTextContent('请到掌库备册后再开始整理。')
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

  it('resets visible assistant settings from the settings header without clearing ledgers', async () => {
    const ledgers = createDefaultFavoriteLedgers()
    const customPreferences = createPreferences({
      favoriteLedgers: ledgers,
      petStyle: 'classic',
      petHoverShortcuts: ['assistant', 'library'],
      hidePetDuringVideoFullscreen: true,
      favoriteArchiveMultiMode: 'three',
      defaultCoinCount: 2,
      commentSubmitMode: 'choose',
      deepseekEnabled: true,
      deepseekCommentEnabled: true,
      deepseekAutoSummaryEnabled: true,
      deepseekPetChatEnabled: true,
      deepseekModel: 'deepseek-chat',
      deepseekBaseUrl: 'https://api.deepseek.local',
      assistantSidebarWidthPx: 420,
      videoAudioTranscriptionThreadLimit: 2
    })
    const { savePreferences, clearDeepSeekApiKey } = installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: customPreferences
        })
      )
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    fireEvent.click(screen.getByRole('button', { name: '重置设置' }))

    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          favoriteLedgers: ledgers,
          petStyle: 'big-head',
          hidePetDuringVideoFullscreen: false,
          favoriteArchiveMultiMode: 'off',
          defaultCoinCount: 2,
          commentSubmitMode: 'choose',
          deepseekEnabled: false,
          deepseekCommentEnabled: true,
          deepseekAutoSummaryEnabled: true,
          deepseekPetChatEnabled: true,
          deepseekDailyClassificationEnabled: true,
          deepseekArchiveOrganizationEnabled: true,
          deepseekModel: 'deepseek-v4-flash',
          deepseekBaseUrl: 'https://api.deepseek.com',
          assistantSidebarWidthPx: null,
          videoAudioTranscriptionThreadLimit: 'unlimited'
        })
      )
    )
    expect(clearDeepSeekApiKey).toHaveBeenCalledOnce()
    expect(screen.getByRole('radio', { name: '萌版大头' })).toBeChecked()
    expect(
      screen.getByRole('radio', { name: '生成 3 条候选，选择后发送（也可以复制后发评论）' })
    ).toBeChecked()
  })

  it('restores the default layout size from the settings header without clearing settings', async () => {
    const restoreDefaultLayoutSize = vi.fn().mockResolvedValue(undefined)
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)

    installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({
            assistantSidebarWidthPx: 486,
            deepseekEnabled: true,
            favoriteArchiveMultiMode: 'three'
          })
        })
      ),
      restoreDefaultLayoutSize,
      savePreferences
    } as Partial<Window['bilimiDesktop']>)

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    fireEvent.click(screen.getByRole('button', { name: '恢复默认布局' }))

    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          assistantSidebarWidthPx: null,
          deepseekEnabled: true,
          favoriteArchiveMultiMode: 'three'
        })
      )
    )
    expect(restoreDefaultLayoutSize).toHaveBeenCalledOnce()
    await waitFor(() =>
      expect(screen.getByLabelText('全局提示')).toHaveTextContent('布局大小已恢复默认。')
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('saves the local audio transcription thread limit from settings', async () => {
    const { savePreferences } = installDesktopApi()

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))

    expect(screen.getByRole('group', { name: '视频音频转写速度' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '无限制（最快，占用最高）' })).toBeChecked()

    fireEvent.click(screen.getByRole('radio', { name: '限制为 2 线程（平衡）' }))

    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          videoAudioTranscriptionThreadLimit: 2
        })
      )
    )
    expect(screen.getByRole('radio', { name: '限制为 2 线程（平衡）' })).toBeChecked()
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

  it('updates review action settings before the background save resolves', async () => {
    let resolveSave!: (preferences: AssistantPreferences) => void
    const savePreferences = vi.fn(
      (preferences: AssistantPreferences) =>
        new Promise<AssistantPreferences>((resolve) => {
          resolveSave = resolve
        })
    )
    installDesktopApi({ savePreferences })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    fireEvent.click(screen.getByRole('radio', { name: '默认投 2 枚硬币' }))

    expect(screen.getByRole('radio', { name: '默认投 2 枚硬币' })).toBeChecked()
    expect(savePreferences).not.toHaveBeenCalled()

    await waitFor(() => expect(savePreferences).toHaveBeenCalledOnce())
    await act(async () => {
      resolveSave(createPreferences({ defaultCoinCount: 2 }))
    })
  })

  it('keeps rapid settings clicks merged against the latest local preferences', async () => {
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    installDesktopApi({ savePreferences })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    fireEvent.click(screen.getByRole('radio', { name: '默认投 2 枚硬币' }))
    fireEvent.click(
      screen.getByRole('radio', {
        name: '生成 3 条候选，选择后发送（也可以复制后发评论）'
      })
    )

    await waitFor(() =>
      expect(savePreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({
          commentSubmitMode: 'choose',
          defaultCoinCount: 2
        })
      )
    )
  })

  it('preserves externally resized sidebar width when saving review action settings', async () => {
    let notifyPreferencesChanged: ((preferences: AssistantPreferences) => void) | undefined
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    installDesktopApi({
      savePreferences,
      onAssistantPreferencesChanged: vi.fn((callback) => {
        notifyPreferencesChanged = callback
        return vi.fn()
      })
    })

    render(<FloatingAssistantApp />)

    await screen.findByRole('tab', { name: '设置' })

    act(() => {
      notifyPreferencesChanged?.(createPreferences({ assistantSidebarWidthPx: 420 }))
    })

    fireEvent.click(screen.getByRole('tab', { name: '设置' }))
    fireEvent.click(screen.getByRole('radio', { name: '默认投 2 枚硬币' }))

    await waitFor(() =>
      expect(savePreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({
          assistantSidebarWidthPx: 420,
          defaultCoinCount: 2
        })
      )
    )
  })

  it('synchronizes externally changed DeepSeek settings when sidebar width is unchanged', async () => {
    let notifyPreferencesChanged: ((preferences: AssistantPreferences) => void) | undefined
    installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({
            deepseekEnabled: true,
            deepseekApiKeyStored: true
          })
        })
      ),
      onAssistantPreferencesChanged: vi.fn((callback) => {
        notifyPreferencesChanged = callback
        return vi.fn()
      })
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    expect(screen.getByLabelText('DeepSeek 模型')).toHaveValue('deepseek-v4-flash')
    expect(screen.getByLabelText('DeepSeek 服务地址')).toHaveValue('https://api.deepseek.com')

    act(() => {
      notifyPreferencesChanged?.(
        createPreferences({
          deepseekEnabled: true,
          deepseekApiKeyStored: true,
          deepseekModel: 'deepseek-v4-pro',
          deepseekBaseUrl: 'https://api.yunshulink.com/v1',
          assistantSidebarWidthPx: null
        })
      )
    })

    expect(screen.getByLabelText('DeepSeek 模型')).toHaveValue('deepseek-v4-pro')
    expect(screen.getByLabelText('DeepSeek 服务地址')).toHaveValue(
      'https://api.yunshulink.com/v1'
    )
  })

  it('lists concurrent DeepSeek work without clearing unrelated tasks', async () => {
    installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({ deepseekEnabled: true, deepseekApiKeyStored: true })
        })
      )
    })
    render(<FloatingAssistantApp />)
    await screen.findByLabelText('DeepSeek状态')

    const finishClassification = publishDeepSeekTask({
      id: 'classification:video',
      kind: 'classification',
      detail: '分类二判：当前视频'
    })
    const finishArchive = publishDeepSeekTask({
      id: 'archive:round',
      kind: 'archive-organize',
      detail: '旧藏整理：第 2 / 5 批'
    })

    await waitFor(() =>
      expect(screen.getByLabelText('DeepSeek状态')).toHaveAttribute(
        'title',
        expect.stringContaining('分类二判：当前视频')
      )
    )
    expect(screen.getByLabelText('DeepSeek状态')).toHaveAttribute(
      'title',
      expect.stringContaining('旧藏整理：第 2 / 5 批')
    )

    finishClassification()
    await waitFor(() =>
      expect(screen.getByLabelText('DeepSeek状态')).not.toHaveAttribute(
        'title',
        expect.stringContaining('分类二判：当前视频')
      )
    )
    expect(screen.getByLabelText('DeepSeek状态')).toHaveTextContent('DeepSeek 工作中')
    expect(screen.getByLabelText('DeepSeek状态')).toHaveAttribute(
      'title',
      expect.stringContaining('旧藏整理：第 2 / 5 批')
    )

    finishArchive()
    await waitFor(() =>
      expect(screen.getByLabelText('DeepSeek状态')).toHaveTextContent('DeepSeek 待测试')
    )
  })

  it('keeps local and cross-window DeepSeek tasks visible together', async () => {
    const commentGeneration = createDeferred<
      Awaited<ReturnType<NonNullable<Window['bilimiDesktop']['generateDeepSeek']>>>
    >()
    installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({
            deepseekEnabled: true,
            deepseekApiKeyStored: true,
            deepseekCommentEnabled: true,
            commentSubmitMode: 'choose'
          })
        })
      ),
      generateDeepSeek: vi.fn(() => commentGeneration.promise)
    })
    render(<FloatingAssistantApp />)
    fireEvent.click(await screen.findByTestId('review-action-comment'))

    const finishClassification = publishDeepSeekTask({
      id: 'classification:other-window',
      kind: 'classification',
      detail: '分类二判：另一条视频'
    })

    await waitFor(() => {
      const title = screen.getByLabelText('DeepSeek状态').getAttribute('title') ?? ''
      expect(title).toContain('趣评生成：三分钟讲清机器学习科普教程')
      expect(title).toContain('分类二判：另一条视频')
    })

    finishClassification()
    commentGeneration.resolve({
      kind: 'review-comment',
      comments: ['AI comment one', 'AI comment two', 'AI comment three']
    })
    await screen.findByText('AI comment one')
  })

  it('does not resave a DeepSeek preference broadcast that acknowledges the active save', async () => {
    let notifyPreferencesChanged: ((preferences: AssistantPreferences) => void) | undefined
    let resolveSave!: (preferences: AssistantPreferences) => void
    const savePreferences = vi.fn(
      (preferences: AssistantPreferences) =>
        new Promise<AssistantPreferences>((resolve) => {
          resolveSave = resolve
        })
    )
    installDesktopApi({
      savePreferences,
      onAssistantPreferencesChanged: vi.fn((callback) => {
        notifyPreferencesChanged = callback
        return vi.fn()
      })
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '启用 DeepSeek' }))

    await waitFor(() => expect(savePreferences).toHaveBeenCalledOnce())

    act(() => {
      notifyPreferencesChanged?.(savePreferences.mock.calls[0][0])
    })

    await act(async () => {
      resolveSave(savePreferences.mock.calls[0][0])
    })

    await new Promise((resolve) => window.setTimeout(resolve, 50))

    expect(savePreferences).toHaveBeenCalledOnce()
  })

  it('merges external DeepSeek settings into a pending local preference save', async () => {
    let notifyPreferencesChanged: ((preferences: AssistantPreferences) => void) | undefined
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    installDesktopApi({
      savePreferences,
      onAssistantPreferencesChanged: vi.fn((callback) => {
        notifyPreferencesChanged = callback
        return vi.fn()
      })
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    fireEvent.click(screen.getByRole('radio', { name: '默认投 2 枚硬币' }))

    act(() => {
      notifyPreferencesChanged?.(
        createPreferences({
          deepseekEnabled: true,
          deepseekApiKeyStored: true,
          deepseekModel: 'deepseek-v4-pro',
          deepseekBaseUrl: 'https://api.yunshulink.com/v1'
        })
      )
    })

    expect(screen.getByLabelText('DeepSeek 模型')).toHaveValue('deepseek-v4-pro')
    expect(screen.getByLabelText('DeepSeek 服务地址')).toHaveValue(
      'https://api.yunshulink.com/v1'
    )
    await waitFor(() =>
      expect(savePreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({
          defaultCoinCount: 2,
          deepseekModel: 'deepseek-v4-pro',
          deepseekBaseUrl: 'https://api.yunshulink.com/v1'
        })
      )
    )
  })

  it('merges externally changed structured preferences into a pending local save', async () => {
    let notifyPreferencesChanged: ((preferences: AssistantPreferences) => void) | undefined
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    installDesktopApi({
      savePreferences,
      onAssistantPreferencesChanged: vi.fn((callback) => {
        notifyPreferencesChanged = callback
        return vi.fn()
      })
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    fireEvent.click(screen.getByRole('radio', { name: '默认投 2 枚硬币' }))
    const externallyChangedLedgers = createDefaultFavoriteLedgers().map((ledger, index) =>
      index === 0 ? { ...ledger, displayName: 'bilimi·外部更新' } : ledger
    )

    act(() => {
      notifyPreferencesChanged?.(
        createPreferences({
          favoriteLedgers: externallyChangedLedgers
        })
      )
    })

    await waitFor(() =>
      expect(savePreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({
          defaultCoinCount: 2,
          favoriteLedgers: expect.arrayContaining([
            expect.objectContaining({ displayName: 'bilimi·外部更新' })
          ])
        })
      )
    )
  })

  it('updates a pending review action settings save when the sidebar is resized before debounce drains', async () => {
    let notifyPreferencesChanged: ((preferences: AssistantPreferences) => void) | undefined
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) => preferences)
    installDesktopApi({
      savePreferences,
      onAssistantPreferencesChanged: vi.fn((callback) => {
        notifyPreferencesChanged = callback
        return vi.fn()
      })
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    fireEvent.click(screen.getByRole('radio', { name: '默认投 2 枚硬币' }))

    expect(savePreferences).not.toHaveBeenCalled()

    act(() => {
      notifyPreferencesChanged?.(createPreferences({ assistantSidebarWidthPx: 420 }))
    })

    await waitFor(() =>
      expect(savePreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({
          assistantSidebarWidthPx: 420,
          defaultCoinCount: 2
        })
      )
    )
  })

  it('keeps externally resized sidebar width after an older review action settings save resolves', async () => {
    let notifyPreferencesChanged: ((preferences: AssistantPreferences) => void) | undefined
    let resolveSave!: (preferences: AssistantPreferences) => void
    const savePreferences = vi
      .fn<(preferences: AssistantPreferences) => Promise<AssistantPreferences>>()
      .mockImplementationOnce(
        (preferences: AssistantPreferences) =>
          new Promise<AssistantPreferences>((resolve) => {
            resolveSave = resolve
          })
      )
      .mockImplementation(async (preferences: AssistantPreferences) => preferences)
    installDesktopApi({
      savePreferences,
      onAssistantPreferencesChanged: vi.fn((callback) => {
        notifyPreferencesChanged = callback
        return vi.fn()
      })
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    fireEvent.click(screen.getByRole('radio', { name: '默认投 2 枚硬币' }))

    await waitFor(() => expect(savePreferences).toHaveBeenCalledOnce())
    expect(savePreferences).toHaveBeenLastCalledWith(
      expect.objectContaining({
        assistantSidebarWidthPx: null,
        defaultCoinCount: 2
      })
    )

    act(() => {
      notifyPreferencesChanged?.(createPreferences({ assistantSidebarWidthPx: 420 }))
    })

    act(() => {
      notifyPreferencesChanged?.(savePreferences.mock.calls[0][0])
    })

    await act(async () => {
      resolveSave(savePreferences.mock.calls[0][0])
    })

    fireEvent.click(
      screen.getByRole('radio', {
        name: '生成 3 条候选，选择后发送（也可以复制后发评论）'
      })
    )

    await waitFor(() =>
      expect(savePreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({
          assistantSidebarWidthPx: 420,
          commentSubmitMode: 'choose',
          defaultCoinCount: 2
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
    const savePreferences = vi.fn(async (preferences: AssistantPreferences) =>
      createPreferences({
        ...preferences,
        defaultCoinCount: 2
      })
    )
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
    fireEvent.click(getLocalCommentChoices()[0])

    await waitFor(() =>
      expect(runAssistantAction).toHaveBeenCalledWith(
        '表',
        expect.objectContaining({
          submitComment: true
        })
      )
    )
  })

  it('keeps open comment choices when running a different review action for the same video', async () => {
    const { runAssistantAction } = installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({ preferences: createPreferences({ commentSubmitMode: 'choose' }) })
      )
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('button', { name: /表.*拟奏短评/ }))
    expect(screen.getByText('小咪拟好三条，主人点一条就发送。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /藏.*归入内库/ }))

    expect(screen.getByText('小咪拟好三条，主人点一条就发送。')).toBeInTheDocument()
    await waitFor(() =>
      expect(runAssistantAction).toHaveBeenCalledWith(
        '藏',
        expect.objectContaining({
          pageClickOnly: false
        })
      )
    )
  })

  it('clears open comment choices when the active video changes', async () => {
    let snapshotChanged: (() => void) | undefined
    const requestAssistantSnapshot = vi
      .fn()
      .mockResolvedValueOnce(
        createSnapshot({ preferences: createPreferences({ commentSubmitMode: 'choose' }) })
      )
      .mockResolvedValueOnce(
        createSnapshot({
          preferences: createPreferences({ commentSubmitMode: 'choose' }),
          videoContentContext: {
            title: '新的机器学习视频',
            author: '李老师讲AI',
            pageText: '新视频内容'
          },
          videoTitle: '新的机器学习视频',
          activeTabUrl: 'https://www.bilibili.com/video/BV2note'
        })
      )
    installDesktopApi({
      requestAssistantSnapshot,
      onAssistantSnapshotChanged: vi.fn((callback) => {
        snapshotChanged = callback
        return vi.fn()
      })
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('button', { name: /表.*拟奏短评/ }))
    expect(screen.getByText('小咪拟好三条，主人点一条就发送。')).toBeInTheDocument()

    await act(async () => {
      snapshotChanged?.()
    })

    expect(screen.queryByText('小咪拟好三条，主人点一条就发送。')).not.toBeInTheDocument()
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
            commentDraft: expect.stringContaining('李老师讲AI'),
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

    expect(screen.getByRole('group', { name: '宠物设置' })).toBeInTheDocument()
    expect(screen.queryByText('宠物样式')).not.toBeInTheDocument()
    expect(screen.getByText('宠物快捷操作')).toBeInTheDocument()
    expect(
      screen.getByText('选择常用操作，数字表示显示顺序；点击可启用或停用快捷项，可不选，最多4个。')
    ).toBeInTheDocument()
    const shortcutGroup = screen.getByRole('group', { name: '宠物快捷操作' })
    expect(within(shortcutGroup).getByRole('checkbox', { name: '显示打开小咪按钮' })).toBeChecked()
    expect(within(shortcutGroup).getByRole('button', { name: '赏 轻赏此条 第 1 位' })).toHaveTextContent('1')
    expect(within(shortcutGroup).getByRole('button', { name: '赐 投币厚赏 第 2 位' })).toHaveTextContent('2')
    expect(within(shortcutGroup).queryByRole('button', { name: /咪 打开小咪/ })).not.toBeInTheDocument()
    expect(within(shortcutGroup).getByRole('button', { name: '表 拟奏短评 第 3 位' })).toHaveTextContent('3')
    expect(within(shortcutGroup).getByRole('button', { name: '转 转写音频 第 4 位' })).toHaveTextContent('4')
    expect(within(shortcutGroup).getByRole('button', { name: '库 打开档案库' })).toBeDisabled()

    fireEvent.click(within(shortcutGroup).getByRole('checkbox', { name: '显示打开小咪按钮' }))

    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          showPetAssistantShortcut: false
        })
      )
    )

    fireEvent.click(within(shortcutGroup).getByRole('button', { name: '转 转写音频 第 4 位' }))

    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          petHoverShortcuts: ['like', 'coin', 'comment']
        })
      )
    )

    fireEvent.click(within(shortcutGroup).getByRole('button', { name: '库 打开档案库' }))

    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          petHoverShortcuts: ['like', 'coin', 'comment', 'library']
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
    fireEvent.click(within(shortcutGroup).getByRole('button', { name: '表 拟奏短评 第 3 位' }))
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

  it('saves and tests DeepSeek assistant settings with one action', async () => {
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

    const enabled = screen.getByRole('checkbox', { name: '启用 DeepSeek' })
    fireEvent.click(enabled)

    expect(screen.getByRole('link', { name: '官网：https://yunshulink.com/' })).toHaveAttribute(
      'href',
      'https://yunshulink.com/'
    )
    expect(screen.getByText('致谢 云枢智元')).toBeInTheDocument()
    expect(screen.getByText('大模型 Token 中转，低至官方价 2 折起')).toBeInTheDocument()
    expect(screen.getByText(/令牌分组请选择 deepseek（官方）/)).toBeInTheDocument()
    expect(screen.queryByText(/限时特价/)).not.toBeInTheDocument()
    expect(screen.getByText('（日常便宜）deepseek-v4-flash')).toBeInTheDocument()
    expect(screen.getByText('（精准略贵）deepseek-v4-pro')).toBeInTheDocument()
    expect(screen.getByText('https://api.yunshulink.com/v1')).toBeInTheDocument()
    expect(screen.getByText('推荐模型：').closest('p')).toHaveClass(
      'assistant-settings__recommendation-divider'
    )
    expect(screen.getByText('https://api.yunshulink.com/v1').closest('p')).toHaveClass(
      'assistant-settings__recommendation-divider'
    )
    expect(
      screen.getByText('开启后可使用批阅短评、札记总结、宠物对话和辅助整理。关闭后相关功能入口会提示先开启。')
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '复制日常便宜模型' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('deepseek-v4-flash'))
    fireEvent.click(screen.getByRole('button', { name: '复制精准略贵模型' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('deepseek-v4-pro'))
    await waitFor(() => expect(screen.getByLabelText('全局提示')).toHaveTextContent('已复制精准略贵模型。'))

    fireEvent.click(screen.getByRole('button', { name: '复制服务器地址' }))
    expect(screen.getByRole('button', { name: '复制服务器地址' })).toHaveTextContent('复制')
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://api.yunshulink.com/v1'))
    await waitFor(() => expect(screen.getByLabelText('全局提示')).toHaveTextContent('已复制服务器地址。'))

    expect(screen.getByRole('checkbox', { name: '趣味评论' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '自动总结' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '宠物对话' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '批阅辅助' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '旧藏整理' })).toBeChecked()
    fireEvent.change(screen.getByLabelText('DeepSeek API 密钥'), {
      target: { value: 'sk-test' }
    })
    fireEvent.change(screen.getByLabelText('DeepSeek 模型'), {
      target: { value: 'deepseek-chat' }
    })
    fireEvent.change(screen.getByLabelText('DeepSeek 服务地址'), {
      target: { value: 'https://api.deepseek.local' }
    })

    fireEvent.click(screen.getByRole('button', { name: '保存并测试' }))

    await waitFor(() => expect(saveDeepSeekApiKey).toHaveBeenCalledWith('sk-test'))
    await waitFor(() => {
      const apiKeyInput = screen.getByLabelText<HTMLInputElement>('DeepSeek API 密钥')
      expect(apiKeyInput.value).toBe('')
      expect(apiKeyInput).toHaveAttribute('placeholder', '已保存 · 系统加密保护')
    })
    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          deepseekEnabled: true,
          deepseekApiKeyStored: true,
          deepseekCommentEnabled: true,
          deepseekAutoSummaryEnabled: true,
          deepseekPetChatEnabled: true,
          deepseekDailyClassificationEnabled: true,
          deepseekArchiveOrganizationEnabled: true,
          deepseekDailyClassificationMode: 'all',
          deepseekModel: 'deepseek-chat',
          deepseekBaseUrl: 'https://api.deepseek.local'
        })
      )
    )

    await waitFor(() => expect(testDeepSeekConnection).toHaveBeenCalledOnce())
    expect(saveDeepSeekApiKey).toHaveBeenCalledOnce()
    expect(clearDeepSeekApiKey).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          deepseekEnabled: true,
          deepseekApiKeyStored: true
        })
      )
    )
    await waitFor(() => expect(screen.getByLabelText('全局提示')).toHaveTextContent('DeepSeek 连接成功。'))
    expect(screen.getByLabelText('DeepSeek状态')).toHaveTextContent('DeepSeek 已连接')
    expect(screen.getByLabelText('DeepSeek状态')).toHaveAttribute('data-tone', 'ok')

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '重置 DeepSeek' }))

    await waitFor(() => expect(clearDeepSeekApiKey).toHaveBeenCalledOnce())
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: '启用 DeepSeek' })).not.toBeChecked()
      expect(screen.queryByRole('checkbox', { name: '趣味评论' })).not.toBeInTheDocument()
      expect(screen.queryByRole('checkbox', { name: '自动总结' })).not.toBeInTheDocument()
      expect(screen.queryByRole('checkbox', { name: '宠物对话' })).not.toBeInTheDocument()
      expect(screen.queryByRole('checkbox', { name: '批阅辅助' })).not.toBeInTheDocument()
    })
    expect(screen.queryByLabelText('DeepSeek API 密钥')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('DeepSeek 模型')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('DeepSeek 服务地址')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          deepseekEnabled: false,
          deepseekApiKeyStored: false,
          deepseekCommentEnabled: true,
          deepseekAutoSummaryEnabled: true,
          deepseekPetChatEnabled: true,
          deepseekDailyClassificationEnabled: true,
          deepseekArchiveOrganizationEnabled: true,
          deepseekDailyClassificationMode: 'all',
          deepseekModel: 'deepseek-v4-flash',
          deepseekBaseUrl: 'https://api.deepseek.com'
        })
      )
    )
    await waitFor(() => expect(screen.getByLabelText('全局提示')).toHaveTextContent('DeepSeek 设置已重置。'))
  })

  it('keeps the edited model when saving the API key broadcasts older preferences', async () => {
    let notifyPreferencesChanged: ((preferences: AssistantPreferences) => void) | undefined
    const savedPreferences: AssistantPreferences[] = []
    const oldPreferences = createPreferences({
      deepseekEnabled: true,
      deepseekApiKeyStored: false,
      deepseekModel: 'deepseek-v4-flash',
      deepseekBaseUrl: 'https://api.yunshulink.com/v1'
    })
    installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({ preferences: oldPreferences })
      ),
      onAssistantPreferencesChanged: vi.fn((callback) => {
        notifyPreferencesChanged = callback
        return vi.fn()
      }),
      saveDeepSeekApiKey: vi.fn().mockImplementation(async () => {
        notifyPreferencesChanged?.(
          createPreferences({ ...oldPreferences, deepseekApiKeyStored: true })
        )
        return { configured: true, protection: 'encrypted' as const }
      }),
      savePreferences: vi.fn().mockImplementation(async (preferences: AssistantPreferences) => {
        savedPreferences.push(preferences)
        return preferences
      })
    })

    render(<FloatingAssistantApp />)
    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    fireEvent.change(screen.getByLabelText('DeepSeek API 密钥'), {
      target: { value: 'sk-shared' }
    })
    fireEvent.change(screen.getByLabelText('DeepSeek 模型'), {
      target: { value: 'deepseek-v4-pro' }
    })
    fireEvent.click(screen.getByRole('button', { name: '保存并测试' }))

    await waitFor(() => expect(savedPreferences.length).toBeGreaterThan(0))
    expect(savedPreferences.at(-1)).toEqual(
      expect.objectContaining({
        deepseekApiKeyStored: true,
        deepseekModel: 'deepseek-v4-pro'
      })
    )
    expect(screen.getByLabelText('DeepSeek 模型')).toHaveValue('deepseek-v4-pro')
  })

  it('falls back to the desktop clipboard when browser clipboard writing fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('window is not focused'))
    const writeClipboardText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })
    installDesktopApi({ writeClipboardText })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '启用 DeepSeek' }))
    fireEvent.click(screen.getByRole('button', { name: '复制精准略贵模型' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('deepseek-v4-pro'))
    await waitFor(() => expect(writeClipboardText).toHaveBeenCalledWith('deepseek-v4-pro'))
    expect(screen.getByLabelText('全局提示')).toHaveTextContent('已复制精准略贵模型。')
  })

  it('preserves the DeepSeek key draft when key saving fails', async () => {
    const saveDeepSeekApiKey = vi.fn().mockRejectedValue(new Error('keychain unavailable'))
    installDesktopApi({
      saveDeepSeekApiKey,
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({
            deepseekEnabled: true
          })
        })
      )
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    fireEvent.change(screen.getByLabelText('DeepSeek API 密钥'), {
      target: { value: 'sk-draft' }
    })
    fireEvent.click(screen.getByRole('button', { name: '保存并测试' }))

    await waitFor(() =>
      expect(screen.getByLabelText('全局提示')).toHaveTextContent('DeepSeek 密钥保存失败，请重试。')
    )
    expect(screen.getByLabelText<HTMLInputElement>('DeepSeek API 密钥').value).toBe('sk-draft')
  })

  it('preserves the DeepSeek key draft when preference saving fails after the key is saved', async () => {
    const savePreferences = vi.fn().mockRejectedValue(new Error('store unavailable'))
    installDesktopApi({
      savePreferences,
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({
            deepseekEnabled: true
          })
        })
      )
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    fireEvent.change(screen.getByLabelText('DeepSeek API 密钥'), {
      target: { value: 'sk-draft' }
    })
    fireEvent.click(screen.getByRole('button', { name: '保存并测试' }))

    await waitFor(() =>
      expect(screen.getByLabelText('全局提示')).toHaveTextContent(
        'DeepSeek 密钥已保存，但其他设置保存失败，请重试。'
      )
    )
    expect(screen.getByLabelText<HTMLInputElement>('DeepSeek API 密钥').value).toBe('sk-draft')
  })

  it('shows a recoverable DeepSeek key field error when saved status cannot be read', async () => {
    installDesktopApi({
      loadDeepSeekApiKeyStatus: vi.fn().mockRejectedValue(new Error('credential store unavailable')),
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({
            deepseekEnabled: true
          })
        })
      )
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    const apiKeyInput = await screen.findByLabelText<HTMLInputElement>('DeepSeek API 密钥')

    await waitFor(() => expect(apiKeyInput).toHaveAttribute('placeholder', '无法读取 · 请重新填写'))
    expect(apiKeyInput).toHaveAttribute('aria-invalid', 'true')
  })

  it('persists the DeepSeek auto-summary toggle as soon as it changes', async () => {
    const { savePreferences } = installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({
            deepseekEnabled: true,
            deepseekAutoSummaryEnabled: false
          })
        })
      )
    })

    render(<FloatingAssistantApp />)

    await screen.findAllByRole('tab')
    fireEvent.click(screen.getAllByRole('tab')[3])

    expect(screen.queryByRole('checkbox', { name: '用 DeepSeek 辅助整理旧藏' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: '自动总结' }))

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
            deepseekEnabled: true,
            deepseekAutoSummaryEnabled: true
          })
        })
      )
    })

    render(<FloatingAssistantApp />)

    await screen.findAllByRole('tab')
    fireEvent.click(screen.getAllByRole('tab')[3])

    expect(screen.queryByRole('checkbox', { name: '用 DeepSeek 辅助整理旧藏' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '自动总结' })).toBeChecked()
  })

  it('explains when the DeepSeek test bridge is not available', async () => {
    installDesktopApi({
      testDeepSeekConnection: undefined
    })

    render(<FloatingAssistantApp />)

    await screen.findAllByRole('tab')
    fireEvent.click(screen.getAllByRole('tab')[3])
    fireEvent.click(screen.getByRole('checkbox', { name: '启用 DeepSeek' }))
    fireEvent.click(screen.getByRole('button', { name: '保存并测试' }))

    await waitFor(() =>
      expect(screen.getByLabelText('全局提示')).toHaveTextContent(
        'DeepSeek 测试功能未加载，请重启应用后再试。'
      )
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
    expect(screen.getByLabelText('整理状态')).toHaveTextContent('旧藏扫描中')
    expect(screen.getByLabelText('全局提示')).not.toHaveTextContent('正在扫描旧藏，请稍候。')
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
            targetDisplayName: 'bilimi·影视动漫',
            reviewRequired: false,
            alreadyInTarget: false,
            selected: true,
            originalSuggestedLedgerIds: ['movie-tv'],
            currentTargetLedgerIds: ['movie-tv'],
            selectedTargetLedgerIds: ['movie-tv'],
            lowConfidence: false
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
          targetDisplayName: 'bilimi·暂存',
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
    confirmOldFavoriteExecution()

    await waitFor(() => expect(executeOldFavoritePlan).toHaveBeenCalledTimes(2))
    expect(setAssistantPetHint.mock.calls.some(([hint]) => hint?.tone === 'working')).toBe(true)
    expect(setAssistantPetHint.mock.calls.some(([hint]) => hint?.tone === 'happy')).toBe(true)
    expect(setAssistantPetHint.mock.calls.some(([hint]) => hint?.message.includes('first item done'))).toBe(false)
    expect(setAssistantPetHint.mock.calls.some(([hint]) => hint?.message.includes('second item done'))).toBe(false)
  })

  it('persists confirmed archive preview correction records after old favorite execution', async () => {
    const savePreferences = vi.fn().mockImplementation(async (preferences: AssistantPreferences) => preferences)
    const executeOldFavoritePlan = vi.fn().mockResolvedValue(createResult('old favorite done'))
    const favoriteLedgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'knowledge'
        ? { ...ledger, bilibiliFolderId: '9001' }
        : ledger.id === 'game'
          ? { ...ledger, bilibiliFolderId: '9002' }
          : ledger
    )
    installDesktopApi({
      executeOldFavoritePlan,
      savePreferences,
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({
            favoriteLedgers
          })
        })
      ),
      scanOldFavorites: vi.fn().mockResolvedValue({
        items: [
          {
            aid: 903,
            title: '星铁剧情解析',
            sourceFolderTitle: '默认收藏夹',
            targetLedgerId: 'knowledge',
            targetFolderId: '9001',
            targetDisplayName: 'bilimi·知识学习',
            reviewRequired: false,
            alreadyInTarget: false,
            selected: true,
            originalSuggestedLedgerIds: ['knowledge'],
            currentTargetLedgerIds: ['knowledge'],
            selectedTargetLedgerIds: ['knowledge'],
            lowConfidence: false
          }
        ],
        skippedSourceFolderTitles: []
      })
    })

    render(<FloatingAssistantApp />)

    expect(await screen.findByRole('tab', { name: '批阅' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '掌库' }))
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.change(screen.getByLabelText('调整分类 星铁剧情解析'), {
      target: { value: 'game' }
    })
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    confirmOldFavoriteExecution()

    await waitFor(() => expect(executeOldFavoritePlan).toHaveBeenCalledOnce())
    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          favoriteCorrectionRecords: [
            expect.objectContaining({
              aid: 903,
              originalLedgerId: 'knowledge',
              userLedgerIds: ['game'],
              source: 'user',
              feedbackType: 'strong-correction',
              sourceScene: 'archive-preview',
              confirmedAt: expect.any(String)
            })
          ]
        })
      )
    )
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

  it('keeps the settings scroll position when enabling DeepSeek expands its settings downward', async () => {
    let restoreExpandedScroll: FrameRequestCallback | undefined
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      restoreExpandedScroll = callback
      return 1
    })
    const { container } = render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    const settingsBody = container.querySelector<HTMLElement>('.assistant-settings__body')
    expect(settingsBody).not.toBeNull()
    settingsBody!.scrollTop = 240

    fireEvent.click(screen.getByRole('checkbox', { name: '启用 DeepSeek' }))
    await waitFor(() => expect(screen.getByLabelText('DeepSeek API 密钥')).toBeInTheDocument())

    settingsBody!.scrollTop = 620
    expect(restoreExpandedScroll).toBeTypeOf('function')
    act(() => restoreExpandedScroll?.(performance.now()))
    expect(settingsBody!.scrollTop).toBe(240)
  })

  it('keeps saved settings but marks DeepSeek disconnected when the merged test fails', async () => {
    const testDeepSeekConnection = vi.fn().mockResolvedValue({
      ok: false,
      message: 'DeepSeek API request failed: 401 Unauthorized'
    })
    const { savePreferences } = installDesktopApi({
      testDeepSeekConnection,
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({
            deepseekEnabled: true,
            deepseekApiKeyStored: true
          })
        })
      )
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    fireEvent.click(screen.getByRole('button', { name: '保存并测试' }))

    await waitFor(() => expect(testDeepSeekConnection).toHaveBeenCalledOnce())
    expect(savePreferences).toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.getByLabelText('DeepSeek状态')).toHaveTextContent('DeepSeek 连接失败')
    )
    expect(screen.getByLabelText('DeepSeek状态')).toHaveAttribute('data-tone', 'error')
    expect(screen.getByLabelText('DeepSeek状态')).toHaveAttribute(
      'title',
      expect.stringContaining('旧藏整理：开启，可在归档预览中手动执行 DeepSeek 整理。')
    )
    expect(screen.getByLabelText('全局提示')).toHaveTextContent(
      '配置已保存，但连接测试失败：DeepSeek API 请求失败：401 Unauthorized'
    )
  })

  it('shows both the requested model and the model reported by the service after testing', async () => {
    installDesktopApi({
      testDeepSeekConnection: vi.fn().mockResolvedValue({
        ok: true,
        message: 'DeepSeek connection succeeded.',
        requestedModel: 'deepseek-v4-pro',
        responseModel: 'deepseek-v4-pro-20260701'
      }),
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({
            deepseekEnabled: true,
            deepseekApiKeyStored: true,
            deepseekModel: 'deepseek-v4-pro'
          })
        })
      )
    })

    render(<FloatingAssistantApp />)
    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    fireEvent.click(screen.getByRole('button', { name: '保存并测试' }))

    await waitFor(() =>
      expect(screen.getByLabelText('全局提示')).toHaveTextContent(
        'DeepSeek 连接成功。请求模型：deepseek-v4-pro；服务端返回模型：deepseek-v4-pro-20260701。'
      )
    )
  })

  it('does not reset DeepSeek settings when confirmation is cancelled', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { clearDeepSeekApiKey, savePreferences } = installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({
            deepseekEnabled: true,
            deepseekApiKeyStored: true
          })
        })
      )
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    await waitFor(() =>
      expect(screen.getByLabelText('DeepSeek状态')).toHaveTextContent('DeepSeek 待测试')
    )
    fireEvent.click(screen.getByRole('button', { name: '重置 DeepSeek' }))

    expect(confirm).toHaveBeenCalledWith('重置会关闭 DeepSeek 并删除已保存的 API 密钥，确定继续吗？')
    expect(clearDeepSeekApiKey).not.toHaveBeenCalled()
    expect(savePreferences).not.toHaveBeenCalled()
  })

  it('replaces the global queued feedback after canceling the active transcription', async () => {
    const runningQueue = {
      activeItemId: 'bvid:BV1note',
      items: [
        {
          id: 'bvid:BV1note',
          url: 'https://www.bilibili.com/video/BV1note',
          title: '三分钟讲清机器学习科普教程',
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
    } as const
    const canceledQueue = {
      items: [
        {
          ...runningQueue.items[0],
          status: 'canceled',
          updatedAt: '2026-06-25T00:01:00.000Z'
        }
      ]
    } as const
    const enqueueCurrentVideoAudioTranscription = vi.fn().mockResolvedValue(runningQueue)
    const cancelVideoAudioTranscription = vi.fn().mockResolvedValue(canceledQueue)
    installDesktopApi({ enqueueCurrentVideoAudioTranscription, cancelVideoAudioTranscription })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '札记' }))
    fireEvent.click(screen.getByRole('button', { name: '转写音频' }))

    await waitFor(() => expect(enqueueCurrentVideoAudioTranscription).toHaveBeenCalledOnce())
    expect(screen.getByLabelText('全局提示')).toHaveTextContent('已加入转写队列')

    fireEvent.click(await screen.findByRole('button', { name: '取消转写' }))

    await waitFor(() => expect(cancelVideoAudioTranscription).toHaveBeenCalledWith('bvid:BV1note'))
    expect(screen.getByLabelText('全局提示')).toHaveTextContent('已取消转写')
    expect(screen.getByLabelText('全局提示')).not.toHaveTextContent('已加入转写队列')
  })

  it('keeps a freshly enqueued transcription visible when an older queue load resolves empty', async () => {
    const initialQueueLoad = createDeferred<{ items: [] }>()
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
          updatedAt: '2026-06-25T00:00:00.000Z',
          progress: {
            step: 'transcribing-segment',
            segmentIndex: 1,
            segmentCount: 3,
            percent: 42,
            message: 'Transcribing segment 1 of 3.'
          }
        }
      ]
    })
    installDesktopApi({
      generateVideoNoteFromAudio,
      enqueueCurrentVideoAudioTranscription,
      loadVideoAudioTranscriptionQueue: vi.fn().mockReturnValue(initialQueueLoad.promise)
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '札记' }))
    fireEvent.click(screen.getByRole('button', { name: '转写音频' }))

    await waitFor(() => expect(enqueueCurrentVideoAudioTranscription).toHaveBeenCalledOnce())
    expect(screen.getByLabelText('转写音频状态')).toHaveTextContent('转写 43%')
    expect(screen.getByLabelText('转写音频状态')).not.toHaveTextContent('排队 0')
    expect(screen.getByRole('region', { name: '转写状态' })).toHaveTextContent(
      '三分钟讲清机器学习科普教程'
    )

    await act(async () => {
      initialQueueLoad.resolve({ items: [] })
      await initialQueueLoad.promise
    })

    expect(screen.getByLabelText('转写音频状态')).toHaveTextContent('转写 43%')
    expect(screen.getByLabelText('转写音频状态')).not.toHaveTextContent('排队 0')
    expect(screen.getByRole('region', { name: '转写状态' })).toHaveTextContent(
      '三分钟讲清机器学习科普教程'
    )
  })

  it('clears the stale no-video alert after a later audio transcription enqueue succeeds', async () => {
    let snapshotChanged: (() => void) | undefined
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
    const requestAssistantSnapshot = vi
      .fn()
      .mockResolvedValueOnce(
        createSnapshot({
          videoTitle: '首页',
          videoContentContext: {
            title: '首页',
            pageText: '推荐、番剧、直播和游戏中心'
          },
          activeTabUrl: 'https://www.bilibili.com/'
        })
      )
      .mockResolvedValueOnce(createSnapshot())

    installDesktopApi({
      generateVideoNoteFromAudio,
      enqueueCurrentVideoAudioTranscription,
      requestAssistantSnapshot,
      onAssistantSnapshotChanged: vi.fn((callback) => {
        snapshotChanged = callback
        return vi.fn()
      })
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '札记' }))
    fireEvent.click(screen.getByRole('button', { name: '转写音频' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('未打开视频')
    expect(enqueueCurrentVideoAudioTranscription).not.toHaveBeenCalled()

    snapshotChanged?.()
    expect(await screen.findByText('三分钟讲清机器学习科普教程')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '转写音频' }))

    await waitFor(() => expect(enqueueCurrentVideoAudioTranscription).toHaveBeenCalledOnce())
    expect(generateVideoNoteFromAudio).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(await screen.findByText('「三分钟讲清机器学习科普教程」已开始转写。')).toBeInTheDocument()
  })

  it('shows a no-video alert and pet hint when audio transcription has no video', async () => {
    const generateVideoNoteFromAudio = vi.fn().mockResolvedValue(null)
    const enqueueCurrentVideoAudioTranscription = vi.fn().mockResolvedValue(null)
    const setAssistantPetHint = vi.fn()
    installDesktopApi({
      generateVideoNoteFromAudio,
      enqueueCurrentVideoAudioTranscription,
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          videoTitle: '首页',
          videoContentContext: {
            title: '首页',
            pageText: '推荐、番剧、直播和游戏中心'
          },
          activeTabUrl: 'https://www.bilibili.com/'
        })
      ),
      setAssistantPetHint
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '札记' }))
    fireEvent.click(screen.getByRole('button', { name: '转写音频' }))

    expect(enqueueCurrentVideoAudioTranscription).not.toHaveBeenCalled()
    expect(generateVideoNoteFromAudio).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent('未打开视频')
    expect(
      setAssistantPetHint.mock.calls.some(
        ([hint]) =>
          hint?.tone === 'error' &&
          hint.message === '主人，未打开视频，小咪等主人打开视频页再转写音频。'
      )
    ).toBe(true)
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

  it('keeps recognized transcript closed while DeepSeek summary is still running until the user opens it', async () => {
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

    expect(screen.getByText('正在生成 DeepSeek 总结')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /无时间线文稿/ })).toHaveAttribute(
      'aria-selected',
      'false'
    )
    expect(screen.queryByRole('tabpanel', { name: /无时间线文稿/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /无时间线文稿/ }))

    expect(screen.getByRole('tabpanel', { name: /无时间线文稿/ })).toHaveTextContent(
      '机器学习需要数据和模型。'
    )

    fireEvent.click(screen.getByRole('tab', { name: /DeepSeek 总结/ }))
    expect(screen.getByRole('button', { name: '生成中...' })).toBeDisabled()
  })

  it('shows queued transcription work in the transcription status light', async () => {
    installDesktopApi({
      loadVideoAudioTranscriptionQueue: vi.fn().mockResolvedValue({
        items: [
          {
            id: 'bvid:BV1queued',
            url: 'https://www.bilibili.com/video/BV1queued',
            title: '队列里的教程',
            bvid: 'BV1queued',
            status: 'pending',
            createdAt: '2026-06-25T00:00:00.000Z',
            updatedAt: '2026-06-25T00:00:00.000Z'
          },
          {
            id: 'bvid:BV2queued',
            url: 'https://www.bilibili.com/video/BV2queued',
            title: '第二个队列视频',
            bvid: 'BV2queued',
            status: 'pending',
            createdAt: '2026-06-25T00:01:00.000Z',
            updatedAt: '2026-06-25T00:01:00.000Z'
          }
        ]
      })
    })

    render(<FloatingAssistantApp />)

    await waitFor(() =>
      expect(screen.getByLabelText('转写音频状态')).toHaveTextContent('转写排队 2')
    )
    const transcriptionStatus = screen.getByLabelText('转写音频状态')
    expect(transcriptionStatus).toHaveTextContent('转写排队 2')
    expect(transcriptionStatus).toHaveAttribute('title', '还有 2 个转写任务等待处理。')
  })

  it('shows transcription progress together with the pending queue count', async () => {
    installDesktopApi({
      loadVideoAudioTranscriptionQueue: vi.fn().mockResolvedValue({
        activeItemId: 'bvid:BV1running',
        sessionCompletedCount: 1,
        items: [
          {
            id: 'bvid:BV1running',
            url: 'https://www.bilibili.com/video/BV1running',
            title: '正在转写的教程',
            bvid: 'BV1running',
            status: 'running',
            createdAt: '2026-06-25T00:00:00.000Z',
            updatedAt: '2026-06-25T00:01:00.000Z',
            progress: {
              step: 'transcribing-segment',
              percent: 42,
              message: 'Transcribing segment.'
            }
          },
          {
            id: 'bvid:BV2pending',
            url: 'https://www.bilibili.com/video/BV2pending',
            title: '排队教程一',
            bvid: 'BV2pending',
            status: 'pending',
            createdAt: '2026-06-25T00:02:00.000Z',
            updatedAt: '2026-06-25T00:02:00.000Z'
          },
          {
            id: 'bvid:BV3pending',
            url: 'https://www.bilibili.com/video/BV3pending',
            title: '排队教程二',
            bvid: 'BV3pending',
            status: 'pending',
            createdAt: '2026-06-25T00:03:00.000Z',
            updatedAt: '2026-06-25T00:03:00.000Z'
          }
        ]
      })
    })

    render(<FloatingAssistantApp />)

    await waitFor(() =>
      expect(screen.getByLabelText('转写音频状态')).toHaveTextContent('转写 50% · 排队 2')
    )
    expect(screen.getByLabelText('转写音频状态')).not.toHaveTextContent('完成 1')
  })

  it('shows only the active transcription progress when nothing else is queued', async () => {
    installDesktopApi({
      loadVideoAudioTranscriptionQueue: vi.fn().mockResolvedValue({
        activeItemId: 'bvid:BV1running',
        items: [
          {
            id: 'bvid:BV1running',
            url: 'https://www.bilibili.com/video/BV1running',
            title: '正在转写的教程',
            bvid: 'BV1running',
            status: 'running',
            createdAt: '2026-06-25T00:00:00.000Z',
            updatedAt: '2026-06-25T00:01:00.000Z',
            progress: {
              step: 'transcribing-segment',
              percent: 42,
              message: 'Transcribing segment.'
            }
          }
        ]
      })
    })

    render(<FloatingAssistantApp />)

    await waitFor(() =>
      expect(screen.getByLabelText('转写音频状态')).toHaveTextContent('转写 50%')
    )
    expect(screen.getByLabelText('转写音频状态')).not.toHaveTextContent('排队 0')
  })

  it('keeps the note archive open when a background transcription draft arrives in sidebar mode', async () => {
    const note = createVideoNote()
    const loadVideoNoteArchives = vi.fn().mockResolvedValue([])
    let queueChanged:
      | Parameters<NonNullable<Window['bilimiDesktop']['onVideoAudioTranscriptionQueueChanged']>>[0]
      | undefined
    installDesktopApi({
      loadVideoNoteArchives,
      onVideoAudioTranscriptionQueueChanged: vi.fn((callback) => {
        queueChanged = callback
        return vi.fn()
      })
    })

    render(<FloatingAssistantApp mode="sidebar" activeTab="notes" onActiveTabChange={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '档案库' }))
    expect(await screen.findByRole('region', { name: '全局档案库' })).toBeInTheDocument()

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

    expect(screen.getByRole('region', { name: '全局档案库' })).toBeInTheDocument()
    expect(screen.queryByRole('tabpanel', { name: /无时间线文稿/ })).not.toBeInTheDocument()
  })

  it('restores the last opened archive video after the assistant is folded and reopened', async () => {
    const note = createVideoNote()
    const archive: VideoNoteArchiveEntry = {
      id: note.id,
      source: note.source,
      versions: [
        {
          id: `${note.id}:version:${note.updatedAt}`,
          note,
          plainTranscript: '机器学习需要数据和模型。',
          summaryText: '机器学习入门',
          createdAt: note.updatedAt
        }
      ],
      createdAt: note.createdAt,
      updatedAt: note.updatedAt
    }
    installDesktopApi({
      loadVideoNoteArchives: vi.fn().mockResolvedValue([archive])
    })

    const app = render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '札记' }))
    fireEvent.click(await screen.findByRole('button', { name: '档案库' }))
    fireEvent.click(await screen.findByRole('button', { name: /机器学习入门教程/ }))

    expect(screen.getByRole('article', { name: '机器学习入门教程' })).toBeInTheDocument()

    app.unmount()
    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '札记' }))
    fireEvent.click(await screen.findByRole('button', { name: '档案库' }))

    expect(await screen.findByRole('article', { name: '机器学习入门教程' })).toBeInTheDocument()
    expect(
      within(screen.getByRole('button', { name: /机器学习入门教程/ })).getByText('已展开')
    ).toBeInTheDocument()
  })

  it('does not restore archive detail from persistent storage after a new app session starts', async () => {
    const note = createVideoNote()
    const archive: VideoNoteArchiveEntry = {
      id: note.id,
      source: note.source,
      versions: [
        {
          id: `${note.id}:version:${note.updatedAt}`,
          note,
          plainTranscript: '机器学习需要数据和模型。',
          summaryText: '机器学习入门',
          createdAt: note.updatedAt
        }
      ],
      createdAt: note.createdAt,
      updatedAt: note.updatedAt
    }
    window.localStorage.setItem(
      'bilimi.videoNoteArchive.selection',
      JSON.stringify({
        archiveId: archive.id,
        versionId: archive.versions[0].id,
        activeResultTab: 'plain'
      })
    )
    installDesktopApi({
      loadVideoNoteArchives: vi.fn().mockResolvedValue([archive])
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '札记' }))
    fireEvent.click(await screen.findByRole('button', { name: '档案库' }))

    expect(screen.queryByRole('article', { name: '机器学习入门教程' })).not.toBeInTheDocument()
    expect(
      within(screen.getByRole('button', { name: /机器学习入门教程/ })).getByText('详情')
    ).toBeInTheDocument()
  })

  it('keeps the review page active while preparing background transcript and DeepSeek summary results', async () => {
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
            '### 后台 DeepSeek 总结',
            '后台总结已经保存。',
            '',
            '## 精修文稿',
            '',
            '后台精修文稿也已经保存。'
          ].join('\n'),
          createdAt: note.updatedAt
        }
      ],
      createdAt: note.createdAt,
      updatedAt: note.updatedAt
    }
    const loadVideoNoteArchives = vi.fn().mockResolvedValue([archive])
    let queueChanged:
      | Parameters<NonNullable<Window['bilimiDesktop']['onVideoAudioTranscriptionQueueChanged']>>[0]
      | undefined
    installDesktopApi({
      loadVideoNoteArchives,
      loadVideoAudioTranscriptionQueue: vi.fn().mockResolvedValue({
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
      }),
      onVideoAudioTranscriptionQueueChanged: vi.fn((callback) => {
        queueChanged = callback
        return vi.fn()
      })
    })

    render(<FloatingAssistantApp />)

    expect(await screen.findByRole('tab', { name: '批阅' })).toHaveAttribute(
      'aria-selected',
      'true'
    )

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
        ],
        sessionCompletedCount: 1
      })
    })

    await waitFor(() => expect(loadVideoNoteArchives).toHaveBeenCalled())
    expect(screen.getByRole('tab', { name: '批阅' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('全局提示')).toHaveTextContent(
      '转写完成，文稿已保存到档案库'
    )
    expect(screen.getByLabelText('转写音频状态')).toHaveTextContent('暂无转写 · 成功 1')
    expect(screen.queryByRole('tabpanel', { name: /无时间线文稿/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '札记' }))
    expect(screen.getByRole('tab', { name: /无时间线文稿/ })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByRole('tabpanel', { name: /无时间线文稿/ })).toHaveTextContent(
      '机器学习需要数据和模型。'
    )

    fireEvent.click(screen.getByRole('tab', { name: /DeepSeek 总结/ }))
    expect(screen.getByRole('region', { name: /DeepSeek 总结/ })).toHaveTextContent(
      '后台 DeepSeek 总结'
    )
    expect(screen.getByText(/后台精修文稿也已经保存/)).toBeInTheDocument()
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
    expect(screen.getByRole('tab', { name: /无时间线文稿/ })).toHaveAttribute(
      'aria-selected',
      'true'
    )
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

  it('tells 小咪 that the archive library opened instead of saying it synced', async () => {
    const setAssistantPetHint = vi.fn()
    installDesktopApi({ setAssistantPetHint, loadVideoNoteArchives: vi.fn().mockResolvedValue([]) })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '札记' }))
    fireEvent.click(screen.getByRole('button', { name: '档案库' }))

    await waitFor(() =>
      expect(setAssistantPetHint).toHaveBeenCalledWith({
        tone: 'happy',
        message: '主人，档案库打开啦，想看的文稿都在这里。'
      })
    )
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

  it('uses height-controlled view wrappers for every sidebar panel', async () => {
    const { container } = render(<FloatingAssistantApp mode="sidebar" />)

    expect(await screen.findByRole('tab', { name: '批阅' })).toBeInTheDocument()

    const viewWrappers = container.querySelectorAll(
      '.assistant-sidebar-workspace > .floating-assistant-view'
    )
    expect(viewWrappers).toHaveLength(3)
    expect(container.querySelector('.memorial-panel')?.parentElement).toHaveClass(
      'floating-assistant-view'
    )
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
      message: '主人，小咪正在把它收进合适的 bilimi 分册～'
    })
    expect(setAssistantPetHint).toHaveBeenLastCalledWith({
      tone: 'done',
      message: '主人，收好啦，这支视频已经进 bilimi 分册了。'
    })
  })
})
