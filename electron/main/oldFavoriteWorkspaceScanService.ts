import type { OldFavoriteWorkspaceMode, OldFavoriteWorkspaceSnapshot } from '../../src/shared/oldFavoriteWorkspace'
import { OldFavoriteWorkspaceCoordinator } from './oldFavoriteWorkspaceCoordinator'
import type { FavoriteRepositoryRemoteOperationArbiter } from './favoriteRepositoryRemoteOperationArbiter'

type ScanTarget = { webContentsId: number; instanceId: string; navigationEpoch: number }
type RuntimeInventoryResult = {
  status: 'ok' | 'rejected' | 'unknown'
  observedAccountMid: string
  reason?: string
  target?: ScanTarget
  folders?: Array<{ id: string; title: string; mediaCount: number }>
  members?: Record<string, number[]>
  items?: Array<{ aid: number; title: string; upperName: string; cover: string; addedAt: number; tags: string[]; category: string; unavailable: boolean }>
  hasMore?: boolean
  aid?: number
  tags?: string[]
  httpStatus?: number
  contentType?: string
  bilibiliCode?: number
  responseCategory?: string
}

type RuntimeRequest =
  | { type: 'old-favorite-workspace-bind-scan-target'; accountMid: string }
  | { type: 'old-favorite-workspace-inventory'; accountMid: string; target: ScanTarget }
  | { type: 'old-favorite-workspace-read-source-page'; accountMid: string; target: ScanTarget; folderId: string; page: number; pageSize: number }
  | { type: 'old-favorite-workspace-read-video-tags'; accountMid: string; target: ScanTarget; aid: number }
  | { type: 'old-favorite-workspace-read-managed-members'; accountMid: string; target: ScanTarget; folderIds: string[] }

type PersistedScanResumeState = {
  runId: string
  completedPages: Array<{ folderId: string; page: number; hasMore?: boolean }>
  taggedAids: number[]
}

function normalizeAccountMid(value: string) {
  return /^\d+$/.test(value.trim()) && BigInt(value.trim()) > 0n ? BigInt(value.trim()).toString() : ''
}

function isBilimiWorkFolder(title: string) {
  return /^bilimi(?:[^\\p{L}\\p{N}]|$)/iu.test(title.trim())
}

function isRecoverableTagReadFailure(result: RuntimeInventoryResult, accountMid: string) {
  return result.status === 'unknown' && normalizeAccountMid(result.observedAccountMid) === normalizeAccountMid(accountMid) &&
    /^(?:remote-api-|network-failure|invalid-response)/.test(result.reason ?? '')
}

function tagReadFailureReason(result: RuntimeInventoryResult) {
  return diagnosticFailureReason(result, 'tag-read-failed')
}

function isTargetLifecycleFailure(result: RuntimeInventoryResult) {
  return result.status === 'unknown' && /^(?:target-navigated|target-unavailable|target-loading)$/.test(result.reason ?? '')
}

function diagnosticFailureReason(result: RuntimeInventoryResult, fallback: string) {
  const reason = result.reason?.trim() || fallback
  const diagnostics = [
    result.responseCategory ? `category=${result.responseCategory.slice(0, 64)}` : '',
    Number.isSafeInteger(result.httpStatus) ? `http=${result.httpStatus}` : '',
    Number.isSafeInteger(result.bilibiliCode) ? `bilibili=${result.bilibiliCode}` : '',
    result.contentType ? `content-type=${result.contentType.slice(0, 120)}` : ''
  ].filter(Boolean)
  return diagnostics.length ? `${reason} [${diagnostics.join(' ')}]` : reason
}

function shouldProbeExpiredRiskControl(state: { reason: string; retryAvailableAt: string } | null, now: string) {
  if (!state) return false
  return /(?:http=|http-status=)412/i.test(state.reason) &&
    /category=(?:non-json|html)|response-category=html|content-type=text\/html/i.test(state.reason) &&
    Date.parse(now) >= Date.parse(state.retryAvailableAt)
}

/** Runs a fixed, read-only inventory against the explicitly bound Bilibili tab. */
export class OldFavoriteWorkspaceScanService {
  private destructiveMaintenance = false
  private readonly activeWork = new Set<Promise<unknown>>()
  private readonly activeScans = new Map<string, {
    mode: OldFavoriteWorkspaceMode
    snapshot: Promise<OldFavoriteWorkspaceSnapshot>
  }>()
  private readonly enrichmentRuns = new Map<string, {
    target: ScanTarget
    workspaceId: string
    successor?: { target: ScanTarget; workspaceId: string }
  }>()

