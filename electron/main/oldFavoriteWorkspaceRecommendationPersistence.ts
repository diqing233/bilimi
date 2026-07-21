import type { FavoriteLedger } from '../../src/shared/types'

export function applyRecommendedLedgers(current: FavoriteLedger[], recommendations: FavoriteLedger[]) {
  const recommendedById = new Map(recommendations.map((ledger) => [ledger.id, {
    ...ledger,
    syncState: 'local-draft' as const
  }]))
  return [
    ...current.filter((ledger) => !recommendedById.has(ledger.id)),
    ...recommendedById.values()
  ]
}

export function removeRecommendedLedgers(current: FavoriteLedger[], recommendationIds: string[]) {
  const removedIds = new Set(recommendationIds)
  return current.filter((ledger) => !removedIds.has(ledger.id))
}

export function markRecommendedLedgersLocalDraft(current: FavoriteLedger[], recommendationIds: string[]) {
  const recommendedIds = new Set(recommendationIds)
  return current.map((ledger) => recommendedIds.has(ledger.id) && !ledger.bilibiliFolderId
    ? { ...ledger, syncState: 'local-draft' as const }
    : ledger)
}
