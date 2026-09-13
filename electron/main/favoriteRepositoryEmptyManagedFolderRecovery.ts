import type { FavoriteRepositoryCommandResult } from '../../src/shared/favoriteRepository'
import type { FavoriteLedger } from '../../src/shared/types'
import { restoreEmptyFavoriteLibraryManagedFolderProjection } from './favoriteLibraryManagedFolderProjection'

/**
 * Coalesces the local-only restoration requested after a previous local
 * work-folder deletion. It deliberately has no WebView or remote-operation
 * dependency: retained physical shard metadata is enough to recreate a shell.
 */
export class FavoriteRepositoryEmptyManagedFolderRecovery {
  private readonly pendingByAccount = new Map<string, Promise<string[]>>()
  private readonly explicitRecoveryByAccount = new Map<string, Promise<string[]>>()
  private readonly accountLocks = new Map<string, Promise<void>>()

  constructor(private readonly options: {
    repository: {
      getSnapshot: (accountMid: string) => Promise<import('../../src/shared/favoriteRepository').AccountFavoriteRepositorySnapshot>
      commit: (accountMid: string, command: import('../../src/shared/favoriteRepository').FavoriteRepositoryCommand) => Promise<unknown>
    }
    loadFavoriteLedgers: (accountMid: string) => Promise<readonly FavoriteLedger[]> | readonly FavoriteLedger[]
    loadHiddenFavoriteLibraryManagedLedgerIds?: (accountMid: string) => Promise<readonly string[]> | readonly string[]
    consumeHiddenFavoriteLibraryManagedLedgerIds?: (accountMid: string, logicalLedgerIds: string[]) => Promise<void> | void
    now?: () => string
  }) {}

  async restoreForLocalRead(accountMid: string) {
    // An explicit action may be between its completion callback and its local
    // recovery commit. Let it finish first so an ordinary read cannot launch
    // an excluded-mode restore and absorb that authorized recovery.
    const explicitRecovery = this.explicitRecoveryByAccount.get(accountMid)
    if (explicitRecovery) {
      await explicitRecovery
      return []
    }
    return this.runWithAccountLock(accountMid, async () => {
      const hiddenLedgerIds = await this.options.loadHiddenFavoriteLibraryManagedLedgerIds?.(accountMid) ?? []
      return this.restore(accountMid, hiddenLedgerIds)
    })
  }

  async runWithLocalManagedFolderDeletion<T>(accountMid: string, operation: () => Promise<T> | T) {
    return this.runWithAccountLock(accountMid, operation)
  }

  /**
   * A user-completed business action may restore a locally deleted shell.
   * It must never join a preceding technical read: that read deliberately
   * excludes the persisted hidden IDs, whereas this action is the only
   * authorized transition that can consume those IDs.
   */
  restoreAfterExplicitBusinessAction(accountMid: string) {
    const existing = this.explicitRecoveryByAccount.get(accountMid)
    if (existing) return existing
    let pending: Promise<string[]>
    pending = this.runWithAccountLock(accountMid, () => this.runExplicitBusinessRecovery(accountMid)).finally(() => {
      if (this.explicitRecoveryByAccount.get(accountMid) === pending) {
        this.explicitRecoveryByAccount.delete(accountMid)
      }
    })
    this.explicitRecoveryByAccount.set(accountMid, pending)
    return pending
  }

  private async runExplicitBusinessRecovery(accountMid: string) {
    await this.pendingByAccount.get(accountMid)
    const hiddenLedgerIds = [...new Set(await this.options.loadHiddenFavoriteLibraryManagedLedgerIds?.(accountMid) ?? [])]
    if (!hiddenLedgerIds.length) return []
    const restoredLedgerIds = await this.restore(accountMid, [])
    const snapshot = await this.options.repository.getSnapshot(accountMid)
    const consumedLedgerIds = hiddenLedgerIds.filter((logicalLedgerId) =>
      restoredLedgerIds.includes(logicalLedgerId) || snapshot.folders.some((folder) =>
        folder.kind === 'bilimi-logical' && folder.logicalLedgerId === logicalLedgerId))
    if (consumedLedgerIds.length) await this.options.consumeHiddenFavoriteLibraryManagedLedgerIds?.(accountMid, consumedLedgerIds)
    return restoredLedgerIds
  }

  private async runWithAccountLock<T>(accountMid: string, operation: () => Promise<T> | T): Promise<T> {
    const previous = this.accountLocks.get(accountMid) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    this.accountLocks.set(accountMid, current)
    await previous
    try {
      return await operation()
    } finally {
      release()
      if (this.accountLocks.get(accountMid) === current) this.accountLocks.delete(accountMid)
    }
  }

  private async restore(accountMid: string, excludedLogicalLedgerIds: readonly string[]) {
    const existing = this.pendingByAccount.get(accountMid)
    if (existing) return existing
    const pending = (async () => {
      const ledgers = await this.options.loadFavoriteLedgers(accountMid)
      return restoreEmptyFavoriteLibraryManagedFolderProjection({
        accountMid,
        repository: this.options.repository,
        ledgers,
        excludedLogicalLedgerIds,
        now: this.options.now
      })
    })().finally(() => {
      if (this.pendingByAccount.get(accountMid) === pending) this.pendingByAccount.delete(accountMid)
    })
    this.pendingByAccount.set(accountMid, pending)
    return pending
  }

  async afterRepositoryActivity(result: FavoriteRepositoryCommandResult) {
    if (!this.isExplicitRestoreAction(result.commandId)) return
    await this.restoreAfterExplicitBusinessAction(result.accountMid)
  }

  private isExplicitRestoreAction(commandId: string) {
    return /^(?:favorite-library:video:|review-favorite:|legacy-confirmed-review:|old-favorite-workspace:(?:local|remote-local|source-pending|lifecycle|observed|mirror|recover-managed-bindings):|favorite-binding:|favorite-adoption:|favorite-adoption-title-repair:)/.test(commandId)
  }
}
