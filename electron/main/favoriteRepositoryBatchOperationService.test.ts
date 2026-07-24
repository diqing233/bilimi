import { describe, expect, it, vi } from 'vitest'
import type { AccountFavoriteRepositorySnapshot, FavoriteRepositoryCommand } from '../../src/shared/favoriteRepository'
import { createAccountFavoriteRepositorySnapshot } from '../../src/shared/favoriteRepository'
import { FavoriteRepositoryBatchOperationService } from './favoriteRepositoryBatchOperationService'

function snapshot(): AccountFavoriteRepositorySnapshot {
  return {
    ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-24T00:00:00.000Z' }),
    revision: 7,
    folders: [
      { id: 'bilimi-logical:source', title: 'Source', kind: 'bilimi-logical', logicalLedgerId: 'source', syncState: 'bound' },
      { id: 'bilimi-logical:target', title: 'Target', kind: 'bilimi-logical', logicalLedgerId: 'target', syncState: 'bound' }
    ],
    memberships: { 'bilimi-logical:source': [1, 2], 'bilimi-logical:target': [2] },
    positions: {
      '100:1': { accountMid: '100', aid: 1, localDesiredFolderIds: ['bilimi-logical:source'], remoteObservedPhysicalFolderIds: ['bilibili:1'], remoteObservedLogicalFolderIds: ['bilimi-logical:source'], positionState: 'aligned', updatedAt: '2026-07-24T00:00:00.000Z', revision: 7 },
      '100:2': { accountMid: '100', aid: 2, localDesiredFolderIds: ['bilimi-logical:source', 'bilimi-logical:target'], remoteObservedPhysicalFolderIds: ['bilibili:1'], remoteObservedLogicalFolderIds: ['bilimi-logical:source'], positionState: 'local-only-change', updatedAt: '2026-07-24T00:00:00.000Z', revision: 7 }
    }
  }
}

