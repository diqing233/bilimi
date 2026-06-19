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
    paintWhenInitiallyHidden: false,
    transparent: true,
    thickFrame: false,
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
