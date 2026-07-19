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
  it('requires an explicit account and returns only that account snapshot', async () => {
    const ipcMain = new FakeIpcMain()
    const service = {
      getSnapshot: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 1, videos: {} })
    }
    registerFavoriteRepositoryIpc({
      ipcMain,
      service: service as never,
      isTrustedSender: (senderId) => senderId === 7,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('favorite-repository:open-account', 7, '100')).resolves.toEqual({
      accountMid: '100', revision: 1
    })
    expect(service.getSnapshot).toHaveBeenCalledWith('100')
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

  it('publishes revision-only invalidations only to subscribed matching accounts and pages', async () => {
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
    ipcMain.invoke('favorite-repository:subscribe', 7, '100', 'folder-a')
    ipcMain.invoke('favorite-repository:subscribe', 8, '100', 'folder-b')
    ipcMain.invoke('favorite-repository:subscribe', 9, '101', 'folder-a')

    await ipcMain.invoke('favorite-repository:commit-command', 7, '100', {
      id: 'command-1', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'video', tags: [], updatedAt: '2026-07-19T00:00:00.000Z' }
    })

    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledWith(7, 'favorite-repository:revision-changed', {
      accountMid: '100', revision: 2, affectedFolderIds: ['folder-a'], affectedAids: [1, 2], pageInvalidated: true
    })
    expect(send).toHaveBeenCalledWith(8, 'favorite-repository:revision-changed', {
      accountMid: '100', revision: 2, affectedFolderIds: ['folder-a'], affectedAids: [1, 2], pageInvalidated: false
    })
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
