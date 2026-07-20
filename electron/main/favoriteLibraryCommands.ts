import { randomUUID } from 'node:crypto'
import { mkdir, appendFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  compileFrozenFavoriteSyncPlan
} from '../../src/shared/favoriteRepositoryExecutionPlan'
import type {
  AccountFavoriteRepositorySnapshot,
  FavoriteRepositoryFrozenSyncOperation,
  FavoriteRepositoryFrozenSyncPlan,
  FavoriteRepositorySyncRecord
} from '../../src/shared/favoriteRepository'
import type { FavoriteRepositoryService } from './favoriteRepositoryService'
import {
  FavoriteRepositoryRemoteRejectedError,
  type FavoriteRepositoryPageBridgeManager
} from './favoriteRepositorySyncService'
import type { VideoAudioTranscriptionRequest } from '../../src/shared/types'
import type { FavoriteRepositoryRemoteOperationArbiter } from './favoriteRepositoryRemoteOperationArbiter'

const RETRY_READY_REASON = 'reconciled-absent-ready-to-retry'
const MAX_SELECTION_AIDS = 500

export type FavoriteLibrarySyncSelection =
  | { kind: 'aids'; aids: number[] }
  | { kind: 'folder'; folderId: string }

export type FavoriteLibrarySyncStatus = 'succeeded' | 'failed' | 'result-unknown' | 'ready-to-retry' | 'running'

export type FavoriteLibraryCommandResult = {
  runId?: string
  status: FavoriteLibrarySyncStatus | 'queued'
  completedOperationCount: number
  totalOperationCount: number
  affectedAids: number[]
  reason?: string
}

type LibrarySyncJob = {
  version: 1
  accountMid: string
  runId: string
  createdAt: string
  plan: FavoriteRepositoryFrozenSyncPlan
}

type LibrarySyncJobJournalEvent = { type: 'create'; job: LibrarySyncJob }

type TranscriptionQueue = { enqueue(request: VideoAudioTranscriptionRequest): unknown }

function normalizeAccountMid(value: string) {
  const raw = value.trim()
  if (!/^\d+$/.test(raw) || BigInt(raw) === 0n) throw new Error('Favorite repository account is invalid.')
  return BigInt(raw).toString()
}

function uniquePositiveAids(value: unknown, limit = MAX_SELECTION_AIDS) {
  if (!Array.isArray(value) || value.some((aid) => !Number.isSafeInteger(aid) || aid <= 0)) {
    throw new Error('Favorite library selection is invalid.')
  }
  const aids = [...new Set(value)].sort((left, right) => left - right)
  if (!aids.length || aids.length > limit) throw new Error('Favorite library selection is invalid.')
  return aids
}

function clonePlan(plan: FavoriteRepositoryFrozenSyncPlan): FavoriteRepositoryFrozenSyncPlan {
  return {
    ...plan,
    operations: plan.operations.map((operation) => ({ ...operation, folderIds: [...operation.folderIds] }))
  }
}

function cloneJob(job: LibrarySyncJob): LibrarySyncJob {
  return { ...job, plan: clonePlan(job.plan) }
}

function operationRecordId(runId: string, operation: FavoriteRepositoryFrozenSyncOperation) {
  return `${runId}:${operation.operationKey}`
}

function isConfirmedRemoteRejection(error: unknown) {
  return error instanceof FavoriteRepositoryRemoteRejectedError ||
    (typeof error === 'object' && error !== null && (error as { remoteWriteRejected?: unknown }).remoteWriteRejected === true)
}

/**
 * Owns library-only sync jobs. Jobs are append-only and deliberately separate
 * from the old-favorite workspace, whose frozen plan must remain immutable.
 */
export class FavoriteLibraryCommandService {
  constructor(private readonly options: {
    repository: Pick<FavoriteRepositoryService, 'getSnapshot' | 'getSyncCheckpoints' | 'recordSyncCheckpoint'>
    pageBridgeManager: FavoriteRepositoryPageBridgeManager
    transcriptionQueue: TranscriptionQueue
    root: string
    now?: () => string
    runId?: () => string
    remoteOperations?: FavoriteRepositoryRemoteOperationArbiter
  }) {}

