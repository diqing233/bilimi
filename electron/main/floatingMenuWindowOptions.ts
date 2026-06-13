type Bounds = {
  x: number
  y: number
  width: number
  height: number
}

type FloatingMenuWindow = {
  on: (event: 'closed', callback: () => void) => void
  removeMenu: () => void
  setAlwaysOnTop: (flag: boolean, level?: 'floating') => void
  setVisibleOnAllWorkspaces: (
    visible: boolean,
    options?: { visibleOnFullScreen: boolean }
  ) => void
}

export function createFloatingMenuWindowOptions({
  bounds,
  preload
}: {
  bounds: Bounds
  preload: string
}): Electron.BrowserWindowConstructorOptions {
  return {
    ...bounds,
    title: '',
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: false
    }
  }
}

export function configureFloatingMenuWindow(
  menu: FloatingMenuWindow,
  onClosed: () => void
) {
  menu.setAlwaysOnTop(true, 'floating')
  menu.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  menu.removeMenu()
  menu.on('closed', onClosed)
}
