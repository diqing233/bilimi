type FloatingWindow = {
  close: () => void
  isDestroyed: () => boolean
}

export class FloatingMenuController<TWindow extends FloatingWindow> {
  private currentWindow: TWindow | null = null

  constructor(private readonly createWindow: () => TWindow) {}

  getWindow() {
    return this.currentWindow
  }

  close() {
    const windowToClose = this.currentWindow
    this.currentWindow = null

    if (!windowToClose || windowToClose.isDestroyed()) {
      return
    }

    windowToClose.close()
  }

  toggle() {
    if (this.currentWindow && !this.currentWindow.isDestroyed()) {
      this.close()
      return null
    }

    this.currentWindow = this.createWindow()
    return this.currentWindow
  }

  clearIfCurrent(windowToClear: TWindow) {
    if (this.currentWindow === windowToClear) {
      this.currentWindow = null
    }
  }
}
