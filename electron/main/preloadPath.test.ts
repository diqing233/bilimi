import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFavoriteLibraryPreloadScriptPath, createPreloadScriptPath } from './preloadPath'

describe('createPreloadScriptPath', () => {
  it('points BrowserWindow preload config at the built ESM preload file', () => {
    const mainOutputDir = join('C:', 'app', 'out', 'main')

    expect(createPreloadScriptPath(mainOutputDir)).toBe(
      join('C:', 'app', 'out', 'preload', 'index.mjs')
    )
  })

  it('keeps the favorite library on a dedicated read-only preload bundle', () => {
    const mainOutputDir = join('C:', 'app', 'out', 'main')

    expect(createFavoriteLibraryPreloadScriptPath(mainOutputDir)).toBe(
      join('C:', 'app', 'out', 'preload', 'favoriteLibrary.mjs')
    )
  })
})
