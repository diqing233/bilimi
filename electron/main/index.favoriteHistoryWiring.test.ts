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
})
