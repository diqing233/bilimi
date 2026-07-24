import { cp, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createMigrationArchiveV1, mergeMigrationAccounts, parseMigrationArchiveV1, restorePortableAccountState, type MigrationArchiveV1, type PortableAccountData } from '../../src/shared/localDataMigration'

export type LocalDataPersistence = {
  listAccountUids(): string[] | Promise<string[]>
  readAccount(uid: string): PortableAccountData | Promise<PortableAccountData>
  writeAccounts(accounts: Record<string, PortableAccountData>): void | Promise<void>
  readSharedSettings(): Record<string, unknown> | Promise<Record<string, unknown>>
  writeSharedSettings(settings: Record<string, unknown>): void | Promise<void>
  /**
   * Publishes selected account projections as one durable transaction. A UID
   * listed in selectedUids but absent from state.accounts is removed from every
   * account-scoped durable projection. It must leave both accounts and shared
   * settings unchanged when it rejects.
   */
  writePortableState?(
    state: { accounts: Record<string, PortableAccountData>; sharedSettings: Record<string, unknown> },
    options: { mode: 'merge' | 'overwrite'; selectedUids: string[] }
  ): void | Promise<void>
}
export type LocalDataServiceOptions = { root: string; appVersion: string; persistence: LocalDataPersistence }
export type LocalDataCleanupLevel = 'cache' | 'current-account-temp' | 'current-account-data' | 'all-user-data'
type Hooks = { stopActiveWork?: () => void | Promise<void>; clearLoginSessions?: () => void | Promise<void>; exitApp?: () => void | Promise<void> }
export type LocalDataImportPreview = {
  token: string
  accounts: Array<{ uid: string; action: 'merge' | 'add' }>
}

const SHARED_SETTINGS_ALLOWLIST = new Set(['theme', 'language', 'windowBounds', 'closeBehavior', 'favoritesFolderName'])
const EXCLUDED_NAMES = /^(Cookies|Network|Cache|Code Cache|GPUCache|logs?|temp|temporary|audio-temp|lock|proxy)$/iu

export class LocalDataService {
  private hooks: Hooks = {}
  private usageGeneration = 0
  private readonly importPreviews = new Map<string, { archive: MigrationArchiveV1; sourcePath: string; sourceHash: string; expiresAt: number }>()
  constructor(private readonly options: LocalDataServiceOptions) {}
  setDestructiveHooks(hooks: Hooks) { this.hooks = hooks }

  async calculateUsage() {
    const generation = ++this.usageGeneration
    const categories = { accountPersistent: { bytes: 0 }, deviceShared: { bytes: 0 }, cache: { bytes: 0 }, temporaryAudio: { bytes: 0 }, logs: { bytes: 0 } }
    const walk = async (directory: string): Promise<void> => {
      if (generation !== this.usageGeneration) return
      let entries: Array<{ name: string; isDirectory(): boolean; isSymbolicLink(): boolean }>
      try { entries = await readdir(directory, { withFileTypes: true, encoding: 'utf8' }) } catch { return }
      for (const entry of entries) {
        if (generation !== this.usageGeneration || entry.isSymbolicLink()) continue
        const path = join(directory, entry.name)
        if (entry.isDirectory()) { await walk(path); continue }
        try {
          const bytes = (await stat(path)).size
          const scopedPath = relative(this.options.root, path)
          const category = /\.log$/iu.test(entry.name) ? 'logs' : /(?:cache|code cache|gpu)/iu.test(scopedPath) ? 'cache' : /(?:temp|temporary|audio)/iu.test(scopedPath) ? 'temporaryAudio' : /^(preferences|config)/iu.test(entry.name) ? 'deviceShared' : 'accountPersistent'
          categories[category].bytes += bytes
        } catch { /* Unreadable files are not fatal. */ }
      }
    }
    await walk(this.options.root)
    return { categories, totalBytes: Object.values(categories).reduce((sum, item) => sum + item.bytes, 0), calculatedAt: new Date().toISOString(), stale: generation !== this.usageGeneration }
  }

