import { describe, expect, it, vi } from 'vitest'
import type { AccountFavoriteRepositorySnapshot, FavoriteRepositoryCommand } from '../../src/shared/favoriteRepository'
import { applyFavoriteRepositoryCommand, createAccountFavoriteRepositorySnapshot } from '../../src/shared/favoriteRepository'
import { FavoriteRepositoryBatchOperationService } from './favoriteRepositoryBatchOperationService'
import { FavoriteRepositoryRemoteOperationArbiter } from './favoriteRepositoryRemoteOperationArbiter'

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
      , '100:3': { accountMid: '100', aid: 3, localDesiredFolderIds: ['bilimi-logical:source'], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], positionState: 'local-only-change', updatedAt: '2026-07-24T00:00:00.000Z', revision: 7 }
    }
  }
}

function repository(current: AccountFavoriteRepositorySnapshot, commit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))) {
  return {
    getSnapshot: vi.fn(async () => current),
    commit,
    commitWithAudit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))
  }
}

describe('FavoriteRepositoryBatchOperationService', () => {
  it('removes only selected bilimi placements while preserving ordinary Bilibili memberships', async () => {
    let current = {
      ...snapshot(),
      folders: [
        ...snapshot().folders,
        { id: 'bilibili:ordinary', title: 'Ordinary', kind: 'bilibili' as const, remoteFolderId: '88', syncState: 'bound' as const }
      ],
      memberships: { ...snapshot().memberships, 'bilibili:ordinary': [1] },
      physicalShards: [
        { logicalLedgerId: 'source', folderId: 'bilimi-physical:source:1', shardNumber: 1, remoteFolderId: '11', remoteTitle: 'bilimi Source', bindingState: 'bound' as const },
        { logicalLedgerId: 'target', folderId: 'bilimi-physical:target:1', shardNumber: 1, remoteFolderId: '12', remoteTitle: 'bilimi Target', bindingState: 'bound' as const }
      ],
      positions: {
        ...snapshot().positions,
        '100:1': { ...snapshot().positions['100:1'], remoteObservedPhysicalFolderIds: ['11'], remoteObservedLogicalFolderIds: ['bilimi-logical:source'] }
      }
    }
    const commands: FavoriteRepositoryCommand[] = []
    const repo = {
      getSnapshot: vi.fn(async () => current),
      commit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => {
        commands.push(command)
        current = applyFavoriteRepositoryCommand(current, command, command.issuedAt)
        return current
      }),
      commitWithAudit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => {
        commands.push(command)
        current = applyFavoriteRepositoryCommand(current, command, command.issuedAt)
        return current
      })
    }
    const synchronizePlacements = vi.fn(async (_account: string, selected: number[]) => {
      const position = current.positions['100:1']
      current = {
        ...current,
        positions: {
          ...current.positions,
          '100:1': { ...position, remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], positionState: 'aligned' as const }
        }
      }
      return { status: 'succeeded' as const, completedOperationCount: selected.length, totalOperationCount: selected.length, affectedAids: selected }
    })
    const globalUnfavorite = vi.fn()
    const service = new FavoriteRepositoryBatchOperationService({
      repository: repo,
      placementSync: { synchronizePlacements },
      remoteUnfavorite: { unfavorite: globalUnfavorite },
      now: () => '2026-07-24T01:00:00.000Z'
    })

    const preview = await service.previewManagedPlacementRemoval('100', [1], ['bilimi-logical:source'], 7, { kind: 'bilibili-user', folderId: 'bilibili:ordinary' })
    expect(preview).toMatchObject({
      aids: [1],
      selectedLogicalFolderIds: ['bilimi-logical:source'],
      removablePhysicalFolderIds: ['11'],
      preservedOrdinarySources: [{ id: 'bilibili:ordinary', title: 'Ordinary' }],
      recycleAids: []
    })
    const confirmation = service.confirmManagedPlacementRemoval('100', preview.executionToken)
    await expect(service.executeManagedPlacementRemoval('100', preview.executionToken, confirmation)).resolves.toMatchObject({ status: 'succeeded' })

    expect(synchronizePlacements).toHaveBeenCalledWith('100', [1])
    expect(globalUnfavorite).not.toHaveBeenCalled()
    expect(current.memberships['bilibili:ordinary']).toEqual([1])
    expect(current.positions['100:1'].localDesiredFolderIds).toEqual([])
    expect(commands).not.toContainEqual(expect.objectContaining({ type: 'delete-favorite-from-library' }))
  })

  it('skips locally staged bilimi placements that have no observed Bilibili membership', async () => {
    const service = new FavoriteRepositoryBatchOperationService({ repository: repository(snapshot()), placementSync: { synchronizePlacements: vi.fn() } })

    const preview = await service.previewManagedPlacementRemoval('100', [1, 3], ['bilimi-logical:source'], 7)

    expect(preview.aids).toEqual([1])
    expect(preview.skippedUnsyncedAids).toEqual([3])
  })

  it('recycles only after a managed placement removal is confirmed aligned and preserves local evidence', async () => {
    let current = {
      ...snapshot(),
      videos: { '1': { aid: 1, title: 'Kept title', description: 'Kept description', tags: ['kept-tag'], updatedAt: '2026-07-24T00:00:00.000Z' } },
      libraryMirrors: { '1': { aid: 1, status: 'synced' as const, metadataRevision: 2, lastSyncedAt: '2026-07-24T00:00:00.000Z' } },
      organizationRecords: [{ accountMid: '100', aid: 1, targetFolderIds: ['bilimi-logical:source'], completedAt: '2026-07-24T00:00:00.000Z' }],
      physicalShards: [{ logicalLedgerId: 'source', folderId: 'bilimi-physical:source:1', shardNumber: 1, remoteFolderId: '11', remoteTitle: 'bilimi Source', bindingState: 'bound' as const }],
      positions: {
        ...snapshot().positions,
        '100:1': { ...snapshot().positions['100:1'], sourceAuthority: 'complete' as const }
      }
    }
    const originalVideo = current.videos['1']
    const originalMirror = current.libraryMirrors['1']
    const originalOrganization = current.organizationRecords[0]
    const repo = {
      getSnapshot: vi.fn(async () => current),
      commit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => {
        current = applyFavoriteRepositoryCommand(current, command, command.issuedAt)
        return current
      }),
      commitWithAudit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => {
        current = applyFavoriteRepositoryCommand(current, command, command.issuedAt)
        return current
      })
    }
    const service = new FavoriteRepositoryBatchOperationService({
      repository: repo,
      placementSync: {
        synchronizePlacements: vi.fn(async () => {
          current = { ...current, positions: { ...current.positions, '100:1': { ...current.positions['100:1'], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], positionState: 'aligned' as const } } }
          return { status: 'succeeded' as const, completedOperationCount: 1, totalOperationCount: 1, affectedAids: [1] }
        })
      },
      now: () => '2026-07-24T01:00:00.000Z'
    })

    const preview = await service.previewManagedPlacementRemoval('100', [1], ['bilimi-logical:source'], 7)
    expect(preview.recycleAids).toEqual([1])
    await service.executeManagedPlacementRemoval('100', preview.executionToken, service.confirmManagedPlacementRemoval('100', preview.executionToken))

    expect(current.tombstones['100:1']).toMatchObject({ aid: 1, allowRediscovery: true, kind: 'recycled' })
    expect(current.videos['1']).toEqual({
      ...originalVideo,
      lastAdjustment: { kind: 'managed-placement-remove', occurredAt: '2026-07-24T01:00:00.000Z' }
    })
    expect(current.libraryMirrors['1']).toEqual(originalMirror)
    expect(current.organizationRecords[0]).toEqual(originalOrganization)
  })

  it('does not recycle a confirmed managed placement removal while a remote source remains observed', async () => {
    let current = {
      ...snapshot(),
      physicalShards: [{ logicalLedgerId: 'source', folderId: 'bilimi-physical:source:1', shardNumber: 1, remoteFolderId: '11', remoteTitle: 'bilimi Source', bindingState: 'bound' as const }],
      positions: {
        ...snapshot().positions,
        '100:1': { ...snapshot().positions['100:1'], sourceAuthority: 'complete' as const }
      }
    }
    const commands: FavoriteRepositoryCommand[] = []
    const repo = {
      getSnapshot: vi.fn(async () => current),
      commit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => {
        commands.push(command)
        current = applyFavoriteRepositoryCommand(current, command, command.issuedAt)
        return current
      }),
      commitWithAudit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => {
        commands.push(command)
        current = applyFavoriteRepositoryCommand(current, command, command.issuedAt)
        return current
      })
    }
    const service = new FavoriteRepositoryBatchOperationService({
      repository: repo,
      placementSync: {
        synchronizePlacements: vi.fn(async () => {
          current = {
            ...current,
            positions: {
              ...current.positions,
              '100:1': {
                ...current.positions['100:1'],
                localDesiredFolderIds: [],
                remoteObservedPhysicalFolderIds: ['11'],
                remoteObservedLogicalFolderIds: ['bilimi-logical:source'],
                positionState: 'aligned' as const
              }
            }
          }
          return { status: 'succeeded' as const, completedOperationCount: 1, totalOperationCount: 1, affectedAids: [1] }
        })
      },
      now: () => '2026-07-24T01:00:00.000Z'
    })

    const preview = await service.previewManagedPlacementRemoval('100', [1], ['bilimi-logical:source'], 7)
    await expect(service.executeManagedPlacementRemoval('100', preview.executionToken, service.confirmManagedPlacementRemoval('100', preview.executionToken)))
      .resolves.toMatchObject({ status: 'succeeded' })

    expect(commands.map((command) => command.type)).not.toContain('recycle-favorites')
    expect(current.tombstones['100:1']).toBeUndefined()
  })

  it('does not preview or recycle a remote managed placement removal while source evidence is incomplete', async () => {
    let current = {
      ...snapshot(),
      physicalShards: [{ logicalLedgerId: 'source', folderId: 'bilimi-physical:source:1', shardNumber: 1, remoteFolderId: '11', remoteTitle: 'bilimi Source', bindingState: 'bound' as const }],
      positions: {
        ...snapshot().positions,
        '100:1': {
          ...snapshot().positions['100:1'],
          sourceAuthority: 'incomplete' as const
        }
      }
    }
    const commands: FavoriteRepositoryCommand[] = []
    const repo = {
      getSnapshot: vi.fn(async () => current),
      commit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => {
        commands.push(command)
        current = applyFavoriteRepositoryCommand(current, command, command.issuedAt)
        return current
      }),
      commitWithAudit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => {
        commands.push(command)
        current = applyFavoriteRepositoryCommand(current, command, command.issuedAt)
        return current
      })
    }
    const service = new FavoriteRepositoryBatchOperationService({
      repository: repo,
      placementSync: {
        synchronizePlacements: vi.fn(async () => {
          current = {
            ...current,
            positions: {
              ...current.positions,
              '100:1': {
                ...current.positions['100:1'],
                remoteObservedPhysicalFolderIds: [],
                remoteObservedLogicalFolderIds: [],
                positionState: 'aligned' as const
              }
            }
          }
          return { status: 'succeeded' as const, completedOperationCount: 1, totalOperationCount: 1, affectedAids: [1] }
        })
      },
      now: () => '2026-07-24T01:00:00.000Z'
    })

    const preview = await service.previewManagedPlacementRemoval('100', [1], ['bilimi-logical:source'], 7)
    expect(preview.recycleAids).toEqual([])
    await expect(service.executeManagedPlacementRemoval('100', preview.executionToken, service.confirmManagedPlacementRemoval('100', preview.executionToken)))
      .resolves.toMatchObject({ status: 'succeeded' })

    expect(commands.map((command) => command.type)).not.toContain('recycle-favorites')
    expect(current.tombstones['100:1']).toBeUndefined()
  })

  it('keeps result-unknown out of recycle and reconciles without retrying the remote write', async () => {
    let current = {
      ...snapshot(),
      videos: { '1': { aid: 1, title: 'Kept title', tags: ['kept-tag'], updatedAt: '2026-07-24T00:00:00.000Z' } },
      physicalShards: [{ logicalLedgerId: 'source', folderId: 'bilimi-physical:source:1', shardNumber: 1, remoteFolderId: '11', remoteTitle: 'bilimi Source', bindingState: 'bound' as const }],
      positions: {
        ...snapshot().positions,
        '100:1': { ...snapshot().positions['100:1'], sourceAuthority: 'complete' as const }
      }
    }
    const repo = {
      getSnapshot: vi.fn(async () => current),
      commit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => {
        current = applyFavoriteRepositoryCommand(current, command, command.issuedAt)
        return current
      }),
      commitWithAudit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => {
        current = applyFavoriteRepositoryCommand(current, command, command.issuedAt)
        return current
      })
    }
    const synchronizePlacements = vi.fn(async () => {
      current = { ...current, positions: { ...current.positions, '100:1': { ...current.positions['100:1'], positionState: 'result-unknown' as const, reason: 'timeout' } } }
      return { status: 'failed' as const, completedOperationCount: 0, totalOperationCount: 1, affectedAids: [1] }
    })
    const service = new FavoriteRepositoryBatchOperationService({ repository: repo, placementSync: { synchronizePlacements }, now: () => '2026-07-24T01:00:00.000Z' })

    const preview = await service.previewManagedPlacementRemoval('100', [1], ['bilimi-logical:source'], 7)
    await expect(service.executeManagedPlacementRemoval('100', preview.executionToken, service.confirmManagedPlacementRemoval('100', preview.executionToken)))
      .resolves.toMatchObject({ status: 'result-unknown' })
    expect(current.positions['100:1'].localDesiredFolderIds).toEqual(['bilimi-logical:source'])
    expect(current.tombstones['100:1']).toBeUndefined()
    await expect(service.reconcileManagedPlacementRemoval('100', preview.operationId)).resolves.toMatchObject({ status: 'reconciliation-required' })
    expect(synchronizePlacements).toHaveBeenCalledTimes(1)

    current = { ...current, positions: { ...current.positions, '100:1': { ...current.positions['100:1'], remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], positionState: 'aligned' as const } } }
    await expect(service.reconcileManagedPlacementRemoval('100', preview.operationId)).resolves.toMatchObject({ status: 'completed' })
    expect(synchronizePlacements).toHaveBeenCalledTimes(1)
    expect(current.tombstones['100:1']).toMatchObject({ kind: 'recycled' })
    expect(current.positions['100:1'].localDesiredFolderIds).toEqual([])
  })

  it('restores the local bilimi placement when remote managed deletion is rejected', async () => {
    let current = {
      ...snapshot(),
      physicalShards: [{ logicalLedgerId: 'source', folderId: 'bilimi-physical:source:1', shardNumber: 1, remoteFolderId: '11', remoteTitle: 'bilimi Source', bindingState: 'bound' as const }],
      positions: {
        ...snapshot().positions,
        '100:1': { ...snapshot().positions['100:1'], sourceAuthority: 'complete' as const }
      }
    }
    const repo = {
      getSnapshot: vi.fn(async () => current),
      commit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => {
        current = applyFavoriteRepositoryCommand(current, command, command.issuedAt)
        return current
      }),
      commitWithAudit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => {
        current = applyFavoriteRepositoryCommand(current, command, command.issuedAt)
        return current
      })
    }
    const synchronizePlacements = vi.fn(async () => {
      current = {
        ...current,
        positions: {
          ...current.positions,
          '100:1': { ...current.positions['100:1'], positionState: 'failed' as const, reason: 'remote rejected' }
        }
      }
      return { status: 'failed' as const, completedOperationCount: 0, totalOperationCount: 1, affectedAids: [1] }
    })
    const service = new FavoriteRepositoryBatchOperationService({ repository: repo, placementSync: { synchronizePlacements }, now: () => '2026-07-24T01:00:00.000Z' })

    const preview = await service.previewManagedPlacementRemoval('100', [1], ['bilimi-logical:source'], 7)
    await expect(service.executeManagedPlacementRemoval('100', preview.executionToken, service.confirmManagedPlacementRemoval('100', preview.executionToken)))
      .resolves.toMatchObject({ status: 'failed' })

    expect(current.positions['100:1']).toMatchObject({
      localDesiredFolderIds: ['bilimi-logical:source'],
      positionState: 'failed',
      reason: 'remote rejected'
    })
    expect(current.tombstones['100:1']).toBeUndefined()
  })

  it('rejects a local library deletion that does not identify the current bilimi work folder', async () => {
    const current = snapshot()
    const commit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [1, 2], affectedFolderIds: [] }))
    const commitWithAudit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [1, 2], affectedFolderIds: [] }))
    const service = new FavoriteRepositoryBatchOperationService({ repository: { getSnapshot: vi.fn(async () => current), commit, commitWithAudit }, now: () => '2026-07-24T01:00:00.000Z' })

    await expect(service.deleteLocal('100', [2, 1], 7)).rejects.toThrow('current Bilimi work folder')
    expect(commitWithAudit).not.toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
  })

  it('removes a local bilimi placement without a permanent tombstone and recycles it when complete evidence has no remaining source', async () => {
    let current = {
      ...snapshot(),
      videos: { '1': { aid: 1, title: 'Keep local record', tags: ['kept'], updatedAt: '2026-07-24T00:00:00.000Z' } },
      libraryMirrors: { '1': { aid: 1, status: 'synced' as const, metadataRevision: 2, lastSyncedAt: '2026-07-24T00:00:00.000Z' } },
      organizationRecords: [{ accountMid: '100', aid: 1, targetFolderIds: ['bilimi-logical:source'], completedAt: '2026-07-24T00:00:00.000Z' }],
      positions: {
        ...snapshot().positions,
        '100:1': {
          ...snapshot().positions['100:1'],
          remoteObservedPhysicalFolderIds: [],
          remoteObservedLogicalFolderIds: [],
          positionState: 'aligned' as const,
          sourceAuthority: 'complete' as const
        }
      }
    }
    const commands: FavoriteRepositoryCommand[] = []
    const repo = {
      getSnapshot: vi.fn(async () => current),
      commit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => {
        commands.push(command)
        current = applyFavoriteRepositoryCommand(current, command, command.issuedAt)
        return current
      }),
      commitWithAudit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => {
        commands.push(command)
        current = applyFavoriteRepositoryCommand(current, command, command.issuedAt)
        return current
      })
    }
    const originalMirror = current.libraryMirrors['1']
    const originalOrganization = current.organizationRecords[0]
    const service = new FavoriteRepositoryBatchOperationService({ repository: repo, now: () => '2026-07-24T01:00:00.000Z' })

    await expect(service.deleteLocal('100', [1], 7, { kind: 'bilimi-logical', folderId: 'bilimi-logical:source' }))
      .resolves.toMatchObject({ status: 'succeeded', completedOperationCount: 1, totalOperationCount: 1, affectedAids: [1], auditStatus: 'recorded' })

    expect(commands.map((command) => command.type)).toEqual(['set-favorite-placements', 'recycle-favorites'])
    expect(commands).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'delete-favorite-from-library' }),
      expect.objectContaining({ type: 'delete-favorites-from-library' })
    ]))
    expect(current.positions['100:1'].localDesiredFolderIds).toEqual([])
    expect(current.tombstones['100:1']).toMatchObject({ allowRediscovery: true, kind: 'recycled' })
    expect(current.videos['1']).toMatchObject({ aid: 1, title: 'Keep local record' })
    expect(current.libraryMirrors['1']).toEqual(originalMirror)
    expect(current.organizationRecords[0]).toEqual(originalOrganization)
  })

  it('keeps a local bilimi deletion in the library when a complete scan still reports an ordinary Bilibili source', async () => {
    let current = {
      ...snapshot(),
      folders: [
        ...snapshot().folders,
        { id: 'bilibili:ordinary', title: 'Ordinary source', kind: 'bilibili' as const, remoteFolderId: '88', syncState: 'bound' as const }
      ],
      memberships: { ...snapshot().memberships, 'bilibili:ordinary': [1] },
      positions: {
        ...snapshot().positions,
        '100:1': {
          ...snapshot().positions['100:1'],
          remoteObservedPhysicalFolderIds: [],
          remoteObservedLogicalFolderIds: [],
          positionState: 'aligned' as const,
          sourceAuthority: 'complete' as const
        }
      }
    }
    const commands: FavoriteRepositoryCommand[] = []
    const repo = {
      getSnapshot: vi.fn(async () => current),
      commit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => {
        commands.push(command)
        current = applyFavoriteRepositoryCommand(current, command, command.issuedAt)
        return current
      }),
      commitWithAudit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => {
        commands.push(command)
        current = applyFavoriteRepositoryCommand(current, command, command.issuedAt)
        return current
      })
    }
    const service = new FavoriteRepositoryBatchOperationService({ repository: repo, now: () => '2026-07-24T01:00:00.000Z' })

    await service.deleteLocal('100', [1], 7, { kind: 'bilimi-logical', folderId: 'bilimi-logical:source' })

    expect(commands.map((command) => command.type)).toEqual(['set-favorite-placements'])
    expect(current.memberships['bilibili:ordinary']).toEqual([1])
    expect(current.tombstones['100:1']).toBeUndefined()
  })

  it('does not recycle a local bilimi deletion while source evidence is incomplete', async () => {
    let current = {
      ...snapshot(),
      positions: {
        ...snapshot().positions,
        '100:1': {
          ...snapshot().positions['100:1'],
          remoteObservedPhysicalFolderIds: [],
          remoteObservedLogicalFolderIds: [],
          positionState: 'aligned' as const,
          sourceAuthority: 'incomplete' as const
        }
      }
    }
    const commands: FavoriteRepositoryCommand[] = []
    const repo = {
      getSnapshot: vi.fn(async () => current),
      commit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => {
        commands.push(command)
        current = applyFavoriteRepositoryCommand(current, command, command.issuedAt)
        return current
      }),
      commitWithAudit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => {
        commands.push(command)
        current = applyFavoriteRepositoryCommand(current, command, command.issuedAt)
        return current
      })
    }
    const service = new FavoriteRepositoryBatchOperationService({ repository: repo, now: () => '2026-07-24T01:00:00.000Z' })

    await service.deleteLocal('100', [1], 7, { kind: 'bilimi-logical', folderId: 'bilimi-logical:source' })

    expect(commands.map((command) => command.type)).toEqual(['set-favorite-placements'])
    expect(current.tombstones['100:1']).toBeUndefined()
  })

  it('keeps an ambiguous remote state out of recycle when removing a local bilimi placement', async () => {
    let current = {
      ...snapshot(),
      positions: {
        ...snapshot().positions,
        '100:1': {
          ...snapshot().positions['100:1'],
          remoteObservedPhysicalFolderIds: [],
          remoteObservedLogicalFolderIds: [],
          positionState: 'result-unknown' as const,
          sourceAuthority: 'complete' as const,
          reason: 'timeout'
        }
      }
    }
    const commands: FavoriteRepositoryCommand[] = []
    const repo = {
      getSnapshot: vi.fn(async () => current),
      commit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => {
        commands.push(command)
        current = applyFavoriteRepositoryCommand(current, command, command.issuedAt)
        return current
      }),
      commitWithAudit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => {
        commands.push(command)
        current = applyFavoriteRepositoryCommand(current, command, command.issuedAt)
        return current
      })
    }
    const service = new FavoriteRepositoryBatchOperationService({ repository: repo, now: () => '2026-07-24T01:00:00.000Z' })

    await service.deleteLocal('100', [1], 7, { kind: 'bilimi-logical', folderId: 'bilimi-logical:source' })

    expect(commands.map((command) => command.type)).toEqual(['set-favorite-placements'])
    expect(current.positions['100:1']).toMatchObject({
      localDesiredFolderIds: [],
      positionState: 'result-unknown',
      reason: 'timeout'
    })
    expect(current.tombstones['100:1']).toBeUndefined()
  })

  it('keeps a remote-removed state out of recycle when removing a local bilimi placement', async () => {
    let current = {
      ...snapshot(),
      positions: {
        ...snapshot().positions,
        '100:1': {
          ...snapshot().positions['100:1'],
          remoteObservedPhysicalFolderIds: [],
          remoteObservedLogicalFolderIds: [],
          positionState: 'remote-removed' as const,
          sourceAuthority: 'complete' as const,
          reason: 'remote folder deletion awaits reconciliation'
        }
      }
    }
    const commands: FavoriteRepositoryCommand[] = []
    const repo = {
      getSnapshot: vi.fn(async () => current),
      commit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => {
        commands.push(command)
        current = applyFavoriteRepositoryCommand(current, command, command.issuedAt)
        return current
      }),
      commitWithAudit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => {
        commands.push(command)
        current = applyFavoriteRepositoryCommand(current, command, command.issuedAt)
        return current
      })
    }
    const service = new FavoriteRepositoryBatchOperationService({ repository: repo, now: () => '2026-07-24T01:00:00.000Z' })

    await service.deleteLocal('100', [1], 7, { kind: 'bilimi-logical', folderId: 'bilimi-logical:source' })

    expect(commands.map((command) => command.type)).toEqual(['set-favorite-placements'])
    expect(current.positions['100:1']).toMatchObject({
      localDesiredFolderIds: [],
      positionState: 'remote-removed',
      reason: 'remote folder deletion awaits reconciliation'
    })
    expect(current.tombstones['100:1']).toBeUndefined()
  })

  it('removes only the current bilimi placement when the video also belongs to another bilimi work folder', async () => {
    let current = {
      ...snapshot(),
      positions: {
        ...snapshot().positions,
        '100:2': {
          ...snapshot().positions['100:2'],
          remoteObservedPhysicalFolderIds: [],
          remoteObservedLogicalFolderIds: [],
          positionState: 'aligned' as const,
          sourceAuthority: 'complete' as const
        }
      }
    }
    const commands: FavoriteRepositoryCommand[] = []
    const repo = {
      getSnapshot: vi.fn(async () => current),
      commit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => {
        commands.push(command)
        current = applyFavoriteRepositoryCommand(current, command, command.issuedAt)
        return current
      }),
      commitWithAudit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => {
        commands.push(command)
        current = applyFavoriteRepositoryCommand(current, command, command.issuedAt)
        return current
      })
    }
    const service = new FavoriteRepositoryBatchOperationService({ repository: repo, now: () => '2026-07-24T01:00:00.000Z' })

    await service.deleteLocal('100', [2], 7, { kind: 'bilimi-logical', folderId: 'bilimi-logical:source' })

    expect(commands.map((command) => command.type)).toEqual(['set-favorite-placements'])
    expect(current.positions['100:2'].localDesiredFolderIds).toEqual(['bilimi-logical:target'])
    expect(current.memberships['bilimi-logical:source']).not.toContain(2)
    expect(current.memberships['bilimi-logical:target']).toContain(2)
    expect(current.tombstones['100:2']).toBeUndefined()
  })

  it('removes all explicitly scoped bilimi placements in one local command and returns a command result', async () => {
    let current = {
      ...snapshot(),
      positions: {
        ...snapshot().positions,
        '100:2': {
          ...snapshot().positions['100:2'],
          remoteObservedPhysicalFolderIds: [],
          remoteObservedLogicalFolderIds: [],
          positionState: 'aligned' as const,
          sourceAuthority: 'complete' as const
        }
      }
    }
    const commands: FavoriteRepositoryCommand[] = []
    const repo = {
      getSnapshot: vi.fn(async () => current),
      commit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => {
        commands.push(command)
        current = applyFavoriteRepositoryCommand(current, command, command.issuedAt)
        return current
      }),
      commitWithAudit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => {
        commands.push(command)
        current = applyFavoriteRepositoryCommand(current, command, command.issuedAt)
        return current
      })
    }
    const service = new FavoriteRepositoryBatchOperationService({ repository: repo, now: () => '2026-07-24T01:00:00.000Z' })

    await expect(service.deleteLocal('100', [2], 7, {
      kind: 'bilimi-logical', folderId: 'bilimi-logical:source',
      folderIds: ['bilimi-logical:source', 'bilimi-logical:target']
    } as never)).resolves.toMatchObject({
      status: 'succeeded', completedOperationCount: 1, totalOperationCount: 1, affectedAids: [2], auditStatus: 'recorded'
    })

    expect(commands.map((command) => command.type)).toEqual(['set-favorite-placements', 'recycle-favorites'])
    expect(commands[0]).toMatchObject({
      type: 'set-favorite-placements',
      payload: { placements: [{ aid: 2, localDesiredFolderIds: [] }] }
    })
    expect(current.tombstones['100:2']).toMatchObject({ allowRediscovery: true, kind: 'recycled' })
  })

  it('copies additively and moves only current Bilimi logical membership, with immutable audits', async () => {
    const current = snapshot()
    const commit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))
    const commitWithAudit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))
    const service = new FavoriteRepositoryBatchOperationService({ repository: { getSnapshot: vi.fn(async () => current), commit, commitWithAudit }, now: () => '2026-07-24T01:00:00.000Z' })

    await service.copy('100', [1, 2], ['bilimi-logical:target'], 7)
    expect(commitWithAudit.mock.calls[0][1]).toMatchObject({ type: 'set-favorite-placements', payload: { placements: [
      { aid: 1, localDesiredFolderIds: ['bilimi-logical:source', 'bilimi-logical:target'] },
      { aid: 2, localDesiredFolderIds: ['bilimi-logical:source', 'bilimi-logical:target'] }
    ] } })
    await service.move('100', [1, 2], 'bilimi-logical:source', ['bilimi-logical:target'], 7)
    expect(commitWithAudit.mock.calls[1][1]).toMatchObject({ type: 'set-favorite-placements', payload: { placements: [
      { aid: 1, localDesiredFolderIds: ['bilimi-logical:target'] }, { aid: 2, localDesiredFolderIds: ['bilimi-logical:target'] }
    ] } })
    expect(commit).not.toHaveBeenCalled()
  })

  it('splits an all-results bilimi placement deletion into revision-linked command-sized commits', async () => {
    const selected = Array.from({ length: 101 }, (_value, index) => index + 1)
    const current = {
      ...snapshot(),
      positions: Object.fromEntries(selected.map((aid) => [`100:${aid}`, {
        accountMid: '100', aid, localDesiredFolderIds: ['bilimi-logical:source'],
        remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: [], positionState: 'local-only-change' as const,
        updatedAt: '2026-07-24T00:00:00.000Z', revision: 7
      }]))
    }
    const commits: FavoriteRepositoryCommand[] = []
    let revision = 7
    const commitWithAudit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => {
      commits.push(command)
      revision++
      return { ...current, revision, commandId: command.id, affectedAids: command.payload.placements.map((placement) => placement.aid), affectedFolderIds: [] }
    })
    const service = new FavoriteRepositoryBatchOperationService({
      repository: { getSnapshot: vi.fn(async () => ({ ...current, revision })), commit: vi.fn(), commitWithAudit },
      now: () => '2026-07-24T01:00:00.000Z'
    })

    await expect(service.deleteLocal('100', selected, 7, { kind: 'bilimi-logical', folderId: 'bilimi-logical:source' })).resolves.toMatchObject({ revision: 9, auditStatus: 'recorded' })
    expect(commits).toHaveLength(2)
    expect(commits.map((command) => command.expectedRevision)).toEqual([7, 8])
    expect(commits.map((command) => command.type)).toEqual(['set-favorite-placements', 'set-favorite-placements'])
    expect(commits.map((command) => command.payload.placements.length)).toEqual([100, 1])
  })

  it('previews all Bilibili-membership unfavorites, stops on unknown results, and requires explicit reconciliation', async () => {
    const current = snapshot()
    const unfavorite = vi.fn(async () => ({ status: 'result-unknown' as const, completedOperationCount: 0, totalOperationCount: 2, affectedAids: [1, 2], reason: 'timeout' }))
    const commit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))
    const service = new FavoriteRepositoryBatchOperationService({ repository: repository(current, commit), remoteUnfavorite: { unfavorite }, now: () => '2026-07-24T01:00:00.000Z' })
    const preview = await service.previewRemoteUnfavorite('100', [2, 1], 7)
    expect(preview).toMatchObject({ aids: [1, 2], removesAllBilibiliMembership: true, baselineRevision: 7 })
    const confirmation = service.confirmRemoteUnfavorite('100', preview.executionToken)
    await expect(service.executeRemoteUnfavorite('100', preview.executionToken, confirmation)).resolves.toMatchObject({ status: 'result-unknown' })
    expect(unfavorite).toHaveBeenCalledTimes(1)
    await expect(service.executeRemoteUnfavorite('100', preview.executionToken, confirmation)).rejects.toThrow('confirmation')
    await expect(service.reconcileRemoteUnfavorite('100', preview.operationId)).resolves.toMatchObject({ status: 'reconciliation-required' })
  })

  it('keeps one confirmed remote-unfavorite preview while executing a large selection in command-sized chunks', async () => {
    const current = snapshot()
    const selected = Array.from({ length: 101 }, (_value, index) => index + 1)
    const unfavorite = vi.fn(async (_account: string, aids: number[]) => ({
      status: 'succeeded' as const, completedOperationCount: aids.length, totalOperationCount: aids.length, affectedAids: aids
    }))
    const service = new FavoriteRepositoryBatchOperationService({
      repository: repository(current), remoteUnfavorite: { unfavorite }, now: () => '2026-07-24T01:00:00.000Z'
    })
    const preview = await service.previewRemoteUnfavorite('100', selected, 7, { kind: 'bilimi-logical' })

    await expect(service.executeRemoteUnfavorite('100', preview.executionToken, service.confirmRemoteUnfavorite('100', preview.executionToken)))
      .resolves.toMatchObject({ status: 'succeeded', completedOperationCount: 101, totalOperationCount: 101 })
    expect(unfavorite.mock.calls.map((call) => (call[1] as number[]).length)).toEqual([100, 1])
  })

  it('keeps a known remote unfavorite rejection failed and actionable', async () => {
    const current = snapshot()
    const commit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))
    const service = new FavoriteRepositoryBatchOperationService({
      repository: repository(current, commit),
      remoteUnfavorite: { unfavorite: vi.fn(async () => ({ status: 'failed' as const, completedOperationCount: 0, totalOperationCount: 1, affectedAids: [1], reason: 'rejected' })) }
    })
    const preview = await service.previewRemoteUnfavorite('100', [1], 7)
    const confirmation = service.confirmRemoteUnfavorite('100', preview.executionToken)

    await expect(service.executeRemoteUnfavorite('100', preview.executionToken, confirmation)).resolves.toMatchObject({ status: 'failed' })
    await expect(service.reconcileRemoteUnfavorite('100', preview.operationId)).resolves.toMatchObject({ status: 'failed' })
  })

  it('atomically commits the remote-unfavorite checkpoint and immutable audit events', async () => {
    const current = snapshot()
    const commit = vi.fn()
    const commitWithAudit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand, events: unknown[]) => ({
      ...current, commandId: command.id, affectedAids: [1], affectedFolderIds: [], events
    }))
    const service = new FavoriteRepositoryBatchOperationService({
      repository: { getSnapshot: vi.fn(async () => current), commit, commitWithAudit },
      remoteUnfavorite: { unfavorite: vi.fn(async () => ({ status: 'result-unknown' as const, completedOperationCount: 0, totalOperationCount: 1, affectedAids: [1] })) }
    })

    const preview = await service.previewRemoteUnfavorite('100', [1], 7)
    await service.executeRemoteUnfavorite('100', preview.executionToken, service.confirmRemoteUnfavorite('100', preview.executionToken))

    expect(commit).not.toHaveBeenCalled()
    expect(commitWithAudit).toHaveBeenCalledWith('100', expect.objectContaining({
      type: 'record-sync-result', payload: expect.objectContaining({ status: 'result-unknown' })
    }), expect.arrayContaining([expect.objectContaining({ aid: 1, detail: 'remote-unfavorite-result-unknown' })]))
  })

  it('does not deadlock when the remote unfavorite adapter serializes itself through the real arbiter', async () => {
    const current = snapshot()
    const arbiter = new FavoriteRepositoryRemoteOperationArbiter()
    const service = new FavoriteRepositoryBatchOperationService({
      repository: repository(current),
      remoteArbiter: arbiter,
      remoteUnfavorite: {
        unfavorite: (accountMid, selectedAids) => arbiter.enqueue(
          accountMid,
          { priority: 'user-single', videoKey: `unfavorite:${selectedAids[0]}` },
          async () => ({ status: 'succeeded' as const, completedOperationCount: 1, totalOperationCount: 1, affectedAids: selectedAids })
        )
      }
    })
    const preview = await service.previewRemoteUnfavorite('100', [1], 7)

    await expect(Promise.race([
      service.executeRemoteUnfavorite('100', preview.executionToken, service.confirmRemoteUnfavorite('100', preview.executionToken)),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('nested remote operation timed out')), 100))
    ])).resolves.toMatchObject({ status: 'succeeded', auditStatus: 'recorded' })
  })

  it('rechecks the baseline when a queued batch unfavorite reaches its remote write', async () => {
    let current = snapshot()
    let releaseFirst!: () => void
    const firstStarted = new Promise<void>((resolve) => { releaseFirst = resolve })
    const unfavorite = vi.fn(async () => {
      if (unfavorite.mock.calls.length === 1) await firstStarted
      return { status: 'succeeded' as const, completedOperationCount: 1, totalOperationCount: 1, affectedAids: [1] }
    })
    const service = new FavoriteRepositoryBatchOperationService({
      repository: {
        getSnapshot: vi.fn(async () => current),
        commit: vi.fn(),
        commitWithAudit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => {
          current = { ...current, revision: current.revision + 1 }
          return { ...current, commandId: command.id, affectedAids: [1], affectedFolderIds: [] }
        })
      },
      remoteUnfavorite: { unfavorite }
    })
    const first = await service.previewRemoteUnfavorite('100', [1], 7)
    const second = await service.previewRemoteUnfavorite('100', [1], 7)
    const firstRun = service.executeRemoteUnfavorite('100', first.executionToken, service.confirmRemoteUnfavorite('100', first.executionToken))
    const secondRun = service.executeRemoteUnfavorite('100', second.executionToken, service.confirmRemoteUnfavorite('100', second.executionToken))

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(unfavorite).toHaveBeenCalledTimes(1)
    releaseFirst()
    await firstRun
    await expect(secondRun).rejects.toThrow('stale')
    expect(unfavorite).toHaveBeenCalledTimes(1)
  })

  it('checks the baseline inside every shared-arbiter remote write before mutating', async () => {
    let current = snapshot()
    const arbiter = new FavoriteRepositoryRemoteOperationArbiter()
    const remoteWrites: number[] = []
    let releaseBlocker!: () => void
    const blocker = new Promise<void>((resolve) => { releaseBlocker = resolve })
    void arbiter.enqueue('100', { priority: 'user-single', videoKey: 'blocker' }, async () => blocker)
    const service = new FavoriteRepositoryBatchOperationService({
      repository: {
        getSnapshot: vi.fn(async () => current),
        commit: vi.fn(),
        commitWithAudit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))
      },
      remoteArbiter: arbiter,
      remoteUnfavorite: {
        unfavorite: async (accountMid, selectedAids, options) => {
          for (const aid of selectedAids) {
            await arbiter.enqueue(accountMid, { priority: 'user-single', videoKey: `unfavorite:${aid}` }, async () => {
              await options?.beforeRemoteWrite?.()
              remoteWrites.push(aid)
            })
          }
          return { status: 'succeeded' as const, completedOperationCount: selectedAids.length, totalOperationCount: selectedAids.length, affectedAids: selectedAids }
        }
      }
    })
    const preview = await service.previewRemoteUnfavorite('100', [1, 2], 7)
    const execution = service.executeRemoteUnfavorite('100', preview.executionToken, service.confirmRemoteUnfavorite('100', preview.executionToken))
    await new Promise((resolve) => setTimeout(resolve, 0))
    void arbiter.enqueue('100', { priority: 'reconcile' }, async () => {
      current = { ...current, revision: current.revision + 1 }
    })
    releaseBlocker()

    await expect(execution).rejects.toThrow('stale')
    expect(remoteWrites).toEqual([])
  })

  it('records an explicit unknown result when the remote unfavorite adapter throws ambiguously', async () => {
    const current = snapshot()
    const commit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] }))
    const service = new FavoriteRepositoryBatchOperationService({
      repository: { getSnapshot: vi.fn(async () => current), commit, commitWithAudit: vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [], affectedFolderIds: [] })) },
      remoteUnfavorite: { unfavorite: vi.fn(async () => { throw new Error('connection dropped') }) }
    })
    const preview = await service.previewRemoteUnfavorite('100', [1], 7)

    await expect(service.executeRemoteUnfavorite('100', preview.executionToken, service.confirmRemoteUnfavorite('100', preview.executionToken)))
      .resolves.toMatchObject({ status: 'result-unknown', completedOperationCount: 0, auditStatus: 'recorded' })
    expect(commit).not.toHaveBeenCalled()
  })

  it('records a known remote rejection as failed when the remote unfavorite adapter throws', async () => {
    const current = snapshot()
    const service = new FavoriteRepositoryBatchOperationService({
      repository: { getSnapshot: vi.fn(async () => current), commit: vi.fn(), commitWithAudit: vi.fn() },
      remoteUnfavorite: { unfavorite: vi.fn(async () => { throw Object.assign(new Error('rejected'), { code: 'REMOTE_REJECTED' }) }) }
    })
    const preview = await service.previewRemoteUnfavorite('100', [1], 7)

    await expect(service.executeRemoteUnfavorite('100', preview.executionToken, service.confirmRemoteUnfavorite('100', preview.executionToken)))
      .resolves.toMatchObject({ status: 'failed', completedOperationCount: 0, auditStatus: 'recorded' })
  })

  it('writes a minimal recovery checkpoint when the atomic audit fails so a new service can reconcile it', async () => {
    let current = snapshot()
    const commit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => {
      if (command.type === 'record-sync-result') {
        current = {
          ...current,
          syncRecords: [{
            id: command.payload.id,
            commandId: command.payload.commandId,
            status: command.payload.status,
            affectedAids: command.payload.affectedAids,
            updatedAt: command.payload.updatedAt,
            operationKey: command.payload.operationKey
          }]
        }
      }
      return { ...current, commandId: command.id, affectedAids: command.type === 'record-sync-result' ? command.payload.affectedAids : [], affectedFolderIds: [] }
    })
    const sharedRepository = {
      getSnapshot: vi.fn(async () => current),
      commit,
      commitWithAudit: vi.fn(async () => { throw new Error('audit storage unavailable') })
    }
    const initial = new FavoriteRepositoryBatchOperationService({
      repository: sharedRepository,
      remoteUnfavorite: { unfavorite: vi.fn(async () => ({ status: 'result-unknown' as const, completedOperationCount: 0, totalOperationCount: 1, affectedAids: [1], reason: 'timeout' })) }
    })
    const preview = await initial.previewRemoteUnfavorite('100', [1], 7)

    await expect(initial.executeRemoteUnfavorite('100', preview.executionToken, initial.confirmRemoteUnfavorite('100', preview.executionToken)))
      .resolves.toMatchObject({ status: 'result-unknown', auditStatus: 'failed' })
    expect(commit).toHaveBeenCalledWith('100', expect.objectContaining({
      type: 'record-sync-result',
      payload: expect.objectContaining({ id: `favorite-remote-unfavorite:${preview.operationId}`, status: 'result-unknown' })
    }))

    const observer = { areUnfavorited: vi.fn(async () => 'removed' as const) }
    const restarted = new FavoriteRepositoryBatchOperationService({ repository: sharedRepository, remoteObserver: observer })
    await expect(restarted.reconcileRemoteUnfavorite('100', preview.operationId)).resolves.toMatchObject({ status: 'completed' })
    expect(observer.areUnfavorited).toHaveBeenCalledWith('100', [1])
  })

  it('rejects a remote-unfavorite execution whose repository baseline changed after preview', async () => {
    const current = snapshot()
    const later = { ...current, revision: 8 }
    const getSnapshot = vi.fn().mockResolvedValueOnce(current).mockResolvedValueOnce(later)
    const unfavorite = vi.fn()
    const service = new FavoriteRepositoryBatchOperationService({
      repository: { getSnapshot, commit: vi.fn(), commitWithAudit: vi.fn() }, remoteUnfavorite: { unfavorite }
    })

    const preview = await service.previewRemoteUnfavorite('100', [1], 7)
    const confirmation = service.confirmRemoteUnfavorite('100', preview.executionToken)
    await expect(service.executeRemoteUnfavorite('100', preview.executionToken, confirmation)).rejects.toThrow('stale')
    expect(unfavorite).not.toHaveBeenCalled()
  })

  it('rejects a local change when its atomic audit transaction fails', async () => {
    const current = snapshot()
    const committed = { ...current, commandId: 'placement', affectedAids: [1], affectedFolderIds: ['bilimi-logical:target'] }
    const commit = vi.fn()
    const service = new FavoriteRepositoryBatchOperationService({ repository: { getSnapshot: vi.fn(async () => current), commit, commitWithAudit: vi.fn().mockRejectedValue(new Error('atomic audit unavailable')) } })

    await expect(service.copy('100', [1], ['bilimi-logical:target'], 7)).rejects.toThrow('atomic audit unavailable')
    expect(committed.commandId).toBe('placement')
  })

  it('keeps a result-unknown remote outcome while surfacing failed audit persistence', async () => {
    const current = snapshot()
    const commit = vi.fn().mockRejectedValue(new Error('checkpoint unavailable'))
    const service = new FavoriteRepositoryBatchOperationService({
      repository: { getSnapshot: vi.fn(async () => current), commit, commitWithAudit: vi.fn().mockRejectedValue(new Error('audit unavailable')) },
      remoteUnfavorite: { unfavorite: vi.fn(async () => ({ status: 'result-unknown' as const, completedOperationCount: 0, totalOperationCount: 1, affectedAids: [1] })) }
    })

    const preview = await service.previewRemoteUnfavorite('100', [1], 7)
    const confirmation = service.confirmRemoteUnfavorite('100', preview.executionToken)
    await expect(service.executeRemoteUnfavorite('100', preview.executionToken, confirmation)).resolves.toMatchObject({
      status: 'result-unknown', auditStatus: 'failed'
    })
    expect(commit).toHaveBeenCalledWith('100', expect.objectContaining({ type: 'record-sync-result' }))
  })

  it('recovers an unknown unfavorite from repository evidence and persistently reconciles it without another remote mutation', async () => {
    const current = {
      ...snapshot(),
      syncRecords: [{
        id: 'favorite-remote-unfavorite:restart-operation', commandId: 'restart-operation', status: 'result-unknown' as const,
        affectedAids: [1], updatedAt: '2026-07-24T01:00:00.000Z', operationKey: 'favorite-library-unfavorite'
      }]
    }
    const commit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [1], affectedFolderIds: [] }))
    const unfavorite = vi.fn()
    const service = new FavoriteRepositoryBatchOperationService({
      repository: { getSnapshot: vi.fn(async () => current), commit }, remoteUnfavorite: { unfavorite },
      remoteObserver: { areUnfavorited: vi.fn(async () => 'removed' as const) }
    } as never)

    await expect(service.reconcileRemoteUnfavorite('100', 'restart-operation')).resolves.toMatchObject({ status: 'completed' })
    expect(unfavorite).not.toHaveBeenCalled()
    expect(commit).toHaveBeenCalledWith('100', expect.objectContaining({
      type: 'record-sync-result', payload: expect.objectContaining({ status: 'succeeded', commandId: 'restart-operation' })
    }))
  })

  it('observes an imported reconciliation-required unfavorite before completing it', async () => {
    const current = {
      ...snapshot(),
      syncRecords: [{
        id: 'favorite-remote-unfavorite:imported-operation', commandId: 'imported-operation', status: 'reconciliation-required' as const,
        affectedAids: [1], updatedAt: '2026-07-24T01:00:00.000Z', operationKey: 'favorite-library-unfavorite'
      }]
    }
    const observer = { areUnfavorited: vi.fn(async () => 'present' as const) }
    const commit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({ ...current, commandId: command.id, affectedAids: [1], affectedFolderIds: [] }))
    const service = new FavoriteRepositoryBatchOperationService({
      repository: { getSnapshot: vi.fn(async () => current), commit }, remoteObserver: observer
    } as never)

    await expect(service.reconcileRemoteUnfavorite('100', 'imported-operation')).resolves.toMatchObject({ status: 'failed' })
    expect(observer.areUnfavorited).toHaveBeenCalledWith('100', [1])
  })

  it('keeps remote unfavorite reconciliation required when its durable checkpoint fails', async () => {
    const current = {
      ...snapshot(),
      syncRecords: [{
        id: 'favorite-remote-unfavorite:checkpoint-failure', commandId: 'checkpoint-failure', status: 'result-unknown' as const,
        affectedAids: [1], updatedAt: '2026-07-24T01:00:00.000Z', operationKey: 'favorite-library-unfavorite'
      }]
    }
    const observer = { areUnfavorited: vi.fn(async () => 'removed' as const) }
    const service = new FavoriteRepositoryBatchOperationService({
      repository: { getSnapshot: vi.fn(async () => current), commit: vi.fn(async () => { throw new Error('checkpoint unavailable') }) },
      remoteObserver: observer
    } as never)

    await expect(service.reconcileRemoteUnfavorite('100', 'checkpoint-failure')).resolves.toMatchObject({ status: 'reconciliation-required' })
    expect(observer.areUnfavorited).toHaveBeenCalledWith('100', [1])
  })

  it('rejects local deletion outside a bilimi work folder and keeps remote mutation restricted', async () => {
    const current = snapshot()
    const service = new FavoriteRepositoryBatchOperationService({ repository: repository(current) })

    await expect(service.deleteLocal('100', [1], 7, { kind: 'bilibili-user', folderId: 'bilibili:1' })).rejects.toThrow('not permitted')
    await expect(service.deleteLocal('100', [1], 7, { kind: 'virtual', eligibleAids: [1], skippedAids: [] })).rejects.toThrow('current Bilimi work folder')
    await expect(service.previewRemoteUnfavorite('100', [1], 7, { kind: 'bilibili-user', folderId: 'bilibili:1' })).rejects.toThrow('not permitted')
    await expect(service.previewRemoteUnfavorite('100', [1], 7, { kind: 'virtual', eligibleAids: [1] } as never)).rejects.toThrow('skipped')
    await expect(service.previewRemoteUnfavorite('100', [1], 7, { kind: 'virtual', eligibleAids: [1], skippedAids: [] })).resolves.toMatchObject({ aids: [1] })
  })

  it('moves unmatched videos by adding targets without requiring a managed source folder', async () => {
    const current = { ...snapshot(), positions: {} }
    const commitWithAudit = vi.fn(async (_account: string, command: FavoriteRepositoryCommand) => ({
      ...current, commandId: command.id, revision: 8, affectedAids: [1], affectedFolderIds: ['bilimi-logical:target']
    }))
    const service = new FavoriteRepositoryBatchOperationService({
      repository: { getSnapshot: vi.fn(async () => current), commit: vi.fn(), commitWithAudit }
    })

    await service.move('100', [1], 'local:inbox', ['bilimi-logical:target'], 7, {
      kind: 'virtual', eligibleAids: [1], skippedAids: []
    })

    expect(commitWithAudit).toHaveBeenCalledWith('100', expect.objectContaining({
      type: 'set-favorite-placements',
      payload: { adjustmentKind: 'local-move', placements: [expect.objectContaining({ aid: 1, localDesiredFolderIds: ['bilimi-logical:target'] })] }
    }), expect.any(Array))
  })
})
