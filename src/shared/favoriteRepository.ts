export type FavoriteRepositoryLocalPlanPayload = {
  workspaceId: string
  memberAidsByFolderId: Record<string, number[]>
  /** Replaces prior local and bilimi-logical organization for these videos before applying this plan. */
  replaceManagedAids?: number[]
  folders?: Array<Pick<FavoriteRepositoryFolder, 'id' | 'title' | 'kind' | 'syncState'>>
  videos?: FavoriteRepositoryVideo[]
  organizationRecords?: FavoriteRepositoryOrganizationRecord[]
  placements?: Array<Omit<FavoriteRepositoryPositionRecord, 'accountMid' | 'positionState' | 'revision'> & {
    positionState?: FavoriteRepositoryPositionState
  }>
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

export type FavoriteRepositoryLifecycleState = 'active' | 'source-pending' | 'organization-conflict' | 'recycled'

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
  lifecycleState?: FavoriteRepositoryLifecycleState
  sourceAuthority?: 'complete' | 'incomplete'
  observationEpoch?: string
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
  /** Missing on legacy records; non-rediscoverable legacy records remain explicit user deletions. */
  kind?: 'user-deleted' | 'recycled'
}

export type FavoriteRepositoryArchiveExport = {
  version: 1
  accountMid: string
  generatedAt: string
  /** A checksum of the portable data; credentials and remote authorization are never represented. */
  checksum?: string
  videos?: FavoriteRepositoryVideo[]
  positions?: Array<Pick<FavoriteRepositoryPositionRecord,
    'aid' | 'localDesiredFolderIds' | 'positionState' | 'observedAt' | 'updatedAt' |
    'lifecycleState' | 'sourceAuthority' | 'observationEpoch'>>
  protections?: Array<Pick<FavoriteRepositoryOrganizationRecord, 'aid' | 'completedAt'>>
  events?: FavoriteRepositoryEvent[]
  archives: Array<{ aid: number; archiveId: string; registeredAt: string; version?: string }>
  /** Account-local recovery data. Bilimi binding identity is portable; remote membership observations stay local. */
  recovery?: Pick<AccountFavoriteRepositorySnapshot,
    'folders' | 'memberships' | 'physicalShards' | 'workspace' | 'syncRecords' |
    'organizationRecords' | 'organizationBatches' | 'organizationMigrationInitialized'> & {
      tombstones: FavoriteRepositoryTombstone[]
    }
}

export function createFavoriteRepositoryPositionKey(accountMid: string, aid: number) {
  return `${normalizedAccountMid(accountMid)}:${aid}`
}

function normalizeFolderIds(folderIds: string[]) {
  return [...new Set(folderIds.map((folderId) => folderId.trim()).filter(Boolean))].sort()
}

function portableLogicalFolderIds(folderIds: readonly string[] | undefined) {
  return (folderIds ?? []).filter((folderId) => /^bilimi-logical:\S+$/u.test(folderId.trim()))
}

function portableWorkspace(workspace: FavoriteRepositoryWorkspace) {
  return {
    ...workspace,
    frozenSyncPlan: workspace.frozenSyncPlan ? {
      ...workspace.frozenSyncPlan,
      operations: workspace.frozenSyncPlan.operations.map(({ beforeFolderIds: _beforeFolderIds, ...operation }) => ({
        ...operation, folderIds: portableLogicalFolderIds(operation.folderIds)
      }))
    } : undefined
  }
}

function isPortableLogicalFolderId(folderId: unknown) {
  return typeof folderId === 'string' && /^bilimi-logical:\S+$/u.test(folderId.trim())
}

function portableSyncRecord(record: FavoriteRepositorySyncRecord) {
  return {
    ...record,
    ...(record.targetFolderIds ? { targetFolderIds: portableLogicalFolderIds(record.targetFolderIds) } : {})
  }
}

function portableOrganizationRecord(record: FavoriteRepositoryOrganizationRecord) {
  return { ...record, targetFolderIds: portableLogicalFolderIds(record.targetFolderIds) }
}

function portableOrganizationChange(record: FavoriteRepositoryOrganizationChange) {
  return {
    ...record,
    beforeFolderIds: portableLogicalFolderIds(record.beforeFolderIds),
    afterFolderIds: portableLogicalFolderIds(record.afterFolderIds),
    addedFolderIds: portableLogicalFolderIds(record.addedFolderIds),
    removedFolderIds: portableLogicalFolderIds(record.removedFolderIds)
  }
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
  return hasFavoriteRepositoryPlaceholderTitle(video) || !video.author?.trim()
}

function hasFavoriteRepositoryPlaceholderTitle(video: FavoriteRepositoryVideo) {
  const title = video.title.trim()
  return /^video\s*\+\s*id$/i.test(title) || title.toLowerCase() === `video ${video.aid}`.toLowerCase()
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
    , ...(exported.recovery ? {
      recovery: {
        ...exported.recovery,
        folders: [...exported.recovery.folders].sort((left, right) => left.id.localeCompare(right.id)),
        memberships: Object.fromEntries(Object.entries(exported.recovery.memberships).sort(([left], [right]) => left.localeCompare(right)).map(([id, aids]) => [id, uniquePositiveAids(aids)])),
        physicalShards: [...exported.recovery.physicalShards].sort((left, right) => left.logicalLedgerId.localeCompare(right.logicalLedgerId) || left.shardNumber - right.shardNumber),
        ...(exported.recovery.workspace ? { workspace: exported.recovery.workspace } : {}),
        syncRecords: [...exported.recovery.syncRecords].sort((left, right) => left.id.localeCompare(right.id)),
        organizationRecords: [...exported.recovery.organizationRecords].sort((left, right) => left.aid - right.aid),
        organizationBatches: [...exported.recovery.organizationBatches].sort((left, right) => left.id.localeCompare(right.id)),
        tombstones: [...exported.recovery.tombstones].sort((left, right) => left.aid - right.aid)
      }
    } : {})
  }))
}

