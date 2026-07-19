import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

type ScanItem = {
  aid: number
  title?: string
  author?: string
  sourceFolderIds: string[]
  [key: string]: unknown
}
type Segment = { id: string; aids: number[]; items?: ScanItem[] }
type SourceFolder = {
  id: string
  title: string
  itemCount: number
  isBilimiWorkFolder: boolean
}
type Classification = { aid: number; targetLedgerIds: string[]; source: string }
type History = { kind: string; aids: number[] }
type Overlay = {
  currentSegmentId: string
  classifications: Classification[]
  history: History[]
  scanMetadata?: { sourceFolders?: SourceFolder[] }
}
type Manifest = {
  version: 1
  workspaceId: string
  accountMid: string
  status: string
  baselineRevision: number
  currentSegmentId: string
  segments: Array<{ id: string; file: string; checksum: string }>
  sourceFolders?: SourceFolder[]
  overlayRevision: number
  journalCursor: number
  journalChecksum: string
  checksum: string
}

const checksum = (content: string) => createHash('sha256').update(content).digest('hex')
const clone = <T>(value: T): T => structuredClone(value)

function canonicalManifest(manifest: Omit<Manifest, 'checksum'>) {
  return JSON.stringify(manifest)
}

function normalizedAccountMid(value: string) {
  const raw = value.trim()
  if (!/^\d+$/.test(raw) || BigInt(raw) === 0n) throw new Error('Old favorite workspace account is invalid.')
  return BigInt(raw).toString()
}

export class OldFavoriteWorkspaceStore {
  private readonly writeLog = new Map<string, string[]>()
  private readonly readLog = new Map<string, string[]>()
  private operationTail = Promise.resolve()

  constructor(private readonly options: { root: string }) {}

  async create(input: {
    accountMid: string
    workspaceId: string
    status: string
    baselineRevision: number
    currentSegmentId: string
    segments: Segment[]
    sourceFolders?: SourceFolder[]
  }) {
    const accountMid = normalizedAccountMid(input.accountMid)
    const directory = this.workspaceDirectory(accountMid, input.workspaceId)
    await mkdir(join(directory, 'baseline'), { recursive: true })
    const segments = [] as Manifest['segments']
    for (const segment of input.segments) {
      const items = segment.items?.map(clone) ?? segment.aids.map((aid) => ({ aid, sourceFolderIds: [] }))
      const content = JSON.stringify({ id: segment.id, aids: [...segment.aids], items })
      const file = `baseline/${segment.id}.json`
      await this.atomicWrite(join(directory, file), content)
      segments.push({ id: segment.id, file, checksum: checksum(content) })
    }
    const journalChecksum = checksum('')
    const withoutChecksum: Omit<Manifest, 'checksum'> = {
      version: 1, workspaceId: input.workspaceId, accountMid, status: input.status,
      baselineRevision: input.baselineRevision, currentSegmentId: input.currentSegmentId,
      segments, sourceFolders: input.sourceFolders?.map(clone) ?? [],
      overlayRevision: 0, journalCursor: 0, journalChecksum
    }
    await this.writeManifest(directory, withoutChecksum)
    this.writeLog.set(this.key(accountMid, input.workspaceId), [])
    this.readLog.set(this.key(accountMid, input.workspaceId), [])
  }

  async appendOverlay(accountMid: string, workspaceId: string, overlay: Overlay) {
    return this.queue(() => this.appendOverlayUnsafe(accountMid, workspaceId, overlay))
  }

  private async appendOverlayUnsafe(accountMid: string, workspaceId: string, overlay: Overlay) {
    const account = normalizedAccountMid(accountMid)
    const directory = this.workspaceDirectory(account, workspaceId)
    const manifest = await this.readManifest(directory)
    if (!manifest || manifest.accountMid !== account) throw new Error('Old favorite workspace was not found.')
    const journalPath = join(directory, 'overlay.journal.jsonl')
    const line = `${JSON.stringify(overlay)}\n`
    await appendFile(journalPath, line, 'utf8')
    const journal = await readFile(journalPath)
    const { checksum: _storedChecksum, ...manifestWithoutChecksum } = manifest
    const next: Omit<Manifest, 'checksum'> = {
      ...manifestWithoutChecksum,
      currentSegmentId: overlay.currentSegmentId,
      overlayRevision: manifest.overlayRevision + 1,
      journalCursor: journal.byteLength,
      journalChecksum: checksum(journal.toString('utf8'))
    }
    await this.writeManifest(directory, next)
    this.writeLog.set(this.key(account, workspaceId), ['manifest.json', 'overlay.journal.jsonl'])
  }

