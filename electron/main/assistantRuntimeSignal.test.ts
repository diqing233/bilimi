import { describe, expect, it, vi } from 'vitest'
import {
  createAssistantRuntimeTimeoutMs,
  installAssistantRuntimeReadinessLifecycle,
  requestAssistantRuntimeWhenReady
} from './assistantRuntimeSignal'
import type { AssistantRuntimeResponse } from './assistantRuntimeSignal'
import type { AssistantAutomationResult } from '../../src/shared/types'

function createAutomationResult(ok: boolean): AssistantAutomationResult {
  return {
    ok,
    steps: [],
    missingTargets: [],
    message: ok ? 'ok' : 'failed'
  }
}

function createRuntimeTarget(isLoading: boolean, isRuntimeReady = true) {
  let finishLoad: (() => void) | undefined
  let destroyed: (() => void) | undefined
  let runtimeReady: (() => void) | undefined
  let targetDestroyed = false
  const send = vi.fn()
  const once = vi.fn((event: string, callback: () => void) => {
    if (event === 'did-finish-load') {
      finishLoad = callback
    } else if (event === 'destroyed') {
      destroyed = callback
    }
  })
  const removeListener = vi.fn((event: string, callback: () => void) => {
    if (event === 'did-finish-load' && finishLoad === callback) {
      finishLoad = undefined
    } else if (event === 'destroyed' && destroyed === callback) {
      destroyed = undefined
    }
  })
  const onceRuntimeReady = vi.fn((callback: () => void) => {
    runtimeReady = callback
  })
  const removeRuntimeReadyListener = vi.fn()

  return {
    destroy: () => {
      targetDestroyed = true
      destroyed?.()
    },
    finishLoad: () => finishLoad?.(),
    markRuntimeReady: () => {
      isRuntimeReady = true
      runtimeReady?.()
    },
    target: {
      isDestroyed: () => targetDestroyed,
      isRuntimeReady: () => isRuntimeReady,
      onceRuntimeReady,
      removeRuntimeReadyListener,
      webContents: {
        isLoading: () => isLoading,
        once,
        removeListener,
        send
      }
    },
    onceRuntimeReady,
    removeRuntimeReadyListener,
    removeListener,
    once,
    send
  }
}

function createResponseBus() {
  let responseListener:
    | ((_event: unknown, response: AssistantRuntimeResponse) => void)
    | undefined
  const on = vi.fn((event: string, listener: typeof responseListener) => {
    if (event === 'assistant-runtime:response') {
      responseListener = listener
    }
  })
  const once = vi.fn((event: string, listener: typeof responseListener) => {
    if (event === 'assistant-runtime:response') {
      responseListener = listener
    }
  })
  const removeListener = vi.fn()

  return {
    emitResponse: (response: AssistantRuntimeResponse) => responseListener?.({}, response),
    on,
    once,
    removeListener
  }
}

