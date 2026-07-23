import { createHash, randomUUID } from 'node:crypto'
import type {
  AccountFavoriteRepositorySnapshot,
  FavoriteRepositoryCommand,
  FavoriteRepositoryCommandResult,
  FavoriteRepositoryEvent,
  FavoriteRepositoryFolder,
  FavoriteRepositoryOrganizationChange,
  FavoriteRepositoryPage,
  FavoriteRepositoryVideo
} from '../../src/shared/favoriteRepository'
import type { FavoriteRepositoryLibraryDetail, FavoriteRepositoryService } from './favoriteRepositoryService'
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
type Subscription = { id: string; accountMid: string; folderId?: string }
type LibraryPageScope =
  | { kind: 'all' }
  | { kind: 'folder'; folderId: string }
  | { kind: 'pending' }
  | { kind: 'protected' }
  | { kind: 'unsynced' }

const MAX_AFFECTED_FOLDER_IDS = 100
const DEFAULT_ARCHIVE_RESTORE_TOKEN_TTL_MS = 5 * 60 * 1000
const DEFAULT_REMOTE_UNFAVORITE_TOKEN_TTL_MS = 5 * 60 * 1000

type ArchiveRestorePreviewToken = {
  senderId: number
  accountMid: string
  mode: FavoriteRepositoryRestorePlan['mode']
  digest: string
  expiresAt: number
}

type RemoteUnfavoriteToken = {
  senderId: number
  accountMid: string
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
  folderCounts: Record<string, number>
  scopeCounts: { all: number; pending: number; protected: number; unsynced: number }
  folderConflicts?: Array<{ title: string; folderIds: string[] }>
  physicalShardCount: number
  syncRecordCount: number
  syncCounts: Record<'pending' | 'succeeded' | 'failed' | 'result-unknown', number>
  pendingAidCount: number
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
}

export type FavoriteRepositoryLibraryPage = FavoriteRepositoryPage<FavoriteRepositoryLibraryRow>
export type FavoriteRepositoryOrganizationChanges = FavoriteRepositoryOrganizationChange[]
export type FavoriteRepositoryEventPage = FavoriteRepositoryPage<FavoriteRepositoryEvent>
export type FavoriteRepositoryArchiveRestorePreview = FavoriteRepositoryRestorePlan & {
  executionToken: string
  confirmationRequired: boolean
}
export type FavoriteRepositoryArchiveFullRestoreConfirmation = { confirmationToken: string }
export type FavoriteRepositoryArchiveRestoreScope =
  | { kind: 'all' }
  | { kind: 'aids'; aids: number[] }
  | { kind: 'logical-folder'; folderId: string }
export type FavoriteLibraryUnfavoritePreview = {
  accountMid: string
  aids: number[]
  executionToken: string
  expiresAt: number
}
export type FavoriteLibraryUnfavoriteConfirmation = { confirmationToken: string }

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

function libraryPageScope(value: unknown): LibraryPageScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Favorite library page scope is invalid.')
  }
  const candidate = value as { kind?: unknown; folderId?: unknown }
  if (candidate.kind === 'all' && Object.keys(candidate).length === 1) return { kind: 'all' }
  if ((candidate.kind === 'pending' || candidate.kind === 'protected' || candidate.kind === 'unsynced') && Object.keys(candidate).length === 1) return { kind: candidate.kind }
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

function unfavoriteAids(value: unknown) {
  const aids = Array.isArray(value) ? Array.from(value) : []
  if (!aids.length || aids.length > 100 || new Set(aids).size !== aids.length || aids.some((aid) => !Number.isSafeInteger(aid) || Number(aid) <= 0)) {
    throw new Error('Favorite library unfavorite selection is invalid.')
  }
  return [...new Set(aids.map(Number))].sort((left, right) => left - right)
}

