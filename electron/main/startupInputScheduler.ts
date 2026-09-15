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

export type StartupInputActivity = 'pointer-move' | 'foreground'

type StartupInputSchedulerOptions = {
  quietWindowMs?: number
  now?: () => number
  onTaskStateChange?: (event: StartupInputTaskEvent) => void
}

type StartupInputTaskOptions = {
  label?: string
  minimumQuietWindowMs?: number
  minimumDelayMs?: number
  ignorePointerMove?: boolean
  allowConcurrent?: boolean
  reportDiagnostics?: boolean
}

type ScheduledTask = {
  execute: () => void | Promise<void>
  label: string
  minimumQuietWindowMs: number
  minimumDelayMs: number
  ignorePointerMove: boolean
  allowConcurrent: boolean
  reportDiagnostics: boolean
  scheduledAt: number
  scheduledForegroundInputVersion: number
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
  let lastForegroundInputAt = lastInputAt
  let foregroundInputVersion = 0
  let lastStageStartedAt = lastInputAt
  let activeTask: ScheduledTask | null = null

  function publish(task: ScheduledTask, status: StartupInputTaskStatus) {
    task.status = status
    if (!task.reportDiagnostics) return
    try { onTaskStateChange?.({ label: task.label, status }) } catch { /* diagnostics must not affect scheduling */ }
  }

  function clearTaskTimer(task: ScheduledTask) {
    if (!task.timer) return
    clearTimeout(task.timer)
    task.timer = undefined
  }

  function nextEligibleAt(task: ScheduledTask) {
    const taskQuietWindow = task.allowConcurrent
      ? task.minimumQuietWindowMs
      : Math.max(quietWindow, task.minimumQuietWindowMs)
    const inputBoundary = task.ignorePointerMove ? lastForegroundInputAt : lastInputAt
    const foregroundQuietBoundary = task.allowConcurrent
      ? task.scheduledForegroundInputVersion === foregroundInputVersion
        ? 0
        : lastForegroundInputAt + quietWindow
      : inputBoundary + taskQuietWindow
    return Math.max(
      foregroundQuietBoundary,
      task.scheduledAt + task.minimumDelayMs,
      ...(task.allowConcurrent ? [] : [lastStageStartedAt + quietWindow])
    )
  }

  function defer(task: ScheduledTask, announce: boolean) {
    if (disposed || task.status === 'cancelled' || task.status === 'completed') return
    clearTaskTimer(task)
    if (announce && task.status !== 'deferred') publish(task, 'deferred')
    const delay = Math.max(0, nextEligibleAt(task) - now())
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
    if ((activeTask && !task.allowConcurrent) || now() < nextEligibleAt(task)) {
      defer(task, true)
      return
    }

    if (!task.allowConcurrent) {
      activeTask = task
      lastStageStartedAt = now()
    }
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
    schedule(execute: () => void | Promise<void>, options: StartupInputTaskOptions = {}): StartupInputTaskHandle {
      const task: ScheduledTask = {
        execute,
        label: options.label ?? 'startup-background-task',
        minimumQuietWindowMs: Math.max(0, options.minimumQuietWindowMs ?? quietWindow),
        minimumDelayMs: Math.max(0, options.minimumDelayMs ?? 0),
        ignorePointerMove: options.ignorePointerMove === true,
        allowConcurrent: options.allowConcurrent === true,
        reportDiagnostics: options.reportDiagnostics !== false,
        scheduledAt: now(),
        scheduledForegroundInputVersion: foregroundInputVersion,
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
    noteInputActivity(activity: StartupInputActivity = 'foreground') {
      if (disposed) return
      const inputAt = now()
      lastInputAt = inputAt
      if (activity === 'foreground') lastForegroundInputAt = inputAt
      if (activity === 'foreground') foregroundInputVersion += 1
      for (const task of tasks) {
        if (task === activeTask) continue
        if (activity === 'pointer-move' && task.ignorePointerMove) continue
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
