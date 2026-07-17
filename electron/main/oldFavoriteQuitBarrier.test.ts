import { describe, expect, it, vi } from 'vitest'
import { createOldFavoriteQuitBarrier } from './oldFavoriteQuitBarrier'

describe('createOldFavoriteQuitBarrier', () => {
  it('prevents the first quit, flushes durable state, then quits without recursion', async () => {
    let resolveFlush!: () => void
    const flush = vi.fn(() => new Promise<void>((resolve) => { resolveFlush = resolve }))
    const prepare = vi.fn()
    const quit = vi.fn()
    const barrier = createOldFavoriteQuitBarrier({ prepare, flush, quit })
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

  it('keeps blocking quit after a failed flush so the user can retry safely', async () => {
    const flush = vi.fn()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce(undefined)
    const quit = vi.fn()
    const barrier = createOldFavoriteQuitBarrier({ prepare: vi.fn(), flush, quit })

    barrier({ preventDefault: vi.fn() })
    await Promise.resolve()
    await Promise.resolve()
    barrier({ preventDefault: vi.fn() })
    await Promise.resolve()
    await Promise.resolve()

    expect(flush).toHaveBeenCalledTimes(2)
    expect(quit).toHaveBeenCalledOnce()
  })
})
