import {
  createStartupInputScheduler,
  type StartupInputTaskEvent,
  type StartupInputTaskHandle
} from './startupInputScheduler'

export type FloatingSealIdleTaskHandle = StartupInputTaskHandle

const startupInputScheduler = createStartupInputScheduler({
  quietWindowMs: 160,
  onTaskStateChange: (event: StartupInputTaskEvent) => {
    if (process.env.BILIMI_STARTUP_DIAGNOSTICS === '1') {
      console.info(`[startup] background:${event.label}:${event.status}`)
    }
  }
})

export function scheduleFloatingSealIdleTask(
  callback: () => void | Promise<void>,
  label = 'floating-seal-background'
): FloatingSealIdleTaskHandle {
  return startupInputScheduler.schedule(callback, { label })
}

export function cancelFloatingSealIdleTask(handle: FloatingSealIdleTaskHandle) {
  handle.cancel()
}

export function noteStartupInputActivity() {
  startupInputScheduler.noteInputActivity()
}

export function disposeFloatingSealIdleTaskScheduler() {
  startupInputScheduler.dispose()
}
