import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const mainSource = readFileSync(resolve(process.cwd(), 'electron/main/index.ts'), 'utf8')

function handlerSource(handlerName: string) {
  const handlerStart = mainSource.indexOf(`ipcMain.handle('${handlerName}'`)
  const nextHandler = mainSource.indexOf("ipcMain.handle('", handlerStart + 1)
  return mainSource.slice(handlerStart, nextHandler === -1 ? mainSource.length : nextHandler)
}

describe('favorite ledger configuration refresh IPC', () => {
  it('reclassifies an existing preview workspace after local saved-rule deletion or recovery', () => {
    expect(handlerSource('assistant:delete-favorite-ledgers-local')).toContain(
      'reclassifyFavoriteWorkspaceIfPreviewing(accountMid)'
    )
    expect(handlerSource('assistant:restore-favorite-ledgers-local')).toContain(
      'reclassifyFavoriteWorkspaceIfPreviewing(accountMid)'
    )
  })

  it('does not trigger a full configuration reclassification for an in-round saved-rule participation toggle', () => {
    expect(handlerSource('assistant:write-favorite-ledger-enabled')).not.toContain(
      'reclassifyFavoriteWorkspaceIfPreviewing(accountMid)'
    )
    expect(handlerSource('assistant:write-default-favorite-system-enabled')).toContain(
      'reclassifyFavoriteWorkspaceIfPreviewing(accountMid)'
    )
  })

  it('refreshes only relationship projection after a remote-only draft is removed', () => {
    const handler = handlerSource('assistant:delete-favorite-ledger-draft')
    expect(handler).toContain('refreshFavoriteWorkspaceRelationshipProjectionIfPresent(accountMid)')
    expect(handler).not.toContain('reclassifyFavoriteWorkspaceIfPreviewing(accountMid)')
  })

  it('does not require a workspace when deleting a local rule outside previewing', () => {
    const handler = handlerSource('assistant:delete-favorite-ledgers-local')
    expect(handler).toContain("workspaceSnapshot = await oldFavoriteWorkspaceCoordinator?.getSnapshot(accountMid) ?? null")
    expect(handler).toContain("workspaceSnapshot && !('recovery' in workspaceSnapshot) && workspaceSnapshot.status === 'previewing'")
    expect(handler).toContain('A missing/unreadable workspace is not evidence of an active preview')
  })

  it('runs deletion-protection recovery only after an explicitly adopted exact ID', () => {
    const callbackStart = mainSource.indexOf('onLedgerBindingSettled: async (accountMid, event) => {')
    const callbackEnd = mainSource.indexOf('\n    },', callbackStart)
    const callback = mainSource.slice(callbackStart, callbackEnd)
    expect(mainSource).toContain('async function reconcileFavoriteLedgerBindingProjection(\n  accountMid: string,\n  options: { recoverUserConfirmedAdoptions?: boolean } = {}\n)')
    expect(mainSource).toContain('async function refreshFavoriteLedgerBindingProjectionAfterPhysicalShard(accountMid: string)')
    expect(mainSource).toContain('projectFavoriteLedgersFromPhysicalShards(current.favoriteLedgers, repositorySnapshot.physicalShards, options)')
    expect(callback).toContain("event.kind === 'adoption'")
    expect(callback).toContain('reconcileFavoriteLedgerBindingProjection(accountMid, { recoverUserConfirmedAdoptions: true })')
    expect(callback).toContain('refreshFavoriteLedgerBindingProjectionAfterPhysicalShard(accountMid)')
    expect(callback).not.toContain('reclassifyFavoriteWorkspaceIfPreviewing(accountMid)')
  })

  it('does not erase the user-deleted default marker during ordinary projection', () => {
    const reconcileStart = mainSource.indexOf('async function reconcileFavoriteLedgerBindingProjection(accountMid: string)')
    const reconcileEnd = mainSource.indexOf('\n}\n\n/** Refreshes the account rule projection', reconcileStart)
    const reconcile = mainSource.slice(reconcileStart, reconcileEnd)
    expect(reconcile).not.toContain('managedFolderDeletedByUser: _deletedByUser')
  })

  it('restores a durable confirmed adoption on account open without remote inventory', () => {
    const accountOpenStart = mainSource.indexOf('onAccountOpenLocal: async (accountMid) => {')
    const accountOpenEnd = mainSource.indexOf('\n    },', accountOpenStart)
    const accountOpen = mainSource.slice(accountOpenStart, accountOpenEnd)
    expect(accountOpen).toContain('reconcileFavoriteLedgerBindingProjection(accountMid, { recoverUserConfirmedAdoptions: true })')
    expect(accountOpen).not.toContain('readFolderInventory')
  })

  it('derives library backup states from both account-rule protection and every physical shard', () => {
    const stateStart = mainSource.indexOf('function favoriteLedgerBackupStatesForLibrary(')
    const stateEnd = mainSource.indexOf('\n}\n\n/** Refreshes the account rule projection', stateStart)
    const state = mainSource.slice(stateStart, stateEnd)
    expect(state).toContain("ledger.bindingState === 'unbound'")
    expect(state).toContain('hasPartialPhysicalBinding')
    expect(mainSource).toContain('getFavoriteLedgerBackupStates: favoriteLedgerBackupStatesForLibrary')
  })

  it('fails closed for the library when a physical shard count omits detail rows', () => {
    const stateStart = mainSource.indexOf('function favoriteLedgerBackupStatesForLibrary(')
    const stateEnd = mainSource.indexOf('\n}\n\n/** Refreshes the account rule projection', stateStart)
    const state = mainSource.slice(stateStart, stateEnd)
    expect(state).toContain('physicalShardDetailsIncomplete')
    expect(state).toContain('summary.physicalShardCount')
    expect(state).toContain("folder.kind === 'bilimi-logical'")
  })

  it('routes each confirmed Bilibili folder mutation through the account-scoped projection and favorite-page refresh', () => {
    expect(mainSource).toContain("import { refreshBilibiliFavoriteSpacePages, refreshBilibiliGuestPages } from './bilibiliSessionRefresh'")
    expect(mainSource).toContain("import { BilibiliFavoriteSpaceRefreshCoordinator } from './bilibiliFavoriteSpaceRefreshCoordinator'")
    expect(mainSource).toContain('async function refreshConfirmedBilibiliFavoriteFolderMutation(accountMid: string)')
    const refreshStart = mainSource.indexOf('async function refreshConfirmedBilibiliFavoriteFolderMutation(accountMid: string)')
    const refreshEnd = mainSource.indexOf('\n}', refreshStart)
    const refresh = mainSource.slice(refreshStart, refreshEnd)
    expect(refresh).toContain('bilibiliFavoriteSpaceRefreshCoordinator?.refresh(accountMid)')

    const refreshCoordinatorStart = mainSource.indexOf('bilibiliFavoriteSpaceRefreshCoordinator = new BilibiliFavoriteSpaceRefreshCoordinator({')
    const refreshCoordinatorEnd = mainSource.indexOf('\n  })', refreshCoordinatorStart)
    const refreshCoordinator = mainSource.slice(refreshCoordinatorStart, refreshCoordinatorEnd)
    expect(refreshCoordinator).toContain('getCurrentAccountMid: readCurrentBilibiliAccountMid')
    expect(refreshCoordinator).toContain('refreshProjection: refreshFavoriteLedgerBindingProjectionAfterPhysicalShard')
    expect(refreshCoordinator).toContain('refreshBilibiliFavoriteSpacePages({')
    expect(refreshCoordinator).toContain('targetSession: session.fromPartition(BILIMI_SESSION_PARTITION)')
    expect(refreshCoordinator).toContain('getAllWebContents: () => webContents.getAllWebContents()')

    const bindingStart = mainSource.indexOf('favoriteRepositoryBindingService = new FavoriteRepositoryBindingService({')
    const bindingEnd = mainSource.indexOf('\n  })', bindingStart)
    const binding = mainSource.slice(bindingStart, bindingEnd)
    expect(binding).toContain('onConfirmedRemoteFolderMutation: refreshConfirmedBilibiliFavoriteFolderMutation')

    const syncStart = mainSource.indexOf('favoriteRepositorySyncService = new FavoriteRepositorySyncService({')
    const syncEnd = mainSource.indexOf('\n  })', syncStart)
    const sync = mainSource.slice(syncStart, syncEnd)
    expect(sync).toContain('onConfirmedRemoteFolderMutation: refreshConfirmedBilibiliFavoriteFolderMutation')

    const managedStart = mainSource.indexOf('favoriteRepositoryManagedFolderService = new FavoriteRepositoryManagedFolderService({')
    const managedEnd = mainSource.indexOf('\n  })', managedStart)
    const managed = mainSource.slice(managedStart, managedEnd)
    expect(managed).toContain('deletions.some((deletion) => deletion.remoteDeleted)')
    expect(managed).toContain('refreshConfirmedBilibiliFavoriteFolderMutation(accountMid)')

    const coordinatorStart = mainSource.indexOf('oldFavoriteWorkspaceCoordinator = new OldFavoriteWorkspaceCoordinator({')
    const coordinatorEnd = mainSource.indexOf('\n  })', coordinatorStart)
    const coordinator = mainSource.slice(coordinatorStart, coordinatorEnd)
    expect(coordinator).not.toContain('refreshConfirmedBilibiliFavoriteFolderMutation(accountMid)')

  })

  it('hides only locally deleted retained remote mirrors until explicit backup', () => {
    const managedStart = mainSource.indexOf('favoriteRepositoryManagedFolderService = new FavoriteRepositoryManagedFolderService({')
    const managedEnd = mainSource.indexOf('\n  })', managedStart)
    const managed = mainSource.slice(managedStart, managedEnd)
    expect(managed).toContain('.filter((deletion) => !deletion.remoteDeleted)')
    expect(managed).toContain('markFavoriteLedgerRemoteDraftRediscoveryPending(getDesktopStore(), accountMid, retainedRemoteFolderIds)')
  })

  it('uses the same single-flight local projection after automatic capacity provisioning', () => {
    const syncServiceStart = mainSource.indexOf('favoriteRepositorySyncService = new FavoriteRepositorySyncService({')
    const syncServiceEnd = mainSource.indexOf('\n  })', syncServiceStart)
    const syncService = mainSource.slice(syncServiceStart, syncServiceEnd)
    const coordinatorStart = mainSource.indexOf('oldFavoriteWorkspaceCoordinator = new OldFavoriteWorkspaceCoordinator({')
    const coordinatorEnd = mainSource.indexOf('\n  })', coordinatorStart)
    const coordinator = mainSource.slice(coordinatorStart, coordinatorEnd)
    expect(syncService).toContain('onPhysicalShardProvisioned: refreshFavoriteLedgerBindingProjectionAfterPhysicalShard')
    expect(coordinator).toContain('onPhysicalShardProvisioned: refreshFavoriteLedgerBindingProjectionAfterPhysicalShard')
  })

  it('does not start a remote inventory or managed-folder restoration when the library account opens', () => {
    expect(mainSource).not.toContain("import { restoreFavoriteLibraryManagedFolderProjection } from './favoriteLibraryManagedFolderProjection'")
    expect(mainSource).not.toContain('onAccountOpen: async (accountMid) => {')
  })

  it('reprojects account bindings after releasing default physical shards', () => {
    const handler = handlerSource('assistant:release-default-favorite-ledger-bindings')
    expect(handler).toContain('refreshFavoriteLedgerBindingProjectionAfterPhysicalShard(accountMid)')
  })

  it('does not restore a recommendation-specific deletion blacklist', () => {
    expect(mainSource).not.toContain('function getFavoriteLedgerDeletedRecommendationRemoteFolderIds(accountMid: string)')
    expect(mainSource).not.toContain("record.ledger.ruleOrigin === 'recommendation-draft'")
    expect(mainSource).not.toContain('getFavoriteLedgerDeletedRecommendationRemoteFolderIds')
  })
})
