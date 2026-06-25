export type AssistantPetState =
  | 'idle'
  | 'hint'
  | 'working'
  | 'error'
  | 'happy'
  | 'shy'
  | 'thinking'
  | 'cheer'
  | 'sleepy'
  | 'surprised'
  | 'done'

export type AssistantPetHint = {
  tone: Exclude<AssistantPetState, 'idle'>
  message: string
}

export type AssistantPetStateView = {
  state: AssistantPetState
  label:
    | '小咪待机'
    | '小咪提示'
    | '小咪忙碌中'
    | '小咪遇到问题'
    | '小咪开心'
    | '小咪害羞'
    | '小咪思考'
    | '小咪加油'
    | '小咪困困'
    | '小咪惊讶'
    | '小咪完成'
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
  },
  happy: {
    state: 'happy',
    label: '小咪开心',
    bubble: '小咪开心得要转圈啦。'
  },
  shy: {
    state: 'shy',
    label: '小咪害羞',
    bubble: '主人回来啦，小咪一直在等你。'
  },
  thinking: {
    state: 'thinking',
    label: '小咪思考',
    bubble: '小咪想一想，给主人一个稳妥提醒。'
  },
  cheer: {
    state: 'cheer',
    label: '小咪加油',
    bubble: '小咪给主人打气，马上就好。'
  },
  sleepy: {
    state: 'sleepy',
    label: '小咪困困',
    bubble: '屏幕安静下来啦，小咪也乖乖等着。'
  },
  surprised: {
    state: 'surprised',
    label: '小咪惊讶',
    bubble: '欸，刚刚有新变化，小咪看到了。'
  },
  done: {
    state: 'done',
    label: '小咪完成',
    bubble: '收尾完成，主人可以安心看下一支啦。'
  }
}

export function normalizePetState(value: unknown): AssistantPetState {
  return value === 'hint' ||
    value === 'working' ||
    value === 'error' ||
    value === 'happy' ||
    value === 'shy' ||
    value === 'thinking' ||
    value === 'cheer' ||
    value === 'sleepy' ||
    value === 'surprised' ||
    value === 'done'
    ? value
    : 'idle'
}

export function createPetStateView(state: AssistantPetState): AssistantPetStateView {
  return STATE_VIEWS[state]
}
