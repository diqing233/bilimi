import { describe, expect, it, vi } from 'vitest'
import { createPreferenceSaveScheduler } from './preferenceSaveScheduler'

type TestPreferences = {
  defaultCoinCount: 1 | 2
  commentSubmitMode: 'choose' | 'random'
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })

  return { promise, reject, resolve }
}

describe('createPreferenceSaveScheduler', () => {
  it('debounces rapid changes and saves the latest snapshot only', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async (preferences: TestPreferences) => preferences)
    const scheduler = createPreferenceSaveScheduler<TestPreferences>({
      delayMs: 250,
      save
    })

    scheduler.schedule({ defaultCoinCount: 1, commentSubmitMode: 'random' })
    scheduler.schedule({ defaultCoinCount: 2, commentSubmitMode: 'choose' })

    expect(save).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(250)

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({ defaultCoinCount: 2, commentSubmitMode: 'choose' })
    vi.useRealTimers()
  })

  it('serializes in-flight saves and only writes the latest pending snapshot next', async () => {
    vi.useFakeTimers()
    const first = createDeferred<TestPreferences>()
    const save = vi
      .fn<(_: TestPreferences) => Promise<TestPreferences>>()
      .mockReturnValueOnce(first.promise)
      .mockImplementation(async (preferences) => preferences)
    const scheduler = createPreferenceSaveScheduler<TestPreferences>({
      delayMs: 100,
      save
    })

    scheduler.schedule({ defaultCoinCount: 2, commentSubmitMode: 'random' })
    await vi.advanceTimersByTimeAsync(100)
    expect(save).toHaveBeenCalledTimes(1)

    scheduler.schedule({ defaultCoinCount: 1, commentSubmitMode: 'choose' })
    scheduler.schedule({ defaultCoinCount: 2, commentSubmitMode: 'choose' })
    await vi.advanceTimersByTimeAsync(100)
    expect(save).toHaveBeenCalledTimes(1)

    first.resolve({ defaultCoinCount: 2, commentSubmitMode: 'random' })
    await vi.runOnlyPendingTimersAsync()

    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith({ defaultCoinCount: 2, commentSubmitMode: 'choose' })
    vi.useRealTimers()
  })

  it('flushes a pending save immediately', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async (preferences: TestPreferences) => preferences)
    const scheduler = createPreferenceSaveScheduler<TestPreferences>({
      delayMs: 500,
      save
    })

    scheduler.schedule({ defaultCoinCount: 2, commentSubmitMode: 'choose' })
    const saved = await scheduler.flush()

    expect(saved).toEqual({ defaultCoinCount: 2, commentSubmitMode: 'choose' })
    expect(save).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
