import { describe, expect, it } from 'vitest'
import { applyManagedFavoriteLedgerDeletion } from './favoriteLedgerDeletion'

describe('applyManagedFavoriteLedgerDeletion', () => {
  it('keeps a default rule as an explicitly user-deleted unbound rule while removing custom rules', () => {
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
    ], ['music', 'games'])

    expect(next).toEqual([
      {
        id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: false, priority: 10, isDefault: true,
        bindingState: 'unbound', managedFolderDeletedByUser: true
      },
      { id: 'knowledge', displayName: 'bilimi·知识', keywords: [], enabled: true, priority: 30, isDefault: true, bilibiliFolderId: 'remote-knowledge', syncState: 'bound' }
    ])
  })
})
