import { randomUUID } from 'node:crypto'
import type {
  AccountFavoriteRepositorySnapshot,
  FavoriteRepositoryCommand,
  FavoriteRepositoryCommandResult,
  FavoriteRepositoryFolder,
  FavoriteRepositoryPage,
  FavoriteRepositoryVideo
} from '../../src/shared/favoriteRepository'
import type { FavoriteRepositoryLibraryDetail, FavoriteRepositoryService } from './favoriteRepositoryService'

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

const MAX_AFFECTED_FOLDER_IDS = 100

export type FavoriteRepositorySnapshotSummary = {
  version: 1
  accountMid: string
  revision: number
  updatedAt: string
  videoCount: number
  folderCount: number
  folders: FavoriteRepositoryFolder[]
  physicalShardCount: number
  syncRecordCount: number
  syncCounts: Record<'pending' | 'succeeded' | 'failed' | 'result-unknown', number>
  pendingAidCount: number
  workspace?: {
    id: string
    status: AccountFavoriteRepositorySnapshot['workspace']['status']
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
  pendingStates: Array<'unsynced' | 'continuation' | 'failed' | 'result-unknown'>
}

export type FavoriteRepositoryLibraryPage = FavoriteRepositoryPage<FavoriteRepositoryLibraryRow>

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
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500 || (cursor !== undefined && typeof cursor !== 'string')) {
    throw new Error('Favorite repository page options are invalid.')
  }
  return cursor ? { limit, cursor } : { limit }
}

function libraryPageScope(value: unknown): LibraryPageScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Favorite library page scope is invalid.')
  }
  const candidate = value as { kind?: unknown; folderId?: unknown }
  if (candidate.kind === 'all' && Object.keys(candidate).length === 1) return { kind: 'all' }
  if (candidate.kind === 'pending' && Object.keys(candidate).length === 1) return { kind: 'pending' }
  if (candidate.kind === 'folder' && typeof candidate.folderId === 'string' && candidate.folderId.trim() && Object.keys(candidate).length === 2) {
    return { kind: 'folder', folderId: candidate.folderId.trim() }
  }
  throw new Error('Favorite library page scope is invalid.')
}

function videoAid(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error('Favorite library video is invalid.')
  return Number(value)
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
    (value as { type?: unknown }).type === 'commit-local-plan'
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
  /** A library window may read page snapshots but never mutate the repository. */
  isTrustedReader?: (senderId: number) => boolean
  getCurrentAccountMid: () => Promise<string>
  send?: (senderId: number, channel: string, payload: FavoriteRepositoryRevisionChange) => void
  getArchiveSummary?: (accountMid: string, aid: number) => FavoriteLibraryArchiveSummary
  getTranscriptionSummary?: (accountMid: string, aid: number) => FavoriteLibraryTranscriptionSummary
}) {
  const subscriptions = new Map<number, Map<string, Subscription>>()
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
  options.ipcMain.handle('favorite-repository:commit-command', async (
    event, requestedAccountMid: string, requestedCommand: FavoriteRepositoryCommand
  ) => {
    assertTrusted(event)
    const accountMid = normalizedAccountMid(requestedAccountMid)
    await assertCurrentAccount(accountMid)
    const result = await options.service.commit(accountMid, commandForAccount(requestedCommand, accountMid))
    publish(result)
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
