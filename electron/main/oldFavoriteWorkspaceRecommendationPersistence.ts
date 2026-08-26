import type { FavoriteLedger } from '../../src/shared/types'

export function applyRecommendedLedgers(current: FavoriteLedger[], recommendations: FavoriteLedger[]) {
  const recommendedById = new Map(recommendations.map((ledger) => [ledger.id, ledger]))
  return [
    ...current.filter((ledger) => !recommendedById.has(ledger.id)),
    ...recommendedById.values()
  ]
}

export function removeRecommendedLedgers(current: FavoriteLedger[], recommendationIds: string[]) {
  const removedIds = new Set(recommendationIds)
  return current.filter((ledger) => !removedIds.has(ledger.id))
}

function matchesGeneratedRecommendation(ledger: FavoriteLedger, recommendation: FavoriteLedger) {
  const hasRemoteBinding = Boolean(ledger.bilibiliFolderId?.trim()) ||
    (ledger.bilibiliFolderIds ?? []).some((folderId) => folderId.trim())
  // Only a persisted source may authorize cancellation as a generated draft.
  // Shape, binding state, remote ids and names are all ambiguous legacy data.
  return ledger.ruleOrigin === 'recommendation-draft' &&
    ledger.bindingState !== 'unbound' && !hasRemoteBinding &&
    ledger.displayName === recommendation.displayName &&
    (ledger.ruleType ?? 'keyword') === (recommendation.ruleType ?? 'keyword') &&
    JSON.stringify(ledger.keywords) === JSON.stringify(recommendation.keywords) &&
    ledger.enabled === recommendation.enabled &&
    ledger.priority === recommendation.priority &&
    ledger.isDefault === recommendation.isDefault
}

function normalizedRuleKeywords(ledger: FavoriteLedger) {
  return ledger.keywords.map((keyword) => keyword.trim().toLocaleLowerCase()).filter(Boolean).sort()
}

function sameLogicalRecommendation(left: FavoriteLedger, right: FavoriteLedger) {
  if ((left.ruleType ?? 'keyword') !== (right.ruleType ?? 'keyword')) return false
  return JSON.stringify(normalizedRuleKeywords(left)) === JSON.stringify(normalizedRuleKeywords(right))
}

export function reconcileRecommendedLedgers(
  current: FavoriteLedger[],
  recommendations: FavoriteLedger[],
  adoptedRecommendationIds: string[]
) {
  const matchedCurrentIds = new Set<string>()
  const adoptedIds = new Set(adoptedRecommendationIds)
  const resolvedRecommendations = recommendations.filter((recommendation) => adoptedIds.has(recommendation.id)).map((recommendation) => {
    const exactId = current.find((ledger) => !matchedCurrentIds.has(ledger.id) && ledger.id === recommendation.id)
    if (exactId) {
      matchedCurrentIds.add(exactId.id)
      return exactId
    }
    const existing = current.find((ledger) =>
      !matchedCurrentIds.has(ledger.id) && sameLogicalRecommendation(ledger, recommendation))
    if (!existing) return recommendation
    matchedCurrentIds.add(existing.id)
    return !existing.bilibiliFolderId
      ? { ...existing, enabled: true }
      : existing
  })
  const recommendedById = new Map(recommendations.map((ledger) => [ledger.id, ledger]))
  const retained = current.filter((ledger) => {
    if (matchedCurrentIds.has(ledger.id)) return false
    const recommendation = recommendedById.get(ledger.id)
    return !recommendation || adoptedIds.has(ledger.id) || !matchesGeneratedRecommendation(ledger, recommendation)
  })
  const retainedIds = new Set(retained.map((ledger) => ledger.id))
  return [
    ...retained,
    ...resolvedRecommendations
      .filter((ledger) => !retainedIds.has(ledger.id))
      .map((ledger) => ledger)
  ]
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
  return current.map((ledger) => recommendedIds.has(ledger.id) && ledger.ruleOrigin === 'recommendation-draft' && !ledger.bilibiliFolderId
    ? { ...ledger, syncState: 'local-draft' as const, ruleOrigin: 'recommendation-draft' as const }
    : ledger)
}
