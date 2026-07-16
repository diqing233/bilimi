import type { BatchPlanningItem } from './oldFavoriteBatchPlanning'

export type SegmentRecommendation = {
  stableKey: string
  ledgerId: string
  displayName: string
  segmentIndex: number
  matchedAids: number[]
  matchedItemKeys: string[]
}

export type BatchRecommendationSummary = {
  stableKey: string
  ledgerId: string
  displayName: string
  uniqueMatchCount: number
  currentSegmentMatchCount: number
  scannedSegmentCount: number
  totalSegments: number
  countIsFinal: boolean
  matchedItemKeys: string[]
}

export type BatchRecommendationAdoptionState = {
  items: BatchPlanningItem[]
  adoptedStableKeys: string[]
  automaticTargetsBeforeAdoption: Record<string, Record<string, string[]>>
}

function cloneItem(item: BatchPlanningItem): BatchPlanningItem {
  return {
    ...item,
    tags: [...item.tags],
    currentFormalLedgerIds: [...item.currentFormalLedgerIds],
    lastConfirmedLedgerIds: [...item.lastConfirmedLedgerIds],
    targetLedgerIds: [...item.targetLedgerIds]
  }
}

export function aggregateBatchRecommendations(
  recommendations: SegmentRecommendation[],
  options: {
    currentSegmentIndex: number
    totalSegments: number
    scannedSegmentIndexes: number[]
  }
): BatchRecommendationSummary[] {
  const grouped = new Map<
    string,
    { first: SegmentRecommendation; aids: Set<number>; currentAids: Set<number>; itemKeys: Set<string> }
  >()

  for (const recommendation of recommendations) {
    const group = grouped.get(recommendation.stableKey) ?? {
      first: recommendation,
      aids: new Set<number>(),
      currentAids: new Set<number>(),
      itemKeys: new Set<string>()
    }
    recommendation.matchedAids.forEach((aid) => group.aids.add(aid))
    recommendation.matchedItemKeys.forEach((itemKey) => group.itemKeys.add(itemKey))
    if (recommendation.segmentIndex === options.currentSegmentIndex) {
      recommendation.matchedAids.forEach((aid) => group.currentAids.add(aid))
    }
    grouped.set(recommendation.stableKey, group)
  }

  const scannedSegmentCount = new Set(options.scannedSegmentIndexes).size
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([stableKey, group]) => ({
      stableKey,
      ledgerId: group.first.ledgerId,
      displayName: group.first.displayName,
      uniqueMatchCount: group.aids.size,
      currentSegmentMatchCount: group.currentAids.size,
      scannedSegmentCount,
      totalSegments: options.totalSegments,
      countIsFinal: scannedSegmentCount >= options.totalSegments,
      matchedItemKeys: [...group.itemKeys]
    }))
}

export function createBatchRecommendationAdoptionState(
  items: BatchPlanningItem[]
): BatchRecommendationAdoptionState {
  return {
    items: items.map(cloneItem),
    adoptedStableKeys: [],
    automaticTargetsBeforeAdoption: {}
  }
}

export function applyBatchRecommendation(
  state: BatchRecommendationAdoptionState,
  recommendation: SegmentRecommendation,
  selected: boolean
): BatchRecommendationAdoptionState {
  const matchedItemKeys = new Set(recommendation.matchedItemKeys)
  const adopted = new Set(state.adoptedStableKeys)
  const snapshots = Object.fromEntries(
    Object.entries(state.automaticTargetsBeforeAdoption).map(([stableKey, targets]) => [
      stableKey,
      Object.fromEntries(Object.entries(targets).map(([itemKey, ids]) => [itemKey, [...ids]]))
    ])
  )

  if (selected) {
    adopted.add(recommendation.stableKey)
    snapshots[recommendation.stableKey] ??= {}
  } else {
    adopted.delete(recommendation.stableKey)
  }

  const items = state.items.map((item) => {
    if (
      !matchedItemKeys.has(item.itemKey) ||
      item.targetOrigin !== 'automatic' ||
      item.executionState !== 'pending'
    ) {
      return cloneItem(item)
    }

    if (selected) {
      snapshots[recommendation.stableKey][item.itemKey] ??= [...item.targetLedgerIds]
      return { ...cloneItem(item), targetLedgerIds: [recommendation.ledgerId] }
    }

    const previousTargets = snapshots[recommendation.stableKey]?.[item.itemKey]
    return previousTargets ? { ...cloneItem(item), targetLedgerIds: [...previousTargets] } : cloneItem(item)
  })

  if (!selected) {
    delete snapshots[recommendation.stableKey]
  }

  return {
    items,
    adoptedStableKeys: [...adopted],
    automaticTargetsBeforeAdoption: snapshots
  }
}