  constructor(private readonly options: {
    coordinator: OldFavoriteWorkspaceCoordinator & {
      recordTagEnrichmentFailure?: (accountMid: string, aid: number, reason: string, expectedWorkspaceId?: string) => Promise<boolean>
    }
    requestRuntime: (request: RuntimeRequest) => Promise<RuntimeInventoryResult>
    remoteOperations?: FavoriteRepositoryRemoteOperationArbiter
    /** A full reorganization replaces the workspace, so its old DeepSeek run must stop after its current request. */
    cancelDeepSeek?: (accountMid: string) => boolean
    tagRetryDelayMs?: number
    inventoryRetryDelayMs?: number
    recoveryStabilizationDelayMs?: number
    sourcePageDelayMinMs?: number
    sourcePageDelayMaxMs?: number
    sourcePageBatchSize?: number
    sourcePageBatchPauseMs?: number
    wait?: (milliseconds: number) => Promise<void>
    random?: () => number
    now?: () => string
  }) {}

  private track<T>(work: Promise<T>) {
    this.activeWork.add(work)
    void work.finally(() => this.activeWork.delete(work))
    return work
  }

  private assertAcceptingWork() {
    if (this.destructiveMaintenance) {
      throw new Error('Old favorite workspace scan is unavailable during destructive maintenance.')
    }
  }

  /** Fences new work and waits until every invalidated read has settled. */
  async quiesceForDestructiveMaintenance() {
    this.destructiveMaintenance = true
    this.activeScans.clear()
    this.enrichmentRuns.clear()
    while (this.activeWork.size) {
      const pending = [...this.activeWork]
      await Promise.allSettled(pending)
      // `finally` removes each tracked promise on the next microtask.
      await Promise.resolve()
    }
  }

  resumeAfterDestructiveMaintenance() {
    this.destructiveMaintenance = false
  }

  private request(accountMid: string, request: RuntimeRequest) {
    const work = () => this.options.requestRuntime(request)
    return this.options.remoteOperations?.run(accountMid, work) ?? work()
  }

  private waitForTagRequest() {
    const milliseconds = 650 + Math.floor((this.options.random?.() ?? Math.random()) * 350)
    return this.options.wait?.(milliseconds) ?? new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
  }

  private async tagRequestStillCurrent(accountMid: string, workspaceId: string) {
    const snapshot = await this.options.coordinator.getSnapshot(accountMid)
    if (!snapshot || 'recovery' in snapshot) return false
    return snapshot.workspaceId === workspaceId && snapshot.tagEnrichment?.status === 'running'
  }

  private waitForInventoryRetry() {
    const milliseconds = this.options.inventoryRetryDelayMs ?? 750
    return this.options.wait?.(milliseconds) ?? new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
  }

  private waitForRecoveryStabilization() {
    const milliseconds = this.options.recoveryStabilizationDelayMs ?? 3_000
    return this.options.wait?.(milliseconds) ?? new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
  }

  private waitForSourcePageRequest() {
    const minimum = Math.max(0, this.options.sourcePageDelayMinMs ?? 0)
    const maximum = Math.max(minimum, this.options.sourcePageDelayMaxMs ?? minimum)
    if (maximum === 0) return Promise.resolve()
    const random = Math.min(1, Math.max(0, this.options.random?.() ?? Math.random()))
    const milliseconds = Math.round(minimum + ((maximum - minimum) * random))
    return this.options.wait?.(milliseconds) ?? new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
  }

  private waitForSourcePageBatchPause() {
    const milliseconds = Math.max(0, this.options.sourcePageBatchPauseMs ?? 0)
    if (milliseconds === 0) return Promise.resolve()
    return this.options.wait?.(milliseconds) ?? new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
  }

  private async bindTarget(accountMid: string) {
    const binding = await this.request(accountMid, { type: 'old-favorite-workspace-bind-scan-target', accountMid })
    if (binding.status !== 'ok' || !binding.target) return binding
    if (normalizeAccountMid(binding.observedAccountMid) !== accountMid) {
      return { status: 'unknown' as const, observedAccountMid: binding.observedAccountMid, reason: 'scan-target-account-mismatch' }
    }
    return binding
  }

