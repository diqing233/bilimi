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
  it('asks the desktop shell to toggle the full assistant when clicked', () => {
    const toggleFloatingAssistant = vi.fn()
    const toggleFloatingMenu = vi.fn()

    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        version: '0.1.0',
        toggleFloatingAssistant,
        toggleFloatingMenu
      }
    })

    render(<FloatingSealApp />)

    fireEvent.click(screen.getByRole('button', { name: '打开小咪助手' }))

    expect(toggleFloatingAssistant).toHaveBeenCalledOnce()
    expect(toggleFloatingMenu).not.toHaveBeenCalled()
  })

  it('uses 小咪 as the floating assistant button icon', () => {
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        version: '0.1.0',
        toggleFloatingAssistant: vi.fn()
      }
    })

    render(<FloatingSealApp />)

    expect(screen.getByRole('button', { name: '打开小咪助手' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '小咪待机' })).toHaveClass('floating-seal-button__pet')
    expect(screen.queryByText('玺')).not.toBeInTheDocument()
  })

  it('falls back to the system menu bridge when the assistant bridge is unavailable', () => {
    const toggleFloatingMenu = vi.fn()

    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        version: '0.1.0',
        toggleFloatingMenu
      }
    })

    render(<FloatingSealApp />)

    fireEvent.click(screen.getByRole('button', { name: '打开小咪助手' }))

    expect(toggleFloatingMenu).toHaveBeenCalledOnce()
  })

  it('moves the floating shell while dragging without opening the assistant', () => {
    withoutPointerEvent(() => {
      const finishFloatingSealDrag = vi.fn()
      const moveFloatingSealTo = vi.fn()
      const startFloatingSealDrag = vi.fn()
      const toggleFloatingAssistant = vi.fn()

      Object.defineProperty(window, 'bilimiDesktop', {
        configurable: true,
        value: {
          version: '0.1.0',
          finishFloatingSealDrag,
          moveFloatingSealTo,
          startFloatingSealDrag,
          toggleFloatingAssistant
        }
      })

      render(<FloatingSealApp />)

      const seal = screen.getByRole('button', { name: '打开小咪助手' })

      fireEvent.mouseDown(seal, { clientX: 40, clientY: 40, screenX: 140, screenY: 240 })
      fireEvent.mouseMove(seal, { clientX: 64, clientY: 52, screenX: 180, screenY: 270 })
      fireEvent.click(seal)

      expect(startFloatingSealDrag).toHaveBeenCalledWith(140, 240)
      expect(moveFloatingSealTo).not.toHaveBeenCalled()
      expect(finishFloatingSealDrag).toHaveBeenCalledOnce()
      expect(toggleFloatingAssistant).not.toHaveBeenCalled()
    })
  })

  it('suppresses the click that follows a mouse drag release', () => {
    withoutPointerEvent(() => {
      const finishFloatingSealDrag = vi.fn()
      const moveFloatingSealTo = vi.fn()
      const startFloatingSealDrag = vi.fn()
      const toggleFloatingAssistant = vi.fn()

      Object.defineProperty(window, 'bilimiDesktop', {
        configurable: true,
        value: {
          version: '0.1.0',
          finishFloatingSealDrag,
          moveFloatingSealTo,
          startFloatingSealDrag,
          toggleFloatingAssistant
        }
      })

      render(<FloatingSealApp />)

      const seal = screen.getByRole('button', { name: '打开小咪助手' })

      fireEvent.mouseDown(seal, { clientX: 40, clientY: 40, screenX: 140, screenY: 240 })
      fireEvent.mouseMove(seal, { clientX: 64, clientY: 52, screenX: 180, screenY: 270 })
      fireEvent.mouseUp(seal, { clientX: 64, clientY: 52, screenX: 180, screenY: 270 })
      fireEvent.click(seal)

      expect(startFloatingSealDrag).toHaveBeenCalledWith(140, 240)
      expect(moveFloatingSealTo).not.toHaveBeenCalled()
      expect(finishFloatingSealDrag).toHaveBeenCalledOnce()
      expect(toggleFloatingAssistant).not.toHaveBeenCalled()
    })
  })

  it('suppresses the click that follows a pointer drag release', () => {
    const finishFloatingSealDrag = vi.fn()
    const moveFloatingSealTo = vi.fn()
    const startFloatingSealDrag = vi.fn()
    const toggleFloatingAssistant = vi.fn()

    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        version: '0.1.0',
        finishFloatingSealDrag,
        moveFloatingSealTo,
        startFloatingSealDrag,
        toggleFloatingAssistant
      }
    })

    render(<FloatingSealApp />)

    const seal = screen.getByRole('button', { name: '打开小咪助手' })

    fireEvent.pointerDown(seal, { clientX: 40, clientY: 40, screenX: 140, screenY: 240, pointerId: 7 })
    fireEvent.pointerMove(seal, { clientX: 64, clientY: 52, screenX: 180, screenY: 270, pointerId: 7 })
    fireEvent.pointerUp(seal, { clientX: 64, clientY: 52, screenX: 180, screenY: 270, pointerId: 7 })
    fireEvent.click(seal)

    expect(startFloatingSealDrag).toHaveBeenCalledWith(140, 240)
    expect(moveFloatingSealTo).not.toHaveBeenCalled()
    expect(finishFloatingSealDrag).toHaveBeenCalledOnce()
    expect(toggleFloatingAssistant).not.toHaveBeenCalled()
  })

  it('finishes the desktop drag when pointer capture is cancelled', () => {
    const finishFloatingSealDrag = vi.fn()
    const startFloatingSealDrag = vi.fn()

    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        version: '0.1.0',
        finishFloatingSealDrag,
        startFloatingSealDrag
      }
    })

    render(<FloatingSealApp />)

    const seal = screen.getByRole('button', { name: '打开小咪助手' })

    fireEvent.pointerDown(seal, {
      clientX: 40,
      clientY: 40,
      screenX: 140,
      screenY: 240,
      pointerId: 7
    })
    fireEvent.pointerCancel(seal, { pointerId: 7 })

    expect(startFloatingSealDrag).toHaveBeenCalledWith(140, 240)
    expect(finishFloatingSealDrag).toHaveBeenCalledOnce()
    expect(seal).toHaveAttribute('data-pressed', 'false')
  })

  it('marks the seal as pressed only during a click gesture', () => {
    const toggleFloatingAssistant = vi.fn()

    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        version: '0.1.0',
        toggleFloatingAssistant
      }
    })

    render(<FloatingSealApp />)

    const seal = screen.getByRole('button', { name: '打开小咪助手' })

    fireEvent.pointerDown(seal, { clientX: 40, clientY: 40, pointerId: 7 })

    expect(seal).toHaveAttribute('data-pressed', 'true')

    fireEvent.pointerUp(seal, { clientX: 40, clientY: 40, pointerId: 7 })
    fireEvent.click(seal)

    expect(seal).toHaveAttribute('data-pressed', 'false')
    expect(toggleFloatingAssistant).toHaveBeenCalledOnce()
  })

  it('does not schedule opening reset after unmount when the toggle bridge resolves late', async () => {
    let resolveToggle: () => void = () => undefined
    const toggleRequest = new Promise<void>((resolve) => {
      resolveToggle = resolve
    })
    const toggleFloatingAssistant = vi.fn(() => toggleRequest)
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout')

    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        version: '0.1.0',
        toggleFloatingAssistant
      }
    })

    const { unmount } = render(<FloatingSealApp />)

    fireEvent.click(screen.getByRole('button', { name: '打开小咪助手' }))
    unmount()
    resolveToggle()
    await toggleRequest
    await Promise.resolve()

    expect(setTimeoutSpy).not.toHaveBeenCalled()
  })
})

