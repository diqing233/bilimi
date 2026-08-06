import { parseFavoriteLedgerRules } from '../../src/shared/favoriteLedgerConstraints'
import { assertDeepSeekRequestEnabled } from './deepseekFeatureAccess'
import type {
  DeepSeekArchiveVideoResult,
  DeepSeekArchiveMode,
  DeepSeekGenerateRequest,
  DeepSeekGenerateResult,
  FavoriteArchiveMultiMode,
  FavoriteLedger
} from '../../src/shared/types'
import { OldFavoriteWorkspaceCoordinator } from './oldFavoriteWorkspaceCoordinator'
import type {
  OldFavoriteWorkspaceDeepSeekFailure,
  OldFavoriteWorkspaceDeepSeekProcessedItem,
  OldFavoriteWorkspaceDeepSeekRunCheckpoint,
  OldFavoriteWorkspaceDeepSeekResult,
  OldFavoriteWorkspaceSnapshot
} from '../../src/shared/oldFavoriteWorkspace'

type ArchiveRequest = Extract<DeepSeekGenerateRequest, { kind: 'favorite-archive-organize' }>

const archiveChunkSize = 20
type WorkspaceExpectation = {
  workspaceId: string
  currentSegmentId: string
  selectedSourceFolderIds: string[]
  classifications: Record<string, { targetLedgerIds: string[]; source: string }>
}

type ActiveDeepSeekRun = {
  cancelRequested: boolean
  controller: AbortController
  work?: Promise<OldFavoriteWorkspaceDeepSeekResult>
}
type DurableWorkPlan = Required<Pick<OldFavoriteWorkspaceDeepSeekRunCheckpoint,
  'version' | 'sourceFolderRevision' | 'segmentWork' | 'totalVideoCount' | 'requestGroups' |
  'originalTargetLedgerIdsByAid' | 'successfulAids' | 'pendingAids' | 'failedAids'>> & OldFavoriteWorkspaceDeepSeekRunCheckpoint
type SegmentOrganizeResult = OldFavoriteWorkspaceDeepSeekResult & {
  requestGroupUpdates?: NonNullable<OldFavoriteWorkspaceDeepSeekRunCheckpoint['requestGroups']>
}
type SettledDeepSeekGroup = {
  successfulAids: number[]
  failedAids: number[]
  requestGroupUpdates: NonNullable<OldFavoriteWorkspaceDeepSeekRunCheckpoint['requestGroups']>
}
type FailedDeepSeekSegment = { segmentId: string; aids: number[] }
type FailedDeepSeekRun = {
  workspaceId: string
  mode: DeepSeekArchiveMode
  scope: 'current' | 'all'
  segments: FailedDeepSeekSegment[]
}
type DeepSeekPreferences = Pick<{
  deepseekArchiveOrganizationEnabled: boolean
  favoriteArchiveMultiMode: FavoriteArchiveMultiMode
  favoriteLedgers: FavoriteLedger[]
}, 'deepseekArchiveOrganizationEnabled' | 'favoriteArchiveMultiMode' | 'favoriteLedgers'>

function multiArchiveLimit(mode: FavoriteArchiveMultiMode) {
  return mode === 'three' ? 3 : mode === 'two' ? 2 : 1
}

function uniqueTargets(targets: string[]) {
  return [...new Set(targets.map((target) => target.trim()).filter(Boolean))]
}

function mergeProcessedItems(
  current: OldFavoriteWorkspaceDeepSeekProcessedItem[],
  next: OldFavoriteWorkspaceDeepSeekProcessedItem[]
) {
  const merged = new Map(current.map((item) => [item.aid, item]))
  next.forEach((item) => merged.set(item.aid, item))
  return [...merged.values()]
}

function isUnavailableArchiveItem(item: { unavailable?: boolean; title?: string; author?: string }) {
  return item.unavailable === true
    || item.title?.trim() === '已失效视频'
    || item.author?.trim() === '账号已注销'
}

/** Builds, validates, and applies a DeepSeek batch entirely in the main process. */
export class OldFavoriteWorkspaceDeepSeekService {
  private destructiveMaintenance = false
  private readonly failedRuns = new Map<string, FailedDeepSeekRun>()
  private readonly activeRuns = new Map<string, ActiveDeepSeekRun>()
  private readonly pendingAllRuns = new Map<string, OldFavoriteWorkspaceDeepSeekRunCheckpoint>()
  private readonly pendingResumeRequests = new Map<string, Promise<OldFavoriteWorkspaceDeepSeekResult | null>>()

  constructor(private readonly options: {
  coordinator: Pick<OldFavoriteWorkspaceCoordinator, 'getSnapshot' | 'applyDeepSeekClassificationBatch'>
    & Partial<Pick<OldFavoriteWorkspaceCoordinator, 'selectSegment' | 'getDeepSeekRunCheckpoint' | 'setDeepSeekRunCheckpoint'>>
    preferences: () => DeepSeekPreferences
    ledgersForAccount?: (accountMid: string, preferences: Pick<DeepSeekPreferences, 'favoriteLedgers'>) => FavoriteLedger[]
    generate: (request: ArchiveRequest, signal?: AbortSignal) => Promise<DeepSeekGenerateResult>
    retryDelay?: (milliseconds: number) => Promise<void>
  }) {}

  async organizeCurrentSegment(
    accountMid: string,
    mode: DeepSeekArchiveMode = 'all',
    onProgress?: (progress: OldFavoriteWorkspaceDeepSeekResult['progress']) => void
  ): Promise<OldFavoriteWorkspaceDeepSeekResult> {
    return this.runOrganize(accountMid, mode, undefined, onProgress)
  }

