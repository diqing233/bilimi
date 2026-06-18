import { describe, expect, it } from 'vitest'
import { createPetStateView, normalizePetState } from './petState'

describe('petState', () => {
  it('maps all Xiao Mi pet states to visible labels', () => {
    expect(createPetStateView('idle')).toEqual({
      state: 'idle',
      label: '小mi待机',
      bubble: '我是 bilimi，主人可以叫我小mi~'
    })
    expect(createPetStateView('hint')).toMatchObject({
      label: '小mi提示',
      bubble: '主人，页面有新动静，小mi帮你盯着。'
    })
    expect(createPetStateView('working')).toMatchObject({
      label: '小mi忙碌中',
      bubble: '小mi正在处理，马上回来。'
    })
    expect(createPetStateView('error')).toMatchObject({
      label: '小mi遇到问题',
      bubble: '这里卡住了，主人回侧栏看一下吧。'
    })
  })

  it('falls back to idle for unknown persisted or IPC values', () => {
    expect(normalizePetState('hint')).toBe('hint')
    expect(normalizePetState('broken')).toBe('idle')
    expect(normalizePetState(undefined)).toBe('idle')
  })
})
