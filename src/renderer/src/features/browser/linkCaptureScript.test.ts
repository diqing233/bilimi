import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildOpenVideoLinksInAppScript } from './linkCaptureScript'

describe('buildOpenVideoLinksInAppScript', () => {
  const originalOpen = window.open

  beforeEach(() => {
    document.body.innerHTML = ''
    document.title = 'Bilimi'
    Object.defineProperty(window, 'open', {
      configurable: true,
      value: vi.fn()
    })
  })

  afterEach(() => {
    document.body.innerHTML = ''
    document.title = 'Bilimi'
    Object.defineProperty(window, 'open', {
      configurable: true,
      value: originalOpen
    })
    Reflect.deleteProperty(window, '__bilimiOpenLinksInstalled')
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

  it('opens bilibili navigation links in a new app tab', () => {
    document.body.innerHTML = '<a href="https://www.bilibili.com/read/cv123"><span>open article</span></a>'

    window.eval(buildOpenVideoLinksInAppScript())
    const click = new MouseEvent('click', { bubbles: true, button: 0, cancelable: true })

    document.querySelector('span')?.dispatchEvent(click)

    expect(click.defaultPrevented).toBe(true)
    expect(document.title).toContain('__BILIMI_OPEN_IN_TAB__:')
    expect(document.title).toContain(encodeURIComponent('https://www.bilibili.com/read/cv123'))
    expect(window.open).not.toHaveBeenCalled()
  })

  it('opens bilibili video links when clicking card chrome outside the anchor', () => {
    document.body.innerHTML = `
      <div class="bili-video-card">
        <div class="bili-video-card__cover"><span>cover chrome</span></div>
        <a href="https://www.bilibili.com/video/BV1card">open video</a>
      </div>
    `

    window.eval(buildOpenVideoLinksInAppScript())
    const click = new MouseEvent('click', { bubbles: true, button: 0, cancelable: true })

    document.querySelector('.bili-video-card__cover span')?.dispatchEvent(click)

    expect(click.defaultPrevented).toBe(true)
    expect(document.title).toContain('__BILIMI_OPEN_IN_TAB__:')
    expect(document.title).toContain(encodeURIComponent('https://www.bilibili.com/video/BV1card'))
    expect(window.open).not.toHaveBeenCalled()
  })

  it('does not treat broad feed containers as a single clickable video card', () => {
    document.body.innerHTML = `
      <main class="feed-card">
        <a href="https://www.bilibili.com/">home</a>
        <section class="recommend-grid">
          <article>
            <button type="button"><span>refresh this slot</span></button>
            <a href="https://www.bilibili.com/video/BV1inside">video</a>
          </article>
        </section>
      </main>
    `

    window.eval(buildOpenVideoLinksInAppScript())
    const click = new MouseEvent('click', { bubbles: true, button: 0, cancelable: true })

    document.querySelector('button span')?.dispatchEvent(click)

    expect(click.defaultPrevented).toBe(false)
    expect(document.title).not.toContain('__BILIMI_OPEN_IN_TAB__:')
    expect(window.open).not.toHaveBeenCalled()
  })

  it('signals selected bilibili page interactions without blocking the original click', () => {
    document.body.innerHTML = '<button type="button" aria-label="点赞"><span>点赞</span></button>'

    window.eval(buildOpenVideoLinksInAppScript())
    const click = new MouseEvent('click', { bubbles: true, button: 0, cancelable: true })

    document.querySelector('button span')?.dispatchEvent(click)

    expect(click.defaultPrevented).toBe(false)
    expect(document.title).toContain('__BILIMI_PET_HINT__:')
    expect(document.title).toContain(encodeURIComponent('小咪看到主人点赞啦，喜欢就要亮出来～'))
  })
})