  /** Runs the same bounded classifier serially across every unsaved ready batch. */
  async organizeAllSegments(
    accountMid: string,
    mode: DeepSeekArchiveMode = 'all',
    onProgress?: (progress: OldFavoriteWorkspaceDeepSeekResult['progress']) => void
  ): Promise<OldFavoriteWorkspaceDeepSeekResult> {
    if (!this.options.coordinator.selectSegment) throw new Error('Old favorite workspace batch selection is unavailable.')
    if (this.destructiveMaintenance) throw new Error('DeepSeek organization is unavailable during destructive maintenance.')
    if (this.activeRuns.has(accountMid)) throw new Error('DeepSeek is already organizing this old favorite workspace.')
    const initial = await this.options.coordinator.getSnapshot(accountMid)
    if (!initial || 'recovery' in initial || initial.status !== 'previewing') {
      throw new Error('Old favorite workspace is not ready for DeepSeek classification.')
    }
    const originalSegmentId = initial.currentSegment?.id
    const priorCheckpoint = await this.options.coordinator.getDeepSeekRunCheckpoint?.(accountMid)
    const resumedCheckpoint = priorCheckpoint?.workspaceId === initial.workspaceId &&
      priorCheckpoint.scope === 'all' && priorCheckpoint.mode === mode
      ? priorCheckpoint
      : undefined
    const segmentIds = initial.segments
      .filter((segment) => segment.status !== 'frozen' && segment.readiness !== 'saved')
      .map((segment) => segment.id)
    if (!segmentIds.length || !originalSegmentId) {
      return {
        snapshot: initial,
        referencedConstraintLedgerNames: [],
        progress: { totalChunks: 0, completedChunks: 0, totalVideoCount: 0, successfulVideoCount: 0, failedVideoCount: 0 },
        failures: []
      }
    }
    const frozenSegmentIds = new Set(resumedCheckpoint?.completedSegmentIds ?? [])
    const currentReadyPlan = await this.buildAllRunPlan(accountMid, initial, mode, originalSegmentId, frozenSegmentIds)
    const plan = resumedCheckpoint?.version === 1 && resumedCheckpoint.segmentWork && resumedCheckpoint.requestGroups &&
      resumedCheckpoint.sourceFolderRevision !== undefined && resumedCheckpoint.totalVideoCount !== undefined &&
      resumedCheckpoint.successfulAids && resumedCheckpoint.pendingAids && resumedCheckpoint.failedAids
      ? this.mergeReadyWork(this.normalizePlan({
          ...resumedCheckpoint,
          version: 1,
          sourceFolderRevision: resumedCheckpoint.sourceFolderRevision,
          segmentWork: resumedCheckpoint.segmentWork,
          totalVideoCount: resumedCheckpoint.totalVideoCount,
          originalTargetLedgerIdsByAid: resumedCheckpoint.originalTargetLedgerIdsByAid ?? currentReadyPlan.originalTargetLedgerIdsByAid,
          requestGroups: resumedCheckpoint.requestGroups,
          successfulAids: resumedCheckpoint.successfulAids,
          pendingAids: resumedCheckpoint.pendingAids,
          failedAids: resumedCheckpoint.failedAids,
          canceled: false
        }), currentReadyPlan)
      : resumedCheckpoint
        ? this.upgradeLegacyPlan(currentReadyPlan, resumedCheckpoint)
        : currentReadyPlan
    await this.options.coordinator.setDeepSeekRunCheckpoint?.(accountMid, plan)
    this.pendingAllRuns.set(accountMid, structuredClone(plan))
    const completedSegmentIds = new Set(plan.completedSegmentIds)
    const successfulAids = new Set(plan.successfulAids)
    const failedAids = new Set(plan.failedAids)
    const run: ActiveDeepSeekRun = { cancelRequested: false, controller: new AbortController() }
    const frozenPreferences = this.options.preferences()
    this.activeRuns.set(accountMid, run)
    let final = initial
    const failures: OldFavoriteWorkspaceDeepSeekFailure[] = []
    const failedSegments: FailedDeepSeekSegment[] = []
    const referencedConstraintLedgerNames = new Set<string>()
    let processedItems: OldFavoriteWorkspaceDeepSeekProcessedItem[] = []
    const aggregate = {
      totalChunks: plan.requestGroups.length,
      completedChunks: plan.requestGroups.filter((group) => group.status !== 'pending').length,
      totalVideoCount: plan.totalVideoCount,
      successfulVideoCount: successfulAids.size,
      failedVideoCount: failedAids.size
    }
    let deferredSegmentCount = 0
    let selectedSegmentId = originalSegmentId
    const persistCheckpoint = async (waitingSegmentIds: string[], canceled = run.cancelRequested, failed = false) => {
      if (!this.options.coordinator.setDeepSeekRunCheckpoint) return
      const pendingAids = plan.segmentWork.flatMap((segment) => segment.aids)
        .filter((aid) => !successfulAids.has(aid) && !failedAids.has(aid))
      const next: DurableWorkPlan = this.normalizePlan({
        ...plan,
        completedSegmentIds: [...completedSegmentIds].sort(),
        waitingSegmentIds: [...new Set(waitingSegmentIds)].sort(),
        successfulAids: [...successfulAids],
        pendingAids,
        failedAids: [...failedAids],
        canceled,
        ...(failed ? { failed: true } : {})
      })
      await this.options.coordinator.setDeepSeekRunCheckpoint(accountMid, next)
      this.pendingAllRuns.set(accountMid, structuredClone(next))
    }
    try {
      for (const segmentWork of plan.segmentWork) {
        const segmentId = segmentWork.segmentId
        if (run.cancelRequested) break
        const remainingAids = segmentWork.aids.filter((aid) => !successfulAids.has(aid))
        if (completedSegmentIds.has(segmentId) || !remainingAids.length) continue
        const readinessSnapshot = await this.options.coordinator.getSnapshot(accountMid)
        if (!readinessSnapshot || 'recovery' in readinessSnapshot || readinessSnapshot.workspaceId !== initial.workspaceId || readinessSnapshot.status !== 'previewing') {
          throw new Error('Old favorite workspace changed while DeepSeek was waiting for the next batch.')
        }
        const summary = readinessSnapshot.segments.find((segment) => segment.id === segmentId)
        if (!summary || summary.status === 'frozen' || summary.readiness === 'saved') continue
        if (summary.readiness !== 'ready') {
          deferredSegmentCount += 1
          continue
        }
        selectedSegmentId = readinessSnapshot.currentSegment?.id ?? selectedSegmentId
        if (selectedSegmentId !== segmentId) {
          await this.options.coordinator.selectSegment(accountMid, segmentId)
          selectedSegmentId = segmentId
        }
        const selected = await this.options.coordinator.getSnapshot(accountMid)
        const selectedSummary = selected && !('recovery' in selected)
          ? selected.segments.find((segment) => segment.id === segmentId)
          : undefined
        if (!selectedSummary || selectedSummary.status === 'frozen' || selectedSummary.readiness === 'saved') continue
        const beforeSuccessful = aggregate.successfulVideoCount
        const beforeFailed = aggregate.failedVideoCount
        const waitingSegmentIds = readinessSnapshot.segments
          .filter((segment) => !completedSegmentIds.has(segment.id) && segment.status !== 'frozen' && segment.readiness !== 'ready' && segment.readiness !== 'saved')
          .map((segment) => segment.id)
        const segmentResult = await this.organize(accountMid, mode, {
          workspaceId: initial.workspaceId,
          segmentId,
          mode,
          aids: remainingAids
        }, (progress) => {
          processedItems = mergeProcessedItems(processedItems, progress.processedItems ?? [])
          onProgress?.({
            totalChunks: aggregate.totalChunks,
            completedChunks: Math.min(aggregate.totalChunks, aggregate.completedChunks + progress.completedChunks),
            totalVideoCount: aggregate.totalVideoCount,
            successfulVideoCount: beforeSuccessful + progress.successfulVideoCount,
            failedVideoCount: beforeFailed + progress.failedVideoCount,
            ...(processedItems.length ? { processedItems } : {})
          })
        }, run, frozenPreferences, async (settled) => {
          settled.successfulAids.forEach((aid) => {
            failedAids.delete(aid)
            successfulAids.add(aid)
          })
          settled.failedAids.forEach((aid) => {
            successfulAids.delete(aid)
            failedAids.add(aid)
          })
          this.mergeRequestGroupUpdates(plan.requestGroups, settled.requestGroupUpdates)
          await persistCheckpoint(waitingSegmentIds)
        })
        final = segmentResult.snapshot
        segmentResult.failures.forEach((failure) => failures.push({ ...failure, chunkIndex: failures.length + failure.chunkIndex }))
        const failedSegmentAids = segmentResult.failures.flatMap((failure) => failure.aids)
        if (failedSegmentAids.length) failedSegments.push({ segmentId, aids: this.normalizeAids(failedSegmentAids) })
        segmentResult.referencedConstraintLedgerNames.forEach((name) => referencedConstraintLedgerNames.add(name))
        const segmentFailedAids = new Set(segmentResult.failures.flatMap((failure) => failure.aids))
        remainingAids.filter((aid) => !segmentFailedAids.has(aid)).forEach((aid) => successfulAids.add(aid))
        segmentFailedAids.forEach((aid) => failedAids.add(aid))
        aggregate.completedChunks = Math.min(aggregate.totalChunks, aggregate.completedChunks + segmentResult.progress.completedChunks)
        aggregate.successfulVideoCount = successfulAids.size
        aggregate.failedVideoCount = failedAids.size
        this.mergeRequestGroupUpdates(plan.requestGroups, segmentResult.requestGroupUpdates ?? [])
        if (!segmentFailedAids.size) completedSegmentIds.add(segmentId)
        await persistCheckpoint(readinessSnapshot.segments
          .filter((segment) => !completedSegmentIds.has(segment.id) && segment.status !== 'frozen' && segment.readiness !== 'ready' && segment.readiness !== 'saved')
          .map((segment) => segment.id))
        if (segmentResult.canceled) break
      }
    } finally {
      if (selectedSegmentId !== originalSegmentId) {
        await this.options.coordinator.selectSegment(accountMid, originalSegmentId).catch(() => undefined)
        const restored = await this.options.coordinator.getSnapshot(accountMid)
        if (restored && !('recovery' in restored)) final = restored
      }
      if (this.activeRuns.get(accountMid) === run) this.activeRuns.delete(accountMid)
    }
    const latest = await this.options.coordinator.getSnapshot(accountMid)
    const waitingSegmentIds = latest && !('recovery' in latest) && latest.workspaceId === initial.workspaceId
      ? latest.segments
        .filter((segment) => !completedSegmentIds.has(segment.id) && segment.status !== 'frozen' && segment.readiness !== 'ready' && segment.readiness !== 'saved')
        .map((segment) => segment.id)
      : []
    deferredSegmentCount = waitingSegmentIds.length
    const hasIncompleteReadySegments = latest && !('recovery' in latest) && latest.workspaceId === initial.workspaceId
      ? latest.segments.some((segment) => !completedSegmentIds.has(segment.id) && segment.status !== 'frozen' && segment.readiness !== 'saved')
      : false
    if (run.cancelRequested) await persistCheckpoint(waitingSegmentIds)
    else if (failedSegments.length) await persistCheckpoint(waitingSegmentIds, false, true)
    else if (hasIncompleteReadySegments) await persistCheckpoint(waitingSegmentIds)
    else {
      await this.options.coordinator.setDeepSeekRunCheckpoint?.(accountMid, null)
      this.pendingAllRuns.delete(accountMid)
    }
    this.rememberFailedRun(accountMid, initial.workspaceId, mode, 'all', failedSegments)
    return {
      snapshot: final,
      referencedConstraintLedgerNames: [...referencedConstraintLedgerNames],
      progress: aggregate,
      failures,
      canceled: run.cancelRequested,
      deferredSegmentCount
    }
  }

