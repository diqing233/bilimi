import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const mainSource = readFileSync(resolve(process.cwd(), 'electron/main/index.ts'), 'utf8')
const preloadSource = readFileSync(resolve(process.cwd(), 'electron/preload/index.ts'), 'utf8')
const rendererTypesSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/global.d.ts'), 'utf8')

function handlerSource(handlerName: string) {
  const handlerStart = mainSource.indexOf(`ipcMain.handle('${handlerName}'`)
  const nextHandler = mainSource.indexOf("ipcMain.handle('", handlerStart + 1)
  return {
    handlerStart,
    handler: mainSource.slice(handlerStart, nextHandler === -1 ? mainSource.length : nextHandler)
  }
}

describe('favorite ledger draft deletion narrow IPC', () => {
  it('exposes a dedicated account-scoped deletion contract', () => {
    expect(preloadSource).toContain('deleteFavoriteLedgerDraft: (accountMid: string, ledgerId: string)')
    expect(preloadSource).toContain("ipcRenderer.invoke('assistant:delete-favorite-ledger-draft', accountMid, ledgerId)")
    expect(rendererTypesSource).toContain('deleteFavoriteLedgerDraft?: (accountMid: string, ledgerId: string)')
  })

  it('exposes a batched account-scoped local configuration deletion contract', () => {
    expect(preloadSource).toContain('deleteFavoriteLedgersLocal: (accountMid: string, ledgerIds: string[])')
    expect(preloadSource).toContain("ipcRenderer.invoke('assistant:delete-favorite-ledgers-local', accountMid, ledgerIds)")
    expect(rendererTypesSource).toContain('deleteFavoriteLedgersLocal?: (accountMid: string, ledgerIds: string[])')
  })

  it('exposes an account-scoped deleted-rule recovery contract', () => {
    expect(preloadSource).toContain('restoreFavoriteLedgersLocal: (accountMid: string, ledgerIds: string[])')
    expect(preloadSource).toContain("ipcRenderer.invoke('assistant:restore-favorite-ledgers-local', accountMid, ledgerIds)")
    expect(rendererTypesSource).toContain('restoreFavoriteLedgersLocal?: (accountMid: string, ledgerIds: string[])')
    const { handlerStart, handler } = handlerSource('assistant:restore-favorite-ledgers-local')
    expect(handlerStart).toBeGreaterThan(-1)
    expect(handler).toContain('deletedFavoriteLedgerRecords')
    expect(handler).toContain('saveFavoriteAccountPreferences')
    expect(handler).not.toContain('ensureFavoriteLedger')
    expect(handler).not.toContain('favoriteRepository')
  })

  it('exposes a narrow account-scoped release contract for default local resets', () => {
    expect(preloadSource).toContain('releaseDefaultFavoriteLedgerBindings: (accountMid: string, ledgerIds: string[])')
    expect(preloadSource).toContain("ipcRenderer.invoke('assistant:release-default-favorite-ledger-bindings', accountMid, ledgerIds)")
    expect(rendererTypesSource).toContain('releaseDefaultFavoriteLedgerBindings?: (accountMid: string, ledgerIds: string[])')
  })

  it('exposes an account-scoped explicit-backup release contract', () => {
    expect(preloadSource).toContain('consumeFavoriteLedgerRemoteDraftRediscoveryPending: (accountMid: string)')
    expect(preloadSource).toContain("ipcRenderer.invoke('assistant:consume-favorite-ledger-remote-draft-rediscovery-pending', accountMid)")
    expect(rendererTypesSource).toContain('consumeFavoriteLedgerRemoteDraftRediscoveryPending?: (accountMid: string)')
  })

  it('exposes a read-only account-scoped pending-draft suppression contract for ordinary status scans', () => {
    expect(preloadSource).toContain('getFavoriteLedgerRemoteDraftRediscoveryPending: (accountMid: string)')
    expect(preloadSource).toContain("ipcRenderer.invoke('assistant:get-favorite-ledger-remote-draft-rediscovery-pending', accountMid)")
    expect(rendererTypesSource).toContain('getFavoriteLedgerRemoteDraftRediscoveryPending?: (accountMid: string)')
  })

  it('persists only a verified unsaved draft and refreshes preferences without repository or remote calls', () => {
    const { handlerStart, handler } = handlerSource('assistant:delete-favorite-ledger-draft')

    expect(handlerStart).toBeGreaterThan(-1)
    expect(handler).toContain('assertTrustedOldFavoriteAssistantSender(event)')
    expect(handler).toContain('accountMid !== await readCurrentBilibiliAccountMid()')
    expect(handler).toContain('removeUnsavedFavoriteLedgerDraft(current.favoriteLedgers, ledgerId)')
    expect(handler).toContain('removePureRecommendationLedgerDraft(current.favoriteLedgers, ledgerId)')
    expect(handler).toContain('markFavoriteLedgerRemoteDraftRediscoveryPending(getDesktopStore(), accountMid, remoteFolderIds)')
    expect(handler).toContain('remoteFolderIds')
    expect(handler).toContain('saveFavoriteAccountPreferences(getDesktopStore(), accountMid, {')
    expect(handler).toContain('deletedFavoriteLedgerRecords')
    expect(handler).toContain('sendAssistantPreferencesChanged(loadAssistantPreferences(getDesktopStore()))')
    expect(handler).toContain('notifyFloatingAssistantSnapshotChanged()')
    expect(handler).not.toContain('favoriteRepository')
    expect(handler).not.toContain('dismissFavoriteLedgerRemoteDraftReminder')
    expect(handler).not.toContain('clearFavoriteLedgerRemoteDraftReminder')
    expect(handler).not.toContain('requestMainAssistantRuntime')
  })

  it('removes selected custom configurations locally and leaves repository and B站 calls out of the handler', () => {
    const { handlerStart, handler } = handlerSource('assistant:delete-favorite-ledgers-local')

    expect(handlerStart).toBeGreaterThan(-1)
    expect(handler).toContain('assertTrustedOldFavoriteAssistantSender(event)')
    expect(handler).toContain('accountMid !== await readCurrentBilibiliAccountMid()')
    expect(handler).toContain('removeLocalFavoriteLedgers(current.favoriteLedgers, ledgerIds)')
    expect(handler).toContain('deletedFavoriteLedgerRecords')
    expect(handler).toContain('removedLedgers.map((ledger) => ({')
    expect(handler).toContain('markFavoriteLedgerRemoteDraftRediscoveryPending(getDesktopStore(), accountMid, remoteFolderIds)')
    expect(handler).toContain('saveFavoriteAccountPreferences(getDesktopStore(), accountMid, {')
    expect(handler).toContain('sendAssistantPreferencesChanged(loadAssistantPreferences(getDesktopStore()))')
    expect(handler).toContain('notifyFloatingAssistantSnapshotChanged()')
    expect(handler).not.toContain('favoriteRepository')
    expect(handler).not.toContain('removeRemoteFolder')
    expect(handler).not.toContain('deleteManagedFavoriteFolders')
  })

  it('releases only selected default physical bindings without a B站 delete or logical-membership command', () => {
    const { handlerStart, handler } = handlerSource('assistant:release-default-favorite-ledger-bindings')

    expect(handlerStart).toBeGreaterThan(-1)
    expect(handler).toContain('assertTrustedOldFavoriteAssistantSender(event)')
    expect(handler).toContain('accountMid !== await readCurrentBilibiliAccountMid()')
    expect(handler).toContain('ledger.isDefault')
    expect(handler).toContain('favoriteRepositoryService!.getSnapshot(accountMid)')
    expect(handler).toContain("type: 'remove-physical-shard-binding'")
    expect(handler).not.toContain('removeRemoteFolder')
    expect(handler).not.toContain('deleteManagedFavoriteFolders')
    expect(handler).not.toContain('deleteManagedRemoteFolders')
    expect(handler).not.toContain('saveFavoriteAccountPreferences')
  })

  it('consumes only pending remote drafts for a trusted current account', () => {
    const { handlerStart, handler } = handlerSource('assistant:consume-favorite-ledger-remote-draft-rediscovery-pending')

    expect(handlerStart).toBeGreaterThan(-1)
    expect(handler).toContain('assertTrustedOldFavoriteAssistantSender(event)')
    expect(handler).toContain('accountMid !== await readCurrentBilibiliAccountMid()')
    expect(handler).toContain('consumeFavoriteLedgerRemoteDraftRediscoveryPending(getDesktopStore(), accountMid)')
    expect(handler).not.toContain('favoriteRepository')
    expect(handler).not.toContain('removeUnsavedFavoriteLedgerDraft')
    expect(handler).not.toContain('dismissFavoriteLedgerRemoteDraftReminder')
  })

  it('reads pending remote drafts for a trusted current account without consuming or changing remote state', () => {
    const { handlerStart, handler } = handlerSource('assistant:get-favorite-ledger-remote-draft-rediscovery-pending')

    expect(handlerStart).toBeGreaterThan(-1)
    expect(handler).toContain('assertTrustedOldFavoriteAssistantSender(event)')
    expect(handler).toContain('accountMid !== await readCurrentBilibiliAccountMid()')
    expect(handler).toContain('loadFavoriteLedgerRemoteDraftRediscoveryPending(getDesktopStore(), accountMid)')
    expect(handler).not.toContain('consumeFavoriteLedgerRemoteDraftRediscoveryPending')
    expect(handler).not.toContain('favoriteRepository')
    expect(handler).not.toContain('dismissFavoriteLedgerRemoteDraftReminder')
  })

  it('does not treat a locally deleted remote draft as an explicit do-not-remind choice', () => {
    const registrationStart = mainSource.indexOf('registerFavoriteRepositoryIpc({')
    const registration = mainSource.slice(registrationStart, mainSource.indexOf('registerFavoriteLibraryCommandsIpc({', registrationStart))
    const reminderStart = registration.indexOf('getRemoteDraftReminderDismissed: (accountMid) =>')
    const reminderEnd = registration.indexOf('dismissRemoteDraftReminder:', reminderStart)
    const reminder = registration.slice(reminderStart, reminderEnd)

    expect(reminderStart).toBeGreaterThan(-1)
    expect(reminder).toContain('loadFavoriteLedgerRemoteDraftReminderDismissals(getDesktopStore(), accountMid)')
    expect(reminder).not.toContain('loadFavoriteLedgerRemoteDraftRediscoveryPending(getDesktopStore(), accountMid)')
  })
})
