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

  it('reprojects all formal physical shards after a binding adoption', () => {
    const callbackStart = mainSource.indexOf('onLedgerBindingAdopted: async (accountMid, logicalLedgerId) => {')
    const callbackEnd = mainSource.indexOf('\n    },', callbackStart)
    const callback = mainSource.slice(callbackStart, callbackEnd)
    expect(mainSource).toContain('async function reconcileFavoriteLedgerBindingProjection(accountMid: string)')
    expect(mainSource).toContain('async function refreshFavoriteLedgerBindingProjectionAfterPhysicalShard(accountMid: string)')
    expect(mainSource).toContain('projectFavoriteLedgersFromPhysicalShards(current.favoriteLedgers, repositorySnapshot.physicalShards)')
    expect(callback).toContain('refreshFavoriteLedgerBindingProjectionAfterPhysicalShard(accountMid)')
    expect(callback).not.toContain('reclassifyFavoriteWorkspaceIfPreviewing(accountMid)')
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

  it('keeps local binding projection running when remote account-open recovery fails', () => {
    const accountOpenStart = mainSource.indexOf('onAccountOpen: async (accountMid) => {')
    const accountOpenEnd = mainSource.indexOf('\n    },', accountOpenStart)
    const accountOpen = mainSource.slice(accountOpenStart, accountOpenEnd)
    expect(accountOpen).toContain('await oldFavoriteWorkspaceCoordinator!.recoverPersistedManagedBindings(accountMid).catch(() => undefined)')
    expect(accountOpen).toContain('await reconcileFavoriteLedgerBindingProjection(accountMid)')
  })
})
