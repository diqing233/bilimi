import { describe, expect, it } from 'vitest'
import {
  applyRecommendedLedgers,
  markRecommendedLedgersLocalDraft,
  mergeRecoveredLedgerDrafts,
  reconcileRecommendedLedgers,
  removeRecommendedLedgers
} from './oldFavoriteWorkspaceRecommendationPersistence'

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

  it('reconciles final recommendation choices without deleting edited or bound ledgers', () => {
    const cleared = { ...recommendation, syncState: 'local-draft' as const }
    const edited = {
      ...recommendation,
      id: 'custom-author-edited',
      displayName: 'bilimi·Alice 精选',
      syncState: 'local-draft' as const
    }
    const bound = {
      ...recommendation,
      id: 'custom-author-bound',
      bilibiliFolderId: '42',
      syncState: 'local-draft' as const
    }
    const added = { ...recommendation, id: 'custom-author-added', displayName: 'bilimi·Bob', keywords: ['Bob'] }

    expect(reconcileRecommendedLedgers(
      [...defaults, cleared, edited, bound],
      [
        recommendation,
        { ...recommendation, id: edited.id },
        { ...recommendation, id: bound.id },
        added
      ],
      [added.id]
    )).toEqual([
      ...defaults,
      edited,
      bound,
      { ...added, syncState: 'local-draft' }
    ])
  })

  it('keeps an unselected recommendation when the user changed its behavior flags', () => {
    const disabled = { ...recommendation, enabled: false, syncState: 'local-draft' as const }
    const reprioritized = { ...recommendation, id: 'custom-author-priority', priority: 42, syncState: 'local-draft' as const }
    const promoted = { ...recommendation, id: 'custom-author-default', isDefault: true, syncState: 'local-draft' as const }

    expect(reconcileRecommendedLedgers(
      [...defaults, disabled, reprioritized, promoted],
      [
        recommendation,
        { ...recommendation, id: reprioritized.id },
        { ...recommendation, id: promoted.id }
      ],
      []
    )).toEqual([...defaults, disabled, reprioritized, promoted])
  })

  it('does not overwrite edited or bound fields when an existing recommendation stays selected', () => {
    const edited = {
      ...recommendation,
      displayName: 'bilimi·Alice 精选',
      keywords: ['Alice', '精选'],
      enabled: false,
      priority: 42,
      syncState: 'local-draft' as const
    }
    const bound = {
      ...recommendation,
      id: 'custom-author-bound',
      bilibiliFolderId: '42',
      syncState: 'synced' as const
    }

    expect(reconcileRecommendedLedgers(
      [...defaults, edited, bound],
      [recommendation, { ...recommendation, id: bound.id }],
      [edited.id, bound.id]
    )).toEqual([...defaults, edited, bound])
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

  it('downgrades a legacy empty remote rule to a recovered draft while preserving configured rules', () => {
    const recovered = {
      ...recommendation,
      id: 'custom-genshin',
      displayName: '原神',
      keywords: [],
      enabled: false,
      bilibiliFolderId: '42',
      syncState: 'local-draft' as const
    }

    expect(mergeRecoveredLedgerDrafts([
      { ...recovered, syncState: undefined },
      { ...recommendation, id: 'custom-saved', keywords: ['攻略'], enabled: true, bilibiliFolderId: '43' }
    ], [recovered, { ...recovered, id: 'custom-saved', bilibiliFolderId: '43' }])).toEqual([
      recovered,
      { ...recommendation, id: 'custom-saved', keywords: ['攻略'], enabled: true, bilibiliFolderId: '43' }
    ])
  })

  it('restores the remote folder id on an existing recovered draft with the same logical id', () => {
    const recovered = {
      ...recommendation,
      id: 'custom-genshin',
      displayName: '原神',
      keywords: [],
      enabled: false,
      bilibiliFolderId: '42',
      syncState: 'local-draft' as const
    }

    expect(mergeRecoveredLedgerDrafts([
      { ...recovered, bilibiliFolderId: undefined }
    ], [recovered])).toEqual([recovered])
  })
})
