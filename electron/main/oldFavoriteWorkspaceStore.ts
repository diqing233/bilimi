import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, rename, truncate, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  isValidOldFavoriteWorkspaceSegmentSize,
  oldFavoriteFolderIsScanEligible,
  oldFavoriteRemoteRelationship,
  type OldFavoriteInventoryMetricProjection,
  type OldFavoriteWorkspaceLocalWorkspaceFolder,
  type OldFavoriteWorkspaceDeepSeekRunCheckpoint,
  type OldFavoriteWorkspaceExecutionIntent,
  type OldFavoriteWorkspaceTagAdoption
} from '../../src/shared/oldFavoriteWorkspace'

type ScanItem = {
  aid: number
  title?: string
  author?: string
  description?: string
  tags?: string[]
  tagEvidence?: 'confirmed'
  category?: string
  cover?: string
  addedAt?: number
  unavailable?: boolean
  sourceFolderIds: string[]
  [key: string]: unknown
}
type Segment = { id: string; aids: number[]; items?: ScanItem[] }
type StreamingScanState = {
  segmentSize: number
  sealedSegments: Array<{ id: string; index: number; itemCount: number; aids: number[] }>
  openAids: number[]
  openItems?: ScanItem[]
  observedAids: number[]
  taggedAids?: number[]
}
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
  invalidItemCount?: number
  isBilimiWorkFolder: boolean
  remoteRelationship?: 'none' | 'bound' | 'reconcile-required'
  scanEligible?: boolean
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
  matchedAidsBySegment?: Record<string, number[]>
  reason: string
}
type RuleAnalysisCheckpoint = {
  fingerprint: string
  ledgerId: string
  completedSegmentIds: string[]
  completedItemCount: number
  totalItemCount: number
  matchedAidsBySegment: Record<string, number[]>
}
type OverviewSegmentSummary = {
  id: string
  aids?: number[]
  firstAid?: number
  lastAid?: number
  sourceFolderCounts: Record<string, number>
  selectedItemCount?: number
}
type TagEnrichmentDelta =
  | { kind: 'tagged'; aid: number; tags: string[]; segmentId?: string; tagChanged?: boolean; unacceptedSegmentId?: string }
  | { kind: 'failed'; aid: number }
  | { kind: 'retry-failed' }
  | { kind: 'accept-segment'; segmentId: string; acceptedTagVersion?: number; status?: 'running' | 'paused' | 'accepted' | 'complete' }
  | { kind: 'resume-segment'; segmentId: string; requeuedAids?: number[]; status?: 'running' | 'paused' | 'accepted' | 'complete' }
  | { kind: 'status'; status: 'running' | 'paused' | 'accepted' | 'complete' }
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
    localWorkspaceFolders?: OldFavoriteWorkspaceLocalWorkspaceFolder[]
    phase?: 'inventory' | 'failed' | 'complete'
    failureCount?: number
    paused?: boolean
    mode?: 'incremental' | 'full'
    reason?: string
    retryAvailableAt?: string
    totalItemCount?: number
    scannedItemCount?: number
    taggedItemCount?: number
    untaggedItemCount?: number
    inventoryMetrics?: OldFavoriteInventoryMetricProjection
  }
  tagEnrichment?: {
    status: 'running' | 'paused' | 'accepted' | 'complete'
    totalItemCount: number
    completedItemCount: number
    pendingAids: number[]
    failedAids?: number[]
    reusedTagItemCount?: number
    taggedAids?: number[]
    confirmedUntaggedAids?: number[]
    acceptedSegmentIds?: string[]
    tagVersionsBySegment?: Record<string, number>
    acceptedTagVersionsBySegment?: Record<string, number>
  }
  tagAdoption?: OldFavoriteWorkspaceTagAdoption | null
  tagUpdates?: Array<{ aid: number; tags: string[] }>
  tagEnrichmentDelta?: TagEnrichmentDelta
  ruleAnalysisCheckpoint?: RuleAnalysisCheckpoint | null
  deepSeekRunCheckpoint?: OldFavoriteWorkspaceDeepSeekRunCheckpoint | null
  executionIntent?: OldFavoriteWorkspaceExecutionIntent | null
  overview?: { segments: OverviewSegmentSummary[]; unavailableItemCount: number }
}

