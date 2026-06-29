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
  on: (eventName: 'blur' | 'focus', listener: () => void) => void
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
}

export type FloatingWindowWhiteStripFixController = (() => void) & {
  recomposite: () => void
}

type FloatingWindowWhiteStripFixOptions = WhiteStripFixOptions & {
  platform?: NodeJS.Platform
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
export function createNudgePositions(bounds: Bounds): { nudged: Point; restored: Point } {
  return {
    nudged: { x: bounds.x + 1, y: bounds.y },
    restored: { x: bounds.x, y: bounds.y }
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
): FloatingWindowWhiteStripFixController {
  const schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs))
  const cancel = options.cancel ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>))

  let pendingTimers: unknown[] = []
  let anchor: Point | null = null

  const clearPending = () => {
    for (const timer of pendingTimers) {
      cancel(timer)
    }
    pendingTimers = []
  }

  const moveTo = (offset: 0 | 1) => {
    if (!anchor || target.isDestroyed()) {
      return
    }

    target.setPosition(anchor.x + offset, anchor.y)
  }

  const recomposite = () => {
    clearPending()

    if (target.isDestroyed()) {
      return
    }

    anchor = createNudgePositions(target.getBounds()).restored

    for (const step of createRecompositeSteps(options)) {
      const timer = schedule(() => {
        moveTo(step.offset)
      }, step.delayMs)
      pendingTimers.push(timer)
    }
  }

  const settle = () => {
    clearPending()
    moveTo(0)
  }

  target.on('blur', recomposite)
  target.on('focus', settle)

  const dispose = settle as FloatingWindowWhiteStripFixController
  dispose.recomposite = recomposite

  return dispose
}

export function installFloatingWindowWhiteStripFix(
  target: WhiteStripFixTarget,
  options: FloatingWindowWhiteStripFixOptions = {}
): FloatingWindowWhiteStripFixController | null {
  const platform = options.platform ?? process.platform

  if (platform !== 'win32') {
    return null
  }

  return installFloatingSealWhiteStripFix(target, options)
}
