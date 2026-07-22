import type { FavoriteLedger } from '../../src/shared/types'

/** Keeps staging available even when an account opts out of bilimi defaults. */
export function classifierLedgersForAccount(
  savedLedgers: FavoriteLedger[],
  defaultFavoriteSystemEnabled: boolean
) {
  return savedLedgers.map((ledger) => ({
    ...ledger,
    keywords: [...ledger.keywords],
    enabled: ledger.isDefault && ledger.id !== 'inbox'
      ? defaultFavoriteSystemEnabled && ledger.enabled
      : ledger.enabled
  }))
}

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
