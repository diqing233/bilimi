import { describe, expect, it } from 'vitest'
import { createMainWindowOptions, getMainWindowIconPath } from './mainWindowOptions'

describe('createMainWindowOptions', () => {
  it('creates a wide project browser window with native window controls', () => {
    const options = createMainWindowOptions('C:/bilimi/out/preload/index.mjs')

    expect(options).toMatchObject({
      width: 1600,
      height: 960,
      minWidth: 1280,
      minHeight: 820,
      backgroundColor: '#1f140f',
      title: 'bilimi',
      show: true,
      frame: true,
      autoHideMenuBar: true,
      skipTaskbar: false
    })
    expect(String(options.icon)).toMatch(
      /electron[\\/]assets[\\/]bilimi-avatar\.png$|build[\\/]icon\.ico$/
    )
  })

  it('caps the initial size for a high-scale 2K logical work area', () => {
    const options = createMainWindowOptions('C:/bilimi/out/preload/index.mjs', {
      width: 1280,
      height: 720
    })

    expect(options).toMatchObject({
      width: 1177,
      height: 662,
      minWidth: 1080,
      minHeight: 660
    })
  })

  it('keeps minimum dimensions inside very small logical work areas', () => {
    const options = createMainWindowOptions('C:/bilimi/out/preload/index.mjs', {
      width: 1024,
      height: 640
    })

    expect(options).toMatchObject({
      width: 960,
      height: 600,
      minWidth: 960,
      minHeight: 600
    })
  })

  it('relaxes the absolute minimum inside extreme logical work areas', () => {
    const options = createMainWindowOptions('C:/bilimi/out/preload/index.mjs', {
      width: 900,
      height: 560
    })

    expect(options).toMatchObject({
      width: 828,
      height: 515,
      minWidth: 828,
      minHeight: 515
    })
  })

  it('leaves enough initial browser width beside the embedded assistant sidebar', () => {
    const options = createMainWindowOptions('C:/bilimi/out/preload/index.mjs')
    const embeddedSidebarWidth = 430

    expect(Number(options.width) - embeddedSidebarWidth).toBeGreaterThanOrEqual(1160)
  })

  it('uses the packaged 小咪 avatar ico as the Windows taskbar and task manager icon', () => {
    const iconPath = getMainWindowIconPath('win32')

    expect(iconPath).toMatch(/build[\\/]icon\.ico$/)
  })

  it('uses the generated square avatar on non-Windows platforms', () => {
    const iconPath = getMainWindowIconPath('linux')

    expect(iconPath).toMatch(/electron[\\/]assets[\\/]bilimi-avatar\.png$/)
  })
})
