export type FloatingSealIdleTaskHandle = NodeJS.Immediate

/**
 * Schedule non-critical floating-seal work on the next event-loop turn.
 *
 * The renderer releases the gate only from a browser idle callback.  The main
 * process then gets one independent turn of its own before creating or
 * polishing the native pet window.  Keeping the handle cancellable prevents a
 * stale readiness notification from creating a window after shutdown.
 */
export function scheduleFloatingSealIdleTask(callback: () => void): FloatingSealIdleTaskHandle {
  return setImmediate(callback)
}

export function cancelFloatingSealIdleTask(handle: FloatingSealIdleTaskHandle) {
  clearImmediate(handle)
}
