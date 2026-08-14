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
  }
) {
  const current = options.load(accountMid)
  const deletedLedgerIds = [...new Set(deletions.map((deletion) => deletion.logicalLedgerId.trim()).filter(Boolean))]
  const remotelyDeletedLedgerIds = [...new Set(deletions
    .filter((deletion) => deletion.remoteDeleted)
    .map((deletion) => deletion.logicalLedgerId.trim())
    .filter(Boolean))]
  const favoriteLedgers = applyManagedFavoriteLedgerDeletion(
    current.favoriteLedgers,
    deletedLedgerIds,
    remotelyDeletedLedgerIds
  )
  if (JSON.stringify(favoriteLedgers) === JSON.stringify(current.favoriteLedgers)) return false
  await options.save(accountMid, { ...current, favoriteLedgers })
  await options.publish()
  return true
}
