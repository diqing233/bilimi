export type DeepSeekRetryDelay = (milliseconds: number, signal?: AbortSignal) => Promise<void>
export type DeepSeekRetryProgress = { attempt: number; totalAttempts: number; delayMs: number }

const LOCAL_DELAYS_MS = [2000, 6000]

function statusFromMessage(message: string): number | undefined {
  const match = message.match(/\b(429|502|503|504)\b/u)
  return match ? Number(match[1]) : undefined
}

function isCancellation(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof DOMException && error.name === 'AbortError')
}

function isTransient(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    'code' in error && error.code === 'api-error' &&
    'message' in error && typeof error.message === 'string' &&
    [429, 502, 503, 504].includes(statusFromMessage(error.message) ?? 0)
}

export async function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('The operation was aborted.', 'AbortError'))
    }, { once: true })
  })
}

export async function retryTransientDeepSeekRequest<T>(
  operation: () => Promise<T>,
  options: {
    delay?: DeepSeekRetryDelay
    signal?: AbortSignal
    retryDelaysMs?: readonly number[]
    onRetry?: (progress: DeepSeekRetryProgress) => void
  } = {}
): Promise<T> {
  const delay = options.delay ?? abortableDelay
  const retryDelaysMs = options.retryDelaysMs ?? LOCAL_DELAYS_MS
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (attempt >= retryDelaysMs.length || isCancellation(error, options.signal) || !isTransient(error)) {
        throw error
      }
      const delayMs = retryDelaysMs[attempt]
      options.onRetry?.({ attempt: attempt + 2, totalAttempts: retryDelaysMs.length + 1, delayMs })
      await delay(delayMs, options.signal)
    }
  }
}
