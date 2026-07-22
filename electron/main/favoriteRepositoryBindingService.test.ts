import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FavoriteRepositoryBindingService, favoriteRepositoryManagedShardTitle } from './favoriteRepositoryBindingService'
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

  it('rebinds an existing displayed ledger after a local reset even when Bilibili has reached its folder limit', async () => {
    const repository = await createRepository()
    const createFolder = vi.fn()
    const service = new FavoriteRepositoryBindingService({
      repository,
      newBindingToken: () => 'a1b2c3',
      pageBridgeManager: {
        bind: vi.fn().mockResolvedValue(undefined), release: vi.fn(),
        pageBridge: vi.fn(() => ({
          readFolderInventory: vi.fn().mockResolvedValue({
            observedAccountMid: '100',
            folders: [
              { id: 'existing-music', title: 'bilimi·音乐舞台', memberCount: 12 },
              ...Array.from({ length: 98 }, (_, index) => ({ id: `other-${index}`, title: `other-${index}`, memberCount: 0 }))
            ]
          }),
          createFolder, append: vi.fn(), remove: vi.fn(), readMembers: vi.fn()
        }))
      }
    })

    await expect(service.ensurePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: 'bilimi·音乐舞台', remoteDisplayTitle: 'bilimi·音乐舞台', shardNumber: 1, memberAids: []
    })).resolves.toMatchObject({
      shards: [expect.objectContaining({ remoteFolderId: 'existing-music', bindingState: 'bound' })]
    })
    expect(createFolder).not.toHaveBeenCalled()
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
        pageBridge: vi.fn(() => ({
          readFolderInventory: vi.fn().mockResolvedValue({ observedAccountMid: '100', folders: [] }),
          createFolder,
          append: vi.fn(), remove: vi.fn(), readMembers: vi.fn()
        }))
      }
    })

    await service.ensurePhysicalShard('100', { logicalLedgerId: 'music', logicalTitle: '音乐', shardNumber: 1, memberAids: [] })

    expect(bind).toHaveBeenCalledWith('100', expect.stringMatching(/^favorite-binding:/))
    expect(createFolder).toHaveBeenCalledWith(expect.objectContaining({ accountMid: '100', title: 'B-music-001-a1b2c3' }))
    expect((await service.getBindings('100')).shards[0]).toMatchObject({ bindingState: 'bound', remoteFolderId: 'remote-music-1' })
    expect(release).toHaveBeenCalledWith('100', expect.stringMatching(/^favorite-binding:/))
  })

  it('claims a shard title that appears in the final inventory recheck instead of creating another folder', async () => {
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
        pageBridge: vi.fn(() => ({ readFolderInventory, createFolder, append: vi.fn(), remove: vi.fn(), readMembers: vi.fn() }))
      }
    })

    await expect(service.ensurePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: '音乐', shardNumber: 1, memberAids: []
    })).resolves.toMatchObject({ shards: [expect.objectContaining({ remoteFolderId: 'remote-music-1' })] })
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
        pageBridge: vi.fn(() => ({
          readFolderInventory: vi.fn().mockResolvedValue({ observedAccountMid: '100', folders: [] }),
          createFolder, append: vi.fn(), remove: vi.fn(), readMembers: vi.fn()
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
        pageBridge: vi.fn(() => ({
          readFolderInventory: vi.fn().mockResolvedValue({ observedAccountMid: '100', folders: [] }),
          createFolder: vi.fn().mockRejectedValue(new Error('network interrupted')),
          append: vi.fn(), remove: vi.fn(), readMembers: vi.fn()
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
        pageBridge: vi.fn(() => ({
          readFolderInventory: vi.fn().mockResolvedValue({ observedAccountMid: '100', folders: [] }), createFolder,
          append: vi.fn(), remove: vi.fn(), readMembers: vi.fn()
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
        pageBridge: vi.fn(() => ({
          readFolderInventory: vi.fn().mockResolvedValue({ observedAccountMid: '100', folders: Array.from({ length: 99 }, (_, index) => ({ id: `folder-${index}`, title: `other-${index}`, memberCount: 0 })) }),
          createFolder, append: vi.fn(), remove: vi.fn(), readMembers: vi.fn()
        }))
      }
    })

    await expect(service.ensurePhysicalShard('100', { logicalLedgerId: 'music', logicalTitle: '音乐', shardNumber: 1, memberAids: [] })).rejects.toThrow('folder limit')
    expect(createFolder).not.toHaveBeenCalled()
  })
})
