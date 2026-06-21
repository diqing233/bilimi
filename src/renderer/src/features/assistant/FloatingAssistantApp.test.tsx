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

function createPreferences(): AssistantPreferences {
  return {
    favoritesFolderName: 'Bilimi 内库',
    favoriteLedgers: createDefaultFavoriteLedgers(),
    ledgerPromptDismissed: true,
    preferenceCounts: {},
    petStyle: 'big-head',
    deepseekEnabled: false,
    deepseekApiKeyStored: false,
    deepseekModel: 'deepseek-v4-flash',
    deepseekBaseUrl: 'https://api.deepseek.com'
  }
}

function createSnapshot(): AssistantSnapshot {
  return {
    preferences: createPreferences(),
    favoriteLedgerStatus: {
      ok: true,
      ledgers: createDefaultFavoriteLedgers(),
      missingLedgerIds: [],
      message: '册目查验已毕。'
    },
    videoContentContext: {
      title: '三分钟讲清机器学习科普教程',
      pageText: '从原理到入门路线，适合学习收藏。'
    },
    videoTitle: '三分钟讲清机器学习科普教程'
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
  const testDeepSeekConnection = vi.fn().mockResolvedValue({ ok: true, message: 'DeepSeek OK' })
  const loadOpenAiApiKeyStatus = vi.fn().mockResolvedValue({ configured: true })
  const saveOpenAiApiKey = vi.fn().mockResolvedValue({ configured: true })
  const clearOpenAiApiKey = vi.fn().mockResolvedValue({ configured: false })
  const ensureFavoriteLedgers = vi.fn().mockResolvedValue(createResult('册目已备齐。'))
  const scanOldFavorites = vi.fn().mockResolvedValue({
    items: [],
    skippedSourceFolderTitles: []
  })
  const onAssistantSnapshotChanged = vi.fn()
  const executeOldFavoritePlan = vi.fn().mockResolvedValue(createResult('旧藏已归册。'))
  const savePreferences = vi.fn().mockImplementation(async (preferences: AssistantPreferences) => preferences)
  const closeFloatingAssistant = vi.fn()
  const api = {
    version: '0.1.0',
    closeFloatingAssistant,
    ensureFavoriteLedgers,
    executeOldFavoritePlan,
    generateDeepSeek,
    generateVideoNote,
    generateVideoNoteFromAudio,
    saveDeepSeekApiKey,
    testDeepSeekConnection,
    loadOpenAiApiKeyStatus,
    loadPreferences: vi.fn(),
    onAssistantSnapshotChanged,
    requestAssistantSnapshot,
    runAssistantAction,
    saveOpenAiApiKey,
    savePreferences,
    saveVideoNote,
    saveVideoNoteArchiveVersion,
    loadVideoNoteArchives,
    deleteVideoNoteArchiveEntry,
    deleteVideoNoteArchiveVersion,
    scanOldFavorites,
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

  it('chooses a comment draft inside the floating assistant before running 表', async () => {
    const { runAssistantAction } = installDesktopApi()

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('button', { name: /表.*拟奏短评/ }))

    fireEvent.change(screen.getByLabelText('Comment intent'), {
      target: { value: 'share a courtly note' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Generate comments' }))

    expect(await screen.findByText('AI comment one')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'AI comment one' }))

    await waitFor(() =>
      expect(runAssistantAction).toHaveBeenCalledWith(
        '表',
        expect.objectContaining({
          commentDraft: 'AI comment one',
          pageClickOnly: true
        })
      )
    )
  })

  it('asks for comment intent and sends the selected AI comment draft', async () => {
    const { generateDeepSeek, runAssistantAction } = installDesktopApi()

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
          intent: 'praise technical detail'
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

  it('saves the selected pet style from assistant settings', async () => {
    const { savePreferences } = installDesktopApi()

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    fireEvent.click(screen.getByRole('radio', { name: '高清重置版' }))

    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          petStyle: 'classic'
        })
      )
    )
  })

  it('saves and tests DeepSeek assistant settings', async () => {
    const { saveDeepSeekApiKey, savePreferences, testDeepSeekConnection } = installDesktopApi()

    render(<FloatingAssistantApp />)

    await screen.findAllByRole('tab')
    fireEvent.click(screen.getAllByRole('tab')[3])

    const enabled = screen.getByRole('checkbox', { name: 'Enable DeepSeek' })
    fireEvent.click(enabled)
    fireEvent.change(screen.getByLabelText('DeepSeek API Key'), {
      target: { value: 'sk-test' }
    })
    fireEvent.change(screen.getByLabelText('DeepSeek Model'), {
      target: { value: 'deepseek-chat' }
    })
    fireEvent.change(screen.getByLabelText('DeepSeek Base URL'), {
      target: { value: 'https://api.deepseek.local' }
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save DeepSeek' }))

    await waitFor(() => expect(saveDeepSeekApiKey).toHaveBeenCalledWith('sk-test'))
    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          deepseekEnabled: true,
          deepseekModel: 'deepseek-chat',
          deepseekBaseUrl: 'https://api.deepseek.local'
        })
      )
    )

    fireEvent.click(screen.getByRole('button', { name: 'Test DeepSeek' }))

    await waitFor(() => expect(testDeepSeekConnection).toHaveBeenCalledOnce())
    expect(await screen.findByRole('status')).toHaveTextContent('DeepSeek OK')
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
    expect(screen.getByText('Transcribing segment 1/2.')).toBeInTheDocument()
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

  it('passes video time controls into the notes panel', async () => {
    const generateVideoNoteFromAudio = vi.fn().mockResolvedValue(createVideoNote())
    const getCurrentVideoTime = vi.fn().mockResolvedValue(92)
    const seekVideoTime = vi.fn().mockResolvedValue(true)
    const saveVideoNote = vi.fn().mockResolvedValue([])
    installDesktopApi({ generateVideoNoteFromAudio, getCurrentVideoTime, seekVideoTime, saveVideoNote })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '札记' }))
    fireEvent.click(screen.getByRole('button', { name: '转写音频' }))
    await waitFor(() => expect(generateVideoNoteFromAudio).toHaveBeenCalledOnce())

    fireEvent.click(screen.getByRole('button', { name: '取当前时间' }))
    await waitFor(() => expect(getCurrentVideoTime).toHaveBeenCalledOnce())

    fireEvent.change(screen.getByLabelText('批注标题'), {
      target: { value: '当前片段' }
    })
    fireEvent.change(screen.getByLabelText('批注正文'), {
      target: { value: '这里值得复看。' }
    })
    fireEvent.click(screen.getByRole('button', { name: '保存批注' }))

    await waitFor(() =>
      expect(saveVideoNote).toHaveBeenCalledWith(
        expect.objectContaining({
          annotations: [
            expect.objectContaining({
              start: 92,
              title: '当前片段',
              body: '这里值得复看。'
            })
          ]
        })
      )
    )
    const timestampButton = await screen.findByRole('button', { name: '01:32' })
    fireEvent.click(timestampButton)

    await waitFor(() => expect(seekVideoTime).toHaveBeenCalledWith(92))
  })

  it('saves locally updated notes through the floating assistant bridge', async () => {
    const generateVideoNoteFromAudio = vi.fn().mockResolvedValue(createVideoNote())
    const saveVideoNote = vi.fn().mockResolvedValue([])
    installDesktopApi({ generateVideoNoteFromAudio, saveVideoNote })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '札记' }))
    fireEvent.click(screen.getByRole('button', { name: '转写音频' }))
    await waitFor(() => expect(generateVideoNoteFromAudio).toHaveBeenCalledOnce())

    fireEvent.change(screen.getByLabelText('本地备注'), {
      target: { value: '悬浮窗里写下的复习备注。' }
    })
    expect(screen.getByLabelText<HTMLTextAreaElement>('本地备注').value).toBe(
      '悬浮窗里写下的复习备注。'
    )
    fireEvent.click(screen.getByRole('button', { name: '保存札记' }))

    await waitFor(() =>
      expect(saveVideoNote).toHaveBeenCalledWith(
        expect.objectContaining({
          userMemo: '悬浮窗里写下的复习备注。'
        })
      )
    )
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
