import { createHash } from 'node:crypto'
import {
  LOCAL_DATA_MIGRATION_ACCOUNT_SOURCES,
  LOCAL_DATA_MIGRATION_SHARED_SETTINGS
} from './localDataMigrationRegistry'
import {
  createFavoriteRepositoryArchiveExportChecksum,
  validateFavoriteRepositoryArchiveExport,
  type FavoriteRepositoryArchiveExport
} from './favoriteRepository'

export const LOCAL_DATA_MIGRATION_SCHEMA_VERSION = 1
const MAX_MANIFEST_ENTRY_BYTES = 50 * 1024 * 1024
const MAX_MANIFEST_TOTAL_BYTES = 500 * 1024 * 1024
const UID_PATTERN = /^[1-9]\d{0,19}$/u
const SECRET_KEY = /(?:cookie|session|api.?key|secret|token|encrypt|proxy|lock)/iu
const REMOTE_BINDING_KEY = /^(?:remoteFolderId|knownRemoteFolderIds|remoteMemberCount|remoteObservedPhysicalFolderIds|remoteObservedLogicalFolderIds)$/u
const LOGICAL_ORGANIZATION_HISTORY_KEY = /^(?:beforeFolderIds|afterFolderIds|addedFolderIds|removedFolderIds)$/u
const APP_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u
const ARCHIVE_KEYS = new Set(['schemaVersion', 'appVersion', 'generatedAt', 'selectedUids', 'accounts', 'sharedSettings', 'manifest', 'checksum'])
const ACCOUNT_SOURCE_KEYS = new Set<string>(LOCAL_DATA_MIGRATION_ACCOUNT_SOURCES)
const SHARED_SETTING_KEYS = new Set<string>(LOCAL_DATA_MIGRATION_SHARED_SETTINGS)
const ACCOUNT_SETTING_KEYS = new Set(['defaultFavoriteSystemEnabled', 'favoriteLedgers', 'favoriteLibraryCollapsedGroups', 'updatedAt'])

export type PortableAccountData = Record<string, unknown>
export type MigrationManifestEntry = { path: string; byteLength: number; sha256: string }
export type MigrationArchiveV1 = {
  schemaVersion: 1
  appVersion: string
  generatedAt: string
  selectedUids: string[]
  accounts: Record<string, PortableAccountData>
  sharedSettings?: Record<string, unknown>
  manifest: MigrationManifestEntry[]
  checksum: string
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function assertUid(uid: string) {
  if (!UID_PATTERN.test(uid) || BigInt(uid) === 0n) throw new Error('Migration UID is invalid.')
}

function assertArchiveMetadata(appVersion: unknown, generatedAt: unknown) {
  if (typeof appVersion !== 'string' || !APP_VERSION_PATTERN.test(appVersion) || typeof generatedAt !== 'string' || !Number.isFinite(Date.parse(generatedAt)) || new Date(generatedAt).toISOString() !== generatedAt) {
    throw new Error('Migration archive metadata is invalid.')
  }
}

function assertPortable(value: unknown, path = '', allowsLogicalOrganizationHistory = false): void {
  if (Array.isArray(value)) return value.forEach((item, index) => assertPortable(item, `${path}[${index}]`, allowsLogicalOrganizationHistory))
  if (!isRecord(value)) return
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw new Error(`Migration contains excluded credential field: ${path}${key}`)
    if (REMOTE_BINDING_KEY.test(key)) throw new Error(`Migration contains device-bound remote field: ${path}${key}`)
    if (LOGICAL_ORGANIZATION_HISTORY_KEY.test(key) && !allowsLogicalOrganizationHistory && !/^repository\.recovery\.organizationBatches\.\[\d+\]\.?$/u.test(path)) {
      throw new Error(`Migration contains device-bound remote field: ${path}${key}`)
    }
    assertPortable(nested, `${path}${key}.`, allowsLogicalOrganizationHistory || path.startsWith('repository.recovery.organizationBatches.'))
  }
}