  private async readWorkspaceSnapshot(accountMid: string): Promise<OldFavoriteWorkspaceSnapshot> {
    const snapshot = await this.options.coordinator.getSnapshot(accountMid)
    if (!snapshot || 'recovery' in snapshot) throw new Error('Old favorite workspace scan snapshot is unavailable.')
    return snapshot
  }

  private async requestWithTargetRetry(
    accountMid: string,
    target: ScanTarget,
    requestFor: (target: ScanTarget) => RuntimeRequest
  ): Promise<{ result: RuntimeInventoryResult; target: ScanTarget }> {
    const first = await this.request(accountMid, requestFor(target))
    if (!isTargetLifecycleFailure(first)) return { result: first, target }
    const rebound = await this.bindTarget(accountMid)
    if (rebound.status !== 'ok' || !rebound.target) return { result: rebound, target }
    return { result: await this.request(accountMid, requestFor(rebound.target)), target: rebound.target }
  }

  private requestCurrentTag(accountMid: string, workspaceId: string, request: RuntimeRequest) {
    const work = async () => {
      if (!await this.tagRequestStillCurrent(accountMid, workspaceId)) return undefined
      return this.options.requestRuntime(request)
    }
    return this.options.remoteOperations?.run(accountMid, work) ?? work()
  }

  private async requestCurrentTagWithTargetRetry(accountMid: string, workspaceId: string, target: ScanTarget, aid: number) {
    const first = await this.requestCurrentTag(accountMid, workspaceId, {
      type: 'old-favorite-workspace-read-video-tags', accountMid, target, aid
    })
    if (!first || !isTargetLifecycleFailure(first)) return { result: first, target }
    const rebound = await this.bindTarget(accountMid)
    if (rebound.status !== 'ok' || !rebound.target) return { result: rebound, target }
    return {
      result: await this.requestCurrentTag(accountMid, workspaceId, {
        type: 'old-favorite-workspace-read-video-tags', accountMid, target: rebound.target, aid
      }),
      target: rebound.target
    }
  }

  async start(accountMid: string, mode: OldFavoriteWorkspaceMode, options?: { clearBilibiliMirror?: boolean }): Promise<OldFavoriteWorkspaceSnapshot> {
    this.assertAcceptingWork()
    const account = normalizeAccountMid(accountMid)
    if (!account) throw new Error('Old favorite workspace account is invalid.')
    if (mode === 'full') this.options.cancelDeepSeek?.(account)
    const active = this.activeScans.get(account)
    // An explicit full reorganization must supersede a running incremental scan.
    // The old scan observes its revoked ownership before it can write another page.
    if (active && mode !== 'full' && (active.mode === mode || active.mode === 'full')) return active.snapshot

    let run!: { mode: OldFavoriteWorkspaceMode; snapshot: Promise<OldFavoriteWorkspaceSnapshot> }
    const isCurrent = () => !this.destructiveMaintenance && this.activeScans.get(account) === run
    const snapshot = this.track(this.begin(account, mode, isCurrent, options))
    run = { mode, snapshot }
    this.activeScans.set(account, run)
    void snapshot.catch(() => {
      if (isCurrent()) this.activeScans.delete(account)
    })
    return snapshot
  }

