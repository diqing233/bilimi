import { describe, expect, it, vi } from 'vitest'
import { FavoriteRepositoryRuntimePageBridgeManager } from './favoriteRepositoryRuntimePageBridge'

const target = { webContentsId: 101, instanceId: 'webview-a', navigationEpoch: 3 }
const input = { accountMid: '100', operationKey: 'run-1:append-1', aid: 42, folderIds: ['11'] }

describe('FavoriteRepositoryRuntimePageBridgeManager', () => {
  it('requires an explicit account-scoped binding before a page operation', async () => {
    const request = vi.fn()
    const manager = new FavoriteRepositoryRuntimePageBridgeManager(request)

    await expect(manager.pageBridge('100', 'run-1').append(input)).rejects.toThrow('target is unavailable')
    expect(request).not.toHaveBeenCalled()
  })

  it('binds and routes only the descriptor returned for that account and run', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100' })
    const manager = new FavoriteRepositoryRuntimePageBridgeManager(request)

    await manager.bind('100', 'run-1')
    await expect(manager.pageBridge('100', 'run-1').append(input)).resolves.toEqual({ observedAccountMid: '100' })
    expect(request).toHaveBeenLastCalledWith({
      type: 'favorite-repository-page-operation', accountMid: '100', runId: 'run-1', target, action: 'append', input
    })
  })

  it('routes a global Bilibili unfavorite only through an explicitly bound page target', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100' })
    const manager = new FavoriteRepositoryRuntimePageBridgeManager(request)

    await manager.bind('100', 'unfavorite-1')
    await expect(manager.pageBridge('100', 'unfavorite-1').unfavorite({
      accountMid: '100', operationKey: 'unfavorite-1:42', aid: 42
    })).resolves.toEqual({ observedAccountMid: '100' })

    expect(request).toHaveBeenLastCalledWith({
      type: 'favorite-repository-page-operation', accountMid: '100', runId: 'unfavorite-1', target,
      action: 'unfavorite', input: { accountMid: '100', operationKey: 'unfavorite-1:42', aid: 42 }
    })
  })

  it('isolates same run ids across accounts and rejects an account-changed result', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '200', target: { ...target, webContentsId: 202 } })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '200' })
      .mockResolvedValueOnce({ status: 'ok', observedAccountMid: '200' })
    const manager = new FavoriteRepositoryRuntimePageBridgeManager(request)
    await manager.bind('100', 'run-1')
    await manager.bind('200', 'run-1')

    await expect(manager.pageBridge('100', 'run-1').append(input)).rejects.toThrow('account changed')
    await expect(manager.pageBridge('200', 'run-1').append({ ...input, accountMid: '200' })).resolves.toEqual({ observedAccountMid: '200' })
  })

  it('does not preserve a binding after release or accept an unknown bind result', async () => {
    const request = vi.fn().mockResolvedValueOnce({ status: 'ok', observedAccountMid: '100', target })
    const manager = new FavoriteRepositoryRuntimePageBridgeManager(request)
    await manager.bind('100', 'run-1')
    manager.release('100', 'run-1')
    await expect(manager.pageBridge('100', 'run-1').append(input)).rejects.toThrow('target is unavailable')

    const unavailable = new FavoriteRepositoryRuntimePageBridgeManager(vi.fn().mockResolvedValue({
      status: 'unknown', observedAccountMid: '', reason: 'target-unavailable'
    }))
    await expect(unavailable.bind('100', 'run-2')).rejects.toThrow('target-unavailable')
  })
})
