import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  applyFavoriteRepositoryCommand,
  createAccountFavoriteRepositorySnapshot,
  type AccountFavoriteRepositorySnapshot,
  type FavoriteRepositoryCommand,
  type FavoriteRepositoryCommandResult,
  type FavoriteRepositoryPage,
  type FavoriteRepositorySyncRecord,
  type FavoriteRepositoryVideo
} from '../../src/shared/favoriteRepository'
import type { VideoAudioTranscriptionQueueItem } from '../../src/shared/types'

type PersistedRepository = {
  version: 1
  accountMid: string
  snapshot: AccountFavoriteRepositorySnapshot
  commandResults: Record<string, FavoriteRepositoryCommandResult>
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

type FavoriteRepositoryLibraryIndex = {
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
    organizationMigrationInitialized: snapshot.organizationMigrationInitialized ?? false
  }
}

function validPersisted(value: unknown, accountMid: string): value is PersistedRepository {
  if (!value || typeof value !== 'object') return false
  const persisted = value as Partial<PersistedRepository>
  return persisted.version === 1 && persisted.accountMid === accountMid &&
    validSnapshot(persisted.snapshot, accountMid) && !!persisted.commandResults &&
    typeof persisted.commandResults === 'object' && !Array.isArray(persisted.commandResults) &&
    (persisted.syncCommandIds === undefined ||
      (Array.isArray(persisted.syncCommandIds) && persisted.syncCommandIds.every((id) => typeof id === 'string' && !!id)))
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
    const pendingAidCount = this.pendingStatesByAid(snapshot).size
    return {
      version: 1,
      accountMid: snapshot.accountMid,
      revision: snapshot.revision,
      updatedAt: snapshot.updatedAt,
      videoCount: Object.keys(snapshot.videos).length,
      folderCount: snapshot.folders.length,
      folders: snapshot.folders.map((folder) => ({ ...folder })),
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
      if (command.type !== 'record-sync-result' && command.type !== 'upsert-physical-shard-binding') {
        repository = this.mergeSyncCheckpoints(repository, await this.loadSyncCheckpointState(account))
      }
      const existing = repository.commandResults[command.id]
      if (existing) return clone(existing)
      if (command.type === 'record-sync-result' && repository.syncCommandIds?.includes(command.id)) {
        return this.duplicateSyncResult(repository.snapshot, command)
      }

      const acceptedAt = this.now()
      const result = applyFavoriteRepositoryCommand(repository.snapshot, command, acceptedAt)
      const next: PersistedRepository = {
        ...repository,
        snapshot: this.snapshotFromResult(result),
        commandResults: command.type === 'record-sync-result'
          ? repository.commandResults
          : { ...repository.commandResults, [command.id]: clone(result) },
        ...(command.type === 'record-sync-result'
          ? { syncCommandIds: [...new Set([...(repository.syncCommandIds ?? []), command.id])] }
          : {})
      }
      if (command.type === 'record-sync-result') {
        await this.appendSyncJournal(account, { command: clone(command), acceptedAt })
        this.cache.set(account, { ...cached, repository: next, libraryIndex: undefined })
        this.emitChange(result)
        return clone(result)
      }
      if (command.type === 'upsert-physical-shard-binding') {
        await this.appendBindingJournal(account, { command: clone(command), acceptedAt })
        this.cache.set(account, { ...cached, repository: next, libraryIndex: undefined })
        this.emitChange(result)
        return clone(result)
      }
      const persisted = await this.persist(account, next, cached.manifest?.generation)
      await rm(this.syncJournalPath(account), { force: true })
      await rm(this.syncCheckpointJournalPath(account), { force: true })
      await rm(this.bindingJournalPath(account), { force: true })
      this.syncCheckpointState.delete(account)
      this.cache.set(account, persisted)
      this.emitChange(result)
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
    const index = this.options.getTranscriptionItems ? this.createLibraryIndex(snapshot) : cached.libraryIndex ?? this.createLibraryIndex(snapshot)
    cached.libraryIndex = index
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
    const index = this.options.getTranscriptionItems ? this.createLibraryIndex(snapshot) : cached.libraryIndex ?? this.createLibraryIndex(snapshot)
    cached.libraryIndex = index
    const stateOrder: FavoriteRepositoryLibraryPageRow['pendingStates'] = ['protected', 'unsynced', 'continuation', 'failed', 'result-unknown', 'transcription']
    return {
      version: 1,
      accountMid: account,
      revision: snapshot.revision,
      video: { ...video, tags: [...video.tags] },
      folderIds: [...(index.folderIdsByAid.get(aid) ?? [])],
      pendingStates: stateOrder.filter((state) => index.pendingStatesByAid.get(aid)?.has(state)),
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

  private now() {
    return this.options.now?.() ?? new Date().toISOString()
  }

  private emitChange(result: FavoriteRepositoryCommandResult) {
    for (const listener of this.changeListeners) listener(clone(result))
  }

  private snapshotFromResult(result: FavoriteRepositoryCommandResult): AccountFavoriteRepositorySnapshot {
    const { commandId: _commandId, affectedFolderIds: _affectedFolderIds, affectedAids: _affectedAids, ...snapshot } = result
    return snapshot
  }

  private createLibraryIndex(snapshot: AccountFavoriteRepositorySnapshot): FavoriteRepositoryLibraryIndex {
    const folderIdsByAid = new Map<number, Set<string>>()
    const folderAidsByFolderId = new Map<string, number[]>()
    for (const [folderId, aids] of Object.entries(snapshot.memberships)) {
      const validAids = aids.filter((aid) => Boolean(snapshot.videos[String(aid)]))
      folderAidsByFolderId.set(folderId, validAids)
      for (const aid of validAids) {
        const folderIds = folderIdsByAid.get(aid) ?? new Set<string>()
        folderIds.add(folderId)
        folderIdsByAid.set(aid, folderIds)
      }
    }
    return {
      allAids: Object.keys(snapshot.videos).map(Number).filter(Number.isSafeInteger).sort((left, right) => left - right),
      folderAidsByFolderId,
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
    for (const aid of Object.keys(snapshot.videos).map(Number)) {
      if (protectedAids.has(aid)) continue
      const mirror = snapshot.libraryMirrors?.[String(aid)]
      if (!mirror || mirror.status === 'never' || mirror.status === 'refreshing') addState(aid, 'unsynced')
      if (mirror?.status === 'failed') addState(aid, 'failed')
    }
    for (const record of snapshot.syncRecords) {
      const state = record.status === 'pending' ? 'unsynced'
        : record.status === 'failed' || record.status === 'result-unknown' ? record.status : undefined
      if (state) for (const aid of record.affectedAids) {
        if (!protectedAids.has(aid)) addState(aid, state)
      }
    }
    for (const item of this.options.getTranscriptionItems?.() ?? []) {
      if (item.accountMid !== snapshot.accountMid || !['pending', 'running', 'failed'].includes(item.status)) continue
      addState(Number(item.aid), 'transcription')
    }
    return statesByAid
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
      return [...index.pendingStatesByAid.keys()].filter((aid) => Boolean(snapshot.videos[String(aid)])).sort((left, right) => left - right)
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
          : { ...repository.commandResults, [entry.command.id]: clone(result) },
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
        commandResults: { ...repository.commandResults, [entry.command.id]: clone(result) }
      }
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
        ? { repository: { ...repository, snapshot: normalizeSnapshot(repository.snapshot) }, manifest }
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
