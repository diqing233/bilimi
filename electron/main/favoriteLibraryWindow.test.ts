import { describe, expect, it, vi } from 'vitest'
import {
  FavoriteLibraryWindowController,
  FavoriteLibrarySideBySideLayout,
  createFavoriteLibraryWindowOptions,
  installFavoriteLibraryNavigationGuard
} from './favoriteLibraryWindow'

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
  it('creates a left-docked menu-free library work window', () => {
    expect(createFavoriteLibraryWindowOptions({ x: 0, y: 40, width: 1920, height: 1040 }, 'preload.js')).toMatchObject({
      x: 0,
      y: 40,
      width: 760,
      height: 1040,
      minWidth: 620,
      minHeight: 560,
      title: '收藏库',
      autoHideMenuBar: true,
      webPreferences: { preload: 'preload.js', contextIsolation: true, sandbox: false, webviewTag: false }
    })
  })

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

})

describe('FavoriteLibrarySideBySideLayout', () => {
  it('reserves the left library width and restores the main window after closing', () => {
    const setBounds = vi.fn()
    const main = { getBounds: () => ({ x: 0, y: 40, width: 1920, height: 1040 }), setBounds, isDestroyed: () => false }
    const layout = new FavoriteLibrarySideBySideLayout()

    layout.open(main, { getBounds: () => ({ x: 0, y: 40, width: 760, height: 1040 }) })
    layout.close(main)

    expect(setBounds).toHaveBeenNthCalledWith(1, { x: 760, y: 40, width: 1160, height: 1040 })
    expect(setBounds).toHaveBeenNthCalledWith(2, { x: 0, y: 40, width: 1920, height: 1040 })
  })
})
