type QuitEvent = { preventDefault(): void }

export function createOldFavoriteQuitBarrier(options: {
  shouldFlush?: () => boolean
  prepare: () => void
  flush: () => Promise<void>
  quit: () => void
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
    void options.flush().then(() => {
      allowQuit = true
      options.quit()
    }).catch(() => {
      flushing = false
    })
  }
}
