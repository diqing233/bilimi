import { describe, expect, it, vi } from 'vitest'
import {
  createOldFavoriteQuitBarrier,
  prepareOldFavoriteStateForShutdown,
  shouldFlushOldFavoriteOnQuit
} from './oldFavoriteQuitBarrier'
import { createOldFavoriteBatch, type OldFavoriteSessionsState } from '../../src/shared/oldFavoriteSessions'

describe('createOldFavoriteQuitBarrier', () => {
  it('flushes an opened session store with a durable active lease even when dirty trackers are clean', () => {
    const load = vi.fn().mockReturnValue({ lease: { batchId: 'batch', segmentId: 'segment' } })

    expect(shouldFlushOldFavoriteOnQuit(false, false, { load })).toBe(true)
    expect(load).toHaveBeenCalledOnce()
  })

  it('flushes an opened session store with running segments even when no lease remains', () => {
    const load = vi.fn().mockReturnValue({
      lease: null,
      batches: [{ status: 'active', segments: [{ status: 'running' }] }]
    })

    expect(shouldFlushOldFavoriteOnQuit(false, false, { load })).toBe(true)
  })

  it('prepares runtime and session state together for running work without a lease', () => {
    const batch = createOldFavoriteBatch({ accountMid: '42', kind: 'full', aids: [1], now: '2026-07-16T08:00:00Z' })
    batch.segments[0].status = 'running'
    const state: OldFavoriteSessionsState = {
      version: 1,
      lease: null,
      batches: [batch]
    }
    const sessionStore = {
      load: vi.fn(() => state),
      saveForShutdown: vi.fn()
    }
    const runtimeStore = { prepareForShutdown: vi.fn() }
    const beginMutation = vi.fn()

    expect(prepareOldFavoriteStateForShutdown({ sessionStore, runtimeStore, beginMutation })).toBe(true)
    expect(sessionStore.saveForShutdown).toHaveBeenCalledWith(state)
    expect(runtimeStore.prepareForShutdown).toHaveBeenCalledOnce()
    expect(beginMutation).toHaveBeenCalledOnce()
  })

  it('does not initialize or read an unopened session store for a clean quit', () => {
    expect(shouldFlushOldFavoriteOnQuit(false, false, undefined)).toBe(false)
  })

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

  it('runs only the dirty lightweight prepare before a bounded flush timeout', async () => {
    vi.useFakeTimers()
    try {
      const prepare = vi.fn()
      const flush = vi.fn(() => new Promise<void>(() => undefined))
      const quit = vi.fn()
      const barrier = createOldFavoriteQuitBarrier({
        shouldFlush: () => true, prepare, flush, quit, flushTimeoutMs: 100
      })

      barrier({ preventDefault: vi.fn() })
      await vi.advanceTimersByTimeAsync(100)

      expect(prepare).toHaveBeenCalledOnce()
      expect(flush).toHaveBeenCalledOnce()
      expect(quit).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
})
