import { createDefaultFavoriteLedgers } from './favoriteLedgers'
import type { FavoriteLedger } from './types'

function normalizedRemoteFolderIds(ledger: FavoriteLedger) {
  return [...new Set([ledger.bilibiliFolderId, ...(ledger.bilibiliFolderIds ?? [])]
    .concat(ledger.historicalBilibiliFolderIds ?? [])
    .map((id) => id?.trim())
    .filter((id): id is string => Boolean(id)))]
}

function isPureRemoteObservationDraft(ledger: FavoriteLedger, deletedRemoteFolderIds: ReadonlySet<string>) {
  const folderIds = normalizedRemoteFolderIds(ledger)
  return ledger.syncState === 'local-draft' &&
    ledger.bindingState === 'unbound' &&
    ledger.ruleOrigin !== 'saved-rule' &&
    !ledger.enabled &&
    !ledger.keywords.some((keyword) => keyword.trim()) &&
    folderIds.length === 1 &&
    deletedRemoteFolderIds.has(folderIds[0]!)
}

export function restoreDefaultFavoriteLedgerAfterLocalDeletion(ledger: FavoriteLedger): FavoriteLedger {
  const template = createDefaultFavoriteLedgers().find((candidate) => candidate.id === ledger.id)
  if (!ledger.isDefault || !template) return ledger
  return { ...template, bindingState: 'unbound', managedFolderDeletedByUser: true }
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
  const confirmedDeletedRemoteFolderIds = new Set([...deletedRemoteFolderIdsByLedger.values()]
    .flatMap((ids) => [...ids])
    .map((id) => id.trim())
    .filter(Boolean))
  const settledLedgers = ledgers.map((ledger) => {
    const deleted = deletedRemoteFolderIdsByLedger.get(ledger.id)
    if (!deleted?.size) return ledger
    const formalRemoteFolderIds = [...new Set([ledger.bilibiliFolderId, ...(ledger.bilibiliFolderIds ?? [])]
      .map((id) => id?.trim())
      .filter((id): id is string => Boolean(id)))]
    const historicalRemoteFolderIds = [...new Set((ledger.historicalBilibiliFolderIds ?? [])
      .map((id) => id.trim())
      .filter(Boolean))]
    const remoteFolderIds = [...new Set([...formalRemoteFolderIds, ...historicalRemoteFolderIds])]
    const remainingFormalRemoteFolderIds = formalRemoteFolderIds.filter((id) => !deleted.has(id))
    const remainingHistoricalRemoteFolderIds = historicalRemoteFolderIds.filter((id) => !deleted.has(id))
    const remainingRemoteFolderIds = [...remainingFormalRemoteFolderIds, ...remainingHistoricalRemoteFolderIds]
    const confirmedDeletedRemoteFolderIds = ledger.isDefault
      ? [...new Set([
          ...(ledger.confirmedDeletedRemoteFolderIds ?? []),
          ...deleted
        ].map((id) => id.trim()).filter(Boolean))]
      : undefined
    // An explicitly acknowledged same-title candidate can be deleted even
    // when the local rule never held that remote ID (the normal unbound case).
    // There is then no formal binding for the generic remaining-ID checks to
    // clear, so converge the default rule to the same unbacked state as an
    // exact binding deletion instead of leaving it perpetually “未绑定”.
    if (ledger.isDefault && !remoteFolderIds.length && deleted.size) {
      return {
        ...restoreDefaultFavoriteLedgerAfterLocalDeletion(ledger),
        bindingState: 'unbacked',
        ...(confirmedDeletedRemoteFolderIds ? { confirmedDeletedRemoteFolderIds } : {})
      }
    }
    if (remainingRemoteFolderIds.length === remoteFolderIds.length) {
      return confirmedDeletedRemoteFolderIds
        ? { ...ledger, confirmedDeletedRemoteFolderIds }
        : ledger
    }
    if (remainingRemoteFolderIds.length) {
      const primaryChanged = remainingFormalRemoteFolderIds.length > 0 &&
        ledger.bilibiliFolderId !== remainingFormalRemoteFolderIds[0]
      const {
        bilibiliFolderId: _bilibiliFolderId,
        bilibiliFolderIds: _bilibiliFolderIds,
        bilibiliFolderTitle,
        bilibiliFolderVideoCount,
        historicalBilibiliFolderIds: _historicalBilibiliFolderIds,
        historicalBilibiliFolderTitle: _historicalBilibiliFolderTitle,
        ...ledgerWithoutRemoteIds
      } = ledger
      return {
        ...ledgerWithoutRemoteIds,
        ...(remainingFormalRemoteFolderIds.length ? {
          bilibiliFolderId: remainingFormalRemoteFolderIds[0],
          bilibiliFolderIds: remainingFormalRemoteFolderIds,
          bindingState: 'bound' as const,
          ...(!primaryChanged && bilibiliFolderTitle !== undefined ? { bilibiliFolderTitle } : {}),
          ...(!primaryChanged && bilibiliFolderVideoCount !== undefined ? { bilibiliFolderVideoCount } : {})
        } : { bindingState: 'unbacked' as const }),
        ...(remainingHistoricalRemoteFolderIds.length ? {
          historicalBilibiliFolderIds: remainingHistoricalRemoteFolderIds,
          ...(ledger.historicalBilibiliFolderTitle !== undefined
            ? { historicalBilibiliFolderTitle: ledger.historicalBilibiliFolderTitle }
            : {})
        } : {}),
        ...(confirmedDeletedRemoteFolderIds ? { confirmedDeletedRemoteFolderIds } : {})
      }
    }
    const {
      bilibiliFolderId: _bilibiliFolderId,
      bilibiliFolderIds: _bilibiliFolderIds,
      bilibiliFolderTitle: _bilibiliFolderTitle,
      bilibiliFolderVideoCount: _bilibiliFolderVideoCount,
      historicalBilibiliFolderIds: _historicalBilibiliFolderIds,
      historicalBilibiliFolderTitle: _historicalBilibiliFolderTitle,
      pendingRemoteBinding: _pendingRemoteBinding,
      pendingRemoteBindingCreatedByBackup: _pendingRemoteBindingCreatedByBackup,
      pendingRemoteFolderId: _pendingRemoteFolderId,
      pendingRemoteFolderTitle: _pendingRemoteFolderTitle,
      ...ledgerWithoutRemoteBinding
    } = ledger
    if (!ledger.isDefault) return { ...ledgerWithoutRemoteBinding, bindingState: 'unbacked' }
    return {
      ...restoreDefaultFavoriteLedgerAfterLocalDeletion(ledger),
      bindingState: 'unbacked',
      confirmedDeletedRemoteFolderIds
    }
  })
  return settledLedgers.filter((ledger) => !isPureRemoteObservationDraft(ledger, confirmedDeletedRemoteFolderIds))
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
