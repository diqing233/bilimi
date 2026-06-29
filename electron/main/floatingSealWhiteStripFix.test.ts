import { describe, expect, it, vi } from 'vitest'
import {
  createNudgePositions,
  createRecompositeSteps,
  installFloatingWindowWhiteStripFix,
  installFloatingSealWhiteStripFix
} from './floatingSealWhiteStripFix'

type Listener = () => void

function createHarness(initialBounds = { x: 120, y: 240, width: 336, height: 380 }) {
  const listeners = new Map<string, Listener>()
  let scheduled: Array<{ id: number; cb: () => void; delayMs: number }> = []
  let nextTimerId = 1

  const target = {
    isDestroyed: vi.fn(() => false),
    getBounds: vi.fn(() => initialBounds),
    setPosition: vi.fn(),
    on: vi.fn((eventName: string, listener: Listener) => {
      listeners.set(eventName, listener)
    })
  }

  const schedule = vi.fn((cb: () => void, delayMs: number) => {
    const id = nextTimerId++
    scheduled.push({ id, cb, delayMs })
    return id
  })
  const cancel = vi.fn((timer: unknown) => {
    scheduled = scheduled.filter((scheduledTimer) => scheduledTimer.id !== timer)
  })

  function flushAll() {
    const ordered = [...scheduled].sort((a, b) => a.delayMs - b.delayMs)
    scheduled = []
    for (const timer of ordered) {
      timer.cb()
    }
  }

  const dispose = installFloatingSealWhiteStripFix(target, { schedule, cancel })

  return {
    target,
    listeners,
    schedule,
    cancel,
    get scheduled() {
      return scheduled
    },
    flushAll,
    dispose
  }
}

describe('createNudgePositions', () => {
  it('offsets the window position by one pixel and back to the original', () => {
    const positions = createNudgePositions({ x: 120, y: 240, width: 336, height: 380 })

    expect(positions.nudged).toEqual({ x: 121, y: 240 })
    expect(positions.restored).toEqual({ x: 120, y: 240 })
  })
})

describe('createRecompositeSteps', () => {
  it('emits a nudge-and-restore pair for each retry attempt', () => {
    const steps = createRecompositeSteps({
      attempts: 3,
      startDelayMs: 16,
      attemptGapMs: 80,
      holdMs: 16
    })

    expect(steps).toEqual([
      { delayMs: 16, offset: 1 },
      { delayMs: 32, offset: 0 },
      { delayMs: 96, offset: 1 },
      { delayMs: 112, offset: 0 },
      { delayMs: 176, offset: 1 },
      { delayMs: 192, offset: 0 }
    ])
    expect(steps[steps.length - 1].offset).toBe(0)
  })
})

describe('installFloatingSealWhiteStripFix', () => {
  it('nudges the window position and restores it, retrying a few times, on blur', () => {
    const harness = createHarness({ x: 120, y: 240, width: 336, height: 380 })

    harness.listeners.get('blur')?.()
    harness.flushAll()

    expect(harness.target.setPosition.mock.calls).toEqual([
      [121, 240],
      [120, 240],
      [121, 240],
      [120, 240],
      [121, 240],
      [120, 240]
    ])
  })

  it('does not move a destroyed window', () => {
    const harness = createHarness()
    harness.target.isDestroyed.mockReturnValue(true)

    harness.listeners.get('blur')?.()
    harness.flushAll()

    expect(harness.target.setPosition).not.toHaveBeenCalled()
  })

  it('cancels pending nudges and settles back to the original position on focus', () => {
    const harness = createHarness({ x: 120, y: 240, width: 336, height: 380 })

    harness.listeners.get('blur')?.()
    expect(harness.scheduled.length).toBeGreaterThan(0)

    harness.listeners.get('focus')?.()

    expect(harness.cancel).toHaveBeenCalled()
    expect(harness.scheduled).toHaveLength(0)
    // Focus restores the original position so a half-finished nudge never sticks.
    expect(harness.target.setPosition).toHaveBeenLastCalledWith(120, 240)

    harness.flushAll()
    expect(harness.target.setPosition).toHaveBeenLastCalledWith(120, 240)
  })

  it('restores to the bounds captured at blur time, not the live bounds', () => {
    const harness = createHarness({ x: 120, y: 240, width: 336, height: 380 })

    harness.listeners.get('blur')?.()
    // Simulate the window drifting after the nudge began.
    harness.target.getBounds.mockReturnValue({ x: 999, y: 999, width: 336, height: 380 })
    harness.flushAll()

    expect(harness.target.setPosition).toHaveBeenLastCalledWith(120, 240)
  })

  it('re-arms a fresh nudge sequence on each blur', () => {
    const harness = createHarness()

    harness.listeners.get('blur')?.()
    harness.flushAll()
    const firstBurst = harness.target.setPosition.mock.calls.length

    harness.listeners.get('blur')?.()
    harness.flushAll()

    expect(harness.target.setPosition.mock.calls.length).toBe(firstBurst * 2)
  })

  it('dispose cancels pending nudges and restores the original position', () => {
    const harness = createHarness({ x: 120, y: 240, width: 336, height: 380 })

    harness.listeners.get('blur')?.()
    harness.dispose()

    expect(harness.scheduled).toHaveLength(0)
    expect(harness.target.setPosition).toHaveBeenLastCalledWith(120, 240)
  })

  it('exposes an explicit recomposite trigger for taskbar-driven main window activation', () => {
    const harness = createHarness({ x: 120, y: 240, width: 336, height: 380 })

    harness.dispose.recomposite()
    harness.flushAll()

    expect(harness.target.setPosition.mock.calls).toEqual([
      [121, 240],
      [120, 240],
      [121, 240],
      [120, 240],
      [121, 240],
      [120, 240]
    ])
  })
})

describe('installFloatingWindowWhiteStripFix', () => {
  it('installs the recomposition nudge for Windows transparent floating windows', () => {
    const harness = createHarness({ x: 80, y: 160, width: 460, height: 680 })

    harness.dispose()
    harness.target.setPosition.mockClear()
    harness.target.on.mockClear()
    harness.listeners.clear()

    const dispose = installFloatingWindowWhiteStripFix(harness.target, {
      cancel: harness.cancel,
      platform: 'win32',
      schedule: harness.schedule
    })

    expect(dispose).toEqual(expect.any(Function))
    expect(harness.target.on).toHaveBeenCalledWith('blur', expect.any(Function))
    expect(harness.target.on).toHaveBeenCalledWith('focus', expect.any(Function))

    harness.listeners.get('blur')?.()
    harness.flushAll()

    expect(harness.target.setPosition.mock.calls).toEqual([
      [81, 160],
      [80, 160],
      [81, 160],
      [80, 160],
      [81, 160],
      [80, 160]
    ])
  })

  it('skips the native white-strip workaround outside Windows', () => {
    const harness = createHarness()

    harness.dispose()
    harness.target.on.mockClear()

    const dispose = installFloatingWindowWhiteStripFix(harness.target, {
      platform: 'darwin'
    })

    expect(dispose).toBeNull()
    expect(harness.target.on).not.toHaveBeenCalled()
  })
})
