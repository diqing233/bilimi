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
  /** A tag endpoint or page payload confirmed this tag list, including an empty list. */
  tagEvidence?: 'confirmed'
  bvid?: string
  cid?: number
  durationSeconds?: number
  category?: string
  favoriteAt?: string
  scannedAt?: string
  coverUrl?: string
  updatedAt: string
}

export type FavoriteRepositoryPositionState =
  | 'aligned'
  | 'local-only-change'
  | 'syncing'
  | 'failed'
  | 'result-unknown'
  | 'remote-removed'
  | 'target-missing'
  | 'needs-review'

/** Current local intent and last observed remote placement; protection is deliberately not part of this record. */
export type FavoriteRepositoryPositionRecord = {
  accountMid: string
  aid: number
  localDesiredFolderIds: string[]
  remoteObservedPhysicalFolderIds: string[]
  remoteObservedLogicalFolderIds: string[]
  positionState: FavoriteRepositoryPositionState
  observedAt?: string
  updatedAt: string
  reason?: string
  revision: number
}

export type FavoriteRepositoryEventKind =
  | 'entered'
  | 'daily-review'
  | 'old-favorite-organization'
  | 'manual-move'
  | 'scan-observed'
  | 'remote-sync'
  | 'adopt-local'
  | 'adopt-remote'
  | 'transcription'
  | 'archive-registration'

/** Lightweight user-visible history. Technical logs remain outside this model. */
export type FavoriteRepositoryEvent = {
  id: string
  sequence: number
  accountMid: string
  aid: number
  kind: FavoriteRepositoryEventKind
  occurredAt: string
  titleAtTime?: string
  folderTitlesAtTime?: string[]
  detail?: string
}

export type FavoriteRepositoryTombstone = {
  accountMid: string
  aid: number
  deletedAt: string
  reason?: string
  allowRediscovery: boolean
}

export type FavoriteRepositoryArchiveExport = {
  version: 1
  accountMid: string
  generatedAt: string
  /** A checksum of the portable data; credentials and remote authorization are never represented. */
  checksum?: string
  videos?: FavoriteRepositoryVideo[]
  positions?: Array<Pick<FavoriteRepositoryPositionRecord,
    'aid' | 'localDesiredFolderIds' | 'positionState' | 'updatedAt'>>
  protections?: Array<Pick<FavoriteRepositoryOrganizationRecord, 'aid' | 'completedAt'>>
  events?: FavoriteRepositoryEvent[]
  archives: Array<{ aid: number; archiveId: string; registeredAt: string; version?: string }>
}

export function createFavoriteRepositoryPositionKey(accountMid: string, aid: number) {
  return `${normalizedAccountMid(accountMid)}:${aid}`
}

function normalizeFolderIds(folderIds: string[]) {
  return [...new Set(folderIds.map((folderId) => folderId.trim()).filter(Boolean))].sort()
}

export function deriveFavoriteRepositoryPositionState(input: Pick<FavoriteRepositoryPositionRecord,
  'localDesiredFolderIds' | 'remoteObservedPhysicalFolderIds' | 'remoteObservedLogicalFolderIds'> & Partial<Pick<FavoriteRepositoryPositionRecord, 'positionState'>>) {
  const requested = input.positionState
  if (requested && !['aligned', 'local-only-change'].includes(requested)) return requested
  const local = normalizeFolderIds(input.localDesiredFolderIds)
  const remote = normalizeFolderIds(input.remoteObservedLogicalFolderIds)
  return local.length === remote.length && local.every((folderId, index) => folderId === remote[index])
    ? 'aligned'
    : 'local-only-change'
}

export function isFavoriteRepositoryMetadataStale(video: FavoriteRepositoryVideo) {
  return /^video\s*\+\s*id$/i.test(video.title.trim()) || !video.author?.trim()
}

function hasFavoriteRepositoryPlaceholderTitle(video: FavoriteRepositoryVideo) {
  return /^video\s*\+\s*id$/i.test(video.title.trim())
}

/** Never replace confirmed metadata with sparse scan placeholders. */
export function mergeFavoriteRepositoryVideo(existing: FavoriteRepositoryVideo | undefined, incoming: FavoriteRepositoryVideo) {
  if (!existing) return { ...incoming, tags: [...incoming.tags] }
  const incomingIsPlaceholder = hasFavoriteRepositoryPlaceholderTitle(incoming)
  return {
    ...incoming,
    ...(incomingIsPlaceholder && !hasFavoriteRepositoryPlaceholderTitle(existing) ? { title: existing.title } : {}),
    ...(existing.author && !incoming.author ? { author: existing.author } : {}),
    ...(existing.description && !incoming.description ? { description: existing.description } : {}),
    ...(existing.coverUrl && !incoming.coverUrl ? { coverUrl: existing.coverUrl } : {}),
    tags: incoming.tags.length ? [...incoming.tags] : [...existing.tags],
    ...(incoming.tagEvidence ?? existing.tagEvidence ? { tagEvidence: incoming.tagEvidence ?? existing.tagEvidence } : {}),
    updatedAt: existing.updatedAt
  }
}

