import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { OldFavoriteBatch, OldFavoriteSessionsState } from '../../src/shared/oldFavoriteSessions'
import { OLD_FAVORITE_SESSIONS_VERSION } from '../../src/shared/oldFavoriteSessions'
import { OldFavoriteRuntimeStore, type OldFavoriteRuntimeBackend } from './oldFavoriteRuntimeStore'
import { OldFavoriteSessionStore, type OldFavoriteSessionStoreBackend } from './oldFavoriteSessionStore'

type LegacyStore = {
  get(key: 'oldFavoriteRuntime' | 'oldFavoriteSessions'): unknown
  set(key: 'oldFavoriteRuntime' | 'oldFavoriteSessions', value: null): void
}

type BatchIndex = {
  version: 2
  batches: Array<Pick<OldFavoriteBatch, 'id' | 'accountMid' | 'kind' | 'createdAt' | 'status'>>
}

const LARGE_SNAPSHOT_KEYS = new Set([
  'preview',
  'baseScanPreview',
  'archiveEditorState',
  'archivePlanState',
  'segmentSnapshots',
  'collectionSnapshot',
  'recommendations',
  'deepSeek',
  'undo'
])

function lightweightBatch(batch: OldFavoriteBatch): OldFavoriteBatch {
  return {
    ...batch,
    snapshot: Object.fromEntries(
      Object.entries(batch.snapshot).filter(([key]) => !LARGE_SNAPSHOT_KEYS.has(key))
    )
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T } catch { return null }
}

async function atomicWrite(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  await writeFile(temporary, JSON.stringify(value), 'utf8')
  await rename(temporary, path)
}

class MemoryRuntimeBackend implements OldFavoriteRuntimeBackend {
  private value: unknown
  get(): unknown { return this.value }
  set(_key: string, value: unknown): void { this.value = value }
}

class ShardedSessionBackend implements OldFavoriteSessionStoreBackend {
  private state: OldFavoriteSessionsState
  private persisted = new Map<string, string>()
  private writeTail = Promise.resolve()

  private constructor(private readonly directory: string, state: OldFavoriteSessionsState) {
    this.state = state
    state.batches.forEach((batch) => this.persisted.set(batch.id, JSON.stringify(batch)))
  }

  static async open(directory: string, legacy: unknown) {
    const index = await readJson<BatchIndex>(join(directory, 'index.json'))
    const batches: OldFavoriteBatch[] = []
    if (index?.version === 2) {
      for (const summary of index.batches) {
        const batch = await readJson<OldFavoriteBatch>(join(directory, 'batches', `${summary.id}.json`))
        if (batch) batches.push(batch)
      }
    }
    const legacyState = isSessionsState(legacy) ? legacy : null
    const state = index
      ? { version: OLD_FAVORITE_SESSIONS_VERSION, batches, lease: null }
      : legacyState ?? { version: OLD_FAVORITE_SESSIONS_VERSION, batches: [], lease: null }
    const backend = new ShardedSessionBackend(directory, state)
    if (!index && legacyState) await backend.persistState(state)
    return { backend, migrated: !index && Boolean(legacyState) }
  }

  get(): unknown { return this.state }

  set(_key: string, value: unknown): void {
    if (!isSessionsState(value)) throw new Error('Old favorite session state is invalid.')
    const compact = { ...value, batches: value.batches.map(lightweightBatch) }
    this.state = compact
    this.writeTail = this.writeTail.then(() => this.persistState(compact))
  }

  flush() { return this.writeTail }

  private async persistState(state: OldFavoriteSessionsState) {
    const currentIds = new Set(state.batches.map((batch) => batch.id))
    for (const batch of state.batches) {
      const serialized = JSON.stringify(batch)
      if (this.persisted.get(batch.id) === serialized) continue
      await atomicWrite(join(this.directory, 'batches', `${batch.id}.json`), batch)
      this.persisted.set(batch.id, serialized)
    }
    for (const id of [...this.persisted.keys()]) {
      if (currentIds.has(id)) continue
      await rm(join(this.directory, 'batches', `${id}.json`), { force: true })
      this.persisted.delete(id)
    }
    const index: BatchIndex = {
      version: 2,
      batches: state.batches.map(({ id, accountMid, kind, createdAt, status }) => ({
        id, accountMid, kind, createdAt, status
      }))
    }
    await atomicWrite(join(this.directory, 'index.json'), index)
  }
}

function isSessionsState(value: unknown): value is OldFavoriteSessionsState {
  if (!value || typeof value !== 'object') return false
  const state = value as Partial<OldFavoriteSessionsState>
  return state.version === OLD_FAVORITE_SESSIONS_VERSION && Array.isArray(state.batches)
}

export async function createOldFavoritePersistence(options: {
  userDataPath: string
  legacyStore: LegacyStore
}) {
  const directory = join(options.userDataPath, 'old-favorite', 'v2')
  const legacySessions = options.legacyStore.get('oldFavoriteSessions')
  const { backend, migrated } = await ShardedSessionBackend.open(directory, legacySessions)
  if (migrated) options.legacyStore.set('oldFavoriteSessions', null)
  // Runtime progress and editor state are renderer memory/delta data in v2.
  options.legacyStore.set('oldFavoriteRuntime', null)
  const runtimeBackend = new MemoryRuntimeBackend()
  return {
    sessionStore: new OldFavoriteSessionStore(backend),
    runtimeStore: new OldFavoriteRuntimeStore(runtimeBackend),
    flush: () => backend.flush()
  }
}
