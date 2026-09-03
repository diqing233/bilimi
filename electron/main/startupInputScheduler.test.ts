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

  it('allows a costly background stage to require a longer quiet window when explicitly requested', () => {
    vi.useFakeTimers()
    const scheduler = createStartupInputScheduler({ quietWindowMs: 100 })
    const task = vi.fn()

    scheduler.schedule(task, { label: 'pet-window-create', minimumQuietWindowMs: 600 })
    scheduler.noteInputActivity()
    vi.advanceTimersByTime(599)
    expect(task).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(task).toHaveBeenCalledOnce()
    scheduler.dispose()
    vi.useRealTimers()
  })

  it('lets a pointer-tolerant first stage honor its longer real-interaction guard while pointer movement continues', () => {
    vi.useFakeTimers()
    const scheduler = createStartupInputScheduler({ quietWindowMs: 100 })
    const task = vi.fn()

    scheduler.schedule(task, {
      label: 'pet-window-create',
      minimumQuietWindowMs: 600,
      minimumDelayMs: 600,
      ignorePointerMove: true
    })
    for (let elapsed = 20; elapsed <= 580; elapsed += 20) {
      vi.advanceTimersByTime(20)
      scheduler.noteInputActivity('pointer-move')
    }
    vi.advanceTimersByTime(19)
    expect(task).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(task).toHaveBeenCalledOnce()
    scheduler.dispose()
    vi.useRealTimers()
  })

  it('continues to delay a pointer-tolerant first stage after a real foreground interaction', () => {
    vi.useFakeTimers()
    const scheduler = createStartupInputScheduler({ quietWindowMs: 100 })
    const task = vi.fn()

    scheduler.schedule(task, {
      label: 'pet-window-create',
      ignorePointerMove: true
    })
    vi.advanceTimersByTime(50)
    scheduler.noteInputActivity('foreground')
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

  it('can suppress high-frequency task diagnostics without changing task scheduling', () => {
    vi.useFakeTimers()
    const onTaskStateChange = vi.fn()
    const scheduler = createStartupInputScheduler({ quietWindowMs: 0, onTaskStateChange })
    const task = vi.fn()

    scheduler.schedule(task, { label: 'floating-seal:mouse-recovery-poll', reportDiagnostics: false })
    vi.runAllTimers()

    expect(task).toHaveBeenCalledOnce()
    expect(onTaskStateChange).not.toHaveBeenCalled()
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

  it('runs a lightweight pointer-tolerant poll on its own cadence while continuous movement continues', () => {
    vi.useFakeTimers()
    const scheduler = createStartupInputScheduler({ quietWindowMs: 160 })
    const poll = vi.fn()

    scheduler.schedule(poll, {
      label: 'floating-seal:mouse-recovery-poll',
      minimumQuietWindowMs: 0,
      minimumDelayMs: 80,
      ignorePointerMove: true,
      allowConcurrent: true,
      reportDiagnostics: false
    })
    for (let elapsed = 0; elapsed < 80; elapsed += 20) {
      vi.advanceTimersByTime(20)
      scheduler.noteInputActivity('pointer-move')
    }

    vi.advanceTimersByTime(1)
    expect(poll).toHaveBeenCalledOnce()
    scheduler.dispose()
    vi.useRealTimers()
  })

  it('still lets a lightweight poll yield to a real foreground interaction', () => {
    vi.useFakeTimers()
    const scheduler = createStartupInputScheduler({ quietWindowMs: 160 })
    const poll = vi.fn()

    scheduler.schedule(poll, {
      label: 'floating-seal:mouse-recovery-poll',
      minimumQuietWindowMs: 0,
      minimumDelayMs: 80,
      ignorePointerMove: true,
      allowConcurrent: true,
      reportDiagnostics: false
    })
    vi.advanceTimersByTime(60)
    scheduler.noteInputActivity('foreground')
    vi.advanceTimersByTime(20)
    expect(poll).not.toHaveBeenCalled()
    vi.advanceTimersByTime(140)
    expect(poll).toHaveBeenCalledOnce()

    scheduler.dispose()
    vi.useRealTimers()
  })
})