/** Produces a portable, credential-free recovery archive while retaining same-account Bilimi binding identity. */
export function createFavoriteRepositoryArchiveExport(
  snapshot: AccountFavoriteRepositorySnapshot,
  input: { generatedAt: string; events?: FavoriteRepositoryEvent[]; archives?: FavoriteRepositoryArchiveExport['archives'] }
): FavoriteRepositoryArchiveExport & { checksum: string } {
  const accountMid = normalizedAccountMid(snapshot.accountMid)
  const boundShardsByLedger = new Map<string, FavoriteRepositoryPhysicalShard[]>()
  for (const shard of snapshot.physicalShards) {
    const shards = boundShardsByLedger.get(shard.logicalLedgerId) ?? []
    shards.push(shard)
    boundShardsByLedger.set(shard.logicalLedgerId, shards)
  }
  const recoveryLogicalFolders = snapshot.folders
    .filter((folder) => folder.kind !== 'bilibili')
    .map((folder) => {
      const shards = folder.logicalLedgerId ? boundShardsByLedger.get(folder.logicalLedgerId) ?? [] : []
      const bound = folder.kind === 'bilimi-logical' && shards.length > 0 && shards.every((shard) => shard.bindingState === 'bound' && shard.remoteFolderId)
      const firstRemoteFolderId = bound ? shards[0]?.remoteFolderId : undefined
      return {
        id: folder.id,
        title: folder.title,
        kind: folder.kind,
        ...(folder.logicalLedgerId ? { logicalLedgerId: folder.logicalLedgerId } : {}),
        ...(firstRemoteFolderId ? { remoteFolderId: firstRemoteFolderId } : {}),
        syncState: bound ? 'bound' as const : folder.kind === 'bilimi-logical' ? 'pending-reconcile' as const : 'local-only' as const
      }
    })
  const recoveryPhysicalFolders = snapshot.physicalShards
    .filter((shard) => shard.bindingState === 'bound' && shard.remoteFolderId)
    .map((shard) => ({
      id: shard.folderId,
      title: shard.remoteTitle,
      kind: 'bilibili' as const,
      logicalLedgerId: shard.logicalLedgerId,
      remoteFolderId: shard.remoteFolderId,
      syncState: 'bound' as const
    }))
  const recoveryFolders = [...new Map([...recoveryLogicalFolders, ...recoveryPhysicalFolders].map((folder) => [folder.id, folder])).values()]
  const recoveryFolderIds = new Set(recoveryFolders.map((folder) => folder.id))
  const portableLocalFolderIds = new Set(recoveryFolders
    .filter((folder) => folder.kind !== 'bilibili')
    .map((folder) => folder.id))
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
      ...(position.observedAt ? { observedAt: position.observedAt } : {}),
      ...(position.lifecycleState ? { lifecycleState: position.lifecycleState } : {}),
      ...(position.sourceAuthority ? { sourceAuthority: position.sourceAuthority } : {}),
      ...(position.observationEpoch ? { observationEpoch: position.observationEpoch } : {}),
      updatedAt: position.updatedAt
    })),
    protections: (snapshot.organizationRecords ?? []).map((record) => ({ aid: record.aid, completedAt: record.completedAt })),
    events: (input.events ?? []).filter((event) => normalizedAccountMid(event.accountMid) === accountMid)
      .map((event) => ({ ...event, folderTitlesAtTime: event.folderTitlesAtTime ? [...event.folderTitlesAtTime] : undefined })),
    archives: (input.archives ?? []).map((archive) => ({ ...archive })),
    recovery: {
      folders: recoveryFolders,
      // Older snapshots can contain a transient inbox membership before its
      // folder projection exists. Do not emit an archive our strict reader
      // would necessarily reject.
      // Physical Bilibili memberships are observations from the source machine,
      // not portable current facts. Re-read them after migration; preserve only
      // local logical memberships and the formal binding identity below.
      memberships: Object.fromEntries(Object.entries(snapshot.memberships)
        .filter(([folderId]) => portableLocalFolderIds.has(folderId))
        .map(([folderId, aids]) => [folderId, [...aids]])),
      physicalShards: snapshot.physicalShards
        .filter((shard) => recoveryFolderIds.has(shard.folderId))
        .map((shard) => ({
          logicalLedgerId: shard.logicalLedgerId, folderId: shard.folderId, shardNumber: shard.shardNumber,
          ...(shard.remoteFolderId && shard.bindingState === 'bound' ? { remoteFolderId: shard.remoteFolderId } : {}),
          remoteTitle: shard.remoteTitle, bindingState: shard.bindingState
      })), ...(snapshot.workspace ? { workspace: portableWorkspace(snapshot.workspace) } : {}),
      syncRecords: snapshot.syncRecords.map(portableSyncRecord), organizationRecords: snapshot.organizationRecords.map(portableOrganizationRecord),
      organizationBatches: snapshot.organizationBatches.map(portableOrganizationChange), organizationMigrationInitialized: snapshot.organizationMigrationInitialized,
      tombstones: Object.values(snapshot.tombstones).map((tombstone) => ({ ...tombstone }))
    }
  }
  return { ...exported, checksum: createFavoriteRepositoryArchiveExportChecksum(exported) }
}

