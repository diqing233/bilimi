import type { FavoriteArchiveMultiMode, FavoriteLedger, FavoriteLedgerId } from '@shared/types'
import { planFavoriteArchiveTargets } from './archivePlanning'
import type { VideoContentContext } from './videoClassifier'

export type FavoriteReviewWriteFallback = 'direct' | 'matching-bound' | 'inbox' | 'none'

export type FavoriteReviewWriteTargetPlan = {
  suggestedLedgerIds: FavoriteLedgerId[]
  writeLedgerIds: FavoriteLedgerId[]
  fallback: FavoriteReviewWriteFallback
}

/**
 * A local classification is allowed to reference every saved enabled rule.
 * A Bilibili write is narrower: only a formally bound rule with a concrete
 * remote folder id may receive the video.
 */
export function isFavoriteLedgerRemoteWritable(ledger: FavoriteLedger): boolean {
  return ledger.enabled &&
    ledger.syncState !== 'local-draft' &&
    Boolean(ledger.bilibiliFolderId?.trim()) &&
    (ledger.bindingState === 'bound' || ledger.bindingState === undefined)
}

export function planFavoriteReviewWriteTargets(args: {
  context: VideoContentContext
  ledgers: FavoriteLedger[]
  multiArchiveMode: FavoriteArchiveMultiMode
}): FavoriteReviewWriteTargetPlan {
  const suggestedTargets = planFavoriteArchiveTargets({
    context: args.context,
    ledgers: args.ledgers,
    multiArchiveMode: args.multiArchiveMode
  })
  const suggestedLedgerIds = suggestedTargets.map((target) => target.ledgerId)
  const directlyWritableLedgerIds = suggestedLedgerIds.filter((ledgerId) =>
    args.ledgers.some((ledger) => ledger.id === ledgerId && isFavoriteLedgerRemoteWritable(ledger))
  )

  if (directlyWritableLedgerIds.length > 0) {
    return { suggestedLedgerIds, writeLedgerIds: directlyWritableLedgerIds, fallback: 'direct' }
  }

  const boundTargets = planFavoriteArchiveTargets({
    context: args.context,
    ledgers: args.ledgers.filter(isFavoriteLedgerRemoteWritable),
    multiArchiveMode: args.multiArchiveMode
  })
  const writeLedgerIds = boundTargets.map((target) => target.ledgerId)
  const fallback = writeLedgerIds.length === 0
    ? 'none'
    : writeLedgerIds.every((ledgerId) => ledgerId === 'inbox')
      ? 'inbox'
      : 'matching-bound'

  return { suggestedLedgerIds, writeLedgerIds, fallback }
}
