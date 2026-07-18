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
    once: (event: 'did-finish-load' | 'destroyed', callback: () => void) => void
    removeListener: (event: 'did-finish-load' | 'destroyed', callback: () => void) => void
    send: (channel: 'assistant-runtime:request', request: AssistantRuntimeRequest) => void
  }
}

type AssistantRuntimeResponseBus = {
  on: (
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

type PendingAssistantRuntimeRequest = {
  resolve: (payload: AssistantRuntimeResponsePayload) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

const assistantRuntimeResponseBrokers = new WeakMap<
  AssistantRuntimeResponseBus,
  Map<string, PendingAssistantRuntimeRequest>
>()

function getAssistantRuntimeResponseBroker(responseBus: AssistantRuntimeResponseBus) {
  const existing = assistantRuntimeResponseBrokers.get(responseBus)
  if (existing) return existing

  const pending = new Map<string, PendingAssistantRuntimeRequest>()
  responseBus.on('assistant-runtime:response', (_event, response) => {
    const request = pending.get(response.id)
    if (!request) return

    pending.delete(response.id)
    clearTimeout(request.timeout)
    if (!response.ok) {
      request.reject(new Error(response.error))
      return
    }

    request.resolve(response.payload)
  })
  assistantRuntimeResponseBrokers.set(responseBus, pending)
  return pending
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
  const responseBroker = getAssistantRuntimeResponseBroker(responseBus)
  if (responseBroker.has(id)) {
    return Promise.reject(new Error(`Duplicate assistant runtime request id: ${id}`))
  }

  return new Promise((resolve, reject) => {
    let settled = false
    function cleanup() {
      responseBroker.delete(id)
      target.removeRuntimeReadyListener(sendRequest)
      target.webContents.removeListener('did-finish-load', sendRequest)
      target.webContents.removeListener('destroyed', handleTargetDestroyed)
    }

    function handleTargetDestroyed() {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      cleanup()
      reject(new Error('Assistant runtime target was destroyed.'))
    }

    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error('Assistant runtime request timed out.'))
    }, timeoutMs)

    responseBroker.set(id, {
      resolve: (payload) => {
        settled = true
        cleanup()
        resolve(payload as TPayload)
      },
      reject: (error) => {
        settled = true
        cleanup()
        reject(error)
      },
      timeout
    })

    function sendRequest() {
      if (settled) return
      target.removeRuntimeReadyListener(sendRequest)
      if (target.isDestroyed()) {
        handleTargetDestroyed()
        return
      }

      if (!target.isRuntimeReady()) {
        target.onceRuntimeReady(sendRequest)
        return
      }

      target.webContents.send('assistant-runtime:request', runtimeRequest)
    }

    target.webContents.once('destroyed', handleTargetDestroyed)
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
