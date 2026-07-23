import { randomUUID } from 'node:crypto'
import type { AccountFavoriteRepositorySnapshot, FavoriteRepositoryVideo } from '../../src/shared/favoriteRepository'
import type { VideoAudioTranscriptionRequest } from '../../src/shared/types'
import type { FavoriteRepositoryService } from './favoriteRepositoryService'

const MAX_SELECTION_AIDS = 500

export type FavoriteLibrarySyncSelection =
  | { kind: 'aids'; aids: number[] }
  | { kind: 'folder'; folderId: string }

export type FavoriteLibraryCommandResult = {
  status: 'succeeded' | 'failed' | 'queued'
  completedOperationCount: number
  totalOperationCount: number
  affectedAids: number[]
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
    now?: () => string
  }) {}

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
