import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FavoriteRepositoryBindingService,
  favoriteRepositoryManagedShardTitle,
  favoriteRepositoryManagedShardTitleForDisplay
} from './favoriteRepositoryBindingService'
import { FavoriteRepositoryService } from './favoriteRepositoryService'

const roots: string[] = []

async function createRepository() {
  const root = await mkdtemp(join(tmpdir(), 'bilimi-favorite-binding-'))
  roots.push(root)
  return new FavoriteRepositoryService({ root, now: () => '2026-07-20T00:00:00.000Z' })
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('FavoriteRepositoryBindingService', () => {
  it('uses a bounded deterministic Bilibili shard title with a short binding token', () => {
    const title = favoriteRepositoryManagedShardTitle('a-very-long-logical-ledger-id', 123, 'abcdef')
    expect([...title]).toHaveLength(18)
    expect(title).toMatch(/^B-[a-z0-9]{5}-123-[a-f0-9]{6}$/)
  })

  it('uses circled capacity names for displayed shards while keeping the first folder unsuffixed', () => {
    expect(favoriteRepositoryManagedShardTitleForDisplay('game', 1, 'ignored', 'bilimi·游戏专区')).toBe('bilimi·游戏专区')
    expect(favoriteRepositoryManagedShardTitleForDisplay('game', 2, 'ignored', 'bilimi·游戏专区')).toBe('bilimi·游戏专区②')
    expect(favoriteRepositoryManagedShardTitleForDisplay('game', 3, 'ignored', 'bilimi·游戏专区①')).toBe('bilimi·游戏专区③')
    expect(favoriteRepositoryManagedShardTitleForDisplay('game', 2, 'ignored', '12345678901234567890')).toBe('1234567890123456789②')
    expect(favoriteRepositoryManagedShardTitleForDisplay('game', 2, 'ignored', '1234567890123456789①')).toBe('1234567890123456789②')
  })

  it('notifies the refresh hook only after a Bilibili folder create succeeds', async () => {
    const repository = await createRepository()
    const onConfirmedRemoteFolderMutation = vi.fn()
    const service = new FavoriteRepositoryBindingService({
      repository,
      onConfirmedRemoteFolderMutation,
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory: vi.fn()
            .mockResolvedValueOnce({ observedAccountMid: '100', folders: [] })
            .mockResolvedValueOnce({ observedAccountMid: '100', folders: [] }),
          createFolder: vi.fn().mockResolvedValue({
            observedAccountMid: '100', folder: { id: 'new-game', title: 'bilimi·游戏专区', memberCount: 0 }
          }),
          append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })

    await service.ensurePhysicalShard('100', {
      logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区', remoteDisplayTitle: 'bilimi·游戏专区', shardNumber: 1, memberAids: []
    })

    expect(onConfirmedRemoteFolderMutation).toHaveBeenCalledWith('100')
  })

  it('notifies the refresh hook only after a Bilibili rename is verified', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'bound-game-shard', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z',
      type: 'upsert-physical-shard-binding',
      payload: {
        logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区', shardNumber: 1, memberAids: [],
        remoteTitle: 'bilimi·游戏专区', bindingState: 'bound', remoteFolderId: 'game-1', remoteMemberCount: 0
      }
    })
    let remoteTitle = 'bilimi·游戏专区'
    const onConfirmedRemoteFolderMutation = vi.fn()
    const service = new FavoriteRepositoryBindingService({
      repository,
      onConfirmedRemoteFolderMutation,
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory: vi.fn(async () => ({
            observedAccountMid: '100', folders: [{ id: 'game-1', title: remoteTitle, memberCount: 0 }]
          })),
          renameFolder: vi.fn(async ({ title }: { title: string }) => {
            remoteTitle = title
            return { observedAccountMid: '100' }
          }),
          createFolder: vi.fn(), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })

    await service.renameBoundPhysicalShard('100', {
      logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区新', remoteFolderId: 'game-1', shardNumber: 1
    })

    expect(onConfirmedRemoteFolderMutation).toHaveBeenCalledWith('100')
  })

  it('does not notify the refresh hook when a Bilibili rename is rejected', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'bound-game-shard', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z',
      type: 'upsert-physical-shard-binding',
      payload: {
        logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区', shardNumber: 1, memberAids: [],
        remoteTitle: 'bilimi·游戏专区', bindingState: 'bound', remoteFolderId: 'game-1', remoteMemberCount: 0
      }
    })
    const onConfirmedRemoteFolderMutation = vi.fn()
    const service = new FavoriteRepositoryBindingService({
      repository,
      onConfirmedRemoteFolderMutation,
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory: vi.fn().mockResolvedValue({
            observedAccountMid: '100', folders: [{ id: 'game-1', title: 'bilimi·游戏专区', memberCount: 0 }]
          }),
          renameFolder: vi.fn().mockResolvedValue({ status: 'rejected', observedAccountMid: '100', reason: 'rejected' }),
          createFolder: vi.fn(), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })

    await expect(service.renameBoundPhysicalShard('100', {
      logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区新', remoteFolderId: 'game-1', shardNumber: 1
    })).rejects.toThrow('rejected')

    expect(onConfirmedRemoteFolderMutation).not.toHaveBeenCalled()
  })

  it('persists a logical ledger with a bound numbered Bilibili shard across a restart', async () => {
    const repository = await createRepository()
    const service = new FavoriteRepositoryBindingService({ repository, now: () => '2026-07-20T00:00:00.000Z', newBindingToken: () => 'a1b2c3' })

    await service.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: '音乐', shardNumber: 1,
      memberAids: [1, 2], remoteFolderId: 'remote-music-1',
      observedAccountMid: '100',
      inventory: [{ id: 'remote-music-1', title: 'B-music-001-a1b2c3', memberCount: 2, memberAids: [1, 2] }]
    })

    const restarted = new FavoriteRepositoryBindingService({
      repository: new FavoriteRepositoryService({ root: roots[0], now: () => '2026-07-20T00:00:00.000Z' })
    })
    expect(await restarted.getBindings('100')).toEqual({
      logicalLedgers: [{ id: 'music', title: '音乐', syncState: 'bound' }],
      shards: [{ logicalLedgerId: 'music', folderId: 'bilimi:music:001', shardNumber: 1,
        remoteFolderId: 'remote-music-1', remoteTitle: 'B-music-001-a1b2c3', bindingState: 'bound', remoteMemberCount: 2 }]
    })
  })

  it('keeps existing local members when adopting a bound shard with no remote member payload', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'seed-local-game', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'commit-local-plan',
      payload: {
        workspaceId: 'workspace-1', memberAidsByFolderId: { 'bilimi-logical:game': [7, 9] },
        folders: [{ id: 'bilimi-logical:game', title: 'bilimi·游戏专区', kind: 'bilimi-logical', logicalLedgerId: 'game', syncState: 'local-only' }]
      }
    })
    const service = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })

    await service.preparePhysicalShard('100', {
      logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区', remoteDisplayTitle: 'B-game-001-a1b2c3', shardNumber: 1,
      memberAids: [], remoteFolderId: 'remote-game', observedAccountMid: '100',
      inventory: [{ id: 'remote-game', title: 'B-game-001-a1b2c3', memberCount: 0, memberAids: [] }]
    })

    const snapshot = await repository.getSnapshot('100')
    expect(snapshot.memberships['bilimi-logical:game']).toEqual([7, 9])
    expect(snapshot.memberships['bilimi:game:001']).toEqual([7, 9])
    expect(snapshot.physicalShards[0]).toMatchObject({ bindingState: 'bound', remoteFolderId: 'remote-game' })
  })

  it('keeps accounts isolated when they use the same logical ledger id', async () => {
    const repository = await createRepository()
    const service = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    await service.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: '音乐', shardNumber: 1, memberAids: [],
      remoteFolderId: 'a-folder', observedAccountMid: '100', inventory: [{ id: 'a-folder', title: 'B-music-001-a1b2c3', memberCount: 0, memberAids: [] }]
    })
    await service.preparePhysicalShard('200', {
      logicalLedgerId: 'music', logicalTitle: '音乐', shardNumber: 1, memberAids: [],
      remoteFolderId: 'b-folder', observedAccountMid: '200', inventory: [{ id: 'b-folder', title: 'B-music-001-a1b2c3', memberCount: 0, memberAids: [] }]
    })

    expect((await service.getBindings('100')).shards[0]?.remoteFolderId).toBe('a-folder')
    expect((await service.getBindings('200')).shards[0]?.remoteFolderId).toBe('b-folder')
  })

  it('persists an unknown shard create as pending and reconciles only one exact managed title', async () => {
    const repository = await createRepository()
    const service = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    await service.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: '音乐', shardNumber: 1, memberAids: [], observedAccountMid: '100', inventory: []
    })
    expect((await service.getBindings('100')).shards[0]).toMatchObject({ bindingState: 'pending-reconcile' })

    await service.reconcilePendingBindings('100', { observedAccountMid: '100', inventory: [
      { id: 'remote-music-1', title: 'B-music-001-a1b2c3', memberCount: 0, memberAids: [] }
    ] })
    expect((await service.getBindings('100')).shards[0]).toMatchObject({
      bindingState: 'bound', remoteFolderId: 'remote-music-1'
    })
  })

  it('does not guess a remote folder when reconciliation finds an ambiguous managed title', async () => {
    const repository = await createRepository()
    const service = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    await service.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: '音乐', shardNumber: 1, memberAids: [], observedAccountMid: '100', inventory: []
    })

    await service.reconcilePendingBindings('100', { observedAccountMid: '100', inventory: [
      { id: 'remote-a', title: 'B-music-001-a1b2c3', memberCount: 0, memberAids: [] },
      { id: 'remote-b', title: 'B-music-001-a1b2c3', memberCount: 0, memberAids: [] }
    ] })
    expect((await service.getBindings('100')).shards[0]).toMatchObject({
      bindingState: 'pending-reconcile'
    })
  })

  it('rejects a shard that exceeds Bilibili capacity without persisting a binding', async () => {
    const repository = await createRepository()
    const service = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })

    await expect(service.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: '音乐', shardNumber: 1,
      memberAids: Array.from({ length: 1001 }, (_, index) => index + 1), observedAccountMid: '100', inventory: []
    })).rejects.toThrow('capacity')
    expect(await service.getBindings('100')).toEqual({ logicalLedgers: [], shards: [] })
  })

  it('does not bind a full remote shard when the frozen work needs new members', async () => {
    const repository = await createRepository()
    const service = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })

    await expect(service.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: '音乐', shardNumber: 1, memberAids: [1],
      remoteFolderId: 'remote-music-1',
      observedAccountMid: '100',
      inventory: [{ id: 'remote-music-1', title: 'B-music-001-a1b2c3', memberCount: 1000, memberAids: Array.from({ length: 1000 }, (_, index) => index + 2) }]
    })).rejects.toThrow('capacity')
    expect(await service.getBindings('100')).toEqual({ logicalLedgers: [], shards: [] })
  })

  it('refuses a new pending shard when the remote folder inventory is already at 99', async () => {
    const repository = await createRepository()
    const service = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })

    await expect(service.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: '音乐', shardNumber: 1, memberAids: [],
      observedAccountMid: '100', inventory: Array.from({ length: 99 }, (_, index) => ({ id: `remote-${index}`, title: `other-${index}`, memberCount: 0, memberAids: [] }))
    })).rejects.toThrow('folder limit')
    expect(await service.getBindings('100')).toEqual({ logicalLedgers: [], shards: [] })
  })

  it('requires explicit rebinding instead of claiming a same-title remote folder after a local reset', async () => {
    const repository = await createRepository()
    const createFolder = vi.fn()
    const service = new FavoriteRepositoryBindingService({
      repository,
      newBindingToken: () => 'a1b2c3',
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn((_accountMid, _runId) => ({
          readFolderInventory: vi.fn().mockResolvedValue({
            observedAccountMid: '100',
            folders: [
              { id: 'existing-music', title: 'bilimi·音乐舞台', memberCount: 12 },
              ...Array.from({ length: 98 }, (_, index) => ({ id: `other-${index}`, title: `other-${index}`, memberCount: 0 }))
            ]
          }),
          createFolder, append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })

    await expect(service.ensurePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: 'bilimi·音乐舞台', remoteDisplayTitle: 'bilimi·音乐舞台', shardNumber: 1, memberAids: []
    })).rejects.toThrow('explicit rebinding')
    expect(createFolder).not.toHaveBeenCalled()
  })

  it('reconciles pending bindings from the live page inventory on account open', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'pending-music', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'upsert-physical-shard-binding',
      payload: { logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber: 1, memberAids: [], remoteTitle: 'bilimi·Music', bindingState: 'pending-reconcile' }
    })
    const readFolderInventory = vi.fn().mockResolvedValue({ observedAccountMid: '100', folders: [
      { id: 'remote-music', title: 'bilimi·Music', memberCount: 4 }
    ]})
    const service = new FavoriteRepositoryBindingService({
      repository,
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({ readFolderInventory, append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn() }))
      }
    })

    await service.reconcilePendingBindingsFromRemote('100')
    expect(readFolderInventory).toHaveBeenCalledOnce()
    expect((await service.getBindings('100')).shards[0]).toMatchObject({ bindingState: 'bound', remoteFolderId: 'remote-music' })
  })

  it('releases only bound exact ids absent from the explicit preflight inventory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bilimi-favorite-binding-release-'))
    roots.push(root)
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-09-10T00:00:00.000Z' })
    await repository.commit('100', {
      id: 'bound-game-1', accountMid: '100', issuedAt: '2026-09-10T00:00:00.000Z', type: 'upsert-physical-shard-binding',
      payload: {
        logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区', shardNumber: 1, memberAids: [],
        remoteTitle: 'bilimi·游戏专区', bindingState: 'bound', remoteFolderId: 'game-1', remoteMemberCount: 999
      }
    })
    await repository.commit('100', {
      id: 'bound-game-2', accountMid: '100', issuedAt: '2026-09-10T00:00:01.000Z', type: 'upsert-physical-shard-binding',
      payload: {
        logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区', shardNumber: 2, memberAids: [],
        remoteTitle: 'bilimi·游戏专区②', bindingState: 'bound', remoteFolderId: 'deleted-game-2', remoteMemberCount: 0
      }
    })
    const createFolder = vi.fn()
    const deleteFolder = vi.fn()
    const service = new FavoriteRepositoryBindingService({
      repository,
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory: vi.fn().mockResolvedValue({
            observedAccountMid: '100',
            folders: [
              { id: 'game-1', title: 'bilimi·游戏专区', memberCount: 999 },
              { id: 'replacement-game-2', title: 'bilimi·游戏专区②', memberCount: 0 }
            ]
          }),
          createFolder, deleteFolder, append: vi.fn(), remove: vi.fn(), readMembers: vi.fn()
        }))
      }
    })

    await expect(service.releaseBoundPhysicalShardsAbsentFromRemote('100', {
      logicalLedgerIds: ['game']
    })).resolves.toEqual({ releasedRemoteFolderIds: ['deleted-game-2'] })

    expect((await service.getBindings('100')).shards).toEqual([
      expect.objectContaining({ logicalLedgerId: 'game', shardNumber: 1, remoteFolderId: 'game-1' })
    ])
    expect(createFolder).not.toHaveBeenCalled()
    expect(deleteFolder).not.toHaveBeenCalled()
    expect((await new FavoriteRepositoryBindingService({
      repository: new FavoriteRepositoryService({ root })
    }).getBindings('100')).shards).toEqual([
      expect.objectContaining({ logicalLedgerId: 'game', shardNumber: 1, remoteFolderId: 'game-1' })
    ])
  })

  it('inspects only live bound exact ids and counts without mutating local bindings', async () => {
    const repository = await createRepository()
    for (const [shardNumber, remoteFolderId, remoteTitle] of [
      [1, 'game-1', 'bilimi·游戏专区'],
      [2, 'deleted-game-2', 'bilimi·游戏专区②']
    ] as const) {
      await repository.commit('100', {
        id: `bound-game-${shardNumber}`, accountMid: '100', issuedAt: `2026-09-10T00:00:0${shardNumber}.000Z`,
        type: 'upsert-physical-shard-binding', payload: {
          logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区', shardNumber, memberAids: [],
          remoteTitle, bindingState: 'bound', remoteFolderId, remoteMemberCount: 1_000
        }
      })
    }
    const readFolderInventory = vi.fn().mockResolvedValue({
      observedAccountMid: '100', folders: [
        { id: 'game-1', title: 'bilimi·游戏专区', memberCount: 3 },
        { id: 'same-title-unbound', title: 'bilimi·游戏专区②', memberCount: 999 }
      ]
    })
    const service = new FavoriteRepositoryBindingService({
      repository,
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory, createFolder: vi.fn(), deleteFolder: vi.fn(),
          append: vi.fn(), remove: vi.fn(), readMembers: vi.fn()
        }))
      }
    })
    const revisionBefore = (await repository.getSnapshot('100')).revision

    await expect(service.inspectBoundPhysicalShardsFromRemote('100', {
      logicalLedgerIds: ['game']
    })).resolves.toEqual([
      { logicalLedgerId: 'game', remoteFolderId: 'game-1', shardNumber: 1, memberCount: 3 }
    ])

    expect(readFolderInventory).toHaveBeenCalledOnce()
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({ revision: revisionBefore })
  })

  it('does not reconcile a pending shard whose exact remote id is deletion-suppressed', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'pending-deleted-recommendation', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'upsert-physical-shard-binding',
      payload: { logicalLedgerId: 'recommended-up', logicalTitle: '专属 UP 追更', shardNumber: 1, memberAids: [], remoteTitle: 'bilimi·专属 UP 追更', bindingState: 'pending-reconcile', remoteFolderId: 'deleted-recommendation-remote' }
    })
    const service = new FavoriteRepositoryBindingService({
      repository,
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory: vi.fn().mockResolvedValue({ observedAccountMid: '100', folders: [
            { id: 'deleted-recommendation-remote', title: 'bilimi·专属 UP 追更', memberCount: 4 }
          ]}), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })

    await service.reconcilePendingBindingsFromRemote('100', { suppressedRemoteFolderIds: ['deleted-recommendation-remote'] })

    expect((await service.getBindings('100')).shards[0]).toMatchObject({
      bindingState: 'pending-reconcile', remoteFolderId: 'deleted-recommendation-remote'
    })
  })

  it('keeps scan-discovered candidate ids pending until the user confirms recovery', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'scanned-game-shard', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'upsert-physical-shard-binding',
      payload: {
        logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区', shardNumber: 2, memberAids: [],
        remoteTitle: 'bilimi·游戏专区·2', bindingState: 'pending-reconcile', knownRemoteFolderIds: ['game-2']
      }
    })
    const service = new FavoriteRepositoryBindingService({ repository })

    await service.reconcilePendingBindings('100', {
      observedAccountMid: '100', inventory: [{ id: 'game-2', title: 'bilimi·游戏专区·2', memberCount: 4 }]
    })

    const snapshot = await repository.getSnapshot('100')
    expect(snapshot.physicalShards).toEqual([expect.objectContaining({
      logicalLedgerId: 'game', shardNumber: 2, bindingState: 'pending-reconcile', knownRemoteFolderIds: ['game-2']
    })])
    expect(snapshot.memberships['bilimi-logical:game']).toEqual([])
  })

  it('restores a migrated pending binding by exact folder ID after the remote folder was renamed', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'migrated-music', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'upsert-physical-shard-binding',
      payload: { logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber: 1, memberAids: [], remoteTitle: 'bilimi·Music', bindingState: 'pending-reconcile', remoteFolderId: 'remote-music' }
    })
    const service = new FavoriteRepositoryBindingService({ repository })

    await service.reconcilePendingBindings('100', {
      observedAccountMid: '100', inventory: [{ id: 'remote-music', title: 'renamed-on-bilibili', memberCount: 4 }]
    })

    expect((await service.getBindings('100')).shards[0]).toMatchObject({
      bindingState: 'bound', remoteFolderId: 'remote-music', remoteTitle: 'renamed-on-bilibili'
    })
  })

  it('previews remote rebinding candidates without adopting them', async () => {
    const repository = await createRepository()
    const service = new FavoriteRepositoryBindingService({
      repository,
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory: vi.fn().mockResolvedValue({ observedAccountMid: '100', folders: [
            { id: 'remote-music', title: 'bilimi·Music', memberCount: 4 }
          ]}), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })

    await expect(service.previewLedgerBindingCandidates('100', [{ ledgerId: 'music', title: 'bilimi·Music' }])).resolves.toEqual([
      { ledgerId: 'music', candidates: [{ id: 'remote-music', title: 'bilimi·Music', memberCount: 4 }] }
    ])
  })

  it('does not return a formally bound main shard as a rebinding candidate, but keeps an unbound circled shard', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'bound-game-main', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z',
      type: 'upsert-physical-shard-binding',
      payload: {
        logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区', shardNumber: 1, memberAids: [],
        remoteTitle: 'bilimi·游戏专区', bindingState: 'bound', remoteFolderId: 'bound-main'
      }
    })
    const service = new FavoriteRepositoryBindingService({
      repository,
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory: vi.fn().mockResolvedValue({ observedAccountMid: '100', folders: [
            { id: 'ordinary', title: 'bilimi·游戏专区', memberCount: 2 },
            { id: 'bound-main', title: 'bilimi·游戏专区', memberCount: 1000 },
            { id: 'unbound-2', title: 'bilimi·游戏专区②', memberCount: 4 },
            { id: 'unbound-circle-1', title: 'bilimi·游戏专区①', memberCount: 3 },
            { id: 'unbound-circle-2', title: 'bilimi·游戏专区②', memberCount: 5 }
          ]}), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })

    await expect(service.previewLedgerBindingCandidates('100', [{ ledgerId: 'game', title: 'bilimi·游戏专区' }])).resolves.toEqual([
      { ledgerId: 'game', candidates: [
        { id: 'ordinary', title: 'bilimi·游戏专区', memberCount: 2 },
        { id: 'unbound-2', title: 'bilimi·游戏专区②', memberCount: 4 },
        { id: 'unbound-circle-1', title: 'bilimi·游戏专区①', memberCount: 3 },
        { id: 'unbound-circle-2', title: 'bilimi·游戏专区②', memberCount: 5 }
      ] }
    ])
  })

  it('returns historical shard numbers for candidates whose remote IDs were previously recorded', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'pending-game-shard-2', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z',
      type: 'upsert-physical-shard-binding',
      payload: {
        logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区', shardNumber: 2, memberAids: [],
        remoteTitle: 'bilimi·游戏专区', bindingState: 'pending-reconcile', knownRemoteFolderIds: ['historical-2']
      }
    })
    const service = new FavoriteRepositoryBindingService({
      repository,
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory: vi.fn().mockResolvedValue({ observedAccountMid: '100', folders: [
            { id: 'historical-2', title: 'bilimi·游戏专区', memberCount: 307 }
          ]}), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })

    await expect(service.previewLedgerBindingCandidates('100', [{ ledgerId: 'game', title: 'bilimi·游戏专区' }])).resolves.toEqual([
      { ledgerId: 'game', candidates: [{ id: 'historical-2', title: 'bilimi·游戏专区', memberCount: 307, shardNumber: 2 }] }
    ])
  })

  it('adopts every confirmed physical shard for one logical ledger', async () => {
    const repository = await createRepository()
    const inventory = [
      { id: 'game-1', title: 'bilimi·游戏专区', memberCount: 1000, memberAids: [] },
      { id: 'game-2', title: 'bilimi·游戏专区②', memberCount: 6, memberAids: [] }
    ]
    const service = new FavoriteRepositoryBindingService({
      repository,
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory: vi.fn().mockResolvedValue({ observedAccountMid: '100', folders: inventory }),
          createFolder: vi.fn(), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })

    await service.adoptExistingPhysicalShard('100', {
      logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区', remoteDisplayTitle: 'bilimi·游戏专区',
      expectedRemoteTitle: 'bilimi·游戏专区', remoteFolderId: 'game-1', shardNumber: 1, memberAids: []
    })
    await service.adoptExistingPhysicalShard('100', {
      logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区', remoteDisplayTitle: 'bilimi·游戏专区②',
      expectedRemoteTitle: 'bilimi·游戏专区②', remoteFolderId: 'game-2', shardNumber: 2, memberAids: []
    })

    expect((await service.getBindings('100')).shards).toEqual([
      expect.objectContaining({ logicalLedgerId: 'game', shardNumber: 1, remoteFolderId: 'game-1', bindingState: 'bound' }),
      expect.objectContaining({ logicalLedgerId: 'game', shardNumber: 2, remoteFolderId: 'game-2', bindingState: 'bound' })
    ])
  })

  it('accepts a circled shard title when the exact remote id is confirmed', async () => {
    const repository = await createRepository()
    const service = new FavoriteRepositoryBindingService({
      repository,
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory: vi.fn().mockResolvedValue({ observedAccountMid: '100', folders: [
            { id: 'game-2', title: 'bilimi·游戏专区②', memberCount: 0 }
          ]}),
          createFolder: vi.fn(), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })

    await expect(service.adoptExistingPhysicalShard('100', {
      logicalLedgerId: 'game', logicalTitle: '游戏专区', remoteDisplayTitle: 'bilimi·游戏专区②',
      expectedRemoteTitle: 'bilimi·游戏专区②', remoteFolderId: 'game-2', shardNumber: 2, memberAids: []
    })).resolves.toMatchObject({
      shards: [expect.objectContaining({ remoteFolderId: 'game-2', bindingState: 'bound' })]
    })
  })

  it('reclaims a saved remote id after a reset retained its prior binding command result', async () => {
    const repository = await createRepository()
    const service = new FavoriteRepositoryBindingService({
      repository,
      newBindingToken: () => 'a1b2c3',
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn((_accountMid, _runId) => ({
          readFolderInventory: vi.fn().mockResolvedValue({
            observedAccountMid: '100',
            folders: [{ id: 'saved-music', title: 'bilimi·Music', memberCount: 12 }]
          }),
          createFolder: vi.fn(), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })
    const input = {
      logicalLedgerId: 'music', logicalTitle: 'bilimi·Music', remoteDisplayTitle: 'bilimi·Music',
      preferredRemoteFolderId: 'saved-music', shardNumber: 1, memberAids: []
    }

    await service.ensurePhysicalShard('100', input)
    await repository.commit('100', {
      id: 'reset-with-stale-binding-result', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z',
      type: 'clear-local-repository', payload: {}
    })

    await expect(service.ensurePhysicalShard('100', input)).resolves.toMatchObject({
      shards: [expect.objectContaining({ remoteFolderId: 'saved-music', bindingState: 'bound' })]
    })
  })

  it('rejects a saved remote id when its expected title is duplicated remotely', async () => {
    const repository = await createRepository()
    const service = new FavoriteRepositoryBindingService({
      repository,
      newBindingToken: () => 'a1b2c3',
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn((_accountMid, _runId) => ({
          readFolderInventory: vi.fn().mockResolvedValue({
            observedAccountMid: '100',
            folders: [
              { id: 'saved-music', title: 'bilimi\u00b7Music', memberCount: 12 },
              { id: 'duplicate-music', title: 'bilimi\u00b7Music', memberCount: 1 }
            ]
          }),
          createFolder: vi.fn(), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })

    await expect(service.ensurePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: 'bilimi\u00b7Music', remoteDisplayTitle: 'bilimi\u00b7Music',
      preferredRemoteFolderId: 'saved-music', shardNumber: 1, memberAids: []
    })).rejects.toThrow('ambiguous')
  })

  it('journals a binding without rewriting a 30k repository generation', async () => {
    const repository = await createRepository()
    for (let aid = 1; aid <= 3; aid++) {
      await repository.commit('100', {
        id: `video-${aid}`, accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'upsert-video',
        payload: { aid, title: String(aid), tags: [], updatedAt: '2026-07-20T00:00:00.000Z' }
      })
    }
    const before = await readdir(join(roots[0], 'accounts', '100', 'generations'))
    const service = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })

    await service.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: '音乐', shardNumber: 1, memberAids: [1],
      remoteFolderId: 'remote-music-1', observedAccountMid: '100', inventory: [{ id: 'remote-music-1', title: 'B-music-001-a1b2c3', memberCount: 1, memberAids: [1] }]
    })

    expect(await readdir(join(roots[0], 'accounts', '100', 'generations'))).toEqual(before)
    expect((await new FavoriteRepositoryBindingService({
      repository: new FavoriteRepositoryService({ root: roots[0] })
    }).getBindings('100')).shards).toHaveLength(1)
  })

  it('rejects an inventory observed under another Bilibili account before it can bind', async () => {
    const repository = await createRepository()
    const service = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })

    await expect(service.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: '音乐', shardNumber: 1, memberAids: [], observedAccountMid: '200', inventory: []
    })).rejects.toThrow('account mismatch')
    expect(await service.getBindings('100')).toEqual({ logicalLedgers: [], shards: [] })
  })

  it('does not claim an unknown create from a folder that existed before the create request', async () => {
    const repository = await createRepository()
    const service = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })
    const sameName = { id: 'already-there', title: 'B-music-001-a1b2c3', memberCount: 0, memberAids: [] }
    await service.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: '音乐', shardNumber: 1, memberAids: [], observedAccountMid: '100', inventory: [sameName]
    })

    await service.reconcilePendingBindings('100', { observedAccountMid: '100', inventory: [sameName] })
    expect((await service.getBindings('100')).shards[0]).toMatchObject({ bindingState: 'pending-reconcile' })
  })

  it('rejects a direct binding when its supplied remote id has a different managed title', async () => {
    const repository = await createRepository()
    const service = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'a1b2c3' })

    await expect(service.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: '音乐', shardNumber: 1, memberAids: [], observedAccountMid: '100',
      remoteFolderId: 'unrelated', inventory: [{ id: 'unrelated', title: '别人的收藏夹', memberCount: 0, memberAids: [] }]
    })).rejects.toThrow('title')
    expect(await service.getBindings('100')).toEqual({ logicalLedgers: [], shards: [] })
  })

  it('creates a new shard only through a bound main-process page bridge then persists its exact response', async () => {
    const repository = await createRepository()
    const bind = vi.fn().mockResolvedValue(undefined)
    const release = vi.fn()
    const createFolder = vi.fn().mockResolvedValue({
      observedAccountMid: '100', folder: { id: 'remote-music-1', title: 'B-music-001-a1b2c3', memberCount: 0 }
    })
    const service = new FavoriteRepositoryBindingService({
      repository, newBindingToken: () => 'a1b2c3',
      pageBridgeManager: {
        bind, release,
        pageBridge: vi.fn((_accountMid, _runId) => ({
          readFolderInventory: vi.fn().mockResolvedValue({ observedAccountMid: '100', folders: [] }),
          createFolder,
          append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })

    await service.ensurePhysicalShard('100', { logicalLedgerId: 'music', logicalTitle: '音乐', shardNumber: 1, memberAids: [] })

    expect(bind).toHaveBeenCalledWith('100', expect.stringMatching(/^favorite-binding:/))
    expect(createFolder).toHaveBeenCalledWith(expect.objectContaining({ accountMid: '100', title: 'B-music-001-a1b2c3' }))
    expect((await service.getBindings('100')).shards[0]).toMatchObject({ bindingState: 'bound', remoteFolderId: 'remote-music-1' })
    expect(release).toHaveBeenCalledWith('100', expect.stringMatching(/^favorite-binding:/))
  })

  it('requires explicit rebinding when a shard title appears in the final inventory recheck', async () => {
    const repository = await createRepository()
    const readFolderInventory = vi.fn()
      .mockResolvedValueOnce({ observedAccountMid: '100', folders: [] })
      .mockResolvedValueOnce({ observedAccountMid: '100', folders: [{ id: 'remote-music-1', title: 'B-music-001-a1b2c3', memberCount: 0 }] })
    const createFolder = vi.fn()
    const service = new FavoriteRepositoryBindingService({
      repository,
      newBindingToken: () => 'a1b2c3',
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn((_accountMid, _runId) => ({ readFolderInventory, createFolder, append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn() }))
      }
    })

    await expect(service.ensurePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: '音乐', shardNumber: 1, memberAids: []
    })).rejects.toThrow('requires explicit rebinding')
    expect(createFolder).not.toHaveBeenCalled()
  })

  it('creates an adopted recommendation with its visible logical title', async () => {
    const repository = await createRepository()
    const createFolder = vi.fn().mockImplementation(async ({ title }: { title: string }) => ({
      observedAccountMid: '100', folder: { id: 'remote-alpha-1', title, memberCount: 0 }
    }))
    const service = new FavoriteRepositoryBindingService({
      repository, newBindingToken: () => 'a1b2c3',
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn((_accountMid, _runId) => ({
          readFolderInventory: vi.fn().mockResolvedValue({ observedAccountMid: '100', folders: [] }),
          createFolder, append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })

    await service.ensurePhysicalShard('100', {
      logicalLedgerId: 'custom-author-up-alpha', logicalTitle: 'bilimi\u00b7UP Alpha',
      remoteDisplayTitle: 'bilimi\u00b7UP Alpha', shardNumber: 1, memberAids: []
    })

    expect(createFolder).toHaveBeenCalledWith(expect.objectContaining({
      title: 'bilimi\u00b7UP Alpha'
    }))
  })

  it('keeps a failed created-shard binding pending while preserving the remote failure', async () => {
    const repository = await createRepository()
    const service = new FavoriteRepositoryBindingService({
      repository, newBindingToken: () => 'a1b2c3',
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn((_accountMid, _runId) => ({
          readFolderInventory: vi.fn().mockResolvedValue({ observedAccountMid: '100', folders: [] }),
          createFolder: vi.fn().mockRejectedValue(new Error('network interrupted')),
          append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })

    await expect(service.ensurePhysicalShard('100', { logicalLedgerId: 'music', logicalTitle: '音乐', shardNumber: 1, memberAids: [] }))
      .rejects.toThrow('network interrupted')
    await expect(service.getBindings('100')).resolves.toMatchObject({
      shards: [expect.objectContaining({ bindingState: 'pending-reconcile' })]
    })
  })

  it('reuses the exact generated title when production token generation changes per call', async () => {
    const repository = await createRepository()
    const createFolder = vi.fn().mockImplementation(async ({ title }: { title: string }) => ({
      observedAccountMid: '100', folder: { id: 'remote-music-1', title, memberCount: 0 }
    }))
    let tokenIndex = 0
    const service = new FavoriteRepositoryBindingService({
      repository, newBindingToken: () => ['a1b2c3', 'd4e5f6'][tokenIndex++],
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn((_accountMid, _runId) => ({
          readFolderInventory: vi.fn().mockResolvedValue({ observedAccountMid: '100', folders: [] }), createFolder,
          append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })

    await service.ensurePhysicalShard('100', { logicalLedgerId: 'music', logicalTitle: '音乐', shardNumber: 1, memberAids: [] })
    expect((await service.getBindings('100')).shards[0]).toMatchObject({
      remoteTitle: 'B-music-001-a1b2c3', remoteFolderId: 'remote-music-1', bindingState: 'bound'
    })
  })

  it('checks the 99-folder remote limit before attempting a shard create', async () => {
    const repository = await createRepository()
    const createFolder = vi.fn()
    const service = new FavoriteRepositoryBindingService({
      repository, newBindingToken: () => 'a1b2c3',
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn((_accountMid, _runId) => ({
          readFolderInventory: vi.fn().mockResolvedValue({ observedAccountMid: '100', folders: Array.from({ length: 99 }, (_, index) => ({ id: `folder-${index}`, title: `other-${index}`, memberCount: 0 })) }),
          createFolder, append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })

    await expect(service.ensurePhysicalShard('100', { logicalLedgerId: 'music', logicalTitle: '音乐', shardNumber: 1, memberAids: [] })).rejects.toThrow('folder limit')
    expect(createFolder).not.toHaveBeenCalled()
  })

  it('adopts one exact existing remote shard without mutating the remote folder', async () => {
    const repository = await createRepository()
    const commit = vi.spyOn(repository, 'commit')
    const bind = vi.fn().mockResolvedValue(undefined)
    const release = vi.fn()
    const createFolder = vi.fn()
    const append = vi.fn()
    const remove = vi.fn()
    const renameFolder = vi.fn()
    const service = new FavoriteRepositoryBindingService({
      repository,
      pageBridgeManager: {
        bind, release,
        pageBridge: vi.fn((_accountMid, _runId) => ({
          readFolderInventory: vi.fn().mockResolvedValue({
            observedAccountMid: '100',
            folders: [{ id: '4070414411', title: 'bilimi\u00b7\u6682\u5b58', memberCount: 7 }]
          }),
          createFolder, append, remove, readMembers: vi.fn(), deleteFolder: vi.fn(), renameFolder
        }))
      }
    })

    await expect(service.adoptExistingPhysicalShard('100', {
      logicalLedgerId: 'inbox', logicalTitle: 'bilimi\u00b7\u6682\u5b58',
      remoteDisplayTitle: 'bilimi\u00b7\u6682\u5b58', expectedRemoteTitle: 'bilimi\u00b7\u6682\u5b58',
      remoteFolderId: '4070414411', shardNumber: 1, memberAids: [9, 3, 9]
    })).resolves.toEqual({
      logicalLedgers: [{ id: 'inbox', title: 'bilimi\u00b7\u6682\u5b58', syncState: 'bound' }],
      shards: [{
        logicalLedgerId: 'inbox', folderId: 'bilimi:inbox:001', shardNumber: 1,
        remoteFolderId: '4070414411', remoteTitle: 'bilimi\u00b7\u6682\u5b58',
        bindingState: 'bound', remoteMemberCount: 7
      }]
    })
    expect(bind).toHaveBeenCalledWith('100', expect.stringMatching(/^favorite-adoption:/))
    expect(release).toHaveBeenCalledWith('100', expect.stringMatching(/^favorite-adoption:/))
    expect(createFolder).not.toHaveBeenCalled()
    expect(append).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    expect(renameFolder).not.toHaveBeenCalled()
    // Folder inventory proves only its aggregate count. Stale mirror rows
    // cannot become physical-shard facts during an ID-only adoption.
    expect((await repository.getSnapshot('100')).memberships['bilimi:inbox:001']).toEqual([])
    expect(commit).toHaveBeenCalledWith('100', expect.objectContaining({
      type: 'upsert-physical-shard-binding',
      payload: expect.objectContaining({
        remoteFolderId: '4070414411',
        userConfirmedAdoption: true
      })
    }))
  })

  it('rechecks the exact returned folder id when a newly created folder is absent from the first inventory', async () => {
    const repository = await createRepository()
    const waitForInventoryRetry = vi.fn().mockResolvedValue(undefined)
    const readFolderInventory = vi.fn()
      .mockResolvedValueOnce({ observedAccountMid: '100', folders: [] })
      .mockResolvedValueOnce({
        observedAccountMid: '100',
        folders: [{ id: 'new-music', title: 'bilimi·音乐舞台', memberCount: 0 }]
      })
    const service = new FavoriteRepositoryBindingService({
      repository,
      waitForInventoryRetry,
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory, createFolder: vi.fn(), append: vi.fn(), remove: vi.fn(),
          readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })

    await expect(service.adoptExistingPhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: 'bilimi·音乐舞台',
      remoteDisplayTitle: 'bilimi·音乐舞台', expectedRemoteTitle: 'bilimi·音乐舞台',
      remoteFolderId: 'new-music', shardNumber: 1, memberAids: []
    })).resolves.toMatchObject({
      shards: [expect.objectContaining({
        logicalLedgerId: 'music', remoteFolderId: 'new-music', bindingState: 'bound'
      })]
    })

    expect(readFolderInventory).toHaveBeenCalledTimes(2)
    expect(waitForInventoryRetry).toHaveBeenCalledWith(250)
  })

  it('never adopts a name match when the exact returned folder id remains absent', async () => {
    const repository = await createRepository()
    const waitForInventoryRetry = vi.fn().mockResolvedValue(undefined)
    const readFolderInventory = vi.fn().mockResolvedValue({
      observedAccountMid: '100',
      folders: [{ id: 'same-title-but-not-returned', title: 'bilimi·音乐舞台', memberCount: 0 }]
    })
    const service = new FavoriteRepositoryBindingService({
      repository,
      waitForInventoryRetry,
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory, createFolder: vi.fn(), append: vi.fn(), remove: vi.fn(),
          readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })

    await expect(service.adoptExistingPhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: 'bilimi·音乐舞台',
      remoteDisplayTitle: 'bilimi·音乐舞台', expectedRemoteTitle: 'bilimi·音乐舞台',
      remoteFolderId: 'new-music', shardNumber: 1, memberAids: []
    })).rejects.toThrow('absent')

    expect(readFolderInventory).toHaveBeenCalledTimes(3)
    expect(waitForInventoryRetry).toHaveBeenNthCalledWith(1, 250)
    expect(waitForInventoryRetry).toHaveBeenNthCalledWith(2, 750)
    expect(await service.getBindings('100')).toEqual({ logicalLedgers: [], shards: [] })
  })

  it('adopts an explicitly confirmed same-name shard without renaming it', async () => {
    const repository = await createRepository()
    let remoteTitle = 'bilimi·游戏专区'
    const renameFolder = vi.fn(async (input: { accountMid: string; operationKey: string; folderId: string; title: string }) => {
      expect(input).toEqual(expect.objectContaining({
        accountMid: '100', folderId: 'game-2', title: 'bilimi·游戏专区②'
      }))
      remoteTitle = input.title
      return { observedAccountMid: '100' }
    })
    const readFolderInventory = vi.fn(async () => ({
      observedAccountMid: '100',
      folders: [
        { id: 'game-1', title: 'bilimi·游戏专区', memberCount: 1000 },
        { id: 'game-2', title: remoteTitle, memberCount: 307 }
      ]
    }))
    const service = new FavoriteRepositoryBindingService({
      repository,
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory, renameFolder,
          createFolder: vi.fn(), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })

    await expect(service.adoptExistingPhysicalShard('100', {
      logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区',
      remoteDisplayTitle: 'bilimi·游戏专区', expectedRemoteTitle: 'bilimi·游戏专区',
      remoteFolderId: 'game-2', shardNumber: 2, memberAids: []
    })).resolves.toMatchObject({
      shards: [expect.objectContaining({
        logicalLedgerId: 'game', shardNumber: 2, remoteFolderId: 'game-2', remoteTitle: 'bilimi·游戏专区'
      })]
    })

    expect(renameFolder).not.toHaveBeenCalled()
    expect(readFolderInventory).toHaveBeenCalledTimes(1)
  })

  it('rejects an explicitly confirmed differently named candidate without renaming it', async () => {
    const repository = await createRepository()
    let remoteTitle = 'bilimi·音乐舞台你好'
    const renameFolder = vi.fn(async (input: { accountMid: string; folderId: string; title: string }) => {
      expect(input).toEqual(expect.objectContaining({
        accountMid: '100', folderId: 'music-selected', title: 'bilimi·音乐舞台'
      }))
      remoteTitle = input.title
      return { status: 'ok' as const, observedAccountMid: '100' }
    })
    const readFolderInventory = vi.fn(async () => ({
      observedAccountMid: '100',
      folders: [{ id: 'music-selected', title: remoteTitle, memberCount: 12 }]
    }))
    const service = new FavoriteRepositoryBindingService({
      repository,
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory, renameFolder,
          createFolder: vi.fn(), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })

    await expect(service.adoptExistingPhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: 'bilimi·音乐舞台',
      remoteDisplayTitle: remoteTitle, expectedRemoteTitle: remoteTitle,
      remoteFolderId: 'music-selected', shardNumber: 1, memberAids: []
    })).rejects.toThrow('remote shard title is invalid')

    expect(renameFolder).not.toHaveBeenCalled()
    expect(readFolderInventory).toHaveBeenCalledTimes(1)
  })

  it('adopts an explicitly selected same-name folder when its bilimi prefix has spacing around the separator', async () => {
    const repository = await createRepository()
    const remoteTitle = 'bilimi ： 梅林FIT'
    const renameFolder = vi.fn()
    const service = new FavoriteRepositoryBindingService({
      repository,
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory: vi.fn(async () => ({
            observedAccountMid: '100', folders: [{ id: 'meilin-selected', title: remoteTitle, memberCount: 0 }]
          })),
          renameFolder, createFolder: vi.fn(), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })

    await expect(service.adoptExistingPhysicalShard('100', {
      logicalLedgerId: 'meilin', logicalTitle: 'bilimi·梅林FIT',
      remoteDisplayTitle: remoteTitle, expectedRemoteTitle: remoteTitle,
      remoteFolderId: 'meilin-selected', shardNumber: 1, memberAids: []
    })).resolves.toMatchObject({
      shards: [expect.objectContaining({ remoteFolderId: 'meilin-selected', remoteTitle })]
    })

    expect(renameFolder).not.toHaveBeenCalled()
  })

  it('rejects an unbound explicitly selected shard whose title belongs to another logical name', async () => {
    const repository = await createRepository()
    const remoteTitle = '手动改过的收藏夹'
    const renameFolder = vi.fn(async (input: { accountMid: string; operationKey: string; folderId: string; title: string }) => {
      return { observedAccountMid: '100' }
    })
    const readFolderInventory = vi.fn(async () => ({
      observedAccountMid: '100',
      folders: [{ id: 'game-2', title: remoteTitle, memberCount: 307 }]
    }))
    const service = new FavoriteRepositoryBindingService({
      repository,
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory, renameFolder,
          createFolder: vi.fn(), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })

    await expect(service.adoptExistingPhysicalShard('100', {
      logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区',
      remoteDisplayTitle: 'bilimi·游戏专区', expectedRemoteTitle: 'bilimi·旧游戏专区',
      remoteFolderId: 'game-2', shardNumber: 2, memberAids: []
    })).rejects.toThrow('title is invalid')

    expect(renameFolder).not.toHaveBeenCalled()
    expect(readFolderInventory).toHaveBeenCalledOnce()
    expect(await service.getBindings('100')).toEqual({ logicalLedgers: [], shards: [] })
  })

  it('rejects a differently named folder even when a legacy caller requests remote rename', async () => {
    const repository = await createRepository()
    let remoteTitle = 'bilimi·小咪的收藏夹'
    const renameFolder = vi.fn(async (input: { accountMid: string; folderId: string; title: string }) => {
      expect(input).toEqual(expect.objectContaining({
        accountMid: '100', folderId: 'xiaomi-id', title: 'bilimi·梅林FIT'
      }))
      remoteTitle = input.title
      return { status: 'ok' as const, observedAccountMid: '100' }
    })
    const service = new FavoriteRepositoryBindingService({
      repository,
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory: vi.fn(async () => ({
            observedAccountMid: '100', folders: [{ id: 'xiaomi-id', title: remoteTitle, memberCount: 0 }]
          })),
          renameFolder, createFolder: vi.fn(), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })

    await expect(service.adoptExistingPhysicalShard('100', {
      logicalLedgerId: 'meilin', logicalTitle: 'bilimi·梅林FIT',
      expectedRemoteTitle: 'bilimi·小咪的收藏夹', remoteFolderId: 'xiaomi-id',
      shardNumber: 1, memberAids: []
    })).rejects.toThrow('remote shard title is invalid')

    expect(renameFolder).not.toHaveBeenCalled()
    expect(await service.getBindings('100')).toEqual({ logicalLedgers: [], shards: [] })
  })

  it('does not let an already recorded bound id use candidate adoption to rename', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'corrupt-meilin-binding', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z',
      type: 'upsert-physical-shard-binding',
      payload: {
        logicalLedgerId: 'meilin', logicalTitle: 'bilimi·梅林FIT', shardNumber: 1, memberAids: [],
        remoteTitle: 'bilimi·小咪的收藏夹', bindingState: 'bound', remoteFolderId: 'xiaomi-id', remoteMemberCount: 0
      }
    })
    const renameFolder = vi.fn()
    const service = new FavoriteRepositoryBindingService({
      repository,
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory: vi.fn(async () => ({
            observedAccountMid: '100', folders: [{ id: 'xiaomi-id', title: 'bilimi·小咪的收藏夹', memberCount: 0 }]
          })),
          renameFolder, createFolder: vi.fn(), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })

    await expect(service.adoptExistingPhysicalShard('100', {
      logicalLedgerId: 'meilin', logicalTitle: 'bilimi·梅林FIT',
      expectedRemoteTitle: 'bilimi·小咪的收藏夹', remoteFolderId: 'xiaomi-id',
      shardNumber: 1, memberAids: []
    })).rejects.toThrow('remote shard title is invalid')

    expect(renameFolder).not.toHaveBeenCalled()
  })

  it('does not call remote rename when an explicitly selected candidate does not match the local rule', async () => {
    const repository = await createRepository()
    const commit = vi.spyOn(repository, 'commit')
    const renameFolder = vi.fn().mockResolvedValue({
      status: 'rejected', observedAccountMid: '100', reason: 'remote-ambiguous', bilibiliCode: -1
    })
    const readFolderInventory = vi.fn().mockResolvedValue({
      status: 'ok', observedAccountMid: '100',
      folders: [{ id: 'game-2', title: 'bilimi·游戏专区', memberCount: 0 }]
    })
    const service = new FavoriteRepositoryBindingService({
      repository,
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory, renameFolder,
          createFolder: vi.fn(), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })

    await expect(service.adoptExistingPhysicalShard('100', {
      logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区哈哈',
      remoteDisplayTitle: 'bilimi·游戏专区', expectedRemoteTitle: 'bilimi·游戏专区',
      remoteFolderId: 'game-2', shardNumber: 1, memberAids: []
    })).rejects.toThrow('remote shard title is invalid')

    expect(renameFolder).not.toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
  })

  it('does not rename an unbound candidate whose remote title differs from the local rule', async () => {
    const repository = await createRepository()
    const expectedTitle = 'bilimi·生活日常你好'
    let renamed = false
    let inventoryReads = 0
    const waitForInventoryRetry = vi.fn().mockResolvedValue(undefined)
    const renameFolder = vi.fn(async () => {
      renamed = true
      return { observedAccountMid: '100' }
    })
    const readFolderInventory = vi.fn(async () => {
      inventoryReads += 1
      return {
        observedAccountMid: '100',
        folders: [{
          id: 'life-1',
          title: renamed && inventoryReads >= 3 ? expectedTitle : 'bilimi·生活日常',
          memberCount: 0
        }]
      }
    })
    const service = new FavoriteRepositoryBindingService({
      repository,
      waitForInventoryRetry,
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory, renameFolder,
          createFolder: vi.fn(), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })

    await expect(service.adoptExistingPhysicalShard('100', {
      logicalLedgerId: 'life', logicalTitle: expectedTitle,
      remoteDisplayTitle: expectedTitle, expectedRemoteTitle: 'bilimi·生活日常',
      remoteFolderId: 'life-1', shardNumber: 1, memberAids: []
    })).rejects.toThrow('remote shard title is invalid')

    expect(renameFolder).not.toHaveBeenCalled()
    expect(waitForInventoryRetry).not.toHaveBeenCalled()
    expect(readFolderInventory).toHaveBeenCalledTimes(1)
  })

  it('does not rename an unbound candidate while the remote directory remains stale', async () => {
    const repository = await createRepository()
    const expectedTitle = 'bilimi·生活日常你好'
    let renamed = false
    const waitForInventoryRetry = vi.fn().mockResolvedValue(undefined)
    const renameFolder = vi.fn(async () => {
      renamed = true
      return { observedAccountMid: '100' }
    })
    const readFolderInventory = vi.fn(async () => ({
      observedAccountMid: '100',
      folders: [{ id: 'life-1', title: 'bilimi·生活日常', memberCount: 0 }]
    }))
    const readFolder = vi.fn(async () => {
      expect(renamed).toBe(true)
      return { observedAccountMid: '100', folder: { id: 'life-1', title: expectedTitle, memberCount: 0 } }
    })
    const service = new FavoriteRepositoryBindingService({
      repository,
      waitForInventoryRetry,
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory, readFolder, renameFolder,
          createFolder: vi.fn(), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })

    await expect(service.adoptExistingPhysicalShard('100', {
      logicalLedgerId: 'life', logicalTitle: expectedTitle,
      remoteDisplayTitle: expectedTitle, expectedRemoteTitle: 'bilimi·生活日常',
      remoteFolderId: 'life-1', shardNumber: 1, memberAids: []
    })).rejects.toThrow('remote shard title is invalid')

    expect(renameFolder).not.toHaveBeenCalled()
    expect(readFolderInventory).toHaveBeenCalledOnce()
    expect(readFolder).not.toHaveBeenCalled()
    expect(waitForInventoryRetry).not.toHaveBeenCalled()
  })

  it('treats a repeated exact adoption as idempotent when the inventory changes', async () => {
    const repository = await createRepository()
    let memberCount = 7
    const service = new FavoriteRepositoryBindingService({
      repository,
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn((_accountMid, _runId) => ({
          readFolderInventory: vi.fn().mockImplementation(async () => ({
            observedAccountMid: '100', folders: [{ id: '4070414411', title: 'Staging', memberCount }]
          })),
          createFolder: vi.fn(), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })
    const input = {
      logicalLedgerId: 'inbox', logicalTitle: 'Staging', expectedRemoteTitle: 'Staging',
      remoteFolderId: '4070414411', shardNumber: 1, memberAids: []
    }

    await service.adoptExistingPhysicalShard('100', input)
    memberCount = 8
    await expect(service.adoptExistingPhysicalShard('100', input)).resolves.toMatchObject({
      shards: [expect.objectContaining({ remoteFolderId: '4070414411' })]
    })
  })

  it('repairs a stale formal binding title when the exact remote title is already correct without renaming again', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'stale-knowledge-binding', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z',
      type: 'upsert-physical-shard-binding',
      payload: {
        logicalLedgerId: 'knowledge', logicalTitle: 'bilimi·知识学习你好', shardNumber: 1, memberAids: [],
        remoteTitle: 'bilimi·知识学习', bindingState: 'bound', remoteFolderId: 'knowledge-1', remoteMemberCount: 0
      }
    })
    const commit = vi.spyOn(repository, 'commit')
    const renameFolder = vi.fn()
    const readFolderInventory = vi.fn().mockResolvedValue({
      observedAccountMid: '100',
      folders: [{ id: 'knowledge-1', title: 'bilimi·知识学习你好', memberCount: 0 }]
    })
    const service = new FavoriteRepositoryBindingService({
      repository,
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory, renameFolder,
          createFolder: vi.fn(), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })

    await expect(service.adoptExistingPhysicalShard('100', {
      logicalLedgerId: 'knowledge', logicalTitle: 'bilimi·知识学习你好',
      remoteDisplayTitle: 'bilimi·知识学习你好', expectedRemoteTitle: 'bilimi·知识学习你好',
      remoteFolderId: 'knowledge-1', shardNumber: 1, memberAids: []
    })).resolves.toMatchObject({
      shards: [expect.objectContaining({
        logicalLedgerId: 'knowledge', remoteFolderId: 'knowledge-1',
        remoteTitle: 'bilimi·知识学习你好', bindingState: 'bound'
      })]
    })

    expect(renameFolder).not.toHaveBeenCalled()
    expect(commit).toHaveBeenCalledWith('100', expect.objectContaining({
      id: expect.stringMatching(/^favorite-adoption-title-repair:knowledge:1:knowledge-1:/),
      type: 'upsert-physical-shard-binding',
      payload: expect.objectContaining({ remoteTitle: 'bilimi·知识学习你好', remoteFolderId: 'knowledge-1', bindingState: 'bound' })
    }))
  })

  it('renames an exact formally bound shard directly without adopting another remote folder', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'bound-game-shard', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z',
      type: 'upsert-physical-shard-binding',
      payload: {
        logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区哈哈', shardNumber: 1, memberAids: [7],
        remoteTitle: 'bilimi·游戏专区', bindingState: 'bound', remoteFolderId: '4106106611', remoteMemberCount: 1
      }
    })
    let remoteTitle = 'bilimi·游戏专区'
    const renameFolder = vi.fn(async (input: { folderId: string; title: string }) => {
      expect(input).toEqual(expect.objectContaining({ folderId: '4106106611', title: 'bilimi·游戏专区哈哈' }))
      remoteTitle = input.title
      return { status: 'ok' as const, observedAccountMid: '100' }
    })
    const readFolderInventory = vi.fn(async () => ({
      observedAccountMid: '100',
      folders: [
        { id: '4106106611', title: remoteTitle, memberCount: 1 },
        { id: 'same-title-but-not-bound', title: 'bilimi·游戏专区哈哈', memberCount: 0 }
      ]
    }))
    const service = new FavoriteRepositoryBindingService({
      repository,
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory, renameFolder,
          createFolder: vi.fn(), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })
    const adoptExistingPhysicalShard = vi.spyOn(service, 'adoptExistingPhysicalShard')

    await expect(service.renameBoundPhysicalShard('100', {
      logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区哈哈', remoteFolderId: '4106106611', shardNumber: 1
    })).resolves.toMatchObject({
      shards: [expect.objectContaining({
        logicalLedgerId: 'game', shardNumber: 1, remoteFolderId: '4106106611',
        remoteTitle: 'bilimi·游戏专区哈哈', bindingState: 'bound'
      })]
    })

    expect(renameFolder).toHaveBeenCalledOnce()
    expect(adoptExistingPhysicalShard).not.toHaveBeenCalled()
    expect((await repository.getSnapshot('100')).memberships['bilimi:game:001']).toEqual([7])
  })

  it('commits a bound rename even when the Bilibili directory would be stale', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'bound-game-shard', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z',
      type: 'upsert-physical-shard-binding',
      payload: {
        logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区', shardNumber: 1, memberAids: [],
        remoteTitle: 'bilimi·游戏专区', bindingState: 'bound', remoteFolderId: 'game-late', remoteMemberCount: 0
      }
    })
    const waitForInventoryRetry = vi.fn().mockResolvedValue(undefined)
    const renameFolder = vi.fn(async () => {
      return { status: 'ok' as const, observedAccountMid: '100' }
    })
    const readFolderInventory = vi.fn(async () => ({
      observedAccountMid: '100',
      folders: [{
        id: 'game-late',
        title: 'bilimi·游戏专区',
        memberCount: 0
      }]
    }))
    const service = new FavoriteRepositoryBindingService({
      repository,
      waitForInventoryRetry,
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory, renameFolder,
          createFolder: vi.fn(), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })

    await expect(service.renameBoundPhysicalShard('100', {
      logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区你好', remoteFolderId: 'game-late', shardNumber: 1
    })).resolves.toMatchObject({
      shards: [expect.objectContaining({ remoteFolderId: 'game-late', remoteTitle: 'bilimi·游戏专区你好', bindingState: 'bound' })]
    })

    expect(renameFolder).toHaveBeenCalledOnce()
    expect(readFolderInventory).not.toHaveBeenCalled()
    expect(waitForInventoryRetry).not.toHaveBeenCalled()
  })

  it('commits a dialog-confirmed bound rename without a post-rename folder read', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'bound-dialog-confirmed', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z',
      type: 'upsert-physical-shard-binding',
      payload: {
        logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区新', shardNumber: 1, memberAids: [],
        remoteTitle: 'bilimi·游戏专区', bindingState: 'bound', remoteFolderId: 'game-dialog', remoteMemberCount: 0
      }
    })
    const readFolderInventory = vi.fn(async () => ({
      observedAccountMid: '100',
      folders: [{ id: 'game-dialog', title: 'bilimi·游戏专区', memberCount: 0 }]
    }))
    const readFolder = vi.fn(async () => ({
      observedAccountMid: '100',
      folder: { id: 'game-dialog', title: 'bilimi·游戏专区', memberCount: 0 }
    }))
    const renameFolder = vi.fn().mockResolvedValue({ status: 'ok', observedAccountMid: '100' })
    const waitForInventoryRetry = vi.fn().mockResolvedValue(undefined)
    const service = new FavoriteRepositoryBindingService({
      repository,
      waitForInventoryRetry,
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory,
          readFolder, renameFolder,
          createFolder: vi.fn(), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })

    await expect(service.renameBoundPhysicalShard('100', {
      logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区新', remoteFolderId: 'game-dialog', shardNumber: 1,
      currentRemoteTitle: 'bilimi·游戏专区', targetTitle: 'bilimi·游戏专区新'
    })).resolves.toMatchObject({
      shards: [expect.objectContaining({ remoteFolderId: 'game-dialog', remoteTitle: 'bilimi·游戏专区新', bindingState: 'bound' })]
    })

    expect(renameFolder).toHaveBeenCalledOnce()
    expect(readFolderInventory).not.toHaveBeenCalled()
    expect(readFolder).not.toHaveBeenCalled()
    expect(waitForInventoryRetry).not.toHaveBeenCalled()
  })

  it('does not read or retry after a dialog-confirmed bound rename', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'bound-game-loading', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z',
      type: 'upsert-physical-shard-binding',
      payload: {
        logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区', shardNumber: 1, memberAids: [],
        remoteTitle: 'bilimi·游戏专区', bindingState: 'bound', remoteFolderId: 'game-loading', remoteMemberCount: 0
      }
    })
    const waitForInventoryRetry = vi.fn().mockResolvedValue(undefined)
    const renameFolder = vi.fn().mockResolvedValue({ status: 'ok', observedAccountMid: '100' })
    const readFolderInventory = vi.fn()
    const service = new FavoriteRepositoryBindingService({
      repository,
      waitForInventoryRetry,
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory, renameFolder,
          createFolder: vi.fn(), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })
    const adoptExistingPhysicalShard = vi.spyOn(service, 'adoptExistingPhysicalShard')

    await expect(service.renameBoundPhysicalShard('100', {
      logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区你好', remoteFolderId: 'game-loading', shardNumber: 1
    })).resolves.toMatchObject({
      shards: [expect.objectContaining({
        logicalLedgerId: 'game', remoteFolderId: 'game-loading',
        remoteTitle: 'bilimi·游戏专区你好', bindingState: 'bound'
      })]
    })

    expect(waitForInventoryRetry).not.toHaveBeenCalled()
    expect(readFolderInventory).not.toHaveBeenCalled()
    expect(adoptExistingPhysicalShard).not.toHaveBeenCalled()
    expect(await repository.getSnapshot('100')).toMatchObject({
      physicalShards: [expect.objectContaining({
        logicalLedgerId: 'game', remoteFolderId: 'game-loading',
        remoteTitle: 'bilimi·游戏专区你好', bindingState: 'bound'
      })]
    })
  })

  it('does not read an exact folder before committing a dialog-confirmed bound rename', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'bound-game-shard', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z',
      type: 'upsert-physical-shard-binding',
      payload: {
        logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区', shardNumber: 1, memberAids: [],
        remoteTitle: 'bilimi·游戏专区', bindingState: 'bound', remoteFolderId: 'game-diagnostics', remoteMemberCount: 0
      }
    })
    const commit = vi.spyOn(repository, 'commit')
    const readFolder = vi.fn().mockRejectedValue(new Error(
      'remote-ambiguous; http-status=412; content-type=text/html; response-category=html; bilibili-code=-352'
    ))
    const service = new FavoriteRepositoryBindingService({
      repository,
      waitForInventoryRetry: vi.fn().mockResolvedValue(undefined),
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory: vi.fn().mockResolvedValue({
            observedAccountMid: '100', folders: [{ id: 'game-diagnostics', title: 'bilimi·游戏专区', memberCount: 0 }]
          }),
          readFolder,
          renameFolder: vi.fn().mockResolvedValue({ status: 'ok', observedAccountMid: '100' }),
          createFolder: vi.fn(), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })

    await expect(service.renameBoundPhysicalShard('100', {
      logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区你好', remoteFolderId: 'game-diagnostics', shardNumber: 1
    })).resolves.toMatchObject({
      shards: [expect.objectContaining({ remoteFolderId: 'game-diagnostics', remoteTitle: 'bilimi·游戏专区你好', bindingState: 'bound' })]
    })

    expect(readFolder).not.toHaveBeenCalled()
    expect(commit).toHaveBeenCalled()
  })

  it('sends exactly one rename for a dialog-confirmed bound shard even when the remote title may already match', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'stale-game-shard', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z',
      type: 'upsert-physical-shard-binding',
      payload: {
        logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区哈哈', shardNumber: 1, memberAids: [],
        remoteTitle: 'bilimi·游戏专区', bindingState: 'bound', remoteFolderId: '4106106611', remoteMemberCount: 0
      }
    })
    const commit = vi.spyOn(repository, 'commit')
    const renameFolder = vi.fn().mockResolvedValue({ status: 'ok', observedAccountMid: '100' })
    const service = new FavoriteRepositoryBindingService({
      repository,
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory: vi.fn(),
          renameFolder,
          createFolder: vi.fn(), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })

    await expect(service.renameBoundPhysicalShard('100', {
      logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区哈哈', remoteFolderId: '4106106611', shardNumber: 1
    })).resolves.toMatchObject({
      shards: [expect.objectContaining({ remoteFolderId: '4106106611', remoteTitle: 'bilimi·游戏专区哈哈' })]
    })

    expect(renameFolder).toHaveBeenCalledOnce()
    expect(commit).toHaveBeenCalledWith('100', expect.objectContaining({
      id: expect.stringMatching(/^favorite-bound-rename:game:1:4106106611:/),
      type: 'upsert-physical-shard-binding',
      payload: expect.objectContaining({ remoteTitle: 'bilimi·游戏专区哈哈', remoteFolderId: '4106106611', bindingState: 'bound' })
    }))
  })

  it('rejects a bound rename before contacting Bilibili when its exact formal tuple is absent', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'other-game-shard', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z',
      type: 'upsert-physical-shard-binding',
      payload: {
        logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区哈哈', shardNumber: 1, memberAids: [],
        remoteTitle: 'bilimi·游戏专区', bindingState: 'bound', remoteFolderId: 'different-remote-id', remoteMemberCount: 0
      }
    })
    const bind = vi.fn()
    const renameFolder = vi.fn()
    const service = new FavoriteRepositoryBindingService({
      repository,
      pageBridgeManager: {
        bind, release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory: vi.fn(), renameFolder,
          createFolder: vi.fn(), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })

    await expect(service.renameBoundPhysicalShard('100', {
      logicalLedgerId: 'game', logicalTitle: 'bilimi·游戏专区哈哈', remoteFolderId: '4106106611', shardNumber: 1
    })).rejects.toThrow('formal binding is absent')

    expect(bind).not.toHaveBeenCalled()
    expect(renameFolder).not.toHaveBeenCalled()
  })

  it.each([
    ['missing remote id', { id: 'different', title: 'bilimi\u00b7\u6682\u5b58', memberCount: 7 }, 'absent'],
    ['wrong remote id', { id: '4070414411', title: 'bilimi\u00b7\u6682\u5b58', memberCount: 7 }, 'absent'],
    ['title mismatch', { id: '4070414411', title: 'other', memberCount: 7 }, 'title']
  ])('does not persist an adoption when the remote folder is %s', async (_caseName, folder, error) => {
    const repository = await createRepository()
    const remoteFolderId = _caseName === 'wrong remote id' ? 'missing' : '4070414411'
    const service = new FavoriteRepositoryBindingService({
      repository,
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn((_accountMid, _runId) => ({
          readFolderInventory: vi.fn().mockResolvedValue({ observedAccountMid: '100', folders: [folder] }),
          createFolder: vi.fn(), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })

    await expect(service.adoptExistingPhysicalShard('100', {
      logicalLedgerId: 'inbox', logicalTitle: 'Inbox', remoteDisplayTitle: 'Staging', expectedRemoteTitle: 'bilimi\u00b7\u6682\u5b58',
      remoteFolderId, shardNumber: 1, memberAids: []
    })).rejects.toThrow(error)
    expect(await service.getBindings('100')).toEqual({ logicalLedgers: [], shards: [] })
  })

  it('does not persist an adoption observed under another account', async () => {
    const repository = await createRepository()
    const service = new FavoriteRepositoryBindingService({
      repository,
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn((_accountMid, _runId) => ({
          readFolderInventory: vi.fn().mockResolvedValue({
            observedAccountMid: '200', folders: [{ id: '4070414411', title: 'Staging', memberCount: 7 }]
          }),
          createFolder: vi.fn(), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })

    await expect(service.adoptExistingPhysicalShard('100', {
      logicalLedgerId: 'inbox', logicalTitle: 'Inbox', remoteDisplayTitle: 'Staging', expectedRemoteTitle: 'Staging',
      remoteFolderId: '4070414411', shardNumber: 1, memberAids: []
    })).rejects.toThrow('account mismatch')
    expect(await service.getBindings('100')).toEqual({ logicalLedgers: [], shards: [] })
  })

  it('does not replace conflicting bindings while adopting an existing remote shard', async () => {
    const repository = await createRepository()
    const service = new FavoriteRepositoryBindingService({
      repository, newBindingToken: () => 'a1b2c3',
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn((_accountMid, _runId) => ({
          readFolderInventory: vi.fn().mockResolvedValue({
            observedAccountMid: '100', folders: [{ id: '4070414411', title: 'Inbox', memberCount: 7 }]
          }),
          createFolder: vi.fn(), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })
    await service.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber: 1, memberAids: [], remoteFolderId: '4070414411',
      observedAccountMid: '100', inventory: [{ id: '4070414411', title: 'B-music-001-a1b2c3', memberCount: 0, memberAids: [] }]
    })
    const before = await service.getBindings('100')

    await expect(service.adoptExistingPhysicalShard('100', {
      logicalLedgerId: 'inbox', logicalTitle: 'Inbox', remoteDisplayTitle: 'Staging', expectedRemoteTitle: 'Staging',
      remoteFolderId: '4070414411', shardNumber: 1, memberAids: []
    })).rejects.toThrow('already bound')
    expect(await service.getBindings('100')).toEqual(before)
  })

  it('replaces an explicitly confirmed stale shard id while retaining the same logical shard', async () => {
    const repository = await createRepository()
    const service = new FavoriteRepositoryBindingService({
      repository, newBindingToken: () => 'a1b2c3',
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn((_accountMid, _runId) => ({
          readFolderInventory: vi.fn().mockResolvedValue({
            observedAccountMid: '100', folders: [{ id: '4070414411', title: 'Inbox', memberCount: 7 }]
          }),
          createFolder: vi.fn(), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })
    await service.preparePhysicalShard('100', {
      logicalLedgerId: 'inbox', logicalTitle: 'Inbox', shardNumber: 1, memberAids: [], remoteFolderId: 'old-inbox',
      observedAccountMid: '100', inventory: [{ id: 'old-inbox', title: 'B-inbox-001-a1b2c3', memberCount: 0, memberAids: [] }]
    })
    await expect(service.adoptExistingPhysicalShard('100', {
      logicalLedgerId: 'inbox', logicalTitle: 'Inbox', remoteDisplayTitle: 'Inbox', expectedRemoteTitle: 'Inbox',
      remoteFolderId: '4070414411', shardNumber: 1, memberAids: [], replaceExistingRemoteBinding: true
    })).resolves.toMatchObject({
      shards: [expect.objectContaining({
        logicalLedgerId: 'inbox', shardNumber: 1, remoteFolderId: '4070414411', remoteTitle: 'Inbox'
      })]
    })
    expect(await service.getBindings('100')).toMatchObject({
      shards: [expect.objectContaining({
        logicalLedgerId: 'inbox', shardNumber: 1, remoteFolderId: '4070414411', remoteTitle: 'Inbox'
      })]
    })
    expect((await service.getBindings('100')).shards).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ remoteFolderId: 'old-inbox' })
    ]))
  })

  it('replaces a confirmed stale second-shard id without requiring a renderer-only flag', async () => {
    const repository = await createRepository()
    const service = new FavoriteRepositoryBindingService({
      repository, newBindingToken: () => 'a1b2c3',
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn((_accountMid, _runId) => ({
          readFolderInventory: vi.fn().mockResolvedValue({
            observedAccountMid: '100', folders: [{ id: 'new-inbox-2', title: 'Inbox②', memberCount: 7 }]
          }),
          createFolder: vi.fn(), append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), deleteFolder: vi.fn()
        }))
      }
    })
    await service.preparePhysicalShard('100', {
      logicalLedgerId: 'inbox', logicalTitle: 'Inbox', shardNumber: 2, memberAids: [], remoteFolderId: 'old-inbox-2',
      observedAccountMid: '100', inventory: [{ id: 'old-inbox-2', title: 'B-inbox-002-a1b2c3', memberCount: 0, memberAids: [] }]
    })

    await expect(service.adoptExistingPhysicalShard('100', {
      logicalLedgerId: 'inbox', logicalTitle: 'Inbox', remoteDisplayTitle: 'Inbox②', expectedRemoteTitle: 'Inbox②',
      remoteFolderId: 'new-inbox-2', shardNumber: 2, memberAids: []
    })).resolves.toMatchObject({
      shards: [expect.objectContaining({ logicalLedgerId: 'inbox', shardNumber: 2, remoteFolderId: 'new-inbox-2' })]
    })
    expect((await service.getBindings('100')).shards).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ remoteFolderId: 'old-inbox-2' })
    ]))
  })
})
