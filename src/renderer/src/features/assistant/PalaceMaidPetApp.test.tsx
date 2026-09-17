import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { memo } from 'react'
import type { AssistantPetHint, AssistantPetState } from './petState'
import type { AssistantPreferences } from '@shared/types'
import type { AssistantSnapshot } from './assistantRuntimeTypes'
import { createInitialAssistantPreferences } from '../state/assistantState'

const layeredPetRender = vi.fn()

vi.mock('./LayeredPetRenderer', () => ({
  LayeredPetRenderer: memo(({
    petState,
    clickReactionSignal,
    petStyle
  }: {
    petState: AssistantPetState
    clickReactionSignal: number
    petStyle: string
  }) => {
    layeredPetRender({ petState, clickReactionSignal, petStyle })
    return (
      <span
        data-testid="mock-layered-pet"
        data-pet-state={petState}
        data-click-reaction-signal={clickReactionSignal}
        data-pet-style={petStyle}
      />
    )
  })
}))

import { PalaceMaidPetApp } from './PalaceMaidPetApp'

function createPreferences(overrides: Partial<AssistantPreferences> = {}): AssistantPreferences {
  return createInitialAssistantPreferences({
    favoritesFolderName: 'Bilimi',
    favoriteLedgers: [],
    ledgerPromptDismissed: true,
    preferenceCounts: {},
    petStyle: 'big-head',
    petHoverShortcuts: ['like', 'coin', 'comment', 'transcribe'],
    autoShowPetOnStartup: false,
    hidePetDuringVideoFullscreen: false,
    bilibiliOperationMode: 'api-assisted',
    favoriteArchiveMultiMode: 'off',
    commentSubmitMode: 'random',
    deepseekEnabled: false,
    deepseekApiKeyStored: false,
    deepseekCommentEnabled: false,
    deepseekAutoSummaryEnabled: false,
    deepseekPetChatEnabled: false,
    deepseekModel: 'deepseek-v4-flash',
    deepseekBaseUrl: 'https://api.deepseek.com',
    ...overrides
  })
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
    enqueueCurrentVideoAudioTranscription: vi.fn().mockResolvedValue({ items: [] }),
    ensureFavoriteLedgers: vi.fn().mockResolvedValue({
      ok: true,
      steps: ['ledger:ensure'],
      missingTargets: [],
      message: '册目已备齐。'
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
  it('does not rerender the pet for a ledger-enabled broadcast', async () => {
    let emitLedgerEnabled: ((patch: { accountMid: string; ledgerId: string; enabled: boolean }) => void) | undefined
    installDesktopApi({
      onFavoriteLedgerEnabledChanged: vi.fn((callback) => {
        emitLedgerEnabled = callback
        return vi.fn()
      })
    })
    render(<PalaceMaidPetApp />)
    await screen.findByTestId('mock-layered-pet')
    layeredPetRender.mockClear()

    act(() => emitLedgerEnabled?.({ accountMid: '100', ledgerId: 'knowledge', enabled: false }))

    expect(layeredPetRender).not.toHaveBeenCalled()
  })

  it('keeps chat typing outside the animated pet renderer', async () => {
    const preferences = createPreferences({
      deepseekEnabled: true,
      deepseekApiKeyStored: true,
      deepseekPetChatEnabled: true
    })
    installDesktopApi({
      loadPreferences: vi.fn().mockResolvedValue(preferences),
      requestAssistantSnapshot: vi.fn().mockResolvedValue(createSnapshot({
        preferences
      }))
    })
    layeredPetRender.mockClear()
    const { container } = render(<PalaceMaidPetApp />)
    fireEvent.click(container.querySelector('.palace-maid-pet__bubble-toggle') as HTMLElement)
    const input = await waitFor(() => {
      const candidate = container.querySelector('.palace-maid-pet__chat-field input')
      expect(candidate).not.toBeNull()
      return candidate as HTMLInputElement
    })
    const rendersBeforeTyping = layeredPetRender.mock.calls.length

    fireEvent.change(input, { target: { value: '连续输入不应重绘动画' } })

    expect(layeredPetRender).toHaveBeenCalledTimes(rendersBeforeTyping)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('restores the main Bilimi window when clicked', async () => {
    const api = installDesktopApi()

    const { container } = render(<PalaceMaidPetApp />)

    fireEvent.click(screen.getByRole('button', { name: '打开 bilimi，小咪在这里' }))

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

    fireEvent.click(screen.getByRole('button', { name: '打开 bilimi，小咪在这里' }))

    expect(api.restoreMainWindowFromPet).toHaveBeenCalledOnce()
    expect(screen.getByText(/欢迎回来|一直在等你|主人回来啦|欢迎回家/)).toBeInTheDocument()
    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute('data-pet-state', 'shy')
    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute(
      'data-click-reaction-signal',
      '1'
    )
  })

  it('cries immediately instead of restoring the main window on the third quick click', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-10T10:00:00+08:00'))
    const api = installDesktopApi()

    render(<PalaceMaidPetApp />)

    const pet = screen.getByRole('button', { name: '打开 bilimi，小咪在这里' })
    fireEvent.click(pet)
    vi.setSystemTime(new Date('2026-07-10T10:00:00.400+08:00'))
    fireEvent.click(pet)
    vi.setSystemTime(new Date('2026-07-10T10:00:00.800+08:00'))
    fireEvent.click(pet)
    expect(api.restoreMainWindowFromPet).toHaveBeenCalledTimes(2)
    expect(screen.getByText('主人你坏……小咪会被点晕的。')).toBeInTheDocument()
    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute('data-pet-state', 'crying')
    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute(
      'data-click-reaction-signal',
      '2'
    )

    vi.setSystemTime(new Date('2026-07-10T10:00:01.200+08:00'))
    fireEvent.click(pet)
    expect(api.restoreMainWindowFromPet).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute('data-pet-state', 'crying')
    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute(
      'data-click-reaction-signal',
      '2'
    )

    vi.setSystemTime(new Date('2026-07-10T10:00:04.200+08:00'))
    fireEvent.click(pet)
    expect(api.restoreMainWindowFromPet).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute('data-pet-state', 'crying')

    act(() => vi.advanceTimersByTime(4_999))
    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute('data-pet-state', 'crying')
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByTestId('mock-layered-pet')).not.toHaveAttribute('data-pet-state', 'crying')

    fireEvent.click(pet)
    expect(api.restoreMainWindowFromPet).toHaveBeenCalledTimes(3)
    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute('data-pet-state', 'shy')
  })

  it('shows a crying expression after hovering the close action for one second', () => {
    vi.useFakeTimers()
    const api = installDesktopApi()
    render(<PalaceMaidPetApp />)

    const pet = screen.getByRole('button', { name: '打开 bilimi，小咪在这里' })
    fireEvent.contextMenu(pet)
    const closeButton = screen.getByRole('button', { name: '关闭宠物' })
    fireEvent.pointerEnter(closeButton)
    act(() => vi.advanceTimersByTime(999))
    expect(screen.getByTestId('mock-layered-pet')).not.toHaveAttribute('data-pet-state', 'crying')
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute('data-pet-state', 'crying')
    expect(screen.getByText('主人要把小咪收起来了吗……')).toBeInTheDocument()
    fireEvent.pointerLeave(closeButton)
    expect(screen.getByTestId('mock-layered-pet')).not.toHaveAttribute('data-pet-state', 'crying')
    expect(api.closeAssistantPet).not.toHaveBeenCalled()
  })

  it('gets lonely after 180 seconds without owner interaction', async () => {
    vi.useFakeTimers()
    installDesktopApi()
    render(<PalaceMaidPetApp />)
    await act(async () => {
      await Promise.resolve()
      for (let index = 0; index < 4; index += 1) {
        vi.advanceTimersByTime(45_000)
        await Promise.resolve()
      }
    })
    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute('data-pet-state', 'crying')
    expect(screen.getByText('主人是不是忘记小咪了……')).toBeInTheDocument()
  })

  it('comforts long-idle crying on pet hover, then waits for another idle period before crying again', async () => {
    vi.useFakeTimers()
    installDesktopApi()
    render(<PalaceMaidPetApp />)

    await act(async () => {
      for (let index = 0; index < 4; index += 1) {
        vi.advanceTimersByTime(45_000)
        await Promise.resolve()
      }
    })
    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute('data-pet-state', 'crying')

    const pet = screen.getByRole('button', { name: '打开 bilimi，小咪在这里' })
    fireEvent.pointerEnter(pet)
    fireEvent.pointerLeave(pet)

    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute('data-pet-state', 'idle')

    await act(async () => {
      for (let index = 0; index < 4; index += 1) {
        vi.advanceTimersByTime(45_000)
        await Promise.resolve()
      }
    })
    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute('data-pet-state', 'crying')
  })

  it('shows a close prompt on right click and closes after the prompt is clicked', () => {
    const api = installDesktopApi()

    render(<PalaceMaidPetApp />)

    fireEvent.contextMenu(screen.getByRole('button', { name: '打开 bilimi，小咪在这里' }))

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
          deepseekApiKeyStored: true,
          deepseekPetChatEnabled: true
        })
      )
    })

    render(<PalaceMaidPetApp />)

    fireEvent.contextMenu(screen.getByRole('button', { name: '打开 bilimi，小咪在这里' }))

    expect(screen.getByRole('button', { name: '关闭宠物' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '对话宠物' }))

    await waitFor(() => expect(screen.getByLabelText('和小咪说话')).toBeInTheDocument())
    expect(api.closeAssistantPet).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '关闭宠物' })).not.toBeInTheDocument()
  })

  it('hides the right-click prompt when the pet window loses focus', () => {
    installDesktopApi()

    render(<PalaceMaidPetApp />)

    fireEvent.contextMenu(screen.getByRole('button', { name: '打开 bilimi，小咪在这里' }))

    expect(screen.getByRole('button', { name: '关闭宠物' })).toBeInTheDocument()

    fireEvent(window, new Event('blur'))

    expect(screen.queryByRole('button', { name: '关闭宠物' })).not.toBeInTheDocument()
  })

  it('restores the previous pet content when the window blurs during a menu preview', () => {
    installDesktopApi()

    render(<PalaceMaidPetApp />)

    fireEvent.contextMenu(screen.getByRole('button', { name: '打开 bilimi，小咪在这里' }))
    fireEvent.pointerEnter(screen.getByRole('button', { name: '关闭宠物' }))
    expect(screen.getByText('关闭宠物：主人要关闭小咪吗？')).toBeInTheDocument()

    fireEvent(window, new Event('blur'))

    expect(screen.getByText('我是 bilimi，主人可以叫我小咪~')).toBeInTheDocument()
    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute('data-pet-state', 'idle')
  })

  it('returns the pet chat to the head bubble when the pet window loses focus', async () => {
    installDesktopApi({
      loadPreferences: vi.fn().mockResolvedValue(
        createPreferences({
          deepseekEnabled: true,
          deepseekApiKeyStored: true,
          deepseekPetChatEnabled: true
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
          deepseekApiKeyStored: true,
          deepseekPetChatEnabled: true
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

  it('keeps desktop pet hint tones instead of flattening them to generic hints', () => {
    let hintChanged: ((hint: AssistantPetHint) => void) | undefined
    installDesktopApi({
      onAssistantPetHintChanged: vi.fn((callback) => {
        hintChanged = callback
        return vi.fn()
      })
    })

    render(<PalaceMaidPetApp />)

    act(() => {
      hintChanged?.({ tone: 'happy', message: '主人，档案库打开啦，想看的文稿都在这里。' })
    })

    expect(screen.getByText('主人，档案库打开啦，想看的文稿都在这里。')).toBeInTheDocument()
    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute('data-pet-state', 'happy')
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

  it('offers a caring idle greeting after the owner leaves it alone', async () => {
    vi.useFakeTimers()
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    installDesktopApi()

    try {
      render(<PalaceMaidPetApp />)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(45_000)
      })

      expect(screen.getByText('主人还在吗？小咪在这里陪你慢慢看。')).toBeInTheDocument()
      expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute('data-pet-state', 'hint')
    } finally {
      random.mockRestore()
    }
  })

  it('suppresses idle greetings while the main Bilimi window is visible and not minimized', async () => {
    vi.useFakeTimers()
    installDesktopApi({
      getMainWindowPresentationState: vi.fn().mockResolvedValue({ visible: true, minimized: false })
    })

    render(<PalaceMaidPetApp />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000)
    })

    expect(screen.queryByText('主人还在吗？小咪在这里陪你慢慢看。')).not.toBeInTheDocument()
    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute('data-pet-state', 'idle')
  })

  it('does not interrupt an open pet chat with idle greetings', () => {
    vi.useFakeTimers()
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    let hintChanged: ((hint: AssistantPetHint) => void) | undefined
    installDesktopApi({
      onAssistantPetHintChanged: vi.fn((callback) => {
        hintChanged = callback
        return vi.fn()
      })
    })

    try {
      render(<PalaceMaidPetApp />)

      fireEvent.click(screen.getByRole('button', { name: '打开小咪对话' }))
      expect(screen.getByRole('status')).toHaveTextContent('去设置开启DeepSeek支持吧')

      act(() => {
        vi.advanceTimersByTime(90_000)
      })

      expect(screen.queryByText('主人还在吗？小咪在这里陪你慢慢看。')).not.toBeInTheDocument()

      act(() => {
        hintChanged?.({ tone: 'done', message: '应用操作已经完成。' })
      })

      expect(screen.getByText('应用操作已经完成。')).toBeInTheDocument()
      expect(document.querySelector('.palace-maid-pet__chat-message')).not.toBeInTheDocument()
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
          deepseekApiKeyStored: true,
          deepseekPetChatEnabled: true
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

  it('does not call DeepSeek when only pet chat is disabled', async () => {
    const api = installDesktopApi({
      loadPreferences: vi.fn().mockResolvedValue(
        createPreferences({
          deepseekEnabled: true,
          deepseekApiKeyStored: true,
          deepseekPetChatEnabled: false
        })
      )
    })

    render(<PalaceMaidPetApp />)

    fireEvent.click(screen.getByRole('button', { name: '打开小咪对话' }))

    expect(
      await screen.findByText('主人，想要跟小咪交流的话去设置开启DeepSeek宠物对话功能吧')
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('和小咪说话')).not.toBeInTheDocument()
    expect(api.generateDeepSeek).not.toHaveBeenCalled()
  })

  it('stops offering pet chat after a preference broadcast disables it', async () => {
    let preferencesChanged: ((preferences: AssistantPreferences) => void) | undefined
    const api = installDesktopApi({
      loadPreferences: vi.fn().mockResolvedValue(
        createPreferences({
          deepseekEnabled: true,
          deepseekApiKeyStored: true,
          deepseekPetChatEnabled: true
        })
      ),
      onAssistantPreferencesChanged: vi.fn((callback) => {
        preferencesChanged = callback
        return vi.fn()
      })
    })

    render(<PalaceMaidPetApp />)
    fireEvent.click(screen.getByRole('button', { name: '打开小咪对话' }))
    await screen.findByLabelText('和小咪说话')

    act(() => {
      preferencesChanged?.(
        createPreferences({
          deepseekEnabled: true,
          deepseekApiKeyStored: true,
          deepseekPetChatEnabled: false
        })
      )
    })

    expect(screen.queryByLabelText('和小咪说话')).not.toBeInTheDocument()
    expect(screen.getByText('主人，想要跟小咪交流的话去设置开启DeepSeek宠物对话功能吧')).toBeInTheDocument()
    expect(api.generateDeepSeek).not.toHaveBeenCalled()
  })

  it('shows an alert when 小咪 chat fails', async () => {
    installDesktopApi({
      loadPreferences: vi.fn().mockResolvedValue(
        createPreferences({
          deepseekEnabled: true,
          deepseekApiKeyStored: true,
          deepseekPetChatEnabled: true
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

    expect(await screen.findByRole('alert')).toHaveTextContent('小咪现在还答不上来。')
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
        autoShowPetOnStartup: false,
        hidePetDuringVideoFullscreen: false,
        bilibiliOperationMode: 'api-assisted',
        favoriteArchiveMultiMode: 'off',
        deepseekEnabled: false,
        deepseekApiKeyStored: false,
        deepseekCommentEnabled: false,
        deepseekAutoSummaryEnabled: false,
        deepseekPetChatEnabled: false,
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
      preferencesChanged?.(createPreferences({ petStyle: 'classic' }))
    })

    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute('data-pet-style', 'classic')
  })

  it('keeps dragging from restoring the main window', () => {
    const api = installDesktopApi()

    render(<PalaceMaidPetApp />)

    const pet = screen.getByRole('button', { name: '打开 bilimi，小咪在这里' })

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

  it('starts dragging only from the primary mouse button and preserves the right-click menu', () => {
    const api = installDesktopApi()
    render(<PalaceMaidPetApp />)

    const pet = screen.getByRole('button', { name: '打开 bilimi，小咪在这里' })
    fireEvent.pointerDown(pet, { button: 2, clientX: 10, clientY: 10, screenX: 110, screenY: 210, pointerId: 2 })
    fireEvent.pointerMove(pet, { button: 2, clientX: 28, clientY: 22, screenX: 128, screenY: 222, pointerId: 2 })
    fireEvent.contextMenu(pet)

    expect(api.startFloatingSealDrag).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '关闭宠物' })).toBeInTheDocument()
  })

  it('finishes an active desktop drag when pointer capture is cancelled', () => {
    const api = installDesktopApi()

    render(<PalaceMaidPetApp />)

    const pet = screen.getByRole('button', { name: '打开 bilimi，小咪在这里' })

    fireEvent.pointerDown(pet, {
      clientX: 10,
      clientY: 10,
      screenX: 110,
      screenY: 210,
      pointerId: 1
    })
    fireEvent.pointerMove(pet, {
      clientX: 28,
      clientY: 22,
      screenX: 128,
      screenY: 222,
      pointerId: 1
    })
    fireEvent.pointerCancel(pet, { pointerId: 1 })

    expect(api.startFloatingSealDrag).toHaveBeenCalledWith(110, 210)
    expect(api.finishFloatingSealDrag).toHaveBeenCalledOnce()
    expect(pet).toHaveAttribute('data-pressed', 'false')
  })

  it('keeps a long press still until the pointer moves far enough to drag', () => {
    vi.useFakeTimers()
    const api = installDesktopApi()

    render(<PalaceMaidPetApp />)

    const pet = screen.getByRole('button', { name: '打开 bilimi，小咪在这里' })

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

    const pet = screen.getByRole('button', { name: '打开 bilimi，小咪在这里' })
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

  it('adds one extra smaller pet size step below the old minimum', () => {
    installDesktopApi()

    const { container } = render(<PalaceMaidPetApp />)

    const pet = screen.getByRole('button', { name: '打开 bilimi，小咪在这里' })
    const shell = container.querySelector('.palace-maid-pet-shell') as HTMLElement
    fireEvent.pointerEnter(pet)

    const shrinkButton = screen.getByRole('button', { name: '缩小小咪' })

    fireEvent.click(shrinkButton)
    expect(shell.style.getPropertyValue('--floating-pet-size')).toBe('132px')
    fireEvent.click(shrinkButton)
    expect(shell.style.getPropertyValue('--floating-pet-size')).toBe('116px')
    fireEvent.click(shrinkButton)
    expect(shell.style.getPropertyValue('--floating-pet-size')).toBe('100px')
    fireEvent.click(shrinkButton)
    expect(shell.style.getPropertyValue('--floating-pet-size')).toBe('100px')
  })

  it('shows the configured hover shortcuts beside the pet and runs immediate video actions', async () => {
    const api = installDesktopApi({
      runFloatingMenuAction: vi.fn().mockResolvedValue(undefined)
    })

    render(<PalaceMaidPetApp />)

    const pet = screen.getByRole('button', { name: '打开 bilimi，小咪在这里' })
    fireEvent.pointerEnter(pet)

    const shortcuts = screen.getByRole('group', { name: '小咪悬浮快捷按钮', hidden: true })
    expect(shortcuts).toHaveAttribute('data-visible', 'true')
    expect(shortcuts).toHaveAttribute('data-layout', 'fan')
    expect(shortcuts).toHaveAttribute('data-assistant-shortcut', 'true')
    expect(screen.getAllByTestId('pet-hover-shortcut')).toHaveLength(4)
    expect(screen.getByRole('button', { name: '打开小咪' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '赏' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '赐' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '表' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '转' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '赏' }))

    await waitFor(() => expect(api.runFloatingMenuAction).toHaveBeenCalledWith('赏'))
    expect(api.restoreMainWindowFromPet).not.toHaveBeenCalled()
  })

  it.each([
    ['like', '赏', '好哒主人，小咪去点赞，再收进合适的册目里～'],
    ['favorite', '藏', '好哒主人，小咪这就收进合适的册目里～'],
    ['coin', '赐', '收到～小咪去一键三连，再替主人归好类～']
  ] as const)('describes the real %s action in a natural working hint', async (shortcutId, label, hint) => {
    const api = installDesktopApi({
      loadPreferences: vi.fn().mockResolvedValue(
        createPreferences({
          petHoverShortcuts: [shortcutId]
        })
      ),
      runFloatingMenuAction: vi.fn(() => new Promise(() => {}))
    })

    render(<PalaceMaidPetApp />)

    fireEvent.pointerEnter(screen.getByRole('button', { name: '打开 bilimi，小咪在这里' }))
    fireEvent.click(await screen.findByRole('button', { name: label }))

    expect(await screen.findByText(hint)).toBeInTheDocument()
    expect(api.runFloatingMenuAction).toHaveBeenCalledWith(label)
  })

  it('uses a natural working hint while 小咪 prepares a video comment', async () => {
    installDesktopApi({
      loadPreferences: vi.fn().mockResolvedValue(
        createPreferences({
          petHoverShortcuts: ['comment'],
          deepseekEnabled: true,
          deepseekApiKeyStored: true,
          deepseekCommentEnabled: true
        })
      ),
      generateDeepSeek: vi.fn(() => new Promise(() => {}))
    })

    render(<PalaceMaidPetApp />)

    fireEvent.pointerEnter(screen.getByRole('button', { name: '打开 bilimi，小咪在这里' }))
    fireEvent.click(await screen.findByRole('button', { name: '表' }))

    expect(
      await screen.findByText('小咪正在读视频内容，马上替主人想一句～')
    ).toBeInTheDocument()
  })

  it('uses a natural working hint while 小咪 queues video transcription', async () => {
    installDesktopApi({
      loadPreferences: vi.fn().mockResolvedValue(
        createPreferences({
          petHoverShortcuts: ['transcribe']
        })
      ),
      enqueueCurrentVideoAudioTranscription: vi.fn(() => new Promise(() => {}))
    })

    render(<PalaceMaidPetApp />)

    fireEvent.pointerEnter(screen.getByRole('button', { name: '打开 bilimi，小咪在这里' }))
    fireEvent.click(await screen.findByRole('button', { name: '转' }))

    expect(
      await screen.findByText('好哒主人，小咪正在听视频，马上替主人整理成文字～')
    ).toBeInTheDocument()
  })

  it('opens the floating assistant workspace from the 咪 hover shortcut', async () => {
    const openFloatingAssistantWorkspace = vi.fn().mockResolvedValue(undefined)
    const assistantShortcutPreferences = createPreferences({
      petHoverShortcuts: ['like', 'coin'],
      showPetAssistantShortcut: true
    })
    const api = installDesktopApi({
      openFloatingAssistantWorkspace,
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: assistantShortcutPreferences
        })
      ),
      loadPreferences: vi.fn().mockResolvedValue(assistantShortcutPreferences),
      runFloatingMenuAction: vi.fn().mockResolvedValue(undefined)
    })

    render(<PalaceMaidPetApp />)

    fireEvent.pointerEnter(screen.getByRole('button', { name: '打开 bilimi，小咪在这里' }))
    fireEvent.click(await screen.findByRole('button', { name: '打开小咪' }))

    await waitFor(() =>
      expect(api.openFloatingAssistantWorkspace).toHaveBeenCalledWith({ tab: 'review' })
    )
    expect(api.restoreMainWindowFromPet).not.toHaveBeenCalled()
    expect(api.runFloatingMenuAction).not.toHaveBeenCalledWith('表')
  })

  it('anchors the floating assistant workspace to the clicked pet hover shortcut', async () => {
    const assistantShortcutPreferences = createPreferences({
      petHoverShortcuts: ['like', 'coin'],
      showPetAssistantShortcut: true
    })
    const api = installDesktopApi({
      openFloatingAssistantWorkspace: vi.fn().mockResolvedValue(undefined),
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: assistantShortcutPreferences
        })
      ),
      loadPreferences: vi.fn().mockResolvedValue(assistantShortcutPreferences)
    })

    const { container } = render(<PalaceMaidPetApp />)

    fireEvent.pointerEnter(screen.getByRole('button', { name: '打开 bilimi，小咪在这里' }))
    fireEvent.click(await screen.findByRole('button', { name: '打开小咪' }), {
      screenX: 720,
      screenY: 460
    })

    await waitFor(() =>
      expect(api.openFloatingAssistantWorkspace).toHaveBeenCalledWith({
        tab: 'review',
        anchor: { screenX: 720, screenY: 460 }
      })
    )
    expect(container.querySelector('.palace-maid-pet-shell')).not.toHaveAttribute('data-workspace-side')
  })

  it('keeps the bubble centered when the workspace opens on either side', async () => {
    const assistantShortcutPreferences = createPreferences({
      petHoverShortcuts: ['like', 'coin'],
      showPetAssistantShortcut: true
    })
    installDesktopApi({
      openFloatingAssistantWorkspace: vi.fn().mockResolvedValue(undefined),
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({ preferences: assistantShortcutPreferences })
      ),
      loadPreferences: vi.fn().mockResolvedValue(assistantShortcutPreferences)
    })

    const { container } = render(<PalaceMaidPetApp />)
    fireEvent.pointerEnter(screen.getByRole('button', { name: '打开 bilimi，小咪在这里' }))
    fireEvent.click(await screen.findByRole('button', { name: '打开小咪' }), {
      screenX: 100,
      screenY: 460
    })

    expect(container.querySelector('.palace-maid-pet-shell')).not.toHaveAttribute('data-workspace-side')
  })

  it('hides the standalone assistant shortcut when the preference is disabled', async () => {
    installDesktopApi({
      loadPreferences: vi.fn().mockResolvedValue(
        createPreferences({
          petHoverShortcuts: ['like', 'coin'],
          showPetAssistantShortcut: false
        })
      )
    })

    render(<PalaceMaidPetApp />)

    fireEvent.pointerEnter(screen.getByRole('button', { name: '打开 bilimi，小咪在这里' }))

    await waitFor(() => expect(screen.getByRole('button', { name: '赏' })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '打开小咪' })).not.toBeInTheDocument()
  })

  it('keeps four business shortcuts in the fan layout until the pet is very small', async () => {
    installDesktopApi({
      loadPreferences: vi.fn().mockResolvedValue(
        createPreferences({
          petHoverShortcuts: ['like', 'favorite', 'coin', 'comment'],
          showPetAssistantShortcut: true
        })
      )
    })

    render(<PalaceMaidPetApp />)

    fireEvent.pointerEnter(screen.getByRole('button', { name: '打开 bilimi，小咪在这里' }))

    const shortcuts = await screen.findByRole('group', { name: '小咪悬浮快捷按钮', hidden: true })
    await waitFor(() => expect(screen.getAllByTestId('pet-hover-shortcut')).toHaveLength(4))
    expect(screen.getByRole('button', { name: '打开小咪' })).toBeInTheDocument()
    expect(shortcuts).toHaveAttribute('data-layout', 'fan')

    const pet = screen.getByRole('button', { name: '打开 bilimi，小咪在这里' })
    fireEvent.pointerEnter(pet)
    fireEvent.click(screen.getByRole('button', { name: '缩小小咪' }))
    fireEvent.click(screen.getByRole('button', { name: '缩小小咪' }))

    expect(shortcuts).toHaveAttribute('data-layout', 'grid')
  })

  it('sends a random 表 directly without changing choose-mode settings', async () => {
    const api = installDesktopApi({
      openAssistant: vi.fn().mockResolvedValue(undefined),
      openFloatingAssistantWorkspace: vi.fn().mockResolvedValue(undefined),
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: createPreferences({
            commentSubmitMode: 'choose',
            petHoverShortcuts: ['like', 'coin', 'comment', 'transcribe']
          })
        })
      ),
      loadPreferences: vi.fn().mockResolvedValue(
        createPreferences({
          commentSubmitMode: 'choose',
          petHoverShortcuts: ['like', 'coin', 'comment', 'transcribe']
        })
      ),
      runFloatingMenuAction: vi.fn().mockResolvedValue(undefined)
    })

    render(<PalaceMaidPetApp />)

    fireEvent.pointerEnter(screen.getByRole('button', { name: '打开 bilimi，小咪在这里' }))
    fireEvent.click(await screen.findByRole('button', { name: '表' }))

    await waitFor(() =>
      expect(api.runFloatingMenuAction).toHaveBeenCalledWith('表', { submitComment: true })
    )
    expect(
      screen.getByText('DeepSeek 短评未生成，已改用本地短评。')
    ).toBeInTheDocument()
    expect(api.openAssistant).not.toHaveBeenCalled()
    expect(api.openFloatingAssistantWorkspace).not.toHaveBeenCalled()
  })

  it('labels the local fallback when DeepSeek pet comment generation fails', async () => {
    const preferences = createPreferences({
      deepseekEnabled: true,
      deepseekCommentEnabled: true,
      petHoverShortcuts: ['comment']
    })
    const runFloatingMenuAction = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['danmaku:trusted-enter'],
      missingTargets: [],
      message: '弹幕已发送。'
    })
    const api = installDesktopApi({
      loadPreferences: vi.fn().mockResolvedValue(preferences),
      requestAssistantSnapshot: vi.fn().mockResolvedValue(createSnapshot({ preferences })),
      generateDeepSeek: vi.fn().mockRejectedValue(new Error('DeepSeek 输出无效。')),
      runFloatingMenuAction
    })

    render(<PalaceMaidPetApp />)

    fireEvent.pointerEnter(screen.getByRole('button', { name: '打开 bilimi，小咪在这里' }))
    fireEvent.click(await screen.findByRole('button', { name: '表' }))

    await waitFor(() =>
      expect(runFloatingMenuAction).toHaveBeenCalledWith('表', { submitComment: true })
    )
    expect(
      screen.getByText('DeepSeek 短评未生成，已改用本地短评。弹幕已发送。')
    ).toBeInTheDocument()
    expect(api.generateDeepSeek).toHaveBeenCalledOnce()
  })

  it('uses DeepSeek for the pet comment shortcut when the feature is enabled', async () => {
    const preferences = createPreferences({
      deepseekEnabled: true,
      deepseekCommentEnabled: true,
      petHoverShortcuts: ['comment']
    })
    const generateDeepSeek = vi.fn().mockResolvedValue({
      kind: 'review-comment',
      comments: ['DeepSeek 短评一', 'DeepSeek 短评二', 'DeepSeek 短评三']
    })
    const runFloatingMenuAction = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['danmaku:trusted-enter'],
      missingTargets: [],
      message: '弹幕已发送。'
    })
    const api = installDesktopApi({
      openFloatingAssistantWorkspace: vi.fn().mockResolvedValue(undefined),
      loadPreferences: vi.fn().mockResolvedValue(preferences),
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences,
          videoTitle: '挑战充气城堡度过一晚',
          videoContentContext: {
            title: '挑战充气城堡度过一晚',
            author: '我是E嗨',
            description: '半夜突然放气的挑战',
            tags: ['挑战', '充气城堡'],
            category: '搞笑'
          }
        })
      ),
      generateDeepSeek,
      runFloatingMenuAction
    })

    render(<PalaceMaidPetApp />)

    fireEvent.pointerEnter(screen.getByRole('button', { name: '打开 bilimi，小咪在这里' }))
    fireEvent.click(await screen.findByRole('button', { name: '表' }))

    await waitFor(() =>
      expect(generateDeepSeek).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'review-comment',
          title: '挑战充气城堡度过一晚',
          author: '我是E嗨',
          description: '半夜突然放气的挑战',
          tags: ['挑战', '充气城堡']
        })
      )
    )
    await waitFor(() =>
      expect(runFloatingMenuAction).toHaveBeenCalledWith('表', {
        submitComment: true,
        commentDraft: expect.stringMatching(/^DeepSeek 短评[一二三]$/)
      })
    )
    expect(api.openFloatingAssistantWorkspace).not.toHaveBeenCalled()
  })

  it('keeps choose-mode settings while blocking a pet 表 shortcut without a video', async () => {
    const api = installDesktopApi({
      openFloatingAssistantWorkspace: vi.fn().mockResolvedValue(undefined),
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          videoTitle: '首页',
          videoContentContext: {},
          activeTabUrl: 'https://www.bilibili.com/',
          preferences: createPreferences({
            commentSubmitMode: 'choose',
            petHoverShortcuts: ['comment']
          })
        })
      ),
      loadPreferences: vi.fn().mockResolvedValue(
        createPreferences({
          commentSubmitMode: 'choose',
          petHoverShortcuts: ['comment']
        })
      ),
      runFloatingMenuAction: vi.fn().mockResolvedValue(undefined)
    })

    render(<PalaceMaidPetApp />)

    fireEvent.pointerEnter(screen.getByRole('button', { name: '打开 bilimi，小咪在这里' }))
    fireEvent.click(await screen.findByRole('button', { name: '表' }))

    expect(await screen.findByText('这里没有视频，小咪帮不上忙，呜……')).toBeInTheDocument()
    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute('data-pet-state', 'crying')
    expect(api.openFloatingAssistantWorkspace).not.toHaveBeenCalled()
    expect(api.runFloatingMenuAction).not.toHaveBeenCalled()
    expect(
      (await api.loadPreferences()).commentSubmitMode
    ).toBe('choose')
  })

  it('sends 表 directly from the pet shortcut when random danmaku mode is enabled', async () => {
    const randomCommentPreferences = createPreferences({
      commentSubmitMode: 'random',
      petHoverShortcuts: ['comment']
    })
    const api = installDesktopApi({
      openFloatingAssistantWorkspace: vi.fn().mockResolvedValue(undefined),
      requestAssistantSnapshot: vi.fn().mockResolvedValue(
        createSnapshot({
          preferences: randomCommentPreferences
        })
      ),
      loadPreferences: vi.fn().mockResolvedValue(randomCommentPreferences),
      runFloatingMenuAction: vi.fn().mockResolvedValue({
        ok: true,
        steps: ['danmaku:trusted-enter'],
        missingTargets: [],
        message: '弹幕已发送，没有看到请检查弹幕开关是否开启'
      })
    })

    render(<PalaceMaidPetApp />)

    fireEvent.pointerEnter(screen.getByRole('button', { name: '打开 bilimi，小咪在这里' }))
    fireEvent.click(await screen.findByRole('button', { name: '表' }))

    await waitFor(() =>
      expect(api.runFloatingMenuAction).toHaveBeenCalledWith('表', { submitComment: true })
    )
    expect(api.openFloatingAssistantWorkspace).not.toHaveBeenCalled()
    expect(
      screen.getByText(
        'DeepSeek 短评未生成，已改用本地短评。弹幕已发送，没有看到请检查弹幕开关是否开启'
      )
    ).toBeInTheDocument()
    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute('data-pet-state', 'done')
  })

  it('starts transcription directly from the 转 hover shortcut and only reports through 小咪', async () => {
    const api = installDesktopApi({
      loadPreferences: vi.fn().mockResolvedValue(
        createPreferences({
          petHoverShortcuts: ['transcribe']
        })
      )
    })

    render(<PalaceMaidPetApp />)

    fireEvent.pointerEnter(screen.getByRole('button', { name: '打开 bilimi，小咪在这里' }))
    fireEvent.click(await screen.findByRole('button', { name: '转' }))

    await waitFor(() => expect(api.enqueueCurrentVideoAudioTranscription).toHaveBeenCalledOnce())
    expect(screen.getByText('已加入转写队列，小咪会按顺序处理。')).toBeInTheDocument()
    expect(api.restoreMainWindowFromPet).not.toHaveBeenCalled()
  })

  it('drops the retired 备 hover shortcut from legacy preferences', async () => {
    const api = installDesktopApi({
      loadPreferences: vi.fn().mockResolvedValue(
        createPreferences({
          petHoverShortcuts: ['prepare-ledgers']
        })
      )
    })

    render(<PalaceMaidPetApp />)

    fireEvent.pointerEnter(screen.getByRole('button', { name: '打开 bilimi，小咪在这里' }))
    expect(screen.queryByRole('button', { name: '备' })).not.toBeInTheDocument()
    expect(api.ensureFavoriteLedgers).not.toHaveBeenCalled()
    expect(api.restoreMainWindowFromPet).not.toHaveBeenCalled()
  })

  it('drops the retired 库 and 整 shortcuts from legacy preferences', async () => {
    const api = installDesktopApi({
      openFloatingAssistantWorkspace: vi.fn().mockResolvedValue(undefined),
      loadPreferences: vi.fn().mockResolvedValue(
        createPreferences({
          petHoverShortcuts: ['library', 'organize-old-favorites']
        })
      )
    })

    render(<PalaceMaidPetApp />)

    fireEvent.pointerEnter(screen.getByRole('button', { name: '打开 bilimi，小咪在这里' }))
    expect(screen.queryByRole('button', { name: '库' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '整' })).not.toBeInTheDocument()
    expect(api.openFloatingAssistantWorkspace).not.toHaveBeenCalled()
  })

  it('explains hover shortcuts with their actual effect and restores the previous bubble', async () => {
    installDesktopApi({
      loadPreferences: vi.fn().mockResolvedValue(
        createPreferences({
          defaultCoinCount: 2,
          commentSubmitMode: 'choose'
        })
      )
    })

    render(<PalaceMaidPetApp />)

    expect(screen.getByText('我是 bilimi，主人可以叫我小咪~')).toBeInTheDocument()
    fireEvent.pointerEnter(screen.getByRole('button', { name: '打开 bilimi，小咪在这里' }))
    const coinButton = await screen.findByRole('button', { name: '赐' })
    fireEvent.pointerEnter(coinButton)

    expect(await screen.findByText('赐：一键三连，当前将投 2 枚硬币')).toBeInTheDocument()
    expect(coinButton).not.toHaveAttribute('title')

    fireEvent.pointerLeave(coinButton)
    expect(screen.getByText('我是 bilimi，主人可以叫我小咪~')).toBeInTheDocument()

    const commentButton = screen.getByRole('button', { name: '表' })
    fireEvent.pointerEnter(commentButton)

    expect(
      screen.getByText('表：一键弹幕，随机生成一条并直接发送，不改变设置')
    ).toBeInTheDocument()
  })

  it('uses the configured random comment and single-coin descriptions', async () => {
    installDesktopApi({
      loadPreferences: vi.fn().mockResolvedValue(
        createPreferences({
          defaultCoinCount: 1,
          commentSubmitMode: 'random'
        })
      )
    })

    render(<PalaceMaidPetApp />)

    fireEvent.pointerEnter(screen.getByRole('button', { name: '打开 bilimi，小咪在这里' }))
    fireEvent.pointerEnter(await screen.findByRole('button', { name: '赐' }))
    expect(screen.getByText('赐：一键三连，当前将投 1 枚硬币')).toBeInTheDocument()

    fireEvent.pointerEnter(screen.getByRole('button', { name: '表' }))
    expect(
      screen.getByText('表：一键弹幕，随机生成一条并直接发送，不改变设置')
    ).toBeInTheDocument()
  })

  it.each([
    ['like', '赏', '赏：一键点赞，并归类收藏到 bilimi'],
    ['favorite', '藏', '藏：一键归类收藏，不点赞不投币'],
    ['transcribe', '转', '转：将当前视频音频加入本地转写队列']
  ] as const)(
    'explains the %s shortcut with its actual effect',
    async (shortcutId, buttonName, description) => {
    installDesktopApi({
      loadPreferences: vi.fn().mockResolvedValue(
        createPreferences({
          petHoverShortcuts: [shortcutId]
        })
      )
    })

    render(<PalaceMaidPetApp />)

    fireEvent.pointerEnter(screen.getByRole('button', { name: '打开 bilimi，小咪在这里' }))
    fireEvent.pointerEnter(await screen.findByRole('button', { name: buttonName }))
    expect(screen.getByText(description)).toBeInTheDocument()
    }
  )

  it('previews menu actions with working and crying expressions, then restores the pet', () => {
    installDesktopApi()

    render(<PalaceMaidPetApp />)

    const pet = screen.getByRole('button', { name: '打开 bilimi，小咪在这里' })
    fireEvent.contextMenu(pet)

    const chatButton = screen.getByRole('button', { name: '对话宠物' })
    fireEvent.pointerEnter(chatButton)
    expect(
      screen.getByText('对话宠物：打开输入框，和小咪聊天（需启用 DeepSeek）')
    ).toBeInTheDocument()
    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute('data-pet-state', 'working')

    fireEvent.pointerLeave(chatButton)
    expect(screen.getByText('我是 bilimi，主人可以叫我小咪~')).toBeInTheDocument()
    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute('data-pet-state', 'idle')

    const closeButton = screen.getByRole('button', { name: '关闭宠物' })
    fireEvent.pointerEnter(closeButton)
    expect(screen.getByText('关闭宠物：主人要关闭小咪吗？')).toBeInTheDocument()
    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute('data-pet-state', 'error')
  })

  it('explains the pet immediately and becomes conversational after five seconds', () => {
    vi.useFakeTimers()
    installDesktopApi()

    render(<PalaceMaidPetApp />)

    const pet = screen.getByRole('button', { name: '打开 bilimi，小咪在这里' })
    fireEvent.pointerEnter(pet)

    expect(
      screen.getByText('小咪：打开/唤醒 bilimi~可拖拽移动，右键聊天或关闭')
    ).toBeInTheDocument()
    expect(pet).not.toHaveAttribute('title')

    act(() => {
      vi.advanceTimersByTime(4_999)
    })
    expect(screen.queryByText('嘿嘿主人，想要小咪做点什么吗~')).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.getByText('嘿嘿主人，想要小咪做点什么吗~')).toBeInTheDocument()

    fireEvent.pointerLeave(pet)
    expect(screen.getByText('我是 bilimi，主人可以叫我小咪~')).toBeInTheDocument()
  })

  it('lets click feedback replace the pet hover explanation', () => {
    installDesktopApi()

    render(<PalaceMaidPetApp />)

    const pet = screen.getByRole('button', { name: '打开 bilimi，小咪在这里' })
    fireEvent.pointerEnter(pet)
    fireEvent.click(pet)

    expect(
      screen.queryByText('小咪：打开/唤醒 bilimi~可拖拽移动，右键聊天或关闭')
    ).not.toBeInTheDocument()
    expect(screen.getByTestId('mock-layered-pet')).not.toHaveAttribute('data-pet-state', 'hint')
  })

  it('clears the menu preview when pet chat opens', async () => {
    installDesktopApi({
      loadPreferences: vi.fn().mockResolvedValue(
        createPreferences({
          deepseekEnabled: true,
          deepseekApiKeyStored: true,
          deepseekPetChatEnabled: true
        })
      )
    })

    render(<PalaceMaidPetApp />)

    fireEvent.contextMenu(screen.getByRole('button', { name: '打开 bilimi，小咪在这里' }))
    const chatButton = screen.getByRole('button', { name: '对话宠物' })
    fireEvent.pointerEnter(chatButton)
    fireEvent.click(chatButton)

    expect(await screen.findByLabelText('和小咪说话')).toBeInTheDocument()
    expect(
      screen.queryByText('对话宠物：打开输入框，和小咪聊天（需启用 DeepSeek）')
    ).not.toBeInTheDocument()
  })

  it('explains resize buttons only while the pointer is over them', () => {
    installDesktopApi()

    render(<PalaceMaidPetApp />)

    fireEvent.pointerEnter(screen.getByRole('button', { name: '打开 bilimi，小咪在这里' }))
    const shrinkButton = screen.getByRole('button', { name: '缩小小咪' })
    fireEvent.pointerEnter(shrinkButton)
    expect(screen.getByText('缩小：缩小小咪的显示尺寸')).toBeInTheDocument()
    expect(shrinkButton).not.toHaveAttribute('title')

    const growButton = screen.getByRole('button', { name: '放大小咪' })
    fireEvent.pointerEnter(growButton)
    expect(screen.getByText('放大：放大小咪的显示尺寸')).toBeInTheDocument()

    fireEvent.pointerLeave(growButton)
    expect(screen.getByText('我是 bilimi，主人可以叫我小咪~')).toBeInTheDocument()
  })

  it('keeps the chat bubble and send button free of hover explanations', async () => {
    installDesktopApi({
      loadPreferences: vi.fn().mockResolvedValue(
        createPreferences({
          deepseekEnabled: true,
          deepseekApiKeyStored: true,
          deepseekPetChatEnabled: true
        })
      )
    })

    render(<PalaceMaidPetApp />)
    fireEvent.click(screen.getByRole('button', { name: '打开小咪对话' }))

    const input = await screen.findByLabelText('和小咪说话')
    const sendButton = screen.getByRole('button', { name: '发送' })
    expect(input.closest('.palace-maid-pet__chat-compose')).toContainElement(sendButton)

    fireEvent.pointerEnter(sendButton)
    expect(screen.getByText('我是 bilimi，主人可以叫我小咪~')).toBeInTheDocument()
  })

  it('uses a concrete 小咪 hint instead of 暂无视频 when no video is open', async () => {
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

    fireEvent.pointerEnter(screen.getByRole('button', { name: '打开 bilimi，小咪在这里' }))
    fireEvent.click(screen.getByRole('button', { name: '赏' }))

    expect(await screen.findByText('这里没有视频，小咪帮不上忙，呜……')).toBeInTheDocument()
    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute('data-pet-state', 'crying')
    expect(screen.queryByText('暂无视频')).not.toBeInTheDocument()
    expect(api.runFloatingMenuAction).not.toHaveBeenCalled()
    expect(api.restoreMainWindowFromPet).not.toHaveBeenCalled()
  })

  it('uses a concrete 小咪 hint instead of 暂无视频 when transcription has no video', async () => {
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

    fireEvent.pointerEnter(screen.getByRole('button', { name: '打开 bilimi，小咪在这里' }))
    fireEvent.click(screen.getByRole('button', { name: '转' }))

    expect(await screen.findByText('这里没有视频，小咪帮不上忙，呜……')).toBeInTheDocument()
    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute('data-pet-state', 'crying')
    expect(screen.queryByText('暂无视频')).not.toBeInTheDocument()
    expect(api.restoreMainWindowFromPet).not.toHaveBeenCalled()
  })

  it('keeps custom hover shortcuts capped to the first four valid configured buttons', async () => {
    installDesktopApi({
      loadPreferences: vi.fn().mockResolvedValue(
        createPreferences({
          petHoverShortcuts: [
            'favorite',
            'prepare-ledgers',
            'library',
            'organize-old-favorites',
            'comment',
            'coin',
            'like'
          ]
        })
      )
    })

    render(<PalaceMaidPetApp />)

    fireEvent.pointerEnter(screen.getByRole('button', { name: '打开 bilimi，小咪在这里' }))

    await waitFor(() => expect(screen.getByRole('button', { name: '藏' })).toBeInTheDocument())
    expect(screen.getAllByTestId('pet-hover-shortcut')).toHaveLength(4)
    expect(screen.getByRole('button', { name: '表' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '赐' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '赏' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '库' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '备' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '整' })).not.toBeInTheDocument()
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

    fireEvent.pointerEnter(screen.getByRole('button', { name: '打开 bilimi，小咪在这里' }))

    await waitFor(() =>
      expect(screen.queryAllByTestId('pet-hover-shortcut')).toHaveLength(0)
    )
  })

  it('updates hover shortcuts from a narrow preference patch without reloading preferences', async () => {
    let emitPreferencePatch: Parameters<NonNullable<Window['bilimiDesktop']['onAssistantPreferencePatchChanged']>>[0] | undefined
    const api = installDesktopApi({
      loadPreferences: vi.fn().mockResolvedValue(
        createPreferences({ petHoverShortcuts: ['like', 'coin', 'comment', 'transcribe'] })
      ),
      onAssistantPreferencePatchChanged: vi.fn((callback) => {
        emitPreferencePatch = callback
        return () => {}
      })
    })

    render(<PalaceMaidPetApp />)
    fireEvent.pointerEnter(screen.getByRole('button', { name: '打开 bilimi，小咪在这里' }))
    await waitFor(() => expect(screen.getAllByTestId('pet-hover-shortcut')).toHaveLength(4))

    act(() => emitPreferencePatch?.({ petHoverShortcuts: ['favorite', 'comment'] }))

    expect(screen.getAllByTestId('pet-hover-shortcut')).toHaveLength(2)
    expect(screen.getByRole('button', { name: '藏' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '表' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '赏' })).not.toBeInTheDocument()
    expect(api.loadPreferences).toHaveBeenCalledTimes(1)
  })

  it('keeps the latest hover shortcut preview when an older persistence echo arrives', async () => {
    let emitPreferencePatch: Parameters<NonNullable<Window['bilimiDesktop']['onAssistantPreferencePatchChanged']>>[0] | undefined
    installDesktopApi({
      loadPreferences: vi.fn().mockResolvedValue(createPreferences({ petHoverShortcuts: ['like'] })),
      onAssistantPreferencePatchChanged: vi.fn((callback) => {
        emitPreferencePatch = callback
        return () => {}
      })
    })

    render(<PalaceMaidPetApp />)
    fireEvent.pointerEnter(screen.getByRole('button', { name: '打开 bilimi，小咪在这里' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '赏' })).toBeInTheDocument())

    act(() => {
      emitPreferencePatch?.({ petHoverShortcuts: ['favorite', 'comment'] }, { originId: 'pet_shortcuts', mutationId: 2 })
      emitPreferencePatch?.({ petHoverShortcuts: ['coin'] }, { originId: 'pet_shortcuts', mutationId: 1 })
    })

    expect(screen.getAllByTestId('pet-hover-shortcut')).toHaveLength(2)
    expect(screen.getByRole('button', { name: '藏' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '表' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '赐' })).not.toBeInTheDocument()
  })

  it('accepts a lower mutation id from a new settings-window session', async () => {
    let emitPreferencePatch: Parameters<NonNullable<Window['bilimiDesktop']['onAssistantPreferencePatchChanged']>>[0] | undefined
    installDesktopApi({
      loadPreferences: vi.fn().mockResolvedValue(createPreferences({ petHoverShortcuts: ['like'] })),
      onAssistantPreferencePatchChanged: vi.fn((callback) => {
        emitPreferencePatch = callback
        return () => {}
      })
    })

    render(<PalaceMaidPetApp />)
    fireEvent.pointerEnter(screen.getByRole('button', { name: '打开 bilimi，小咪在这里' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '赏' })).toBeInTheDocument())

    act(() => {
      emitPreferencePatch?.({ petHoverShortcuts: ['favorite', 'comment'] }, { originId: 'settings_session_old', mutationId: 8 })
      emitPreferencePatch?.({ petHoverShortcuts: ['coin'] }, { originId: 'settings_session_new', mutationId: 1 })
    })

    expect(screen.getAllByTestId('pet-hover-shortcut')).toHaveLength(1)
    expect(screen.getByRole('button', { name: '赐' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '藏' })).not.toBeInTheDocument()
  })

  it.each([1, 2, 3, 4])('exposes a centered fan layout for %i shortcuts', async (count) => {
    installDesktopApi({
      loadPreferences: vi.fn().mockResolvedValue(
        createPreferences({
          petHoverShortcuts: ['like', 'favorite', 'coin', 'comment'].slice(0, count) as AssistantPreferences['petHoverShortcuts']
        })
      )
    })

    render(<PalaceMaidPetApp />)
    fireEvent.pointerEnter(screen.getByRole('button', { name: '打开 bilimi，小咪在这里' }))

    const shortcuts = await screen.findByRole('group', { name: '小咪悬浮快捷按钮', hidden: true })
    await waitFor(() => expect(screen.getAllByTestId('pet-hover-shortcut')).toHaveLength(count))
    expect(shortcuts).toHaveAttribute('data-layout', 'fan')
    expect(shortcuts).toHaveAttribute('data-count', String(count))
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

    const pet = screen.getByRole('button', { name: '打开 bilimi，小咪在这里' })
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

    const pet = screen.getByRole('button', { name: '打开 bilimi，小咪在这里' })
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

  it('restores click-through when opening Bilimi makes the pet window lose focus', () => {
    const api = installDesktopApi({
      setFloatingSealMouseTransparent: vi.fn()
    })

    render(<PalaceMaidPetApp />)

    const pet = screen.getByRole('button', { name: '打开 bilimi，小咪在这里' })
    fireEvent.pointerEnter(pet)
    expect(api.setFloatingSealMouseTransparent).toHaveBeenLastCalledWith(false)

    fireEvent.click(pet)
    fireEvent(window, new Event('blur'))

    expect(api.setFloatingSealMouseTransparent).toHaveBeenLastCalledWith(true)
  })

  it('keeps the native pet host geometry stable while the pet chat opens and closes', async () => {
    const api = installDesktopApi()
    const setFloatingSealHostExpanded = vi.fn()
    Object.assign(api, { setFloatingSealHostExpanded })

    const { container } = render(<PalaceMaidPetApp />)
    const shell = container.querySelector('.palace-maid-pet-shell') as HTMLElement

    expect(shell.style.getPropertyValue('--floating-pet-host-height')).toBe('')

    fireEvent.click(await screen.findByRole('button', { name: '打开小咪对话' }))
    expect(shell.style.getPropertyValue('--floating-pet-host-height')).toBe('')

    fireEvent(window, new Event('blur'))
    expect(shell.style.getPropertyValue('--floating-pet-host-height')).toBe('')
    expect(setFloatingSealHostExpanded).not.toHaveBeenCalled()
  })

  it('reports native hit-test regions so a transparent pet window can recover before pointerenter', async () => {
    vi.useFakeTimers()
    const updateFloatingSealInteractiveRegions = vi.fn()
    installDesktopApi({ updateFloatingSealInteractiveRegions })
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const x = this.classList.contains('palace-maid-pet__hover-shortcut') ? 160 : 24
      return {
        x,
        y: 36,
        width: 96,
        height: 112,
        top: 36,
        right: x + 96,
        bottom: 148,
        left: x,
        toJSON: () => ({})
      }
    })

    render(<PalaceMaidPetApp />)

    expect(updateFloatingSealInteractiveRegions).toHaveBeenCalledWith(
      expect.arrayContaining([
        { x: 24, y: 36, width: 96, height: 112 },
        { x: 160, y: 36, width: 96, height: 112 }
      ])
    )

    const lateShortcut = document.createElement('button')
    lateShortcut.className = 'palace-maid-pet__hover-shortcut'
    document.querySelector('.palace-maid-pet-shell')?.append(lateShortcut)
    rect.mockImplementation(function (this: HTMLElement) {
      const x = this === lateShortcut ? 240 : 24
      return {
        x,
        y: 36,
        width: 96,
        height: 112,
        top: 36,
        right: x + 96,
        bottom: 148,
        left: x,
        toJSON: () => ({})
      }
    })
    await act(async () => {
      await Promise.resolve()
      vi.advanceTimersByTime(20)
    })
    expect(updateFloatingSealInteractiveRegions).toHaveBeenLastCalledWith(
      expect.arrayContaining([{ x: 240, y: 36, width: 96, height: 112 }])
    )
    rect.mockRestore()
  })

  it('ignores repeated pointer-down events on a resize step until the click commits one resize', () => {
    const api = installDesktopApi()

    render(<PalaceMaidPetApp />)

    const pet = screen.getByRole('button', { name: '打开 bilimi，小咪在这里' })
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
