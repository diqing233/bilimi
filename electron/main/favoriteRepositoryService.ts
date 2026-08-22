import { createHash, randomUUID } from 'node:crypto'
import { appendFile, cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  applyFavoriteRepositoryCommand,
  createAccountFavoriteRepositorySnapshot,
  createFavoriteRepositoryPositionKey,
  deriveFavoriteRepositoryClassificationSource,
  deriveFavoriteRepositoryPositionState,
  isFavoriteRepositoryRecycled,
  mergeFavoriteRepositoryVideo,
  validateFavoriteRepositoryArchiveExport,
  type AccountFavoriteRepositorySnapshot,
  type FavoriteRepositoryArchiveExport,
  type FavoriteRepositoryCommand,
  type FavoriteRepositoryCommandResult,
  type FavoriteRepositoryConfirmedReviewInput,
  type FavoriteRepositoryInitialSourceFilter,
  type FavoriteRepositoryClassificationSource,
  type FavoriteRepositoryClassificationAdjustment,
  type FavoriteRepositoryEvent,
  type FavoriteRepositoryOrganizationRecord,
  type FavoriteRepositoryPage,
  type FavoriteRepositoryPositionRecord,
  type FavoriteRepositorySyncRecord,
  type FavoriteRepositoryVideo
} from '../../src/shared/favoriteRepository'
import type { VideoAudioTranscriptionQueueItem, VideoNoteArchiveEntry } from '../../src/shared/types'

