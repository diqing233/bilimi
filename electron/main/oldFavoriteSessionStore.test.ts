import { describe, expect, it, vi } from 'vitest'
import { createOldFavoriteBatch, type OldFavoriteBatch, type OldFavoriteSessionsState } from '../../src/shared/oldFavoriteSessions'
import { OldFavoriteSessionStore, type OldFavoriteSessionStoreBackend } from './oldFavoriteSessionStore'

class MemoryBackend implements OldFavoriteSessionStoreBackend {
  value: unknown
  retiredBatchIds: string[] = []
  flush = vi.fn().mockResolvedValue(undefined)

  get(_key: string): unknown {
    return this.value
  }

  set(_key: string, value: unknown): void {
    this.value = structuredClone(value)
  }

  getRetiredBatchIds(): readonly string[] {
    return this.retiredBatchIds
  }

  setRetiredBatchIds(ids: readonly string[]): void {
    this.retiredBatchIds = [...ids]
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

  it('ends a batch once and ignores stale saves and releases after the terminal transition', () => {
    const backend = new MemoryBackend()
    const store = new OldFavoriteSessionStore(backend)
    const batch = createOldFavoriteBatch({ accountMid: '42', kind: 'full', aids: [1, 2], now: '2026-07-16T08:00:00Z' })
    store.save({ version: 1, batches: [batch], lease: null })
    const stale = store.load()

    const lifecycleStore = store as OldFavoriteSessionStore & {
      endBatch?: (batchId: string, endedAt: string) => OldFavoriteBatch
    }
    expect(lifecycleStore.endBatch).toBeTypeOf('function')
    if (!lifecycleStore.endBatch) return

    const ended = lifecycleStore.endBatch(batch.id, '2026-07-16T10:00:00Z')
    expect(ended).toMatchObject({ id: batch.id, status: 'ended', endedAt: '2026-07-16T10:00:00Z' })
    expect(lifecycleStore.endBatch(batch.id, '2026-07-16T11:00:00Z')).toEqual(ended)

    stale.batches[0].snapshot = { currentStep: 'scan' }
    stale.batches[0].segments[0].status = 'running'
    store.save(stale)

    expect(store.load().batches[0]).toEqual(ended)
    expect(store.releaseLease(batch.id, batch.segments[0].id, 7)).toBe(false)
  })

  it('does not let a stale full-scan start create a second active batch after an ended batch', () => {
    const backend = new MemoryBackend()
    const store = new OldFavoriteSessionStore(backend)
    const previous = createOldFavoriteBatch({ accountMid: '42', kind: 'full', aids: [1], now: '2026-07-16T08:00:00Z' })
    previous.status = 'ended'
    previous.endedAt = '2026-07-16T09:00:00Z'
    previous.segments[0].status = 'ended'
    store.save({ version: 1, batches: [previous], lease: null })

    const first = store.beginFullScan('42', '2026-07-16T10:00:00Z', undefined, 7)
    const second = store.beginFullScan('42', '2026-07-16T10:00:01Z', undefined, 8)

    expect(first.acquired).toBe(true)
    expect(second).toEqual({ batch: expect.objectContaining({ id: first.batch.id }), acquired: false })
    expect(store.load().batches.filter((candidate) => candidate.accountMid === '42' && candidate.kind === 'full' && candidate.status === 'active')).toHaveLength(1)
  })

  it('does not let a renderer snapshot recreate an account batch after reset', () => {
    const backend = new MemoryBackend()
    const store = new OldFavoriteSessionStore(backend)
    const batch = createOldFavoriteBatch({ accountMid: '42', kind: 'full', aids: [1], now: '2026-07-16T08:00:00Z' })
    store.save({ version: 1, batches: [batch], lease: null })
    const stale = store.load()

    store.resetAccount('42')
    stale.batches[0].snapshot = { currentStep: 'preview' }
    store.save(stale)

    expect(store.load().batches).toEqual([])
  })

  it('ends an empty legacy full placeholder before creating the next full batch', () => {
    const backend = new MemoryBackend()
    const store = new OldFavoriteSessionStore(backend)
    const placeholder = createOldFavoriteBatch({ accountMid: '42', kind: 'full', aids: [], now: '2026-07-16T08:00:00Z' })
    placeholder.segments = [{
      id: `${placeholder.id}:segment:1`, index: 0, aids: [], status: 'paused',
      task: { kind: 'scan', status: 'paused', requestState: 'idle' }
    }]
    store.save({ version: 1, batches: [placeholder], lease: null })

    const result = store.beginFullScan('42', '2026-07-16T09:00:00Z', undefined, 7)

    expect(result.acquired).toBe(true)
    expect(store.load().batches).toEqual([
      expect.objectContaining({ id: placeholder.id, status: 'ended', endedAt: '2026-07-16T09:00:00Z' }),
      expect.objectContaining({ id: result.batch.id, status: 'active' })
    ])
  })

  it('restores the previous session state when ending a batch cannot flush', async () => {
    const backend = new MemoryBackend()
    const store = new OldFavoriteSessionStore(backend)
    const batch = createOldFavoriteBatch({ accountMid: '42', kind: 'full', aids: [1], now: '2026-07-16T08:00:00Z' })
    store.save({ version: 1, batches: [batch], lease: null })
    backend.flush.mockRejectedValueOnce(new Error('disk full'))
    const previous = store.load()

    const ipcMain = new (class {
      handlers = new Map<string, (event: { sender: { id: number } }, ...args: never[]) => unknown>()
      handle(channel: string, handler: (event: { sender: { id: number } }, ...args: never[]) => unknown) { this.handlers.set(channel, handler) }
      invoke(channel: string, ...args: unknown[]) { return this.handlers.get(channel)?.({ sender: { id: 7 } }, ...args as never[]) }
    })()
    const { registerOldFavoriteSessionIpc } = await import('./oldFavoriteSessionIpc')
    registerOldFavoriteSessionIpc({ ipcMain, store, isTrustedSender: () => true, broadcast: () => undefined })

    await expect(ipcMain.invoke('old-favorite-sessions:end-batch', batch.id, '2026-07-16T09:00:00Z')).rejects.toThrow('disk full')
    expect(store.load()).toEqual(previous)
  })

  it('keeps shutdown normalization from reviving an already ended batch', () => {
    const backend = new MemoryBackend()
    const store = new OldFavoriteSessionStore(backend)
    const ended = createOldFavoriteBatch({ accountMid: '42', kind: 'full', aids: [1], now: '2026-07-16T08:00:00Z' })
    ended.status = 'ended'
    ended.endedAt = '2026-07-16T09:00:00Z'
    ended.segments[0].status = 'ended'
    store.save({ version: 1, batches: [ended], lease: null })
    const stale = structuredClone(ended)
    stale.status = 'active'
    stale.endedAt = undefined
    stale.segments[0].status = 'running'

    store.saveForShutdown({ version: 1, batches: [stale], lease: null })

    expect(store.load().batches[0]).toEqual(ended)
  })

  it('clears the lease when saving a lightweight shutdown snapshot', () => {
    const backend = new MemoryBackend()
    const store = new OldFavoriteSessionStore(backend)
    const batch = createOldFavoriteBatch({ accountMid: '42', kind: 'full', aids: [1], now: '2026-07-16T08:00:00Z' })
    store.save({ version: 1, batches: [batch], lease: {
      batchId: batch.id, segmentId: batch.segments[0].id, task: 'scan', ownerId: 7
    } })

    store.saveForShutdown(store.load())

    expect(store.load().lease).toBeNull()
  })

  it('can begin a new full batch after reset even when its generated timestamp id repeats', () => {
    const backend = new MemoryBackend()
    const store = new OldFavoriteSessionStore(backend)
    const first = store.beginFullScan('42', '2026-07-16T08:00:00Z', undefined, 7)
    store.resetAccount('42')

    const second = store.beginFullScan('42', '2026-07-16T08:00:00Z', undefined, 8)

    expect(second.acquired).toBe(true)
    expect(store.load().batches).toEqual([expect.objectContaining({ id: second.batch.id, status: 'active' })])
    expect(second.batch.id).not.toBe(first.batch.id)
  })

  it('does not let a stale snapshot resurrect a reset batch after the store is reopened', () => {
    const backend = new MemoryBackend()
    const firstStore = new OldFavoriteSessionStore(backend)
    const batch = createOldFavoriteBatch({ accountMid: '42', kind: 'full', aids: [1], now: '2026-07-16T08:00:00Z' })
    firstStore.save({ version: 1, batches: [batch], lease: null })
    const stale = firstStore.load()

    firstStore.resetAccount('42')
    new OldFavoriteSessionStore(backend).save(stale)

    expect(new OldFavoriteSessionStore(backend).load().batches).toEqual([])
  })

  it('repairs every segment when an ended batch is loaded from legacy storage', () => {
    const backend = new MemoryBackend()
    const store = new OldFavoriteSessionStore(backend)
    const ended = createOldFavoriteBatch({ accountMid: '42', kind: 'full', aids: [1, 2], now: '2026-07-16T08:00:00Z' })
    ended.status = 'ended'
    ended.endedAt = '2026-07-16T09:00:00Z'
    ended.segments[0].status = 'running'
    ended.segments[0].task = { kind: 'scan', status: 'running', requestState: 'in-flight' }
    backend.value = { version: 1, batches: [ended], lease: {
      batchId: ended.id, segmentId: ended.segments[0].id, task: 'scan', ownerId: 7
    } }

    const loaded = store.load()

    expect(loaded.batches[0].segments).toEqual([
      expect.objectContaining({ status: 'ended', task: undefined })
    ])
    expect(loaded.lease).toBeNull()
  })

  it('atomically begins one incremental scan and rejects a duplicate placeholder', () => {
    const backend = new MemoryBackend()
    const store = new OldFavoriteSessionStore(backend)
    const lifecycleStore = store as OldFavoriteSessionStore & {
      beginIncrementalScan?: (
        accountMid: string,
        now: string,
        snapshot: OldFavoriteBatch['snapshot'] | undefined,
        ownerId: number
      ) => { batch: OldFavoriteBatch; acquired: boolean }
    }
    expect(lifecycleStore.beginIncrementalScan).toBeTypeOf('function')
    if (!lifecycleStore.beginIncrementalScan) return

    const first = lifecycleStore.beginIncrementalScan('42', '2026-07-16T10:00:00Z', { currentStep: 'scan' }, 7)
    const second = lifecycleStore.beginIncrementalScan('42', '2026-07-16T10:00:01Z', { currentStep: 'scan' }, 8)

    expect(first.acquired).toBe(true)
    expect(second).toEqual({ batch: expect.objectContaining({ id: first.batch.id }), acquired: false })
    expect(store.load().batches.filter((batch) => batch.accountMid === '42' && batch.kind === 'incremental' && batch.status === 'active')).toHaveLength(1)
  })

})