  async listAccounts() { return (await this.options.persistence.listAccountUids()).map((uid) => ({ uid, retained: true })) }
  async exportArchive(input: { uids: string[]; includeSharedSettings?: boolean; outputPath: string }) {
    const selectedUids = [...new Set(input.uids.map(normalizeUid))]
    const known = new Set((await this.options.persistence.listAccountUids()).map(normalizeUid))
    if (selectedUids.some((uid) => !known.has(uid))) throw new Error('Local data export account is unknown.')
    const accounts = Object.fromEntries(await Promise.all(selectedUids.map(async (uid) => [uid, await this.options.persistence.readAccount(uid)] as const)))
    const rawShared = await this.options.persistence.readSharedSettings()
    const sharedSettings = input.includeSharedSettings ? Object.fromEntries(Object.entries(rawShared).filter(([key]) => SHARED_SETTINGS_ALLOWLIST.has(key))) : undefined
    const archive = createMigrationArchiveV1({ appVersion: this.options.appVersion, generatedAt: new Date().toISOString(), accounts, ...(sharedSettings ? { sharedSettings } : {}) })
    await this.atomicWrite(input.outputPath, JSON.stringify(archive))
    return archive
  }

  async previewImport(path: string): Promise<LocalDataImportPreview> {
    const content = await readFile(path, 'utf8')
    const archive = parseMigrationArchiveV1(content)
    if (compareVersions(archive.appVersion, this.options.appVersion) > 0) throw new Error('Migration archive was created by a newer unsupported app version.')
    const existing = Object.fromEntries(await Promise.all((await this.options.persistence.listAccountUids()).map(async (uid) => [uid, await this.options.persistence.readAccount(uid)] as const)))
    this.pruneImportPreviews()
    const token = randomUUID()
    this.importPreviews.set(token, { archive: structuredClone(archive), sourcePath: path, sourceHash: sha256(content), expiresAt: Date.now() + 10 * 60 * 1000 })
    return { token, accounts: archive.selectedUids.map((uid) => ({ uid, action: existing[uid] ? 'merge' as const : 'add' as const })) }
  }

  cancelUsageCalculation() { this.usageGeneration++ }

  async previewCleanup(input: { level: LocalDataCleanupLevel; uid?: string; confirmation?: string }) {
    if (input.level === 'all-user-data' && input.confirmation !== '全部清除') throw new Error('Full clear confirmation is required.')
    if (input.level !== 'all-user-data' && !input.uid && input.level !== 'cache') throw new Error('An account UID is required.')
    if (input.uid) normalizeUid(input.uid)
    const targets = input.level === 'cache' ? [join(this.options.root, 'Cache')] : input.level === 'current-account-temp' ? [join(this.options.root, 'accounts', input.uid!, 'temporary')] : input.level === 'current-account-data' ? [`account:${input.uid}`] : ['all-account-data', 'shared-settings', 'login-sessions']
    return { ...input, targets, requiresExit: input.level === 'all-user-data', affectsBilibiliServerData: false }
  }

  async applyImport(preview: LocalDataImportPreview, input: { mode: 'merge' | 'overwrite'; injectFailureAfterStage?: boolean }) {
    const pending = this.takeImportPreview(preview)
    const content = await readFile(pending.sourcePath, 'utf8')
    if (sha256(content) !== pending.sourceHash) throw new Error('Migration source changed after preview.')
    const archive = parseMigrationArchiveV1(content)
    if (archive.checksum !== pending.archive.checksum) throw new Error('Migration source changed after preview.')
    const before = Object.fromEntries(await Promise.all((await this.options.persistence.listAccountUids()).map(async (uid) => [uid, await this.options.persistence.readAccount(uid)] as const)))
    const beforeSharedSettings = await this.options.persistence.readSharedSettings()
    const rollbackSelectedUids = [...new Set([...Object.keys(before), ...archive.selectedUids])].sort()
    const staged = input.mode === 'merge' ? mergeMigrationAccounts(before, archive.accounts) : { ...before, ...archive.accounts }
    for (const uid of archive.selectedUids) staged[uid] = restorePortableAccountState(staged[uid])
    const rollbackPath = join(this.options.root, `.migration-rollback-${randomUUID()}.json`)
    await mkdir(this.options.root, { recursive: true })
    await this.atomicWrite(rollbackPath, JSON.stringify(before))
    try {
      const stagingPath = join(this.options.root, `.migration-stage-${randomUUID()}.json`)
      await this.atomicWrite(stagingPath, JSON.stringify(staged))
      if (input.injectFailureAfterStage) throw new Error('injected import failure')
      if (!this.options.persistence.writePortableState) throw new Error('Local data persistence does not support atomic import.')
      const sharedSettings = archive.sharedSettings ? { ...beforeSharedSettings, ...archive.sharedSettings } : beforeSharedSettings
      await this.options.persistence.writePortableState({ accounts: staged, sharedSettings }, { mode: input.mode, selectedUids: archive.selectedUids })
      await rm(stagingPath, { force: true })
    } catch (error) {
      // Persistence implementations can fail after one durable backend has
      // published. Replaying the complete pre-import state is the compensating
      // transaction; it deliberately never retries the requested import.
      if (this.options.persistence.writePortableState) {
        try { await this.options.persistence.writePortableState({ accounts: before, sharedSettings: beforeSharedSettings }, { mode: 'overwrite', selectedUids: rollbackSelectedUids }) }
        catch (rollbackError) { throw new Error(`Migration import failed and rollback could not be completed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`) }
      }
      throw error
    } finally { await rm(rollbackPath, { force: true }) }
  }

