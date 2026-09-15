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

function isWorkspaceNotStartedError(error: unknown): boolean {
  return error instanceof Error && error.message === 'Old favorite workspace has not been started.'
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
  let before: OldFavoriteWorkspaceFavoriteRuleHistoryState | undefined
  if (accountMid && wiring) {
    try {
      before = await wiring.get(accountMid)
    } catch (error) {
      if (!isWorkspaceNotStartedError(error)) throw error
    }
  }
  const result = await mutate()
  if (accountMid && wiring && before) {
    const after = await wiring.get(accountMid)
    if (after) await wiring.record(accountMid, { before, after })
  }
  return result
}
