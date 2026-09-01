export type FloatingSealIdleTaskHandle = {
  cancelled: boolean
  timer?: ReturnType<typeof setTimeout>
  immediate?: NodeJS.Immediate
}

/**
 * Schedule non-critical floating-seal work after two independently cancellable
 * event-loop turns. The first immediate yields the current input turn; the
 * zero-delay timer yields once more before native work begins. There is no
 * guessed wall-clock grace period, so a busy renderer can keep its input queue
 * ahead of the optional pet task.
 *
 * The renderer releases the gate only from a browser idle callback.  The main
 * process then gets one independent turn of its own before creating or
 * polishing the native pet window.  Keeping the handle cancellable prevents a
 * stale readiness notification from creating a window after shutdown.
 */
export function scheduleFloatingSealIdleTask(callback: () => void): FloatingSealIdleTaskHandle {
  const handle: FloatingSealIdleTaskHandle = { cancelled: false }
  handle.immediate = setImmediate(() => {
    handle.immediate = undefined
    if (handle.cancelled) return
    handle.timer = setTimeout(() => {
      handle.timer = undefined
      if (!handle.cancelled) callback()
    }, 0)
    handle.timer.unref?.()
  })
  return handle
}

export function cancelFloatingSealIdleTask(handle: FloatingSealIdleTaskHandle) {
  handle.cancelled = true
  if (handle.timer) clearTimeout(handle.timer)
  if (handle.immediate) clearImmediate(handle.immediate)
}
