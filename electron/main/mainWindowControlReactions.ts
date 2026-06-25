import type { AssistantPetHint } from '../../src/renderer/src/features/assistant/petState'

export const MAIN_WINDOW_CLOSE_FAREWELL_DELAY_MS = 900

type MainWindowControlTarget = {
  close: () => void
  on: (
    eventName: 'minimize' | 'maximize' | 'unmaximize' | 'close',
    handler: (...args: unknown[]) => void
  ) => void
}

type MainWindowControlReactionsOptions = {
  closeAssistantPet: () => void
  sendPetHint: (hint: AssistantPetHint) => void
  window: MainWindowControlTarget
}

const MINIMIZE_LINES = [
  '那小咪先收起来啦，等你回来。',
  '主人去忙吧，小咪待会儿见。',
  '小咪先安静一下，主人回来再叫我。'
]

const MAXIMIZE_LINES = [
  '哇，屏幕变大了，小咪也看清楚啦。',
  '视野一下展开了，主人要认真看了对吧。',
  '小咪把眼睛睁大一点，陪主人看清楚。'
]

const RESTORE_LINES = [
  '窗口收回来啦，这样贴近主人刚刚好。',
  '小咪也凑近一点，继续陪你。',
  '这样刚刚好，小咪不抢地方。'
]

const CLOSE_LINES = [
  '那小咪先退场啦，主人下次见。',
  '晚安主人，小咪把门轻轻带上。',
  '今天先到这里，小咪也一起休息啦。'
]

function pickLine(lines: string[]) {
  return lines[Math.floor(Math.random() * lines.length)] ?? lines[0]
}

export function installMainWindowControlReactions({
  closeAssistantPet,
  sendPetHint,
  window
}: MainWindowControlReactionsOptions) {
  let closeAssistantPetAfterFarewell = false

  window.on('minimize', () => {
    sendPetHint({
      tone: 'sleepy',
      message: pickLine(MINIMIZE_LINES)
    })
  })

  window.on('maximize', () => {
    sendPetHint({
      tone: 'surprised',
      message: pickLine(MAXIMIZE_LINES)
    })
  })

  window.on('unmaximize', () => {
    sendPetHint({
      tone: 'shy',
      message: pickLine(RESTORE_LINES)
    })
  })

  window.on('close', () => {
    if (closeAssistantPetAfterFarewell) {
      return
    }

    closeAssistantPetAfterFarewell = true
    sendPetHint({
      tone: 'sleepy',
      message: pickLine(CLOSE_LINES)
    })

    setTimeout(() => {
      closeAssistantPet()
    }, MAIN_WINDOW_CLOSE_FAREWELL_DELAY_MS)
  })
}
