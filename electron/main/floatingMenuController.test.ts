import { describe, expect, it } from 'vitest'
import { FloatingMenuController } from './floatingMenuController'

function createTestWindow(destroyed = false) {
  return {
    closeCount: 0,
    destroyed,
    close() {
      this.closeCount += 1
      this.destroyed = true
    },
    isDestroyed() {
      return this.destroyed
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

  it('closes the existing menu window when toggled from open state', () => {
    const createdWindow = createTestWindow()
    const controller = new FloatingMenuController(() => createdWindow)

    controller.toggle()

    expect(controller.toggle()).toBeNull()
    expect(createdWindow.closeCount).toBe(1)
    expect(controller.getWindow()).toBeNull()
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
