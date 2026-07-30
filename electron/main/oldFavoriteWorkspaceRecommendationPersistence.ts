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

function hasConfiguredRule(ledger: FavoriteLedger) {
  return ledger.enabled || ledger.keywords.some((keyword) => keyword.trim())
}

export function mergeRecoveredLedgerDrafts(current: FavoriteLedger[], recovered: FavoriteLedger[]) {
  const recoveredById = new Map(recovered.map((ledger) => [ledger.id, ledger]))
  const recoveredByRemoteFolderId = new Map(recovered.flatMap((ledger) =>
    ledger.bilibiliFolderId ? [[ledger.bilibiliFolderId, ledger] as const] : []))
  const consumed = new Set<FavoriteLedger>()
  const retained = current.flatMap((ledger) => {
    const idMatch = recoveredById.get(ledger.id)
    const remoteMatch = ledger.bilibiliFolderId
      ? recoveredByRemoteFolderId.get(ledger.bilibiliFolderId)
      : undefined
    const draft = idMatch && !consumed.has(idMatch)
      ? idMatch
      : remoteMatch && !consumed.has(remoteMatch) ? remoteMatch : undefined
    if (!draft) return [ledger]
    consumed.add(draft)
    return [hasConfiguredRule(ledger)
      ? { ...ledger, bilibiliFolderId: ledger.bilibiliFolderId ?? draft.bilibiliFolderId }
      : draft]
  })
  return [...retained, ...recovered.filter((ledger) => !consumed.has(ledger))]
}

export function markRecommendedLedgersLocalDraft(current: FavoriteLedger[], recommendationIds: string[]) {
  const recommendedIds = new Set(recommendationIds)
  return current.map((ledger) => recommendedIds.has(ledger.id) && !ledger.bilibiliFolderId
    ? { ...ledger, syncState: 'local-draft' as const }
    : ledger)
}
