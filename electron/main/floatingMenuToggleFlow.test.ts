import { describe, expect, it, vi } from 'vitest'
import { toggleFloatingAssistantFromSeal, toggleFloatingMenuFromSeal } from './floatingMenuToggleFlow'

function createWindowState({
  destroyed = false,
  minimized = false,
  visible = true
}: {
  destroyed?: boolean
  minimized?: boolean
  visible?: boolean
} = {}) {
  return {
    focus: vi.fn(),
    isDestroyed: vi.fn(() => destroyed),
    isMinimized: vi.fn(() => minimized),
    isVisible: vi.fn(() => visible),
    restore: vi.fn(),
    show: vi.fn()
  }
}

describe('toggleFloatingMenuFromSeal', () => {
  it('creates and opens the project window before toggling the floating menu when no project is open', () => {
    const createdWindow = createWindowState({ visible: false })
    const createMainWindow = vi.fn(() => createdWindow)
    const toggleFloatingMenu = vi.fn()

    const nextWindow = toggleFloatingMenuFromSeal({
      createMainWindow,
      mainWindow: null,
      toggleFloatingMenu
    })

    expect(nextWindow).toBe(createdWindow)
    expect(createMainWindow).toHaveBeenCalledOnce()
    expect(createdWindow.restore).not.toHaveBeenCalled()
    expect(createdWindow.show).toHaveBeenCalledOnce()
    expect(createdWindow.focus).toHaveBeenCalledOnce()
    expect(toggleFloatingMenu).toHaveBeenCalledOnce()
  })

  it('restores and opens the existing project window before toggling the floating menu', () => {
    const existingWindow = createWindowState({ minimized: true, visible: false })
    const createMainWindow = vi.fn()
    const toggleFloatingMenu = vi.fn()

    const nextWindow = toggleFloatingMenuFromSeal({
      createMainWindow,
      mainWindow: existingWindow,
      toggleFloatingMenu
    })

    expect(nextWindow).toBe(existingWindow)
    expect(createMainWindow).not.toHaveBeenCalled()
    expect(existingWindow.restore).toHaveBeenCalledOnce()
    expect(existingWindow.show).toHaveBeenCalledOnce()
    expect(existingWindow.focus).toHaveBeenCalledOnce()
    expect(toggleFloatingMenu).toHaveBeenCalledOnce()
  })
})

describe('toggleFloatingAssistantFromSeal', () => {
  it('creates and opens the project window before toggling the floating assistant when no project is open', () => {
    const createdWindow = createWindowState({ visible: false })
    const createMainWindow = vi.fn(() => createdWindow)
    const toggleFloatingAssistant = vi.fn()

    const nextWindow = toggleFloatingAssistantFromSeal({
      createMainWindow,
      mainWindow: null,
      toggleFloatingAssistant
    })

    expect(nextWindow).toBe(createdWindow)
    expect(createMainWindow).toHaveBeenCalledOnce()
    expect(createdWindow.restore).not.toHaveBeenCalled()
    expect(createdWindow.show).toHaveBeenCalledOnce()
    expect(createdWindow.focus).toHaveBeenCalledOnce()
    expect(toggleFloatingAssistant).toHaveBeenCalledOnce()
  })

  it('restores and opens the existing project window before toggling the floating assistant', () => {
    const existingWindow = createWindowState({ minimized: true, visible: false })
    const createMainWindow = vi.fn()
    const toggleFloatingAssistant = vi.fn()

    const nextWindow = toggleFloatingAssistantFromSeal({
      createMainWindow,
      mainWindow: existingWindow,
      toggleFloatingAssistant
    })

    expect(nextWindow).toBe(existingWindow)
    expect(createMainWindow).not.toHaveBeenCalled()
    expect(existingWindow.restore).toHaveBeenCalledOnce()
    expect(existingWindow.show).toHaveBeenCalledOnce()
    expect(existingWindow.focus).toHaveBeenCalledOnce()
    expect(toggleFloatingAssistant).toHaveBeenCalledOnce()
  })
})
