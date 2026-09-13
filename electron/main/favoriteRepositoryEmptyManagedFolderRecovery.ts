import type { FavoriteRepositoryCommandResult } from '../../src/shared/favoriteRepository'
import type { FavoriteLedger } from '../../src/shared/types'
import { restoreEmptyFavoriteLibraryManagedFolderProjection } from './favoriteLibraryManagedFolderProjection'

/**
 * Coalesces the local-only restoration requested after a previous local
 * work-folder deletion. It deliberately has no WebView or remote-operation
 * dependency: retained physical shard metadata is enough to recreate a shell.
 */
export class FavoriteRepositoryEmptyManagedFolderRecovery {
  private readonly pendingByAccount = new Map<string, Promise<void>>()

  constructor(private readonly options: {
    repository: {
      getSnapshot: (accountMid: string) => Promise<import('../../src/shared/favoriteRepository').AccountFavoriteRepositorySnapshot>
      commit: (accountMid: string, command: import('../../src/shared/favoriteRepository').FavoriteRepositoryCommand) => Promise<unknown>
    }
    loadFavoriteLedgers: (accountMid: string) => Promise<readonly FavoriteLedger[]> | readonly FavoriteLedger[]
    now?: () => string
  }) {}

  async restoreForLocalRead(accountMid: string) {
    const existing = this.pendingByAccount.get(accountMid)
    if (existing) return existing
    const pending = (async () => {
      const ledgers = await this.options.loadFavoriteLedgers(accountMid)
      await restoreEmptyFavoriteLibraryManagedFolderProjection({
        accountMid,
        repository: this.options.repository,
        ledgers,
        now: this.options.now
      })
    })().finally(() => {
      if (this.pendingByAccount.get(accountMid) === pending) this.pendingByAccount.delete(accountMid)
    })
    this.pendingByAccount.set(accountMid, pending)
    return pending
  }

  async afterRepositoryActivity(result: FavoriteRepositoryCommandResult) {
    if (/^(managed-folder:delete-local:|favorite-library:restore-empty-managed:)/.test(result.commandId)) return
    await this.restoreForLocalRead(result.accountMid)
  }
}
