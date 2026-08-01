import { describe, expect, it, vi } from 'vitest'
import { OldFavoriteWorkspaceDeepSeekService } from './oldFavoriteWorkspaceDeepSeekService'

describe('OldFavoriteWorkspaceDeepSeekService', () => {
  it('cancels and waits for an active DeepSeek batch before destructive maintenance returns', async () => {
    const snapshot = {
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing' as const,
      sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
      currentSegment: { id: 'segment-1', items: [{ aid: 1, title: 'Video', sourceFolderIds: ['source'] }] }, classifications: {}
    }
    let resolveGenerate: ((result: { kind: 'favorite-archive-organize'; results: Array<{ aid: number; targetLedgerIds: string[]; keepOriginal: boolean; reason: string; lowConfidence: boolean }>; keywordSuggestions: never[] }) => void) | undefined
    const coordinator = {
      getSnapshot: vi.fn().mockResolvedValue(snapshot),
      applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue(snapshot)
    }
    const generate = vi.fn(() => new Promise<{
      kind: 'favorite-archive-organize'; results: Array<{ aid: number; targetLedgerIds: string[]; keepOriginal: boolean; reason: string; lowConfidence: boolean }>; keywordSuggestions: never[]
    }>((resolve) => { resolveGenerate = resolve }))
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: coordinator as never,
      preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true, priority: 0, isDefault: true }] }),
      generate
    })

    const organizing = service.organizeCurrentSegment('100')
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce())
    const quiesced = service.quiesceForDestructiveMaintenance()
    let settled = false
    void quiesced.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    resolveGenerate?.({
      kind: 'favorite-archive-organize',
      results: [{ aid: 1, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false }],
      keywordSuggestions: []
    })
    await quiesced
    await expect(organizing).resolves.toMatchObject({ canceled: true })
    await expect(service.organizeCurrentSegment('100')).rejects.toThrow('destructive maintenance')
  })

  it('rejects DeepSeek organization before an explicit organization round exists', async () => {
    const coordinator = {
      getSnapshot: vi.fn().mockResolvedValue(null),
      applyDeepSeekClassificationBatch: vi.fn()
    }
    const generate = vi.fn()
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: coordinator as never,
      preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [] }),
      generate
    })

    await expect(service.organizeCurrentSegment('100')).rejects.toThrow(
      'Old favorite workspace is not ready for DeepSeek classification.'
    )
    expect(generate).not.toHaveBeenCalled()
  })

  it('uses account-effective ledgers so disabled default targets are excluded from archive DeepSeek', async () => {
    const snapshot = {
      accountMid: '100', workspaceId: 'workspace-100', status: 'previewing',
      sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
      currentSegment: { id: 'segment-1', items: [{ aid: 1, title: 'Video', sourceFolderIds: ['source'] }] }, classifications: {}
    }
    const coordinator = {
      getSnapshot: vi.fn().mockResolvedValue(snapshot), applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue(snapshot)
    }
    const generate = vi.fn().mockResolvedValue({
      kind: 'favorite-archive-organize', results: [], keywordSuggestions: []
    })
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: coordinator as never,
      preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'knowledge', displayName: '默认', keywords: [], enabled: true, isDefault: true }] }),
      ledgersForAccount: () => [
        { id: 'knowledge', displayName: '默认', keywords: [], enabled: false, isDefault: true },
        { id: 'inbox', displayName: '暂存', keywords: [], enabled: true, isDefault: true }
      ],
      generate
    })

    await service.organizeCurrentSegment('100')
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ ledgers: [] }))
  })

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
      mode: 'low-confidence-and-unclassified', videos: [
        expect.objectContaining({ aid: 1, lowConfidence: true }),
        expect.objectContaining({ aid: 2, lowConfidence: true })
      ]
    }))
  })
  it('submits only the selected current segment and records one main-process DeepSeek batch', async () => {
    const initialSnapshot = {
      accountMid: '100', workspaceId: 'workspace-100', status: 'previewing',
      sourceFolders: [
        { id: 'source-a', title: 'Source A', isBilimiWorkFolder: false, selected: true },
        { id: 'source-b', title: 'Source B', isBilimiWorkFolder: false, selected: false }
      ],
      currentSegment: {
        id: 'segment-1',
        items: [
          { aid: 1, title: 'Knowledge', author: 'UP', description: 'A TypeScript guide', tags: ['TypeScript'], category: 'Technology', sourceFolderIds: ['source-a'] },
          { aid: 2, title: 'Ignored', author: 'UP', sourceFolderIds: ['source-b'] }
        ]
      },
      classifications: { '1': { aid: 1, targetLedgerIds: ['music'], source: 'manual' } }
    }
    const updatedSnapshot = {
      ...initialSnapshot,
      sourceFolders: initialSnapshot.sourceFolders.map((folder) => ({ ...folder, itemCount: 1 })),
      classifications: { '1': { aid: 1, targetLedgerIds: ['knowledge'], source: 'deepseek' } }
    }
    const coordinator = {
      getSnapshot: vi.fn().mockResolvedValueOnce(initialSnapshot).mockResolvedValueOnce(updatedSnapshot),
      // The mutation returns the internal workspace model, not the renderer snapshot.
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
          { id: 'knowledge', displayName: 'Knowledge', keywords: ['Only technical tutorials'], ruleType: 'deepseek', enabled: true },
          { id: 'music', displayName: 'Music', keywords: [], enabled: true },
          { id: 'inbox', displayName: 'Inbox', keywords: [], enabled: true }
        ]
      }),
      generate
    })

    await expect(service.organizeCurrentSegment('100')).resolves.toMatchObject({
      referencedConstraintLedgerNames: ['Knowledge'],
      snapshot: updatedSnapshot
    })

    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'favorite-archive-organize',
      multiArchiveLimit: 1,
      videos: [expect.objectContaining({
        aid: 1, sourceFolderTitle: 'Source A', currentTargetLedgerIds: ['music'],
        description: 'A TypeScript guide', tags: ['TypeScript'], category: 'Technology'
      })]
    }))
    expect(coordinator.applyDeepSeekClassificationBatch).toHaveBeenCalledWith('100', [
      { aid: 1, targetLedgerIds: ['knowledge'] }
    ], expect.objectContaining({ workspaceId: 'workspace-100', currentSegmentId: 'segment-1' }))
    expect(coordinator.getSnapshot).toHaveBeenCalledTimes(2)
  })

  it('retains an invalid result as a visible failed chunk instead of recording it', async () => {
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

    await expect(service.organizeCurrentSegment('100')).resolves.toMatchObject({
      progress: { failedVideoCount: 1, successfulVideoCount: 0 },
      failures: [{ chunkIndex: 1, affectedVideoCount: 1, message: 'DeepSeek returned an incomplete current-segment result.' }]
    })
    expect(coordinator.applyDeepSeekClassificationBatch).not.toHaveBeenCalled()
  })

  it('keeps valid rows from a mixed response and retries only the missing current-segment video', async () => {
    const snapshot = {
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing',
      sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
      currentSegment: { id: 'segment-1', items: [
        { aid: 1, title: 'One', sourceFolderIds: ['source'] },
        { aid: 2, title: 'Two', sourceFolderIds: ['source'] }
      ] },
      classifications: {}
    }
    const coordinator = {
      getSnapshot: vi.fn().mockResolvedValue(snapshot),
      applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue(snapshot)
    }
    const generate = vi.fn()
      .mockResolvedValueOnce({ kind: 'favorite-archive-organize' as const, results: [
        { aid: 1, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false },
        { aid: 999, targetLedgerIds: ['music'], keepOriginal: false, reason: 'not in this segment', lowConfidence: false }
      ], keywordSuggestions: [] })
      .mockResolvedValueOnce({ kind: 'favorite-archive-organize' as const, results: [
        { aid: 2, targetLedgerIds: ['music'], keepOriginal: false, reason: 'retry', lowConfidence: false }
      ], keywordSuggestions: [] })
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: coordinator as never,
      preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true }] }),
      generate
    })

    await expect(service.organizeCurrentSegment('100')).resolves.toMatchObject({
      progress: { successfulVideoCount: 2, failedVideoCount: 0 }, failures: []
    })
    expect(generate.mock.calls.map(([request]) => request.videos.map((video: { aid: number }) => video.aid))).toEqual([[1, 2], [2]])
    expect(coordinator.applyDeepSeekClassificationBatch).toHaveBeenCalledWith('100', [
      { aid: 1, targetLedgerIds: ['music'] }, { aid: 2, targetLedgerIds: ['music'] }
    ], expect.any(Object))
  })

  it('applies valid DeepSeek rows when another returned target is unavailable', async () => {
    const snapshot = {
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing',
      sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
      currentSegment: { id: 'segment-1', items: [
        { aid: 1, title: 'Valid', sourceFolderIds: ['source'] },
        { aid: 2, title: 'Unavailable target', sourceFolderIds: ['source'] }
      ] },
      classifications: {}
    }
    const coordinator = {
      getSnapshot: vi.fn().mockResolvedValue(snapshot),
      applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue(snapshot)
    }
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: coordinator as never,
      preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true }] }),
      generate: vi.fn().mockResolvedValue({
        kind: 'favorite-archive-organize', results: [
          { aid: 1, targetLedgerIds: ['music'], keepOriginal: false, reason: 'valid', lowConfidence: false },
          { aid: 2, targetLedgerIds: ['retired-ledger'], keepOriginal: false, reason: 'unavailable', lowConfidence: false }
        ], keywordSuggestions: []
      })
    })

    await expect(service.organizeCurrentSegment('100')).resolves.toMatchObject({
      progress: { successfulVideoCount: 1, failedVideoCount: 1 },
      failures: [{ chunkIndex: 1, aids: [2], affectedVideoCount: 1, message: 'DeepSeek returned unavailable favorite targets.' }]
    })
    expect(coordinator.applyDeepSeekClassificationBatch).toHaveBeenCalledWith('100', [
      { aid: 1, targetLedgerIds: ['music'] }
    ], expect.any(Object))
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

  it('splits a large current segment into legacy twenty-video requests and applies its aggregate once', async () => {
    const items = Array.from({ length: 31 }, (_, index) => ({ aid: index + 1, title: `Video ${index + 1}`, sourceFolderIds: ['source'] }))
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
    expect(generate.mock.calls.map(([request]) => request.videos.length)).toEqual([20, 11])
    expect(coordinator.applyDeepSeekClassificationBatch).toHaveBeenCalledOnce()
    expect(coordinator.applyDeepSeekClassificationBatch.mock.calls[0][1]).toHaveLength(31)
  })

  it('shrinks a missing-row retry instead of repeating the full archive request', async () => {
    const items = Array.from({ length: 8 }, (_, index) => ({ aid: index + 1, title: `Video ${index + 1}`, sourceFolderIds: ['source'] }))
    const snapshot = {
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing' as const,
      sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
      currentSegment: { id: 'segment-1', items }, classifications: {}
    }
    const coordinator = { getSnapshot: vi.fn().mockResolvedValue(snapshot), applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue(snapshot) }
    const generate = vi.fn()
      .mockImplementationOnce(async (request) => ({ kind: 'favorite-archive-organize' as const, results: request.videos.slice(0, 4).map((video: { aid: number }) => ({ aid: video.aid, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false })), keywordSuggestions: [] }))
      .mockImplementationOnce(async (request) => ({ kind: 'favorite-archive-organize' as const, results: request.videos.map((video: { aid: number }) => ({ aid: video.aid, targetLedgerIds: ['music'], keepOriginal: false, reason: 'retry', lowConfidence: false })), keywordSuggestions: [] }))
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: coordinator as never,
      preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true, priority: 0, isDefault: true }] }),
      generate
    })

    await expect(service.organizeCurrentSegment('100')).resolves.toMatchObject({ progress: { successfulVideoCount: 8, failedVideoCount: 0 } })
    expect(generate.mock.calls.map(([request]) => request.videos.length)).toEqual([8, 4])
  })

  it('publishes authoritative chunk progress while a large current segment is being organized', async () => {
    const items = Array.from({ length: 21 }, (_, index) => ({ aid: index + 1, title: `Video ${index + 1}`, sourceFolderIds: ['source'] }))
    const coordinator = {
      getSnapshot: vi.fn().mockResolvedValue({
        accountMid: '100', workspaceId: 'workspace-1', status: 'previewing',
        sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
        currentSegment: { id: 'segment-1', items }, classifications: {}
      }),
      applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue({ accountMid: '100', status: 'previewing' })
    }
    const progress = vi.fn()
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: coordinator as never,
      preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true }] }),
      generate: vi.fn(async (request) => ({ kind: 'favorite-archive-organize' as const, results: request.videos.map((video: { aid: number }) => ({ aid: video.aid, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false })), keywordSuggestions: [] }))
    })

    await service.organizeCurrentSegment('100', 'all', progress)

    expect(progress).toHaveBeenNthCalledWith(1, { totalChunks: 2, completedChunks: 0, totalVideoCount: 21, successfulVideoCount: 0, failedVideoCount: 0 })
    expect(progress).toHaveBeenNthCalledWith(2, { totalChunks: 2, completedChunks: 1, totalVideoCount: 21, successfulVideoCount: 20, failedVideoCount: 0 })
    expect(progress).toHaveBeenNthCalledWith(3, { totalChunks: 2, completedChunks: 2, totalVideoCount: 21, successfulVideoCount: 21, failedVideoCount: 0 })
  })

  it('keeps successful chunks and reports a failed chunk without discarding the whole segment', async () => {
    const items = Array.from({ length: 21 }, (_, index) => ({ aid: index + 1, title: `Video ${index + 1}`, sourceFolderIds: ['source'] }))
    const coordinator = {
      getSnapshot: vi.fn().mockResolvedValue({
        accountMid: '100', workspaceId: 'workspace-1', status: 'previewing',
        sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
        currentSegment: { id: 'segment-1', items }, classifications: {}
      }),
      applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue({ accountMid: '100', status: 'previewing' })
    }
    const generate = vi.fn()
      .mockImplementationOnce(async (request) => ({
        kind: 'favorite-archive-organize' as const,
        results: request.videos.map((video: { aid: number }) => ({ aid: video.aid, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false })),
        keywordSuggestions: []
      }))
      .mockRejectedValueOnce(new Error('DeepSeek API request failed: 429 Too Many Requests'))
      .mockImplementationOnce(async (request) => ({
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

    const result = await service.organizeCurrentSegment('100')

    expect(coordinator.applyDeepSeekClassificationBatch).toHaveBeenCalledWith('100',
      [
        ...Array.from({ length: 20 }, (_, index) => ({ aid: index + 1, targetLedgerIds: ['music'] }))
      ], expect.any(Object))
    expect(result).toMatchObject({
      snapshot: { accountMid: '100', status: 'previewing' },
      progress: { totalChunks: 2, completedChunks: 2, successfulVideoCount: 20, failedVideoCount: 1 },
      failures: [{ chunkIndex: 2, aids: [21], affectedVideoCount: 1, message: 'DeepSeek API request failed: 429 Too Many Requests' }]
    })
  })

  it('keeps valid DeepSeek rows and retries only rows omitted from a batch response', async () => {
    const items = [{ aid: 1, title: 'One', sourceFolderIds: ['source'] }, { aid: 2, title: 'Two', sourceFolderIds: ['source'] }]
    const snapshot = {
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing',
      sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
      currentSegment: { id: 'segment-1', items }, classifications: {}
    }
    const coordinator = {
      getSnapshot: vi.fn().mockResolvedValue(snapshot),
      applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue(snapshot)
    }
    const generate = vi.fn()
      .mockResolvedValueOnce({ kind: 'favorite-archive-organize' as const, results: [
        { aid: 1, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false }
      ], keywordSuggestions: [] })
      .mockResolvedValueOnce({ kind: 'favorite-archive-organize' as const, results: [
        { aid: 2, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false }
      ], keywordSuggestions: [] })
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: coordinator as never,
      preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true }] }),
      generate
    })

    await expect(service.organizeCurrentSegment('100')).resolves.toMatchObject({
      progress: { successfulVideoCount: 2, failedVideoCount: 0 }, failures: []
    })
    expect(generate.mock.calls.map(([request]) => request.videos.map((video: { aid: number }) => video.aid))).toEqual([[1, 2], [2]])
    expect(coordinator.applyDeepSeekClassificationBatch).toHaveBeenCalledWith('100', [
      { aid: 1, targetLedgerIds: ['music'] }, { aid: 2, targetLedgerIds: ['music'] }
    ], expect.any(Object))
  })

  it('retries only the previously failed chunk aids through the main process', async () => {
    const items = Array.from({ length: 21 }, (_, index) => ({ aid: index + 1, title: `Video ${index + 1}`, sourceFolderIds: ['source'] }))
    const snapshot = {
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing',
      sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
      currentSegment: { id: 'segment-1', items }, classifications: {}
    }
    const coordinator = {
      getSnapshot: vi.fn().mockResolvedValue(snapshot),
      applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue(snapshot)
    }
    const generate = vi.fn()
      .mockImplementationOnce(async (request) => ({ kind: 'favorite-archive-organize' as const, results: request.videos.map((video: { aid: number }) => ({ aid: video.aid, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false })), keywordSuggestions: [] }))
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockImplementationOnce(async (request) => ({ kind: 'favorite-archive-organize' as const, results: request.videos.map((video: { aid: number }) => ({ aid: video.aid, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false })), keywordSuggestions: [] }))
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: coordinator as never,
      preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true }] }),
      generate
    })

    await service.organizeCurrentSegment('100')
    const progress = vi.fn()
    await service.retryFailedChunks('100', progress)

    expect(generate.mock.calls[2]![0].videos.map((video: { aid: number }) => video.aid)).toEqual([21])
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ totalVideoCount: 1, completedChunks: 1 }))
  })

  it('stops after the current DeepSeek batch while preserving its completed classifications', async () => {
    const items = Array.from({ length: 21 }, (_, index) => ({ aid: index + 1, title: `Video ${index + 1}`, sourceFolderIds: ['source'] }))
    const snapshot = {
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing',
      sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
      currentSegment: { id: 'segment-1', items }, classifications: {}
    }
    const coordinator = {
      getSnapshot: vi.fn().mockResolvedValue(snapshot),
      applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue(snapshot)
    }
    const result = {
      kind: 'favorite-archive-organize' as const,
      results: items.slice(0, 20).map((video) => ({ aid: video.aid, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false })),
      keywordSuggestions: [] as never[]
    }
    let resolveFirstBatch: ((value: typeof result) => void) | undefined
    const generate = vi.fn(() => new Promise<typeof result>((resolve) => { resolveFirstBatch = resolve }))
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: coordinator as never,
      preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true }] }),
      generate
    })

    const pending = service.organizeCurrentSegment('100')
    await Promise.resolve()
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ videos: expect.arrayContaining([expect.objectContaining({ aid: 1 })]) }))
    expect(service.cancelCurrentSegment('100')).toBe(true)
    resolveFirstBatch?.(result)

    await expect(pending).resolves.toMatchObject({
      canceled: true,
      progress: { totalChunks: 2, completedChunks: 1, successfulVideoCount: 20, failedVideoCount: 0 }
    })
    expect(generate).toHaveBeenCalledTimes(1)
    expect(coordinator.applyDeepSeekClassificationBatch).toHaveBeenCalledWith('100',
      items.slice(0, 20).map((video) => ({ aid: video.aid, targetLedgerIds: ['music'] })), expect.any(Object))
  })

  it('serially organizes every unsaved batch and restores the user selected batch', async () => {
    let currentSegmentId = 'segment-1'
    const segmentItems = new Map([
      ['segment-1', [{ aid: 1, title: 'One', sourceFolderIds: ['source'] }]],
      ['segment-2', [{ aid: 2, title: 'Two', sourceFolderIds: ['source'] }]],
      ['segment-3', [{ aid: 3, title: 'Saved', sourceFolderIds: ['source'] }]]
    ])
    const getSnapshot = vi.fn(async () => ({
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing' as const, hasMultipleSegments: true,
      sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
      segments: [
        { id: 'segment-1', status: 'previewing' as const, readiness: 'ready' as const },
        { id: 'segment-2', status: 'previewing' as const, readiness: 'ready' as const },
        { id: 'segment-3', status: 'frozen' as const, readiness: 'saved' as const }
      ],
      currentSegment: { id: currentSegmentId, items: segmentItems.get(currentSegmentId) ?? [] },
      classifications: {}
    }))
    const coordinator = {
      getSnapshot,
      selectSegment: vi.fn(async (_accountMid: string, segmentId: string) => { currentSegmentId = segmentId }),
      applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue({})
    }
    const generate = vi.fn(async (request) => ({
      kind: 'favorite-archive-organize' as const,
      results: request.videos.map((video: { aid: number }) => ({ aid: video.aid, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false })),
      keywordSuggestions: []
    }))
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: coordinator as never,
      preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true, priority: 0, isDefault: true }] }),
      generate
    })

    await expect(service.organizeAllSegments('100')).resolves.toMatchObject({
      progress: { totalVideoCount: 2, successfulVideoCount: 2 },
      snapshot: { currentSegment: { id: 'segment-1' } }
    })
    expect(generate.mock.calls.map(([request]) => request.videos.map((video: { aid: number }) => video.aid))).toEqual([[1], [2]])
    expect(coordinator.selectSegment.mock.calls.map(([, segmentId]) => segmentId)).toEqual(['segment-2', 'segment-1'])
  })

  it('finishes ready batches without polling a later batch that is still waiting for tags', async () => {
    let currentSegmentId = 'segment-1'
    const getSnapshot = vi.fn(async () => ({
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing' as const, hasMultipleSegments: true,
      sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
      segments: [
        { id: 'segment-1', status: 'previewing' as const, readiness: 'ready' as const },
        { id: 'segment-2', status: 'previewing' as const, readiness: 'tagging' as const }
      ],
      currentSegment: {
        id: currentSegmentId,
        items: currentSegmentId === 'segment-1'
          ? [{ aid: 1, title: 'Ready', sourceFolderIds: ['source'] }]
          : [{ aid: 2, title: 'Waiting for tags', sourceFolderIds: ['source'] }]
      },
      classifications: {}
    }))
    const coordinator = {
      getSnapshot,
      selectSegment: vi.fn(async (_accountMid: string, segmentId: string) => { currentSegmentId = segmentId }),
      applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue({})
    }
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: coordinator as never,
      preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true }] }),
      generate: vi.fn(async () => ({
        kind: 'favorite-archive-organize' as const,
        results: [{ aid: 1, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false }],
        keywordSuggestions: []
      }))
    })

    const pending = service.organizeAllSegments('100')
    const outcome = await Promise.race([
      pending.then((result) => ({ kind: 'result' as const, result })),
      new Promise<{ kind: 'timeout' }>((resolve) => setTimeout(() => resolve({ kind: 'timeout' }), 30))
    ])
    if (outcome.kind === 'timeout') {
      service.cancelCurrentSegment('100')
      await pending
    }

    expect(outcome.kind).toBe('result')
    if (outcome.kind === 'result') {
      expect(outcome.result).toMatchObject({
        deferredSegmentCount: 1,
        progress: { totalVideoCount: 1, successfulVideoCount: 1 }
      })
    }
    expect(coordinator.selectSegment).not.toHaveBeenCalled()
  })

  it('retains failed aids from earlier batches when a later batch succeeds and retries only their batch', async () => {
    let currentSegmentId = 'segment-1'
    const segmentItems = new Map([
      ['segment-1', [{ aid: 1, title: 'Failed first batch', sourceFolderIds: ['source'] }]],
      ['segment-2', [{ aid: 2, title: 'Successful second batch', sourceFolderIds: ['source'] }]]
    ])
    const getSnapshot = vi.fn(async () => ({
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing' as const, hasMultipleSegments: true,
      sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
      segments: [
        { id: 'segment-1', status: 'previewing' as const, readiness: 'ready' as const },
        { id: 'segment-2', status: 'previewing' as const, readiness: 'ready' as const }
      ],
      currentSegment: { id: currentSegmentId, items: segmentItems.get(currentSegmentId) ?? [] },
      classifications: {}
    }))
    const coordinator = {
      getSnapshot,
      selectSegment: vi.fn(async (_accountMid: string, segmentId: string) => { currentSegmentId = segmentId }),
      applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue({})
    }
    const generate = vi.fn()
      .mockRejectedValueOnce(new Error('first batch unavailable'))
      .mockImplementation(async (request) => ({
        kind: 'favorite-archive-organize' as const,
        results: request.videos.map((video: { aid: number }) => ({ aid: video.aid, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false })),
        keywordSuggestions: []
      }))
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: coordinator as never,
      preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true }] }),
      generate
    })

    await expect(service.organizeAllSegments('100')).resolves.toMatchObject({
      progress: { totalVideoCount: 2, successfulVideoCount: 1, failedVideoCount: 1 },
      failures: [{ aids: [1] }]
    })
    await expect(service.retryFailedChunks('100')).resolves.toMatchObject({
      progress: { totalVideoCount: 1, successfulVideoCount: 1, failedVideoCount: 0 },
      snapshot: { currentSegment: { id: 'segment-1' } }
    })

    expect(generate.mock.calls.map(([request]) => request.videos.map((video: { aid: number }) => video.aid))).toEqual([[1], [2], [1]])
    expect(coordinator.selectSegment.mock.calls.map(([, segmentId]) => segmentId)).toEqual([
      'segment-2', 'segment-1',
      'segment-1', 'segment-1'
    ])
  })

  it('keeps unvisited failed batches retryable when an all-batch retry is canceled', async () => {
    let currentSegmentId = 'segment-1'
    const segmentItems = new Map([
      ['segment-1', [{ aid: 1, title: 'First failed batch', sourceFolderIds: ['source'] }]],
      ['segment-2', [{ aid: 2, title: 'Second failed batch', sourceFolderIds: ['source'] }]]
    ])
    const snapshot = () => ({
      accountMid: '100', workspaceId: 'workspace-1', status: 'previewing' as const, hasMultipleSegments: true,
      sourceFolders: [{ id: 'source', title: 'Source', isBilimiWorkFolder: false, selected: true }],
      segments: [
        { id: 'segment-1', status: 'previewing' as const, readiness: 'ready' as const },
        { id: 'segment-2', status: 'previewing' as const, readiness: 'ready' as const }
      ],
      currentSegment: { id: currentSegmentId, items: segmentItems.get(currentSegmentId) ?? [] },
      classifications: {}
    })
    const coordinator = {
      getSnapshot: vi.fn(async () => snapshot()),
      selectSegment: vi.fn(async (_accountMid: string, segmentId: string) => { currentSegmentId = segmentId }),
      applyDeepSeekClassificationBatch: vi.fn().mockResolvedValue({})
    }
    const success = (aid: number) => ({
      kind: 'favorite-archive-organize' as const,
      results: [{ aid, targetLedgerIds: ['music'], keepOriginal: false, reason: 'ok', lowConfidence: false }],
      keywordSuggestions: []
    })
    let resolveFirstRetry: ((value: ReturnType<typeof success>) => void) | undefined
    const generate = vi.fn()
      .mockRejectedValueOnce(new Error('first failed batch'))
      .mockRejectedValueOnce(new Error('second failed batch'))
      .mockImplementationOnce(() => new Promise<ReturnType<typeof success>>((resolve) => { resolveFirstRetry = resolve }))
      .mockImplementationOnce(async () => success(2))
    const service = new OldFavoriteWorkspaceDeepSeekService({
      coordinator: coordinator as never,
      preferences: () => ({ deepseekArchiveOrganizationEnabled: true, favoriteArchiveMultiMode: 'off' as const, favoriteLedgers: [{ id: 'music', displayName: 'Music', keywords: [], enabled: true, priority: 0, isDefault: true }] }),
      generate
    })

    await service.organizeAllSegments('100')
    const canceledRetry = service.retryFailedChunks('100')
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(3))
    expect(service.cancelCurrentSegment('100')).toBe(true)
    resolveFirstRetry?.(success(1))
    await expect(canceledRetry).resolves.toMatchObject({ canceled: true })
    await expect(service.retryFailedChunks('100')).resolves.toMatchObject({
      progress: { totalVideoCount: 1, successfulVideoCount: 1, failedVideoCount: 0 }
    })

    expect(generate.mock.calls.map(([request]) => request.videos.map((video: { aid: number }) => video.aid))).toEqual([[1], [2], [1], [2]])
  })
})
