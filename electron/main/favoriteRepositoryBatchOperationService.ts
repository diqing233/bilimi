import { randomUUID } from 'node:crypto'
import type { FavoriteRepositoryCommand, FavoriteRepositoryCommandResult, FavoriteRepositoryEvent, FavoriteRepositoryPositionRecord } from '../../src/shared/favoriteRepository'
import type { FavoriteRepositoryService } from './favoriteRepositoryService'
import type { FavoriteLibraryCommandResult, FavoriteLibraryRemoteUnfavorite } from './favoriteLibraryCommands'
import { favoriteRepositoryRemoteOperationArbiter, type FavoriteRepositoryRemoteOperationArbiter } from './favoriteRepositoryRemoteOperationArbiter'

type Repository = Pick<FavoriteRepositoryService, 'getSnapshot' | 'commit' | 'commitWithAudit'>

export type FavoriteOperationSourceScope =
  | { kind: 'bilimi-logical'; folderId?: string }
  | { kind: 'bilibili-default' | 'bilibili-user'; folderId: string }
  | { kind: 'virtual'; eligibleAids: number[]; skippedAids: number[] }

type RemoteUnfavoriteObserver = {
  /** Observes the remote outcome; it must not issue a mutation. */
  areUnfavorited(accountMid: string, aids: number[]): Promise<'removed' | 'present' | 'unknown'>
}

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

type PendingRemoteUnfavorite = FavoriteRemoteUnfavoritePreview & { confirmationToken?: string; status: 'previewed' | 'result-unknown' | 'reconciliation-required' | 'failed' | 'succeeded' }

function account(value: string) {
  if (!/^\d+$/.test(value.trim()) || BigInt(value.trim()) === 0n) throw new Error('Favorite operation account is invalid.')
  return BigInt(value.trim()).toString()
}

function aids(value: number[]) {
  if (!Array.isArray(value) || value.some((aid) => !Number.isSafeInteger(aid) || aid <= 0)) throw new Error('Favorite operation aids are invalid.')
  const result = [...new Set(value)].sort((left, right) => left - right)
  if (!result.length) throw new Error('Favorite operation aids are invalid.')
  return result
}

const COMMAND_AID_LIMIT = 100

