import { randomUUID } from 'node:crypto'
import type { FavoriteRepositoryCommand, FavoriteRepositoryEvent } from '../../src/shared/favoriteRepository'
import type { FavoriteRepositoryService } from './favoriteRepositoryService'

type Repository = Pick<FavoriteRepositoryService, 'getSnapshot' | 'commit'>

export type ManagedFolderDeletionResult = {
  status: 'succeeded' | 'result-unknown'
  operationId: string
  auditStatus: 'recorded' | 'failed'
}

type RemoteFolderWriter = {
  removeRemoteFolder(accountMid: string, remoteFolderId: string): Promise<void>
}

export type ManagedFolderDeletionPreview = {
  operationId: string
  accountMid: string
  logicalFolderId: string
  localMemberCount: number
  unmatchedFallbackCount: number
  remoteBinding?: { remoteFolderId: string; shardCount: number }
  remoteOnlyMemberCount: number
  extraRemoteMemberCount: number
  currentRevision: number
  executionToken: string
}

type PendingDeletion = ManagedFolderDeletionPreview & { confirmationToken?: string; status: 'previewed' | 'result-unknown' | 'succeeded' }

function account(value: string) {
  if (!/^\d+$/.test(value.trim()) || BigInt(value.trim()) === 0n) throw new Error('Managed folder account is invalid.')
  return BigInt(value.trim()).toString()
}

/** Implements a deliberately one-shot managed-folder remote deletion flow. */
export class FavoriteRepositoryManagedFolderService {
  private readonly operations = new Map<string, PendingDeletion>()

  constructor(private readonly options: { repository: Repository; remote?: RemoteFolderWriter; now?: () => string }) {}

  async preview(accountMid: string, logicalFolderId: string): Promise<ManagedFolderDeletionPreview> {
    const normalizedAccount = account(accountMid)
    const folderId = logicalFolderId.trim()
    if (folderId === 'local:inbox') throw new Error('The unmatched safety folder cannot be deleted.')
    if (!/^bilimi-logical:\S+$/.test(folderId)) throw new Error('Managed folder is invalid.')
    const snapshot = await this.options.repository.getSnapshot(normalizedAccount)
    const logical = snapshot.folders.find((folder) => folder.id === folderId && folder.kind === 'bilimi-logical')
    if (!logical?.logicalLedgerId) throw new Error('Managed folder was not found.')
    const members = new Set(snapshot.memberships[folderId] ?? [])
    const shards = snapshot.physicalShards.filter((shard) => shard.logicalLedgerId === logical.logicalLedgerId && shard.remoteFolderId)
    const remoteIds = new Set(shards.map((shard) => shard.remoteFolderId!))
    const remoteMembers = new Set(shards.flatMap((shard) => snapshot.memberships[shard.folderId] ?? []))
    const observedMembers = new Set(snapshot.folders.filter((folder) => folder.kind === 'bilibili' && folder.remoteFolderId && remoteIds.has(folder.remoteFolderId))
      .flatMap((folder) => snapshot.memberships[folder.id] ?? []))
    const remoteOnly = [...observedMembers].filter((aid) => !members.has(aid)).length
    const extraRemote = [...remoteMembers].filter((aid) => !members.has(aid)).length
    const operation: PendingDeletion = {
      operationId: randomUUID(), accountMid: normalizedAccount, logicalFolderId: folderId, localMemberCount: members.size,
      // Removing a managed logical placement makes every selected member unmatched unless another logical placement remains.
      unmatchedFallbackCount: [...members].filter((aid) => {
        const position = snapshot.positions[`${normalizedAccount}:${aid}`]
        return !(position?.localDesiredFolderIds ?? []).some((candidate) => candidate !== folderId && candidate.startsWith('bilimi-logical:'))
      }).length,
      ...(remoteIds.size === 1 ? { remoteBinding: { remoteFolderId: [...remoteIds][0], shardCount: shards.length } } : {}),
      remoteOnlyMemberCount: remoteOnly, extraRemoteMemberCount: extraRemote, currentRevision: snapshot.revision, executionToken: randomUUID(), status: 'previewed'
    }
    this.operations.set(operation.operationId, operation)
    return { ...operation }
  }

