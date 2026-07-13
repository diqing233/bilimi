import type { MessageBoxSyncOptions } from 'electron'
import type { AssistantPreferences } from './store'

export type CloseConfirmationResult = {
  response: number
  checkboxChecked: boolean
}

export type MainWindowCloseAction =
  | { kind: 'cancel' }
  | { kind: 'confirm-before-exit' }
  | {
      kind: 'exit-launcher' | 'minimize-to-tray'
      preferencePatch?: Partial<AssistantPreferences>
    }

const CLOSE_CONFIRMATION_BUTTONS = ['最小化到托盘', '退出 bilimi', '取消']

export function createCloseConfirmationOptions(): MessageBoxSyncOptions {
  return {
    type: 'question',
    title: '关闭 bilimi？',
    message: '关闭 bilimi？',
    detail: [
      '最小化到托盘：本次会保留后台运行；勾选“记住选择”后，下次点关闭将直接最小化。',
      '退出 bilimi：本次会结束启动器和悬浮小咪；勾选“记住选择”后，下次点关闭将直接退出。'
    ].join('\n\n'),
    buttons: CLOSE_CONFIRMATION_BUTTONS,
    defaultId: 0,
    cancelId: 2,
    checkboxLabel: '记住选择',
    checkboxChecked: false,
    noLink: true
  }
}

export function resolveMainWindowCloseAction({
  confirmation,
  preferences
}: {
  confirmation?: CloseConfirmationResult
  preferences: AssistantPreferences
}): MainWindowCloseAction {
  if (preferences.closeBehavior === 'minimize-to-tray' && !confirmation) {
    return { kind: 'minimize-to-tray' }
  }

  if (!preferences.confirmBeforeExit && !confirmation) {
    return { kind: 'exit-launcher' }
  }

  if (!confirmation) {
    return { kind: 'confirm-before-exit' }
  }

  if (confirmation.response === 0) {
    return {
      kind: 'minimize-to-tray',
      preferencePatch: confirmation.checkboxChecked
        ? { closeBehavior: 'minimize-to-tray' }
        : undefined
    }
  }

  if (confirmation.response === 1) {
    return {
      kind: 'exit-launcher',
      preferencePatch: confirmation.checkboxChecked
        ? { closeBehavior: 'exit-launcher', confirmBeforeExit: false }
        : undefined
    }
  }

  return { kind: 'cancel' }
}
