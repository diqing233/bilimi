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
    .filter((ledger) => ledger.syncState !== 'local-draft' || !ledger.bilibiliFolderId)
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
  recommendedLedgers: FavoriteLedger[]
) {
  const recommendedIds = new Set(recommendedLedgers.map((ledger) => ledger.id))
  return [
    ...recommendedLedgers.map((ledger) => ({ ...ledger, keywords: [...ledger.keywords] })),
    ...savedLedgers
      .filter((ledger) => !recommendedIds.has(ledger.id))
      .map((ledger) => ({ ...ledger, keywords: [...ledger.keywords] }))
  ]
}
