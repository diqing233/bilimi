import type { FavoriteLedger } from '../../src/shared/types'
import { createRemoteObservationFavoriteLedgerId } from '../../src/shared/favoriteLedgers'

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
