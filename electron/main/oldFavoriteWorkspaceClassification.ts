import type { FavoriteLedger } from '../../src/shared/types'

export async function classifyOldFavoriteItemsCooperatively<Item, Result>(
  items: readonly Item[],
  classifyBatch: (items: Item[]) => Result[] | Promise<Result[]>,
  options: {
    batchSize?: number
    yieldToEventLoop?: () => Promise<void>
    onBatchComplete?: (completedItemCount: number, totalItemCount: number) => void
    shouldCancel?: () => boolean
  } = {}
) {
  const batchSize = Math.max(1, Math.floor(options.batchSize ?? 128))
  const yieldToEventLoop = options.yieldToEventLoop ?? (() => new Promise<void>((resolve) => setImmediate(resolve)))
  const results: Result[] = []
  for (let start = 0; start < items.length; start += batchSize) {
    if (start > 0) await yieldToEventLoop()
    if (options.shouldCancel?.()) throw new Error('Old favorite preview preparation canceled.')
    results.push(...await classifyBatch(items.slice(start, start + batchSize)))
    options.onBatchComplete?.(Math.min(start + batchSize, items.length), items.length)
  }
  return results
}

/** Keeps staging available even when an account opts out of bilimi defaults. */
export function classifierLedgersForAccount(
  savedLedgers: FavoriteLedger[],
  defaultFavoriteSystemEnabled: boolean
) {
  return savedLedgers
    // `syncState` is a transport/provisioning state, not the rule's local
    // classification identity. A saved rule can remain local-draft after its
    // Bilibili binding is lost and must still participate in this round. Only
    // an explicitly marked recommendation draft with a remote id is treated
    // as a recovered remote-only draft here.
    .filter((ledger) => ledger.syncState !== 'local-draft' ||
      ledger.ruleOrigin === 'saved-rule' || !ledger.bilibiliFolderId)
    .filter((ledger) => defaultFavoriteSystemEnabled || !ledger.isDefault || ledger.id === 'inbox')
    .map((ledger) => ({ ...ledger, keywords: [...ledger.keywords] }))
}

/** Starting an organization round restores every default selection, including staging. */
export function enableDefaultLedgersForOrganization(
  savedLedgers: FavoriteLedger[],
  defaultFavoriteSystemEnabled: boolean
) {
  if (!defaultFavoriteSystemEnabled) return savedLedgers
  return savedLedgers.map((ledger) => ledger.isDefault
    ? { ...ledger, enabled: true, keywords: [...ledger.keywords] }
    : ledger)
}

/** Gives adopted workspace recommendations precedence without mutating saved preferences. */
export function mergeOldFavoriteWorkspaceLedgers(
  savedLedgers: FavoriteLedger[],
  recommendedLedgers: FavoriteLedger[],
  excludedRecommendedLedgers: FavoriteLedger[] = []
) {
  const availableSavedLedgers = savedLedgers.filter((saved) =>
    !excludedRecommendedLedgers.some((excluded) =>
      excluded.id === saved.id &&
      !recommendedLedgers.some((recommended) => recommended.id === saved.id)))
  const consumedSavedIds = new Set<string>()
  const resolvedRecommendations = recommendedLedgers.map((recommended) => {
    const exactId = availableSavedLedgers.find((ledger) => !consumedSavedIds.has(ledger.id) && ledger.id === recommended.id)
    if (exactId) {
      consumedSavedIds.add(exactId.id)
      return {
        ...recommended,
        keywords: [...recommended.keywords],
        syncState: exactId.syncState,
        bindingState: exactId.bindingState,
        bilibiliFolderId: exactId.bilibiliFolderId,
        bilibiliFolderIds: exactId.bilibiliFolderIds ? [...exactId.bilibiliFolderIds] : undefined,
        managedFolderDeletedByUser: exactId.managedFolderDeletedByUser
      }
    }
    return { ...recommended, keywords: [...recommended.keywords] }
  })
  return [
    ...resolvedRecommendations,
    ...availableSavedLedgers
      .filter((ledger) => !consumedSavedIds.has(ledger.id) && !recommendedLedgers.some((recommended) => recommended.id === ledger.id))
      .map((ledger) => ({ ...ledger, keywords: [...ledger.keywords] }))
  ]
}
