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
    const managedFolderDeletedBlock = source.match(/onManagedFolderDeleted:[\s\S]{0,2600}?\n\s*\},\n\s*remote:/)?.[0] ?? ''
    const managedFolderDeletionBlock = source.match(/onManagedFolderDeletion:[\s\S]{0,2600}?\n\s*\},\n\s*classifyCurrentItems:/)?.[0] ?? ''
    expect(managedFolderDeletedBlock).toContain('notifyFloatingAssistantSnapshotChanged()')
    expect(managedFolderDeletionBlock).toContain('notifyFloatingAssistantSnapshotChanged()')
  })

  it('creates the main window before slow startup recovery awaits', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'index.ts'), 'utf8')
    const startup = source.slice(source.indexOf('if (singleInstanceGuard) app.whenReady()'))
    expect(startup.indexOf('createMainWindow()')).toBeGreaterThanOrEqual(0)
    expect(startup.indexOf('createMainWindow()')).toBeLessThan(startup.indexOf('await bilibiliSessionProxy.applyPreference'))
  })
})
