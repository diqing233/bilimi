import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
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

function batchStorageKey(batchId: string) {
  return `batch-${checksum(batchId)}`
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
  private readonly replacementFullBatchIds = new Set<string>()

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
      ? {
          ...loaded,
          batches: loaded.batches.map((batch) => ({
            ...batch,
            storageKey: batch.storageKey ?? batch.id
          }))
        }
      : { version: 2, accountMid: account, batches: [] } satisfies OldFavoriteAccountIndex
    this.indexes.set(account, index)
    return structuredClone(index)
  }

  async readBatchSummary(accountMid: string, batchId: string): Promise<OldFavoriteBatchSummary | null> {
    const account = validAccountMid(accountMid)
    return this.queueWrite(async () => {
      const index = await this.requireIndex(account)
      const summary = index.batches.find((batch) => batch.id === batchId)
      if (!summary) return null
      const manifest = await this.loadManifest(account, batchId)
      if (manifest.status !== 'archived') return structuredClone(summary)
      const repaired = {
        ...summary,
        status: 'archived' as const,
        finalizedAt: manifest.finalizedAt
      }
      if (summary.status !== repaired.status || summary.finalizedAt !== repaired.finalizedAt) {
        const nextIndex = {
          ...index,
          batches: index.batches.map((item) => item.id === batchId ? repaired : item)
        }
        await this.atomicWriteJson(this.indexPath(account), nextIndex)
        index.batches.splice(index.batches.findIndex((item) => item.id === batchId), 1, repaired)
      }
      return structuredClone(repaired)
    })
  }

  async createBatch(options: {
    accountMid: string
    kind: OldFavoriteBatchSummary['kind']
    createdAt?: string
    id?: string
  }): Promise<OldFavoriteBatchSummary> {
    const account = validAccountMid(options.accountMid)
    return this.queueWrite(async () => {
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
      if (options.kind === 'full') {
        const activeFullCandidates = index.batches
          .filter((batch) => batch.kind === 'full' && batch.status === 'active')
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
          .reverse()
        for (const activeFull of activeFullCandidates) {
          const manifest = await this.loadManifest(account, activeFull.id).catch(() => null)
          if (manifest?.status === 'archived') {
            const repaired = { ...activeFull, status: 'archived' as const, finalizedAt: manifest.finalizedAt }
            const nextIndex = {
              ...index,
              batches: index.batches.map((item) => item.id === activeFull.id ? repaired : item)
            }
            await this.atomicWriteJson(this.indexPath(account), nextIndex)
            index.batches.splice(index.batches.findIndex((item) => item.id === activeFull.id), 1, repaired)
            continue
          }
          if (manifest?.scanPlaceholder ||
            manifest?.chunks.some((chunk) => chunk.count > 0) ||
            this.replacementFullBatchIds.has(activeFull.id)) {
            return structuredClone(activeFull)
          }
        }
      }
      const summary: OldFavoriteBatchSummary = {
        id: requestedId || `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
        storageKey: '',
        kind: options.kind,
        createdAt: options.createdAt ?? new Date().toISOString(),
        status: 'active'
      }
      summary.storageKey = batchStorageKey(summary.id)
      const manifest: OldFavoriteBatchManifest = {
        version: 2,
        accountMid: account,
        ...summary,
        chunks: [],
        scanPlaceholder: true
      }
      if (options.kind === 'full') this.replacementFullBatchIds.add(summary.id)
      await this.atomicWriteJson(this.manifestPath(account, summary.id), manifest)
      const nextIndex = { ...index, batches: [...index.batches, summary] }
      await this.atomicWriteJson(this.indexPath(account), nextIndex)
      index.batches.push(summary)
      this.manifests.set(this.batchKey(account, summary.id), manifest)
      return structuredClone(summary)
    })
  }

  async appendChunk(
    accountMid: string,
    batchId: string,
    kind: OldFavoriteChunkKind,
    items: unknown[]
  ): Promise<OldFavoriteChunkRecord> {
    const account = validAccountMid(accountMid)
    return this.queueWrite(async () => {
      const manifest = await this.loadManifest(account, batchId)
      if (manifest.status === 'archived') throw new Error('Old favorite batch is finalized.')
      const sequence = manifest.chunks.filter((chunk) => chunk.kind === kind).length + 1
      const file = `${kind}-${String(sequence).padStart(6, '0')}.jsonl`
      const payload = items.map((item) => JSON.stringify(item)).join('\n') + (items.length ? '\n' : '')
      const record: OldFavoriteChunkRecord = { file, kind, sequence, count: items.length, checksum: checksum(payload) }
      await this.writeText(join(this.batchDirectory(account, batchId), file), encodeChunk(items))
      manifest.chunks.push(record)
      manifest.scanPlaceholder = false
      await this.atomicWriteJson(this.manifestPath(account, batchId), manifest)
      return structuredClone(record)
    })
  }

  async appendChunkGroup(
    accountMid: string,
    batchId: string,
    chunks: Record<OldFavoriteChunkKind, unknown[]>
  ): Promise<OldFavoriteChunkRecord[]> {
    const account = validAccountMid(accountMid)
    return this.queueWrite(async () => {
      const manifest = await this.loadManifest(account, batchId)
      if (manifest.status === 'archived') throw new Error('Old favorite batch is finalized.')
      const groupId = randomUUID()
      const records = (['base', 'tags', 'sources'] as const).map((kind) => {
        const sequence = manifest.chunks.filter((chunk) => chunk.kind === kind).length + 1
        const file = `${kind}-${String(sequence).padStart(6, '0')}.jsonl`
        const items = chunks[kind]
        const payload = items.map((item) => JSON.stringify(item)).join('\n') + (items.length ? '\n' : '')
        return { file, kind, sequence, count: items.length, checksum: checksum(payload), groupId }
      })
      for (const record of records) {
        await this.writeText(
          join(this.batchDirectory(account, batchId), record.file),
          encodeChunk(chunks[record.kind])
        )
      }
      manifest.chunks.push(...records)
      manifest.scanPlaceholder = false
      await this.atomicWriteJson(this.manifestPath(account, batchId), manifest)
      return structuredClone(records)
    })
  }

  async finalizeBatch(accountMid: string, batchId: string): Promise<OldFavoriteBatchSummary> {
    const account = validAccountMid(accountMid)
    return this.queueWrite(async () => {
      const manifest = await this.loadManifest(account, batchId)
      const index = await this.requireIndex(account)
      const summaryIndex = index.batches.findIndex((item) => item.id === batchId)
      if (summaryIndex < 0) throw new Error('Old favorite batch index is missing.')
      const summary = index.batches[summaryIndex]

      if (manifest.status === 'archived') {
        const archivedSummary = {
          ...summary,
          status: 'archived' as const,
          finalizedAt: manifest.finalizedAt
        }
        if (summary.status === 'archived' && summary.finalizedAt === manifest.finalizedAt) {
          return structuredClone(archivedSummary)
        }
        const repairedIndex = {
          ...index,
          batches: index.batches.map((item, itemIndex) => itemIndex === summaryIndex ? archivedSummary : item)
        }
        await this.atomicWriteJson(this.indexPath(account), repairedIndex)
        index.batches.splice(summaryIndex, 1, archivedSummary)
        return structuredClone(archivedSummary)
      }

      const nextManifest = { ...manifest, status: 'archived' as const, finalizedAt: new Date().toISOString() }
      const nextSummary = { ...summary, status: nextManifest.status, finalizedAt: nextManifest.finalizedAt }
      const nextIndex = {
        ...index,
        batches: index.batches.map((item, itemIndex) => itemIndex === summaryIndex ? nextSummary : item)
      }
      await this.atomicWriteJson(this.manifestPath(account, batchId), nextManifest)
      this.manifests.set(this.batchKey(account, batchId), nextManifest)
      await this.atomicWriteJson(this.indexPath(account), nextIndex)
      index.batches.splice(summaryIndex, 1, nextSummary)
      return structuredClone(nextSummary)
    })
  }

  async patchOverlay(
    accountMid: string,
    batchId: string,
    kind: OldFavoriteOverlayKind,
    patch: OldFavoriteOverlayPatch | OldFavoriteOverlayPatch[]
  ) {
    const account = validAccountMid(accountMid)
    await this.queueWrite(async () => {
      const manifest = await this.loadManifest(account, batchId)
      if (manifest.status === 'archived') throw new Error('Old favorite batch is finalized.')
      const overlays = structuredClone(await this.loadOverlays(account, batchId))
      for (const value of Array.isArray(patch) ? patch : [patch]) {
        overlays[kind][String(value.aid)] = structuredClone(value)
      }
      await this.atomicWriteJson(this.overlayPath(account, batchId), overlays)
      this.overlayCache.set(this.batchKey(account, batchId), overlays)
    })
  }

  async loadBatch(accountMid: string, batchId: string): Promise<OldFavoriteBatchDetail> {
    const account = validAccountMid(accountMid)
    const manifest = await this.loadManifest(account, batchId)
    const detail: OldFavoriteBatchDetail = {
      summary: {
        id: manifest.id,
        storageKey: manifest.storageKey,
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
    return this.queueWrite(async () => {
      const manifest = await this.loadManifest(account, batchId)
      if (manifest.status === 'archived') return { discardedTail: null }
      const tail = manifest.chunks.at(-1)
      if (!tail) return { discardedTail: null }
      const records = tail.groupId
        ? manifest.chunks.filter((chunk) => chunk.groupId === tail.groupId)
        : [tail]
      const validity = await Promise.all(records.map(async (record) => {
        const value = await this.readText(join(this.batchDirectory(account, batchId), record.file))
        return value !== null && decodeChunk(value, record.checksum) !== null
      }))
      if (validity.every(Boolean)) return { discardedTail: null }
      await Promise.all(records.map((record) =>
        this.deletePath(join(this.batchDirectory(account, batchId), record.file))
      ))
      const discardedFiles = new Set(records.map((record) => record.file))
      const nextManifest = {
        ...manifest,
        chunks: manifest.chunks.filter((chunk) => !discardedFiles.has(chunk.file))
      }
      await this.atomicWriteJson(this.manifestPath(account, batchId), nextManifest)
      this.manifests.set(this.batchKey(account, batchId), nextManifest)
      return { discardedTail: tail.groupId ? records.map((record) => record.file) : tail.file }
    })
  }

  async resetAccount(accountMid: string) {
    const account = validAccountMid(accountMid)
    return this.queueWrite(async () => {
      const accountDirectory = join(this.options.root, 'accounts', account)
      const transactionId = randomUUID()
      const stagedDirectory = join(this.options.root, 'accounts', `.${account}.reset-${transactionId}`)
      const backupDirectory = join(this.options.root, 'accounts', `.${account}.reset-backup-${transactionId}`)
      let staged = false
      let backedUp = false
      try {
        try {
          await rename(accountDirectory, stagedDirectory)
          staged = true
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        if (staged) {
          await cp(stagedDirectory, backupDirectory, { recursive: true })
          backedUp = true
          await this.deletePath(stagedDirectory, true)
          staged = false
          await this.deletePath(backupDirectory, true)
          backedUp = false
        }
      } catch (error) {
        if (backedUp) {
          await this.deletePath(accountDirectory, true).catch(() => undefined)
          await cp(backupDirectory, accountDirectory, { recursive: true })
          await this.deletePath(backupDirectory, true).catch(() => undefined)
        } else if (staged) {
          await rename(stagedDirectory, accountDirectory).catch(() => undefined)
        }
        throw error
      }
      this.indexes.delete(account)
      for (const key of [...this.manifests.keys()]) if (key.startsWith(`${account}:`)) this.manifests.delete(key)
      for (const key of [...this.overlayCache.keys()]) if (key.startsWith(`${account}:`)) this.overlayCache.delete(key)
    })
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
    const summary = (await this.requireIndex(account)).batches.find((batch) => batch.id === batchId)
    if (!summary) throw new Error('Old favorite batch does not exist.')
    const manifest = await this.readJson<OldFavoriteBatchManifest>(
      join(this.accountDirectory(account), 'batches', summary.storageKey, 'manifest.json')
    )
    if (!manifest || manifest.version !== 2 || manifest.accountMid !== account || manifest.id !== batchId) {
      throw new Error('Old favorite batch does not exist.')
    }
    manifest.storageKey = summary.storageKey
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
  private batchDirectory(account: string, batchId: string) {
    const storageKey = this.indexes.get(account)?.batches.find((batch) => batch.id === batchId)?.storageKey
      ?? batchStorageKey(batchId)
    return join(this.accountDirectory(account), 'batches', storageKey)
  }
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

  private queueWrite<T>(work: () => Promise<T>): Promise<T> {
    const next = this.writeTail.then(work, work)
    this.writeTail = next.then(() => undefined, () => undefined)
    return next
  }
}
