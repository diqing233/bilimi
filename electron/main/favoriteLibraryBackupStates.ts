import { favoriteLedgerBackupState, type FavoriteLedgerBackupState } from '../../src/shared/favoriteLedgerBackupState'
import type { FavoriteLedger } from '../../src/shared/types'

export function favoriteLedgerBackupStatesForLibrary(
  ledgers: readonly FavoriteLedger[],
  summary: {
    physicalShardCount?: number
    physicalShards: Array<{ logicalLedgerId: string; bindingState: string; remoteFolderId?: string }>
    folders?: Array<{ kind: string; logicalLedgerId?: string }>
  }
): Record<string, FavoriteLedgerBackupState> {
  const physicalShardDetailsIncomplete = Number(summary.physicalShardCount ?? 0) !== summary.physicalShards.length
  return Object.fromEntries(ledgers.map((ledger) => {
    const shards = summary.physicalShards.filter((shard) => shard.logicalLedgerId === ledger.id)
    const hasFormalPhysicalBinding = shards.length > 0 && shards.every((shard) =>
      shard.bindingState === 'bound' && Boolean(shard.remoteFolderId?.trim()))
    const hasPartialPhysicalBinding = !hasFormalPhysicalBinding && shards.some((shard) =>
      shard.bindingState === 'bound' && Boolean(shard.remoteFolderId?.trim()))
    const hasUnresolvedPhysicalBinding = (!hasFormalPhysicalBinding && shards.length > 0) ||
      (physicalShardDetailsIncomplete && (shards.length > 0 || summary.folders?.some((folder) =>
        folder.kind === 'bilimi-logical' && folder.logicalLedgerId === ledger.id)))
    const unboundLedgerIds = [
      ...(hasUnresolvedPhysicalBinding ? [ledger.id] : []),
      ...(ledger.bindingState === 'unbound' ? [ledger.id] : [])
    ]
    return [ledger.id, favoriteLedgerBackupState(ledger, {
      hasFormalPhysicalBinding,
      hasPartialPhysicalBinding,
      ...(unboundLedgerIds.length ? { unboundLedgerIds } : {})
    })]
  }))
}
