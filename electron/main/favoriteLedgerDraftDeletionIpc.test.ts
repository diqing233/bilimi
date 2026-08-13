import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const mainSource = readFileSync(resolve(process.cwd(), 'electron/main/index.ts'), 'utf8')
const preloadSource = readFileSync(resolve(process.cwd(), 'electron/preload/index.ts'), 'utf8')
const rendererTypesSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/global.d.ts'), 'utf8')

describe('favorite ledger draft deletion narrow IPC', () => {
  it('exposes a dedicated account-scoped deletion contract', () => {
    expect(preloadSource).toContain('deleteFavoriteLedgerDraft: (accountMid: string, ledgerId: string)')
    expect(preloadSource).toContain("ipcRenderer.invoke('assistant:delete-favorite-ledger-draft', accountMid, ledgerId)")
    expect(rendererTypesSource).toContain('deleteFavoriteLedgerDraft?: (accountMid: string, ledgerId: string)')
  })

  it('exposes an account-scoped explicit-backup release contract', () => {
    expect(preloadSource).toContain('consumeFavoriteLedgerRemoteDraftRediscoveryPending: (accountMid: string)')
    expect(preloadSource).toContain("ipcRenderer.invoke('assistant:consume-favorite-ledger-remote-draft-rediscovery-pending', accountMid)")
    expect(rendererTypesSource).toContain('consumeFavoriteLedgerRemoteDraftRediscoveryPending?: (accountMid: string)')
  })

  it('persists only a verified unsaved draft and refreshes preferences without repository or remote calls', () => {
    const handlerStart = mainSource.indexOf("ipcMain.handle('assistant:delete-favorite-ledger-draft'")
    const handlerEnd = mainSource.indexOf("ipcMain.handle('assistant:write-default-favorite-system-enabled'", handlerStart)
    const handler = mainSource.slice(handlerStart, handlerEnd)

    expect(handlerStart).toBeGreaterThan(-1)
    expect(handler).toContain('assertTrustedOldFavoriteAssistantSender(event)')
    expect(handler).toContain('accountMid !== await readCurrentBilibiliAccountMid()')
    expect(handler).toContain('removeUnsavedFavoriteLedgerDraft(current.favoriteLedgers, ledgerId)')
    expect(handler).toContain('markFavoriteLedgerRemoteDraftRediscoveryPending(getDesktopStore(), accountMid, remoteFolderIds)')
    expect(handler).toContain('remoteFolderIds')
    expect(handler).toContain('saveFavoriteAccountPreferences(getDesktopStore(), accountMid, { ...current, favoriteLedgers })')
    expect(handler).toContain('sendAssistantPreferencesChanged(loadAssistantPreferences(getDesktopStore()))')
    expect(handler).toContain('notifyFloatingAssistantSnapshotChanged()')
    expect(handler).not.toContain('favoriteRepository')
    expect(handler).not.toContain('dismissFavoriteLedgerRemoteDraftReminder')
    expect(handler).not.toContain('clearFavoriteLedgerRemoteDraftReminder')
    expect(handler).not.toContain('requestMainAssistantRuntime')
  })

  it('consumes only pending remote drafts for a trusted current account', () => {
    const handlerStart = mainSource.indexOf("ipcMain.handle('assistant:consume-favorite-ledger-remote-draft-rediscovery-pending'")
    const handlerEnd = mainSource.indexOf("ipcMain.on('assistant:preview-preference-patch'", handlerStart)
    const handler = mainSource.slice(handlerStart, handlerEnd)

    expect(handlerStart).toBeGreaterThan(-1)
    expect(handler).toContain('assertTrustedOldFavoriteAssistantSender(event)')
    expect(handler).toContain('accountMid !== await readCurrentBilibiliAccountMid()')
    expect(handler).toContain('consumeFavoriteLedgerRemoteDraftRediscoveryPending(getDesktopStore(), accountMid)')
    expect(handler).not.toContain('favoriteRepository')
    expect(handler).not.toContain('removeUnsavedFavoriteLedgerDraft')
    expect(handler).not.toContain('dismissFavoriteLedgerRemoteDraftReminder')
  })
})
