import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VideoNoteArchiveEntry } from '@shared/types'
import {
  AssistantSidebar,
  ASSISTANT_SIDEBAR_DEFAULT_WIDTH_PX,
  clampAssistantSidebarWidthPx
} from './AssistantSidebar'
import { createInitialAssistantPreferences } from '../state/assistantState'
import type { AssistantSnapshot } from './assistantRuntimeTypes'

function setWindowInnerWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width
  })
}

function assistantSnapshot(accountMid: string): AssistantSnapshot {
  return {
    accountMid,
    preferences: createInitialAssistantPreferences(),
    favoriteLedgerStatus: null,
    videoContentContext: { title: 'Current video' },
    videoTitle: 'Current video',
    activeTabUrl: ''
  }
}

function archivedVideo(accountMid: string, title: string): VideoNoteArchiveEntry {
  return {
    id: `archive-${accountMid}`,
    source: { accountMid, title, author: 'Author', bvid: `BV${accountMid}`, url: `https://www.bilibili.com/video/BV${accountMid}`, tags: [] },
    versions: [{
      id: `version-${accountMid}`,
      plainTranscript: 'Transcript',
      summaryText: '',
      createdAt: '2026-07-27T00:00:00.000Z',
      note: {
        id: `note-${accountMid}`,
        source: { accountMid, title, author: 'Author', bvid: `BV${accountMid}`, url: `https://www.bilibili.com/video/BV${accountMid}`, tags: [] },
        transcriptSource: 'audio', transcript: [], chapters: [], overview: { shortSummary: [], keywords: [], timeline: [], highlights: [] }, annotations: [], userMemo: '', createdAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-07-27T00:00:00.000Z'
      }
    }],
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z'
  }
}

function installDesktopApi({
  preferences = createInitialAssistantPreferences(),
  snapshot = assistantSnapshot('100'),
  archives = [],
  patchPreferences,
  sidebarWidth = preferences.assistantSidebarWidthPx,
  saveAssistantSidebarWidth
}: {
  preferences?: ReturnType<typeof createInitialAssistantPreferences>
  snapshot?: AssistantSnapshot
  archives?: VideoNoteArchiveEntry[]
  patchPreferences?: (patch: Partial<ReturnType<typeof createInitialAssistantPreferences>>) => Promise<ReturnType<typeof createInitialAssistantPreferences>>
  sidebarWidth?: number | null
  saveAssistantSidebarWidth?: (widthPx: number | null) => Promise<number | null>
} = {}) {
  let openAssistantCallback: (() => void) | undefined
  let preferencesChangedCallback:
    | ((preferences: ReturnType<typeof createInitialAssistantPreferences>) => void)
    | undefined
  let storedPreferences = preferences
  let currentSnapshot = snapshot
  let currentArchives = archives
  const loadVideoNoteArchives = vi.fn(async () => currentArchives)
  const loadTranscriptionModels = vi.fn(async () => [])
  let accountChangedCallback: (() => void) | undefined
  let sidebarWidthChangedCallback: ((widthPx: number | null) => void) | undefined
  const openWorkspaceCallbacks: Array<
    Parameters<NonNullable<Window['bilimiDesktop']['onOpenFloatingAssistantWorkspace']>>[0]
  > = []
  Object.defineProperty(window, 'bilimiDesktop', {
    configurable: true,
    value: {
      version: '0.1.0',
      loadPreferences: vi.fn(async () => storedPreferences),
      onOpenAssistant: vi.fn((callback) => {
        openAssistantCallback = callback
        return vi.fn()
      }),
      onOpenFloatingAssistantWorkspace: vi.fn((callback) => {
        openWorkspaceCallbacks.push(callback)
        return vi.fn()
      }),
      onAssistantSnapshotChanged: vi.fn(),
      onAssistantPreferencesChanged: vi.fn((callback) => {
        preferencesChangedCallback = callback
        return vi.fn()
      }),
      requestAssistantSnapshot: vi.fn(async () => currentSnapshot),
      savePreferences: vi.fn(async (nextPreferences) => {
        storedPreferences = createInitialAssistantPreferences(nextPreferences)
        return storedPreferences
      }),
      patchPreferences: vi.fn(patchPreferences ?? (async (patch) => {
        storedPreferences = createInitialAssistantPreferences({ ...storedPreferences, ...patch })
        return storedPreferences
      })),
      loadAssistantSidebarWidth: vi.fn(async () => sidebarWidth),
      saveAssistantSidebarWidth: vi.fn(saveAssistantSidebarWidth ?? (async (widthPx) => widthPx)),
      onAssistantSidebarWidthChanged: vi.fn((callback) => {
        sidebarWidthChangedCallback = callback
        return vi.fn()
      }),
      setAssistantPetHint: vi.fn(),
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
      onVideoAudioTranscriptionQueueChanged: vi.fn(() => vi.fn()),
      loadVideoNoteArchives,
      loadTranscriptionModels,
      loadCurrentTranscriptionModelInstallProgress: vi.fn(async () => undefined),
      onBilibiliAccountChanged: vi.fn((callback) => {
        accountChangedCallback = callback
        return vi.fn()
      }),
      getLocalDataInfo: vi.fn().mockResolvedValue({ path: 'C:\\test\\bilimi', accounts: [] })
    }
  })

  return {
    openAssistant: () => openAssistantCallback?.(),
    notifyPreferencesChanged: (
      nextPreferences: ReturnType<typeof createInitialAssistantPreferences>
    ) => {
      preferencesChangedCallback?.(nextPreferences)
    },
    notifySidebarWidthChanged: (widthPx: number | null) => {
      sidebarWidthChangedCallback?.(widthPx)
    },
    openWorkspace: (
      payload: Parameters<
        NonNullable<Window['bilimiDesktop']['onOpenFloatingAssistantWorkspace']>
      >[0] extends (payload: infer Payload) => void
        ? Payload
        : never
    ) => {
      for (const callback of openWorkspaceCallbacks) {
        callback(payload)
      }
    },
    changeAccount: (nextSnapshot: AssistantSnapshot, nextArchives: VideoNoteArchiveEntry[]) => {
      currentSnapshot = nextSnapshot
      currentArchives = nextArchives
      accountChangedCallback?.()
    },
    setAssistantPetHint: window.bilimiDesktop.setAssistantPetHint as ReturnType<typeof vi.fn>,
    loadVideoNoteArchives,
    loadTranscriptionModels,
    loadPreferences: window.bilimiDesktop.loadPreferences as ReturnType<typeof vi.fn>,
    patchPreferences: window.bilimiDesktop.patchPreferences as ReturnType<typeof vi.fn>,
    loadAssistantSidebarWidth: window.bilimiDesktop.loadAssistantSidebarWidth as ReturnType<typeof vi.fn>,
    saveAssistantSidebarWidth: window.bilimiDesktop.saveAssistantSidebarWidth as ReturnType<typeof vi.fn>,
    savePreferences: window.bilimiDesktop.savePreferences as ReturnType<typeof vi.fn>,
    getLocalDataInfo: window.bilimiDesktop.getLocalDataInfo as ReturnType<typeof vi.fn>
  }
}

