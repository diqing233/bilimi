import { describe, expect, it, vi } from 'vitest'
import { refreshBilibiliGuestPages } from './bilibiliSessionRefresh'

describe('refreshBilibiliGuestPages', () => {
  it('reloads every Bilibili guest directly and waits for each page to finish loading', async () => {
    const first = createGuestPage('https://www.bilibili.com/', 'persist:bilimi')
    const second = createGuestPage('https://www.bilibili.com/video/BV1test', 'persist:bilimi')
    const unrelated = createGuestPage('file:///renderer/index.html', '')

    const targetSession = {}
    first.page.session = targetSession
    second.page.session = targetSession
    const refresh = refreshBilibiliGuestPages({
      getAllWebContents: () => [first.page, unrelated.page, second.page],
      targetSession,
      timeoutMs: 1_000
    })

    expect(first.reloadIgnoringCache).toHaveBeenCalledOnce()
    expect(second.reloadIgnoringCache).toHaveBeenCalledOnce()
    expect(unrelated.reloadIgnoringCache).not.toHaveBeenCalled()

    first.finishLoad()
    second.finishLoad()

    await expect(refresh).resolves.toEqual({ requested: 2, completed: 2 })
  })

  it('does not block cleanup completion when a guest is destroyed during reload', async () => {
    const guest = createGuestPage('https://www.bilibili.com/', 'persist:bilimi')
    const targetSession = {}
    guest.page.session = targetSession
    const refresh = refreshBilibiliGuestPages({
      getAllWebContents: () => [guest.page],
      targetSession,
      timeoutMs: 1_000
    })

    guest.destroy()

    await expect(refresh).resolves.toEqual({ requested: 1, completed: 1 })
  })
})

function createGuestPage(url: string, partition: string) {
  let finishLoad: (() => void) | undefined
  let destroyed: (() => void) | undefined
  const reloadIgnoringCache = vi.fn()
  const page = {
    getType: () => partition ? 'webview' : 'window',
    getURL: () => url,
    isDestroyed: () => false,
    session: partition ? {} : null,
    once: vi.fn((event: 'did-finish-load' | 'did-fail-load' | 'destroyed', callback: () => void) => {
      if (event === 'did-finish-load') finishLoad = callback
      if (event === 'destroyed') destroyed = callback
    }),
    removeListener: vi.fn(),
    reloadIgnoringCache
  }
  return {
    page,
    reloadIgnoringCache,
    finishLoad: () => finishLoad?.(),
    destroy: () => destroyed?.()
  }
}
