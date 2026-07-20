import type { FavoriteLedger } from '../../src/shared/types'

/** Gives adopted workspace recommendations precedence without mutating saved preferences. */
export function mergeOldFavoriteWorkspaceLedgers(
  savedLedgers: FavoriteLedger[],
  recommendedLedgers: FavoriteLedger[]
) {
  const recommendedIds = new Set(recommendedLedgers.map((ledger) => ledger.id))
  return [
    ...recommendedLedgers.map((ledger) => ({ ...ledger, keywords: [...ledger.keywords] })),
    ...savedLedgers
      .filter((ledger) => !recommendedIds.has(ledger.id))
      .map((ledger) => ({ ...ledger, keywords: [...ledger.keywords] }))
  ]
}
