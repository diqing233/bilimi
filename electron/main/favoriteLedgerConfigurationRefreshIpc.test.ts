import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const mainSource = readFileSync(resolve(process.cwd(), 'electron/main/index.ts'), 'utf8')

function handlerSource(handlerName: string) {
  const handlerStart = mainSource.indexOf(`ipcMain.handle('${handlerName}'`)
  const nextHandler = mainSource.indexOf("ipcMain.handle('", handlerStart + 1)
  return mainSource.slice(handlerStart, nextHandler === -1 ? mainSource.length : nextHandler)
}

function coordinatorOptionSource(optionName: string) {
  const start = mainSource.indexOf(`    ${optionName}:`)
  const nextOption = mainSource.indexOf('\n    onSegmentsReady:', start + 1)
  return mainSource.slice(start, nextOption === -1 ? mainSource.length : nextOption)
}

describe('favorite ledger configuration refresh IPC', () => {
  it('restores only exact deleted local rules for a history position without invoking rule reclassification or remote services', () => {
    const coordinatorSource = coordinatorOptionSource('restoreDeletedFavoriteLedgerRulesForHistory')

    expect(coordinatorSource).toContain('restoreDeletedFavoriteLedgerRulesForHistory')
    expect(coordinatorSource).toContain('requestedIds.includes(record.logicalLedgerId)')
    expect(coordinatorSource).toContain('deletedFavoriteLedgerRecords: records.filter')
    expect(coordinatorSource).not.toContain('reclassifyFavoriteWorkspaceIfPreviewing(accountMid)')
    expect(coordinatorSource).not.toContain('favoriteRepositoryBindingService')
    expect(coordinatorSource).not.toContain('favoriteRepositorySyncService')
  })

  it('schedules an existing preview workspace reclassification after local saved-rule deletion or recovery without awaiting its full scan', () => {
    expect(handlerSource('assistant:delete-favorite-ledgers-local')).toContain(
      'reclassifyFavoriteWorkspaceIfPreviewing(accountMid)'
    )
    expect(handlerSource('assistant:restore-favorite-ledgers-local')).toContain(
      'reclassifyFavoriteWorkspaceIfPreviewing(accountMid)'
    )
  })

  it('reclassifies an existing preview workspace after a saved-rule enablement or default-system change', () => {
    expect(handlerSource('assistant:write-favorite-ledger-enabled')).toContain(
      'reclassifyFavoriteWorkspaceIfPreviewing(accountMid)'
    )
    expect(handlerSource('assistant:write-default-favorite-system-enabled')).toContain(
      'reclassifyFavoriteWorkspaceIfPreviewing(accountMid)'
    )
  })

  it('returns the running configuration snapshot immediately instead of awaiting the complete reclassification in a rule IPC', () => {
    const helperStart = mainSource.indexOf('async function reclassifyFavoriteWorkspaceIfPreviewing')
    const helper = mainSource.slice(helperStart, mainSource.indexOf('\n}\n', helperStart) + 2)
    expect(helper).toContain('scheduleFavoriteConfigurationReclassification(accountMid)')
    expect(helper).not.toContain('reclassifyForFavoriteConfiguration(accountMid)')
  })

  it('refreshes only relationship projection after a remote-only draft is removed', () => {
    const handler = handlerSource('assistant:delete-favorite-ledger-draft')
    expect(handler).toContain('refreshFavoriteWorkspaceRelationshipProjectionIfPresent(accountMid)')
    expect(handler).not.toContain('reclassifyFavoriteWorkspaceIfPreviewing(accountMid)')
  })
})
