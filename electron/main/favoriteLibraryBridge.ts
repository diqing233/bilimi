import type { AccountFavoriteRepositorySnapshot } from '../../src/shared/favoriteRepository'
import type { VideoNote, VideoNoteArchiveEntry } from '../../src/shared/types'

export type FavoriteLibraryAccount = {
  mid: string
  nickname?: string
}

type IpcEvent = { sender: { id: number } }
type IpcMain = {
  handle(channel: string, handler: (event: IpcEvent, ...args: never[]) => unknown): void
}

function accountMid(value: unknown) {
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim()) || BigInt(value.trim()) === 0n) {
    throw new Error('当前账号无效。')
  }
  return BigInt(value.trim()).toString()
}

function aid(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error('视频信息无效。')
  return Number(value)
}

function folderId(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('来源收藏夹无效。')
  return value.trim()
}

function sourceFavoriteId(snapshot: Pick<AccountFavoriteRepositorySnapshot, 'folders' | 'physicalShards'>, requestedFolderId: string) {
  const folder = snapshot.folders.find((candidate) => candidate.id === requestedFolderId)
  const logicalLedgerId = folder?.logicalLedgerId ?? (requestedFolderId.startsWith('bilimi-logical:')
    ? requestedFolderId.slice('bilimi-logical:'.length)
    : undefined)
  if (logicalLedgerId && folder?.kind === 'bilimi-logical') {
    const logicalShards = snapshot.physicalShards.filter((shard) => shard.logicalLedgerId === logicalLedgerId)
    if (logicalShards.some((shard) => shard.bindingState !== 'bound' ||
      typeof shard.remoteFolderId !== 'string' || !/^\d+$/.test(shard.remoteFolderId))) {
      throw new Error('来源收藏夹不可打开。')
    }
    const boundShards = logicalShards
      .sort((left, right) => left.shardNumber - right.shardNumber)
    if (boundShards.length > 1) {
      throw new Error('Multiple physical folders require an explicit selection.')
    }
    const remoteFolderId = boundShards[0]?.remoteFolderId
    if (!remoteFolderId) throw new Error('来源收藏夹不可打开。')
    return remoteFolderId
  }
  const remoteFolderId = folder?.remoteFolderId ?? snapshot.physicalShards
    .filter((shard) => shard.folderId === requestedFolderId && shard.bindingState === 'bound')
    .find((shard) => shard.remoteFolderId)?.remoteFolderId
  if (!remoteFolderId || !/^\d+$/.test(remoteFolderId)) throw new Error('来源收藏夹不可打开。')
  return remoteFolderId
}

function archiveForAid(
  archives: readonly VideoNoteArchiveEntry[],
  requestedAccountMid: string,
  requestedAid: number,
  requestedCid?: unknown
) {
  const cid = requestedCid === undefined ? undefined : aid(requestedCid)
  const identity = new RegExp(`^account:${requestedAccountMid}:aid:${requestedAid}(?::cid:(\\d+))?$`)
  const identified = archives.flatMap((archive) => archive.versions
    .map((version) => ({ archive, version, identity: version.note.id.match(identity) }))
    .filter((candidate) => candidate.identity && (cid === undefined || candidate.identity[1] === String(cid))))
  if (identified.length) {
    if (cid === undefined && new Set(identified.map((candidate) => candidate.identity?.[1] ?? '')).size > 1) {
      throw new Error('该视频有多个分P档案，请选择具体分P。')
    }
    const selected = identified.sort((left, right) => right.archive.updatedAt.localeCompare(left.archive.updatedAt))[0]
    return { archive: selected.archive, version: selected.version }
  }
  // A page-specific request must never silently fall back to a legacy aid-only
  // record. The fallback below exists only for unambiguous historic archives.
  if (cid !== undefined) throw new Error('该视频暂无本地档案，请先完成转写。')
  const archive = archives
    .filter((candidate) => candidate.source.accountMid === requestedAccountMid && new RegExp(`/video/av${requestedAid}(?:[/?#]|$)`, 'i').test(candidate.source.url))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
  const version = archive?.versions.at(-1)
  if (!archive || !version) throw new Error('该视频暂无本地档案，请先完成转写。')
  return { archive, version }
}

