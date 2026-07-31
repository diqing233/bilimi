import { describe, expect, it, vi } from 'vitest'
import { createFloatingSealWakeController } from './floatingSealWakeController'

function sealWindow() {
  return {
    close: vi.fn(),
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

    expect(created.close).toHaveBeenCalledOnce()
    expect(created.showInactive).not.toHaveBeenCalled()
    expect(created.focus).not.toHaveBeenCalled()
  })
})
