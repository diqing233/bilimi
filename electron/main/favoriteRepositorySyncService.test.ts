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
      pageBridge: { append: vi.fn().mockResolvedValue({ observedAccountMid: '100' }), remove: vi.fn(), readMembers: vi.fn() },
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
      repository, pageBridge: { append, remove: vi.fn(), readMembers: vi.fn() }, sleep, random: () => 0
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

  it('never retries an unknown append before reconciliation confirms it is absent', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace', payload: workspace()
    })
    const append = vi.fn().mockRejectedValueOnce(new Error('network connection interrupted'))
    const pageBridge = {
      append,
      remove: vi.fn(),
      readMembers: vi.fn().mockResolvedValue({ observedAccountMid: '100', members: { 'remote-a': [] } })
    }
    const service = new FavoriteRepositorySyncService({ repository, pageBridge, now: () => '2026-07-19T00:00:00.000Z' })

    expect(await service.executeFrozenPlan('100', plan())).toMatchObject({ status: 'result-unknown' })
    expect(append).toHaveBeenCalledTimes(1)

    await expect(service.resume('100', 'run-1')).resolves.toMatchObject({ status: 'result-unknown' })
    expect(append).toHaveBeenCalledTimes(1)

    expect(await service.reconcile('100', 'run-1')).toMatchObject({ status: 'ready-to-resume' })
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

  it('binds the target before the first remote checkpoint but never auto-binds resume or reconciliation', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace', payload: workspace()
    })
    const bind = vi.fn().mockResolvedValue(undefined)
    const release = vi.fn()
    const pageBridge = {
      append: vi.fn().mockResolvedValue({ observedAccountMid: '100' }),
      remove: vi.fn(), readMembers: vi.fn()
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

  it('records completed aids as account-scoped incremental protections only after the full plan succeeds', async () => {
    const repository = await createRepository()
    await repository.commit('100', {
      id: 'workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace', payload: { ...workspace(), frozenSyncPlan: plan() }
    })
    const service = new FavoriteRepositorySyncService({
      repository,
      pageBridge: { append: vi.fn().mockResolvedValue({ observedAccountMid: '100' }), remove: vi.fn(), readMembers: vi.fn() },
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
      repository, pageBridge: { append: vi.fn().mockResolvedValue({ observedAccountMid: '100' }), remove: vi.fn(), readMembers: vi.fn() },
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
    expect((await repository.getLibraryPage('100', { kind: 'pending' }, { limit: 10 })).items).toEqual([
      expect.objectContaining({ video: expect.objectContaining({ aid: 1 }), pendingStates: ['protected'] })
    ])
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
      pageBridge: { append: vi.fn().mockRejectedValueOnce(new Error('timeout')), remove: vi.fn(), readMembers: vi.fn().mockResolvedValue({ observedAccountMid: '100', members: { 'remote-a': [1] } }) },
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
      pageBridge: { append: vi.fn().mockResolvedValue({ observedAccountMid: '100' }), remove: vi.fn(), readMembers: vi.fn() },
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
      pageBridgeManager: { bind, release: vi.fn(), pageBridge: vi.fn(() => ({ append: vi.fn(), remove: vi.fn(), readMembers: vi.fn() })) },
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
        pageBridge: vi.fn(() => ({ append, remove: vi.fn(), readMembers: vi.fn(), readFolderInventory: vi.fn(), createFolder: vi.fn() }))
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
        readMembers: vi.fn().mockResolvedValue({ observedAccountMid: '100', members: { 'remote-a': [] } })
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
        readMembers: vi.fn()
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
        readMembers: vi.fn().mockResolvedValue({ observedAccountMid: '100', members: {} })
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
        readMembers: vi.fn().mockRejectedValue(new Error('bound target lost'))
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
        readMembers: vi.fn(() => new Promise(() => undefined))
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
        append: vi.fn(() => new Promise(() => undefined)),
        remove: vi.fn(),
        readMembers: vi.fn()
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
      repository, pageBridge: { append, remove: vi.fn(), readMembers: vi.fn() }, now: () => '2026-07-19T00:00:00.000Z'
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
      repository, pageBridge: { append, remove: vi.fn(), readMembers: vi.fn() }, now: () => '2026-07-19T00:00:00.000Z'
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
        readMembers: vi.fn().mockResolvedValue({ observedAccountMid: '200', members: { 'remote-a': [] } })
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
        readMembers: vi.fn()
      },
      now: () => '2026-07-19T00:00:00.000Z'
    })

    expect(await service.executeFrozenPlan('100', plan())).toMatchObject({ status: 'result-unknown' })
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
      pageBridge: { append, remove: vi.fn(), readMembers: vi.fn() },
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
})
