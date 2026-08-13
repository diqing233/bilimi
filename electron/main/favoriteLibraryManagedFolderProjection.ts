import type { AccountFavoriteRepositorySnapshot, FavoriteRepositoryCommand } from '../../src/shared/favoriteRepository'
import { isBilimiManagedLedgerName } from '../../src/shared/favoriteLedgers'
import { resolveFavoriteFolderCapabilities } from '../../src/shared/favoriteLedgerCapabilities'
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

function emptyCustomPendingDuplicateLedgerIds(snapshot: AccountFavoriteRepositorySnapshot, ledgers: FavoriteLedger[]) {
  const configuredLedgerIds = new Set(ledgers.map((ledger) => ledger.id.trim()).filter(Boolean))
  const boundLogicalIdByRemoteId = new Map(snapshot.physicalShards
    .filter((shard) => shard.bindingState === 'bound' && shard.remoteFolderId &&
      configuredLedgerIds.has(shard.logicalLedgerId))
    .map((shard) => [shard.remoteFolderId!, shard.logicalLedgerId]))
  const pendingByLogicalId = new Map<string, typeof snapshot.physicalShards>()
  for (const shard of snapshot.physicalShards) {
    if (!shard.logicalLedgerId.startsWith('custom-') || shard.bindingState !== 'pending-reconcile') continue
    pendingByLogicalId.set(shard.logicalLedgerId, [...(pendingByLogicalId.get(shard.logicalLedgerId) ?? []), shard])
  }
  return [...pendingByLogicalId]
    .filter(([logicalLedgerId, shards]) => {
      const logicalFolderId = `bilimi-logical:${logicalLedgerId}`
      if ((snapshot.memberships[`bilimi-logical:${logicalLedgerId}`] ?? []).length) return false
      if (Object.values(snapshot.positions ?? {}).some((position) => position.localDesiredFolderIds.includes(logicalFolderId))) return false
      if (shards.some((shard) => (snapshot.memberships[shard.folderId] ?? []).length)) return false
      if (shards.some((shard) => (shard.knownRemoteFolderIds?.length ?? 0) !== 1)) return false
      const knownRemoteFolderIds = [...new Set(shards.flatMap((shard) => shard.knownRemoteFolderIds ?? []))]
      if (knownRemoteFolderIds.length !== 1) return false
      const boundLogicalLedgerId = boundLogicalIdByRemoteId.get(knownRemoteFolderIds[0])
      return Boolean(boundLogicalLedgerId && boundLogicalLedgerId !== logicalLedgerId)
    })
    .map(([logicalLedgerId]) => logicalLedgerId)
    .sort()
}

function stableCustomLedgerId(title: string) {
  let hash = 2166136261
  for (const character of title.trim().normalize('NFKC').toLocaleLowerCase('zh-Hans-CN')) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return `custom-${(hash >>> 0).toString(36)}`
}

function normalizedLedgerDisplayTitle(title: string) {
  return title.trim().replace(/^bilimi\s*[·.\s_-]*/iu, '').trim().toLocaleLowerCase()
}

/** A numbered shard is recognized only as an exact configured title plus `·N`. */
function configuredLedgerShard(title: string, ledgers: FavoriteLedger[]) {
  const normalizedTitle = normalizedLedgerDisplayTitle(title)
  for (const ledger of ledgers) {
    const baseTitle = normalizedLedgerDisplayTitle(ledger.displayName)
    if (!baseTitle) continue
    if (normalizedTitle === baseTitle) return { ledger, shardNumber: 1 }
    const escapedBase = baseTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = normalizedTitle.match(new RegExp(`^${escapedBase}[·.]0*([2-9]\\d*)$`, 'u'))
    if (match) return { ledger, shardNumber: Number(match[1]) }
  }
  return undefined
}

function remoteIdsForCandidate(candidate: FavoriteLibraryManagedFolderProjection) {
  return candidate.remoteFolderId ? [candidate.remoteFolderId] : candidate.knownRemoteFolderIds ?? []
}

function assignStableShardNumbers(candidates: FavoriteLibraryManagedFolderProjection[]) {
  const byLogicalLedger = new Map<string, FavoriteLibraryManagedFolderProjection[]>()
  for (const candidate of candidates) {
    byLogicalLedger.set(candidate.logicalLedgerId, [...(byLogicalLedger.get(candidate.logicalLedgerId) ?? []), candidate])
  }
  return [...byLogicalLedger.values()].flatMap((group) => {
    const used = new Set<number>()
    const assigned: FavoriteLibraryManagedFolderProjection[] = []
    for (const candidate of group) {
      if (candidate.bindingState !== 'bound') continue
      used.add(candidate.shardNumber)
      assigned.push(candidate)
    }
    const pending = group.filter((candidate) => candidate.bindingState !== 'bound')
      .sort((left, right) => remoteIdsForCandidate(left).join(',').localeCompare(remoteIdsForCandidate(right).join(',')))
    for (const candidate of pending) {
      let shardNumber = candidate.shardNumber
      if (used.has(shardNumber) || pending.filter((item) => item !== candidate && item.shardNumber === shardNumber).length) {
        shardNumber = 1
        while (used.has(shardNumber)) shardNumber += 1
      }
      used.add(shardNumber)
      assigned.push({ ...candidate, shardNumber })
    }
    return assigned
  })
}

