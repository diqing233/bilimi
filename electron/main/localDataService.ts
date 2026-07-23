import { cp, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createMigrationArchiveV1, mergeMigrationAccounts, parseMigrationArchiveV1, restorePortableAccountState, type MigrationArchiveV1, type PortableAccountData } from '../../src/shared/localDataMigration'

export type LocalDataPersistence = {
  listAccountUids(): string[] | Promise<string[]>
  readAccount(uid: string): PortableAccountData | Promise<PortableAccountData>
  writeAccounts(accounts: Record<string, PortableAccountData>): void | Promise<void>
  readSharedSettings(): Record<string, unknown> | Promise<Record<string, unknown>>
  writeSharedSettings(settings: Record<string, unknown>): void | Promise<void>
}
export type LocalDataServiceOptions = { root: string; appVersion: string; persistence: LocalDataPersistence }
export type LocalDataCleanupLevel = 'cache' | 'current-account-temp' | 'current-account-data' | 'all-user-data'
type Hooks = { stopActiveWork?: () => void | Promise<void>; clearLoginSessions?: () => void | Promise<void>; exitApp?: () => void | Promise<void> }

const SHARED_SETTINGS_ALLOWLIST = new Set(['theme', 'language', 'windowBounds', 'closeBehavior', 'favoritesFolderName'])
const EXCLUDED_NAMES = /^(Cookies|Network|Cache|Code Cache|GPUCache|logs?|temp|temporary|audio-temp|lock|proxy)$/iu

export class LocalDataService {
  private hooks: Hooks = {}
  private usageGeneration = 0
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
    const accounts = Object.fromEntries(await Promise.all(input.uids.map(async (uid) => [uid, await this.options.persistence.readAccount(uid)] as const)))
    const rawShared = await this.options.persistence.readSharedSettings()
    const sharedSettings = input.includeSharedSettings ? Object.fromEntries(Object.entries(rawShared).filter(([key]) => SHARED_SETTINGS_ALLOWLIST.has(key))) : undefined
    const archive = createMigrationArchiveV1({ appVersion: this.options.appVersion, generatedAt: new Date().toISOString(), accounts, ...(sharedSettings ? { sharedSettings } : {}) })
    await this.atomicWrite(input.outputPath, JSON.stringify(archive))
    return archive
  }

  async previewImport(path: string) {
    const archive = parseMigrationArchiveV1(await readFile(path, 'utf8'))
    const existing = Object.fromEntries(await Promise.all((await this.options.persistence.listAccountUids()).map(async (uid) => [uid, await this.options.persistence.readAccount(uid)] as const)))
    return { archive, sourcePath: path, accounts: archive.selectedUids.map((uid) => ({ uid, action: existing[uid] ? 'merge' as const : 'add' as const })) }
  }

  async applyImport(preview: Awaited<ReturnType<LocalDataService['previewImport']>>, input: { mode: 'merge' | 'overwrite'; injectFailureAfterStage?: boolean }) {
    const archive = preview.archive
    const before = Object.fromEntries(await Promise.all((await this.options.persistence.listAccountUids()).map(async (uid) => [uid, await this.options.persistence.readAccount(uid)] as const)))
    const staged = input.mode === 'merge' ? mergeMigrationAccounts(before, archive.accounts) : { ...before, ...archive.accounts }
    for (const uid of archive.selectedUids) staged[uid] = restorePortableAccountState(staged[uid])
    const rollbackPath = join(this.options.root, `.migration-rollback-${randomUUID()}.json`)
    await mkdir(this.options.root, { recursive: true })
    await this.atomicWrite(rollbackPath, JSON.stringify(before))
    try {
      const stagingPath = join(this.options.root, `.migration-stage-${randomUUID()}.json`)
      await this.atomicWrite(stagingPath, JSON.stringify(staged))
      if (input.injectFailureAfterStage) throw new Error('injected import failure')
      await this.options.persistence.writeAccounts(staged)
      if (archive.sharedSettings) await this.options.persistence.writeSharedSettings(archive.sharedSettings)
      await rm(stagingPath, { force: true })
    } catch (error) {
      await this.options.persistence.writeAccounts(JSON.parse(await readFile(rollbackPath, 'utf8')))
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
      await this.hooks.exitApp?.()
      return
    }
    if (!input.uid) throw new Error('An account UID is required.')
    if (input.level === 'current-account-data') {
      const current = Object.fromEntries(await Promise.all((await this.options.persistence.listAccountUids()).filter((uid) => uid !== input.uid).map(async (uid) => [uid, await this.options.persistence.readAccount(uid)] as const)))
      await this.options.persistence.writeAccounts(current)
      return
    }
    const target = input.level === 'cache' ? join(this.options.root, 'Cache') : join(this.options.root, 'accounts', input.uid, 'temporary')
    await rm(target, { recursive: true, force: true })
  }

  private async atomicWrite(path: string, content: string) {
    const temporary = `${path}.${randomUUID()}.tmp`
    await mkdir(dirname(path), { recursive: true })
    await writeFile(temporary, content, 'utf8')
    await rename(temporary, path)
  }
}
