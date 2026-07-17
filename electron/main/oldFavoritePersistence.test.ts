import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOldFavoritePersistence } from './oldFavoritePersistence'
import { createOldFavoriteBatch } from '../../src/shared/oldFavoriteSessions'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('createOldFavoritePersistence', () => {
  it('migrates legacy sessions only after persistence is explicitly opened', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'bilimi-old-favorite-migration-'))
    roots.push(userDataPath)
    const batch = createOldFavoriteBatch({
      accountMid: '42', kind: 'full', aids: [1], now: '2026-07-17T00:00:00Z'
    })
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

  it('persists only lightweight recovery metadata instead of preview snapshots', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'bilimi-old-favorite-persistence-'))
    roots.push(userDataPath)
    const legacyStore = { get: vi.fn(() => null), set: vi.fn() }
    const persistence = await createOldFavoritePersistence({ userDataPath, legacyStore })

    persistence.sessionStore.save({
      version: 1,
      lease: null,
      batches: [{
        id: 'batch-1', accountMid: '42', kind: 'full', createdAt: '2026-07-17T10:00:00.000Z', status: 'active',
        segments: [{
          id: 'batch-1:segment:1', index: 0, aids: [1], status: 'paused',
          checkpoint: { cursor: 1 }, task: { kind: 'execute', status: 'paused', requestState: 'idle' }
        }],
        snapshot: {
          currentStep: 'execution', statistics: { scanned: 30_000 },
          preview: { items: Array.from({ length: 30_000 }, (_, index) => ({ aid: index + 1 })) },
          baseScanPreview: { items: [{ aid: 1 }] },
          archiveEditorState: { archivePlanState: { items: [{ aid: 1 }] } },
          segmentSnapshots: { 0: { preview: { items: [{ aid: 1 }] } } }
        }
      }]
    })
    await persistence.flush()

    const persisted = JSON.parse(await readFile(
      join(userDataPath, 'old-favorite', 'v2', 'batches', 'batch-1.json'), 'utf8'
    ))
    expect(persisted.snapshot).toEqual({ currentStep: 'execution', statistics: { scanned: 30_000 } })
    expect(JSON.stringify(persisted)).not.toContain('baseScanPreview')
    expect(JSON.stringify(persisted).length).toBeLessThan(2_000)
  })
})
