import { describe, expect, it } from 'vitest'
import { OldFavoriteRuntimeStore } from './oldFavoriteRuntimeStore'

describe('OldFavoriteRuntimeStore', () => {
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
    expect(store.bindAccount('42')).toBe(true)
    expect(store.get('deepSeekArchiveRunning', false)).toMatchObject({ revision: 1, value: true })
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
})
