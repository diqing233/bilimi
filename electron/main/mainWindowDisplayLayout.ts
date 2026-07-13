import { resolveMainWindowSizing } from './mainWindowOptions'

type Bounds = {
  x: number
  y: number
  width: number
  height: number
}

type DisplayLike = {
  id: number
  workArea: Bounds
  workAreaSize: Pick<Bounds, 'width' | 'height'>
}

type MainWindowTarget = {
  getBounds: () => Bounds
  isDestroyed: () => boolean
  isMaximized: () => boolean
  on: (event: 'move', listener: () => void) => unknown
  off: (event: 'move', listener: () => void) => unknown
  setBounds: (bounds: Bounds) => void
  setMinimumSize: (width: number, height: number) => void
}

type ScreenTarget = {
  getDisplayMatching: (bounds: Bounds) => DisplayLike
  on: (event: string, listener: () => void) => unknown
  off: (event: string, listener: () => void) => unknown
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function fitBoundsInsideWorkArea(bounds: Bounds, workArea: Bounds): Bounds {
  const width = Math.min(bounds.width, workArea.width)
  const height = Math.min(bounds.height, workArea.height)

  return {
    x: clamp(bounds.x, workArea.x, workArea.x + workArea.width - width),
    y: clamp(bounds.y, workArea.y, workArea.y + workArea.height - height),
    width,
    height
  }
}

function boundsEqual(left: Bounds, right: Bounds) {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  )
}

export function applyMainWindowDisplayLayout(target: MainWindowTarget, display: DisplayLike) {
  const sizing = resolveMainWindowSizing(display.workAreaSize)
  target.setMinimumSize(sizing.minWidth, sizing.minHeight)

  if (target.isMaximized()) {
    return
  }

  const currentBounds = target.getBounds()
  const nextBounds = fitBoundsInsideWorkArea(currentBounds, display.workArea)

  if (!boundsEqual(currentBounds, nextBounds)) {
    target.setBounds(nextBounds)
  }
}

export function installMainWindowDisplayLayout(
  target: MainWindowTarget,
  screenTarget: ScreenTarget
) {
  let currentDisplayId: number | null = null

  const syncDisplayLayout = (force = false) => {
    if (target.isDestroyed()) {
      return
    }

    const display = screenTarget.getDisplayMatching(target.getBounds())
    if (!force && display.id === currentDisplayId) {
      return
    }

    currentDisplayId = display.id
    applyMainWindowDisplayLayout(target, display)
  }

  const handleMove = () => syncDisplayLayout()
  const handleDisplayChange = () => syncDisplayLayout(true)
  const screenEvents = ['display-metrics-changed', 'display-added', 'display-removed']

  target.on('move', handleMove)
  for (const event of screenEvents) {
    screenTarget.on(event, handleDisplayChange)
  }
  syncDisplayLayout(true)

  return () => {
    target.off('move', handleMove)
    for (const event of screenEvents) {
      screenTarget.off(event, handleDisplayChange)
    }
  }
}