function archiveNavigationForVideo(
  archives: readonly VideoNoteArchiveEntry[],
  requestedAccountMid: string,
  requestedAid: number,
  requestedCid?: unknown
) {
  const cid = requestedCid === undefined ? undefined : aid(requestedCid)
  const identity = new RegExp(`^account:${requestedAccountMid}:aid:${requestedAid}(?::cid:(\\d+))?$`)
  const matches = archives.flatMap((archive) => archive.versions
    .map((version) => ({ archive, version, identity: version.note.id.match(identity) }))
    .filter((candidate) => candidate.identity && (cid === undefined || candidate.identity[1] === String(cid))))
  if (!matches.length && cid === undefined) {
    const legacy = archiveForAid(archives, requestedAccountMid, requestedAid)
    return { archiveId: legacy.archive.id, versionId: legacy.version.id }
  }
  if (!matches.length) throw new Error('该视频暂无本地档案，请先完成转写。')
  if (cid === undefined && new Set(matches.map((candidate) => candidate.identity?.[1] ?? '')).size > 1) {
    throw new Error('该视频有多个分P档案，请选择具体分P。')
  }
  const selected = matches.sort((left, right) => right.archive.updatedAt.localeCompare(left.archive.updatedAt))[0]
  return { archiveId: selected.archive.id, versionId: selected.version.id }
}

/** Exposes only ID-based library actions; URL construction remains in the main process. */
export function registerFavoriteLibraryBridgeIpc(options: {
  ipcMain: IpcMain
  isTrustedLibrarySender: (senderId: number) => boolean
  readAccount: () => Promise<FavoriteLibraryAccount>
  getCurrentAccountMid: () => Promise<string>
  getSnapshot: (accountMid: string) => Promise<Pick<AccountFavoriteRepositorySnapshot, 'folders' | 'physicalShards'>>
  loadArchives: () => VideoNoteArchiveEntry[]
  updateArchiveVersion: (archiveId: string, versionId: string, note: VideoNote) => unknown
  openMainUrl: (url: string) => void
}) {
  const assertLibrary = (event: IpcEvent) => {
    if (!options.isTrustedLibrarySender(event.sender.id)) throw new Error('收藏库请求来自不受信任的窗口。')
  }
  const assertCurrentAccount = async (requested: unknown) => {
    const requestedAccount = accountMid(requested)
    if (accountMid(await options.getCurrentAccountMid()) !== requestedAccount) {
      throw new Error('当前账号已切换，请重新加载收藏库。')
    }
    return requestedAccount
  }

  options.ipcMain.handle('favorite-library:read-account', async (event) => {
    assertLibrary(event)
    const account = await options.readAccount()
    return { mid: accountMid(account.mid), ...(account.nickname?.trim() ? { nickname: account.nickname.trim() } : {}) }
  })
  options.ipcMain.handle('favorite-library:open-video', async (event, requestedAccountMid: string, requestedAid: number) => {
    assertLibrary(event)
    await assertCurrentAccount(requestedAccountMid)
    options.openMainUrl(`https://www.bilibili.com/video/av${aid(requestedAid)}`)
  })
  options.ipcMain.handle('favorite-library:open-source', async (event, requestedAccountMid: string, requestedFolderId: string) => {
    assertLibrary(event)
    const currentAccount = await assertCurrentAccount(requestedAccountMid)
    const remoteFolderId = sourceFavoriteId(await options.getSnapshot(currentAccount), folderId(requestedFolderId))
    options.openMainUrl(`https://space.bilibili.com/${currentAccount}/favlist?fid=${remoteFolderId}&ftype=create`)
  })
  options.ipcMain.handle('favorite-library:resolve-archive', async (
    event,
    requestedAccountMid: string,
    requestedAid: number,
    requestedCid?: number
  ) => {
    assertLibrary(event)
    const currentAccount = await assertCurrentAccount(requestedAccountMid)
    return archiveNavigationForVideo(options.loadArchives(), currentAccount, aid(requestedAid), requestedCid)
  })
  options.ipcMain.handle('favorite-library:toggle-archive-star', async (
    event, requestedAccountMid: string, requestedAid: number, requestedCid?: number
  ) => {
    assertLibrary(event)
    const currentAccount = await assertCurrentAccount(requestedAccountMid)
    const { archive, version } = archiveForAid(options.loadArchives(), currentAccount, aid(requestedAid), requestedCid)
    options.updateArchiveVersion(archive.id, version.id, {
      ...version.note,
      starred: !version.note.starred,
      updatedAt: new Date().toISOString()
    })
  })
  options.ipcMain.handle('favorite-library:save-archive-memo', async (
    event,
    requestedAccountMid: string,
    requestedAid: number,
    memo: unknown,
    requestedCid?: number
  ) => {
    assertLibrary(event)
    const currentAccount = await assertCurrentAccount(requestedAccountMid)
    if (typeof memo !== 'string' || memo.length > 10_000) throw new Error('备注内容无效。')
    const { archive, version } = archiveForAid(options.loadArchives(), currentAccount, aid(requestedAid), requestedCid)
    options.updateArchiveVersion(archive.id, version.id, {
      ...version.note,
      userMemo: memo.trim(),
      updatedAt: new Date().toISOString()
    })
  })
}
