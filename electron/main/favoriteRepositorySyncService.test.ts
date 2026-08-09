import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FavoriteRepositoryWorkspace } from '../../src/shared/favoriteRepository'
import { FavoriteRepositoryService } from './favoriteRepositoryService'
import {
  FavoriteRepositoryRemoteRejectedError,
  FavoriteRepositorySyncService,
  type FrozenFavoriteSyncPlan
} from './favoriteRepositorySyncService'

const roots: string[] = []

async function createRepository() {
  const root = await mkdtemp(join(tmpdir(), 'bilimi-favorite-sync-'))
  roots.push(root)
  return new FavoriteRepositoryService({ root, now: () => '2026-07-19T00:00:00.000Z' })
}

function workspace(accountMid = '100'): FavoriteRepositoryWorkspace {
  return {
    id: 'workspace-1', accountMid, status: 'frozen', baselineRevision: 1, continuationAids: [],
    workspaceRef: {
      workspaceId: 'workspace-1', accountMid, status: 'frozen', baselineRevision: 1,
      currentSegmentId: 'segment-1', overlayRevision: 1, journalCursor: 1, checksum: 'a'.repeat(64)
    }
  }
}

function plan(accountMid = '100'): FrozenFavoriteSyncPlan {
  return {
    id: 'run-1', accountMid, workspaceId: 'workspace-1', baselineRevision: 1,
    createdAt: '2026-07-19T00:00:00.000Z',
    operations: [{ operationKey: 'append-1', aid: 1, kind: 'append', folderIds: ['remote-a'] }]
  }
}

