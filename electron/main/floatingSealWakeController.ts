type WakeableFloatingSealWindow = {
  hide: () => void
  isDestroyed: () => boolean
  showInactive: () => void
}

type FloatingSealWakeControllerOptions<TWindow extends WakeableFloatingSealWindow> = {
  createWindow: () => TWindow
  getWindow: () => TWindow | null
  prepareWindow: (window: TWindow) => void
  onShown?: (window: TWindow) => void
  scheduleCreate: (callback: () => void) => unknown
  cancelCreate: (handle: unknown) => void
}

export function createFloatingSealWakeController<TWindow extends WakeableFloatingSealWindow>({
  createWindow,
  getWindow,
  prepareWindow,
  onShown,
  scheduleCreate,
  cancelCreate
}: FloatingSealWakeControllerOptions<TWindow>) {
  let createScheduled = false
  let createHandle: unknown
  let displayRequested = false
  let pendingWake: Promise<void> | null = null
  let resolvePendingWake: (() => void) | null = null
  const readyWindows = new WeakSet<TWindow>()

  function getLiveWindow() {
    const current = getWindow()
    return current && !current.isDestroyed() ? current : null
  }

  function showWithoutActivation(window: TWindow) {
    if (window.isDestroyed()) return
    prepareWindow(window)
    window.showInactive()
    onShown?.(window)
  }

  return {
    wake() {
      displayRequested = true
      pendingWake ??= new Promise<void>((resolve) => { resolvePendingWake = resolve })
      const existing = getLiveWindow()
      if (existing) {
        if (readyWindows.has(existing)) {
          showWithoutActivation(existing)
          resolvePendingWake?.()
          resolvePendingWake = null
          const completed = pendingWake
          pendingWake = null
          return completed
        }
        return pendingWake
      }
      if (createScheduled) return pendingWake

      createScheduled = true
      createHandle = scheduleCreate(() => {
        createScheduled = false
        createHandle = undefined
        if (!displayRequested || getLiveWindow()) return
        createWindow()
      })
      return pendingWake
    },
    wakeImmediately() {
      displayRequested = true
      pendingWake ??= new Promise<void>((resolve) => { resolvePendingWake = resolve })
      const existing = getLiveWindow()
      if (existing) {
        if (readyWindows.has(existing)) {
          showWithoutActivation(existing)
          resolvePendingWake?.()
          resolvePendingWake = null
          const completed = pendingWake
          pendingWake = null
          return completed
        }
        return pendingWake
      }
      if (createScheduled) {
        createScheduled = false
        if (createHandle !== undefined) cancelCreate(createHandle)
        createHandle = undefined
      }
      createWindow()
      return pendingWake
    },
    close() {
      displayRequested = false
      if (createScheduled) {
        createScheduled = false
        if (createHandle !== undefined) cancelCreate(createHandle)
        createHandle = undefined
      }
      const existing = getWindow()
      if (existing && !existing.isDestroyed()) existing.hide()
      resolvePendingWake?.()
      resolvePendingWake = null
      pendingWake = null
    },
    cancelPendingWake() {
      displayRequested = false
      if (createScheduled) {
        createScheduled = false
        if (createHandle !== undefined) cancelCreate(createHandle)
        createHandle = undefined
      }
      resolvePendingWake?.()
      resolvePendingWake = null
      pendingWake = null
    },
    showWhenReady(window: TWindow) {
      readyWindows.add(window)
      if (!displayRequested || getWindow() !== window || window.isDestroyed()) return
      window.showInactive()
      onShown?.(window)
      resolvePendingWake?.()
      resolvePendingWake = null
      pendingWake = null
    }
  }
}
