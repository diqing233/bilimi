import { describe, expect, it, vi } from 'vitest'
import { restoreMainWindowDefaultLayoutSize } from './mainWindowLayout'

describe('restoreMainWindowDefaultLayoutSize', () => {
  it('restores the window to the adaptive default size for the current work area', () => {
    const target = {
      center: vi.fn(),
      isMaximized: vi.fn(() => true),
      setMinimumSize: vi.fn(),
      setSize: vi.fn(),
      unmaximize: vi.fn()
    }

    const sizing = restoreMainWindowDefaultLayoutSize(target, {
      width: 1280,
      height: 720
    })

    expect(sizing).toMatchObject({
      width: 1177,
      height: 662,
      minWidth: 1080,
      minHeight: 660
    })
    expect(target.unmaximize).toHaveBeenCalledOnce()
    expect(target.setMinimumSize).toHaveBeenCalledWith(1080, 660)
    expect(target.setSize).toHaveBeenCalledWith(1177, 662)
    expect(target.center).toHaveBeenCalledOnce()
  })
})
