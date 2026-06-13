import type { AssistantAction } from '../../src/shared/types'

type AssistantActionTarget = {
  isDestroyed: () => boolean
  webContents: {
    isLoading: () => boolean
    once: (event: 'did-finish-load', callback: () => void) => void
    send: (channel: 'assistant:run-action', payload: AssistantActionPayload) => void
  }
}

export type AssistantActionPayload = {
  action: AssistantAction
}

export function sendAssistantActionWhenReady(
  target: AssistantActionTarget,
  payload: AssistantActionPayload
) {
  const sendActionSignal = () => {
    if (!target.isDestroyed()) {
      target.webContents.send('assistant:run-action', payload)
    }
  }

  if (target.webContents.isLoading()) {
    target.webContents.once('did-finish-load', sendActionSignal)
    return
  }

  sendActionSignal()
}
