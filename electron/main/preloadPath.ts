import { join } from 'node:path'

export function createPreloadScriptPath(mainOutputDir: string) {
  return join(mainOutputDir, '../preload/index.mjs')
}

export function createFavoriteLibraryPreloadScriptPath(mainOutputDir: string) {
  return join(mainOutputDir, '../preload/favoriteLibrary.mjs')
}
