export type StartupInputTaskStatus =
  | 'queued'
  | 'deferred'
  | 'started'
  | 'cancelled'
  | 'failed'
  | 'completed'

export type StartupInputTaskEvent = {
  label: string
  status: StartupInputTaskStatus
}

export type StartupInputTaskHandle = {
  cancel: () => void
  status: () => StartupInputTaskStatus
}

type StartupInputSchedulerOptions = {
  quietWindowMs?: number
  now?: () => number
  onTaskStateChange?: (event: StartupInputTaskEvent) => void
}

type ScheduledTask = {
  execute: () => void | Promise<void>
  label: string
  status: StartupInputTaskStatus
  timer?: ReturnType<typeof setTimeout>
}

const DEFAULT_QUIET_WINDOW_MS = 160

/**
 * Runs optional startup work only after foreground activity has been quiet for
 * one whole window. Each stage creates a fresh quiet boundary, so native or
 * GPU-heavy work cannot bunch up behind a single renderer idle callback.
 */
export function createStartupInputScheduler({
  quietWindowMs = DEFAULT_QUIET_WINDOW_MS,
  now = Date.now,
  onTaskStateChange
}: StartupInputSchedulerOptions = {}) {
  const quietWindow = Math.max(0, quietWindowMs)
  const tasks = new Set<ScheduledTask>()
  let disposed = false
  let lastInputAt = now()
  let lastStageStartedAt = lastInputAt
  let activeTask: ScheduledTask | null = null

  function publish(task: ScheduledTask, status: StartupInputTaskStatus) {
    task.status = status
    try { onTaskStateChange?.({ label: task.label, status }) } catch { /* diagnostics must not affect scheduling */ }
  }

  function clearTaskTimer(task: ScheduledTask) {
    if (!task.timer) return
    clearTimeout(task.timer)
    task.timer = undefined
  }

  function nextEligibleAt() {
    return Math.max(lastInputAt + quietWindow, lastStageStartedAt + quietWindow)
  }

  function defer(task: ScheduledTask, announce: boolean) {
    if (disposed || task.status === 'cancelled' || task.status === 'completed') return
    clearTaskTimer(task)
    if (announce && task.status !== 'deferred') publish(task, 'deferred')
    const delay = Math.max(0, nextEligibleAt() - now())
    task.timer = setTimeout(() => {
      task.timer = undefined
      startWhenQuiet(task)
    }, delay)
    task.timer.unref?.()
  }

  function complete(task: ScheduledTask) {
    if (disposed) return
    if (task.status === 'completed' || task.status === 'failed') return
    if (task.status !== 'cancelled') publish(task, 'completed')
    tasks.delete(task)
    if (activeTask === task) activeTask = null
    for (const queuedTask of tasks) defer(queuedTask, true)
  }

  function fail(task: ScheduledTask) {
    if (disposed) return
    if (task.status === 'cancelled' || task.status === 'completed' || task.status === 'failed') return
    publish(task, 'failed')
    tasks.delete(task)
    if (activeTask === task) activeTask = null
    for (const queuedTask of tasks) defer(queuedTask, true)
  }

  function startWhenQuiet(task: ScheduledTask) {
    if (disposed || task.status === 'cancelled' || task.status === 'completed') return
    if (activeTask || now() < nextEligibleAt()) {
      defer(task, true)
      return
    }

    activeTask = task
    lastStageStartedAt = now()
    publish(task, 'started')
    try {
      const result = task.execute()
      if (result && typeof result.then === 'function') {
        void result.then(() => complete(task), () => fail(task))
      } else {
        complete(task)
      }
    } catch {
      fail(task)
    }
  }

  return {
    schedule(execute: () => void | Promise<void>, options: { label?: string } = {}): StartupInputTaskHandle {
      const task: ScheduledTask = {
        execute,
        label: options.label ?? 'startup-background-task',
        status: 'queued'
      }
      if (disposed) {
        task.status = 'cancelled'
        return { cancel() {}, status: () => task.status }
      }
      tasks.add(task)
      publish(task, 'queued')
      defer(task, false)

      return {
        cancel() {
          if (task.status === 'cancelled' || task.status === 'completed') return
          clearTaskTimer(task)
          tasks.delete(task)
          publish(task, 'cancelled')
          if (activeTask !== task) {
            for (const queuedTask of tasks) defer(queuedTask, true)
          }
        },
        status: () => task.status
      }
    },
    noteInputActivity() {
      if (disposed) return
      lastInputAt = now()
      for (const task of tasks) {
        if (task === activeTask) continue
        defer(task, true)
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const task of tasks) {
        clearTaskTimer(task)
        if (task !== activeTask && task.status !== 'completed') publish(task, 'cancelled')
      }
      tasks.clear()
      activeTask = null
    }
  }
}
