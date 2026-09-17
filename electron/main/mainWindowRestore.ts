type RestorableMainWindow = {
  focus: () => void
  isDestroyed: () => boolean
  isMinimized: () => boolean
  isVisible: () => boolean
  restore: () => void
  show: () => void
}

type RestorableFloatingPet = {
  isDestroyed: () => boolean
  moveTop: () => void
}

type RestoreMainWindowFromPetArgs<TWindow extends RestorableMainWindow> = {
  createMainWindow: () => TWindow
  floatingPet?: RestorableFloatingPet | null
  mainWindow: TWindow | null
}

export function restoreMainWindowFromPet<TWindow extends RestorableMainWindow>({
  createMainWindow,
  floatingPet,
  mainWindow
}: RestoreMainWindowFromPetArgs<TWindow>) {
  const activeWindow = !mainWindow || mainWindow.isDestroyed() ? createMainWindow() : mainWindow

  if (activeWindow.isMinimized()) {
    activeWindow.restore()
  }

  if (!activeWindow.isVisible()) {
    activeWindow.show()
  }

  activeWindow.focus()
  if (floatingPet && !floatingPet.isDestroyed()) {
    floatingPet.moveTop()
  }

  return activeWindow
}
