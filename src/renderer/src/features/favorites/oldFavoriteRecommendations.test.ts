import { describe, expect, it } from 'vitest'
import {
  aggregateBatchRecommendations,
  applyBatchRecommendation,
  createBatchRecommendationAdoptionState,
  type SegmentRecommendation
} from './oldFavoriteRecommendations'
import type { BatchPlanningItem } from './oldFavoriteBatchPlanning'

const recommendation = (
  segmentIndex: number,
  aids: number[],
  itemKeys = aids.map((aid) => `item-${aid}`)
): SegmentRecommendation => ({
  stableKey: 'tag:genshin',
  ledgerId: 'genshin',
  displayName: 'bilimi·原神资料与攻略',
  segmentIndex,
  matchedAids: aids,
  matchedItemKeys: itemKeys
})

const item = (aid: number, overrides: Partial<BatchPlanningItem> = {}): BatchPlanningItem => ({
  itemKey: `item-${aid}`,
  aid,
  title: `video-${aid}`,
  sourceFolderTitle: 'default',
  tags: [],
  currentFormalLedgerIds: [],
  lastConfirmedLedgerIds: [],
  targetLedgerIds: ['inbox'],
  targetOrigin: 'automatic',
  executionState: 'pending',
  ...overrides
})

describe('oldFavoriteRecommendations', () => {
  it('stably merges the same candidate across segments using unique aids and reports progress', () => {
    const result = aggregateBatchRecommendations(
      [recommendation(0, [1, 2]), recommendation(1, [2, 3])],
      { currentSegmentIndex: 1, totalSegments: 3, scannedSegmentIndexes: [0, 1] }
    )

    expect(result).toEqual([
      expect.objectContaining({
        stableKey: 'tag:genshin',
        uniqueMatchCount: 3,
        currentSegmentMatchCount: 2,
        scannedSegmentCount: 2,
        totalSegments: 3,
        countIsFinal: false
      })
    ])
  })

  it('adopts immediately for matched automatic pending rows without overwriting manual or executed rows', () => {
    const state = createBatchRecommendationAdoptionState([
      item(1),
      item(2, { targetLedgerIds: ['music'], targetOrigin: 'manual' }),
      item(3, { targetLedgerIds: ['knowledge'], executionState: 'succeeded' })
    ])
    const next = applyBatchRecommendation(state, recommendation(0, [1, 2, 3]), true)

    expect(next.items.map((entry) => entry.targetLedgerIds)).toEqual([
      ['genshin'],
      ['music'],
      ['knowledge']
    ])
    expect(next.adoptedStableKeys).toEqual(['tag:genshin'])
  })

  it('cancels by restoring only automatic pending rows captured before adoption', () => {
    const adopted = applyBatchRecommendation(
      createBatchRecommendationAdoptionState([item(1), item(2)]),
      recommendation(0, [1, 2]),
      true
    )
    adopted.items[1] = { ...adopted.items[1], targetLedgerIds: ['music'], targetOrigin: 'manual' }

    const cancelled = applyBatchRecommendation(adopted, recommendation(0, [1, 2]), false)

    expect(cancelled.items.map((entry) => entry.targetLedgerIds)).toEqual([['inbox'], ['music']])
    expect(cancelled.adoptedStableKeys).toEqual([])
  })

  it('is idempotent when the same batch recommendation is adopted more than once', () => {
    const initial = createBatchRecommendationAdoptionState([item(1)])
    const once = applyBatchRecommendation(initial, recommendation(0, [1]), true)
    const twice = applyBatchRecommendation(once, recommendation(0, [1]), true)
    const cancelled = applyBatchRecommendation(twice, recommendation(0, [1]), false)

    expect(twice.adoptedStableKeys).toEqual(['tag:genshin'])
    expect(cancelled.items[0].targetLedgerIds).toEqual(['inbox'])
  })
})
