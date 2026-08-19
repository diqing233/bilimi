type DeepSeekTask<T> = {
  run: (signal?: AbortSignal) => Promise<T>
  signal?: AbortSignal
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
  started: boolean
  onAbort?: () => void
}
function createAbortError() {
  const error = new Error('DeepSeek task canceled.')
  error.name = 'AbortError'
  return error
}

export function createDeepSeekTaskQueue() {
  const pending: DeepSeekTask<unknown>[] = []
  let running = false

  function drain() {
    if (running) return
    const next = pending.shift()
    if (!next) return
    if (next.signal?.aborted) {
      next.reject(createAbortError())
      drain()
      return
    }

    running = true
    next.started = true
    if (next.signal && next.onAbort) next.signal.removeEventListener('abort', next.onAbort)
    void next.run(next.signal).then(next.resolve, next.reject).finally(() => {
      running = false
      drain()
    })
  }

  return {
    run<T>(task: (signal?: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
      if (signal?.aborted) return Promise.reject(createAbortError())
      return new Promise<T>((resolve, reject) => {
        const entry: DeepSeekTask<T> = {
          run: task,
          signal,
          resolve,
          reject,
          started: false
        }
        if (signal) {
          entry.onAbort = () => {
            if (entry.started) return
            const index = pending.indexOf(entry as DeepSeekTask<unknown>)
            if (index >= 0) pending.splice(index, 1)
            reject(createAbortError())
          }
          signal.addEventListener('abort', entry.onAbort, { once: true })
        }
        pending.push(entry as DeepSeekTask<unknown>)
        drain()
      })
    }
  }
}
