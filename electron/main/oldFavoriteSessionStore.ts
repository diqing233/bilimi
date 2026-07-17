import {
  normalizeOldFavoriteSessionsForShutdown,
  OLD_FAVORITE_SESSIONS_VERSION,
  type OldFavoriteTaskKind,
  type OldFavoriteSessionsState
} from '../../src/shared/oldFavoriteSessions'

const STORE_KEY = 'oldFavoriteSessions'

export interface OldFavoriteSessionStoreBackend {
  get(key: string): unknown
  set(key: string, value: unknown): void
  flush?(): Promise<void>
}

function emptyState(): OldFavoriteSessionsState {
  return { version: OLD_FAVORITE_SESSIONS_VERSION, batches: [], lease: null }
}

export function isCurrentOldFavoriteSessionsState(value: unknown): value is OldFavoriteSessionsState {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<OldFavoriteSessionsState>
  return candidate.version === OLD_FAVORITE_SESSIONS_VERSION &&
    Array.isArray(candidate.batches) &&
    candidate.batches.every((batch) => {
      if (!batch || typeof batch !== 'object') return false
      const record = batch as Record<string, unknown>
      return typeof record.id === 'string' && typeof record.accountMid === 'string' &&
        ['full', 'incremental'].includes(String(record.kind)) && typeof record.createdAt === 'string' &&
        ['active', 'ended'].includes(String(record.status)) && Array.isArray(record.segments) &&
        record.segments.every((segment) => {
          if (!segment || typeof segment !== 'object') return false
          const item = segment as Record<string, unknown>
          return typeof item.id === 'string' && Number.isSafeInteger(item.index) &&
            Array.isArray(item.aids) && item.aids.every((aid) => Number.isSafeInteger(aid) && Number(aid) > 0) &&
            ['pending', 'running', 'paused', 'ready', 'ended'].includes(String(item.status))
        }) && Boolean(record.snapshot && typeof record.snapshot === 'object')
    }) && (candidate.lease === null || Boolean(candidate.lease && typeof candidate.lease === 'object'))
}

export class OldFavoriteSessionStore {
  constructor(private readonly backend: OldFavoriteSessionStoreBackend) {}

  load(): OldFavoriteSessionsState {
    const stored = this.backend.get(STORE_KEY)
    return isCurrentOldFavoriteSessionsState(stored) ? structuredClone(stored) : emptyState()
  }

  save(state: OldFavoriteSessionsState): void {
    if (!isCurrentOldFavoriteSessionsState(state)) {
      throw new Error('Old favorite session state is invalid.')
    }
    const current = this.load()
    const incomingIds = new Set(state.batches.map((batch) => batch.id))
    this.backend.set(STORE_KEY, structuredClone({
      ...state,
      batches: [
        ...state.batches,
        ...current.batches.filter((batch) => !incomingIds.has(batch.id))
      ],
      lease: current.lease
    }))
  }

  claimLease(
    batchId: string,
    segmentId: string,
    task: OldFavoriteTaskKind,
    accountMid: string,
    ownerId: number
  ): boolean {
    const state = this.load()
    const batch = state.batches.find((candidate) => candidate.id === batchId)
    if (
      state.lease ||
      !batch ||
      batch.status !== 'active' ||
      batch.accountMid !== accountMid.trim() ||
      !batch.segments.some((segment) => segment.id === segmentId)
    ) {
      return false
    }

    this.backend.set(STORE_KEY, structuredClone({
      ...state,
      lease: { batchId, segmentId, task, ownerId }
    }))
    return true
  }

  releaseLease(batchId: string, segmentId: string, ownerId: number): boolean {
    const state = this.load()
    if (
      state.lease?.batchId !== batchId ||
      state.lease.segmentId !== segmentId ||
      state.lease.ownerId !== ownerId
    ) {
      return false
    }

    this.backend.set(STORE_KEY, structuredClone({ ...state, lease: null }))
    return true
  }

  saveForShutdown(state: OldFavoriteSessionsState): void {
    this.backend.set(STORE_KEY, structuredClone(normalizeOldFavoriteSessionsForShutdown(state)))
  }

  resetAccount(accountMid: string): OldFavoriteSessionsState {
    const normalized = accountMid.trim()
    const state = this.load()
    const removedIds = new Set(
      state.batches.filter((batch) => batch.accountMid === normalized).map((batch) => batch.id)
    )
    const next = {
      ...state,
      batches: state.batches.filter((batch) => batch.accountMid !== normalized),
      lease: state.lease && removedIds.has(state.lease.batchId) ? null : state.lease
    }
    this.backend.set(STORE_KEY, structuredClone(next))
    return next
  }

  flush(): Promise<void> {
    return this.backend.flush?.() ?? Promise.resolve()
  }
}
