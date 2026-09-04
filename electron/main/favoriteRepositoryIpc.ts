import { createHash, randomUUID } from 'node:crypto'
import type {
  AccountFavoriteRepositorySnapshot,
  FavoriteRepositoryCommand,
  FavoriteRepositoryCommandResult,
  FavoriteRepositoryClassificationSource,
  FavoriteRepositoryClassificationAdjustment,
  FavoriteRepositoryConfirmedReviewInput,
  FavoriteRepositoryEvent,
  FavoriteRepositoryFolder,
  FavoriteRepositoryOrganizationChange,
  FavoriteRepositoryPage,
  FavoriteRepositoryVideo
} from '../../src/shared/favoriteRepository'
import type {
  FavoriteRepositoryLibraryDetail,
  FavoriteRepositoryLibraryFilter,
  FavoriteRepositoryLibraryInitialSourceFilter,
  FavoriteRepositoryLibrarySourceFilter,
  FavoriteRepositoryLibraryStateFilters,
  FavoriteRepositoryLibrarySort,
  FavoriteRepositoryTranscriptionFilter,
  FavoriteRepositoryService
} from './favoriteRepositoryService'
import type { FavoriteLibraryCommandService, FavoriteLibraryCommandResult, FavoriteLibraryPlacementInput } from './favoriteLibraryCommands'
import type {
  FavoriteRepositoryArchiveService,
  FavoriteRepositoryRestorePlan,
  FavoriteRepositoryRestoreWriter
} from './favoriteRepositoryArchiveService'

type IpcEvent = {
  sender: {
    id: number
    once?: (event: 'destroyed', listener: () => void) => unknown
  }
}
type IpcMain = {
  handle(channel: string, handler: (event: IpcEvent, ...args: never[]) => unknown): void
}

type FolderPageOptions = { limit: number; cursor?: string }
export type FavoriteRepositoryLibraryPageOptions = FolderPageOptions & {
  page?: number
  query?: string
  filter?: FavoriteRepositoryLibraryFilter
  sourceFilter?: FavoriteRepositoryLibrarySourceFilter
  initialSourceFilter?: FavoriteRepositoryLibraryInitialSourceFilter
  stateFilters?: FavoriteRepositoryLibraryStateFilters
  sort?: FavoriteRepositoryLibrarySort
  transcriptionFilters?: FavoriteRepositoryTranscriptionFilter[]
  classificationSources?: FavoriteRepositoryClassificationSource[]
  physicalShard?: { logicalLedgerId: string; shardNumber: number }
}
type Subscription = { id: string; accountMid: string; folderId?: string }
type LibraryPageScope =
  | { kind: 'all' }
  | { kind: 'folder'; folderId: string }
  | { kind: 'pending' }
  | { kind: 'protected' }
  | { kind: 'unsynced' }
  | { kind: 'recycle' }

const MAX_AFFECTED_FOLDER_IDS = 100
const DEFAULT_ARCHIVE_RESTORE_TOKEN_TTL_MS = 5 * 60 * 1000

type ArchiveRestorePreviewToken = {
  senderId: number
  accountMid: string
  mode: FavoriteRepositoryRestorePlan['mode']
  digest: string
  expiresAt: number
}

export type FavoriteRepositorySnapshotSummary = {
  version: 1
  accountMid: string
  revision: number
  updatedAt: string
  videoCount: number
  folderCount: number
  folders: FavoriteRepositoryFolder[]
  physicalShards: Array<import('../../src/shared/favoriteRepository').FavoriteRepositoryPhysicalShard & { localMemberCount?: number }>
  folderCounts: Record<string, number>
  workspaceVideoCount?: number
  otherFavoriteVideoCount?: number
  scopeCounts: { all: number; pending: number; protected: number; unsynced: number; recycle?: number }
  folderConflicts?: Array<{ title: string; folderIds: string[]; reason: string; candidates: Array<{ id: string; title: string }> }>
  physicalShardCount: number
  syncRecordCount: number
  syncCounts: Record<'pending' | 'succeeded' | 'failed' | 'result-unknown', number>
  pendingAidCount: number
  remoteReconciliations: Array<{
    kind: 'unfavorite' | 'managed-folder' | 'managed-placement'
    operationId: string
  }>
  workspace?: {
    id: string
    status: NonNullable<AccountFavoriteRepositorySnapshot['workspace']>['status']
    baselineRevision: number
    continuationCount: number
  }
}

export type FavoriteRepositoryRevisionChange = {
  subscriptionId: string
  accountMid: string
  revision: number
  affectedFolderIds: string[]
  affectedFolderCount: number
  affectedFolderIdsTruncated: boolean
  affectedAidCount: number
  pageInvalidated: boolean
}

export type FavoriteRepositoryLibraryRow = {
  video: FavoriteRepositoryVideo
  folderIds: string[]
  pendingStates: Array<'protected' | 'unsynced' | 'continuation' | 'failed' | 'result-unknown'>
  libraryStates: {
    sync: 'synced' | 'unsynced'
    protection: 'protected' | 'unprotected'
    organization: 'organized' | 'unorganized'
  }
  organization?: {
    classificationSource?: FavoriteRepositoryClassificationSource
    completedAt: string
  }
}

export type FavoriteRepositoryLibraryPage = FavoriteRepositoryPage<FavoriteRepositoryLibraryRow>
export type FavoriteRepositoryOrganizationChanges = FavoriteRepositoryOrganizationChange[]
export type FavoriteRepositoryEventPage = FavoriteRepositoryPage<FavoriteRepositoryEvent>
export type FavoriteRepositoryClassificationAdjustmentPage = FavoriteRepositoryPage<FavoriteRepositoryClassificationAdjustment>
export type FavoriteRepositoryArchiveRestorePreview = FavoriteRepositoryRestorePlan & {
  executionToken: string
  confirmationRequired: boolean
}
export type FavoriteRepositoryArchiveFullRestoreConfirmation = { confirmationToken: string }
export type FavoriteRepositoryArchiveRestoreScope =
  | { kind: 'all' }
  | { kind: 'aids'; aids: number[] }
  | { kind: 'logical-folder'; folderId: string }
export type FavoriteLibraryArchiveSummary = {
  status: '未入档' | '已入档'
  versionCount: number
  starred: boolean
  hasMemo: boolean
  memoPreview?: string
  hasSummary: boolean
  updatedAt?: string
}

