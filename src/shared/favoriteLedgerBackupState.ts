import type { FavoriteLedger } from './types'

export type FavoriteLedgerBackupState = 'backed' | 'unbacked' | 'unbound' | 'partial'

export type FavoriteLedgerBackupStateInput = {
  missingLedgerIds?: readonly string[]
  unboundLedgerIds?: readonly string[]
  hasFormalPhysicalBinding?: boolean
  hasPartialPhysicalBinding?: boolean
}

export const FAVORITE_LEDGER_BACKUP_STATE_LABEL: Record<FavoriteLedgerBackupState, string> = {
  backed: '已备册',
  unbacked: '未备册',
  unbound: '未绑定',
  partial: '部分已备册 · 仍待绑定'
}

/**
 * Resolves every backup surface from the same authoritative facts. A formal
 * shard together with any unresolved evidence is deliberately partial, never
 * silently upgraded to “已备册”.
 */
export function favoriteLedgerBackupState(
  ledger: FavoriteLedger,
  input: FavoriteLedgerBackupStateInput = {}
): FavoriteLedgerBackupState {
  const missing = new Set(input.missingLedgerIds ?? []).has(ledger.id)
  const unbound = new Set(input.unboundLedgerIds ?? []).has(ledger.id) || ledger.bindingState === 'unbound'
  const formal = input.hasFormalPhysicalBinding ?? (
    ledger.bindingState === 'bound' && Boolean(ledger.bilibiliFolderId?.trim() || ledger.bilibiliFolderIds?.some((id) => id.trim()))
  )

  if (ledger.managedFolderDeletedByUser) return 'unbound'
  if (input.hasPartialPhysicalBinding) return 'partial'
  if (ledger.bindingState === 'unbound' && !formal && input.unboundLedgerIds === undefined) return 'unbacked'
  if (formal && (missing || unbound)) return 'partial'
  if (unbound) return 'unbound'
  if (ledger.syncState === 'local-draft' || ledger.bindingState === 'unbacked' || missing || !formal) return 'unbacked'
  return 'backed'
}

export function favoriteLedgerBackupStateLabel(
  ledger: FavoriteLedger,
  input: FavoriteLedgerBackupStateInput = {}
) {
  return FAVORITE_LEDGER_BACKUP_STATE_LABEL[favoriteLedgerBackupState(ledger, input)]
}
