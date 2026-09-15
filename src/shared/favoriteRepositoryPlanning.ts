export const REMOTE_FAVORITE_FOLDER_LIMIT = 99
export const REMOTE_FAVORITE_SHARD_CAPACITY = 1_000
export const REMOTE_FAVORITE_INBOX_CAPACITY = 50_000

export type RepositoryTargetSource = 'manual' | 'fallback' | 'deepseek' | 'system-high' | 'system-low'

export type RepositoryTargetCandidate = {
  ledgerId: string
  source: RepositoryTargetSource
}

export type ResolveRepositoryTargetsInput = {
  candidates: RepositoryTargetCandidate[]
  maximumTargets: number
}

export type RepositoryTargetResolution = {
  targetLedgerIds: string[]
  reason: 'insufficient-reliable-targets' | null
}

const targetSourcePriority: Record<RepositoryTargetSource, number> = {
  manual: 5,
  fallback: 4,
  deepseek: 3,
  'system-high': 2,
  'system-low': 1
}

function normalizeMaximumTargets(value: number) {
  if (!Number.isFinite(value)) return 1
  return Math.min(3, Math.max(1, Math.floor(value)))
}

function compareLedgerIds(left: string, right: string) {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

export function resolveRepositoryTargets(
  input: ResolveRepositoryTargetsInput
): RepositoryTargetResolution {
  const candidates = input.candidates
    .map((candidate) => ({ ...candidate, ledgerId: candidate.ledgerId.trim() }))
    .filter((candidate) => candidate.ledgerId)
  const highestPriority = Math.max(0, ...candidates.map((candidate) => targetSourcePriority[candidate.source]))

  if (highestPriority <= targetSourcePriority['system-low']) {
    return { targetLedgerIds: [], reason: 'insufficient-reliable-targets' }
  }

  const maximumTargets = normalizeMaximumTargets(input.maximumTargets)
  const winningCandidates = candidates.filter(
    (candidate) => targetSourcePriority[candidate.source] === highestPriority
  )
  const allowedTargets = highestPriority >= targetSourcePriority.deepseek ? maximumTargets : 1
  const targetLedgerIds = Array.from(new Set(winningCandidates.map((candidate) => candidate.ledgerId)))
    .sort(compareLedgerIds)
    .slice(0, allowedTargets)

  return targetLedgerIds.length > 0
    ? { targetLedgerIds, reason: null }
    : { targetLedgerIds: [], reason: 'insufficient-reliable-targets' }
}

export type RemoteCapacityPlanInput = {
  currentFolderCount: number
  shardCreates: number
  inboxTotal: number
  maximumProjectedShardMembers?: number
}

export type RemoteCapacityPlan = {
  allowed: boolean
  reason:
    | 'invalid-input'
    | 'folder-limit-exceeded'
    | 'inbox-capacity-exceeded'
    | 'shard-capacity-exceeded'
    | null
  projectedFolderCount: number
}

export function planRemoteCapacity(input: RemoteCapacityPlanInput): RemoteCapacityPlan {
  const numericInputs = [
    input.currentFolderCount,
    input.shardCreates,
    input.inboxTotal,
    input.maximumProjectedShardMembers ?? 0
  ]
  if (!numericInputs.every((value) => Number.isSafeInteger(value) && value >= 0)) {
    return { allowed: false, reason: 'invalid-input', projectedFolderCount: 0 }
  }
  const projectedFolderCount = input.currentFolderCount + input.shardCreates
  if (projectedFolderCount > REMOTE_FAVORITE_FOLDER_LIMIT) {
    return { allowed: false, reason: 'folder-limit-exceeded', projectedFolderCount }
  }
  if (input.inboxTotal > REMOTE_FAVORITE_INBOX_CAPACITY) {
    return { allowed: false, reason: 'inbox-capacity-exceeded', projectedFolderCount }
  }
  if ((input.maximumProjectedShardMembers ?? 0) > REMOTE_FAVORITE_SHARD_CAPACITY) {
    return { allowed: false, reason: 'shard-capacity-exceeded', projectedFolderCount }
  }
  return { allowed: true, reason: null, projectedFolderCount }
}
