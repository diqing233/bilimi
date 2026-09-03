import type { FavoriteLedger } from './types'

/**
 * Persisted remote candidates are unbound and can be discarded without
 * touching repository memberships. Other local-draft rules are managed rules.
 */
export function isUnsavedFavoriteLedgerDraft(ledger: FavoriteLedger) {
  const remoteFolderIds = [ledger.bilibiliFolderId, ...(ledger.bilibiliFolderIds ?? [])]
    .map((remoteFolderId) => remoteFolderId?.trim())
    .filter((remoteFolderId): remoteFolderId is string => Boolean(remoteFolderId))
  return ledger.syncState === 'local-draft' &&
    ledger.bindingState === 'unbound' &&
    !ledger.isDefault &&
    remoteFolderIds.length > 0
}

/** Removes exactly one draft rule and leaves every saved rule untouched. */
export function removeUnsavedFavoriteLedgerDraft(
  ledgers: FavoriteLedger[],
  ledgerId: string
): FavoriteLedger[] {
  const draft = ledgers.find((ledger) => ledger.id === ledgerId)
  if (!draft || !isUnsavedFavoriteLedgerDraft(draft)) return ledgers
  return ledgers.filter((ledger) => ledger.id !== ledgerId)
}

/**
 * Recommendation drafts are local adoption records, not remote-folder
 * observations.  They use the same narrow draft-deletion IPC, but must not be
 * classified as remote-only drafts because history and rediscovery deliberately
 * preserve those remote observations separately.
 */
export function isPureRecommendationLedgerDraft(ledger: FavoriteLedger) {
  const remoteFolderIds = [ledger.bilibiliFolderId, ...(ledger.bilibiliFolderIds ?? [])]
    .map((remoteFolderId) => remoteFolderId?.trim())
    .filter((remoteFolderId): remoteFolderId is string => Boolean(remoteFolderId))
  return ledger.ruleOrigin === 'recommendation-draft' &&
    ledger.syncState === 'local-draft' &&
    !ledger.isDefault &&
    ledger.bindingState === undefined &&
    remoteFolderIds.length === 0
}

/** Removes one pure local recommendation draft without touching saved rules. */
export function removePureRecommendationLedgerDraft(
  ledgers: FavoriteLedger[],
  ledgerId: string
): FavoriteLedger[] {
  const draft = ledgers.find((ledger) => ledger.id === ledgerId)
  if (!draft || !isPureRecommendationLedgerDraft(draft)) return ledgers
  return ledgers.filter((ledger) => ledger.id !== ledgerId)
}

/** Removes only user-created local configurations; default rules retain their protected lifecycle. */
export function removeLocalFavoriteLedgers(
  ledgers: FavoriteLedger[],
  ledgerIds: readonly string[]
): FavoriteLedger[] {
  const removableIds = new Set(ledgerIds.filter((ledgerId) =>
    ledgers.some((ledger) => ledger.id === ledgerId && !ledger.isDefault)
  ))
  return removableIds.size ? ledgers.filter((ledger) => !removableIds.has(ledger.id)) : ledgers
}
