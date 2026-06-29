import { describe, expect, it, vi } from 'vitest'
import {
  configureFloatingAssistantWindow,
  createFloatingAssistantWindowOptions
} from './floatingAssistantWindowOptions'

function createAssistantWindow() {
  return {
    on: vi.fn(),
    removeMenu: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn(),
    show: vi.fn(),
    webContents: {
      once: vi.fn()
    }
  }
}

describe('createFloatingAssistantWindowOptions', () => {
  it('creates a transparent assistant window without native Windows frame artifacts', () => {
    const options = createFloatingAssistantWindowOptions({
      bounds: { x: 320, y: 120, width: 460, height: 680 },
      preload: 'C:/bilimi/out/preload/index.mjs'
    })

    expect(options).toMatchObject({
      x: 320,
      y: 120,
      width: 460,
      height: 680,
      title: '',
      frame: false,
      show: false,
      paintWhenInitiallyHidden: false,
      transparent: true,
      titleBarStyle: 'hidden',
      titleBarOverlay: false,
      thickFrame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      autoHideMenuBar: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      roundedCorners: false,
      webPreferences: {
        preload: 'C:/bilimi/out/preload/index.mjs',
        contextIsolation: true,
        sandbox: false,
        backgroundThrottling: false
      }
    })
  })

  it('shows the hidden assistant window after the renderer has loaded', () => {
    const assistant = createAssistantWindow()
    const onClosed = vi.fn()

    configureFloatingAssistantWindow(assistant, onClosed)

    expect(assistant.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating')
    expect(assistant.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
      visibleOnFullScreen: true
    })
    expect(assistant.removeMenu).toHaveBeenCalledOnce()
    expect(assistant.on).toHaveBeenCalledWith('closed', onClosed)
    expect(assistant.webContents.once).toHaveBeenCalledWith('did-finish-load', expect.any(Function))

    const loadHandler = assistant.webContents.once.mock.calls.find(
      ([eventName]) => eventName === 'did-finish-load'
    )?.[1]
    loadHandler?.()

    expect(assistant.show).toHaveBeenCalledOnce()
  })
})
