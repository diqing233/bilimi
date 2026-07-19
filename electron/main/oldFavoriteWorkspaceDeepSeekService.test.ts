import { describe, expect, it, vi } from 'vitest'
import { OldFavoriteWorkspaceDeepSeekService } from './oldFavoriteWorkspaceDeepSeekService'

describe('OldFavoriteWorkspaceDeepSeekService', () => {
  it('submits only the selected current segment and records one main-process DeepSeek batch', async () => {
    const coordinator = {
      getSnapshot: vi.fn().mockResolvedValue({
        accountMid: '100', status: 'previewing',
        sourceFolders: [
          { id: 'source-a', title: 'Source A', isBilimiWorkFolder: false, selected: true },
          { id: 'source-b', title: 'Source B', isBilimiWorkFolder: false, selected: false }
        ],
        currentSegment: {
          id: 'segment-1',
          items: [
            { aid: 1, title: 'Knowledge', author: 'UP', sourceFolderIds: ['source-a'] },
            { aid: 2, title: 'Ignored', author: 'UP', sourceFolderIds: ['source-b'] }
          ]
        },
        classifications: { '1': { aid: 1, targetLedgerIds: ['music'], source: 'manual' } }
      }),
      applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue({ accountMid: '100', status: 'previewing' })
    }
    const generate = vi.fn().mockResolvedValue({
      kind: 'favorite-archive-organize',
      results: [{ aid: 1, targetLedgerIds: ['knowledge'], keepOriginal: false, reason: 'topic', lowConfidence: false }],
      keywordSuggestions: []
    })
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: coordinator as never,
      preferences: () => ({
        favoriteArchiveMultiMode: 'off' as const,
        favoriteLedgers: [
          { id: 'knowledge', displayName: 'Knowledge', keywords: [], enabled: true },
          { id: 'music', displayName: 'Music', keywords: [], enabled: true },
          { id: 'inbox', displayName: 'Inbox', keywords: [], enabled: true }
        ]
      }),
      generate
    })

    await service.organizeCurrentSegment('100')

    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'favorite-archive-organize',
      multiArchiveLimit: 1,
      videos: [expect.objectContaining({ aid: 1, sourceFolderTitle: 'Source A', currentTargetLedgerIds: ['music'] })]
    }))
    expect(coordinator.applyDeepSeekClassificationBatch).toHaveBeenCalledWith('100', [
      { aid: 1, targetLedgerIds: ['knowledge'] }
    ])
  })

  it('rejects a result outside the current segment instead of recording it', async () => {
    const coordinator = {
      getSnapshot: vi.fn().mockResolvedValue({
        accountMid: '100', status: 'previewing', sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
        currentSegment: { id: 'segment-1', items: [{ aid: 1, title: 'Video', sourceFolderIds: ['source'] }] }, classifications: {}
      }),
      applyDeepSeekClassificationBatch: vi.fn()
    }
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: coordinator as never,
      preferences: () => ({ favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true }] }),
      generate: vi.fn().mockResolvedValue({
        kind: 'favorite-archive-organize', results: [{ aid: 2, targetLedgerIds: ['music'], keepOriginal: false, reason: 'wrong item', lowConfidence: false }], keywordSuggestions: []
      })
    })

    await expect(service.organizeCurrentSegment('100')).rejects.toThrow('current segment')
    expect(coordinator.applyDeepSeekClassificationBatch).not.toHaveBeenCalled()
  })
})
