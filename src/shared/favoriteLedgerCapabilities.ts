import type { FavoriteRepositoryFolder } from './favoriteRepository'
import { isBilimiManagedLedgerName } from './favoriteLedgers'
import type { FavoriteLedger } from './types'

export type FavoriteLedgerIdentity = 'managed' | 'local-draft'
export type FavoriteFolderIdentity = 'managed' | 'local-draft' | 'ambiguous-bilimi-like' | 'ordinary'

export type FavoriteLedgerCapabilities = {
  identity: FavoriteLedgerIdentity
  canClassify: boolean
  canProvisionRemote: boolean
  canOpenRemote: boolean
  canDeleteRemote: boolean
}

export type FavoriteFolderCapabilities = {
  identity: FavoriteFolderIdentity
  canClassify: boolean
  canCopy: boolean
  canMove: boolean
  canDeleteRemote: boolean
}

/**
 * A persisted ledger id is the local identity. Display names are presentation
 * only and never establish a remote binding.
 */
export function resolveFavoriteLedgerCapabilities(ledger: FavoriteLedger): FavoriteLedgerCapabilities {
  if (ledger.syncState === 'local-draft') {
    return { identity: 'local-draft', canClassify: false, canProvisionRemote: false, canOpenRemote: false, canDeleteRemote: false }
  }
  return {
    identity: 'managed', canClassify: true, canProvisionRemote: true,
    canOpenRemote: Boolean(ledger.bilibiliFolderId), canDeleteRemote: Boolean(ledger.bilibiliFolderId)
  }
}

/**
 * Remote folder permissions come from the observed folder kind. A bilimi-like
 * title without an explicit local binding remains an adoptable draft and may
 * be copied locally, but it cannot be mutated or deleted remotely.
 */
export function resolveFavoriteFolderCapabilities(folder: FavoriteRepositoryFolder): FavoriteFolderCapabilities {
  if (folder.kind === 'bilimi-logical') {
    const bound = folder.syncState === 'bound'
    return { identity: 'managed', canClassify: true, canCopy: true, canMove: true, canDeleteRemote: bound }
  }
  if (folder.kind === 'local') {
    return { identity: 'local-draft', canClassify: false, canCopy: true, canMove: true, canDeleteRemote: false }
  }
  if (folder.kind === 'bilibili' && isBilimiManagedLedgerName(folder.title)) {
    return { identity: 'ambiguous-bilimi-like', canClassify: false, canCopy: true, canMove: false, canDeleteRemote: false }
  }
  return { identity: 'ordinary', canClassify: false, canCopy: true, canMove: false, canDeleteRemote: false }
}
