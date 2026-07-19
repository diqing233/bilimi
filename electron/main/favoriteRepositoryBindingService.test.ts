import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FavoriteRepositoryBindingService } from './favoriteRepositoryBindingService'
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
  it('persists a logical ledger with a bound numbered Bilibili shard across a restart', async () => {
    const repository = await createRepository()
    const service = new FavoriteRepositoryBindingService({ repository, now: () => '2026-07-20T00:00:00.000Z', newBindingToken: () => 'token-1' })

    await service.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: '音乐', shardNumber: 1,
      memberAids: [1, 2], remoteFolderId: 'remote-music-1',
      observedAccountMid: '100',
      inventory: [{ id: 'remote-music-1', title: 'Bilimi · music · 001 · token-1', memberCount: 2, memberAids: [1, 2] }]
    })

    const restarted = new FavoriteRepositoryBindingService({
      repository: new FavoriteRepositoryService({ root: roots[0], now: () => '2026-07-20T00:00:00.000Z' })
    })
    expect(await restarted.getBindings('100')).toEqual({
      logicalLedgers: [{ id: 'music', title: '音乐', syncState: 'bound' }],
      shards: [{ logicalLedgerId: 'music', folderId: 'bilimi:music:001', shardNumber: 1,
        remoteFolderId: 'remote-music-1', remoteTitle: 'Bilimi · music · 001 · token-1', bindingState: 'bound' }]
    })
  })

  it('keeps accounts isolated when they use the same logical ledger id', async () => {
    const repository = await createRepository()
    const service = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'token-1' })
    await service.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: '音乐', shardNumber: 1, memberAids: [],
      remoteFolderId: 'a-folder', observedAccountMid: '100', inventory: [{ id: 'a-folder', title: 'Bilimi · music · 001 · token-1', memberCount: 0, memberAids: [] }]
    })
    await service.preparePhysicalShard('200', {
      logicalLedgerId: 'music', logicalTitle: '音乐', shardNumber: 1, memberAids: [],
      remoteFolderId: 'b-folder', observedAccountMid: '200', inventory: [{ id: 'b-folder', title: 'Bilimi · music · 001 · token-1', memberCount: 0, memberAids: [] }]
    })

    expect((await service.getBindings('100')).shards[0]?.remoteFolderId).toBe('a-folder')
    expect((await service.getBindings('200')).shards[0]?.remoteFolderId).toBe('b-folder')
  })

  it('persists an unknown shard create as pending and reconciles only one exact managed title', async () => {
    const repository = await createRepository()
    const service = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'token-1' })
    await service.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: '音乐', shardNumber: 1, memberAids: [], observedAccountMid: '100', inventory: []
    })
    expect((await service.getBindings('100')).shards[0]).toMatchObject({ bindingState: 'pending-reconcile' })

    await service.reconcilePendingBindings('100', { observedAccountMid: '100', inventory: [
      { id: 'remote-music-1', title: 'Bilimi · music · 001 · token-1', memberCount: 0, memberAids: [] }
    ] })
    expect((await service.getBindings('100')).shards[0]).toMatchObject({
      bindingState: 'bound', remoteFolderId: 'remote-music-1'
    })
  })

  it('does not guess a remote folder when reconciliation finds an ambiguous managed title', async () => {
    const repository = await createRepository()
    const service = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'token-1' })
    await service.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: '音乐', shardNumber: 1, memberAids: [], observedAccountMid: '100', inventory: []
    })

    await service.reconcilePendingBindings('100', { observedAccountMid: '100', inventory: [
      { id: 'remote-a', title: 'Bilimi · music · 001 · token-1', memberCount: 0, memberAids: [] },
      { id: 'remote-b', title: 'Bilimi · music · 001 · token-1', memberCount: 0, memberAids: [] }
    ] })
    expect((await service.getBindings('100')).shards[0]).toMatchObject({
      bindingState: 'pending-reconcile'
    })
  })

  it('rejects a shard that exceeds Bilibili capacity without persisting a binding', async () => {
    const repository = await createRepository()
    const service = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'token-1' })

    await expect(service.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: '音乐', shardNumber: 1,
      memberAids: Array.from({ length: 1001 }, (_, index) => index + 1), observedAccountMid: '100', inventory: []
    })).rejects.toThrow('capacity')
    expect(await service.getBindings('100')).toEqual({ logicalLedgers: [], shards: [] })
  })

  it('does not bind a full remote shard when the frozen work needs new members', async () => {
    const repository = await createRepository()
    const service = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'token-1' })

    await expect(service.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: '音乐', shardNumber: 1, memberAids: [1],
      remoteFolderId: 'remote-music-1',
      observedAccountMid: '100',
      inventory: [{ id: 'remote-music-1', title: 'Bilimi · music · 001 · token-1', memberCount: 1000, memberAids: Array.from({ length: 1000 }, (_, index) => index + 2) }]
    })).rejects.toThrow('capacity')
    expect(await service.getBindings('100')).toEqual({ logicalLedgers: [], shards: [] })
  })

  it('refuses a new pending shard when the remote folder inventory is already at 99', async () => {
    const repository = await createRepository()
    const service = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'token-1' })

    await expect(service.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: '音乐', shardNumber: 1, memberAids: [],
      observedAccountMid: '100', inventory: Array.from({ length: 99 }, (_, index) => ({ id: `remote-${index}`, title: `other-${index}`, memberCount: 0, memberAids: [] }))
    })).rejects.toThrow('folder limit')
    expect(await service.getBindings('100')).toEqual({ logicalLedgers: [], shards: [] })
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
    const service = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'token-1' })

    await service.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: '音乐', shardNumber: 1, memberAids: [1],
      remoteFolderId: 'remote-music-1', observedAccountMid: '100', inventory: [{ id: 'remote-music-1', title: 'Bilimi · music · 001 · token-1', memberCount: 1, memberAids: [1] }]
    })

    expect(await readdir(join(roots[0], 'accounts', '100', 'generations'))).toEqual(before)
    expect((await new FavoriteRepositoryBindingService({
      repository: new FavoriteRepositoryService({ root: roots[0] })
    }).getBindings('100')).shards).toHaveLength(1)
  })

  it('rejects an inventory observed under another Bilibili account before it can bind', async () => {
    const repository = await createRepository()
    const service = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'token-1' })

    await expect(service.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: '音乐', shardNumber: 1, memberAids: [], observedAccountMid: '200', inventory: []
    })).rejects.toThrow('account mismatch')
    expect(await service.getBindings('100')).toEqual({ logicalLedgers: [], shards: [] })
  })

  it('does not claim an unknown create from a folder that existed before the create request', async () => {
    const repository = await createRepository()
    const service = new FavoriteRepositoryBindingService({ repository, newBindingToken: () => 'token-1' })
    const sameName = { id: 'already-there', title: 'Bilimi · music · 001 · token-1', memberCount: 0, memberAids: [] }
    await service.preparePhysicalShard('100', {
      logicalLedgerId: 'music', logicalTitle: '音乐', shardNumber: 1, memberAids: [], observedAccountMid: '100', inventory: [sameName]
    })

    await service.reconcilePendingBindings('100', { observedAccountMid: '100', inventory: [sameName] })
    expect((await service.getBindings('100')).shards[0]).toMatchObject({ bindingState: 'pending-reconcile' })
  })
})
