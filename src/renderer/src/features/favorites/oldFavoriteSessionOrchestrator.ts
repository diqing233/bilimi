import {
  createOldFavoriteBatch,
  type OldFavoriteBatch,
  type OldFavoriteBatchKind,
  type OldFavoriteBatchSnapshot,
  type OldFavoriteRequestState,
  type OldFavoriteSegment,
  type OldFavoriteSegmentStatus,
  type OldFavoriteSegmentTask,
  type OldFavoriteSessionsState,
  type OldFavoriteTaskKind
} from '../../../../shared/oldFavoriteSessions'

export type OldFavoriteSessionCoordinator = {
  load: () => Promise<OldFavoriteSessionsState>
  save: (state: OldFavoriteSessionsState) => Promise<OldFavoriteSessionsState>
  beginFullScan?: (
    accountMid: string,
    now: string,
    snapshot?: OldFavoriteBatchSnapshot
  ) => Promise<{ batch: OldFavoriteBatch; acquired: boolean }> | undefined
  acquire: (
    batchId: string,
    segmentId: string,
    task: OldFavoriteTaskKind,
    accountMid: string
  ) => Promise<boolean>
  release: (batchId: string, segmentId: string) => Promise<boolean>
}

type BeginScanOptions = {
  accountMid: string
  kind: OldFavoriteBatchKind
  now: string
  snapshot?: OldFavoriteBatchSnapshot
  id?: string
}

type SegmentUpdate = {
  status?: OldFavoriteSegmentStatus
  task?: OldFavoriteSegmentTask
  taskStatus?: OldFavoriteSegmentTask['status']
  requestState?: OldFavoriteRequestState
  currentAid?: number
  checkpoint?: OldFavoriteSegment['checkpoint']
  snapshot?: OldFavoriteBatchSnapshot
}

type TrackedRequestOptions<T> = {
  batchId: string
  segmentId: string
  task: OldFavoriteTaskKind
  accountMid: string
  currentAid?: number
  checkpoint?: OldFavoriteSegment['checkpoint']
  snapshot?: OldFavoriteBatchSnapshot
  work: () => Promise<T>
}

export type OldFavoriteRunDecision =
  | { allowed: true }
  | {
      allowed: false
      reason: 'batch-missing' | 'segment-missing' | 'account-mismatch' | 'batch-ended' | 'lease-held'
    }

function mergeSnapshot(
  current: OldFavoriteBatchSnapshot,
  update: OldFavoriteBatchSnapshot | undefined
): OldFavoriteBatchSnapshot {
  return update ? { ...current, ...structuredClone(update) } : current
}

export class OldFavoriteSessionOrchestrator {
  private readonly replacementFullBatchIds = new Set<string>()
  private readonly fullScanBeginTails = new Map<string, Promise<unknown>>()

  constructor(private readonly coordinator: OldFavoriteSessionCoordinator) {}

  async beginScan(options: BeginScanOptions): Promise<{ batch: OldFavoriteBatch; acquired: boolean }> {
    const accountMid = options.accountMid.trim()
    if (options.kind === 'full') {
      const atomicResult = await this.coordinator.beginFullScan?.(accountMid, options.now, options.snapshot)
      if (atomicResult) return atomicResult
      const previous = this.fullScanBeginTails.get(accountMid) ?? Promise.resolve()
      const next = previous.then(() => this.beginScanNow(options, accountMid))
      this.fullScanBeginTails.set(accountMid, next.catch(() => undefined))
      return next
    }
    return this.beginScanNow(options, accountMid)
  }

  private async beginScanNow(
    options: BeginScanOptions,
    accountMid: string
  ): Promise<{ batch: OldFavoriteBatch; acquired: boolean }> {
    const state = await this.coordinator.load()
    const activeFull = options.kind === 'full'
      ? state.batches
          .filter((batch) =>
            batch.accountMid === accountMid &&
            batch.kind === 'full' &&
            batch.status === 'active' &&
            (batch.segments.some((segment) => segment.aids.length > 0) ||
              batch.segments.some((segment) =>
                segment.status === 'running' && segment.task?.kind === 'scan'
              ) ||
              this.replacementFullBatchIds.has(batch.id))
          )
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
          .at(-1)
      : undefined
    if (activeFull) {
      return { batch: activeFull, acquired: false }
    }
    const batch = createOldFavoriteBatch({ ...options, accountMid, aids: [] })
    const placeholder: OldFavoriteSegment = {
      id: `${batch.id}:segment:1`,
      index: 0,
      aids: [],
      status: 'running',
      task: { kind: 'scan', status: 'running', requestState: 'idle' }
    }
    const prepared = { ...batch, segments: [placeholder] }
    if (options.kind === 'full') this.replacementFullBatchIds.add(prepared.id)
    const saved = await this.coordinator.save({
      ...state,
      batches: [...state.batches, prepared],
      lease: state.lease
    })
    const persisted = saved.batches.find((candidate) => candidate.id === prepared.id) ?? prepared
    const acquired = await this.coordinator.acquire(prepared.id, placeholder.id, 'scan', accountMid)
    return { batch: persisted, acquired }
  }

