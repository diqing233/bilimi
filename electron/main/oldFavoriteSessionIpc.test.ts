import { describe, expect, it, vi } from 'vitest'
import { createOldFavoriteBatch, type OldFavoriteSessionsState } from '../../src/shared/oldFavoriteSessions'
import { registerOldFavoriteSessionIpc, type OldFavoriteSessionIpcMain } from './oldFavoriteSessionIpc'
import { OldFavoriteSessionStore, type OldFavoriteSessionStoreBackend } from './oldFavoriteSessionStore'

class MemoryBackend implements OldFavoriteSessionStoreBackend {
  value: unknown
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
  it('allows trusted renderers to load and save and broadcasts saved state', () => {
    const ipcMain = new FakeIpcMain()
    const store = new OldFavoriteSessionStore(new MemoryBackend())
    const broadcast = vi.fn()
    registerOldFavoriteSessionIpc({ ipcMain, store, isTrustedSender: (id) => id === 7, broadcast })
    const state = createState()

    expect(ipcMain.invoke('old-favorite-sessions:save', 7, state)).toEqual(state)
    expect(ipcMain.invoke('old-favorite-sessions:load', 7)).toEqual(state)
    expect(broadcast).toHaveBeenCalledWith(state)
  })

  it('rejects untrusted senders without reading or mutating storage', () => {
    const ipcMain = new FakeIpcMain()
    const store = new OldFavoriteSessionStore(new MemoryBackend())
    registerOldFavoriteSessionIpc({ ipcMain, store, isTrustedSender: (id) => id === 7, broadcast: vi.fn() })

    expect(() => ipcMain.invoke('old-favorite-sessions:load', 99)).toThrow('untrusted renderer')
    expect(() => ipcMain.invoke('old-favorite-sessions:save', 99, createState())).toThrow('untrusted renderer')
    expect(store.load().batches).toEqual([])
  })

  it('atomically claims and owner-releases the global lease and broadcasts each change', () => {
    const ipcMain = new FakeIpcMain()
    const store = new OldFavoriteSessionStore(new MemoryBackend())
    const state = createState()
    store.save(state)
    const broadcast = vi.fn()
    registerOldFavoriteSessionIpc({ ipcMain, store, isTrustedSender: (id) => [7, 8].includes(id), broadcast })
    const batch = state.batches[0]
    const args = [batch.id, batch.segments[0].id, 'scan', '42']

    expect(ipcMain.invoke('old-favorite-sessions:claim-lease', 7, ...args)).toBe(true)
    expect(ipcMain.invoke('old-favorite-sessions:claim-lease', 8, ...args)).toBe(false)
    expect(ipcMain.invoke('old-favorite-sessions:release-lease', 8, batch.id, batch.segments[0].id)).toBe(false)
    expect(ipcMain.invoke('old-favorite-sessions:release-lease', 7, batch.id, batch.segments[0].id)).toBe(true)
    expect(broadcast).toHaveBeenCalledTimes(2)
  })
})
