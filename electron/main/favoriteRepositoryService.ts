import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  applyFavoriteRepositoryCommand,
  createAccountFavoriteRepositorySnapshot,
  type AccountFavoriteRepositorySnapshot,
  type FavoriteRepositoryCommand,
  type FavoriteRepositoryCommandResult,
  type FavoriteRepositoryPage,
  type FavoriteRepositoryVideo
} from '../../src/shared/favoriteRepository'

type PersistedRepository = {
  version: 1
  accountMid: string
  snapshot: AccountFavoriteRepositorySnapshot
  commandResults: Record<string, FavoriteRepositoryCommandResult>
}

type FolderPageOptions = {
  limit: number
  cursor?: string
}

function clone<T>(value: T): T {
  return structuredClone(value)
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
    typeof persisted.commandResults === 'object' && !Array.isArray(persisted.commandResults)
}

export class FavoriteRepositoryService {
  private readonly cache = new Map<string, PersistedRepository>()
  private writeTail = Promise.resolve()

  constructor(private readonly options: {
    root: string
    now?: () => string
  }) {}

  async getSnapshot(accountMid: string): Promise<AccountFavoriteRepositorySnapshot> {
    const account = normalizeAccountMid(accountMid)
    return this.queue(async () => clone((await this.load(account)).snapshot))
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
      const snapshot = (await this.load(account)).snapshot
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
    return this.queue(async () => {
      const repository = await this.load(account)
      const existing = repository.commandResults[command.id]
      if (existing) return clone(existing)

      const result = applyFavoriteRepositoryCommand(repository.snapshot, command, this.now())
      const next: PersistedRepository = {
        ...repository,
        snapshot: this.snapshotFromResult(result),
        commandResults: { ...repository.commandResults, [command.id]: clone(result) }
      }
      await this.persist(account, next)
      this.cache.set(account, next)
      return clone(result)
    })
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

  private async load(accountMid: string): Promise<PersistedRepository> {
    const cached = this.cache.get(accountMid)
    if (cached) return cached
    const path = this.repositoryPath(accountMid)
    const temporaryPath = `${path}.tmp`
    const primary = await this.readPersisted(path, accountMid)
    const temporary = primary ? null : await this.readPersisted(temporaryPath, accountMid)
    const loaded = primary ?? temporary
    if (temporary) {
      await rename(temporaryPath, path)
    }
    const repository = loaded ?? {
      version: 1 as const,
      accountMid,
      snapshot: createAccountFavoriteRepositorySnapshot({ accountMid, now: this.now() }),
      commandResults: {}
    }
    this.cache.set(accountMid, repository)
    return repository
  }

  private async readPersisted(path: string, accountMid: string): Promise<PersistedRepository | null> {
    try {
      const value = JSON.parse(await readFile(path, 'utf8')) as unknown
      return validPersisted(value, accountMid) ? value : null
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null
      throw error
    }
  }

  private async persist(accountMid: string, repository: PersistedRepository) {
    const directory = this.accountDirectory(accountMid)
    await mkdir(directory, { recursive: true })
    await Promise.all([
      this.atomicWrite(this.videoRecordsPath(accountMid), this.encodeVideos(repository.snapshot)),
      this.atomicWrite(this.membershipRecordsPath(accountMid), this.encodeMemberships(repository.snapshot))
    ])
    await this.atomicWrite(this.repositoryPath(accountMid), JSON.stringify(repository))
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

  private accountDirectory(accountMid: string) {
    return join(this.options.root, 'accounts', accountMid)
  }

  private repositoryPath(accountMid: string) {
    return join(this.accountDirectory(accountMid), 'repository.json')
  }

  private videoRecordsPath(accountMid: string) {
    return join(this.accountDirectory(accountMid), 'videos.jsonl')
  }

  private membershipRecordsPath(accountMid: string) {
    return join(this.accountDirectory(accountMid), 'memberships.jsonl')
  }

  private queue<T>(operation: () => Promise<T>) {
    const run = this.writeTail.then(operation, operation)
    this.writeTail = run.then(() => undefined, () => undefined)
    return run
  }
}
