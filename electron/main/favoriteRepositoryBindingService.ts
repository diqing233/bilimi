import { randomUUID } from 'node:crypto'
import { REMOTE_FAVORITE_SHARD_CAPACITY } from '../../src/shared/favoriteRepositoryPlanning'
import { REMOTE_FAVORITE_FOLDER_LIMIT } from '../../src/shared/favoriteRepositoryPlanning'
import type { AccountFavoriteRepositorySnapshot } from '../../src/shared/favoriteRepository'
import { FavoriteRepositoryService } from './favoriteRepositoryService'
import type { FavoriteRepositoryPageBridgeManager } from './favoriteRepositorySyncService'
import type { FavoriteRepositoryRemoteOperationArbiter } from './favoriteRepositoryRemoteOperationArbiter'

export type FavoriteRepositoryRemoteFolderInventory = {
  id: string
  title: string
  memberCount: number
  memberAids: number[]
}

export type PreparePhysicalShardInput = {
  logicalLedgerId: string
  logicalTitle: string
  remoteDisplayTitle?: string
  shardNumber: number
  memberAids: number[]
  remoteFolderId?: string
  observedAccountMid: string
  inventory: FavoriteRepositoryRemoteFolderInventory[]
}

export type AdoptExistingPhysicalShardInput = {
  logicalLedgerId: string
  logicalTitle: string
  remoteDisplayTitle?: string
  expectedRemoteTitle?: string
  remoteFolderId: string
  shardNumber: number
  memberAids: number[]
}

export type FavoriteRepositoryBindingSnapshot = {
  logicalLedgers: Array<{ id: string; title: string; syncState: 'bound' | 'pending-reconcile' }>
  shards: Array<{
    logicalLedgerId: string
    folderId: string
    shardNumber: number
    remoteFolderId?: string
    remoteTitle: string
    bindingState: 'bound' | 'pending-reconcile'
    remoteMemberCount?: number
  }>
}

function normalizedAccountMid(value: string) {
  const raw = value.trim()
  if (!/^\d+$/.test(raw) || BigInt(raw) === 0n) throw new Error('Favorite repository account is invalid.')
  return BigInt(raw).toString()
}

function titleToken(value: string) {
  return value.toLowerCase().replace(/[^a-f0-9]/g, '').slice(0, 6)
}

export function favoriteRepositoryManagedShardTitle(logicalLedgerId: string, shardNumber: number, bindingToken: string) {
  return favoriteRepositoryManagedShardTitleForDisplay(logicalLedgerId, shardNumber, bindingToken)
}

function favoriteRepositoryManagedShardTitleForDisplay(
  logicalLedgerId: string,
  shardNumber: number,
  bindingToken: string,
  remoteDisplayTitle?: string
) {
  const displayTitle = remoteDisplayTitle?.trim()
  if (displayTitle) {
    if (shardNumber === 1) return Array.from(displayTitle).slice(0, 20).join('')
    const suffix = `\u00b7${String(shardNumber).padStart(2, '0')}`
    return `${Array.from(displayTitle).slice(0, Math.max(1, 20 - Array.from(suffix).length)).join('')}${suffix}`
  }
  const ledgerToken = logicalLedgerId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5).padEnd(5, '0')
  const token = titleToken(bindingToken).padEnd(6, '0')
  return `B-${ledgerToken}-${String(shardNumber).padStart(3, '0')}-${token}`
}