function assertRegisteredKeys(value: Record<string, unknown>, allowedKeys: Set<string>, section: string) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new Error(`Migration contains unregistered ${section}: ${key}`)
  }
}

export type PortableWorkspaceRecoveryState = 'draft' | 'running'
export type PortableTranscriptionRecoveryState = 'pending' | 'running' | 'completed' | 'failed' | 'canceled' | 'waiting-restart'
export type PortableRemoteRecoveryState = 'pending' | 'succeeded' | 'failed' | 'result-unknown' | 'reconciliation-required'

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}

function accountArchiveIdentity(noteId: unknown, accountMid: string) {
  if (typeof noteId !== 'string') return undefined
  const match = noteId.match(/^account:(\d+):aid:(\d+)(?::cid:(\d+))?$/u)
  if (!match || match[1] !== accountMid || !Number.isSafeInteger(Number(match[2])) || Number(match[2]) <= 0 ||
    (match[3] !== undefined && (!Number.isSafeInteger(Number(match[3])) || Number(match[3]) <= 0))) return undefined
  return `account:${accountMid}:aid:${Number(match[2])}${match[3] === undefined ? '' : `:cid:${Number(match[3])}`}`
}

function portableArchiveVersionIdentity(noteId: unknown, accountMid: string, source: Record<string, unknown>) {
  const accountIdentity = accountArchiveIdentity(noteId, accountMid)
  if (accountIdentity) return accountIdentity
  if (typeof noteId !== 'string' || source.accountMid !== accountMid) return undefined
  if (/^bvid:[A-Za-z0-9]+$/u.test(noteId) && typeof source.bvid === 'string' && source.bvid.trim()) return noteId
  if (/^url:https?:\/\/\S+$/u.test(noteId) && typeof source.url === 'string' && source.url.trim()) return noteId
  return undefined
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isPortableArchive(value: unknown, accountMid: string) {
  if (!isRecord(value) || !isRecord(value.source)) return false
  const source = value.source
  if (typeof value.id !== 'string' || !value.id.trim() || source.accountMid !== accountMid || typeof source.title !== 'string' || !source.title.trim() ||
    typeof source.url !== 'string' || !source.url.trim() || !isStringList(source.tags) ||
    !Array.isArray(value.versions) || !value.versions.length || !isIsoTimestamp(value.createdAt) || !isIsoTimestamp(value.updatedAt)) return false
  return value.versions.every((version) => {
    if (!isRecord(version) || typeof version.id !== 'string' || !version.id.trim() || !isIsoTimestamp(version.createdAt) ||
      typeof version.plainTranscript !== 'string' || typeof version.summaryText !== 'string' || !isRecord(version.note) || !isRecord(version.note.source)) return false
    const note = version.note
    const noteSource = note.source
    const identity = portableArchiveVersionIdentity(note.id, accountMid, noteSource)
    return Boolean(identity) && noteSource.accountMid === accountMid && typeof noteSource.title === 'string' && Boolean(noteSource.title.trim()) &&
      typeof noteSource.url === 'string' && Boolean(noteSource.url.trim()) && isStringList(noteSource.tags) &&
      ['auto', 'manual', 'audio'].includes(String(note.transcriptSource)) && Array.isArray(note.transcript) && note.transcript.every((segment) =>
        isRecord(segment) && (segment.start === null || typeof segment.start === 'number') && (segment.end === null || typeof segment.end === 'number') && typeof segment.text === 'string') &&
      Array.isArray(note.chapters) && note.chapters.every((chapter) => isRecord(chapter) && (chapter.start === null || typeof chapter.start === 'number') && typeof chapter.title === 'string' && typeof chapter.summary === 'string' && Array.isArray(chapter.segmentIndexes) && chapter.segmentIndexes.every((index) => Number.isSafeInteger(index) && Number(index) >= 0)) &&
      isRecord(note.overview) && isStringList(note.overview.shortSummary) && isStringList(note.overview.keywords) &&
      ['timeline', 'highlights'].every((key) => Array.isArray(note.overview[key]) && note.overview[key].every((item) => isRecord(item) && (item.start === null || typeof item.start === 'number') && typeof item.title === 'string' && typeof item.detail === 'string')) &&
      Array.isArray(note.annotations) && note.annotations.every((annotation) => isRecord(annotation) && typeof annotation.id === 'string' && annotation.id.trim() && (annotation.start === null || typeof annotation.start === 'number') && typeof annotation.title === 'string' && typeof annotation.body === 'string' && isIsoTimestamp(annotation.createdAt) && isIsoTimestamp(annotation.updatedAt)) &&
      typeof note.userMemo === 'string' && (note.starred === undefined || typeof note.starred === 'boolean') && isIsoTimestamp(note.createdAt) && isIsoTimestamp(note.updatedAt)
  })
}

function isRecoveryRecord(value: unknown, accountMid: string, states: readonly string[]) {
  return isRecord(value) && typeof value.id === 'string' && !!value.id.trim() && value.accountMid === accountMid &&
    states.includes(String(value.status)) && isIsoTimestamp(value.updatedAt)
}

function assertPortableRecoveryIntent(records: unknown[]) {
  for (const record of records) {
    if (!isRecord(record) || record.targetFolderIds === undefined) continue
    if (!Array.isArray(record.targetFolderIds) || record.targetFolderIds.some((folderId) =>
      typeof folderId !== 'string' || !/^bilimi-logical:\S+$/u.test(folderId.trim()))) {
      throw new Error('Migration contains device-bound remote field: targetFolderIds')
    }
  }
}

function isPortableAccountSettings(value: Record<string, unknown>) {
  if (Object.keys(value).some((key) => !ACCOUNT_SETTING_KEYS.has(key)) || typeof value.defaultFavoriteSystemEnabled !== 'boolean' ||
    !Array.isArray(value.favoriteLedgers)) return false
  if (value.favoriteLibraryCollapsedGroups !== undefined && (!isRecord(value.favoriteLibraryCollapsedGroups) ||
    Object.entries(value.favoriteLibraryCollapsedGroups).some(([key, item]) => !/^[a-z-]+$/u.test(key) || typeof item !== 'boolean'))) return false
  return value.updatedAt === undefined || isIsoTimestamp(value.updatedAt)
}

function assertAccountSources(value: Record<string, unknown>, accountMid: string) {
  assertRegisteredKeys(value, ACCOUNT_SOURCE_KEYS, 'account source')
  for (const key of LOCAL_DATA_MIGRATION_ACCOUNT_SOURCES) {
    if (!(key in value)) throw new Error(`Migration account source is missing: ${key}`)
  }
  if (!isRecord(value.settings) || !isPortableAccountSettings(value.settings)) throw new Error('Migration account source is invalid: settings')
  try {
    const repository = validateFavoriteRepositoryArchiveExport(value.repository)
    if (repository.accountMid !== accountMid) throw new Error('account mismatch')
  } catch { throw new Error('Migration account repository is invalid.') }
  if (!Array.isArray(value.archives) || value.archives.some((item) => !isPortableArchive(item, accountMid))) throw new Error('Migration account source is invalid: archives')
  if (!Array.isArray(value.transcription) || value.transcription.some((item) => !isRecoveryRecord(item, accountMid, ['pending', 'running', 'completed', 'failed', 'canceled', 'waiting-restart']))) throw new Error('Migration account source is invalid: transcription')
  if (!Array.isArray(value.workspaces) || value.workspaces.some((item) => !isRecoveryRecord(item, accountMid, ['draft', 'running', 'scanning', 'previewing', 'frozen', 'executing', 'reconciling', 'completed']))) throw new Error('Migration account source is invalid: workspaces')
  if (!Array.isArray(value.remoteOperations) || value.remoteOperations.some((item) => !isRecoveryRecord(item, accountMid, ['pending', 'succeeded', 'failed', 'result-unknown', 'reconciliation-required']))) throw new Error('Migration account source is invalid: remoteOperations')
  if (!Array.isArray(value.auditEvents) || value.auditEvents.some((item) => !isRecord(item) || item.accountMid !== accountMid || typeof item.id !== 'string' || !item.id.trim() || !isIsoTimestamp(item.occurredAt))) throw new Error('Migration account source is invalid: auditEvents')
  assertPortableRecoveryIntent(value.remoteOperations)
  assertPortable(value)
}

function assertSharedSettings(value: Record<string, unknown>) {
  assertRegisteredKeys(value, SHARED_SETTING_KEYS, 'shared setting')
  assertPortable(value)
}

function assertArchiveKeys(value: Record<string, unknown>) {
  assertRegisteredKeys(value, ARCHIVE_KEYS, 'archive section')
}

function assertSafePath(path: string) {
  if (!/^(accounts\/\d+\.json|shared-settings\.json)$/u.test(path) || path.includes('..') || path.includes('\\')) {
    throw new Error('Migration manifest path is invalid.')
  }
}

function archiveWithoutChecksum(archive: Omit<MigrationArchiveV1, 'checksum'>) {
  return stableJson(archive)
}

export function createMigrationArchiveV1(input: Omit<MigrationArchiveV1, 'schemaVersion' | 'selectedUids' | 'manifest' | 'checksum'>): MigrationArchiveV1 {
  assertArchiveMetadata(input.appVersion, input.generatedAt)
  const accountEntries: Array<[string, PortableAccountData]> = Object.entries(input.accounts).map(([rawUid, value]): [string, PortableAccountData] => {
    assertUid(rawUid)
    assertAccountSources(value, BigInt(rawUid).toString())
    return [BigInt(rawUid).toString(), structuredClone(value)]
  }).sort(([left], [right]) => left.localeCompare(right, 'en'))
  if (new Set(accountEntries.map(([uid]) => uid)).size !== accountEntries.length) throw new Error('Migration UID sections are duplicated.')
  const accounts: Record<string, PortableAccountData> = Object.fromEntries(accountEntries)
  const sharedSettings = input.sharedSettings ? structuredClone(input.sharedSettings) : undefined
  if (sharedSettings) assertSharedSettings(sharedSettings)
  const manifest = Object.entries(accounts).map(([uid, value]) => {
    const content = stableJson(value)
    return { path: `accounts/${uid}.json`, byteLength: Buffer.byteLength(content), sha256: sha256(content) }
  })
  if (sharedSettings) {
    const content = stableJson(sharedSettings)
    manifest.push({ path: 'shared-settings.json', byteLength: Buffer.byteLength(content), sha256: sha256(content) })
  }
  const withoutChecksum = {
    schemaVersion: 1 as const,
    appVersion: input.appVersion,
    generatedAt: input.generatedAt,
    selectedUids: Object.keys(accounts), accounts, ...(sharedSettings ? { sharedSettings } : {}), manifest
  }
  return { ...withoutChecksum, checksum: sha256(archiveWithoutChecksum(withoutChecksum)) }
}

export function parseMigrationArchiveV1(content: string): MigrationArchiveV1 {
  let candidate: unknown
  try { candidate = JSON.parse(content) } catch { throw new Error('Migration archive is not valid JSON.') }
  if (!isRecord(candidate)) throw new Error('Migration archive is invalid.')
  assertArchiveKeys(candidate)
  if (candidate.schemaVersion !== LOCAL_DATA_MIGRATION_SCHEMA_VERSION) throw new Error('Migration schema is unsupported.')
  try { assertArchiveMetadata(candidate.appVersion, candidate.generatedAt) } catch { throw new Error('Migration archive is incomplete.') }
  if (!isRecord(candidate.accounts) || !Array.isArray(candidate.selectedUids) || !Array.isArray(candidate.manifest) || typeof candidate.checksum !== 'string' || !/^[a-f0-9]{64}$/u.test(candidate.checksum)) {
    throw new Error('Migration archive is incomplete.')
  }
  const appVersion = candidate.appVersion as string
  const generatedAt = candidate.generatedAt as string
  const accounts: Record<string, PortableAccountData> = {}
  for (const [uid, value] of Object.entries(candidate.accounts)) {
    assertUid(uid)
    if (!isRecord(value)) throw new Error('Migration account section is invalid.')
    const normalizedUid = BigInt(uid).toString()
    if (normalizedUid !== uid || accounts[normalizedUid]) throw new Error('Migration UID sections are invalid.')
    assertAccountSources(value, normalizedUid)
    accounts[normalizedUid] = structuredClone(value)
  }
  const selectedUids = candidate.selectedUids.map((uid) => {
    if (typeof uid !== 'string') throw new Error('Migration selected UID is invalid.')
    assertUid(uid)
    return BigInt(uid).toString()
  })
  if (new Set(selectedUids).size !== selectedUids.length || selectedUids.length !== Object.keys(accounts).length || selectedUids.some((uid) => !accounts[uid])) throw new Error('Migration UID sections are invalid.')
  const manifest = candidate.manifest.map((entry): MigrationManifestEntry => {
    if (!isRecord(entry) || typeof entry.path !== 'string' || typeof entry.byteLength !== 'number' || typeof entry.sha256 !== 'string' || !Number.isSafeInteger(entry.byteLength) || entry.byteLength < 0 || entry.byteLength > MAX_MANIFEST_ENTRY_BYTES || !/^[a-f0-9]{64}$/u.test(entry.sha256)) throw new Error('Migration manifest entry is invalid.')
    assertSafePath(entry.path)
    return { path: entry.path, byteLength: entry.byteLength, sha256: entry.sha256 }
  })
  if (new Set(manifest.map((entry) => entry.path)).size !== manifest.length) throw new Error('Migration manifest has duplicate sections.')
  if (manifest.reduce((total, entry) => total + entry.byteLength, 0) > MAX_MANIFEST_TOTAL_BYTES) throw new Error('Migration manifest total is too large.')
  const sharedSettings = candidate.sharedSettings === undefined ? undefined : candidate.sharedSettings
  if (sharedSettings !== undefined && !isRecord(sharedSettings)) throw new Error('Migration shared settings are invalid.')
  if (sharedSettings) assertSharedSettings(sharedSettings)
  const archiveWithoutChecksumValue = { schemaVersion: 1 as const, appVersion, generatedAt, selectedUids, accounts, ...(sharedSettings ? { sharedSettings: structuredClone(sharedSettings) } : {}), manifest }
  if (sha256(archiveWithoutChecksum(archiveWithoutChecksumValue)) !== candidate.checksum) throw new Error('Migration archive checksum is invalid.')
  const expected = createMigrationArchiveV1({ appVersion, generatedAt, accounts, ...(sharedSettings ? { sharedSettings } : {}) })
  if (stableJson(expected.selectedUids) !== stableJson(selectedUids)) throw new Error('Migration UID sections are not canonical.')
  if (stableJson(expected.manifest) !== stableJson(manifest)) throw new Error('Migration manifest integrity is invalid.')
  return { ...archiveWithoutChecksumValue, checksum: candidate.checksum }
}

function updatedAt(value: unknown) {
  return isRecord(value) && typeof value.updatedAt === 'string' ? value.updatedAt : ''
}

function mergeNamedRecords(local: unknown, imported: unknown, identity: (value: Record<string, unknown>) => string) {
  const result = new Map<string, Record<string, unknown>>()
  for (const item of [...(Array.isArray(local) ? local : []), ...(Array.isArray(imported) ? imported : [])]) {
    if (!isRecord(item)) continue
    const key = identity(item)
    const previous = result.get(key)
    if (!previous || updatedAt(item) > updatedAt(previous)) result.set(key, structuredClone(item))
  }
  return [...result.values()]
}

function mergeVideoNoteArchives(local: unknown, imported: unknown) {
  const result = new Map<string, Record<string, unknown>>()
  for (const entry of [...(Array.isArray(local) ? local : []), ...(Array.isArray(imported) ? imported : [])]) {
    if (!isRecord(entry) || !isRecord(entry.source) || typeof entry.source.accountMid !== 'string' || !Array.isArray(entry.versions)) continue
    const accountMid = entry.source.accountMid
    const archiveId = typeof entry.id === 'string' ? entry.id : ''
    if (!archiveId) continue
    const previous = result.get(archiveId)
    const versions = new Map<string, Record<string, unknown>>()
    for (const candidate of [...(Array.isArray(previous?.versions) ? previous.versions : []), ...entry.versions]) {
      if (!isRecord(candidate) || !isRecord(candidate.note) || !isRecord(candidate.note.source)) continue
      const identity = portableArchiveVersionIdentity(candidate.note.id, accountMid, candidate.note.source)
      if (!identity) continue
      // A note identity identifies the video/part, not an immutable archive
      // version. Preserve distinct version IDs for that same note.
      const versionId = typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id : ''
      if (!versionId) continue
      const key = `${identity}:${versionId}`
      const older = versions.get(key)
      if (!older || updatedAt(candidate.note) >= updatedAt(older.note)) versions.set(key, structuredClone(candidate))
    }
    const preferred = !previous || updatedAt(entry) >= updatedAt(previous) ? entry : previous
    result.set(archiveId, { ...structuredClone(preferred), versions: [...versions.values()] })
  }
  return [...result.values()]
}

function workspaceTimestamp(workspace: unknown) {
  if (!isRecord(workspace)) return ''
  const reference = isRecord(workspace.workspaceRef) ? workspace.workspaceRef : undefined
  return typeof reference?.updatedAt === 'string' ? reference.updatedAt : updatedAt(workspace)
}

function compareWorkspaces(left: unknown, right: unknown) {
  const timestamp = workspaceTimestamp(left).localeCompare(workspaceTimestamp(right))
  if (timestamp) return timestamp
  const leftRecord = isRecord(left) ? left : {}
  const rightRecord = isRecord(right) ? right : {}
  const leftRef = isRecord(leftRecord.workspaceRef) ? leftRecord.workspaceRef : {}
  const rightRef = isRecord(rightRecord.workspaceRef) ? rightRecord.workspaceRef : {}
  for (const [leftValue, rightValue] of [
    [leftRecord.baselineRevision, rightRecord.baselineRevision],
    [leftRef.overlayRevision, rightRef.overlayRevision],
    [leftRef.journalCursor, rightRef.journalCursor]
  ] as const) {
    const difference = Number(leftValue ?? -1) - Number(rightValue ?? -1)
    if (difference) return difference
  }
  return stableJson(left).localeCompare(stableJson(right))
}

function mergeRepositoryArchives(current: FavoriteRepositoryArchiveExport & { checksum: string }, incoming: FavoriteRepositoryArchiveExport & { checksum: string }) {
  const mergeBy = <T extends Record<string, unknown>>(left: readonly T[] | undefined, right: readonly T[] | undefined, identity: (record: T) => string, timestamp = updatedAt) => {
    const values = new Map<string, T>()
    for (const record of [...(left ?? []), ...(right ?? [])]) {
      const key = identity(record); const previous = values.get(key)
      if (!previous || timestamp(record) > timestamp(previous) || (timestamp(record) === timestamp(previous) && stableJson(record) > stableJson(previous))) values.set(key, structuredClone(record))
    }
    return [...values.values()]
  }
  const currentRecovery = current.recovery
  const incomingRecovery = incoming.recovery
  const mergedTombstones = mergeBy(currentRecovery?.tombstones, incomingRecovery?.tombstones, (item) => String(item.aid), (record) => record.deletedAt)
  const hardTombstonedAids = new Set(mergedTombstones.filter((item) => !item.allowRediscovery).map((item) => Number(item.aid)))
  const recovery = currentRecovery || incomingRecovery ? {
    folders: mergeBy(currentRecovery?.folders, incomingRecovery?.folders, (item) => item.id),
    // A present tombstone is the authoritative deletion state. Memberships
    // lack per-edge revisions, so unioning them would resurrect local data.
    memberships: Object.fromEntries([...new Set([...Object.keys(currentRecovery?.memberships ?? {}), ...Object.keys(incomingRecovery?.memberships ?? {})])].sort().map((folderId) => [folderId, [...new Set([...(currentRecovery?.memberships[folderId] ?? []), ...(incomingRecovery?.memberships[folderId] ?? [])])].filter((aid) => !hardTombstonedAids.has(aid)).sort((a, b) => a - b)])),
    physicalShards: mergeBy(currentRecovery?.physicalShards, incomingRecovery?.physicalShards, (item) => `${item.logicalLedgerId}:${item.shardNumber}`),
    ...(incomingRecovery?.workspace || currentRecovery?.workspace ? {
      workspace: compareWorkspaces(incomingRecovery?.workspace, currentRecovery?.workspace) > 0
        ? incomingRecovery?.workspace : currentRecovery?.workspace
    } : {}),
    syncRecords: mergeBy(currentRecovery?.syncRecords, incomingRecovery?.syncRecords, (item) => item.id),
    organizationRecords: mergeBy(currentRecovery?.organizationRecords, incomingRecovery?.organizationRecords, (item) => String(item.aid), (record) => record.completedAt),
    organizationBatches: mergeBy(currentRecovery?.organizationBatches, incomingRecovery?.organizationBatches, (item) => item.id, (record) => record.recordedAt),
    organizationMigrationInitialized: Boolean(currentRecovery?.organizationMigrationInitialized || incomingRecovery?.organizationMigrationInitialized),
    tombstones: mergedTombstones
  } : undefined
  const merged: FavoriteRepositoryArchiveExport = {
    ...current, ...incoming,
    videos: mergeBy(current.videos, incoming.videos, (item) => String(item.aid)).filter((item) => !hardTombstonedAids.has(item.aid)),
    positions: mergeBy(current.positions, incoming.positions, (item) => String(item.aid)).filter((item) => !hardTombstonedAids.has(item.aid)),
    protections: mergeBy(current.protections, incoming.protections, (item) => String(item.aid), (record) => record.completedAt),
    events: mergeBy(current.events, incoming.events, (item) => item.id, (record) => record.occurredAt),
    archives: mergeBy(current.archives, incoming.archives, (item) => `${item.aid}:${item.archiveId}`, (record) => record.registeredAt),
    ...(recovery ? { recovery } : {})
  }
  return { ...merged, checksum: createFavoriteRepositoryArchiveExportChecksum(merged) }
}

export function mergeMigrationAccounts(local: Record<string, PortableAccountData>, imported: Record<string, PortableAccountData>) {
  const result: Record<string, PortableAccountData> = structuredClone(local)
  for (const [uid, incoming] of Object.entries(imported)) {
    const current = result[uid]
    if (!current) { result[uid] = structuredClone(incoming); continue }
    const merged: PortableAccountData = { ...current, ...incoming }
    merged.repository = mergeRepositoryArchives(validateFavoriteRepositoryArchiveExport(current.repository), validateFavoriteRepositoryArchiveExport(incoming.repository))
    merged.archives = mergeVideoNoteArchives(current.archives, incoming.archives)
    for (const key of ['workspaces', 'transcription', 'remoteOperations'] as const) merged[key] = mergeNamedRecords(current[key], incoming[key], (item) => String(item.id ?? `${item.aid}:${item.cid ?? ''}`))
    merged.settings = updatedAt(incoming.settings) > updatedAt(current.settings) ? structuredClone(incoming.settings) : structuredClone(current.settings)
    result[uid] = merged
  }
  return result
}

export function restorePortableAccountState(account: PortableAccountData): PortableAccountData {
  const restored = structuredClone(account)
  for (const workspace of Array.isArray(restored.workspaces) ? restored.workspaces : []) if (isRecord(workspace) && workspace.status === 'running') Object.assign(workspace, { status: 'draft', resumable: true })
  for (const task of Array.isArray(restored.transcription) ? restored.transcription : []) if (isRecord(task) && task.status === 'running') task.status = 'waiting-restart'
  for (const operation of Array.isArray(restored.remoteOperations) ? restored.remoteOperations : []) if (isRecord(operation) && operation.status === 'result-unknown') Object.assign(operation, { status: 'reconciliation-required', autoRetry: false })
  return restored
}
