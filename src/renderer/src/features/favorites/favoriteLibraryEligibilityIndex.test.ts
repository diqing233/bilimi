import { describe, expect, it } from 'vitest'
import type { FavoriteRepositoryFolder } from '@shared/favoriteRepository'
import type { FavoriteRepositoryLibraryRow } from '../../../../../electron/main/favoriteRepositoryIpc'
import { buildFavoriteLibraryEligibilityIndex, resolveFavoriteLibrarySource } from './favoriteLibraryEligibilityIndex'

describe('favorite library eligibility index', () => {
  it('resolves row provenance from one precomputed folder lookup', () => {
    const folders = [
      { id: 'remote:default', kind: 'bilibili', remoteFolderId: '1' },
      { id: 'remote:user', kind: 'bilibili', remoteFolderId: '2' },
      { id: 'logical', kind: 'bilimi-logical' }
    ] as FavoriteRepositoryFolder[]
    const rows = [
      { video: { aid: 1 }, folderIds: ['logical', 'remote:default'] },
      { video: { aid: 2 }, folderIds: ['remote:user'] },
      { video: { aid: 3 }, folderIds: ['logical'] }
    ] as FavoriteRepositoryLibraryRow[]

    const index = buildFavoriteLibraryEligibilityIndex(folders, rows)

    expect(index.folderById.get('logical')?.kind).toBe('bilimi-logical')
    expect(index.aidScopeKinds).toEqual({ 1: 'bilibili-default', 2: 'bilibili-user-folder' })
  })

  it('resolves a folder source with one indexed lookup instead of scanning every folder', () => {
    let reads = 0
    const target = { id: 'logical', kind: 'bilimi-logical' } as FavoriteRepositoryFolder
    const folderById = new Map<string, FavoriteRepositoryFolder>()
    Object.defineProperty(folderById, 'get', { value: (id: string) => { reads += 1; return id === 'logical' ? target : undefined } })

    expect(resolveFavoriteLibrarySource('logical', folderById, 'all').sourceScopeKind).toBe('bilimi-work-folder')
    expect(reads).toBe(1)
  })
})
