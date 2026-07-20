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
