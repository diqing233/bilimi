import { describe, expect, it, vi } from 'vitest'
import { createFloatingSealWakeController } from './floatingSealWakeController'

function sealWindow() {
  return {
    hide: vi.fn(),
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    showInactive: vi.fn()
  }
}

describe('createFloatingSealWakeController', () => {
  it('defers a cold create and coalesces repeated wake requests', () => {
    let scheduled: (() => void) | undefined
    const createWindow = vi.fn(sealWindow)
    const controller = createFloatingSealWakeController({
      createWindow,
      getWindow: () => null,
      prepareWindow: vi.fn(),
      scheduleCreate: (callback) => {
        scheduled = callback
        return 1
      },
      cancelCreate: vi.fn()
    })

    controller.wake()
    controller.wake()

    expect(createWindow).not.toHaveBeenCalled()
    expect(scheduled).toBeTypeOf('function')
    scheduled?.()
    expect(createWindow).toHaveBeenCalledOnce()
  })

  it('shows an existing pet without activating or focusing it', () => {
    const existing = sealWindow()
    const prepareWindow = vi.fn()
    const controller = createFloatingSealWakeController({
      createWindow: vi.fn(sealWindow),
      getWindow: () => existing,
      prepareWindow,
      scheduleCreate: vi.fn(),
      cancelCreate: vi.fn()
    })
    controller.showWhenReady(existing)
    existing.showInactive.mockClear()
    prepareWindow.mockClear()

    controller.wake()

    expect(prepareWindow).toHaveBeenCalledWith(existing)
    expect(existing.showInactive).toHaveBeenCalledOnce()
    expect(existing.focus).not.toHaveBeenCalled()
  })

  it('does not expose a cold window before its renderer is ready', () => {
    const created = sealWindow()
    let current: ReturnType<typeof sealWindow> | null = null
    let scheduled: (() => void) | undefined
    const controller = createFloatingSealWakeController({
      createWindow: () => {
        current = created
        return created
      },
      getWindow: () => current,
      prepareWindow: vi.fn(),
      scheduleCreate: (callback) => {
        scheduled = callback
        return 1
      },
      cancelCreate: vi.fn()
    })

    controller.wake()
    scheduled?.()
    controller.wake()

    expect(created.showInactive).not.toHaveBeenCalled()
    controller.showWhenReady(created)
    expect(created.showInactive).toHaveBeenCalledOnce()
  })

  it('keeps the renderer-selected hit testing state on its first ready show', () => {
    const created = sealWindow()
    const prepareWindow = vi.fn()
    let current: ReturnType<typeof sealWindow> | null = created
    const controller = createFloatingSealWakeController({
      createWindow: () => created,
      getWindow: () => current,
      prepareWindow,
      scheduleCreate: vi.fn(),
      cancelCreate: vi.fn()
    })

    controller.wake()
    controller.showWhenReady(created)

    expect(created.showInactive).toHaveBeenCalledOnce()
    expect(prepareWindow).not.toHaveBeenCalled()
    current = null
  })

  it('notifies post-show setup when an already-ready hidden pet is shown again', () => {
    const existing = sealWindow()
    const onShown = vi.fn()
    const controller = createFloatingSealWakeController({
      createWindow: vi.fn(sealWindow),
      getWindow: () => existing,
      prepareWindow: vi.fn(),
      onShown,
      scheduleCreate: vi.fn(),
      cancelCreate: vi.fn()
    })
    controller.wake()
    controller.showWhenReady(existing)
    controller.close()
    onShown.mockClear()
    existing.showInactive.mockClear()

    controller.wake()

    expect(existing.showInactive).toHaveBeenCalledOnce()
    expect(onShown).toHaveBeenCalledWith(existing)
  })

  it('cancels a scheduled cold wake when the pet is closed', () => {
    let scheduled: (() => void) | undefined
    const cancelCreate = vi.fn()
    const createWindow = vi.fn(sealWindow)
    const controller = createFloatingSealWakeController({
      createWindow,
      getWindow: () => null,
      prepareWindow: vi.fn(),
      scheduleCreate: (callback) => {
        scheduled = callback
        return 7
      },
      cancelCreate
    })

    controller.wake()
    controller.close()

    expect(cancelCreate).toHaveBeenCalledWith(7)
    scheduled?.()
    expect(createWindow).not.toHaveBeenCalled()
  })

  it('cancels a scheduled cold wake for fullscreen without hiding an already visible pet', () => {
    let scheduled: (() => void) | undefined
    const cancelCreate = vi.fn()
    const existing = sealWindow()
    let current: ReturnType<typeof sealWindow> | null = null
    const controller = createFloatingSealWakeController({
      createWindow: vi.fn(sealWindow),
      getWindow: () => current,
      prepareWindow: vi.fn(),
      scheduleCreate: (callback) => {
        scheduled = callback
        return 8
      },
      cancelCreate
    })

    controller.wake()
    controller.cancelPendingWake()
    scheduled?.()

    expect(cancelCreate).toHaveBeenCalledWith(8)
    expect(existing.hide).not.toHaveBeenCalled()
  })

  it('creates a cold pet immediately for an explicit wake while cancelling automatic idle creation', () => {
    let scheduled: (() => void) | undefined
    let current: ReturnType<typeof sealWindow> | null = null
    const cancelCreate = vi.fn()
    const createWindow = vi.fn(() => {
      current = sealWindow()
      return current
    })
    const controller = createFloatingSealWakeController({
      createWindow,
      getWindow: () => current,
      prepareWindow: vi.fn(),
      scheduleCreate: (callback) => {
        scheduled = callback
        return 9
      },
      cancelCreate
    })

    controller.wake()
    controller.wakeImmediately()
    scheduled?.()

    expect(cancelCreate).toHaveBeenCalledWith(9)
    expect(createWindow).toHaveBeenCalledOnce()
  })

  it('does not show a loaded pet after close cancels its display intent', () => {
    const created = sealWindow()
    let current: ReturnType<typeof sealWindow> | null = null
    let scheduled: (() => void) | undefined
    const controller = createFloatingSealWakeController({
      createWindow: () => {
        current = created
        return created
      },
      getWindow: () => current,
      prepareWindow: vi.fn(),
      scheduleCreate: (callback) => {
        scheduled = callback
        return 1
      },
      cancelCreate: vi.fn()
    })

    controller.wake()
    scheduled?.()
    controller.close()
    controller.showWhenReady(created)

    expect(created.hide).toHaveBeenCalledOnce()
    expect(created.showInactive).not.toHaveBeenCalled()
    expect(created.focus).not.toHaveBeenCalled()
  })

  it('creates a replacement when the current window handle is already destroyed', () => {
    const destroyed = sealWindow()
    destroyed.isDestroyed.mockReturnValue(true)
    const replacement = sealWindow()
    const createWindow = vi.fn(() => replacement)
    let scheduled: (() => void) | undefined
    const controller = createFloatingSealWakeController({
      createWindow,
      getWindow: () => destroyed,
      prepareWindow: vi.fn(),
      scheduleCreate: (callback) => { scheduled = callback; return 1 },
      cancelCreate: vi.fn()
    })

    controller.wake()
    scheduled?.()

    expect(createWindow).toHaveBeenCalledOnce()
  })
})
