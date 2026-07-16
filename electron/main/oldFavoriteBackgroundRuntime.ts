export type BackgroundThrottleWebContents = {
  id: number
  isDestroyed: () => boolean
  setBackgroundThrottling: (allowed: boolean) => void
}

type OldFavoriteBackgroundRuntimeOptions = {
  getMainWebContents: () => BackgroundThrottleWebContents | null | undefined
  getWebContentsById: (id: number) => BackgroundThrottleWebContents | null | undefined
}

export class OldFavoriteBackgroundRuntime {
  private running = false
  private executionTargetId: number | null = null

  constructor(private readonly options: OldFavoriteBackgroundRuntimeOptions) {}

  setRunning(running: boolean) {
    if (this.running === running) return
    this.running = running
    this.apply(this.options.getMainWebContents(), !running)
    if (this.executionTargetId !== null) {
      this.apply(this.options.getWebContentsById(this.executionTargetId), !running)
    }
    if (!running) this.executionTargetId = null
  }

  setExecutionTarget(webContentsId: number) {
    if (!Number.isInteger(webContentsId) || webContentsId <= 0 || this.executionTargetId === webContentsId) {
      return
    }
    if (this.running && this.executionTargetId !== null) {
      this.apply(this.options.getWebContentsById(this.executionTargetId), true)
    }
    this.executionTargetId = webContentsId
    if (this.running) {
      this.apply(this.options.getWebContentsById(webContentsId), false)
    }
  }

  snapshot() {
    return { running: this.running, executionTargetId: this.executionTargetId }
  }

  private apply(webContents: BackgroundThrottleWebContents | null | undefined, allowed: boolean) {
    if (!webContents || webContents.isDestroyed()) return
    webContents.setBackgroundThrottling(allowed)
  }
}
