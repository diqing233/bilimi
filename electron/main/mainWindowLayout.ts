import { resolveMainWindowSizing } from './mainWindowOptions'

type WorkAreaSize = {
  width: number
  height: number
  x?: number
  y?: number
}

type MainWindowLayoutTarget = {
  center: () => void
  getBounds?: () => { x: number; y: number; width: number; height: number }
  isMaximized?: () => boolean
  setBounds?: (bounds: { x: number; y: number; width: number; height: number }) => void
  setMinimumSize: (width: number, height: number) => void
  setSize: (width: number, height: number) => void
  unmaximize?: () => void
}

export function restoreMainWindowDefaultLayoutSize(
  target: MainWindowLayoutTarget,
  workAreaSize: WorkAreaSize
) {
  const sizing = resolveMainWindowSizing(workAreaSize)
  const nextBounds = {
    x: (workAreaSize.x ?? 0) + Math.round((workAreaSize.width - sizing.width) / 2),
    y: (workAreaSize.y ?? 0) + Math.round((workAreaSize.height - sizing.height) / 2),
    width: sizing.width,
    height: sizing.height
  }

  if (target.isMaximized?.()) {
    target.unmaximize?.()
  }

  target.setMinimumSize(sizing.minWidth, sizing.minHeight)
  const currentBounds = target.getBounds?.()
  const alreadyAtTarget = currentBounds &&
    currentBounds.x === nextBounds.x &&
    currentBounds.y === nextBounds.y &&
    currentBounds.width === nextBounds.width &&
    currentBounds.height === nextBounds.height

  if (!alreadyAtTarget) {
    if (target.setBounds) {
      target.setBounds(nextBounds)
    } else {
      target.setSize(sizing.width, sizing.height)
      target.center()
    }
  }

  return sizing
}
