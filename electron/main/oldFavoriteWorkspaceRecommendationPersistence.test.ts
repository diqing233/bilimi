import { describe, expect, it } from 'vitest'
import { applyRecommendedLedgers, markRecommendedLedgersLocalDraft, removeRecommendedLedgers } from './oldFavoriteWorkspaceRecommendationPersistence'

describe('old favorite workspace recommendation persistence', () => {
  const defaults = [
    { id: 'knowledge', displayName: 'bilimi·知识学习', keywords: [], ruleType: 'keyword' as const, enabled: true, priority: 0, isDefault: true }
  ]
  const recommendation = {
    id: 'custom-author-alice', displayName: 'bilimi·Alice', keywords: ['Alice'], ruleType: 'author' as const,
    enabled: true, priority: 10_000, isDefault: false
  }

  it('adds adopted recommendations as local drafts without disturbing existing rules', () => {
    expect(applyRecommendedLedgers(defaults, [recommendation])).toEqual([...defaults, {
      ...recommendation,
      syncState: 'local-draft'
    }])
  })

  it('replaces an adopted rule by id and removes only a cleared recommendation', () => {
    const changed = { ...recommendation, keywords: ['Alice', 'Alice Channel'] }
    expect(applyRecommendedLedgers([...defaults, recommendation], [changed])).toEqual([...defaults, {
      ...changed,
      syncState: 'local-draft'
    }])
    expect(removeRecommendedLedgers([...defaults, changed], ['custom-author-alice'])).toEqual(defaults)
  })

  it('migrates unsynced adopted rules to local drafts without downgrading an existing Bilibili folder', () => {
    expect(markRecommendedLedgersLocalDraft([
      recommendation,
      { ...recommendation, id: 'custom-author-remote', bilibiliFolderId: '42' }
    ], ['custom-author-alice', 'custom-author-remote'])).toEqual([
      { ...recommendation, syncState: 'local-draft' },
      { ...recommendation, id: 'custom-author-remote', bilibiliFolderId: '42' }
    ])
  })
})
