type RefreshableGuestPage = {
  getType(): string
  getURL(): string
  isDestroyed(): boolean
  session: unknown
  once(event: 'did-finish-load' | 'did-fail-load' | 'destroyed', listener: () => void): void
  removeListener(event: 'did-finish-load' | 'did-fail-load' | 'destroyed', listener: () => void): void
  reloadIgnoringCache(): void
}

type FavoriteSpaceRefreshResult = { requested: number; completed: number; failed?: number }

const favoriteSpaceRefreshes = new Map<string, Promise<FavoriteSpaceRefreshResult>>()

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

/**
 * Bilibili's personal-space favorite list is a SPA and can retain folder
 * counts after a successful folder write. Refresh only that page for the
 * account which performed the confirmed operation; video and other Bilibili
 * tabs must retain their current state.
 */
export function refreshBilibiliFavoriteSpacePages(options: {
  getAllWebContents(): RefreshableGuestPage[]
  targetSession: unknown
  accountMid: string
  timeoutMs?: number
}) {
  const accountMid = options.accountMid.trim()
  if (!/^\d+$/.test(accountMid) || BigInt(accountMid) === 0n) {
    return Promise.resolve({ requested: 0, completed: 0 })
  }
  const existing = favoriteSpaceRefreshes.get(accountMid)
  if (existing) return existing
  const refresh = Promise.all(options.getAllWebContents()
    .filter((page) => isFavoriteSpacePageForAccount(page, options.targetSession, accountMid))
    .map(async (page) => {
      // The user can leave the SPA between discovery and this queued refresh.
      // Recheck immediately before reloading so a video or another account
      // page never receives the stale folder-mutation refresh.
      if (!isFavoriteSpacePageForAccount(page, options.targetSession, accountMid)) return 'skipped' as const
      return await reloadAndWait(page, options.timeoutMs ?? 10_000) ? 'completed' as const : 'failed' as const
    }))
    .then((reloaded) => {
      const completed = reloaded.filter((result) => result === 'completed').length
      const failed = reloaded.filter((result) => result === 'failed').length
      const requested = completed + failed
      return failed ? { requested, completed, failed } : { requested, completed }
    })
    .finally(() => {
      if (favoriteSpaceRefreshes.get(accountMid) === refresh) favoriteSpaceRefreshes.delete(accountMid)
    })
  favoriteSpaceRefreshes.set(accountMid, refresh)
  return refresh
}

function isFavoriteSpacePageForAccount(page: RefreshableGuestPage, targetSession: unknown, accountMid: string) {
  if (page.isDestroyed() || page.getType() !== 'webview' || page.session !== targetSession) return false
  try {
    const url = new URL(page.getURL())
    return url.protocol === 'https:' && url.hostname === 'space.bilibili.com' &&
      url.pathname.startsWith(`/${accountMid}/favlist`)
  } catch {
    return false
  }
}

function reloadAndWait(page: RefreshableGuestPage, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (didComplete: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      page.removeListener('did-finish-load', completed)
      page.removeListener('did-fail-load', failed)
      page.removeListener('destroyed', failed)
      resolve(didComplete)
    }
    const completed = () => finish(true)
    const failed = () => finish(false)
    const timeout = setTimeout(failed, timeoutMs)
    page.once('did-finish-load', completed)
    page.once('did-fail-load', failed)
    page.once('destroyed', failed)
    try {
      page.reloadIgnoringCache()
    } catch {
      failed()
    }
  })
}
