import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AssistantSidebar,
  ASSISTANT_SIDEBAR_DEFAULT_WIDTH_PX,
  clampAssistantSidebarWidthPx
} from './AssistantSidebar'
import { createInitialAssistantPreferences } from '../state/assistantState'

function setWindowInnerWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width
  })
}

function installDesktopApi({
  preferences = createInitialAssistantPreferences()
}: { preferences?: ReturnType<typeof createInitialAssistantPreferences> } = {}) {
  let openAssistantCallback: (() => void) | undefined
  let preferencesChangedCallback:
    | ((preferences: ReturnType<typeof createInitialAssistantPreferences>) => void)
    | undefined
  let storedPreferences = preferences
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
      requestAssistantSnapshot: vi.fn().mockResolvedValue(undefined),
      savePreferences: vi.fn(async (nextPreferences) => {
        storedPreferences = createInitialAssistantPreferences(nextPreferences)
        return storedPreferences
      }),
      patchPreferences: vi.fn(async (patch) => {
        storedPreferences = createInitialAssistantPreferences({ ...storedPreferences, ...patch })
        return storedPreferences
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
      loadVideoNoteArchives: vi.fn().mockResolvedValue([]),
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
    setAssistantPetHint: window.bilimiDesktop.setAssistantPetHint as ReturnType<typeof vi.fn>,
    patchPreferences: window.bilimiDesktop.patchPreferences as ReturnType<typeof vi.fn>,
    savePreferences: window.bilimiDesktop.savePreferences as ReturnType<typeof vi.fn>
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
    act(() => { vi.advanceTimersByTime(220) })
    expect(screen.getByRole('complementary', { name: 'bilimi 侧边栏' })).toHaveAttribute('data-collapsed', 'true')
    expect(screen.queryByRole('tab', { name: '批阅' })).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: '小咪展开侧栏' })).toHaveClass(
      'assistant-sidebar__collapse-pet'
    )

    expect(screen.getByText('展开')).toHaveClass('assistant-sidebar__collapse-label')

    fireEvent.click(screen.getByRole('button', { name: '展开侧边栏' }))

    expect(screen.getByRole('tab', { name: '批阅' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
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
    const defaultSystem = await screen.findByRole('checkbox', { name: '启用默认收藏夹' })
    expect(screen.getByText(/未备册也可先按默认逻辑目标等待标签完成后分类预览/)).toBeInTheDocument()
    expect(defaultSystem).toBeChecked()

    const settingsSections = Array.from(
      document.querySelectorAll<HTMLElement>('[data-settings-section]')
    ).map((section) => section.dataset.settingsSection)
    expect(settingsSections.slice(-3)).toEqual(['bilibili-connection', 'local-data', 'close'])
    expect(
      Array.from(screen.getByRole('combobox').querySelectorAll('option')).slice(-3).map((option) => option.value)
    ).toEqual(['bilibili-connection', 'local-data', 'close'])
  })

  it('shows only automatic system proxy and direct Bilibili connection choices', async () => {
    installDesktopApi({
      preferences: createInitialAssistantPreferences({ bilibiliConnectionMode: 'system' })
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

    await act(async () => {
      fireEvent.pointerUp(window, { clientX: 260, pointerId: 1 })
    })

    expect(api.patchPreferences).toHaveBeenLastCalledWith({ assistantSidebarWidthPx: 320 })
    expect(api.savePreferences).not.toHaveBeenCalled()

    fireEvent.doubleClick(resizeHandle)

    expect(sidebar.style.getPropertyValue('--assistant-sidebar-width')).toBe('')
    await waitFor(() =>
      expect(api.patchPreferences).toHaveBeenLastCalledWith({ assistantSidebarWidthPx: null })
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

  it('returns to the stylesheet default width when preferences clear the saved layout width', async () => {
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
      api.notifyPreferencesChanged(createInitialAssistantPreferences({ assistantSidebarWidthPx: null }))
    })

    expect(sidebar.style.getPropertyValue('--assistant-sidebar-width')).toBe('')
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
    expect(await screen.findByRole('region', { name: '转写状态' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '折叠侧边栏' }))

    expect(screen.getByRole('tab', { name: '札记', hidden: true })).not.toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: '展开侧边栏' }))

    expect(await screen.findByRole('tab', { name: '札记' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByRole('region', { name: '转写状态' })).toBeInTheDocument()
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
