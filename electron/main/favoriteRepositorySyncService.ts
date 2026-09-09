import {
  createAccountFavoriteRepositorySnapshot,
  deriveFavoriteRepositoryClassificationSource,
  type AccountFavoriteRepositorySnapshot,
  type FavoriteRepositoryClassificationAdjustment,
  type FavoriteRepositoryFrozenSyncOperation,
  type FavoriteRepositoryFrozenSyncPlan,
  type FavoriteLibraryPlacementRunCheckpoint,
  type FavoriteRepositoryOrganizationChange,
  type FavoriteRepositorySyncRecord,
  type FavoriteRepositoryWorkspace
} from '../../src/shared/favoriteRepository'
import { randomUUID } from 'node:crypto'
import { FavoriteRepositoryService } from './favoriteRepositoryService'
import type { FavoriteRepositoryRemoteOperationArbiter } from './favoriteRepositoryRemoteOperationArbiter'
import type { FavoriteRepositoryRestoreWriter } from './favoriteRepositoryArchiveService'

const REMOTE_FAVORITE_SHARD_CAPACITY = 1_000

export type FrozenFavoriteSyncPlan = FavoriteRepositoryFrozenSyncPlan

type SyncRunStatus = 'ready-to-resume' | 'running' | 'result-unknown' | 'failed' | 'succeeded'

export type FavoriteRepositorySyncRun = {
  id: string
  accountMid: string
  workspaceId: string
  status: SyncRunStatus
  completedOperationCount: number
  totalOperationCount: number
  lastFailureReason?: string
  retryAvailableAt?: string
}

type PageBridgeResult = {
  observedAccountMid: string
  status?: 'ok' | 'rejected' | 'unknown'
  reason?: string
  httpStatus?: number
  contentType?: string
  responseCategory?: 'html' | 'json' | 'text' | 'empty' | 'unknown'
  bilibiliCode?: number
}
type PageBridgeDeleteResult = PageBridgeResult & {
  status?: 'ok' | 'rejected' | 'unknown'
  reason?: string
  httpStatus?: number
  contentType?: string
  responseCategory?: 'html' | 'json' | 'text' | 'empty' | 'unknown'
  bilibiliCode?: number
}
export type FavoriteRepositoryRemoteFolder = { id: string; title: string; memberCount: number }
export type ManagedFavoriteFolderDeletionCandidate = {
  logicalLedgerId: string
  remoteFolderId?: string
  title: string
  memberCount: number
  state: 'bound' | 'local-only' | 'unbound-name-match' | 'unbound-historical-id' | 'missing-remote'
  requiresUnboundAcknowledgement: boolean
}

/** A remote-only draft has no collection-library logical folder to resolve. */
export type ManagedFavoriteRemoteDraftDeletionTargets = Record<string, {
  remoteFolderId: string
  title: string
}>

/** Historical remote IDs are deletion-only evidence after formal shards disappear. */
export type ManagedFavoriteHistoricalBindingDeletionTargets = Record<string, Array<{
  remoteFolderId: string
  title: string
}>>

/** Every remote deletion is reported explicitly because a Bilibili batch is not atomic. */
export type ManagedFavoriteRemoteFolderDeletionResult = {
  status: 'succeeded' | 'partial-failed' | 'failed' | 'result-unknown'
  candidates: ManagedFavoriteFolderDeletionCandidate[]
  succeededRemoteFolderIds: string[]
  failedRemoteFolderIds: string[]
  unknownRemoteFolderIds: string[]
  unattemptedRemoteFolderIds: string[]
  failures: Array<{
    logicalLedgerId: string
    remoteFolderId: string
    title: string
    outcome: 'failed' | 'result-unknown'
    message: string
  }>
}

export type FavoriteRepositoryPageBridge = {
  append(input: {
    accountMid: string
    operationKey: string
    aid: number
    folderIds: string[]
  }): Promise<PageBridgeResult>
  remove(input: {
    accountMid: string
    operationKey: string
    aid: number
    folderIds: string[]
  }): Promise<PageBridgeResult>
  readMembers(input: {
    accountMid: string
    operationKey: string
    aid: number
    folderIds: string[]
  }): Promise<PageBridgeResult & { members: Record<string, number[]> }>
  readFolderInventory(input: { accountMid: string; operationKey: string }): Promise<PageBridgeResult & { folders: FavoriteRepositoryRemoteFolder[] }>
  readFolder?(input: { accountMid: string; operationKey: string; folderId: string }): Promise<PageBridgeResult & { folder: FavoriteRepositoryRemoteFolder }>
  createFolder(input: { accountMid: string; operationKey: string; title: string }): Promise<PageBridgeResult & { folder: FavoriteRepositoryRemoteFolder }>
  deleteFolder(input: { accountMid: string; operationKey: string; folderId: string }): Promise<PageBridgeDeleteResult>
  renameFolder(input: { accountMid: string; operationKey: string; folderId: string; title: string }): Promise<PageBridgeResult>
}

export type FavoriteRepositoryPageBridgeManager = {
  bind(accountMid: string, runId: string): Promise<void>
  pageBridge(accountMid: string, runId: string): FavoriteRepositoryPageBridge
  release(accountMid: string, runId: string): void
}

type SyncRecordStatus = FavoriteRepositorySyncRecord['status']

type PlacementSyncResult = {
  status: 'succeeded' | 'failed' | 'queued' | 'result-unknown'
  completedOperationCount: number
  totalOperationCount: number
  affectedAids: number[]
}

/**
 * A renderer-visible progress snapshot for a user-initiated favorite-library
 * placement run. The remote receipts themselves remain the durable source of
 * truth; this record only owns scheduling and pause/stop intent.
 */
export type FavoriteLibraryPlacementSyncRun = {
  id: string
  accountMid: string
  status: 'running' | 'paused' | 'stopped' | 'completed'
  total: number
  completed: number
  failed: number
  queued: number
  unknown: number
  currentAid?: number
}

type RunningFavoriteLibraryPlacementSyncRun = FavoriteLibraryPlacementSyncRun & {
  aids: number[]
  nextIndex: number
  completedAids: number[]
  failedAids: number[]
  queuedAids: number[]
  unknownAids: number[]
  pauseRequested: boolean
  stopRequested: boolean
  driving: boolean
}

const retryReadyReason = 'reconciled-absent-ready-to-retry'

function isRetryReadyRecord(record: FavoriteRepositorySyncRecord | undefined) {
  return record?.status === 'pending' && record.reason?.startsWith(retryReadyReason) === true
}

function isBilibiliRiskControlResponse(reason: string | undefined) {
  return Boolean(reason && /http-status=412/i.test(reason) && /response-category=html|content-type=text\/html/i.test(reason))
}

function normalizeAccountMid(accountMid: string) {
  return createAccountFavoriteRepositorySnapshot({
    accountMid,
    now: '1970-01-01T00:00:00.000Z'
  }).accountMid
}

function normalizedRemoteFolderTitle(title: string) {
  return title.trim().replace(/^bilimi\s*[·.：:-]?\s*/iu, '').trim().toLocaleLowerCase()
}

function isBilimiRemoteFolder(title: string) {
  return /^bilimi\s*[·.：:-]/iu.test(title.trim())
}

function matchesManagedRemoteFolderTitle(title: string, expectedTitle: string) {
  const normalizedTitle = normalizedRemoteFolderTitle(title)
  const normalizedExpectedTitle = normalizedRemoteFolderTitle(expectedTitle)
  return normalizedTitle === normalizedExpectedTitle ||
    new RegExp(`^${normalizedExpectedTitle.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}·\\d+$`, 'u').test(normalizedTitle)
}

function normalizedRemoteDraftDeletionTargets(
  targets: ManagedFavoriteRemoteDraftDeletionTargets | undefined
) {
  if (!targets) return []
  const seenRemoteFolderIds = new Set<string>()
  return Object.entries(targets).map(([logicalLedgerId, target]) => {
    const ledgerId = logicalLedgerId.trim()
    const remoteFolderId = target?.remoteFolderId?.trim()
    const title = target?.title?.trim()
    if (!ledgerId || !remoteFolderId || !title || seenRemoteFolderIds.has(remoteFolderId)) {
      throw new Error('Managed remote draft deletion target is invalid.')
    }
    seenRemoteFolderIds.add(remoteFolderId)
    return { logicalLedgerId: ledgerId, remoteFolderId, title }
  }).sort((left, right) => left.logicalLedgerId.localeCompare(right.logicalLedgerId))
}

function normalizedHistoricalBindingDeletionTargets(
  targets: ManagedFavoriteHistoricalBindingDeletionTargets | undefined
) {
  if (!targets) return []
  const seenRemoteFolderIds = new Set<string>()
  return Object.entries(targets).flatMap(([logicalLedgerId, entries]) => {
    const ledgerId = logicalLedgerId.trim()
    if (!ledgerId || !Array.isArray(entries)) throw new Error('Managed historical binding deletion target is invalid.')
    return entries.map((target) => {
      const remoteFolderId = target?.remoteFolderId?.trim()
      const title = target?.title?.trim()
      if (!remoteFolderId || !title || seenRemoteFolderIds.has(remoteFolderId)) {
        throw new Error('Managed historical binding deletion target is invalid.')
      }
      seenRemoteFolderIds.add(remoteFolderId)
      return { logicalLedgerId: ledgerId, remoteFolderId, title }
    })
  }).sort((left, right) => left.logicalLedgerId.localeCompare(right.logicalLedgerId) || left.remoteFolderId.localeCompare(right.remoteFolderId))
}

function clonePlan(plan: FavoriteRepositoryFrozenSyncPlan): FavoriteRepositoryFrozenSyncPlan {
  return {
    ...plan,
    accountMid: normalizeAccountMid(plan.accountMid),
    operations: plan.operations.map((operation) => ({
      ...operation,
      folderIds: [...new Set(operation.folderIds.map((folderId) => folderId.trim()).filter(Boolean))]
    }))
  }
}

function withWorkspaceStatus(
  workspace: FavoriteRepositoryWorkspace,
  status: FavoriteRepositoryWorkspace['status'],
  frozenSyncPlan: FavoriteRepositoryFrozenSyncPlan,
  currentStep: NonNullable<FavoriteRepositoryWorkspace['workspaceRef']['currentStep']> = status
): FavoriteRepositoryWorkspace {
  return {
    ...workspace,
    status,
    workspaceRef: { ...workspace.workspaceRef, status, currentStep },
    frozenSyncPlan
  }
}

export class FavoriteRepositoryRemoteRejectedError extends Error {
  readonly remoteWriteRejected = true
}

function isConfirmedRemoteRejection(error: unknown) {
  return error instanceof FavoriteRepositoryRemoteRejectedError ||
    (typeof error === 'object' && error !== null && (error as { remoteWriteRejected?: unknown }).remoteWriteRejected === true)
}

export class FavoriteRepositorySyncService {
  private readonly runTails = new Map<string, Promise<void>>()
  private readonly claimedExecutionRuns = new Set<string>()
  private readonly activeRemoteRequests = new Set<string>()
  private readonly stopRequestedRuns = new Set<string>()
  private readonly pauseRequestedRuns = new Set<string>()
  private readonly executingPlanIds = new Map<string, string>()
  private readonly libraryPlacementRuns = new Map<string, RunningFavoriteLibraryPlacementSyncRun>()
  private readonly libraryPlacementRunByAccount = new Map<string, string>()

  constructor(private readonly options: {
    repository: FavoriteRepositoryService
    pageBridge?: FavoriteRepositoryPageBridge
    createPageBridge?: (runId: string) => FavoriteRepositoryPageBridge
    pageBridgeManager?: FavoriteRepositoryPageBridgeManager
    now?: () => string
    sleep?: (milliseconds: number) => Promise<void>
    yieldToEventLoop?: () => Promise<void>
    pacingMs?: number
    random?: () => number
    remoteOperations?: FavoriteRepositoryRemoteOperationArbiter
    ensurePhysicalShard?: (accountMid: string, input: {
      logicalLedgerId: string
      logicalTitle: string
      remoteDisplayTitle?: string
      shardNumber: number
      memberAids: number[]
    }) => Promise<unknown>
    onPhysicalShardProvisioned?: (accountMid: string) => Promise<unknown> | unknown
    onLibraryPlacementRunChanged?: (run: FavoriteLibraryPlacementSyncRun) => void
    /** Runs once after one or more Bilibili folder deletions are confirmed. */
    onConfirmedRemoteFolderMutation?: (accountMid: string) => Promise<unknown> | unknown
    reconciliationReadTimeoutMs?: number
    remoteWriteTimeoutMs?: number
    retryCooldownMs?: number
    riskControlCooldownMs?: number
  }) {}

