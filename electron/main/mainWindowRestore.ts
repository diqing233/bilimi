type RestorableMainWindow = {
  focus: () => void
  isDestroyed: () => boolean
  isMinimized: () => boolean
  isVisible: () => boolean
  restore: () => void
  show: () => void
}

type RestoreMainWindowFromPetArgs<TWindow extends RestorableMainWindow> = {
  createMainWindow: () => TWindow
  mainWindow: TWindow | null
}

export function restoreMainWindowFromPet<TWindow extends RestorableMainWindow>({
  createMainWindow,
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

  return activeWindow
}
