import { describe, expect, it, vi } from 'vitest'
import { installSingleInstanceGuard } from './singleInstance'

describe('installSingleInstanceGuard', () => {
  it('quits immediately when another instance owns the lock', () => {
    const app = {
      focus: vi.fn(), isReady: vi.fn(() => true), on: vi.fn(), quit: vi.fn(), requestSingleInstanceLock: vi.fn(() => false)
    }

    expect(installSingleInstanceGuard(app, () => null)).toBe(false)
    expect(app.quit).toHaveBeenCalledOnce()
  })

  it('restores and focuses the existing window for a second launch', () => {
    let handler!: () => void
    const app = {
      focus: vi.fn(), isReady: vi.fn(() => true), quit: vi.fn(), requestSingleInstanceLock: vi.fn(() => true),
      on: vi.fn((_event: string, nextHandler: () => void) => { handler = nextHandler })
    }
    const window = {
      focus: vi.fn(), isDestroyed: vi.fn(() => false), isMinimized: vi.fn(() => true), restore: vi.fn(), show: vi.fn()
    }

    expect(installSingleInstanceGuard(app, () => window)).toBeTruthy()
    handler()

    expect(window.restore).toHaveBeenCalledOnce()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  })

  it('remembers a second launch until the main window exists', () => {
    let handler!: () => void
    const createWindow = () => ({
      focus: vi.fn(), isDestroyed: vi.fn(() => false), isMinimized: vi.fn(() => false), restore: vi.fn(), show: vi.fn()
    })
    let window: ReturnType<typeof createWindow> | null = null
    const app = {
      focus: vi.fn(), isReady: vi.fn(() => false), quit: vi.fn(), requestSingleInstanceLock: vi.fn(() => true),
      on: vi.fn((_event: string, nextHandler: () => void) => { handler = nextHandler })
    }
    const guard = installSingleInstanceGuard(app, () => window)
    if (!guard) throw new Error('lock unavailable')

    handler()
    expect(guard.hasPendingFocus()).toBe(true)
    window = createWindow()
    guard.focusMainWindow()

    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  })
})
