export type FavoriteRepositoryLocalPlanPayload = {
  workspaceId: string
  memberAidsByFolderId: Record<string, number[]>
}

export type FavoriteRepositoryVideo = {
  aid: number
  title: string
  author?: string
  description?: string
  tags: string[]
  updatedAt: string
}

export type FavoriteRepositoryFolder = {
  id: string
  title: string
  kind: 'bilibili' | 'bilimi-logical' | 'local'
  logicalLedgerId?: string
  remoteFolderId?: string
  syncState: 'local-only' | 'bound' | 'pending-reconcile' | 'failed'
}

export type FavoriteRepositoryMembershipIndex = Record<string, number[]>

export type FavoriteRepositoryPhysicalShard = {
  logicalLedgerId: string
  folderId: string
  shardNumber: number
  remoteFolderId?: string
}

export type FavoriteRepositoryWorkspace = {
  id: string
  accountMid: string
  status: 'scanning' | 'previewing' | 'frozen' | 'executing' | 'reconciling' | 'completed'
  baselineRevision: number
  continuationAids: number[]
}

export type FavoriteRepositorySyncRecord = {
  id: string
  commandId: string
  status: 'pending' | 'succeeded' | 'failed' | 'result-unknown'
  affectedAids: number[]
  updatedAt: string
  reason?: string
}

export type FavoriteRepositoryPage<T> = {
  version: 1
  accountMid: string
  items: T[]
  nextCursor?: string
  revision: number
}

export type FavoriteRepositoryCommand =
  | {
      id: string
      accountMid: string
      issuedAt: string
      type: 'commit-local-plan'
      payload: FavoriteRepositoryLocalPlanPayload
    }
  | {
      id: string
      accountMid: string
      issuedAt: string
      type: 'upsert-video'
      payload: FavoriteRepositoryVideo
    }
  | {
      id: string
      accountMid: string
      issuedAt: string
      type: 'set-folder-members'
      payload: { folderId: string; aids: number[] }
    }
  | {
      id: string
      accountMid: string
      issuedAt: string
      type: 'set-workspace'
      payload: FavoriteRepositoryWorkspace
    }
  | {
      id: string
      accountMid: string
      issuedAt: string
      type: 'record-sync-result'
      payload: FavoriteRepositorySyncRecord
    }

export type AccountFavoriteRepositorySnapshot = {
  version: 1
  accountMid: string
  revision: number
  updatedAt: string
  videos: Record<string, FavoriteRepositoryVideo>
  folders: FavoriteRepositoryFolder[]
  memberships: FavoriteRepositoryMembershipIndex
  physicalShards: FavoriteRepositoryPhysicalShard[]
  workspace?: FavoriteRepositoryWorkspace
  syncRecords: FavoriteRepositorySyncRecord[]
}

export type FavoriteRepositoryCommandResult = AccountFavoriteRepositorySnapshot & {
  commandId: string
  affectedFolderIds: string[]
  affectedAids: number[]
}

function normalizedAccountMid(value: string) {
  const accountMid = value.trim()
  if (!/^\d+$/.test(accountMid) || BigInt(accountMid) === 0n) {
    throw new Error('Favorite repository account is invalid.')
  }
  return BigInt(accountMid).toString()
}

function uniquePositiveAids(aids: number[]) {
  return [...new Set(aids.filter((aid) => Number.isSafeInteger(aid) && aid > 0))]
    .sort((left, right) => left - right)
}

function invalidCommand(): never {
  throw new Error('Favorite repository command is invalid.')
}

function normalizedTimestamp(value: string) {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) throw new Error('Favorite repository timestamp is invalid.')
  return new Date(timestamp).toISOString()
}

function isValidAidList(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((aid) => Number.isSafeInteger(aid) && aid > 0)
}

function isWorkspaceStatus(value: unknown): value is FavoriteRepositoryWorkspace['status'] {
  return ['scanning', 'previewing', 'frozen', 'executing', 'reconciling', 'completed'].includes(String(value))
}

function isSyncStatus(value: unknown): value is FavoriteRepositorySyncRecord['status'] {
  return ['pending', 'succeeded', 'failed', 'result-unknown'].includes(String(value))
}

function normalizeFolderMembers(memberAidsByFolderId: Record<string, number[]>) {
  const normalized = new Map<string, number[]>()
  for (const [rawFolderId, rawAids] of Object.entries(memberAidsByFolderId)) {
    const folderId = rawFolderId.trim()
    if (!folderId || !Array.isArray(rawAids)) invalidCommand()
    normalized.set(folderId, uniquePositiveAids([...(normalized.get(folderId) ?? []), ...rawAids]))
  }
  return normalized
}

