import { describe, expect, it, vi } from 'vitest'
import { createOldFavoriteBatch, type OldFavoriteSessionsState } from '../../src/shared/oldFavoriteSessions'
import { registerOldFavoriteSessionIpc, type OldFavoriteSessionIpcMain } from './oldFavoriteSessionIpc'
import { OldFavoriteSessionStore, type OldFavoriteSessionStoreBackend } from './oldFavoriteSessionStore'

class MemoryBackend implements OldFavoriteSessionStoreBackend {
  value: unknown
  flush = vi.fn().mockResolvedValue(undefined)
  get(): unknown { return this.value }
  set(_key: string, value: unknown): void { this.value = structuredClone(value) }
}

class FakeIpcMain implements OldFavoriteSessionIpcMain {
  handlers = new Map<string, (event: { sender: { id: number } }, ...args: never[]) => unknown>()
  handle(channel: string, handler: (event: { sender: { id: number } }, ...args: never[]) => unknown): void {
    this.handlers.set(channel, handler)
  }
  invoke(channel: string, senderId: number, ...args: unknown[]): unknown {
    return this.handlers.get(channel)?.({ sender: { id: senderId } }, ...args as never[])
  }
}

function createState(): OldFavoriteSessionsState {
  return {
    version: 1,
    batches: [createOldFavoriteBatch({ accountMid: '42', kind: 'full', aids: [1], now: '2026-07-16T08:00:00Z' })],
    lease: null
  }
}

