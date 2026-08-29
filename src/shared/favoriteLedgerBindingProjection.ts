import type { FavoriteLedger } from './types'
import type { FavoriteRepositoryPhysicalShard } from './favoriteRepository'

/**
 * Rehydrates account-level binding fields from the repository's formal shard
 * records. The repository is authoritative for remote IDs; all other rule
 * fields remain untouched so this projection cannot change user preferences.
 */
export function projectFavoriteLedgersFromPhysicalShards(
  ledgers: readonly FavoriteLedger[],
  physicalShards: readonly FavoriteRepositoryPhysicalShard[]
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
    if (!remoteFolderIds?.length) return ledger
    return {
      ...ledger,
      bilibiliFolderId: remoteFolderIds[0],
      bilibiliFolderIds: remoteFolderIds,
      bindingState: 'bound' as const
    }
  })
}