function normalizeInput(accountMid: string, input: PreparePhysicalShardInput, bindingToken: string) {
  const logicalLedgerId = input.logicalLedgerId.trim()
  const logicalTitle = input.logicalTitle.trim()
  if (!logicalLedgerId || !logicalTitle || !Number.isSafeInteger(input.shardNumber) || input.shardNumber < 1 ||
    !Array.isArray(input.memberAids) || input.memberAids.some((aid) => !Number.isSafeInteger(aid) || aid <= 0)) {
    throw new Error('Favorite repository shard binding is invalid.')
  }
  const memberAids = [...new Set(input.memberAids)].sort((left, right) => left - right)
  if (memberAids.length > REMOTE_FAVORITE_SHARD_CAPACITY) {
    throw new Error('Favorite repository shard capacity is exceeded.')
  }
  if (normalizedAccountMid(input.observedAccountMid) !== accountMid) throw new Error('Favorite repository remote account mismatch.')
  const remoteFolderId = input.remoteFolderId?.trim()
  const title = favoriteRepositoryManagedShardTitleForDisplay(
    logicalLedgerId, input.shardNumber, bindingToken, input.remoteDisplayTitle
  )
  const inventory = input.inventory.filter((folder) => folder && typeof folder.id === 'string' && folder.id.trim() &&
    typeof folder.title === 'string' && Number.isSafeInteger(folder.memberCount) && folder.memberCount >= 0 &&
    Array.isArray(folder.memberAids) && folder.memberAids.every((aid) => Number.isSafeInteger(aid) && aid > 0))
  if (input.inventory.length >= REMOTE_FAVORITE_FOLDER_LIMIT && !remoteFolderId) {
    throw new Error('Favorite repository remote folder limit is exceeded.')
  }
  if (remoteFolderId && !inventory.some((folder) => folder.id.trim() === remoteFolderId)) {
    throw new Error('Favorite repository remote shard is absent from inventory.')
  }
  const remote = remoteFolderId ? inventory.find((folder) => folder.id.trim() === remoteFolderId) : undefined
  if (remote && remote.title !== title) {
    throw new Error('Favorite repository remote shard title is invalid.')
  }
  const newMemberCount = remote ? memberAids.filter((aid) => !remote.memberAids.includes(aid)).length : memberAids.length
  if (remote && remote.memberCount + newMemberCount > REMOTE_FAVORITE_SHARD_CAPACITY) {
    throw new Error('Favorite repository shard capacity is exceeded.')
  }
  return { logicalLedgerId, logicalTitle, memberAids, remoteFolderId, title, inventory, remote }
}

function normalizeAdoptionInput(input: AdoptExistingPhysicalShardInput) {
  const logicalLedgerId = input.logicalLedgerId.trim()
  const logicalTitle = input.logicalTitle.trim()
  const remoteFolderId = input.remoteFolderId.trim()
  const expectedRemoteTitle = input.expectedRemoteTitle?.trim() || input.remoteDisplayTitle?.trim()
  if (!logicalLedgerId || !logicalTitle || !remoteFolderId || !expectedRemoteTitle ||
    !Number.isSafeInteger(input.shardNumber) || input.shardNumber < 1 ||
    !Array.isArray(input.memberAids) || input.memberAids.some((aid) => !Number.isSafeInteger(aid) || aid <= 0)) {
    throw new Error('Favorite repository shard adoption is invalid.')
  }
  const memberAids = [...new Set(input.memberAids)].sort((left, right) => left - right)
  if (memberAids.length > REMOTE_FAVORITE_SHARD_CAPACITY) {
    throw new Error('Favorite repository shard capacity is exceeded.')
  }
  return { logicalLedgerId, logicalTitle, remoteFolderId, expectedRemoteTitle, memberAids }
}

function bindingSnapshot(snapshot: AccountFavoriteRepositorySnapshot): FavoriteRepositoryBindingSnapshot {
  const logicalLedgers = snapshot.folders
    .filter((folder) => folder.kind === 'bilimi-logical' && folder.logicalLedgerId)
    .map((folder) => ({ id: folder.logicalLedgerId!, title: folder.title, syncState: folder.syncState as 'bound' | 'pending-reconcile' }))
    .sort((left, right) => left.id.localeCompare(right.id))
  const shards = snapshot.physicalShards.map((shard) => ({
    logicalLedgerId: shard.logicalLedgerId,
    folderId: shard.folderId,
    shardNumber: shard.shardNumber,
    ...(shard.remoteFolderId ? { remoteFolderId: shard.remoteFolderId } : {}),
    remoteTitle: shard.remoteTitle,
    bindingState: shard.bindingState,
    ...(shard.remoteMemberCount !== undefined ? { remoteMemberCount: shard.remoteMemberCount } : {})
  })).sort((left, right) => left.logicalLedgerId.localeCompare(right.logicalLedgerId) || left.shardNumber - right.shardNumber)
  return { logicalLedgers, shards }
}

