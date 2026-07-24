import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  applyFavoriteRepositoryCommand,
  createAccountFavoriteRepositorySnapshot,
  createFavoriteRepositoryPositionKey,
  deriveFavoriteRepositoryPositionState,
  mergeFavoriteRepositoryVideo,
  validateFavoriteRepositoryArchiveExport,
  type AccountFavoriteRepositorySnapshot,
  type FavoriteRepositoryArchiveExport,
  type FavoriteRepositoryCommand,
  type FavoriteRepositoryCommandResult,
  type FavoriteRepositoryEvent,
  type FavoriteRepositoryOrganizationRecord,
  type FavoriteRepositoryPage,
  type FavoriteRepositoryPositionRecord,
  type FavoriteRepositorySyncRecord,
  type FavoriteRepositoryVideo
} from '../../src/shared/favoriteRepository'
import type { VideoAudioTranscriptionQueueItem } from '../../src/shared/types'

type PersistedRepository = {
  version: 1
  accountMid: string
  snapshot: AccountFavoriteRepositorySnapshot
  commandResults: Record<string, FavoriteRepositoryCommandReceipt>
  /** Archive events are published with the repository generation, never appended after its receipt. */
  importedEvents?: FavoriteRepositoryEvent[]
  syncCommandIds?: string[]
  generation?: string
}

type RepositoryManifest = {
  version: 1
  accountMid: string
  generation: string
  previousGeneration?: string
  checksums: {
    repository: string
    videos: string
    memberships: string
  }
}

type CachedRepository = {
  repository: PersistedRepository
  manifest?: RepositoryManifest
  libraryIndex?: FavoriteRepositoryLibraryIndex
}

type FavoriteRepositoryCommandReceipt = {
  commandId: string
  commandType?: FavoriteRepositoryCommand['type']
  commandFingerprint?: string
  acceptedRevision: number
  acceptedAt: string
  affectedFolderIds: string[]
  affectedAids: number[]
}

type FavoriteRepositoryLibraryIndex = {
  revision: number
  folders: import('../../src/shared/favoriteRepository').FavoriteRepositoryFolder[]
  folderConflicts: Array<{ title: string; folderIds: string[] }>
  allAids: number[]
  folderAidsByFolderId: Map<string, number[]>
  folderIdsByAid: Map<number, string[]>
  pendingStatesByAid: Map<number, Set<FavoriteRepositoryLibraryPageRow['pendingStates'][number]>>
}

type SyncJournalEntry = {
  command: FavoriteRepositoryCommand
  acceptedAt: string
}

type SyncCheckpointState = {
  commandIds: Set<string>
  records: Map<string, FavoriteRepositorySyncRecord>
}

type SyncCheckpointJournalEntry = {
  commandId: string
  record: FavoriteRepositorySyncRecord
}

type BindingJournalEntry = {
  command: Extract<FavoriteRepositoryCommand, { type: 'upsert-physical-shard-binding' }>
  acceptedAt: string
}

type EventJournalEntry = {
  command: Extract<FavoriteRepositoryCommand, { type: 'record-favorite-event' | 'record-favorite-events' }>
  acceptedAt: string
}

type FolderPageOptions = {
  limit: number
  cursor?: string
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function checksum(content: string) {
  return createHash('sha256').update(content).digest('hex')
}

function commandFingerprint(command: FavoriteRepositoryCommand) {
  const { issuedAt: _issuedAt, ...stableCommand } = command
  return checksum(stableJson(stableCommand))
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function receiptFromResult(
  result: FavoriteRepositoryCommandResult,
  command?: FavoriteRepositoryCommand
): FavoriteRepositoryCommandReceipt {
  return {
    commandId: result.commandId,
    ...(command ? { commandType: command.type, commandFingerprint: commandFingerprint(command) } : {}),
    acceptedRevision: result.revision,
    acceptedAt: result.updatedAt,
    affectedFolderIds: [...result.affectedFolderIds],
    affectedAids: [...result.affectedAids]
  }
}

function normalizeCommandReceipts(value: Record<string, unknown>) {
  const receipts: Record<string, FavoriteRepositoryCommandReceipt> = {}
  for (const [id, entry] of Object.entries(value)) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as Partial<FavoriteRepositoryCommandReceipt & FavoriteRepositoryCommandResult>
    const acceptedRevision = candidate.acceptedRevision ?? candidate.revision
    if (typeof candidate.commandId !== 'string' || !Number.isSafeInteger(acceptedRevision)) continue
    receipts[id] = {
      commandId: candidate.commandId,
      ...(candidate.commandType ? { commandType: candidate.commandType } : {}),
      ...(candidate.commandFingerprint ? { commandFingerprint: candidate.commandFingerprint } : {}),
      acceptedRevision: acceptedRevision!,
      acceptedAt: candidate.acceptedAt ?? candidate.updatedAt ?? '1970-01-01T00:00:00.000Z',
      affectedFolderIds: Array.isArray(candidate.affectedFolderIds) ? [...candidate.affectedFolderIds] : [],
      affectedAids: Array.isArray(candidate.affectedAids) ? [...candidate.affectedAids] : []
    }
  }
  return receipts
}

function normalizeAccountMid(accountMid: string) {
  return createAccountFavoriteRepositorySnapshot({
    accountMid,
    now: '1970-01-01T00:00:00.000Z'
  }).accountMid
}

function pageLimit(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new Error('Favorite repository page limit is invalid.')
  }
  return limit
}

function hasAppliedBinding(
  snapshot: AccountFavoriteRepositorySnapshot,
  command: Extract<FavoriteRepositoryCommand, { type: 'upsert-physical-shard-binding' }>
) {
  const logicalLedgerId = command.payload.logicalLedgerId.trim()
  const remoteFolderId = command.payload.remoteFolderId?.trim()
  return snapshot.physicalShards.some((shard) =>
    shard.logicalLedgerId === logicalLedgerId && shard.shardNumber === command.payload.shardNumber &&
    shard.bindingState === command.payload.bindingState && shard.remoteFolderId === remoteFolderId
  )
}

function hasAppliedWorkspace(
  snapshot: AccountFavoriteRepositorySnapshot,
  command: Extract<FavoriteRepositoryCommand, { type: 'set-workspace' }>
) {
  const expected = {
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
  return JSON.stringify(snapshot.workspace) === JSON.stringify(expected)
}

function validSnapshot(value: unknown, accountMid: string): value is AccountFavoriteRepositorySnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Partial<AccountFavoriteRepositorySnapshot>
  return snapshot.version === 1 && snapshot.accountMid === accountMid &&
    Number.isSafeInteger(snapshot.revision) && typeof snapshot.updatedAt === 'string' &&
    !!snapshot.videos && typeof snapshot.videos === 'object' &&
    (snapshot.libraryMirrors === undefined || (typeof snapshot.libraryMirrors === 'object' && !Array.isArray(snapshot.libraryMirrors))) &&
    Array.isArray(snapshot.folders) && !!snapshot.memberships && typeof snapshot.memberships === 'object' &&
    Array.isArray(snapshot.physicalShards) && Array.isArray(snapshot.syncRecords) &&
    (snapshot.organizationRecords === undefined || Array.isArray(snapshot.organizationRecords)) &&
    (snapshot.organizationBatches === undefined || Array.isArray(snapshot.organizationBatches)) &&
    (snapshot.organizationMigrationInitialized === undefined || typeof snapshot.organizationMigrationInitialized === 'boolean')
}

export type FavoriteRepositoryLibraryPageScope =
  | { kind: 'all' }
  | { kind: 'folder'; folderId: string }
  | { kind: 'pending' }
  | { kind: 'protected' }
  | { kind: 'unsynced' }

export type FavoriteRepositoryLibraryPageRow = {
  video: FavoriteRepositoryVideo
  folderIds: string[]
  pendingStates: Array<'protected' | 'unsynced' | 'continuation' | 'failed' | 'result-unknown' | 'transcription'>
}

export type FavoriteRepositoryLibraryDetail = {
  version: 1
  accountMid: string
  revision: number
  video: FavoriteRepositoryVideo
  folderIds: string[]
  pendingStates: FavoriteRepositoryLibraryPageRow['pendingStates']
  protected: boolean
  position?: {
    state: NonNullable<AccountFavoriteRepositorySnapshot['positions'][string]>['positionState']
    localDesiredFolderIds: string[]
    remoteObservedPhysicalFolderIds: string[]
    remoteObservedLogicalFolderIds: string[]
    observedAt?: string
    updatedAt: string
    reason?: string
  }
  sourceShards?: Array<{ folderId: string; shardNumber: number; remoteFolderId: string; title: string }>
  mirror: {
    status: '未同步' | '同步中' | '已同步' | '同步失败' | '待确认'
    lastSyncedAt?: string
  }
}

