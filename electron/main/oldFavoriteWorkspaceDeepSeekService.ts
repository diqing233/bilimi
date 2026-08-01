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
  work?: Promise<OldFavoriteWorkspaceDeepSeekResult>
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

/** Builds, validates, and applies a DeepSeek batch entirely in the main process. */
export class OldFavoriteWorkspaceDeepSeekService {
  private destructiveMaintenance = false
  private readonly failedRuns = new Map<string, FailedDeepSeekRun>()
  private readonly activeRuns = new Map<string, ActiveDeepSeekRun>()

  constructor(private readonly options: {
  coordinator: Pick<OldFavoriteWorkspaceCoordinator, 'getSnapshot' | 'applyDeepSeekClassificationBatch'>
    & Partial<Pick<OldFavoriteWorkspaceCoordinator, 'selectSegment'>>
    preferences: () => DeepSeekPreferences
    ledgersForAccount?: (accountMid: string, preferences: Pick<DeepSeekPreferences, 'favoriteLedgers'>) => FavoriteLedger[]
    generate: (request: ArchiveRequest) => Promise<DeepSeekGenerateResult>
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
    const run: ActiveDeepSeekRun = { cancelRequested: false }
    const frozenPreferences = this.options.preferences()
    this.activeRuns.set(accountMid, run)
    let final = initial
    const failures: OldFavoriteWorkspaceDeepSeekFailure[] = []
    const failedSegments: FailedDeepSeekSegment[] = []
    const referencedConstraintLedgerNames = new Set<string>()
    const aggregate = { totalChunks: 0, completedChunks: 0, totalVideoCount: 0, successfulVideoCount: 0, failedVideoCount: 0 }
    try {
      for (const segmentId of segmentIds) {
        if (run.cancelRequested) break
        while (!run.cancelRequested) {
          const readinessSnapshot = await this.options.coordinator.getSnapshot(accountMid)
          if (!readinessSnapshot || 'recovery' in readinessSnapshot || readinessSnapshot.workspaceId !== initial.workspaceId || readinessSnapshot.status !== 'previewing') {
            throw new Error('Old favorite workspace changed while DeepSeek was waiting for the next batch.')
          }
          const summary = readinessSnapshot.segments.find((segment) => segment.id === segmentId)
          if (!summary || summary.status === 'frozen' || summary.readiness === 'saved') break
          if (summary.readiness === 'ready') {
            await this.options.coordinator.selectSegment(accountMid, segmentId)
            break
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 250))
        }
        if (run.cancelRequested) break
        const selected = await this.options.coordinator.getSnapshot(accountMid)
        const selectedSummary = selected && !('recovery' in selected)
          ? selected.segments.find((segment) => segment.id === segmentId)
          : undefined
        if (!selectedSummary || selectedSummary.status === 'frozen' || selectedSummary.readiness === 'saved') continue
        const segmentResult = await this.organize(accountMid, mode, undefined, (progress) => {
          onProgress?.({
            totalChunks: aggregate.totalChunks + progress.totalChunks,
            completedChunks: aggregate.completedChunks + progress.completedChunks,
            totalVideoCount: aggregate.totalVideoCount + progress.totalVideoCount,
            successfulVideoCount: aggregate.successfulVideoCount + progress.successfulVideoCount,
            failedVideoCount: aggregate.failedVideoCount + progress.failedVideoCount
          })
        }, run, frozenPreferences)
        final = segmentResult.snapshot
        segmentResult.failures.forEach((failure) => failures.push({ ...failure, chunkIndex: failures.length + failure.chunkIndex }))
        const failedAids = segmentResult.failures.flatMap((failure) => failure.aids)
        if (failedAids.length) failedSegments.push({ segmentId, aids: this.normalizeAids(failedAids) })
        segmentResult.referencedConstraintLedgerNames.forEach((name) => referencedConstraintLedgerNames.add(name))
        aggregate.totalChunks += segmentResult.progress.totalChunks
        aggregate.completedChunks += segmentResult.progress.completedChunks
        aggregate.totalVideoCount += segmentResult.progress.totalVideoCount
        aggregate.successfulVideoCount += segmentResult.progress.successfulVideoCount
        aggregate.failedVideoCount += segmentResult.progress.failedVideoCount
        if (segmentResult.canceled) break
      }
    } finally {
      await this.options.coordinator.selectSegment(accountMid, originalSegmentId).catch(() => undefined)
      const restored = await this.options.coordinator.getSnapshot(accountMid)
      if (restored && !('recovery' in restored)) final = restored
      if (this.activeRuns.get(accountMid) === run) this.activeRuns.delete(accountMid)
    }
    this.rememberFailedRun(accountMid, initial.workspaceId, mode, 'all', failedSegments)
    return {
      snapshot: final,
      referencedConstraintLedgerNames: [...referencedConstraintLedgerNames],
      progress: aggregate,
      failures,
      canceled: run.cancelRequested
    }
  }

