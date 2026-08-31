import {
  applyConfirmedManagedFavoriteRemoteFolderDeletion,
  restoreDefaultFavoriteLedgerAfterLocalDeletion
} from '../../src/shared/favoriteLedgerDeletion'
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
  const deletedRemoteFolderIdsByLedger = new Map<string, Set<string>>()
  const confirmedAbsentDefaultLedgerIds = new Set<string>()
  for (const deletion of deletions
    .filter((deletion) => deletion.remoteDeleted)
  ) {
    const logicalLedgerId = deletion.logicalLedgerId.trim()
    if (!logicalLedgerId) continue
    const remoteFolderIds = deletedRemoteFolderIdsByLedger.get(logicalLedgerId) ?? new Set<string>()
    deletion.remoteFolderIds.map((remoteFolderId) => remoteFolderId.trim()).filter(Boolean).forEach((remoteFolderId) => remoteFolderIds.add(remoteFolderId))
    deletedRemoteFolderIdsByLedger.set(logicalLedgerId, remoteFolderIds)
  }
  for (const deletion of deletions.filter((deletion) => deletion.remoteConfirmedAbsent)) {
    const logicalLedgerId = deletion.logicalLedgerId.trim()
    if (logicalLedgerId) confirmedAbsentDefaultLedgerIds.add(logicalLedgerId)
  }
  const remotelyProjectedLedgers = applyConfirmedManagedFavoriteRemoteFolderDeletion(current.favoriteLedgers, deletedRemoteFolderIdsByLedger)
  const favoriteLedgers = remotelyProjectedLedgers.map((ledger) => {
    if (!ledger.isDefault || ledger.bindingState !== 'unbound' || !confirmedAbsentDefaultLedgerIds.has(ledger.id)) return ledger
    return { ...restoreDefaultFavoriteLedgerAfterLocalDeletion(ledger), bindingState: 'unbacked' as const }
  })
  if (JSON.stringify(favoriteLedgers) === JSON.stringify(current.favoriteLedgers)) return false
  await options.save(accountMid, { ...current, favoriteLedgers })
  await options.publish()
  return true
}