  private pageBridge(accountMid: string, runId: string) {
    const pageBridge = this.options.pageBridgeManager?.pageBridge(accountMid, runId) ??
      this.options.createPageBridge?.(runId) ?? this.options.pageBridge
    if (!pageBridge) throw new Error('Favorite sync page bridge is unavailable.')
    return pageBridge
  }

  private async readMembersForReconciliation<T>(read: () => Promise<T>): Promise<T> {
    return this.withTimeout(read, this.options.reconciliationReadTimeoutMs ?? 12_000, 'reconciliation membership read timed out')
  }

  private async writeToRemote<T>(write: () => Promise<T>): Promise<T> {
    return this.withTimeout(write, this.options.remoteWriteTimeoutMs ?? 20_000, 'remote favorite write timed out')
  }

  private async withTimeout<T>(operation: () => Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
        })
      ])
    } finally {
      if (timeout !== undefined) clearTimeout(timeout)
    }
  }

  async bindPageTarget(accountMid: string, runId: string) {
    const account = normalizeAccountMid(accountMid)
    await this.options.pageBridgeManager?.bind(account, runId)
  }

  async rebindPageTarget(accountMid: string, runId: string) {
    const account = normalizeAccountMid(accountMid)
    this.options.pageBridgeManager?.release(account, runId)
    await this.options.pageBridgeManager?.bind(account, runId)
  }

  /** Discards only the local execution plan; already completed remote writes remain untouched. */
  async abandonFrozenPlan(accountMid: string): Promise<void> {
    const account = normalizeAccountMid(accountMid)
    await this.runRemote(account, async () => {
      const { workspace } = await this.options.repository.getSnapshot(account)
      const plan = workspace?.frozenSyncPlan
      if (!workspace || !plan) return
      await this.withRunLock(account, plan.id, async () => this.abandonFrozenPlanUnderLock(account, plan.id))
    })
  }

  /** Lets the current remote request finish, then drops every still-pending operation. */
  async stopAndAbandonFrozenPlan(accountMid: string): Promise<void> {
    const account = normalizeAccountMid(accountMid)
    const activePlanId = this.executingPlanIds.get(account)
    if (activePlanId) this.stopRequestedRuns.add(this.runKey(account, activePlanId))
    const { workspace } = await this.options.repository.getSnapshot(account)
    const plan = workspace?.frozenSyncPlan
    if (!workspace || !plan || workspace.status !== 'executing') {
      if (activePlanId) this.stopRequestedRuns.delete(this.runKey(account, activePlanId))
      return
    }
    const key = this.runKey(account, plan.id)
    this.stopRequestedRuns.add(key)
    try {
      await this.runRemote(account, () => this.withRunLock(account, plan.id, async () => {
        await this.abandonFrozenPlanUnderLock(account, plan.id)
      }))
    } finally {
      this.stopRequestedRuns.delete(key)
    }
  }

  /** Lets the active remote request finish, then preserves the remaining plan for an explicit user continuation. */
  async pauseFrozenPlan(accountMid: string): Promise<void> {
    const account = normalizeAccountMid(accountMid)
    const { workspace } = await this.options.repository.getSnapshot(account)
    const plan = workspace?.frozenSyncPlan
    if (!workspace || !plan || workspace.status !== 'executing') return
    const key = this.runKey(account, plan.id)
    this.pauseRequestedRuns.add(key)
    try {
      await this.runRemote(account, () => this.withRunLock(account, plan.id, async () => {
        await this.pauseFrozenPlanUnderLock(account, plan.id)
      }))
    } finally {
      this.pauseRequestedRuns.delete(key)
    }
  }

  /** Persists the user-confirmed execution boundary before any remote bind begins. */
  async claimFrozenPlan(accountMid: string, frozenPlan: FrozenFavoriteSyncPlan): Promise<FavoriteRepositorySyncRun> {
    const account = normalizeAccountMid(accountMid)
    const plan = clonePlan(frozenPlan)
    return this.withRunLock(account, plan.id, async () => {
      const { workspace } = await this.options.repository.getSnapshot(account)
      if (!workspace || workspace.id !== plan.workspaceId || JSON.stringify(workspace.frozenSyncPlan) !== JSON.stringify(plan)) {
        throw new Error('Favorite sync plan does not match the frozen workspace.')
      }
      const run = this.summarize(plan, await this.options.repository.getSyncCheckpoints(account, plan.id))
      if (workspace.status === 'frozen') {
        await this.writeWorkspace(account, withWorkspaceStatus(workspace, 'executing', plan), `claim:${plan.id}`)
        this.claimedExecutionRuns.add(`${account}:${plan.id}`)
        this.executingPlanIds.set(account, plan.id)
      }
      return run
    })
  }

  async executeFrozenPlan(accountMid: string, frozenPlan: FrozenFavoriteSyncPlan): Promise<FavoriteRepositorySyncRun> {
    const account = normalizeAccountMid(accountMid)
    const plan = clonePlan(frozenPlan)
    return this.runRemote(account, async () => this.withRunLock(account, plan.id, async () => {
      if (plan.accountMid !== account) throw new Error('Favorite sync plan account mismatch.')
      const snapshot = await this.options.repository.getSnapshot(account)
      const workspace = snapshot.workspace
      if (!workspace || workspace.id !== plan.workspaceId || workspace.baselineRevision !== plan.baselineRevision) {
        throw new Error('Favorite sync plan does not match the frozen workspace.')
      }
      if (workspace.frozenSyncPlan) {
        if (JSON.stringify(workspace.frozenSyncPlan) !== JSON.stringify(plan)) {
          throw new Error('Favorite workspace frozen sync plan does not match the persisted plan.')
        }
        const existingRun = this.summarize(workspace.frozenSyncPlan, await this.options.repository.getSyncCheckpoints(account, plan.id))
        if (existingRun.status === 'succeeded') {
          await this.recordOrganizationProtections(account, workspace.frozenSyncPlan)
          if (workspace.status !== 'completed') {
            await this.writeWorkspace(account, withWorkspaceStatus(workspace, 'completed', workspace.frozenSyncPlan), `complete:${plan.id}`)
          }
          this.options.pageBridgeManager?.release(account, plan.id)
          return existingRun
        }
        if (workspace.status !== 'frozen') {
          if (workspace.status === 'executing' && this.claimedExecutionRuns.delete(`${account}:${plan.id}`)) {
            try {
              await this.bindPageTarget(account, plan.id)
              this.executingPlanIds.set(account, plan.id)
              return this.drive(account, workspace.frozenSyncPlan)
            } catch (error) {
              await this.writeWorkspace(account, withWorkspaceStatus(workspace, 'reconciling', workspace.frozenSyncPlan), `bind-failed:${plan.id}`)
              throw error
            }
          }
          // A restored/existing run is never rebound here. Callers must use
          // explicit reconciliation before deciding whether it may continue.
          if (workspace.status === 'executing' && existingRun.status === 'result-unknown') {
            await this.writeWorkspace(account, withWorkspaceStatus(workspace, 'reconciling', workspace.frozenSyncPlan, 'result-unknown'), `interrupted-unknown:${plan.id}`)
          } else if (workspace.status === 'executing' && existingRun.status === 'ready-to-resume') {
            await this.writeWorkspace(account, withWorkspaceStatus(workspace, 'frozen', workspace.frozenSyncPlan), `interrupted-retry-ready:${plan.id}`)
          } else if (workspace.status === 'executing' && !existingRun.completedOperationCount && existingRun.status === 'running') {
            await this.writeWorkspace(account, withWorkspaceStatus(workspace, 'reconciling', workspace.frozenSyncPlan), `interrupted-before-request:${plan.id}`)
          }
          return existingRun
        }
        // Persist the execution boundary before binding. A restart must reconcile
        // rather than mistake an interrupted bind for a new user-confirmed run.
        await this.writeWorkspace(account, withWorkspaceStatus(workspace, 'executing', workspace.frozenSyncPlan), `start:${plan.id}`)
        await this.bindPageTarget(account, plan.id)
        this.executingPlanIds.set(account, plan.id)
        return this.drive(account, workspace.frozenSyncPlan)
      }
      await this.bindPageTarget(account, plan.id)
      await this.writeWorkspace(account, withWorkspaceStatus(workspace, 'executing', plan), `freeze:${plan.id}`)
      this.executingPlanIds.set(account, plan.id)
      return this.drive(account, plan)
    }))
  }

  async getRun(accountMid: string, runId: string): Promise<FavoriteRepositorySyncRun> {
    const account = normalizeAccountMid(accountMid)
    const { workspace } = await this.options.repository.getSnapshot(account)
    const plan = workspace?.frozenSyncPlan
    if (!plan || plan.id !== runId) throw new Error('Favorite sync run was not found.')
    const run = this.summarize(plan, await this.options.repository.getSyncCheckpoints(account, runId))
    return workspace.status === 'frozen' && run.status === 'running'
      ? { ...run, status: 'ready-to-resume' }
      : run
  }

  async resume(accountMid: string, runId: string): Promise<FavoriteRepositorySyncRun> {
    const account = normalizeAccountMid(accountMid)
    return this.runRemote(account, async () => this.withRunLock(account, runId, async () => {
      const { workspace } = await this.options.repository.getSnapshot(account)
      const plan = this.planForRun(workspace, runId, account)
      const run = this.summarize(plan, await this.options.repository.getSyncCheckpoints(account, runId))
      if (run.status === 'result-unknown' || run.status === 'failed' || run.status === 'succeeded') return run
      if (run.retryAvailableAt && Date.parse(this.now()) < Date.parse(run.retryAvailableAt)) {
        throw new Error(`retry-cooldown; ${run.lastFailureReason ?? 'remote-write-temporarily-unavailable'}; retry-at=${run.retryAvailableAt}`)
      }
      await this.writeWorkspace(account, withWorkspaceStatus(workspace!, 'executing', plan), `resume:${runId}`)
      this.executingPlanIds.set(account, plan.id)
      return this.drive(account, plan)
    }))
  }

  async reconcile(accountMid: string, runId: string): Promise<FavoriteRepositorySyncRun> {
    const account = normalizeAccountMid(accountMid)
    return this.runRemote(account, async () => this.withRunLock(account, runId, async () => {
      const { workspace } = await this.options.repository.getSnapshot(account)
      const plan = this.planForRun(workspace, runId, account)
      const records = this.recordsByOperation(plan, await this.options.repository.getSyncCheckpoints(account, runId))
      await this.writeWorkspace(account, withWorkspaceStatus(workspace!, 'reconciling', plan), `reconcile:${runId}`)

      // No remote checkpoint means the interrupted run made no request. It is
      // safe to return to the frozen plan without binding or retrying anything.
      if (!records.size) {
        await this.writeWorkspace(account, withWorkspaceStatus(workspace!, 'frozen', plan), `reconciled-unstarted:${runId}`)
        return { ...this.summarize(plan, []), status: 'ready-to-resume' }
      }

      for (const operation of plan.operations) {
        const record = records.get(operation.operationKey)
        if (!record || record.status === 'succeeded' || isRetryReadyRecord(record)) continue
        if (record.status === 'failed') continue
        records.set(operation.operationKey, await this.reconcileOperation(account, plan, operation, record))
      }

      const run = this.summarize(plan, Array.from(records.values()))
      const status = run.status === 'succeeded'
        ? 'completed'
        : run.status === 'ready-to-resume' || run.status === 'failed'
          ? 'frozen'
          : 'reconciling'
      if (status === 'completed') await this.recordOrganizationProtections(account, plan)
      await this.writeWorkspace(account, withWorkspaceStatus(
        workspace!, status, plan, run.status === 'result-unknown' ? 'result-unknown' : status
      ), `reconciled:${runId}`)
      return run
    }))
  }

  private async drive(accountMid: string, plan: FavoriteRepositoryFrozenSyncPlan): Promise<FavoriteRepositorySyncRun> {
    const snapshot = await this.options.repository.getSnapshot(accountMid)
    const records = this.recordsByOperation(plan, await this.options.repository.getSyncCheckpoints(accountMid, plan.id))
    const automaticRetries = new Set<string>()
    for (let index = 0; index < plan.operations.length; index++) {
      if (this.isStopRequested(accountMid, plan.id)) {
        await this.abandonFrozenPlanUnderLock(accountMid, plan.id)
        return this.summarize(plan, Array.from(records.values()))
      }
      if (this.isPauseRequested(accountMid, plan.id)) {
        await this.pauseFrozenPlanUnderLock(accountMid, plan.id)
        return this.summarize(plan, Array.from(records.values()))
      }
      const operation = plan.operations[index]
      const record = records.get(operation.operationKey)
      if (record?.status === 'succeeded') {
        await this.yieldToEventLoop()
        continue
      }
      if (record?.status === 'failed') return this.summarize(plan, Array.from(records.values()))
      if (record?.status === 'result-unknown' || (record?.status === 'pending' && !isRetryReadyRecord(record))) {
        await this.writeWorkspace(accountMid, withWorkspaceStatus(snapshot.workspace!, 'reconciling', plan, 'result-unknown'), `unknown:${plan.id}`)
        return this.summarize(plan, Array.from(records.values()))
      }

      const completedCount = Array.from(records.values()).filter((current) => current.status === 'succeeded').length
      if (completedCount > 0) await this.sleep(completedCount)
      if (this.isStopRequested(accountMid, plan.id)) {
        await this.abandonFrozenPlanUnderLock(accountMid, plan.id)
        return this.summarize(plan, Array.from(records.values()))
      }
      if (this.isPauseRequested(accountMid, plan.id)) {
        await this.pauseFrozenPlanUnderLock(accountMid, plan.id)
        return this.summarize(plan, Array.from(records.values()))
      }
      const attempt = (record?.attempt ?? 0) + 1
      const activeRequestKey = this.activeRequestKey(accountMid, plan.id, operation.operationKey)
      this.activeRemoteRequests.add(activeRequestKey)
      try {
        records.set(operation.operationKey, await this.writeRecord(accountMid, plan, operation, 'pending', attempt, 'remote-request-started', 'checkpoint'))
        const result = await this.writeToRemote(() => operation.kind === 'append'
          ? this.pageBridge(accountMid, plan.id).append({ accountMid, operationKey: operation.operationKey, aid: operation.aid, folderIds: operation.folderIds })
          : this.pageBridge(accountMid, plan.id).remove({ accountMid, operationKey: operation.operationKey, aid: operation.aid, folderIds: operation.folderIds }))
        this.assertObservedAccount(accountMid, result.observedAccountMid)
        records.set(operation.operationKey, await this.writeRecord(accountMid, plan, operation, 'succeeded', attempt, undefined, 'result'))
        await this.projectConfirmedOperation(accountMid, plan, operation, 'succeeded', attempt)
        await this.yieldToEventLoop()
      } catch (error) {
        const status = isConfirmedRemoteRejection(error) ? 'failed' : 'result-unknown'
        let stoppedRecord = await this.writeRecord(
          accountMid,
          plan,
          operation,
          status,
          attempt,
          error instanceof Error ? error.message : String(error),
          'result'
        )
        records.set(operation.operationKey, stoppedRecord)
        await this.projectConfirmedOperation(accountMid, plan, operation, status, attempt)
        await this.yieldToEventLoop()
        if (status === 'result-unknown') {
          stoppedRecord = await this.reconcileOperation(accountMid, plan, operation, stoppedRecord)
          records.set(operation.operationKey, stoppedRecord)
          if (stoppedRecord.status === 'succeeded') continue
          if (isRetryReadyRecord(stoppedRecord) &&
            (!stoppedRecord.retryAvailableAt || Date.parse(this.now()) >= Date.parse(stoppedRecord.retryAvailableAt)) &&
            !automaticRetries.has(operation.operationKey)) {
            automaticRetries.add(operation.operationKey)
            index--
            continue
          }
        }
        const run = this.summarize(plan, Array.from(records.values()))
        const workspaceStatus = run.status === 'result-unknown' ? 'reconciling' : 'frozen'
        await this.writeWorkspace(accountMid, withWorkspaceStatus(
          snapshot.workspace!, workspaceStatus, plan,
          run.status === 'result-unknown' ? 'result-unknown' : workspaceStatus
        ), `stopped:${plan.id}`)
        return run
      } finally {
        this.activeRemoteRequests.delete(activeRequestKey)
      }
    }

    const complete = this.summarize(plan, Array.from(records.values()))
    await this.recordOrganizationProtections(accountMid, plan)
    await this.writeWorkspace(accountMid, withWorkspaceStatus(snapshot.workspace!, 'completed', plan), `complete:${plan.id}`)
    this.options.pageBridgeManager?.release(accountMid, plan.id)
    return complete
  }

  private async reconcileOperation(
    accountMid: string,
    plan: FavoriteRepositoryFrozenSyncPlan,
    operation: FavoriteRepositoryFrozenSyncOperation,
    record: FavoriteRepositorySyncRecord
  ) {
    const attempt = record.attempt ?? 1
    let result: PageBridgeResult & { members: Record<string, number[]> }
    try {
      result = await this.readMembersForReconciliation(() => this.pageBridge(accountMid, plan.id).readMembers({
        accountMid,
        operationKey: operation.operationKey,
        aid: operation.aid,
        folderIds: operation.folderIds
      }))
      this.assertObservedAccount(accountMid, result.observedAccountMid)
    } catch (error) {
      return this.writeRecord(
        accountMid, plan, operation, 'result-unknown', attempt,
        error instanceof Error ? error.message : String(error), 'reconciled'
      )
    }
    if (!operation.folderIds.every((folderId) => Array.isArray(result.members[folderId]))) {
      return this.writeRecord(accountMid, plan, operation, 'result-unknown', attempt, 'reconciliation-membership-incomplete', 'reconciled')
    }
    const membership = operation.folderIds.map((folderId) => result.members[folderId].includes(operation.aid))
    const allMember = membership.every(Boolean)
    const noMembers = membership.every((value) => !value)
    const desiredState = operation.kind === 'append' ? allMember : noMembers
    const safeToRepeat = operation.kind === 'append' ? noMembers : allMember
    if (desiredState) {
      const reconciled = await this.writeRecord(accountMid, plan, operation, 'succeeded', attempt, 'reconciled-confirmed', 'reconciled')
      await this.projectConfirmedOperation(accountMid, plan, operation, 'succeeded', attempt)
      return reconciled
    }
    if (safeToRepeat) {
      const priorReason = record.reason?.trim()
      const reason = priorReason && priorReason !== retryReadyReason
        ? `${retryReadyReason}; prior=${priorReason}`
        : retryReadyReason
      const retryAvailableAt = isBilibiliRiskControlResponse(priorReason)
        ? new Date(Date.parse(this.now()) + (this.options.riskControlCooldownMs ?? 600_000)).toISOString()
        : attempt >= 3 && priorReason && /invalid-response|remote-timeout|network-failure|page-execution/i.test(priorReason)
          ? new Date(Date.parse(this.now()) + (this.options.retryCooldownMs ?? 30_000)).toISOString()
          : undefined
      return this.writeRecord(accountMid, plan, operation, 'pending', attempt, reason, 'reconciled', retryAvailableAt)
    }
    return this.writeRecord(accountMid, plan, operation, 'result-unknown', attempt, 'reconciled-partial-state', 'reconciled')
  }

  private async recordOrganizationProtections(accountMid: string, plan: FavoriteRepositoryFrozenSyncPlan) {
    const snapshot = await this.options.repository.getSnapshot(accountMid)
    const stagingFolderIds = new Set(snapshot.physicalShards
      .filter((shard) => shard.logicalLedgerId === 'inbox' && shard.remoteFolderId)
      .map((shard) => shard.remoteFolderId!))
    const records = plan.operations.filter((operation) => operation.kind === 'append').flatMap((operation) => {
      const targetFolderIds = operation.folderIds.filter((folderId) => !stagingFolderIds.has(folderId))
      const existing = snapshot.organizationRecords.find((record) => record.aid === operation.aid)
      return targetFolderIds.length ? [{
      accountMid,
      aid: operation.aid,
      targetFolderIds,
      completedAt: this.now(),
      ...(existing?.classificationSource ? { classificationSource: existing.classificationSource } : {})
      }] : []
    })
    if (!records.length) return
    await this.options.repository.commit(accountMid, {
      id: `favorite-sync-protection:${plan.id}`,
      accountMid,
      issuedAt: this.now(),
      type: 'record-organization-protections',
      payload: { records }
    })
  }

  /**
   * Provides the privileged physical-folder adapter used by archive recovery.
   * It derives every target from the current bound-shard inventory; no caller
   * can use this path to target an arbitrary ordinary Bilibili folder.
   */
  createArchiveRestoreWriter(): FavoriteRepositoryRestoreWriter {
    const boundRuns = new Set<string>()
    const runKey = (accountMid: string, restoreId: string) => `${accountMid}:${restoreId}`
    return {
      begin: async ({ accountMid, restoreId }) => {
        const account = normalizeAccountMid(accountMid)
        const key = runKey(account, restoreId)
        if (boundRuns.has(key)) return
        await this.bindPageTarget(account, restoreId)
        boundRuns.add(key)
      },
      finish: async ({ accountMid, restoreId }) => {
        const account = normalizeAccountMid(accountMid)
        const key = runKey(account, restoreId)
        if (!boundRuns.delete(key)) return
        this.options.pageBridgeManager?.release(account, restoreId)
      },
      readBaseline: async ({ accountMid, restoreId, aid }) => {
        const account = normalizeAccountMid(accountMid)
        const snapshot = await this.options.repository.getSnapshot(account)
        const bound = snapshot.physicalShards
          .filter((shard) => shard.bindingState === 'bound' && shard.remoteFolderId)
          .sort((left, right) => left.logicalLedgerId.localeCompare(right.logicalLedgerId) || left.shardNumber - right.shardNumber || left.folderId.localeCompare(right.folderId))
        const logicalLedgerIdsByRemoteFolderId = new Map<string, Set<string>>()
        for (const shard of bound) {
          const remoteFolderId = shard.remoteFolderId!
          let logicalLedgerIds = logicalLedgerIdsByRemoteFolderId.get(remoteFolderId)
          if (!logicalLedgerIds) {
            logicalLedgerIds = new Set<string>()
            logicalLedgerIdsByRemoteFolderId.set(remoteFolderId, logicalLedgerIds)
          }
          logicalLedgerIds.add(shard.logicalLedgerId)
        }
        if ([...logicalLedgerIdsByRemoteFolderId.values()].some((logicalLedgerIds) => logicalLedgerIds.size > 1)) {
          throw new FavoriteRepositoryRemoteRejectedError('Archive restore cannot use a remote folder bound to multiple logical ledgers.')
        }
        const folderIds = [...new Set(bound.map((shard) => shard.remoteFolderId!))]
        const members = folderIds.length
          ? await this.readMembersForReconciliation(() => this.pageBridge(account, restoreId).readMembers({
            accountMid: account, operationKey: `${restoreId}:baseline:${aid}`, aid, folderIds
          }))
          : { observedAccountMid: account, members: {} }
        this.assertObservedAccount(account, members.observedAccountMid)
        const managedPhysicalFolderIdsByLogicalFolderId: Record<string, string[]> = {}
        for (const shard of bound) {
          const logicalId = `bilimi-logical:${shard.logicalLedgerId}`
          ;(managedPhysicalFolderIdsByLogicalFolderId[logicalId] ??= []).push(shard.remoteFolderId!)
        }
        for (const folderIdsForLogical of Object.values(managedPhysicalFolderIdsByLogicalFolderId)) folderIdsForLogical.sort()
        const managedPhysicalFolderMemberCounts = Object.fromEntries(folderIds.map((folderId) => [folderId,
          (members.members[folderId] ?? []).length]))
        return {
          [aid]: {
            managedLogicalFolderIds: Object.keys(managedPhysicalFolderIdsByLogicalFolderId).sort(),
            managedPhysicalFolderIdsByLogicalFolderId,
            managedPhysicalFolderMemberCounts,
            managedObservedPhysicalFolderIds: folderIds.filter((folderId) => (members.members[folderId] ?? []).includes(aid))
          }
        }
      },
      ensurePhysicalCapacity: async ({ accountMid, restoreId, aid, logicalFolderIds }) => {
        const account = normalizeAccountMid(accountMid)
        const snapshot = await this.options.repository.getSnapshot(account)
        const requestedLogicalIds = [...new Set(logicalFolderIds.map((id) => id.trim()).filter(Boolean))].sort()
        const bound = snapshot.physicalShards.filter((shard) => shard.bindingState === 'bound' && shard.remoteFolderId)
        const logicalLedgerIdsByRemoteFolderId = new Map<string, Set<string>>()
        for (const shard of bound) {
          const remoteFolderId = shard.remoteFolderId!
          const logicalLedgerIds = logicalLedgerIdsByRemoteFolderId.get(remoteFolderId) ?? new Set<string>()
          logicalLedgerIds.add(shard.logicalLedgerId)
          logicalLedgerIdsByRemoteFolderId.set(remoteFolderId, logicalLedgerIds)
        }
        if ([...logicalLedgerIdsByRemoteFolderId.values()].some((logicalLedgerIds) => logicalLedgerIds.size > 1)) {
          throw new FavoriteRepositoryRemoteRejectedError('Archive restore cannot use a remote folder bound to multiple logical ledgers.')
        }
        const folderIds = [...new Set(bound.map((shard) => shard.remoteFolderId!))].sort()
        const members = folderIds.length
          ? await this.readMembersForReconciliation(() => this.pageBridge(account, restoreId).readMembers({
            accountMid: account, operationKey: `${restoreId}:capacity:${aid}`, aid, folderIds
          }))
          : { observedAccountMid: account, members: {} }
        this.assertObservedAccount(account, members.observedAccountMid)
        for (const logicalId of requestedLogicalIds) {
          const logicalLedgerId = logicalId.replace(/^bilimi-logical:/, '')
          if (!logicalLedgerId || logicalLedgerId === logicalId) throw new FavoriteRepositoryRemoteRejectedError('Archive restore logical target is invalid.')
          const shards = bound.filter((shard) => shard.logicalLedgerId === logicalLedgerId)
          if (shards.some((shard) => (members.members[shard.remoteFolderId!] ?? []).length < REMOTE_FAVORITE_SHARD_CAPACITY)) continue
          const logical = snapshot.folders.find((folder) => folder.kind === 'bilimi-logical' && folder.logicalLedgerId === logicalLedgerId)
          if (!logical || !this.options.ensurePhysicalShard) {
            throw new FavoriteRepositoryRemoteRejectedError('Archive restore managed capacity is unavailable.')
          }
          const shardNumber = Math.max(0, ...shards.map((shard) => shard.shardNumber)) + 1
          // Binding owns its own per-account arbiter lane. Wrapping it here
          // would enqueue the same operation recursively and deadlock.
          await this.options.ensurePhysicalShard(account, {
            logicalLedgerId,
            logicalTitle: logical.title,
            remoteDisplayTitle: logical.title,
            shardNumber,
            memberAids: [aid]
          })
          await this.options.onPhysicalShardProvisioned?.(account)
        }
      },
      write: async ({ accountMid, restoreId, aid, appendPhysicalFolderIds, removePhysicalFolderIds }) => {
        const account = normalizeAccountMid(accountMid)
        const snapshot = await this.options.repository.getSnapshot(account)
        const bound = snapshot.physicalShards.filter((shard) => shard.bindingState === 'bound' && shard.remoteFolderId)
        const logicalLedgerIdsByRemoteFolderId = new Map<string, Set<string>>()
        for (const shard of bound) {
          const remoteFolderId = shard.remoteFolderId!
          let logicalLedgerIds = logicalLedgerIdsByRemoteFolderId.get(remoteFolderId)
          if (!logicalLedgerIds) {
            logicalLedgerIds = new Set<string>()
            logicalLedgerIdsByRemoteFolderId.set(remoteFolderId, logicalLedgerIds)
          }
          logicalLedgerIds.add(shard.logicalLedgerId)
        }
        if ([...logicalLedgerIdsByRemoteFolderId.values()].some((logicalLedgerIds) => logicalLedgerIds.size > 1)) {
          throw new FavoriteRepositoryRemoteRejectedError('Archive restore cannot use a remote folder bound to multiple logical ledgers.')
        }
        const managedIds = new Set(bound.map((shard) => shard.remoteFolderId!))
        const append = [...new Set(appendPhysicalFolderIds)].filter((folderId) => managedIds.has(folderId)).sort()
        const remove = [...new Set(removePhysicalFolderIds)].filter((folderId) => managedIds.has(folderId)).sort()
        if (append.length !== appendPhysicalFolderIds.length || remove.length !== removePhysicalFolderIds.length) {
          throw new FavoriteRepositoryRemoteRejectedError('Archive restore target is no longer a bound Bilimi folder.')
        }
        const bridge = this.pageBridge(account, restoreId)
        if (append.length) {
          const result = await this.writeToRemote(() => bridge.append({ accountMid: account, operationKey: `${restoreId}:${aid}:append`, aid, folderIds: append }))
          this.assertObservedAccount(account, result.observedAccountMid)
        }
        if (remove.length) {
          const result = await this.writeToRemote(() => bridge.remove({ accountMid: account, operationKey: `${restoreId}:${aid}:remove`, aid, folderIds: remove }))
          this.assertObservedAccount(account, result.observedAccountMid)
        }
      }
    }
  }

  /**
   * Applies already-persisted local intent. Unlike a frozen organization plan,
   * this never changes the workspace and always uses the account arbiter.
   */
  async synchronizePlacements(accountMid: string, requestedAids: number[], classificationAdjustmentIds?: Readonly<Record<number, string>>): Promise<PlacementSyncResult> {
    const account = normalizeAccountMid(accountMid)
    const aids = [...new Set(requestedAids)].sort((left, right) => left - right)
    if (!aids.length || aids.length > 100 || aids.some((aid) => !Number.isSafeInteger(aid) || aid <= 0)) {
      throw new Error('Favorite placement selection is invalid.')
    }
    const run = () => this.synchronizePlacementsNow(account, aids, classificationAdjustmentIds)
    // User initiated batches must share the same serial remote lane as every
    // other Bilibili write; a later per-video intent supersedes only queued work.
    return this.options.remoteOperations
      ? Promise.all(aids.map((aid) => this.options.remoteOperations!.enqueue(account, {
        priority: aids.length === 1 ? 'user-single' : 'bulk', videoKey: `placement:${aid}`
      }, async () => this.synchronizePlacementsNow(account, [aid], classificationAdjustmentIds)))).then((results) => this.mergePlacementResults(results))
      : run()
  }

  /**
   * Starts a collection-library-only run. It reuses `synchronizePlacements`
   * for every item, so Bilibili writes, their durable receipts, and the shared
   * account arbiter all stay in the existing trusted path.
   */
  async startLibraryPlacementRun(accountMid: string, requestedAids: number[]): Promise<FavoriteLibraryPlacementSyncRun> {
    const account = normalizeAccountMid(accountMid)
    const aids = [...new Set(requestedAids)].sort((left, right) => left - right)
    if (!aids.length || aids.length > 100 || aids.some((aid) => !Number.isSafeInteger(aid) || aid <= 0)) {
      throw new Error('Favorite placement selection is invalid.')
    }
    await this.hydrateLibraryPlacementRuns(account)
    const activeId = this.libraryPlacementRunByAccount.get(account)
    const active = activeId ? this.libraryPlacementRuns.get(activeId) : undefined
    if (active?.unknown > 0) {
      throw new Error('Favorite library placement synchronization result is unknown; reconcile it before starting another run.')
    }
    if (active && (active.status === 'running' || active.status === 'paused')) {
      throw new Error('Favorite library placement synchronization is already running.')
    }
    const run: RunningFavoriteLibraryPlacementSyncRun = {
      id: `favorite-library-placement:${randomUUID()}`,
      accountMid: account,
      status: 'running',
      total: aids.length,
      completed: 0,
      failed: 0,
      queued: 0,
      unknown: 0,
      aids,
      nextIndex: 0,
      completedAids: [],
      failedAids: [],
      queuedAids: [],
      unknownAids: [],
      pauseRequested: false,
      stopRequested: false,
      driving: false
    }
    this.libraryPlacementRuns.set(run.id, run)
    this.libraryPlacementRunByAccount.set(account, run.id)
    await this.persistLibraryPlacementRun(run)
    this.driveLibraryPlacementRun(account, run.id)
    return this.libraryPlacementRunSnapshot(run)
  }

  async getLibraryPlacementRun(accountMid: string, runId: string): Promise<FavoriteLibraryPlacementSyncRun> {
    await this.hydrateLibraryPlacementRuns(normalizeAccountMid(accountMid))
    return this.libraryPlacementRunSnapshot(this.libraryPlacementRun(accountMid, runId))
  }

  /** Returns the newest unfinished or unknown-result library batch for this account, if any. */
  async getActiveLibraryPlacementRun(accountMid: string): Promise<FavoriteLibraryPlacementSyncRun | undefined> {
    const account = normalizeAccountMid(accountMid)
    await this.hydrateLibraryPlacementRuns(account)
    const runId = this.libraryPlacementRunByAccount.get(account)
    const run = runId ? this.libraryPlacementRuns.get(runId) : undefined
    return run && (run.status === 'running' || run.status === 'paused' || run.unknown > 0)
      ? this.libraryPlacementRunSnapshot(run)
      : undefined
  }

  async pauseLibraryPlacementRun(accountMid: string, runId: string): Promise<FavoriteLibraryPlacementSyncRun> {
    await this.hydrateLibraryPlacementRuns(normalizeAccountMid(accountMid))
    const run = this.libraryPlacementRun(accountMid, runId)
    if (run.status === 'running') {
      run.pauseRequested = true
      run.status = 'paused'
      await this.persistLibraryPlacementRun(run)
    }
    return this.libraryPlacementRunSnapshot(run)
  }

  async resumeLibraryPlacementRun(accountMid: string, runId: string): Promise<FavoriteLibraryPlacementSyncRun> {
    await this.hydrateLibraryPlacementRuns(normalizeAccountMid(accountMid))
    const run = this.libraryPlacementRun(accountMid, runId)
    if (run.status === 'paused') {
      run.pauseRequested = false
      run.status = 'running'
      await this.persistLibraryPlacementRun(run)
      this.driveLibraryPlacementRun(run.accountMid, run.id)
    }
    return this.libraryPlacementRunSnapshot(run)
  }

  /** Lets an active remote request settle, then abandons only the remaining library items. */
  async stopLibraryPlacementRun(accountMid: string, runId: string): Promise<FavoriteLibraryPlacementSyncRun> {
    await this.hydrateLibraryPlacementRuns(normalizeAccountMid(accountMid))
    const run = this.libraryPlacementRun(accountMid, runId)
    if (run.status === 'running' || run.status === 'paused') {
      run.stopRequested = true
      run.pauseRequested = false
      run.status = 'stopped'
      await this.persistLibraryPlacementRun(run)
    }
    return this.libraryPlacementRunSnapshot(run)
  }

  /** Reconciles only the remote result of a completed library run; it never writes remotely. */
  async reconcileLibraryPlacementRun(accountMid: string, runId: string): Promise<FavoriteLibraryPlacementSyncRun> {
    const account = normalizeAccountMid(accountMid)
    return this.options.remoteOperations
      ? this.options.remoteOperations.run(account, () => this.reconcileLibraryPlacementRunNow(account, runId))
      : this.reconcileLibraryPlacementRunNow(account, runId)
  }

  private async reconcileLibraryPlacementRunNow(account: string, runId: string): Promise<FavoriteLibraryPlacementSyncRun> {
    await this.hydrateLibraryPlacementRuns(account)
    const run = this.libraryPlacementRun(account, runId)
    if (!run.unknownAids.length) return this.libraryPlacementRunSnapshot(run)
    const bridgeRunId = `${run.id}:reconcile:${randomUUID()}`
    await this.bindPageTarget(account, bridgeRunId)
    try {
      const bridge = this.pageBridge(account, bridgeRunId)
      const remainingUnknown: number[] = []
      for (const aid of run.unknownAids) {
        const snapshot = await this.options.repository.getSnapshot(account)
        const placement = snapshot.positions[`${account}:${aid}`]
        if (!placement) {
          remainingUnknown.push(aid)
          continue
        }
        const desiredRemoteIds = [...new Set(placement.localDesiredFolderIds.flatMap((logicalId) => snapshot.physicalShards
          .filter((shard) => `bilimi-logical:${shard.logicalLedgerId}` === logicalId && shard.bindingState === 'bound' && shard.remoteFolderId)
          .map((shard) => shard.remoteFolderId!)))].sort()
        if (!desiredRemoteIds.length) {
          remainingUnknown.push(aid)
          continue
        }
        try {
          const result = await this.readMembersForReconciliation(() => bridge.readMembers({
            accountMid: account,
            operationKey: `${run.id}:reconcile:${aid}`,
            aid,
            folderIds: desiredRemoteIds
          }))
          this.assertObservedAccount(account, result.observedAccountMid)
          if (!desiredRemoteIds.every((folderId) => Array.isArray(result.members[folderId]))) {
            remainingUnknown.push(aid)
            continue
          }
          const membership = desiredRemoteIds.map((folderId) => result.members[folderId].includes(aid))
          if (membership.every(Boolean)) {
            await this.writePlacement(account, placement, {
              remoteObservedPhysicalFolderIds: desiredRemoteIds,
              remoteObservedLogicalFolderIds: [...new Set(placement.localDesiredFolderIds)].sort(),
              positionState: 'aligned', observedAt: this.now(), reason: undefined
            })
            run.completed++
          } else if (membership.every((value) => !value)) {
            await this.writePlacement(account, placement, {
              positionState: 'local-only-change', reason: undefined
            })
          } else {
            remainingUnknown.push(aid)
          }
        } catch {
          remainingUnknown.push(aid)
        }
      }
      run.unknownAids = remainingUnknown
      run.unknown = remainingUnknown.length
      run.status = 'completed'
      await this.persistLibraryPlacementRun(run)
      return this.libraryPlacementRunSnapshot(run)
    } finally {
      this.options.pageBridgeManager?.release(account, bridgeRunId)
    }
  }

  private libraryPlacementRun(accountMid: string, runId: string) {
    const account = normalizeAccountMid(accountMid)
    const run = this.libraryPlacementRuns.get(runId)
    if (!run || run.accountMid !== account) throw new Error('Favorite library placement synchronization was not found.')
    return run
  }

  private libraryPlacementRunSnapshot(run: RunningFavoriteLibraryPlacementSyncRun): FavoriteLibraryPlacementSyncRun {
    const { aids: _aids, nextIndex: _nextIndex, completedAids: _completedAids, failedAids: _failedAids, queuedAids: _queuedAids, unknownAids: _unknownAids, pauseRequested: _pauseRequested, stopRequested: _stopRequested, driving: _driving, ...snapshot } = run
    return { ...snapshot }
  }

  private async hydrateLibraryPlacementRuns(accountMid: string) {
    const account = normalizeAccountMid(accountMid)
    const snapshot = await this.options.repository.getSnapshot(account)
    const checkpoints = Object.values(snapshot.libraryPlacementRuns ?? {})
      .filter((checkpoint) => checkpoint.accountMid === account && !this.libraryPlacementRuns.has(checkpoint.id))
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id))
    for (const checkpoint of checkpoints) {
      const run = this.libraryPlacementRunFromCheckpoint(checkpoint)
      // A renderer/process restart cannot know whether an interrupted remote
      // write reached Bilibili. Never resume that write automatically. A run
      // which had not claimed an aid is safe to pause and let the user resume.
      if (run.status === 'running') {
        if (run.currentAid !== undefined) {
          const interruptedAid = run.currentAid
          run.currentAid = undefined
          run.nextIndex = Math.max(run.nextIndex, run.aids.indexOf(interruptedAid) + 1)
          if (!run.unknownAids.includes(interruptedAid)) run.unknownAids.push(interruptedAid)
          run.unknown = run.unknownAids.length
          run.status = 'completed'
          run.pauseRequested = false
        } else {
          run.status = 'paused'
          run.pauseRequested = true
        }
        await this.persistLibraryPlacementRun(run)
      }
      this.libraryPlacementRuns.set(run.id, run)
      if (run.status === 'running' || run.status === 'paused' || run.unknown > 0) this.libraryPlacementRunByAccount.set(account, run.id)
    }
  }

  private libraryPlacementRunFromCheckpoint(checkpoint: FavoriteLibraryPlacementRunCheckpoint): RunningFavoriteLibraryPlacementSyncRun {
    return {
      id: checkpoint.id,
      accountMid: checkpoint.accountMid,
      status: checkpoint.status,
      total: checkpoint.aids.length,
      completed: checkpoint.completedAids.length,
      failed: checkpoint.failedAids.length,
      queued: checkpoint.queuedAids.length,
      unknown: checkpoint.unknownAids.length,
      ...(checkpoint.currentAid ? { currentAid: checkpoint.currentAid } : {}),
      aids: [...checkpoint.aids],
      nextIndex: checkpoint.nextIndex,
      completedAids: [...checkpoint.completedAids],
      failedAids: [...checkpoint.failedAids],
      queuedAids: [...checkpoint.queuedAids],
      unknownAids: [...checkpoint.unknownAids],
      pauseRequested: checkpoint.status === 'paused',
      stopRequested: checkpoint.status === 'stopped',
      driving: false
    }
  }

  private async persistLibraryPlacementRun(run: RunningFavoriteLibraryPlacementSyncRun) {
    const checkpoint: FavoriteLibraryPlacementRunCheckpoint = {
      id: run.id,
      accountMid: run.accountMid,
      status: run.status,
      aids: [...run.aids],
      nextIndex: run.nextIndex,
      completedAids: [...run.completedAids],
      failedAids: [...run.failedAids],
      queuedAids: [...run.queuedAids],
      unknownAids: [...run.unknownAids],
      ...(run.currentAid ? { currentAid: run.currentAid } : {}),
      updatedAt: this.now()
    }
    await this.options.repository.commit(run.accountMid, {
      // Checkpoints can legitimately repeat the same visible state after a
      // restart (for example, a paused run being rehydrated).  Repository
      // command IDs are append-only identities, not state keys.
      id: `favorite-library-placement-run:${run.id}:${randomUUID()}`,
      accountMid: run.accountMid,
      issuedAt: checkpoint.updatedAt,
      type: 'record-library-placement-run',
      payload: checkpoint
    })
    this.publishLibraryPlacementRun(run)
  }

  private publishLibraryPlacementRun(run: RunningFavoriteLibraryPlacementSyncRun) {
    this.options.onLibraryPlacementRunChanged?.(this.libraryPlacementRunSnapshot(run))
  }

  private driveLibraryPlacementRun(accountMid: string, runId: string) {
    const run = this.libraryPlacementRuns.get(runId)
    if (!run || run.accountMid !== accountMid || run.driving || run.status !== 'running') return
    run.driving = true
    void (async () => {
      try {
        // Return to Electron before claiming the first remote queue item. This
        // gives the renderer a chance to paint feedback and process Pause.
        await this.yieldToEventLoop()
        while (run.nextIndex < run.aids.length) {
          if (run.stopRequested) {
            run.status = 'stopped'
            await this.persistLibraryPlacementRun(run)
            return
          }
          if (run.pauseRequested) {
            run.status = 'paused'
            await this.persistLibraryPlacementRun(run)
            return
          }
          const aid = run.aids[run.nextIndex]
          run.currentAid = aid
          await this.persistLibraryPlacementRun(run)
          try {
            const result = await this.synchronizePlacements(accountMid, [aid])
            if (result.status === 'succeeded') {
              run.completed += result.completedOperationCount
              run.completedAids.push(aid)
            } else if (result.status === 'queued') {
              run.queued++
              run.queuedAids.push(aid)
            } else if (result.status === 'result-unknown') {
              run.unknown++
              run.unknownAids.push(aid)
            } else {
              run.failed++
              run.failedAids.push(aid)
            }
          } catch {
            // Existing placement synchronization has already persisted the
            // corresponding failure/unknown projection when it can. The run
            // records this item as failed without inventing a remote receipt.
            run.failed++
            run.failedAids.push(aid)
          } finally {
            run.currentAid = undefined
            run.nextIndex++
            await this.persistLibraryPlacementRun(run)
          }
          if (run.unknown) {
            // An ambiguous write must not be followed by another remote write.
            run.status = 'completed'
            await this.persistLibraryPlacementRun(run)
            return
          }
          await this.yieldToEventLoop()
        }
        if (!run.stopRequested && !run.pauseRequested) {
          run.status = 'completed'
          await this.persistLibraryPlacementRun(run)
        }
      } finally {
        run.driving = false
        if (run.stopRequested) {
          run.status = 'stopped'
          await this.persistLibraryPlacementRun(run)
        } else if (run.pauseRequested) {
          run.status = 'paused'
          await this.persistLibraryPlacementRun(run)
        }
      }
    })()
  }

  private async synchronizePlacementsNow(account: string, aids: number[], classificationAdjustmentIds?: Readonly<Record<number, string>>): Promise<PlacementSyncResult> {
    const snapshot = await this.options.repository.getSnapshot(account)
    const runId = `favorite-placement:${randomUUID()}`
    await this.bindPageTarget(account, runId)
    let completed = 0
    let status: PlacementSyncResult['status'] = 'succeeded'
    try {
      const bridge = this.pageBridge(account, runId)
      for (const aid of aids) {
        const current = await this.options.repository.getSnapshot(account)
        const placement = current.positions[`${account}:${aid}`]
        if (!placement) {
          status = 'failed'
          continue
        }
        const linkedAdjustmentId = classificationAdjustmentIds?.[aid]?.trim()
        if (linkedAdjustmentId && !current.classificationAdjustments.some((record) => record.id === linkedAdjustmentId && record.aid === aid)) {
          throw new Error('Favorite placement classification adjustment is unavailable.')
        }
        const queuedAdjustmentId = linkedAdjustmentId || `favorite-placement-sync:${runId}:${aid}`
        if (linkedAdjustmentId) {
          await this.writeClassificationAdjustmentSyncStatus(account, queuedAdjustmentId, 'queued')
        } else {
        await this.options.repository.commit(account, {
          id: `favorite-placement-sync-audit:${runId}:${aid}`,
          accountMid: account,
          issuedAt: this.now(),
          type: 'record-classification-adjustments',
          payload: { records: [{
            id: queuedAdjustmentId, accountMid: account, aid, occurredAt: this.now(), operation: 'synchronize-bilibili',
            ...(deriveFavoriteRepositoryClassificationSource(current.videos[String(aid)] ?? { lastAdjustment: undefined }) ? { classificationSource: deriveFavoriteRepositoryClassificationSource(current.videos[String(aid)] ?? { lastAdjustment: undefined }) } : {}),
            beforeFolderIds: [...placement.localDesiredFolderIds], afterFolderIds: [...placement.localDesiredFolderIds],
            addedToLibrary: placement.localDesiredFolderIds.length > 0, bilibiliSync: { attempted: true, status: 'queued' }
          }] }
        })
        }
        const desiredLogicalIds = new Set(placement.localDesiredFolderIds)
      // A logical warehouse can be represented by several physical shards, but
      // a local placement means membership of the warehouse, not duplication in
      // every shard. Prefer an already observed shard for continuity; otherwise
      // choose the stable first bound shard. Capacity reconciliation/creation is
      // handled by the managed-folder execution path before a shard is bound.
        const desiredShards = [...desiredLogicalIds].flatMap((logicalId) => {
        const candidates = current.physicalShards
          .filter((shard) => `bilimi-logical:${shard.logicalLedgerId}` === logicalId &&
            shard.bindingState === 'bound' && shard.remoteFolderId)
          .sort((left, right) => left.shardNumber - right.shardNumber || left.folderId.localeCompare(right.folderId))
        const retained = candidates.find((shard) => placement.remoteObservedPhysicalFolderIds.includes(shard.remoteFolderId!))
        return retained ?? candidates[0] ? [retained ?? candidates[0]] : []
        })
        const resolvedLogicalIds = new Set(desiredShards.map((shard) => `bilimi-logical:${shard.logicalLedgerId}`))
        if (resolvedLogicalIds.size !== desiredLogicalIds.size) {
        await this.writePlacement(account, placement, {
          positionState: 'target-missing', reason: 'logical-target-unbound'
        })
        await this.writeClassificationAdjustmentSyncStatus(account, queuedAdjustmentId, 'failed')
        status = 'failed'
          continue
        }
        const desiredRemoteIds = [...new Set(desiredShards.map((shard) => shard.remoteFolderId!))].sort()
        const observedRemoteIds = [...new Set(placement.remoteObservedPhysicalFolderIds)].sort()
        if (!desiredLogicalIds.size && !observedRemoteIds.length) {
          await this.writePlacement(account, placement, {
            positionState: 'target-missing', reason: 'logical-target-unbound'
          })
          await this.writeClassificationAdjustmentSyncStatus(account, queuedAdjustmentId, 'failed')
          status = 'failed'
          continue
        }
        const appendIds = desiredRemoteIds.filter((folderId) => !observedRemoteIds.includes(folderId))
        const removeIds = observedRemoteIds.filter((folderId) => !desiredRemoteIds.includes(folderId) &&
        current.physicalShards.some((shard) => shard.remoteFolderId === folderId && shard.bindingState === 'bound'))
        await this.writePlacement(account, placement, { positionState: 'syncing', reason: undefined })
        try {
        if (appendIds.length) {
          const result = await this.writeToRemote(() => bridge.append({ accountMid: account, operationKey: `${runId}:${aid}:append`, aid, folderIds: appendIds }))
          this.assertObservedAccount(account, result.observedAccountMid)
        }
        if (removeIds.length) {
          const result = await this.writeToRemote(() => bridge.remove({ accountMid: account, operationKey: `${runId}:${aid}:remove`, aid, folderIds: removeIds }))
          this.assertObservedAccount(account, result.observedAccountMid)
        }
        await this.writePlacement(account, placement, {
          remoteObservedPhysicalFolderIds: desiredRemoteIds,
          remoteObservedLogicalFolderIds: [...desiredLogicalIds],
          positionState: 'aligned', observedAt: this.now(), reason: undefined
        })
        await this.options.repository.commit(account, {
          id: `favorite-placement-sync-receipt:${runId}:${aid}`,
          accountMid: account,
          issuedAt: this.now(),
          type: 'record-sync-result',
          payload: {
            id: `favorite-placement-sync-receipt:${runId}:${aid}`,
            commandId: `favorite-placement-sync-receipt:${runId}:${aid}`,
            status: 'succeeded',
            affectedAids: [aid],
            targetFolderIds: [...desiredLogicalIds],
            updatedAt: this.now(),
            runId,
            operationKey: `placement:${aid}`,
            attempt: 1
          }
        })
        await this.writeClassificationAdjustmentSyncStatus(account, queuedAdjustmentId, 'succeeded')
        completed++
        } catch (error) {
        const knownFailure = isConfirmedRemoteRejection(error)
        await this.writePlacement(account, placement, {
          positionState: knownFailure ? 'failed' : 'result-unknown',
          reason: error instanceof Error ? error.message : String(error)
        })
        await this.writeClassificationAdjustmentSyncStatus(account, queuedAdjustmentId, knownFailure ? 'failed' : 'result-unknown')
        status = knownFailure ? 'failed' : 'result-unknown'
        // An unknown response cannot be followed by more writes in this user batch.
          if (!knownFailure) break
        }
      }
    } finally {
      this.options.pageBridgeManager?.release(account, runId)
    }
    return { status, completedOperationCount: completed, totalOperationCount: aids.length, affectedAids: aids }
  }

  private async writeClassificationAdjustmentSyncStatus(
    accountMid: string,
    adjustmentId: string,
    status: NonNullable<FavoriteRepositoryClassificationAdjustment['bilibiliSync']['status']>
  ) {
    await this.options.repository.commit(accountMid, {
      id: `favorite-placement-sync-audit-result:${adjustmentId}:${randomUUID()}`,
      accountMid, issuedAt: this.now(), type: 'update-classification-adjustment-sync', payload: { adjustmentId, status }
    })
  }

  private mergePlacementResults(results: PlacementSyncResult[]): PlacementSyncResult {
    const affectedAids = [...new Set(results.flatMap((result) => result.affectedAids))].sort((left, right) => left - right)
    return {
      status: results.some((result) => result.status === 'result-unknown') ? 'result-unknown'
        : results.some((result) => result.status === 'failed') ? 'failed'
          : results.some((result) => result.status === 'queued') ? 'queued' : 'succeeded' as const,
      completedOperationCount: results.reduce((total, result) => total + result.completedOperationCount, 0),
      totalOperationCount: affectedAids.length,
      affectedAids
    }
  }

  private async writePlacement(
    account: string,
    prior: AccountFavoriteRepositorySnapshot['positions'][string],
    change: Partial<Pick<AccountFavoriteRepositorySnapshot['positions'][string],
      'remoteObservedPhysicalFolderIds' | 'remoteObservedLogicalFolderIds' | 'positionState' | 'observedAt' | 'reason'>>
  ) {
    await this.options.repository.commit(account, {
      id: `favorite-placement-projection:${account}:${prior.aid}:${randomUUID()}`,
      accountMid: account, issuedAt: this.now(), type: 'set-favorite-placement',
      payload: {
        aid: prior.aid, localDesiredFolderIds: [...prior.localDesiredFolderIds],
        remoteObservedPhysicalFolderIds: change.remoteObservedPhysicalFolderIds ?? [...prior.remoteObservedPhysicalFolderIds],
        remoteObservedLogicalFolderIds: change.remoteObservedLogicalFolderIds ?? [...prior.remoteObservedLogicalFolderIds],
        positionState: change.positionState ?? prior.positionState,
        ...(change.observedAt !== undefined ? { observedAt: change.observedAt } : prior.observedAt ? { observedAt: prior.observedAt } : {}),
        ...(change.reason !== undefined ? { reason: change.reason } : prior.reason ? { reason: prior.reason } : {}),
        updatedAt: this.now()
      }
    })
  }

  async deleteManagedFolders(
    accountMid: string,
    logicalLedgerIds: string[],
    acknowledgeUnboundRemoteDeletion = false,
    ledgerTitleHints?: Record<string, string>,
    expectedRemoteFolderIds?: Record<string, string[]>
  ) {
    const account = normalizeAccountMid(accountMid)
    return this.runRemote(account, async () => {
      const requestedLedgerIds = new Set(logicalLedgerIds.map((id) => id.trim()).filter(Boolean))
      if (!requestedLedgerIds.size) throw new Error('Managed folder deletion selection is empty.')
      const runId = `favorite-delete:${this.now()}`
      await this.bindPageTarget(account, runId)
      try {
        const bridge = this.pageBridge(account, runId)
        const remoteDeletion = await this.deleteManagedRemoteFoldersWithBridge(
          account, requestedLedgerIds, bridge, runId, acknowledgeUnboundRemoteDeletion, ledgerTitleHints, expectedRemoteFolderIds
        )
        if (remoteDeletion.status !== 'succeeded') {
          const locallyBoundRemoteFolderIds = new Set(remoteDeletion.candidates
            .filter((candidate) => candidate.state === 'bound' || candidate.state === 'missing-remote')
            .flatMap((candidate) => candidate.remoteFolderId ? [candidate.remoteFolderId] : []))
          for (const remoteFolderId of remoteDeletion.succeededRemoteFolderIds.filter((id) => locallyBoundRemoteFolderIds.has(id))) {
            await this.options.repository.commit(account, {
              id: `favorite-remove-confirmed-remote-binding:${randomUUID()}`,
              accountMid: account,
              issuedAt: this.now(),
              type: 'remove-physical-shard-binding',
              payload: { remoteFolderId }
            })
          }
          if (remoteDeletion.succeededRemoteFolderIds.length) {
            await this.options.onConfirmedRemoteFolderMutation?.(account)
          }
          return remoteDeletion
        }
        const { candidates } = remoteDeletion
        const confirmedRemoteFolderIds = new Set(remoteDeletion.succeededRemoteFolderIds)
        const snapshot = await this.options.repository.getSnapshot(account)
        const localLedgerIds = new Set(snapshot.folders
          .filter((folder) => folder.kind === 'bilimi-logical' && folder.logicalLedgerId)
          .map((folder) => folder.logicalLedgerId!))
        const candidatesByLedgerId = new Map<string, ManagedFavoriteFolderDeletionCandidate[]>()
        for (const candidate of candidates) {
          const grouped = candidatesByLedgerId.get(candidate.logicalLedgerId) ?? []
          grouped.push(candidate)
          candidatesByLedgerId.set(candidate.logicalLedgerId, grouped)
        }
        const localLedgerIdsToDelete = new Set<string>()
        for (const [logicalLedgerId, ledgerCandidates] of candidatesByLedgerId) {
          localLedgerIdsToDelete.add(logicalLedgerId)
        }
        // Commit the local projection only after every requested remote target has
        // succeeded or been confirmed absent. A single batch command keeps a
        // multi-folder deletion atomic even if one remote target failed earlier.
        const logicalFolderIdsToDelete = [...localLedgerIdsToDelete]
          .filter((logicalLedgerId) => localLedgerIds.has(logicalLedgerId))
          .map((logicalLedgerId) => `bilimi-logical:${logicalLedgerId}`)
          .sort()
        if (logicalFolderIdsToDelete.length) {
          await this.options.repository.commit(account, {
            id: `favorite-delete-local:${randomUUID()}`,
            accountMid: account,
            issuedAt: this.now(),
            type: 'delete-local-managed-folders',
            payload: {
              logicalFolderIds: logicalFolderIdsToDelete,
              ...(confirmedRemoteFolderIds.size ? { confirmedRemoteFolderIds: [...confirmedRemoteFolderIds].sort() } : {})
            }
          })
        }
        if (remoteDeletion.succeededRemoteFolderIds.length) {
          await this.options.onConfirmedRemoteFolderMutation?.(account)
        }
        return remoteDeletion
      } finally {
        this.options.pageBridgeManager?.release(account, runId)
      }
    })
  }

  /** Deletes verified Bilibili folders only; the collection-library projection remains untouched. */
  async deleteManagedRemoteFolders(
    accountMid: string,
    logicalLedgerIds: string[],
    acknowledgeUnboundRemoteDeletion = false,
    ledgerTitleHints?: Record<string, string>,
    expectedRemoteFolderIds?: Record<string, string[]>,
    remoteDraftTargets?: ManagedFavoriteRemoteDraftDeletionTargets,
    historicalBindingTargets?: ManagedFavoriteHistoricalBindingDeletionTargets
  ) {
    const account = normalizeAccountMid(accountMid)
    return this.runRemote(account, async () => {
      const requestedLedgerIds = new Set(logicalLedgerIds.map((id) => id.trim()).filter(Boolean))
      const normalizedRemoteDraftTargets = normalizedRemoteDraftDeletionTargets(remoteDraftTargets)
      const normalizedHistoricalBindingTargets = normalizedHistoricalBindingDeletionTargets(historicalBindingTargets)
      if (!requestedLedgerIds.size && !normalizedRemoteDraftTargets.length && !normalizedHistoricalBindingTargets.length) throw new Error('Managed folder deletion selection is empty.')
      const runId = `favorite-remote-delete:${this.now()}`
      await this.bindPageTarget(account, runId)
      try {
        const result = await this.deleteManagedRemoteFoldersWithBridge(
          account,
          requestedLedgerIds,
          this.pageBridge(account, runId),
          runId,
          acknowledgeUnboundRemoteDeletion,
          ledgerTitleHints,
          expectedRemoteFolderIds,
          normalizedRemoteDraftTargets,
          normalizedHistoricalBindingTargets
        )
        // This entry point deliberately preserves the logical work folder, but
        // every confirmed Bilibili deletion must stop being a bound shard before
        // the user can retry the remaining remote folders.
        const locallyBoundRemoteFolderIds = new Set(result.candidates
          .filter((candidate) => candidate.state === 'bound' || candidate.state === 'missing-remote')
          .flatMap((candidate) => candidate.remoteFolderId ? [candidate.remoteFolderId] : []))
        for (const remoteFolderId of result.succeededRemoteFolderIds.filter((id) => locallyBoundRemoteFolderIds.has(id))) {
          await this.options.repository.commit(account, {
            id: `${runId}:remove-confirmed-binding:${remoteFolderId}`,
            accountMid: account,
            issuedAt: this.now(),
            type: 'remove-physical-shard-binding',
            payload: { remoteFolderId }
          })
        }
        if (result.succeededRemoteFolderIds.length) {
          await this.options.onConfirmedRemoteFolderMutation?.(account)
        }
        return result
      } finally {
        this.options.pageBridgeManager?.release(account, runId)
      }
    })
  }

  private async deleteManagedRemoteFoldersWithBridge(
    account: string,
    requestedLedgerIds: Set<string>,
    bridge: FavoriteRepositoryPageBridge,
    runId: string,
    acknowledgeUnboundRemoteDeletion: boolean,
    ledgerTitleHints?: Record<string, string>,
    expectedRemoteFolderIds?: Record<string, string[]>,
    remoteDraftTargets: Array<{ logicalLedgerId: string; remoteFolderId: string; title: string }> = [],
    historicalBindingTargets: Array<{ logicalLedgerId: string; remoteFolderId: string; title: string }> = []
  ): Promise<ManagedFavoriteRemoteFolderDeletionResult> {
    const candidates = await this.managedFolderDeletionCandidates(account, requestedLedgerIds, bridge, `${runId}:verify`, ledgerTitleHints, remoteDraftTargets, historicalBindingTargets)
    if (expectedRemoteFolderIds !== undefined) {
      const expectedLedgerIds = new Set([
        ...requestedLedgerIds,
        ...remoteDraftTargets.map((target) => target.logicalLedgerId),
        ...historicalBindingTargets.map((target) => target.logicalLedgerId)
      ])
      for (const logicalLedgerId of expectedLedgerIds) {
        const expected = [...new Set((expectedRemoteFolderIds[logicalLedgerId] ?? []).map((id) => id.trim()).filter(Boolean))].sort()
        const actual = [...new Set(candidates
          .filter((candidate) => candidate.logicalLedgerId === logicalLedgerId && candidate.remoteFolderId &&
            (candidate.state !== 'unbound-name-match' || remoteDraftTargets.some((target) =>
              target.logicalLedgerId === candidate.logicalLedgerId && target.remoteFolderId === candidate.remoteFolderId)))
          .map((candidate) => candidate.remoteFolderId!))].sort()
        if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) {
          throw new Error('managed-folder-deletion-preview-stale')
        }
      }
    }
    const deletionCandidates = candidates.filter((candidate) => candidate.state !== 'unbound-name-match' ||
      remoteDraftTargets.some((target) => target.logicalLedgerId === candidate.logicalLedgerId && target.remoteFolderId === candidate.remoteFolderId))
    if (deletionCandidates.some((candidate) => candidate.requiresUnboundAcknowledgement) && !acknowledgeUnboundRemoteDeletion) {
      throw new Error('unbound-managed-folder-deletion-acknowledgement-required')
    }
    const confirmedRemoteFolderIds = new Set<string>()
    const deletedRemoteFolderIds = new Set<string>()
    let confirmedRemoteDeleteCount = 0
    for (const candidate of deletionCandidates) {
      if (!candidate.remoteFolderId || deletedRemoteFolderIds.has(candidate.remoteFolderId)) continue
      if (candidate.state === 'missing-remote') {
        confirmedRemoteFolderIds.add(candidate.remoteFolderId)
        deletedRemoteFolderIds.add(candidate.remoteFolderId)
        continue
      }
      try {
        // Bilibili folder deletion is a remote write just like placement sync;
        // do not burst a batch through the same page session.
        if (confirmedRemoteDeleteCount > 0) await this.sleep(confirmedRemoteDeleteCount)
        const result = await bridge.deleteFolder({ accountMid: account, operationKey: `${runId}:delete:${candidate.remoteFolderId}`, folderId: candidate.remoteFolderId })
        this.assertObservedAccount(account, result.observedAccountMid)
        if (result.status && result.status !== 'ok') {
          const diagnostics = [
            result.reason?.trim() || `remote-delete-${result.status}`,
            Number.isSafeInteger(result.httpStatus) ? `http-status=${result.httpStatus}` : '',
            result.contentType?.trim() ? `content-type=${result.contentType.trim()}` : '',
            result.responseCategory ? `response-category=${result.responseCategory}` : '',
            Number.isSafeInteger(result.bilibiliCode) ? `bilibili-code=${result.bilibiliCode}` : ''
          ].filter(Boolean)
          const error = new Error(diagnostics.join('; '))
          if (result.status === 'rejected') Object.assign(error, { remoteWriteRejected: true })
          if (result.status === 'unknown') Object.assign(error, { remoteWriteResultUnknown: true })
          throw error
        }
        deletedRemoteFolderIds.add(candidate.remoteFolderId)
        confirmedRemoteFolderIds.add(candidate.remoteFolderId)
        confirmedRemoteDeleteCount++
      } catch (error) {
        const outcome = error instanceof Error && 'remoteWriteRejected' in error
          ? 'failed'
          : 'result-unknown'
        if (outcome === 'result-unknown') {
          try {
            const reconciliation = await bridge.readFolderInventory({
              accountMid: account,
              operationKey: `${runId}:reconcile:${candidate.remoteFolderId}`
            })
            this.assertObservedAccount(account, reconciliation.observedAccountMid)
            if (!reconciliation.folders.some((folder) => folder.id === candidate.remoteFolderId)) {
              deletedRemoteFolderIds.add(candidate.remoteFolderId)
              confirmedRemoteFolderIds.add(candidate.remoteFolderId)
              confirmedRemoteDeleteCount++
              continue
            }
          } catch {
            // Keep the result unknown when the post-write directory check is unavailable.
          }
        }
        const failedRemoteFolderIds = outcome === 'failed' ? [candidate.remoteFolderId] : []
        const unknownRemoteFolderIds = outcome === 'result-unknown' ? [candidate.remoteFolderId] : []
        const attemptedRemoteFolderIds = new Set([...confirmedRemoteFolderIds, ...failedRemoteFolderIds, ...unknownRemoteFolderIds])
        return {
          status: confirmedRemoteFolderIds.size ? 'partial-failed' : outcome === 'failed' ? 'failed' : 'result-unknown',
          candidates,
          succeededRemoteFolderIds: [...confirmedRemoteFolderIds].sort(),
          failedRemoteFolderIds,
          unknownRemoteFolderIds,
          unattemptedRemoteFolderIds: [...new Set(deletionCandidates
            .map((entry) => entry.remoteFolderId)
            .filter((remoteFolderId): remoteFolderId is string => Boolean(remoteFolderId && !attemptedRemoteFolderIds.has(remoteFolderId))))]
            .sort(),
          failures: [{
            logicalLedgerId: candidate.logicalLedgerId,
            remoteFolderId: candidate.remoteFolderId,
            title: candidate.title,
            outcome,
            message: error instanceof Error && error.message ? error.message : 'remote-folder-delete-failed'
          }]
        }
      }
    }
    return {
      status: 'succeeded',
      candidates,
      succeededRemoteFolderIds: [...confirmedRemoteFolderIds].sort(),
      failedRemoteFolderIds: [],
      unknownRemoteFolderIds: [],
      unattemptedRemoteFolderIds: [],
      failures: []
    }
  }

  async previewManagedFolderDeletion(
    accountMid: string,
    logicalLedgerIds: string[],
    ledgerTitleHints?: Record<string, string>,
    remoteDraftTargets?: ManagedFavoriteRemoteDraftDeletionTargets,
    historicalBindingTargets?: ManagedFavoriteHistoricalBindingDeletionTargets
  ) {
    const account = normalizeAccountMid(accountMid)
    return this.runRemote(account, async () => {
      const requestedLedgerIds = new Set(logicalLedgerIds.map((id) => id.trim()).filter(Boolean))
      const normalizedRemoteDraftTargets = normalizedRemoteDraftDeletionTargets(remoteDraftTargets)
      const normalizedHistoricalBindingTargets = normalizedHistoricalBindingDeletionTargets(historicalBindingTargets)
      if (!requestedLedgerIds.size && !normalizedRemoteDraftTargets.length && !normalizedHistoricalBindingTargets.length) throw new Error('Managed folder deletion selection is empty.')
      const runId = `favorite-delete-preview:${this.now()}`
      await this.bindPageTarget(account, runId)
      try {
        const candidates = await this.managedFolderDeletionCandidates(
          account, requestedLedgerIds, this.pageBridge(account, runId), `${runId}:inventory`, ledgerTitleHints, normalizedRemoteDraftTargets, normalizedHistoricalBindingTargets
        )
        return candidates
      } finally {
        this.options.pageBridgeManager?.release(account, runId)
      }
    })
  }

  private async verifiedManagedFolders(
    account: string,
    requestedLedgerIds: Set<string>,
    bridge: FavoriteRepositoryPageBridge,
    operationKey: string
  ) {
    const snapshot = await this.options.repository.getSnapshot(account)
    const targets = snapshot.physicalShards.filter((shard) =>
      shard.bindingState === 'bound' && shard.remoteFolderId && requestedLedgerIds.has(shard.logicalLedgerId)
    )
    const inventory = await bridge.readFolderInventory({ accountMid: account, operationKey })
    if (normalizeAccountMid(inventory.observedAccountMid) !== account) throw new Error('Favorite repository remote account mismatch.')
    const foldersById = new Map(inventory.folders.map((folder) => [folder.id, folder]))
    return targets.map((shard) => {
      const folder = foldersById.get(shard.remoteFolderId!)
      if (!folder || folder.title !== shard.remoteTitle) throw new Error('favorite-repository-binding-title-stale')
      return { shard, folder }
    })
  }

  private async managedFolderDeletionCandidates(
    account: string,
    requestedLedgerIds: Set<string>,
    bridge: FavoriteRepositoryPageBridge,
    operationKey: string,
    ledgerTitleHints?: Record<string, string>,
    remoteDraftTargets: Array<{ logicalLedgerId: string; remoteFolderId: string; title: string }> = [],
    historicalBindingTargets: Array<{ logicalLedgerId: string; remoteFolderId: string; title: string }> = []
  ): Promise<ManagedFavoriteFolderDeletionCandidate[]> {
    const snapshot = await this.options.repository.getSnapshot(account)
    const inventory = await bridge.readFolderInventory({ accountMid: account, operationKey })
    if (normalizeAccountMid(inventory.observedAccountMid) !== account) {
      throw new Error('Favorite repository remote account mismatch.')
    }
    const foldersById = new Map(inventory.folders.map((folder) => [folder.id, folder]))
    const results: ManagedFavoriteFolderDeletionCandidate[] = []
    for (const logicalLedgerId of requestedLedgerIds) {
      const logicalFolder = snapshot.folders.find((folder) =>
        folder.kind === 'bilimi-logical' && folder.logicalLedgerId === logicalLedgerId)
      const shards = snapshot.physicalShards.filter((shard) => shard.logicalLedgerId === logicalLedgerId)
      const physicalTargets = shards.flatMap((shard) => {
        const knownRemoteFolderIds = shard.remoteFolderId
          ? [shard.remoteFolderId]
          : [...new Set((shard.knownRemoteFolderIds ?? []).map((id) => id.trim()).filter(Boolean))]
        return knownRemoteFolderIds.length === 1
          ? [{ ...shard, remoteFolderId: knownRemoteFolderIds[0] }]
          : []
      })
      if (physicalTargets.length > 0) {
        for (const shard of physicalTargets) {
          const folder = foldersById.get(shard.remoteFolderId!)
          if (!folder) {
            results.push({
              logicalLedgerId,
              remoteFolderId: shard.remoteFolderId,
              title: shard.remoteTitle,
              memberCount: 0,
              state: 'missing-remote',
              requiresUnboundAcknowledgement: false
            })
            continue
          }
          if (folder.title !== shard.remoteTitle) throw new Error('favorite-repository-binding-title-stale')
          results.push({
            logicalLedgerId,
            remoteFolderId: folder.id,
            title: folder.title,
            memberCount: folder.memberCount,
            state: shard.bindingState === 'bound' ? 'bound' : 'unbound-historical-id',
            requiresUnboundAcknowledgement: shard.bindingState !== 'bound'
          })
        }
        const expectedTitle = logicalFolder?.title ?? ledgerTitleHints?.[logicalLedgerId]?.trim() ?? physicalTargets[0]?.remoteTitle
        const claimedPhysicalFolderIds = new Set(physicalTargets.map((shard) => shard.remoteFolderId!))
        const unboundMatches = expectedTitle
          ? inventory.folders.filter((folder) => isBilimiRemoteFolder(folder.title) &&
            matchesManagedRemoteFolderTitle(folder.title, expectedTitle) &&
            !claimedPhysicalFolderIds.has(folder.id))
          : []
        for (const folder of unboundMatches) {
          results.push({
            logicalLedgerId,
            remoteFolderId: folder.id,
            title: folder.title,
            memberCount: folder.memberCount,
            state: 'unbound-name-match',
            requiresUnboundAcknowledgement: true
          })
        }
        continue
      }

      // A historical ID is accepted only when the renderer explicitly carries
      // it into this deletion flow.  It is checked by exact ID against the
      // fresh inventory; title matching is deliberately bypassed so a stale
      // A stale historical title can never make a different folder deletable.
      const historicalForLedger = historicalBindingTargets.filter((target) => target.logicalLedgerId === logicalLedgerId)
      if (historicalForLedger.length) {
        for (const target of historicalForLedger) {
          const folder = foldersById.get(target.remoteFolderId)
          results.push(folder
            ? {
                logicalLedgerId,
                remoteFolderId: folder.id,
                title: folder.title,
                memberCount: folder.memberCount,
                state: 'unbound-historical-id',
                requiresUnboundAcknowledgement: true
              }
            : {
                logicalLedgerId,
                remoteFolderId: target.remoteFolderId,
                title: target.title,
                memberCount: 0,
                state: 'missing-remote',
                requiresUnboundAcknowledgement: false
              })
        }
        continue
      }

      const expectedTitle = logicalFolder?.title ?? ledgerTitleHints?.[logicalLedgerId]?.trim() ?? shards[0]?.remoteTitle
      const matches = expectedTitle
        ? inventory.folders.filter((folder) => isBilimiRemoteFolder(folder.title) &&
          matchesManagedRemoteFolderTitle(folder.title, expectedTitle))
        : []
      if (matches.length > 0) {
        for (const folder of matches) {
          results.push({
            logicalLedgerId,
            remoteFolderId: folder.id,
            title: folder.title,
            memberCount: folder.memberCount,
            state: 'unbound-name-match',
            requiresUnboundAcknowledgement: true
          })
        }
      } else {
        results.push({
          logicalLedgerId,
          title: expectedTitle ?? logicalLedgerId,
          memberCount: 0,
          state: 'local-only',
          requiresUnboundAcknowledgement: false
        })
      }
    }
    const claimedRemoteFolderIds = new Set(results
      .map((candidate) => candidate.remoteFolderId)
      .filter((remoteFolderId): remoteFolderId is string => Boolean(remoteFolderId)))
    for (const target of remoteDraftTargets) {
      const folder = foldersById.get(target.remoteFolderId)
      if (!folder || claimedRemoteFolderIds.has(target.remoteFolderId) || !isBilimiRemoteFolder(folder.title) ||
        normalizedRemoteFolderTitle(folder.title) !== normalizedRemoteFolderTitle(target.title)) {
        throw new Error('remote-draft-deletion-preview-stale')
      }
      claimedRemoteFolderIds.add(folder.id)
      results.push({
        logicalLedgerId: target.logicalLedgerId,
        remoteFolderId: folder.id,
        title: folder.title,
        memberCount: folder.memberCount,
        state: 'unbound-name-match',
        requiresUnboundAcknowledgement: true
      })
    }
    return results
  }

  /** Applies only a confirmed remote fact to the local warehouse projection. */
  private async projectConfirmedOperation(
    accountMid: string,
    plan: FavoriteRepositoryFrozenSyncPlan,
    operation: FavoriteRepositoryFrozenSyncOperation,
    status: FavoriteRepositoryOrganizationChange['status'],
    attempt = 1
  ) {
    const beforeFolderIds = [...new Set(operation.beforeFolderIds ?? [])].sort()
    const afterFolderIds = status === 'succeeded'
      ? operation.kind === 'append'
        ? [...new Set([...beforeFolderIds, ...operation.folderIds])].sort()
        : beforeFolderIds.filter((folderId) => !operation.folderIds.includes(folderId))
      : beforeFolderIds
    const change: FavoriteRepositoryOrganizationChange = {
      id: `${plan.id}:${operation.operationKey}:${status}:${attempt}`,
      runId: plan.id,
      workspaceId: plan.workspaceId,
      accountMid,
      aid: operation.aid,
      beforeFolderIds,
      afterFolderIds,
      addedFolderIds: afterFolderIds.filter((folderId) => !beforeFolderIds.includes(folderId)),
      removedFolderIds: beforeFolderIds.filter((folderId) => !afterFolderIds.includes(folderId)),
      status,
      recordedAt: this.now()
    }
    await this.options.repository.commit(accountMid, {
      id: `favorite-sync-projection:${change.id}`,
      accountMid,
      issuedAt: this.now(),
      type: 'record-organization-change',
      payload: { change }
    })
    if (operation.classificationAdjustmentId) {
      await this.writeFrozenPlanClassificationAdjustmentSyncStatus(accountMid, plan, operation.classificationAdjustmentId)
    }
  }

  private async writeFrozenPlanClassificationAdjustmentSyncStatus(
    accountMid: string,
    plan: FavoriteRepositoryFrozenSyncPlan,
    adjustmentId: string
  ) {
    const records = this.recordsByOperation(plan, await this.options.repository.getSyncCheckpoints(accountMid, plan.id))
    const related = plan.operations.filter((operation) => operation.classificationAdjustmentId === adjustmentId)
      .map((operation) => records.get(operation.operationKey)?.status)
    const status = related.every((current) => current === 'succeeded')
      ? 'succeeded'
      : related.some((current) => current === 'failed')
        ? 'failed'
        : related.some((current) => current === 'result-unknown')
          ? 'result-unknown'
          : 'queued'
    await this.writeClassificationAdjustmentSyncStatus(accountMid, adjustmentId, status)
  }

  private async writeWorkspace(accountMid: string, workspace: FavoriteRepositoryWorkspace, suffix: string) {
    await this.options.repository.commit(accountMid, {
      id: `favorite-sync-workspace:${workspace.id}:${suffix}`,
      accountMid,
      issuedAt: this.now(),
      type: 'set-workspace',
      payload: workspace
    })
  }

  private async writeRecord(
    accountMid: string,
    plan: FavoriteRepositoryFrozenSyncPlan,
    operation: FavoriteRepositoryFrozenSyncOperation,
    status: SyncRecordStatus,
    attempt: number,
    reason: string | undefined,
    checkpoint: string,
    retryAvailableAt?: string
  ) {
    const record: FavoriteRepositorySyncRecord = {
      id: `${plan.id}:${operation.operationKey}`,
      commandId: `${plan.id}:${operation.operationKey}`,
      status,
      affectedAids: [operation.aid],
      updatedAt: this.now(),
      ...(reason ? { reason } : {}),
      runId: plan.id,
      operationKey: operation.operationKey,
      targetFolderIds: [...operation.folderIds],
      attempt,
      ...(retryAvailableAt ? { retryAvailableAt } : {})
    }
    await this.options.repository.recordSyncCheckpoint(
      accountMid,
      `favorite-sync-record:${plan.id}:${operation.operationKey}:${checkpoint}:${status}:${attempt}`,
      record
    )
    return record
  }

  private summarize(plan: FavoriteRepositoryFrozenSyncPlan, records: FavoriteRepositorySyncRecord[]): FavoriteRepositorySyncRun {
    const byOperation = this.recordsByOperation(plan, records)
    const completedOperationCount = plan.operations.filter((operation) => byOperation.get(operation.operationKey)?.status === 'succeeded').length
    const statuses = plan.operations.map((operation) => byOperation.get(operation.operationKey))
    const retryReadyRecord = statuses.find(isRetryReadyRecord)
    const retryFailureIsCurrent = Boolean(retryReadyRecord?.reason) && (
      !retryReadyRecord?.retryAvailableAt || Date.parse(this.now()) < Date.parse(retryReadyRecord.retryAvailableAt)
    )
    const status: SyncRunStatus = completedOperationCount === plan.operations.length
      ? 'succeeded'
      : statuses.some((record) => record?.status === 'result-unknown' || (record?.status === 'pending' && !record.reason?.startsWith(retryReadyReason) &&
        !this.activeRemoteRequests.has(this.activeRequestKey(plan.accountMid, plan.id, record.operationKey ?? ''))))
        ? 'result-unknown'
        : statuses.some((record) => record?.status === 'failed')
          ? 'failed'
          : retryReadyRecord
            ? 'ready-to-resume'
            : 'running'
    return {
      id: plan.id,
      accountMid: plan.accountMid,
      workspaceId: plan.workspaceId,
      status,
      completedOperationCount,
      totalOperationCount: plan.operations.length,
      ...(retryFailureIsCurrent ? { lastFailureReason: retryReadyRecord!.reason!.replace(/^reconciled-absent-ready-to-retry; prior=/, '') } : {}),
      ...(retryFailureIsCurrent && retryReadyRecord?.retryAvailableAt ? { retryAvailableAt: retryReadyRecord.retryAvailableAt } : {})
    }
  }

  private activeRequestKey(accountMid: string, runId: string, operationKey: string) {
    return `${normalizeAccountMid(accountMid)}:${runId}:${operationKey}`
  }

  private runKey(accountMid: string, runId: string) {
    return `${normalizeAccountMid(accountMid)}:${runId}`
  }

  private isStopRequested(accountMid: string, runId: string) {
    return this.stopRequestedRuns.has(this.runKey(accountMid, runId))
  }

  private isPauseRequested(accountMid: string, runId: string) {
    return this.pauseRequestedRuns.has(this.runKey(accountMid, runId))
  }

  private async pauseFrozenPlanUnderLock(accountMid: string, expectedPlanId: string) {
    const current = await this.options.repository.getSnapshot(accountMid)
    const workspace = current.workspace
    const plan = workspace?.frozenSyncPlan
    if (!workspace || !plan || plan.id !== expectedPlanId || workspace.status !== 'executing') return false
    await this.writeWorkspace(accountMid, withWorkspaceStatus(workspace, 'frozen', plan, 'sync-paused'), `pause:${plan.id}`)
    this.claimedExecutionRuns.delete(this.runKey(accountMid, plan.id))
    if (this.executingPlanIds.get(accountMid) === plan.id) this.executingPlanIds.delete(accountMid)
    this.options.pageBridgeManager?.release(accountMid, plan.id)
    return true
  }

  private async abandonFrozenPlanUnderLock(accountMid: string, expectedPlanId: string) {
    const current = await this.options.repository.getSnapshot(accountMid)
    const workspace = current.workspace
    const plan = workspace?.frozenSyncPlan
    if (!workspace || !plan || plan.id !== expectedPlanId || workspace.status === 'completed') return false
    await this.options.repository.commit(accountMid, {
      id: `favorite-sync-abandon:${workspace.id}:${plan.id}`,
      accountMid,
      issuedAt: this.now(),
      type: 'abandon-frozen-workspace',
      payload: { workspaceId: workspace.id, frozenPlanId: plan.id }
    })
    this.claimedExecutionRuns.delete(this.runKey(accountMid, plan.id))
    if (this.executingPlanIds.get(accountMid) === plan.id) this.executingPlanIds.delete(accountMid)
    this.options.pageBridgeManager?.release(accountMid, plan.id)
    return true
  }

  private recordsByOperation(plan: FavoriteRepositoryFrozenSyncPlan, records: FavoriteRepositorySyncRecord[]) {
    return new Map(records
      .filter((record) => record.runId === plan.id && record.operationKey)
      .map((record) => [record.operationKey!, record]))
  }

  private planForRun(workspace: FavoriteRepositoryWorkspace | undefined, runId: string, accountMid: string) {
    const plan = workspace?.frozenSyncPlan
    if (!plan || plan.id !== runId || plan.accountMid !== accountMid) throw new Error('Favorite sync run was not found.')
    return plan
  }

  private assertObservedAccount(expectedAccountMid: string, observedAccountMid: string) {
    if (normalizeAccountMid(observedAccountMid) !== expectedAccountMid) {
      throw new Error('Favorite sync page bridge account changed during execution.')
    }
  }

  private now() {
    return this.options.now?.() ?? new Date().toISOString()
  }

  private async sleep(completedCount: number) {
    const milliseconds = this.options.pacingMs ?? this.legacyPacingMilliseconds(completedCount)
    if (milliseconds <= 0) return
    if (this.options.sleep) return this.options.sleep(milliseconds)
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
  }

  private async yieldToEventLoop() {
    if (this.options.yieldToEventLoop) {
      await this.options.yieldToEventLoop()
      return
    }
    await new Promise<void>((resolve) => setImmediate(resolve))
  }

  private legacyPacingMilliseconds(_completedCount: number) {
    const range = { min: 1_200, max: 2_000 }
    const random = Math.max(0, Math.min(1, this.options.random?.() ?? Math.random()))
    return range.min + Math.floor(random * (range.max - range.min + 1))
  }

  private async withRunLock<T>(accountMid: string, runId: string, operation: () => Promise<T>) {
    const key = `${accountMid}:${runId}`
    const previous = this.runTails.get(key) ?? Promise.resolve()
    let release: (() => void) | undefined
    const current = new Promise<void>((resolve) => { release = resolve })
    const tail = previous.then(() => current)
    this.runTails.set(key, tail)
    await previous
    try {
      return await operation()
    } finally {
      release?.()
      if (this.runTails.get(key) === tail) this.runTails.delete(key)
    }
  }

  private async runRemote<T>(accountMid: string, operation: () => Promise<T>) {
    return this.options.remoteOperations?.run(accountMid, operation) ?? operation()
  }
}
