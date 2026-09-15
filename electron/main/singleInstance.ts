type SingleInstanceApp = {
  focus: (options?: { steal?: boolean }) => void
  isReady: () => boolean
  on: (eventName: 'second-instance', handler: () => void) => void
  quit: () => void
  requestSingleInstanceLock: () => boolean
}

type MainWindowTarget = {
  focus: () => void
  isDestroyed: () => boolean
  isMinimized: () => boolean
  restore: () => void
  show: () => void
}

export function installSingleInstanceGuard(
  app: SingleInstanceApp,
  getMainWindow: () => MainWindowTarget | null
) {
  let focusPending = false
  const focusMainWindow = () => {
    const window = getMainWindow()
    if (!window || window.isDestroyed()) {
      focusPending = true
      app.focus({ steal: true })
      return false
    }
    focusPending = false
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    return true
  }
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return false
  }

  app.on('second-instance', () => {
    focusMainWindow()
  })
  return { focusMainWindow, hasPendingFocus: () => focusPending }
}
