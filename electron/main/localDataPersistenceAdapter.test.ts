import { describe, expect, it, vi } from 'vitest'
import { createAccountFavoriteRepositorySnapshot, createFavoriteRepositoryArchiveExport } from '../../src/shared/favoriteRepository'
import { createLocalDataPersistenceAdapter } from './localDataPersistenceAdapter'

describe('local data persistence adapter', () => {
  it('projects repository, archive, transcription, and settings sections and restores them as one batch', async () => {
    const repository = {
      ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-24T00:00:00.000Z' }),
      videos: { '1': { aid: 1, title: 'video', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' } },
      positions: { '100:1': { accountMid: '100', aid: 1, localDesiredFolderIds: ['local:music'], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], positionState: 'local-only-change', updatedAt: '2026-07-24T00:00:00.000Z', revision: 1 } },
      organizationRecords: [{ accountMid: '100', aid: 1, targetFolderIds: ['local:music'], completedAt: '2026-07-24T00:00:00.000Z' }]
    }
    const applyPortableBatch = vi.fn()
    const applyPortableState = vi.fn()
    const adapter = createLocalDataPersistenceAdapter({
      listAccountUids: () => ['100'], getRepository: vi.fn().mockResolvedValue(repository),
      getAccountSettings: () => ({ favoriteLedgers: [], updatedAt: '2026-07-24T00:00:00.000Z' }),
      getArchives: () => [{ id: 'archive-1', source: { accountMid: '100', aid: 1 }, versions: [], createdAt: '2026-07-24T00:00:00.000Z', updatedAt: '2026-07-24T00:00:00.000Z' }],
      getTranscriptionItems: () => [{ id: 'job-1', accountMid: '100', aid: 1, cid: 11, url: 'https://x', title: 'video', status: 'pending', createdAt: '2026-07-24T00:00:00.000Z', updatedAt: '2026-07-24T00:00:00.000Z' }],
      applyPortableBatch, applyPortableState, readSharedSettings: () => ({ closeBehavior: 'minimize-to-tray' }), writeSharedSettings: vi.fn()
    })

    const portable = await adapter.readAccount('100')
    expect(portable).toMatchObject({ repository: { videos: [expect.objectContaining({ aid: 1 })], positions: [expect.objectContaining({ aid: 1 })], protections: [expect.objectContaining({ aid: 1 })] }, archives: [expect.objectContaining({ id: 'archive-1' })], transcription: [expect.objectContaining({ id: 'job-1' })] })
    await adapter.writeAccounts({ '100': portable })
    expect(applyPortableBatch).toHaveBeenCalledWith(expect.objectContaining({
      repositoryArchives: { '100': expect.objectContaining({ accountMid: '100', videos: [expect.objectContaining({ aid: 1 })] }) },
      archivesByUid: { '100': [expect.objectContaining({ id: 'archive-1' })] },
      transcriptionByUid: { '100': [expect.objectContaining({ id: 'job-1' })] }
    }))
    await adapter.writePortableState?.({ accounts: { '100': portable }, sharedSettings: { closeBehavior: 'exit-launcher' } })
    expect(applyPortableState).toHaveBeenCalledWith(expect.objectContaining({ repositoryArchives: expect.any(Object) }), { closeBehavior: 'exit-launcher' })
  })

  it('does not allow raw repository snapshots or cross-account archives into the portable batch', async () => {
    const adapter = createLocalDataPersistenceAdapter({
      listAccountUids: () => ['100'], getRepository: vi.fn(), getAccountSettings: () => ({}), getArchives: () => [], getTranscriptionItems: () => [],
      applyPortableBatch: vi.fn(), applyPortableState: vi.fn(), readSharedSettings: () => ({}), writeSharedSettings: vi.fn()
    })
    await expect(adapter.writeAccounts({ '100': { repository: { videos: [], positions: [], protections: [] }, archives: [{ source: { accountMid: '200' } }] } })).rejects.toThrow('repository')
  })

  it('rejects a checksum-bearing but malformed repository instead of laundering it into a new checksum', async () => {
    const applyPortableBatch = vi.fn()
    const adapter = createLocalDataPersistenceAdapter({
      listAccountUids: () => ['100'], getRepository: vi.fn(), getAccountSettings: () => ({}), getArchives: () => [], getTranscriptionItems: () => [],
      applyPortableBatch, applyPortableState: vi.fn(), readSharedSettings: () => ({}), writeSharedSettings: vi.fn()
    })

    await expect(adapter.writeAccounts({
      '100': { repository: { version: 1, accountMid: '100', generatedAt: '2026-07-24T00:00:00.000Z', checksum: 'a'.repeat(64), videos: [{ aid: 'wrong' }], positions: [], protections: [], events: [], archives: [] }, settings: {}, archives: [], transcription: [], auditEvents: [], workspaces: [], remoteOperations: [] }
    })).rejects.toThrow('repository')
    expect(applyPortableBatch).not.toHaveBeenCalled()
  })

  it('keeps repository exports checksum-valid so import validation cannot accept a fabricated generation', async () => {
    const applyPortableBatch = vi.fn()
    const adapter = createLocalDataPersistenceAdapter({
      listAccountUids: () => ['100'], getRepository: vi.fn().mockResolvedValue(createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-24T00:00:00.000Z' })),
      getAccountSettings: () => ({}), getArchives: () => [], getTranscriptionItems: () => [],
      applyPortableBatch, applyPortableState: vi.fn(), readSharedSettings: () => ({}), writeSharedSettings: vi.fn()
    })
    const portable = await adapter.readAccount('100')
    await adapter.writeAccounts({ '100': portable })
    expect(applyPortableBatch.mock.calls[0]?.[0].repositoryArchives['100'].checksum).toMatch(/^[a-f0-9]{64}$/u)
  })

  it('includes audit events, workspace drafts, remote reconciliation records, and retained signed-out account UIDs', async () => {
    const applyPortableState = vi.fn()
    const adapter = createLocalDataPersistenceAdapter({
      listAccountUids: () => ['100'], listRetainedAccountUids: () => ['200', '100'],
      getRepository: vi.fn().mockResolvedValue({
        ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-24T00:00:00.000Z' }),
        workspace: {
          id: 'draft-1', accountMid: '100', status: 'scanning', baselineRevision: 0, continuationAids: [],
          workspaceRef: { workspaceId: 'draft-1', accountMid: '100', status: 'scanning', baselineRevision: 0, currentSegmentId: 'segment', overlayRevision: 0, journalCursor: 0, checksum: 'a'.repeat(64), updatedAt: '2026-07-24T00:00:00.000Z' }
        },
        syncRecords: [{ id: 'unknown-1', commandId: 'command-1', status: 'result-unknown', affectedAids: [1], updatedAt: '2026-07-24T00:00:00.000Z' }]
      }),
      getAccountSettings: () => ({ updatedAt: '2026-07-24T00:00:00.000Z' }), getArchives: () => [], getTranscriptionItems: () => [],
      getAuditEvents: () => [{ id: 'event-1', accountMid: '100', aid: 1, sequence: 1, kind: 'manual-move', occurredAt: '2026-07-24T00:00:00.000Z' }],
      getWorkspaces: () => [], getRemoteOperations: () => [],
      applyPortableBatch: vi.fn(), applyPortableState, readSharedSettings: () => ({}), writeSharedSettings: vi.fn()
    })

    expect(await adapter.listAccountUids()).toEqual(['100', '200'])
    const portable = await adapter.readAccount('100')
    expect(portable).toMatchObject({ auditEvents: [expect.objectContaining({ id: 'event-1' })], workspaces: [expect.objectContaining({ id: 'draft-1' })], remoteOperations: [expect.objectContaining({ id: 'unknown-1' })] })
    await adapter.writePortableState?.({ accounts: { '100': portable }, sharedSettings: {} })
    expect(applyPortableState).toHaveBeenCalledWith(expect.objectContaining({
      auditEventsByUid: { '100': [expect.objectContaining({ id: 'event-1' })] },
      workspacesByUid: { '100': [expect.objectContaining({ id: 'draft-1' })] },
      remoteOperationsByUid: { '100': [expect.objectContaining({ id: 'unknown-1' })] }
    }), {})
  })

  it('projects validated top-level recovery records into the repository archive consumed by the main importer', async () => {
    const applyPortableState = vi.fn()
    const adapter = createLocalDataPersistenceAdapter({
      listAccountUids: () => ['100'], getRepository: vi.fn().mockResolvedValue(createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-24T00:00:00.000Z' })),
      getAccountSettings: () => ({ defaultFavoriteSystemEnabled: false, favoriteLedgers: [] }), getArchives: () => [], getTranscriptionItems: () => [],
      applyPortableBatch: vi.fn(), applyPortableState, readSharedSettings: () => ({}), writeSharedSettings: vi.fn()
    })
    const portable = await adapter.readAccount('100')
    portable.auditEvents = [{ id: 'event-1', sequence: 1, accountMid: '100', aid: 1, kind: 'manual-move', occurredAt: '2026-07-24T00:00:00.000Z' }]
    portable.workspaces = [{
      id: 'workspace-1', accountMid: '100', status: 'scanning', baselineRevision: 0, continuationAids: [],
      workspaceRef: { workspaceId: 'workspace-1', accountMid: '100', status: 'scanning', baselineRevision: 0, currentSegmentId: 'segment', overlayRevision: 0, journalCursor: 0, checksum: 'a'.repeat(64), updatedAt: '2026-07-24T00:00:00.000Z' }, updatedAt: '2026-07-24T00:00:00.000Z'
    }]
    portable.remoteOperations = [{ id: 'sync-1', commandId: 'command-1', accountMid: '100', status: 'result-unknown', affectedAids: [1], updatedAt: '2026-07-24T00:00:00.000Z' }]

    await adapter.writePortableState?.({ accounts: { '100': portable }, sharedSettings: {} }, { mode: 'overwrite', selectedUids: ['100'] })
    const repository = applyPortableState.mock.calls[0]?.[0].repositoryArchives['100']
    expect(repository).toMatchObject({
      events: [expect.objectContaining({ id: 'event-1' })],
      recovery: { workspace: expect.objectContaining({ id: 'workspace-1' }), syncRecords: [expect.objectContaining({ id: 'sync-1' })] }
    })
  })

  it('exports only canonical repository recovery instead of raw workspace and sync records', async () => {
    const adapter = createLocalDataPersistenceAdapter({
      listAccountUids: () => ['100'],
      getRepository: vi.fn().mockResolvedValue({
        ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-24T00:00:00.000Z' }),
        workspace: {
          id: 'workspace-1', accountMid: '100', status: 'frozen', baselineRevision: 2, continuationAids: [],
          workspaceRef: { workspaceId: 'workspace-1', accountMid: '100', status: 'frozen', baselineRevision: 2, currentSegmentId: 'segment', overlayRevision: 0, journalCursor: 0, checksum: 'a'.repeat(64), updatedAt: '2026-07-24T01:00:00.000Z' },
          frozenSyncPlan: { id: 'plan-1', accountMid: '100', workspaceId: 'workspace-1', baselineRevision: 2, createdAt: '2026-07-24T01:00:00.000Z', operations: [{ operationKey: 'op-1', aid: 1, kind: 'append', folderIds: ['bilimi-logical:music'], beforeFolderIds: ['bilibili:900'] }] }
        },
        syncRecords: [{ id: 'sync-1', commandId: 'sync-1', status: 'result-unknown', affectedAids: [1], targetFolderIds: ['bilibili:900', 'bilimi-logical:music'], updatedAt: '2026-07-24T01:00:00.000Z' }]
      }),
      getAccountSettings: () => ({ defaultFavoriteSystemEnabled: true, favoriteLedgers: [], updatedAt: '2026-07-24T00:00:00.000Z' }), getArchives: () => [], getTranscriptionItems: () => [],
      getWorkspaces: () => [{ id: 'raw-workspace', accountMid: '100', status: 'scanning', updatedAt: '2026-07-24T02:00:00.000Z', remoteFolderId: 'bilibili:900' }],
      getRemoteOperations: () => [{ id: 'raw-sync', accountMid: '100', status: 'result-unknown', updatedAt: '2026-07-24T02:00:00.000Z', targetFolderIds: ['bilibili:900'] }],
      applyPortableBatch: vi.fn(), applyPortableState: vi.fn(), readSharedSettings: () => ({}), writeSharedSettings: vi.fn()
    })

    const portable = await adapter.readAccount('100')

    expect(JSON.stringify(portable)).not.toContain('bilibili:900')
    expect(portable.workspaces).toEqual([expect.objectContaining({ id: 'workspace-1', updatedAt: '2026-07-24T01:00:00.000Z' })])
    expect(portable.remoteOperations).toEqual([expect.objectContaining({ id: 'sync-1', targetFolderIds: ['bilimi-logical:music'] })])
  })

  it('selects the newest canonical workspace rather than the last separately merged record', async () => {
    const applyPortableState = vi.fn()
    const adapter = createLocalDataPersistenceAdapter({
      listAccountUids: () => ['100'], getRepository: vi.fn(), getAccountSettings: () => ({}), getArchives: () => [], getTranscriptionItems: () => [],
      applyPortableBatch: vi.fn(), applyPortableState, readSharedSettings: () => ({}), writeSharedSettings: vi.fn()
    })
    const repository = createFavoriteRepositoryArchiveExport(createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-24T00:00:00.000Z' }), { generatedAt: '2026-07-24T00:00:00.000Z' })
    const workspace = (id: string, revision: number, updatedAt: string) => ({
      id, accountMid: '100', status: 'scanning', baselineRevision: revision, continuationAids: [], updatedAt,
      workspaceRef: { workspaceId: id, accountMid: '100', status: 'scanning', baselineRevision: revision, currentSegmentId: 'segment', overlayRevision: 0, journalCursor: 0, checksum: 'a'.repeat(64), updatedAt }
    })

    await adapter.writePortableState?.({ accounts: {
      '100': { repository, settings: { defaultFavoriteSystemEnabled: true, favoriteLedgers: [], updatedAt: '2026-07-24T00:00:00.000Z' }, archives: [], transcription: [], auditEvents: [], remoteOperations: [], workspaces: [workspace('newer', 2, '2026-07-24T02:00:00.000Z'), workspace('older', 1, '2026-07-24T01:00:00.000Z')] }
    }, sharedSettings: {} }, { mode: 'merge', selectedUids: ['100'] })

    expect(applyPortableState.mock.calls[0]?.[0].repositoryArchives['100'].recovery.workspace).toMatchObject({ id: 'newer', baselineRevision: 2 })
  })
})
