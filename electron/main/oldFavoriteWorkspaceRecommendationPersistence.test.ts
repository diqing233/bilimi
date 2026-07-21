import { describe, expect, it } from 'vitest'
import { applyRecommendedLedgers, removeRecommendedLedgers } from './oldFavoriteWorkspaceRecommendationPersistence'

describe('old favorite workspace recommendation persistence', () => {
  const defaults = [
    { id: 'knowledge', displayName: 'bilimi·知识学习', keywords: [], ruleType: 'keyword' as const, enabled: true, priority: 0, isDefault: true }
  ]
  const recommendation = {
    id: 'custom-author-alice', displayName: 'bilimi·Alice', keywords: ['Alice'], ruleType: 'author' as const,
    enabled: true, priority: 10_000, isDefault: false
  }

  it('adds adopted recommendations to the durable ledger list without disturbing existing rules', () => {
    expect(applyRecommendedLedgers(defaults, [recommendation])).toEqual([...defaults, recommendation])
  })

  it('replaces an adopted rule by id and removes only a cleared recommendation', () => {
    const changed = { ...recommendation, keywords: ['Alice', 'Alice Channel'] }
    expect(applyRecommendedLedgers([...defaults, recommendation], [changed])).toEqual([...defaults, changed])
    expect(removeRecommendedLedgers([...defaults, changed], ['custom-author-alice'])).toEqual(defaults)
  })
})