  async runWithLease<T>(
    batchId: string,
    segmentId: string,
    task: OldFavoriteTaskKind,
    accountMid: string,
    work: () => Promise<T>
  ): Promise<T> {
    const acquired = await this.coordinator.acquire(batchId, segmentId, task, accountMid.trim())
    if (!acquired) throw new Error('Old favorite task lease is unavailable.')

    try {
      return await work()
    } finally {
      await this.coordinator.release(batchId, segmentId)
    }
  }

  async runTrackedRequest<T>(options: TrackedRequestOptions<T>): Promise<T> {
    const acquired = await this.coordinator.acquire(
      options.batchId,
      options.segmentId,
      options.task,
      options.accountMid.trim()
    )
    if (!acquired) throw new Error('Old favorite task lease is unavailable.')

    await this.updateSegment(options.batchId, options.segmentId, {
      status: 'running',
      task: {
        kind: options.task,
        status: 'running',
        requestState: 'in-flight',
        ...(options.currentAid === undefined ? {} : { currentAid: options.currentAid })
      },
      checkpoint: options.checkpoint,
      snapshot: options.snapshot
    })
    try {
      const result = await options.work()
      await this.updateSegment(options.batchId, options.segmentId, {
        status: 'ready',
        taskStatus: 'paused',
        requestState: 'idle',
        checkpoint: options.checkpoint,
        snapshot: options.snapshot
      })
      return result
    } catch (error) {
      await this.updateSegment(options.batchId, options.segmentId, {
        status: 'paused',
        taskStatus: 'paused',
        requestState: 'result-unknown',
        checkpoint: options.checkpoint,
        snapshot: options.snapshot
      })
      throw error
    } finally {
      await this.coordinator.release(options.batchId, options.segmentId)
    }
  }

  async updateSegment(
    batchId: string,
    segmentId: string,
    update: SegmentUpdate
  ): Promise<OldFavoriteSessionsState> {
    const state = await this.coordinator.load()
    const batches = state.batches.map((batch) => {
      if (batch.id !== batchId) return batch
      return {
        ...batch,
        snapshot: mergeSnapshot(batch.snapshot, update.snapshot),
        segments: batch.segments.map((segment) => {
          if (segment.id !== segmentId) return segment
          const task = update.task
            ? structuredClone(update.task)
            : segment.task &&
                (update.taskStatus !== undefined ||
                  update.requestState !== undefined ||
                  update.currentAid !== undefined)
              ? {
                  ...segment.task,
                  ...(update.taskStatus === undefined ? {} : { status: update.taskStatus }),
                  ...(update.requestState === undefined
                    ? {}
                    : { requestState: update.requestState }),
                  ...(update.currentAid === undefined ? {} : { currentAid: update.currentAid })
                }
              : segment.task
          return {
            ...segment,
            ...(update.status === undefined ? {} : { status: update.status }),
            ...(task === undefined ? {} : { task }),
            ...(update.checkpoint === undefined
              ? {}
              : { checkpoint: structuredClone(update.checkpoint) })
          }
        })
      }
    })
    return this.coordinator.save({ ...state, batches, lease: state.lease })
  }

  async completeScan(
    batchId: string,
    snapshot?: OldFavoriteBatchSnapshot
  ): Promise<OldFavoriteBatch> {
    const state = await this.coordinator.load()
    const current = state.batches.find((batch) => batch.id === batchId)
    if (!current) throw new Error('Old favorite batch was not found.')

    const rebuilt: OldFavoriteBatch = {
      ...current,
      snapshot: mergeSnapshot(current.snapshot, snapshot),
      segments: current.segments.map((segment) => ({
        ...segment,
        ...(segment.task?.kind === 'scan'
          ? { status: 'ready' as const, task: undefined }
          : {})
      }))
    }
    const saved = await this.coordinator.save({
      ...state,
      batches: state.batches.map((batch) => (batch.id === batchId ? rebuilt : batch)),
      lease: state.lease
    })
    const persisted = saved.batches.find((batch) => batch.id === batchId)
    if (!persisted) throw new Error('Old favorite batch was not persisted.')
    return persisted
  }

