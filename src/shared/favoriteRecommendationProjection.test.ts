import { describe, expect, it } from 'vitest'
import type { FavoriteLedger } from './types'
import { buildFavoriteRecommendationLinks } from './favoriteRecommendationProjection'

const candidate = {
  id: 'scan:author:merlin-fit',
  displayName: 'bilimi·梅林FIT',
  kind: 'author' as const,
  keywords: ['梅林FIT'],
  count: 3,
  reason: '专属 UP 追更'
}

function ordinaryLedger(patch: Partial<FavoriteLedger> = {}): FavoriteLedger {
  return {
    id: 'custom-user-1',
    displayName: 'bilimi·梅林FIT',
    ruleType: 'author',
    keywords: ['梅林FIT'],
    enabled: false,
    priority: 10,
    isDefault: false,
    ruleOrigin: 'saved-rule',
    ...patch
  }
}

describe('favorite recommendation projection', () => {
  it('links only one ordinary ledger with the same normalized name and rule semantics', () => {
    expect(buildFavoriteRecommendationLinks([candidate], [ordinaryLedger({
      displayName: ' ｂｉｌｉｍｉ·梅林FIT ',
      keywords: [' 梅林FIT ', '梅林FIT']
    })])).toEqual({
      [candidate.id]: { status: 'linked', ledgerId: 'custom-user-1' }
    })
  })

  it.each([
    ['renamed', { displayName: 'bilimi·我的梅林' }],
    ['different type', { ruleType: 'tag' as const }],
    ['different keywords', { keywords: ['梅林'] }]
  ])('does not link a %s ledger', (_label, patch) => {
    expect(buildFavoriteRecommendationLinks([candidate], [ordinaryLedger(patch)])).toEqual({
      [candidate.id]: { status: 'unlinked' }
    })
  })

  it('reports ambiguity instead of choosing or creating a third rule', () => {
    expect(buildFavoriteRecommendationLinks([candidate], [
      ordinaryLedger({ id: 'a' }),
      ordinaryLedger({ id: 'b' })
    ])).toEqual({
      [candidate.id]: { status: 'ambiguous', ledgerIds: ['a', 'b'] }
    })
  })

  it('does not link the historical 梅林FIT rule to a differently named candidate', () => {
    const legacyBoundRule = ordinaryLedger({
      id: 'legacy-merlin',
      bilibiliFolderId: '4065678011',
      bilibiliFolderTitle: 'bilimi小咪的收藏夹',
      bindingState: 'bound'
    })
    const differentCandidate = { ...candidate, displayName: 'bilimi·小咪', keywords: ['小咪'] }

    expect(buildFavoriteRecommendationLinks([differentCandidate], [legacyBoundRule])).toEqual({
      [differentCandidate.id]: { status: 'unlinked' }
    })
  })
})
