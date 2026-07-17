import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createOldFavoriteBatch } from '../../src/shared/oldFavoriteSessions'
import { createOldFavoritePersistence } from './oldFavoritePersistence'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('createOldFavoritePersistence', () => {
  it('migrates legacy sessions and runtime into the selected userData directory', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'bilimi-user-data-'))
    directories.push(userDataPath)
    const batch = createOldFavoriteBatch({ accountMid: '42', kind: 'full', aids: [1], now: '2026-07-17T00:00:00Z' })
    const values = new Map<string, unknown>([
      ['oldFavoriteSessions', { version: 1, batches: [batch], lease: null }],
      ['oldFavoriteRuntime', { accounts: {}, global: {} }]
    ])
    const legacyStore = {
      get: (key: 'oldFavoriteRuntime' | 'oldFavoriteSessions') => values.get(key),
      set: (key: 'oldFavoriteRuntime' | 'oldFavoriteSessions', value: null) => values.set(key, value)
    }

    const persistence = await createOldFavoritePersistence({ userDataPath, legacyStore })

    expect(persistence.sessionStore.load().batches[0].id).toBe(batch.id)
    expect(values.get('oldFavoriteSessions')).toBeNull()
    expect(values.get('oldFavoriteRuntime')).toBeNull()
  })
})
