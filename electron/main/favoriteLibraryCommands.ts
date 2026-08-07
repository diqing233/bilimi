import { randomUUID } from 'node:crypto'
import type { AccountFavoriteRepositorySnapshot, FavoriteRepositoryVideo } from '../../src/shared/favoriteRepository'
import type { VideoAudioTranscriptionRequest } from '../../src/shared/types'
import type { FavoriteRepositoryService } from './favoriteRepositoryService'
import type { FavoriteRepositoryLibraryFilter, FavoriteRepositoryLibraryPageScope, FavoriteRepositoryLibrarySort, FavoriteRepositoryLibraryStateFilters, FavoriteRepositoryTranscriptionFilter } from './favoriteRepositoryService'

const MAX_SELECTION_AIDS = 500
const PLACEMENT_SYNC_CHUNK_SIZE = 100

export type FavoriteLibrarySyncSelection =
  | { kind: 'aids'; aids: number[] }
  | { kind: 'folder'; folderId: string }

export type FavoriteLibraryScopeSelection = {
  kind: 'scope'
  scope: FavoriteRepositoryLibraryPageScope
  options: { query?: string; filter?: FavoriteRepositoryLibraryFilter; stateFilters?: FavoriteRepositoryLibraryStateFilters; sort?: FavoriteRepositoryLibrarySort; transcriptionFilters?: FavoriteRepositoryTranscriptionFilter[] }
  excludedAids: number[]
}

export type FavoriteLibraryCommandResult = {
  status: 'succeeded' | 'failed' | 'queued' | 'result-unknown'
  completedOperationCount: number
  totalOperationCount: number
  affectedAids: number[]
  reason?: string
}

export type FavoriteLibraryPlacementInput = { aid: number; folderIds: string[] }
export type FavoriteLibraryTranscriptionTarget = { aid: number; cid?: number }

export type FavoriteLibraryPlacementSync = {
  synchronizePlacements(accountMid: string, aids: number[]): Promise<FavoriteLibraryCommandResult>
}

/** Kept separate from local record lifecycle commands: it only changes Bilibili's favorite state. */
export type FavoriteLibraryRemoteUnfavorite = {
  /** Runs immediately before each irreversible page write while it owns the shared remote arbiter slot. */
  unfavorite(accountMid: string, aids: number[], options?: { beforeRemoteWrite?: () => Promise<void> }): Promise<FavoriteLibraryCommandResult>
}

type UnfavoritePageBridgeManager = {
  bind(accountMid: string, runId: string): Promise<void>
  pageBridge(accountMid: string, runId: string): {
    unfavorite(input: { accountMid: string; operationKey: string; aid: number }): Promise<{ observedAccountMid: string }>
  }
  release(accountMid: string, runId: string): void
}

type RemoteOperationQueue = {
  enqueue<T>(accountMid: string, options: { priority: 'user-single'; videoKey: string }, operation: () => Promise<T>): Promise<T>
}

type TranscriptionQueue = {
  enqueue(request: VideoAudioTranscriptionRequest): unknown
  getSnapshot?: () => { items: Array<{ accountMid?: string; aid?: number | string; cid?: number | string; status: string }> }
  cancelWaitingForVideos?: (accountMid: string, targets: Array<number | FavoriteLibraryTranscriptionTarget>) => { affected: number; skipped: number }
}
type RefreshedVideo = FavoriteRepositoryVideo
type RefreshVideo = (accountMid: string, aid: number) => Promise<RefreshedVideo>

function normalizeAccountMid(value: string) {
  const raw = value.trim()
  if (!/^\d+$/.test(raw) || BigInt(raw) === 0n) throw new Error('当前账号无效。')
  return BigInt(raw).toString()
}

function uniquePositiveAids(value: unknown) {
  if (!Array.isArray(value) || value.some((aid) => !Number.isSafeInteger(aid) || aid <= 0)) {
    throw new Error('所选视频无效。')
  }
  const aids = [...new Set(value)].sort((left, right) => left - right)
  if (!aids.length || aids.length > MAX_SELECTION_AIDS) throw new Error('所选视频无效。')
  return aids
}