type PersistedRepository = {
  version: 1
  accountMid: string
  snapshot: AccountFavoriteRepositorySnapshot
  commandResults: Record<string, FavoriteRepositoryCommandReceipt>
  /** Archive events are published with the repository generation, never appended after its receipt. */
  importedEvents?: FavoriteRepositoryEvent[]
  /** Fingerprints the complete trusted review input, including its audit event. */
  reviewOperationFingerprints?: Record<string, string>
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
  libraryQueryCache?: {
    repositoryRevision: number
    entries: Map<string, readonly number[]>
  }
  pendingStateCache?: {
    repositoryRevision: number
    transcriptionRevision: number
    statesByAid: Map<number, Set<FavoriteRepositoryLibraryPageRow['pendingStates'][number]>>
  }
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
  physicalShards: import('../../src/shared/favoriteRepository').FavoriteRepositoryPhysicalShard[]
  folderConflicts: Array<{ title: string; folderIds: string[]; reason: string; candidates: Array<{ id: string; title: string }> }>
  allAids: number[]
  recycledAids: number[]
  folderAidsByFolderId: Map<string, number[]>
  folderIdsByAid: Map<number, string[]>
  pendingStatesByAid: Map<number, Set<FavoriteRepositoryLibraryPageRow['pendingStates'][number]>>
  protectedAids: Set<number>
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

type PortableImportTransaction = {
  version: 1
  phase: 'pending' | 'recovered'
  accounts: Array<{ accountMid: string; existed: boolean }>
  recoveryState?: unknown
}

export type PortableImportTransactionRecovery = {
  recoveryState?: unknown
}

type BindingJournalEntry = {
  command: Extract<FavoriteRepositoryCommand, { type: 'upsert-physical-shard-binding' }>
  acceptedAt: string
}

type EventJournalEntry = {
  command: Extract<FavoriteRepositoryCommand, { type: 'record-favorite-event' | 'record-favorite-events' }>
  acceptedAt: string
}

/**
 * This journal starts before the confirmed-review generation.  It deliberately
 * lives outside the repository generation: if the process stops after Bilibili
 * confirms the write but before the local generation is published, the next
 * account open still has the exact local-only work to finish.
 */
type ConfirmedReviewJournalEntry = {
  input: FavoriteRepositoryConfirmedReviewInput
  fingerprint: string
  checkpointedAt: string
}

type ConfirmedReviewJournal = {
  version: 1
  accountMid: string
  entries: ConfirmedReviewJournalEntry[]
}

export type FavoriteRepositoryLibraryFilter = 'all' | 'pending' | 'protected' | 'unsynced'
/** Filters by the observed source folders without exposing the full membership index to the renderer. */
export type FavoriteRepositoryLibrarySourceFilter = 'with-other' | 'bilimi-only'
export type FavoriteRepositoryLibraryInitialSourceFilter = FavoriteRepositoryInitialSourceFilter
export type FavoriteRepositoryLibraryStateFilters = {
  sync?: FavoriteRepositoryLibraryStates['sync']
  protection?: FavoriteRepositoryLibraryStates['protection']
  organization?: FavoriteRepositoryLibraryStates['organization']
}
export type FavoriteRepositoryLibrarySort = 'updated-desc' | 'updated-asc' | 'title-asc' | 'title-desc'
export type FavoriteRepositoryTranscriptionFilter = 'completed' | 'none' | 'pending' | 'running' | 'failed'
export type FavoriteRepositoryLibrarySyncState =
  | 'synced'
  | 'unsynced'
export type FavoriteRepositoryLibraryStates = {
  sync: FavoriteRepositoryLibrarySyncState
  protection: 'protected' | 'unprotected'
  organization: 'organized' | 'unorganized'
}

type FolderPageOptions = {
  limit: number
  cursor?: string
}

export type FavoriteRepositoryLibraryPageOptions = FolderPageOptions & {
  page?: number
  query?: string
  filter?: FavoriteRepositoryLibraryFilter
  sourceFilter?: FavoriteRepositoryLibrarySourceFilter
  initialSourceFilter?: FavoriteRepositoryLibraryInitialSourceFilter
  stateFilters?: FavoriteRepositoryLibraryStateFilters
  sort?: FavoriteRepositoryLibrarySort
  transcriptionFilters?: FavoriteRepositoryTranscriptionFilter[]
  classificationSources?: FavoriteRepositoryClassificationSource[]
  physicalShard?: { logicalLedgerId: string; shardNumber: number }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function checksum(content: string) {
  return createHash('sha256').update(content).digest('hex')
}

function commandFingerprint(command: FavoriteRepositoryCommand) {
  // Timestamps and optimistic revisions vary across retries but do not change
  // the business command represented by a durable command ID.
  const { issuedAt: _issuedAt, expectedRevision: _expectedRevision, ...stableCommand } = command
  return checksum(stableJson(stableCommand))
}

function legacyCommandFingerprint(command: FavoriteRepositoryCommand, expectedRevision: number) {
  const { issuedAt: _issuedAt, ...stableCommand } = { ...command, expectedRevision }
  return checksum(stableJson(stableCommand))
}

function matchesCommandReceiptFingerprint(receipt: FavoriteRepositoryCommandReceipt, command: FavoriteRepositoryCommand) {
  if (!receipt.commandFingerprint) return true
  if (receipt.commandFingerprint === commandFingerprint(command)) return true
  // Reconcile receipts written before expectedRevision became retry metadata.
  return receipt.commandFingerprint === legacyCommandFingerprint(command, receipt.acceptedRevision - 1)
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function normalizeConfirmedReviewInput(input: FavoriteRepositoryConfirmedReviewInput): FavoriteRepositoryConfirmedReviewInput {
  const operationId = typeof input.operationId === 'string' ? input.operationId.trim() : ''
  const occurredAt = typeof input.occurredAt === 'string' ? input.occurredAt.trim() : ''
  const aid = Number(input.aid)
  if (!operationId || !occurredAt || Number.isNaN(Date.parse(occurredAt)) || !Number.isSafeInteger(aid) || aid <= 0) {
    throw new Error('Confirmed review favorite input is invalid.')
  }
  if (!Array.isArray(input.targets) || !input.targets.length || input.targets.length > 3 ||
    !['system-high', 'system-low', 'deepseek', 'manual'].includes(input.classificationSource)) {
    throw new Error('Confirmed review favorite targets are invalid.')
  }
  if (!input.event || (input.event.kind !== 'entered' && input.event.kind !== 'daily-review') ||
    (input.event.titleAtTime !== undefined && typeof input.event.titleAtTime !== 'string') ||
    (input.event.detail !== undefined && typeof input.event.detail !== 'string') ||
    (input.event.folderTitlesAtTime !== undefined && (!Array.isArray(input.event.folderTitlesAtTime) ||
      input.event.folderTitlesAtTime.some((title) => typeof title !== 'string')))) {
    throw new Error('Confirmed review favorite event is invalid.')
  }
  const targets = input.targets.map((target) => ({
    logicalFolderId: typeof target?.logicalFolderId === 'string' ? target.logicalFolderId.trim() : '',
    remoteFolderId: typeof target?.remoteFolderId === 'string' ? target.remoteFolderId.trim() : '',
    ...(typeof target?.title === 'string' && target.title.trim() ? { title: target.title.trim() } : {})
  }))
  if (targets.some((target) => !target.logicalFolderId || !target.remoteFolderId || !/^bilimi-logical:\S+$/u.test(target.logicalFolderId)) ||
    new Set(targets.map((target) => target.logicalFolderId)).size !== targets.length ||
    new Set(targets.map((target) => target.remoteFolderId)).size !== targets.length) {
    throw new Error('Confirmed review favorite targets are invalid.')
  }
  const video = input.video
    ? {
        ...input.video,
        aid: Number(input.video.aid),
        title: typeof input.video.title === 'string' ? input.video.title.trim() : '',
        tags: Array.isArray(input.video.tags) ? input.video.tags.map((tag) => typeof tag === 'string' ? tag.trim() : tag) : input.video.tags,
        updatedAt: typeof input.video.updatedAt === 'string' ? input.video.updatedAt.trim() : ''
      }
    : undefined
  if (video && (video.aid !== aid || !video.title || !Array.isArray(video.tags) || video.tags.some((tag) => typeof tag !== 'string') ||
    !video.updatedAt || Number.isNaN(Date.parse(video.updatedAt)))) {
    throw new Error('Confirmed review favorite video is invalid.')
  }
  return {
    operationId,
    occurredAt,
    aid,
    ...(video ? { video: { ...video, tags: [...video.tags] } } : {}),
    targets,
    classificationSource: input.classificationSource,
    event: {
      kind: input.event.kind,
      ...(input.event.titleAtTime?.trim() ? { titleAtTime: input.event.titleAtTime.trim() } : {}),
      ...(input.event.folderTitlesAtTime?.map((title) => title.trim()).filter(Boolean).length
        ? { folderTitlesAtTime: input.event.folderTitlesAtTime.map((title) => title.trim()).filter(Boolean) }
        : {}),
      ...(input.event.detail?.trim() ? { detail: input.event.detail.trim() } : {})
    }
  }
}

function confirmedReviewEvent(input: FavoriteRepositoryConfirmedReviewInput): Omit<FavoriteRepositoryEvent, 'accountMid'> {
  return {
    id: `${input.operationId}:event`,
    sequence: Math.max(1, Date.parse(input.occurredAt)),
    aid: input.aid,
    kind: input.event.kind,
    occurredAt: input.occurredAt,
    ...(input.event.titleAtTime ? { titleAtTime: input.event.titleAtTime } : {}),
    ...(input.event.folderTitlesAtTime?.length ? { folderTitlesAtTime: [...input.event.folderTitlesAtTime] } : {}),
    ...(input.event.detail ? { detail: input.event.detail } : {})
  }
}

function confirmedReviewInputFingerprint(input: FavoriteRepositoryConfirmedReviewInput) {
  return checksum(stableJson({
    aid: input.aid,
    occurredAt: input.occurredAt,
    ...(input.video ? { video: { ...input.video, tags: [...input.video.tags] } } : {}),
    targets: input.targets.map((target) => ({ ...target })),
    classificationSource: input.classificationSource,
    event: confirmedReviewEvent(input)
  }))
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
    (snapshot.classificationAdjustments === undefined || Array.isArray(snapshot.classificationAdjustments)) &&
    (snapshot.organizationMigrationInitialized === undefined || typeof snapshot.organizationMigrationInitialized === 'boolean')
}

export type FavoriteRepositoryLibraryPageScope =
  | { kind: 'all' }
  | { kind: 'folder'; folderId: string }
  | { kind: 'pending' }
  | { kind: 'protected' }
  | { kind: 'unsynced' }
  | { kind: 'recycle' }

export type FavoriteRepositoryLibraryPageRow = {
  video: FavoriteRepositoryVideo
  folderIds: string[]
  pendingStates: Array<'protected' | 'unsynced' | 'continuation' | 'failed' | 'result-unknown' | 'transcription'>
  libraryStates: FavoriteRepositoryLibraryStates
  organization?: Pick<FavoriteRepositoryOrganizationRecord, 'classificationSource' | 'completedAt'>
}

export type FavoriteRepositoryLibraryDetail = {
  version: 1
  accountMid: string
  revision: number
  video: FavoriteRepositoryVideo
  folderIds: string[]
  pendingStates: FavoriteRepositoryLibraryPageRow['pendingStates']
  libraryStates: FavoriteRepositoryLibraryStates
  /** A successful Bilibili write receipt. It is not a replacement for a remote readback. */
  syncReceipt?: {
    confirmedAt: string
    targetLogicalFolderIds: string[]
    targetTitles: string[]
  }
  protected: boolean
  organization?: Pick<FavoriteRepositoryOrganizationRecord, 'classificationSource' | 'completedAt'>
  latestClassificationAdjustment?: FavoriteRepositoryClassificationAdjustment
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
    status: '未同步' | '已同步'
    lastSyncedAt?: string
    lastCheckedAt?: string
    errorCode?: 'network' | 'unavailable' | 'account-changed'
    remoteCode?: number
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
  physicalShards: Array<import('../../src/shared/favoriteRepository').FavoriteRepositoryPhysicalShard & { localMemberCount?: number }>
  folderCounts: Record<string, number>
  /** Distinct videos across valid Bilimi logical work folders, not a sum of folder counts. */
  workspaceVideoCount?: number
  /** Distinct videos across non-workspace, non-inbox favorite folders. */
  otherFavoriteVideoCount?: number
  scopeCounts: { all: number; pending: number; protected: number; unsynced: number; recycle?: number }
  folderConflicts?: Array<{ title: string; folderIds: string[]; reason: string; candidates: Array<{ id: string; title: string }> }>
  physicalShardCount: number
  syncRecordCount: number
  syncCounts: Record<'pending' | 'succeeded' | 'failed' | 'result-unknown', number>
  pendingAidCount: number
  remoteReconciliations: Array<{
    kind: 'unfavorite' | 'managed-folder' | 'managed-placement'
    operationId: string
  }>
  workspace?: {
    id: string
    status: NonNullable<AccountFavoriteRepositorySnapshot['workspace']>['status']
    baselineRevision: number
    continuationCount: number
  }
}

function normalizeSnapshot(snapshot: AccountFavoriteRepositorySnapshot): AccountFavoriteRepositorySnapshot {
  const formalBoundLogicalLedgerIds = new Set(
    [...new Set(snapshot.physicalShards.map((shard) => shard.logicalLedgerId))].filter((logicalLedgerId) => {
      const shards = snapshot.physicalShards.filter((shard) => shard.logicalLedgerId === logicalLedgerId)
      return shards.length > 0 && shards.every((shard) => shard.bindingState === 'bound' && Boolean(shard.remoteFolderId))
    })
  )
  return {
    ...snapshot,
    folders: snapshot.folders.map((folder) => {
      if (folder.kind !== 'bilimi-logical' || folder.syncState !== 'bound' || !folder.logicalLedgerId ||
        formalBoundLogicalLedgerIds.has(folder.logicalLedgerId)) return folder
      const { remoteFolderId: _staleRemoteFolderId, ...unboundFolder } = folder
      return { ...unboundFolder, syncState: 'pending-reconcile' as const }
    }),
    libraryMirrors: snapshot.libraryMirrors ?? {},
    organizationRecords: snapshot.organizationRecords ?? [],
    organizationBatches: snapshot.organizationBatches ?? [],
    classificationAdjustments: snapshot.classificationAdjustments ?? [],
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
      typeof (event as FavoriteRepositoryEvent).id === 'string' && !!(event as FavoriteRepositoryEvent).id))) &&
    (persisted.reviewOperationFingerprints === undefined ||
      (typeof persisted.reviewOperationFingerprints === 'object' && !Array.isArray(persisted.reviewOperationFingerprints) &&
        Object.values(persisted.reviewOperationFingerprints).every((fingerprint) => typeof fingerprint === 'string' && !!fingerprint)))
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
  private portableImportTransactionActive = false

  constructor(private readonly options: {
    root: string
    now?: () => string
    getTranscriptionRevision?: () => number
    getTranscriptionArchiveRevision?: () => number
    getTranscriptionItems?: () => readonly VideoAudioTranscriptionQueueItem[]
    getTranscriptionArchives?: () => readonly VideoNoteArchiveEntry[]
    /** Retained for callers with legacy dismissal data; ordinary folders are no longer suppressed. */
    isRemoteFolderDismissed?: (accountMid: string, remoteFolderId: string) => boolean
  }) {}

  async getSnapshot(accountMid: string): Promise<AccountFavoriteRepositorySnapshot> {
    const account = normalizeAccountMid(accountMid)
    return this.queue(async () => clone(this.mergeSyncCheckpoints(
      (await this.load(account)).repository,
      await this.loadSyncCheckpointState(account)
    ).snapshot))
  }

  /** Invalidates derived library views when durable renderer preferences change outside repository commands. */
  invalidateLibraryReadCache(accountMid: string) {
    const cached = this.cache.get(normalizeAccountMid(accountMid))
    if (!cached) return
    cached.libraryIndex = undefined
    cached.libraryQueryCache = undefined
  }

  async getLibrarySummary(accountMid: string, options?: {
    localDraftLedgerIds?: readonly string[]
  }): Promise<FavoriteRepositoryLibrarySummary> {
    const account = normalizeAccountMid(accountMid)
    const cached = await this.load(account)
    const snapshot = this.mergeSyncCheckpoints(cached.repository, await this.loadSyncCheckpointState(account)).snapshot
    const syncCounts: FavoriteRepositoryLibrarySummary['syncCounts'] = {
      pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0
    }
    for (const record of snapshot.syncRecords) {
      // A recovered portable operation has no trustworthy remote result, so retain
      // the established UI bucket while requiring an explicit reconciliation.
      syncCounts[record.status === 'reconciliation-required' ? 'result-unknown' : record.status]++
    }
    const pendingAidCount = this.actionablePendingAids(snapshot).length
    const index = this.libraryIndex(cached, snapshot)
    const localDraftLedgerIds = new Set((options?.localDraftLedgerIds ?? []).map((id) => id.trim()).filter(Boolean))
    const trustedRemoteFolderIdByLedger = new Map<string, string>()
    for (const shard of snapshot.physicalShards) {
      if (shard.bindingState !== 'bound' || !shard.remoteFolderId) continue
      const existing = trustedRemoteFolderIdByLedger.get(shard.logicalLedgerId)
      if (existing && existing !== shard.remoteFolderId) trustedRemoteFolderIdByLedger.set(shard.logicalLedgerId, '')
      else if (existing === undefined) trustedRemoteFolderIdByLedger.set(shard.logicalLedgerId, shard.remoteFolderId)
    }
    const hasLogicalInbox = index.folders.some((folder) => folder.id === 'bilimi-logical:inbox' && folder.kind === 'bilimi-logical')
    const stagingAids = new Set([
      ...(index.folderAidsByFolderId.get('local:inbox') ?? []),
      ...(index.folderAidsByFolderId.get('bilimi-logical:inbox') ?? [])
    ])
    const projectedFolders = index.folders
      .filter((folder) => !(hasLogicalInbox && folder.id === 'local:inbox'))
      .map((folder) => {
      if (folder.kind === 'bilimi-logical' && folder.logicalLedgerId) {
        const remoteFolderId = trustedRemoteFolderIdByLedger.get(folder.logicalLedgerId)
        return remoteFolderId ? { ...folder, remoteFolderId } : folder
      }
      if (folder.kind !== 'local' || folder.id === 'local:inbox') return folder
      const logicalLedgerId = folder.id.startsWith('local:') ? folder.id.slice('local:'.length) : ''
      const orphanedCustomDraft = logicalLedgerId.startsWith('custom-')
      return logicalLedgerId && (localDraftLedgerIds.has(logicalLedgerId) || orphanedCustomDraft)
        ? { ...folder, logicalLedgerId }
        : folder
      })
    const projectedFolderAids = (folderId: string) => folderId === 'bilimi-logical:inbox' && hasLogicalInbox
      ? [...stagingAids]
      : index.folderAidsByFolderId.get(folderId) ?? []
    const isWorkspaceFolder = (folder: typeof projectedFolders[number]) =>
      folder.kind === 'bilimi-logical' || (folder.kind === 'local' && Boolean(folder.logicalLedgerId))
    const workspaceVideoCount = new Set(
      projectedFolders
        .filter(isWorkspaceFolder)
        .flatMap((folder) => projectedFolderAids(folder.id))
    ).size
    const otherFavoriteVideoCount = new Set(
      projectedFolders
        .filter((folder) => !isWorkspaceFolder(folder) && folder.id !== 'local:inbox')
        .flatMap((folder) => projectedFolderAids(folder.id))
    ).size
    const stateCount = (state: FavoriteRepositoryLibraryPageRow['pendingStates'][number]) =>
      [...index.pendingStatesByAid].filter(([aid, states]) => Boolean(snapshot.videos[String(aid)]) && states.has(state)).length
    const localPhysicalShardMemberCount = (shard: AccountFavoriteRepositorySnapshot['physicalShards'][number]) => new Set(
      (snapshot.memberships[shard.folderId] ?? [])
        .filter((aid) => Boolean(snapshot.videos[String(aid)]) && !isFavoriteRepositoryRecycled(snapshot, aid))
    ).size
    return {
      version: 1,
      accountMid: snapshot.accountMid,
      revision: snapshot.revision,
      updatedAt: snapshot.updatedAt,
      videoCount: index.allAids.length,
      folderCount: projectedFolders.length,
      folders: projectedFolders.map((folder) => ({ ...folder })),
      physicalShards: snapshot.physicalShards.map((shard) => ({
        ...shard,
        knownRemoteFolderIds: shard.knownRemoteFolderIds ? [...shard.knownRemoteFolderIds] : undefined,
        localMemberCount: localPhysicalShardMemberCount(shard)
      })),
      folderCounts: Object.fromEntries(projectedFolders.map((folder) => [folder.id, projectedFolderAids(folder.id).length])),
      workspaceVideoCount,
      otherFavoriteVideoCount,
      scopeCounts: {
        all: index.allAids.length, pending: pendingAidCount, protected: stateCount('protected'),
        unsynced: stateCount('unsynced'), recycle: index.recycledAids.length
      },
      ...(index.folderConflicts.length ? { folderConflicts: index.folderConflicts.map((conflict) => ({
        title: conflict.title, folderIds: [...conflict.folderIds], reason: conflict.reason,
        candidates: conflict.candidates.map((candidate) => ({ ...candidate }))
      })) } : {}),
      physicalShardCount: snapshot.physicalShards.length,
      syncRecordCount: snapshot.syncRecords.length,
      syncCounts,
      pendingAidCount,
      remoteReconciliations: this.remoteReconciliations(snapshot),
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
    const commandId = `archive-import:${mode}:${archive.checksum.toLowerCase()}`
    this.pendingWriteCount++
    return this.queue(async () => {
      const cached = await this.load(account)
      const repository = mode === 'overwrite'
        ? cached.repository
        : this.mergeSyncCheckpoints(cached.repository, await this.loadSyncCheckpointState(account))
      const existing = repository.commandResults[commandId]
      if (existing) return this.resultFromReceipt(repository.snapshot, existing)

      // Stage the event projection in the same generation as the snapshot and
      // receipt. A failure while publishing that generation leaves no visible
      // snapshot/receipt/event state; unlike post-persist append, it cannot
      // produce a restored repository with a missing user history.
      const existingEventIds = new Set(mode === 'overwrite' ? [] : [
        ...(repository.importedEvents ?? []).map((event) => event.id),
        ...(await Promise.all([...new Set((archive.events ?? []).map((event) => event.aid))]
          .map(async (aid) => (await this.readEvents(account, aid)).map((event) => event.id)))).flat()
      ])
      const importedEvents = [
        ...(mode === 'overwrite' ? [] : repository.importedEvents ?? []),
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
      // An overwrite retains current-device observations only for positions
      // explicitly carried by the archive. Do not manufacture empty local
      // positions for unrelated stale entities.
      const importedPositionAids = new Set((archive.positions ?? []).map((position) => position.aid))
      const positions = mode === 'overwrite'
        ? Object.fromEntries(Object.entries(repository.snapshot.positions)
          .filter(([, position]) => importedPositionAids.has(position.aid))
          .map(([key, position]) => [key, {
            ...position, localDesiredFolderIds: [], remoteObservedPhysicalFolderIds: [...position.remoteObservedPhysicalFolderIds],
            remoteObservedLogicalFolderIds: [...position.remoteObservedLogicalFolderIds]
          }]))
        : { ...repository.snapshot.positions }
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
        const importedObservationIsCurrent = !previous || imported.updatedAt >= previous.updatedAt
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
          ...(importedObservationIsCurrent && imported.observedAt ? { observedAt: imported.observedAt } : previous?.observedAt ? { observedAt: previous.observedAt } : {}),
          ...(importedObservationIsCurrent && imported.lifecycleState ? { lifecycleState: imported.lifecycleState } : previous?.lifecycleState ? { lifecycleState: previous.lifecycleState } : {}),
          ...(importedObservationIsCurrent && imported.sourceAuthority ? { sourceAuthority: imported.sourceAuthority } : previous?.sourceAuthority ? { sourceAuthority: previous.sourceAuthority } : {}),
          ...(importedObservationIsCurrent && imported.observationEpoch ? { observationEpoch: imported.observationEpoch } : previous?.observationEpoch ? { observationEpoch: previous.observationEpoch } : {}),
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
      const adjustmentsById = new Map((mode === 'overwrite' ? [] : repository.snapshot.classificationAdjustments ?? [])
        .map((record) => [record.id, record]))
      for (const record of recovery?.classificationAdjustments ?? []) {
        const previous = adjustmentsById.get(record.id)
        if (!previous || record.occurredAt >= previous.occurredAt) adjustmentsById.set(record.id, clone(record))
      }
      const tombstones = mode === 'overwrite' ? {} : { ...repository.snapshot.tombstones }
      for (const tombstone of recovery?.tombstones ?? []) {
        const key = createFavoriteRepositoryPositionKey(account, tombstone.aid)
        const previous = tombstones[key]
        if (!previous || tombstone.deletedAt >= previous.deletedAt) tombstones[key] = clone(tombstone)
      }
      for (const tombstone of Object.values(tombstones)) {
        if (tombstone.allowRediscovery) continue
        const aid = tombstone.aid
        delete videos[String(aid)]
        delete positions[createFavoriteRepositoryPositionKey(account, aid)]
        for (const folderId of Object.keys(memberships)) {
          memberships[folderId] = (memberships[folderId] ?? []).filter((memberAid) => memberAid !== aid)
          affectedFolderIds.add(folderId)
        }
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
        classificationAdjustments: [...adjustmentsById.values()].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id)),
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
      if (mode === 'overwrite') {
        // The archive generation is now durable.  Legacy append-only audit and
        // checkpoint journals are a prior local projection and must not leak
        // through a true replacement import.
        await Promise.all([
          rm(join(this.accountDirectory(account), 'events'), { recursive: true, force: true }),
          rm(this.eventJournalPath(account), { force: true }),
          rm(this.syncJournalPath(account), { force: true }),
          rm(this.syncCheckpointJournalPath(account), { force: true })
        ])
        this.syncCheckpointState.delete(account)
      }
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

  /** Inventory remains available after account preferences are removed. */
  async listRetainedAccountUids() {
    try {
      const accounts = await readdir(join(this.options.root, 'accounts'), { withFileTypes: true })
      return accounts.filter((entry) => entry.isDirectory() && /^\d+$/u.test(entry.name) && BigInt(entry.name) > 0n)
        .map((entry) => BigInt(entry.name).toString()).sort()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  async getPortableAuditEvents(accountMid: string): Promise<Record<string, unknown>[]> {
    const account = normalizeAccountMid(accountMid)
    return this.queue(async () => {
      const repository = (await this.load(account)).repository
      const aids = new Set([
        ...Object.keys(repository.snapshot.videos).map(Number),
        ...Object.values(repository.snapshot.tombstones).map((entry) => entry.aid)
      ])
      const persisted = (await Promise.all([...aids].map((aid) => this.readEvents(account, aid)))).flat()
      return [...(repository.importedEvents ?? []), ...persisted]
        .filter((event, index, events) => event.accountMid === account && events.findIndex((candidate) => candidate.id === event.id) === index)
        .map((event) => clone(event) as Record<string, unknown>)
    })
  }

  async getPortableWorkspaceRecovery(accountMid: string): Promise<Record<string, unknown>[]> {
    const account = normalizeAccountMid(accountMid)
    return this.queue(async () => {
      const workspace = (await this.load(account)).repository.snapshot.workspace
      return workspace ? [clone(workspace) as Record<string, unknown>] : []
    })
  }

  async getPortableRemoteRecoveries(accountMid: string): Promise<Record<string, unknown>[]> {
    const account = normalizeAccountMid(accountMid)
    return this.queue(async () => (await this.load(account)).repository.snapshot.syncRecords
      .filter((record) => ['pending', 'failed', 'result-unknown', 'reconciliation-required'].includes(record.status))
      .map((record) => ({ ...clone(record), accountMid: account }) as Record<string, unknown>))
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
        if (!matchesCommandReceiptFingerprint(existing, command)) {
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
    options: FavoriteRepositoryLibraryPageOptions
  ): Promise<FavoriteRepositoryPage<FavoriteRepositoryLibraryPageRow>> {
    const account = normalizeAccountMid(accountMid)
    const limit = pageLimit(options.limit)
    const cached = await this.load(account)
    const snapshot = this.mergeSyncCheckpoints(cached.repository, await this.loadSyncCheckpointState(account)).snapshot
    const index = this.libraryIndex(cached, snapshot)
    const scopedAids = this.filterPhysicalShardAids(snapshot, index, scope, this.cachedLibraryAids(cached, snapshot, scope, index, options), options)
    const page = options.page ?? 1
    if (!Number.isSafeInteger(page) || page < 1) throw new Error('Favorite repository page number is invalid.')
    const start = options.page ? (page - 1) * limit : options.cursor ? Number(options.cursor) : 0
    if (!Number.isSafeInteger(start) || start < 0) throw new Error('Favorite repository page cursor is invalid.')
    const selected = scopedAids.slice(start, start + limit)
    const stateOrder: FavoriteRepositoryLibraryPageRow['pendingStates'] = ['protected', 'unsynced', 'continuation', 'failed', 'result-unknown', 'transcription']
    return {
      version: 1,
      accountMid: account,
      totalCount: scopedAids.length,
      ...(options.page ? { page, pageCount: Math.ceil(scopedAids.length / limit) } : {}),
      items: selected.flatMap((aid) => {
        const video = snapshot.videos[String(aid)]
        if (!video) return []
        const organization = snapshot.organizationRecords.find((record) => record.aid === aid)
        return [{
          video: { ...video, tags: [...video.tags] },
          folderIds: [...(index.folderIdsByAid.get(aid) ?? [])],
          pendingStates: stateOrder.filter((state) => index.pendingStatesByAid.get(aid)?.has(state)),
          libraryStates: this.libraryStatesForAid(snapshot, index, aid),
          ...(organization || video.lastAdjustment || video.classificationSource ? { organization: {
            ...(deriveFavoriteRepositoryClassificationSource(video, organization) ? { classificationSource: deriveFavoriteRepositoryClassificationSource(video, organization) } : {}),
            ...(organization ? { completedAt: organization.completedAt } : { completedAt: video.classificationAt ?? video.lastAdjustment?.occurredAt ?? video.updatedAt })
          } } : {})
        }]
      }),
      ...(start + limit < scopedAids.length ? { nextCursor: String(start + limit) } : {}),
      revision: snapshot.revision
    }
  }

  /** Resolves an all-results selection beside the repository index, not in the renderer. */
  async resolveLibrarySelection(
    accountMid: string,
    scope: FavoriteRepositoryLibraryPageScope,
    options: Omit<FavoriteRepositoryLibraryPageOptions, 'cursor' | 'limit' | 'page'>,
    excludedAids: number[] = []
  ) {
    const account = normalizeAccountMid(accountMid)
    const cached = await this.load(account)
    const snapshot = this.mergeSyncCheckpoints(cached.repository, await this.loadSyncCheckpointState(account)).snapshot
    const index = this.libraryIndex(cached, snapshot)
    const excluded = new Set(excludedAids.filter((aid) => Number.isSafeInteger(aid) && aid > 0))
    return this.filterPhysicalShardAids(snapshot, index, scope, this.cachedLibraryAids(cached, snapshot, scope, index, options), options)
      .filter((aid) => !excluded.has(aid))
  }

  private filterPhysicalShardAids(
    snapshot: AccountFavoriteRepositorySnapshot,
    index: FavoriteRepositoryLibraryIndex,
    scope: FavoriteRepositoryLibraryPageScope,
    aids: number[],
    options: FavoriteRepositoryLibraryPageOptions
  ) {
    const shard = options.physicalShard && scope.kind === 'folder'
      ? snapshot.physicalShards.find((candidate) => candidate.logicalLedgerId === options.physicalShard!.logicalLedgerId && candidate.shardNumber === options.physicalShard!.shardNumber)
      : undefined
    if (options.physicalShard && !shard) return []
    if (!shard) return aids
    // Physical shard memberships are stored under their raw folder ID. The
    // library index intentionally canonicalizes those IDs to the logical
    // folder, so using the index here would return the whole logical folder.
    const shardAids = new Set(snapshot.memberships[shard.folderId] ?? [])
    return aids.filter((aid) => shardAids.has(aid))
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
    const organization = snapshot.organizationRecords.find((record) => record.aid === aid)
    const latestClassificationAdjustment = [...(snapshot.classificationAdjustments ?? [])]
      .filter((record) => record.aid === aid)
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id))[0]
    const syncReceipt = this.confirmedWriteReceiptForAid(snapshot, aid)
    const libraryStates = this.libraryStatesForAid(snapshot, index, aid, syncReceipt)
    return {
      version: 1,
      accountMid: account,
      revision: snapshot.revision,
      video: { ...video, tags: [...video.tags] },
      folderIds: [...(index.folderIdsByAid.get(aid) ?? [])],
      pendingStates: stateOrder.filter((state) => index.pendingStatesByAid.get(aid)?.has(state)),
      libraryStates,
      ...(syncReceipt ? { syncReceipt } : {}),
      protected: snapshot.organizationRecords.some((record) => record.aid === aid),
      ...(organization || video.lastAdjustment || video.classificationSource ? { organization: {
        ...(deriveFavoriteRepositoryClassificationSource(video, organization) ? { classificationSource: deriveFavoriteRepositoryClassificationSource(video, organization) } : {}),
        ...(organization ? { completedAt: organization.completedAt } : { completedAt: video.classificationAt ?? video.lastAdjustment?.occurredAt ?? video.updatedAt })
      } } : {}),
      ...(latestClassificationAdjustment ? { latestClassificationAdjustment: clone(latestClassificationAdjustment) } : {}),
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
      if (cached) {
        cached.libraryIndex = undefined
        cached.pendingStateCache = undefined
        cached.libraryQueryCache = undefined
      }
    }).finally(() => { this.pendingWriteCount-- })
  }

  hasPendingWrites() {
    return this.pendingWriteCount > 0
  }

  async flush() {
    await this.writeTail
  }

  /** Publishes a local mutation and its immutable timeline events in one generation. */
  async commitWithAudit(
    accountMid: string,
    command: FavoriteRepositoryCommand,
    events: Array<Omit<FavoriteRepositoryEvent, 'accountMid'>>
  ): Promise<FavoriteRepositoryCommandResult> {
    const account = normalizeAccountMid(accountMid)
    if (!events.length) throw new Error('Favorite repository audit events are invalid.')
    this.pendingWriteCount++
    return this.queue(async () => {
      if (normalizeAccountMid(command.accountMid) !== account) throw new Error('Favorite repository account mismatch.')
      const cached = await this.load(account)
      let repository = cached.repository
      if (command.type !== 'record-sync-result' && command.type !== 'upsert-physical-shard-binding') {
        repository = this.mergeSyncCheckpoints(repository, await this.loadSyncCheckpointState(account))
      }
      if (repository.commandResults[command.id]) return this.resultFromReceipt(repository.snapshot, repository.commandResults[command.id])
      const acceptedAt = this.now()
      const result = applyFavoriteRepositoryCommand(repository.snapshot, command, acceptedAt)
      const publishedResult = this.withCanonicalAffectedFolders(result, repository.snapshot)
      const existingIds = new Set([
        ...(repository.importedEvents ?? []).map((event) => event.id),
        ...(await Promise.all([...new Set(events.map((event) => event.aid))].map(async (aid) => (await this.readEvents(account, aid)).map((event) => event.id)))).flat()
      ])
      const audited = events.map((event) => ({ ...event, accountMid: account }))
      if (audited.some((event) => existingIds.has(event.id))) throw new Error('Favorite repository audit event id conflict.')
      const next: PersistedRepository = {
        ...repository,
        snapshot: this.snapshotFromResult(result),
        importedEvents: [...(repository.importedEvents ?? []), ...audited].sort((left, right) => left.aid - right.aid || left.sequence - right.sequence || left.id.localeCompare(right.id)),
        commandResults: { ...repository.commandResults, [command.id]: receiptFromResult(result, command) }
      }
      const persisted = await this.persist(account, next, cached.manifest?.generation)
      await Promise.all([
        rm(this.syncJournalPath(account), { force: true }),
        rm(this.syncCheckpointJournalPath(account), { force: true }),
        rm(this.bindingJournalPath(account), { force: true }),
        rm(this.eventJournalPath(account), { force: true })
      ])
      this.syncCheckpointState.delete(account)
      this.cache.set(account, persisted)
      this.emitChange(publishedResult)
      return clone(result)
    }).finally(() => { this.pendingWriteCount-- })
  }

  /** Invalidates in-memory generations after an externally staged local-data publish. */
  clearCache() {
    this.cache.clear()
    this.syncCheckpointState.clear()
  }

  /**
   * Snapshots selected repository directories before a coordinated local-data
   * import. A pending transaction is recovered before any repository is read
   * after restart, so a process crash cannot expose only some selected UIDs.
   */
  async beginPortableImportTransaction(accountMids: readonly string[], recoveryState?: unknown) {
    const accounts = [...new Set(accountMids.map(normalizeAccountMid))].sort()
    return this.queue(async () => {
      const existing = await this.recoverPortableImportTransactionInternal()
      if (existing) throw new Error('Portable import recovery must be finalized before starting another import.')
      const directory = this.portableImportTransactionDirectory()
      await rm(directory, { recursive: true, force: true })
      const backups = join(directory, 'backups')
      const records: PortableImportTransaction['accounts'] = []
      for (const accountMid of accounts) {
        const source = this.accountDirectory(accountMid)
        try {
          await cp(source, join(backups, accountMid), { recursive: true, force: true, errorOnExist: false })
          records.push({ accountMid, existed: true })
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          records.push({ accountMid, existed: false })
        }
      }
      const transaction: PortableImportTransaction = { version: 1, phase: 'pending', accounts: records, ...(recoveryState === undefined ? {} : { recoveryState }) }
      await this.atomicWrite(this.portableImportTransactionPath(), JSON.stringify(transaction))
      this.portableImportTransactionActive = true
    })
  }

  /** Commits a fully published coordinated portable import by removing its rollback snapshot. */
  async commitPortableImportTransaction() {
    return this.queue(async () => {
      if (!this.portableImportTransactionActive) throw new Error('Portable import transaction is not active.')
      await rm(this.portableImportTransactionDirectory(), { recursive: true, force: true })
      this.portableImportTransactionActive = false
    })
  }

  /** Restores the durable pre-import repository state after an in-process import failure. */
  async abortPortableImportTransaction(): Promise<PortableImportTransactionRecovery | null> {
    return this.queue(async () => {
      this.portableImportTransactionActive = false
      return this.recoverPortableImportTransactionInternal()
    })
  }

  /**
   * Performs any crash recovery before callers can observe repository state.
   * The recovered journal stays durable until its non-repository recovery
   * state (owned by the main-process store) has also been restored.
   */
  async recoverPortableImportTransaction(): Promise<PortableImportTransactionRecovery | null> {
    return this.queue(async () => this.portableImportTransactionActive ? null : this.recoverPortableImportTransactionInternal())
  }

  async finalizePortableImportRecovery() {
    return this.queue(async () => {
      const transaction = await this.readPortableImportTransaction()
      if (!transaction) return
      if (transaction.phase !== 'recovered') throw new Error('Portable import transaction has not been recovered.')
      await rm(this.portableImportTransactionDirectory(), { recursive: true, force: true })
    })
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

  /** Drops every in-memory account projection after a coordinated full local-data clear. */
  resetAfterFullLocalDataClear(): void {
    this.cache.clear()
    this.syncCheckpointState.clear()
    this.portableImportTransactionActive = false
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
        totalCount: items.length,
        revision: repository.snapshot.revision,
        items: page.map(clone),
        ...(start + limit < items.length ? { nextCursor: `${page.at(-1)!.sequence}:${page.at(-1)!.id}` } : {})
      }
    })
  }

  async getClassificationAdjustmentPage(accountMid: string, aid: number, options: FolderPageOptions): Promise<FavoriteRepositoryPage<FavoriteRepositoryClassificationAdjustment>> {
    const account = normalizeAccountMid(accountMid)
    if (!Number.isSafeInteger(aid) || aid <= 0) throw new Error('Favorite library video is invalid.')
    const limit = pageLimit(options.limit)
    return this.queue(async () => {
      const snapshot = (await this.load(account)).repository.snapshot
      const items = [...(snapshot.classificationAdjustments ?? [])]
        .filter((record) => record.aid === aid)
        .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id))
      const start = options.cursor ? Math.max(0, items.findIndex((record) => record.id === options.cursor) + 1) : 0
      const page = items.slice(start, start + limit)
      return { version: 1, accountMid: account, revision: snapshot.revision, totalCount: items.length, items: page.map(clone),
        ...(start + limit < items.length ? { nextCursor: page.at(-1)!.id } : {}) }
    })
  }

  /**
   * Commits the local projection of a Bilibili-confirmed review favorite.
   * This boundary intentionally accepts no renderer-created protected command:
   * it rechecks logical/physical binding identity, builds one local plan, and
   * publishes the immutable history event in the same generation.
   */
  /**
   * Persists only the confirmed remote facts before asking the main process to
   * publish the protected local projection.  This has no Bilibili side effect
   * and deliberately does not require the binding to still be valid: account
   * open revalidates it before ever applying the local plan.
   */
  async checkpointConfirmedReviewFavorite(
    accountMid: string,
    input: FavoriteRepositoryConfirmedReviewInput
  ): Promise<void> {
    const account = normalizeAccountMid(accountMid)
    this.pendingWriteCount++
    return this.queue(async () => {
      const normalized = normalizeConfirmedReviewInput(input)
      const fingerprint = confirmedReviewInputFingerprint(normalized)
      const entries = await this.readConfirmedReviewJournal(account)
      const existing = entries.find((entry) => entry.input.operationId === normalized.operationId)
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new Error('Confirmed review favorite operation id conflict.')
        return
      }
      if (entries.length >= 100) throw new Error('Confirmed review recovery journal is full.')
      await this.writeConfirmedReviewJournal(account, [
        ...entries,
        { input: clone(normalized), fingerprint, checkpointedAt: this.now() }
      ])
    }).finally(() => {
      this.pendingWriteCount--
    })
  }

  /** Replays durable Bilibili-confirmed facts into local storage only. */
  async recoverConfirmedReviewFavorites(accountMid: string): Promise<number> {
    const account = normalizeAccountMid(accountMid)
    const entries = await this.queue(async () =>
      (await this.readConfirmedReviewJournal(account)).map((entry) => clone(entry))
    )
    let recovered = 0
    for (const entry of entries.slice(0, 100)) {
      try {
        await this.commitConfirmedReviewFavorite(account, entry.input)
        recovered++
      } catch {
        // A changed account, rule binding, or remote folder evidence must retain
        // the durable checkpoint for a later local-only retry.  No recovery
        // branch is allowed to invoke Bilibili.
      }
    }
    return recovered
  }

  async commitConfirmedReviewFavorite(
    accountMid: string,
    input: FavoriteRepositoryConfirmedReviewInput
  ): Promise<FavoriteRepositoryCommandResult> {
    const account = normalizeAccountMid(accountMid)
    this.pendingWriteCount++
    return this.queue(async () => {
      input = normalizeConfirmedReviewInput(input)
      const operationId = input.operationId
      const occurredAt = input.occurredAt
      const aid = input.aid

      const commandId = `${operationId}:local`
      const eventId = `${operationId}:event`
      const cached = await this.load(account)
      const repository = this.mergeSyncCheckpoints(cached.repository, await this.loadSyncCheckpointState(account))

      const targets = input.targets
      const logicalFolderIds = targets.map((target) => target.logicalFolderId)
      for (const target of targets) {
        const ledgerId = target.logicalFolderId!.slice('bilimi-logical:'.length)
        const bound = repository.snapshot.physicalShards.filter((shard) =>
          shard.logicalLedgerId === ledgerId && shard.bindingState === 'bound' && shard.remoteFolderId === target.remoteFolderId)
        const logicalFolder = repository.snapshot.folders.find((folder) => folder.id === target.logicalFolderId && folder.kind === 'bilimi-logical')
        if (bound.length !== 1 || !logicalFolder) {
          throw new Error('Confirmed review favorite remote folder is not a bound target.')
        }
      }
      const existingVideo = repository.snapshot.videos[String(aid)]
      if (!existingVideo && !input.video) throw new Error('Confirmed review favorite video is required.')
      const event = confirmedReviewEvent(input)
      const eventFingerprint = stableJson(event)
      const inputFingerprint = confirmedReviewInputFingerprint(input)
      const journalEntry = (await this.readConfirmedReviewJournal(account))
        .find((entry) => entry.input.operationId === operationId)
      if (journalEntry && journalEntry.fingerprint !== inputFingerprint) {
        throw new Error('Confirmed review favorite operation id conflict.')
      }
      const existing = repository.commandResults[commandId]
      if (existing) {
        const previousFingerprint = repository.reviewOperationFingerprints?.[commandId]
        if (previousFingerprint && previousFingerprint !== inputFingerprint) {
          throw new Error('Confirmed review favorite operation id conflict.')
        }
        try {
          await this.clearConfirmedReviewJournalEntry(account, operationId, inputFingerprint)
        } catch (error) {
          // The authoritative local generation already exists.  Leave the
          // checkpoint for a later idempotent cleanup rather than reporting the
          // confirmed operation as failed solely because journal pruning failed.
          console.error('Confirmed review recovery journal cleanup failed.', error)
        }
        return this.resultFromReceipt(repository.snapshot, existing)
      }
      const existingEvents = [
        ...(repository.importedEvents ?? []),
        ...(await this.readEvents(account, aid))
      ].filter((candidate) => candidate.id === eventId)
      if (existingEvents.some((candidate) => {
        const { accountMid: _accountMid, ...comparable } = candidate
        return stableJson(comparable) !== eventFingerprint
      })) {
        throw new Error('Confirmed review favorite event id conflict.')
      }

      const command: FavoriteRepositoryCommand = {
        id: commandId,
        accountMid: account,
        issuedAt: occurredAt,
        type: 'commit-local-plan',
        payload: {
          workspaceId: `review:${operationId}`,
          memberAidsByFolderId: Object.fromEntries(logicalFolderIds.map((folderId) => [folderId, [aid]])),
          ...(input.video ? { videos: [{ ...input.video, tags: [...input.video.tags] }] } : {}),
          organizationRecords: [{
            accountMid: account,
            aid,
            targetFolderIds: logicalFolderIds,
            completedAt: occurredAt,
            classificationSource: input.classificationSource
          }],
          placements: [{
            aid,
            localDesiredFolderIds: logicalFolderIds,
            remoteObservedPhysicalFolderIds: targets.map((target) => target.remoteFolderId!),
            remoteObservedLogicalFolderIds: logicalFolderIds,
            positionState: 'aligned',
            observedAt: occurredAt,
            updatedAt: occurredAt,
            reason: input.event.kind === 'entered' ? '批阅收藏经 B 站接口确认' : 'DeepSeek 批阅二审经 B 站接口确认'
          }],
          audit: { operation: 'review', bilibiliSync: { attempted: true, status: 'succeeded' } }
        }
      }
      const acceptedAt = this.now()
      const result = applyFavoriteRepositoryCommand(repository.snapshot, command, acceptedAt)
      const publishedResult = this.withCanonicalAffectedFolders(result, repository.snapshot)
      const audited = { ...event, accountMid: account }
      const importedEvents = existingEvents.length
        ? [...(repository.importedEvents ?? [])]
        : [...(repository.importedEvents ?? []), audited]
      const next: PersistedRepository = {
        ...repository,
        snapshot: this.snapshotFromResult(result),
        importedEvents: importedEvents.sort((left, right) => left.aid - right.aid || left.sequence - right.sequence || left.id.localeCompare(right.id)),
        reviewOperationFingerprints: { ...(repository.reviewOperationFingerprints ?? {}), [commandId]: inputFingerprint },
        commandResults: { ...repository.commandResults, [commandId]: receiptFromResult(result, command) }
      }
      const persisted = await this.persist(account, next, cached.manifest?.generation)
      try {
        await this.clearConfirmedReviewJournalEntry(account, operationId, inputFingerprint)
      } catch (error) {
        // Keep a stale but idempotent checkpoint if its cleanup write fails.
        // Returning the already-published generation is safer than making the
        // renderer reinterpret a confirmed Bilibili write as unsuccessful.
        console.error('Confirmed review recovery journal cleanup failed.', error)
      }
      await Promise.all([
        rm(this.syncJournalPath(account), { force: true }),
        rm(this.syncCheckpointJournalPath(account), { force: true }),
        rm(this.bindingJournalPath(account), { force: true }),
        rm(this.eventJournalPath(account), { force: true })
      ])
      this.syncCheckpointState.delete(account)
      this.cache.set(account, persisted)
      this.emitChange(publishedResult)
      return clone(result)
    }).finally(() => {
      this.pendingWriteCount--
    })
  }

  /** Repairs only the known legacy half-write; it never calls Bilibili. */
  async repairLegacyConfirmedReviewFavorites(accountMid: string): Promise<number> {
    const account = normalizeAccountMid(accountMid)
    const snapshot = await this.getSnapshot(account)
    const protectedAids = new Set(snapshot.organizationRecords.map((record) => record.aid))
    const candidates = Object.values(snapshot.positions)
      .filter((position) => position.positionState === 'aligned' &&
        position.reason === '批阅收藏经 B 站接口确认' &&
        !protectedAids.has(position.aid) && Boolean(snapshot.videos[String(position.aid)]))
      .slice(0, 100)
    let repaired = 0
    for (const position of candidates) {
      const targetPairs = position.localDesiredFolderIds.map((logicalFolderId) => {
        const ledgerId = logicalFolderId.startsWith('bilimi-logical:')
          ? logicalFolderId.slice('bilimi-logical:'.length)
          : ''
        const shards = snapshot.physicalShards.filter((shard) =>
          shard.logicalLedgerId === ledgerId && shard.bindingState === 'bound' && Boolean(shard.remoteFolderId) &&
          position.remoteObservedPhysicalFolderIds.includes(shard.remoteFolderId!))
        const folder = snapshot.folders.find((candidate) => candidate.id === logicalFolderId && candidate.kind === 'bilimi-logical')
        return shards.length === 1 && folder
          ? { logicalFolderId, remoteFolderId: shards[0].remoteFolderId!, title: folder.title }
          : undefined
      })
      if (!targetPairs.length || targetPairs.some((target) => !target) ||
        new Set(targetPairs.map((target) => target!.remoteFolderId)).size !== targetPairs.length) continue
      const video = snapshot.videos[String(position.aid)]
      await this.commitConfirmedReviewFavorite(account, {
        operationId: `legacy-confirmed-review:${account}:${position.aid}`,
        occurredAt: position.updatedAt,
        aid: position.aid,
        targets: targetPairs as Array<{ logicalFolderId: string; remoteFolderId: string; title: string }>,
        classificationSource: deriveFavoriteRepositoryClassificationSource(video) ?? 'system-high',
        event: {
          kind: 'entered', titleAtTime: video.title,
          folderTitlesAtTime: targetPairs.map((target) => target!.title),
          detail: '批阅收藏已由 B 站接口确认并写入收藏库。'
        }
      })
      repaired++
    }
    return repaired
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
      cached.libraryQueryCache = undefined
    }
    if (!this.options.getTranscriptionItems) return cached.libraryIndex
    const transcriptionRevision = this.options.getTranscriptionRevision?.() ?? Number.NaN
    if (!cached.pendingStateCache ||
      cached.pendingStateCache.repositoryRevision !== snapshot.revision ||
      cached.pendingStateCache.transcriptionRevision !== transcriptionRevision) {
      cached.pendingStateCache = {
        repositoryRevision: snapshot.revision,
        transcriptionRevision,
        statesByAid: this.pendingStatesByAid(snapshot)
      }
    }
    return { ...cached.libraryIndex, pendingStatesByAid: cached.pendingStateCache.statesByAid }
  }

  private createLibraryIndex(snapshot: AccountFavoriteRepositorySnapshot): FavoriteRepositoryLibraryIndex {
    const canonicalIdByRawId = new Map(snapshot.folders.map((folder) => [folder.id, folder.id]))
    const logicalFolders = new Map(snapshot.folders
      .filter((folder) => folder.kind === 'bilimi-logical' && folder.logicalLedgerId)
      .map((folder) => [folder.logicalLedgerId!, folder]))
    const logicalIdsByRemoteFolderId = new Map<string, Set<string>>()
    for (const shard of snapshot.physicalShards) {
      for (const remoteFolderId of [shard.remoteFolderId, ...(shard.knownRemoteFolderIds ?? [])].filter(Boolean) as string[]) {
        const logicalIds = logicalIdsByRemoteFolderId.get(remoteFolderId) ?? new Set<string>()
        logicalIds.add(shard.logicalLedgerId)
        logicalIdsByRemoteFolderId.set(remoteFolderId, logicalIds)
      }
    }
    for (const shard of snapshot.physicalShards) {
      const logical = logicalFolders.get(shard.logicalLedgerId)
      if (!logical) continue
      canonicalIdByRawId.set(shard.folderId, logical.id)
      for (const remoteFolderId of [shard.remoteFolderId, ...(shard.knownRemoteFolderIds ?? [])].filter(Boolean) as string[]) {
        if (logicalIdsByRemoteFolderId.get(remoteFolderId)?.size !== 1) continue
        const remote = snapshot.folders.find((folder) => folder.kind === 'bilibili' && folder.remoteFolderId === remoteFolderId)
        if (remote) canonicalIdByRawId.set(remote.id, logical.id)
      }
    }
    // Old local-only saves used local:<ledger> even when that logical ledger already existed.
    // Treat those records as the same local intent without mutating or deleting repository history.
    for (const folder of snapshot.folders) {
      if (folder.kind !== 'local' || !folder.id.startsWith('local:') || folder.id === 'local:inbox') continue
      const logical = logicalFolders.get(folder.id.slice('local:'.length))
      if (logical) canonicalIdByRawId.set(folder.id, logical.id)
    }
    const folders = snapshot.folders.filter((folder) => canonicalIdByRawId.get(folder.id) === folder.id)
    const foldersByTitle = new Map<string, typeof folders>()
    for (const folder of folders) {
      const title = folder.title.trim()
      foldersByTitle.set(title, [...(foldersByTitle.get(title) ?? []), folder])
    }
    const titleConflicts = [...foldersByTitle.entries()]
      .filter(([title, matches]) => title && matches.length > 1 && matches.filter((folder) => folder.kind !== 'local').length > 1)
      .map(([title, matches]) => ({
        title,
        folderIds: matches.map((folder) => folder.id).sort(),
        reason: '同名收藏夹无法证明属于同一个逻辑工作夹。',
        candidates: matches.map((folder) => ({ id: folder.id, title: folder.title })).sort((left, right) => left.id.localeCompare(right.id))
      }))
    const bindingConflicts = [...logicalIdsByRemoteFolderId.entries()]
      .filter(([, logicalIds]) => logicalIds.size > 1)
      .map(([remoteFolderId, logicalIds]) => ({
        title: snapshot.folders.find((folder) => folder.kind === 'bilibili' && folder.remoteFolderId === remoteFolderId)?.title ?? remoteFolderId,
        folderIds: [...logicalIds].map((logicalId) => `bilimi-logical:${logicalId}`).sort(),
        reason: '同一远端收藏夹被多个逻辑工作夹声明，无法安全自动选择。',
        candidates: [...logicalIds].sort().map((logicalId) => ({ id: `bilimi-logical:${logicalId}`, title: logicalFolders.get(logicalId)?.title ?? logicalId }))
      }))
    const folderConflicts = [...titleConflicts, ...bindingConflicts]
      .sort((left, right) => left.title.localeCompare(right.title) || left.folderIds.join().localeCompare(right.folderIds.join()))
    const recycledAids = new Set(Object.keys(snapshot.videos).map(Number)
      .filter((aid) => Number.isSafeInteger(aid) && isFavoriteRepositoryRecycled(snapshot, aid)))
    const folderIdsByAid = new Map<number, Set<string>>()
    const aidsByCanonicalFolderId = new Map<string, Set<number>>()
    for (const [folderId, aids] of Object.entries(snapshot.memberships)) {
      const canonicalFolderId = canonicalIdByRawId.get(folderId) ?? folderId
      const canonicalAids = aidsByCanonicalFolderId.get(canonicalFolderId) ?? new Set<number>()
      const validAids = aids.filter((aid) => Boolean(snapshot.videos[String(aid)]))
      for (const aid of validAids) if (!recycledAids.has(aid)) canonicalAids.add(aid)
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
      allAids: Object.keys(snapshot.videos).map(Number).filter((aid) => Number.isSafeInteger(aid) && !recycledAids.has(aid)).sort((left, right) => left - right),
      recycledAids: [...recycledAids].sort((left, right) => left - right),
      folderAidsByFolderId: new Map([...aidsByCanonicalFolderId].map(([id, aids]) => [id, [...aids].sort((left, right) => left - right)])),
      folderIdsByAid: new Map([...folderIdsByAid].map(([aid, ids]) => [aid, [...ids].sort((left, right) => left.localeCompare(right))])),
      pendingStatesByAid: this.pendingStatesByAid(snapshot),
      protectedAids: new Set((snapshot.organizationRecords ?? []).map((record) => record.aid))
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
        : record.status === 'failed' || record.status === 'result-unknown' || record.status === 'reconciliation-required'
          ? record.status === 'reconciliation-required' ? 'result-unknown' : record.status
          : undefined
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

  private libraryStatesForAid(
    snapshot: AccountFavoriteRepositorySnapshot,
    index: FavoriteRepositoryLibraryIndex,
    aid: number,
    syncReceipt = this.confirmedWriteReceiptForAid(snapshot, aid)
  ): FavoriteRepositoryLibraryStates {
    const position = snapshot.positions?.[`${snapshot.accountMid}:${aid}`]
    const observedLogicalFolderIds = new Set(position
      ? [...position.remoteObservedLogicalFolderIds, ...position.remoteObservedPhysicalFolderIds]
        .map((folderId) => this.trustedLogicalFolderForRemoteReference(snapshot, folderId)?.id)
        .filter((folderId): folderId is string => Boolean(folderId))
      : [])
    const remoteBilimiEvidence = observedLogicalFolderIds.size > 0
    const organized = (index.folderIdsByAid.get(aid) ?? []).some((folderId) => folderId.startsWith('bilimi-logical:'))
    const protectedAid = index.protectedAids.has(aid)
    const completeReadbackConflicts = position?.sourceAuthority === 'complete' && position.positionState !== 'aligned'
    const sync = syncReceipt && !completeReadbackConflicts
      ? 'synced'
      : remoteBilimiEvidence && position?.positionState === 'aligned' ? 'synced' : 'unsynced'
    return {
      sync,
      protection: protectedAid ? 'protected' : 'unprotected',
      organization: organized ? 'organized' : 'unorganized'
    }
  }

  /** Resolves only an existing, bound Bilimi target; it never infers a remote observation. */
  private trustedLogicalFolderForRemoteReference(snapshot: AccountFavoriteRepositorySnapshot, reference: string) {
    const normalized = reference.trim()
    if (!normalized) return undefined
    const matchingShards = snapshot.physicalShards.filter((shard) => shard.bindingState === 'bound' && Boolean(shard.remoteFolderId) && (
      normalized === `bilimi-logical:${shard.logicalLedgerId}` ||
      normalized === shard.folderId ||
      normalized === shard.remoteFolderId ||
      normalized === `bilibili:${shard.remoteFolderId}`
    ))
    const logicalLedgerIds = [...new Set(matchingShards.map((shard) => shard.logicalLedgerId))]
    if (logicalLedgerIds.length !== 1) return undefined
    const logicalLedgerId = logicalLedgerIds[0]
    const id = `bilimi-logical:${logicalLedgerId}`
    const folder = snapshot.folders.find((candidate) => candidate.id === id && candidate.kind === 'bilimi-logical')
    const shard = matchingShards[0]
    return { id, title: folder?.title ?? shard.remoteTitle }
  }

  /** Reads immutable success receipts without projecting them into remote-observation fields. */
  private confirmedWriteReceiptForAid(snapshot: AccountFavoriteRepositorySnapshot, aid: number): FavoriteRepositoryLibraryDetail['syncReceipt'] {
    const candidates: Array<{ confirmedAt: string; references: string[] }> = [
      ...(snapshot.organizationBatches ?? [])
        .filter((record) => record.aid === aid && record.status === 'succeeded')
        .map((record) => ({ confirmedAt: record.recordedAt, references: record.afterFolderIds })),
      ...(snapshot.syncRecords ?? [])
        .filter((record) => record.status === 'succeeded' && record.affectedAids.includes(aid))
        .map((record) => ({
          confirmedAt: record.updatedAt,
          references: record.targetFolderIdsByAid?.[String(aid)] ?? record.targetFolderIds ?? []
        }))
    ]
    for (const candidate of candidates.sort((left, right) => right.confirmedAt.localeCompare(left.confirmedAt))) {
      const targets = new Map<string, string>()
      for (const reference of candidate.references) {
        const target = this.trustedLogicalFolderForRemoteReference(snapshot, reference)
        if (target) targets.set(target.id, target.title)
      }
      if (targets.size) {
        const targetLogicalFolderIds = [...targets.keys()].sort()
        return {
          confirmedAt: candidate.confirmedAt,
          targetLogicalFolderIds,
          targetTitles: targetLogicalFolderIds.map((folderId) => targets.get(folderId)!)
        }
      }
    }
    return undefined
  }

  /** Protected and transcription states are displayed separately; neither requires library work. */
  private actionablePendingAids(snapshot: AccountFavoriteRepositorySnapshot) {
    return [...this.pendingStatesByAid(snapshot)]
      .filter(([aid, states]) => Boolean(snapshot.videos[String(aid)]) &&
        ['unsynced', 'continuation', 'failed', 'result-unknown'].some((state) => states.has(state as FavoriteRepositoryLibraryPageRow['pendingStates'][number])))
      .map(([aid]) => aid)
      .sort((left, right) => left - right)
  }

  private remoteReconciliations(snapshot: AccountFavoriteRepositorySnapshot): FavoriteRepositoryLibrarySummary['remoteReconciliations'] {
    return snapshot.syncRecords.flatMap((record): FavoriteRepositoryLibrarySummary['remoteReconciliations'] => {
      const isManagedPlacementRecovery = record.operationKey === 'favorite-library-managed-placement-removal' &&
        (record.status === 'reconciliation-required' || record.status === 'result-unknown')
      if (record.status !== 'reconciliation-required' && !isManagedPlacementRecovery) return []
      if (record.operationKey === 'favorite-library-unfavorite' && record.id.startsWith('favorite-remote-unfavorite:')) {
        return [{ kind: 'unfavorite' as const, operationId: record.id.slice('favorite-remote-unfavorite:'.length) }]
      }
      if (record.operationKey === 'managed-folder-delete' && record.id.startsWith('managed-folder-delete:')) {
        return [{ kind: 'managed-folder' as const, operationId: record.id.slice('managed-folder-delete:'.length) }]
      }
      if (record.operationKey === 'favorite-library-managed-placement-removal' && record.id.startsWith('favorite-managed-placement-removal:')) {
        return [{ kind: 'managed-placement' as const, operationId: record.id.slice('favorite-managed-placement-removal:'.length) }]
      }
      return []
    })
  }

  private mirrorSummary(record: AccountFavoriteRepositorySnapshot['libraryMirrors'][string] | undefined): FavoriteRepositoryLibraryDetail['mirror'] {
    if (!record || record.status === 'never') return { status: '未同步' }
    const evidence = {
      ...(record.lastSyncedAt ? { lastSyncedAt: record.lastSyncedAt } : {}),
      ...(record.lastCheckedAt ? { lastCheckedAt: record.lastCheckedAt } : {}),
      ...(record.errorCode ? { errorCode: record.errorCode } : {}),
      ...(record.remoteCode !== undefined ? { remoteCode: record.remoteCode } : {})
    }
    if (record.status === 'synced') return { status: '已同步', ...evidence }
    return { status: '未同步', ...evidence }
  }

  private libraryAids(
    snapshot: AccountFavoriteRepositorySnapshot,
    scope: FavoriteRepositoryLibraryPageScope,
    index: FavoriteRepositoryLibraryIndex
  ) {
    if (scope.kind === 'recycle') return index.recycledAids
    if (scope.kind === 'folder') {
      if (scope.folderId === 'bilimi-logical:inbox') {
        return [...new Set([
          ...(index.folderAidsByFolderId.get('bilimi-logical:inbox') ?? []),
          ...(index.folderAidsByFolderId.get('local:inbox') ?? [])
        ])].sort((left, right) => left - right)
      }
      return index.folderAidsByFolderId.get(scope.folderId) ?? []
    }
    if (scope.kind === 'pending') {
      return this.actionablePendingAids(snapshot)
    }
    if (scope.kind === 'protected' || scope.kind === 'unsynced') {
      return [...index.pendingStatesByAid]
        .filter(([aid, states]) => Boolean(snapshot.videos[String(aid)]) && (scope.kind === 'protected'
          ? states.has('protected')
          : states.has('unsynced') || states.has('failed') || states.has('result-unknown')))
        .map(([aid]) => aid).sort((left, right) => left - right)
    }
    return index.allAids
  }

  private filteredAndSortedLibraryAids(
    snapshot: AccountFavoriteRepositorySnapshot,
    aids: number[],
    index: FavoriteRepositoryLibraryIndex,
    options: Omit<FavoriteRepositoryLibraryPageOptions, 'cursor' | 'limit' | 'page'>
  ) {
    const query = options.query?.trim().toLocaleLowerCase()
    const filter = options.filter ?? 'all'
    const sourceFilter = options.sourceFilter
    const initialSourceFilter = options.initialSourceFilter
    const sort = options.sort ?? 'updated-desc'
    const transcriptionFilters = new Set(options.transcriptionFilters ?? [])
    const classificationSources = new Set(options.classificationSources ?? [])
    const organizationByAid = classificationSources.size > 0
      ? new Map(snapshot.organizationRecords.map((record) => [record.aid, record]))
      : undefined
    const transcriptionStatesByAid = transcriptionFilters.size > 0
      ? this.transcriptionStatesByAid(snapshot)
      : undefined
    const matchesSource = (aid: number) => {
      if (!sourceFilter) return true
      const sourceFolderIds = index.folderIdsByAid.get(aid) ?? []
      if (sourceFilter === 'with-other') return sourceFolderIds.some((folderId) => folderId.startsWith('bilibili:'))
      return sourceFolderIds.length > 0 && sourceFolderIds.every((folderId) => folderId.startsWith('bilimi-logical:'))
    }
    const matchesInitialSource = (aid: number) => {
      if (!initialSourceFilter) return true
      const initialSource = snapshot.videos[String(aid)]?.initialSource
      if (!initialSource) return false
      return initialSourceFilter === 'initial-ordinary'
        ? initialSource.folders.some((folder) => folder.kind === 'ordinary')
        : initialSource.folders.some((folder) => folder.kind === 'bilimi')
    }
    return aids.filter((aid) => {
      const video = snapshot.videos[String(aid)]
      if (!video) return false
      const states = index.pendingStatesByAid.get(aid) ?? new Set()
      if (!matchesSource(aid)) return false
      if (!matchesInitialSource(aid)) return false
      const matchesQuery = !query || [video.title, video.author ?? '', video.description ?? '', ...video.tags]
        .some((value) => value.toLocaleLowerCase().includes(query))
      if (!matchesQuery) return false
      if (transcriptionFilters.size > 0 && ![...(transcriptionStatesByAid?.get(aid) ?? [])]
        .some((state) => transcriptionFilters.has(state))) return false
      if (classificationSources.size > 0 && !classificationSources.has(deriveFavoriteRepositoryClassificationSource(video, organizationByAid?.get(aid)) ?? '')) return false
      const libraryStates = this.libraryStatesForAid(snapshot, index, aid)
      if (options.stateFilters?.sync && libraryStates.sync !== options.stateFilters.sync) return false
      if (options.stateFilters?.protection && libraryStates.protection !== options.stateFilters.protection) return false
      if (options.stateFilters?.organization && libraryStates.organization !== options.stateFilters.organization) return false
      if (filter === 'protected') return states.has('protected')
      if (filter === 'pending') return [...states].some((state) => state !== 'protected')
      return filter !== 'unsynced' || states.has('unsynced') || states.has('failed') || states.has('result-unknown')
    }).sort((leftAid, rightAid) => {
      const left = snapshot.videos[String(leftAid)]!
      const right = snapshot.videos[String(rightAid)]!
      if (sort === 'title-asc') return left.title.localeCompare(right.title) || leftAid - rightAid
      if (sort === 'title-desc') return right.title.localeCompare(left.title) || leftAid - rightAid
      const leftOccurredAt = left.lastAdjustment?.occurredAt
      const rightOccurredAt = right.lastAdjustment?.occurredAt
      const leftTime = leftOccurredAt ? Date.parse(leftOccurredAt) : Number.NaN
      const rightTime = rightOccurredAt ? Date.parse(rightOccurredAt) : Number.NaN
      const leftKnown = Number.isFinite(leftTime)
      const rightKnown = Number.isFinite(rightTime)
      if (leftKnown !== rightKnown) return leftKnown ? -1 : 1
      if (!leftKnown && !rightKnown) return leftAid - rightAid
      const difference = leftTime - rightTime
      return (sort === 'updated-asc' ? difference : -difference) || leftAid - rightAid
    })
  }

  private cachedLibraryAids(
    cached: CachedRepository,
    snapshot: AccountFavoriteRepositorySnapshot,
    scope: FavoriteRepositoryLibraryPageScope,
    index: FavoriteRepositoryLibraryIndex,
    options: Omit<FavoriteRepositoryLibraryPageOptions, 'cursor' | 'limit' | 'page'>
  ) {
    const transcriptionFilters = new Set(options.transcriptionFilters ?? [])
    const dependsOnQueue = Boolean(this.options.getTranscriptionItems) &&
      (options.filter === 'pending' || ['none', 'pending', 'running', 'failed'].some((state) => transcriptionFilters.has(state as FavoriteRepositoryTranscriptionFilter)))
    const dependsOnArchives = Boolean(this.options.getTranscriptionArchives) &&
      (transcriptionFilters.has('completed') || transcriptionFilters.has('none'))
    const transcriptionQueueRevision = this.options.getTranscriptionRevision?.() ?? Number.NaN
    const transcriptionArchiveRevision = this.options.getTranscriptionArchiveRevision?.() ?? Number.NaN
    const canCache = (!dependsOnQueue || Number.isSafeInteger(transcriptionQueueRevision)) &&
      (!dependsOnArchives || Number.isSafeInteger(transcriptionArchiveRevision))
    if (!canCache) {
      return this.filteredAndSortedLibraryAids(snapshot, this.libraryAids(snapshot, scope, index), index, options)
    }
    const normalizedQueueRevision = Number.isSafeInteger(transcriptionQueueRevision) ? transcriptionQueueRevision : -1
    const normalizedArchiveRevision = Number.isSafeInteger(transcriptionArchiveRevision) ? transcriptionArchiveRevision : -1
    if (!cached.libraryQueryCache ||
      cached.libraryQueryCache.repositoryRevision !== snapshot.revision) {
      cached.libraryQueryCache = {
        repositoryRevision: snapshot.revision,
        entries: new Map()
      }
    }
    const key = JSON.stringify({
      scope: scope.kind === 'folder' ? [scope.kind, scope.folderId] : [scope.kind],
      query: options.query?.trim().toLocaleLowerCase() ?? '',
      filter: options.filter ?? 'all',
      sourceFilter: options.sourceFilter ?? '',
      initialSourceFilter: options.initialSourceFilter ?? '',
      stateFilters: options.stateFilters ?? {},
      sort: options.sort ?? 'updated-desc',
      transcriptionFilters: [...transcriptionFilters].sort(),
      classificationSources: [...new Set(options.classificationSources ?? [])].sort(),
      physicalShard: options.physicalShard ?? null,
      ...(dependsOnQueue ? { transcriptionQueueRevision: normalizedQueueRevision } : {}),
      ...(dependsOnArchives ? { transcriptionArchiveRevision: normalizedArchiveRevision } : {})
    })
    const existing = cached.libraryQueryCache.entries.get(key)
    if (existing) {
      cached.libraryQueryCache.entries.delete(key)
      cached.libraryQueryCache.entries.set(key, existing)
      return existing
    }
    const aids = this.filteredAndSortedLibraryAids(snapshot, this.libraryAids(snapshot, scope, index), index, options)
    cached.libraryQueryCache.entries.set(key, aids)
    if (cached.libraryQueryCache.entries.size > 16) {
      cached.libraryQueryCache.entries.delete(cached.libraryQueryCache.entries.keys().next().value!)
    }
    return aids
  }

  private transcriptionStatesByAid(snapshot: AccountFavoriteRepositorySnapshot) {
    const statesByAid = new Map<number, Set<FavoriteRepositoryTranscriptionFilter>>()
    const addState = (aid: number, state: FavoriteRepositoryTranscriptionFilter) => {
      const states = statesByAid.get(aid) ?? new Set<FavoriteRepositoryTranscriptionFilter>()
      states.add(state)
      statesByAid.set(aid, states)
    }
    const videos = Object.values(snapshot.videos)
    // Part-specific rows and legacy/single-part rows intentionally use distinct keys.
    const aidsByIdentity = new Map(videos.map((video) => [`${video.aid}:${video.cid ?? ''}`, video.aid]))
    const matchingAid = (identity: { accountMid?: string; aid?: number | string; cid?: number | string }) => {
      if (identity.accountMid !== snapshot.accountMid) return undefined
      return aidsByIdentity.get(`${Number(identity.aid)}:${identity.cid === undefined ? '' : Number(identity.cid)}`)
    }

    for (const archive of this.options.getTranscriptionArchives?.() ?? []) {
      for (const version of archive.versions) {
        const aid = matchingAid(version.note.source)
        if (aid !== undefined) addState(aid, 'completed')
      }
    }
    for (const item of this.options.getTranscriptionItems?.() ?? []) {
      const state = item.status === 'pending' || item.status === 'running' || item.status === 'failed'
        ? item.status
        : undefined
      if (!state) continue
      const aid = matchingAid(item)
      if (aid !== undefined) addState(aid, state)
    }
    for (const video of videos) {
      if (!statesByAid.has(video.aid)) addState(video.aid, 'none')
    }
    return statesByAid
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
    if (!this.portableImportTransactionActive) await this.recoverPortableImportTransactionInternal()
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

  private portableImportTransactionDirectory() {
    return join(this.options.root, '.portable-import-transaction')
  }

  private portableImportTransactionPath() {
    return join(this.portableImportTransactionDirectory(), 'transaction.json')
  }

  private async readPortableImportTransaction(): Promise<PortableImportTransaction | null> {
    try {
      const value = JSON.parse(await readFile(this.portableImportTransactionPath(), 'utf8')) as Partial<PortableImportTransaction>
      if (value.version !== 1 || (value.phase !== 'pending' && value.phase !== 'recovered') || !Array.isArray(value.accounts) ||
        value.accounts.some((account) => !account || typeof account.accountMid !== 'string' || !/^\d+$/u.test(account.accountMid) || typeof account.existed !== 'boolean')) {
        throw new Error('Portable import transaction is invalid.')
      }
      return value as PortableImportTransaction
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private async recoverPortableImportTransactionInternal(): Promise<PortableImportTransactionRecovery | null> {
    const transaction = await this.readPortableImportTransaction()
    if (!transaction) return null
    if (transaction.phase === 'pending') {
      for (const account of transaction.accounts) {
        const destination = this.accountDirectory(account.accountMid)
        await rm(destination, { recursive: true, force: true })
        if (account.existed) {
          await cp(join(this.portableImportTransactionDirectory(), 'backups', account.accountMid), destination, {
            recursive: true, force: true, errorOnExist: false
          })
        }
        this.cache.delete(account.accountMid)
        this.syncCheckpointState.delete(account.accountMid)
      }
      await this.atomicWrite(this.portableImportTransactionPath(), JSON.stringify({ ...transaction, phase: 'recovered' satisfies PortableImportTransaction['phase'] }))
    }
    return { ...(transaction.recoveryState === undefined ? {} : { recoveryState: clone(transaction.recoveryState) }) }
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

  private async readConfirmedReviewJournal(accountMid: string): Promise<ConfirmedReviewJournalEntry[]> {
    try {
      const journal = JSON.parse(await readFile(this.confirmedReviewJournalPath(accountMid), 'utf8')) as Partial<ConfirmedReviewJournal>
      if (journal.version !== 1 || journal.accountMid !== accountMid || !Array.isArray(journal.entries) || journal.entries.length > 100) {
        throw new Error('Confirmed review recovery journal is invalid.')
      }
      const entries = journal.entries.map((entry) => {
        if (!entry || typeof entry !== 'object' || !entry.input || typeof entry.fingerprint !== 'string' || !entry.fingerprint ||
          typeof entry.checkpointedAt !== 'string' || Number.isNaN(Date.parse(entry.checkpointedAt))) {
          throw new Error('Confirmed review recovery journal is invalid.')
        }
        const input = normalizeConfirmedReviewInput(entry.input)
        const fingerprint = confirmedReviewInputFingerprint(input)
        if (entry.fingerprint !== fingerprint) throw new Error('Confirmed review recovery journal is invalid.')
        return { input, fingerprint, checkpointedAt: entry.checkpointedAt }
      })
      if (new Set(entries.map((entry) => entry.input.operationId)).size !== entries.length) {
        throw new Error('Confirmed review recovery journal is invalid.')
      }
      return entries
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  private async writeConfirmedReviewJournal(accountMid: string, entries: ConfirmedReviewJournalEntry[]): Promise<void> {
    if (!entries.length) {
      await rm(this.confirmedReviewJournalPath(accountMid), { force: true })
      return
    }
    await this.atomicWrite(this.confirmedReviewJournalPath(accountMid), JSON.stringify({
      version: 1,
      accountMid,
      entries: entries.map((entry) => ({
        input: clone(entry.input),
        fingerprint: entry.fingerprint,
        checkpointedAt: entry.checkpointedAt
      }))
    } satisfies ConfirmedReviewJournal))
  }

  private async clearConfirmedReviewJournalEntry(accountMid: string, operationId: string, fingerprint: string): Promise<void> {
    const entries = await this.readConfirmedReviewJournal(accountMid)
    const existing = entries.find((entry) => entry.input.operationId === operationId)
    if (!existing) return
    if (existing.fingerprint !== fingerprint) throw new Error('Confirmed review favorite operation id conflict.')
    await this.writeConfirmedReviewJournal(accountMid, entries.filter((entry) => entry.input.operationId !== operationId))
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

  private confirmedReviewJournalPath(accountMid: string) {
    return join(this.accountDirectory(accountMid), 'confirmed-review-recovery.json')
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
