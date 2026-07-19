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
  remoteTitle: string
  bindingState: 'bound' | 'pending-reconcile'
  knownRemoteFolderIds?: string[]
  remoteMemberCount?: number
}

export type FavoriteRepositoryFrozenSyncOperation = {
  operationKey: string
  aid: number
  kind: 'append' | 'remove'
  folderIds: string[]
}

export type FavoriteRepositoryFrozenSyncPlan = {
  id: string
  accountMid: string
  workspaceId: string
  baselineRevision: number
  createdAt: string
  operations: FavoriteRepositoryFrozenSyncOperation[]
}

export type FavoriteRepositoryWorkspaceRef = {
  workspaceId: string
  accountMid: string
  status: 'scanning' | 'previewing' | 'frozen' | 'executing' | 'reconciling' | 'completed'
  baselineRevision: number
  currentSegmentId: string
  overlayRevision: number
  journalCursor: number
  checksum: string
}

export type FavoriteRepositoryWorkspace = {
  id: string
  accountMid: string
  status: 'scanning' | 'previewing' | 'frozen' | 'executing' | 'reconciling' | 'completed'
  baselineRevision: number
  continuationAids: number[]
  workspaceRef: FavoriteRepositoryWorkspaceRef
  frozenSyncPlan?: FavoriteRepositoryFrozenSyncPlan
}

export type FavoriteRepositorySyncRecord = {
  id: string
  commandId: string
  status: 'pending' | 'succeeded' | 'failed' | 'result-unknown'
  affectedAids: number[]
  updatedAt: string
  reason?: string
  runId?: string
  operationKey?: string
  attempt?: number
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
      type: 'upsert-physical-shard-binding'
      payload: {
        logicalLedgerId: string
        logicalTitle: string
        shardNumber: number
        memberAids: number[]
        remoteTitle: string
        bindingState: 'bound' | 'pending-reconcile'
        remoteFolderId?: string
        knownRemoteFolderIds?: string[]
        remoteMemberCount?: number
      }
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

function isWorkspaceRef(
  value: unknown,
  accountMid: string,
  workspaceId: string,
  status: FavoriteRepositoryWorkspace['status'],
  baselineRevision: number
): value is FavoriteRepositoryWorkspaceRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const ref = value as Record<string, unknown>
  const allowedKeys = new Set([
    'workspaceId', 'accountMid', 'status', 'baselineRevision', 'currentSegmentId',
    'overlayRevision', 'journalCursor', 'checksum'
  ])
  if (Object.keys(ref).some((key) => !allowedKeys.has(key)) ||
    typeof ref.workspaceId !== 'string' || ref.workspaceId.trim() !== workspaceId ||
    typeof ref.accountMid !== 'string' || normalizedAccountMid(ref.accountMid) !== accountMid ||
    ref.status !== status || !Number.isSafeInteger(ref.baselineRevision) || ref.baselineRevision !== baselineRevision ||
    typeof ref.currentSegmentId !== 'string' || !Number.isSafeInteger(ref.overlayRevision) ||
    Number(ref.overlayRevision) < 0 || !Number.isSafeInteger(ref.journalCursor) || Number(ref.journalCursor) < 0 ||
    typeof ref.checksum !== 'string' || !/^[a-f0-9]{64}$/i.test(ref.checksum)) return false
  return true
}

