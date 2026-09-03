import { describe, expect, it, vi } from 'vitest'
import { createStartupInputScheduler } from './startupInputScheduler'

describe('createStartupInputScheduler', () => {
  it('defers a queued task until the input quiet window has elapsed', () => {
    vi.useFakeTimers()
    const scheduler = createStartupInputScheduler({ quietWindowMs: 100 })
    const task = vi.fn()

    scheduler.schedule(task)
    scheduler.noteInputActivity()
    vi.advanceTimersByTime(99)
    expect(task).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(task).toHaveBeenCalledOnce()
    scheduler.dispose()
    vi.useRealTimers()
  })

  it('cancels a task when input arrives before its first stage starts', () => {
    vi.useFakeTimers()
    const scheduler = createStartupInputScheduler({ quietWindowMs: 100 })
    const task = vi.fn()
    const handle = scheduler.schedule(task)

    handle.cancel()
    vi.advanceTimersByTime(500)

    expect(task).not.toHaveBeenCalled()
    expect(handle.status()).toBe('cancelled')
    scheduler.dispose()
    vi.useRealTimers()
  })

  it('requires a fresh quiet window after each input activity', () => {
    vi.useFakeTimers()
    const scheduler = createStartupInputScheduler({ quietWindowMs: 100 })
    const task = vi.fn()

    scheduler.schedule(task)
    vi.advanceTimersByTime(99)
    scheduler.noteInputActivity()
    vi.advanceTimersByTime(99)
    expect(task).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(task).toHaveBeenCalledOnce()
    scheduler.dispose()
    vi.useRealTimers()
  })

  it('starts only one background stage in each quiet window', () => {
    vi.useFakeTimers()
    const scheduler = createStartupInputScheduler({ quietWindowMs: 100 })
    const firstTask = vi.fn()
    const secondTask = vi.fn()

    scheduler.schedule(firstTask)
    scheduler.schedule(secondTask)
    vi.advanceTimersByTime(100)

    expect(firstTask).toHaveBeenCalledOnce()
    expect(secondTask).not.toHaveBeenCalled()

    vi.advanceTimersByTime(99)
    expect(secondTask).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(secondTask).toHaveBeenCalledOnce()
    scheduler.dispose()
    vi.useRealTimers()
  })

  it('reports deferred work without retaining input details', () => {
    vi.useFakeTimers()
    const onTaskStateChange = vi.fn()
    const scheduler = createStartupInputScheduler({
      quietWindowMs: 100,
      onTaskStateChange
    })

    scheduler.schedule(vi.fn(), { label: 'pet-window-create' })
    scheduler.noteInputActivity()

    expect(onTaskStateChange).toHaveBeenCalledWith({
      label: 'pet-window-create',
      status: 'queued'
    })
    expect(onTaskStateChange).toHaveBeenCalledWith({
      label: 'pet-window-create',
      status: 'deferred'
    })
    scheduler.dispose()
    vi.useRealTimers()
  })

  it('keeps later stages serialized until a cancelled active task settles', async () => {
    vi.useFakeTimers()
    let finishActiveTask: (() => void) | undefined
    const scheduler = createStartupInputScheduler({ quietWindowMs: 100 })
    const active = scheduler.schedule(
      () => new Promise<void>((resolve) => { finishActiveTask = resolve })
    )
    const nextTask = vi.fn()
    scheduler.schedule(nextTask)

    vi.advanceTimersByTime(100)
    active.cancel()
    vi.advanceTimersByTime(100)
    expect(nextTask).not.toHaveBeenCalled()
    finishActiveTask?.()
    await Promise.resolve()
    vi.advanceTimersByTime(100)

    expect(nextTask).toHaveBeenCalledOnce()
    scheduler.dispose()
    vi.useRealTimers()
  })

  it('does not retain work scheduled after disposal', () => {
    const scheduler = createStartupInputScheduler()
    scheduler.dispose()
    const handle = scheduler.schedule(vi.fn())
    expect(handle.status()).toBe('cancelled')
  })

  it('reports rejected stages as failed instead of completed', async () => {
    const events: string[] = []
    vi.useFakeTimers()
    const scheduler = createStartupInputScheduler({ quietWindowMs: 0, onTaskStateChange: (event) => events.push(event.status) })
    scheduler.schedule(async () => { throw new Error('boom') })
    vi.runAllTimers()
    await Promise.resolve()
    expect(events).toContain('failed')
    expect(events).not.toContain('completed')
    scheduler.dispose()
    vi.useRealTimers()
  })

  it('does not publish a late completion after disposal cancels an active promise', async () => {
    vi.useFakeTimers()
    let finish: (() => void) | undefined
    const events: string[] = []
    const scheduler = createStartupInputScheduler({ quietWindowMs: 0, onTaskStateChange: (event) => events.push(event.status) })
    scheduler.schedule(() => new Promise<void>((resolve) => { finish = resolve }))
    vi.runAllTimers()
    scheduler.dispose()
    finish?.()
    await Promise.resolve()
    expect(events).not.toContain('completed')
    vi.useRealTimers()
  })
})
