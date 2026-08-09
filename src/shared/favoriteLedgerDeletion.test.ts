import { describe, expect, it } from 'vitest'
import { applyManagedFavoriteLedgerDeletion } from './favoriteLedgerDeletion'

describe('applyManagedFavoriteLedgerDeletion', () => {
  it('disables default ledgers and removes custom ledgers after confirmed deletion', () => {
    const next = applyManagedFavoriteLedgerDeletion([
      { id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: true, bilibiliFolderId: 'remote-music', bindingState: 'bound', syncState: 'bound' },
      { id: 'games', displayName: 'bilimi·游戏', keywords: [], enabled: true, priority: 20, isDefault: false, bilibiliFolderId: 'remote-games', syncState: 'bound' },
      { id: 'knowledge', displayName: 'bilimi·知识', keywords: [], enabled: true, priority: 30, isDefault: true, bilibiliFolderId: 'remote-knowledge', syncState: 'bound' }
    ], ['music', 'games'])

    expect(next).toEqual([
      { id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: false, priority: 10, isDefault: true },
      { id: 'knowledge', displayName: 'bilimi·知识', keywords: [], enabled: true, priority: 30, isDefault: true, bilibiliFolderId: 'remote-knowledge', syncState: 'bound' }
    ])
  })
})