export type FavoriteRepositoryLibrarySummary = {
  version: 1
  accountMid: string
  revision: number
  updatedAt: string
  videoCount: number
  folderCount: number
  folders: import('../../src/shared/favoriteRepository').FavoriteRepositoryFolder[]
  folderCounts: Record<string, number>
  scopeCounts: { all: number; pending: number; protected: number; unsynced: number }
  folderConflicts?: Array<{ title: string; folderIds: string[] }>
  physicalShardCount: number
  syncRecordCount: number
  syncCounts: Record<'pending' | 'succeeded' | 'failed' | 'result-unknown', number>
  pendingAidCount: number
  workspace?: {
    id: string
    status: NonNullable<AccountFavoriteRepositorySnapshot['workspace']>['status']
    baselineRevision: number
    continuationCount: number
  }
}

function normalizeSnapshot(snapshot: AccountFavoriteRepositorySnapshot): AccountFavoriteRepositorySnapshot {
  return {
    ...snapshot,
    libraryMirrors: snapshot.libraryMirrors ?? {},
    organizationRecords: snapshot.organizationRecords ?? [],
    organizationBatches: snapshot.organizationBatches ?? [],
    organizationMigrationInitialized: snapshot.organizationMigrationInitialized ?? false,
    positions: snapshot.positions ?? {},
    tombstones: snapshot.tombstones ?? {}
  }
}

function validPersisted(value: unknown, accountMid: string): value is PersistedRepository {
  if (!value || typeof value !== 'object') return false
  const persisted = value as Partial<PersistedRepository>
  return persisted.version === 1 && persisted.accountMid === accountMid &&
    validSnapshot(persisted.snapshot, accountMid) && !!persisted.commandResults &&
    typeof persisted.commandResults === 'object' && !Array.isArray(persisted.commandResults) &&
    (persisted.syncCommandIds === undefined ||
      (Array.isArray(persisted.syncCommandIds) && persisted.syncCommandIds.every((id) => typeof id === 'string' && !!id))) &&
    (persisted.importedEvents === undefined || (Array.isArray(persisted.importedEvents) && persisted.importedEvents.every((event) =>
      event && typeof event === 'object' && (event as FavoriteRepositoryEvent).accountMid === accountMid &&
      Number.isSafeInteger((event as FavoriteRepositoryEvent).aid) && (event as FavoriteRepositoryEvent).aid > 0 &&
      typeof (event as FavoriteRepositoryEvent).id === 'string' && !!(event as FavoriteRepositoryEvent).id)))
}

function validManifest(value: unknown, accountMid: string): value is RepositoryManifest {
  if (!value || typeof value !== 'object') return false
  const manifest = value as Partial<RepositoryManifest>
  const checksums = manifest.checksums
  return manifest.version === 1 && manifest.accountMid === accountMid &&
    typeof manifest.generation === 'string' && !!manifest.generation &&
    (manifest.previousGeneration === undefined || typeof manifest.previousGeneration === 'string') &&
    !!checksums && typeof checksums === 'object' &&
    typeof checksums.repository === 'string' && typeof checksums.videos === 'string' &&
    typeof checksums.memberships === 'string'
}

export class FavoriteRepositoryService {
  private readonly cache = new Map<string, CachedRepository>()
  private writeTail = Promise.resolve()
  private pendingWriteCount = 0
  private readonly syncCheckpointState = new Map<string, SyncCheckpointState>()
  private readonly changeListeners = new Set<(result: FavoriteRepositoryCommandResult) => void>()

  constructor(private readonly options: {
    root: string
    now?: () => string
    getTranscriptionItems?: () => readonly VideoAudioTranscriptionQueueItem[]
  }) {}

  async getSnapshot(accountMid: string): Promise<AccountFavoriteRepositorySnapshot> {
    const account = normalizeAccountMid(accountMid)
    return this.queue(async () => clone(this.mergeSyncCheckpoints(
      (await this.load(account)).repository,
      await this.loadSyncCheckpointState(account)
    ).snapshot))
  }

  async getLibrarySummary(accountMid: string): Promise<FavoriteRepositoryLibrarySummary> {
    const account = normalizeAccountMid(accountMid)
    const cached = await this.load(account)
    const snapshot = this.mergeSyncCheckpoints(cached.repository, await this.loadSyncCheckpointState(account)).snapshot
    const syncCounts: FavoriteRepositoryLibrarySummary['syncCounts'] = {
      pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0
    }
    for (const record of snapshot.syncRecords) syncCounts[record.status]++
    const pendingAidCount = this.actionablePendingAids(snapshot).length
    const index = this.libraryIndex(cached, snapshot)
    const countFor = (folderId: string) => index.folderAidsByFolderId.get(folderId)?.length ?? 0
    const stateCount = (state: FavoriteRepositoryLibraryPageRow['pendingStates'][number]) =>
      [...index.pendingStatesByAid].filter(([aid, states]) => Boolean(snapshot.videos[String(aid)]) && states.has(state)).length
    return {
      version: 1,
      accountMid: snapshot.accountMid,
      revision: snapshot.revision,
      updatedAt: snapshot.updatedAt,
      videoCount: Object.keys(snapshot.videos).length,
      folderCount: index.folders.length,
      folders: index.folders.map((folder) => ({ ...folder })),
      folderCounts: Object.fromEntries(index.folders.map((folder) => [folder.id, countFor(folder.id)])),
      scopeCounts: { all: index.allAids.length, pending: pendingAidCount, protected: stateCount('protected'), unsynced: stateCount('unsynced') },
      ...(index.folderConflicts.length ? { folderConflicts: index.folderConflicts.map((conflict) => ({
        title: conflict.title, folderIds: [...conflict.folderIds]
      })) } : {}),
      physicalShardCount: snapshot.physicalShards.length,
      syncRecordCount: snapshot.syncRecords.length,
      syncCounts,
      pendingAidCount,
      ...(snapshot.workspace ? {
        workspace: {
          id: snapshot.workspace.id,
          status: snapshot.workspace.status,
          baselineRevision: snapshot.workspace.baselineRevision,
          continuationCount: snapshot.workspace.continuationAids.length
        }
      } : {})
    }
  }

