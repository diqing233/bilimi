import type { FavoriteArchiveProtectionRecord } from './types'

export type FavoriteArchiveSourceVideo = {
  aid: number
  title: string
  author?: string
  description?: string
  tags?: string[]
  pageText?: string
  category?: string
  sourceFolderIds?: string[]
  sourceFolderTitles?: string[]
  currentBilimiFolderIds?: string[]
  protectedForIncrementalScan?: boolean
  archiveHealth?: FavoriteArchiveProtectionHealth
}

export type FavoriteArchiveProtectionHealth = 'complete' | 'incomplete' | 'invalid'

export type FavoriteArchiveSourceFolder = {
  id: string
  title: string
  videos: FavoriteArchiveSourceVideo[]
}

export type FavoriteArchiveManagedFolder = {
  id: string
  title: string
  ledgerId?: string
  isInbox: boolean
}

function normalizedStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return Array.from(
    new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))
  )
}

export function normalizeFavoriteArchiveProtectionInitializedAccountMids(value: unknown) {
  return normalizedStringList(value)
}

export function normalizeFavoriteArchiveProtectionRecords(
  value: unknown
): FavoriteArchiveProtectionRecord[] {
  if (!Array.isArray(value)) {
    return []
  }

  const records = new Map<string, FavoriteArchiveProtectionRecord>()
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const record = item as Record<string, unknown>
    const accountMid = typeof record.accountMid === 'string' ? record.accountMid.trim() : ''
    const aid = typeof record.aid === 'number' && Number.isFinite(record.aid) ? record.aid : 0
    const completedAt = typeof record.completedAt === 'string' ? record.completedAt.trim() : ''
    if (!accountMid || aid <= 0 || !completedAt) {
      continue
    }

    records.set(`${accountMid}:${aid}`, {
      accountMid,
      aid,
      targetLedgerIds: normalizedStringList(record.targetLedgerIds),
      targetFolderIds: normalizedStringList(record.targetFolderIds),
      completedAt
    })
  }

  return Array.from(records.values())
}

export function upsertFavoriteArchiveProtectionRecords(
  current: FavoriteArchiveProtectionRecord[],
  updates: FavoriteArchiveProtectionRecord[]
) {
  const normalizedUpdates = normalizeFavoriteArchiveProtectionRecords(updates)
  const updateKeys = new Set(normalizedUpdates.map((record) => `${record.accountMid}:${record.aid}`))

  return [
    ...normalizedUpdates,
    ...normalizeFavoriteArchiveProtectionRecords(current).filter(
      (record) => !updateKeys.has(`${record.accountMid}:${record.aid}`)
    )
  ]
}

