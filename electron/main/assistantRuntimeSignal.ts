import type {
  AssistantRuntimeRequestInput,
  AssistantRuntimeRequest,
  AssistantRuntimeResponsePayload
} from '../../src/renderer/src/features/assistant/assistantRuntimeTypes'

type AssistantRuntimeTarget = {
  isDestroyed: () => boolean
  isRuntimeReady: () => boolean
  onceRuntimeReady: (callback: () => void) => void
  removeRuntimeReadyListener: (callback: () => void) => void
  webContents: {
    isLoading: () => boolean
    once: (event: 'did-finish-load', callback: () => void) => void
    send: (channel: 'assistant-runtime:request', request: AssistantRuntimeRequest) => void
  }
}

type AssistantRuntimeResponseBus = {
  once: (
    event: 'assistant-runtime:response',
    callback: (_event: unknown, response: AssistantRuntimeResponse) => void
  ) => void
  removeListener: (
    event: 'assistant-runtime:response',
    callback: (_event: unknown, response: AssistantRuntimeResponse) => void
  ) => void
}

export function installAssistantRuntimeReadinessLifecycle(
  win: {
    webContents: {
      id: number
      on: (event: 'did-start-loading' | 'destroyed', callback: () => void) => void
    }
  },
  handlers: {
    clearReady: (webContentsId: number) => void
    clearWaiters: (webContentsId: number) => void
  }
) {
  const webContentsId = win.webContents.id
  win.webContents.on('did-start-loading', () => handlers.clearReady(webContentsId))
  win.webContents.on('destroyed', () => {
    handlers.clearReady(webContentsId)
    handlers.clearWaiters(webContentsId)
  })
}

const QUICK_RUNTIME_REQUEST_TIMEOUT_MS = 60 * 1000
const ACTION_RUNTIME_REQUEST_TIMEOUT_MS = 60 * 1000
const LONG_RUNTIME_REQUEST_TIMEOUT_MS = 30 * 60 * 1000

export type AssistantRuntimeResponse =
  | {
      id: string
      ok: true
      payload: AssistantRuntimeResponsePayload
    }
  | {
      id: string
      ok: false
      error: string
    }

export function requestAssistantRuntimeWhenReady<TPayload>({
  createRequestId,
  request,
  responseBus,
  target,
  timeoutMs = createAssistantRuntimeTimeoutMs(request)
}: {
  createRequestId: () => string
  request: AssistantRuntimeRequestInput
  responseBus: AssistantRuntimeResponseBus
  target: AssistantRuntimeTarget
  timeoutMs?: number
}): Promise<TPayload> {
  const id = createRequestId()
  const runtimeRequest = { id, ...request } as AssistantRuntimeRequest

  return new Promise((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      settled = true
      responseBus.removeListener('assistant-runtime:response', handleResponse)
      target.removeRuntimeReadyListener(sendRequest)
      reject(new Error('Assistant runtime request timed out.'))
    }, timeoutMs)

    function handleResponse(_event: unknown, response: AssistantRuntimeResponse) {
      if (response.id !== id) {
        responseBus.once('assistant-runtime:response', handleResponse)
        return
      }

      settled = true
      clearTimeout(timeout)

      if (!response.ok) {
        reject(new Error(response.error))
        return
      }

      resolve(response.payload as TPayload)
    }

    function sendRequest() {
      if (settled) return
      target.removeRuntimeReadyListener(sendRequest)
      if (target.isDestroyed()) {
        settled = true
        clearTimeout(timeout)
        reject(new Error('Assistant runtime target was destroyed.'))
        return
      }

      if (!target.isRuntimeReady()) {
        target.onceRuntimeReady(sendRequest)
        return
      }

      responseBus.once('assistant-runtime:response', handleResponse)
      target.webContents.send('assistant-runtime:request', runtimeRequest)
    }

    if (target.webContents.isLoading()) {
      target.webContents.once('did-finish-load', sendRequest)
      return
    }

    sendRequest()
  })
}

export function createAssistantRuntimeTimeoutMs(request: AssistantRuntimeRequestInput): number {
  if (request.type === 'run-action' || request.type === 'enqueue-current-video-audio') {
    return ACTION_RUNTIME_REQUEST_TIMEOUT_MS
  }

  if (
    request.type === 'generate-video-note-from-audio' ||
    request.type === 'scan-old-favorites' ||
    request.type === 'rejudge-old-favorite' ||
    request.type === 'execute-old-favorite-plan'
  ) {
    return LONG_RUNTIME_REQUEST_TIMEOUT_MS
  }

  return QUICK_RUNTIME_REQUEST_TIMEOUT_MS
}
