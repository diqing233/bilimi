import { describe, expect, it, vi } from 'vitest'
import { refreshBilibiliFavoriteSpacePages, refreshBilibiliGuestPages } from './bilibiliSessionRefresh'

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

  it('reloads only the current account favorite-space page after a confirmed folder mutation', async () => {
    const currentFavorites = createGuestPage('https://space.bilibili.com/100/favlist?fid=42', 'persist:bilimi')
    const currentHome = createGuestPage('https://space.bilibili.com/100', 'persist:bilimi')
    const video = createGuestPage('https://www.bilibili.com/video/BV1test', 'persist:bilimi')
    const anotherAccount = createGuestPage('https://space.bilibili.com/200/favlist', 'persist:bilimi')
    const targetSession = {}
    for (const guest of [currentFavorites, currentHome, video, anotherAccount]) guest.page.session = targetSession

    const refresh = refreshBilibiliFavoriteSpacePages({
      getAllWebContents: () => [currentFavorites.page, currentHome.page, video.page, anotherAccount.page],
      targetSession, accountMid: '100', timeoutMs: 1_000
    })

    expect(currentFavorites.reloadIgnoringCache).toHaveBeenCalledOnce()
    expect(currentHome.reloadIgnoringCache).not.toHaveBeenCalled()
    expect(video.reloadIgnoringCache).not.toHaveBeenCalled()
    expect(anotherAccount.reloadIgnoringCache).not.toHaveBeenCalled()
    currentFavorites.finishLoad()

    await expect(refresh).resolves.toEqual({ requested: 1, completed: 1 })
  })

  it('coalesces overlapping favorite-space refreshes for the same account', async () => {
    const favorites = createGuestPage('https://space.bilibili.com/100/favlist', 'persist:bilimi')
    const targetSession = {}
    favorites.page.session = targetSession
    const options = { getAllWebContents: () => [favorites.page], targetSession, accountMid: '100', timeoutMs: 1_000 }

    const first = refreshBilibiliFavoriteSpacePages(options)
    const second = refreshBilibiliFavoriteSpacePages(options)

    expect(first).toBe(second)
    expect(favorites.reloadIgnoringCache).toHaveBeenCalledOnce()
    favorites.finishLoad()
    await expect(first).resolves.toEqual({ requested: 1, completed: 1 })
  })

  it('does not reload a page that left the current account favorite space before its reload begins', async () => {
    const favorites = createGuestPage('https://space.bilibili.com/100/favlist', 'persist:bilimi')
    const targetSession = {}
    favorites.page.session = targetSession
    vi.spyOn(favorites.page, 'getURL')
      .mockReturnValueOnce('https://space.bilibili.com/100/favlist')
      .mockReturnValue('https://www.bilibili.com/video/BV1test')

    await expect(refreshBilibiliFavoriteSpacePages({
      getAllWebContents: () => [favorites.page],
      targetSession,
      accountMid: '100',
      timeoutMs: 1_000
    })).resolves.toEqual({ requested: 0, completed: 0 })

    expect(favorites.reloadIgnoringCache).not.toHaveBeenCalled()
  })

  it('reports a failed current-account favorite-space reload for retry instead of counting it as complete', async () => {
    const favorites = createGuestPage('https://space.bilibili.com/100/favlist', 'persist:bilimi')
    const targetSession = {}
    favorites.page.session = targetSession

    const refresh = refreshBilibiliFavoriteSpacePages({
      getAllWebContents: () => [favorites.page],
      targetSession,
      accountMid: '100',
      timeoutMs: 1_000
    })

    favorites.failLoad()

    await expect(refresh).resolves.toEqual({ requested: 1, completed: 0, failed: 1 })
  })

  it('removes the exact load listeners after a favorite-space reload settles', async () => {
    const favorites = createGuestPage('https://space.bilibili.com/100/favlist', 'persist:bilimi')
    const targetSession = {}
    favorites.page.session = targetSession

    const refresh = refreshBilibiliFavoriteSpacePages({
      getAllWebContents: () => [favorites.page],
      targetSession, accountMid: '100', timeoutMs: 1_000
    })
    favorites.failLoad()
    await refresh

    const listenerFor = (event: 'did-finish-load' | 'did-fail-load' | 'destroyed') =>
      favorites.page.once.mock.calls.find(([registeredEvent]) => registeredEvent === event)?.[1]
    expect(favorites.page.removeListener).toHaveBeenCalledWith('did-finish-load', listenerFor('did-finish-load'))
    expect(favorites.page.removeListener).toHaveBeenCalledWith('did-fail-load', listenerFor('did-fail-load'))
    expect(favorites.page.removeListener).toHaveBeenCalledWith('destroyed', listenerFor('destroyed'))
  })
})

function createGuestPage(url: string, partition: string) {
  let finishLoad: (() => void) | undefined
  let failLoad: (() => void) | undefined
  let destroyed: (() => void) | undefined
  const reloadIgnoringCache = vi.fn()
  const page = {
    getType: () => partition ? 'webview' : 'window',
    getURL: () => url,
    isDestroyed: () => false,
    session: partition ? {} : null,
    once: vi.fn((event: 'did-finish-load' | 'did-fail-load' | 'destroyed', callback: () => void) => {
      if (event === 'did-finish-load') finishLoad = callback
      if (event === 'did-fail-load') failLoad = callback
      if (event === 'destroyed') destroyed = callback
    }),
    removeListener: vi.fn(),
    reloadIgnoringCache
  }
  return {
    page,
    reloadIgnoringCache,
    finishLoad: () => finishLoad?.(),
    failLoad: () => failLoad?.(),
    destroy: () => destroyed?.()
  }
}
