import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BiliWebview } from './BiliWebview'

describe('BiliWebview', () => {
  it('waits for dom-ready before reading the guest webContents id', () => {
    const onTargetState = vi.fn()
    const getWebContentsId = vi.fn(() => {
      throw new Error('The WebView must be attached to the DOM and the dom-ready event emitted before this method can be called.')
    })
    Object.defineProperty(HTMLElement.prototype, 'getWebContentsId', {
      configurable: true,
      value: getWebContentsId
    })

    try {
      expect(() => render(
        <BiliWebview active tabId="home" url="https://www.bilibili.com" onTargetState={onTargetState} />
      )).not.toThrow()
      expect(getWebContentsId).not.toHaveBeenCalled()

      getWebContentsId.mockImplementation(() => 101)
      const webview = document.getElementById('bilimi-webview') as Electron.WebviewTag
      act(() => webview.dispatchEvent(new Event('dom-ready')))

      expect(onTargetState).toHaveBeenCalledWith('home', expect.objectContaining({ webContentsId: 101 }))
    } finally {
      delete (HTMLElement.prototype as HTMLElement & { getWebContentsId?: () => number }).getWebContentsId
    }
  })

  it('reports a guest target that was already ready before its event listeners attached', async () => {
    const onTargetState = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'getWebContentsId', {
      configurable: true,
      value: () => 101
    })

    try {
      render(<BiliWebview active tabId="home" url="https://www.bilibili.com" onTargetState={onTargetState} />)

      await vi.waitFor(() => expect(onTargetState).toHaveBeenCalledWith('home', expect.objectContaining({
        webContentsId: 101,
        navigationEpoch: 0
      })))
    } finally {
      delete (HTMLElement.prototype as HTMLElement & { getWebContentsId?: () => number }).getWebContentsId
    }
  })

  it('increments its navigation epoch for same-url main-frame reloads but not subframes', () => {
    const onTargetState = vi.fn()
    render(<BiliWebview active tabId="home" url="https://www.bilibili.com" onTargetState={onTargetState} />)
    const webview = document.getElementById('bilimi-webview') as Electron.WebviewTag
    Object.assign(webview, { getWebContentsId: () => 101 })

    act(() => {
      webview.dispatchEvent(Object.assign(new Event('did-start-navigation'), { isMainFrame: false }))
      webview.dispatchEvent(Object.assign(new Event('did-start-navigation'), { isMainFrame: true }))
    })

    expect(onTargetState).toHaveBeenLastCalledWith('home', expect.objectContaining({
      webContentsId: 101,
      navigationEpoch: 1
    }))
  })

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

  it('seeks a newly opened archived video after its guest page finishes loading', () => {
    render(<BiliWebview active tabId="archive-video" url="https://www.bilibili.com/video/BV1archive?p=2" seekSeconds={95} />)

    const webview = document.querySelector('webview') as Electron.WebviewTag
    const executeJavaScript = vi.fn().mockResolvedValue(true)
    Object.assign(webview, { executeJavaScript })

    act(() => webview.dispatchEvent(new Event('did-finish-load')))

    expect(executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('currentTime = 95'), true)
  })

  it('waits for a new archived tab to finish loading before seeking', async () => {
    const { rerender } = render(
      <BiliWebview active tabId="archive-video" url="https://www.bilibili.com/video/BV1archive" />
    )
    const webview = document.querySelector('webview') as Electron.WebviewTag
    const executeJavaScript = vi.fn().mockResolvedValue(true)
    Object.assign(webview, { executeJavaScript })

    rerender(
      <BiliWebview active tabId="archive-video" url="https://www.bilibili.com/video/BV1archive" seekSeconds={12} />
    )
    await Promise.resolve()

    expect(executeJavaScript.mock.calls.map(([script]) => String(script)).join('\n')).not.toContain('currentTime = 12')

    act(() => webview.dispatchEvent(new Event('did-finish-load')))
    await waitFor(() => expect(executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('currentTime = 12'), true))
  })

  it('seeks a new archived timestamp immediately when an already-loaded tab receives it', async () => {
    const { rerender } = render(
      <BiliWebview active tabId="archive-video" url="https://www.bilibili.com/video/BV1archive" seekSeconds={12} />
    )
    const webview = document.querySelector('webview') as Electron.WebviewTag
    const executeJavaScript = vi.fn().mockResolvedValue(true)
    Object.assign(webview, { executeJavaScript })

    act(() => webview.dispatchEvent(new Event('did-finish-load')))
    await waitFor(() => expect(executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('currentTime = 12'), true))

    rerender(
      <BiliWebview active tabId="archive-video" url="https://www.bilibili.com/video/BV1archive" seekSeconds={48} />
    )

    await waitFor(() => expect(executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('currentTime = 48'), true))
    expect(document.querySelectorAll('webview')).toHaveLength(1)
  })

  it('does not let a stale CID selection seek after a newer archived timestamp arrives', async () => {
    let resolveFirstPartSelection: ((value: { status: 'ready' }) => void) | undefined
    const { rerender } = render(
      <BiliWebview
        active
        tabId="archive-video"
        url="https://www.bilibili.com/video/BV1archive"
        seekSeconds={12}
        seekAid={7}
        seekCid={71}
      />
    )
    const webview = document.querySelector('webview') as Electron.WebviewTag
    const executeJavaScript = vi.fn((script: string) => {
      if (script.includes('__bilimiSelectArchivedVideoPart') && script.includes('71')) {
        return new Promise((resolve) => { resolveFirstPartSelection = resolve })
      }
      return Promise.resolve({ status: 'ready' })
    })
    Object.assign(webview, { executeJavaScript })

    act(() => webview.dispatchEvent(new Event('did-finish-load')))
    await waitFor(() => expect(resolveFirstPartSelection).toBeTypeOf('function'))

    rerender(
      <BiliWebview
        active
        tabId="archive-video"
        url="https://www.bilibili.com/video/BV1archive"
        seekSeconds={48}
        seekAid={7}
        seekCid={72}
      />
    )
    resolveFirstPartSelection?.({ status: 'ready' })

    await waitFor(() => expect(executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('currentTime = 48'), true))
    expect(executeJavaScript.mock.calls.map(([script]) => String(script)).join('\n')).not.toContain('currentTime = 12')
  })

  it('confirms the archived CID part before seeking its timeline timestamp', async () => {
    render(
      <BiliWebview
        active
        tabId="archive-video"
        url="https://www.bilibili.com/video/BV1archive"
        seekSeconds={95}
        seekAid={123}
        seekCid={456}
      />
    )

    const webview = document.querySelector('webview') as Electron.WebviewTag
    const executeJavaScript = vi.fn().mockResolvedValue({ status: 'ready' })
    Object.assign(webview, { executeJavaScript })

    act(() => webview.dispatchEvent(new Event('did-finish-load')))

    await waitFor(() => expect(executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('__bilimiSelectArchivedVideoPart'),
      true
    ))
    const scripts = executeJavaScript.mock.calls.map(([script]) => String(script))
    const partSelectionIndex = scripts.findIndex((script) => script.includes('__bilimiSelectArchivedVideoPart'))
    const timestampSeekIndex = scripts.findIndex((script) => script.includes('currentTime = 95'))

    expect(partSelectionIndex).toBeGreaterThanOrEqual(0)
    expect(timestampSeekIndex).toBeGreaterThan(partSelectionIndex)
  })

  it('waits for the CID part navigation to finish before seeking', async () => {
    render(
      <BiliWebview
        active
        tabId="archive-video"
        url="https://www.bilibili.com/video/BV1archive"
        seekSeconds={95}
        seekAid={123}
        seekCid={456}
      />
    )

    const webview = document.querySelector('webview') as Electron.WebviewTag
    const executeJavaScript = vi.fn((script: string) => Promise.resolve(
      script.includes('__bilimiSelectArchivedVideoPart')
        ? { status: 'navigating' }
        : true
    ))
    Object.assign(webview, { executeJavaScript })

    act(() => webview.dispatchEvent(new Event('did-finish-load')))

    await waitFor(() => expect(executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('__bilimiSelectArchivedVideoPart'),
      true
    ))
    expect(executeJavaScript.mock.calls.map(([script]) => String(script)).join('\n')).not.toContain('currentTime = 95')
  })

  it('does not interact with the archived player for an invalid timeline timestamp', async () => {
    render(
      <BiliWebview
        active
        tabId="archive-video"
        url="https://www.bilibili.com/video/BV1archive"
        seekSeconds={Number.NaN}
        seekAid={123}
        seekCid={456}
      />
    )

    const webview = document.querySelector('webview') as Electron.WebviewTag
    const executeJavaScript = vi.fn().mockResolvedValue(true)
    Object.assign(webview, { executeJavaScript })

    act(() => webview.dispatchEvent(new Event('did-finish-load')))
    await Promise.resolve()

    const scripts = executeJavaScript.mock.calls.map(([script]) => String(script)).join('\n')
    expect(scripts).not.toContain('__bilimiSelectArchivedVideoPart')
    expect(scripts).not.toContain('currentTime =')
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

  it('does not inject the retired danmaku wake script while preserving video navigation', async () => {
    render(<BiliWebview active tabId="home" url="https://www.bilibili.com" />)

    const webview = document.getElementById('bilimi-webview') as Electron.WebviewTag
    const executeJavaScript = vi.fn().mockResolvedValue(true)
    Object.assign(webview, { executeJavaScript })

    act(() => {
      webview.dispatchEvent(
        new CustomEvent('did-navigate', {
          detail: {
            url: 'https://www.bilibili.com/video/BV1danmaku'
          }
        })
      )
      webview.dispatchEvent(new Event('did-finish-load'))
    })

    await Promise.resolve()
    expect(executeJavaScript.mock.calls.map(([source]) => String(source)).join('\n')).not.toContain('__bilimiWakeBilibiliDanmakuAfterVideoLoad')
  })

  it('suppresses resize repaint during a host resize session and corrects once after it ends', async () => {
    vi.useFakeTimers()
    const originalResizeObserver = globalThis.ResizeObserver
    let resizeCallback: ResizeObserverCallback | undefined
    class ResizeObserverMock implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) { resizeCallback = callback }
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }
    globalThis.ResizeObserver = ResizeObserverMock

    try {
      const view = render(<BiliWebview active tabId="home" url="https://www.bilibili.com" />)
      const webview = document.getElementById('bilimi-webview') as Electron.WebviewTag
      const executeJavaScript = vi.fn().mockResolvedValue(true)
      Object.assign(webview, { executeJavaScript })

      act(() => {
        view.rerender(<BiliWebview active hostResizePaused tabId="home" url="https://www.bilibili.com" />)
      })
      executeJavaScript.mockClear()
      act(() => {
        resizeCallback?.([], {} as ResizeObserver)
        vi.runAllTimers()
      })
      expect(executeJavaScript).not.toHaveBeenCalled()

      view.rerender(<BiliWebview active hostResizePaused={false} tabId="home" url="https://www.bilibili.com" />)
      act(() => { vi.runAllTimers() })
      expect(executeJavaScript).toHaveBeenCalledTimes(1)
    } finally {
      globalThis.ResizeObserver = originalResizeObserver
      vi.useRealTimers()
    }
  })

  it('cancels an older correction when another host resize session starts immediately', () => {
    vi.useFakeTimers()
    const view = render(<BiliWebview active hostResizePaused tabId="home" url="https://www.bilibili.com" />)
    const webview = document.getElementById('bilimi-webview') as Electron.WebviewTag
    const executeJavaScript = vi.fn().mockResolvedValue(true)
    Object.assign(webview, { executeJavaScript })

    view.rerender(<BiliWebview active hostResizePaused={false} tabId="home" url="https://www.bilibili.com" />)
    view.rerender(<BiliWebview active hostResizePaused tabId="home" url="https://www.bilibili.com" />)
    act(() => { vi.runAllTimers() })
    expect(executeJavaScript).not.toHaveBeenCalled()

    view.rerender(<BiliWebview active hostResizePaused={false} tabId="home" url="https://www.bilibili.com" />)
    act(() => { vi.runAllTimers() })
    expect(executeJavaScript).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('keeps HTML fullscreen events without injecting the retired danmaku wake script', async () => {
    render(<BiliWebview active tabId="home" url="https://www.bilibili.com/video/BV1danmaku" />)

    const webview = document.getElementById('bilimi-webview') as Electron.WebviewTag
    const executeJavaScript = vi.fn().mockResolvedValue(true)
    Object.assign(webview, { executeJavaScript })

    act(() => {
      webview.dispatchEvent(new Event('leave-html-full-screen'))
    })

    await Promise.resolve()
    expect(executeJavaScript.mock.calls.map(([source]) => String(source)).join('\n')).not.toContain('__bilimiWakeBilibiliDanmakuAfterVideoLoad')
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

  it('does not rebind guest event listeners when unrelated host callbacks change', () => {
    const firstHint = vi.fn()
    const { rerender } = render(
      <BiliWebview active tabId="home" url="https://www.bilibili.com/video/BV1stable" onPageInteractionHint={firstHint} />
    )
    const webview = document.getElementById('bilimi-webview') as Electron.WebviewTag
    const addEventListener = vi.spyOn(webview, 'addEventListener')
    const removeEventListener = vi.spyOn(webview, 'removeEventListener')

    rerender(
      <BiliWebview active tabId="home" url="https://www.bilibili.com/video/BV1stable" onPageInteractionHint={vi.fn()} />
    )

    expect(addEventListener).not.toHaveBeenCalled()
    expect(removeEventListener).not.toHaveBeenCalled()
  })

  it('shows a recoverable error card for ERR_PROXY_CONNECTION_FAILED', () => {
    render(<BiliWebview active tabId="home" url="https://www.bilibili.com" />)
    const webview = document.getElementById('bilimi-webview') as Electron.WebviewTag
    const reload = vi.fn()
    Object.assign(webview, { reload })

    act(() => {
      webview.dispatchEvent(Object.assign(new Event('did-fail-load'), {
        errorCode: -130,
        errorDescription: 'ERR_PROXY_CONNECTION_FAILED',
        isMainFrame: true
      }))
    })

    expect(screen.getByRole('heading', { name: '系统代理连接失败' })).toBeInTheDocument()
    expect(screen.getByText(/bilimi 默认跟随 Windows 系统网络设置/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    expect(reload).toHaveBeenCalledOnce()
  })

  it('retries the shared Bilibili session directly only after explicit confirmation', async () => {
    const retryBilibiliSessionDirect = vi.fn().mockResolvedValue({ mode: 'direct' as const })
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: { retryBilibiliSessionDirect }
    })
    render(<BiliWebview active tabId="home" url="https://www.bilibili.com" />)
    const webview = document.getElementById('bilimi-webview') as Electron.WebviewTag
    const reload = vi.fn()
    Object.assign(webview, { reload })
    act(() => {
      webview.dispatchEvent(Object.assign(new Event('did-fail-load'), {
        errorCode: -130,
        errorDescription: 'ERR_PROXY_CONNECTION_FAILED',
        isMainFrame: true
      }))
    })

    expect(retryBilibiliSessionDirect).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '本次直连重试' }))

    await waitFor(() => expect(retryBilibiliSessionDirect).toHaveBeenCalledOnce())
    expect(reload).not.toHaveBeenCalled()
  })

  it('does not mistake non-proxy load failures or subframes for a proxy failure', () => {
    render(<BiliWebview active tabId="home" url="https://www.bilibili.com" />)
    const webview = document.getElementById('bilimi-webview') as Electron.WebviewTag
    const reload = vi.fn()
    Object.assign(webview, { reload })

    act(() => {
      webview.dispatchEvent(Object.assign(new Event('did-fail-load'), {
        errorCode: -105,
        errorDescription: 'ERR_NAME_NOT_RESOLVED',
        isMainFrame: true
      }))
      webview.dispatchEvent(Object.assign(new Event('did-fail-load'), {
        errorCode: -130,
        errorDescription: 'ERR_PROXY_CONNECTION_FAILED',
        isMainFrame: false
      }))
    })

    expect(screen.queryByRole('heading', { name: '系统代理连接失败' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'B 站页面加载失败' })).toBeInTheDocument()
    expect(screen.getByText(/ERR_NAME_NOT_RESOLVED/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新加载 B 站页面' }))
    expect(reload).toHaveBeenCalledOnce()
  })
})
