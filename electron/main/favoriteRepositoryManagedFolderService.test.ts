import { describe, expect, it, vi } from 'vitest'
import type { AccountFavoriteRepositorySnapshot, FavoriteRepositoryCommand } from '../../src/shared/favoriteRepository'
import { createAccountFavoriteRepositorySnapshot } from '../../src/shared/favoriteRepository'
import { planFavoriteLibraryManagedFolderProjection } from './favoriteLibraryManagedFolderProjection'
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
  it('includes diagnostics for managed folders and permits a local-only staging clear', async () => {
    let current = managedSnapshot()
    const commit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))
    const commitWithAudit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))
    const service = new FavoriteRepositoryManagedFolderService({
      repository: { getSnapshot: vi.fn(async () => current), commit, commitWithAudit },
      remoteObserver: { remoteFolderExists: vi.fn(async () => 'present' as const) }
    })
    await expect(service.preview('100', 'bilimi-logical:work')).resolves.toMatchObject({ localMemberCount: 2, unmatchedFallbackCount: 2, remoteBinding: { remoteFolderId: '99' }, remoteOnlyMemberCount: 1, currentRevision: 4 })
    const stagingPreview = await service.preview('100', 'local:inbox')
    expect(stagingPreview).toMatchObject({ logicalFolderId: 'local:inbox', localMemberCount: 1, unmatchedFallbackCount: 0, currentRevision: 4 })
    expect(stagingPreview.remoteBinding).toBeUndefined()

    await service.deleteLocal('100', stagingPreview.executionToken)
    expect(commitWithAudit).toHaveBeenCalledWith('100', expect.objectContaining({ type: 'clear-local-inbox' }), expect.any(Array))
  })

  it('previews every logical workspace except inbox and permits remote deletion for the safely bound subset', async () => {
    const current = {
      ...managedSnapshot(),
      folders: [...managedSnapshot().folders, { id: 'bilimi-logical:ideas', title: 'Ideas', kind: 'bilimi-logical' as const, logicalLedgerId: 'ideas', syncState: 'pending-reconcile' as const }],
      physicalShards: [...managedSnapshot().physicalShards, { logicalLedgerId: 'ideas', folderId: 'bilimi:ideas:001', shardNumber: 1, bindingState: 'pending-reconcile' as const, knownRemoteFolderIds: ['41', '42'] }]
    }
    const service = new FavoriteRepositoryManagedFolderService({
      repository: { getSnapshot: vi.fn(async () => current), commit: vi.fn(), commitWithAudit: vi.fn() },
      remoteObserver: { remoteFolderExists: vi.fn(async () => 'present' as const) }
    })

    await expect(service.previewAll('100')).resolves.toMatchObject({
      folderCount: 2,
      affectedVideoCount: 2,
      remoteAllowed: true,
      folders: expect.arrayContaining([
        expect.objectContaining({ logicalFolderId: 'bilimi-logical:work', remoteAllowed: true }),
        expect.objectContaining({ logicalFolderId: 'bilimi-logical:ideas', remoteAllowed: false })
      ])
    })
  })

  it('does not permit remote deletion when one logical folder still has a pending shard', async () => {
    const current = {
      ...managedSnapshot(),
      physicalShards: [
        ...managedSnapshot().physicalShards,
        { logicalLedgerId: 'work', folderId: 'bilimi:work:002', shardNumber: 2, bindingState: 'pending-reconcile' as const, knownRemoteFolderIds: ['100'] }
      ]
    }
    const service = new FavoriteRepositoryManagedFolderService({
      repository: { getSnapshot: vi.fn(async () => current), commit: vi.fn(), commitWithAudit: vi.fn() },
      remote: { removeRemoteFolder: vi.fn() }, remoteObserver: { remoteFolderExists: vi.fn(async () => 'present' as const) }
    })

    const preview = await service.preview('100', 'bilimi-logical:work')
    await expect(() => service.confirm('100', preview.executionToken)).toThrow('unambiguous remote binding')
  })

  it('deletes every bound remote shard for one logical folder as a single confirmed operation', async () => {
    const current = {
      ...managedSnapshot(),
      folders: [
        ...managedSnapshot().folders,
        { id: 'bilibili:work:002', title: 'Work 2', kind: 'bilibili' as const, remoteFolderId: '100', syncState: 'bound' as const }
      ],
      memberships: {
        ...managedSnapshot().memberships,
        'bilimi:work:002': [3, 4],
        'bilibili:work:002': [3, 4]
      },
      physicalShards: [
        ...managedSnapshot().physicalShards,
        { logicalLedgerId: 'work', folderId: 'bilimi:work:002', shardNumber: 2, remoteFolderId: '100', remoteTitle: 'Work 2', bindingState: 'bound' as const, remoteMemberCount: 2 }
      ]
    }
    const removeRemoteFolder = vi.fn(async () => undefined)
    const remoteFolderExists = vi.fn(async () => 'present' as const)
    const commitWithAudit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))
    const service = new FavoriteRepositoryManagedFolderService({
      repository: { getSnapshot: vi.fn(async () => current), commit: vi.fn(), commitWithAudit },
      remote: { removeRemoteFolder }, remoteObserver: { remoteFolderExists }
    })

    const preview = await service.preview('100', 'bilimi-logical:work')
    expect(preview).toMatchObject({ remoteBinding: { remoteFolderIds: ['99', '100'], shardCount: 2 } })
    await expect(service.executeRemote('100', preview.executionToken, service.confirm('100', preview.executionToken)))
      .resolves.toMatchObject({ status: 'succeeded' })

    expect(removeRemoteFolder.mock.calls).toEqual([['100', '99'], ['100', '100']])
    expect(remoteFolderExists.mock.calls).toEqual([])
    expect(commitWithAudit).toHaveBeenCalledWith('100', expect.objectContaining({
      type: 'delete-local-managed-folder',
      payload: { logicalFolderId: 'bilimi-logical:work', confirmedRemoteFolderIds: ['99', '100'] }
    }), expect.any(Array))
  })

  it('does not offer a stale repository binding for remote deletion when the current Bilibili inventory no longer contains it', async () => {
    const current = managedSnapshot()
    const remoteFolderExists = vi.fn(async () => 'absent' as const)
    const service = new FavoriteRepositoryManagedFolderService({
      repository: { getSnapshot: vi.fn(async () => current), commit: vi.fn(), commitWithAudit: vi.fn() },
      remoteObserver: { remoteFolderExists }
    })

    await expect(service.previewAll('100')).resolves.toMatchObject({
      remoteAllowed: false,
      folders: [expect.objectContaining({
        logicalFolderId: 'bilimi-logical:work',
        remoteAllowed: false
      })]
    })
    expect(remoteFolderExists).toHaveBeenCalledWith('100', '99')
  })

  it('keeps remote deletion unavailable when the live inventory cannot confirm a repository binding', async () => {
    const current = managedSnapshot()
    const service = new FavoriteRepositoryManagedFolderService({
      repository: { getSnapshot: vi.fn(async () => current), commit: vi.fn(), commitWithAudit: vi.fn() },
      remoteObserver: { remoteFolderExists: vi.fn(async () => 'unknown' as const) }
    })

    await expect(service.previewAll('100')).resolves.toMatchObject({
      remoteAllowed: false,
      folders: [expect.objectContaining({ remoteAllowed: false })]
    })
  })

  it('deduplicates the affected group videos from one repository revision', async () => {
    const current = {
      ...managedSnapshot(),
      folders: [
        ...managedSnapshot().folders,
        { id: 'bilimi-logical:ideas', title: 'Ideas', kind: 'bilimi-logical' as const, logicalLedgerId: 'ideas', syncState: 'bound' as const }
      ],
      memberships: {
        ...managedSnapshot().memberships,
        'bilimi-logical:ideas': [2, 4],
        'bilimi:ideas:001': [2, 4],
        'bilibili:ideas': [2, 4]
      },
      physicalShards: [
        ...managedSnapshot().physicalShards,
        { logicalLedgerId: 'ideas', folderId: 'bilimi:ideas:001', shardNumber: 1, remoteFolderId: '42', remoteTitle: 'Ideas', bindingState: 'bound' as const, remoteMemberCount: 2 }
      ]
    }
    const getSnapshot = vi.fn(async () => current)
    const service = new FavoriteRepositoryManagedFolderService({ repository: { getSnapshot, commit: vi.fn(), commitWithAudit: vi.fn() } })

    await expect(service.previewAll('100')).resolves.toMatchObject({ folderCount: 2, affectedVideoCount: 3 })
    expect(getSnapshot).toHaveBeenCalledOnce()
  })

  it('commits selected local managed-folder deletions in one revision instead of invalidating sibling previews', async () => {
    const current = {
      ...managedSnapshot(),
      folders: [...managedSnapshot().folders, { id: 'bilimi-logical:ideas', title: 'Ideas', kind: 'bilimi-logical' as const, logicalLedgerId: 'ideas', syncState: 'bound' as const }],
      memberships: {
        ...managedSnapshot().memberships,
        'bilimi-logical:ideas': [2, 4], 'bilimi:ideas:001': [2, 4]
      },
      physicalShards: [...managedSnapshot().physicalShards, {
        logicalLedgerId: 'ideas', folderId: 'bilimi:ideas:001', shardNumber: 1, remoteFolderId: '42', remoteTitle: 'Ideas', bindingState: 'bound' as const
      }]
    }
    const commitWithAudit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))
    const service = new FavoriteRepositoryManagedFolderService({
      repository: { getSnapshot: vi.fn(async () => current), commit: vi.fn(), commitWithAudit }
    })
    const work = await service.preview('100', 'bilimi-logical:work')
    const ideas = await service.preview('100', 'bilimi-logical:ideas')

    await expect(service.deleteLocalMany('100', [work.executionToken, ideas.executionToken])).resolves.toMatchObject({ status: 'succeeded' })

    expect(commitWithAudit).toHaveBeenCalledOnce()
    expect(commitWithAudit).toHaveBeenCalledWith('100', expect.objectContaining({
      type: 'delete-local-managed-folders', payload: { logicalFolderIds: ['bilimi-logical:ideas', 'bilimi-logical:work'] }
    }), expect.any(Array))
  })

  it('requires preview, confirmation, and unchanged baseline for remote deletion; unknown results need reconciliation without retry', async () => {
    const current = managedSnapshot()
    const getSnapshot = vi.fn(async () => current)
    const commit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))
    const removeRemoteFolder = vi.fn(async () => { throw new Error('connection dropped') })
    const service = new FavoriteRepositoryManagedFolderService({ repository: { getSnapshot, commit, commitWithAudit: vi.fn() }, remote: { removeRemoteFolder }, now: () => '2026-07-24T01:00:00.000Z' })
    const preview = await service.preview('100', 'bilimi-logical:work')
    const confirmation = service.confirm('100', preview.executionToken)
    await expect(service.executeRemote('100', preview.executionToken, confirmation)).resolves.toMatchObject({ status: 'result-unknown' })
    expect(removeRemoteFolder).toHaveBeenCalledTimes(1)
    await expect(service.executeRemote('100', preview.executionToken, confirmation)).rejects.toThrow('confirmation')
    await expect(service.reconcile('100', preview.operationId)).resolves.toMatchObject({ status: 'reconciliation-required' })
  })

  it('revalidates the managed folder identity when only unrelated repository metadata changed after preview', async () => {
    const initial = managedSnapshot()
    const current = { ...initial, revision: initial.revision + 1, updatedAt: '2026-07-24T00:01:00.000Z' }
    const getSnapshot = vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(current)
    const removeRemoteFolder = vi.fn(async () => undefined)
    const commitWithAudit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))
    const service = new FavoriteRepositoryManagedFolderService({
      repository: { getSnapshot, commit: vi.fn(), commitWithAudit }, remote: { removeRemoteFolder }
    })
    const preview = await service.preview('100', 'bilimi-logical:work')

    await expect(service.executeRemote('100', preview.executionToken, service.confirm('100', preview.executionToken)))
      .resolves.toMatchObject({ status: 'succeeded' })
    expect(removeRemoteFolder).toHaveBeenCalledWith('100', '99')
  })

  it('still rejects execution when the logical membership changed after preview', async () => {
    const initial = managedSnapshot()
    const changed = { ...initial, revision: initial.revision + 1, memberships: { ...initial.memberships, 'bilimi-logical:work': [1] } }
    const getSnapshot = vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(changed)
    const removeRemoteFolder = vi.fn()
    const service = new FavoriteRepositoryManagedFolderService({
      repository: { getSnapshot, commit: vi.fn(), commitWithAudit: vi.fn() }, remote: { removeRemoteFolder }
    })
    const preview = await service.preview('100', 'bilimi-logical:work')

    await expect(service.executeRemote('100', preview.executionToken, service.confirm('100', preview.executionToken)))
      .rejects.toThrow('baseline is stale')
    expect(removeRemoteFolder).not.toHaveBeenCalled()
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
    await first.executeRemote('100', preview.executionToken, first.confirm('100', preview.executionToken))
    const recorded = commit.mock.calls.find((call) => call[1].type === 'record-sync-result')![1].payload as { targetFolderIds: string[] }
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

    await expect(restarted.executeRemote('100', preview.executionToken, restarted.confirm('100', preview.executionToken)))
      .resolves.toMatchObject({ status: 'result-unknown' })
    expect(removeRemoteFolder).not.toHaveBeenCalled()
  })

  it('settles a prior unknown deletion as failed after a read-only present observation before a newly confirmed delete', async () => {
    let current = {
      ...managedSnapshot(),
      syncRecords: [{
        id: 'managed-folder-delete:prior-unknown', commandId: 'prior-unknown', operationKey: 'managed-folder-delete',
        status: 'result-unknown' as const, affectedAids: [], targetFolderIds: ['bilimi-logical:work'], updatedAt: '2026-07-24T00:00:00.000Z'
      }]
    }
    const removeRemoteFolder = vi.fn(async () => undefined)
    const commit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => {
      if (command.type === 'record-sync-result') {
        current = {
          ...current,
          syncRecords: current.syncRecords.map((record) => record.id === command.payload.id
            ? { ...record, status: command.payload.status, updatedAt: command.payload.updatedAt }
            : record)
        }
      }
      return { ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }
    })
    const service = new FavoriteRepositoryManagedFolderService({
      repository: {
        getSnapshot: vi.fn(async () => current), commit,
        commitWithAudit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))
      }, remote: { removeRemoteFolder }, remoteObserver: { remoteFolderExists: vi.fn(async () => 'present' as const) }
    })
    const preview = await service.preview('100', 'bilimi-logical:work')

    await expect(service.executeRemote('100', preview.executionToken, service.confirm('100', preview.executionToken)))
      .resolves.toMatchObject({ status: 'succeeded' })
    expect(commit).toHaveBeenCalledWith('100', expect.objectContaining({ type: 'record-sync-result', payload: expect.objectContaining({ id: 'managed-folder-delete:prior-unknown', status: 'failed' }) }))
    expect(removeRemoteFolder).toHaveBeenCalledWith('100', '99')
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

  it('releases the in-memory remote owner after a reconciled known failure so a new preview can retry', async () => {
    const current = managedSnapshot()
    const removeRemoteFolder = vi.fn(async () => { throw new Error('connection dropped') })
    const service = new FavoriteRepositoryManagedFolderService({
      repository: {
        getSnapshot: vi.fn(async () => current),
        commit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] })),
        commitWithAudit: vi.fn()
      },
      remote: { removeRemoteFolder }, remoteObserver: { remoteFolderExists: vi.fn(async () => 'present' as const) }
    })
    const first = await service.preview('100', 'bilimi-logical:work')
    await service.executeRemote('100', first.executionToken, service.confirm('100', first.executionToken))
    await expect(service.reconcile('100', first.operationId)).resolves.toMatchObject({ status: 'failed' })
    const retry = await service.preview('100', 'bilimi-logical:work')

    await expect(service.executeRemote('100', retry.executionToken, service.confirm('100', retry.executionToken))).resolves.toMatchObject({ status: 'result-unknown' })
    expect(removeRemoteFolder).toHaveBeenCalledTimes(2)
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

    await expect(service.executeRemote('100', preview.executionToken, service.confirm('100', preview.executionToken))).rejects.toThrow('another logical ledger')
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

    await expect(service.executeRemote('100', preview.executionToken, service.confirm('100', preview.executionToken))).resolves.toMatchObject({ status: 'result-unknown', auditStatus: 'recorded' })
    expect(commit).toHaveBeenCalledWith('100', expect.objectContaining({ type: 'record-sync-result', payload: expect.objectContaining({ status: 'result-unknown' }) }))
  })

  it('does not update persisted managed ledger rules while a remote deletion result is unknown', async () => {
    const current = managedSnapshot()
    const onManagedFolderDeleted = vi.fn()
    const service = new FavoriteRepositoryManagedFolderService({
      repository: {
        getSnapshot: vi.fn(async () => current),
        commit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] })),
        commitWithAudit: vi.fn()
      },
      remote: { removeRemoteFolder: vi.fn(async () => { throw new Error('connection dropped') }) },
      onManagedFolderDeleted
    })
    const preview = await service.preview('100', 'bilimi-logical:work')

    await expect(service.executeRemote('100', preview.executionToken, service.confirm('100', preview.executionToken)))
      .resolves.toMatchObject({ status: 'result-unknown' })

    expect(onManagedFolderDeleted).not.toHaveBeenCalled()
  })

  it('updates persisted managed ledger rules only after a remote deletion and local projection both succeed', async () => {
    const current = managedSnapshot()
    const onManagedFolderDeleted = vi.fn()
    const service = new FavoriteRepositoryManagedFolderService({
      repository: {
        getSnapshot: vi.fn(async () => current), commit: vi.fn(),
        commitWithAudit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))
      },
      remote: { removeRemoteFolder: vi.fn(async () => undefined) },
      onManagedFolderDeleted
    })
    const preview = await service.preview('100', 'bilimi-logical:work')

    await expect(service.executeRemote('100', preview.executionToken, service.confirm('100', preview.executionToken)))
      .resolves.toMatchObject({ status: 'succeeded' })

    expect(onManagedFolderDeleted).toHaveBeenCalledTimes(1)
    expect(onManagedFolderDeleted).toHaveBeenCalledWith('100', [{
      logicalLedgerId: 'work', remoteFolderIds: ['99'], remoteDeleted: true
    }])
  })

  it('returns a failed result when checkpoint persistence fails after a known remote rejection', async () => {
    let current = managedSnapshot()
    const service = new FavoriteRepositoryManagedFolderService({
      repository: { getSnapshot: vi.fn(async () => current), commit: vi.fn(async () => { throw new Error('disk full') }), commitWithAudit: vi.fn() },
      remote: { removeRemoteFolder: vi.fn(async () => { throw Object.assign(new Error('request rejected'), { code: 'REMOTE_REJECTED' }) }) }
    })
    const preview = await service.preview('100', 'bilimi-logical:work')

    await expect(service.executeRemote('100', preview.executionToken, service.confirm('100', preview.executionToken)))
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

    await expect(service.executeRemote('100', preview.executionToken, service.confirm('100', preview.executionToken)))
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

  it('deletes an empty managed folder locally without requiring a nonexistent video audit event', async () => {
    const current = {
      ...managedSnapshot(),
      memberships: { ...managedSnapshot().memberships, 'bilimi-logical:work': [], 'bilimi:work:001': [], 'bilibili:work': [] }
    }
    const commit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))
    const commitWithAudit = vi.fn()
    const service = new FavoriteRepositoryManagedFolderService({
      repository: { getSnapshot: vi.fn(async () => current), commit, commitWithAudit }
    })
    const preview = await service.preview('100', 'bilimi-logical:work')

    await expect(service.deleteLocal('100', preview.executionToken))
      .resolves.toMatchObject({ status: 'succeeded', auditStatus: 'recorded' })
    expect(commit).toHaveBeenCalledWith('100', expect.objectContaining({ type: 'delete-local-managed-folder' }))
    expect(commitWithAudit).not.toHaveBeenCalled()
  })

  it('passes retained bound and pending remote ids to local managed-folder persistence', async () => {
    const current = {
      ...managedSnapshot(),
      physicalShards: [{
        ...managedSnapshot().physicalShards[0], remoteFolderId: undefined,
        bindingState: 'pending-reconcile' as const, knownRemoteFolderIds: [' 100 ', '99', '100']
      }]
    }
    const onManagedFolderDeleted = vi.fn()
    const service = new FavoriteRepositoryManagedFolderService({
      repository: {
        getSnapshot: vi.fn(async () => current), commit: vi.fn(),
        commitWithAudit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))
      },
      onManagedFolderDeleted
    })
    const preview = await service.preview('100', 'bilimi-logical:work')

    await service.deleteLocal('100', preview.executionToken)

    expect(onManagedFolderDeleted).toHaveBeenCalledTimes(1)
    expect(onManagedFolderDeleted).toHaveBeenCalledWith('100', [{
      logicalLedgerId: 'work', remoteFolderIds: ['99', '100'], remoteDeleted: false
    }])
  })

  it('keeps a successful local deletion result when preference persistence fails afterward', async () => {
    const current = managedSnapshot()
    const onManagedFolderDeleted = vi.fn().mockRejectedValue(new Error('preferences unavailable'))
    const commitWithAudit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))
    const service = new FavoriteRepositoryManagedFolderService({
      repository: { getSnapshot: vi.fn(async () => current), commit: vi.fn(), commitWithAudit },
      onManagedFolderDeleted
    })
    const preview = await service.preview('100', 'bilimi-logical:work')

    await expect(service.deleteLocal('100', preview.executionToken)).resolves.toMatchObject({
      status: 'succeeded', preferencesStatus: 'failed'
    })
  })

  it('keeps a successful remote deletion result when preference persistence fails afterward', async () => {
    const current = managedSnapshot()
    const onManagedFolderDeleted = vi.fn().mockRejectedValue(new Error('preferences unavailable'))
    const commitWithAudit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))
    const service = new FavoriteRepositoryManagedFolderService({
      repository: { getSnapshot: vi.fn(async () => current), commit: vi.fn(), commitWithAudit },
      remote: { removeRemoteFolder: vi.fn(async () => undefined) },
      onManagedFolderDeleted
    })
    const preview = await service.preview('100', 'bilimi-logical:work')

    await expect(service.executeRemote('100', preview.executionToken, service.confirm('100', preview.executionToken))).resolves.toMatchObject({
      status: 'succeeded', preferencesStatus: 'failed'
    })
    expect(commitWithAudit).toHaveBeenCalledWith('100', expect.objectContaining({ type: 'delete-local-managed-folder' }), expect.any(Array))
    expect(commitWithAudit.mock.calls.some(([, command]) => command.type === 'record-sync-result' && command.payload.status === 'result-unknown')).toBe(false)
  })

  it('does not update persisted managed ledger rules when a local managed-folder commit fails', async () => {
    const current = managedSnapshot()
    const onManagedFolderDeleted = vi.fn()
    const service = new FavoriteRepositoryManagedFolderService({
      repository: {
        getSnapshot: vi.fn(async () => current), commit: vi.fn(),
        commitWithAudit: vi.fn(async () => { throw new Error('disk unavailable') })
      },
      onManagedFolderDeleted
    })
    const preview = await service.preview('100', 'bilimi-logical:work')

    await expect(service.deleteLocal('100', preview.executionToken)).rejects.toThrow('disk unavailable')

    expect(onManagedFolderDeleted).not.toHaveBeenCalled()
  })

  it('does not write a legacy remote dismissal after local deletion so a retained bilimi folder can be rediscovered', async () => {
    const current = managedSnapshot()
    const service = new FavoriteRepositoryManagedFolderService({
      repository: {
        getSnapshot: vi.fn(async () => current), commit: vi.fn(),
        commitWithAudit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))
      }
    })
    const preview = await service.preview('100', 'bilimi-logical:work')

    await service.deleteLocal('100', preview.executionToken)

    expect(planFavoriteLibraryManagedFolderProjection({
      snapshot: {
        ...current,
        folders: [{ id: 'bilibili:99', title: 'bilimi·工作', kind: 'bilibili', remoteFolderId: '99', syncState: 'bound' }],
        memberships: { 'bilibili:99': [1] }, physicalShards: []
      },
      ledgers: [{ id: 'work', displayName: 'bilimi·工作', keywords: [], enabled: true, priority: 1, isDefault: false }],
      dismissedRemoteFolderIds: ['99']
    })).toEqual([expect.objectContaining({
      logicalLedgerId: 'work', bindingState: 'pending-reconcile', knownRemoteFolderIds: ['99']
    })])
  })

  it('does not suppress any pending remote shard after local deletion', async () => {
    const current = {
      ...managedSnapshot(),
      folders: managedSnapshot().folders.map((folder) => folder.id === 'bilimi-logical:work'
        ? { ...folder, syncState: 'pending-reconcile' as const }
        : folder),
      physicalShards: [
        { logicalLedgerId: 'work', folderId: 'bilimi:work:001', shardNumber: 1, remoteTitle: 'Work', bindingState: 'pending-reconcile' as const, knownRemoteFolderIds: ['99'] },
        { logicalLedgerId: 'work', folderId: 'bilimi:work:002', shardNumber: 2, remoteTitle: 'Work\u00b702', bindingState: 'pending-reconcile' as const, knownRemoteFolderIds: ['100'] }
      ]
    }
    const service = new FavoriteRepositoryManagedFolderService({
      repository: {
        getSnapshot: vi.fn(async () => current), commit: vi.fn(),
        commitWithAudit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))
      }
    })
    const preview = await service.preview('100', 'bilimi-logical:work')

    await service.deleteLocal('100', preview.executionToken)

    expect(planFavoriteLibraryManagedFolderProjection({
      snapshot: {
        ...current,
        folders: [
          { id: 'bilibili:99', title: 'bilimi\u00b7\u6e38\u620f\u4e13\u533a', kind: 'bilibili', remoteFolderId: '99', syncState: 'bound' },
          { id: 'bilibili:100', title: 'bilimi\u00b7\u6e38\u620f\u4e13\u533a\u00b702', kind: 'bilibili', remoteFolderId: '100', syncState: 'bound' }
        ],
        memberships: { 'bilibili:99': [1], 'bilibili:100': [2] },
        physicalShards: []
      },
      ledgers: [{ id: 'work', displayName: 'bilimi\u00b7\u6e38\u620f\u4e13\u533a', keywords: [], enabled: true, priority: 1, isDefault: false }],
      dismissedRemoteFolderIds: ['99', '100']
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ knownRemoteFolderIds: ['99'], bindingState: 'pending-reconcile' }),
      expect.objectContaining({ knownRemoteFolderIds: ['100'], bindingState: 'pending-reconcile' })
    ]))
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
    const confirmation = service.confirm('100', preview.executionToken)
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
    const confirmation = service.confirm('100', preview.executionToken)

    await expect(service.executeRemote('100', preview.executionToken, confirmation)).resolves.toMatchObject({ status: 'succeeded' })
    expect(commit).not.toHaveBeenCalled()
  })

  it('commits an empty managed folder deletion without requiring a nonexistent video audit event', async () => {
    const current = {
      ...managedSnapshot(),
      memberships: { ...managedSnapshot().memberships, 'bilimi-logical:work': [], 'bilimi:work:001': [], 'bilibili:work': [] }
    }
    const commit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))
    const commitWithAudit = vi.fn()
    const service = new FavoriteRepositoryManagedFolderService({
      repository: { getSnapshot: vi.fn(async () => current), commit, commitWithAudit }, remote: { removeRemoteFolder: vi.fn(async () => undefined) }
    })
    const preview = await service.preview('100', 'bilimi-logical:work')

    await expect(service.executeRemote('100', preview.executionToken, service.confirm('100', preview.executionToken)))
      .resolves.toMatchObject({ status: 'succeeded', auditStatus: 'recorded' })
    expect(commit).toHaveBeenCalledWith('100', expect.objectContaining({ type: 'delete-local-managed-folder' }))
    expect(commitWithAudit).not.toHaveBeenCalled()
  })

  it('keeps a known remote deletion rejection failed and never retries it during reconciliation', async () => {
    const current = managedSnapshot()
    const commit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))
    const removeRemoteFolder = vi.fn(async () => { throw Object.assign(new Error('request rejected'), { code: 'REMOTE_REJECTED' }) })
    const service = new FavoriteRepositoryManagedFolderService({ repository: { getSnapshot: vi.fn(async () => current), commit, commitWithAudit: vi.fn() }, remote: { removeRemoteFolder } })
    const preview = await service.preview('100', 'bilimi-logical:work')
    const confirmation = service.confirm('100', preview.executionToken)

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
    await expect(service.executeRemote('100', first.executionToken, service.confirm('100', first.executionToken))).resolves.toMatchObject({ status: 'failed' })
    const second = await service.preview('100', 'bilimi-logical:work')

    await expect(service.executeRemote('100', second.executionToken, service.confirm('100', second.executionToken))).resolves.toMatchObject({ status: 'succeeded' })
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
    const firstRun = service.executeRemote('100', first.executionToken, service.confirm('100', first.executionToken))
    const secondRun = service.executeRemote('100', second.executionToken, service.confirm('100', second.executionToken))
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
