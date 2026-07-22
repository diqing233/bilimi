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
  items?: Array<{ aid: number; title: string; upperName: string; cover: string; addedAt: number; tags: string[]; category: string }>
  hasMore?: boolean
  aid?: number
  tags?: string[]
}

type RuntimeRequest =
  | { type: 'old-favorite-workspace-bind-scan-target'; accountMid: string }
  | { type: 'old-favorite-workspace-inventory'; accountMid: string; target: ScanTarget }
  | { type: 'old-favorite-workspace-read-source-page'; accountMid: string; target: ScanTarget; folderId: string; page: number; pageSize: number }
  | { type: 'old-favorite-workspace-read-video-tags'; accountMid: string; target: ScanTarget; aid: number }
  | { type: 'old-favorite-workspace-read-managed-members'; accountMid: string; target: ScanTarget; folderIds: string[] }

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
  return result.reason?.trim() || 'tag-read-failed'
}

/** Runs a fixed, read-only inventory against the explicitly bound Bilibili tab. */
export class OldFavoriteWorkspaceScanService {
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
    wait?: (milliseconds: number) => Promise<void>
    random?: () => number
  }) {}

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
    return Boolean(snapshot) && 'workspaceId' in snapshot && snapshot.workspaceId === workspaceId && snapshot.tagEnrichment?.status === 'running'
  }

  private requestCurrentTag(accountMid: string, workspaceId: string, request: RuntimeRequest) {
    const work = async () => {
      if (!await this.tagRequestStillCurrent(accountMid, workspaceId)) return undefined
      return this.options.requestRuntime(request)
    }
    return this.options.remoteOperations?.run(accountMid, work) ?? work()
  }

  async start(accountMid: string, mode: OldFavoriteWorkspaceMode, options?: { clearBilibiliMirror?: boolean }): Promise<OldFavoriteWorkspaceSnapshot> {
    const account = normalizeAccountMid(accountMid)
    if (!account) throw new Error('Old favorite workspace account is invalid.')
    if (mode === 'full') this.options.cancelDeepSeek?.(account)
    const active = this.activeScans.get(account)
    // An explicit full reorganization must supersede a running incremental scan.
    // The old scan observes its revoked ownership before it can write another page.
    if (active && mode !== 'full' && (active.mode === mode || active.mode === 'full')) return active.snapshot

    let run!: { mode: OldFavoriteWorkspaceMode; snapshot: Promise<OldFavoriteWorkspaceSnapshot> }
    const isCurrent = () => this.activeScans.get(account) === run
    const snapshot = this.begin(account, mode, isCurrent, options)
    run = { mode, snapshot }
    this.activeScans.set(account, run)
    void snapshot.catch(() => {
      if (isCurrent()) this.activeScans.delete(account)
    })
    return snapshot
  }

  private async begin(accountMid: string, mode: OldFavoriteWorkspaceMode, isCurrent: () => boolean, options?: { clearBilibiliMirror?: boolean }) {
    const snapshot = options?.clearBilibiliMirror
      ? await this.options.coordinator.beginScan(accountMid, mode, { clearBilibiliMirror: true })
      : await this.options.coordinator.beginScan(accountMid, mode)
    const runId = await this.options.coordinator.getActiveScanRunId(accountMid)
    void this.runInventory(accountMid, runId, isCurrent, snapshot.workspaceId).finally(() => {
      if (isCurrent()) this.activeScans.delete(accountMid)
    })
    return snapshot
  }

  private async runInventory(accountMid: string, runId: string, isCurrent: () => boolean, workspaceId?: string) {
    try {
      const binding = await this.request(accountMid, { type: 'old-favorite-workspace-bind-scan-target', accountMid })
      if (!isCurrent()) return
      if (binding.status !== 'ok' || !binding.target) {
        await this.options.coordinator.recordScanFailure(accountMid, binding.reason ?? 'scan-target-unavailable', runId)
        return
      }
      const inventory = await this.request(accountMid, {
        type: 'old-favorite-workspace-inventory', accountMid, target: binding.target
      })
      if (!isCurrent()) return
      if (inventory.status !== 'ok' || !Array.isArray(inventory.folders)) {
        await this.options.coordinator.recordScanFailure(accountMid, inventory.reason ?? 'inventory-failed', runId)
        return
      }
      if (normalizeAccountMid(inventory.observedAccountMid) !== normalizeAccountMid(accountMid)) {
        await this.options.coordinator.recordScanFailure(accountMid, 'inventory-account-mismatch', runId)
        return
      }
      await this.options.coordinator.recordScanInventory(accountMid, {
        sourceFolders: inventory.folders.map((folder) => ({
          id: folder.id,
          title: folder.title,
          itemCount: folder.mediaCount,
          isBilimiWorkFolder: isBilimiWorkFolder(folder.title)
        }))
      }, runId)
      const managedFolderIds = inventory.folders.filter((folder) => isBilimiWorkFolder(folder.title)).map((folder) => folder.id)
      for (let offset = 0; offset < managedFolderIds.length; offset += 10) {
        const folderIds = managedFolderIds.slice(offset, offset + 10)
        const managed = await this.request(accountMid, {
          type: 'old-favorite-workspace-read-managed-members', accountMid, target: binding.target, folderIds
        })
        if (!isCurrent()) return
        if (managed.status !== 'ok' || !managed.members) {
          await this.options.coordinator.recordScanFailure(accountMid, managed.reason ?? 'managed-members-failed', runId)
          return
        }
        if (normalizeAccountMid(managed.observedAccountMid) !== normalizeAccountMid(accountMid)) {
          await this.options.coordinator.recordScanFailure(accountMid, 'managed-members-account-mismatch', runId)
          return
        }
        await this.options.coordinator.recordManagedMembers(accountMid, managed.members, runId)
      }
      for (const folder of inventory.folders) {
        if (isBilimiWorkFolder(folder.title)) continue
        let page = 1
        let hasMore = true
        while (hasMore) {
          const sourcePage = await this.request(accountMid, {
            type: 'old-favorite-workspace-read-source-page', accountMid, target: binding.target,
            folderId: folder.id, page, pageSize: 20
          })
          if (!isCurrent()) return
          if (sourcePage.status !== 'ok' || !Array.isArray(sourcePage.items) || typeof sourcePage.hasMore !== 'boolean') {
            await this.options.coordinator.recordScanFailure(accountMid, sourcePage.reason ?? 'source-page-failed', runId)
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
          await this.options.coordinator.recordScanPage(accountMid, {
            folderId: folder.id,
            page,
            items: sourcePage.items.map((item) => ({
              aid: item.aid, title: item.title, author: item.upperName, cover: item.cover,
              addedAt: item.addedAt, tags: item.tags, category: item.category, sourceFolderIds: [folder.id]
            }))
          }, runId)
          hasMore = sourcePage.hasMore
          page += 1
        }
      }
      if (!isCurrent()) return
      await this.options.coordinator.finishScan(accountMid, runId)
      if (workspaceId && typeof this.options.coordinator.getPendingTagEnrichmentAids === 'function') {
        void this.runTagEnrichment(accountMid, binding.target, workspaceId)
      }
    } catch {
      if (!isCurrent()) return
      await this.options.coordinator.recordScanFailure(accountMid, 'inventory-runtime-failed', runId)
    }
  }

  async resumeTagEnrichment(accountMid: string) {
    const account = normalizeAccountMid(accountMid)
    if (!account) throw new Error('Old favorite workspace account is invalid.')
    await this.options.coordinator.resumeTagEnrichment(account)
    const binding = await this.request(account, { type: 'old-favorite-workspace-bind-scan-target', accountMid: account })
    if (binding.status !== 'ok' || !binding.target || normalizeAccountMid(binding.observedAccountMid) !== account) {
      return
    }
    const snapshot = await this.options.coordinator.getSnapshot(account)
    if (snapshot && 'workspaceId' in snapshot) void this.runTagEnrichment(account, binding.target, snapshot.workspaceId)
  }

  async retryFailedTagEnrichment(accountMid: string) {
    const account = normalizeAccountMid(accountMid)
    if (!account) throw new Error('Old favorite workspace account is invalid.')
    await this.options.coordinator.retryFailedTagEnrichment(account)
    const binding = await this.request(account, { type: 'old-favorite-workspace-bind-scan-target', accountMid: account })
    if (binding.status !== 'ok' || !binding.target || normalizeAccountMid(binding.observedAccountMid) !== account) {
      return
    }
    const snapshot = await this.options.coordinator.getSnapshot(account)
    if (snapshot && 'workspaceId' in snapshot) void this.runTagEnrichment(account, binding.target, snapshot.workspaceId)
  }

  private async runTagEnrichment(accountMid: string, target: ScanTarget, workspaceId: string) {
    const current = this.enrichmentRuns.get(accountMid)
    if (current) {
      if (current.workspaceId !== workspaceId) current.successor = { target, workspaceId }
      return
    }
    const run: { target: ScanTarget; workspaceId: string; successor?: { target: ScanTarget; workspaceId: string } } = { target, workspaceId }
    this.enrichmentRuns.set(accountMid, run)
    try {
      while (true) {
        const aids = await this.options.coordinator.getPendingTagEnrichmentAids(accountMid)
        if (!aids.length) return
        const aid = aids[0]
        let result!: RuntimeInventoryResult
        let recoverableFailure: RuntimeInventoryResult | undefined
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await this.waitForTagRequest()
          const next = await this.requestCurrentTag(accountMid, workspaceId, {
            type: 'old-favorite-workspace-read-video-tags', accountMid, target, aid
          })
          if (!next) return
          result = next
          if (!isRecoverableTagReadFailure(result, accountMid)) break
          recoverableFailure = result
          if (attempt < 2) await new Promise<void>((resolve) => setTimeout(resolve, this.options.tagRetryDelayMs ?? 750))
        }
        if (recoverableFailure && isRecoverableTagReadFailure(result, accountMid)) {
          if (this.options.coordinator.recordTagEnrichmentFailure) {
            await this.options.coordinator.recordTagEnrichmentFailure(accountMid, aid, tagReadFailureReason(result), workspaceId)
            continue
          }
          await this.options.coordinator.pauseTagEnrichment(accountMid)
          return
        }
        if (result.status !== 'ok' || result.aid !== aid || !Array.isArray(result.tags) ||
          normalizeAccountMid(result.observedAccountMid) !== normalizeAccountMid(accountMid)) {
          await this.options.coordinator.pauseTagEnrichment(accountMid)
          return
        }
        await this.options.coordinator.recordTagEnrichment(accountMid, aid, result.tags, workspaceId)
      }
    } finally {
      if (this.enrichmentRuns.get(accountMid) !== run) return
      this.enrichmentRuns.delete(accountMid)
      if (run.successor) void this.runTagEnrichment(accountMid, run.successor.target, run.successor.workspaceId)
    }
  }
}
