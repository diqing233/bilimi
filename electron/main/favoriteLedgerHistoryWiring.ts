import type { OldFavoriteWorkspaceFavoriteRuleHistoryState } from '../../src/shared/oldFavoriteWorkspace'

export type FavoriteLedgerHistoryWiring = {
  get: (accountMid: string) => Promise<OldFavoriteWorkspaceFavoriteRuleHistoryState | undefined>
  record: (
    accountMid: string,
    transition: {
      before: OldFavoriteWorkspaceFavoriteRuleHistoryState
      after: OldFavoriteWorkspaceFavoriteRuleHistoryState
    }
  ) => Promise<unknown>
}

/**
 * Captures rule state in the main process so renderer preference mirrors never
 * become the source of truth for a reversible organization history entry.
 */
export async function recordFavoriteLedgerHistoryAroundMutation<T>(
  accountMid: string | undefined,
  wiring: FavoriteLedgerHistoryWiring | undefined,
  mutate: () => Promise<T>
): Promise<T> {
  const before = accountMid && wiring ? await wiring.get(accountMid) : undefined
  const result = await mutate()
  if (accountMid && wiring && before) {
    const after = await wiring.get(accountMid)
    if (after) await wiring.record(accountMid, { before, after })
  }
  return result
}