describe('assistant sidebar width helpers', () => {
  beforeEach(() => {
    setWindowInnerWidth(1366)
  })

  it('keeps resized widths within practical bounds for the current window', () => {
    expect(clampAssistantSidebarWidthPx(260, 1280)).toBe(320)
    expect(clampAssistantSidebarWidthPx(360, 1280)).toBe(360)
    expect(clampAssistantSidebarWidthPx(900, 1280)).toBe(486)
    expect(clampAssistantSidebarWidthPx(900, 1920)).toBe(486)
  })

  it('allows narrower sidebars on compact logical windows', () => {
    expect(clampAssistantSidebarWidthPx(260, 1080)).toBe(272)
    expect(clampAssistantSidebarWidthPx(260, 1180)).toBe(288)
    expect(clampAssistantSidebarWidthPx(260, 1280)).toBe(320)
  })
})

describe('AssistantSidebar', () => {
  beforeEach(() => {
    setWindowInnerWidth(1366)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens by default with the 批阅 tab selected', async () => {
    installDesktopApi()

    render(<AssistantSidebar />)

    expect(screen.getByRole('complementary', { name: 'bilimi 侧边栏' })).toHaveAttribute(
      'data-collapsed',
      'false'
    )
    expect(await screen.findByRole('tab', { name: '批阅' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  it('uses the left boundary collapse control without rendering a rail column', () => {
    installDesktopApi()

    render(<AssistantSidebar />)

    expect(screen.queryByRole('navigation', { name: '侧边栏收合控制' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '折叠侧边栏' })).toHaveClass(
      'assistant-sidebar__collapse-button'
    )
    expect(screen.getByText('折叠')).toHaveClass('assistant-sidebar__collapse-label')
    expect(screen.getByRole('img', { name: '小咪收起侧栏' })).toHaveClass(
      'assistant-sidebar__collapse-pet'
    )
    expect(screen.queryByRole('button', { name: '打开批阅' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '打开札记' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '打开掌库' })).not.toBeInTheDocument()

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '折叠侧边栏' }))

    expect(screen.getByRole('complementary', { name: 'bilimi 侧边栏' })).toHaveAttribute('data-closing', 'true')
    expect(screen.getByRole('button', { name: '展开侧边栏' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '批阅' })).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(220) })
    expect(screen.getByRole('complementary', { name: 'bilimi 侧边栏' })).toHaveAttribute('data-collapsed', 'true')
    expect(screen.queryByRole('tab', { name: '批阅' })).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: '小咪展开侧栏' })).toHaveClass(
      'assistant-sidebar__collapse-pet'
    )
    expect(screen.getByRole('button', { name: '展开侧边栏' }).parentElement).toHaveClass(
      'assistant-sidebar-shell'
    )

    expect(screen.getByText('展开')).toHaveClass('assistant-sidebar__collapse-label')

    fireEvent.click(screen.getByRole('button', { name: '展开侧边栏' }))

    expect(screen.getByRole('tab', { name: '批阅' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  it('switches to Settings without rereading unchanged transcription models', async () => {
    const api = installDesktopApi()
    render(<AssistantSidebar />)
    await waitFor(() => expect(api.loadTranscriptionModels).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('tab', { name: '设置' }))

    expect(screen.getByRole('tab', { name: '设置' })).toHaveAttribute('aria-selected', 'true')
    expect(api.loadTranscriptionModels).toHaveBeenCalledTimes(1)
  })

  it('lazily mounts settings, retains it across workspaces, and reuses local data info', async () => {
    const api = installDesktopApi()
    render(<AssistantSidebar />)

    expect(document.querySelector('section[aria-label="助手设置"]')).not.toBeInTheDocument()
    expect(api.getLocalDataInfo).not.toHaveBeenCalled()

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    const settings = await screen.findByLabelText('助手设置')
    await waitFor(() => expect(api.getLocalDataInfo).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('tab', { name: '批阅' }))

    expect(document.querySelector('section[aria-label="助手设置"]')).toBe(settings)
    expect(settings).toHaveAttribute('hidden')

    fireEvent.click(screen.getByRole('tab', { name: '掌库' }))

    expect(document.querySelector('section[aria-label="助手设置"]')).toBe(settings)
    expect(settings).toHaveAttribute('hidden')

    fireEvent.click(screen.getByRole('tab', { name: '设置' }))

    expect(screen.getByLabelText('助手设置')).toBe(settings)
    expect(api.getLocalDataInfo).toHaveBeenCalledTimes(1)
  })

  it('invalidates local data info for an account change and reloads it on the next Settings visit', async () => {
    const api = installDesktopApi()
    render(<AssistantSidebar />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    await waitFor(() => expect(api.getLocalDataInfo).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('tab', { name: '批阅' }))
    act(() => api.changeAccount(assistantSnapshot('200'), []))

    await waitFor(() => expect(api.loadVideoNoteArchives).toHaveBeenCalledTimes(2))
    expect(api.getLocalDataInfo).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('tab', { name: '设置' }))

    await waitFor(() => expect(api.getLocalDataInfo).toHaveBeenCalledTimes(2))
  })

  it('refreshes local data info immediately when the visible account changes', async () => {
    const api = installDesktopApi()
    render(<AssistantSidebar />)

    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))
    await waitFor(() => expect(api.getLocalDataInfo).toHaveBeenCalledTimes(1))

    act(() => api.changeAccount(assistantSnapshot('200'), []))

    await waitFor(() => expect(api.getLocalDataInfo).toHaveBeenCalledTimes(2))
  })

  it('reverses a pending sidebar close without releasing its workspace width', async () => {
    installDesktopApi()
    render(<AssistantSidebar />)
    await screen.findByRole('tab', { name: '批阅' })
    vi.useFakeTimers()

    fireEvent.click(screen.getByRole('button', { name: '折叠侧边栏' }))
    const sidebar = screen.getByRole('complementary', { name: 'bilimi 侧边栏' })
    expect(sidebar).toHaveAttribute('data-closing', 'true')
    fireEvent.click(screen.getByRole('button', { name: '展开侧边栏' }))

    expect(sidebar).toHaveAttribute('data-collapsed', 'false')
    expect(sidebar).not.toHaveAttribute('data-closing')
    act(() => { vi.advanceTimersByTime(220) })
    expect(sidebar).toHaveAttribute('data-collapsed', 'false')
  })

  it('expands the sidebar when the floating pet asks to open the assistant', async () => {
    const api = installDesktopApi()

    render(<AssistantSidebar />)

    fireEvent.click(await screen.findByRole('button', { name: '折叠侧边栏' }))

    expect(screen.getByRole('complementary', { name: 'bilimi 侧边栏' })).toHaveAttribute(
      'data-collapsed',
      'true'
    )

    act(() => {
      api.openAssistant()
    })

    expect(await screen.findByRole('tab', { name: '批阅' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'bilimi 侧边栏' })).toHaveAttribute(
      'data-collapsed',
      'false'
    )
  })

  it('keeps the sidebar folded and preserves its previous tab for pet workspace requests', async () => {
    const api = installDesktopApi()

    render(<AssistantSidebar />)

    fireEvent.click(await screen.findByRole('tab', { name: '札记' }))
    expect(screen.getByRole('tab', { name: '札记' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(await screen.findByRole('button', { name: '折叠侧边栏' }))

    expect(screen.getByRole('complementary', { name: 'bilimi 侧边栏' })).toHaveAttribute(
      'data-collapsed',
      'true'
    )

    act(() => {
      api.openWorkspace({ tab: 'ledger', organizeOldFavorites: true })
    })

    expect(screen.getByRole('complementary', { name: 'bilimi 侧边栏' })).toHaveAttribute(
      'data-collapsed',
      'true'
    )

    fireEvent.click(screen.getByRole('button', { name: '展开侧边栏' }))

    expect(await screen.findByRole('tab', { name: '札记' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  it('opens the persistent sidebar on the ledger organization guide for a drawer workspace request', async () => {
    const api = installDesktopApi()

    render(<AssistantSidebar />)
    fireEvent.click(await screen.findByRole('button', { name: '折叠侧边栏' }))

    act(() => {
      api.openWorkspace({ tab: 'ledger', organizeOldFavorites: true, sidebar: true })
    })

    expect(await screen.findByRole('tab', { name: '掌库' })).toBeInTheDocument()
    expect(await screen.findByLabelText('整理收藏向导')).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'bilimi 侧边栏' })).toHaveAttribute('data-collapsed', 'false')
  })

  it('forwards only the current Favorite Library selection and clears it for a normal organization request', async () => {
    const api = installDesktopApi()
    const command = vi.fn().mockResolvedValue(null)
    window.bilimiDesktop.commandOldFavoriteWorkspaceV1 = command

    render(<AssistantSidebar />)
    act(() => {
      api.openWorkspace({
        tab: 'ledger', sidebar: true, organizeOldFavorites: true, selectedFavoriteAids: [3, 1, 3]
      })
    })

    await waitFor(() => expect(command).toHaveBeenCalledWith('100', {
      type: 'start-selected-reorganization', aids: [1, 3]
    }))
    act(() => {
      api.openWorkspace({ tab: 'ledger', sidebar: true, organizeOldFavorites: true })
    })
    await waitFor(() => expect(command).toHaveBeenCalledTimes(1))
  })

  it('keeps the default favorite system switch in Settings instead of the ledger overview', async () => {
    const api = installDesktopApi({
      preferences: createInitialAssistantPreferences({
        favoriteAccountPreferences: {
          '100': { defaultFavoriteSystemEnabled: true, favoriteLedgers: [] }
        }
      })
    })
    render(<AssistantSidebar />)
    fireEvent.click(await screen.findByRole('tab', { name: '掌库' }))
    expect(screen.queryByRole('checkbox', { name: '启用默认收藏夹' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '设置' }))
    expect(await screen.findByRole('heading', { name: '设置' })).toHaveClass('assistant-settings__title')
    expect(screen.getByText('本地数据与迁移', { selector: 'legend' })).toBeInTheDocument()
    const defaultSystem = await screen.findByRole('checkbox', { name: '启用默认收藏夹' })
    expect(screen.getByText(/未备册也可先按默认逻辑目标等待标签完成后分类预览/)).toBeInTheDocument()
    expect(defaultSystem).toBeChecked()

    const settingsSections = Array.from(
      document.querySelectorAll<HTMLElement>('[data-settings-section]')
    ).map((section) => section.dataset.settingsSection)
    expect(settingsSections.slice(-4)).toEqual(['bilibili-connection', 'local-data', 'motion-tuning', 'close'])
    expect(
      Array.from(screen.getByRole('combobox', { name: '设置项' }).querySelectorAll('option')).slice(-4).map((option) => option.value)
    ).toEqual(['bilibili-connection', 'local-data', 'motion-tuning', 'close'])
  })

  it('shows only automatic system proxy and direct Bilibili connection choices', async () => {
    installDesktopApi({
      preferences: createInitialAssistantPreferences({ bilibiliConnectionMode: 'auto' })
    })

    render(<AssistantSidebar />)
    fireEvent.click(await screen.findByRole('tab', { name: '设置' }))

    const connectionSection = document.querySelector('[data-settings-section="bilibili-connection"]')
    expect(connectionSection).not.toBeNull()
    expect(connectionSection?.querySelectorAll('input[name="bilibili-connection-mode"]')).toHaveLength(2)
    expect(screen.getByRole('radio', { name: /自动（推荐）/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /始终直连/ })).toBeInTheDocument()
    expect(screen.queryByText('跟随系统代理', { exact: true })).not.toBeInTheDocument()
  })

  it('keeps an expanded sidebar on its own page when the pet opens another workspace', async () => {
    const api = installDesktopApi()
    render(<AssistantSidebar />)

    fireEvent.click(await screen.findByRole('tab', { name: '札记' }))
    act(() => {
      api.openWorkspace({ tab: 'ledger', organizeOldFavorites: true })
    })

    expect(screen.getByRole('tab', { name: '札记' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('complementary', { name: 'bilimi 侧边栏' })).toHaveAttribute(
      'data-collapsed',
      'false'
    )
  })

  it('expands the sidebar and opens the requested ledger editor for a drawer edit', async () => {
    const api = installDesktopApi({
      preferences: createInitialAssistantPreferences({
        favoriteAccountPreferences: {
          '100': { defaultFavoriteSystemEnabled: true, favoriteLedgers: [
            { id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: false }
          ] }
        }
      })
    })
    render(<AssistantSidebar />)
    fireEvent.click(await screen.findByRole('button', { name: '折叠侧边栏' }))

    act(() => {
      api.openWorkspace({ tab: 'ledger', ledgerId: 'music' })
    })

    expect(screen.getByRole('complementary', { name: 'bilimi 侧边栏' })).toHaveAttribute('data-collapsed', 'false')
    expect(await screen.findByRole('tab', { name: '掌库' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByRole('region', { name: '当前收藏夹' })).toHaveAttribute('data-ledger-id', 'music')
  })

  it('loads, drags, persists, and resets a bounded sidebar width', async () => {
    const api = installDesktopApi({
      preferences: createInitialAssistantPreferences({
        assistantSidebarWidthPx: 360
      })
    })

    render(<AssistantSidebar />)

    const sidebar = screen.getByRole('complementary', { name: 'bilimi 侧边栏' })
    const resizeHandle = screen.getByRole('separator', { name: '调整侧边栏宽度' })

    await act(async () => undefined)
    expect(sidebar).toHaveStyle({ '--assistant-sidebar-width': '360px' })

    fireEvent.pointerDown(resizeHandle, { button: 0, buttons: 1, clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(window, { buttons: 1, clientX: 260, pointerId: 1 })

    expect(sidebar).toHaveStyle({ '--assistant-sidebar-width': '320px' })

    fireEvent.pointerUp(window, { clientX: 260, pointerId: 1 })

    expect(api.patchPreferences).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(api.saveAssistantSidebarWidth).toHaveBeenLastCalledWith(320)
    )
    expect(api.patchPreferences).not.toHaveBeenCalled()
    expect(api.savePreferences).not.toHaveBeenCalled()

    fireEvent.doubleClick(resizeHandle)

    expect(sidebar.style.getPropertyValue('--assistant-sidebar-width')).toBe('')
    await waitFor(() =>
      expect(api.saveAssistantSidebarWidth).toHaveBeenLastCalledWith(null)
    )
    expect(ASSISTANT_SIDEBAR_DEFAULT_WIDTH_PX).toBe(384)
  })

  it('re-clamps saved sidebar width when the current window is compact', async () => {
    setWindowInnerWidth(1080)
    installDesktopApi({
      preferences: createInitialAssistantPreferences({
        assistantSidebarWidthPx: 486
      })
    })

    render(<AssistantSidebar />)

    const sidebar = screen.getByRole('complementary', { name: 'bilimi 侧边栏' })

    await act(async () => undefined)

    expect(sidebar).toHaveStyle({ '--assistant-sidebar-width': '410px' })
  })

  it('returns to the stylesheet default width when the focused layout channel clears it', async () => {
    const api = installDesktopApi({
      preferences: createInitialAssistantPreferences({
        assistantSidebarWidthPx: 360
      })
    })

    render(<AssistantSidebar />)

    const sidebar = screen.getByRole('complementary', { name: 'bilimi 侧边栏' })

    await act(async () => undefined)
    expect(sidebar).toHaveStyle({ '--assistant-sidebar-width': '360px' })

    act(() => {
      api.notifySidebarWidthChanged(null)
    })

    expect(sidebar.style.getPropertyValue('--assistant-sidebar-width')).toBe('')
  })

  it('cancels a pending drag save when the focused layout channel resets the width', async () => {
    vi.useFakeTimers()
    const api = installDesktopApi({
      preferences: createInitialAssistantPreferences({ assistantSidebarWidthPx: 360 })
    })
    render(<AssistantSidebar />)
    const sidebar = screen.getByRole('complementary', { name: 'bilimi 侧边栏' })
    const resizeHandle = screen.getByRole('separator', { name: '调整侧边栏宽度' })
    await act(async () => undefined)
    api.saveAssistantSidebarWidth.mockClear()

    fireEvent.pointerDown(resizeHandle, { button: 0, buttons: 1, clientX: 100, pointerId: 75 })
    fireEvent.pointerMove(window, { buttons: 1, clientX: 80, pointerId: 75 })
    fireEvent.pointerUp(window, { pointerId: 75 })
    act(() => api.notifySidebarWidthChanged(null))
    await act(async () => { vi.advanceTimersByTime(200) })

    expect(sidebar.style.getPropertyValue('--assistant-sidebar-width')).toBe('')
    expect(api.saveAssistantSidebarWidth).not.toHaveBeenCalled()
  })

  it('does not let a delayed initial load overwrite a resize that already started', async () => {
    let finishLoad: ((widthPx: number | null) => void) | undefined
    const api = installDesktopApi({ sidebarWidth: null })
    api.loadAssistantSidebarWidth.mockImplementation(
      () => new Promise((resolve) => { finishLoad = resolve })
    )
    render(<AssistantSidebar />)
    const sidebar = screen.getByRole('complementary', { name: 'bilimi 侧边栏' })
    const resizeHandle = screen.getByRole('separator', { name: '调整侧边栏宽度' })

    fireEvent.pointerDown(resizeHandle, { button: 0, buttons: 1, clientX: 100, pointerId: 76 })
    fireEvent.pointerMove(window, { buttons: 1, clientX: 80, pointerId: 76 })
    finishLoad?.(320)
    await act(async () => undefined)
    fireEvent.pointerUp(window, { pointerId: 76 })

    expect(sidebar).toHaveStyle({ '--assistant-sidebar-width': '404px' })
  })

  it('captures the pointer and shields webviews while resizing', async () => {
    installDesktopApi({
      preferences: createInitialAssistantPreferences({
        assistantSidebarWidthPx: 360
      })
    })

    render(<AssistantSidebar />)

    const resizeHandle = screen.getByRole('separator', { name: '调整侧边栏宽度' })
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    Object.assign(resizeHandle, {
      setPointerCapture,
      releasePointerCapture
    })

    await act(async () => undefined)
    fireEvent.pointerDown(resizeHandle, { button: 0, buttons: 1, clientX: 100, pointerId: 7 })

    expect(setPointerCapture).toHaveBeenCalledWith(7)
    expect(document.querySelector('.assistant-sidebar__resize-shield')).toBeInTheDocument()

    await act(async () => {
      fireEvent.pointerUp(window, { clientX: 100, pointerId: 7 })
    })

    expect(releasePointerCapture).toHaveBeenCalledWith(7)
    expect(document.querySelector('.assistant-sidebar__resize-shield')).not.toBeInTheDocument()
  })

  it('reports one host resize session around sidebar pointer dragging', async () => {
    installDesktopApi({
      preferences: createInitialAssistantPreferences({ assistantSidebarWidthPx: 360 })
    })
    const onResizeActiveChange = vi.fn()
    render(<AssistantSidebar onResizeActiveChange={onResizeActiveChange} />)
    const resizeHandle = screen.getByRole('separator', { name: '调整侧边栏宽度' })
    await act(async () => undefined)

    fireEvent.pointerDown(resizeHandle, { button: 0, buttons: 1, clientX: 100, pointerId: 71 })
    fireEvent.pointerMove(window, { buttons: 1, clientX: 80, pointerId: 71 })
    fireEvent.pointerMove(window, { buttons: 1, clientX: 60, pointerId: 71 })
    expect(onResizeActiveChange).toHaveBeenCalledTimes(1)
    expect(onResizeActiveChange).toHaveBeenLastCalledWith(true)

    fireEvent.pointerUp(window, { clientX: 60, pointerId: 71 })
    expect(onResizeActiveChange).toHaveBeenCalledTimes(2)
    expect(onResizeActiveChange).toHaveBeenLastCalledWith(false)
  })

  it.each([
    ['pointer capture is lost', (resizeHandle: HTMLElement) => fireEvent.lostPointerCapture(resizeHandle, { pointerId: 72 })],
    ['the window loses focus', () => fireEvent.blur(window)]
  ])('ends the host resize session when %s', async (_reason, endSession) => {
    installDesktopApi({
      preferences: createInitialAssistantPreferences({ assistantSidebarWidthPx: 360 })
    })
    const onResizeActiveChange = vi.fn()
    render(<AssistantSidebar onResizeActiveChange={onResizeActiveChange} />)
    const resizeHandle = screen.getByRole('separator', { name: '调整侧边栏宽度' })
    await act(async () => undefined)

    fireEvent.pointerDown(resizeHandle, { button: 0, buttons: 1, clientX: 100, pointerId: 72 })
    fireEvent.pointerMove(window, { buttons: 1, clientX: 80, pointerId: 72 })
    endSession(resizeHandle)

    expect(onResizeActiveChange).toHaveBeenLastCalledWith(false)
    expect(document.querySelector('.assistant-sidebar__resize-shield')).not.toBeInTheDocument()
  })

  it('ignores move and release events from a different pointer during resizing', async () => {
    installDesktopApi({
      preferences: createInitialAssistantPreferences({ assistantSidebarWidthPx: 360 })
    })
    const onResizeActiveChange = vi.fn()
    render(<AssistantSidebar onResizeActiveChange={onResizeActiveChange} />)
    const sidebar = screen.getByRole('complementary', { name: 'bilimi 侧边栏' })
    const resizeHandle = screen.getByRole('separator', { name: '调整侧边栏宽度' })
    await act(async () => undefined)

    fireEvent.pointerDown(resizeHandle, { button: 0, buttons: 1, clientX: 100, pointerId: 73 })
    fireEvent.pointerMove(window, { buttons: 1, clientX: 20, pointerId: 74 })
    fireEvent.pointerUp(window, { clientX: 20, pointerId: 74 })

    expect(sidebar).toHaveStyle({ '--assistant-sidebar-width': '360px' })
    expect(onResizeActiveChange).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.assistant-sidebar__resize-shield')).toBeInTheDocument()

    fireEvent.pointerMove(window, { buttons: 1, clientX: 80, pointerId: 73 })
    fireEvent.pointerUp(window, { clientX: 80, pointerId: 73 })
    expect(sidebar).toHaveStyle({ '--assistant-sidebar-width': '380px' })
    expect(onResizeActiveChange).toHaveBeenLastCalledWith(false)
  })

  it('releases the resize shield before a pending width save completes without reloading preferences', async () => {
    let finishSave: ((widthPx: number | null) => void) | undefined
    const api = installDesktopApi({
      preferences: createInitialAssistantPreferences({ assistantSidebarWidthPx: 360 }),
      saveAssistantSidebarWidth: () => new Promise((resolve) => { finishSave = resolve })
    })
    render(<AssistantSidebar />)
    const resizeHandle = screen.getByRole('separator', { name: '调整侧边栏宽度' })
    await act(async () => undefined)
    api.loadPreferences.mockClear()

    fireEvent.pointerDown(resizeHandle, { button: 0, buttons: 1, clientX: 100, pointerId: 8 })
    fireEvent.pointerMove(window, { buttons: 1, clientX: 80, pointerId: 8 })
    fireEvent.pointerUp(window, { clientX: 80, pointerId: 8 })

    expect(document.querySelector('.assistant-sidebar__resize-shield')).not.toBeInTheDocument()
    expect(api.loadPreferences).not.toHaveBeenCalled()
    finishSave?.(380)
  })

  it('coalesces rapid completed drags into one final narrow width save', async () => {
    vi.useFakeTimers()
    const api = installDesktopApi({
      preferences: createInitialAssistantPreferences({ assistantSidebarWidthPx: 360 })
    })
    render(<AssistantSidebar />)
    const resizeHandle = screen.getByRole('separator', { name: '调整侧边栏宽度' })
    await act(async () => undefined)
    api.saveAssistantSidebarWidth.mockClear()

    fireEvent.pointerDown(resizeHandle, { button: 0, buttons: 1, clientX: 100, pointerId: 9 })
    fireEvent.pointerMove(window, { buttons: 1, clientX: 80, pointerId: 9 })
    fireEvent.pointerUp(window, { clientX: 80, pointerId: 9 })
    fireEvent.pointerDown(resizeHandle, { button: 0, buttons: 1, clientX: 80, pointerId: 10 })
    fireEvent.pointerMove(window, { buttons: 1, clientX: 40, pointerId: 10 })
    fireEvent.pointerUp(window, { clientX: 40, pointerId: 10 })

    expect(api.saveAssistantSidebarWidth).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(199) })
    expect(api.saveAssistantSidebarWidth).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(api.saveAssistantSidebarWidth).toHaveBeenCalledTimes(1)
    expect(api.saveAssistantSidebarWidth).toHaveBeenCalledWith(420)
    expect(api.patchPreferences).not.toHaveBeenCalled()
  })

  it('flushes the final pending width when the sidebar unmounts before the save delay', async () => {
    vi.useFakeTimers()
    const api = installDesktopApi({
      preferences: createInitialAssistantPreferences({ assistantSidebarWidthPx: 360 })
    })
    const { unmount } = render(<AssistantSidebar />)
    const resizeHandle = screen.getByRole('separator', { name: '调整侧边栏宽度' })
    await act(async () => undefined)
    api.saveAssistantSidebarWidth.mockClear()

    fireEvent.pointerDown(resizeHandle, { button: 0, buttons: 1, clientX: 100, pointerId: 13 })
    fireEvent.pointerMove(window, { buttons: 1, clientX: 80, pointerId: 13 })
    fireEvent.pointerUp(window, { pointerId: 13 })
    unmount()

    expect(api.saveAssistantSidebarWidth).toHaveBeenCalledTimes(1)
    expect(api.saveAssistantSidebarWidth).toHaveBeenCalledWith(380)
  })

  it('allows a new resize immediately after pointer release before persistence starts', async () => {
    vi.useFakeTimers()
    const api = installDesktopApi({
      preferences: createInitialAssistantPreferences({ assistantSidebarWidthPx: 360 })
    })
    render(<AssistantSidebar />)
    const resizeHandle = screen.getByRole('separator', { name: '调整侧边栏宽度' })
    await act(async () => undefined)
    api.saveAssistantSidebarWidth.mockClear()

    fireEvent.pointerDown(resizeHandle, { button: 0, buttons: 1, clientX: 100, pointerId: 11 })
    fireEvent.pointerMove(window, { buttons: 1, clientX: 80, pointerId: 11 })
    fireEvent.pointerUp(window, { clientX: 80, pointerId: 11 })
    expect(document.querySelector('.assistant-sidebar__resize-shield')).not.toBeInTheDocument()

    fireEvent.pointerDown(resizeHandle, { button: 0, buttons: 1, clientX: 80, pointerId: 12 })
    expect(document.querySelector('.assistant-sidebar__resize-shield')).toBeInTheDocument()
    expect(api.saveAssistantSidebarWidth).not.toHaveBeenCalled()
  })

  it('stops resizing when pointer moves after the left mouse button is released', async () => {
    installDesktopApi({
      preferences: createInitialAssistantPreferences({
        assistantSidebarWidthPx: 360
      })
    })

    render(<AssistantSidebar />)

    const sidebar = screen.getByRole('complementary', { name: 'bilimi 侧边栏' })
    const resizeHandle = screen.getByRole('separator', { name: '调整侧边栏宽度' })

    await act(async () => undefined)
    fireEvent.pointerDown(resizeHandle, { button: 0, buttons: 1, clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(window, { buttons: 0, clientX: 240, pointerId: 1 })

    expect(sidebar).toHaveStyle({ '--assistant-sidebar-width': '360px' })

    fireEvent.pointerMove(window, { buttons: 0, clientX: 280, pointerId: 1 })

    expect(sidebar).toHaveStyle({ '--assistant-sidebar-width': '360px' })
  })

  it('keeps the notes workspace mounted while the sidebar is collapsed', async () => {
    installDesktopApi()

    render(<AssistantSidebar />)

    fireEvent.click(await screen.findByRole('tab', { name: '札记' }))
    expect(await screen.findByRole('region', { name: '视频札记' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '折叠侧边栏' }))

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: '札记', hidden: true })).not.toBeVisible()
    )

    fireEvent.click(screen.getByRole('button', { name: '展开侧边栏' }))

    expect(await screen.findByRole('tab', { name: '札记' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByRole('region', { name: '视频札记' })).toBeInTheDocument()
  })

  it('removes a completed archive export and its folder access when the account changes', async () => {
    const startVideoNoteArchiveBatch = vi.fn().mockResolvedValue({
      batchId: 'batch-100', folderPath: 'C:\\exports\\bilimi文稿_2026-07-27_1200', succeededCount: 1, skippedCount: 0, failedCount: 0
    })
    const api = installDesktopApi({
      snapshot: assistantSnapshot('100'),
      archives: [archivedVideo('100', '旧账号档案')]
    })
    Object.assign(window.bilimiDesktop!, {
      previewVideoNoteArchiveBatch: vi.fn().mockResolvedValue({ selectedCount: 1, exportableCount: 1, skippedCount: 0 }),
      startVideoNoteArchiveBatch,
      cancelVideoNoteArchiveBatch: vi.fn(),
      openVideoNoteArchiveBatchFolder: vi.fn(),
      onVideoNoteArchiveBatchProgress: vi.fn(() => () => undefined)
    })

    render(<AssistantSidebar />)
    act(() => {
      api.openWorkspace({ tab: 'notes', openNoteArchive: true, sidebar: true })
    })
    fireEvent.click(await screen.findByRole('button', { name: /旧账号档案/ }))
    fireEvent.click(screen.getByRole('tab', { name: /无时间线文稿/ }))
    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    const dialog = await screen.findByRole('dialog', { name: '导出文稿' })
    fireEvent.click(screen.getByRole('button', { name: '开始导出' }))
    expect(await screen.findByRole('button', { name: '打开文件夹' })).toBeInTheDocument()

    act(() => {
      api.changeAccount(assistantSnapshot('200'), [archivedVideo('200', '新账号档案')])
    })

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '导出文稿' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '打开文件夹' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /旧账号档案/ })).not.toBeInTheDocument()
    })
    expect(await screen.findByRole('button', { name: /新账号档案/ })).toBeInTheDocument()
  })

  it('shows copy feedback in the global status and XiaoMi before restoring the previous status', async () => {
    window.sessionStorage.clear()
    const archive = archivedVideo('100', '复制反馈档案')
    archive.versions[0].plainTranscript = '需要复制的文稿。'
    const api = installDesktopApi({ archives: [archive] })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) }
    })

    render(<AssistantSidebar />)
    act(() => api.openWorkspace({ tab: 'notes', openNoteArchive: true, sidebar: true }))
    await waitFor(() => expect(api.loadVideoNoteArchives).toHaveBeenCalled())
    await act(async () => undefined)
    const archiveButton = await screen.findByRole('button', { name: /复制反馈档案/ })
    await act(async () => {
      fireEvent.click(archiveButton)
    })
    await screen.findByRole('article', { name: '复制反馈档案' })
    fireEvent.click(await screen.findByRole('tab', { name: /无时间线文稿/ }))
    const previousStatus = screen.getByLabelText('全局提示').textContent
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '复制无时间线文稿' }))

    await act(async () => undefined)
    expect(screen.getByLabelText('全局提示')).toHaveTextContent('无时间线文稿已复制')
    expect(api.setAssistantPetHint).toHaveBeenLastCalledWith({
      tone: 'happy',
      message: '主人，无时间线文稿已复制'
    })
    expect(screen.queryByText('无时间线文稿已复制', { selector: '.video-notes__feedback *' })).not.toBeInTheDocument()

    act(() => vi.advanceTimersByTime(3_000))
    expect(screen.getByLabelText('全局提示').textContent).toBe(previousStatus)
  })

  it('expands the one-line global message downward and closes it on an outside click', async () => {
    installDesktopApi({
      snapshot: {
        ...assistantSnapshot('100'),
        activeTabUrl: 'https://www.bilibili.com/video/BV1status'
      }
    })
    render(<AssistantSidebar />)
    const feedback = await screen.findByLabelText('全局提示')
    const disclosure = screen.getByRole('button', { name: '展开全局提示' })

    expect(feedback).toHaveAttribute('data-expanded', 'false')
    fireEvent.click(disclosure)
    expect(feedback).toHaveAttribute('data-expanded', 'true')
    expect(screen.getByRole('button', { name: '收起全局提示' })).toHaveAttribute('aria-expanded', 'true')

    fireEvent.pointerDown(document.body)
    expect(feedback).toHaveAttribute('data-expanded', 'false')
  })

  it('lets XiaoMi ask what to do when the sidebar expands', async () => {
    const api = installDesktopApi()

    render(<AssistantSidebar />)

    fireEvent.click(await screen.findByRole('button', { name: '折叠侧边栏' }))
    fireEvent.click(screen.getByRole('button', { name: '展开侧边栏' }))

    expect(api.setAssistantPetHint).toHaveBeenLastCalledWith({
      tone: 'hint',
      message: '主人想要做些什么呢~'
    })
  })

  it('does not nudge when the sidebar stays collapsed for a while', async () => {
    vi.useFakeTimers()
    const api = installDesktopApi()

    try {
      render(<AssistantSidebar />)

      await act(async () => undefined)
      fireEvent.click(screen.getByRole('button', { name: '折叠侧边栏' }))

      act(() => {
        vi.advanceTimersByTime(60_000)
      })

      expect(api.setAssistantPetHint).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('says goodbye when the sidebar is collapsed', async () => {
    const api = installDesktopApi()

    render(<AssistantSidebar />)

    await act(async () => undefined)
    fireEvent.click(screen.getByRole('button', { name: '折叠侧边栏' }))

    expect(api.setAssistantPetHint).toHaveBeenCalledWith({
      tone: 'sleepy',
      message: '主人先专心享受，有需要随时呼唤小咪'
    })
  })
})
