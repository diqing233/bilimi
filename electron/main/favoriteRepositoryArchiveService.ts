import { createHash, randomUUID } from 'node:crypto'
import {
  createFavoriteRepositoryArchiveExport,
  validateFavoriteRepositoryArchiveExport,
  type AccountFavoriteRepositorySnapshot,
  type FavoriteRepositoryArchiveExport,
  type FavoriteRepositoryEvent,
  type FavoriteRepositorySyncRecord
} from '../../src/shared/favoriteRepository'
import type { FavoriteRepositoryRemoteOperationArbiter } from './favoriteRepositoryRemoteOperationArbiter'

const REMOTE_FAVORITE_SHARD_CAPACITY = 1_000

type EventPage = {
  items: FavoriteRepositoryEvent[]
  nextCursor?: string
}

export type FavoriteRepositoryArchiveRepository = {
  getSnapshot(accountMid: string): Promise<AccountFavoriteRepositorySnapshot>
  getEventPage(accountMid: string, aid: number, options: { limit: number; cursor?: string }): Promise<EventPage>
  recordSyncCheckpoint(accountMid: string, commandId: string, record: FavoriteRepositorySyncRecord): Promise<void>
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
    /** Archived logical intent is kept so the baseline can be safely rechecked before a write. */
    desiredLogicalFolderIds: string[]
    appendLogicalFolderIds: string[]
    removeLogicalFolderIds: string[]
  }>
}

export type FavoriteRepositoryRestoreBaseline = {
  managedLogicalFolderIds: string[]
  /** Bound physical folders only; the renderer can never supply these IDs. */
  managedPhysicalFolderIdsByLogicalFolderId: Record<string, string[]>
  /** Physical membership counts read with the same just-in-time remote facts. */
  managedPhysicalFolderMemberCounts?: Record<string, number>
  /** Actual observed members among managed physical folders. */
  managedObservedPhysicalFolderIds: string[]
  /** Defensive exclusion: ordinary Bilibili sources must never be removed. */
  ordinaryRemoteFolderIds?: string[]
}

export type FavoriteRepositoryRestoreWriter = {
  begin?(input: { accountMid: string; restoreId: string }): Promise<void>
  finish?(input: { accountMid: string; restoreId: string }): Promise<void>
  /** Must read Bilibili immediately before the corresponding remote write. */
  readBaseline(input: { accountMid: string; restoreId: string; aid: number }): Promise<Record<number, FavoriteRepositoryRestoreBaseline>>
  /** Creates and binds the next managed shard only after an all-full recheck. */
  ensurePhysicalCapacity?(input: { accountMid: string; restoreId: string; aid: number; logicalFolderIds: string[] }): Promise<void>
  write(input: {
    accountMid: string
    restoreId: string
    aid: number
    appendPhysicalFolderIds: string[]
    removePhysicalFolderIds: string[]
  }): Promise<void>
}

export type FavoriteRepositoryRestoreExecutionResult = {
  id: string
  accountMid: string
  status: 'succeeded' | 'failed' | 'result-unknown'
  completedOperationCount: number
  totalOperationCount: number
  items: Array<{ aid: number; status: 'succeeded' | 'failed' | 'result-unknown'; reason?: string }>
}

function normalizedAccountMid(value: string) {
  const raw = value.trim()
  if (!/^\d+$/.test(raw) || BigInt(raw) === 0n) throw new Error('Favorite repository account is invalid.')
  return BigInt(raw).toString()
}

function uniqueFolderIds(value: readonly string[]) {
  return [...new Set(value.map((folderId) => folderId.trim()).filter(Boolean))].sort()
}