export type FavoriteLibraryTranscriptionSummary = {
  status: '未转写' | '等待转写' | '正在转写' | '转写完成' | '转写失败'
}

export type FavoriteRepositoryLibraryVideoDetail = FavoriteRepositoryLibraryDetail & {
  archive: FavoriteLibraryArchiveSummary
  transcription: FavoriteLibraryTranscriptionSummary
}

function normalizedAccountMid(value: unknown) {
  if (typeof value !== 'string') throw new Error('Favorite repository account is invalid.')
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed) || BigInt(trimmed) === 0n) {
    throw new Error('Favorite repository account is invalid.')
  }
  return BigInt(trimmed).toString()
}

function pageOptions(value: unknown): FolderPageOptions {
  if (!value || typeof value !== 'object') throw new Error('Favorite repository page options are invalid.')
  const { limit, cursor } = value as Partial<FolderPageOptions>
  if (!Number.isSafeInteger(limit) || !(limit && limit >= 1 && limit <= 500) || (cursor !== undefined && typeof cursor !== 'string')) {
    throw new Error('Favorite repository page options are invalid.')
  }
  const validatedLimit = limit as number
  return cursor ? { limit: validatedLimit, cursor } : { limit: validatedLimit }
}

function libraryPageOptions(value: unknown): FavoriteRepositoryLibraryPageOptions {
  const base = pageOptions(value)
  const candidate = value as { page?: unknown; query?: unknown; filter?: unknown; sourceFilter?: unknown; initialSourceFilter?: unknown; stateFilters?: unknown; sort?: unknown; transcriptionFilters?: unknown; classificationSources?: unknown }
  const physicalShard = (candidate as { physicalShard?: unknown }).physicalShard
  if (physicalShard !== undefined && (!physicalShard || typeof physicalShard !== 'object' || Array.isArray(physicalShard) ||
    typeof (physicalShard as { logicalLedgerId?: unknown }).logicalLedgerId !== 'string' || !(physicalShard as { logicalLedgerId: string }).logicalLedgerId.trim() ||
    !Number.isSafeInteger((physicalShard as { shardNumber?: unknown }).shardNumber) || Number((physicalShard as { shardNumber: number }).shardNumber) < 1)) {
    throw new Error('Favorite library page options are invalid.')
  }
  if (candidate.page !== undefined && (!Number.isSafeInteger(candidate.page) || (candidate.page as number) < 1)) throw new Error('Favorite library page options are invalid.')
  if (candidate.query !== undefined && typeof candidate.query !== 'string') throw new Error('Favorite library page options are invalid.')
  if (candidate.filter !== undefined && !['all', 'pending', 'protected', 'unsynced'].includes(candidate.filter as string)) {
    throw new Error('Favorite library page options are invalid.')
  }
  if (candidate.sourceFilter !== undefined && !['with-other', 'bilimi-only'].includes(candidate.sourceFilter as string)) {
    throw new Error('Favorite library page options are invalid.')
  }
  if (candidate.initialSourceFilter !== undefined && !['initial-ordinary', 'initial-bilimi'].includes(candidate.initialSourceFilter as string)) {
    throw new Error('Favorite library page options are invalid.')
  }
  if (candidate.stateFilters !== undefined && (!candidate.stateFilters || typeof candidate.stateFilters !== 'object' || Array.isArray(candidate.stateFilters))) {
    throw new Error('Favorite library page options are invalid.')
  }
  const stateFilters = candidate.stateFilters as Record<string, unknown> | undefined
  if (stateFilters && (Object.keys(stateFilters).some((key) => !['sync', 'protection', 'organization'].includes(key)) ||
    (stateFilters.sync !== undefined && !['synced', 'unsynced'].includes(String(stateFilters.sync))) ||
    (stateFilters.protection !== undefined && !['protected', 'unprotected'].includes(String(stateFilters.protection))) ||
    (stateFilters.organization !== undefined && !['organized', 'unorganized'].includes(String(stateFilters.organization))))) {
    throw new Error('Favorite library page options are invalid.')
  }
  if (candidate.sort !== undefined && !['updated-desc', 'updated-asc', 'title-asc', 'title-desc'].includes(candidate.sort as string)) {
    throw new Error('Favorite library page options are invalid.')
  }
  if (candidate.transcriptionFilters !== undefined && (!Array.isArray(candidate.transcriptionFilters) ||
    candidate.transcriptionFilters.length > 5 || candidate.transcriptionFilters.some((filter) =>
      !['completed', 'none', 'pending', 'running', 'failed'].includes(filter as string)))) {
    throw new Error('Favorite library page options are invalid.')
  }
  if (candidate.classificationSources !== undefined && (!Array.isArray(candidate.classificationSources) ||
    candidate.classificationSources.length > 4 || candidate.classificationSources.some((source) =>
      !['system-high', 'system-low', 'deepseek', 'manual'].includes(source as string)))) {
    throw new Error('Favorite library page options are invalid.')
  }
  const query = candidate.query?.trim()
  const transcriptionFilters = candidate.transcriptionFilters === undefined ? undefined :
    [...new Set(candidate.transcriptionFilters as FavoriteRepositoryTranscriptionFilter[])].sort()
  const classificationSources = candidate.classificationSources === undefined ? undefined :
    [...new Set(candidate.classificationSources as FavoriteRepositoryClassificationSource[])].sort()
  return {
    ...base,
    ...(candidate.page ? { page: candidate.page as number } : {}),
    ...(query ? { query } : {}),
    ...(candidate.filter ? { filter: candidate.filter as FavoriteRepositoryLibraryFilter } : {}),
    ...(candidate.sourceFilter ? { sourceFilter: candidate.sourceFilter as FavoriteRepositoryLibrarySourceFilter } : {}),
    ...(candidate.initialSourceFilter ? { initialSourceFilter: candidate.initialSourceFilter as FavoriteRepositoryLibraryInitialSourceFilter } : {}),
    ...(stateFilters && Object.keys(stateFilters).length ? { stateFilters: { ...stateFilters } as FavoriteRepositoryLibraryStateFilters } : {}),
    ...(candidate.sort ? { sort: candidate.sort as FavoriteRepositoryLibrarySort } : {}),
    ...(transcriptionFilters?.length ? { transcriptionFilters } : {}),
    ...(classificationSources?.length ? { classificationSources } : {})
    , ...(physicalShard ? { physicalShard: { logicalLedgerId: (physicalShard as { logicalLedgerId: string }).logicalLedgerId.trim(), shardNumber: Number((physicalShard as { shardNumber: number }).shardNumber) } } : {})
  }
}

