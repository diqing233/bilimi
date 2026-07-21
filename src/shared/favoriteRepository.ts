export type FavoriteRepositoryLocalPlanPayload = {
  workspaceId: string
  memberAidsByFolderId: Record<string, number[]>
  folders?: Array<Pick<FavoriteRepositoryFolder, 'id' | 'title' | 'kind' | 'syncState'>>
  videos?: FavoriteRepositoryVideo[]
  organizationRecords?: FavoriteRepositoryOrganizationRecord[]
  workspace?: FavoriteRepositoryWorkspace
}

/** Main-process snapshot of the account's current Bilibili source folders. */
export type FavoriteRepositoryBilibiliMirrorPayload = {
  workspaceId: string
  memberAidsByFolderId: Record<string, number[]>
  folders: Array<Pick<FavoriteRepositoryFolder, 'id' | 'title' | 'remoteFolderId'>>
  videos: FavoriteRepositoryVideo[]
}

export type FavoriteRepositoryVideo = {
  aid: number
  title: string
  author?: string
  description?: string
  tags: string[]
  bvid?: string
  cid?: number
  durationSeconds?: number
  category?: string
  favoriteAt?: string
  scannedAt?: string
  coverUrl?: string
  updatedAt: string
}

/** Local, account-scoped metadata mirror. It never describes a Bilibili write. */
export type FavoriteLibraryMirrorRecord = {
  aid: number
  status: 'never' | 'refreshing' | 'synced' | 'failed'
  metadataRevision: number
  lastSyncedAt?: string
  errorCode?: 'network' | 'unavailable' | 'account-changed'
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
  completionMode?: 'bilibili' | 'local'
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
  targetFolderIds?: string[]
  attempt?: number
}

/** A successful organization protects this aid in future incremental scans. */
export type FavoriteRepositoryOrganizationRecord = {
  accountMid: string
  aid: number
  targetFolderIds: string[]
  completedAt: string
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
      type: 'record-library-mirror'
      payload: FavoriteLibraryMirrorRecord
    }
  | {
      id: string
      accountMid: string
      issuedAt: string
      type: 'record-bilibili-mirror'
      payload: FavoriteRepositoryBilibiliMirrorPayload
    }
  | {
      id: string
      accountMid: string
      issuedAt: string
      type: 'clear-bilibili-mirror'
      payload: Record<string, never>
    }
  | {
      id: string
      accountMid: string
      issuedAt: string
      type: 'clear-local-repository'
      payload: Record<string, never>
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
      type: 'abandon-frozen-workspace'
      payload: { workspaceId: string; frozenPlanId: string }
    }
  | {
      id: string
      accountMid: string
      issuedAt: string
      type: 'record-sync-result'
      payload: FavoriteRepositorySyncRecord
    }
  | {
      id: string
      accountMid: string
      issuedAt: string
      type: 'record-organization-protections'
      payload: { records: FavoriteRepositoryOrganizationRecord[]; markMigrationInitialized?: boolean; replace?: boolean }
    }

