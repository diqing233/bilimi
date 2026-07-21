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
type WorkspaceExpectation = {
  workspaceId: string
  currentSegmentId: string
  selectedSourceFolderIds: string[]
  classifications: Record<string, { targetLedgerIds: string[]; source: string }>
}

function multiArchiveLimit(mode: FavoriteArchiveMultiMode) {
  return mode === 'three' ? 3 : mode === 'two' ? 2 : 1
}

function uniqueTargets(targets: string[]) {
  return [...new Set(targets.map((target) => target.trim()).filter(Boolean))]
}

/** Builds, validates, and applies a DeepSeek batch entirely in the main process. */
export class OldFavoriteWorkspaceDeepSeekService {
  private readonly failedRuns = new Map<string, { workspaceId: string; segmentId: string; mode: DeepSeekArchiveMode; aids: number[] }>()

  constructor(private readonly options: {
    coordinator: Pick<OldFavoriteWorkspaceCoordinator, 'getSnapshot' | 'applyDeepSeekClassificationBatch'>
    preferences: () => Pick<{
      deepseekArchiveOrganizationEnabled: boolean
      favoriteArchiveMultiMode: FavoriteArchiveMultiMode
      favoriteLedgers: FavoriteLedger[]
    }, 'deepseekArchiveOrganizationEnabled' | 'favoriteArchiveMultiMode' | 'favoriteLedgers'>
    generate: (request: ArchiveRequest) => Promise<DeepSeekGenerateResult>
  }) {}

  async organizeCurrentSegment(
    accountMid: string,
    mode: DeepSeekArchiveMode = 'all',
    onProgress?: (progress: OldFavoriteWorkspaceDeepSeekResult['progress']) => void
  ): Promise<OldFavoriteWorkspaceDeepSeekResult> {
    return this.organize(accountMid, mode, undefined, onProgress)
  }

  /** Retries only the main-process remembered failed chunk aids for the active workspace. */
  async retryFailedChunks(
    accountMid: string,
    onProgress?: (progress: OldFavoriteWorkspaceDeepSeekResult['progress']) => void
  ): Promise<OldFavoriteWorkspaceDeepSeekResult> {
    const failedRun = this.failedRuns.get(accountMid)
    if (!failedRun?.aids.length) throw new Error('Old favorite workspace has no failed DeepSeek chunks to retry.')
    return this.organize(accountMid, failedRun.mode, failedRun, onProgress)
  }