  private async buildAllRunPlan(
    accountMid: string,
    initial: OldFavoriteWorkspaceSnapshot,
    mode: DeepSeekArchiveMode,
    originalSegmentId: string,
    excludedSegmentIds = new Set<string>()
  ): Promise<DurableWorkPlan> {
    const segmentWork: DurableWorkPlan['segmentWork'] = []
    const originalTargetLedgerIdsByAid: Record<string, string[]> = {}
    const waitingSegmentIds: string[] = []
    let selectedSegmentId = initial.currentSegment?.id ?? originalSegmentId
    try {
      for (const summary of initial.segments) {
        if (summary.status === 'frozen' || summary.readiness === 'saved') continue
        if (excludedSegmentIds.has(summary.id)) continue
        if (summary.readiness !== 'ready') {
          waitingSegmentIds.push(summary.id)
          continue
        }
        if (selectedSegmentId !== summary.id) {
          await this.options.coordinator.selectSegment?.(accountMid, summary.id)
          selectedSegmentId = summary.id
        }
        const snapshot = await this.options.coordinator.getSnapshot(accountMid)
        if (!snapshot || 'recovery' in snapshot || snapshot.workspaceId !== initial.workspaceId || !snapshot.currentSegment) {
          throw new Error('Old favorite workspace changed while the DeepSeek work plan was being created.')
        }
        const selectedFolderIds = new Set(snapshot.sourceFolders
          .filter((folder) => !folder.isBilimiWorkFolder && folder.selected)
          .map((folder) => folder.id))
        const aids = snapshot.currentSegment.items.filter((item) =>
          !isUnavailableArchiveItem(item) && item.sourceFolderIds.some((folderId) => selectedFolderIds.has(folderId)))
          .filter((item) => {
            const classification = snapshot.classifications[String(item.aid)]
            if (mode === 'unclassified-only') return !classification?.targetLedgerIds.length
            if (mode === 'low-confidence-and-unclassified') return !classification?.targetLedgerIds.length || classification.source === 'system-low'
            return true
          }).map((item) => item.aid)
        const normalizedAids = this.normalizeAids(aids)
        segmentWork.push({ segmentId: summary.id, index: summary.index, aids: normalizedAids })
        for (const aid of normalizedAids) {
          originalTargetLedgerIdsByAid[String(aid)] = [
            ...(snapshot.classifications[String(aid)]?.targetLedgerIds ?? [])
          ]
        }
      }
    } finally {
      if (selectedSegmentId !== originalSegmentId) await this.options.coordinator.selectSegment?.(accountMid, originalSegmentId)
    }
    const requestGroups = segmentWork.flatMap((segment) => {
      const groups = []
      for (let offset = 0; offset < segment.aids.length; offset += archiveChunkSize) {
        const aids = segment.aids.slice(offset, offset + archiveChunkSize)
        groups.push({
          id: `${segment.segmentId}:group:${offset / archiveChunkSize + 1}:${aids[0] ?? 0}-${aids.at(-1) ?? 0}`,
          segmentId: segment.segmentId,
          aids,
          status: 'pending' as const,
          timeoutCount: 0
        })
      }
      return groups
    })
    const pendingAids = segmentWork.flatMap((segment) => segment.aids)
    return this.normalizePlan({
      version: 1,
      workspaceId: initial.workspaceId,
      mode,
      scope: 'all',
      sourceFolderRevision: initial.sourceFolders.filter((folder) => folder.selected).map((folder) => folder.id).sort().join('|'),
      segmentWork,
      totalVideoCount: pendingAids.length,
      originalTargetLedgerIdsByAid,
      requestGroups,
      successfulAids: [],
      pendingAids,
      failedAids: [],
      completedSegmentIds: [],
      waitingSegmentIds,
      canceled: false
    })
  }

  private normalizePlan(plan: DurableWorkPlan): DurableWorkPlan {
    return {
      ...plan,
      version: 1,
      segmentWork: plan.segmentWork.map((segment) => ({ ...segment, aids: this.normalizeAids(segment.aids) })),
      requestGroups: plan.requestGroups.map((group) => ({ ...group, aids: this.normalizeAids(group.aids) })),
      originalTargetLedgerIdsByAid: Object.fromEntries(Object.entries(plan.originalTargetLedgerIdsByAid)
        .map(([aid, targets]) => [aid, uniqueTargets(targets).sort()])),
      successfulAids: this.normalizeAids(plan.successfulAids),
      pendingAids: this.normalizeAids(plan.pendingAids),
      failedAids: this.normalizeAids(plan.failedAids),
      completedSegmentIds: [...new Set(plan.completedSegmentIds)].sort(),
      waitingSegmentIds: [...new Set(plan.waitingSegmentIds)].sort()
    }
  }

  private upgradeLegacyPlan(
    current: DurableWorkPlan,
    legacy: OldFavoriteWorkspaceDeepSeekRunCheckpoint
  ): DurableWorkPlan {
    const completed = new Set(legacy.completedSegmentIds)
    const successfulAids = current.segmentWork
      .filter((segment) => completed.has(segment.segmentId))
      .flatMap((segment) => segment.aids)
    return this.normalizePlan({
      ...current,
      completedSegmentIds: legacy.completedSegmentIds,
      waitingSegmentIds: current.waitingSegmentIds,
      successfulAids,
      pendingAids: current.pendingAids.filter((aid) => !successfulAids.includes(aid)),
      canceled: false,
      failed: legacy.failed
    })
  }