/**
 * Persists only deterministic Bilimi shard bindings. Remote creation stays a
 * separate page operation: an uncertain result remains pending until inventory
 * proves exactly one managed title exists.
 */
export class FavoriteRepositoryBindingService {
  constructor(private readonly options: {
    repository: FavoriteRepositoryService
    now?: () => string
    newBindingToken?: () => string
    pageBridgeManager?: FavoriteRepositoryPageBridgeManager
    remoteOperations?: FavoriteRepositoryRemoteOperationArbiter
  }) {}

  async getBindings(accountMid: string): Promise<FavoriteRepositoryBindingSnapshot> {
    return bindingSnapshot(await this.options.repository.getSnapshot(normalizedAccountMid(accountMid)))
  }

  async preparePhysicalShard(accountMid: string, input: PreparePhysicalShardInput) {
    const account = normalizedAccountMid(accountMid)
    const bindingToken = this.options.newBindingToken?.().trim() || randomUUID()
    return this.preparePhysicalShardWithToken(account, input, bindingToken)
  }

  async adoptExistingPhysicalShard(accountMid: string, input: AdoptExistingPhysicalShardInput) {
    const account = normalizedAccountMid(accountMid)
    return this.options.remoteOperations?.run(account, () => this.adoptExistingPhysicalShardUnsafe(account, input)) ??
      this.adoptExistingPhysicalShardUnsafe(account, input)
  }

  private async adoptExistingPhysicalShardUnsafe(account: string, input: AdoptExistingPhysicalShardInput) {
    const pageBridgeManager = this.options.pageBridgeManager
    if (!pageBridgeManager) throw new Error('Favorite repository page bridge is unavailable.')
    const normalized = normalizeAdoptionInput(input)
    const runId = `favorite-adoption:${normalized.logicalLedgerId}:${normalized.shardNumber}:${randomUUID()}`
    await pageBridgeManager.bind(account, runId)
    try {
      const bridge = pageBridgeManager.pageBridge(account, runId)
      let inventory
      try {
        inventory = await bridge.readFolderInventory({ accountMid: account, operationKey: `${runId}:inventory` })
      } catch {
        throw new Error('Favorite repository remote folder inventory is unavailable.')
      }
      if (normalizedAccountMid(inventory.observedAccountMid) !== account) {
        throw new Error('Favorite repository remote account mismatch.')
      }
      // Adoption is deliberately ID-only: duplicate names must never affect the target.
      const matches = inventory.folders.filter((folder) => folder.id === normalized.remoteFolderId)
      if (matches.length !== 1) throw new Error('Favorite repository remote shard is absent from inventory.')
      const remote = matches[0]
      if (remote.title !== normalized.expectedRemoteTitle) {
        throw new Error('Favorite repository remote shard title is invalid.')
      }
      if (!Number.isSafeInteger(remote.memberCount) || remote.memberCount < 0 ||
        remote.memberCount > REMOTE_FAVORITE_SHARD_CAPACITY) {
        throw new Error('Favorite repository remote shard inventory is invalid.')
      }
      const snapshot = await this.options.repository.getSnapshot(account)
      const remoteConflict = snapshot.physicalShards.find((shard) =>
        shard.remoteFolderId === normalized.remoteFolderId &&
        (shard.logicalLedgerId !== normalized.logicalLedgerId || shard.shardNumber !== input.shardNumber))
      if (remoteConflict) throw new Error('Favorite repository remote shard is already bound.')
      const targetConflict = snapshot.physicalShards.find((shard) =>
        shard.logicalLedgerId === normalized.logicalLedgerId && shard.shardNumber === input.shardNumber &&
        shard.remoteFolderId && shard.remoteFolderId !== normalized.remoteFolderId)
      if (targetConflict) throw new Error('Favorite repository logical shard conflicts with another remote id.')
      const exactExisting = snapshot.physicalShards.find((shard) =>
        shard.logicalLedgerId === normalized.logicalLedgerId && shard.shardNumber === input.shardNumber &&
        shard.remoteFolderId === normalized.remoteFolderId && shard.bindingState === 'bound')
      if (exactExisting) return this.getBindings(account)
      await this.options.repository.commit(account, {
        id: `favorite-adoption:${normalized.logicalLedgerId}:${input.shardNumber}:${normalized.remoteFolderId}`,
        accountMid: account,
        issuedAt: this.now(),
        type: 'upsert-physical-shard-binding',
        payload: {
          logicalLedgerId: normalized.logicalLedgerId,
          logicalTitle: normalized.logicalTitle,
          shardNumber: input.shardNumber,
          // Inventory does not prove individual membership. Do not turn a
          // stale mirror into a physical-shard source of truth.
          memberAids: [],
          remoteTitle: remote.title,
          bindingState: 'bound',
          remoteFolderId: normalized.remoteFolderId,
          remoteMemberCount: remote.memberCount
        }
      })
      return this.getBindings(account)
    } finally {
      pageBridgeManager.release(account, runId)
    }
  }

