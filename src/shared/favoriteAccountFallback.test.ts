import { describe, expect, it } from 'vitest'
import { findSoleFavoriteAccountMid, resolveLocalFavoriteLedgerToggleAccountMid } from './favoriteAccountFallback'

describe('findSoleFavoriteAccountMid', () => {
  it('returns the only valid locally persisted favorite account', () => {
    expect(findSoleFavoriteAccountMid({
      '100': { defaultFavoriteSystemEnabled: true, favoriteLedgers: [] }
    })).toBe('100')
  })

  it('returns empty when multiple valid favorite accounts are persisted', () => {
    expect(findSoleFavoriteAccountMid({
      '100': { defaultFavoriteSystemEnabled: true, favoriteLedgers: [] },
      '200': { defaultFavoriteSystemEnabled: true, favoriteLedgers: [] }
    })).toBe('')
  })

  it('ignores malformed account keys and incomplete account projections', () => {
    expect(findSoleFavoriteAccountMid({
      '0': { defaultFavoriteSystemEnabled: true, favoriteLedgers: [] },
      bad: { defaultFavoriteSystemEnabled: true, favoriteLedgers: [] },
      '100': { defaultFavoriteSystemEnabled: true, favoriteLedgers: [] },
      '200': { defaultFavoriteSystemEnabled: true } as never
    })).toBe('100')
  })

  it('resolves only a saved unbacked custom ledger for a local-only toggle', () => {
    const accounts = {
      '100': {
        favoriteLedgers: [
          { id: 'custom-unbacked', isDefault: false, ruleOrigin: 'saved-rule', bindingState: 'unbacked' },
          { id: 'bound', isDefault: false, ruleOrigin: 'saved-rule', bindingState: 'bound', bilibiliFolderId: '9' },
          { id: 'recommended', isDefault: false, ruleOrigin: 'recommendation-draft', bindingState: 'unbacked' }
        ]
      }
    }
    expect(resolveLocalFavoriteLedgerToggleAccountMid(accounts, 'custom-unbacked')).toBe('100')
    expect(resolveLocalFavoriteLedgerToggleAccountMid(accounts, 'bound')).toBe('')
    expect(resolveLocalFavoriteLedgerToggleAccountMid(accounts, 'recommended')).toBe('')
  })

  it('does not resolve a local toggle when more than one account is present', () => {
    expect(resolveLocalFavoriteLedgerToggleAccountMid({
      '100': { favoriteLedgers: [{ id: 'custom', isDefault: false, ruleOrigin: 'saved-rule', bindingState: 'unbacked' }] },
      '200': { favoriteLedgers: [] }
    }, 'custom')).toBe('')
  })
})