export function planFavoriteLibraryManagedFolderProjection(input: {
  snapshot: AccountFavoriteRepositorySnapshot
  ledgers: FavoriteLedger[]
  dismissedRemoteFolderIds: Iterable<string>
}): FavoriteLibraryManagedFolderProjection[] {
  const dismissed = new Set(Array.from(input.dismissedRemoteFolderIds, (id) => id.trim()).filter(Boolean))
  const configuredLedgersByRemoteId = new Map(input.ledgers
    .filter((ledger) => ledger.bilibiliFolderId?.trim())
    .map((ledger) => [ledger.bilibiliFolderId!.trim(), ledger]))
  // Display-name matching is recovery projection only, never a formal binding.
  // It restores the existing logical card after a local reset so that the user
  // can explicitly confirm its Bilibili candidates in the backup dialog.
  const configuredLedgersByLogicalTitle = new Map(input.ledgers
    .map((ledger) => [normalizedLedgerDisplayTitle(ledger.displayName), ledger] as const)
    .filter(([title]) => Boolean(title)))
  const formalBindingsByRemoteId = new Map(input.snapshot.physicalShards
    .filter((shard) => shard.bindingState === 'bound' && shard.remoteFolderId)
    .map((shard) => [shard.remoteFolderId!, shard]))
  const candidates: FavoriteLibraryManagedFolderProjection[] = []

  for (const folder of input.snapshot.folders) {
    if (folder.kind !== 'bilibili' || !folder.remoteFolderId || dismissed.has(folder.remoteFolderId)) continue
    if (resolveFavoriteFolderCapabilities(folder).identity !== 'ambiguous-bilimi-like') continue
    const title = folder.title.trim()
    if (!isBilimiManagedLedgerName(title)) continue
    const configuredById = configuredLedgersByRemoteId.get(folder.remoteFolderId)
    const formalBinding = formalBindingsByRemoteId.get(folder.remoteFolderId)
    // Renderer settings are not binding authority. The repository shard must
    // confirm the same remote ID and logical ledger before this is considered bound.
    // A saved remote ID can restore the local logical identity as an unbound
    // candidate, but only a repository shard makes it a formal binding.
    const formallyBoundLedger = formalBinding
      ? input.ledgers.find((candidate) => candidate.id === formalBinding.logicalLedgerId)
      : undefined
    if (formalBinding && formallyBoundLedger) {
      const logicalTitle = formallyBoundLedger.displayName.trim() || title
      const memberAids = [...new Set(input.snapshot.memberships[folder.id] ?? [])].sort((left, right) => left - right)
      candidates.push({
        logicalLedgerId: formalBinding.logicalLedgerId,
        logicalTitle,
        shardNumber: formalBinding.shardNumber,
        remoteTitle: title,
        memberAids,
        bindingState: 'bound',
        remoteFolderId: folder.remoteFolderId,
        remoteMemberCount: memberAids.length
      })
      continue
    }
    // A configured remote ID can recover the local logical ledger as an
    // explicitly unbound candidate. Title suffixes are ignored only in this
    // ID-directed case; otherwise they are user-authored candidate names.
    const titleShard = configuredLedgerShard(title, input.ledgers)
    const ledger = configuredById ?? titleShard?.ledger ?? configuredLedgersByLogicalTitle.get(normalizedLedgerDisplayTitle(title))
    const logicalTitle = ledger?.displayName.trim() || title
    const logicalLedgerId = ledger?.id ?? stableCustomLedgerId(title)
    const shardNumber = configuredById ? 1 : titleShard?.shardNumber ?? 1
    const memberAids = [...new Set(input.snapshot.memberships[folder.id] ?? [])].sort((left, right) => left - right)
    candidates.push({
      logicalLedgerId,
      logicalTitle,
      shardNumber,
      remoteTitle: title,
      memberAids,
      bindingState: 'pending-reconcile',
      knownRemoteFolderIds: [folder.remoteFolderId]
    })
  }

  const byTarget = new Map<string, FavoriteLibraryManagedFolderProjection[]>()
  for (const candidate of assignStableShardNumbers(candidates)) {
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
  let snapshot = await input.repository.getSnapshot(input.accountMid)
  for (const logicalLedgerId of emptyCustomPendingDuplicateLedgerIds(snapshot, input.ledgers)) {
    await input.repository.commit(input.accountMid, {
      id: `favorite-library:remove-duplicate-managed:${logicalLedgerId}:${snapshot.revision}`,
      accountMid: input.accountMid,
      issuedAt: input.now?.() ?? new Date().toISOString(),
      type: 'delete-local-managed-folder',
      payload: { logicalFolderId: `bilimi-logical:${logicalLedgerId}` }
    })
    snapshot = await input.repository.getSnapshot(input.accountMid)
  }
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
