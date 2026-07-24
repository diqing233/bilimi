import { randomUUID } from 'node:crypto'
import type { FavoriteRepositoryCommand, FavoriteRepositoryCommandResult, FavoriteRepositoryEvent, FavoriteRepositoryPositionRecord } from '../../src/shared/favoriteRepository'
import type { FavoriteRepositoryService } from './favoriteRepositoryService'
import type { FavoriteLibraryCommandResult, FavoriteLibraryRemoteUnfavorite } from './favoriteLibraryCommands'

type Repository = Pick<FavoriteRepositoryService, 'getSnapshot' | 'commit'>

export type FavoriteRepositoryLocalOperationResult = FavoriteRepositoryCommandResult & {
  /** The state change was committed even if immutable audit persistence needs repair. */
  auditStatus: 'recorded' | 'failed'
}

export type FavoriteRemoteUnfavoriteExecutionResult = FavoriteLibraryCommandResult & {
  /** The remote outcome remains authoritative when its local audit write fails. */
  auditStatus: 'recorded' | 'failed'
}

export type FavoriteRemoteUnfavoritePreview = {
  operationId: string
  accountMid: string
  aids: number[]
  removesAllBilibiliMembership: true
  baselineRevision: number
  executionToken: string
}

type PendingRemoteUnfavorite = FavoriteRemoteUnfavoritePreview & { confirmationToken?: string; status: 'previewed' | 'result-unknown' | 'failed' | 'succeeded' }

function account(value: string) {
  if (!/^\d+$/.test(value.trim()) || BigInt(value.trim()) === 0n) throw new Error('Favorite operation account is invalid.')
  return BigInt(value.trim()).toString()
}

function aids(value: number[]) {
  if (!Array.isArray(value) || value.some((aid) => !Number.isSafeInteger(aid) || aid <= 0)) throw new Error('Favorite operation aids are invalid.')
  const result = [...new Set(value)].sort((left, right) => left - right)
  if (!result.length || result.length > 100) throw new Error('Favorite operation aids are invalid.')
  return result
}

function targetFolderIds(value: string[]) {
  if (!Array.isArray(value)) throw new Error('Favorite operation targets are invalid.')
  const result = [...new Set(value.map((folderId) => folderId.trim()).filter((folderId) => /^bilimi-logical:\S+$/.test(folderId)))].sort()
  if (!result.length || result.length !== new Set(value.map((folderId) => folderId.trim()).filter(Boolean)).size) throw new Error('Favorite operation targets are invalid.')
  return result
}

/** Local batch intent and one-shot Bilibili unfavorite orchestration. It never retries an ambiguous remote write. */
export class FavoriteRepositoryBatchOperationService {
  private readonly remoteOperations = new Map<string, PendingRemoteUnfavorite>()

  constructor(private readonly options: {
    repository: Repository
    remoteUnfavorite?: FavoriteLibraryRemoteUnfavorite
    now?: () => string
  }) {}

  async copy(accountMid: string, requestedAids: number[], requestedTargets: string[], expectedRevision: number) {
    return this.changePlacements(accountMid, requestedAids, requestedTargets, expectedRevision, 'copy')
  }

  async move(accountMid: string, requestedAids: number[], sourceFolderId: string, requestedTargets: string[], expectedRevision: number) {
    if (!/^bilimi-logical:\S+$/.test(sourceFolderId.trim())) throw new Error('Favorite move source must be a Bilimi work folder.')
    return this.changePlacements(accountMid, requestedAids, requestedTargets, expectedRevision, 'move', sourceFolderId.trim())
  }

  async deleteLocal(accountMid: string, requestedAids: number[], expectedRevision: number): Promise<FavoriteRepositoryLocalOperationResult> {
    const normalizedAccount = account(accountMid)
    const selected = aids(requestedAids)
    const snapshot = await this.options.repository.getSnapshot(normalizedAccount)
    if (snapshot.revision !== expectedRevision) throw new Error('Favorite operation baseline is stale.')
    const deletedAt = this.now()
    const result = await this.options.repository.commit(normalizedAccount, {
      id: `favorite-batch:delete-local:${randomUUID()}`, accountMid: normalizedAccount, issuedAt: deletedAt, expectedRevision,
      type: 'delete-favorites-from-library', payload: { aids: selected, deletedAt, reason: 'user-delete' }
    })
    const auditStatus = await this.audit(normalizedAccount, selected, 'batch-local-delete')
    return { ...result, auditStatus }
  }

  async previewRemoteUnfavorite(accountMid: string, requestedAids: number[], expectedRevision: number): Promise<FavoriteRemoteUnfavoritePreview> {
    const normalizedAccount = account(accountMid)
    const selected = aids(requestedAids)
    const snapshot = await this.options.repository.getSnapshot(normalizedAccount)
    if (snapshot.revision !== expectedRevision) throw new Error('Favorite operation baseline is stale.')
    const operation: PendingRemoteUnfavorite = {
      operationId: randomUUID(), accountMid: normalizedAccount, aids: selected, removesAllBilibiliMembership: true,
      baselineRevision: snapshot.revision, executionToken: randomUUID(), status: 'previewed'
    }
    this.remoteOperations.set(operation.operationId, operation)
    return { ...operation }
  }

  confirmRemoteUnfavorite(executionToken: string) {
    const operation = [...this.remoteOperations.values()].find((item) => item.executionToken === executionToken && item.status === 'previewed')
    if (!operation) throw new Error('Favorite remote unfavorite preview is unavailable.')
    operation.confirmationToken = randomUUID()
    return operation.confirmationToken
  }

