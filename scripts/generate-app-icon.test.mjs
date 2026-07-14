import { describe, expect, it } from 'vitest'
import {
  APP_BUILD_ICON_ICO,
  APP_BUILD_ICON_PNG,
  APP_ICON_ICO_SIZES,
  APP_ICON_RESIZE_MODE,
  APP_ICON_SUBJECT_SCALE,
  APP_ICON_SOURCE
} from './generate-app-icon.mjs'

describe('app icon generation inputs', () => {
  it('uses the complete waving porcelain maid artwork as the app icon source', () => {
    expect(APP_ICON_SOURCE).toMatch(/electron[\\/]assets[\\/]bilimi-icon-approved\.png$/)
  })

  it('resizes the approved final composition without cropping it again', () => {
    expect(APP_ICON_RESIZE_MODE).toBe('approved-artwork-direct')
  })

  it('does not apply a second destructive scale after composing the icon', () => {
    expect(APP_ICON_SUBJECT_SCALE).toBe(1)
  })

  it('generates matching Electron and packaged build icons', () => {
    expect(APP_BUILD_ICON_PNG).toMatch(/build[\\/]icon\.png$/)
    expect(APP_BUILD_ICON_ICO).toMatch(/build[\\/]icon\.ico$/)
  })

  it('keeps a complete Windows icon size ladder for exe and taskbar rendering', () => {
    expect(APP_ICON_ICO_SIZES).toEqual([16, 24, 32, 48, 64, 128, 256])
  })
})
