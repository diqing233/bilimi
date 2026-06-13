import { createFloatingSealDragPosition } from './floatingSealGeometry'

type Point = {
  x: number
  y: number
}

type Bounds = Point & {
  width: number
  height: number
}

type FloatingSealDragControllerOptions = {
  getCursorPoint: () => Point
  getSealBounds: () => Bounds
  moveSealTo: (position: Point) => void
  startInterval?: (callback: () => void, intervalMs: number) => NodeJS.Timeout | number
  stopInterval?: (timer: NodeJS.Timeout | number) => void
}

const DRAG_INTERVAL_MS = 16

export class FloatingSealDragController {
  private readonly getCursorPoint: () => Point
  private readonly getSealBounds: () => Bounds
  private readonly moveSealTo: (position: Point) => void
  private readonly startInterval: (callback: () => void, intervalMs: number) => NodeJS.Timeout | number
  private readonly stopInterval: (timer: NodeJS.Timeout | number) => void
  private dragSession: {
    startBounds: Bounds
    startCursor: Point
  } | null = null
  private timer: NodeJS.Timeout | number | null = null

  constructor({
    getCursorPoint,
    getSealBounds,
    moveSealTo,
    startInterval = setInterval,
    stopInterval = clearInterval
  }: FloatingSealDragControllerOptions) {
    this.getCursorPoint = getCursorPoint
    this.getSealBounds = getSealBounds
    this.moveSealTo = moveSealTo
    this.startInterval = startInterval
    this.stopInterval = stopInterval
  }

  start(startCursor: Point) {
    this.finish()
    this.dragSession = {
      startBounds: this.getSealBounds(),
      startCursor
    }
    this.timer = this.startInterval(() => this.tick(), DRAG_INTERVAL_MS)
  }

  tick() {
    if (!this.dragSession) {
      return
    }

    this.moveSealTo(
      createFloatingSealDragPosition({
        ...this.dragSession,
        currentCursor: this.getCursorPoint()
      })
    )
  }

  finish() {
    this.dragSession = null

    if (this.timer !== null) {
      this.stopInterval(this.timer)
      this.timer = null
    }
  }
}
