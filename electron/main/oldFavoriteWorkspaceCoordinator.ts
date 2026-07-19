import { randomUUID } from 'node:crypto'
import {
  applyWorkspaceClassificationBatch,
  completeWorkspaceScan,
  createOldFavoriteWorkspace,
  freezeWorkspaceSegment,
  recordDiscoveredFavorites,
  redoWorkspaceChange,
  undoWorkspaceChange,
  type ApplyWorkspaceClassificationBatchOptions,
  type CompleteWorkspaceScanOptions,
  type OldFavoriteWorkspace,
  type OldFavoriteWorkspaceHistoryEntry,
  type OldFavoriteWorkspaceRecoveryRequired,
  type OldFavoriteWorkspaceSnapshot
} from '../../src/shared/oldFavoriteWorkspace'
import type { FavoriteRepositoryWorkspace } from '../../src/shared/favoriteRepository'
import { compileFrozenFavoriteSyncPlan } from '../../src/shared/favoriteRepositoryExecutionPlan'
import { FavoriteRepositoryService } from './favoriteRepositoryService'
import type { FavoriteRepositorySyncRun, FavoriteRepositorySyncService } from './favoriteRepositorySyncService'
import type { FavoriteRepositoryBindingService } from './favoriteRepositoryBindingService'
import { OldFavoriteWorkspaceStore } from './oldFavoriteWorkspaceStore'

const JOURNAL_EVENT_PREFIX = 'bilimi-old-favorite-workspace:v1:'

type SegmentDescriptor = { id: string; index: number; itemCount: number }
type ScanJournalEvent = {
  type: 'scan'
  createdAt: string
  mode: OldFavoriteWorkspace['mode']
  segmentSize: number
  segments: SegmentDescriptor[]
  baselineCompletedAids: number[]
}
type ClassificationJournalEvent = {
  type: 'classification'
  entry: OldFavoriteWorkspaceHistoryEntry
  historyCursor: number
}
type CursorJournalEvent = { type: 'history-cursor'; historyCursor: number }
type FreezeJournalEvent = { type: 'freeze'; segmentId: string }
type DiscoveryJournalEvent = { type: 'discover'; aids: number[] }
type WorkspaceJournalEvent = ScanJournalEvent | ClassificationJournalEvent | CursorJournalEvent |
  FreezeJournalEvent | DiscoveryJournalEvent
type ScanOverview = {
  sourceFolders: Array<{ id: string; title: string; itemCount: number; isBilimiWorkFolder: boolean; selected?: boolean }>
  scan: { phase: 'inventory' | 'failed' | 'complete'; failureCount: number; mode: OldFavoriteWorkspace['mode']; reason?: string }
}

export type { OldFavoriteWorkspaceRecoveryRequired, OldFavoriteWorkspaceSnapshot }

function clone<T>(value: T): T {
  return structuredClone(value)
}

function encodeJournalEvent(event: WorkspaceJournalEvent) {
  return {
    kind: `${JOURNAL_EVENT_PREFIX}${JSON.stringify(event)}`,
    aids: event.type === 'discover' ? [...event.aids] : []
  }
}

function decodeJournalEvent(value: { kind: string }): WorkspaceJournalEvent | undefined {
  if (!value.kind.startsWith(JOURNAL_EVENT_PREFIX)) return undefined
  try {
    return JSON.parse(value.kind.slice(JOURNAL_EVENT_PREFIX.length)) as WorkspaceJournalEvent
  } catch {
    return undefined
  }
}

function isRecoveryRequired(value: OldFavoriteWorkspace | OldFavoriteWorkspaceRecoveryRequired):
value is OldFavoriteWorkspaceRecoveryRequired {
  return 'recovery' in value
}

function normalizeAids(aids: number[]) {
  return [...new Set(aids.filter((aid) => Number.isSafeInteger(aid) && aid > 0))]
    .sort((left, right) => left - right)
}

function isStagingBilimiFolder(title: string) {
  return /待分类|暂存/u.test(title)
}

/**
 * Owns the main-process old-favorite mirror while keeping its large baseline
 * and high-frequency edits in OldFavoriteWorkspaceStore. The repository only
 * receives a lightweight account-owned marker when lifecycle state changes.
 */
export class OldFavoriteWorkspaceCoordinator {
  private readonly workspaces = new Map<string, OldFavoriteWorkspace>()
  private readonly currentSegments = new Map<string, string>()
  private readonly segmentDescriptors = new Map<string, SegmentDescriptor[]>()
  private readonly currentSegmentItems = new Map<string, Array<{ aid: number; title?: string; author?: string; cover?: string; addedAt?: number; sourceFolderIds: string[] }>>()
  private readonly frozenSegments = new Map<string, Set<string>>()
  private readonly scanOverviews = new Map<string, ScanOverview>()
  private readonly scanRuns = new Map<string, string>()
  private operationTail = Promise.resolve()

  constructor(private readonly options: {
    repository: FavoriteRepositoryService
    workspaceStore: OldFavoriteWorkspaceStore
    bindingService?: Pick<FavoriteRepositoryBindingService, 'ensurePhysicalShard'>
    syncService?: Pick<FavoriteRepositorySyncService, 'executeFrozenPlan' | 'bindPageTarget' | 'reconcile' | 'resume' | 'getRun'>
    now?: () => string
  }) {}

