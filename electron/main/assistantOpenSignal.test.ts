import { describe, expect, it, vi } from 'vitest'
import { sendAssistantOpenWhenReady } from './assistantOpenSignal'

function createAssistantOpenTarget(isLoading: boolean) {
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

describe('sendAssistantOpenWhenReady', () => {
  it('sends the assistant open signal immediately when the renderer is loaded', () => {
    const { target, send, once } = createAssistantOpenTarget(false)

    sendAssistantOpenWhenReady(target)

    expect(send).toHaveBeenCalledWith('assistant:open')
    expect(once).not.toHaveBeenCalled()
  })

  it('waits for the renderer load to finish before sending the assistant open signal', () => {
    const { finishLoad, target, send, once } = createAssistantOpenTarget(true)

    sendAssistantOpenWhenReady(target)

    expect(send).not.toHaveBeenCalled()
    expect(once).toHaveBeenCalledWith('did-finish-load', expect.any(Function))

    finishLoad()

    expect(send).toHaveBeenCalledWith('assistant:open')
  })
})
