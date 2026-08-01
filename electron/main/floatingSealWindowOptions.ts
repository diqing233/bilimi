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
    minWidth: bounds.width,
    maxWidth: bounds.width,
    minHeight: bounds.height,
    maxHeight: bounds.height,
    title: '',
    frame: false,
    show: false,
    paintWhenInitiallyHidden: false,
    transparent: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
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
    roundedCorners: false,
    // Win11 DWM_SYSTEMBACKDROP_TYPE = DWMSBT_NONE：
    // 显式禁用任何系统背景材质，避免 transparent+frameless 窗口失活时
    // DWM 把隐藏的非客户区（标题栏几何）刷成不透明白条（Electron #39959 / #47946）。
    // Win10 会忽略该字段，零副作用。
    backgroundMaterial: 'none',
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: true
    }
  }
}