function chunks<T>(values: T[]) {
  return Array.from({ length: Math.ceil(values.length / COMMAND_AID_LIMIT) }, (_value, index) =>
    values.slice(index * COMMAND_AID_LIMIT, (index + 1) * COMMAND_AID_LIMIT))
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
  private readonly remoteExecutionTails = new Map<string, Promise<void>>()

  constructor(private readonly options: {
    repository: Repository
    remoteUnfavorite?: FavoriteLibraryRemoteUnfavorite
    remoteObserver?: RemoteUnfavoriteObserver
    remoteArbiter?: Pick<FavoriteRepositoryRemoteOperationArbiter, 'enqueue'>
    now?: () => string
  }) {}

  async copy(accountMid: string, requestedAids: number[], requestedTargets: string[], expectedRevision: number, source?: FavoriteOperationSourceScope) {
    this.requireScope(source, requestedAids, 'copy')
    return this.changePlacements(accountMid, requestedAids, requestedTargets, expectedRevision, 'copy')
  }

  async move(accountMid: string, requestedAids: number[], sourceFolderId: string, requestedTargets: string[], expectedRevision: number, source?: FavoriteOperationSourceScope) {
    this.requireScope(source, requestedAids, 'move')
    const normalizedSource = sourceFolderId.trim()
    if (normalizedSource !== 'local:inbox' && !/^bilimi-logical:\S+$/.test(normalizedSource)) throw new Error('Favorite move source must be a Bilimi work folder or unmatched.')
    return this.changePlacements(accountMid, requestedAids, requestedTargets, expectedRevision, 'move', normalizedSource === 'local:inbox' ? undefined : normalizedSource)
  }

  async deleteLocal(accountMid: string, requestedAids: number[], expectedRevision: number, source?: FavoriteOperationSourceScope): Promise<FavoriteRepositoryLocalOperationResult> {
    this.requireScope(source, requestedAids, 'delete')
    const normalizedAccount = account(accountMid)
    const selected = aids(requestedAids)
    const snapshot = await this.options.repository.getSnapshot(normalizedAccount)
    if (snapshot.revision !== expectedRevision) throw new Error('Favorite operation baseline is stale.')
    const deletedAt = this.now()
    let revision = expectedRevision
    let result: FavoriteRepositoryCommandResult | undefined
    for (const selectedChunk of chunks(selected)) {
      result = await this.options.repository.commitWithAudit(normalizedAccount, {
        id: `favorite-batch:delete-local:${randomUUID()}`, accountMid: normalizedAccount, issuedAt: deletedAt, expectedRevision: revision,
        type: 'delete-favorites-from-library', payload: { aids: selectedChunk, deletedAt, reason: 'user-delete' }
      }, this.events(selectedChunk, 'batch-local-delete', deletedAt))
      revision = result.revision
    }
    if (!result) throw new Error('Favorite operation aids are invalid.')
    return { ...result, auditStatus: 'recorded' }
  }

  async previewRemoteUnfavorite(accountMid: string, requestedAids: number[], expectedRevision: number, source?: FavoriteOperationSourceScope): Promise<FavoriteRemoteUnfavoritePreview> {
    this.requireScope(source, requestedAids, 'unfavorite')
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

  confirmRemoteUnfavorite(accountMid: string, executionToken: string) {
    const operation = [...this.remoteOperations.values()].find((item) => item.executionToken === executionToken && item.accountMid === account(accountMid) && item.status === 'previewed')
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
    if (!this.options.remoteUnfavorite) throw new Error('Favorite remote unfavorite is unavailable.')
    return this.serializeRemoteExecution(operation.accountMid, async () => {
      // Preserve the immediate stale-preview rejection for legacy adapters;
      // production adapters repeat this guard in their actual arbiter slot.
      const current = await this.options.repository.getSnapshot(operation.accountMid)
      if (current.revision !== operation.baselineRevision) throw this.staleRemoteUnfavoriteBaselineError()
      const result = await (async () => {
        let completedOperationCount = 0
        let status: FavoriteLibraryCommandResult['status'] = 'succeeded'
        let reason: string | undefined
        for (const aidChunk of chunks(operation.aids)) {
          try {
            const chunkResult = await this.options.remoteUnfavorite!.unfavorite(operation.accountMid, aidChunk, {
              beforeRemoteWrite: async () => {
                const current = await this.options.repository.getSnapshot(operation.accountMid)
                if (current.revision !== operation.baselineRevision) throw this.staleRemoteUnfavoriteBaselineError()
              }
            })
            completedOperationCount += chunkResult.completedOperationCount
            if (chunkResult.status !== 'succeeded') {
              status = chunkResult.status
              reason = chunkResult.reason
              break
            }
          } catch (error) {
            if (this.isStaleRemoteUnfavoriteBaselineError(error)) throw error
            status = this.isKnownRemoteRejection(error) ? 'failed' : 'result-unknown'
            reason = error instanceof Error ? error.message : String(error)
            break
          }
        }
        return { status, completedOperationCount, totalOperationCount: operation.aids.length, affectedAids: [...operation.aids], ...(reason ? { reason } : {}) }
      })()
      const remoteStatus = result.status === 'failed' ? 'failed' : result.status === 'result-unknown' ? 'result-unknown' : 'succeeded'
      operation.status = remoteStatus
      const timestamp = this.now()
      const detail = result.status === 'result-unknown' ? 'remote-unfavorite-result-unknown' : 'remote-unfavorite'
      try {
        await this.options.repository.commitWithAudit(operation.accountMid, {
        id: `favorite-remote-unfavorite:${operation.operationId}`,
        accountMid: operation.accountMid,
        issuedAt: timestamp,
        type: 'record-sync-result',
        payload: {
          id: `favorite-remote-unfavorite:${operation.operationId}`,
          commandId: operation.operationId,
          status: remoteStatus,
          affectedAids: operation.aids,
          updatedAt: timestamp,
          reason: result.reason,
          operationKey: 'favorite-library-unfavorite'
        }
        }, this.events(operation.aids, detail, timestamp, result.reason))
        return { ...result, auditStatus: 'recorded' as const }
      } catch {
        try {
          await this.recordRemoteResult(operation, remoteStatus, result.reason, 'audit-fallback')
        } catch {
          // The result remains visible to this process, but no restart recovery
          // is possible until persistence becomes available again.
        }
        return { ...result, auditStatus: 'failed' as const }
      }
    })
  }

  async reconcileRemoteUnfavorite(accountMid: string, operationId: string) {
    const normalizedAccount = account(accountMid)
    const operation = this.remoteOperations.get(operationId) ?? await this.recoverRemoteOperation(normalizedAccount, operationId)
    if (!operation || operation.accountMid !== normalizedAccount) throw new Error('Favorite remote unfavorite operation was not found.')
    if ((operation.status === 'result-unknown' || operation.status === 'reconciliation-required') && this.options.remoteObserver) {
      const observation = await (this.options.remoteArbiter ?? favoriteRepositoryRemoteOperationArbiter).enqueue(
        normalizedAccount, { priority: 'reconcile' }, () => this.options.remoteObserver!.areUnfavorited(normalizedAccount, operation.aids)
      )
      if (observation !== 'unknown') {
        const reconciledStatus = observation === 'removed' ? 'succeeded' : 'failed'
        try {
          await this.recordRemoteResult(operation, reconciledStatus, observation === 'removed' ? undefined : 'Remote still reports the videos as favorited.', 'reconcile')
          operation.status = reconciledStatus
        } catch {
          return { status: 'reconciliation-required' as const, operationId, aids: [...operation.aids] }
        }
      }
    }
    return operation.status === 'result-unknown' || operation.status === 'reconciliation-required'
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
    let revision = expectedRevision
    let result: FavoriteRepositoryCommandResult | undefined
    for (const placementChunk of chunks(placements)) {
      const chunkAids = placementChunk.map((placement) => placement.aid)
      result = await this.options.repository.commitWithAudit(normalizedAccount, {
        id: `favorite-batch:${action}:${randomUUID()}`, accountMid: normalizedAccount, issuedAt: timestamp, expectedRevision: revision,
        type: 'set-favorite-placements', payload: { placements: placementChunk }
      }, this.events(chunkAids, action === 'copy' ? 'batch-copy' : 'batch-move', timestamp))
      revision = result.revision
    }
    if (!result) throw new Error('Favorite operation aids are invalid.')
    return { ...result, auditStatus: 'recorded' }
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

  private events(selected: number[], detail: string, occurredAt: string, reason?: string): Array<Omit<FavoriteRepositoryEvent, 'accountMid'>> {
    return selected.map((aid) => ({ id: `favorite-batch-audit:${randomUUID()}`, sequence: Date.parse(occurredAt), aid, kind: 'manual-move' as const, occurredAt, detail: reason ? `${detail}: ${reason}` : detail }))
  }

  private requireScope(source: FavoriteOperationSourceScope | undefined, requestedAids: number[], action: 'copy' | 'move' | 'delete' | 'unfavorite') {
    if (!source || source.kind === 'bilimi-logical') return
    if (source.kind === 'bilibili-default' || source.kind === 'bilibili-user') {
      if (action !== 'copy') throw new Error('This action is not permitted from a Bilibili source folder.')
      return
    }
    const selected = aids(requestedAids)
    if (source.kind !== 'virtual' || !Array.isArray(source.skippedAids)) throw new Error('Virtual source actions require explicit eligibility and skipped-item evidence.')
    const eligibleAids = aids(source.eligibleAids)
    const skippedAids = source.skippedAids.length ? aids(source.skippedAids) : []
    if (skippedAids.some((aid) => eligibleAids.includes(aid))) throw new Error('Virtual source eligibility and skipped-item evidence overlap.')
    const eligible = new Set(eligibleAids)
    if (selected.some((aid) => !eligible.has(aid))) throw new Error('Virtual source actions require explicit eligibility and skipped-item evidence.')
  }

  private async recoverRemoteOperation(accountMid: string, operationId: string): Promise<PendingRemoteUnfavorite | undefined> {
    const snapshot = await this.options.repository.getSnapshot(accountMid)
    const record = snapshot.syncRecords.find((item) => item.id === `favorite-remote-unfavorite:${operationId}` && item.operationKey === 'favorite-library-unfavorite')
    if (!record) return undefined
    const operation: PendingRemoteUnfavorite = {
      operationId, accountMid, aids: [...record.affectedAids], removesAllBilibiliMembership: true,
      baselineRevision: snapshot.revision, executionToken: '', status: record.status === 'pending' ? 'result-unknown' : record.status
    }
    this.remoteOperations.set(operationId, operation)
    return operation
  }

  private async recordRemoteResult(operation: PendingRemoteUnfavorite, status: 'succeeded' | 'failed' | 'result-unknown', reason?: string, suffix = 'result') {
    await this.options.repository.commit(operation.accountMid, {
      id: `favorite-remote-unfavorite:${suffix}:${operation.operationId}`,
      accountMid: operation.accountMid, issuedAt: this.now(), type: 'record-sync-result',
      payload: { id: `favorite-remote-unfavorite:${operation.operationId}`, commandId: operation.operationId, status, affectedAids: operation.aids, updatedAt: this.now(), reason, operationKey: 'favorite-library-unfavorite' }
    })
  }

  private async serializeRemoteExecution<T>(accountMid: string, action: () => Promise<T>) {
    const previous = this.remoteExecutionTails.get(accountMid) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const tail = previous.then(() => gate)
    this.remoteExecutionTails.set(accountMid, tail)
    await previous
    try {
      return await action()
    } finally {
      release()
      if (this.remoteExecutionTails.get(accountMid) === tail) this.remoteExecutionTails.delete(accountMid)
    }
  }

  private isKnownRemoteRejection(error: unknown) {
    return typeof error === 'object' && error !== null &&
      ((error as { remoteWriteRejected?: unknown }).remoteWriteRejected === true || (error as { code?: unknown }).code === 'REMOTE_REJECTED')
  }

  private staleRemoteUnfavoriteBaselineError() {
    return Object.assign(new Error('Favorite remote unfavorite baseline is stale.'), { code: 'FAVORITE_REMOTE_UNFAVORITE_BASELINE_STALE' })
  }

  private isStaleRemoteUnfavoriteBaselineError(error: unknown) {
    return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'FAVORITE_REMOTE_UNFAVORITE_BASELINE_STALE'
  }

  private now() { return this.options.now?.() ?? new Date().toISOString() }
}
