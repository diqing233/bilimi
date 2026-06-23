export type AssistantPetState = 'idle' | 'hint' | 'working' | 'error'

export type AssistantPetHint = {
  tone: Exclude<AssistantPetState, 'idle'>
  message: string
}

export type AssistantPetStateView = {
  state: AssistantPetState
  label: '小咪待机' | '小咪提示' | '小咪忙碌中' | '小咪遇到问题'
  bubble: string
}

const STATE_VIEWS: Record<AssistantPetState, AssistantPetStateView> = {
  idle: {
    state: 'idle',
    label: '小咪待机',
    bubble: '我是 bilimi，主人可以叫我小咪~'
  },
  hint: {
    state: 'hint',
    label: '小咪提示',
    bubble: '主人，页面有新动静，小咪帮你盯着。'
  },
  working: {
    state: 'working',
    label: '小咪忙碌中',
    bubble: '小咪正在处理，马上回来。'
  },
  error: {
    state: 'error',
    label: '小咪遇到问题',
    bubble: '这里卡住了，主人回侧栏看一下吧。'
  }
}

export function normalizePetState(value: unknown): AssistantPetState {
  return value === 'hint' || value === 'working' || value === 'error' ? value : 'idle'
}

export function createPetStateView(state: AssistantPetState): AssistantPetStateView {
  return STATE_VIEWS[state]
}
