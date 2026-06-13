export type AssistantPetState = 'idle' | 'hint' | 'working' | 'error'

export type AssistantPetStateView = {
  state: AssistantPetState
  label: '待机' | '提示' | '处理中' | '出错'
  bubble: string
}

const STATE_VIEWS: Record<AssistantPetState, AssistantPetStateView> = {
  idle: {
    state: 'idle',
    label: '待机',
    bubble: '奴婢候着，陛下唤我便是。'
  },
  hint: {
    state: 'hint',
    label: '提示',
    bubble: '案头有新动静，请陛下回窗一观。'
  },
  working: {
    state: 'working',
    label: '处理中',
    bubble: '奴婢正在传旨，稍候即回。'
  },
  error: {
    state: 'error',
    label: '出错',
    bubble: '此事似有阻滞，请回侧栏细看。'
  }
}

export function normalizePetState(value: unknown): AssistantPetState {
  return value === 'hint' || value === 'working' || value === 'error' ? value : 'idle'
}

export function createPetStateView(state: AssistantPetState): AssistantPetStateView {
  return STATE_VIEWS[state]
}
