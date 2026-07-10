import { describe, expect, it } from 'vitest'
import { isBrowserPermissionAllowed } from './browserSessionPolicy'

describe('browser session permission policy', () => {
  it('allows only minimal Bilibili playback and clipboard permissions', () => {
    expect(isBrowserPermissionAllowed('https://www.bilibili.com/video/BV1', 'fullscreen')).toBe(true)
    expect(isBrowserPermissionAllowed('https://space.bilibili.com/1', 'clipboard-sanitized-write')).toBe(true)
    expect(isBrowserPermissionAllowed('https://www.bilibili.com', 'media')).toBe(false)
    expect(isBrowserPermissionAllowed('https://www.bilibili.com', 'geolocation')).toBe(false)
    expect(isBrowserPermissionAllowed('https://evil.example', 'fullscreen')).toBe(false)
  })
})
