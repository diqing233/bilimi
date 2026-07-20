type FavoriteLibraryWindow = {
  focus: () => void
  isDestroyed: () => boolean
  isVisible?: () => boolean
  show?: () => void
}

type FavoriteLibraryWebContents = {
  once?: (event: 'did-finish-load', listener: () => void) => void
  on: (event: 'will-navigate', listener: (event: { preventDefault: () => void }) => void) => void
  setWindowOpenHandler: (handler: () => { action: 'deny' }) => unknown
}

type MainWindow = {
  getBounds: () => WorkAreaBounds
  setBounds: (bounds: WorkAreaBounds) => void
  isDestroyed: () => boolean
}

type WorkAreaBounds = { x: number; y: number; width: number; height: number }

const FAVORITE_LIBRARY_DEFAULT_WIDTH = 760

/** Keeps the library visible beside the main browser without adding a second app instance. */
export function createFavoriteLibraryWindowOptions(
  workArea: WorkAreaBounds,
  preload: string
): Electron.BrowserWindowConstructorOptions {
  const width = Math.min(FAVORITE_LIBRARY_DEFAULT_WIDTH, Math.max(620, Math.floor(workArea.width * 0.48)))

  return {
    x: workArea.x,
    y: workArea.y,
    width,
    height: workArea.height,
    minWidth: 620,
    minHeight: 560,
    title: '收藏库',
    autoHideMenuBar: true,
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: false,
      webviewTag: false
    }
  }
}

/** Reserves visible work area for the library and restores the main window when it closes. */
export class FavoriteLibrarySideBySideLayout {
  private mainBounds: WorkAreaBounds | null = null

  open(main: MainWindow | null | undefined, library: { getBounds: () => WorkAreaBounds }) {
    if (!main || main.isDestroyed()) return
    if (!this.mainBounds) this.mainBounds = main.getBounds()
    const libraryBounds = library.getBounds()
    const right = Math.max(420, this.mainBounds.width - libraryBounds.width)
    main.setBounds({ x: libraryBounds.x + libraryBounds.width, y: this.mainBounds.y, width: right, height: this.mainBounds.height })
  }

  close(main: MainWindow | null | undefined) {
    if (this.mainBounds && main && !main.isDestroyed()) main.setBounds(this.mainBounds)
    this.mainBounds = null
  }
}

/** The library renderer never leaves its local route, preserving its read-only trust boundary. */
export function installFavoriteLibraryNavigationGuard(webContents: FavoriteLibraryWebContents) {
  webContents.on('will-navigate', (event) => event.preventDefault())
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
}

/** Lets the local initial route load before denying every subsequent navigation. */
export function installFavoriteLibraryNavigationGuardAfterInitialLoad(webContents: FavoriteLibraryWebContents) {
  if (!webContents.once) {
    installFavoriteLibraryNavigationGuard(webContents)
    return
  }
  webContents.once('did-finish-load', () => installFavoriteLibraryNavigationGuard(webContents))
}

/** Keeps the library as one disposable window, never as a second data store. */
export class FavoriteLibraryWindowController<TWindow extends FavoriteLibraryWindow> {
  private currentWindow: TWindow | null = null

  constructor(private readonly createWindow: () => TWindow) {}

  getWindow() {
    return this.currentWindow
  }

  open() {
    if (this.currentWindow && !this.currentWindow.isDestroyed()) {
      if (this.currentWindow.isVisible?.() === false) this.currentWindow.show?.()
      this.currentWindow.focus()
      return this.currentWindow
    }
    this.currentWindow = this.createWindow()
    return this.currentWindow
  }

  clearIfCurrent(window: TWindow) {
    if (this.currentWindow === window) this.currentWindow = null
  }
}
