import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number
    pressure: number
    isPrimary: boolean
    pointerType: string

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 1
      this.pressure = init.pressure ?? 0.5
      this.isPrimary = init.isPrimary ?? true
      this.pointerType = init.pointerType ?? 'mouse'
    }
  }

  Object.defineProperty(window, 'PointerEvent', {
    configurable: true,
    writable: true,
    value: PointerEventPolyfill
  })
}

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'bilimiDesktop')
})
