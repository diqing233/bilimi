import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

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

// JSDOM exposes scrollTo but reports it as unimplemented during modal cleanup.
Object.defineProperty(window, 'scrollTo', {
  configurable: true,
  writable: true,
  value: () => undefined
})

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  document.documentElement.style.overflow = ''
  Reflect.deleteProperty(document, 'cookie')
  localStorage.clear()
  sessionStorage.clear()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window, 'bilimiDesktop')
})
