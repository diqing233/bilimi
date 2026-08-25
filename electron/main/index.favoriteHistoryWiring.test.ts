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
})
