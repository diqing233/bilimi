import { describe, expect, it, vi } from 'vitest'
import {
  createAssistantRuntimeTimeoutMs,
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
  it('uses a long default timeout for long-running runtime requests', () => {
    expect(createAssistantRuntimeTimeoutMs({ type: 'generate-video-note-from-audio' })).toBe(
      30 * 60 * 1000
    )
    expect(createAssistantRuntimeTimeoutMs({ type: 'scan-old-favorites' })).toBe(30 * 60 * 1000)
    expect(
      createAssistantRuntimeTimeoutMs({
        type: 'rejudge-old-favorite',
        item: {
          aid: 250,
          title: '待重判旧藏',
          sourceFolderTitle: '默认收藏夹',
          sourceFolderIds: [],
          sourceFolderTitles: ['默认收藏夹'],
          currentBilimiFolderIds: [],
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'bilimi·暂存',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false,
          originalSuggestedLedgerIds: [],
          currentTargetLedgerIds: [],
          selectedTargetLedgerIds: [],
          lowConfidence: false
        }
      })
    ).toBe(30 * 60 * 1000)
    expect(createAssistantRuntimeTimeoutMs({ type: 'execute-old-favorite-plan', items: [] })).toBe(
      30 * 60 * 1000
    )
    expect(
      createAssistantRuntimeTimeoutMs({
        type: 'run-action',
        action: '表',
        options: { submitComment: true }
      })
    ).toBe(60 * 1000)
    expect(createAssistantRuntimeTimeoutMs({ type: 'snapshot' })).toBe(8000)
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

  it('keeps old favorite scans alive past the default quick request timeout', async () => {
    vi.useFakeTimers()

    try {
      const { target } = createRuntimeTarget(false)
      const bus = createResponseBus()
      const promise = requestAssistantRuntimeWhenReady<AssistantAutomationResult>({
        createRequestId: () => 'req-6',
        request: { type: 'scan-old-favorites' },
        responseBus: bus,
        target
      })

      await vi.advanceTimersByTimeAsync(8000)

      bus.emitResponse({ id: 'req-6', ok: true, payload: createAutomationResult(true) })

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
