import type { FavoriteLedger } from '../../src/shared/types'

/** Keeps staging available even when an account opts out of bilimi defaults. */
export function classifierLedgersForAccount(
  savedLedgers: FavoriteLedger[],
  defaultFavoriteSystemEnabled: boolean
) {
  return savedLedgers
    .filter((ledger) => defaultFavoriteSystemEnabled || !ledger.isDefault || ledger.id === 'inbox')
    .map((ledger) => ({ ...ledger, keywords: [...ledger.keywords] }))
}

/** Starting an organization round restores every default selection, including staging. */
export function enableDefaultLedgersForOrganization(
  savedLedgers: FavoriteLedger[],
  defaultFavoriteSystemEnabled: boolean
) {
  if (!defaultFavoriteSystemEnabled) return savedLedgers
  return savedLedgers.map((ledger) => ledger.isDefault
    ? { ...ledger, enabled: true, keywords: [...ledger.keywords] }
    : ledger)
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
