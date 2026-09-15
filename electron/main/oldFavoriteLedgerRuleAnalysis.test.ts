import { describe, expect, it, vi } from 'vitest'
import { analyzeOldFavoriteLedgerRule } from './oldFavoriteLedgerRuleAnalysis'

describe('analyzeOldFavoriteLedgerRule', () => {
  it('analyzes a large local rule in fixed bounded batches', async () => {
    const yieldToEventLoop = vi.fn().mockResolvedValue(undefined)
    const items = Array.from({ length: 257 }, (_, index) => ({
      aid: index + 1,
      title: `系列 ${index + 1}`
    }))

    const matchedAidsBySegment = await analyzeOldFavoriteLedgerRule(
      [{ id: 'segment-1', items }],
      { ruleType: 'keyword', keywords: ['系列'] },
      { yieldToEventLoop }
    )

    expect(yieldToEventLoop).toHaveBeenCalledTimes(2)
    expect(matchedAidsBySegment).toEqual({
      'segment-1': Array.from({ length: 257 }, (_, index) => index + 1)
    })
  })

  it('reports monotonic progress after each completed batch', async () => {
    const onProgress = vi.fn()

    await analyzeOldFavoriteLedgerRule(
      [{
        id: 'segment-1',
        items: Array.from({ length: 257 }, (_, index) => ({ aid: index + 1, title: '系列' }))
      }],
      { ruleType: 'keyword', keywords: ['系列'] },
      { onProgress, yieldToEventLoop: vi.fn().mockResolvedValue(undefined) }
    )

    expect(onProgress.mock.calls).toEqual([[128, 257], [256, 257], [257, 257]])
  })

  it('cancels before starting the next batch without returning a partial index', async () => {
    let canceled = false
    const onProgress = vi.fn(() => { canceled = true })

    await expect(analyzeOldFavoriteLedgerRule(
      [{
        id: 'segment-1',
        items: Array.from({ length: 129 }, (_, index) => ({ aid: index + 1, title: '系列' }))
      }],
      { ruleType: 'keyword', keywords: ['系列'] },
      {
        shouldCancel: () => canceled,
        onProgress,
        yieldToEventLoop: vi.fn().mockResolvedValue(undefined)
      }
    )).rejects.toThrow('Old favorite ledger rule analysis canceled.')

    expect(onProgress).toHaveBeenCalledTimes(1)
  })

  it('uses normalized title, author, and tag fields without mutating or duplicating input items', async () => {
    const segments = [{
      id: 'segment-1',
      items: [
        { aid: 3, title: '《机器·学习》入门', author: '其他', tags: ['教程'] },
        { aid: 1, title: '访谈', author: 'UP-Alpha', tags: ['人物'] },
        { aid: 2, title: '随笔', author: '其他', tags: ['科普·知识'] },
        { aid: 3, title: '《机器·学习》入门', author: '其他', tags: ['教程'] }
      ]
    }]
    const before = structuredClone(segments)

    await expect(analyzeOldFavoriteLedgerRule(
      segments,
      { ruleType: 'keyword', keywords: ['机器 学习'] }
    )).resolves.toEqual({ 'segment-1': [3] })
    await expect(analyzeOldFavoriteLedgerRule(
      segments,
      { ruleType: 'author', keywords: ['up alpha'] }
    )).resolves.toEqual({ 'segment-1': [1] })
    await expect(analyzeOldFavoriteLedgerRule(
      segments,
      { ruleType: 'tag', keywords: ['科普知识'] }
    )).resolves.toEqual({ 'segment-1': [2] })
    expect(segments).toEqual(before)
  })
})