  /**
   * Imports only portable local data after the caller has completed parsing and checksum validation.
   * Bilibili observations, credentials, and remote-operation evidence never come from an archive.
   */
  async applyArchiveImport(
    accountMid: string,
    input: {
      validate: () => FavoriteRepositoryArchiveExport & { checksum: string } | Promise<FavoriteRepositoryArchiveExport & { checksum: string }>
      mode?: 'merge' | 'overwrite'
    }
  ): Promise<FavoriteRepositoryCommandResult> {
    const account = normalizeAccountMid(accountMid)
    const suppliedArchive = await input.validate()
    // Preserve this actionable account error while still independently running
    // full schema and checksum validation before any persistence work.
    if ((suppliedArchive.events ?? []).some((event) => event.accountMid !== account)) {
      throw new Error('Favorite repository archive event account mismatch.')
    }
    const archive = validateFavoriteRepositoryArchiveExport(suppliedArchive)
    const mode = input.mode ?? 'merge'
    if (normalizeAccountMid(archive.accountMid) !== account) throw new Error('Favorite repository archive account mismatch.')
    // Validate every event before calculating any projection or creating a new
    // generation.  Import callers may provide a validator, but this boundary
    // must remain safe even if that implementation is replaced.
    if ((archive.events ?? []).some((event) => event.accountMid !== archive.accountMid || event.accountMid !== account)) {
      throw new Error('Favorite repository archive event account mismatch.')
    }
    const commandId = `archive-import:${archive.checksum.toLowerCase()}`
    this.pendingWriteCount++
    return this.queue(async () => {
      const cached = await this.load(account)
      const repository = this.mergeSyncCheckpoints(cached.repository, await this.loadSyncCheckpointState(account))
      const existing = repository.commandResults[commandId]
      if (existing) return this.resultFromReceipt(repository.snapshot, existing)

      // Stage the event projection in the same generation as the snapshot and
      // receipt. A failure while publishing that generation leaves no visible
      // snapshot/receipt/event state; unlike post-persist append, it cannot
      // produce a restored repository with a missing user history.
      const existingEventIds = new Set([
        ...(repository.importedEvents ?? []).map((event) => event.id),
        ...(await Promise.all([...new Set((archive.events ?? []).map((event) => event.aid))]
          .map(async (aid) => (await this.readEvents(account, aid)).map((event) => event.id)))).flat()
      ])
      const importedEvents = [
        ...(repository.importedEvents ?? []),
        ...(archive.events ?? []).filter((event) => !existingEventIds.has(event.id)).map(clone)
      ].sort((left, right) => left.aid - right.aid || left.sequence - right.sequence || left.id.localeCompare(right.id))

      const importedAids = new Set<number>([
        ...(archive.videos ?? []).map((video) => video.aid),
        ...(archive.positions ?? []).map((position) => position.aid),
        ...(archive.protections ?? []).map((record) => record.aid),
        ...(archive.recovery?.organizationRecords ?? []).map((record) => record.aid),
        ...(archive.recovery?.organizationBatches ?? []).map((record) => record.aid),
        ...(archive.recovery?.tombstones ?? []).map((record) => record.aid),
        ...Object.values(archive.recovery?.memberships ?? {}).flat()
      ])
      const videos = mode === 'overwrite' ? {} : { ...repository.snapshot.videos }
      for (const video of archive.videos ?? []) {
        videos[String(video.aid)] = mergeFavoriteRepositoryVideo(videos[String(video.aid)], video)
      }
      // Remote observations are device-local evidence, never portable import data.
      const retainedRemotePositions = Object.fromEntries(Object.entries(repository.snapshot.positions).map(([key, position]) => [key, {
        ...position, localDesiredFolderIds: [], remoteObservedPhysicalFolderIds: [...position.remoteObservedPhysicalFolderIds],
        remoteObservedLogicalFolderIds: [...position.remoteObservedLogicalFolderIds]
      }]))
      const positions = mode === 'overwrite' ? retainedRemotePositions : { ...repository.snapshot.positions }
      const recovery = archive.recovery
      const importedFolders = recovery?.folders ?? []
      const foldersById = new Map((mode === 'overwrite' ? [] : repository.snapshot.folders).map((folder) => [folder.id, clone(folder)]))
      for (const folder of importedFolders) foldersById.set(folder.id, clone(folder))
      const memberships = mode === 'overwrite' ? {} : { ...repository.snapshot.memberships }
      if (recovery) for (const [folderId, aids] of Object.entries(recovery.memberships)) memberships[folderId] = [...new Set(aids)].sort((left, right) => left - right)
      const affectedFolderIds = new Set<string>()
      for (const folder of importedFolders) affectedFolderIds.add(folder.id)
      for (const imported of archive.positions ?? []) {
        const key = createFavoriteRepositoryPositionKey(account, imported.aid)
        const previous = positions[key]
        const localDesiredFolderIds = [...new Set(imported.localDesiredFolderIds.map((id) => id.trim()).filter(Boolean))].sort()
        const remoteObservedPhysicalFolderIds = previous?.remoteObservedPhysicalFolderIds ?? []
        const remoteObservedLogicalFolderIds = previous?.remoteObservedLogicalFolderIds ?? []
        positions[key] = {
          accountMid: account,
          aid: imported.aid,
          localDesiredFolderIds,
          remoteObservedPhysicalFolderIds: [...remoteObservedPhysicalFolderIds],
          remoteObservedLogicalFolderIds: [...remoteObservedLogicalFolderIds],
          positionState: previous && (remoteObservedPhysicalFolderIds.length || remoteObservedLogicalFolderIds.length)
            ? previous.positionState
            : deriveFavoriteRepositoryPositionState({
              localDesiredFolderIds, remoteObservedPhysicalFolderIds, remoteObservedLogicalFolderIds,
              positionState: imported.positionState
            }),
          ...(previous?.observedAt ? { observedAt: previous.observedAt } : {}),
          updatedAt: imported.updatedAt,
          ...(previous?.reason ? { reason: previous.reason } : {}),
          revision: repository.snapshot.revision + 1
        }
        const formalFolderIds = Object.keys(memberships).filter((folderId) =>
          (folderId.startsWith('local:') && folderId !== 'local:inbox') || folderId.startsWith('bilimi-logical:'))
        for (const folderId of new Set([...formalFolderIds, ...localDesiredFolderIds])) {
          const members = new Set(memberships[folderId] ?? [])
          if (localDesiredFolderIds.includes(folderId)) members.add(imported.aid)
          else members.delete(imported.aid)
          memberships[folderId] = [...members].sort((left, right) => left - right)
          affectedFolderIds.add(folderId)
        }
        const inbox = new Set(memberships['local:inbox'] ?? [])
        if (localDesiredFolderIds.length) inbox.delete(imported.aid)
        else inbox.add(imported.aid)
        memberships['local:inbox'] = [...inbox].sort((left, right) => left - right)
        affectedFolderIds.add('local:inbox')
      }
      // Recovery membership is the archive's authoritative local folder
      // inventory. Apply it after position compatibility projection, which is
      // intentionally limited to individual desired placement records.
      if (recovery) {
        for (const [folderId, aids] of Object.entries(recovery.memberships)) {
          memberships[folderId] = [...new Set(aids)].sort((left, right) => left - right)
          affectedFolderIds.add(folderId)
        }
      }
      const protectionsByAid = new Map((mode === 'overwrite' ? [] : repository.snapshot.organizationRecords).map((record) => [record.aid, record]))
      for (const imported of archive.protections ?? []) {
        const previous = protectionsByAid.get(imported.aid)
        protectionsByAid.set(imported.aid, {
          accountMid: account,
          aid: imported.aid,
          targetFolderIds: previous?.targetFolderIds ?? [],
          completedAt: previous && previous.completedAt > imported.completedAt ? previous.completedAt : imported.completedAt
        })
      }
      for (const imported of recovery?.organizationRecords ?? []) {
        const previous = protectionsByAid.get(imported.aid)
        protectionsByAid.set(imported.aid, previous && previous.completedAt > imported.completedAt ? previous : clone(imported))
      }
      const syncRecordsById = new Map((mode === 'overwrite' ? [] : repository.snapshot.syncRecords).map((record) => [record.id, record]))
      for (const record of recovery?.syncRecords ?? []) {
        const previous = syncRecordsById.get(record.id)
        if (!previous || record.updatedAt >= previous.updatedAt) syncRecordsById.set(record.id, clone(record))
      }
      const batchesById = new Map((mode === 'overwrite' ? [] : repository.snapshot.organizationBatches).map((record) => [record.id, record]))
      for (const record of recovery?.organizationBatches ?? []) {
        const previous = batchesById.get(record.id)
        if (!previous || record.recordedAt >= previous.recordedAt) batchesById.set(record.id, clone(record))
      }
      const tombstones = mode === 'overwrite' ? {} : { ...repository.snapshot.tombstones }
      for (const tombstone of recovery?.tombstones ?? []) {
        const key = createFavoriteRepositoryPositionKey(account, tombstone.aid)
        const previous = tombstones[key]
        if (!previous || tombstone.deletedAt >= previous.deletedAt) tombstones[key] = clone(tombstone)
      }
      const physicalShardByKey = new Map((mode === 'overwrite' ? [] : repository.snapshot.physicalShards).map((shard) => [`${shard.logicalLedgerId}:${shard.shardNumber}`, shard]))
      for (const shard of recovery?.physicalShards ?? []) physicalShardByKey.set(`${shard.logicalLedgerId}:${shard.shardNumber}`, clone(shard))
      const snapshot: AccountFavoriteRepositorySnapshot = {
        ...repository.snapshot,
        revision: repository.snapshot.revision + 1,
        updatedAt: this.now(),
        videos,
        folders: [...foldersById.values()].sort((left, right) => left.id.localeCompare(right.id)),
        memberships,
        physicalShards: [...physicalShardByKey.values()].sort((left, right) => left.logicalLedgerId.localeCompare(right.logicalLedgerId) || left.shardNumber - right.shardNumber),
        positions,
        organizationRecords: [...protectionsByAid.values()].sort((left, right) => left.aid - right.aid),
        organizationBatches: [...batchesById.values()].sort((left, right) => left.recordedAt.localeCompare(right.recordedAt) || left.id.localeCompare(right.id)),
        organizationMigrationInitialized: Boolean(repository.snapshot.organizationMigrationInitialized || recovery?.organizationMigrationInitialized),
        syncRecords: [...syncRecordsById.values()].sort((left, right) => left.id.localeCompare(right.id)),
        tombstones,
        ...(recovery?.workspace ? { workspace: clone(recovery.workspace) } : mode === 'overwrite' ? { workspace: undefined } : {})
      }
      const result: FavoriteRepositoryCommandResult = {
        ...snapshot,
        commandId,
        affectedFolderIds: [...affectedFolderIds].sort(),
        affectedAids: [...importedAids].sort((left, right) => left - right)
      }
      const next: PersistedRepository = {
        ...repository,
        snapshot,
        importedEvents,
        commandResults: { ...repository.commandResults, [commandId]: receiptFromResult(result) }
      }
      // Snapshot, receipt, and staged archive event projection share one atomic
      // generation publication; no event append happens after the receipt.
      const persisted = await this.persist(account, next, cached.manifest?.generation)
      this.cache.set(account, persisted)
      this.emitChange(result)
      return clone(result)
    }).finally(() => {
      this.pendingWriteCount--
    })
  }

