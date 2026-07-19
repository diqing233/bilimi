import { describe, expect, it } from 'vitest'
import { compileFrozenFavoriteSyncPlan } from './favoriteRepositoryExecutionPlan'

describe('compileFrozenFavoriteSyncPlan', () => {
  it('compiles one immutable remote operation from a logical classification and bound shard', () => {
    expect(compileFrozenFavoriteSyncPlan({
      accountMid: '100', workspaceId: 'workspace-1', baselineRevision: 2,
      createdAt: '2026-07-20T00:00:00.000Z',
      classifications: [{ aid: 1, targetLedgerIds: ['music'] }],
      shards: [{ logicalLedgerId: 'music', remoteFolderId: 'remote-music', memberAids: [] }]
    })).toEqual(expect.objectContaining({
      allowed: true,
      plan: expect.objectContaining({
        accountMid: '100', workspaceId: 'workspace-1', baselineRevision: 2,
        operations: [expect.objectContaining({ aid: 1, kind: 'append', folderIds: ['remote-music'] })]
      })
    }))
  })

  it('rejects an unbound logical ledger instead of passing its local id to Bilibili', () => {
    expect(compileFrozenFavoriteSyncPlan({
      accountMid: '100', workspaceId: 'workspace-1', baselineRevision: 2,
      createdAt: '2026-07-20T00:00:00.000Z',
      classifications: [{ aid: 1, targetLedgerIds: ['music'] }], shards: []
    })).toEqual({ allowed: false, reason: 'remote-target-unbound', plan: null })
  })

  it('rejects a full physical shard before any remote execution is frozen', () => {
    expect(compileFrozenFavoriteSyncPlan({
      accountMid: '100', workspaceId: 'workspace-1', baselineRevision: 2,
      createdAt: '2026-07-20T00:00:00.000Z',
      classifications: [{ aid: 1, targetLedgerIds: ['music'] }],
      shards: [{ logicalLedgerId: 'music', remoteFolderId: 'remote-music', memberAids: Array.from({ length: 1_000 }, (_, index) => index + 10) }]
    })).toEqual({ allowed: false, reason: 'physical-shard-capacity-exceeded', plan: null })
  })
})
