import { setFloatingSealMouseTransparency } from './floatingSealMouseTransparency'

export type FloatingSealInteractiveRegion = {
  x: number
  y: number
  width: number
  height: number
}

type Point = { x: number; y: number }

type RecoveryWindow = {
  getBounds: () => { x: number; y: number; width: number; height: number }
  isDestroyed: () => boolean
  setIgnoreMouseEvents: (ignore: boolean, options?: { forward: boolean }) => void
}

type RecoveryControllerOptions = {
  getCursorPoint: () => Point
  schedulePoll: (callback: () => void, delayMs: number) => unknown
  cancelPoll: (handle: unknown) => void
  window: RecoveryWindow
}

const POLL_DELAY_MS = 80

export function createFloatingSealMouseRecoveryController({
  getCursorPoint,
  schedulePoll,
  cancelPoll,
  window
}: RecoveryControllerOptions) {
  let interactiveRegions: FloatingSealInteractiveRegion[] = []
  let pollHandle: unknown
  let transparent = false
  let visible = true

  function stopPolling() {
    if (pollHandle === undefined) return
    cancelPoll(pollHandle)
    pollHandle = undefined
  }

  function scheduleNextPoll() {
    if (!transparent || !visible || window.isDestroyed() || pollHandle !== undefined) return
    pollHandle = schedulePoll(() => {
      pollHandle = undefined
      restoreWhenCursorEntersInteractiveRegion()
      scheduleNextPoll()
    }, POLL_DELAY_MS)
  }

  function restoreWhenCursorEntersInteractiveRegion() {
    if (!transparent || window.isDestroyed()) return

    const cursor = getCursorPoint()
    const bounds = window.getBounds()
    const localX = cursor.x - bounds.x
    const localY = cursor.y - bounds.y
    const insideInteractiveRegion = interactiveRegions.some(
      (region) =>
        localX >= region.x &&
        localX < region.x + region.width &&
        localY >= region.y &&
        localY < region.y + region.height
    )

    if (!insideInteractiveRegion) return
    transparent = false
    stopPolling()
    setFloatingSealMouseTransparency(window, false)
  }

  return {
    dispose() {
      stopPolling()
      interactiveRegions = []
    },
    setTransparent(nextTransparent: boolean) {
      transparent = nextTransparent
      setFloatingSealMouseTransparency(window, nextTransparent)
      stopPolling()
      if (nextTransparent && visible) scheduleNextPoll()
    },
    setVisible(nextVisible: boolean) {
      visible = nextVisible
      stopPolling()
      if (visible && transparent) scheduleNextPoll()
    },
    updateInteractiveRegions(regions: unknown[]) {
      interactiveRegions = regions.flatMap((region) => {
        if (typeof region !== 'object' || region === null) return []
        const candidate = region as Partial<FloatingSealInteractiveRegion>
        if (
          !Number.isFinite(candidate.x) ||
          !Number.isFinite(candidate.y) ||
          !Number.isFinite(candidate.width) ||
          !Number.isFinite(candidate.height) ||
          Number(candidate.width) <= 0 ||
          Number(candidate.height) <= 0
        ) {
          return []
        }
        return [candidate as FloatingSealInteractiveRegion]
      })
    }
  }
}
