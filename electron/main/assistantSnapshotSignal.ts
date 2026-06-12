type AssistantSnapshotTarget = {
  isDestroyed: () => boolean
  webContents: {
    isLoading: () => boolean
    once: (event: 'did-finish-load', callback: () => void) => void
    send: (channel: 'floating-assistant:snapshot-changed') => void
  }
}

export function sendAssistantSnapshotChangedWhenReady(target: AssistantSnapshotTarget) {
  const sendSnapshotChangedSignal = () => {
    if (!target.isDestroyed()) {
      target.webContents.send('floating-assistant:snapshot-changed')
    }
  }

  if (target.webContents.isLoading()) {
    target.webContents.once('did-finish-load', sendSnapshotChangedSignal)
    return
  }

  sendSnapshotChangedSignal()
}
