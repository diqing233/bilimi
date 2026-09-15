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

    const nativeOpen = window.open
    window.eval(buildOpenVideoLinksInAppScript())
    const click = new MouseEvent('click', { bubbles: true, button: 0, cancelable: true })

    document.querySelector('span')?.dispatchEvent(click)

    expect(click.defaultPrevented).toBe(true)
    expect(document.title).toContain('__BILIMI_OPEN_IN_TAB__:')
    expect(document.title).toContain(encodeURIComponent('https://www.bilibili.com/video/BV1click'))
    expect(nativeOpen).not.toHaveBeenCalled()
  })

  it('opens bilibili navigation links in a new app tab', () => {
    document.body.innerHTML = '<a href="https://www.bilibili.com/read/cv123"><span>open article</span></a>'

    const nativeOpen = window.open
    window.eval(buildOpenVideoLinksInAppScript())
    const click = new MouseEvent('click', { bubbles: true, button: 0, cancelable: true })

    document.querySelector('span')?.dispatchEvent(click)

    expect(click.defaultPrevented).toBe(true)
    expect(document.title).toContain('__BILIMI_OPEN_IN_TAB__:')
    expect(document.title).toContain(encodeURIComponent('https://www.bilibili.com/read/cv123'))
    expect(nativeOpen).not.toHaveBeenCalled()
  })

  it('opens bilibili video links when clicking card chrome outside the anchor', () => {
    document.body.innerHTML = `
      <div class="bili-video-card">
        <div class="bili-video-card__cover"><span>cover chrome</span></div>
        <a href="https://www.bilibili.com/video/BV1card">open video</a>
      </div>
    `

    const nativeOpen = window.open
    window.eval(buildOpenVideoLinksInAppScript())
    const click = new MouseEvent('click', { bubbles: true, button: 0, cancelable: true })

    document.querySelector('.bili-video-card__cover span')?.dispatchEvent(click)

    expect(click.defaultPrevented).toBe(true)
    expect(document.title).toContain('__BILIMI_OPEN_IN_TAB__:')
    expect(document.title).toContain(encodeURIComponent('https://www.bilibili.com/video/BV1card'))
    expect(nativeOpen).not.toHaveBeenCalled()
  })

  it('opens target blank links in a new app tab', () => {
    document.body.innerHTML =
      '<a href="https://example.com/docs" target="_blank"><span>open docs</span></a>'

    const nativeOpen = window.open
    window.eval(buildOpenVideoLinksInAppScript())
    const click = new MouseEvent('click', { bubbles: true, button: 0, cancelable: true })

    document.querySelector('span')?.dispatchEvent(click)

    expect(click.defaultPrevented).toBe(true)
    expect(document.title).toContain('__BILIMI_OPEN_IN_TAB__:')
    expect(document.title).toContain(encodeURIComponent('https://example.com/docs'))
    expect(nativeOpen).not.toHaveBeenCalled()
  })

  it('opens window.open URLs in a new app tab', () => {
    window.eval(buildOpenVideoLinksInAppScript())

    const opened = window.open('https://example.com/popup')

    expect(opened).toBeNull()
    expect(document.title).toContain('__BILIMI_OPEN_IN_TAB__:')
    expect(document.title).toContain(encodeURIComponent('https://example.com/popup'))
  })

  it('opens deferred window.open location assignments in a new app tab', () => {
    window.eval(buildOpenVideoLinksInAppScript())

    const opened = window.open('', '_blank')
    opened!.location.href = 'https://example.com/deferred'

    expect(opened).not.toBeNull()
    expect(document.title).toContain('__BILIMI_OPEN_IN_TAB__:')
    expect(document.title).toContain(encodeURIComponent('https://example.com/deferred'))
  })

  it('opens target blank form submissions in a new app tab', () => {
    document.body.innerHTML = `
      <form action="https://search.bilibili.com/all" target="_blank">
        <input name="keyword" value="米哈游老板娘" />
        <input name="from_source" value="webtop_search" />
      </form>
    `

    window.eval(buildOpenVideoLinksInAppScript())
    const submit = new Event('submit', { bubbles: true, cancelable: true })

    document.querySelector('form')?.dispatchEvent(submit)

    expect(submit.defaultPrevented).toBe(true)
    expect(document.title).toContain('__BILIMI_OPEN_IN_TAB__:')
    expect(document.title).toContain(
      encodeURIComponent(
        'https://search.bilibili.com/all?keyword=%E7%B1%B3%E5%93%88%E6%B8%B8%E8%80%81%E6%9D%BF%E5%A8%98&from_source=webtop_search'
      )
    )
  })

  it('opens the bilibili header search button in a new app tab', () => {
    document.body.innerHTML = `
      <div class="nav-search">
        <input class="nav-search-input" value="米哈游老板娘" />
        <button class="nav-search-btn" type="button">搜索</button>
      </div>
    `

    window.eval(buildOpenVideoLinksInAppScript())
    const click = new MouseEvent('click', { bubbles: true, button: 0, cancelable: true })

    document.querySelector('.nav-search-btn')?.dispatchEvent(click)

    expect(click.defaultPrevented).toBe(true)
    expect(document.title).toContain('__BILIMI_OPEN_IN_TAB__:')
    expect(document.title).toContain(
      encodeURIComponent('https://search.bilibili.com/all?keyword=%E7%B1%B3%E5%93%88%E6%B8%B8%E8%80%81%E6%9D%BF%E5%A8%98')
    )
  })

  it('opens the bilibili header search input on Enter in a new app tab', () => {
    document.body.innerHTML = `
      <div class="nav-search">
        <input class="nav-search-input" value="米哈游老板娘" />
        <button class="nav-search-btn" type="button">搜索</button>
      </div>
    `

    window.eval(buildOpenVideoLinksInAppScript())
    const enter = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter'
    })

    document.querySelector('.nav-search-input')?.dispatchEvent(enter)

    expect(enter.defaultPrevented).toBe(true)
    expect(document.title).toContain('__BILIMI_OPEN_IN_TAB__:')
    expect(document.title).toContain(
      encodeURIComponent('https://search.bilibili.com/all?keyword=%E7%B1%B3%E5%93%88%E6%B8%B8%E8%80%81%E6%9D%BF%E5%A8%98')
    )
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

    const nativeOpen = window.open
    window.eval(buildOpenVideoLinksInAppScript())
    const click = new MouseEvent('click', { bubbles: true, button: 0, cancelable: true })

    document.querySelector('button span')?.dispatchEvent(click)

    expect(click.defaultPrevented).toBe(false)
    expect(document.title).not.toContain('__BILIMI_OPEN_IN_TAB__:')
    expect(nativeOpen).not.toHaveBeenCalled()
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

  it('reminds the owner to review after the current video finishes once per page url', () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: new URL('https://www.bilibili.com/video/BV1finish')
    })
    document.body.innerHTML = '<video></video>'

    window.eval(buildOpenVideoLinksInAppScript())
    const video = document.querySelector('video') as HTMLVideoElement

    video.dispatchEvent(new Event('ended', { bubbles: true }))

    const firstTitle = document.title
    expect(firstTitle).toContain('__BILIMI_PET_HINT__:')
    expect(firstTitle).toContain(
      encodeURIComponent('视频看完啦，要不要去批阅一下？小咪陪主人收个尾。')
    )

    document.title = 'Bilimi'
    video.dispatchEvent(new Event('ended', { bubbles: true }))

    expect(document.title).toBe('Bilimi')
  })
})
