type FavoriteLibraryWindow = {
  focus: () => void
  isDestroyed: () => boolean
  isVisible?: () => boolean
  show?: () => void
}

type FavoriteLibraryWebContents = {
  on: (event: 'will-navigate', listener: (event: { preventDefault: () => void }) => void) => void
  setWindowOpenHandler: (handler: () => { action: 'deny' }) => unknown
}

/** The library renderer never leaves its local route, preserving its read-only trust boundary. */
export function installFavoriteLibraryNavigationGuard(webContents: FavoriteLibraryWebContents) {
  webContents.on('will-navigate', (event) => event.preventDefault())
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
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
