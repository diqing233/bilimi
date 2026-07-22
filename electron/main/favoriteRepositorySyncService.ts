import {
  createAccountFavoriteRepositorySnapshot,
  type FavoriteRepositoryFrozenSyncOperation,
  type FavoriteRepositoryFrozenSyncPlan,
  type FavoriteRepositoryOrganizationChange,
  type FavoriteRepositorySyncRecord,
  type FavoriteRepositoryWorkspace
} from '../../src/shared/favoriteRepository'
import { FavoriteRepositoryService } from './favoriteRepositoryService'
import type { FavoriteRepositoryRemoteOperationArbiter } from './favoriteRepositoryRemoteOperationArbiter'

export type FrozenFavoriteSyncPlan = FavoriteRepositoryFrozenSyncPlan

type SyncRunStatus = 'ready-to-resume' | 'running' | 'result-unknown' | 'failed' | 'succeeded'

export type FavoriteRepositorySyncRun = {
  id: string
  accountMid: string
  workspaceId: string
  status: SyncRunStatus
  completedOperationCount: number
  totalOperationCount: number
}

type PageBridgeResult = { observedAccountMid: string }
export type FavoriteRepositoryRemoteFolder = { id: string; title: string; memberCount: number }

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
  createFolder(input: { accountMid: string; operationKey: string; title: string }): Promise<PageBridgeResult & { folder: FavoriteRepositoryRemoteFolder }>
  deleteFolder(input: { accountMid: string; operationKey: string; folderId: string }): Promise<PageBridgeResult>
}

export type FavoriteRepositoryPageBridgeManager = {
  bind(accountMid: string, runId: string): Promise<void>
  pageBridge(accountMid: string, runId: string): FavoriteRepositoryPageBridge
  release(accountMid: string, runId: string): void
}

type SyncRecordStatus = FavoriteRepositorySyncRecord['status']

const retryReadyReason = 'reconciled-absent-ready-to-retry'

