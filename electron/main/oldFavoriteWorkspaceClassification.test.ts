import { describe, expect, it } from 'vitest'
import { mergeOldFavoriteWorkspaceLedgers } from './oldFavoriteWorkspaceClassification'

describe('mergeOldFavoriteWorkspaceLedgers', () => {
  it('adds adopted recommendations as enabled author ledgers ahead of duplicate saved rules', () => {
    expect(mergeOldFavoriteWorkspaceLedgers([
      { id: 'music', displayName: 'Music', keywords: ['music'], enabled: true, priority: 3, isDefault: false },
      { id: 'custom-author-up-alpha', displayName: 'Old Alpha', keywords: ['old'], enabled: false, priority: 9, isDefault: false }
    ], [{
      id: 'custom-author-up-alpha', displayName: 'bilimi·UP Alpha', keywords: ['UP Alpha'],
      ruleType: 'author', enabled: true, priority: 0, isDefault: false
    }])).toEqual([
      { id: 'custom-author-up-alpha', displayName: 'bilimi·UP Alpha', keywords: ['UP Alpha'], ruleType: 'author', enabled: true, priority: 0, isDefault: false },
      { id: 'music', displayName: 'Music', keywords: ['music'], enabled: true, priority: 3, isDefault: false }
    ])
  })
})
