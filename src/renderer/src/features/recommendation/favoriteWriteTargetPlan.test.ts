import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import type { FavoriteLedger } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { planFavoriteReviewWriteTargets } from './favoriteWriteTargetPlan'

function ledgersWith(overrides: Record<string, Partial<FavoriteLedger>>) {
  return createDefaultFavoriteLedgers().map((ledger) => ({ ...ledger, ...overrides[ledger.id] }))
}

describe('planFavoriteReviewWriteTargets', () => {
  it('keeps the best unbacked rule as the local suggestion and writes to the best matching bound rule', () => {
    const ledgers = [
      ...ledgersWith({
        game: { enabled: false },
        inbox: { bilibiliFolderId: 'remote-inbox', bindingState: 'bound' }
      }),
      {
        id: 'custom-best', displayName: 'bilimi·游戏攻略', keywords: ['游戏攻略'], enabled: true,
        priority: 1, isDefault: false, bindingState: 'unbacked' as const
      },
      {
        id: 'custom-backed', displayName: 'bilimi·游戏', keywords: ['游戏'], enabled: true,
        priority: 10, isDefault: false, bilibiliFolderId: 'remote-game', bindingState: 'bound' as const
      }
    ]

    expect(planFavoriteReviewWriteTargets({ context: { title: '游戏攻略' }, ledgers, multiArchiveMode: 'off' })).toMatchObject({
      suggestedLedgerIds: ['custom-best'],
      writeLedgerIds: ['custom-backed'],
      fallback: 'matching-bound'
    })
  })

  it('writes to backed 暂存 when no matching rule is remotely writable', () => {
    const ledgers = [
      ...ledgersWith({ inbox: { bilibiliFolderId: 'remote-inbox', bindingState: 'bound' } }),
      {
        id: 'custom-best', displayName: 'bilimi·游戏攻略', keywords: ['游戏攻略'], enabled: true,
        priority: 1, isDefault: false, bindingState: 'unbacked' as const
      }
    ]

    expect(planFavoriteReviewWriteTargets({ context: { title: '游戏攻略' }, ledgers, multiArchiveMode: 'off' })).toMatchObject({
      suggestedLedgerIds: ['custom-best'],
      writeLedgerIds: ['inbox'],
      fallback: 'inbox'
    })
  })

  it('keeps the local suggestion only when neither a bound match nor backed 暂存 exists', () => {
    const ledgers = [
      ...ledgersWith({ inbox: { bindingState: 'unbacked' } }),
      {
        id: 'custom-best', displayName: 'bilimi·游戏攻略', keywords: ['游戏攻略'], enabled: true,
        priority: 1, isDefault: false, bindingState: 'unbound' as const
      }
    ]

    expect(planFavoriteReviewWriteTargets({ context: { title: '游戏攻略' }, ledgers, multiArchiveMode: 'off' })).toMatchObject({
      suggestedLedgerIds: ['custom-best'],
      writeLedgerIds: [],
      fallback: 'none'
    })
  })

})
