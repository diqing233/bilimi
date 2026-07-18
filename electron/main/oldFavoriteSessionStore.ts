import {
  createOldFavoriteBatch,
  normalizeOldFavoriteSessionsForShutdown,
  OLD_FAVORITE_SESSIONS_VERSION,
  type OldFavoriteBatch,
  type OldFavoriteBatchSnapshot,
  type OldFavoriteTaskKind,
  type OldFavoriteSessionsState
} from '../../src/shared/oldFavoriteSessions'

const STORE_KEY = 'oldFavoriteSessions'

export interface OldFavoriteSessionStoreBackend {
  get(key: string): unknown
  set(key: string, value: unknown): void
  getRetiredBatchIds?(): readonly string[]
  setRetiredBatchIds?(ids: readonly string[]): void
  flush?(): Promise<void>
}

function emptyState(): OldFavoriteSessionsState {
  return { version: OLD_FAVORITE_SESSIONS_VERSION, batches: [], lease: null }
}

export type OldFavoriteBatchLifecycleSnapshot = {
  id: string
  accountMid: string
  kind: OldFavoriteBatch['kind']
  status: 'ended'
  endedAt: string
  segmentCount: number
  aidCount: number
}

export type OldFavoriteDiscardSnapshot = {
  batchId: string
  accountMid: string
  discarded: true
}

function toLifecycleSnapshot(batch: OldFavoriteBatch): OldFavoriteBatchLifecycleSnapshot {
  return {
    id: batch.id,
    accountMid: batch.accountMid,
    kind: batch.kind,
    status: 'ended',
    endedAt: batch.endedAt ?? batch.createdAt,
    segmentCount: batch.segments.length,
    aidCount: batch.segments.reduce((total, segment) => total + segment.aids.length, 0)
  }
}

