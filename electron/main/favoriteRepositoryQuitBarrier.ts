type QuitEvent = { preventDefault(): void }

export function createFavoriteRepositoryQuitBarrier(options: {
  hasPendingWrites: () => boolean
  flush: () => Promise<void>
  quit: () => void
  flushTimeoutMs?: number
}) {
  let flushing = false
  let allowQuit = false

  return (event: QuitEvent): void => {
    if (allowQuit || !options.hasPendingWrites()) return
    event.preventDefault()
    if (flushing) return
    flushing = true

    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      allowQuit = true
      options.quit()
    }
    const timeout = setTimeout(finish, options.flushTimeoutMs ?? 1_500)
    void options.flush().then(() => {
      clearTimeout(timeout)
      finish()
    }).catch(() => {
      clearTimeout(timeout)
      finish()
    })
  }
}
