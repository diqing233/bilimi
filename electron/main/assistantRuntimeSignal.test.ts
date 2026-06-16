import { describe, expect, it, vi } from 'vitest'
import {
  createAssistantRuntimeTimeoutMs,
  requestAssistantRuntimeWhenReady
} from './assistantRuntimeSignal'
import type { AssistantRuntimeResponse } from './assistantRuntimeSignal'

function createRuntimeTarget(isLoading: boolean) {
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

function createResponseBus() {
  let responseListener:
    | ((_event: unknown, response: AssistantRuntimeResponse) => void)
    | undefined
  const once = vi.fn((event: string, listener: typeof responseListener) => {
    if (event === 'assistant-runtime:response') {
      responseListener = listener
    }
  })
  const removeListener = vi.fn()

  return {
    emitResponse: (response: AssistantRuntimeResponse) => responseListener?.({}, response),
    once,
    removeListener
  }
}

describe('requestAssistantRuntimeWhenReady', () => {
  it('uses a long default timeout only for audio note generation', () => {
    expect(createAssistantRuntimeTimeoutMs({ type: 'generate-video-note-from-audio' })).toBe(
      30 * 60 * 1000
    )
    expect(createAssistantRuntimeTimeoutMs({ type: 'snapshot' })).toBe(8000)
  })

  it('sends a runtime request immediately when the renderer is loaded', async () => {
    const { target, send } = createRuntimeTarget(false)
    const bus = createResponseBus()
    const promise = requestAssistantRuntimeWhenReady<{ ok: boolean }>({
      createRequestId: () => 'req-1',
      request: { type: 'snapshot' },
      responseBus: bus,
      target,
      timeoutMs: 100
    })

    expect(send).toHaveBeenCalledWith('assistant-runtime:request', {
      id: 'req-1',
      type: 'snapshot'
    })

    bus.emitResponse({ id: 'req-1', ok: true, payload: { ok: true } })

    await expect(promise).resolves.toEqual({ ok: true })
  })

  it('waits for renderer load before sending the runtime request', () => {
    const { finishLoad, target, once, send } = createRuntimeTarget(true)
    const bus = createResponseBus()

    void requestAssistantRuntimeWhenReady({
      createRequestId: () => 'req-2',
      request: { type: 'snapshot' },
      responseBus: bus,
      target,
      timeoutMs: 100
    })

    expect(send).not.toHaveBeenCalled()
    expect(once).toHaveBeenCalledWith('did-finish-load', expect.any(Function))

    finishLoad()

    expect(send).toHaveBeenCalledWith('assistant-runtime:request', {
      id: 'req-2',
      type: 'snapshot'
    })
  })

  it('rejects when the runtime returns an error response', async () => {
    const { target } = createRuntimeTarget(false)
    const bus = createResponseBus()
    const promise = requestAssistantRuntimeWhenReady({
      createRequestId: () => 'req-3',
      request: { type: 'snapshot' },
      responseBus: bus,
      target,
      timeoutMs: 100
    })

    bus.emitResponse({ id: 'req-3', ok: false, error: 'no active webview' })

    await expect(promise).rejects.toThrow('no active webview')
  })

  it('ignores responses for other runtime request ids', async () => {
    const { target } = createRuntimeTarget(false)
    const bus = createResponseBus()
    const promise = requestAssistantRuntimeWhenReady<{ ok: boolean }>({
      createRequestId: () => 'req-4',
      request: { type: 'snapshot' },
      responseBus: bus,
      target,
      timeoutMs: 100
    })

    bus.emitResponse({ id: 'other', ok: true, payload: { ok: false } })
    bus.emitResponse({ id: 'req-4', ok: true, payload: { ok: true } })

    await expect(promise).resolves.toEqual({ ok: true })
  })

  it('keeps audio note generation alive past the default quick request timeout', async () => {
    vi.useFakeTimers()

    try {
      const { target } = createRuntimeTarget(false)
      const bus = createResponseBus()
      const promise = requestAssistantRuntimeWhenReady<{ ok: boolean }>({
        createRequestId: () => 'req-5',
        request: { type: 'generate-video-note-from-audio' },
        responseBus: bus,
        target
      })

      await vi.advanceTimersByTimeAsync(8000)

      bus.emitResponse({ id: 'req-5', ok: true, payload: { ok: true } })

      await expect(promise).resolves.toEqual({ ok: true })
    } finally {
      vi.useRealTimers()
    }
  })
})
