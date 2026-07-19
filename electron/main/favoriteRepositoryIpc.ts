import type {
  AccountFavoriteRepositorySnapshot,
  FavoriteRepositoryCommand,
  FavoriteRepositoryCommandResult,
  FavoriteRepositoryPage,
  FavoriteRepositoryVideo
} from '../../src/shared/favoriteRepository'
import type { FavoriteRepositoryService } from './favoriteRepositoryService'

type IpcEvent = { sender: { id: number } }
type IpcMain = {
  handle(channel: string, handler: (event: IpcEvent, ...args: never[]) => unknown): void
}

type FolderPageOptions = { limit: number; cursor?: string }

export type FavoriteRepositoryRevisionChange = {
  accountMid: string
  revision: number
  affectedFolderIds: string[]
  affectedAids: number[]
  pageInvalidated: boolean
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

function commandForAccount(value: unknown, accountMid: string): FavoriteRepositoryCommand {
  if (!value || typeof value !== 'object' || typeof (value as { accountMid?: unknown }).accountMid !== 'string') {
    throw new Error('Favorite repository command is invalid.')
  }
  if (normalizedAccountMid((value as { accountMid: string }).accountMid) !== accountMid) {
    throw new Error('Favorite repository command account mismatch.')
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
  getCurrentAccountMid: () => Promise<string>
  send?: (senderId: number, channel: string, payload: FavoriteRepositoryRevisionChange) => void
}) {
  const subscriptions = new Map<number, Map<string, Set<string | undefined>>>()
  const assertTrusted = (event: IpcEvent) => {
    if (!options.isTrustedSender(event.sender.id)) {
      throw new Error('Favorite repository request came from an untrusted renderer.')
    }
  }
  const publish = (result: FavoriteRepositoryCommandResult) => {
    for (const [senderId, byAccount] of subscriptions) {
      const folders = byAccount.get(result.accountMid)
      if (!folders) continue
      const pageInvalidated = folders.has(undefined) || result.affectedFolderIds.some((folderId) => folders.has(folderId))
      options.send?.(senderId, 'favorite-repository:revision-changed', {
        accountMid: result.accountMid,
        revision: result.revision,
        affectedFolderIds: result.affectedFolderIds,
        affectedAids: result.affectedAids,
        pageInvalidated
      })
    }
  }
  const subscribe = (senderId: number, accountMid: string, folderId?: string) => {
    const byAccount = subscriptions.get(senderId) ?? new Map<string, Set<string | undefined>>()
    const folders = byAccount.get(accountMid) ?? new Set<string | undefined>()
    folders.add(folderId?.trim() || undefined)
    byAccount.set(accountMid, folders)
    subscriptions.set(senderId, byAccount)
  }
  const unsubscribe = (senderId: number, accountMid: string, folderId?: string) => {
    const byAccount = subscriptions.get(senderId)
    const folders = byAccount?.get(accountMid)
    if (!folders) return false
    const removed = folders.delete(folderId?.trim() || undefined)
    if (!folders.size) byAccount?.delete(accountMid)
    if (!byAccount?.size) subscriptions.delete(senderId)
    return removed
  }

  options.ipcMain.handle('favorite-repository:open-account', async (event, requestedAccountMid: string) => {
    assertTrusted(event)
    const accountMid = normalizedAccountMid(requestedAccountMid)
    const snapshot = await options.service.getSnapshot(accountMid)
    return { accountMid: snapshot.accountMid, revision: snapshot.revision }
  })
  options.ipcMain.handle('favorite-repository:get-snapshot', async (event, requestedAccountMid: string) => {
    assertTrusted(event)
    return options.service.getSnapshot(normalizedAccountMid(requestedAccountMid))
  })
  options.ipcMain.handle('favorite-repository:get-folder-page', async (
    event, requestedAccountMid: string, folderId: string, requestedOptions: FolderPageOptions
  ) => {
    assertTrusted(event)
    return options.service.getFolderPage(normalizedAccountMid(requestedAccountMid), folderId, pageOptions(requestedOptions))
  })
  options.ipcMain.handle('favorite-repository:search-page', async (
    event, requestedAccountMid: string, query: string, requestedOptions: FolderPageOptions
  ) => {
    assertTrusted(event)
    return searchPage(await options.service.getSnapshot(normalizedAccountMid(requestedAccountMid)), query, requestedOptions)
  })
  options.ipcMain.handle('favorite-repository:commit-command', async (
    event, requestedAccountMid: string, requestedCommand: FavoriteRepositoryCommand
  ) => {
    assertTrusted(event)
    const accountMid = normalizedAccountMid(requestedAccountMid)
    if (normalizedAccountMid(await options.getCurrentAccountMid()) !== accountMid) {
      throw new Error('Favorite repository command does not match the current Bilibili account.')
    }
    const result = await options.service.commit(accountMid, commandForAccount(requestedCommand, accountMid))
    publish(result)
    return result
  })
  options.ipcMain.handle('favorite-repository:subscribe', (event, requestedAccountMid: string, folderId?: string) => {
    assertTrusted(event)
    subscribe(event.sender.id, normalizedAccountMid(requestedAccountMid), folderId)
    return true
  })
  options.ipcMain.handle('favorite-repository:unsubscribe', (event, requestedAccountMid: string, folderId?: string) => {
    assertTrusted(event)
    return unsubscribe(event.sender.id, normalizedAccountMid(requestedAccountMid), folderId)
  })
}