  async executeRemoteUnfavorite(accountMid: string, executionToken: string, confirmationToken: string): Promise<FavoriteRemoteUnfavoriteExecutionResult> {
    const operation = [...this.remoteOperations.values()].find((item) => item.executionToken === executionToken)
    if (!operation || operation.accountMid !== account(accountMid) || operation.status !== 'previewed' || operation.confirmationToken !== confirmationToken) {
      throw new Error('Favorite remote unfavorite confirmation is invalid.')
    }
    operation.confirmationToken = undefined
    const current = await this.options.repository.getSnapshot(operation.accountMid)
    if (current.revision !== operation.baselineRevision) throw new Error('Favorite remote unfavorite baseline is stale.')
    if (!this.options.remoteUnfavorite) throw new Error('Favorite remote unfavorite is unavailable.')
    const result = await this.options.remoteUnfavorite.unfavorite(operation.accountMid, operation.aids)
    const remoteStatus = result.status === 'failed' ? 'failed' : result.status === 'result-unknown' ? 'result-unknown' : 'succeeded'
    operation.status = remoteStatus
    await this.options.repository.commit(operation.accountMid, {
      id: `favorite-remote-unfavorite:${operation.operationId}`,
      accountMid: operation.accountMid,
      issuedAt: this.now(),
      type: 'record-sync-result',
      payload: {
        id: `favorite-remote-unfavorite:${operation.operationId}`,
        commandId: operation.operationId,
        status: remoteStatus,
        affectedAids: operation.aids,
        updatedAt: this.now(),
        reason: result.reason,
        operationKey: 'favorite-library-unfavorite'
      }
    })
    const auditStatus = await this.audit(
      operation.accountMid,
      operation.aids,
      result.status === 'result-unknown' ? 'remote-unfavorite-result-unknown' : 'remote-unfavorite',
      result.reason
    )
    return { ...result, auditStatus }
  }

  async reconcileRemoteUnfavorite(accountMid: string, operationId: string) {
    const operation = this.remoteOperations.get(operationId)
    if (!operation || operation.accountMid !== account(accountMid)) throw new Error('Favorite remote unfavorite operation was not found.')
    return operation.status === 'result-unknown'
      ? { status: 'reconciliation-required' as const, operationId, aids: [...operation.aids] }
      : operation.status === 'failed'
        ? { status: 'failed' as const, operationId, aids: [...operation.aids] }
        : { status: 'completed' as const, operationId, aids: [...operation.aids] }
  }

  private async changePlacements(
    accountMid: string, requestedAids: number[], requestedTargets: string[], expectedRevision: number, action: 'copy' | 'move', sourceFolderId?: string
  ): Promise<FavoriteRepositoryLocalOperationResult> {
    const normalizedAccount = account(accountMid)
    const selected = aids(requestedAids)
    const targets = targetFolderIds(requestedTargets)
    const snapshot = await this.options.repository.getSnapshot(normalizedAccount)
    if (snapshot.revision !== expectedRevision) throw new Error('Favorite operation baseline is stale.')
    if (targets.some((id) => !snapshot.folders.some((folder) => folder.id === id && folder.kind === 'bilimi-logical'))) throw new Error('Favorite operation target was not found.')
    if (sourceFolderId && !snapshot.folders.some((folder) => folder.id === sourceFolderId && folder.kind === 'bilimi-logical')) throw new Error('Favorite move source was not found.')
    const timestamp = this.now()
    const placements = selected.map((aid) => {
      const prior = snapshot.positions[`${normalizedAccount}:${aid}`]
      const existing = prior?.localDesiredFolderIds ?? []
      const retained = action === 'move' ? existing.filter((folderId) => folderId !== sourceFolderId) : existing
      return this.placement(aid, [...retained, ...targets], prior, timestamp)
    })
    const result = await this.options.repository.commit(normalizedAccount, {
      id: `favorite-batch:${action}:${randomUUID()}`, accountMid: normalizedAccount, issuedAt: timestamp, expectedRevision,
      type: 'set-favorite-placements', payload: { placements }
    })
    const auditStatus = await this.audit(normalizedAccount, selected, action === 'copy' ? 'batch-copy' : 'batch-move')
    return { ...result, auditStatus }
  }

  private placement(aid: number, localDesiredFolderIds: string[], prior: FavoriteRepositoryPositionRecord | undefined, updatedAt: string) {
    return {
      aid, localDesiredFolderIds: [...new Set(localDesiredFolderIds)].sort(),
      remoteObservedPhysicalFolderIds: [...(prior?.remoteObservedPhysicalFolderIds ?? [])],
      remoteObservedLogicalFolderIds: [...(prior?.remoteObservedLogicalFolderIds ?? [])], positionState: 'local-only-change' as const, updatedAt
    }
  }

  private async audit(accountMid: string, selected: number[], detail: string, reason?: string): Promise<'recorded' | 'failed'> {
    try {
      const occurredAt = this.now()
      const events: Array<Omit<FavoriteRepositoryEvent, 'accountMid'>> = selected.map((aid) => ({
        id: `favorite-batch-audit:${randomUUID()}`, sequence: Date.parse(occurredAt), aid, kind: 'manual-move', occurredAt,
        detail: reason ? `${detail}: ${reason}` : detail
      }))
      await this.options.repository.commit(accountMid, {
        id: `favorite-batch-audit:${randomUUID()}`, accountMid, issuedAt: occurredAt, type: 'record-favorite-events', payload: { events }
      })
      return 'recorded'
    } catch { return 'failed' }
  }

  private now() { return this.options.now?.() ?? new Date().toISOString() }
}
