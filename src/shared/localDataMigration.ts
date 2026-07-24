import { createHash } from 'node:crypto'
import {
  LOCAL_DATA_MIGRATION_ACCOUNT_SOURCES,
  LOCAL_DATA_MIGRATION_SHARED_SETTINGS
} from './localDataMigrationRegistry'

export const LOCAL_DATA_MIGRATION_SCHEMA_VERSION = 1
const MAX_MANIFEST_ENTRY_BYTES = 50 * 1024 * 1024
const MAX_MANIFEST_TOTAL_BYTES = 500 * 1024 * 1024
const UID_PATTERN = /^[1-9]\d{0,19}$/u
const SECRET_KEY = /(?:cookie|session|api.?key|secret|token|encrypt|proxy|lock)/iu
const APP_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u
const ARCHIVE_KEYS = new Set(['schemaVersion', 'appVersion', 'generatedAt', 'selectedUids', 'accounts', 'sharedSettings', 'manifest', 'checksum'])
const ACCOUNT_SOURCE_KEYS = new Set<string>(LOCAL_DATA_MIGRATION_ACCOUNT_SOURCES)
const SHARED_SETTING_KEYS = new Set<string>(LOCAL_DATA_MIGRATION_SHARED_SETTINGS)

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

function assertPortable(value: unknown, path = ''): void {
  if (Array.isArray(value)) return value.forEach((item, index) => assertPortable(item, `${path}[${index}]`))
  if (!isRecord(value)) return
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw new Error(`Migration contains excluded credential field: ${path}${key}`)
    assertPortable(nested, `${path}${key}.`)
  }
}

function assertRegisteredKeys(value: Record<string, unknown>, allowedKeys: Set<string>, section: string) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new Error(`Migration contains unregistered ${section}: ${key}`)
  }
}

function assertAccountSources(value: Record<string, unknown>) {
  assertRegisteredKeys(value, ACCOUNT_SOURCE_KEYS, 'account source')
  for (const key of LOCAL_DATA_MIGRATION_ACCOUNT_SOURCES) {
    if (!(key in value)) throw new Error(`Migration account source is missing: ${key}`)
  }
  if (!isRecord(value.repository) || !isRecord(value.settings)) throw new Error('Migration account source is invalid.')
  for (const key of ['archives', 'transcription', 'auditEvents', 'workspaces', 'remoteOperations'] as const) {
    if (!Array.isArray(value[key]) || value[key].some((item) => !isRecord(item))) throw new Error(`Migration account source is invalid: ${key}`)
  }
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
    assertAccountSources(value)
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
    assertAccountSources(value)
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

export function mergeMigrationAccounts(local: Record<string, PortableAccountData>, imported: Record<string, PortableAccountData>) {
  const result: Record<string, PortableAccountData> = structuredClone(local)
  for (const [uid, incoming] of Object.entries(imported)) {
    const current = result[uid]
    if (!current) { result[uid] = structuredClone(incoming); continue }
    const merged: PortableAccountData = { ...current, ...incoming }
    merged.repository = { ...(isRecord(current.repository) ? current.repository : {}), ...(isRecord(incoming.repository) ? incoming.repository : {}), videos: mergeNamedRecords(isRecord(current.repository) ? current.repository.videos : [], isRecord(incoming.repository) ? incoming.repository.videos : [], (item) => `${item.aid}:${item.cid ?? ''}`) }
    merged.archives = mergeNamedRecords(current.archives, incoming.archives, (item) => `${item.aid}:${item.cid ?? ''}:${item.version ?? ''}`)
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
