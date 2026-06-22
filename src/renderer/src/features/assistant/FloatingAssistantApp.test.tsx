import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import type {
  AssistantAutomationResult,
  AssistantPreferences,
  FavoriteLedgerStatus,
  VideoNote,
  VideoNoteArchiveEntry
} from '@shared/types'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FloatingAssistantApp } from './FloatingAssistantApp'
import type { AssistantSnapshot } from './assistantRuntimeTypes'

function createPreferences(overrides: Partial<AssistantPreferences> = {}): AssistantPreferences {
  return {
    favoritesFolderName: 'Bilimi 内库',
    favoriteLedgers: createDefaultFavoriteLedgers(),
    ledgerPromptDismissed: true,
    preferenceCounts: {},
    petStyle: 'big-head',
    deepseekEnabled: false,
    deepseekApiKeyStored: false,
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
            prompt: 'clean poster'
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
  const saveFavoriteLedgers = vi.fn().mockResolvedValue(createResult('掌库已保存。'))
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
    deleteVideoNoteArchiveEntry,
    deleteVideoNoteArchiveVersion,
    scanOldFavorites,
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
  it('renders the complete floating assistant tabs from a snapshot', async () => {
    installDesktopApi()

    render(<FloatingAssistantApp />)

    expect(await screen.findByRole('tab', { name: '批阅' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '札记' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '掌库' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '设置' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '小mi批阅' })).toHaveClass('floating-assistant-tabs__pet')
    expect(screen.getByRole('img', { name: '小mi札记' })).toHaveClass('floating-assistant-tabs__pet')
    expect(screen.getByRole('img', { name: '小mi掌库' })).toHaveClass('floating-assistant-tabs__pet')
    expect(screen.getByRole('img', { name: '小mi设置' })).toHaveClass('floating-assistant-tabs__pet')
    expect(screen.getByRole('button', { name: /赏.*轻赏此条/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /藏.*归入内库/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /赐.*投币厚赏/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /表.*拟奏短评/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /阅.*本条已阅/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /打开掌库/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/若欲代拟奏表/)).not.toBeInTheDocument()
    expect(screen.getByText('三分钟讲清机器学习科普教程')).toBeInTheDocument()
  })

  it('asks for coin count inside the floating assistant before running 赐', async () => {
    const { runAssistantAction } = installDesktopApi()

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('button', { name: /赐.*投币厚赏/ }))

    expect(screen.getByText('陛下意欲赐几枚铜钱？')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '赐两枚' }))

    await waitFor(() =>
      expect(runAssistantAction).toHaveBeenCalledWith(
        '赐',
        expect.objectContaining({
          coinCount: 2,
          pageClickOnly: true
        })
      )
    )
  })

  it('uses default Xiao Mi comments directly when DeepSeek is disabled', async () => {
    const { generateDeepSeek, runAssistantAction } = installDesktopApi()

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('button', { name: /表.*拟奏短评/ }))

    expect(screen.queryByLabelText('Comment intent')).not.toBeInTheDocument()
    expect(generateDeepSeek).not.toHaveBeenCalled()
    expect(screen.getByText('小mi拟好三条，主人点一条就发送。')).toBeInTheDocument()
    const choices = screen.getAllByRole('button', { name: /三分钟讲清机器学习科普教程/ })
    expect(choices).toHaveLength(3)
    expect(choices[0]).toHaveTextContent(/小mi|我家主人/)
    expect(choices[0]).toHaveTextContent('李老师讲AI')

    fireEvent.click(choices[0])

    await waitFor(() =>
      expect(runAssistantAction).toHaveBeenCalledWith(
        '表',
        expect.objectContaining({
          commentDraft: expect.stringContaining('三分钟讲清机器学习科普教程'),
          pageClickOnly: true
        })
      )
    )
  })

  it('asks for comment intent and sends the selected AI comment draft', async () => {
    const preferences = createPreferences({
      deepseekEnabled: true,
      deepseekApiKeyStored: true
    })
    const { generateDeepSeek, runAssistantAction } = installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(createSnapshot({ preferences }))
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByTestId('review-action-comment'))

    expect(screen.getByLabelText('Comment intent')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Comment intent'), {
      target: { value: 'praise technical detail' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Generate comments' }))

    await waitFor(() =>
      expect(generateDeepSeek).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'review-comment',
          intent: 'praise technical detail',
          author: '李老师讲AI',
          title: '三分钟讲清机器学习科普教程'
        })
      )
    )
    expect(await screen.findByText('AI comment one')).toBeInTheDocument()
    expect(screen.getByText('AI comment two')).toBeInTheDocument()
    expect(screen.getByText('AI comment three')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'AI comment two' }))

    await waitFor(() =>
      expect(runAssistantAction).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          commentDraft: 'AI comment two',
          pageClickOnly: true
        })
      )
    )
  })

  it('falls back to Xiao Mi comments when DeepSeek comment generation is unusable', async () => {
    const preferences = createPreferences({
      deepseekEnabled: true,
      deepseekApiKeyStored: true
    })
    const { generateDeepSeek, runAssistantAction } = installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(createSnapshot({ preferences })),
      generateDeepSeek: vi.fn().mockResolvedValue({ kind: 'pet-chat', message: 'wrong shape' })
    })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByTestId('review-action-comment'))
    fireEvent.change(screen.getByLabelText('Comment intent'), {
      target: { value: 'funny and warm' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Generate comments' }))

    await waitFor(() => expect(generateDeepSeek).toHaveBeenCalledOnce())
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

  it('saves ledger edits through the account sync bridge only after clicking 保存', async () => {
    const saveFavoriteLedgers = vi.fn().mockResolvedValue(createResult('掌库已保存。'))
    installDesktopApi({ saveFavoriteLedgers })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '掌库' }))
    fireEvent.change(screen.getByLabelText('册名'), { target: { value: 'Bilimi Test' } })
    fireEvent.change(screen.getByLabelText('关键词'), { target: { value: 'test,video' } })
    fireEvent.click(screen.getByRole('button', { name: '新增册目' }))

    expect(saveFavoriteLedgers).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(saveFavoriteLedgers).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            displayName: 'Bilimi Test',
            keywords: ['test', 'video'],
            isDefault: false
          })
        ])
      )
    )
  })

  it('saves the selected pet style from assistant settings', async () => {
    const { closeAssistantPet, savePreferences, wakeAssistantPet } = installDesktopApi()

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    fireEvent.click(screen.getByRole('radio', { name: '高清重置版' }))
    fireEvent.click(screen.getByRole('button', { name: '唤醒宠物' }))
    fireEvent.click(screen.getByRole('button', { name: '关闭宠物' }))

    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          petStyle: 'classic'
        })
      )
    )
    expect(wakeAssistantPet).toHaveBeenCalledOnce()
    expect(closeAssistantPet).toHaveBeenCalledOnce()
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

    expect(screen.getByRole('link', { name: '云枢智元' })).toHaveAttribute(
      'href',
      'https://yunshulink.com/'
    )
    expect(screen.getByText('官网 DeepSeek 价格 3 折起')).toBeInTheDocument()
    expect(screen.getByText(/令牌分组请选择 deepseek（限时特价）/)).toBeInTheDocument()
    expect(screen.getByText('推荐模型：deepseek-v4-pro')).toBeInTheDocument()
    expect(screen.getByText('服务器地址：https://api.yunshulink.com/v1')).toBeInTheDocument()
    expect(
      screen.getByText('开启后可使用批阅的拟奏短评、札记中的一图流总结、宠物对话功能。')
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '复制推荐模型' }))
    expect(screen.getByRole('button', { name: '复制推荐模型' }).querySelector('.assistant-settings__copy-icon')).toBeInTheDocument()
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('deepseek-v4-pro'))
    expect(await screen.findByRole('status')).toHaveTextContent('已复制推荐模型。')

    fireEvent.click(screen.getByRole('button', { name: '复制服务器地址' }))
    expect(screen.getByRole('button', { name: '复制服务器地址' }).querySelector('.assistant-settings__copy-icon')).toBeInTheDocument()
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://api.yunshulink.com/v1'))
    expect(await screen.findByRole('status')).toHaveTextContent('已复制服务器地址。')

    const enabled = screen.getByRole('checkbox', { name: '启用 DeepSeek' })
    fireEvent.click(enabled)
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
    expect(screen.getByRole('checkbox', { name: '启用 DeepSeek' })).not.toBeChecked()
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
          deepseekModel: 'deepseek-v4-flash',
          deepseekBaseUrl: 'https://api.deepseek.com'
        })
      )
    )
    expect(await screen.findByRole('status')).toHaveTextContent('DeepSeek 设置已重置。')
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

  it('generates notes through the floating assistant bridge', async () => {
    const note = createVideoNote()
    const generateVideoNoteFromAudio = vi.fn().mockResolvedValue(note)
    installDesktopApi({ generateVideoNoteFromAudio })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '札记' }))
    fireEvent.click(screen.getByRole('button', { name: '转写音频' }))

    await waitFor(() => expect(generateVideoNoteFromAudio).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.getAllByText('机器学习需要数据和模型。').length).toBeGreaterThan(0))
  })

  it('generates notes from audio and shows transcription progress', async () => {
    let progressCallback:
      | ((progress: { step: 'transcribing-segment'; message: string; segmentIndex: number; segmentCount: number }) => void)
      | undefined
    const note = { ...createVideoNote(), transcriptSource: 'audio' as const }
    const generateVideoNoteFromAudio = vi.fn().mockResolvedValue(note)
    installDesktopApi({
      generateVideoNoteFromAudio,
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

    await waitFor(() => expect(generateVideoNoteFromAudio).toHaveBeenCalledOnce())
    expect(screen.getByText('正在转写第 1 / 2 段')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.queryByText('Transcribing segment 1/2.')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByText('机器学习需要数据和模型。').length).toBeGreaterThan(0))
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
          summaryText: '## 速览\n\n- 机器学习需要数据和模型。',
          createdAt: note.updatedAt
        }
      ],
      createdAt: note.updatedAt,
      updatedAt: note.updatedAt
    }
    const generateVideoNoteFromAudio = vi.fn().mockResolvedValue(note)
    const saveVideoNoteArchiveVersion = vi.fn().mockResolvedValue([archive])
    const loadVideoNoteArchives = vi.fn().mockResolvedValue([archive])
    installDesktopApi({ generateVideoNoteFromAudio, saveVideoNoteArchiveVersion, loadVideoNoteArchives })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '札记' }))
    fireEvent.click(screen.getByRole('button', { name: '转写音频' }))

    await waitFor(() => expect(saveVideoNoteArchiveVersion).toHaveBeenCalledWith(note))
    fireEvent.click(screen.getByRole('button', { name: '档案库' }))

    expect(await screen.findByRole('region', { name: '全局档案库' })).toBeInTheDocument()
    expect(screen.getByText('所有视频历史')).toBeInTheDocument()
    expect(screen.getAllByText('机器学习入门教程').length).toBeGreaterThan(0)
  })

  it('keeps removed time annotation controls out of the notes panel', async () => {
    const generateVideoNoteFromAudio = vi.fn().mockResolvedValue(createVideoNote())
    const getCurrentVideoTime = vi.fn().mockResolvedValue(92)
    const seekVideoTime = vi.fn().mockResolvedValue(true)
    const saveVideoNote = vi.fn().mockResolvedValue([])
    installDesktopApi({ generateVideoNoteFromAudio, getCurrentVideoTime, seekVideoTime, saveVideoNote })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '札记' }))
    fireEvent.click(screen.getByRole('button', { name: '转写音频' }))
    await waitFor(() => expect(generateVideoNoteFromAudio).toHaveBeenCalledOnce())

    expect(screen.queryByRole('button', { name: '取当前时间' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('批注标题')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('批注正文')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存批注' })).not.toBeInTheDocument()
    expect(getCurrentVideoTime).not.toHaveBeenCalled()
    expect(seekVideoTime).not.toHaveBeenCalled()
    expect(saveVideoNote).not.toHaveBeenCalled()
  })

  it('keeps removed local memo editing out of the notes panel', async () => {
    const generateVideoNoteFromAudio = vi.fn().mockResolvedValue(createVideoNote())
    const saveVideoNote = vi.fn().mockResolvedValue([])
    installDesktopApi({ generateVideoNoteFromAudio, saveVideoNote })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '札记' }))
    fireEvent.click(screen.getByRole('button', { name: '转写音频' }))
    await waitFor(() => expect(generateVideoNoteFromAudio).toHaveBeenCalledOnce())

    expect(screen.queryByLabelText('本地备注')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存札记' })).not.toBeInTheDocument()
    expect(saveVideoNote).not.toHaveBeenCalled()
  })

  it('closes the system assistant from 合折', async () => {
    const { closeFloatingAssistant } = installDesktopApi()

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('button', { name: '合折' }))

    expect(closeFloatingAssistant).toHaveBeenCalledOnce()
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

  it('reports working and hint pet states around successful sidebar actions', async () => {
    const setAssistantPetState = vi.fn()
    const runAssistantAction = vi.fn().mockResolvedValue(createResult('动作已完成。'))
    installDesktopApi({
      runAssistantAction,
      setAssistantPetState
    })

    render(<FloatingAssistantApp mode="sidebar" />)

    fireEvent.click(await screen.findByRole('button', { name: /藏.*归入内库/ }))

    await waitFor(() => expect(runAssistantAction).toHaveBeenCalled())
    expect(setAssistantPetState).toHaveBeenNthCalledWith(1, 'working')
    expect(setAssistantPetState).toHaveBeenLastCalledWith('hint')
  })
})
