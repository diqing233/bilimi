type Bounds = {
  x: number
  y: number
  width: number
  height: number
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
