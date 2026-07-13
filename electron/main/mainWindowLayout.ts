import { resolveMainWindowSizing } from './mainWindowOptions'

type WorkAreaSize = {
  width: number
  height: number
}

type MainWindowLayoutTarget = {
  center: () => void
  isMaximized?: () => boolean
  setMinimumSize: (width: number, height: number) => void
  setSize: (width: number, height: number) => void
  unmaximize?: () => void
}

export function restoreMainWindowDefaultLayoutSize(
  target: MainWindowLayoutTarget,
  workAreaSize: WorkAreaSize
) {
  const sizing = resolveMainWindowSizing(workAreaSize)

  if (target.isMaximized?.()) {
    target.unmaximize?.()
  }

  target.setMinimumSize(sizing.minWidth, sizing.minHeight)
  target.setSize(sizing.width, sizing.height)
  target.center()

  return sizing
}
