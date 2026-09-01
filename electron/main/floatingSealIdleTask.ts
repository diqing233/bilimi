export type FloatingSealIdleTaskHandle = {
  cancelled: boolean
  timer: ReturnType<typeof setTimeout>
  immediate?: NodeJS.Immediate
}

// Keep a real grace window between the main window becoming interactive and
// native pet work. The handle is cancellable so shutdown or an explicit close
// can prevent stale startup work from stealing the next input turn.
export const FLOATING_SEAL_IDLE_GRACE_MS = 250

/**
 * Schedule non-critical floating-seal work after a short, cancellable grace.
 *
 * The renderer releases the gate only from a browser idle callback.  The main
 * process then gets one independent turn of its own before creating or
 * polishing the native pet window.  Keeping the handle cancellable prevents a
 * stale readiness notification from creating a window after shutdown.
 */
export function scheduleFloatingSealIdleTask(callback: () => void): FloatingSealIdleTaskHandle {
  const handle: FloatingSealIdleTaskHandle = {
    cancelled: false,
    timer: undefined as unknown as ReturnType<typeof setTimeout>
  }
  handle.timer = setTimeout(() => {
    if (handle.cancelled) return
    handle.immediate = setImmediate(() => {
      if (!handle.cancelled) callback()
    })
  }, FLOATING_SEAL_IDLE_GRACE_MS)
  handle.timer.unref?.()
  return handle
}

export function cancelFloatingSealIdleTask(handle: FloatingSealIdleTaskHandle) {
  handle.cancelled = true
  clearTimeout(handle.timer)
  if (handle.immediate) clearImmediate(handle.immediate)
}
