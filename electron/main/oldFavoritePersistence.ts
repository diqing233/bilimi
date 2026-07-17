import { join } from 'node:path'
import type { OldFavoriteSessionsState } from '../../src/shared/oldFavoriteSessions'
import { OLD_FAVORITE_SESSIONS_VERSION } from '../../src/shared/oldFavoriteSessions'
import { AtomicJsonFileRepository, migrateLegacyJsonFile } from './oldFavoriteFileRepository'
import {
  compactOldFavoriteRuntimeState,
  isOldFavoriteRuntimeState,
  OldFavoriteRuntimeStore
} from './oldFavoriteRuntimeStore'
import {
  isCurrentOldFavoriteSessionsState,
  OldFavoriteSessionStore,
  type OldFavoriteSessionStoreBackend
} from './oldFavoriteSessionStore'

type LegacyStore = {
  get(key: 'oldFavoriteRuntime' | 'oldFavoriteSessions'): unknown
  set(key: 'oldFavoriteRuntime' | 'oldFavoriteSessions', value: null): void
}

class RepositoryBackend<T> implements OldFavoriteSessionStoreBackend {
  constructor(private readonly repository: AtomicJsonFileRepository<T>) {}
  get(): unknown { return this.repository.read() }
  set(_key: string, value: unknown): void { void this.repository.replace(value as T) }
  flush(): Promise<void> { return this.repository.flush() }
}

const emptySessions = (): OldFavoriteSessionsState => ({
  version: OLD_FAVORITE_SESSIONS_VERSION,
  batches: [],
  lease: null
})
const emptyRuntime = () => ({ accounts: {}, global: {} })

function sessionsFromLegacyRuntime(runtime: unknown): OldFavoriteSessionsState | null {
  if (!isOldFavoriteRuntimeState(runtime)) return null
  const batches: OldFavoriteSessionsState['batches'] = []
  for (const [accountMid, values] of Object.entries(runtime.accounts)) {
    const summaries = values.oldFavoriteUserBatches?.value
    if (!Array.isArray(summaries)) continue
    for (const summary of summaries) {
      if (!summary || typeof summary !== 'object') continue
      const record = summary as Record<string, unknown>
      if (typeof record.id !== 'string' || !Array.isArray(record.segmentAids)) continue
      const segmentAids = record.segmentAids.filter(Array.isArray) as number[][]
      batches.push({
        id: record.id,
        accountMid,
        kind: record.kind === 'incremental' ? 'incremental' : 'full',
        createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date(0).toISOString(),
        status: record.status === 'ended' ? 'ended' : 'active',
        segments: segmentAids.map((aids, index) => ({
          id: `${record.id}:segment:${index + 1}`,
          index,
          aids: aids.filter((aid) => Number.isSafeInteger(aid) && aid > 0),
          status: record.status === 'ended' ? 'ended' : 'paused'
        })),
        snapshot: record.snapshot && typeof record.snapshot === 'object' ? record.snapshot : {}
      })
    }
  }
  return batches.length > 0 ? { version: OLD_FAVORITE_SESSIONS_VERSION, batches, lease: null } : null
}

export async function createOldFavoritePersistence(options: {
  userDataPath: string
  legacyStore: LegacyStore
}) {
  const directory = join(options.userDataPath, 'old-favorite', 'v1')
  const legacySessions = options.legacyStore.get('oldFavoriteSessions')
  const legacyRuntime = options.legacyStore.get('oldFavoriteRuntime')
  const recoveredRuntimeSessions = sessionsFromLegacyRuntime(legacyRuntime)
  const sessionsRepository = await migrateLegacyJsonFile({
    path: join(directory, 'sessions.json'),
    fallback: emptySessions(),
    validate: isCurrentOldFavoriteSessionsState,
    readLegacy: () => isCurrentOldFavoriteSessionsState(legacySessions) && legacySessions.batches.length > 0
      ? legacySessions
      : recoveredRuntimeSessions ?? legacySessions,
    clearLegacy: () => options.legacyStore.set('oldFavoriteSessions', null)
  })
  const runtimeRepository = await migrateLegacyJsonFile({
    path: join(directory, 'runtime.json'),
    fallback: emptyRuntime(),
    validate: isOldFavoriteRuntimeState,
    readLegacy: () => {
      return isOldFavoriteRuntimeState(legacyRuntime)
        ? compactOldFavoriteRuntimeState(legacyRuntime)
        : legacyRuntime
    },
    clearLegacy: () => options.legacyStore.set('oldFavoriteRuntime', null)
  })
  const sessionBackend = new RepositoryBackend(sessionsRepository)
  const runtimeBackend = new RepositoryBackend(runtimeRepository)
  return {
    sessionStore: new OldFavoriteSessionStore(sessionBackend),
    runtimeStore: new OldFavoriteRuntimeStore(runtimeBackend),
    flush: () => Promise.all([sessionBackend.flush(), runtimeBackend.flush()]).then(() => undefined)
  }
}
