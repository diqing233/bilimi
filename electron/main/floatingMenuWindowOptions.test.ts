import { describe, expect, it, vi } from 'vitest'
import { configureFloatingMenuWindow, createFloatingMenuWindowOptions } from './floatingMenuWindowOptions'

function createMenuWindow() {
  return {
    on: vi.fn(),
    removeMenu: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn()
  }
}

describe('floating menu window options', () => {
  it('sizes the transparent host to fit the full menu surface and shadow', () => {
    const options = createFloatingMenuWindowOptions({
      bounds: { x: 100, y: 200, width: 184, height: 248 },
      preload: 'C:/bilimi/out/preload/index.mjs'
    })

    expect(options).toMatchObject({
      x: 100,
      y: 200,
      width: 184,
      height: 248,
      transparent: true,
      frame: false,
      titleBarStyle: 'hidden',
      titleBarOverlay: false,
      thickFrame: false,
      roundedCorners: false,
      hasShadow: false,
      skipTaskbar: true
    })
  })

  it('does not collapse the menu when the floating window loses focus', () => {
    const menu = createMenuWindow()

    configureFloatingMenuWindow(menu, vi.fn())

    expect(menu.on).toHaveBeenCalledWith('closed', expect.any(Function))
    expect(menu.on).not.toHaveBeenCalledWith('blur', expect.any(Function))
  })
})
