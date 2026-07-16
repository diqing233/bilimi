import { describe, expect, it } from 'vitest'
import {
  applyDeepSeekBatchChunk,
  applyDeepSeekBatchTargets,
  buildDeepSeekBatchTask,
  pauseDeepSeekBatchTask,
  resumeDeepSeekBatchTask,
  type DeepSeekBatchItem
} from './oldFavoriteDeepSeekBatch'

const item = (aid: number, overrides: Partial<DeepSeekBatchItem> = {}): DeepSeekBatchItem => ({
  itemKey: `item-${aid}`,
  aid,
  segmentIndex: aid <= 2 ? 0 : 1,
  classificationState: 'unmatched',
  targetLedgerIds: [],
  targetOrigin: 'automatic',
  executionState: 'pending',
  ...overrides
})

describe('oldFavoriteDeepSeekBatch', () => {
  it.each([
    ['current-segment', [1, 2]],
    ['all-unmatched', [1, 3]],
    ['all-review', [2]],
    ['all-unmatched-and-review', [1, 2, 3]]
  ] as const)('selects the %s scope', (scope, expectedAids) => {
    const task = buildDeepSeekBatchTask(
      [
        item(1),
        item(2, { classificationState: 'review' }),
        item(3),
        item(4, { classificationState: 'matched' })
      ],
      { scope, currentSegmentIndex: 0, chunkSize: 2 }
    )

    expect(task.itemKeys).toEqual(expectedAids.map((aid) => `item-${aid}`))
  })

  it('chunks a whole batch, persists the cursor, and resumes from a paused checkpoint', () => {
    const task = buildDeepSeekBatchTask([item(1), item(2), item(3)], {
      scope: 'all-unmatched',
      currentSegmentIndex: 0,
      chunkSize: 2
    })
    const afterFirst = applyDeepSeekBatchChunk(task, ['item-1', 'item-2'])
    const paused = pauseDeepSeekBatchTask(afterFirst)
    const resumed = resumeDeepSeekBatchTask(paused)

    expect(afterFirst).toMatchObject({ completedCount: 2, nextItemOffset: 2, status: 'running' })
    expect(paused.status).toBe('paused')
    expect(resumed).toMatchObject({ status: 'running', nextItemOffset: 2 })
    expect(resumed.chunks[1]).toEqual(['item-3'])
  })

  it('excludes manually changed and executed rows and refuses results for protected rows', () => {
    const task = buildDeepSeekBatchTask(
      [
        item(1),
        item(2, { targetOrigin: 'manual' }),
        item(3, { executionState: 'succeeded' })
      ],
      { scope: 'all-unmatched', currentSegmentIndex: 0, chunkSize: 10 }
    )

    expect(task.itemKeys).toEqual(['item-1'])
    expect(() => applyDeepSeekBatchChunk(task, ['item-2'])).toThrow('not part of the active chunk')
  })

  it('marks the final chunk completed and does not restart a completed task', () => {
    const task = buildDeepSeekBatchTask([item(1)], {
      scope: 'all-unmatched',
      currentSegmentIndex: 0,
      chunkSize: 1
    })
    const completed = applyDeepSeekBatchChunk(task, ['item-1'])

    expect(completed).toMatchObject({ status: 'completed', completedCount: 1, nextItemOffset: 1 })
    expect(resumeDeepSeekBatchTask(completed).status).toBe('completed')
  })

  it('rechecks manual and execution protection when delayed results are applied', () => {
    const result = applyDeepSeekBatchTargets(
      [
        item(1),
        item(2, { targetOrigin: 'manual', targetLedgerIds: ['music'] }),
        item(3, { executionState: 'succeeded', targetLedgerIds: ['knowledge'] })
      ],
      [
        { itemKey: 'item-1', targetLedgerIds: ['genshin'] },
        { itemKey: 'item-2', targetLedgerIds: ['genshin'] },
        { itemKey: 'item-3', targetLedgerIds: ['genshin'] }
      ]
    )

    expect(result.items.map((entry) => entry.targetLedgerIds)).toEqual([
      ['genshin'],
      ['music'],
      ['knowledge']
    ])
    expect(result).toMatchObject({ appliedCount: 1, protectedCount: 2 })
  })
})
