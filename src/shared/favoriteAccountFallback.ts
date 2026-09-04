type FavoriteAccountProjection = {
  favoriteLedgers?: unknown
}

/**
 * Uses device-local favorite rules only when they identify one unambiguous
 * account. This is deliberately not a login fallback for remote operations.
 */
export function findSoleFavoriteAccountMid(
  accounts: Record<string, FavoriteAccountProjection> | undefined
): string {
  const validAccountMids = Object.entries(accounts ?? {}).flatMap(([accountMid, account]) => {
    if (!/^\d+$/u.test(accountMid) || BigInt(accountMid) === 0n || !Array.isArray(account?.favoriteLedgers)) {
      return []
    }
    return [BigInt(accountMid).toString()]
  })
  return validAccountMids.length === 1 ? validAccountMids[0] : ''
}

export function resolveLocalFavoriteLedgerToggleAccountMid(
  accounts: Record<string, FavoriteAccountProjection> | undefined,
  ledgerId: string
): string {
  const accountMid = findSoleFavoriteAccountMid(accounts)
  if (!accountMid) return ''
  const ledgers = accounts?.[accountMid]?.favoriteLedgers
  if (!Array.isArray(ledgers)) return ''
  const target = ledgers.find((ledger) => {
    if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) return false
    const candidate = ledger as Record<string, unknown>
    return candidate.id === ledgerId &&
      candidate.isDefault === false &&
      candidate.ruleOrigin === 'saved-rule' &&
      candidate.bindingState === 'unbacked' &&
      !String(candidate.bilibiliFolderId ?? '').trim() &&
      !(Array.isArray(candidate.bilibiliFolderIds) && candidate.bilibiliFolderIds.some((folderId) => String(folderId).trim()))
  })
  return target ? accountMid : ''
}
