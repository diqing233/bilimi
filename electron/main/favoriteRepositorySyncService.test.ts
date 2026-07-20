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

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('FavoriteRepositorySyncService', () => {
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
