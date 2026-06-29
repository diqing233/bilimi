import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BiliWebview } from './BiliWebview'

describe('BiliWebview', () => {
  it('installs video link capture when the guest page is ready', () => {
    render(<BiliWebview active tabId="home" url="https://www.bilibili.com" />)

    const webview = document.getElementById('bilimi-webview') as Electron.WebviewTag
    const executeJavaScript = vi.fn().mockResolvedValue(true)

    Object.assign(webview, { executeJavaScript })

    act(() => {
      webview.dispatchEvent(new Event('dom-ready'))
    })

    expect(executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('__BILIMI_OPEN_IN_TAB__'), true)
  })

  it('opens in-app tabs from video link title signals', () => {
    const onOpenInTab = vi.fn()

    render(
      <BiliWebview
        active
        tabId="home"
        url="https://www.bilibili.com"
        onOpenInTab={onOpenInTab}
      />
    )

    const webview = document.getElementById('bilimi-webview') as Electron.WebviewTag

    act(() => {
      webview.dispatchEvent(
        new CustomEvent('page-title-updated', {
          detail: {
            title: `__BILIMI_OPEN_IN_TAB__:${encodeURIComponent(
              'https://www.bilibili.com/video/BV1title'
            )}`
          }
        })
      )
    })

    expect(onOpenInTab).toHaveBeenCalledWith('https://www.bilibili.com/video/BV1title')
  })

  it('reports 小咪 hints from bilibili interaction title signals', () => {
    const onPageInteractionHint = vi.fn()

    render(
      <BiliWebview
        active
        tabId="home"
        url="https://www.bilibili.com"
        onPageInteractionHint={onPageInteractionHint}
      />
    )

    const webview = document.getElementById('bilimi-webview') as Electron.WebviewTag

    act(() => {
      webview.dispatchEvent(
        new CustomEvent('page-title-updated', {
          detail: {
            title: `__BILIMI_PET_HINT__:${encodeURIComponent('小咪看到主人点赞啦～')}`
          }
        })
      )
    })

    expect(onPageInteractionHint).toHaveBeenCalledWith('小咪看到主人点赞啦～')
  })

  it('reports HTML fullscreen changes from the embedded video page', () => {
    const onHtmlFullscreenChange = vi.fn()

    render(
      <BiliWebview
        active
        tabId="home"
        url="https://www.bilibili.com"
        onHtmlFullscreenChange={onHtmlFullscreenChange}
      />
    )

    const webview = document.getElementById('bilimi-webview') as Electron.WebviewTag

    act(() => {
      webview.dispatchEvent(new Event('enter-html-full-screen'))
      webview.dispatchEvent(new Event('leave-html-full-screen'))
    })

    expect(onHtmlFullscreenChange).toHaveBeenNthCalledWith(1, 'home', true)
    expect(onHtmlFullscreenChange).toHaveBeenNthCalledWith(2, 'home', false)
  })

  it('nudges the guest video page to repaint after host size changes', async () => {
    const originalResizeObserver = globalThis.ResizeObserver
    const observedElements: Element[] = []
    let resizeCallback: ResizeObserverCallback | undefined
    class ResizeObserverMock implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback
      }

      observe = vi.fn((target: Element) => {
        observedElements.push(target)
      })

      unobserve = vi.fn()
      disconnect = vi.fn()
    }
    globalThis.ResizeObserver = ResizeObserverMock

    try {
      render(<BiliWebview active tabId="home" url="https://www.bilibili.com" />)

      const webview = document.getElementById('bilimi-webview') as Electron.WebviewTag
      const executeJavaScript = vi.fn().mockResolvedValue(true)
      Object.assign(webview, { executeJavaScript })

      expect(observedElements).toContain(webview)

      act(() => {
        resizeCallback?.([], {} as ResizeObserver)
      })

      await vi.waitFor(() =>
        expect(executeJavaScript).toHaveBeenCalledWith(
          expect.stringContaining('__bilimiRepaintVideoAfterHostResize'),
          true
        )
      )
    } finally {
      globalThis.ResizeObserver = originalResizeObserver
    }
  })

  it('does not drive the webview src from later location updates', () => {
    const { rerender } = render(
      <BiliWebview active tabId="home" url="https://www.bilibili.com/video/BV1initial" />
    )

    const webview = document.getElementById('bilimi-webview') as Electron.WebviewTag

    expect(webview).toHaveAttribute('src', 'https://www.bilibili.com/video/BV1initial')

    rerender(<BiliWebview active tabId="home" url="https://www.bilibili.com/video/BV1navigated" />)

    expect(webview).toHaveAttribute('src', 'https://www.bilibili.com/video/BV1initial')
  })
})