function normalizeTagVersions(value: Record<string, number> | undefined) {
  return Object.fromEntries(Object.entries(value ?? {}).flatMap(([segmentId, version]) =>
    segmentId && Number.isSafeInteger(version) && version >= 0 ? [[segmentId, version]] : []
  )) as Record<string, number>
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
  scanPages?: Array<{ folderId: string; page: number; file: string; checksum: string; hasMore?: boolean }>
  managedMemberChunks?: Array<{ file: string; checksum: string }>
  streamingScan?: StreamingScanState
  sourceFolders?: SourceFolder[]
  scan?: { phase: 'inventory' | 'failed' | 'complete'; failureCount: number; mode: 'incremental' | 'full'; paused?: boolean; reason?: string; retryAvailableAt?: string; totalItemCount?: number; scannedItemCount?: number; taggedItemCount?: number; untaggedItemCount?: number }
  overlayRevision: number
  journalCursor: number
  journalChecksum: string
  journalChecksumMode?: 'chain-sha256-v1'
  journalFile?: string
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

function normalizeSourceFolders(sourceFolders: SourceFolder[]) {
  return sourceFolders.map((folder) => ({
    ...folder,
    remoteRelationship: oldFavoriteRemoteRelationship(folder),
    scanEligible: oldFavoriteFolderIsScanEligible(folder)
  }))
}
const clone = <T>(value: T): T => structuredClone(value)
const emptyJournalChecksum = checksum('')
const advanceJournalChecksum = (prior: string, line: string) => checksum(`${prior}\n${line}`)

function chainedJournalChecksum(content: string) {
  let result = emptyJournalChecksum
  let offset = 0
  while (offset < content.length) {
    const newline = content.indexOf('\n', offset)
    if (newline < 0) throw new Error('Old favorite workspace journal is corrupt.')
    const line = content.slice(offset, newline + 1)
    result = advanceJournalChecksum(result, line)
    offset = newline + 1
  }
  return result
}

function journalChecksum(content: string, mode: Manifest['journalChecksumMode']) {
  return mode === 'chain-sha256-v1' ? chainedJournalChecksum(content) : checksum(content)
}

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
  private readonly verifiedJournals = new Map<string, { cursor: number; checksum: string; file: string }>()

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
    const priorManifest = await this.readManifest(directory)
    const segments = [] as Manifest['segments']
    for (const segment of input.segments) {
      const items = segment.items?.map(clone) ?? segment.aids.map((aid) => ({ aid, sourceFolderIds: [] }))
      const content = JSON.stringify({ id: segment.id, aids: [...segment.aids], items })
      const contentChecksum = checksum(content)
      const file = priorManifest
        ? `baseline/${segment.id}-${contentChecksum}.json`
        : `baseline/${segment.id}.json`
      await this.atomicWrite(join(directory, file), content)
      segments.push({ id: segment.id, file, checksum: contentChecksum })
    }
    const initialJournalChecksum = emptyJournalChecksum
    const withoutChecksum: Omit<Manifest, 'checksum'> = {
      version: 1, workspaceId: input.workspaceId, accountMid, status: input.status,
      baselineRevision: input.baselineRevision, currentSegmentId: input.currentSegmentId,
      segments, scanPages: [], sourceFolders: input.sourceFolders?.map(clone) ?? [],
      scan: { phase: 'inventory', failureCount: 0, mode: 'incremental' },
      overlayRevision: 0, journalCursor: 0, journalChecksum: initialJournalChecksum,
      journalChecksumMode: 'chain-sha256-v1', journalFile: 'overlay.journal.jsonl'
    }
    await this.writeManifest(directory, withoutChecksum)
    await this.atomicWrite(join(directory, 'overlay.journal.jsonl'), '')
    this.writeLog.set(this.key(accountMid, input.workspaceId), [])
    this.readLog.set(this.key(accountMid, input.workspaceId), [])
  }

  async appendOverlay(accountMid: string, workspaceId: string, overlay: Overlay) {
    return this.queue(() => this.appendOverlayUnsafe(accountMid, workspaceId, overlay))
  }

  async appendTagEnrichmentDelta(accountMid: string, workspaceId: string, input: {
    currentSegmentId: string
    scanMetadata?: Overlay['scanMetadata']
  } & TagEnrichmentDelta) {
    const { currentSegmentId, scanMetadata, ...tagEnrichmentDelta } = input
    return this.queue(() => this.appendOverlayUnsafe(accountMid, workspaceId, {
      currentSegmentId,
      classifications: [],
      history: [],
      tagEnrichmentDelta,
      ...(scanMetadata ? { scanMetadata } : {})
    }))
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
        managedMemberChunks: [],
        streamingScan: undefined
      })
      this.writeLog.set(this.key(account, workspaceId), ['manifest.json'])
    })
  }

  /** Seals only whole scan-time batches and checkpoints the small open tail. */
  async checkpointStreamingScan(accountMid: string, workspaceId: string, input: {
    runId: string
    page?: ScanPage
    segmentSize?: number
    sealedSegments: Segment[]
    openAids: number[]
    openItems?: ScanItem[]
    observedAids?: number[]
    taggedAids?: number[]
    changedSegmentIds?: string[]
  }) {
    return this.queue(async () => {
      const account = normalizedAccountMid(accountMid)
      if (!/^[a-zA-Z0-9_-]{8,128}$/.test(input.runId)) throw new Error('Old favorite workspace scan run is invalid.')
      const directory = this.workspaceDirectory(account, workspaceId)
      const manifest = await this.readManifest(directory)
      if (!manifest || manifest.accountMid !== account) throw new Error('Old favorite workspace was not found.')
      if (manifest.scanRunId !== input.runId) throw new Error('Old favorite workspace scan run is stale.')
      if (input.page && (input.page.runId !== input.runId || typeof input.page.folderId !== 'string' ||
        !input.page.folderId.trim() || !Number.isSafeInteger(input.page.page) || input.page.page < 1 ||
        !Array.isArray(input.page.items) || input.page.items.length > 50 ||
        input.page.items.some((item) => !Number.isSafeInteger(item.aid) || item.aid <= 0))) {
        throw new Error('Old favorite workspace scan page is invalid.')
      }
      const segmentSize = input.segmentSize ?? manifest.streamingScan?.segmentSize ?? 500
      if (!isValidOldFavoriteWorkspaceSegmentSize(segmentSize)) {
        throw new Error('Old favorite workspace streaming scan is invalid.')
      }
      const priorById = new Map(manifest.segments.map((segment) => [segment.id, segment]))
      const changedSegmentIds = new Set(input.changedSegmentIds ?? [])
      const segments = [...manifest.segments]
      const descriptors: StreamingScanState['sealedSegments'] = []
      const writtenFiles: string[] = []
      const scanPages = [...(manifest.scanPages ?? [])]
      if (input.page) {
        const folderId = input.page.folderId.trim()
        const content = JSON.stringify({
          runId: input.runId, folderId, page: input.page.page, items: input.page.items.map(clone),
          ...(typeof input.page.hasMore === 'boolean' ? { hasMore: input.page.hasMore } : {})
        })
        const file = `scan/pages/${checksum(`${input.runId}:${folderId}:${input.page.page}:${content}`)}.json`
        await this.atomicWrite(join(directory, file), content)
        const priorIndex = scanPages.findIndex((page) => page.folderId === folderId && page.page === input.page!.page)
        const descriptor = {
          folderId, page: input.page.page, file, checksum: checksum(content),
          ...(typeof input.page.hasMore === 'boolean' ? { hasMore: input.page.hasMore } : {})
        }
        if (priorIndex >= 0) scanPages[priorIndex] = descriptor
        else scanPages.push(descriptor)
        scanPages.sort((left, right) => left.folderId.localeCompare(right.folderId) || left.page - right.page)
        writtenFiles.push(file)
      }
      for (let index = 0; index < input.sealedSegments.length; index += 1) {
        const segment = input.sealedSegments[index]!
        if (segment.id !== `segment-${index + 1}` || !segment.aids.length || segment.aids.length > segmentSize ||
          segment.aids.some((aid) => !Number.isSafeInteger(aid) || aid <= 0)) {
          throw new Error('Old favorite workspace streaming scan is invalid.')
        }
        if (!priorById.has(segment.id) || changedSegmentIds.has(segment.id)) {
          const items = segment.items?.map(clone) ?? segment.aids.map((aid) => ({ aid, sourceFolderIds: [] }))
          const content = JSON.stringify({ id: segment.id, aids: [...segment.aids], items })
          const contentChecksum = checksum(content)
          const file = priorById.has(segment.id)
            ? `baseline/${segment.id}-${contentChecksum}.json`
            : `baseline/${segment.id}.json`
          await this.atomicWrite(join(directory, file), content)
          const stored = { id: segment.id, file, checksum: contentChecksum }
          const priorIndex = segments.findIndex((candidate) => candidate.id === segment.id)
          if (priorIndex >= 0) segments[priorIndex] = stored
          else segments.push(stored)
          priorById.set(segment.id, stored)
          writtenFiles.push(file)
        }
        descriptors.push({ id: segment.id, index, itemCount: segment.aids.length, aids: [...segment.aids] })
      }
      segments.sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }))
      const openAids = [...new Set(input.openAids.filter((aid) => Number.isSafeInteger(aid) && aid > 0))]
      const openAidSet = new Set(openAids)
      const openItems = (input.openItems ?? []).filter((item) => openAidSet.has(item.aid)).map(clone)
      const observedAids = [...new Set((input.observedAids ?? [...descriptors.flatMap((segment) => segment.aids), ...openAids])
        .filter((aid) => Number.isSafeInteger(aid) && aid > 0))]
      const observedAidSet = new Set(observedAids)
      const taggedAids = [...new Set((input.taggedAids ?? []).filter((aid) => observedAidSet.has(aid)))]
      const { checksum: _storedChecksum, ...withoutChecksum } = manifest
      await this.writeManifest(directory, {
        ...withoutChecksum,
        currentSegmentId: descriptors[0]?.id ?? manifest.currentSegmentId,
        segments,
        scanPages,
        streamingScan: { segmentSize, sealedSegments: descriptors, openAids, openItems, observedAids, taggedAids }
      })
      this.writeLog.set(this.key(account, workspaceId), ['manifest.json', ...writtenFiles])
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
      scanPages.push({ folderId, page: input.page, file, checksum: checksum(content),
        ...(typeof input.hasMore === 'boolean' ? { hasMore: input.hasMore } : {}) })
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
      const contentChecksum = checksum(content)
      const file = `scan/members/${contentChecksum}.json`
      const existing = (manifest.managedMemberChunks ?? []).find((chunk) =>
        chunk.file === file && chunk.checksum === contentChecksum)
      if (existing) {
        try {
          if (await readFile(join(directory, file), 'utf8') === content) return
        } catch { /* recreate a missing or unreadable chunk below */ }
      }
      await this.atomicWrite(join(directory, file), content)
      const chunks = [
        ...(manifest.managedMemberChunks ?? []).filter((chunk) => chunk.file !== file),
        { file, checksum: contentChecksum }
      ]
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
    let manifest = await this.readManifest(directory)
    if (!manifest || manifest.accountMid !== account) throw new Error('Old favorite workspace was not found.')
    if (overlay.tagEnrichmentDelta && manifest.journalChecksumMode !== 'chain-sha256-v1' && manifest.journalCursor >= 1024 * 1024) {
      manifest = await this.compactOverlayJournalUnsafe(account, workspaceId, directory, manifest)
    }
    const journalFile = this.journalFile(manifest)
    const journalPath = join(directory, journalFile)
    const line = `${JSON.stringify(overlay)}\n`
    const key = this.key(account, workspaceId)
    const committed = await this.verifyCommittedJournal(directory, manifest)
    const lineBytes = Buffer.byteLength(line, 'utf8')
    let nextCursor: number
    let nextJournalChecksum: string
    if (manifest.journalChecksumMode === 'chain-sha256-v1') {
      await truncate(journalPath, manifest.journalCursor)
      await appendFile(journalPath, line, 'utf8')
      nextCursor = manifest.journalCursor + lineBytes
      nextJournalChecksum = advanceJournalChecksum(manifest.journalChecksum, line)
    } else {
      const nextJournal = Buffer.concat([committed, Buffer.from(line, 'utf8')])
      await this.atomicWrite(journalPath, nextJournal.toString('utf8'))
      nextCursor = nextJournal.byteLength
      nextJournalChecksum = checksum(nextJournal.toString('utf8'))
    }
    const { checksum: _storedChecksum, ...manifestWithoutChecksum } = manifest
    const next: Omit<Manifest, 'checksum'> = {
      ...manifestWithoutChecksum,
      currentSegmentId: overlay.currentSegmentId,
      overlayRevision: manifest.overlayRevision + 1,
      journalCursor: nextCursor,
      journalChecksum: nextJournalChecksum,
      ...(overlay.planReadiness ? { planReadiness: clone(overlay.planReadiness) } : {})
    }
    await this.writeManifest(directory, next)
    this.verifiedJournals.set(key, { cursor: nextCursor, checksum: nextJournalChecksum, file: journalFile })
    this.writeLog.set(key, ['manifest.json', journalFile])
  }

  async readScanPageCursors(accountMid: string, workspaceId: string) {
    const account = normalizedAccountMid(accountMid)
    const manifest = await this.readManifest(this.workspaceDirectory(account, workspaceId))
    if (!manifest || manifest.accountMid !== account) throw new Error('Old favorite workspace was not found.')
    return (manifest.scanPages ?? []).map((page) => ({
      folderId: page.folderId,
      page: page.page,
      ...(typeof page.hasMore === 'boolean' ? { hasMore: page.hasMore } : {})
    }))
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
      const journalPath = join(directory, this.journalFile(manifest))
      let journal = Buffer.alloc(0)
      if (manifest.journalCursor > 0) {
        try {
          journal = await readFile(journalPath)
          this.recordRead(directory, 'overlay.journal.jsonl')
        } catch { journal = Buffer.alloc(0) }
      }
      if (journal.byteLength < manifest.journalCursor) throw new Error('journal cursor exceeds content')
      const committedJournal = journal.subarray(0, manifest.journalCursor).toString('utf8')
      if (journalChecksum(committedJournal, manifest.journalChecksumMode) !== manifest.journalChecksum) throw new Error('journal checksum mismatch')
      const classifications: Record<string, Classification> = {}
      const history: History[] = []
      let sourceFolders = normalizeSourceFolders(manifest.sourceFolders?.map(clone) ?? [])
      let localWorkspaceFolders: OldFavoriteWorkspaceLocalWorkspaceFolder[] | undefined
      let recommendations: { initialized: boolean; candidates: Recommendation[]; adoptedCandidateIds: string[] } = {
        initialized: false, candidates: [], adoptedCandidateIds: []
      }
      let scan = clone(manifest.scan ?? { phase: 'inventory' as const, failureCount: 0, mode: 'incremental' as const })
      let tagEnrichment: Overlay['tagEnrichment'] | undefined
      let tagAdoption: Overlay['tagAdoption']
      const tagUpdates = new Map<number, string[]>()
      let ruleAnalysisCheckpoint: RuleAnalysisCheckpoint | undefined
      let deepSeekRunCheckpoint: OldFavoriteWorkspaceDeepSeekRunCheckpoint | undefined
      let executionIntent: OldFavoriteWorkspaceExecutionIntent | undefined
      let overview: Overlay['overview'] | undefined
      let inventoryMetrics: OldFavoriteInventoryMetricProjection | undefined
      const overlayHistory: OverlayHistory[] = []
      let planReadiness = { selectedAidCount: 0, classifiedAidCount: 0 }
      for (const line of committedJournal.split('\n').filter(Boolean)) {
        const overlay = JSON.parse(line) as Overlay
        overlayHistory.push({ currentSegmentId: overlay.currentSegmentId, history: overlay.history.map(clone) })
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
        if (overlay.scanMetadata?.sourceFolders) sourceFolders = normalizeSourceFolders(overlay.scanMetadata.sourceFolders.map(clone))
        if (overlay.scanMetadata?.localWorkspaceFolders) localWorkspaceFolders = overlay.scanMetadata.localWorkspaceFolders.map(clone)
        if (overlay.scanMetadata?.inventoryMetrics) inventoryMetrics = clone(overlay.scanMetadata.inventoryMetrics)
        if (overlay.scanMetadata?.phase) {
          scan = {
            phase: overlay.scanMetadata.phase,
            failureCount: overlay.scanMetadata.failureCount ?? scan.failureCount,
            mode: overlay.scanMetadata.mode ?? scan.mode,
            ...(overlay.scanMetadata.paused !== undefined ? { paused: overlay.scanMetadata.paused } : {}),
            ...(overlay.scanMetadata.reason ? { reason: overlay.scanMetadata.reason } : {})
            ,...(overlay.scanMetadata.retryAvailableAt && !Number.isNaN(Date.parse(overlay.scanMetadata.retryAvailableAt))
              ? { retryAvailableAt: overlay.scanMetadata.retryAvailableAt } : {})
            ,...(Number.isSafeInteger(overlay.scanMetadata.totalItemCount) ? { totalItemCount: overlay.scanMetadata.totalItemCount } : {})
            ,...(Number.isSafeInteger(overlay.scanMetadata.scannedItemCount) ? { scannedItemCount: overlay.scanMetadata.scannedItemCount } : {})
            ,...(Number.isSafeInteger(overlay.scanMetadata.taggedItemCount) ? { taggedItemCount: overlay.scanMetadata.taggedItemCount } : {})
            ,...(Number.isSafeInteger(overlay.scanMetadata.untaggedItemCount) ? { untaggedItemCount: overlay.scanMetadata.untaggedItemCount } : {})
          }
        }
        if (overlay.tagEnrichment) {
          const tagVersionsBySegment = normalizeTagVersions(overlay.tagEnrichment.tagVersionsBySegment)
          const acceptedTagVersionsBySegment = normalizeTagVersions(overlay.tagEnrichment.acceptedTagVersionsBySegment)
          for (const segmentId of overlay.tagEnrichment.acceptedSegmentIds ?? []) {
            if (acceptedTagVersionsBySegment[segmentId] === undefined) {
              acceptedTagVersionsBySegment[segmentId] = tagVersionsBySegment[segmentId] ?? 0
            }
          }
          tagEnrichment = {
            ...clone(overlay.tagEnrichment),
            completedItemCount: Number.isSafeInteger(overlay.tagEnrichment.completedItemCount)
              ? overlay.tagEnrichment.completedItemCount
              : Math.max(0, overlay.tagEnrichment.totalItemCount - overlay.tagEnrichment.pendingAids.length),
            failedAids: [...new Set(overlay.tagEnrichment.failedAids ?? [])],
            reusedTagItemCount: overlay.tagEnrichment.reusedTagItemCount ?? 0,
            taggedAids: [...new Set(overlay.tagEnrichment.taggedAids ?? [])],
            confirmedUntaggedAids: [...new Set(overlay.tagEnrichment.confirmedUntaggedAids ?? [])],
            acceptedSegmentIds: [...new Set(overlay.tagEnrichment.acceptedSegmentIds ?? [])],
            tagVersionsBySegment,
            acceptedTagVersionsBySegment
          }
        }
        if (overlay.tagAdoption !== undefined) tagAdoption = overlay.tagAdoption ? clone(overlay.tagAdoption) : null
        if (overlay.tagEnrichmentDelta) {
          if (!tagEnrichment) throw new Error('tag enrichment delta has no baseline')
          const delta = overlay.tagEnrichmentDelta
          if (delta.kind === 'tagged') {
            if (!Number.isSafeInteger(delta.aid) || delta.aid <= 0 || !tagEnrichment.pendingAids.includes(delta.aid)) {
              throw new Error('tag enrichment delta is invalid')
            }
            const tags = [...new Set(delta.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 32)
            tagEnrichment.pendingAids = tagEnrichment.pendingAids.filter((aid) => aid !== delta.aid)
            tagEnrichment.failedAids = (tagEnrichment.failedAids ?? []).filter((aid) => aid !== delta.aid)
            tagEnrichment.taggedAids = tags.length
              ? [...new Set([...(tagEnrichment.taggedAids ?? []), delta.aid])].sort((left, right) => left - right)
              : (tagEnrichment.taggedAids ?? []).filter((aid) => aid !== delta.aid)
            tagEnrichment.confirmedUntaggedAids = tags.length
              ? (tagEnrichment.confirmedUntaggedAids ?? []).filter((aid) => aid !== delta.aid)
              : [...new Set([...(tagEnrichment.confirmedUntaggedAids ?? []), delta.aid])].sort((left, right) => left - right)
            if (delta.tagChanged && delta.segmentId) {
              tagEnrichment.tagVersionsBySegment = {
                ...normalizeTagVersions(tagEnrichment.tagVersionsBySegment),
                [delta.segmentId]: (tagEnrichment.tagVersionsBySegment?.[delta.segmentId] ?? 0) + 1
              }
            }
            if (delta.unacceptedSegmentId) {
              if (delta.unacceptedSegmentId !== delta.segmentId ||
                !tagEnrichment.acceptedSegmentIds?.includes(delta.unacceptedSegmentId)) {
                throw new Error('tag enrichment unaccepted segment delta is invalid')
              }
              tagEnrichment.acceptedSegmentIds = tagEnrichment.acceptedSegmentIds
                .filter((segmentId) => segmentId !== delta.unacceptedSegmentId)
            }
            tagUpdates.set(delta.aid, tags)
            tagEnrichment.completedItemCount = tagEnrichment.totalItemCount - tagEnrichment.pendingAids.length
            tagEnrichment.status = tagEnrichment.pendingAids.length ? 'running' : 'complete'
          } else if (delta.kind === 'failed') {
            if (!Number.isSafeInteger(delta.aid) || delta.aid <= 0 || !tagEnrichment.pendingAids.includes(delta.aid)) {
              throw new Error('tag enrichment delta is invalid')
            }
            tagEnrichment.pendingAids = tagEnrichment.pendingAids.filter((aid) => aid !== delta.aid)
            tagEnrichment.failedAids = [...new Set([...(tagEnrichment.failedAids ?? []), delta.aid])]
              .sort((left, right) => left - right)
            tagEnrichment.completedItemCount = tagEnrichment.totalItemCount - tagEnrichment.pendingAids.length
            tagEnrichment.status = tagEnrichment.pendingAids.length ? 'running' : 'complete'
          } else if (delta.kind === 'retry-failed') {
            tagEnrichment.pendingAids = [...new Set([
              ...tagEnrichment.pendingAids,
              ...(tagEnrichment.failedAids ?? [])
            ])].sort((left, right) => left - right)
            tagEnrichment.failedAids = []
            tagEnrichment.completedItemCount = tagEnrichment.totalItemCount - tagEnrichment.pendingAids.length
            tagEnrichment.status = tagEnrichment.pendingAids.length ? 'running' : 'complete'
          } else if (delta.kind === 'accept-segment' || delta.kind === 'resume-segment') {
            if (!manifest.segments.some((segment) => segment.id === delta.segmentId)) {
              throw new Error('tag enrichment segment delta is invalid')
            }
            const acceptedSegmentIds = new Set(tagEnrichment.acceptedSegmentIds ?? [])
            if (delta.kind === 'accept-segment') {
              acceptedSegmentIds.add(delta.segmentId)
              tagEnrichment.acceptedTagVersionsBySegment = {
                ...normalizeTagVersions(tagEnrichment.acceptedTagVersionsBySegment),
                [delta.segmentId]: Number.isSafeInteger(delta.acceptedTagVersion) && delta.acceptedTagVersion >= 0
                  ? delta.acceptedTagVersion
                  : tagEnrichment.tagVersionsBySegment?.[delta.segmentId] ?? 0
              }
            } else {
              acceptedSegmentIds.delete(delta.segmentId)
              const acceptedTagVersionsBySegment = normalizeTagVersions(tagEnrichment.acceptedTagVersionsBySegment)
              delete acceptedTagVersionsBySegment[delta.segmentId]
              tagEnrichment.acceptedTagVersionsBySegment = acceptedTagVersionsBySegment
              const requeuedAids = [...new Set(delta.requeuedAids ?? [])]
              if (requeuedAids.some((aid) => !Number.isSafeInteger(aid) || aid <= 0)) {
                throw new Error('tag enrichment resume delta is invalid')
              }
              if (requeuedAids.length) {
                tagEnrichment.pendingAids = [...new Set([...tagEnrichment.pendingAids, ...requeuedAids])]
                  .sort((left, right) => left - right)
                tagEnrichment.completedItemCount = Math.max(0, tagEnrichment.totalItemCount - tagEnrichment.pendingAids.length)
                tagEnrichment.status = 'running'
              }
            }
            tagEnrichment.acceptedSegmentIds = [...acceptedSegmentIds]
            if (delta.status) tagEnrichment.status = delta.status
          } else {
            tagEnrichment.status = delta.status
          }
        }
        for (const update of overlay.tagUpdates ?? []) tagUpdates.set(update.aid, [...update.tags])
        if (overlay.ruleAnalysisCheckpoint !== undefined) {
          ruleAnalysisCheckpoint = overlay.ruleAnalysisCheckpoint ? clone(overlay.ruleAnalysisCheckpoint) : undefined
        }
        if (overlay.deepSeekRunCheckpoint !== undefined) {
          deepSeekRunCheckpoint = overlay.deepSeekRunCheckpoint ? clone(overlay.deepSeekRunCheckpoint) : undefined
        }
        if (overlay.executionIntent !== undefined) {
          executionIntent = overlay.executionIntent ? clone(overlay.executionIntent) : undefined
        }
        if (overlay.overview) overview = clone(overlay.overview)
      }
      return {
        workspaceId: manifest.workspaceId, accountMid: manifest.accountMid, status: manifest.status,
        baselineRevision: manifest.baselineRevision, currentSegmentId: manifest.currentSegmentId,
        ...(manifest.scanRunId ? { scanRunId: manifest.scanRunId } : {}),
        ...(manifest.streamingScan ? { streamingScan: clone(manifest.streamingScan) } : {}),
        overlayRevision: manifest.overlayRevision, journalCursor: manifest.journalCursor,
        manifestChecksum: manifest.checksum,
        ...(manifest.lastCommittedId ? { lastCommittedId: manifest.lastCommittedId } : {}),
        ...(normalizeRecoveryBaseline(manifest.recoveryBaseline) ? { recoveryBaseline: clone(normalizeRecoveryBaseline(manifest.recoveryBaseline)!) } : {}),
        ...(manifest.recoveryDecision ? { recoveryDecision: clone(manifest.recoveryDecision) } : {}),
        loadedSegmentAids: [...loadedSegment.aids],
        loadedSegmentItems: (loadedSegment.items ?? []).map(clone),
        sourceFolders,
        ...(localWorkspaceFolders ? { localWorkspaceFolders } : {}),
        scan,
        classifications, history, recommendations, planReadiness
        ,overlayHistory
        ,ruleAnalysisCheckpoint
        ,deepSeekRunCheckpoint
        ,executionIntent
        ,inventoryMetrics
        ,overview
        ,tagEnrichment, tagAdoption, tagUpdates: [...tagUpdates.entries()].map(([aid, tags]) => ({ aid, tags }))
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
      ...(manifest.streamingScan ? { streamingScan: clone(manifest.streamingScan) } : {}),
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
    const journalPath = join(directory, this.journalFile(manifest))
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
    if (journalChecksum(committed, manifest.journalChecksumMode) !== manifest.journalChecksum) throw new Error('Old favorite workspace journal is corrupt.')
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
    const account = normalizedAccountMid(accountMid)
    const directory = this.workspaceDirectory(account, workspaceId)
    const manifest = await this.readManifest(directory)
    if (!manifest) throw new Error('Old favorite workspace was not found.')
    await writeFile(join(directory, this.journalFile(manifest)), '{broken', 'utf8')
  }

  async appendUncommittedOverlayForTest(accountMid: string, workspaceId: string, overlay: Overlay) {
    const account = normalizedAccountMid(accountMid)
    const directory = this.workspaceDirectory(account, workspaceId)
    const manifest = await this.readManifest(directory)
    if (!manifest) throw new Error('Old favorite workspace was not found.')
    await appendFile(
      join(directory, this.journalFile(manifest)),
      `${JSON.stringify(overlay)}\n`,
      'utf8'
    )
  }

  private journalFile(manifest: Manifest) {
    return manifest.journalFile?.trim() || 'overlay.journal.jsonl'
  }

  private async verifyCommittedJournal(directory: string, manifest: Manifest) {
    const file = this.journalFile(manifest)
    const key = this.key(manifest.accountMid, manifest.workspaceId)
    const verified = this.verifiedJournals.get(key)
    if (manifest.journalChecksumMode === 'chain-sha256-v1' && verified?.cursor === manifest.journalCursor &&
      verified.checksum === manifest.journalChecksum && verified.file === file) {
      return Buffer.alloc(0)
    }
    let journal: Buffer
    try {
      journal = await readFile(join(directory, file))
    } catch {
      throw new Error('Old favorite workspace journal is corrupt.')
    }
    if (journal.byteLength < manifest.journalCursor) throw new Error('Old favorite workspace journal is corrupt.')
    const committed = journal.subarray(0, manifest.journalCursor)
    if (journalChecksum(committed.toString('utf8'), manifest.journalChecksumMode) !== manifest.journalChecksum) {
      throw new Error('Old favorite workspace journal is corrupt.')
    }
    this.verifiedJournals.set(key, { cursor: manifest.journalCursor, checksum: manifest.journalChecksum, file })
    return committed
  }

  private async compactOverlayJournalUnsafe(
    accountMid: string,
    workspaceId: string,
    directory: string,
    manifest: Manifest
  ) {
    const committed = (await this.verifyCommittedJournal(directory, manifest)).toString('utf8')
    const classifications = new Map<number, Classification>()
    const tagUpdates = new Map<number, string[]>()
    const historyOverlays: Overlay[] = []
    let currentSegmentId = manifest.currentSegmentId
    let sourceFolders = manifest.sourceFolders?.map(clone) ?? []
    let localWorkspaceFolders: OldFavoriteWorkspaceLocalWorkspaceFolder[] | undefined
    let scan = clone(manifest.scan ?? { phase: 'inventory' as const, failureCount: 0, mode: 'incremental' as const })
    let recommendations: NonNullable<Overlay['recommendations']> = {
      initialized: false,
      candidates: [],
      adoptedCandidateIds: []
    }
    let hasRecommendations = false
    let planReadiness = manifest.planReadiness ? clone(manifest.planReadiness) : undefined
    let tagEnrichment: Overlay['tagEnrichment'] | undefined
    let tagAdoption: Overlay['tagAdoption']
    let ruleAnalysisCheckpoint: Overlay['ruleAnalysisCheckpoint']
    let deepSeekRunCheckpoint: Overlay['deepSeekRunCheckpoint']
    let executionIntent: Overlay['executionIntent']
    let inventoryMetrics: OldFavoriteInventoryMetricProjection | undefined

    for (const raw of committed.split('\n').filter(Boolean)) {
      const overlay = JSON.parse(raw) as Overlay
      currentSegmentId = overlay.currentSegmentId
      for (const classification of overlay.classifications) classifications.set(classification.aid, clone(classification))
      if (overlay.history.length) {
        historyOverlays.push({ currentSegmentId: overlay.currentSegmentId, classifications: [], history: overlay.history.map(clone) })
      }
      if (overlay.recommendations) {
        hasRecommendations = true
        if (overlay.recommendations.initialized) recommendations.initialized = true
        if (overlay.recommendations.candidates) recommendations.candidates = overlay.recommendations.candidates.map(clone)
        if (overlay.recommendations.adoptedCandidateIds) {
          recommendations.adoptedCandidateIds = [...new Set(overlay.recommendations.adoptedCandidateIds)]
        }
      }
      if (overlay.planReadiness) planReadiness = clone(overlay.planReadiness)
      if (overlay.scanMetadata?.sourceFolders) sourceFolders = overlay.scanMetadata.sourceFolders.map(clone)
      if (overlay.scanMetadata?.localWorkspaceFolders) localWorkspaceFolders = overlay.scanMetadata.localWorkspaceFolders.map(clone)
      if (overlay.scanMetadata?.inventoryMetrics) inventoryMetrics = clone(overlay.scanMetadata.inventoryMetrics)
      if (overlay.scanMetadata?.phase) {
        scan = {
          phase: overlay.scanMetadata.phase,
          failureCount: overlay.scanMetadata.failureCount ?? scan.failureCount,
          mode: overlay.scanMetadata.mode ?? scan.mode,
          ...(overlay.scanMetadata.paused !== undefined ? { paused: overlay.scanMetadata.paused } : {}),
          ...(overlay.scanMetadata.reason ? { reason: overlay.scanMetadata.reason } : {}),
          ...(Number.isSafeInteger(overlay.scanMetadata.totalItemCount) ? { totalItemCount: overlay.scanMetadata.totalItemCount } : {}),
          ...(Number.isSafeInteger(overlay.scanMetadata.scannedItemCount) ? { scannedItemCount: overlay.scanMetadata.scannedItemCount } : {}),
          ...(Number.isSafeInteger(overlay.scanMetadata.taggedItemCount) ? { taggedItemCount: overlay.scanMetadata.taggedItemCount } : {}),
          ...(Number.isSafeInteger(overlay.scanMetadata.untaggedItemCount) ? { untaggedItemCount: overlay.scanMetadata.untaggedItemCount } : {})
        }
      }
      if (overlay.tagEnrichment) tagEnrichment = clone(overlay.tagEnrichment)
      if (overlay.tagAdoption !== undefined) tagAdoption = overlay.tagAdoption ? clone(overlay.tagAdoption) : null
      for (const update of overlay.tagUpdates ?? []) tagUpdates.set(update.aid, [...update.tags])
      if (overlay.ruleAnalysisCheckpoint !== undefined) {
        ruleAnalysisCheckpoint = overlay.ruleAnalysisCheckpoint ? clone(overlay.ruleAnalysisCheckpoint) : null
      }
      if (overlay.deepSeekRunCheckpoint !== undefined) {
        deepSeekRunCheckpoint = overlay.deepSeekRunCheckpoint ? clone(overlay.deepSeekRunCheckpoint) : null
      }
      if (overlay.executionIntent !== undefined) {
        executionIntent = overlay.executionIntent ? clone(overlay.executionIntent) : null
      }
    }

    const stateOverlay: Overlay = {
      currentSegmentId,
      classifications: [...classifications.values()],
      history: [],
      ...(hasRecommendations ? { recommendations } : {}),
      ...(planReadiness ? { planReadiness } : {}),
      scanMetadata: {
        sourceFolders,
        ...(localWorkspaceFolders ? { localWorkspaceFolders } : {}),
        ...scan,
        ...(inventoryMetrics ? { inventoryMetrics } : {})
      },
      ...(tagEnrichment ? { tagEnrichment } : {}),
      ...(tagAdoption !== undefined ? { tagAdoption } : {}),
      ...(tagUpdates.size ? { tagUpdates: [...tagUpdates.entries()].map(([aid, tags]) => ({ aid, tags })) } : {}),
      ...(ruleAnalysisCheckpoint !== undefined ? { ruleAnalysisCheckpoint } : {}),
      ...(deepSeekRunCheckpoint !== undefined ? { deepSeekRunCheckpoint } : {})
      ,...(executionIntent !== undefined ? { executionIntent } : {})
    }
    const compactContent = [...historyOverlays, stateOverlay].map((overlay) => `${JSON.stringify(overlay)}\n`).join('')
    const compactFile = `overlay.compact.${randomUUID()}.jsonl`
    const compactPath = join(directory, compactFile)
    await this.atomicWrite(compactPath, compactContent)
    const verifiedContent = await readFile(compactPath, 'utf8')
    const compactChecksum = chainedJournalChecksum(verifiedContent)
    if (verifiedContent !== compactContent) throw new Error('Old favorite workspace journal compaction failed.')

    const { checksum: _storedChecksum, ...manifestWithoutChecksum } = manifest
    const nextWithoutChecksum: Omit<Manifest, 'checksum'> = {
      ...manifestWithoutChecksum,
      currentSegmentId,
      journalCursor: Buffer.byteLength(compactContent, 'utf8'),
      journalChecksum: compactChecksum,
      journalChecksumMode: 'chain-sha256-v1',
      journalFile: compactFile
    }
    await this.writeManifest(directory, nextWithoutChecksum)
    const next: Manifest = { ...nextWithoutChecksum, checksum: checksum(canonicalManifest(nextWithoutChecksum)) }
    this.verifiedJournals.set(this.key(accountMid, workspaceId), {
      cursor: next.journalCursor, checksum: next.journalChecksum, file: compactFile
    })
    const previousFile = this.journalFile(manifest)
    if (previousFile !== compactFile) {
      try { await unlink(join(directory, previousFile)) } catch { /* compact state is already committed */ }
    }
    return next
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
