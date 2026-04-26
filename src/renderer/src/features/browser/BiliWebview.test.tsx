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
})