  async open(accountMid: string): Promise<OldFavoriteWorkspace | OldFavoriteWorkspaceRecoveryRequired> {
    return this.queue(() => this.openUnsafe(accountMid))
  }

  async getSnapshot(accountMid: string): Promise<OldFavoriteWorkspaceSnapshot | OldFavoriteWorkspaceRecoveryRequired> {
    return this.queue(async () => {
      const workspace = await this.openUnsafe(accountMid)
      return isRecoveryRequired(workspace) ? workspace : this.createSnapshot(workspace)
    })
  }

  async beginScan(accountMid: string, mode: OldFavoriteWorkspace['mode']): Promise<OldFavoriteWorkspaceSnapshot> {
    return this.queue(async () => {
      if (mode !== 'incremental' && mode !== 'full') throw new Error('Old favorite workspace mode is invalid.')
      let workspace = await this.requireWorkspace(accountMid)
      if (workspace.status !== 'scanning' && workspace.status !== 'completed') {
        throw new Error('Old favorite workspace scan is already active.')
      }
      if (mode === 'full') {
        await this.options.repository.commit(workspace.accountMid, {
          id: `old-favorite-workspace:clear-protection:${workspace.id}`,
          accountMid: workspace.accountMid,
          issuedAt: this.now(),
          type: 'record-organization-protections',
          payload: { records: [], replace: true }
        })
      }
      if (workspace.status === 'completed') {
        workspace = await this.createScanningWorkspace(workspace.accountMid, mode)
      }
      if (workspace.status !== 'scanning') throw new Error('Old favorite workspace scan is already active.')
      const updated = { ...workspace, mode }
      const scanRunId = randomUUID()
      const sourceFolders = this.scanOverviews.get(workspace.accountMid)?.sourceFolders.map(clone) ?? []
      this.scanOverviews.set(workspace.accountMid, { sourceFolders, scan: { phase: 'inventory', failureCount: 0, mode } })
      await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
        currentSegmentId: '', classifications: [], history: [],
        scanMetadata: { sourceFolders, phase: 'inventory', failureCount: 0, mode }
      })
      await this.options.workspaceStore.startScanRun(workspace.accountMid, workspace.id, scanRunId)
      this.scanRuns.set(workspace.accountMid, scanRunId)
      this.workspaces.set(updated.accountMid, updated)
      return this.createSnapshot(updated)
    })
  }

  async recordScanInventory(accountMid: string, input: { sourceFolders: ScanOverview['sourceFolders'] }) {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      if (workspace.status !== 'scanning') throw new Error('Old favorite workspace scan is not active.')
      const sourceFolders = input.sourceFolders.map((folder) => ({ ...folder, selected: !folder.isBilimiWorkFolder }))
      const mode = this.scanOverviews.get(workspace.accountMid)?.scan.mode ?? workspace.mode
      const overview: ScanOverview = { sourceFolders, scan: { phase: 'inventory', failureCount: 0, mode } }
      await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
        currentSegmentId: '', classifications: [], history: [],
        scanMetadata: { sourceFolders, ...overview.scan }
      })
      this.scanOverviews.set(workspace.accountMid, overview)
    })
  }

  /** Commits one short remote page without using the repository generation path. */
  async recordScanPage(accountMid: string, input: {
    folderId: string
    page: number
    items: Array<{ aid: number; title?: string; author?: string; cover?: string; addedAt?: number; sourceFolderIds: string[] }>
  }) {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      if (workspace.status !== 'scanning') throw new Error('Old favorite workspace scan is not active.')
      const runId = this.scanRuns.get(workspace.accountMid)
      if (!runId) throw new Error('Old favorite workspace scan run is not active.')
      await this.options.workspaceStore.appendScanPage(workspace.accountMid, workspace.id, { ...input, runId })
    })
  }

  async recordManagedMembers(accountMid: string, members: Record<string, number[]>) {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      if (workspace.status !== 'scanning') throw new Error('Old favorite workspace scan is not active.')
      const runId = this.scanRuns.get(workspace.accountMid)
      if (!runId) throw new Error('Old favorite workspace scan run is not active.')
      await this.options.workspaceStore.appendManagedMembers(workspace.accountMid, workspace.id, { runId, members })
    })
  }

  async selectSourceFolders(accountMid: string, folderIds: string[]) {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      if (workspace.status !== 'previewing') throw new Error('Old favorite workspace sources are not ready.')
      const sourceFolders = this.scanOverviews.get(workspace.accountMid)?.sourceFolders ?? []
      const validIds = new Set(sourceFolders.filter((folder) => !folder.isBilimiWorkFolder).map((folder) => folder.id))
      if (!folderIds.every((folderId) => validIds.has(folderId))) throw new Error('Old favorite workspace source selection is invalid.')
      const selectedIds = new Set(folderIds)
      const updatedFolders = sourceFolders.map((folder) => ({
        ...folder,
        selected: folder.isBilimiWorkFolder ? false : selectedIds.has(folder.id)
      }))
      await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
        currentSegmentId: this.currentSegment(workspace), classifications: [], history: [],
        scanMetadata: { sourceFolders: updatedFolders }
      })
      this.scanOverviews.set(workspace.accountMid, {
        sourceFolders: updatedFolders,
        scan: this.scanOverviews.get(workspace.accountMid)?.scan ?? { phase: 'complete', failureCount: 0, mode: workspace.mode }
      })
    })
  }

  /** Converts scan staging to the immutable 2,000-item baseline only after every page succeeds. */
  async finishScan(accountMid: string) {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      if (workspace.status !== 'scanning') throw new Error('Old favorite workspace scan is not active.')
      const itemsByAid = new Map<number, { aid: number; title?: string; author?: string; cover?: string; addedAt?: number; sourceFolderIds: string[] }>()
      await this.options.workspaceStore.visitScanPages(workspace.accountMid, workspace.id, (page) => {
        for (const item of page.items) {
          const existing = itemsByAid.get(item.aid)
          if (existing) {
            existing.sourceFolderIds = [...new Set([...existing.sourceFolderIds, ...item.sourceFolderIds])].sort()
          } else {
            itemsByAid.set(item.aid, { ...item, sourceFolderIds: [...new Set(item.sourceFolderIds)].sort() })
          }
        }
      })
      const managedMembers = await this.options.workspaceStore.readManagedMembers(workspace.accountMid, workspace.id)
      const repository = await this.options.repository.getSnapshot(workspace.accountMid)
      const sourceFolders = this.scanOverviews.get(workspace.accountMid)?.sourceFolders ?? []
      const successfulAids = repository.organizationRecords
        .filter((record) => record.accountMid === workspace.accountMid && itemsByAid.has(record.aid))
        .map((record) => record.aid)
      const initializedRecords = !repository.organizationMigrationInitialized
        ? sourceFolders.filter((folder) => folder.isBilimiWorkFolder && !isStagingBilimiFolder(folder.title)).flatMap((folder) =>
          (managedMembers[folder.id] ?? []).map((aid) => ({
            accountMid: workspace.accountMid, aid, targetFolderIds: [folder.id], completedAt: this.now()
          }))
        )
        : []
      if (initializedRecords.length || !repository.organizationMigrationInitialized) {
        await this.options.repository.commit(workspace.accountMid, {
          id: `old-favorite-workspace:migrate-protection:${workspace.id}`,
          accountMid: workspace.accountMid,
          issuedAt: this.now(),
          type: 'record-organization-protections',
          payload: { records: initializedRecords, markMigrationInitialized: true }
        })
      }
      const completed = completeWorkspaceScan(workspace, {
        revision: (workspace.baseline?.revision ?? 0) + 1,
        aids: [...itemsByAid.keys()],
        successfullyClassifiedAids: [...successfulAids, ...initializedRecords.map((record) => record.aid)],
        mode: workspace.mode
      })
      const currentSegmentId = completed.segments[0]?.id ?? ''
      await this.options.workspaceStore.create({
        accountMid: completed.accountMid,
        workspaceId: completed.id,
        status: completed.status,
        baselineRevision: completed.baseline?.revision ?? 0,
        currentSegmentId,
        sourceFolders: this.scanOverviews.get(completed.accountMid)?.sourceFolders ?? [],
        segments: completed.segments.map((segment) => ({
          id: segment.id,
          aids: [...segment.aids],
          items: segment.aids.map((aid) => itemsByAid.get(aid) ?? { aid, sourceFolderIds: [] })
        }))
      })
      const descriptors = completed.segments.map(({ id, index, aids }) => ({ id, index, itemCount: aids.length }))
      await this.appendEvents(completed, currentSegmentId, [{
        type: 'scan', createdAt: completed.createdAt, mode: completed.mode, segmentSize: completed.segmentSize,
        segments: descriptors, baselineCompletedAids: [...completed.baselineCompletedAids]
      }])
      await this.persistMarker(completed)
      this.scanOverviews.set(completed.accountMid, {
        sourceFolders: this.scanOverviews.get(completed.accountMid)?.sourceFolders ?? [],
        scan: { phase: 'complete', failureCount: 0, mode: completed.mode }
      })
      this.scanRuns.delete(completed.accountMid)
      this.remember(completed, currentSegmentId, descriptors, new Set())
      this.currentSegmentItems.set(completed.accountMid, completed.segments[0]?.aids.map((aid) => clone(itemsByAid.get(aid) ?? {
        aid, sourceFolderIds: []
      })) ?? [])
      return clone(completed)
    })
  }

  async recordScanFailure(accountMid: string, reason: string) {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      if (workspace.status !== 'scanning') return
      const prior = this.scanOverviews.get(workspace.accountMid) ?? { sourceFolders: [], scan: { phase: 'inventory' as const, failureCount: 0, mode: workspace.mode } }
      const overview: ScanOverview = {
        sourceFolders: prior.sourceFolders,
        scan: { phase: 'failed', failureCount: prior.scan.failureCount + 1, mode: prior.scan.mode, reason: reason.slice(0, 256) }
      }
      await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
        currentSegmentId: '', classifications: [], history: [],
        scanMetadata: { sourceFolders: overview.sourceFolders, ...overview.scan }
      })
      this.scanOverviews.set(workspace.accountMid, overview)
    })
  }

  async completeScan(accountMid: string, options: CompleteWorkspaceScanOptions): Promise<OldFavoriteWorkspace> {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      const completed = completeWorkspaceScan(workspace, options)
      const currentSegmentId = completed.segments[0]?.id ?? ''
      await this.options.workspaceStore.create({
        accountMid: completed.accountMid,
        workspaceId: completed.id,
        status: completed.status,
        baselineRevision: completed.baseline?.revision ?? 0,
        currentSegmentId,
        segments: completed.segments.map((segment) => ({ id: segment.id, aids: [...segment.aids] }))
      })
      const descriptors = completed.segments.map(({ id, index, aids }) => ({ id, index, itemCount: aids.length }))
      await this.appendEvents(completed, currentSegmentId, [{
        type: 'scan',
        createdAt: completed.createdAt,
        mode: completed.mode,
        segmentSize: completed.segmentSize,
        segments: descriptors,
        baselineCompletedAids: [...completed.baselineCompletedAids]
      }])
      await this.persistMarker(completed)
      this.remember(completed, currentSegmentId, descriptors, new Set())
      return clone(completed)
    })
  }

  async selectSegment(accountMid: string, segmentId: string): Promise<OldFavoriteWorkspace> {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      const descriptors = this.segmentDescriptors.get(workspace.accountMid) ??
        workspace.segments.map(({ id, index, aids }) => ({ id, index, itemCount: aids.length }))
      if (!descriptors.some((segment) => segment.id === segmentId)) {
        throw new Error('Old favorite workspace segment is invalid.')
      }
      await this.appendEvents(workspace, segmentId, [])
      const snapshot = await this.options.repository.getSnapshot(workspace.accountMid)
      if (!snapshot.workspace) throw new Error('Old favorite workspace was not found.')
      const restored = await this.restoreFromStore(snapshot.workspace, snapshot.updatedAt)
      if (isRecoveryRequired(restored)) throw new Error('Old favorite workspace requires rebuild.')
      return clone(restored)
    })
  }

  async applyClassificationBatch(
    accountMid: string,
    options: ApplyWorkspaceClassificationBatchOptions
  ): Promise<OldFavoriteWorkspace> {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      const currentSegmentId = this.currentSegment(workspace)
      const currentSegment = workspace.segments.find((segment) => segment.id === currentSegmentId)
      if (!currentSegment || !options.assignments.every((assignment) => currentSegment.aids.includes(assignment.aid))) {
        throw new Error('Old favorite workspace classifications must target the current segment.')
      }
      const updated = applyWorkspaceClassificationBatch(workspace, options)
      if (updated === workspace) return clone(workspace)
      const entry = updated.history[updated.history.length - 1]
      await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
        currentSegmentId,
        classifications: entry.changes.flatMap((change) => change.after ? [{
          aid: change.after.aid,
          targetLedgerIds: [...change.after.targetLedgerIds],
          source: change.after.source
        }] : []),
        history: [encodeJournalEvent({
          type: 'classification',
          entry: clone(entry),
          historyCursor: updated.historyCursor
        })]
      })
      this.workspaces.set(updated.accountMid, updated)
      return clone(updated)
    })
  }

  /** DeepSeek results originate in the main process, never from a renderer command. */
  async applyDeepSeekClassificationBatch(
    accountMid: string,
    assignments: ApplyWorkspaceClassificationBatchOptions['assignments'],
    expected: {
      workspaceId: string
      currentSegmentId: string
      selectedSourceFolderIds: string[]
      classifications: Record<string, { targetLedgerIds: string[] }>
    }
  ): Promise<OldFavoriteWorkspace> {
    if (assignments.length > 2_000 || assignments.some((assignment) =>
      assignment.targetLedgerIds.length > 3 || assignment.targetLedgerIds.some((id) => id.trim().length > 128))) {
      throw new Error('Old favorite workspace DeepSeek classification is invalid.')
    }
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      const currentSegmentId = this.currentSegment(workspace)
      const selectedSourceFolderIds = (this.scanOverviews.get(workspace.accountMid)?.sourceFolders ?? [])
        .filter((folder) => !folder.isBilimiWorkFolder && folder.selected)
        .map((folder) => folder.id)
        .sort()
      const classifications = Object.fromEntries(Object.entries(workspace.classifications).map(([aid, classification]) => [aid, {
        targetLedgerIds: [...classification.targetLedgerIds].sort()
      }]))
      if (workspace.id !== expected.workspaceId || currentSegmentId !== expected.currentSegmentId ||
        JSON.stringify(selectedSourceFolderIds) !== JSON.stringify([...expected.selectedSourceFolderIds].sort()) ||
        JSON.stringify(classifications) !== JSON.stringify(expected.classifications)) {
        throw new Error('Old favorite workspace changed while DeepSeek was running.')
      }
      const currentSegment = workspace.segments.find((segment) => segment.id === currentSegmentId)
      if (!currentSegment || !assignments.every((assignment) => currentSegment.aids.includes(assignment.aid))) {
        throw new Error('Old favorite workspace classifications must target the current segment.')
      }
      const updated = applyWorkspaceClassificationBatch(workspace, { source: 'deepseek', assignments })
      if (updated === workspace) return clone(workspace)
      const entry = updated.history[updated.history.length - 1]
      await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
        currentSegmentId,
        classifications: entry.changes.flatMap((change) => change.after ? [{
          aid: change.after.aid,
          targetLedgerIds: [...change.after.targetLedgerIds],
          source: change.after.source
        }] : []),
        history: [encodeJournalEvent({
          type: 'classification', entry: clone(entry), historyCursor: updated.historyCursor
        })]
      })
      this.workspaces.set(updated.accountMid, updated)
      return clone(updated)
    })
  }

  async undoClassificationChange(accountMid: string): Promise<OldFavoriteWorkspace> {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      const updated = undoWorkspaceChange(workspace)
      if (updated === workspace) return clone(workspace)
      await this.appendEvents(updated, this.currentSegment(workspace), [{
        type: 'history-cursor', historyCursor: updated.historyCursor
      }])
      this.workspaces.set(updated.accountMid, updated)
      return clone(updated)
    })
  }

  async redoClassificationChange(accountMid: string): Promise<OldFavoriteWorkspace> {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      const updated = redoWorkspaceChange(workspace)
      if (updated === workspace) return clone(workspace)
      await this.appendEvents(updated, this.currentSegment(workspace), [{
        type: 'history-cursor', historyCursor: updated.historyCursor
      }])
      this.workspaces.set(updated.accountMid, updated)
      return clone(updated)
    })
  }

  async freezeSegment(accountMid: string, segmentId: string): Promise<OldFavoriteWorkspace> {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      const frozen = freezeWorkspaceSegment(workspace, segmentId)
      const frozenIds = new Set(this.frozenSegments.get(workspace.accountMid) ?? [])
      frozenIds.add(segmentId)
      const descriptors = this.segmentDescriptors.get(workspace.accountMid) ??
        frozen.segments.map(({ id, index, aids }) => ({ id, index, itemCount: aids.length }))
      const updated = {
        ...frozen,
        status: frozenIds.size >= descriptors.length ? 'frozen' as const : 'previewing' as const
      }
      await this.appendEvents(updated, segmentId, [{ type: 'freeze', segmentId }])
      await this.persistMarker(updated)
      this.remember(updated, segmentId, descriptors, frozenIds)
      return clone(updated)
    })
  }

  /** Freezes a remote plan from persisted physical shards; it never touches the page bridge. */
  async freezeForBilibiliExecution(accountMid: string): Promise<FavoriteRepositoryWorkspace> {
    const preparation = await this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      if (workspace.status !== 'previewing' || !workspace.baseline) {
        throw new Error('Old favorite workspace is not ready to freeze.')
      }
      return {
        accountMid: workspace.accountMid,
        assignmentAids: Object.values(workspace.classifications).reduce<Record<string, number[]>>((aidsByLedger, classification) => {
          for (const logicalLedgerId of classification.targetLedgerIds.map((id) => id.trim()).filter(Boolean)) {
            aidsByLedger[logicalLedgerId] = [...new Set([...(aidsByLedger[logicalLedgerId] ?? []), classification.aid])]
          }
          return aidsByLedger
        }, {})
      }
    })
    if (this.options.bindingService) {
      const snapshot = await this.options.repository.getSnapshot(preparation.accountMid)
      for (const [logicalLedgerId, assignmentAids] of Object.entries(preparation.assignmentAids).sort(([left], [right]) => left.localeCompare(right))) {
        const existing = snapshot.physicalShards.filter((shard) => shard.logicalLedgerId === logicalLedgerId)
        const existingMemberAids = new Set(existing.flatMap((shard) => snapshot.memberships[shard.folderId] ?? []))
        const newAssignmentCount = assignmentAids.filter((aid) => !existingMemberAids.has(aid)).length
        const availableCapacity = existing.reduce((total, shard) => total + Math.max(
          0,
          1_000 - Math.max(snapshot.memberships[shard.folderId]?.length ?? 0, shard.remoteMemberCount ?? 0)
        ), 0)
        const shardCount = Math.max(0, Math.ceil((newAssignmentCount - availableCapacity) / 1_000))
        const nextShardNumber = Math.max(0, ...existing.map((shard) => shard.shardNumber)) + 1
        for (let offset = 0; offset < shardCount; offset += 1) {
          await this.options.bindingService.ensurePhysicalShard(preparation.accountMid, {
            logicalLedgerId, logicalTitle: logicalLedgerId, shardNumber: nextShardNumber + offset, memberAids: []
          })
        }
      }
    }
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(preparation.accountMid)
      if (workspace.status !== 'previewing' || !workspace.baseline) {
        throw new Error('Old favorite workspace is not ready to freeze.')
      }
      const snapshot = await this.options.repository.getSnapshot(workspace.accountMid)
      const boundShards = snapshot.physicalShards.flatMap((shard) => {
        if (shard.bindingState !== 'bound' || !shard.remoteFolderId) return []
        const memberAids = snapshot.memberships[shard.folderId] ?? []
        return [{
          logicalLedgerId: shard.logicalLedgerId,
          remoteFolderId: shard.remoteFolderId,
          memberAids,
          memberCount: Math.max(memberAids.length, shard.remoteMemberCount ?? 0),
          shardNumber: shard.shardNumber
        }]
      })
      const result = compileFrozenFavoriteSyncPlan({
        accountMid: workspace.accountMid,
        workspaceId: workspace.id,
        baselineRevision: workspace.baseline.revision,
        createdAt: this.now(),
        classifications: Object.values(workspace.classifications).map((classification) => ({
          aid: classification.aid,
          targetLedgerIds: [...classification.targetLedgerIds]
        })),
        shards: boundShards
      })
      if (!result.allowed || !result.plan) {
        throw new Error(`Old favorite workspace cannot freeze: ${result.reason ?? 'invalid-input'}`)
      }
      const frozen = { ...workspace, status: 'frozen' as const }
      await this.persistMarker(frozen, result.plan)
      this.remember(frozen, this.currentSegment(workspace), this.segmentDescriptors.get(workspace.accountMid) ?? [],
        new Set(this.frozenSegments.get(workspace.accountMid) ?? []))
      const persisted = await this.options.repository.getSnapshot(workspace.accountMid)
      if (!persisted.workspace?.frozenSyncPlan) throw new Error('Old favorite workspace frozen plan was not persisted.')
      return clone(persisted.workspace)
    })
  }

  async executeFrozenBilibiliPlan(accountMid: string): Promise<FavoriteRepositorySyncRun> {
    const frozenPlan = await this.queue(async () => {
      const snapshot = await this.options.repository.getSnapshot(accountMid)
      const workspace = snapshot.workspace
      if (!workspace?.frozenSyncPlan || (workspace.status !== 'frozen' && workspace.status !== 'executing')) {
        throw new Error('Old favorite workspace is not frozen for Bilibili execution.')
      }
      if (!this.options.syncService) throw new Error('Old favorite workspace sync service is unavailable.')
      return { accountMid: snapshot.accountMid, plan: clone(workspace.frozenSyncPlan) }
    })
    // The sync service owns its own run lock; never hold workspace mutations
    // while waiting on a remote page request so snapshot recovery stays live.
    if (!this.options.syncService) throw new Error('Old favorite workspace sync service is unavailable.')
    const currentRun = await this.options.syncService.getRun(frozenPlan.accountMid, frozenPlan.plan.id)
    if (currentRun.status === 'succeeded') {
      // A crash can occur after the final checkpoint but before the completed
      // marker. The sync service resolves that durable boundary without a page bind.
      return this.options.syncService.executeFrozenPlan(frozenPlan.accountMid, frozenPlan.plan)
    }
    if (currentRun.status === 'ready-to-resume') {
      return this.options.syncService.resume(frozenPlan.accountMid, frozenPlan.plan.id)
    }
    if (currentRun.status !== 'running') {
      return currentRun
    }
    return this.options.syncService.executeFrozenPlan(frozenPlan.accountMid, frozenPlan.plan)
  }

  async bindAndReconcileFrozenBilibiliPlan(accountMid: string): Promise<FavoriteRepositorySyncRun> {
    const run = await this.queue(async () => {
      const snapshot = await this.options.repository.getSnapshot(accountMid)
      const plan = snapshot.workspace?.frozenSyncPlan
      if (!plan || snapshot.workspace?.status !== 'reconciling') {
        throw new Error('Old favorite workspace does not require reconciliation.')
      }
      if (!this.options.syncService) throw new Error('Old favorite workspace sync service is unavailable.')
      return { accountMid: snapshot.accountMid, runId: plan.id }
    })
    if (!this.options.syncService) throw new Error('Old favorite workspace sync service is unavailable.')
    await this.options.syncService.bindPageTarget(run.accountMid, run.runId)
    return this.options.syncService.reconcile(run.accountMid, run.runId)
  }

  async resumeReconciledBilibiliPlan(accountMid: string): Promise<FavoriteRepositorySyncRun> {
    const run = await this.queue(async () => {
      const snapshot = await this.options.repository.getSnapshot(accountMid)
      const plan = snapshot.workspace?.frozenSyncPlan
      if (!plan || snapshot.workspace?.status !== 'frozen') throw new Error('Old favorite workspace is not ready to continue.')
      if (!this.options.syncService) throw new Error('Old favorite workspace sync service is unavailable.')
      return { accountMid: snapshot.accountMid, runId: plan.id }
    })
    if (!this.options.syncService) throw new Error('Old favorite workspace sync service is unavailable.')
    return this.options.syncService.resume(run.accountMid, run.runId)
  }

  async recordDiscoveredFavorites(accountMid: string, discoveredAids: number[]): Promise<OldFavoriteWorkspace> {
    return this.queue(async () => {
      const workspace = await this.requireWorkspace(accountMid)
      const updated = recordDiscoveredFavorites(workspace, discoveredAids)
      if (updated === workspace) return clone(workspace)
      const existing = new Set(workspace.continuationAids)
      const additions = updated.continuationAids.filter((aid) => !existing.has(aid))
      await this.appendEvents(updated, this.currentSegment(workspace), [{ type: 'discover', aids: additions }])
      this.workspaces.set(updated.accountMid, updated)
      return clone(updated)
    })
  }

  private async openUnsafe(accountMid: string): Promise<OldFavoriteWorkspace | OldFavoriteWorkspaceRecoveryRequired> {
    const snapshot = await this.options.repository.getSnapshot(accountMid)
    const account = snapshot.accountMid
    const cached = this.workspaces.get(account)
    if (cached && snapshot.workspace && this.matchesMarker(cached, snapshot.workspace)) return clone(cached)

    if (snapshot.workspace) return this.restoreFromStore(snapshot.workspace, snapshot.updatedAt)

    const workspace = await this.createScanningWorkspace(account)
    return clone(workspace)
  }

  private async createScanningWorkspace(accountMid: string, mode?: OldFavoriteWorkspace['mode']) {
    const account = (await this.options.repository.getSnapshot(accountMid)).accountMid
    const now = this.now()
    const workspace = createOldFavoriteWorkspace({
      accountMid: account,
      now,
      id: `old-favorite-workspace-${account}-${now.replace(/[^0-9]/g, '')}-${randomUUID()}`
    })
    await this.options.workspaceStore.create({
      accountMid: account,
      workspaceId: workspace.id,
      status: workspace.status,
      baselineRevision: 0,
      currentSegmentId: '',
      segments: []
    })
    await this.persistMarker(workspace)
    this.currentSegmentItems.delete(account)
    this.scanOverviews.delete(account)
    this.scanRuns.delete(account)
    this.remember(workspace, '', [], new Set())
    return mode ? { ...workspace, mode } : workspace
  }

  private async restoreFromStore(
    marker: FavoriteRepositoryWorkspace,
    updatedAt: string
  ): Promise<OldFavoriteWorkspace | OldFavoriteWorkspaceRecoveryRequired> {
    const recovered = await this.options.workspaceStore.recover(marker.accountMid, marker.id)
    if ('recovery' in recovered || recovered.baselineRevision !== marker.baselineRevision) {
      this.workspaces.delete(marker.accountMid)
      return {
        recovery: 'rebuild-required',
        preserveCompletedLocalResults: true,
        accountMid: marker.accountMid,
        workspaceId: marker.id
      }
    }

    const events = recovered.history.map(decodeJournalEvent).filter((event): event is WorkspaceJournalEvent => Boolean(event))
    const scan = events.find((event): event is ScanJournalEvent => event.type === 'scan')
    if (marker.status === 'scanning') {
      const scanning = { ...createOldFavoriteWorkspace({ accountMid: marker.accountMid, id: marker.id, now: updatedAt }), mode: recovered.scan.mode }
      this.scanOverviews.set(marker.accountMid, {
        sourceFolders: recovered.sourceFolders,
        scan: recovered.scan
      })
      this.remember(scanning, '', [], new Set())
      return clone(scanning)
    }
    if (!scan) return {
      recovery: 'rebuild-required',
      preserveCompletedLocalResults: true,
      accountMid: marker.accountMid,
      workspaceId: marker.id
    }

    const descriptor = scan.segments.find((segment) => segment.id === recovered.currentSegmentId)
    if (!descriptor && scan.segments.length) return {
      recovery: 'rebuild-required', preserveCompletedLocalResults: true,
      accountMid: marker.accountMid, workspaceId: marker.id
    }
    const loaded = {
      id: recovered.currentSegmentId,
      aids: [...recovered.loadedSegmentAids]
    }
    this.currentSegmentItems.set(marker.accountMid, recovered.loadedSegmentItems.map(clone))
    const activeAidSet = new Set(loaded.aids)
    const frozenIds = new Set(events.flatMap((event) => event.type === 'freeze' ? [event.segmentId] : []))
    const historyEvents = events.filter((event): event is ClassificationJournalEvent => event.type === 'classification')
    const allHistory = historyEvents.map((event) => clone(event.entry))
    const latestCursor = [...events].reverse().find((event): event is ClassificationJournalEvent | CursorJournalEvent =>
      event.type === 'classification' || event.type === 'history-cursor')?.historyCursor ?? allHistory.length
    const recoveredHistory = allHistory.map((entry) => ({
      ...entry,
      changes: entry.changes.filter((change) => activeAidSet.has(change.aid))
    })).filter((entry) => entry.changes.length > 0)
    const history = marker.status === 'completed' ? [] : recoveredHistory
    const historyCursor = marker.status === 'completed' ? 0 : Math.min(latestCursor, history.length)
    const classifications: OldFavoriteWorkspace['classifications'] = {}
    for (const entry of history.slice(0, historyCursor)) {
      for (const change of entry.changes) {
        if (change.after) classifications[String(change.aid)] = clone(change.after)
        else delete classifications[String(change.aid)]
      }
    }
    const baselineCompletedAids = normalizeAids(scan.baselineCompletedAids).filter((aid) => activeAidSet.has(aid))
    const protectedSet = new Set(scan.mode === 'incremental' ? baselineCompletedAids : [])
    const continuationAids = normalizeAids(events.flatMap((event) => event.type === 'discover' ? event.aids : []))
    const scanning = createOldFavoriteWorkspace({
      accountMid: marker.accountMid,
      id: marker.id,
      now: scan.createdAt,
      segmentSize: scan.segmentSize
    })
    const workspace: OldFavoriteWorkspace = {
      ...scanning,
      status: marker.status,
      mode: scan.mode,
      baseline: { revision: marker.baselineRevision, aids: [...loaded.aids] },
      baselineCompletedAids,
      plannedAids: loaded.aids.filter((aid) => !protectedSet.has(aid)),
      protectedAids: [...protectedSet],
      continuationAids,
      hasMultipleSegments: scan.segments.length > 1,
      segments: descriptor ? [{
        id: descriptor.id,
        index: descriptor.index,
        aids: [...loaded.aids],
        status: frozenIds.has(descriptor.id) ? 'frozen' : 'previewing'
      }] : [],
      classifications,
      history,
      historyCursor
    }
    this.scanOverviews.set(marker.accountMid, {
      // Workspaces created before source selection did not persist this flag.
      sourceFolders: recovered.sourceFolders.map((folder) => ({
        ...folder,
        selected: folder.isBilimiWorkFolder ? false : folder.selected ?? true
      })),
      scan: { phase: 'complete', failureCount: 0, mode: scan.mode }
    })
    this.remember(workspace, recovered.currentSegmentId, scan.segments, frozenIds)
    return clone(workspace)
  }

  private async requireWorkspace(accountMid: string): Promise<OldFavoriteWorkspace> {
    const snapshot = await this.options.repository.getSnapshot(accountMid)
    const workspace = this.workspaces.get(snapshot.accountMid)
    if (workspace && snapshot.workspace && this.matchesMarker(workspace, snapshot.workspace)) return workspace
    const opened = await this.openUnsafe(snapshot.accountMid)
    if (isRecoveryRequired(opened)) throw new Error('Old favorite workspace requires rebuild.')
    return opened
  }

  private async appendEvents(workspace: OldFavoriteWorkspace, currentSegmentId: string, events: WorkspaceJournalEvent[]) {
    await this.options.workspaceStore.appendOverlay(workspace.accountMid, workspace.id, {
      currentSegmentId,
      classifications: [],
      history: events.map(encodeJournalEvent)
    })
  }

  private async persistMarker(workspace: OldFavoriteWorkspace, frozenSyncPlan?: FavoriteRepositoryWorkspace['frozenSyncPlan']) {
    const snapshot = await this.options.repository.getSnapshot(workspace.accountMid)
    const recovered = await this.options.workspaceStore.recover(workspace.accountMid, workspace.id)
    if ('recovery' in recovered) throw new Error('Old favorite workspace requires rebuild.')
    const marker: FavoriteRepositoryWorkspace = {
      id: workspace.id,
      accountMid: workspace.accountMid,
      status: workspace.status,
      baselineRevision: workspace.baseline?.revision ?? 0,
      continuationAids: [],
      workspaceRef: {
        workspaceId: workspace.id,
        accountMid: workspace.accountMid,
        status: workspace.status,
        baselineRevision: workspace.baseline?.revision ?? 0,
        currentSegmentId: recovered.currentSegmentId,
        overlayRevision: recovered.overlayRevision,
        journalCursor: recovered.journalCursor,
        checksum: recovered.manifestChecksum
      },
      ...(frozenSyncPlan
        ? { frozenSyncPlan: clone(frozenSyncPlan) }
        : snapshot.workspace?.id === workspace.id && snapshot.workspace.frozenSyncPlan
        ? { frozenSyncPlan: clone(snapshot.workspace.frozenSyncPlan) }
        : {})
    }
    await this.options.repository.commit(workspace.accountMid, {
      id: `old-favorite-workspace:${workspace.id}:${randomUUID()}`,
      accountMid: workspace.accountMid,
      issuedAt: this.now(),
      type: 'set-workspace',
      payload: marker
    })
  }

  private remember(
    workspace: OldFavoriteWorkspace,
    currentSegmentId: string,
    descriptors: SegmentDescriptor[],
    frozenIds: Set<string>
  ) {
    this.workspaces.set(workspace.accountMid, workspace)
    this.currentSegments.set(workspace.accountMid, currentSegmentId)
    this.segmentDescriptors.set(workspace.accountMid, descriptors.map(clone))
    this.frozenSegments.set(workspace.accountMid, new Set(frozenIds))
    if (!workspace.segments.length) this.currentSegmentItems.set(workspace.accountMid, [])
  }

  private currentSegment(workspace: OldFavoriteWorkspace) {
    return this.currentSegments.get(workspace.accountMid) ?? workspace.segments[0]?.id ?? ''
  }

  private createSnapshot(workspace: OldFavoriteWorkspace): OldFavoriteWorkspaceSnapshot {
    const currentSegment = workspace.segments[0]
    return {
      version: 1,
      accountMid: workspace.accountMid,
      workspaceId: workspace.id,
      status: workspace.status,
      mode: workspace.mode,
      segmentSize: workspace.segmentSize,
      hasMultipleSegments: workspace.hasMultipleSegments,
      scan: clone(this.scanOverviews.get(workspace.accountMid)?.scan ?? { phase: workspace.status === 'scanning' ? 'inventory' : 'complete', failureCount: 0, mode: workspace.mode }),
      sourceFolders: clone(this.scanOverviews.get(workspace.accountMid)?.sourceFolders ?? []),
      continuationCount: workspace.continuationAids.length,
      segments: (this.segmentDescriptors.get(workspace.accountMid) ?? workspace.segments.map(({ id, index, aids }) => ({ id, index, itemCount: aids.length })))
        .map((segment) => ({
          id: segment.id,
          index: segment.index,
          status: (this.frozenSegments.get(workspace.accountMid)?.has(segment.id) ? 'frozen' : 'previewing') as 'previewing' | 'frozen',
          itemCount: segment.itemCount
        })),
      currentSegment: currentSegment ? {
        id: currentSegment.id,
        aids: [...currentSegment.aids],
        items: clone(this.currentSegmentItems.get(workspace.accountMid) ?? []).filter((item) => currentSegment.aids.includes(item.aid))
      } : null,
      classifications: Object.fromEntries(Object.entries(workspace.classifications).map(([aid, classification]) => [aid, {
        aid: classification.aid,
        targetLedgerIds: [...classification.targetLedgerIds],
        source: classification.source
      }])),
      history: { cursor: workspace.historyCursor, length: workspace.history.length }
    }
  }

  private now() {
    return this.options.now?.() ?? new Date().toISOString()
  }

  private matchesMarker(workspace: OldFavoriteWorkspace, marker: FavoriteRepositoryWorkspace) {
    return workspace.id === marker.id && marker.workspaceRef.workspaceId === marker.id &&
      workspace.accountMid === marker.accountMid &&
      workspace.status === marker.status && (workspace.baseline?.revision ?? 0) === marker.baselineRevision
  }

  private queue<T>(operation: () => Promise<T>) {
    const run = this.operationTail.then(operation, operation)
    this.operationTail = run.then(() => undefined, () => undefined)
    return run
  }
}
