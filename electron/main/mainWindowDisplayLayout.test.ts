import { describe, expect, it, vi } from 'vitest'
import {
  applyMainWindowDisplayLayout,
  installMainWindowDisplayLayout
} from './mainWindowDisplayLayout'

function createWindow(bounds = { x: 1500, y: 700, width: 1500, height: 900 }) {
  return {
    getBounds: vi.fn(() => bounds),
    isDestroyed: vi.fn(() => false),
    isMaximized: vi.fn(() => false),
    on: vi.fn(),
    off: vi.fn(),
    setBounds: vi.fn(),
    setMinimumSize: vi.fn()
  }
}

describe('applyMainWindowDisplayLayout', () => {
  it('updates minimum dimensions and clamps the window inside a smaller display', () => {
    const target = createWindow()

    applyMainWindowDisplayLayout(target, {
      id: 2,
      workArea: { x: 0, y: 0, width: 1280, height: 720 },
      workAreaSize: { width: 1280, height: 720 }
    })

    expect(target.setMinimumSize).toHaveBeenCalledWith(1080, 660)
    expect(target.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 1280, height: 720 })
  })

  it('updates minimum dimensions without enlarging a valid window on a roomy display', () => {
    const target = createWindow({ x: 200, y: 100, width: 1400, height: 850 })

    applyMainWindowDisplayLayout(target, {
      id: 1,
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      workAreaSize: { width: 1920, height: 1040 }
    })

    expect(target.setMinimumSize).toHaveBeenCalledWith(1280, 820)
    expect(target.setBounds).not.toHaveBeenCalled()
  })

  it('does not force bounds while the window is maximized', () => {
    const target = createWindow()
    target.isMaximized.mockReturnValue(true)

    applyMainWindowDisplayLayout(target, {
      id: 2,
      workArea: { x: 0, y: 0, width: 1280, height: 720 },
      workAreaSize: { width: 1280, height: 720 }
    })

    expect(target.setMinimumSize).toHaveBeenCalledWith(1080, 660)
    expect(target.setBounds).not.toHaveBeenCalled()
  })
})

describe('installMainWindowDisplayLayout', () => {
  it('does not reapply layout for repeated moves on the same display', () => {
    const target = createWindow({ x: 100, y: 80, width: 1400, height: 850 })
    const display = {
      id: 1,
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      workAreaSize: { width: 1920, height: 1040 }
    }
    const windowListeners = new Map<string, () => void>()
    const screenListeners = new Map<string, () => void>()
    target.on.mockImplementation((event, listener) => {
      windowListeners.set(event, listener)
      return target
    })
    const screenTarget = {
      getDisplayMatching: vi.fn(() => display),
      on: vi.fn((event: string, listener: () => void) => {
        screenListeners.set(event, listener)
      }),
      off: vi.fn()
    }

    const dispose = installMainWindowDisplayLayout(target, screenTarget)
    windowListeners.get('move')?.()
    windowListeners.get('move')?.()

    expect(target.setMinimumSize).toHaveBeenCalledTimes(1)

    dispose()
    expect(target.off).toHaveBeenCalledWith('move', expect.any(Function))
    expect(screenTarget.off).toHaveBeenCalledWith('display-metrics-changed', expect.any(Function))
  })
})
