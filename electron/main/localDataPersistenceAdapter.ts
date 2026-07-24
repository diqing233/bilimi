import { createFavoriteRepositoryArchiveExport, validateFavoriteRepositoryArchiveExport, type AccountFavoriteRepositorySnapshot, type FavoriteRepositoryArchiveExport } from '../../src/shared/favoriteRepository'
import type { VideoAudioTranscriptionQueueItem, VideoNoteArchiveEntry } from '../../src/shared/types'
import type { LocalDataPersistence } from './localDataService'
import type { PortableAccountData } from '../../src/shared/localDataMigration'

type RepositoryArchive = FavoriteRepositoryArchiveExport & { checksum: string }
type PortableBatch = {
  repositoryArchives: Record<string, RepositoryArchive>
  settingsByUid: Record<string, Record<string, unknown>>
  archivesByUid: Record<string, VideoNoteArchiveEntry[]>
  transcriptionByUid: Record<string, VideoAudioTranscriptionQueueItem[]>
  auditEventsByUid: Record<string, Record<string, unknown>[]>
  workspacesByUid: Record<string, Record<string, unknown>[]>
  remoteOperationsByUid: Record<string, Record<string, unknown>[]>
}

type Dependencies = {
  listAccountUids(): string[] | Promise<string[]>
  /** Sources retained locally even after account preferences have been removed. */
  listRetainedAccountUids?(): string[] | Promise<string[]>
  getRepository(uid: string): Promise<AccountFavoriteRepositorySnapshot>
  getAccountSettings(uid: string): Record<string, unknown> | Promise<Record<string, unknown>>
  getArchives(): VideoNoteArchiveEntry[] | Promise<VideoNoteArchiveEntry[]>
  getTranscriptionItems(): VideoAudioTranscriptionQueueItem[] | Promise<VideoAudioTranscriptionQueueItem[]>
  getAuditEvents?(): Record<string, unknown>[] | Promise<Record<string, unknown>[]>
  getWorkspaces?(): Record<string, unknown>[] | Promise<Record<string, unknown>[]>
  getRemoteOperations?(): Record<string, unknown>[] | Promise<Record<string, unknown>[]>
  applyPortableBatch(batch: PortableBatch): void | Promise<void>
  applyPortableState(batch: PortableBatch, sharedSettings: Record<string, unknown>): void | Promise<void>
  readSharedSettings(): Record<string, unknown> | Promise<Record<string, unknown>>
  writeSharedSettings(settings: Record<string, unknown>): void | Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function uid(value: string) { if (!/^[1-9]\d*$/u.test(value)) throw new Error('Portable account UID is invalid.'); return BigInt(value).toString() }

function portableRepository(snapshot: AccountFavoriteRepositorySnapshot, events: Record<string, unknown>[]): RepositoryArchive {
  return createFavoriteRepositoryArchiveExport(snapshot, {
    generatedAt: snapshot.updatedAt,
    events: structuredClone(events) as RepositoryArchive['events'], archives: []
  })
}

function recordsForAccount(records: Record<string, unknown>[], accountMid: string) {
  return records.filter((record) => record.accountMid === accountMid).map((record) => structuredClone(record))
}

function repositoryArchive(uidValue: string, value: unknown): RepositoryArchive {
  let validated: RepositoryArchive
  try { validated = validateFavoriteRepositoryArchiveExport(value) } catch { throw new Error('Portable repository section is invalid.') }
  if (validated.accountMid !== uidValue) throw new Error('Portable repository account mismatch.')
  return structuredClone(validated)
}

export function createLocalDataPersistenceAdapter(dependencies: Dependencies): LocalDataPersistence {
  return {
    async listAccountUids() {
      const retained = await dependencies.listRetainedAccountUids?.() ?? []
      return [...new Set([...(await dependencies.listAccountUids()), ...retained].map(uid))]
    },
    async readAccount(rawUid: string): Promise<PortableAccountData> {
      const accountMid = uid(rawUid)
      const [snapshot, settings, archives, transcription, auditEvents, workspaces, remoteOperations] = await Promise.all([
        dependencies.getRepository(accountMid), dependencies.getAccountSettings(accountMid), dependencies.getArchives(), dependencies.getTranscriptionItems(),
        dependencies.getAuditEvents?.() ?? [], dependencies.getWorkspaces?.() ?? [], dependencies.getRemoteOperations?.() ?? []
      ])
      if (snapshot.accountMid !== accountMid) throw new Error('Repository account mismatch.')
      return {
        repository: portableRepository(snapshot, recordsForAccount(auditEvents, accountMid)), settings: structuredClone(settings),
        archives: archives.filter((entry) => entry.source.accountMid === accountMid).map((entry) => structuredClone(entry)),
        transcription: transcription.filter((item) => item.accountMid === accountMid).map((item) => structuredClone(item)),
        auditEvents: recordsForAccount(auditEvents, accountMid), workspaces: recordsForAccount(workspaces, accountMid), remoteOperations: recordsForAccount(remoteOperations, accountMid)
      }
    },
    async writeAccounts(accounts: Record<string, PortableAccountData>) {
      const repositoryArchives: Record<string, RepositoryArchive> = {}
      const settingsByUid: Record<string, Record<string, unknown>> = {}
      const archivesByUid: Record<string, VideoNoteArchiveEntry[]> = {}
      const transcriptionByUid: Record<string, VideoAudioTranscriptionQueueItem[]> = {}
      const auditEventsByUid: Record<string, Record<string, unknown>[]> = {}
      const workspacesByUid: Record<string, Record<string, unknown>[]> = {}
      const remoteOperationsByUid: Record<string, Record<string, unknown>[]> = {}
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
        auditEventsByUid[accountMid] = Array.isArray(data.auditEvents) ? structuredClone(data.auditEvents) as Record<string, unknown>[] : []
        workspacesByUid[accountMid] = Array.isArray(data.workspaces) ? structuredClone(data.workspaces) as Record<string, unknown>[] : []
        remoteOperationsByUid[accountMid] = Array.isArray(data.remoteOperations) ? structuredClone(data.remoteOperations) as Record<string, unknown>[] : []
      }
      await dependencies.applyPortableBatch({ repositoryArchives, settingsByUid, archivesByUid, transcriptionByUid, auditEventsByUid, workspacesByUid, remoteOperationsByUid })
    },
    async writePortableState(state) {
      const repositoryArchives: Record<string, RepositoryArchive> = {}
      const settingsByUid: Record<string, Record<string, unknown>> = {}
      const archivesByUid: Record<string, VideoNoteArchiveEntry[]> = {}
      const transcriptionByUid: Record<string, VideoAudioTranscriptionQueueItem[]> = {}
      const auditEventsByUid: Record<string, Record<string, unknown>[]> = {}
      const workspacesByUid: Record<string, Record<string, unknown>[]> = {}
      const remoteOperationsByUid: Record<string, Record<string, unknown>[]> = {}
      for (const [rawUid, data] of Object.entries(state.accounts)) {
        const accountMid = uid(rawUid)
        repositoryArchives[accountMid] = repositoryArchive(accountMid, data.repository)
        if (isRecord(data.settings)) settingsByUid[accountMid] = structuredClone(data.settings)
        const archives = Array.isArray(data.archives) ? data.archives : []
        const transcription = Array.isArray(data.transcription) ? data.transcription : []
        if (archives.some((entry) => !isRecord(entry) || !isRecord(entry.source) || entry.source.accountMid !== accountMid)) throw new Error('Portable archive account mismatch.')
        if (transcription.some((entry) => !isRecord(entry) || entry.accountMid !== accountMid)) throw new Error('Portable transcription account mismatch.')
        archivesByUid[accountMid] = structuredClone(archives) as VideoNoteArchiveEntry[]
        transcriptionByUid[accountMid] = structuredClone(transcription) as VideoAudioTranscriptionQueueItem[]
        auditEventsByUid[accountMid] = Array.isArray(data.auditEvents) ? structuredClone(data.auditEvents) as Record<string, unknown>[] : []
        workspacesByUid[accountMid] = Array.isArray(data.workspaces) ? structuredClone(data.workspaces) as Record<string, unknown>[] : []
        remoteOperationsByUid[accountMid] = Array.isArray(data.remoteOperations) ? structuredClone(data.remoteOperations) as Record<string, unknown>[] : []
      }
      await dependencies.applyPortableState({ repositoryArchives, settingsByUid, archivesByUid, transcriptionByUid, auditEventsByUid, workspacesByUid, remoteOperationsByUid }, structuredClone(state.sharedSettings))
    },
    readSharedSettings: dependencies.readSharedSettings,
    writeSharedSettings: dependencies.writeSharedSettings
  }
}