  private mergeReadyWork(existing: DurableWorkPlan, current: DurableWorkPlan): DurableWorkPlan {
    const completedSegments = new Set(existing.completedSegmentIds)
    const readySegments = new Set(current.segmentWork.map((segment) => segment.segmentId))
    const retainedSegmentWork = existing.segmentWork.filter((segment) =>
      completedSegments.has(segment.segmentId) || readySegments.has(segment.segmentId))
    const retainedSegmentIds = new Set(retainedSegmentWork.map((segment) => segment.segmentId))
    const retainedAids = new Set(retainedSegmentWork.flatMap((segment) => segment.aids))
    const knownSegments = new Set(retainedSegmentWork.map((segment) => segment.segmentId))
    const newSegments = current.segmentWork.filter((segment) => !knownSegments.has(segment.segmentId))
    const retainedGroups = existing.requestGroups.filter((group) => retainedSegmentIds.has(group.segmentId))
    const knownGroups = new Set(retainedGroups.map((group) => group.id))
    const newGroups = current.requestGroups.filter((group) => !knownGroups.has(group.id))
    const successful = new Set(existing.successfulAids.filter((aid) => retainedAids.has(aid)))
    const failed = new Set(existing.failedAids.filter((aid) => retainedAids.has(aid)))
    const segmentWork = [...retainedSegmentWork, ...newSegments].sort((left, right) => left.index - right.index)
    const allAids = segmentWork.flatMap((segment) => segment.aids)
    const allAidSet = new Set(allAids)
    return this.normalizePlan({
      ...existing,
      segmentWork,
      requestGroups: [...retainedGroups, ...newGroups],
      originalTargetLedgerIdsByAid: Object.fromEntries(Object.entries({
        ...current.originalTargetLedgerIdsByAid,
        ...existing.originalTargetLedgerIdsByAid
      }).filter(([aid]) => allAidSet.has(Number(aid)))),
      totalVideoCount: allAids.length,
      successfulAids: [...successful],
      pendingAids: allAids.filter((aid) => !successful.has(aid) && !failed.has(aid)),
      failedAids: [...failed],
      waitingSegmentIds: current.waitingSegmentIds,
      canceled: false
    })
  }

  /** Continues a durable all-batch intent once tag enrichment publishes a ready segment. */
  resumePendingAllSegments(
    accountMid: string,
    readySegmentIds: string[],
    onProgress?: (progress: OldFavoriteWorkspaceDeepSeekResult['progress']) => void
  ): Promise<OldFavoriteWorkspaceDeepSeekResult | null> {
    const existing = this.pendingResumeRequests.get(accountMid)
    if (existing) return existing
    const work = this.resumePendingAllSegmentsUnsafe(accountMid, readySegmentIds, onProgress)
    this.pendingResumeRequests.set(accountMid, work)
    const release = () => {
      if (this.pendingResumeRequests.get(accountMid) === work) this.pendingResumeRequests.delete(accountMid)
    }
    void work.then(release, release)
    return work
  }

  private async resumePendingAllSegmentsUnsafe(
    accountMid: string,
    readySegmentIds: string[],
    onProgress?: (progress: OldFavoriteWorkspaceDeepSeekResult['progress']) => void
  ): Promise<OldFavoriteWorkspaceDeepSeekResult | null> {
    if (this.destructiveMaintenance || this.activeRuns.has(accountMid)) return null
    // A durable checkpoint survives restart, but automatic continuation does not.
    // Only the service instance that started this all-batch run may consume ready notifications.
    if (!this.pendingAllRuns.has(accountMid)) return null
    const checkpoint = await this.options.coordinator.getDeepSeekRunCheckpoint?.(accountMid)
    if (!checkpoint || checkpoint.scope !== 'all' || checkpoint.canceled || checkpoint.failed ||
      !readySegmentIds.some((segmentId) => checkpoint.waitingSegmentIds.includes(segmentId))) return null
    this.pendingAllRuns.set(accountMid, structuredClone(checkpoint))
    return this.organizeAllSegments(accountMid, checkpoint.mode, onProgress)
  }

  /** Retries only the main-process remembered failed chunk aids for the active workspace. */
  async retryFailedChunks(
    accountMid: string,
    onProgress?: (progress: OldFavoriteWorkspaceDeepSeekResult['progress']) => void
  ): Promise<SegmentOrganizeResult> {
    let failedRun = this.failedRuns.get(accountMid)
    if (!failedRun?.segments.some((segment) => segment.aids.length)) {
      const checkpoint = await this.options.coordinator.getDeepSeekRunCheckpoint?.(accountMid)
      if (checkpoint?.version === 1 && checkpoint.scope === 'all' && checkpoint.segmentWork && checkpoint.failedAids?.length) {
        const failedAids = new Set(checkpoint.failedAids)
        const segments = checkpoint.segmentWork
          .map((segment) => ({ segmentId: segment.segmentId, aids: segment.aids.filter((aid) => failedAids.has(aid)) }))
          .filter((segment) => segment.aids.length)
        if (segments.length) {
          failedRun = { workspaceId: checkpoint.workspaceId, mode: checkpoint.mode, scope: 'all', segments }
          this.failedRuns.set(accountMid, failedRun)
        }
      }
    }
    if (!failedRun?.segments.some((segment) => segment.aids.length)) throw new Error('Old favorite workspace has no failed DeepSeek chunks to retry.')
    if (failedRun.scope === 'all') return this.retryFailedSegments(accountMid, failedRun, onProgress)
    const [segment] = failedRun.segments
    if (!segment) throw new Error('Old favorite workspace has no failed DeepSeek chunks to retry.')
    return this.runOrganize(accountMid, failedRun.mode, {
      workspaceId: failedRun.workspaceId,
      segmentId: segment.segmentId,
      mode: failedRun.mode,
      aids: segment.aids
    }, onProgress)
  }

  cancelCurrentSegment(accountMid: string) {
    const run = this.activeRuns.get(accountMid)
    if (run) {
      run.cancelRequested = true
      run.controller.abort()
      return true
    }
    const checkpoint = this.pendingAllRuns.get(accountMid)
    if (!checkpoint) return false
    const canceled = { ...checkpoint, canceled: true }
    this.pendingAllRuns.set(accountMid, canceled)
    void this.options.coordinator.setDeepSeekRunCheckpoint?.(accountMid, canceled).catch(() => undefined)
    return true
  }

  async cancelPendingAllSegments(accountMid: string) {
    const activeRun = this.activeRuns.get(accountMid)
    if (activeRun) {
      this.cancelCurrentSegment(accountMid)
      while (this.activeRuns.get(accountMid) === activeRun) {
        await new Promise<void>((resolve) => setTimeout(resolve, 10))
      }
      return true
    }
    if (this.cancelCurrentSegment(accountMid)) return true
    const checkpoint = await this.options.coordinator.getDeepSeekRunCheckpoint?.(accountMid)
    if (!checkpoint || checkpoint.scope !== 'all') return false
    const canceled = { ...checkpoint, canceled: true }
    this.pendingAllRuns.set(accountMid, canceled)
    await this.options.coordinator.setDeepSeekRunCheckpoint?.(accountMid, canceled)
    return true
  }

