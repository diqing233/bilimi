import { describe, expect, it } from 'vitest'
import { OldFavoriteRuntimeStore } from './oldFavoriteRuntimeStore'

describe('OldFavoriteRuntimeStore', () => {
  it('accepts the first matching revision and rejects a stale conflicting write', () => {
    const store = new OldFavoriteRuntimeStore()
    const initial = store.get('archivePlanState', null)

    const accepted = store.set('archivePlanState', { owner: 'sidebar' }, initial.revision)
    const rejected = store.set('archivePlanState', { owner: 'floating' }, initial.revision)

    expect(accepted).toMatchObject({ accepted: true, revision: 1, value: { owner: 'sidebar' } })
    expect(rejected).toMatchObject({ accepted: false, revision: 1, value: { owner: 'sidebar' } })
  })

  it('clears task state when the signed-in account changes', () => {
    const store = new OldFavoriteRuntimeStore()
    store.bindAccount('42')
    store.set('deepSeekArchiveRunning', true, 0)

    expect(store.bindAccount('99')).toBe(true)
    expect(store.get('deepSeekArchiveRunning', false)).toMatchObject({ revision: 0, value: false })
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
