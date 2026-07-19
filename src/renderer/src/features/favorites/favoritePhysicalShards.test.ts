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
      logicalTitle: 'bilimi路知识',
      requestedAids: [REMOTE_FAVORITE_SHARD_CAPACITY + 1],
      shards: [{ id: 'full', title: 'bilimi路知识', memberAids }],
      createShard
    })

    expect(result).toMatchObject({ status: 'ready', createdShards: [{ id: 'new-2', shardNumber: 2 }] })
  })

  it('caps a caller-provided shard capacity at the shared remote hard limit', async () => {
    const createShard = vi.fn().mockResolvedValue({ id: 'new-2' })
    const memberAids = Array.from({ length: REMOTE_FAVORITE_SHARD_CAPACITY }, (_, index) => index + 1)

    const result = await allocateFavoritePhysicalShards({
      logicalTitle: 'bilimi路知识',
      requestedAids: [REMOTE_FAVORITE_SHARD_CAPACITY + 1],
      shards: [{ id: 'full', title: 'bilimi路知识', memberAids }],
      maxMembersPerShard: REMOTE_FAVORITE_SHARD_CAPACITY + 1,
      createShard
    })

    expect(result).toMatchObject({ status: 'ready', createdShards: [{ id: 'new-2', shardNumber: 2 }] })
    expect(createShard).toHaveBeenCalledTimes(1)
  })

  it('recognizes stable shard names and merges membership by logical folder with aid deduplication', () => {
    const groups = groupFavoritePhysicalShards([
      { id: 'a', title: 'bilimi·原神', memberAids: [1, 2], membershipComplete: true },
      { id: 'b', title: 'bilimi·原神·2', memberAids: [2, 3], membershipComplete: true },
      { id: 'c', title: 'bilimi·暂存', memberAids: [4], membershipComplete: true, isInbox: true },
      { id: 'd', title: 'bilimi·暂存·2', memberAids: [4, 5], membershipComplete: true, isInbox: true }
    ])

    expect(groups).toEqual([
      expect.objectContaining({ logicalTitle: 'bilimi·原神', shardCount: 2, memberAids: [1, 2, 3], isInbox: false }),
      expect.objectContaining({ logicalTitle: 'bilimi·暂存', shardCount: 2, memberAids: [4, 5], isInbox: true })
    ])
  })

  it('reserves suffix space within the 20-character remote title limit', () => {
    const logicalTitle = prepareFavoriteLogicalFolderTitle('bilimi·这是一个非常非常长的分类名称')
    expect(logicalTitle.length).toBeLessThanOrEqual(17)
    expect(`${logicalTitle}·30`.length).toBeLessThanOrEqual(20)
  })

  it('keeps shard 100 and larger recognizable as the same stable logical folder', () => {
    const logicalTitle = prepareFavoriteLogicalFolderTitle('bilimi·这是一个非常非常长的分类名称')
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
      logicalTitle: 'bilimi·原神',
      requestedAids: [998, 999, 1000, 1001, 1001],
      shards: [
        { id: 'one', title: 'bilimi·原神', memberAids: [1, 2, 3] },
        { id: 'two', title: 'bilimi·原神·2', memberAids: [1002], reservedAids: [1003] }
      ],
      maxMembersPerShard: 3,
      createShard
    })

    expect(result.status).toBe('ready')
    expect(result.assignments).toEqual([
      { shardId: 'two', aid: 998 },
      { shardId: 'new-3', aid: 999 },
      { shardId: 'new-3', aid: 1000 },
      { shardId: 'new-3', aid: 1001 }
    ])
    expect(createShard).toHaveBeenCalledWith('bilimi·原神·3', 3)
  })

  it('pauses the target when creating a required shard fails and never falls back to another folder', async () => {
    const result = await allocateFavoritePhysicalShards({
      logicalTitle: 'bilimi·原神',
      requestedAids: [2],
      shards: [{ id: 'full', title: 'bilimi·原神', memberAids: [1] }],
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
      logicalTitle: 'bilimi·原神',
      requestedAids: [10, 11],
      shards: [
        { id: 'three', title: 'bilimi·原神·3', memberAids: [] },
        { id: 'one', title: 'bilimi·原神', memberAids: [1] }
      ],
      maxMembersPerShard: 1,
      createShard
    })

    expect(result.status).toBe('ready')
    expect(result.assignments).toEqual([
      { shardId: 'three', aid: 10 },
      { shardId: 'new-4', aid: 11 }
    ])
    expect(createShard).toHaveBeenCalledWith('bilimi·原神·4', 4)
  })
})
