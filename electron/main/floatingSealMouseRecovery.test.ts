import { describe, expect, it, vi } from 'vitest'
import { createFloatingSealMouseRecoveryController } from './floatingSealMouseRecovery'

describe('createFloatingSealMouseRecoveryController', () => {
  it('restores native hit testing when the cursor enters a reported pet region', () => {
    let poll: (() => void) | undefined
    const window = {
      getBounds: () => ({ x: 100, y: 200, width: 320, height: 380 }),
      isDestroyed: () => false,
      setIgnoreMouseEvents: vi.fn()
    }
    const controller = createFloatingSealMouseRecoveryController({
      getCursorPoint: () => ({ x: 145, y: 265 }),
      schedulePoll: (callback) => {
        poll = callback
        return 1
      },
      cancelPoll: vi.fn(),
      window
    })

    controller.updateInteractiveRegions([{ x: 20, y: 30, width: 80, height: 90 }])
    controller.setTransparent(true)
    poll?.()

    expect(window.setIgnoreMouseEvents).toHaveBeenNthCalledWith(1, true, { forward: true })
    expect(window.setIgnoreMouseEvents).toHaveBeenNthCalledWith(2, false)
  })

  it('keeps transparent host pixels click-through while the cursor stays outside pet regions', () => {
    let poll: (() => void) | undefined
    const window = {
      getBounds: () => ({ x: 100, y: 200, width: 320, height: 380 }),
      isDestroyed: () => false,
      setIgnoreMouseEvents: vi.fn()
    }
    const controller = createFloatingSealMouseRecoveryController({
      getCursorPoint: () => ({ x: 390, y: 550 }),
      schedulePoll: (callback) => {
        poll = callback
        return 1
      },
      cancelPoll: vi.fn(),
      window
    })

    controller.updateInteractiveRegions([{ x: 20, y: 30, width: 80, height: 90 }])
    controller.setTransparent(true)
    poll?.()

    expect(window.setIgnoreMouseEvents).toHaveBeenCalledTimes(1)
    expect(window.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true })
  })

  it('stops native polling when the window becomes interactive or is disposed', () => {
    const cancelPoll = vi.fn()
    const window = {
      getBounds: () => ({ x: 0, y: 0, width: 320, height: 380 }),
      isDestroyed: () => false,
      setIgnoreMouseEvents: vi.fn()
    }
    const controller = createFloatingSealMouseRecoveryController({
      getCursorPoint: () => ({ x: 0, y: 0 }),
      schedulePoll: () => 9,
      cancelPoll,
      window
    })

    controller.setTransparent(true)
    controller.setTransparent(false)
    controller.setTransparent(true)
    controller.dispose()

    expect(cancelPoll).toHaveBeenNthCalledWith(1, 9)
    expect(cancelPoll).toHaveBeenNthCalledWith(2, 9)
  })

  it('pauses cursor polling while the pet window is hidden and resumes only when visible', () => {
    const schedulePoll = vi.fn(() => 5)
    const cancelPoll = vi.fn()
    const controller = createFloatingSealMouseRecoveryController({
      getCursorPoint: () => ({ x: 0, y: 0 }),
      schedulePoll,
      cancelPoll,
      window: {
        getBounds: () => ({ x: 0, y: 0, width: 320, height: 380 }),
        isDestroyed: () => false,
        setIgnoreMouseEvents: vi.fn()
      }
    })

    controller.setVisible(false)
    controller.setTransparent(true)
    expect(schedulePoll).not.toHaveBeenCalled()

    controller.setVisible(true)
    expect(schedulePoll).toHaveBeenCalledOnce()
    controller.setVisible(false)
    expect(cancelPoll).toHaveBeenCalledWith(5)
  })
})