  async deleteLocal(accountMid: string, executionToken: string) {
    const operation = this.operationFor(accountMid, executionToken)
    const snapshot = await this.options.repository.getSnapshot(operation.accountMid)
    if (snapshot.revision !== operation.currentRevision) throw new Error('Managed folder baseline is stale.')
    const auditAids = [...new Set(snapshot.memberships[operation.logicalFolderId] ?? [])]
    const timestamp = this.now()
    await this.options.repository.commit(operation.accountMid, {
      id: `managed-folder:delete-local:${operation.operationId}`, accountMid: operation.accountMid, issuedAt: timestamp, expectedRevision: snapshot.revision,
      type: 'delete-local-managed-folder', payload: { logicalFolderId: operation.logicalFolderId }
    })
    const auditStatus = await this.audit(operation, 'managed-folder-delete-local', undefined, auditAids)
    operation.status = 'succeeded'
    return { status: 'succeeded' as const, operationId: operation.operationId, auditStatus }
  }

  confirm(executionToken: string) {
    const operation = [...this.operations.values()].find((item) => item.executionToken === executionToken && item.status === 'previewed')
    if (!operation) throw new Error('Managed folder deletion preview is unavailable.')
    if (!operation.remoteBinding) throw new Error('Managed folder has no unambiguous remote binding.')
    operation.confirmationToken = randomUUID()
    return operation.confirmationToken
  }

  async executeRemote(accountMid: string, executionToken: string, confirmationToken: string) {
    const operation = this.operationFor(accountMid, executionToken)
    if (operation.status !== 'previewed' || operation.confirmationToken !== confirmationToken || !operation.remoteBinding) {
      throw new Error('Managed folder deletion confirmation is invalid.')
    }
    operation.confirmationToken = undefined
    const snapshot = await this.options.repository.getSnapshot(operation.accountMid)
    if (snapshot.revision !== operation.currentRevision) throw new Error('Managed folder baseline is stale.')
    if (!this.options.remote) throw new Error('Managed folder remote deletion is unavailable.')
    try {
      await this.options.remote.removeRemoteFolder(operation.accountMid, operation.remoteBinding.remoteFolderId)
    } catch (error) {
      operation.status = 'result-unknown'
      const auditStatus = await this.audit(operation, 'managed-folder-delete-remote-result-unknown', error instanceof Error ? error.message : String(error))
      return { status: 'result-unknown' as const, operationId: operation.operationId, auditStatus }
    }
    operation.status = 'succeeded'
    const auditStatus = await this.audit(operation, 'managed-folder-delete-remote')
    return { status: 'succeeded' as const, operationId: operation.operationId, auditStatus }
  }

  async reconcile(accountMid: string, operationId: string) {
    const operation = this.operations.get(operationId)
    if (!operation || operation.accountMid !== account(accountMid)) throw new Error('Managed folder deletion operation was not found.')
    return operation.status === 'result-unknown'
      ? { status: 'reconciliation-required' as const, operationId }
      : { status: 'completed' as const, operationId }
  }

  private operationFor(accountMid: string, executionToken: string) {
    const operation = [...this.operations.values()].find((item) => item.executionToken === executionToken && item.accountMid === account(accountMid))
    if (!operation) throw new Error('Managed folder deletion preview is unavailable.')
    return operation
  }

  private async audit(operation: PendingDeletion, detail: string, reason?: string, requestedAids?: number[]): Promise<'recorded' | 'failed'> {
    try {
      const occurredAt = this.now()
      const event: Omit<FavoriteRepositoryEvent, 'accountMid'> = {
        id: `managed-folder-audit:${randomUUID()}`, sequence: Date.parse(occurredAt), aid: 0, kind: 'manual-move', occurredAt,
        detail: reason ? `${detail}: ${reason}` : detail
      }
      // Folder-level audit uses a synthetic aid only internally; repository validation requires a real aid, so emit one immutable event per member.
      const members = requestedAids ?? (await this.options.repository.getSnapshot(operation.accountMid)).memberships[operation.logicalFolderId] ?? []
      for (const aid of members) {
        const command: FavoriteRepositoryCommand = { id: `${event.id}:${aid}`, accountMid: operation.accountMid, issuedAt: occurredAt, type: 'record-favorite-event', payload: { ...event, id: `${event.id}:${aid}`, aid } }
        await this.options.repository.commit(operation.accountMid, command)
      }
      return 'recorded'
    } catch { return 'failed' }
  }

  private now() { return this.options.now?.() ?? new Date().toISOString() }
}