  async getOrganizationChanges(accountMid: string) {
    const account = normalizeAccountMid(accountMid)
    return this.queue(async () => clone((await this.load(account)).repository.snapshot.organizationBatches ?? []))
  }

  onChanged(listener: (result: FavoriteRepositoryCommandResult) => void) {
    this.changeListeners.add(listener)
    return () => this.changeListeners.delete(listener)
  }

  async getFolderPage(
    accountMid: string,
    folderId: string,
    options: FolderPageOptions
  ): Promise<FavoriteRepositoryPage<FavoriteRepositoryVideo>> {
    const account = normalizeAccountMid(accountMid)
    const normalizedFolderId = folderId.trim()
    if (!normalizedFolderId) throw new Error('Favorite repository folder id is invalid.')
    const limit = pageLimit(options.limit)
    return this.queue(async () => {
      const snapshot = (await this.load(account)).repository.snapshot
      const aids = snapshot.memberships[normalizedFolderId] ?? []
      const start = options.cursor ? Math.max(0, aids.findIndex((aid) => String(aid) === options.cursor) + 1) : 0
      const selected = aids.slice(start, start + limit)
      const items = selected.flatMap((aid) => snapshot.videos[String(aid)] ? [clone(snapshot.videos[String(aid)])] : [])
      const nextCursor = start + limit < aids.length ? String(selected.at(-1)) : undefined
      return {
        version: 1,
        accountMid: account,
        items,
        nextCursor,
        revision: snapshot.revision
      }
    })
  }

  async commit(
    accountMid: string,
    command: FavoriteRepositoryCommand
  ): Promise<FavoriteRepositoryCommandResult> {
    const account = normalizeAccountMid(accountMid)
    this.pendingWriteCount++
    return this.queue(async () => {
      if (normalizeAccountMid(command.accountMid) !== account) {
        throw new Error('Favorite repository account mismatch.')
      }
      const cached = await this.load(account)
      let repository = cached.repository
      const previousSnapshot = repository.snapshot
      if (command.type !== 'record-sync-result' && command.type !== 'upsert-physical-shard-binding') {
        repository = this.mergeSyncCheckpoints(repository, await this.loadSyncCheckpointState(account))
      }
      const existing = repository.commandResults[command.id]
      // A retained command result is reusable only while the current snapshot
      // still reflects the command's authoritative binding or workspace state.
      const retainedResultStillApplies = command.type === 'upsert-physical-shard-binding'
        ? hasAppliedBinding(repository.snapshot, command)
        : command.type === 'set-workspace'
          ? hasAppliedWorkspace(repository.snapshot, command)
          : true
      if (existing && retainedResultStillApplies) {
        if (existing.commandFingerprint && existing.commandFingerprint !== commandFingerprint(command)) {
          throw new Error('Favorite repository command id conflict.')
        }
        return this.resultFromReceipt(repository.snapshot, existing)
      }
      if (command.type === 'record-sync-result' && repository.syncCommandIds?.includes(command.id)) {
        return this.duplicateSyncResult(repository.snapshot, command)
      }

      const acceptedAt = this.now()
      const result = applyFavoriteRepositoryCommand(repository.snapshot, command, acceptedAt)
      const publishedResult = this.withCanonicalAffectedFolders(result, previousSnapshot)
      const next: PersistedRepository = {
        ...repository,
        snapshot: this.snapshotFromResult(result),
        commandResults: command.type === 'record-sync-result'
          ? repository.commandResults
          : { ...repository.commandResults, [command.id]: receiptFromResult(result, command) },
        ...(command.type === 'record-sync-result'
          ? { syncCommandIds: [...new Set([...(repository.syncCommandIds ?? []), command.id])] }
          : {})
      }
      if (command.type === 'record-sync-result') {
        await this.appendSyncJournal(account, { command: clone(command), acceptedAt })
        this.cache.set(account, { ...cached, repository: next, libraryIndex: undefined })
        this.emitChange(publishedResult)
        return clone(result)
      }
      if (command.type === 'upsert-physical-shard-binding') {
        await this.appendBindingJournal(account, { command: clone(command), acceptedAt })
        this.cache.set(account, { ...cached, repository: next, libraryIndex: undefined })
        this.emitChange(publishedResult)
        return clone(result)
      }
      if (command.type === 'record-favorite-event' || command.type === 'record-favorite-events') {
        await this.appendEventJournal(account, { command: clone(command), acceptedAt })
        const events = command.type === 'record-favorite-event' ? [command.payload] : command.payload.events
        for (const event of events) await this.appendEventOnce(account, { ...event, accountMid: account })
        this.cache.set(account, { ...cached, repository: next, libraryIndex: undefined })
        this.emitChange(publishedResult)
        return clone(result)
      }
      const persisted = await this.persist(account, next, cached.manifest?.generation)
      await rm(this.syncJournalPath(account), { force: true })
      await rm(this.syncCheckpointJournalPath(account), { force: true })
      await rm(this.bindingJournalPath(account), { force: true })
      await rm(this.eventJournalPath(account), { force: true })
      this.syncCheckpointState.delete(account)
      this.cache.set(account, persisted)
      this.emitChange(publishedResult)
      return clone(result)
    }).finally(() => {
      this.pendingWriteCount--
    })
  }

  async getLibraryPage(
    accountMid: string,
    scope: FavoriteRepositoryLibraryPageScope,
    options: FolderPageOptions
  ): Promise<FavoriteRepositoryPage<FavoriteRepositoryLibraryPageRow>> {
    const account = normalizeAccountMid(accountMid)
    const limit = pageLimit(options.limit)
    const cached = await this.load(account)
    const snapshot = this.mergeSyncCheckpoints(cached.repository, await this.loadSyncCheckpointState(account)).snapshot
    const index = this.libraryIndex(cached, snapshot)
    const scopedAids = this.libraryAids(snapshot, scope, index)
    const start = options.cursor ? Math.max(0, Number(options.cursor)) : 0
    if (!Number.isSafeInteger(start) || start < 0) throw new Error('Favorite repository page cursor is invalid.')
    const selected = scopedAids.slice(start, start + limit)
    const stateOrder: FavoriteRepositoryLibraryPageRow['pendingStates'] = ['protected', 'unsynced', 'continuation', 'failed', 'result-unknown', 'transcription']
    return {
      version: 1,
      accountMid: account,
      items: selected.flatMap((aid) => {
        const video = snapshot.videos[String(aid)]
        if (!video) return []
        return [{
          video: { ...video, tags: [...video.tags] },
          folderIds: [...(index.folderIdsByAid.get(aid) ?? [])],
          pendingStates: stateOrder.filter((state) => index.pendingStatesByAid.get(aid)?.has(state))
        }]
      }),
      ...(start + limit < scopedAids.length ? { nextCursor: String(start + limit) } : {}),
      revision: snapshot.revision
    }
  }

  async getLibraryDetail(accountMid: string, aid: number): Promise<FavoriteRepositoryLibraryDetail | null> {
    const account = normalizeAccountMid(accountMid)
    if (!Number.isSafeInteger(aid) || aid <= 0) throw new Error('Favorite library video is invalid.')
    const cached = await this.load(account)
    const snapshot = this.mergeSyncCheckpoints(cached.repository, await this.loadSyncCheckpointState(account)).snapshot
    const video = snapshot.videos[String(aid)]
    if (!video) return null
    const index = this.libraryIndex(cached, snapshot)
    const stateOrder: FavoriteRepositoryLibraryPageRow['pendingStates'] = ['protected', 'unsynced', 'continuation', 'failed', 'result-unknown', 'transcription']
    return {
      version: 1,
      accountMid: account,
      revision: snapshot.revision,
      video: { ...video, tags: [...video.tags] },
      folderIds: [...(index.folderIdsByAid.get(aid) ?? [])],
      pendingStates: stateOrder.filter((state) => index.pendingStatesByAid.get(aid)?.has(state)),
      protected: snapshot.organizationRecords.some((record) => record.aid === aid),
      ...(snapshot.positions[`${snapshot.accountMid}:${aid}`] ? {
        position: this.positionSummary(snapshot.positions[`${snapshot.accountMid}:${aid}`])
      } : {}),
      sourceShards: snapshot.physicalShards
        .filter((shard) => Boolean(shard.remoteFolderId) && (snapshot.memberships[shard.folderId] ?? []).includes(aid))
        .sort((left, right) => left.logicalLedgerId.localeCompare(right.logicalLedgerId) || left.shardNumber - right.shardNumber)
        .map((shard) => ({ folderId: shard.folderId, shardNumber: shard.shardNumber, remoteFolderId: shard.remoteFolderId!, title: shard.remoteTitle })),
      mirror: this.mirrorSummary(snapshot.libraryMirrors?.[String(aid)])
    }
  }

