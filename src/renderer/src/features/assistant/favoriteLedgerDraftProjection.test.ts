import { describe, expect, it } from 'vitest'
import { projectFavoriteLedgerDraft } from './favoriteLedgerDraftProjection'

describe('projectFavoriteLedgerDraft', () => {
  it('adds a missing local custom ledger as an editable draft', () => {
    expect(projectFavoriteLedgerDraft([], 'custom-author-honker233', 'bilimi·honker233')).toEqual([{
      id: 'custom-author-honker233',
      displayName: 'bilimi·honker233',
      keywords: [],
      enabled: true,
      priority: 10_000,
      syncState: 'local-draft',
      isDefault: false
    }])
  })

  it('does not duplicate an existing ledger or project an unrelated request', () => {
    const existing = { id: 'custom-author-honker233', displayName: 'Existing', keywords: [], enabled: true, priority: 1, isDefault: false }
    expect(projectFavoriteLedgerDraft([existing], 'custom-author-honker233', 'Ignored')).toEqual([existing])
    expect(projectFavoriteLedgerDraft([], undefined, 'Ignored')).toEqual([])
  })
})
