import { describe, expect, it } from 'vitest'
import type { FavoriteRepositoryFolder } from './favoriteRepository'
import type { FavoriteLedger } from './types'
import { resolveFavoriteFolderCapabilities, resolveFavoriteLedgerCapabilities } from './favoriteLedgerCapabilities'

const ledger = (overrides: Partial<FavoriteLedger> = {}): FavoriteLedger => ({
  id: 'custom-topic', displayName: '普通名称', keywords: [], enabled: true, priority: 1, isDefault: false,
  ...overrides
})

describe('favorite ledger capabilities', () => {
  it('keeps a saved local draft out of classification and remote provisioning', () => {
    expect(resolveFavoriteLedgerCapabilities(ledger({ syncState: 'local-draft' }))).toEqual({
      identity: 'local-draft', canClassify: false, canProvisionRemote: false, canOpenRemote: false, canDeleteRemote: false
    })
  })

  it('treats a persisted ledger identity as managed without granting remote authority from its title', () => {
    expect(resolveFavoriteLedgerCapabilities(ledger({ displayName: 'bilimi·音乐' }))).toEqual({
      identity: 'managed', canClassify: true, canProvisionRemote: true, canOpenRemote: false, canDeleteRemote: false
    })
  })

  it('keeps an unbound ledger out of classification until it is backed up again', () => {
    expect(resolveFavoriteLedgerCapabilities(ledger({ bindingState: 'unbound' }))).toEqual({
      identity: 'managed', canClassify: false, canProvisionRemote: true, canOpenRemote: false, canDeleteRemote: false
    })
  })

  it('marks a bilimi-like remote folder without binding evidence as ambiguous', () => {
    const folder: FavoriteRepositoryFolder = { id: 'bilibili:9', title: 'bilimi·音乐', kind: 'bilibili', remoteFolderId: '9', syncState: 'synced' }
    expect(resolveFavoriteFolderCapabilities(folder)).toEqual({
      identity: 'ambiguous-bilimi-like', canClassify: false, canCopy: true, canMove: false, canDeleteRemote: false
    })
  })

  it('keeps ordinary Bilibili folders copy-only', () => {
    const folder: FavoriteRepositoryFolder = { id: 'bilibili:10', title: '我的收藏', kind: 'bilibili', remoteFolderId: '10', syncState: 'synced' }
    expect(resolveFavoriteFolderCapabilities(folder)).toEqual({
      identity: 'ordinary', canClassify: false, canCopy: true, canMove: false, canDeleteRemote: false
    })
  })
})