function unfavoriteDigest(accountMid: string, aids: number[]) {
  return createHash('sha256').update(JSON.stringify({ accountMid, aids })).digest('hex')
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

function createSummary(snapshot: AccountFavoriteRepositorySnapshot): FavoriteRepositorySnapshotSummary {
  const syncCounts: FavoriteRepositorySnapshotSummary['syncCounts'] = {
    pending: 0, succeeded: 0, failed: 0, 'result-unknown': 0
  }
  for (const record of snapshot.syncRecords) syncCounts[record.status]++
  const pendingAids = new Set<number>(snapshot.workspace?.continuationAids ?? [])
  for (const record of snapshot.syncRecords) {
    if (record.status === 'pending' || record.status === 'failed' || record.status === 'result-unknown') {
      for (const aid of record.affectedAids) pendingAids.add(aid)
    }
  }
  return {
    version: 1,
    accountMid: snapshot.accountMid,
    revision: snapshot.revision,
    updatedAt: snapshot.updatedAt,
    videoCount: Object.keys(snapshot.videos).length,
    folderCount: snapshot.folders.length,
    folders: snapshot.folders.map((folder) => ({ ...folder })),
    physicalShardCount: snapshot.physicalShards.length,
    syncRecordCount: snapshot.syncRecords.length,
    syncCounts,
    pendingAidCount: pendingAids.size,
    ...(snapshot.workspace ? {
      workspace: {
        id: snapshot.workspace.id,
        status: snapshot.workspace.status,
        baselineRevision: snapshot.workspace.baselineRevision,
        continuationCount: snapshot.workspace.continuationAids.length
      }
    } : {})
  }
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
  send?: (senderId: number, channel: string, payload: FavoriteRepositoryRevisionChange) => void
  getArchiveSummary?: (accountMid: string, aid: number) => FavoriteLibraryArchiveSummary
  getTranscriptionSummary?: (accountMid: string, aid: number) => FavoriteLibraryTranscriptionSummary
  commandService?: Pick<FavoriteLibraryCommandService, 'setLocalPlacements' | 'adoptRemotePlacement' | 'deleteFromLibrary' | 'restoreToLibrary' | 'forgetTombstone' | 'cancelBilibiliFavorites'>
  archiveService?: Pick<FavoriteRepositoryArchiveService, 'exportAccount' | 'previewImport' | 'applyImport' | 'createRestorePlanFromManagedScan' | 'executeRestorePlan' | 'reconcileRestorePlan'>
  archiveRestoreWriter?: FavoriteRepositoryRestoreWriter
  /** Injectable only for deterministic expiry tests; production uses Date.now(). */
  now?: () => number
  archiveRestoreTokenTtlMs?: number
  remoteUnfavoriteTokenTtlMs?: number
}) {
  const subscriptions = new Map<number, Map<string, Subscription>>()
  const restoreExecutionTokens = new Map<string, ArchiveRestorePreviewToken>()
  const restoreFullConfirmationTokens = new Map<string, ArchiveRestorePreviewToken>()
  const remoteUnfavoriteExecutionTokens = new Map<string, RemoteUnfavoriteToken>()
  const remoteUnfavoriteConfirmationTokens = new Map<string, RemoteUnfavoriteToken>()
  const now = options.now ?? Date.now
  const restoreTokenTtlMs = Number.isSafeInteger(options.archiveRestoreTokenTtlMs) && options.archiveRestoreTokenTtlMs! > 0
    ? options.archiveRestoreTokenTtlMs!
    : DEFAULT_ARCHIVE_RESTORE_TOKEN_TTL_MS
  const remoteUnfavoriteTokenTtlMs = Number.isSafeInteger(options.remoteUnfavoriteTokenTtlMs) && options.remoteUnfavoriteTokenTtlMs! > 0
    ? options.remoteUnfavoriteTokenTtlMs!
    : DEFAULT_REMOTE_UNFAVORITE_TOKEN_TTL_MS
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
        const pageInvalidated = !subscription.folderId || result.affectedFolderIds.includes(subscription.folderId)
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
  const issueRemoteUnfavoriteToken = (tokens: Map<string, RemoteUnfavoriteToken>, senderId: number, accountMid: string, aids: number[]) => {
    const timestamp = now()
    for (const [token, record] of tokens) if (record.expiresAt <= timestamp) tokens.delete(token)
    const token = randomUUID()
    tokens.set(token, {
      senderId, accountMid, digest: unfavoriteDigest(accountMid, aids), expiresAt: timestamp + remoteUnfavoriteTokenTtlMs
    })
    return { token, expiresAt: timestamp + remoteUnfavoriteTokenTtlMs }
  }
  const assertRemoteUnfavoriteToken = (
    tokens: Map<string, RemoteUnfavoriteToken>, token: unknown, senderId: number, accountMid: string, aids: number[], label: 'execution' | 'second confirmation'
  ) => {
    if (typeof token !== 'string' || !token) throw new Error(`Favorite library unfavorite requires an ${label} token.`)
    const record = tokens.get(token)
    if (!record) throw new Error('Favorite library unfavorite token does not match the preview.')
    if (record.expiresAt <= now()) {
      tokens.delete(token)
      throw new Error('Favorite library unfavorite token expired.')
    }
    if (record.senderId !== senderId || record.accountMid !== accountMid || record.digest !== unfavoriteDigest(accountMid, aids)) {
      throw new Error('Favorite library unfavorite token does not match the preview.')
    }
  }

  const servicePublishesChanges = typeof options.service.onChanged === 'function'
  options.service.onChanged?.(publish)

  options.ipcMain.handle('favorite-repository:open-account', async (event, requestedAccountMid: string) => {
    assertReader(event)
    const accountMid = normalizedAccountMid(requestedAccountMid)
    await assertCurrentAccount(accountMid)
    return options.service.getLibrarySummary(accountMid)
  })
  options.ipcMain.handle('favorite-repository:get-snapshot', async (event, requestedAccountMid: string) => {
    assertReader(event)
    const accountMid = normalizedAccountMid(requestedAccountMid)
    await assertCurrentAccount(accountMid)
    return createSummary(await options.service.getSnapshot(accountMid))
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
    return options.service.getLibraryPage(accountMid, libraryPageScope(requestedScope), pageOptions(requestedOptions))
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
    ['favorite-library:forget-tombstone', 'forgetTombstone']
  ] as const) {
    options.ipcMain.handle(channel, async (event, requestedAccountMid: string, requestedAid: unknown, requestedRevision: unknown) => {
      assertTrusted(event)
      const accountMid = normalizedAccountMid(requestedAccountMid)
      await assertCurrentAccount(accountMid)
      if (!options.commandService) throw new Error('Favorite library lifecycle action is unavailable.')
      return options.commandService[method](accountMid, videoAid(requestedAid), expectedRevision(requestedRevision))
    })
  }
  options.ipcMain.handle('favorite-library:unfavorite-preview', async (event, requestedAccountMid: string, requestedAids: unknown) => {
    assertTrusted(event)
    const accountMid = normalizedAccountMid(requestedAccountMid)
    await assertCurrentAccount(accountMid)
    if (!options.commandService) throw new Error('Favorite library Bilibili unfavorite is unavailable.')
    const aids = unfavoriteAids(requestedAids)
    const issued = issueRemoteUnfavoriteToken(remoteUnfavoriteExecutionTokens, event.sender.id, accountMid, aids)
    return { accountMid, aids, executionToken: issued.token, expiresAt: issued.expiresAt } satisfies FavoriteLibraryUnfavoritePreview
  })
  options.ipcMain.handle('favorite-library:unfavorite-confirm', async (
    event, requestedAccountMid: string, requestedAids: unknown, executionToken: unknown
  ) => {
    assertTrusted(event)
    const accountMid = normalizedAccountMid(requestedAccountMid)
    await assertCurrentAccount(accountMid)
    const aids = unfavoriteAids(requestedAids)
    assertRemoteUnfavoriteToken(remoteUnfavoriteExecutionTokens, executionToken, event.sender.id, accountMid, aids, 'execution')
    return {
      confirmationToken: issueRemoteUnfavoriteToken(remoteUnfavoriteConfirmationTokens, event.sender.id, accountMid, aids).token
    } satisfies FavoriteLibraryUnfavoriteConfirmation
  })
  options.ipcMain.handle('favorite-library:execute-unfavorite', async (
    event, requestedAccountMid: string, requestedAids: unknown, executionToken: unknown, confirmationToken: unknown
  ) => {
    assertTrusted(event)
    const accountMid = normalizedAccountMid(requestedAccountMid)
    await assertCurrentAccount(accountMid)
    if (!options.commandService) throw new Error('Favorite library Bilibili unfavorite is unavailable.')
    const aids = unfavoriteAids(requestedAids)
    assertRemoteUnfavoriteToken(remoteUnfavoriteExecutionTokens, executionToken, event.sender.id, accountMid, aids, 'execution')
    assertRemoteUnfavoriteToken(remoteUnfavoriteConfirmationTokens, confirmationToken, event.sender.id, accountMid, aids, 'second confirmation')
    // A dangerous authorization is one-shot even if the remote outcome is unknown.
    remoteUnfavoriteConfirmationTokens.delete(confirmationToken as string)
    return options.commandService.cancelBilibiliFavorites(accountMid, aids)
  })
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
