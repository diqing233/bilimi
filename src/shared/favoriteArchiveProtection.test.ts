import { describe, expect, it } from 'vitest'
import {
  normalizeFavoriteArchiveProtectionRecords,
  partitionFavoriteArchiveSources,
  upsertFavoriteArchiveProtectionRecords
} from './favoriteArchiveProtection'
import type { FavoriteArchiveProtectionRecord } from './types'

describe('favorite archive protection records', () => {
  it('keeps valid account-scoped records and drops malformed rows', () => {
    expect(
      normalizeFavoriteArchiveProtectionRecords([
        {
          accountMid: '42',
          aid: 7,
          targetLedgerIds: ['game', 'game', ' '],
          targetFolderIds: ['9001', '9001', ' '],
          completedAt: '2026-07-10T00:00:00.000Z'
        },
        {
          accountMid: '',
          aid: 8,
          targetLedgerIds: [],
          targetFolderIds: [],
          completedAt: ''
        },
        null
      ])
    ).toEqual([
      {
        accountMid: '42',
        aid: 7,
        targetLedgerIds: ['game'],
        targetFolderIds: ['9001'],
        completedAt: '2026-07-10T00:00:00.000Z'
      }
    ])
  })

  it('replaces one account and aid record without touching another account', () => {
    const existing: FavoriteArchiveProtectionRecord[] = [
      {
        accountMid: '42',
        aid: 7,
        targetLedgerIds: ['game'],
        targetFolderIds: ['9001'],
        completedAt: '2026-07-09T00:00:00.000Z'
      },
      {
        accountMid: '99',
        aid: 7,
        targetLedgerIds: ['music'],
        targetFolderIds: ['9901'],
        completedAt: '2026-07-09T00:00:00.000Z'
      }
    ]
    const replacement: FavoriteArchiveProtectionRecord = {
      accountMid: '42',
      aid: 7,
      targetLedgerIds: ['knowledge'],
      targetFolderIds: ['9002'],
      completedAt: '2026-07-10T00:00:00.000Z'
    }

    expect(upsertFavoriteArchiveProtectionRecords(existing, [replacement])).toEqual([
      replacement,
      existing[1]
    ])
  })

  it('deduplicates sources and partitions protected, migrated, and active videos', () => {
    const partition = partitionFavoriteArchiveSources({
      accountMid: '42',
      sourceFolders: [
        {
          id: 'source-1',
          title: '默认收藏夹',
          videos: [
            { aid: 7, title: '已保护' },
            { aid: 8, title: '旧版已归档' },
            { aid: 9, title: '待分类' }
          ]
        },
        {
          id: 'source-2',
          title: '稍后观看',
          videos: [{ aid: 7, title: '已保护' }]
        }
      ],
      managedFolders: [
        { id: '9001', title: 'bilimi·游戏', ledgerId: 'game', isInbox: false },
        { id: '9008', title: 'bilimi·暂存', ledgerId: 'inbox', isInbox: true }
      ],
      targetMembership: {
        '9001': [8],
        '9008': [9]
      },
      protectionRecords: [
        {
          accountMid: '42',
          aid: 7,
          targetLedgerIds: ['knowledge'],
          targetFolderIds: ['9002'],
          completedAt: '2026-07-10T00:00:00.000Z'
        },
        {
          accountMid: '99',
          aid: 9,
          targetLedgerIds: ['music'],
          targetFolderIds: ['9901'],
          completedAt: '2026-07-10T00:00:00.000Z'
        }
      ],
      now: '2026-07-10T01:00:00.000Z'
    })

    expect(partition.totalUniqueVideos).toBe(3)
    expect(partition.protectedVideos).toEqual([
      expect.objectContaining({
        aid: 7,
        sourceFolderIds: ['source-1', 'source-2'],
        sourceFolderTitles: ['默认收藏夹', '稍后观看'],
        currentBilimiFolderIds: [],
        protectedForIncrementalScan: true
      }),
      expect.objectContaining({
        aid: 8,
        currentBilimiFolderIds: ['9001'],
        protectedForIncrementalScan: true
      })
    ])
    expect(partition.activeSourceFolders.flatMap((folder) => folder.videos)).toEqual([
      expect.objectContaining({ aid: 9, currentBilimiFolderIds: ['9008'] })
    ])
    expect(partition.initializedProtectionRecords).toEqual([
      {
        accountMid: '42',
        aid: 8,
        targetLedgerIds: ['game'],
        targetFolderIds: ['9001'],
        completedAt: '2026-07-10T01:00:00.000Z'
      }
    ])
  })

  it('keeps unrecorded partial results active after the legacy migration has completed', () => {
    const partition = partitionFavoriteArchiveSources({
      accountMid: '42',
      initializeExistingMembership: false,
      sourceFolders: [
        {
          id: 'source-1',
          title: '默认收藏夹',
          videos: [{ aid: 10, title: '上次只完成一部分' }]
        }
      ],
      managedFolders: [
        { id: '9001', title: 'bilimi·知识', ledgerId: 'knowledge', isInbox: false }
      ],
      targetMembership: { '9001': [10] },
      protectionRecords: []
    })

    expect(partition.protectedVideos).toEqual([])
    expect(partition.initializedProtectionRecords).toEqual([])
    expect(partition.activeSourceFolders).toEqual([
      expect.objectContaining({
        id: 'source-1',
        title: '默认收藏夹',
        videos: [expect.objectContaining({ aid: 10, currentBilimiFolderIds: ['9001'] })]
      })
    ])
  })

  it('classifies protected archive health by stable ledger membership', () => {
    const partition = partitionFavoriteArchiveSources({
      accountMid: '42',
      initializeExistingMembership: false,
      sourceFolders: [
        {
          id: 'source-1',
          title: '默认收藏夹',
          videos: [
            { aid: 11, title: '完整' },
            { aid: 12, title: '不完整' },
            { aid: 13, title: '已失效' },
            { aid: 14, title: '收藏夹重建' },
            { aid: 15, title: '账册已删除' }
          ]
        }
      ],
      managedFolders: [
        { id: 'new-knowledge', title: 'bilimi·知识', ledgerId: 'knowledge', isInbox: false },
        { id: 'game-folder', title: 'bilimi·游戏', ledgerId: 'game', isInbox: false }
      ],
      targetMembership: {
        'new-knowledge': [11, 12, 14],
        'game-folder': [11]
      },
      protectionRecords: [
        {
          accountMid: '42',
          aid: 11,
          targetLedgerIds: ['knowledge', 'game'],
          targetFolderIds: ['old-knowledge', 'game-folder'],
          completedAt: '2026-07-10T00:00:00.000Z'
        },
        {
          accountMid: '42',
          aid: 12,
          targetLedgerIds: ['knowledge', 'game'],
          targetFolderIds: ['old-knowledge', 'game-folder'],
          completedAt: '2026-07-10T00:00:00.000Z'
        },
        {
          accountMid: '42',
          aid: 13,
          targetLedgerIds: ['knowledge'],
          targetFolderIds: ['old-knowledge'],
          completedAt: '2026-07-10T00:00:00.000Z'
        },
        {
          accountMid: '42',
          aid: 14,
          targetLedgerIds: ['knowledge'],
          targetFolderIds: ['old-knowledge'],
          completedAt: '2026-07-10T00:00:00.000Z'
        },
        {
          accountMid: '42',
          aid: 15,
          targetLedgerIds: ['deleted-ledger'],
          targetFolderIds: ['deleted-folder'],
          completedAt: '2026-07-10T00:00:00.000Z'
        }
      ]
    })

    expect(partition.protectedVideos.map(({ aid, archiveHealth }) => [aid, archiveHealth])).toEqual([
      [11, 'complete'],
      [12, 'incomplete'],
      [13, 'invalid'],
      [14, 'complete'],
      [15, 'invalid']
    ])
  })

  it('falls back to historical folder ids for legacy records without ledger ids', () => {
    const partition = partitionFavoriteArchiveSources({
      accountMid: '42',
      initializeExistingMembership: false,
      sourceFolders: [
        { id: 'source-1', title: '默认收藏夹', videos: [{ aid: 16, title: '旧记录' }] }
      ],
      managedFolders: [
        { id: 'legacy-folder', title: 'bilimi·旧分类', isInbox: false }
      ],
      targetMembership: { 'legacy-folder': [16] },
      protectionRecords: [
        {
          accountMid: '42',
          aid: 16,
          targetLedgerIds: [],
          targetFolderIds: ['legacy-folder'],
          completedAt: '2026-07-10T00:00:00.000Z'
        }
      ]
    })

    expect(partition.protectedVideos[0].archiveHealth).toBe('complete')
  })

  it('does not fall back to historical folder ids when a stable ledger id exists', () => {
    const partition = partitionFavoriteArchiveSources({
      accountMid: '42',
      initializeExistingMembership: false,
      sourceFolders: [
        { id: 'source-1', title: '默认收藏夹', videos: [{ aid: 17, title: '账册不匹配' }] }
      ],
      managedFolders: [
        { id: 'old-knowledge', title: 'bilimi·其他', ledgerId: 'other', isInbox: false }
      ],
      targetMembership: { 'old-knowledge': [17] },
      protectionRecords: [
        {
          accountMid: '42',
          aid: 17,
          targetLedgerIds: ['knowledge'],
          targetFolderIds: ['old-knowledge'],
          completedAt: '2026-07-10T00:00:00.000Z'
        }
      ]
    })

    expect(partition.protectedVideos[0].archiveHealth).toBe('invalid')
  })
})
