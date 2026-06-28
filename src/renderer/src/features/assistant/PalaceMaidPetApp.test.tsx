import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssistantPetHint, AssistantPetState } from './petState'
import type { AssistantPreferences } from '@shared/types'
import type { AssistantSnapshot } from './assistantRuntimeTypes'

vi.mock('./LayeredPetRenderer', () => ({
  LayeredPetRenderer: ({
    petState,
    clickReactionSignal,
    petStyle
  }: {
    petState: AssistantPetState
    clickReactionSignal: number
    petStyle: string
  }) => (
    <span
      data-testid="mock-layered-pet"
      data-pet-state={petState}
      data-click-reaction-signal={clickReactionSignal}
      data-pet-style={petStyle}
    />
  )
}))

import { PalaceMaidPetApp } from './PalaceMaidPetApp'

function createPreferences(overrides: Partial<AssistantPreferences> = {}): AssistantPreferences {
  return {
    favoritesFolderName: 'Bilimi',
    favoriteLedgers: [],
    ledgerPromptDismissed: true,
    preferenceCounts: {},
    petStyle: 'big-head',
    petHoverShortcuts: ['like', 'coin', 'comment', 'transcribe'],
    hidePetDuringVideoFullscreen: false,
    bilibiliOperationMode: 'api-assisted',
    favoriteArchiveMultiMode: 'off',
    deepseekEnabled: false,
    deepseekApiKeyStored: false,
    deepseekAutoSummaryEnabled: false,
    deepseekModel: 'deepseek-v4-flash',
    deepseekBaseUrl: 'https://api.deepseek.com',
    ...overrides
  }
}

function createSnapshot(overrides: Partial<AssistantSnapshot> = {}): AssistantSnapshot {
  return {
    preferences: createPreferences(),
    favoriteLedgerStatus: null,
    videoContentContext: {
      title: '测试视频'
    },
    videoTitle: '测试视频',
    activeTabUrl: 'https://www.bilibili.com/video/BV1test',
    ...overrides
  }
}

function installDesktopApi(overrides: Partial<Window['bilimiDesktop']> = {}) {
  const api = {
    version: '0.1.0',
    finishFloatingSealDrag: vi.fn(),
    onAssistantPetHintChanged: vi.fn(),
    onAssistantPetStateChanged: vi.fn(),
    restoreMainWindowFromPet: vi.fn().mockResolvedValue(undefined),
    savePreferences: vi.fn(),
    loadPreferences: vi.fn(),
    requestAssistantSnapshot: vi.fn().mockResolvedValue(createSnapshot()),
    generateDeepSeek: vi.fn().mockResolvedValue({
      kind: 'pet-chat',
      message: 'This page looks worth watching.'
    }),
    closeAssistantPet: vi.fn(),
    resizeFloatingSealByStep: vi.fn(),
    startFloatingSealDrag: vi.fn(),
    ...overrides
  } satisfies Partial<Window['bilimiDesktop']>

  Object.defineProperty(window, 'bilimiDesktop', {
    configurable: true,
    value: api
  })

  return api
}