function libraryPageScope(value: unknown): LibraryPageScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Favorite library page scope is invalid.')
  }
  const candidate = value as { kind?: unknown; folderId?: unknown }
  if (candidate.kind === 'all' && Object.keys(candidate).length === 1) return { kind: 'all' }
  if ((candidate.kind === 'pending' || candidate.kind === 'protected' || candidate.kind === 'unsynced' || candidate.kind === 'recycle') && Object.keys(candidate).length === 1) return { kind: candidate.kind }
  if (candidate.kind === 'folder' && typeof candidate.folderId === 'string' && candidate.folderId.trim() && Object.keys(candidate).length === 2) {
    return { kind: 'folder', folderId: candidate.folderId.trim() }
  }
  throw new Error('Favorite library page scope is invalid.')
}

function videoAid(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error('Favorite library video is invalid.')
  return Number(value)
}

function expectedRevision(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('Favorite library revision is invalid.')
  return Number(value)
}

function localPlacementInputs(value: unknown): FavoriteLibraryPlacementInput[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw new Error('Favorite library placement is invalid.')
  const seen = new Set<number>()
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('Favorite library placement is invalid.')
    const candidate = item as { aid?: unknown; folderIds?: unknown }
    const aid = videoAid(candidate.aid)
    if (seen.has(aid) || !Array.isArray(candidate.folderIds) || candidate.folderIds.some((folderId) =>
      typeof folderId !== 'string' || !folderId.trim() || !folderId.trim().startsWith('bilimi-logical:'))) {
      throw new Error('Favorite library placement requires logical folder IDs.')
    }
    seen.add(aid)
    return { aid, folderIds: [...new Set(candidate.folderIds.map((folderId) => folderId.trim()))].sort() }
  })
}

function restoreMode(value: unknown): 'safe' | 'full' {
  if (value === 'safe' || value === 'full') return value
  throw new Error('Favorite repository restore mode is invalid.')
}

function archiveRestoreScope(value: unknown): FavoriteRepositoryArchiveRestoreScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Favorite repository archive restore scope is invalid.')
  }
  const candidate = value as { kind?: unknown; aids?: unknown; folderId?: unknown }
  if (candidate.kind === 'all' && Object.keys(candidate).length === 1) return { kind: 'all' }
  if (candidate.kind === 'aids' && Array.isArray(candidate.aids) && Object.keys(candidate).length === 2 &&
    candidate.aids.length > 0 && candidate.aids.length <= 10_000 && new Set(candidate.aids).size === candidate.aids.length &&
    candidate.aids.every((aid) => Number.isSafeInteger(aid) && Number(aid) > 0)) {
    return { kind: 'aids', aids: candidate.aids.map(Number).sort((left, right) => left - right) }
  }
  if (candidate.kind === 'logical-folder' && typeof candidate.folderId === 'string' && Object.keys(candidate).length === 2 &&
    /^bilimi-logical:\S+$/.test(candidate.folderId.trim())) {
    return { kind: 'logical-folder', folderId: candidate.folderId.trim() }
  }
  throw new Error('Favorite repository archive restore scope is invalid.')
}

/** Renderer may select a previously previewed plan but never physical folder ids or writer behavior. */
function restorePlan(value: unknown): FavoriteRepositoryRestorePlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Favorite repository restore plan is invalid.')
  const candidate = value as { mode?: unknown; accountMid?: unknown; operations?: unknown }
  if ((candidate.mode !== 'safe' && candidate.mode !== 'full') || typeof candidate.accountMid !== 'string' || !Array.isArray(candidate.operations)) {
    throw new Error('Favorite repository restore plan is invalid.')
  }
  const accountMid = normalizedAccountMid(candidate.accountMid)
  const operations = candidate.operations.map((operation) => {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) throw new Error('Favorite repository restore plan is invalid.')
    const row = operation as Record<string, unknown>
    const expectedKeys = ['aid', 'desiredLogicalFolderIds', 'appendLogicalFolderIds', 'removeLogicalFolderIds']
    if (Object.keys(row).some((key) => !expectedKeys.includes(key)) || !Number.isSafeInteger(row.aid) || Number(row.aid) <= 0) {
      throw new Error('Favorite repository restore plan is invalid.')
    }
    const folderIds = (key: 'desiredLogicalFolderIds' | 'appendLogicalFolderIds' | 'removeLogicalFolderIds') => {
      const ids = row[key]
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !id.startsWith('bilimi-logical:'))) {
        throw new Error('Favorite repository restore plan is invalid.')
      }
      return [...new Set(ids)].sort()
    }
    return {
      aid: Number(row.aid),
      desiredLogicalFolderIds: folderIds('desiredLogicalFolderIds'),
      appendLogicalFolderIds: folderIds('appendLogicalFolderIds'),
      removeLogicalFolderIds: folderIds('removeLogicalFolderIds')
    }
  })
  if (operations.length > 10_000 || new Set(operations.map((operation) => operation.aid)).size !== operations.length) {
    throw new Error('Favorite repository restore plan is invalid.')
  }
  return { mode: candidate.mode, accountMid, operations: operations.sort((left, right) => left.aid - right.aid) }
}

/** The plan has already discarded physical ids; hash its normalized logical form before issuing a renderer token. */
function restorePlanDigest(plan: FavoriteRepositoryRestorePlan) {
  return createHash('sha256').update(JSON.stringify({
    accountMid: plan.accountMid,
    mode: plan.mode,
    operations: plan.operations
  })).digest('hex')
}

