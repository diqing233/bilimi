import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  compactOldFavoriteRuntimeState,
  OldFavoriteRuntimeStore,
  TransientCheckpointScheduler
} from './oldFavoriteRuntimeStore'

describe('OldFavoriteRuntimeStore', () => {
  it('drops legacy workspace-sized values while retaining lightweight recovery state', () => {
    expect(compactOldFavoriteRuntimeState({
      accounts: {
        '42': {
          preview: { revision: 1, value: { items: Array.from({ length: 10 }, (_, aid) => ({ aid })) } },
          archiveEditorState: { revision: 2, value: { huge: true } },
          scanProgress: { revision: 3, value: { basic: { completed: 25 } } },
          oldFavoriteExecutionPhase: { revision: 4, value: 'paused' }
        }
      },
      global: { deepSeekConnectionStatus: { revision: 1, value: 'connected' } }
    })).toEqual({
      accounts: {
        '42': {
          scanProgress: { revision: 3, value: { basic: { completed: 25 } }, },
          oldFavoriteExecutionPhase: { revision: 4, value: 'paused' }
        }
      },
      global: { deepSeekConnectionStatus: { revision: 1, value: 'connected' } }
    })
  })

  afterEach(() => vi.useRealTimers())

  function memoryBackend() {
    const values = new Map<string, unknown>()
    return {
      get: (key: string) => values.get(key),
      set: (key: string, value: unknown) => values.set(key, structuredClone(value))
    }
  }

  function jsonBackend() {
    let serialized = ''
    return {
      get: () => serialized ? JSON.parse(serialized) : undefined,
      set: (_key: string, value: unknown) => { serialized = JSON.stringify(value) }
    }
  }

  it('accepts the first matching revision and rejects a stale conflicting write', () => {
    const store = new OldFavoriteRuntimeStore()
    const initial = store.get('archivePlanState', null)

    const accepted = store.set('archivePlanState', { owner: 'sidebar' }, initial.revision)
    const rejected = store.set('archivePlanState', { owner: 'floating' }, initial.revision)

    expect(accepted).toMatchObject({ accepted: true, revision: 1, value: { owner: 'sidebar' } })
    expect(rejected).toMatchObject({ accepted: false, revision: 1, value: { owner: 'sidebar' } })
  })

  it('locks task state to its account and restores it when that account returns', () => {
    const store = new OldFavoriteRuntimeStore(memoryBackend())
    store.bindAccount('42')
    store.set('deepSeekArchiveRunning', true, 0)

    expect(store.bindAccount('99')).toBe(true)
    expect(store.get('deepSeekArchiveRunning', false)).toMatchObject({ revision: 0, value: false })
    store.bindAccount('42')
    expect(store.get('deepSeekArchiveRunning', false)).toMatchObject({ revision: 1, value: true })
  })

  it('detaches a logged-out window without deleting the previous account runtime', () => {
    const backend = memoryBackend()
    const store = new OldFavoriteRuntimeStore(backend)
    store.bindAccount('42')
    store.set('preview', { items: [{ aid: 1 }] }, 0)

    expect(store.bindAccount('')).toBe(true)
    expect(store.get('preview', null)).toMatchObject({ value: null, accountMid: '' })

    store.bindAccount('42')
    expect(store.get('preview', null)).toMatchObject({ value: { items: [{ aid: 1 }] }, accountMid: '42' })
  })

  it('restores an account runtime after the application store is recreated', () => {
    const backend = memoryBackend()
    const first = new OldFavoriteRuntimeStore(backend)
    first.bindAccount('42')
    first.set('archivePlanState', { currentStep: 'preview' }, 0)

    const reopened = new OldFavoriteRuntimeStore(backend)
    reopened.bindAccount('42')

    expect(reopened.get('archivePlanState', null)).toMatchObject({
      revision: 1,
      value: { currentStep: 'preview' },
      accountMid: '42'
    })
  })

  it('round-trips Set values through the JSON-backed application store', () => {
    const backend = jsonBackend()
    const first = new OldFavoriteRuntimeStore(backend)
    first.bindAccount('42')
    first.set('selectedCandidateKeys', new Set(['author:1', 'tag:game']), 0)

    const reopened = new OldFavoriteRuntimeStore(backend)
    reopened.bindAccount('42')

    expect(reopened.get('selectedCandidateKeys', new Set()).value).toEqual(
      new Set(['author:1', 'tag:game'])
    )
  })

  it('pauses active work and marks execution reconciliation before shutdown', () => {
    const backend = memoryBackend()
    const store = new OldFavoriteRuntimeStore(backend)
    store.bindAccount('42')
    store.set('oldFavoriteExecutionPhase', 'running', 0)
    store.set('deepSeekArchiveRunning', true, 0)

    store.prepareForShutdown()

    expect(store.get('oldFavoriteExecutionPhase', 'idle').value).toBe('paused')
    expect(store.get('oldFavoriteRecoveryRequiresReconciliation', false).value).toBe(true)
    expect(store.get('deepSeekArchiveRunning', true).value).toBe(false)
  })

  it('preserves global DeepSeek connection state when the signed-in account changes', () => {
    const store = new OldFavoriteRuntimeStore()
    store.bindAccount('42')
    store.set('deepSeekConnectionStatus', 'connected', 0)
    store.set('oldFavoriteRuntimeStatus', { label: '旧藏待整理 3' }, 0)

    expect(store.bindAccount('99')).toBe(true)
    expect(store.get('deepSeekConnectionStatus', 'pending')).toMatchObject({
      revision: 1,
      value: 'connected'
    })
    expect(store.get('oldFavoriteRuntimeStatus', null)).toMatchObject({ revision: 0, value: null })
  })

  it('keeps high-frequency scan progress in memory until an explicit checkpoint', () => {
    const backend = memoryBackend()
    const store = new OldFavoriteRuntimeStore(backend)
    store.bindAccount('42')
    store.set('preview', { items: Array.from({ length: 2_000 }, (_, aid) => ({ aid })) }, 0)

    store.setTransient('scanProgress', { completed: 25 }, 0)
    store.setTransient('scanProgress', { completed: 26 }, 1)
    const reopenedBeforeCheckpoint = new OldFavoriteRuntimeStore(backend)
    reopenedBeforeCheckpoint.bindAccount('42')

    expect(reopenedBeforeCheckpoint.get('scanProgress', null).value).toBeNull()
    expect(store.checkpoint(['scanProgress'])).toBe(true)
    const reopenedAfterCheckpoint = new OldFavoriteRuntimeStore(backend)
    reopenedAfterCheckpoint.bindAccount('42')
    expect(reopenedAfterCheckpoint.get('scanProgress', null).value).toEqual({ completed: 26 })
  })

  it('checkpoints continuous transient updates four seconds after the first dirty write', () => {
    vi.useFakeTimers()
    const checkpoint = vi.fn()
    const scheduler = new TransientCheckpointScheduler(checkpoint, 4_000)

    scheduler.markDirty('scanProgress')
    vi.advanceTimersByTime(1_500)
    scheduler.markDirty('scanProgress')
    vi.advanceTimersByTime(1_500)
    scheduler.markDirty('scanProgress')
    vi.advanceTimersByTime(1_000)

    expect(checkpoint).toHaveBeenCalledTimes(1)
    expect(checkpoint).toHaveBeenCalledWith(['scanProgress'])
  })

  it('keeps the last durable checkpoint when another key persists during transient progress', () => {
    const backend = memoryBackend()
    const store = new OldFavoriteRuntimeStore(backend)
    store.bindAccount('42')
    store.setTransient('scanProgress', { completed: 25 }, 0)
    store.checkpoint(['scanProgress'])

    store.setTransient('scanProgress', { completed: 26 }, 1)
    store.set('oldFavoriteRuntimeStatus', { label: '扫描中' }, 0)

    const reopened = new OldFavoriteRuntimeStore(backend)
    reopened.bindAccount('42')
    expect(reopened.get('scanProgress', null).value).toEqual({ completed: 25 })
  })

  it('resets one account runtime without deleting another account or global state', () => {
    const backend = memoryBackend()
    const store = new OldFavoriteRuntimeStore(backend)
    store.bindAccount('42')
    store.set('oldFavoriteExecutionPhase', 'paused', 0)
    store.bindAccount('99')
    store.set('oldFavoriteExecutionPhase', 'idle', 0)
    store.resetAccount('42')

    const reopened = new OldFavoriteRuntimeStore(backend)
    reopened.bindAccount('42')
    expect(reopened.get('oldFavoriteExecutionPhase', null).value).toBeNull()
    reopened.bindAccount('99')
    expect(reopened.get('oldFavoriteExecutionPhase', null).value).toBe('idle')
  })
})