/** Validates a portable archive before an importer can create a recovery plan or write anything. */
export function validateFavoriteRepositoryArchiveExport(value: unknown): FavoriteRepositoryArchiveExport & { checksum: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Favorite repository archive is invalid.')
  const archive = value as Record<string, unknown>
  const allowed = new Set(['version', 'accountMid', 'generatedAt', 'checksum', 'videos', 'positions', 'protections', 'events', 'archives', 'recovery'])
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
  const portablePositionKeys = new Set(['aid', 'localDesiredFolderIds', 'positionState', 'observedAt', 'updatedAt', 'lifecycleState', 'sourceAuthority', 'observationEpoch'])
  if (archive.positions !== undefined && (!Array.isArray(archive.positions) || !archive.positions.every((position) =>
    position && typeof position === 'object' && Object.keys(position).every((key) => portablePositionKeys.has(key)) && isPositionPayload({
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
  if (archive.recovery !== undefined && !isPortableRepositoryRecovery(archive.recovery, archive.accountMid)) throw new Error('Favorite repository archive is invalid.')
  const typed = archive as unknown as FavoriteRepositoryArchiveExport & { checksum: string }
  if (createFavoriteRepositoryArchiveExportChecksum(typed) !== typed.checksum.toLowerCase()) throw new Error('Favorite repository archive checksum is invalid.')
  return typed
}

/** Converts interrupted portable work into archive-only recovery records. */
export function restoreFavoriteRepositoryArchiveRecovery(value: unknown): FavoriteRepositoryArchiveExport & { checksum: string } {
  const restored = structuredClone(validateFavoriteRepositoryArchiveExport(value))
  const workspace = restored.recovery?.workspace
  if (workspace && workspace.status !== 'completed' && workspace.status !== 'draft') {
    const { frozenSyncPlan: _frozenSyncPlan, ...draft } = workspace
    restored.recovery = {
      ...restored.recovery!,
      workspace: {
        ...draft,
        status: 'draft',
        resumable: true,
        continuationAids: [],
        workspaceRef: { ...workspace.workspaceRef, status: 'draft' }
      }
    }
  }
  if (restored.recovery) {
    // A portable archive carries the user's logical classification intent,
    // never a current-device observation of Bilibili.  Keep every imported
    // managed folder pending until this device reads the current remote
    // inventory and finds one exact candidate.  This prevents a stale ID from
    // being treated as a safe target after migration or a local-data reset.
    const pendingLogicalLedgerIds = new Set(restored.recovery.physicalShards.map((shard) => shard.logicalLedgerId))
    const folders = restored.recovery.folders
      .filter((folder) => folder.kind !== 'bilibili')
      .map((folder) => folder.kind === 'bilimi-logical' && pendingLogicalLedgerIds.has(folder.logicalLedgerId!)
        ? { ...folder, syncState: 'pending-reconcile' as const }
        : folder)
    restored.recovery = {
      ...restored.recovery,
      folders,
      memberships: Object.fromEntries(Object.entries(restored.recovery.memberships)
        .filter(([folderId]) => folders.some((folder) => folder.id === folderId))),
      physicalShards: restored.recovery.physicalShards.map((shard) => ({ ...shard, bindingState: 'pending-reconcile' as const }))
    }
    restored.recovery.syncRecords = restored.recovery.syncRecords.map((record) => record.status === 'result-unknown'
      ? { ...record, status: 'reconciliation-required', autoRetry: false }
      : record)
  }
  const next: FavoriteRepositoryArchiveExport = restored
  return { ...next, checksum: createFavoriteRepositoryArchiveExportChecksum(next) }
}

/** Local, account-scoped metadata mirror. It never describes a Bilibili write. */
export type FavoriteLibraryMirrorRecord = {
  aid: number
  status: 'never' | 'refreshing' | 'synced' | 'failed'
  metadataRevision: number
  lastSyncedAt?: string
  lastCheckedAt?: string
  errorCode?: 'network' | 'unavailable' | 'account-changed'
  remoteCode?: number
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
  status: 'draft' | 'scanning' | 'previewing' | 'frozen' | 'executing' | 'reconciling' | 'completed'
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
  /** `draft` exists only in a restored portable archive; runtime commands cannot set it. */
  status: 'draft' | 'scanning' | 'previewing' | 'frozen' | 'executing' | 'reconciling' | 'completed'
  baselineRevision: number
  continuationAids: number[]
  workspaceRef: FavoriteRepositoryWorkspaceRef
  resumable?: boolean
  completionMode?: 'bilibili' | 'local'
  frozenSyncPlan?: FavoriteRepositoryFrozenSyncPlan
}

export type FavoriteRepositorySyncRecord = {
  id: string
  commandId: string
  status: 'pending' | 'succeeded' | 'failed' | 'result-unknown' | 'reconciliation-required'
  affectedAids: number[]
  updatedAt: string
  reason?: string
  runId?: string
  operationKey?: string
  targetFolderIds?: string[]
  attempt?: number
  retryAvailableAt?: string
  /** Archive restoration marker. Runtime commands cannot set this status. */
  autoRetry?: false
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
  /** Count after the requested scope, search, and status filter are applied. */
  totalCount?: number
  /** One-based local result page when random page access is available. */
  page?: number
  /** Total number of local result pages for the active limit. */
  pageCount?: number
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
      payload: { preserveTombstones?: boolean }
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
      expectedRevision?: number
      type: 'repair-persisted-managed-bindings'
      payload: {
        workspaceId: string
        workspaceStatus: FavoriteRepositoryWorkspace['status']
        bindings: Array<{
          logicalLedgerId: string
          logicalTitle: string
          shardNumber: number
          memberAids: number[]
          remoteTitle: string
          bindingState: 'bound' | 'pending-reconcile'
          remoteFolderId?: string
          knownRemoteFolderIds?: string[]
          remoteMemberCount?: number
        }>
        placements: Array<Omit<FavoriteRepositoryPositionRecord, 'accountMid' | 'positionState' | 'revision'> & { positionState?: FavoriteRepositoryPositionState }>
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
      type: 'reconcile-scan-lifecycle'
      payload: {
        observationEpoch: string
        authority: 'complete' | 'incomplete'
        observations: Array<{
          aid: number
          remoteObserved: boolean
          remoteFolderIds?: string[]
          ordinarySource?: boolean
        }>
      }
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
      type: 'record-favorite-events'
      payload: { events: Array<Omit<FavoriteRepositoryEvent, 'accountMid'>> }
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
      type: 'delete-favorites-from-library'
      payload: { aids: number[]; deletedAt: string; reason?: string }
    }
  | {
      id: string
      accountMid: string
      issuedAt: string
      expectedRevision?: number
      type: 'recycle-favorites'
      payload: { aids: number[]; deletedAt: string; reason?: string }
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
      type: 'delete-local-managed-folders'
      payload: { logicalFolderIds: string[] }
    }
  | {
      id: string
      accountMid: string
      issuedAt: string
      expectedRevision?: number
      type: 'clear-local-managed-folder-records'
      payload: { logicalFolderIds: string[] }
    }
  | {
      id: string
      accountMid: string
      issuedAt: string
      expectedRevision?: number
      type: 'clear-local-inbox'
      payload: Record<string, never>
    }
  | {
      id: string
      accountMid: string
      issuedAt: string
      expectedRevision?: number
      type: 'restore-favorite-to-library' | 'forget-favorite-tombstone'
      payload: { aid: number }
    }
  | {
      id: string
      accountMid: string
      issuedAt: string
      expectedRevision?: number
      type: 'clear-recycled-favorite'
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

function isRuntimeWorkspaceStatus(value: unknown): value is Exclude<FavoriteRepositoryWorkspace['status'], 'draft'> {
  return ['scanning', 'previewing', 'frozen', 'executing', 'reconciling', 'completed'].includes(String(value))
}

function isPortableWorkspaceStatus(value: unknown): value is FavoriteRepositoryWorkspace['status'] {
  return value === 'draft' || isRuntimeWorkspaceStatus(value)
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
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

function isRuntimeSyncStatus(value: unknown): value is Exclude<FavoriteRepositorySyncRecord['status'], 'reconciliation-required'> {
  return ['pending', 'succeeded', 'failed', 'result-unknown'].includes(String(value))
}

function isPortableSyncStatus(value: unknown): value is FavoriteRepositorySyncRecord['status'] {
  return value === 'reconciliation-required' || isRuntimeSyncStatus(value)
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

function isPortableRepositoryRecovery(value: unknown, accountMid: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const recovery = value as Record<string, unknown>
  const allowed = new Set(['folders', 'memberships', 'physicalShards', 'workspace', 'syncRecords', 'organizationRecords', 'organizationBatches', 'organizationMigrationInitialized', 'tombstones'])
  if (Object.keys(recovery).some((key) => !allowed.has(key)) || !Array.isArray(recovery.folders) ||
    !isRecord(recovery.memberships) || !Array.isArray(recovery.physicalShards) || !Array.isArray(recovery.syncRecords) ||
    !Array.isArray(recovery.organizationRecords) || !Array.isArray(recovery.organizationBatches) ||
    typeof recovery.organizationMigrationInitialized !== 'boolean' || !Array.isArray(recovery.tombstones)) return false
  const folderIds = new Set<string>()
  if (!recovery.folders.every((item) => isPortableRecoveryFolder(item, folderIds))) return false
  if (!Object.entries(recovery.memberships).every(([folderId, aids]) => folderIds.has(folderId) && isValidAidList(aids))) return false
  const shardKeys = new Set<string>()
  if (!recovery.physicalShards.every((item) => isPortableRecoveryShard(item, folderIds, shardKeys))) return false
  if (recovery.workspace !== undefined && !isPortableRecoveryWorkspace(recovery.workspace, accountMid)) return false
  if (!recovery.syncRecords.every(isPortableRecoverySyncRecord) || !recovery.organizationRecords.every((record) =>
    isPortableRecoveryOrganizationRecord(record, accountMid)) ||
    !recovery.organizationBatches.every((record) => isPortableRecoveryOrganizationChange(record, accountMid)) ||
    !recovery.tombstones.every((tombstone) => isPortableRecoveryTombstone(tombstone, accountMid))) return false
  return true
}

function isPortableRecoveryFolder(value: unknown, ids: Set<string>) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const folder = value as Record<string, unknown>
  const allowedKeys = new Set(['id', 'title', 'kind', 'logicalLedgerId', 'remoteFolderId', 'syncState'])
  if (Object.keys(folder).some((key) => !allowedKeys.has(key)) || typeof folder.id !== 'string' || !folder.id.trim() || ids.has(folder.id) || typeof folder.title !== 'string' || !folder.title.trim() ||
    !['bilimi-logical', 'bilibili', 'local'].includes(String(folder.kind))) return false
  if (folder.kind === 'bilimi-logical') {
    if (typeof folder.logicalLedgerId !== 'string' || !folder.logicalLedgerId.trim() ||
      folder.id !== `bilimi-logical:${folder.logicalLedgerId}` || !['bound', 'pending-reconcile'].includes(String(folder.syncState))) return false
    if (folder.remoteFolderId !== undefined && (typeof folder.remoteFolderId !== 'string' || !folder.remoteFolderId.trim())) return false
    if (folder.syncState === 'bound' && !folder.remoteFolderId) return false
  } else if (folder.kind === 'bilibili') {
    if (typeof folder.logicalLedgerId !== 'string' || !folder.logicalLedgerId.trim() ||
      typeof folder.remoteFolderId !== 'string' || !folder.remoteFolderId.trim() || folder.syncState !== 'bound') return false
  } else if (folder.logicalLedgerId !== undefined || !folder.id.startsWith('local:') || folder.syncState !== 'local-only' || folder.remoteFolderId !== undefined) return false
  ids.add(folder.id)
  return true
}

function isPortableRecoveryShard(value: unknown, folderIds: Set<string>, shardKeys: Set<string>) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const shard = value as Record<string, unknown>
  const allowedKeys = new Set(['logicalLedgerId', 'folderId', 'shardNumber', 'remoteFolderId', 'remoteTitle', 'bindingState'])
  if (Object.keys(shard).some((key) => !allowedKeys.has(key)) || typeof shard.logicalLedgerId !== 'string' || !shard.logicalLedgerId.trim() ||
    typeof shard.folderId !== 'string' || (!folderIds.has(shard.folderId) && !/^bilimi:\S+:\d{3}$/u.test(shard.folderId)) ||
    !Number.isSafeInteger(shard.shardNumber) || Number(shard.shardNumber) <= 0 || typeof shard.remoteTitle !== 'string' || !shard.remoteTitle.trim() ||
    !['bound', 'pending-reconcile'].includes(String(shard.bindingState)) ||
    (shard.remoteFolderId !== undefined && (typeof shard.remoteFolderId !== 'string' || !shard.remoteFolderId.trim())) ||
    (shard.bindingState === 'bound' && !shard.remoteFolderId)) return false
  const key = `${shard.logicalLedgerId}:${shard.shardNumber}`
  if (shardKeys.has(key)) return false
  shardKeys.add(key)
  return true
}

function isPortableRecoveryWorkspace(value: unknown, accountMid: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const workspace = value as Record<string, unknown>
  const allowedKeys = new Set(['id', 'accountMid', 'status', 'baselineRevision', 'continuationAids', 'workspaceRef', 'resumable', 'completionMode', 'frozenSyncPlan'])
  return !Object.keys(workspace).some((key) => !allowedKeys.has(key)) && typeof workspace.id === 'string' && !!workspace.id.trim() && typeof workspace.accountMid === 'string' &&
    normalizedAccountMid(workspace.accountMid) === accountMid && isPortableWorkspaceStatus(workspace.status) &&
    Number.isSafeInteger(workspace.baselineRevision) && Number(workspace.baselineRevision) >= 0 && isValidAidList(workspace.continuationAids) &&
    isWorkspaceRef(workspace.workspaceRef, accountMid, workspace.id, workspace.status as FavoriteRepositoryWorkspace['status'], Number(workspace.baselineRevision)) &&
    (workspace.status !== 'draft' || workspace.resumable === true && workspace.continuationAids.length === 0 && workspace.frozenSyncPlan === undefined) &&
    (workspace.resumable === undefined || typeof workspace.resumable === 'boolean') &&
    (workspace.completionMode === undefined || workspace.completionMode === 'bilibili' || workspace.completionMode === 'local') &&
    (workspace.frozenSyncPlan === undefined || isPortableFrozenSyncPlan(workspace.frozenSyncPlan, accountMid, workspace.id))
}

function isPortableFrozenSyncPlan(value: unknown, accountMid: string, workspaceId: string) {
  if (!isFrozenSyncPlan(value, accountMid, workspaceId)) return false
  const plan = value as FavoriteRepositoryFrozenSyncPlan
  const planKeys = new Set(['id', 'accountMid', 'workspaceId', 'baselineRevision', 'createdAt', 'operations'])
  const operationKeys = new Set(['operationKey', 'aid', 'kind', 'folderIds', 'beforeFolderIds'])
  return !Object.keys(plan).some((key) => !planKeys.has(key)) && plan.operations.every((operation) =>
    !Object.keys(operation).some((key) => !operationKeys.has(key)) && operation.folderIds.every(isPortableLogicalFolderId) &&
    (operation.beforeFolderIds === undefined || operation.beforeFolderIds.every(isPortableLogicalFolderId)))
}

function isPortableRecoverySyncRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const allowedKeys = new Set(['id', 'commandId', 'status', 'affectedAids', 'updatedAt', 'reason', 'runId', 'operationKey', 'targetFolderIds', 'attempt', 'retryAvailableAt', 'autoRetry'])
  return !Object.keys(record).some((key) => !allowedKeys.has(key)) && typeof record.id === 'string' && !!record.id.trim() && typeof record.commandId === 'string' && !!record.commandId.trim() &&
    isPortableSyncStatus(record.status) && isValidAidList(record.affectedAids) && typeof record.updatedAt === 'string' && !Number.isNaN(Date.parse(record.updatedAt)) &&
    (record.status !== 'reconciliation-required' || record.autoRetry === false) && (record.autoRetry === undefined || record.autoRetry === false) &&
    (record.reason === undefined || typeof record.reason === 'string') && (record.runId === undefined || typeof record.runId === 'string') &&
    (record.operationKey === undefined || typeof record.operationKey === 'string') &&
    (record.targetFolderIds === undefined || (Array.isArray(record.targetFolderIds) && record.targetFolderIds.every(isPortableLogicalFolderId))) &&
    (record.attempt === undefined || (Number.isSafeInteger(record.attempt) && Number(record.attempt) >= 0)) &&
    (record.retryAvailableAt === undefined || (typeof record.retryAvailableAt === 'string' && !Number.isNaN(Date.parse(record.retryAvailableAt))))
}

function isPortableRecoveryOrganizationRecord(value: unknown, accountMid: string) {
  if (!isOrganizationRecord(value)) return false
  const record = value as Record<string, unknown>
  return normalizedAccountMid(String(record.accountMid)) === accountMid &&
    record.targetFolderIds.every(isPortableLogicalFolderId) &&
    Object.keys(record).every((key) => ['accountMid', 'aid', 'targetFolderIds', 'completedAt'].includes(key))
}

function isPortableRecoveryOrganizationChange(value: unknown, accountMid: string) {
  if (!isOrganizationChange(value)) return false
  const record = value as Record<string, unknown>
  return normalizedAccountMid(String(record.accountMid)) === accountMid &&
    ['beforeFolderIds', 'afterFolderIds', 'addedFolderIds', 'removedFolderIds'].every((key) =>
      (record[key] as unknown[]).every(isPortableLogicalFolderId)) &&
    Object.keys(record).every((key) => ['id', 'runId', 'workspaceId', 'accountMid', 'aid', 'beforeFolderIds', 'afterFolderIds', 'addedFolderIds', 'removedFolderIds', 'status', 'recordedAt'].includes(key))
}

function isPortableRecoveryTombstone(value: unknown, accountMid: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const tombstone = value as Record<string, unknown>
  const allowedKeys = new Set(['accountMid', 'aid', 'deletedAt', 'reason', 'allowRediscovery', 'kind'])
  return !Object.keys(tombstone).some((key) => !allowedKeys.has(key)) && typeof tombstone.accountMid === 'string' && normalizedAccountMid(tombstone.accountMid) === accountMid &&
    Number.isSafeInteger(tombstone.aid) && Number(tombstone.aid) > 0 && typeof tombstone.deletedAt === 'string' && !Number.isNaN(Date.parse(tombstone.deletedAt)) &&
    typeof tombstone.allowRediscovery === 'boolean' && (tombstone.reason === undefined || typeof tombstone.reason === 'string') &&
    (tombstone.kind === undefined || tombstone.kind === 'user-deleted' || tombstone.kind === 'recycled')
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
    (value.lifecycleState === undefined || ['active', 'source-pending', 'organization-conflict', 'recycled'].includes(String(value.lifecycleState))) &&
    (value.sourceAuthority === undefined || value.sourceAuthority === 'complete' || value.sourceAuthority === 'incomplete') &&
    (value.observationEpoch === undefined || (typeof value.observationEpoch === 'string' && !!value.observationEpoch.trim())) &&
    (value.positionState === undefined || isPositionState(value.positionState))
}

function isPlacementList(value: unknown) {
  return Array.isArray(value) && value.length > 0 && value.length <= 500 && value.every((placement) =>
    placement && typeof placement === 'object' && !Array.isArray(placement) && isPositionPayload(placement as Record<string, unknown>)) &&
    new Set((value as Array<Record<string, unknown>>).map((placement) => Number(placement.aid))).size === value.length
}

function isPhysicalShardBindingPayload(payload: Record<string, unknown>) {
  return typeof payload.logicalLedgerId === 'string' && !!payload.logicalLedgerId.trim() &&
    typeof payload.logicalTitle === 'string' && !!payload.logicalTitle.trim() &&
    Number.isSafeInteger(payload.shardNumber) && Number(payload.shardNumber) >= 1 &&
    Array.isArray(payload.memberAids) && isValidAidList(payload.memberAids) &&
    typeof payload.remoteTitle === 'string' && !!payload.remoteTitle.trim() &&
    (payload.bindingState === 'bound' || payload.bindingState === 'pending-reconcile') &&
    (payload.remoteFolderId === undefined || (typeof payload.remoteFolderId === 'string' && !!payload.remoteFolderId.trim())) &&
    (payload.knownRemoteFolderIds === undefined || (Array.isArray(payload.knownRemoteFolderIds) &&
      payload.knownRemoteFolderIds.every((id) => typeof id === 'string' && !!id.trim()))) &&
    (payload.remoteMemberCount === undefined || (Number.isSafeInteger(payload.remoteMemberCount) && Number(payload.remoteMemberCount) >= 0)) &&
    (payload.bindingState !== 'bound' || (typeof payload.remoteFolderId === 'string' && !!payload.remoteFolderId.trim()))
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
      if (payload.replaceManagedAids !== undefined && (!isValidAidList(payload.replaceManagedAids) ||
        new Set(payload.replaceManagedAids).size !== payload.replaceManagedAids.length)) invalidCommand()
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
      if (payload.placements !== undefined && (!Array.isArray(payload.placements) ||
        payload.placements.some((placement) => !placement || typeof placement !== 'object' || Array.isArray(placement) ||
          !isPositionPayload(placement as Record<string, unknown>)) ||
        new Set((payload.placements as Array<Record<string, unknown>>).map((placement) => Number(placement.aid))).size !== payload.placements.length)) invalidCommand()
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
        (payload.lastCheckedAt !== undefined && (typeof payload.lastCheckedAt !== 'string' || Number.isNaN(Date.parse(payload.lastCheckedAt)))) ||
        (payload.errorCode !== undefined && !['network', 'unavailable', 'account-changed'].includes(String(payload.errorCode))) ||
        (payload.remoteCode !== undefined && !Number.isSafeInteger(payload.remoteCode))) invalidCommand()
      return
    case 'set-folder-members':
      if (typeof payload.folderId !== 'string' || !payload.folderId.trim() || !Array.isArray(payload.aids) ||
        !isValidAidList(payload.aids)) invalidCommand()
      return
    case 'upsert-physical-shard-binding':
      if (!isPhysicalShardBindingPayload(payload)) invalidCommand()
      return
    case 'repair-persisted-managed-bindings':
      if (typeof payload.workspaceId !== 'string' || !payload.workspaceId.trim() || !isRuntimeWorkspaceStatus(payload.workspaceStatus) || !Array.isArray(payload.bindings) || payload.bindings.length > 100 ||
        payload.bindings.some((binding) => !binding || typeof binding !== 'object' || !isPhysicalShardBindingPayload(binding as Record<string, unknown>)) ||
        !Array.isArray(payload.placements) || payload.placements.length > 500 ||
        payload.placements.some((placement) => !placement || typeof placement !== 'object' || Array.isArray(placement) || !isPositionPayload(placement as Record<string, unknown>)) ||
        new Set(payload.placements.map((placement) => Number(placement.aid))).size !== payload.placements.length) invalidCommand()
      return
    case 'set-workspace':
      {
        const forbiddenWorkspaceState = [
          'baseline', 'classifications', 'history', 'segments', 'plannedAids', 'protectedAids',
          'baselineCompletedAids', 'videos', 'memberships'
        ]
        if (typeof payload.id !== 'string' || !payload.id.trim() || typeof payload.accountMid !== 'string' ||
          !isRuntimeWorkspaceStatus(payload.status) || !Number.isSafeInteger(payload.baselineRevision) ||
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
      if ((payload.preserveTombstones !== undefined && payload.preserveTombstones !== true) || Object.keys(payload).some((key) => key !== 'preserveTombstones')) invalidCommand()
      return
    case 'record-sync-result':
      if (typeof payload.id !== 'string' || !payload.id.trim() || typeof payload.commandId !== 'string' ||
        !payload.commandId.trim() || !isRuntimeSyncStatus(payload.status) || !isValidAidList(payload.affectedAids) ||
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
    case 'reconcile-scan-lifecycle':
      if (typeof payload.observationEpoch !== 'string' || !payload.observationEpoch.trim() ||
        (payload.authority !== 'complete' && payload.authority !== 'incomplete') || !Array.isArray(payload.observations) || payload.observations.length > 100_000 ||
        payload.observations.some((observation) => !observation || typeof observation !== 'object' || Array.isArray(observation) ||
          !Number.isSafeInteger((observation as Record<string, unknown>).aid) || Number((observation as Record<string, unknown>).aid) <= 0 ||
          typeof (observation as Record<string, unknown>).remoteObserved !== 'boolean' ||
          ((observation as Record<string, unknown>).remoteFolderIds !== undefined &&
            (!Array.isArray((observation as Record<string, unknown>).remoteFolderIds) ||
              ((observation as Record<string, unknown>).remoteFolderIds as unknown[]).some((id) => typeof id !== 'string' || !id.trim()))) ||
          ((observation as Record<string, unknown>).ordinarySource !== undefined && typeof (observation as Record<string, unknown>).ordinarySource !== 'boolean')) ||
        new Set(payload.observations.map((observation) => Number((observation as Record<string, unknown>).aid))).size !== payload.observations.length) invalidCommand()
      return
    case 'record-favorite-event':
      if (!isRepositoryEvent(payload)) invalidCommand()
      return
    case 'record-favorite-events':
      if (!Array.isArray(payload.events) || !payload.events.length || payload.events.length > 100 ||
        !payload.events.every((event) => event && typeof event === 'object' && isRepositoryEvent(event as Record<string, unknown>)) ||
        new Set(payload.events.map((event) => (event as FavoriteRepositoryEvent).id)).size !== payload.events.length) invalidCommand()
      return
    case 'tombstone-favorite-video':
      if (!Number.isSafeInteger(payload.aid) || Number(payload.aid) <= 0 || typeof payload.deletedAt !== 'string' ||
        Number.isNaN(Date.parse(payload.deletedAt)) || (payload.allowRediscovery !== undefined && typeof payload.allowRediscovery !== 'boolean')) invalidCommand()
      return
    case 'delete-favorite-from-library':
      if (!Number.isSafeInteger(payload.aid) || Number(payload.aid) <= 0 || typeof payload.deletedAt !== 'string' ||
        Number.isNaN(Date.parse(payload.deletedAt)) || (payload.reason !== undefined && typeof payload.reason !== 'string')) invalidCommand()
      return
    case 'delete-favorites-from-library':
    case 'recycle-favorites':
      if (!Array.isArray(payload.aids) || !payload.aids.length || payload.aids.length > 100 ||
        !isValidAidList(payload.aids) || new Set(payload.aids).size !== payload.aids.length ||
        typeof payload.deletedAt !== 'string' || Number.isNaN(Date.parse(payload.deletedAt)) ||
        (payload.reason !== undefined && typeof payload.reason !== 'string')) invalidCommand()
      return
    case 'delete-local-managed-folder':
      if (typeof payload.logicalFolderId !== 'string' || !/^bilimi-logical:\S+$/.test(payload.logicalFolderId.trim())) invalidCommand()
      return
    case 'delete-local-managed-folders':
    case 'clear-local-managed-folder-records':
      if (!Array.isArray(payload.logicalFolderIds) || !payload.logicalFolderIds.length || payload.logicalFolderIds.length > 100 ||
        payload.logicalFolderIds.some((folderId) => typeof folderId !== 'string' || !/^bilimi-logical:\S+$/.test(folderId.trim())) ||
        new Set(payload.logicalFolderIds.map((folderId) => folderId.trim())).size !== payload.logicalFolderIds.length) invalidCommand()
      return
    case 'clear-local-inbox':
      if (Object.keys(payload).length) invalidCommand()
      return
    case 'restore-favorite-to-library':
    case 'forget-favorite-tombstone':
      if (!Number.isSafeInteger(payload.aid) || Number(payload.aid) <= 0) invalidCommand()
      return
    case 'clear-recycled-favorite':
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
      ...(payload.lifecycleState ? { lifecycleState: payload.lifecycleState } : {}),
      ...(payload.sourceAuthority ? { sourceAuthority: payload.sourceAuthority } : {}),
      ...(payload.observationEpoch ? { observationEpoch: payload.observationEpoch.trim() } : {}),
      updatedAt: normalizedTimestamp(payload.updatedAt), ...(payload.reason ? { reason: payload.reason } : {}), revision: snapshot.revision + 1
    }
    const formalFolderIds = Object.keys(memberships).filter((folderId) =>
      (folderId.startsWith('local:') && folderId !== 'local:inbox') ||
      (folderId.startsWith('bilimi-logical:') && !physicalShards.some((shard) => shard.logicalLedgerId === folderId.slice('bilimi-logical:'.length))))
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
  const applyPhysicalShardBinding = (payload: Extract<FavoriteRepositoryCommand, { type: 'upsert-physical-shard-binding' }>['payload']) => {
    const logicalLedgerId = payload.logicalLedgerId.trim()
    const logicalTitle = payload.logicalTitle.trim()
    const folderId = `bilimi:${logicalLedgerId}:${String(payload.shardNumber).padStart(3, '0')}`
    const remoteFolderId = payload.remoteFolderId?.trim()
    const bindingState = payload.bindingState
    affectedFolderIds.push(folderId)
    affectedAids.push(...uniquePositiveAids(payload.memberAids))
    const existingLogical = folders.find((folder) => folder.kind === 'bilimi-logical' && folder.logicalLedgerId === logicalLedgerId)
    if (existingLogical && existingLogical.title !== logicalTitle) throw new Error('Favorite repository logical ledger title is immutable.')
    if (!existingLogical) {
      folders = [...folders, { id: `bilimi-logical:${logicalLedgerId}`, title: logicalTitle, kind: 'bilimi-logical', logicalLedgerId, syncState: 'pending-reconcile' }]
    }
    const existingShard = physicalShards.find((shard) => shard.logicalLedgerId === logicalLedgerId && shard.shardNumber === payload.shardNumber)
    if (existingShard?.remoteFolderId && remoteFolderId && existingShard.remoteFolderId !== remoteFolderId) {
      throw new Error('Favorite repository physical shard binding is immutable.')
    }
    physicalShards = [
      ...physicalShards.filter((shard) => shard !== existingShard),
      {
        logicalLedgerId, folderId, shardNumber: payload.shardNumber, remoteTitle: payload.remoteTitle.trim(), bindingState,
        ...(remoteFolderId ? { remoteFolderId } : {}),
        ...(bindingState === 'pending-reconcile' ? { knownRemoteFolderIds: [...new Set(payload.knownRemoteFolderIds?.map((id) => id.trim()).filter(Boolean) ?? [])].sort() } : {}),
        ...(payload.remoteMemberCount !== undefined ? { remoteMemberCount: payload.remoteMemberCount } : {})
      }
    ].sort((left, right) => left.logicalLedgerId.localeCompare(right.logicalLedgerId) || left.shardNumber - right.shardNumber)
    const logicalSyncState = physicalShards
      .filter((shard) => shard.logicalLedgerId === logicalLedgerId)
      .every((shard) => shard.bindingState === 'bound' && Boolean(shard.remoteFolderId))
      ? 'bound' as const
      : 'pending-reconcile' as const
    folders = folders.map((folder) => folder.kind === 'bilimi-logical' && folder.logicalLedgerId === logicalLedgerId
      ? { ...folder, syncState: logicalSyncState }
      : folder)
    memberships = { ...memberships, [folderId]: uniquePositiveAids(payload.memberAids) }
    const logicalFolderId = `bilimi-logical:${logicalLedgerId}`
    const logicalMembers = new Set<number>()
    for (const shard of physicalShards.filter((candidate) => candidate.logicalLedgerId === logicalLedgerId)) {
      for (const aid of memberships[shard.folderId] ?? []) logicalMembers.add(aid)
    }
    memberships = { ...memberships, [logicalFolderId]: [...logicalMembers].sort((left, right) => left - right) }
  }

  switch (command.type) {
    case 'commit-local-plan': {
      const membersByFolderId = normalizeFolderMembers(command.payload.memberAidsByFolderId)
      affectedFolderIds = [...membersByFolderId.keys()].sort()
      affectedAids = uniquePositiveAids([...membersByFolderId.values()].flat()).sort((left, right) => left - right)
      const replaceManagedAids = new Set(command.payload.replaceManagedAids ?? [])
      if (replaceManagedAids.size) {
        const managedFolderIds = Object.keys(memberships).filter((folderId) =>
          folderId.startsWith('local:') || folderId.startsWith('bilimi-logical:'))
        for (const folderId of managedFolderIds) {
          const priorMembers = memberships[folderId] ?? []
          if (!priorMembers.some((aid) => replaceManagedAids.has(aid))) continue
          memberships = {
            ...memberships,
            [folderId]: priorMembers.filter((aid) => !replaceManagedAids.has(aid))
          }
          affectedFolderIds.push(folderId)
        }
        organizationRecords = organizationRecords.filter((record) => !replaceManagedAids.has(record.aid))
        for (const aid of replaceManagedAids) {
          const existing = positions[createFavoriteRepositoryPositionKey(snapshot.accountMid, aid)]
          if (!existing) continue
          applyPlacement({
            ...existing,
            localDesiredFolderIds: [],
            updatedAt: normalizedAcceptedAt
          })
        }
        affectedAids.push(...replaceManagedAids)
      }
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
      for (const placement of command.payload.placements ?? []) applyPlacement(placement)
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
      // A source scan is observation only.  It must not recreate a video the
      // user has explicitly hard-deleted from this local library.
      for (const [folderId, aids] of membersByFolderId) {
        membersByFolderId.set(folderId, aids.filter((aid) => tombstones[createFavoriteRepositoryPositionKey(snapshot.accountMid, aid)]?.allowRediscovery !== false))
      }
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
      for (const aid of mirroredAids) {
        const key = createFavoriteRepositoryPositionKey(snapshot.accountMid, aid)
        if (tombstones[key]?.kind === 'recycled') delete tombstones[key]
      }
      const retainedAids = new Set(Object.values(memberships).flat())
      for (const [aid, video] of Object.entries(videos)) {
        if (!mirroredAids.has(Number(aid)) && !retainedAids.has(Number(aid))) delete videos[aid]
        else videos[aid] = video
      }
      for (const video of command.payload.videos) {
        if (tombstones[createFavoriteRepositoryPositionKey(snapshot.accountMid, video.aid)]?.allowRediscovery === false) continue
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
      if (!command.payload.preserveTombstones) tombstones = {}
      workspace = undefined
      break
    }
    case 'set-folder-members':
      affectedFolderIds = [command.payload.folderId.trim()]
      affectedAids = uniquePositiveAids(command.payload.aids).sort((left, right) => left - right)
      memberships = { ...memberships, [affectedFolderIds[0]]: affectedAids }
      break
    case 'upsert-physical-shard-binding': {
      applyPhysicalShardBinding(command.payload)
      break
    }
    case 'repair-persisted-managed-bindings': {
      if (workspace?.id !== command.payload.workspaceId.trim() || workspace.status !== command.payload.workspaceStatus) {
        throw new Error('Favorite repository workspace changed during persisted recovery.')
      }
      for (const binding of command.payload.bindings) applyPhysicalShardBinding(binding)
      for (const placement of command.payload.placements) applyPlacement(placement)
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
    case 'reconcile-scan-lifecycle': {
      for (const observation of command.payload.observations) {
        const key = createFavoriteRepositoryPositionKey(snapshot.accountMid, observation.aid)
        const existing = positions[key]
        if (command.payload.authority === 'incomplete') {
          if (!existing && !videos[String(observation.aid)]) continue
          positions[key] = {
            accountMid: snapshot.accountMid, aid: observation.aid,
            localDesiredFolderIds: existing?.localDesiredFolderIds ?? [],
            remoteObservedPhysicalFolderIds: existing?.remoteObservedPhysicalFolderIds ?? [],
            remoteObservedLogicalFolderIds: existing?.remoteObservedLogicalFolderIds ?? [],
            positionState: existing?.positionState ?? 'local-only-change',
            ...(existing?.observedAt ? { observedAt: existing.observedAt } : {}),
            ...(existing?.reason ? { reason: existing.reason } : {}),
            updatedAt: normalizedTimestamp(command.issuedAt), revision: snapshot.revision + 1,
            lifecycleState: 'source-pending', sourceAuthority: 'incomplete', observationEpoch: command.payload.observationEpoch.trim()
          }
          affectedAids.push(observation.aid)
          continue
        }
        const remoteFolderIds = normalizeFolderIds(observation.remoteFolderIds ?? existing?.remoteObservedPhysicalFolderIds ?? [])
        const localDesiredFolderIds = existing?.localDesiredFolderIds ?? []
        const expectedRemote = (existing?.remoteObservedPhysicalFolderIds.length ?? 0) > 0 ||
          (existing?.remoteObservedLogicalFolderIds.length ?? 0) > 0
        const localOnly = localDesiredFolderIds.length > 0 && !expectedRemote
        const lifecycleState: FavoriteRepositoryLifecycleState = observation.remoteObserved
          ? (observation.ordinarySource && localDesiredFolderIds.length > 0 ? 'organization-conflict' : 'active')
          : localOnly ? 'active' : expectedRemote ? 'recycled' : 'active'
        positions[key] = {
          accountMid: snapshot.accountMid, aid: observation.aid,
          localDesiredFolderIds, remoteObservedPhysicalFolderIds: remoteFolderIds,
          remoteObservedLogicalFolderIds: existing?.remoteObservedLogicalFolderIds ?? [],
          positionState: existing?.positionState ?? 'local-only-change',
          ...(existing?.observedAt ? { observedAt: existing.observedAt } : {}),
          ...(existing?.reason ? { reason: existing.reason } : {}),
          updatedAt: normalizedTimestamp(command.issuedAt), revision: snapshot.revision + 1,
          lifecycleState, sourceAuthority: 'complete', observationEpoch: command.payload.observationEpoch.trim()
        }
        if (lifecycleState === 'recycled') {
          tombstones[key] = {
            accountMid: snapshot.accountMid, aid: observation.aid, deletedAt: normalizedTimestamp(command.issuedAt),
            reason: 'complete-scan-no-source', allowRediscovery: true, kind: 'recycled'
          }
          organizationRecords = organizationRecords.filter((record) => record.aid !== observation.aid)
        } else if (lifecycleState === 'organization-conflict') {
          organizationRecords = organizationRecords.filter((record) => record.aid !== observation.aid)
        } else if (tombstones[key]?.kind === 'recycled') {
          delete tombstones[key]
        }
        affectedAids.push(observation.aid)
      }
      break
    }
    case 'record-favorite-event':
      affectedAids = [command.payload.aid]
      break
    case 'record-favorite-events':
      affectedAids = [...new Set(command.payload.events.map((event) => event.aid))].sort((left, right) => left - right)
      break
    case 'tombstone-favorite-video': {
      const aid = command.payload.aid
      tombstones[createFavoriteRepositoryPositionKey(snapshot.accountMid, aid)] = {
        accountMid: snapshot.accountMid,
        aid,
        deletedAt: normalizedTimestamp(command.payload.deletedAt),
        allowRediscovery: command.payload.allowRediscovery ?? false,
        ...(command.payload.allowRediscovery ? {} : { kind: 'user-deleted' as const })
      }
      affectedAids = [aid]
      break
    }
    case 'delete-favorite-from-library': {
      const aid = command.payload.aid
      tombstones[createFavoriteRepositoryPositionKey(snapshot.accountMid, aid)] = {
        accountMid: snapshot.accountMid, aid, deletedAt: normalizedTimestamp(command.payload.deletedAt),
        ...(command.payload.reason ? { reason: command.payload.reason } : {}), allowRediscovery: false, kind: 'user-deleted'
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
    case 'delete-favorites-from-library': {
      const selected = uniquePositiveAids(command.payload.aids)
      for (const aid of selected) {
        tombstones[createFavoriteRepositoryPositionKey(snapshot.accountMid, aid)] = {
          accountMid: snapshot.accountMid, aid, deletedAt: normalizedTimestamp(command.payload.deletedAt),
          ...(command.payload.reason ? { reason: command.payload.reason } : {}), allowRediscovery: false, kind: 'user-deleted'
        }
        delete videos[String(aid)]
        delete libraryMirrors[String(aid)]
      }
      // Preserve Bilibili observations while removing all local memberships in one atomic command.
      const removed = new Set(selected)
      for (const folderId of Object.keys(memberships)) {
        if (folderId.startsWith('bilibili:')) continue
        const before = memberships[folderId] ?? []
        if (before.some((aid) => removed.has(aid))) {
          memberships = { ...memberships, [folderId]: before.filter((aid) => !removed.has(aid)) }
          affectedFolderIds.push(folderId)
        }
      }
      affectedAids = selected
      break
    }
    case 'recycle-favorites': {
      const selected = uniquePositiveAids(command.payload.aids)
      for (const aid of selected) {
        const key = createFavoriteRepositoryPositionKey(snapshot.accountMid, aid)
        tombstones[key] = {
          accountMid: snapshot.accountMid, aid, deletedAt: normalizedTimestamp(command.payload.deletedAt),
          ...(command.payload.reason ? { reason: command.payload.reason } : {}), allowRediscovery: true, kind: 'recycled'
        }
        if (positions[key]) positions[key] = { ...positions[key], lifecycleState: 'recycled' }
      }
      affectedAids = selected
      break
    }
    case 'delete-local-managed-folder':
    case 'delete-local-managed-folders': {
      const logicalFolderIds = command.type === 'delete-local-managed-folder'
        ? [command.payload.logicalFolderId.trim()]
        : command.payload.logicalFolderIds.map((folderId) => folderId.trim())
      const logicalFolders = logicalFolderIds.map((logicalFolderId) => {
        const logicalFolder = folders.find((folder) => folder.id === logicalFolderId && folder.kind === 'bilimi-logical')
        if (!logicalFolder?.logicalLedgerId) throw new Error('Favorite repository managed folder was not found.')
        return logicalFolder
      })
      const deletingInbox = logicalFolders.some((logicalFolder) => logicalFolder.logicalLedgerId === 'inbox')
      const deletingLedgerIds = new Set(logicalFolders.map((logicalFolder) => logicalFolder.logicalLedgerId!))
      const removedShards = physicalShards.filter((shard) => deletingLedgerIds.has(shard.logicalLedgerId))
      const removedFolderIds = new Set([...logicalFolderIds, ...removedShards.map((shard) => shard.folderId)])
      const affected = new Set<number>()
      for (const folderId of removedFolderIds) for (const aid of memberships[folderId] ?? []) affected.add(aid)
      if (deletingInbox) for (const aid of memberships['local:inbox'] ?? []) affected.add(aid)
      folders = folders.filter((folder) => !removedFolderIds.has(folder.id))
      physicalShards = physicalShards.filter((shard) => !deletingLedgerIds.has(shard.logicalLedgerId))
      memberships = Object.fromEntries(Object.entries(memberships).filter(([folderId]) => !removedFolderIds.has(folderId)))
      for (const position of Object.values(positions)) {
        if (!position.localDesiredFolderIds.some((folderId) => removedFolderIds.has(folderId))) continue
        const localDesiredFolderIds = position.localDesiredFolderIds.filter((folderId) => !removedFolderIds.has(folderId))
        positions[createFavoriteRepositoryPositionKey(snapshot.accountMid, position.aid)] = {
          ...position,
          localDesiredFolderIds,
          positionState: 'local-only-change', updatedAt: normalizedAcceptedAt, revision: snapshot.revision + 1
        }
        affected.add(position.aid)
      }
      const remainingLogicalFolderIds = folders
        .filter((folder) => folder.kind === 'bilimi-logical')
        .map((folder) => folder.id)
      const inbox = new Set(memberships['local:inbox'] ?? [])
      if (deletingInbox) {
        inbox.clear()
      } else {
        for (const aid of affected) {
          const position = positions[createFavoriteRepositoryPositionKey(snapshot.accountMid, aid)]
          const hasRemainingLogicalPlacement = position
            ? position.localDesiredFolderIds.some((folderId) => folderId.startsWith('bilimi-logical:'))
            : remainingLogicalFolderIds.some((folderId) => memberships[folderId]?.includes(aid))
          if (!hasRemainingLogicalPlacement) inbox.add(aid)
        }
      }
      memberships = { ...memberships, 'local:inbox': [...inbox].sort((left, right) => left - right) }
      affectedFolderIds = [...removedFolderIds, 'local:inbox']
      affectedAids = [...affected]
      break
    }
    case 'clear-local-managed-folder-records': {
      const logicalFolderIds = command.payload.logicalFolderIds.map((folderId) => folderId.trim())
      const logicalFolders = logicalFolderIds.map((logicalFolderId) => {
        const logicalFolder = folders.find((folder) => folder.id === logicalFolderId && folder.kind === 'bilimi-logical')
        if (!logicalFolder?.logicalLedgerId) throw new Error('Favorite repository managed folder was not found.')
        return logicalFolder
      })
      const clearedAids = new Set<number>()
      for (const logicalFolder of logicalFolders) {
        for (const aid of memberships[logicalFolder.id] ?? []) clearedAids.add(aid)
        memberships = { ...memberships, [logicalFolder.id]: [] }
      }
      for (const position of Object.values(positions)) {
        if (!position.localDesiredFolderIds.some((folderId) => logicalFolderIds.includes(folderId))) continue
        const localDesiredFolderIds = position.localDesiredFolderIds.filter((folderId) => !logicalFolderIds.includes(folderId))
        positions[createFavoriteRepositoryPositionKey(snapshot.accountMid, position.aid)] = {
          ...position, localDesiredFolderIds,
          positionState: 'local-only-change', updatedAt: normalizedAcceptedAt, revision: snapshot.revision + 1
        }
        clearedAids.add(position.aid)
      }
      const inbox = new Set(memberships['local:inbox'] ?? [])
      for (const aid of clearedAids) {
        const position = positions[createFavoriteRepositoryPositionKey(snapshot.accountMid, aid)]
        if (!(position?.localDesiredFolderIds ?? []).some((folderId) => folderId.startsWith('bilimi-logical:'))) inbox.add(aid)
      }
      memberships = { ...memberships, 'local:inbox': [...inbox].sort((left, right) => left - right) }
      affectedFolderIds = [...new Set([...logicalFolderIds, 'local:inbox'])].sort()
      affectedAids = [...clearedAids].sort((left, right) => left - right)
      break
    }
    case 'clear-local-inbox': {
      const affected = uniquePositiveAids(memberships['local:inbox'] ?? [])
      if (!folders.some((folder) => folder.id === 'local:inbox')) {
        folders = [...folders, { id: 'local:inbox', title: 'bilimi·暂存', kind: 'local', syncState: 'local-only' }]
      }
      memberships = { ...memberships, 'local:inbox': [] }
      affectedFolderIds = ['local:inbox']
      affectedAids = affected
      break
    }
    case 'restore-favorite-to-library':
      delete tombstones[createFavoriteRepositoryPositionKey(snapshot.accountMid, command.payload.aid)]
      if (positions[createFavoriteRepositoryPositionKey(snapshot.accountMid, command.payload.aid)]) {
        positions[createFavoriteRepositoryPositionKey(snapshot.accountMid, command.payload.aid)] = {
          ...positions[createFavoriteRepositoryPositionKey(snapshot.accountMid, command.payload.aid)], lifecycleState: 'active'
        }
      }
      affectedAids = [command.payload.aid]
      break
    case 'forget-favorite-tombstone':
      delete tombstones[createFavoriteRepositoryPositionKey(snapshot.accountMid, command.payload.aid)]
      affectedAids = [command.payload.aid]
      break
    case 'clear-recycled-favorite': {
      const key = createFavoriteRepositoryPositionKey(snapshot.accountMid, command.payload.aid)
      if (tombstones[key]?.kind !== 'recycled') throw new Error('Favorite is not in the recycle bin.')
      delete videos[String(command.payload.aid)]
      delete libraryMirrors[String(command.payload.aid)]
      delete tombstones[key]
      delete positions[key]
      for (const folderId of Object.keys(memberships)) {
        const before = memberships[folderId] ?? []
        if (before.includes(command.payload.aid)) memberships = { ...memberships, [folderId]: before.filter((aid) => aid !== command.payload.aid) }
      }
      organizationRecords = organizationRecords.filter((record) => record.aid !== command.payload.aid)
      affectedAids = [command.payload.aid]
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

export function isFavoriteRepositoryRecycled(snapshot: AccountFavoriteRepositorySnapshot, aid: number) {
  return snapshot.tombstones?.[createFavoriteRepositoryPositionKey(snapshot.accountMid, aid)]?.kind === 'recycled'
}
