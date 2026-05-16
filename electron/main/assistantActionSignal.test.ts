import { describe, expect, it, vi } from 'vitest'
import { sendAssistantActionWhenReady } from './assistantActionSignal'

function createAssistantActionTarget(isLoading: boolean) {
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

describe('sendAssistantActionWhenReady', () => {
  it('sends the assistant action immediately when the renderer is loaded', () => {
    const { target, send, once } = createAssistantActionTarget(false)

    sendAssistantActionWhenReady(target, { action: '赏' })

    expect(send).toHaveBeenCalledWith('assistant:run-action', { action: '赏' })
    expect(once).not.toHaveBeenCalled()
  })

  it('waits for the renderer load to finish before sending the action', () => {
    const { finishLoad, target, send, once } = createAssistantActionTarget(true)

    sendAssistantActionWhenReady(target, { action: '藏' })

    expect(send).not.toHaveBeenCalled()
    expect(once).toHaveBeenCalledWith('did-finish-load', expect.any(Function))

    finishLoad()

    expect(send).toHaveBeenCalledWith('assistant:run-action', { action: '藏' })
  })

  it('does not send to a destroyed target', () => {
    const send = vi.fn()

    sendAssistantActionWhenReady(
      {
        isDestroyed: () => true,
        webContents: {
          isLoading: () => false,
          once: vi.fn(),
          send
        }
      },
      { action: '阅' }
    )

    expect(send).not.toHaveBeenCalled()
  })
})
