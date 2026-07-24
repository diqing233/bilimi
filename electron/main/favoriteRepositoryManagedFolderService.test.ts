import { describe, expect, it, vi } from 'vitest'
import type { AccountFavoriteRepositorySnapshot, FavoriteRepositoryCommand } from '../../src/shared/favoriteRepository'
import { createAccountFavoriteRepositorySnapshot } from '../../src/shared/favoriteRepository'
import { FavoriteRepositoryManagedFolderService } from './favoriteRepositoryManagedFolderService'
import { FavoriteRepositoryRemoteOperationArbiter } from './favoriteRepositoryRemoteOperationArbiter'

function managedSnapshot(): AccountFavoriteRepositorySnapshot {
  return {
    ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-24T00:00:00.000Z' }), revision: 4,
    folders: [
      { id: 'bilimi-logical:work', title: 'Work', kind: 'bilimi-logical', logicalLedgerId: 'work', syncState: 'bound' },
      { id: 'bilibili:work', title: 'Work', kind: 'bilibili', remoteFolderId: '99', syncState: 'bound' },
      { id: 'local:inbox', title: 'Unmatched', kind: 'local', syncState: 'local-only' }
    ],
    memberships: { 'bilimi-logical:work': [1, 2], 'bilimi:work:001': [1, 2], 'bilibili:work': [1, 3], 'local:inbox': [7] },
    physicalShards: [{ logicalLedgerId: 'work', folderId: 'bilimi:work:001', shardNumber: 1, remoteFolderId: '99', remoteTitle: 'Work', bindingState: 'bound', remoteMemberCount: 3 }]
  }
}

