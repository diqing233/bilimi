import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('favorite history wiring', () => {
  it('imports the predicate used by the history callbacks', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'index.ts'), 'utf8')
    expect(source).toMatch(
      /import\s*\{[^}]*\bisUnsavedFavoriteLedgerDraft\b[^}]*\}\s*from\s+['"]\.\.\/\.\.\/src\/shared\/favoriteLedgerDraftDeletion['"]/s
    )
  })

  it('wraps full favorite-rule preference saves with main-process history capture', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'index.ts'), 'utf8')
    expect(source).toMatch(/recordFavoriteLedgerHistoryAroundMutation/)
    expect(source).toMatch(/assistant:save-preferences[\s\S]{0,1600}recordFavoriteLedgerHistoryAroundMutation/)
    expect(source).toMatch(/assistant:patch-preferences[\s\S]{0,2200}recordFavoriteLedgerHistoryAroundMutation/)
  })

  it('broadcasts the assistant snapshot after managed-folder deletion persistence', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'index.ts'), 'utf8')
    const managedFolderDeletedBlock = source.match(/onManagedFolderDeleted:[\s\S]{0,2600}?\r?\n\s*\},\r?\n\s*remote:/)?.[0] ?? ''
    const managedFolderDeletionBlock = source.match(/onManagedFolderDeletion:[\s\S]{0,2600}?\r?\n\s*\},\r?\n\s*classifyCurrentItems:/)?.[0] ?? ''
    expect(managedFolderDeletedBlock).toContain('notifyFloatingAssistantSnapshotChanged()')
    expect(managedFolderDeletionBlock).toContain('notifyFloatingAssistantSnapshotChanged()')
  })

  it('creates the main window before slow startup recovery awaits', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'index.ts'), 'utf8')
    const startup = source.slice(source.indexOf('if (singleInstanceGuard) app.whenReady()'))
    expect(startup.indexOf('createMainWindow()')).toBeGreaterThanOrEqual(0)
    expect(startup.indexOf('createMainWindow()')).toBeLessThan(startup.indexOf('await bilibiliSessionProxy.applyPreference'))
  })

  it('restores a locally deleted work folder only after a successful explicit backup result', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'index.ts'), 'utf8')
    const helper = source.match(/function scheduleLocalManagedFolderRecoveryAfterExplicitBusinessAction[\s\S]*?\n}\r?\n/)?.[0] ?? ''
    const ensureLedgersHandler = source.match(/ipcMain\.handle\('floating-assistant:ensure-ledgers',[\s\S]{0,900}?\n  }\)/)?.[0] ?? ''
    const ensureLedgerHandler = source.match(/ipcMain\.handle\('floating-assistant:ensure-ledger',[\s\S]{0,1000}?\n  }\)/)?.[0] ?? ''
    const saveLedgersHandler = source.match(/'floating-assistant:save-ledgers',[\s\S]{0,1200}?\n    }\n  \)/)?.[0] ?? ''

    expect(helper).toContain('result.ok')
    expect(helper).toContain('readCurrentBilibiliAccountMid')
    expect(helper).toContain('restoreAfterExplicitBusinessAction')
    expect(ensureLedgersHandler).toContain('scheduleLocalManagedFolderRecoveryAfterExplicitBusinessAction')
    expect(ensureLedgersHandler).toContain('operationAccountMid')
    expect(ensureLedgerHandler).toContain('scheduleLocalManagedFolderRecoveryAfterExplicitBusinessAction')
    expect(ensureLedgerHandler).toContain('operationAccountMid')
    expect(saveLedgersHandler).toContain('hasExplicitFavoriteLedgerBackupSaveOptions')
    expect(saveLedgersHandler).toContain('scheduleLocalManagedFolderRecoveryAfterExplicitBusinessAction')
    expect(saveLedgersHandler).toContain('operationAccountMid')
  })
})