  async appendDiscoveredAids(batchId: string, candidateAids: number[]): Promise<OldFavoriteBatch> {
    const state = await this.coordinator.load()
    const current = state.batches.find((batch) => batch.id === batchId)
    if (!current) throw new Error('Old favorite batch was not found.')
    const owned = new Set(current.segments.flatMap((segment) => segment.aids))
    const pending = [...new Set(candidateAids.filter((aid) =>
      Number.isSafeInteger(aid) && aid > 0 && !owned.has(aid)
    ))]
    const segments = current.segments.map((segment) => structuredClone(segment))
    let open = segments.at(-1)
    if (!open || open.aids.length >= 2_000) open = undefined
    for (const aid of pending) {
      if (!open) {
        open = {
          id: `${current.id}:segment:${segments.length + 1}`,
          index: segments.length,
          aids: [],
          status: 'running',
          task: { kind: 'scan', status: 'running', requestState: 'idle' }
        }
        segments.push(open)
      }
      open.aids.push(aid)
      if (open.aids.length === 2_000) {
        open.status = 'running'
        open.task = { kind: 'tag', status: 'running', requestState: 'idle' }
        open = undefined
      }
    }
    const updated = { ...current, segments }
    const saved = await this.coordinator.save({
      ...state,
      batches: state.batches.map((batch) => batch.id === batchId ? updated : batch),
      lease: state.lease
    })
    return saved.batches.find((batch) => batch.id === batchId) ?? updated
  }

  async markSegmentTagsSettled(batchId: string, segmentIndex: number): Promise<OldFavoriteBatch> {
    const state = await this.coordinator.load()
    const current = state.batches.find((batch) => batch.id === batchId)
    if (!current) throw new Error('Old favorite batch was not found.')
    const updated = {
      ...current,
      segments: current.segments.map((segment) =>
        segment.index === segmentIndex
          ? { ...segment, status: 'ready' as const, task: undefined }
          : segment
      )
    }
    const saved = await this.coordinator.save({
      ...state,
      batches: state.batches.map((batch) => batch.id === batchId ? updated : batch),
      lease: state.lease
    })
    return saved.batches.find((batch) => batch.id === batchId) ?? updated
  }

  async discardBatch(batchId: string): Promise<OldFavoriteSessionsState> {
    const state = await this.coordinator.load()
    const saved = await this.coordinator.save({
      ...state,
      batches: state.batches.filter((batch) => batch.id !== batchId),
      lease: state.lease?.batchId === batchId ? null : state.lease
    })
    await this.coordinator.release(batchId, state.lease?.segmentId ?? '')
    return saved
  }

  async canRun(
    batchId: string,
    segmentId: string,
    accountMid: string
  ): Promise<OldFavoriteRunDecision> {
    const state = await this.coordinator.load()
    const batch = state.batches.find((candidate) => candidate.id === batchId)
    if (!batch) return { allowed: false, reason: 'batch-missing' }
    if (batch.accountMid !== accountMid.trim()) {
      return { allowed: false, reason: 'account-mismatch' }
    }
    if (batch.status === 'ended') return { allowed: false, reason: 'batch-ended' }
    if (!batch.segments.some((segment) => segment.id === segmentId)) {
      return { allowed: false, reason: 'segment-missing' }
    }
    if (
      state.lease &&
      (state.lease.batchId !== batchId || state.lease.segmentId !== segmentId)
    ) {
      return { allowed: false, reason: 'lease-held' }
    }
    return { allowed: true }
  }

  async getReconciliationAids(batchId: string, accountMid: string): Promise<number[]> {
    const state = await this.coordinator.load()
    const batch = state.batches.find(
      (candidate) =>
        candidate.id === batchId &&
        candidate.status === 'active' &&
        candidate.accountMid === accountMid.trim()
    )
    if (!batch) return []

    return [
      ...new Set(
        batch.segments.flatMap((segment) => {
          if (segment.task?.requestState !== 'result-unknown') return []
          return segment.task.currentAid ? [segment.task.currentAid] : segment.aids
        })
      )
    ]
  }
}
