import { randomUUID } from 'node:crypto'
import type { FavoriteRepositoryCommand, FavoriteRepositoryEvent } from '../../src/shared/favoriteRepository'
import type { FavoriteRepositoryService } from './favoriteRepositoryService'
import { FavoriteRepositoryRemoteRejectedError } from './favoriteRepositorySyncService'
import { favoriteRepositoryRemoteOperationArbiter, type FavoriteRepositoryRemoteOperationArbiter } from './favoriteRepositoryRemoteOperationArbiter'

type Repository = Pick<FavoriteRepositoryService, 'getSnapshot' | 'commit' | 'commitWithAudit'>

export type ManagedFolderDeletionResult = {
  status: 'succeeded' | 'failed' | 'result-unknown'
  operationId: string
  auditStatus: 'recorded' | 'failed'
}

type RemoteFolderWriter = {
  removeRemoteFolder(accountMid: string, remoteFolderId: string): Promise<void>
}

type RemoteFolderObserver = {
  /** Reads remote existence only; reconciliation never issues another delete. */
  remoteFolderExists(accountMid: string, remoteFolderId: string): Promise<'present' | 'absent' | 'unknown'>
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

export type ManagedFolderGroupDeletionPreview = {
  accountMid: string
  folderCount: number
  affectedVideoCount: number
  remoteAllowed: boolean
  folders: Array<ManagedFolderDeletionPreview & { remoteAllowed: boolean }>
}

type PendingDeletion = ManagedFolderDeletionPreview & { confirmationToken?: string; status: 'previewed' | 'failed' | 'result-unknown' | 'reconciliation-required' | 'succeeded' }

class ManagedFolderRemotePreconditionError extends Error {}

function account(value: string) {
  if (!/^\d+$/.test(value.trim()) || BigInt(value.trim()) === 0n) throw new Error('Managed folder account is invalid.')
  return BigInt(value.trim()).toString()
}

/** Implements a deliberately one-shot managed-folder remote deletion flow. */
export class FavoriteRepositoryManagedFolderService {
  private readonly operations = new Map<string, PendingDeletion>()
  private readonly remoteDeletionOwners = new Map<string, string>()

  constructor(private readonly options: {
    repository: Repository
    remote?: RemoteFolderWriter
    remoteObserver?: RemoteFolderObserver
    remoteArbiter?: Pick<FavoriteRepositoryRemoteOperationArbiter, 'enqueue'>
    /** Records a local-only opt-out after a local deletion has committed. */
    dismissRemoteFolder?: (accountMid: string, remoteFolderId: string) => void
    now?: () => string
  }) {}

  async preview(accountMid: string, logicalFolderId: string): Promise<ManagedFolderDeletionPreview> {
    const normalizedAccount = account(accountMid)
    const snapshot = await this.options.repository.getSnapshot(normalizedAccount)
    return this.previewFromSnapshot(normalizedAccount, logicalFolderId, snapshot)
  }

  private previewFromSnapshot(normalizedAccount: string, logicalFolderId: string, snapshot: Awaited<ReturnType<Repository['getSnapshot']>>): ManagedFolderDeletionPreview {
    const folderId = logicalFolderId.trim()
    if (folderId === 'local:inbox') throw new Error('The unmatched safety folder cannot be deleted.')
    if (!/^bilimi-logical:\S+$/.test(folderId)) throw new Error('Managed folder is invalid.')
    const logical = snapshot.folders.find((folder) => folder.id === folderId && folder.kind === 'bilimi-logical')
    if (!logical?.logicalLedgerId) throw new Error('Managed folder was not found.')
    const members = new Set(snapshot.memberships[folderId] ?? [])
    const shards = snapshot.physicalShards.filter((shard) => shard.logicalLedgerId === logical.logicalLedgerId && shard.remoteFolderId)
    const remoteIds = new Set(shards.map((shard) => shard.remoteFolderId!))
    if ([...remoteIds].some((remoteFolderId) => snapshot.physicalShards.some((shard) =>
      shard.remoteFolderId === remoteFolderId && shard.logicalLedgerId !== logical.logicalLedgerId))) {
      throw new Error('Managed folder remote binding belongs to another logical ledger.')
    }
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

  /** Group deletion is local by default; remote deletion is available only for wholly unambiguous scans. */
  async previewAll(accountMid: string): Promise<ManagedFolderGroupDeletionPreview> {
    const normalizedAccount = account(accountMid)
    const snapshot = await this.options.repository.getSnapshot(normalizedAccount)
    const folderIds = snapshot.folders
      .filter((folder) => folder.kind === 'bilimi-logical' && folder.id !== 'local:inbox')
      .map((folder) => folder.id)
      .sort()
    const folders = folderIds.map((folderId) => {
      const preview = this.previewFromSnapshot(normalizedAccount, folderId, snapshot)
      const logicalLedgerId = this.logicalLedgerId(folderId)
      const shards = snapshot.physicalShards.filter((shard) => shard.logicalLedgerId === logicalLedgerId)
      const remoteAllowed = Boolean(preview.remoteBinding) && shards.length > 0 && shards.every((shard) => shard.bindingState === 'bound' && shard.remoteFolderId)
      return { ...preview, remoteAllowed }
    })
    const affectedVideoCount = new Set(folderIds.flatMap((folderId) => snapshot.memberships[folderId] ?? [])).size
    return { accountMid: normalizedAccount, folderCount: folders.length, affectedVideoCount, remoteAllowed: folders.length > 0 && folders.every((folder) => folder.remoteAllowed), folders }
  }

  async deleteLocal(accountMid: string, executionToken: string) {
    const operation = this.operationFor(accountMid, executionToken)
    const snapshot = await this.options.repository.getSnapshot(operation.accountMid)
    if (snapshot.revision !== operation.currentRevision) throw new Error('Managed folder baseline is stale.')
    const auditAids = [...new Set(snapshot.memberships[operation.logicalFolderId] ?? [])]
    const timestamp = this.now()
    await this.options.repository.commitWithAudit(operation.accountMid, {
      id: `managed-folder:delete-local:${operation.operationId}`, accountMid: operation.accountMid, issuedAt: timestamp, expectedRevision: snapshot.revision,
      type: 'delete-local-managed-folder', payload: { logicalFolderId: operation.logicalFolderId }
    }, this.events(auditAids, 'managed-folder-delete-local', timestamp))
    if (operation.remoteBinding) this.options.dismissRemoteFolder?.(operation.accountMid, operation.remoteBinding.remoteFolderId)
    operation.status = 'succeeded'
    return { status: 'succeeded' as const, operationId: operation.operationId, auditStatus: 'recorded' as const }
  }

  confirm(accountMid: string, executionToken: string) {
    const operation = [...this.operations.values()].find((item) => item.executionToken === executionToken && item.accountMid === account(accountMid) && item.status === 'previewed')
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
    if (!this.options.remote) throw new Error('Managed folder remote deletion is unavailable.')
    try {
      await (this.options.remoteArbiter ?? favoriteRepositoryRemoteOperationArbiter).enqueue(
        operation.accountMid, { priority: 'user-single' }, async () => {
          const snapshot = await this.options.repository.getSnapshot(operation.accountMid)
          if (snapshot.revision !== operation.currentRevision) throw new ManagedFolderRemotePreconditionError('Managed folder baseline is stale.')
          if (snapshot.physicalShards.some((shard) => shard.remoteFolderId === operation.remoteBinding!.remoteFolderId &&
            shard.logicalLedgerId !== this.logicalLedgerId(operation.logicalFolderId))) {
            throw new ManagedFolderRemotePreconditionError('Managed folder remote binding belongs to another logical ledger.')
          }
          if (snapshot.syncRecords.some((record) => record.operationKey === 'managed-folder-delete' &&
            record.id !== `managed-folder-delete:${operation.operationId}` &&
            ['result-unknown', 'reconciliation-required'].includes(record.status) &&
            record.targetFolderIds?.includes(operation.logicalFolderId))) {
            throw new Error('Managed folder remote deletion already requires reconciliation.')
          }
          const remoteKey = `${operation.accountMid}:${operation.remoteBinding!.remoteFolderId}`
          const priorOperation = this.remoteDeletionOwners.get(remoteKey)
          if (priorOperation && priorOperation !== operation.operationId) throw new Error('Managed folder remote deletion already requires reconciliation.')
          this.remoteDeletionOwners.set(remoteKey, operation.operationId)
          await this.options.remote!.removeRemoteFolder(operation.accountMid, operation.remoteBinding!.remoteFolderId)
          await this.commitLocalProjection(operation, snapshot)
        }
      )
    } catch (error) {
      if (error instanceof ManagedFolderRemotePreconditionError) throw error
      const reason = error instanceof Error ? error.message : String(error)
      const knownFailure = this.isKnownRemoteRejection(error)
      operation.status = knownFailure ? 'failed' : 'result-unknown'
      if (knownFailure && operation.remoteBinding) {
        this.remoteDeletionOwners.delete(`${operation.accountMid}:${operation.remoteBinding.remoteFolderId}`)
      }
      const checkpointRecorded = await this.tryRecordResult(operation, operation.status, reason)
      const auditRecorded = await this.audit(operation, knownFailure ? 'managed-folder-delete-remote-failed' : 'managed-folder-delete-remote-result-unknown', reason)
      return { status: operation.status, operationId: operation.operationId, auditStatus: checkpointRecorded && auditRecorded === 'recorded' ? 'recorded' as const : 'failed' as const }
    }
    try {
      operation.status = 'succeeded'
      return { status: 'succeeded' as const, operationId: operation.operationId, auditStatus: 'recorded' as const }
    } catch { throw new Error('Managed folder remote deletion did not settle.') }
  }

  async reconcile(accountMid: string, operationId: string) {
    const normalizedAccount = account(accountMid)
    const operation = this.operations.get(operationId) ?? await this.recoverOperation(normalizedAccount, operationId)
    if (!operation || operation.accountMid !== normalizedAccount) throw new Error('Managed folder deletion operation was not found.')
    if ((operation.status === 'result-unknown' || operation.status === 'reconciliation-required') && this.options.remoteObserver && operation.remoteBinding) {
      const observation = await (this.options.remoteArbiter ?? favoriteRepositoryRemoteOperationArbiter).enqueue(
        operation.accountMid, { priority: 'reconcile' }, () => this.options.remoteObserver!.remoteFolderExists(operation.accountMid, operation.remoteBinding!.remoteFolderId)
      )
      if (observation === 'present') {
        if (await this.tryRecordResult(operation, 'failed', 'Remote folder remains present.')) {
          operation.status = 'failed'
          if (operation.remoteBinding) this.remoteDeletionOwners.delete(`${operation.accountMid}:${operation.remoteBinding.remoteFolderId}`)
        }
      } else if (observation === 'absent') {
        try {
          await this.commitLocalProjection(operation, await this.options.repository.getSnapshot(operation.accountMid))
          if (await this.tryRecordResult(operation, 'succeeded')) operation.status = 'succeeded'
        } catch {
          // The remote fact is known, but the durable local projection remains unresolved.
        }
      }
    }
    return operation.status === 'result-unknown' || operation.status === 'reconciliation-required'
      ? { status: 'reconciliation-required' as const, operationId }
      : operation.status === 'failed'
        ? { status: 'failed' as const, operationId }
      : { status: 'completed' as const, operationId }
  }

  private operationFor(accountMid: string, executionToken: string) {
    const operation = [...this.operations.values()].find((item) => item.executionToken === executionToken && item.accountMid === account(accountMid))
    if (!operation) throw new Error('Managed folder deletion preview is unavailable.')
    return operation
  }

  private async recoverOperation(accountMid: string, operationId: string): Promise<PendingDeletion | undefined> {
    const snapshot = await this.options.repository.getSnapshot(accountMid)
    const record = snapshot.syncRecords.find((item) => item.id === `managed-folder-delete:${operationId}` && item.operationKey === 'managed-folder-delete')
    const logicalFolderId = record?.targetFolderIds?.find((id) => id.startsWith('bilimi-logical:'))
    if (!record || !logicalFolderId) return undefined
    const remoteIds = [...new Set(snapshot.physicalShards
      .filter((shard) => shard.logicalLedgerId === this.logicalLedgerId(logicalFolderId) && shard.remoteFolderId)
      .map((shard) => shard.remoteFolderId!))]
    const operation: PendingDeletion = {
      operationId, accountMid, logicalFolderId, localMemberCount: 0, unmatchedFallbackCount: 0,
      ...(remoteIds.length === 1 ? { remoteBinding: {
        remoteFolderId: remoteIds[0],
        shardCount: snapshot.physicalShards.filter((shard) => shard.logicalLedgerId === this.logicalLedgerId(logicalFolderId) && shard.remoteFolderId === remoteIds[0]).length
      } } : {}),
      remoteOnlyMemberCount: 0, extraRemoteMemberCount: 0,
      currentRevision: snapshot.revision, executionToken: '', status: record.status === 'pending' ? 'result-unknown' : record.status
    }
    this.operations.set(operationId, operation)
    return operation
  }

  private async commitLocalProjection(operation: PendingDeletion, snapshot: Awaited<ReturnType<Repository['getSnapshot']>>) {
    const timestamp = this.now()
    await this.options.repository.commitWithAudit(operation.accountMid, {
      id: `managed-folder:delete-local:${operation.operationId}`,
      accountMid: operation.accountMid,
      issuedAt: timestamp,
      expectedRevision: snapshot.revision,
      type: 'delete-local-managed-folder',
      payload: { logicalFolderId: operation.logicalFolderId }
    }, this.events([...new Set(snapshot.memberships[operation.logicalFolderId] ?? [])], 'managed-folder-delete-remote', timestamp))
  }

  private async recordResult(operation: PendingDeletion, status: 'failed' | 'result-unknown' | 'succeeded', reason?: string) {
    await this.options.repository.commit(operation.accountMid, {
      id: `managed-folder-delete:record:${operation.operationId}:${status}`,
      accountMid: operation.accountMid, issuedAt: this.now(), type: 'record-sync-result',
      payload: {
        id: `managed-folder-delete:${operation.operationId}`, commandId: operation.operationId, status,
        affectedAids: [], updatedAt: this.now(), reason, operationKey: 'managed-folder-delete',
        // Portable recovery records intentionally retain only the logical folder identity.
        targetFolderIds: [operation.logicalFolderId]
      }
    })
  }

  private async tryRecordResult(operation: PendingDeletion, status: 'failed' | 'result-unknown' | 'succeeded', reason?: string) {
    try {
      await this.recordResult(operation, status, reason)
      return true
    } catch {
      return false
    }
  }

  private isKnownRemoteRejection(error: unknown) {
    return error instanceof FavoriteRepositoryRemoteRejectedError ||
      (typeof error === 'object' && error !== null && ((error as { remoteWriteRejected?: unknown }).remoteWriteRejected === true || (error as { code?: unknown }).code === 'REMOTE_REJECTED'))
  }

  private logicalLedgerId(logicalFolderId: string) {
    return logicalFolderId.slice('bilimi-logical:'.length)
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

  private events(aids: number[], detail: string, occurredAt: string): Array<Omit<FavoriteRepositoryEvent, 'accountMid'>> {
    return [...new Set(aids)].map((aid) => ({ id: `managed-folder-audit:${randomUUID()}:${aid}`, sequence: Date.parse(occurredAt), aid, kind: 'manual-move' as const, occurredAt, detail }))
  }

  private now() { return this.options.now?.() ?? new Date().toISOString() }
}
