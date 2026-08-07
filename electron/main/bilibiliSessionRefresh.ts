type RefreshableGuestPage = {
  getType(): string
  isDestroyed(): boolean
  session: unknown
  once(event: 'did-finish-load' | 'did-fail-load' | 'destroyed', listener: () => void): void
  removeListener(event: 'did-finish-load' | 'did-fail-load' | 'destroyed', listener: () => void): void
  reloadIgnoringCache(): void
}

export async function refreshBilibiliGuestPages(options: {
  getAllWebContents(): RefreshableGuestPage[]
  targetSession: unknown
  timeoutMs?: number
}) {
  const guests = options.getAllWebContents().filter((page) =>
    !page.isDestroyed() && page.getType() === 'webview' && page.session === options.targetSession
  )
  await Promise.all(guests.map((page) => reloadAndWait(page, options.timeoutMs ?? 10_000)))
  return { requested: guests.length, completed: guests.length }
}

function reloadAndWait(page: RefreshableGuestPage, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      page.removeListener('did-finish-load', finish)
      page.removeListener('did-fail-load', finish)
      page.removeListener('destroyed', finish)
      resolve()
    }
    const timeout = setTimeout(finish, timeoutMs)
    page.once('did-finish-load', finish)
    page.once('did-fail-load', finish)
    page.once('destroyed', finish)
    try {
      page.reloadIgnoringCache()
    } catch {
      finish()
    }
  })
}
