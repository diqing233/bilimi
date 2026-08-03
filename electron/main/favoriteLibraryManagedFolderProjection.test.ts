import { describe, expect, it } from 'vitest'
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
  it('restores an exact account-configured remote id as a bound formal work folder', () => {
    const result = planFavoriteLibraryManagedFolderProjection({
      snapshot: snapshot([{ id: '4050295454', title: 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66', aids: [11, 12] }]),
      ledgers: [ledger('creative-aesthetic', 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66', '4050295454')],
      dismissedRemoteFolderIds: []
    })

    expect(result).toEqual([expect.objectContaining({
      logicalLedgerId: 'creative-aesthetic', logicalTitle: 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66', shardNumber: 1,
      remoteFolderId: '4050295454', remoteTitle: 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66', memberAids: [11, 12],
      bindingState: 'bound', remoteMemberCount: 2
    })])
  })

  it('groups numbered physical folders under one logical draft without granting a bound remote deletion', () => {
    const result = planFavoriteLibraryManagedFolderProjection({
      snapshot: snapshot([
        { id: 'game-1', title: 'bilimi\u00b7\u6e38\u620f\u4e13\u533a', aids: [1] },
        { id: 'game-2', title: 'bilimi\u00b7\u6e38\u620f\u4e13\u533a\u00b702', aids: [2] }
      ]),
      ledgers: [ledger('game', 'bilimi\u00b7\u6e38\u620f\u4e13\u533a')],
      dismissedRemoteFolderIds: []
    })

    expect(result).toEqual([
      expect.objectContaining({ logicalLedgerId: 'game', logicalTitle: 'bilimi\u00b7\u6e38\u620f\u4e13\u533a', shardNumber: 1, bindingState: 'pending-reconcile', knownRemoteFolderIds: ['game-1'] }),
      expect.objectContaining({ logicalLedgerId: 'game', logicalTitle: 'bilimi\u00b7\u6e38\u620f\u4e13\u533a', shardNumber: 2, bindingState: 'pending-reconcile', knownRemoteFolderIds: ['game-2'] })
    ])
    expect(result.every((candidate) => candidate.remoteFolderId === undefined)).toBe(true)
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

  it('does not restore a remote folder that the user removed from the local library', () => {
    const result = planFavoriteLibraryManagedFolderProjection({
      snapshot: snapshot([{ id: '4050295454', title: 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66' }]),
      ledgers: [ledger('creative-aesthetic', 'bilimi\u00b7\u521b\u610f\u7f8e\u5b66', '4050295454')],
      dismissedRemoteFolderIds: ['4050295454']
    })

    expect(result).toEqual([])
  })

  it('keeps a duplicate logical shard ambiguous instead of choosing one remote id', () => {
    const result = planFavoriteLibraryManagedFolderProjection({
      snapshot: snapshot([
        { id: 'duplicate-a', title: 'bilimi\u00b7\u97f3\u4e50' },
        { id: 'duplicate-b', title: 'bilimi\u00b7\u97f3\u4e50' }
      ]),
      ledgers: [ledger('music', 'bilimi\u00b7\u97f3\u4e50')],
      dismissedRemoteFolderIds: []
    })

    expect(result).toEqual([expect.objectContaining({
      logicalLedgerId: 'music', shardNumber: 1, bindingState: 'pending-reconcile',
      knownRemoteFolderIds: ['duplicate-a', 'duplicate-b'], memberAids: []
    })])
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
      isDismissed: () => false, now: () => '2026-08-03T00:00:00.000Z'
    })

    expect(current.physicalShards).toEqual([expect.objectContaining({
      logicalLedgerId: 'creative-aesthetic', remoteFolderId: '4050295454', bindingState: 'bound'
    })])
  })
})