function sha256(value: string) {
  const bytes = new TextEncoder().encode(value)
  const bitLength = bytes.length * 8
  const paddedLength = (((bytes.length + 9 + 63) >> 6) << 6)
  const padded = new Uint8Array(paddedLength)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(paddedLength - 4, bitLength >>> 0)
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000))
  const words = new Uint32Array(64)
  let h0 = 0x6a09e667; let h1 = 0xbb67ae85; let h2 = 0x3c6ef372; let h3 = 0xa54ff53a
  let h4 = 0x510e527f; let h5 = 0x9b05688c; let h6 = 0x1f83d9ab; let h7 = 0x5be0cd19
  const constants = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index++) words[index] = view.getUint32(offset + index * 4)
    for (let index = 16; index < 64; index++) {
      const a = words[index - 15]; const b = words[index - 2]
      words[index] = (((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3)) + words[index - 16] +
        (((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10)) + words[index - 7]
    }
    let a = h0; let b = h1; let c = h2; let d = h3; let e = h4; let f = h5; let g = h6; let h = h7
    for (let index = 0; index < 64; index++) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      const choice = (e & f) ^ (~e & g)
      const temp1 = (h + s1 + choice + constants[index] + words[index]) >>> 0
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      const majority = (a & b) ^ (a & c) ^ (b & c)
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + s0 + majority) >>> 0
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((part) => part.toString(16).padStart(8, '0')).join('')
}

export function createFavoriteRepositoryArchiveExportChecksum(exported: FavoriteRepositoryArchiveExport) {
  return sha256(JSON.stringify({
    version: exported.version,
    accountMid: normalizedAccountMid(exported.accountMid),
    generatedAt: normalizedTimestamp(exported.generatedAt),
    videos: [...(exported.videos ?? [])].map((video) => ({ ...video, tags: [...video.tags].sort() })).sort((left, right) => left.aid - right.aid),
    positions: [...(exported.positions ?? [])].map((position) => ({
      ...position, localDesiredFolderIds: normalizeFolderIds(position.localDesiredFolderIds)
    })).sort((left, right) => left.aid - right.aid),
    protections: [...(exported.protections ?? [])].map((record) => ({ ...record })).sort((left, right) => left.aid - right.aid),
    events: [...(exported.events ?? [])].map((event) => ({
      ...event, folderTitlesAtTime: event.folderTitlesAtTime ? [...event.folderTitlesAtTime] : undefined
    })).sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id)),
    archives: [...exported.archives].map((archive) => ({ ...archive })).sort((left, right) => left.aid - right.aid || left.archiveId.localeCompare(right.archiveId))
  }))
}

/** Produces a portable, credential-free recovery archive. Remote observations intentionally stay local. */
export function createFavoriteRepositoryArchiveExport(
  snapshot: AccountFavoriteRepositorySnapshot,
  input: { generatedAt: string; events?: FavoriteRepositoryEvent[]; archives?: FavoriteRepositoryArchiveExport['archives'] }
): FavoriteRepositoryArchiveExport & { checksum: string } {
  const accountMid = normalizedAccountMid(snapshot.accountMid)
  const exported: FavoriteRepositoryArchiveExport = {
    version: 1,
    accountMid,
    generatedAt: normalizedTimestamp(input.generatedAt),
    videos: Object.values(snapshot.videos).map((video) => ({ ...video, tags: [...video.tags] })),
    positions: Object.values(snapshot.positions ?? {}).map((position) => ({
      aid: position.aid,
      // A portable archive carries only Bilimi's logical recovery intent;
      // local/physical identifiers belong exclusively to their originating
      // device and must not become remote restore targets.
      localDesiredFolderIds: position.localDesiredFolderIds.filter((folderId) => /^bilimi-logical:\S+$/.test(folderId.trim())),
      positionState: position.positionState,
      updatedAt: position.updatedAt
    })),
    protections: (snapshot.organizationRecords ?? []).map((record) => ({ aid: record.aid, completedAt: record.completedAt })),
    events: (input.events ?? []).filter((event) => normalizedAccountMid(event.accountMid) === accountMid)
      .map((event) => ({ ...event, folderTitlesAtTime: event.folderTitlesAtTime ? [...event.folderTitlesAtTime] : undefined })),
    archives: (input.archives ?? []).map((archive) => ({ ...archive }))
  }
  return { ...exported, checksum: createFavoriteRepositoryArchiveExportChecksum(exported) }
}

