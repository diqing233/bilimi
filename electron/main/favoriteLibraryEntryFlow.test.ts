import { describe, expect, it, vi } from 'vitest'
import { handleFavoriteLibraryEntry, sendFavoriteLibraryCommandWhenReady } from './favoriteLibraryEntryFlow'

function windowState(id: number, loading = false) {
  let didFinishLoad: (() => void) | undefined
  return {
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    restore: vi.fn(),
    show: vi.fn(),
    webContents: {
      id,
      isLoadingMainFrame: vi.fn(() => loading),
      once: vi.fn((_event: 'did-finish-load', listener: () => void) => { didFinishLoad = listener }),
      send: vi.fn()
    },
    finishLoading: () => didFinishLoad?.()
  }
}

describe('favorite library entry flow', () => {
  it('toggles for the main renderer without restoring the window', () => {
    const mainWindow = windowState(10)
    const restoreMainWindow = vi.fn(() => mainWindow)

    handleFavoriteLibraryEntry({ senderId: 10, mainWindow, restoreMainWindow })

    expect(restoreMainWindow).not.toHaveBeenCalled()
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('favorite-library:drawer-command', 'toggle')
  })

  it('restores the main window and reveals the library for a floating renderer', () => {
    const mainWindow = windowState(10)
    const restoreMainWindow = vi.fn(() => mainWindow)

    handleFavoriteLibraryEntry({ senderId: 20, mainWindow, restoreMainWindow })

    expect(restoreMainWindow).toHaveBeenCalledOnce()
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('favorite-library:drawer-command', 'reveal')
  })

  it('waits for a newly created renderer before delivering the reveal command', () => {
    const mainWindow = windowState(10, true)

    sendFavoriteLibraryCommandWhenReady(mainWindow, 'reveal')

    expect(mainWindow.webContents.send).not.toHaveBeenCalled()
    mainWindow.finishLoading()
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('favorite-library:drawer-command', 'reveal')
  })
})
