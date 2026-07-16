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
  constructor(private readonly coordinator: OldFavoriteSessionCoordinator) {}

  async beginScan(options: BeginScanOptions): Promise<{ batch: OldFavoriteBatch; acquired: boolean }> {
    const accountMid = options.accountMid.trim()
    const batch = createOldFavoriteBatch({ ...options, accountMid, aids: [] })
    const placeholder: OldFavoriteSegment = {
      id: `${batch.id}:segment:1`,
      index: 0,
      aids: [],
      status: 'running',
      task: { kind: 'scan', status: 'running', requestState: 'idle' }
    }
    const prepared = { ...batch, segments: [placeholder] }
    const state = await this.coordinator.load()
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
    aids: number[],
    snapshot?: OldFavoriteBatchSnapshot
  ): Promise<OldFavoriteBatch> {
    const state = await this.coordinator.load()
    const current = state.batches.find((batch) => batch.id === batchId)
    if (!current) throw new Error('Old favorite batch was not found.')

    const rebuilt = createOldFavoriteBatch({
      accountMid: current.accountMid,
      kind: current.kind,
      aids,
      now: current.createdAt,
      id: current.id,
      snapshot: mergeSnapshot(current.snapshot, snapshot)
    })
    rebuilt.segments = rebuilt.segments.map((segment) => ({ ...segment, status: 'ready' }))
    const saved = await this.coordinator.save({
      ...state,
      batches: state.batches.map((batch) => (batch.id === batchId ? rebuilt : batch)),
      lease: state.lease
    })
    const persisted = saved.batches.find((batch) => batch.id === batchId)
    if (!persisted) throw new Error('Old favorite batch was not persisted.')
    return persisted
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
