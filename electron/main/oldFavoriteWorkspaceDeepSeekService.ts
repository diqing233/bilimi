import { parseFavoriteLedgerRules } from '../../src/shared/favoriteLedgerConstraints'
import type {
  DeepSeekArchiveVideoResult,
  DeepSeekGenerateRequest,
  DeepSeekGenerateResult,
  FavoriteArchiveMultiMode,
  FavoriteLedger
} from '../../src/shared/types'
import { OldFavoriteWorkspaceCoordinator } from './oldFavoriteWorkspaceCoordinator'

type ArchiveRequest = Extract<DeepSeekGenerateRequest, { kind: 'favorite-archive-organize' }>

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
    preferences: () => Pick<{ favoriteArchiveMultiMode: FavoriteArchiveMultiMode; favoriteLedgers: FavoriteLedger[] }, 'favoriteArchiveMultiMode' | 'favoriteLedgers'>
    generate: (request: ArchiveRequest) => Promise<DeepSeekGenerateResult>
  }) {}

  async organizeCurrentSegment(accountMid: string) {
    const snapshot = await this.options.coordinator.getSnapshot(accountMid)
    if ('recovery' in snapshot || snapshot.status !== 'previewing' || !snapshot.currentSegment) {
      throw new Error('Old favorite workspace is not ready for DeepSeek classification.')
    }
    const preferences = this.options.preferences()
    const selectedFolderIds = new Set(snapshot.sourceFolders
      .filter((folder) => !folder.isBilimiWorkFolder && folder.selected)
      .map((folder) => folder.id))
    const foldersById = new Map(snapshot.sourceFolders.map((folder) => [folder.id, folder]))
    const items = snapshot.currentSegment.items.filter((item) =>
      item.sourceFolderIds.some((folderId) => selectedFolderIds.has(folderId)))
    if (!items.length) return snapshot

    const request: ArchiveRequest = {
      kind: 'favorite-archive-organize',
      mode: 'all',
      videos: items.map((item) => {
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
    const result = await this.options.generate(request)
    if (result.kind !== 'favorite-archive-organize') throw new Error('DeepSeek returned an invalid favorite workspace result.')

    const itemByAid = new Map(items.map((item) => [item.aid, item]))
    const enabledLedgerIds = new Set(request.ledgers.map((ledger) => ledger.id))
    const assignments = this.assignmentsFromResult(result.results, itemByAid, snapshot.classifications, enabledLedgerIds, request.multiArchiveLimit)
    if (!assignments.length) return snapshot
    return this.options.coordinator.applyDeepSeekClassificationBatch(snapshot.accountMid, assignments)
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
