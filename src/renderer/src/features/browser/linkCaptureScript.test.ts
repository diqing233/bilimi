import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildOpenVideoLinksInAppScript } from './linkCaptureScript'

describe('buildOpenVideoLinksInAppScript', () => {
  const originalOpen = window.open

  beforeEach(() => {
    document.body.innerHTML = ''
    Object.defineProperty(window, 'open', {
      configurable: true,
      value: vi.fn()
    })
  })

  afterEach(() => {
    document.body.innerHTML = ''
    Object.defineProperty(window, 'open', {
      configurable: true,
      value: originalOpen
    })
    Reflect.deleteProperty(window, '__bilimiOpenVideoLinksInstalled')
  })

  it('opens bilibili video links in a new app tab', () => {
    document.body.innerHTML =
      '<a href="https://www.bilibili.com/video/BV1click"><span>open video</span></a>'

    window.eval(buildOpenVideoLinksInAppScript())
    const click = new MouseEvent('click', { bubbles: true, button: 0, cancelable: true })

    document.querySelector('span')?.dispatchEvent(click)

    expect(click.defaultPrevented).toBe(true)
    expect(document.title).toContain('__BILIMI_OPEN_IN_TAB__:')
    expect(document.title).toContain(encodeURIComponent('https://www.bilibili.com/video/BV1click'))
    expect(window.open).not.toHaveBeenCalled()
  })

  it('leaves non-video links alone', () => {
    document.body.innerHTML = '<a href="https://www.bilibili.com/read/cv123"><span>open article</span></a>'
    let wasPreventedByCapture = true

    window.eval(buildOpenVideoLinksInAppScript())
    document.addEventListener(
      'click',
      (event) => {
        wasPreventedByCapture = event.defaultPrevented
        event.preventDefault()
      },
      { once: true }
    )
    const click = new MouseEvent('click', { bubbles: true, button: 0, cancelable: true })

    document.querySelector('span')?.dispatchEvent(click)

    expect(wasPreventedByCapture).toBe(false)
    expect(window.open).not.toHaveBeenCalled()
  })
})
