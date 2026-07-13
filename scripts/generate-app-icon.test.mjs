import { describe, expect, it } from 'vitest'
import {
  APP_BUILD_ICON_ICO,
  APP_BUILD_ICON_PNG,
  APP_ICON_ICO_SIZES,
  APP_ICON_RESIZE_MODE,
  APP_ICON_SOURCE
} from './generate-app-icon.mjs'

describe('app icon generation inputs', () => {
  it('uses the porcelain maid screenshot as the app icon source', () => {
    expect(APP_ICON_SOURCE).toMatch(/electron[\\/]assets[\\/]bilimi-icon-source\.png$/)
  })

  it('fits the complete square mascot artwork without a fixed pixel crop', () => {
    expect(APP_ICON_RESIZE_MODE).toBe('contain-square')
  })

  it('generates matching Electron and packaged build icons', () => {
    expect(APP_BUILD_ICON_PNG).toMatch(/build[\\/]icon\.png$/)
    expect(APP_BUILD_ICON_ICO).toMatch(/build[\\/]icon\.ico$/)
  })

  it('keeps a complete Windows icon size ladder for exe and taskbar rendering', () => {
    expect(APP_ICON_ICO_SIZES).toEqual([16, 24, 32, 48, 64, 128, 256])
  })
})
