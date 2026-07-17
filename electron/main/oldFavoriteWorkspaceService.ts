import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  OldFavoriteAccountIndex,
  OldFavoriteBatchDetail,
  OldFavoriteBatchManifest,
  OldFavoriteBatchSummary,
  OldFavoriteChunkKind,
  OldFavoriteChunkRecord,
  OldFavoriteOverlayKind,
  OldFavoriteOverlayPatch
} from './oldFavoriteWorkspaceTypes'

type FileOperation = 'read' | 'write' | 'delete'
const EMPTY_OVERLAYS = (): OldFavoriteBatchDetail['overlays'] => ({
  user: {},
  deepseek: {},
  execution: {}
})

function validAccountMid(value: string) {
  const normalized = value.trim()
  if (!/^\d+$/.test(normalized)) throw new Error('Old favorite account id is invalid.')
  return normalized
}

function checksum(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function encodeChunk(items: unknown[]) {
  const payload = items.map((item) => JSON.stringify(item)).join('\n') + (items.length ? '\n' : '')
  return `${payload}# sha256:${checksum(payload)}\n`
}

function decodeChunk(value: string, expectedChecksum: string): unknown[] | null {
  const footerStart = value.lastIndexOf('# sha256:')
  if (footerStart < 0) return null
  const payload = value.slice(0, footerStart)
  const footer = value.slice(footerStart).trim()
  if (footer !== `# sha256:${expectedChecksum}` || checksum(payload) !== expectedChecksum) return null
  try {
    return payload.trim() ? payload.trimEnd().split('\n').map((line) => JSON.parse(line)) : []
  } catch {
    return null
  }
}

export class OldFavoriteWorkspaceService {
  private indexes = new Map<string, OldFavoriteAccountIndex>()
  private manifests = new Map<string, OldFavoriteBatchManifest>()
  private overlayCache = new Map<string, OldFavoriteBatchDetail['overlays']>()
  private writeTail = Promise.resolve()
  private opened = false

  constructor(private readonly options: {
    root: string
    onFileAccess?: (operation: FileOperation, path: string) => void
    mutateBilibili?: () => unknown
  }) {}

  isOpen() {
    return this.opened
  }

  async openAccount(accountMid: string): Promise<OldFavoriteAccountIndex> {
    const account = validAccountMid(accountMid)
    const cached = this.indexes.get(account)
    if (cached) return structuredClone(cached)
    this.opened = true
    const path = this.indexPath(account)
    const loaded = await this.readJson<OldFavoriteAccountIndex>(path)
    const index = loaded?.version === 2 && loaded.accountMid === account
      ? loaded
      : { version: 2, accountMid: account, batches: [] } satisfies OldFavoriteAccountIndex
    this.indexes.set(account, index)
    return structuredClone(index)
  }

  async createBatch(options: {
    accountMid: string
    kind: OldFavoriteBatchSummary['kind']
    createdAt?: string
    id?: string
  }): Promise<OldFavoriteBatchSummary> {
    const account = validAccountMid(options.accountMid)
    const index = await this.requireIndex(account)
    const requestedId = options.id?.trim()
    if (requestedId) {
      const existing = index.batches.find((batch) => batch.id === requestedId)
      if (existing) {
        if (existing.kind !== options.kind || (options.createdAt && existing.createdAt !== options.createdAt)) {
          throw new Error('Old favorite batch id already belongs to another batch.')
        }
        return structuredClone(existing)
      }
    }
    const summary: OldFavoriteBatchSummary = {
      id: requestedId || `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
      kind: options.kind,
      createdAt: options.createdAt ?? new Date().toISOString(),
      status: 'active'
    }
    const manifest: OldFavoriteBatchManifest = {
      version: 2,
      accountMid: account,
      ...summary,
      chunks: []
    }
    index.batches.push(summary)
    this.manifests.set(this.batchKey(account, summary.id), manifest)
    await this.atomicWriteJson(this.manifestPath(account, summary.id), manifest)
    await this.atomicWriteJson(this.indexPath(account), index)
    return structuredClone(summary)
  }

  async appendChunk(
    accountMid: string,
    batchId: string,
    kind: OldFavoriteChunkKind,
    items: unknown[]
  ): Promise<OldFavoriteChunkRecord> {
    const account = validAccountMid(accountMid)
    const manifest = await this.loadManifest(account, batchId)
    if (manifest.status === 'archived') throw new Error('Old favorite batch is finalized.')
    const sequence = manifest.chunks.filter((chunk) => chunk.kind === kind).length + 1
    const file = `${kind}-${String(sequence).padStart(6, '0')}.jsonl`
    const payload = items.map((item) => JSON.stringify(item)).join('\n') + (items.length ? '\n' : '')
    const record: OldFavoriteChunkRecord = { file, kind, sequence, count: items.length, checksum: checksum(payload) }
    await this.queueWrite(async () => {
      await this.writeText(join(this.batchDirectory(account, batchId), file), encodeChunk(items))
      manifest.chunks.push(record)
      await this.atomicWriteJson(this.manifestPath(account, batchId), manifest)
    })
    return structuredClone(record)
  }

  async finalizeBatch(accountMid: string, batchId: string): Promise<OldFavoriteBatchSummary> {
    const account = validAccountMid(accountMid)
    const manifest = await this.loadManifest(account, batchId)
    if (manifest.status === 'archived') throw new Error('Old favorite batch is already finalized.')
    manifest.status = 'archived'
    manifest.finalizedAt = new Date().toISOString()
    const index = await this.requireIndex(account)
    const summary = index.batches.find((item) => item.id === batchId)
    if (!summary) throw new Error('Old favorite batch index is missing.')
    summary.status = manifest.status
    summary.finalizedAt = manifest.finalizedAt
    await this.atomicWriteJson(this.manifestPath(account, batchId), manifest)
    await this.atomicWriteJson(this.indexPath(account), index)
    return structuredClone(summary)
  }

  async patchOverlay(
    accountMid: string,
    batchId: string,
    kind: OldFavoriteOverlayKind,
    patch: OldFavoriteOverlayPatch | OldFavoriteOverlayPatch[]
  ) {
    const account = validAccountMid(accountMid)
    await this.loadManifest(account, batchId)
    const overlays = await this.loadOverlays(account, batchId)
    for (const value of Array.isArray(patch) ? patch : [patch]) {
      overlays[kind][String(value.aid)] = structuredClone(value)
    }
    await this.queueWrite(() => this.atomicWriteJson(this.overlayPath(account, batchId), overlays))
  }

  async loadBatch(accountMid: string, batchId: string): Promise<OldFavoriteBatchDetail> {
    const account = validAccountMid(accountMid)
    const manifest = await this.loadManifest(account, batchId)
    const detail: OldFavoriteBatchDetail = {
      summary: {
        id: manifest.id,
        kind: manifest.kind,
        createdAt: manifest.createdAt,
        status: manifest.status,
        finalizedAt: manifest.finalizedAt
      },
      base: [], tags: [], sources: [],
      overlays: structuredClone(await this.loadOverlays(account, batchId))
    }
    for (const chunk of manifest.chunks) {
      const value = await this.readText(join(this.batchDirectory(account, batchId), chunk.file))
      const decoded = value === null ? null : decodeChunk(value, chunk.checksum)
      if (decoded) detail[chunk.kind].push(...decoded)
    }
    return detail
  }

  async recoverBatch(accountMid: string, batchId: string) {
    const account = validAccountMid(accountMid)
    const manifest = await this.loadManifest(account, batchId)
    const tail = manifest.chunks.at(-1)
    if (!tail) return { discardedTail: null }
    const path = join(this.batchDirectory(account, batchId), tail.file)
    const value = await this.readText(path)
    if (value !== null && decodeChunk(value, tail.checksum)) return { discardedTail: null }
    await this.deletePath(path)
    manifest.chunks.pop()
    await this.atomicWriteJson(this.manifestPath(account, batchId), manifest)
    return { discardedTail: tail.file }
  }

  async resetAccount(accountMid: string) {
    const account = validAccountMid(accountMid)
    await this.deletePath(join(this.options.root, 'accounts', account), true)
    this.indexes.delete(account)
    for (const key of [...this.manifests.keys()]) if (key.startsWith(`${account}:`)) this.manifests.delete(key)
    for (const key of [...this.overlayCache.keys()]) if (key.startsWith(`${account}:`)) this.overlayCache.delete(key)
  }

  flush() {
    return this.writeTail
  }

  private async requireIndex(account: string) {
    if (!this.indexes.has(account)) await this.openAccount(account)
    return this.indexes.get(account)!
  }

  private async loadManifest(account: string, batchId: string) {
    const key = this.batchKey(account, batchId)
    const cached = this.manifests.get(key)
    if (cached) return cached
    const manifest = await this.readJson<OldFavoriteBatchManifest>(this.manifestPath(account, batchId))
    if (!manifest || manifest.version !== 2 || manifest.accountMid !== account || manifest.id !== batchId) {
      throw new Error('Old favorite batch does not exist.')
    }
    this.manifests.set(key, manifest)
    return manifest
  }

  private async loadOverlays(account: string, batchId: string) {
    const key = this.batchKey(account, batchId)
    const cached = this.overlayCache.get(key)
    if (cached) return cached
    const loaded = await this.readJson<OldFavoriteBatchDetail['overlays']>(this.overlayPath(account, batchId))
    const overlays = loaded ?? EMPTY_OVERLAYS()
    this.overlayCache.set(key, overlays)
    return overlays
  }

  private batchKey(account: string, batchId: string) { return `${account}:${batchId}` }
  private accountDirectory(account: string) { return join(this.options.root, 'accounts', account) }
  private indexPath(account: string) { return join(this.accountDirectory(account), 'index.json') }
  private batchDirectory(account: string, batchId: string) { return join(this.accountDirectory(account), 'batches', batchId) }
  private manifestPath(account: string, batchId: string) { return join(this.batchDirectory(account, batchId), 'manifest.json') }
  private overlayPath(account: string, batchId: string) { return join(this.batchDirectory(account, batchId), 'overlays.json') }

  private async readText(path: string) {
    this.options.onFileAccess?.('read', path)
    try { return await readFile(path, 'utf8') } catch { return null }
  }

  private async readJson<T>(path: string): Promise<T | null> {
    const value = await this.readText(path)
    if (value === null) return null
    try { return JSON.parse(value) as T } catch { return null }
  }

  private async writeText(path: string, value: string) {
    this.options.onFileAccess?.('write', path)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, value, 'utf8')
  }

  private async atomicWriteJson(path: string, value: unknown) {
    const temporary = `${path}.tmp`
    await this.writeText(temporary, JSON.stringify(value))
    this.options.onFileAccess?.('write', path)
    await rename(temporary, path)
  }

  private async deletePath(path: string, recursive = false) {
    this.options.onFileAccess?.('delete', path)
    await rm(path, { recursive, force: true })
  }

  private queueWrite(work: () => Promise<void>) {
    const next = this.writeTail.then(work, work)
    this.writeTail = next.catch(() => undefined)
    return next
  }
}
