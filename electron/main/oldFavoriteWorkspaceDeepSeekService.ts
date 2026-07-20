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
  constructor(private readonly options: {
    coordinator: Pick<OldFavoriteWorkspaceCoordinator, 'getSnapshot' | 'applyDeepSeekClassificationBatch'>
    preferences: () => Pick<{
      deepseekArchiveOrganizationEnabled: boolean
      favoriteArchiveMultiMode: FavoriteArchiveMultiMode
      favoriteLedgers: FavoriteLedger[]
    }, 'deepseekArchiveOrganizationEnabled' | 'favoriteArchiveMultiMode' | 'favoriteLedgers'>
    generate: (request: ArchiveRequest) => Promise<DeepSeekGenerateResult>
  }) {}

  async organizeCurrentSegment(accountMid: string, mode: DeepSeekArchiveMode = 'all'): Promise<OldFavoriteWorkspaceDeepSeekResult> {
    const preferences = this.options.preferences()
    assertDeepSeekRequestEnabled(preferences as Parameters<typeof assertDeepSeekRequestEnabled>[0], 'favorite-archive-organize')
    const snapshot = await this.options.coordinator.getSnapshot(accountMid)
    if ('recovery' in snapshot || snapshot.status !== 'previewing' || !snapshot.currentSegment) {
      throw new Error('Old favorite workspace is not ready for DeepSeek classification.')
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
    })
    if (!scopedItems.length) return this.result(snapshot, 0, 0, 0, [])

    const request: ArchiveRequest = {
      kind: 'favorite-archive-organize',
      mode,
      videos: scopedItems.map((item) => {
        const sourceFolderId = item.sourceFolderIds.find((folderId) => selectedFolderIds.has(folderId)) ?? ''
        return {
          aid: item.aid,
          title: item.title ?? `Video ${item.aid}`,
          author: item.author,
          sourceFolderTitle: foldersById.get(sourceFolderId)?.title ?? '',
          originalSuggestedLedgerIds: [],
          currentTargetLedgerIds: snapshot.classifications[String(item.aid)]?.targetLedgerIds ?? [],
          selectedTargetLedgerIds: snapshot.classifications[String(item.aid)]?.targetLedgerIds ?? []
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
    const results: DeepSeekArchiveVideoResult[] = []
    const failures: OldFavoriteWorkspaceDeepSeekFailure[] = []
    const totalChunks = Math.ceil(request.videos.length / 20)
    for (let offset = 0; offset < request.videos.length; offset += 20) {
      const chunk = { ...request, videos: request.videos.slice(offset, offset + 20) }
      try {
        const result = await this.options.generate(chunk)
        if (result.kind !== 'favorite-archive-organize') throw new Error('DeepSeek returned an invalid favorite workspace result.')
        this.assertCompleteChunk(chunk, result.results)
        results.push(...result.results)
      } catch (error) {
        failures.push({
          chunkIndex: offset / 20 + 1,
          affectedVideoCount: chunk.videos.length,
          message: error instanceof Error ? error.message : 'DeepSeek request failed.'
        })
      }
    }

    const itemByAid = new Map(scopedItems.map((item) => [item.aid, item]))
    const enabledLedgerIds = new Set(request.ledgers.map((ledger) => ledger.id))
    const assignments = this.assignmentsFromResult(results, itemByAid, snapshot.classifications, enabledLedgerIds, request.multiArchiveLimit)
    if (!assignments.length) return this.result(snapshot, totalChunks, results.length, scopedItems.length - results.length, failures)
    const expected: WorkspaceExpectation = {
      workspaceId: snapshot.workspaceId,
      currentSegmentId: snapshot.currentSegment.id,
      selectedSourceFolderIds: [...selectedFolderIds].sort(),
      classifications: Object.fromEntries(Object.entries(snapshot.classifications).map(([aid, classification]) => [aid, {
        targetLedgerIds: [...classification.targetLedgerIds].sort(),
        source: classification.source
      }]))
    }
    const next = await this.options.coordinator.applyDeepSeekClassificationBatch(snapshot.accountMid, assignments, expected)
    return this.result(next, totalChunks, assignments.length, scopedItems.length - results.length, failures)
  }

  private result(
    snapshot: OldFavoriteWorkspaceSnapshot,
    totalChunks: number,
    successfulVideoCount: number,
    failedVideoCount: number,
    failures: OldFavoriteWorkspaceDeepSeekFailure[]
  ): OldFavoriteWorkspaceDeepSeekResult {
    return {
      snapshot,
      progress: { totalChunks, completedChunks: totalChunks, successfulVideoCount, failedVideoCount },
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
      if (!targets.length || targets.length > limit || targets.some((target) => !enabledLedgerIds.has(target))) {
        throw new Error('DeepSeek result targets are invalid.')
      }
      assignments.set(result.aid, { aid: result.aid, targetLedgerIds: targets })
    }
    return [...assignments.values()].sort((left, right) => left.aid - right.aid)
  }
}
