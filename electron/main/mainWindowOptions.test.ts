import { describe, expect, it } from 'vitest'
import { createMainWindowOptions, getMainWindowIconPath } from './mainWindowOptions'

describe('createMainWindowOptions', () => {
  it('creates a wide project browser window with a custom titlebar overlay', () => {
    const options = createMainWindowOptions('C:/bilimi/out/preload/index.mjs')

    expect(options).toMatchObject({
      width: 1600,
      height: 960,
      minWidth: 1280,
      minHeight: 820,
      backgroundColor: '#1f140f',
      title: 'Bilimi',
      show: true,
      frame: true,
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#071a33',
        symbolColor: '#dceeff',
        height: 42
      },
      autoHideMenuBar: true,
      skipTaskbar: false
    })
    expect(String(options.icon)).toMatch(
      /src[\\/]renderer[\\/]src[\\/]assets[\\/]pet[\\/]blue-white-maid[\\/]character[\\/]big-head[\\/]idle\.png$|electron[\\/]assets[\\/]bilimi\.ico$/
    )
  })

  it('leaves enough initial browser width beside the embedded assistant sidebar', () => {
    const options = createMainWindowOptions('C:/bilimi/out/preload/index.mjs')
    const embeddedSidebarWidth = 430

    expect(Number(options.width) - embeddedSidebarWidth).toBeGreaterThanOrEqual(1160)
  })

  it('uses a Bilimi ico as the Windows taskbar and task manager icon', () => {
    const iconPath = getMainWindowIconPath('win32')

    expect(iconPath).toMatch(/electron[\\/]assets[\\/]bilimi\.ico$/)
  })
})
