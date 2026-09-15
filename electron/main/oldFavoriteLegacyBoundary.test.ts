import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')

function source(path: string): string {
  return readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n')
}

describe('formal old-favorite boundary', () => {
  it('does not statically import the retired runtime, session, or workspace-v2 services', () => {
    const main = source('electron/main/index.ts')

    expect(main).not.toContain("from './oldFavoriteRuntimeStore'")
    expect(main).not.toContain("from './oldFavoriteSessionStore'")
    expect(main).not.toContain("from './oldFavoritePersistence'")
    expect(main).not.toContain("from './oldFavoriteWorkspaceService'")
    expect(main).not.toContain("from './oldFavoriteWorkspaceIpc'")
  })

  it('exposes only controlled v1 workspace commands instead of legacy renderer APIs', () => {
    const preload = source('electron/preload/index.ts')
    const declarations = source('src/renderer/src/global.d.ts')

    for (const retiredApi of [
      'getOldFavoriteRuntimeSnapshot',
      'loadOldFavoriteSessions',
      'openOldFavoriteWorkspaceAccount',
      'scanOldFavorites',
      'executeOldFavoritePlan'
    ]) {
      expect(preload).not.toContain(`${retiredApi}:`)
      expect(declarations).not.toContain(`${retiredApi}?:`)
    }

    expect(preload).toContain('old-favorite-workspace-v1:open')
    expect(preload).toContain('old-favorite-workspace-v1:command')
    expect(declarations).toContain('openOldFavoriteWorkspaceV1?:')
    expect(declarations).toContain('commandOldFavoriteWorkspaceV1?:')
  })

  it('does not retain legacy scan or execution requests in the renderer runtime union', () => {
    const runtimeTypes = source('src/renderer/src/features/assistant/assistantRuntimeTypes.ts')
    const runtimeTimeouts = source('electron/main/assistantRuntimeSignal.ts')

    for (const retiredRequest of [
      'scan-old-favorites',
      'commit-old-favorite-batch',
      'execute-old-favorite-plan'
    ]) {
      expect(runtimeTypes).not.toContain(retiredRequest)
      expect(runtimeTimeouts).not.toContain(retiredRequest)
    }
  })
})
