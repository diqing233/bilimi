import type { FavoriteLedger } from './types'

/** Clears only bindings whose Bilibili folders were actually deleted, without removing local rules. */
export function applyManagedFavoriteLedgerDeletion(
  ledgers: FavoriteLedger[],
  deletedLedgerIds: Iterable<string>,
  remotelyDeletedLedgerIds: Iterable<string> = []
): FavoriteLedger[] {
  const deleted = new Set(deletedLedgerIds)
  const remotelyDeleted = new Set(remotelyDeletedLedgerIds)
  return ledgers.map((ledger) => {
    if (!deleted.has(ledger.id) || !remotelyDeleted.has(ledger.id)) return ledger
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
    if (!ledger.isDefault) {
      return { ...ledgerWithoutRemoteBinding, bindingState: 'unbacked' }
    }
    return {
      ...ledgerWithoutRemoteBinding,
      enabled: false,
      bindingState: 'unbound',
      managedFolderDeletedByUser: true
    }
  })
}
