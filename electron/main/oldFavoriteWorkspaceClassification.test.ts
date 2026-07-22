import { describe, expect, it } from 'vitest'
import { classifierLedgersForAccount, mergeOldFavoriteWorkspaceLedgers } from './oldFavoriteWorkspaceClassification'

describe('mergeOldFavoriteWorkspaceLedgers', () => {
  it('excludes ordinary defaults but retains inbox staging when disabled', () => {
    const ledgers = classifierLedgersForAccount([
      { id: 'knowledge', displayName: 'bilimi·知识', keywords: [], enabled: true, priority: 10, isDefault: true },
      { id: 'inbox', displayName: 'bilimi·暂存', keywords: [], enabled: true, priority: 20, isDefault: true },
      { id: 'custom', displayName: '自建', keywords: [], enabled: true, priority: 30, isDefault: false }
    ], false)

    expect(ledgers).toMatchObject([
      { id: 'knowledge', enabled: false },
      { id: 'inbox', enabled: true },
      { id: 'custom', enabled: true }
    ])
  })

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