  /** Retries only the main-process remembered failed chunk aids for the active workspace. */
  async retryFailedChunks(
    accountMid: string,
    onProgress?: (progress: OldFavoriteWorkspaceDeepSeekResult['progress']) => void
  ): Promise<OldFavoriteWorkspaceDeepSeekResult> {
    const failedRun = this.failedRuns.get(accountMid)
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
    if (!run) return false
    run.cancelRequested = true
    return true
  }

  /** Fences future organization and waits for each in-flight request to relinquish ownership. */
  async quiesceForDestructiveMaintenance() {
    this.destructiveMaintenance = true
    this.failedRuns.clear()
    for (const run of this.activeRuns.values()) run.cancelRequested = true
    while (this.activeRuns.size) {
      const work = [...this.activeRuns.values()].flatMap((run) => run.work ? [run.work] : [])
      if (work.length) await Promise.allSettled(work)
      else await new Promise<void>((resolve) => setTimeout(resolve, 10))
    }
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
    const run: ActiveDeepSeekRun = { cancelRequested: false }
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
    const run: ActiveDeepSeekRun = { cancelRequested: false }
    const frozenPreferences = this.options.preferences()
    const aggregate = { totalChunks: 0, completedChunks: 0, totalVideoCount: 0, successfulVideoCount: 0, failedVideoCount: 0 }
    const failures: OldFavoriteWorkspaceDeepSeekFailure[] = []
    const remainingFailures: FailedDeepSeekSegment[] = []
    const referencedConstraintLedgerNames = new Set<string>()
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
        }, run, frozenPreferences)
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
      await this.options.coordinator.selectSegment(accountMid, originalSegmentId).catch(() => undefined)
      const restored = await this.options.coordinator.getSnapshot(accountMid)
      if (restored && !('recovery' in restored)) final = restored
      if (this.activeRuns.get(accountMid) === run) this.activeRuns.delete(accountMid)
    }
    this.rememberFailedRun(accountMid, failedRun.workspaceId, failedRun.mode, 'all', remainingFailures)
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
    frozenPreferences?: DeepSeekPreferences
  ): Promise<OldFavoriteWorkspaceDeepSeekResult> {
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
      item.sourceFolderIds.some((folderId) => selectedFolderIds.has(folderId)))
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
    const results: DeepSeekArchiveVideoResult[] = []
    const failures: OldFavoriteWorkspaceDeepSeekFailure[] = []
    const totalChunks = Math.ceil(request.videos.length / archiveChunkSize)
    let successfulVideoCount = 0
    let failedVideoCount = 0
    let completedChunks = 0
    onProgress?.({ totalChunks, completedChunks: 0, totalVideoCount: request.videos.length, successfulVideoCount, failedVideoCount })
    for (let offset = 0; offset < request.videos.length; offset += archiveChunkSize) {
      if (run?.cancelRequested) break
      const chunk = { ...request, videos: request.videos.slice(offset, offset + archiveChunkSize) }
      try {
        const result = await this.options.generate(chunk)
        if (result.kind !== 'favorite-archive-organize') throw new Error('DeepSeek returned an invalid favorite workspace result.')
        const expectedAids = new Set(chunk.videos.map((video) => video.aid))
        const acceptedByAid = new Map<number, DeepSeekArchiveVideoResult>()
        const unavailableTargetAids = new Set<number>()
        for (const row of result.results) {
          if (row.invalid || !Number.isSafeInteger(row.aid) || !expectedAids.has(row.aid!) || acceptedByAid.has(row.aid!)) continue
          if (!this.hasApplicableTargets(row, snapshot.classifications, enabledLedgerIds, request.multiArchiveLimit)) {
            unavailableTargetAids.add(row.aid!)
            continue
          }
          acceptedByAid.set(row.aid!, row)
        }
        const accepted = [...acceptedByAid.values()]
        const acceptedAids = new Set(acceptedByAid.keys())
        results.push(...accepted)
        successfulVideoCount += accepted.length
        if (unavailableTargetAids.size) {
          const aids = [...unavailableTargetAids].sort((left, right) => left - right)
          failures.push({
            chunkIndex: offset / archiveChunkSize + 1,
            aids,
            affectedVideoCount: aids.length,
            message: 'DeepSeek returned unavailable favorite targets.'
          })
          failedVideoCount += aids.length
        }
        const missing = chunk.videos.filter((video) => !acceptedAids.has(video.aid) && !unavailableTargetAids.has(video.aid))
        if (missing.length && !run?.cancelRequested) {
          const retry = { ...chunk, videos: missing }
          try {
            const retried = await this.options.generate(retry)
            if (retried.kind !== 'favorite-archive-organize') throw new Error('DeepSeek returned an invalid favorite workspace result.')
            this.assertCompleteChunk(retry, retried.results)
            const applicable: DeepSeekArchiveVideoResult[] = []
            const rejectedAids: number[] = []
            for (const row of retried.results) {
              if (this.hasApplicableTargets(row, snapshot.classifications, enabledLedgerIds, request.multiArchiveLimit)) applicable.push(row)
              else rejectedAids.push(row.aid!)
            }
            rejectedAids.sort((left, right) => left - right)
            results.push(...applicable)
            successfulVideoCount += applicable.length
            if (rejectedAids.length) {
              failures.push({
                chunkIndex: offset / archiveChunkSize + 1,
                aids: rejectedAids,
                affectedVideoCount: rejectedAids.length,
                message: 'DeepSeek returned unavailable favorite targets.'
              })
              failedVideoCount += rejectedAids.length
            }
          } catch (error) {
            failures.push({
              chunkIndex: offset / archiveChunkSize + 1,
              aids: missing.map((video) => video.aid).sort((left, right) => left - right),
              affectedVideoCount: missing.length,
              message: error instanceof Error ? error.message : 'DeepSeek request failed.'
            })
            failedVideoCount += missing.length
          }
        }
      } catch (error) {
        failures.push({
          chunkIndex: offset / archiveChunkSize + 1,
          aids: chunk.videos.map((video) => video.aid).filter((aid): aid is number => Number.isSafeInteger(aid)).sort((left, right) => left - right),
          affectedVideoCount: chunk.videos.length,
          message: error instanceof Error ? error.message : 'DeepSeek request failed.'
        })
        failedVideoCount += chunk.videos.length
      }
      completedChunks = offset / archiveChunkSize + 1
      onProgress?.({ totalChunks, completedChunks, totalVideoCount: request.videos.length, successfulVideoCount, failedVideoCount })
    }

    const itemByAid = new Map(scopedItems.map((item) => [item.aid, item]))
    const assignments = this.assignmentsFromResult(results, itemByAid, snapshot.classifications, enabledLedgerIds, request.multiArchiveLimit)
    if (this.destructiveMaintenance) {
      return this.result(snapshot, totalChunks, completedChunks, scopedItems.length, successfulVideoCount, failedVideoCount, failures, referencedConstraintLedgerNames, true)
    }
    if (!assignments.length) return this.finish(accountMid, snapshot, mode, totalChunks, completedChunks, scopedItems.length, successfulVideoCount, failedVideoCount, failures, referencedConstraintLedgerNames, Boolean(run?.cancelRequested))
    const expected: WorkspaceExpectation = {
      workspaceId: snapshot.workspaceId,
      currentSegmentId: snapshot.currentSegment.id,
      selectedSourceFolderIds: [...selectedFolderIds].sort(),
      classifications: Object.fromEntries(Object.entries(snapshot.classifications).map(([aid, classification]) => [aid, {
        targetLedgerIds: [...classification.targetLedgerIds].sort(),
        source: classification.source
      }]))
    }
    await this.options.coordinator.applyDeepSeekClassificationBatch(snapshot.accountMid, assignments, expected)
    // The mutation returns the internal workspace model. Re-open the authoritative
    // renderer snapshot so post-run UI retains source folders and segment items.
    const next = await this.options.coordinator.getSnapshot(snapshot.accountMid)
    if (!next || 'recovery' in next) throw new Error('Old favorite workspace requires rebuild.')
    return this.finish(accountMid, next, mode, totalChunks, completedChunks, scopedItems.length, successfulVideoCount, failedVideoCount, failures, referencedConstraintLedgerNames, Boolean(run?.cancelRequested))
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
