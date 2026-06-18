export type AssistantPetState = 'idle' | 'hint' | 'working' | 'error'

export type AssistantPetStateView = {
  state: AssistantPetState
  label: '小mi待机' | '小mi提示' | '小mi忙碌中' | '小mi遇到问题'
  bubble: string
}

const STATE_VIEWS: Record<AssistantPetState, AssistantPetStateView> = {
  idle: {
    state: 'idle',
    label: '小mi待机',
    bubble: '我是 bilimi，主人可以叫我小mi~'
  },
  hint: {
    state: 'hint',
    label: '小mi提示',
    bubble: '主人，页面有新动静，小mi帮你盯着。'
  },
  working: {
    state: 'working',
    label: '小mi忙碌中',
    bubble: '小mi正在处理，马上回来。'
  },
  error: {
    state: 'error',
    label: '小mi遇到问题',
    bubble: '这里卡住了，主人回侧栏看一下吧。'
  }
}

export function normalizePetState(value: unknown): AssistantPetState {
  return value === 'hint' || value === 'working' || value === 'error' ? value : 'idle'
}

export function createPetStateView(state: AssistantPetState): AssistantPetStateView {
  return STATE_VIEWS[state]
}
