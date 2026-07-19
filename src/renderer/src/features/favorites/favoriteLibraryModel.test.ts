import { describe, expect, it } from 'vitest'
import type { FavoriteRepositoryFolder, FavoriteRepositoryVideo } from '../../../../shared/favoriteRepository'
import {
  buildFavoriteLibraryDetail,
  buildFavoriteLibraryNavigation,
  buildFolderLibraryRows,
  buildLibrarySearchRows,
  buildPendingLibraryRows,
  createFavoriteLibraryPageCursor
} from './favoriteLibraryModel'

const video = (aid: number, title = `Video ${aid}`): FavoriteRepositoryVideo => ({
  aid,
  title,
  tags: [],
  updatedAt: '2026-07-19T00:00:00.000Z'
})

describe('favoriteLibraryModel', () => {
  it('returns one global-search row per aid and retains every folder membership', () => {
    expect(buildLibrarySearchRows([
      { video: video(1), folderId: 'b' },
      { video: video(1, 'Ignored duplicate'), folderId: 'a' },
      { video: video(2), folderId: 'a' },
      { video: video(1), folderId: 'b' }
    ])).toEqual([
      expect.objectContaining({ aid: 1, title: 'Video 1', folderIds: ['a', 'b'] }),
      expect.objectContaining({ aid: 2, folderIds: ['a'] })
    ])
  })

  it('keeps the current folder page membership order without applying global-search deduplication', () => {
    const rows = buildFolderLibraryRows('folder-a', [video(2), video(1), video(2)])

    expect(rows.map((row) => [row.aid, row.folderIds])).toEqual([
      [2, ['folder-a']],
      [1, ['folder-a']],
      [2, ['folder-a']]
    ])
  })

  it('aggregates unsynced, continuation, failed, and unknown work by aid', () => {
    expect(buildPendingLibraryRows({
      unsyncedAids: [4, 1, 4],
      continuationAids: [1, 2],
      syncRecords: [
        { status: 'failed', affectedAids: [2, 3] },
        { status: 'result-unknown', affectedAids: [3] },
        { status: 'succeeded', affectedAids: [4] }
      ]
    })).toEqual([
      { aid: 1, states: ['unsynced', 'continuation'] },
      { aid: 2, states: ['continuation', 'failed'] },
      { aid: 3, states: ['failed', 'result-unknown'] },
      { aid: 4, states: ['unsynced'] }
    ])
  })

  it('builds stable navigation and exposes pending work without a repository snapshot', () => {
    const folders: FavoriteRepositoryFolder[] = [
      { id: 'remote', title: 'Bili', kind: 'bilibili', syncState: 'bound' },
      { id: 'logical', title: 'Bilimi logical', kind: 'bilimi-logical', syncState: 'bound' },
      { id: 'local', title: 'Local', kind: 'local', syncState: 'local-only' }
    ]

    expect(buildFavoriteLibraryNavigation(folders, 3)).toEqual([
      { id: 'all', kind: 'all', title: 'All' },
      { id: 'pending', kind: 'pending', title: 'Pending', count: 3 },
      { id: 'folder:remote', kind: 'folder', folderId: 'remote', title: 'Bili', source: 'bilibili' },
      { id: 'folder:logical', kind: 'folder', folderId: 'logical', title: 'Bilimi logical', source: 'bilimi-logical' },
      { id: 'folder:local', kind: 'folder', folderId: 'local', title: 'Local', source: 'local' }
    ])
  })

  it('creates a detail model and carries pagination cursors forward unchanged', () => {
    const row = buildLibrarySearchRows([
      { video: video(1), folderId: 'remote' },
      { video: video(1), folderId: 'local' }
    ])[0]
    const folders: FavoriteRepositoryFolder[] = [
      { id: 'remote', title: 'Remote', kind: 'bilibili', syncState: 'bound' },
      { id: 'local', title: 'Local', kind: 'local', syncState: 'local-only' }
    ]

    expect(buildFavoriteLibraryDetail(row, folders)).toEqual(expect.objectContaining({
      aid: 1,
      folders: [
        { id: 'local', title: 'Local', kind: 'local', syncState: 'local-only' },
        { id: 'remote', title: 'Remote', kind: 'bilibili', syncState: 'bound' }
      ]
    }))
    expect(createFavoriteLibraryPageCursor({ nextCursor: '42', revision: 7 })).toEqual({ nextCursor: '42', revision: 7 })
  })
})
