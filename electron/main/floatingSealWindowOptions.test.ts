import { describe, expect, it } from 'vitest'
import { createFloatingSealWindowOptions } from './floatingSealWindowOptions'

describe('createFloatingSealWindowOptions', () => {
  it('creates a transparent frameless seal window without project chrome', () => {
    const options = createFloatingSealWindowOptions(
      { x: 120, y: 240, width: 92, height: 92 },
      'C:/bilimi/out/preload/index.mjs'
    )

    expect(options).toMatchObject({
      x: 120,
      y: 240,
      width: 92,
      height: 92,
      minWidth: 92,
      maxWidth: 92,
      minHeight: 92,
      maxHeight: 92,
      title: '',
      frame: false,
      show: false,
      paintWhenInitiallyHidden: false,
      transparent: true,
      thickFrame: false,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      autoHideMenuBar: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      webPreferences: {
        preload: 'C:/bilimi/out/preload/index.mjs',
        contextIsolation: true,
        sandbox: false
      }
    })
    expect(options).not.toHaveProperty('titleBarStyle')
    expect(options).not.toHaveProperty('titleBarOverlay')
  })
})
