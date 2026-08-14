import type { FavoriteLedger } from './types'

function normalizedRemoteFolderIds(ledger: FavoriteLedger) {
  return [...new Set([ledger.bilibiliFolderId, ...(ledger.bilibiliFolderIds ?? [])]
    .map((id) => id?.trim())
    .filter((id): id is string => Boolean(id)))]
}

/**
 * Clears only confirmed deleted remote IDs.  A logical bilimi rule can be
 * bound to more than one physical Bilibili folder, so a failed sibling must
 * remain bound after a partial remote deletion.
 */
export function applyConfirmedManagedFavoriteRemoteFolderDeletion(
  ledgers: FavoriteLedger[],
  deletedRemoteFolderIdsByLedger: ReadonlyMap<string, ReadonlySet<string>>
): FavoriteLedger[] {
  return ledgers.map((ledger) => {
    const deleted = deletedRemoteFolderIdsByLedger.get(ledger.id)
    if (!deleted?.size) return ledger
    const remoteFolderIds = normalizedRemoteFolderIds(ledger)
    const remainingRemoteFolderIds = remoteFolderIds.filter((id) => !deleted.has(id))
    if (remainingRemoteFolderIds.length === remoteFolderIds.length) return ledger
    if (remainingRemoteFolderIds.length) {
      const primaryChanged = ledger.bilibiliFolderId !== remainingRemoteFolderIds[0]
      const {
        bilibiliFolderId: _bilibiliFolderId,
        bilibiliFolderIds: _bilibiliFolderIds,
        bilibiliFolderTitle,
        bilibiliFolderVideoCount,
        ...ledgerWithoutRemoteIds
      } = ledger
      return {
        ...ledgerWithoutRemoteIds,
        bilibiliFolderId: remainingRemoteFolderIds[0],
        bilibiliFolderIds: remainingRemoteFolderIds,
        bindingState: 'bound',
        ...(!primaryChanged && bilibiliFolderTitle !== undefined ? { bilibiliFolderTitle } : {}),
        ...(!primaryChanged && bilibiliFolderVideoCount !== undefined ? { bilibiliFolderVideoCount } : {})
      }
    }
    const {
      bilibiliFolderId: _bilibiliFolderId,
      bilibiliFolderIds: _bilibiliFolderIds,
      bilibiliFolderTitle: _bilibiliFolderTitle,
      bilibiliFolderVideoCount: _bilibiliFolderVideoCount,
      pendingRemoteBinding: _pendingRemoteBinding,
      pendingRemoteFolderId: _pendingRemoteFolderId,
      pendingRemoteFolderTitle: _pendingRemoteFolderTitle,
      ...ledgerWithoutRemoteBinding
    } = ledger
    if (!ledger.isDefault) return { ...ledgerWithoutRemoteBinding, bindingState: 'unbacked' }
    return {
      ...ledgerWithoutRemoteBinding,
      enabled: true,
      bindingState: 'unbacked',
      managedFolderDeletedByUser: true
    }
  })
}

/** Clears only bindings whose Bilibili folders were actually deleted, without removing local rules. */
export function applyManagedFavoriteLedgerDeletion(
  ledgers: FavoriteLedger[],
  deletedLedgerIds: Iterable<string>,
  remotelyDeletedLedgerIds: Iterable<string> = []
): FavoriteLedger[] {
  const deleted = new Set(deletedLedgerIds)
  const remotelyDeleted = new Set(remotelyDeletedLedgerIds)
  const deletedRemoteFolderIdsByLedger = new Map(ledgers
    .filter((ledger) => deleted.has(ledger.id) && remotelyDeleted.has(ledger.id))
    .map((ledger) => [ledger.id, new Set(normalizedRemoteFolderIds(ledger))] as const))
  return applyConfirmedManagedFavoriteRemoteFolderDeletion(ledgers, deletedRemoteFolderIdsByLedger)
}