describe('registerOldFavoriteSessionIpc', () => {
  it('allows trusted renderers to load and save durably before broadcasting saved state', async () => {
    const ipcMain = new FakeIpcMain()
    const store = new OldFavoriteSessionStore(new MemoryBackend())
    const broadcast = vi.fn()
    registerOldFavoriteSessionIpc({ ipcMain, store, isTrustedSender: (id) => id === 7, broadcast })
    const state = createState()

    await expect(ipcMain.invoke('old-favorite-sessions:save', 7, state)).resolves.toEqual(state)
    expect(ipcMain.invoke('old-favorite-sessions:load', 7)).toEqual(state)
    expect((store as unknown as { flush: () => Promise<void> }).flush).toBeDefined()
    expect(broadcast).toHaveBeenCalledWith(state)
  })

  it('rejects untrusted senders without reading or mutating storage', async () => {
    const ipcMain = new FakeIpcMain()
    const store = new OldFavoriteSessionStore(new MemoryBackend())
    registerOldFavoriteSessionIpc({ ipcMain, store, isTrustedSender: (id) => id === 7, broadcast: vi.fn() })

    expect(() => ipcMain.invoke('old-favorite-sessions:load', 99)).toThrow('untrusted renderer')
    await expect(ipcMain.invoke('old-favorite-sessions:save', 99, createState())).rejects.toThrow('untrusted renderer')
    expect(store.load().batches).toEqual([])
  })

  it('atomically claims and owner-releases the global lease and broadcasts each change', async () => {
    const ipcMain = new FakeIpcMain()
    const store = new OldFavoriteSessionStore(new MemoryBackend())
    const state = createState()
    store.save(state)
    const broadcast = vi.fn()
    registerOldFavoriteSessionIpc({ ipcMain, store, isTrustedSender: (id) => [7, 8].includes(id), broadcast })
    const batch = state.batches[0]
    const args = [batch.id, batch.segments[0].id, 'scan', '42']

    await expect(ipcMain.invoke('old-favorite-sessions:claim-lease', 7, ...args)).resolves.toBe(true)
    await expect(ipcMain.invoke('old-favorite-sessions:claim-lease', 8, ...args)).resolves.toBe(false)
    await expect(ipcMain.invoke('old-favorite-sessions:release-lease', 8, batch.id, batch.segments[0].id)).resolves.toBe(false)
    await expect(ipcMain.invoke('old-favorite-sessions:release-lease', 7, batch.id, batch.segments[0].id)).resolves.toBe(true)
    expect(broadcast).toHaveBeenCalledTimes(2)
  })

  it('resets all active and ended sessions for one account', async () => {
    const ipcMain = new FakeIpcMain()
    const store = new OldFavoriteSessionStore(new MemoryBackend())
    const state = createState()
    const ended = createOldFavoriteBatch({ accountMid: '42', kind: 'incremental', aids: [2], now: '2026-07-16T09:00:00Z' })
    ended.status = 'ended'
    const other = createOldFavoriteBatch({ accountMid: '99', kind: 'full', aids: [3], now: '2026-07-16T10:00:00Z' })
    store.save({ ...state, batches: [...state.batches, ended, other] })
    const broadcast = vi.fn()
    registerOldFavoriteSessionIpc({ ipcMain, store, isTrustedSender: (id) => id === 7, broadcast })

    const result = await ipcMain.invoke('old-favorite-sessions:reset-account', 7, '42') as OldFavoriteSessionsState

    expect(result.batches).toEqual([other])
    expect(broadcast).toHaveBeenLastCalledWith(result)
  })

  it('keeps the pre-reset session state when reset persistence fails', async () => {
    const ipcMain = new FakeIpcMain()
    const backend = new MemoryBackend()
    const store = new OldFavoriteSessionStore(backend)
    const state = createState()
    const other = createOldFavoriteBatch({ accountMid: '99', kind: 'full', aids: [3], now: '2026-07-16T10:00:00Z' })
    store.save({ ...state, batches: [...state.batches, other] })
    backend.flush.mockRejectedValueOnce(new Error('disk full'))
    registerOldFavoriteSessionIpc({ ipcMain, store, isTrustedSender: () => true, broadcast: vi.fn() })

    await expect(ipcMain.invoke('old-favorite-sessions:reset-account', 7, '42')).rejects.toThrow('disk full')
    expect(store.load()).toEqual({ ...state, batches: [...state.batches, other] })
  })

  it('atomically creates only one active full scan across renderer senders', async () => {
    const ipcMain = new FakeIpcMain()
    const store = new OldFavoriteSessionStore(new MemoryBackend())
    registerOldFavoriteSessionIpc({
      ipcMain, store, isTrustedSender: (id) => [7, 8].includes(id), broadcast: vi.fn()
    })

    const first = await ipcMain.invoke(
      'old-favorite-sessions:begin-full-scan', 7, '42', '2026-07-18T08:00:00Z', { currentStep: 'scan' }
    ) as { batch: { id: string }; acquired: boolean }
    const second = await ipcMain.invoke(
      'old-favorite-sessions:begin-full-scan', 8, '42', '2026-07-18T08:00:01Z', { currentStep: 'scan' }
    ) as { batch: { id: string }; acquired: boolean }

    expect(first.acquired).toBe(true)
    expect(second).toEqual({ batch: expect.objectContaining({ id: first.batch.id }), acquired: false })
    expect(store.load().batches.filter((batch) => batch.accountMid === '42' && batch.status === 'active')).toHaveLength(1)
  })

  it('rolls back a newly created full scan and lease when its durable flush fails', async () => {
    const ipcMain = new FakeIpcMain()
    const backend = new MemoryBackend()
    backend.flush.mockRejectedValueOnce(new Error('disk full'))
    const store = new OldFavoriteSessionStore(backend)
    registerOldFavoriteSessionIpc({
      ipcMain, store, isTrustedSender: () => true, broadcast: vi.fn()
    })

    await expect(ipcMain.invoke(
      'old-favorite-sessions:begin-full-scan', 7, '42', '2026-07-18T08:00:00Z', { currentStep: 'scan' }
    )).rejects.toThrow('disk full')

    expect(store.load()).toEqual({ version: 1, batches: [], lease: null })
    await expect(ipcMain.invoke(
      'old-favorite-sessions:begin-full-scan', 7, '42', '2026-07-18T08:00:01Z', { currentStep: 'scan' }
    )).resolves.toMatchObject({ acquired: true })
  })

  it('finishes only the mutation token returned for a successful session write', async () => {
    const ipcMain = new FakeIpcMain()
    const store = new OldFavoriteSessionStore(new MemoryBackend())
    const mutation = Symbol('session-mutation')
    const onMutation = vi.fn((dirty: boolean) => dirty ? mutation : undefined)
    registerOldFavoriteSessionIpc({
      ipcMain, store, isTrustedSender: () => true, broadcast: vi.fn(), onMutation
    })

    await ipcMain.invoke('old-favorite-sessions:save', 7, createState())

    expect(onMutation.mock.calls).toEqual([[true], [false, mutation]])
  })

  it('does not mark persistence dirty when a session save fails before mutating the store', async () => {
    const ipcMain = new FakeIpcMain()
    const store = { save: vi.fn(() => { throw new Error('invalid state') }) }
    const onMutation = vi.fn()
    registerOldFavoriteSessionIpc({
      ipcMain, store: store as never, isTrustedSender: () => true, broadcast: vi.fn(), onMutation
    })

    await expect(ipcMain.invoke('old-favorite-sessions:save', 7, createState()))
      .rejects.toThrow('invalid state')
    expect(onMutation).not.toHaveBeenCalled()
  })

  it('keeps persistence dirty when a mutated session store fails to flush', async () => {
    const ipcMain = new FakeIpcMain()
    const backend = new MemoryBackend()
    backend.flush.mockRejectedValueOnce(new Error('disk full'))
    const store = new OldFavoriteSessionStore(backend)
    const mutation = Symbol('failed-flush')
    const onMutation = vi.fn((dirty: boolean) => dirty ? mutation : undefined)
    registerOldFavoriteSessionIpc({
      ipcMain, store, isTrustedSender: () => true, broadcast: vi.fn(), onMutation
    })

    await expect(ipcMain.invoke('old-favorite-sessions:save', 7, createState()))
      .rejects.toThrow('disk full')
    expect(onMutation.mock.calls).toEqual([[true]])
  })
})
