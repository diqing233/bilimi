import { describe, expect, it, vi } from 'vitest'
import { FloatingMenuController } from './floatingMenuController'

function createTestWindow(destroyed = false) {
  return {
    closeCount: 0,
    destroyed,
    focusCount: 0,
    hideCount: 0,
    showCount: 0,
    visible: true,
    close() {
      this.closeCount += 1
      this.destroyed = true
    },
    focus() {
      this.focusCount += 1
    },
    hide() {
      this.hideCount += 1
      this.visible = false
    },
    isDestroyed() {
      return this.destroyed
    },
    isVisible() {
      return this.visible
    },
    show() {
      this.showCount += 1
      this.visible = true
    }
  }
}

describe('FloatingMenuController', () => {
  it('creates a menu window when toggled from closed state', () => {
    const createdWindow = createTestWindow()
    const controller = new FloatingMenuController(() => createdWindow)

    expect(controller.toggle()).toBe(createdWindow)
    expect(controller.getWindow()).toBe(createdWindow)
  })

  it('hides the existing floating window when toggled from open state', () => {
    const createdWindow = createTestWindow()
    const controller = new FloatingMenuController(() => createdWindow)

    controller.toggle()

    expect(controller.toggle()).toBeNull()
    expect(createdWindow.hideCount).toBe(1)
    expect(createdWindow.closeCount).toBe(0)
    expect(controller.getWindow()).toBe(createdWindow)
  })

  it('opens an existing window without toggling it closed', () => {
    const createdWindow = createTestWindow()
    const controller = new FloatingMenuController(() => createdWindow)

    expect(controller.open()).toBe(createdWindow)
    createdWindow.visible = false
    expect(controller.open()).toBe(createdWindow)
    expect(createdWindow.closeCount).toBe(0)
    expect(createdWindow.showCount).toBe(1)
    expect(createdWindow.focusCount).toBe(1)
    expect(controller.getWindow()).toBe(createdWindow)
  })

  it('prepares an existing hidden window before showing it again', () => {
    const createdWindow = createTestWindow()
    const prepareWindow = vi.fn()
    const controller = new FloatingMenuController(() => createdWindow, { prepareWindow })

    controller.open()
    createdWindow.visible = false
    controller.open()

    expect(prepareWindow).toHaveBeenCalledWith(createdWindow)
    expect(createdWindow.showCount).toBe(1)
  })

  it('hides an existing floating window without destroying its renderer state', () => {
    const createdWindow = createTestWindow()
    const controller = new FloatingMenuController(() => createdWindow)

    controller.open()
    controller.hide()

    expect(createdWindow.hideCount).toBe(1)
    expect(createdWindow.closeCount).toBe(0)
    expect(controller.getWindow()).toBe(createdWindow)

    expect(controller.open()).toBe(createdWindow)
    expect(createdWindow.showCount).toBe(1)
    expect(createdWindow.focusCount).toBe(1)
  })

  it('clears a destroyed menu reference without closing it again', () => {
    const destroyedWindow = createTestWindow(true)
    const controller = new FloatingMenuController(() => destroyedWindow)

    controller.toggle()
    controller.close()

    expect(destroyedWindow.closeCount).toBe(0)
    expect(controller.getWindow()).toBeNull()
  })

  it('clears only the matching closed window reference', () => {
    const firstWindow = createTestWindow()
    const secondWindow = createTestWindow()
    const controller = new FloatingMenuController(() => firstWindow)

    controller.toggle()
    controller.clearIfCurrent(secondWindow)

    expect(controller.getWindow()).toBe(firstWindow)

    controller.clearIfCurrent(firstWindow)

    expect(controller.getWindow()).toBeNull()
  })
})