describe('requestAssistantRuntimeWhenReady', () => {
  it('installs readiness reset listeners on the concrete runtime window', () => {
    const listeners = new Map<string, () => void>()
    const clearReady = vi.fn()
    const clearWaiters = vi.fn()
    const win = {
      webContents: {
        id: 42,
        on: vi.fn((event: string, callback: () => void) => listeners.set(event, callback))
      }
    }

    installAssistantRuntimeReadinessLifecycle(win, { clearReady, clearWaiters })

    listeners.get('did-start-loading')?.()
    listeners.get('destroyed')?.()
    expect(clearReady).toHaveBeenCalledTimes(2)
    expect(clearReady).toHaveBeenCalledWith(42)
    expect(clearWaiters).toHaveBeenCalledWith(42)
  })

  it('uses a long default timeout for long-running runtime requests', () => {
    expect(createAssistantRuntimeTimeoutMs({ type: 'generate-video-note-from-audio' })).toBe(
      30 * 60 * 1000
    )
    expect(
      createAssistantRuntimeTimeoutMs({
        type: 'run-action',
        action: '表',
        options: { submitComment: true }
      })
    ).toBe(60 * 1000)
    expect(createAssistantRuntimeTimeoutMs({ type: 'snapshot' })).toBe(60 * 1000)
  })

  it('keeps every final runtime timeout at or above 60 seconds', () => {
    const quickRequests = [
      { type: 'snapshot' as const },
      { type: 'generate-video-note' as const },
      { type: 'save-video-note' as const, note: {} as never },
      { type: 'get-current-video-time' as const },
      { type: 'seek-video-time' as const, seconds: 30 },
      { type: 'ensure-ledgers' as const },
      { type: 'save-ledgers' as const, ledgers: [] },
      { type: 'open-bilibili-favorites' as const }
    ]

    for (const request of quickRequests) {
      expect(createAssistantRuntimeTimeoutMs(request)).toBeGreaterThanOrEqual(60 * 1000)
    }
  })

  it('uses the action timeout while reading the current video before enqueueing transcription', () => {
    expect(
      createAssistantRuntimeTimeoutMs({
        type: 'enqueue-current-video-audio',
        summarizeWithDeepSeek: true
      })
    ).toBe(60 * 1000)
  })

  it('sends a runtime request immediately when the renderer is loaded', async () => {
    const { target, send } = createRuntimeTarget(false)
    const bus = createResponseBus()
    const promise = requestAssistantRuntimeWhenReady<AssistantAutomationResult>({
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

    bus.emitResponse({ id: 'req-1', ok: true, payload: createAutomationResult(true) })

    await expect(promise).resolves.toMatchObject({ ok: true })
  })

  it('dispatches concurrent responses out of order through one shared response listener', async () => {
    const { target, send } = createRuntimeTarget(false)
    const bus = createResponseBus()
    const longRequest = requestAssistantRuntimeWhenReady<AssistantAutomationResult>({
      createRequestId: () => 'req-long',
      request: { type: 'generate-video-note-from-audio' },
      responseBus: bus,
      target,
      timeoutMs: 100
    })
    const snapshotRequest = requestAssistantRuntimeWhenReady<AssistantAutomationResult>({
      createRequestId: () => 'req-snapshot',
      request: { type: 'snapshot' },
      responseBus: bus,
      target,
      timeoutMs: 100
    })

    expect(send).toHaveBeenCalledTimes(2)
    expect(bus.on).toHaveBeenCalledTimes(1)
    expect(bus.once).not.toHaveBeenCalled()

    bus.emitResponse({
      id: 'req-snapshot',
      ok: true,
      payload: createAutomationResult(true)
    })
    await expect(snapshotRequest).resolves.toMatchObject({ ok: true })

    bus.emitResponse({
      id: 'req-long',
      ok: true,
      payload: createAutomationResult(true)
    })
    await expect(longRequest).resolves.toMatchObject({ ok: true })
  })

  it('rejects a duplicate request id before replacing the pending request', async () => {
    const { target, send } = createRuntimeTarget(false)
    const bus = createResponseBus()
    const firstRequest = requestAssistantRuntimeWhenReady<AssistantAutomationResult>({
      createRequestId: () => 'req-duplicate',
      request: { type: 'snapshot' },
      responseBus: bus,
      target,
      timeoutMs: 100
    })
    const duplicateRequest = requestAssistantRuntimeWhenReady<AssistantAutomationResult>({
      createRequestId: () => 'req-duplicate',
      request: { type: 'snapshot' },
      responseBus: bus,
      target,
      timeoutMs: 100
    })

    await expect(duplicateRequest).rejects.toThrow('Duplicate assistant runtime request id: req-duplicate')
    expect(send).toHaveBeenCalledTimes(1)

    bus.emitResponse({ id: 'req-duplicate', ok: true, payload: createAutomationResult(true) })
    await expect(firstRequest).resolves.toMatchObject({ ok: true })
  })

  it('waits for renderer load before sending the runtime request', async () => {
    const { finishLoad, target, once, send } = createRuntimeTarget(true)
    const bus = createResponseBus()

    const promise = requestAssistantRuntimeWhenReady<AssistantAutomationResult>({
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
    bus.emitResponse({ id: 'req-2', ok: true, payload: createAutomationResult(true) })
    await expect(promise).resolves.toMatchObject({ ok: true })
  })

  it('does not send a loading runtime request after it has timed out', async () => {
    vi.useFakeTimers()

    try {
      const { finishLoad, target, removeListener, send } = createRuntimeTarget(true)
      const bus = createResponseBus()
      const promise = requestAssistantRuntimeWhenReady({
        createRequestId: () => 'req-loading-timeout',
        request: { type: 'snapshot' },
        responseBus: bus,
        target,
        timeoutMs: 100
      })
      const rejection = expect(promise).rejects.toThrow('Assistant runtime request timed out.')

      await vi.advanceTimersByTimeAsync(100)
      await rejection
      finishLoad()

      expect(send).not.toHaveBeenCalled()
      expect(removeListener).toHaveBeenCalledWith('did-finish-load', expect.any(Function))
      expect(removeListener).toHaveBeenCalledWith('destroyed', expect.any(Function))
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects a loading request and removes its listeners when the target is destroyed', async () => {
    const { destroy, target, removeListener, send } = createRuntimeTarget(true)
    const bus = createResponseBus()
    const promise = requestAssistantRuntimeWhenReady({
      createRequestId: () => 'req-loading-destroyed',
      request: { type: 'snapshot' },
      responseBus: bus,
      target,
      timeoutMs: 100
    })

    destroy()

    await expect(promise).rejects.toThrow('Assistant runtime target was destroyed.')
    expect(send).not.toHaveBeenCalled()
    expect(removeListener).toHaveBeenCalledWith('did-finish-load', expect.any(Function))
    expect(removeListener).toHaveBeenCalledWith('destroyed', expect.any(Function))
  })

  it('waits for the renderer runtime registration after the page has loaded', async () => {
    const { markRuntimeReady, target, onceRuntimeReady, send } = createRuntimeTarget(false, false)
    const bus = createResponseBus()
    const promise = requestAssistantRuntimeWhenReady<AssistantAutomationResult>({
      createRequestId: () => 'req-ready',
      request: { type: 'snapshot' },
      responseBus: bus,
      target,
      timeoutMs: 100
    })

    expect(send).not.toHaveBeenCalled()
    expect(onceRuntimeReady).toHaveBeenCalledTimes(1)

    markRuntimeReady()

    expect(send).toHaveBeenCalledWith('assistant-runtime:request', {
      id: 'req-ready',
      type: 'snapshot'
    })

    bus.emitResponse({ id: 'req-ready', ok: true, payload: createAutomationResult(true) })
    await expect(promise).resolves.toMatchObject({ ok: true })
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
    const promise = requestAssistantRuntimeWhenReady<AssistantAutomationResult>({
      createRequestId: () => 'req-4',
      request: { type: 'snapshot' },
      responseBus: bus,
      target,
      timeoutMs: 100
    })

    bus.emitResponse({ id: 'other', ok: true, payload: createAutomationResult(false) })
    bus.emitResponse({ id: 'req-4', ok: true, payload: createAutomationResult(true) })

    await expect(promise).resolves.toMatchObject({ ok: true })
  })

  it('keeps audio note generation alive past the default quick request timeout', async () => {
    vi.useFakeTimers()

    try {
      const { target } = createRuntimeTarget(false)
      const bus = createResponseBus()
      const promise = requestAssistantRuntimeWhenReady<AssistantAutomationResult>({
        createRequestId: () => 'req-5',
        request: { type: 'generate-video-note-from-audio' },
        responseBus: bus,
        target
      })

      await vi.advanceTimersByTimeAsync(8000)

      bus.emitResponse({ id: 'req-5', ok: true, payload: createAutomationResult(true) })

      await expect(promise).resolves.toMatchObject({ ok: true })
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps assistant actions alive past the quick request timeout', async () => {
    vi.useFakeTimers()

    try {
      const { target } = createRuntimeTarget(false)
      const bus = createResponseBus()
      const promise = requestAssistantRuntimeWhenReady<AssistantAutomationResult>({
        createRequestId: () => 'req-7',
        request: {
          type: 'run-action',
          action: '表',
          options: { submitComment: true }
        },
        responseBus: bus,
        target
      })

      await vi.advanceTimersByTimeAsync(8000)

      bus.emitResponse({ id: 'req-7', ok: true, payload: createAutomationResult(true) })

      await expect(promise).resolves.toMatchObject({ ok: true })
    } finally {
      vi.useRealTimers()
    }
  })
})
