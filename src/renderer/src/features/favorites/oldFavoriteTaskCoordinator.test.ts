import { describe, expect, it, vi } from 'vitest'
import { createOldFavoriteBatch, type OldFavoriteSessionsState } from '../../../../shared/oldFavoriteSessions'
import { OldFavoriteTaskCoordinator } from './oldFavoriteTaskCoordinator'
import { compactOldFavoriteSessionsForIpc } from './oldFavoriteTaskCoordinator'

function createState(): OldFavoriteSessionsState {
  const first = createOldFavoriteBatch({ accountMid: '42', kind: 'full', aids: [1], now: '2026-07-16T08:00:00Z' })
  const second = createOldFavoriteBatch({ accountMid: '42', kind: 'incremental', aids: [2], now: '2026-07-16T09:00:00Z' })
  return { version: 1, batches: [first, second], lease: null }
}

describe('OldFavoriteTaskCoordinator', () => {
  it('removes large workspace-owned snapshots before renderer-to-main IPC', () => {
    const preview = { items: Array.from({ length: 30_000 }, (_, index) => ({ aid: index + 1 })) }
    const compact = compactOldFavoriteSessionsForIpc({
      version: 1,
      lease: null,
      batches: [{
        id: 'batch', accountMid: '42', kind: 'full', createdAt: '2026-07-17T00:00:00Z',
        status: 'active', segments: [],
        snapshot: { preview, baseScanPreview: preview, currentStep: 'preview', statistics: { scanned: 30_000 } }
      }]
    })

    expect(compact.batches[0].snapshot).toEqual({
      currentStep: 'preview', statistics: { scanned: 30_000 }
    })
    expect(JSON.stringify(compact).length).toBeLessThan(1_000)
  })
  it('uses the production desktop session API by default', async () => {
    const state = createState()
    const load = vi.fn(async () => state)
    const save = vi.fn(async (next: OldFavoriteSessionsState) => next)
    const claimLease = vi.fn(async () => true)
    const releaseLease = vi.fn(async () => true)
    const subscribe = vi.fn(() => () => undefined)
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        loadOldFavoriteSessions: load,
        saveOldFavoriteSessions: save,
        claimOldFavoriteTaskLease: claimLease,
        releaseOldFavoriteTaskLease: releaseLease,
        onOldFavoriteSessionsChanged: subscribe
      }
    })
    const coordinator = new OldFavoriteTaskCoordinator()
    const batch = state.batches[0]

    await expect(coordinator.load()).resolves.toEqual(state)
    await coordinator.save(state)
    await coordinator.acquire(batch.id, batch.segments[0].id, 'scan', '42')
    await coordinator.release(batch.id, batch.segments[0].id)
    coordinator.subscribe(() => undefined)

    expect(load).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledWith(state)
    expect(claimLease).toHaveBeenCalledWith(batch.id, batch.segments[0].id, 'scan', '42')
    expect(releaseLease).toHaveBeenCalledWith(batch.id, batch.segments[0].id)
    expect(subscribe).toHaveBeenCalledOnce()
  })

  it('exposes a writable-batch adapter that rejects ended history', async () => {
    const state = createState()
    const ended = { ...structuredClone(state.batches[0]), status: 'ended' as const }
    const load = vi.fn(async () => ({ ...state, batches: [ended, state.batches[1]] }))
    const coordinator = new OldFavoriteTaskCoordinator({
      load,
      save: async (next) => next,
      claimLease: async () => false,
      releaseLease: async () => false,
      subscribe: () => () => undefined
    })

    await expect(coordinator.loadWritableBatch(ended.id)).rejects.toThrow(
      '旧藏整理批次已结束，不能继续写入。'
    )
    expect(load).toHaveBeenCalledOnce()
  })

  it('delegates lease claims to the main-process gateway', async () => {
    let state = createState()
    const coordinator = new OldFavoriteTaskCoordinator({
      load: async () => state,
      save: async (next) => (state = next),
      claimLease: async (batchId, segmentId, task, accountMid) => {
        if (state.lease || accountMid !== '42') return false
        state = { ...state, lease: { batchId, segmentId, task } }
        return true
      },
      releaseLease: async () => false,
      subscribe: () => () => undefined
    })
    const [first, second] = state.batches

    await expect(coordinator.acquire(first.id, first.segments[0].id, 'scan', '42')).resolves.toBe(true)
    await expect(coordinator.acquire(second.id, second.segments[0].id, 'deepseek', '42')).resolves.toBe(false)
    expect(state.lease).toMatchObject({ batchId: first.id, task: 'scan' })
  })

  it('loads, saves, subscribes, and releases through the desktop gateway', async () => {
    let state = createState()
    let listener: ((next: OldFavoriteSessionsState) => void) | undefined
    const coordinator = new OldFavoriteTaskCoordinator({
      load: async () => structuredClone(state),
      save: async (next) => (state = structuredClone(next)),
      claimLease: async () => false,
      releaseLease: async (batchId, segmentId) => {
        const matches = state.lease?.batchId === batchId && state.lease.segmentId === segmentId
        if (matches) state = { ...state, lease: null }
        return matches
      },
      subscribe: (callback) => {
        listener = callback
        return () => (listener = undefined)
      }
    })
    const batch = state.batches[0]
    state.lease = { batchId: batch.id, segmentId: batch.segments[0].id, task: 'execute' }

    await expect(coordinator.load()).resolves.toEqual(state)
    const saved = { ...state, batches: state.batches.slice(0, 1) }
    await coordinator.save(saved)
    expect(state.batches).toHaveLength(1)
    await expect(coordinator.release(batch.id, batch.segments[0].id)).resolves.toBe(true)
    const observed: OldFavoriteSessionsState[] = []
    const unsubscribe = coordinator.subscribe((next) => observed.push(next))
    listener?.(saved)
    unsubscribe()
    expect(observed).toEqual([saved])
  })
})
