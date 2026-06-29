type Bounds = {
  x: number
  y: number
  width: number
  height: number
}

type FloatingAssistantWindow = {
  on: (event: 'closed', callback: () => void) => void
  removeMenu: () => void
  setAlwaysOnTop: (flag: boolean, level?: 'floating') => void
  setVisibleOnAllWorkspaces: (
    visible: boolean,
    options?: { visibleOnFullScreen: boolean }
  ) => void
  show: () => void
  webContents: {
    once: (event: 'did-finish-load', callback: () => void) => void
  }
}

export function createFloatingAssistantWindowOptions({
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
    show: false,
    paintWhenInitiallyHidden: false,
    transparent: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    thickFrame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    roundedCorners: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false
    }
  }
}

export function configureFloatingAssistantWindow(
  assistant: FloatingAssistantWindow,
  onClosed: () => void
) {
  assistant.setAlwaysOnTop(true, 'floating')
  assistant.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  assistant.removeMenu()
  assistant.on('closed', onClosed)
  assistant.webContents.once('did-finish-load', () => {
    assistant.show()
  })
}
