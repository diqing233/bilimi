import { describe, expect, it, vi } from 'vitest'
import { OldFavoriteWorkspaceDeepSeekService } from './oldFavoriteWorkspaceDeepSeekService'

describe('OldFavoriteWorkspaceDeepSeekService', () => {
  it('filters the legacy low-confidence and unclassified scope in the main process without letting the renderer supply videos', async () => {
    const coordinator = {
      getSnapshot: vi.fn().mockResolvedValue({
        accountMid: '100', workspaceId: 'workspace-100', status: 'previewing',
        sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
        currentSegment: { id: 'segment-1', items: [
          { aid: 1, title: 'Low confidence', sourceFolderIds: ['source'] },
          { aid: 2, title: 'Unclassified', sourceFolderIds: ['source'] },
          { aid: 3, title: 'Manual classification', sourceFolderIds: ['source'] }
        ] },
        classifications: {
          '1': { aid: 1, targetLedgerIds: ['music'], source: 'system-low' },
          '3': { aid: 3, targetLedgerIds: ['music'], source: 'manual' }
        }
      }), applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue({})
    }
    const generate = vi.fn(async (request) => ({ kind: 'favorite-archive-organize' as const, results: request.videos.map((video: { aid: number }) => ({ aid: video.aid, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false })), keywordSuggestions: [] }))
    const service = new OldFavoriteWorkspaceDeepSeekService({ coordinator: coordinator as never, preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true }] }), generate })

    await service.organizeCurrentSegment('100', 'low-confidence-and-unclassified')
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'low-confidence-and-unclassified', videos: [expect.objectContaining({ aid: 1 }), expect.objectContaining({ aid: 2 })]
    }))
  })
  it('submits only the selected current segment and records one main-process DeepSeek batch', async () => {
    const coordinator = {
      getSnapshot: vi.fn().mockResolvedValue({
        accountMid: '100', workspaceId: 'workspace-100', status: 'previewing',
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
        deepseekArchiveOrganizationEnabled: true,
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
    ], expect.objectContaining({ workspaceId: 'workspace-100', currentSegmentId: 'segment-1' }))
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
      preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true }] }),
      generate: vi.fn().mockResolvedValue({
        kind: 'favorite-archive-organize', results: [{ aid: 2, targetLedgerIds: ['music'], keepOriginal: false, reason: 'wrong item', lowConfidence: false }], keywordSuggestions: []
      })
    })

    await expect(service.organizeCurrentSegment('100')).rejects.toThrow('current-segment')
    expect(coordinator.applyDeepSeekClassificationBatch).not.toHaveBeenCalled()
  })

  it('rejects a direct IPC-equivalent call when archive organization is disabled', async () => {
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: { getSnapshot: vi.fn(), applyDeepSeekClassificationBatch: vi.fn() } as never,
      preferences: () => ({
        deepseekArchiveOrganizationEnabled: false,
        favoriteArchiveMultiMode: 'off' as const,
        favoriteLedgers: []
      }),
      generate: vi.fn()
    })

    await expect(service.organizeCurrentSegment('100')).rejects.toThrow('disabled')
  })

  it('does not apply stale DeepSeek results after the current segment changes', async () => {
    const before = {
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing' as const,
      sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
      currentSegment: { id: 'segment-1', items: [{ aid: 1, title: 'Video', sourceFolderIds: ['source'] }] }, classifications: {}
    }
    const coordinator = {
      getSnapshot: vi.fn().mockResolvedValue(before),
      applyDeepSeekClassificationBatch: vi.fn().mockRejectedValue(new Error('changed while DeepSeek was running'))
    }
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: coordinator as never,
      preferences: () => ({
        deepseekArchiveOrganizationEnabled: true,
        favoriteArchiveMultiMode: 'off' as const,
        favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true }]
      }),
      generate: vi.fn().mockResolvedValue({
        kind: 'favorite-archive-organize', results: [{ aid: 1, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false }], keywordSuggestions: []
      })
    })

    await expect(service.organizeCurrentSegment('100')).rejects.toThrow('changed while DeepSeek was running')
    expect(coordinator.applyDeepSeekClassificationBatch).toHaveBeenCalledWith('100', [{ aid: 1, targetLedgerIds: ['music'] }], expect.objectContaining({
      workspaceId: 'workspace-1', currentSegmentId: 'segment-1'
    }))
  })

  it('does not let DeepSeek replace an equal-target manual classification while it is running', async () => {
    const coordinator = {
      getSnapshot: vi.fn().mockResolvedValue({
        accountMid: '100', workspaceId: 'workspace-1', status: 'previewing',
        sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
        currentSegment: { id: 'segment-1', items: [{ aid: 1, title: 'Video', sourceFolderIds: ['source'] }] },
        classifications: { '1': { aid: 1, targetLedgerIds: ['music'], source: 'manual' } }
      }),
      applyDeepSeekClassificationBatch: vi.fn().mockRejectedValue(new Error('changed while DeepSeek was running'))
    }
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: coordinator as never,
      preferences: () => ({
        deepseekArchiveOrganizationEnabled: true,
        favoriteArchiveMultiMode: 'off' as const,
        favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true }]
      }),
      generate: vi.fn().mockResolvedValue({
        kind: 'favorite-archive-organize', results: [{ aid: 1, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false }], keywordSuggestions: []
      })
    })

    await expect(service.organizeCurrentSegment('100')).rejects.toThrow('changed while DeepSeek was running')
    expect(coordinator.applyDeepSeekClassificationBatch).toHaveBeenCalledWith('100', expect.any(Array), expect.objectContaining({
      classifications: { '1': { targetLedgerIds: ['music'], source: 'manual' } }
    }))
  })

  it('splits a large current segment into bounded requests and applies its aggregate once', async () => {
    const items = Array.from({ length: 21 }, (_, index) => ({ aid: index + 1, title: `Video ${index + 1}`, sourceFolderIds: ['source'] }))
    const coordinator = {
      getSnapshot: vi.fn().mockResolvedValue({
        accountMid: '100', workspaceId: 'workspace-1', status: 'previewing',
        sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
        currentSegment: { id: 'segment-1', items }, classifications: {}
      }),
      applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue({})
    }
    const generate = vi.fn(async (request) => ({
      kind: 'favorite-archive-organize' as const,
      results: request.videos.map((video: { aid: number }) => ({ aid: video.aid, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false })),
      keywordSuggestions: []
    }))
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: coordinator as never,
      preferences: () => ({
        deepseekArchiveOrganizationEnabled: true,
        favoriteArchiveMultiMode: 'off' as const,
        favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true }]
      }),
      generate
    })

    await service.organizeCurrentSegment('100')

    expect(generate).toHaveBeenCalledTimes(2)
    expect(generate.mock.calls.map(([request]) => request.videos.length)).toEqual([20, 1])
    expect(coordinator.applyDeepSeekClassificationBatch).toHaveBeenCalledOnce()
    expect(coordinator.applyDeepSeekClassificationBatch.mock.calls[0][1]).toHaveLength(21)
  })
})
