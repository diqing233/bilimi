export type FloatingSealIdleTaskHandle = ReturnType<typeof setTimeout>

/**
 * Schedule non-critical floating-seal work on a later event-loop turn.
 *
 * Keeping this behind a small cancellable adapter makes the startup gate
 * explicit and prevents a stale interactive-ready notification from creating
 * a native window after shutdown or a subsequent close request.
 */
export function scheduleFloatingSealIdleTask(callback: () => void): FloatingSealIdleTaskHandle {
  const handle = setTimeout(callback, 0)
  handle.unref?.()
  return handle
}

export function cancelFloatingSealIdleTask(handle: FloatingSealIdleTaskHandle) {
  clearTimeout(handle)
}