  private async organize(
    accountMid: string,
    mode: DeepSeekArchiveMode,
    retry?: { workspaceId: string; segmentId: string; mode: DeepSeekArchiveMode; aids: number[] },
    onProgress?: (progress: OldFavoriteWorkspaceDeepSeekResult['progress']) => void
  ): Promise<OldFavoriteWorkspaceDeepSeekResult> {
    const preferences = this.options.preferences()
    assertDeepSeekRequestEnabled(preferences as Parameters<typeof assertDeepSeekRequestEnabled>[0], 'favorite-archive-organize')
    const snapshot = await this.options.coordinator.getSnapshot(accountMid)
    if ('recovery' in snapshot || snapshot.status !== 'previewing' || !snapshot.currentSegment) {
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
    if (!scopedItems.length) return this.finish(accountMid, snapshot, mode, 0, 0, 0, 0, [], [])

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
      ledgers: preferences.favoriteLedgers
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
    const totalChunks = Math.ceil(request.videos.length / 20)
    let successfulVideoCount = 0
    let failedVideoCount = 0
    onProgress?.({ totalChunks, completedChunks: 0, totalVideoCount: request.videos.length, successfulVideoCount, failedVideoCount })
    for (let offset = 0; offset < request.videos.length; offset += 20) {
      const chunk = { ...request, videos: request.videos.slice(offset, offset + 20) }
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
            chunkIndex: offset / 20 + 1,
            aids,
            affectedVideoCount: aids.length,
            message: 'DeepSeek returned unavailable favorite targets.'
          })
          failedVideoCount += aids.length
        }
        const missing = chunk.videos.filter((video) => !acceptedAids.has(video.aid) && !unavailableTargetAids.has(video.aid))
        if (missing.length) {
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
                chunkIndex: offset / 20 + 1,
                aids: rejectedAids,
                affectedVideoCount: rejectedAids.length,
                message: 'DeepSeek returned unavailable favorite targets.'
              })
              failedVideoCount += rejectedAids.length
            }
          } catch (error) {
            failures.push({
              chunkIndex: offset / 20 + 1,
              aids: missing.map((video) => video.aid).sort((left, right) => left - right),
              affectedVideoCount: missing.length,
              message: error instanceof Error ? error.message : 'DeepSeek request failed.'
            })
            failedVideoCount += missing.length
          }
        }
      } catch (error) {
        failures.push({
          chunkIndex: offset / 20 + 1,
          aids: chunk.videos.map((video) => video.aid).filter((aid): aid is number => Number.isSafeInteger(aid)).sort((left, right) => left - right),
          affectedVideoCount: chunk.videos.length,
          message: error instanceof Error ? error.message : 'DeepSeek request failed.'
        })
        failedVideoCount += chunk.videos.length
      }
      onProgress?.({ totalChunks, completedChunks: offset / 20 + 1, totalVideoCount: request.videos.length, successfulVideoCount, failedVideoCount })
    }

    const itemByAid = new Map(scopedItems.map((item) => [item.aid, item]))
    const assignments = this.assignmentsFromResult(results, itemByAid, snapshot.classifications, enabledLedgerIds, request.multiArchiveLimit)
    if (!assignments.length) return this.finish(accountMid, snapshot, mode, totalChunks, scopedItems.length, successfulVideoCount, failedVideoCount, failures, referencedConstraintLedgerNames)
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
    if ('recovery' in next) throw new Error('Old favorite workspace requires rebuild.')
    return this.finish(accountMid, next, mode, totalChunks, scopedItems.length, successfulVideoCount, failedVideoCount, failures, referencedConstraintLedgerNames)
  }

  private finish(
    accountMid: string,
    snapshot: OldFavoriteWorkspaceSnapshot,
    mode: DeepSeekArchiveMode,
    totalChunks: number,
    totalVideoCount: number,
    successfulVideoCount: number,
    failedVideoCount: number,
    failures: OldFavoriteWorkspaceDeepSeekFailure[],
    referencedConstraintLedgerNames: string[]
  ) {
    const aids = failures.flatMap((failure) => failure.aids)
    if (aids.length && snapshot.currentSegment) {
      this.failedRuns.set(accountMid, {
        workspaceId: snapshot.workspaceId, segmentId: snapshot.currentSegment.id, mode, aids: [...new Set(aids)].sort((left, right) => left - right)
      })
    } else {
      this.failedRuns.delete(accountMid)
    }
    return this.result(snapshot, totalChunks, totalVideoCount, successfulVideoCount, failedVideoCount, failures, referencedConstraintLedgerNames)
  }

  private result(
    snapshot: OldFavoriteWorkspaceSnapshot,
    totalChunks: number,
    totalVideoCount: number,
    successfulVideoCount: number,
    failedVideoCount: number,
    failures: OldFavoriteWorkspaceDeepSeekFailure[],
    referencedConstraintLedgerNames: string[]
  ): OldFavoriteWorkspaceDeepSeekResult {
    return {
      snapshot,
      referencedConstraintLedgerNames,
      progress: { totalChunks, completedChunks: totalChunks, totalVideoCount, successfulVideoCount, failedVideoCount },
      failures
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
      if (!Number.isSafeInteger(result.aid) || !itemByAid.has(result.aid)) {
        throw new Error('DeepSeek result is outside the current segment.')
      }
      const targets = uniqueTargets([
        ...(result.keepOriginal ? classifications[String(result.aid)]?.targetLedgerIds ?? [] : []),
        ...result.targetLedgerIds
      ])
      if (!targets.length || targets.length > limit || targets.some((target) => !enabledLedgerIds.has(target))) continue
      assignments.set(result.aid, { aid: result.aid, targetLedgerIds: targets })
    }
    return [...assignments.values()].sort((left, right) => left.aid - right.aid)
  }

  private hasApplicableTargets(
    result: DeepSeekArchiveVideoResult,
    classifications: Record<string, { targetLedgerIds: string[] }>,
    enabledLedgerIds: Set<string>,
    limit: 1 | 2 | 3
  ) {
    const targets = uniqueTargets([
      ...(result.keepOriginal ? classifications[String(result.aid)]?.targetLedgerIds ?? [] : []),
      ...result.targetLedgerIds
    ])
    return Boolean(targets.length) && targets.length <= limit && targets.every((target) => enabledLedgerIds.has(target))
  }
}
