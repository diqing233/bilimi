import { describe, expect, it } from 'vitest'
import { createOldFavoriteBatch, type OldFavoriteSessionsState } from '../../src/shared/oldFavoriteSessions'
import { OldFavoriteSessionStore, type OldFavoriteSessionStoreBackend } from './oldFavoriteSessionStore'

class MemoryBackend implements OldFavoriteSessionStoreBackend {
  value: unknown

  get(_key: string): unknown {
    return this.value
  }

  set(_key: string, value: unknown): void {
    this.value = structuredClone(value)
  }
}

describe('OldFavoriteSessionStore', () => {
  it('persists versioned multi-account batches through an injectable backend', () => {
    const backend = new MemoryBackend()
    const store = new OldFavoriteSessionStore(backend)
    const state: OldFavoriteSessionsState = {
      version: 1,
      batches: [
        createOldFavoriteBatch({ accountMid: '42', kind: 'full', aids: [1], now: '2026-07-16T08:00:00Z' }),
        createOldFavoriteBatch({ accountMid: '99', kind: 'incremental', aids: [2], now: '2026-07-16T09:00:00Z' })
      ],
      lease: null
    }

    store.save(state)

    expect(new OldFavoriteSessionStore(backend).load().batches.map((batch) => batch.accountMid)).toEqual([
      '42',
      '99'
    ])
  })

  it('migrates missing or legacy storage to the current empty state', () => {
    const backend = new MemoryBackend()
    backend.value = { version: 0, batches: 'invalid' }

    expect(new OldFavoriteSessionStore(backend).load()).toEqual({ version: 1, batches: [], lease: null })
  })

  it('rejects malformed current-version batches instead of trusting a shallow version match', () => {
    const backend = new MemoryBackend()
    backend.value = { version: 1, batches: [{ id: 'broken' }], lease: null }

    expect(new OldFavoriteSessionStore(backend).load()).toEqual({ version: 1, batches: [], lease: null })
  })

  it('normalizes running work before saving on application shutdown', () => {
    const backend = new MemoryBackend()
    const store = new OldFavoriteSessionStore(backend)
    const batch = createOldFavoriteBatch({ accountMid: '42', kind: 'full', aids: [1], now: '2026-07-16T08:00:00Z' })
    batch.segments[0].status = 'running'
    batch.segments[0].task = { kind: 'scan', status: 'running', requestState: 'idle' }

    store.saveForShutdown({ version: 1, batches: [batch], lease: null })

    expect(store.load().batches[0].segments[0]).toMatchObject({
      status: 'paused',
      task: { status: 'paused' }
    })
  })

  it('claims one lease atomically and only lets the owning window release it', () => {
    const backend = new MemoryBackend()
    const store = new OldFavoriteSessionStore(backend)
    const batch = createOldFavoriteBatch({ accountMid: '42', kind: 'full', aids: [1], now: '2026-07-16T08:00:00Z' })
    store.save({ version: 1, batches: [batch], lease: null })

    expect(store.claimLease(batch.id, batch.segments[0].id, 'scan', '42', 101)).toBe(true)
    expect(store.claimLease(batch.id, batch.segments[0].id, 'tag', '42', 202)).toBe(false)
    expect(store.releaseLease(batch.id, batch.segments[0].id, 202)).toBe(false)
    expect(store.releaseLease(batch.id, batch.segments[0].id, 101)).toBe(true)
  })

  it('does not let a stale renderer save overwrite the main-process lease', () => {
    const backend = new MemoryBackend()
    const store = new OldFavoriteSessionStore(backend)
    const batch = createOldFavoriteBatch({ accountMid: '42', kind: 'full', aids: [1], now: '2026-07-16T08:00:00Z' })
    const stale = { version: 1 as const, batches: [batch], lease: null }
    store.save(stale)
    store.claimLease(batch.id, batch.segments[0].id, 'execute', '42', 101)

    store.save(stale)

    expect(store.load().lease).toMatchObject({ task: 'execute', ownerId: 101 })
  })

  it('merges stale renderer saves by batch id instead of deleting concurrently created batches', () => {
    const backend = new MemoryBackend()
    const store = new OldFavoriteSessionStore(backend)
    const first = createOldFavoriteBatch({ accountMid: '42', kind: 'full', aids: [1], now: '2026-07-16T08:00:00Z' })
    store.save({ version: 1, batches: [first], lease: null })
    const stale = store.load()
    const second = createOldFavoriteBatch({ accountMid: '99', kind: 'incremental', aids: [2], now: '2026-07-16T09:00:00Z' })
    store.save({ version: 1, batches: [first, second], lease: null })

    stale.batches[0].snapshot = { currentStep: 'preview' }
    store.save(stale)

    expect(store.load().batches).toEqual([
      expect.objectContaining({ id: first.id, snapshot: { currentStep: 'preview' } }),
      expect.objectContaining({ id: second.id })
    ])
  })

  it('rejects lease claims for the wrong account, ended batch, or missing segment', () => {
    const backend = new MemoryBackend()
    const store = new OldFavoriteSessionStore(backend)
    const batch = createOldFavoriteBatch({ accountMid: '42', kind: 'full', aids: [1], now: '2026-07-16T08:00:00Z' })
    store.save({ version: 1, batches: [batch], lease: null })

    expect(store.claimLease(batch.id, batch.segments[0].id, 'scan', '99', 101)).toBe(false)
    expect(store.claimLease(batch.id, 'missing', 'scan', '42', 101)).toBe(false)
    batch.status = 'ended'
    store.save({ version: 1, batches: [batch], lease: null })
    expect(store.claimLease(batch.id, batch.segments[0].id, 'scan', '42', 101)).toBe(false)
  })

  it('resets every active and ended batch for one account without changing other accounts', () => {
    const backend = new MemoryBackend()
    const store = new OldFavoriteSessionStore(backend)
    const active = createOldFavoriteBatch({ accountMid: '42', kind: 'full', aids: [1], now: '2026-07-16T08:00:00Z' })
    const ended = createOldFavoriteBatch({ accountMid: '42', kind: 'incremental', aids: [2], now: '2026-07-16T09:00:00Z' })
    ended.status = 'ended'
    const other = createOldFavoriteBatch({ accountMid: '99', kind: 'full', aids: [3], now: '2026-07-16T10:00:00Z' })
    store.save({ version: 1, batches: [active, ended, other], lease: {
      batchId: active.id, segmentId: active.segments[0].id, task: 'scan', ownerId: 7
    } })

    store.resetAccount('42')

    expect(store.load().batches).toEqual([other])
    expect(store.load().lease).toBeNull()
  })
})