  private async preparePhysicalShardWithToken(account: string, input: PreparePhysicalShardInput, bindingToken: string) {
    if (!bindingToken) throw new Error('Favorite repository binding token is invalid.')
    const normalized = normalizeInput(account, input, bindingToken)
    const remoteFolderId = normalized.remoteFolderId
    const bindingState = remoteFolderId ? 'bound' as const : 'pending-reconcile' as const
    await this.options.repository.commit(account, {
      id: `favorite-binding:${normalized.logicalLedgerId}:${input.shardNumber}:${remoteFolderId ?? 'pending'}`,
      accountMid: account,
      issuedAt: this.now(),
      type: 'upsert-physical-shard-binding',
      payload: {
        logicalLedgerId: normalized.logicalLedgerId,
        logicalTitle: normalized.logicalTitle,
        shardNumber: input.shardNumber,
        memberAids: normalized.memberAids,
        remoteTitle: normalized.title,
        bindingState,
        ...(remoteFolderId ? { remoteMemberCount: normalized.remote?.memberCount } : {}),
        ...(remoteFolderId ? { remoteFolderId } : {
          knownRemoteFolderIds: normalized.inventory.map((folder) => folder.id.trim()).sort()
        })
      }
    })
    return this.getBindings(account)
  }

  async ensurePhysicalShard(accountMid: string, input: {
    logicalLedgerId: string
    logicalTitle: string
    remoteDisplayTitle?: string
    preferredRemoteFolderId?: string
    shardNumber: number
    memberAids: number[]
  }) {
    const account = normalizedAccountMid(accountMid)
    return this.options.remoteOperations?.run(account, () => this.ensurePhysicalShardUnsafe(account, input)) ??
      this.ensurePhysicalShardUnsafe(account, input)
  }

