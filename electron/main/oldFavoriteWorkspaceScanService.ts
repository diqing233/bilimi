import type { OldFavoriteWorkspaceMode, OldFavoriteWorkspaceSnapshot } from '../../src/shared/oldFavoriteWorkspace'
import { OldFavoriteWorkspaceCoordinator } from './oldFavoriteWorkspaceCoordinator'

type ScanTarget = { webContentsId: number; instanceId: string; navigationEpoch: number }
type RuntimeInventoryResult = {
  status: 'ok' | 'rejected' | 'unknown'
  observedAccountMid: string
  reason?: string
  target?: ScanTarget
  folders?: Array<{ id: string; title: string; mediaCount: number }>
  members?: Record<string, number[]>
  items?: Array<{ aid: number; title: string; upperName: string; cover: string; addedAt: number }>
  hasMore?: boolean
}

type RuntimeRequest =
  | { type: 'old-favorite-workspace-bind-scan-target'; accountMid: string }
  | { type: 'old-favorite-workspace-inventory'; accountMid: string; target: ScanTarget }
  | { type: 'old-favorite-workspace-read-source-page'; accountMid: string; target: ScanTarget; folderId: string; page: number; pageSize: number }
  | { type: 'old-favorite-workspace-read-managed-members'; accountMid: string; target: ScanTarget; folderIds: string[] }

function normalizeAccountMid(value: string) {
  return /^\d+$/.test(value.trim()) && BigInt(value.trim()) > 0n ? BigInt(value.trim()).toString() : ''
}

function isBilimiWorkFolder(title: string) {
  return /^bilimi(?:[^\\p{L}\\p{N}]|$)/iu.test(title.trim())
}

/** Runs a fixed, read-only inventory against the explicitly bound Bilibili tab. */
export class OldFavoriteWorkspaceScanService {
  private readonly activeScans = new Map<string, {
    mode: OldFavoriteWorkspaceMode
    snapshot: Promise<OldFavoriteWorkspaceSnapshot>
  }>()

  constructor(private readonly options: {
    coordinator: OldFavoriteWorkspaceCoordinator
    requestRuntime: (request: RuntimeRequest) => Promise<RuntimeInventoryResult>
  }) {}

  async start(accountMid: string, mode: OldFavoriteWorkspaceMode): Promise<OldFavoriteWorkspaceSnapshot> {
    const account = normalizeAccountMid(accountMid)
    if (!account) throw new Error('Old favorite workspace account is invalid.')
    const active = this.activeScans.get(account)
    // An explicit full reorganization must supersede a running incremental scan.
    // The old scan observes its revoked ownership before it can write another page.
    if (active && (active.mode === mode || active.mode === 'full')) return active.snapshot

    let run!: { mode: OldFavoriteWorkspaceMode; snapshot: Promise<OldFavoriteWorkspaceSnapshot> }
    const isCurrent = () => this.activeScans.get(account) === run
    const snapshot = this.begin(account, mode, isCurrent)
    run = { mode, snapshot }
    this.activeScans.set(account, run)
    void snapshot.catch(() => {
      if (isCurrent()) this.activeScans.delete(account)
    })
    return snapshot
  }

  private async begin(accountMid: string, mode: OldFavoriteWorkspaceMode, isCurrent: () => boolean) {
    const snapshot = await this.options.coordinator.beginScan(accountMid, mode)
    const runId = await this.options.coordinator.getActiveScanRunId(accountMid)
    void this.runInventory(accountMid, runId, isCurrent).finally(() => {
      if (isCurrent()) this.activeScans.delete(accountMid)
    })
    return snapshot
  }

  private async runInventory(accountMid: string, runId: string, isCurrent: () => boolean) {
    try {
      const binding = await this.options.requestRuntime({ type: 'old-favorite-workspace-bind-scan-target', accountMid })
      if (!isCurrent()) return
      if (binding.status !== 'ok' || !binding.target) {
        await this.options.coordinator.recordScanFailure(accountMid, binding.reason ?? 'scan-target-unavailable', runId)
        return
      }
      const inventory = await this.options.requestRuntime({
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
        const managed = await this.options.requestRuntime({
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
          const sourcePage = await this.options.requestRuntime({
            type: 'old-favorite-workspace-read-source-page', accountMid, target: binding.target,
            folderId: folder.id, page, pageSize: 50
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
              addedAt: item.addedAt, sourceFolderIds: [folder.id]
            }))
          }, runId)
          hasMore = sourcePage.hasMore
          page += 1
        }
      }
      if (!isCurrent()) return
      await this.options.coordinator.finishScan(accountMid, runId)
    } catch {
      if (!isCurrent()) return
      await this.options.coordinator.recordScanFailure(accountMid, 'inventory-runtime-failed', runId)
    }
  }
}
