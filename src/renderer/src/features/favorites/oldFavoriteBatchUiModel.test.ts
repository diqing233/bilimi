import { describe, expect, it } from 'vitest'
import {
  buildBatchDeepSeekTask,
  buildContinuousExecutionPlan,
  buildIncrementalBatchAids,
  buildManagedSelectionProtection,
  evaluateBatchExecutionReadiness,
  buildSegmentProgress,
  buildSegmentRecommendationModel,
  findNextPendingSegmentIndex,
  updateBatchRecommendationSelection,
  type BatchUiItem
} from './oldFavoriteBatchUiModel'

const item = (itemKey: string, segmentIndex: number, overrides: Partial<BatchUiItem> = {}): BatchUiItem => ({
  itemKey,
  aid: Number(itemKey.replace(/\D/g, '')),
  segmentIndex,
  title: itemKey,
  tags: [],
  currentFormalLedgerIds: [],
  lastConfirmedLedgerIds: [],
  targetLedgerIds: [],
  targetOrigin: 'automatic',
  executionState: 'pending',
  classificationState: 'unmatched',
  ...overrides
})

describe('oldFavoriteBatchUiModel', () => {
  it('detects new aids and source changes while excluding protected and active-owned aids', () => {
    expect(buildIncrementalBatchAids({
      previous: [
        { aid: 1, sourceFolderIds: ['a'] },
        { aid: 2, sourceFolderIds: ['a', 'b'] },
        { aid: 3, sourceFolderIds: ['a'] }
      ],
      current: [
        { aid: 1, sourceFolderIds: ['a'] },
        { aid: 2, sourceFolderIds: ['b', 'c'] },
        { aid: 3, sourceFolderIds: ['a', 'staging'] },
        { aid: 4, sourceFolderIds: ['a'] },
        { aid: 4, sourceFolderIds: ['b'] },
        { aid: 5, sourceFolderIds: ['a'] }
      ],
      protectedAids: [3],
      activeOwnedAids: [5]
    })).toEqual([2, 4])
  })

  it('aggregates recommendations across segments and adopts or cancels without changing manual or executed items', () => {
    const items = [
      item('item-1', 0),
      item('item-2', 1, { targetLedgerIds: ['manual'], targetOrigin: 'manual' }),
      item('item-3', 1, { targetLedgerIds: ['done'], executionState: 'succeeded' })
    ]
    const recommendations = [
      { stableKey: 'game', ledgerId: 'game', displayName: 'bilimi·游戏', segmentIndex: 0, matchedAids: [1], matchedItemKeys: ['item-1'] },
      { stableKey: 'game', ledgerId: 'game', displayName: 'bilimi·游戏', segmentIndex: 1, matchedAids: [1, 2, 3], matchedItemKeys: ['item-1', 'item-2', 'item-3'] }
    ]
    const model = buildSegmentRecommendationModel(items, recommendations, {
      currentSegmentIndex: 1,
      totalSegments: 3,
      scannedSegmentIndexes: [0, 1]
    })
    expect(model.summaries[0]).toMatchObject({
      uniqueMatchCount: 3,
      currentSegmentMatchCount: 3,
      scannedSegmentCount: 2,
      countIsFinal: false
    })

    const adopted = updateBatchRecommendationSelection(model, 'game', true)
    expect(adopted.items.map((entry) => entry.targetLedgerIds)).toEqual([['game'], ['manual'], ['done']])
    const cancelled = updateBatchRecommendationSelection(adopted, 'game', false)
    expect(cancelled.items.map((entry) => entry.targetLedgerIds)).toEqual([[], ['manual'], ['done']])
  })

  it.each([
    ['current-segment', ['item-2', 'item-3', 'item-4']],
    ['all-unmatched', ['item-1', 'item-2']],
    ['all-review', ['item-3']],
    ['all-unmatched-and-review', ['item-1', 'item-2', 'item-3']]
  ] as const)('maps %s DeepSeek scope across batch segments', (scope, expected) => {
    const task = buildBatchDeepSeekTask([
      item('item-1', 0),
      item('item-2', 1),
      item('item-3', 1, { classificationState: 'review' }),
      item('item-4', 1, { classificationState: 'matched' })
    ], { scope, currentSegmentIndex: 1, chunkSize: 2 })
    expect(task.itemKeys).toEqual(expected)
    expect(task.chunks.flat()).toEqual(expected)
  })

  it('reports batch execution progress and locates the next pending segment', () => {
    const segments = [
      { index: 0, status: 'completed' as const, executableCount: 10, completedCount: 10 },
      { index: 1, status: 'ready' as const, executableCount: 8, completedCount: 2 },
      { index: 2, status: 'blocked' as const, executableCount: 4, completedCount: 0 },
      { index: 3, status: 'ready' as const, executableCount: 5, completedCount: 0 }
    ]
    expect(buildSegmentProgress(segments, 1)).toEqual({
      currentExecutableCount: 6,
      batchExecutableCount: 11,
      batchCompletedCount: 12,
      batchTotalCount: 27,
      completedSegmentCount: 1,
      totalSegmentCount: 4
    })
    expect(findNextPendingSegmentIndex(segments, 1)).toBe(3)
    expect(buildContinuousExecutionPlan(segments, 1, false)).toEqual([1])
    expect(buildContinuousExecutionPlan(segments, 1, true)).toEqual([1, 3])
  })

  it('protects aids in unselected formal managed folders and never protects staging shards', () => {
    expect(buildManagedSelectionProtection([
      { folderId: 'formal-a', logicalId: 'a', isStaging: false, memberAids: [1, 2] },
      { folderId: 'formal-a-2', logicalId: 'a', isStaging: false, memberAids: [2, 3] },
      { folderId: 'formal-b', logicalId: 'b', isStaging: false, memberAids: [3, 4] },
      { folderId: 'staging', logicalId: 'staging', isStaging: true, memberAids: [4, 5] }
    ], ['a'])).toEqual([3, 4])
  })

  it('allows local organization for one ready segment but requires every batch safety gate for execution', () => {
    const segments = [
      { index: 0, status: 'ready' as const, executableCount: 10, completedCount: 0 },
      { index: 1, status: 'pending' as const, executableCount: 0, completedCount: 0 }
    ]
    expect(evaluateBatchExecutionReadiness({
      segments, currentSegmentIndex: 0, sourceScanComplete: false,
      managedMembershipComplete: false, aidOwnershipComplete: false, reconciliationComplete: false
    })).toEqual({ canOrganizeCurrentSegment: true, canExecute: false, reason: 'source-scan-incomplete' })
    expect(evaluateBatchExecutionReadiness({
      segments, currentSegmentIndex: 0, sourceScanComplete: true,
      managedMembershipComplete: true, aidOwnershipComplete: true, reconciliationComplete: true
    })).toEqual({ canOrganizeCurrentSegment: true, canExecute: true })
  })
})