  async getSyncCheckpoints(accountMid: string, runId: string): Promise<FavoriteRepositorySyncRecord[]> {
    const account = normalizeAccountMid(accountMid)
    return this.queue(async () => {
      const records = new Map((await this.load(account)).repository.snapshot.syncRecords.map((record) => [record.id, record]))
      for (const [id, record] of (await this.loadSyncCheckpointState(account)).records) records.set(id, record)
      return Array.from(records.values()).filter((record) => record.runId === runId).map(clone)
    })
  }

  async recordSyncCheckpoint(accountMid: string, commandId: string, record: FavoriteRepositorySyncRecord): Promise<void> {
    const account = normalizeAccountMid(accountMid)
    this.pendingWriteCount++
    return this.queue(async () => {
      const state = await this.loadSyncCheckpointState(account)
      if (state.commandIds.has(commandId)) return
      await this.appendSyncCheckpoint(account, { commandId, record: clone(record) })
      state.commandIds.add(commandId)
      state.records.set(record.id, clone(record))
      const cached = this.cache.get(account)
      if (cached) cached.libraryIndex = undefined
    }).finally(() => { this.pendingWriteCount-- })
  }

  hasPendingWrites() {
    return this.pendingWriteCount > 0
  }

  async flush() {
    await this.writeTail
  }

  /** Invalidates in-memory generations after an externally staged local-data publish. */
  clearCache() {
    this.cache.clear()
    this.syncCheckpointState.clear()
  }

  private now() {
    return this.options.now?.() ?? new Date().toISOString()
  }

  /** Removes only one account's local repository projection after a confirmed cleanup. */
  async deleteAccountLocalData(accountMid: string): Promise<void> {
    const account = normalizeAccountMid(accountMid)
    await this.queue(async () => {
      await rm(this.accountDirectory(account), { recursive: true, force: true })
      this.cache.delete(account)
      this.syncCheckpointState.delete(account)
    })
  }

  async getEventPage(accountMid: string, aid: number, options: FolderPageOptions): Promise<FavoriteRepositoryPage<FavoriteRepositoryEvent>> {
    const account = normalizeAccountMid(accountMid)
    if (!Number.isSafeInteger(aid) || aid <= 0) throw new Error('Favorite library video is invalid.')
    const limit = pageLimit(options.limit)
    return this.queue(async () => {
      const repository = (await this.load(account)).repository
      const byId = new Map<string, FavoriteRepositoryEvent>()
      for (const event of repository.importedEvents ?? []) if (event.aid === aid && event.accountMid === account) byId.set(event.id, event)
      for (const event of await this.readEvents(account, aid)) byId.set(event.id, event)
      const items = [...byId.values()].sort((left, right) => right.sequence - left.sequence || right.id.localeCompare(left.id))
      const start = options.cursor ? Math.max(0, items.findIndex((event) => `${event.sequence}:${event.id}` === options.cursor) + 1) : 0
      const page = items.slice(start, start + limit)
      return {
        version: 1,
        accountMid: account,
        revision: repository.snapshot.revision,
        items: page.map(clone),
        ...(start + limit < items.length ? { nextCursor: `${page.at(-1)!.sequence}:${page.at(-1)!.id}` } : {})
      }
    })
  }

  async getLibraryFolderAids(accountMid: string, folderId: string): Promise<number[]> {
    const account = normalizeAccountMid(accountMid)
    const normalizedFolderId = folderId.trim()
    if (!normalizedFolderId) throw new Error('Favorite repository folder id is invalid.')
    const cached = await this.load(account)
    const snapshot = this.mergeSyncCheckpoints(cached.repository, await this.loadSyncCheckpointState(account)).snapshot
    const index = this.libraryIndex(cached, snapshot)
    if (!index.folders.some((folder) => folder.id === normalizedFolderId)) {
      throw new Error('Favorite repository folder was not found.')
    }
    return [...(index.folderAidsByFolderId.get(normalizedFolderId) ?? [])]
  }

  /**
   * Resolves a renderer-supplied logical archive scope entirely in the main
   * process. The returned IDs use the same canonical membership index as the
   * library page, so every bound shard and bound Bilibili mirror contributes
   * once without exposing those physical identifiers to the renderer.
   */
  async resolveArchiveRestoreLogicalFolderAids(accountMid: string, folderId: string): Promise<number[]> {
    const account = normalizeAccountMid(accountMid)
    const logicalFolderId = folderId.trim()
    if (!/^bilimi-logical:\S+$/.test(logicalFolderId)) {
      throw new Error('Archive restore scope must name a Bilimi logical folder.')
    }
    const snapshot = await this.getSnapshot(account)
    const logicalFolder = snapshot.folders.find((folder) => folder.id === logicalFolderId && folder.kind === 'bilimi-logical')
    if (!logicalFolder) throw new Error('Archive restore scope must name a Bilimi logical folder.')
    if (logicalFolder.syncState !== 'bound' || !logicalFolder.logicalLedgerId) {
      throw new Error('Archive restore logical folder is not currently bound.')
    }
    const boundShards = snapshot.physicalShards.filter((shard) =>
      shard.logicalLedgerId === logicalFolder.logicalLedgerId && shard.bindingState === 'bound' && shard.remoteFolderId)
    if (!boundShards.length) throw new Error('Archive restore logical folder is not currently bound.')
    const logicalLedgerIdsByRemoteFolderId = new Map<string, Set<string>>()
    for (const shard of snapshot.physicalShards) {
      if (!shard.remoteFolderId) continue
      const ledgerIds = logicalLedgerIdsByRemoteFolderId.get(shard.remoteFolderId) ?? new Set<string>()
      ledgerIds.add(shard.logicalLedgerId)
      logicalLedgerIdsByRemoteFolderId.set(shard.remoteFolderId, ledgerIds)
    }
    if (boundShards.some((shard) => logicalLedgerIdsByRemoteFolderId.get(shard.remoteFolderId!)!.size > 1)) {
      throw new Error('Archive restore logical folder has conflicting remote bindings.')
    }
    return this.getLibraryFolderAids(account, logicalFolderId)
  }

  private emitChange(result: FavoriteRepositoryCommandResult) {
    for (const listener of this.changeListeners) listener(clone(result))
  }

  private withCanonicalAffectedFolders(
    result: FavoriteRepositoryCommandResult,
    previousSnapshot?: AccountFavoriteRepositorySnapshot
  ) {
    const canonicalFolderIds = new Set(result.affectedFolderIds)
    if (previousSnapshot) {
      const beforeRawIds = new Set(previousSnapshot.folders.filter((folder) => folder.kind === 'bilibili').map((folder) => folder.id))
      const afterRawIds = new Set(result.folders.filter((folder) => folder.kind === 'bilibili').map((folder) => folder.id))
      for (const folderId of beforeRawIds) if (!afterRawIds.has(folderId)) canonicalFolderIds.add(folderId)
      for (const folderId of afterRawIds) if (!beforeRawIds.has(folderId)) canonicalFolderIds.add(folderId)
    }
    for (const snapshot of [previousSnapshot, result].filter(Boolean) as AccountFavoriteRepositorySnapshot[]) {
      for (const shard of snapshot.physicalShards) {
        if (canonicalFolderIds.has(shard.folderId) || (shard.remoteFolderId && snapshot.folders.some((folder) =>
          canonicalFolderIds.has(folder.id) && folder.remoteFolderId === shard.remoteFolderId))) {
          canonicalFolderIds.add(`bilimi-logical:${shard.logicalLedgerId}`)
        }
      }
      if (canonicalFolderIds.has('local:inbox') && snapshot.folders.some((folder) => folder.id === 'bilimi-logical:inbox')) {
        canonicalFolderIds.add('bilimi-logical:inbox')
      }
    }
    return { ...result, affectedFolderIds: [...canonicalFolderIds].sort() }
  }

