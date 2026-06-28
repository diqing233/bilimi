import { describe, expect, it } from 'vitest'
import {
  archivePendingFavoriteQueueItem,
  createPendingFavoriteQueueSummary,
  normalizePendingFavoriteQueue,
  upsertPendingFavoriteQueueItems
} from './pendingFavoriteQueue'
import type { PendingFavoriteQueueItem } from './types'

function item(overrides: Partial<PendingFavoriteQueueItem> = {}): PendingFavoriteQueueItem {
  return {
    aid: 101,
    title: '未分类视频',
    source: 'old-favorite-scan',
    sourceFolderTitle: '默认收藏夹',
    originalTargetLedgerId: 'inbox',
    suggestedLedgerIds: [],
    candidateLedgerNames: [],
    reason: '没有明确命中',
    createdAt: '2026-06-28T00:00:00.000Z',
    updatedAt: '2026-06-28T00:00:00.000Z',
    status: 'pending',
    ...overrides
  }
}

describe('pending favorite queue', () => {
  it('loads only valid pending queue items by default', () => {
    expect(
      normalizePendingFavoriteQueue([
        item({ aid: 1, status: 'pending' }),
        item({ aid: 2, status: 'archived' }),
        { title: 'broken' }
      ])
    ).toEqual([item({ aid: 1, status: 'pending' })])
  })

  it('upserts by aid and preserves original createdAt', () => {
    const result = upsertPendingFavoriteQueueItems(
      [item({ aid: 1, title: 'old', createdAt: '2026-06-28T00:00:00.000Z' })],
      [item({ aid: 1, title: 'new', suggestedLedgerIds: ['knowledge'] })],
      '2026-06-28T01:00:00.000Z'
    )

    expect(result).toEqual([
      item({
        aid: 1,
        title: 'new',
        suggestedLedgerIds: ['knowledge'],
        createdAt: '2026-06-28T00:00:00.000Z',
        updatedAt: '2026-06-28T01:00:00.000Z'
      })
    ])
  })

  it('summarizes pending queue work', () => {
    expect(
      createPendingFavoriteQueueSummary([
        item({ aid: 1, suggestedLedgerIds: ['knowledge'] }),
        item({ aid: 2, candidateLedgerNames: ['Bilimi·摄影'] }),
        item({ aid: 3 })
      ])
    ).toEqual({
      totalPending: 3,
      suggestedExistingCount: 1,
      suggestedCandidateLedgerCount: 1,
      stagingCount: 1
    })
  })

  it('archives an item and hides it from default normalization', () => {
    const archived = archivePendingFavoriteQueueItem([item({ aid: 1 })], 1, '2026-06-28T02:00:00.000Z')

    expect(archived[0]).toMatchObject({ aid: 1, status: 'archived' })
    expect(normalizePendingFavoriteQueue(archived)).toEqual([])
  })
})
