import { describe, expect, it } from 'vitest'
import {
  APP_ICON_CROP,
  APP_ICON_ICO_SIZES,
  APP_ICON_SOURCE
} from './generate-app-icon.mjs'

describe('app icon generation inputs', () => {
  it('uses the porcelain maid screenshot as the app icon source', () => {
    expect(APP_ICON_SOURCE).toMatch(/electron[\\/]assets[\\/]bilimi-icon-source\.png$/)
  })

  it('crops a square avatar from the upper portrait area', () => {
    expect(APP_ICON_CROP.width).toBe(APP_ICON_CROP.height)
    expect(APP_ICON_CROP).toMatchObject({
      left: 31,
      top: 62,
      width: 536,
      height: 536
    })
  })

  it('keeps a complete Windows icon size ladder for exe and taskbar rendering', () => {
    expect(APP_ICON_ICO_SIZES).toEqual([16, 24, 32, 48, 64, 128, 256])
  })
})
