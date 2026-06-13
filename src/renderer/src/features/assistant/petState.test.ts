import { describe, expect, it } from 'vitest'
import { createPetStateView, normalizePetState } from './petState'

describe('petState', () => {
  it('maps all palace maid pet states to visible labels', () => {
    expect(createPetStateView('idle')).toEqual({
      state: 'idle',
      label: '待机',
      bubble: '奴婢候着，陛下唤我便是。'
    })
    expect(createPetStateView('hint').label).toBe('提示')
    expect(createPetStateView('working').label).toBe('处理中')
    expect(createPetStateView('error').label).toBe('出错')
  })

  it('falls back to idle for unknown persisted or IPC values', () => {
    expect(normalizePetState('hint')).toBe('hint')
    expect(normalizePetState('broken')).toBe('idle')
    expect(normalizePetState(undefined)).toBe('idle')
  })
})
