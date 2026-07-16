export const OLD_FAVORITE_SESSIONS_VERSION = 1 as const
export const DEFAULT_OLD_FAVORITE_SEGMENT_SIZE = 1_500

export type OldFavoriteBatchKind = 'full' | 'incremental'
export type OldFavoriteBatchStatus = 'active' | 'ended'
export type OldFavoriteSegmentStatus = 'pending' | 'running' | 'paused' | 'ready' | 'ended'
export type OldFavoriteTaskKind = 'scan' | 'tag' | 'deepseek' | 'execute' | 'reconcile'
export type OldFavoriteTaskStatus = 'running' | 'paused'
export type OldFavoriteRequestState = 'idle' | 'in-flight' | 'result-unknown'

export type OldFavoriteSegmentTask = {
  kind: OldFavoriteTaskKind
  status: OldFavoriteTaskStatus
  currentAid?: number
  requestState: OldFavoriteRequestState
}

export type OldFavoriteSegment = {
  id: string
  index: number
  aids: number[]
  status: OldFavoriteSegmentStatus
  task?: OldFavoriteSegmentTask
  checkpoint?: {
    cursor?: number
    page?: number
    frozenExecutionAids?: number[]
    [key: string]: unknown
  }
}

export type OldFavoriteBatchSnapshot = {
  selection?: unknown
  preview?: unknown
  archivePlanState?: unknown
  recommendations?: unknown
  deepSeek?: unknown
  execution?: unknown
  undo?: unknown
  statistics?: unknown
  currentStep?: string
  [key: string]: unknown
}

export type OldFavoriteBatch = {
  id: string
  accountMid: string
  kind: OldFavoriteBatchKind
  createdAt: string
  endedAt?: string
  status: OldFavoriteBatchStatus
  segments: OldFavoriteSegment[]
  snapshot: OldFavoriteBatchSnapshot
}

export type OldFavoriteTaskLease = {
  batchId: string
  segmentId: string
  task: OldFavoriteTaskKind
  ownerId?: number
}

export type OldFavoriteSessionsState = {
  version: typeof OLD_FAVORITE_SESSIONS_VERSION
  batches: OldFavoriteBatch[]
  lease: OldFavoriteTaskLease | null
}

export type OldFavoriteRecoveryPlan =
  | { action: 'locked-account' }
  | { action: 'read-only' }
  | { action: 'reconcile'; segmentId: string; aids: number[] }
  | { action: 'resume'; segmentId: string }
  | { action: 'idle' }

type CreateOldFavoriteBatchOptions = {
  accountMid: string
  kind: OldFavoriteBatchKind
  aids: number[]
  now: string
  segmentSize?: number
  id?: string
  snapshot?: OldFavoriteBatchSnapshot
}

function uniqueAids(aids: number[]): number[] {
  return [...new Set(aids.filter((aid) => Number.isSafeInteger(aid) && aid > 0))]
}

function createBatchId(options: CreateOldFavoriteBatchOptions, aids: number[]): string {
  const stamp = options.now.replace(/[^0-9]/g, '')
  return options.id ?? `old-favorite:${options.accountMid}:${options.kind}:${stamp}:${aids.length}`
}

export function createOldFavoriteBatch(options: CreateOldFavoriteBatchOptions): OldFavoriteBatch {
  const aids = uniqueAids(options.aids)
  const requestedSize = options.segmentSize ?? DEFAULT_OLD_FAVORITE_SEGMENT_SIZE
  const segmentSize = Math.min(2_000, Math.max(1_000, Math.trunc(requestedSize)))
  const id = createBatchId(options, aids)
  const segments: OldFavoriteSegment[] = []

  for (let offset = 0; offset < aids.length; offset += segmentSize) {
    const index = segments.length
    segments.push({
      id: `${id}:segment:${index + 1}`,
      index,
      aids: aids.slice(offset, offset + segmentSize),
      status: 'pending'
    })
  }

  return {
    id,
    accountMid: options.accountMid.trim(),
    kind: options.kind,
    createdAt: options.now,
    status: 'active',
    segments,
    snapshot: structuredClone(options.snapshot ?? {})
  }
}

export function acquireAidOwnership(
  state: OldFavoriteSessionsState,
  accountMid: string,
  candidateAids: number[]
): number[] {
  const owned = new Set(
    state.batches
      .filter((batch) => batch.accountMid === accountMid && batch.status === 'active')
      .flatMap((batch) => batch.segments)
      .flatMap((segment) => segment.aids)
  )

  return uniqueAids(candidateAids).filter((aid) => !owned.has(aid))
}

export function endOldFavoriteBatch(
  state: OldFavoriteSessionsState,
  batchId: string,
  endedAt: string
): OldFavoriteSessionsState {
  return {
    ...state,
    lease: state.lease?.batchId === batchId ? null : state.lease,
    batches: state.batches.map((batch) =>
      batch.id !== batchId || batch.status === 'ended'
        ? batch
        : {
            ...batch,
            status: 'ended',
            endedAt,
            segments: batch.segments.map((segment) => ({
              ...segment,
              status: 'ended',
              task: undefined
            }))
          }
    )
  }
}

export function normalizeOldFavoriteSessionsForShutdown(
  state: OldFavoriteSessionsState
): OldFavoriteSessionsState {
  return {
    ...state,
    lease: null,
    batches: state.batches.map((batch) => ({
      ...batch,
      segments: batch.segments.map((segment) => {
        if (segment.status !== 'running' && segment.task?.status !== 'running') {
          return segment
        }

        return {
          ...segment,
          status: 'paused',
          task: segment.task
            ? {
                ...segment.task,
                status: 'paused',
                requestState:
                  segment.task.requestState === 'in-flight'
                    ? 'result-unknown'
                    : segment.task.requestState
              }
            : undefined
        }
      })
    }))
  }
}

export function planOldFavoriteRecovery(
  batch: OldFavoriteBatch,
  currentAccountMid: string
): OldFavoriteRecoveryPlan {
  if (batch.accountMid !== currentAccountMid.trim()) {
    return { action: 'locked-account' }
  }
  if (batch.status === 'ended') {
    return { action: 'read-only' }
  }

  const unknownSegment = batch.segments.find(
    (segment) => segment.task?.requestState === 'result-unknown'
  )
  if (unknownSegment) {
    const aids = unknownSegment.task?.currentAid
      ? [unknownSegment.task.currentAid]
      : unknownSegment.aids
    return { action: 'reconcile', segmentId: unknownSegment.id, aids }
  }

  const pausedSegment = batch.segments.find((segment) => segment.status === 'paused')
  if (pausedSegment) {
    return { action: 'resume', segmentId: pausedSegment.id }
  }
  return { action: 'idle' }
}
