import { describe, expect, it, vi } from 'vitest'
import {
  MAIN_WINDOW_CLOSE_FAREWELL_DELAY_MS,
  installMainWindowControlReactions
} from './mainWindowControlReactions'
import type { AssistantPetHint } from '../../src/renderer/src/features/assistant/petState'

type WindowEventName = 'minimize' | 'restore' | 'maximize' | 'unmaximize' | 'close'

function createTestWindow() {
  const handlers = new Map<WindowEventName, Array<(...args: unknown[]) => void>>()

  return {
    close: vi.fn(),
    hide: vi.fn(),
    emit(eventName: WindowEventName, ...args: unknown[]) {
      for (const handler of handlers.get(eventName) ?? []) {
        handler(...args)
      }
    },
    on: vi.fn((eventName: WindowEventName, handler: (...args: unknown[]) => void) => {
      handlers.set(eventName, [...(handlers.get(eventName) ?? []), handler])
    })
  }
}

describe('installMainWindowControlReactions', () => {
  it('lets XiaoMi say goodbye when the native minimize button is used', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    const window = createTestWindow()
    const sendPetHint = vi.fn()

    try {
      installMainWindowControlReactions({
        closeAssistantPet: vi.fn(),
        getPreferences: () =>
          ({
            closeBehavior: 'exit-launcher',
            confirmBeforeExit: false
          }) as never,
        minimizeToTray: vi.fn(),
        prepareToExitLauncher: vi.fn(),
        savePreferencePatch: vi.fn(),
        sendPetHint,
        showCloseConfirmation: vi.fn(),
        window
      })

      window.emit('minimize')

      expect(sendPetHint).toHaveBeenCalledWith({
        tone: 'sleepy',
        message: '那小咪先收起来啦，等你回来。'
      })
    } finally {
      random.mockRestore()
    }
  })

  it('welcomes the owner back when the taskbar restores a minimized window', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    const window = createTestWindow()
    const sendPetHint = vi.fn()

    try {
      installMainWindowControlReactions({
        closeAssistantPet: vi.fn(),
        getPreferences: () =>
          ({
            closeBehavior: 'exit-launcher',
            confirmBeforeExit: false
          }) as never,
        minimizeToTray: vi.fn(),
        prepareToExitLauncher: vi.fn(),
        savePreferencePatch: vi.fn(),
        sendPetHint,
        showCloseConfirmation: vi.fn(),
        window
      })

      window.emit('restore')

      expect(sendPetHint).toHaveBeenCalledWith({
        tone: 'shy',
        message: '欢迎回来，主人。小咪一直在等你。'
      })
    } finally {
      random.mockRestore()
    }
  })

  it('reacts when the native maximize button expands and restores the window', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    const window = createTestWindow()
    const sendPetHint = vi.fn()

    try {
      installMainWindowControlReactions({
        closeAssistantPet: vi.fn(),
        getPreferences: () =>
          ({
            closeBehavior: 'exit-launcher',
            confirmBeforeExit: false
          }) as never,
        minimizeToTray: vi.fn(),
        prepareToExitLauncher: vi.fn(),
        savePreferencePatch: vi.fn(),
        sendPetHint,
        showCloseConfirmation: vi.fn(),
        window
      })

      window.emit('maximize')
      window.emit('unmaximize')

      expect(sendPetHint).toHaveBeenNthCalledWith(1, {
        tone: 'surprised',
        message: '哇，屏幕变大了，小咪也看清楚啦。'
      })
      expect(sendPetHint).toHaveBeenNthCalledWith(2, {
        tone: 'shy',
        message: '窗口收回来啦，这样贴近主人刚刚好。'
      })
    } finally {
      random.mockRestore()
    }
  })

  it('lets the app close immediately while XiaoMi closes herself after farewell', () => {
    vi.useFakeTimers()
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    const window = createTestWindow()
    const closeAssistantPet = vi.fn()
    const sendPetHint = vi.fn<(hint: AssistantPetHint) => void>()
    const closeEvent = { preventDefault: vi.fn() }

    try {
      installMainWindowControlReactions({
        closeAssistantPet,
        getPreferences: () =>
          ({
            closeBehavior: 'exit-launcher',
            confirmBeforeExit: false
          }) as never,
        minimizeToTray: vi.fn(),
        prepareToExitLauncher: vi.fn(),
        savePreferencePatch: vi.fn(),
        sendPetHint,
        showCloseConfirmation: vi.fn(),
        window
      })

      window.emit('close', closeEvent)

      expect(closeEvent.preventDefault).not.toHaveBeenCalled()
      expect(sendPetHint).toHaveBeenCalledWith({
        tone: 'sleepy',
        message: '那小咪先退场啦，主人下次见。'
      })
      expect(closeAssistantPet).not.toHaveBeenCalled()
      expect(window.close).not.toHaveBeenCalled()

      vi.advanceTimersByTime(MAIN_WINDOW_CLOSE_FAREWELL_DELAY_MS)

      expect(closeAssistantPet).toHaveBeenCalledOnce()
      expect(window.close).not.toHaveBeenCalled()
    } finally {
      random.mockRestore()
      vi.useRealTimers()
    }
  })

  it('prevents the native close and hides the project window when tray minimization is configured', () => {
    const window = createTestWindow()
    const minimizeToTray = vi.fn()
    const closeEvent = { preventDefault: vi.fn() }

    installMainWindowControlReactions({
      closeAssistantPet: vi.fn(),
      getPreferences: () =>
        ({
          closeBehavior: 'minimize-to-tray',
          confirmBeforeExit: true
        }) as never,
      minimizeToTray,
      prepareToExitLauncher: vi.fn(),
      savePreferencePatch: vi.fn(),
      sendPetHint: vi.fn(),
      showCloseConfirmation: vi.fn(),
      window
    })

    window.emit('close', closeEvent)

    expect(closeEvent.preventDefault).toHaveBeenCalledOnce()
    expect(minimizeToTray).toHaveBeenCalledOnce()
  })

  it('confirms exit and remembers direct exit only after the owner confirms that action', async () => {
    vi.useFakeTimers()
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    const window = createTestWindow()
    const closeAssistantPet = vi.fn()
    const sendPetHint = vi.fn<(hint: AssistantPetHint) => void>()
    const savePreferencePatch = vi.fn()
    const closeEvent = { preventDefault: vi.fn() }

    try {
      installMainWindowControlReactions({
        closeAssistantPet,
        getPreferences: () =>
          ({
            closeBehavior: 'exit-launcher',
            confirmBeforeExit: true
          }) as never,
        minimizeToTray: vi.fn(),
        prepareToExitLauncher: vi.fn(),
        savePreferencePatch,
        sendPetHint,
        showCloseConfirmation: () => ({ response: 1, checkboxChecked: true }),
        window
      })

      window.emit('close', closeEvent)
      await Promise.resolve()

      expect(closeEvent.preventDefault).toHaveBeenCalledOnce()
      expect(savePreferencePatch).toHaveBeenCalledWith({
        closeBehavior: 'exit-launcher',
        confirmBeforeExit: false
      })
      expect(sendPetHint).toHaveBeenCalledWith({
        tone: 'sleepy',
        message: '那小咪先退场啦，主人下次见。'
      })
      expect(window.close).toHaveBeenCalledOnce()

      vi.advanceTimersByTime(MAIN_WINDOW_CLOSE_FAREWELL_DELAY_MS)

      expect(closeAssistantPet).toHaveBeenCalledOnce()
    } finally {
      random.mockRestore()
      vi.useRealTimers()
    }
  })
})
