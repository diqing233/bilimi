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
  deriveFavoriteRepositoryClassificationSource,
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
  it('records structured classification adjustments for placement changes', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-08-14T00:00:00.000Z' })
    snapshot.videos = { '1': { aid: 1, title: 'Video 1', tags: [], updatedAt: '2026-08-14T00:00:00.000Z' } }
    const result = applyFavoriteRepositoryCommand(snapshot, {
      id: 'manual-placement', accountMid: '100', issuedAt: '2026-08-14T01:00:00.000Z', expectedRevision: 0,
      type: 'set-favorite-placement', payload: {
        aid: 1, localDesiredFolderIds: ['bilimi-logical:music'], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [],
        updatedAt: '2026-08-14T01:00:00.000Z', adjustmentKind: 'manual'
      }
    }, '2026-08-14T01:00:00.000Z')
    expect(result.classificationAdjustments).toEqual([expect.objectContaining({ aid: 1, operation: 'library-placement', classificationSource: 'manual' })])
  })

  it('keeps a complete user-facing audit payload for a manual library placement', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-08-14T00:00:00.000Z' })
    snapshot.videos = { '1': { aid: 1, title: 'Video 1', tags: [], updatedAt: '2026-08-14T00:00:00.000Z' } }

    const result = applyFavoriteRepositoryCommand(snapshot, {
      id: 'manual-audit', accountMid: '100', issuedAt: '2026-08-14T01:00:00.000Z', expectedRevision: 0,
      type: 'set-favorite-placement', payload: {
        aid: 1, localDesiredFolderIds: ['bilimi-logical:music'], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [],
        updatedAt: '2026-08-14T01:00:00.000Z', adjustmentKind: 'manual'
      }
    }, '2026-08-14T01:00:00.000Z')

    expect(result.classificationAdjustments).toEqual([expect.objectContaining({
      operation: 'library-placement',
      classificationSource: 'manual',
      beforeFolderIds: [],
      afterFolderIds: ['bilimi-logical:music'],
      addedToLibrary: true,
      bilibiliSync: { attempted: false }
    })])
  })

  it('keeps a review classification and its confirmed B站 result in one audit record', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-08-14T00:00:00.000Z' })
    snapshot.videos = { '1': { aid: 1, title: 'Reviewed video', tags: [], updatedAt: '2026-08-14T00:00:00.000Z' } }

    const result = applyFavoriteRepositoryCommand(snapshot, {
      id: 'review', accountMid: '100', issuedAt: '2026-08-14T01:00:00.000Z', type: 'set-favorite-placement',
      payload: {
        aid: 1, adjustmentKind: 'system-high', localDesiredFolderIds: ['bilimi-logical:music'],
        remoteObservedPhysicalFolderIds: ['remote-music'], remoteObservedLogicalFolderIds: ['bilimi-logical:music'],
        positionState: 'aligned', updatedAt: '2026-08-14T01:00:00.000Z',
        audit: { operation: 'review', bilibiliSync: { attempted: true, status: 'succeeded' } }
      }
    } as never, '2026-08-14T01:00:00.000Z')

    expect(result.classificationAdjustments).toEqual([expect.objectContaining({
      operation: 'review', classificationSource: 'system-high',
      bilibiliSync: { attempted: true, status: 'succeeded' }
    })])
  })

  it('removes classification audit records when a recycled video is permanently cleared', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-08-14T00:00:00.000Z' })
    snapshot.videos = { '1': { aid: 1, title: 'Video 1', tags: [], updatedAt: '2026-08-14T00:00:00.000Z' } }
    const classified = applyFavoriteRepositoryCommand(snapshot, {
      id: 'manual-placement', accountMid: '100', issuedAt: '2026-08-14T01:00:00.000Z', expectedRevision: 0,
      type: 'set-favorite-placement', payload: {
        aid: 1, localDesiredFolderIds: ['bilimi-logical:music'], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [],
        updatedAt: '2026-08-14T01:00:00.000Z', adjustmentKind: 'manual'
      }
    }, '2026-08-14T01:00:00.000Z')
    const recycled = applyFavoriteRepositoryCommand(classified, {
      id: 'recycle', accountMid: '100', issuedAt: '2026-08-14T02:00:00.000Z', expectedRevision: 1,
      type: 'recycle-favorites', payload: { aids: [1], deletedAt: '2026-08-14T02:00:00.000Z' }
    }, '2026-08-14T02:00:00.000Z')

    const cleared = applyFavoriteRepositoryCommand(recycled, {
      id: 'clear', accountMid: '100', issuedAt: '2026-08-14T03:00:00.000Z', expectedRevision: 2,
      type: 'clear-recycled-favorite', payload: { aid: 1 }
    }, '2026-08-14T03:00:00.000Z')

    expect(cleared.classificationAdjustments).toEqual([])
  })
  it('uses the latest valid classification adjustment before the persisted organization source', () => {
    expect(deriveFavoriteRepositoryClassificationSource(
      { aid: 1, title: 'Video', tags: [], updatedAt: '2026-07-24T00:00:00.000Z', lastAdjustment: { kind: 'manual', occurredAt: '2026-07-24T01:00:00.000Z' } },
      { classificationSource: 'system-high' }
    )).toBe('manual')
  })

  it('falls back to the persisted classification source after a non-classification adjustment', () => {
    expect(deriveFavoriteRepositoryClassificationSource(
      { aid: 1, title: 'Video', tags: [], updatedAt: '2026-07-24T00:00:00.000Z', lastAdjustment: { kind: 'local-copy', occurredAt: '2026-07-24T01:00:00.000Z' } },
      { classificationSource: 'deepseek' }
    )).toBe('deepseek')
  })

  it('keeps the latest effective classification after a later copy adjustment', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-08-14T00:00:00.000Z' })
    snapshot.videos = { '1': { aid: 1, title: 'Video 1', tags: [], updatedAt: '2026-08-14T00:00:00.000Z' } }
    const classified = applyFavoriteRepositoryCommand(snapshot, {
      id: 'classify', accountMid: '100', issuedAt: '2026-08-14T01:00:00.000Z', type: 'set-favorite-placement',
      payload: {
        aid: 1, localDesiredFolderIds: ['bilimi-logical:music'], remoteObservedPhysicalFolderIds: [],
        remoteObservedLogicalFolderIds: [], updatedAt: '2026-08-14T01:00:00.000Z', adjustmentKind: 'manual'
      }
    }, '2026-08-14T01:00:00.000Z')
    const copied = applyFavoriteRepositoryCommand(classified, {
      id: 'copy', accountMid: '100', issuedAt: '2026-08-14T02:00:00.000Z', type: 'set-favorite-placement',
      payload: {
        aid: 1, localDesiredFolderIds: ['bilimi-logical:music', 'bilimi-logical:knowledge'], remoteObservedPhysicalFolderIds: [],
        remoteObservedLogicalFolderIds: [], updatedAt: '2026-08-14T02:00:00.000Z', adjustmentKind: 'local-copy',
        audit: { operation: 'copy' }
      }
    } as never, '2026-08-14T02:00:00.000Z')

    expect(copied.videos['1']).toMatchObject({ classificationSource: 'manual' })
    expect(deriveFavoriteRepositoryClassificationSource(copied.videos['1'], undefined)).toBe('manual')
  })

  it('does not invent manual classification for organization records without a source', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-08-14T00:00:00.000Z' })
    snapshot.videos = { '1': { aid: 1, title: 'Video 1', tags: [], updatedAt: '2026-08-14T00:00:00.000Z' } }
    const result = applyFavoriteRepositoryCommand(snapshot, {
      id: 'protection', accountMid: '100', issuedAt: '2026-08-14T01:00:00.000Z', type: 'record-organization-protections',
      payload: { records: [{ accountMid: '100', aid: 1, targetFolderIds: ['bilimi-logical:music'], completedAt: '2026-08-14T01:00:00.000Z' }] }
    }, '2026-08-14T01:00:00.000Z')

    expect(result.videos['1']).not.toHaveProperty('classificationSource')
    expect(result.classificationAdjustments).toEqual([])
  })

  it('changes the archive checksum when classification adjustments change', () => {
    const base = createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-08-14T00:00:00.000Z' })
    const withAdjustment = { ...base, classificationAdjustments: [{
      id: 'adjustment-1', accountMid: '100', aid: 1, occurredAt: '2026-08-14T01:00:00.000Z', operation: 'review' as const,
      classificationSource: 'system-high' as const, beforeFolderIds: [], afterFolderIds: ['bilimi-logical:music'], addedToLibrary: true,
      bilibiliSync: { attempted: false }
    }] }
    const first = createFavoriteRepositoryArchiveExport(base, { generatedAt: '2026-08-14T02:00:00.000Z' })
    const second = createFavoriteRepositoryArchiveExport(withAdjustment, { generatedAt: '2026-08-14T02:00:00.000Z' })

    expect(second.checksum).not.toBe(first.checksum)
    expect(validateFavoriteRepositoryArchiveExport(second).recovery?.classificationAdjustments).toEqual(withAdjustment.classificationAdjustments)
  })

  it('does not invent a classification when neither source contains one', () => {
    expect(deriveFavoriteRepositoryClassificationSource(
      { aid: 1, title: 'Video', tags: [], updatedAt: '2026-07-24T00:00:00.000Z' },
      undefined
    )).toBeUndefined()
  })

  it('preserves migrated managed binding identity for live inventory verification', () => {
    const now = '2026-07-24T00:00:00.000Z'
    const base = createAccountFavoriteRepositorySnapshot({ accountMid: '100', now })
    const snapshot = applyFavoriteRepositoryCommand(base, {
      id: 'binding', accountMid: '100', issuedAt: now, type: 'upsert-physical-shard-binding',
      payload: { logicalLedgerId: 'music', logicalTitle: 'bilimi·音乐', shardNumber: 1, memberAids: [], remoteTitle: 'bilimi·音乐', bindingState: 'bound', remoteFolderId: 'remote-music' }
    }, now)
    const restored = restoreFavoriteRepositoryArchiveRecovery(createFavoriteRepositoryArchiveExport(snapshot, { generatedAt: now }))

    expect(restored.recovery?.folders).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'bilimi-logical:music', syncState: 'pending-reconcile' })
    ]))
    expect(restored.recovery?.folders).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'bilimi-logical:music', syncState: 'pending-reconcile', remoteFolderId: 'remote-music' })
    ]))
    expect(restored.recovery?.physicalShards).toEqual(expect.arrayContaining([
      expect.objectContaining({ logicalLedgerId: 'music', bindingState: 'pending-reconcile' })
    ]))
    expect(restored.recovery?.physicalShards[0]).toHaveProperty('remoteFolderId', 'remote-music')
    expect(() => validateFavoriteRepositoryArchiveExport(restored)).not.toThrow()
  })

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

  it('keeps a local-only managed-folder deletion out of inbox and recycle while retained Bilibili sources await the next scan', () => {
    const now = '2026-08-05T00:00:00.000Z'
    const snapshot = {
      ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now }),
      videos: {
        '1': { aid: 1, title: 'Keep remote source', tags: [], updatedAt: now },
        '2': { aid: 2, title: 'Keep other workspace', tags: [], updatedAt: now },
        '3': { aid: 3, title: 'Keep incomplete source', tags: [], updatedAt: now }
      },
      folders: [
        { id: 'local:inbox', title: '暂存', kind: 'local' as const, syncState: 'local-only' as const },
        { id: 'bilimi-logical:work', title: 'bilimi·工作', kind: 'bilimi-logical' as const, logicalLedgerId: 'work', syncState: 'bound' as const },
        { id: 'bilimi-logical:music', title: 'bilimi·音乐', kind: 'bilimi-logical' as const, logicalLedgerId: 'music', syncState: 'bound' as const },
        { id: 'bilimi:work:001', title: 'bilimi·工作', kind: 'bilibili' as const, logicalLedgerId: 'work', remoteFolderId: '91', syncState: 'bound' as const }
      ],
      memberships: {
        'local:inbox': [],
        'bilimi-logical:work': [1, 2, 3],
        'bilimi-logical:music': [2],
        'bilimi:work:001': [1, 2, 3],
        'bilibili:work': [1, 2, 3]
      },
      physicalShards: [{ logicalLedgerId: 'work', folderId: 'bilimi:work:001', shardNumber: 1, remoteFolderId: '91', remoteTitle: 'bilimi·工作', bindingState: 'bound' as const }],
      organizationRecords: [
        { accountMid: '100', aid: 1, targetFolderIds: ['bilimi-logical:work'], completedAt: now, classificationSource: 'system-high' as const },
        { accountMid: '100', aid: 2, targetFolderIds: ['bilimi-logical:music', 'bilimi-logical:work'], completedAt: now, classificationSource: 'manual' as const }
      ],
      positions: {
        '100:1': { accountMid: '100', aid: 1, localDesiredFolderIds: ['bilimi-logical:work'], remoteObservedPhysicalFolderIds: ['91'], remoteObservedLogicalFolderIds: ['bilimi-logical:work'], positionState: 'aligned' as const, sourceAuthority: 'complete' as const, updatedAt: now, revision: 0 },
        '100:2': { accountMid: '100', aid: 2, localDesiredFolderIds: ['bilimi-logical:music', 'bilimi-logical:work'], remoteObservedPhysicalFolderIds: ['91'], remoteObservedLogicalFolderIds: ['bilimi-logical:work'], positionState: 'local-only-change' as const, sourceAuthority: 'complete' as const, updatedAt: now, revision: 0 },
        '100:3': { accountMid: '100', aid: 3, localDesiredFolderIds: ['bilimi-logical:work'], remoteObservedPhysicalFolderIds: ['91'], remoteObservedLogicalFolderIds: ['bilimi-logical:work'], positionState: 'aligned' as const, sourceAuthority: 'incomplete' as const, updatedAt: now, revision: 0 }
      }
    }

    const deleted = applyFavoriteRepositoryCommand(snapshot, {
      id: 'delete-work', accountMid: '100', issuedAt: now, type: 'delete-local-managed-folder',
      payload: { logicalFolderId: 'bilimi-logical:work' }
    }, now)

    expect(deleted.memberships['local:inbox']).toEqual([])
    expect(deleted.memberships['bilimi-logical:music']).toEqual([2])
    expect(deleted.memberships['bilibili:work']).toEqual([1, 2, 3])
    expect(deleted.positions['100:1']?.localDesiredFolderIds).toEqual([])
    expect(deleted.positions['100:2']?.localDesiredFolderIds).toEqual(['bilimi-logical:music'])
    expect(deleted.positions['100:3']?.localDesiredFolderIds).toEqual([])
    expect(deleted.positions['100:1']?.remoteObservedPhysicalFolderIds).toEqual(['91'])
    expect(deleted.positions['100:1']?.remoteObservedLogicalFolderIds).toEqual(['bilimi-logical:work'])
    expect(deleted.positions['100:2']?.remoteObservedPhysicalFolderIds).toEqual(['91'])
    expect(deleted.positions['100:2']?.remoteObservedLogicalFolderIds).toEqual(['bilimi-logical:work'])
    expect(deleted.positions['100:3']?.remoteObservedPhysicalFolderIds).toEqual(['91'])
    expect(deleted.positions['100:3']?.remoteObservedLogicalFolderIds).toEqual(['bilimi-logical:work'])
    expect(deleted.tombstones['100:1']).toBeUndefined()
    expect(deleted.tombstones['100:2']).toBeUndefined()
    expect(deleted.tombstones['100:3']).toBeUndefined()
    expect(deleted.videos).toEqual(expect.objectContaining({
      '1': expect.objectContaining({ title: 'Keep remote source' }),
      '2': expect.objectContaining({ title: 'Keep other workspace' }),
      '3': expect.objectContaining({ title: 'Keep incomplete source' })
    }))
    expect(deleted.organizationRecords).toEqual([
      expect.objectContaining({ aid: 2, targetFolderIds: ['bilimi-logical:music'], classificationSource: 'manual' })
    ])
    expect(deleted.affectedFolderIds).not.toContain('local:inbox')
  })

  it('recycles only complete no-source videos after a confirmed remote managed-folder deletion', () => {
    const now = '2026-08-05T00:00:00.000Z'
    const snapshot = {
      ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now }),
      videos: {
        '1': { aid: 1, title: 'Recycle after remote delete', tags: [], updatedAt: now },
        '2': { aid: 2, title: 'Keep other source', tags: [], updatedAt: now },
        '3': { aid: 3, title: 'Keep incomplete evidence', tags: [], updatedAt: now }
      },
      folders: [
        { id: 'local:inbox', title: '暂存', kind: 'local' as const, syncState: 'local-only' as const },
        { id: 'bilimi-logical:work', title: 'bilimi·工作', kind: 'bilimi-logical' as const, logicalLedgerId: 'work', syncState: 'bound' as const },
        { id: 'bilimi:work:001', title: 'bilimi·工作', kind: 'bilibili' as const, logicalLedgerId: 'work', remoteFolderId: '91', syncState: 'bound' as const },
        { id: 'bilibili:work', title: 'bilimi·工作', kind: 'bilibili' as const, remoteFolderId: '91', syncState: 'bound' as const },
        { id: 'bilibili:other', title: '其他收藏夹', kind: 'bilibili' as const, remoteFolderId: '92', syncState: 'bound' as const }
      ],
      memberships: {
        'local:inbox': [],
        'bilimi-logical:work': [1, 2, 3],
        'bilimi:work:001': [1, 2, 3],
        'bilibili:work': [1, 2, 3],
        'bilibili:other': [2]
      },
      physicalShards: [{ logicalLedgerId: 'work', folderId: 'bilimi:work:001', shardNumber: 1, remoteFolderId: '91', remoteTitle: 'bilimi·工作', bindingState: 'bound' as const }],
      positions: {
        '100:1': { accountMid: '100', aid: 1, localDesiredFolderIds: ['bilimi-logical:work'], remoteObservedPhysicalFolderIds: ['91'], remoteObservedLogicalFolderIds: ['bilimi-logical:work'], positionState: 'aligned' as const, sourceAuthority: 'complete' as const, updatedAt: now, revision: 0 },
        '100:2': { accountMid: '100', aid: 2, localDesiredFolderIds: ['bilimi-logical:work'], remoteObservedPhysicalFolderIds: ['91', '92'], remoteObservedLogicalFolderIds: ['bilimi-logical:work'], positionState: 'aligned' as const, sourceAuthority: 'complete' as const, updatedAt: now, revision: 0 },
        '100:3': { accountMid: '100', aid: 3, localDesiredFolderIds: ['bilimi-logical:work'], remoteObservedPhysicalFolderIds: ['91'], remoteObservedLogicalFolderIds: ['bilimi-logical:work'], positionState: 'aligned' as const, sourceAuthority: 'incomplete' as const, updatedAt: now, revision: 0 }
      }
    }

    const deleted = applyFavoriteRepositoryCommand(snapshot, {
      id: 'delete-work-remotely', accountMid: '100', issuedAt: now, type: 'delete-local-managed-folder',
      payload: { logicalFolderId: 'bilimi-logical:work', confirmedRemoteFolderIds: ['91'] }
    } as never, now)

    expect(deleted.memberships['local:inbox']).toEqual([])
    expect(deleted.folders.map((folder) => folder.id)).toEqual(['local:inbox', 'bilibili:other'])
    expect(deleted.memberships['bilibili:other']).toEqual([2])
    expect(deleted.positions['100:1']).toMatchObject({
      localDesiredFolderIds: [], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [],
      positionState: 'aligned', lifecycleState: 'recycled', sourceAuthority: 'complete'
    })
    expect(deleted.tombstones['100:1']).toMatchObject({ kind: 'recycled', allowRediscovery: true })
    expect(deleted.positions['100:2']).toMatchObject({
      localDesiredFolderIds: [], remoteObservedPhysicalFolderIds: ['92'], remoteObservedLogicalFolderIds: [], sourceAuthority: 'complete'
    })
    expect(deleted.tombstones['100:2']).toBeUndefined()
    expect(deleted.positions['100:3']).toMatchObject({
      localDesiredFolderIds: [], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], sourceAuthority: 'incomplete'
    })
    expect(deleted.tombstones['100:3']).toBeUndefined()
  })

  it('removes every confirmed managed-folder observation alias and refreshes its Bilibili mirror', () => {
    const now = '2026-08-05T00:00:00.000Z'
    const snapshot = {
      ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now }),
      videos: {
        '1': { aid: 1, title: 'Remote-only member', tags: [], updatedAt: now },
        '2': { aid: 2, title: 'Local and remote member', tags: [], updatedAt: now }
      },
      folders: [
        { id: 'local:inbox', title: '暂存', kind: 'local' as const, syncState: 'local-only' as const },
        { id: 'bilimi-logical:work', title: 'bilimi·工作', kind: 'bilimi-logical' as const, logicalLedgerId: 'work', syncState: 'bound' as const },
        { id: 'bilimi:work:001', title: 'bilimi·工作', kind: 'bilibili' as const, logicalLedgerId: 'work', remoteFolderId: '91', syncState: 'bound' as const },
        { id: 'bilibili:91', title: 'bilimi·工作', kind: 'bilibili' as const, remoteFolderId: '91', syncState: 'bound' as const }
      ],
      memberships: {
        'local:inbox': [],
        'bilimi-logical:work': [2],
        'bilimi:work:001': [2],
        'bilibili:91': [1, 2]
      },
      physicalShards: [{ logicalLedgerId: 'work', folderId: 'bilimi:work:001', shardNumber: 1, remoteFolderId: '91', remoteTitle: 'bilimi·工作', bindingState: 'bound' as const }],
      positions: {
        '100:1': { accountMid: '100', aid: 1, localDesiredFolderIds: [], remoteObservedPhysicalFolderIds: ['bilibili:91'], remoteObservedLogicalFolderIds: ['bilimi-logical:work'], positionState: 'aligned' as const, sourceAuthority: 'complete' as const, updatedAt: now, revision: 0 },
        '100:2': { accountMid: '100', aid: 2, localDesiredFolderIds: ['bilimi-logical:work'], remoteObservedPhysicalFolderIds: ['bilimi:work:001'], remoteObservedLogicalFolderIds: ['bilimi-logical:work'], positionState: 'aligned' as const, sourceAuthority: 'complete' as const, updatedAt: now, revision: 0 }
      }
    }

    const deleted = applyFavoriteRepositoryCommand(snapshot, {
      id: 'delete-work-remotely', accountMid: '100', issuedAt: now, type: 'delete-local-managed-folder',
      payload: { logicalFolderId: 'bilimi-logical:work', confirmedRemoteFolderIds: ['91'] }
    } as never, now)

    expect(deleted.folders.map((folder) => folder.id)).toEqual(['local:inbox'])
    expect(deleted.positions['100:1']).toMatchObject({
      remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], lifecycleState: 'recycled'
    })
    expect(deleted.positions['100:2']).toMatchObject({
      localDesiredFolderIds: [], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], lifecycleState: 'recycled'
    })
    expect(deleted.affectedFolderIds).toEqual(expect.arrayContaining(['bilibili:91']))
    expect(deleted.affectedAids).toEqual([1, 2])
    expect(deleted.tombstones['100:1']).toMatchObject({ kind: 'recycled', allowRediscovery: true })
    expect(deleted.tombstones['100:2']).toMatchObject({ kind: 'recycled', allowRediscovery: true })
  })

  it('does not recycle a confirmed remote deletion while another placement result remains unknown', () => {
    const now = '2026-08-05T00:00:00.000Z'
    const snapshot = {
      ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now }),
      videos: { '1': { aid: 1, title: 'Keep unknown source result', tags: [], updatedAt: now } },
      folders: [
        { id: 'bilimi-logical:work', title: 'bilimi·工作', kind: 'bilimi-logical' as const, logicalLedgerId: 'work', syncState: 'bound' as const },
        { id: 'bilimi:work:001', title: 'bilimi·工作', kind: 'bilibili' as const, logicalLedgerId: 'work', remoteFolderId: '91', syncState: 'bound' as const },
        { id: 'bilibili:91', title: 'bilimi·工作', kind: 'bilibili' as const, remoteFolderId: '91', syncState: 'bound' as const }
      ],
      memberships: { 'bilimi-logical:work': [1], 'bilimi:work:001': [1], 'bilibili:91': [1] },
      physicalShards: [{ logicalLedgerId: 'work', folderId: 'bilimi:work:001', shardNumber: 1, remoteFolderId: '91', remoteTitle: 'bilimi·工作', bindingState: 'bound' as const }],
      positions: {
        '100:1': {
          accountMid: '100', aid: 1, localDesiredFolderIds: ['bilimi-logical:work'], remoteObservedPhysicalFolderIds: ['91'],
          remoteObservedLogicalFolderIds: ['bilimi-logical:work'], positionState: 'result-unknown' as const,
          sourceAuthority: 'complete' as const, updatedAt: now, revision: 0
        }
      }
    }

    const deleted = applyFavoriteRepositoryCommand(snapshot, {
      id: 'delete-work-remotely', accountMid: '100', issuedAt: now, type: 'delete-local-managed-folder',
      payload: { logicalFolderId: 'bilimi-logical:work', confirmedRemoteFolderIds: ['91'] }
    } as never, now)

    expect(deleted.positions['100:1']).toMatchObject({
      localDesiredFolderIds: [], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], positionState: 'result-unknown'
    })
    expect(deleted.tombstones['100:1']).toBeUndefined()
  })

  it('does not recycle a confirmed remote deletion while a remote-removed placement awaits reconciliation', () => {
    const now = '2026-08-05T00:00:00.000Z'
    const snapshot = {
      ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now }),
      folders: [
        { id: 'bilimi-logical:work', title: 'bilimi·工作', kind: 'bilimi-logical' as const, logicalLedgerId: 'work', syncState: 'bound' as const },
        { id: 'bilimi:work:001', title: 'bilimi·工作', kind: 'bilibili' as const, logicalLedgerId: 'work', remoteFolderId: '91', syncState: 'bound' as const },
        { id: 'bilibili:91', title: 'bilimi·工作', kind: 'bilibili' as const, remoteFolderId: '91', syncState: 'bound' as const }
      ],
      memberships: { 'bilimi-logical:work': [1], 'bilimi:work:001': [1], 'bilibili:91': [1] },
      physicalShards: [{ logicalLedgerId: 'work', folderId: 'bilimi:work:001', shardNumber: 1, remoteFolderId: '91', remoteTitle: 'bilimi·工作', bindingState: 'bound' as const }],
      positions: {
        '100:1': {
          accountMid: '100', aid: 1, localDesiredFolderIds: ['bilimi-logical:work'], remoteObservedPhysicalFolderIds: ['91'],
          remoteObservedLogicalFolderIds: ['bilimi-logical:work'], positionState: 'remote-removed' as const,
          sourceAuthority: 'complete' as const, updatedAt: now, revision: 0
        }
      }
    }

    const deleted = applyFavoriteRepositoryCommand(snapshot, {
      id: 'delete-work-remotely', accountMid: '100', issuedAt: now, type: 'delete-local-managed-folder',
      payload: { logicalFolderId: 'bilimi-logical:work', confirmedRemoteFolderIds: ['91'] }
    } as never, now)

    expect(deleted.positions['100:1']).toMatchObject({
      localDesiredFolderIds: [], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], positionState: 'remote-removed'
    })
    expect(deleted.tombstones['100:1']).toBeUndefined()
  })

  it('clears a standalone local inbox while retaining its durable safety container', () => {
    const now = '2026-08-11T00:00:00.000Z'
    const snapshot = {
      ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now }),
      memberships: { 'local:inbox': [1, 2] }
    }

    const cleared = applyFavoriteRepositoryCommand(snapshot, {
      id: 'clear-local-inbox', accountMid: '100', issuedAt: now, type: 'clear-local-inbox', payload: {}
    }, now)

    expect(cleared.memberships['local:inbox']).toEqual([])
    expect(cleared.folders.some((folder) => folder.id === 'local:inbox')).toBe(true)
    expect(cleared.affectedFolderIds).toEqual(['local:inbox'])
    expect(cleared.affectedAids).toEqual([1, 2])
  })

  it('removes only requested videos from local inbox', () => {
    const now = '2026-08-18T00:00:00.000Z'
    const snapshot = {
      ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now }),
      videos: {
        '1': { aid: 1, title: '已失效视频', tags: [], unavailable: true, updatedAt: now },
        '2': { aid: 2, title: '有效但未匹配', tags: [], updatedAt: now }
      },
      memberships: {
        'local:inbox': [1, 2],
        'bilibili:source': [1, 2],
        'local:other': [2]
      }
    }

    const cleaned = applyFavoriteRepositoryCommand(snapshot, {
      id: 'remove-invalid-inbox-aid', accountMid: '100', issuedAt: now,
      type: 'remove-favorites-from-local-inbox', payload: { aids: [1] }
    } as never, now)

    expect(cleaned.memberships).toMatchObject({
      'local:inbox': [2],
      'bilibili:source': [1, 2],
      'local:other': [2]
    })
    expect(cleaned.videos).toMatchObject({
      '1': { aid: 1, unavailable: true },
      '2': { aid: 2, title: '有效但未匹配' }
    })
    expect(cleaned.affectedFolderIds).toEqual(['local:inbox'])
    expect(cleaned.affectedAids).toEqual([1])
  })

  it('clears both staging memberships instead of falling back when deleting the bilimi inbox', () => {
    const now = '2026-08-11T00:00:00.000Z'
    const snapshot = {
      ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now }),
      folders: [
        { id: 'local:inbox', title: 'bilimi·暂存', kind: 'local' as const, syncState: 'local-only' as const },
        { id: 'bilimi-logical:inbox', title: 'bilimi·暂存', kind: 'bilimi-logical' as const, logicalLedgerId: 'inbox', syncState: 'bound' as const },
        { id: 'bilimi:inbox:001', title: 'bilimi·暂存', kind: 'bilibili' as const, logicalLedgerId: 'inbox', remoteFolderId: '9', syncState: 'bound' as const }
      ],
      memberships: { 'local:inbox': [1], 'bilimi-logical:inbox': [2], 'bilimi:inbox:001': [2] },
      physicalShards: [{ logicalLedgerId: 'inbox', folderId: 'bilimi:inbox:001', shardNumber: 1, remoteFolderId: '9', remoteTitle: 'bilimi·暂存', bindingState: 'bound' as const }]
    }

    const deleted = applyFavoriteRepositoryCommand(snapshot, {
      id: 'delete-inbox', accountMid: '100', issuedAt: now, type: 'delete-local-managed-folder',
      payload: { logicalFolderId: 'bilimi-logical:inbox' }
    }, now)

    expect(deleted.folders.map((folder) => folder.id)).toEqual(['local:inbox'])
    expect(deleted.memberships['local:inbox']).toEqual([])
    expect(deleted.affectedAids).toEqual([1, 2])
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

  it('records an automatic recycle lifecycle without discarding metadata or local organization', () => {
    const snapshot = {
      ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-08-04T00:00:00.000Z' }),
      videos: { '1': { aid: 1, title: 'Reusable metadata', tags: ['tag-a'], tagEvidence: 'confirmed' as const, updatedAt: '2026-08-04T00:00:00.000Z' } },
      memberships: { 'bilimi-logical:music': [1], 'bilibili:source': [1] },
      organizationRecords: [{ accountMid: '100', aid: 1, targetFolderIds: ['bilimi-logical:music'], completedAt: '2026-08-04T00:00:00.000Z' }],
      positions: {
        '100:1': {
          accountMid: '100', aid: 1, localDesiredFolderIds: ['bilimi-logical:music'],
          remoteObservedPhysicalFolderIds: ['source'], remoteObservedLogicalFolderIds: [],
          positionState: 'local-only-change' as const, observedAt: '2026-08-04T00:00:00.000Z',
          updatedAt: '2026-08-04T00:00:00.000Z', revision: 1
        }
      }
    }

    const recycled = applyFavoriteRepositoryCommand(snapshot, {
      id: 'scan-lifecycle-recycle', accountMid: '100', issuedAt: '2026-08-04T00:01:00.000Z',
      type: 'reconcile-scan-lifecycle', payload: {
        observationEpoch: 'scan-2', authority: 'complete',
        observations: [{ aid: 1, remoteObserved: false }]
      }
    } as never, '2026-08-04T00:01:00.000Z')

    expect(recycled.videos['1']).toMatchObject({ title: 'Reusable metadata', tags: ['tag-a'], tagEvidence: 'confirmed' })
    expect(recycled.memberships['bilimi-logical:music']).toEqual([1])
    expect(recycled.tombstones['100:1']).toMatchObject({ kind: 'recycled', allowRediscovery: true })
    expect(recycled.positions['100:1']).toMatchObject({ lifecycleState: 'recycled', observationEpoch: 'scan-2', sourceAuthority: 'complete' })
    expect(recycled.organizationRecords).toEqual([])
    expect(isFavoriteRepositoryScanVisible(recycled, 1)).toBe(true)
  })

  it('restores a recycled record when a later Bilibili mirror observes it again', () => {
    const snapshot = {
      ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-08-04T00:00:00.000Z' }),
      videos: { '1': { aid: 1, title: 'Recycled title', tags: ['saved-tag'], updatedAt: '2026-08-04T00:00:00.000Z' } },
      memberships: { 'bilimi-logical:music': [1] },
      tombstones: {
        '100:1': { accountMid: '100', aid: 1, deletedAt: '2026-08-04T00:00:00.000Z', allowRediscovery: true, kind: 'recycled' as const }
      }
    }

    const scanned = applyFavoriteRepositoryCommand(snapshot, {
      id: 'mirror-after-recycle', accountMid: '100', issuedAt: '2026-08-04T00:01:00.000Z', type: 'record-bilibili-mirror',
      payload: {
        workspaceId: 'scan-2', folders: [{ id: 'bilibili:source', title: 'Source', remoteFolderId: 'source' }],
        memberAidsByFolderId: { 'bilibili:source': [1] },
        videos: [{ aid: 1, title: 'Reappeared title', tags: [], updatedAt: '2026-08-04T00:01:00.000Z' }]
      }
    }, '2026-08-04T00:01:00.000Z')

    expect(scanned.tombstones['100:1']).toBeUndefined()
    expect(scanned.videos['1']).toMatchObject({ title: 'Reappeared title', tags: ['saved-tag'] })
    expect(scanned.memberships['bilibili:source']).toEqual([1])
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

  it('keeps managed recovery bindings available for same-account migration', () => {
    const exported = createFavoriteRepositoryArchiveExport({
      ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-23T00:00:00.000Z' }),
      folders: [
        { id: 'bilimi-logical:music', title: 'Music', kind: 'bilimi-logical' as const, logicalLedgerId: 'music', remoteFolderId: '900', syncState: 'bound' as const },
        { id: 'bilimi:music:001', title: 'Music 1', kind: 'bilibili' as const, remoteFolderId: '900', syncState: 'bound' as const }
      ],
      memberships: { 'bilimi-logical:music': [1], 'bilimi:music:001': [1] },
      physicalShards: [{ logicalLedgerId: 'music', folderId: 'bilimi:music:001', shardNumber: 1, remoteTitle: 'Music 1', bindingState: 'bound' as const, remoteFolderId: '900', knownRemoteFolderIds: ['900'], remoteMemberCount: 12 }]
    }, { generatedAt: '2026-07-23T01:00:00.000Z' })

    expect(exported.recovery?.folders).toEqual(expect.arrayContaining([
      { id: 'bilimi-logical:music', title: 'Music', kind: 'bilimi-logical', logicalLedgerId: 'music', remoteFolderId: '900', syncState: 'bound' },
      { id: 'bilimi:music:001', title: 'Music 1', kind: 'bilibili', logicalLedgerId: 'music', remoteFolderId: '900', syncState: 'bound' }
    ]))
    expect(exported.recovery?.physicalShards).toEqual([{ logicalLedgerId: 'music', folderId: 'bilimi:music:001', shardNumber: 1, remoteFolderId: '900', remoteTitle: 'Music 1', bindingState: 'bound' }])
    expect(exported.recovery?.memberships).toEqual({ 'bilimi-logical:music': [1] })
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

  it('round-trips account-local repository recovery state while excluding only transient observations', () => {
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
      folders: expect.arrayContaining([
        expect.objectContaining({ id: 'bilimi-logical:music', syncState: 'bound', remoteFolderId: '42' }),
        expect.objectContaining({ id: 'bilimi:music:001', remoteFolderId: '42', syncState: 'bound' })
      ]),
      memberships: { 'bilimi-logical:music': [1] }, physicalShards: expect.arrayContaining([
        expect.objectContaining({ remoteFolderId: '42', bindingState: 'bound' })
      ]), workspace: snapshot.workspace,
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
      aid: 1, title: '扫描标题', author: '原 UP', description: '完整简介', tags: ['音乐'], updatedAt: '2026-07-19T00:00:00.000Z',
      initialSource: {
        observedAt: '2026-07-20T00:00:02.000Z',
        folders: [{ folderId: 'bilibili:source', title: '来源', kind: 'ordinary' }]
      }
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

  it('replaces prior bilimi-managed local placements without changing ordinary Bilibili memberships', () => {
    const snapshot = {
      ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-07-19T00:00:00.000Z' }),
      memberships: {
        'local:music': [1, 9],
        'local:knowledge': [2],
        'bilimi-logical:music': [1],
        'bilimi-logical:knowledge': [2],
        'bilibili:source': [1, 2]
      },
      organizationRecords: [
        { accountMid: '100', aid: 1, targetFolderIds: ['local:music'], completedAt: '2026-07-19T00:00:00.000Z' },
        { accountMid: '100', aid: 2, targetFolderIds: ['local:knowledge'], completedAt: '2026-07-19T00:00:00.000Z' }
      ],
      positions: {
        '100:1': {
          accountMid: '100', aid: 1, localDesiredFolderIds: ['local:music', 'bilimi-logical:music'],
          remoteObservedPhysicalFolderIds: ['bilibili:source'], remoteObservedLogicalFolderIds: [],
          positionState: 'local-only-change' as const, updatedAt: '2026-07-19T00:00:00.000Z', revision: 0
        },
        '100:2': {
          accountMid: '100', aid: 2, localDesiredFolderIds: ['local:knowledge', 'bilimi-logical:knowledge'],
          remoteObservedPhysicalFolderIds: ['bilibili:source'], remoteObservedLogicalFolderIds: [],
          positionState: 'local-only-change' as const, updatedAt: '2026-07-19T00:00:00.000Z', revision: 0
        }
      }
    }

    const result = applyFavoriteRepositoryCommand(snapshot, {
      id: 'replace-managed-local-plan', accountMid: '100', issuedAt: '2026-07-19T00:00:01.000Z', type: 'commit-local-plan',
      payload: {
        workspaceId: 'workspace-1',
        replaceManagedAids: [1],
        memberAidsByFolderId: { 'local:knowledge': [1] },
        organizationRecords: [{ accountMid: '100', aid: 1, targetFolderIds: ['local:knowledge'], completedAt: '2026-07-19T00:00:01.000Z' }],
        placements: [{
          aid: 1, localDesiredFolderIds: ['local:knowledge'], remoteObservedPhysicalFolderIds: ['bilibili:source'],
          remoteObservedLogicalFolderIds: [], updatedAt: '2026-07-19T00:00:01.000Z'
        }]
      }
    }, '2026-07-19T00:00:01.000Z')

    expect(result.memberships).toMatchObject({
      'local:music': [9],
      'local:knowledge': [1, 2],
      'bilimi-logical:music': [],
      'bilimi-logical:knowledge': [2],
      'bilibili:source': [1, 2]
    })
    expect(result.organizationRecords).toEqual([
      expect.objectContaining({ aid: 1, targetFolderIds: ['local:knowledge'] }),
      expect.objectContaining({ aid: 2, targetFolderIds: ['local:knowledge'] })
    ])
    expect(result.positions['100:1']).toMatchObject({
      localDesiredFolderIds: ['local:knowledge'],
      remoteObservedPhysicalFolderIds: ['bilibili:source']
    })
    expect(result.positions['100:2']?.localDesiredFolderIds).toEqual(['local:knowledge', 'bilimi-logical:knowledge'])
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

  it('clears local organization records without deleting bindings or Bilibili observations', () => {
    const now = '2026-08-11T00:00:00.000Z'
    const snapshot = {
      ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now }),
      videos: {
        '1': { aid: 1, title: 'Music only', tags: [], updatedAt: now },
        '2': { aid: 2, title: 'Game only', tags: [], updatedAt: now },
        '3': { aid: 3, title: 'Both folders', tags: [], updatedAt: now }
      },
      folders: [
        { id: 'bilimi-logical:music', title: 'Music', kind: 'bilimi-logical' as const, logicalLedgerId: 'music', syncState: 'bound' as const },
        { id: 'bilimi:music:001', title: 'Music', kind: 'bilibili' as const, logicalLedgerId: 'music', remoteFolderId: '9', syncState: 'bound' as const },
        { id: 'bilibili:9', title: 'Music', kind: 'bilibili' as const, remoteFolderId: '9', syncState: 'bound' as const }
      ],
      memberships: { 'bilimi-logical:music': [1], 'bilimi:music:001': [1], 'bilibili:9': [1] },
      physicalShards: [{ logicalLedgerId: 'music', folderId: 'bilimi:music:001', shardNumber: 1, remoteFolderId: '9', remoteTitle: 'Music', bindingState: 'bound' as const }],
      organizationRecords: [{ accountMid: '100', aid: 1, targetFolderIds: ['bilimi-logical:music'], completedAt: now, classificationSource: 'manual' as const }],
      positions: { '100:1': { accountMid: '100', aid: 1, localDesiredFolderIds: ['bilimi-logical:music'], remoteObservedPhysicalFolderIds: ['9'], remoteObservedLogicalFolderIds: ['bilimi-logical:music'], positionState: 'aligned' as const, updatedAt: now, revision: 0 } }
    }
    const cleared = applyFavoriteRepositoryCommand(snapshot, {
      id: 'clear-organization-records', accountMid: '100', issuedAt: now, type: 'clear-organization-records', payload: {}
    }, now)
    expect(cleared.organizationRecords).toEqual([])
    expect(cleared.physicalShards).toEqual(snapshot.physicalShards)
    expect(cleared.memberships['bilibili:9']).toEqual([1])
    expect(cleared.memberships['bilimi-logical:music']).toEqual([])
    expect(cleared.memberships['local:inbox']).toEqual([1])
  })

  it('clears organization records only for the selected work folders and preserves other organized placements', () => {
    const now = '2026-08-11T00:00:00.000Z'
    const snapshot = {
      ...createAccountFavoriteRepositorySnapshot({ accountMid: '100', now }),
      videos: {
        '1': { aid: 1, title: 'Music only', tags: [], updatedAt: now },
        '2': { aid: 2, title: 'Game only', tags: [], updatedAt: now },
        '3': { aid: 3, title: 'Both folders', tags: [], updatedAt: now }
      },
      folders: [
        { id: 'bilimi-logical:music', title: 'Music', kind: 'bilimi-logical' as const, logicalLedgerId: 'music', syncState: 'bound' as const },
        { id: 'bilimi-logical:game', title: 'Game', kind: 'bilimi-logical' as const, logicalLedgerId: 'game', syncState: 'bound' as const }
      ],
      memberships: { 'bilimi-logical:music': [1, 3], 'bilimi-logical:game': [2, 3] },
      organizationRecords: [
        { accountMid: '100', aid: 1, targetFolderIds: ['bilimi-logical:music'], completedAt: now, classificationSource: 'manual' as const },
        { accountMid: '100', aid: 2, targetFolderIds: ['bilimi-logical:game'], completedAt: now, classificationSource: 'deepseek' as const },
        { accountMid: '100', aid: 3, targetFolderIds: ['bilimi-logical:game', 'bilimi-logical:music'], completedAt: now, classificationSource: 'manual' as const }
      ],
      positions: {
        '100:1': { accountMid: '100', aid: 1, localDesiredFolderIds: ['bilimi-logical:music'], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], positionState: 'local-only-change' as const, updatedAt: now, revision: 0 },
        '100:2': { accountMid: '100', aid: 2, localDesiredFolderIds: ['bilimi-logical:game'], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], positionState: 'local-only-change' as const, updatedAt: now, revision: 0 },
        '100:3': { accountMid: '100', aid: 3, localDesiredFolderIds: ['bilimi-logical:game', 'bilimi-logical:music'], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], positionState: 'local-only-change' as const, updatedAt: now, revision: 0 }
      }
    }

    const cleared = applyFavoriteRepositoryCommand(snapshot, {
      id: 'clear-selected-organization-records', accountMid: '100', issuedAt: now, type: 'clear-organization-records',
      payload: { logicalFolderIds: ['bilimi-logical:music'] }
    }, now)

    expect(cleared.organizationRecords).toEqual([
      expect.objectContaining({ aid: 2, targetFolderIds: ['bilimi-logical:game'] }),
      expect.objectContaining({ aid: 3, targetFolderIds: ['bilimi-logical:game'] })
    ])
    expect(cleared.memberships['bilimi-logical:music']).toEqual([])
    expect(cleared.memberships['bilimi-logical:game']).toEqual([2, 3])
    expect(cleared.memberships['local:inbox']).toEqual([1])
    expect(cleared.positions['100:3']).toMatchObject({ localDesiredFolderIds: ['bilimi-logical:game'] })
    expect(cleared.videos['3']).toMatchObject({
      lastAdjustment: { kind: 'clear-organization-records', occurredAt: now }
    })
    expect(cleared.physicalShards).toEqual(snapshot.physicalShards)
  })

  it('keeps the latest classification source when a protected video is organized again', () => {
    const snapshot = createAccountFavoriteRepositorySnapshot({
      accountMid: '100', now: '2026-07-20T00:00:00.000Z'
    })

    const result = applyFavoriteRepositoryCommand(snapshot, {
      id: 'protections-with-source', accountMid: '100', issuedAt: '2026-07-20T00:00:00.000Z', type: 'record-organization-protections',
      payload: { records: [
        { accountMid: '100', aid: 1, targetFolderIds: ['remote-music'], completedAt: '2026-07-20T00:00:00.000Z', classificationSource: 'system-high' },
        { accountMid: '100', aid: 1, targetFolderIds: ['remote-knowledge'], completedAt: '2026-07-20T00:01:00.000Z', classificationSource: 'manual' }
      ] }
    }, '2026-07-20T00:01:00.000Z')

    expect(result.organizationRecords).toEqual([
      expect.objectContaining({
        aid: 1,
        targetFolderIds: ['remote-knowledge', 'remote-music'],
        classificationSource: 'manual'
      })
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