  private snapshotFromResult(result: FavoriteRepositoryCommandResult): AccountFavoriteRepositorySnapshot {
    const { commandId: _commandId, affectedFolderIds: _affectedFolderIds, affectedAids: _affectedAids, ...snapshot } = result
    return snapshot
  }

  private libraryIndex(cached: CachedRepository, snapshot: AccountFavoriteRepositorySnapshot) {
    if (!cached.libraryIndex || cached.libraryIndex.revision !== snapshot.revision) {
      cached.libraryIndex = this.createLibraryIndex(snapshot)
    }
    if (!this.options.getTranscriptionItems) return cached.libraryIndex
    return { ...cached.libraryIndex, pendingStatesByAid: this.pendingStatesByAid(snapshot) }
  }

  private createLibraryIndex(snapshot: AccountFavoriteRepositorySnapshot): FavoriteRepositoryLibraryIndex {
    const canonicalIdByRawId = new Map(snapshot.folders.map((folder) => [folder.id, folder.id]))
    const logicalFolders = new Map(snapshot.folders
      .filter((folder) => folder.kind === 'bilimi-logical' && folder.logicalLedgerId)
      .map((folder) => [folder.logicalLedgerId!, folder]))
    const logicalIdsByRemoteFolderId = new Map<string, Set<string>>()
    for (const shard of snapshot.physicalShards) {
      if (!shard.remoteFolderId) continue
      const logicalIds = logicalIdsByRemoteFolderId.get(shard.remoteFolderId) ?? new Set<string>()
      logicalIds.add(shard.logicalLedgerId)
      logicalIdsByRemoteFolderId.set(shard.remoteFolderId, logicalIds)
    }
    for (const shard of snapshot.physicalShards) {
      const logical = logicalFolders.get(shard.logicalLedgerId)
      if (!logical) continue
      canonicalIdByRawId.set(shard.folderId, logical.id)
      if (shard.remoteFolderId && logicalIdsByRemoteFolderId.get(shard.remoteFolderId)?.size === 1) {
        const remote = snapshot.folders.find((folder) => folder.kind === 'bilibili' && folder.remoteFolderId === shard.remoteFolderId)
        if (remote) canonicalIdByRawId.set(remote.id, logical.id)
      }
    }
    const folders = snapshot.folders.filter((folder) => canonicalIdByRawId.get(folder.id) === folder.id)
    const foldersByTitle = new Map<string, typeof folders>()
    for (const folder of folders) {
      const title = folder.title.trim()
      foldersByTitle.set(title, [...(foldersByTitle.get(title) ?? []), folder])
    }
    const titleConflicts = [...foldersByTitle.entries()]
      .filter(([title, matches]) => title && matches.length > 1)
      .map(([title, matches]) => ({ title, folderIds: matches.map((folder) => folder.id).sort() }))
    const bindingConflicts = [...logicalIdsByRemoteFolderId.entries()]
      .filter(([, logicalIds]) => logicalIds.size > 1)
      .map(([remoteFolderId, logicalIds]) => ({
        title: snapshot.folders.find((folder) => folder.kind === 'bilibili' && folder.remoteFolderId === remoteFolderId)?.title ?? remoteFolderId,
        folderIds: [...logicalIds].map((logicalId) => `bilimi-logical:${logicalId}`).sort()
      }))
    const folderConflicts = [...titleConflicts, ...bindingConflicts]
      .sort((left, right) => left.title.localeCompare(right.title) || left.folderIds.join().localeCompare(right.folderIds.join()))
    const folderIdsByAid = new Map<number, Set<string>>()
    const aidsByCanonicalFolderId = new Map<string, Set<number>>()
    for (const [folderId, aids] of Object.entries(snapshot.memberships)) {
      const canonicalFolderId = canonicalIdByRawId.get(folderId) ?? folderId
      const canonicalAids = aidsByCanonicalFolderId.get(canonicalFolderId) ?? new Set<number>()
      const validAids = aids.filter((aid) => Boolean(snapshot.videos[String(aid)]))
      for (const aid of validAids) canonicalAids.add(aid)
      aidsByCanonicalFolderId.set(canonicalFolderId, canonicalAids)
      for (const aid of validAids) {
        const folderIds = folderIdsByAid.get(aid) ?? new Set<string>()
        folderIds.add(canonicalFolderId)
        folderIdsByAid.set(aid, folderIds)
      }
    }
    return {
      revision: snapshot.revision,
      folders,
      folderConflicts,
      allAids: Object.keys(snapshot.videos).map(Number).filter(Number.isSafeInteger).sort((left, right) => left - right),
      folderAidsByFolderId: new Map([...aidsByCanonicalFolderId].map(([id, aids]) => [id, [...aids].sort((left, right) => left - right)])),
      folderIdsByAid: new Map([...folderIdsByAid].map(([aid, ids]) => [aid, [...ids].sort((left, right) => left.localeCompare(right))])),
      pendingStatesByAid: this.pendingStatesByAid(snapshot)
    }
  }

  private pendingStatesByAid(snapshot: AccountFavoriteRepositorySnapshot) {
    const statesByAid = new Map<number, Set<FavoriteRepositoryLibraryPageRow['pendingStates'][number]>>()
    const addState = (aid: number, state: FavoriteRepositoryLibraryPageRow['pendingStates'][number]) => {
      if (!Number.isSafeInteger(aid) || aid <= 0) return
      const states = statesByAid.get(aid) ?? new Set<FavoriteRepositoryLibraryPageRow['pendingStates'][number]>()
      states.add(state)
      statesByAid.set(aid, states)
    }
    const protectedAids = new Set(snapshot.organizationRecords.map((record) => record.aid))
    for (const aid of protectedAids) addState(aid, 'protected')
    for (const aid of snapshot.workspace?.continuationAids ?? []) addState(aid, 'continuation')
    for (const record of snapshot.syncRecords) {
      const state = record.status === 'pending' ? 'unsynced'
        : record.status === 'failed' || record.status === 'result-unknown' ? record.status : undefined
      if (state) for (const aid of record.affectedAids) {
        addState(aid, state)
      }
    }
    for (const position of Object.values(snapshot.positions ?? {})) {
      if (position.positionState === 'failed') addState(position.aid, 'failed')
      if (position.positionState === 'result-unknown') addState(position.aid, 'result-unknown')
      if (position.positionState === 'local-only-change') addState(position.aid, 'unsynced')
    }
    for (const item of this.options.getTranscriptionItems?.() ?? []) {
      if (item.accountMid !== snapshot.accountMid || !['pending', 'running', 'failed'].includes(item.status)) continue
      addState(Number(item.aid), 'transcription')
    }
    return statesByAid
  }

  /** Protected and transcription states are displayed separately; neither requires library work. */
  private actionablePendingAids(snapshot: AccountFavoriteRepositorySnapshot) {
    return [...this.pendingStatesByAid(snapshot)]
      .filter(([aid, states]) => Boolean(snapshot.videos[String(aid)]) &&
        ['unsynced', 'continuation', 'failed', 'result-unknown'].some((state) => states.has(state as FavoriteRepositoryLibraryPageRow['pendingStates'][number])))
      .map(([aid]) => aid)
      .sort((left, right) => left - right)
  }

  private mirrorSummary(record: AccountFavoriteRepositorySnapshot['libraryMirrors'][string] | undefined): FavoriteRepositoryLibraryDetail['mirror'] {
    if (!record || record.status === 'never') return { status: '未同步' }
    if (record.status === 'synced') return { status: '已同步', ...(record.lastSyncedAt ? { lastSyncedAt: record.lastSyncedAt } : {}) }
    if (record.status === 'failed') return { status: '同步失败', ...(record.lastSyncedAt ? { lastSyncedAt: record.lastSyncedAt } : {}) }
    return { status: '同步中', ...(record.lastSyncedAt ? { lastSyncedAt: record.lastSyncedAt } : {}) }
  }

  private libraryAids(
    snapshot: AccountFavoriteRepositorySnapshot,
    scope: FavoriteRepositoryLibraryPageScope,
    index: FavoriteRepositoryLibraryIndex
  ) {
    if (scope.kind === 'folder') {
      return index.folderAidsByFolderId.get(scope.folderId) ?? []
    }
    if (scope.kind === 'pending') {
      return this.actionablePendingAids(snapshot)
    }
    if (scope.kind === 'protected' || scope.kind === 'unsynced') {
      return [...index.pendingStatesByAid]
        .filter(([aid, states]) => Boolean(snapshot.videos[String(aid)]) && states.has(scope.kind))
        .map(([aid]) => aid).sort((left, right) => left - right)
    }
    return index.allAids
  }