  private async begin(accountMid: string, mode: OldFavoriteWorkspaceMode, isCurrent: () => boolean, options?: { clearBilibiliMirror?: boolean }) {
    let recoveryProbe: { target: ScanTarget; inventory: RuntimeInventoryResult } | undefined
    const getScanRetryState = (this.options.coordinator as {
      getScanRetryState?: (accountMid: string) => Promise<{ reason: string; retryAvailableAt: string } | null>
    }).getScanRetryState
    const retryState = mode === 'incremental' && getScanRetryState
      ? await getScanRetryState.call(this.options.coordinator, accountMid)
      : null
    if (shouldProbeExpiredRiskControl(retryState, this.options.now?.() ?? new Date().toISOString())) {
      const binding = await this.bindTarget(accountMid)
      if (!isCurrent()) return this.readWorkspaceSnapshot(accountMid)
      if (binding.status !== 'ok' || !binding.target) {
        await this.options.coordinator.recordScanFailure(accountMid, diagnosticFailureReason(binding, 'scan-target-unavailable'))
        if (isCurrent()) this.activeScans.delete(accountMid)
        return this.readWorkspaceSnapshot(accountMid)
      }
      const inventoryRead = await this.requestWithTargetRetry(accountMid, binding.target, (target) => ({
        type: 'old-favorite-workspace-inventory', accountMid, target
      }))
      if (!isCurrent()) return this.readWorkspaceSnapshot(accountMid)
      const inventory = inventoryRead.result
      if (inventory.status !== 'ok' || !Array.isArray(inventory.folders)) {
        await this.options.coordinator.recordScanFailure(accountMid, diagnosticFailureReason(inventory, 'inventory-failed'))
        if (isCurrent()) this.activeScans.delete(accountMid)
        return this.readWorkspaceSnapshot(accountMid)
      }
      if (normalizeAccountMid(inventory.observedAccountMid) !== accountMid) {
        await this.options.coordinator.recordScanFailure(accountMid, 'inventory-account-mismatch')
        if (isCurrent()) this.activeScans.delete(accountMid)
        return this.readWorkspaceSnapshot(accountMid)
      }
      recoveryProbe = { target: inventoryRead.target, inventory }
    }
    const snapshot = recoveryProbe
      ? await this.options.coordinator.resumeFailedScan(accountMid)
      : options?.clearBilibiliMirror
        ? await this.options.coordinator.beginScan(accountMid, mode, { clearBilibiliMirror: true })
        : await this.options.coordinator.beginScan(accountMid, mode)
    if (!isCurrent()) return snapshot
    const runId = await this.options.coordinator.getActiveScanRunId(accountMid)
    const resumeState = recoveryProbe
      ? await this.options.coordinator.getScanResumeState(accountMid) as PersistedScanResumeState
      : null
    if (resumeState && resumeState.runId !== runId) throw new Error('Old favorite workspace scan lease changed while recovering from risk control.')
    const completedPages = new Map((resumeState?.completedPages ?? [])
      .filter((page): page is { folderId: string; page: number; hasMore: boolean } => typeof page.hasMore === 'boolean')
      .map(({ folderId, page, hasMore }) => [`${folderId}\u0000${page}`, hasMore] as const))
    void this.track(this.runInventory(
      accountMid, runId, isCurrent, snapshot.workspaceId, completedPages,
      new Set(resumeState?.taggedAids ?? []), recoveryProbe
    )).finally(() => {
      if (isCurrent()) this.activeScans.delete(accountMid)
    })
    return snapshot
  }

  /** Explicitly resumes an existing durable scan lease; construction never starts or resumes work. */
  async pause(accountMid: string): Promise<OldFavoriteWorkspaceSnapshot> {
    this.assertAcceptingWork()
    const account = normalizeAccountMid(accountMid)
    if (!account) throw new Error('Old favorite workspace account is invalid.')
    // Revoke the in-memory lease first so an in-flight runtime response cannot
    // append another page after the durable paused marker is written.
    this.activeScans.delete(account)
    return this.options.coordinator.pauseScan(account)
  }

  /** Explicitly resumes an existing durable scan lease; construction never starts or resumes work. */
  async resume(accountMid: string): Promise<OldFavoriteWorkspaceSnapshot> {
    this.assertAcceptingWork()
    const account = normalizeAccountMid(accountMid)
    if (!account) throw new Error('Old favorite workspace account is invalid.')
    const active = this.activeScans.get(account)
    if (active) return active.snapshot

    let run!: { mode: OldFavoriteWorkspaceMode; snapshot: Promise<OldFavoriteWorkspaceSnapshot> }
    const isCurrent = () => !this.destructiveMaintenance && this.activeScans.get(account) === run
    const snapshot = this.track(this.resumeExisting(account, isCurrent))
    run = { mode: 'incremental', snapshot }
    this.activeScans.set(account, run)
    void snapshot.catch(() => {
      if (isCurrent()) this.activeScans.delete(account)
    })
    return snapshot
  }

  private async resumeExisting(accountMid: string, isCurrent: () => boolean) {
    const snapshot = await this.options.coordinator.resumeScan(accountMid)
    if (!isCurrent()) return snapshot
    const runId = await this.options.coordinator.getActiveScanRunId(accountMid)
    const resumeState = await this.options.coordinator.getScanResumeState(accountMid) as PersistedScanResumeState
    if (resumeState.runId !== runId) throw new Error('Old favorite workspace scan lease changed while resuming.')
    // Old staged pages did not retain the terminal marker, so they cannot be
    // safely skipped. New pages carry hasMore and can be resumed exactly.
    const completedPages = new Map(resumeState.completedPages
      .filter((page): page is { folderId: string; page: number; hasMore: boolean } => typeof page.hasMore === 'boolean')
      .map(({ folderId, page, hasMore }) => [`${folderId}\u0000${page}`, hasMore] as const))
    void this.track(this.runInventory(accountMid, runId, isCurrent, snapshot.workspaceId, completedPages, new Set(resumeState.taggedAids))).finally(() => {
      if (isCurrent()) this.activeScans.delete(accountMid)
    })
    return snapshot
  }

