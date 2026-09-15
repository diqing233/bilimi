import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const mainSource = readFileSync(resolve(process.cwd(), 'electron/main/index.ts'), 'utf8')
const preloadSource = readFileSync(resolve(process.cwd(), 'electron/preload/index.ts'), 'utf8')
const rendererTypesSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/global.d.ts'), 'utf8')

describe('favorite ledger enabled narrow IPC', () => {
  it('exposes a dedicated write and change subscription contract', () => {
    expect(preloadSource).toContain("writeFavoriteLedgerEnabled: (accountMid: string, ledgerId: string, enabled: boolean")
    expect(preloadSource).toContain("ipcRenderer.invoke('assistant:write-favorite-ledger-enabled'")
    expect(preloadSource).toContain('onFavoriteLedgerEnabledChanged:')
    expect(preloadSource).toContain("ipcRenderer.on('assistant:favorite-ledger-enabled-changed'")
    expect(rendererTypesSource).toContain('writeFavoriteLedgerEnabled?: (')
    expect(rendererTypesSource).toContain('onFavoriteLedgerEnabledChanged?: (')
  })

  it('persists through the narrow store helper and publishes only the narrow event', () => {
    expect(mainSource).toContain("ipcMain.handle('assistant:write-favorite-ledger-enabled'")
    expect(mainSource).toContain('await writeFavoriteLedgerEnabled(undefined, accountMid, ledgerId, enabled)')
    expect(mainSource).toContain("target.webContents.send('assistant:favorite-ledger-enabled-changed', patch, normalizedMeta)")
  })

  it('permits a local ledger-enabled write only for the sole local account while signed out', () => {
    expect(mainSource).toContain('if (currentAccountMid && accountMid !== currentAccountMid)')
    expect(mainSource).toContain('const localToggleAccountMid = resolveLocalFavoriteLedgerToggleAccountMid(')
    expect(mainSource).toContain('if (!currentAccountMid && accountMid !== localToggleAccountMid)')
    expect(mainSource).toContain('getFavoriteLedgerHistoryState(accountMid)')
    expect(mainSource).toContain('.catch((error) =>')
    expect(mainSource).toContain("error.message === 'Old favorite workspace has not been started.'")
    expect(mainSource).not.toContain('if (!accountMid || accountMid !== currentAccountMid)')
  })

  it('accepts an explicit history-merge option without overloading preference-patch metadata', () => {
    expect(preloadSource).toContain('historyOptions?: FavoriteLedgerEnabledHistoryOptions')
    expect(rendererTypesSource).toContain('historyOptions?: FavoriteLedgerEnabledHistoryOptions')
    expect(mainSource).toContain('historyOptions?: FavoriteLedgerEnabledHistoryOptions')
    expect(mainSource).toContain('mergeWithLatestClassification: true')
  })

  it('persists an account rule directory only after validating the current Bilibili account', () => {
    expect(preloadSource).toContain("writeFavoriteLedgerRules: (accountMid: string, favoriteLedgers: FavoriteLedger[])")
    expect(preloadSource).toContain("ipcRenderer.invoke('assistant:write-favorite-ledger-rules'")
    expect(rendererTypesSource).toContain('writeFavoriteLedgerRules?: (accountMid: string, favoriteLedgers: FavoriteLedger[])')
    expect(mainSource).toContain("ipcMain.handle('assistant:write-favorite-ledger-rules'")
    expect(mainSource).toContain("if (!accountMid || accountMid !== await readCurrentBilibiliAccountMid())")
    expect(mainSource).toContain('saveFavoriteAccountPreferences(getDesktopStore(), accountMid')
  })
})