  /** Fences future organization and waits for each in-flight request to relinquish ownership. */
  async quiesceForDestructiveMaintenance() {
    this.destructiveMaintenance = true
    this.failedRuns.clear()
    for (const [accountMid, checkpoint] of this.pendingAllRuns) {
      const canceled = { ...checkpoint, canceled: true }
      this.pendingAllRuns.set(accountMid, canceled)
      await this.options.coordinator.setDeepSeekRunCheckpoint?.(accountMid, canceled).catch(() => undefined)
    }
    for (const run of this.activeRuns.values()) {
      run.cancelRequested = true
      run.controller.abort()
    }
    while (this.activeRuns.size) {
      const work = [...this.activeRuns.values()].flatMap((run) => run.work ? [run.work] : [])
      if (work.length) await Promise.allSettled(work)
      else await new Promise<void>((resolve) => setTimeout(resolve, 10))
    }
  }

  resumeAfterDestructiveMaintenance() {
    this.destructiveMaintenance = false
    this.failedRuns.clear()
    this.pendingAllRuns.clear()
    this.pendingResumeRequests.clear()
  }

  private async runOrganize(
    accountMid: string,
    mode: DeepSeekArchiveMode,
    retry: { workspaceId: string; segmentId: string; mode: DeepSeekArchiveMode; aids: number[] } | undefined,
    onProgress: ((progress: OldFavoriteWorkspaceDeepSeekResult['progress']) => void) | undefined
  ) {
    if (this.destructiveMaintenance) {
      throw new Error('DeepSeek organization is unavailable during destructive maintenance.')
    }
    if (this.activeRuns.has(accountMid)) throw new Error('DeepSeek is already organizing this old favorite segment.')
    const run: ActiveDeepSeekRun = { cancelRequested: false, controller: new AbortController() }
    this.activeRuns.set(accountMid, run)
    try {
      const work = this.organize(accountMid, mode, retry, onProgress, run)
      run.work = work
      return await work
    } finally {
      if (this.activeRuns.get(accountMid) === run) this.activeRuns.delete(accountMid)
    }
  }

  private async retryFailedSegments(
    accountMid: string,
    failedRun: FailedDeepSeekRun,
    onProgress?: (progress: OldFavoriteWorkspaceDeepSeekResult['progress']) => void
  ): Promise<OldFavoriteWorkspaceDeepSeekResult> {
    if (!this.options.coordinator.selectSegment) throw new Error('Old favorite workspace batch selection is unavailable.')
    if (this.destructiveMaintenance) throw new Error('DeepSeek organization is unavailable during destructive maintenance.')
    if (this.activeRuns.has(accountMid)) throw new Error('DeepSeek is already organizing this old favorite workspace.')
    const initial = await this.options.coordinator.getSnapshot(accountMid)
    if (!initial || 'recovery' in initial || initial.status !== 'previewing' || initial.workspaceId !== failedRun.workspaceId) {
      throw new Error('Old favorite workspace changed before failed DeepSeek chunks could be retried.')
    }
    const originalSegmentId = initial.currentSegment?.id
    if (!originalSegmentId) throw new Error('Old favorite workspace is not ready for DeepSeek classification.')
    const run: ActiveDeepSeekRun = { cancelRequested: false, controller: new AbortController() }
    const frozenPreferences = this.options.preferences()
    const aggregate = { totalChunks: 0, completedChunks: 0, totalVideoCount: 0, successfulVideoCount: 0, failedVideoCount: 0 }
    const failures: OldFavoriteWorkspaceDeepSeekFailure[] = []
    const remainingFailures: FailedDeepSeekSegment[] = []
    const referencedConstraintLedgerNames = new Set<string>()
    let durableCheckpoint = await this.options.coordinator.getDeepSeekRunCheckpoint?.(accountMid)
    const checkpointSuccessfulAids = new Set(durableCheckpoint?.successfulAids ?? [])
    const checkpointFailedAids = new Set(durableCheckpoint?.failedAids ?? [])
    let final = initial
    this.activeRuns.set(accountMid, run)
    try {
      for (let index = 0; index < failedRun.segments.length; index += 1) {
        const failedSegment = failedRun.segments[index]!
        if (run.cancelRequested) {
          remainingFailures.push(...failedRun.segments.slice(index))
          break
        }
        const current = await this.options.coordinator.getSnapshot(accountMid)
        if (!current || 'recovery' in current || current.status !== 'previewing' || current.workspaceId !== failedRun.workspaceId) {
          throw new Error('Old favorite workspace changed before failed DeepSeek chunks could be retried.')
        }
        const summary = current.segments.find((segment) => segment.id === failedSegment.segmentId)
        if (!summary || summary.status === 'frozen' || summary.readiness === 'saved') continue
        await this.options.coordinator.selectSegment(accountMid, failedSegment.segmentId)
        const segmentResult = await this.organize(accountMid, failedRun.mode, {
          workspaceId: failedRun.workspaceId,
          segmentId: failedSegment.segmentId,
          mode: failedRun.mode,
          aids: failedSegment.aids
        }, (progress) => {
          onProgress?.({
            totalChunks: aggregate.totalChunks + progress.totalChunks,
            completedChunks: aggregate.completedChunks + progress.completedChunks,
            totalVideoCount: aggregate.totalVideoCount + progress.totalVideoCount,
            successfulVideoCount: aggregate.successfulVideoCount + progress.successfulVideoCount,
            failedVideoCount: aggregate.failedVideoCount + progress.failedVideoCount
          })
        }, run, frozenPreferences, async (settled) => {
          if (!durableCheckpoint || durableCheckpoint.workspaceId !== failedRun.workspaceId || durableCheckpoint.scope !== 'all') return
          settled.successfulAids.forEach((aid) => {
            checkpointFailedAids.delete(aid)
            checkpointSuccessfulAids.add(aid)
          })
          settled.failedAids.forEach((aid) => {
            checkpointSuccessfulAids.delete(aid)
            checkpointFailedAids.add(aid)
          })
          const requestGroups = [...(durableCheckpoint.requestGroups ?? [])]
          this.mergeRequestGroupUpdates(requestGroups, settled.requestGroupUpdates)
          const allAids = durableCheckpoint.segmentWork?.flatMap((segment) => segment.aids) ?? []
          durableCheckpoint = {
            ...durableCheckpoint,
            requestGroups,
            successfulAids: this.normalizeAids([...checkpointSuccessfulAids]),
            pendingAids: this.normalizeAids(allAids.filter((aid) => !checkpointSuccessfulAids.has(aid) && !checkpointFailedAids.has(aid))),
            failedAids: this.normalizeAids([...checkpointFailedAids]),
            canceled: false,
            failed: checkpointFailedAids.size > 0
          }
          await this.options.coordinator.setDeepSeekRunCheckpoint?.(accountMid, durableCheckpoint)
          this.pendingAllRuns.set(accountMid, structuredClone(durableCheckpoint))
        })
        final = segmentResult.snapshot
        const failedAids = segmentResult.failures.flatMap((failure) => failure.aids)
        if (failedAids.length) remainingFailures.push({ segmentId: failedSegment.segmentId, aids: this.normalizeAids(failedAids) })
        segmentResult.failures.forEach((failure) => failures.push({ ...failure, chunkIndex: failures.length + failure.chunkIndex }))
        segmentResult.referencedConstraintLedgerNames.forEach((name) => referencedConstraintLedgerNames.add(name))
        aggregate.totalChunks += segmentResult.progress.totalChunks
        aggregate.completedChunks += segmentResult.progress.completedChunks
        aggregate.totalVideoCount += segmentResult.progress.totalVideoCount
        aggregate.successfulVideoCount += segmentResult.progress.successfulVideoCount
        aggregate.failedVideoCount += segmentResult.progress.failedVideoCount
        if (segmentResult.canceled) {
          remainingFailures.push(...failedRun.segments.slice(index + 1))
          break
        }
      }
    } finally {
      await Promise.resolve(this.options.coordinator.selectSegment(accountMid, originalSegmentId)).catch(() => undefined)
      const restored = await this.options.coordinator.getSnapshot(accountMid)
      if (restored && !('recovery' in restored)) final = restored
      if (this.activeRuns.get(accountMid) === run) this.activeRuns.delete(accountMid)
    }
    this.rememberFailedRun(accountMid, failedRun.workspaceId, failedRun.mode, 'all', remainingFailures)
    const checkpoint = durableCheckpoint ?? await this.options.coordinator.getDeepSeekRunCheckpoint?.(accountMid)
    if (checkpoint?.workspaceId === failedRun.workspaceId && checkpoint.scope === 'all') {
      if (remainingFailures.length) {
        await this.options.coordinator.setDeepSeekRunCheckpoint?.(accountMid, { ...checkpoint, canceled: false, failed: true })
      } else if (checkpoint.waitingSegmentIds.length) {
        await this.options.coordinator.setDeepSeekRunCheckpoint?.(accountMid, { ...checkpoint, canceled: false, failed: false })
      } else {
        await this.options.coordinator.setDeepSeekRunCheckpoint?.(accountMid, null)
      }
    }
    return {
      snapshot: final,
      referencedConstraintLedgerNames: [...referencedConstraintLedgerNames],
      progress: aggregate,
      failures,
      canceled: run.cancelRequested
    }
  }

