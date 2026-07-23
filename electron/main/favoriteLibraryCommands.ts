import { randomUUID } from 'node:crypto'
import type { AccountFavoriteRepositorySnapshot, FavoriteRepositoryVideo } from '../../src/shared/favoriteRepository'
import type { VideoAudioTranscriptionRequest } from '../../src/shared/types'
import type { FavoriteRepositoryService } from './favoriteRepositoryService'

const MAX_SELECTION_AIDS = 500

export type FavoriteLibrarySyncSelection =
  | { kind: 'aids'; aids: number[] }
  | { kind: 'folder'; folderId: string }

export type FavoriteLibraryCommandResult = {
  status: 'succeeded' | 'failed' | 'queued' | 'result-unknown'
  completedOperationCount: number
  totalOperationCount: number
  affectedAids: number[]
  reason?: string
}

export type FavoriteLibraryPlacementInput = { aid: number; folderIds: string[] }

export type FavoriteLibraryPlacementSync = {
  synchronizePlacements(accountMid: string, aids: number[]): Promise<FavoriteLibraryCommandResult>
}

/** Kept separate from local record lifecycle commands: it only changes Bilibili's favorite state. */
export type FavoriteLibraryRemoteUnfavorite = {
  unfavorite(accountMid: string, aids: number[]): Promise<FavoriteLibraryCommandResult>
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

type TranscriptionQueue = { enqueue(request: VideoAudioTranscriptionRequest): unknown }
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
    async unfavorite(accountMid, requestedAids) {
      const account = normalizeAccountMid(accountMid)
      const aids = uniquePositiveAids(requestedAids)
      if (aids.length > 100) throw new Error('Bilibili unfavorite selection is invalid.')
      let completed = 0
      let status: FavoriteLibraryCommandResult['status'] = 'succeeded'
      let reason: string | undefined
      for (const aid of aids) {
        try {
          await options.remoteOperations.enqueue(account, { priority: 'user-single', videoKey: `unfavorite:${aid}` }, async () => {
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

  private async commitLocalLifecycle(
    accountMid: string,
    aid: number,
    expectedRevision: number,
    type: 'delete-favorite-from-library' | 'restore-favorite-to-library' | 'forget-favorite-tombstone'
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

  async enqueueTranscription(accountMid: string, requestedAids: number[], summarizeWithDeepSeek = false): Promise<FavoriteLibraryCommandResult> {
    const account = normalizeAccountMid(accountMid)
    const aids = uniquePositiveAids(requestedAids)
    for (const aid of aids) {
      const persisted = await this.refreshAndPersist(account, aid)
      const video = persisted.video
      this.options.transcriptionQueue.enqueue({
        accountMid: account,
        url: `https://www.bilibili.com/video/av${aid}`,
        title: video.title,
        ...(video.author ? { author: video.author } : {}),
        ...(video.bvid ? { bvid: video.bvid } : {}),
        aid,
        ...(video.cid ? { cid: video.cid } : {}),
        metadataRevision: persisted.metadataRevision,
        ...(summarizeWithDeepSeek ? { summarizeWithDeepSeek: true } : {})
      })
    }
    return { status: 'queued', completedOperationCount: aids.length, totalOperationCount: aids.length, affectedAids: aids }
  }

  private async refreshAndPersist(accountMid: string, aid: number) {
    const before = await this.options.repository.getSnapshot(accountMid)
    const prior = before.libraryMirrors[String(aid)]
    const metadataRevision = (prior?.metadataRevision ?? before.revision) + 1
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
        payload: { aid, status: 'synced', metadataRevision, lastSyncedAt: this.now() }
      })
      return { video, metadataRevision }
    } catch (error) {
      await this.options.repository.commit(accountMid, {
        id: `favorite-library:mirror-failed:${accountMid}:${aid}:${metadataRevision}:${randomUUID()}`,
        accountMid, issuedAt: this.now(), type: 'record-library-mirror',
        payload: { aid, status: 'failed', metadataRevision, lastSyncedAt: prior?.lastSyncedAt, errorCode: 'network' }
      })
      throw error
    }
  }

  private now() { return this.options.now?.() ?? new Date().toISOString() }
}

type IpcEvent = { sender: { id: number } }
type IpcMain = { handle(channel: string, handler: (event: IpcEvent, ...args: never[]) => unknown): void }

function librarySelection(value: unknown): FavoriteLibrarySyncSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('所选视频无效。')
  const candidate = value as { kind?: unknown; aids?: unknown; folderId?: unknown }
  if (candidate.kind === 'aids' && Object.keys(candidate).length === 2) return { kind: 'aids', aids: uniquePositiveAids(candidate.aids) }
  if (candidate.kind === 'folder' && typeof candidate.folderId === 'string' && Object.keys(candidate).length === 2) return { kind: 'folder', folderId: candidate.folderId.trim() }
  throw new Error('所选视频无效。')
}

function transcriptionInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('转写请求无效。')
  const candidate = value as { aids?: unknown; summarizeWithDeepSeek?: unknown }
  if (Object.keys(candidate).some((key) => key !== 'aids' && key !== 'summarizeWithDeepSeek') ||
    (candidate.summarizeWithDeepSeek !== undefined && typeof candidate.summarizeWithDeepSeek !== 'boolean')) throw new Error('转写请求无效。')
  return { aids: uniquePositiveAids(candidate.aids), summarizeWithDeepSeek: candidate.summarizeWithDeepSeek === true }
}

export function registerFavoriteLibraryCommandsIpc(options: {
  ipcMain: IpcMain
  commands: Pick<FavoriteLibraryCommandService, 'syncSelection' | 'enqueueTranscription'>
  isTrustedLibrarySender: (senderId: number) => boolean
  getCurrentAccountMid: () => Promise<string>
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
    return options.commands.syncSelection(await assertCurrentAccount(requestedAccountMid), librarySelection(selection))
  })
  options.ipcMain.handle('favorite-library:enqueue-transcription', async (event, requestedAccountMid: string, input: unknown) => {
    assertLibrary(event)
    const parsed = transcriptionInput(input)
    return options.commands.enqueueTranscription(await assertCurrentAccount(requestedAccountMid), parsed.aids, parsed.summarizeWithDeepSeek)
  })
}