describe('PalaceMaidPetApp', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('restores the main Bilimi window when clicked', async () => {
    const api = installDesktopApi()

    render(<PalaceMaidPetApp />)

    fireEvent.click(screen.getByRole('button', { name: '打开 Bilimi，小咪在这里' }))

    expect(api.restoreMainWindowFromPet).toHaveBeenCalledOnce()
    expect(window.bilimiDesktop.toggleFloatingAssistant).toBeUndefined()
    expect(window.bilimiDesktop.toggleFloatingMenu).toBeUndefined()
    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute(
      'data-click-reaction-signal',
      '1'
    )
  })

  it('welcomes the owner home with a stronger emotional hint when clicked to restore', async () => {
    const api = installDesktopApi()

    render(<PalaceMaidPetApp />)

    fireEvent.click(screen.getByRole('button', { name: '打开 Bilimi，小咪在这里' }))

    expect(api.restoreMainWindowFromPet).toHaveBeenCalledOnce()
    expect(screen.getByText(/欢迎回来|一直在等你|主人回来啦|欢迎回家/)).toBeInTheDocument()
    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute('data-pet-state', 'shy')
    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute(
      'data-click-reaction-signal',
      '1'
    )
  })

  it('shows a close prompt on right click and closes after the prompt is clicked', () => {
    const api = installDesktopApi()

    render(<PalaceMaidPetApp />)

    fireEvent.contextMenu(screen.getByRole('button', { name: '打开 Bilimi，小咪在这里' }))

    expect(api.closeAssistantPet).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '关闭宠物' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '关闭宠物' }))

    expect(api.closeAssistantPet).toHaveBeenCalledOnce()
    expect(api.restoreMainWindowFromPet).not.toHaveBeenCalled()
  })

  it('adds a pet chat action to the right-click prompt', async () => {
    const api = installDesktopApi({
      loadPreferences: vi.fn().mockResolvedValue(
        createPreferences({
          deepseekEnabled: true,
          deepseekApiKeyStored: true
        })
      )
    })

    render(<PalaceMaidPetApp />)

    fireEvent.contextMenu(screen.getByRole('button', { name: '打开 Bilimi，小咪在这里' }))

    expect(screen.getByRole('button', { name: '关闭宠物' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '对话宠物' }))

    await waitFor(() => expect(screen.getByLabelText('和小咪说话')).toBeInTheDocument())
    expect(api.closeAssistantPet).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '关闭宠物' })).not.toBeInTheDocument()
  })

  it('hides the right-click prompt when the pet window loses focus', () => {
    installDesktopApi()

    render(<PalaceMaidPetApp />)

    fireEvent.contextMenu(screen.getByRole('button', { name: '打开 Bilimi，小咪在这里' }))

    expect(screen.getByRole('button', { name: '关闭宠物' })).toBeInTheDocument()

    fireEvent(window, new Event('blur'))

    expect(screen.queryByRole('button', { name: '关闭宠物' })).not.toBeInTheDocument()
  })

  it('returns the pet chat to the head bubble when the pet window loses focus', async () => {
    installDesktopApi({
      loadPreferences: vi.fn().mockResolvedValue(
        createPreferences({
          deepseekEnabled: true,
          deepseekApiKeyStored: true
        })
      )
    })

    render(<PalaceMaidPetApp />)

    fireEvent.click(screen.getByRole('button', { name: '打开小咪对话' }))
    await waitFor(() => expect(screen.getByLabelText('和小咪说话')).toBeInTheDocument())

    fireEvent(window, new Event('blur'))

    expect(screen.queryByLabelText('和小咪说话')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '打开小咪对话' })).toBeInTheDocument()
  })

  it('renders pet state changes from the desktop shell', () => {
    let stateChanged: ((state: AssistantPetState) => void) | undefined
    installDesktopApi({
      onAssistantPetStateChanged: vi.fn((callback) => {
        stateChanged = callback
        return vi.fn()
      })
    })

    render(<PalaceMaidPetApp />)

    expect(screen.getByText('我是 bilimi，主人可以叫我小咪~')).toBeInTheDocument()

    act(() => {
      stateChanged?.('working')
    })

    expect(screen.queryByText('小咪忙碌中')).not.toBeInTheDocument()
    expect(screen.getByText('小咪正在处理，马上回来。')).toBeInTheDocument()
    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute('data-pet-state', 'working')
  })

  it('sends direct 小咪 chat messages through DeepSeek', async () => {
    const api = installDesktopApi({
      loadPreferences: vi.fn().mockResolvedValue(
        createPreferences({
          deepseekEnabled: true,
          deepseekApiKeyStored: true
        })
      )
    })

    render(<PalaceMaidPetApp />)

    fireEvent.click(screen.getByRole('button', { name: '打开小咪对话' }))
    await waitFor(() => expect(screen.getByLabelText('和小咪说话')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('和小咪说话'), {
      target: { value: 'watch this page' }
    })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    expect(api.generateDeepSeek).toHaveBeenCalledWith({
      kind: 'pet-chat',
      messages: [{ role: 'user', content: 'watch this page' }]
    })
    expect(await screen.findByText('This page looks worth watching.')).toBeInTheDocument()
  })

  it('speaks button-triggered hints in 小咪 voice without DeepSeek', () => {
    let hintChanged: ((hint: AssistantPetHint) => void) | undefined
    installDesktopApi({
      onAssistantPetHintChanged: vi.fn((callback) => {
        hintChanged = callback
        return vi.fn()
      })
    })

    render(<PalaceMaidPetApp />)

    act(() => {
      hintChanged?.({ tone: 'working', message: '主人，小咪正在帮你整理札记～' })
    })

    expect(screen.queryByText('小咪忙碌中')).not.toBeInTheDocument()
    expect(screen.getByText('主人，小咪正在帮你整理札记～')).toBeInTheDocument()
  })

  it('keeps the speech bubble free of the pet hint title line', () => {
    let hintChanged: ((hint: AssistantPetHint) => void) | undefined
    installDesktopApi({
      onAssistantPetHintChanged: vi.fn((callback) => {
        hintChanged = callback
        return vi.fn()
      })
    })

    render(<PalaceMaidPetApp />)

    act(() => {
      hintChanged?.({
        tone: 'hint',
        message: '\u5c0f\u54aa\u5207\u6362\u5230\u8fd9\u6761\u63d0\u793a\u4e86\u3002'
      })
    })

    expect(screen.queryByText('\u5c0f\u54aa\u63d0\u793a')).not.toBeInTheDocument()
    expect(screen.getByText('\u5c0f\u54aa\u5207\u6362\u5230\u8fd9\u6761\u63d0\u793a\u4e86\u3002')).toBeInTheDocument()
  })

  it('offers a caring idle greeting after the owner leaves it alone', () => {
    vi.useFakeTimers()
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    installDesktopApi()

    try {
      render(<PalaceMaidPetApp />)

      act(() => {
        vi.advanceTimersByTime(45_000)
      })

      expect(screen.getByText('主人还在吗？小咪在这里陪你慢慢看。')).toBeInTheDocument()
      expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute('data-pet-state', 'hint')
    } finally {
      random.mockRestore()
    }
  })

  it('scrolls the pet chat down to the newest reply', async () => {
    const scrollIntoView = vi.fn()
    const originalScrollIntoView = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scrollIntoView
    const api = installDesktopApi({
      loadPreferences: vi.fn().mockResolvedValue(
        createPreferences({
          deepseekEnabled: true,
          deepseekApiKeyStored: true
        })
      )
    })

    try {
      const { container } = render(<PalaceMaidPetApp />)

      fireEvent.click(container.querySelector('.palace-maid-pet__bubble-toggle') as HTMLElement)
      const chatInput = await waitFor(() => {
        const input = container.querySelector('.palace-maid-pet__chat-field input')
        expect(input).not.toBeNull()
        return input as HTMLInputElement
      })
      fireEvent.change(chatInput, {
        target: { value: 'watch this page' }
      })
      fireEvent.click(
        container.querySelector('.palace-maid-pet__chat button[type="submit"]') as HTMLElement
      )

      expect(api.generateDeepSeek).toHaveBeenCalledOnce()
      expect(await screen.findByText('This page looks worth watching.')).toBeInTheDocument()
      await waitFor(() =>
        expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'end', behavior: 'smooth' })
      )
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView
    }
  })

  it('tells the owner to enable DeepSeek when opening pet chat without support', async () => {
    const api = installDesktopApi()

    render(<PalaceMaidPetApp />)

    fireEvent.click(screen.getByRole('button', { name: '打开小咪对话' }))

    expect(
      await screen.findByText('主人，想要跟小咪交流的话去设置开启DeepSeek支持吧')
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('和小咪说话')).not.toBeInTheDocument()
    expect(api.generateDeepSeek).not.toHaveBeenCalled()
  })

  it('shows an alert when 小咪 chat fails', async () => {
    installDesktopApi({
      loadPreferences: vi.fn().mockResolvedValue(
        createPreferences({
          deepseekEnabled: true,
          deepseekApiKeyStored: true
        })
      ),
      generateDeepSeek: vi.fn().mockRejectedValue(new Error('DeepSeek failed.'))
    })

    render(<PalaceMaidPetApp />)

    fireEvent.click(screen.getByRole('button', { name: '打开小咪对话' }))
    await waitFor(() => expect(screen.getByLabelText('和小咪说话')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('和小咪说话'), {
      target: { value: 'watch this page' }
    })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('DeepSeek failed.')
  })

  it('loads the persisted pet style for the floating pet renderer', async () => {
    installDesktopApi({
      loadPreferences: vi.fn().mockResolvedValue({
        favoritesFolderName: 'Bilimi',
        favoriteLedgers: [],
        ledgerPromptDismissed: true,
        preferenceCounts: {},
        petStyle: 'classic',
        petHoverShortcuts: ['like', 'coin', 'comment', 'transcribe'],
        hidePetDuringVideoFullscreen: false,
        bilibiliOperationMode: 'api-assisted',
        favoriteArchiveMultiMode: 'off',
        deepseekEnabled: false,
        deepseekApiKeyStored: false,
        deepseekAutoSummaryEnabled: false,
        deepseekModel: 'deepseek-v4-flash',
        deepseekBaseUrl: 'https://api.deepseek.com'
      })
    })

    render(<PalaceMaidPetApp />)

    expect(await screen.findByTestId('mock-layered-pet')).toHaveAttribute(
      'data-pet-style',
      'classic'
    )
  })

  it('refreshes the floating pet renderer when assistant preferences change', async () => {
    let preferencesChanged: ((preferences: Parameters<Window['bilimiDesktop']['savePreferences']>[0]) => void) | undefined
    installDesktopApi({
      onAssistantPreferencesChanged: vi.fn((callback) => {
        preferencesChanged = callback
        return vi.fn()
      })
    })

    render(<PalaceMaidPetApp />)

    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute('data-pet-style', 'big-head')

    act(() => {
      preferencesChanged?.({
        favoritesFolderName: 'Bilimi',
        favoriteLedgers: [],
        ledgerPromptDismissed: true,
        preferenceCounts: {},
        petStyle: 'classic',
        petHoverShortcuts: ['like', 'coin', 'comment', 'transcribe'],
        hidePetDuringVideoFullscreen: false,
        bilibiliOperationMode: 'api-assisted',
        favoriteArchiveMultiMode: 'off',
        deepseekEnabled: false,
        deepseekApiKeyStored: false,
        deepseekAutoSummaryEnabled: false,
        deepseekModel: 'deepseek-v4-flash',
        deepseekBaseUrl: 'https://api.deepseek.com'
      })
    })

    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute('data-pet-style', 'classic')
  })

  it('keeps dragging from restoring the main window', () => {
    const api = installDesktopApi()

    render(<PalaceMaidPetApp />)

    const pet = screen.getByRole('button', { name: '打开 Bilimi，小咪在这里' })

    fireEvent.pointerDown(pet, { clientX: 10, clientY: 10, screenX: 110, screenY: 210, pointerId: 1 })
    fireEvent.pointerMove(pet, { clientX: 28, clientY: 22, screenX: 128, screenY: 222, pointerId: 1 })
    fireEvent.pointerUp(pet, { clientX: 28, clientY: 22, screenX: 128, screenY: 222, pointerId: 1 })
    fireEvent.click(pet)

    expect(api.startFloatingSealDrag).toHaveBeenCalledWith(110, 210)
    expect(api.finishFloatingSealDrag).toHaveBeenCalledOnce()
    expect(api.restoreMainWindowFromPet).not.toHaveBeenCalled()
    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute(
      'data-click-reaction-signal',
      '0'
    )
  })

  it('keeps a long press still until the pointer moves far enough to drag', () => {
    vi.useFakeTimers()
    const api = installDesktopApi()

    render(<PalaceMaidPetApp />)

    const pet = screen.getByRole('button', { name: '打开 Bilimi，小咪在这里' })

    fireEvent.pointerDown(pet, { clientX: 10, clientY: 10, screenX: 110, screenY: 210, pointerId: 1 })

    expect(pet).toHaveAttribute('data-pressed', 'true')

    act(() => {
      vi.advanceTimersByTime(450)
    })

    expect(pet).toHaveAttribute('data-pressed', 'true')
    expect(api.startFloatingSealDrag).not.toHaveBeenCalled()
    expect(api.resizeFloatingSealByStep).not.toHaveBeenCalled()

    fireEvent.pointerUp(pet, { clientX: 10, clientY: 10, screenX: 110, screenY: 210, pointerId: 1 })

    expect(pet).toHaveAttribute('data-pressed', 'false')

    fireEvent.click(pet)

    expect(api.finishFloatingSealDrag).not.toHaveBeenCalled()
    expect(api.restoreMainWindowFromPet).not.toHaveBeenCalled()
    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute(
      'data-click-reaction-signal',
      '0'
    )
  })

  it('shows foot-side step controls that resize only the pet character', () => {
    const api = installDesktopApi()

    const { container } = render(<PalaceMaidPetApp />)

    const pet = screen.getByRole('button', { name: '打开 Bilimi，小咪在这里' })
    const shell = container.querySelector('.palace-maid-pet-shell') as HTMLElement
    const resizeControls = screen.getByRole('group', {
      name: '调整小咪大小',
      hidden: true
    })

    expect(resizeControls).toHaveAttribute('data-visible', 'false')

    fireEvent.pointerEnter(pet)

    expect(resizeControls).toHaveAttribute('data-visible', 'true')

    const shrinkButton = screen.getByRole('button', { name: '缩小小咪' })
    const growButton = screen.getByRole('button', { name: '放大小咪' })

    fireEvent.click(shrinkButton)
    expect(shell.style.getPropertyValue('--floating-pet-size')).toBe('132px')
    expect(api.resizeFloatingSealByStep).not.toHaveBeenCalled()

    fireEvent.click(growButton)
    expect(shell.style.getPropertyValue('--floating-pet-size')).toBe('148px')

    expect(api.resizeFloatingSealByStep).not.toHaveBeenCalled()
    expect(api.finishFloatingSealDrag).not.toHaveBeenCalled()
    expect(api.restoreMainWindowFromPet).not.toHaveBeenCalled()
  })

  it('shows the configured hover shortcuts beside the pet and runs immediate video actions', async () => {
    const api = installDesktopApi({
      runFloatingMenuAction: vi.fn().mockResolvedValue(undefined)
    })

    render(<PalaceMaidPetApp />)

    const pet = screen.getByRole('button', { name: '打开 Bilimi，小咪在这里' })
    fireEvent.pointerEnter(pet)

    const shortcuts = screen.getByRole('group', { name: '小咪悬浮快捷按钮', hidden: true })
    expect(shortcuts).toHaveAttribute('data-visible', 'true')
    expect(shortcuts).toHaveAttribute('data-layout', 'fan')
    expect(screen.getAllByTestId('pet-hover-shortcut')).toHaveLength(4)
    expect(screen.getByRole('button', { name: '赏' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '赐' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '表' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '转' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '赏' }))

    await waitFor(() => expect(api.runFloatingMenuAction).toHaveBeenCalledWith('赏'))
    expect(api.restoreMainWindowFromPet).not.toHaveBeenCalled()
  })

  it('opens the full assistant for 表 hover shortcut so the user can choose a comment draft', async () => {
    const toggleFloatingAssistant = vi.fn().mockResolvedValue(undefined)
    const api = installDesktopApi({
      toggleFloatingAssistant,
      runFloatingMenuAction: vi.fn().mockResolvedValue(undefined)
    })

    render(<PalaceMaidPetApp />)

    fireEvent.pointerEnter(screen.getByRole('button', { name: '打开 Bilimi，小咪在这里' }))
    fireEvent.click(screen.getByRole('button', { name: '表' }))

    await waitFor(() => expect(api.toggleFloatingAssistant).toHaveBeenCalledOnce())
    expect(api.restoreMainWindowFromPet).not.toHaveBeenCalled()
    expect(api.runFloatingMenuAction).not.toHaveBeenCalledWith('表')
  })

  it('shows 暂无视频 instead of running a video hover action when no video is open', async () => {
    const api = installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          videoTitle: '首页',
          videoContentContext: {},
          activeTabUrl: 'https://www.bilibili.com/'
        })
      ),
      runFloatingMenuAction: vi.fn().mockResolvedValue(undefined)
    })

    render(<PalaceMaidPetApp />)

    fireEvent.pointerEnter(screen.getByRole('button', { name: '打开 Bilimi，小咪在这里' }))
    fireEvent.click(screen.getByRole('button', { name: '赏' }))

    expect(await screen.findByText('暂无视频')).toBeInTheDocument()
    expect(api.runFloatingMenuAction).not.toHaveBeenCalled()
    expect(api.restoreMainWindowFromPet).not.toHaveBeenCalled()
  })

  it('shows 暂无视频 instead of opening transcription when no video is open', async () => {
    const api = installDesktopApi({
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          videoTitle: '首页',
          videoContentContext: {},
          activeTabUrl: 'https://www.bilibili.com/'
        })
      )
    })

    render(<PalaceMaidPetApp />)

    fireEvent.pointerEnter(screen.getByRole('button', { name: '打开 Bilimi，小咪在这里' }))
    fireEvent.click(screen.getByRole('button', { name: '转' }))

    expect(await screen.findByText('暂无视频')).toBeInTheDocument()
    expect(api.restoreMainWindowFromPet).not.toHaveBeenCalled()
  })

  it('keeps custom hover shortcuts capped to the first four valid configured buttons', async () => {
    installDesktopApi({
      loadPreferences: vi.fn().mockResolvedValue(
        createPreferences({
          petHoverShortcuts: [
            'favorite',
            'library',
            'prepare-ledgers',
            'organize-old-favorites',
            'comment'
          ]
        })
      )
    })

    render(<PalaceMaidPetApp />)

    fireEvent.pointerEnter(screen.getByRole('button', { name: '打开 Bilimi，小咪在这里' }))

    await waitFor(() => expect(screen.getByRole('button', { name: '藏' })).toBeInTheDocument())
    expect(screen.getAllByTestId('pet-hover-shortcut')).toHaveLength(4)
    expect(screen.getByRole('button', { name: '库' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '备' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '整' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '表' })).not.toBeInTheDocument()
  })

  it('allows the configured hover shortcut list to be empty', async () => {
    installDesktopApi({
      loadPreferences: vi.fn().mockResolvedValue(
        createPreferences({
          petHoverShortcuts: []
        })
      )
    })

    render(<PalaceMaidPetApp />)

    fireEvent.pointerEnter(screen.getByRole('button', { name: '打开 Bilimi，小咪在这里' }))

    await waitFor(() =>
      expect(screen.queryAllByTestId('pet-hover-shortcut')).toHaveLength(0)
    )
  })

  it('keeps the speech bubble outside the resizable pet button', () => {
    installDesktopApi()

    const { container } = render(<PalaceMaidPetApp />)

    const bubble = container.querySelector('.palace-maid-pet__bubble')
    const pet = container.querySelector('.palace-maid-pet')

    expect(bubble).toBeInTheDocument()
    expect(pet).toBeInTheDocument()
    expect(bubble?.parentElement).toHaveClass('palace-maid-pet-shell')
    expect(pet).not.toContainElement(bubble as HTMLElement)
  })

  it('keeps the resize controls outside the pet button so resizing does not press the pet', () => {
    installDesktopApi()

    render(<PalaceMaidPetApp />)

    const pet = screen.getByRole('button', { name: '打开 Bilimi，小咪在这里' })
    fireEvent.pointerEnter(pet)

    const shrinkButton = screen.getByRole('button', { name: '缩小小咪' })

    fireEvent.pointerDown(shrinkButton, {
      clientX: 332,
      clientY: 212,
      screenX: 1232,
      screenY: 712,
      pointerId: 2
    })

    expect(pet).toHaveAttribute('data-pressed', 'false')
  })

  it('keeps resize controls visible briefly after leaving the pet so they can be reached', () => {
    vi.useFakeTimers()
    installDesktopApi()

    render(<PalaceMaidPetApp />)

    const pet = screen.getByRole('button', { name: '打开 Bilimi，小咪在这里' })
    const resizeControls = screen.getByRole('group', {
      name: '调整小咪大小',
      hidden: true
    })

    fireEvent.pointerEnter(pet)
    fireEvent.pointerLeave(pet)

    expect(resizeControls).toHaveAttribute('data-visible', 'true')

    act(() => {
      vi.advanceTimersByTime(350)
    })

    expect(resizeControls).toHaveAttribute('data-visible', 'false')
  })

  it('lets transparent host pixels click through unless the cursor is over pet controls', () => {
    const api = installDesktopApi({
      setFloatingSealMouseTransparent: vi.fn()
    })

    const { container } = render(<PalaceMaidPetApp />)

    const pet = container.querySelector('.palace-maid-pet') as HTMLElement
    const bubble = container.querySelector('.palace-maid-pet__bubble') as HTMLElement

    expect(api.setFloatingSealMouseTransparent).toHaveBeenCalledWith(true)

    fireEvent.pointerEnter(pet)
    expect(api.setFloatingSealMouseTransparent).toHaveBeenLastCalledWith(false)

    fireEvent.pointerLeave(pet)
    expect(api.setFloatingSealMouseTransparent).toHaveBeenLastCalledWith(true)

    fireEvent.pointerEnter(bubble)
    expect(api.setFloatingSealMouseTransparent).toHaveBeenLastCalledWith(false)
  })

  it('ignores repeated pointer-down events on a resize step until the click commits one resize', () => {
    const api = installDesktopApi()

    render(<PalaceMaidPetApp />)

    const pet = screen.getByRole('button', { name: '打开 Bilimi，小咪在这里' })
    fireEvent.pointerEnter(pet)
    const growButton = screen.getByRole('button', { name: '放大小咪' })

    fireEvent.pointerDown(growButton, { pointerId: 2 })
    fireEvent.pointerDown(growButton, { pointerId: 2 })
    expect(api.resizeFloatingSealByStep).not.toHaveBeenCalled()

    fireEvent.click(growButton)
    expect(api.resizeFloatingSealByStep).not.toHaveBeenCalled()
    expect(
      (document.querySelector('.palace-maid-pet-shell') as HTMLElement).style.getPropertyValue(
        '--floating-pet-size'
      )
    ).toBe('164px')
  })
})
