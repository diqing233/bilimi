type ToggleableMainWindow = {
  focus: () => void
  isDestroyed: () => boolean
  isMinimized: () => boolean
  isVisible: () => boolean
  restore: () => void
  show: () => void
}

type ToggleFloatingMenuFromSealArgs<TWindow extends ToggleableMainWindow> = {
  createMainWindow: () => TWindow
  mainWindow: TWindow | null
  toggleFloatingMenu: () => void
}

type ToggleFloatingAssistantFromSealArgs<TWindow extends ToggleableMainWindow> = {
  createMainWindow: () => TWindow
  mainWindow: TWindow | null
  toggleFloatingAssistant: () => void
}

type ToggleFloatingWindowFromSealArgs<TWindow extends ToggleableMainWindow> = {
  createMainWindow: () => TWindow
  mainWindow: TWindow | null
  toggleFloatingWindow: () => void
}

function toggleFloatingWindowFromSeal<TWindow extends ToggleableMainWindow>({
  createMainWindow,
  mainWindow,
  toggleFloatingWindow
}: ToggleFloatingWindowFromSealArgs<TWindow>) {
  const activeWindow = !mainWindow || mainWindow.isDestroyed() ? createMainWindow() : mainWindow

  if (activeWindow.isMinimized()) {
    activeWindow.restore()
  }

  if (!activeWindow.isVisible()) {
    activeWindow.show()
  }

  activeWindow.focus()
  toggleFloatingWindow()

  return activeWindow
}

export function toggleFloatingMenuFromSeal<TWindow extends ToggleableMainWindow>({
  createMainWindow,
  mainWindow,
  toggleFloatingMenu
}: ToggleFloatingMenuFromSealArgs<TWindow>) {
  return toggleFloatingWindowFromSeal({
    createMainWindow,
    mainWindow,
    toggleFloatingWindow: toggleFloatingMenu
  })
}

export function toggleFloatingAssistantFromSeal<TWindow extends ToggleableMainWindow>({
  createMainWindow,
  mainWindow,
  toggleFloatingAssistant
}: ToggleFloatingAssistantFromSealArgs<TWindow>) {
  return toggleFloatingWindowFromSeal({
    createMainWindow,
    mainWindow,
    toggleFloatingWindow: toggleFloatingAssistant
  })
}
