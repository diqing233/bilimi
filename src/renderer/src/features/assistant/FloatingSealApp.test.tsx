import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FloatingSealApp } from './FloatingSealApp'

function withoutPointerEvent(runTest: () => void) {
  const originalPointerEvent = window.PointerEvent

  Object.defineProperty(window, 'PointerEvent', {
    configurable: true,
    writable: true,
    value: undefined
  })

  try {
    runTest()
  } finally {
    Object.defineProperty(window, 'PointerEvent', {
      configurable: true,
      writable: true,
      value: originalPointerEvent
    })
  }
}

describe('FloatingSealApp', () => {
  it('asks the desktop shell to toggle the system menu when clicked', () => {
    const toggleFloatingMenu = vi.fn()

    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        version: '0.1.0',
        toggleFloatingMenu
      }
    })

    render(<FloatingSealApp />)

    fireEvent.click(screen.getByRole('button', { name: '打开 Bilimi 助手' }))

    expect(toggleFloatingMenu).toHaveBeenCalledOnce()
  })

  it('moves the floating shell while dragging without opening the assistant', () => {
    withoutPointerEvent(() => {
      const finishFloatingSealDrag = vi.fn()
      const moveFloatingSealTo = vi.fn()
      const startFloatingSealDrag = vi.fn()
      const toggleFloatingMenu = vi.fn()

      Object.defineProperty(window, 'bilimiDesktop', {
        configurable: true,
        value: {
          version: '0.1.0',
          finishFloatingSealDrag,
          moveFloatingSealTo,
          startFloatingSealDrag,
          toggleFloatingMenu
        }
      })

      render(<FloatingSealApp />)

      const seal = screen.getByRole('button', { name: '打开 Bilimi 助手' })

      fireEvent.mouseDown(seal, { clientX: 40, clientY: 40, screenX: 140, screenY: 240 })
      fireEvent.mouseMove(seal, { clientX: 64, clientY: 52, screenX: 180, screenY: 270 })
      fireEvent.click(seal)

      expect(startFloatingSealDrag).toHaveBeenCalledWith(140, 240)
      expect(moveFloatingSealTo).toHaveBeenCalledWith(180, 270)
      expect(finishFloatingSealDrag).toHaveBeenCalledOnce()
      expect(toggleFloatingMenu).not.toHaveBeenCalled()
    })
  })

  it('suppresses the click that follows a mouse drag release', () => {
    withoutPointerEvent(() => {
      const finishFloatingSealDrag = vi.fn()
      const moveFloatingSealTo = vi.fn()
      const startFloatingSealDrag = vi.fn()
      const toggleFloatingMenu = vi.fn()

      Object.defineProperty(window, 'bilimiDesktop', {
        configurable: true,
        value: {
          version: '0.1.0',
          finishFloatingSealDrag,
          moveFloatingSealTo,
          startFloatingSealDrag,
          toggleFloatingMenu
        }
      })

      render(<FloatingSealApp />)

      const seal = screen.getByRole('button', { name: '打开 Bilimi 助手' })

      fireEvent.mouseDown(seal, { clientX: 40, clientY: 40, screenX: 140, screenY: 240 })
      fireEvent.mouseMove(seal, { clientX: 64, clientY: 52, screenX: 180, screenY: 270 })
      fireEvent.mouseUp(seal, { clientX: 64, clientY: 52, screenX: 180, screenY: 270 })
      fireEvent.click(seal)

      expect(startFloatingSealDrag).toHaveBeenCalledWith(140, 240)
      expect(moveFloatingSealTo).toHaveBeenCalledWith(180, 270)
      expect(finishFloatingSealDrag).toHaveBeenCalledOnce()
      expect(toggleFloatingMenu).not.toHaveBeenCalled()
    })
  })

  it('suppresses the click that follows a pointer drag release', () => {
    const finishFloatingSealDrag = vi.fn()
    const moveFloatingSealTo = vi.fn()
    const startFloatingSealDrag = vi.fn()
    const toggleFloatingMenu = vi.fn()

    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        version: '0.1.0',
        finishFloatingSealDrag,
        moveFloatingSealTo,
        startFloatingSealDrag,
        toggleFloatingMenu
      }
    })

    render(<FloatingSealApp />)

    const seal = screen.getByRole('button', { name: '打开 Bilimi 助手' })

    fireEvent.pointerDown(seal, { clientX: 40, clientY: 40, screenX: 140, screenY: 240, pointerId: 7 })
    fireEvent.pointerMove(seal, { clientX: 64, clientY: 52, screenX: 180, screenY: 270, pointerId: 7 })
    fireEvent.pointerUp(seal, { clientX: 64, clientY: 52, screenX: 180, screenY: 270, pointerId: 7 })
    fireEvent.click(seal)

    expect(startFloatingSealDrag).toHaveBeenCalledWith(140, 240)
    expect(moveFloatingSealTo).toHaveBeenCalledWith(180, 270)
    expect(finishFloatingSealDrag).toHaveBeenCalledOnce()
    expect(toggleFloatingMenu).not.toHaveBeenCalled()
  })

  it('marks the seal as pressed only during a click gesture', () => {
    const toggleFloatingMenu = vi.fn()

    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        version: '0.1.0',
        toggleFloatingMenu
      }
    })

    render(<FloatingSealApp />)

    const seal = screen.getByRole('button', { name: '打开 Bilimi 助手' })

    fireEvent.pointerDown(seal, { clientX: 40, clientY: 40, pointerId: 7 })

    expect(seal).toHaveAttribute('data-pressed', 'true')

    fireEvent.pointerUp(seal, { clientX: 40, clientY: 40, pointerId: 7 })
    fireEvent.click(seal)

    expect(seal).toHaveAttribute('data-pressed', 'false')
    expect(toggleFloatingMenu).toHaveBeenCalledOnce()
  })
})