function commandForAccount(value: unknown, accountMid: string): FavoriteRepositoryCommand {
  if (!value || typeof value !== 'object' || typeof (value as { accountMid?: unknown }).accountMid !== 'string') {
    throw new Error('Favorite repository command is invalid.')
  }
  if (normalizedAccountMid((value as { accountMid: string }).accountMid) !== accountMid) {
    throw new Error('Favorite repository command account mismatch.')
  }
  if (
    ((value as { type?: unknown; payload?: { frozenSyncPlan?: unknown } }).type === 'set-workspace' &&
      (value as { payload?: { frozenSyncPlan?: unknown } }).payload?.frozenSyncPlan !== undefined) ||
    (value as { type?: unknown }).type === 'record-organization-protections' ||
    (value as { type?: unknown }).type === 'commit-local-plan' ||
    (value as { type?: unknown }).type === 'record-bilibili-mirror' ||
    (value as { type?: unknown }).type === 'clear-bilibili-mirror' ||
    (value as { type?: unknown }).type === 'abandon-frozen-workspace'
  ) {
    throw new Error('Frozen favorite workspace plans are reserved for the main process.')
  }
  return value as FavoriteRepositoryCommand
}

function searchPage(
  snapshot: AccountFavoriteRepositorySnapshot,
  query: unknown,
  options: unknown
): FavoriteRepositoryPage<FavoriteRepositoryVideo> {
  if (typeof query !== 'string') throw new Error('Favorite repository search query is invalid.')
  const page = pageOptions(options)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const all = Object.values(snapshot.videos)
    .filter((video) => [video.title, video.author ?? '', video.description ?? '', ...video.tags]
      .some((value) => value.toLocaleLowerCase().includes(normalizedQuery)))
    .sort((left, right) => left.aid - right.aid)
  const cursorAid = page.cursor ? Number(page.cursor) : 0
  const start = page.cursor && Number.isSafeInteger(cursorAid)
    ? Math.max(0, all.findIndex((video) => video.aid === cursorAid) + 1)
    : 0
  const items = all.slice(start, start + page.limit)
  return {
    version: 1,
    accountMid: snapshot.accountMid,
    items,
    ...(start + page.limit < all.length ? { nextCursor: String(items.at(-1)?.aid) } : {}),
    revision: snapshot.revision
  }
}

