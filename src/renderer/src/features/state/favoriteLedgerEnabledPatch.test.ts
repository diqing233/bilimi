import { describe, expect, it, vi } from 'vitest'
import { createInitialAssistantPreferences } from './assistantState'
import {
  applyIndexedFavoriteLedgerEnabledPatch,
  createFavoriteLedgerEnabledIndex,
  rollbackIndexedFavoriteLedgerEnabledPatch
} from './favoriteLedgerEnabledPatch'

describe('favorite ledger enabled index', () => {
  it('applies one change in constant work after indexing 30k ledgers', () => {
    const favoriteLedgers = Array.from({ length: 30_000 }, (_, index) => ({
      id: `ledger-${index}`,
      displayName: `Ledger ${index}`,
      enabled: true,
      keywords: [],
      priority: index,
      isDefault: false
    }))
    const preferences = createInitialAssistantPreferences({
      favoriteAccountPreferences: {
        '100': { defaultFavoriteSystemEnabled: true, favoriteLedgers, transcriptionModelId: 'whisper-small' }
      }
    })
    const index = createFavoriteLedgerEnabledIndex(preferences)
    const stringify = vi.spyOn(JSON, 'stringify')

    applyIndexedFavoriteLedgerEnabledPatch(index, {
      accountMid: '100', ledgerId: 'ledger-29999', enabled: false
    })

    expect(index.get('100\0ledger-29999')?.enabled).toBe(false)
    expect(stringify).not.toHaveBeenCalled()
    stringify.mockRestore()
  })

  it('rolls back only the optimistic enabled value that is still current', () => {
    const favoriteLedgers = [{
      id: 'recommended-author', displayName: 'bilimi·推荐作者', enabled: true,
      keywords: ['推荐作者'], priority: 10, isDefault: false
    }]
    const preferences = createInitialAssistantPreferences({
      favoriteAccountPreferences: {
        '100': { defaultFavoriteSystemEnabled: true, favoriteLedgers, transcriptionModelId: 'whisper-small' }
      }
    })
    const index = createFavoriteLedgerEnabledIndex(preferences)
    const rejectedPatch = { accountMid: '100', ledgerId: 'recommended-author', enabled: false }

    const previous = applyIndexedFavoriteLedgerEnabledPatch(index, rejectedPatch)
    expect(index.get('100\0recommended-author')?.enabled).toBe(false)

    applyIndexedFavoriteLedgerEnabledPatch(index, { ...rejectedPatch, enabled: true })
    expect(rollbackIndexedFavoriteLedgerEnabledPatch(index, rejectedPatch, previous)).toBe(false)
    expect(index.get('100\0recommended-author')?.enabled).toBe(true)

    const finalPrevious = applyIndexedFavoriteLedgerEnabledPatch(index, rejectedPatch)
    expect(rollbackIndexedFavoriteLedgerEnabledPatch(index, rejectedPatch, finalPrevious)).toBe(true)
    expect(index.get('100\0recommended-author')?.enabled).toBe(true)
  })
})