function stableRestoreId(plan: FavoriteRepositoryRestorePlan) {
  const operations = plan.operations.map((operation) => ({
    aid: operation.aid,
    desiredLogicalFolderIds: uniqueFolderIds(operation.desiredLogicalFolderIds),
    appendLogicalFolderIds: uniqueFolderIds(operation.appendLogicalFolderIds),
    removeLogicalFolderIds: uniqueFolderIds(operation.removeLogicalFolderIds)
  })).sort((left, right) => left.aid - right.aid || JSON.stringify(left).localeCompare(JSON.stringify(right)))
  const source = JSON.stringify({ accountMid: normalizedAccountMid(plan.accountMid), mode: plan.mode, operations })
  // Old 32-bit IDs cannot prove that a persisted checkpoint belongs to this
  // plan, so deliberately use a new namespace instead of reusing them.
  return `archive-restore:v2:${createHash('sha256').update(source).digest('hex')}`
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
    remoteOperations?: FavoriteRepositoryRemoteOperationArbiter
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
      // Keep every non-inbox archived intent in the approved plan. The initial
      // diff is useful for preview, while execution must recheck even an
      // apparently aligned item so a remote change between preview and confirm
      // cannot make safe recovery silently skip a missing membership.
      return [{ aid, desiredLogicalFolderIds: desired, appendLogicalFolderIds, removeLogicalFolderIds }]
    })
    return { mode, accountMid: archive.accountMid, operations: operations.sort((left, right) => left.aid - right.aid) }
  }

  /**
   * Builds a recovery preview from the privileged, currently-bound Bilibili
   * shards.  This deliberately accepts no renderer-supplied remote folder
   * identifiers: physical membership is observed by the main-process writer.
   */
  async createRestorePlanFromManagedScan(
    input: string | FavoriteRepositoryArchiveExport,
    mode: 'safe' | 'full',
    writer: FavoriteRepositoryRestoreWriter,
    requestedAids?: readonly number[]
  ): Promise<FavoriteRepositoryRestorePlan> {
    const archive = decodeArchive(input, this.maximumBytes)
    const accountMid = normalizedAccountMid(archive.accountMid)
    const requested = requestedAids === undefined ? undefined : new Set(requestedAids)
    const aids = [...new Set((archive.positions ?? [])
      .filter((position) => uniqueFolderIds(position.localDesiredFolderIds).length > 0)
      .filter((position) => requested === undefined || requested.has(position.aid))
      .map((position) => position.aid))]
      .filter((aid) => Number.isSafeInteger(aid) && aid > 0)
      .sort((left, right) => left - right)
    const restoreId = `archive-restore-preview:${randomUUID()}`
    const observed: FavoriteRepositoryRestoreObservation = {}
    await writer.begin?.({ accountMid, restoreId })
    try {
      for (const aid of aids) {
        const baseline = (await writer.readBaseline({ accountMid, restoreId, aid }))[aid]
        if (!baseline) continue
        const observedPhysicalIds = new Set(uniqueFolderIds(baseline.managedObservedPhysicalFolderIds))
        const managedLogicalFolderIds = Object.entries(baseline.managedPhysicalFolderIdsByLogicalFolderId)
          .filter(([, physicalIds]) => uniqueFolderIds(physicalIds).some((physicalId) => observedPhysicalIds.has(physicalId)))
          .map(([logicalFolderId]) => logicalFolderId)
        observed[aid] = { managedLogicalFolderIds, ordinaryRemoteFolderIds: baseline.ordinaryRemoteFolderIds }
      }
    } finally {
      await writer.finish?.({ accountMid, restoreId })
    }
    const plan = this.createRestorePlan(archive, observed, mode)
    return requested === undefined ? plan : {
      ...plan,
      operations: plan.operations.filter((operation) => requested.has(operation.aid))
    }
  }

  /**
   * Executes a user-confirmed archive plan. The writer owns page binding and
   * physical-folder validation; this service owns plan idempotency, baseline
   * rechecks, and the rule that an unknown remote request must be reconciled
   * before it can be retried.
   */
  async executeRestorePlan(plan: FavoriteRepositoryRestorePlan, writer: FavoriteRepositoryRestoreWriter): Promise<FavoriteRepositoryRestoreExecutionResult> {
    const restoreId = stableRestoreId(plan)
    const accountMid = normalizedAccountMid(plan.accountMid)
    await writer.begin?.({ accountMid, restoreId })
    try {
    const items: FavoriteRepositoryRestoreExecutionResult['items'] = []
    for (const operation of plan.operations) {
      const previous = this.restoreRecord(await this.options.repository.getSnapshot(accountMid), restoreId, operation.aid)
      if (previous?.status === 'succeeded') {
        items.push({ aid: operation.aid, status: 'succeeded' })
        continue
      }
      if (previous?.status === 'result-unknown' || previous?.status === 'pending') {
        if (previous.status === 'pending') await this.writeRestoreCheckpoint(accountMid, restoreId, operation.aid, previous.attempt ?? 0, 'result-unknown', previous.targetFolderIds ?? [], 'remote request was interrupted before a receipt')
        items.push({ aid: operation.aid, status: 'result-unknown', reason: previous.reason })
        break
      }

      const baseline = await writer.readBaseline({ accountMid, restoreId, aid: operation.aid })
      let resolved = this.resolvePhysicalOperation(operation, plan.mode, baseline[operation.aid])
      if ('capacityRequiredLogicalFolderIds' in resolved) {
        if (!writer.ensurePhysicalCapacity) {
          await this.writeRestoreCheckpoint(accountMid, restoreId, operation.aid, (previous?.attempt ?? 0) + 1, 'failed', [], 'managed archive target capacity is exhausted')
          items.push({ aid: operation.aid, status: 'failed', reason: 'managed archive target capacity is exhausted' })
          continue
        }
        try {
          await writer.ensurePhysicalCapacity({ accountMid, restoreId, aid: operation.aid, logicalFolderIds: resolved.capacityRequiredLogicalFolderIds })
          const refreshed = await writer.readBaseline({ accountMid, restoreId, aid: operation.aid })
          resolved = this.resolvePhysicalOperation(operation, plan.mode, refreshed[operation.aid])
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          await this.writeRestoreCheckpoint(accountMid, restoreId, operation.aid, (previous?.attempt ?? 0) + 1, 'result-unknown', [], reason)
          items.push({ aid: operation.aid, status: 'result-unknown', reason })
          break
        }
      }
      if ('reason' in resolved) {
        await this.writeRestoreCheckpoint(accountMid, restoreId, operation.aid, (previous?.attempt ?? 0) + 1, 'failed', [], resolved.reason)
        items.push({ aid: operation.aid, status: 'failed', reason: resolved.reason })
        continue
      }

      const attempt = (previous?.attempt ?? 0) + 1
      await this.writeRestoreCheckpoint(accountMid, restoreId, operation.aid, attempt, 'pending', [...resolved.appendPhysicalFolderIds, ...resolved.removePhysicalFolderIds], 'remote-request-started')
      try {
        const run = () => writer.write({ accountMid, restoreId, aid: operation.aid, ...resolved })
        if (resolved.appendPhysicalFolderIds.length || resolved.removePhysicalFolderIds.length) {
          if (this.options.remoteOperations) {
            await this.options.remoteOperations.enqueue(accountMid, { priority: 'archive-restore', videoKey: `archive-restore:${operation.aid}` }, run)
          } else await run()
        }
        await this.writeRestoreCheckpoint(accountMid, restoreId, operation.aid, attempt, 'succeeded', [...resolved.appendPhysicalFolderIds, ...resolved.removePhysicalFolderIds])
        items.push({ aid: operation.aid, status: 'succeeded' })
      } catch (error) {
        const status = this.isConfirmedRemoteFailure(error) ? 'failed' : 'result-unknown'
        const reason = error instanceof Error ? error.message : String(error)
        await this.writeRestoreCheckpoint(accountMid, restoreId, operation.aid, attempt, status, [...resolved.appendPhysicalFolderIds, ...resolved.removePhysicalFolderIds], reason)
        items.push({ aid: operation.aid, status, reason })
        if (status === 'result-unknown') break
      }
    }
    return this.restoreResult(restoreId, accountMid, plan.operations.length, items)
    } finally {
      await writer.finish?.({ accountMid, restoreId })
    }
  }

  /** Reconciliation only observes current Bilibili membership; it never writes. */
  async reconcileRestorePlan(plan: FavoriteRepositoryRestorePlan, writer: FavoriteRepositoryRestoreWriter): Promise<FavoriteRepositoryRestoreExecutionResult> {
    const restoreId = stableRestoreId(plan)
    const accountMid = normalizedAccountMid(plan.accountMid)
    await writer.begin?.({ accountMid, restoreId })
    try {
    const items: FavoriteRepositoryRestoreExecutionResult['items'] = []
    for (const operation of plan.operations) {
      const previous = this.restoreRecord(await this.options.repository.getSnapshot(accountMid), restoreId, operation.aid)
      if (previous?.status === 'succeeded') {
        items.push({ aid: operation.aid, status: 'succeeded' })
        continue
      }
      const baseline = await writer.readBaseline({ accountMid, restoreId, aid: operation.aid })
      const resolved = this.resolvePhysicalOperation(operation, plan.mode, baseline[operation.aid])
      const capacityExhausted = 'capacityRequiredLogicalFolderIds' in resolved
      const status = 'reason' in resolved || capacityExhausted
        ? 'failed'
        : (!resolved.appendPhysicalFolderIds.length && !resolved.removePhysicalFolderIds.length ? 'succeeded' : 'failed')
      const reason = 'reason' in resolved
        ? resolved.reason
        : capacityExhausted
          ? 'managed archive target capacity is exhausted'
          : status === 'failed' ? 'remote baseline does not match the archive restore plan' : undefined
      const targetFolderIds = 'appendPhysicalFolderIds' in resolved
        ? [...resolved.appendPhysicalFolderIds, ...resolved.removePhysicalFolderIds]
        : []
      await this.writeRestoreCheckpoint(accountMid, restoreId, operation.aid, previous?.attempt ?? 0, status, targetFolderIds, reason)
      items.push({ aid: operation.aid, status, ...(reason ? { reason } : {}) })
    }
    return this.restoreResult(restoreId, accountMid, plan.operations.length, items)
    } finally {
      await writer.finish?.({ accountMid, restoreId })
    }
  }

  private resolvePhysicalOperation(
    operation: FavoriteRepositoryRestorePlan['operations'][number],
    mode: FavoriteRepositoryRestorePlan['mode'],
    baseline: FavoriteRepositoryRestoreBaseline | undefined
  ): { appendPhysicalFolderIds: string[]; removePhysicalFolderIds: string[] } | { reason: string } | { capacityRequiredLogicalFolderIds: string[] } {
    if (!baseline) return { reason: 'remote baseline was unavailable' }
    const desiredLogicalFolderIds = uniqueFolderIds(operation.desiredLogicalFolderIds)
    // An empty desired set is local inbox, which must never produce a remote folder.
    if (!desiredLogicalFolderIds.length) return { appendPhysicalFolderIds: [], removePhysicalFolderIds: [] }
    const ordinaryIds = new Set(uniqueFolderIds(baseline.ordinaryRemoteFolderIds ?? []))
    const physicalByLogical = new Map(Object.entries(baseline.managedPhysicalFolderIdsByLogicalFolderId)
      .map(([logicalId, ids]) => [logicalId, uniqueFolderIds(ids).filter((id) => !ordinaryIds.has(id))] as const))
    const logicalIdsByPhysicalId = new Map<string, Set<string>>()
    for (const [logicalId, physicalIds] of physicalByLogical) {
      for (const physicalId of physicalIds) {
        let logicalIds = logicalIdsByPhysicalId.get(physicalId)
        if (!logicalIds) {
          logicalIds = new Set<string>()
          logicalIdsByPhysicalId.set(physicalId, logicalIds)
        }
        logicalIds.add(logicalId)
      }
    }
    if ([...logicalIdsByPhysicalId.values()].some((logicalIds) => logicalIds.size > 1)) {
      return { reason: 'a remote folder is bound to multiple logical ledgers' }
    }
    const allManagedIds = new Set([...physicalByLogical.values()].flat())
    const observed = uniqueFolderIds(baseline.managedObservedPhysicalFolderIds).filter((id) => allManagedIds.has(id) && !ordinaryIds.has(id))
    const memberCounts = baseline.managedPhysicalFolderMemberCounts ?? {}
    const capacityRequiredLogicalFolderIds: string[] = []
    const desiredPhysical = desiredLogicalFolderIds.map((logicalId) => {
      const candidates = physicalByLogical.get(logicalId) ?? []
      const observedCandidate = candidates.find((id) => observed.includes(id))
      if (observedCandidate) return observedCandidate
      const available = candidates.find((id) => (memberCounts[id] ?? 0) < REMOTE_FAVORITE_SHARD_CAPACITY)
      if (!available && candidates.length) capacityRequiredLogicalFolderIds.push(logicalId)
      return available
    })
    if (capacityRequiredLogicalFolderIds.length) return { capacityRequiredLogicalFolderIds: uniqueFolderIds(capacityRequiredLogicalFolderIds) }
    if (desiredPhysical.some((id) => !id)) return { reason: 'a managed archive target is unbound' }
    const desired = uniqueFolderIds(desiredPhysical as string[])
    return {
      appendPhysicalFolderIds: desired.filter((id) => !observed.includes(id)),
      // Full restore only removes a verified, currently-bound Bilimi physical folder.
      removePhysicalFolderIds: mode === 'full' ? observed.filter((id) => !desired.includes(id)) : []
    }
  }

  private restoreRecord(snapshot: AccountFavoriteRepositorySnapshot, restoreId: string, aid: number) {
    return snapshot.syncRecords.find((record) => record.runId === restoreId && record.operationKey === `archive-restore:${aid}`)
  }

  private async writeRestoreCheckpoint(
    accountMid: string,
    restoreId: string,
    aid: number,
    attempt: number,
    status: FavoriteRepositorySyncRecord['status'],
    targetFolderIds: string[],
    reason?: string
  ) {
    const record: FavoriteRepositorySyncRecord = {
      id: `${restoreId}:${aid}`, commandId: `${restoreId}:${aid}`, runId: restoreId, operationKey: `archive-restore:${aid}`,
      status, affectedAids: [aid], targetFolderIds: uniqueFolderIds(targetFolderIds), attempt, updatedAt: this.now(), ...(reason ? { reason } : {})
    }
    await this.options.repository.recordSyncCheckpoint(accountMid, `favorite-archive-restore:${restoreId}:${aid}:${attempt}:${status}`, record)
  }

  private restoreResult(
    id: string,
    accountMid: string,
    totalOperationCount: number,
    items: FavoriteRepositoryRestoreExecutionResult['items']
  ): FavoriteRepositoryRestoreExecutionResult {
    const status = items.some((item) => item.status === 'result-unknown') ? 'result-unknown'
      : items.some((item) => item.status === 'failed') ? 'failed' : 'succeeded'
    return { id, accountMid, status, completedOperationCount: items.filter((item) => item.status === 'succeeded').length, totalOperationCount, items }
  }

  private isConfirmedRemoteFailure(error: unknown) {
    return typeof error === 'object' && error !== null && (error as { remoteWriteRejected?: unknown }).remoteWriteRejected === true
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