export function partitionFavoriteArchiveSources(args: {
  accountMid: string
  sourceFolders: FavoriteArchiveSourceFolder[]
  managedFolders: FavoriteArchiveManagedFolder[]
  targetMembership: Record<string, number[]>
  protectionRecords: FavoriteArchiveProtectionRecord[]
  initializeExistingMembership?: boolean
  now?: string
}) {
  const videosByAid = new Map<number, FavoriteArchiveSourceVideo>()
  for (const folder of args.sourceFolders) {
    for (const video of folder.videos) {
      const existing = videosByAid.get(video.aid)
      const sourceFolderIds = Array.from(
        new Set([...(existing?.sourceFolderIds ?? []), folder.id])
      )
      const sourceFolderTitles = Array.from(
        new Set([...(existing?.sourceFolderTitles ?? []), folder.title])
      )
      videosByAid.set(video.aid, {
        ...(existing ?? video),
        ...video,
        sourceFolderIds,
        sourceFolderTitles
      })
    }
  }

  const protectionRecordsByAid = new Map(
    normalizeFavoriteArchiveProtectionRecords(args.protectionRecords)
      .filter((record) => record.accountMid === args.accountMid)
      .map((record) => [record.aid, record] as const)
  )
  const membershipByAid = new Map<number, string[]>()
  for (const folder of args.managedFolders) {
    for (const aid of args.targetMembership[folder.id] ?? []) {
      membershipByAid.set(aid, [...(membershipByAid.get(aid) ?? []), folder.id])
    }
  }

  const protectedVideos: FavoriteArchiveSourceVideo[] = []
  const activeVideos: FavoriteArchiveSourceVideo[] = []
  const initializedProtectionRecords: FavoriteArchiveProtectionRecord[] = []
  for (const video of videosByAid.values()) {
    const protectionRecord = protectionRecordsByAid.get(video.aid)
    const currentBilimiFolderIds = Array.from(new Set(membershipByAid.get(video.aid) ?? []))
    const nonInboxFolders = args.managedFolders.filter(
      (folder) => !folder.isInbox && currentBilimiFolderIds.includes(folder.id)
    )
    const recordedTargetKeys = protectionRecord?.targetLedgerIds.length
      ? protectionRecord.targetLedgerIds.map((ledgerId) => `ledger:${ledgerId}`)
      : protectionRecord?.targetFolderIds.map((folderId) => `folder:${folderId}`) ?? []
    const protectionRecordTargetsOnlyInbox = recordedTargetKeys.length > 0 && recordedTargetKeys.every(
      (targetKey) => args.managedFolders.some((folder) =>
        folder.isInbox && (
          targetKey === `ledger:${folder.ledgerId ?? ''}` ||
          targetKey === `folder:${folder.id}`
        )
      )
    )
    const protectionRecordTargetsFormalFolder = Boolean(protectionRecord) && !protectionRecordTargetsOnlyInbox
    const initializeExistingMembership = args.initializeExistingMembership !== false
    // A historical record proves a past archive, not current membership. Once the
    // user moves it back out of every formal folder, it must re-enter the queue.
    const protectedForIncrementalScan = nonInboxFolders.length > 0
    let archiveHealth: FavoriteArchiveProtectionHealth | undefined
    if (protectionRecord) {
      const historicalTargets = protectionRecord.targetLedgerIds.length > 0
        ? protectionRecord.targetLedgerIds.map((ledgerId) => ({ ledgerId }))
        : protectionRecord.targetFolderIds.map((folderId) => ({ folderId }))
      const matchingTargets = historicalTargets.filter((target) => {
        const currentFolders = target.ledgerId
          ? args.managedFolders.filter((folder) => folder.ledgerId === target.ledgerId)
          : args.managedFolders.filter((folder) => folder.id === target.folderId)
        return currentFolders.some((folder) => currentBilimiFolderIds.includes(folder.id))
      }).length
      archiveHealth = matchingTargets === historicalTargets.length && historicalTargets.length > 0
        ? 'complete'
        : matchingTargets > 0
          ? 'incomplete'
          : 'invalid'
    }
    const nextVideo = {
      ...video,
      currentBilimiFolderIds,
      protectedForIncrementalScan,
      archiveHealth
    }

    if (protectedForIncrementalScan) {
      protectedVideos.push(nextVideo)
      if (initializeExistingMembership && !protectionRecordTargetsFormalFolder && nonInboxFolders.length > 0) {
        initializedProtectionRecords.push({
          accountMid: args.accountMid,
          aid: video.aid,
          targetLedgerIds: nonInboxFolders
            .map((folder) => folder.ledgerId)
            .filter((ledgerId): ledgerId is string => Boolean(ledgerId)),
          targetFolderIds: nonInboxFolders.map((folder) => folder.id),
          completedAt: args.now ?? new Date().toISOString()
        })
      }
    } else {
      activeVideos.push(nextVideo)
    }
  }

  const activeFolderMap = new Map<string, FavoriteArchiveSourceFolder>()
  for (const video of activeVideos) {
    const id = video.sourceFolderIds?.[0] ?? 'incremental-active'
    const title = video.sourceFolderTitles?.[0] ?? '本轮待整理'
    const folder = activeFolderMap.get(id) ?? { id, title, videos: [] }
    folder.videos.push(video)
    activeFolderMap.set(id, folder)
  }
  const activeSourceFolders = Array.from(activeFolderMap.values())

  return {
    activeSourceFolders,
    protectedVideos,
    initializedProtectionRecords,
    totalUniqueVideos: videosByAid.size
  }
}