  private async runInventory(
    accountMid: string,
    runId: string,
    isCurrent: () => boolean,
    workspaceId?: string,
    completedPages = new Map<string, boolean>(),
    taggedAids = new Set<number>(),
    recoveryProbe?: { target: ScanTarget; inventory: RuntimeInventoryResult }
  ) {
    let runtimeStage = 'bind-scan-target'
    try {
      let target: ScanTarget
      let inventory: RuntimeInventoryResult
      if (recoveryProbe) {
        target = recoveryProbe.target
        inventory = recoveryProbe.inventory
      } else {
        runtimeStage = 'bind-scan-target'
        const binding = await this.bindTarget(accountMid)
        if (!isCurrent()) return
        if (binding.status !== 'ok' || !binding.target) {
          await this.options.coordinator.recordScanFailure(accountMid, binding.reason ?? 'scan-target-unavailable', runId)
          return
        }
        target = binding.target
        runtimeStage = 'read-inventory'
        const inventoryRead = await this.requestWithTargetRetry(accountMid, target, (nextTarget) => ({
          type: 'old-favorite-workspace-inventory', accountMid, target: nextTarget
        }))
        inventory = inventoryRead.result
        target = inventoryRead.target
      }
      if (!isCurrent()) return
      if (inventory.status !== 'ok' || !Array.isArray(inventory.folders)) {
        await this.options.coordinator.recordScanFailure(accountMid, diagnosticFailureReason(inventory, 'inventory-failed'), runId)
        return
      }
      if (normalizeAccountMid(inventory.observedAccountMid) !== normalizeAccountMid(accountMid)) {
        await this.options.coordinator.recordScanFailure(accountMid, 'inventory-account-mismatch', runId)
        return
      }
      runtimeStage = 'record-inventory'
      await this.options.coordinator.recordScanInventory(accountMid, {
        sourceFolders: inventory.folders.map((folder) => ({
          id: folder.id,
          title: folder.title,
          itemCount: folder.mediaCount,
          isBilimiWorkFolder: isBilimiWorkFolder(folder.title)
        }))
      }, runId)
      if (recoveryProbe) {
        await this.waitForRecoveryStabilization()
        if (!isCurrent()) return
      }
      const managedFolderIds = inventory.folders.filter((folder) => isBilimiWorkFolder(folder.title)).map((folder) => folder.id)
      const declaredMediaCounts = new Map(inventory.folders.map((folder) => [folder.id, folder.mediaCount]))
      for (let offset = 0; offset < managedFolderIds.length; offset += 10) {
        const folderIds = managedFolderIds.slice(offset, offset + 10)
        runtimeStage = 'read-managed-members'
        let managedRead = await this.requestWithTargetRetry(accountMid, target, (nextTarget) => ({
          type: 'old-favorite-workspace-read-managed-members', accountMid, target: nextTarget, folderIds
        }))
        let managed = managedRead.result
        target = managedRead.target
        if (!isCurrent()) return
        if (managed.status !== 'ok' || !managed.members) {
          await this.options.coordinator.recordScanFailure(accountMid, diagnosticFailureReason(managed, 'managed-members-failed'), runId)
          return
        }
        if (normalizeAccountMid(managed.observedAccountMid) !== normalizeAccountMid(accountMid)) {
          await this.options.coordinator.recordScanFailure(accountMid, 'managed-members-account-mismatch', runId)
          return
        }
        let anomalousEmpty = folderIds.some((folderId) => (declaredMediaCounts.get(folderId) ?? 0) > 0 && managed.members?.[folderId]?.length === 0)
        if (anomalousEmpty) {
          await this.waitForInventoryRetry()
          if (!isCurrent()) return
          runtimeStage = 'retry-read-managed-members'
          managedRead = await this.requestWithTargetRetry(accountMid, target, (nextTarget) => ({
            type: 'old-favorite-workspace-read-managed-members', accountMid, target: nextTarget, folderIds
          }))
          managed = managedRead.result
          target = managedRead.target
          if (managed.status !== 'ok' || !managed.members) {
            await this.options.coordinator.recordScanFailure(accountMid, diagnosticFailureReason(managed, 'managed-members-failed'), runId)
            return
          }
          if (normalizeAccountMid(managed.observedAccountMid) !== normalizeAccountMid(accountMid)) {
            await this.options.coordinator.recordScanFailure(accountMid, 'managed-members-account-mismatch', runId)
            return
          }
          anomalousEmpty = folderIds.some((folderId) => (declaredMediaCounts.get(folderId) ?? 0) > 0 && managed.members?.[folderId]?.length === 0)
          if (anomalousEmpty) {
            await this.options.coordinator.recordScanFailure(accountMid, 'managed-members-anomalous-empty', runId)
            return
          }
        }
        runtimeStage = 'record-managed-members'
        await this.options.coordinator.recordManagedMembers(accountMid, managed.members, runId)
      }
      let requestedSourcePageCount = 0
      const sourcePageBatchSize = Math.max(1, Math.floor(this.options.sourcePageBatchSize ?? Number.MAX_SAFE_INTEGER))
      for (const folder of inventory.folders) {
        if (isBilimiWorkFolder(folder.title)) continue
        let page = 1
        let hasMore = true
        while (hasMore) {
          const persistedHasMore = completedPages.get(`${folder.id}\u0000${page}`)
          if (persistedHasMore !== undefined) {
            if (!persistedHasMore) {
              hasMore = false
              continue
            }
            page += 1
            continue
          }
          if (requestedSourcePageCount > 0 && requestedSourcePageCount % sourcePageBatchSize === 0) {
            await this.waitForSourcePageBatchPause()
            if (!isCurrent()) return
          }
          await this.waitForSourcePageRequest()
          if (!isCurrent()) return
          runtimeStage = 'read-source-page'
          const sourcePageRead = await this.requestWithTargetRetry(accountMid, target, (nextTarget) => ({
            type: 'old-favorite-workspace-read-source-page', accountMid, target: nextTarget,
            folderId: folder.id, page, pageSize: 20
          }))
          const sourcePage = sourcePageRead.result
          requestedSourcePageCount += 1
          target = sourcePageRead.target
          if (!isCurrent()) return
          if (sourcePage.status !== 'ok' || !Array.isArray(sourcePage.items) || typeof sourcePage.hasMore !== 'boolean') {
            await this.options.coordinator.recordScanFailure(accountMid, diagnosticFailureReason(sourcePage, 'source-page-failed'), runId)
            return
          }
          if (normalizeAccountMid(sourcePage.observedAccountMid) !== normalizeAccountMid(accountMid)) {
            await this.options.coordinator.recordScanFailure(accountMid, 'source-page-account-mismatch', runId)
            return
          }
          if (sourcePage.items.length === 0 && sourcePage.hasMore) {
            await this.options.coordinator.recordScanFailure(accountMid, 'source-page-empty-with-more', runId)
            return
          }
          runtimeStage = 'record-source-page'
          await this.options.coordinator.recordScanPage(accountMid, {
            folderId: folder.id,
            page,
            hasMore: sourcePage.hasMore,
            items: sourcePage.items.map((item) => ({
              aid: item.aid, title: item.title, author: item.upperName, cover: item.cover,
              addedAt: item.addedAt, tags: item.tags, category: item.category,
              unavailable: item.unavailable, sourceFolderIds: [folder.id]
            }))
          }, runId)
          hasMore = sourcePage.hasMore
          page += 1
        }
      }
      if (!isCurrent()) return
      runtimeStage = 'finish-scan'
      await this.options.coordinator.finishScan(accountMid, runId)
      if (!isCurrent()) return
      if (workspaceId && typeof this.options.coordinator.getPendingTagEnrichmentAids === 'function') {
        void this.startTagEnrichment(accountMid, target, workspaceId, taggedAids)
      }
    } catch {
      if (!isCurrent()) return
      await this.options.coordinator.recordScanFailure(accountMid, `inventory-runtime-failed:${runtimeStage}`, runId)
    }
  }

