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
}

function emptyState(): OldFavoriteSessionsState {
  return { version: OLD_FAVORITE_SESSIONS_VERSION, batches: [], lease: null }
}

function isCurrentState(value: unknown): value is OldFavoriteSessionsState {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<OldFavoriteSessionsState>
  return candidate.version === OLD_FAVORITE_SESSIONS_VERSION && Array.isArray(candidate.batches)
}

export class OldFavoriteSessionStore {
  constructor(private readonly backend: OldFavoriteSessionStoreBackend) {}

  load(): OldFavoriteSessionsState {
    const stored = this.backend.get(STORE_KEY)
    return isCurrentState(stored) ? structuredClone(stored) : emptyState()
  }

  save(state: OldFavoriteSessionsState): void {
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
}
