import { describe, expect, it, vi } from 'vitest'
import { restoreMainWindowFromPet } from './mainWindowRestore'

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

describe('restoreMainWindowFromPet', () => {
  it('creates and focuses the main window when none exists', () => {
    const createdWindow = createWindowState({ visible: false })
    const createMainWindow = vi.fn(() => createdWindow)

    const nextWindow = restoreMainWindowFromPet({
      createMainWindow,
      mainWindow: null
    })

    expect(nextWindow).toBe(createdWindow)
    expect(createMainWindow).toHaveBeenCalledOnce()
    expect(createdWindow.show).toHaveBeenCalledOnce()
    expect(createdWindow.focus).toHaveBeenCalledOnce()
  })

  it('restores, shows, and focuses an existing minimized window', () => {
    const existingWindow = createWindowState({ minimized: true, visible: false })
    const createMainWindow = vi.fn()

    const nextWindow = restoreMainWindowFromPet({
      createMainWindow,
      mainWindow: existingWindow
    })

    expect(nextWindow).toBe(existingWindow)
    expect(createMainWindow).not.toHaveBeenCalled()
    expect(existingWindow.restore).toHaveBeenCalledOnce()
    expect(existingWindow.show).toHaveBeenCalledOnce()
    expect(existingWindow.focus).toHaveBeenCalledOnce()
  })
})