function uniqueTranscriptionTargets(value: Array<number | FavoriteLibraryTranscriptionTarget>): FavoriteLibraryTranscriptionTarget[] {
  if (!Array.isArray(value)) throw new Error('Transcription request is invalid.')
  const targets = value.map((target) => typeof target === 'number' ? { aid: target } : target)
  if (!targets.length || targets.some((target) => !target || !Number.isSafeInteger(target.aid) || target.aid <= 0 ||
    (target.cid !== undefined && (!Number.isSafeInteger(target.cid) || target.cid <= 0)))) {
    throw new Error('Transcription request is invalid.')
  }
  const unique = [...new Map(targets.map((target) => [`${target.aid}:${target.cid ?? ''}`, target])).values()]
  if (unique.length > MAX_SELECTION_AIDS) throw new Error('Transcription request is invalid.')
  return unique
}

function isKnownRemoteRejection(error: unknown) {
  return typeof error === 'object' && error !== null && (error as { remoteWriteRejected?: unknown }).remoteWriteRejected === true
}

/**
 * Runs a real Bilibili video-level unfavorite via the already trusted, account-bound
 * page bridge. It intentionally has no repository write path.
 */
export function createFavoriteLibraryRemoteUnfavorite(options: {
  pageBridgeManager: UnfavoritePageBridgeManager
  remoteOperations: RemoteOperationQueue
}): FavoriteLibraryRemoteUnfavorite {
  return {
    async unfavorite(accountMid, requestedAids, operationOptions) {
      const account = normalizeAccountMid(accountMid)
      const aids = uniquePositiveAids(requestedAids)
      if (aids.length > 100) throw new Error('Bilibili unfavorite selection is invalid.')
      let completed = 0
      let status: FavoriteLibraryCommandResult['status'] = 'succeeded'
      let reason: string | undefined
      for (const aid of aids) {
        let remoteWriteStarted = false
        try {
          await options.remoteOperations.enqueue(account, { priority: 'user-single', videoKey: `unfavorite:${aid}` }, async () => {
            await operationOptions?.beforeRemoteWrite?.()
            remoteWriteStarted = true
            const runId = `favorite-unfavorite:${randomUUID()}`
            await options.pageBridgeManager.bind(account, runId)
            try {
              await options.pageBridgeManager.pageBridge(account, runId).unfavorite({
                accountMid: account, operationKey: `${runId}:${aid}`, aid
              })
            } finally {
              options.pageBridgeManager.release(account, runId)
            }
          })
          completed++
        } catch (error) {
          // A stale local baseline is known before the page bridge receives a write.
          if (!remoteWriteStarted) throw error
          reason = error instanceof Error ? error.message : String(error)
          status = isKnownRemoteRejection(error) ? 'failed' : 'result-unknown'
          // An ambiguous write must be reconciled before any later item is touched.
          if (status === 'result-unknown') break
        }
      }
      return {
        status, completedOperationCount: completed, totalOperationCount: aids.length, affectedAids: aids,
        ...(reason ? { reason } : {})
      }
    }
  }
}

function selectedAids(snapshot: AccountFavoriteRepositorySnapshot, selection: FavoriteLibrarySyncSelection) {
  if (selection.kind === 'aids') return uniquePositiveAids(selection.aids)
  if (typeof selection.folderId !== 'string' || !selection.folderId.trim()) throw new Error('来源收藏夹无效。')
  const folder = snapshot.folders.find((candidate) => candidate.id === selection.folderId.trim())
  if (!folder) throw new Error('来源收藏夹不存在。')
  return uniquePositiveAids(snapshot.memberships[folder.id] ?? [])
}

/** Main-process local mirror commands. This service never receives a page bridge or remote writer. */
export class FavoriteLibraryCommandService {
  constructor(private readonly options: {
    repository: Pick<FavoriteRepositoryService, 'getSnapshot' | 'commit'> &
      Partial<Pick<FavoriteRepositoryService, 'getLibraryFolderAids'>>
    refreshVideo: RefreshVideo
    transcriptionQueue: TranscriptionQueue
    /** Optional so metadata refresh remains a strictly local operation. */
    placementSync?: FavoriteLibraryPlacementSync
    /** Optional because this dangerous global Bilibili action requires an explicit main-process adapter. */
    remoteUnfavorite?: FavoriteLibraryRemoteUnfavorite
    now?: () => string
  }) {}

