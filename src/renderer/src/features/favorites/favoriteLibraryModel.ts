import type {
  FavoriteRepositoryFolder,
  FavoriteRepositoryPage,
  FavoriteRepositorySyncRecord,
  FavoriteRepositoryVideo
} from '../../../../shared/favoriteRepository'
import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'

export type FavoriteLibrarySearchEntry = {
  video: FavoriteRepositoryVideo
  folderId: string
}

export type FavoriteLibraryRow = FavoriteRepositoryVideo & {
  folderIds: string[]
  pendingStates?: FavoriteLibraryPendingState[]
}

export type FavoriteLibraryPendingState = 'protected' | 'unsynced' | 'continuation' | 'failed' | 'result-unknown'

export type FavoriteLibraryPendingRow = {
  aid: number
  states: FavoriteLibraryPendingState[]
}

/** Keeps the last fully rendered view per account while its revision refreshes. */
export type FavoriteLibraryViewStatus = 'loading' | 'ready' | 'refreshing'

export type FavoriteLibraryCachedView<Summary, Page, UiState> = {
  accountMid: string
  status: FavoriteLibraryViewStatus
  summary?: Summary
  page?: Page
  uiState?: UiState
}

export function createFavoriteLibraryViewCache<Summary, Page, UiState>() {
  const views = new Map<string, FavoriteLibraryCachedView<Summary, Page, UiState>>()
  const normalizedAccountMid = (accountMid: string) => accountMid.trim()

  const read = (accountMid: string): FavoriteLibraryCachedView<Summary, Page, UiState> => {
    const normalized = normalizedAccountMid(accountMid)
    return views.get(normalized) ?? { accountMid: normalized, status: 'loading' }
  }

  return {
    read,
    beginRefresh(accountMid: string) {
      const current = read(accountMid)
      const next: FavoriteLibraryCachedView<Summary, Page, UiState> = {
        ...current,
        status: current.summary && current.page ? 'refreshing' : 'loading'
      }
      views.set(next.accountMid, next)
      return next
    },
    setReady(accountMid: string, summary: Summary, page: Page, uiState: UiState) {
      const next: FavoriteLibraryCachedView<Summary, Page, UiState> = {
        accountMid: normalizedAccountMid(accountMid), status: 'ready', summary, page, uiState
      }
      views.set(next.accountMid, next)
      return next
    },
    invalidate(accountMid: string) {
      views.delete(normalizedAccountMid(accountMid))
    }
  }
}

export type FavoriteLibraryNavigationItem =
  | { id: 'all'; kind: 'all'; title: string }
  | { id: 'pending'; kind: 'pending'; title: string; count: number }
  | {
      id: string
      kind: 'folder'
      folderId: string
      title: string
      source: FavoriteRepositoryFolder['kind']
    }

export type FavoriteLibraryDetail = FavoriteLibraryRow & {
  folders: FavoriteRepositoryFolder[]
  pendingStates: FavoriteLibraryPendingState[]
}

const defaultLedgerTitlesById = new Map(createDefaultFavoriteLedgers().map((ledger) => [ledger.id, ledger.displayName]))

function displayFolderTitle(folder: FavoriteRepositoryFolder) {
  if (folder.id === 'local:inbox') return '未匹配分类'
  const logicalLedgerId = folder.kind === 'local' && folder.id.startsWith('local:')
    ? folder.id.slice('local:'.length)
    : undefined
  return logicalLedgerId && folder.title === logicalLedgerId
    ? defaultLedgerTitlesById.get(logicalLedgerId) ?? folder.title
    : folder.title
}

/** Converts main-process snapshot states to labels without retaining state in the renderer. */
export function formatFavoriteLibraryMirrorStatus(states: readonly FavoriteLibraryPendingState[]): string {
  // Protection describes local retention policy, not the Bilibili mirror state.
  const syncStates = states.filter((state) => state !== 'protected')
  if (syncStates.includes('failed')) return '同步失败'
  if (syncStates.includes('result-unknown')) return '同步状态待确认'
  if (syncStates.includes('unsynced')) return '未同步'
  if (syncStates.includes('continuation')) return '等待处理'
  return '已同步'
}

/** Organization protection is separate from local information refresh. */
export function formatFavoriteLibraryOrganizationStatus(states: readonly FavoriteLibraryPendingState[]): string {
  return states.includes('protected') ? '已整理' : '未整理'
}

export function formatFavoriteLibraryMetadataStatus(status: string | undefined, isPlaceholder = false) {
  if (isPlaceholder || status === 'never' || status === 'refreshing' || status === undefined) return '资料待刷新'
  return status === 'failed' ? '资料刷新失败' : '资料已刷新'
}

export function formatFavoriteLibraryPositionStatus(state: string | undefined, hasRemoteMapping = true) {
  if (!hasRemoteMapping) return '尚未扫描B站位置'
  switch (state) {
    case 'aligned': return '位置一致'
    case 'local-only-change': return '收藏库与B站位置不同'
    case 'syncing': return '同步中'
    case 'failed': return '同步失败'
    case 'result-unknown':
    case 'needs-review': return '结果待确认'
    case 'remote-removed': return 'B站已移除'
    case 'target-missing': return '目标不存在'
    default: return '尚未扫描B站位置'
  }
}