export function registerFavoriteRepositoryIpc(options: {
  ipcMain: IpcMain
  service: FavoriteRepositoryService
  isTrustedSender: (senderId: number) => boolean
  /** The embedded main-window favorite library drawer may read page snapshots but never mutate the repository. */
  isTrustedReader?: (senderId: number) => boolean
  getCurrentAccountMid: () => Promise<string>
  bindingService?: {
    adoptExistingPhysicalShard: (accountMid: string, input: {
      logicalLedgerId: string
      logicalTitle: string
      remoteDisplayTitle?: string
      expectedRemoteTitle?: string
      remoteFolderId: string
      shardNumber: number
      memberAids: number[]
      allowRemoteRename?: boolean
    }) => Promise<unknown>
    renameBoundPhysicalShard?: (accountMid: string, input: {
      logicalLedgerId: string
      logicalTitle: string
      remoteFolderId: string
      shardNumber: number
    }) => Promise<unknown>
    previewLedgerBindingCandidates?: (accountMid: string, ledgers: Array<{ ledgerId: string; title: string }>) => Promise<Array<{
      ledgerId: string
      candidates: Array<{ id: string; title: string; memberCount: number }>
    }>>
  }
  /** Clears a default user-deleted marker only after formal repository adoption commits. */
  onLedgerBindingAdopted?: (accountMid: string, logicalLedgerId: string) => Promise<unknown> | unknown
  /** Performs safe main-process reconciliation before the drawer reads a summary. */
  onAccountOpenLocal?: (accountMid: string) => Promise<void>
  /** Performs optional remote/account recovery after the first local summary is readable. */
  onAccountOpen?: (accountMid: string) => Promise<void>
  /** Returns persisted local ledger identities that are still unbound drafts. */
  getLocalDraftLedgerIds?: (accountMid: string) => readonly string[]
  /** Suppresses only the remote-only Bilimi draft reminder for this account and remote folder. */
  getRemoteDraftReminderDismissed?: (accountMid: string) => readonly string[]
  dismissRemoteDraftReminder?: (accountMid: string, remoteFolderId: string) => Promise<unknown> | unknown
  send?: (senderId: number, channel: string, payload: FavoriteRepositoryRevisionChange) => void
  getArchiveSummary?: (accountMid: string, aid: number) => FavoriteLibraryArchiveSummary
  getTranscriptionSummary?: (accountMid: string, aid: number) => FavoriteLibraryTranscriptionSummary
  commandService?: Pick<FavoriteLibraryCommandService, 'setLocalPlacements' | 'adoptRemotePlacement' | 'deleteFromLibrary' | 'restoreToLibrary' | 'forgetTombstone' | 'clearRecycledFavorite'>
  archiveService?: Pick<FavoriteRepositoryArchiveService, 'exportAccount' | 'previewImport' | 'applyImport' | 'createRestorePlanFromManagedScan' | 'executeRestorePlan' | 'reconcileRestorePlan'>
  archiveRestoreWriter?: FavoriteRepositoryRestoreWriter
  /** Injectable only for deterministic expiry tests; production uses Date.now(). */
  now?: () => number
  archiveRestoreTokenTtlMs?: number
}) {
  const accountOpenRecoveries = new Map<string, Promise<void>>()
  const subscriptions = new Map<number, Map<string, Subscription>>()
  const restoreExecutionTokens = new Map<string, ArchiveRestorePreviewToken>()
  const restoreFullConfirmationTokens = new Map<string, ArchiveRestorePreviewToken>()
  const now = options.now ?? Date.now
  const restoreTokenTtlMs = Number.isSafeInteger(options.archiveRestoreTokenTtlMs) && options.archiveRestoreTokenTtlMs! > 0
    ? options.archiveRestoreTokenTtlMs!
    : DEFAULT_ARCHIVE_RESTORE_TOKEN_TTL_MS
  const assertTrusted = (event: IpcEvent) => {
    if (!options.isTrustedSender(event.sender.id)) {
      throw new Error('Favorite repository request came from an untrusted renderer.')
    }
  }
  const assertReader = (event: IpcEvent) => {
    if (!options.isTrustedSender(event.sender.id) && !options.isTrustedReader?.(event.sender.id)) {
      throw new Error('Favorite repository request came from an untrusted renderer.')
    }
  }
  const assertCurrentAccount = async (accountMid: string) => {
    let currentAccountMid: string
    try {
      currentAccountMid = normalizedAccountMid(await options.getCurrentAccountMid())
    } catch {
      throw new Error('Favorite repository request does not match the current Bilibili account.')
    }
    if (currentAccountMid !== accountMid) {
      throw new Error('Favorite repository request does not match the current Bilibili account.')
    }
  }
  const publish = (result: FavoriteRepositoryCommandResult) => {
    const affectedFolderIds = [...new Set(result.affectedFolderIds)].slice(0, MAX_AFFECTED_FOLDER_IDS)
    const affectedFolderCount = new Set(result.affectedFolderIds).size
    for (const [senderId, records] of subscriptions) {
      for (const subscription of records.values()) {
        if (subscription.accountMid !== result.accountMid) continue
        const pageInvalidated = !subscription.folderId || result.affectedAids.length > 0 ||
          result.affectedFolderIds.includes(subscription.folderId)
        options.send?.(senderId, 'favorite-repository:revision-changed', {
          subscriptionId: subscription.id,
          accountMid: result.accountMid,
          revision: result.revision,
          affectedFolderIds,
          affectedFolderCount,
          affectedFolderIdsTruncated: affectedFolderCount > affectedFolderIds.length,
          affectedAidCount: new Set(result.affectedAids).size,
          pageInvalidated
        })
      }
    }
  }
  const subscribe = (event: IpcEvent, accountMid: string, folderId?: string) => {
    const senderId = event.sender.id
    const id = randomUUID()
    const records = subscriptions.get(senderId) ?? new Map<string, Subscription>()
    records.set(id, { id, accountMid, ...(folderId?.trim() ? { folderId: folderId.trim() } : {}) })
    subscriptions.set(senderId, records)
    event.sender.once?.('destroyed', () => subscriptions.delete(senderId))
    return id
  }
  const unsubscribe = (senderId: number, accountMid: string, subscriptionId: unknown) => {
    if (typeof subscriptionId !== 'string' || !subscriptionId) return false
    const records = subscriptions.get(senderId)
    const record = records?.get(subscriptionId)
    if (!record || record.accountMid !== accountMid) return false
    records?.delete(subscriptionId)
    if (!records?.size) subscriptions.delete(senderId)
    return true
  }
  options.ipcMain.handle('favorite-repository:adopt-ledger-binding', async (event, requestedAccountMid: string, requestedInput: unknown) => {
    assertTrusted(event)
    const accountMid = normalizedAccountMid(requestedAccountMid)
    await assertCurrentAccount(accountMid)
    if (!options.bindingService) throw new Error('Favorite repository binding is unavailable.')
    if (!requestedInput || typeof requestedInput !== 'object' || Array.isArray(requestedInput)) {
      throw new Error('Favorite repository binding input is invalid.')
    }
    const input = requestedInput as Record<string, unknown>
    const logicalLedgerId = typeof input.logicalLedgerId === 'string' ? input.logicalLedgerId.trim() : ''
    const logicalTitle = typeof input.logicalTitle === 'string' ? input.logicalTitle.trim() : ''
    const remoteFolderId = typeof input.remoteFolderId === 'string' ? input.remoteFolderId.trim() : ''
    const remoteTitle = typeof input.remoteTitle === 'string' ? input.remoteTitle.trim() : ''
    const allowRemoteRename = input.allowRemoteRename === true
    const shardNumber = input.shardNumber === undefined ? 1 : Number(input.shardNumber)
    if (!logicalLedgerId || !logicalTitle || !remoteFolderId || !remoteTitle || !Number.isSafeInteger(shardNumber) || shardNumber < 1) {
      throw new Error('Favorite repository binding input is invalid.')
    }
    const result = await options.bindingService.adoptExistingPhysicalShard(accountMid, {
      logicalLedgerId, logicalTitle, remoteDisplayTitle: remoteTitle, expectedRemoteTitle: remoteTitle,
      remoteFolderId, shardNumber, memberAids: [], ...(allowRemoteRename ? { allowRemoteRename: true } : {})
    })
    try {
      await options.onLedgerBindingAdopted?.(accountMid, logicalLedgerId)
    } catch {
      // The authoritative physical-shard binding has already committed. A
      // follow-up preference projection can retry on the next account refresh
      // but must not turn this completed exact-ID adoption into a false remote
      // binding failure for the confirmation dialog.
    }
    return result
  })
  options.ipcMain.handle('favorite-repository:rename-bound-ledger-shard', async (event, requestedAccountMid: string, requestedInput: unknown) => {
    assertTrusted(event)
    const accountMid = normalizedAccountMid(requestedAccountMid)
    await assertCurrentAccount(accountMid)
    if (!options.bindingService?.renameBoundPhysicalShard) throw new Error('Favorite repository bound shard rename is unavailable.')
    if (!requestedInput || typeof requestedInput !== 'object' || Array.isArray(requestedInput)) {
      throw new Error('Favorite repository bound shard rename input is invalid.')
    }
    const input = requestedInput as Record<string, unknown>
    const logicalLedgerId = typeof input.logicalLedgerId === 'string' ? input.logicalLedgerId.trim() : ''
    const logicalTitle = typeof input.logicalTitle === 'string' ? input.logicalTitle.trim() : ''
    const remoteFolderId = typeof input.remoteFolderId === 'string' ? input.remoteFolderId.trim() : ''
    const shardNumber = Number(input.shardNumber)
    if (!logicalLedgerId || !logicalTitle || !remoteFolderId || !Number.isSafeInteger(shardNumber) || shardNumber < 1) {
      throw new Error('Favorite repository bound shard rename input is invalid.')
    }
    const result = await options.bindingService.renameBoundPhysicalShard(accountMid, {
      logicalLedgerId, logicalTitle, remoteFolderId, shardNumber
    })
    try {
      await options.onLedgerBindingAdopted?.(accountMid, logicalLedgerId)
    } catch {
      // The authoritative exact-ID title update already committed. Preference
      // projection can safely catch up during a later account refresh.
    }
    return result
  })
  options.ipcMain.handle('favorite-repository:preview-ledger-binding-candidates', async (event, requestedAccountMid: string, requestedLedgers: unknown) => {
    assertTrusted(event)
    const accountMid = normalizedAccountMid(requestedAccountMid)
    await assertCurrentAccount(accountMid)
    if (!options.bindingService?.previewLedgerBindingCandidates || !Array.isArray(requestedLedgers) || !requestedLedgers.length || requestedLedgers.length > 100) {
      throw new Error('Favorite repository binding preview is invalid.')
    }
    const ledgers = requestedLedgers.map((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Favorite repository binding preview is invalid.')
      const ledger = value as { ledgerId?: unknown; title?: unknown }
      const ledgerId = typeof ledger.ledgerId === 'string' ? ledger.ledgerId.trim() : ''
      const title = typeof ledger.title === 'string' ? ledger.title.trim() : ''
      if (!ledgerId || !title) throw new Error('Favorite repository binding preview is invalid.')
      return { ledgerId, title }
    })
    if (new Set(ledgers.map((ledger) => ledger.ledgerId)).size !== ledgers.length) {
      throw new Error('Favorite repository binding preview is invalid.')
    }
    return options.bindingService.previewLedgerBindingCandidates(accountMid, ledgers)
  })
  const issueRestoreToken = (
    tokens: Map<string, ArchiveRestorePreviewToken>,
    senderId: number,
    plan: FavoriteRepositoryRestorePlan
  ) => {
    const timestamp = now()
    for (const [token, record] of tokens) {
      if (record.expiresAt <= timestamp) tokens.delete(token)
    }
    const token = randomUUID()
    tokens.set(token, {
      senderId,
      accountMid: plan.accountMid,
      mode: plan.mode,
      digest: restorePlanDigest(plan),
      expiresAt: timestamp + restoreTokenTtlMs
    })
    return token
  }
  const assertRestoreToken = (
    tokens: Map<string, ArchiveRestorePreviewToken>,
    token: unknown,
    senderId: number,
    plan: FavoriteRepositoryRestorePlan,
    label: 'execution' | 'second confirmation'
  ) => {
    if (typeof token !== 'string' || !token) {
      throw new Error(`Favorite repository archive restore requires an ${label} token.`)
    }
    const record = tokens.get(token)
    if (!record) throw new Error('Favorite repository archive restore token does not match a preview.')
    if (record.expiresAt <= now()) {
      tokens.delete(token)
      throw new Error('Favorite repository archive restore token expired.')
    }
    if (record.senderId !== senderId || record.accountMid !== plan.accountMid || record.mode !== plan.mode || record.digest !== restorePlanDigest(plan)) {
      throw new Error('Favorite repository archive restore token does not match the preview.')
    }
  }
  const servicePublishesChanges = typeof options.service.onChanged === 'function'
  options.service.onChanged?.(publish)

  const recoverAccountInBackground = (accountMid: string) => {
    if (!options.onAccountOpen || accountOpenRecoveries.has(accountMid)) return
    const recovery = options.onAccountOpen(accountMid).catch(() => undefined).finally(() => {
      accountOpenRecoveries.delete(accountMid)
    })
    accountOpenRecoveries.set(accountMid, recovery)
  }

  options.ipcMain.handle('favorite-repository:open-account', async (event, requestedAccountMid: string) => {
    assertReader(event)
    const accountMid = normalizedAccountMid(requestedAccountMid)
    await assertCurrentAccount(accountMid)
    // Both repairs are local-only and bounded. First complete durable facts
    // checkpointed after a Bilibili success; then repair the older renderer-era
    // half-write shape before publishing the first authoritative snapshot.
    if (options.service.recoverConfirmedReviewFavorites) {
      await options.service.recoverConfirmedReviewFavorites(accountMid)
    }
    if (options.service.repairLegacyConfirmedReviewFavorites) {
      await options.service.repairLegacyConfirmedReviewFavorites(accountMid)
    }
    // The first summary must include the latest local physical-shard projection,
    // while remote inventory recovery remains deferred so startup stays responsive.
    if (options.onAccountOpenLocal) {
      await options.onAccountOpenLocal(accountMid)
    }
    // Reconciliation enriches the local projection but must not block reading
    // an already usable library when the page runtime is unavailable.
    recoverAccountInBackground(accountMid)
    const localDraftLedgerIds = options.getLocalDraftLedgerIds?.(accountMid)
    return localDraftLedgerIds
      ? options.service.getLibrarySummary(accountMid, { localDraftLedgerIds })
      : options.service.getLibrarySummary(accountMid)
  })
  options.ipcMain.handle('favorite-repository:get-snapshot', async (event, requestedAccountMid: string) => {
    assertReader(event)
    const accountMid = normalizedAccountMid(requestedAccountMid)
    await assertCurrentAccount(accountMid)
    const localDraftLedgerIds = options.getLocalDraftLedgerIds?.(accountMid)
    return localDraftLedgerIds
      ? options.service.getLibrarySummary(accountMid, { localDraftLedgerIds })
      : options.service.getLibrarySummary(accountMid)
  })
  options.ipcMain.handle('favorite-repository:get-remote-draft-reminder-dismissals', async (event, requestedAccountMid: string) => {
    assertTrusted(event)
    const accountMid = normalizedAccountMid(requestedAccountMid)
    await assertCurrentAccount(accountMid)
    return options.getRemoteDraftReminderDismissed?.(accountMid) ?? []
  })
  options.ipcMain.handle('favorite-repository:dismiss-remote-draft-reminder', async (event, requestedAccountMid: string, requestedRemoteFolderId: string) => {
    assertTrusted(event)
    const accountMid = normalizedAccountMid(requestedAccountMid)
    await assertCurrentAccount(accountMid)
    if (!options.dismissRemoteDraftReminder) throw new Error('Favorite ledger remote draft reminder is unavailable.')
    if (typeof requestedRemoteFolderId !== 'string' || !requestedRemoteFolderId.trim()) throw new Error('Favorite ledger remote draft reminder folder is invalid.')
    return options.dismissRemoteDraftReminder(accountMid, requestedRemoteFolderId.trim())
  })
  options.ipcMain.handle('favorite-repository:get-folder-page', async (
    event, requestedAccountMid: string, folderId: string, requestedOptions: FolderPageOptions
  ) => {
    assertReader(event)
    const accountMid = normalizedAccountMid(requestedAccountMid)
    await assertCurrentAccount(accountMid)
    return options.service.getFolderPage(accountMid, folderId, pageOptions(requestedOptions))
  })
  options.ipcMain.handle('favorite-repository:search-page', async (
    event, requestedAccountMid: string, query: string, requestedOptions: FolderPageOptions
  ) => {
    assertReader(event)
    const accountMid = normalizedAccountMid(requestedAccountMid)
    await assertCurrentAccount(accountMid)
    return searchPage(await options.service.getSnapshot(accountMid), query, requestedOptions)
  })
  options.ipcMain.handle('favorite-repository:get-library-page', async (
    event, requestedAccountMid: string, requestedScope: LibraryPageScope, requestedOptions: FolderPageOptions
  ) => {
    assertReader(event)
    const accountMid = normalizedAccountMid(requestedAccountMid)
    await assertCurrentAccount(accountMid)
    return options.service.getLibraryPage(accountMid, libraryPageScope(requestedScope), libraryPageOptions(requestedOptions))
  })
  options.ipcMain.handle('favorite-repository:get-library-video-detail', async (
    event, requestedAccountMid: string, requestedAid: unknown
  ) => {
    assertReader(event)
    const accountMid = normalizedAccountMid(requestedAccountMid)
    await assertCurrentAccount(accountMid)
    const detail = await options.service.getLibraryDetail(accountMid, videoAid(requestedAid))
    if (!detail) throw new Error('所选视频暂时无法读取，请重新加载收藏库后重试。')
    return {
      ...detail,
      archive: options.getArchiveSummary?.(accountMid, detail.video.aid) ?? {
        status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false
      },
      transcription: options.getTranscriptionSummary?.(accountMid, detail.video.aid) ?? { status: '未转写' }
    } satisfies FavoriteRepositoryLibraryVideoDetail
  })
  options.ipcMain.handle('favorite-repository:get-library-video-events', async (
    event, requestedAccountMid: string, requestedAid: unknown, requestedOptions: FolderPageOptions
  ) => {
    assertReader(event)
    const accountMid = normalizedAccountMid(requestedAccountMid)
    await assertCurrentAccount(accountMid)
    return options.service.getEventPage(accountMid, videoAid(requestedAid), pageOptions(requestedOptions))
  })
  options.ipcMain.handle('favorite-repository:get-library-video-classification-adjustments', async (
    event, requestedAccountMid: string, requestedAid: unknown, requestedOptions: FolderPageOptions
  ) => {
    assertReader(event)
    const accountMid = normalizedAccountMid(requestedAccountMid)
    await assertCurrentAccount(accountMid)
    return options.service.getClassificationAdjustmentPage(accountMid, videoAid(requestedAid), pageOptions(requestedOptions))
  })
  options.ipcMain.handle('favorite-repository:get-organization-changes', async (event, requestedAccountMid: string) => {
    assertReader(event)
    const accountMid = normalizedAccountMid(requestedAccountMid)
    await assertCurrentAccount(accountMid)
    return options.service.getOrganizationChanges(accountMid)
  })
  options.ipcMain.handle('favorite-library:set-local-placements', async (
    event, requestedAccountMid: string, requestedPlacements: unknown, requestedRevision: unknown, synchronize: unknown
  ) => {
    assertTrusted(event)
    const accountMid = normalizedAccountMid(requestedAccountMid)
    await assertCurrentAccount(accountMid)
    if (synchronize !== undefined && typeof synchronize !== 'boolean') throw new Error('Favorite library synchronization option is invalid.')
    if (!options.commandService) throw new Error('Favorite library placement is unavailable.')
    return options.commandService.setLocalPlacements(accountMid, localPlacementInputs(requestedPlacements), expectedRevision(requestedRevision), synchronize === true)
  })
  options.ipcMain.handle('favorite-library:adopt-remote-placement', async (event, requestedAccountMid: string, requestedAid: unknown, requestedRevision: unknown) => {
    assertTrusted(event)
    const accountMid = normalizedAccountMid(requestedAccountMid)
    await assertCurrentAccount(accountMid)
    if (!options.commandService) throw new Error('Favorite library placement is unavailable.')
    return options.commandService.adoptRemotePlacement(accountMid, videoAid(requestedAid), expectedRevision(requestedRevision))
  })
  for (const [channel, method] of [
    ['favorite-library:delete-from-library', 'deleteFromLibrary'],
    ['favorite-library:restore-to-library', 'restoreToLibrary'],
    ['favorite-library:forget-tombstone', 'forgetTombstone'],
    ['favorite-library:clear-recycled', 'clearRecycledFavorite']
  ] as const) {
    options.ipcMain.handle(channel, async (event, requestedAccountMid: string, requestedAid: unknown, requestedRevision: unknown) => {
      assertTrusted(event)
      const accountMid = normalizedAccountMid(requestedAccountMid)
      await assertCurrentAccount(accountMid)
      if (!options.commandService) throw new Error('Favorite library lifecycle action is unavailable.')
      return options.commandService[method](accountMid, videoAid(requestedAid), expectedRevision(requestedRevision))
    })
  }
  const retiredGlobalUnfavorite = (event: IpcEvent) => {
    assertTrusted(event)
    throw new Error('The global Bilibili unfavorite operation is retired; remove a bound Bilimi work-folder placement instead.')
  }
  options.ipcMain.handle('favorite-library:unfavorite-preview', retiredGlobalUnfavorite)
  options.ipcMain.handle('favorite-library:unfavorite-confirm', retiredGlobalUnfavorite)
  options.ipcMain.handle('favorite-library:execute-unfavorite', retiredGlobalUnfavorite)
  options.ipcMain.handle('favorite-repository:archive-export', async (event, requestedAccountMid: string) => {
    assertTrusted(event)
    const accountMid = normalizedAccountMid(requestedAccountMid)
    await assertCurrentAccount(accountMid)
    if (!options.archiveService) throw new Error('Favorite repository archive is unavailable.')
    return options.archiveService.exportAccount(accountMid)
  })
  options.ipcMain.handle('favorite-repository:archive-preview-import', async (event, requestedAccountMid: string, input: unknown) => {
    assertTrusted(event)
    const accountMid = normalizedAccountMid(requestedAccountMid)
    await assertCurrentAccount(accountMid)
    if (!options.archiveService) throw new Error('Favorite repository archive is unavailable.')
    return options.archiveService.previewImport(input, accountMid)
  })
  options.ipcMain.handle('favorite-repository:archive-apply-import', async (event, requestedAccountMid: string, input: unknown) => {
    assertTrusted(event)
    const accountMid = normalizedAccountMid(requestedAccountMid)
    await assertCurrentAccount(accountMid)
    if (!options.archiveService) throw new Error('Favorite repository archive is unavailable.')
    return options.archiveService.applyImport(input, accountMid)
  })
  options.ipcMain.handle('favorite-repository:archive-restore-plan', async (event, requestedAccountMid: string, input: unknown, mode: unknown, requestedScope: unknown) => {
    assertTrusted(event)
    const accountMid = normalizedAccountMid(requestedAccountMid)
    await assertCurrentAccount(accountMid)
    if (!options.archiveService || !options.archiveRestoreWriter) throw new Error('Favorite repository archive is unavailable.')
    // Remote membership is read through the main-process bound-shard writer.
    // The renderer never supplies either logical observations or physical IDs.
    const scope = archiveRestoreScope(requestedScope)
    const aids = scope.kind === 'aids'
      ? scope.aids
      : scope.kind === 'logical-folder'
        ? await options.service.resolveArchiveRestoreLogicalFolderAids(accountMid, scope.folderId)
        : undefined
    const scannedPlan = aids
      ? await options.archiveService.createRestorePlanFromManagedScan(input as never, restoreMode(mode), options.archiveRestoreWriter, aids)
      : await options.archiveService.createRestorePlanFromManagedScan(input as never, restoreMode(mode), options.archiveRestoreWriter)
    const plan = restorePlan(scannedPlan)
    if (normalizedAccountMid(plan.accountMid) !== accountMid) throw new Error('Favorite repository archive account mismatch.')
    return {
      ...plan,
      executionToken: issueRestoreToken(restoreExecutionTokens, event.sender.id, plan),
      confirmationRequired: plan.mode === 'full'
    } satisfies FavoriteRepositoryArchiveRestorePreview
  })
  options.ipcMain.handle('favorite-repository:archive-confirm-full-restore', async (
    event, requestedAccountMid: string, requestedPlan: unknown, executionToken: unknown
  ) => {
    assertTrusted(event)
    const accountMid = normalizedAccountMid(requestedAccountMid)
    await assertCurrentAccount(accountMid)
    const plan = restorePlan(requestedPlan)
    if (plan.accountMid !== accountMid || plan.mode !== 'full') {
      throw new Error('Favorite repository archive full restore confirmation is unavailable.')
    }
    assertRestoreToken(restoreExecutionTokens, executionToken, event.sender.id, plan, 'execution')
    return { confirmationToken: issueRestoreToken(restoreFullConfirmationTokens, event.sender.id, plan) } satisfies FavoriteRepositoryArchiveFullRestoreConfirmation
  })
  for (const [channel, method] of [
    ['favorite-repository:archive-execute-restore', 'executeRestorePlan'],
    ['favorite-repository:archive-reconcile-restore', 'reconcileRestorePlan']
  ] as const) {
    options.ipcMain.handle(channel, async (
      event, requestedAccountMid: string, requestedPlan: unknown, executionToken: unknown, fullConfirmationToken?: unknown
    ) => {
      assertTrusted(event)
      const accountMid = normalizedAccountMid(requestedAccountMid)
      await assertCurrentAccount(accountMid)
      const plan = restorePlan(requestedPlan)
      if (plan.accountMid !== accountMid || !options.archiveService || !options.archiveRestoreWriter) {
        throw new Error('Favorite repository archive restore is unavailable.')
      }
      assertRestoreToken(restoreExecutionTokens, executionToken, event.sender.id, plan, 'execution')
      if (method === 'executeRestorePlan' && plan.mode === 'full') {
        assertRestoreToken(restoreFullConfirmationTokens, fullConfirmationToken, event.sender.id, plan, 'second confirmation')
      }
      const result = await options.archiveService[method](plan, options.archiveRestoreWriter)
      if (method === 'executeRestorePlan' && plan.mode === 'full' && typeof fullConfirmationToken === 'string') {
        restoreFullConfirmationTokens.delete(fullConfirmationToken)
      }
      return result
    })
  }
  options.ipcMain.handle('favorite-repository:commit-command', async (
    event, requestedAccountMid: string, requestedCommand: FavoriteRepositoryCommand
  ) => {
    assertTrusted(event)
    const accountMid = normalizedAccountMid(requestedAccountMid)
    await assertCurrentAccount(accountMid)
    const result = await options.service.commit(accountMid, commandForAccount(requestedCommand, accountMid))
    if (!servicePublishesChanges) publish(result)
    return result
  })
  options.ipcMain.handle('favorite-repository:commit-confirmed-review', async (
    event, requestedAccountMid: string, requestedInput: FavoriteRepositoryConfirmedReviewInput
  ) => {
    assertTrusted(event)
    const accountMid = normalizedAccountMid(requestedAccountMid)
    await assertCurrentAccount(accountMid)
    const result = await options.service.commitConfirmedReviewFavorite(accountMid, requestedInput)
    if (!servicePublishesChanges) publish(result)
    return result
  })
  options.ipcMain.handle('favorite-repository:checkpoint-confirmed-review', async (
    event, requestedAccountMid: string, requestedInput: FavoriteRepositoryConfirmedReviewInput
  ) => {
    assertTrusted(event)
    const accountMid = normalizedAccountMid(requestedAccountMid)
    await assertCurrentAccount(accountMid)
    await options.service.checkpointConfirmedReviewFavorite(accountMid, requestedInput)
  })
  options.ipcMain.handle('favorite-repository:subscribe', async (event, requestedAccountMid: string, folderId?: string) => {
    assertReader(event)
    const accountMid = normalizedAccountMid(requestedAccountMid)
    await assertCurrentAccount(accountMid)
    return subscribe(event, accountMid, folderId)
  })
  options.ipcMain.handle('favorite-repository:unsubscribe', async (event, requestedAccountMid: string, subscriptionId: string) => {
    assertReader(event)
    const accountMid = normalizedAccountMid(requestedAccountMid)
    return unsubscribe(event.sender.id, accountMid, subscriptionId)
  })

  return {
    removeSender(senderId: number) {
      subscriptions.delete(senderId)
    }
  }
}