  /** Saves the complete local logical membership set in one repository command. */
  async setLocalPlacements(
    accountMid: string,
    requestedPlacements: FavoriteLibraryPlacementInput[],
    expectedRevision: number,
    synchronize = false
  ): Promise<FavoriteLibraryCommandResult> {
    const account = normalizeAccountMid(accountMid)
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('收藏库版本无效。')
    if (!Array.isArray(requestedPlacements) || !requestedPlacements.length || requestedPlacements.length > 100) {
      throw new Error('所选视频无效。')
    }
    const seen = new Set<number>()
    const placements = requestedPlacements.map((requested) => {
      if (!requested || !Number.isSafeInteger(requested.aid) || requested.aid <= 0 || seen.has(requested.aid) || !Array.isArray(requested.folderIds)) {
        throw new Error('所选视频无效。')
      }
      seen.add(requested.aid)
      const localDesiredFolderIds = [...new Set(requested.folderIds.map((folderId) => folderId.trim()).filter(Boolean))].sort()
      if (localDesiredFolderIds.some((folderId) => folderId === 'local:inbox' || !folderId.startsWith('bilimi-logical:'))) {
        throw new Error('目标收藏夹无效。')
      }
      return { aid: requested.aid, localDesiredFolderIds }
    })
    const snapshot = await this.options.repository.getSnapshot(account)
    if (snapshot.revision !== expectedRevision) throw new Error('已在其他页面调整，请重新加载。')
    const timestamp = this.now()
    await this.options.repository.commit(account, {
      id: `favorite-library:placements:${account}:${randomUUID()}`,
      accountMid: account,
      issuedAt: timestamp,
      expectedRevision,
      type: 'set-favorite-placements',
      payload: {
        placements: placements.map((placement) => {
          const prior = snapshot.positions?.[`${account}:${placement.aid}`]
          return {
            aid: placement.aid,
            localDesiredFolderIds: placement.localDesiredFolderIds,
            remoteObservedPhysicalFolderIds: prior?.remoteObservedPhysicalFolderIds ?? [],
            remoteObservedLogicalFolderIds: prior?.remoteObservedLogicalFolderIds ?? [],
            positionState: 'local-only-change' as const,
            updatedAt: timestamp
          }
        })
      }
    })
    const affectedAids = placements.map((placement) => placement.aid).sort((left, right) => left - right)
    // A frozen old-favorite run owns remote writes until it has reached a terminal boundary.
    if (synchronize && this.options.placementSync && !['frozen', 'executing', 'reconciling'].includes(snapshot.workspace?.status ?? '')) {
      return this.options.placementSync.synchronizePlacements(account, affectedAids)
    }
    return { status: synchronize ? 'queued' : 'succeeded', completedOperationCount: 0, totalOperationCount: affectedAids.length, affectedAids }
  }

