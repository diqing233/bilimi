import { createFixedFloatingSealBounds } from './floatingSealGeometry'

type Bounds = {
  x: number
  y: number
  width: number
  height: number
}

type FixedFloatingSealBoundsTarget = {
  getBounds: () => Bounds
  setBounds: (bounds: Bounds) => void
  setMinimumSize: (width: number, height: number) => void
  setMaximumSize: (width: number, height: number) => void
}

type FixedFloatingSealBoundsGuardTarget = FixedFloatingSealBoundsTarget & {
  isDestroyed: () => boolean
  on(eventName: 'resize', listener: () => void): unknown
  on(eventName: 'show', listener: () => void): unknown
}

export function enforceFixedFloatingSealBounds(target: FixedFloatingSealBoundsTarget) {
  const currentBounds = target.getBounds()
  const fixedBounds = createFixedFloatingSealBounds({ startBounds: currentBounds })

  target.setMinimumSize(fixedBounds.width, fixedBounds.height)
  target.setMaximumSize(fixedBounds.width, fixedBounds.height)

  if (currentBounds.width === fixedBounds.width && currentBounds.height === fixedBounds.height) {
    return
  }

  target.setBounds(fixedBounds)
}

export function installFixedFloatingSealBoundsGuard(target: FixedFloatingSealBoundsGuardTarget) {
  let correctingBounds = false

  const enforceBounds = () => {
    if (target.isDestroyed() || correctingBounds) {
      return
    }

    correctingBounds = true
    try {
      enforceFixedFloatingSealBounds(target)
    } finally {
      correctingBounds = false
    }
  }

  enforceBounds()
  target.on('resize', enforceBounds)
  target.on('show', enforceBounds)

  return enforceBounds
}