function validateCommand(command: unknown): asserts command is FavoriteRepositoryCommand {
  if (!command || typeof command !== 'object') invalidCommand()
  const record = command as Record<string, unknown>
  if (typeof record.id !== 'string' || !record.id.trim() || typeof record.accountMid !== 'string' ||
    typeof record.issuedAt !== 'string' || !record.issuedAt) invalidCommand()
  if (!record.payload || typeof record.payload !== 'object' || Array.isArray(record.payload)) invalidCommand()
  const payload = record.payload as Record<string, unknown>
  switch (record.type) {
    case 'commit-local-plan': {
      if (typeof payload.workspaceId !== 'string' || !payload.workspaceId.trim() ||
        !payload.memberAidsByFolderId || typeof payload.memberAidsByFolderId !== 'object' ||
        Array.isArray(payload.memberAidsByFolderId)) invalidCommand()
      for (const aids of Object.values(payload.memberAidsByFolderId as Record<string, unknown>)) {
        if (!isValidAidList(aids)) invalidCommand()
      }
      return
    }
    case 'upsert-video':
      if (!Number.isSafeInteger(payload.aid) || Number(payload.aid) <= 0 || typeof payload.title !== 'string' ||
        !Array.isArray(payload.tags) || !payload.tags.every((tag) => typeof tag === 'string') || typeof payload.updatedAt !== 'string' ||
        (payload.author !== undefined && typeof payload.author !== 'string') ||
        (payload.description !== undefined && typeof payload.description !== 'string')) invalidCommand()
      return
    case 'set-folder-members':
      if (typeof payload.folderId !== 'string' || !payload.folderId.trim() || !Array.isArray(payload.aids) ||
        !isValidAidList(payload.aids)) invalidCommand()
      return
    case 'set-workspace':
      if (typeof payload.id !== 'string' || !payload.id.trim() || typeof payload.accountMid !== 'string' ||
        !isWorkspaceStatus(payload.status) || !Number.isSafeInteger(payload.baselineRevision) ||
        Number(payload.baselineRevision) < 0 || !isValidAidList(payload.continuationAids)) invalidCommand()
      return
    case 'record-sync-result':
      if (typeof payload.id !== 'string' || !payload.id.trim() || typeof payload.commandId !== 'string' ||
        !payload.commandId.trim() || !isSyncStatus(payload.status) || !isValidAidList(payload.affectedAids) ||
        typeof payload.updatedAt !== 'string' || (payload.reason !== undefined && typeof payload.reason !== 'string')) invalidCommand()
      return
    default:
      invalidCommand()
  }
}

export function createAccountFavoriteRepositorySnapshot(input: {
  accountMid: string
  now: string
}): AccountFavoriteRepositorySnapshot {
  return {
    version: 1,
    accountMid: normalizedAccountMid(input.accountMid),
    revision: 0,
    updatedAt: normalizedTimestamp(input.now),
    videos: {},
    folders: [],
    memberships: {},
    physicalShards: [],
    syncRecords: []
  }
}

export function applyFavoriteRepositoryCommand(
  snapshot: AccountFavoriteRepositorySnapshot,
  command: unknown,
  acceptedAt: string
): FavoriteRepositoryCommandResult {
  validateCommand(command)
  const normalizedAcceptedAt = normalizedTimestamp(acceptedAt)
  if (snapshot.accountMid !== normalizedAccountMid(command.accountMid)) {
    throw new Error('Favorite repository account mismatch.')
  }

  let affectedFolderIds: string[] = []
  let affectedAids: number[] = []
  let memberships = { ...snapshot.memberships }
  let workspace = snapshot.workspace
  let syncRecords = [...snapshot.syncRecords]
  let videos = { ...snapshot.videos }

  switch (command.type) {
    case 'commit-local-plan': {
      const membersByFolderId = normalizeFolderMembers(command.payload.memberAidsByFolderId)
      affectedFolderIds = [...membersByFolderId.keys()].sort()
      affectedAids = uniquePositiveAids([...membersByFolderId.values()].flat()).sort((left, right) => left - right)
      memberships = { ...memberships, ...Object.fromEntries(membersByFolderId) }
      break
    }
    case 'upsert-video':
      affectedAids = [command.payload.aid]
      videos[String(command.payload.aid)] = { ...command.payload, tags: [...command.payload.tags] }
      break
    case 'set-folder-members':
      affectedFolderIds = [command.payload.folderId.trim()]
      affectedAids = uniquePositiveAids(command.payload.aids).sort((left, right) => left - right)
      memberships = { ...memberships, [affectedFolderIds[0]]: affectedAids }
      break
    case 'set-workspace':
      if (normalizedAccountMid(command.payload.accountMid) !== snapshot.accountMid) {
        throw new Error('Favorite repository account mismatch.')
      }
      workspace = {
        ...command.payload,
        accountMid: snapshot.accountMid,
        continuationAids: uniquePositiveAids(command.payload.continuationAids)
      }
      break
    case 'record-sync-result':
      affectedAids = uniquePositiveAids(command.payload.affectedAids).sort((left, right) => left - right)
      syncRecords = [...syncRecords.filter((record) => record.id !== command.payload.id), { ...command.payload, affectedAids }]
      break
  }

  return {
    ...snapshot,
    revision: snapshot.revision + 1,
    updatedAt: new Date(Math.max(Date.parse(snapshot.updatedAt), Date.parse(normalizedAcceptedAt))).toISOString(),
    videos,
    memberships,
    workspace,
    syncRecords,
    commandId: command.id,
    affectedFolderIds,
    affectedAids
  }
}
