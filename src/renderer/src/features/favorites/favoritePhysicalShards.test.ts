import { describe, expect, it, vi } from 'vitest'
import { REMOTE_FAVORITE_SHARD_CAPACITY } from '../../../../shared/favoriteRepositoryPlanning'
import {
  allocateFavoritePhysicalShards,
  getFavoriteLogicalFolderTitle,
  getFavoritePhysicalShardTitle,
  groupFavoritePhysicalShards,
  prepareFavoriteLogicalFolderTitle
} from './favoritePhysicalShards'

describe('favorite physical shards', () => {
  it('uses the shared remote capacity when no per-call limit is supplied', async () => {
    const createShard = vi.fn().mockResolvedValue({ id: 'new-2' })
    const memberAids = Array.from({ length: REMOTE_FAVORITE_SHARD_CAPACITY }, (_, index) => index + 1)

    const result = await allocateFavoritePhysicalShards({
      logicalLedgerId: 'ledger-knowledge',
      logicalTitle: 'bilimi-knowledge',
      requestedAids: [REMOTE_FAVORITE_SHARD_CAPACITY + 1],
      shards: [{ id: 'full', logicalLedgerId: 'ledger-knowledge', title: 'bilimi-knowledge', memberAids }],
      createShard
    })

    expect(result).toMatchObject({
      status: 'ready',
      createdShards: [{ logicalLedgerId: 'ledger-knowledge', id: 'new-2', shardNumber: 2 }]
    })
  })

  it('caps a caller-provided shard capacity at the shared remote hard limit', async () => {
    const createShard = vi.fn().mockResolvedValue({ id: 'new-2' })
    const memberAids = Array.from({ length: REMOTE_FAVORITE_SHARD_CAPACITY }, (_, index) => index + 1)

    const result = await allocateFavoritePhysicalShards({
      logicalLedgerId: 'ledger-knowledge',
      logicalTitle: 'bilimi-knowledge',
      requestedAids: [REMOTE_FAVORITE_SHARD_CAPACITY + 1],
      shards: [{ id: 'full', logicalLedgerId: 'ledger-knowledge', title: 'bilimi-knowledge', memberAids }],
      maxMembersPerShard: REMOTE_FAVORITE_SHARD_CAPACITY + 1,
      createShard
    })

    expect(result).toMatchObject({ status: 'ready', createdShards: [{ id: 'new-2', shardNumber: 2 }] })
    expect(createShard).toHaveBeenCalledWith(
      'ledger-knowledge',
      getFavoritePhysicalShardTitle('bilimi-knowledge', 2),
      2
    )
  })

  it('merges membership by stable logical ledger identity with aid deduplication', () => {
    const groups = groupFavoritePhysicalShards([
      { id: 'a', logicalLedgerId: 'games', title: 'bilimi-games', memberAids: [1, 2], membershipComplete: true },
      { id: 'b', logicalLedgerId: 'games', title: 'bilimi-games·2', memberAids: [2, 3], membershipComplete: true },
      { id: 'c', logicalLedgerId: 'inbox', title: 'bilimi-inbox', memberAids: [4], membershipComplete: true, isInbox: true },
      { id: 'd', logicalLedgerId: 'inbox', title: 'bilimi-inbox·2', memberAids: [4, 5], membershipComplete: true, isInbox: true }
    ])

    expect(groups).toEqual([
      expect.objectContaining({ logicalLedgerId: 'games', logicalTitle: 'bilimi-games', shardCount: 2, memberAids: [1, 2, 3], isInbox: false }),
      expect.objectContaining({ logicalLedgerId: 'inbox', logicalTitle: 'bilimi-inbox', shardCount: 2, memberAids: [4, 5], isInbox: true })
    ])
  })

  it('keeps truncated display-title collisions in separate stable logical ledgers', () => {
    const groups = groupFavoritePhysicalShards([
      { id: 'remote-b', logicalLedgerId: 'ledger-b', title: 'bilimi-this-display-title-is-truncated', memberAids: [2] },
      { id: 'remote-a', logicalLedgerId: 'ledger-a', title: 'bilimi-this-display-title-is-truncated', memberAids: [1] }
    ])

    expect(groups).toEqual([
      expect.objectContaining({ logicalLedgerId: 'ledger-a', memberAids: [1] }),
      expect.objectContaining({ logicalLedgerId: 'ledger-b', memberAids: [2] })
    ])
  })

  it('keeps unbound legacy physical folders isolated instead of merging by title', () => {
    const groups = groupFavoritePhysicalShards([
      { id: 'remote-b', title: 'bilimi-collision', memberAids: [2] },
      { id: 'remote-a', title: 'bilimi-collision', memberAids: [1] }
    ])

    expect(groups).toEqual([
      expect.objectContaining({ logicalLedgerId: 'legacy-physical:remote-a', memberAids: [1] }),
      expect.objectContaining({ logicalLedgerId: 'legacy-physical:remote-b', memberAids: [2] })
    ])
  })

  it('orders groups and shards deterministically when remote folders arrive unordered', () => {
    const groups = groupFavoritePhysicalShards([
      { id: 'z', logicalLedgerId: 'ledger-b', title: 'B·3', memberAids: [] },
      { id: 'z-2', logicalLedgerId: 'ledger-a', title: 'A·2', memberAids: [] },
      { id: 'a-2', logicalLedgerId: 'ledger-a', title: 'A·2', memberAids: [] },
      { id: 'a-1', logicalLedgerId: 'ledger-a', title: 'A', memberAids: [] }
    ])

    expect(groups.map((group) => group.logicalLedgerId)).toEqual(['ledger-a', 'ledger-b'])
    expect(groups[0].shards.map((shard) => shard.id)).toEqual(['a-1', 'a-2', 'z-2'])
  })

  it('derives each logical title from the canonical shard regardless of remote input order', () => {
    const shards = [
      { id: 'later', logicalLedgerId: 'with-first', title: getFavoritePhysicalShardTitle('other-first', 2), memberAids: [] },
      { id: 'first', logicalLedgerId: 'with-first', title: 'canon-first', memberAids: [] },
      { id: 'later', logicalLedgerId: 'without-first', title: getFavoritePhysicalShardTitle('other-later', 3), memberAids: [] },
      { id: 'b', logicalLedgerId: 'without-first', title: getFavoritePhysicalShardTitle('other-equal', 2), memberAids: [] },
      { id: 'a', logicalLedgerId: 'without-first', title: getFavoritePhysicalShardTitle('canon-fallback', 2), memberAids: [] }
    ]

    for (const orderedShards of [shards, [...shards].reverse()]) {
      expect(groupFavoritePhysicalShards(orderedShards)).toEqual([
        expect.objectContaining({ logicalLedgerId: 'with-first', logicalTitle: 'canon-first' }),
        expect.objectContaining({ logicalLedgerId: 'without-first', logicalTitle: 'canon-fallback' })
      ])
    }
  })

  it('allocates from a deterministic shard and reports the stable logical ledger identity', async () => {
    const result = await allocateFavoritePhysicalShards({
      logicalLedgerId: 'ledger-a',
      logicalTitle: 'A',
      requestedAids: [1],
      shards: [
        { id: 'z', logicalLedgerId: 'ledger-a', title: 'A', memberAids: [] },
        { id: 'a', logicalLedgerId: 'ledger-a', title: 'A', memberAids: [] }
      ],
      createShard: vi.fn()
    })

    expect(result).toMatchObject({
      status: 'ready',
      assignments: [{ logicalLedgerId: 'ledger-a', shardId: 'z', aid: 1 }]
    })
  })

  it('reserves suffix space within the 20-character remote title limit', () => {
    const logicalTitle = prepareFavoriteLogicalFolderTitle('bilimi-a-very-long-category-name')
    expect(logicalTitle.length).toBeLessThanOrEqual(14)
    expect(`${logicalTitle}-30`.length).toBeLessThanOrEqual(20)
  })

  it('keeps shard 100 and larger recognizable as the same display title', () => {
    const logicalTitle = prepareFavoriteLogicalFolderTitle('bilimi-a-very-long-category-name')
    const shard100 = getFavoritePhysicalShardTitle(logicalTitle, 100)
    const shard1234 = getFavoritePhysicalShardTitle(logicalTitle, 1234)

    expect(shard100.length).toBeLessThanOrEqual(20)
    expect(shard1234.length).toBeLessThanOrEqual(20)
    expect(getFavoriteLogicalFolderTitle(shard100)).toBe(logicalTitle)
    expect(getFavoriteLogicalFolderTitle(shard1234)).toBe(logicalTitle)
  })

  it('fills the last available shard, accounts for reservations, then creates a new shard', async () => {
    const createShard = vi.fn().mockResolvedValue({ id: 'new-3' })
    const result = await allocateFavoritePhysicalShards({
      logicalLedgerId: 'games',
      logicalTitle: 'bilimi-games',
      requestedAids: [998, 999, 1000, 1001, 1001],
      shards: [
        { id: 'one', logicalLedgerId: 'games', title: 'bilimi-games', memberAids: [1, 2, 3] },
        { id: 'two', logicalLedgerId: 'games', title: 'bilimi-games·2', memberAids: [1002], reservedAids: [1003] }
      ],
      maxMembersPerShard: 3,
      createShard
    })

    expect(result.status).toBe('ready')
    expect(result.assignments).toEqual([
      { logicalLedgerId: 'games', shardId: 'two', aid: 998 },
      { logicalLedgerId: 'games', shardId: 'new-3', aid: 999 },
      { logicalLedgerId: 'games', shardId: 'new-3', aid: 1000 },
      { logicalLedgerId: 'games', shardId: 'new-3', aid: 1001 }
    ])
    expect(createShard).toHaveBeenCalledWith('games', getFavoritePhysicalShardTitle('bilimi-games', 3), 3)
  })

  it('pauses the target when creating a required shard fails and never falls back to another folder', async () => {
    const result = await allocateFavoritePhysicalShards({
      logicalLedgerId: 'games',
      logicalTitle: 'bilimi-games',
      requestedAids: [2],
      shards: [{ id: 'full', logicalLedgerId: 'games', title: 'bilimi-games', memberAids: [1] }],
      maxMembersPerShard: 1,
      createShard: vi.fn().mockResolvedValue(null)
    })

    expect(result).toEqual({
      status: 'paused',
      reason: 'create-shard-failed',
      failedAid: 2,
      assignments: [],
      createdShards: []
    })
  })

  it('uses shard numbering rather than remote list order when choosing the last shard and next title', async () => {
    const createShard = vi.fn().mockResolvedValue({ id: 'new-4' })
    const result = await allocateFavoritePhysicalShards({
      logicalLedgerId: 'games',
      logicalTitle: 'bilimi-games',
      requestedAids: [10, 11],
      shards: [
        { id: 'three', logicalLedgerId: 'games', title: 'bilimi-games·3', memberAids: [] },
        { id: 'one', logicalLedgerId: 'games', title: 'bilimi-games', memberAids: [1] }
      ],
      maxMembersPerShard: 1,
      createShard
    })

    expect(result.status).toBe('ready')
    expect(result.assignments).toEqual([
      { logicalLedgerId: 'games', shardId: 'three', aid: 10 },
      { logicalLedgerId: 'games', shardId: 'new-4', aid: 11 }
    ])
    expect(createShard).toHaveBeenCalledWith('games', getFavoritePhysicalShardTitle('bilimi-games', 4), 4)
  })
})