function normalizeTerminalState(state: OldFavoriteSessionsState): OldFavoriteSessionsState {
  const batches = state.batches.map((batch) => batch.status === 'ended'
    ? {
        ...batch,
        segments: batch.segments.map((segment) => ({
          ...segment,
          status: 'ended' as const,
          task: undefined
        }))
      }
    : batch)
  const lease = state.lease && batches.some((batch) =>
    batch.id === state.lease?.batchId && batch.status === 'active'
  ) ? state.lease : null
  return { ...state, batches, lease }
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
  private readonly retiredBatchIds: Set<string>
  private nextGeneratedBatchSuffix = 1

  constructor(private readonly backend: OldFavoriteSessionStoreBackend) {
    this.retiredBatchIds = new Set(backend.getRetiredBatchIds?.() ?? [])
  }

  load(): OldFavoriteSessionsState {
    const stored = this.backend.get(STORE_KEY)
    return isCurrentOldFavoriteSessionsState(stored)
      ? structuredClone(normalizeTerminalState(stored))
      : emptyState()
  }

  save(state: OldFavoriteSessionsState): void {
    if (!isCurrentOldFavoriteSessionsState(state)) {
      throw new Error('Old favorite session state is invalid.')
    }
    const current = this.load()
    const currentById = new Map(current.batches.map((batch) => [batch.id, batch]))
    const incomingIds = new Set(state.batches.map((batch) => batch.id))
    const incoming = state.batches
      .filter((batch) => !this.retiredBatchIds.has(batch.id) || currentById.has(batch.id))
      .map((batch) => {
        const existing = currentById.get(batch.id)
        if (existing?.status === 'ended') return existing
        if (batch.status !== 'ended') return batch
        return {
          ...batch,
          segments: batch.segments.map((segment) => ({ ...segment, status: 'ended' as const, task: undefined }))
        }
      })
    const nextBatches = [
      ...incoming,
      ...current.batches.filter((batch) => !incomingIds.has(batch.id))
    ]
    const nextLease = current.lease && nextBatches.some((batch) =>
      batch.id === current.lease?.batchId && batch.status === 'active'
    ) ? current.lease : null
    this.backend.set(STORE_KEY, structuredClone({
      ...state,
      batches: nextBatches,
      lease: nextLease
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

  beginFullScan(
    accountMid: string,
    now: string,
    snapshot: OldFavoriteBatchSnapshot | undefined,
    ownerId: number
  ): { batch: OldFavoriteBatch; acquired: boolean } {
    const normalizedAccountMid = accountMid.trim()
    const state = this.load()
    const activeFullCandidates = state.batches
      .filter((batch) =>
        batch.accountMid === normalizedAccountMid &&
        batch.kind === 'full' &&
        batch.status === 'active'
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    const activeFull = activeFullCandidates.filter((batch) =>
      batch.segments.some((segment) => segment.aids.length > 0) ||
      batch.segments.some((segment) =>
        segment.status === 'running' && segment.task?.kind === 'scan' && segment.task.status === 'running'
      )
    ).at(-1)
    if (activeFull || state.lease) {
      return { batch: activeFull ?? createOldFavoriteBatch({ accountMid: normalizedAccountMid, kind: 'full', aids: [], now }), acquired: false }
    }
    let batch = createOldFavoriteBatch({ accountMid: normalizedAccountMid, kind: 'full', aids: [], now, snapshot })
    while (this.retiredBatchIds.has(batch.id) || state.batches.some((candidate) => candidate.id === batch.id)) {
      batch = createOldFavoriteBatch({
        accountMid: normalizedAccountMid,
        kind: 'full',
        aids: [],
        now,
        snapshot,
        id: `${batch.id}:retry:${this.nextGeneratedBatchSuffix++}`
      })
    }
    const segment = {
      id: `${batch.id}:segment:1`,
      index: 0,
      aids: [] as number[],
      status: 'running' as const,
      task: { kind: 'scan' as const, status: 'running' as const, requestState: 'idle' as const }
    }
    const prepared = { ...batch, segments: [segment] }
    this.backend.set(STORE_KEY, structuredClone({
      ...state,
      batches: [
        ...state.batches.map((candidate) =>
          activeFullCandidates.some((placeholder) => placeholder.id === candidate.id)
            ? {
                ...candidate,
                status: 'ended' as const,
                endedAt: now,
                segments: candidate.segments.map((segment) => ({
                  ...segment,
                  status: 'ended' as const,
                  task: undefined
                }))
              }
            : candidate
        ),
        prepared
      ],
      lease: { batchId: prepared.id, segmentId: segment.id, task: 'scan', ownerId }
    }))
    return { batch: prepared, acquired: true }
  }

  beginIncrementalScan(
    accountMid: string,
    now: string,
    snapshot: OldFavoriteBatchSnapshot | undefined,
    ownerId: number
  ): { batch: OldFavoriteBatch; acquired: boolean } {
    const normalizedAccountMid = accountMid.trim()
    const state = this.load()
    const existing = state.batches
      .filter((batch) =>
        batch.accountMid === normalizedAccountMid &&
        batch.kind === 'incremental' &&
        batch.status === 'active'
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .at(-1)
    if (existing || state.lease) {
      return {
        batch: existing ?? createOldFavoriteBatch({
          accountMid: normalizedAccountMid, kind: 'incremental', aids: [], now
        }),
        acquired: false
      }
    }

    let batch = createOldFavoriteBatch({
      accountMid: normalizedAccountMid, kind: 'incremental', aids: [], now, snapshot
    })
    while (this.retiredBatchIds.has(batch.id) || state.batches.some((candidate) => candidate.id === batch.id)) {
      batch = createOldFavoriteBatch({
        accountMid: normalizedAccountMid,
        kind: 'incremental',
        aids: [],
        now,
        snapshot,
        id: `${batch.id}:retry:${this.nextGeneratedBatchSuffix++}`
      })
    }
    const segment = {
      id: `${batch.id}:segment:1`,
      index: 0,
      aids: [] as number[],
      status: 'running' as const,
      task: { kind: 'scan' as const, status: 'running' as const, requestState: 'idle' as const }
    }
    const prepared = { ...batch, segments: [segment] }
    this.backend.set(STORE_KEY, structuredClone({
      ...state,
      batches: [...state.batches, prepared],
      lease: { batchId: prepared.id, segmentId: segment.id, task: 'scan', ownerId }
    }))
    return { batch: prepared, acquired: true }
  }

  endBatch(batchId: string, endedAt: string): OldFavoriteBatch {
    const state = this.load()
    const current = state.batches.find((batch) => batch.id === batchId)
    if (!current) throw new Error('Old favorite batch does not exist.')
    if (current.status === 'ended') return current

    const ended = {
      ...current,
      status: 'ended' as const,
      endedAt,
      segments: current.segments.map((segment) => ({ ...segment, status: 'ended' as const, task: undefined }))
    }
    this.backend.set(STORE_KEY, structuredClone({
      ...state,
      batches: state.batches.map((batch) => batch.id === batchId ? ended : batch),
      lease: state.lease?.batchId === batchId ? null : state.lease
    }))
    return structuredClone(ended)
  }

  discardEmptyIncrementalBatch(
    batchId: string,
    accountMid: string,
    ownerId: number
  ): OldFavoriteDiscardSnapshot {
    const normalizedAccountMid = accountMid.trim()
    const state = this.load()
    const current = state.batches.find((batch) => batch.id === batchId)
    if (!current && this.retiredBatchIds.has(batchId)) {
      return { batchId, accountMid: normalizedAccountMid, discarded: true }
    }
    if (!current) throw new Error('Old favorite batch does not exist.')
    if (current.accountMid !== normalizedAccountMid) {
      throw new Error('Old favorite batch belongs to another account.')
    }
    if (current.kind !== 'incremental' || current.status !== 'active') {
      throw new Error('Only an active incremental batch can be discarded.')
    }
    if (current.segments.some((segment) => segment.aids.length > 0)) {
      throw new Error('Only an empty incremental batch can be discarded.')
    }
    if (state.lease?.batchId === batchId && state.lease.ownerId !== ownerId) {
      throw new Error('Old favorite batch is owned by another window.')
    }

    this.retiredBatchIds.add(batchId)
    this.backend.setRetiredBatchIds?.([...this.retiredBatchIds])
    this.backend.set(STORE_KEY, structuredClone({
      ...state,
      batches: state.batches.filter((batch) => batch.id !== batchId),
      lease: state.lease?.batchId === batchId ? null : state.lease
    }))
    return { batchId, accountMid: normalizedAccountMid, discarded: true }
  }

  toLifecycleSnapshot(batch: OldFavoriteBatch): OldFavoriteBatchLifecycleSnapshot {
    return toLifecycleSnapshot(batch)
  }

  rollbackFullScan(batchId: string, ownerId: number): boolean {
    const state = this.load()
    if (state.lease?.batchId !== batchId || state.lease.ownerId !== ownerId) return false
    const batch = state.batches.find((candidate) => candidate.id === batchId)
    if (!batch || batch.kind !== 'full' || batch.segments.some((segment) => segment.aids.length > 0)) return false
    this.backend.set(STORE_KEY, structuredClone({
      ...state,
      batches: state.batches.filter((candidate) => candidate.id !== batchId),
      lease: null
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
    this.save(normalizeOldFavoriteSessionsForShutdown(state))
  }

  resetAccount(accountMid: string): OldFavoriteSessionsState {
    const normalized = accountMid.trim()
    const state = this.load()
    const removedIds = new Set(
      state.batches.filter((batch) => batch.accountMid === normalized).map((batch) => batch.id)
    )
    for (const id of removedIds) this.retiredBatchIds.add(id)
    this.backend.setRetiredBatchIds?.([...this.retiredBatchIds])
    const next = {
      ...state,
      batches: state.batches.filter((batch) => batch.accountMid !== normalized),
      lease: state.lease && removedIds.has(state.lease.batchId) ? null : state.lease
    }
    this.backend.set(STORE_KEY, structuredClone(next))
    return next
  }

  restore(state: OldFavoriteSessionsState): void {
    if (!isCurrentOldFavoriteSessionsState(state)) {
      throw new Error('Old favorite session state is invalid.')
    }
    const normalized = normalizeTerminalState(state)
    this.backend.set(STORE_KEY, structuredClone(normalized))
    for (const batch of state.batches) this.retiredBatchIds.delete(batch.id)
    this.backend.setRetiredBatchIds?.([...this.retiredBatchIds])
  }

  flush(): Promise<void> {
    return this.backend.flush?.() ?? Promise.resolve()
  }
}
