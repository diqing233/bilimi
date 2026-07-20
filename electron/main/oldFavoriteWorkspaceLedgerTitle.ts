import type { FavoriteLedger } from '../../src/shared/types'

/** Resolves the durable user-defined ledger title used by frozen remote plans. */
export function resolveSavedOldFavoriteWorkspaceLedgerTitle(
  ledgers: FavoriteLedger[],
  logicalLedgerId: string
) {
  return ledgers.find((ledger) => ledger.id === logicalLedgerId)?.displayName
}