  private async organize(
    accountMid: string,
    mode: DeepSeekArchiveMode,
    retry?: { workspaceId: string; segmentId: string; mode: DeepSeekArchiveMode; aids: number[] },
    onProgress?: (progress: OldFavoriteWorkspaceDeepSeekResult['progress']) => void,
    run?: ActiveDeepSeekRun,
    frozenPreferences?: DeepSeekPreferences,
    onSettledGroup?: (settled: SettledDeepSeekGroup) => Promise<void>
  ): Promise<SegmentOrganizeResult> {
    const preferences = frozenPreferences ?? this.options.preferences()
    assertDeepSeekRequestEnabled(preferences as Parameters<typeof assertDeepSeekRequestEnabled>[0], 'favorite-archive-organize')
    const snapshot = await this.options.coordinator.getSnapshot(accountMid)
    if (!snapshot || 'recovery' in snapshot || snapshot.status !== 'previewing' || !snapshot.currentSegment) {
      throw new Error('Old favorite workspace is not ready for DeepSeek classification.')
    }
    if (retry && (retry.workspaceId !== snapshot.workspaceId || retry.segmentId !== snapshot.currentSegment.id)) {
      throw new Error('Old favorite workspace changed before failed DeepSeek chunks could be retried.')
    }
    const selectedFolderIds = new Set(snapshot.sourceFolders
      .filter((folder) => !folder.isBilimiWorkFolder && folder.selected)
      .map((folder) => folder.id))
    const foldersById = new Map(snapshot.sourceFolders.map((folder) => [folder.id, folder]))
    const items = snapshot.currentSegment.items.filter((item) =>
      !isUnavailableArchiveItem(item)
      && item.sourceFolderIds.some((folderId) => selectedFolderIds.has(folderId)))
    const scopedItems = items.filter((item) => {
      const classification = snapshot.classifications[String(item.aid)]
      if (mode === 'unclassified-only') return !classification?.targetLedgerIds.length
      if (mode === 'low-confidence-and-unclassified') {
        return !classification?.targetLedgerIds.length || classification.source === 'system-low'
      }
      return true
    }).filter((item) => !retry || retry.aids.includes(item.aid))
    if (!scopedItems.length) return this.finish(accountMid, snapshot, mode, 0, 0, 0, 0, 0, [], [], false)

    const request: ArchiveRequest = {
      kind: 'favorite-archive-organize',
      mode,
      videos: scopedItems.map((item) => {
        const sourceFolderId = item.sourceFolderIds.find((folderId) => selectedFolderIds.has(folderId)) ?? ''
        return {
          aid: item.aid,
          title: item.title ?? `Video ${item.aid}`,
          author: item.author,
          description: item.description,
          tags: item.tags,
          category: item.category,
          sourceFolderTitle: foldersById.get(sourceFolderId)?.title ?? '',
          originalSuggestedLedgerIds: [],
          currentTargetLedgerIds: snapshot.classifications[String(item.aid)]?.targetLedgerIds ?? [],
          selectedTargetLedgerIds: snapshot.classifications[String(item.aid)]?.targetLedgerIds ?? [],
          lowConfidence: !snapshot.classifications[String(item.aid)] || snapshot.classifications[String(item.aid)]?.source === 'system-low'
        }
      }),
      ledgers: (this.options.ledgersForAccount?.(accountMid, preferences) ?? preferences.favoriteLedgers)
        .filter((ledger) => ledger.enabled && ledger.id !== 'inbox')
        .map((ledger) => {
          const rules = parseFavoriteLedgerRules(ledger)
          return {
            id: ledger.id,
            displayName: ledger.displayName,
            keywords: rules.localKeywords,
            deepSeekConstraint: rules.deepSeekConstraint,
            ruleType: ledger.ruleType,
            enabled: true
          }
        }),
      multiArchiveLimit: multiArchiveLimit(preferences.favoriteArchiveMultiMode)
    }
    const referencedConstraintLedgerNames = request.ledgers
      .filter((ledger) => Boolean(ledger.deepSeekConstraint?.trim()))
      .map((ledger) => ledger.displayName)
    const enabledLedgerIds = new Set(request.ledgers.map((ledger) => ledger.id))
    const failures: OldFavoriteWorkspaceDeepSeekFailure[] = []
    const requestGroupUpdates: NonNullable<OldFavoriteWorkspaceDeepSeekRunCheckpoint['requestGroups']> = []
    const totalChunks = Math.ceil(request.videos.length / archiveChunkSize)
    let successfulVideoCount = 0
    let failedVideoCount = 0
    let completedChunks = 0
    let processedItems: OldFavoriteWorkspaceDeepSeekProcessedItem[] = []
    let authoritativeSnapshot = snapshot
    onProgress?.({ totalChunks, completedChunks: 0, totalVideoCount: request.videos.length, successfulVideoCount, failedVideoCount })
    const delayRetry = () => this.options.retryDelay?.(1_000) ?? new Promise<void>((resolve) => setTimeout(resolve, 1_000))
    const runGroup = async (
      chunk: ArchiveRequest,
      chunkIndex: number,
      groupId: string,
      timeoutAttempt = 0,
      retryIncomplete = true
    ): Promise<{ accepted: DeepSeekArchiveVideoResult[]; failures: OldFavoriteWorkspaceDeepSeekFailure[] }> => {
      let result: DeepSeekGenerateResult
      try {
        result = this.options.generate.length >= 2
          ? await this.options.generate(chunk, run?.controller.signal)
          : await this.options.generate(chunk)
      } catch (error) {
        if (run?.cancelRequested) return { accepted: [], failures: [] }
        const category = this.failureCategory(error)
        if (category === 'timeout') {
          if ((chunk.videos.length === archiveChunkSize || chunk.videos.length <= 5) && timeoutAttempt === 0) {
            await delayRetry()
            return runGroup(chunk, chunkIndex, groupId, 1, retryIncomplete)
          }
          if (chunk.videos.length > 5) {
            const midpoint = Math.ceil(chunk.videos.length / 2)
            requestGroupUpdates.push({ id: groupId, segmentId: snapshot.currentSegment!.id, aids: chunk.videos.map((video) => video.aid), status: 'split', timeoutCount: timeoutAttempt + 1, failureCategory: 'timeout' })
            const leftId = `${groupId}:left`
            const rightId = `${groupId}:right`
            requestGroupUpdates.push(
              { id: leftId, parentId: groupId, segmentId: snapshot.currentSegment!.id, aids: chunk.videos.slice(0, midpoint).map((video) => video.aid), status: 'pending', timeoutCount: 0 },
              { id: rightId, parentId: groupId, segmentId: snapshot.currentSegment!.id, aids: chunk.videos.slice(midpoint).map((video) => video.aid), status: 'pending', timeoutCount: 0 }
            )
            const left = await runGroup({ ...chunk, videos: chunk.videos.slice(0, midpoint) }, chunkIndex, leftId, 0, retryIncomplete)
            const right = await runGroup({ ...chunk, videos: chunk.videos.slice(midpoint) }, chunkIndex, rightId, 0, retryIncomplete)
            return { accepted: [...left.accepted, ...right.accepted], failures: [...left.failures, ...right.failures] }
          }
        }
        const aids = chunk.videos.map((video) => video.aid).filter((aid): aid is number => Number.isSafeInteger(aid)).sort((left, right) => left - right)
        requestGroupUpdates.push({ id: groupId, segmentId: snapshot.currentSegment!.id, aids, status: 'failed', timeoutCount: category === 'timeout' ? timeoutAttempt + 1 : timeoutAttempt, failureCategory: category })
        return { accepted: [], failures: [{ chunkIndex, aids, affectedVideoCount: aids.length, category, message: error instanceof Error ? error.message : 'DeepSeek request failed.' }] }
      }
      if (result.kind !== 'favorite-archive-organize') {
        const aids = chunk.videos.map((video) => video.aid).filter((aid): aid is number => Number.isSafeInteger(aid)).sort((left, right) => left - right)
        requestGroupUpdates.push({ id: groupId, segmentId: snapshot.currentSegment!.id, aids, status: 'failed', timeoutCount: timeoutAttempt, failureCategory: 'invalid' })
        return { accepted: [], failures: [{ chunkIndex, aids, affectedVideoCount: aids.length, category: 'invalid', message: 'DeepSeek returned an invalid favorite workspace result.' }] }
      }
      const expectedAids = new Set(chunk.videos.map((video) => video.aid))
      const acceptedByAid = new Map<number, DeepSeekArchiveVideoResult>()
      const unavailableTargetAids = new Set<number>()
      const invalidAids = new Set<number>()
      for (const row of result.results) {
        if (!Number.isSafeInteger(row.aid) || !expectedAids.has(row.aid!) || acceptedByAid.has(row.aid!)) continue
        if (row.invalid) {
          invalidAids.add(row.aid!)
          continue
        }
        if (!this.hasApplicableTargets(row, snapshot.classifications, enabledLedgerIds, request.multiArchiveLimit)) {
          unavailableTargetAids.add(row.aid!)
          continue
        }
        acceptedByAid.set(row.aid!, row)
      }
      const groupFailures: OldFavoriteWorkspaceDeepSeekFailure[] = []
      const failure = (aids: number[], category: NonNullable<OldFavoriteWorkspaceDeepSeekFailure['category']>, message: string) => {
        if (aids.length) groupFailures.push({ chunkIndex, aids: [...aids].sort((left, right) => left - right), affectedVideoCount: aids.length, category, message })
      }
      failure([...invalidAids], 'invalid', 'DeepSeek returned invalid structured results.')
      failure([...unavailableTargetAids], 'unavailable', 'DeepSeek returned unavailable favorite targets.')
      const accountedAids = new Set([...acceptedByAid.keys(), ...invalidAids, ...unavailableTargetAids])
      const missing = chunk.videos.filter((video) => !accountedAids.has(video.aid))
      if (missing.length) {
        if (retryIncomplete && !run?.cancelRequested) {
          const retried = await runGroup({ ...chunk, videos: missing }, chunkIndex, `${groupId}:missing`, 0, false)
          retried.accepted.forEach((row) => acceptedByAid.set(row.aid!, row))
          groupFailures.push(...retried.failures)
        } else {
          failure(missing.map((video) => video.aid), 'incomplete', 'DeepSeek returned an incomplete current-segment result.')
        }
      }
      requestGroupUpdates.push({
        id: groupId,
        segmentId: snapshot.currentSegment!.id,
        aids: chunk.videos.map((video) => video.aid),
        status: groupFailures.length ? 'failed' : 'successful',
        timeoutCount: timeoutAttempt,
        ...(groupFailures[0]?.category ? { failureCategory: groupFailures[0].category } : {})
      })
      return { accepted: [...acceptedByAid.values()], failures: groupFailures }
    }
    for (let offset = 0; offset < request.videos.length; offset += archiveChunkSize) {
      if (run?.cancelRequested) break
      const chunk = { ...request, videos: request.videos.slice(offset, offset + archiveChunkSize) }
      const stableGroupId = `${snapshot.currentSegment.id}:group:${offset / archiveChunkSize + 1}:${chunk.videos[0]?.aid ?? 0}-${chunk.videos.at(-1)?.aid ?? 0}`
      const updateStart = requestGroupUpdates.length
      const outcome = await runGroup(chunk, offset / archiveChunkSize + 1, stableGroupId)
      failures.push(...outcome.failures)
      successfulVideoCount += outcome.accepted.length
      failedVideoCount += outcome.failures.reduce((count, failure) => count + failure.affectedVideoCount, 0)
      if (!this.destructiveMaintenance && outcome.accepted.length) {
        const itemByAid = new Map(scopedItems.map((item) => [item.aid, item]))
        const beforeTargets = new Map(outcome.accepted.flatMap((row) => typeof row.aid === 'number'
          ? [[row.aid, [...(authoritativeSnapshot.classifications[String(row.aid)]?.targetLedgerIds ?? [])]] as const]
          : []))
        const assignments = this.assignmentsFromResult(outcome.accepted, itemByAid, authoritativeSnapshot.classifications, enabledLedgerIds, request.multiArchiveLimit)
        if (assignments.length) {
          const expected: WorkspaceExpectation = {
            workspaceId: authoritativeSnapshot.workspaceId,
            currentSegmentId: authoritativeSnapshot.currentSegment!.id,
            selectedSourceFolderIds: [...selectedFolderIds].sort(),
            classifications: Object.fromEntries(Object.entries(authoritativeSnapshot.classifications).map(([aid, classification]) => [aid, {
              targetLedgerIds: [...classification.targetLedgerIds].sort(),
              source: classification.source
            }]))
          }
          await this.options.coordinator.applyDeepSeekClassificationBatch(authoritativeSnapshot.accountMid, assignments, expected)
          const next = await this.options.coordinator.getSnapshot(authoritativeSnapshot.accountMid)
          if (!next || 'recovery' in next) throw new Error('Old favorite workspace requires rebuild.')
          authoritativeSnapshot = next
        }
        processedItems = mergeProcessedItems(processedItems, outcome.accepted.flatMap((row) => {
          if (typeof row.aid !== 'number') return []
          const item = itemByAid.get(row.aid)
          if (!item) return []
          const beforeTargetLedgerIds = beforeTargets.get(row.aid) ?? []
          const afterTargetLedgerIds = [...(authoritativeSnapshot.classifications[String(row.aid)]?.targetLedgerIds ?? beforeTargetLedgerIds)]
          return [{
            aid: row.aid,
            ...(typeof (item as { title?: string }).title === 'string' && (item as { title?: string }).title?.trim()
              ? { title: (item as { title: string }).title.trim().slice(0, 160) }
              : {}),
            beforeTargetLedgerIds,
            afterTargetLedgerIds,
            changed: JSON.stringify(beforeTargetLedgerIds) !== JSON.stringify(afterTargetLedgerIds)
          }]
        }))
      }
      const settledSuccessfulAids = outcome.accepted
        .map((row) => row.aid)
        .filter((aid): aid is number => Number.isSafeInteger(aid))
      const settledFailedAids = outcome.failures.flatMap((failure) => failure.aids)
      await onSettledGroup?.({
        successfulAids: this.normalizeAids(settledSuccessfulAids),
        failedAids: this.normalizeAids(settledFailedAids),
        requestGroupUpdates: requestGroupUpdates.slice(updateStart)
      })
      completedChunks = offset / archiveChunkSize + 1
      onProgress?.({
        totalChunks, completedChunks, totalVideoCount: request.videos.length, successfulVideoCount, failedVideoCount,
        ...(processedItems.length ? { processedItems } : {})
      })
    }

    if (this.destructiveMaintenance) {
      return { ...this.result(authoritativeSnapshot, totalChunks, completedChunks, scopedItems.length, successfulVideoCount, failedVideoCount, failures, referencedConstraintLedgerNames, true), requestGroupUpdates }
    }
    return { ...this.finish(accountMid, authoritativeSnapshot, mode, totalChunks, completedChunks, scopedItems.length, successfulVideoCount, failedVideoCount, failures, referencedConstraintLedgerNames, Boolean(run?.cancelRequested)), requestGroupUpdates }
  }

