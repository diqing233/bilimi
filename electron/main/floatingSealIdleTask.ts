export type FloatingSealIdleTaskHandle = ReturnType<typeof setTimeout>

// This grace window is only entered after the main renderer and the home
// Bilibili guest have settled. It gives Windows one additional input turn
// before Chromium/native pet work begins, while remaining cancellable.
export const FLOATING_SEAL_IDLE_GRACE_MS = 250

/**
 * Schedule non-critical floating-seal work on a later event-loop turn.
 *
 * Keeping this behind a small cancellable adapter makes the startup gate
 * explicit and prevents a stale interactive-ready notification from creating
 * a native window after shutdown or a subsequent close request.
 */
export function scheduleFloatingSealIdleTask(callback: () => void): FloatingSealIdleTaskHandle {
  const handle = setTimeout(callback, FLOATING_SEAL_IDLE_GRACE_MS)
  handle.unref?.()
  return handle
}

export function cancelFloatingSealIdleTask(handle: FloatingSealIdleTaskHandle) {
  clearTimeout(handle)
}
