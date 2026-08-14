import { describe, expect, it, vi } from 'vitest'
import { createAccountFavoriteRepositorySnapshot } from '../../src/shared/favoriteRepository'
import type { FavoriteLedger } from '../../src/shared/types'
import { planFavoriteLibraryManagedFolderProjection, restoreFavoriteLibraryManagedFolderProjection } from './favoriteLibraryManagedFolderProjection'

function ledger(id: string, displayName: string, bilibiliFolderId?: string): FavoriteLedger {
  return { id, displayName, keywords: [], enabled: true, priority: 1, isDefault: false, ...(bilibiliFolderId ? { bilibiliFolderId } : {}) }
}

function snapshot(folders: Array<{ id: string; title: string; aids?: number[] }>) {
  const base = createAccountFavoriteRepositorySnapshot({ accountMid: '100', now: '2026-08-03T00:00:00.000Z' })
  return {
    ...base,
    folders: folders.map((folder) => ({ id: `bilibili:${folder.id}`, title: folder.title, kind: 'bilibili' as const, remoteFolderId: folder.id, syncState: 'bound' as const })),
    memberships: Object.fromEntries(folders.map((folder) => [`bilibili:${folder.id}`, folder.aids ?? []]))
  }
}

describe('favorite library managed folder projection', () => {
  it('restores an exact account-configured remote id as an explicitly unbound work-folder candidate', () => {
    const result = planFavoriteLibraryManagedFolderProjection({
      snapshot: snapshot([{ id: '4050295454', title: 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66', aids: [11, 12] }]),
      ledgers: [ledger('creative-aesthetic', 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66', '4050295454')],
      dismissedRemoteFolderIds: []
    })

    expect(result).toEqual([expect.objectContaining({
      logicalLedgerId: 'creative-aesthetic', logicalTitle: 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66', shardNumber: 1,
      remoteTitle: 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66', memberAids: [11, 12],
      bindingState: 'pending-reconcile', knownRemoteFolderIds: ['4050295454']
    })])
  })

  it('projects a strict numbered title as the matching ledger shard without granting a binding', () => {
    const result = planFavoriteLibraryManagedFolderProjection({
      snapshot: snapshot([
        { id: 'game-1', title: 'bilimi\u00b7\u6e38\u620f\u4e13\u533a', aids: [1] },
        { id: 'game-2', title: 'bilimi\u00b7\u6e38\u620f\u4e13\u533a\u00b72', aids: [2] }
      ]),
      ledgers: [ledger('game', 'bilimi\u00b7\u6e38\u620f\u4e13\u533a')],
      dismissedRemoteFolderIds: []
    })

    const byRemoteFolderId = new Map(result.map((candidate) => [candidate.knownRemoteFolderIds?.[0], candidate]))
    expect(byRemoteFolderId.get('game-1')).toMatchObject({
      logicalLedgerId: 'game', logicalTitle: 'bilimi\u00b7\u6e38\u620f\u4e13\u533a', shardNumber: 1,
      bindingState: 'pending-reconcile', knownRemoteFolderIds: ['game-1']
    })
    expect(byRemoteFolderId.get('game-2')).toMatchObject({
      logicalLedgerId: 'game', logicalTitle: 'bilimi\u00b7\u6e38\u620f\u4e13\u533a', shardNumber: 2,
      bindingState: 'pending-reconcile', knownRemoteFolderIds: ['game-2']
    })
    expect(result.every((candidate) => candidate.remoteFolderId === undefined)).toBe(true)
  })

  it('preserves the stored shard number when a formally bound remote folder keeps a numbered title', () => {
    const base = snapshot([{ id: 'game-2', title: 'bilimi\u00b7\u6e38\u620f\u4e13\u533a\u00b72', aids: [2] }])
    const result = planFavoriteLibraryManagedFolderProjection({
      snapshot: {
        ...base,
        physicalShards: [{
          logicalLedgerId: 'game', folderId: 'bilimi:game:002', shardNumber: 2,
          remoteTitle: 'bilimi\u00b7\u6e38\u620f\u4e13\u533a\u00b72', bindingState: 'bound', remoteFolderId: 'game-2', remoteMemberCount: 1
        }]
      },
      ledgers: [ledger('game', 'bilimi\u00b7\u6e38\u620f\u4e13\u533a')],
      dismissedRemoteFolderIds: []
    })

    expect(result).toEqual([expect.objectContaining({
      logicalLedgerId: 'game', logicalTitle: 'bilimi\u00b7\u6e38\u620f\u4e13\u533a', shardNumber: 2,
      bindingState: 'bound', remoteFolderId: 'game-2', memberAids: [2]
    })])
  })

  it('projects an unknown bilimi folder as a stable draft while leaving an ordinary folder untouched', () => {
    const result = planFavoriteLibraryManagedFolderProjection({
      snapshot: snapshot([
        { id: 'custom', title: 'bilimi\u00b7\u6211\u7684\u7247\u5355', aids: [3] },
        { id: 'ordinary', title: '\u666e\u901a\u6536\u85cf\u5939', aids: [4] }
      ]),
      ledgers: [],
      dismissedRemoteFolderIds: []
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      logicalLedgerId: expect.stringMatching(/^custom-/), logicalTitle: 'bilimi\u00b7\u6211\u7684\u7247\u5355',
      bindingState: 'pending-reconcile', knownRemoteFolderIds: ['custom'], memberAids: [3]
    })
  })

  it('recovers a same-title remote folder under its configured ledger without explicit binding evidence', () => {
    const result = planFavoriteLibraryManagedFolderProjection({
      snapshot: snapshot([{ id: '9', title: 'bilimi\u00b7音乐' }]),
      ledgers: [ledger('music', 'bilimi\u00b7音乐')],
      dismissedRemoteFolderIds: []
    })

    expect(result).toMatchObject([{
      logicalLedgerId: 'music', logicalTitle: 'bilimi\u00b7音乐', bindingState: 'pending-reconcile',
      knownRemoteFolderIds: ['9']
    }])
  })

  it('does not let a legacy dismissed remote id hide a retained bilimi folder candidate', () => {
    const result = planFavoriteLibraryManagedFolderProjection({
      snapshot: snapshot([{ id: '4050295454', title: 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66' }]),
      ledgers: [ledger('creative-aesthetic', 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66', '4050295454')],
      dismissedRemoteFolderIds: ['4050295454']
    })

    expect(result).toEqual([expect.objectContaining({
      logicalLedgerId: 'creative-aesthetic', bindingState: 'pending-reconcile',
      knownRemoteFolderIds: ['4050295454']
    })])
  })

  it('does not automatically reconstruct a default rule the user deliberately deleted', () => {
    const result = planFavoriteLibraryManagedFolderProjection({
      snapshot: snapshot([{ id: '9', title: 'bilimi\u00b7\u97f3\u4e50' }]),
      ledgers: [{
        id: 'music', displayName: 'bilimi\u00b7\u97f3\u4e50', keywords: [], enabled: true, priority: 1,
        isDefault: true, bindingState: 'unbound', managedFolderDeletedByUser: true
      }],
      dismissedRemoteFolderIds: []
    })

    expect(result).toEqual([])
  })

  it('assigns stable shard numbers to duplicate same-title remote folders', () => {
    const result = planFavoriteLibraryManagedFolderProjection({
      snapshot: snapshot([
        { id: 'duplicate-a', title: 'bilimi\u00b7\u97f3\u4e50' },
        { id: 'duplicate-b', title: 'bilimi\u00b7\u97f3\u4e50' }
      ]),
      ledgers: [ledger('music', 'bilimi\u00b7\u97f3\u4e50')],
      dismissedRemoteFolderIds: []
    })

    expect(result).toEqual([
      expect.objectContaining({ logicalLedgerId: 'music', shardNumber: 1, bindingState: 'pending-reconcile', knownRemoteFolderIds: ['duplicate-a'], memberAids: [] }),
      expect.objectContaining({ logicalLedgerId: 'music', shardNumber: 2, bindingState: 'pending-reconcile', knownRemoteFolderIds: ['duplicate-b'], memberAids: [] })
    ])
  })

  it('keeps duplicate same-title member totals under one logical ledger', () => {
    const result = planFavoriteLibraryManagedFolderProjection({
      snapshot: snapshot([
        { id: 'game-1', title: 'bilimi\u00b7游戏专区', aids: Array.from({ length: 1000 }, (_, index) => index + 1) },
        { id: 'game-2', title: 'bilimi\u00b7游戏专区', aids: Array.from({ length: 247 }, (_, index) => index + 1001) }
      ]),
      ledgers: [ledger('game', 'bilimi\u00b7游戏专区')],
      dismissedRemoteFolderIds: []
    })

    expect(result.map((candidate) => candidate.shardNumber)).toEqual([1, 2])
    expect(result.reduce((count, candidate) => count + candidate.memberAids.length, 0)).toBe(1247)
  })

  it('persists the planned projection without requiring a remote inventory read', async () => {
    let current = snapshot([{ id: '4050295454', title: 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66', aids: [11] }])
    const repository = {
      getSnapshot: async () => current,
      commit: async (_accountMid: string, command: import('../../src/shared/favoriteRepository').FavoriteRepositoryCommand) => {
        if (command.type !== 'upsert-physical-shard-binding') throw new Error('unexpected command')
        current = {
          ...current,
          revision: current.revision + 1,
          physicalShards: [{
            logicalLedgerId: command.payload.logicalLedgerId,
            folderId: `bilimi:${command.payload.logicalLedgerId}:001`,
            shardNumber: command.payload.shardNumber,
            remoteTitle: command.payload.remoteTitle,
            bindingState: command.payload.bindingState,
            ...(command.payload.remoteFolderId ? { remoteFolderId: command.payload.remoteFolderId } : {}),
            ...(command.payload.knownRemoteFolderIds ? { knownRemoteFolderIds: command.payload.knownRemoteFolderIds } : {})
          }]
        }
        return current as never
      }
    }
    await restoreFavoriteLibraryManagedFolderProjection({
      accountMid: '100', repository, ledgers: [ledger('creative-aesthetic', 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66', '4050295454')],
      now: () => '2026-08-03T00:00:00.000Z'
    })

    expect(current.physicalShards).toEqual([expect.objectContaining({
      logicalLedgerId: 'creative-aesthetic', bindingState: 'pending-reconcile', knownRemoteFolderIds: ['4050295454']
    })])
  })

  it('removes an empty custom pending duplicate when the same remote folder already has a trusted binding', async () => {
    const remoteFolderId = '4050295454'
    let current = {
      ...snapshot([{ id: remoteFolderId, title: 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66' }]),
      folders: [
        ...snapshot([{ id: remoteFolderId, title: 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66' }]).folders,
        { id: 'bilimi-logical:creative-aesthetic', title: 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66', kind: 'bilimi-logical' as const, logicalLedgerId: 'creative-aesthetic', syncState: 'bound' as const },
        { id: 'bilimi-logical:custom-stale', title: 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66', kind: 'bilimi-logical' as const, logicalLedgerId: 'custom-stale', syncState: 'pending-reconcile' as const }
      ],
      memberships: {
        [`bilibili:${remoteFolderId}`]: [],
        'bilimi:creative-aesthetic:001': [],
        'bilimi-logical:creative-aesthetic': [],
        'bilimi:custom-stale:001': [],
        'bilimi-logical:custom-stale': []
      },
      physicalShards: [
        { logicalLedgerId: 'creative-aesthetic', folderId: 'bilimi:creative-aesthetic:001', shardNumber: 1, remoteTitle: 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66', bindingState: 'bound' as const, remoteFolderId, remoteMemberCount: 0 },
        { logicalLedgerId: 'custom-stale', folderId: 'bilimi:custom-stale:001', shardNumber: 1, remoteTitle: 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66', bindingState: 'pending-reconcile' as const, knownRemoteFolderIds: [remoteFolderId] }
      ]
    }
    const commit = vi.fn(async (_accountMid: string, command: import('../../src/shared/favoriteRepository').FavoriteRepositoryCommand) => {
      if (command.type === 'delete-local-managed-folder') {
        current = {
          ...current,
          folders: current.folders.filter((folder) => folder.logicalLedgerId !== command.payload.logicalFolderId.replace('bilimi-logical:', '')),
          physicalShards: current.physicalShards.filter((shard) => shard.logicalLedgerId !== command.payload.logicalFolderId.replace('bilimi-logical:', ''))
        }
      }
      return current as never
    })

    await restoreFavoriteLibraryManagedFolderProjection({
      accountMid: '100', repository: { getSnapshot: async () => current, commit },
      ledgers: [ledger('creative-aesthetic', 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66', remoteFolderId)],
      now: () => '2026-08-03T00:00:00.000Z'
    })

    expect(commit).toHaveBeenCalledWith('100', expect.objectContaining({
      type: 'delete-local-managed-folder', payload: { logicalFolderId: 'bilimi-logical:custom-stale' }
    }))
  })

  it('uses the repository binding when settings no longer retain the remote folder id', async () => {
    const remoteFolderId = '4050295454'
    let current = {
      ...snapshot([{ id: remoteFolderId, title: 'bilimi\u00b7创意美学' }]),
      folders: [
        ...snapshot([{ id: remoteFolderId, title: 'bilimi\u00b7创意美学' }]).folders,
        { id: 'bilimi-logical:creative-aesthetic', title: 'bilimi\u00b7创意美学', kind: 'bilimi-logical' as const, logicalLedgerId: 'creative-aesthetic', syncState: 'bound' as const },
        { id: 'bilimi-logical:custom-stale', title: 'bilimi\u00b7创意美学', kind: 'bilimi-logical' as const, logicalLedgerId: 'custom-stale', syncState: 'pending-reconcile' as const }
      ],
      memberships: {
        [`bilibili:${remoteFolderId}`]: [],
        'bilimi:creative-aesthetic:001': [],
        'bilimi-logical:creative-aesthetic': [],
        'bilimi:custom-stale:001': [],
        'bilimi-logical:custom-stale': []
      },
      physicalShards: [
        { logicalLedgerId: 'creative-aesthetic', folderId: 'bilimi:creative-aesthetic:001', shardNumber: 1, remoteTitle: 'bilimi\u00b7创意美学', bindingState: 'bound' as const, remoteFolderId, remoteMemberCount: 0 },
        { logicalLedgerId: 'custom-stale', folderId: 'bilimi:custom-stale:001', shardNumber: 1, remoteTitle: 'bilimi\u00b7创意美学', bindingState: 'pending-reconcile' as const, knownRemoteFolderIds: [remoteFolderId] }
      ]
    }
    const commit = vi.fn(async (_accountMid: string, command: import('../../src/shared/favoriteRepository').FavoriteRepositoryCommand) => {
      if (command.type === 'delete-local-managed-folder') {
        current = {
          ...current,
          folders: current.folders.filter((folder) => folder.logicalLedgerId !== command.payload.logicalFolderId.replace('bilimi-logical:', '')),
          physicalShards: current.physicalShards.filter((shard) => shard.logicalLedgerId !== command.payload.logicalFolderId.replace('bilimi-logical:', ''))
        }
      }
      return current as never
    })

    await restoreFavoriteLibraryManagedFolderProjection({
      accountMid: '100', repository: { getSnapshot: async () => current, commit },
      ledgers: [ledger('creative-aesthetic', 'bilimi\u00b7创意美学')],
      now: () => '2026-08-03T00:00:00.000Z'
    })

    expect(commit).toHaveBeenCalledWith('100', expect.objectContaining({
      type: 'delete-local-managed-folder', payload: { logicalFolderId: 'bilimi-logical:custom-stale' }
    }))
  })

  it.each([
    {
      label: 'ambiguous remote evidence',
      knownRemoteFolderIds: ['4050295454', 'other-remote'],
      memberAids: []
    },
    {
      label: 'populated draft',
      knownRemoteFolderIds: ['4050295454'],
      memberAids: [7]
    },
    {
      label: 'different remote folder',
      knownRemoteFolderIds: ['other-remote'],
      memberAids: []
    }
  ])('preserves a custom pending folder with $label', async ({ knownRemoteFolderIds, memberAids }) => {
    const remoteFolderId = '4050295454'
    const base = snapshot([{ id: remoteFolderId, title: 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66' }])
    const current = {
      ...base,
      folders: [
        ...base.folders,
        { id: 'bilimi-logical:creative-aesthetic', title: 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66', kind: 'bilimi-logical' as const, logicalLedgerId: 'creative-aesthetic', syncState: 'bound' as const },
        { id: 'bilimi-logical:custom-keep', title: 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66', kind: 'bilimi-logical' as const, logicalLedgerId: 'custom-keep', syncState: 'pending-reconcile' as const }
      ],
      memberships: {
        ...base.memberships,
        'bilimi:creative-aesthetic:001': [],
        'bilimi-logical:creative-aesthetic': [],
        'bilimi:custom-keep:001': memberAids,
        'bilimi-logical:custom-keep': memberAids
      },
      physicalShards: [
        { logicalLedgerId: 'creative-aesthetic', folderId: 'bilimi:creative-aesthetic:001', shardNumber: 1, remoteTitle: 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66', bindingState: 'bound' as const, remoteFolderId, remoteMemberCount: 0 },
        { logicalLedgerId: 'custom-keep', folderId: 'bilimi:custom-keep:001', shardNumber: 1, remoteTitle: 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66', bindingState: 'pending-reconcile' as const, knownRemoteFolderIds }
      ]
    }
    const commit = vi.fn()

    await restoreFavoriteLibraryManagedFolderProjection({
      accountMid: '100', repository: { getSnapshot: async () => current, commit },
      ledgers: [ledger('creative-aesthetic', 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66', remoteFolderId)],
    })

    expect(commit).not.toHaveBeenCalledWith('100', expect.objectContaining({ type: 'delete-local-managed-folder' }))
  })

  it('preserves a multi-shard custom draft when any shard lacks unique remote evidence', async () => {
    const remoteFolderId = '4050295454'
    const base = snapshot([{ id: remoteFolderId, title: 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66' }])
    const current = {
      ...base,
      folders: [
        ...base.folders,
        { id: 'bilimi-logical:creative-aesthetic', title: 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66', kind: 'bilimi-logical' as const, logicalLedgerId: 'creative-aesthetic', syncState: 'bound' as const },
        { id: 'bilimi-logical:custom-keep', title: 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66', kind: 'bilimi-logical' as const, logicalLedgerId: 'custom-keep', syncState: 'pending-reconcile' as const }
      ],
      memberships: {
        ...base.memberships,
        'bilimi:creative-aesthetic:001': [], 'bilimi-logical:creative-aesthetic': [],
        'bilimi:custom-keep:001': [], 'bilimi:custom-keep:002': [], 'bilimi-logical:custom-keep': []
      },
      physicalShards: [
        { logicalLedgerId: 'creative-aesthetic', folderId: 'bilimi:creative-aesthetic:001', shardNumber: 1, remoteTitle: 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66', bindingState: 'bound' as const, remoteFolderId, remoteMemberCount: 0 },
        { logicalLedgerId: 'custom-keep', folderId: 'bilimi:custom-keep:001', shardNumber: 1, remoteTitle: 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66', bindingState: 'pending-reconcile' as const, knownRemoteFolderIds: [remoteFolderId] },
        { logicalLedgerId: 'custom-keep', folderId: 'bilimi:custom-keep:002', shardNumber: 2, remoteTitle: 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66\u00b72', bindingState: 'pending-reconcile' as const, knownRemoteFolderIds: [] }
      ]
    }
    const commit = vi.fn()

    await restoreFavoriteLibraryManagedFolderProjection({
      accountMid: '100', repository: { getSnapshot: async () => current, commit },
      ledgers: [ledger('creative-aesthetic', 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66', remoteFolderId)],
    })

    expect(commit).not.toHaveBeenCalledWith('100', expect.objectContaining({ type: 'delete-local-managed-folder' }))
  })

  it('preserves a custom pending folder when the apparent bound shard is not backed by current ledger settings', async () => {
    const remoteFolderId = '4050295454'
    const base = snapshot([{ id: remoteFolderId, title: 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66' }])
    const current = {
      ...base,
      folders: [
        ...base.folders,
        { id: 'bilimi-logical:stale-bound', title: 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66', kind: 'bilimi-logical' as const, logicalLedgerId: 'stale-bound', syncState: 'bound' as const },
        { id: 'bilimi-logical:custom-keep', title: 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66', kind: 'bilimi-logical' as const, logicalLedgerId: 'custom-keep', syncState: 'pending-reconcile' as const }
      ],
      memberships: {
        ...base.memberships,
        'bilimi:stale-bound:001': [], 'bilimi-logical:stale-bound': [],
        'bilimi:custom-keep:001': [], 'bilimi-logical:custom-keep': []
      },
      physicalShards: [
        { logicalLedgerId: 'stale-bound', folderId: 'bilimi:stale-bound:001', shardNumber: 1, remoteTitle: 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66', bindingState: 'bound' as const, remoteFolderId, remoteMemberCount: 0 },
        { logicalLedgerId: 'custom-keep', folderId: 'bilimi:custom-keep:001', shardNumber: 1, remoteTitle: 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66', bindingState: 'pending-reconcile' as const, knownRemoteFolderIds: [remoteFolderId] }
      ]
    }
    const commit = vi.fn()

    await restoreFavoriteLibraryManagedFolderProjection({
      accountMid: '100', repository: { getSnapshot: async () => current, commit },
      ledgers: []
    })

    expect(commit).not.toHaveBeenCalledWith('100', expect.objectContaining({ type: 'delete-local-managed-folder' }))
  })
})
