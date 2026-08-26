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
})
