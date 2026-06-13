import { describe, expect, it, vi } from 'vitest'
import { FloatingSealDragController } from './floatingSealDragController'

describe('FloatingSealDragController', () => {
  it('moves the seal from the current system cursor during a drag tick', () => {
    const setPosition = vi.fn()
    const controller = new FloatingSealDragController({
      getCursorPoint: () => ({ x: 180, y: 270 }),
      getSealBounds: () => ({ x: 100, y: 200, width: 92, height: 92 }),
      moveSealTo: setPosition,
      startInterval: vi.fn(() => 1),
      stopInterval: vi.fn()
    })

    controller.start({ x: 140, y: 240 })
    controller.tick()

    expect(setPosition).toHaveBeenCalledWith({ x: 140, y: 230 })
  })

  it('polls cursor position until the drag finishes', () => {
    const stopInterval = vi.fn()
    const startInterval = vi.fn(() => 7)
    const controller = new FloatingSealDragController({
      getCursorPoint: () => ({ x: 180, y: 270 }),
      getSealBounds: () => ({ x: 100, y: 200, width: 92, height: 92 }),
      moveSealTo: vi.fn(),
      startInterval,
      stopInterval
    })

    controller.start({ x: 140, y: 240 })
    controller.finish()

    expect(startInterval).toHaveBeenCalledWith(expect.any(Function), 16)
    expect(stopInterval).toHaveBeenCalledWith(7)
  })

  it('does not move after the drag has finished', () => {
    const setPosition = vi.fn()
    const controller = new FloatingSealDragController({
      getCursorPoint: () => ({ x: 180, y: 270 }),
      getSealBounds: () => ({ x: 100, y: 200, width: 92, height: 92 }),
      moveSealTo: setPosition,
      startInterval: vi.fn(() => 1),
      stopInterval: vi.fn()
    })

    controller.start({ x: 140, y: 240 })
    controller.finish()
    controller.tick()

    expect(setPosition).not.toHaveBeenCalled()
  })
})
