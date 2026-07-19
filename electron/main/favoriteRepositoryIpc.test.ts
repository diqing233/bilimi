import { describe, expect, it, vi } from 'vitest'
import { registerFavoriteRepositoryIpc } from './favoriteRepositoryIpc'

class FakeIpcMain {
  handlers = new Map<string, (event: { sender: { id: number } }, ...args: never[]) => unknown>()

  handle(channel: string, handler: (event: { sender: { id: number } }, ...args: never[]) => unknown) {
    this.handlers.set(channel, handler)
  }

  invoke(channel: string, senderId: number, ...args: unknown[]) {
    return this.handlers.get(channel)?.({ sender: { id: senderId } }, ...args as never[])
  }
}

describe('registerFavoriteRepositoryIpc', () => {
  it('rejects every read and subscription for an account other than the current Bilibili account', async () => {
    const ipcMain = new FakeIpcMain()
    const service = {
      getSnapshot: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, videos: {} }),
      getFolderPage: vi.fn()
    }
    registerFavoriteRepositoryIpc({
      ipcMain,
      service: service as never,
      isTrustedSender: (senderId) => senderId === 7,
      getCurrentAccountMid: vi.fn().mockResolvedValue('101')
    })

    await expect(ipcMain.invoke('favorite-repository:open-account', 7, '100')).rejects.toThrow('current Bilibili account')
    await expect(ipcMain.invoke('favorite-repository:get-snapshot', 7, '100')).rejects.toThrow('current Bilibili account')
    await expect(ipcMain.invoke('favorite-repository:get-folder-page', 7, '100', 'folder-a', { limit: 1 })).rejects.toThrow('current Bilibili account')
    await expect(ipcMain.invoke('favorite-repository:search-page', 7, '100', 'video', { limit: 1 })).rejects.toThrow('current Bilibili account')
    await expect(ipcMain.invoke('favorite-repository:subscribe', 7, '100', 'folder-a')).rejects.toThrow('current Bilibili account')
    // Unsubscribe is deliberately allowed after an account switch so stale tokens can be removed.
    await expect(ipcMain.invoke('favorite-repository:unsubscribe', 7, '100', 'subscription-a')).resolves.toBe(false)
    expect(service.getSnapshot).not.toHaveBeenCalled()
    await expect(ipcMain.invoke('favorite-repository:open-account', 7, '')).rejects.toThrow('account is invalid')
    await expect(ipcMain.invoke('favorite-repository:open-account', 9, '100')).rejects.toThrow('untrusted renderer')
  })

  it('rejects a command when its account is not the current Bilibili account', async () => {
    const ipcMain = new FakeIpcMain()
    const service = { commit: vi.fn() }
    registerFavoriteRepositoryIpc({
      ipcMain,
      service: service as never,
      isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('101')
    })
    const command = {
      id: 'command-1', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-video' as const,
      payload: { aid: 1, title: 'video', tags: [], updatedAt: '2026-07-19T00:00:00.000Z' }
    }

    await expect(ipcMain.invoke('favorite-repository:commit-command', 7, '100', command))
      .rejects.toThrow('current Bilibili account')
    expect(service.commit).not.toHaveBeenCalled()
  })

  it('returns a compact account and workspace summary rather than repository videos or memberships', async () => {
    const ipcMain = new FakeIpcMain()
    const service = {
      getSnapshot: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 2, updatedAt: '2026-07-19T00:00:00.000Z',
        videos: Object.fromEntries(Array.from({ length: 30_000 }, (_, index) => [String(index + 1), { aid: index + 1 }])),
        memberships: { 'folder-a': Array.from({ length: 30_000 }, (_, index) => index + 1) },
        folders: [{ id: 'folder-a', title: 'A', kind: 'local', syncState: 'local-only' }],
        physicalShards: [], syncRecords: [],
        workspace: { id: 'workspace-1', accountMid: '100', status: 'previewing', baselineRevision: 1, continuationAids: [1, 2] }
      })
    }
    registerFavoriteRepositoryIpc({
      ipcMain, service: service as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    const summary = await ipcMain.invoke('favorite-repository:get-snapshot', 7, '100')

    expect(summary).toEqual(expect.objectContaining({
      version: 1, accountMid: '100', revision: 2, videoCount: 30_000, folderCount: 1,
      workspace: { id: 'workspace-1', status: 'previewing', baselineRevision: 1, continuationCount: 2 }
    }))
    expect(summary).not.toHaveProperty('videos')
    expect(summary).not.toHaveProperty('memberships')
  })

  it('publishes bounded revision invalidations only to exact live subscriptions', async () => {
    const ipcMain = new FakeIpcMain()
    const send = vi.fn()
    const service = {
      commit: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', revision: 2, commandId: 'command-1',
        affectedFolderIds: ['folder-a'], affectedAids: [1, 2]
      })
    }
    registerFavoriteRepositoryIpc({
      ipcMain,
      service: service as never,
      isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100'),
      send
    })
    const activeSubscription = await ipcMain.invoke('favorite-repository:subscribe', 7, '100', 'folder-a') as string
    await ipcMain.invoke('favorite-repository:subscribe', 8, '100', 'folder-b')

    await ipcMain.invoke('favorite-repository:commit-command', 7, '100', {
      id: 'command-1', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'video', tags: [], updatedAt: '2026-07-19T00:00:00.000Z' }
    })

    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledWith(7, 'favorite-repository:revision-changed', {
      subscriptionId: activeSubscription, accountMid: '100', revision: 2,
      affectedFolderIds: ['folder-a'], affectedFolderCount: 1, affectedFolderIdsTruncated: false,
      affectedAidCount: 2, pageInvalidated: true
    })
    expect(send.mock.calls.flat().join(',')).not.toContain('1,2')
  })

  it('removes every subscription owned by a destroyed renderer', async () => {
    const ipcMain = new FakeIpcMain()
    const send = vi.fn()
    const service = { commit: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 2, commandId: 'command-1', affectedFolderIds: [], affectedAids: [] }) }
    const registration = registerFavoriteRepositoryIpc({
      ipcMain, service: service as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100'), send
    }) as unknown as { removeSender(senderId: number): void }
    await ipcMain.invoke('favorite-repository:subscribe', 7, '100', 'folder-a')
    registration.removeSender(7)

    await ipcMain.invoke('favorite-repository:commit-command', 7, '100', {
      id: 'command-1', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'video', tags: [], updatedAt: '2026-07-19T00:00:00.000Z' }
    })

    expect(send).not.toHaveBeenCalled()
  })

  it('allows cleanup of an existing subscription after the Bilibili account changes', async () => {
    const ipcMain = new FakeIpcMain()
    const getCurrentAccountMid = vi.fn()
      .mockResolvedValueOnce('100')
      .mockResolvedValueOnce('101')
    registerFavoriteRepositoryIpc({
      ipcMain, service: {} as never, isTrustedSender: () => true, getCurrentAccountMid
    })

    const subscriptionId = await ipcMain.invoke('favorite-repository:subscribe', 7, '100', 'folder-a') as string

    await expect(ipcMain.invoke('favorite-repository:unsubscribe', 7, '100', subscriptionId)).resolves.toBe(true)
  })

  it('returns paged deduplicated search rows without broadcasting repository contents', async () => {
    const ipcMain = new FakeIpcMain()
    const service = {
      getSnapshot: vi.fn().mockResolvedValue({
        version: 1,
        accountMid: '100',
        revision: 3,
        videos: {
          '1': { aid: 1, title: 'Alpha video', author: 'creator', tags: ['music'], updatedAt: '2026-07-19T00:00:00.000Z' },
          '2': { aid: 2, title: 'Beta video', tags: ['other'], updatedAt: '2026-07-19T00:00:00.000Z' }
        }
      })
    }
    registerFavoriteRepositoryIpc({
      ipcMain,
      service: service as never,
      isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('favorite-repository:search-page', 7, '100', 'music', { limit: 1 })).resolves.toEqual({
      version: 1,
      accountMid: '100',
      revision: 3,
      items: [{ aid: 1, title: 'Alpha video', author: 'creator', tags: ['music'], updatedAt: '2026-07-19T00:00:00.000Z' }],
      nextCursor: undefined
    })
  })
})
