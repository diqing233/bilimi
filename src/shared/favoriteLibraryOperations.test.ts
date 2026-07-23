import { describe, expect, it } from 'vitest'
import { determineFavoriteOperationEligibility } from './favoriteLibraryOperations'

describe('determineFavoriteOperationEligibility', () => {
  it('classifies managed, unmatched, Bilibili, and mixed scopes deterministically', () => {
    const folders = [
      { id: 'bilimi-logical:work', title: 'Work', kind: 'bilimi-logical' as const, logicalLedgerId: 'work', syncState: 'bound' as const },
      { id: 'local:inbox', title: 'Unmatched', kind: 'local' as const, syncState: 'local-only' as const },
      { id: 'bilibili:default', title: 'Default', kind: 'bilibili' as const, remoteFolderId: '1', syncState: 'bound' as const },
      { id: 'bilibili:user', title: 'User', kind: 'bilibili' as const, remoteFolderId: '2', syncState: 'bound' as const }
    ]

    expect(determineFavoriteOperationEligibility({ source: { kind: 'folder', folderId: 'bilimi-logical:work' }, aids: [3, 1, 3], folders })).toMatchObject({
      sourceScopeKind: 'bilimi-work-folder', eligibleAids: [1, 3], skipped: [], allowedActions: ['copy', 'move', 'delete-local', 'unfavorite-remote', 'delete-managed-folder-local', 'delete-managed-folder-remote']
    })
    expect(determineFavoriteOperationEligibility({ source: { kind: 'folder', folderId: 'local:inbox' }, aids: [2], folders })).toMatchObject({
      sourceScopeKind: 'unmatched', eligibleAids: [2], allowedActions: ['copy', 'move', 'delete-local', 'unfavorite-remote']
    })
    expect(determineFavoriteOperationEligibility({ source: { kind: 'folder', folderId: 'bilibili:default' }, aids: [4], folders })).toMatchObject({ sourceScopeKind: 'bilibili-default' })
    expect(determineFavoriteOperationEligibility({ source: { kind: 'folder', folderId: 'bilibili:user' }, aids: [5], folders })).toMatchObject({ sourceScopeKind: 'bilibili-user-folder' })
    expect(determineFavoriteOperationEligibility({
      source: { kind: 'virtual', label: 'search' }, aids: [9, 0, 9, 2], folders
    })).toEqual({
      sourceScopeKind: 'mixed-virtual', eligibleAids: [2, 9], skipped: [{ aid: 0, reason: 'invalid-aid' }],
      allowedActions: ['copy', 'move', 'delete-local', 'unfavorite-remote']
    })
  })
})
