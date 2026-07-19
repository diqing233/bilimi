import { describe, expect, it, vi } from 'vitest'
import { createFavoriteRepositoryPageTarget } from './favoriteRepositoryPageTarget'

const input = { accountMid: '100', operationKey: 'run-1:append-1', aid: 42, folderIds: ['11'] }
const binding = { webContentsId: 101, instanceId: 'webview-a', navigationEpoch: 3 }

describe('favorite repository page target', () => {
  it('uses only the supplied target descriptor', async () => {
    const first = { getURL: () => 'https://www.bilibili.com/', executeJavaScript: vi.fn().mockResolvedValue({ status: 'ok', observedAccountMid: '100' }) }
    const second = { getURL: () => 'https://www.bilibili.com/', executeJavaScript: vi.fn() }
    const target = createFavoriteRepositoryPageTarget({
      findWebviewById: (id) => id === 101 ? first : id === 202 ? second : undefined,
      getNavigationEpoch: (id, instanceId) => id === 101 && instanceId === 'webview-a' ? 3 : undefined
    })

    await expect(target.run(binding, 'append', input)).resolves.toMatchObject({ status: 'ok' })
    expect(first.executeJavaScript).toHaveBeenCalledTimes(1)
    expect(second.executeJavaScript).not.toHaveBeenCalled()
  })

  it('returns unknown when target instance or navigation epoch changed, including same-url reload', async () => {
    const executeJavaScript = vi.fn()
    const target = createFavoriteRepositoryPageTarget({
      findWebviewById: () => ({ getURL: () => 'https://www.bilibili.com/favlist', executeJavaScript }),
      getNavigationEpoch: () => 4
    })

    await expect(target.run(binding, 'append', input)).resolves.toMatchObject({ status: 'unknown', reason: 'target-navigated' })
    expect(executeJavaScript).not.toHaveBeenCalled()
  })

  it('returns unknown when the target disappears or is loading', async () => {
    const missing = createFavoriteRepositoryPageTarget({ findWebviewById: () => undefined, getNavigationEpoch: () => undefined })
    await expect(missing.run(binding, 'append', input)).resolves.toMatchObject({ status: 'unknown', reason: 'target-unavailable' })

    const loading = createFavoriteRepositoryPageTarget({
      findWebviewById: () => ({ getURL: () => 'https://www.bilibili.com/', isLoading: () => true, executeJavaScript: vi.fn() }),
      getNavigationEpoch: () => 3
    })
    await expect(loading.run(binding, 'append', input)).resolves.toMatchObject({ status: 'unknown', reason: 'target-loading' })
  })

  it('drops a response if navigation changes during the atomic operation', async () => {
    let epoch = 3
    const target = createFavoriteRepositoryPageTarget({
      findWebviewById: () => ({
        getURL: () => 'https://www.bilibili.com/',
        executeJavaScript: vi.fn(async () => { epoch = 4; return { status: 'ok', observedAccountMid: '100' } })
      }),
      getNavigationEpoch: () => epoch
    })

    await expect(target.run(binding, 'append', input)).resolves.toMatchObject({ status: 'unknown', reason: 'target-navigated' })
  })
})