describe('FavoriteRepositoryManagedFolderService', () => {
  it('includes diagnostics in preview and never permits unmatched deletion', async () => {
    let current = managedSnapshot()
    const service = new FavoriteRepositoryManagedFolderService({ repository: { getSnapshot: vi.fn(async () => current), commit: vi.fn() } })
    await expect(service.preview('100', 'bilimi-logical:work')).resolves.toMatchObject({ localMemberCount: 2, unmatchedFallbackCount: 2, remoteBinding: { remoteFolderId: '99' }, remoteOnlyMemberCount: 1, currentRevision: 4 })
    await expect(service.preview('100', 'local:inbox')).rejects.toThrow('unmatched')
  })

  it('requires preview, confirmation, and unchanged baseline for remote deletion; unknown results need reconciliation without retry', async () => {
    const current = managedSnapshot()
    const getSnapshot = vi.fn(async () => current)
    const commit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))
    const removeRemoteFolder = vi.fn(async () => { throw new Error('connection dropped') })
    const service = new FavoriteRepositoryManagedFolderService({ repository: { getSnapshot, commit, commitWithAudit: vi.fn() }, remote: { removeRemoteFolder }, now: () => '2026-07-24T01:00:00.000Z' })
    const preview = await service.preview('100', 'bilimi-logical:work')
    const confirmation = service.confirm(preview.executionToken)
    await expect(service.executeRemote('100', preview.executionToken, confirmation)).resolves.toMatchObject({ status: 'result-unknown' })
    expect(removeRemoteFolder).toHaveBeenCalledTimes(1)
    await expect(service.executeRemote('100', preview.executionToken, confirmation)).rejects.toThrow('confirmation')
    await expect(service.reconcile('100', preview.operationId)).resolves.toMatchObject({ status: 'reconciliation-required' })
  })

  it('persists an unknown remote deletion and observes it after restart without another deletion', async () => {
    const current = managedSnapshot()
    const commit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))
    const removeRemoteFolder = vi.fn(async () => { throw new Error('connection dropped') })
    const first = new FavoriteRepositoryManagedFolderService({
      repository: { getSnapshot: vi.fn(async () => current), commit, commitWithAudit: vi.fn() }, remote: { removeRemoteFolder },
      remoteObserver: { remoteFolderExists: vi.fn(async () => 'absent' as const) }
    } as never)
    const preview = await first.preview('100', 'bilimi-logical:work')
    await first.executeRemote('100', preview.executionToken, first.confirm(preview.executionToken))
    const recorded = commit.mock.calls.find((call) => call[1].type === 'record-sync-result')![1].payload
    expect(recorded.targetFolderIds).toEqual(['bilimi-logical:work'])
    const restarted = new FavoriteRepositoryManagedFolderService({
      repository: { getSnapshot: vi.fn(async () => ({ ...current, syncRecords: [recorded] })), commit, commitWithAudit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] })) },
      remote: { removeRemoteFolder }, remoteObserver: { remoteFolderExists: vi.fn(async () => 'absent' as const) }
    } as never)

    await expect(restarted.reconcile('100', preview.operationId)).resolves.toMatchObject({ status: 'completed' })
    expect(removeRemoteFolder).toHaveBeenCalledTimes(1)
  })

  it('blocks a newly confirmed remote delete after restart until an unknown managed deletion is reconciled', async () => {
    const current = {
      ...managedSnapshot(),
      syncRecords: [{
        id: 'managed-folder-delete:prior-unknown', commandId: 'prior-unknown', operationKey: 'managed-folder-delete',
        status: 'result-unknown' as const, affectedAids: [], targetFolderIds: ['bilimi-logical:work'], updatedAt: '2026-07-24T00:00:00.000Z'
      }]
    }
    const removeRemoteFolder = vi.fn(async () => undefined)
    const restarted = new FavoriteRepositoryManagedFolderService({
      repository: {
        getSnapshot: vi.fn(async () => current), commit: vi.fn(),
        commitWithAudit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))
      }, remote: { removeRemoteFolder }
    })
    const preview = await restarted.preview('100', 'bilimi-logical:work')

    await expect(restarted.executeRemote('100', preview.executionToken, restarted.confirm(preview.executionToken)))
      .resolves.toMatchObject({ status: 'result-unknown' })
    expect(removeRemoteFolder).not.toHaveBeenCalled()
  })

  it('keeps a portable logical-only unknown deletion available for reconciliation after import', async () => {
    const current = managedSnapshot()
    const remoteFolderExists = vi.fn(async () => 'absent' as const)
    const service = new FavoriteRepositoryManagedFolderService({
      repository: {
        getSnapshot: vi.fn(async () => ({
          ...current,
          // Portable state deliberately contains no device-bound remote folder IDs.
          physicalShards: [{ ...current.physicalShards[0], remoteFolderId: undefined }],
          syncRecords: [{
            id: 'managed-folder-delete:portable-operation', commandId: 'portable-operation', operationKey: 'managed-folder-delete',
            status: 'result-unknown', affectedAids: [], targetFolderIds: ['bilimi-logical:work'], updatedAt: '2026-07-24T00:00:00.000Z'
          }]
        })),
        commit: vi.fn(), commitWithAudit: vi.fn()
      },
      remoteObserver: { remoteFolderExists }
    } as never)

    await expect(service.reconcile('100', 'portable-operation')).resolves.toEqual({ status: 'reconciliation-required', operationId: 'portable-operation' })
    expect(remoteFolderExists).not.toHaveBeenCalled()
  })

  it('observes an imported reconciliation-required deletion instead of reporting it complete', async () => {
    const current = managedSnapshot()
    const remoteFolderExists = vi.fn(async () => 'present' as const)
    const service = new FavoriteRepositoryManagedFolderService({
      repository: {
        getSnapshot: vi.fn(async () => ({
          ...current,
          syncRecords: [{
            id: 'managed-folder-delete:imported-operation', commandId: 'imported-operation', operationKey: 'managed-folder-delete',
            status: 'reconciliation-required', affectedAids: [], targetFolderIds: ['bilimi-logical:work'], updatedAt: '2026-07-24T00:00:00.000Z'
          }]
        })),
        commit: vi.fn(), commitWithAudit: vi.fn()
      },
      remoteObserver: { remoteFolderExists }
    } as never)

    await expect(service.reconcile('100', 'imported-operation')).resolves.toEqual({ status: 'failed', operationId: 'imported-operation' })
    expect(remoteFolderExists).toHaveBeenCalledWith('100', '99')
  })

  it('keeps reconciliation required when a known observation cannot persist its checkpoint', async () => {
    const current = managedSnapshot()
    const service = new FavoriteRepositoryManagedFolderService({
      repository: {
        getSnapshot: vi.fn(async () => ({
          ...current,
          syncRecords: [{
            id: 'managed-folder-delete:unpersisted-observation', commandId: 'unpersisted-observation', operationKey: 'managed-folder-delete',
            status: 'result-unknown', affectedAids: [], targetFolderIds: ['bilimi-logical:work'], updatedAt: '2026-07-24T00:00:00.000Z'
          }]
        })),
        commit: vi.fn(async () => { throw new Error('disk full') }), commitWithAudit: vi.fn()
      },
      remoteObserver: { remoteFolderExists: vi.fn(async () => 'present' as const) }
    } as never)

    await expect(service.reconcile('100', 'unpersisted-observation')).resolves.toEqual({ status: 'reconciliation-required', operationId: 'unpersisted-observation' })
  })

  it('does not report an imported reconciliation-required deletion complete without a usable remote binding', async () => {
    const current = managedSnapshot()
    const service = new FavoriteRepositoryManagedFolderService({
      repository: {
        getSnapshot: vi.fn(async () => ({
          ...current,
          physicalShards: [{ ...current.physicalShards[0], remoteFolderId: undefined }],
          syncRecords: [{
            id: 'managed-folder-delete:portable-required', commandId: 'portable-required', operationKey: 'managed-folder-delete',
            status: 'reconciliation-required', affectedAids: [], targetFolderIds: ['bilimi-logical:work'], updatedAt: '2026-07-24T00:00:00.000Z'
          }]
        })),
        commit: vi.fn(), commitWithAudit: vi.fn()
      }
    } as never)

    await expect(service.reconcile('100', 'portable-required')).resolves.toEqual({ status: 'reconciliation-required', operationId: 'portable-required' })
  })

  it('rejects a remote folder shared by another logical ledger during preview', async () => {
    const current = managedSnapshot()
    current.physicalShards.push({ logicalLedgerId: 'other', folderId: 'bilimi:other:001', shardNumber: 1, remoteFolderId: '99', remoteTitle: 'Other', bindingState: 'bound' })
    const service = new FavoriteRepositoryManagedFolderService({ repository: { getSnapshot: vi.fn(async () => current), commit: vi.fn(), commitWithAudit: vi.fn() } })

    await expect(service.preview('100', 'bilimi-logical:work')).rejects.toThrow('another logical ledger')
  })

  it('rechecks remote-folder ownership immediately before execution', async () => {
    const current = managedSnapshot()
    const shared = { ...current, physicalShards: [...current.physicalShards, {
      logicalLedgerId: 'other', folderId: 'bilimi:other:001', shardNumber: 1, remoteFolderId: '99', remoteTitle: 'Other', bindingState: 'bound' as const
    }] }
    const getSnapshot = vi.fn().mockResolvedValueOnce(current).mockResolvedValueOnce(shared)
    const removeRemoteFolder = vi.fn()
    const service = new FavoriteRepositoryManagedFolderService({
      repository: { getSnapshot, commit: vi.fn(), commitWithAudit: vi.fn() }, remote: { removeRemoteFolder }
    })
    const preview = await service.preview('100', 'bilimi-logical:work')

    await expect(service.executeRemote('100', preview.executionToken, service.confirm(preview.executionToken))).rejects.toThrow('another logical ledger')
    expect(removeRemoteFolder).not.toHaveBeenCalled()
  })

  it('records reconciliation-required when local commit fails after the remote deletion succeeds', async () => {
    const current = managedSnapshot()
    const commit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))
    const service = new FavoriteRepositoryManagedFolderService({
      repository: { getSnapshot: vi.fn(async () => current), commit, commitWithAudit: vi.fn().mockRejectedValue(new Error('disk full')) },
      remote: { removeRemoteFolder: vi.fn(async () => undefined) }
    })
    const preview = await service.preview('100', 'bilimi-logical:work')

    await expect(service.executeRemote('100', preview.executionToken, service.confirm(preview.executionToken))).resolves.toMatchObject({ status: 'result-unknown', auditStatus: 'recorded' })
    expect(commit).toHaveBeenCalledWith('100', expect.objectContaining({ type: 'record-sync-result', payload: expect.objectContaining({ status: 'result-unknown' }) }))
  })

  it('returns a failed result when checkpoint persistence fails after a known remote rejection', async () => {
    let current = managedSnapshot()
    const service = new FavoriteRepositoryManagedFolderService({
      repository: { getSnapshot: vi.fn(async () => current), commit: vi.fn(async () => { throw new Error('disk full') }), commitWithAudit: vi.fn() },
      remote: { removeRemoteFolder: vi.fn(async () => { throw Object.assign(new Error('request rejected'), { code: 'REMOTE_REJECTED' }) }) }
    })
    const preview = await service.preview('100', 'bilimi-logical:work')

    await expect(service.executeRemote('100', preview.executionToken, service.confirm(preview.executionToken)))
      .resolves.toMatchObject({ status: 'failed', auditStatus: 'failed' })
  })

  it('returns an unknown result when every recovery checkpoint fails after a successful remote deletion', async () => {
    const current = managedSnapshot()
    const service = new FavoriteRepositoryManagedFolderService({
      repository: {
        getSnapshot: vi.fn(async () => current),
        commit: vi.fn(async () => { throw new Error('disk full') }),
        commitWithAudit: vi.fn(async () => { throw new Error('disk full') })
      },
      remote: { removeRemoteFolder: vi.fn(async () => undefined) }
    })
    const preview = await service.preview('100', 'bilimi-logical:work')

    await expect(service.executeRemote('100', preview.executionToken, service.confirm(preview.executionToken)))
      .resolves.toMatchObject({ status: 'result-unknown', auditStatus: 'failed' })
  })

  it('deletes only the local managed-folder projection', async () => {
    const current = managedSnapshot()
    const commit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))
    const afterDeletion = { ...current, memberships: { ...current.memberships, 'bilimi-logical:work': [] } }
    const getSnapshot = vi.fn().mockResolvedValueOnce(current).mockResolvedValueOnce(current).mockResolvedValue(afterDeletion)
    const commitWithAudit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))
    const service = new FavoriteRepositoryManagedFolderService({ repository: { getSnapshot, commit, commitWithAudit }, now: () => '2026-07-24T01:00:00.000Z' })
    const preview = await service.preview('100', 'bilimi-logical:work')
    await service.deleteLocal('100', preview.executionToken)
    expect(commitWithAudit.mock.calls[0][1]).toMatchObject({ type: 'delete-local-managed-folder', payload: { logicalFolderId: 'bilimi-logical:work' } })
    expect(commit).not.toHaveBeenCalled()
  })

  it('does not relabel a successful remote deletion as result-unknown when only audit persistence fails', async () => {
    const current = managedSnapshot()
    const commit = vi.fn()
    const commitWithAudit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [1, 2], affectedFolderIds: ['bilimi-logical:work'] }))
    const removeRemoteFolder = vi.fn(async () => undefined)
    const service = new FavoriteRepositoryManagedFolderService({
      repository: { getSnapshot: vi.fn(async () => current), commit, commitWithAudit }, remote: { removeRemoteFolder }
    })

    const preview = await service.preview('100', 'bilimi-logical:work')
    const confirmation = service.confirm(preview.executionToken)
    await expect(service.executeRemote('100', preview.executionToken, confirmation)).resolves.toMatchObject({
      status: 'succeeded', auditStatus: 'recorded'
    })
    expect(removeRemoteFolder).toHaveBeenCalledTimes(1)
    await expect(service.executeRemote('100', preview.executionToken, confirmation)).rejects.toThrow('confirmation')
  })

  it('removes the local managed projection only after the remote delete succeeds', async () => {
    const current = managedSnapshot()
    const commit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))
    const service = new FavoriteRepositoryManagedFolderService({
      repository: { getSnapshot: vi.fn(async () => current), commit, commitWithAudit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] })) }, remote: { removeRemoteFolder: vi.fn(async () => undefined) }
    })
    const preview = await service.preview('100', 'bilimi-logical:work')
    const confirmation = service.confirm(preview.executionToken)

    await expect(service.executeRemote('100', preview.executionToken, confirmation)).resolves.toMatchObject({ status: 'succeeded' })
    expect(commit).not.toHaveBeenCalled()
  })

  it('keeps a known remote deletion rejection failed and never retries it during reconciliation', async () => {
    const current = managedSnapshot()
    const commit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))
    const removeRemoteFolder = vi.fn(async () => { throw Object.assign(new Error('request rejected'), { code: 'REMOTE_REJECTED' }) })
    const service = new FavoriteRepositoryManagedFolderService({ repository: { getSnapshot: vi.fn(async () => current), commit, commitWithAudit: vi.fn() }, remote: { removeRemoteFolder } })
    const preview = await service.preview('100', 'bilimi-logical:work')
    const confirmation = service.confirm(preview.executionToken)

    await expect(service.executeRemote('100', preview.executionToken, confirmation)).resolves.toMatchObject({ status: 'failed' })
    await expect(service.reconcile('100', preview.operationId)).resolves.toMatchObject({ status: 'failed' })
    expect(removeRemoteFolder).toHaveBeenCalledTimes(1)
  })

  it('permits a newly previewed and confirmed retry after a known remote rejection', async () => {
    const current = managedSnapshot()
    const removeRemoteFolder = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('request rejected'), { code: 'REMOTE_REJECTED' }))
      .mockResolvedValueOnce(undefined)
    const service = new FavoriteRepositoryManagedFolderService({
      repository: {
        getSnapshot: vi.fn(async () => current), commit: vi.fn(),
        commitWithAudit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))
      }, remote: { removeRemoteFolder }
    })
    const first = await service.preview('100', 'bilimi-logical:work')
    await expect(service.executeRemote('100', first.executionToken, service.confirm(first.executionToken))).resolves.toMatchObject({ status: 'failed' })
    const second = await service.preview('100', 'bilimi-logical:work')

    await expect(service.executeRemote('100', second.executionToken, service.confirm(second.executionToken))).resolves.toMatchObject({ status: 'succeeded' })
    expect(removeRemoteFolder).toHaveBeenCalledTimes(2)
  })

  it('rechecks the managed target inside the shared arbiter and never deletes it twice', async () => {
    let current = managedSnapshot()
    let release!: () => void
    const started = new Promise<void>((resolve) => { release = resolve })
    const removeRemoteFolder = vi.fn(async () => started)
    const arbiter = new FavoriteRepositoryRemoteOperationArbiter()
    const service = new FavoriteRepositoryManagedFolderService({
      repository: { getSnapshot: vi.fn(async () => current), commit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] })), commitWithAudit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => {
        current = { ...current, revision: current.revision + 1 }
        return { ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }
      }) },
      remote: { removeRemoteFolder }, remoteArbiter: arbiter
    } as never)
    const first = await service.preview('100', 'bilimi-logical:work')
    const second = await service.preview('100', 'bilimi-logical:work')
    const firstRun = service.executeRemote('100', first.executionToken, service.confirm(first.executionToken))
    const secondRun = service.executeRemote('100', second.executionToken, service.confirm(second.executionToken))
    await Promise.resolve()
    expect(removeRemoteFolder).toHaveBeenCalledTimes(1)
    release()
    await expect(firstRun).resolves.toMatchObject({ status: 'succeeded' })
    await expect(secondRun).rejects.toThrow('stale')
    expect(removeRemoteFolder).toHaveBeenCalledTimes(1)
  })

  it('requires an atomic audit transaction when deleting a local managed folder', async () => {
    const current = managedSnapshot()
    const commit = vi.fn()
    const commitWithAudit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand, events: unknown[]) => ({ ...current, commandId: command.id, affectedAids: [1, 2], affectedFolderIds: [], events }))
    const service = new FavoriteRepositoryManagedFolderService({ repository: { getSnapshot: vi.fn(async () => current), commit, commitWithAudit } } as never)
    const preview = await service.preview('100', 'bilimi-logical:work')

    await service.deleteLocal('100', preview.executionToken)
    expect(commit).not.toHaveBeenCalled()
    expect(commitWithAudit).toHaveBeenCalledOnce()
    expect(commitWithAudit.mock.calls[0][2]).toMatchObject([{ aid: 1 }, { aid: 2 }])
  })
})
