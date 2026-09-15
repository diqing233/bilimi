type FrameTaskSchedulerOptions = {
  requestFrame: (callback: FrameRequestCallback) => number
  cancelFrame: (handle: number) => void
}

export function createFrameTaskScheduler(options: FrameTaskSchedulerOptions) {
  let handle: number | undefined
  let latestTask: (() => void) | undefined

  return {
    schedule(task: () => void) {
      latestTask = task
      if (handle !== undefined) return
      handle = options.requestFrame(() => {
        handle = undefined
        const nextTask = latestTask
        latestTask = undefined
        nextTask?.()
      })
    },
    cancel() {
      if (handle !== undefined) options.cancelFrame(handle)
      handle = undefined
      latestTask = undefined
    }
  }
}
