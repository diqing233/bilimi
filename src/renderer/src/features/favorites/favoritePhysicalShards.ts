import { REMOTE_FAVORITE_SHARD_CAPACITY } from '../../../../shared/favoriteRepositoryPlanning'

export type FavoritePhysicalShard = {
  id: string
  logicalLedgerId?: string
  title: string
  memberAids: number[]
  reservedAids?: number[]
  membershipComplete?: boolean
  isInbox?: boolean
}

export type FavoritePhysicalShardGroup = {
  logicalLedgerId: string
  logicalTitle: string
  shardCount: number
  shards: FavoritePhysicalShard[]
  memberAids: number[]
  membershipComplete: boolean
  isInbox: boolean
}

const REMOTE_FOLDER_TITLE_LIMIT = 20
const RESERVED_SHARD_SUFFIX_LENGTH = 6
const SHARD_SUFFIX_PATTERN = /·([2-9]\d*)$/

const getFavoritePhysicalShardNumber = (title: string) => {
  const match = title.trim().match(SHARD_SUFFIX_PATTERN)
  return match ? Number(match[1]) : 1
}

const uniqueValidAids = (aids: number[]) =>
  Array.from(new Set(aids.filter((aid) => Number.isFinite(aid) && aid > 0)))
    .sort((left, right) => left - right)

function resolvedLogicalLedgerId(shard: FavoritePhysicalShard) {
  const logicalLedgerId = shard.logicalLedgerId?.trim()
  // Legacy remote folders do not have enough information to safely reconstruct a logical ledger.
  // Keep each one isolated until a repository migration explicitly binds it.
  return logicalLedgerId || `legacy-physical:${shard.id}`
}

function compareStableText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

function comparePhysicalShards(left: FavoritePhysicalShard, right: FavoritePhysicalShard) {
  return getFavoritePhysicalShardNumber(left.title) - getFavoritePhysicalShardNumber(right.title) ||
    compareStableText(left.id, right.id)
}

export function prepareFavoriteLogicalFolderTitle(title: string) {
  return title.trim().slice(0, REMOTE_FOLDER_TITLE_LIMIT - RESERVED_SHARD_SUFFIX_LENGTH)
}

export function getFavoriteLogicalFolderTitle(title: string) {
  return prepareFavoriteLogicalFolderTitle(title.trim().replace(SHARD_SUFFIX_PATTERN, ''))
}

export function getFavoritePhysicalShardTitle(logicalTitle: string, shardNumber: number) {
  const normalizedTitle = prepareFavoriteLogicalFolderTitle(logicalTitle)
  if (shardNumber <= 1) {
    return normalizedTitle
  }
  const suffix = `·${shardNumber}`
  return `${normalizedTitle}${suffix}`
}

export function groupFavoritePhysicalShards(shards: FavoritePhysicalShard[]): FavoritePhysicalShardGroup[] {
  const groups = new Map<string, FavoritePhysicalShardGroup>()
  for (const shard of shards) {
    const logicalLedgerId = resolvedLogicalLedgerId(shard)
    const shardLogicalTitle = getFavoriteLogicalFolderTitle(shard.title)
    const current = groups.get(logicalLedgerId) ?? {
      logicalLedgerId,
      logicalTitle: shardLogicalTitle,
      shardCount: 0,
      shards: [],
      memberAids: [],
      membershipComplete: true,
      isInbox: false
    }
    current.shards.push(shard)
    current.shardCount += 1
    current.memberAids = uniqueValidAids([...current.memberAids, ...shard.memberAids])
    current.membershipComplete = current.membershipComplete && shard.membershipComplete !== false
    current.isInbox = current.isInbox || shard.isInbox === true || shardLogicalTitle === 'bilimi·暂存'
    groups.set(logicalLedgerId, current)
  }
  return Array.from(groups.values())
    .map((group) => {
      const sortedShards = [...group.shards].sort(comparePhysicalShards)
      const canonicalShard = sortedShards[0]!
      return {
        ...group,
        logicalTitle: getFavoriteLogicalFolderTitle(canonicalShard.title),
        shards: sortedShards
      }
    })
    .sort((left, right) => compareStableText(left.logicalLedgerId, right.logicalLedgerId))
}

type AllocateFavoritePhysicalShardsOptions = {
  logicalLedgerId: string
  logicalTitle: string
  requestedAids: number[]
  shards: FavoritePhysicalShard[]
  maxMembersPerShard?: number
  createShard: (
    logicalLedgerId: string,
    title: string,
    shardNumber: number
  ) => Promise<{ id: string } | null>
}

export async function allocateFavoritePhysicalShards(options: AllocateFavoritePhysicalShardsOptions) {
  const logicalLedgerId = options.logicalLedgerId.trim()
  if (!logicalLedgerId) {
    throw new Error('Favorite physical shard allocation requires a logical ledger id.')
  }
  const requestedCapacity = options.maxMembersPerShard ?? REMOTE_FAVORITE_SHARD_CAPACITY
  const maxMembersPerShard = Number.isFinite(requestedCapacity) && requestedCapacity > 0
    ? Math.min(Math.floor(requestedCapacity), REMOTE_FAVORITE_SHARD_CAPACITY)
    : REMOTE_FAVORITE_SHARD_CAPACITY
  const workingShards = options.shards
    .map((shard) => ({
      ...shard,
      logicalLedgerId: resolvedLogicalLedgerId(shard),
      shardNumber: getFavoritePhysicalShardNumber(shard.title),
      occupiedAids: new Set([...uniqueValidAids(shard.memberAids), ...uniqueValidAids(shard.reservedAids ?? [])])
    }))
    .sort(comparePhysicalShards)
  if (workingShards.some((shard) => shard.logicalLedgerId !== logicalLedgerId)) {
    throw new Error('Favorite physical shard allocation received a shard from another logical ledger.')
  }
  const existingAids = new Set(workingShards.flatMap((shard) => Array.from(shard.occupiedAids)))
  const requestedAids = uniqueValidAids(options.requestedAids).filter((aid) => !existingAids.has(aid))
  const assignments: Array<{ logicalLedgerId: string; shardId: string; aid: number }> = []
  const createdShards: Array<{ logicalLedgerId: string; id: string; title: string; shardNumber: number }> = []

  for (const aid of requestedAids) {
    let target = [...workingShards]
      .reverse()
      .find((shard) => shard.occupiedAids.size < maxMembersPerShard)
    if (!target) {
      const shardNumber = Math.max(0, ...workingShards.map((shard) => shard.shardNumber)) + 1
      const title = getFavoritePhysicalShardTitle(options.logicalTitle, shardNumber)
      const created = await options.createShard(logicalLedgerId, title, shardNumber)
      if (!created) {
        return {
          status: 'paused' as const,
          reason: 'create-shard-failed' as const,
          failedAid: aid,
          assignments,
          createdShards
        }
      }
      target = {
        id: created.id,
        logicalLedgerId,
        title,
        shardNumber,
        memberAids: [],
        occupiedAids: new Set<number>()
      }
      workingShards.push(target)
      createdShards.push({ logicalLedgerId, id: created.id, title, shardNumber })
    }
    target.occupiedAids.add(aid)
    assignments.push({ logicalLedgerId, shardId: target.id, aid })
  }

  return {
    status: 'ready' as const,
    assignments,
    createdShards
  }
}
