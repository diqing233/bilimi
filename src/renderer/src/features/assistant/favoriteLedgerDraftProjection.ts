import type { FavoriteLedger } from '@shared/types'

/** Keeps an orphaned local custom folder editable until it is saved in 掌库. */
export function projectFavoriteLedgerDraft(
  ledgers: readonly FavoriteLedger[],
  requestedLedgerId: string | undefined,
  requestedLedgerTitle: string | undefined
): FavoriteLedger[] {
  if (!requestedLedgerId || ledgers.some((ledger) => ledger.id === requestedLedgerId)) return [...ledgers]
  const displayName = requestedLedgerTitle?.trim()
  if (!displayName) return [...ledgers]
  return [...ledgers, {
    id: requestedLedgerId,
    displayName,
    keywords: [],
    enabled: true,
    priority: 10_000,
    syncState: 'local-draft',
    isDefault: false
  }]
}
