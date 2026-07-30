import { describe, expect, it, vi } from 'vitest'
import { setFloatingSealMouseTransparency } from './floatingSealMouseTransparency'

describe('setFloatingSealMouseTransparency', () => {
  it('restores hit testing when a visible pet is woken or repositioned', () => {
    const window = { setIgnoreMouseEvents: vi.fn() }

    setFloatingSealMouseTransparency(window, false)

    expect(window.setIgnoreMouseEvents).toHaveBeenCalledWith(false)
  })
  it('ignores mouse events with forwarding while the cursor is over transparent host pixels', () => {
    const window = {
      setIgnoreMouseEvents: vi.fn()
    }

    setFloatingSealMouseTransparency(window, true)

    expect(window.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true })
  })

  it('accepts mouse events while the cursor is over pet controls', () => {
    const window = {
      setIgnoreMouseEvents: vi.fn()
    }

    setFloatingSealMouseTransparency(window, false)

    expect(window.setIgnoreMouseEvents).toHaveBeenCalledWith(false)
  })
})