function planWithAppendOperations(count: number, accountMid = '100'): FrozenFavoriteSyncPlan {
  return {
    ...plan(accountMid),
    operations: Array.from({ length: count }, (_, index) => ({
      operationKey: `append-${index + 1}`,
      aid: index + 1,
      kind: 'append' as const,
      folderIds: ['remote-a']
    }))
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('FavoriteRepositorySyncService', () => {
  it('rejects an empty managed-folder deletion preview and deletion request', async () => {
    const repository = await createRepository()
    const readFolderInventory = vi.fn()
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridge: {
        append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn(), readFolderInventory
      }
    })

    await expect(service.previewManagedFolderDeletion('100', [])).rejects.toThrow('selection is empty')
    await expect(service.deleteManagedFolders('100', [])).rejects.toThrow('selection is empty')
    expect(readFolderInventory).not.toHaveBeenCalled()
  })

  it('synchronizes a saved local placement through the per-account remote arbiter and projects the confirmed physical fact', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'music-binding', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-physical-shard-binding',
      payload: { logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber: 1, memberAids: [], remoteTitle: 'bilimi Music', bindingState: 'bound', remoteFolderId: 'remote-music' }
    })
    await repository.commit('100', {
      id: 'local-placement', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-favorite-placement',
      payload: { aid: 1, localDesiredFolderIds: ['bilimi-logical:music'], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], positionState: 'local-only-change', updatedAt: '2026-07-19T00:00:00.000Z' }
    })
    const append = vi.fn().mockResolvedValue({ observedAccountMid: '100' })
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridge: { append, remove: vi.fn(), readMembers: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn(), readFolderInventory: vi.fn() },
      now: () => '2026-07-19T00:01:00.000Z', pacingMs: 0
    })

    await expect(service.synchronizePlacements('100', [1])).resolves.toMatchObject({ status: 'succeeded', affectedAids: [1] })
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ aid: 1, folderIds: ['remote-music'] }))
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      positions: { '100:1': expect.objectContaining({ positionState: 'aligned', remoteObservedPhysicalFolderIds: ['remote-music'] }) }
    })
  })

  it('exposes an archive restore writer that resolves bound physical shards and never accepts renderer supplied folder ids', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'music-binding', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-physical-shard-binding',
      payload: { logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber: 1, memberAids: [], remoteTitle: 'Music', bindingState: 'bound', remoteFolderId: 'remote-music' }
    })
    const readMembers = vi.fn().mockResolvedValue({ observedAccountMid: '100', members: { 'remote-music': [1] } })
    const append = vi.fn().mockResolvedValue({ observedAccountMid: '100' })
    const service = new FavoriteRepositorySyncService({
      repository, pageBridge: { append, remove: vi.fn(), readMembers, readFolderInventory: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn() }, now: () => '2026-07-19T00:00:00.000Z', pacingMs: 0
    })

    const writer = service.createArchiveRestoreWriter()
    await expect(writer.readBaseline({ accountMid: '100', restoreId: 'restore-1', aid: 1 })).resolves.toEqual({
      1: expect.objectContaining({
        managedPhysicalFolderIdsByLogicalFolderId: { 'bilimi-logical:music': ['remote-music'] },
        managedObservedPhysicalFolderIds: ['remote-music']
      })
    })
    await writer.write({ accountMid: '100', restoreId: 'restore-1', aid: 1, appendPhysicalFolderIds: ['remote-music'], removePhysicalFolderIds: [] })
    expect(readMembers).toHaveBeenCalledWith(expect.objectContaining({ aid: 1, folderIds: ['remote-music'] }))
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ aid: 1, folderIds: ['remote-music'] }))
  })

  it('rechecks actual shard capacity and creates a bound next shard for archive restore only when all bound shards are full', async () => {
    const repository = await createRepository()
    for (const [id, shardNumber, remoteFolderId] of [['music-1', 1, 'remote-music-1'], ['music-2', 2, 'remote-music-2']] as const) {
      await repository.commit('100', {
        id, accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-physical-shard-binding',
        payload: { logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber, memberAids: [], remoteTitle: `Music ${shardNumber}`, bindingState: 'bound', remoteFolderId }
      })
    }
    const readMembers = vi.fn().mockResolvedValue({ observedAccountMid: '100', members: {
      'remote-music-1': Array.from({ length: 1_000 }, (_, index) => index + 1),
      'remote-music-2': Array.from({ length: 999 }, (_, index) => index + 1)
    } })
    const ensurePhysicalShard = vi.fn()
    const service = new FavoriteRepositorySyncService({
      repository, pageBridge: { append: vi.fn(), remove: vi.fn(), readMembers, createFolder: vi.fn(), deleteFolder: vi.fn(), readFolderInventory: vi.fn() },
      ensurePhysicalShard, now: () => '2026-07-19T00:00:00.000Z', pacingMs: 0
    })
    const writer = service.createArchiveRestoreWriter()

    await expect(writer.readBaseline({ accountMid: '100', restoreId: 'restore-capacity', aid: 2 })).resolves.toEqual({
      2: expect.objectContaining({ managedPhysicalFolderMemberCounts: { 'remote-music-1': 1_000, 'remote-music-2': 999 } })
    })
    await writer.ensurePhysicalCapacity!({ accountMid: '100', restoreId: 'restore-capacity', aid: 2, logicalFolderIds: ['bilimi-logical:music'] })
    expect(ensurePhysicalShard).not.toHaveBeenCalled()

    readMembers.mockResolvedValue({ observedAccountMid: '100', members: {
      'remote-music-1': Array.from({ length: 1_000 }, (_, index) => index + 1),
      'remote-music-2': Array.from({ length: 1_000 }, (_, index) => index + 1)
    } })
    await writer.ensurePhysicalCapacity!({ accountMid: '100', restoreId: 'restore-capacity', aid: 2, logicalFolderIds: ['bilimi-logical:music'] })
    expect(ensurePhysicalShard).toHaveBeenCalledWith('100', expect.objectContaining({ logicalLedgerId: 'music', shardNumber: 3, memberAids: [2] }))
  })

  it('rejects conflicted managed bindings before capacity creation can create another shard', async () => {
    const repository = await createRepository()
    for (const [logicalLedgerId, id] of [['music', 'music-binding'], ['games', 'games-binding']] as const) {
      await repository.commit('100', {
        id, accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-physical-shard-binding',
        payload: { logicalLedgerId, logicalTitle: logicalLedgerId, shardNumber: 1, memberAids: [], remoteTitle: 'Shared', bindingState: 'bound', remoteFolderId: 'remote-shared' }
      })
    }
    const ensurePhysicalShard = vi.fn()
    const writer = new FavoriteRepositorySyncService({
      repository, ensurePhysicalShard,
      pageBridge: { append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn(), readFolderInventory: vi.fn() }
    }).createArchiveRestoreWriter()

    await expect(writer.ensurePhysicalCapacity!({ accountMid: '100', restoreId: 'restore-conflict', aid: 1, logicalFolderIds: ['bilimi-logical:music'] }))
      .rejects.toThrow('multiple logical ledgers')
    expect(ensurePhysicalShard).not.toHaveBeenCalled()
  })

  it('rejects an archive baseline where one remote folder is bound to multiple logical ledgers before reading or writing remote membership', async () => {
    const repository = await createRepository()
    for (const [logicalLedgerId, id] of [['games', 'games-binding'], ['music', 'music-binding']] as const) {
      await repository.commit('100', {
        id, accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-physical-shard-binding',
        payload: { logicalLedgerId, logicalTitle: logicalLedgerId, shardNumber: 1, memberAids: [], remoteTitle: 'Shared', bindingState: 'bound', remoteFolderId: 'remote-shared' }
      })
    }
    const readMembers = vi.fn()
    const append = vi.fn()
    const writer = new FavoriteRepositorySyncService({
      repository, pageBridge: { append, remove: vi.fn(), readMembers, readFolderInventory: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn() }, now: () => '2026-07-19T00:00:00.000Z', pacingMs: 0
    }).createArchiveRestoreWriter()

    await expect(writer.readBaseline({ accountMid: '100', restoreId: 'restore-duplicate', aid: 1 })).rejects.toThrow('multiple logical ledgers')
    await expect(writer.write({ accountMid: '100', restoreId: 'restore-duplicate', aid: 1, appendPhysicalFolderIds: ['remote-shared'], removePhysicalFolderIds: [] })).rejects.toThrow('multiple logical ledgers')
    expect(readMembers).not.toHaveBeenCalled()
    expect(append).not.toHaveBeenCalled()
  })

  it('marks an unbound desired logical target as target-missing without attempting a remote write', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'local-placement', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-favorite-placement',
      payload: { aid: 1, localDesiredFolderIds: ['bilimi-logical:music'], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], positionState: 'local-only-change', updatedAt: '2026-07-19T00:00:00.000Z' }
    })
    const append = vi.fn()
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridge: { append, remove: vi.fn(), readMembers: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn(), readFolderInventory: vi.fn() },
      now: () => '2026-07-19T00:01:00.000Z', pacingMs: 0
    })

    await expect(service.synchronizePlacements('100', [1])).resolves.toMatchObject({ status: 'failed', affectedAids: [1] })
    expect(append).not.toHaveBeenCalled()
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      positions: { '100:1': expect.objectContaining({ positionState: 'target-missing' }) }
    })
  })

  it('selects one deterministic bound shard for each logical placement instead of writing every shard', async () => {
    const repository = await createRepository()
    for (const [id, shardNumber, remoteFolderId] of [
      ['music-1', 1, 'remote-music-1'], ['music-2', 2, 'remote-music-2']
    ] as const) {
      await repository.commit('100', {
        id, accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-physical-shard-binding',
        payload: { logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber, memberAids: [], remoteTitle: `Music ${shardNumber}`, bindingState: 'bound', remoteFolderId }
      })
    }
    await repository.commit('100', {
      id: 'local-placement', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-favorite-placement',
      payload: { aid: 1, localDesiredFolderIds: ['bilimi-logical:music'], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], positionState: 'local-only-change', updatedAt: '2026-07-19T00:00:00.000Z' }
    })
    const append = vi.fn().mockResolvedValue({ observedAccountMid: '100' })
    const service = new FavoriteRepositorySyncService({
      repository, pageBridge: { append, remove: vi.fn(), readMembers: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn(), readFolderInventory: vi.fn() },
      now: () => '2026-07-19T00:01:00.000Z', pacingMs: 0
    })

    await service.synchronizePlacements('100', [1])

    expect(append).toHaveBeenCalledWith(expect.objectContaining({ folderIds: ['remote-music-1'] }))
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      positions: { '100:1': expect.objectContaining({ remoteObservedPhysicalFolderIds: ['remote-music-1'] }) }
    })
  })

  it('rechecks only managed bound folders before deleting and stops at the first failure', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'binding-a', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-physical-shard-binding',
      payload: { logicalLedgerId: 'disabled', logicalTitle: 'Disabled', shardNumber: 1, memberAids: [1], remoteTitle: 'bilimi·Disabled', bindingState: 'bound', remoteFolderId: 'remote-a' }
    })
    await repository.commit('100', {
      id: 'binding-b', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-physical-shard-binding',
      payload: { logicalLedgerId: 'disabled-b', logicalTitle: 'Disabled B', shardNumber: 1, memberAids: [2], remoteTitle: 'bilimi·Disabled B', bindingState: 'bound', remoteFolderId: 'remote-b' }
    })
    const deleteFolder = vi.fn().mockResolvedValueOnce({ observedAccountMid: '100' }).mockRejectedValueOnce(new Error('remote failure'))
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridge: { append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), createFolder: vi.fn(), deleteFolder,
        readFolderInventory: vi.fn().mockResolvedValue({ observedAccountMid: '100', folders: [
          { id: 'remote-a', title: 'bilimi·Disabled', memberCount: 3 }, { id: 'remote-b', title: 'bilimi·Disabled B', memberCount: 2 }
        ] }) }, now: () => '2026-07-19T00:00:00.000Z' })

    await expect(service.deleteManagedFolders('100', ['disabled', 'disabled-b'])).rejects.toThrow('remote failure')
    expect(deleteFolder).toHaveBeenCalledTimes(2)
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      physicalShards: [expect.objectContaining({ remoteFolderId: 'remote-b' })],
      videos: {}
    })
  })

  it('keeps every shard binding when a later remote deletion fails for the same logical ledger', async () => {
    const repository = await createRepository()
    for (const [shardNumber, remoteFolderId] of [[1, 'remote-music-1'], [2, 'remote-music-2']] as const) {
      await repository.commit('100', {
        id: `music-binding-${shardNumber}`, accountMid: '100', issuedAt: '2026-08-09T00:00:00.000Z', type: 'upsert-physical-shard-binding',
        payload: {
          logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber, memberAids: [], remoteTitle: `bilimi·Music·${shardNumber}`,
          bindingState: 'bound', remoteFolderId
        }
      })
    }
    const deleteFolder = vi.fn()
      .mockResolvedValueOnce({ observedAccountMid: '100', status: 'ok' })
      .mockRejectedValueOnce(new Error('remote music shard failure'))
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridge: {
        append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), createFolder: vi.fn(), deleteFolder,
        readFolderInventory: vi.fn().mockResolvedValue({ observedAccountMid: '100', folders: [
          { id: 'remote-music-1', title: 'bilimi·Music·1', memberCount: 0 },
          { id: 'remote-music-2', title: 'bilimi·Music·2', memberCount: 0 }
        ] })
      }
    })

    await expect(service.deleteManagedFolders('100', ['music'])).rejects.toThrow('remote music shard failure')
    expect(deleteFolder).toHaveBeenCalledTimes(2)
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      physicalShards: expect.arrayContaining([
        expect.objectContaining({ logicalLedgerId: 'music', remoteFolderId: 'remote-music-1' }),
        expect.objectContaining({ logicalLedgerId: 'music', remoteFolderId: 'remote-music-2' })
      ])
    })
  })

  it('refuses managed deletion while a logical ledger has both bound and pending shards', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'music-bound', accountMid: '100', issuedAt: '2026-08-09T00:00:00.000Z', type: 'upsert-physical-shard-binding',
      payload: { logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber: 1, memberAids: [], remoteTitle: 'bilimi·Music', bindingState: 'bound', remoteFolderId: 'remote-music' }
    })
    await repository.commit('100', {
      id: 'music-pending', accountMid: '100', issuedAt: '2026-08-09T00:00:00.000Z', type: 'upsert-physical-shard-binding',
      payload: { logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber: 2, memberAids: [], remoteTitle: 'bilimi·Music·02', bindingState: 'pending-reconcile', knownRemoteFolderIds: ['remote-music-2'] }
    })
    const deleteFolder = vi.fn()
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridge: {
        append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), createFolder: vi.fn(), deleteFolder,
        readFolderInventory: vi.fn().mockResolvedValue({ observedAccountMid: '100', folders: [{ id: 'remote-music', title: 'bilimi·Music', memberCount: 0 }] })
      }
    })

    await expect(service.deleteManagedFolders('100', ['music'])).rejects.toThrow('requires every shard to be reconciled')
    expect(deleteFolder).not.toHaveBeenCalled()
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      physicalShards: expect.arrayContaining([
        expect.objectContaining({ remoteFolderId: 'remote-music', bindingState: 'bound' }),
        expect.objectContaining({ bindingState: 'pending-reconcile' })
      ])
    })
  })

  it('reports a same-title bilimi folder as an unbound deletion candidate instead of silently ignoring it', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'pending-music', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-physical-shard-binding',
      payload: { logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber: 1, memberAids: [], remoteTitle: 'bilimi·Music', bindingState: 'pending-reconcile', knownRemoteFolderIds: [] }
    })
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridge: {
        append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn(),
        readFolderInventory: vi.fn().mockResolvedValue({ observedAccountMid: '100', folders: [{ id: 'remote-music', title: 'bilimi·Music', memberCount: 4 }] })
      }
    })

    await expect(service.previewManagedFolderDeletion('100', ['music'])).resolves.toEqual([
      expect.objectContaining({ logicalLedgerId: 'music', remoteFolderId: 'remote-music', state: 'unbound-name-match', requiresUnboundAcknowledgement: true })
    ])
  })

  it('refuses managed deletion when the remote ids differ from its confirmed preview', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'bound-music', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-physical-shard-binding',
      payload: { logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber: 1, memberAids: [], remoteTitle: 'bilimi·Music', bindingState: 'bound', remoteFolderId: 'remote-music' }
    })
    const deleteFolder = vi.fn()
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridge: {
        append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), createFolder: vi.fn(), deleteFolder,
        readFolderInventory: vi.fn().mockResolvedValue({ observedAccountMid: '100', folders: [{ id: 'remote-music', title: 'bilimi·Music', memberCount: 3 }] })
      }
    })

    await expect(service.deleteManagedFolders('100', ['music'], false, undefined, { music: ['other-remote'] }))
      .rejects.toThrow('managed-folder-deletion-preview-stale')
    expect(deleteFolder).not.toHaveBeenCalled()
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      physicalShards: [expect.objectContaining({ remoteFolderId: 'remote-music', bindingState: 'bound' })]
    })
  })

  it('uses a local ledger title hint when the repository has not created its logical folder yet', async () => {
    const repository = await createRepository()
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridge: {
        append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn(),
        readFolderInventory: vi.fn().mockResolvedValue({ observedAccountMid: '100', folders: [{ id: 'remote-music', title: 'bilimi\u00b7Music', memberCount: 7 }] })
      }
    })

    await expect(service.previewManagedFolderDeletion('100', ['music'], { music: 'bilimi\u00b7Music' })).resolves.toEqual([
      expect.objectContaining({ logicalLedgerId: 'music', remoteFolderId: 'remote-music', state: 'unbound-name-match', requiresUnboundAcknowledgement: true })
    ])
  })

  it.each([
    ['unknown', 'remote-ambiguous'],
    ['rejected', 'csrf-missing']
  ] as const)('keeps every local binding when the first remote deletion is %s', async (status, reason) => {
    const repository = await createRepository()
    for (const [suffix, logicalLedgerId] of [['a', 'disabled'], ['b', 'disabled-b']] as const) {
      await repository.commit('100', {
        id: `binding-${suffix}`, accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-physical-shard-binding',
        payload: {
          logicalLedgerId, logicalTitle: logicalLedgerId, shardNumber: 1, memberAids: [],
          remoteTitle: `bilimi·${logicalLedgerId}`, bindingState: 'bound', remoteFolderId: `remote-${suffix}`
        }
      })
    }
    const deleteFolder = vi.fn().mockResolvedValue({ status, observedAccountMid: '100', reason })
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridge: {
        append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), createFolder: vi.fn(), deleteFolder,
        readFolderInventory: vi.fn().mockResolvedValue({ observedAccountMid: '100', folders: [
          { id: 'remote-a', title: 'bilimi·disabled', memberCount: 0 },
          { id: 'remote-b', title: 'bilimi·disabled-b', memberCount: 0 }
        ] })
      },
      now: () => '2026-07-19T00:00:00.000Z'
    })

    await expect(service.deleteManagedFolders('100', ['disabled', 'disabled-b'])).rejects.toThrow(reason)
    expect(deleteFolder).toHaveBeenCalledTimes(1)
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      physicalShards: [
        expect.objectContaining({ remoteFolderId: 'remote-a' }),
        expect.objectContaining({ remoteFolderId: 'remote-b' })
      ]
    })
  })

  it('uses the legacy cooldown after the twenty-fifth successful remote write', async () => {
    const repository = await createRepository()
    const frozenPlan = planWithAppendOperations(27)
    await repository.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace',
      payload: { ...workspace(), frozenSyncPlan: frozenPlan }
    })
    const sleep = vi.fn().mockResolvedValue(undefined)
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridge: { append: vi.fn().mockResolvedValue({ observedAccountMid: '100' }), remove: vi.fn(), readMembers: vi.fn(), readFolderInventory: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn() },
      sleep,
      random: () => 0
    })

    await expect(service.executeFrozenPlan('100', frozenPlan)).resolves.toMatchObject({ status: 'succeeded' })

    expect(sleep).toHaveBeenCalledWith(15_000)
  })

  it('applies the twenty-fifth-write cooldown before the first resumed remote write', async () => {
    const repository = await createRepository()
    const frozenPlan = planWithAppendOperations(26)
    await repository.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace',
      payload: { ...workspace(), frozenSyncPlan: frozenPlan }
    })
    for (const operation of frozenPlan.operations.slice(0, 25)) {
      await repository.recordSyncCheckpoint('100', `completed:${operation.operationKey}`, {
        id: `${frozenPlan.id}:${operation.operationKey}`, commandId: operation.operationKey, status: 'succeeded',
        affectedAids: [operation.aid], updatedAt: '2026-07-19T00:00:00.000Z', runId: frozenPlan.id,
        operationKey: operation.operationKey, attempt: 1
      })
    }
    const events: string[] = []
    const sleep = vi.fn(async (milliseconds: number) => { events.push(`sleep:${milliseconds}`) })
    const append = vi.fn(async () => { events.push('append'); return { observedAccountMid: '100' } })
    const service = new FavoriteRepositorySyncService({
      repository, pageBridge: { append, remove: vi.fn(), readMembers: vi.fn(), readFolderInventory: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn() }, sleep, random: () => 0
    })

    await expect(service.executeFrozenPlan('100', frozenPlan)).resolves.toMatchObject({ status: 'succeeded' })

    expect(events).toEqual(['sleep:15000', 'append'])
  })

  it('abandons a frozen local plan without reverting any remote operation', async () => {
    const repository = await createRepository()
    const frozenPlan = plan()
    await repository.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace',
      payload: { ...workspace(), frozenSyncPlan: frozenPlan }
    })
    const release = vi.fn()
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridgeManager: { bind: vi.fn(), release, pageBridge: vi.fn() },
      now: () => '2026-07-19T00:00:00.000Z'
    })

    await service.abandonFrozenPlan('100')

    await expect(repository.getSnapshot('100')).resolves.toMatchObject({ workspace: undefined })
    expect(release).toHaveBeenCalledWith('100', frozenPlan.id)
  })

  it('finishes the in-flight Bilibili write then abandons the remaining frozen plan', async () => {
    const repository = await createRepository()
    const frozenPlan = planWithAppendOperations(2)
    await repository.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace',
      payload: { ...workspace(), frozenSyncPlan: frozenPlan }
    })
    let releaseSleep!: () => void
    const pausedBetweenWrites = new Promise<void>((resolve) => { releaseSleep = resolve })
    const append = vi.fn().mockResolvedValue({ observedAccountMid: '100' })
    const sleep = vi.fn(() => pausedBetweenWrites)
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridge: { append, remove: vi.fn(), readMembers: vi.fn(), readFolderInventory: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn() },
      sleep, now: () => '2026-07-19T00:00:00.000Z', pacingMs: 1
    })

    await service.claimFrozenPlan('100', frozenPlan)
    const execution = service.executeFrozenPlan('100', frozenPlan)
    await vi.waitFor(() => expect(append).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(sleep).toHaveBeenCalledOnce())
    const stop = service.stopAndAbandonFrozenPlan('100')
    releaseSleep()

    await expect(Promise.all([execution, stop])).resolves.toHaveLength(2)
    expect(append).toHaveBeenCalledOnce()
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({ workspace: undefined })
  })

  it('retries an unknown append once only after automatic reconciliation confirms it is absent', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace', payload: workspace()
    })
    const append = vi.fn()
      .mockRejectedValueOnce(new Error('network connection interrupted'))
      .mockResolvedValueOnce({ observedAccountMid: '100' })
    const pageBridge = {
      append,
      remove: vi.fn(),
      readMembers: vi.fn().mockResolvedValue({ observedAccountMid: '100', members: { 'remote-a': [] } }), readFolderInventory: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn()
    }
    const service = new FavoriteRepositorySyncService({ repository, pageBridge, now: () => '2026-07-19T00:00:00.000Z' })

    expect(await service.executeFrozenPlan('100', plan())).toMatchObject({ status: 'succeeded' })
    expect(append).toHaveBeenCalledTimes(2)
    expect(pageBridge.readMembers).toHaveBeenCalledWith({
      accountMid: '100', operationKey: 'append-1', aid: 1, folderIds: ['remote-a']
    })
    append.mockResolvedValueOnce({ observedAccountMid: '100' })
    expect(await service.resume('100', 'run-1')).toMatchObject({ status: 'succeeded' })
    expect(append).toHaveBeenCalledTimes(2)
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      workspace: { status: 'completed' },
      organizationRecords: [{ accountMid: '100', aid: 1, targetFolderIds: ['remote-a'] }]
    })
  })

  it('continues the frozen plan when an ambiguous append is confirmed remotely without repeating that write', async () => {
    const repository = await createRepository()
    const frozenPlan = planWithAppendOperations(2)
    await repository.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace',
      payload: { ...workspace(), frozenSyncPlan: frozenPlan }
    })
    const append = vi.fn()
      .mockRejectedValueOnce(new Error('invalid-response'))
      .mockResolvedValue({ observedAccountMid: '100' })
    const readMembers = vi.fn().mockResolvedValue({ observedAccountMid: '100', members: { 'remote-a': [1] } })
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridge: { append, remove: vi.fn(), readMembers, readFolderInventory: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn() },
      now: () => '2026-07-19T00:00:00.000Z', pacingMs: 0
    })

    await expect(service.executeFrozenPlan('100', frozenPlan)).resolves.toMatchObject({
      status: 'succeeded', completedOperationCount: 2
    })
    expect(append.mock.calls.map(([input]) => input.aid)).toEqual([1, 2])
    expect(readMembers).toHaveBeenCalledTimes(1)
    expect(readMembers).toHaveBeenCalledWith({
      accountMid: '100', operationKey: 'append-1', aid: 1, folderIds: ['remote-a']
    })
  })

  it('stops with an unknown result when automatic reconciliation cannot read complete membership', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace', payload: workspace()
    })
    const append = vi.fn().mockRejectedValueOnce(new Error('invalid-response'))
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridge: {
        append, remove: vi.fn(),
        readMembers: vi.fn().mockResolvedValue({ observedAccountMid: '100', members: {} }),
        readFolderInventory: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn()
      },
      now: () => '2026-07-19T00:00:00.000Z', pacingMs: 0
    })

    await expect(service.executeFrozenPlan('100', plan())).resolves.toMatchObject({ status: 'result-unknown' })
    expect(append).toHaveBeenCalledTimes(1)
  })

  it('marks a confirmed remote rejection failed without attempting automatic reconciliation', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace', payload: workspace()
    })
    const readMembers = vi.fn()
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridge: {
        append: vi.fn().mockRejectedValueOnce(new FavoriteRepositoryRemoteRejectedError('known rejection')),
        remove: vi.fn(), readMembers, readFolderInventory: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn()
      },
      now: () => '2026-07-19T00:00:00.000Z', pacingMs: 0
    })

    await expect(service.executeFrozenPlan('100', plan())).resolves.toMatchObject({ status: 'failed' })
    expect(readMembers).not.toHaveBeenCalled()
  })

  it('stops after one automatic confirmed-absent retry and can resume without reusing a workspace command id', async () => {
    const repository = await createRepository()
    const repeatedPlan = plan()
    await repository.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace',
      payload: { ...workspace(), frozenSyncPlan: repeatedPlan }
    })
    const append = vi.fn()
      .mockRejectedValueOnce(new Error('first response unknown'))
      .mockRejectedValueOnce(new Error('second response unknown'))
      .mockResolvedValueOnce({ observedAccountMid: '100' })
    const readMembers = vi.fn().mockResolvedValue({ observedAccountMid: '100', members: { 'remote-a': [] } })
    let clock = 0
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridge: { append, remove: vi.fn(), readMembers, readFolderInventory: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn() },
      now: () => `2026-07-19T00:00:${String(clock++).padStart(2, '0')}.000Z`, pacingMs: 0
    })

    await expect(service.executeFrozenPlan('100', repeatedPlan)).resolves.toMatchObject({ status: 'ready-to-resume' })
    await expect(service.resume('100', repeatedPlan.id)).resolves.toMatchObject({ status: 'succeeded' })

    expect(append).toHaveBeenCalledTimes(3)
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      workspace: { status: 'completed' }
    })
  })

  it('binds the target before the first remote checkpoint but never auto-binds resume or reconciliation', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace', payload: workspace()
    })
    const bind = vi.fn().mockResolvedValue(undefined)
    const release = vi.fn()
    const pageBridge = {
      append: vi.fn().mockResolvedValue({ observedAccountMid: '100' }),
      remove: vi.fn(), readMembers: vi.fn(), readFolderInventory: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn()
    }
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridgeManager: { bind, release, pageBridge: vi.fn(() => pageBridge) },
      now: () => '2026-07-19T00:00:00.000Z'
    })

    await expect(service.executeFrozenPlan('100', plan())).resolves.toMatchObject({ status: 'succeeded' })
    expect(bind).toHaveBeenCalledWith('100', 'run-1')
    expect(release).toHaveBeenCalledWith('100', 'run-1')
    await expect(service.resume('100', 'run-1')).resolves.toMatchObject({ status: 'succeeded' })
    expect(bind).toHaveBeenCalledTimes(1)
  })

  it('replaces a stale page target before an explicit reconciliation attempt', async () => {
    const repository = await createRepository()
    const events: string[] = []
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridgeManager: {
        bind: vi.fn(async () => { events.push('bind') }),
        release: vi.fn(() => { events.push('release') }),
        pageBridge: vi.fn()
      },
      now: () => '2026-07-19T00:00:00.000Z'
    })

    await service.bindPageTarget('100', 'run-1')
    await service.rebindPageTarget('100', 'run-1')

    expect(events).toEqual(['bind', 'release', 'bind'])
  })

  it('records completed aids as account-scoped incremental protections only after the full plan succeeds', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace', payload: { ...workspace(), frozenSyncPlan: plan() }
    })
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridge: { append: vi.fn().mockResolvedValue({ observedAccountMid: '100' }), remove: vi.fn(), readMembers: vi.fn(), readFolderInventory: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn() },
      now: () => '2026-07-19T00:00:00.000Z'
    })

    await expect(service.executeFrozenPlan('100', plan())).resolves.toMatchObject({ status: 'succeeded' })
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      organizationRecords: [{ accountMid: '100', aid: 1, targetFolderIds: ['remote-a'] }]
    })
    await expect(repository.getSnapshot('200')).resolves.toMatchObject({ organizationRecords: [] })
  })

  it('projects confirmed writes into logical warehouse memberships and durable change records', async () => {
    const repository = await createRepository()
    const frozenPlan = {
      ...plan(),
      operations: [{ operationKey: 'move-1', aid: 1, kind: 'append' as const, folderIds: ['remote-music', 'remote-games'] }]
    }
    await repository.commit('100', {
      id: 'music-binding', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-physical-shard-binding',
      payload: { logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber: 1, memberAids: [], remoteTitle: 'Music', bindingState: 'bound', remoteFolderId: 'remote-music' }
    })
    await repository.commit('100', {
      id: 'games-binding', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-physical-shard-binding',
      payload: { logicalLedgerId: 'games', logicalTitle: 'Games', shardNumber: 2, memberAids: [], remoteTitle: 'Games 02', bindingState: 'bound', remoteFolderId: 'remote-games' }
    })
    await repository.commit('100', {
      id: 'video', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'One copy', tags: [], updatedAt: '2026-07-19T00:00:00.000Z' }
    })
    await repository.commit('100', {
      id: 'mirror', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'record-library-mirror',
      payload: { aid: 1, status: 'synced', metadataRevision: 1, lastSyncedAt: '2026-07-19T00:00:00.000Z' }
    })
    await repository.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace', payload: { ...workspace(), frozenSyncPlan: frozenPlan }
    })
    const service = new FavoriteRepositorySyncService({
      repository, pageBridge: { append: vi.fn().mockResolvedValue({ observedAccountMid: '100' }), remove: vi.fn(), readMembers: vi.fn(), readFolderInventory: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn() },
      now: () => '2026-07-19T00:00:00.000Z'
    })

    await expect(service.executeFrozenPlan('100', frozenPlan)).resolves.toMatchObject({ status: 'succeeded' })
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      memberships: {
        'bilimi:music:001': [1], 'bilimi:games:002': [1],
        'bilimi-logical:music': [1], 'bilimi-logical:games': [1]
      },
      organizationBatches: [expect.objectContaining({
        runId: 'run-1', aid: 1, beforeFolderIds: [], afterFolderIds: ['remote-games', 'remote-music'],
        addedFolderIds: ['remote-games', 'remote-music'], removedFolderIds: [], status: 'succeeded'
      })]
    })
    // Protection only skips future organization scans; it is not a pending action.
    await expect(repository.getLibraryPage('100', { kind: 'pending' }, { limit: 10 })).resolves.toMatchObject({ items: [] })
  })

  it('projects reconciliation-confirmed remote membership but never fabricates an absent write', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'binding', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-physical-shard-binding',
      payload: { logicalLedgerId: 'music', logicalTitle: 'Music', shardNumber: 1, memberAids: [], remoteTitle: 'Music', bindingState: 'bound', remoteFolderId: 'remote-a' }
    })
    await repository.commit('100', {
      id: 'video', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'A', tags: [], updatedAt: '2026-07-19T00:00:00.000Z' }
    })
    await repository.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace', payload: { ...workspace(), frozenSyncPlan: plan() }
    })
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridge: { append: vi.fn().mockRejectedValueOnce(new Error('timeout')), remove: vi.fn(), readMembers: vi.fn().mockResolvedValue({ observedAccountMid: '100', members: { 'remote-a': [1] } }), readFolderInventory: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn() },
      now: () => '2026-07-19T00:00:00.000Z'
    })

    await service.executeFrozenPlan('100', plan())
    await expect(service.reconcile('100', 'run-1')).resolves.toMatchObject({ status: 'succeeded' })
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({ memberships: { 'bilimi-logical:music': [1] } })
  })

  it('does not protect an aid whose successful append only targets the staging logical ledger', async () => {
    const repository = await createRepository()
    const stagingPlan = { ...plan(), operations: [{ operationKey: 'append-1', aid: 1, kind: 'append' as const, folderIds: ['remote-inbox'] }] }
    await repository.commit('100', {
      id: 'inbox-binding', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'upsert-physical-shard-binding',
      payload: { logicalLedgerId: 'inbox', logicalTitle: 'Inbox', shardNumber: 1, memberAids: [], remoteTitle: 'bilimi inbox', bindingState: 'bound', remoteFolderId: 'remote-inbox' }
    })
    await repository.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace', payload: { ...workspace(), frozenSyncPlan: stagingPlan }
    })
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridge: { append: vi.fn().mockResolvedValue({ observedAccountMid: '100' }), remove: vi.fn(), readMembers: vi.fn(), readFolderInventory: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn() },
      now: () => '2026-07-19T00:00:00.000Z'
    })

    await expect(service.executeFrozenPlan('100', stagingPlan)).resolves.toMatchObject({ status: 'succeeded' })
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({ organizationRecords: [] })
  })

  it('requires reconciliation instead of rebinding a persisted executing run before its first remote request', async () => {
    const repository = await createRepository()
    const frozen = { ...workspace(), status: 'executing' as const, workspaceRef: { ...workspace().workspaceRef, status: 'executing' as const }, frozenSyncPlan: plan() }
    await repository.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace', payload: frozen
    })
    const bind = vi.fn()
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridgeManager: { bind, release: vi.fn(), pageBridge: vi.fn() },
      now: () => '2026-07-19T00:00:00.000Z'
    })

    await expect(service.executeFrozenPlan('100', plan())).resolves.toMatchObject({ status: 'running' })
    expect(bind).not.toHaveBeenCalled()
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({ workspace: { status: 'reconciling' } })
  })

  it('claims a frozen plan durably before the controlled first bind', async () => {
    const repository = await createRepository()
    const frozenPlan = plan()
    await repository.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace',
      payload: { ...workspace(), frozenSyncPlan: frozenPlan }
    })
    const bind = vi.fn().mockResolvedValue(undefined)
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridgeManager: { bind, release: vi.fn(), pageBridge: vi.fn(() => ({ append: vi.fn(), remove: vi.fn(), readMembers: vi.fn(), readFolderInventory: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn() })) },
      now: () => '2026-07-19T00:00:00.000Z'
    })

    await expect(service.claimFrozenPlan('100', frozenPlan)).resolves.toMatchObject({ status: 'running' })
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({ workspace: { status: 'executing' } })
    expect(bind).not.toHaveBeenCalled()
  })

  it('returns an interrupted pre-request execution to frozen after explicit reconciliation', async () => {
    const repository = await createRepository()
    const interrupted = { ...workspace(), status: 'executing' as const, workspaceRef: { ...workspace().workspaceRef, status: 'executing' as const }, frozenSyncPlan: plan() }
    await repository.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace', payload: interrupted
    })
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridgeManager: { bind: vi.fn(), release: vi.fn(), pageBridge: vi.fn() },
      now: () => '2026-07-19T00:00:00.000Z'
    })

    await expect(service.reconcile('100', 'run-1')).resolves.toMatchObject({ status: 'ready-to-resume' })
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({ workspace: { status: 'frozen' } })
  })

  it('finalizes an executing run with every durable checkpoint succeeded without a page bind', async () => {
    const repository = await createRepository()
    const persistedPlan = plan()
    const executing = { ...workspace(), status: 'executing' as const, workspaceRef: { ...workspace().workspaceRef, status: 'executing' as const }, frozenSyncPlan: persistedPlan }
    await repository.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace', payload: executing
    })
    await repository.recordSyncCheckpoint('100', 'already-succeeded', {
      id: 'run-1:append-1', commandId: 'append-1', status: 'succeeded', affectedAids: [1],
      updatedAt: '2026-07-19T00:00:00.000Z', runId: 'run-1', operationKey: 'append-1', attempt: 1
    })
    const bind = vi.fn()
    const append = vi.fn()
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridgeManager: {
        bind,
        release: vi.fn(),
        pageBridge: vi.fn(() => ({ append, remove: vi.fn(), readMembers: vi.fn(), readFolderInventory: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn() }))
      },
      now: () => '2026-07-19T00:00:00.000Z'
    })

    await expect(service.executeFrozenPlan('100', persistedPlan)).resolves.toMatchObject({ status: 'succeeded' })
    expect(bind).not.toHaveBeenCalled()
    expect(append).not.toHaveBeenCalled()
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({ workspace: { status: 'completed' } })
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      organizationRecords: [{ accountMid: '100', aid: 1, targetFolderIds: ['remote-a'] }]
    })
  })

  it('keeps a known remote failure frozen instead of treating it as a reconciliation retry', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace', payload: workspace()
    })
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridge: {
        append: vi.fn().mockRejectedValue(new FavoriteRepositoryRemoteRejectedError('Bilibili rejected the request')),
        remove: vi.fn(),
        readMembers: vi.fn().mockResolvedValue({ observedAccountMid: '100', members: { 'remote-a': [] } }), readFolderInventory: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn()
      },
      now: () => '2026-07-19T00:00:00.000Z'
    })

    expect(await service.executeFrozenPlan('100', plan())).toMatchObject({ status: 'failed' })
    expect(await service.reconcile('100', 'run-1')).toMatchObject({ status: 'failed' })
    expect((await repository.getSnapshot('100')).workspace).toMatchObject({ status: 'frozen' })
  })

  it('rejects a repeated run id whose proposed operations differ from the persisted frozen plan', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace', payload: workspace()
    })
    const append = vi.fn().mockRejectedValueOnce(new Error('network connection interrupted'))
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridge: {
        append,
        remove: vi.fn(),
        readMembers: vi.fn(),
        readFolderInventory: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn()
      },
      now: () => '2026-07-19T00:00:00.000Z'
    })
    await service.executeFrozenPlan('100', plan())
    const altered = plan()
    altered.operations = [{ operationKey: 'append-2', aid: 1, kind: 'append', folderIds: ['remote-b'] }]

    await expect(service.executeFrozenPlan('100', altered)).rejects.toThrow('frozen sync plan')
    expect(append).toHaveBeenCalledTimes(1)
  })

  it('does not make an unknown write retryable when reconciliation omitted a target membership result', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace', payload: workspace()
    })
    const append = vi.fn().mockRejectedValueOnce(new Error('network connection interrupted'))
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridge: {
        append,
        remove: vi.fn(),
        readMembers: vi.fn().mockResolvedValue({ observedAccountMid: '100', members: {} }), readFolderInventory: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn()
      },
      now: () => '2026-07-19T00:00:00.000Z'
    })

    await service.executeFrozenPlan('100', plan())
    expect(await service.reconcile('100', 'run-1')).toMatchObject({ status: 'result-unknown' })
    expect(await service.resume('100', 'run-1')).toMatchObject({ status: 'result-unknown' })
    expect(append).toHaveBeenCalledTimes(1)
  })

  it('records a failed membership read as result-unknown instead of rejecting reconciliation', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace', payload: workspace()
    })
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridge: {
        append: vi.fn().mockRejectedValueOnce(new Error('network connection interrupted')),
        remove: vi.fn(),
        readMembers: vi.fn().mockRejectedValue(new Error('bound target lost')), readFolderInventory: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn()
      },
      now: () => '2026-07-19T00:00:00.000Z'
    })

    await service.executeFrozenPlan('100', plan())
    await expect(service.reconcile('100', 'run-1')).resolves.toMatchObject({ status: 'result-unknown' })
  })

  it('times out a stalled membership read and keeps the remote result unknown', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace', payload: workspace()
    })
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridge: {
        append: vi.fn().mockRejectedValueOnce(new Error('network connection interrupted')),
        remove: vi.fn(),
        readMembers: vi.fn(() => new Promise<never>(() => undefined)), readFolderInventory: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn()
      },
      now: () => '2026-07-19T00:00:00.000Z',
      reconciliationReadTimeoutMs: 5
    })

    await service.executeFrozenPlan('100', plan())

    await expect(service.reconcile('100', 'run-1')).resolves.toMatchObject({ status: 'result-unknown' })
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({ workspace: { status: 'reconciling' } })
  })

  it('times out a stalled remote write and requires reconciliation instead of leaving execution stuck', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace', payload: workspace()
    })
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridge: {
        append: vi.fn(() => new Promise<never>(() => undefined)),
        remove: vi.fn(),
        readMembers: vi.fn(),
        readFolderInventory: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn()
      },
      now: () => '2026-07-19T00:00:00.000Z',
      remoteWriteTimeoutMs: 5
    })

    await expect(service.executeFrozenPlan('100', plan())).resolves.toMatchObject({ status: 'result-unknown' })
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({ workspace: { status: 'reconciling' } })
  })

  it('marks a restored write with an unknown result for reconciliation without resubmitting it', async () => {
    const repository = await createRepository()
    const frozenPlan = plan()
    await repository.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace',
      payload: { ...workspace(), status: 'executing', frozenSyncPlan: frozenPlan, workspaceRef: { ...workspace().workspaceRef, status: 'executing' } }
    })
    await repository.recordSyncCheckpoint('100', 'started:append-1', {
      id: `${frozenPlan.id}:append-1`, commandId: 'append-1', status: 'pending', affectedAids: [1],
      updatedAt: '2026-07-19T00:00:00.000Z', reason: 'remote-request-started', runId: frozenPlan.id,
      operationKey: 'append-1', targetFolderIds: ['remote-a'], attempt: 1
    })
    const append = vi.fn()
    const service = new FavoriteRepositorySyncService({
      repository, pageBridge: { append, remove: vi.fn(), readMembers: vi.fn(), readFolderInventory: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn() }, now: () => '2026-07-19T00:00:00.000Z'
    })

    await expect(service.executeFrozenPlan('100', frozenPlan)).resolves.toMatchObject({ status: 'result-unknown' })
    expect(append).not.toHaveBeenCalled()
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({ workspace: { status: 'reconciling' } })
  })

  it('returns a restored reconciled retry to frozen before rebinding it', async () => {
    const repository = await createRepository()
    const frozenPlan = plan()
    await repository.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace',
      payload: { ...workspace(), status: 'executing', frozenSyncPlan: frozenPlan, workspaceRef: { ...workspace().workspaceRef, status: 'executing' } }
    })
    await repository.recordSyncCheckpoint('100', 'retry:append-1', {
      id: `${frozenPlan.id}:append-1`, commandId: 'append-1', status: 'pending', affectedAids: [1],
      updatedAt: '2026-07-19T00:00:00.000Z', reason: 'reconciled-absent-ready-to-retry', runId: frozenPlan.id,
      operationKey: 'append-1', targetFolderIds: ['remote-a'], attempt: 1
    })
    const append = vi.fn()
    const service = new FavoriteRepositorySyncService({
      repository, pageBridge: { append, remove: vi.fn(), readMembers: vi.fn(), readFolderInventory: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn() }, now: () => '2026-07-19T00:00:00.000Z'
    })

    await expect(service.executeFrozenPlan('100', frozenPlan)).resolves.toMatchObject({ status: 'ready-to-resume' })
    expect(append).not.toHaveBeenCalled()
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({ workspace: { status: 'frozen' } })
  })

  it('records a mismatched reconciliation account as result-unknown instead of rejecting reconciliation', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace', payload: workspace()
    })
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridge: {
        append: vi.fn().mockRejectedValueOnce(new Error('network interrupted')),
        remove: vi.fn(),
        readMembers: vi.fn().mockResolvedValue({ observedAccountMid: '200', members: { 'remote-a': [] } }), readFolderInventory: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn()
      },
      now: () => '2026-07-19T00:00:00.000Z'
    })

    await service.executeFrozenPlan('100', plan())
    await expect(service.reconcile('100', 'run-1')).resolves.toMatchObject({ status: 'result-unknown' })
  })

  it('treats an untyped bridge error as result-unknown until it is reconciled', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace', payload: workspace()
    })
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridge: {
        append: vi.fn().mockRejectedValue(new Error('unexpected bridge response')),
        remove: vi.fn(),
        readMembers: vi.fn(),
        readFolderInventory: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn()
      },
      now: () => '2026-07-19T00:00:00.000Z'
    })

    expect(await service.executeFrozenPlan('100', plan())).toMatchObject({ status: 'result-unknown' })
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({
      workspace: {
        status: 'reconciling',
        workspaceRef: { currentStep: 'result-unknown' }
      }
    })
  })

  it('serializes concurrent requests for the same frozen run before any remote append', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace', payload: workspace()
    })
    let resolveAppend: ((value: { observedAccountMid: string }) => void) | undefined
    const append = vi.fn(() => new Promise<{ observedAccountMid: string }>((resolve) => { resolveAppend = resolve }))
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridge: { append, remove: vi.fn(), readMembers: vi.fn(), readFolderInventory: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn() },
      now: () => '2026-07-19T00:00:00.000Z'
    })

    const first = service.executeFrozenPlan('100', plan())
    await vi.waitFor(() => expect(append).toHaveBeenCalledTimes(1))
    const second = service.executeFrozenPlan('100', plan())
    await Promise.resolve()
    expect(append).toHaveBeenCalledTimes(1)
    resolveAppend?.({ observedAccountMid: '100' })

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ status: 'succeeded' }),
      expect.objectContaining({ status: 'succeeded' })
    ])
    expect(append).toHaveBeenCalledTimes(1)
  })

  it('reports an actively owned pending remote request as running', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace', payload: workspace()
    })
    let resolveAppend: ((value: { observedAccountMid: string }) => void) | undefined
    const append = vi.fn(() => new Promise<{ observedAccountMid: string }>((resolve) => { resolveAppend = resolve }))
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridge: { append, remove: vi.fn(), readMembers: vi.fn(), readFolderInventory: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn() },
      now: () => '2026-07-19T00:00:00.000Z'
    })

    const execution = service.executeFrozenPlan('100', plan())
    await vi.waitFor(() => expect(append).toHaveBeenCalledTimes(1))

    await expect(service.getRun('100', 'run-1')).resolves.toMatchObject({ status: 'running' })
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({ workspace: { status: 'executing' } })

    resolveAppend?.({ observedAccountMid: '100' })
    await expect(execution).resolves.toMatchObject({ status: 'succeeded' })
  })

  it('preserves invalid-response diagnostics and blocks rapid repeated manual retries', async () => {
    const repository = await createRepository()
    const frozenPlan = plan()
    await repository.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace',
      payload: { ...workspace(), frozenSyncPlan: frozenPlan }
    })
    await repository.recordSyncCheckpoint('100', 'retry:append-1', {
      id: `${frozenPlan.id}:append-1`, commandId: 'append-1', status: 'pending', affectedAids: [1],
      updatedAt: '2026-07-19T00:00:00.000Z',
      reason: 'reconciled-absent-ready-to-retry; prior=invalid-response; http-status=200; content-type=text/html; response-category=html',
      runId: frozenPlan.id, operationKey: 'append-1', targetFolderIds: ['remote-a'], attempt: 3,
      retryAvailableAt: '2026-07-19T00:00:30.000Z'
    })
    const append = vi.fn()
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridge: { append, remove: vi.fn(), readMembers: vi.fn(), readFolderInventory: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn() },
      now: () => '2026-07-19T00:00:10.000Z', retryCooldownMs: 30_000
    })

    await expect(service.resume('100', frozenPlan.id)).rejects.toThrow(/retry-cooldown.*invalid-response.*http-status=200.*content-type=text\/html/i)
    expect(append).not.toHaveBeenCalled()
    await expect(service.getRun('100', frozenPlan.id)).resolves.toMatchObject({
      status: 'ready-to-resume',
      lastFailureReason: expect.stringContaining('response-category=html'),
      retryAvailableAt: '2026-07-19T00:00:30.000Z'
    })
  })

  it('stops immediately and applies a long cooldown when Bilibili returns an HTML 412 response', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace', payload: workspace()
    })
    const append = vi.fn().mockRejectedValue(new Error(
      'invalid-response; http-status=412; content-type=text/html; response-category=html'
    ))
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridge: {
        append, remove: vi.fn(),
        readMembers: vi.fn().mockResolvedValue({ observedAccountMid: '100', members: { 'remote-a': [] } }),
        readFolderInventory: vi.fn(), createFolder: vi.fn(), deleteFolder: vi.fn()
      },
      now: () => '2026-07-19T00:00:00.000Z', riskControlCooldownMs: 600_000, pacingMs: 0
    })

    await expect(service.executeFrozenPlan('100', plan())).resolves.toMatchObject({
      status: 'ready-to-resume',
      lastFailureReason: expect.stringContaining('http-status=412'),
      retryAvailableAt: '2026-07-19T00:10:00.000Z'
    })
    expect(append).toHaveBeenCalledTimes(1)
    await expect(repository.getSnapshot('100')).resolves.toMatchObject({ workspace: { status: 'frozen' } })
  })
})
