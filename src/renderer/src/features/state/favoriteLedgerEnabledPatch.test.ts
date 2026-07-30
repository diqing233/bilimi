import { describe, expect, it, vi } from 'vitest'
import { createInitialAssistantPreferences } from './assistantState'
import {
  applyIndexedFavoriteLedgerEnabledPatch,
  createFavoriteLedgerEnabledIndex
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
})
