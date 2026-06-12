import { describe, expect, it, vi } from 'vitest'
import { sendAssistantSnapshotChangedWhenReady } from './assistantSnapshotSignal'

function createSnapshotTarget(isLoading: boolean) {
  let finishLoad: (() => void) | undefined
  const send = vi.fn()
  const once = vi.fn((event: string, callback: () => void) => {
    if (event === 'did-finish-load') {
      finishLoad = callback
    }
  })

  return {
    finishLoad: () => finishLoad?.(),
    target: {
      isDestroyed: () => false,
      webContents: {
        isLoading: () => isLoading,
        once,
        send
      }
    },
    once,
    send
  }
}

describe('sendAssistantSnapshotChangedWhenReady', () => {
  it('sends a snapshot refresh signal immediately when the floating assistant is loaded', () => {
    const { target, send } = createSnapshotTarget(false)

    sendAssistantSnapshotChangedWhenReady(target)

    expect(send).toHaveBeenCalledWith('floating-assistant:snapshot-changed')
  })

  it('waits for the floating assistant to load before sending the refresh signal', () => {
    const { finishLoad, target, once, send } = createSnapshotTarget(true)

    sendAssistantSnapshotChangedWhenReady(target)

    expect(send).not.toHaveBeenCalled()
    expect(once).toHaveBeenCalledWith('did-finish-load', expect.any(Function))

    finishLoad()

    expect(send).toHaveBeenCalledWith('floating-assistant:snapshot-changed')
  })
})
