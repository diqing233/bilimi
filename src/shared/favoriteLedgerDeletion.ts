import type { FavoriteLedger } from './types'

/** Applies a confirmed managed-folder deletion to local rules without touching unrelated rules. */
export function applyManagedFavoriteLedgerDeletion(
  ledgers: FavoriteLedger[],
  deletedLedgerIds: Iterable<string>
): FavoriteLedger[] {
  const deleted = new Set(deletedLedgerIds)
  return ledgers
    .filter((ledger) => !deleted.has(ledger.id) || ledger.isDefault)
    .map((ledger) => {
      if (!deleted.has(ledger.id)) return ledger
      const next = { ...ledger, enabled: false }
      if (ledger.isDefault) {
        delete next.bilibiliFolderId
        delete next.bilibiliFolderIds
        delete next.bilibiliFolderTitle
        delete next.bilibiliFolderVideoCount
        delete next.pendingRemoteBinding
        delete next.pendingRemoteFolderId
        delete next.pendingRemoteFolderTitle
        delete next.syncState
        next.bindingState = 'unbound'
        next.managedFolderDeletedByUser = true
      }
      return next
    })
}
