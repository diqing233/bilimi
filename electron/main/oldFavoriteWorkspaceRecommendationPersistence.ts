import type { FavoriteLedger } from '../../src/shared/types'
import { createRemoteObservationFavoriteLedgerId } from '../../src/shared/favoriteLedgers'

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
  // A recommendation draft without a remote folder is safe to remove when
  // its checkbox is cleared.  The persisted binding state can be `unbound`
  // for locally generated drafts, so remote-folder presence (rather than
  // bindingState alone) is the authoritative guard against deleting a
  // remotely discovered folder.
  return ledger.ruleOrigin === 'recommendation-draft' &&
    !hasRemoteBinding &&
    ledger.displayName === recommendation.displayName &&
    (ledger.ruleType ?? 'keyword') === (recommendation.ruleType ?? 'keyword') &&
    JSON.stringify(ledger.keywords) === JSON.stringify(recommendation.keywords) &&
    ledger.enabled === recommendation.enabled &&
    ledger.priority === recommendation.priority &&
    ledger.isDefault === recommendation.isDefault
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
    return recommendation
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
  return ledger.ruleOrigin === 'saved-rule' || ledger.enabled ||
    (Array.isArray(ledger.keywords) && ledger.keywords.some((keyword) => keyword.trim()))
}

function remoteFolderIds(ledger: FavoriteLedger) {
  return [...new Set([
    ...(ledger.bilibiliFolderIds ?? []),
    ledger.bilibiliFolderId
  ].map((folderId) => String(folderId ?? '').trim()).filter(Boolean))]
}

function isUnboundRemoteObservationDraft(ledger: FavoriteLedger) {
  return ledger.syncState === 'local-draft' && ledger.bindingState === 'unbound' && remoteFolderIds(ledger).length === 1
}

export function mergeRecoveredLedgerDrafts(current: FavoriteLedger[], recovered: FavoriteLedger[]) {
  const groups = new Map<string, Array<{ ledger: FavoriteLedger; source: 'current' | 'recovered' }>>()
  const addRemoteDraft = (ledger: FavoriteLedger, source: 'current' | 'recovered') => {
    if (!isUnboundRemoteObservationDraft(ledger)) return
    const [remoteFolderId] = remoteFolderIds(ledger)
    const group = groups.get(remoteFolderId) ?? []
    group.push({ ledger, source })
    groups.set(remoteFolderId, group)
  }
  current.forEach((ledger) => addRemoteDraft(ledger, 'current'))
  recovered.forEach((ledger) => addRemoteDraft(ledger, 'recovered'))

  const retained: FavoriteLedger[] = []
  const consumedCurrentIds = new Set<string>()
  const consumedRecoveredIds = new Set<string>()
  const emittedIds = new Set<string>()
  for (const group of groups.values()) {
    const remoteFolderId = remoteFolderIds(group[0]!.ledger)[0]!
    const configuredEntries = group.filter(({ ledger }) => hasConfiguredRule(ledger))
    const configured = configuredEntries[0]
    const canonical = group.find(({ ledger }) => ledger.id === createRemoteObservationFavoriteLedgerId(remoteFolderId))
    const selected = configured?.ledger ?? canonical?.ledger ?? group[0]!.ledger
    // A user-edited legacy rule keeps its stable local ID; only an
    // observation-only record is required to use the folder-id-derived ID.
    const selectedLedger = configured?.ledger ?? (
      selected.id === createRemoteObservationFavoriteLedgerId(remoteFolderId)
        ? selected
        : { ...selected, id: createRemoteObservationFavoriteLedgerId(remoteFolderId) }
    )
    retained.push(selectedLedger.bilibiliFolderId
      ? selectedLedger
      : { ...selectedLedger, bilibiliFolderId: remoteFolderId, bilibiliFolderIds: [remoteFolderId] })
    emittedIds.add(selectedLedger.id)
    for (const entry of configuredEntries.slice(1)) {
      if (emittedIds.has(entry.ledger.id)) continue
      retained.push(entry.ledger)
      emittedIds.add(entry.ledger.id)
    }
    for (const entry of group) {
      if (entry.source === 'current') consumedCurrentIds.add(entry.ledger.id)
      else consumedRecoveredIds.add(entry.ledger.id)
    }
  }

  for (const ledger of current) {
    if (consumedCurrentIds.has(ledger.id) || emittedIds.has(ledger.id)) continue
    const recoveredMatch = recovered.find((candidate) => candidate.id === ledger.id && !consumedRecoveredIds.has(candidate.id))
    if (recoveredMatch) {
      consumedRecoveredIds.add(recoveredMatch.id)
      const merged = hasConfiguredRule(ledger)
        ? { ...ledger, bilibiliFolderId: ledger.bilibiliFolderId ?? recoveredMatch.bilibiliFolderId, bilibiliFolderIds: ledger.bilibiliFolderIds ?? recoveredMatch.bilibiliFolderIds }
        : recoveredMatch
      retained.push(merged)
      emittedIds.add(merged.id)
      continue
    }
    retained.push(ledger)
    emittedIds.add(ledger.id)
  }
  for (const ledger of recovered) {
    if (consumedRecoveredIds.has(ledger.id) || emittedIds.has(ledger.id)) continue
    retained.push(ledger)
    emittedIds.add(ledger.id)
  }
  return retained
}

export function markRecommendedLedgersLocalDraft(current: FavoriteLedger[], recommendationIds: string[]) {
  const recommendedIds = new Set(recommendationIds)
  return current.map((ledger) => recommendedIds.has(ledger.id) && ledger.ruleOrigin === 'recommendation-draft' && !ledger.bilibiliFolderId
    ? { ...ledger, syncState: 'local-draft' as const, ruleOrigin: 'recommendation-draft' as const }
    : ledger)
}
