import { describe, expect, it } from 'vitest'
import { createMainWindowOptions } from './mainWindowOptions'

describe('createMainWindowOptions', () => {
  it('creates a normal project browser window with native window controls', () => {
    const options = createMainWindowOptions('C:/bilimi/out/preload/index.mjs')

    expect(options).toMatchObject({
      width: 1440,
      height: 960,
      minWidth: 1280,
      minHeight: 820,
      backgroundColor: '#1f140f',
      title: 'Bilimi',
      show: true,
      frame: true,
      autoHideMenuBar: true,
      skipTaskbar: false
    })
  })
})
