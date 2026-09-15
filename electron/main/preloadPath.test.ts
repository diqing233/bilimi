import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createPreloadScriptPath } from './preloadPath'

const preloadPathSource = readFileSync(resolve(process.cwd(), 'electron/main/preloadPath.ts'), 'utf8')
const viteConfigSource = readFileSync(resolve(process.cwd(), 'electron.vite.config.ts'), 'utf8')

describe('createPreloadScriptPath', () => {
  it('points BrowserWindow preload config at the built ESM preload file', () => {
    const mainOutputDir = join('C:', 'app', 'out', 'main')

    expect(createPreloadScriptPath(mainOutputDir)).toBe(
      join('C:', 'app', 'out', 'preload', 'index.mjs')
    )
  })

  it('does not retain a dedicated favorite-library preload bundle', () => {
    expect(preloadPathSource).not.toContain('createFavoriteLibraryPreloadScriptPath')
    expect(preloadPathSource).not.toContain('favoriteLibrary.mjs')
    expect(viteConfigSource).not.toContain("favoriteLibrary: resolve(import.meta.dirname, 'electron/preload/favoriteLibrary.ts')")
  })
})
