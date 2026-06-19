type Bounds = {
  x: number
  y: number
  width: number
  height: number
}

export function createFloatingSealWindowOptions(
  bounds: Bounds,
  preload: string
): Electron.BrowserWindowConstructorOptions {
  return {
    ...bounds,
    title: '',
    frame: false,
    show: false,
    titleBarStyle: 'customButtonsOnHover',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#00000000',
      height: 0
    },
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: true,
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