  private mergeRequestGroupUpdates(
    requestGroups: NonNullable<OldFavoriteWorkspaceDeepSeekRunCheckpoint['requestGroups']>,
    updates: NonNullable<OldFavoriteWorkspaceDeepSeekRunCheckpoint['requestGroups']>
  ) {
    for (const update of updates) {
      const index = requestGroups.findIndex((group) => group.id === update.id)
      if (index >= 0) requestGroups[index] = { ...requestGroups[index]!, ...update }
      else requestGroups.push(update)
    }
  }

  private finish(
    accountMid: string,
    snapshot: OldFavoriteWorkspaceSnapshot,
    mode: DeepSeekArchiveMode,
    totalChunks: number,
    completedChunks: number,
    totalVideoCount: number,
    successfulVideoCount: number,
    failedVideoCount: number,
    failures: OldFavoriteWorkspaceDeepSeekFailure[],
    referencedConstraintLedgerNames: string[],
    canceled: boolean
  ) {
    const aids = failures.flatMap((failure) => failure.aids)
    if (aids.length && snapshot.currentSegment) {
      this.rememberFailedRun(accountMid, snapshot.workspaceId, mode, 'current', [{
        segmentId: snapshot.currentSegment.id,
        aids: this.normalizeAids(aids)
      }])
    } else {
      this.failedRuns.delete(accountMid)
    }
    return this.result(snapshot, totalChunks, completedChunks, totalVideoCount, successfulVideoCount, failedVideoCount, failures, referencedConstraintLedgerNames, canceled)
  }

