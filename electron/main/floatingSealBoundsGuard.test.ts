import { describe, expect, it, vi } from 'vitest'
import {
  enforceFixedFloatingSealBounds,
  installFixedFloatingSealBoundsGuard
} from './floatingSealBoundsGuard'

describe('enforceFixedFloatingSealBounds', () => {
  it('locks an oversized pet window back to the fixed activity bounds', () => {
    const setBounds = vi.fn()
    const setMinimumSize = vi.fn()
    const setMaximumSize = vi.fn()

    enforceFixedFloatingSealBounds({
      getBounds: () => ({ x: 12, y: 28, width: 824, height: 1080 }),
      setBounds,
      setMinimumSize,
      setMaximumSize
    })

    expect(setMinimumSize).toHaveBeenCalledWith(356, 260)
    expect(setMaximumSize).toHaveBeenCalledWith(356, 260)
    expect(setBounds).toHaveBeenCalledWith({ x: 12, y: 28, width: 356, height: 260 })
  })

  it('does not churn bounds when the pet window is already fixed', () => {
    const setBounds = vi.fn()

    enforceFixedFloatingSealBounds({
      getBounds: () => ({ x: 12, y: 28, width: 356, height: 260 }),
      setBounds,
      setMinimumSize: vi.fn(),
      setMaximumSize: vi.fn()
    })

    expect(setBounds).not.toHaveBeenCalled()
  })

  it('re-locks the pet window when Electron emits a resize event', () => {
    let bounds = { x: 12, y: 28, width: 356, height: 260 }
    const listeners = new Map<string, () => void>()
    const setBounds = vi.fn((nextBounds) => {
      bounds = nextBounds
    })

    installFixedFloatingSealBoundsGuard({
      getBounds: () => bounds,
      setBounds,
      setMinimumSize: vi.fn(),
      setMaximumSize: vi.fn(),
      isDestroyed: () => false,
      on: (eventName, listener) => {
        listeners.set(eventName, listener)
      }
    })

    bounds = { x: 12, y: 28, width: 824, height: 1080 }
    listeners.get('resize')?.()

    expect(setBounds).toHaveBeenCalledWith({ x: 12, y: 28, width: 356, height: 260 })
  })

  it('does not recurse when correcting bounds emits another resize event', () => {
    let bounds = { x: 12, y: 28, width: 824, height: 1080 }
    const listeners = new Map<string, () => void>()
    const setBounds = vi.fn((nextBounds) => {
      bounds = nextBounds
      listeners.get('resize')?.()
    })

    installFixedFloatingSealBoundsGuard({
      getBounds: () => bounds,
      setBounds,
      setMinimumSize: vi.fn(),
      setMaximumSize: vi.fn(),
      isDestroyed: () => false,
      on: (eventName, listener) => {
        listeners.set(eventName, listener)
      }
    })

    expect(setBounds).toHaveBeenCalledTimes(1)
  })
})