/** Position reconciliation is the source of truth for the detail sync dimension. */
export function formatFavoriteLibraryPositionSyncStatus(state: string | undefined) {
  switch (state) {
    case 'aligned': return '已同步'
    case 'syncing': return '同步中'
    case 'failed': return '同步失败'
    case 'result-unknown':
    case 'needs-review': return '同步状态待确认'
    case 'local-only-change':
    case 'remote-removed':
    case 'target-missing': return '未同步'
    default: return '尚未扫描同步状态'
  }
}

function validAid(aid: number) {
  return Number.isSafeInteger(aid) && aid > 0
}

function copyVideo(video: FavoriteRepositoryVideo): FavoriteRepositoryVideo {
  return { ...video, tags: [...video.tags] }
}

function createRow(video: FavoriteRepositoryVideo, folderIds: Iterable<string>): FavoriteLibraryRow {
  return { ...copyVideo(video), folderIds: [...new Set(folderIds)].sort((left, right) => left.localeCompare(right)) }
}

/**
 * Combines only the rows received for the current global-search page.  The
 * repository remains in the main process; callers provide page entries with
 * their known memberships rather than a full memberships index.
 */
export function buildLibrarySearchRows(entries: readonly FavoriteLibrarySearchEntry[]): FavoriteLibraryRow[] {
  const rowsByAid = new Map<number, { video: FavoriteRepositoryVideo; folderIds: Set<string> }>()
  for (const entry of entries) {
    const folderId = entry.folderId.trim()
    if (!folderId || !validAid(entry.video.aid)) continue
    const existing = rowsByAid.get(entry.video.aid)
    if (existing) {
      existing.folderIds.add(folderId)
      continue
    }
    rowsByAid.set(entry.video.aid, { video: entry.video, folderIds: new Set([folderId]) })
  }
  return [...rowsByAid.values()]
    .map(({ video, folderIds }) => createRow(video, folderIds))
    .sort((left, right) => left.aid - right.aid)
}

/** A folder page intentionally preserves membership order and repetitions. */
export function buildFolderLibraryRows(folderId: string, items: readonly FavoriteRepositoryVideo[]): FavoriteLibraryRow[] {
  const normalizedFolderId = folderId.trim()
  if (!normalizedFolderId) return []
  return items
    .filter((item) => validAid(item.aid))
    .map((item) => createRow(item, [normalizedFolderId]))
}

export function buildPendingLibraryRows(input: {
  unsyncedAids?: readonly number[]
  continuationAids?: readonly number[]
  syncRecords?: readonly Pick<FavoriteRepositorySyncRecord, 'status' | 'affectedAids'>[]
}): FavoriteLibraryPendingRow[] {
  const statesByAid = new Map<number, Set<FavoriteLibraryPendingState>>()
  const add = (aid: number, state: FavoriteLibraryPendingState) => {
    if (!validAid(aid)) return
    const states = statesByAid.get(aid) ?? new Set<FavoriteLibraryPendingState>()
    states.add(state)
    statesByAid.set(aid, states)
  }
  for (const aid of input.unsyncedAids ?? []) add(aid, 'unsynced')
  for (const aid of input.continuationAids ?? []) add(aid, 'continuation')
  for (const record of input.syncRecords ?? []) {
    const state = record.status === 'pending'
      ? 'unsynced'
      : record.status === 'failed' || record.status === 'result-unknown'
        ? record.status
        : undefined
    if (state) for (const aid of record.affectedAids) add(aid, state)
  }
  const stateOrder: FavoriteLibraryPendingState[] = ['unsynced', 'continuation', 'failed', 'result-unknown']
  return [...statesByAid]
    .sort(([left], [right]) => left - right)
    .map(([aid, states]) => ({ aid, states: stateOrder.filter((state) => states.has(state)) }))
}

export function buildFavoriteLibraryNavigation(
  folders: readonly FavoriteRepositoryFolder[],
  pendingCount: number
): FavoriteLibraryNavigationItem[] {
  const kindOrder: Record<FavoriteRepositoryFolder['kind'], number> = {
    bilibili: 0,
    'bilimi-logical': 1,
    local: 2
  }
  const folderItems = folders
    .filter((folder) => folder.id.trim())
    .slice()
    .sort((left, right) => kindOrder[left.kind] - kindOrder[right.kind] ||
      left.title.localeCompare(right.title) || left.id.localeCompare(right.id))
    .map((folder) => ({
      id: `folder:${folder.id}`,
      kind: 'folder' as const,
      folderId: folder.id,
      title: displayFolderTitle(folder),
      source: folder.kind
    }))
  return [
    { id: 'all', kind: 'all', title: '全部收藏' },
    { id: 'pending', kind: 'pending', title: '待处理', count: Math.max(0, pendingCount) },
    ...folderItems
  ]
}

export function buildFavoriteLibraryDetail(
  row: FavoriteLibraryRow,
  folders: readonly FavoriteRepositoryFolder[],
  pending?: FavoriteLibraryPendingRow
): FavoriteLibraryDetail {
  const folderById = new Map(folders.map((folder) => [folder.id, folder]))
  const matchingFolders = row.folderIds
    .map((folderId) => folderById.get(folderId))
    .filter((folder): folder is FavoriteRepositoryFolder => Boolean(folder))
    .sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id))
    .map((folder) => ({ ...folder, title: displayFolderTitle(folder) }))
  return {
    ...createRow(row, row.folderIds),
    folders: matchingFolders,
    pendingStates: pending?.states ? [...pending.states] : []
  }
}

export function createFavoriteLibraryPageCursor(page: Pick<FavoriteRepositoryPage<unknown>, 'nextCursor' | 'revision'>) {
  return {
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    revision: page.revision
  }
}
