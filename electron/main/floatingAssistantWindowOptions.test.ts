import { describe, expect, it } from 'vitest'
import { createFloatingAssistantWindowOptions } from './floatingAssistantWindowOptions'

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
})