  private normalizeAids(aids: number[]) {
    return [...new Set(aids)].sort((left, right) => left - right)
  }

  private failureCategory(error: unknown): NonNullable<OldFavoriteWorkspaceDeepSeekFailure['category']> {
    const message = error instanceof Error ? error.message : String(error)
    if (/timed out|timeout/i.test(message)) return 'timeout'
    if (/\b429\b|rate.?limit/i.test(message)) return 'rate-limit'
    if (/\b5\d\d\b/i.test(message)) return 'server'
    if (/invalid|structured|JSON/i.test(message)) return 'invalid'
    if (/unavailable target|target ledger/i.test(message)) return 'unavailable'
    if (/incomplete|coverage/i.test(message)) return 'incomplete'
    return 'network'
  }

  private rememberFailedRun(
    accountMid: string,
    workspaceId: string,
    mode: DeepSeekArchiveMode,
    scope: FailedDeepSeekRun['scope'],
    segments: FailedDeepSeekSegment[]
  ) {
    const normalized = segments
      .map((segment) => ({ segmentId: segment.segmentId, aids: this.normalizeAids(segment.aids) }))
      .filter((segment) => segment.aids.length)
    if (normalized.length) this.failedRuns.set(accountMid, { workspaceId, mode, scope, segments: normalized })
    else this.failedRuns.delete(accountMid)
  }

  private result(
    snapshot: OldFavoriteWorkspaceSnapshot,
    totalChunks: number,
    completedChunks: number,
    totalVideoCount: number,
    successfulVideoCount: number,
    failedVideoCount: number,
    failures: OldFavoriteWorkspaceDeepSeekFailure[],
    referencedConstraintLedgerNames: string[],
    canceled: boolean
  ): OldFavoriteWorkspaceDeepSeekResult {
    return {
      snapshot,
      referencedConstraintLedgerNames,
      progress: { totalChunks, completedChunks, totalVideoCount, successfulVideoCount, failedVideoCount },
      failures,
      canceled
    }
  }

  private assertCompleteChunk(request: ArchiveRequest, results: DeepSeekArchiveVideoResult[]) {
    const expectedAids = new Set(request.videos.map((video) => video.aid))
    const returnedAids = results.map((result) => result.aid)
    if (results.some((result) => result.invalid || !Number.isSafeInteger(result.aid)) ||
      returnedAids.length !== expectedAids.size || new Set(returnedAids).size !== returnedAids.length ||
      returnedAids.some((aid) => !expectedAids.has(aid!))) {
      throw new Error('DeepSeek returned an incomplete current-segment result.')
    }
  }

  private assignmentsFromResult(
    results: DeepSeekArchiveVideoResult[],
    itemByAid: Map<number, { aid: number }>,
    classifications: Record<string, { targetLedgerIds: string[] }>,
    enabledLedgerIds: Set<string>,
    limit: 1 | 2 | 3
  ) {
    const assignments = new Map<number, { aid: number; targetLedgerIds: string[] }>()
    for (const result of results) {
      if (result.invalid) continue
      const aid = result.aid
      if (typeof aid !== 'number' || !Number.isSafeInteger(aid) || !itemByAid.has(aid)) {
        throw new Error('DeepSeek result is outside the current segment.')
      }
      const targets = uniqueTargets([
        ...(result.keepOriginal ? classifications[String(aid)]?.targetLedgerIds ?? [] : []),
        ...result.targetLedgerIds
      ])
      if (!targets.length || targets.length > limit || targets.some((target) => !enabledLedgerIds.has(target))) continue
      assignments.set(aid, { aid, targetLedgerIds: targets })
    }
    return [...assignments.values()].sort((left, right) => left.aid - right.aid)
  }

  private hasApplicableTargets(
    result: DeepSeekArchiveVideoResult,
    classifications: Record<string, { targetLedgerIds: string[] }>,
    enabledLedgerIds: Set<string>,
    limit: 1 | 2 | 3
  ) {
    const aid = result.aid
    if (typeof aid !== 'number' || !Number.isSafeInteger(aid)) return false
    const targets = uniqueTargets([
      ...(result.keepOriginal ? classifications[String(aid)]?.targetLedgerIds ?? [] : []),
      ...result.targetLedgerIds
    ])
    return Boolean(targets.length) && targets.length <= limit && targets.every((target) => enabledLedgerIds.has(target))
  }
}
