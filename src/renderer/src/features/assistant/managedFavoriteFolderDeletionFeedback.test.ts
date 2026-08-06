import { describe, expect, it } from 'vitest'
import {
  applyManagedFavoriteFolderDeletionToLedgers,
  managedFavoriteFolderDeletionFailureMessage,
  managedFavoriteFolderDeletionSucceeded
} from './managedFavoriteFolderDeletionFeedback'

describe('managedFavoriteFolderDeletionFailureMessage', () => {
  it('keeps Bilibili rejection diagnostics visible without exposing credentials', () => {
    const message = managedFavoriteFolderDeletionFailureMessage(new Error(
      'remote-ambiguous; http-status=412; content-type=application/json; response-category=json; bilibili-code=-412'
    ))

    expect(message).toContain('HTTP 412')
    expect(message).toContain('B 站错误码 -412')
    expect(message).not.toContain('csrf')
  })

  it('identifies a non-JSON page response as a possible verification page', () => {
    const message = managedFavoriteFolderDeletionFailureMessage(new Error(
      'invalid-response; http-status=200; content-type=text/html; response-category=html'
    ))

    expect(message).toContain('非 JSON')
    expect(message).toContain('验证')
  })
})

describe('managed favorite folder deletion rule projection', () => {
  it('keeps default rules without their remote binding and removes custom rules after confirmed deletion', () => {
    const result = applyManagedFavoriteFolderDeletionToLedgers([
      {
        id: 'knowledge', displayName: 'bilimi·知识', keywords: ['教程'], enabled: true,
        priority: 10, isDefault: true, bilibiliFolderId: 'remote-knowledge', syncState: 'local-draft'
      },
      {
        id: 'custom-tech', displayName: 'bilimi·科技', keywords: ['科技'], enabled: true,
        priority: 20, isDefault: false, bilibiliFolderId: 'remote-tech'
      },
      {
        id: 'music', displayName: 'bilimi·音乐', keywords: ['音乐'], enabled: true,
        priority: 30, isDefault: true, bilibiliFolderId: 'remote-music'
      }
    ], ['knowledge', 'custom-tech'])

    expect(result).toEqual([
      expect.objectContaining({ id: 'knowledge', enabled: false, isDefault: true }),
      expect.objectContaining({ id: 'music', enabled: true, bilibiliFolderId: 'remote-music' })
    ])
    expect(result[0]).not.toHaveProperty('bilibiliFolderId')
    expect(result[0]).not.toHaveProperty('syncState')
  })

  it('accepts only confirmed successful deletion outcomes', () => {
    expect(managedFavoriteFolderDeletionSucceeded([])).toBe(true)
    expect(managedFavoriteFolderDeletionSucceeded({ status: 'succeeded' })).toBe(true)
    expect(managedFavoriteFolderDeletionSucceeded({ status: 'failed' })).toBe(false)
    expect(managedFavoriteFolderDeletionSucceeded({ status: 'result-unknown' })).toBe(false)
    expect(managedFavoriteFolderDeletionSucceeded(undefined)).toBe(false)
  })
})
