import { describe, expect, it } from 'vitest'
import { mergeRecoveredLedgerDrafts } from './oldFavoriteWorkspaceRecommendationPersistence'
import { createRemoteObservationFavoriteLedgerId } from '../../src/shared/favoriteLedgers'

describe('old favorite workspace recommendation persistence', () => {
  const recommendation = {
    id: 'custom-author-alice', displayName: 'bilimi·Alice', keywords: ['Alice'], ruleType: 'author' as const,
    enabled: true, priority: 10_000, ruleOrigin: 'recommendation-draft' as const, isDefault: false
  }

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

  it('collapses duplicate unbound remote drafts by exact folder id and keeps different ids separate', () => {
    const first = {
      id: 'custom-1sldpna', displayName: '你好', keywords: [], ruleType: 'keyword' as const,
      enabled: false, priority: 20000, bilibiliFolderId: '4047644211',
      bindingState: 'unbound' as const, syncState: 'local-draft' as const, isDefault: false
    }
    const canonical = {
      id: createRemoteObservationFavoriteLedgerId('4047644211'), displayName: 'bilimi·你好', keywords: [], ruleType: 'keyword' as const,
      enabled: false, priority: 81, bilibiliFolderId: '4047644211',
      bindingState: 'unbound' as const, syncState: 'local-draft' as const, isDefault: false
    }
    const different = {
      ...canonical,
      id: createRemoteObservationFavoriteLedgerId('4047644212'),
      displayName: 'bilimi·你好', bilibiliFolderId: '4047644212'
    }

    expect(mergeRecoveredLedgerDrafts([first, canonical], [canonical, different])).toEqual([canonical, different])
  })

  it('preserves a configured legacy remote draft identity while collapsing its duplicate observation', () => {
    const legacyConfigured = {
      id: 'custom-1sldpna', displayName: '你好', keywords: ['学习'], ruleType: 'keyword' as const,
      enabled: true, priority: 81, bilibiliFolderId: '4047644211', bilibiliFolderIds: ['4047644211'],
      bindingState: 'unbound' as const, syncState: 'local-draft' as const, isDefault: false
    }
    const canonicalRecovered = {
      ...legacyConfigured,
      id: createRemoteObservationFavoriteLedgerId('4047644211'), displayName: 'bilimi·你好', keywords: [], enabled: false
    }

    expect(mergeRecoveredLedgerDrafts([legacyConfigured], [canonicalRecovered])).toEqual([legacyConfigured])
  })

  it('keeps a disabled saved-rule record when a canonical observation points to the same remote folder', () => {
    const savedRule = {
      id: 'saved-legacy', displayName: '同名', keywords: [], ruleType: 'keyword' as const,
      enabled: false, priority: 1, bilibiliFolderId: '404', bilibiliFolderIds: ['404'],
      ruleOrigin: 'saved-rule' as const, bindingState: 'unbound' as const, syncState: 'local-draft' as const, isDefault: false
    }
    const canonical = {
      id: createRemoteObservationFavoriteLedgerId('404'), displayName: 'bilimi·同名', keywords: [], ruleType: 'keyword' as const,
      enabled: false, priority: 2, bilibiliFolderId: '404', bilibiliFolderIds: ['404'],
      bindingState: 'unbound' as const, syncState: 'local-draft' as const, isDefault: false
    }

    const result = mergeRecoveredLedgerDrafts([savedRule, canonical], [canonical])

    expect(result).toEqual([
      expect.objectContaining({ id: 'saved-legacy', ruleOrigin: 'saved-rule', bilibiliFolderId: '404' })
    ])
  })
})
