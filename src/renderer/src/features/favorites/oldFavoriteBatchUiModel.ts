import type { BatchPlanningItem } from './oldFavoriteBatchPlanning'
import {
  applyBatchRecommendation,
  aggregateBatchRecommendations,
  createBatchRecommendationAdoptionState,
  type BatchRecommendationAdoptionState,
  type BatchRecommendationSummary,
  type SegmentRecommendation
} from './oldFavoriteRecommendations'
import {
  buildDeepSeekBatchTask,
  type DeepSeekBatchScope,
  type DeepSeekBatchTask
} from './oldFavoriteDeepSeekBatch'

export type BatchUiItem = BatchPlanningItem & {
  segmentIndex: number
  classificationState: 'matched' | 'unmatched' | 'review'
}

export type CollectionSnapshotItem = {
  aid: number
  sourceFolderIds: string[]
}

export type BatchRecommendationModel = BatchRecommendationAdoptionState & {
  summaries: BatchRecommendationSummary[]
  recommendations: SegmentRecommendation[]
}

export type SegmentExecutionModel = {
  index: number
  status: 'pending' | 'ready' | 'running' | 'completed' | 'blocked'
  executableCount: number
  completedCount: number
}

export type BatchExecutionReadiness = {
  segments: SegmentExecutionModel[]
  currentSegmentIndex: number
  sourceScanComplete: boolean
  managedMembershipComplete: boolean
  aidOwnershipComplete: boolean
  reconciliationComplete: boolean
}

function uniqueAids(aids: number[]) {
  return [...new Set(aids.filter((aid) => Number.isSafeInteger(aid) && aid > 0))]
}

function normalizedSources(sourceFolderIds: string[]) {
  return [...new Set(sourceFolderIds.map(String).filter(Boolean))].sort()
}

export function buildIncrementalBatchAids(options: {
  previous: CollectionSnapshotItem[]
  current: CollectionSnapshotItem[]
  protectedAids: number[]
  activeOwnedAids: number[]
}) {
  const previousSources = new Map<number, string[]>()
  for (const entry of options.previous) {
    previousSources.set(entry.aid, normalizedSources(entry.sourceFolderIds))
  }
  const currentSources = new Map<number, string[]>()
  for (const entry of options.current) {
    currentSources.set(entry.aid, normalizedSources([
      ...(currentSources.get(entry.aid) ?? []),
      ...entry.sourceFolderIds
    ]))
  }
  const excluded = new Set(uniqueAids([...options.protectedAids, ...options.activeOwnedAids]))
  return [...currentSources]
    .filter(([aid, sources]) => {
      if (excluded.has(aid)) return false
      const previous = previousSources.get(aid)
      return !previous || previous.join('\0') !== sources.join('\0')
    })
    .map(([aid]) => aid)
    .sort((left, right) => left - right)
}

export function buildSegmentRecommendationModel(
  items: BatchUiItem[],
  recommendations: SegmentRecommendation[],
  options: { currentSegmentIndex: number; totalSegments: number; scannedSegmentIndexes: number[] }
): BatchRecommendationModel {
  return {
    ...createBatchRecommendationAdoptionState(items),
    summaries: aggregateBatchRecommendations(recommendations, options),
    recommendations: recommendations.map((recommendation) => ({
      ...recommendation,
      matchedAids: [...recommendation.matchedAids],
      matchedItemKeys: [...recommendation.matchedItemKeys]
    }))
  }
}

export function updateBatchRecommendationSelection(
  model: BatchRecommendationModel,
  stableKey: string,
  selected: boolean
): BatchRecommendationModel {
  const recommendation = model.recommendations.find((entry) => entry.stableKey === stableKey)
  if (!recommendation) return model
  return {
    ...applyBatchRecommendation(model, {
      ...recommendation,
      matchedAids: model.recommendations
        .filter((entry) => entry.stableKey === stableKey)
        .flatMap((entry) => entry.matchedAids),
      matchedItemKeys: model.recommendations
        .filter((entry) => entry.stableKey === stableKey)
        .flatMap((entry) => entry.matchedItemKeys)
    }, selected),
    summaries: model.summaries,
    recommendations: model.recommendations
  }
}

export function buildBatchDeepSeekTask(
  items: BatchUiItem[],
  options: { scope: DeepSeekBatchScope; currentSegmentIndex: number; chunkSize: number }
): DeepSeekBatchTask {
  return buildDeepSeekBatchTask(items, options)
}

export function buildSegmentProgress(segments: SegmentExecutionModel[], currentSegmentIndex: number) {
  const current = segments.find((segment) => segment.index === currentSegmentIndex)
  const executable = (segment: SegmentExecutionModel) => Math.max(0, segment.executableCount - segment.completedCount)
  return {
    currentExecutableCount: current ? executable(current) : 0,
    batchExecutableCount: segments
      .filter((segment) => segment.status === 'ready' || segment.status === 'running')
      .reduce((sum, segment) => sum + executable(segment), 0),
    batchCompletedCount: segments.reduce((sum, segment) => sum + segment.completedCount, 0),
    batchTotalCount: segments.reduce((sum, segment) => sum + segment.executableCount, 0),
    completedSegmentCount: segments.filter((segment) => segment.status === 'completed').length,
    totalSegmentCount: segments.length
  }
}

export function evaluateBatchExecutionReadiness(options: BatchExecutionReadiness) {
  const current = options.segments.find((segment) => segment.index === options.currentSegmentIndex)
  const result = { canOrganizeCurrentSegment: current?.status === 'ready' }
  if (!options.sourceScanComplete) return { ...result, canExecute: false as const, reason: 'source-scan-incomplete' as const }
  if (!options.managedMembershipComplete) return { ...result, canExecute: false as const, reason: 'managed-membership-incomplete' as const }
  if (!options.aidOwnershipComplete) return { ...result, canExecute: false as const, reason: 'aid-ownership-incomplete' as const }
  if (!options.reconciliationComplete) return { ...result, canExecute: false as const, reason: 'reconciliation-incomplete' as const }
  return { ...result, canExecute: true as const }
}

export function findNextPendingSegmentIndex(
  segments: SegmentExecutionModel[],
  currentSegmentIndex: number
) {
  const candidates = segments
    .filter((segment) => segment.status === 'ready' && segment.index !== currentSegmentIndex)
    .sort((left, right) => left.index - right.index)
  return candidates.find((segment) => segment.index > currentSegmentIndex)?.index
    ?? candidates[0]?.index
    ?? null
}

export function buildContinuousExecutionPlan(
  segments: SegmentExecutionModel[],
  currentSegmentIndex: number,
  continuous: boolean
) {
  const readyIndexes = segments
    .filter((segment) => segment.status === 'ready' && segment.executableCount > segment.completedCount)
    .map((segment) => segment.index)
    .sort((left, right) => left - right)
  if (!readyIndexes.includes(currentSegmentIndex)) return []
  return continuous
    ? readyIndexes.filter((index) => index >= currentSegmentIndex)
    : [currentSegmentIndex]
}

export function buildManagedSelectionProtection(
  folders: Array<{
    folderId: string
    logicalId: string
    isStaging: boolean
    memberAids: number[]
  }>,
  selectedLogicalIds: string[]
) {
  const selected = new Set(selectedLogicalIds)
  return uniqueAids(folders
    .filter((folder) => !folder.isStaging && !selected.has(folder.logicalId))
    .flatMap((folder) => folder.memberAids))
    .sort((left, right) => left - right)
}