export type AccountFavoriteRepositorySnapshot = {
  version: 1
  accountMid: string
  revision: number
  updatedAt: string
  videos: Record<string, FavoriteRepositoryVideo>
  libraryMirrors: Record<string, FavoriteLibraryMirrorRecord>
  folders: FavoriteRepositoryFolder[]
  memberships: FavoriteRepositoryMembershipIndex
  physicalShards: FavoriteRepositoryPhysicalShard[]
  workspace?: FavoriteRepositoryWorkspace
  syncRecords: FavoriteRepositorySyncRecord[]
  organizationRecords: FavoriteRepositoryOrganizationRecord[]
  organizationMigrationInitialized: boolean
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

function isOrganizationRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.accountMid === 'string' && typeof record.aid === 'number' &&
    Number.isSafeInteger(record.aid) && record.aid > 0 && Array.isArray(record.targetFolderIds) &&
    record.targetFolderIds.every((id) => typeof id === 'string' && Boolean(id.trim())) &&
    typeof record.completedAt === 'string' && !Number.isNaN(Date.parse(record.completedAt))
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

function isRepositoryVideo(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const video = value as Record<string, unknown>
  return Number.isSafeInteger(video.aid) && Number(video.aid) > 0 && typeof video.title === 'string' &&
    Array.isArray(video.tags) && video.tags.every((tag) => typeof tag === 'string') &&
    typeof video.updatedAt === 'string' &&
    (video.author === undefined || typeof video.author === 'string') &&
    (video.description === undefined || typeof video.description === 'string')
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
      if (payload.folders !== undefined && (!Array.isArray(payload.folders) || payload.folders.some((folder) =>
        !folder || typeof folder !== 'object' || Array.isArray(folder) ||
        typeof (folder as Record<string, unknown>).id !== 'string' || !(folder as Record<string, unknown>).id.trim() ||
        typeof (folder as Record<string, unknown>).title !== 'string' || !(folder as Record<string, unknown>).title.trim() ||
         (folder as Record<string, unknown>).kind !== 'local' || (folder as Record<string, unknown>).syncState !== 'local-only'))) invalidCommand()
      if (payload.videos !== undefined && (!Array.isArray(payload.videos) || payload.videos.some((video) =>
        !video || typeof video !== 'object' || Array.isArray(video) ||
        !Number.isSafeInteger((video as Record<string, unknown>).aid) || Number((video as Record<string, unknown>).aid) <= 0 ||
        typeof (video as Record<string, unknown>).title !== 'string' ||
        !Array.isArray((video as Record<string, unknown>).tags) ||
        !(video as Record<string, unknown>).tags?.every((tag) => typeof tag === 'string') ||
        typeof (video as Record<string, unknown>).updatedAt !== 'string' ||
        ((video as Record<string, unknown>).author !== undefined && typeof (video as Record<string, unknown>).author !== 'string') ||
        ((video as Record<string, unknown>).description !== undefined && typeof (video as Record<string, unknown>).description !== 'string')))) invalidCommand()
      if (payload.organizationRecords !== undefined && (!Array.isArray(payload.organizationRecords) ||
        !payload.organizationRecords.every(isOrganizationRecord))) invalidCommand()
      if (payload.workspace !== undefined) {
        const workspace = payload.workspace as Record<string, unknown>
        if (!workspace || typeof workspace !== 'object' || Array.isArray(workspace) ||
          workspace.status !== 'completed' || workspace.completionMode !== 'local' ||
          !isWorkspaceRef(workspace.workspaceRef, normalizedAccountMid(record.accountMid), String(workspace.id ?? '').trim(), 'completed', Number(workspace.baselineRevision)) ||
          workspace.frozenSyncPlan !== undefined) invalidCommand()
      }
      return
    }
    case 'upsert-video':
      if (!Number.isSafeInteger(payload.aid) || Number(payload.aid) <= 0 || typeof payload.title !== 'string' ||
        !Array.isArray(payload.tags) || !payload.tags.every((tag) => typeof tag === 'string') || typeof payload.updatedAt !== 'string' ||
        (payload.author !== undefined && typeof payload.author !== 'string') ||
        (payload.description !== undefined && typeof payload.description !== 'string')) invalidCommand()
      return
    case 'record-library-mirror':
      if (!Number.isSafeInteger(payload.aid) || Number(payload.aid) <= 0 ||
        !['never', 'refreshing', 'synced', 'failed'].includes(String(payload.status)) ||
        !Number.isSafeInteger(payload.metadataRevision) || Number(payload.metadataRevision) < 0 ||
        (payload.lastSyncedAt !== undefined && (typeof payload.lastSyncedAt !== 'string' || Number.isNaN(Date.parse(payload.lastSyncedAt)))) ||
        (payload.errorCode !== undefined && !['network', 'unavailable', 'account-changed'].includes(String(payload.errorCode)))) invalidCommand()
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
          )) || (payload.completionMode !== undefined && payload.completionMode !== 'bilibili' && payload.completionMode !== 'local')) invalidCommand()
        return
      }
    case 'abandon-frozen-workspace':
      if (typeof payload.workspaceId !== 'string' || !payload.workspaceId.trim() ||
        typeof payload.frozenPlanId !== 'string' || !payload.frozenPlanId.trim()) invalidCommand()
      return
    case 'record-bilibili-mirror':
      if (typeof payload.workspaceId !== 'string' || !payload.workspaceId.trim() ||
        !payload.memberAidsByFolderId || typeof payload.memberAidsByFolderId !== 'object' || Array.isArray(payload.memberAidsByFolderId) ||
        !Array.isArray(payload.folders) || payload.folders.some((folder) => !folder || typeof folder !== 'object' || Array.isArray(folder) ||
          typeof (folder as Record<string, unknown>).id !== 'string' || !(folder as Record<string, unknown>).id.trim() ||
          !String((folder as Record<string, unknown>).id).startsWith('bilibili:') ||
          typeof (folder as Record<string, unknown>).title !== 'string' || !(folder as Record<string, unknown>).title.trim() ||
          typeof (folder as Record<string, unknown>).remoteFolderId !== 'string' || !(folder as Record<string, unknown>).remoteFolderId.trim()) ||
        !Array.isArray(payload.videos) || !payload.videos.every(isRepositoryVideo)) invalidCommand()
      for (const [folderId, aids] of Object.entries(payload.memberAidsByFolderId as Record<string, unknown>)) {
        if (!folderId.trim().startsWith('bilibili:') || !isValidAidList(aids)) invalidCommand()
      }
      return
    case 'clear-bilibili-mirror':
      if (Object.keys(payload).length !== 0) invalidCommand()
      return
    case 'clear-local-repository':
      if (Object.keys(payload).length !== 0) invalidCommand()
      return
    case 'record-sync-result':
      if (typeof payload.id !== 'string' || !payload.id.trim() || typeof payload.commandId !== 'string' ||
        !payload.commandId.trim() || !isSyncStatus(payload.status) || !isValidAidList(payload.affectedAids) ||
        typeof payload.updatedAt !== 'string' || (payload.reason !== undefined && typeof payload.reason !== 'string') ||
        (payload.runId !== undefined && (typeof payload.runId !== 'string' || !payload.runId.trim())) ||
        (payload.operationKey !== undefined && (typeof payload.operationKey !== 'string' || !payload.operationKey.trim())) ||
        (payload.targetFolderIds !== undefined && (!Array.isArray(payload.targetFolderIds) ||
          payload.targetFolderIds.some((id) => typeof id !== 'string' || !id.trim()))) ||
        (payload.attempt !== undefined && (!Number.isSafeInteger(payload.attempt) || Number(payload.attempt) < 1))) invalidCommand()
      return
    case 'record-organization-protections':
      if (!Array.isArray(payload.records) || !payload.records.every(isOrganizationRecord) ||
        (payload.markMigrationInitialized !== undefined && typeof payload.markMigrationInitialized !== 'boolean') ||
        (payload.replace !== undefined && typeof payload.replace !== 'boolean')) invalidCommand()
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
    libraryMirrors: {},
    folders: [],
    memberships: {},
    physicalShards: [],
    syncRecords: [],
    organizationRecords: [],
    organizationMigrationInitialized: false
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
  let organizationRecords = [...snapshot.organizationRecords]
  let organizationMigrationInitialized = snapshot.organizationMigrationInitialized
  let videos = { ...snapshot.videos }
  let libraryMirrors = { ...snapshot.libraryMirrors }
  let folders = [...snapshot.folders]
  let physicalShards = [...snapshot.physicalShards]

  switch (command.type) {
    case 'commit-local-plan': {
      const membersByFolderId = normalizeFolderMembers(command.payload.memberAidsByFolderId)
      affectedFolderIds = [...membersByFolderId.keys()].sort()
      affectedAids = uniquePositiveAids([...membersByFolderId.values()].flat()).sort((left, right) => left - right)
      memberships = {
        ...memberships,
        ...Object.fromEntries(Array.from(membersByFolderId, ([folderId, aids]) => [
          folderId,
          uniquePositiveAids([...(memberships[folderId] ?? []), ...aids])
        ]))
      }
      for (const video of command.payload.videos ?? []) {
        videos[String(video.aid)] = { ...video, tags: [...video.tags] }
      }
      if (command.payload.organizationRecords) {
        const records = new Map(organizationRecords.map((record) => [record.aid, record]))
        for (const record of command.payload.organizationRecords) {
          if (normalizedAccountMid(record.accountMid) !== snapshot.accountMid) {
            throw new Error('Favorite repository account mismatch.')
          }
          const existing = records.get(record.aid)
          records.set(record.aid, {
            accountMid: snapshot.accountMid,
            aid: record.aid,
            targetFolderIds: [...new Set([...(existing?.targetFolderIds ?? []), ...record.targetFolderIds]
              .map((id) => id.trim()).filter(Boolean))].sort(),
            completedAt: existing?.completedAt ?? normalizedTimestamp(record.completedAt)
          })
        }
        organizationRecords = Array.from(records.values()).sort((left, right) => left.aid - right.aid)
      }
      const requestedFolders = command.payload.folders ?? []
      for (const folder of requestedFolders) {
        const id = folder.id.trim()
        const existing = folders.find((candidate) => candidate.id === id)
        if (existing && (existing.kind !== 'local' || existing.title !== folder.title.trim())) {
          throw new Error('Favorite repository local folder is immutable.')
        }
        if (!existing) folders = [...folders, { id, title: folder.title.trim(), kind: 'local', syncState: 'local-only' }]
      }
      if (command.payload.workspace) {
        const localWorkspace = command.payload.workspace
        workspace = {
          id: localWorkspace.id.trim(),
          accountMid: snapshot.accountMid,
          status: 'completed',
          baselineRevision: localWorkspace.baselineRevision,
          continuationAids: [],
          workspaceRef: {
            ...localWorkspace.workspaceRef,
            workspaceId: localWorkspace.id.trim(),
            accountMid: snapshot.accountMid,
            status: 'completed',
            baselineRevision: localWorkspace.baselineRevision,
            currentSegmentId: localWorkspace.workspaceRef.currentSegmentId.trim(),
            checksum: localWorkspace.workspaceRef.checksum.toLowerCase()
          },
          completionMode: 'local'
        }
      }
      break
    }
    case 'upsert-video':
      affectedAids = [command.payload.aid]
      videos[String(command.payload.aid)] = { ...command.payload, tags: [...command.payload.tags] }
      break
    case 'record-library-mirror':
      affectedAids = [command.payload.aid]
      libraryMirrors[String(command.payload.aid)] = { ...command.payload }
      break
    case 'record-bilibili-mirror': {
      const membersByFolderId = normalizeFolderMembers(command.payload.memberAidsByFolderId)
      const mirrorFolders = command.payload.folders.map((folder) => ({
        id: folder.id.trim(), title: folder.title.trim(), remoteFolderId: folder.remoteFolderId!.trim()
      })).sort((left, right) => left.id.localeCompare(right.id))
      const folderIds = new Set(mirrorFolders.map((folder) => folder.id))
      if (folderIds.size !== mirrorFolders.length || [...membersByFolderId.keys()].some((folderId) => !folderIds.has(folderId))) {
        throw new Error('Favorite Bilibili mirror folders are invalid.')
      }
      const removedFolderIds = folders.filter((folder) => folder.kind === 'bilibili').map((folder) => folder.id)
      folders = [...folders.filter((folder) => folder.kind !== 'bilibili'), ...mirrorFolders.map((folder) => ({
        ...folder, kind: 'bilibili' as const, syncState: 'bound' as const
      }))]
      memberships = Object.fromEntries(Object.entries(memberships).filter(([folderId]) => !removedFolderIds.includes(folderId)))
      for (const folder of mirrorFolders) memberships[folder.id] = membersByFolderId.get(folder.id) ?? []
      const mirroredAids = new Set([...membersByFolderId.values()].flat())
      const retainedAids = new Set(Object.values(memberships).flat())
      for (const [aid, video] of Object.entries(videos)) {
        if (!mirroredAids.has(Number(aid)) && !retainedAids.has(Number(aid))) delete videos[aid]
        else videos[aid] = video
      }
      for (const video of command.payload.videos) {
        const existing = videos[String(video.aid)]
        videos[String(video.aid)] = {
          ...video,
          ...(existing?.author && !video.author ? { author: existing.author } : {}),
          ...(existing?.description && !video.description ? { description: existing.description } : {}),
          tags: video.tags.length ? [...video.tags] : [...(existing?.tags ?? [])],
          updatedAt: existing?.updatedAt ?? video.updatedAt
        }
      }
      affectedFolderIds = [...folderIds].sort()
      affectedAids = [...mirroredAids].sort((left, right) => left - right)
      break
    }
    case 'clear-bilibili-mirror': {
      const removedFolderIds = folders.filter((folder) => folder.kind === 'bilibili').map((folder) => folder.id)
      affectedFolderIds = [...removedFolderIds].sort()
      const removedAids = new Set(removedFolderIds.flatMap((folderId) => memberships[folderId] ?? []))
      folders = folders.filter((folder) => folder.kind !== 'bilibili')
      memberships = Object.fromEntries(Object.entries(memberships).filter(([folderId]) => !removedFolderIds.includes(folderId)))
      const retainedAids = new Set(Object.values(memberships).flat())
      for (const aid of removedAids) {
        delete libraryMirrors[String(aid)]
        if (!retainedAids.has(aid)) {
          delete videos[String(aid)]
        }
      }
      affectedAids = [...removedAids].sort((left, right) => left - right)
      break
    }
    case 'clear-local-repository': {
      affectedFolderIds = folders.map((folder) => folder.id).sort()
      affectedAids = uniquePositiveAids(Object.values(memberships).flat()).sort((left, right) => left - right)
      memberships = {}
      videos = {}
      libraryMirrors = {}
      folders = []
      physicalShards = []
      syncRecords = []
      organizationRecords = []
      organizationMigrationInitialized = false
      workspace = undefined
      break
    }
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
        } : {}),
        ...(command.payload.completionMode ? { completionMode: command.payload.completionMode } : {})
      }
      break
    case 'abandon-frozen-workspace':
      if (!workspace?.frozenSyncPlan || workspace.id !== command.payload.workspaceId.trim() ||
        workspace.frozenSyncPlan.id !== command.payload.frozenPlanId.trim()) {
        throw new Error('Favorite frozen workspace does not match the abandoned plan.')
      }
      workspace = undefined
      break
    case 'record-sync-result':
      affectedAids = uniquePositiveAids(command.payload.affectedAids).sort((left, right) => left - right)
      syncRecords = [...syncRecords.filter((record) => record.id !== command.payload.id), { ...command.payload, affectedAids }]
      break
    case 'record-organization-protections': {
      const records = new Map((command.payload.replace ? [] : organizationRecords).map((record) => [record.aid, record]))
      for (const record of command.payload.records) {
        if (normalizedAccountMid(record.accountMid) !== snapshot.accountMid) {
          throw new Error('Favorite repository account mismatch.')
        }
        const existing = records.get(record.aid)
        records.set(record.aid, {
          accountMid: snapshot.accountMid,
          aid: record.aid,
          targetFolderIds: [...new Set([...(existing?.targetFolderIds ?? []), ...record.targetFolderIds]
            .map((id) => id.trim()).filter(Boolean))].sort(),
          completedAt: existing?.completedAt ?? normalizedTimestamp(record.completedAt)
        })
      }
      organizationRecords = Array.from(records.values()).sort((left, right) => left.aid - right.aid)
      organizationMigrationInitialized = organizationMigrationInitialized || command.payload.markMigrationInitialized === true
      affectedAids = command.payload.records.map((record) => record.aid).sort((left, right) => left - right)
      break
    }
  }

  return {
    ...snapshot,
    revision: snapshot.revision + 1,
    updatedAt: new Date(Math.max(Date.parse(snapshot.updatedAt), Date.parse(normalizedAcceptedAt))).toISOString(),
    videos,
    libraryMirrors,
    folders,
    memberships,
    physicalShards,
    workspace,
    syncRecords,
    organizationRecords,
    organizationMigrationInitialized,
    commandId: command.id,
    affectedFolderIds,
    affectedAids
  }
}
