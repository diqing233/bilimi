type AssistantOpenTarget = {
  isDestroyed: () => boolean
  webContents: {
    isLoading: () => boolean
    once: (event: 'did-finish-load', callback: () => void) => void
    send: (channel: 'assistant:open', payload?: AssistantOpenPayload) => void
  }
}

export type AssistantOpenPayload = {
  position?: {
    left: number
    top: number
  }
}

export function sendAssistantOpenWhenReady(
  target: AssistantOpenTarget,
  payload?: AssistantOpenPayload
) {
  const sendOpenSignal = () => {
    if (!target.isDestroyed()) {
      if (payload) {
        target.webContents.send('assistant:open', payload)
        return
      }

      target.webContents.send('assistant:open')
    }
  }

  if (target.webContents.isLoading()) {
    target.webContents.once('did-finish-load', sendOpenSignal)
    return
  }

  sendOpenSignal()
}
