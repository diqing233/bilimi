import { createHash } from 'node:crypto'
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
  batches: Array<Pick<OldFavoriteBatch, 'id' | 'accountMid' | 'kind' | 'createdAt' | 'status'> & {
    storageKey?: string
  }>
}

function batchStorageKey(batchId: string) {
  return `batch-${createHash('sha256').update(batchId).digest('hex')}`
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
  private persisted = new Map<string, { serialized: string, storageKey: string }>()
  private writeTail = Promise.resolve()
  private latestWrite = Promise.resolve()

  private constructor(
    private readonly directory: string,
    state: OldFavoriteSessionsState,
    storageKeys: Map<string, string>
  ) {
    this.state = state
    state.batches.forEach((batch) => this.persisted.set(batch.id, {
      serialized: JSON.stringify(batch),
      storageKey: storageKeys.get(batch.id) ?? batchStorageKey(batch.id)
    }))
  }

  static async open(directory: string, legacy: unknown) {
    const index = await readJson<BatchIndex>(join(directory, 'index.json'))
    const batches: OldFavoriteBatch[] = []
    const storageKeys = new Map<string, string>()
    if (index?.version === 2) {
      for (const summary of index.batches) {
        const storageKey = summary.storageKey ?? summary.id
        const batch = await readJson<OldFavoriteBatch>(join(directory, 'batches', `${storageKey}.json`))
        if (batch) {
          batches.push(batch)
          storageKeys.set(batch.id, storageKey)
        }
      }
    }
    const legacyState = isSessionsState(legacy) ? legacy : null
    const state = index
      ? { version: OLD_FAVORITE_SESSIONS_VERSION, batches, lease: null }
      : legacyState ?? { version: OLD_FAVORITE_SESSIONS_VERSION, batches: [], lease: null }
    const backend = new ShardedSessionBackend(directory, state, storageKeys)
    if (!index && legacyState) await backend.persistState(state)
    return { backend, migrated: !index && Boolean(legacyState) }
  }

  get(): unknown { return this.state }

  set(_key: string, value: unknown): void {
    if (!isSessionsState(value)) throw new Error('Old favorite session state is invalid.')
    const compact = { ...value, batches: value.batches.map(lightweightBatch) }
    this.state = compact
    const next = this.writeTail.then(
      () => this.persistState(compact),
      () => this.persistState(compact)
    )
    this.writeTail = next.catch(() => undefined)
    this.latestWrite = next
  }

  flush() { return this.latestWrite }

  private async persistState(state: OldFavoriteSessionsState) {
    const currentIds = new Set(state.batches.map((batch) => batch.id))
    for (const batch of state.batches) {
      const serialized = JSON.stringify(batch)
      const existing = this.persisted.get(batch.id)
      if (existing?.serialized === serialized) continue
      const storageKey = existing?.storageKey ?? batchStorageKey(batch.id)
      await atomicWrite(join(this.directory, 'batches', `${storageKey}.json`), batch)
      this.persisted.set(batch.id, { serialized, storageKey })
    }
    for (const id of [...this.persisted.keys()]) {
      if (currentIds.has(id)) continue
      await rm(join(this.directory, 'batches', `${this.persisted.get(id)!.storageKey}.json`), { force: true })
      this.persisted.delete(id)
    }
    const index: BatchIndex = {
      version: 2,
      batches: state.batches.map(({ id, accountMid, kind, createdAt, status }) => ({
        id, accountMid, kind, createdAt, status,
        storageKey: this.persisted.get(id)?.storageKey ?? batchStorageKey(id)
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