  async recover(accountMid: string, workspaceId: string) {
    const account = normalizedAccountMid(accountMid)
    const directory = this.workspaceDirectory(account, workspaceId)
    const manifest = await this.readManifest(directory)
    if (!manifest || manifest.accountMid !== account) return { recovery: 'rebuild-required', preserveCompletedLocalResults: true }
    try {
      const currentSegment = manifest.segments.find((segment) => segment.id === manifest.currentSegmentId)
      const loadedSegment = currentSegment
        ? await this.readSegment(directory, currentSegment)
        : { id: '', aids: [] as number[], items: [] as ScanItem[] }
      const journalPath = join(directory, 'overlay.journal.jsonl')
      let journal = Buffer.alloc(0)
      try {
        journal = await readFile(journalPath)
        this.recordRead(directory, 'overlay.journal.jsonl')
      } catch { journal = Buffer.alloc(0) }
      if (journal.byteLength < manifest.journalCursor) throw new Error('journal cursor exceeds content')
      const committedJournal = journal.subarray(0, manifest.journalCursor).toString('utf8')
      if (checksum(committedJournal) !== manifest.journalChecksum) throw new Error('journal checksum mismatch')
      const classifications: Record<string, Classification> = {}
      const history: History[] = []
      let sourceFolders = manifest.sourceFolders?.map(clone) ?? []
      for (const line of committedJournal.split('\n').filter(Boolean)) {
        const overlay = JSON.parse(line) as Overlay
        for (const item of overlay.classifications) classifications[String(item.aid)] = clone(item)
        history.push(...overlay.history.map(clone))
        if (overlay.scanMetadata?.sourceFolders) sourceFolders = overlay.scanMetadata.sourceFolders.map(clone)
      }
      return {
        workspaceId: manifest.workspaceId, accountMid: manifest.accountMid, status: manifest.status,
        baselineRevision: manifest.baselineRevision, currentSegmentId: manifest.currentSegmentId,
        overlayRevision: manifest.overlayRevision, journalCursor: manifest.journalCursor,
        manifestChecksum: manifest.checksum,
        loadedSegmentAids: [...loadedSegment.aids],
        loadedSegmentItems: (loadedSegment.items ?? []).map(clone),
        sourceFolders,
        classifications, history
      }
    } catch {
      return { recovery: 'rebuild-required', preserveCompletedLocalResults: true }
    }
  }

  async loadSegment(accountMid: string, workspaceId: string, segmentId: string): Promise<Segment> {
    const account = normalizedAccountMid(accountMid)
    const directory = this.workspaceDirectory(account, workspaceId)
    const manifest = await this.readManifest(directory)
    const segment = manifest?.segments.find((candidate) => candidate.id === segmentId)
    if (!segment) throw new Error('Old favorite workspace segment was not found.')
    return this.readSegment(directory, segment)
  }

  async readWorkspaceWrites(accountMid: string, workspaceId: string) {
    return [...(this.writeLog.get(this.key(normalizedAccountMid(accountMid), workspaceId)) ?? [])]
  }

  async readWorkspaceReads(accountMid: string, workspaceId: string) {
    return [...(this.readLog.get(this.key(normalizedAccountMid(accountMid), workspaceId)) ?? [])]
  }

  async corruptOverlayForTest(accountMid: string, workspaceId: string) {
    await writeFile(join(this.workspaceDirectory(normalizedAccountMid(accountMid), workspaceId), 'overlay.journal.jsonl'), '{broken', 'utf8')
  }

  async appendUncommittedOverlayForTest(accountMid: string, workspaceId: string, overlay: Overlay) {
    await appendFile(
      join(this.workspaceDirectory(normalizedAccountMid(accountMid), workspaceId), 'overlay.journal.jsonl'),
      `${JSON.stringify(overlay)}\n`,
      'utf8'
    )
  }

  private async readManifest(directory: string): Promise<Manifest | null> {
    try {
      const manifestPath = join(directory, 'manifest.json')
      const value = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest
      this.recordRead(directory, 'manifest.json')
      const { checksum: storedChecksum, ...withoutChecksum } = value
      return storedChecksum === checksum(canonicalManifest(withoutChecksum)) ? value : null
    } catch { return null }
  }

  private async readSegment(directory: string, segment: Manifest['segments'][number]): Promise<Segment> {
    const content = await readFile(join(directory, segment.file), 'utf8')
    this.recordRead(directory, segment.file)
    if (checksum(content) !== segment.checksum) throw new Error('Old favorite workspace segment is corrupt.')
    return JSON.parse(content) as Segment
  }

  private recordRead(directory: string, file: string) {
    const match = /accounts[\\/]([^\\/]+)[\\/]workspaces[\\/]([^\\/]+)$/.exec(directory)
    if (!match) return
    const key = this.key(match[1], match[2])
    this.readLog.set(key, [...(this.readLog.get(key) ?? []), file])
  }

  private async writeManifest(directory: string, input: Omit<Manifest, 'checksum'>) {
    const content = canonicalManifest(input)
    await this.atomicWrite(join(directory, 'manifest.json'), JSON.stringify({ ...input, checksum: checksum(content) }))
  }

  private async atomicWrite(path: string, content: string) {
    const temporary = `${path}.${randomUUID()}.tmp`
    await mkdir(dirname(path), { recursive: true })
    await writeFile(temporary, content, 'utf8')
    await rename(temporary, path)
  }

  private workspaceDirectory(accountMid: string, workspaceId: string) {
    return join(this.options.root, 'accounts', accountMid, 'workspaces', workspaceId)
  }

  private key(accountMid: string, workspaceId: string) { return `${accountMid}:${workspaceId}` }

  private queue<T>(operation: () => Promise<T>) {
    const run = this.operationTail.then(operation, operation)
    this.operationTail = run.then(() => undefined, () => undefined)
    return run
  }
}