  async syncSelection(accountMid: string, selection: FavoriteLibrarySyncSelection): Promise<FavoriteLibraryCommandResult> {
    const account = normalizeAccountMid(accountMid)
    const snapshot = await this.options.repository.getSnapshot(account)
    const plan = this.compileSelectionPlan(snapshot, account, selection)
    const job: LibrarySyncJob = {
      version: 1,
      accountMid: account,
      runId: plan.id,
      createdAt: this.now(),
      plan
    }
    await this.appendJob(job)
    return this.bindAndDrive(job)
  }

  async reconcileSync(accountMid: string, runId: string): Promise<FavoriteLibraryCommandResult> {
    const account = normalizeAccountMid(accountMid)
    const job = await this.requireJob(account, runId)
    return this.runRemote(account, async () => {
      const records = this.recordsByOperation(job.plan, await this.options.repository.getSyncCheckpoints(account, job.runId))
      for (const operation of job.plan.operations) {
        const record = records.get(operation.operationKey)
        if (!record || record.status === 'succeeded' || record.status === 'failed' ||
          (record.status === 'pending' && record.reason === RETRY_READY_REASON)) continue
        try {
          const result = await this.options.pageBridgeManager.pageBridge(account, job.runId).readMembers({
            accountMid: account, operationKey: operation.operationKey, aid: operation.aid, folderIds: operation.folderIds
          })
          if (normalizeAccountMid(result.observedAccountMid) !== account ||
            !operation.folderIds.every((folderId) => Array.isArray(result.members[folderId]))) {
            records.set(operation.operationKey, await this.writeRecord(account, job, operation, 'result-unknown', record.attempt ?? 1, 'reconciliation-membership-incomplete', 'reconciled'))
            continue
          }
          const membership = operation.folderIds.map((folderId) => result.members[folderId].includes(operation.aid))
          if (membership.every(Boolean)) {
            records.set(operation.operationKey, await this.writeRecord(account, job, operation, 'succeeded', record.attempt ?? 1, 'reconciled-confirmed', 'reconciled'))
          } else if (membership.every((member) => !member)) {
            records.set(operation.operationKey, await this.writeRecord(account, job, operation, 'pending', record.attempt ?? 1, RETRY_READY_REASON, 'reconciled'))
          } else {
            records.set(operation.operationKey, await this.writeRecord(account, job, operation, 'result-unknown', record.attempt ?? 1, 'reconciled-partial-state', 'reconciled'))
          }
        } catch (error) {
          records.set(operation.operationKey, await this.writeRecord(account, job, operation, 'result-unknown', record.attempt ?? 1, error instanceof Error ? error.message : String(error), 'reconciled'))
        }
      }
      return this.result(job, Array.from(records.values()))
    })
  }

  async retrySync(accountMid: string, runId: string): Promise<FavoriteLibraryCommandResult> {
    const account = normalizeAccountMid(accountMid)
    const job = await this.requireJob(account, runId)
    const records = this.recordsByOperation(job.plan, await this.options.repository.getSyncCheckpoints(account, job.runId))
    if ([...records.values()].some((record) => record.status === 'result-unknown' ||
      (record.status === 'pending' && record.reason !== RETRY_READY_REASON))) {
      throw new Error('Favorite library sync must be reconciled before retrying.')
    }
    for (const operation of job.plan.operations) {
      const record = records.get(operation.operationKey)
      if (record?.status === 'failed') {
        records.set(operation.operationKey, await this.writeRecord(account, job, operation, 'pending', (record.attempt ?? 0) + 1, RETRY_READY_REASON, 'retry'))
      }
    }
    return this.runRemote(account, async () => this.drive(job))
  }

