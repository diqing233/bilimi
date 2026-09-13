import {
  applyConfirmedManagedFavoriteRemoteFolderDeletion,
  restoreDefaultFavoriteLedgerAfterLocalDeletion
} from '../../src/shared/favoriteLedgerDeletion'
import { isPersistableFavoriteLedgerId } from '../../src/shared/favoriteLedgers'
import type { FavoriteAccountPreferences } from '../../src/shared/types'
import type { PersistedManagedFolderDeletion } from './favoriteRepositoryManagedFolderService'

function normalizedHiddenLedgerIds(ids: Iterable<string>) {
  return [...new Set([...ids]
    .map((logicalLedgerId) => logicalLedgerId.trim())
    .filter((logicalLedgerId) => isPersistableFavoriteLedgerId(logicalLedgerId)))].sort()
}

export async function persistLocalManagedFolderHiddenIds(
  accountMid: string,
  logicalLedgerIds: readonly string[],
  options: {
    load: (accountMid: string) => FavoriteAccountPreferences
    save: (accountMid: string, preferences: FavoriteAccountPreferences) => unknown | Promise<unknown>
    publish: () => unknown | Promise<unknown>
  }
) {
  const current = options.load(accountMid)
  const before = normalizedHiddenLedgerIds(current.hiddenFavoriteLibraryManagedLedgerIds ?? [])
  const next = normalizedHiddenLedgerIds([...before, ...logicalLedgerIds])
  const added = next.filter((logicalLedgerId) => !before.includes(logicalLedgerId))
  if (!added.length) return undefined
  let saved = false
  try {
    await options.save(accountMid, { ...current, hiddenFavoriteLibraryManagedLedgerIds: next })
    saved = true
    await options.publish()
  } catch (error) {
    if (saved) {
      try {
        const latest = options.load(accountMid)
        const previous = normalizedHiddenLedgerIds(latest.hiddenFavoriteLibraryManagedLedgerIds ?? [])
        const remaining = normalizedHiddenLedgerIds(previous.filter((logicalLedgerId) => !added.includes(logicalLedgerId)))
        if (JSON.stringify(previous) !== JSON.stringify(remaining)) {
          await options.save(accountMid, {
            ...latest,
            ...(remaining.length ? { hiddenFavoriteLibraryManagedLedgerIds: remaining } : { hiddenFavoriteLibraryManagedLedgerIds: undefined })
          })
        }
      } catch {
        // Preserve the original publication failure. The deletion command will
        // not execute, and the next normal preference write can reconcile this.
      }
    }
    throw error
  }
  return async () => {
    const latest = options.load(accountMid)
    const remaining = normalizedHiddenLedgerIds((latest.hiddenFavoriteLibraryManagedLedgerIds ?? [])
      .filter((logicalLedgerId) => !added.includes(logicalLedgerId)))
    if (JSON.stringify(remaining) === JSON.stringify(normalizedHiddenLedgerIds(latest.hiddenFavoriteLibraryManagedLedgerIds ?? []))) return
    await options.save(accountMid, {
      ...latest,
      ...(remaining.length ? { hiddenFavoriteLibraryManagedLedgerIds: remaining } : { hiddenFavoriteLibraryManagedLedgerIds: undefined })
    })
    await options.publish()
  }
}

export async function consumeLocalManagedFolderHiddenIds(
  accountMid: string,
  logicalLedgerIds: readonly string[],
  options: {
    load: (accountMid: string) => FavoriteAccountPreferences
    save: (accountMid: string, preferences: FavoriteAccountPreferences) => unknown | Promise<unknown>
    publish: () => unknown | Promise<unknown>
  }
) {
  const current = options.load(accountMid)
  const consumed = new Set(normalizedHiddenLedgerIds(logicalLedgerIds))
  const before = normalizedHiddenLedgerIds(current.hiddenFavoriteLibraryManagedLedgerIds ?? [])
  const remaining = before.filter((logicalLedgerId) => !consumed.has(logicalLedgerId))
  if (remaining.length === before.length) return false
  await options.save(accountMid, {
    ...current,
    ...(remaining.length ? { hiddenFavoriteLibraryManagedLedgerIds: remaining } : { hiddenFavoriteLibraryManagedLedgerIds: undefined })
  })
  await options.publish()
  return true
}

export async function persistConfirmedManagedFolderDeletion(
  accountMid: string,
  deletions: readonly PersistedManagedFolderDeletion[],
  options: {
    load: (accountMid: string) => FavoriteAccountPreferences
    save: (accountMid: string, preferences: FavoriteAccountPreferences) => unknown | Promise<unknown>
    publish: () => unknown | Promise<unknown>
  }
) {
  const current = options.load(accountMid)
  const deletedRemoteFolderIdsByLedger = new Map<string, Set<string>>()
  const confirmedAbsentDefaultLedgerIds = new Set<string>()
  for (const deletion of deletions
    .filter((deletion) => deletion.remoteDeleted)
  ) {
    const logicalLedgerId = deletion.logicalLedgerId.trim()
    if (!logicalLedgerId) continue
    const remoteFolderIds = deletedRemoteFolderIdsByLedger.get(logicalLedgerId) ?? new Set<string>()
    deletion.remoteFolderIds.map((remoteFolderId) => remoteFolderId.trim()).filter(Boolean).forEach((remoteFolderId) => remoteFolderIds.add(remoteFolderId))
    deletedRemoteFolderIdsByLedger.set(logicalLedgerId, remoteFolderIds)
  }
  for (const deletion of deletions.filter((deletion) => deletion.remoteConfirmedAbsent)) {
    const logicalLedgerId = deletion.logicalLedgerId.trim()
    if (logicalLedgerId) confirmedAbsentDefaultLedgerIds.add(logicalLedgerId)
  }
  const remotelyProjectedLedgers = applyConfirmedManagedFavoriteRemoteFolderDeletion(current.favoriteLedgers, deletedRemoteFolderIdsByLedger)
  const favoriteLedgers = remotelyProjectedLedgers.map((ledger) => {
    if (!ledger.isDefault || ledger.bindingState !== 'unbound' || !confirmedAbsentDefaultLedgerIds.has(ledger.id)) return ledger
    return { ...restoreDefaultFavoriteLedgerAfterLocalDeletion(ledger), bindingState: 'unbacked' as const }
  })
  if (JSON.stringify(favoriteLedgers) === JSON.stringify(current.favoriteLedgers)) return false
  await options.save(accountMid, { ...current, favoriteLedgers })
  await options.publish()
  return true
}
