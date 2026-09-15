import { describe, expect, it } from 'vitest'
import { favoriteLedgerBackupStatesForLibrary } from './favoriteLibraryBackupStates'

describe('favorite ledger backup states for the library', () => {
  it('keeps a right-side unbound rule unbound in the matching left-library summary without a remote read', () => {
    expect(favoriteLedgerBackupStatesForLibrary([
      {
        id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 1,
        isDefault: false, bindingState: 'unbound'
      }
    ], {
      physicalShardCount: 0,
      physicalShards: [],
      folders: [{ kind: 'bilimi-logical', logicalLedgerId: 'music' }]
    })).toEqual({ music: 'unbound' })
  })

  it('keeps a remotely deleted rule unbacked while a local-only deletion leaves its existing bound rule alone', () => {
    const summary = { physicalShardCount: 0, physicalShards: [], folders: [] }
    expect(favoriteLedgerBackupStatesForLibrary([
      {
        id: 'remote-deleted', displayName: 'bilimi·远端删除', keywords: [], enabled: true, priority: 1,
        isDefault: false, bindingState: 'unbacked'
      },
      {
        id: 'local-only', displayName: 'bilimi·仅本地', keywords: [], enabled: true, priority: 2,
        isDefault: false, bindingState: 'bound', bilibiliFolderId: 'retained-remote-folder'
      }
    ], summary)).toEqual({ 'remote-deleted': 'unbacked', 'local-only': 'unbacked' })
  })
})
