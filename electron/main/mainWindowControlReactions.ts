import type { AssistantPetHint } from '../../src/renderer/src/features/assistant/petState'
import type { AssistantPreferences } from './store'
import {
  createCloseConfirmationOptions,
  resolveMainWindowCloseAction,
  type CloseConfirmationResult
} from './mainWindowCloseBehavior'

export const MAIN_WINDOW_CLOSE_FAREWELL_DELAY_MS = 900

type MainWindowControlTarget = {
  close: () => void
  hide: () => void
  on(eventName: 'minimize', handler: (...args: unknown[]) => void): unknown
  on(eventName: 'restore', handler: (...args: unknown[]) => void): unknown
  on(eventName: 'maximize', handler: (...args: unknown[]) => void): unknown
  on(eventName: 'unmaximize', handler: (...args: unknown[]) => void): unknown
  on(eventName: 'close', handler: (...args: unknown[]) => void): unknown
}

type MainWindowControlReactionsOptions = {
  closeAssistantPet: () => void
  getPreferences: () => AssistantPreferences
  minimizeToTray: () => void
  prepareToExitLauncher: () => void
  savePreferencePatch: (patch: Partial<AssistantPreferences>) => void
  sendPetHint: (hint: AssistantPetHint) => void
  showCloseConfirmation: () => CloseConfirmationResult | Promise<CloseConfirmationResult>
  window: MainWindowControlTarget
}

const MINIMIZE_LINES = [
  '那小咪先收起来啦，等你回来。',
  '小咪先在旁边待命啦，主人随时找我~',
  '小咪先安静一下，主人回来再叫我。'
]

const MINIMIZED_RESTORE_LINES = [
  '欢迎回来，主人。小咪一直在等你。',
  '主人回来啦，小咪刚刚差点就要跑去找你了。',
  '小咪在这里，欢迎回家。'
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
  getPreferences,
  minimizeToTray,
  prepareToExitLauncher,
  savePreferencePatch,
  sendPetHint,
  showCloseConfirmation,
  window
}: MainWindowControlReactionsOptions) {
  let closeAssistantPetAfterFarewell = false
  let allowNativeClose = false

  function farewellAndClosePet() {
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
  }

  function executeCloseAction(
    action: ReturnType<typeof resolveMainWindowCloseAction>,
    options: { closeAfterExit?: boolean } = {}
  ) {
    if ('preferencePatch' in action && action.preferencePatch) {
      savePreferencePatch(action.preferencePatch)
    }

    if (action.kind === 'minimize-to-tray') {
      minimizeToTray()
      return
    }

    if (action.kind === 'exit-launcher') {
      prepareToExitLauncher()
      farewellAndClosePet()

      if (options.closeAfterExit) {
        allowNativeClose = true
        window.close()
      }
    }
  }

  window.on('minimize', () => {
    sendPetHint({
      tone: 'sleepy',
      message: pickLine(MINIMIZE_LINES)
    })
  })

  window.on('restore', () => {
    sendPetHint({
      tone: 'shy',
      message: pickLine(MINIMIZED_RESTORE_LINES)
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

  window.on('close', (event: { preventDefault?: () => void } = {}) => {
    if (allowNativeClose) {
      return
    }

    const action = resolveMainWindowCloseAction({ preferences: getPreferences() })

    if (action.kind === 'confirm-before-exit') {
      event.preventDefault?.()
      void Promise.resolve(showCloseConfirmation()).then((confirmation) => {
        const confirmedAction = resolveMainWindowCloseAction({
          preferences: getPreferences(),
          confirmation
        })
        executeCloseAction(confirmedAction, { closeAfterExit: true })
      })
      return
    }

    if (action.kind === 'minimize-to-tray' || action.kind === 'cancel') {
      event.preventDefault?.()
    }

    executeCloseAction(action)
  })
}

export { createCloseConfirmationOptions }
