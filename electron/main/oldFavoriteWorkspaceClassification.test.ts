import { describe, expect, it, vi } from 'vitest'
import { classifyOldFavoriteItemsCooperatively, classifierLedgersForAccount, enableDefaultLedgersForOrganization, mergeOldFavoriteWorkspaceLedgers } from './oldFavoriteWorkspaceClassification'

describe('mergeOldFavoriteWorkspaceLedgers', () => {
  it('classifies large collections in bounded batches and yields between them', async () => {
    const classifyBatch = vi.fn((items: Array<{ aid: number }>) => items.map((item) => ({ aid: item.aid })))
    const yieldToEventLoop = vi.fn().mockResolvedValue(undefined)
    const items = Array.from({ length: 513 }, (_, index) => ({ aid: index + 1 }))

    const result = await classifyOldFavoriteItemsCooperatively(items, classifyBatch, {
      batchSize: 128,
      yieldToEventLoop
    })

    expect(classifyBatch.mock.calls.map(([batch]) => batch.length)).toEqual([128, 128, 128, 128, 1])
    expect(yieldToEventLoop).toHaveBeenCalledTimes(4)
    expect(result).toHaveLength(items.length)
  })

  it('reports cumulative progress after every completed classification batch', async () => {
    const onBatchComplete = vi.fn()
    const items = Array.from({ length: 5 }, (_, index) => ({ aid: index + 1 }))

    await classifyOldFavoriteItemsCooperatively(items, (batch) => batch, {
      batchSize: 2,
      yieldToEventLoop: vi.fn().mockResolvedValue(undefined),
      onBatchComplete
    })

    expect(onBatchComplete.mock.calls).toEqual([[2, 5], [4, 5], [5, 5]])
  })

  it('cancels before starting the next cooperative batch', async () => {
    let canceled = false
    const classifyBatch = vi.fn((batch: Array<{ aid: number }>) => {
      canceled = true
      return batch
    })

    await expect(classifyOldFavoriteItemsCooperatively(
      [{ aid: 1 }, { aid: 2 }, { aid: 3 }],
      classifyBatch,
      { batchSize: 2, shouldCancel: () => canceled }
    )).rejects.toThrow('Old favorite preview preparation canceled.')
    expect(classifyBatch).toHaveBeenCalledTimes(1)
  })

  it('observes cancellation delivered while yielding before the next batch', async () => {
    let canceled = false
    const classifyBatch = vi.fn((batch: Array<{ aid: number }>) => batch)

    await expect(classifyOldFavoriteItemsCooperatively(
      [{ aid: 1 }, { aid: 2 }, { aid: 3 }],
      classifyBatch,
      {
        batchSize: 2,
        yieldToEventLoop: async () => { canceled = true },
        shouldCancel: () => canceled
      }
    )).rejects.toThrow('Old favorite preview preparation canceled.')
    expect(classifyBatch).toHaveBeenCalledTimes(1)
  })

  it('enables every default target for an organization round only when the default system is enabled', () => {
    const saved = [
      { id: 'knowledge', displayName: 'bilimi·知识', keywords: [], enabled: false, priority: 10, isDefault: true },
      { id: 'inbox', displayName: 'bilimi·暂存', keywords: [], enabled: false, priority: 20, isDefault: true },
      { id: 'custom', displayName: '自建', keywords: [], enabled: false, priority: 30, isDefault: false }
    ]

    expect(enableDefaultLedgersForOrganization(saved, true)).toEqual([
      expect.objectContaining({ id: 'knowledge', enabled: true }),
      expect.objectContaining({ id: 'inbox', enabled: true }),
      expect.objectContaining({ id: 'custom', enabled: false })
    ])
    expect(enableDefaultLedgersForOrganization(saved, false)).toEqual(saved)
  })

  it('keeps a user-deleted default rule selected when an organization round starts', () => {
    const saved = [{
      id: 'knowledge', displayName: 'bilimi·知识', keywords: [], enabled: false, priority: 10,
      isDefault: true, bindingState: 'unbound' as const, managedFolderDeletedByUser: true
    }]

    expect(enableDefaultLedgersForOrganization(saved, true)).toEqual([
      expect.objectContaining({
        id: 'knowledge', enabled: true, managedFolderDeletedByUser: true
      })
    ])
  })

  it('excludes ordinary defaults but retains inbox staging when disabled', () => {
    const ledgers = classifierLedgersForAccount([
      { id: 'knowledge', displayName: 'bilimi·知识', keywords: [], enabled: true, priority: 10, isDefault: true },
      { id: 'inbox', displayName: 'bilimi·暂存', keywords: [], enabled: true, priority: 20, isDefault: true },
      { id: 'custom', displayName: '自建', keywords: [], enabled: true, priority: 30, isDefault: false }
    ], false)

    expect(ledgers).toEqual([
      expect.objectContaining({ id: 'inbox', enabled: true }),
      expect.objectContaining({ id: 'custom', enabled: true })
    ])
  })

  it('excludes recovered local drafts from automatic classification', () => {
    expect(classifierLedgersForAccount([
      { id: 'knowledge', displayName: '知识', keywords: ['教程'], enabled: true, priority: 10, isDefault: true },
      { id: 'custom-genshin', displayName: '原神', keywords: ['原神'], enabled: false, priority: 20, isDefault: false, bilibiliFolderId: '42', syncState: 'local-draft' }
    ], true)).toEqual([
      expect.objectContaining({ id: 'knowledge' })
    ])
  })

  it('adds adopted recommendations as enabled author ledgers ahead of duplicate saved rules', () => {
    expect(mergeOldFavoriteWorkspaceLedgers([
      { id: 'music', displayName: 'Music', keywords: ['music'], enabled: true, priority: 3, isDefault: false },
      { id: 'custom-author-up-alpha', displayName: 'Old Alpha', keywords: ['old'], enabled: false, priority: 9, isDefault: false }
    ], [{
      id: 'custom-author-up-alpha', displayName: 'bilimi·UP Alpha', keywords: ['UP Alpha'],
      ruleType: 'author', enabled: true, priority: 0, isDefault: false
    }])).toEqual([
      { id: 'custom-author-up-alpha', displayName: 'bilimi·UP Alpha', keywords: ['UP Alpha'], ruleType: 'author', enabled: true, priority: 0, isDefault: false },
      { id: 'music', displayName: 'Music', keywords: ['music'], enabled: true, priority: 3, isDefault: false }
    ])
  })

  it('reuses a saved author ledger with the same complete UP rule instead of duplicating it', () => {
    expect(mergeOldFavoriteWorkspaceLedgers([{
      id: 'saved-honker', displayName: 'bilimi·我的追更', keywords: ['honker233-小王爱马枪'],
      ruleType: 'author', enabled: false, priority: 9, isDefault: false
    }], [{
      id: 'custom-author-honker233-小王爱马枪', displayName: 'bilimi·honker233',
      keywords: ['honker233-小王爱马枪'], ruleType: 'author', enabled: true,
      priority: 0, isDefault: false
    }])).toEqual([{
      id: 'saved-honker', displayName: 'bilimi·我的追更', keywords: ['honker233-小王爱马枪'],
      ruleType: 'author', enabled: true, priority: 0, isDefault: false
    }])
  })

  it('excludes a saved rule that matches a recommendation removed from the current round', () => {
    expect(mergeOldFavoriteWorkspaceLedgers([
      {
        id: 'saved-honker', displayName: 'bilimi·honker233', keywords: ['honker233-小王爱马枪'],
        ruleType: 'author', enabled: true, priority: 1, isDefault: false
      },
      {
        id: 'music', displayName: 'bilimi·音乐舞台', keywords: ['音乐'],
        ruleType: 'keyword', enabled: true, priority: 2, isDefault: true
      }
    ], [], [{
      id: 'custom-author-honker233-小王爱马枪', displayName: 'bilimi·honker233',
      keywords: ['honker233-小王爱马枪'], ruleType: 'author', enabled: true,
      priority: 0, isDefault: false
    }])).toEqual([
      expect.objectContaining({ id: 'music' })
    ])
  })
})