function isFrozenSyncPlan(value: unknown, accountMid: string, workspaceId: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const plan = value as Partial<FavoriteRepositoryFrozenSyncPlan>
  if (typeof plan.id !== 'string' || !plan.id.trim() || typeof plan.accountMid !== 'string' ||
    normalizedAccountMid(plan.accountMid) !== accountMid || typeof plan.workspaceId !== 'string' ||
    plan.workspaceId !== workspaceId || !Number.isSafeInteger(plan.baselineRevision) ||
    Number(plan.baselineRevision) < 0 || typeof plan.createdAt !== 'string' ||
    Number.isNaN(Date.parse(plan.createdAt)) || !Array.isArray(plan.operations)) return false
  const operationKeys = new Set<string>()
  return plan.operations.every((operation) => {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) return false
    const record = operation as Partial<FavoriteRepositoryFrozenSyncOperation>
    if (typeof record.operationKey !== 'string' || !record.operationKey.trim() || operationKeys.has(record.operationKey) ||
      !Number.isSafeInteger(record.aid) || Number(record.aid) <= 0 ||
      (record.kind !== 'append' && record.kind !== 'remove') || !Array.isArray(record.folderIds)) return false
    if (!record.folderIds.length || record.folderIds.some((folderId) => typeof folderId !== 'string' || !folderId.trim())) return false
    operationKeys.add(record.operationKey)
    return true
  })
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
    case 'upsert-physical-shard-binding':
      if (typeof payload.logicalLedgerId !== 'string' || !payload.logicalLedgerId.trim() ||
        typeof payload.logicalTitle !== 'string' || !payload.logicalTitle.trim() ||
        !Number.isSafeInteger(payload.shardNumber) || Number(payload.shardNumber) < 1 ||
        !Array.isArray(payload.memberAids) || !isValidAidList(payload.memberAids) ||
        typeof payload.remoteTitle !== 'string' || !payload.remoteTitle.trim() ||
        (payload.bindingState !== 'bound' && payload.bindingState !== 'pending-reconcile') ||
        (payload.remoteFolderId !== undefined && (typeof payload.remoteFolderId !== 'string' || !payload.remoteFolderId.trim())) ||
        (payload.knownRemoteFolderIds !== undefined && (!Array.isArray(payload.knownRemoteFolderIds) ||
          payload.knownRemoteFolderIds.some((id) => typeof id !== 'string' || !id.trim()))) ||
        (payload.remoteMemberCount !== undefined && (!Number.isSafeInteger(payload.remoteMemberCount) || Number(payload.remoteMemberCount) < 0)) ||
        (payload.bindingState === 'bound' && (!payload.remoteFolderId || typeof payload.remoteFolderId !== 'string'))) invalidCommand()
      return
    case 'set-workspace':
      {
        const forbiddenWorkspaceState = [
          'baseline', 'classifications', 'history', 'segments', 'plannedAids', 'protectedAids',
          'baselineCompletedAids', 'videos', 'memberships'
        ]
        if (typeof payload.id !== 'string' || !payload.id.trim() || typeof payload.accountMid !== 'string' ||
          !isWorkspaceStatus(payload.status) || !Number.isSafeInteger(payload.baselineRevision) ||
          Number(payload.baselineRevision) < 0 || !isValidAidList(payload.continuationAids) || payload.continuationAids.length > 0 ||
          forbiddenWorkspaceState.some((key) => key in payload) ||
          !isWorkspaceRef(
            payload.workspaceRef,
            normalizedAccountMid(payload.accountMid),
            payload.id.trim(),
            payload.status,
            Number(payload.baselineRevision)
          ) ||
          (payload.frozenSyncPlan !== undefined && !isFrozenSyncPlan(
            payload.frozenSyncPlan,
            normalizedAccountMid(payload.accountMid),
            payload.id.trim()
          ))) invalidCommand()
        return
      }
    case 'record-sync-result':
      if (typeof payload.id !== 'string' || !payload.id.trim() || typeof payload.commandId !== 'string' ||
        !payload.commandId.trim() || !isSyncStatus(payload.status) || !isValidAidList(payload.affectedAids) ||
        typeof payload.updatedAt !== 'string' || (payload.reason !== undefined && typeof payload.reason !== 'string') ||
        (payload.runId !== undefined && (typeof payload.runId !== 'string' || !payload.runId.trim())) ||
        (payload.operationKey !== undefined && (typeof payload.operationKey !== 'string' || !payload.operationKey.trim())) ||
        (payload.attempt !== undefined && (!Number.isSafeInteger(payload.attempt) || Number(payload.attempt) < 1))) invalidCommand()
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
  let folders = [...snapshot.folders]
  let physicalShards = [...snapshot.physicalShards]

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
    case 'upsert-physical-shard-binding': {
      const logicalLedgerId = command.payload.logicalLedgerId.trim()
      const logicalTitle = command.payload.logicalTitle.trim()
      const folderId = `bilimi:${logicalLedgerId}:${String(command.payload.shardNumber).padStart(3, '0')}`
      const remoteFolderId = command.payload.remoteFolderId?.trim()
      const bindingState = command.payload.bindingState
      affectedFolderIds = [folderId]
      affectedAids = uniquePositiveAids(command.payload.memberAids)
      const existingLogical = folders.find((folder) => folder.kind === 'bilimi-logical' && folder.logicalLedgerId === logicalLedgerId)
      if (existingLogical && existingLogical.title !== logicalTitle) {
        throw new Error('Favorite repository logical ledger title is immutable.')
      }
      if (!existingLogical) {
        folders = [...folders, {
          id: `bilimi-logical:${logicalLedgerId}`,
          title: logicalTitle,
          kind: 'bilimi-logical',
          logicalLedgerId,
          syncState: bindingState
        }]
      } else {
        folders = folders.map((folder) => folder === existingLogical ? { ...folder, syncState: bindingState } : folder)
      }
      const existingShard = physicalShards.find((shard) => shard.logicalLedgerId === logicalLedgerId && shard.shardNumber === command.payload.shardNumber)
      if (existingShard?.remoteFolderId && remoteFolderId && existingShard.remoteFolderId !== remoteFolderId) {
        throw new Error('Favorite repository physical shard binding is immutable.')
      }
      physicalShards = [
        ...physicalShards.filter((shard) => shard !== existingShard),
        {
          logicalLedgerId,
          folderId,
          shardNumber: command.payload.shardNumber,
          remoteTitle: command.payload.remoteTitle.trim(),
          bindingState,
          ...(remoteFolderId ? { remoteFolderId } : {}),
          ...(bindingState === 'pending-reconcile' ? {
            knownRemoteFolderIds: [...new Set(command.payload.knownRemoteFolderIds?.map((id) => id.trim()).filter(Boolean) ?? [])].sort()
          } : {}),
          ...(command.payload.remoteMemberCount !== undefined ? { remoteMemberCount: command.payload.remoteMemberCount } : {})
        }
      ].sort((left, right) => left.logicalLedgerId.localeCompare(right.logicalLedgerId) || left.shardNumber - right.shardNumber)
      memberships = { ...memberships, [folderId]: affectedAids }
      break
    }
    case 'set-workspace':
      if (normalizedAccountMid(command.payload.accountMid) !== snapshot.accountMid) {
        throw new Error('Favorite repository account mismatch.')
      }
      const advancesCompletedPlan = snapshot.workspace?.status === 'completed' && snapshot.workspace.frozenSyncPlan &&
        snapshot.workspace.id !== command.payload.id.trim() && command.payload.status === 'scanning' &&
        command.payload.baselineRevision === 0 && command.payload.frozenSyncPlan === undefined
      if (snapshot.workspace?.frozenSyncPlan && !advancesCompletedPlan && (snapshot.workspace.id !== command.payload.id ||
        JSON.stringify(snapshot.workspace.frozenSyncPlan) !== JSON.stringify(command.payload.frozenSyncPlan))) {
        throw new Error('Favorite sync plan is immutable.')
      }
      workspace = {
        id: command.payload.id.trim(),
        accountMid: snapshot.accountMid,
        status: command.payload.status,
        baselineRevision: command.payload.baselineRevision,
        continuationAids: [],
        workspaceRef: {
          ...command.payload.workspaceRef,
          workspaceId: command.payload.id.trim(),
          accountMid: snapshot.accountMid,
          status: command.payload.status,
          baselineRevision: command.payload.baselineRevision,
          currentSegmentId: command.payload.workspaceRef.currentSegmentId.trim(),
          checksum: command.payload.workspaceRef.checksum.toLowerCase()
        },
        ...(command.payload.frozenSyncPlan ? {
          frozenSyncPlan: {
            ...command.payload.frozenSyncPlan,
            accountMid: snapshot.accountMid,
            operations: command.payload.frozenSyncPlan.operations.map((operation) => ({
              ...operation,
              folderIds: [...new Set(operation.folderIds.map((folderId) => folderId.trim()).filter(Boolean))]
            }))
          }
        } : {})
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
    folders,
    memberships,
    physicalShards,
    workspace,
    syncRecords,
    commandId: command.id,
    affectedFolderIds,
    affectedAids
  }
}
