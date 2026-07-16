export type FavoritePhysicalShard = {
  id: string
  title: string
  memberAids: number[]
  reservedAids?: number[]
  membershipComplete?: boolean
  isInbox?: boolean
}

export type FavoritePhysicalShardGroup = {
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
    const logicalTitle = getFavoriteLogicalFolderTitle(shard.title)
    const current = groups.get(logicalTitle) ?? {
      logicalTitle,
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
    current.isInbox = current.isInbox || shard.isInbox === true || logicalTitle === 'bilimi·暂存'
    groups.set(logicalTitle, current)
  }
  return Array.from(groups.values())
}

type AllocateFavoritePhysicalShardsOptions = {
  logicalTitle: string
  requestedAids: number[]
  shards: FavoritePhysicalShard[]
  maxMembersPerShard?: number
  createShard: (
    title: string,
    shardNumber: number
  ) => Promise<{ id: string } | null>
}

export async function allocateFavoritePhysicalShards(options: AllocateFavoritePhysicalShardsOptions) {
  const maxMembersPerShard = options.maxMembersPerShard ?? 1000
  const workingShards = options.shards
    .map((shard) => ({
      ...shard,
      shardNumber: getFavoritePhysicalShardNumber(shard.title),
      occupiedAids: new Set([...uniqueValidAids(shard.memberAids), ...uniqueValidAids(shard.reservedAids ?? [])])
    }))
    .sort((left, right) => left.shardNumber - right.shardNumber)
  const existingAids = new Set(workingShards.flatMap((shard) => Array.from(shard.occupiedAids)))
  const requestedAids = uniqueValidAids(options.requestedAids).filter((aid) => !existingAids.has(aid))
  const assignments: Array<{ shardId: string; aid: number }> = []
  const createdShards: Array<{ id: string; title: string; shardNumber: number }> = []

  for (const aid of requestedAids) {
    let target = [...workingShards]
      .reverse()
      .find((shard) => shard.occupiedAids.size < maxMembersPerShard)
    if (!target) {
      const shardNumber = Math.max(0, ...workingShards.map((shard) => shard.shardNumber)) + 1
      const title = getFavoritePhysicalShardTitle(options.logicalTitle, shardNumber)
      const created = await options.createShard(title, shardNumber)
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
        title,
        shardNumber,
        memberAids: [],
        occupiedAids: new Set<number>()
      }
      workingShards.push(target)
      createdShards.push({ id: created.id, title, shardNumber })
    }
    target.occupiedAids.add(aid)
    assignments.push({ shardId: target.id, aid })
  }

  return {
    status: 'ready' as const,
    assignments,
    createdShards
  }
}
