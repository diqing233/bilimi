type WakeableFloatingSealWindow = {
  close: () => void
  isDestroyed: () => boolean
  showInactive: () => void
}

type FloatingSealWakeControllerOptions<TWindow extends WakeableFloatingSealWindow> = {
  createWindow: () => TWindow
  getWindow: () => TWindow | null
  prepareWindow: (window: TWindow) => void
  scheduleCreate: (callback: () => void) => unknown
  cancelCreate: (handle: unknown) => void
}

export function createFloatingSealWakeController<TWindow extends WakeableFloatingSealWindow>({
  createWindow,
  getWindow,
  prepareWindow,
  scheduleCreate,
  cancelCreate
}: FloatingSealWakeControllerOptions<TWindow>) {
  let createScheduled = false
  let createHandle: unknown
  let displayRequested = false
  const readyWindows = new WeakSet<TWindow>()

  function showWithoutActivation(window: TWindow) {
    if (window.isDestroyed()) return
    prepareWindow(window)
    window.showInactive()
  }

  return {
    wake() {
      displayRequested = true
      const existing = getWindow()
      if (existing && !existing.isDestroyed()) {
        if (readyWindows.has(existing)) showWithoutActivation(existing)
        return
      }
      if (createScheduled) return

      createScheduled = true
      createHandle = scheduleCreate(() => {
        createScheduled = false
        createHandle = undefined
        if (!displayRequested) return
        createWindow()
      })
    },
    close() {
      displayRequested = false
      if (createScheduled) {
        createScheduled = false
        if (createHandle !== undefined) cancelCreate(createHandle)
        createHandle = undefined
      }
      const existing = getWindow()
      if (existing && !existing.isDestroyed()) existing.close()
    },
    showWhenReady(window: TWindow) {
      readyWindows.add(window)
      if (!displayRequested || getWindow() !== window || window.isDestroyed()) return
      window.showInactive()
    }
  }
}
