import {
  REMOTE_FAVORITE_SHARD_CAPACITY
} from './favoriteRepositoryPlanning'
import type { FavoriteRepositoryFrozenSyncPlan } from './favoriteRepository'

export type FrozenPlanClassification = {
  aid: number
  targetLedgerIds: string[]
}

export type BoundRemoteShard = {
  logicalLedgerId: string
  remoteFolderId: string
  memberAids: number[]
  shardNumber?: number
}

export type CompileFrozenFavoriteSyncPlanInput = {
  accountMid: string
  workspaceId: string
  baselineRevision: number
  createdAt: string
  planId?: string
  classifications: FrozenPlanClassification[]
  shards: BoundRemoteShard[]
}

export type CompileFrozenFavoriteSyncPlanResult = {
  allowed: boolean
  reason: 'remote-target-unbound' | 'physical-shard-capacity-exceeded' | 'invalid-input' | null
  plan: FavoriteRepositoryFrozenSyncPlan | null
}

function normalizeAccountMid(value: string) {
  const raw = value.trim()
  if (!/^\d+$/.test(raw) || BigInt(raw) === 0n) return null
  return BigInt(raw).toString()
}

function uniquePositiveAids(aids: number[]) {
  return [...new Set(aids.filter((aid) => Number.isSafeInteger(aid) && aid > 0))].sort((left, right) => left - right)
}

function normalizedLedgerIds(value: string[]) {
  return [...new Set(value.filter((id) => typeof id === 'string').map((id) => id.trim()).filter(Boolean))].sort()
}

function stablePlanId(input: CompileFrozenFavoriteSyncPlanInput) {
  return `old-favorite-sync:${input.workspaceId}:${input.createdAt.replace(/[^0-9]/g, '')}`
}

/** Compiles only pre-bound remote folders; creation and sharding are separate, explicit operations. */
export function compileFrozenFavoriteSyncPlan(
  input: CompileFrozenFavoriteSyncPlanInput
): CompileFrozenFavoriteSyncPlanResult {
  const accountMid = normalizeAccountMid(input.accountMid)
  if (!accountMid || !input.workspaceId.trim() || !Number.isSafeInteger(input.baselineRevision) || input.baselineRevision < 0 ||
    Number.isNaN(Date.parse(input.createdAt)) || !Array.isArray(input.classifications) || !Array.isArray(input.shards)) {
    return { allowed: false, reason: 'invalid-input', plan: null }
  }

  const shardsByLedger = new Map<string, BoundRemoteShard[]>()
  for (const shard of input.shards) {
    const logicalLedgerId = shard.logicalLedgerId?.trim()
    const remoteFolderId = shard.remoteFolderId?.trim()
    if (!logicalLedgerId || !remoteFolderId || !Array.isArray(shard.memberAids)) {
      return { allowed: false, reason: 'invalid-input', plan: null }
    }
    const normalized = { ...shard, logicalLedgerId, remoteFolderId, memberAids: uniquePositiveAids(shard.memberAids) }
    shardsByLedger.set(logicalLedgerId, [...(shardsByLedger.get(logicalLedgerId) ?? []), normalized])
  }

  const operations = new Map<number, Set<string>>()
  for (const classification of input.classifications) {
    if (!Number.isSafeInteger(classification.aid) || classification.aid <= 0 || !Array.isArray(classification.targetLedgerIds)) {
      return { allowed: false, reason: 'invalid-input', plan: null }
    }
    for (const logicalLedgerId of normalizedLedgerIds(classification.targetLedgerIds)) {
      const shards = [...(shardsByLedger.get(logicalLedgerId) ?? [])].sort((left, right) =>
        (left.shardNumber ?? 1) - (right.shardNumber ?? 1) || left.remoteFolderId.localeCompare(right.remoteFolderId)
      )
      if (!shards.length) return { allowed: false, reason: 'remote-target-unbound', plan: null }
      const target = shards.find((shard) => shard.memberAids.includes(classification.aid)) ??
        [...shards].reverse().find((shard) => shard.memberAids.length < REMOTE_FAVORITE_SHARD_CAPACITY)
      if (!target) return { allowed: false, reason: 'physical-shard-capacity-exceeded', plan: null }
      const folders = operations.get(classification.aid) ?? new Set<string>()
      folders.add(target.remoteFolderId)
      operations.set(classification.aid, folders)
    }
  }

  const id = input.planId?.trim() || stablePlanId(input)
  if (!id) return { allowed: false, reason: 'invalid-input', plan: null }
  return {
    allowed: true,
    reason: null,
    plan: {
      id,
      accountMid,
      workspaceId: input.workspaceId.trim(),
      baselineRevision: input.baselineRevision,
      createdAt: new Date(input.createdAt).toISOString(),
      operations: [...operations.entries()].sort(([left], [right]) => left - right).map(([aid, folderIds]) => ({
        operationKey: `append:${aid}:${[...folderIds].sort().join(',')}`,
        aid,
        kind: 'append' as const,
        folderIds: [...folderIds].sort()
      }))
    }
  }
}