function normalizeAccountMid(accountMid: string) {
  return createAccountFavoriteRepositorySnapshot({
    accountMid,
    now: '1970-01-01T00:00:00.000Z'
  }).accountMid
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
  frozenSyncPlan: FavoriteRepositoryFrozenSyncPlan
): FavoriteRepositoryWorkspace {
  return {
    ...workspace,
    status,
    workspaceRef: { ...workspace.workspaceRef, status },
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

  constructor(private readonly options: {
    repository: FavoriteRepositoryService
    pageBridge?: FavoriteRepositoryPageBridge
    createPageBridge?: (runId: string) => FavoriteRepositoryPageBridge
    pageBridgeManager?: FavoriteRepositoryPageBridgeManager
    now?: () => string
    sleep?: (milliseconds: number) => Promise<void>
    pacingMs?: number
    random?: () => number
    remoteOperations?: FavoriteRepositoryRemoteOperationArbiter
    reconciliationReadTimeoutMs?: number
    remoteWriteTimeoutMs?: number
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

  /** Discards only the local execution plan; already completed remote writes remain untouched. */
  async abandonFrozenPlan(accountMid: string): Promise<void> {
    const account = normalizeAccountMid(accountMid)
    await this.runRemote(account, async () => {
      const { workspace } = await this.options.repository.getSnapshot(account)
      const plan = workspace?.frozenSyncPlan
      if (!workspace || !plan) return
      await this.withRunLock(account, plan.id, async () => {
        const current = await this.options.repository.getSnapshot(account)
        const currentPlan = current.workspace?.frozenSyncPlan
        if (!current.workspace || !currentPlan) return
        await this.options.repository.commit(account, {
          id: `favorite-sync-abandon:${current.workspace.id}:${currentPlan.id}`,
          accountMid: account,
          issuedAt: this.now(),
          type: 'abandon-frozen-workspace',
          payload: { workspaceId: current.workspace.id, frozenPlanId: currentPlan.id }
        })
        this.claimedExecutionRuns.delete(`${account}:${currentPlan.id}`)
        this.options.pageBridgeManager?.release(account, currentPlan.id)
      })
    })
  }

  /** Persists the user-confirmed execution boundary before any remote bind begins. */
  async claimFrozenPlan(accountMid: string, frozenPlan: FrozenFavoriteSyncPlan): Promise<FavoriteRepositorySyncRun> {
    const account = normalizeAccountMid(accountMid)
    const plan = clonePlan(frozenPlan)
    return this.runRemote(account, async () => this.withRunLock(account, plan.id, async () => {
      const { workspace } = await this.options.repository.getSnapshot(account)
      if (!workspace || workspace.id !== plan.workspaceId || JSON.stringify(workspace.frozenSyncPlan) !== JSON.stringify(plan)) {
        throw new Error('Favorite sync plan does not match the frozen workspace.')
      }
      const run = this.summarize(plan, await this.options.repository.getSyncCheckpoints(account, plan.id))
      if (workspace.status === 'frozen') {
        await this.writeWorkspace(account, withWorkspaceStatus(workspace, 'executing', plan), `claim:${plan.id}`)
        this.claimedExecutionRuns.add(`${account}:${plan.id}`)
      }
      return run
    }))
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
              return this.drive(account, workspace.frozenSyncPlan)
            } catch (error) {
              await this.writeWorkspace(account, withWorkspaceStatus(workspace, 'reconciling', workspace.frozenSyncPlan), `bind-failed:${plan.id}`)
              throw error
            }
          }
          // A restored/existing run is never rebound here. Callers must use
          // explicit reconciliation before deciding whether it may continue.
          if (workspace.status === 'executing' && existingRun.status === 'result-unknown') {
            await this.writeWorkspace(account, withWorkspaceStatus(workspace, 'reconciling', workspace.frozenSyncPlan), `interrupted-unknown:${plan.id}`)
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
        return this.drive(account, workspace.frozenSyncPlan)
      }
      await this.bindPageTarget(account, plan.id)
      await this.writeWorkspace(account, withWorkspaceStatus(workspace, 'executing', plan), `freeze:${plan.id}`)
      return this.drive(account, plan)
    }))
  }

  async getRun(accountMid: string, runId: string): Promise<FavoriteRepositorySyncRun> {
    const account = normalizeAccountMid(accountMid)
    const { workspace } = await this.options.repository.getSnapshot(account)
    const plan = workspace?.frozenSyncPlan
    if (!plan || plan.id !== runId) throw new Error('Favorite sync run was not found.')
    return this.summarize(plan, await this.options.repository.getSyncCheckpoints(account, runId))
  }

  async resume(accountMid: string, runId: string): Promise<FavoriteRepositorySyncRun> {
    const account = normalizeAccountMid(accountMid)
    return this.runRemote(account, async () => this.withRunLock(account, runId, async () => {
      const { workspace } = await this.options.repository.getSnapshot(account)
      const plan = this.planForRun(workspace, runId, account)
      const run = this.summarize(plan, await this.options.repository.getSyncCheckpoints(account, runId))
      if (run.status === 'result-unknown' || run.status === 'failed' || run.status === 'succeeded') return run
      await this.writeWorkspace(account, withWorkspaceStatus(workspace!, 'executing', plan), `resume:${runId}`)
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
      if (!record || record.status === 'succeeded' || (record.status === 'pending' && record.reason === retryReadyReason)) continue
      if (record.status === 'failed') continue
      let result: PageBridgeResult & { members: Record<string, number[]> }
      try {
        result = await this.readMembersForReconciliation(() => this.pageBridge(account, plan.id).readMembers({
          accountMid: account,
          operationKey: operation.operationKey,
          aid: operation.aid,
          folderIds: operation.folderIds
        }))
      } catch (error) {
        records.set(operation.operationKey, await this.writeRecord(
          account,
          plan,
          operation,
          'result-unknown',
          record.attempt ?? 1,
          error instanceof Error ? error.message : String(error),
          'reconciled'
        ))
        continue
      }
      try {
        this.assertObservedAccount(account, result.observedAccountMid)
      } catch (error) {
        records.set(operation.operationKey, await this.writeRecord(
          account,
          plan,
          operation,
          'result-unknown',
          record.attempt ?? 1,
          error instanceof Error ? error.message : String(error),
          'reconciled'
        ))
        continue
      }
      if (!operation.folderIds.every((folderId) => Array.isArray(result.members[folderId]))) {
        records.set(operation.operationKey, await this.writeRecord(account, plan, operation, 'result-unknown', record.attempt ?? 1, 'reconciliation-membership-incomplete', 'reconciled'))
        continue
      }
      const membership = operation.folderIds.map((folderId) => result.members[folderId]?.includes(operation.aid) === true)
      const allMember = membership.every(Boolean)
      const noMembers = membership.every((value) => !value)
      const desiredState = operation.kind === 'append' ? allMember : noMembers
      const safeToRepeat = operation.kind === 'append' ? noMembers : allMember
      const attempt = record.attempt ?? 1
      if (desiredState) {
        records.set(operation.operationKey, await this.writeRecord(account, plan, operation, 'succeeded', attempt, 'reconciled-confirmed', 'reconciled'))
        await this.projectConfirmedOperation(account, plan, operation, 'succeeded')
      } else if (safeToRepeat) {
        records.set(operation.operationKey, await this.writeRecord(account, plan, operation, 'pending', attempt, retryReadyReason, 'reconciled'))
      } else {
        records.set(operation.operationKey, await this.writeRecord(account, plan, operation, 'result-unknown', attempt, 'reconciled-partial-state', 'reconciled'))
      }
      }

      const run = this.summarize(plan, Array.from(records.values()))
      const status = run.status === 'succeeded'
        ? 'completed'
        : run.status === 'ready-to-resume' || run.status === 'failed'
          ? 'frozen'
          : 'reconciling'
      if (status === 'completed') await this.recordOrganizationProtections(account, plan)
      await this.writeWorkspace(account, withWorkspaceStatus(workspace!, status, plan), `reconciled:${runId}`)
      return run
    }))
  }

  private async drive(accountMid: string, plan: FavoriteRepositoryFrozenSyncPlan): Promise<FavoriteRepositorySyncRun> {
    const snapshot = await this.options.repository.getSnapshot(accountMid)
    const records = this.recordsByOperation(plan, await this.options.repository.getSyncCheckpoints(accountMid, plan.id))
    for (let index = 0; index < plan.operations.length; index++) {
      const operation = plan.operations[index]
      const record = records.get(operation.operationKey)
      if (record?.status === 'succeeded') continue
      if (record?.status === 'failed') return this.summarize(plan, Array.from(records.values()))
      if (record?.status === 'result-unknown' || (record?.status === 'pending' && record.reason !== retryReadyReason)) {
        await this.writeWorkspace(accountMid, withWorkspaceStatus(snapshot.workspace!, 'reconciling', plan), `unknown:${plan.id}`)
        return this.summarize(plan, Array.from(records.values()))
      }

      const completedCount = Array.from(records.values()).filter((current) => current.status === 'succeeded').length
      if (completedCount > 0) await this.sleep(completedCount)
      const attempt = (record?.attempt ?? 0) + 1
      records.set(operation.operationKey, await this.writeRecord(accountMid, plan, operation, 'pending', attempt, 'remote-request-started', 'checkpoint'))
      try {
        const result = await this.writeToRemote(() => operation.kind === 'append'
          ? this.pageBridge(accountMid, plan.id).append({ accountMid, operationKey: operation.operationKey, aid: operation.aid, folderIds: operation.folderIds })
          : this.pageBridge(accountMid, plan.id).remove({ accountMid, operationKey: operation.operationKey, aid: operation.aid, folderIds: operation.folderIds }))
        this.assertObservedAccount(accountMid, result.observedAccountMid)
        records.set(operation.operationKey, await this.writeRecord(accountMid, plan, operation, 'succeeded', attempt, undefined, 'result'))
        await this.projectConfirmedOperation(accountMid, plan, operation, 'succeeded')
      } catch (error) {
        const status = isConfirmedRemoteRejection(error) ? 'failed' : 'result-unknown'
        records.set(operation.operationKey, await this.writeRecord(
          accountMid,
          plan,
          operation,
          status,
          attempt,
          error instanceof Error ? error.message : String(error),
          'result'
        ))
        await this.projectConfirmedOperation(accountMid, plan, operation, status)
        const run = this.summarize(plan, Array.from(records.values()))
        await this.writeWorkspace(accountMid, withWorkspaceStatus(
          snapshot.workspace!, run.status === 'result-unknown' ? 'reconciling' : 'frozen', plan
        ), `stopped:${plan.id}`)
        return run
      }
    }

    const complete = this.summarize(plan, Array.from(records.values()))
    await this.recordOrganizationProtections(accountMid, plan)
    await this.writeWorkspace(accountMid, withWorkspaceStatus(snapshot.workspace!, 'completed', plan), `complete:${plan.id}`)
    this.options.pageBridgeManager?.release(accountMid, plan.id)
    return complete
  }

  private async recordOrganizationProtections(accountMid: string, plan: FavoriteRepositoryFrozenSyncPlan) {
    const snapshot = await this.options.repository.getSnapshot(accountMid)
    const stagingFolderIds = new Set(snapshot.physicalShards
      .filter((shard) => shard.logicalLedgerId === 'inbox' && shard.remoteFolderId)
      .map((shard) => shard.remoteFolderId!))
    const records = plan.operations.filter((operation) => operation.kind === 'append').flatMap((operation) => {
      const targetFolderIds = operation.folderIds.filter((folderId) => !stagingFolderIds.has(folderId))
      return targetFolderIds.length ? [{
      accountMid,
      aid: operation.aid,
      targetFolderIds,
      completedAt: this.now()
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

  async deleteManagedFolders(accountMid: string, logicalLedgerIds: string[]) {
    const account = normalizeAccountMid(accountMid)
    return this.runRemote(account, async () => {
      const requestedLedgerIds = new Set(logicalLedgerIds.map((id) => id.trim()).filter(Boolean))
      const runId = `favorite-delete:${this.now()}`
      await this.bindPageTarget(account, runId)
      try {
        const bridge = this.pageBridge(account, runId)
        const verified = await this.verifiedManagedFolders(account, requestedLedgerIds, bridge, `${runId}:verify`)
        for (const { shard, folder } of verified) {
          await bridge.deleteFolder({ accountMid: account, operationKey: `${runId}:delete:${folder.id}`, folderId: folder.id })
          await this.options.repository.commit(account, {
            id: `favorite-delete:${folder.id}`,
            accountMid: account,
            issuedAt: this.now(),
            type: 'remove-physical-shard-binding',
            payload: { remoteFolderId: shard.remoteFolderId! }
          })
        }
        return verified.map(({ folder }) => folder)
      } finally {
        this.options.pageBridgeManager?.release(account, runId)
      }
    })
  }

  async previewManagedFolderDeletion(accountMid: string, logicalLedgerIds: string[]) {
    const account = normalizeAccountMid(accountMid)
    return this.runRemote(account, async () => {
      const requestedLedgerIds = new Set(logicalLedgerIds.map((id) => id.trim()).filter(Boolean))
      const runId = `favorite-delete-preview:${this.now()}`
      await this.bindPageTarget(account, runId)
      try {
        const verified = await this.verifiedManagedFolders(
          account, requestedLedgerIds, this.pageBridge(account, runId), `${runId}:inventory`
        )
        return verified.map(({ shard, folder }) => ({ logicalLedgerId: shard.logicalLedgerId, ...folder }))
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
      if (!folder || folder.title !== shard.remoteTitle) throw new Error('Favorite repository remote folder verification failed.')
      return { shard, folder }
    })
  }

  /** Applies only a confirmed remote fact to the local warehouse projection. */
  private async projectConfirmedOperation(
    accountMid: string,
    plan: FavoriteRepositoryFrozenSyncPlan,
    operation: FavoriteRepositoryFrozenSyncOperation,
    status: FavoriteRepositoryOrganizationChange['status']
  ) {
    const beforeFolderIds = [...new Set(operation.beforeFolderIds ?? [])].sort()
    const afterFolderIds = status === 'succeeded'
      ? operation.kind === 'append'
        ? [...new Set([...beforeFolderIds, ...operation.folderIds])].sort()
        : beforeFolderIds.filter((folderId) => !operation.folderIds.includes(folderId))
      : beforeFolderIds
    const change: FavoriteRepositoryOrganizationChange = {
      id: `${plan.id}:${operation.operationKey}:${status}`,
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
    checkpoint: string
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
      attempt
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
    const status: SyncRunStatus = completedOperationCount === plan.operations.length
      ? 'succeeded'
      : statuses.some((record) => record?.status === 'result-unknown' || (record?.status === 'pending' && record.reason !== retryReadyReason))
        ? 'result-unknown'
        : statuses.some((record) => record?.status === 'failed')
          ? 'failed'
          : statuses.some((record) => record?.status === 'pending' && record.reason === retryReadyReason)
            ? 'ready-to-resume'
            : 'running'
    return {
      id: plan.id,
      accountMid: plan.accountMid,
      workspaceId: plan.workspaceId,
      status,
      completedOperationCount,
      totalOperationCount: plan.operations.length
    }
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

  private legacyPacingMilliseconds(completedCount: number) {
    const accelerated = completedCount > 50
    const cooldownEvery = accelerated ? 60 : 25
    const cooldown = completedCount > 0 && completedCount % cooldownEvery === 0
    const range = cooldown
      ? (accelerated ? { min: 10_000, max: 20_000 } : { min: 15_000, max: 45_000 })
      : (accelerated ? { min: 600, max: 1_400 } : { min: 1_200, max: 3_000 })
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
