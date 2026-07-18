import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
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

    const index = JSON.parse(await readFile(join(userDataPath, 'old-favorite', 'v2', 'index.json'), 'utf8'))
    const persisted = JSON.parse(await readFile(
      join(userDataPath, 'old-favorite', 'v2', 'batches', `${index.batches[0].storageKey}.json`), 'utf8'
    ))
    expect(persisted.snapshot).toEqual({ currentStep: 'execution', statistics: { scanned: 30_000 } })
    expect(JSON.stringify(persisted)).not.toContain('baseScanPreview')
    expect(JSON.stringify(persisted).length).toBeLessThan(2_000)
  })

  it('persists colon-containing session ids through a Windows-safe storage key and reopens them', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'bilimi-old-favorite-safe-session-'))
    roots.push(userDataPath)
    const legacyStore = { get: vi.fn(() => null), set: vi.fn() }
    const batch = createOldFavoriteBatch({
      accountMid: '42', kind: 'full', aids: [1], now: '2026-07-17T14:13:13.966Z'
    })
    const persistence = await createOldFavoritePersistence({ userDataPath, legacyStore })

    persistence.sessionStore.save({ version: 1, lease: null, batches: [batch] })
    await persistence.flush()

    const directory = join(userDataPath, 'old-favorite', 'v2')
    const files = await readdir(join(directory, 'batches'))
    expect(files).toHaveLength(1)
    expect(files[0]).not.toContain(':')
    const index = JSON.parse(await readFile(join(directory, 'index.json'), 'utf8'))
    expect(index.batches[0]).toMatchObject({ id: batch.id })
    expect(`${index.batches[0].storageKey}.json`).toBe(files[0])

    const reopened = await createOldFavoritePersistence({ userDataPath, legacyStore })
    expect(reopened.sessionStore.load().batches[0].id).toBe(batch.id)
  })

  it('continues saving after one persistence write fails', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'bilimi-old-favorite-write-recovery-'))
    roots.push(userDataPath)
    const legacyStore = { get: vi.fn(() => null), set: vi.fn() }
    const persistence = await createOldFavoritePersistence({ userDataPath, legacyStore })
    const batchesDirectory = join(userDataPath, 'old-favorite', 'v2', 'batches')
    await mkdir(join(userDataPath, 'old-favorite', 'v2'), { recursive: true })
    await writeFile(batchesDirectory, 'blocks directory creation', 'utf8')
    const first = createOldFavoriteBatch({
      accountMid: '42', kind: 'full', aids: [1], now: '2026-07-17T14:13:13.966Z'
    })

    persistence.sessionStore.save({ version: 1, lease: null, batches: [first] })
    await expect(persistence.flush()).rejects.toThrow()
    await rm(batchesDirectory, { force: true })

    const second = createOldFavoriteBatch({
      accountMid: '42', kind: 'incremental', aids: [2], now: '2026-07-17T14:14:13.966Z'
    })
    persistence.sessionStore.save({ version: 1, lease: null, batches: [second] })
    await expect(persistence.flush()).resolves.toBeUndefined()

    const reopened = await createOldFavoritePersistence({ userDataPath, legacyStore })
    expect(reopened.sessionStore.load().batches.map((batch) => batch.id)).toContain(second.id)
  })

  it('persists reset tombstones outside batch payloads across a reopen', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'bilimi-old-favorite-reset-tombstone-'))
    roots.push(userDataPath)
    const legacyStore = { get: vi.fn(() => null), set: vi.fn() }
    const first = await createOldFavoritePersistence({ userDataPath, legacyStore })
    const batch = createOldFavoriteBatch({
      accountMid: '42', kind: 'full', aids: [1], now: '2026-07-17T15:00:00.000Z'
    })
    first.sessionStore.save({ version: 1, lease: null, batches: [batch] })
    await first.flush()
    const stale = first.sessionStore.load()

    first.sessionStore.resetAccount('42')
    await first.flush()
    const reopened = await createOldFavoritePersistence({ userDataPath, legacyStore })
    reopened.sessionStore.save(stale)
    await reopened.flush()

    expect(reopened.sessionStore.load().batches).toEqual([])
    const index = JSON.parse(await readFile(join(userDataPath, 'old-favorite', 'v2', 'index.json'), 'utf8'))
    expect(index.retiredBatchIds).toEqual([batch.id])
  })

  it('keeps a discarded empty incremental batch retired after restart', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'bilimi-old-favorite-discard-tombstone-'))
    roots.push(userDataPath)
    const legacyStore = { get: vi.fn(() => null), set: vi.fn() }
    const first = await createOldFavoritePersistence({ userDataPath, legacyStore })
    const started = first.sessionStore.beginIncrementalScan(
      '42', '2026-07-16T10:00:00Z', undefined, 7
    )
    const stale = first.sessionStore.load()

    first.sessionStore.discardEmptyIncrementalBatch(started.batch.id, '42', 7)
    await first.flush()
    const reopened = await createOldFavoritePersistence({ userDataPath, legacyStore })
    reopened.sessionStore.save(stale)
    await reopened.flush()

    expect(reopened.sessionStore.load().batches).toEqual([])
    const index = JSON.parse(await readFile(join(userDataPath, 'old-favorite', 'v2', 'index.json'), 'utf8'))
    expect(index.retiredBatchIds).toContain(started.batch.id)
  })
})
