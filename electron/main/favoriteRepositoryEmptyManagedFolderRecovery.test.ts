import { describe, expect, it, vi } from 'vitest'
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
  it('restores an enabled rule as an empty shell after a confirmed review action', async () => {
    const memory = memoryRepository(deletedLocalProjection())
    const recovery = new FavoriteRepositoryEmptyManagedFolderRecovery({
      repository: memory.repository,
      loadFavoriteLedgers: async () => [ledger()],
      loadHiddenFavoriteLibraryManagedLedgerIds: async () => ['music'],
      now: () => now
    })

    await recovery.afterRepositoryActivity({ ...memory.current, commandId: 'review-favorite:100:1:local', affectedAids: [1], affectedFolderIds: [] } as FavoriteRepositoryCommandResult)

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
      loadHiddenFavoriteLibraryManagedLedgerIds: async () => ['music'],
      now: () => now
    })

    await recovery.afterRepositoryActivity({ ...memory.current, commandId: 'managed-folder:delete-local:abc', affectedAids: [], affectedFolderIds: [] } as FavoriteRepositoryCommandResult)

    expect(memory.current.folders).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'bilimi-logical:music' })
    ]))
  })

  it('keeps a local deletion visible through every ordinary read', async () => {
    const memory = memoryRepository(deletedLocalProjection())
    const recovery = new FavoriteRepositoryEmptyManagedFolderRecovery({
      repository: memory.repository,
      loadFavoriteLedgers: async () => [ledger()],
      loadHiddenFavoriteLibraryManagedLedgerIds: async () => ['music'],
      now: () => now
    })

    await recovery.afterRepositoryActivity({ ...memory.current, commandId: 'managed-folder:delete-local:abc', affectedAids: [], affectedFolderIds: [] } as FavoriteRepositoryCommandResult)
    await recovery.restoreForLocalRead(accountMid)

    expect(memory.current.folders).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'bilimi-logical:music' })
    ]))
  })

  it('keeps a persisted local deletion hidden across every ordinary local read', async () => {
    const memory = memoryRepository(deletedLocalProjection())
    const recovery = new FavoriteRepositoryEmptyManagedFolderRecovery({
      repository: memory.repository,
      loadFavoriteLedgers: async () => [ledger()],
      loadHiddenFavoriteLibraryManagedLedgerIds: async () => ['music'],
      now: () => now
    } as never)

    await recovery.restoreForLocalRead(accountMid)
    await recovery.restoreForLocalRead(accountMid)

    expect(memory.current.folders).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'bilimi-logical:music' })
    ]))
  })

  it('does not consume a persisted local deletion during an unrelated repository revision', async () => {
    const memory = memoryRepository(deletedLocalProjection())
    const consumeHiddenFavoriteLibraryManagedLedgerIds = async () => undefined
    const recovery = new FavoriteRepositoryEmptyManagedFolderRecovery({
      repository: memory.repository,
      loadFavoriteLedgers: async () => [ledger()],
      loadHiddenFavoriteLibraryManagedLedgerIds: async () => ['music'],
      consumeHiddenFavoriteLibraryManagedLedgerIds,
      now: () => now
    } as never)

    await recovery.afterRepositoryActivity({
      ...memory.current, commandId: 'favorite-placement-sync-receipt:run:1', affectedAids: [1], affectedFolderIds: []
    } as FavoriteRepositoryCommandResult)

    expect(memory.current.folders).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'bilimi-logical:music' })
    ]))
  })

  it('restores and consumes persisted local deletion only after an explicit refresh action', async () => {
    const memory = memoryRepository(deletedLocalProjection())
    const consumed: string[][] = []
    const recovery = new FavoriteRepositoryEmptyManagedFolderRecovery({
      repository: memory.repository,
      loadFavoriteLedgers: async () => [ledger()],
      loadHiddenFavoriteLibraryManagedLedgerIds: async () => ['music'],
      consumeHiddenFavoriteLibraryManagedLedgerIds: async (_accountMid: string, ids: string[]) => { consumed.push(ids) },
      now: () => now
    } as never)

    await recovery.afterRepositoryActivity({
      ...memory.current, commandId: 'favorite-library:video:100:1:2:refresh', affectedAids: [1], affectedFolderIds: []
    } as FavoriteRepositoryCommandResult)

    expect(memory.current.folders).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'bilimi-logical:music', logicalLedgerId: 'music' })
    ]))
    expect(consumed).toEqual([['music']])
  })

  it('runs an explicit refresh recovery after an in-flight ordinary read kept the folder hidden', async () => {
    const memory = memoryRepository(deletedLocalProjection())
    let releaseLedgers: ((ledgers: readonly FavoriteLedger[]) => void) | undefined
    const pendingLedgers = new Promise<readonly FavoriteLedger[]>((resolve) => { releaseLedgers = resolve })
    const consumed: string[][] = []
    const recovery = new FavoriteRepositoryEmptyManagedFolderRecovery({
      repository: memory.repository,
      loadFavoriteLedgers: () => pendingLedgers,
      loadHiddenFavoriteLibraryManagedLedgerIds: async () => ['music'],
      consumeHiddenFavoriteLibraryManagedLedgerIds: async (_accountMid: string, ids: string[]) => { consumed.push(ids) },
      now: () => now
    } as never)

    const ordinaryRead = recovery.restoreForLocalRead(accountMid)
    await Promise.resolve()
    const explicitRefresh = recovery.afterRepositoryActivity({
      ...memory.current, commandId: 'favorite-library:video:100:1:2:refresh', affectedAids: [1], affectedFolderIds: []
    } as FavoriteRepositoryCommandResult)
    releaseLedgers?.([ledger()])
    await Promise.all([ordinaryRead, explicitRefresh])

    expect(memory.current.folders).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'bilimi-logical:music', logicalLedgerId: 'music' })
    ]))
    expect(consumed).toEqual([['music']])
  })

  it('does not let a later ordinary read absorb an already-started explicit refresh recovery', async () => {
    const memory = memoryRepository(deletedLocalProjection())
    let releaseExplicitHiddenIds: ((ids: readonly string[]) => void) | undefined
    const explicitHiddenIds = new Promise<readonly string[]>((resolve) => { releaseExplicitHiddenIds = resolve })
    let hiddenIdReads = 0
    const consumed: string[][] = []
    const recovery = new FavoriteRepositoryEmptyManagedFolderRecovery({
      repository: memory.repository,
      loadFavoriteLedgers: async () => [ledger()],
      loadHiddenFavoriteLibraryManagedLedgerIds: () => ++hiddenIdReads === 1 ? explicitHiddenIds : ['music'],
      consumeHiddenFavoriteLibraryManagedLedgerIds: async (_accountMid: string, ids: string[]) => { consumed.push(ids) },
      now: () => now
    } as never)

    const explicitRefresh = recovery.afterRepositoryActivity({
      ...memory.current, commandId: 'favorite-library:video:100:1:2:refresh', affectedAids: [1], affectedFolderIds: []
    } as FavoriteRepositoryCommandResult)
    await Promise.resolve()
    const ordinaryRead = recovery.restoreForLocalRead(accountMid)
    await Promise.resolve()
    releaseExplicitHiddenIds?.(['music'])
    await Promise.all([ordinaryRead, explicitRefresh])

    expect(memory.current.folders).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'bilimi-logical:music', logicalLedgerId: 'music' })
    ]))
    expect(consumed).toEqual([['music']])
  })

  it('keeps a newly deleted folder hidden when deletion waits behind an in-flight explicit recovery', async () => {
    const initial = deletedLocalProjection()
    initial.folders.push({
      id: 'bilimi-logical:music', title: 'bilimi·音乐', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound'
    })
    initial.memberships['bilimi-logical:music'] = []
    const memory = memoryRepository(initial)
    let hiddenLedgerIds: string[] = []
    let releaseHiddenIds: (() => void) | undefined
    const hiddenIdsLoaded = new Promise<void>((resolve) => { releaseHiddenIds = resolve })
    const consumed: string[][] = []
    const recovery = new FavoriteRepositoryEmptyManagedFolderRecovery({
      repository: memory.repository,
      loadFavoriteLedgers: async () => [ledger()],
      loadHiddenFavoriteLibraryManagedLedgerIds: async () => {
        await hiddenIdsLoaded
        return hiddenLedgerIds
      },
      consumeHiddenFavoriteLibraryManagedLedgerIds: async (_accountMid: string, ids: string[]) => { consumed.push(ids) },
      now: () => now
    } as never)

    const explicitRefresh = recovery.afterRepositoryActivity({
      ...memory.current, commandId: 'favorite-library:video:100:1:2:refresh', affectedAids: [], affectedFolderIds: []
    } as FavoriteRepositoryCommandResult)
    await Promise.resolve()
    const deletion = recovery.runWithLocalManagedFolderDeletion(accountMid, async () => {
      hiddenLedgerIds = ['music']
      await memory.repository.commit(accountMid, {
        id: 'managed-folder:delete-local:music', accountMid, issuedAt: now,
        type: 'delete-local-managed-folder', payload: { logicalFolderId: 'bilimi-logical:music' }
      })
    })
    releaseHiddenIds?.()
    await Promise.all([explicitRefresh, deletion])
    await recovery.restoreForLocalRead(accountMid)

    expect(memory.current.folders).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'bilimi-logical:music' })
    ]))
    expect(hiddenLedgerIds).toEqual(['music'])
    expect(consumed).toEqual([])
  })

  it('does not scan or recreate folders for a successful business action when no local deletion marker exists', async () => {
    const memory = memoryRepository(deletedLocalProjection())
    const commit = vi.fn(memory.repository.commit)
    const recovery = new FavoriteRepositoryEmptyManagedFolderRecovery({
      repository: { ...memory.repository, commit },
      loadFavoriteLedgers: async () => [ledger()],
      loadHiddenFavoriteLibraryManagedLedgerIds: async () => [],
      now: () => now
    } as never)

    await recovery.restoreAfterExplicitBusinessAction(accountMid)

    expect(commit).not.toHaveBeenCalled()
  })

  it('keeps an ordinary read that started before deletion from recreating the deleted shell', async () => {
    const memory = memoryRepository(deletedLocalProjection())
    let releaseLedgers: (() => void) | undefined
    const ledgersReady = new Promise<void>((resolve) => { releaseLedgers = resolve })
    const recovery = new FavoriteRepositoryEmptyManagedFolderRecovery({
      repository: memory.repository,
      loadFavoriteLedgers: async () => {
        await ledgersReady
        return [ledger()]
      },
      loadHiddenFavoriteLibraryManagedLedgerIds: async () => [],
      now: () => now
    } as never)

    const ordinaryRead = recovery.restoreForLocalRead(accountMid)
    await Promise.resolve()
    const deletion = recovery.runWithLocalManagedFolderDeletion(accountMid, async () => {
      await memory.repository.commit(accountMid, {
        id: 'managed-folder:delete-local:music', accountMid, issuedAt: now,
        type: 'delete-local-managed-folder', payload: { logicalFolderId: 'bilimi-logical:music' }
      })
    })
    releaseLedgers?.()
    await Promise.all([ordinaryRead, deletion])

    expect(memory.current.folders).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'bilimi-logical:music' })
    ]))
  })

  it('consumes the local-hide marker when an explicit business action already recreated the folder', async () => {
    const initial = deletedLocalProjection()
    initial.folders.push({
      id: 'bilimi-logical:music', title: 'bilimi·音乐', kind: 'bilimi-logical', logicalLedgerId: 'music', syncState: 'bound'
    })
    initial.memberships['bilimi-logical:music'] = []
    const memory = memoryRepository(initial)
    const consumed: string[][] = []
    const recovery = new FavoriteRepositoryEmptyManagedFolderRecovery({
      repository: memory.repository,
      loadFavoriteLedgers: async () => [ledger()],
      loadHiddenFavoriteLibraryManagedLedgerIds: async () => ['music'],
      consumeHiddenFavoriteLibraryManagedLedgerIds: async (_accountMid: string, ids: string[]) => { consumed.push(ids) },
      now: () => now
    } as never)

    await recovery.afterRepositoryActivity({
      ...memory.current, commandId: 'favorite-binding:music:100', affectedAids: [], affectedFolderIds: ['bilimi-logical:music']
    } as FavoriteRepositoryCommandResult)

    expect(consumed).toEqual([['music']])
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
