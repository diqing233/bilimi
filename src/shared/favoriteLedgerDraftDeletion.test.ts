import { describe, expect, it } from 'vitest'
import {
  isUnsavedFavoriteLedgerDraft,
  removeUnsavedFavoriteLedgerDraft
} from './favoriteLedgerDraftDeletion'

describe('favorite ledger draft deletion', () => {
  it('removes one unbound remote draft without mutating saved rules or other drafts', () => {
    const savedRule = {
      id: 'saved', displayName: 'bilimi·已保存', keywords: ['已保存'], enabled: true, priority: 10,
      bilibiliFolderId: 'remote-saved', bindingState: 'bound' as const, isDefault: false
    }
    const remoteDraft = {
      id: 'remote-draft', displayName: 'bilimi·远端草稿', keywords: [], enabled: false, priority: 20,
      bilibiliFolderId: 'remote-draft', bilibiliFolderIds: ['remote-draft'], bindingState: 'unbound' as const,
      syncState: 'local-draft' as const, isDefault: false
    }
    const localDraft = {
      id: 'local-draft', displayName: 'bilimi·本地草稿', keywords: [], enabled: false, priority: 30,
      syncState: 'local-draft' as const, isDefault: false
    }
    const ledgers = [savedRule, remoteDraft, localDraft]

    const next = removeUnsavedFavoriteLedgerDraft(ledgers, 'remote-draft')

    expect(isUnsavedFavoriteLedgerDraft(remoteDraft)).toBe(true)
    expect(isUnsavedFavoriteLedgerDraft(localDraft)).toBe(false)
    expect(next).toEqual([savedRule, localDraft])
    expect(next).not.toBe(ledgers)
    expect(next[0]).toBe(savedRule)
    expect(next[1]).toBe(localDraft)
    expect(ledgers).toEqual([savedRule, remoteDraft, localDraft])
  })

  it('requires a stable Bilibili folder ID before a local-draft rule can use the remote-candidate deletion path', () => {
    const unboundWithoutRemoteFolder = {
      id: 'unbound-without-folder', displayName: 'bilimi·本地草稿', keywords: [], enabled: false, priority: 10,
      bindingState: 'unbound' as const, syncState: 'local-draft' as const, isDefault: false
    }

    expect(isUnsavedFavoriteLedgerDraft(unboundWithoutRemoteFolder)).toBe(false)
    expect(removeUnsavedFavoriteLedgerDraft([unboundWithoutRemoteFolder], 'unbound-without-folder')).toEqual([
      unboundWithoutRemoteFolder
    ])
  })

  it('refuses to remove a saved rule or a default rule through the draft-only path', () => {
    const savedRule = {
      id: 'saved', displayName: 'bilimi·已保存', keywords: [], enabled: true, priority: 10,
      isDefault: false
    }
    const defaultDraft = {
      id: 'default', displayName: 'bilimi·默认', keywords: [], enabled: false, priority: 20,
      syncState: 'local-draft' as const, isDefault: true
    }
    const ledgers = [savedRule, defaultDraft]

    expect(isUnsavedFavoriteLedgerDraft(savedRule)).toBe(false)
    expect(isUnsavedFavoriteLedgerDraft(defaultDraft)).toBe(false)
    expect(removeUnsavedFavoriteLedgerDraft(ledgers, 'saved')).toBe(ledgers)
    expect(removeUnsavedFavoriteLedgerDraft(ledgers, 'default')).toBe(ledgers)
  })

  it('refuses persisted recommendation and bound drafts even when they carry local-draft state', () => {
    const persistedRecommendation = {
      id: 'recommended-up', displayName: 'bilimi·推荐 UP', keywords: ['推荐 UP'], enabled: true, priority: 10,
      syncState: 'local-draft' as const, isDefault: false
    }
    const boundDraft = {
      id: 'bound-draft', displayName: 'bilimi·已绑定草稿', keywords: [], enabled: false, priority: 20,
      bilibiliFolderId: '42', bindingState: 'bound' as const, syncState: 'local-draft' as const, isDefault: false
    }
    const ledgers = [persistedRecommendation, boundDraft]

    expect(isUnsavedFavoriteLedgerDraft(persistedRecommendation)).toBe(false)
    expect(isUnsavedFavoriteLedgerDraft(boundDraft)).toBe(false)
    expect(removeUnsavedFavoriteLedgerDraft(ledgers, 'recommended-up')).toBe(ledgers)
    expect(removeUnsavedFavoriteLedgerDraft(ledgers, 'bound-draft')).toBe(ledgers)
  })
})
