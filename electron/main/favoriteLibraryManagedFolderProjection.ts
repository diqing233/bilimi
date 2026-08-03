import type { AccountFavoriteRepositorySnapshot, FavoriteRepositoryCommand } from '../../src/shared/favoriteRepository'
import { isBilimiManagedLedgerName } from '../../src/shared/favoriteLedgers'
import type { FavoriteLedger } from '../../src/shared/types'

export type FavoriteLibraryManagedFolderProjection = {
  logicalLedgerId: string
  logicalTitle: string
  shardNumber: number
  remoteTitle: string
  memberAids: number[]
  bindingState: 'bound' | 'pending-reconcile'
  remoteFolderId?: string
  knownRemoteFolderIds?: string[]
  remoteMemberCount?: number
}

type ProjectionRepository = {
  getSnapshot(accountMid: string): Promise<AccountFavoriteRepositorySnapshot>
  commit(accountMid: string, command: FavoriteRepositoryCommand): Promise<unknown>
}

function stableCustomLedgerId(title: string) {
  let hash = 2166136261
  for (const character of title.trim().normalize('NFKC').toLocaleLowerCase('zh-Hans-CN')) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return `custom-${(hash >>> 0).toString(36)}`
}

function splitShardTitle(title: string) {
  const normalized = title.trim()
  const match = /^(.*?)(?:\u00b7(\d+))?$/u.exec(normalized)
  const shardNumber = match?.[2] ? Number(match[2]) : 1
  return {
    baseTitle: match?.[2] && Number.isSafeInteger(shardNumber) && shardNumber >= 2 ? match[1].trim() : normalized,
    shardNumber: Number.isSafeInteger(shardNumber) && shardNumber >= 1 ? shardNumber : 1
  }
}

export function planFavoriteLibraryManagedFolderProjection(input: {
  snapshot: AccountFavoriteRepositorySnapshot
  ledgers: FavoriteLedger[]
  dismissedRemoteFolderIds: Iterable<string>
}): FavoriteLibraryManagedFolderProjection[] {
  const dismissed = new Set(Array.from(input.dismissedRemoteFolderIds, (id) => id.trim()).filter(Boolean))
  const ledgersByTitle = new Map(input.ledgers.map((ledger) => [ledger.displayName.trim(), ledger]))
  const configuredLedgersByRemoteId = new Map(input.ledgers
    .filter((ledger) => ledger.bilibiliFolderId?.trim())
    .map((ledger) => [ledger.bilibiliFolderId!.trim(), ledger]))
  const candidates: FavoriteLibraryManagedFolderProjection[] = []

  for (const folder of input.snapshot.folders) {
    if (folder.kind !== 'bilibili' || !folder.remoteFolderId || dismissed.has(folder.remoteFolderId)) continue
    const title = folder.title.trim()
    if (!isBilimiManagedLedgerName(title)) continue
    const { baseTitle, shardNumber } = splitShardTitle(title)
    const configuredById = configuredLedgersByRemoteId.get(folder.remoteFolderId)
    const ledger = configuredById ?? ledgersByTitle.get(baseTitle)
    const logicalTitle = ledger?.displayName.trim() || baseTitle
    const memberAids = [...new Set(input.snapshot.memberships[folder.id] ?? [])].sort((left, right) => left - right)
    const bound = Boolean(configuredById && configuredById.id === ledger?.id && shardNumber === 1)
    candidates.push({
      logicalLedgerId: ledger?.id ?? stableCustomLedgerId(baseTitle),
      logicalTitle,
      shardNumber,
      remoteTitle: title,
      memberAids,
      bindingState: bound ? 'bound' : 'pending-reconcile',
      ...(bound ? { remoteFolderId: folder.remoteFolderId, remoteMemberCount: memberAids.length } : { knownRemoteFolderIds: [folder.remoteFolderId] })
    })
  }

  const byTarget = new Map<string, FavoriteLibraryManagedFolderProjection[]>()
  for (const candidate of candidates) {
    const target = `${candidate.logicalLedgerId}:${candidate.shardNumber}`
    byTarget.set(target, [...(byTarget.get(target) ?? []), candidate])
  }
  return [...byTarget.values()].map((matches) => {
    if (matches.length === 1) return matches[0]
    const first = matches[0]
    return {
      ...first,
      memberAids: [],
      bindingState: 'pending-reconcile' as const,
      remoteFolderId: undefined,
      remoteMemberCount: undefined,
      knownRemoteFolderIds: [...new Set(matches.flatMap((candidate) => candidate.remoteFolderId ? [candidate.remoteFolderId] : candidate.knownRemoteFolderIds ?? []))].sort()
    }
  }).sort((left, right) => left.logicalLedgerId.localeCompare(right.logicalLedgerId) || left.shardNumber - right.shardNumber)
}

export async function restoreFavoriteLibraryManagedFolderProjection(input: {
  accountMid: string
  repository: ProjectionRepository
  ledgers: FavoriteLedger[]
  isDismissed: (remoteFolderId: string) => boolean
  now?: () => string
}) {
  const snapshot = await input.repository.getSnapshot(input.accountMid)
  const candidates = planFavoriteLibraryManagedFolderProjection({
    snapshot,
    ledgers: input.ledgers,
    dismissedRemoteFolderIds: snapshot.folders
      .filter((folder) => folder.kind === 'bilibili' && folder.remoteFolderId && input.isDismissed(folder.remoteFolderId))
      .map((folder) => folder.remoteFolderId!)
  })
  let current = snapshot
  for (const candidate of candidates) {
    const existing = current.physicalShards.find((shard) =>
      shard.logicalLedgerId === candidate.logicalLedgerId && shard.shardNumber === candidate.shardNumber)
    const knownIds = candidate.knownRemoteFolderIds ?? []
    if (existing?.bindingState === candidate.bindingState &&
      existing.remoteFolderId === candidate.remoteFolderId &&
      JSON.stringify(existing.knownRemoteFolderIds ?? []) === JSON.stringify(knownIds)) continue
    const identity = candidate.remoteFolderId ?? (knownIds.join(',') || 'draft')
    const commandId = `favorite-library:restore-managed:${candidate.logicalLedgerId}:${candidate.shardNumber}:${identity}`
    await input.repository.commit(input.accountMid, {
      id: commandId,
      accountMid: input.accountMid,
      issuedAt: input.now?.() ?? new Date().toISOString(),
      type: 'upsert-physical-shard-binding',
      payload: candidate
    })
    current = await input.repository.getSnapshot(input.accountMid)
  }
  return candidates
}
