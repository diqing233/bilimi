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
})
