import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

type ScanItem = {
  aid: number
  title?: string
  author?: string
  tags?: string[]
  tagEvidence?: 'confirmed'
  category?: string
  cover?: string
  addedAt?: number
  sourceFolderIds: string[]
  [key: string]: unknown
}
type Segment = { id: string; aids: number[]; items?: ScanItem[] }
type ScanPage = {
  runId: string
  folderId: string
  page: number
  items: ScanItem[]
  /** Stored with new pages so a resumed scan can stop at a known terminal page. */
  hasMore?: boolean
}
type StoredScanPage = Omit<ScanPage, 'runId'>
type ManagedMembers = { runId: string; members: Record<string, number[]> }
type SourceFolder = {
  id: string
  title: string
  itemCount: number
  isBilimiWorkFolder: boolean
  selected?: boolean
}
type Classification = { aid: number; targetLedgerIds: string[]; source: string }
type History = { kind: string; aids: number[] }
type Recommendation = {
  id: string
  displayName: string
  kind: 'author' | 'series' | 'tag'
  sourceName: string
  keywords: string[]
  count: number
  reason: string
}
type Overlay = {
  currentSegmentId: string
  classifications: Classification[]
  history: History[]
  recommendations?: {
    initialized?: boolean
    candidates?: Recommendation[]
    adoptedCandidateIds?: string[]
  }
  planReadiness?: { selectedAidCount: number; classifiedAidCount: number }
  scanMetadata?: {
    sourceFolders?: SourceFolder[]
    phase?: 'inventory' | 'failed' | 'complete'
    failureCount?: number
    mode?: 'incremental' | 'full'
    reason?: string
    totalItemCount?: number
    scannedItemCount?: number
    taggedItemCount?: number
    untaggedItemCount?: number
  }
  tagEnrichment?: {
    status: 'running' | 'paused' | 'accepted' | 'complete'
    totalItemCount: number
    completedItemCount: number
    pendingAids: number[]
    failedAids?: number[]
    reusedTagItemCount?: number
    taggedAids?: number[]
  }
  tagUpdates?: Array<{ aid: number; tags: string[] }>
}
type OverlayHistory = Pick<Overlay, 'currentSegmentId' | 'history'>
type Manifest = {
  version: 1
  workspaceId: string
  accountMid: string
  status: string
  baselineRevision: number
  currentSegmentId: string
  segments: Array<{ id: string; file: string; checksum: string }>
  scanRunId?: string
  scanPages?: Array<{ folderId: string; page: number; file: string; checksum: string }>
  managedMemberChunks?: Array<{ file: string; checksum: string }>
  sourceFolders?: SourceFolder[]
  scan?: { phase: 'inventory' | 'failed' | 'complete'; failureCount: number; mode: 'incremental' | 'full'; reason?: string; totalItemCount?: number; scannedItemCount?: number; taggedItemCount?: number; untaggedItemCount?: number }
  overlayRevision: number
  journalCursor: number
  journalChecksum: string
  /** Compact recovery state; do not load the journal or baseline chunks to show it. */
  planReadiness?: { selectedAidCount: number; classifiedAidCount: number }
  /** Durable witness that the matching local repository commit has succeeded. */
  lastCommittedId?: string
  /** Compact recovery comparison data; never requires reading baseline segments. */
  recoveryBaseline?: {
    aids: number[]
    aidFingerprint: string
    mirrorFingerprint: string
    bindingFingerprint: string
    metadataFingerprint: string
    rulesFingerprint: string
    keywordsFingerprint: string
    defaultSettingsFingerprint: string
    fingerprint: string
  }
  recoveryDecision?: {
    choice: 'continue-original' | 'merge-latest' | 'rescan'
    expectedBaselineRevision: number
    expectedRepositoryRevision: number
    evidenceFingerprint?: string
    /** Only derived system choices for these aids are recomputed after full recovery. */
    mergeLatestSystemAids?: number[]
    staleDeepSeekAids?: number[]
    mergeLatestAppliedAt?: string
    recordedAt: string
  }
  checksum: string
}

type RecoveryBaseline = NonNullable<Manifest['recoveryBaseline']>