  async applyCleanup(input: { level: LocalDataCleanupLevel; uid?: string; confirmation?: string }) {
    if (input.level === 'all-user-data') {
      if (input.confirmation !== '全部清除') throw new Error('Full clear confirmation is required.')
      await this.hooks.stopActiveWork?.()
      await this.options.persistence.writeAccounts({})
      await this.options.persistence.writeSharedSettings({})
      await this.hooks.clearLoginSessions?.()
      // The profile root is local-only. Remove residual repository, draft,
      // cache, log, and temporary files after coordinated structured cleanup.
      const entries = await readdir(this.options.root, { withFileTypes: true }).catch(() => [])
      await Promise.all(entries.filter((entry) => !entry.isSymbolicLink()).map((entry) =>
        rm(join(this.options.root, entry.name), { recursive: entry.isDirectory(), force: true })
      ))
      await this.hooks.exitApp?.()
      return
    }
    if (!input.uid) throw new Error('An account UID is required.')
    const uid = normalizeUid(input.uid)
    if (input.level === 'current-account-data') {
      const current = Object.fromEntries(await Promise.all((await this.options.persistence.listAccountUids()).map(normalizeUid).filter((account) => account !== uid).map(async (account) => [account, await this.options.persistence.readAccount(account)] as const)))
      await this.options.persistence.writeAccounts(current)
      return
    }
    const target = input.level === 'cache' ? join(this.options.root, 'Cache') : join(this.options.root, 'accounts', uid, 'temporary')
    await rm(target, { recursive: true, force: true })
  }

  private async atomicWrite(path: string, content: string) {
    const temporary = `${path}.${randomUUID()}.tmp`
    await mkdir(dirname(path), { recursive: true })
    await writeFile(temporary, content, 'utf8')
    await rename(temporary, path)
  }

  private takeImportPreview(preview: LocalDataImportPreview) {
    if (!preview || typeof preview.token !== 'string') throw new Error('Migration import preview is invalid.')
    const pending = this.importPreviews.get(preview.token)
    this.importPreviews.delete(preview.token)
    if (!pending || pending.expiresAt < Date.now()) throw new Error('Migration import preview is expired or invalid.')
    return pending
  }

  private pruneImportPreviews() {
    const now = Date.now()
    for (const [token, pending] of this.importPreviews) if (pending.expiresAt < now) this.importPreviews.delete(token)
  }
}

function normalizeUid(value: string) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,19}$/u.test(value) || BigInt(value) === 0n) throw new Error('Local data account is invalid.')
  return BigInt(value).toString()
}

function sha256(content: string) { return createHash('sha256').update(content).digest('hex') }

function compareVersions(left: string, right: string) {
  const parse = (value: string) => value.split('.').map((part) => /^\d+$/u.test(part) ? Number(part) : 0)
  const leftParts = parse(left); const rightParts = parse(right)
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index++) {
    if ((leftParts[index] ?? 0) !== (rightParts[index] ?? 0)) return (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
  }
  return 0
}