  async resumeTagEnrichment(accountMid: string) {
    this.assertAcceptingWork()
    const account = normalizeAccountMid(accountMid)
    if (!account) throw new Error('Old favorite workspace account is invalid.')
    const binding = await this.request(account, { type: 'old-favorite-workspace-bind-scan-target', accountMid: account })
    if (binding.status !== 'ok' || !binding.target || normalizeAccountMid(binding.observedAccountMid) !== account) {
      return
    }
    await this.options.coordinator.resumeTagEnrichment(account)
    const snapshot = await this.options.coordinator.getSnapshot(account)
    if (snapshot && 'workspaceId' in snapshot) void this.startTagEnrichment(account, binding.target, snapshot.workspaceId)
  }

  async retryFailedTagEnrichment(accountMid: string) {
    this.assertAcceptingWork()
    const account = normalizeAccountMid(accountMid)
    if (!account) throw new Error('Old favorite workspace account is invalid.')
    await this.options.coordinator.retryFailedTagEnrichment(account)
    const binding = await this.request(account, { type: 'old-favorite-workspace-bind-scan-target', accountMid: account })
    if (binding.status !== 'ok' || !binding.target || normalizeAccountMid(binding.observedAccountMid) !== account) {
      return
    }
    const snapshot = await this.options.coordinator.getSnapshot(account)
    if (snapshot && 'workspaceId' in snapshot) void this.startTagEnrichment(account, binding.target, snapshot.workspaceId)
  }

