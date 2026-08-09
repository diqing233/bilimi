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
        delete next.bindingState
        delete next.syncState
      }
      return next
    })
}
