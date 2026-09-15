import { describe, expect, it, vi } from 'vitest'
import { createFrameTaskScheduler } from './frameTaskScheduler'

describe('createFrameTaskScheduler', () => {
  it('coalesces repeated requests into one task on the next frame', () => {
    const callbacks: FrameRequestCallback[] = []
    const task = vi.fn()
    const scheduler = createFrameTaskScheduler({
      requestFrame: (callback) => { callbacks.push(callback); return callbacks.length },
      cancelFrame: vi.fn()
    })

    scheduler.schedule(task)
    scheduler.schedule(task)
    scheduler.schedule(task)

    expect(callbacks).toHaveLength(1)
    callbacks[0](16)
    expect(task).toHaveBeenCalledOnce()
  })

  it('cancels a queued task during cleanup', () => {
    const cancelFrame = vi.fn()
    const scheduler = createFrameTaskScheduler({
      requestFrame: () => 42,
      cancelFrame
    })

    scheduler.schedule(vi.fn())
    scheduler.cancel()

    expect(cancelFrame).toHaveBeenCalledWith(42)
  })
})
