export type BrowserCrashRecoveryAction = { action: 'reload' | 'show-error' }

export function createBrowserCrashRecoveryTracker(windowMs = 10_000) {
  const lastAutomaticReload = new Map<string, number>()

  return {
    recordCrash(id: string, now = Date.now()): BrowserCrashRecoveryAction {
      const lastCrash = lastAutomaticReload.get(id)
      if (lastCrash !== undefined && now - lastCrash <= windowMs) {
        return { action: 'show-error' }
      }

      lastAutomaticReload.set(id, now)
      return { action: 'reload' }
    },
    reset(id: string): void {
      lastAutomaticReload.delete(id)
    }
  }
}
