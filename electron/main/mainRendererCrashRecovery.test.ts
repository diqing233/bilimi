import { describe, expect, it, vi } from 'vitest'
import { createMainRendererCrashRecovery } from './mainRendererCrashRecovery'

describe('main renderer crash recovery', () => {
  it('recreates the main window once and stops a repeated crash loop', () => {
    const recreate = vi.fn()
    const stop = vi.fn()
    const recovery = createMainRendererCrashRecovery({ recreate, stop, windowMs: 10_000 })

    expect(recovery.handleCrash(undefined, 1_000)).toBe('recreate')
    expect(recovery.handleCrash(undefined, 2_000)).toBe('stop')
    expect(recreate).toHaveBeenCalledOnce()
    expect(stop).toHaveBeenCalledOnce()
  })

  it('allows another recovery after the crash window expires', () => {
    const recreate = vi.fn()
    const recovery = createMainRendererCrashRecovery({ recreate, stop: vi.fn(), windowMs: 1_000 })

    expect(recovery.handleCrash(undefined, 1_000)).toBe('recreate')
    expect(recovery.handleCrash(undefined, 3_000)).toBe('recreate')
    expect(recreate).toHaveBeenCalledTimes(2)
  })
})