  private async ensurePhysicalShardUnsafe(account: string, input: {
    logicalLedgerId: string
    logicalTitle: string
    remoteDisplayTitle?: string
    preferredRemoteFolderId?: string
    shardNumber: number
    memberAids: number[]
  }) {
    const pageBridgeManager = this.options.pageBridgeManager
    if (!pageBridgeManager) throw new Error('Favorite repository page bridge is unavailable.')
    const token = this.options.newBindingToken?.().trim() || randomUUID()
    const title = favoriteRepositoryManagedShardTitleForDisplay(
      input.logicalLedgerId.trim(), input.shardNumber, token, input.remoteDisplayTitle
    )
    const runId = `favorite-binding:${input.logicalLedgerId.trim()}:${input.shardNumber}:${token}`
    await pageBridgeManager.bind(account, runId)
    try {
      const bridge = pageBridgeManager.pageBridge(account, runId)
      let inventory
      try {
        inventory = await bridge.readFolderInventory({ accountMid: account, operationKey: `${runId}:inventory` })
      } catch {
        throw new Error('Favorite repository remote folder inventory is unavailable.')
      }
      const existing = inventory.folders.filter((folder) => folder.title === title)
      if (existing.length > 1) throw new Error('Favorite repository remote shard title is ambiguous.')
      const preferredRemoteFolderId = input.preferredRemoteFolderId?.trim()
      const preferred = preferredRemoteFolderId
        ? inventory.folders.find((folder) => folder.id === preferredRemoteFolderId)
        : undefined
      if (preferred?.title === title) {
        return this.preparePhysicalShardWithToken(account, {
          ...input,
          observedAccountMid: inventory.observedAccountMid,
          remoteFolderId: preferred.id,
          inventory: inventory.folders.map((folder) => ({ ...folder, memberAids: [] }))
        }, token)
      }
      if (existing.length === 1) {
        return this.preparePhysicalShardWithToken(account, {
          ...input,
          observedAccountMid: inventory.observedAccountMid,
          remoteFolderId: existing[0].id,
          inventory: inventory.folders.map((folder) => ({ ...folder, memberAids: [] }))
        }, token)
      }
      if (inventory.folders.length >= REMOTE_FAVORITE_FOLDER_LIMIT) {
        throw new Error('Favorite repository remote folder limit is exceeded.')
      }
      let finalInventory
      try {
        finalInventory = await bridge.readFolderInventory({ accountMid: account, operationKey: `${runId}:inventory-before-create` })
      } catch {
        throw new Error('Favorite repository remote folder inventory is unavailable.')
      }
      const finalMatches = finalInventory.folders.filter((folder) => folder.title === title)
      if (finalMatches.length > 1) throw new Error('Favorite repository remote shard title is ambiguous.')
      if (finalMatches.length === 1) {
        return this.preparePhysicalShardWithToken(account, {
          ...input,
          observedAccountMid: finalInventory.observedAccountMid,
          remoteFolderId: finalMatches[0].id,
          inventory: finalInventory.folders.map((folder) => ({ ...folder, memberAids: [] }))
        }, token)
      }
      if (finalInventory.folders.length >= REMOTE_FAVORITE_FOLDER_LIMIT) {
        throw new Error('Favorite repository remote folder limit is exceeded.')
      }
      try {
        const created = await bridge.createFolder({ accountMid: account, operationKey: `${runId}:create`, title })
        return this.preparePhysicalShardWithToken(account, {
          ...input,
          observedAccountMid: created.observedAccountMid,
          remoteFolderId: created.folder.id,
          inventory: [...finalInventory.folders, { ...created.folder, memberAids: [] }]
        }, token)
      } catch (error) {
        // The write may have succeeded remotely. Persist only a pending marker
        // and require a later inventory diff before any binding is trusted.
        // The caller must still see the failed confirmation rather than
        // continuing with a generic unbound target.
        await this.preparePhysicalShardWithToken(account, {
          ...input,
          observedAccountMid: finalInventory.observedAccountMid,
          inventory: finalInventory.folders.map((folder) => ({ ...folder, memberAids: [] }))
        }, token)
        throw error
      }
    } finally {
      pageBridgeManager.release(account, runId)
    }
  }

  async reconcilePendingBindings(accountMid: string, input: {
    observedAccountMid: string
    inventory: FavoriteRepositoryRemoteFolderInventory[]
  }) {
    const account = normalizedAccountMid(accountMid)
    if (normalizedAccountMid(input.observedAccountMid) !== account) throw new Error('Favorite repository remote account mismatch.')
    const snapshot = await this.options.repository.getSnapshot(account)
    for (const shard of snapshot.physicalShards.filter((candidate) => candidate.bindingState === 'pending-reconcile')) {
      const known = new Set(shard.knownRemoteFolderIds ?? [])
      const matches = input.inventory.filter((folder) => folder.title === shard.remoteTitle &&
        !known.has(folder.id) && folder.memberCount <= REMOTE_FAVORITE_SHARD_CAPACITY)
      if (matches.length !== 1) continue
      const logical = snapshot.folders.find((folder) => folder.kind === 'bilimi-logical' && folder.logicalLedgerId === shard.logicalLedgerId)
      if (!logical) continue
      await this.options.repository.commit(account, {
        id: `favorite-binding-reconcile:${shard.logicalLedgerId}:${shard.shardNumber}:${matches[0].id}`,
        accountMid: account,
        issuedAt: this.now(),
        type: 'upsert-physical-shard-binding',
        payload: {
          logicalLedgerId: shard.logicalLedgerId,
          logicalTitle: logical.title,
          shardNumber: shard.shardNumber,
          memberAids: snapshot.memberships[shard.folderId] ?? [],
          remoteTitle: shard.remoteTitle,
          bindingState: 'bound',
          remoteFolderId: matches[0].id
        }
      })
    }
    return this.getBindings(account)
  }

  private now() {
    return this.options.now?.() ?? new Date().toISOString()
  }
}