describe('FavoriteRepositoryBatchOperationService', () => {
  it('deletes selected local rows in one revision-checked commit while retaining remote recovery evidence', async () => {
    const current = snapshot()
    const commit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [1, 2], affectedFolderIds: [] }))
    const service = new FavoriteRepositoryBatchOperationService({ repository: { getSnapshot: vi.fn(async () => current), commit }, now: () => '2026-07-24T01:00:00.000Z' })

    await expect(service.deleteLocal('100', [2, 1], 7)).resolves.toMatchObject({ affectedAids: [1, 2], auditStatus: 'recorded' })
    expect(commit).toHaveBeenCalledWith('100', expect.objectContaining({
      type: 'delete-favorites-from-library', expectedRevision: 7,
      payload: { aids: [1, 2], deletedAt: '2026-07-24T01:00:00.000Z', reason: 'user-delete' }
    }))
    expect(commit).toHaveBeenCalledTimes(2)
    expect(commit.mock.calls[1][1]).toMatchObject({
      type: 'record-favorite-events',
      payload: { events: [
        { aid: 1, detail: 'batch-local-delete' },
        { aid: 2, detail: 'batch-local-delete' }
      ] }
    })
  })

  it('copies additively and moves only current Bilimi logical membership, with immutable audits', async () => {
    const current = snapshot()
    const commit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))
    const service = new FavoriteRepositoryBatchOperationService({ repository: { getSnapshot: vi.fn(async () => current), commit }, now: () => '2026-07-24T01:00:00.000Z' })

    await service.copy('100', [1, 2], ['bilimi-logical:target'], 7)
    expect(commit.mock.calls[0][1]).toMatchObject({ type: 'set-favorite-placements', payload: { placements: [
      { aid: 1, localDesiredFolderIds: ['bilimi-logical:source', 'bilimi-logical:target'] },
      { aid: 2, localDesiredFolderIds: ['bilimi-logical:source', 'bilimi-logical:target'] }
    ] } })
    await service.move('100', [1, 2], 'bilimi-logical:source', ['bilimi-logical:target'], 7)
    expect(commit.mock.calls[2][1]).toMatchObject({ type: 'set-favorite-placements', payload: { placements: [
      { aid: 1, localDesiredFolderIds: ['bilimi-logical:target'] }, { aid: 2, localDesiredFolderIds: ['bilimi-logical:target'] }
    ] } })
    expect(commit.mock.calls.filter((call) => call[1].type === 'record-favorite-events')).toHaveLength(2)
  })

  it('previews all Bilibili-membership unfavorites, stops on unknown results, and requires explicit reconciliation', async () => {
    const current = snapshot()
    const unfavorite = vi.fn(async () => ({ status: 'result-unknown' as const, completedOperationCount: 0, totalOperationCount: 2, affectedAids: [1, 2], reason: 'timeout' }))
    const commit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))
    const service = new FavoriteRepositoryBatchOperationService({ repository: { getSnapshot: vi.fn(async () => current), commit }, remoteUnfavorite: { unfavorite }, now: () => '2026-07-24T01:00:00.000Z' })
    const preview = await service.previewRemoteUnfavorite('100', [2, 1], 7)
    expect(preview).toMatchObject({ aids: [1, 2], removesAllBilibiliMembership: true, baselineRevision: 7 })
    const confirmation = service.confirmRemoteUnfavorite(preview.executionToken)
    await expect(service.executeRemoteUnfavorite('100', preview.executionToken, confirmation)).resolves.toMatchObject({ status: 'result-unknown' })
    expect(unfavorite).toHaveBeenCalledTimes(1)
    await expect(service.executeRemoteUnfavorite('100', preview.executionToken, confirmation)).rejects.toThrow('confirmation')
    await expect(service.reconcileRemoteUnfavorite('100', preview.operationId)).resolves.toMatchObject({ status: 'reconciliation-required' })
    expect(commit.mock.calls.some((call) => call[1].type === 'record-sync-result' && call[1].payload.status === 'result-unknown')).toBe(true)
  })

  it('keeps a known remote unfavorite rejection failed and actionable', async () => {
    const current = snapshot()
    const commit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))
    const service = new FavoriteRepositoryBatchOperationService({
      repository: { getSnapshot: vi.fn(async () => current), commit },
      remoteUnfavorite: { unfavorite: vi.fn(async () => ({ status: 'failed' as const, completedOperationCount: 0, totalOperationCount: 1, affectedAids: [1], reason: 'rejected' })) }
    })
    const preview = await service.previewRemoteUnfavorite('100', [1], 7)
    const confirmation = service.confirmRemoteUnfavorite(preview.executionToken)

    await expect(service.executeRemoteUnfavorite('100', preview.executionToken, confirmation)).resolves.toMatchObject({ status: 'failed' })
    await expect(service.reconcileRemoteUnfavorite('100', preview.operationId)).resolves.toMatchObject({ status: 'failed' })
    expect(commit.mock.calls.some((call) => call[1].type === 'record-sync-result' && call[1].payload.status === 'failed')).toBe(true)
  })

  it('rejects a remote-unfavorite execution whose repository baseline changed after preview', async () => {
    const current = snapshot()
    const later = { ...current, revision: 8 }
    const getSnapshot = vi.fn().mockResolvedValueOnce(current).mockResolvedValueOnce(later)
    const unfavorite = vi.fn()
    const service = new FavoriteRepositoryBatchOperationService({
      repository: { getSnapshot, commit: vi.fn() }, remoteUnfavorite: { unfavorite }
    })

    const preview = await service.previewRemoteUnfavorite('100', [1], 7)
    const confirmation = service.confirmRemoteUnfavorite(preview.executionToken)
    await expect(service.executeRemoteUnfavorite('100', preview.executionToken, confirmation)).rejects.toThrow('stale')
    expect(unfavorite).not.toHaveBeenCalled()
  })

  it('returns the committed batch result when its subsequent audit write fails', async () => {
    const current = snapshot()
    const committed = { ...current, commandId: 'placement', affectedAids: [1], affectedFolderIds: ['bilimi-logical:target'] }
    const commit = vi.fn()
      .mockResolvedValueOnce(committed)
      .mockRejectedValueOnce(new Error('audit unavailable'))
    const service = new FavoriteRepositoryBatchOperationService({ repository: { getSnapshot: vi.fn(async () => current), commit } })

    await expect(service.copy('100', [1], ['bilimi-logical:target'], 7)).resolves.toMatchObject({
      commandId: 'placement', auditStatus: 'failed'
    })
  })

  it('keeps a result-unknown remote outcome while surfacing failed audit persistence', async () => {
    const current = snapshot()
    const commit = vi.fn()
      .mockResolvedValueOnce({ ...current, commandId: 'remote-result', affectedAids: [1], affectedFolderIds: [] })
      .mockRejectedValueOnce(new Error('audit unavailable'))
    const service = new FavoriteRepositoryBatchOperationService({
      repository: { getSnapshot: vi.fn(async () => current), commit },
      remoteUnfavorite: { unfavorite: vi.fn(async () => ({ status: 'result-unknown' as const, completedOperationCount: 0, totalOperationCount: 1, affectedAids: [1] })) }
    })

    const preview = await service.previewRemoteUnfavorite('100', [1], 7)
    const confirmation = service.confirmRemoteUnfavorite(preview.executionToken)
    await expect(service.executeRemoteUnfavorite('100', preview.executionToken, confirmation)).resolves.toMatchObject({
      status: 'result-unknown', auditStatus: 'failed'
    })
  })
})
