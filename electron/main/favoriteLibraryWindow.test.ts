import { describe, expect, it, vi } from 'vitest'
import { FavoriteLibraryWindowController } from './favoriteLibraryWindow'
import { installFavoriteLibraryNavigationGuard } from './favoriteLibraryWindow'
import { installFavoriteLibraryNavigationGuardAfterInitialLoad } from './favoriteLibraryWindow'

function createWindow() {
  return {
    destroyed: false,
    focusCount: 0,
    showCount: 0,
    visible: true,
    focus() { this.focusCount++ },
    isDestroyed() { return this.destroyed },
    isVisible() { return this.visible },
    show() { this.showCount++; this.visible = true }
  }
}

describe('FavoriteLibraryWindowController', () => {
  it('reuses and focuses one library window without creating a second renderer', () => {
    const first = createWindow()
    let created = 0
    const controller = new FavoriteLibraryWindowController(() => {
      created++
      return first
    })

    expect(controller.open()).toBe(first)
    first.visible = false
    expect(controller.open()).toBe(first)

    expect(created).toBe(1)
    expect(first.showCount).toBe(1)
    expect(first.focusCount).toBe(1)
  })

  it('releases only the closed current library window', () => {
    const first = createWindow()
    const other = createWindow()
    const controller = new FavoriteLibraryWindowController(() => first)
    controller.open()

    controller.clearIfCurrent(other)
    expect(controller.getWindow()).toBe(first)
    controller.clearIfCurrent(first)
    expect(controller.getWindow()).toBeNull()
  })

  it('blocks top-level navigation and popup creation from the trusted library renderer', () => {
    let navigationListener: ((event: { preventDefault: () => void }) => void) | undefined
    const webContents = {
      on: (_event: 'will-navigate', listener: (event: { preventDefault: () => void }) => void) => { navigationListener = listener },
      setWindowOpenHandler: (_handler: () => { action: 'deny' }) => undefined
    }
    const preventDefault = vi.fn()

    installFavoriteLibraryNavigationGuard(webContents)
    navigationListener?.({ preventDefault })

    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it('waits for the initial renderer load before blocking later navigation', () => {
    let initialLoadListener: (() => void) | undefined
    let navigationListener: ((event: { preventDefault: () => void }) => void) | undefined
    const webContents = {
      once: (_event: 'did-finish-load', listener: () => void) => { initialLoadListener = listener },
      on: (_event: 'will-navigate', listener: (event: { preventDefault: () => void }) => void) => { navigationListener = listener },
      setWindowOpenHandler: vi.fn()
    }

    installFavoriteLibraryNavigationGuardAfterInitialLoad(webContents)
    expect(navigationListener).toBeUndefined()

    initialLoadListener?.()
    const preventDefault = vi.fn()
    navigationListener?.({ preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
  })
})
