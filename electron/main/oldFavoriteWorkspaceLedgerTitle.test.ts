import { describe, expect, it } from 'vitest'
import { resolveSavedOldFavoriteWorkspaceLedgerTitle } from './oldFavoriteWorkspaceLedgerTitle'

describe('resolveSavedOldFavoriteWorkspaceLedgerTitle', () => {
  it('returns the saved custom DeepSeek ledger title for frozen Bilibili planning', () => {
    expect(resolveSavedOldFavoriteWorkspaceLedgerTitle([
      { id: 'custom-new-ledger', displayName: 'bilimi·你好', keywords: [], ruleType: 'deepseek', enabled: true, priority: 90, isDefault: false }
    ], 'custom-new-ledger')).toBe('bilimi·你好')
  })
})
