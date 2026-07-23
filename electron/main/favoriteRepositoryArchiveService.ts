import {
  createFavoriteRepositoryArchiveExport,
  validateFavoriteRepositoryArchiveExport,
  type AccountFavoriteRepositorySnapshot,
  type FavoriteRepositoryArchiveExport,
  type FavoriteRepositoryEvent
} from '../../src/shared/favoriteRepository'

type EventPage = {
  items: FavoriteRepositoryEvent[]
  nextCursor?: string
}

export type FavoriteRepositoryArchiveRepository = {
  getSnapshot(accountMid: string): Promise<AccountFavoriteRepositorySnapshot>
  getEventPage(accountMid: string, aid: number, options: { limit: number; cursor?: string }): Promise<EventPage>
}

export type FavoriteRepositoryArchiveIndexEntry = {
  aid: number
  archiveId: string
  registeredAt: string
  version?: string
}

export type FavoriteRepositoryArchiveImportPreview = {
  archive: FavoriteRepositoryArchiveExport & { checksum: string }
  accountMatches: boolean
  canApply: boolean
  canRestoreRemotely: boolean
  videoCount: number
  eventCount: number
}

export type FavoriteRepositoryRestoreObservation = Record<number, {
  /** Only Bilimi-managed logical folders belong to a full restore's removal set. */
  managedLogicalFolderIds: string[]
  /** Kept in the type to make accidental ordinary-source deletion impossible. */
  ordinaryRemoteFolderIds?: string[]
}>

export type FavoriteRepositoryRestorePlan = {
  mode: 'safe' | 'full'
  accountMid: string
  operations: Array<{
    aid: number
    appendLogicalFolderIds: string[]
    removeLogicalFolderIds: string[]
  }>
}

function normalizedAccountMid(value: string) {
  const raw = value.trim()
  if (!/^\d+$/.test(raw) || BigInt(raw) === 0n) throw new Error('Favorite repository account is invalid.')
  return BigInt(raw).toString()
}

function uniqueFolderIds(value: readonly string[]) {
  return [...new Set(value.map((folderId) => folderId.trim()).filter(Boolean))].sort()
}

function decodeArchive(input: string | unknown, maximumBytes: number) {
  const raw = typeof input === 'string' ? input : JSON.stringify(input)
  if (Buffer.byteLength(raw, 'utf8') > maximumBytes) throw new Error('Favorite repository archive size exceeds the safety limit.')
  try {
    return validateFavoriteRepositoryArchiveExport(JSON.parse(raw))
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Favorite repository archive is invalid.')
    throw error
  }
}

/**
 * Portable archive orchestration. Persistence and remote writes are injected so
 * validating or previewing an archive can never mutate an account by itself.
 */
export class FavoriteRepositoryArchiveService {
  private readonly maximumBytes: number

  constructor(private readonly options: {
    repository: FavoriteRepositoryArchiveRepository
    now?: () => string
    maxImportBytes?: number
    loadArchiveIndex?: (accountMid: string) => Promise<FavoriteRepositoryArchiveIndexEntry[]>
    applyImportedArchive?: (archive: FavoriteRepositoryArchiveExport & { checksum: string }) => Promise<void>
  }) {
    this.maximumBytes = options.maxImportBytes ?? 25 * 1024 * 1024
    if (!Number.isSafeInteger(this.maximumBytes) || this.maximumBytes < 1) {
      throw new Error('Favorite repository archive size limit is invalid.')
    }
  }

  async exportAccount(accountMid: string) {
    const account = normalizedAccountMid(accountMid)
    const snapshot = await this.options.repository.getSnapshot(account)
    if (normalizedAccountMid(snapshot.accountMid) !== account) throw new Error('Favorite repository account mismatch.')
    const events = await this.loadEvents(account, Object.keys(snapshot.videos).map(Number))
    const archives = await this.options.loadArchiveIndex?.(account) ?? []
    return createFavoriteRepositoryArchiveExport(snapshot, {
      generatedAt: this.now(), events, archives: archives.map((archive) => ({ ...archive }))
    })
  }

  previewImport(input: string | unknown, accountMid: string): FavoriteRepositoryArchiveImportPreview {
    const archive = decodeArchive(input, this.maximumBytes)
    const accountMatches = archive.accountMid === normalizedAccountMid(accountMid)
    return {
      archive,
      accountMatches,
      canApply: accountMatches,
      canRestoreRemotely: accountMatches,
      videoCount: archive.videos?.length ?? 0,
      eventCount: archive.events?.length ?? 0
    }
  }

  async applyImport(input: string | unknown, accountMid: string) {
    const preview = this.previewImport(input, accountMid)
    if (!preview.canApply) throw new Error('Favorite repository archive belongs to a different account and is read-only.')
    if (!this.options.applyImportedArchive) throw new Error('Favorite repository archive import is unavailable.')
    await this.options.applyImportedArchive(preview.archive)
    return preview
  }

  createRestorePlan(
    input: string | FavoriteRepositoryArchiveExport,
    observed: FavoriteRepositoryRestoreObservation,
    mode: 'safe' | 'full'
  ): FavoriteRepositoryRestorePlan {
    const archive = decodeArchive(input, this.maximumBytes)
    const desiredByAid = new Map((archive.positions ?? []).map((position) => [position.aid, uniqueFolderIds(position.localDesiredFolderIds)]))
    const operations = [...desiredByAid.entries()].flatMap(([aid, desired]) => {
      // Inbox is local-only: an empty desired set must never create remote storage.
      if (!desired.length) return []
      const current = uniqueFolderIds(observed[aid]?.managedLogicalFolderIds ?? [])
      const appendLogicalFolderIds = desired.filter((folderId) => !current.includes(folderId))
      const removeLogicalFolderIds = mode === 'full'
        ? current.filter((folderId) => !desired.includes(folderId))
        : []
      return appendLogicalFolderIds.length || removeLogicalFolderIds.length
        ? [{ aid, appendLogicalFolderIds, removeLogicalFolderIds }]
        : []
    })
    return { mode, accountMid: archive.accountMid, operations: operations.sort((left, right) => left.aid - right.aid) }
  }

  private async loadEvents(accountMid: string, aids: number[]) {
    const events: FavoriteRepositoryEvent[] = []
    for (const aid of [...new Set(aids)].filter((value) => Number.isSafeInteger(value) && value > 0)) {
      let cursor: string | undefined
      do {
        const page = await this.options.repository.getEventPage(accountMid, aid, { limit: 500, ...(cursor ? { cursor } : {}) })
        events.push(...page.items)
        cursor = page.nextCursor
      } while (cursor)
    }
    return events.sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id))
  }

  private now() {
    return this.options.now?.() ?? new Date().toISOString()
  }
}
