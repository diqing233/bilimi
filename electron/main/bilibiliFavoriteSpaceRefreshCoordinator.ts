export type BilibiliFavoriteSpaceRefreshStatus = { status: 'idle' | 'pending' }

type FavoriteSpaceRefreshResult = {
  requested: number
  completed: number
  failed?: number
}

/**
 * Keeps the follow-up refresh separate from the confirmed Bilibili mutation.
 * A stale SPA or local projection can be retried without replaying that write.
 */
export class BilibiliFavoriteSpaceRefreshCoordinator {
  private readonly statuses = new Map<string, BilibiliFavoriteSpaceRefreshStatus>()
  private readonly running = new Map<string, Promise<BilibiliFavoriteSpaceRefreshStatus>>()

  constructor(private readonly options: {
    getCurrentAccountMid: () => Promise<string>
    refreshProjection: (accountMid: string) => Promise<unknown>
    refreshFavoriteSpacePages: (accountMid: string) => Promise<FavoriteSpaceRefreshResult>
    onStatusChange?: (accountMid: string, status: BilibiliFavoriteSpaceRefreshStatus) => void
  }) {}

  getStatus(accountMid: string): BilibiliFavoriteSpaceRefreshStatus {
    return this.statuses.get(normalizeAccountMid(accountMid)) ?? { status: 'idle' }
  }

  refresh(accountMid: string): Promise<BilibiliFavoriteSpaceRefreshStatus> {
    const account = normalizeAccountMid(accountMid)
    if (!account) return Promise.resolve({ status: 'idle' })
    const existing = this.running.get(account)
    if (existing) return existing
    const refresh = this.refreshUnsafe(account).finally(() => {
      if (this.running.get(account) === refresh) this.running.delete(account)
    })
    this.running.set(account, refresh)
    return refresh
  }

  retry(accountMid: string) {
    return this.refresh(accountMid)
  }

  private async refreshUnsafe(accountMid: string): Promise<BilibiliFavoriteSpaceRefreshStatus> {
    let currentAccountMid: string
    try {
      currentAccountMid = normalizeAccountMid(await this.options.getCurrentAccountMid())
    } catch {
      return this.setStatus(accountMid, { status: 'pending' })
    }
    if (currentAccountMid !== accountMid) return this.getStatus(accountMid)
    const [projection, pages] = await Promise.allSettled([
      Promise.resolve().then(() => this.options.refreshProjection(accountMid)),
      Promise.resolve().then(() => this.options.refreshFavoriteSpacePages(accountMid))
    ])
    // Never replace a pending status for an account that changed while the
    // page was reloading. Returning to that account retains its prior retry.
    try {
      currentAccountMid = normalizeAccountMid(await this.options.getCurrentAccountMid())
    } catch {
      return this.setStatus(accountMid, { status: 'pending' })
    }
    if (currentAccountMid !== accountMid) return this.getStatus(accountMid)
    const pagesFailed = pages.status === 'rejected' || (pages.status === 'fulfilled' && (pages.value.failed ?? 0) > 0)
    return this.setStatus(accountMid, projection.status === 'rejected' || pagesFailed ? { status: 'pending' } : { status: 'idle' })
  }

  private setStatus(accountMid: string, status: BilibiliFavoriteSpaceRefreshStatus) {
    const current = this.getStatus(accountMid)
    if (current.status === status.status) {
      // An explicit refresh can complete while the coordinator was already
      // idle (for example after a managed deletion deferral). Emit the
      // completion edge so renderer-side pending discovery work is consumed.
      if (status.status === 'idle') {
        try {
          this.options.onStatusChange?.(accountMid, status)
        } catch {
          // Status delivery must not make a confirmed remote mutation fail.
        }
      }
      return current
    }
    if (status.status === 'idle') this.statuses.delete(accountMid)
    else this.statuses.set(accountMid, status)
    try {
      this.options.onStatusChange?.(accountMid, status)
    } catch {
      // Status delivery must not make a confirmed remote mutation fail.
    }
    return status
  }
}

function normalizeAccountMid(value: string) {
  const accountMid = value.trim()
  return /^\d+$/.test(accountMid) && BigInt(accountMid) > 0n ? accountMid : ''
}
