type FloatingWindow = {
  close: () => void
  focus?: () => void
  hide?: () => void
  isDestroyed: () => boolean
  isVisible?: () => boolean
  show?: () => void
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

  hide() {
    const windowToHide = this.currentWindow

    if (!windowToHide || windowToHide.isDestroyed()) {
      this.currentWindow = null
      return
    }

    if (windowToHide.hide) {
      windowToHide.hide()
      return
    }

    this.close()
  }

  toggle() {
    if (this.currentWindow && !this.currentWindow.isDestroyed()) {
      if (this.currentWindow.isVisible?.() === false) {
        this.showCurrentWindow(this.currentWindow)
        return this.currentWindow
      }

      if (this.currentWindow.hide) {
        this.currentWindow.hide()
        return null
      }

      this.close()
      return null
    }

    this.currentWindow = this.createWindow()
    return this.currentWindow
  }

  open() {
    if (this.currentWindow && !this.currentWindow.isDestroyed()) {
      this.showCurrentWindow(this.currentWindow)
      return this.currentWindow
    }

    this.currentWindow = this.createWindow()
    return this.currentWindow
  }

  private showCurrentWindow(windowToShow: TWindow) {
    if (windowToShow.isVisible?.() === false) {
      windowToShow.show?.()
    }

    windowToShow.focus?.()
  }

  clearIfCurrent(windowToClear: TWindow) {
    if (this.currentWindow === windowToClear) {
      this.currentWindow = null
    }
  }
}
