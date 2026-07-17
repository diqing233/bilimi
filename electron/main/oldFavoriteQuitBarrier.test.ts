import { describe, expect, it, vi } from 'vitest'
import { createOldFavoriteQuitBarrier } from './oldFavoriteQuitBarrier'

describe('createOldFavoriteQuitBarrier', () => {
  it('lets a clean unopened workspace quit immediately without prepare or flush', () => {
    const prepare = vi.fn()
    const flush = vi.fn()
    const barrier = createOldFavoriteQuitBarrier({
      shouldFlush: () => false,
      prepare,
      flush,
      quit: vi.fn()
    })
    const event = { preventDefault: vi.fn() }

    barrier(event)

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(prepare).not.toHaveBeenCalled()
    expect(flush).not.toHaveBeenCalled()
  })

  it('prevents the first quit, flushes durable state, then quits without recursion', async () => {
    let resolveFlush!: () => void
    const flush = vi.fn(() => new Promise<void>((resolve) => { resolveFlush = resolve }))
    const prepare = vi.fn()
    const quit = vi.fn()
    const barrier = createOldFavoriteQuitBarrier({ shouldFlush: () => true, prepare, flush, quit })
    const firstEvent = { preventDefault: vi.fn() }

    barrier(firstEvent)
    expect(firstEvent.preventDefault).toHaveBeenCalledOnce()
    expect(prepare).toHaveBeenCalledOnce()
    expect(quit).not.toHaveBeenCalled()

    resolveFlush()
    await Promise.resolve()
    await Promise.resolve()
    expect(quit).toHaveBeenCalledOnce()

    const recursiveEvent = { preventDefault: vi.fn() }
    barrier(recursiveEvent)
    expect(recursiveEvent.preventDefault).not.toHaveBeenCalled()
    expect(flush).toHaveBeenCalledOnce()
  })

  it('does not hang exit when a dirty flush rejects', async () => {
    const flush = vi.fn().mockRejectedValue(new Error('disk full'))
    const quit = vi.fn()
    const barrier = createOldFavoriteQuitBarrier({ shouldFlush: () => true, prepare: vi.fn(), flush, quit })

    barrier({ preventDefault: vi.fn() })
    await Promise.resolve()
    await Promise.resolve()

    expect(flush).toHaveBeenCalledOnce()
    expect(quit).toHaveBeenCalledOnce()
  })

  it('stops waiting for a hung dirty flush after the short exit deadline', async () => {
    vi.useFakeTimers()
    try {
      const flush = vi.fn(() => new Promise<void>(() => undefined))
      const quit = vi.fn()
      const barrier = createOldFavoriteQuitBarrier({
        shouldFlush: () => true,
        prepare: vi.fn(),
        flush,
        quit,
        flushTimeoutMs: 250
      })
      const event = { preventDefault: vi.fn() }

      barrier(event)
      await vi.advanceTimersByTimeAsync(249)
      expect(quit).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1)
      expect(quit).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
})
