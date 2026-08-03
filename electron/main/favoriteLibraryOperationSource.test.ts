import { describe, expect, it } from 'vitest'
import { resolveFavoriteLibraryOperationSource } from './favoriteLibraryOperationSource'

describe('resolveFavoriteLibraryOperationSource', () => {
  const snapshot = {
    folders: [
      { id: 'bilimi-logical:work', kind: 'bilimi-logical' },
      { id: 'local:inbox', kind: 'local' },
      { id: 'bilibili:default', kind: 'bilibili', remoteFolderId: '1' }
    ],
    memberships: { 'local:inbox': [1, 3] }
  } as never

  it('treats the unmatched folder as a trusted virtual source', () => {
    expect(resolveFavoriteLibraryOperationSource(snapshot, { kind: 'folder', folderId: 'local:inbox' }, [3, 1])).toEqual({
      kind: 'virtual', eligibleAids: [1, 3], skippedAids: []
    })
  })

  it('keeps managed and Bilibili folder provenance distinct', () => {
    expect(resolveFavoriteLibraryOperationSource(snapshot, { kind: 'folder', folderId: 'bilimi-logical:work' }, [1])).toEqual({
      kind: 'bilimi-logical', folderId: 'bilimi-logical:work'
    })
    expect(resolveFavoriteLibraryOperationSource(snapshot, { kind: 'folder', folderId: 'bilibili:default' }, [1])).toEqual({
      kind: 'bilibili-default', folderId: 'bilibili:default'
    })
  })

  it('rejects forged unmatched selections outside the repository membership', () => {
    expect(() => resolveFavoriteLibraryOperationSource(snapshot, { kind: 'folder', folderId: 'local:inbox' }, [2])).toThrow('unmatched')
  })
})
