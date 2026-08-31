type Point = {
  x: number
  y: number
}

type Bounds = Point & {
  width: number
  height: number
}

type WhiteStripFixTarget = {
  isDestroyed: () => boolean
  getBounds: () => Bounds
  setPosition: (x: number, y: number) => void
  on(eventName: 'blur', listener: () => void): unknown
  on(eventName: 'focus', listener: () => void): unknown
}

type RecompositeStep = {
  delayMs: number
  offset: 0 | 1
}

type RecompositeShape = {
  attempts?: number
  startDelayMs?: number
  attemptGapMs?: number
  holdMs?: number
}

type WhiteStripFixOptions = RecompositeShape & {
  schedule?: (callback: () => void, delayMs: number) => unknown
  cancel?: (timer: unknown) => void
  getWorkArea?: (bounds: Bounds) => Bounds
}

export type FloatingSealRecomposition = (() => void) & {
  recomposite: () => Promise<void>
}

const DEFAULT_ATTEMPTS = 3
const DEFAULT_START_DELAY_MS = 16
const DEFAULT_ATTEMPT_GAP_MS = 80
const DEFAULT_HOLD_MS = 16

/**
 * Windows DWM renders the native frame of a `transparent` window as an opaque
 * white strip while the window is deactivated (electron/electron #39959,
 * #47946). Physically moving the window invalidates that screen region and
 * forces DWM to repaint it transparently — an opacity toggle does not, because
 * it only re-blends the layered window without dirtying the frame region. We
 * move by one pixel and back so the fixed bounds guard (which only locks size)
 * never fights us, and we retry a few times because a single nudge can land
 * before DWM has painted the inactive frame.
 */
export function createNudgePositions(
  bounds: Bounds,
  workArea?: Bounds
): { nudged: Point; restored: Point } {
  const clampToRange = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), Math.max(min, max))
  const restored = workArea
    ? {
        x: clampToRange(bounds.x, workArea.x, workArea.x + workArea.width - bounds.width),
        y: clampToRange(bounds.y, workArea.y, workArea.y + workArea.height - bounds.height)
      }
    : { x: bounds.x, y: bounds.y }
  const nudgeX =
    workArea && restored.x + bounds.width >= workArea.x + workArea.width
      ? restored.x - 1
      : restored.x + 1

  return {
    nudged: { x: nudgeX, y: restored.y },
    restored
  }
}

export function createRecompositeSteps(shape: RecompositeShape = {}): RecompositeStep[] {
  const attempts = shape.attempts ?? DEFAULT_ATTEMPTS
  const startDelayMs = shape.startDelayMs ?? DEFAULT_START_DELAY_MS
  const attemptGapMs = shape.attemptGapMs ?? DEFAULT_ATTEMPT_GAP_MS
  const holdMs = shape.holdMs ?? DEFAULT_HOLD_MS

  const steps: RecompositeStep[] = []
  for (let index = 0; index < attempts; index += 1) {
    const attemptStart = startDelayMs + index * attemptGapMs
    steps.push({ delayMs: attemptStart, offset: 1 })
    steps.push({ delayMs: attemptStart + holdMs, offset: 0 })
  }

  return steps
}

export function installFloatingSealWhiteStripFix(
  target: WhiteStripFixTarget,
  options: WhiteStripFixOptions = {}
): FloatingSealRecomposition {
  const schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs))
  const cancel = options.cancel ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>))

  let pendingTimers: unknown[] = []
  let anchor: Point | null = null
  let nudgeDeltaX: -1 | 1 = 1
  let settlePendingRecomposition: (() => void) | null = null

  const clearPending = () => {
    for (const timer of pendingTimers) {
      cancel(timer)
    }
    pendingTimers = []
  }

  const settleRecomposition = () => {
    const settle = settlePendingRecomposition
    settlePendingRecomposition = null
    settle?.()
  }

  const cancelPendingRecomposition = () => {
    clearPending()
    settleRecomposition()
  }

  const moveTo = (offset: 0 | 1) => {
    if (!anchor || target.isDestroyed()) {
      return
    }

    target.setPosition(anchor.x + offset * nudgeDeltaX, anchor.y)
  }

  const recomposite = (): Promise<void> => {
    cancelPendingRecomposition()

    if (target.isDestroyed()) {
      return Promise.resolve()
    }

    const bounds = target.getBounds()
    const positions = createNudgePositions(bounds, options.getWorkArea?.(bounds))
    anchor = positions.restored
    nudgeDeltaX = positions.nudged.x < positions.restored.x ? -1 : 1

    const steps = createRecompositeSteps(options)
    return new Promise((resolve) => {
      settlePendingRecomposition = resolve
      let pendingStepCount = steps.length
      for (const step of steps) {
        const timer = schedule(() => {
          moveTo(step.offset)
          pendingStepCount -= 1
          if (pendingStepCount === 0) {
            pendingTimers = []
            settleRecomposition()
          }
        }, step.delayMs)
        pendingTimers.push(timer)
      }
    })
  }

  const settle = () => {
    cancelPendingRecomposition()
    moveTo(0)
  }

  target.on('blur', recomposite)
  target.on('focus', settle)

  const dispose = settle as FloatingSealRecomposition
  dispose.recomposite = recomposite
  return dispose
}