  /** Explicit user action: binds the current controlled Bilibili page for a recovered run. */
  async bindSyncPage(accountMid: string, runId: string) {
    const account = normalizeAccountMid(accountMid)
    const job = await this.requireJob(account, runId)
    await this.runRemote(account, async () => this.options.pageBridgeManager.bind(account, job.runId))
    return { runId: job.runId, status: 'running' as const, completedOperationCount: 0, totalOperationCount: job.plan.operations.length,
      affectedAids: [...new Set(job.plan.operations.map((operation) => operation.aid))].sort((left, right) => left - right) }
  }

  async enqueueTranscription(accountMid: string, requestedAids: number[], summarizeWithDeepSeek = false): Promise<FavoriteLibraryCommandResult> {
    const account = normalizeAccountMid(accountMid)
    const aids = uniquePositiveAids(requestedAids)
    const snapshot = await this.options.repository.getSnapshot(account)
    for (const aid of aids) {
      const video = snapshot.videos[String(aid)]
      if (!video) throw new Error('Favorite library video is unavailable for transcription.')
      this.options.transcriptionQueue.enqueue({
        url: `https://www.bilibili.com/video/av${aid}`,
        title: video.title,
        ...(video.author ? { author: video.author } : {}),
        aid,
        ...(summarizeWithDeepSeek ? { summarizeWithDeepSeek: true } : {})
      })
    }
    return { status: 'queued', completedOperationCount: aids.length, totalOperationCount: aids.length, affectedAids: aids }
  }

  /** Returns only interrupted actionable jobs; plans remain private to main process. */
  async getPendingSyncRuns(accountMid: string): Promise<FavoriteLibraryCommandResult[]> {
    const account = normalizeAccountMid(accountMid)
    const jobs = await this.readJobs(account)
    const results = await Promise.all(jobs.map(async (job) => this.result(job,
      await this.options.repository.getSyncCheckpoints(account, job.runId))))
    return results.filter((result) => result.status === 'failed' || result.status === 'result-unknown' || result.status === 'ready-to-retry')
  }

  private async bindAndDrive(job: LibrarySyncJob) {
    return this.runRemote(job.accountMid, async () => {
      await this.options.pageBridgeManager.bind(job.accountMid, job.runId)
      try {
        return await this.drive(job)
      } finally {
        this.options.pageBridgeManager.release(job.accountMid, job.runId)
      }
    })
  }

  private async drive(job: LibrarySyncJob) {
    const records = this.recordsByOperation(job.plan, await this.options.repository.getSyncCheckpoints(job.accountMid, job.runId))
    for (const operation of job.plan.operations) {
      const previous = records.get(operation.operationKey)
      if (previous?.status === 'succeeded') continue
      if (previous?.status === 'failed' || previous?.status === 'result-unknown' ||
        (previous?.status === 'pending' && previous.reason !== RETRY_READY_REASON)) return this.result(job, Array.from(records.values()))
      const attempt = (previous?.attempt ?? 0) + 1
      records.set(operation.operationKey, await this.writeRecord(job.accountMid, job, operation, 'pending', attempt, 'remote-request-started', 'checkpoint'))
      try {
        const result = await this.options.pageBridgeManager.pageBridge(job.accountMid, job.runId).append({
          accountMid: job.accountMid, operationKey: operation.operationKey, aid: operation.aid, folderIds: operation.folderIds
        })
        if (normalizeAccountMid(result.observedAccountMid) !== job.accountMid) throw new Error('Favorite sync page bridge account changed during execution.')
        records.set(operation.operationKey, await this.writeRecord(job.accountMid, job, operation, 'succeeded', attempt, undefined, 'result'))
      } catch (error) {
        records.set(operation.operationKey, await this.writeRecord(job.accountMid, job, operation,
          isConfirmedRemoteRejection(error) ? 'failed' : 'result-unknown', attempt,
          error instanceof Error ? error.message : String(error), 'result'))
        return this.result(job, Array.from(records.values()))
      }
    }
    return this.result(job, Array.from(records.values()))
  }

