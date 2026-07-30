import { describe, expect, it } from 'vitest'
import { classifierLedgersForAccount, enableDefaultLedgersForOrganization, mergeOldFavoriteWorkspaceLedgers } from './oldFavoriteWorkspaceClassification'

describe('mergeOldFavoriteWorkspaceLedgers', () => {
  it('enables every default target for an organization round only when the default system is enabled', () => {
    const saved = [
      { id: 'knowledge', displayName: 'bilimi·知识', keywords: [], enabled: false, priority: 10, isDefault: true },
      { id: 'inbox', displayName: 'bilimi·暂存', keywords: [], enabled: false, priority: 20, isDefault: true },
      { id: 'custom', displayName: '自建', keywords: [], enabled: false, priority: 30, isDefault: false }
    ]

    expect(enableDefaultLedgersForOrganization(saved, true)).toEqual([
      expect.objectContaining({ id: 'knowledge', enabled: true }),
      expect.objectContaining({ id: 'inbox', enabled: true }),
      expect.objectContaining({ id: 'custom', enabled: false })
    ])
    expect(enableDefaultLedgersForOrganization(saved, false)).toEqual(saved)
  })

  it('excludes ordinary defaults but retains inbox staging when disabled', () => {
    const ledgers = classifierLedgersForAccount([
      { id: 'knowledge', displayName: 'bilimi·知识', keywords: [], enabled: true, priority: 10, isDefault: true },
      { id: 'inbox', displayName: 'bilimi·暂存', keywords: [], enabled: true, priority: 20, isDefault: true },
      { id: 'custom', displayName: '自建', keywords: [], enabled: true, priority: 30, isDefault: false }
    ], false)

    expect(ledgers).toEqual([
      expect.objectContaining({ id: 'inbox', enabled: true }),
      expect.objectContaining({ id: 'custom', enabled: true })
    ])
  })

  it('excludes recovered local drafts from automatic classification', () => {
    expect(classifierLedgersForAccount([
      { id: 'knowledge', displayName: '知识', keywords: ['教程'], enabled: true, priority: 10, isDefault: true },
      { id: 'custom-genshin', displayName: '原神', keywords: ['原神'], enabled: false, priority: 20, isDefault: false, bilibiliFolderId: '42', syncState: 'local-draft' }
    ], true)).toEqual([
      expect.objectContaining({ id: 'knowledge' })
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
