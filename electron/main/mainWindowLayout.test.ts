import { describe, expect, it, vi } from 'vitest'
import { restoreMainWindowDefaultLayoutSize } from './mainWindowLayout'

describe('restoreMainWindowDefaultLayoutSize', () => {
  it('restores a maximized window with one centered bounds update', () => {
    const target = {
      center: vi.fn(),
      getBounds: vi.fn(() => ({ x: 0, y: 0, width: 1280, height: 720 })),
      isMaximized: vi.fn(() => true),
      setBounds: vi.fn(),
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
    expect(target.setBounds).toHaveBeenCalledWith({ x: 52, y: 29, width: 1177, height: 662 })
    expect(target.setSize).not.toHaveBeenCalled()
    expect(target.center).not.toHaveBeenCalled()
  })

  it('does not resize or recenter a non-maximized window already at the target bounds', () => {
    const target = {
      center: vi.fn(),
      getBounds: vi.fn(() => ({ x: 52, y: 29, width: 1177, height: 662 })),
      isMaximized: vi.fn(() => false),
      setBounds: vi.fn(),
      setMinimumSize: vi.fn(),
      setSize: vi.fn(),
      unmaximize: vi.fn()
    }

    restoreMainWindowDefaultLayoutSize(target, { width: 1280, height: 720 })

    expect(target.setMinimumSize).toHaveBeenCalledWith(1080, 660)
    expect(target.setBounds).not.toHaveBeenCalled()
    expect(target.setSize).not.toHaveBeenCalled()
    expect(target.center).not.toHaveBeenCalled()
  })
})
