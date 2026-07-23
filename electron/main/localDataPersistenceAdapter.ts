import type { AccountFavoriteRepositorySnapshot, FavoriteRepositoryArchiveExport } from '../../src/shared/favoriteRepository'
import type { VideoAudioTranscriptionQueueItem, VideoNoteArchiveEntry } from '../../src/shared/types'
import type { LocalDataPersistence } from './localDataService'
import type { PortableAccountData } from '../../src/shared/localDataMigration'

type RepositoryArchive = FavoriteRepositoryArchiveExport & { checksum: string }
type PortableBatch = {
  repositoryArchives: Record<string, RepositoryArchive>
  settingsByUid: Record<string, Record<string, unknown>>
  archivesByUid: Record<string, VideoNoteArchiveEntry[]>
  transcriptionByUid: Record<string, VideoAudioTranscriptionQueueItem[]>
}

type Dependencies = {
  listAccountUids(): string[] | Promise<string[]>
  getRepository(uid: string): Promise<AccountFavoriteRepositorySnapshot>
  getAccountSettings(uid: string): Record<string, unknown> | Promise<Record<string, unknown>>
  getArchives(): VideoNoteArchiveEntry[] | Promise<VideoNoteArchiveEntry[]>
  getTranscriptionItems(): VideoAudioTranscriptionQueueItem[] | Promise<VideoAudioTranscriptionQueueItem[]>
  applyPortableBatch(batch: PortableBatch): void | Promise<void>
  readSharedSettings(): Record<string, unknown> | Promise<Record<string, unknown>>
  writeSharedSettings(settings: Record<string, unknown>): void | Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function uid(value: string) { if (!/^[1-9]\d*$/u.test(value)) throw new Error('Portable account UID is invalid.'); return BigInt(value).toString() }

function portableRepository(snapshot: AccountFavoriteRepositorySnapshot): RepositoryArchive {
  return {
    version: 1, accountMid: snapshot.accountMid, generatedAt: snapshot.updatedAt, checksum: `snapshot:${snapshot.accountMid}:${snapshot.revision}`,
    videos: Object.values(snapshot.videos).map((video) => structuredClone(video)),
    positions: Object.values(snapshot.positions).map(({ aid, localDesiredFolderIds, positionState, updatedAt }) => ({ aid, localDesiredFolderIds: [...localDesiredFolderIds], positionState, updatedAt })),
    protections: snapshot.organizationRecords.map(({ aid, completedAt }) => ({ aid, completedAt })),
    events: [], archives: []
  }
}

function repositoryArchive(uidValue: string, value: unknown): RepositoryArchive {
  if (!isRecord(value) || !Array.isArray(value.videos) || !Array.isArray(value.positions) || !Array.isArray(value.protections)) throw new Error('Portable repository section is invalid.')
  return {
    version: 1, accountMid: uidValue, generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : new Date(0).toISOString(), checksum: `migration:${uidValue}`,
    videos: structuredClone(value.videos) as RepositoryArchive['videos'], positions: structuredClone(value.positions) as RepositoryArchive['positions'], protections: structuredClone(value.protections) as RepositoryArchive['protections'], events: [], archives: []
  }
}

export function createLocalDataPersistenceAdapter(dependencies: Dependencies): LocalDataPersistence {
  return {
    listAccountUids: dependencies.listAccountUids,
    async readAccount(rawUid: string): Promise<PortableAccountData> {
      const accountMid = uid(rawUid)
      const [snapshot, settings, archives, transcription] = await Promise.all([
        dependencies.getRepository(accountMid), dependencies.getAccountSettings(accountMid), dependencies.getArchives(), dependencies.getTranscriptionItems()
      ])
      if (snapshot.accountMid !== accountMid) throw new Error('Repository account mismatch.')
      return {
        repository: portableRepository(snapshot), settings: structuredClone(settings),
        archives: archives.filter((entry) => entry.source.accountMid === accountMid).map((entry) => structuredClone(entry)),
        transcription: transcription.filter((item) => item.accountMid === accountMid).map((item) => structuredClone(item))
      }
    },
    async writeAccounts(accounts: Record<string, PortableAccountData>) {
      const repositoryArchives: Record<string, RepositoryArchive> = {}
      const settingsByUid: Record<string, Record<string, unknown>> = {}
      const archivesByUid: Record<string, VideoNoteArchiveEntry[]> = {}
      const transcriptionByUid: Record<string, VideoAudioTranscriptionQueueItem[]> = {}
      for (const [rawUid, data] of Object.entries(accounts)) {
        const accountMid = uid(rawUid)
        repositoryArchives[accountMid] = repositoryArchive(accountMid, data.repository)
        if (isRecord(data.settings)) settingsByUid[accountMid] = structuredClone(data.settings)
        const archives = Array.isArray(data.archives) ? data.archives : []
        if (archives.some((entry) => !isRecord(entry) || !isRecord(entry.source) || entry.source.accountMid !== accountMid)) throw new Error('Portable archive account mismatch.')
        archivesByUid[accountMid] = structuredClone(archives) as VideoNoteArchiveEntry[]
        const transcription = Array.isArray(data.transcription) ? data.transcription : []
        if (transcription.some((entry) => !isRecord(entry) || entry.accountMid !== accountMid)) throw new Error('Portable transcription account mismatch.')
        transcriptionByUid[accountMid] = structuredClone(transcription) as VideoAudioTranscriptionQueueItem[]
      }
      await dependencies.applyPortableBatch({ repositoryArchives, settingsByUid, archivesByUid, transcriptionByUid })
    },
    readSharedSettings: dependencies.readSharedSettings,
    writeSharedSettings: dependencies.writeSharedSettings
  }
}
