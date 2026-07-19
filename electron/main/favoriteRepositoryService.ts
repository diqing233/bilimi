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
    Array.isArray(snapshot.folders) && !!snapshot.memberships && typeof snapshot.memberships === 'object' &&
    Array.isArray(snapshot.physicalShards) && Array.isArray(snapshot.syncRecords)
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

  constructor(private readonly options: {
    root: string
    now?: () => string
  }) {}

  async getSnapshot(accountMid: string): Promise<AccountFavoriteRepositorySnapshot> {
    const account = normalizeAccountMid(accountMid)
    return this.queue(async () => clone(this.mergeSyncCheckpoints(
      (await this.load(account)).repository,
      await this.loadSyncCheckpointState(account)
    ).snapshot))
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
      if (command.type !== 'record-sync-result') {
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
        this.cache.set(account, { ...cached, repository: next })
        return clone(result)
      }
      const persisted = await this.persist(account, next, cached.manifest?.generation)
      await rm(this.syncJournalPath(account), { force: true })
      await rm(this.syncCheckpointJournalPath(account), { force: true })
      this.syncCheckpointState.delete(account)
      this.cache.set(account, persisted)
      return clone(result)
    }).finally(() => {
      this.pendingWriteCount--
    })
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

  private snapshotFromResult(result: FavoriteRepositoryCommandResult): AccountFavoriteRepositorySnapshot {
    const { commandId: _commandId, affectedFolderIds: _affectedFolderIds, affectedAids: _affectedAids, ...snapshot } = result
    return snapshot
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
      return validPersisted(repository, accountMid) ? { repository, manifest } : null
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
