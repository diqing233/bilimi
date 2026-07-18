type QuitEvent = { preventDefault(): void }

export function shouldFlushOldFavoriteOnQuit(
  persistenceDirty: boolean,
  rendererDirty: boolean,
  openedSessionStore?: { load: () => { lease: unknown } }
): boolean {
  if (persistenceDirty || rendererDirty) return true
  return Boolean(openedSessionStore?.load().lease)
}

export function createOldFavoriteQuitBarrier(options: {
  shouldFlush?: () => boolean
  prepare: () => void
  flush: () => Promise<void>
  quit: () => void
  flushTimeoutMs?: number
}) {
  let flushing = false
  let allowQuit = false

  return (event: QuitEvent): void => {
    if (allowQuit) return
    if (options.shouldFlush && !options.shouldFlush()) return
    event.preventDefault()
    if (flushing) return
    flushing = true
    options.prepare()
    let settled = false
    const finishQuit = () => {
      if (settled) return
      settled = true
      allowQuit = true
      options.quit()
    }
    const timeout = setTimeout(finishQuit, options.flushTimeoutMs ?? 1_500)
    void options.flush().then(() => {
      clearTimeout(timeout)
      finishQuit()
    }).catch(() => {
      clearTimeout(timeout)
      finishQuit()
    })
  }
}