  private duplicateSyncResult(
    snapshot: AccountFavoriteRepositorySnapshot,
    command: Extract<FavoriteRepositoryCommand, { type: 'record-sync-result' }>
  ): FavoriteRepositoryCommandResult {
    return {
      ...clone(snapshot),
      commandId: command.id,
      affectedFolderIds: [],
      affectedAids: [...command.payload.affectedAids]
    }
  }

  private positionSummary(position: AccountFavoriteRepositorySnapshot['positions'][string]) {
    return {
      state: position.positionState,
      localDesiredFolderIds: [...position.localDesiredFolderIds],
      remoteObservedPhysicalFolderIds: [...position.remoteObservedPhysicalFolderIds],
      remoteObservedLogicalFolderIds: [...position.remoteObservedLogicalFolderIds],
      ...(position.observedAt ? { observedAt: position.observedAt } : {}),
      updatedAt: position.updatedAt,
      ...(position.reason ? { reason: position.reason } : {})
    }
  }

  private resultFromReceipt(
    snapshot: AccountFavoriteRepositorySnapshot,
    receipt: FavoriteRepositoryCommandReceipt
  ): FavoriteRepositoryCommandResult {
    return {
      ...clone(snapshot),
      commandId: receipt.commandId,
      affectedFolderIds: [...receipt.affectedFolderIds],
      affectedAids: [...receipt.affectedAids]
    }
  }

  private async load(accountMid: string): Promise<CachedRepository> {
    const cached = this.cache.get(accountMid)
    if (cached) return cached
    const manifestPath = this.manifestPath(accountMid)
    const primary = await this.readManifest(manifestPath, accountMid)
    const temporary = primary ? null : await this.readManifest(`${manifestPath}.tmp`, accountMid)
    const manifest = primary ?? temporary
    if (temporary) await rename(`${manifestPath}.tmp`, manifestPath)

    const active = manifest ? await this.readGeneration(accountMid, manifest) : null
    const previous = !active && manifest?.previousGeneration
      ? await this.readGenerationManifest(accountMid, manifest.previousGeneration)
      : null
    if (previous) await this.atomicWrite(manifestPath, JSON.stringify(previous.manifest))

    const loaded = active ?? previous
    let repository = loaded?.repository ?? {
      version: 1 as const,
      accountMid,
      snapshot: createAccountFavoriteRepositorySnapshot({ accountMid, now: this.now() }),
      commandResults: {}
    }
    for (const entry of await this.readSyncJournal(accountMid)) {
      if (repository.commandResults[entry.command.id] || repository.syncCommandIds?.includes(entry.command.id)) continue
      const result = applyFavoriteRepositoryCommand(repository.snapshot, entry.command, entry.acceptedAt)
      repository = {
        ...repository,
        snapshot: this.snapshotFromResult(result),
        commandResults: entry.command.type === 'record-sync-result'
          ? repository.commandResults
          : { ...repository.commandResults, [entry.command.id]: receiptFromResult(result, entry.command) },
        ...(entry.command.type === 'record-sync-result'
          ? { syncCommandIds: [...new Set([...(repository.syncCommandIds ?? []), entry.command.id])] }
          : {})
      }
    }
    for (const entry of await this.readBindingJournal(accountMid)) {
      if (repository.commandResults[entry.command.id]) continue
      const result = applyFavoriteRepositoryCommand(repository.snapshot, entry.command, entry.acceptedAt)
      repository = {
        ...repository,
        snapshot: this.snapshotFromResult(result),
        commandResults: { ...repository.commandResults, [entry.command.id]: receiptFromResult(result, entry.command) }
      }
    }
    for (const entry of await this.readEventJournal(accountMid)) {
      if (repository.commandResults[entry.command.id]) continue
      const result = applyFavoriteRepositoryCommand(repository.snapshot, entry.command, entry.acceptedAt)
      repository = {
        ...repository,
        snapshot: this.snapshotFromResult(result),
        commandResults: { ...repository.commandResults, [entry.command.id]: receiptFromResult(result, entry.command) }
      }
      const events = entry.command.type === 'record-favorite-event' ? [entry.command.payload] : entry.command.payload.events
      for (const event of events) await this.appendEventOnce(accountMid, { ...event, accountMid })
    }
    const result = { repository, manifest: loaded?.manifest }
    this.cache.set(accountMid, result)
    await this.cleanupTemporaryGenerations(accountMid)
    if (loaded) await this.cleanupLegacyRecords(accountMid)
    return result
  }

  private async readManifest(path: string, accountMid: string): Promise<RepositoryManifest | null> {
    try {
      const value = JSON.parse(await readFile(path, 'utf8')) as unknown
      return validManifest(value, accountMid) ? value : null
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null
      throw error
    }
  }

  private async readGeneration(accountMid: string, manifest: RepositoryManifest): Promise<CachedRepository | null> {
    const directory = this.generationDirectory(accountMid, manifest.generation)
    const [storedManifest, repositoryContent, videos, memberships] = await Promise.all([
      this.readManifest(join(directory, 'manifest.json'), accountMid),
      this.readText(join(directory, 'repository.json')),
      this.readText(join(directory, 'videos.jsonl')),
      this.readText(join(directory, 'memberships.jsonl'))
    ])
    if (!storedManifest || !repositoryContent || videos === null || memberships === null ||
      storedManifest.generation !== manifest.generation ||
      JSON.stringify(storedManifest) !== JSON.stringify(manifest) ||
      checksum(repositoryContent) !== manifest.checksums.repository ||
      checksum(videos) !== manifest.checksums.videos ||
      checksum(memberships) !== manifest.checksums.memberships) return null

    try {
      const repository = JSON.parse(repositoryContent) as unknown
      return validPersisted(repository, accountMid)
        ? { repository: {
          ...repository,
          snapshot: normalizeSnapshot(repository.snapshot),
          commandResults: normalizeCommandReceipts(repository.commandResults as Record<string, unknown>)
        }, manifest }
        : null
    } catch (error) {
      if (error instanceof SyntaxError) return null
      throw error
    }
  }

  private async readGenerationManifest(accountMid: string, generation: string): Promise<CachedRepository | null> {
    const manifest = await this.readManifest(join(this.generationDirectory(accountMid, generation), 'manifest.json'), accountMid)
    return manifest ? this.readGeneration(accountMid, manifest) : null
  }

