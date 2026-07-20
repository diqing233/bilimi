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

  it('does not let the renderer submit a frozen workspace plan through the generic command channel', async () => {
    const ipcMain = new FakeIpcMain()
    const service = { commit: vi.fn() }
    registerFavoriteRepositoryIpc({
      ipcMain, service: service as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('favorite-repository:commit-command', 7, '100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace',
      payload: {
        id: 'workspace-1', accountMid: '100', status: 'frozen', baselineRevision: 1, continuationAids: [],
        frozenSyncPlan: { id: 'run-1', accountMid: '100', workspaceId: 'workspace-1', baselineRevision: 1, createdAt: '2026-07-19T00:00:00.000Z', operations: [] }
      }
    })).rejects.toThrow('reserved for the main process')
    expect(service.commit).not.toHaveBeenCalled()
  })

  it('does not let the renderer forge incremental organization protections', async () => {
    const ipcMain = new FakeIpcMain()
    const service = { commit: vi.fn() }
    registerFavoriteRepositoryIpc({
      ipcMain, service: service as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('favorite-repository:commit-command', 7, '100', {
      id: 'protections', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'record-organization-protections',
      payload: { records: [{ accountMid: '100', aid: 1, targetFolderIds: ['remote-1'], completedAt: '2026-07-20T00:00:00.000Z' }] }
    })).rejects.toThrow('reserved for the main process')
    expect(service.commit).not.toHaveBeenCalled()
  })

  it('does not let the renderer forge a local workspace save plan', async () => {
    const ipcMain = new FakeIpcMain()
    const service = { commit: vi.fn() }
    registerFavoriteRepositoryIpc({
      ipcMain, service: service as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('favorite-repository:commit-command', 7, '100', {
      id: 'local-plan', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'commit-local-plan',
      payload: { workspaceId: 'workspace-1', memberAidsByFolderId: { 'local:music': [1] } }
    })).rejects.toThrow('reserved for the main process')
    expect(service.commit).not.toHaveBeenCalled()
  })

  it('does not let the renderer forge a Bilibili source mirror', async () => {
    const ipcMain = new FakeIpcMain()
    const service = { commit: vi.fn() }
    registerFavoriteRepositoryIpc({
      ipcMain, service: service as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('favorite-repository:commit-command', 7, '100', {
      id: 'mirror', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'record-bilibili-mirror',
      payload: { workspaceId: 'workspace-1', memberAidsByFolderId: {}, folders: [], videos: [] }
    })).rejects.toThrow('reserved for the main process')
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

  it('returns one bounded library page with every membership and pending state for each aid', async () => {
    const ipcMain = new FakeIpcMain()
    const service = {
      getLibraryPage: vi.fn()
        .mockResolvedValueOnce({
          version: 1, accountMid: '100', revision: 4,
          items: [{
            video: { aid: 1, title: 'Alpha', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' },
            folderIds: ['local', 'remote'], pendingStates: ['failed']
          }],
          nextCursor: '1'
        })
        .mockResolvedValueOnce({
          version: 1, accountMid: '100', revision: 4,
          items: [
            { video: { aid: 1 }, folderIds: ['local', 'remote'], pendingStates: ['failed'] },
            { video: { aid: 2 }, folderIds: ['local'], pendingStates: ['unsynced', 'continuation'] }
          ]
        })
    }
    registerFavoriteRepositoryIpc({
      ipcMain, service: service as never, isTrustedSender: () => true,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('favorite-repository:get-library-page', 7, '100', { kind: 'all' }, { limit: 1 }))
      .resolves.toEqual({
        version: 1, accountMid: '100', revision: 4,
        items: [{
          video: { aid: 1, title: 'Alpha', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' },
          folderIds: ['local', 'remote'], pendingStates: ['failed']
        }],
        nextCursor: '1'
      })
    await expect(ipcMain.invoke('favorite-repository:get-library-page', 7, '100', { kind: 'pending' }, { limit: 10 }))
      .resolves.toMatchObject({
        items: [
          { video: { aid: 1 }, pendingStates: ['failed'] },
          { video: { aid: 2 }, pendingStates: ['unsynced', 'continuation'] }
        ]
      })
  })

  it('allows a library-only sender to read a page but not commit a repository command', async () => {
    const ipcMain = new FakeIpcMain()
    const service = {
      getLibraryPage: vi.fn().mockResolvedValue({ version: 1, accountMid: '100', revision: 0, items: [] }),
      commit: vi.fn()
    }
    registerFavoriteRepositoryIpc({
      ipcMain, service: service as never, isTrustedSender: (senderId) => senderId === 7,
      isTrustedReader: (senderId) => senderId === 8,
      getCurrentAccountMid: vi.fn().mockResolvedValue('100')
    })

    await expect(ipcMain.invoke('favorite-repository:get-library-page', 8, '100', { kind: 'all' }, { limit: 10 }))
      .resolves.toMatchObject({ accountMid: '100', items: [] })
    const subscriptionId = await ipcMain.invoke('favorite-repository:subscribe', 8, '100') as string
    await expect(ipcMain.invoke('favorite-repository:unsubscribe', 8, '100', subscriptionId)).resolves.toBe(true)
    await expect(ipcMain.invoke('favorite-repository:commit-command', 8, '100', {
      id: 'command-1', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'Blocked', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }
    })).rejects.toThrow('untrusted renderer')
    expect(service.commit).not.toHaveBeenCalled()
  })
})