/** Validates a portable archive before an importer can create a recovery plan or write anything. */
export function validateFavoriteRepositoryArchiveExport(value: unknown): FavoriteRepositoryArchiveExport & { checksum: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Favorite repository archive is invalid.')
  const archive = value as Record<string, unknown>
  const allowed = new Set(['version', 'accountMid', 'generatedAt', 'checksum', 'videos', 'positions', 'protections', 'events', 'archives'])
  if (Object.keys(archive).some((key) => !allowed.has(key)) || archive.version !== 1 || typeof archive.accountMid !== 'string' ||
    typeof archive.generatedAt !== 'string' || typeof archive.checksum !== 'string' || !/^[a-f0-9]{64}$/i.test(archive.checksum) ||
    !Array.isArray(archive.archives) || !archive.archives.every((item) => item && typeof item === 'object' &&
      Number.isSafeInteger((item as Record<string, unknown>).aid) && Number((item as Record<string, unknown>).aid) > 0 &&
      typeof (item as Record<string, unknown>).archiveId === 'string' && !!String((item as Record<string, unknown>).archiveId).trim() &&
      typeof (item as Record<string, unknown>).registeredAt === 'string' && !Number.isNaN(Date.parse(String((item as Record<string, unknown>).registeredAt))))) {
    throw new Error('Favorite repository archive is invalid.')
  }
  normalizedAccountMid(archive.accountMid)
  normalizedTimestamp(archive.generatedAt)
  if (archive.videos !== undefined && (!Array.isArray(archive.videos) || !archive.videos.every(isRepositoryVideo))) throw new Error('Favorite repository archive is invalid.')
  if (archive.positions !== undefined && (!Array.isArray(archive.positions) || !archive.positions.every((position) =>
    position && typeof position === 'object' && isPositionPayload({
      ...(position as Record<string, unknown>), remoteObservedPhysicalFolderIds: [], remoteObservedLogicalFolderIds: []
    }) && Array.isArray((position as Record<string, unknown>).localDesiredFolderIds) &&
      ((position as Record<string, unknown>).localDesiredFolderIds as unknown[]).every((folderId) =>
        typeof folderId === 'string' && /^bilimi-logical:\S+$/.test(folderId.trim()))))) throw new Error('Favorite repository archive is invalid.')
  if (archive.protections !== undefined && (!Array.isArray(archive.protections) || !archive.protections.every((record) =>
    record && typeof record === 'object' && Number.isSafeInteger((record as Record<string, unknown>).aid) && Number((record as Record<string, unknown>).aid) > 0 &&
    typeof (record as Record<string, unknown>).completedAt === 'string' && !Number.isNaN(Date.parse(String((record as Record<string, unknown>).completedAt)))))) throw new Error('Favorite repository archive is invalid.')
  if (archive.events !== undefined && (!Array.isArray(archive.events) || !archive.events.every((event) =>
    event && typeof event === 'object' && isRepositoryEvent(event as Record<string, unknown>) &&
      (event as Record<string, unknown>).accountMid === archive.accountMid))) throw new Error('Favorite repository archive is invalid.')
  const typed = archive as unknown as FavoriteRepositoryArchiveExport & { checksum: string }
  if (createFavoriteRepositoryArchiveExportChecksum(typed) !== typed.checksum.toLowerCase()) throw new Error('Favorite repository archive checksum is invalid.')
  return typed
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
  /** Trusted remote membership observed while the immutable plan was frozen. */
  beforeFolderIds?: string[]
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
  /** Optional persisted progress summary; full workspace data stays outside this snapshot. */
  currentStep?: 'scanning' | 'previewing' | 'frozen' | 'executing' | 'reconciling' | 'confirmation' | 'result-unknown' | 'completed'
  plannedCount?: number
  classifiedCount?: number
  unclassifiedCount?: number
  updatedAt?: string
  lastCommittedId?: string
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

/** Immutable, account-scoped recovery evidence; it never authorizes a remote write. */
export type FavoriteRepositoryOrganizationChange = {
  id: string
  runId: string
  workspaceId: string
  accountMid: string
  aid: number
  beforeFolderIds: string[]
  afterFolderIds: string[]
  addedFolderIds: string[]
  removedFolderIds: string[]
  status: 'succeeded' | 'failed' | 'result-unknown'
  recordedAt: string
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
      type: 'remove-physical-shard-binding'
      payload: { remoteFolderId: string }
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
      type: 'abandon-workspace'
      payload: { workspaceId: string }
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
  | {
      id: string
      accountMid: string
      issuedAt: string
      type: 'record-organization-change'
      payload: { change: FavoriteRepositoryOrganizationChange }
    }
  | {
      id: string
      accountMid: string
      issuedAt: string
      expectedRevision?: number
      type: 'set-favorite-position' | 'set-favorite-placement'
      payload: Omit<FavoriteRepositoryPositionRecord, 'accountMid' | 'positionState' | 'revision'> & { positionState?: FavoriteRepositoryPositionState }
    }
  | {
      id: string
      accountMid: string
      issuedAt: string
      expectedRevision?: number
      type: 'set-favorite-placements'
      payload: { placements: Array<Omit<FavoriteRepositoryPositionRecord, 'accountMid' | 'positionState' | 'revision'> & { positionState?: FavoriteRepositoryPositionState }> }
    }
  | {
      id: string
      accountMid: string
      issuedAt: string
      expectedRevision?: number
      type: 'record-favorite-event'
      payload: Omit<FavoriteRepositoryEvent, 'accountMid'>
    }
  | {
      id: string
      accountMid: string
      issuedAt: string
      expectedRevision?: number
      type: 'tombstone-favorite-video'
      payload: Omit<FavoriteRepositoryTombstone, 'accountMid'> & { allowRediscovery?: boolean }
    }
  | {
      id: string
      accountMid: string
      issuedAt: string
      expectedRevision?: number
      type: 'delete-favorite-from-library'
      payload: Omit<FavoriteRepositoryTombstone, 'accountMid' | 'allowRediscovery'>
    }
  | {
      id: string
      accountMid: string
      issuedAt: string
      expectedRevision?: number
      type: 'delete-local-managed-folder'
      payload: { logicalFolderId: string }
    }
  | {
      id: string
      accountMid: string
      issuedAt: string
      expectedRevision?: number
      type: 'restore-favorite-to-library' | 'forget-favorite-tombstone'
      payload: { aid: number }
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
  organizationBatches: FavoriteRepositoryOrganizationChange[]
  organizationMigrationInitialized: boolean
  positions: Record<string, FavoriteRepositoryPositionRecord>
  tombstones: Record<string, FavoriteRepositoryTombstone>
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
    'overlayRevision', 'journalCursor', 'checksum', 'currentStep', 'plannedCount',
    'classifiedCount', 'unclassifiedCount', 'updatedAt', 'lastCommittedId'
  ])
  if (Object.keys(ref).some((key) => !allowedKeys.has(key)) ||
    typeof ref.workspaceId !== 'string' || ref.workspaceId.trim() !== workspaceId ||
    typeof ref.accountMid !== 'string' || normalizedAccountMid(ref.accountMid) !== accountMid ||
    ref.status !== status || !Number.isSafeInteger(ref.baselineRevision) || ref.baselineRevision !== baselineRevision ||
    typeof ref.currentSegmentId !== 'string' || !Number.isSafeInteger(ref.overlayRevision) ||
    Number(ref.overlayRevision) < 0 || !Number.isSafeInteger(ref.journalCursor) || Number(ref.journalCursor) < 0 ||
    typeof ref.checksum !== 'string' || !/^[a-f0-9]{64}$/i.test(ref.checksum) ||
    (ref.currentStep !== undefined && !['scanning', 'previewing', 'frozen', 'executing', 'reconciling', 'confirmation', 'result-unknown', 'completed'].includes(String(ref.currentStep))) ||
    ['plannedCount', 'classifiedCount', 'unclassifiedCount'].some((key) => ref[key] !== undefined && (!Number.isSafeInteger(ref[key]) || Number(ref[key]) < 0)) ||
    (ref.updatedAt !== undefined && (typeof ref.updatedAt !== 'string' || Number.isNaN(Date.parse(ref.updatedAt)))) ||
    (ref.lastCommittedId !== undefined && (typeof ref.lastCommittedId !== 'string' || !ref.lastCommittedId.trim()))) return false
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
    if (!record.folderIds.length || record.folderIds.some((folderId) => typeof folderId !== 'string' || !folderId.trim()) ||
      (record.beforeFolderIds !== undefined && (!Array.isArray(record.beforeFolderIds) || record.beforeFolderIds.some((folderId) => typeof folderId !== 'string' || !folderId.trim())))) return false
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

function isOrganizationChange(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const folderIds = ['beforeFolderIds', 'afterFolderIds', 'addedFolderIds', 'removedFolderIds']
  return typeof record.id === 'string' && !!record.id.trim() && typeof record.runId === 'string' && !!record.runId.trim() &&
    typeof record.workspaceId === 'string' && !!record.workspaceId.trim() && typeof record.accountMid === 'string' &&
    Number.isSafeInteger(record.aid) && Number(record.aid) > 0 &&
    folderIds.every((key) => Array.isArray(record[key]) && (record[key] as unknown[]).every((id) => typeof id === 'string' && !!id.trim())) &&
    ['succeeded', 'failed', 'result-unknown'].includes(String(record.status)) &&
    typeof record.recordedAt === 'string' && !Number.isNaN(Date.parse(record.recordedAt))
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
    (video.tagEvidence === undefined || video.tagEvidence === 'confirmed') &&
    typeof video.updatedAt === 'string' &&
    (video.author === undefined || typeof video.author === 'string') &&
    (video.description === undefined || typeof video.description === 'string')
}

function isLocalPlanFolder(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const folder = value as Record<string, unknown>
  return typeof folder.id === 'string' && !!folder.id.trim() && typeof folder.title === 'string' && !!folder.title.trim() &&
    folder.kind === 'local' && folder.syncState === 'local-only'
}

function isBilibiliMirrorFolder(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const folder = value as Record<string, unknown>
  return typeof folder.id === 'string' && folder.id.trim().startsWith('bilibili:') &&
    typeof folder.title === 'string' && !!folder.title.trim() &&
    typeof folder.remoteFolderId === 'string' && !!folder.remoteFolderId.trim()
}

function isPositionState(value: unknown): value is FavoriteRepositoryPositionState {
  return ['aligned', 'local-only-change', 'syncing', 'failed', 'result-unknown', 'remote-removed', 'target-missing', 'needs-review'].includes(String(value))
}

function isPositionPayload(value: Record<string, unknown>) {
  return Number.isSafeInteger(value.aid) && Number(value.aid) > 0 &&
    ['localDesiredFolderIds', 'remoteObservedPhysicalFolderIds', 'remoteObservedLogicalFolderIds'].every((key) =>
      Array.isArray(value[key]) && (value[key] as unknown[]).every((folderId) => typeof folderId === 'string' && !!folderId.trim())) &&
    typeof value.updatedAt === 'string' && !Number.isNaN(Date.parse(value.updatedAt)) &&
    (value.observedAt === undefined || (typeof value.observedAt === 'string' && !Number.isNaN(Date.parse(value.observedAt)))) &&
    (value.reason === undefined || typeof value.reason === 'string') &&
    (value.positionState === undefined || isPositionState(value.positionState))
}

function isPlacementList(value: unknown) {
  return Array.isArray(value) && value.length > 0 && value.length <= 100 && value.every((placement) =>
    placement && typeof placement === 'object' && !Array.isArray(placement) && isPositionPayload(placement as Record<string, unknown>)) &&
    new Set((value as Array<Record<string, unknown>>).map((placement) => Number(placement.aid))).size === value.length
}

function isRepositoryEvent(value: Record<string, unknown>) {
  return typeof value.id === 'string' && !!value.id.trim() && Number.isSafeInteger(value.sequence) && Number(value.sequence) > 0 &&
    Number.isSafeInteger(value.aid) && Number(value.aid) > 0 &&
    ['entered', 'daily-review', 'old-favorite-organization', 'manual-move', 'scan-observed', 'remote-sync', 'adopt-local', 'adopt-remote', 'transcription', 'archive-registration'].includes(String(value.kind)) &&
    typeof value.occurredAt === 'string' && !Number.isNaN(Date.parse(value.occurredAt)) &&
    (value.titleAtTime === undefined || typeof value.titleAtTime === 'string') &&
    (value.folderTitlesAtTime === undefined || (Array.isArray(value.folderTitlesAtTime) && value.folderTitlesAtTime.every((title) => typeof title === 'string'))) &&
    (value.detail === undefined || typeof value.detail === 'string')
}

function validateCommand(command: unknown): asserts command is FavoriteRepositoryCommand {
  if (!command || typeof command !== 'object') invalidCommand()
  const record = command as Record<string, unknown>
  if (typeof record.id !== 'string' || !record.id.trim() || typeof record.accountMid !== 'string' ||
    typeof record.issuedAt !== 'string' || !record.issuedAt) invalidCommand()
  if (record.expectedRevision !== undefined && (!Number.isSafeInteger(record.expectedRevision) || Number(record.expectedRevision) < 0)) invalidCommand()
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
      if (payload.folders !== undefined && (!Array.isArray(payload.folders) || !payload.folders.every(isLocalPlanFolder))) invalidCommand()
      if (payload.videos !== undefined && (!Array.isArray(payload.videos) || payload.videos.some((video) =>
        !video || typeof video !== 'object' || Array.isArray(video) ||
        !Number.isSafeInteger((video as Record<string, unknown>).aid) || Number((video as Record<string, unknown>).aid) <= 0 ||
        typeof (video as Record<string, unknown>).title !== 'string' ||
        !Array.isArray((video as Record<string, unknown>).tags) ||
        !((video as Record<string, unknown>).tags as unknown[]).every((tag) => typeof tag === 'string') ||
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
    case 'abandon-workspace':
      if (typeof payload.workspaceId !== 'string' || !payload.workspaceId.trim()) invalidCommand()
      return
    case 'abandon-frozen-workspace':
      if (typeof payload.workspaceId !== 'string' || !payload.workspaceId.trim() ||
        typeof payload.frozenPlanId !== 'string' || !payload.frozenPlanId.trim()) invalidCommand()
      return
    case 'record-bilibili-mirror':
      if (typeof payload.workspaceId !== 'string' || !payload.workspaceId.trim() ||
        !payload.memberAidsByFolderId || typeof payload.memberAidsByFolderId !== 'object' || Array.isArray(payload.memberAidsByFolderId) ||
        !Array.isArray(payload.folders) || !payload.folders.every(isBilibiliMirrorFolder) ||
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
    case 'remove-physical-shard-binding':
      if (typeof payload.remoteFolderId !== 'string' || !payload.remoteFolderId.trim()) invalidCommand()
      return
    case 'record-organization-change':
      if (!isOrganizationChange(payload.change) || normalizedAccountMid((payload.change as FavoriteRepositoryOrganizationChange).accountMid) !== normalizedAccountMid(record.accountMid)) invalidCommand()
      return
    case 'set-favorite-position':
    case 'set-favorite-placement':
      if (!isPositionPayload(payload)) invalidCommand()
      return
    case 'set-favorite-placements':
      if (!isPlacementList(payload.placements)) invalidCommand()
      return
    case 'record-favorite-event':
      if (!isRepositoryEvent(payload)) invalidCommand()
      return
    case 'tombstone-favorite-video':
      if (!Number.isSafeInteger(payload.aid) || Number(payload.aid) <= 0 || typeof payload.deletedAt !== 'string' ||
        Number.isNaN(Date.parse(payload.deletedAt)) || (payload.allowRediscovery !== undefined && typeof payload.allowRediscovery !== 'boolean')) invalidCommand()
      return
    case 'delete-favorite-from-library':
      if (!Number.isSafeInteger(payload.aid) || Number(payload.aid) <= 0 || typeof payload.deletedAt !== 'string' ||
        Number.isNaN(Date.parse(payload.deletedAt)) || (payload.reason !== undefined && typeof payload.reason !== 'string')) invalidCommand()
      return
    case 'delete-local-managed-folder':
      if (typeof payload.logicalFolderId !== 'string' || !/^bilimi-logical:\S+$/.test(payload.logicalFolderId.trim())) invalidCommand()
      return
    case 'restore-favorite-to-library':
    case 'forget-favorite-tombstone':
      if (!Number.isSafeInteger(payload.aid) || Number(payload.aid) <= 0) invalidCommand()
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
    organizationBatches: [],
    organizationMigrationInitialized: false,
    positions: {},
    tombstones: {}
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
  const expectedRevision = (command as { expectedRevision?: number }).expectedRevision
  if (expectedRevision !== undefined && expectedRevision !== snapshot.revision) {
    throw new Error('Favorite repository revision mismatch.')
  }

  let affectedFolderIds: string[] = []
  let affectedAids: number[] = []
  let memberships = { ...snapshot.memberships }
  let workspace = snapshot.workspace
  let syncRecords = [...snapshot.syncRecords]
  let organizationRecords = [...snapshot.organizationRecords]
  let organizationBatches = [...(snapshot.organizationBatches ?? [])]
  let organizationMigrationInitialized = snapshot.organizationMigrationInitialized
  let videos = { ...snapshot.videos }
  let libraryMirrors = { ...snapshot.libraryMirrors }
  let folders = [...snapshot.folders]
  let physicalShards = [...snapshot.physicalShards]
  let positions = { ...(snapshot.positions ?? {}) }
  let tombstones = { ...(snapshot.tombstones ?? {}) }
  const removeFromLocalInbox = (aids: Iterable<number>) => {
    const removed = new Set(aids)
    if (!removed.size || !memberships['local:inbox']?.some((aid) => removed.has(aid))) return
    memberships = { ...memberships, 'local:inbox': memberships['local:inbox'].filter((aid) => !removed.has(aid)) }
    affectedFolderIds = [...new Set([...affectedFolderIds, 'local:inbox'])].sort()
  }
  const applyPlacement = (payload: Omit<FavoriteRepositoryPositionRecord, 'accountMid' | 'positionState' | 'revision'> & { positionState?: FavoriteRepositoryPositionState }) => {
    const key = createFavoriteRepositoryPositionKey(snapshot.accountMid, payload.aid)
    const localDesiredFolderIds = normalizeFolderIds(payload.localDesiredFolderIds)
    const remoteObservedPhysicalFolderIds = normalizeFolderIds(payload.remoteObservedPhysicalFolderIds)
    const remoteObservedLogicalFolderIds = normalizeFolderIds(payload.remoteObservedLogicalFolderIds)
    positions[key] = {
      accountMid: snapshot.accountMid, aid: payload.aid, localDesiredFolderIds, remoteObservedPhysicalFolderIds, remoteObservedLogicalFolderIds,
      positionState: deriveFavoriteRepositoryPositionState({ localDesiredFolderIds, remoteObservedPhysicalFolderIds, remoteObservedLogicalFolderIds,
        ...(payload.positionState ? { positionState: payload.positionState } : {}) }),
      ...(payload.observedAt ? { observedAt: normalizedTimestamp(payload.observedAt) } : {}),
      updatedAt: normalizedTimestamp(payload.updatedAt), ...(payload.reason ? { reason: payload.reason } : {}), revision: snapshot.revision + 1
    }
    const formalFolderIds = Object.keys(memberships).filter((folderId) =>
      folderId.startsWith('local:') && folderId !== 'local:inbox' || folderId.startsWith('bilimi-logical:'))
    const nextFormalFolderIds = new Set(localDesiredFolderIds)
    for (const folderId of new Set([...formalFolderIds, ...nextFormalFolderIds])) {
      const members = new Set(memberships[folderId] ?? [])
      if (nextFormalFolderIds.has(folderId)) members.add(payload.aid)
      else members.delete(payload.aid)
      memberships = { ...memberships, [folderId]: [...members].sort((left, right) => left - right) }
      affectedFolderIds.push(folderId)
    }
    const inbox = new Set(memberships['local:inbox'] ?? [])
    if (localDesiredFolderIds.length) inbox.delete(payload.aid)
    else inbox.add(payload.aid)
    memberships = { ...memberships, 'local:inbox': [...inbox].sort((left, right) => left - right) }
    affectedFolderIds.push('local:inbox')
    affectedAids.push(payload.aid)
  }

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
        videos[String(video.aid)] = mergeFavoriteRepositoryVideo(videos[String(video.aid)], video)
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
      removeFromLocalInbox([
        ...organizationRecords.map((record) => record.aid),
        ...Array.from(membersByFolderId)
          .filter(([folderId]) => folderId !== 'local:inbox')
          .flatMap(([, aids]) => aids)
      ])
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
      videos[String(command.payload.aid)] = mergeFavoriteRepositoryVideo(videos[String(command.payload.aid)], command.payload)
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
        videos[String(video.aid)] = mergeFavoriteRepositoryVideo(existing, video)
      }
      for (const aid of mirroredAids) {
        const existing = libraryMirrors[String(aid)]
        libraryMirrors[String(aid)] = {
          aid,
          status: 'synced',
          metadataRevision: Math.max(1, existing?.metadataRevision ?? 0),
          lastSyncedAt: normalizedAcceptedAt
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
      organizationBatches = []
      organizationMigrationInitialized = false
      positions = {}
      tombstones = {}
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
    case 'abandon-workspace':
      if (!workspace || workspace.frozenSyncPlan || workspace.id !== command.payload.workspaceId.trim()) {
        throw new Error('Favorite workspace cannot be abandoned.')
      }
      workspace = undefined
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
      removeFromLocalInbox(command.payload.records.map((record) => record.aid))
      organizationMigrationInitialized = organizationMigrationInitialized || command.payload.markMigrationInitialized === true
      affectedAids = command.payload.records.map((record) => record.aid).sort((left, right) => left - right)
      break
    }
    case 'remove-physical-shard-binding': {
      const remoteFolderId = command.payload.remoteFolderId.trim()
      const removedShards = physicalShards.filter((shard) => shard.remoteFolderId === remoteFolderId)
      if (!removedShards.length) throw new Error('Favorite repository remote shard binding was not found.')
      const removedFolderIds = new Set(removedShards.map((shard) => shard.folderId))
      affectedFolderIds = [...removedFolderIds].sort()
      affectedAids = uniquePositiveAids(removedShards.flatMap((shard) => memberships[shard.folderId] ?? [])).sort((left, right) => left - right)
      physicalShards = physicalShards.filter((shard) => shard.remoteFolderId !== remoteFolderId)
      folders = folders.filter((folder) => !removedFolderIds.has(folder.id))
      memberships = Object.fromEntries(Object.entries(memberships).filter(([folderId]) => !removedFolderIds.has(folderId)))
      organizationRecords = organizationRecords.flatMap((record) => {
        const targetFolderIds = record.targetFolderIds.filter((folderId) => folderId !== remoteFolderId)
        return targetFolderIds.length ? [{ ...record, targetFolderIds }] : []
      })
      break
    }
    case 'record-organization-change': {
      const change = command.payload.change
      const existing = organizationBatches.find((record) => record.id === change.id)
      if (existing) break
      const normalizeFolders = (ids: string[]) => [...new Set(ids.map((id) => id.trim()).filter(Boolean))].sort()
      const beforeFolderIds = normalizeFolders(change.beforeFolderIds)
      const afterFolderIds = normalizeFolders(change.afterFolderIds)
      const addedFolderIds = normalizeFolders(change.addedFolderIds)
      const removedFolderIds = normalizeFolders(change.removedFolderIds)
      const remoteToShard = new Map(physicalShards.filter((shard) => shard.remoteFolderId).map((shard) => [shard.remoteFolderId!, shard]))
      for (const remoteFolderId of new Set([...beforeFolderIds, ...afterFolderIds])) {
        const shard = remoteToShard.get(remoteFolderId)
        if (!shard) continue
        const logicalFolderId = `bilimi-logical:${shard.logicalLedgerId}`
        const nextMembership = (folderId: string, include: boolean) => {
          const members = new Set(memberships[folderId] ?? [])
          if (include) members.add(change.aid)
          else members.delete(change.aid)
          memberships = { ...memberships, [folderId]: [...members].sort((left, right) => left - right) }
        }
        const include = afterFolderIds.includes(remoteFolderId)
        nextMembership(shard.folderId, include)
        const anyLogicalMember = physicalShards
          .filter((candidate) => candidate.logicalLedgerId === shard.logicalLedgerId)
          .some((candidate) => (candidate.remoteFolderId ? afterFolderIds.includes(candidate.remoteFolderId) : false) || (memberships[candidate.folderId] ?? []).includes(change.aid))
        nextMembership(logicalFolderId, anyLogicalMember)
        affectedFolderIds.push(shard.folderId, logicalFolderId)
      }
      organizationBatches = [...organizationBatches, {
        ...change, accountMid: snapshot.accountMid, beforeFolderIds, afterFolderIds, addedFolderIds, removedFolderIds,
        recordedAt: normalizedTimestamp(change.recordedAt)
      }].sort((left, right) => left.recordedAt.localeCompare(right.recordedAt) || left.id.localeCompare(right.id))
      affectedAids = [change.aid]
      break
    }
    case 'set-favorite-position':
    case 'set-favorite-placement': {
      applyPlacement(command.payload)
      break
    }
    case 'set-favorite-placements': {
      for (const placement of command.payload.placements) applyPlacement(placement)
      break
    }
    case 'record-favorite-event':
      affectedAids = [command.payload.aid]
      break
    case 'tombstone-favorite-video': {
      const aid = command.payload.aid
      tombstones[createFavoriteRepositoryPositionKey(snapshot.accountMid, aid)] = {
        accountMid: snapshot.accountMid,
        aid,
        deletedAt: normalizedTimestamp(command.payload.deletedAt),
        allowRediscovery: command.payload.allowRediscovery ?? false
      }
      affectedAids = [aid]
      break
    }
    case 'delete-favorite-from-library': {
      const aid = command.payload.aid
      tombstones[createFavoriteRepositoryPositionKey(snapshot.accountMid, aid)] = {
        accountMid: snapshot.accountMid, aid, deletedAt: normalizedTimestamp(command.payload.deletedAt),
        ...(command.payload.reason ? { reason: command.payload.reason } : {}), allowRediscovery: false
      }
      delete videos[String(aid)]
      delete libraryMirrors[String(aid)]
      // A local library delete hides the video but retains remote observations,
      // protection evidence, and external archive/transcript/event history for recovery.
      for (const folderId of Object.keys(memberships)) {
        if (folderId.startsWith('bilibili:')) continue
        const before = memberships[folderId] ?? []
        if (before.includes(aid)) {
          memberships = { ...memberships, [folderId]: before.filter((memberAid) => memberAid !== aid) }
          affectedFolderIds.push(folderId)
        }
      }
      affectedAids = [aid]
      break
    }
    case 'delete-local-managed-folder': {
      const logicalFolderId = command.payload.logicalFolderId.trim()
      const logicalFolder = folders.find((folder) => folder.id === logicalFolderId && folder.kind === 'bilimi-logical')
      if (!logicalFolder?.logicalLedgerId) throw new Error('Favorite repository managed folder was not found.')
      const removedShards = physicalShards.filter((shard) => shard.logicalLedgerId === logicalFolder.logicalLedgerId)
      const removedFolderIds = new Set([logicalFolderId, ...removedShards.map((shard) => shard.folderId)])
      const affected = new Set<number>()
      for (const folderId of removedFolderIds) for (const aid of memberships[folderId] ?? []) affected.add(aid)
      folders = folders.filter((folder) => !removedFolderIds.has(folder.id))
      physicalShards = physicalShards.filter((shard) => shard.logicalLedgerId !== logicalFolder.logicalLedgerId)
      memberships = Object.fromEntries(Object.entries(memberships).filter(([folderId]) => !removedFolderIds.has(folderId)))
      for (const position of Object.values(positions)) {
        if (!position.localDesiredFolderIds.includes(logicalFolderId)) continue
        positions[createFavoriteRepositoryPositionKey(snapshot.accountMid, position.aid)] = {
          ...position,
          localDesiredFolderIds: position.localDesiredFolderIds.filter((folderId) => folderId !== logicalFolderId),
          positionState: 'local-only-change', updatedAt: normalizedAcceptedAt, revision: snapshot.revision + 1
        }
        affected.add(position.aid)
      }
      affectedFolderIds = [...removedFolderIds]
      affectedAids = [...affected]
      break
    }
    case 'restore-favorite-to-library':
      delete tombstones[createFavoriteRepositoryPositionKey(snapshot.accountMid, command.payload.aid)]
      affectedAids = [command.payload.aid]
      break
    case 'forget-favorite-tombstone':
      delete tombstones[createFavoriteRepositoryPositionKey(snapshot.accountMid, command.payload.aid)]
      affectedAids = [command.payload.aid]
      break
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
    organizationBatches,
    organizationMigrationInitialized,
    positions,
    tombstones,
    commandId: command.id,
    affectedFolderIds: [...new Set(affectedFolderIds)].sort(),
    affectedAids: uniquePositiveAids(affectedAids)
  }
}

/** A tombstone keeps a user-deleted local record from silently reappearing in later scans. */
export function isFavoriteRepositoryScanVisible(snapshot: AccountFavoriteRepositorySnapshot, aid: number) {
  const tombstone = snapshot.tombstones?.[createFavoriteRepositoryPositionKey(snapshot.accountMid, aid)]
  return !tombstone || tombstone.allowRediscovery
}