  async adoptRemotePlacement(accountMid: string, aid: number, expectedRevision: number): Promise<FavoriteLibraryCommandResult> {
    const account = normalizeAccountMid(accountMid)
    if (!Number.isSafeInteger(aid) || aid <= 0 || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('所选视频无效。')
    const snapshot = await this.options.repository.getSnapshot(account)
    if (snapshot.revision !== expectedRevision) throw new Error('已在其他页面调整，请重新加载。')
    const prior = snapshot.positions?.[`${account}:${aid}`]
    if (!prior) throw new Error('尚未扫描 B 站位置。')
    const timestamp = this.now()
    await this.options.repository.commit(account, {
      id: `favorite-library:adopt-remote:${account}:${aid}:${randomUUID()}`,
      accountMid: account,
      issuedAt: timestamp,
      expectedRevision,
      type: 'set-favorite-placement',
      payload: {
        aid,
        localDesiredFolderIds: [...prior.remoteObservedLogicalFolderIds],
        remoteObservedPhysicalFolderIds: [...prior.remoteObservedPhysicalFolderIds],
        remoteObservedLogicalFolderIds: [...prior.remoteObservedLogicalFolderIds],
        positionState: 'aligned', observedAt: prior.observedAt, updatedAt: timestamp
      }
    })
    return { status: 'succeeded', completedOperationCount: 1, totalOperationCount: 1, affectedAids: [aid] }
  }

  async deleteFromLibrary(accountMid: string, aid: number, expectedRevision: number) {
    return this.commitLocalLifecycle(accountMid, aid, expectedRevision, 'delete-favorite-from-library')
  }

  /** Does not commit, delete, or modify any local favorite-library, transcription, or archive record. */
  async cancelBilibiliFavorites(accountMid: string, requestedAids: number[]): Promise<FavoriteLibraryCommandResult> {
    const account = normalizeAccountMid(accountMid)
    const aids = uniquePositiveAids(requestedAids)
    if (!this.options.remoteUnfavorite) throw new Error('Bilibili unfavorite is unavailable.')
    return this.options.remoteUnfavorite.unfavorite(account, aids)
  }

  async restoreToLibrary(accountMid: string, aid: number, expectedRevision: number) {
    return this.commitLocalLifecycle(accountMid, aid, expectedRevision, 'restore-favorite-to-library')
  }

  async forgetTombstone(accountMid: string, aid: number, expectedRevision: number) {
    return this.commitLocalLifecycle(accountMid, aid, expectedRevision, 'forget-favorite-tombstone')
  }

  async clearRecycledFavorite(accountMid: string, aid: number, expectedRevision: number) {
    return this.commitLocalLifecycle(accountMid, aid, expectedRevision, 'clear-recycled-favorite')
  }

  private async commitLocalLifecycle(
    accountMid: string,
    aid: number,
    expectedRevision: number,
    type: 'delete-favorite-from-library' | 'restore-favorite-to-library' | 'forget-favorite-tombstone' | 'clear-recycled-favorite'
  ): Promise<FavoriteLibraryCommandResult> {
    const account = normalizeAccountMid(accountMid)
    if (!Number.isSafeInteger(aid) || aid <= 0 || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('所选视频无效。')
    await this.options.repository.commit(account, {
      id: `favorite-library:${type}:${account}:${aid}:${randomUUID()}`,
      accountMid: account, issuedAt: this.now(), expectedRevision, type,
      payload: type === 'delete-favorite-from-library' ? { aid, deletedAt: this.now(), reason: 'user-delete' } : { aid }
    } as never)
    return { status: 'succeeded', completedOperationCount: 1, totalOperationCount: 1, affectedAids: [aid] }
  }

  async syncSelection(accountMid: string, selection: FavoriteLibrarySyncSelection): Promise<FavoriteLibraryCommandResult> {
    const account = normalizeAccountMid(accountMid)
    const snapshot = await this.options.repository.getSnapshot(account)
    const aids = selection.kind === 'folder' && this.options.repository.getLibraryFolderAids
      ? uniquePositiveAids(await this.options.repository.getLibraryFolderAids(account, selection.folderId))
      : selectedAids(snapshot, selection)
    let completed = 0
    for (const aid of aids) {
      await this.refreshAndPersist(account, aid)
      completed++
    }
    return { status: 'succeeded', completedOperationCount: completed, totalOperationCount: aids.length, affectedAids: aids }
  }

  async synchronizeSelection(accountMid: string, selection: FavoriteLibrarySyncSelection): Promise<FavoriteLibraryCommandResult> {
    const account = normalizeAccountMid(accountMid)
    if (!this.options.placementSync) throw new Error('Favorite placement synchronization is unavailable.')
    const snapshot = await this.options.repository.getSnapshot(account)
    const selected = selection.kind === 'folder' && this.options.repository.getLibraryFolderAids
      ? await this.options.repository.getLibraryFolderAids(account, selection.folderId)
      : selection.kind === 'folder'
        ? snapshot.memberships[selection.folderId] ?? []
        : selection.aids
    if (!Array.isArray(selected) || selected.some((aid) => !Number.isSafeInteger(aid) || aid <= 0)) throw new Error('Selected videos are invalid.')
    const selectedAids = [...new Set(selected)].sort((left, right) => left - right)
    if (!selectedAids.length) return { status: 'succeeded', completedOperationCount: 0, totalOperationCount: 0, affectedAids: [] }
    if (['frozen', 'executing', 'reconciling'].includes(snapshot.workspace?.status ?? '')) {
      return { status: 'queued', completedOperationCount: 0, totalOperationCount: selectedAids.length, affectedAids: selectedAids }
    }
    const results: FavoriteLibraryCommandResult[] = []
    for (let index = 0; index < selectedAids.length; index += PLACEMENT_SYNC_CHUNK_SIZE) {
      results.push(await this.options.placementSync.synchronizePlacements(account, selectedAids.slice(index, index + PLACEMENT_SYNC_CHUNK_SIZE)))
    }
    return {
      status: results.some((result) => result.status === 'result-unknown') ? 'result-unknown'
        : results.some((result) => result.status === 'failed') ? 'failed'
          : results.some((result) => result.status === 'queued') ? 'queued' : 'succeeded',
      completedOperationCount: results.reduce((sum, result) => sum + result.completedOperationCount, 0),
      totalOperationCount: results.reduce((sum, result) => sum + result.totalOperationCount, 0),
      affectedAids: selectedAids,
      ...(results.find((result) => result.reason)?.reason ? { reason: results.find((result) => result.reason)!.reason } : {})
    }
  }

  async enqueueTranscription(accountMid: string, requestedTargets: Array<number | FavoriteLibraryTranscriptionTarget>, summarizeWithDeepSeek = false): Promise<FavoriteLibraryCommandResult> {
    const account = normalizeAccountMid(accountMid)
    const targets = uniqueTranscriptionTargets(requestedTargets)
    const existing = this.options.transcriptionQueue.getSnapshot?.().items ?? []
    const queuedAids: number[] = []
    for (const target of targets) {
      if (target.cid === undefined && existing.some((item) => item.accountMid === account && item.aid === target.aid && item.cid === undefined &&
        ['pending', 'running', 'completed'].includes(item.status))) continue
      const persisted = await this.refreshAndPersist(account, target.aid)
      const video = persisted.video
      const cid = target.cid ?? video.cid
      const alreadyQueued = existing.some((item) => item.accountMid === account && item.aid === target.aid && item.cid === cid &&
        ['pending', 'running', 'completed'].includes(item.status))
      if (alreadyQueued) continue
      this.options.transcriptionQueue.enqueue({
        accountMid: account,
        url: `https://www.bilibili.com/video/av${target.aid}`,
        title: video.title,
        ...(video.author ? { author: video.author } : {}),
        ...(video.bvid ? { bvid: video.bvid } : {}),
        aid: target.aid,
        ...(cid ? { cid } : {}),
        metadataRevision: persisted.metadataRevision,
        ...(summarizeWithDeepSeek ? { summarizeWithDeepSeek: true } : {})
      })
      queuedAids.push(target.aid)
    }
    return {
      status: 'queued', completedOperationCount: queuedAids.length, totalOperationCount: targets.length, affectedAids: [...new Set(queuedAids)],
      ...(queuedAids.length !== targets.length ? { reason: `Added ${queuedAids.length}; skipped ${targets.length - queuedAids.length}.` } : {})
    }
  }

  cancelWaitingTranscription(accountMid: string, requestedTargets: Array<number | FavoriteLibraryTranscriptionTarget>): FavoriteLibraryCommandResult {
    const account = normalizeAccountMid(accountMid)
    const targets = uniqueTranscriptionTargets(requestedTargets)
    if (!this.options.transcriptionQueue.cancelWaitingForVideos) throw new Error('Transcription queue is unavailable.')
    const result = this.options.transcriptionQueue.cancelWaitingForVideos(account, targets)
    return {
      status: 'succeeded', completedOperationCount: result.affected, totalOperationCount: targets.length,
      affectedAids: [...new Set(targets.map((target) => target.aid))], ...(result.skipped ? { reason: `Canceled ${result.affected}; skipped ${result.skipped}.` } : {})
    }
  }

  private async refreshAndPersist(accountMid: string, aid: number) {
    const before = await this.options.repository.getSnapshot(accountMid)
    const prior = before.libraryMirrors[String(aid)]
    const metadataRevision = (prior?.metadataRevision ?? before.revision) + 1
    const checkedAt = this.now()
    try {
      const video = await this.options.refreshVideo(accountMid, aid)
      if (video.aid !== aid) throw new Error('视频信息不一致。')
      await this.options.repository.commit(accountMid, {
        id: `favorite-library:video:${accountMid}:${aid}:${metadataRevision}:${randomUUID()}`,
        accountMid, issuedAt: this.now(), type: 'upsert-video', payload: video
      })
      await this.options.repository.commit(accountMid, {
        id: `favorite-library:mirror:${accountMid}:${aid}:${metadataRevision}:${randomUUID()}`,
        accountMid, issuedAt: this.now(), type: 'record-library-mirror',
        payload: { aid, status: 'synced', metadataRevision, lastSyncedAt: checkedAt, lastCheckedAt: checkedAt }
      })
      return { video, metadataRevision }
    } catch (error) {
      const failure = error && typeof error === 'object'
        ? error as { errorCode?: unknown; remoteCode?: unknown }
        : undefined
      const errorCode = failure?.errorCode === 'unavailable' || failure?.errorCode === 'account-changed'
        ? failure.errorCode
        : 'network'
      const remoteCode = Number.isSafeInteger(failure?.remoteCode) ? Number(failure?.remoteCode) : undefined
      await this.options.repository.commit(accountMid, {
        id: `favorite-library:mirror-failed:${accountMid}:${aid}:${metadataRevision}:${randomUUID()}`,
        accountMid, issuedAt: this.now(), type: 'record-library-mirror',
        payload: {
          aid, status: 'failed', metadataRevision, lastSyncedAt: prior?.lastSyncedAt,
          lastCheckedAt: checkedAt, errorCode, ...(remoteCode !== undefined ? { remoteCode } : {})
        }
      })
      throw error
    }
  }

  private now() { return this.options.now?.() ?? new Date().toISOString() }
}

type IpcEvent = { sender: { id: number } }
type IpcMain = { handle(channel: string, handler: (event: IpcEvent, ...args: never[]) => unknown): void }

function librarySelection(value: unknown): FavoriteLibrarySyncSelection | FavoriteLibraryScopeSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('所选视频无效。')
  const candidate = value as Record<string, unknown>
  if (candidate.kind === 'aids' && Object.keys(candidate).length === 2) return { kind: 'aids', aids: uniquePositiveAids(candidate.aids) }
  if (candidate.kind === 'folder' && typeof candidate.folderId === 'string' && Object.keys(candidate).length === 2) return { kind: 'folder', folderId: candidate.folderId.trim() }
  if (candidate.kind === 'scope' && Object.keys(candidate).length === 4 && candidate.scope && typeof candidate.scope === 'object' && candidate.options && typeof candidate.options === 'object' && Array.isArray(candidate.excludedAids)) {
    const scope = candidate.scope as { kind?: unknown; folderId?: unknown }
    const options = candidate.options as { query?: unknown; filter?: unknown; stateFilters?: unknown; sort?: unknown; transcriptionFilters?: unknown }
    const transcriptionFilters = options.transcriptionFilters
    if (transcriptionFilters !== undefined && (!Array.isArray(transcriptionFilters) || transcriptionFilters.length > 5 || transcriptionFilters.some((filter) =>
      !['completed', 'none', 'pending', 'running', 'failed'].includes(String(filter))))) throw new Error('Selected videos are invalid.')
    const validScope = scope.kind === 'all' || scope.kind === 'pending' || scope.kind === 'protected' || scope.kind === 'unsynced' ||
      scope.kind === 'folder' && typeof scope.folderId === 'string' && !!scope.folderId.trim()
    const stateFilters = options.stateFilters as Record<string, unknown> | undefined
    const validStateFilters = stateFilters === undefined || Boolean(stateFilters) && !Array.isArray(stateFilters) &&
      Object.keys(stateFilters).every((key) => ['sync', 'protection', 'organization'].includes(key)) &&
      (stateFilters.sync === undefined || ['synced', 'unsynced'].includes(String(stateFilters.sync))) &&
      (stateFilters.protection === undefined || ['protected', 'unprotected'].includes(String(stateFilters.protection))) &&
      (stateFilters.organization === undefined || ['organized', 'unorganized'].includes(String(stateFilters.organization)))
    if (!validScope || !validStateFilters || candidate.excludedAids.some((aid) => !Number.isSafeInteger(aid) || aid <= 0) ||
      (options.query !== undefined && typeof options.query !== 'string') ||
      (options.filter !== undefined && !['all', 'pending', 'protected', 'unsynced'].includes(String(options.filter))) ||
      (options.sort !== undefined && !['updated-desc', 'updated-asc', 'title-asc', 'title-desc'].includes(String(options.sort)))) throw new Error('所选视频无效。')
    return {
      kind: 'scope', scope: scope.kind === 'folder'
        ? { kind: 'folder', folderId: (scope.folderId as string).trim() }
        : { kind: scope.kind as Exclude<FavoriteRepositoryLibraryPageScope['kind'], 'folder'> },
      options: { ...(typeof options.query === 'string' ? { query: options.query } : {}), ...(typeof options.filter === 'string' ? { filter: options.filter as FavoriteRepositoryLibraryFilter } : {}), ...(stateFilters && Object.keys(stateFilters).length ? { stateFilters: { ...stateFilters } as FavoriteRepositoryLibraryStateFilters } : {}), ...(typeof options.sort === 'string' ? { sort: options.sort as FavoriteRepositoryLibrarySort } : {}), ...(Array.isArray(transcriptionFilters) && transcriptionFilters.length ? { transcriptionFilters: [...new Set(transcriptionFilters as FavoriteRepositoryTranscriptionFilter[])].sort() } : {}) },
      excludedAids: [...new Set(candidate.excludedAids as number[])].sort((left, right) => left - right)
    }
  }
  throw new Error('所选视频无效。')
}

function transcriptionInput(value: unknown): { aids?: number[]; targets?: FavoriteLibraryTranscriptionTarget[]; scope?: FavoriteLibraryScopeSelection; summarizeWithDeepSeek: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('转写请求无效。')
  const candidate = value as Record<string, unknown>
  if (candidate.kind === 'scope') {
    const { scope, options, excludedAids, summarizeWithDeepSeek } = candidate as Record<string, unknown>
    if (summarizeWithDeepSeek !== undefined && typeof summarizeWithDeepSeek !== 'boolean') throw new Error('转写请求无效。')
    const parsed = librarySelection({ kind: 'scope', scope, options, excludedAids })
    if (parsed.kind !== 'scope') throw new Error('转写请求无效。')
    return { scope: parsed, summarizeWithDeepSeek: summarizeWithDeepSeek === true }
  }
  if (candidate.targets !== undefined) {
    if (candidate.aids !== undefined || !Array.isArray(candidate.targets) ||
      Object.keys(candidate).some((key) => key !== 'targets' && key !== 'summarizeWithDeepSeek') ||
      (candidate.summarizeWithDeepSeek !== undefined && typeof candidate.summarizeWithDeepSeek !== 'boolean')) {
      throw new Error('Transcription request is invalid.')
    }
    return {
      targets: uniqueTranscriptionTargets(candidate.targets as FavoriteLibraryTranscriptionTarget[]),
      summarizeWithDeepSeek: candidate.summarizeWithDeepSeek === true
    }
  }
  if (Object.keys(candidate).some((key) => key !== 'aids' && key !== 'summarizeWithDeepSeek') ||
    (candidate.summarizeWithDeepSeek !== undefined && typeof candidate.summarizeWithDeepSeek !== 'boolean')) throw new Error('转写请求无效。')
  return { aids: uniquePositiveAids(candidate.aids), summarizeWithDeepSeek: candidate.summarizeWithDeepSeek === true }
}

export function registerFavoriteLibraryCommandsIpc(options: {
  ipcMain: IpcMain
  commands: Pick<FavoriteLibraryCommandService, 'syncSelection' | 'synchronizeSelection' | 'enqueueTranscription' | 'cancelWaitingTranscription'>
  isTrustedLibrarySender: (senderId: number) => boolean
  getCurrentAccountMid: () => Promise<string>
  resolveSelection?: (accountMid: string, selection: FavoriteLibraryScopeSelection) => Promise<number[]>
  /** Resolves a renderer selection in the main process before the batch exporter sees it. */
  resolveDocumentExportSelection?: (accountMid: string, aids: number[]) => Promise<unknown>
}) {
  const assertLibrary = (event: IpcEvent) => {
    if (!options.isTrustedLibrarySender(event.sender.id)) throw new Error('收藏库请求来自不受信任的窗口。')
  }
  const assertCurrentAccount = async (requestedAccountMid: unknown) => {
    if (typeof requestedAccountMid !== 'string') throw new Error('当前账号无效。')
    const account = normalizeAccountMid(requestedAccountMid)
    if (normalizeAccountMid(await options.getCurrentAccountMid()) !== account) throw new Error('当前账号已切换，请重新加载收藏库。')
    return account
  }
  options.ipcMain.handle('favorite-library:sync-selection', async (event, requestedAccountMid: string, selection: unknown) => {
    assertLibrary(event)
    const accountMid = await assertCurrentAccount(requestedAccountMid)
    const parsed = librarySelection(selection)
    const resolved = parsed.kind === 'scope'
      ? { kind: 'aids' as const, aids: await options.resolveSelection?.(accountMid, parsed) ?? (() => { throw new Error('所选视频无效。') })() }
      : parsed
    await assertCurrentAccount(accountMid)
    return options.commands.syncSelection(accountMid, resolved)
  })
  options.ipcMain.handle('favorite-library:synchronize-placements', async (event, requestedAccountMid: string, selection: unknown) => {
    assertLibrary(event)
    const accountMid = await assertCurrentAccount(requestedAccountMid)
    const parsed = librarySelection(selection)
    const resolved = parsed.kind === 'scope'
      ? { kind: 'aids' as const, aids: await options.resolveSelection?.(accountMid, parsed) ?? (() => { throw new Error('Selected videos are invalid.') })() }
      : parsed
    await assertCurrentAccount(accountMid)
    return options.commands.synchronizeSelection(accountMid, resolved)
  })
  options.ipcMain.handle('favorite-library:enqueue-transcription', async (event, requestedAccountMid: string, input: unknown) => {
    assertLibrary(event)
    const parsed = transcriptionInput(input)
    const accountMid = await assertCurrentAccount(requestedAccountMid)
    const targets = parsed.scope
      ? await options.resolveSelection?.(accountMid, parsed.scope) ?? (() => { throw new Error('转写请求无效。') })()
      : parsed.targets ?? parsed.aids
    await assertCurrentAccount(accountMid)
    return options.commands.enqueueTranscription(accountMid, targets!, parsed.summarizeWithDeepSeek)
  })
  options.ipcMain.handle('favorite-library:cancel-waiting-transcription', async (event, requestedAccountMid: string, input: unknown) => {
    assertLibrary(event)
    const parsed = transcriptionInput(input)
    const accountMid = await assertCurrentAccount(requestedAccountMid)
    const targets = parsed.scope
      ? await options.resolveSelection?.(accountMid, parsed.scope) ?? (() => { throw new Error('Transcription request is invalid.') })()
      : parsed.targets ?? parsed.aids
    await assertCurrentAccount(accountMid)
    return options.commands.cancelWaitingTranscription(accountMid, targets!)
  })
  options.ipcMain.handle('favorite-library:resolve-document-export-selection', async (event, requestedAccountMid: string, selection: unknown) => {
    assertLibrary(event)
    const accountMid = await assertCurrentAccount(requestedAccountMid)
    const parsed = librarySelection(selection)
    if (parsed.kind === 'folder') throw new Error('Selected videos are invalid.')
    const aids = parsed.kind === 'scope'
      ? await options.resolveSelection?.(accountMid, parsed) ?? (() => { throw new Error('Selected videos are invalid.') })()
      : parsed.aids
    await assertCurrentAccount(accountMid)
    if (!options.resolveDocumentExportSelection) return { aids }
    const resolved = await options.resolveDocumentExportSelection(accountMid, aids)
    await assertCurrentAccount(accountMid)
    return resolved
  })
}
