import { describe, expect, it } from 'vitest'
import { createDefaultFavoriteLedgers } from './favoriteLedgers'
import { applyManagedFavoriteLedgerDeletion } from './favoriteLedgerDeletion'

describe('applyManagedFavoriteLedgerDeletion', () => {
  it('restores a default card while clearing only the Bilibili binding that was actually deleted', () => {
    const next = applyManagedFavoriteLedgerDeletion([
      {
        id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: true,
        bilibiliFolderId: 'remote-music', bilibiliFolderIds: ['remote-music', 'remote-music-2'],
        bilibiliFolderTitle: 'bilimi·音乐', bilibiliFolderVideoCount: 12, bindingState: 'bound',
        pendingRemoteBinding: true, pendingRemoteFolderId: 'pending-music', pendingRemoteFolderTitle: 'bilimi·音乐·3',
        syncState: 'local-draft'
      },
      { id: 'games', displayName: 'bilimi·游戏', keywords: [], enabled: true, priority: 20, isDefault: false, bilibiliFolderId: 'remote-games', syncState: 'bound' },
      { id: 'knowledge', displayName: 'bilimi·知识', keywords: [], enabled: true, priority: 30, isDefault: true, bilibiliFolderId: 'remote-knowledge', syncState: 'bound' }
    ], ['music', 'games'], ['music', 'games'])

    expect(next).toEqual([
      {
        ...createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'music')!,
        bindingState: 'unbacked',
        managedFolderDeletedByUser: true
      },
      {
        id: 'games', displayName: 'bilimi·游戏', keywords: [], enabled: true, priority: 20, isDefault: false,
        bindingState: 'unbacked', syncState: 'bound'
      },
      { id: 'knowledge', displayName: 'bilimi·知识', keywords: [], enabled: true, priority: 30, isDefault: true, bilibiliFolderId: 'remote-knowledge', syncState: 'bound' }
    ])
  })

  it('clears every pending-created binding marker when that exact remote folder is confirmed deleted', () => {
    const pendingLedger = {
      id: 'custom-pending', displayName: 'bilimi·待确认', keywords: [], enabled: true, priority: 10, isDefault: false,
      bilibiliFolderId: 'new-pending', bilibiliFolderIds: ['new-pending'], bindingState: 'unbound' as const,
      pendingRemoteBinding: true, pendingRemoteBindingCreatedByBackup: true,
      pendingRemoteFolderId: 'new-pending', pendingRemoteFolderTitle: 'bilimi·待确认'
    }

    const [next] = applyManagedFavoriteLedgerDeletion([pendingLedger], ['custom-pending'], ['custom-pending'])

    expect(next).toEqual(expect.objectContaining({
      id: 'custom-pending', bindingState: 'unbacked'
    }))
    expect(next).not.toHaveProperty('pendingRemoteBinding')
    expect(next).not.toHaveProperty('pendingRemoteBindingCreatedByBackup')
    expect(next).not.toHaveProperty('pendingRemoteFolderId')
    expect(next).not.toHaveProperty('pendingRemoteFolderTitle')
  })
})
