import { describe, expect, it } from 'vitest'
import {
  applyFavoriteRepositoryCommand,
  createAccountFavoriteRepositorySnapshot,
  createFavoriteRepositoryArchiveExportChecksum,
  createFavoriteRepositoryArchiveExport,
  restoreFavoriteRepositoryArchiveRecovery,
  isFavoriteRepositoryScanVisible,
  validateFavoriteRepositoryArchiveExport,
  deriveFavoriteRepositoryPositionState,
  isFavoriteRepositoryMetadataStale,
  mergeFavoriteRepositoryVideo,
  type FavoriteRepositoryWorkspaceRef
} from './favoriteRepository'

const WORKSPACE_CHECKSUM = 'a'.repeat(64)

function workspaceRef(overrides: Partial<FavoriteRepositoryWorkspaceRef> = {}): FavoriteRepositoryWorkspaceRef {
  return {
    workspaceId: 'workspace-1',
    accountMid: '100',
    status: 'scanning',
    baselineRevision: 0,
    currentSegmentId: '',
    overlayRevision: 0,
    journalCursor: 0,
    checksum: WORKSPACE_CHECKSUM,
    ...overrides
  }
}

describe('account favorite repository contracts', () => {
  it('restores a portable active workspace as an archive-only resumable draft', () => {
    const now = '2026-07-24T00:00:00.000Z'
    const snapshot = {
      ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now }),
      workspace: {
        id: 'workspace-1', accountMid: '100', status: 'executing' as const, baselineRevision: 7,
        continuationAids: [1], frozenSyncPlan: {
          id: 'plan-1', accountMid: '100', workspaceId: 'workspace-1', baselineRevision: 7, createdAt: now,
          operations: [{ operationKey: 'operation-1', aid: 1, kind: 'append' as const, folderIds: ['bilimi-logical:music'] }]
        },
        workspaceRef: workspaceRef({ status: 'executing', baselineRevision: 7, currentSegmentId: 'segment-1', currentStep: 'executing' })
      },
      syncRecords: [{ id: 'operation-1', commandId: 'command-1', status: 'result-unknown' as const, affectedAids: [1], updatedAt: now }]
    }

    const restored = restoreFavoriteRepositoryArchiveRecovery(createFavoriteRepositoryArchiveExport(snapshot, { generatedAt: now }))

    expect(validateFavoriteRepositoryArchiveExport(restored).recovery).toMatchObject({
      workspace: { status: 'draft', resumable: true, continuationAids: [], workspaceRef: { status: 'draft', currentStep: 'executing' } },
      syncRecords: [{ status: 'reconciliation-required', autoRetry: false }]
    })
    expect(restored.recovery?.workspace).not.toHaveProperty('frozenSyncPlan')
    expect(() => applyFavoriteRepositoryCommand(createAccountFavoriteRepositorySnapshot({ accountMid: '100', now }), {
      id: 'draft-command', accountMid: '100', issuedAt: now, type: 'set-workspace',
      payload: { id: 'workspace-1', accountMid: '100', status: 'draft', baselineRevision: 0, continuationAids: [], workspaceRef: workspaceRef() }
    } as never, now)).toThrow('Favorite repository command is invalid.')
  })

  it('keeps local desired and remote observed positions separate while deriving their state', () => {
    expect(deriveFavoriteRepositoryPositionState({
      localDesiredFolderIds: ['bilimi-logical:music'],
      remoteObservedPhysicalFolderIds: ['bilibili:1'],
      remoteObservedLogicalFolderIds: ['bilimi-logical:music']
    })).toBe('aligned')

    const snapshot = createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-23T00:00:00.000Z' })
    const result = applyFavoriteRepositoryCommand(snapshot, {
      id: 'local-intent', accountMid: '100', issuedAt: '2026-07-23T00:01:00.000Z', expectedRevision: 0,
      type: 'set-favorite-position', payload: {
        aid: 1,
        localDesiredFolderIds: ['bilimi-logical:music'],
        remoteObservedPhysicalFolderIds: ['bilibili:1'],
        remoteObservedLogicalFolderIds: ['bilimi-logical:games'],
        updatedAt: '2026-07-23T00:01:00.000Z'
      }
    }, '2026-07-23T00:01:00.000Z')

    expect(result.positions['100:1']).toMatchObject({
      localDesiredFolderIds: ['bilimi-logical:music'],
      remoteObservedLogicalFolderIds: ['bilimi-logical:games'],
      positionState: 'local-only-change'
    })
    expect(() => applyFavoriteRepositoryCommand(result, {
      id: 'stale-write', accountMid: '100', issuedAt: '2026-07-23T00:02:00.000Z', expectedRevision: 0,
      type: 'set-favorite-position', payload: {
        aid: 1, localDesiredFolderIds: [], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [],
        updatedAt: '2026-07-23T00:02:00.000Z'
      }
    }, '2026-07-23T00:02:00.000Z')).toThrow('Favorite repository revision mismatch.')
  })

  it('projects only unmatched local intent into the inbox without treating protection as a placement', () => {
    const snapshot = {
      ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-23T00:00:00.000Z' }),
      memberships: { 'local:inbox': [1] },
      organizationRecords: [{ accountMid: '100', aid: 1, targetFolderIds: ['legacy'], completedAt: '2026-07-23T00:00:00.000Z' }]
    }
    const classified = applyFavoriteRepositoryCommand(snapshot, {
      id: 'classify', accountMid: '100', issuedAt: '2026-07-23T00:01:00.000Z', type: 'set-favorite-position',
      payload: { aid: 1, localDesiredFolderIds: ['bilimi-logical:music'], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], updatedAt: '2026-07-23T00:01:00.000Z' }
    }, '2026-07-23T00:01:00.000Z')
    const unmatched = applyFavoriteRepositoryCommand(classified, {
      id: 'unclassify', accountMid: '100', issuedAt: '2026-07-23T00:02:00.000Z', type: 'set-favorite-position',
      payload: { aid: 1, localDesiredFolderIds: [], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], updatedAt: '2026-07-23T00:02:00.000Z' }
    }, '2026-07-23T00:02:00.000Z')

    expect(classified.memberships['local:inbox']).toEqual([])
    expect(unmatched.memberships['local:inbox']).toEqual([1])
  })

  it('atomically projects final local positions without changing raw Bilibili source memberships', () => {
    const snapshot = {
      ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-23T00:00:00.000Z' }),
      memberships: {
        'local:inbox': [1],
        'local:music': [1],
        'bilimi-logical:games': [1],
        'bilibili:source': [1]
      }
    }
    const moved = applyFavoriteRepositoryCommand(snapshot, {
      id: 'move', accountMid: '100', issuedAt: '2026-07-23T00:01:00.000Z', type: 'set-favorite-position',
      payload: {
        aid: 1, localDesiredFolderIds: ['local:knowledge', 'bilimi-logical:music'],
        remoteObservedPhysicalFolderIds: ['bilibili:source'], remoteObservedLogicalFolderIds: [],
        updatedAt: '2026-07-23T00:01:00.000Z'
      }
    }, '2026-07-23T00:01:00.000Z')
    const unmatched = applyFavoriteRepositoryCommand(moved, {
      id: 'empty', accountMid: '100', issuedAt: '2026-07-23T00:02:00.000Z', type: 'set-favorite-position',
      payload: {
        aid: 1, localDesiredFolderIds: [], remoteObservedPhysicalFolderIds: ['bilibili:source'],
        remoteObservedLogicalFolderIds: [], updatedAt: '2026-07-23T00:02:00.000Z'
      }
    }, '2026-07-23T00:02:00.000Z')

    expect(moved.memberships).toMatchObject({
      'local:inbox': [], 'local:music': [], 'bilimi-logical:games': [],
      'local:knowledge': [1], 'bilimi-logical:music': [1], 'bilibili:source': [1]
    })
    expect(unmatched.memberships).toMatchObject({
      'local:knowledge': [], 'bilimi-logical:music': [], 'local:inbox': [1], 'bilibili:source': [1]
    })
  })

  it('keeps complete metadata when a scan supplies a Video + ID placeholder', () => {
    const merged = mergeFavoriteRepositoryVideo(
      { aid: 1, title: 'Complete title', author: 'Creator', description: 'Description', tags: ['tag'], coverUrl: 'cover', updatedAt: '2026-07-23T00:00:00.000Z' },
      { aid: 1, title: 'Video + ID', tags: [], updatedAt: '2026-07-23T00:01:00.000Z' }
    )

    expect(merged).toMatchObject({ title: 'Complete title', author: 'Creator', description: 'Description', tags: ['tag'], coverUrl: 'cover' })
    expect(isFavoriteRepositoryMetadataStale({ aid: 2, title: 'Video + ID', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' })).toBe(true)
  })

  it('keeps complete metadata when a scan supplies the real numeric Video placeholder format', () => {
    const merged = mergeFavoriteRepositoryVideo(
      { aid: 116953603638658, title: '完整标题', author: '原 UP', description: '完整简介', tags: ['生活'], coverUrl: 'cover', updatedAt: '2026-07-23T00:00:00.000Z' },
      { aid: 116953603638658, title: 'Video 116953603638658', tags: [], updatedAt: '2026-07-23T00:01:00.000Z' }
    )

    expect(merged).toMatchObject({ title: '完整标题', author: '原 UP', description: '完整简介', tags: ['生活'], coverUrl: 'cover' })
    expect(isFavoriteRepositoryMetadataStale({ aid: 116953603638658, title: 'Video 116953603638658', author: '小瑕爱小盘', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' })).toBe(true)
  })

  it('exports archive records without credentials and with a stable checksum', () => {
    const exported = {
      version: 1 as const,
      accountMid: '100',
      generatedAt: '2026-07-23T00:00:00.000Z',
      archives: [{ aid: 1, archiveId: 'archive-1', registeredAt: '2026-07-23T00:00:00.000Z' }]
    }
    expect(createFavoriteRepositoryArchiveExportChecksum(exported)).toMatch(/^[a-f0-9]{64}$/)
    expect(createFavoriteRepositoryArchiveExportChecksum({ ...exported, credentials: 'not allowed' } as unknown as typeof exported)).toBe(
      createFavoriteRepositoryArchiveExportChecksum(exported)
    )
  })

  it('commits multiple final local placements atomically without changing Bilibili sources', () => {
    const snapshot = {
      ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-23T00:00:00.000Z' }),
      memberships: { 'local:inbox': [1, 2], 'bilibili:source': [1, 2] }
    }
    const result = applyFavoriteRepositoryCommand(snapshot, {
      id: 'batch-placement', accountMid: '100', issuedAt: '2026-07-23T00:01:00.000Z', expectedRevision: 0,
      type: 'set-favorite-placements', payload: {
        placements: [
          { aid: 1, localDesiredFolderIds: ['bilimi-logical:music'], remoteObservedPhysicalFolderIds: ['remote-1'], remoteObservedLogicalFolderIds: ['bilimi-logical:music'], updatedAt: '2026-07-23T00:01:00.000Z' },
          { aid: 2, localDesiredFolderIds: [], remoteObservedPhysicalFolderIds: ['remote-2'], remoteObservedLogicalFolderIds: [], updatedAt: '2026-07-23T00:01:00.000Z' }
        ]
      }
    }, '2026-07-23T00:01:00.000Z')

    expect(result.revision).toBe(1)
    expect(result.memberships).toMatchObject({ 'bilimi-logical:music': [1], 'local:inbox': [2], 'bilibili:source': [1, 2] })
    expect(result.affectedAids).toEqual([1, 2])
  })

  it('accepts a bounded 257-video remote observation repair in one revision', () => {
    const now = '2026-07-23T00:00:00.000Z'
    const snapshot = createAccountFavoriteRepositorySnapshot({ accountMid: '100', now })

    const repaired = applyFavoriteRepositoryCommand(snapshot, {
      id: 'repair-257', accountMid: '100', issuedAt: now, expectedRevision: 0,
      type: 'set-favorite-placements', payload: {
        placements: Array.from({ length: 257 }, (_, index) => ({
          aid: index + 1,
          localDesiredFolderIds: [],
          remoteObservedPhysicalFolderIds: ['remote-creative'],
          remoteObservedLogicalFolderIds: ['bilimi-logical:creative-aesthetic'],
          updatedAt: now
        }))
      }
    }, now)

    expect(repaired.revision).toBe(1)
    expect(repaired.positions['100:257']).toMatchObject({
      remoteObservedLogicalFolderIds: ['bilimi-logical:creative-aesthetic']
    })
  })

  it('tombstones a local record without deleting its observed Bilibili source or protection evidence, and prevents scan rediscovery', () => {
    const snapshot = {
      ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-23T00:00:00.000Z' }),
      videos: { '1': { aid: 1, title: 'Keep remote', tags: [], updatedAt: '2026-07-23T00:00:00.000Z' } },
      memberships: { 'local:inbox': [1], 'bilimi-logical:music': [1], 'bilibili:source': [1] },
      organizationRecords: [{ accountMid: '100', aid: 1, targetFolderIds: ['remote-music'], completedAt: '2026-07-23T00:00:00.000Z' }]
    }
    const deleted = applyFavoriteRepositoryCommand(snapshot, {
      id: 'delete-local', accountMid: '100', issuedAt: '2026-07-23T00:01:00.000Z', type: 'delete-favorite-from-library',
      payload: { aid: 1, deletedAt: '2026-07-23T00:01:00.000Z', reason: 'user' }
    }, '2026-07-23T00:01:00.000Z')
    expect(deleted.videos['1']).toBeUndefined()
    expect(deleted.memberships).toMatchObject({ 'local:inbox': [], 'bilimi-logical:music': [], 'bilibili:source': [1] })
    expect(deleted.organizationRecords).toEqual(snapshot.organizationRecords)
    expect(isFavoriteRepositoryScanVisible(deleted, 1)).toBe(false)

    const restored = applyFavoriteRepositoryCommand(deleted, {
      id: 'restore-local', accountMid: '100', issuedAt: '2026-07-23T00:02:00.000Z', type: 'restore-favorite-to-library', payload: { aid: 1 }
    }, '2026-07-23T00:02:00.000Z')
    expect(isFavoriteRepositoryScanVisible(restored, 1)).toBe(true)
    expect(restored.organizationRecords).toEqual(snapshot.organizationRecords)
  })

  it('does not let a hard tombstone be recreated by a later Bilibili mirror scan', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-24T00:00:00.000Z' })
    const deleted = applyFavoriteRepositoryCommand(snapshot, {
      id: 'delete-1', accountMid: '100', issuedAt: '2026-07-24T00:00:01.000Z', type: 'tombstone-favorite-video',
      payload: { aid: 1, deletedAt: '2026-07-24T00:00:01.000Z', allowRediscovery: false }
    }, '2026-07-24T00:00:01.000Z')

    const scanned = applyFavoriteRepositoryCommand(deleted, {
      id: 'mirror-after-delete', accountMid: '100', issuedAt: '2026-07-24T00:00:02.000Z', type: 'record-bilibili-mirror',
      payload: {
        workspaceId: 'scan-1',
        folders: [{ id: 'bilibili:1', title: 'Bilibili', remoteFolderId: '1' }], memberAidsByFolderId: { 'bilibili:1': [1] },
        videos: [{ aid: 1, title: 'must stay deleted', tags: [], updatedAt: '2026-07-24T00:00:02.000Z' }]
      }
    }, '2026-07-24T00:00:02.000Z')

    expect(scanned.videos['1']).toBeUndefined()
    expect(scanned.memberships['bilibili:1']).toEqual([])
  })

  it('creates and validates a credential-free portable archive with a stable checksum', () => {
    const snapshot = {
      ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-23T00:00:00.000Z' }),
      videos: { '1': { aid: 1, title: 'Title', author: 'UP', tags: ['tag'], updatedAt: '2026-07-23T00:00:00.000Z' } },
      positions: {
        '100:1': { accountMid: '100', aid: 1, localDesiredFolderIds: ['bilimi-logical:music'], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], positionState: 'local-only-change' as const, updatedAt: '2026-07-23T00:00:00.000Z', revision: 1 }
      },
      organizationRecords: [{ accountMid: '100', aid: 1, targetFolderIds: ['legacy'], completedAt: '2026-07-23T00:00:00.000Z' }]
    }
    const exported = createFavoriteRepositoryArchiveExport(snapshot, {
      generatedAt: '2026-07-23T01:00:00.000Z',
      events: [{ id: 'event-1', sequence: 1, accountMid: '100', aid: 1, kind: 'manual-move', occurredAt: '2026-07-23T00:30:00.000Z' }],
      archives: [{ aid: 1, archiveId: 'archive-1', registeredAt: '2026-07-23T00:40:00.000Z' }]
    })
    expect(exported.checksum).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(exported)).not.toContain('credential')
    expect(validateFavoriteRepositoryArchiveExport(exported)).toEqual(exported)
    expect(() => validateFavoriteRepositoryArchiveExport({ ...exported, checksum: '0'.repeat(64) })).toThrow('checksum')
  })

  it('rejects archive positions outside Bilimi logical ledgers and cross-account events', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-23T00:00:00.000Z' })
    const valid = createFavoriteRepositoryArchiveExport(snapshot, {
      generatedAt: '2026-07-23T01:00:00.000Z',
      events: [{ id: 'event-1', sequence: 1, accountMid: '100', aid: 1, kind: 'manual-move', occurredAt: '2026-07-23T00:30:00.000Z' }]
    })
    const withChecksum = <T extends Record<string, unknown>>(value: T) => ({
      ...value,
      checksum: createFavoriteRepositoryArchiveExportChecksum(value as unknown as typeof valid)
    })

    for (const folderId of ['local:music', 'bilibili:123', 'ordinary-folder', 'bilimi-logical:']) {
      const invalid = withChecksum({
        ...valid,
        positions: [{ accountMid: '100', aid: 1, localDesiredFolderIds: [folderId], positionState: 'local-only-change', updatedAt: '2026-07-23T00:00:00.000Z' }]
      })
      expect(() => validateFavoriteRepositoryArchiveExport(invalid)).toThrow('invalid')
    }

    const crossAccountEvent = withChecksum({
      ...valid,
      events: [{ ...valid.events![0], accountMid: '200' }]
    })
    expect(() => validateFavoriteRepositoryArchiveExport(crossAccountEvent)).toThrow('invalid')
  })

  it('exports only portable Bilimi logical placement intent from mixed local repository positions', () => {
    const exported = createFavoriteRepositoryArchiveExport({
      ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-23T00:00:00.000Z' }),
      positions: {
        '100:1': { accountMid: '100', aid: 1, localDesiredFolderIds: ['local:personal', 'bilimi-logical:music'], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], positionState: 'local-only-change', updatedAt: '2026-07-23T00:00:00.000Z', revision: 1 }
      }
    }, { generatedAt: '2026-07-23T01:00:00.000Z' })

    expect(exported.positions).toEqual([expect.objectContaining({ localDesiredFolderIds: ['bilimi-logical:music'] })])
    expect(validateFavoriteRepositoryArchiveExport(exported)).toEqual(exported)
  })

  it('sanitizes recovery bindings into local reconciliation intent', () => {
    const exported = createFavoriteRepositoryArchiveExport({
      ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-23T00:00:00.000Z' }),
      folders: [
        { id: 'bilimi-logical:music', title: 'Music', kind: 'bilimi-logical' as const, logicalLedgerId: 'music', remoteFolderId: '900', syncState: 'bound' as const },
        { id: 'bilibili:900', title: 'Device mirror', kind: 'bilibili' as const, remoteFolderId: '900', syncState: 'bound' as const }
      ],
      physicalShards: [{ logicalLedgerId: 'music', folderId: 'bilimi-logical:music', shardNumber: 1, remoteTitle: 'Music 1', bindingState: 'bound' as const, remoteFolderId: '900', knownRemoteFolderIds: ['900'], remoteMemberCount: 12 }]
    }, { generatedAt: '2026-07-23T01:00:00.000Z' })

    expect(exported.recovery?.folders).toEqual([{ id: 'bilimi-logical:music', title: 'Music', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'pending-reconcile' }])
    expect(exported.recovery?.physicalShards).toEqual([{ logicalLedgerId: 'music', folderId: 'bilimi-logical:music', shardNumber: 1, remoteTitle: 'Music 1', bindingState: 'pending-reconcile' }])
  })

  it('removes remote observations from every portable recovery record', () => {
    const snapshot = {
      ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-23T00:00:00.000Z' }),
      workspace: { id: 'workspace-1', accountMid: '100', status: 'frozen' as const, baselineRevision: 0, continuationAids: [], workspaceRef: workspaceRef({ status: 'frozen' }), frozenSyncPlan: { id: 'plan-1', accountMid: '100', workspaceId: 'workspace-1', baselineRevision: 0, createdAt: '2026-07-23T00:00:00.000Z', operations: [{ operationKey: 'op-1', aid: 1, kind: 'append' as const, folderIds: ['bilimi-logical:music'], beforeFolderIds: ['physical-900'] }] } },
      syncRecords: [{ id: 'sync-1', commandId: 'command-1', status: 'result-unknown' as const, affectedAids: [1], targetFolderIds: ['physical-900', 'bilimi-logical:music'], updatedAt: '2026-07-23T00:00:00.000Z' }],
      organizationRecords: [{ accountMid: '100', aid: 1, targetFolderIds: ['physical-900', 'bilimi-logical:music'], completedAt: '2026-07-23T00:00:00.000Z' }],
      organizationBatches: [{ id: 'change-1', runId: 'run-1', workspaceId: 'workspace-1', accountMid: '100', aid: 1, beforeFolderIds: ['physical-900'], afterFolderIds: ['physical-901'], addedFolderIds: ['physical-901'], removedFolderIds: ['physical-900'], status: 'result-unknown' as const, recordedAt: '2026-07-23T00:00:00.000Z' }]
    }
    const exported = createFavoriteRepositoryArchiveExport(snapshot, { generatedAt: '2026-07-23T01:00:00.000Z' })

    expect(JSON.stringify(exported)).not.toContain('physical-')
    expect(exported.recovery?.workspace?.frozenSyncPlan?.operations[0]).not.toHaveProperty('beforeFolderIds')
    expect(validateFavoriteRepositoryArchiveExport(exported)).toEqual(exported)
  })

  it('rejects nested recovery bindings before they can be imported or checksummed as portable', () => {
    const valid = createFavoriteRepositoryArchiveExport(createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-24T00:00:00.000Z' }), { generatedAt: '2026-07-24T00:00:00.000Z' })
    const invalid = {
      ...valid,
      recovery: {
        ...valid.recovery!,
        syncRecords: [{ id: 'sync-1', commandId: 'sync-1', status: 'result-unknown', affectedAids: [1], updatedAt: '2026-07-24T00:00:00.000Z', targetFolderIds: ['bilibili:900'] }],
        organizationRecords: [{ accountMid: '100', aid: 1, targetFolderIds: ['bilibili:900'], completedAt: '2026-07-24T00:00:00.000Z' }],
        workspace: {
          id: 'workspace-1', accountMid: '100', status: 'frozen', baselineRevision: 0, continuationAids: [],
          workspaceRef: { workspaceId: 'workspace-1', accountMid: '100', status: 'frozen', baselineRevision: 0, currentSegmentId: 'segment', overlayRevision: 0, journalCursor: 0, checksum: 'a'.repeat(64), updatedAt: '2026-07-24T00:00:00.000Z' },
          frozenSyncPlan: { id: 'plan-1', accountMid: '100', workspaceId: 'workspace-1', baselineRevision: 0, createdAt: '2026-07-24T00:00:00.000Z', operations: [{ operationKey: 'op-1', aid: 1, kind: 'append', folderIds: ['bilimi-logical:music'], beforeFolderIds: ['bilibili:900'] }] }
        }
      }
    }
    invalid.checksum = createFavoriteRepositoryArchiveExportChecksum(invalid)

    expect(() => validateFavoriteRepositoryArchiveExport(invalid)).toThrow('invalid')
  })

  it('rejects unknown physical binding fields nested in recovery workspace and sync records', () => {
    const valid = createFavoriteRepositoryArchiveExport(createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-24T00:00:00.000Z' }), { generatedAt: '2026-07-24T00:00:00.000Z' })
    const invalid = {
      ...valid,
      recovery: {
        ...valid.recovery!,
        syncRecords: [{ id: 'sync-1', commandId: 'sync-1', status: 'result-unknown', affectedAids: [1], updatedAt: '2026-07-24T00:00:00.000Z', remoteFolderId: '900' }],
        workspace: {
          id: 'workspace-1', accountMid: '100', status: 'scanning', baselineRevision: 0, continuationAids: [], remoteObservedPhysicalFolderIds: ['900'],
          workspaceRef: { workspaceId: 'workspace-1', accountMid: '100', status: 'scanning', baselineRevision: 0, currentSegmentId: 'segment', overlayRevision: 0, journalCursor: 0, checksum: 'a'.repeat(64), updatedAt: '2026-07-24T00:00:00.000Z' }
        }
      }
    }
    invalid.checksum = createFavoriteRepositoryArchiveExportChecksum(invalid)

    expect(() => validateFavoriteRepositoryArchiveExport(invalid)).toThrow('invalid')
  })

  it('round-trips account-local repository recovery state while excluding remote observations', () => {
    const snapshot = {
      ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-23T00:00:00.000Z' }),
      folders: [{ id: 'bilimi-logical:music', title: 'Music', kind: 'bilimi-logical' as const, logicalLedgerId: 'music', syncState: 'bound' as const }, { id: 'bilimi:music:001', title: 'Music 1', kind: 'bilibili' as const, remoteFolderId: '42', syncState: 'bound' as const }],
      memberships: { 'bilimi-logical:music': [1], 'bilimi:music:001': [1] },
      physicalShards: [{ logicalLedgerId: 'music', folderId: 'bilimi:music:001', shardNumber: 1, remoteFolderId: '42', remoteTitle: 'Music', bindingState: 'bound' as const }],
      workspace: { id: 'workspace-1', accountMid: '100', status: 'scanning' as const, baselineRevision: 0, continuationAids: [], workspaceRef: workspaceRef() },
      syncRecords: [{ id: 'sync-1', commandId: 'command-1', status: 'result-unknown' as const, affectedAids: [1], updatedAt: '2026-07-23T00:00:00.000Z' }],
      organizationRecords: [{ accountMid: '100', aid: 1, targetFolderIds: ['42'], completedAt: '2026-07-23T00:00:00.000Z' }],
      organizationBatches: [{ id: 'change-1', runId: 'run-1', workspaceId: 'workspace-1', accountMid: '100', aid: 1, beforeFolderIds: [], afterFolderIds: ['42'], addedFolderIds: ['42'], removedFolderIds: [], status: 'result-unknown' as const, recordedAt: '2026-07-23T00:00:00.000Z' }],
      tombstones: { '100:2': { accountMid: '100', aid: 2, deletedAt: '2026-07-23T00:00:00.000Z', allowRediscovery: false } },
      positions: { '100:1': { accountMid: '100', aid: 1, localDesiredFolderIds: ['bilimi-logical:music'], remoteObservedPhysicalFolderIds: ['remote-private'], remoteObservedLogicalFolderIds: ['bilimi-logical:music'], positionState: 'aligned' as const, updatedAt: '2026-07-23T00:00:00.000Z', revision: 1 } }
    }
    const exported = createFavoriteRepositoryArchiveExport(snapshot, { generatedAt: '2026-07-23T01:00:00.000Z' })

    expect(exported.recovery).toMatchObject({
      folders: [{ id: 'bilimi-logical:music', syncState: 'pending-reconcile' }],
      memberships: { 'bilimi-logical:music': [1] }, physicalShards: [], workspace: snapshot.workspace,
      syncRecords: snapshot.syncRecords, tombstones: [snapshot.tombstones['100:2']]
    })
    expect(exported.positions).toEqual([expect.objectContaining({ localDesiredFolderIds: ['bilimi-logical:music'] })])
    expect(JSON.stringify(exported)).not.toContain('remote-private')
    expect(validateFavoriteRepositoryArchiveExport(exported)).toEqual(exported)
  })

  it('rejects a command for another account before changing the snapshot', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({
      accountMid: '100',
      now: '2026-07-19T00:00:00.000Z'
    })

    expect(() => applyFavoriteRepositoryCommand(snapshot, {
      id: 'command-1',
      accountMid: '200',
      issuedAt: '2026-07-19T00:00:01.000Z',
      type: 'commit-local-plan',
      payload: { workspaceId: 'workspace-1', memberAidsByFolderId: {} }
    }, '2026-07-19T00:00:01.000Z')).toThrow('Favorite repository account mismatch.')

    expect(snapshot.revision).toBe(0)
  })

  it('advances the revision once for an account-scoped local plan command', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({
      accountMid: '100',
      now: '2026-07-19T00:00:00.000Z'
    })

    const result = applyFavoriteRepositoryCommand(snapshot, {
      id: 'command-1',
      accountMid: '100',
      issuedAt: '2026-07-19T00:00:01.000Z',
      type: 'commit-local-plan',
      payload: {
        workspaceId: 'workspace-1',
        memberAidsByFolderId: { 'local:inbox': [1, 2] }
      }
    }, '2026-07-19T00:00:01.000Z')

    expect(result).toMatchObject({ accountMid: '100', revision: 1 })
    expect(result.updatedAt).toBe('2026-07-19T00:00:01.000Z')
    expect(result.affectedFolderIds).toEqual(['local:inbox'])
    expect(result.affectedAids).toEqual([1, 2])
  })

  it('creates local library folders and their members in one local-only plan', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({
      accountMid: '100', now: '2026-07-20T00:00:00.000Z'
    })

    const result = applyFavoriteRepositoryCommand(snapshot, {
      id: 'local-plan', accountMid: '100', issuedAt: '2026-07-20T00:00:01.000Z', type: 'commit-local-plan',
      payload: {
        workspaceId: 'workspace-1',
        memberAidsByFolderId: { 'local:music': [1, 2] },
        folders: [{ id: 'local:music', title: 'Music', kind: 'local', syncState: 'local-only' }]
      }
    }, '2026-07-20T00:00:01.000Z')

    expect(result.folders).toContainEqual({ id: 'local:music', title: 'Music', kind: 'local', syncState: 'local-only' })
    expect(result.memberships['local:music']).toEqual([1, 2])
  })

  it('removes formally classified or protected videos from the local inbox without removing unmatched videos', () => {
    const snapshot = {
      ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-23T00:00:00.000Z' }),
      memberships: { 'local:inbox': [1, 2, 3] }
    }

    const locallyClassified = applyFavoriteRepositoryCommand(snapshot, {
      id: 'classify-local', accountMid: '100', issuedAt: '2026-07-23T00:01:00.000Z', type: 'commit-local-plan',
      payload: {
        workspaceId: 'workspace-1',
        memberAidsByFolderId: { 'local:music': [1] },
        organizationRecords: [{ accountMid: '100', aid: 2, targetFolderIds: ['remote-music'], completedAt: '2026-07-23T00:01:00.000Z' }]
      }
    }, '2026-07-23T00:01:00.000Z')

    expect(locallyClassified.memberships).toMatchObject({ 'local:inbox': [3], 'local:music': [1] })
    expect(locallyClassified.organizationRecords).toEqual([expect.objectContaining({ aid: 2 })])
  })

  it('stores local-plan video records with their local membership indexes', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({
      accountMid: '100', now: '2026-07-20T00:00:00.000Z'
    })

    const result = applyFavoriteRepositoryCommand(snapshot, {
      id: 'local-plan-with-video', accountMid: '100', issuedAt: '2026-07-20T00:00:01.000Z', type: 'commit-local-plan',
      payload: {
        workspaceId: 'workspace-1',
        memberAidsByFolderId: { 'local:music': [1] },
        videos: [{ aid: 1, title: 'Saved locally', author: 'UP', tags: [], updatedAt: '2026-07-20T00:00:01.000Z' }]
      }
    }, '2026-07-20T00:00:01.000Z')

    expect(result.videos['1']).toMatchObject({ aid: 1, title: 'Saved locally', author: 'UP' })
    expect(result.memberships['local:music']).toEqual([1])
  })

  it('clears every local repository namespace for an explicit full reset', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-20T00:00:00.000Z' })
    const seeded = applyFavoriteRepositoryCommand(snapshot, {
      id: 'seed', accountMid: '100', issuedAt: '2026-07-20T00:00:01.000Z', type: 'commit-local-plan',
      payload: { workspaceId: 'workspace-1', memberAidsByFolderId: { 'local:inbox': [1] },
        folders: [{ id: 'local:inbox', title: 'Inbox', kind: 'local', syncState: 'local-only' }],
        videos: [{ aid: 1, title: 'Stale', tags: [], updatedAt: '2026-07-20T00:00:01.000Z' }] }
    }, '2026-07-20T00:00:01.000Z')
    const tombstoned = applyFavoriteRepositoryCommand(seeded, {
      id: 'delete-before-reset', accountMid: '100', issuedAt: '2026-07-20T00:00:02.000Z', type: 'delete-favorite-from-library',
      payload: { aid: 1, deletedAt: '2026-07-20T00:00:02.000Z', reason: 'user-delete' }
    }, '2026-07-20T00:00:02.000Z')
    const reset = applyFavoriteRepositoryCommand(tombstoned, {
      id: 'reset', accountMid: '100', issuedAt: '2026-07-20T00:00:03.000Z', type: 'clear-local-repository', payload: {}
    }, '2026-07-20T00:00:03.000Z')

    expect(reset).toMatchObject({ videos: {}, libraryMirrors: {}, folders: [], memberships: {}, physicalShards: [], syncRecords: [], organizationRecords: [], tombstones: {} })
    expect(isFavoriteRepositoryScanVisible(reset, 1)).toBe(true)
    expect(reset.workspace).toBeUndefined()
  })

  it('replaces only the Bilibili mirror namespace on a later source scan', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-20T00:00:00.000Z' })
    const first = applyFavoriteRepositoryCommand(snapshot, {
      id: 'mirror-1', accountMid: '100', issuedAt: '2026-07-20T00:00:01.000Z', type: 'record-bilibili-mirror',
      payload: {
        workspaceId: 'workspace-1',
        memberAidsByFolderId: { 'bilibili:old': [1], 'bilibili:keep': [2] },
        folders: [
          { id: 'bilibili:old', title: '已删除收藏夹', remoteFolderId: 'old' },
          { id: 'bilibili:keep', title: '保留收藏夹', remoteFolderId: 'keep' }
        ],
        videos: [
          { aid: 1, title: '过期视频', tags: [], updatedAt: '2026-07-20T00:00:01.000Z' },
          { aid: 2, title: '保留视频', tags: [], updatedAt: '2026-07-20T00:00:01.000Z' }
        ]
      }
    }, '2026-07-20T00:00:01.000Z')

    const second = applyFavoriteRepositoryCommand(first, {
      id: 'mirror-2', accountMid: '100', issuedAt: '2026-07-20T00:00:02.000Z', type: 'record-bilibili-mirror',
      payload: {
        workspaceId: 'workspace-2', memberAidsByFolderId: { 'bilibili:keep': [2] },
        folders: [{ id: 'bilibili:keep', title: '保留收藏夹', remoteFolderId: 'keep' }],
        videos: [{ aid: 2, title: '保留视频', tags: [], updatedAt: '2026-07-20T00:00:02.000Z' }]
      }
    }, '2026-07-20T00:00:02.000Z')

    expect(second.folders.map((folder) => folder.id)).toEqual(['bilibili:keep'])
    expect(second.memberships).toEqual({ 'bilibili:keep': [2] })
    expect(second.videos).not.toHaveProperty('1')
  })

  it('keeps rich existing metadata when a sparse Bilibili scan refreshes a video', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-20T00:00:00.000Z' })
    const rich = applyFavoriteRepositoryCommand(snapshot, {
      id: 'rich-video', accountMid: '100', issuedAt: '2026-07-20T00:00:01.000Z', type: 'upsert-video',
      payload: { aid: 1, title: '旧标题', author: '原 UP', description: '完整简介', tags: ['音乐'], updatedAt: '2026-07-19T00:00:00.000Z' }
    }, '2026-07-20T00:00:01.000Z')

    const mirrored = applyFavoriteRepositoryCommand(rich, {
      id: 'sparse-mirror', accountMid: '100', issuedAt: '2026-07-20T00:00:02.000Z', type: 'record-bilibili-mirror',
      payload: {
        workspaceId: 'workspace-1', memberAidsByFolderId: { 'bilibili:source': [1] },
        folders: [{ id: 'bilibili:source', title: '来源', remoteFolderId: 'source' }],
        videos: [{ aid: 1, title: '扫描标题', tags: [], updatedAt: '2026-07-20T00:00:02.000Z' }]
      }
    }, '2026-07-20T00:00:02.000Z')

    expect(mirrored.videos['1']).toEqual({
      aid: 1, title: '扫描标题', author: '原 UP', description: '完整简介', tags: ['音乐'], updatedAt: '2026-07-19T00:00:00.000Z'
    })
  })

  it('uses one positive account identity despite leading zeroes', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({
      accountMid: '00100',
      now: '2026-07-19T00:00:00.000Z'
    })

    expect(snapshot.accountMid).toBe('100')
    expect(() => createAccountFavoriteRepositorySnapshot({
      accountMid: '0',
      now: '2026-07-19T00:00:00.000Z'
    })).toThrow('Favorite repository account is invalid.')
    expect(() => createAccountFavoriteRepositorySnapshot({
      accountMid: '100',
      now: 'not-a-date'
    })).toThrow('Favorite repository timestamp is invalid.')
  })

  it('merges trimmed folder ids without dropping their member aids', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({
      accountMid: '100',
      now: '2026-07-19T00:00:00.000Z'
    })

    const result = applyFavoriteRepositoryCommand(snapshot, {
      id: 'command-1',
      accountMid: '100',
      issuedAt: '2026-07-19T00:00:01.000Z',
      type: 'commit-local-plan',
      payload: {
        workspaceId: 'workspace-1',
        memberAidsByFolderId: { ' local:inbox ': [1], 'local:inbox': [2, 1] }
      }
    }, '2026-07-19T00:00:01.000Z')

    expect(result.affectedFolderIds).toEqual(['local:inbox'])
    expect(result.affectedAids).toEqual([1, 2])
  })

  it('adds local-plan members without replacing existing local members', () => {
    const snapshot = {
      ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-19T00:00:00.000Z' }),
      memberships: { 'local:music': [9] }
    }

    const result = applyFavoriteRepositoryCommand(snapshot, {
      id: 'add-local-member', accountMid: '100', issuedAt: '2026-07-19T00:00:01.000Z', type: 'commit-local-plan',
      payload: { workspaceId: 'workspace-1', memberAidsByFolderId: { 'local:music': [1] } }
    }, '2026-07-19T00:00:01.000Z')

    expect(result.memberships['local:music']).toEqual([1, 9])
  })

  it('merges multiple completed formal targets for the same protected aid', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({
      accountMid: '100', now: '2026-07-20T00:00:00.000Z'
    })

    const result = applyFavoriteRepositoryCommand(snapshot, {
      id: 'protections', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'record-organization-protections',
      payload: { records: [
        { accountMid: '100', aid: 1, targetFolderIds: ['remote-music'], completedAt: '2026-07-20T00:00:00.000Z' },
        { accountMid: '100', aid: 1, targetFolderIds: ['remote-knowledge'], completedAt: '2026-07-20T00:00:00.000Z' }
      ] }
    }, '2026-07-20T00:00:00.000Z')

    expect(result.organizationRecords).toEqual([
      expect.objectContaining({ aid: 1, targetFolderIds: ['remote-knowledge', 'remote-music'] })
    ])
  })

  it('retains account-scoped local deletion tombstones while a full rescan clears repository projections', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-20T00:00:00.000Z' })
    const deleted = applyFavoriteRepositoryCommand(snapshot, {
      id: 'delete-local', accountMid: '100', issuedAt: '2026-07-20T00:00:01.000Z', type: 'delete-favorite-from-library', payload: { aid: 7, deletedAt: '2026-07-20T00:00:01.000Z' }
    }, '2026-07-20T00:00:01.000Z')

    const reset = applyFavoriteRepositoryCommand(deleted, {
      id: 'rescan-reset', accountMid: '100', issuedAt: '2026-07-20T00:00:02.000Z', type: 'clear-local-repository', payload: { preserveTombstones: true }
    }, '2026-07-20T00:00:02.000Z')

    expect(reset.tombstones['100:7']).toMatchObject({ aid: 7, allowRediscovery: false })
  })

  it('removes a deleted shard binding while retaining local videos and other formal protection targets', () => {
    const snapshot = {
      ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-20T00:00:00.000Z' }),
      videos: { '1': { aid: 1, title: 'Kept local', tags: [], updatedAt: '2026-07-20T00:00:00.000Z' } },
      memberships: { 'bilimi:music:001': [1], 'bilimi:knowledge:001': [1] },
      physicalShards: [
        { logicalLedgerId: 'music', folderId: 'bilimi:music:001', shardNumber: 1, remoteFolderId: 'remote-music', remoteTitle: 'Music', bindingState: 'bound' as const },
        { logicalLedgerId: 'knowledge', folderId: 'bilimi:knowledge:001', shardNumber: 1, remoteFolderId: 'remote-knowledge', remoteTitle: 'Knowledge', bindingState: 'bound' as const }
      ],
      organizationRecords: [{ accountMid: '100', aid: 1, targetFolderIds: ['remote-knowledge', 'remote-music'], completedAt: '2026-07-20T00:00:00.000Z' }]
    }

    const result = applyFavoriteRepositoryCommand(snapshot, {
      id: 'delete-music', accountMid: '100', issuedAt: '2026-07-20T00:01:00.000Z', type: 'remove-physical-shard-binding',
      payload: { remoteFolderId: 'remote-music' }
    }, '2026-07-20T00:01:00.000Z')

    expect(result.videos['1']).toMatchObject({ title: 'Kept local' })
    expect(result.organizationRecords).toEqual([expect.objectContaining({ targetFolderIds: ['remote-knowledge'] })])
    expect(result.physicalShards).toEqual([expect.objectContaining({ remoteFolderId: 'remote-knowledge' })])
  })

  it('keeps each organization recovery record immutable and projects a confirmed remove from logical membership', () => {
    const snapshot = {
      ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-20T00:00:00.000Z' }),
      memberships: { 'bilimi:music:001': [1], 'bilimi-logical:music': [1] },
      physicalShards: [{ logicalLedgerId: 'music', folderId: 'bilimi:music:001', shardNumber: 1, remoteFolderId: 'remote-music', remoteTitle: 'Music', bindingState: 'bound' as const }]
    }
    const first = applyFavoriteRepositoryCommand(snapshot, {
      id: 'change-1', accountMid: '100', issuedAt: '2026-07-20T00:00:01.000Z', type: 'record-organization-change',
      payload: { change: {
        id: 'run-1:remove-1:succeeded', runId: 'run-1', workspaceId: 'workspace-1', accountMid: '100', aid: 1,
        beforeFolderIds: ['remote-music'], afterFolderIds: [], addedFolderIds: [], removedFolderIds: ['remote-music'],
        status: 'succeeded', recordedAt: '2026-07-20T00:00:01.000Z'
      } }
    }, '2026-07-20T00:00:01.000Z')
    const second = applyFavoriteRepositoryCommand(first, {
      id: 'change-2', accountMid: '100', issuedAt: '2026-07-20T00:00:02.000Z', type: 'record-organization-change',
      payload: { change: {
        id: 'run-2:append-2:result-unknown', runId: 'run-2', workspaceId: 'workspace-2', accountMid: '100', aid: 2,
        beforeFolderIds: [], afterFolderIds: [], addedFolderIds: [], removedFolderIds: [],
        status: 'result-unknown', recordedAt: '2026-07-20T00:00:02.000Z'
      } }
    }, '2026-07-20T00:00:02.000Z')

    expect(first.memberships).toMatchObject({ 'bilimi:music:001': [], 'bilimi-logical:music': [] })
    expect(second.organizationBatches).toEqual([
      expect.objectContaining({ id: 'run-1:remove-1:succeeded', beforeFolderIds: ['remote-music'], removedFolderIds: ['remote-music'] }),
      expect.objectContaining({ id: 'run-2:append-2:result-unknown', status: 'result-unknown' })
    ])
  })

  it('rejects malformed command data at the shared IPC boundary', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({
      accountMid: '100',
      now: '2026-07-19T00:00:00.000Z'
    })

    expect(() => applyFavoriteRepositoryCommand(snapshot, {
      id: '',
      accountMid: '100',
      issuedAt: '2026-07-19T00:00:01.000Z',
      type: 'commit-local-plan',
      payload: { workspaceId: '', memberAidsByFolderId: { 'local:inbox': [1] } }
    }, '2026-07-19T00:00:01.000Z')).toThrow('Favorite repository command is invalid.')
  })

  it('requires workspaces to identify their account', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({
      accountMid: '100',
      now: '2026-07-19T00:00:00.000Z'
    })

    expect(() => applyFavoriteRepositoryCommand(snapshot, {
      id: 'command-1',
      accountMid: '100',
      issuedAt: '2026-07-19T00:00:01.000Z',
      type: 'set-workspace',
      payload: {
        id: 'workspace-1',
        status: 'scanning',
        baselineRevision: 0,
        continuationAids: []
      }
    } as never, '2026-07-19T00:00:01.000Z')).toThrow('Favorite repository command is invalid.')
  })

  it('normalizes an updated video by aid instead of increasing its count', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({
      accountMid: '100',
      now: '2026-07-19T00:00:00.000Z'
    })
    const first = applyFavoriteRepositoryCommand(snapshot, {
      id: 'command-1', accountMid: '100', issuedAt: '2026-07-19T00:00:01.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'first', tags: [], updatedAt: '2026-07-19T00:00:01.000Z' }
    }, '2026-07-19T00:00:02.000Z')
    const second = applyFavoriteRepositoryCommand(first, {
      id: 'command-2', accountMid: '100', issuedAt: '2026-07-19T00:00:02.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'updated', tags: ['tag'], updatedAt: '2026-07-19T00:00:02.000Z' }
    }, '2026-07-19T00:00:02.000Z')

    expect(Object.keys(second.videos)).toEqual(['1'])
    expect(second.videos['1']).toMatchObject({ title: 'updated', tags: ['tag'] })
  })

  it('normalizes nested workspace accounts and keeps accepted time monotonic', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({
      accountMid: '100',
      now: '2026-07-19T00:00:10.000Z'
    })

    const result = applyFavoriteRepositoryCommand(snapshot, {
      id: 'command-1', accountMid: '100', issuedAt: '2026-07-19T00:00:00.000Z', type: 'set-workspace',
      payload: {
        id: 'workspace-1', accountMid: '00100', status: 'scanning', baselineRevision: 0, continuationAids: [],
        workspaceRef: workspaceRef({ accountMid: '00100' })
      }
    }, '2026-07-19T00:00:20.000Z')

    expect(result.workspace?.accountMid).toBe('100')
    expect(result.workspace?.workspaceRef.accountMid).toBe('100')
    expect(result.updatedAt).toBe('2026-07-19T00:00:20.000Z')
  })

  it('stores only a validated lightweight workspace reference in the repository snapshot', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({
      accountMid: '100', now: '2026-07-19T00:00:00.000Z'
    })

    const result = applyFavoriteRepositoryCommand(snapshot, {
      id: 'workspace-ref', accountMid: '100', issuedAt: '2026-07-19T00:00:01.000Z', type: 'set-workspace',
      payload: {
        id: 'workspace-1', accountMid: '100', status: 'previewing', baselineRevision: 7, continuationAids: [],
        workspaceRef: workspaceRef({
          status: 'previewing', baselineRevision: 7, currentSegmentId: 'segment-2',
          overlayRevision: 4, journalCursor: 812
        })
      }
    }, '2026-07-19T00:00:01.000Z')

    expect(result.workspace?.workspaceRef).toEqual({
      workspaceId: 'workspace-1', accountMid: '100', status: 'previewing', baselineRevision: 7,
      currentSegmentId: 'segment-2', overlayRevision: 4, journalCursor: 812, checksum: WORKSPACE_CHECKSUM
    })
    expect(result.workspace).not.toHaveProperty('baseline')
    expect(result.workspace).not.toHaveProperty('classifications')
    expect(result.workspace).not.toHaveProperty('history')
    expect(result.workspace).not.toHaveProperty('segments')
  })

  it('rejects malformed or overloaded workspace references at the shared command boundary', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({
      accountMid: '100', now: '2026-07-19T00:00:00.000Z'
    })
    const command = (ref: unknown, extra: Record<string, unknown> = {}) => ({
      id: 'workspace-ref', accountMid: '100', issuedAt: '2026-07-19T00:00:01.000Z', type: 'set-workspace',
      payload: {
        id: 'workspace-1', accountMid: '100', status: 'previewing', baselineRevision: 7, continuationAids: [],
        workspaceRef: ref,
        ...extra
      }
    })

    expect(() => applyFavoriteRepositoryCommand(snapshot, command(workspaceRef({ checksum: 'bad' })),
      '2026-07-19T00:00:01.000Z')).toThrow('Favorite repository command is invalid.')
    expect(() => applyFavoriteRepositoryCommand(snapshot, command(workspaceRef({ journalCursor: -1 })),
      '2026-07-19T00:00:01.000Z')).toThrow('Favorite repository command is invalid.')
    expect(() => applyFavoriteRepositoryCommand(snapshot, command(workspaceRef({ workspaceId: 'other' })),
      '2026-07-19T00:00:01.000Z')).toThrow('Favorite repository command is invalid.')
    expect(() => applyFavoriteRepositoryCommand(snapshot, command(workspaceRef({ status: 'frozen' })),
      '2026-07-19T00:00:01.000Z')).toThrow('Favorite repository command is invalid.')
    expect(() => applyFavoriteRepositoryCommand(snapshot, command(workspaceRef(), { history: [{ changes: [] }] }),
      '2026-07-19T00:00:01.000Z')).toThrow('Favorite repository command is invalid.')
  })

  it('rejects replacing a persisted frozen sync plan through a later workspace command', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({
      accountMid: '100', now: '2026-07-19T00:00:00.000Z'
    })
    const frozen = applyFavoriteRepositoryCommand(snapshot, {
      id: 'workspace-1', accountMid: '100', issuedAt: '2026-07-19T00:00:01.000Z', type: 'set-workspace',
      payload: {
        id: 'workspace-1', accountMid: '100', status: 'frozen', baselineRevision: 1, continuationAids: [],
        workspaceRef: workspaceRef({ status: 'frozen', baselineRevision: 1, currentSegmentId: 'segment-1' }),
        frozenSyncPlan: {
          id: 'run-1', accountMid: '100', workspaceId: 'workspace-1', baselineRevision: 1,
          createdAt: '2026-07-19T00:00:01.000Z',
          operations: [{ operationKey: 'append-1', aid: 1, kind: 'append', folderIds: ['remote-a'] }]
        }
      }
    }, '2026-07-19T00:00:01.000Z')

    expect(() => applyFavoriteRepositoryCommand(frozen, {
      id: 'workspace-2', accountMid: '100', issuedAt: '2026-07-19T00:00:02.000Z', type: 'set-workspace',
      payload: {
        id: 'workspace-1', accountMid: '100', status: 'executing', baselineRevision: 1, continuationAids: [],
        workspaceRef: workspaceRef({ status: 'executing', baselineRevision: 1, currentSegmentId: 'segment-1' }),
        frozenSyncPlan: {
          id: 'run-1', accountMid: '100', workspaceId: 'workspace-1', baselineRevision: 1,
          createdAt: '2026-07-19T00:00:01.000Z',
          operations: [{ operationKey: 'append-2', aid: 1, kind: 'append', folderIds: ['remote-b'] }]
        }
      }
    }, '2026-07-19T00:00:02.000Z')).toThrow('Favorite sync plan is immutable.')

    expect(() => applyFavoriteRepositoryCommand(frozen, {
      id: 'workspace-3', accountMid: '100', issuedAt: '2026-07-19T00:00:02.000Z', type: 'set-workspace',
      payload: {
        id: 'different-workspace', accountMid: '100', status: 'scanning', baselineRevision: 0, continuationAids: [],
        workspaceRef: workspaceRef({ workspaceId: 'different-workspace' })
      }
    }, '2026-07-19T00:00:02.000Z')).toThrow('Favorite sync plan is immutable.')
  })

  it('clears an unfinished frozen workspace only through an exact explicit abandon command', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-19T00:00:00.000Z' })
    const frozen = applyFavoriteRepositoryCommand(snapshot, {
      id: 'workspace-1', accountMid: '100', issuedAt: '2026-07-19T00:00:01.000Z', type: 'set-workspace',
      payload: {
        id: 'workspace-1', accountMid: '100', status: 'frozen', baselineRevision: 1, continuationAids: [],
        workspaceRef: workspaceRef({ status: 'frozen', baselineRevision: 1, currentSegmentId: 'segment-1' }),
        frozenSyncPlan: {
          id: 'run-1', accountMid: '100', workspaceId: 'workspace-1', baselineRevision: 1,
          createdAt: '2026-07-19T00:00:01.000Z', operations: []
        }
      }
    }, '2026-07-19T00:00:01.000Z')

    expect(applyFavoriteRepositoryCommand(frozen, {
      id: 'abandon-1', accountMid: '100', issuedAt: '2026-07-19T00:00:02.000Z',
      type: 'abandon-frozen-workspace', payload: { workspaceId: 'workspace-1', frozenPlanId: 'run-1' }
    }, '2026-07-19T00:00:02.000Z').workspace).toBeUndefined()
  })

  it('abandons only the matching preview workspace without changing saved library data', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-19T00:00:00.000Z' })
    const previewing = applyFavoriteRepositoryCommand(snapshot, {
      id: 'workspace-1', accountMid: '100', issuedAt: '2026-07-19T00:00:01.000Z', type: 'set-workspace',
      payload: {
        id: 'workspace-1', accountMid: '100', status: 'previewing', baselineRevision: 1, continuationAids: [],
        workspaceRef: workspaceRef({ status: 'previewing', baselineRevision: 1, currentSegmentId: 'segment-1' })
      }
    }, '2026-07-19T00:00:01.000Z')
    const seeded = applyFavoriteRepositoryCommand(previewing, {
      id: 'saved-video', accountMid: '100', issuedAt: '2026-07-19T00:00:02.000Z', type: 'upsert-video',
      payload: { aid: 1, title: 'Saved video', author: 'UP', tags: [], updatedAt: '2026-07-19T00:00:02.000Z' }
    }, '2026-07-19T00:00:02.000Z')

    const abandoned = applyFavoriteRepositoryCommand(seeded, {
      id: 'abandon-preview-1', accountMid: '100', issuedAt: '2026-07-19T00:00:03.000Z',
      type: 'abandon-workspace', payload: { workspaceId: 'workspace-1' }
    }, '2026-07-19T00:00:03.000Z')

    expect(abandoned.workspace).toBeUndefined()
    expect(abandoned.videos['1']).toMatchObject({ title: 'Saved video' })
    expect(() => applyFavoriteRepositoryCommand(seeded, {
      id: 'wrong-workspace', accountMid: '100', issuedAt: '2026-07-19T00:00:03.000Z',
      type: 'abandon-workspace', payload: { workspaceId: 'workspace-2' }
    }, '2026-07-19T00:00:03.000Z')).toThrow('Favorite workspace cannot be abandoned.')
  })

  it('allows a completed frozen plan to advance the account pointer to a new scanning workspace', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-19T00:00:00.000Z' })
    const completed = applyFavoriteRepositoryCommand(snapshot, {
      id: 'workspace-1', accountMid: '100', issuedAt: '2026-07-19T00:00:01.000Z', type: 'set-workspace',
      payload: {
        id: 'workspace-1', accountMid: '100', status: 'completed', baselineRevision: 1, continuationAids: [],
        workspaceRef: workspaceRef({ status: 'completed', baselineRevision: 1, currentSegmentId: 'segment-1' }),
        frozenSyncPlan: {
          id: 'run-1', accountMid: '100', workspaceId: 'workspace-1', baselineRevision: 1,
          createdAt: '2026-07-19T00:00:01.000Z', operations: []
        }
      }
    }, '2026-07-19T00:00:01.000Z')

    expect(applyFavoriteRepositoryCommand(completed, {
      id: 'workspace-2', accountMid: '100', issuedAt: '2026-07-19T00:00:02.000Z', type: 'set-workspace',
      payload: {
        id: 'workspace-2', accountMid: '100', status: 'scanning', baselineRevision: 0, continuationAids: [],
        workspaceRef: workspaceRef({ workspaceId: 'workspace-2' })
      }
    }, '2026-07-19T00:00:02.000Z').workspace).toMatchObject({ id: 'workspace-2', status: 'scanning' })
  })

  it('rejects replacing a completed frozen plan with a non-scanning workspace', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-19T00:00:00.000Z' })
    const completed = applyFavoriteRepositoryCommand(snapshot, {
      id: 'workspace-1', accountMid: '100', issuedAt: '2026-07-19T00:00:01.000Z', type: 'set-workspace',
      payload: {
        id: 'workspace-1', accountMid: '100', status: 'completed', baselineRevision: 1, continuationAids: [],
        workspaceRef: workspaceRef({ status: 'completed', baselineRevision: 1, currentSegmentId: 'segment-1' }),
        frozenSyncPlan: {
          id: 'run-1', accountMid: '100', workspaceId: 'workspace-1', baselineRevision: 1,
          createdAt: '2026-07-19T00:00:01.000Z', operations: []
        }
      }
    }, '2026-07-19T00:00:01.000Z')

    expect(() => applyFavoriteRepositoryCommand(completed, {
      id: 'workspace-2', accountMid: '100', issuedAt: '2026-07-19T00:00:02.000Z', type: 'set-workspace',
      payload: {
        id: 'workspace-2', accountMid: '100', status: 'previewing', baselineRevision: 0, continuationAids: [],
        workspaceRef: workspaceRef({ workspaceId: 'workspace-2', status: 'previewing' })
      }
    }, '2026-07-19T00:00:02.000Z')).toThrow('Favorite sync plan is immutable.')
  })

  it('rejects a whitespace-padded completed workspace id as a new scan pointer', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-19T00:00:00.000Z' })
    const completed = applyFavoriteRepositoryCommand(snapshot, {
      id: 'workspace-1', accountMid: '100', issuedAt: '2026-07-19T00:00:01.000Z', type: 'set-workspace',
      payload: {
        id: 'workspace-1', accountMid: '100', status: 'completed', baselineRevision: 1, continuationAids: [],
        workspaceRef: workspaceRef({ status: 'completed', baselineRevision: 1, currentSegmentId: 'segment-1' }),
        frozenSyncPlan: {
          id: 'run-1', accountMid: '100', workspaceId: 'workspace-1', baselineRevision: 1,
          createdAt: '2026-07-19T00:00:01.000Z', operations: []
        }
      }
    }, '2026-07-19T00:00:01.000Z')

    expect(() => applyFavoriteRepositoryCommand(completed, {
      id: 'workspace-2', accountMid: '100', issuedAt: '2026-07-19T00:00:02.000Z', type: 'set-workspace',
      payload: {
        id: ' workspace-1 ', accountMid: '100', status: 'scanning', baselineRevision: 0, continuationAids: [],
        workspaceRef: workspaceRef({ workspaceId: 'workspace-1' })
      }
    }, '2026-07-19T00:00:02.000Z')).toThrow('Favorite sync plan is immutable.')
  })
})
