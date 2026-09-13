import { describe, expect, it } from 'vitest'
import {
  applyFavoriteRepositoryCommand,
  createAccountFavoriteRepositorySnapshot,
  type FavoriteRepositoryCommand,
  type FavoriteRepositoryCommandResult
} from '../../src/shared/favoriteRepository'
import type { FavoriteLedger } from '../../src/shared/types'
import { FavoriteRepositoryEmptyManagedFolderRecovery } from './favoriteRepositoryEmptyManagedFolderRecovery'

const accountMid = '100'
const now = '2026-09-14T00:00:00.000Z'

function ledger(enabled = true): FavoriteLedger {
  return {
    id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled, priority: 1, isDefault: false,
    bilibiliFolderId: 'music-1', bindingState: 'bound'
  }
}

function deletedLocalProjection() {
  return {
    ...createAccountFavoriteRepositorySnapshot({ accountMid, now }),
    physicalShards: [{
      logicalLedgerId: 'music', folderId: 'bilimi:music:001', shardNumber: 1,
      remoteTitle: 'bilimi·音乐', bindingState: 'bound' as const, remoteFolderId: 'music-1', remoteMemberCount: 4
    }],
    memberships: { 'bilibili:music-1': [1, 2, 3, 4] }
  }
}

function memoryRepository(initial: ReturnType<typeof deletedLocalProjection>) {
  let current = initial
  return {
    get current() { return current },
    repository: {
      getSnapshot: async () => current,
      commit: async (_accountMid: string, command: FavoriteRepositoryCommand) => {
        current = applyFavoriteRepositoryCommand(current, command, now)
        return current
      }
    }
  }
}

describe('favorite repository empty managed-folder recovery', () => {
  it('restores an enabled rule as an empty shell after ordinary repository activity', async () => {
    const memory = memoryRepository(deletedLocalProjection())
    const recovery = new FavoriteRepositoryEmptyManagedFolderRecovery({
      repository: memory.repository,
      loadFavoriteLedgers: async () => [ledger()],
      now: () => now
    })

    await recovery.afterRepositoryActivity({ ...memory.current, commandId: 'review-favorite:100:1', affectedAids: [1], affectedFolderIds: [] } as FavoriteRepositoryCommandResult)

    expect(memory.current.folders).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'bilimi-logical:music', logicalLedgerId: 'music' })
    ]))
    expect(memory.current.memberships['bilimi-logical:music']).toEqual([])
    expect(memory.current.memberships['bilimi:music:001']).toEqual([])
    expect(memory.current.memberships['bilibili:music-1']).toEqual([1, 2, 3, 4])
  })

  it('does not undo a local managed-folder deletion in the deletion callback itself', async () => {
    const memory = memoryRepository(deletedLocalProjection())
    const recovery = new FavoriteRepositoryEmptyManagedFolderRecovery({
      repository: memory.repository,
      loadFavoriteLedgers: async () => [ledger()],
      now: () => now
    })

    await recovery.afterRepositoryActivity({ ...memory.current, commandId: 'managed-folder:delete-local:abc', affectedAids: [], affectedFolderIds: [] } as FavoriteRepositoryCommandResult)

    expect(memory.current.folders).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'bilimi-logical:music' })
    ]))
  })

  it('keeps a disabled rule hidden during a local refresh', async () => {
    const memory = memoryRepository(deletedLocalProjection())
    memory.current.memberships['bilimi:music:001'] = [1, 2, 3, 4]
    const recovery = new FavoriteRepositoryEmptyManagedFolderRecovery({
      repository: memory.repository,
      loadFavoriteLedgers: async () => [ledger(false)],
      now: () => now
    })

    await recovery.restoreForLocalRead(accountMid)

    expect(memory.current.folders).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'bilimi-logical:music' })
    ]))
    // A disabled rule has no restore entitlement. Leave an old-version
    // projection untouched until a later enabled recovery can intentionally
    // recreate the folder as an empty shell.
    expect(memory.current.memberships['bilimi:music:001']).toEqual([1, 2, 3, 4])
  })

  it('removes legacy retained local members before restoring an empty shell', async () => {
    const memory = memoryRepository({
      ...deletedLocalProjection(),
      memberships: {
        'bilimi:music:001': [1, 2, 3, 4],
        'bilibili:music-1': [1, 2, 3, 4]
      }
    })
    const recovery = new FavoriteRepositoryEmptyManagedFolderRecovery({
      repository: memory.repository,
      loadFavoriteLedgers: async () => [ledger()],
      now: () => now
    })

    await recovery.restoreForLocalRead(accountMid)

    expect(memory.current.memberships['bilimi-logical:music']).toEqual([])
    expect(memory.current.memberships['bilimi:music:001']).toEqual([])
    expect(memory.current.memberships['bilibili:music-1']).toEqual([1, 2, 3, 4])
  })
})
