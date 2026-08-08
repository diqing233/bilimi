import { describe, expect, it } from 'vitest'
import type { FavoriteRepositoryFolder, FavoriteRepositoryVideo } from '../../../../shared/favoriteRepository'
import {
  buildFavoriteLibraryDetail,
  buildFavoriteLibraryNavigation,
  buildFolderLibraryRows,
  buildLibrarySearchRows,
  buildPendingLibraryRows,
  createFavoriteLibraryPageCursor,
  createFavoriteLibraryViewCache
  , formatFavoriteLibraryMirrorStatus, formatFavoriteLibraryOrganizationStatus
  , formatFavoriteLibraryMetadataStatus, formatFavoriteLibraryPositionStatus, formatFavoriteLibraryPositionSyncStatus, favoriteLibraryLedgerBindingStatus
} from './favoriteLibraryModel'

const video = (aid: number, title = `Video ${aid}`): FavoriteRepositoryVideo => ({
  aid,
  title,
  tags: [],
  updatedAt: '2026-07-19T00:00:00.000Z'
})

describe('favoriteLibraryModel', () => {
  it('prefers a restored bilimi work folder over its same-ledger local draft navigation entry', () => {
    const navigation = buildFavoriteLibraryNavigation([
      { id: 'bilimi-logical:knowledge', title: 'bilimi·知识学习', kind: 'bilimi-logical', logicalLedgerId: 'knowledge', syncState: 'bound' },
      { id: 'local:knowledge', title: 'bilimi·知识学习', kind: 'local', logicalLedgerId: 'knowledge', syncState: 'local-only' },
      { id: 'local:custom', title: 'bilimi·自建', kind: 'local', logicalLedgerId: 'custom', syncState: 'local-only' }
    ], 0)

    expect(navigation.filter((item) => item.kind === 'folder').map((item) => item.folderId)).toEqual([
      'bilimi-logical:knowledge',
      'local:custom'
    ])
  })

  it('orders bilimi logical folders by the persisted ledger priority', () => {
    window.localStorage.setItem('bilimi:favorite-ledger-priorities', JSON.stringify({ music: 20, game: 10 }))
    const navigation = buildFavoriteLibraryNavigation([
      { id: 'bilimi-logical:music', title: 'bilimi·音乐舞台', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound' },
      { id: 'bilimi-logical:game', title: 'bilimi·游戏专区', kind: 'bilimi-logical', logicalLedgerId: 'game', syncState: 'bound' },
      { id: 'bilibili:1', title: '普通收藏夹', kind: 'bilibili', remoteFolderId: '1' }
    ], 0)
    expect(navigation.filter((item) => item.kind === 'folder').map((item) => item.folderId)).toEqual([
      'bilibili:1', 'bilimi-logical:game', 'bilimi-logical:music'
    ])
    window.localStorage.removeItem('bilimi:favorite-ledger-priorities')
  })
  it('keeps cached views isolated by account while a known account refreshes', () => {
    const cache = createFavoriteLibraryViewCache<{ revision: number }, { items: number[] }, { scopeId: string }>()
    cache.setReady('100', { revision: 7 }, { items: [1] }, { scopeId: 'pending' })

    expect(cache.read('100')).toEqual({
      accountMid: '100', status: 'ready', summary: { revision: 7 }, page: { items: [1] }, uiState: { scopeId: 'pending' }
    })
    expect(cache.beginRefresh('100')).toEqual(expect.objectContaining({ accountMid: '100', status: 'refreshing', page: { items: [1] } }))
    expect(cache.read('200')).toEqual({ accountMid: '200', status: 'loading' })
  })

  it('translates repository mirror states into user-facing Chinese labels', () => {
    expect(formatFavoriteLibraryMirrorStatus(['unsynced'], 'unsynced')).toBe('未同步')
    expect(formatFavoriteLibraryMirrorStatus(['failed'], 'unsynced')).toBe('同步失败')
    expect(formatFavoriteLibraryMirrorStatus([], 'synced')).toBe('已同步')
    expect(formatFavoriteLibraryMirrorStatus([], 'unsynced')).toBe('未同步')
  })

  it('does not expose internal pending-state enum values in reader-facing labels', () => {
    expect(formatFavoriteLibraryMirrorStatus(['result-unknown'], 'unsynced')).toMatch(/确认/)
    expect(formatFavoriteLibraryMirrorStatus(['continuation'], 'unsynced')).toMatch(/等待/)
    expect(formatFavoriteLibraryMirrorStatus(['failed'], 'unsynced')).not.toContain('failed')
    expect(formatFavoriteLibraryMirrorStatus(['protected'], 'unsynced')).toBe('未同步')
  })

  it('keeps organization protection from hiding an outstanding information refresh', () => {
    expect(formatFavoriteLibraryMirrorStatus(['protected', 'unsynced'], 'unsynced')).toMatch(/未同步/)
  })

  it('reports organization status separately from information refresh state', () => {
    expect(formatFavoriteLibraryOrganizationStatus('organized')).toBe('已整理')
    expect(formatFavoriteLibraryOrganizationStatus('unorganized')).toBe('未整理')
  })

  it('labels the legacy local inbox as staging without changing its id', () => {
    const navigation = buildFavoriteLibraryNavigation([
      { id: 'local:inbox', title: '暂存', kind: 'local', syncState: 'local-only' }
    ], 0)

    expect(navigation).toContainEqual(expect.objectContaining({ folderId: 'local:inbox', title: 'bilimi·暂存' }))
  })

  it('keeps metadata refresh and collection position labels separate', () => {
    expect(formatFavoriteLibraryMetadataStatus('synced', true)).toBe('资料待刷新')
    expect(formatFavoriteLibraryMetadataStatus('synced', false)).toBe('资料已刷新')
    expect(formatFavoriteLibraryMetadataStatus('failed', false)).toBe('资料刷新失败')
    expect(formatFavoriteLibraryPositionStatus('failed')).toBe('同步失败')
    expect(formatFavoriteLibraryPositionStatus('aligned')).toBe('位置一致')
    expect(formatFavoriteLibraryPositionStatus('local-only-change')).toBe('收藏库与B站位置不同')
  })

  it('does not describe an unobserved Bilibili mapping as aligned', () => {
    expect(formatFavoriteLibraryPositionStatus('aligned', false)).toBe('尚未扫描B站位置')
  })

  it('derives the detail sync label from position state instead of pending work', () => {
    expect(formatFavoriteLibraryPositionSyncStatus('aligned')).toBe('已同步')
    expect(formatFavoriteLibraryPositionSyncStatus('local-only-change')).toBe('未同步')
    expect(formatFavoriteLibraryPositionSyncStatus('result-unknown')).toBe('同步状态待确认')
  })

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
      { id: 'all', kind: 'all', title: '全部收藏' },
      { id: 'pending', kind: 'pending', title: '待处理', count: 3 },
      { id: 'recycle', kind: 'recycle', title: '回收站', count: 0 },
      { id: 'folder:remote', kind: 'folder', folderId: 'remote', title: 'Bili', source: 'bilibili' },
      { id: 'folder:logical', kind: 'folder', folderId: 'logical', title: 'Bilimi logical', source: 'bilimi-logical' },
      { id: 'folder:local', kind: 'folder', folderId: 'local', title: 'Local', source: 'local' }
    ])
  })

  it('renders legacy local default ledger ids with their Chinese display names', () => {
    const folders: FavoriteRepositoryFolder[] = [
      { id: 'local:knowledge', title: 'knowledge', kind: 'local', syncState: 'local-only' },
      { id: 'local:movie-tv', title: 'movie-tv', kind: 'local', syncState: 'local-only' }
    ]

    expect(buildFavoriteLibraryNavigation(folders, 0)).toEqual(expect.arrayContaining([
      expect.objectContaining({ folderId: 'local:knowledge', title: 'bilimi·知识学习' }),
      expect.objectContaining({ folderId: 'local:movie-tv', title: 'bilimi·影视动漫' })
    ]))
  })

  it('derives backed, missing, and generated-draft ledger binding states without marking ordinary folders', () => {
    expect(favoriteLibraryLedgerBindingStatus({
      id: 'bilimi-logical:music', title: 'bilimi·音乐舞台', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound'
    })).toEqual({ kind: 'backed', label: '已备册' })
    expect(favoriteLibraryLedgerBindingStatus({
      id: 'bilimi-logical:game', title: 'bilimi·游戏专区', kind: 'bilimi-logical', logicalLedgerId: 'game', syncState: 'pending-reconcile'
    })).toEqual({ kind: 'missing', label: '未备册', actionLabel: '去掌库收藏夹设置保存后绑定' })
    expect(favoriteLibraryLedgerBindingStatus({
      id: 'bilimi-logical:custom-abc', title: 'bilimi·原神', kind: 'bilimi-logical', logicalLedgerId: 'custom-abc', syncState: 'pending-reconcile'
    })).toEqual({ kind: 'draft', label: '已生成草稿', actionLabel: '去掌库收藏夹设置保存后绑定' })
    expect(favoriteLibraryLedgerBindingStatus({
      id: 'local:custom-author-honker233', title: 'bilimi·honker233', kind: 'local', logicalLedgerId: 'custom-author-honker233', syncState: 'local-only'
    })).toEqual({ kind: 'draft', label: '已生成草稿', actionLabel: '去掌库收藏夹设置保存后绑定' })
    expect(favoriteLibraryLedgerBindingStatus({
      id: 'local:personal', title: 'Personal', kind: 'local', syncState: 'local-only'
    })).toBeUndefined()
    expect(favoriteLibraryLedgerBindingStatus({
      id: 'bilibili:1', title: '普通收藏夹', kind: 'bilibili', remoteFolderId: '1', syncState: 'bound'
    })).toBeUndefined()
  })

  it('keeps the recycle bin in navigation even when it is empty', () => {
    expect(buildFavoriteLibraryNavigation([], 0, 7)).toEqual([
      { id: 'all', kind: 'all', title: '全部收藏' },
      { id: 'pending', kind: 'pending', title: '待处理', count: 0 },
      { id: 'recycle', kind: 'recycle', title: '回收站', count: 7 }
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