  private startTagEnrichment(accountMid: string, target: ScanTarget, workspaceId: string, skipTaggedAids?: ReadonlySet<number>) {
    return this.track(this.runTagEnrichment(accountMid, target, workspaceId, skipTaggedAids))
  }

  private async runTagEnrichment(accountMid: string, target: ScanTarget, workspaceId: string, skipTaggedAids?: ReadonlySet<number>) {
    const current = this.enrichmentRuns.get(accountMid)
    if (current) {
      if (current.workspaceId !== workspaceId) current.successor = { target, workspaceId }
      return
    }
    const run: { target: ScanTarget; workspaceId: string; successor?: { target: ScanTarget; workspaceId: string } } = { target, workspaceId }
    this.enrichmentRuns.set(accountMid, run)
    const isCurrent = () => !this.destructiveMaintenance && this.enrichmentRuns.get(accountMid) === run
    let activeTarget = target
    try {
      while (true) {
        const aids = await this.options.coordinator.getPendingTagEnrichmentAids(accountMid)
        if (!isCurrent()) return
        if (!aids.length) return
        const aid = aids.find((candidate) => !skipTaggedAids?.has(candidate))
        if (aid === undefined) return
        let result!: RuntimeInventoryResult
        let recoverableFailure: RuntimeInventoryResult | undefined
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await this.waitForTagRequest()
          if (!isCurrent()) return
          const read = await this.requestCurrentTagWithTargetRetry(accountMid, workspaceId, activeTarget, aid)
          const next = read.result
          activeTarget = read.target
          if (!isCurrent()) return
          if (!next) return
          result = next
          if (!isRecoverableTagReadFailure(result, accountMid)) break
          recoverableFailure = result
          if (attempt < 2) await new Promise<void>((resolve) => setTimeout(resolve, this.options.tagRetryDelayMs ?? 750))
        }
        if (recoverableFailure && isRecoverableTagReadFailure(result, accountMid)) {
          if (!isCurrent()) return
          if (this.options.coordinator.recordTagEnrichmentFailure) {
            await this.options.coordinator.recordTagEnrichmentFailure(accountMid, aid, tagReadFailureReason(result), workspaceId)
            continue
          }
          await this.options.coordinator.pauseTagEnrichment(accountMid)
          return
        }
        if (result.status !== 'ok' || result.aid !== aid || !Array.isArray(result.tags) ||
          normalizeAccountMid(result.observedAccountMid) !== normalizeAccountMid(accountMid)) {
          if (!isCurrent()) return
          await this.options.coordinator.pauseTagEnrichment(accountMid)
          return
        }
        if (!isCurrent()) return
        await this.options.coordinator.recordTagEnrichment(accountMid, aid, result.tags, workspaceId)
      }
    } finally {
      if (this.enrichmentRuns.get(accountMid) !== run) return
      this.enrichmentRuns.delete(accountMid)
      if (!this.destructiveMaintenance && run.successor) void this.startTagEnrichment(accountMid, run.successor.target, run.successor.workspaceId)
    }
  }
}