  private async readText(path: string): Promise<string | null> {
    try {
      return await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private async persist(accountMid: string, repository: PersistedRepository, previousGeneration?: string): Promise<CachedRepository> {
    const directory = this.accountDirectory(accountMid)
    await mkdir(directory, { recursive: true })
    const generation = randomUUID()
    const persisted = { ...repository, generation }
    const contents = {
      repository: JSON.stringify(persisted),
      videos: this.encodeVideos(persisted.snapshot),
      memberships: this.encodeMemberships(persisted.snapshot)
    }
    const manifest: RepositoryManifest = {
      version: 1,
      accountMid,
      generation,
      ...(previousGeneration ? { previousGeneration } : {}),
      checksums: {
        repository: checksum(contents.repository),
        videos: checksum(contents.videos),
        memberships: checksum(contents.memberships)
      }
    }
    const temporaryDirectory = `${this.generationDirectory(accountMid, generation)}.tmp`
    const generationDirectory = this.generationDirectory(accountMid, generation)
    await rm(temporaryDirectory, { recursive: true, force: true })
    await mkdir(temporaryDirectory, { recursive: true })
    await Promise.all([
      writeFile(join(temporaryDirectory, 'repository.json'), contents.repository, 'utf8'),
      writeFile(join(temporaryDirectory, 'videos.jsonl'), contents.videos, 'utf8'),
      writeFile(join(temporaryDirectory, 'memberships.jsonl'), contents.memberships, 'utf8'),
      writeFile(join(temporaryDirectory, 'manifest.json'), JSON.stringify(manifest), 'utf8')
    ])
    await rename(temporaryDirectory, generationDirectory)
    await this.atomicWrite(this.manifestPath(accountMid), JSON.stringify(manifest))
    await this.cleanupLegacyRecords(accountMid)
    await this.cleanupRepositoryGenerations(accountMid, new Set([generation, previousGeneration].filter(Boolean) as string[]))
    return { repository: persisted, manifest }
  }

  private encodeVideos(snapshot: AccountFavoriteRepositorySnapshot) {
    return Object.values(snapshot.videos)
      .sort((left, right) => left.aid - right.aid)
      .map((video) => JSON.stringify(video)).join('\n') + (Object.keys(snapshot.videos).length ? '\n' : '')
  }

  private encodeMemberships(snapshot: AccountFavoriteRepositorySnapshot) {
    const entries = Object.entries(snapshot.memberships).sort(([left], [right]) => left.localeCompare(right))
    return entries.map(([folderId, aids]) => JSON.stringify({ folderId, aids })).join('\n') + (entries.length ? '\n' : '')
  }

  private async atomicWrite(path: string, content: string) {
    const temporaryPath = `${path}.tmp`
    await mkdir(dirname(path), { recursive: true })
    await writeFile(temporaryPath, content, 'utf8')
    await rename(temporaryPath, path)
  }

  private async appendSyncJournal(accountMid: string, entry: SyncJournalEntry) {
    const path = this.syncJournalPath(accountMid)
    await mkdir(dirname(path), { recursive: true })
    await appendFile(path, `${JSON.stringify(entry)}\n`, 'utf8')
  }

  private async appendSyncCheckpoint(accountMid: string, entry: SyncCheckpointJournalEntry) {
    const path = this.syncCheckpointJournalPath(accountMid)
    await mkdir(dirname(path), { recursive: true })
    await appendFile(path, `${JSON.stringify(entry)}\n`, 'utf8')
  }

  private async appendBindingJournal(accountMid: string, entry: BindingJournalEntry) {
    const path = this.bindingJournalPath(accountMid)
    await mkdir(dirname(path), { recursive: true })
    await appendFile(path, `${JSON.stringify(entry)}\n`, 'utf8')
  }

  private async appendEventJournal(accountMid: string, entry: EventJournalEntry) {
    const path = this.eventJournalPath(accountMid)
    await mkdir(dirname(path), { recursive: true })
    await appendFile(path, `${JSON.stringify(entry)}\n`, 'utf8')
  }

  private async appendEvent(accountMid: string, event: FavoriteRepositoryEvent) {
    const path = this.eventPath(accountMid, event.aid)
    await mkdir(dirname(path), { recursive: true })
    await appendFile(path, `${JSON.stringify(event)}\n`, 'utf8')
  }

  private async appendEventOnce(accountMid: string, event: FavoriteRepositoryEvent) {
    const events = await this.readEvents(accountMid, event.aid)
    if (events.some((candidate) => candidate.id === event.id)) return
    await this.appendEvent(accountMid, event)
  }

  private async readEvents(accountMid: string, aid: number): Promise<FavoriteRepositoryEvent[]> {
    try {
      const byId = new Map<string, FavoriteRepositoryEvent>()
      for (const line of (await readFile(this.eventPath(accountMid, aid), 'utf8')).split('\n').filter(Boolean)) {
        try {
          const event = JSON.parse(line) as FavoriteRepositoryEvent
          if (event.accountMid === accountMid && event.aid === aid && Number.isSafeInteger(event.sequence) && event.sequence > 0 && event.id) byId.set(event.id, event)
        } catch { break }
      }
      return [...byId.values()].sort((left, right) => right.sequence - left.sequence || right.id.localeCompare(left.id))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  private async readEventJournal(accountMid: string): Promise<EventJournalEntry[]> {
    try {
      const entries: EventJournalEntry[] = []
      for (const line of (await readFile(this.eventJournalPath(accountMid), 'utf8')).split('\n').filter(Boolean)) {
        try {
          const entry = JSON.parse(line) as Partial<EventJournalEntry>
          if (!entry.command || (entry.command.type !== 'record-favorite-event' && entry.command.type !== 'record-favorite-events') || typeof entry.acceptedAt !== 'string') break
          entries.push(entry as EventJournalEntry)
        } catch {
          break
        }
      }
      return entries
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  private async loadSyncCheckpointState(accountMid: string): Promise<SyncCheckpointState> {
    const cached = this.syncCheckpointState.get(accountMid)
    if (cached) return cached
    const state: SyncCheckpointState = { commandIds: new Set(), records: new Map() }
    try {
      const lines = (await readFile(this.syncCheckpointJournalPath(accountMid), 'utf8')).split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as Partial<SyncCheckpointJournalEntry>
          if (typeof entry.commandId !== 'string' || !entry.commandId || !entry.record || typeof entry.record !== 'object') break
          state.commandIds.add(entry.commandId)
          state.records.set(entry.record.id, entry.record)
        } catch {
          break
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    this.syncCheckpointState.set(accountMid, state)
    return state
  }

  private mergeSyncCheckpoints(repository: PersistedRepository, checkpoints: SyncCheckpointState): PersistedRepository {
    if (!checkpoints.records.size) return repository
    const syncRecords = new Map(repository.snapshot.syncRecords.map((record) => [record.id, record]))
    for (const [id, record] of checkpoints.records) syncRecords.set(id, record)
    return {
      ...repository,
      snapshot: { ...repository.snapshot, syncRecords: Array.from(syncRecords.values()) }
    }
  }

  private async readSyncJournal(accountMid: string): Promise<SyncJournalEntry[]> {
    try {
      const entries: SyncJournalEntry[] = []
      const lines = (await readFile(this.syncJournalPath(accountMid), 'utf8')).split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as Partial<SyncJournalEntry>
          if (!entry.command || typeof entry.acceptedAt !== 'string') break
          entries.push(entry as SyncJournalEntry)
        } catch {
          break
        }
      }
      return entries
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  private async readBindingJournal(accountMid: string): Promise<BindingJournalEntry[]> {
    try {
      const entries: BindingJournalEntry[] = []
      const lines = (await readFile(this.bindingJournalPath(accountMid), 'utf8')).split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as Partial<BindingJournalEntry>
          if (!entry.command || entry.command.type !== 'upsert-physical-shard-binding' || typeof entry.acceptedAt !== 'string') break
          entries.push(entry as BindingJournalEntry)
        } catch {
          break
        }
      }
      return entries
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  private accountDirectory(accountMid: string) {
    return join(this.options.root, 'accounts', accountMid)
  }

  private manifestPath(accountMid: string) {
    return join(this.accountDirectory(accountMid), 'repository.manifest.json')
  }

  private syncJournalPath(accountMid: string) {
    return join(this.accountDirectory(accountMid), 'sync-checkpoints.jsonl')
  }

  private syncCheckpointJournalPath(accountMid: string) {
    return join(this.accountDirectory(accountMid), 'sync-checkpoints-v2.jsonl')
  }

  private bindingJournalPath(accountMid: string) {
    return join(this.accountDirectory(accountMid), 'physical-shard-bindings.jsonl')
  }

  private eventPath(accountMid: string, aid: number) {
    return join(this.accountDirectory(accountMid), 'events', `${aid}.jsonl`)
  }

  private eventJournalPath(accountMid: string) {
    return join(this.accountDirectory(accountMid), 'event-commands.jsonl')
  }

  private generationDirectory(accountMid: string, generation: string) {
    return join(this.accountDirectory(accountMid), 'generations', generation)
  }

  private async cleanupTemporaryGenerations(accountMid: string) {
    const generations = join(this.accountDirectory(accountMid), 'generations')
    try {
      const entries = await readdir(generations, { withFileTypes: true })
      await Promise.all(entries.filter((entry) => entry.isDirectory() && entry.name.endsWith('.tmp'))
        .map((entry) => rm(join(generations, entry.name), { recursive: true, force: true })))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  private async cleanupRepositoryGenerations(accountMid: string, retained: Set<string>) {
    const generations = join(this.accountDirectory(accountMid), 'generations')
    try {
      const entries = await readdir(generations, { withFileTypes: true })
      // Bound cleanup work so upgrading a repository with hundreds of old generations does not stall one commit.
      await Promise.all(entries.filter((entry) => entry.isDirectory() && !entry.name.endsWith('.tmp') && !retained.has(entry.name)).slice(0, 8)
        .map((entry) => rm(join(generations, entry.name), { recursive: true, force: true })))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  private async cleanupLegacyRecords(accountMid: string) {
    const directory = this.accountDirectory(accountMid)
    await Promise.all([
      'repository.json', 'repository.json.tmp', 'videos.jsonl', 'videos.jsonl.tmp', 'memberships.jsonl', 'memberships.jsonl.tmp'
    ].map((file) => rm(join(directory, file), { force: true })))
  }

  private queue<T>(operation: () => Promise<T>) {
    const run = this.writeTail.then(operation, operation)
    this.writeTail = run.then(() => undefined, () => undefined)
    return run
  }
}
