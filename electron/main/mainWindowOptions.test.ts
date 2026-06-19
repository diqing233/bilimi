import { describe, expect, it } from 'vitest'
import { createMainWindowOptions } from './mainWindowOptions'

describe('createMainWindowOptions', () => {
  it('creates a wide project browser window with native window controls', () => {
    const options = createMainWindowOptions('C:/bilimi/out/preload/index.mjs')

    expect(options).toMatchObject({
      width: 1800,
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
    expect(String(options.icon)).toMatch(
      /src[\\/]renderer[\\/]src[\\/]assets[\\/]pet[\\/]blue-white-maid[\\/]character[\\/]big-head[\\/]idle\.png$/
    )
  })

  it('leaves enough initial browser width beside the embedded assistant sidebar', () => {
    const options = createMainWindowOptions('C:/bilimi/out/preload/index.mjs')
    const embeddedSidebarWidth = 430

    expect(Number(options.width) - embeddedSidebarWidth).toBeGreaterThanOrEqual(1360)
  })
})
