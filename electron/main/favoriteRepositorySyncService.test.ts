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
    id: 'workspace-1', accountMid, status: 'frozen', baselineRevision: 1, continuationAids: []
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
    append.mockResolvedValueOnce({ observedAccountMid: '100' })
    expect(await service.resume('100', 'run-1')).toMatchObject({ status: 'succeeded' })
    expect(append).toHaveBeenCalledTimes(2)
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