  private compileSelectionPlan(snapshot: AccountFavoriteRepositorySnapshot, account: string, selection: FavoriteLibrarySyncSelection) {
    const selectedAids = selection.kind === 'aids'
      ? uniquePositiveAids(selection.aids)
      : this.folderSelection(snapshot, selection.folderId)
    const targetsByAid = new Map<number, Set<string>>()
    for (const aid of selectedAids) {
      if (!snapshot.videos[String(aid)]) throw new Error('Favorite library video is not available for sync.')
      for (const [folderId, memberAids] of Object.entries(snapshot.memberships)) {
        if (!memberAids.includes(aid)) continue
        const target = this.targetLedgerId(snapshot, folderId)
        if (target) (targetsByAid.get(aid) ?? targetsByAid.set(aid, new Set()).get(aid)!).add(target)
      }
      if (!targetsByAid.get(aid)?.size) throw new Error('Favorite library video is not available for sync.')
    }
    const runId = this.runId()
    const compiled = compileFrozenFavoriteSyncPlan({
      accountMid: account,
      workspaceId: `favorite-library:${runId}`,
      baselineRevision: snapshot.revision,
      createdAt: this.now(),
      planId: runId,
      classifications: selectedAids.map((aid) => ({ aid, targetLedgerIds: [...targetsByAid.get(aid)!].sort() })),
      shards: snapshot.physicalShards.flatMap((shard) => shard.bindingState === 'bound' && shard.remoteFolderId ? [{
        logicalLedgerId: shard.logicalLedgerId,
        remoteFolderId: shard.remoteFolderId,
        memberAids: snapshot.memberships[shard.folderId] ?? [],
        memberCount: shard.remoteMemberCount,
        shardNumber: shard.shardNumber
      }] : [])
    })
    if (!compiled.allowed || !compiled.plan) throw new Error(`Favorite library sync cannot be planned: ${compiled.reason ?? 'invalid-input'}`)
    return compiled.plan
  }

  private folderSelection(snapshot: AccountFavoriteRepositorySnapshot, folderId: string) {
    if (typeof folderId !== 'string' || !folderId.trim()) throw new Error('Favorite library folder selection is invalid.')
    const folder = snapshot.folders.find((candidate) => candidate.id === folderId.trim())
    if (!folder || (folder.kind !== 'local' && folder.kind !== 'bilimi-logical')) {
      throw new Error('Favorite library folder is not a local Bilimi folder.')
    }
    return uniquePositiveAids(snapshot.memberships[folder.id] ?? [])
  }

  private targetLedgerId(snapshot: AccountFavoriteRepositorySnapshot, folderId: string) {
    const folder = snapshot.folders.find((candidate) => candidate.id === folderId)
    if (folder?.kind === 'bilimi-logical') return folder.logicalLedgerId?.trim()
    if (folder?.kind === 'local' && folder.id.startsWith('local:')) return folder.id.slice('local:'.length).trim()
    return undefined
  }

  private recordsByOperation(plan: FavoriteRepositoryFrozenSyncPlan, records: FavoriteRepositorySyncRecord[]) {
    return new Map(records.filter((record) => record.runId === plan.id && record.operationKey)
      .map((record) => [record.operationKey!, record]))
  }

  private async writeRecord(
    account: string,
    job: LibrarySyncJob,
    operation: FavoriteRepositoryFrozenSyncOperation,
    status: FavoriteRepositorySyncRecord['status'],
    attempt: number,
    reason: string | undefined,
    checkpoint: string
  ) {
    const record: FavoriteRepositorySyncRecord = {
      id: operationRecordId(job.runId, operation),
      commandId: operationRecordId(job.runId, operation),
      status,
      affectedAids: [operation.aid],
      updatedAt: this.now(),
      runId: job.runId,
      operationKey: operation.operationKey,
      targetFolderIds: [...operation.folderIds],
      attempt,
      ...(reason ? { reason } : {})
    }
    await this.options.repository.recordSyncCheckpoint(account,
      `favorite-library:${job.runId}:${operation.operationKey}:${checkpoint}:${status}:${attempt}`, record)
    return record
  }

