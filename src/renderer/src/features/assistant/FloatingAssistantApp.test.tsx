import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import type {
  AssistantAutomationResult,
  AssistantPreferences,
  FavoriteLedgerStatus,
  VideoNote
} from '@shared/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FloatingAssistantApp } from './FloatingAssistantApp'
import type { AssistantSnapshot } from './assistantRuntimeTypes'

function createPreferences(): AssistantPreferences {
  return {
    favoritesFolderName: 'Bilimi 内库',
    favoriteLedgers: createDefaultFavoriteLedgers(),
    ledgerPromptDismissed: true,
    preferenceCounts: {}
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
  const saveVideoNote = vi.fn().mockResolvedValue([])
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
    generateVideoNote,
    loadPreferences: vi.fn(),
    onAssistantSnapshotChanged,
    requestAssistantSnapshot,
    runAssistantAction,
    savePreferences,
    saveVideoNote,
    scanOldFavorites,
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
    expect(screen.getByRole('button', { name: /赏.*轻赏此条/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /藏.*归入内库/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /赐.*投币厚赏/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /表.*拟奏短评/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /阅.*本条已阅/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /打开掌库/ })).toBeInTheDocument()
    expect(screen.getByText(/若欲代拟奏表/)).toBeInTheDocument()
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

    expect(screen.getByText('臣已拟好三条，请陛下择其一。')).toBeInTheDocument()

    const draftButton = screen.getAllByRole('button').find((button) =>
      button.textContent?.includes('御览')
    )
    expect(draftButton).toBeTruthy()
    fireEvent.click(draftButton!)

    await waitFor(() =>
      expect(runAssistantAction).toHaveBeenCalledWith(
        '表',
        expect.objectContaining({
          commentDraft: expect.stringContaining('御览'),
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
    const generateVideoNote = vi.fn().mockResolvedValue(note)
    installDesktopApi({ generateVideoNote })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '札记' }))
    fireEvent.click(screen.getByRole('button', { name: '整理札记' }))

    await waitFor(() => expect(generateVideoNote).toHaveBeenCalledWith(undefined))
    await waitFor(() => expect(screen.getAllByText('机器学习需要数据和模型。').length).toBeGreaterThan(0))
  })

  it('passes video time controls into the notes panel', async () => {
    const generateVideoNote = vi.fn().mockResolvedValue(createVideoNote())
    const getCurrentVideoTime = vi.fn().mockResolvedValue(92)
    const seekVideoTime = vi.fn().mockResolvedValue(true)
    const saveVideoNote = vi.fn().mockResolvedValue([])
    installDesktopApi({ generateVideoNote, getCurrentVideoTime, seekVideoTime, saveVideoNote })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '札记' }))
    fireEvent.click(screen.getByRole('button', { name: '整理札记' }))
    await waitFor(() => expect(generateVideoNote).toHaveBeenCalledWith(undefined))

    fireEvent.click(await screen.findByRole('tab', { name: '批注' }))
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
    const generateVideoNote = vi.fn().mockResolvedValue(createVideoNote())
    const saveVideoNote = vi.fn().mockResolvedValue([])
    installDesktopApi({ generateVideoNote, saveVideoNote })

    render(<FloatingAssistantApp />)

    fireEvent.click(await screen.findByRole('tab', { name: '札记' }))
    fireEvent.click(screen.getByRole('button', { name: '整理札记' }))
    await waitFor(() => expect(generateVideoNote).toHaveBeenCalledWith(undefined))

    fireEvent.click(await screen.findByRole('tab', { name: '归档' }))
    fireEvent.change(screen.getByLabelText('本地备注'), {
      target: { value: '悬浮窗里写下的复习备注。' }
    })
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
})
