import type { FavoriteLedger } from './types'
import type { FavoriteRepositoryPhysicalShard } from './favoriteRepository'

/**
 * Rehydrates account-level binding fields from the repository's formal shard
 * records. The repository is authoritative for remote IDs; all other rule
 * fields remain untouched so this projection cannot change user preferences.
 */
export function projectFavoriteLedgersFromPhysicalShards(
  ledgers: readonly FavoriteLedger[],
  physicalShards: readonly FavoriteRepositoryPhysicalShard[],
  options: { recoverUserConfirmedAdoptions?: boolean } = {}
): FavoriteLedger[] {
  const boundIdsByLedger = new Map<string, string[]>()
  const shardsByLedger = new Map<string, FavoriteRepositoryPhysicalShard[]>()

  for (const shard of physicalShards) {
    if (shard.bindingState !== 'bound' || !shard.remoteFolderId?.trim()) continue
    const shards = shardsByLedger.get(shard.logicalLedgerId) ?? []
    shards.push(shard)
    shardsByLedger.set(shard.logicalLedgerId, shards)
  }

  for (const [logicalLedgerId, shards] of shardsByLedger) {
    const ids = [...new Map(
      [...shards]
        .sort((left, right) => left.shardNumber - right.shardNumber || left.folderId.localeCompare(right.folderId))
        .map((shard) => [shard.remoteFolderId!.trim(), shard.remoteFolderId!.trim()])
    ).values()]
    if (ids.length) boundIdsByLedger.set(logicalLedgerId, ids)
  }

  return ledgers.map((ledger) => {
    const remoteFolderIds = boundIdsByLedger.get(ledger.id)
    if (!remoteFolderIds?.length) {
      // The repository is authoritative for formal bindings. When the last
      // shard is removed, discard stale account-level remote fields so the
      // assistant and Favorite Library converge on the same unbacked state.
      if (ledger.bindingState !== 'bound') return ledger
      const {
        bilibiliFolderId: _bilibiliFolderId,
        bilibiliFolderIds: _bilibiliFolderIds,
        bilibiliFolderTitle: _bilibiliFolderTitle,
        bilibiliFolderVideoCount: _bilibiliFolderVideoCount,
        bindingState: _bindingState,
        ...unboundLedger
      } = ledger
      return { ...unboundLedger, bindingState: 'unbacked' as const }
    }
    const confirmedAdoptionIds = options.recoverUserConfirmedAdoptions
      ? (shardsByLedger.get(ledger.id) ?? [])
          .filter((shard) => shard.userConfirmedAdoption === true && shard.remoteFolderId?.trim())
          .map((shard) => shard.remoteFolderId!.trim())
      : []
    if (ledger.managedFolderDeletedByUser && confirmedAdoptionIds.length) {
      const confirmedAdoptionIdSet = new Set(confirmedAdoptionIds)
      const {
        managedFolderDeletedByUser: _managedFolderDeletedByUser,
        confirmedDeletedRemoteFolderIds: _confirmedDeletedRemoteFolderIds,
        pendingRemoteBinding: _pendingRemoteBinding,
        pendingRemoteBindingCreatedByBackup: _pendingRemoteBindingCreatedByBackup,
        pendingRemoteFolderId: _pendingRemoteFolderId,
        pendingRemoteFolderTitle: _pendingRemoteFolderTitle,
        ...recoveredLedger
      } = ledger
      const remainingDeletedRemoteFolderIds = (ledger.confirmedDeletedRemoteFolderIds ?? [])
        .filter((remoteFolderId) => !confirmedAdoptionIdSet.has(remoteFolderId.trim()))
      return {
        ...recoveredLedger,
        bilibiliFolderId: remoteFolderIds[0],
        bilibiliFolderIds: remoteFolderIds,
        bindingState: 'bound' as const,
        ...(remainingDeletedRemoteFolderIds.length
          ? { confirmedDeletedRemoteFolderIds: remainingDeletedRemoteFolderIds }
          : {})
      }
    }
    return {
      ...ledger,
      bilibiliFolderId: remoteFolderIds[0],
      bilibiliFolderIds: remoteFolderIds,
      bindingState: 'bound' as const
    }
  })
}