const checksum = (content: string) => createHash('sha256').update(content).digest('hex')
const clone = <T>(value: T): T => structuredClone(value)

function normalizeRecoveryBaseline(value: Manifest['recoveryBaseline']): RecoveryBaseline | undefined {
  if (!value) return undefined
  return {
    ...value,
    metadataFingerprint: value.metadataFingerprint ?? 'null',
    rulesFingerprint: value.rulesFingerprint ?? 'null',
    keywordsFingerprint: value.keywordsFingerprint ?? 'null',
    defaultSettingsFingerprint: value.defaultSettingsFingerprint ?? 'null'
  }
}

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
      segments, scanPages: [], sourceFolders: input.sourceFolders?.map(clone) ?? [],
      scan: { phase: 'inventory', failureCount: 0, mode: 'incremental' },
      overlayRevision: 0, journalCursor: 0, journalChecksum
    }
    await this.writeManifest(directory, withoutChecksum)
    this.writeLog.set(this.key(accountMid, input.workspaceId), [])
    this.readLog.set(this.key(accountMid, input.workspaceId), [])
  }

  async appendOverlay(accountMid: string, workspaceId: string, overlay: Overlay) {
    return this.queue(() => this.appendOverlayUnsafe(accountMid, workspaceId, overlay))
  }

  async startScanRun(accountMid: string, workspaceId: string, runId: string) {
    return this.queue(async () => {
      const account = normalizedAccountMid(accountMid)
      if (!/^[a-zA-Z0-9_-]{8,128}$/.test(runId)) throw new Error('Old favorite workspace scan run is invalid.')
      const directory = this.workspaceDirectory(account, workspaceId)
      const manifest = await this.readManifest(directory)
      if (!manifest || manifest.accountMid !== account) throw new Error('Old favorite workspace was not found.')
      const { checksum: _storedChecksum, ...manifestWithoutChecksum } = manifest
      await this.writeManifest(directory, {
        ...manifestWithoutChecksum,
        scanRunId: runId,
        scanPages: [],
        managedMemberChunks: []
      })
      this.writeLog.set(this.key(account, workspaceId), ['manifest.json'])
    })
  }

  /** Stores one remote page outside immutable baseline chunks until scan finalization. */
  async appendScanPage(accountMid: string, workspaceId: string, input: ScanPage) {
    return this.queue(async () => {
      const account = normalizedAccountMid(accountMid)
      if (!/^[a-zA-Z0-9_-]{8,128}$/.test(input.runId) || typeof input.folderId !== 'string' || !input.folderId.trim() || !Number.isSafeInteger(input.page) || input.page < 1 ||
        !Array.isArray(input.items) || input.items.length > 50 || input.items.some((item) => !Number.isSafeInteger(item.aid) || item.aid <= 0)) {
        throw new Error('Old favorite workspace scan page is invalid.')
      }
      const directory = this.workspaceDirectory(account, workspaceId)
      const manifest = await this.readManifest(directory)
      if (!manifest || manifest.accountMid !== account) throw new Error('Old favorite workspace was not found.')
      if (manifest.scanRunId !== input.runId) throw new Error('Old favorite workspace scan run is stale.')
      const folderId = input.folderId.trim()
      const content = JSON.stringify({ runId: input.runId, folderId, page: input.page, items: input.items.map(clone),
        ...(typeof input.hasMore === 'boolean' ? { hasMore: input.hasMore } : {}) })
      const file = `scan/pages/${checksum(`${input.runId}:${folderId}:${input.page}:${content}`)}.json`
      await this.atomicWrite(join(directory, file), content)
      const scanPages = (manifest.scanPages ?? []).filter((page) => page.folderId !== folderId || page.page !== input.page)
      scanPages.push({ folderId, page: input.page, file, checksum: checksum(content) })
      scanPages.sort((left, right) => left.folderId.localeCompare(right.folderId) || left.page - right.page)
      const { checksum: _storedChecksum, ...manifestWithoutChecksum } = manifest
      await this.writeManifest(directory, { ...manifestWithoutChecksum, scanPages })
      this.writeLog.set(this.key(account, workspaceId), ['manifest.json', file])
    })
  }

  async readScanPages(accountMid: string, workspaceId: string): Promise<StoredScanPage[]> {
    const account = normalizedAccountMid(accountMid)
    const directory = this.workspaceDirectory(account, workspaceId)
    const manifest = await this.readManifest(directory)
    if (!manifest || manifest.accountMid !== account) throw new Error('Old favorite workspace was not found.')
    const pages: StoredScanPage[] = []
    for (const page of manifest.scanPages ?? []) {
      const content = await readFile(join(directory, page.file), 'utf8')
      if (checksum(content) !== page.checksum) throw new Error('Old favorite workspace scan page is corrupt.')
      const value = JSON.parse(content) as ScanPage
      if (value.runId !== manifest.scanRunId || value.folderId !== page.folderId || value.page !== page.page || !Array.isArray(value.items)) {
        throw new Error('Old favorite workspace scan page is invalid.')
      }
      pages.push({ folderId: value.folderId, page: value.page, items: value.items.map(clone),
        ...(typeof value.hasMore === 'boolean' ? { hasMore: value.hasMore } : {}) })
    }
    return pages
  }

  async visitScanPages(accountMid: string, workspaceId: string, visit: (page: ScanPage) => Promise<void> | void) {
    const account = normalizedAccountMid(accountMid)
    const directory = this.workspaceDirectory(account, workspaceId)
    const manifest = await this.readManifest(directory)
    if (!manifest || manifest.accountMid !== account) throw new Error('Old favorite workspace was not found.')
    for (const page of manifest.scanPages ?? []) {
      const content = await readFile(join(directory, page.file), 'utf8')
      if (checksum(content) !== page.checksum) throw new Error('Old favorite workspace scan page is corrupt.')
      const value = JSON.parse(content) as ScanPage
      if (value.runId !== manifest.scanRunId || value.folderId !== page.folderId || value.page !== page.page || !Array.isArray(value.items)) {
        throw new Error('Old favorite workspace scan page is invalid.')
      }
      await visit({ runId: value.runId, folderId: value.folderId, page: value.page, items: value.items.map(clone),
        ...(typeof value.hasMore === 'boolean' ? { hasMore: value.hasMore } : {}) })
    }
  }

  async appendManagedMembers(accountMid: string, workspaceId: string, input: ManagedMembers) {
    return this.queue(async () => {
      const account = normalizedAccountMid(accountMid)
      if (!/^[a-zA-Z0-9_-]{8,128}$/.test(input.runId) || !input.members || typeof input.members !== 'object' || Array.isArray(input.members)) {
        throw new Error('Old favorite workspace managed members are invalid.')
      }
      const directory = this.workspaceDirectory(account, workspaceId)
      const manifest = await this.readManifest(directory)
      if (!manifest || manifest.accountMid !== account) throw new Error('Old favorite workspace was not found.')
      if (manifest.scanRunId !== input.runId) throw new Error('Old favorite workspace scan run is stale.')
      const members = Object.fromEntries(Object.entries(input.members).map(([folderId, aids]) => [
        folderId,
        [...new Set(aids.filter((aid) => Number.isSafeInteger(aid) && aid > 0))].sort((left, right) => left - right)
      ]))
      const content = JSON.stringify({ runId: input.runId, members })
      const file = `scan/members/${checksum(content)}.json`
      await this.atomicWrite(join(directory, file), content)
      const chunks = [...(manifest.managedMemberChunks ?? []), { file, checksum: checksum(content) }]
      const { checksum: _storedChecksum, ...manifestWithoutChecksum } = manifest
      await this.writeManifest(directory, { ...manifestWithoutChecksum, managedMemberChunks: chunks })
      this.writeLog.set(this.key(account, workspaceId), ['manifest.json', file])
    })
  }

  async readManagedMemberAids(accountMid: string, workspaceId: string) {
    const members = await this.readManagedMembers(accountMid, workspaceId)
    return [...new Set(Object.values(members).flat())].sort((left, right) => left - right)
  }

  async readManagedMembers(accountMid: string, workspaceId: string) {
    const account = normalizedAccountMid(accountMid)
    const directory = this.workspaceDirectory(account, workspaceId)
    const manifest = await this.readManifest(directory)
    if (!manifest || manifest.accountMid !== account) throw new Error('Old favorite workspace was not found.')
    const membersByFolderId: Record<string, number[]> = {}
    for (const chunk of manifest.managedMemberChunks ?? []) {
      const content = await readFile(join(directory, chunk.file), 'utf8')
      if (checksum(content) !== chunk.checksum) throw new Error('Old favorite workspace managed members are corrupt.')
      const value = JSON.parse(content) as ManagedMembers
      if (value.runId !== manifest.scanRunId || !value.members || typeof value.members !== 'object') {
        throw new Error('Old favorite workspace managed members are invalid.')
      }
      for (const [folderId, aids] of Object.entries(value.members)) {
        membersByFolderId[folderId] = [...new Set([...(membersByFolderId[folderId] ?? []), ...aids])]
          .filter((aid) => Number.isSafeInteger(aid) && aid > 0)
          .sort((left, right) => left - right)
      }
    }
    return membersByFolderId
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
      journalChecksum: checksum(journal.toString('utf8')),
      ...(overlay.planReadiness ? { planReadiness: clone(overlay.planReadiness) } : {})
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
      let recommendations: { initialized: boolean; candidates: Recommendation[]; adoptedCandidateIds: string[] } = {
        initialized: false, candidates: [], adoptedCandidateIds: []
      }
      let scan = clone(manifest.scan ?? { phase: 'inventory' as const, failureCount: 0, mode: 'incremental' as const })
      let tagEnrichment: Overlay['tagEnrichment'] | undefined
      const tagUpdates = new Map<number, string[]>()
      let planReadiness = { selectedAidCount: 0, classifiedAidCount: 0 }
      for (const line of committedJournal.split('\n').filter(Boolean)) {
        const overlay = JSON.parse(line) as Overlay
        for (const item of overlay.classifications) classifications[String(item.aid)] = clone(item)
        history.push(...overlay.history.map(clone))
        if (overlay.recommendations?.candidates) {
          recommendations.candidates = overlay.recommendations.candidates.map(clone)
        }
        if (overlay.recommendations?.initialized) recommendations.initialized = true
        if (overlay.recommendations?.adoptedCandidateIds) {
          recommendations.adoptedCandidateIds = [...new Set(overlay.recommendations.adoptedCandidateIds)]
        }
        if (overlay.planReadiness) planReadiness = clone(overlay.planReadiness)
        if (overlay.scanMetadata?.sourceFolders) sourceFolders = overlay.scanMetadata.sourceFolders.map(clone)
        if (overlay.scanMetadata?.phase) {
          scan = {
            phase: overlay.scanMetadata.phase,
            failureCount: overlay.scanMetadata.failureCount ?? scan.failureCount,
            mode: overlay.scanMetadata.mode ?? scan.mode,
            ...(overlay.scanMetadata.reason ? { reason: overlay.scanMetadata.reason } : {})
            ,...(Number.isSafeInteger(overlay.scanMetadata.totalItemCount) ? { totalItemCount: overlay.scanMetadata.totalItemCount } : {})
            ,...(Number.isSafeInteger(overlay.scanMetadata.scannedItemCount) ? { scannedItemCount: overlay.scanMetadata.scannedItemCount } : {})
            ,...(Number.isSafeInteger(overlay.scanMetadata.taggedItemCount) ? { taggedItemCount: overlay.scanMetadata.taggedItemCount } : {})
            ,...(Number.isSafeInteger(overlay.scanMetadata.untaggedItemCount) ? { untaggedItemCount: overlay.scanMetadata.untaggedItemCount } : {})
          }
        }
        if (overlay.tagEnrichment) {
          tagEnrichment = {
            ...clone(overlay.tagEnrichment),
            completedItemCount: Number.isSafeInteger(overlay.tagEnrichment.completedItemCount)
              ? overlay.tagEnrichment.completedItemCount
              : Math.max(0, overlay.tagEnrichment.totalItemCount - overlay.tagEnrichment.pendingAids.length),
            failedAids: [...new Set(overlay.tagEnrichment.failedAids ?? [])],
            reusedTagItemCount: overlay.tagEnrichment.reusedTagItemCount ?? 0,
            taggedAids: [...new Set(overlay.tagEnrichment.taggedAids ?? [])]
          }
        }
        for (const update of overlay.tagUpdates ?? []) tagUpdates.set(update.aid, [...update.tags])
      }
      return {
        workspaceId: manifest.workspaceId, accountMid: manifest.accountMid, status: manifest.status,
        baselineRevision: manifest.baselineRevision, currentSegmentId: manifest.currentSegmentId,
        ...(manifest.scanRunId ? { scanRunId: manifest.scanRunId } : {}),
        overlayRevision: manifest.overlayRevision, journalCursor: manifest.journalCursor,
        manifestChecksum: manifest.checksum,
        ...(manifest.lastCommittedId ? { lastCommittedId: manifest.lastCommittedId } : {}),
        ...(normalizeRecoveryBaseline(manifest.recoveryBaseline) ? { recoveryBaseline: clone(normalizeRecoveryBaseline(manifest.recoveryBaseline)!) } : {}),
        ...(manifest.recoveryDecision ? { recoveryDecision: clone(manifest.recoveryDecision) } : {}),
        loadedSegmentAids: [...loadedSegment.aids],
        loadedSegmentItems: (loadedSegment.items ?? []).map(clone),
        sourceFolders,
        scan,
        classifications, history, recommendations, planReadiness
        ,tagEnrichment, tagUpdates: [...tagUpdates.entries()].map(([aid, tags]) => ({ aid, tags }))
      }
    } catch {
      return { recovery: 'rebuild-required', preserveCompletedLocalResults: true }
    }
  }

  async setRecoveryBaseline(accountMid: string, workspaceId: string, baseline: {
    aids: number[]; aidFingerprint: string; mirrorFingerprint: string; bindingFingerprint: string
    metadataFingerprint: string; rulesFingerprint: string; keywordsFingerprint: string; defaultSettingsFingerprint: string; fingerprint: string
  }) {
    return this.queue(async () => {
      const account = normalizedAccountMid(accountMid)
      const directory = this.workspaceDirectory(account, workspaceId)
      const manifest = await this.readManifest(directory)
      if (!manifest || manifest.accountMid !== account) throw new Error('Old favorite workspace was not found.')
      const { checksum: _storedChecksum, ...withoutChecksum } = manifest
      await this.writeManifest(directory, { ...withoutChecksum, recoveryBaseline: clone(baseline) })
      this.writeLog.set(this.key(account, workspaceId), ['manifest.json'])
    })
  }

  async setRecoveryDecision(accountMid: string, workspaceId: string, decision: NonNullable<Manifest['recoveryDecision']>) {
    return this.queue(async () => {
      const account = normalizedAccountMid(accountMid)
      const directory = this.workspaceDirectory(account, workspaceId)
      const manifest = await this.readManifest(directory)
      if (!manifest || manifest.accountMid !== account) throw new Error('Old favorite workspace was not found.')
      const { checksum: _storedChecksum, ...withoutChecksum } = manifest
      await this.writeManifest(directory, { ...withoutChecksum, recoveryDecision: clone(decision) })
      this.writeLog.set(this.key(account, workspaceId), ['manifest.json'])
    })
  }

  /** Reads only the integrity-checked marker needed to offer a recovery action. */
  async readRecoverySummary(accountMid: string, workspaceId: string) {
    const account = normalizedAccountMid(accountMid)
    const directory = this.workspaceDirectory(account, workspaceId)
    const manifest = await this.readManifest(directory)
    if (!manifest || manifest.accountMid !== account) {
      return { recovery: 'rebuild-required' as const, preserveCompletedLocalResults: true }
    }
    return {
      workspaceId: manifest.workspaceId,
      accountMid: manifest.accountMid,
      status: manifest.status,
      baselineRevision: manifest.baselineRevision,
      currentSegmentId: manifest.currentSegmentId,
      segmentCount: manifest.segments.length,
      scanPageCount: manifest.scanPages?.length ?? 0,
      overlayRevision: manifest.overlayRevision,
      journalCursor: manifest.journalCursor,
      manifestChecksum: manifest.checksum,
      ...(manifest.planReadiness ? {
        plannedCount: manifest.planReadiness.selectedAidCount,
        classifiedCount: manifest.planReadiness.classifiedAidCount,
        unclassifiedCount: Math.max(0, manifest.planReadiness.selectedAidCount - manifest.planReadiness.classifiedAidCount)
      } : {}),
      ...(manifest.lastCommittedId ? { lastCommittedId: manifest.lastCommittedId } : {})
      ,...(normalizeRecoveryBaseline(manifest.recoveryBaseline) ? { recoveryBaseline: clone(normalizeRecoveryBaseline(manifest.recoveryBaseline)!) } : {})
      ,...(manifest.recoveryDecision ? { recoveryDecision: clone(manifest.recoveryDecision) } : {})
    }
  }

  /**
   * Records the second half of a local commit after the repository has already
   * accepted its idempotent command. Repeating it is a no-op, so restart
   * recovery can repair an interrupted boundary without re-applying data.
   */
  async markCommitted(accountMid: string, workspaceId: string, commitId: string) {
    return this.queue(async () => {
      const account = normalizedAccountMid(accountMid)
      const normalizedCommitId = commitId.trim()
      if (!normalizedCommitId) throw new Error('Old favorite workspace commit is invalid.')
      const directory = this.workspaceDirectory(account, workspaceId)
      const manifest = await this.readManifest(directory)
      if (!manifest || manifest.accountMid !== account) throw new Error('Old favorite workspace was not found.')
      if (manifest.status === 'completed' && manifest.lastCommittedId === normalizedCommitId) return
      const { checksum: _storedChecksum, ...withoutChecksum } = manifest
      await this.writeManifest(directory, {
        ...withoutChecksum,
        status: 'completed',
        lastCommittedId: normalizedCommitId
      })
      this.writeLog.set(this.key(account, workspaceId), ['manifest.json'])
    })
  }

  /** Lets application shutdown wait for the serialized journal/manifest boundary. */
  async flush() {
    await this.operationTail
  }

  async loadSegment(accountMid: string, workspaceId: string, segmentId: string): Promise<Segment> {
    const account = normalizedAccountMid(accountMid)
    const directory = this.workspaceDirectory(account, workspaceId)
    const manifest = await this.readManifest(directory)
    const segment = manifest?.segments.find((candidate) => candidate.id === segmentId)
    if (!segment) throw new Error('Old favorite workspace segment was not found.')
    return this.readSegment(directory, segment)
  }

  /** Reads committed delta commands for freeze compilation without loading baseline chunks. */
  async readOverlayHistory(accountMid: string, workspaceId: string): Promise<OverlayHistory[]> {
    const account = normalizedAccountMid(accountMid)
    const directory = this.workspaceDirectory(account, workspaceId)
    const manifest = await this.readManifest(directory)
    if (!manifest || manifest.accountMid !== account) throw new Error('Old favorite workspace was not found.')
    const journalPath = join(directory, 'overlay.journal.jsonl')
    let journal = Buffer.alloc(0)
    try {
      journal = await readFile(journalPath)
      this.recordRead(directory, 'overlay.journal.jsonl')
    } catch {
      if (manifest.journalCursor > 0) throw new Error('Old favorite workspace journal is corrupt.')
      return []
    }
    if (journal.byteLength < manifest.journalCursor) throw new Error('Old favorite workspace journal is corrupt.')
    const committed = journal.subarray(0, manifest.journalCursor).toString('utf8')
    if (checksum(committed) !== manifest.journalChecksum) throw new Error('Old favorite workspace journal is corrupt.')
    return committed.split('\n').filter(Boolean).map((line) => {
      const overlay = JSON.parse(line) as Overlay
      if (typeof overlay.currentSegmentId !== 'string' || !Array.isArray(overlay.history)) {
        throw new Error('Old favorite workspace journal is invalid.')
      }
      return { currentSegmentId: overlay.currentSegmentId, history: overlay.history.map(clone) }
    })
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
      return value.version === 1 && storedChecksum === checksum(canonicalManifest(withoutChecksum)) ? value : null
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
