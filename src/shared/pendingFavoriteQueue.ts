import type {
  PendingFavoriteQueueItem,
  PendingFavoriteQueueStatus,
  PendingFavoriteQueueSummary
} from './types'

function isStatus(value: unknown): value is PendingFavoriteQueueStatus {
  return value === 'pending' || value === 'archived' || value === 'dismissed'
}

function normalizeItem(value: unknown): PendingFavoriteQueueItem | null {
  const item = value as Partial<PendingFavoriteQueueItem>
  if (!item || typeof item.aid !== 'number' || !Number.isFinite(item.aid) || !item.title) {
    return null
  }

  return {
    aid: item.aid,
    title: String(item.title),
    source: item.source === 'new-favorite' ? 'new-favorite' : 'old-favorite-scan',
    sourceFolderTitle: item.sourceFolderTitle,
    originalTargetLedgerId: item.originalTargetLedgerId,
    suggestedLedgerIds: Array.isArray(item.suggestedLedgerIds) ? item.suggestedLedgerIds : [],
    candidateLedgerNames: Array.isArray(item.candidateLedgerNames) ? item.candidateLedgerNames : [],
    reason: item.reason || '等待分类',
    createdAt: item.createdAt || new Date(0).toISOString(),
    updatedAt: item.updatedAt || item.createdAt || new Date(0).toISOString(),
    status: isStatus(item.status) ? item.status : 'pending'
  }
}

export function normalizePendingFavoriteQueue(items: unknown[]): PendingFavoriteQueueItem[] {
  return items
    .map(normalizeItem)
    .filter((item): item is PendingFavoriteQueueItem => Boolean(item))
    .filter((item) => item.status === 'pending')
}

export function upsertPendingFavoriteQueueItems(
  current: PendingFavoriteQueueItem[],
  incoming: PendingFavoriteQueueItem[],
  now = new Date().toISOString()
): PendingFavoriteQueueItem[] {
  const byAid = new Map(current.map((item) => [item.aid, item]))

  for (const item of incoming) {
    const existing = byAid.get(item.aid)
    byAid.set(item.aid, {
      ...item,
      createdAt: existing?.createdAt ?? item.createdAt ?? now,
      updatedAt: now,
      status: 'pending'
    })
  }

  return [...byAid.values()]
}

export function updatePendingFavoriteQueueItemStatus(
  current: PendingFavoriteQueueItem[],
  aid: number,
  status: PendingFavoriteQueueStatus,
  now = new Date().toISOString()
): PendingFavoriteQueueItem[] {
  return current.map((item) =>
    item.aid === aid
      ? {
          ...item,
          status,
          updatedAt: now
        }
      : item
  )
}

export function archivePendingFavoriteQueueItem(
  current: PendingFavoriteQueueItem[],
  aid: number,
  now = new Date().toISOString()
): PendingFavoriteQueueItem[] {
  return updatePendingFavoriteQueueItemStatus(current, aid, 'archived', now)
}

export function createPendingFavoriteQueueSummary(
  items: PendingFavoriteQueueItem[]
): PendingFavoriteQueueSummary {
  const pendingItems = items.filter((item) => item.status === 'pending')

  return {
    totalPending: pendingItems.length,
    suggestedExistingCount: pendingItems.filter((item) => item.suggestedLedgerIds.length > 0).length,
    suggestedCandidateLedgerCount: pendingItems.filter((item) => item.candidateLedgerNames.length > 0).length,
    stagingCount: pendingItems.filter(
      (item) => item.suggestedLedgerIds.length === 0 && item.candidateLedgerNames.length === 0
    ).length
  }
}
