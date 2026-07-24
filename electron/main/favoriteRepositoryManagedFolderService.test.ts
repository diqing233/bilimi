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
    const current = managedSnapshot()
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

  it('serializes managed remote deletion through the shared remote arbiter', async () => {
    const current = managedSnapshot()
    let release!: () => void
    const started = new Promise<void>((resolve) => { release = resolve })
    const removeRemoteFolder = vi.fn(async () => started)
    const arbiter = new FavoriteRepositoryRemoteOperationArbiter()
    const service = new FavoriteRepositoryManagedFolderService({
      repository: { getSnapshot: vi.fn(async () => current), commit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] })), commitWithAudit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] })) },
      remote: { removeRemoteFolder }, remoteArbiter: arbiter
    } as never)
    const first = await service.preview('100', 'bilimi-logical:work')
    const second = await service.preview('100', 'bilimi-logical:work')
    const firstRun = service.executeRemote('100', first.executionToken, service.confirm(first.executionToken))
    const secondRun = service.executeRemote('100', second.executionToken, service.confirm(second.executionToken))
    await Promise.resolve()
    expect(removeRemoteFolder).toHaveBeenCalledTimes(1)
    release()
    await Promise.all([firstRun, secondRun])
    expect(removeRemoteFolder).toHaveBeenCalledTimes(2)
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