  private result(job: LibrarySyncJob, records: FavoriteRepositorySyncRecord[]): FavoriteLibraryCommandResult {
    const byOperation = this.recordsByOperation(job.plan, records)
    const complete = job.plan.operations.filter((operation) => byOperation.get(operation.operationKey)?.status === 'succeeded').length
    const values = [...byOperation.values()]
    const status: FavoriteLibrarySyncStatus = complete === job.plan.operations.length ? 'succeeded'
      : values.some((record) => record.status === 'result-unknown' || (record.status === 'pending' && record.reason !== RETRY_READY_REASON)) ? 'result-unknown'
        : values.some((record) => record.status === 'failed') ? 'failed'
          : values.some((record) => record.status === 'pending' && record.reason === RETRY_READY_REASON) ? 'ready-to-retry'
            : 'running'
    return { runId: job.runId, status, completedOperationCount: complete, totalOperationCount: job.plan.operations.length,
      affectedAids: [...new Set(job.plan.operations.map((operation) => operation.aid))].sort((left, right) => left - right) }
  }

  private async appendJob(job: LibrarySyncJob) {
    const path = this.jobJournalPath(job.accountMid)
    await mkdir(join(this.options.root, job.accountMid), { recursive: true })
    const existing = await this.readJobs(job.accountMid)
    if (existing.some((candidate) => candidate.runId === job.runId)) return
    const event: LibrarySyncJobJournalEvent = { type: 'create', job: cloneJob(job) }
    await appendFile(path, `${JSON.stringify(event)}\n`, 'utf8')
  }

  private async requireJob(account: string, runId: string) {
    if (typeof runId !== 'string' || !/^[a-zA-Z0-9:_-]+$/.test(runId)) throw new Error('Favorite library sync run is invalid.')
    const job = (await this.readJobs(account)).find((candidate) => candidate.runId === runId)
    if (!job) throw new Error('Favorite library sync run was not found.')
    return job
  }

  private async readJobs(account: string) {
    try {
      const source = await readFile(this.jobJournalPath(account), 'utf8')
      const jobs = new Map<string, LibrarySyncJob>()
      const lines = source.split(/\r?\n/)
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]
        if (!line.trim()) continue
        let event: Partial<LibrarySyncJobJournalEvent>
        try { event = JSON.parse(line) as Partial<LibrarySyncJobJournalEvent> } catch {
          if (index === lines.length - 1) break
          throw new Error('Favorite library sync journal is corrupt.')
        }
        if (event.type === 'create' && event.job?.version === 1 && event.job.accountMid === account && event.job.runId && event.job.plan) {
          jobs.set(event.job.runId, cloneJob(event.job))
        }
      }
      return [...jobs.values()]
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  private jobJournalPath(account: string) {
    return join(this.options.root, account, 'library-sync-jobs.jsonl')
  }

  private now() { return this.options.now?.() ?? new Date().toISOString() }
  private runId() { return this.options.runId?.().trim() || `library-sync:${randomUUID()}` }
  private async runRemote<T>(account: string, operation: () => Promise<T>) {
    return this.options.remoteOperations?.run(account, operation) ?? operation()
  }
}

type IpcEvent = { sender: { id: number } }
type IpcMain = { handle(channel: string, handler: (event: IpcEvent, ...args: never[]) => unknown): void }

function librarySelection(value: unknown): FavoriteLibrarySyncSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Favorite library selection is invalid.')
  const candidate = value as { kind?: unknown; aids?: unknown; folderId?: unknown }
  if (candidate.kind === 'aids' && Object.keys(candidate).length === 2) return { kind: 'aids', aids: uniquePositiveAids(candidate.aids) }
  if (candidate.kind === 'folder' && typeof candidate.folderId === 'string' && candidate.folderId.trim() && Object.keys(candidate).length === 2) {
    return { kind: 'folder', folderId: candidate.folderId.trim() }
  }
  throw new Error('Favorite library selection is invalid.')
}

function transcriptionInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Favorite library transcription request is invalid.')
  const candidate = value as { aids?: unknown; summarizeWithDeepSeek?: unknown }
  if (Object.keys(candidate).some((key) => key !== 'aids' && key !== 'summarizeWithDeepSeek') ||
    (candidate.summarizeWithDeepSeek !== undefined && typeof candidate.summarizeWithDeepSeek !== 'boolean')) {
    throw new Error('Favorite library transcription request is invalid.')
  }
  return { aids: uniquePositiveAids(candidate.aids), summarizeWithDeepSeek: candidate.summarizeWithDeepSeek === true }
}

function runId(value: unknown) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9:_-]+$/.test(value)) throw new Error('Favorite library sync run is invalid.')
  return value
}

/** Registers only library-specific actions; it intentionally has no generic repository commit route. */
export function registerFavoriteLibraryCommandsIpc(options: {
  ipcMain: IpcMain
  commands: Pick<FavoriteLibraryCommandService, 'syncSelection' | 'reconcileSync' | 'retrySync' | 'bindSyncPage' | 'enqueueTranscription' | 'getPendingSyncRuns'>
  isTrustedLibrarySender: (senderId: number) => boolean
  getCurrentAccountMid: () => Promise<string>
}) {
  const assertLibrary = (event: IpcEvent) => {
    if (!options.isTrustedLibrarySender(event.sender.id)) throw new Error('Favorite library request came from an untrusted renderer.')
  }
  const assertCurrentAccount = async (requestedAccountMid: unknown) => {
    if (typeof requestedAccountMid !== 'string') throw new Error('Favorite repository account is invalid.')
    const account = normalizeAccountMid(requestedAccountMid)
    let current: string
    try { current = normalizeAccountMid(await options.getCurrentAccountMid()) } catch {
      throw new Error('Favorite library request does not match the current Bilibili account.')
    }
    if (current !== account) throw new Error('Favorite library request does not match the current Bilibili account.')
    return account
  }
  options.ipcMain.handle('favorite-library:sync-selection', async (event, requestedAccountMid: string, selection: unknown) => {
    assertLibrary(event)
    return options.commands.syncSelection(await assertCurrentAccount(requestedAccountMid), librarySelection(selection))
  })
  options.ipcMain.handle('favorite-library:reconcile-sync', async (event, requestedAccountMid: string, requestedRunId: unknown) => {
    assertLibrary(event)
    return options.commands.reconcileSync(await assertCurrentAccount(requestedAccountMid), runId(requestedRunId))
  })
  options.ipcMain.handle('favorite-library:retry-sync', async (event, requestedAccountMid: string, requestedRunId: unknown) => {
    assertLibrary(event)
    return options.commands.retrySync(await assertCurrentAccount(requestedAccountMid), runId(requestedRunId))
  })
  options.ipcMain.handle('favorite-library:bind-sync-page', async (event, requestedAccountMid: string, requestedRunId: unknown) => {
    assertLibrary(event)
    return options.commands.bindSyncPage(await assertCurrentAccount(requestedAccountMid), runId(requestedRunId))
  })
  options.ipcMain.handle('favorite-library:enqueue-transcription', async (event, requestedAccountMid: string, input: unknown) => {
    assertLibrary(event)
    const parsed = transcriptionInput(input)
    return options.commands.enqueueTranscription(await assertCurrentAccount(requestedAccountMid), parsed.aids, parsed.summarizeWithDeepSeek)
  })
  options.ipcMain.handle('favorite-library:get-pending-sync-runs', async (event, requestedAccountMid: string) => {
    assertLibrary(event)
    return options.commands.getPendingSyncRuns(await assertCurrentAccount(requestedAccountMid))
  })
}
