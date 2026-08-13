import { applyManagedFavoriteLedgerDeletion } from '../../src/shared/favoriteLedgerDeletion'
import type { FavoriteAccountPreferences } from '../../src/shared/types'
import type { PersistedManagedFolderDeletion } from './favoriteRepositoryManagedFolderService'

export async function persistConfirmedManagedFolderDeletion(
  accountMid: string,
  deletions: readonly PersistedManagedFolderDeletion[],
  options: {
    load: (accountMid: string) => FavoriteAccountPreferences
    save: (accountMid: string, preferences: FavoriteAccountPreferences) => unknown | Promise<unknown>
    publish: () => unknown | Promise<unknown>
    /** Retains a local-only deleted custom folder until the owner explicitly runs backup again. */
    markRemoteDraftRediscoveryPending?: (accountMid: string, remoteFolderIds: string[]) => unknown | Promise<unknown>
  }
) {
  const current = options.load(accountMid)
  const deletedLedgerIds = [...new Set(deletions.map((deletion) => deletion.logicalLedgerId.trim()).filter(Boolean))]
  const favoriteLedgers = applyManagedFavoriteLedgerDeletion(current.favoriteLedgers, deletedLedgerIds)
  if (JSON.stringify(favoriteLedgers) === JSON.stringify(current.favoriteLedgers)) return false
  await options.save(accountMid, { ...current, favoriteLedgers })
  const customDeletedLedgerIds = new Set(current.favoriteLedgers
    .filter((ledger) => !ledger.isDefault && deletedLedgerIds.includes(ledger.id))
    .map((ledger) => ledger.id))
  const pendingRemoteFolderIds = [...new Set(deletions
    .filter((deletion) => !deletion.remoteDeleted && customDeletedLedgerIds.has(deletion.logicalLedgerId))
    .flatMap((deletion) => deletion.remoteFolderIds)
    .map((remoteFolderId) => remoteFolderId.trim())
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
  if (pendingRemoteFolderIds.length) {
    await options.markRemoteDraftRediscoveryPending?.(accountMid, pendingRemoteFolderIds)
  }
  await options.publish()
  return true
}
